// --- MODIFIED FILE: plugins/album/static/album.js ---
class AlbumComponent {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.state = {
            selectedCharacter: null,
            viewMode: 'grid',
            allImageData: [],
            promptClipboard: null,
            isComfyUIAvaidable: false,
            cachedComfyGlobalChoices: null, // Yuuka: comfyui fetch optimization v1.0
        };
        this.viewer = window.Yuuka.plugins.simpleViewer;
        
        // Yuuka: Bind các event handler một lần duy nhất
        this.handleImageAdded = this.handleImageAdded.bind(this);
        this.handleTaskEnded = this.handleTaskEnded.bind(this);
        this.handleGenerationUpdate = this.handleGenerationUpdate.bind(this);
        this.handleImageDeleted = this.handleImageDeleted.bind(this); // Yuuka: event bus v1.0
    }

    async init() {
        console.log("[Plugin:Album] Initializing...");
        this.container.classList.add('plugin-album');
        this.checkComfyUIStatus();

        this.container.innerHTML = `<div class="plugin-album__content-area"></div>`;
        this.contentArea = this.container.querySelector('.plugin-album__content-area');

        // Yuuka: Lắng nghe các sự kiện toàn cục từ Lõi
        Yuuka.events.on('image:added', this.handleImageAdded);
        Yuuka.events.on('generation:task_ended', this.handleTaskEnded);
        Yuuka.events.on('generation:update', this.handleGenerationUpdate);
        Yuuka.events.on('image:deleted', this.handleImageDeleted); // Yuuka: event bus v1.0

        // Yuuka: navibar v2.0 integration - Đăng ký button một lần
        this._registerNavibarButtons();

        const initialState = window.Yuuka.initialPluginState.album;
        if (initialState) {
            this.state.selectedCharacter = initialState.character;
            delete window.Yuuka.initialPluginState.album;
            this.state.viewMode = 'album';
            await this.loadAndDisplayCharacterAlbum();
            if (initialState.regenConfig) this._startGeneration(initialState.regenConfig);
        } else {
            this.state.viewMode = 'grid';
            await this.showCharacterSelectionGrid();
        }
        this._updateNav();
    }

    destroy() {
        console.log("[Plugin:Album] Destroying...");
        // Yuuka: Hủy lắng nghe sự kiện khi component bị hủy
        Yuuka.events.off('image:added', this.handleImageAdded);
        Yuuka.events.off('generation:task_ended', this.handleTaskEnded);
        Yuuka.events.off('generation:update', this.handleGenerationUpdate);
        Yuuka.events.off('image:deleted', this.handleImageDeleted); // Yuuka: event bus v1.0
        
        const navibar = window.Yuuka.services.navibar;
        if (navibar) {
            navibar.setActivePlugin(null);
        }

        this.contentArea.innerHTML = '';
        this.container.classList.remove('plugin-album');
    }

    // --- YUUKA: EVENT HANDLERS V4.0 (ROBUST REFRESH) ---
    
    handleImageAdded(eventData) {
        const { task_id, image_data } = eventData;
        
        if (this.state.viewMode === 'album' && this.state.selectedCharacter?.hash === image_data.character_hash) {
            // Cập nhật state cục bộ ngay lập tức
            const existingIndex = this.state.allImageData.findIndex(img => img.id === image_data.id);
            if (existingIndex === -1) {
                this.state.allImageData.unshift(image_data);
            }

            // Cập nhật "lạc quan" trên UI
            const placeholder = document.getElementById(task_id);
            if (placeholder) {
                const newCard = this._createImageCard(image_data);
                placeholder.replaceWith(newCard);
            }
        }
        this._updateNav();
    }
    
    handleImageDeleted({ imageId }) { // Yuuka: event bus v1.0
        const index = this.state.allImageData.findIndex(img => img.id === imageId);
        if (index > -1) {
            this.state.allImageData.splice(index, 1);
            if (this.state.viewMode === 'album') {
                this.contentArea.querySelector(`.plugin-album__image-card[data-id="${imageId}"]`)?.remove();
            }
        }
    }

    handleTaskEnded(payload) {
        const taskId = payload?.taskId || payload?.task_id;
        if (!taskId) return;
        
        // Yuuka: image placeholder v2.0
        // Kích hoạt cơ chế làm mới an toàn để đảm bảo đồng bộ
        if (this.state.viewMode === 'album' && this.state.selectedCharacter) {
            this._refreshAlbumAndPlaceholders();
        } else {
            // Nếu không ở trong album, chỉ cần xóa placeholder (nếu có)
             document.getElementById(taskId)?.remove();
        }
        this._updateNav();
    }

    handleGenerationUpdate(allTasksStatus) {
        // Cập nhật overlay ở grid chọn nhân vật
        const runningTasksByHash = new Map();
        Object.values(allTasksStatus).forEach(task => {
            if (!runningTasksByHash.has(task.character_hash)) {
                runningTasksByHash.set(task.character_hash, task);
            }
        });

        document.querySelectorAll('.plugin-album__grid .character-card').forEach(card => {
            const charHash = card.dataset.hash;
            const status = runningTasksByHash.get(charHash);
            const existingOverlay = card.querySelector('.album-grid-progress-overlay');

            if (status) {
                card.classList.add('is-generating');
                let overlay = existingOverlay;
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.className = 'album-grid-progress-overlay';
                    overlay.innerHTML = `<div class="plugin-album__progress-bar-container"><div class="plugin-album__progress-bar"></div></div><div class="plugin-album__progress-text"></div>`;
                    card.querySelector('.image-container').appendChild(overlay);
                }
                overlay.querySelector('.plugin-album__progress-bar').style.width = `${status.progress_percent || 0}%`;
                overlay.querySelector('.plugin-album__progress-text').textContent = status.progress_message;
            } else if (existingOverlay) {
                card.classList.remove('is-generating');
                existingOverlay.remove();
            }
        });

        // Chỉ cập nhật placeholder trong album hiện tại
        if (this.state.viewMode === 'album' && this.state.selectedCharacter) {
            const grid = this.contentArea.querySelector('.plugin-album__grid');
             Object.values(allTasksStatus).forEach(task => {
                if (task.character_hash === this.state.selectedCharacter.hash) {
                    const placeholder = document.getElementById(task.task_id);
                    if (placeholder) {
                        placeholder.querySelector('.plugin-album__progress-bar').style.width = `${task.progress_percent || 0}%`;
                        placeholder.querySelector('.plugin-album__progress-text').textContent = task.progress_message || '...';
                    } else if (grid) {
                        const newPlaceholder = this._createPlaceholderCard(task.task_id);
                        grid.prepend(newPlaceholder);
                        const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                        if (emptyMsg) emptyMsg.style.display = 'none';
                    }
                }
            });
        }
    }

    // --- END OF REFACTORED HANDLERS ---
    
    // Yuuka: navibar v2.0 integration
    _registerNavibarButtons() {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;

        // Yuuka: navibar auto-init v1.0 - Gỡ bỏ việc đăng ký nút chính 'album-main'
        // Navibar sẽ tự động đăng ký nút này từ manifest.

        // 2. Tool buttons (only visible when active)
        navibar.registerButton({
            id: 'album-settings',
            type: 'tools',
            pluginId: 'album',
            order: 1,
            icon: 'tune',
            title: 'Cấu hình',
            onClick: () => this.openSettings()
        });

        navibar.registerButton({
            id: 'album-generate',
            type: 'tools',
            pluginId: 'album',
            order: 2,
            icon: 'auto_awesome',
            title: 'Tạo ảnh mới',
            onClick: () => {
                // Logic kiểm tra điều kiện được chuyển vào đây
                const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
                if (tasksForThisChar >= 5) {
                    showError("Đã đạt giới hạn 5 tác vụ đồng thời.");
                    return;
                }
                if (!this.state.isComfyUIAvaidable) {
                    showError("ComfyUI chưa kết nối.");
                    return;
                }
                this._startGeneration();
            }
        });
    }

    _updateNav() {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;
        // Chỉ cần báo cho navibar biết plugin nào đang hoạt động
        navibar.setActivePlugin(this.state.viewMode === 'album' ? 'album' : null);
    }
    
    async checkComfyUIStatus() { try{const s=await this.api.album.get('/comfyui/info').catch(()=>({}));const t=s?.last_config?.server_address||'127.0.0.1:8888';await this.api.server.checkComfyUIStatus(t);this.state.isComfyUIAvaidable=true;}catch(e){this.state.isComfyUIAvaidable=false;showError("Album: Không thể kết nối ComfyUI.");}}
    
    async loadAndDisplayCharacterAlbum() { 
        try {
            this.updateUI('loading', `Đang tải album của ${this.state.selectedCharacter.name}...`);
            await this._refreshAlbumAndPlaceholders(); // Yuuka: Sử dụng hàm làm mới an toàn
        } catch(e) {
            this.updateUI('error', `Lỗi tải album: ${e.message}`);
        }
    }

    async _startGeneration(configOverrides={}) {
        if (this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length >= 5) { showError("Đã đạt giới hạn 5 tác vụ đồng thời."); return; }
        if (!this.state.isComfyUIAvaidable) { showError("ComfyUI chưa kết nối."); return; }
        let tempTaskId = `temp_${Date.now()}`;
        try {
            const grid = this.contentArea.querySelector('.plugin-album__grid');
            if (grid) {
                const placeholder = this._createPlaceholderCard(tempTaskId);
                grid.prepend(placeholder);
                const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                if (emptyMsg) emptyMsg.style.display = 'none';
            }
            this._updateNav();
            
            const { last_config } = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
            const payload = { ...last_config, ...configOverrides, character: this.state.selectedCharacter.name };
            if (configOverrides.seed === undefined) payload.seed = 0;
            if (Array.isArray(payload.lora_prompt_tags)) {
                payload.lora_prompt_tags = payload.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean);
            } else if (payload.lora_prompt_tags) {
                const tagText = String(payload.lora_prompt_tags).trim();
                payload.lora_prompt_tags = tagText ? [tagText] : [];
            } else {
                payload.lora_prompt_tags = [];
            }
            if (typeof payload.hires_enabled === 'string') {
                payload.hires_enabled = payload.hires_enabled.trim().toLowerCase() === 'true';
            } else {
                payload.hires_enabled = Boolean(payload.hires_enabled);
            }
            const hasLoRA = typeof payload.lora_name === 'string'
                && payload.lora_name.trim()
                && payload.lora_name.trim().toLowerCase() !== 'none';
            if (payload.hires_enabled) {
                delete payload._workflow_type;
            } else if (hasLoRA) {
                payload._workflow_type = 'sdxl_lora';
            } else {
                delete payload._workflow_type;
            }
            const response = await this.api.generation.start(this.state.selectedCharacter.hash, payload);
            
            const tempPlaceholder = document.getElementById(tempTaskId);
            if (tempPlaceholder) {
                tempPlaceholder.id = response.task_id;
                // Yuuka: cancel task fix v1.0
                const cancelButton = tempPlaceholder.querySelector('.plugin-album__cancel-btn');
                if (cancelButton) {
                    cancelButton.dataset.taskId = response.task_id;
                }
            }

        } catch(err) {
            document.getElementById(tempTaskId)?.remove();
            showError(`Bắt đầu thất bại: ${err.message}`);
            this._updateNav();
        }
    }
    
    /**
     * Yuuka: image placeholder v2.0 - Hàm làm mới an toàn
     * Lấy trạng thái mới nhất của ảnh và các tác vụ đang chạy, sau đó render lại toàn bộ.
     */

    async _startHiresUpscale(item) {
        const viewerHelpers = window.Yuuka?.viewerHelpers;
        let isHires;
        if (viewerHelpers?.isImageHires) {
            try {
                isHires = viewerHelpers.isImageHires(item);
            } catch (err) {
                console.warn('[Album] viewerHelpers.isImageHires error:', err);
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
        if (this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length >= 5) {
            showError("Đã đạt giới hạn 5 tác vụ đồng thời.");
            return;
        }
        if (!this.state.isComfyUIAvaidable) {
            showError("ComfyUI chưa kết nối.");
            return;
        }
        if (!item?.id) {
            showError("Không thể xác định ảnh để hires.");
            return;
        }

        const grid = this.contentArea.querySelector('.plugin-album__grid');
        const tempTaskId = `temp_hires_${Date.now()}`;
        let placeholder = null;

        try {
            if (grid) {
                placeholder = this._createPlaceholderCard(tempTaskId);
                grid.prepend(placeholder);
                const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                if (emptyMsg) emptyMsg.style.display = 'none';
            }
            this._updateNav();

            const payload = {
                character_hash: this.state.selectedCharacter?.hash || item.character_hash
            };
            const response = await this.api.album.post(`/images/${item.id}/hires`, payload);
            if (!response || !response.task_id) {
                throw new Error(response?.error || 'Không thể bắt đầu hires.');
            }

            Yuuka.events.emit('generation:task_created_locally', response);

            if (placeholder) {
                placeholder.id = response.task_id;
                const cancelButton = placeholder.querySelector('.plugin-album__cancel-btn');
                if (cancelButton) {
                    cancelButton.dataset.taskId = response.task_id;
                }
            }
        } catch (err) {
            if (placeholder) {
                placeholder.remove();
            }
            const message = err?.message || String(err);
            showError(`Hires thất bại: ${message}`);
        } finally {
            this._updateNav();
        }
    }

    async _refreshAlbumAndPlaceholders() {
        if (!this.state.selectedCharacter) return;
    
        try {
            const [images, status] = await Promise.all([
                this.api.images.getByCharacter(this.state.selectedCharacter.hash),
                this.api.generation.getStatus()
            ]);
    
            this.state.allImageData = images;
            this.renderCharacterAlbumView(); // Render layout cơ bản
    
            const grid = this.contentArea.querySelector('.plugin-album__grid');
            if (!grid) return;
    
            // Lọc các tác vụ đang chạy chỉ cho nhân vật hiện tại
            const runningTasksForChar = Object.values(status.tasks || {})
                .filter(task => task.character_hash === this.state.selectedCharacter.hash);
    
            // Thêm lại các placeholder cho các tác vụ còn đang chạy
            if (runningTasksForChar.length > 0) {
                const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                if (emptyMsg) emptyMsg.style.display = 'none';
    
                runningTasksForChar.forEach(task => {
                    const placeholder = this._createPlaceholderCard(task.task_id);
                    grid.prepend(placeholder); // Luôn thêm vào đầu
                    // Cập nhật ngay trạng thái cho placeholder vừa tạo
                    placeholder.querySelector('.plugin-album__progress-bar').style.width = `${task.progress_percent || 0}%`;
                    placeholder.querySelector('.plugin-album__progress-text').textContent = task.progress_message || '...';
                });
            }
        } catch(e) {
            console.error("[Album] Lỗi khi làm mới album và placeholders:", e);
            this.updateUI('error', `Lỗi đồng bộ: ${e.message}`);
        } finally {
            this._updateNav();
        }
    }

    updateUI(state, text='') {
        if (state === 'error') {
            this.contentArea.innerHTML = `<div class="error-msg">${text}</div>`;
        } else if (state === 'loading') {
            this.contentArea.innerHTML = `<div class="loader visible">${text}</div>`;
        }
    }
    
    async showCharacterSelectionGrid() {
        this.state.viewMode = 'grid';
        this._updateNav();
        this.state.selectedCharacter = null;
        this.state.cachedComfyGlobalChoices = null; // Yuuka: comfyui fetch optimization v1.0
        this.updateUI('loading', 'Đang tải danh sách album...');
        try {
            const albums = await this.api.album.get('/albums');
            this.contentArea.innerHTML = `<div class="plugin-album__grid"></div>`;
            const grid = this.contentArea.querySelector('.plugin-album__grid');
            if (!grid) return;

            grid.appendChild(this._createAddAlbumCard());

            if (!albums || albums.length === 0) {
                const emptyMsg = document.createElement('p');
                emptyMsg.className = 'plugin-album__empty-msg';
                emptyMsg.textContent = 'Chưa có album nào, hãy ấn "+" để tạo album mới.';
                grid.appendChild(emptyMsg);
            } else {
                albums.forEach(album => {
                    grid.appendChild(this._createAlbumGridCard(album));
                });
            }

            const currentStatus = await this.api.generation.getStatus();
            this.handleGenerationUpdate(currentStatus.tasks || {});
        } catch (e) {
            showError(`Lỗi tải danh sách album: ${e.message}`);
            this.updateUI('error', `Loi: ${e.message}`);
        }
    }

    _createAlbumGridCard(album) {
        const card = document.createElement('div');
        card.className = 'character-card album-character-card';
        card.dataset.hash = album.hash;
        if (album.is_custom) {
            card.dataset.isCustom = '1';
        }
        const displayName = (album.name && album.name.trim()) ? album.name : 'Album chưa đặt tên';
        const imageContainer = document.createElement('div');
        imageContainer.className = 'image-container';
        if (album.cover_url) {
            const img = document.createElement('img');
            img.src = album.cover_url;
            img.alt = displayName;
            img.loading = 'lazy';
            imageContainer.appendChild(img);
        } else {
            imageContainer.classList.add('no-cover');
            imageContainer.innerHTML = `<span class="material-symbols-outlined">image</span>`;
        }
        const nameEl = document.createElement('div');
        nameEl.className = 'name';
        nameEl.textContent = displayName;
        card.appendChild(imageContainer);
        card.appendChild(nameEl);
        card.addEventListener('click', async () => {
            this.state.selectedCharacter = { hash: album.hash, name: displayName, isCustom: !!album.is_custom };
            this.state.cachedComfyGlobalChoices = null;
            this.state.allImageData = [];
            this.state.viewMode = 'album';
            await this.loadAndDisplayCharacterAlbum();
            this._updateNav();
        });
        return card;
    }

    _createAddAlbumCard() {
        const card = document.createElement('div');
        card.className = 'character-card album-add-card';
        card.dataset.hash = '';
        const imageContainer = document.createElement('div');
        imageContainer.className = 'image-container no-cover';
        imageContainer.innerHTML = `<span class="material-symbols-outlined">add</span>`;
        const nameEl = document.createElement('div');
        nameEl.className = 'name';
        nameEl.textContent = 'Add new';
        card.appendChild(imageContainer);
        card.appendChild(nameEl);
        card.addEventListener('click', () => {
            this._handleCreateNewAlbum();
        });
        return card;
    }

    _generateAlbumHash() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return `album-custom-${window.crypto.randomUUID()}`;
        }
        const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        return `album-custom-${fallback}`;
    }

    async _handleCreateNewAlbum() {
        const newHash = this._generateAlbumHash();
        this.state.selectedCharacter = {
            hash: newHash,
            name: 'empty',
            isCustom: true
        };
        this.state.allImageData = [];
        this.state.cachedComfyGlobalChoices = null;
        this.state.viewMode = 'album';
        await this.loadAndDisplayCharacterAlbum();
        this._updateNav();
    }

    renderCharacterAlbumView() { 
        this.contentArea.innerHTML = `<div class="plugin-album__grid image-grid"></div>`;
        this._renderImageGrid();
    }
    
    _renderImageGrid() {
        const grid = this.contentArea.querySelector('.plugin-album__grid');
        if (!grid) return;
        grid.innerHTML = '';

        if (this.state.selectedCharacter) {
            grid.appendChild(this._createAlbumSettingsCard());
        }

        if (this.state.allImageData.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'plugin-album__empty-msg';
            emptyMsg.textContent = 'Album này chưa có ảnh nào, hãy ấn "+" để tạo ảnh mới.';
            grid.appendChild(emptyMsg);
            return;
        }

        this.state.allImageData.forEach(imgData => grid.appendChild(this._createImageCard(imgData)));
    }

    
    _createAlbumSettingsCard() {
        const card = document.createElement('div');
        card.className = 'character-card album-add-card plugin-album__settings-card';
        card.dataset.role = 'album-settings';

        const imageContainer = document.createElement('div');
        imageContainer.className = 'image-container no-cover';
        imageContainer.innerHTML = `<span class="material-symbols-outlined">add</span>`;

        card.appendChild(imageContainer);
        card.setAttribute('role', 'button');
        card.setAttribute('title', 'Album settings');
        card.tabIndex = 0;

        const triggerSettings = () => this.openSettings();
        card.addEventListener('click', triggerSettings);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                triggerSettings();
            }
        });

        return card;
    }

    _createImageCard(imgData) { const c=document.createElement('div');c.className='plugin-album__album-card plugin-album__image-card';c.dataset.id=imgData.id;c.innerHTML=`<img src="${imgData.pv_url}" alt="Art" loading="lazy">`;c.addEventListener('click',()=>this.renderImageViewer(imgData));return c;} // Yuuka: preview image fix v1.0

    _createPlaceholderCard(taskId) {
        const placeholder = document.createElement('div');
        placeholder.className = 'plugin-album__album-card placeholder-card';
        placeholder.id = taskId;
        // Yuuka: global cancel v1.0
        placeholder.innerHTML = `
            <div class="plugin-album__progress-bar-container"><div class="plugin-album__progress-bar"></div></div>
            <div class="plugin-album__progress-text">Đang khởi tạo...</div>
            <button class="plugin-album__cancel-btn" data-task-id="${taskId}"><span class="material-symbols-outlined">stop</span> Hủy</button>
        `;
        placeholder.querySelector('.plugin-album__cancel-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            // Yuuka: cancel task fix v1.0 - Đọc ID từ data attribute
            const currentTaskId = e.currentTarget.dataset.taskId;
            this.api.generation.cancel(currentTaskId).catch(err => showError(`Lỗi hủy: ${err.message}`));
        });
        return placeholder;
    }
    

    renderImageViewer(imgData) {
        const startIndex = this.state.allImageData.findIndex(img => img.id === imgData.id);
        const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
        const isGenDisabled = tasksForThisChar >= 5 || !this.state.isComfyUIAvaidable;
        const viewerHelpers = window.Yuuka?.viewerHelpers;

        const fallbackInfoPanel = (item) => {
            const cfg = item?.generationConfig;
            if (!cfg) return "Không có thông tin.";
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
            const renderTime = item.creationTime ? `${Number(item.creationTime).toFixed(2)} giây` : '';
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
            const loraTagsBlock = loraTags ? buildRow('LoRA Tags', loraTags) : '';
            const sections = [];
            if (promptRows) sections.push(promptRows, '<hr>');
            sections.push(infoGrid);
            if (loraTagsBlock) sections.push(loraTagsBlock);
            if (createdText || renderTime) sections.push('<hr>');
            if (createdText) sections.push(buildRow('Created', createdText));
            if (renderTime) sections.push(buildRow('Render time', renderTime));
            return sections.filter(Boolean).join('').trim();
        };

        const renderInfoPanel = (item) => {
            if (viewerHelpers?.buildInfoPanel) {
                try {
                    return viewerHelpers.buildInfoPanel(item);
                } catch (err) {
                    console.warn('[Album] viewerHelpers.buildInfoPanel error:', err);
                }
            }
            return fallbackInfoPanel(item);
        };

        const isImageHiresFn = (item) => {
            if (viewerHelpers?.isImageHires) {
                try {
                    return viewerHelpers.isImageHires(item);
                } catch (err) {
                    console.warn('[Album] viewerHelpers.isImageHires error:', err);
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

        const copyPromptHandler = (item) => {
            const cfg = item.generationConfig;
            const keys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
            this.state.promptClipboard = new Map(
                keys.map(key => [key, cfg[key] ? String(cfg[key]).trim() : ''])
            );
            showError("Prompt đã copy.");
        };

        const deleteHandler = async (item, close, updateItems) => {
            if (await Yuuka.ui.confirm('Có chắc chắn muốn xóa ảnh này?')) {
                try {
                    await this.api.images.delete(item.id);
                    Yuuka.events.emit('image:deleted', { imageId: item.id });

                    const updatedItems = this.state.allImageData
                        .filter(img => img.id !== item.id)
                        .map(d => ({ ...d, imageUrl: d.url }));
                    updateItems(updatedItems);
                } catch (err) {
                    showError(`Lỗi xóa: ${err.message}`);
                }
            }
        };

        let actionButtons;
        if (viewerHelpers?.createActionButtons) {
            actionButtons = viewerHelpers.createActionButtons({
                regen: {
                    disabled: () => isGenDisabled,
                    onClick: (item, close) => {
                        close();
                        this._startGeneration(item.generationConfig);
                    }
                },
                hires: {
                    disabled: (item) => isGenDisabled || isImageHiresFn(item),
                    onClick: (item) => this._startHiresUpscale(item)
                },
                copy: {
                    onClick: copyPromptHandler
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
                    title: 'Re-generate',
                    disabled: () => isGenDisabled,
                    onClick: (item, close) => {
                        close();
                        this._startGeneration(item.generationConfig);
                    }
                },
                {
                    id: 'hires',
                    icon: 'wand_stars',
                    title: 'Hires x2',
                    disabled: (item) => isGenDisabled || isImageHiresFn(item),
                    onClick: (item) => this._startHiresUpscale(item)
                },
                {
                    id: 'copy',
                    icon: 'content_copy',
                    title: 'Copy Prompt',
                    onClick: copyPromptHandler
                },
                {
                    id: 'delete',
                    icon: 'delete',
                    title: 'Remove Image',
                    onClick: deleteHandler
                }
            ];
        }

        this.viewer.open({
            items: this.state.allImageData.map(d => ({ ...d, imageUrl: d.url })),
            startIndex,
            renderInfoPanel,
            actionButtons
        });
    }

    async openSettings() {
        if (!this.state.isComfyUIAvaidable) { showError("ComfyUI chưa kết nối."); return; }
        const modalApi = window.Yuuka?.plugins?.albumModal;
        if (!modalApi || typeof modalApi.openSettingsModal !== 'function') {
            showError('Album settings UI is not ready.');
            return;
        }
        await modalApi.openSettingsModal({
            title: `Cấu hình cho ${this.state.selectedCharacter.name}`,
            modalClass: 'plugin-album__settings-modal',
            // Yuuka: comfyui fetch optimization v1.0
            fetchInfo: async () => {
                let finalInfo = {};
                if (this.state.cachedComfyGlobalChoices) {
                    const configData = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}&no_choices=true`);
                    finalInfo = {
                        last_config: configData.last_config,
                        global_choices: this.state.cachedComfyGlobalChoices
                    };
                } else {
                    const fullData = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
                    if (fullData.global_choices) {
                        this.state.cachedComfyGlobalChoices = fullData.global_choices;
                    }
                    finalInfo = fullData;
                }
                if (finalInfo.last_config && this.state.selectedCharacter) {
                    finalInfo.last_config.character = this.state.selectedCharacter.name;
                }
                return finalInfo;
            },
            onSave: async (updatedConfig) => {
                await this.api.album.post(`/${this.state.selectedCharacter.hash}/config`, updatedConfig);
                const trimmedName = (updatedConfig.character || '').trim();
                if (trimmedName) {
                    updatedConfig.character = trimmedName;
                    this.state.selectedCharacter.name = trimmedName;
                } else if (this.state.selectedCharacter && this.state.selectedCharacter.isCustom) {
                    this.state.selectedCharacter.name = 'Album mới';
                    updatedConfig.character = this.state.selectedCharacter.name;
                } else {
                    updatedConfig.character = this.state.selectedCharacter?.name || '';
                }
            },
            onGenerate: async (updatedConfig) => {
                await this._startGeneration(updatedConfig);
            },
            promptClipboard: this.state.promptClipboard,
            // Yuuka: comfyui fetch optimization v1.0
            onConnect: async (address, btn, close) => {
                btn.textContent = '...';
                btn.disabled = true;
                try {
                    await this.api.server.checkComfyUIStatus(address);
                    this.state.cachedComfyGlobalChoices = null; // Xóa cache
                    close(); // Đóng modal hiện tại
                    await this.openSettings(); // Mở lại để tải lại dữ liệu mới
                } catch (e) {
                    showError(`Lỗi kết nối hoặc làm mới: ${e.message}`);
                    // Nút sẽ tự reset khi người dùng mở lại modal
                }
            }
        });
    }
}

window.Yuuka.components['AlbumComponent'] = AlbumComponent;
