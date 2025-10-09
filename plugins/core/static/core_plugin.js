//--- MODIFIED FILE: plugins/core/static/core_plugin.js ---
class CoreComponent {
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
        this.state = {
            allCharacters: [], sessionBrowseOrder: [], favourites: [], blacklist: [],
            displayMode: 'browse', currentPage: 1, isLoading: false, hasMore: true,
            currentSearchQuery: '', debounceTimeout: null, syncTimeout: null,
            currentModalCharacter: null, 
        };
        this.observer = new IntersectionObserver(this.handleObserver.bind(this), { rootMargin: '400px' });
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
    }

    async init() {
        console.log("[Plugin:Core] Initializing...");
        this.resultFooter.style.display = 'none';
        const [charResponse, listsResponse] = await Promise.all([this.api.getAllCharacters(), this.api.core.get('/lists')]);
        this.state.allCharacters = charResponse.characters;
        this.state.favourites = listsResponse.favourites || [];
        this.state.blacklist = listsResponse.blacklist || [];
        this._shuffleSessionOrder();
        this.attachEventListeners();
        this._updateNav();
        await this.resetAndLoad();
    }

    destroy() {
        console.log("[Plugin:Core] Destroying...");
        this.floatingSearchBar.classList.remove('show');
        this.resultFooter.style.display = 'none';
        this.observer.disconnect();
        this.detachEventListeners();
        // YUUKA: Xóa bỏ clearNavButtons, navibar sẽ tự quản lý
    }
    
    attachEventListeners() {
        this.searchBox.addEventListener('input', this.handleSearchInput);
        this.searchBox.addEventListener('keydown', this.handleSearchKeyDown);
        this.searchForm.addEventListener('submit', this.handleSearchSubmit);
        this.gallery.addEventListener('click', this.handleGalleryClick.bind(this));
        this.modal.addEventListener('click', (e) => e.target === this.modal && this.closeModal());
        this.closeModalBtn.addEventListener('click', this.closeModal);
    }

    detachEventListeners() {
        this.searchBox.removeEventListener('input', this.handleSearchInput);
        this.searchBox.removeEventListener('keydown', this.handleSearchKeyDown);
    }
    
    _updateNav() {
        // YUUKA: Chuyển sang sử dụng service của plugin navibar
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;

        const mainNavButtons = [];
        let toolButtons = [];

        // 1. Lấy thông tin các plugin khác
        const scenePlugin = this.activePlugins.find(p => p.id === 'scene');
        const albumPlugin = this.activePlugins.find(p => p.id === 'album');
        
        // 2. Tạo nút Scene nếu có
        if (scenePlugin?.ui?.tab) {
             mainNavButtons.push({
                id: `scene-tab`, group: 'main', icon: scenePlugin.ui.tab.icon, title: scenePlugin.ui.tab.label,
                onClick: () => Yuuka.ui.switchTab(scenePlugin.ui.tab.id)
            });
        }
        
        // 3. Tạo nút Album nếu có
        if (albumPlugin?.ui?.tab) {
             mainNavButtons.push({
                id: `album-tab`, group: 'main', icon: albumPlugin.ui.tab.icon, title: albumPlugin.ui.tab.label,
                onClick: () => Yuuka.ui.switchTab(albumPlugin.ui.tab.id)
            });
        }
        
        // 4. Thêm nút Browse (chính plugin này)
        mainNavButtons.push({
            id: 'browse-tab', group: 'main', icon: 'grid_view', title: 'Duyệt / Trộn ngẫu nhiên',
            isActive: () => this.state.displayMode === 'browse',
            onClick: () => {
                if (this.state.displayMode === 'browse') { this._shuffleSessionOrder(); this.resetAndLoad(); } 
                else { this.state.displayMode = 'browse'; this.resetAndLoad(); this._updateNav(); }
            }
        });

        // 5. Thêm nút List (Favourite/Blacklist)
        mainNavButtons.push({
            id: 'lists-tab', group: 'main', 
            icon: this.state.displayMode === 'blacklist' ? 'block' : 'favorite',
            title: this.state.displayMode === 'blacklist' ? 'Danh sách đen' : 'Yêu thích',
            isActive: () => ['favourites', 'blacklist'].includes(this.state.displayMode),
            onClick: () => {
                this.state.displayMode = (this.state.displayMode === 'favourites') ? 'blacklist' : 'favourites';
                this.resetAndLoad(); this._updateNav();
            }
        });
        
        // 6. Tạo nút Search (công cụ)
        toolButtons.push({
            id: 'search', group: 'tools', icon: 'search', title: 'Tìm kiếm',
            isActive: () => this.floatingSearchBar.classList.contains('show'),
            onClick: () => {
                this.floatingSearchBar.classList.toggle('show');
                if (this.floatingSearchBar.classList.contains('show')) this.searchBox.focus();
                else this.searchBox.blur();
                this._updateNav();
            }
        });
        
        navibar.setButtons([...mainNavButtons, ...toolButtons]);
    }

    _shuffleSessionOrder() { let b = this.state.allCharacters.filter(c => !this.state.blacklist.includes(c.hash)); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } this.state.sessionBrowseOrder = b; }
    async _saveUserLists() { clearTimeout(this.state.syncTimeout); this.state.syncTimeout = setTimeout(async () => { try { await this.api.core.post('/lists', { favourites: this.state.favourites, blacklist: this.state.blacklist }); } catch (e) { console.error("Failed to sync lists:", e); } }, 500); }
    handleSearchInput() { clearTimeout(this.state.debounceTimeout); this.state.debounceTimeout = setTimeout(() => { const q = this.searchBox.value.trim().toLowerCase(); if (q.startsWith('/') || this.state.currentSearchQuery === q) return; this.state.currentSearchQuery = q; this.resetAndLoad(); }, 300); }
    
    handleSearchKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.handleSearchSubmit(e);
        }
    }

    // Yuuka: Helper mới để copy text, hoạt động trên cả http và https
    _copyToClipboard(text) {
        return new Promise((resolve, reject) => {
            if (navigator.clipboard && window.isSecureContext) {
                // Sử dụng API hiện đại nếu có thể
                navigator.clipboard.writeText(text).then(resolve).catch(reject);
            } else {
                // Fallback cho môi trường không an toàn (http)
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = 'fixed'; // Tránh cuộn trang
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        resolve();
                    } else {
                        reject(new Error('Copy command was not successful'));
                    }
                } catch (err) {
                    reject(err);
                } finally {
                    document.body.removeChild(textArea);
                }
            }
        });
    }

    async handleSearchSubmit(e) { 
        e.preventDefault(); 
        const q = this.searchBox.value.trim(); 
        
        // YUUKA: Thêm lệnh đổi theme v1.0
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
        
        // Yuuka: Sử dụng helper _copyToClipboard mới cho tất cả các lệnh copy
        if (q === '/token') {
            const t = localStorage.getItem('yuuka-auth-token');
            if (t) {
                this._copyToClipboard(t)
                    .then(() => showError('Token đã sao chép.'))
                    .catch(() => showError('Lỗi: Không thể sao chép.'));
            } else {
                showError('Không tìm thấy token.');
            }
            this.searchBox.value = '';
            return;
        }

        if (q === '/blacklist share') {
            const s = 'BL-' + btoa(JSON.stringify(this.state.blacklist));
            this._copyToClipboard(s)
                .then(() => showError('Mã chia sẻ blacklist đã sao chép.'))
                .catch(() => showError('Lỗi: Không thể sao chép.'));
            this.searchBox.value = '';
            return;
        }

        if (q === '/favourite share') {
            const s = 'FV-' + btoa(JSON.stringify(this.state.favourites));
            this._copyToClipboard(s)
                .then(() => showError('Mã chia sẻ favourite đã sao chép.'))
                .catch(() => showError('Lỗi: Không thể sao chép.'));
            this.searchBox.value = '';
            return;
        }

        const l = q.match(/^\/login\s+(.+)/);
        if (l) {
            const i = l[1];
            try { await this.api.auth.shareTokenWithIP(i); showError(`Token đã chia sẻ cho IP: ${i}`); } 
            catch (err) { showError(`Lỗi: ${err.message}`); }
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
            const token = localStorage.getItem('yuuka-auth-token');
            if (token) {
                try {
                    await this._copyToClipboard(token);
                    sessionStorage.setItem('yuuka-logout-message', 'Đã đăng xuất. Token của bạn đã được sao chép vào clipboard.');
                } catch (err) {
                    console.warn("Could not copy token to clipboard:", err);
                    sessionStorage.setItem('yuuka-logout-message', 'Đã đăng xuất. (Không thể sao chép token.)');
                }
            } else {
                sessionStorage.setItem('yuuka-logout-message', 'Đã đăng xuất.');
            }

            try {
                await this.api.auth.logout();
            } catch (error) {
                console.error(`Server logout failed: ${error.message}`);
            } finally {
                localStorage.removeItem('yuuka-auth-token');
                window.location.reload();
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

    handleGalleryClick(e) { 
        const card = e.target.closest('.character-card');
        if (!card) return;
        
        if (e.target.closest('.card-album-btn')) {
            e.stopPropagation();
            window.Yuuka.initialPluginState.album = {
                character: { hash: card.dataset.hash, name: card.dataset.name }
            };
            Yuuka.ui.switchTab('album');
            return;
        }
        
        this.openModal(card);
    }
    handleObserver(entries) { if (entries[0]?.isIntersecting&&!this.state.isLoading&&this.state.hasMore)this.loadCharacters();}
    createCharacterCard(char) { const c=document.createElement('div');c.className='character-card';c.dataset.hash=char.hash;c.dataset.name=char.name;const isAlbumPluginActive=this.activePlugins.some(p=>p.id==='album');const a=isAlbumPluginActive?`<button class="card-album-btn" title="Mở trong Album"><span class="material-symbols-outlined">photo_album</span></button>`:'';c.innerHTML=`<div class="image-container">${a}<img src="/image/${char.hash}" alt="${char.name}" loading="lazy"></div><div class="name">${char.name}</div>`;this.gallery.appendChild(c);}
    async loadCharacters() { if(this.state.isLoading||!this.state.hasMore)return;this.state.isLoading=true;this.loader.classList.add('visible');this.resultFooter.style.display='none';let s=[];switch(this.state.displayMode){case'favourites':s=this.state.allCharacters.filter(c=>this.state.favourites.includes(c.hash));break;case'blacklist':s=this.state.allCharacters.filter(c=>this.state.blacklist.includes(c.hash));break;default:s=this.state.sessionBrowseOrder;}if(this.state.currentSearchQuery){s=s.filter(c=>c.name.toLowerCase().includes(this.state.currentSearchQuery));}const B=50;const i=(this.state.currentPage-1)*B;const r=s.slice(i,i+B);if(r.length===0){this.state.hasMore=false;}else{r.forEach(c=>this.createCharacterCard(c));this.state.currentPage++;this.state.hasMore=this.gallery.children.length<s.length;}this.state.isLoading=false;this.loader.classList.remove('visible');if(!this.state.hasMore){const t=this.gallery.getElementsByClassName('character-card').length;if(t>0){this.resultFooter.textContent=`Đã hiển thị ${t} kết quả.`;this.resultFooter.style.display='block';this.loader.style.display='none';}else{this.loader.textContent="Không tìm thấy.";this.loader.style.display='block';this.resultFooter.style.display='none';}}}
    async resetAndLoad() { this.observer.disconnect();this.gallery.innerHTML='';this.state.currentPage=1;this.state.hasMore=true;this.state.isLoading=false;this.loader.textContent='Đang tải...';this.loader.style.display='block';this.resultFooter.style.display='none';await this.loadCharacters();if(this.state.hasMore)this.observer.observe(this.loader);}
    openModal(card) { this.state.currentModalCharacter={hash:card.dataset.hash,name:card.dataset.name};this.modalImage.src=card.querySelector('img').src;this.modalCaption.textContent=this.state.currentModalCharacter.name;this.updateModalActions();this.modal.style.display='flex';}
    closeModal() { this.modal.style.display='none';this.state.currentModalCharacter=null;}
    toggleFavourite() { const{hash,name}=this.state.currentModalCharacter;const i=this.state.favourites.indexOf(hash);if(i>-1){this.state.favourites.splice(i,1);showError(`${name} đã được xóa khỏi Yêu thích.`);}else{this.state.favourites.push(hash);showError(`${name} đã được thêm vào Yêu thích.`);}this._saveUserLists();this.updateModalActions();if(this.state.displayMode==='favourites'&&i>-1){this.gallery.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();this.closeModal();}} // Yuuka: notification v1.0
    toggleBlacklist() { const{hash,name}=this.state.currentModalCharacter;const i=this.state.blacklist.indexOf(hash);if(i>-1){this.state.blacklist.splice(i,1);showError(`${name} đã được xóa khỏi Danh sách đen.`);}else{this.state.blacklist.push(hash);showError(`${name} đã được thêm vào Danh sách đen.`);const f=this.state.favourites.indexOf(hash);if(f>-1)this.state.favourites.splice(f,1);}this._saveUserLists();this.updateModalActions();this.gallery.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();this.closeModal();} // Yuuka: notification v1.0
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
            window.Yuuka.initialPluginState.album = { character: this.state.currentModalCharacter };
            Yuuka.ui.switchTab('album');
            this.closeModal();
        });

        this.modalActions.querySelector('[data-action="favourite"]')?.addEventListener('click', this.toggleFavourite);
        this.modalActions.querySelector('[data-action="blacklist"]')?.addEventListener('click', this.toggleBlacklist);
    }
}

window.Yuuka.components['CoreComponent'] = CoreComponent;