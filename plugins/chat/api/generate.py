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

    def replace_names(text):
        if not text:
            return text
        return text.replace("{{char}}", char_name).replace("{{user}}", user_name)

    prompt_parts = []

    # 1. Behavioral rules first (primacy effect — LLM reads these before anything else)
    chat_system_rule = plugin.get_rule_content(user_hash, 'chat_system') if plugin and user_hash else ""
    if chat_system_rule:
        prompt_parts.append(replace_names(chat_system_rule))

    chat_format_rule = plugin.get_formatted_chat_rule(user_hash, data) if plugin and user_hash else ""
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

    return "\n\n".join(prompt_parts)

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


