"""Mixin for I2V (Image-to-Video) settings management per character album."""
from __future__ import annotations


class AlbumI2VMixin:
    """Mixin providing I2V settings helpers for AlbumPlugin."""

    def _get_i2v_config(self, character_hash: str) -> dict:
        """Read I2V config for a specific character album."""
        all_configs = self.core_api.read_data(self.I2V_CONFIG_FILENAME)
        char_config = all_configs.get(character_hash, {})
        return {**self.I2V_DEFAULT_CONFIG, **char_config}

    def _save_i2v_config(self, character_hash: str, config: dict):
        """Save I2V config for a specific character album."""
        all_configs = self.core_api.read_data(self.I2V_CONFIG_FILENAME)
        sanitized = {}
        if "prompt" in config:
            sanitized["prompt"] = str(config["prompt"])
        if "seconds" in config:
            val = int(config["seconds"])
            sanitized["seconds"] = val if val in (2, 3, 4, 5) else self.I2V_DEFAULT_CONFIG["seconds"]
        if "fps" in config:
            val = int(config["fps"])
            sanitized["fps"] = val if val in (16, 24) else self.I2V_DEFAULT_CONFIG["fps"]
        if "enable_loop" in config:
            sanitized["enable_loop"] = bool(config["enable_loop"])
        if "enable_interpolation" in config:
            sanitized["enable_interpolation"] = bool(config["enable_interpolation"])
        if "resolution" in config:
            val = str(config["resolution"]).strip()
            sanitized["resolution"] = val if val in ("480p", "720p") else self.I2V_DEFAULT_CONFIG["resolution"]
        all_configs[character_hash] = {**all_configs.get(character_hash, {}), **sanitized}
        self.core_api.save_data(all_configs, self.I2V_CONFIG_FILENAME)
        return all_configs[character_hash]

    def _get_i2v_video_settings(self, character_hash: str, image_id: str) -> dict:
        """Read I2V settings for a specific video in a character album."""
        all_settings = self.core_api.read_data(self.I2V_VIDEO_SETTINGS_FILENAME)
        char_settings = all_settings.get(character_hash, {})
        return char_settings.get(image_id, {})

    def _save_i2v_video_settings(self, character_hash: str, image_id: str, data: dict) -> dict:
        """Save I2V settings for a specific video in a character album."""
        all_settings = self.core_api.read_data(self.I2V_VIDEO_SETTINGS_FILENAME)
        char_settings = all_settings.setdefault(character_hash, {})
        sanitized = {}
        if "prompt" in data:
            sanitized["prompt"] = str(data["prompt"])
        if "seconds" in data:
            val = int(data["seconds"])
            sanitized["seconds"] = val if val in (2, 3, 4, 5) else self.I2V_DEFAULT_CONFIG["seconds"]
        if "fps" in data:
            val = int(data["fps"])
            sanitized["fps"] = val if val in (16, 24) else self.I2V_DEFAULT_CONFIG["fps"]
        if "enable_loop" in data:
            sanitized["enable_loop"] = bool(data["enable_loop"])
        if "enable_interpolation" in data:
            sanitized["enable_interpolation"] = bool(data["enable_interpolation"])
        if "resolution" in data:
            val = str(data["resolution"]).strip()
            sanitized["resolution"] = val if val in ("480p", "720p") else self.I2V_DEFAULT_CONFIG["resolution"]
        char_settings[image_id] = {**char_settings.get(image_id, {}), **sanitized}
        self.core_api.save_data(all_settings, self.I2V_VIDEO_SETTINGS_FILENAME)
        return char_settings[image_id]

    def _get_i2v_sys_prompts(self) -> dict:
        """Read global I2V system prompts (primary + secondary + active_tab)."""
        data = self.core_api.read_data(self.I2V_SYS_PROMPTS_FILENAME)
        if not isinstance(data, dict):
            data = {}
            
        result = self.I2V_DEFAULT_SYS_PROMPTS.copy()
        for key in result:
            if key in data:
                result[key] = data[key]
        return result

    def _save_i2v_sys_prompts(self, data: dict):
        """Save global I2V system prompts (primary + secondary + active_tab)."""
        saved_data = self.core_api.read_data(self.I2V_SYS_PROMPTS_FILENAME)
        if not isinstance(saved_data, dict):
            saved_data = {}
        
        allowed_keys = [
            "I2V_SysPrompt", "I2V_SysPrompt_secondary", "I2V_SysPrompt_active_tab",
            "I2V_SysICap", "I2V_SysICap_secondary", "I2V_SysICap_active_tab",
        ]
        for key in allowed_keys:
            if key in data:
                saved_data[key] = str(data[key])
            
        self.core_api.save_data(saved_data, self.I2V_SYS_PROMPTS_FILENAME)
        return saved_data

    def _get_active_sys_prompts(self) -> dict:
        """Resolve the active system prompts based on active_tab settings.
        
        Returns dict with keys 'sys_prompt' and 'sys_icap' containing
        the content of whichever tab is currently active.
        """
        all_prompts = self._get_i2v_sys_prompts()
        
        # Resolve Prompt Generator
        if all_prompts.get("I2V_SysPrompt_active_tab") == "secondary":
            sys_prompt = all_prompts.get("I2V_SysPrompt_secondary", "")
        else:
            sys_prompt = all_prompts.get("I2V_SysPrompt", "")
        
        # Resolve Image Captioner
        if all_prompts.get("I2V_SysICap_active_tab") == "secondary":
            sys_icap = all_prompts.get("I2V_SysICap_secondary", "")
        else:
            sys_icap = all_prompts.get("I2V_SysICap", "")
        
        return {"sys_prompt": sys_prompt, "sys_icap": sys_icap}
