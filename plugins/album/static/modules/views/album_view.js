// Album plugin - View module: album view (image grid)
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    const normalizeTaskId = (taskOrId) => {
        if (taskOrId && typeof taskOrId === 'object') {
            return String(taskOrId.task_id || taskOrId.taskId || '').trim();
        }
        return String(taskOrId || '').trim();
    };

    const getTaskConfig = (task) => {
        if (!task || typeof task !== 'object') return {};
        const cfg = task.generation_config;
        return (cfg && typeof cfg === 'object') ? cfg : {};
    };

    const getPlaceholderTitle = (task) => {
        const cfg = getTaskConfig(task);
        const workflowType = String(cfg.workflow_type || cfg._workflow_type || '').trim().toLowerCase();
        const workflowTemplate = String(cfg.workflow_template || cfg._workflow_template || '').trim().toLowerCase();
        if (workflowType === 'hires_input_image' || workflowType === 'hires_input_image_lora') return 'Hires x2';
        if (workflowType.includes('hires') || workflowTemplate.includes('hiresfix')) return 'Đang tạo ảnh hires';
        if (workflowType === 'dasiwa_wan2_i2v') return 'Đang tạo video';
        return 'Đang tạo ảnh';
    };

    const getPlaceholderPhase = (task) => {
        const cfg = getTaskConfig(task);
        const workflowType = String(cfg.workflow_type || cfg._workflow_type || '').trim().toLowerCase();
        const workflowTemplate = String(cfg.workflow_template || cfg._workflow_template || '').trim().toLowerCase();
        const message = String(task?.progress_message || '').trim();
        const lowered = message.toLowerCase();

        if (lowered.includes('hàng đợi')) return 'Xếp hàng';
        if (lowered.includes('khởi tạo')) return 'Khởi tạo';
        if (lowered.includes('xử lý kết quả')) return 'Hoàn tất';
        if (lowered.includes('bắt đầu xử lý')) {
            if (workflowType === 'hires_input_image' || workflowType === 'hires_input_image_lora') return 'Bước 1/2 · Nạp ảnh nguồn';
            if (workflowType.includes('hires') || workflowTemplate.includes('hiresfix')) return 'Bước 1/2 · Tạo ảnh gốc';
            return 'Đang xử lý';
        }
        if (lowered.includes('đang tạo')) {
            if (workflowType === 'hires_input_image' || workflowType === 'hires_input_image_lora') return 'Bước 2/2 · Upscale hires';
            if (workflowType.includes('hires') || workflowTemplate.includes('hiresfix')) return 'Bước 2/2 · Hires fix';
            return 'Đang tạo';
        }
        if (workflowType === 'hires_input_image' || workflowType === 'hires_input_image_lora') return 'Bước 1/2 · Chuẩn bị';
        if (workflowType.includes('hires') || workflowTemplate.includes('hiresfix')) return 'Bước 1/2 · Chuẩn bị';
        return 'Đang xử lý';
    };

    const getTaskWorkflowLabel = (task) => {
        const directLabel = String(task?.workflow_label || '').trim();
        if (directLabel) return directLabel;
        const cfg = getTaskConfig(task);
        return String(cfg.workflow_template || cfg.workflow_type || cfg._workflow_template || cfg._workflow_type || '').trim();
    };

    const getTaskNodeSummary = (task) => {
        const eventType = String(task?.comfy_event_type || '').trim();
        const queuePositionRaw = Number(task?.queue_position);
        const queuePosition = Number.isFinite(queuePositionRaw) ? Math.max(0, Math.round(queuePositionRaw)) : null;
        const nodeLabel = String(task?.current_node_label || task?.current_node_type || '').trim();
        const stepValueRaw = Number(task?.step_value);
        const stepMaxRaw = Number(task?.step_max);
        const stepValue = Number.isFinite(stepValueRaw) ? Math.max(0, Math.round(stepValueRaw)) : null;
        const stepMax = Number.isFinite(stepMaxRaw) ? Math.max(0, Math.round(stepMaxRaw)) : null;

        if (eventType === 'queued') {
            if (queuePosition !== null && queuePosition > 0) return `Queue - ${queuePosition} ahead`;
            return 'Queue - waiting';
        }

        if (nodeLabel) {
            if (stepValue !== null && stepMax !== null && stepMax > 0) {
                return `${nodeLabel} - ${stepValue}/${stepMax}`;
            }
            return `${nodeLabel} - ...`;
        }

        const message = String(task?.progress_message || '').trim();
        if (message) return message;
        return 'Preparing - ...';
    };

    Object.assign(proto, {
        async loadAndDisplayCharacterAlbum() {
            try {
                this.updateUI('loading', `Đang tải album của ${this.state.selectedCharacter.name}...`);
                await this._refreshAlbumAndPlaceholders(); // Yuuka: Sử dụng hàm làm mới an toàn
                // Yuuka: Preload Comfy settings for instant settings modal
                this._preloadComfySettings();
                this._syncDOMSelection();
            } catch (e) {
                this.updateUI('error', `Lỗi tải album: ${e.message}`);
            }
        },

        async openAlbumView(selected) {
            this._characterTeardown();
            this.state.selectedCharacter = selected;
            this.state.cachedComfyGlobalChoices = null;
            this.state.cachedComfySettings = null;
            this.state.allImageData = [];
            this.state.viewMode = 'album';
            this._syncDOMSelection();
            await this.loadAndDisplayCharacterAlbum();
            this._updateNav();
        },

        renderCharacterAlbumView() {
            if (!this.contentArea) return;
            this.contentArea.innerHTML = `<div class="plugin-album__grid image-grid"></div>`;
            this._renderImageGrid();
        },

        updateUI(state, text = '') {
            if (!this.contentArea) return;
            if (state === 'error') {
                this.contentArea.innerHTML = `<div class="error-msg">${text}</div>`;
            } else if (state === 'loading') {
                this.contentArea.innerHTML = `<div class="loader visible">${text}</div>`;
            }
        },

        async _startGeneration(configOverrides = {}) {
            if (this.contentArea && this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length >= 5) { showError("Đã đạt giới hạn 5 tác vụ đồng thời."); return; }
            if (!this.state.isComfyUIAvaidable) { showError("ComfyUI chưa kết nối."); return; }
            let tempTaskId = `temp_${Date.now()}`;
            try {
                const grid = this.contentArea ? this.contentArea.querySelector('.plugin-album__grid') : null;
                if (grid) {
                    const placeholder = this._createPlaceholderCard(tempTaskId);
                    grid.prepend(placeholder);
                    const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                    if (emptyMsg) emptyMsg.style.display = 'none';
                }
                this._updateNav();

                const { last_config } = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
                const payload = { ...last_config, ...configOverrides, character: this.state.selectedCharacter.name };
                this._normalizeGenerationPayload(payload, configOverrides);

                try {
                    const explicitWorkflowType = String(configOverrides.workflow_type || configOverrides._workflow_type || '').trim().toLowerCase();
                    const explicitWorkflowTemplate = String(configOverrides.workflow_template || configOverrides._workflow_template || '').trim().toLowerCase();
                    const explicitInputImage = String(configOverrides._input_image_name || '').trim();
                    const explicitHires = (
                        configOverrides.hires_enabled === true ||
                        explicitWorkflowType.includes('hires') ||
                        explicitWorkflowTemplate.includes('hiresfix') ||
                        Boolean(explicitInputImage)
                    );

                    if (!explicitHires) {
                        const workflowType = String(payload.workflow_type || payload._workflow_type || '').trim().toLowerCase();
                        const workflowTemplate = String(payload.workflow_template || payload._workflow_template || '').trim().toLowerCase();
                        const staleHiresWorkflow = (
                            workflowType.includes('hires') ||
                            workflowTemplate.includes('hiresfix') ||
                            Boolean(payload._input_image_name)
                        );

                        if (staleHiresWorkflow) {
                            payload.hires_enabled = false;
                            try { delete payload.workflow_template; } catch { }
                            try { delete payload._workflow_template; } catch { }
                            try { delete payload._workflow_type; } catch { }
                            try { delete payload._input_image_name; } catch { }
                            try { delete payload._input_image_width; } catch { }
                            try { delete payload._input_image_height; } catch { }
                            if (typeof payload.workflow_type === 'string' && payload.workflow_type.trim().toLowerCase().includes('hires')) {
                                payload.workflow_type = 'standard';
                            }
                        }
                    }
                } catch { }

                // Album grid view must never request alpha/transparent output.
                // The backend's /comfyui/info merges the latest image's generationConfig.
                // If the latest image was generated in Character/VN mode, it may include Alpha=true
                // and/or workflow identifiers containing "alpha", which would incorrectly route
                // album generation into the alpha workflow/endpoint.
                try {
                    const stripAlphaHints = (obj) => {
                        if (!obj || typeof obj !== 'object') return;
                        // Common alpha flags
                        ['Alpha', 'alpha', 'is_alpha', 'isAlpha', 'use_alpha', 'useAlpha'].forEach((k) => {
                            try { delete obj[k]; } catch { }
                        });
                        // If stale workflow identifiers include "alpha", drop them.
                        try {
                            const wt = String(obj.workflow_type || obj._workflow_type || '').trim().toLowerCase();
                            if (wt && wt.includes('alpha')) {
                                obj.workflow_type = 'standard';
                                try { delete obj._workflow_type; } catch { }
                            }
                        } catch { }
                        try {
                            const wft = String(obj.workflow_template || obj._workflow_template || '').trim().toLowerCase();
                            if (wft && wft.includes('alpha')) {
                                try { delete obj.workflow_template; } catch { }
                                try { delete obj._workflow_template; } catch { }
                            }
                        } catch { }
                    };
                    stripAlphaHints(payload);
                } catch { }

                // Album grid view must never use the alpha generation API.
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

            } catch (err) {
                document.getElementById(tempTaskId)?.remove();
                showError(`Bắt đầu thất bại: ${err.message}`);
                this._updateNav();
            }
        },

        async _refreshAlbumAndPlaceholders() {
            if (!this.state.selectedCharacter) return;

            try {
                const [images, status] = await Promise.all([
                    this.api.images.getByCharacter(this.state.selectedCharacter.hash),
                    this.api.generation.getStatus()
                ]);

                this.state.allImageData = images;
                this.renderCharacterAlbumView(); // Render layout cơ bản

                const grid = this.contentArea ? this.contentArea.querySelector('.plugin-album__grid') : null;
                if (!grid) return;

                // Lọc các tác vụ đang chạy chỉ cho nhân vật hiện tại
                const runningTasksForChar = Object.values(status.tasks || {})
                    .filter(task => task.character_hash === this.state.selectedCharacter.hash);

                // Thêm lại các placeholder cho các tác vụ còn đang chạy
                if (runningTasksForChar.length > 0) {
                    const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                    if (emptyMsg) emptyMsg.style.display = 'none';

                    runningTasksForChar.forEach(task => {
                        const placeholder = this._createPlaceholderCard(task);
                        grid.prepend(placeholder); // Luôn thêm vào đầu
                        this._updatePlaceholderCardState(placeholder, task);
                    });
                }
            } catch (e) {
                console.error("[Album] Lỗi khi làm mới album và placeholders:", e);
                this.updateUI('error', `Lỗi đồng bộ: ${e.message}`);
            } finally {
                this._updateNav();
            }
        },

        _renderImageGrid() {
            if (!this.contentArea) return;
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
        },

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
        },

        _createImageCard(imgData) {
            const c = document.createElement('div');
            c.className = 'plugin-album__album-card plugin-album__image-card';
            c.dataset.id = imgData.id;

            const isVideo = !!(imgData.is_video || (imgData.pv_url || '').endsWith('.webm') || (imgData.pv_url || '').endsWith('.mp4'));

            if (isVideo) {
                c.classList.add('video-card');
                // Use the actual video URL (imgData.url) as <video> src, not pv_url which is a PNG placeholder.
                // pv_url is used as the poster fallback image.
                const videoSrc = imgData.url || imgData.pv_url;
                const posterSrc = imgData.pv_url || '';
                c.innerHTML = `
                    <video src="${videoSrc}#t=0.001" poster="${posterSrc}" loop muted playsinline preload="metadata" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;"></video>
                    <div class="video-indicator"><span class="material-symbols-outlined">play_circle</span></div>
                `;
                const vidEl = c.querySelector('video');

                c.addEventListener('mouseenter', () => {
                    vidEl.play().catch(() => { });
                });
                c.addEventListener('mouseleave', () => {
                    vidEl.pause();
                    vidEl.currentTime = 0.001;
                });

                vidEl.addEventListener('click', (e) => {
                    try { e.preventDefault(); e.stopPropagation(); } catch { }
                    this.renderImageViewer(imgData);
                });
            } else {
                c.innerHTML = `<img src="${imgData.pv_url}" alt="Art" loading="lazy">`;
                const imgEl = c.querySelector('img');
                if (imgEl) {
                    imgEl.addEventListener('click', (e) => {
                        try { e.preventDefault(); e.stopPropagation(); } catch { }
                        this.renderImageViewer(imgData);
                    });
                }
            }

            return c;
        },

        _createPlaceholderCard(taskOrId) {
            const taskId = normalizeTaskId(taskOrId);
            const placeholder = document.createElement('div');
            placeholder.className = 'plugin-album__album-card placeholder-card';
            placeholder.id = taskId;
            // Yuuka: global cancel v1.0
            placeholder.innerHTML = `
                <div class="plugin-album__placeholder-body">
                    <div class="plugin-album__progress-title">workflow</div>
                    <div class="plugin-album__progress-row">
                        <div class="plugin-album__progress-bar-container"><div class="plugin-album__progress-bar"></div></div>
                    </div>
                    <div class="plugin-album__progress-text">Preparing - ...</div>
                </div>
                <button class="plugin-album__cancel-btn" data-task-id="${taskId}"><span class="material-symbols-outlined">stop</span> Hủy</button>
            `;
            placeholder.querySelector('.plugin-album__cancel-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                // Yuuka: cancel task fix v1.0 - Đọc ID từ data attribute
                const currentTaskId = e.currentTarget.dataset.taskId;
                this.api.generation.cancel(currentTaskId).catch(err => showError(`Lỗi hủy: ${err.message}`));
            });
            if (taskOrId && typeof taskOrId === 'object') {
                this._updatePlaceholderCardState(placeholder, taskOrId);
            }
            return placeholder;
        },

        _updatePlaceholderCardState(placeholder, task = {}) {
            if (!placeholder) return;
            const progressBar = placeholder.querySelector('.plugin-album__progress-bar');
            const progressTitle = placeholder.querySelector('.plugin-album__progress-title');
            const progressText = placeholder.querySelector('.plugin-album__progress-text');
            const rawPercent = Number(task?.progress_percent ?? 0);
            const progressPercent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, rawPercent)) : 0;
            if (progressBar) {
                progressBar.style.width = `${progressPercent}%`;
            }
            if (progressTitle) {
                progressTitle.textContent = getTaskWorkflowLabel(task) || getPlaceholderTitle(task);
            }
            if (progressText) {
                progressText.textContent = getTaskNodeSummary(task);
            }
        },
    });
})();
