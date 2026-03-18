import re
import json
from flask import jsonify, request, Response, stream_with_context


def _resolve_tags(context_text, personas, scenarios):
    """
    Resolve @[Name] tags in context text to actual content.
    Returns (resolved_text, list_of_resolved_items).
    Tags match against character names, user persona names, and rule names.
    """
    resolved_items = []

    # Collect all taggable entities with their content
    tag_sources = {}

    # Characters
    for char_id, char_data in personas.get("characters", {}).items():
        name = char_data.get("name", "")
        if name:
            tag_sources[name.lower()] = {
                "type": "character",
                "name": name,
                "content": char_data.get("persona", ""),
                "id": char_id
            }

    # User personas
    for user_id, user_data in personas.get("users", {}).items():
        name = user_data.get("name", "")
        if name:
            tag_sources[name.lower()] = {
                "type": "user",
                "name": name,
                "content": user_data.get("persona", ""),
                "id": user_id
            }

    # System instruction rules
    for rule_id, rule_data in scenarios.get("rules", {}).items():
        name = rule_data.get("name", "")
        if name:
            tag_sources[name.lower()] = {
                "type": "rule",
                "name": name,
                "content": rule_data.get("content", ""),
                "id": rule_id
            }

    # Find and resolve @[...] patterns
    def replace_tag(match):
        tag_name = match.group(1).strip()
        source = tag_sources.get(tag_name.lower())
        if source:
            resolved_items.append(source)
            return f"[{source['type'].upper()}: {source['name']}]"
        return match.group(0)  # Keep unresolved

    resolved = re.sub(r'@\[([^\]]+)\]', replace_tag, context_text)
    return resolved, resolved_items


def _build_scripting_prompt(system_instruction, context_info, extra_context=""):
    """Build a prompt for the scripting system."""
    parts = []

    if system_instruction:
        parts.append(f"<system_instruction>\n{system_instruction}\n</system_instruction>")

    if context_info:
        parts.append(f"<context>\n{context_info}\n</context>")

    if extra_context:
        parts.append(extra_context)

    return "\n\n".join(parts)


def _gather_session_context(data, personas):
    """Gather all available context from a chat session for scripting."""
    parts = []

    # Character info
    char_name = data.get('character_name', '')
    char_persona = data.get('character_persona', '')
    if char_name and char_persona:
        parts.append(f"<character name=\"{char_name}\">\n{char_persona}\n</character>")

    # User info
    user_name = data.get('user_name', '')
    user_persona = data.get('user_persona', '')
    if user_name and user_persona:
        parts.append(f"<user name=\"{user_name}\">\n{user_persona}\n</user>")

    # Current session state
    session_state = data.get('session_state', {})
    if session_state:
        state_parts = []
        if session_state.get('location'):
            state_parts.append(f"Location: {session_state['location']}")
        if session_state.get('outfits'):
            state_parts.append(f"Currently Worn Outfits: {', '.join(session_state['outfits'])}")
        if state_parts:
            parts.append(f"<current_state>\n" + "\n".join(state_parts) + "\n</current_state>")

    # Memory summary
    memory = data.get('memory_summary', '')
    if memory:
        parts.append(f"<memory_summary>\n{memory}\n</memory_summary>")

    # Scene contexts
    scenes = data.get('scenes', [])
    if scenes:
        scene_texts = []
        for scene in scenes:
            if isinstance(scene, dict) and scene.get('context'):
                scene_name = scene.get('name', 'Untitled')
                scene_texts.append(f"[Scene: {scene_name}]\n{scene['context']}")
        if scene_texts:
            parts.append(f"<active_scenes>\n" + "\n\n".join(scene_texts) + "\n</active_scenes>")

    # Recent chat history (condensed)
    messages = data.get('messages', [])
    if messages:
        recent = messages[-10:]  # Last 10 messages
        chat_lines = []
        for m in recent:
            role = m.get('role', 'system')
            content = m.get('content', '')
            if not content and 'snapshots' in m:
                idx = m.get('activeIndex', 0)
                snaps = m.get('snapshots', [])
                if snaps and idx < len(snaps):
                    content = snaps[idx] if isinstance(snaps[idx], str) else ''
            if content and role in ('user', 'assistant'):
                speaker = data.get('user_name', 'User') if role == 'user' else data.get('character_name', 'Character')
                chat_lines.append(f"{speaker}: {content[:200]}")
        if chat_lines:
            parts.append(f"<recent_conversation>\n" + "\n".join(chat_lines) + "\n</recent_conversation>")

    return "\n\n".join(parts)


def register_routes(blueprint, plugin):

    @blueprint.route('/scripting/generate_scene', methods=['POST'])
    def generate_scene():
        """Generate scene context using @tagged info + system instruction."""
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            context_text = data.get('context', '')
            selected_rule_id = data.get('rule_id', 'world_builder')

            # Get personas and scenarios for tag resolution
            personas = plugin.get_all_personas(user_hash)
            scenarios = plugin.get_all_scenarios(user_hash)

            # Resolve @tags
            resolved_context, resolved_items = _resolve_tags(context_text, personas, scenarios)

            # Get system instruction
            rule_content = ""
            # Check if a rule was tagged
            tagged_rules = [item for item in resolved_items if item['type'] == 'rule']
            if tagged_rules:
                rule_content = tagged_rules[0]['content']
            elif selected_rule_id:
                rule_content = plugin.get_rule_content(user_hash, selected_rule_id)

            if not rule_content:
                rule_content = plugin.get_rule_content(user_hash, 'world_builder')

            # Build context from resolved items
            context_parts = []
            for item in resolved_items:
                if item['type'] != 'rule':
                    context_parts.append(f"[{item['type'].upper()}: {item['name']}]\n{item['content']}")

            # Add user's raw context (with tags resolved to labels)
            if resolved_context.strip():
                context_parts.append(f"User's scene notes:\n{resolved_context}")

            context_info = "\n\n".join(context_parts)
            prompt = _build_scripting_prompt(rule_content, context_info)

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except:
                pass

            def generate():
                from integrations.openai import get_client
                try:
                    client = get_client(provider="ollama")
                    response = client.chat.completions.create(
                        model=model,
                        messages=[{'role': 'user', 'content': prompt}],
                        stream=True,
                        **kwargs
                    )
                    for chunk in response:
                        content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                        if content:
                            yield content
                except Exception as e:
                    yield f"\n[Error: {e}]"
                finally:
                    try:
                        import urllib.request
                        req = urllib.request.Request(
                            "http://localhost:11434/api/generate",
                            data=json.dumps({"model": model, "keep_alive": 0}).encode("utf-8"),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=5) as res:
                            pass
                    except:
                        pass

            return Response(stream_with_context(generate()), mimetype='text/plain')

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/scripting/first_message', methods=['POST'])
    def generate_first_message():
        """Generate narrator first-message for a chat session."""
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            # Get the "First message" system instruction
            rule_content = plugin.get_rule_content(user_hash, 'first_message')
            chat_format_rule = plugin.get_formatted_chat_rule(user_hash, data)
            if chat_format_rule:
                rule_content += "\n\n" + chat_format_rule

            # Gather session context
            personas = plugin.get_all_personas(user_hash)
            scenarios = plugin.get_all_scenarios(user_hash)

            # Resolve scene IDs to full scene data
            scene_ids = data.get('scene_ids', [])
            full_scenes = []
            for sid in scene_ids:
                scene = plugin.get_scene_by_id(user_hash, sid)
                if scene:
                    full_scenes.append(scene)
            data['scenes'] = full_scenes

            context_info = _gather_session_context(data, personas)
            prompt = _build_scripting_prompt(rule_content, context_info)

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except:
                pass

            def generate():
                from integrations.openai import get_client
                try:
                    client = get_client(provider="ollama")
                    response = client.chat.completions.create(
                        model=model,
                        messages=[{'role': 'user', 'content': prompt}],
                        stream=True,
                        **kwargs
                    )
                    for chunk in response:
                        content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                        if content:
                            yield content
                except Exception as e:
                    yield f"\n[Error: {e}]"
                finally:
                    try:
                        import urllib.request
                        req = urllib.request.Request(
                            "http://localhost:11434/api/generate",
                            data=json.dumps({"model": model, "keep_alive": 0}).encode("utf-8"),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=5) as res:
                            pass
                    except:
                        pass

            return Response(stream_with_context(generate()), mimetype='text/plain')

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/scripting/random_event', methods=['POST'])
    def generate_random_event():
        """Generate random event narrator message for a chat session."""
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            # Get the "Event" system instruction
            rule_content = plugin.get_rule_content(user_hash, 'event')
            chat_format_rule = plugin.get_formatted_chat_rule(user_hash, data)
            if chat_format_rule:
                rule_content += "\n\n" + chat_format_rule

            # Gather session context
            personas = plugin.get_all_personas(user_hash)
            scenarios = plugin.get_all_scenarios(user_hash)

            # Resolve scene IDs to full scene data
            scene_ids = data.get('scene_ids', [])
            full_scenes = []
            for sid in scene_ids:
                scene = plugin.get_scene_by_id(user_hash, sid)
                if scene:
                    full_scenes.append(scene)
            data['scenes'] = full_scenes

            context_info = _gather_session_context(data, personas)
            prompt = _build_scripting_prompt(
                rule_content,
                context_info,
                "Generate a random event NOW. Make it surprising but fitting for the current situation."
            )

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except:
                pass

            def generate():
                from integrations.openai import get_client
                try:
                    client = get_client(provider="ollama")
                    response = client.chat.completions.create(
                        model=model,
                        messages=[{'role': 'user', 'content': prompt}],
                        stream=True,
                        **kwargs
                    )
                    for chunk in response:
                        content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                        if content:
                            yield content
                except Exception as e:
                    yield f"\n[Error: {e}]"
                finally:
                    try:
                        import urllib.request
                        req = urllib.request.Request(
                            "http://localhost:11434/api/generate",
                            data=json.dumps({"model": model, "keep_alive": 0}).encode("utf-8"),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=5) as res:
                            pass
                    except:
                        pass

            return Response(stream_with_context(generate()), mimetype='text/plain')

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/scripting/group_random_event', methods=['POST'])
    def generate_group_random_event():
        """Generate a random event narrator message for a group chat session.
        
        The LLM may generate an event involving existing members, or introduce a new character.
        If a new character is introduced, the response includes a <group_action> tag with the
        character_hash so the frontend can auto-add them to the group.
        """
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            # Get the group_event rule
            rule_content = plugin.get_rule_content(user_hash, 'group_event')

            # Build context
            personas = plugin.get_all_personas(user_hash)
            all_chars = personas.get('characters', {})

            # Resolve scene IDs to full scene data
            scene_ids = data.get('scene_ids', [])
            full_scenes = []
            for sid in scene_ids:
                scene = plugin.get_scene_by_id(user_hash, sid)
                if scene:
                    full_scenes.append(scene)
            data['scenes'] = full_scenes

            # Build member info block
            member_infos = data.get('member_infos', [])
            candidate_infos = data.get('candidate_infos', [])
            is_full = data.get('is_full', True)

            member_block = ''
            if member_infos:
                lines = [f"  - {m['name']} (hash: {m['hash']})" for m in member_infos]
                member_block = "Current group members:\n" + "\n".join(lines)

            candidate_block = ''
            if not is_full and candidate_infos:
                lines = [f"  - {c['name']} (hash: {c['hash']})" for c in candidate_infos]
                candidate_block = (
                    "Available characters who could join (pick ONE if you want to introduce a new arrival, "
                    "or none if the event only involves existing members):\n" + "\n".join(lines)
                )
            elif is_full:
                candidate_block = "The group is full (5/5). Do NOT introduce a new character."

            # Build session context (reuse single-chat helper)
            context_info = _gather_session_context(data, personas)

            # Append group-specific context
            extra_parts = []
            if member_block:
                extra_parts.append(member_block)
            if candidate_block:
                extra_parts.append(candidate_block)
            if data.get('all_character_info_summary'):
                extra_parts.append(
                    f"<all_characters_summary>\n{data['all_character_info_summary']}\n</all_characters_summary>"
                )

            extra_context = "\n\n".join(extra_parts)
            prompt = _build_scripting_prompt(
                rule_content,
                context_info,
                extra_context + "\n\nGenerate a random event NOW for this group scene."
            )

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except Exception:
                pass

            def generate():
                from integrations.openai import get_client
                try:
                    client = get_client(provider="ollama")
                    response = client.chat.completions.create(
                        model=model,
                        messages=[{'role': 'user', 'content': prompt}],
                        stream=True,
                        **kwargs
                    )
                    for chunk in response:
                        content = (
                            chunk.choices[0].delta.content
                            if getattr(chunk, 'choices', None) and chunk.choices[0].delta
                            else None
                        )
                        if content:
                            yield content
                except Exception as e:
                    yield f"\n[Error: {e}]"
                finally:
                    try:
                        import urllib.request
                        req = urllib.request.Request(
                            "http://localhost:11434/api/generate",
                            data=json.dumps({"model": model, "keep_alive": 0}).encode("utf-8"),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=5) as res:
                            pass
                    except Exception:
                        pass

            return Response(stream_with_context(generate()), mimetype='text/plain')

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/scripting/auto_scene', methods=['POST'])
    def generate_auto_scene():
        """Auto-generate a scene from chat context (used when creating scene from chat)."""
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            # Get the "World builder" system instruction
            rule_content = plugin.get_rule_content(user_hash, 'world_builder')

            # Gather session context
            personas = plugin.get_all_personas(user_hash)
            context_info = _gather_session_context(data, personas)

            prompt = _build_scripting_prompt(
                rule_content,
                context_info,
                "Based on the current conversation context, write a scene description that captures "
                "the current setting and atmosphere. Also suggest a short scene name (max 3 words) on the "
                "first line prefixed with 'NAME: ', then write the full scene description after a blank line."
            )

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except:
                pass

            def generate():
                from integrations.openai import get_client
                try:
                    client = get_client(provider="ollama")
                    response = client.chat.completions.create(
                        model=model,
                        messages=[{'role': 'user', 'content': prompt}],
                        stream=True,
                        **kwargs
                    )
                    for chunk in response:
                        content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                        if content:
                            yield content
                except Exception as e:
                    yield f"\n[Error: {e}]"
                finally:
                    try:
                        import urllib.request
                        req = urllib.request.Request(
                            "http://localhost:11434/api/generate",
                            data=json.dumps({"model": model, "keep_alive": 0}).encode("utf-8"),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=5) as res:
                            pass
                    except:
                        pass

            return Response(stream_with_context(generate()), mimetype='text/plain')

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500
