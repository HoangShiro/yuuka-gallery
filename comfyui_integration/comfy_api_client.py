# --- MODIFIED FILE: comfyui_integration/comfy_api_client.py ---
import json
import urllib.request
import urllib.parse
from typing import List, Dict, Any, Optional

def get_all_nodes_info_sync(server_address: str) -> Optional[Dict[str, Any]]:
    """
    Yuuka: Hàm mới hiệu quả hơn, lấy tất cả object_info một lần.
    Hàm này kết nối đến endpoint /object_info của ComfyUI để lấy thông tin về tất cả các node đã đăng ký.
    """
    try:
        with urllib.request.urlopen(f"http://{server_address}/object_info", timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read())
            else:
                print(f"[API Client] Lỗi khi lấy object_info: Status {response.status}")
                return None
    except Exception as e:
        print(f"[API Client] Lỗi nghiêm trọng khi lấy toàn bộ object_info: {e}")
        return None

def _extract_choices_from_info(
    all_nodes_info: Dict[str, Any],
    node_class: str,
    param_name: str
) -> List[str]:
    """
    Yuuka: Helper function để trích xuất dữ liệu an toàn từ cấu trúc JSON đã được tải về.
    """
    if not all_nodes_info:
        return []
    try:
        # Truy cập vào cấu trúc JSON để lấy danh sách lựa chọn
        choices = all_nodes_info.get(node_class, {})\
                                .get("input", {})\
                                .get("required", {})\
                                .get(param_name, [[]])[0]
        # Đảm bảo kết quả trả về là một list
        return choices if isinstance(choices, list) else []
    except Exception as e:
        print(f"[API Client] Lỗi khi trích xuất '{param_name}' từ node '{node_class}': {e}")
        return []

def get_full_object_info(server_address: str) -> Dict[str, List[str]]:
    """
    Yuuka: Sửa lại hàm chính để sử dụng logic mới.
    Lấy tất cả các danh sách lựa chọn cần thiết (LoRA, checkpoints, samplers, etc.)
    từ ComfyUI API để điền vào các dropdown trong giao diện.
    """
    print("[API Client] Đang lấy thông tin các lựa chọn từ ComfyUI (single call)...")
    all_nodes_info = get_all_nodes_info_sync(server_address)

    if not all_nodes_info:
        print("[API Client] Không thể lấy thông tin từ ComfyUI. Trả về danh sách trống.")
        return {
            "loras": [], "checkpoints": [], "samplers": [], "schedulers": []
        }

    info = {
        "loras": _extract_choices_from_info(all_nodes_info, "LoraLoader", "lora_name"),
        "checkpoints": _extract_choices_from_info(all_nodes_info, "CheckpointLoaderSimple", "ckpt_name"),
        "samplers": _extract_choices_from_info(all_nodes_info, "KSampler", "sampler_name"),
        "schedulers": _extract_choices_from_info(all_nodes_info, "KSampler", "scheduler"),
    }
    
    # Loại bỏ các giá trị không hợp lệ nếu có
    info["checkpoints"] = [name for name in info["checkpoints"] if name != "None"]
    
    print(f"[API Client] Lấy thông tin thành công: {len(info['loras'])} LoRAs, {len(info['checkpoints'])} Checkpoints...")
    return info

def queue_prompt(prompt_workflow: dict, client_id: str, server_address: str) -> dict:
    p = {"prompt": prompt_workflow, "client_id": client_id}
    headers = {'Content-Type': 'application/json'}
    data = json.dumps(p).encode('utf-8')
    req = urllib.request.Request(f"http://{server_address}/prompt", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            if response.status != 200:
                error_body = response.read().decode('utf-8', errors='ignore')
                raise ConnectionError(f"ComfyUI API Error ({response.status}) queuing prompt. Details: {error_body[:500]}")
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='ignore')
            error_msg = f"Could not queue prompt ({e.code} {e.reason})."
            if e.code == 400: error_msg += " Often an invalid workflow. Check ComfyUI logs."
            error_msg += f" Details: {error_body[:500]}"
            raise ConnectionError(error_msg) from e
    except urllib.error.URLError as e:
        raise ConnectionError(f"Could not connect to ComfyUI API at {server_address} to queue prompt. ({e.reason})") from e
    except json.JSONDecodeError as e:
        raise ValueError("Invalid JSON response from ComfyUI API during queueing.") from e

def get_history(prompt_id: str, server_address: str) -> dict:
    try:
        with urllib.request.urlopen(f"http://{server_address}/history/{prompt_id}") as response:
            if response.status != 200:
                error_body = response.read().decode('utf-8', errors='ignore')
                raise ConnectionError(f"ComfyUI API Error ({response.status}) getting history. Details: {error_body[:500]}")
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='ignore')
            raise ConnectionError(f"Could not get history ({e.code} {e.reason}). Details: {error_body[:500]}") from e
    except urllib.error.URLError as e:
        raise ConnectionError(f"Could not connect to ComfyUI API for history. ({e.reason})") from e
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON for history/{prompt_id}.") from e

def get_image(filename: str, subfolder: str, folder_type: str, server_address: str) -> bytes:
    data = {"filename": filename, "subfolder": subfolder, "type": folder_type}
    url_values = urllib.parse.urlencode(data)
    try:
        with urllib.request.urlopen(f"http://{server_address}/view?{url_values}") as response:
            if response.status != 200:
                error_body = response.read().decode('utf-8', errors='ignore')
                raise ConnectionError(f"ComfyUI API Error ({response.status}) getting image. Details: {error_body[:500]}")
            return response.read()
    except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='ignore')
            raise ConnectionError(f"Could not get image ({e.code} {e.reason}). Details: {error_body[:500]}") from e
    except urllib.error.URLError as e:
        raise ConnectionError(f"Could not connect to ComfyUI API for image viewing. ({e.reason})") from e

def get_queue_details_sync(server_address: str) -> dict:
    try:
        req = urllib.request.Request(f"http://{server_address}/queue")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read())
            else:
                print(f"Error getting queue details: {response.status}")
                return {}
    except Exception as e:
        print(f"Exception getting queue details: {e}")
        return {}