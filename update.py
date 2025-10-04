# --- NEW FILE: update.py ---
import subprocess
import os

UPDATE_STATUS = {
    'UP_TO_DATE': 0,
    'AHEAD': 1,
    'ERROR': -1
}

def _run_git_command(command):
    """Chạy một lệnh git và trả về kết quả hoặc lỗi."""
    try:
        # startupinfo để ẩn cửa sổ console trên Windows
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        result = subprocess.run(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            startupinfo=startupinfo
        )
        return result.stdout.strip(), None
    except FileNotFoundError:
        return None, "Lệnh 'git' không được tìm thấy. Vui lòng đảm bảo Git đã được cài đặt và có trong PATH."
    except subprocess.CalledProcessError as e:
        return None, e.stderr.strip()
    except Exception as e:
        return None, str(e)

def check_for_updates():
    """
    Kiểm tra xem có bản cập nhật mới trên remote repository hay không.
    Đồng thời kiểm tra xem file requirements.txt có bị thay đổi không.
    """
    print("Yuuka: Đang kiểm tra cập nhật từ server Git...")
    
    # Bước 1: Fetch thông tin mới nhất từ remote
    _, error = _run_git_command(['git', 'fetch'])
    if error:
        return UPDATE_STATUS['ERROR'], f"Lỗi khi fetch từ remote: {error}", False

    # Bước 2: Lấy commit hash của local (HEAD) và remote (@{u})
    local_hash, error = _run_git_command(['git', 'rev-parse', 'HEAD'])
    if error:
        return UPDATE_STATUS['ERROR'], f"Lỗi khi lấy local hash: {error}", False

    remote_hash, error = _run_git_command(['git', 'rev-parse', '@{u}'])
    if error:
        # Lỗi này thường xảy ra khi branch local chưa được track với remote
        # Hoặc đây là lần đầu clone, chưa có upstream.
        return UPDATE_STATUS['ERROR'], f"Lỗi khi lấy remote hash. (Branch của bạn đã track remote chưa?): {error}", False
    
    # Bước 3: So sánh hai hash
    if local_hash == remote_hash:
        return UPDATE_STATUS['UP_TO_DATE'], "Phiên bản đã mới nhất.", False

    # Bước 4: Nếu khác nhau, kiểm tra những file đã thay đổi
    changed_files_str, error = _run_git_command(['git', 'diff', '--name-only', f'{local_hash}..{remote_hash}'])
    if error:
        # Nếu có lỗi ở đây, vẫn báo có update nhưng không check được requirements
        return UPDATE_STATUS['AHEAD'], "Có phiên bản mới (không thể kiểm tra file thay đổi).", False

    requirements_changed = 'requirements.txt' in changed_files_str.split('\n')
    
    message = "Có phiên bản mới."
    return UPDATE_STATUS['AHEAD'], message, requirements_changed


def perform_update():
    """Thực hiện `git pull` để cập nhật code."""
    print("Yuuka: Đang tải về phiên bản mới nhất...")
    output, error = _run_git_command(['git', 'pull', '--ff-only'])
    if error:
        print(f"Yuuka: Lỗi khi thực hiện 'git pull': {error}")
        print("       Vui lòng thử cập nhật thủ công.")
        return False
    
    print("Yuuka: Cập nhật code thành công.")
    print(f"       Chi tiết:\n---\n{output}\n---")
    return True