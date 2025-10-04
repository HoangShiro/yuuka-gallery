// --- MODIFIED FILE: static/script.js ---
// --- DOM Elements ---
const gallery = document.getElementById('gallery');
const albumContainer = document.getElementById('album-container');
const sceneContainer = document.getElementById('scene-container');
const authContainer = document.getElementById('auth-container');
const loader = document.getElementById('loader');
const searchForm = document.getElementById('search-form');
const searchBox = document.getElementById('search-box');
const tabsContainer = document.getElementById('tabs');
const modal = document.getElementById('modal');
const modalImage = document.getElementById('modal-image');
const modalCaption = document.getElementById('modal-caption');
const closeModalBtn = document.getElementById('modal-close');
const modalFavBtn = document.getElementById('modal-fav-btn');
const modalAlbumBtn = document.getElementById('modal-album-btn');
const modalBlacklistBtn = document.getElementById('modal-blacklist-btn');
const modalSearchBtn = document.getElementById('modal-search-btn');
const backBtn = document.getElementById('back-btn');
const contextFooter = document.getElementById('context-footer');
const errorPopup = document.getElementById('error-popup');
const mainTabsSelectContainer = document.getElementById('main-tabs-select');
const customSelectTrigger = document.getElementById('tabs-select-trigger');
const customSelectOptions = mainTabsSelectContainer.querySelector('.custom-select-options');
const sceneControls = document.getElementById('scene-controls');

// --- State Management ---
// Yuuka: Thay đổi initialState thành một hàm để đảm bảo luôn nhận được một object mới, sạch sẽ khi reset.
const getInitialState = () => ({
    isComfyUIAvailable: false,
    isAuthed: false,
    currentPage: 1,
    isLoading: false,
    hasMore: true,
    currentSearchQuery: '',
    activeTab: null,
    debounceTimeout: null,
    syncTimeout: null,
    allCharacters: [],
    favourites: [],
    blacklist: [],
    sessionBrowseOrder: [],
    syncMode: 'local',
    tabScrollPositions: {}, 
    scrollRestorationTarget: null,
});

let state = getInitialState();

function resetApplicationState() {
    state = getInitialState();
}


// --- Utilities ---
const Storage = {
    getFavourites: () => JSON.parse(localStorage.getItem('favouriteCharacters') || '[]'),
    saveFavourites: (hashes) => localStorage.setItem('favouriteCharacters', JSON.stringify(Array.from(new Set(hashes)))),
    getBlacklist: () => JSON.parse(localStorage.getItem('blacklistedCharacters') || '[]'),
    saveBlacklist: (hashes) => localStorage.setItem('blacklistedCharacters', JSON.stringify(Array.from(new Set(hashes)))),
};
function copyTextToClipboard(text, elementToFeedback){const originalText=elementToFeedback.textContent;navigator.clipboard.writeText(text).then(()=>{elementToFeedback.textContent='Copied!';setTimeout(()=>{elementToFeedback.textContent=originalText},1e3)}).catch(err=>{console.warn("Clipboard API failed, trying fallback:",err);const textArea=document.createElement("textarea");textArea.value=text;textArea.style.position='fixed';document.body.appendChild(textArea);textArea.focus();textArea.select();try{document.execCommand('copy');elementToFeedback.textContent='Copied!';setTimeout(()=>{elementToFeedback.textContent=originalText},1e3)}catch(e){console.error("Fallback copy failed:",e);elementToFeedback.textContent='Copy Failed!';setTimeout(()=>{elementToFeedback.textContent=originalText},1e3)}document.body.removeChild(textArea)})}

let errorTimeout;
function showError(message) {
    clearTimeout(errorTimeout);
    errorPopup.textContent = message;
    errorPopup.classList.add('show');
    errorTimeout = setTimeout(() => {
        errorPopup.classList.remove('show');
    }, 4000);
}

// --- Theme Management ---
function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark-mode');
    } else {
        document.documentElement.classList.remove('dark-mode');
    }
    localStorage.setItem('yuuka-theme', theme);
}

// --- Core Functions ---
createCharacterCard=char=>{const card=document.createElement('div');card.className='character-card';card.dataset.hash=char.hash;card.dataset.name=char.name;const imageContainer=document.createElement('div');imageContainer.className='image-container';const img=document.createElement('img');img.src=`/image/${char.hash}`;img.alt=char.name;img.loading='lazy';imageContainer.appendChild(img);const nameDiv=document.createElement('div');nameDiv.className='name';nameDiv.textContent=char.name;card.appendChild(imageContainer);card.appendChild(nameDiv);gallery.appendChild(card)}

async function syncListsToServer() {
    if (state.syncMode !== 'lan') return;
    clearTimeout(state.syncTimeout);
    state.syncTimeout = setTimeout(async () => {
        try {
            await api.updateLocalLists({
                favourites: state.favourites,
                blacklist: state.blacklist
            });
        } catch (error) {
            showError("Lỗi: không thể đồng bộ danh sách với server.");
        }
    }, 500);
}

function saveData() {
    if (state.syncMode === 'lan') {
        syncListsToServer();
    } else {
        Storage.saveFavourites(state.favourites);
        Storage.saveBlacklist(state.blacklist);
    }
}

async function loadCharacters() {
    if (state.isLoading || !state.hasMore) return;
    state.isLoading = true;
    loader.classList.add('visible');
    loader.textContent = "Đang tải thêm...";
    await new Promise(resolve => setTimeout(resolve, 20));

    try {
        let sourceList = [];
        if (state.activeTab === 'browse') {
            sourceList = state.sessionBrowseOrder.filter(char =>
                state.currentSearchQuery ? char.name.toLowerCase().includes(state.currentSearchQuery) : true
            );
        } else {
            const listSourceHashes = state.activeTab === 'favourite' ? state.favourites : state.blacklist;
            sourceList = state.allCharacters.filter(char =>
                listSourceHashes.includes(char.hash) &&
                (state.currentSearchQuery ? char.name.toLowerCase().includes(state.currentSearchQuery) : true)
            );
        }

        const totalResults = sourceList.length;
        const BATCH_SIZE = 50;
        const startIndex = (state.currentPage - 1) * BATCH_SIZE;
        const endIndex = startIndex + BATCH_SIZE;
        const charactersToRender = sourceList.slice(startIndex, endIndex);

        if (charactersToRender.length === 0 && state.currentPage === 1) {
            state.hasMore = false;
        } else {
            charactersToRender.forEach(createCharacterCard);
            if (state.scrollRestorationTarget) {
                window.scrollTo(0, state.scrollRestorationTarget);
                if (window.scrollY >= state.scrollRestorationTarget - window.innerHeight) {
                    state.scrollRestorationTarget = null; 
                }
            }
            state.currentPage++;
            state.hasMore = gallery.children.length < totalResults;
        }
    } catch (error) {
        loader.textContent = "Lỗi khi tải dữ liệu.";
        state.hasMore = false;
    } finally {
        state.isLoading = false;
        if (!state.hasMore) {
            const total = gallery.getElementsByClassName('character-card').length;
            loader.textContent = total === 0 ? "Không tìm thấy nhân vật nào." : `Đã hiển thị tất cả ${total} kết quả.`;
        } else {
            loader.textContent = '';
        }

        setTimeout(() => {
            const contentFitsOnScreen = document.documentElement.scrollHeight <= document.documentElement.clientHeight;
            if ((contentFitsOnScreen || state.scrollRestorationTarget) && state.hasMore && !state.isLoading) {
                loadCharacters();
            }
        }, 100);
    }
}

async function resetAndLoad() {
    observer.disconnect();
    gallery.innerHTML = '';
    state.currentPage = 1;
    state.hasMore = true;
    state.isLoading = false;
    loader.classList.add('visible'); 
    
    if (state.activeTab !== 'album' && state.activeTab !== 'scene') {
        await loadCharacters();
        observer.observe(loader);
    } else {
        loader.classList.remove('visible');
    }
}

async function switchTab(tabName) {
    if (!state.isAuthed) return;
    if (state.activeTab === 'album' && tabName === 'album') {
        albumManager.showCharacterSelectionGrid();
        return;
    }
    if (state.activeTab === 'scene' && tabName === 'scene') {
        sceneManager.init();
        return;
    }
    if (state.activeTab === tabName) return;

    if (state.activeTab !== 'album' && state.activeTab !== 'scene' && state.activeTab !== null) {
        state.tabScrollPositions[state.activeTab] = window.scrollY;
    }
    state.activeTab = tabName;
    
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    customSelectTrigger.textContent = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    document.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.toggle('selected', opt.dataset.value === tabName));

    const isGalleryTab = ['browse', 'favourite', 'blacklist'].includes(tabName);
    gallery.style.display = isGalleryTab ? 'grid' : 'none';
    albumContainer.style.display = (tabName === 'album') ? 'block' : 'none';
    sceneContainer.style.display = (tabName === 'scene') ? 'block' : 'none';
    searchForm.style.display = isGalleryTab ? 'block' : 'none';
    sceneControls.style.display = (tabName === 'scene') ? 'flex' : 'none';
    backBtn.style.display = 'none';
    contextFooter.style.display = 'none';

    if (isGalleryTab) {
        searchBox.placeholder = `Tìm trong tab ${tabName}...`;
        if (tabName === 'browse') searchBox.placeholder = 'Tìm kiếm hoặc gõ /rm <từ khóa>';
        state.scrollRestorationTarget = state.tabScrollPositions[tabName] || 0;
        await resetAndLoad();
    } else {
        observer.disconnect();
        loader.classList.remove('visible');
        loader.textContent = '';
        state.scrollRestorationTarget = null;
        
        if (tabName === 'album') {
            albumManager.init();
        } else if (tabName === 'scene') {
            sceneManager.init();
        }
    }
}

// --- Modal Logic ---
openModal=characterCard=>{state.currentModalCharacter={hash:characterCard.dataset.hash,name:characterCard.dataset.name};modalImage.src=characterCard.querySelector('img').src;modalCaption.textContent=state.currentModalCharacter.name;updateModalButtons();modal.style.display='flex'};
updateModalButtons=()=>{
    if(!state.currentModalCharacter) return;
    const isFavourited=state.favourites.includes(state.currentModalCharacter.hash);
    const isBlacklisted=state.blacklist.includes(state.currentModalCharacter.hash);
    modalFavBtn.textContent = '❤️';
    modalBlacklistBtn.textContent = '➖';
    modalFavBtn.classList.toggle('is-favourited', isFavourited);
    modalBlacklistBtn.classList.toggle('is-blacklisted', isBlacklisted);
    modalFavBtn.disabled = state.activeTab === 'blacklist';
    modalBlacklistBtn.style.display = state.activeTab === 'favourite' ? 'none' : 'inline-flex';
};
closeModal=()=>{modal.style.display='none';state.currentModalCharacter=null};

// --- Auth Logic ---
function renderLoginForm(message = '') {
    document.body.classList.remove('is-logged-in');
    document.body.classList.add('is-logged-out');
    authContainer.innerHTML = `
        <div class="api-key-form">
            <h3>Xác thực</h3>
            <p>Nhập Token của bạn hoặc tạo một Token mới để tiếp tục.</p>
            ${message ? `<p class="error-msg">${message}</p>` : ''}
            <form id="auth-form">
                <input type="text" id="auth-token-input" placeholder="Nhập Token tại đây">
                <button type="submit">Đăng nhập</button>
                <button type="button" id="generate-token-btn">Tạo Token Mới</button>
            </form>
        </div>
    `;

    document.getElementById('auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('auth-token-input').value.trim();
        if (token) {
            localStorage.setItem('yuuka-auth-token', token);
            await initializeApp();
        }
    });

    document.getElementById('generate-token-btn').addEventListener('click', async () => {
        try {
            const data = await api.generateTokenForIP();
            localStorage.setItem('yuuka-auth-token', data.token);
            await initializeApp();
        } catch (error) {
            renderLoginForm(`Lỗi tạo token: ${error.message}`);
        }
    });
}

async function handleAuth() {
    let token = localStorage.getItem('yuuka-auth-token');
    if (token) {
        await initializeApp();
        return;
    }
    
    try {
        // Check if server already has a token for this IP
        const data = await api.checkTokenForIP();
        localStorage.setItem('yuuka-auth-token', data.token);
        await initializeApp();
    } catch (error) {
        if (error.status === 404) {
            renderLoginForm(); // No token found for IP, show login form.
        } else {
            authContainer.innerHTML = `<div class="error-msg">Lỗi kết nối server: ${error.message}</div>`;
        }
    }
}

async function checkComfyUI() {
    try {
        await api.checkComfyUIStatus('127.0.0.1:8888'); // Hardcoded for now, can be dynamic later
        state.isComfyUIAvailable = true;
        showError("ComfyUI đã kết nối. Các tính năng tạo ảnh đã được bật.");
    } catch (e) {
        state.isComfyUIAvailable = false;
        showError("Không thể kết nối tới ComfyUI. Chức năng tạo ảnh bị vô hiệu hóa.");
    }
}

// --- Event Handlers ---
tabsContainer.addEventListener('click', (e) => e.target.matches('.tab-btn') && switchTab(e.target.dataset.tab));
backBtn.addEventListener('click', () => albumManager.goBack());

customSelectTrigger.addEventListener('click', () => mainTabsSelectContainer.classList.toggle('open'));
customSelectOptions.addEventListener('click', (e) => {
    if (e.target.matches('.custom-select-option')) {
        switchTab(e.target.dataset.value);
        mainTabsSelectContainer.classList.remove('open');
    }
});
window.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-container')) {
        document.querySelectorAll('.custom-select-container.open').forEach(c => c.classList.remove('open'));
    }
});

searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = searchBox.value.trim();
    
    if (query.startsWith('BL-')) {
        try {
            const base64Part = query.substring(3);
            const decodedHashes = JSON.parse(atob(base64Part));
            if (Array.isArray(decodedHashes)) {
                const currentBlacklist = new Set(state.blacklist);
                let addedCount = 0;
                decodedHashes.forEach(hash => {
                    if (!currentBlacklist.has(hash)) {
                        currentBlacklist.add(hash);
                        addedCount++;
                    }
                });
                state.blacklist = Array.from(currentBlacklist);
                saveData();
                await resetAndLoad();
                showError(`Đã thêm ${addedCount} nhân vật mới vào blacklist.`);
            } else {
                throw new Error("Invalid code format.");
            }
        } catch (err) {
            showError("Mã chia sẻ blacklist không hợp lệ.");
        }
        searchBox.value = '';
        return;
    }

    if (query === '/dark') { applyTheme('dark'); showError('Chuyển sang Dark Mode.'); searchBox.value = ''; return; }
    if (query === '/light') { applyTheme('light'); showError('Chuyển sang Light Mode.'); searchBox.value = ''; return; }
    if (query === '/token') {
        const token = localStorage.getItem('yuuka-auth-token');
        if (token) {
            navigator.clipboard.writeText(token).then(() => showError('Login token đã được sao chép vào clipboard.'));
        } else {
            showError('Không tìm thấy login token.');
        }
        searchBox.value = '';
        return;
    }
    if (query === '/logout') {
        const token = localStorage.getItem('yuuka-auth-token');
        
        observer.disconnect();
        
        // Clear content
        gallery.innerHTML = '';
        albumContainer.innerHTML = '';
        sceneContainer.innerHTML = '';
        searchBox.value = '';

        // Reset state and local storage
        resetApplicationState();
        localStorage.removeItem('yuuka-auth-token');
        
        // Prepare logout message
        let logoutMessage = 'Bạn đã đăng xuất.';
        if (token) {
             logoutMessage = 'Đã đăng xuất. Token của bạn (nếu có) đã được thử sao chép vào clipboard.';
        }
        
        // Render login form which also handles body classes
        renderLoginForm(logoutMessage);

        if (token) {
            navigator.clipboard.writeText(token).catch(err => console.log("Clipboard copy failed after logout."));
        }

        return;
    }

    const loginMatch = query.match(/^\/login\s+(.+)/);
    if (loginMatch) {
        const ip = loginMatch[1];
        try {
            await api.shareTokenWithIP(ip);
            showError(`Token đã được chia sẻ thành công cho IP: ${ip}`);
        } catch(error) {
            showError(`Lỗi chia sẻ token: ${error.message}`);
        }
        searchBox.value = '';
        return;
    }

    const blacklistShareMatch = query.match(/^\/blacklist\s+share$/);
    if (blacklistShareMatch) {
        const shareCode = 'BL-' + btoa(JSON.stringify(state.blacklist));
        navigator.clipboard.writeText(shareCode).then(() => showError('Mã chia sẻ blacklist đã được sao chép vào clipboard.'));
        searchBox.value = '';
        return;
    }

    const blacklistCommand = query.match(/^\/(blacklist|rm)\s+(.+)/);
    if (blacklistCommand) {
        const keyword = blacklistCommand[2].toLowerCase();
        const matches = state.allCharacters.filter(c => c.name.toLowerCase().includes(keyword) && !state.blacklist.includes(c.hash));
        if (matches.length > 0) {
            const hashes = matches.map(c => c.hash);
            state.blacklist.push(...hashes);
            saveData();
            state.sessionBrowseOrder = state.allCharacters.filter(char => !state.blacklist.includes(char.hash));
            // Re-shuffle
            for (let i = state.sessionBrowseOrder.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [state.sessionBrowseOrder[i], state.sessionBrowseOrder[j]] = [state.sessionBrowseOrder[j], state.sessionBrowseOrder[i]];
            }
            showError(`${matches.length} nhân vật đã được thêm vào blacklist.`);
            searchBox.value = ''; state.currentSearchQuery = ''; state.scrollRestorationTarget = null;
            await resetAndLoad(); window.scrollTo(0, 0);
        } else { showError(`Không tìm thấy nhân vật nào với từ khóa: "${keyword}"`); }
        return;
    }
});

searchBox.addEventListener('input', () => {
    clearTimeout(state.debounceTimeout);
    state.debounceTimeout = setTimeout(async () => {
        const query = searchBox.value.trim().toLowerCase();
        if (query.startsWith('/') || state.currentSearchQuery === query) return;
        state.currentSearchQuery = query;
        state.scrollRestorationTarget = null;
        await resetAndLoad();
        window.scrollTo(0, 0);
    }, 300);
});

gallery.addEventListener('click', (e) => { const c = e.target.closest('.character-card'); if (c) { if (e.target.matches('.name')) copyTextToClipboard(c.dataset.name, e.target); else if (e.target.closest('.image-container')) openModal(c); }});
modalFavBtn.addEventListener('click',()=>{const{hash}=state.currentModalCharacter;if(state.favourites.includes(hash)){state.favourites=state.favourites.filter(h=>h!==hash)}else{state.favourites.push(hash)}saveData();updateModalButtons();if(state.activeTab==='favourite'&&!state.favourites.includes(hash)){document.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();closeModal()}});
modalBlacklistBtn.addEventListener('click',()=>{const{hash}=state.currentModalCharacter;if(state.blacklist.includes(hash)){state.blacklist=state.blacklist.filter(h=>h!==hash)}else{state.blacklist.push(hash);state.favourites=state.favourites.filter(h=>h!==hash)}saveData();updateModalButtons();document.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();closeModal()});
modalAlbumBtn.addEventListener('click', () => { if (state.currentModalCharacter) { switchTab('album'); albumManager.init(state.currentModalCharacter); closeModal(); }});
modalSearchBtn.addEventListener('click', () => { if (state.currentModalCharacter) window.open(`https://www.google.com/search?q=${encodeURIComponent(state.currentModalCharacter.name)}`, '_blank') });
closeModalBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => e.target === modal && closeModal());
window.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

const observer = new IntersectionObserver((entries) => {
    if (entries[0] && entries[0].isIntersecting && !state.isLoading && state.hasMore) {
        loadCharacters();
    }
}, { rootMargin: '400px' });

function initializeDragToScroll() {
    const body = document.body;
    let isDown = false, lastY, velocityY = 0, momentumID;
    const DAMPING = 0.95;
    function beginMomentumTracking() { cancelAnimationFrame(momentumID); momentumID = requestAnimationFrame(momentumLoop); }
    function momentumLoop() { window.scrollBy(0, -velocityY); velocityY *= DAMPING; if (Math.abs(velocityY) > 0.5) momentumID = requestAnimationFrame(momentumLoop); }
    body.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.clientX >= document.documentElement.clientWidth) return;
        const ignored = 'INPUT, TEXTAREA, SELECT, BUTTON, A, .character-card, #modal, .image-viewer, #settings-modal, .custom-select-container, .fab-container, .scene-block';
        if (e.target.closest(ignored) || document.documentElement.scrollHeight <= document.documentElement.clientHeight) return;
        isDown = true; body.classList.add('is-dragging'); lastY = e.pageY; velocityY = 0; cancelAnimationFrame(momentumID); e.preventDefault();
        window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    });
    const handleMouseMove = (e) => { if (isDown) { e.preventDefault(); const y = e.pageY; const deltaY = y - lastY; window.scrollBy(0, -deltaY); velocityY = deltaY; lastY = y; }};
    const handleMouseUp = () => { if (isDown) { isDown = false; body.classList.remove('is-dragging'); beginMomentumTracking(); window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); }};
}

async function initializeApp() {
    document.body.classList.remove('is-logged-out');
    document.body.classList.add('is-logged-in');
    
    try {
        const listData = await api.getLocalLists();
        state.isAuthed = true;
        state.syncMode = listData.sync_mode;
        document.title = `Thư viện Nhân vật (${state.syncMode.toUpperCase()})`;
        state.favourites = listData.sync_mode === 'lan' ? listData.favourites : Storage.getFavourites();
        state.blacklist = listData.sync_mode === 'lan' ? listData.blacklist : Storage.getBlacklist();

        const charData = await api.getAllCharacters();
        state.allCharacters = charData.characters;

        let browsable = state.allCharacters.filter(char => !state.blacklist.includes(char.hash));
        for (let i = browsable.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [browsable[i], browsable[j]] = [browsable[j], browsable[i]];
        }
        state.sessionBrowseOrder = browsable;
        
        switchTab('browse'); 
        
        initializeDragToScroll();
        checkComfyUI();
    } catch (error) {
        if (error.status === 401) {
            localStorage.removeItem('yuuka-auth-token');
            state.isAuthed = false;
            resetApplicationState();
            renderLoginForm("Token không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.");
        } else {
            authContainer.innerHTML = `<div class="error-msg">Lỗi tải dữ liệu: ${error.message}</div>`;
            showError("Lỗi nghiêm trọng: Không thể tải dữ liệu nhân vật.");
        }
    }
}

handleAuth();