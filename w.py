import cpuinfo
import psutil
import time
import os

try:
    import GPUtil
    GPUTIL_AVAILABLE = True
except ImportError:
    GPUTIL_AVAILABLE = False

# --- CƠ SỞ DỮ LIỆU CÔNG SUẤT THIẾT KẾ NHIỆT (TDP/TGP) ---
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
    "Intel(R) Core(TM) i5-12600KF": 125, # Base Power, Turbo lên tới 150W
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

# --- Ước tính công suất cho các linh kiện khác (W) ---
# Giữ nguyên như trước

def get_cpu_info():
    """Lấy thông tin và TDP của CPU."""
    try:
        cpu_name = cpuinfo.get_cpu_info()['brand_raw']
        tdp = CPU_TDP_DB.get(cpu_name, "Không có dữ liệu")
        return cpu_name, tdp
    except Exception as e:
        return "Không thể xác định CPU", f"Lỗi: {e}"

def get_gpu_info():
    """Lấy thông tin GPU chỉ bằng GPUtil."""
    if not GPUTIL_AVAILABLE:
        return "Thư viện GPUtil chưa được cài đặt", "N/A"
    try:
        gpu = GPUtil.getGPUs()[0]
        gpu_name = gpu.name
        tdp = GPU_TDP_DB.get(gpu_name, "Không có dữ liệu")
        return gpu_name, tdp
    except IndexError:
        return "Không tìm thấy GPU nào", "N/A"
    except Exception as e:
        return "Lỗi khi dùng GPUtil", f"{e}"

def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def real_time_monitoring(cpu_tdp, gpu_tdp):
    """
    Hiển thị thông tin tải và công suất tiêu thụ ước tính của hệ thống
    dựa trên % tải và TDP/TGP.
    """
    print("\n--- GIÁM SÁT CÔNG SUẤT ƯỚC TÍNH (THỜI GIAN THỰC) ---")
    print("Công suất CPU/GPU được ước tính dựa trên % tải và TDP/TGP.")
    print("(Nhấn Ctrl+C để dừng)")
    
    IDLE_FACTOR = 0.1  # Giả định công suất nghỉ bằng 10% TDP/TGP

    try:
        while True:
            # --- CPU ---
            cpu_usage_percent = psutil.cpu_percent(interval=1)
            cpu_power_float = 0.0
            estimated_cpu_power_str = "N/A"
            if isinstance(cpu_tdp, int):
                idle_power = cpu_tdp * IDLE_FACTOR
                power_range = cpu_tdp - idle_power
                cpu_power_float = idle_power + (power_range * cpu_usage_percent / 100)
                estimated_cpu_power_str = f"{cpu_power_float:.1f} W"

            # --- GPU ---
            gpu_power_float = 0.0
            estimated_gpu_power_str = "N/A"
            gpu_load_percent = 0.0
            if GPUTIL_AVAILABLE and isinstance(gpu_tdp, int):
                try:
                    gpu = GPUtil.getGPUs()[0]
                    gpu_load_percent = gpu.load * 100  # GPUtil trả về dạng 0.0 -> 1.0
                    idle_power = gpu_tdp * IDLE_FACTOR
                    power_range = gpu_tdp - idle_power
                    gpu_power_float = idle_power + (power_range * gpu_load_percent / 100)
                    estimated_gpu_power_str = f"{gpu_power_float:.1f} W"
                except Exception:
                    estimated_gpu_power_str = "Lỗi đọc"
            
            # --- Tổng cộng ---
            total_power = cpu_power_float + gpu_power_float
            total_power_str = f"Tổng (CPU+GPU): {total_power:.1f} W" if total_power > 0 else ""

            # --- In ra màn hình ---
            cpu_part = f"CPU: {cpu_usage_percent:5.1f}% ({estimated_cpu_power_str})"
            gpu_part = f"GPU: {gpu_load_percent:5.1f}% ({estimated_gpu_power_str})"
            
            print(f"\r{cpu_part} | {gpu_part} | {total_power_str}      ", end="")
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n\nĐã dừng giám sát.")
    except Exception as e:
        print(f"\nLỗi khi giám sát: {e}")

def main():
    clear_screen()
    print("Đang thu thập thông tin phần cứng...")
    
    cpu_name, cpu_tdp = get_cpu_info()
    gpu_name, gpu_tdp = get_gpu_info()
    
    print("\n--- THÔNG TIN LINH KIỆN (DỰA TRÊN CÔNG SUẤT THIẾT KẾ) ---")
    print(f"CPU: {cpu_name}")
    print(f"  - Công suất cơ bản (PBP): {cpu_tdp} W")
    
    print(f"GPU: {gpu_name}")
    print(f"  - Công suất đồ họa (TGP): {gpu_tdp} W")
    
    # --- Tính toán công suất ước tính tổng khi tải nặng ---
    # (Giữ nguyên như trước)
    total_power = 0
    components_valid = True
    if isinstance(cpu_tdp, int): total_power += cpu_tdp
    else: components_valid = False
    if isinstance(gpu_tdp, int): total_power += gpu_tdp
    else: components_valid = False
    
    # Giả định các linh kiện khác
    other_components_power = 120 # Tổng hợp (Motherboard, RAM, SSD, Fans)
    total_power += other_components_power
    
    print("\n--- TỔNG CÔNG SUẤT ƯỚC TÍNH KHI TẢI NẶNG (100%) ---")
    if components_valid:
        print(f"Tổng công suất ước tính: {total_power} W")
        print(f"Công suất bộ nguồn (PSU) đề nghị: > {total_power + 150} W")
    else:
        print("Không thể tính tổng công suất do thiếu dữ liệu TDP/TGP.")
    
    # --- Bắt đầu giám sát thời gian thực ---
    real_time_monitoring(cpu_tdp, gpu_tdp)

if __name__ == "__main__":
    main()