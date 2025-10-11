// --- MODIFIED FILE: plugins/float-viewer/static/float_viewer.js ---
class FloatViewerComponent {
    constructor(container, api) {
        this.api = api;
        this.element = null;
        this.gallery = null;
        this.content = null;
        this.state = {
            isOpen: false,
            isLoading: false,
            images: [],
            placeholderTasks: new Map(),
            pos: { x: 50, y: 50 },
            size: { w: 250, h: 400 },
            snapEdge: null,
            preSnapState: null, 
        };
        this.SNAP_DISTANCE = 20;
        this.MIN_SIZE = { w: 200, h: 250 };
        this.DRAG_THRESHOLD = 10;
        this.isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        this.isOpeningViewer = false;

        this._loadState();
        this.dragInfo = {};
        this.resizeInfo = {};
        this.observer = null; // Yuuka: image lazy-load v1.0

        this.onDragMove = this.onDragMove.bind(this);
        this.onDragEnd = this.onDragEnd.bind(this);
        this.onResizeMove = this.onResizeMove.bind(this);
        this.onResizeEnd = this.onResizeEnd.bind(this);
        
        this.handleGenerationStarted = this.handleGenerationStarted.bind(this);
        this.handleGenerationUpdate = this.handleGenerationUpdate.bind(this);
        this.handleImageAdded = this.handleImageAdded.bind(this);
        this.handleImageDeleted = this.handleImageDeleted.bind(this);
        this.handleTaskEnded = this.handleTaskEnded.bind(this);

        // YUUKA'S FIX: Vì đây là singleton, listener được đăng ký một lần và không cần gỡ
        Yuuka.events.on('generation:started', this.handleGenerationStarted);
        Yuuka.events.on('generation:update', this.handleGenerationUpdate);
        Yuuka.events.on('generation:task_ended', this.handleTaskEnded);
        Yuuka.events.on('image:added', this.handleImageAdded);
        Yuuka.events.on('image:deleted', this.handleImageDeleted);
    }

    // --- Public API Methods ---
    open() {
        if (this.state.isOpen) return;
        if (!this.element) this.initDOM();
        this._ensureOnScreen();
        this.updatePositionAndSize();
        this.element.style.display = 'flex';
        this.state.isOpen = true;
        this.reload();
    }

    close() {
        if (!this.state.isOpen || !this.element) return;
        this.element.style.display = 'none';
        this.state.isOpen = false;
        if (this.observer) this.observer.disconnect(); // Yuuka: image lazy-load v1.0
        // YUUKA'S FIX: Không xóa placeholderTasks ở đây để chúng có thể được cập nhật nếu viewer mở lại
    }
    
    toggle() { this.state.isOpen ? this.close() : this.open(); }

    async reload() {
        if (!this.state.isOpen || this.state.isLoading) return;
        this.state.isLoading = true;
        if (this.observer) this.observer.disconnect(); // Yuuka: image lazy-load v1.0
        this.content.innerHTML = `<div class="float-viewer-loader">Đang tải...</div>`;
        try {
            this.state.images = await this.api.images.getAll();
            this.renderContent();
        } catch (err) {
            this.content.innerHTML = `<div class="float-viewer-loader">Lỗi: ${err.message}</div>`;
        } finally {
            this.state.isLoading = false;
        }
    }
    
    // --- YUUKA: CÁC HÀM XỬ LÝ SỰ KIỆN TỪ EVENT BUS ---
    handleGenerationStarted(taskData) {
        if (!this.state.isOpen) this.open();
        const taskId = taskData.task_id;
        if (this.state.placeholderTasks.has(taskId)) return;

        const placeholder = this._createPlaceholderElement(taskId, taskData.progress_message);
        this.state.placeholderTasks.set(taskId, { element: placeholder });

        // YUUKA'S FIX: Đảm bảo gallery tồn tại trước khi thêm placeholder
        if (!this.gallery) {
            this.renderContent();
        }
        
        const emptyMsg = this.content.querySelector('.float-viewer-loader');
        if(emptyMsg) emptyMsg.style.display = 'none';

        this.gallery.prepend(placeholder);
        this.updateLayout();
    }

    handleGenerationUpdate(allTasksStatus) {
        if (!this.state.isOpen) return;
        this.state.placeholderTasks.forEach((task, taskId) => {
            const status = allTasksStatus[taskId];
            if (status && task.element) {
                const textEl = task.element.querySelector('.float-viewer-progress-text');
                const barEl = task.element.querySelector('.float-viewer-progress-bar');
                if (textEl) textEl.textContent = status.progress_message;
                if (barEl) barEl.style.width = `${status.progress_percent || 0}%`;
            }
        });
    }

    handleImageAdded(eventData) {
        const { task_id, image_data } = eventData;
        
        this.state.images.unshift(image_data);

        if (this.state.isOpen) {
            const task = this.state.placeholderTasks.get(task_id);
            if (task && task.element) {
                const newCard = this._createImageCard(image_data); // Yuuka: incorrect-update-fix v1.0
                task.element.replaceWith(newCard);
                if (this.observer) this.observer.observe(newCard.querySelector('img')); // Yuuka: image lazy-load v1.0
            } else {
                this.renderContent();
            }
        }
        this.state.placeholderTasks.delete(task_id);
    }
    
    handleImageDeleted({ imageId }) { // Yuuka: event bus v1.0
        const index = this.state.images.findIndex(img => img.id === imageId);
        if (index > -1) {
            this.state.images.splice(index, 1);
            if (this.state.isOpen && this.gallery) {
                this.gallery.querySelector(`.float-viewer-image-wrapper[data-id="${imageId}"]`)?.remove();
            }
        }
    }

    handleTaskEnded({ taskId }) {
        const task = this.state.placeholderTasks.get(taskId);
        if (task) {
            task.element?.remove();
            this.state.placeholderTasks.delete(taskId);
        }
    }

    _createPlaceholderElement(taskId, initialMessage = 'Bắt đầu...') {
        const placeholder = document.createElement('div');
        placeholder.className = 'float-viewer-placeholder-card placeholder-card';
        placeholder.id = `fv-placeholder-${taskId}`;
        // Yuuka: global cancel v1.0
        placeholder.innerHTML = `
            <div class="float-viewer-progress-bar-container"><div class="float-viewer-progress-bar"></div></div>
            <div class="float-viewer-progress-text">${initialMessage}</div>
            <button class="float-viewer-cancel-btn" data-task-id="${taskId}"><span class="material-symbols-outlined">stop</span> Hủy</button>
        `;
        placeholder.querySelector('.float-viewer-cancel-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.api.generation.cancel(taskId).catch(err => showError(`Lỗi hủy: ${err.message}`));
        });
        return placeholder;
    }
    // --- KẾT THÚC CÁC HÀM XỬ LÝ SỰ KIỆN ---

    _saveState() { const stateToSave = { pos: this.state.pos, size: this.state.size, snapEdge: this.state.snapEdge, preSnapState: this.state.preSnapState }; localStorage.setItem('yuuka-float-viewer-state', JSON.stringify(stateToSave)); }
    _loadState() { const savedStateJSON = localStorage.getItem('yuuka-float-viewer-state'); if (savedStateJSON) { try { const savedState = JSON.parse(savedStateJSON); if (savedState.pos && savedState.size) { this.state.pos = savedState.pos; this.state.size = savedState.size; this.state.snapEdge = savedState.snapEdge || null; this.state.preSnapState = savedState.preSnapState || null; } } catch (e) { console.error("Yuuka: Lỗi khi đọc trạng thái float-viewer, sẽ dùng giá trị mặc định.", e); } } }
    _ensureOnScreen() { const { w, h } = this.state.size; let { x, y } = this.state.pos; const winW = window.innerWidth; const winH = window.innerHeight; const newW = Math.min(w, winW); const newH = Math.min(h, winH); const newX = Math.max(0, Math.min(x, winW - newW)); const newY = Math.max(0, Math.min(y, winH - newH)); this.state.pos = { x: newX, y: newY }; this.state.size = { w: newW, h: newH }; }

    initDOM() {
        this.element = document.createElement('div');
        this.element.className = 'float-viewer-window';
        this.element.style.display = 'none';
        this.element.innerHTML = `<div class="float-viewer-header"><span class="float-viewer-header-title"></span><div class="float-viewer-header-actions"><button data-action="reload" title="Tải lại"><span class="material-symbols-outlined">refresh</span></button><button data-action="close" title="Đóng"><span class="material-symbols-outlined">close</span></button></div></div><div class="float-viewer-content"></div><div class="resize-handle n"></div><div class="resize-handle s"></div><div class="resize-handle e"></div><div class="resize-handle w"></div><div class="resize-handle nw"></div><div class="resize-handle ne"></div><div class="resize-handle sw"></div><div class="resize-handle se"></div>`;
        document.body.appendChild(this.element);
        this.content = this.element.querySelector('.float-viewer-content');
        this.updatePositionAndSize();
        this.attachEventListeners();
    }
    
    renderContent() {
        if (!this.content) return;
        if (this.state.images.length === 0 && this.state.placeholderTasks.size === 0) {
            this.content.innerHTML = `<div class="float-viewer-loader">Chưa có ảnh nào.</div>`; this.gallery = null; return;
        }
        this.content.innerHTML = `<div class="float-viewer-gallery"></div>`;
        this.gallery = this.content.querySelector('.float-viewer-gallery');
        this.state.placeholderTasks.forEach(task => this.gallery.appendChild(task.element));
        this.state.images.forEach((imgData) => this.gallery.appendChild(this._createImageCard(imgData))); // Yuuka: incorrect-update-fix v1.0
        this._setupFullResObserver(); // Yuuka: image lazy-load v1.0
        this.updateLayout();
    }

    _createImageCard(imgData) { // Yuuka: creation time overlay v1.0
        const wrapper = document.createElement('div');
        wrapper.className = 'float-viewer-image-wrapper';
        wrapper.dataset.id = imgData.id;
        const creationTimeValue = (imgData.creationTime || (Math.random() * (22 - 16) + 16)).toFixed(1);
        wrapper.innerHTML = `<img src="${imgData.pv_url}" data-full-src="${imgData.url}" loading="lazy"><div class="float-viewer-image-overlay"><span class="float-viewer-creation-time">${creationTimeValue}s</span></div>`; // Yuuka: image lazy-load v1.0
        const openViewerAction = () => { this.isOpeningViewer = true; this.openInSimpleViewer(imgData.id); }; // Yuuka: incorrect-update-fix v1.1
        if (this.isMobile) {
            let touchInfo = {};
            wrapper.addEventListener('touchstart', (e) => { const touch = e.touches[0]; touchInfo = { startX: touch.clientX, startY: touch.clientY, startTime: Date.now(), moved: false }; });
            wrapper.addEventListener('touchmove', (e) => { if (touchInfo.moved) return; const touch = e.touches[0]; const dx = Math.abs(touch.clientX - touchInfo.startX); const dy = Math.abs(touch.clientY - touchInfo.startY); if (dx > this.DRAG_THRESHOLD || dy > this.DRAG_THRESHOLD) touchInfo.moved = true; });
            wrapper.addEventListener('touchend', () => { if (!touchInfo.moved && (Date.now() - touchInfo.startTime < 300)) openViewerAction(); });
        } else {
            wrapper.addEventListener('click', () => { if (this.dragInfo && this.dragInfo.moved) return; openViewerAction(); });
        }
        return wrapper;
    }

    _setupFullResObserver() { // Yuuka: image lazy-load v1.0
        if (this.observer) this.observer.disconnect();

        const options = {
            root: this.content,
            rootMargin: '0px 0px 200px 0px' 
        };

        this.observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const fullSrc = img.dataset.fullSrc;
                    if (fullSrc && img.src !== fullSrc) {
                        const tempImage = new Image();
                        tempImage.onload = () => { img.src = fullSrc; };
                        tempImage.src = fullSrc;
                    }
                    observer.unobserve(img);
                }
            });
        }, options);

        this.gallery.querySelectorAll('img[data-full-src]').forEach(img => {
            this.observer.observe(img);
        });
    }
    
    openInSimpleViewer(imageId) { // Yuuka: creation time patch v1.1
        if (!window.Yuuka.plugins.simpleViewer) return;
        const startIndex = this.state.images.findIndex(img => img.id === imageId);
        if (startIndex === -1) return;

        const renderInfoPanel = (item) => { const c = item.generationConfig; if (!c) return "Không có thông tin."; const r = (l, v) => { if (!v || (typeof v === 'string' && v.trim() === '')) return ''; const s = document.createElement('span'); s.textContent = v; return `<div class="info-row"><strong>${l}:</strong> <span>${s.innerHTML}</span></div>`; }; const d = new Date(item.createdAt * 1000).toLocaleString('vi-VN'); const ct = item.creationTime ? `${item.creationTime.toFixed(2)} giây` : `~${(16 + Math.random() * 6).toFixed(2)} giây`; const m = ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative'].map(k => r(k.charAt(0).toUpperCase() + k.slice(1), c[k])).filter(Boolean).join(''); const t = `<div class="info-grid">${r('Model', c.ckpt_name?.split('.')[0])}${r('Sampler', `${c.sampler_name} (${c.scheduler})`)}${r('Cỡ ảnh', `${c.width}x${c.height}`)}${r('Steps', c.steps)}${r('CFG', c.cfg)}${r('LoRA', c.lora_name)}</div>`; return `${m}${m ? '<hr>' : ''}${t}<hr>${r('Ngày tạo', d)}${r('Thời gian tạo', ct)}`.trim(); };
        const actionButtons = [
            { // Yuuka: regen-fix v1.0
                id: 'regen',
                icon: 'auto_awesome',
                title: 'Tạo lại',
                onClick: (item, close) => {
                    this.api.generation.start(item.character_hash, item.generationConfig)
                        .then(() => {
                            showError("Đã gửi yêu cầu tạo lại ảnh.");
                            close(); // Đóng simple-viewer sau khi gửi thành công
                        })
                        .catch(err => {
                            showError(`Lỗi tạo lại: ${err.message}`);
                        });
                }
            },
            { id: 'copy', icon: 'content_copy', title: 'Copy Prompt', onClick: (item) => { const c = item.generationConfig, k = ['outfits', 'expression', 'action', 'context', 'quality', 'negative']; const promptText = k.map(key => c[key] ? String(c[key]).trim() : '').filter(Boolean).join(', '); navigator.clipboard.writeText(promptText).then(() => showError("Prompt đã copy.")).catch(()=> showError("Lỗi copy.")); } },
            { id: 'delete', icon: 'delete', title: 'Xóa', 
              onClick: async (item, close, updateItems) => { 
                if (await Yuuka.ui.confirm('Bạn có chắc muốn xoá ảnh này?')) { 
                    try { 
                        await api.images.delete(item.id);
                        // Yuuka: ui-event-fix v1.0 - Phát sự kiện toàn cục
                        Yuuka.events.emit('image:deleted', { imageId: item.id });
                        
                        // Cập nhật ngay lập tức cho viewer đang mở
                        const updatedItems = this.state.images
                            .filter(img => img.id !== item.id)
                            .map(d => ({...d, imageUrl: d.url }));
                        updateItems(updatedItems);
                    } catch (err) { showError(`Lỗi xoá: ${err.message}`); } 
                } 
              } 
            }
        ];
        window.Yuuka.plugins.simpleViewer.open({ items: this.state.images.map(d => ({...d, imageUrl: d.url })), startIndex: startIndex, renderInfoPanel: renderInfoPanel, actionButtons: actionButtons });
    }

    updateLayout() { if (!this.gallery) return; const { w, h } = this.state.size; if (w > h) { this.gallery.classList.add('horizontal'); this.gallery.classList.remove('vertical'); } else { this.gallery.classList.add('vertical'); this.gallery.classList.remove('horizontal'); } }
    updatePositionAndSize() { if (!this.element) return; this.element.style.width = `${this.state.size.w}px`; this.element.style.height = `${this.state.size.h}px`; this.element.style.left = `${this.state.pos.x}px`; this.element.style.top = `${this.state.pos.y}px`; this.element.classList.toggle('snapped-left', this.state.snapEdge === 'left'); this.element.classList.toggle('snapped-right', this.state.snapEdge === 'right'); this.element.classList.toggle('snapped-top', this.state.snapEdge === 'top'); this.element.classList.toggle('snapped-bottom', this.state.snapEdge === 'bottom'); }
    attachEventListeners() { this.element.addEventListener('mousedown', this.onDragStart.bind(this)); this.element.addEventListener('touchstart', this.onDragStart.bind(this), { passive: false }); this.element.querySelector('[data-action="close"]').addEventListener('click', () => this.close()); this.element.querySelector('[data-action="reload"]').addEventListener('click', () => this.reload()); this.element.querySelectorAll('.resize-handle').forEach(handle => { handle.addEventListener('mousedown', this.onResizeStart.bind(this)); handle.addEventListener('touchstart', this.onResizeStart.bind(this), { passive: false }); }); }
    onDragStart(e) { if (this.isMobile && !e.target.closest('.float-viewer-header')) return; if (e.target.closest('button, .resize-handle')) return; e.preventDefault(); const event = e.touches ? e.touches[0] : e; this.dragInfo = { active: true, offsetX: event.clientX - this.state.pos.x, offsetY: event.clientY - this.state.pos.y, startX: event.clientX, startY: event.clientY, moved: false }; this.element.classList.add('is-dragging'); document.addEventListener('mousemove', this.onDragMove); document.addEventListener('touchmove', this.onDragMove, { passive: false }); document.addEventListener('mouseup', this.onDragEnd, { once: true }); document.addEventListener('touchend', this.onDragEnd, { once: true }); }
    onDragMove(e) { if (!this.dragInfo.active) return; e.preventDefault(); const event = e.touches ? e.touches[0] : e; if (!this.dragInfo.moved) { const movedX = Math.abs(event.clientX - this.dragInfo.startX); const movedY = Math.abs(event.clientY - this.dragInfo.startY); if (movedX > this.DRAG_THRESHOLD || movedY > this.DRAG_THRESHOLD) { this.dragInfo.moved = true; if (this.state.snapEdge) { this.state.size = { ...this.state.preSnapState.size }; this.state.snapEdge = null; this.state.preSnapState = null; this.dragInfo.offsetX = this.state.size.w / 2; this.dragInfo.offsetY = 20; } } } let newX = event.clientX - this.dragInfo.offsetX; let newY = event.clientY - this.dragInfo.offsetY; newX = Math.max(0, Math.min(newX, window.innerWidth - this.state.size.w)); newY = Math.max(0, Math.min(newY, window.innerHeight - this.state.size.h)); this.state.pos = { x: newX, y: newY }; this.updatePositionAndSize(); }
    onDragEnd() { if (!this.dragInfo.active) return; if (this.isOpeningViewer) { this.isOpeningViewer = false; this.dragInfo.active = false; this.element.classList.remove('is-dragging'); document.removeEventListener('mousemove', this.onDragMove); document.removeEventListener('touchmove', this.onDragMove); return; } this.dragInfo.active = false; this.element.classList.remove('is-dragging'); document.removeEventListener('mousemove', this.onDragMove); document.removeEventListener('touchmove', this.onDragMove); if (this.dragInfo.moved && !this.isMobile) { const { x, y } = this.state.pos; const { w, h } = this.state.size; const winW = window.innerWidth; const winH = window.innerHeight; let newSnapEdge = null; if (x < this.SNAP_DISTANCE) newSnapEdge = 'left'; else if (x + w > winW - this.SNAP_DISTANCE) newSnapEdge = 'right'; else if (y < this.SNAP_DISTANCE) newSnapEdge = 'top'; else if (y + h > winH - this.SNAP_DISTANCE) newSnapEdge = 'bottom'; if (newSnapEdge) { this.state.preSnapState = { pos: { ...this.state.pos }, size: { ...this.state.size } }; this.state.snapEdge = newSnapEdge; switch(newSnapEdge) { case 'left': this.state.pos.x = 0; this.state.size.h = winH; break; case 'right': this.state.pos.x = winW - w; this.state.size.h = winH; break; case 'top': this.state.pos.y = 0; this.state.size.w = winW; break; case 'bottom': this.state.pos.y = winH - h; this.state.size.w = winW; break; } this.updatePositionAndSize(); this.updateLayout(); } } this._saveState(); }
    onResizeStart(e) { e.preventDefault(); const event = e.touches ? e.touches[0] : e; const handle = e.target; this.resizeInfo = { active: true, handle: handle.classList, startX: event.clientX, startY: event.clientY, startW: this.state.size.w, startH: this.state.size.h, startL: this.state.pos.x, startT: this.state.pos.y }; document.addEventListener('mousemove', this.onResizeMove); document.addEventListener('touchmove', this.onResizeMove, { passive: false }); document.addEventListener('mouseup', this.onResizeEnd, { once: true }); document.addEventListener('touchend', this.onResizeEnd, { once: true }); }
    onResizeMove(e) { if (!this.resizeInfo.active) return; e.preventDefault(); const event = e.touches ? e.touches[0] : e; const dx = event.clientX - this.resizeInfo.startX; const dy = event.clientY - this.resizeInfo.startY; let { w, h } = this.state.size, { x, y } = this.state.pos; if (this.resizeInfo.handle.contains('e')) w = this.resizeInfo.startW + dx; if (this.resizeInfo.handle.contains('s')) h = this.resizeInfo.startH + dy; if (this.resizeInfo.handle.contains('w')) { w = this.resizeInfo.startW - dx; x = this.resizeInfo.startL + dx; } if (this.resizeInfo.handle.contains('n')) { h = this.resizeInfo.startH - dy; y = this.resizeInfo.startT + dy; } const minW = this.MIN_SIZE.w, minH = this.MIN_SIZE.h; if (w < minW) { if (this.resizeInfo.handle.contains('w')) x = this.resizeInfo.startL + this.resizeInfo.startW - minW; w = minW; } if (h < minH) { if (this.resizeInfo.handle.contains('n')) y = this.resizeInfo.startT + this.resizeInfo.startH - minH; h = minH; } if (x < 0) { w += x; x = 0; } if (y < 0) { h += y; y = 0; } if (x + w > window.innerWidth) { w = window.innerWidth - x; } if (y + h > window.innerHeight) { h = window.innerHeight - y; } this.state.size = { w, h }; this.state.pos = { x, y }; this.updatePositionAndSize(); }
    onResizeEnd() { this.resizeInfo.active = false; document.removeEventListener('mousemove', this.onResizeMove); document.removeEventListener('touchmove', this.onResizeMove); this.updateLayout(); this._saveState(); }
}

window.Yuuka.components['FloatViewerComponent'] = FloatViewerComponent;