# --- MODIFIED FILE: main.py ---
import sys
import os
import subprocess
import time

# Đảm bảo module `update` có thể được import
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import update

UPDATE_STATUS = {
    'UP_TO_DATE': 0,
    'AHEAD': 1,
    'ERROR': -1
}

def restart_application():
    """Khởi động lại ứng dụng bằng cách gọi RUN.bat."""
    print("Yuuka: Cập nhật hoàn tất. Đang khởi động lại ứng dụng...")
    time.sleep(2)
    run_bat_path = os.path.abspath("RUN.bat")
    if os.path.exists(run_bat_path):
        subprocess.Popen([run_bat_path], shell=True)
    else:
        # Fallback nếu không có RUN.bat
        subprocess.Popen([sys.executable] + sys.argv, shell=True)
    sys.exit(0)

def run_install_and_exit():
    """Chạy INSTALL.bat để cập nhật thư viện và thoát."""
    install_bat_path = os.path.abspath("INSTALL.bat")
    if os.path.exists(install_bat_path):
        try:
            print("Yuuka: Đang chạy INSTALL.bat để cập nhật các thư viện cần thiết...")
            print("       Vui lòng đợi quá trình cài đặt hoàn tất và khởi động lại ứng dụng thủ công nhé senpai.")
            time.sleep(3)
            # Mở một cửa sổ cmd mới để chạy install, tránh bị block
            subprocess.Popen(f'start cmd /k "{install_bat_path}"', shell=True)
        except Exception as e:
            print(f"Yuuka: Lỗi khi tự động chạy INSTALL.bat: {e}")
            print("       Vui lòng chạy file INSTALL.bat thủ công.")
    else:
        print("Yuuka: Không tìm thấy file INSTALL.bat.")
    
    # Thoát ứng dụng để người dùng có thể thấy quá trình cài đặt
    sys.exit(0)

def main():
    """Hàm chính, kiểm tra cập nhật trước khi khởi chạy server Flask."""
    print(f"[{time.strftime('%H:%M:%S')}] Yuuka: Gallery Server đang khởi động...")
    
    # Bước 1: Kiểm tra cập nhật
    status, message, requirements_changed = update.check_for_updates()

    if status == UPDATE_STATUS['ERROR']:
        print(f"Yuuka: Lỗi khi kiểm tra cập nhật: {message}")
        print("       Bỏ qua quá trình cập nhật và tiếp tục khởi động.")

    elif status == UPDATE_STATUS['AHEAD']:
        print(f"Yuuka: Phát hiện phiên bản mới! {message}")
        print("       Bắt đầu quá trình cập nhật...")
        
        update.perform_update()
        
        if requirements_changed:
            print("Yuuka: Phát hiện thay đổi trong file requirements.txt.")
            run_install_and_exit()
        else:
            restart_application()
        
        # Luồng chương trình sẽ không bao giờ đến đây vì các hàm trên đều gọi sys.exit()
        return

    # Bước 2: Nếu không có cập nhật hoặc có lỗi, chạy ứng dụng
    print("Yuuka: Phiên bản đã được cập nhật. Đang tải dữ liệu và khởi chạy server...")
    
    try:
        from app import app, initialize_server # Yuuka: fix app call v1.0
        
        # Tải dữ liệu và khởi tạo server
        initialize_server() # Yuuka: fix app call v1.0
        
        # Khởi chạy server Flask
        app.run(host='0.0.0.0', debug=False, port=5000)

    except ImportError as e:
        print(f"LỖI NGHIÊM TRỌNG: Không thể import ứng dụng Flask. Lỗi: {e}")
        print("Có thể một số thư viện chưa được cài đặt. Vui lòng chạy file INSTALL.bat.")
        sys.exit(1)
    except Exception as e:
        print(f"LỖI KHÔNG XÁC ĐỊNH KHI KHỞI ĐỘNG SERVER: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()