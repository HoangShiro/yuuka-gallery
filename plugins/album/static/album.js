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
        await this.checkComfyUIStatus();

        this.container.innerHTML = `<div class="plugin-album__content-area"></div>`;
        this.contentArea = this.container.querySelector('.plugin-album__content-area');

        // Yuuka: Lắng nghe các sự kiện toàn cục từ Lõi
        Yuuka.events.on('image:added', this.handleImageAdded);
        Yuuka.events.on('generation:task_ended', this.handleTaskEnded);
        Yuuka.events.on('generation:update', this.handleGenerationUpdate);
        Yuuka.events.on('image:deleted', this.handleImageDeleted); // Yuuka: event bus v1.0

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

    _updateNav() {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;
        let mainNavButtons = [], toolButtons = [];
        const corePlugin = this.activePlugins.find(p => p.id === 'core');
        const scenePlugin = this.activePlugins.find(p => p.id === 'scene');

        if (corePlugin?.ui?.tab) mainNavButtons.push({ id: 'browse-tab', group: 'main', icon: corePlugin.ui.tab.icon, title: corePlugin.ui.tab.label, onClick: () => Yuuka.ui.switchTab(corePlugin.ui.tab.id), isActive: () => false });
        if (scenePlugin?.ui?.tab) mainNavButtons.push({ id: 'scene-tab', group: 'main', icon: scenePlugin.ui.tab.icon, title: scenePlugin.ui.tab.label, onClick: () => Yuuka.ui.switchTab(scenePlugin.ui.tab.id) });
        
        if (this.state.viewMode === 'album') {
            const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
            const hasReachedLimit = tasksForThisChar >= 5;
            toolButtons = [
                { id: 'settings', group: 'tools', icon: 'tune', title: 'Cấu hình', onClick: () => this.openSettings() },
                { id: 'generate', group: 'tools', icon: 'auto_awesome', title: hasReachedLimit ? 'Đã đạt giới hạn' : 'Tạo ảnh mới', onClick: () => this._startGeneration(), disabled: () => hasReachedLimit || !this.state.isComfyUIAvaidable },
            ];
            mainNavButtons.push({ id: `album-back-btn`, group: 'main', icon: 'arrow_back', title: 'Quay lại Album chính', isActive: () => true, onClick: () => { this.state.viewMode = 'grid'; this.showCharacterSelectionGrid(); this._updateNav(); } });
        } 
        navibar.setButtons([...mainNavButtons, ...toolButtons]);
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
            const response = await this.api.generation.start(this.state.selectedCharacter.hash, payload);
            
            const tempPlaceholder = document.getElementById(tempTaskId);
            if (tempPlaceholder) {
                tempPlaceholder.id = response.task_id;
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

    updateUI(state, text='') { const f=this.container.querySelector('.plugin-album__footer');if(state==='error'){this.contentArea.innerHTML=`<div class="error-msg">${text}</div>`;if(f)f.style.display='none';}else if(state==='loading'){this.contentArea.innerHTML=`<div class="loader visible">${text}</div>`;if(f)f.style.display='none';}else{if(f){f.textContent=text;f.style.display=text?'block':'none';}}}
    
    async showCharacterSelectionGrid() {
        this.state.selectedCharacter = null;
        this.updateUI('loading', 'Đang tải danh sách album...');
        try {
            const hashesWithAlbums = await this.api.album.get('/characters_with_albums');
            if (!hashesWithAlbums || hashesWithAlbums.length === 0) {
                this.contentArea.innerHTML = `<p class="plugin-album__empty-msg">Chưa có album nào.</p>`;
                this.updateUI(); 
                this._updateNav();
                return;
            }
            const characters = await this.api.getCharactersByHashes(hashesWithAlbums);
            this.contentArea.innerHTML = `<div class="plugin-album__grid"></div>`;
            const grid = this.contentArea.querySelector('.plugin-album__grid');
            if (!grid) return;
            
            characters.sort((a, b) => a.name.localeCompare(b.name)).forEach(char => {
                const card = document.createElement('div');
                card.className = 'character-card';
                card.dataset.hash = char.hash;
                card.innerHTML = `<div class="image-container"><img src="/image/${char.hash}" alt="${char.name}"></div><div class="name">${char.name}</div>`;
                card.addEventListener('click', async () => {
                    this.state.selectedCharacter = char;
                    this.state.viewMode = 'album';
                    await this.loadAndDisplayCharacterAlbum();
                    this._updateNav();
                });
                grid.appendChild(card);
            });
            // Đồng bộ hóa overlay tiến độ ngay khi grid được tạo
            const currentStatus = await this.api.generation.getStatus();
            this.handleGenerationUpdate(currentStatus.tasks || {});
        } catch (e) {
            showError(`Lỗi tải album: ${e.message}`);
            this.updateUI('error', `Lỗi: ${e.message}`);
        }
    }
    
    renderCharacterAlbumView() { this.contentArea.innerHTML=`<div class="plugin-album__grid image-grid"></div><div class="plugin-album__footer"></div>`;this._renderImageGrid();}
    
    _renderImageGrid() {
        const grid = this.contentArea.querySelector('.plugin-album__grid');
        if (!grid) return;
        grid.innerHTML = '';
        this.updateUI('content', `Album: ${this.state.selectedCharacter.name}`);
        this.state.allImageData.forEach(imgData => grid.appendChild(this._createImageCard(imgData)));
        if (this.state.allImageData.length === 0 && grid.children.length === 0) {
             grid.innerHTML = `<p class="plugin-album__empty-msg">Album này chưa có ảnh.</p>`;
        }
    }
    
    _createImageCard(imgData) { const c=document.createElement('div');c.className='plugin-album__album-card plugin-album__image-card';c.dataset.id=imgData.id;c.innerHTML=`<img src="${imgData.url}" alt="Art" loading="lazy">`;c.addEventListener('click',()=>this.renderImageViewer(imgData));return c;}

    _createPlaceholderCard(taskId) {
        const placeholder = document.createElement('div');
        placeholder.className = 'plugin-album__album-card placeholder-card';
        placeholder.id = taskId;
        placeholder.innerHTML = `<div class="plugin-album__progress-bar-container"><div class="plugin-album__progress-bar"></div></div><div class="plugin-album__progress-text">Đang khởi tạo...</div>`;
        return placeholder;
    }
    
    renderImageViewer(imgData) {
        const i = this.state.allImageData.findIndex(img => img.id === imgData.id);
        const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
        this.viewer.open({
            items: this.state.allImageData.map(d => ({ ...d, imageUrl: d.url })),
            startIndex: i,
            renderInfoPanel: (item) => {const c=item.generationConfig;if(!c)return"Không có thông tin.";const r=(l,v)=>{if(!v||(typeof v==='string'&&v.trim()===''))return'';const s=document.createElement('span');s.textContent=v;return`<div class="info-row"><strong>${l}:</strong> <span>${s.innerHTML}</span></div>`;};const d=new Date(item.createdAt*1000).toLocaleString('vi-VN');const m=['character','outfits','expression','action','context','quality','negative'].map(k=>r(k.charAt(0).toUpperCase()+k.slice(1),c[k])).filter(Boolean).join('');const t=`<div class="info-grid">${r('Model',c.ckpt_name?.split('.')[0])}${r('Sampler',`${c.sampler_name} (${c.scheduler})`)}${r('Cỡ ảnh',`${c.width}x${c.height}`)}${r('Steps',c.steps)}${r('CFG',c.cfg)}${r('LoRA',c.lora_name)}</div>`;return`${m}${m?'<hr>':''}${t}<hr>${r('Ngày tạo',d)}`.trim();},
            actionButtons: [
                { id: 'regen', icon: 'auto_awesome', title: 'Tạo lại', disabled: () => tasksForThisChar >= 5 || !this.state.isComfyUIAvaidable, onClick: (item, close) => { close(); this._startGeneration(item.generationConfig); } },
                { id: 'copy', icon: 'content_copy', title: 'Copy Prompt', onClick: (item) => { const c = item.generationConfig, k = ['outfits', 'expression', 'action', 'context', 'quality', 'negative']; this.state.promptClipboard = new Map(k.map(key => [key, c[key] ? String(c[key]).trim() : ''])); showError("Prompt đã copy."); } },
                { id: 'delete', icon: 'delete', title: 'Xóa',
                    onClick: async (item, close, updateItems) => {
                        if (await Yuuka.ui.confirm('Bạn có chắc muốn xoá ảnh này?')) {
                            try {
                                await api.images.delete(item.id);
                                // Yuuka: ui-event-fix v1.0 - Phát sự kiện toàn cục
                                Yuuka.events.emit('image:deleted', { imageId: item.id });
                                
                                // Cập nhật ngay lập tức cho viewer đang mở
                                const updatedItems = this.state.allImageData
                                    .filter(img => img.id !== item.id)
                                    .map(d => ({ ...d, imageUrl: d.url }));
                                updateItems(updatedItems);

                            } catch (err) { showError(`Lỗi xoá: ${err.message}`); }
                        }
                    }
                }
            ]
        });
    }

    async openSettings() {
        if (!this.state.isComfyUIAvaidable) { showError("ComfyUI chưa kết nối."); return; }
        await Yuuka.ui.openSettingsModal({
            title: `Cấu hình cho ${this.state.selectedCharacter.name}`,
            fetchInfo: async () => {
                const info = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
                if (info.last_config && this.state.selectedCharacter) info.last_config.character = this.state.selectedCharacter.name;
                return info;
            },
            onSave: (updatedConfig) => this.api.album.post(`/${this.state.selectedCharacter.hash}/config`, updatedConfig),
            promptClipboard: this.state.promptClipboard
        });
    }
}

window.Yuuka.components['AlbumComponent'] = AlbumComponent;