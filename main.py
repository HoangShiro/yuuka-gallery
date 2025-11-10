# --- MODIFIED FILE: main.py ---
import sys
import os
import subprocess
import time
import logging
import update
from werkzeug.serving import WSGIRequestHandler
from core.dependencies import check_dependencies, install_dependencies # Yuuka: auto-install v1.0

class No200RequestHandler(WSGIRequestHandler):
    def log_request(self, code='-', size='-'):
        # code có thể là str hoặc int; chuẩn hoá về int nếu được
        try:
            code_int = int(code)
        except Exception:
            # nếu không parse được, cứ log như bình thường
            return super().log_request(code, size)
        # ✂️ Bỏ qua 200 và 304 (Not Modified)
        if code_int in (200, 304):
            return
        return super().log_request(code, size)

UPDATE_STATUS = {
    'UP_TO_DATE': 0,
    'AHEAD': 1,
    'ERROR': -1
}

def restart_application():
    """Khởi động lại ứng dụng bằng cách gọi RUN.bat."""
    print("Yuuka: Tác vụ hoàn tất. Đang khởi động lại ứng dụng...")
    time.sleep(2)
    # Yuuka: restart loop is handled by RUN.bat; just exit cleanly here.
    sys.exit(0)

# Yuuka: auto-install v1.0 - Gỡ bỏ hàm run_install_and_exit()

def main():
    """Hàm chính, kiểm tra cập nhật trước khi khởi chạy server Flask."""
    print(f"[{time.strftime('%H:%M:%S')}] Yuuka: Gallery Server đang khởi động...")
    
    # Bước 1: Kiểm tra cập nhật code từ Git
    status, message, dependencies_changed = update.check_for_updates()

    if status == UPDATE_STATUS['ERROR']:
        print(f"Yuuka: Lỗi khi kiểm tra cập nhật: {message}")
        print("       Bỏ qua quá trình cập nhật và tiếp tục khởi động.")

    elif status == UPDATE_STATUS['AHEAD']:
        print(f"Yuuka: Phát hiện phiên bản mới! {message}")
        print("       Bắt đầu quá trình cập nhật...")
        
        update.perform_update()
        
        # Sau khi cập nhật, luôn khởi động lại để đảm bảo tất cả các file được tải lại
        # Việc kiểm tra thư viện sẽ được thực hiện ở lần chạy tiếp theo.
        restart_application()
        return # Không bao giờ đến đây

    # Bước 2: Kiểm tra thư viện (quan trọng nhất)
    # Sẽ kiểm tra sau khi pull code hoặc khi khởi động bình thường.
    missing_deps = check_dependencies() # Yuuka: auto-install v1.0
    if missing_deps:
        install_dependencies(missing_deps)
        # Sau khi cài đặt, cần khởi động lại để môi trường nhận thư viện mới
        restart_application()
        return # Không bao giờ đến đây

    # Bước 3: Nếu mọi thứ đều ổn, chạy ứng dụng
    print("Yuuka: Phiên bản và thư viện đã đầy đủ. Đang tải dữ liệu và khởi chạy server...")
    
    try:
        from app import app, initialize_server # Yuuka: main.py compatibility v1.0
        
        # Tải dữ liệu và khởi tạo server
        initialize_server() # Yuuka: main.py compatibility v1.0
        
        # Khởi chạy server Flask
        #app.run(host='127.0.0.1', debug=False, port=5000, request_handler=No200RequestHandler)
        app.run(host='0.0.0.0', debug=False, port=5000, request_handler=No200RequestHandler)

    except ImportError as e:
        print(f"LỖI NGHIÊM TRỌNG: Không thể import ứng dụng Flask. Lỗi: {e}")
        print("Có thể một số thư viện chưa được cài đặt. Vui lòng chạy file INSTALL.bat.")
        sys.exit(1)
    except Exception as e:
        print(f"LỖI KHÔNG XÁC ĐỊNH KHI KHỞI ĐỘNG SERVER: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()