# --- MODIFIED FILE: plugins/album/backend.py ---
import os
from flask import Blueprint

from .services.char_view import AlbumCharacterViewMixin
from .services.external_presets import AlbumExternalPresetsMixin
from .services.lora import AlbumLoraMixin
from .services.album_management import AlbumManagementMixin
from .services.animation import AlbumAnimationMixin
from .services.sound_fx import AlbumSoundFxMixin

# Import API route handlers
from .api import albums, comfyui, images, character_view, animation, sound_fx

class AlbumPlugin(
    AlbumCharacterViewMixin,
    AlbumExternalPresetsMixin,
    AlbumLoraMixin,
    AlbumManagementMixin,
    AlbumAnimationMixin,
    AlbumSoundFxMixin,
):
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('album', __name__)
        
        # Yuuka: Các file config vẫn do plugin quản lý
        self.COMFYUI_CONFIG_FILENAME = "comfyui_config.json"
        self.ALBUM_CHAR_CONFIG_FILENAME = "album_character_configs.json"
        self.ALBUM_CUSTOM_LIST_FILENAME = "album_custom_list.json"

        # --- Character view (new viewMode: character) ---
        # Stored per-user in data_cache via DataManager.*_user_data(..., obfuscated=True)
        self.CHAR_TAG_GROUPS_FILENAME = "album_character_tags_group.json"
        self.CHAR_PRESETS_FILENAME = "album_character_presets.json"
        self.CHAR_PRESET_FAVOURITES_FILENAME = "album_character_preset_favourites.json"
        self.CHAR_VIEW_SETTINGS_FILENAME = "album_character_view_settings.json"
        self.CHAR_VN_BACKGROUNDS_FILENAME = "album_character_vn_backgrounds.json"

        # --- Animation (CSS) presets + groups (per-user)
        self.ANIMATION_GROUPS_FILENAME = "album_animation_groups.json"
        self.ANIMATION_PRESETS_FILENAME = "album_animation_presets.json"

        # --- Sound FX presets + groups (per-user)
        self.SOUND_FX_GROUPS_FILENAME = "album_sound_fx_groups.json"
        self.SOUND_FX_PRESETS_FILENAME = "album_sound_fx_presets.json"

        # External (manual) presets: read-only tag groups loaded from data_cache/album_preset/*.txt
        self.EXTERNAL_ALBUM_PRESET_DIRNAME = os.path.join('album_preset')
        
        self.DEFAULT_CONFIG = {
            "server_address": "127.0.0.1:8888", "ckpt_name": "waiNSFWIllustrious_v160.safetensors",
            "character": "", "expression": "smile", "action": "sitting", "outfits": "school uniform",
            "context": "1girl, classroom", "quality": "masterpiece, best quality, highres, amazing quality",
            "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
            "batch_size": 1, "height": 1216, "width": 832, "cfg": 2.2, "sampler_name": "dpmpp_sde",
            "scheduler": "beta", "steps": 12, "lora_name": "None", "lora_strength_model": 0.9,
            "lora_strength_clip": 1.0,
            "hires_enabled": False,
            "hires_stage1_denoise": 1.0,
            "hires_stage2_steps": 14,
            "hires_stage2_cfg": 2.4,
            "hires_stage2_sampler_name": "euler_ancestral",
            "hires_stage2_scheduler": "karras",
            "hires_stage2_denoise": 0.5,
            "hires_upscale_model": "4x-UltraSharp.pth",
            "hires_upscale_method": "bilinear",
            "hires_base_width": 0,
            "hires_base_height": 0,
            "lora_prompt_tags": [],
        }
        
        self.register_routes()

    # (Moved character-view / external preset / LoRA helpers into mixins)





    def register_routes(self):
        # Register routes from API modules
        albums.register_routes(self.blueprint, self)
        comfyui.register_routes(self.blueprint, self)
        images.register_routes(self.blueprint, self)
        character_view.register_routes(self.blueprint, self)
        animation.register_routes(self.blueprint, self)
        sound_fx.register_routes(self.blueprint, self)



    def get_blueprint(self):
        return self.blueprint, "/api/plugin/album"
