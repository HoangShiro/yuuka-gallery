# --- MODIFIED FILE: plugins/resource-info/backend.py ---
import os
import sys
import time
import datetime
from flask import Blueprint, jsonify

# Yuuka: resource-info v1.0 - Import dependencies
try:
    import psutil
    import cpuinfo
    import GPUtil
    GPUTIL_AVAILABLE = True
except ImportError as e:
    print(f"Lỗi import cho plugin resource-info: {e}. Plugin sẽ không hoạt động.")
    psutil = None
    cpuinfo = None
    GPUtil = None
    GPUTIL_AVAILABLE = False

# --- CƠ SỞ DỮ LIỆU CÔNG SUẤT THIẾT KẾ NHIỆT (TDP/TGP) TỪ w.py ---
CPU_TDP_DB = {
    # Intel Core Ultra (Meteor Lake)
    "Intel(R) Core(TM) Ultra 9 185H": 45, # Base Power
    "Intel(R) Core(TM) Ultra 7 165H": 28, # Base Power
    "Intel(R) Core(TM) Ultra 7 155H": 28, # Base Power
    "Intel(R) Core(TM) Ultra 5 135H": 28, # Base Power
    "Intel(R) Core(TM) Ultra 5 125H": 28, # Base Power
    # Intel Gen 14 (Raptor Lake Refresh)
    "Intel(R) Core(TM) i9-14900K": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i9-14900KF": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i7-14700K": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i7-14700KF": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i5-14600K": 125, # Base Power, Turbo lên tới 181W
    "Intel(R) Core(TM) i5-14600KF": 125, # Base Power, Turbo lên tới 181W
    # Intel Gen 13 (Raptor Lake)
    "Intel(R) Core(TM) i9-13900K": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i9-13900KF": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i7-13700K": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i7-13700KF": 125, # Base Power, Turbo lên tới 253W
    "Intel(R) Core(TM) i5-13600K": 125, # Base Power, Turbo lên tới 181W
    "Intel(R) Core(TM) i5-13600KF": 125, # Base Power, Turbo lên tới 181W
    # Intel Gen 12 (Alder Lake)
    "Intel(R) Core(TM) i9-12900K": 125, # Base Power, Turbo lên tới 241W
    "Intel(R) Core(TM) i9-12900KF": 125, # Base Power, Turbo lên tới 241W
    "Intel(R) Core(TM) i7-12700K": 125, # Base Power, Turbo lên tới 190W
    "Intel(R) Core(TM) i7-12700KF": 125, # Base Power, Turbo lên tới 190W
    "Intel(R) Core(TM) i5-12600K": 125, # Base Power, Turbo lên tới 150W
    "Intel(R) Core(TM) i5-12600KF": 125, # Base Power, Turbo lên tới 150W,
}

GPU_TDP_DB = {
    # NVIDIA RTX 50 Series
    "NVIDIA GeForce RTX 5090": 575,
    "NVIDIA GeForce RTX 5080": 360,
    "NVIDIA GeForce RTX 5070 Ti": 300,
    "NVIDIA GeForce RTX 5070": 250,
    "NVIDIA GeForce RTX 5060 Ti": 180,
    "NVIDIA GeForce RTX 5060": 145,
    "NVIDIA GeForce RTX 5050": 130,
    # NVIDIA RTX 40 Series (Ada Lovelace)
    "NVIDIA GeForce RTX 4090 D": 425,
    "NVIDIA GeForce RTX 4090": 450,
    "NVIDIA GeForce RTX 4080 SUPER": 320,
    "NVIDIA GeForce RTX 4080": 320,
    "NVIDIA GeForce RTX 4070 Ti SUPER": 285,
    "NVIDIA GeForce RTX 4070 Ti": 285,
    "NVIDIA GeForce RTX 4070 SUPER": 220,
    "NVIDIA GeForce RTX 4070": 200,
    "NVIDIA GeForce RTX 4060 Ti": 160,
    "NVIDIA GeForce RTX 4060": 115,
    # NVIDIA RTX 30 Series (Ampere)
    "NVIDIA GeForce RTX 3090 Ti": 450,
    "NVIDIA GeForce RTX 3090": 350,
    "NVIDIA GeForce RTX 3080 Ti": 350,
    "NVIDIA GeForce RTX 3080": 320,
    "NVIDIA GeForce RTX 3070 Ti": 290,
    "NVIDIA GeForce RTX 3070": 220,
    "NVIDIA GeForce RTX 3060 Ti": 200,
    "NVIDIA GeForce RTX 3060": 170,
    "NVIDIA GeForce RTX 3050": 130,
}

# Yuuka: cost calculation v1.0
COST_1K_PER_HOUR = 2500  # vnđ
AVE_IDLE_W = 75         # Công suất trung bình khi nghỉ
AVE_GEN_W = 350         # Công suất trung bình khi tạo ảnh

class ResourceInfoPlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('resource_info', __name__)
        self.static_info = {}

        if psutil and cpuinfo:
            psutil.cpu_percent(interval=None) 
            self._fetch_static_info()
        
        @self.blueprint.route('/stats')
        def get_realtime_stats():
            if not self.static_info or not psutil:
                return jsonify({"error": "Plugin dependencies are not installed or failed to initialize."}), 500
            
            try:
                user_hash = self.core_api.verify_token_and_get_user_hash()
            except Exception as e:
                return jsonify({"error": str(e)}), 401

            # --- Dữ liệu động ---
            cpu_usage = psutil.cpu_percent(interval=0.1)
            gpu_usage = 0.0
            gpu_power = 0.0
            if self.static_info.get("gpu_tdp") != "N/A" and GPUTIL_AVAILABLE:
                try:
                    gpu = GPUtil.getGPUs()[0]
                    gpu_usage = gpu.load * 100
                    if isinstance(self.static_info["gpu_tdp"], int):
                        idle_power = self.static_info["gpu_tdp"] * 0.1
                        power_range = self.static_info["gpu_tdp"] - idle_power
                        gpu_power = idle_power + (power_range * gpu_usage / 100)
                except Exception: pass
            
            cpu_power = 0.0
            if isinstance(self.static_info.get("cpu_tdp"), int):
                idle_power = self.static_info["cpu_tdp"] * 0.1
                power_range = self.static_info["cpu_tdp"] - idle_power
                cpu_power = idle_power + (power_range * cpu_usage / 100)
            
            other_power = self.static_info.get("other_power", 30)
            total_power = cpu_power + gpu_power + other_power

            # --- Yuuka: cost calculation v1.1 - Đọc uptime từ file lõi ---
            now = datetime.datetime.now()
            start_of_month_ts = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()

            server_info = self.core_api.read_data("server_info.json", obfuscated=False)
            stored_uptime_sec = server_info.get('month_server_uptime', 0)
            last_saved_ts = server_info.get('last_saved_timestamp', time.time())
            
            # Tính toán uptime thời gian thực bằng cách cộng thêm delta từ lần lưu cuối
            realtime_month_uptime_sec = stored_uptime_sec + (time.time() - last_saved_ts)
            month_server_uptime_hours = realtime_month_uptime_sec / 3600

            all_images_data = self.core_api.read_data("img_data.json", obfuscated=True)
            user_images_this_month = []
            all_images_this_month = []

            if all_images_data:
                for u_hash, characters in all_images_data.items():
                    if isinstance(characters, dict):
                        for char_hash, images in characters.items():
                            if isinstance(images, list):
                                for img in images:
                                    if img.get('createdAt', 0) >= start_of_month_ts and 'creationTime' in img:
                                        all_images_this_month.append(img)
                                        if u_hash == user_hash:
                                            user_images_this_month.append(img)
            
            month_total_img_user = len(user_images_this_month)
            month_total_img_all = len(all_images_this_month)
            month_gen_time_user_sec = sum(img['creationTime'] for img in user_images_this_month)
            ave_gen_time_user = (month_gen_time_user_sec / month_total_img_user) if month_total_img_user > 0 else 0
            
            cost_per_hour_idle = COST_1K_PER_HOUR / (1000 / AVE_IDLE_W)
            month_cost_idle_server = cost_per_hour_idle * month_server_uptime_hours
            
            user_share_percent = (month_total_img_user / month_total_img_all) if month_total_img_all > 0 else 0
            month_cost_idle_user = month_cost_idle_server * user_share_percent

            cost_per_second_gen = (COST_1K_PER_HOUR / (1000 / AVE_GEN_W)) / 3600
            cost_per_imgs_total_user = cost_per_second_gen * month_gen_time_user_sec

            month_cost_user_total = month_cost_idle_user + cost_per_imgs_total_user
            cost_per_img_avg_user = (month_cost_user_total / month_total_img_user) if month_total_img_user > 0 else 0

            return jsonify({
                **self.static_info,
                "cpu_usage": round(cpu_usage, 1),
                "cpu_power": round(cpu_power, 1),
                "gpu_usage": round(gpu_usage, 1),
                "gpu_power": round(gpu_power, 1),
                "other_power": other_power,
                "total_power": round(total_power, 1),
                # --- Dữ liệu thống kê mới ---
                "month_server_uptime": realtime_month_uptime_sec, # Yuuka: Gửi giá trị chính xác
                "month_gen_time": month_gen_time_user_sec,
                "ave_gen_time": ave_gen_time_user,
                "month_gen_count": month_total_img_user,
                "month_cost_user": month_cost_user_total,
                "cost_per_img": cost_per_img_avg_user
            })

    def _fetch_static_info(self):
        try:
            cpu_name = cpuinfo.get_cpu_info()['brand_raw']
            self.static_info["cpu_name"] = cpu_name
            self.static_info["cpu_tdp"] = CPU_TDP_DB.get(cpu_name, "N/A")
        except Exception:
            self.static_info["cpu_name"] = "Không xác định"
            self.static_info["cpu_tdp"] = "N/A"

        self.static_info["gpu_name"] = "Không có"
        self.static_info["gpu_tdp"] = "N/A"
        if GPUTIL_AVAILABLE:
            try:
                gpus = GPUtil.getGPUs()
                if gpus:
                    gpu = gpus[0]
                    self.static_info["gpu_name"] = gpu.name
                    self.static_info["gpu_tdp"] = GPU_TDP_DB.get(gpu.name, "N/A")
                else:
                    self.static_info["gpu_name"] = "Không tìm thấy GPU NVIDIA"
            except Exception:
                self.static_info["gpu_name"] = "Lỗi đọc GPU"
        
        try:
            total_ram_gb = round(psutil.virtual_memory().total / (1024**3))
            self.static_info["total_ram_gb"] = total_ram_gb
            ram_power = (total_ram_gb / 8) * 2.5
            base_power = 30
            self.static_info["other_power"] = round(base_power + ram_power)
        except Exception:
            self.static_info["total_ram_gb"] = "N/A"
            self.static_info["other_power"] = 30

    def get_blueprint(self):
        return self.blueprint, '/api/plugin/resource-info'