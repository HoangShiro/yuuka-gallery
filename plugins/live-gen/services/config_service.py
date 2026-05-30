class ConfigService:
    CONFIG_FILENAME = "live_gen_config.json"
    
    DEFAULT_CONFIG = {
        "server_address": "127.0.0.1:8888",
        "ckpt_name": "waiNSFWIllustrious_v170.safetensors",
        "quality": "masterpiece, best quality, highres, amazing quality",
        "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
        "batch_size": 1,
        "height": 1216,
        "width": 832,
        "cfg": 3,
        "sampler_name": "euler_ancestral",
        "scheduler": "beta",
        "steps": 12,
        "seed": 123456789,
        "lora_name": "None",
        "lora_strength_model": 0.9,
        "lora_strength_clip": 1.0,
        "hires_enabled": False,
        "hires_stage2_steps": 12,
        "lora_prompt_tags": [],
        "i2i_keep_denoise": 0.45,
        "i2i_refine_denoise": 0.25,
        "llm_provider": "gemini",
        "llm_domain": "",
        "llm_api_key": "",
        "llm_model": "gemini-2.5-flash",
        "llm_temperature": 0.7,
        "llm_instruction": "You are a Danbooru-style Booru tags optimizer and expander for Anime Illustrious models. Analyze the user's existing tags and their style preferences. Suggest up to 15-20 additional high-quality Booru tags to expand the scene (clothing details, camera angle, lighting, background, artistic style, character expression). CRITICAL RULES: 1. Return ONLY the new tags, separated by commas, starting with a comma. No explanations, no conversational text, no markdown. 2. Optimize for high-quality Booru tags (e.g., 'masterpiece, best quality, depth of field'). 3. If the input contains only one character or no characters, prioritize keeping it to a SINGLE character scene (e.g., '1girl, solo' or '1boy, solo') and expand on their actions, features, or background. Do NOT add other characters.",
        "llm_user_preferences": "",
        "llm_enabled": False,
        "llm_suggestions_enabled": True,
        "llm_pref_trigger_interval": 10,
        "llm_disable_thinking": False,
    }

    def __init__(self, core_api):
        self.core_api = core_api

    def get_config(self):
        global_comfy = self.core_api.read_data("comfyui_config.json", default_value={})
        saved = self.core_api.read_data(self.CONFIG_FILENAME, default_value={})
        config = {
            **self.DEFAULT_CONFIG,
            **self.sanitize_config(global_comfy),
            **self.sanitize_config(saved),
        }
        return config

    def save_config(self, data):
        config = self.get_config()
        config.update(self.sanitize_config(data))
        self.core_api.save_data(config, self.CONFIG_FILENAME)
        return config

    def sanitize_config(self, config):
        if not isinstance(config, dict):
            return {}
        allowed = set(self.DEFAULT_CONFIG.keys()) | {
            "_workflow_type",
            "workflow_type",
            "workflow_template",
            "lora_chain",
            "lora_names",
            "multi_lora_prompt_groups",
            "multi_lora_prompt_tags",
            "hires_base_width",
            "hires_base_height",
            "hires_stage1_denoise",
            "hires_stage2_steps",
            "hires_stage2_cfg",
            "hires_stage2_sampler_name",
            "hires_stage2_scheduler",
            "hires_stage2_denoise",
            "hires_upscale_model",
            "hires_upscale_method",
            "preview_mode",
            "_input_image_name",
            "denoise",
        }
        result = {key: value for key, value in config.items() if key in allowed}

        int_keys = ("seed", "steps", "width", "height", "batch_size", "hires_base_width", "hires_base_height", "hires_stage2_steps", "llm_pref_trigger_interval")
        for key in int_keys:
            if key in result:
                try:
                    value = int(result[key])
                    if key != "seed" and key != "llm_pref_trigger_interval" and value <= 0:
                        continue
                    if key == "llm_pref_trigger_interval" and (value < 0 or value > 100):
                        continue
                    if key == "hires_stage2_steps" and value > 12:
                        value = 12
                    result[key] = value
                except (TypeError, ValueError):
                    result.pop(key, None)

        float_keys = ("cfg", "lora_strength_model", "lora_strength_clip", "hires_stage1_denoise", "hires_stage2_cfg", "hires_stage2_denoise", "denoise", "i2i_keep_denoise", "i2i_refine_denoise", "llm_temperature")
        for key in float_keys:
            if key in result:
                try:
                    result[key] = float(result[key])
                except (TypeError, ValueError):
                    result.pop(key, None)

        if "hires_enabled" in result:
            value = result["hires_enabled"]
            if isinstance(value, str):
                result["hires_enabled"] = value.strip().lower() in ("1", "true", "yes", "on")
            else:
                result["hires_enabled"] = bool(value)

        if "llm_enabled" in result:
            value = result["llm_enabled"]
            if isinstance(value, str):
                result["llm_enabled"] = value.strip().lower() in ("1", "true", "yes", "on")
            else:
                result["llm_enabled"] = bool(value)

        if "llm_suggestions_enabled" in result:
            value = result["llm_suggestions_enabled"]
            if isinstance(value, str):
                result["llm_suggestions_enabled"] = value.strip().lower() in ("1", "true", "yes", "on")
            else:
                result["llm_suggestions_enabled"] = bool(value)

        if "llm_disable_thinking" in result:
            value = result["llm_disable_thinking"]
            if isinstance(value, str):
                result["llm_disable_thinking"] = value.strip().lower() in ("1", "true", "yes", "on")
            else:
                result["llm_disable_thinking"] = bool(value)

        return result
