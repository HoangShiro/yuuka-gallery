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
            cachedComfySettings: null, // Yuuka: preloaded comfy settings (last_config + global_choices)
        };
        this.viewer = window.Yuuka.plugins.simpleViewer;
        this.clipboardService = this._ensureClipboardService();
        this.state.promptClipboard = this._getPromptClipboard();
        
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
            const initialCharacter = initialState.character;
            const shouldOpenSettings = Boolean(initialState.openSettings);
            const regenConfig = initialState.regenConfig;

            this.state.selectedCharacter = initialCharacter;
            delete window.Yuuka.initialPluginState.album;
            this.state.viewMode = 'album';
            await this.loadAndDisplayCharacterAlbum();
            if (regenConfig) this._startGeneration(regenConfig);
            if (shouldOpenSettings) {
                try {
                    await this.openSettings();
                } catch (err) {
                    console.error('[Album] Failed to open settings modal:', err);
                    showError('Không thể mở cài đặt Album.');
                }
            }
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
            // Yuuka: Preload Comfy settings for instant settings modal
            this._preloadComfySettings();
        } catch(e) {
            this.updateUI('error', `Lỗi tải album: ${e.message}`);
        }
    }

    _ensureClipboardService() {
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.services = window.Yuuka.services || {};
        if (!window.Yuuka.services.albumPromptClipboard) {
            const store = { data: null };
            window.Yuuka.services.albumPromptClipboard = {
                get() {
                    return store.data ? new Map(store.data) : null;
                },
                set(map) {
                    if (map instanceof Map) {
                        store.data = new Map(map);
                    } else if (Array.isArray(map)) {
                        store.data = new Map(map);
                    } else if (map && typeof map === 'object') {
                        store.data = new Map(Object.entries(map));
                    } else {
                        store.data = null;
                    }
                    return store.data ? new Map(store.data) : null;
                },
                clear() {
                    store.data = null;
                }
            };
        }
        return window.Yuuka.services.albumPromptClipboard;
    }

    _getPromptClipboard() {
        const stored = this.clipboardService?.get?.();
        this.state.promptClipboard = stored ? new Map(stored) : null;
        return this.state.promptClipboard;
    }

    _setPromptClipboard(value) {
        let map = null;
        if (value instanceof Map) {
            map = value;
        } else if (Array.isArray(value)) {
            map = new Map(value);
        } else if (value && typeof value === 'object') {
            map = new Map(Object.entries(value));
        }
        if (map) {
            const normalized = new Map();
            map.forEach((rawValue, rawKey) => {
                const key = String(rawKey || '').trim();
                if (!key) return;
                const cleaned = rawValue == null ? '' : String(rawValue).trim();
                normalized.set(key, cleaned);
            });
            map = normalized;
        }
        const stored = this.clipboardService?.set?.(map) || null;
        this.state.promptClipboard = stored ? new Map(stored) : null;
        return this.state.promptClipboard;
    }

    _analyzeWorkflowConfig(cfg = {}) {
        const normalizeStr = (value) => typeof value === 'string' ? value.trim() : '';
        const toBool = (value) => {
            if (typeof value === 'boolean') return value;
            if (typeof value === 'number') return value !== 0;
            if (typeof value === 'string') {
                const lowered = value.trim().toLowerCase();
                return ['1', 'true', 'yes', 'on'].includes(lowered);
            }
            return false;
        };
        const toNumber = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };

        const workflowTemplate = normalizeStr(cfg.workflow_template || cfg._workflow_template || '');
        const workflowTypeRaw = normalizeStr(cfg.workflow_type || cfg._workflow_type || '');
        let workflowType = workflowTypeRaw.toLowerCase();
        const templateLower = workflowTemplate.toLowerCase();

        const loraName = normalizeStr(cfg.lora_name);
        const hasLoRA = Boolean(loraName) && loraName.toLowerCase() !== 'none';

        let hiresEnabled = toBool(cfg.hires_enabled);

        const width = toNumber(cfg.width);
        const height = toNumber(cfg.height);
        let baseWidth = toNumber(cfg.hires_base_width);
        let baseHeight = toNumber(cfg.hires_base_height);

        const widthExceedsBase = Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth + 4;
        const heightExceedsBase = Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight + 4;

        if (!hiresEnabled) {
            if (workflowType.includes('hires') || templateLower.includes('hiresfix')) {
                hiresEnabled = true;
            } else if (widthExceedsBase || heightExceedsBase) {
                hiresEnabled = true;
            }
        }

        const bigDimensionDetected = (
            (Number.isFinite(width) && width >= 1536) ||
            (Number.isFinite(height) && height >= 1536)
        );
        if (!hiresEnabled && bigDimensionDetected && (!Number.isFinite(baseWidth) || baseWidth === null || baseWidth <= 0)) {
            hiresEnabled = true;
        }

        if (hiresEnabled) {
            if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
                if (Number.isFinite(width) && width > 0) {
                    baseWidth = Math.max(64, Math.round(width / 2));
                }
            }
            if (!Number.isFinite(baseHeight) || baseHeight <= 0) {
                if (Number.isFinite(height) && height > 0) {
                    baseHeight = Math.max(64, Math.round(height / 2));
                }
            }
        }

        if (!workflowType) {
            if (hiresEnabled) {
                workflowType = hasLoRA ? 'hires_lora' : 'hires';
            } else if (hasLoRA) {
                workflowType = 'sdxl_lora';
            } else {
                workflowType = 'standard';
            }
        }

        return {
            isHires: Boolean(hiresEnabled),
            hasLoRA,
            workflowTemplate,
            workflowType,
            baseWidth: Number.isFinite(baseWidth) && baseWidth > 0 ? Math.round(baseWidth) : null,
            baseHeight: Number.isFinite(baseHeight) && baseHeight > 0 ? Math.round(baseHeight) : null
        };
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
            // --- Multi-LoRA payload normalization v1.0 ---
            // Prefer lora_chain if present, otherwise accept lora_names; keep single lora_name for backward-compat.
            const incomingChain = Array.isArray(configOverrides?.lora_chain)
                ? configOverrides.lora_chain
                : (Array.isArray(payload.lora_chain) ? payload.lora_chain : null);
            if (incomingChain && incomingChain.length) {
                const cleanedChain = incomingChain
                    .map(entry => {
                        if (!entry) return null;
                        const name = String(entry.lora_name || entry.name || '').trim();
                        if (!name || name.toLowerCase() === 'none') return null;
                        const toNum = (v, d) => {
                            const n = Number(v);
                            return Number.isFinite(n) ? n : d;
                        };
                        const sm = toNum(entry.strength_model ?? entry.lora_strength_model ?? payload.lora_strength_model, 1.0);
                        const sc = toNum(entry.strength_clip ?? entry.lora_strength_clip ?? payload.lora_strength_clip, 1.0);
                        return { lora_name: name, strength_model: sm, strength_clip: sc };
                    })
                    .filter(Boolean);
                if (cleanedChain.length) {
                    payload.lora_chain = cleanedChain;
                    payload.lora_names = cleanedChain.map(c => c.lora_name);
                    if (cleanedChain.length === 1) {
                        payload.lora_name = cleanedChain[0].lora_name;
                        payload.lora_strength_model = cleanedChain[0].strength_model;
                        payload.lora_strength_clip = cleanedChain[0].strength_clip;
                    } else {
                        payload.lora_name = 'None';
                    }
                }
            } else if (Array.isArray(configOverrides?.lora_names) && configOverrides.lora_names.length) {
                const names = configOverrides.lora_names.map(n => String(n).trim()).filter(n => n && n.toLowerCase() !== 'none');
                if (names.length) {
                    payload.lora_names = names;
                    payload.lora_name = names.length === 1 ? names[0] : 'None';
                }
            }
            // --- End Multi-LoRA normalization ---
            if (configOverrides.seed === undefined) payload.seed = 0;
            if (Array.isArray(payload.lora_prompt_tags)) {
                payload.lora_prompt_tags = payload.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean);
            } else if (payload.lora_prompt_tags) {
                const tagText = String(payload.lora_prompt_tags).trim();
                payload.lora_prompt_tags = tagText ? [tagText] : [];
            } else {
                payload.lora_prompt_tags = [];
            }
            const analysis = this._analyzeWorkflowConfig(payload);
            payload.hires_enabled = analysis.isHires;
            if (analysis.baseWidth) {
                const currentBaseWidth = Number(payload.hires_base_width);
                if (!Number.isFinite(currentBaseWidth) || currentBaseWidth <= 0) {
                    payload.hires_base_width = analysis.baseWidth;
                }
            }
            if (analysis.baseHeight) {
                const currentBaseHeight = Number(payload.hires_base_height);
                if (!Number.isFinite(currentBaseHeight) || currentBaseHeight <= 0) {
                    payload.hires_base_height = analysis.baseHeight;
                }
            }
            // Always (re)compute workflow_type to avoid stale *_lora after removing LoRA
            if (analysis.workflowType) {
                payload.workflow_type = analysis.workflowType;
            }
            if (analysis.workflowTemplate && !payload.workflow_template) {
                payload.workflow_template = analysis.workflowTemplate;
            }

            if (payload.hires_enabled) {
                delete payload._workflow_type;
            } else if (analysis.hasLoRA) {
                payload._workflow_type = 'sdxl_lora';
            } else {
                delete payload._workflow_type;
                if (typeof payload.workflow_type === 'string' && /_lora$/.test(payload.workflow_type) && !analysis.hasLoRA) {
                    payload.workflow_type = 'standard';
                }
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
        this.state.cachedComfySettings = null; // Yuuka: reset preloaded comfy settings
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
            this.state.cachedComfySettings = null;
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
        this.state.cachedComfySettings = null;
        this.state.viewMode = 'album';
        await this.loadAndDisplayCharacterAlbum();
        this._updateNav();
    }

    renderCharacterAlbumView() { 
        this.contentArea.innerHTML = `<div class="plugin-album__grid image-grid"></div>`;
        this._renderImageGrid();
    }
    
    // --- Yuuka: Preload comfy settings (last_config + global_choices) so modal opens instantly ---
    async _preloadComfySettings(force = false) {
        if (!this.state?.selectedCharacter?.hash) return;
        if (!force && this.state.cachedComfySettings) return; // Already loaded
        try {
            const data = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
            if (data && (data.last_config || data.global_choices)) {
                this.state.cachedComfySettings = {
                    last_config: data.last_config || {},
                    global_choices: data.global_choices || null
                };
                if (data.global_choices) {
                    this.state.cachedComfyGlobalChoices = data.global_choices;
                }
            }
        } catch (err) {
            console.warn('[Album] Preload comfy settings failed:', err);
        }
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
            const resolveWorkflowDisplay = () => {
                const normalize = (value) => String(value || '').trim().toLowerCase();
                const workflowTemplate = String(cfg.workflow_template || '').trim();
                let workflowType = normalize(cfg.workflow_type);
                const hasLoRAName = typeof cfg.lora_name === 'string' && cfg.lora_name.trim() && cfg.lora_name.trim().toLowerCase() !== 'none';
                const hasLoRAChain = Array.isArray(cfg.lora_chain) && cfg.lora_chain.length > 0;
                const hasLoRANames = Array.isArray(cfg.lora_names) && cfg.lora_names.filter(n => String(n).trim().toLowerCase() !== 'none').length > 0;
                const hasAnyLoRA = hasLoRAName || hasLoRAChain || hasLoRANames;
                // If stale *_lora type but no LoRA now, strip suffix
                if (workflowType.endsWith('_lora') && !hasAnyLoRA) {
                    workflowType = workflowType.replace(/_lora$/, '');
                }
                const labelMap = {
                    'hires_lora': 'Hires Fix + LoRA',
                    'hires': 'Hires Fix',
                    'hires_input_image_lora': 'Hires Input Image + LoRA',
                    'hires_input_image': 'Hires Input Image',
                    'sdxl_lora': 'SDXL + LoRA',
                    'lora': 'SDXL + LoRA',
                    'standard': 'Standard'
                };
                let label = labelMap[workflowType];
                if (!label && workflowType.endsWith('_lora')) {
                    const baseType = workflowType.replace(/_lora$/, '');
                    if (labelMap[baseType]) {
                        label = hasAnyLoRA ? `${labelMap[baseType]} + LoRA` : labelMap[baseType];
                    }
                }
                if (!label) {
                    const templateLower = workflowTemplate.toLowerCase();
                    if (templateLower.includes('hiresfix') && templateLower.includes('input_image')) {
                        label = (templateLower.includes('lora') && hasAnyLoRA) ? 'Hires Input Image + LoRA' : 'Hires Input Image';
                    } else if (templateLower.includes('hiresfix')) {
                        label = (templateLower.includes('lora') && hasAnyLoRA) ? 'Hires Fix + LoRA' : 'Hires Fix';
                    } else if (templateLower.includes('lora') && hasAnyLoRA) {
                        label = 'SDXL + LoRA';
                    }
                }
                if (!label) {
                    const width = Number(cfg.width);
                    const height = Number(cfg.height);
                    const baseWidth = Number(cfg.hires_base_width);
                    const baseHeight = Number(cfg.hires_base_height);
                    const widthHires = Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth + 4;
                    const heightHires = Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight + 4;
                    const noBaseData = (!Number.isFinite(baseWidth) || baseWidth <= 0) && (!Number.isFinite(baseHeight) || baseHeight <= 0);
                    const bigDimension = (Number.isFinite(width) && width >= 1536) || (Number.isFinite(height) && height >= 1536);
                    if (widthHires || heightHires || (noBaseData && bigDimension)) {
                        label = hasAnyLoRA ? 'Hires Fix + LoRA' : 'Hires Fix';
                    }
                }
                if (!label) {
                    label = hasAnyLoRA ? 'SDXL + LoRA' : 'Standard';
                }
                if (workflowTemplate && workflowTemplate.toLowerCase() !== 'standard') {
                    return label ? `${label} (${workflowTemplate})` : workflowTemplate;
                }
                return label;
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
                (() => {
                    const displayLoRA = () => {
                        if (Array.isArray(cfg.lora_chain) && cfg.lora_chain.length) {
                            return cfg.lora_chain.map(item => {
                                const n = String(item.lora_name || item.name || '').trim();
                                if (!n) return null;
                                const sm = item.strength_model ?? item.lora_strength_model;
                                const sc = item.strength_clip ?? item.lora_strength_clip;
                                if (sm != null && sc != null && Number.isFinite(Number(sm)) && Number.isFinite(Number(sc))) {
                                    return `${n}(${Number(sm).toFixed(2)}/${Number(sc).toFixed(2)})`;
                                }
                                return n;
                            }).filter(Boolean).join(', ');
                        }
                        if (Array.isArray(cfg.lora_names) && cfg.lora_names.length) {
                            return cfg.lora_names.join(', ');
                        }
                        return cfg.lora_name;
                    };
                    return buildRow('LoRA', displayLoRA());
                })()
            }${
                buildRow('Workflow', resolveWorkflowDisplay())
            }</div>`;
            const loraTags = (() => {
                // Prefer structured multi-LoRA groups if present
                if (Array.isArray(cfg.multi_lora_prompt_groups)) {
                    const parts = cfg.multi_lora_prompt_groups
                        .map(arr => Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [])
                        .map(groupList => groupList.length ? `(${groupList.join(', ')})` : '')
                        .filter(Boolean);
                    if (parts.length) return parts.join(', ');
                }
                // Then accept legacy combined string if available
                if (typeof cfg.multi_lora_prompt_tags === 'string' && cfg.multi_lora_prompt_tags.trim()) {
                    return cfg.multi_lora_prompt_tags.trim();
                }
                // Fallback to legacy single-LoRA array
                if (Array.isArray(cfg.lora_prompt_tags)) {
                    return cfg.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean).join(', ');
                }
                return '';
            })();
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
            const clipboardData = keys.map(key => [key, cfg[key] ? String(cfg[key]).trim() : '']);
            this._setPromptClipboard(clipboardData);
            showError("Prompt đã sao chép.");
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
        if (!this.state.isComfyUIAvaidable) {
            try {
                await this.checkComfyUIStatus();
            } catch (err) {
                console.warn('[Album] Failed to refresh ComfyUI status before opening settings:', err);
            }
        }
        if (!this.state.isComfyUIAvaidable) { showError("ComfyUI chưa kết nối."); return; }
        const modalApi = window.Yuuka?.plugins?.albumModal;
        if (!modalApi || typeof modalApi.openSettingsModal !== 'function') {
            showError('Album settings UI is not ready.');
            return;
        }
        const currentClipboard = this._getPromptClipboard();
        // Ensure settings are preloaded; if not, this will fetch once here
        await this._preloadComfySettings();
        await modalApi.openSettingsModal({
            title: `Cấu hình cho ${this.state.selectedCharacter.name}`,
            modalClass: 'plugin-album__settings-modal',
            // Yuuka: comfyui fetch optimization v1.0
            fetchInfo: async () => {
                // Prefer fully preloaded settings (no network call)
                if (this.state.cachedComfySettings) {
                    const info = { ...this.state.cachedComfySettings };
                    if (info.last_config && this.state.selectedCharacter) {
                        info.last_config.character = this.state.selectedCharacter.name;
                    }
                    return info;
                }
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
                // Store to preload cache for subsequent opens
                if (finalInfo && (finalInfo.last_config || finalInfo.global_choices)) {
                    this.state.cachedComfySettings = {
                        last_config: finalInfo.last_config || {},
                        global_choices: finalInfo.global_choices || this.state.cachedComfyGlobalChoices || null
                    };
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
                // Update preload cache after saving so next open is instant and up to date
                this.state.cachedComfySettings = {
                    last_config: { ...(this.state.cachedComfySettings?.last_config || {}), ...updatedConfig },
                    global_choices: this.state.cachedComfyGlobalChoices || this.state.cachedComfySettings?.global_choices || null
                };
            },
            onGenerate: async (updatedConfig) => {
                await this._startGeneration(updatedConfig);
            },
            promptClipboard: currentClipboard,
            getPromptClipboard: () => this._getPromptClipboard(),
            setPromptClipboard: (value) => this._setPromptClipboard(value),
            // Yuuka: comfyui fetch optimization v1.0
            onConnect: async (address, btn, close) => {
                btn.textContent = '...';
                btn.disabled = true;
                try {
                    await this.api.server.checkComfyUIStatus(address);
                    // Xóa toàn bộ cache để nạp lại từ server mới
                    this.state.cachedComfyGlobalChoices = null;
                    this.state.cachedComfySettings = null;
                    close(); // Đóng modal hiện tại
                    await this.openSettings(); // Mở lại để tải lại dữ liệu mới
                } catch (e) {
                    showError(`Lỗi kết nối hoặc làm mới: ${e.message}`);
                    // Nút sẽ tự reset khi người dùng mở lại modal
                }
            },
            onDelete: async () => {
                const current = this.state.selectedCharacter;
                if (!current?.hash) {
                    throw new Error('Không xác định được album đang mở.');
                }
                await this.api.album.delete(`/${current.hash}`);
                showError('Album đã được xóa.');
                this.state.selectedCharacter = null;
                this.state.allImageData = [];
                this.state.cachedComfyGlobalChoices = null;
                this.state.cachedComfySettings = null;
                this.state.viewMode = 'grid';
                await this.showCharacterSelectionGrid();
                this._updateNav();
            }
        });
    }
}

window.Yuuka.components['AlbumComponent'] = AlbumComponent;
