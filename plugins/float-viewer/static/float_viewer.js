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
        
        // Yuuka: startup bug fix v2.0 - Sửa logic khởi động lại
        if (this.state.isOpen) {
            this.initDOM(); // Tạo DOM
            this.element.style.display = 'flex'; // Hiển thị ngay lập tức
            this.reload();  // Tải dữ liệu cho viewer đã hiển thị
        }
    }

    // --- Public API Methods ---
    start() { // Yuuka: service launcher v1.0
        this.toggle();
    }

    open() {
        if (this.state.isOpen) return;
        if (!this.element) this.initDOM();
        this._ensureOnScreen();
        this.updatePositionAndSize();
        this.element.style.display = 'flex';
        this.state.isOpen = true;
        this._saveState(); // Yuuka: independent float viewer v1.0
        this.reload();
    }

    close() {
        if (!this.state.isOpen || !this.element) return;
        this.element.style.display = 'none';
        this.state.isOpen = false;
        this._saveState(); // Yuuka: independent float viewer v1.0
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
        // Yuuka: independent float viewer v1.0 - Gỡ bỏ việc tự động mở float-viewer
        const taskId = taskData.task_id;
        if (this.state.placeholderTasks.has(taskId)) return;

        const placeholder = this._createPlaceholderElement(taskId, taskData.progress_message);
        this.state.placeholderTasks.set(taskId, { element: placeholder });

        // Nếu viewer đang mở, thêm placeholder vào UI ngay lập tức
        if (this.state.isOpen) {
            if (!this.gallery) {
                this.renderContent();
            }
            
            const emptyMsg = this.content.querySelector('.float-viewer-loader');
            if(emptyMsg) emptyMsg.style.display = 'none';

            this.gallery.prepend(placeholder);
            this.updateLayout();
        }
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

    _saveState() { const stateToSave = { pos: this.state.pos, size: this.state.size, snapEdge: this.state.snapEdge, preSnapState: this.state.preSnapState, isOpen: this.state.isOpen }; localStorage.setItem('yuuka-float-viewer-state', JSON.stringify(stateToSave)); } // Yuuka: independent float viewer v1.0
    _loadState() { const savedStateJSON = localStorage.getItem('yuuka-float-viewer-state'); if (savedStateJSON) { try { const savedState = JSON.parse(savedStateJSON); if (savedState.pos && savedState.size) { this.state.pos = savedState.pos; this.state.size = savedState.size; this.state.snapEdge = savedState.snapEdge || null; this.state.preSnapState = savedState.preSnapState || null; this.state.isOpen = savedState.isOpen || false; } } catch (e) { console.error("Yuuka: Lỗi khi đọc trạng thái float-viewer, sẽ dùng giá trị mặc định.", e); } } } // Yuuka: independent float viewer v1.0
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
    
        const viewerHelpers = window.Yuuka?.viewerHelpers;
        const fallbackInfoPanel = (item) => {
            const cfg = item?.generationConfig;
            if (!cfg) return "No information available.";
            const buildRow = (label, value) => {
                if (!value || (typeof value === 'string' && value.trim() === '')) return '';
                const span = document.createElement('span');
                span.textContent = value;
                return `<div class="info-row"><strong>${label}:</strong> <span>${span.innerHTML}</span></div>`;
            };
            const promptRows = ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative']
                .map(key => buildRow(key.charAt(0).toUpperCase() + key.slice(1), cfg[key]))
                .filter(Boolean)
                .join('');
            const createdText = item.createdAt ? new Date(item.createdAt * 1000).toLocaleString('vi-VN') : '';
            const renderTime = item.creationTime ? `${Number(item.creationTime).toFixed(2)} giay` : '';
            const infoGrid = `<div class="info-grid">${
                buildRow('Model', cfg.ckpt_name?.split('.')[0])
            }${
                buildRow('Sampler', `${cfg.sampler_name} (${cfg.scheduler})`)
            }${
                buildRow('Image Size', `${cfg.width}x${cfg.height}`)
            }${
                buildRow('Steps', cfg.steps)
            }${
                buildRow('CFG', cfg.cfg)
            }${
                buildRow('LoRA', cfg.lora_name)
            }</div>`;
            const loraTags = Array.isArray(cfg.lora_prompt_tags)
                ? cfg.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean).join(', ')
                : '';
            const loraBlock = loraTags ? buildRow('LoRA Tags', loraTags) : '';
            const sections = [];
            if (promptRows) sections.push(promptRows, '<hr>');
            sections.push(infoGrid);
            if (loraBlock) sections.push(loraBlock);
            if (createdText || renderTime) sections.push('<hr>');
            if (createdText) sections.push(buildRow('Created', createdText));
            if (renderTime) sections.push(buildRow('Render Time', renderTime));
            return sections.filter(Boolean).join('').trim();
        };
    
        const renderInfoPanel = (item) => {
            if (viewerHelpers?.buildInfoPanel) {
                try {
                    return viewerHelpers.buildInfoPanel(item);
                } catch (err) {
                    console.warn('[FloatViewer] viewerHelpers.buildInfoPanel error:', err);
                }
            }
            return fallbackInfoPanel(item);
        };
    
        const copyPrompt = (item) => {
            const cfg = item.generationConfig;
            const keys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
            const promptText = keys
                .map(key => cfg[key] ? String(cfg[key]).trim() : '')
                .filter(Boolean)
                .join(', ');
            navigator.clipboard.writeText(promptText)
                .then(() => showError('Prompt da copy.'))
                .catch(() => showError('Loi copy.'));
        };

        const deleteHandler = async (item, close, updateItems) => {
            if (await Yuuka.ui.confirm('Chắc chắn muốn xóa ảnh này?')) {
                try {
                    await this.api.images.delete(item.id);
                    Yuuka.events.emit('image:deleted', { imageId: item.id });

                    const updatedItems = this.state.images
                        .filter(img => img.id !== item.id)
                        .map(d => ({ ...d, imageUrl: d.url }));
                    updateItems(updatedItems);
                } catch (err) {
                    showError(`Lỗi xóa: ${err.message}`);
                }
            }
        };

        const isImageHiresFn = (item) => {
            if (viewerHelpers?.isImageHires) {
                try {
                    return viewerHelpers.isImageHires(item);
                } catch (err) {
                    console.warn('[FloatViewer] viewerHelpers.isImageHires error:', err);
                }
            }
            const cfg = item?.generationConfig || {};
            if (!cfg || Object.keys(cfg).length === 0) return true;
            let hiresFlag = cfg.hires_enabled;
            if (typeof hiresFlag === 'string') {
                hiresFlag = hiresFlag.trim().toLowerCase() === 'true';
            }
            if (hiresFlag) return true;
            const width = Number(cfg.width);
            const baseWidth = Number(cfg.hires_base_width || cfg.width);
            if (Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth) {
                return true;
            }
            const height = Number(cfg.height);
            const baseHeight = Number(cfg.hires_base_height || cfg.height);
            if (Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight) {
                return true;
            }
            return false;
        };

        const canHires = !!(this.api && this.api.album);

        let actionButtons;
        if (viewerHelpers?.createActionButtons) {
            actionButtons = viewerHelpers.createActionButtons({
                regen: {
                    onClick: (item, close) => {
                        this.api.generation.start(item.character_hash, item.generationConfig)
                            .then(() => {
                                showError('Đã gửi yêu cầu tạo lại ảnh.');
                                close();
                            })
                            .catch(err => showError(`Lỗi tạo lại: ${err.message}`));
                    }
                },
                hires: {
                    disabled: (item) => !canHires || isImageHiresFn(item),
                    onClick: (item) => this._startHiresUpscale(item)
                },
                copy: {
                    onClick: copyPrompt
                },
                delete: {
                    onClick: deleteHandler
                }
            });
        } else {
            actionButtons = [
                {
                    id: 'regen',
                    icon: 'auto_awesome',
                    title: 'Tao lai',
                    onClick: (item, close) => {
                        this.api.generation.start(item.character_hash, item.generationConfig)
                            .then(() => {
                                showError('Đã gửi yêu cầu tạo lại ảnh.');
                                close();
                            })
                            .catch(err => showError(`Lỗi tạo lại: ${err.message}`));
                    }
                },
                {
                    id: 'hires',
                    icon: 'wand_stars',
                    title: 'Hires x2',
                    disabled: (item) => !canHires || isImageHiresFn(item),
                    onClick: (item) => this._startHiresUpscale(item)
                },
                {
                    id: 'copy',
                    icon: 'content_copy',
                    title: 'Copy Prompt',
                    onClick: copyPrompt
                },
                {
                    id: 'delete',
                    icon: 'delete',
                    title: 'Remove Image',
                    onClick: deleteHandler
                }
            ];
        }
    
        window.Yuuka.plugins.simpleViewer.open({
            items: this.state.images.map(d => ({ ...d, imageUrl: d.url })),
            startIndex,
            renderInfoPanel,
            actionButtons
        });
    }

    async _startHiresUpscale(item) {
        const viewerHelpers = window.Yuuka?.viewerHelpers;
        let isHires;
        if (viewerHelpers?.isImageHires) {
            try {
                isHires = viewerHelpers.isImageHires(item);
            } catch (err) {
                console.warn('[FloatViewer] viewerHelpers.isImageHires error:', err);
            }
        }
        if (isHires === undefined) {
            const cfg = item?.generationConfig || {};
            if (!cfg || Object.keys(cfg).length === 0) {
                isHires = true;
            } else {
                let hiresFlag = cfg.hires_enabled;
                if (typeof hiresFlag === 'string') {
                    hiresFlag = hiresFlag.trim().toLowerCase() === 'true';
                }
                if (hiresFlag) {
                    isHires = true;
                } else {
                    const width = Number(cfg.width);
                    const baseWidth = Number(cfg.hires_base_width || cfg.width);
                    const height = Number(cfg.height);
                    const baseHeight = Number(cfg.hires_base_height || cfg.height);
                    isHires = (
                        (Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth) ||
                        (Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight)
                    );
                }
            }
        }

        if (isHires) {
            showError("Đã là ảnh hires rồi.");
            return;
        }

        if (!this.api?.album) {
            showError("Album API chưa sẵn sàng.");
            return;
        }

        try {
            const response = await this.api.album.post(`/images/${item.id}/hires`, {
                character_hash: item.character_hash
            });
            if (!response || !response.task_id) {
                throw new Error(response?.error || 'Không thể bắt đầu hires.');
            }
            Yuuka.events.emit('generation:task_created_locally', response);
        } catch (err) {
            showError(`Hires thất bại: ${err.message || err}`);
        }
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
