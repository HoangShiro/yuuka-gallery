from flask import jsonify, request, Response, stream_with_context
import urllib.request
import json
import os

def _ollama_web_search(query: str) -> str:
    """Uses Ollama's Official Web Search API to get real-time context."""
    try:
        api_key = os.getenv("OLLAMA_API_KEY", "")
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            
        # Try to resolve from core configurations if not in env
        try:
            from integrations.openai import resolve_provider_config
            config = resolve_provider_config(provider='ollama')
            if config.api_key and config.api_key != 'ollama':
                headers["Authorization"] = f"Bearer {config.api_key}"
            elif config.extra_headers and 'Authorization' in config.extra_headers:
                headers.update(config.extra_headers)
        except Exception:
            pass

        req = urllib.request.Request(
            "https://ollama.com/api/web_search",
            data=json.dumps({"query": query}).encode("utf-8"),
            headers=headers,
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=8) as res:
            data = json.loads(res.read().decode("utf-8"))
            results = data.get("results", [])
            if not results:
                return ""
            snippets = [f"- {r.get('title', 'No Title')}: {r.get('snippet', '')}" for r in results[:5]]
            return "\n\n[Real-time Web Search Context for the character]\n" + "\n".join(snippets) + "\n[/Real-time Context]\n\n"
    except Exception as e:
        print(f"[Ollama Search Error] {e}")
        return ""

def _build_persona_prompt(data, plugin=None, user_hash=None):
    char_name = data.get('character_name', 'System')
    char_persona = data.get('character_persona', '')
    char_appearance = data.get('character_appearance', [])
    chat_sample = data.get('chat_sample', '')
    user_name = data.get('user_name', 'User')
    user_persona = data.get('user_persona', '')
    custom_system_prompt = data.get('system_prompt', '').strip()
    session_state = data.get('session_state', {})
    available_capabilities = data.get('available_capabilities', [])
    include_chat_system_rule = bool(data.get('include_chat_system_rule', True))
    include_chat_format_rule = bool(data.get('include_chat_format_rule', True))
    chat_system_rule_override = data.get('chat_system_rule_override', '')

    def replace_names(text):
        if not text:
            return text
        return text.replace("{{char}}", char_name).replace("{{user}}", user_name)

    prompt_parts = []

    # 1. Behavioral rules first (primacy effect — LLM reads these before anything else)
    chat_system_rule = chat_system_rule_override if isinstance(chat_system_rule_override, str) else ""
    if not chat_system_rule and include_chat_system_rule:
        chat_system_rule = plugin.get_rule_content(user_hash, 'chat_system') if plugin and user_hash else ""
    if chat_system_rule:
        prompt_parts.append(replace_names(chat_system_rule))

    chat_format_rule = plugin.get_formatted_chat_rule(user_hash, data) if include_chat_format_rule and plugin and user_hash else ""
    if chat_format_rule:
        prompt_parts.append(chat_format_rule)

    # 2. Character context
    if char_persona:
        appearance_tag = ""
        if char_appearance:
            appearance_tag = f"\n<appearance>{', '.join(char_appearance)}</appearance>"
        prompt_parts.append(f"<character_persona name=\"{char_name}\">\n{replace_names(char_persona)}{appearance_tag}\n</character_persona>")
    if user_persona:
        prompt_parts.append(f"<user_persona name=\"{user_name}\">\n{replace_names(user_persona)}\n</user_persona>")
    if chat_sample:
        prompt_parts.append(f"<example_dialogue>\n{replace_names(chat_sample)}\n</example_dialogue>")

    # 3. Situational context last (recency effect — closest to conversation history)
    if custom_system_prompt:
        prompt_parts.append(replace_names(custom_system_prompt))

    state_desc = [
        f"<current_state>",
        f"Current Location: {session_state.get('location', 'Unknown')}",
        f"Current Action: {session_state.get('action', 'Idle')}",
        f"Currently Worn Outfits: {', '.join(session_state.get('outfits', [])) or 'None'}",
        f"Inventory/Bag: {', '.join(session_state.get('inventory', [])) or 'Empty'}",
        f"</current_state>"
    ]
    prompt_parts.append("\n".join(state_desc))

    return "\n\n".join([p for p in prompt_parts if p])

def _extract_stream_chunk_text(chunk):
    try:
        if isinstance(chunk, dict):
            choices = chunk.get("choices") or []
            if choices:
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                return str(content or "")
            message = chunk.get("message") or {}
            return str(message.get("content") or chunk.get("content") or "")
        choices = getattr(chunk, "choices", None) or []
        if choices:
            delta = getattr(choices[0], "delta", None)
            content = getattr(delta, "content", None) if delta else None
            if content:
                return str(content)
            message = getattr(choices[0], "message", None)
            message_content = getattr(message, "content", None) if message else None
            if message_content:
                return str(message_content)
        return str(getattr(chunk, "content", "") or "")
    except Exception:
        return ""

def _extract_chat_text(response):
    text = ""
    if isinstance(response, dict) and "choices" in response:
        text = response["choices"][0].get("message", {}).get("content", "")
    elif hasattr(response, 'choices') and len(response.choices) > 0:
        if isinstance(response.choices[0], dict):
            text = response.choices[0].get("message", {}).get("content", "")
        else:
            text = response.choices[0].message.content
    return text or ""

def register_routes(blueprint, plugin):
    @blueprint.route('/generate/models', methods=['GET'])
    def list_models():
        try:
            plugin.core_api.verify_token_and_get_user_hash()
            from integrations import openai as openai_integration
            models = openai_integration.list_models(provider='ollama')
            return jsonify({'status': 'success', 'models': models})
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500
            
    @blueprint.route('/generate/persona', methods=['POST'])
    def generate_persona():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            name = data.get('name', 'Unknown')
            traits = data.get('traits', '') # optional user hint
            generate_sample = data.get('generate_sample', False)
            
            # Fetch context from Ollama's Official API
            search_query = f"{name} {traits} character wiki lore persona".strip()
            search_context = _ollama_web_search(search_query)
            
            base_instructions = f"Write a detailed persona description for a character named {name}. {traits} Make it at most 2 paragraphs, written from a third-person perspective."
            if search_context:
                base_instructions += f" Use the following web search results to make the persona accurate if it is a known character: {search_context}"

            if generate_sample:
                prompt = base_instructions + "\n\nAlso, provide a 'Chat Sample' of how this character talks, consisting of a few characteristic lines of dialogue. Separate the persona and chat sample with exactly this text: \n\n---CHAT_SAMPLE---\n\n"
            else:
                prompt = base_instructions
            
            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {
                'extra_body': {
                    'options': {'web_search': True} # Enable native web search if backend supports it natively
                }
            }
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1: kwargs['temperature'] = temp
            except: pass
            
            # Use Ollama provider
            response = plugin.core_api.ai_service.request(
                provider='ollama', 
                operation='chat',
                payload={
                    'model': model,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'timeout': 60,
                    'kwargs': kwargs
                },
                user_hash=user_hash
            )
            
            # Extract content from response
            text = ""
            if isinstance(response, dict) and "choices" in response:
                text = response["choices"][0].get("message", {}).get("content", "")
            elif hasattr(response, 'choices') and len(response.choices) > 0:
                if isinstance(response.choices[0], dict):
                    text = response.choices[0].get("message", {}).get("content", "")
                else:
                    text = response.choices[0].message.content
            
            if generate_sample and "---CHAT_SAMPLE---" in text:
                parts = text.split("---CHAT_SAMPLE---")
                persona_text = parts[0].strip()
                chat_sample_text = parts[1].strip()
                return jsonify({"status": "success", "persona": persona_text, "chat_sample": chat_sample_text})
                
            return jsonify({"status": "success", "persona": text.strip()})
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/generate/persona_stream', methods=['POST'])
    def generate_persona_stream():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            name = data.get('name', 'Unknown')
            traits = data.get('traits', '')
            generate_sample = data.get('generate_sample', False)
            
            # Fetch context from Ollama's Official API
            search_query = f"{name} {traits} character wiki lore persona".strip()
            search_context = _ollama_web_search(search_query)
            
            base_instructions = f"Write a detailed persona description for a character named {name}. {traits} Make it at most 2 paragraphs, written from a third-person perspective."
            if search_context:
                base_instructions += f" Use the following web search results to make the persona accurate if it is a known character: {search_context}"

            if generate_sample:
                prompt = base_instructions + "\n\nAlso, provide a 'Chat Sample' of how this character talks, consisting of a few characteristic lines of dialogue. Separate the persona and chat sample with exactly this text: \n\n---CHAT_SAMPLE---\n\n"
            else:
                prompt = base_instructions
                
            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {'extra_body': {'options': {'web_search': True}}}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1: kwargs['temperature'] = temp
            except: pass
                
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
                        import urllib.request, json
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

    @blueprint.route('/generate/chat', methods=['POST'])
    def generate_chat():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            
            messages = data.get('messages', [])
            system_prompt = _build_persona_prompt(data, plugin, user_hash)
            
            ollama_messages = [{"role": "system", "content": system_prompt}]
            ollama_messages.extend(messages)
            
            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1: kwargs['temperature'] = temp
            except: pass
            
            response = plugin.core_api.ai_service.request(
                provider='ollama', 
                operation='chat',
                payload={
                    'model': model,
                    'messages': ollama_messages,
                    'timeout': 60,
                    'kwargs': kwargs
                },
                user_hash=user_hash
            )
            
            text = ""
            if isinstance(response, dict) and "choices" in response:
                text = response["choices"][0].get("message", {}).get("content", "")
            elif hasattr(response, 'choices') and len(response.choices) > 0:
                if isinstance(response.choices[0], dict):
                    text = response.choices[0].get("message", {}).get("content", "")
                else:
                    text = response.choices[0].message.content
                
            return jsonify({"status": "success", "response": text})
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/generate/chat_stream', methods=['POST'])
    def generate_chat_stream():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json
            
            messages = data.get('messages', [])
            system_prompt = _build_persona_prompt(data, plugin, user_hash)
            
            ollama_messages = [{"role": "system", "content": system_prompt}]
            ollama_messages.extend(messages)

            print("[Chat] Final LLM input:")
            for i, m in enumerate(ollama_messages):
                role = m.get("role", "?")
                content = m.get("content", "")
                print(f"  [{i}] {role}: {content}")

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1: kwargs['temperature'] = temp
            except: pass
            
            def generate():
                from integrations.openai import get_client
                try:
                    client = get_client(provider="ollama")
                    response = client.chat.completions.create(
                        model=model,
                        messages=ollama_messages,
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
                        import urllib.request, json
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

    @blueprint.route('/generate/discord_bridge', methods=['POST'])
    def generate_discord_bridge():
        try:
            data = request.json or {}

            bridge_key = os.getenv("CHAT_BRIDGE_KEY", "").strip()
            request_bridge_key = str(request.headers.get("X-Discord-Bot-Bridge-Key", "")).strip()
            trusted_bridge = bool(bridge_key and request_bridge_key and request_bridge_key == bridge_key)

            # Allow localhost bridge requests when no bridge key is configured
            if not trusted_bridge and not bridge_key and request.remote_addr == '127.0.0.1':
                trusted_bridge = True

            if trusted_bridge:
                user_hash = str(data.get("user_hash", "")).strip()
                if not user_hash:
                    return jsonify({"error": "Missing user_hash for trusted bridge request."}), 400

                mode = data.get('mode')
                if mode in {'summarize_conversation', 'summarize_actor'}:
                    history_text = data.get('history', '')
                    if not history_text:
                        return jsonify({"status": "ignored", "reason": "empty_history"})
                    
                    if mode == 'summarize_conversation':
                        system_content = "You are a professional conversation summarizer. Summarize the provided history into a single concise paragraph (max 3 sentences). Output ONLY the summary text."
                    else:
                        actor_name = data.get('actor_name', 'This user')
                        system_content = f"You are a specialized character memory system. Summarize these recent messages from {actor_name} into a single concise paragraph of facts/traits about them. Output ONLY the summary text."

                    summarize_prompt = [
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": f"History:\n{history_text}"}
                    ]
                    
                    model = data.get('model') or 'deepseek-v3.1:671b-cloud'
                    summary_resp = plugin.core_api.ai_service.request(
                        provider='ollama', 
                        operation='chat',
                        payload={'model': model, 'messages': summarize_prompt}, 
                        user_hash=user_hash
                    )
                    summary_text = _extract_chat_text(summary_resp).strip()
                    return jsonify({"status": "success", "summary": summary_text, "mode": mode})
            else:
                user_hash = plugin.core_api.verify_token_and_get_user_hash()

            character_id = str(data.get('character_id') or '').strip()
            user_message = str(data.get('user_message') or '').strip()
            session_id = str(data.get('session_id') or '').strip()
            reset_session = bool(data.get('reset_session', False))

            if not character_id:
                return jsonify({"error": "character_id is required."}), 400

            if not session_id:
                session_id = f"bridge:{character_id}"

            personas = plugin.get_all_personas(user_hash)
            characters = personas.get("characters", {}) if isinstance(personas, dict) else {}
            users = personas.get("users", {}) if isinstance(personas, dict) else {}
            character = characters.get(character_id)
            if not character:
                return jsonify({"error": f"Character '{character_id}' not found."}), 404

            user_persona_id = data.get('user_persona_id')
            user_persona_obj = users.get(user_persona_id, {}) if user_persona_id else {}

            if reset_session:
                session_data = {
                    "id": session_id,
                    "messages": [],
                    "discord_context": data.get('discord_context', {}),
                    "updated_at": 0,
                }
                saved = plugin.save_session(user_hash, character_id, session_id, session_data)
                return jsonify({"status": "success", "session_id": saved.get("id", session_id), "reset": True})

            if not user_message:
                return jsonify({"error": "user_message is required."}), 400

            existing_session = plugin.get_session(user_hash, character_id, session_id) or {}
            history = list(existing_session.get('messages') or [])

            discord_context = data.get('discord_context', {})
            if not isinstance(discord_context, dict):
                discord_context = {}

            # JS puts base info in the 'base' dictionary
            base_ctx = discord_context.get('base', {})
            guild_name = str(base_ctx.get('guild_name') or discord_context.get('guild_name') or 'DM')
            channel_name = str(base_ctx.get('channel_name') or discord_context.get('channel_name') or 'unknown-channel')
            author_tag = str(base_ctx.get('author_tag') or discord_context.get('author_tag') or data.get('user_name') or 'User')
            author_name = str(base_ctx.get('author_name') or author_tag)

            if not user_message.startswith(f"{author_name}: "):
                user_message = f"{author_name}: {user_message}"

            user_turn = {
                'role': 'user',
                'content': user_message,
            }
            history.append(user_turn)

            compact_history = []
            for m in history:
                if isinstance(m, dict) and m.get('role') in {'system', 'user', 'assistant'} and m.get('content'):
                    compact_history.append(dict(m))
            compact_history = compact_history[-24:]

            author_id = str(base_ctx.get('author_id') or discord_context.get('author_id') or 'unknown')
            memo_ctx = discord_context.get('long_memo_context', {})
            info_ctx = discord_context.get('info_context', {})
            event_ctx = discord_context.get('event_context') or {}
            
            # Enrich the actual user prompt rather than the system prompt
            if compact_history and compact_history[-1]['role'] == 'user':
                user_info_lines = [
                    "",
                    "<user_info>",
                    f"Name: {author_name}",
                    f"Discord UID: {author_id}"
                ]
                actor_global = (memo_ctx.get('actor_global_summary') or {}).get('summary')
                if actor_global:
                    user_info_lines.append(f"Fact about {author_name}: {actor_global}")
                reply_ref = event_ctx.get('reply_reference')
                if reply_ref and isinstance(reply_ref, dict):
                    ref_name = reply_ref.get('display_name', 'someone')
                    ref_content = reply_ref.get('content', '')
                    if ref_content:
                        user_info_lines.append(f'{author_name} is referring to {ref_name}\'s message with content "{ref_content}".')
                current_time = str(info_ctx.get('current_time') or '').strip()
                if current_time:
                    user_info_lines.append(f"Current time: {current_time}")
                user_info_lines.append("</user_info>")
                compact_history[-1]['content'] += "\n".join(user_info_lines)

            # Extract memory context elements
            facts = discord_context.get('selected_facts', [])

            ctx_lines = [
                "<discord_context>",
                f"Guild/Server: {guild_name}",
                f"Channel: {channel_name}",
            ]

            # Format context blocks
            bot_voice = info_ctx.get('bot_voice')
            user_voice = info_ctx.get('user_voice')
            
            if bot_voice:
                b_members = bot_voice.get('members', [])
                b_member_names = [m.get('display_name') for m in b_members if not m.get('is_bot')]
                b_member_str = f"along with humans: {', '.join(b_member_names)}" if b_member_names else "with no humans"
                ctx_lines.append(f"Your Voice State (Bot): Currently joined in '{bot_voice.get('channel_name')}' {b_member_str}.")
            else:
                ctx_lines.append(f"Your Voice State (Bot): NOT joined in any voice channel.")
                
            if user_voice:
                ctx_lines.append(f"User's Voice State: User is currently in '{user_voice.get('channel_name')}'.")
            else:
                ctx_lines.append(f"User's Voice State: User is NOT in any voice channel.")

            voice_status = info_ctx.get('voice_status')
            if voice_status:
                music_ch = voice_status.get('music') or {}
                m_vol = voice_status.get('music_volume', 50)
                speak_vol = voice_status.get('speak_volume', 100)
                
                playing_text = ""
                m_now = music_ch.get('now_playing')
                if m_now:
                    m_meta = m_now.get('metadata') or {}
                    m_title = m_meta.get('title') or m_now.get('id')
                    playing_text = f"Playing music: '{m_title}'."
                else:
                    playing_text = "No music playing."
                    
                ctx_lines.append(f"Voice Queue State: {playing_text} (Current Volumes: Speak={speak_vol}%, Music={m_vol}%)")

            conv_summary = (memo_ctx.get('conversation_summary') or {}).get('summary')
            if conv_summary:
                ctx_lines.append(f"Conversation Summary: {conv_summary}")

            actor_summaries = memo_ctx.get('actor_summaries', [])
            relevant_participants = [a for a in actor_summaries if str(a.get('actor_uid')) != author_id]
            if relevant_participants:
                ctx_lines.append("Recent Participants in channel:")
                for p in relevant_participants:
                    p_name = p.get('actor_name') or f"User-{p.get('actor_uid')}"
                    p_summ = p.get('summary')
                    if p_summ:
                        ctx_lines.append(f" - {p_name}: {p_summ}")

            if facts and isinstance(facts, list):
                ctx_lines.append("Recent Environment Facts:")
                for fact in facts[:5]:
                    ctx_lines.append(f" - {fact.get('value', '')}")

            attachments = event_ctx.get('attachments')
            if attachments and isinstance(attachments, list):
                ctx_lines.append("Latest Message Attachments:")
                for attachment in attachments[:4]:
                    if not isinstance(attachment, dict):
                        continue
                    file_name = str(attachment.get('name') or 'unnamed file').strip()
                    file_type = str(attachment.get('content_type') or attachment.get('type') or 'unknown').strip()
                    file_url = str(attachment.get('url') or '').strip()
                    is_audio = bool(attachment.get('is_audio'))
                    label = f" - {'audio' if is_audio else 'file'}: {file_name} ({file_type})"
                    if file_url:
                        label += f" URL: {file_url}"
                    ctx_lines.append(label)

            abilities_ctx = discord_context.get('abilities_context', {})
            abilities_html = abilities_ctx.get('abilities_html')
            if abilities_html:
                ctx_lines.append(abilities_html)

            ctx_lines.append("</discord_context>")

            bridge_system = "\n".join(ctx_lines)

            prompt_data = {
                'character_name': character.get('name', 'Character'),
                'character_persona': character.get('persona', ''),
                'character_appearance': character.get('appearance', []),
                'chat_sample': character.get('chat_sample', ''),
                'user_name': data.get('user_name') or author_tag,
                'user_persona': user_persona_obj.get('persona', '') if isinstance(user_persona_obj, dict) else '',
                'system_prompt': bridge_system,
                'session_state': data.get('session_state') or {},
            }
            discord_rule_data = {
                'primary_language': data.get('primary_language') or data.get('language_primary') or 'English',
                'secondary_language': data.get('secondary_language') or data.get('language_secondary') or 'Japanese',
            }
            discord_system_rule = plugin.get_formatted_discord_chat_rule(user_hash, discord_rule_data) if plugin and user_hash else ""
            prompt_data['include_chat_format_rule'] = False
            if discord_system_rule:
                prompt_data['chat_system_rule_override'] = discord_system_rule
            system_prompt = _build_persona_prompt(prompt_data, plugin, user_hash)

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1:
                    kwargs['temperature'] = temp
            except Exception:
                pass

            llm_messages = [{'role': 'system', 'content': system_prompt}]
            llm_messages.extend(compact_history)

            record_only = bool(data.get('record_only', False))
            if record_only:
                # Still save session with user message but without assistant message
                session_data = {
                    'id': session_id,
                    'messages': history[-40:],
                    'discord_context': discord_context,
                }
                saved_session = plugin.save_session(user_hash, character_id, session_id, session_data)
                
                if bool(data.get('stream', False)):
                    def dummy_generate():
                        yield json.dumps({
                            "event": "start",
                            "session_id": saved_session.get('id', session_id),
                            "character_id": character_id,
                        }, ensure_ascii=False) + "\n"
                        yield json.dumps({
                            "event": "delta",
                            "content": "[IGNORE]",
                        }, ensure_ascii=False) + "\n"
                        yield json.dumps({
                            "event": "complete",
                            "status": "success",
                            "session_id": saved_session.get('id', session_id),
                            "character_id": character_id,
                            "response": "[IGNORE]",
                            "llm_input": llm_messages,
                        }, ensure_ascii=False) + "\n"
                    return Response(stream_with_context(dummy_generate()), mimetype='application/x-ndjson')
                
                return jsonify({
                    "status": "success",
                    "session_id": saved_session.get('id', session_id),
                    "character_id": character_id,
                    "response": "[IGNORE]",
                    "llm_input": llm_messages,
                })

            stream_response = bool(data.get('stream', False))
            if stream_response:
                def generate():
                    accumulated = []
                    yield json.dumps({
                        "event": "start",
                        "session_id": session_id,
                        "character_id": character_id,
                    }, ensure_ascii=False) + "\n"
                    try:
                        from integrations.openai import get_client
                        client = get_client(provider="ollama")
                        response = client.chat.completions.create(
                            model=model,
                            messages=llm_messages,
                            stream=True,
                            timeout=60,
                            **kwargs,
                        )
                        for chunk in response:
                            content = _extract_stream_chunk_text(chunk)
                            if not content:
                                continue
                            accumulated.append(content)
                            yield json.dumps({
                                "event": "delta",
                                "content": content,
                            }, ensure_ascii=False) + "\n"
                        text = ''.join(accumulated).strip()
                        if not text:
                            yield json.dumps({"event": "error", "error": "Empty response from model."}, ensure_ascii=False) + "\n"
                            return
                        
                        # Only save assistant message if [IGNORE] is NOT present in the raw response
                        if "[IGNORE]" not in text:
                            history.append({'role': 'assistant', 'content': text})
                            session_data = {
                                'id': session_id,
                                'messages': history[-40:],
                                'discord_context': discord_context,
                            }
                            saved_session = plugin.save_session(user_hash, character_id, session_id, session_data)
                            current_session_id = saved_session.get('id', session_id)
                        else:
                            # Still save session with user message but without assistant message
                            session_data = {
                                'id': session_id,
                                'messages': history[-40:],
                                'discord_context': discord_context,
                            }
                            saved_session = plugin.save_session(user_hash, character_id, session_id, session_data)
                            current_session_id = saved_session.get('id', session_id)

                        yield json.dumps({
                            "event": "complete",
                            "status": "success",
                            "session_id": current_session_id,
                            "character_id": character_id,
                            "response": text,
                            "llm_input": llm_messages,
                        }, ensure_ascii=False) + "\n"
                    except Exception as e:
                        yield json.dumps({"event": "error", "error": str(e)}, ensure_ascii=False) + "\n"
                return Response(stream_with_context(generate()), mimetype='application/x-ndjson')

            response = plugin.core_api.ai_service.request(
                provider='ollama',
                operation='chat',
                payload={
                    'model': model,
                    'messages': llm_messages,
                    'timeout': 60,
                    'kwargs': kwargs,
                },
                user_hash=user_hash,
            )
            text = _extract_chat_text(response).strip()

            if not text:
                return jsonify({"error": "Empty response from model."}), 502

            # Only save assistant message if [IGNORE] is NOT present in the raw response
            if "[IGNORE]" not in text:
                history.append({'role': 'assistant', 'content': text})
            
            session_data = {
                'id': session_id,
                'messages': history[-40:],
                'discord_context': discord_context,
            }
            saved_session = plugin.save_session(user_hash, character_id, session_id, session_data)

            return jsonify({
                "status": "success",
                "session_id": saved_session.get('id', session_id),
                "character_id": character_id,
                "response": text,
                "llm_input": llm_messages,
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/generate/summarize_memory', methods=['POST'])
    def summarize_memory():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            current_summary = data.get('current_summary', '')
            new_messages = data.get('new_messages', [])

            if not new_messages:
                return jsonify({"status": "success", "summary": current_summary})

            messages_text = ""
            for m in new_messages:
                role = "User" if m.get("role") == "user" else "Assistant"
                messages_text += f"{role}: {m.get('content', '')}\n"

            prompt = (
                "You are tasked with updating a continuous memory summary of a specific chat session.\n"
                "Your objective is to preserve important facts, established character traits, events, and key context.\n\n"
            )
            if current_summary:
                prompt += f"CURRENT SUMMARY:\n{current_summary}\n\n"
            prompt += (
                f"NEW MESSAGES TO INCORPORATE:\n{messages_text}\n\n"
                "INSTRUCTIONS:\n"
                "Write a concisely updated summary that includes the previous summary's key points and incorporates any new important details from the new messages.\n"
                "Do NOT write a narrative or script. Keep it purely as a factual and contextual reference.\n"
                "Also generate a short name (max 8 words) that captures the essence of this memory.\n"
                "Return your response in this EXACT format (no extra lines before NAME:):\n"
                "NAME: <short name here>\n"
                "<summary text here>"
            )

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1: kwargs['temperature'] = temp
            except: pass

            response = plugin.core_api.ai_service.request(
                provider='ollama',
                operation='chat',
                payload={
                    'model': model,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'timeout': 60,
                    'kwargs': kwargs
                },
                user_hash=user_hash
            )

            text = ""
            if isinstance(response, dict) and "choices" in response:
                text = response["choices"][0].get("message", {}).get("content", "")
            elif hasattr(response, 'choices') and len(response.choices) > 0:
                if isinstance(response.choices[0], dict):
                    text = response.choices[0].get("message", {}).get("content", "")
                else:
                    text = response.choices[0].message.content

            return jsonify({"status": "success", "summary": text.strip()})

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    @blueprint.route('/generate/summarize_memory_stream', methods=['POST'])
    def summarize_memory_stream():
        try:
            user_hash = plugin.core_api.verify_token_and_get_user_hash()
            data = request.json

            current_summary = data.get('current_summary', '')
            new_messages = data.get('new_messages', [])

            if not new_messages:
                return Response(current_summary or '', mimetype='text/plain')

            messages_text = ""
            for m in new_messages:
                role = "User" if m.get("role") == "user" else "Assistant"
                messages_text += f"{role}: {m.get('content', '')}\n"

            prompt = (
                "You are tasked with updating a continuous memory summary of a specific chat session.\n"
                "Your objective is to preserve important facts, established character traits, events, and key context.\n\n"
            )
            if current_summary:
                prompt += f"CURRENT SUMMARY:\n{current_summary}\n\n"
            prompt += (
                f"NEW MESSAGES TO INCORPORATE:\n{messages_text}\n\n"
                "INSTRUCTIONS:\n"
                "Write a concisely updated summary that includes the previous summary's key points and incorporates any new important details from the new messages.\n"
                "Do NOT write a narrative or script. Keep it purely as a factual and contextual reference.\n"
                "Also generate a short name (max 8 words) that captures the essence of this memory.\n"
                "Return your response in this EXACT format (no extra lines before NAME:):\n"
                "NAME: <short name here>\n"
                "<summary text here>"
            )

            model = data.get('model') or 'deepseek-v3.1:671b-cloud'
            kwargs = {}
            try:
                temp = float(data.get('temperature', -1))
                if temp != -1: kwargs['temperature'] = temp
            except: pass

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


