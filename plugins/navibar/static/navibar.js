// --- MODIFIED FILE: plugins/navibar/static/navibar.js ---
// Note logic button: Không cần hiển thị main button ở page của chính nó, tối đa hiển thị 5 button cùng lúc.
class NavibarComponent {
    constructor(container, api) {
        this.api = api;
        this.element = document.getElementById('main-nav');
        this._navMainContainer = this.element.querySelector('.nav-group--main');
        this._navToolsContainer = this.element.querySelector('.nav-group--tools');
        this._currentButtons = new Map(); // Yuuka: Dùng Map để theo dõi các button hiện có
        
        // Yuuka: Đăng ký service toàn cục
        if (!window.Yuuka.services.navibar) {
            window.Yuuka.services.navibar = this;
            console.log("[Plugin:Navibar] Service registered.");
        }
    }

    /**
     * Yuuka: Service chính được thiết kế lại hoàn toàn để cập nhật thông minh.
     * Nó sẽ so sánh và chỉ thay đổi những gì cần thiết, tránh animation không mong muốn.
     * @param {Array<Object>} buttons - Mảng cấu hình các button.
     */
    setButtons(buttons = []) {
        const sortedButtons = [...buttons].sort((a, b) => (a.order || 99) - (b.order || 99));
        const newButtonIds = new Set(sortedButtons.map(b => b.id));

        // Bước 1: Xóa các button không còn trong config mới (với animation)
        this._currentButtons.forEach((btnElement, btnId) => {
            if (!newButtonIds.has(btnId)) {
                this._removeButton(btnId);
            }
        });

        // Bước 2: Thêm hoặc cập nhật các button
        sortedButtons.forEach((config, index) => {
            const existingBtn = this._currentButtons.get(config.id);
            if (existingBtn) {
                // Button đã tồn tại -> Cập nhật tại chỗ, không animation
                this._updateButton(existingBtn, config);
            } else {
                // Button mới -> Thêm vào với animation
                this._addButton(config);
            }
        });
        
        // Bước 3: Sắp xếp lại DOM nếu cần (hiếm khi xảy ra nhưng đảm bảo thứ tự đúng)
        this._reorderDOM(sortedButtons);
    }

    /**
     * Yuuka: Service để ẩn một button.
     * @param {string} buttonId - ID của button cần ẩn.
     */
    hideButton(buttonId) {
        const btn = this._currentButtons.get(buttonId);
        if (btn) {
            btn.classList.add('is-hidden');
        }
    }

    /**
     * Yuuka: Service để hiện lại một button đã ẩn.
     * @param {string} buttonId - ID của button cần hiện.
     */
    showButton(buttonId) {
        const btn = this._currentButtons.get(buttonId);
        if (btn) {
            btn.classList.remove('is-hidden');
        }
    }
    
    _updateButton(btn, config) {
        // Cập nhật thuộc tính trực tiếp
        btn.title = config.title || '';
        
        // YUUKA'S FIX: Xử lý linh hoạt cho thuộc tính 'disabled'.
        // Nó có thể là một hàm (cho album) hoặc một giá trị boolean (cho scene).
        const isDisabled = typeof config.disabled === 'function' 
            ? config.disabled() 
            : config.disabled;
        btn.disabled = !!isDisabled; // Dùng !! để đảm bảo giá trị cuối là boolean
        
        const iconSpan = btn.querySelector('.material-symbols-outlined');
        if (iconSpan && iconSpan.textContent !== config.icon) {
            iconSpan.textContent = config.icon;
        }

        const isActive = config.isActive && config.isActive();
        btn.classList.toggle('active', !!isActive);

        // YUUKA: *** SỬA LỖI TẠI ĐÂY ***
        // Gán lại event listener bằng `onclick` để ghi đè, thay vì `addEventListener` để thêm mới.
        // Điều này đảm bảo chỉ có một listener duy nhất tồn tại.
        if (config.onClick) {
            btn.onclick = () => config.onClick();
        } else {
            btn.onclick = null;
        }
    }

    _addButton(config) {
        if (!config.id) {
            console.warn('[Navibar] Button config is missing an ID.', config);
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'nav-btn is-hidden';
        btn.dataset.id = config.id;
        btn.title = config.title || '';

        // YUUKA'S FIX: Áp dụng logic tương tự cho việc thêm button mới.
        const isDisabled = typeof config.disabled === 'function' 
            ? config.disabled() 
            : config.disabled;
        btn.disabled = !!isDisabled;

        const isActive = config.isActive && config.isActive();
        btn.classList.toggle('active', !!isActive);

        btn.innerHTML = `<span class="material-symbols-outlined">${config.icon || 'star'}</span>`;
        // Yuuka: Dùng onclick ở đây để nhất quán với hàm update
        if (config.onClick) {
            btn.onclick = () => config.onClick();
        }

        const targetContainer = config.group === 'tools' ? this._navToolsContainer : this._navMainContainer;
        targetContainer.appendChild(btn);
        
        this._currentButtons.set(config.id, btn);

        setTimeout(() => {
            btn.classList.remove('is-hidden');
        }, 10);
    }
    
    _reorderDOM(sortedButtons) {
        const mainButtons = sortedButtons.filter(b => b.group !== 'tools');
        const toolButtons = sortedButtons.filter(b => b.group === 'tools');

        mainButtons.forEach(config => {
            const btn = this._currentButtons.get(config.id);
            if (btn) this._navMainContainer.appendChild(btn);
        });
        toolButtons.forEach(config => {
            const btn = this._currentButtons.get(config.id);
            if (btn) this._navToolsContainer.appendChild(btn);
        });
    }

    _removeButton(buttonId) {
        const btn = this._currentButtons.get(buttonId);
        if (btn) {
            btn.classList.add('is-hidden');
            
            setTimeout(() => {
                btn.remove();
                this._currentButtons.delete(buttonId);
            }, 300);
        }
    }
}

window.Yuuka.components['NavibarComponent'] = NavibarComponent;