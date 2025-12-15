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
_ALPHA_WORKFLOWS_DIR = os.path.join(_WORKFLOWS_DIR, "Alpha")

# Yuuka: RMBG node template (used to generate alpha/transparent images)
RMBG_NODE_TEMPLATE_PATH = os.path.join(_ALPHA_WORKFLOWS_DIR, "BiRefNet (RMBG).json")

SDXL_LORA_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "SDXL_with_LoRA.json")
# Yuuka: Sếp cần tạo các file json tương ứng nếu muốn dùng các workflow này.
HIRESFIX_ESRGAN_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan.json")
HIRESFIX_ESRGAN_LORA_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_LoRA.json")

HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_input_image.json")
HIRESFIX_ESRGAN_INPUT_IMAGE_LORA_WORKFLOW_PATH = os.path.join(_WORKFLOWS_DIR, "hiresfix_esrgan_input_image_LoRA.json")

SDXL_LORA_WORKFLOW_NAME = os.path.basename(SDXL_LORA_WORKFLOW_PATH)
HIRESFIX_ESRGAN_WORKFLOW_NAME = os.path.basename(HIRESFIX_ESRGAN_WORKFLOW_PATH)
HIRESFIX_ESRGAN_LORA_WORKFLOW_NAME = os.path.basename(HIRESFIX_ESRGAN_LORA_WORKFLOW_PATH)
HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_NAME = os.path.basename(HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_PATH)
HIRESFIX_ESRGAN_INPUT_IMAGE_LORA_WORKFLOW_NAME = os.path.basename(HIRESFIX_ESRGAN_INPUT_IMAGE_LORA_WORKFLOW_PATH)


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

def _collect_lora_prompt_tokens(cfg_data: Dict[str, Any]) -> List[str]:
    """Collect LoRA-related prompt tokens with multi-LoRA awareness.
    Priority:
      1) multi_lora_prompt_groups: list[list[str]] -> each LoRA becomes a single token "(g1, g2, ...)"
      2) multi_lora_prompt_tags: legacy string "(g1, g2), (h1), ..." -> extract each parenthesized block
      3) lora_prompt_tags: list[str] (legacy single-LoRA)
    Returns list of strings (already properly wrapped/trimmed) to append to positive prompt.
    """
    try:
        groups = cfg_data.get('multi_lora_prompt_groups')
        if isinstance(groups, list) and any(isinstance(g, list) and g for g in groups):
            tokens: List[str] = []
            for group_list in groups:
                if not isinstance(group_list, list):
                    continue
                inner = ", ".join(str(s).strip() for s in group_list if str(s).strip())
                if inner:
                    tokens.append(f"({inner})")
            if tokens:
                return tokens
    except Exception:
        pass

    try:
        legacy_multi = cfg_data.get('multi_lora_prompt_tags')
        if isinstance(legacy_multi, str):
            # Extract every (...) as one token
            import re
            tokens = [f"({m.strip()})" for m in re.findall(r"\(([^)]*)\)", legacy_multi or "") if m and m.strip()]
            if tokens:
                return tokens
    except Exception:
        pass

    # Fallback to legacy single-LoRA tags list
    lora_prompt_tags = cfg_data.get('lora_prompt_tags', [])
    if isinstance(lora_prompt_tags, list):
        return [str(item).strip() for item in lora_prompt_tags if str(item).strip()]
    return []


def build_full_prompt_from_cfg(cfg_data: Dict[str, Any]) -> str:
    """Build positive prompt from config, preferring multi-LoRA tokens when available."""
    prompt_parts = [
        cfg_data.get('character_prompt') or cfg_data.get('character', ''),
        cfg_data.get('outfits', ''),
        cfg_data.get('expression', ''),
        cfg_data.get('action', ''),
        cfg_data.get('context', ''),
        cfg_data.get('quality', 'masterpiece, best quality'),
    ]
    # Append LoRA tokens with multi-LoRA awareness
    prompt_parts.extend(_collect_lora_prompt_tokens(cfg_data))
    full_prompt = ", ".join(filter(None, [str(part).strip() for part in prompt_parts]))
    return full_prompt


class WorkflowBuilderService:
    """
    Dịch vụ chuyên xây dựng các workflow API JSON để gửi cho ComfyUI.
    """
    def __init__(self):
        self.workflow_templates: Dict[str, Any] = {}
        self.rmbg_node_template: Dict[str, Any] = {}
        self._load_all_templates()
        self._load_rmbg_node_template()
        print("✅ WorkflowBuilderService Initialized and templates loaded.")

    def _load_all_templates(self):
        """Tải các file workflow JSON từ thư mục workflows."""
        workflow_paths = {
            "sdxl_lora": SDXL_LORA_WORKFLOW_PATH,
            "hiresfix_esrgan": HIRESFIX_ESRGAN_WORKFLOW_PATH,
            "hiresfix_esrgan_lora": HIRESFIX_ESRGAN_LORA_WORKFLOW_PATH,
            "hiresfix_esrgan_input_image": HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_PATH,
            "hiresfix_esrgan_input_image_lora": HIRESFIX_ESRGAN_INPUT_IMAGE_LORA_WORKFLOW_PATH,
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

    def _load_rmbg_node_template(self):
        """Load RMBG node template used to generate transparent alpha output.
        This replaces the old LayeredDiffusion alpha workflows.
        """
        self.rmbg_node_template = {}
        try:
            if not os.path.exists(RMBG_NODE_TEMPLATE_PATH):
                print(f"⚠️ [WorkflowBuilder] RMBG template not found: {RMBG_NODE_TEMPLATE_PATH}")
                return
            with open(RMBG_NODE_TEMPLATE_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, dict):
                # Prefer node id "1" if present, otherwise first node dict.
                if isinstance(data.get("1"), dict):
                    self.rmbg_node_template = deepcopy(data["1"])
                    return
                for _, node in data.items():
                    if isinstance(node, dict) and node.get('class_type') == 'BiRefNetRMBG':
                        self.rmbg_node_template = deepcopy(node)
                        return
                # Fallback: first dict entry
                for _, node in data.items():
                    if isinstance(node, dict):
                        self.rmbg_node_template = deepcopy(node)
                        return
        except Exception as e:
            print(f"⚠️ [WorkflowBuilder] Failed to load RMBG node template: {e}")

    def _is_alpha_requested(self, cfg_data: Dict[str, Any]) -> bool:
        """Detect whether this request wants alpha/RGBA workflow."""
        if not isinstance(cfg_data, dict):
            return False
        v = cfg_data.get('Alpha')
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ('1', 'true', 'yes', 'on')
        # common fallbacks
        v2 = cfg_data.get('alpha')
        if isinstance(v2, bool):
            return v2
        if isinstance(v2, str):
            return v2.strip().lower() in ('1', 'true', 'yes', 'on')
        return False

    def _inject_rmbg_before_base64_output(self, workflow: Dict[str, Any], output_node_id: str) -> Dict[str, Any]:
        """Inject BiRefNet RMBG node before ImageToBase64_Yuuka output node.
        Used when cfg requests Alpha/transparent output.
        """
        if not isinstance(workflow, dict) or not workflow:
            return workflow

        # Only supports API-style workflows (id->node dict). Ignore graph-format workflows.
        if 'nodes' in workflow and isinstance(workflow.get('nodes'), list):
            return workflow

        # Resolve output node
        out_id = output_node_id if output_node_id in workflow else None
        if out_id is None:
            for nid, nd in workflow.items():
                if isinstance(nd, dict) and nd.get('class_type') == 'ImageToBase64_Yuuka':
                    out_id = nid
                    break
        if out_id is None:
            return workflow

        out_node = workflow.get(out_id)
        if not isinstance(out_node, dict):
            return workflow
        out_inputs = out_node.setdefault('inputs', {})
        source = out_inputs.get('images')
        if not (isinstance(source, list) and len(source) == 2):
            return workflow

        # Guard: already wired through RMBG
        try:
            src_id = source[0]
            if isinstance(src_id, str) and isinstance(workflow.get(src_id), dict) and workflow[src_id].get('class_type') == 'BiRefNetRMBG':
                return workflow
        except Exception:
            pass

        # Allocate new node id
        max_id = 0
        for k in workflow.keys():
            try:
                max_id = max(max_id, int(k))
            except Exception:
                continue
        rmbg_id = str(max_id + 1)

        # Build RMBG node
        node = deepcopy(self.rmbg_node_template) if isinstance(self.rmbg_node_template, dict) and self.rmbg_node_template else {
            "class_type": "BiRefNetRMBG",
            "inputs": {
                "model": "BiRefNet-general",
                "mask_blur": 0,
                "mask_offset": 0,
                "invert_output": False,
                "refine_foreground": True,
                "background": "Alpha",
            },
        }

        node_inputs = node.setdefault('inputs', {})
        # Ensure alpha background output
        node_inputs.setdefault('background', 'Alpha')
        # Wire input image; keep both keys for compatibility across RMBG node variants.
        node_inputs['image'] = source
        node_inputs.setdefault('images', source)

        workflow[rmbg_id] = node
        # Rewire base64 output to consume RMBG result
        out_inputs['images'] = [rmbg_id, 0]
        return workflow

    # ===========================
    # LoRA helpers (multi-chain)
    # ===========================
    def _parse_lora_chain(self, cfg_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Phân tích danh sách LoRA từ cấu hình.
        Hỗ trợ các trường:
          - lora_chain: list[str] hoặc list[dict{name|lora_name, strength_model, strength_clip}]
          - lora_names: list[str] hoặc chuỗi phân tách bằng dấu phẩy
          - lora_name: str đơn
        Trả về danh sách dict: {"lora_name", "strength_model", "strength_clip"} (lọc bỏ giá trị rỗng/None).
        """
        result: List[Dict[str, Any]] = []
        default_strength_model = cfg_data.get('lora_strength_model', DEFAULT_CONFIG['lora_strength_model'])
        default_strength_clip = cfg_data.get('lora_strength_clip', DEFAULT_CONFIG['lora_strength_clip'])

        def _append_one(name: Any, sm: Any = None, sc: Any = None):
            if not isinstance(name, str):
                return
            name = name.strip()
            if not name or name == "None":
                return
            try:
                sm_val = float(sm) if sm is not None else float(default_strength_model)
            except (TypeError, ValueError):
                sm_val = float(default_strength_model)
            try:
                sc_val = float(sc) if sc is not None else float(default_strength_clip)
            except (TypeError, ValueError):
                sc_val = float(default_strength_clip)
            result.append({"lora_name": name, "strength_model": sm_val, "strength_clip": sc_val})

        # 1) lora_chain (list)
        chain = cfg_data.get('lora_chain')
        if isinstance(chain, list):
            for item in chain:
                if isinstance(item, str):
                    _append_one(item)
                elif isinstance(item, dict):
                    _append_one(
                        item.get('name') or item.get('lora_name'),
                        item.get('strength_model'),
                        item.get('strength_clip'),
                    )

        # 2) lora_names (list hoặc chuỗi CSV)
        lora_names = cfg_data.get('lora_names')
        if isinstance(lora_names, str):
            parts = [p.strip() for p in lora_names.split(',') if p.strip()]
            for p in parts:
                _append_one(p)
        elif isinstance(lora_names, list):
            for p in lora_names:
                if isinstance(p, str):
                    _append_one(p)
                elif isinstance(p, dict):
                    _append_one(
                        p.get('name') or p.get('lora_name'),
                        p.get('strength_model'),
                        p.get('strength_clip'),
                    )

        # 3) lora_name (đơn)
        single = cfg_data.get('lora_name')
        if isinstance(single, str):
            _append_one(single)

        # Loại bỏ trùng lặp theo thứ tự (nếu vô tình nhập trùng)
        seen = set()
        uniq: List[Dict[str, Any]] = []
        for d in result:
            key = (d['lora_name'], d['strength_model'], d['strength_clip'])
            if key not in seen:
                seen.add(key)
                uniq.append(d)
        return uniq

    def _inject_lora_chain(self, workflow: Dict[str, Any], loras: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], str]:
        """Chèn hoặc cập nhật chuỗi LoraLoader vào workflow.
        - Nếu template đã có LoraLoader: dùng node đầu tiên làm điểm bắt đầu, cập nhật nó là LoRA[0], sau đó tạo thêm các node nối tiếp.
        - Nếu template chưa có LoraLoader: tự tạo node và nối từ CheckpointLoaderSimple.
        - Sau khi có node LoRA cuối (last_id), cập nhật các node KSampler 'model' và các CLIPTextEncode 'clip' trỏ tới node này.
        Trả về (workflow, last_lora_node_id)
        """
        if not loras:
            return workflow, None

        # Tìm node CheckpointLoaderSimple (làm nguồn model/clip gốc)
        ckpt_id = None
        for node_id, node_data in workflow.items():
            if isinstance(node_data, dict) and node_data.get('class_type') == 'CheckpointLoaderSimple':
                ckpt_id = node_id
                break
        if ckpt_id is None:
            # Không có checkpoint => không thể tiêm LoRA hợp lệ
            print("[WorkflowBuilder] No CheckpointLoaderSimple found; cannot inject LoRA chain.")
            return workflow, None

        # Thu thập các node LoRA sẵn có trong template (nếu có)
        existing_loras = [nid for nid, nd in workflow.items() if isinstance(nd, dict) and nd.get('class_type') == 'LoraLoader']
        # Sắp xếp theo int(id) để ổn định
        try:
            existing_loras.sort(key=lambda x: int(x))
        except Exception:
            existing_loras.sort()

        # ID mới tăng dần
        def _next_id(start_from: int = None) -> str:
            max_id = 0
            for nid in workflow.keys():
                try:
                    max_id = max(max_id, int(nid))
                except Exception:
                    continue
            return str(max_id + 1)

        last_source_id = None
        # Nếu có sẵn LoraLoader, dùng node đầu làm LoRA[0]
        if existing_loras:
            first_lora_id = existing_loras[0]
            # Gán thông số cho node đầu theo loras[0]
            loader_inputs = workflow.setdefault(first_lora_id, {}).setdefault('inputs', {})
            loader_inputs['lora_name'] = loras[0]['lora_name']
            loader_inputs['strength_model'] = loras[0]['strength_model']
            loader_inputs['strength_clip'] = loras[0]['strength_clip']
            # Đảm bảo đầu vào của node đầu nối từ checkpoint
            loader_inputs['model'] = [ckpt_id, 0]
            loader_inputs['clip'] = [ckpt_id, 1]
            last_source_id = first_lora_id
            # Xóa các LoraLoader còn lại trong template (nếu có), để tránh cấu trúc lạ
            for extra_id in existing_loras[1:]:
                try:
                    del workflow[extra_id]
                except Exception:
                    pass
        else:
            # Tạo node LoRA đầu tiên
            first_lora_id = _next_id()
            workflow[first_lora_id] = {
                "inputs": {
                    "lora_name": loras[0]['lora_name'],
                    "strength_model": loras[0]['strength_model'],
                    "strength_clip": loras[0]['strength_clip'],
                    "model": [ckpt_id, 0],
                    "clip": [ckpt_id, 1],
                },
                "class_type": "LoraLoader",
            }
            last_source_id = first_lora_id

        # Tạo các node LoRA tiếp theo, nối dây từ node trước đó
        for spec in loras[1:]:
            new_id = _next_id()
            workflow[new_id] = {
                "inputs": {
                    "lora_name": spec['lora_name'],
                    "strength_model": spec['strength_model'],
                    "strength_clip": spec['strength_clip'],
                    "model": [last_source_id, 0],
                    "clip": [last_source_id, 1],
                },
                "class_type": "LoraLoader",
            }
            last_source_id = new_id

        # Cập nhật các node KSampler và CLIPTextEncode trỏ tới node LoRA cuối
        last_id = last_source_id
        for node_id, node_data in workflow.items():
            if not isinstance(node_data, dict):
                continue
            cls = node_data.get('class_type')
            if cls == 'KSampler':
                node_data.setdefault('inputs', {})['model'] = [last_id, 0]
            elif cls == 'CLIPTextEncode':
                node_data.setdefault('inputs', {})['clip'] = [last_id, 1]
            elif cls == 'LayeredDiffusionApply':
                # Alpha workflows: LayeredDiffusionApply consumes MODEL as well
                node_data.setdefault('inputs', {})['model'] = [last_id, 0]

        return workflow, last_id

    def build_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """
        Hàm điều phối chính. Nó sẽ quyết định dùng builder nào dựa trên cfg_data.
        """
        if isinstance(cfg_data, dict):
            cfg_data["_workflow_template"] = None

        alpha_requested = self._is_alpha_requested(cfg_data)

        workflow_type = cfg_data.get('_workflow_type')
        if workflow_type == 'hires_input_image':
            workflow, output_node_id = self._build_hiresfix_input_image_workflow(cfg_data, seed)
            if alpha_requested:
                workflow = self._inject_rmbg_before_base64_output(workflow, output_node_id)
            return workflow, output_node_id

        lora_name = cfg_data.get('lora_name')
        lora_chain = self._parse_lora_chain(cfg_data)
        has_lora = ((lora_name and lora_name != "None" and str(lora_name).strip() != "") or bool(lora_chain))

        # Non-alpha builders (alpha is applied as RMBG post-process below)
        if workflow_type in ('sdxl_lora', 'lora'):
            workflow, output_node_id = self._build_lora_workflow(cfg_data, seed)
            if alpha_requested:
                workflow = self._inject_rmbg_before_base64_output(workflow, output_node_id)
            return workflow, output_node_id

        if cfg_data.get('hires_enabled'):
            workflow, output_node_id = self._build_hiresfix_workflow(cfg_data, seed)
            if alpha_requested:
                workflow = self._inject_rmbg_before_base64_output(workflow, output_node_id)
            return workflow, output_node_id

        if has_lora:
            workflow, output_node_id = self._build_lora_workflow(cfg_data, seed)
            if alpha_requested:
                workflow = self._inject_rmbg_before_base64_output(workflow, output_node_id)
            return workflow, output_node_id

        workflow, output_node_id = self._build_standard_workflow(cfg_data, seed)
        if alpha_requested:
            workflow = self._inject_rmbg_before_base64_output(workflow, output_node_id)
        return workflow, output_node_id

    def _build_standard_workflow(self, cfg_data: Dict[str, Any], seed: int) -> Tuple[Dict[str, Any], str]:
        """
        Yuuka: Cập nhật workflow tiêu chuẩn theo cấu trúc mới.
        Workflow này sẽ trả về ảnh dưới dạng base64 qua API.
        """
        if isinstance(cfg_data, dict):
            cfg_data["_workflow_template"] = "standard"

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

    def _build_hiresfix_input_image_workflow(self, cfg_data: Dict[str, Any], seed: int, use_alpha: bool = False) -> Tuple[Dict[str, Any], str]:
        """Build hires-fix ESRGAN workflow that starts from an uploaded image."""
        uploaded_name = cfg_data.get("_input_image_name")
        if not uploaded_name:
            print("[WorkflowBuilder] Missing uploaded image name for hires input workflow. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        lora_specs = self._parse_lora_chain(cfg_data)
        use_lora = len(lora_specs) > 0

        template_key = "hiresfix_esrgan_input_image_lora" if use_lora else "hiresfix_esrgan_input_image"
        template = self.workflow_templates.get(template_key)

        if not template and use_lora:
            print("[WorkflowBuilder] hiresfix_esrgan_input_image_lora template missing. Falling back to non-LoRA variant.")
            template = self.workflow_templates.get("hiresfix_esrgan_input_image")
            use_lora = False

        if not template:
            print("[WorkflowBuilder] hiresfix_esrgan_input_image template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        if isinstance(cfg_data, dict):
            cfg_data["_workflow_template"] = HIRESFIX_ESRGAN_INPUT_IMAGE_LORA_WORKFLOW_NAME if use_lora else HIRESFIX_ESRGAN_INPUT_IMAGE_WORKFLOW_NAME

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
            workflow, last_lora_id = self._inject_lora_chain(workflow, lora_specs)
            if last_lora_id is None:
                print("[WorkflowBuilder] Warning: Could not inject LoRA chain for hires input image template.")

        return workflow, "31"




    def _build_hiresfix_workflow(self, cfg_data: Dict[str, Any], seed: int, use_alpha: bool = False) -> Tuple[Dict[str, Any], str]:
        """Build hires-fix ESRGAN workflow with custom base64 output."""
        lora_specs = self._parse_lora_chain(cfg_data)
        use_lora = len(lora_specs) > 0

        template_key = "hiresfix_esrgan_lora" if use_lora else "hiresfix_esrgan"
        template = self.workflow_templates.get(template_key)

        if not template and use_lora:
            print("[WorkflowBuilder] hiresfix_esrgan_lora template missing. Falling back to hiresfix_esrgan.")
            template = self.workflow_templates.get("hiresfix_esrgan")
            use_lora = False

        if not template:
            print("[WorkflowBuilder] hiresfix_esrgan template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        if isinstance(cfg_data, dict):
            cfg_data["_workflow_template"] = HIRESFIX_ESRGAN_LORA_WORKFLOW_NAME if use_lora else HIRESFIX_ESRGAN_WORKFLOW_NAME

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
            workflow, last_lora_id = self._inject_lora_chain(workflow, lora_specs)
            if last_lora_id is None:
                print("[WorkflowBuilder] Warning: Could not inject LoRA chain for hires workflow.")

        output_node_id = "30"
        if output_node_id not in workflow:
            workflow[output_node_id] = {
                "inputs": {"images": ["13", 0]},
                "class_type": "ImageToBase64_Yuuka"
            }

        return workflow, output_node_id

    def _build_lora_workflow(self, cfg_data: Dict[str, Any], seed: int, use_alpha: bool = False) -> Tuple[Dict[str, Any], str]:
        """Xây dựng workflow sử dụng 1 hoặc nhiều LoRA từ template.
        Hỗ trợ chuỗi LoRA nối tiếp nhau theo mẫu: Checkpoint -> LoRA1 -> LoRA2 -> ... -> KSampler/CLIP.
        """
        if isinstance(cfg_data, dict):
            cfg_data["_workflow_template"] = SDXL_LORA_WORKFLOW_NAME

        template = self.workflow_templates.get("sdxl_lora")
        template = template or self.workflow_templates.get("sdxl") or self.workflow_templates.get("standard")
        if not template:
            # Không có template phù hợp => fallback standard
            print("⚠️ SDXL LoRA workflow template not found. Falling back to standard workflow.")
            return self._build_standard_workflow(cfg_data, seed)

        workflow = deepcopy(template)

        # Prompt & sampler params
        workflow.setdefault("4", {}).setdefault("inputs", {})["ckpt_name"] = cfg_data.get("ckpt_name", DEFAULT_CONFIG["ckpt_name"])
        if "6" in workflow:
            workflow["6"].setdefault("inputs", {})["text"] = cfg_data.get(COMBINED_TEXT_PROMPT_KEY, build_full_prompt_from_cfg(cfg_data))
        if "7" in workflow:
            workflow["7"].setdefault("inputs", {})["text"] = ", ".join(
                normalize_tag_list(
                    str(cfg_data.get("negative", DEFAULT_CONFIG["negative"]))
                )
            )

        if "5" in workflow:
            workflow["5"].setdefault("inputs", {})["width"] = cfg_data.get("width", DEFAULT_CONFIG["width"])
            workflow["5"].setdefault("inputs", {})["height"] = cfg_data.get("height", DEFAULT_CONFIG["height"])
            workflow["5"].setdefault("inputs", {})["batch_size"] = 1

        if "3" in workflow:
            workflow["3"].setdefault("inputs", {})["seed"] = seed
            workflow["3"].setdefault("inputs", {})["steps"] = cfg_data.get("steps", DEFAULT_CONFIG["steps"])
            workflow["3"].setdefault("inputs", {})["cfg"] = cfg_data.get("cfg", DEFAULT_CONFIG["cfg"])
            workflow["3"].setdefault("inputs", {})["sampler_name"] = cfg_data.get("sampler_name", DEFAULT_CONFIG["sampler_name"])
            workflow["3"].setdefault("inputs", {})["scheduler"] = cfg_data.get("scheduler", DEFAULT_CONFIG["scheduler"])

        # Inject multi-LoRA chain
        lora_specs = self._parse_lora_chain(cfg_data)
        if lora_specs:
            workflow, last_lora_id = self._inject_lora_chain(workflow, lora_specs)
            if last_lora_id is None:
                print("⚠️ Could not inject LoRA chain; proceeding without LoRA.")
        else:
            # Không có LoRA => nếu template vốn đòi LoRA thì vẫn chạy, nhưng không sửa dây.
            pass

        # Bảo đảm có node output base64
        output_node_id = None
        for nid, nd in workflow.items():
            if isinstance(nd, dict) and nd.get('class_type') == 'ImageToBase64_Yuuka':
                output_node_id = nid
                break
        if not output_node_id:
            # Tạo nhanh output node nối từ VAEDecode nếu có
            # Tìm VAEDecode node
            vae_decode_id = None
            for nid, nd in workflow.items():
                if isinstance(nd, dict) and nd.get('class_type') == 'VAEDecode':
                    vae_decode_id = nid
                    break
            if vae_decode_id is not None:
                # Tìm ID mới
                max_id = 0
                for k in workflow.keys():
                    try:
                        max_id = max(max_id, int(k))
                    except Exception:
                        continue
                output_node_id = str(max_id + 1)
                workflow[output_node_id] = {
                    "inputs": {"images": [vae_decode_id, 0]},
                    "class_type": "ImageToBase64_Yuuka",
                }
            else:
                # Thử các ID phổ biến
                output_node_id = "15" if "15" in workflow else ("9" if "9" in workflow else "15")

        return workflow, output_node_id
