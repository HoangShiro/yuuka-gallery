# --- MODIFIED FILE: integrations/comfy_api_client.py ---
import json
import urllib.request
import urllib.parse
from typing import List, Dict, Any, Optional

import requests

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
        "upscale_models": _extract_choices_from_info(all_nodes_info, "UpscaleModelLoader", "model_name"),
        "upscale_methods": _extract_choices_from_info(all_nodes_info, "ImageScale", "upscale_method"),
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

# Yuuka: scene cancel v1.0
def interrupt_execution(server_address: str) -> bool:
    """
    Attempts to interrupt the currently executing task on the ComfyUI server.
    Sends a POST request to /interrupt.
    Returns True if the request was likely successful (200 OK), False otherwise.
    Note: This interrupts the *current* task, not a specific one by ID from this endpoint.
    """
    req = urllib.request.Request(f"http://{server_address}/interrupt", method='POST')
    try:
        with urllib.request.urlopen(req) as response:
            print(f"Interrupt request to {server_address} returned status: {response.status}")
            return response.status == 200
    except urllib.error.URLError as e:
        print(f"Failed to interrupt execution at {server_address} (URLError): {e.reason}")
    except Exception as e:
        print(f"Failed to interrupt execution at {server_address} (Exception): {e}")
    return False

# Yuuka: scene cancel v1.0
def delete_queued_item(prompt_id: str, server_address: str) -> bool:
    """
    Attempts to delete a specific item from the ComfyUI queue using its prompt_id.
    Sends a POST request to /queue with a payload like {"delete": ["prompt_id"]}.
    Returns True if the deletion was likely successful (200 OK, or 404 if not found), False otherwise.
    """
    payload = {"delete": [prompt_id]}
    headers = {'Content-Type': 'application/json'}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(f"http://{server_address}/queue", data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as response:
            print(f"Delete queued item {prompt_id} request to {server_address} returned status: {response.status}")
            # ComfyUI returns the queue state on successful deletion.
            return response.status == 200
    except urllib.error.HTTPError as e:
        # If ComfyUI returns 404, it means the prompt_id was not found in the queue.
        # This can be considered a "successful" deletion attempt if the goal is to ensure it's not queued.
        if e.code == 404:
            print(f"Prompt {prompt_id} not found in queue at {server_address} for deletion (HTTP 404). It might have been processed or was never queued/invalid.")
            return True 
        print(f"Failed to delete queued item {prompt_id} from {server_address} (HTTPError {e.code}): {e.reason}")
        try:
            error_body = e.read().decode('utf-8', errors='ignore')
            print(f"Error body from delete_queued_item: {error_body[:200]}")
        except Exception:
            pass # Ignore if reading error body fails
    except urllib.error.URLError as e:
        print(f"Failed to delete queued item {prompt_id} from {server_address} (URLError): {e.reason}")
    except Exception as e:
        print(f"Failed to delete queued item {prompt_id} from {server_address} (Exception): {e}")
    return False


def upload_image_bytes(image_bytes: bytes, filename: str, server_address: str) -> str:
    """
    Uploads raw image bytes to the ComfyUI /upload/image endpoint and returns the stored filename.
    """
    files = {'image': (filename, image_bytes, 'image/png')}
    data = {'overwrite': 'true'}
    try:
        response = requests.post(
            f"http://{server_address}/upload/image",
            files=files,
            data=data,
            timeout=10
        )
        response.raise_for_status()
        payload = response.json()
        stored_name = payload.get('name') or filename
        return stored_name
    except requests.RequestException as err:
        raise ConnectionError(f"Failed to upload image to ComfyUI at {server_address}: {err}") from err
