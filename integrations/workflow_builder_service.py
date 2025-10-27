# --- MODIFIED FILE: integrations/workflow_builder_service.py ---
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
HIRESFIX_ESRGAN_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan.json")
HIRESFIX_ESRGAN_LORA_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_LoRA.json")


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
    "cfg": 2.2,
    "sampler_name": "dpmpp_sde",
    "scheduler": "beta",
    "steps": 12,
    "lora_name": "None",
    "lora_strength_model": 1.0,
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

# Yuuka: Tích hợp các hàm tiện ích nhỏ vào đây để file độc lập.
def normalize_tag_list(tags: str) -> List[str]:
    """Tách chuỗi tags, loại bỏ khoảng trắng và các tag rỗng."""
    if not isinstance(tags, str):
        return []
    return [tag.strip() for tag in tags.split(',') if tag.strip()]

def build_full_prompt_from_cfg(cfg_data: Dict[str, Any]) -> str:
    """Build prompt from config."""
    prompt_parts = [
        cfg_data.get('character_prompt') or cfg_data.get('character', ''),
        cfg_data.get('outfits', ''),
        cfg_data.get('expression', ''),
        cfg_data.get('action', ''),
        cfg_data.get('context', ''),
        cfg_data.get('quality', 'masterpiece, best quality'),
    ]
    lora_prompt_tags = cfg_data.get('lora_prompt_tags', [])
    if isinstance(lora_prompt_tags, list):
        prompt_parts.extend(str(item).strip() for item in lora_prompt_tags if str(item).strip())
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
            "hiresfix_esrgan": HIRESFIX_ESRGAN_WORKFLOW_PATH,
            "hiresfix_esrgan_lora": HIRESFIX_ESRGAN_LORA_WORKFLOW_PATH,
            "hiresfix_esrgan_input_image": os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_input_image.json"),
            "hiresfix_esrgan_input_image_lora": os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_input_image_LoRA.json"),
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
        workflow_type = cfg_data.get('_workflow_type')
        if workflow_type == 'hires_input_image':
            return self._build_hiresfix_input_image_workflow(cfg_data, seed)

        if workflow_type in ('sdxl_lora', 'lora'):
            return self._build_lora_workflow(cfg_data, seed)

        if cfg_data.get('hires_enabled'):
            return self._build_hiresfix_workflow(cfg_data, seed)

        lora_name = cfg_data.get('lora_name')
        if lora_name and lora_name != "None" and lora_name.strip() != "":
            return self._build_lora_workflow(cfg_data, seed)
        return self._build_standard_workflow(cfg_data, seed)

    def _build_standard_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """
        Yuuka: Cập nhật workflow tiêu chuẩn theo cấu trúc mới.
        Workflow này sẽ trả về ảnh dưới dạng base64 qua API.
        """
        text_prompt = cfg_data.get(COMBINED_TEXT_PROMPT_KEY, build_full_prompt_from_cfg(cfg_data))
        negative_prompt = ", ".join(normalize_tag_list(str(cfg_data.get("negative", DEFAULT_CONFIG["negative"]))))
        
        workflow = {
            "3": {
                "inputs": {
                    "seed": seed,
                    "steps": cfg_data.get("steps", DEFAULT_CONFIG["steps"]),
                    "cfg": cfg_data.get("cfg", DEFAULT_CONFIG["cfg"]),
                    "sampler_name": cfg_data.get("sampler_name", DEFAULT_CONFIG["sampler_name"]),
                    "scheduler": cfg_data.get("scheduler", DEFAULT_CONFIG["scheduler"]),
                    "denoise": 1,
                    "model": ["11", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["12", 0]
                },
                "class_type": "KSampler"
            },
            "6": {
                "inputs": {"text": text_prompt, "clip": ["11", 1]},
                "class_type": "CLIPTextEncode"
            },
            "7": {
                "inputs": {"text": negative_prompt, "clip": ["11", 1]},
                "class_type": "CLIPTextEncode"
            },
            "8": {
                "inputs": {"samples": ["3", 0], "vae": ["11", 2]},
                "class_type": "VAEDecode"
            },
            "11": {
                "inputs": {"ckpt_name": cfg_data.get("ckpt_name", DEFAULT_CONFIG["ckpt_name"])},
                "class_type": "CheckpointLoaderSimple"
            },
            "12": {
                "inputs": {
                    "width": cfg_data.get("width", DEFAULT_CONFIG["width"]),
                    "height": cfg_data.get("height", DEFAULT_CONFIG["height"]),
                    "batch_size": 1
                },
                "class_type": "EmptyLatentImage"
            },
            "15": {
                "inputs": {"images": ["8", 0]},
                "class_type": "ImageToBase64_Yuuka"
            }
        }
        
        # Yuuka: Trả về workflow và ID của node output base64
        return workflow, "15"

    def _build_hiresfix_input_image_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """Build hires-fix ESRGAN workflow that starts from an uploaded image."""
        uploaded_name = cfg_data.get("_input_image_name")
        if not uploaded_name:
            print("[WorkflowBuilder] Missing uploaded image name for hires input workflow. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        lora_name = cfg_data.get("lora_name", "")
        use_lora = isinstance(lora_name, str) and lora_name.strip() and lora_name.strip() != "None"

        template_key = "hiresfix_esrgan_input_image_lora" if use_lora else "hiresfix_esrgan_input_image"
        template = self.workflow_templates.get(template_key)

        if not template and use_lora:
            print("[WorkflowBuilder] hiresfix_esrgan_input_image_lora template missing. Falling back to non-LoRA variant.")
            template = self.workflow_templates.get("hiresfix_esrgan_input_image")
            use_lora = False

        if not template:
            print("[WorkflowBuilder] hiresfix_esrgan_input_image template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        workflow = deepcopy(template)

        def _safe_int(value, fallback):
            try:
                parsed = int(value)
                return parsed if parsed > 0 else fallback
            except (TypeError, ValueError):
                return fallback

        def _safe_float(value, fallback):
            try:
                return float(value)
            except (TypeError, ValueError):
                return fallback

        text_prompt = cfg_data.get(COMBINED_TEXT_PROMPT_KEY, build_full_prompt_from_cfg(cfg_data))
        negative_prompt = ", ".join(normalize_tag_list(str(cfg_data.get("negative", DEFAULT_CONFIG["negative"]))))

        base_width = _safe_int(cfg_data.get("hires_base_width") or cfg_data.get("_input_image_width"), DEFAULT_CONFIG["width"])
        base_height = _safe_int(cfg_data.get("hires_base_height") or cfg_data.get("_input_image_height"), DEFAULT_CONFIG["height"])
        target_width = _safe_int(cfg_data.get("width"), base_width * 2)
        target_height = _safe_int(cfg_data.get("height"), base_height * 2)

        stage2_steps = _safe_int(cfg_data.get("hires_stage2_steps"), DEFAULT_CONFIG["hires_stage2_steps"])
        stage2_cfg = _safe_float(cfg_data.get("hires_stage2_cfg"), DEFAULT_CONFIG["hires_stage2_cfg"])
        stage2_sampler = cfg_data.get("hires_stage2_sampler_name", DEFAULT_CONFIG["hires_stage2_sampler_name"])
        stage2_scheduler = cfg_data.get("hires_stage2_scheduler", DEFAULT_CONFIG["hires_stage2_scheduler"])
        stage2_denoise = _safe_float(cfg_data.get("hires_stage2_denoise"), DEFAULT_CONFIG["hires_stage2_denoise"])

        workflow.setdefault("6", {}).setdefault("inputs", {})["text"] = text_prompt
        workflow.setdefault("7", {}).setdefault("inputs", {})["text"] = negative_prompt

        workflow.setdefault("23", {}).setdefault("inputs", {})["model_name"] = cfg_data.get(
            "hires_upscale_model", DEFAULT_CONFIG["hires_upscale_model"]
        )

        workflow.setdefault("30", {}).setdefault("inputs", {})
        workflow["30"]["inputs"]["upscale_method"] = cfg_data.get(
            "hires_upscale_method", DEFAULT_CONFIG["hires_upscale_method"]
        )
        workflow["30"]["inputs"]["width"] = target_width
        workflow["30"]["inputs"]["height"] = target_height

        workflow.setdefault("11", {}).setdefault("inputs", {})
        workflow["11"]["inputs"]["seed"] = seed
        workflow["11"]["inputs"]["steps"] = stage2_steps
        workflow["11"]["inputs"]["cfg"] = stage2_cfg
        workflow["11"]["inputs"]["sampler_name"] = stage2_sampler
        workflow["11"]["inputs"]["scheduler"] = stage2_scheduler
        workflow["11"]["inputs"]["denoise"] = stage2_denoise

        workflow.setdefault("25", {}).setdefault("inputs", {})["ckpt_name"] = cfg_data.get(
            "ckpt_name", DEFAULT_CONFIG["ckpt_name"]
        )

        workflow.setdefault("28", {}).setdefault("inputs", {})["image"] = uploaded_name

        if use_lora:
            lora_node_id = None
            for node_id, node_data in workflow.items():
                if isinstance(node_data, dict) and node_data.get("class_type") == "LoraLoader":
                    lora_node_id = node_id
                    break
            if lora_node_id:
                loader_inputs = workflow[lora_node_id].setdefault("inputs", {})
                loader_inputs["lora_name"] = lora_name.strip()
                loader_inputs["strength_model"] = cfg_data.get(
                    "lora_strength_model", DEFAULT_CONFIG["lora_strength_model"]
                )
                loader_inputs["strength_clip"] = cfg_data.get(
                    "lora_strength_clip", DEFAULT_CONFIG["lora_strength_clip"]
                )
            else:
                print("[WorkflowBuilder] LoRA template for hires input image is missing LoraLoader node.")

        return workflow, "31"




    def _build_hiresfix_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """Build hires-fix ESRGAN workflow with custom base64 output."""
        lora_name = cfg_data.get("lora_name", "")
        use_lora = False
        if isinstance(lora_name, str) and lora_name.strip() and lora_name.strip() != "None":
            use_lora = True

        template_key = "hiresfix_esrgan_lora" if use_lora else "hiresfix_esrgan"
        template = self.workflow_templates.get(template_key)

        if not template and use_lora:
            print("[WorkflowBuilder] hiresfix_esrgan_lora template missing. Falling back to hiresfix_esrgan.")
            template = self.workflow_templates.get("hiresfix_esrgan")
            use_lora = False

        if not template:
            print("[WorkflowBuilder] hiresfix_esrgan template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        workflow = deepcopy(template)
        text_prompt = cfg_data.get(COMBINED_TEXT_PROMPT_KEY, build_full_prompt_from_cfg(cfg_data))
        negative_prompt = ", ".join(normalize_tag_list(str(cfg_data.get("negative", DEFAULT_CONFIG["negative"]))))

        def _safe_int(value, fallback):
            try:
                parsed = int(value)
                return parsed if parsed > 0 else fallback
            except (TypeError, ValueError):
                return fallback

        def _safe_float(value, fallback):
            try:
                return float(value)
            except (TypeError, ValueError):
                return fallback

        base_width = _safe_int(cfg_data.get("hires_base_width"), 0)
        base_height = _safe_int(cfg_data.get("hires_base_height"), 0)
        if not base_width:
            base_width = _safe_int(cfg_data.get("width"), DEFAULT_CONFIG["width"])
        if not base_height:
            base_height = _safe_int(cfg_data.get("height"), DEFAULT_CONFIG["height"])
        final_width = _safe_int(cfg_data.get("width"), DEFAULT_CONFIG["width"])
        final_height = _safe_int(cfg_data.get("height"), DEFAULT_CONFIG["height"])

        stage1_steps = _safe_int(cfg_data.get("steps"), DEFAULT_CONFIG["steps"])
        stage1_cfg = _safe_float(cfg_data.get("cfg"), DEFAULT_CONFIG["cfg"])
        stage1_sampler = cfg_data.get("sampler_name", DEFAULT_CONFIG["sampler_name"]) or DEFAULT_CONFIG["sampler_name"]
        stage1_scheduler = cfg_data.get("scheduler", DEFAULT_CONFIG["scheduler"]) or DEFAULT_CONFIG["scheduler"]
        stage1_denoise = _safe_float(cfg_data.get("hires_stage1_denoise"), DEFAULT_CONFIG["hires_stage1_denoise"])

        stage2_steps = _safe_int(cfg_data.get("hires_stage2_steps"), DEFAULT_CONFIG["hires_stage2_steps"])
        stage2_cfg = _safe_float(cfg_data.get("hires_stage2_cfg"), DEFAULT_CONFIG["hires_stage2_cfg"])
        stage2_sampler = cfg_data.get("hires_stage2_sampler_name", DEFAULT_CONFIG["hires_stage2_sampler_name"]) or DEFAULT_CONFIG["hires_stage2_sampler_name"]
        stage2_scheduler = cfg_data.get("hires_stage2_scheduler", DEFAULT_CONFIG["hires_stage2_scheduler"]) or DEFAULT_CONFIG["hires_stage2_scheduler"]
        stage2_denoise = _safe_float(cfg_data.get("hires_stage2_denoise"), DEFAULT_CONFIG["hires_stage2_denoise"])

        workflow.setdefault("5", {}).setdefault("inputs", {})
        workflow["5"]["inputs"]["width"] = base_width
        workflow["5"]["inputs"]["height"] = base_height
        workflow["5"]["inputs"]["batch_size"] = _safe_int(cfg_data.get("batch_size"), DEFAULT_CONFIG["batch_size"])

        workflow.setdefault("3", {}).setdefault("inputs", {})
        workflow["3"]["inputs"]["seed"] = seed
        workflow["3"]["inputs"]["steps"] = stage1_steps
        workflow["3"]["inputs"]["cfg"] = stage1_cfg
        workflow["3"]["inputs"]["sampler_name"] = stage1_sampler
        workflow["3"]["inputs"]["scheduler"] = stage1_scheduler
        workflow["3"]["inputs"]["denoise"] = stage1_denoise

        workflow.setdefault("6", {}).setdefault("inputs", {})["text"] = text_prompt
        workflow.setdefault("7", {}).setdefault("inputs", {})["text"] = negative_prompt

        workflow.setdefault("23", {}).setdefault("inputs", {})["model_name"] = cfg_data.get("hires_upscale_model", DEFAULT_CONFIG["hires_upscale_model"])
        workflow.setdefault("24", {}).setdefault("inputs", {})["upscale_method"] = cfg_data.get("hires_upscale_method", DEFAULT_CONFIG["hires_upscale_method"])
        workflow["24"]["inputs"]["width"] = final_width
        workflow["24"]["inputs"]["height"] = final_height

        workflow.setdefault("11", {}).setdefault("inputs", {})
        workflow["11"]["inputs"]["seed"] = seed
        workflow["11"]["inputs"]["steps"] = stage2_steps
        workflow["11"]["inputs"]["cfg"] = stage2_cfg
        workflow["11"]["inputs"]["sampler_name"] = stage2_sampler
        workflow["11"]["inputs"]["scheduler"] = stage2_scheduler
        workflow["11"]["inputs"]["denoise"] = stage2_denoise

        workflow.setdefault("25", {}).setdefault("inputs", {})["ckpt_name"] = cfg_data.get("ckpt_name", DEFAULT_CONFIG["ckpt_name"])

        if use_lora:
            lora_strength_model = cfg_data.get('lora_strength_model', DEFAULT_CONFIG['lora_strength_model'])
            lora_strength_clip = cfg_data.get('lora_strength_clip', DEFAULT_CONFIG['lora_strength_clip'])
            lora_loader_id = None
            for node_id, node_data in workflow.items():
                if isinstance(node_data, dict) and node_data.get("class_type") == "LoraLoader":
                    lora_loader_id = node_id
                    break
            if lora_loader_id and isinstance(workflow.get(lora_loader_id), dict):
                loader_inputs = workflow[lora_loader_id].setdefault("inputs", {})
                loader_inputs["lora_name"] = lora_name.strip()
                loader_inputs["strength_model"] = lora_strength_model
                loader_inputs["strength_clip"] = lora_strength_clip
            else:
                print("[WorkflowBuilder] Warning: LoRA-enabled hires workflow missing LoraLoader node.")

        output_node_id = "30"
        if output_node_id not in workflow:
            workflow[output_node_id] = {
                "inputs": {"images": ["13", 0]},
                "class_type": "ImageToBase64_Yuuka"
            }

        return workflow, output_node_id

    def _build_lora_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """Xây dựng workflow sử dụng LoRA từ template."""
        template = self.workflow_templates.get("sdxl_lora")
        if not template:
            # Yuuka: Nếu template không có, quay về dùng workflow standard để không bị crash.
            print("⚠️ SDXL LoRA workflow template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)
        
        workflow = deepcopy(template)
        selected_lora = cfg_data.get("lora_name", DEFAULT_CONFIG["lora_name"])
        workflow["13"]["inputs"]["lora_name"] = selected_lora
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
        
        # Yuuka: Cần đảm bảo workflow LoRA cũng có node output base64. 
        # Giả sử template có node ID là "16" cho việc này. Nếu không, nó sẽ thất bại.
        # Senpai cần đảm bảo template `SDXL_with_LoRA.json` có node ImageToBase64_Yuuka.
        output_node_id = "15" # Giả định ID node output là 15, cần kiểm tra file json
        if output_node_id not in workflow:
            print(f"⚠️  Template LoRA không có output node {output_node_id}. Việc lấy ảnh có thể thất bại.")
            # Fallback về node SaveImage nếu có
            output_node_id = "9" if "9" in workflow else "15"

        return workflow, output_node_id
