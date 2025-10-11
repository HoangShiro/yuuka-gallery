// --- MODIFIED FILE: static/script.js ---

// YUUKA: KHỞI TẠO NAMESPACE TOÀN CỤC NGAY LẬP TỨC
window.Yuuka = {
    components: {}, // Nơi các plugin sẽ khai báo component của chúng
    services: {}, // YUUKA: Nơi chứa các instance của plugin dạng công cụ (singleton)
    initialPluginState: {}, // Kênh giao tiếp để truyền dữ liệu khi chuyển tab
    
    // YUUKA: EVENT BUS - NÂNG CẤP VỚI PHƯƠNG THỨC `off`
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

        /**
         * YUUKA: HÀM MỚI ĐỂ HIỂN THỊ MODAL XÁC NHẬN
         * @param {string} message - Nội dung cần xác nhận.
         * @returns {Promise<boolean>} - Trả về true nếu người dùng nhấn OK, false nếu nhấn Cancel.
         */
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
                            <button class="btn-cancel" title="Hủy"><span class="material-symbols-outlined">close</span></button>
                            <button class="btn-confirm" title="Xác nhận"><span class="material-symbols-outlined">check</span></button>
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

        /**
         * YUUKA: SERVICE MỚI ĐỂ MỞ MODAL CẤU HÌNH
         * @param {object} options
         * @param {string} options.title - Tiêu đề của modal.
         * @param {function} options.fetchInfo - Hàm async để lấy thông tin cấu hình và các lựa chọn. Phải trả về { last_config, global_choices }.
         * @param {function} options.onSave - Hàm async được gọi khi lưu, nhận vào (updatedConfig).
         * @param {Map} [options.promptClipboard] - (Tùy chọn) Clipboard nội bộ cho prompt.
         * @returns {Promise<void>}
         */
        async openSettingsModal(options) {
            const modal = document.createElement('div');
            modal.className = 'modal-backdrop settings-modal-backdrop';
            document.body.appendChild(modal);
            modal.innerHTML = `<div class="modal-dialog"><h3>Đang tải...</h3></div>`;
            const close = () => modal.remove();
            // Yuuka: comfyui fetch optimization v1.0 - Xóa event listener đóng modal khi click ra ngoài

            try {
                const { last_config, global_choices } = await options.fetchInfo();
                const tagPredictions = await api.getTags().catch(() => []);

                const dialog = modal.querySelector('.modal-dialog');
                const ct = (k,l,v)=>`<div class="form-group"><label for="cfg-${k}">${l}</label><textarea id="cfg-${k}" name="${k}" rows="1">${v||''}</textarea></div>`;
                const cs = (k,l,v,min,max,step)=>`<div class="form-group form-group-slider"><label for="cfg-${k}">${l}: <span id="val-${k}">${v}</span></label><input type="range" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${k}').textContent = this.value"></div>`;
                const cse = (k,l,v,o)=>`<div class="form-group"><label for="cfg-${k}">${l}</label><select id="cfg-${k}" name="${k}">${o.map(opt=>`<option value="${opt.value}" ${opt.value==v?'selected':''}>${opt.name}</option>`).join('')}</select></div>`;
                const cti = (k,l,v)=>`<div class="form-group"><label for="cfg-${k}">${l}</label><input type="text" id="cfg-${k}" name="${k}" value="${v||''}"></div>`;
                const ciwb = (k,l,v)=>`<div class="form-group"><label for="cfg-${k}">${l}</label><div class="input-with-button"><input type="text" id="cfg-${k}" name="${k}" value="${v||''}"><button type="button" class="connect-btn">Connect</button></div></div>`;
                
                dialog.innerHTML = `<h3>${options.title}</h3><div class="settings-form-container"><form id="core-settings-form">${ct('character','Character',last_config.character)}${ct('outfits','Outfits',last_config.outfits)}${ct('expression','Expression',last_config.expression)}${ct('action','Action',last_config.action)}${ct('context','Context',last_config.context)}${ct('quality','Quality',last_config.quality)}${ct('negative','Negative',last_config.negative)}${cti('lora_name','LoRA Name',last_config.lora_name)}${cs('steps','Steps',last_config.steps,10,50,1)}${cs('cfg','CFG',last_config.cfg,1.0,7.0,0.1)}${cse('size','W x H',`${last_config.width}x${last_config.height}`,global_choices.sizes)}${cse('sampler_name','Sampler',last_config.sampler_name,global_choices.samplers)}${cse('scheduler','Scheduler',last_config.scheduler,global_choices.schedulers)}${cse('ckpt_name','Checkpoint',last_config.ckpt_name,global_choices.checkpoints)}${ciwb('server_address','Server Address',last_config.server_address)}</form></div><div class="modal-actions"><button type="button" class="btn-paste" title="Dán"><span class="material-symbols-outlined">content_paste</span></button><button type="button" class="btn-copy" title="Copy"><span class="material-symbols-outlined">content_copy</span></button><button type="button" class="btn-cancel" title="Hủy"><span class="material-symbols-outlined">close</span></button><button type="submit" class="btn-save" title="Lưu" form="core-settings-form"><span class="material-symbols-outlined">save</span></button></div>`;

                const form = dialog.querySelector('form');
                
                // --- Logic autocomplete, copy, paste, etc. (đã được tối ưu hóa)
                this._initTagAutocomplete(dialog, tagPredictions);
                dialog.querySelectorAll('textarea').forEach(t=>{const a=()=>{t.style.height='auto';t.style.height=`${t.scrollHeight}px`;};t.addEventListener('input',a);setTimeout(a,0);});
                dialog.querySelector('.btn-cancel').addEventListener('click', close);
                dialog.querySelector('.btn-copy').addEventListener('click',()=>{const p=['outfits','expression','action','context','quality','negative'];options.promptClipboard=new Map(p.map(k=>[k,form.elements[k]?form.elements[k].value.trim():'']));showError("Prompt đã sao chép.");});
                dialog.querySelector('.btn-paste').addEventListener('click',()=>{if(!options.promptClipboard){showError("Chưa có prompt.");return;}options.promptClipboard.forEach((v,k)=>{if(form.elements[k])form.elements[k].value=v;});dialog.querySelectorAll('textarea').forEach(t=>t.dispatchEvent(new Event('input',{bubbles:true})));showError("Đã dán prompt.");});
                
                // Yuuka: comfyui fetch optimization v1.0 - Nâng cấp logic nút Connect
                const connectBtn = dialog.querySelector('.connect-btn');
                connectBtn.addEventListener('click', async (e) => {
                    const btn = e.currentTarget;
                    const address = dialog.querySelector('[name="server_address"]').value.trim();

                    if (options.onConnect) {
                        await options.onConnect(address, btn, close);
                    } else {
                        // Logic mặc định nếu plugin không cung cấp onConnect
                        const originalText = 'Connect';
                        btn.textContent = '...';
                        btn.disabled = true;
                        try {
                            await api.server.checkComfyUIStatus(address);
                            showError("Kết nối thành công!");
                        } catch (err) {
                            showError("Kết nối thất bại.");
                        } finally {
                            btn.textContent = originalText;
                            btn.disabled = false;
                        }
                    }
                });
                
                form.addEventListener('submit', async(e) => {
                    e.preventDefault();
                    const u = {};
                    ['character','outfits','expression','action','context','quality','negative','lora_name','server_address','sampler_name','scheduler','ckpt_name'].forEach(k=>u[k]=form.elements[k].value);
                    ['steps','cfg'].forEach(k=>u[k]=parseFloat(form.elements[k].value));
                    const [w,h] = form.elements['size'].value.split('x').map(Number);
                    u.width=w; u.height=h;
                    try {
                        await options.onSave(u);
                        showError('Lưu cấu hình thành công!');
                        close();
                    } catch(err) { showError(`Lỗi khi lưu: ${err.message}`); }
                });

            } catch (e) {
                 // Yuuka: ComfyUI connection error handling v1.0
                 close(); // Đóng modal "Đang tải..."
                 let friendlyMessage = "Lỗi: Không thể tải cấu hình.";
                 if (e.message && (e.message.includes("10061") || e.message.toLowerCase().includes("connection refused"))) {
                     friendlyMessage = "Lỗi: Không thể kết nối tới ComfyUI để lấy cấu hình.";
                 } else if (e.message) {
                     friendlyMessage = `Lỗi tải cấu hình: ${e.message}`;
                 }
                 showError(friendlyMessage);
            }
        },

        _initTagAutocomplete(formContainer, tagPredictions) {
            if(!tagPredictions || tagPredictions.length === 0) return;
            formContainer.querySelectorAll('textarea, input[type="text"]').forEach(input=>{
                if(input.parentElement.classList.contains('tag-autocomplete-container')) return;
                const w=document.createElement('div'); w.className='tag-autocomplete-container'; input.parentElement.insertBefore(w,input); w.appendChild(input);
                const l=document.createElement('ul'); l.className='tag-autocomplete-list'; w.appendChild(l);
                let a=-1; const h=()=>{l.style.display='none';l.innerHTML='';a=-1;};
                input.addEventListener('input',()=>{const t=input.value,c=input.selectionStart;const b=t.substring(0,c),last=b.lastIndexOf(',');const cur=b.substring(last+1).trim();if(cur.length<1){h();return;}const s=cur.replace(/\s+/g,'_').toLowerCase();const m=tagPredictions.filter(t=>t.startsWith(s)).slice(0,7);if(m.length>0){l.innerHTML=m.map(match=>`<li class="tag-autocomplete-item" data-tag="${match}">${match.replace(/_/g,' ')}</li>`).join('');l.style.display='block';a=-1;}else{h();}});
                const apply=(s)=>{const t=input.value,c=input.selectionStart;const textB=t.substring(0,c),last=textB.lastIndexOf(',');const before=t.substring(0,last+1);const after=t.substring(c),end=after.indexOf(',')===-1?after.length:after.indexOf(',');const finalA=t.substring(c+end);const n=`${before.trim()?`${before.trim()} `:''}${s.replace(/_/g,' ')}, ${finalA.trim()}`;input.value=n.trim();const nC=`${before.trim()?`${before.trim()} `:''}${s}`.length+2;input.focus();input.setSelectionRange(nC,nC);h();input.dispatchEvent(new Event('input',{bubbles:true}));};
                l.addEventListener('mousedown',e=>{e.preventDefault();if(e.target.matches('.tag-autocomplete-item'))apply(e.target.dataset.tag);});
                input.addEventListener('keydown',e=>{const i=l.querySelectorAll('.tag-autocomplete-item');if(i.length===0)return;if(e.key==='ArrowDown'){e.preventDefault();a=(a+1)%i.length;}else if(e.key==='ArrowUp'){e.preventDefault();a=(a-1+i.length)%i.length;}else if((e.key==='Enter'||e.key==='Tab')&&a>-1){e.preventDefault();apply(i[a].dataset.tag);}else if(e.key==='Escape')h();i.forEach((item,idx)=>item.classList.toggle('active',idx===a));});
                input.addEventListener('blur',()=>setTimeout(h,150));
            });
        }
    }
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
            const data = await api.auth.generateTokenForIP(); 
            localStorage.setItem('yuuka-auth-token', data.token); 
            await startApplication(); 
        } catch (error) { 
            renderLoginForm(`Lỗi tạo token: ${error.message}`); 
        } 
    });
}

async function switchTab(tabName) {
    // Yuuka: reload on active tab click v1.0 - Gỡ bỏ điều kiện return sớm để cho phép tải lại.
    state.activeTab = tabName;

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

async function startApplication() {
    console.log("[Core] Yuuka is waking up...");
    const token = localStorage.getItem('yuuka-auth-token');
    
    const logoutMessage = sessionStorage.getItem('yuuka-logout-message');
    if (logoutMessage) {
        sessionStorage.removeItem('yuuka-logout-message');
    }

    if (token) {
        try {
            await initializeAppUI();
        } catch (error) {
            if (error.status === 401) {
                localStorage.removeItem('yuuka-auth-token');
                renderLoginForm("Token không hợp lệ. Vui lòng đăng nhập lại.");
            } else {
                showError(`Lỗi khởi tạo: ${error.message}`);
                console.error(error);
            }
        }
    } else {
        try {
            const data = await api.auth.checkTokenForIP();
            localStorage.setItem('yuuka-auth-token', data.token);
            await initializeAppUI();
        } catch (error) {
            if (error.status === 404) {
                renderLoginForm(logoutMessage || '');
            } else {
                authContainer.innerHTML = `<p class="error-msg">Lỗi kết nối server: ${error.message}</p>`;
            }
        }
    }
}

window.addEventListener('load', startApplication);