// --- MODIFIED FILE: static/script.js ---
// --- DOM Elements ---
const gallery = document.getElementById('gallery');
const albumContainer = document.getElementById('album-container');
const sceneContainer = document.getElementById('scene-container'); // NEW
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
const albumSelectorsContainer = document.getElementById('album-selectors-container');
const sceneControls = document.getElementById('scene-controls'); // NEW


// --- State Management ---
let state = {
    currentPage: 1,
    isLoading: false,
    hasMore: true,
    currentSearchQuery: '',
    activeTab: 'browse',
    debounceTimeout: null,
    syncTimeout: null,
    allCharacters: [],
    favourites: [],
    blacklist: [],
    sessionBrowseOrder: [],
    syncMode: 'local',
    tabScrollPositions: {}, 
    scrollRestorationTarget: null,
};

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
        console.log("Syncing lists to server...");
        try {
            await api.updateLocalLists({
                favourites: state.favourites,
                blacklist: state.blacklist
            });
        } catch (error) {
            console.error("Failed to sync lists with server:", error);
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
        console.error("Could not load more characters:", error);
        loader.textContent = "Lỗi khi tải dữ liệu.";
        state.hasMore = false;
    } finally {
        state.isLoading = false;
        
        if (state.hasMore) {
            loader.textContent = '';
        } else {
            const totalInGallery = gallery.getElementsByClassName('character-card').length;
            if (totalInGallery === 0) {
                 loader.textContent = "Không tìm thấy nhân vật nào.";
            } else {
                 loader.textContent = `Đã hiển thị tất cả ${totalInGallery} kết quả.`;
            }
        }

        setTimeout(() => {
            const contentFitsOnScreen = document.documentElement.scrollHeight <= document.documentElement.clientHeight;
            if ((contentFitsOnScreen || state.scrollRestorationTarget) && state.hasMore && !state.isLoading) {
                if (state.scrollRestorationTarget) {
                    console.log("Restoring scroll, loading more content...");
                } else {
                    console.log("Nội dung chưa lấp đầy màn hình, tự động tải thêm...");
                }
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
    
    if (state.activeTab !== 'album' && state.activeTab !== 'scene') { // MODIFIED
        await loadCharacters();
        observer.observe(loader);
    } else {
        loader.classList.remove('visible');
    }
}


async function switchTab(tabName) {
    if (state.activeTab === 'album' && tabName === 'album') {
        albumManager.showCharacterSelectionGrid();
        return;
    }
    // NEW: Reset scene view on re-click
    if (state.activeTab === 'scene' && tabName === 'scene') {
        sceneManager.init();
        return;
    }

    if (state.activeTab === tabName) return;

    if (state.activeTab !== 'album' && state.activeTab !== 'scene') {
        state.tabScrollPositions[state.activeTab] = window.scrollY;
    }

    state.activeTab = tabName;
    
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    customSelectTrigger.textContent = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    document.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === tabName);
    });

    // --- MODIFIED: Show/hide main containers ---
    const isGalleryTab = ['browse', 'favourite', 'blacklist'].includes(tabName);
    gallery.style.display = isGalleryTab ? 'grid' : 'none';
    albumContainer.style.display = (tabName === 'album') ? 'block' : 'none';
    sceneContainer.style.display = (tabName === 'scene') ? 'block' : 'none'; // NEW
    searchForm.style.display = isGalleryTab ? 'block' : 'none';
    albumSelectorsContainer.style.display = (tabName === 'album' && albumManager.selectedCharacter) ? 'flex' : 'none';
    sceneControls.style.display = (tabName === 'scene') ? 'flex' : 'none'; // NEW

    if (isGalleryTab) {
        backBtn.style.display = 'none';
        contextFooter.style.display = 'none';
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
            if (albumContainer.innerHTML.trim() === '') {
                albumManager.showCharacterSelectionGrid();
            } else {
                backBtn.style.display = albumManager.viewStack.length > 1 ? 'block' : 'none';
                if (albumManager.selectedCharacter) {
                    albumManager._renderSelectors();
                }
            }
        } else if (tabName === 'scene') { // NEW
            backBtn.style.display = 'none';
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

// --- Event Handlers ---
tabsContainer.addEventListener('click', (e) => {
    if (e.target.matches('.tab-btn')) switchTab(e.target.dataset.tab)
});
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
        document.querySelectorAll('.custom-select-container.open').forEach(container => {
            container.classList.remove('open');
        });
    }
});


searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = searchBox.value.trim();
    
    // Theme commands
    if (query === '/dark') {
        applyTheme('dark');
        showError('Chuyển sang Dark Mode.');
        searchBox.value = '';
        return;
    }
    if (query === '/light') {
        applyTheme('light');
        showError('Chuyển sang Light Mode.');
        searchBox.value = '';
        return;
    }

    const blacklistCommand = query.match(/^\/(blacklist|rm)\s+(.+)/);

    if (blacklistCommand) {
        const keyword = blacklistCommand[2].toLowerCase();
        const matches = state.allCharacters.filter(c => c.name.toLowerCase().includes(keyword) && !state.blacklist.includes(c.hash));
        if (matches.length > 0) {
            const hashesToAdd = matches.map(c => c.hash);
            state.blacklist.push(...hashesToAdd);
            saveData();
            state.sessionBrowseOrder = state.allCharacters.filter(char => !state.blacklist.includes(char.hash));
            for (let i = state.sessionBrowseOrder.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [state.sessionBrowseOrder[i], state.sessionBrowseOrder[j]] = [state.sessionBrowseOrder[j], state.sessionBrowseOrder[i]];
            }
            showError(`${matches.length} nhân vật đã được thêm vào blacklist.`);
            searchBox.value = '';
            state.currentSearchQuery = '';
            state.scrollRestorationTarget = null;
            await resetAndLoad();
            window.scrollTo(0, 0);
        } else {
            showError(`Không tìm thấy nhân vật nào với từ khóa: "${keyword}"`);
        }
    }
});

searchBox.addEventListener('input', () => {
    clearTimeout(state.debounceTimeout);
    state.debounceTimeout = setTimeout(async () => {
        const query = searchBox.value.trim().toLowerCase();
        if (query.startsWith('/rm') || query.startsWith('/blacklist') || query === '/dark' || query === '/light') return;
        if (state.currentSearchQuery !== query) {
            state.currentSearchQuery = query;
            state.scrollRestorationTarget = null;
            await resetAndLoad();
            window.scrollTo(0, 0);
        }
    }, 300);
});

gallery.addEventListener('click', (event) => { const card = event.target.closest('.character-card'); if (!card) return; if (event.target.matches('.name')) { copyTextToClipboard(card.dataset.name, event.target); } else if (event.target.closest('.image-container')) { openModal(card); } });

modalFavBtn.addEventListener('click',()=>{const{hash}=state.currentModalCharacter;if(state.favourites.includes(hash)){state.favourites=state.favourites.filter(h=>h!==hash)}else{state.favourites.push(hash)}saveData();updateModalButtons();if(state.activeTab==='favourite'&&!state.favourites.includes(hash)){document.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();closeModal()}});
modalBlacklistBtn.addEventListener('click',()=>{const{hash}=state.currentModalCharacter;if(state.blacklist.includes(hash)){state.blacklist=state.blacklist.filter(h=>h!==hash)}else{state.blacklist.push(hash);state.favourites=state.favourites.filter(h=>h!==hash)}saveData();updateModalButtons();document.querySelector(`.character-card[data-hash="${hash}"]`)?.remove();closeModal()});

modalAlbumBtn.addEventListener('click', () => {
    if (!state.currentModalCharacter) return;
    albumContainer.innerHTML = '';
    switchTab('album');
    albumManager.init(state.currentModalCharacter);
    closeModal();
});

modalSearchBtn.addEventListener('click', () => {
    if (!state.currentModalCharacter) return;
    const characterName = state.currentModalCharacter.name;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(characterName)}`;
    window.open(searchUrl, '_blank');
});

closeModalBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (event) => event.target === modal && closeModal());
window.addEventListener('keydown', (event) => event.key === 'Escape' && closeModal());

const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !state.isLoading && state.hasMore) {
        loadCharacters();
    }
}, { rootMargin: '400px' });

function initializeDragToScroll() {
    const body = document.body;
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
        window.scrollBy(0, -velocityY);
        velocityY *= DAMPING; 
        if (Math.abs(velocityY) > 0.5) {
            momentumID = requestAnimationFrame(momentumLoop);
        }
    }

    body.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.clientX >= document.documentElement.clientWidth) return;
        
        // MODIFIED: Added scene elements to ignore list
        const ignoredElements = 'INPUT, TEXTAREA, SELECT, BUTTON, A, .character-card, #modal, .image-viewer, #settings-modal, .custom-select-container, .fab-container, .scene-block';
        if (e.target.closest(ignoredElements)) {
            return;
        }

        if (document.documentElement.scrollHeight <= document.documentElement.clientHeight) {
            return;
        }

        isDown = true;
        body.classList.add('is-dragging');
        
        lastY = e.pageY;
        velocityY = 0;
        cancelAnimationFrame(momentumID);
        
        e.preventDefault();

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    });

    const handleMouseMove = (e) => {
        if (!isDown) return;
        e.preventDefault();
        
        const y = e.pageY;
        const deltaY = y - lastY;
        
        window.scrollBy(0, -deltaY);
        
        velocityY = deltaY;
        lastY = y;
    };

    const handleMouseUp = () => {
        if (!isDown) return;
        isDown = false;
        body.classList.remove('is-dragging');
        
        beginMomentumTracking();

        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
}


async function initialize() {
    try {
        const listData = await api.getLocalLists();

        state.syncMode = listData.sync_mode;
        document.title = `Thư viện Nhân vật (${state.syncMode.toUpperCase()})`;

        if (state.syncMode === 'lan') {
            console.log("LAN sync mode enabled. Using lists from server.");
            state.favourites = listData.favourites;
            state.blacklist = listData.blacklist;
        } else {
            console.log("Local mode enabled. Using localStorage.");
            state.favourites = Storage.getFavourites();
            state.blacklist = Storage.getBlacklist();
        }

        const charData = await api.getAllCharacters();
        state.allCharacters = charData.characters;

        let browsable = state.allCharacters.filter(char => !state.blacklist.includes(char.hash));
        for (let i = browsable.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [browsable[i], browsable[j]] = [browsable[j], browsable[i]];
        }
        state.sessionBrowseOrder = browsable;
        
        await resetAndLoad();

        initializeDragToScroll();

    } catch (error) {
        loader.textContent = "Không thể tải dữ liệu nhân vật ban đầu.";
        loader.classList.add('visible');
        showError("Lỗi nghiêm trọng: Không thể tải dữ liệu nhân vật.");
        console.error("Initialization failed:", error);
    }
}

initialize();