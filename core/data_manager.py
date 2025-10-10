# --- MODIFIED FILE: core/data_manager.py ---
import os
import json
import threading
import base64
import time

class DataManager:
    """
    Quản lý việc đọc/ghi dữ liệu từ file JSON một cách an toàn (thread-safe).
    Tất cả các truy cập dữ liệu từ Lõi và Plugin đều phải thông qua class này.
    Bao gồm cả logic mã hóa/giải mã dữ liệu.
    """
    def __init__(self, cache_dir):
        self.cache_dir = cache_dir
        self._locks = {}
        self.B64_PREFIX = "b64:"
        self.OBFUSCATION_KEY = b'yuuka_is_the_best_sensei_at_millennium_seminar'
        os.makedirs(self.cache_dir, exist_ok=True)
        # Yuuka: new image paths v1.0 - Tạo các thư mục con cho ảnh gốc và preview
        os.makedirs(os.path.join(self.cache_dir, 'user_images', 'imgs'), exist_ok=True)
        os.makedirs(os.path.join(self.cache_dir, 'user_images', 'pv_imgs'), exist_ok=True)


    def get_path(self, filename: str) -> str:
        """Lấy đường dẫn đầy đủ tới file trong thư mục cache."""
        return os.path.join(self.cache_dir, filename)

    def _get_lock(self, filename: str) -> threading.Lock:
        """Lấy hoặc tạo một Lock riêng cho mỗi file để đảm bảo thread-safety."""
        # Yuuka: Dùng `setdefault` để thao tác này cũng là thread-safe.
        return self._locks.setdefault(filename, threading.Lock())

    # --- Yuuka: Logic mã hóa/giải mã Base64 được chuyển vào đây ---
    def _encode_string_b64(self, s: str) -> str:
        encoded = base64.b64encode(s.encode('utf-8')).decode('utf-8')
        return f"{self.B64_PREFIX}{encoded}"

    def _decode_string_b64(self, s: str) -> str:
        if s.startswith(self.B64_PREFIX):
            try:
                b64_part = s[len(self.B64_PREFIX):]
                return base64.b64decode(b64_part.encode('utf-8')).decode('utf-8')
            except Exception:
                # Nếu giải mã lỗi, trả về chuỗi gốc để tránh crash
                return s
        return s

    def _process_data_recursive(self, data, process_func, process_keys=True):
        """Hàm đệ quy để xử lý dữ liệu, có tùy chọn bỏ qua xử lý key."""
        if isinstance(data, dict):
            processed_dict = {}
            for k, v in data.items():
                # Yuuka: data migration fix v1.1 - Chỉ xử lý key nếu được yêu cầu
                processed_key = process_func(k) if process_keys else k
                processed_dict[processed_key] = self._process_data_recursive(v, process_func, process_keys)
            return processed_dict
        elif isinstance(data, list):
            return [self._process_data_recursive(item, process_func, process_keys) for item in data]
        elif isinstance(data, str):
            # Yuuka: Bỏ qua các URL ảnh khỏi quá trình xử lý
            if data.startswith('/user_image/'):
                return data
            return process_func(data)
        return data

    def read_json(self, filename, default_value={}, obfuscated=False):
        path = self.get_path(filename)
        lock = self._get_lock(filename)
        with lock:
            if not os.path.exists(path):
                return default_value
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if obfuscated:
                    # Yuuka: data migration fix v1.1 - img_data.json có key là hash (không mã hóa)
                    # Các file khác có thể có key mã hóa.
                    process_keys = filename != "img_data.json"
                    return self._process_data_recursive(data, self._decode_string_b64, process_keys=process_keys)
                return data
            except (json.JSONDecodeError, IOError):
                print(f"⚠️ [DataManager] Could not read or decode {path}. Returning default.")
                return default_value

    def save_json(self, data, filename, obfuscated=False):
        path = self.get_path(filename)
        lock = self._get_lock(filename)
        with lock:
            try:
                data_to_save = data
                if obfuscated:
                    # Yuuka: data migration fix v1.1 - Xử lý tương tự khi lưu
                    process_keys = filename != "img_data.json"
                    data_to_save = self._process_data_recursive(data, self._encode_string_b64, process_keys=process_keys)
                
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(data_to_save, f, indent=2)
                return True
            except IOError as e:
                print(f"💥 [DataManager] CRITICAL ERROR: Could not write data to {path}. Error: {e}")
                return False

    def load_user_data(self, filename, user_hash, default_value={}, obfuscated=False):
        """Đọc dữ liệu của một user cụ thể từ một file JSON lớn."""
        all_data = self.read_json(filename, default_value={}, obfuscated=obfuscated)
        return all_data.get(user_hash, default_value)

    def save_user_data(self, data_to_save, filename, user_hash, obfuscated=False):
        """Lưu dữ liệu cho một user cụ thể vào một file JSON lớn."""
        # Yuuka: Đọc toàn bộ dữ liệu trước để không ghi đè dữ liệu của user khác.
        all_data = self.read_json(filename, default_value={}, obfuscated=obfuscated)
        all_data[user_hash] = data_to_save
        return self.save_json(all_data, filename, obfuscated=obfuscated)

    # --- Yuuka: Các hàm xử lý file nhị phân (ảnh) ---
    def read_binary(self, filename: str) -> bytes | None:
        path = self.get_path(filename)
        lock = self._get_lock(filename)
        with lock:
            if not os.path.exists(path): return None
            try:
                with open(path, 'rb') as f:
                    return f.read()
            except IOError:
                return None

    def save_binary(self, data: bytes, filename: str) -> bool:
        path = self.get_path(filename)
        lock = self._get_lock(filename)
        with lock:
            try:
                with open(path, 'wb') as f:
                    f.write(data)
                return True
            except IOError:
                return False
    
    def obfuscate_binary(self, data: bytes) -> bytes:
        """Mã hóa dữ liệu nhị phân bằng phép XOR đơn giản."""
        return bytes([
            b ^ self.OBFUSCATION_KEY[i % len(self.OBFUSCATION_KEY)] 
            for i, b in enumerate(data)
        ])
        
    def deobfuscate_binary(self, obfuscated_data: bytes) -> bytes:
        """Giải mã dữ liệu nhị phân."""
        # Yuuka: Phép XOR có tính đối xứng, nên hàm giải mã giống hệt hàm mã hóa.
        return self.obfuscate_binary(obfuscated_data)