// --- MODIFIED FILE: static/script.js ---

// YUUKA: KHỞI TẠO NAMESPACE TOÀN CỤC NGAY LẬP TỨC
window.Yuuka = {
    components: {}, // Nơi các plugin sẽ khai báo component của chúng
    services: {}, // YUUKA: Nơi chứa các instance của plugin dạng công cụ (singleton)
    initialPluginState: {}, // Kênh giao tiếp để truyền dữ liệu khi chuyển tab
    pluginState: {}, // Yuuka: Không gian state cho các plugin
    
    // YUUKA: EVENT BUS - NÂNG CẤP VỚI PHƯƠ-NG THỨC `off`
    events: {
        _listeners: {},
        on(eventName, callback) {
            if (!this._listeners[eventName]) {
                this._listeners[eventName] = [];
            }
            this._listeners[eventName].push(callback);
        },
        off(eventName, callback) {
            if (this._listeners[eventName]) {
                this._listeners[eventName] = this._listeners[eventName].filter(
                    listener => listener !== callback
                );
            }
        },
        emit(eventName, data) {
            if (this._listeners[eventName]) {
                this._listeners[eventName].forEach(callback => {
                    try {
                        callback(data);
                    } catch (e) {
                        console.error(`[EventBus] Error in '${eventName}' listener:`, e);
                    }
                });
            }
        },
    },

    // YUUKA: UI SERVICE LÕI GIỜ CHỈ CÒN CÁC HÀM TIỆN ÍCH CHUNG
    ui: {
        switchTab(tabId) {
            switchTab(tabId);
        },

        confirm(message) {
            return new Promise(resolve => {
                if (document.querySelector('.confirm-modal-backdrop')) {
                    resolve(false);
                    return;
                }

                const modal = document.createElement('div');
                modal.className = 'confirm-modal-backdrop modal-backdrop';
                modal.innerHTML = `
                    <div class="confirm-modal-dialog">
                        <p>${message}</p>
                        <div class="modal-actions">
                            <button class="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                            <button class="btn-confirm" title="Confirm"><span class="material-symbols-outlined">check</span></button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                const cleanupAndResolve = (value) => {
                    modal.remove();
                    window.removeEventListener('keydown', keydownHandler);
                    resolve(value);
                };

                const keydownHandler = (e) => {
                    if (e.key === 'Escape') cleanupAndResolve(false);
                    if (e.key === 'Enter') cleanupAndResolve(true);
                };

                modal.querySelector('.btn-confirm').onclick = () => cleanupAndResolve(true);
                modal.querySelector('.btn-cancel').onclick = () => cleanupAndResolve(false);
                modal.addEventListener('click', e => { if (e.target === modal) cleanupAndResolve(false); });
                window.addEventListener('keydown', keydownHandler);
                modal.querySelector('.btn-confirm').focus();
            });
        },

        copyToClipboard(text) {
            return new Promise((resolve, reject) => {
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(text).then(resolve).catch(reject);
                } else {
                    const textArea = document.createElement('textarea');
                    textArea.value = text;
                    textArea.style.position = 'fixed';
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
        },

        _initTagAutocomplete(formContainer, tagPredictions) {
            if (!tagPredictions || tagPredictions.length === 0) return;
            formContainer.querySelectorAll('textarea, input[type="text"]').forEach(input => {
                if (input.parentElement.classList.contains('tag-autocomplete-container')) return;
                const wrapper = document.createElement('div');
                wrapper.className = 'tag-autocomplete-container';
                input.parentElement.insertBefore(wrapper, input);
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
                    const textValue = input.value;
                    const cursor = input.selectionStart;
                    const beforeCursor = textValue.substring(0, cursor);
                    const lastComma = beforeCursor.lastIndexOf(',');
                    const currentToken = beforeCursor.substring(lastComma + 1).trim();
                    if (currentToken.length < 1) {
                        hideList();
                        return;
                    }
                    const searchToken = currentToken.replace(/\s+/g, '_').toLowerCase();
                    const matches = tagPredictions.filter(tag => tag.startsWith(searchToken)).slice(0, 7);
                    if (matches.length > 0) {
                        list.innerHTML = matches.map(match => `
                            <li class="tag-autocomplete-item" data-tag="${match}">${match.replace(/_/g, ' ')}</li>
                        `).join('');
                        list.style.display = 'block';
                        activeIndex = -1;
                    } else {
                        hideList();
                    }
                });

                const applyTag = (tag) => {
                    const textValue = input.value;
                    const cursor = input.selectionStart;
                    const beforeCursor = textValue.substring(0, cursor);
                    const lastComma = beforeCursor.lastIndexOf(',');
                    const before = textValue.substring(0, lastComma + 1);
                    const after = textValue.substring(cursor);
                    const nextComma = after.indexOf(',');
                    const remaining = nextComma == -1 ? '' : after.substring(nextComma);
                    const result = `${before.trim() ? `${before.trim()} ` : ''}${tag.replace(/_/g, ' ')}, ${remaining.trim()}`.trim();
                    input.value = result;
                    const newCursor = (`${before.trim() ? `${before.trim()} ` : ''}${tag}`).length + 2;
                    input.focus();
                    input.setSelectionRange(newCursor, newCursor);
                    hideList();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };

                list.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    if (event.target.matches('.tag-autocomplete-item')) {
                        applyTag(event.target.dataset.tag);
                    }
                });

                input.addEventListener('keydown', (event) => {
                    const items = list.querySelectorAll('.tag-autocomplete-item');
                    if (items.length === 0) return;
                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        activeIndex = (activeIndex + 1) % items.length;
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        activeIndex = (activeIndex - 1 + items.length) % items.length;
                    } else if ((event.key === 'Enter' || event.key === 'Tab') && activeIndex > -1) {
                        event.preventDefault();
                        applyTag(items[activeIndex].dataset.tag);
                    } else if (event.key === 'Escape') {
                        hideList();
                    }
                    items.forEach((item, idx) => item.classList.toggle('active', idx === activeIndex));
                });

                input.addEventListener('blur', () => setTimeout(hideList, 150));
            });
        }
    },
};
// --- DOM Elements ---
const tabsContainer = document.getElementById('tabs');
const mainContainer = document.querySelector('.container');
const authContainer = document.getElementById('auth-container');
const errorPopup = document.getElementById('error-popup');

// --- State Management ---
const state = {
    isAuthed: false,
    activeTab: null,
    activePlugins: [],
    currentPluginInstance: null,
    // YUUKA: Trạng thái cho Service mới
    generationStatus: {
        interval: null,
        knownTasks: new Set(),
    },
};

// --- Core Logic ---
let errorTimeout;
function showError(message) {
    clearTimeout(errorTimeout);
    errorPopup.textContent = message;
    errorPopup.classList.add('show');
    errorTimeout = setTimeout(() => { errorPopup.classList.remove('show'); }, 4000);
}

function renderLoginForm(message = '') {
    document.body.className = 'is-logged-out';
    authContainer.innerHTML = `<div class="auth-form-wrapper"><h3>Xác thực</h3><p>Nhập Token của bạn hoặc tạo một Token mới để tiếp tục.</p>${message ? `<p class="error-msg">${message}</p>` : ''}<form id="auth-form"><input type="text" id="auth-token-input" placeholder="Nhập Token tại đây" autocomplete="off"><button type="submit">Đăng nhập</button><button type="button" id="generate-token-btn">Tạo Token Mới</button></form></div>`;
    
    document.getElementById('auth-form').addEventListener('submit', async (e) => { 
        e.preventDefault(); 
        const token = document.getElementById('auth-token-input').value.trim(); 
        if (!token) return;
        try {
            await api.auth.login(token);
            localStorage.setItem('yuuka-auth-token', token); 
            await startApplication();
        } catch (error) {
             renderLoginForm(`Token không hợp lệ hoặc đã xảy ra lỗi.`);
        }
    });

    document.getElementById('generate-token-btn').addEventListener('click', async () => { 
        try { 
            const data = await api.auth.generateToken(); 
            localStorage.setItem('yuuka-auth-token', data.token);
            
            // Yuuka: auth rework v1.1 - Tự động sao chép token mới
            try {
                await Yuuka.ui.copyToClipboard(data.token);
                showError("Token mới đã được tạo và sao chép!");
            } catch (copyError) {
                console.error("Failed to copy token:", copyError);
                showError("Đã tạo token mới (không thể tự sao chép).");
            }
            
            await startApplication(); 
        } catch (error) { 
            renderLoginForm(`Lỗi tạo token: ${error.message}`); 
        } 
    });
}

async function switchTab(tabName) {
    // Yuuka: reload on active tab click v1.0 - Gỡ bỏ điều kiện return sớm để cho phép tải lại.
    state.activeTab = tabName;

    // Yuuka: scroll restoration fix v1.0 - Cuộn lên đầu trang
    window.scrollTo(0, 0);

    if (state.currentPluginInstance && typeof state.currentPluginInstance.destroy === 'function') {
        state.currentPluginInstance.destroy();
        state.currentPluginInstance = null;
    }

    document.querySelectorAll('.plugin-container').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));

    const pluginInfo = state.activePlugins.find(p => p.ui?.tab?.id === tabName);

    if (pluginInfo) {
        const componentName = pluginInfo.entry_points.frontend_component;
        const ComponentClass = window.Yuuka.components[componentName];

        if (ComponentClass) {
            const container = document.querySelector(`.plugin-container[data-plugin-id="${pluginInfo.id}"]`);
            if (container) {
                container.style.display = 'block';
                state.currentPluginInstance = new ComponentClass(container, api, state.activePlugins);
                if (typeof state.currentPluginInstance.init === 'function') {
                    await state.currentPluginInstance.init();
                }
            }
        } else {
            showError(`Lỗi: Component '${componentName}' chưa được tải.`);
        }
    }
}

// YUUKA: GLOBAL GENERATION STATUS POLLER
async function checkGlobalGenerationStatus() {
    try {
        const status = await api.generation.getStatus();
        // YUUKA'S FIX: Lấy keys từ `status.tasks` thay vì `status`
        const serverTaskIds = new Set(Object.keys(status.tasks || {}));

        // Yuuka: ComfyUI connection error handling v1.0
        Object.values(status.tasks || {}).forEach(task => {
            if (!task.is_running && task.error_message && state.generationStatus.knownTasks.has(task.task_id)) {
                let friendlyMessage = "Tạo ảnh thất bại. Lỗi không xác định.";
                const rawError = task.error_message.startsWith('Lỗi: ') ? task.error_message.substring(5) : task.error_message;

                if (rawError.includes("10061") || rawError.toLowerCase().includes("connection refused")) {
                    friendlyMessage = "Lỗi tạo ảnh: Không thể kết nối tới ComfyUI.";
                } else {
                    friendlyMessage = `Tạo ảnh thất bại: ${rawError.substring(0, 100)}${rawError.length > 100 ? '...' : ''}`;
                }
                showError(friendlyMessage);
                // The task will be removed from knownTasks by the logic below, preventing repeated errors.
            }
        });

        // Event cho các task mới bắt đầu
        serverTaskIds.forEach(taskId => {
            if (!state.generationStatus.knownTasks.has(taskId)) {
                state.generationStatus.knownTasks.add(taskId);
                Yuuka.events.emit('generation:started', status.tasks[taskId]);
            }
        });

        // Event cho các task đã hoàn thành hoặc lỗi
        state.generationStatus.knownTasks.forEach(taskId => {
            if (!serverTaskIds.has(taskId)) {
                // Task này đã kết thúc, nhưng chúng ta không có data cuối cùng ở đây.
                // Plugin sẽ tự dọn dẹp placeholder khi nhận được `image:added` hoặc lỗi
                state.generationStatus.knownTasks.delete(taskId);
                Yuuka.events.emit('generation:task_ended', { taskId });
            }
        });

        // Phát event update cho tất cả các task đang chạy
        Yuuka.events.emit('generation:update', status.tasks || {});

        // Xử lý các sự kiện từ backend
        if (status.events && status.events.length > 0) {
            status.events.forEach(event => {
                const { type, data } = event;
                switch(type) {
                    case 'IMAGE_SAVED':
                        Yuuka.events.emit('image:added', data); // Gửi toàn bộ data
                        break;
                    case 'IMAGE_DELETED': // Yuuka: event bus v1.0
                        Yuuka.events.emit('image:deleted', data);
                        break;
                    // Các event khác có thể được thêm vào đây
                }
            });
        }

        // Tự động dừng polling nếu không có task nào
        if (serverTaskIds.size === 0 && state.generationStatus.interval) {
            clearInterval(state.generationStatus.interval);
            state.generationStatus.interval = null;
            state.generationStatus.knownTasks.clear();
             console.log('[Core Poller] No active tasks. Stopping status polling.');
        }

    } catch (error) {
        console.error("[Core Poller] Error checking generation status:", error);
        if (error.status === 401) { // Nếu token hết hạn, dừng polling
            clearInterval(state.generationStatus.interval);
            state.generationStatus.interval = null;
        }
    }
}

function startGlobalPolling() {
    if (state.generationStatus.interval) return;
    console.log('[Core Poller] Starting global generation status polling...');
    state.generationStatus.interval = setInterval(checkGlobalGenerationStatus, 1500);
}


async function initializeAppUI() {
    console.log("[Core] Authentication successful. Initializing UI...");
    document.body.className = 'is-logged-in';
    authContainer.innerHTML = '';
    
    const activePluginsUI = await api.getActivePluginsUI();
    state.activePlugins = activePluginsUI;
    if (state.activePlugins.length === 0) { showError("Lỗi: Không có plugin nào được tải."); return; }

    // YUUKA: Bắt đầu polling nếu có bất kỳ plugin nào yêu cầu thông qua cờ trong manifest.
    if (activePluginsUI.some(p => p.ui?.needs_generation_poller)) { // Yuuka: architecture-fix v1.0
       await checkGlobalGenerationStatus(); // Chạy lần đầu ngay lập tức
       startGlobalPolling(); 
    }
    // Lắng nghe event để bắt đầu polling nếu một task mới được tạo ra
    Yuuka.events.on('generation:started', startGlobalPolling);
    // Yuuka: Lắng nghe event từ API call để chủ động bắt đầu polling // Yuuka: polling trigger v1.0
    Yuuka.events.on('generation:task_created_locally', startGlobalPolling);


    tabsContainer.innerHTML = '';
    activePluginsUI.forEach(plugin => {
        api.createPluginApiClient(plugin.id);
        
        const componentName = plugin.entry_points.frontend_component;
        const ComponentClass = window.Yuuka.components[componentName];

        if (ComponentClass) {
            // Yuuka: service launcher fix v1.0 - Thay đổi thứ tự logic
            if (plugin.ui?.is_singleton) {
                console.log(`[Core] Initializing singleton UI plugin: ${plugin.id}`);
                const serviceInstance = new ComponentClass(null, api, activePluginsUI);
                window.Yuuka.services[plugin.id] = serviceInstance;
            } 
            else if (plugin.ui?.tab) {
                const tabBtn = document.createElement('button');
                tabBtn.className = 'tab-btn';
                tabBtn.dataset.tab = plugin.ui.tab.id;
                tabsContainer.appendChild(tabBtn);

                if (plugin.id !== 'core') {
                     const existingContainer = document.querySelector(`.plugin-container[data-plugin-id="${plugin.id}"]`);
                    if (!existingContainer) {
                        const pluginContainer = document.createElement('div');
                        pluginContainer.id = `${plugin.id}-container`;
                        pluginContainer.className = 'plugin-container';
                        pluginContainer.dataset.pluginId = plugin.id;
                        mainContainer.appendChild(pluginContainer);
                    }
                }
            }
            else {
                 console.log(`[Core] Initializing pure JS service plugin: ${plugin.id}`);
                 const serviceInstance = new ComponentClass(null, api);
                 window.Yuuka.services[plugin.id] = serviceInstance;
            }
        }
    });
    
    const firstTab = state.activePlugins.find(p => p.ui?.tab)?.ui?.tab?.id;
    if (firstTab) {
        await switchTab(firstTab);
    } else {
        showError("Lỗi: Không tìm thấy tab nào để hiển thị.");
    }
}

// Yuuka: auth rework v1.0 - Viết lại hoàn toàn luồng khởi động
async function startApplication() {
    console.log("[Core] Yuuka is waking up...");

    // Yuuka: scroll restoration fix v1.0 - Tắt tính năng của trình duyệt
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    const token = localStorage.getItem('yuuka-auth-token');
    
    const logoutMessage = sessionStorage.getItem('yuuka-logout-message');
    if (logoutMessage) {
        sessionStorage.removeItem('yuuka-logout-message');
    }

    if (token) {
        try {
            // Thử khởi tạo UI. Các request API bên trong sẽ tự xác thực token.
            await initializeAppUI();
        } catch (error) {
            // Nếu có lỗi 401 (Unauthorized), token đã hết hạn hoặc không hợp lệ.
            if (error.status === 401) {
                localStorage.removeItem('yuuka-auth-token');
                renderLoginForm("Token không hợp lệ. Vui lòng đăng nhập lại.");
            } else {
                showError(`Lỗi khởi tạo: ${error.message}`);
                console.error(error);
            }
        }
    } else {
        // Nếu không có token trong localStorage, hiển thị form đăng nhập.
        renderLoginForm(logoutMessage || '');
    }
}

window.addEventListener('load', startApplication);
