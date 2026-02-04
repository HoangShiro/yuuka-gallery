// Album plugin - View module: album view (image grid)
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

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
            this.contentArea.innerHTML = `<div class="plugin-album__grid image-grid"></div>`;
            this._renderImageGrid();
        },

        updateUI(state, text = '') {
            if (state === 'error') {
                this.contentArea.innerHTML = `<div class="error-msg">${text}</div>`;
            } else if (state === 'loading') {
                this.contentArea.innerHTML = `<div class="loader visible">${text}</div>`;
            }
        },

        async _startGeneration(configOverrides = {}) {
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
                this._normalizeGenerationPayload(payload, configOverrides);

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
            } catch (e) {
                console.error("[Album] Lỗi khi làm mới album và placeholders:", e);
                this.updateUI('error', `Lỗi đồng bộ: ${e.message}`);
            } finally {
                this._updateNav();
            }
        },

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
            c.innerHTML = `<img src="${imgData.pv_url}" alt="Art" loading="lazy">`;

            // Only open viewer when clicking exactly on the image.
            // (Users may click around the card shadow/padding; that should not open.)
            const imgEl = c.querySelector('img');
            if (imgEl) {
                imgEl.addEventListener('click', (e) => {
                    try { e.preventDefault(); e.stopPropagation(); } catch { }
                    this.renderImageViewer(imgData);
                });
            }
            return c;
        },

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
        },
    });
})();
