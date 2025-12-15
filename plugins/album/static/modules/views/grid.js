// Album plugin - View module: main grid page
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        // ------------------------------
        // Grid open-mode persistence
        // ------------------------------
        _getGridPreferredViewMode() {
            try {
                const raw = localStorage.getItem(this._LS_GRID_OPEN_MODE_KEY);
                const v = String(raw || '').trim().toLowerCase();
                return (v === 'character') ? 'character' : 'album';
            } catch {
                return 'album';
            }
        },

        _setGridPreferredViewMode(mode) {
            const v = (mode === 'character') ? 'character' : 'album';
            this.state.gridOpenMode = v;
            try {
                localStorage.setItem(this._LS_GRID_OPEN_MODE_KEY, v);
            } catch { }
        },

        _gridUpdateTaskOverlays(allTasksStatus) {
            // Update progress overlay on character cards in the selection grid.
            const runningTasksByHash = new Map();
            Object.values(allTasksStatus || {}).forEach(task => {
                if (!task) return;
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
                        card.querySelector('.image-container')?.appendChild(overlay);
                    }
                    overlay.querySelector('.plugin-album__progress-bar').style.width = `${status.progress_percent || 0}%`;
                    overlay.querySelector('.plugin-album__progress-text').textContent = status.progress_message;
                } else if (existingOverlay) {
                    card.classList.remove('is-generating');
                    existingOverlay.remove();
                }
            });
        },

        async showCharacterSelectionGrid() {
            this._characterTeardown();
            this.state.viewMode = 'grid';
            this._updateNav();
            this.state.selectedCharacter = null;
            this.state.cachedComfyGlobalChoices = null; // Yuuka: comfyui fetch optimization v1.0
            this.state.cachedComfySettings = null; // Yuuka: reset preloaded comfy settings
            this.updateUI('loading', 'Đang tải danh sách album...');
            this._syncDOMSelection();
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
        },

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
                const selected = { hash: album.hash, name: displayName, isCustom: !!album.is_custom };
                if (this.state.gridOpenMode === 'character') {
                    await this.openCharacterView(selected);
                } else {
                    await this.openAlbumView(selected);
                }
            });
            return card;
        },

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
        },

        _generateAlbumHash() {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return `album-custom-${window.crypto.randomUUID()}`;
            }
            const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            return `album-custom-${fallback}`;
        },

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
            this._syncDOMSelection();
            await this.loadAndDisplayCharacterAlbum();
            this._updateNav();
        },
    });
})();
