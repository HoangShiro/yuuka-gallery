from flask import jsonify, request, abort, Response, stream_with_context
import json

def register_routes(blueprint, plugin):
    SETTINGS_PROMPTS_FILENAME = "album_settings_sys_prompts.json"

    def _get_sys_prompts():
        try:
            return plugin.core_api.read_data(SETTINGS_PROMPTS_FILENAME)
        except Exception:
            return {
                "sys_prompt": "You are a creative and expert prompt generator. Create highly detailed and cinematic booru tags for the character's outfits, expression, action, and context based on the user's description. Use rich, varied vocabulary and focus on visual aesthetics.",
                "sys_prompt_secondary": "",
                "sys_prompt_active_tab": "primary",
                "enabled_fields": {"outfits": True, "expression": True, "action": True, "context": True}
            }

    def _save_sys_prompts(data):
        try:
            plugin.core_api.save_data(data, SETTINGS_PROMPTS_FILENAME)
        except Exception as e:
            print(f"Error saving settings sys prompts: {e}")
        return data

    @blueprint.route('/<character_hash>/settings/sys_prompts', methods=['GET'])
    def get_settings_sys_prompts(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        return jsonify(_get_sys_prompts())

    @blueprint.route('/<character_hash>/settings/sys_prompts', methods=['POST'])
    def save_settings_sys_prompts(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing config data.")
        saved = _save_sys_prompts(data)
        return jsonify({"status": "success", "config": saved})

    @blueprint.route('/<character_hash>/settings/prompt_generate', methods=['POST'])
    def settings_prompt_generate(character_hash):
        plugin.core_api.verify_token_and_get_user_hash()
        data = request.json
        if not data:
            abort(400, description="Missing data.")
        user_prompt = data.get("prompt", "")
        
        sys_data = _get_sys_prompts()
        active_tab = sys_data.get("sys_prompt_active_tab", "primary")
        if active_tab == "secondary":
            sys_prompt_content = sys_data.get("sys_prompt_secondary", "").strip()
        else:
            sys_prompt_content = sys_data.get("sys_prompt", "").strip()
            
        enabled_fields = sys_data.get("enabled_fields", {})
        use_current_tags = enabled_fields.get("use_current_tags", True)
        current_tags = data.get("current_tags", {})
        
        # Determine the target JSON structure based on enabled fields
        keys_to_generate = [k for k, v in enabled_fields.items() if v and k != "use_current_tags"]
        if not keys_to_generate:
            # Fallback to defaults if empty
            keys_to_generate = ["outfits", "expression", "action", "context"]

        target_json_schema = "{\n"
        for k in keys_to_generate:
            target_json_schema += f'  "{k}": "comma-separated tags",\n'
        target_json_schema = target_json_schema.rstrip(",\n") + "\n}"

        hardcoded_instruction = f"""You are an AI generating booru-style tags.
You MUST output your response as a raw JSON object matching this schema exactly:
{target_json_schema}
Do NOT output any markdown, explanations, or code blocks like ```json.
Output ONLY the raw JSON object string.
Convert the user's request into precise, descriptive booru tags for each category.
Return the result immediately."""
        
        final_sys_prompt = f"{hardcoded_instruction}\n\nAdditional instructions:\n{sys_prompt_content}" if sys_prompt_content else hardcoded_instruction
        
        if use_current_tags and any(current_tags.values()):
            reference_tags_str = "\n".join([f"- {k.capitalize()}: {v}" for k, v in current_tags.items() if v])
            final_sys_prompt += f"\n\nReference Tags (The user currently has these tags configured. Use them as inspiration, expand upon them, or refine them as part of your generation. Ignore them if they contradict the user's request):\n{reference_tags_str}"
        
        def generate():
            from integrations.openai import get_client
            try:
                client = get_client(provider="ollama")
                response = client.chat.completions.create(
                    model="deepseek-v3.1:671b-cloud",
                    messages=[
                        {"role": "system", "content": final_sys_prompt},
                        {"role": "user", "content": f"User's request or short description: {user_prompt}" if user_prompt else "Create a random high-quality character description focusing on outfits, expression, action, and context."}
                    ],
                    stream=True
                )
                for chunk in response:
                    content = chunk.choices[0].delta.content if getattr(chunk, 'choices', None) and chunk.choices[0].delta else None
                    if content:
                        yield content
            except Exception as e:
                yield f"\n<CLEAR>Error: {e}"
            finally:
                try:
                    import urllib.request, json
                    req = urllib.request.Request(
                        "http://localhost:11434/api/generate",
                        data=json.dumps({"model": "deepseek-v3.1:671b-cloud", "keep_alive": 0}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=5) as res:
                        pass
                except:
                    pass

        return Response(stream_with_context(generate()), mimetype='text/plain')
