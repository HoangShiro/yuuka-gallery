//--- MODIFIED FILE: plugins/character-list/static/character_list.js ---
class CharacterListComponent {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.gallery = this.container.querySelector('#gallery');
        this.loader = this.container.querySelector('#loader');
        this.modal = document.getElementById('modal');
        this.modalImage = document.getElementById('modal-image');
        this.modalCaption = document.getElementById('modal-caption');
        this.modalActions = document.getElementById('modal-actions');
        this.closeModalBtn = document.getElementById('modal-close');
        this.floatingSearchBar = document.getElementById('floating-search-bar');
        this.searchForm = document.getElementById('search-form');
        this.searchBox = document.getElementById('search-box');
        this.resultFooter = document.getElementById('result-footer');
        // Yuuka: Card enter animation v1.1
        this.enterAnimations = ['drop', 'rise', 'slide', 'zoom', 'flip', 'corner'];
        this.state = {
            allCharacters: [], sessionBrowseOrder: [], favourites: [], blacklist: [],
            displayMode: 'browse', currentPage: 1, isLoading: false, hasMore: true,
            currentSearchQuery: '', debounceTimeout: null, syncTimeout: null,
            currentModalCharacter: null, 
            animateNextLoad: false,
            currentAnimationClass: null,
        };
        this.observer = new IntersectionObserver(this.handleObserver.bind(this), { rootMargin: '400px' });
        
        // Yuuka: Grid zoom v2.0 - state
        this.zoomState = {
            active: false,
            startX: 0,
            startLevel: 2, // Default level
            currentLevel: 2,
            // 7 levels, including the base one
            sizes: ['110px', '130px', '150px', '175px', '200px', '225px', '250px'],
            sensitivity: 40 // Pixels to drag per zoom level change
        };
        
        this.bindEventHandlers();
    }

    bindEventHandlers() {
        this.handleSearchInput = this.handleSearchInput.bind(this);
        this.handleSearchSubmit = this.handleSearchSubmit.bind(this);
        this.handleSearchKeyDown = this.handleSearchKeyDown.bind(this);
        this.openModal = this.openModal.bind(this);
        this.closeModal = this.closeModal.bind(this);
        this.toggleFavourite = this.toggleFavourite.bind(this);
        this.toggleBlacklist = this.toggleBlacklist.bind(this);

        // Yuuka: Grid zoom v2.0 - binds
        this.handleZoomStart = this.handleZoomStart.bind(this);
        this.handleZoomMove = this.handleZoomMove.bind(this);
        this.handleZoomEnd = this.handleZoomEnd.bind(this);
    }

    _getPreferredAlbumOpenViewMode({ forceAlbum = false } = {}) {
        if (forceAlbum) return 'album';
        try {
            const v = localStorage.getItem('yuuka.album.grid_open_view_mode');
            return v === 'character' ? 'character' : 'album';
        } catch {
            return 'album';
        }
    }

    async init() {
        console.log("[Plugin:CharacterList] Initializing...");

        // Yuuka: Grid zoom v2.0 - Load and apply saved zoom level
        const savedLevel = parseInt(localStorage.getItem('yuuka-gallery-zoom-level'), 10);
        if (!isNaN(savedLevel) && savedLevel >= 0 && savedLevel < this.zoomState.sizes.length) {
            this.zoomState.currentLevel = savedLevel;
            this.zoomState.startLevel = savedLevel;
        }
        this._applyZoomLevel(this.zoomState.currentLevel);

        this.resultFooter.style.display = 'none';
        const [charResponse, listsResponse] = await Promise.all([this.api.getAllCharacters(), this.api['character-list'].get('/lists')]);
        this.state.allCharacters = charResponse.characters;
        this.state.favourites = listsResponse.favourites || [];
        this.state.blacklist = listsResponse.blacklist || [];
        
        this.attachEventListeners();
        this._updateNav();

        // Yuuka: double reload fix v2.0 - Plugin tự quản lý state phiên
        window.Yuuka.pluginState = window.Yuuka.pluginState || {};
        if (!window.Yuuka.pluginState.characterList) {
            console.log("[CharacterList] First time initialization for this session. Shuffling characters.");
            // Lưu lại sessionBrowseOrder vào state của plugin
            this._shuffleSessionOrder();
            this.state.animateNextLoad = true;
            this.state.currentAnimationClass = 'card-anim-rise';
            window.Yuuka.pluginState.characterList = { 
                initialized: true,
                sessionBrowseOrder: this.state.sessionBrowseOrder
            };
        } else {
            // Lấy lại thứ tự đã xáo trộn từ state phiên
            this.state.sessionBrowseOrder = window.Yuuka.pluginState.characterList.sessionBrowseOrder;
        }

        await this.resetAndLoad();
    }

    destroy() {
        console.log("[Plugin:CharacterList] Destroying...");
        const navibar = window.Yuuka.services.navibar;
        if (navibar) {
            if (navibar._isSearchActive) {
                navibar.showSearchBar(null);
            }
            navibar.setActivePlugin(null);
        }
        // Yuuka: Grid zoom v2.0 - clean up zoom state
        if (this.zoomState.active) {
            this.handleZoomEnd();
        }
        this.resultFooter.style.display = 'none';
        this.observer.disconnect();
        this.detachEventListeners();
    }
    
    attachEventListeners() {
        this.searchBox.addEventListener('input', this.handleSearchInput);
        this.searchBox.addEventListener('keydown', this.handleSearchKeyDown);
        this.searchForm.addEventListener('submit', this.handleSearchSubmit);
        this.gallery.addEventListener('click', this.handleGalleryClick.bind(this));
        this.container.addEventListener('pointerdown', this.handleZoomStart); // Yuuka: grid zoom v2.0
        this.modal.addEventListener('click', (e) => e.target === this.modal && this.closeModal());
        this.closeModalBtn.addEventListener('click', this.closeModal);
    }

    detachEventListeners() {
        this.searchBox.removeEventListener('input', this.handleSearchInput);
        this.searchBox.removeEventListener('keydown', this.handleSearchKeyDown);
        this.container.removeEventListener('pointerdown', this.handleZoomStart); // Yuuka: grid zoom v2.0
        window.removeEventListener('pointermove', this.handleZoomMove);
        window.removeEventListener('pointerup', this.handleZoomEnd);
    }
    
    _updateNav() {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) {
            console.warn("[CharacterList] Navibar service not yet available.");
            return;
        }

        // Yuuka: navibar auto-init v1.0 - Gỡ bỏ việc đăng ký nút chính 'cl-browse'
        // Navibar sẽ tự động đăng ký nút này từ manifest.

        this._registerBrowseMainButton(navibar);

        // Register the tool button for Favourites/Blacklist
        navibar.registerButton({
            id: 'cl-lists',
            type: 'tools',
            pluginId: 'character-list',
            order: 10,
            icon: this.state.displayMode === 'blacklist' ? 'block' : 'favorite',
            title: this.state.displayMode === 'blacklist' ? 'Danh sách đen' : 'Yêu thích',
            isActive: () => ['favourites', 'blacklist'].includes(this.state.displayMode),
            onClick: () => {
                this.state.displayMode = (this.state.displayMode === 'favourites') ? 'blacklist' : 'favourites';
                this.resetAndLoad();
                this._updateNav();
            }
        });
        
        // Register the tool button for Search
        navibar.registerButton({
            id: 'cl-search',
            type: 'tools',
            pluginId: 'character-list',
            order: 20,
            icon: 'search',
            title: 'Tìm kiếm',
            isActive: () => navibar._isSearchActive, // Check navibar's state
            onClick: () => {
                const searchFormElement = document.getElementById('search-form');
                if (navibar._isSearchActive) {
                    navibar.showSearchBar(null);
                } else {
                    navibar.showSearchBar(searchFormElement);
                    this.searchBox.focus();
                }
            }
        });

        // Tell navibar this plugin is active so it shows the tool buttons
        navibar.setActivePlugin('character-list');
    }

    _registerBrowseMainButton(navibar) {
        const isMainActive = () => navibar._activePluginId === 'character-list';
        const computeIcon = () => 'grid_view';
        const computeTitle = () => {
            if (!this._isBrowseTabActive()) return 'Browse';
            if (this.state.displayMode !== 'browse') return 'Quay lại duyệt';
            return 'Làm mới danh sách';
        };

        navibar.registerButton({
            id: 'character-list-main',
            type: 'main',
            pluginId: 'character-list',
            icon: 'grid_view',
            title: 'Browse',
            isActive: isMainActive,
            mode: 'toggle',
            toggleStates: [
                {
                    icon: () => computeIcon(),
                    title: () => computeTitle(),
                    isActive: isMainActive,
                    onClick: (ctx) => this._handleBrowseMainButtonToggle(ctx)
                }
            ]
        });
    }

    _isBrowseTabActive() {
        const browseBtn = document.querySelector('.tab-btn[data-tab="browse"]');
        return !!(browseBtn && browseBtn.classList.contains('active'));
    }

    _handleBrowseMainButtonToggle() {
        const navibar = window.Yuuka.services.navibar;

        if (!this._isBrowseTabActive()) {
            Yuuka.ui.switchTab('browse');
            return;
        }

        if (this.state.displayMode !== 'browse') {
            this.state.displayMode = 'browse';
            this.state.currentSearchQuery = '';
            if (this.searchBox) {
                this.searchBox.value = '';
            }
            if (navibar && navibar._isSearchActive) {
                navibar.showSearchBar(null);
            }
            this._updateNav();
            this.resetAndLoad();
            return;
        }

        this.state.displayMode = 'browse';
        this._shuffleSessionOrder();
        if (window.Yuuka.pluginState.characterList) {
            window.Yuuka.pluginState.characterList.sessionBrowseOrder = this.state.sessionBrowseOrder;
        } else {
            window.Yuuka.pluginState.characterList = {
                initialized: true,
                sessionBrowseOrder: this.state.sessionBrowseOrder
            };
        }

        this.state.currentSearchQuery = '';
        if (this.searchBox && this.searchBox.value) {
            this.searchBox.value = '';
        }
        if (navibar && navibar._isSearchActive) {
            navibar.showSearchBar(null);
        }

        this.state.animateNextLoad = true;
        this.state.currentAnimationClass = 'card-anim-rise';
        this._updateNav();
        this.resetAndLoad();
    }

    _shuffleSessionOrder() { let b = this.state.allCharacters.filter(c => !this.state.blacklist.includes(c.hash)); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } this.state.sessionBrowseOrder = b; }
    async _saveUserLists() { clearTimeout(this.state.syncTimeout); this.state.syncTimeout = setTimeout(async () => { try { await this.api['character-list'].post('/lists', { favourites: this.state.favourites, blacklist: this.state.blacklist }); } catch (e) { console.error("Failed to sync lists:", e); } }, 500); }
    handleSearchInput() { clearTimeout(this.state.debounceTimeout); this.state.debounceTimeout = setTimeout(() => { const q = this.searchBox.value.trim().toLowerCase(); if (q.startsWith('/') || this.state.currentSearchQuery === q) return; this.state.currentSearchQuery = q; this.resetAndLoad(); }, 300); }
    
    handleSearchKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.handleSearchSubmit(e);
        }
    }

    async handleSearchSubmit(e) { 
        e.preventDefault(); 
        const q = this.searchBox.value.trim(); 
        
        if (q === '/dark') {
            document.documentElement.classList.add('dark-mode');
            localStorage.setItem('yuuka-theme', 'dark');
            showError('Đã chuyển sang giao diện tối.');
            this.searchBox.value = '';
            return;
        }

        if (q === '/light') {
            document.documentElement.classList.remove('dark-mode');
            localStorage.setItem('yuuka-theme', 'light');
            showError('Đã chuyển sang giao diện sáng.');
            this.searchBox.value = '';
            return;
        }
        
        if (q === '/token') {
            const auth = window.Yuuka.services.auth;
            if (auth && auth.copyTokenToClipboard) {
                auth.copyTokenToClipboard()
                    .then(() => showError('Token đã sao chép.'))
                    .catch(() => showError('Lỗi: Không thể sao chép.'));
            } else {
                showError('Auth service chưa sẵn sàng.');
            }
            this.searchBox.value = '';
            return;
        }

        if (q === '/blacklist share') {
            const s = 'BL-' + btoa(JSON.stringify(this.state.blacklist));
             // Yuuka: auth rework v1.1 - Use global clipboard utility
            Yuuka.ui.copyToClipboard(s)
                .then(() => showError('Mã chia sẻ blacklist đã sao chép.'))
                .catch(() => showError('Lỗi: Không thể sao chép.'));
            this.searchBox.value = '';
            return;
        }

        if (q === '/favourite share') {
            const s = 'FV-' + btoa(JSON.stringify(this.state.favourites));
             // Yuuka: auth rework v1.1 - Use global clipboard utility
            Yuuka.ui.copyToClipboard(s)
                .then(() => showError('Mã chia sẻ favourite đã sao chép.'))
                .catch(() => showError('Lỗi: Không thể sao chép.'));
            this.searchBox.value = '';
            return;
        }

        const wl = q.match(/^\/whitelist\s+(.+)/);
        if (wl) {
            const tokenToAdd = wl[1].trim();
            if (tokenToAdd) {
                try {
                    const result = await this.api['character-list'].post('/whitelist/add', { token: tokenToAdd });
                    showError(result.message);
                } catch (err) {
                    showError(`Lỗi: ${err.message}`);
                }
            } else {
                showError("Lỗi: Lệnh không hợp lệ. Cú pháp: /whitelist <token>");
            }
            this.searchBox.value = '';
            return;
        }

        if (q.startsWith('BL-')) {
            try { const d = JSON.parse(atob(q.substring(3))); if (!Array.isArray(d)) throw new Error(); const c = new Set(this.state.blacklist); let a = 0; d.forEach(h => { if (!c.has(h)) { c.add(h); a++; } }); this.state.blacklist = Array.from(c); this._saveUserLists(); this._shuffleSessionOrder(); await this.resetAndLoad(); showError(`Đã thêm ${a} vào blacklist.`); } 
            catch (err) { showError("Mã blacklist không hợp lệ."); }
            this.searchBox.value = '';
            return;
        }

        if (q.startsWith('FV-')) {
            try { const d = JSON.parse(atob(q.substring(3))); if (!Array.isArray(d)) throw new Error(); const c = new Set(this.state.favourites); let a = 0; d.forEach(h => { if (!c.has(h)) { c.add(h); a++; } }); this.state.favourites = Array.from(c); this._saveUserLists(); await this.resetAndLoad(); showError(`Đã thêm ${a} vào favourite.`); } 
            catch (err) { showError("Mã favourite không hợp lệ."); }
            this.searchBox.value = '';
            return;
        }
        
        if (q === '/logout') {
            const auth = window.Yuuka.services.auth;
            if (auth && auth.logout) {
                await auth.logout(true);
            } else {
                showError('Auth service chưa sẵn sàng.');
            }
            return;
        }

        if (q === '/stop') {
            if (await Yuuka.ui.confirm('Bạn có chắc muốn tắt server không? Thao tác này sẽ đóng ứng dụng.')) {
                this.api.server.shutdown().then(() => {
                    showError("Đã gửi lệnh tắt server. Chuẩn bị tải lại...");
                    this.loader.classList.add('visible');
                    document.body.style.pointerEvents = 'none';

                    let countdown = 3;
                    this.loader.textContent = `Server đang tắt. Tải lại sau ${countdown}s...`;

                    const countdownInterval = setInterval(() => {
                        countdown--;
                        if (countdown > 0) {
                            this.loader.textContent = `Server đang tắt. Tải lại sau ${countdown}s...`;
                        } else {
                            clearInterval(countdownInterval);
                            this.loader.textContent = `Đang tải lại...`;
                            window.location.reload();
                        }
                    }, 1000);
                    
                }).catch(err => showError(`Lỗi: Không thể gửi lệnh tắt: ${err.message}`));
            }
            this.searchBox.value = '';
            return;
        }

        const b = q.match(/^\/(blacklist|rm)\s+(.+)/);
        if (b) {
            const k = b[2].toLowerCase();
            const m = this.state.allCharacters.filter(c => c.name.toLowerCase().includes(k) && !this.state.blacklist.includes(c.hash));
            if (m.length > 0) {
                this.state.blacklist.push(...m.map(c => c.hash));
                this._saveUserLists();
                this._shuffleSessionOrder();
                showError(`${m.length} đã thêm vào blacklist.`);
                this.searchBox.value = '';
                this.state.currentSearchQuery = '';
                await this.resetAndLoad();
            } else {
                showError(`Không tìm thấy: "${k}"`);
            }
            return;
        }
    }

    // Yuuka: Grid zoom v2.0 - Zoom handlers
    handleZoomStart(e) {
        // Only trigger for left-click and if the click is on the container background, not a card itself
        if (e.button !== 0 || e.target.closest('.character-card')) {
            return;
        }
        
        e.preventDefault();

        this.zoomState.active = true;
        this.zoomState.startX = e.clientX;
        this.zoomState.startLevel = this.zoomState.currentLevel; // Remember level when drag started
        
        document.body.classList.add('is-zooming');

        window.addEventListener('pointermove', this.handleZoomMove);
        window.addEventListener('pointerup', this.handleZoomEnd, { once: true });
    }

    handleZoomMove(e) {
        if (!this.zoomState.active) return;

        const deltaX = e.clientX - this.zoomState.startX;
        const levelChange = Math.round(deltaX / this.zoomState.sensitivity);
        
        let newLevel = this.zoomState.startLevel + levelChange;
        
        // Clamp the level between 0 and max level
        newLevel = Math.max(0, Math.min(this.zoomState.sizes.length - 1, newLevel));

        if (newLevel !== this.zoomState.currentLevel) {
            this.zoomState.currentLevel = newLevel;
            this._applyZoomLevel(newLevel);
        }
    }

    handleZoomEnd(e) {
        if (!this.zoomState.active) return;
        
        localStorage.setItem('yuuka-gallery-zoom-level', this.zoomState.currentLevel);
        
        document.body.classList.remove('is-zooming');

        window.removeEventListener('pointermove', this.handleZoomMove);
        
        this.zoomState.active = false;
    }

    _applyZoomLevel(level) {
        const size = this.zoomState.sizes[level];
        if (size) {
            this.gallery.style.setProperty('--gallery-item-size', size);
        }
    }

    handleGalleryClick(e) { 
        const card = e.target.closest('.character-card');
        if (!card) return;
        
        if (e.target.closest('.card-album-btn')) {
            e.stopPropagation();
            const viewMode = this._getPreferredAlbumOpenViewMode();
            window.Yuuka.initialPluginState.album = {
                character: { hash: card.dataset.hash, name: card.dataset.name },
                viewMode,
            };
            Yuuka.ui.switchTab('album');
            return;
        }
        
        this.openModal(card);
    }
    handleObserver(entries) { if (entries[0]?.isIntersecting&&!this.state.isLoading&&this.state.hasMore)this.loadCharacters();}
    createCharacterCard(char) { const c=document.createElement('div');c.className='character-card';c.dataset.hash=char.hash;c.dataset.name=char.name;const isAlbumPluginActive=this.activePlugins.some(p=>p.id==='album');const a=isAlbumPluginActive?`<button class="card-album-btn" title="Mở trong Album"><span class="material-symbols-outlined">photo_album</span></button>`:'';c.innerHTML=`<div class="image-container">${a}<img src="/image/${char.hash}" alt="${char.name}" loading="lazy"></div><div class="name">${char.name}</div>`;if(this.state.animateNextLoad&&this.state.currentAnimationClass){c.classList.add(this.state.currentAnimationClass);c.style.animationDelay=`${Math.random()*0.5}s`;}this.gallery.appendChild(c);}
    async loadCharacters() { if(this.state.isLoading||!this.state.hasMore)return;this.state.isLoading=true;this.loader.classList.add('visible');this.resultFooter.style.display='none';let s=[];switch(this.state.displayMode){case'favourites':s=this.state.allCharacters.filter(c=>this.state.favourites.includes(c.hash));break;case'blacklist':s=this.state.allCharacters.filter(c=>this.state.blacklist.includes(c.hash));break;default:s=this.state.sessionBrowseOrder;}if(this.state.currentSearchQuery){s=s.filter(c=>c.name.toLowerCase().includes(this.state.currentSearchQuery));}const B=50;const i=(this.state.currentPage-1)*B;const r=s.slice(i,i+B);if(r.length===0){this.state.hasMore=false;}else{r.forEach(c=>this.createCharacterCard(c));this.state.currentPage++;this.state.hasMore=this.gallery.children.length<s.length;}this.state.isLoading=false;this.loader.classList.remove('visible');if(!this.state.hasMore){const t=this.gallery.getElementsByClassName('character-card').length;if(t>0){this.resultFooter.textContent=`Đã hiển thị ${t} kết quả.`;this.resultFooter.style.display='block';this.loader.style.display='none';}else{this.loader.textContent="Không tìm thấy.";this.loader.style.display='block';this.resultFooter.style.display='none';}}this.state.animateNextLoad=false;this.state.currentAnimationClass=null;}
    async resetAndLoad() { this.observer.disconnect();this.gallery.innerHTML='';this.state.currentPage=1;this.state.hasMore=true;this.state.isLoading=false;this.loader.textContent='Đang tải...';this.loader.style.display='block';this.resultFooter.style.display='none';await this.loadCharacters();if(this.state.hasMore)this.observer.observe(this.loader);}
    openModal(card) { this.state.currentModalCharacter={hash:card.dataset.hash,name:card.dataset.name};this.modalImage.src=card.querySelector('img').src;this.modalCaption.textContent=this.state.currentModalCharacter.name;this.updateModalActions();this.modal.style.display='flex';}
    closeModal() { this.modal.style.display='none';this.state.currentModalCharacter=null;}
    toggleFavourite() { const{hash,name}=this.state.currentModalCharacter;const i=this.state.favourites.indexOf(hash);if(i>-1){this.state.favourites.splice(i,1);showError(`${name} đã được xóa khỏi Yêu thích.`);}else{this.state.favourites.push(hash);showError(`${name} đã được thêm vào Yêu thích.`);}this._saveUserLists();this.updateModalActions();if(this.state.displayMode==='favourites'&&i>-1){this.gallery.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();this.closeModal();}}
    
    toggleBlacklist() {
        const { hash, name } = this.state.currentModalCharacter;
        const i = this.state.blacklist.indexOf(hash);
        if (i > -1) {
            this.state.blacklist.splice(i, 1);
            showError(`${name} đã được xóa khỏi Danh sách đen.`);
        } else {
            this.state.blacklist.push(hash);
            showError(`${name} đã được thêm vào Danh sách đen.`);
            const f = this.state.favourites.indexOf(hash);
            if (f > -1) this.state.favourites.splice(f, 1);
        }
        // Yuuka: Blacklist Bug Fix v2.1 - Tái tạo lại danh sách duyệt và cập nhật state phiên
        this._shuffleSessionOrder();
        if (window.Yuuka.pluginState.characterList) {
            window.Yuuka.pluginState.characterList.sessionBrowseOrder = this.state.sessionBrowseOrder;
        }
        this._saveUserLists();
        this.updateModalActions();
        this.gallery.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();
        this.closeModal();
    }

    updateModalActions() { 
        if (!this.state.currentModalCharacter) return;
        const { hash } = this.state.currentModalCharacter;
        const isF = this.state.favourites.includes(hash);
        const isB = this.state.blacklist.includes(hash);
        const isAlbumPluginActive = this.activePlugins.some(p => p.id === 'album');
        
        const aB = isAlbumPluginActive ? `<button class="modal-action-btn" data-action="album" title="Mở trong Album"><span class="material-symbols-outlined">photo_album</span></button>` : '';
        const sB = `<button class="modal-action-btn" data-action="search" title="Search Online"><span class="material-symbols-outlined">search</span></button>`;
        const fB = (this.state.displayMode !== 'blacklist') ? `<button class="modal-action-btn ${isF ? 'is-active' : ''}" data-action="favourite" title="Yêu thích"><span class="material-symbols-outlined">favorite</span></button>` : '';
        const bB = (this.state.displayMode !== 'favourites') ? `<button class="modal-action-btn ${isB ? 'is-active' : ''}" data-action="blacklist" title="Thêm vào danh sách đen"><span class="material-symbols-outlined">block</span></button>` : '';
        
        this.modalActions.innerHTML = aB + sB + fB + bB;

        this.modalActions.querySelector('[data-action="search"]')?.addEventListener('click', () => { window.open(`https://www.google.com/search?q=${encodeURIComponent(this.state.currentModalCharacter.name)}`, '_blank'); });
        
        this.modalActions.querySelector('[data-action="album"]')?.addEventListener('click', () => {
            const viewMode = this._getPreferredAlbumOpenViewMode();
            window.Yuuka.initialPluginState.album = {
                character: this.state.currentModalCharacter,
                viewMode,
            };
            Yuuka.ui.switchTab('album');
            this.closeModal();
        });

        this.modalActions.querySelector('[data-action="favourite"]')?.addEventListener('click', this.toggleFavourite);
        this.modalActions.querySelector('[data-action="blacklist"]')?.addEventListener('click', this.toggleBlacklist);
    }
}

window.Yuuka.components['CharacterListComponent'] = CharacterListComponent;
