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
        "lora_prompt_tags": [],
        "i2i_keep_denoise": 0.45,
        "i2i_refine_denoise": 0.25,
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

        int_keys = ("seed", "steps", "width", "height", "batch_size", "hires_base_width", "hires_base_height", "hires_stage2_steps")
        for key in int_keys:
            if key in result:
                try:
                    value = int(result[key])
                    if key != "seed" and value <= 0:
                        continue
                    result[key] = value
                except (TypeError, ValueError):
                    result.pop(key, None)

        float_keys = ("cfg", "lora_strength_model", "lora_strength_clip", "hires_stage1_denoise", "hires_stage2_cfg", "hires_stage2_denoise", "denoise", "i2i_keep_denoise", "i2i_refine_denoise")
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

        return result
