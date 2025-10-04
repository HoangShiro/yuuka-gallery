# --- NEW FILE: comfyui_integration/workflow_builder_service.py ---
import os
import json
import uuid
from copy import deepcopy
from typing import Any, Dict, Tuple, List

# Yuuka: Định nghĩa các hằng số và đường dẫn trực tiếp trong file.
# Đường dẫn được xây dựng tương đối với vị trí của file này.
_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
_WORKFLOWS_DIR = os.path.join(_SERVICE_DIR, "workflows")

SDXL_LORA_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "SDXL_with_LoRA.json")
# Yuuka: Sếp cần tạo các file json tương ứng nếu muốn dùng các workflow này.
# HIRESFIX_ESRGAN_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_api.json")
# HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_input_image_api.json")

COMBINED_TEXT_PROMPT_KEY = "combined_text_prompt"

DEFAULT_CONFIG = {
    "server_address": "127.0.0.1:8888",
    "ckpt_name": "waiNSFWIllustrious_v150.safetensors",
    "character": "shiina_mahiru_(otonari_no_tenshi-sama)",
    "expression": "smile",
    "action": "sitting",
    "outfits": "school uniform",
    "context": "1girl, classroom",
    "quality": "masterpiece, best quality, highres, amazing quality",
    "negative": "bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark",
    "batch_size": 1, 
    "height": 1216, 
    "width": 832, 
    "cfg": 2.4, 
    "sampler_name": "euler_ancestral", 
    "scheduler": "karras", 
    "steps": 25,
    "lora_name": "None", 
    "lora_strength_model": 1.0, 
    "lora_strength_clip": 1.0,
}

# Yuuka: Tích hợp các hàm tiện ích nhỏ vào đây để file độc lập.
def normalize_tag_list(tags: str) -> List[str]:
    """Tách chuỗi tags, loại bỏ khoảng trắng và các tag rỗng."""
    if not isinstance(tags, str):
        return []
    return [tag.strip() for tag in tags.split(',') if tag.strip()]

def build_full_prompt_from_cfg(cfg_data: Dict[str, Any]) -> str:
    """Xây dựng prompt đầy đủ từ các thành phần trong config."""
    prompt_parts = [
        cfg_data.get('character', ''),
        cfg_data.get('outfits', ''),
        cfg_data.get('expression', ''),
        cfg_data.get('action', ''),
        cfg_data.get('context', ''),
        cfg_data.get('quality', 'masterpiece, best quality'),
    ]
    # Nối các phần lại với nhau, chỉ giữ lại các phần có nội dung
    full_prompt = ", ".join(filter(None, [part.strip() for part in prompt_parts]))
    return full_prompt


class WorkflowBuilderService:
    """
    Dịch vụ chuyên xây dựng các workflow API JSON để gửi cho ComfyUI.
    """
    def __init__(self):
        self.workflow_templates: Dict[str, Any] = {}
        self._load_all_templates()
        print("✅ WorkflowBuilderService Initialized and templates loaded.")

    def _load_all_templates(self):
        """Tải các file workflow JSON từ thư mục workflows."""
        workflow_paths = {
            "sdxl_lora": SDXL_LORA_WORKFLOW_PATH,
            # "hiresfix_esrgan": HIRESFIX_ESRGAN_WORKFLOW_PATH,
            # "hiresfix_esrgan_input_image": HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_PATH,
        }
        for name, path in workflow_paths.items():
            try:
                if os.path.exists(path):
                    with open(path, 'r', encoding='utf-8') as f:
                        self.workflow_templates[name] = json.load(f)
                    print(f"[WorkflowBuilder] Template '{name}' loaded successfully.")
                else:
                    self.workflow_templates[name] = None
                    print(f"💥 [WorkflowBuilder] CRITICAL: Template file not found: {path}")
            except Exception as e:
                self.workflow_templates[name] = None
                print(f"💥 [WorkflowBuilder] CRITICAL: Failed to load template '{name}' from {path}: {e}")

    def build_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """
        Hàm điều phối chính. Nó sẽ quyết định dùng builder nào dựa trên cfg_data.
        """
        lora_name = cfg_data.get('lora_name')
        if lora_name and lora_name != "None" and lora_name.strip() != "":
            return self._build_lora_workflow(cfg_data, seed)
        else:
            return self._build_standard_workflow(cfg_data, seed)

    def _build_standard_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """Xây dựng workflow text-to-image tiêu chuẩn, không dùng template."""
        text_prompt = cfg_data.get(COMBINED_TEXT_PROMPT_KEY, build_full_prompt_from_cfg(cfg_data))
        negative_prompt = ", ".join(normalize_tag_list(str(cfg_data.get("negative", DEFAULT_CONFIG["negative"]))))
        
        workflow = {
            "3": {"class_type": "KSampler", "inputs": {
                "cfg": cfg_data.get("cfg", DEFAULT_CONFIG["cfg"]),
                "denoise": 1.0, "latent_image": ["5", 0], "model": ["4", 0],
                "negative": ["7", 0], "positive": ["6", 0],
                "sampler_name": cfg_data.get("sampler_name", DEFAULT_CONFIG["sampler_name"]),
                "scheduler": cfg_data.get("scheduler", DEFAULT_CONFIG["scheduler"]),
                "seed": seed, "steps": cfg_data.get("steps", DEFAULT_CONFIG["steps"])}},
            "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": cfg_data.get("ckpt_name", DEFAULT_CONFIG["ckpt_name"])}},
            "5": {"class_type": "EmptyLatentImage", "inputs": {"batch_size": 1, "height": cfg_data.get("height", DEFAULT_CONFIG["height"]), "width": cfg_data.get("width", DEFAULT_CONFIG["width"])}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": text_prompt}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": negative_prompt}},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": f"CharacterGallery_Std_{seed}", "images": ["8", 0]}}
        }
        return workflow, "9"

    def _build_lora_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """Xây dựng workflow sử dụng LoRA từ template."""
        template = self.workflow_templates.get("sdxl_lora")
        if not template:
            # Yuuka: Nếu template không có, quay về dùng workflow standard để không bị crash.
            print("⚠️ SDXL LoRA workflow template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)
        
        workflow = deepcopy(template)
        workflow["13"]["inputs"]["lora_name"] = cfg_data['lora_name']
        workflow["13"]["inputs"]["strength_model"] = cfg_data.get('lora_strength_model', DEFAULT_CONFIG['lora_strength_model'])
        workflow["13"]["inputs"]["strength_clip"] = cfg_data.get('lora_strength_clip', DEFAULT_CONFIG['lora_strength_clip'])
        
        workflow["4"]["inputs"]["ckpt_name"] = cfg_data.get("ckpt_name", DEFAULT_CONFIG["ckpt_name"])
        workflow["6"]["inputs"]["text"] = cfg_data.get(COMBINED_TEXT_PROMPT_KEY, build_full_prompt_from_cfg(cfg_data))
        workflow["7"]["inputs"]["text"] = ", ".join(normalize_tag_list(str(cfg_data.get("negative", DEFAULT_CONFIG["negative"]))))
        
        workflow["5"]["inputs"]["width"] = cfg_data.get("width", DEFAULT_CONFIG["width"])
        workflow["5"]["inputs"]["height"] = cfg_data.get("height", DEFAULT_CONFIG["height"])
        workflow["5"]["inputs"]["batch_size"] = 1
        
        workflow["3"]["inputs"]["seed"] = seed
        workflow["3"]["inputs"]["steps"] = cfg_data.get("steps", DEFAULT_CONFIG["steps"])
        workflow["3"]["inputs"]["cfg"] = cfg_data.get("cfg", DEFAULT_CONFIG["cfg"])
        workflow["3"]["inputs"]["sampler_name"] = cfg_data.get("sampler_name", DEFAULT_CONFIG["sampler_name"])
        workflow["3"]["inputs"]["scheduler"] = cfg_data.get("scheduler", DEFAULT_CONFIG["scheduler"])
        
        workflow["9"]["inputs"]["filename_prefix"] = f"CharacterGallery_LoRA_{seed}"
        
        return workflow, "9"