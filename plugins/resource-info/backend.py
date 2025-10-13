# --- MODIFIED FILE: plugins/resource-info/backend.py ---
import os
import sys
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

class ResourceInfoPlugin:
    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('resource_info', __name__)
        self.static_info = {}
        # Yuuka: smart power v1.0 - Giá trị này sẽ được tính toán trong _fetch_static_info

        if psutil and cpuinfo:
            # Khởi tạo psutil để lần gọi sau có giá trị chính xác
            psutil.cpu_percent(interval=None) 
            self._fetch_static_info()
        
        @self.blueprint.route('/stats')
        def get_realtime_stats():
            if not self.static_info or not psutil:
                return jsonify({"error": "Plugin dependencies are not installed or failed to initialize."}), 500
            
            # --- Dữ liệu động ---
            # Yuuka: fast mode support v1.0 - Giảm interval để không block request
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
                except Exception:
                    # Bỏ qua lỗi nếu không đọc được GPU
                    pass
            
            cpu_power = 0.0
            if isinstance(self.static_info.get("cpu_tdp"), int):
                idle_power = self.static_info["cpu_tdp"] * 0.1
                power_range = self.static_info["cpu_tdp"] - idle_power
                cpu_power = idle_power + (power_range * cpu_usage / 100)

            # Yuuka: smart power v1.0 - Lấy giá trị đã tính toán
            other_power = self.static_info.get("other_power", 30)
            total_power = cpu_power + gpu_power + other_power

            return jsonify({
                **self.static_info,
                "cpu_usage": round(cpu_usage, 1),
                "cpu_power": round(cpu_power, 1),
                "gpu_usage": round(gpu_usage, 1),
                "gpu_power": round(gpu_power, 1),
                "other_power": other_power, # Yuuka: smart power v1.0
                "total_power": round(total_power, 1)
            })

    def _fetch_static_info(self):
        # --- Dữ liệu tĩnh ---
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
        
        # Yuuka: smart power v1.0 - Tính toán other_power
        try:
            total_ram_gb = round(psutil.virtual_memory().total / (1024**3))
            self.static_info["total_ram_gb"] = total_ram_gb
            # Ước tính công suất RAM: 2.5W cho mỗi 8GB
            ram_power = (total_ram_gb / 8) * 2.5
            # Công suất nền cho bo mạch chủ, ổ cứng, quạt...
            base_power = 30
            self.static_info["other_power"] = round(base_power + ram_power)
        except Exception:
            self.static_info["total_ram_gb"] = "N/A"
            self.static_info["other_power"] = 30 # Fallback

    def get_blueprint(self):
        return self.blueprint, '/api/plugin/resource-info'