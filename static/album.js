// --- MODIFIED FILE: static/album.js ---
class AlbumManager {
    constructor() {
        this.container = document.getElementById('album-container');
        this.apiKey = localStorage.getItem('yuuka-api-key') || '';
        this.selectedCharacter = null;
        this.accessibleChannels = [];
        this.globalChoices = null;
        this.viewStack = []; // History for back button
        this.currentServerId = 'all'; // Default to all
        this.currentChannelId = 'all'; // Default to all
        this.albumSelectorsContainer = document.getElementById('album-selectors-container');
        this.allImageData = []; // Cache for all images of a character
        this.promptClipboard = null; // NEW: In-app clipboard for prompts
        this.tagPredictions = []; // Yuuka: Biến mới để lưu các tag gợi ý
    }

    // --- Core Methods ---
    async init(character) {
        this.selectedCharacter = character;
        this.viewStack = []; // Reset history for a new character
        this.container.innerHTML = `<div class="loader visible">Đang khởi tạo album...</div>`;
        this.container.style.display = 'block';

        if (!this.apiKey) {
            this.renderApiKeyForm();
            return;
        }

        try {
            this.updateUI('loading', 'Đang kiểm tra kết nối API...');
            const { mode, message, data } = await api.initializeApiMode(this.apiKey);
            
            if (mode === 'comfyui') {
                showError(message);
            }
            
            // Yuuka: Tải danh sách tag một lần
            if (this.tagPredictions.length === 0) {
                try {
                    this.tagPredictions = await api.getTags();
                    console.log(`Loaded ${this.tagPredictions.length} tags for autocomplete.`);
                } catch (e) {
                    console.warn("Could not load tag predictions, feature will be disabled.");
                    this.tagPredictions = []; // Đảm bảo nó là một mảng trống
                }
            }

            await this.loadAndDisplayCharacterAlbum(data);

        } catch (error) {
            this.updateUI('error', `Lỗi kết nối: ${error.message}`);
            showError(`Lỗi kết nối nghiêm trọng: ${error.message}`);
        }
    }
    
    // --- API Interaction ---
    _handleApiError(error) {
        console.error("API Error:", error);
        if (error.status === 401) {
            this.apiKey = '';
            localStorage.removeItem('yuuka-api-key');
            this.renderApiKeyForm('API Key không hợp lệ hoặc đã hết hạn. Vui lòng nhập lại.');
        }
        throw error;
    }

    async loadAndDisplayCharacterAlbum(initialApiData) {
        try {
            this.updateUI('loading', 'Đang tải thông tin cấu hình...');
            this.accessibleChannels = initialApiData.accessible_channels;
            this.globalChoices = initialApiData.global_choices;
            
            this.updateUI('loading', `Đang tải album của ${this.selectedCharacter.name}...`);
            this.allImageData = await api.getCharacterAlbum(this.apiKey, this.selectedCharacter.hash).catch(this._handleApiError.bind(this));

            this.renderCharacterAlbumView();
        } catch (error) {
            this.updateUI('error', `Lỗi tải dữ liệu album: ${error.message}`);
            showError(`Lỗi tải dữ liệu album: ${error.message}`);
        }
    }
    
    async _generateArt(channel, configOverrides = {}) {
        const placeholderId = `placeholder-${Date.now()}`;
        const placeholder = document.createElement('div');
        placeholder.className = 'album-card placeholder-card';
        placeholder.id = placeholderId;
        
        const grid = this.container.querySelector('.album-grid');
        grid.prepend(placeholder);
        
        const emptyMsg = grid.querySelector('.empty-msg');
        if (emptyMsg) emptyMsg.style.display = 'none';

        try {
            // Yuuka: Lấy config theo đúng thứ tự ưu tiên
            const apiMode = api.getCurrentApiMode();
            const contextData = apiMode === 'bot' 
                ? { channelId: channel.id } 
                : { characterHash: this.selectedCharacter.hash };
            const { last_config } = await api.getBotInfo(this.apiKey, contextData).catch(this._handleApiError.bind(this));
            
            const payload = { 
                channel_id: channel.id,
                ...last_config,
                ...configOverrides,
                character: this.selectedCharacter.name,
                text_prompt: this.selectedCharacter.name,
            };

            const result = await api.generateArt(this.apiKey, payload).catch(this._handleApiError.bind(this));

            if (result.status === 'success' && result.images_base64 && result.images_base64.length > 0) {
                const newImageData = await api.addImageToAlbum(this.apiKey, this.selectedCharacter.hash, {
                    image_base64: result.images_base64[0],
                    generation_config: result.generation_config,
                    server_id: channel.serverId 
                }).catch(this._handleApiError.bind(this));
                
                this.allImageData.unshift(newImageData);
                const newCard = this._createImageCard(newImageData);
                placeholder.replaceWith(newCard);
                this.updateResultCounter();
            } else {
                throw new Error(result.error_message || 'Không nhận được ảnh từ server.');
            }
        } catch (error) {
            console.error("Art generation failed:", error);
            showError(`Tạo ảnh thất bại: ${error.message}`);
            placeholder.remove();
            if (grid.children.length === 0) this.updateResultCounter();
        }
    }
    
    // --- UI Management ---
    updateUI(state, text = '') {
        const backBtn = document.getElementById('back-btn');
        const contextFooter = document.getElementById('context-footer');
        
        backBtn.style.display = this.viewStack.length > 1 ? 'block' : 'none';

        if (state === 'error') {
            this.container.innerHTML = `<div class="error-msg">${text}</div>`;
            contextFooter.style.display = 'none';
        } else if (state === 'loading') {
            this.container.innerHTML = `<div class="loader visible">${text}</div>`;
            contextFooter.style.display = 'none';
        } else {
            contextFooter.textContent = text;
            contextFooter.style.display = text ? 'block' : 'none';
        }
    }
    
    goBack() {
        if (this.viewStack.length <= 1) {
            this.showCharacterSelectionGrid();
            return;
        }
        
        this.viewStack.pop(); 
        const previousView = this.viewStack[this.viewStack.length - 1];
        previousView.func(...previousView.args);
    }
    
    _pushView(func, ...args) {
        this.viewStack.push({ func: func.bind(this), args: args });
        this.updateUI('content');
    }

    _getLastUsedChannel() {
        try {
            const saved = localStorage.getItem('yuuka-album-last-channel');
            return saved ? JSON.parse(saved) : { serverId: 'all', channelId: 'all' };
        } catch (e) { return { serverId: 'all', channelId: 'all' }; }
    }

    _saveLastUsedChannel() {
        const data = { serverId: this.currentServerId, channelId: this.currentChannelId };
        localStorage.setItem('yuuka-album-last-channel', JSON.stringify(data));
    }

    _makeContentScrollable(element) {
        let isDown = false;
        let lastY;
        let velocityY = 0;
        let momentumID;
        const DAMPING = 0.95;

        function beginMomentumTracking() {
            cancelAnimationFrame(momentumID);
            momentumID = requestAnimationFrame(momentumLoop);
        }
        
        function momentumLoop() {
            element.scrollTop -= velocityY;
            velocityY *= DAMPING; 

            if (Math.abs(velocityY) > 0.5) {
                momentumID = requestAnimationFrame(momentumLoop);
            }
        }

        const handleMouseDown = (e) => {
            const interactiveTags = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION', 'A'];
            if (e.button !== 0 || interactiveTags.includes(e.target.tagName) || e.target.closest('button, a, input, select, textarea') || element.scrollHeight <= element.clientHeight) {
                return;
            }
            e.stopPropagation();
            e.preventDefault();

            isDown = true;
            element.classList.add('is-dragging');
            lastY = e.pageY;
            velocityY = 0;
            cancelAnimationFrame(momentumID);

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        };

        const handleMouseMove = (e) => {
            if (!isDown) return;
            e.preventDefault();
            
            const y = e.pageY;
            const deltaY = y - lastY;
            
            element.scrollTop -= deltaY;

            velocityY = deltaY;
            lastY = y;
        };

        const handleMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            element.classList.remove('is-dragging');
            
            beginMomentumTracking();

            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        element.addEventListener('mousedown', handleMouseDown);
    }


    // --- Rendering ---
    renderApiKeyForm(message = '') {
        this.viewStack = []; 
        this.updateUI('content');
        this.container.innerHTML = `
            <div class="api-key-form">
                <h3>Kết nối tới Album</h3>
                <p>Vui lòng nhập API Key của bạn để truy cập album. API Key sẽ được lưu trên trình duyệt này.</p>
                ${message ? `<p class="error-msg">${message}</p>` : ''}
                <form id="api-key-submit-form">
                    <input type="text" id="api-key-input" placeholder="Nhập API Key tại đây" required>
                    <button type="submit">Lưu và Tiếp tục</button>
                </form>
            </div>
        `;
        document.getElementById('api-key-submit-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.apiKey = document.getElementById('api-key-input').value.trim();
            if (this.apiKey) {
                localStorage.setItem('yuuka-api-key', this.apiKey);
                this.showCharacterSelectionGrid();
            }
        });
    }

    async showCharacterSelectionGrid() {
        this.viewStack = [];
        this._pushView(this.showCharacterSelectionGrid);
        this.selectedCharacter = null;
        this.albumSelectorsContainer.style.display = 'none';
        this.albumSelectorsContainer.innerHTML = '';

        if (!this.apiKey) {
            this.renderApiKeyForm();
            return;
        }

        this.updateUI('loading', 'Đang tải danh sách album...');
        try {
            const charHashes = await api.getAlbumCharacters(this.apiKey).catch(this._handleApiError.bind(this));
            const characters = await api.getCharactersByHashes(charHashes).catch(this._handleApiError.bind(this));
            
            this.container.innerHTML = `<div class="album-grid"></div>`;
            const grid = this.container.querySelector('.album-grid');

            if (!characters || characters.length === 0) {
                grid.innerHTML = `<p class="empty-msg">Chưa có album nào. Mở một nhân vật từ các tab khác và nhấn 🖼️ để bắt đầu.</p>`;
                this.updateUI('content', 'Chọn nhân vật để xem album');
                return;
            }
            
            characters.sort((a,b) => a.name.localeCompare(b.name)).forEach(char => {
                const card = document.createElement('div');
                card.className = 'character-card';
                card.innerHTML = `
                    <div class="image-container"><img src="/image/${char.hash}" alt="${char.name}"></div>
                    <div class="name">${char.name}</div>
                `;
                card.addEventListener('click', () => this.init(char) );
                grid.appendChild(card);
            });
            this.updateUI('content', `Bạn có ${characters.length} album. Chọn một nhân vật để xem.`);

        } catch (error) {
            showError(`Lỗi tải album: ${error.message}`);
            this.updateUI('error', `Lỗi tải album: ${error.message}`);
        }
    }
    
    renderCharacterAlbumView() {
        this._pushView(this.renderCharacterAlbumView);
        const apiMode = api.getCurrentApiMode();
        this.albumSelectorsContainer.style.display = apiMode === 'bot' ? 'flex' : 'none';

        this.container.innerHTML = `
            <div class="album-grid image-grid"></div>
            <div class="album-result-counter"></div>
            <div class="fab-container">
                <button class="fab" id="fab-settings" title="Channel Config">⚙️</button>
                <button class="fab" id="fab-add" title="Generate New Art">➕</button>
            </div>
        `;

        let lastUsed = this._getLastUsedChannel();
        this.currentServerId = lastUsed.serverId;
        this.currentChannelId = lastUsed.channelId;

        document.getElementById('fab-add').addEventListener('click', () => {
            const currentMode = api.getCurrentApiMode();
            if (currentMode === 'comfyui') {
                const dummyChannel = { id: 'all', name: 'All', serverId: 'comfyui_direct' };
                this._generateArt(dummyChannel);
            } else if (this.currentChannelId === 'all') {
                this._handleSmartAdd();
            } else {
                const server = this._getServersData().find(s => s.id === this.currentServerId);
                const channel = server.channels.find(c => c.id === this.currentChannelId);
                this._generateArt(channel);
            }
        });

        document.getElementById('fab-settings').addEventListener('click', () => {
            if (apiMode === 'bot' && this.currentChannelId === 'all') {
                showError("Vui lòng chọn một channel cụ thể để chỉnh sửa cấu hình.");
                return;
            }
            this.renderSettingsModal();
        });
    
        this._renderSelectors();
        this._renderImageGrid();
    }
    
    async _handleSmartAdd() {
        const fabAdd = document.getElementById('fab-add');
        fabAdd.disabled = true;
        showError(`Đang tìm channel cho ${this.selectedCharacter.name}...`);

        try {
            const server = this._getServersData().find(s => s.id === this.currentServerId);
            if (!server) throw new Error("Server không hợp lệ.");

            const targetChannelName = this.selectedCharacter.name
                .toLowerCase()
                .replace(/\(.*\)/g, '')
                .trim()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');

            let channel = server.channels.find(c => c.name === targetChannelName);
            
            if (channel) {
                showError(`Đã tìm thấy channel #${channel.name}. Bắt đầu tạo ảnh...`);
                this.currentChannelId = channel.id;
                this._saveLastUsedChannel();
                this._renderSelectors();
                await this._renderImageGrid();
                this._generateArt(channel);
            } else {
                showError(`Đang tạo channel mới #${targetChannelName}...`);
                const newChannelData = await api.createChannel(this.apiKey, this.currentServerId, { 
                    name: targetChannelName, nsfw: true 
                }).catch(this._handleApiError.bind(this));

                showError('Tải lại danh sách channel...');
                const newData = await api.getBotInfo(this.apiKey).catch(this._handleApiError.bind(this));
                this.accessibleChannels = newData.accessible_channels;
                this.globalChoices = newData.global_choices;
                
                this.currentChannelId = newChannelData.channel_id;
                this._saveLastUsedChannel();
                this._renderSelectors();
                await this._renderImageGrid();
                
                const newChannel = {
                    id: newChannelData.channel_id,
                    name: newChannelData.channel_name,
                    serverId: this.currentServerId
                };
                this._generateArt(newChannel);
            }
        } catch (error) {
            showError(`Thao tác thất bại: ${error.message}`);
            console.error("Smart Add failed:", error);
        } finally {
            fabAdd.disabled = false;
        }
    }

    _getServersData() {
        return Object.values(this.accessibleChannels.reduce((acc, channel) => {
            if (!acc[channel.server_id]) {
                acc[channel.server_id] = { id: channel.server_id, name: channel.server_name, channels: [] };
            }
            acc[channel.server_id].channels.push({id: channel.channel_id, name: channel.channel_name, serverId: channel.server_id});
            return acc;
        }, {}));
    }

    _renderSelectors() {
        const apiMode = api.getCurrentApiMode();
        if (apiMode === 'comfyui') {
            this.albumSelectorsContainer.innerHTML = '';
            this.currentServerId = 'comfyui_direct';
            this.currentChannelId = 'all';
            return;
        }

        const servers = this._getServersData();
        if (servers.length === 0) return;

        const serverOptions = [{id: 'all', name: 'All Servers'}, ...servers];
        const serverSelector = this._createAlbumSelector('server', serverOptions, this.currentServerId);
        
        let channelOptions = [{id: 'all', name: 'All Channels'}];
        if (this.currentServerId !== 'all') {
            const activeServer = servers.find(s => s.id === this.currentServerId);
            if(activeServer) {
                channelOptions.push(...activeServer.channels);
            } else {
                this.currentServerId = 'all';
                this.currentChannelId = 'all';
                this._saveLastUsedChannel();
            }
        }
        const channelSelector = this._createAlbumSelector('channel', channelOptions, this.currentChannelId);

        this.albumSelectorsContainer.innerHTML = serverSelector + channelSelector;
        this._attachSelectorListeners();
    }

    _createAlbumSelector(id, items, selectedId) {
        const selectedItem = items.find(item => item.id === selectedId) || items[0];
        const triggerText = id === 'channel' && selectedItem.id !== 'all' ? `#${selectedItem.name}` : selectedItem.name;
        
        const optionsHtml = items.map(item => 
            `<div class="custom-select-option" data-value="${item.id}">${item.id !== 'all' && id === 'channel' ? '#' : ''}${item.name}</div>`
        ).join('');

        return `
            <div class="custom-select-container album-selector" id="${id}-selector">
                <button class="custom-select-trigger" id="${id}-selector-trigger">${triggerText}</button>
                <div class="custom-select-options">${optionsHtml}</div>
            </div>
        `;
    }

    _attachSelectorListeners() {
        this.albumSelectorsContainer.querySelectorAll('.album-selector').forEach(container => {
            const trigger = container.querySelector('.custom-select-trigger');
            const options = container.querySelector('.custom-select-options');
            
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                this.albumSelectorsContainer.querySelectorAll('.custom-select-container').forEach(other => {
                    if (other !== container) other.classList.remove('open');
                });
                container.classList.toggle('open');
            });
            
            options.addEventListener('click', (e) => {
                if (e.target.matches('.custom-select-option')) {
                    const value = e.target.dataset.value;
                    const id = container.id.split('-')[0];
                    
                    if (id === 'server') {
                        this.currentServerId = value;
                        this.currentChannelId = 'all'; 
                    } else if (id === 'channel') {
                        this.currentChannelId = value;
                    }
                    
                    this._saveLastUsedChannel();
                    this._renderSelectors(); 
                    this._renderImageGrid(); 
                    container.classList.remove('open');
                }
            });
        });
    }

    _getFilteredImages() {
        const apiMode = api.getCurrentApiMode();

        if (apiMode === 'comfyui') {
            return this.allImageData;
        }
        
        let filteredImages = this.allImageData;
        if (this.currentServerId !== 'all') {
            filteredImages = filteredImages.filter(img => img.serverId === this.currentServerId);
        }
        if (this.currentChannelId !== 'all') {
            filteredImages = filteredImages.filter(img => img.generationConfig.channel_id === this.currentChannelId);
        }
        return filteredImages;
    }

    async _renderImageGrid() {
        const grid = this.container.querySelector('.album-grid');
        if (!grid) return;
        grid.innerHTML = '';
        this.updateUI('content', `Album: ${this.selectedCharacter.name}`);
        
        const filteredImages = this._getFilteredImages();
        const apiMode = api.getCurrentApiMode();
    
        if (filteredImages.length === 0) {
            grid.innerHTML = `<p class="empty-msg">Không có ảnh nào khớp với lựa chọn.</p>`;
        } else {
            const shouldGroup = (apiMode === 'comfyui') || 
                                (apiMode === 'bot' && (this.currentServerId === 'all' || this.currentChannelId === 'all'));
    
            if (shouldGroup) {
                // Build a lookup map for channel details in bot mode
                const channelDetailsMap = new Map();
                if (apiMode === 'bot') {
                    this.accessibleChannels.forEach(c => {
                        channelDetailsMap.set(c.channel_id, { 
                            serverName: c.server_name, 
                            channelName: c.channel_name 
                        });
                    });
                }
    
                // Group images by channel ID
                const groupedByChannel = filteredImages.reduce((acc, img) => {
                    const channelId = img.generationConfig.channel_id || 'unknown';
                    if (!acc[channelId]) {
                        acc[channelId] = {
                            images: [],
                            details: apiMode === 'bot' 
                                ? (channelDetailsMap.get(channelId) || { serverName: 'Unknown Server', channelName: 'unknown' })
                                : null
                        };
                    }
                    acc[channelId].images.push(img);
                    return acc;
                }, {});
    
                // Sort channel groups
                const sortedChannelKeys = Object.keys(groupedByChannel).sort((a, b) => {
                    if (apiMode === 'bot') {
                        const detailsA = groupedByChannel[a].details;
                        const detailsB = groupedByChannel[b].details;
                        const serverCompare = detailsA.serverName.localeCompare(detailsB.serverName);
                        if (serverCompare !== 0) return serverCompare;
                        return detailsA.channelName.localeCompare(detailsB.channelName);
                    }
                    return a.localeCompare(b); // Simple sort for comfyui
                });
    
                // Render groups and dividers
                sortedChannelKeys.forEach((channelId, index) => {
                    const group = groupedByChannel[channelId];
                    group.images.forEach(imgData => grid.appendChild(this._createImageCard(imgData)));
                    
                    if (index < sortedChannelKeys.length - 1) {
                        const divider = document.createElement('div');
                        divider.className = 'album-divider';
                        if (apiMode === 'bot') {
                            const details = group.details;
                            divider.innerHTML = `<span>${details.serverName} - #${details.channelName}</span>`;
                        }
                        grid.appendChild(divider);
                    }
                });
            } else {
                // Render without grouping
                filteredImages.forEach(imgData => grid.appendChild(this._createImageCard(imgData)));
            }
        }
    
        this.updateResultCounter(filteredImages.length);
    
        const fabContainer = this.container.querySelector('.fab-container');
        if (apiMode === 'comfyui' || (apiMode === 'bot' && this.currentServerId !== 'all')) {
            fabContainer.style.display = 'flex';
        } else {
            fabContainer.style.display = 'none';
        }
    }
    
    _createImageCard(imgData) {
        const card = document.createElement('div');
        card.className = 'album-card image-card';
        card.innerHTML = `<img src="${imgData.url}" alt="Art" loading="lazy">`;
        card.addEventListener('click', () => {
            const currentImageList = this._getFilteredImages();
            this.renderImageViewer(imgData, currentImageList);
        });
        return card;
    }
    
    updateResultCounter(count) {
        const counter = this.container.querySelector('.album-result-counter');
        if (!counter) return;
        if(count > 0) {
            counter.textContent = `Đã hiển thị ${count} kết quả.`;
        } else {
            counter.textContent = '';
        }
    }

    renderImageViewer(imgData, currentImageList) {
        const viewer = document.createElement('div');
        viewer.className = 'image-viewer';
        viewer.innerHTML = `
            <div class="viewer-content">
                <span class="viewer-close">&times;</span>
                <div class="viewer-nav prev" title="Previous image">‹</div>
                <div class="viewer-image-wrapper">
                     <div class="viewer-image-slider"></div>
                </div>
                <div class="viewer-nav next" title="Next image">›</div>
                <div class="viewer-actions">
                    <button data-action="regen" title="Generate with same settings">➕</button>
                    <button data-action="info" title="Toggle Info">ℹ️</button>
                    <button data-action="copy" title="Copy Prompts">📋</button>
                    <button data-action="delete" title="Delete from Album">➖</button>
                </div>
                <div class="viewer-info"></div>
            </div>
        `;
        document.body.appendChild(viewer);

        let currentIndex = currentImageList.findIndex(img => img.id === imgData.id);
        const viewerContent = viewer.querySelector('.viewer-content');
        const slider = viewer.querySelector('.viewer-image-slider');
        const infoPanel = viewer.querySelector('.viewer-info');
        const navPrev = viewer.querySelector('.viewer-nav.prev');
        const navNext = viewer.querySelector('.viewer-nav.next');
        let navHideTimeout;

        this._makeContentScrollable(infoPanel);

        const updateViewerContent = (index) => {
            const newImgData = currentImageList[index];
            currentIndex = index;

            const oldActiveImages = slider.querySelectorAll('img.active');
            const newImgElement = document.createElement('img');
            newImgElement.src = newImgData.url;
            slider.appendChild(newImgElement);
            newImgElement.addEventListener('transitionend', (e) => {
                if (e.propertyName !== 'opacity') return;
                oldActiveImages.forEach(oldImg => {
                    oldImg.addEventListener('transitionend', (e2) => {
                        if (e2.propertyName === 'opacity') {
                            oldImg.remove();
                        }
                    }, { once: true });
                    oldImg.classList.remove('active');
                });
            }, { once: true });
            setTimeout(() => {
                newImgElement.classList.add('active');
            }, 10);

            this.initZoomAndPan(newImgElement);

            const createDetailRow = (label, value) => {
                if (!value || (typeof value === 'string' && value.trim() === '')) return '';
                const span = document.createElement('span');
                span.textContent = value;
                return `<div class="info-row"><strong>${label}:</strong> <span>${span.innerHTML}</span></div>`;
            };

            const config = newImgData.generationConfig;
            const creationDate = new Date(newImgData.createdAt * 1000).toLocaleString('vi-VN');
            
            const mainInfo = [
                createDetailRow('Nhân vật', config.character),
                createDetailRow('Trang phục', config.outfits),
                createDetailRow('Biểu cảm', config.expression),
                createDetailRow('Hành động', config.action),
                createDetailRow('Bối cảnh', config.context),
                createDetailRow('Chất lượng', config.quality),
                createDetailRow('Negative', config.negative)
            ].filter(Boolean).join('');

            const techInfo = `
                <div class="info-grid">
                    ${createDetailRow('Model', config.ckpt_name.split('.')[0])}
                    ${createDetailRow('Sampler', `${config.sampler_name} (${config.scheduler})`)}
                    ${createDetailRow('Cỡ ảnh', `${config.width}x${config.height}`)}
                    ${createDetailRow('Steps', config.steps)}
                    ${createDetailRow('CFG', config.cfg)}
                    ${createDetailRow('LoRA', config.lora_name)}
                </div>
            `;
            
            infoPanel.innerHTML = `
                ${mainInfo}
                ${mainInfo ? '<hr>' : ''}
                ${techInfo}
                <hr>
                ${createDetailRow('Ngày tạo', creationDate)}
            `.trim();

            infoPanel.classList.remove('visible');
        };
        
        const showNext = () => updateViewerContent((currentIndex + 1) % currentImageList.length);
        const showPrev = () => updateViewerContent((currentIndex - 1 + currentImageList.length) % currentImageList.length);
        
        const resetNavTimeout = () => {
            clearTimeout(navHideTimeout);
            viewerContent.classList.remove('nav-hidden');
            navHideTimeout = setTimeout(() => {
                viewerContent.classList.add('nav-hidden');
            }, 2500);
        };

        const keydownHandler = (e) => {
            if (e.key === 'ArrowRight') showNext();
            if (e.key === 'ArrowLeft') showPrev();
            if (e.key === 'Escape') close();
        };
        
        let isDragging = false;
        let startPos = { x: 0, y: 0 };
        const dragThreshold = 10;

        const handleInteractionStart = (e) => {
            isDragging = false;
            const point = e.touches ? e.touches[0] : e;
            startPos = { x: point.clientX, y: point.clientY };
        };

        const handleInteractionMove = (e) => {
            if (isDragging) return;
            const point = e.touches ? e.touches[0] : e;
            const diffX = Math.abs(point.clientX - startPos.x);
            const diffY = Math.abs(point.clientY - startPos.y);
            if (diffX > dragThreshold || diffY > dragThreshold) {
                isDragging = true;
            }
        };

        const handleInteractionEnd = (e) => {
            if (isDragging) return;

            if (e.target.closest('.viewer-actions, .viewer-nav, .viewer-close, .viewer-info')) {
                return;
            }
            
            const rect = viewer.getBoundingClientRect();
            const endPoint = e.changedTouches ? e.changedTouches[0] : e;
            
            if (endPoint.clientX > rect.width * 0.5) {
                showNext();
            } else {
                showPrev();
            }
        };

        const close = () => {
            viewer.remove();
            document.removeEventListener('keydown', keydownHandler);
        };

        updateViewerContent(currentIndex);
        if (currentImageList.length <= 1) {
            navPrev.style.display = 'none';
            navNext.style.display = 'none';
        } else {
            navPrev.addEventListener('click', showPrev);
            navNext.addEventListener('click', showNext);
            viewerContent.addEventListener('mousemove', resetNavTimeout);
            
            viewerContent.addEventListener('mousedown', handleInteractionStart);
            viewerContent.addEventListener('mousemove', handleInteractionMove);
            viewerContent.addEventListener('mouseup', handleInteractionEnd);
            viewerContent.addEventListener('touchstart', handleInteractionStart, { passive: true });
            viewerContent.addEventListener('touchmove', handleInteractionMove, { passive: true });
            viewerContent.addEventListener('touchend', handleInteractionEnd);
        }
        
        resetNavTimeout();

        viewer.querySelector('.viewer-close').addEventListener('click', close);
        document.addEventListener('keydown', keydownHandler);

        viewer.querySelector('.viewer-actions').addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            const action = button?.dataset.action;
            if (!action) return;
            const currentImgData = currentImageList[currentIndex];

            if (action === 'info') {
                viewer.querySelector('.viewer-info').classList.toggle('visible');
            } else if (action === 'copy') {
                const config = currentImgData.generationConfig;
                const promptKeys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
                const promptDataForClipboard = [];
                const promptMapForInternal = new Map();

                promptKeys.forEach(key => {
                    const value = config[key] ? String(config[key]).trim() : '';
                    promptMapForInternal.set(key, value);
                    if (value) {
                        promptDataForClipboard.push(`${key}: ${value}`);
                    }
                });
                
                this.promptClipboard = promptMapForInternal;
                showError("Prompt đã được copy vào bộ nhớ tạm.");
                
                if (promptDataForClipboard.length > 0) {
                    const clipboardText = promptDataForClipboard.join('\n');
                    navigator.clipboard.writeText(clipboardText).catch(err => {
                        console.warn("Could not copy to system clipboard: ", err);
                    });
                }

                const originalContent = button.innerHTML;
                button.innerHTML = '✔️';
                button.style.pointerEvents = 'none';
                setTimeout(() => {
                    button.innerHTML = originalContent;
                    button.style.pointerEvents = 'auto';
                }, 1500);

            } else if (action === 'delete') {
                if (confirm('Bạn có chắc muốn xoá ảnh này khỏi album (xoá vĩnh viễn trên server)?')) {
                    try {
                        await api.deleteImageFromAlbum(this.apiKey, currentImgData.id).catch(this._handleApiError.bind(this));
                        this.allImageData = this.allImageData.filter(img => img.id !== currentImgData.id);
                        
                        const deletedId = currentImgData.id;
                        currentImageList = currentImageList.filter(img => img.id !== deletedId);
                        
                        if (currentImageList.length === 0) {
                            close();
                        } else {
                            const newIndex = Math.min(currentIndex, currentImageList.length - 1);
                            updateViewerContent(newIndex);
                        }
                        this._renderImageGrid();
                    } catch (err) {
                        showError(`Lỗi xoá ảnh: ${err.message}`);
                    }
                }
            } else if (action === 'regen') {
                const apiMode = api.getCurrentApiMode();
                let channel;
                if (apiMode === 'comfyui') {
                    channel = { id: 'all', name: 'All', serverId: 'comfyui_direct' };
                } else {
                    const server = this._getServersData().find(s => s.id === this.currentServerId);
                    channel = server.channels.find(c => c.id === this.currentChannelId);
                }
                close();
                await this._generateArt(channel, currentImgData.generationConfig);
            }
        });
    }
    
    _initTagAutocomplete(formContainer) {
        if (!this.tagPredictions || this.tagPredictions.length === 0) {
            return;
        }

        const inputs = formContainer.querySelectorAll('textarea, input[type="text"]');
        
        inputs.forEach(input => {
            const parent = input.parentElement;
            if (parent.classList.contains('tag-autocomplete-container')) return; // Already initialized

            const wrapper = document.createElement('div');
            wrapper.className = 'tag-autocomplete-container';
            parent.insertBefore(wrapper, input);
            wrapper.appendChild(input);

            const list = document.createElement('ul');
            list.className = 'tag-autocomplete-list';
            wrapper.appendChild(list);

            let activeIndex = -1;

            const hideList = () => {
                list.style.display = 'none';
                list.innerHTML = '';
                activeIndex = -1;
            };

            input.addEventListener('input', () => {
                const text = input.value;
                const cursorPos = input.selectionStart;

                const textBeforeCursor = text.substring(0, cursorPos);
                const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
                const currentTag = textBeforeCursor.substring(lastCommaIndex + 1).trim();

                if (currentTag.length < 1) {
                    hideList();
                    return;
                }

                const searchTag = currentTag.replace(/\s+/g, '_').toLowerCase();
                const matches = this.tagPredictions.filter(tag => tag.startsWith(searchTag)).slice(0, 7);

                if (matches.length > 0) {
                    list.innerHTML = matches.map(match => `<li class="tag-autocomplete-item" data-tag="${match}">${match.replace(/_/g, ' ')}</li>`).join('');
                    list.style.display = 'block';
                    activeIndex = -1;
                } else {
                    hideList();
                }
            });

            const applySuggestion = (suggestion) => {
                const text = input.value;
                const cursorPos = input.selectionStart;
                
                const textBeforeCursor = text.substring(0, cursorPos);
                const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
                
                const before = text.substring(0, lastCommaIndex + 1);
                const after = text.substring(cursorPos);
                
                // Find where the current partial tag ends to replace it fully
                const textAfterCursor = text.substring(cursorPos);
                let endOfTagIndex = textAfterCursor.indexOf(',');
                if (endOfTagIndex === -1) endOfTagIndex = textAfterCursor.length;
                const finalAfter = text.substring(cursorPos + endOfTagIndex);
                
                const newText = (before.trim() ? before.trim() + ' ' : '') + suggestion.replace(/_/g, ' ') + ', ' + finalAfter.trim();
                
                input.value = newText.trim();
                
                const newCursorPos = (before.trim() ? before.trim() + ' ' : '').length + suggestion.length + 2;
                input.focus();
                input.setSelectionRange(newCursorPos, newCursorPos);

                hideList();
                // Trigger input event for auto-resizing textarea
                input.dispatchEvent(new Event('input', { bubbles: true }));
            };

            list.addEventListener('mousedown', e => {
                e.preventDefault(); // Prevent input from losing focus
                if (e.target.matches('.tag-autocomplete-item')) {
                    applySuggestion(e.target.dataset.tag);
                }
            });

            input.addEventListener('keydown', e => {
                const items = list.querySelectorAll('.tag-autocomplete-item');
                if (items.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIndex = (activeIndex + 1) % items.length;
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIndex = (activeIndex - 1 + items.length) % items.length;
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    if (activeIndex > -1) {
                        e.preventDefault();
                        applySuggestion(items[activeIndex].dataset.tag);
                    }
                    return;
                } else if (e.key === 'Escape') {
                    hideList();
                    return;
                }

                items.forEach((item, index) => {
                    item.classList.toggle('active', index === activeIndex);
                });
            });

            input.addEventListener('blur', () => setTimeout(hideList, 150)); // Delay to allow click
        });
    }

    async renderSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.innerHTML = `<div class="settings-form"><h3>Loading...</h3></div>`;
        document.body.appendChild(modal);

        const apiMode = api.getCurrentApiMode();
        // Yuuka: Luôn lấy config từ backend để đảm bảo đúng thứ tự ưu tiên
        const contextData = apiMode === 'bot' 
            ? { channelId: this.currentChannelId } 
            : { characterHash: this.selectedCharacter.hash };
        const configPromise = api.getBotInfo(this.apiKey, contextData);

        try {
            const { last_config } = await configPromise.catch(this._handleApiError.bind(this));
            last_config.character = this.selectedCharacter.name;

            const formContainer = modal.querySelector('.settings-form');
            this._makeContentScrollable(formContainer);

            const createTextarea = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><textarea id="cfg-${k}" name="${k}" rows="1">${v}</textarea></div>`;
            const createSlider = (k, l, v, min, max, step) => `<div class="form-group form-group-slider"><label for="cfg-${k}">${l}: <span id="val-${k}">${v}</span></label><input type="range" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${k}').textContent = this.value"></div>`;
            const createSelect = (k, l, v, opts) => `<div class="form-group"><label for="cfg-${k}">${l}</label><select id="cfg-${k}" name="${k}">${opts.map(o => `<option value="${o.value}" ${o.value == v ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>`;
            const createTextInput = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><input type="text" id="cfg-${k}" name="${k}" value="${v}"></div>`;
            
            let formHtml;
            if (apiMode === 'comfyui') {
                formHtml = `<h3>Cấu hình ComfyUI</h3>`;
            } else {
                const server = this._getServersData().find(s => s.id === this.currentServerId);
                const channel = server.channels.find(c => c.id === this.currentChannelId);
                formHtml = `<h3>Cấu hình cho #${channel.name}</h3>`;
            }

            formHtml += createTextarea('character', 'Character', last_config.character);
            formHtml += createTextarea('outfits', 'Outfits', last_config.outfits);
            formHtml += createTextarea('expression', 'Expression', last_config.expression);
            formHtml += createTextarea('action', 'Action', last_config.action);
            formHtml += createTextarea('context', 'Context', last_config.context);
            formHtml += createTextarea('quality', 'Quality', last_config.quality);
            formHtml += createTextarea('negative', 'Negative', last_config.negative);
            formHtml += createTextInput('lora_name', 'LoRA Name', last_config.lora_name);
            formHtml += createSlider('steps', 'Steps', last_config.steps, 10, 50, 1);
            formHtml += createSlider('cfg', 'CFG', last_config.cfg, 1.0, 7.0, 0.1);
            formHtml += createSelect('size', 'W x H', `${last_config.width}x${last_config.height}`, this.globalChoices.sizes);
            formHtml += createSelect('sampler_name', 'Sampler', last_config.sampler_name, this.globalChoices.samplers);
            formHtml += createSelect('scheduler', 'Scheduler', last_config.scheduler, this.globalChoices.schedulers);
            formHtml += createSelect('ckpt_name', 'Checkpoint', last_config.ckpt_name, this.globalChoices.checkpoints);
            formHtml += createTextInput('server_address', 'Server Address', last_config.server_address);
            formHtml += `<div class="settings-actions">
                <button type="button" class="btn-paste" title="Dán prompt từ bộ nhớ tạm">📋</button>
                <button type="button" class="btn-copy">Copy</button>
                <button type="submit" class="btn-save">Lưu</button>
                <button type="button" class="btn-cancel">Hủy</button>
            </div>`;

            formContainer.innerHTML = `<form id="channel-config-form">${formHtml}</form>`;

            // Yuuka: Khởi tạo tag autocomplete
            this._initTagAutocomplete(formContainer);
            
            const form = formContainer.querySelector('#channel-config-form');
            const textareas = formContainer.querySelectorAll('textarea');
            const autoResizeTextarea = (textarea) => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
            };
            textareas.forEach(textarea => {
                textarea.addEventListener('input', () => autoResizeTextarea(textarea));
                setTimeout(() => autoResizeTextarea(textarea), 0);
            });
            
            const close = () => modal.remove();
            
            const copyBtn = formContainer.querySelector('.btn-copy');
            copyBtn.addEventListener('click', () => {
                const promptKeys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
                const promptDataForClipboard = [];
                const promptMapForInternal = new Map();

                promptKeys.forEach(key => {
                    const value = form.elements[key].value.trim();
                    promptMapForInternal.set(key, value);
                    if (value) {
                        promptDataForClipboard.push(`${key}: ${value}`);
                    }
                });

                this.promptClipboard = promptMapForInternal;
                showError("Prompt đã được lưu tạm, sẵn sàng để dán.");
                
                if (promptDataForClipboard.length > 0) {
                    const clipboardText = promptDataForClipboard.join('\n');
                    navigator.clipboard.writeText(clipboardText).catch(err => {
                        console.warn("Could not copy to system clipboard: ", err);
                    });
                }
                
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '✔️';
                copyBtn.style.pointerEvents = 'none';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.style.pointerEvents = 'auto';
                }, 1500);
            });

            const pasteBtn = formContainer.querySelector('.btn-paste');
            pasteBtn.addEventListener('click', () => {
                if (!this.promptClipboard) {
                    showError("Chưa có prompt nào trong bộ nhớ tạm.");
                    return;
                }
                
                this.promptClipboard.forEach((value, key) => {
                    if (form.elements[key]) {
                        form.elements[key].value = value;
                    }
                });
                
                textareas.forEach(textarea => textarea.dispatchEvent(new Event('input', { bubbles: true })));
                showError("Đã dán prompt từ bộ nhớ tạm.");
            });

            formContainer.querySelector('.btn-cancel').addEventListener('click', close);
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const updates = {};
                ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative', 'lora_name', 'server_address'].forEach(k => updates[k] = form.elements[k].value);
                ['steps', 'cfg'].forEach(k => updates[k] = parseFloat(form.elements[k].value));
                ['sampler_name', 'scheduler', 'ckpt_name'].forEach(k => updates[k] = form.elements[k].value);
                const [width, height] = form.elements['size'].value.split('x').map(Number);
                updates['width'] = width; updates['height'] = height;

                try {
                    if (apiMode === 'comfyui') {
                        await api.saveComfyUIConfig(this.apiKey, updates).catch(this._handleApiError.bind(this));
                    } else {
                        await api.updateChannelConfig(this.apiKey, this.currentChannelId, updates).catch(this._handleApiError.bind(this));
                    }
                    showError('Lưu cấu hình thành công!');
                    close();
                } catch(err) {
                    showError(`Lỗi khi lưu: ${err.message}`);
                }
            });

        } catch (error) {
            showError(`Lỗi: ${error.message}`);
            modal.querySelector('.settings-form').innerHTML = `<h3>Lỗi</h3><p>${error.message}</p>`;
        }
    }
    
    initZoomAndPan(imgElement) {
        let scale = 1, panning = false,
            pointX = 0, pointY = 0,
            targetX = 0, targetY = 0,
            start = { x: 0, y: 0 },
            animFrame,
            lastPinchDist = 0;
        const easing = 0.2;
        const container = imgElement.parentElement.parentElement;
    
        function update() {
            pointX += (targetX - pointX) * easing;
            pointY += (targetY - pointY) * easing;
    
            imgElement.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    
            if (Math.abs(targetX - pointX) > 0.1 || Math.abs(targetY - pointY) > 0.1) {
                animFrame = requestAnimationFrame(update);
            } else {
                cancelAnimationFrame(animFrame);
            }
        }
    
        function setTransform() {
            cancelAnimationFrame(animFrame);
            animFrame = requestAnimationFrame(update);
        }
        
        function getPinchDist(touches) {
            return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        }
        
        function handleZoom(delta, clientX, clientY) {
            const rect = imgElement.getBoundingClientRect();
            const xs = (clientX - rect.left) / scale;
            const ys = (clientY - rect.top) / scale;
            const newScale = Math.min(Math.max(0.5, scale * delta), 5);
    
            targetX += xs * scale - xs * newScale;
            targetY += ys * scale - ys * newScale;
            scale = newScale;
            
            pointX = targetX;
            pointY = targetY;
            setTransform();
        }

        imgElement.addEventListener('mousedown', (e) => {
            e.preventDefault();
            panning = true;
            start = { x: e.clientX - targetX, y: e.clientY - targetY };
            imgElement.style.cursor = 'grabbing';
        });
        
        imgElement.addEventListener('mouseup', () => { panning = false; imgElement.style.cursor = 'grab'; });
        imgElement.addEventListener('mouseleave', () => { panning = false; imgElement.style.cursor = 'grab'; });
    
        imgElement.addEventListener('mousemove', (e) => {
            if (!panning) return;
            targetX = e.clientX - start.x;
            targetY = e.clientY - start.y;
            setTransform();
        });
    
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = (e.deltaY > 0) ? 0.9 : 1.1;
            handleZoom(delta, e.clientX, e.clientY);
        });

        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                panning = true;
                start = { x: e.touches[0].clientX - targetX, y: e.touches[0].clientY - targetY };
            } else if (e.touches.length === 2) {
                panning = false;
                e.preventDefault();
                lastPinchDist = getPinchDist(e.touches);
            }
        }, { passive: false });

        container.addEventListener('touchend', (e) => {
            panning = false;
            lastPinchDist = 0;
        });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1 && panning) {
                e.preventDefault();
                targetX = e.touches[0].clientX - start.x;
                targetY = e.touches[0].clientY - start.y;
                setTransform();
            } else if (e.touches.length === 2) {
                e.preventDefault();
                const newPinchDist = getPinchDist(e.touches);
                if(lastPinchDist > 0) {
                    const delta = newPinchDist / lastPinchDist;
                    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    handleZoom(delta, midX, midY);
                }
                lastPinchDist = newPinchDist;
            }
        }, { passive: false });
    
        imgElement.style.cursor = 'grab';
        setTransform();
    }
}

const albumManager = new AlbumManager();