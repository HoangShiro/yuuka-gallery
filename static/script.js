// --- MODIFIED FILE: static/script.js ---

// YUUKA: KHỞI TẠO NAMESPACE TOÀN CỤC NGAY LẬP TỨC
// Yuuka: Core namespace (auth-related UI removed; delegated to auth plugin)
window.Yuuka = window.Yuuka || {
    components: {},
    services: {},
    initialPluginState: {},
    pluginState: {},
    // Lightweight global event bus for cross-plugin communication
    events: {
        _listeners: {},
        on(eventName, callback) {
            if (!this._listeners[eventName]) this._listeners[eventName] = [];
            this._listeners[eventName].push(callback);
        },
        off(eventName, callback) {
            if (this._listeners[eventName]) this._listeners[eventName] = this._listeners[eventName].filter(l => l !== callback);
        },
        emit(eventName, data) {
            if (this._listeners[eventName]) {
                this._listeners[eventName].forEach(cb => { try { cb(data); } catch(e){ console.error(`[EventBus] Error in '${eventName}' listener:`, e); } });
            }
        }
    },
    // Global UI helpers and shared services live under `ui` / `services`
    ui: {
        switchTab(tabId){ switchTab(tabId); },
        confirm(message){
            return new Promise(resolve => {
                if (document.querySelector('.confirm-modal-backdrop')) { resolve(false); return; }
                const modal = document.createElement('div');
                modal.className = 'confirm-modal-backdrop modal-backdrop';
                modal.innerHTML = `<div class="confirm-modal-dialog"><p>${message}</p><div class="modal-actions"><button class="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button><button class="btn-confirm" title="Confirm"><span class="material-symbols-outlined">check</span></button></div></div>`;
                document.body.appendChild(modal);
                const cleanup = v => { modal.remove(); window.removeEventListener('keydown', kd); resolve(v); };
                const kd = e => { if (e.key==='Escape') cleanup(false); if (e.key==='Enter') cleanup(true); };
                modal.querySelector('.btn-confirm').onclick = () => cleanup(true);
                modal.querySelector('.btn-cancel').onclick = () => cleanup(false);
                modal.addEventListener('click', e => { if (e.target === modal) cleanup(false); });
                window.addEventListener('keydown', kd);
                modal.querySelector('.btn-confirm').focus();
            });
        },
        copyToClipboard(text){
            return new Promise((resolve, reject) => {
                if (navigator.clipboard && window.isSecureContext){ navigator.clipboard.writeText(text).then(resolve).catch(reject); return; }
                const ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.focus(); ta.select();
                try { if (document.execCommand('copy')) resolve(); else reject(new Error('Copy command was not successful')); }
                catch(err){ reject(err); }
                finally{ document.body.removeChild(ta); }
            });
        },
        _initTagAutocomplete(formContainer, tagPredictions){
            if (!tagPredictions || !tagPredictions.length) return;
            formContainer.querySelectorAll('textarea, input[type="text"]').forEach(input => {
                if (input.parentElement.classList.contains('tag-autocomplete-container')) return;
                const wrapper=document.createElement('div'); wrapper.className='tag-autocomplete-container'; input.parentElement.insertBefore(wrapper,input); wrapper.appendChild(input);
                const list=document.createElement('ul'); list.className='tag-autocomplete-list'; wrapper.appendChild(list);
                let activeIndex=-1; const hide=()=>{ list.style.display='none'; list.innerHTML=''; activeIndex=-1; };
                input.addEventListener('input', ()=>{ const textValue=input.value; const cursor=input.selectionStart; const before=textValue.substring(0,cursor); const lastComma=before.lastIndexOf(','); const current=before.substring(lastComma+1).trim(); if (current.length<1){ hide(); return; } const search=current.replace(/\s+/g,'_').toLowerCase(); const matches=tagPredictions.filter(t=>t.startsWith(search)).slice(0,7); if(matches.length){ list.innerHTML=matches.map(m=>`<li class="tag-autocomplete-item" data-tag="${m}">${m.replace(/_/g,' ')}</li>`).join(''); list.style.display='block'; activeIndex=-1; } else hide(); });
                const applyTag=tag=>{ const textValue=input.value; const cursor=input.selectionStart; const before=textValue.substring(0,cursor); const lastComma=before.lastIndexOf(','); const prefix=textValue.substring(0,lastComma+1); const after=textValue.substring(cursor); const nextComma=after.indexOf(','); const remaining=nextComma==-1?'' : after.substring(nextComma); const result=`${prefix.trim()?`${prefix.trim()} `:''}${tag.replace(/_/g,' ')}, ${remaining.trim()}`.trim(); input.value=result; const newCursor=(`${prefix.trim()?`${prefix.trim()} `:''}${tag}`).length+2; input.focus(); input.setSelectionRange(newCursor,newCursor); hide(); input.dispatchEvent(new Event('input',{ bubbles:true })); };
                list.addEventListener('mousedown', ev=>{ ev.preventDefault(); if (ev.target.matches('.tag-autocomplete-item')) applyTag(ev.target.dataset.tag); });
                input.addEventListener('keydown', ev=>{ const items=list.querySelectorAll('.tag-autocomplete-item'); if(!items.length) return; if(ev.key==='ArrowDown'){ ev.preventDefault(); activeIndex=(activeIndex+1)%items.length; } else if(ev.key==='ArrowUp'){ ev.preventDefault(); activeIndex=(activeIndex-1+items.length)%items.length; } else if((ev.key==='Enter'||ev.key==='Tab') && activeIndex>-1){ ev.preventDefault(); applyTag(items[activeIndex].dataset.tag); } else if(ev.key==='Escape'){ hide(); } items.forEach((it,idx)=>it.classList.toggle('active', idx===activeIndex)); });
                input.addEventListener('blur', ()=> setTimeout(hide,150));
            });
        }
    }
};

// --- GLOBAL CAPABILITIES SERVICE (cross-plugin registry) ---
// Provides a central place for plugins to register capabilities
// (actions, tools, etc.) that other plugins – including Maid-chan –
// can discover and invoke without tight coupling.
//
// Shape of a capability definition:
// {
//   id: string,              // unique capability id, e.g. "image.generate"
//   pluginId: string,        // owner plugin id, e.g. "album"
//   title?: string,
//   description?: string,
//   type?: string,           // e.g. "action", "query"
//   tags?: string[],
//   llmCallable?: boolean,   // if true, can be exposed as LLM function
//   llmName?: string,        // optional function name override
//   paramsSchema?: object,   // JSON-schema-like description of args
//   example?: {              // OPTIONAL: used by Maid-chan playground for default payload
//     payload?: any,         // default payload to prefill in the Payload textarea
//     notes?: string,        // short human-readable hint shown in UI / docs
//   },
//   invoke: async (args, ctx) => any
// }
//
// Recommended pattern for plugins:
// - Register capabilities EARLY at script load (in a small IIFE) so
//   they appear immediately in Maid-chan's Ability tab and any other
//   discovery UI, even before the plugin's UI/tab is opened.
// - Provide an `example.payload` whenever possible so Maid-chan's
//   playground can prefill a meaningful default payload instead of `{}`.
// - If your invoke handler needs access to a live component instance
//   (e.g. AlbumComponent), register a generic invoke first, then when
//   your component is constructed, wrap/override that invoke to bind
//   `this` to the instance (similar to AlbumComponent._attachInstanceToCapability).
// - Prefer stable ids like "pluginId.actionName" to avoid collisions.
;
(function initCapabilitiesService(){
    const g = window.Yuuka = window.Yuuka || {};
    g.services = g.services || {};
    if (g.services.capabilities) return; // already initialized

    const _registry = new Map(); // key: id, value: { def, version }
    const _byPlugin = new Map(); // pluginId -> Set<id>
    let _versionCounter = 1;
    const _bootstrapStartedAt = Date.now();

    const normalizeId = (id)=> typeof id === 'string' ? id.trim() : '';

    const capabilities = {
        register(def){
            if (!def || !def.id) {
                console.warn('[Capabilities] Missing id in definition:', def);
                return null;
            }
            const id = normalizeId(def.id);
            if (!id) {
                console.warn('[Capabilities] Invalid id:', def.id);
                return null;
            }
            if (typeof def.invoke !== 'function') {
                console.warn('[Capabilities] Capability must provide an invoke(args, ctx) function:', id);
                return null;
            }
            const pluginId = normalizeId(def.pluginId || def.owner || '');
            if (!pluginId) {
                console.warn(
                    '[Capabilities] Capability definition is missing pluginId. ' +
                    'Plugins must provide a stable pluginId when registering capabilities early.',
                    def
                );
                return null;
            }
            const version = (_registry.get(id)?.version || 0) + 1;

            // Normalize example structure so consumers (e.g. Maid-chan) can rely on
            // a consistent shape: { defaultPayload, variants: [{name, payload, notes}], notes }
            let normalizedExample;
            if (def.example && typeof def.example === 'object') {
                const raw = def.example;
                const variants = Array.isArray(raw.variants) ? raw.variants : [];
                // Backwards compatibility: allow old-style example.payload
                if (!variants.length && typeof raw.payload !== 'undefined') {
                    variants.push({ name: 'default', payload: raw.payload, notes: raw.notes || '' });
                }
                const safeVariants = variants
                    .map(v => ({
                        name: (v && v.name) ? String(v.name) : 'preset',
                        payload: v ? v.payload : undefined,
                        notes: v && v.notes ? String(v.notes) : '',
                    }))
                    .filter(v => typeof v.payload !== 'undefined');
                const defaultPayload = (typeof raw.defaultPayload !== 'undefined')
                    ? raw.defaultPayload
                    : (safeVariants[0] ? safeVariants[0].payload : undefined);
                normalizedExample = {
                    defaultPayload,
                    variants: safeVariants,
                    notes: raw.notes || '',
                };
            }

            const stored = {
                id,
                pluginId,
                title: def.title || id,
                description: def.description || '',
                type: def.type || 'action',
                tags: Array.isArray(def.tags) ? def.tags.slice() : [],
                llmCallable: !!def.llmCallable,
                llmName: def.llmName && def.llmName.trim() ? def.llmName.trim() : id,
                paramsSchema: def.paramsSchema && typeof def.paramsSchema === 'object' ? def.paramsSchema : { type:'object', properties:{} },
                // Keep raw invoke so caller can execute it
                invoke: def.invoke,
                // Example metadata for playgrounds / docs (e.g. Maid-chan Ability tab)
                example: normalizedExample,
                // arbitrary extra metadata
                extra: def.extra || {},
                version,
            };

            _registry.set(id, stored);
            if (pluginId) {
                if (!_byPlugin.has(pluginId)) _byPlugin.set(pluginId, new Set());
                _byPlugin.get(pluginId).add(id);
            }
            _versionCounter++;

            // Warn if registration happens suspiciously late relative to capabilities bootstrap.
            try {
                const elapsedMs = Date.now() - _bootstrapStartedAt;
                if (elapsedMs > 5000) {
                    console.warn(
                        `[Capabilities] Late registration detected for '${id}' (plugin '${pluginId}'). ` +
                        'Capabilities should be registered at script load time (IIFE) before the plugin UI is constructed.'
                    );
                }
            } catch(_e) { /* ignore */ }

            // Broadcast registration for listeners (e.g. Maid-chan UI)
            try {
                g.events && g.events.emit && g.events.emit('capability:registered', stored);
            } catch(e){ console.error('[Capabilities] Error emitting capability:registered', e); }

            return stored;
        },

        unregister(id){
            id = normalizeId(id);
            if (!id || !_registry.has(id)) return false;
            const def = _registry.get(id);
            _registry.delete(id);
            if (def && def.pluginId && _byPlugin.has(def.pluginId)) {
                const set = _byPlugin.get(def.pluginId);
                set.delete(id);
                if (!set.size) _byPlugin.delete(def.pluginId);
            }
            try {
                g.events && g.events.emit && g.events.emit('capability:unregistered', def);
            } catch(e){ console.error('[Capabilities] Error emitting capability:unregistered', e); }
            return true;
        },

        unregisterByPlugin(pluginId){
            pluginId = normalizeId(pluginId);
            if (!pluginId || !_byPlugin.has(pluginId)) return 0;
            const ids = Array.from(_byPlugin.get(pluginId));
            ids.forEach(id => this.unregister(id));
            return ids.length;
        },

        get(id){
            id = normalizeId(id);
            if (!id) return null;
            const def = _registry.get(id);
            if (!def) return null;
            // Return a shallow clone to prevent external mutation
            return { ...def };
        },

        list(filterFn){
            const all = Array.from(_registry.values()).map(d => ({ ...d }));
            if (typeof filterFn === 'function') return all.filter(filterFn);
            return all;
        },

        listByPlugin(pluginId){
            pluginId = normalizeId(pluginId);
            if (!pluginId || !_byPlugin.has(pluginId)) return [];
            const ids = Array.from(_byPlugin.get(pluginId));
            return ids.map(id => ({ ..._registry.get(id) })).filter(Boolean);
        },

        listLLMCallable(){
            return this.list(c => !!c.llmCallable);
        },

        async invoke(id, args = {}, ctx = {}){
            const def = _registry.get(normalizeId(id));
            if (!def || typeof def.invoke !== 'function') {
                throw new Error(`[Capabilities] Unknown or non-callable capability: ${id}`);
            }
            try {
                return await def.invoke(args, ctx);
            } catch (e) {
                console.error(`[Capabilities] Error invoking capability '${id}':`, e);
                throw e;
            }
        },

        getVersion(){
            return _versionCounter;
        }
    };

    g.services.capabilities = capabilities;
    console.log('[Core] Capabilities service initialized.');
})();
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

// Expose core state for plugins that need to discover active plugins
// (e.g. to lazily bootstrap headless instances for capabilities).
window.Yuuka = window.Yuuka || {};
window.Yuuka.coreState = state;

// --- Core Logic ---
let errorTimeout;
function showError(message) {
    clearTimeout(errorTimeout);
    errorPopup.textContent = message;
    errorPopup.classList.add('show');
    errorTimeout = setTimeout(() => { errorPopup.classList.remove('show'); }, 4000);
}
// Expose for plugins
window.showError = showError;

// Auth UI removed; managed by AuthPluginComponent

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
    console.log('[Core] Yuuka is waking up...');
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    // Ensure auth service (provided by auth plugin JS) exists; if not, create a lightweight fallback until plugin loads.
    if (!window.Yuuka.services.auth) {
        if (window.Yuuka.components['AuthPluginComponent']) {
            window.Yuuka.services.auth = new window.Yuuka.components['AuthPluginComponent'](null, api);
            window.Yuuka.services.auth.init();
        } else {
            // Fallback placeholder (will be replaced once plugin script loads)
            window.Yuuka.services.auth = {
                getToken: () => localStorage.getItem('yuuka-auth-token'),
                showLogin: (msg) => { document.body.className='is-logged-out'; const c=document.getElementById('auth-container'); if(c) c.innerHTML=`<div class="auth-form-wrapper"><h3>Đang tải Auth Plugin...</h3>${msg?`<p class='error-msg'>${msg}</p>`:''}</div>`; },
                ensureLogoutMessage: ()=>{ const m=sessionStorage.getItem('yuuka-logout-message'); if(m){ sessionStorage.removeItem('yuuka-logout-message'); showError(m);} }
            };
        }
    }

    window.Yuuka.services.auth.ensureLogoutMessage?.();
    const token = window.Yuuka.services.auth.getToken?.();

    if (token) {
        try {
            await initializeAppUI();
        } catch (error) {
            if (error.status === 401) {
                localStorage.removeItem('yuuka-auth-token');
                window.Yuuka.services.auth.showLogin?.('Token không hợp lệ. Vui lòng đăng nhập lại.');
            } else {
                showError(`Lỗi khởi tạo: ${error.message}`);
                console.error(error);
            }
        }
    } else {
        window.Yuuka.services.auth.showLogin?.('');
    }
}

window.addEventListener('load', startApplication);
// Listen for auth:login to bootstrap rest of UI if not yet initialized
window.Yuuka.events.on('auth:login', async () => {
    try { await initializeAppUI(); } catch (e){ console.error('[Auth] Failed post-login init:', e); showError(`Lỗi khởi tạo: ${e.message}`); }
});
