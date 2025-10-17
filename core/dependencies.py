# --- MODIFIED FILE: core/dependencies.py ---
import subprocess
import os
import json
import sys
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import parse as parse_version

def get_installed_packages():
    """
    Lấy danh sách các package đã được cài đặt bằng pip freeze.
    Trả về một dictionary: {'package-name': 'version'}.
    """
    try:
        # Đảm bảo dùng đúng pip của môi trường python hiện tại
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'freeze'],
            capture_output=True,
            text=True,
            check=True,
            encoding='utf-8'
        )
        installed = {}
        for line in result.stdout.strip().split('\n'):
            if '==' in line:
                name, version = line.split('==', 1)
                installed[canonicalize_name(name)] = version
        return installed
    except Exception as e:
        print(f"Yuuka: Không thể chạy 'pip freeze': {e}")
        return {}

def get_required_dependencies(plugins_dir='plugins'):
    """
    Lấy tất cả các dependency từ requirements.txt và tất cả các plugin.json.
    """
    dependencies = set()

    # 1. Đọc từ requirements.txt
    if os.path.exists('requirements.txt'):
        with open('requirements.txt', 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    dependencies.add(line)

    # 2. Đọc từ plugin.json của các plugin
    if os.path.isdir(plugins_dir):
        for plugin_name in os.listdir(plugins_dir):
            plugin_path = os.path.join(plugins_dir, plugin_name)
            manifest_path = os.path.join(plugin_path, 'plugin.json')
            if os.path.isdir(plugin_path) and os.path.exists(manifest_path):
                try:
                    with open(manifest_path, 'r', encoding='utf-8') as f:
                        manifest = json.load(f)
                        # Yuuka: dependency check v1.0 - Lấy danh sách từ khóa "python"
                        plugin_deps = manifest.get('dependencies', {}).get('python', [])
                        if isinstance(plugin_deps, list):
                            for dep in plugin_deps:
                                dependencies.add(dep)
                except Exception as e:
                    print(f"Yuuka: Lỗi khi đọc manifest của plugin '{plugin_name}': {e}")

    return list(dependencies)


def check_dependencies():
    """
    Kiểm tra xem tất cả các dependency cần thiết đã được cài đặt chưa.
    Trả về một danh sách các gói bị thiếu. Trả về list rỗng nếu đã đủ.
    """
    print("Yuuka: Đang kiểm tra các thư viện Python cần thiết...")
    
    required_deps_str = get_required_dependencies()
    if not required_deps_str:
        print("Yuuka: Không tìm thấy file requirements.txt hoặc định nghĩa dependency.")
        return []

    installed_packages = get_installed_packages()
    if not installed_packages:
        print("Yuuka: Không thể lấy danh sách thư viện đã cài. Bỏ qua kiểm tra.")
        return [] # Tránh vòng lặp lỗi nếu pip có vấn đề

    missing_packages = []
    
    for req_str in required_deps_str:
        try:
            req = Requirement(req_str)
            package_name = canonicalize_name(req.name)

            if package_name not in installed_packages:
                missing_packages.append(req_str)
                continue

            # Kiểm tra phiên bản nếu được chỉ định
            if req.specifier:
                installed_version = parse_version(installed_packages[package_name])
                if not req.specifier.contains(installed_version):
                    missing_packages.append(req_str)
                    
        except Exception as e:
            print(f"Yuuka: Cảnh báo - không thể phân tích dependency '{req_str}': {e}")

    if missing_packages:
        print("Yuuka: Phát hiện các thư viện Python bị thiếu hoặc sai phiên bản:")
        for pkg in missing_packages:
            print(f"       - {pkg}")
    else:
        print("Yuuka: Tất cả thư viện cần thiết đã được cài đặt.")
        
    return missing_packages

# Yuuka: auto-install v1.0
def install_dependencies(packages_to_install):
    """
    Sử dụng pip để cài đặt một danh sách các gói.
    """
    if not packages_to_install:
        return True

    print(f"Yuuka: Bắt đầu quá trình cài đặt {len(packages_to_install)} thư viện...")
    try:
        command = [sys.executable, '-m', 'pip', 'install'] + packages_to_install
        
        # startupinfo để ẩn cửa sổ console trên Windows khi không cần thiết
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            # Dòng này giúp chạy pip trong một cửa sổ mới nếu cần debug
            # subprocess.run(f'start cmd /k "{" ".join(command)}"', shell=True, check=True)

        result = subprocess.run(
            command,
            check=True,
            capture_output=True, # Chụp output để hiển thị nếu có lỗi
            text=True,
            encoding='utf-8',
            startupinfo=startupinfo
        )
        print("Yuuka: Cài đặt thư viện thành công.")
        return True
    except subprocess.CalledProcessError as e:
        print("--- LỖI KHI CÀI ĐẶT THƯ VIỆN ---")
        print(e.stdout)
        print(e.stderr)
        print("---------------------------------")
        print("Yuuka: Quá trình cài đặt tự động thất bại.")
        print("       Vui lòng chạy file INSTALL.bat thủ công, sau đó khởi động lại ứng dụng.")
        input("       Nhấn Enter để thoát...") # Dừng lại để người dùng đọc lỗi
        sys.exit(1)
    except Exception as e:
        print(f"Yuuka: Lỗi không xác định khi chạy pip: {e}")
        print("       Vui lòng chạy file INSTALL.bat thủ công.")
        input("       Nhấn Enter để thoát...")
        sys.exit(1)
