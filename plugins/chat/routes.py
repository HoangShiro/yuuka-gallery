import json
from flask import Blueprint, Response, jsonify, request, stream_with_context
from integrations import gemini_api
from integrations import openai as openai_integration


def create_blueprint(plugin):
    """
    Build the Flask blueprint for the chat plugin.
    """
    orchestrator = plugin.orchestrator
    core_api = plugin.core_api

    blueprint = Blueprint("chat", __name__)

    def _require_user():
        try:
            return core_api.verify_token_and_get_user_hash()
        except Exception as exc:  # noqa: BLE001
            raise PermissionError(str(exc))

    @blueprint.errorhandler(PermissionError)
    def handle_permission_error(err):
        return jsonify({"error": str(err)}), 401

    @blueprint.route("/definitions", methods=["GET"])
    def list_definitions():
        user_hash = _require_user()
        data = orchestrator.list_character_cards(user_hash)
        return jsonify(data)

    @blueprint.route("/definitions", methods=["POST"])
    def create_definition():
        user_hash = _require_user()
        payload = request.json or {}
        result = orchestrator.create_character_definition(user_hash, payload)
        return jsonify(result), 201

    @blueprint.route("/definitions/<character_id>", methods=["GET", "PUT", "DELETE"])
    def handle_definition(character_id: str):
        user_hash = _require_user()
        if request.method == "GET":
            definition = orchestrator.get_character_definition(user_hash, character_id)
            if definition is None:
                return jsonify({"error": "Character definition not found."}), 404
            return jsonify(definition)

        if request.method == "PUT":
            payload = request.json or {}
            definition = orchestrator.upsert_character_definition(user_hash, character_id, payload)
            return jsonify({"id": character_id, "definition": definition})

        if request.method == "DELETE":
            success = orchestrator.delete_character_definition(user_hash, character_id)
            if success:
                return jsonify({"status": "deleted"})
            return jsonify({"error": "Character definition not found."}), 404

        return jsonify({"error": "Unsupported method."}), 405

    @blueprint.route("/settings", methods=["GET", "PUT"])
    def handle_settings():
        user_hash = _require_user()
        if request.method == "GET":
            return jsonify(orchestrator.get_generation_settings(user_hash))
        payload = request.json or {}
        updated = orchestrator.update_generation_settings(user_hash, payload)
        return jsonify(updated)

    @blueprint.route("/models", methods=["GET", "POST"])
    def list_models():
        """Return available model ids for the current or provided provider/API key.
        GET: use saved settings for the authenticated user.
        POST: accept overrides { provider, api_key, overrides }.
        """
        user_hash = _require_user()
        try:
            base_settings = orchestrator.get_generation_settings(user_hash) or {}
        except Exception:  # noqa: BLE001
            base_settings = {}

        payload = request.json or {} if request.method == "POST" else {}
        provider = (payload.get("provider") or base_settings.get("provider") or "openai").strip().lower()
        user_api_key = payload.get("api_key") or base_settings.get("api_key")
        overrides = payload.get("overrides") or base_settings.get("overrides") or {}

        try:
            if provider == "gemini":
                models = gemini_api.list_models(user_api_key=user_api_key)
                # Optionally filter to text-capable models
                def _is_text_capable(m):
                    methods = m.get("supported_generation_methods") or []
                    return any(method in methods for method in ("generateContent", "create", "text")) or not methods
                models = [m for m in models if _is_text_capable(m)]
                return jsonify({"models": models})

            # Default: OpenAI-compatible
            models = openai_integration.list_models(provider=provider, user_api_key=user_api_key, overrides=overrides)
            return jsonify({"models": models})
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 400

    @blueprint.route("/sessions", methods=["GET"])
    def list_sessions():
        user_hash = _require_user()
        return jsonify(orchestrator.list_chat_sessions(user_hash))

    @blueprint.route("/sessions/<character_id>/history", methods=["GET"])
    def get_history(character_id: str):
        user_hash = _require_user()
        session_id = request.args.get("session_id") or None
        data = orchestrator.get_chat_history(user_hash, character_id, session_id=session_id)
        return jsonify(data)

    @blueprint.route("/sessions/<character_id>/new", methods=["POST"])
    def create_new_session(character_id: str):
        """Create a new empty session for a character and return the empty history payload."""
        user_hash = _require_user()
        try:
            # Use the underlying history store to create a session
            session_id = orchestrator.histories.create_session(user_hash, character_id)
            data = orchestrator.get_chat_history(user_hash, character_id, session_id=session_id)
            data["session_id"] = session_id
            return jsonify(data), 201
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 500

    @blueprint.route("/sessions/<character_id>/reset", methods=["POST"])
    def reset_session(character_id: str):
        """Clear all messages for the specified character, keeping the character definition.
        Returns an empty history structure so the client can remain on the chat page.
        """
        user_hash = _require_user()
        try:
            session_id = request.args.get("session_id") or None
            result = orchestrator.clear_chat_history(user_hash, character_id, session_id=session_id)
            return jsonify(result)
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 500

    @blueprint.route("/sessions/<character_id>/messages", methods=["POST"])
    def create_message(character_id: str):
        user_hash = _require_user()
        payload = request.json or {}
        session_id = request.args.get("session_id") or None
        role = payload.get("role", "user")
        message_type = payload.get("type", "text")
        content = payload.get("content") or {}
        metadata = payload.get("metadata") or {}
        reference_id = payload.get("reference_id")
        message = orchestrator.append_message(
            user_hash,
            character_id,
            role=role,
            message_type=message_type,
            content=content,
            metadata=metadata,
            reference_id=reference_id,
            session_id=session_id,
        )
        stream_mode = str(request.args.get("stream", "")).lower() in {"1", "true", "yes"}
        if stream_mode and role == "user":
            try:
                stream = orchestrator.stream_chat_response(
                    user_hash,
                    character_id,
                    user_message=message,
                    session_id=session_id,
                )
                return Response(stream_with_context(stream), mimetype="application/x-ndjson")
            except Exception as exc:  # noqa: BLE001
                error_payload = {"error": str(exc)}
                return Response(
                    json.dumps(error_payload),
                    status=500,
                    mimetype="application/json",
                )

        response = {"message": message, "session_id": session_id}
        status_code = 201

        if role == "user":
            try:
                job = orchestrator.enqueue_generation(
                    user_hash,
                    character_id,
                    messages=None,
                    operation="chat",
                    context={"session_id": session_id},
                )
                response["job"] = job
                status_code = 202
            except Exception as exc:  # noqa: BLE001
                response["error"] = str(exc)

        return jsonify(response), status_code

    @blueprint.route("/sessions/<character_id>", methods=["DELETE"])
    def delete_session(character_id: str):
        """Remove the chat session for a character by clearing its history.
        The session list will drop this entry if empty histories are not listed.
        """
        user_hash = _require_user()
        try:
            session_id = request.args.get("session_id") or None
            deleted = orchestrator.delete_chat_session(user_hash, character_id, session_id=session_id)
            if deleted:
                return jsonify({"status": "deleted"})
            return jsonify({"error": "Session not found."}), 404
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 500

    @blueprint.route("/sessions/<character_id>/messages/<message_id>", methods=["PUT", "DELETE"])
    def mutate_message(character_id: str, message_id: str):
        user_hash = _require_user()
        session_id = request.args.get("session_id") or None
        if request.method == "PUT":
            payload = request.json or {}
            updated = orchestrator.update_message(user_hash, character_id, message_id, payload, session_id=session_id)
            if updated is None:
                return jsonify({"error": "Message not found."}), 404
            return jsonify(updated)
        success = orchestrator.delete_message(user_hash, character_id, message_id, session_id=session_id)
        if success:
            return jsonify({"status": "deleted"})
        return jsonify({"error": "Message not found."}), 404

    @blueprint.route("/sessions/<character_id>/actions/regen", methods=["POST"])
    def regenerate_message(character_id: str):
        user_hash = _require_user()
        payload = request.json or {}
        messages = payload.get("messages") or []
        session_id = request.args.get("session_id") or None
        stream_mode = str(request.args.get("stream", "")).lower() in {"1", "true", "yes"}
        if stream_mode:
            try:
                stream = orchestrator.stream_regeneration(
                    user_hash,
                    character_id,
                    target_message_id=payload.get("message_id"),
                    messages=messages,
                    session_id=session_id,
                )
                return Response(stream_with_context(stream), mimetype="application/x-ndjson")
            except Exception as exc:  # noqa: BLE001
                error_payload = {"error": str(exc)}
                return Response(json.dumps(error_payload), status=400, mimetype="application/json")
        try:
            job = orchestrator.enqueue_generation(
                user_hash,
                character_id,
                messages=messages,
                operation="regen",
                context={"action": "regen", "message_id": payload.get("message_id"), "session_id": session_id},
            )
            return jsonify(job), 202
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 400

    @blueprint.route("/sessions/<character_id>/actions/continue", methods=["POST"])
    def continue_conversation(character_id: str):
        user_hash = _require_user()
        payload = request.json or {}
        messages = payload.get("messages") or []
        try:
            job = orchestrator.enqueue_generation(
                user_hash,
                character_id,
                messages=messages,
                operation="chat",
                context={
                    "action": "continue",
                    "seed": payload.get("seed"),
                    "prompt": payload.get("prompt"),
                    "session_id": request.args.get("session_id") or None,
                },
            )
            return jsonify(job), 202
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 400

    @blueprint.route("/sessions/<character_id>/actions/swipe", methods=["POST"])
    def swipe_message(character_id: str):
        user_hash = _require_user()
        payload = request.json or {}
        messages = payload.get("messages") or []
        try:
            job = orchestrator.enqueue_generation(
                user_hash,
                character_id,
                messages=messages,
                operation="chat",
                context={
                    "action": "swipe",
                    "parent_id": payload.get("message_id"),
                    "session_id": request.args.get("session_id") or None,
                },
            )
            return jsonify(job), 202
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 400

    @blueprint.route("/jobs/<job_id>", methods=["GET"])
    def job_status(job_id: str):
        user_hash = _require_user()
        status = orchestrator.get_job_status(job_id)
        if status is None:
            return jsonify({"error": "Job not found."}), 404
        if status.get("user_hash") != user_hash:
            return jsonify({"error": "Job not accessible."}), 403
        status = {k: v for k, v in status.items() if k != "user_hash"}
        status["job_id"] = job_id
        return jsonify(status)

    return blueprint
