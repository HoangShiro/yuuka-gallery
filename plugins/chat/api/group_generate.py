from flask import jsonify, request, Response, stream_with_context
import json

from ..services.group_context import GroupContextBuilder
from ..services.group_summary import CharacterSummaryService


def register_routes(blueprint, plugin):

    @blueprint.route('/generate/group_chat_stream', methods=['POST'])
    def group_chat_stream():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            group_id = data.get('group_id')
            response_mode = data.get('response_mode', 'default')
            main_char_hash = data.get('main_char_hash')
            model = data.get('model') or 'deepseek-v3.1:671b-cloud'

            # Load group session
            group_session = plugin.get_group_session(user_hash, group_id)
            if not group_session:
                return jsonify({'error': 'Group session not found'}), 404

            # Load all personas (characters only — get_all_personas returns {"characters": {}, "users": {}})
            all_personas = plugin.get_all_personas(user_hash).get('characters', {})
            print(f"[GroupChat] main_char_hash={main_char_hash}, all_personas keys (first 5)={list(all_personas.keys())[:5]}")

            # Resolve user persona
            user_persona_text = data.get('user_persona', '')
            user_name = data.get('user_name', 'User')
            user_persona = {'name': user_name, 'persona': user_persona_text}

            # Merge request data into group_session for context building
            session_for_context = dict(group_session)
            # Use session_messages from frontend if provided (contains latest user message
            # that may not be saved to disk yet)
            if data.get('session_messages') is not None:
                session_for_context['messages'] = data['session_messages']
            if data.get('system_prompt'):
                session_for_context['memory_summary'] = data['system_prompt']
            if data.get('scene_ids') is not None:
                session_for_context['scenes'] = data['scene_ids']
            if data.get('all_character_info_summary'):
                session_for_context['all_character_info_summary'] = data['all_character_info_summary']
            # Ensure member_hashes is available for fallback persona lookup
            if data.get('member_hashes'):
                session_for_context['member_hashes'] = data['member_hashes']
            session_for_context['is_first_message'] = bool(data.get('is_first_message', False))
            session_for_context['is_continue'] = bool(data.get('is_continue', False))

            # Build context
            builder = GroupContextBuilder(plugin)
            system_prompt, messages = builder.build_default_mode_context(
                user_hash=user_hash,
                group_session=session_for_context,
                main_char_hash=main_char_hash,
                all_personas=all_personas,
                user_persona=user_persona,
                data=data,
            )

            ollama_messages = [{'role': 'system', 'content': system_prompt}]
            ollama_messages.extend(messages)

            # Sanitize: ensure all content is string, merge consecutive same-role messages
            sanitized = [ollama_messages[0]]  # keep system message
            for m in ollama_messages[1:]:
                content = m.get('content', '')
                if not isinstance(content, str):
                    content = str(content)
                role = m.get('role', 'user')
                if sanitized and sanitized[-1]['role'] == role and role != 'system':
                    sanitized[-1]['content'] += '\n' + content
                else:
                    sanitized.append({'role': role, 'content': content})
            ollama_messages = sanitized

            print("[GroupChat] Final LLM input:")
            for i, m in enumerate(ollama_messages):
                print(f"  [{i}] {m.get('role', '?')}: {m.get('content', '')}")

            print(f"[GroupChat] all_character_info_summary in session_for_context: {repr(session_for_context.get('all_character_info_summary', '')[:80])}")
            print(f"[GroupChat] member_hashes in session_for_context: {session_for_context.get('member_hashes', [])}")

            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except Exception:
                pass

            def generate():
                from integrations.openai import get_client
                accumulated = []
                try:
                    client = get_client(provider='ollama')
                    response = client.chat.completions.create(
                        model=model,
                        messages=ollama_messages,
                        stream=True,
                        **kwargs,
                    )
                    for chunk in response:
                        content = (
                            chunk.choices[0].delta.content
                            if getattr(chunk, 'choices', None) and chunk.choices[0].delta
                            else None
                        )
                        if content:
                            accumulated.append(content)
                            yield content
                except GeneratorExit:
                    # Stream aborted — keep whatever was generated (do nothing extra)
                    pass
                except Exception as e:
                    yield f'\n[Error: {e}]'
                finally:
                    try:
                        import urllib.request
                        req = urllib.request.Request(
                            'http://localhost:11434/api/generate',
                            data=json.dumps({'model': model, 'keep_alive': 0}).encode('utf-8'),
                            headers={'Content-Type': 'application/json'},
                            method='POST',
                        )
                        with urllib.request.urlopen(req, timeout=5):
                            pass
                    except Exception:
                        pass

            return Response(stream_with_context(generate()), mimetype='text/plain')

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500

    @blueprint.route('/generate/group_character_summary', methods=['POST'])
    def group_character_summary():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            group_id = data.get('group_id')
            member_hashes = data.get('member_hashes', [])
            model = data.get('model') or 'deepseek-v3.1:671b-cloud'

            all_personas = plugin.get_all_personas(user_hash).get('characters', {})

            service = CharacterSummaryService(plugin)
            summary = service.generate_all_character_info_summary(
                user_hash=user_hash,
                member_hashes=member_hashes,
                all_personas=all_personas,
                model=model,
            )

            return jsonify({'status': 'success', 'summary': summary})

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500

    @blueprint.route('/generate/group_character_summary_per_char', methods=['POST'])
    def group_character_summary_per_char():
        """
        Tóm tắt persona từng character riêng lẻ.
        Body: { char_hashes: [hash, ...], model: str }
        Returns: { summaries: { hash: summary_text } }
        """
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            char_hashes = data.get('char_hashes', [])
            model = data.get('model') or 'deepseek-v3.1:671b-cloud'

            all_personas = plugin.get_all_personas(user_hash).get('characters', {})

            service = CharacterSummaryService(plugin)
            summaries = service.generate_per_character_summaries(
                user_hash=user_hash,
                char_hashes=char_hashes,
                all_personas=all_personas,
                model=model,
            )

            return jsonify({'status': 'success', 'summaries': summaries})

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500
