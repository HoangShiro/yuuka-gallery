import os
import json
import re
import time
from typing import Optional

import requests
from dotenv import load_dotenv
import folder_paths
from server import PromptServer


class YuukaLoraDownloader:
    """
    Custom node that downloads a LoRA from Civitai and keeps interested
    frontends informed about the progress by emitting websocket events.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "civitai_url": (
                    "STRING",
                    {"multiline": False, "default": "https://civitai.com/models/..."},
                )
            },
            "optional": {
                "api_key": ("STRING", {"multiline": False, "default": ""}),
                "tracking_id": ("STRING", {"multiline": False, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("lora_name",)
    FUNCTION = "download_lora"
    CATEGORY = "yuuka_nodes/Loaders"
    OUTPUT_NODE = True

    def _get_api_key(self, api_key_input: str) -> str:
        if api_key_input:
            return api_key_input

        custom_nodes_dir = os.path.dirname(__file__)
        candidates = [
            os.path.join(custom_nodes_dir, ".env"),
            os.path.join(os.path.dirname(os.path.abspath(folder_paths.__file__)), ".env"),
        ]
        for path in candidates:
            if os.path.exists(path):
                load_dotenv(dotenv_path=path)
                found_key = os.getenv("CIVITAI_API_KEY")
                if found_key:
                    return found_key
        return ""

    def _emit_status(self, tracking_id: str, status: str, message: str, **extra):
        """Send progress/status updates to ComfyUI websocket clients."""
        if not tracking_id:
            return
        payload = {"tracking_id": tracking_id, "status": status, "message": message}
        payload.update(extra)
        try:
            PromptServer.instance.send_sync("yuuka.lora_downloader", payload)
        except Exception as exc:
            print(f"[Yuuka Lora Downloader] Failed to emit status: {exc}")

    def download_lora(self, civitai_url: str, api_key: str = "", tracking_id: str = ""):
        api_key = self._get_api_key(api_key)
        print(f"[Yuuka Lora Downloader] Begin request for URL: {civitai_url}")

        if not api_key:
            error_msg = "Loi: Khong tim thay CIVITAI_API_KEY"
            print(f"[Yuuka Lora Downloader] {error_msg}")
            self._emit_status(tracking_id, "error", error_msg)
            return (error_msg,)

        match = re.search(r"/models/(\d+)", civitai_url.strip())
        if not match:
            error_msg = "Loi: Link Civitai khong hop le."
            print(f"[Yuuka Lora Downloader] {error_msg} - {civitai_url}")
            self._emit_status(tracking_id, "error", error_msg)
            return (error_msg,)

        model_id = match.group(1)
        headers = {"Authorization": f"Bearer {api_key}"}
        details_url = f"https://civitai.com/api/v1/models/{model_id}"
        self._emit_status(
            tracking_id,
            "info",
            "Fetching model details",
            step="fetch_details",
            model_id=model_id,
        )

        try:
            model_resp = requests.get(details_url, headers=headers, timeout=15)
            model_resp.raise_for_status()
            model_data = model_resp.json()
        except requests.exceptions.RequestException as exc:
            error_msg = f"Loi: Khong lay duoc thong tin model: {exc}"
            print(f"[Yuuka Lora Downloader] {error_msg}")
            self._emit_status(tracking_id, "error", error_msg)
            return (error_msg,)

        model_type = (model_data.get("type") or "").lower()
        if model_type != "lora":
            error_msg = f"Loi: Model nay khong phai LORA (Loai: {model_type})."
            print(f"[Yuuka Lora Downloader] {error_msg}")
            self._emit_status(tracking_id, "error", error_msg, model_type=model_type)
            return (error_msg,)

        valid_file_info = self._select_file(model_data)
        if not valid_file_info:
            error_msg = "Loi: Khong tim thay file LoRA .safetensors nao de tai."
            print(f"[Yuuka Lora Downloader] {error_msg}")
            self._emit_status(tracking_id, "error", error_msg)
            return (error_msg,)

        lora_filename = valid_file_info["name"]
        download_url = valid_file_info["downloadUrl"]
        expected_size_kb = valid_file_info.get("sizeKB", 0)
        expected_bytes = int(expected_size_kb * 1024)

        loras_dir = folder_paths.get_folder_paths("loras")[0]
        file_path = os.path.join(loras_dir, lora_filename)

        self._emit_status(
            tracking_id,
            "info",
            "Preparing download",
            step="prepare_download",
            filename=lora_filename,
            expected_size_kb=expected_size_kb,
        )

        if os.path.exists(file_path) and self._is_same_size(file_path, expected_bytes):
            print(f"[Yuuka Lora Downloader] File '{lora_filename}' already up-to-date.")
            self._save_metadata(model_data, loras_dir, lora_filename)
            self._emit_status(
                tracking_id,
                "completed",
                "LoRA already available. Metadata refreshed.",
                filename=lora_filename,
                was_cached=True,
                model_data=model_data,
            )
            return (lora_filename,)

        try:
            print(f"[Yuuka Lora Downloader] Downloading '{lora_filename}' ...")
            self._perform_download(
                download_url,
                headers,
                file_path,
                tracking_id,
                lora_filename,
                expected_bytes,
            )
            print(f"[Yuuka Lora Downloader] Download finished for '{lora_filename}'.")
            self._save_metadata(model_data, loras_dir, lora_filename)
            self._emit_status(
                tracking_id,
                "completed",
                "Download completed.",
                filename=lora_filename,
                was_cached=False,
                model_data=model_data,
            )
            return (lora_filename,)
        except Exception as exc:
            error_msg = f"Loi khi tai/ghi file: {exc}"
            print(f"[Yuuka Lora Downloader] {error_msg}")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except OSError:
                    pass
            self._emit_status(tracking_id, "error", error_msg, filename=lora_filename)
            return (error_msg,)

    def _select_file(self, model_data: dict) -> Optional[dict]:
        for version in model_data.get("modelVersions", []):
            for file_obj in version.get("files", []):
                is_safetensors = file_obj.get("name", "").lower().endswith(".safetensors")
                if is_safetensors and file_obj.get("type") == "Model":
                    return file_obj
        return None

    def _is_same_size(self, file_path: str, expected_bytes: int) -> bool:
        if expected_bytes <= 0:
            return False
        actual_size = os.path.getsize(file_path)
        return abs(actual_size - expected_bytes) < 2048

    def _perform_download(
        self,
        download_url: str,
        headers: dict,
        file_path: str,
        tracking_id: str,
        filename: str,
        expected_bytes: int,
    ):
        downloaded = 0
        last_emit = time.monotonic()
        last_percent = -1

        self._emit_status(
            tracking_id,
            "downloading",
            "Download started.",
            filename=filename,
            total_bytes=expected_bytes,
        )

        with requests.get(download_url, headers=headers, stream=True, timeout=600) as response:
            response.raise_for_status()
            with open(file_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=8192):
                    if not chunk:
                        continue
                    handle.write(chunk)
                    downloaded += len(chunk)
                    percent = None
                    if expected_bytes > 0:
                        percent = int(min(downloaded / expected_bytes, 1.0) * 100)
                    now = time.monotonic()
                    if percent is None or percent != last_percent or (now - last_emit) > 0.75:
                        self._emit_status(
                            tracking_id,
                            "downloading",
                            "Downloading...",
                            filename=filename,
                            bytes_downloaded=downloaded,
                            total_bytes=expected_bytes,
                            progress_percent=percent,
                        )
                        last_emit = now
                        last_percent = percent if percent is not None else last_percent

    def _save_metadata(self, model_data: dict, loras_dir: str, lora_filename: str):
        info_path = os.path.join(loras_dir, f"{os.path.splitext(lora_filename)[0]}.json")
        try:
            with open(info_path, "w", encoding="utf-8") as handle:
                json.dump(model_data, handle, indent=4)
            print(f"[Yuuka Lora Downloader] Metadata saved for {lora_filename}.")
        except Exception as exc:
            print(f"[Yuuka Lora Downloader] Failed to write metadata: {exc}")


NODE_CLASS_MAPPINGS = {
    "Yuuka_Lora_Downloader": YuukaLoraDownloader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Yuuka_Lora_Downloader": "Lora Downloader (by Yuuka)",
}
