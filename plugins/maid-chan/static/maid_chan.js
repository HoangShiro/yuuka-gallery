// --- NEW FILE: plugins/maid-chan/static/maid_chan.js ---
(function(){
    const DEFAULT_AVATAR_SVG = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffb6cf"/>
        <stop offset="100%" stop-color="#ff6f59"/>
        </linearGradient>

        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
        <feOffset dx="0" dy="2"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
    </defs>

    <rect width="256" height="256" fill="url(#bg)"/>

    <!-- headband centered -->
    <g transform="translate(128 116)">
        <!-- scalloped frill -->
        <g filter="url(#soft)" fill="#fff">
        <path d="
            M -76 10
            a12 12 0 0 1 24 0
            a12 12 0 0 1 24 0
            a12 12 0 0 1 24 0
            a12 12 0 0 1 24 0
            a12 12 0 0 1 24 0
            a12 12 0 0 1 24 0
            L 76 10
            C 60 38 -60 38 -76 10 Z" opacity="1"/>

        <path d="
            M -70 12
            a10 10 0 0 1 20 0
            a10 10 0 0 1 20 0
            a10 10 0 0 1 20 0
            a10 10 0 0 1 20 0
            a10 10 0 0 1 20 0
            L 70 12
            C 56 32 -56 32 -70 12 Z" fill="#ffffff" opacity="0.92"/>
        </g>

        <!-- subtle bottom trim -->
        <path d="M-84 26 C-56 44 -24 46 0 44 C24 46 56 44 84 26" fill="#ffffff" opacity="0.06"/>

        <!-- small centered bow -->
        <g transform="translate(0 -6)" fill="#fff">
        <ellipse cx="0" cy="6" rx="12" ry="8" filter="url(#soft)"/>
        <path d="M-12 6 q8 -12 12 -8 q4 -4 12 8 q-8 6 -12 2 q-4 4 -12 -2z" opacity="0.98"/>
        <circle cx="0" cy="6" r="3.2" fill="#f5f5f6" stroke="#efeaea" stroke-width="0.8"/>
        </g>
    </g>
    </svg>`);

  const DEFAULT_AVATAR = `data:image/svg+xml;charset=UTF-8,${DEFAULT_AVATAR_SVG}`;

  // Helper for image rendering in bubbles
  function mcRenderContentWithImages(container, text){
    container.innerHTML = '';
    if(!text) return;
    const regex = /(\[IMG\]\([^)]+\))/gi;
    const parts = text.split(regex);
    parts.forEach(part => {
      if(!part) return;
      const match = part.match(/^\[IMG\]\(([^)]+)\)$/i);
      if(match){
        const url = match[1];
        const img = document.createElement('img');
        img.src = url;
        img.className = 'maid-chat-inline-img';
        img.style.maxWidth = '100%';
        img.style.display = 'block';
        img.style.margin = '1em 0';
        img.style.borderRadius = '4px';
        
        img.addEventListener('click', (e)=>{
          e.preventDefault();
          e.stopPropagation();
          if(window.Yuuka && window.Yuuka.plugins && window.Yuuka.plugins.simpleViewer){
            window.Yuuka.plugins.simpleViewer.open({
              items: [{ imageUrl: url }],
              startIndex: 0
            });
          }
        });

        container.appendChild(img);
      } else {
        container.appendChild(document.createTextNode(part));
      }
    });
  }

  function mcGetMaidStorage(){
    return (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidStorage) || null;
  }
  function mcGetMaidCore(){
    return (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || null;
  }
  function mcGetAILogic(){
    return (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.AILogic) || null;
  }
  function mcIsLogicEnabled(){
    try{
      const logic = mcGetAILogic();
      if(logic && typeof logic.isEnabled === 'function'){
        return !!logic.isEnabled();
      }
    }catch(_e){/* ignore */}
    return false;
  }
  function mcGetPluginApi(){
    const root = window.Yuuka || {};
    const ns = root.plugins && root.plugins['maid-chan'];
    const coreApi = ns && ns.coreApi;
    if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
      coreApi.createPluginApiClient('maid');
      return coreApi.maid || null;
    }
    return null;
  }
  async function mcApiGet(path){
    const pluginApi = mcGetPluginApi();
    if(pluginApi && typeof pluginApi.get === 'function'){
      const rel = path.replace(/^\/api\/plugin\/maid/, '');
      return await pluginApi.get(rel || '/chat/history');
    }
    if(window.Yuuka?.services?.api?.get){
      return await window.Yuuka.services.api.get(path);
    }
    const res = await fetch(path, { credentials: 'include' });
    if(res.status === 404){
      return { items: [] };
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }
  async function mcApiPost(path, payload){
    const pluginApi = mcGetPluginApi();
    if(pluginApi && typeof pluginApi.post === 'function'){
      const rel = path.replace(/^\/api\/plugin\/maid/, '');
      return await pluginApi.post(rel || '/chat/append', payload);
    }
    if(window.Yuuka?.services?.api?.post){
      return await window.Yuuka.services.api.post(path, payload);
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload || {})
    });
    if(res.status === 404){
      return {};
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }

  // Global registry and API for Maid bubble triggers
  // Allows features to register actions that fire when user clicks the bubble
  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.plugins = window.Yuuka.plugins || {};
  window.Yuuka.plugins.maidTriggers = window.Yuuka.plugins.maidTriggers || [];
  window.Yuuka.plugins.maidQuickActions = window.Yuuka.plugins.maidQuickActions || [];
  if(!window.Yuuka.components.MaidChanBubble){
    window.Yuuka.components.MaidChanBubble = {
      registerTrigger(def){
        if(!def || (typeof def.handler !== 'function' && typeof def.fn !== 'function')) return null;
        const d = { ...def };
        d.id = d.id || `maid_trg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        d.handler = d.handler || d.fn;
        if(typeof d.requireEnabled === 'undefined') d.requireEnabled = true;
        window.Yuuka.plugins.maidTriggers.push(d);
        return d.id;
      },
      unregisterTrigger(id){
        const arr = window.Yuuka.plugins.maidTriggers || [];
        const i = arr.findIndex(t=> t.id === id);
        if(i >= 0) arr.splice(i,1);
      },
      listTriggers(){
        return [...(window.Yuuka.plugins.maidTriggers || [])];
      },
      // New: quick menu actions registry (icon buttons under the bubble)
      registerQuickAction(def){
        if(!def || typeof def.handler !== 'function') return null;
        const d = { ...def };
        d.id = d.id || `maid_qact_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        if(typeof d.order !== 'number') d.order = 100;
        if(typeof d.requireEnabled === 'undefined') d.requireEnabled = true;
        window.Yuuka.plugins.maidQuickActions.push(d);
        return d.id;
      },
      unregisterQuickAction(id){
        const arr = window.Yuuka.plugins.maidQuickActions || [];
        const i = arr.findIndex(t=> t.id === id);
        if(i >= 0) arr.splice(i,1);
      },
      listQuickActions(){
        return [...(window.Yuuka.plugins.maidQuickActions || [])];
      },
      run(ctx={}){
        const inst = window.Yuuka?.plugins?.maidChanInstance;
        if(inst && typeof inst._runTriggers === 'function') return inst._runTriggers(ctx);
        // Fallback (no instance yet): run statelessly with minimal context
        const list = window.Yuuka.plugins.maidTriggers || [];
        const isEnabled = (fid)=>{ try{ const raw = localStorage.getItem(`maid-chan:feature:${fid}:enabled`); return raw? JSON.parse(raw): false; }catch(_e){ return false; } };
        list.slice().forEach(def=>{
          try{
            if(def.featureId && def.requireEnabled !== false && !isEnabled(def.featureId)) return;
            def.handler({ bubble: null, element: null, api: null, event: ctx.event || null, openModal: ()=>{} });
            if(def.once && def.id){ const idx = list.findIndex(t=>t.id===def.id); if(idx>=0) list.splice(idx,1); }
          }catch(_e){ /* ignore */ }
        });
      }
    };
  }

  class MaidChanComponent {
    constructor(container, api){
      this.api = api || null;
      this.container = container || document.body;
      this.element = null;
      this._modalInstance = null; // external modal handler (from modal.js)
      this._idleTimer = null;
      this._idleDelay = 1000; // ms before dimming when unfocused
      this._idleDelayTap = 3000; // ms after quick tap on bubble
      this._idleDisabled = false; // when true, do not dim until re-enabled
      this._idleSetup = false;
      this._suppressNextClick = false; // prevent click trigger after long-press
      this._didDrag = false; // track if pointer moved beyond threshold
      this._pressStart = null; // starting point for current press
      this._dragThreshold = 5; // px threshold to consider as a drag
      this.state = {
        pos: this._load('maid-chan:pos', {x: null, y: null}),
        avatar: this._load('maid-chan:avatar', DEFAULT_AVATAR),
        isDragging: false,
        longPressTimer: null,
        isOpen: this._load('maid-chan:isOpen', false)
      };

      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseUp = this._onMouseUp.bind(this);
      this._onTouchMove = this._onTouchMove.bind(this);
      this._onTouchEnd = this._onTouchEnd.bind(this);
      // Deferred bubble img reference
      this._imgEl = null;
      // Chat bubbles state, including custom anchor handling
      this._chat = { container: null, items: [], anchorOverride: null, anchorLocks: 0 };
      // Quick menu state (uses maid idle timer for auto-hide)
      this._quickMenu = { el: null, isOpen: false };
      // Quick chat composer state
      this._quickChat = {
        panel: null,
        textarea: null,
        sendBtn: null,
        statusEl: null,
        isOpen: false,
        sending: false,
        historyLoaded: false,
        historyLoading: false,
        historyPromise: null,
        history: []
      };
      this._quickChatHistoryLimit = 200;
      this._onChatMessageAppended = (ev)=> this._handleChatMessageAppended(ev);
      window.addEventListener('maid-chan:chat:message-appended', this._onChatMessageAppended);
    }

    // Public API: service launcher entry point
    start(){
      // If a global instance exists (e.g., auto-boot from previous session), delegate toggle to it
      const globalNS = (window.Yuuka = window.Yuuka || {});
      globalNS.plugins = globalNS.plugins || {};
      const existing = globalNS.plugins.maidChanInstance;
      if(existing && existing !== this){
        existing.toggle();
        return;
      }
      // Become the singleton and toggle self
      if(!this.element) this._createBubble();
      globalNS.plugins.maidChanInstance = this;
      this.toggle();
    }

    open(){
      if(!this.element) this._createBubble();
      this.element.style.display = 'flex';
      if(this.state.pos.x != null && this.state.pos.y != null){ this._applyPosition(this.state.pos.x, this.state.pos.y); }
      this._bumpActivity();
      this.state.isOpen = true; this._save('maid-chan:isOpen', true);
    }

    close(){
      if(this.element){
        // Capture current position before hiding so we restore accurately next open
        const rect = this.element.getBoundingClientRect();
        this.state.pos = { x: rect.left, y: rect.top };
        this._save('maid-chan:pos', this.state.pos);
        this.element.style.display = 'none';
      }
      if(this._quickChat?.isOpen){
        this._toggleQuickChatPanel(false);
      }
      this.state.isOpen = false; this._save('maid-chan:isOpen', false);
    }

    toggle(){ this.state.isOpen ? this.close() : this.open(); }

    // UI creation
    _createBubble(){
  const el = document.createElement('div');
      el.className = 'maid-chan-bubble';
      el.setAttribute('role','button');
      el.setAttribute('aria-label','Maid-chan');
  el.style.display = 'none';

      const img = document.createElement('img');
      img.alt = 'Maid-chan avatar';
      img.src = this.state.avatar || DEFAULT_AVATAR;
  this._imgEl = img;
      el.appendChild(img);

      // Dragging (mouse)
      el.addEventListener('mousedown', (e)=>{
        if(e.button !== 0) return; // left only
        this._bumpActivity();
        // start long-press detection for mouse as well
        this._clearLongPress();
        this.state.longPressTimer = setTimeout(()=>{ this._suppressNextClick = true; this._openModal(); }, 550);
        this._didDrag = false;
        this._pressStart = { x: e.clientX, y: e.clientY };
        const rect = el.getBoundingClientRect();
        this._dragOffset = {x: e.clientX - rect.left, y: e.clientY - rect.top};
        this.state.isDragging = true;
        el.classList.add('is-dragging');
        // Re-apply absolute positioning immediately so removing transforms
        // (idle/hover) does not cause the bubble to slide away from pointer.
        this._applyPosition(e.clientX - this._dragOffset.x, e.clientY - this._dragOffset.y);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', (ev)=>{ this._clearLongPress(); this._onMouseUp(ev); }, {once: true});
      });

      // Dragging (touch)
      el.addEventListener('touchstart', (e)=>{
  this._bumpActivity();
        const t = e.touches[0];
        const rect = el.getBoundingClientRect();
        this._dragOffset = {x: t.clientX - rect.left, y: t.clientY - rect.top};
        this.state.isDragging = true;
        this._didDrag = false;
        this._pressStart = { x: t.clientX, y: t.clientY };
        el.classList.add('is-dragging');
        this._applyPosition(t.clientX - this._dragOffset.x, t.clientY - this._dragOffset.y);
        document.addEventListener('touchmove', this._onTouchMove, {passive:false});
        document.addEventListener('touchend', this._onTouchEnd, {once:true});

        // long-press to open modal
        this._clearLongPress();
      this.state.longPressTimer = setTimeout(()=> { this._suppressNextClick = true; this._openModal(); }, 550);
      }, {passive:true});

      // Context menu to open modal
      el.addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        this._bumpActivity();
        this._openModal();
      });

      // Cancel long press on movement/end
      el.addEventListener('touchmove', ()=> this._clearLongPress(), {passive:true});
      el.addEventListener('touchend', ()=> this._clearLongPress(), {passive:true});
      el.addEventListener('touchcancel', ()=> this._clearLongPress(), {passive:true});

      // Avatar customization: drop/paste image
      el.addEventListener('dragover', (e)=>{ e.preventDefault(); });
      el.addEventListener('drop', (e)=>{
        e.preventDefault();
        const file = [...(e.dataTransfer?.files||[])].find(f=>f.type.startsWith('image/'));
        if(file){ this._readFileAsDataURL(file).then(url=> this._setAvatar(url)); }
      });
      el.addEventListener('paste', (e)=>{
        const item = [...(e.clipboardData?.items||[])].find(i=> i.type && i.type.startsWith('image/'));
        if(item){ const file = item.getAsFile(); if(file) this._readFileAsDataURL(file).then(url=> this._setAvatar(url)); }
      });

      // Double click: center-open modal as well (optional shortcut)
      el.addEventListener('dblclick', ()=> { this._bumpActivity(); this._openModal(); });

      // Single click: open quick menu (instead of running triggers)
      el.addEventListener('click', (e)=>{
        if(this._suppressNextClick){ this._suppressNextClick = false; return; }
        if(this.state.isDragging) return;
        if(e.detail && e.detail > 1) return; // ignore double-click
        // Quick tap: keep maid awake until user clicks outside
        // or uses a quick-menu button. Disable idle timeout.
        this._idleDisabled = true;
        this._bumpActivity(null);
        this._showQuickMenu();
      });

      // Wake from idle on hover + show quick menu
      el.addEventListener('mouseenter', ()=>{
        // While pointer stays over the bubble, keep it awake (no timeout)
        this._idleDisabled = true;
        this._bumpActivity(null);
        this._showQuickMenu();
      });

      el.addEventListener('mouseleave', ()=>{
        // Re-enable idle timeout once pointer leaves the bubble area
        this._idleDisabled = false;
        this._bumpActivity();
      });

      this.container.appendChild(el);
      this.element = el;
      this._keepInViewport();
      window.addEventListener('resize', ()=> this._keepInViewport());
	window.addEventListener('resize', ()=> this._positionChatContainer());

	  // Ensure quick menu exists and is kept under the bubble
	  this._ensureQuickMenu();
	  window.addEventListener('resize', ()=> this._positionQuickMenu());
      window.addEventListener('resize', ()=> this._positionQuickChatPanel());

      // Idle/focus management listeners (set up once)
      this._setupIdleManagement();
    }

    _setAvatar(src){
      if(typeof src !== 'string' || !src.trim()) return;
      let finalSrc = src;
      // Add cache-busting query for http(s) or root-relative URLs so browsers reload immediately
      const isData = src.startsWith('data:');
      if(!isData){
        try{
          const u = new URL(src, window.location.origin);
          u.searchParams.set('_', Date.now().toString());
          finalSrc = u.toString();
        }catch(e){ /* keep original on URL parse failure */ }
      }
      this.state.avatar = finalSrc;
      this._save('maid-chan:avatar', finalSrc);
      if(this._imgEl){ this._imgEl.src = finalSrc; }
      // Notify listeners (e.g., modal) that avatar changed
      try{ window.dispatchEvent(new CustomEvent('maid-chan:avatar-changed', { detail: { url: finalSrc } })); }catch(e){ /* ignore */ }
    }

    _onMouseMove(e){
      if(!this.state.isDragging) return;
      this._clearLongPress();
      this._bumpActivity();
      if(this._pressStart){
        const dx = Math.abs(e.clientX - this._pressStart.x);
        const dy = Math.abs(e.clientY - this._pressStart.y);
        if(dx > this._dragThreshold || dy > this._dragThreshold) this._didDrag = true;
      }
      this._applyPosition(e.clientX - this._dragOffset.x, e.clientY - this._dragOffset.y);
    }
    _onMouseUp(){
      this._clearLongPress();
      if(this._didDrag) this._suppressNextClick = true;
      this.state.isDragging = false;
      if(this.element) this.element.classList.remove('is-dragging');
      document.removeEventListener('mousemove', this._onMouseMove);
      this._pressStart = null;
      this._didDrag = false;
      if(this.element){ const rect = this.element.getBoundingClientRect(); this._save('maid-chan:pos', {x: rect.left, y: rect.top}); }
    }

    _onTouchMove(e){
      if(!this.state.isDragging) return;
      e.preventDefault();
      const t = e.touches[0];
      this._bumpActivity();
      this._clearLongPress();
      if(this._pressStart){
        const dx = Math.abs(t.clientX - this._pressStart.x);
        const dy = Math.abs(t.clientY - this._pressStart.y);
        if(dx > this._dragThreshold || dy > this._dragThreshold) this._didDrag = true;
      }
      this._applyPosition(t.clientX - this._dragOffset.x, t.clientY - this._dragOffset.y);
    }
    _onTouchEnd(){
      if(this._didDrag) this._suppressNextClick = true;
      this.state.isDragging = false;
      if(this.element) this.element.classList.remove('is-dragging');
      document.removeEventListener('touchmove', this._onTouchMove);
      this._pressStart = null;
      this._didDrag = false;
      if(this.element){ const rect = this.element.getBoundingClientRect(); this._save('maid-chan:pos', {x: rect.left, y: rect.top}); }
    }

    _applyPosition(x, y){
      if(!this.element) return;
      const maxX = window.innerWidth - this.element.offsetWidth - 8;
      const maxY = window.innerHeight - this.element.offsetHeight - 8;
      x = Math.max(8, Math.min(x, maxX));
      y = Math.max(8, Math.min(y, maxY));
      this.element.style.left = `${x}px`;
      this.element.style.top = `${y}px`;
      this.element.style.right = 'auto';
      this.element.style.bottom = 'auto';
      // Persist on every position update so toggle keeps latest coordinates
      this.state.pos = { x, y };
      this._save('maid-chan:pos', this.state.pos);
      // Re-anchor chat bubbles alongside the maid bubble
      this._positionChatContainer();
      // Reposition quick menu directly under bubble
      this._positionQuickMenu();
      this._positionQuickChatPanel();
    }

    _keepInViewport(){
      if(!this.element) return;
      const rect = this.element.getBoundingClientRect();
      let x = rect.left, y = rect.top;
      const w = rect.width, h = rect.height;
      const vw = window.innerWidth, vh = window.innerHeight;
      if(x + w > vw) x = vw - w - 8; if(x < 8) x = 8;
      if(y + h > vh) y = vh - h - 8; if(y < 8) y = 8;
      this._applyPosition(x, y);
    }

    _clearLongPress(){ if(this.state.longPressTimer) { clearTimeout(this.state.longPressTimer); this.state.longPressTimer = null; } }

    // Delegates to external MaidChanModal class (defined in modal.js)
    _ensureModal(){
      if(!this._modalInstance){
        const ModalCtor = window.Yuuka?.components?.MaidChanModal;
        if(typeof ModalCtor === 'function'){
          this._modalInstance = new ModalCtor();
        }else{
          console.warn('[Maid-chan] Modal component not loaded yet.');
        }
      }
      return this._modalInstance;
    }
    _openModal(){ const m = this._ensureModal(); if(m) m.open(); }
    _closeModal(){ if(this._modalInstance) this._modalInstance.close(); }

    // Idle management: dim when not focused/idle
    _setupIdleManagement(){
      if(this._idleSetup) return;
      this._idleSetup = true;
      const onFocus = ()=> this._bumpActivity();
      const onBlur = ()=> this._setIdle(true);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState === 'visible') this._bumpActivity();
        else this._setIdle(true);
      });
      // Start initial idle countdown
      this._bumpActivity();
    }
    _bumpActivity(delay){
      if(!this.element) return;
      this._setIdle(false);
      if(this._idleTimer){
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
      // When idle is globally disabled (e.g. hovering/click tap),
      // we do not schedule any timeout. Bubble stays awake until re-enabled.
      if(this._idleDisabled) return;
      const useDelay = typeof delay === 'number' ? delay : this._idleDelay;
      this._idleTimer = setTimeout(()=>{
        this._setIdle(true);
        // When maid goes idle, also hide quick menu for synchronized behavior
        if(this._quickMenu && this._quickMenu.isOpen){
          this._hideQuickMenu();
        }
      }, useDelay);
    }
    _setIdle(flag){
      if(!this.element) return;
      if(flag) this.element.classList.add('is-idle');
      else this.element.classList.remove('is-idle');
    }

    // --- Chat bubble helpers ---
    _ensureChatContainer(){
      if(this._chat.container && document.body.contains(this._chat.container)) return this._chat.container;
      const el = document.createElement('div');
      el.className = 'maid-chat-container';
      document.body.appendChild(el);
      this._chat.container = el;
      this._positionChatContainer();
      return el;
    }
    _resolveAnchorRect(source){
      const fallback = ()=>{
        if(!this.element) return null;
        const rect = this.element.getBoundingClientRect();
        return rect ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height } : null;
      };
      if(!source) return fallback();
      if(typeof source.getBoundingClientRect === 'function'){
        try{
          const rect = source.getBoundingClientRect();
          if(rect) return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
        }catch(_e){/* ignore */}
      }
      if(typeof source === 'object'){
        const val = source;
        if(typeof val.left === 'number' && typeof val.top === 'number'){
          const width = typeof val.width === 'number' ? val.width : (typeof val.right === 'number' ? val.right - val.left : 0);
          const height = typeof val.height === 'number' ? val.height : (typeof val.bottom === 'number' ? val.bottom - val.top : 0);
          const right = typeof val.right === 'number' ? val.right : val.left + width;
          const bottom = typeof val.bottom === 'number' ? val.bottom : val.top + height;
          return { top: val.top, left: val.left, right, bottom, width, height };
        }
        if(typeof val.x === 'number' && typeof val.y === 'number'){
          return { top: val.y, bottom: val.y, left: val.x, right: val.x, width: 0, height: 0 };
        }
        if(typeof val.clientX === 'number' && typeof val.clientY === 'number'){
          return { top: val.clientY, bottom: val.clientY, left: val.clientX, right: val.clientX, width: 0, height: 0 };
        }
      }
      return fallback();
    }
    _positionChatContainer(anchorOverride){
      if(typeof anchorOverride !== 'undefined'){
        this._chat.anchorOverride = anchorOverride;
      }
      const c = this._chat.container;
      if(!c) return;
      const rect = this._resolveAnchorRect(this._chat.anchorOverride);
      if(!rect) return;
      const gap = 10;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clamp = (value, min, max)=> Math.max(min, Math.min(value, Math.max(min, max)));
      const preferRightSpace = vw - (rect.right + gap);
      const preferLeftSpace = rect.left - gap;
      const widthGuess = c.offsetWidth || 0;
      const neededWidth = Math.max(300, widthGuess || 0);
      const useLeft = preferRightSpace < neededWidth && preferLeftSpace > preferRightSpace;
      c.classList.toggle('left', useLeft);
      c.classList.toggle('right', !useLeft);
      if(useLeft){
        const rightOffset = clamp(vw - rect.left + gap, 8, vw - 8);
        c.style.left = 'auto';
        c.style.right = `${Math.round(rightOffset)}px`;
      }else{
        const leftOffset = clamp(rect.right + gap, 8, vw - 8);
        c.style.left = `${Math.round(leftOffset)}px`;
        c.style.right = 'auto';
      }

      const heightGuess = c.offsetHeight || 0;
      const neededHeight = Math.max(180, heightGuess || 0);
      const spaceBelow = vh - (rect.bottom + gap);
      const spaceAbove = rect.top - gap;
      const useAbove = spaceBelow < neededHeight && spaceAbove > spaceBelow;
      c.classList.toggle('above', useAbove);
      c.classList.toggle('below', !useAbove);
      if(useAbove){
        const bottomOffset = clamp(vh - rect.top + gap, 8, vh - 8);
        c.style.bottom = `${Math.round(bottomOffset)}px`;
        c.style.top = 'auto';
      }else{
        const maxTop = vh - (heightGuess || neededHeight) - 8;
        const topOffset = clamp(rect.bottom + gap, 8, maxTop);
        c.style.top = `${Math.round(topOffset)}px`;
        c.style.bottom = 'auto';
      }
    }
    _showChatBubble({ text = '', duration = 5000, type = 'info', anchor, coords } = {}){
      const c = this._ensureChatContainer();
      const anchorHint = typeof anchor !== 'undefined' ? anchor : coords;
      const usesCustomAnchor = typeof anchorHint !== 'undefined' && anchorHint !== null;
      let releaseAnchor = null;
      if(usesCustomAnchor){
        this._chat.anchorLocks = (this._chat.anchorLocks || 0) + 1;
        releaseAnchor = ()=>{
          this._chat.anchorLocks = Math.max(0, (this._chat.anchorLocks || 0) - 1);
          if(this._chat.anchorLocks === 0){
            this._positionChatContainer(null);
          }
        };
        this._positionChatContainer(anchorHint);
      }else{
        this._positionChatContainer();
      }
      const item = document.createElement('div');
      item.className = `maid-chat-bubble type-${type}`;
      item.setAttribute('role', 'status');
      item.setAttribute('aria-live', 'polite');
      const content = document.createElement('div');
      content.className = 'maid-chat-text';
      mcRenderContentWithImages(content, String(text || ''));
      item.appendChild(content);

      // enter animation
      item.classList.add('enter');
      c.appendChild(item);
      this._positionChatContainer();
      const entry = { el: item, timer: null, remove: null, releaseAnchor };
      const removeItem = ()=>{
        if(!item.isConnected) return;
        item.classList.remove('enter');
        item.classList.add('leaving');
        const finish = ()=>{
          try{ item.removeEventListener('animationend', finish); item.remove(); }catch(_){/* ignore */}
          if(entry.releaseAnchor){
            entry.releaseAnchor();
            entry.releaseAnchor = null;
          }
          this._positionChatContainer();
        };
        item.addEventListener('animationend', finish);
        // Fallback remove
        setTimeout(finish, 600);
      };

      const tId = setTimeout(removeItem, Math.max(1000, duration|0 || 5000));
      entry.timer = tId;
      entry.remove = removeItem;
      item.addEventListener('click', (e)=>{ if(e.target === item || e.target === content){ clearTimeout(tId); removeItem(); }});

      this._chat.items.push(entry);
      // Cleanup array on removal
      const obs = new MutationObserver(()=>{
        if(!item.isConnected){
          this._chat.items = this._chat.items.filter(x=>{
            if(x.el === item){
              if(x.releaseAnchor){ x.releaseAnchor(); x.releaseAnchor = null; }
              return false;
            }
            return true;
          });
          this._positionChatContainer();
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      return { close: ()=>{ clearTimeout(tId); removeItem(); } };
    }

    _isFeatureEnabled(featureId){
      try{ const raw = localStorage.getItem(`maid-chan:feature:${featureId}:enabled`); return raw? JSON.parse(raw): false; }catch(_e){ return false; }
    }

    _runTriggers(ctx={}){
      try{
        const list = (window.Yuuka?.plugins?.maidTriggers) || [];
        const snapshot = list.slice();
        snapshot.forEach(def=>{
          try{
            if(def.featureId && def.requireEnabled !== false){
              if(!this._isFeatureEnabled(def.featureId)) return;
            }
            const fn = def.handler || def.fn;
            if(typeof fn === 'function'){
              fn({
                bubble: this,
                element: this.element,
                api: this.api,
                event: ctx.event || null,
                openModal: ()=> this._openModal(),
                closeModal: ()=> this._closeModal(),
                setIdle: (f)=> this._setIdle(!!f),
                showMessage: (opts)=> this._showChatBubble(opts)
              });
            }
            if(def.once && def.id){
              const idx = list.findIndex(t=> t.id === def.id);
              if(idx >= 0) list.splice(idx,1);
            }
          }catch(_err){ /* ignore individual trigger errors */ }
        });
      }catch(_e){ /* ignore */ }
    }

    async _readFileAsDataURL(file){
      return new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // Frontend helper to upload avatar via multipart to backend
    async uploadAvatarFile(file){
      if(!file) return { error: 'No file selected' };
      try {
        const formData = new FormData();
        formData.append('file', file);
        // Use the same token key used by core api.js
        const token = localStorage.getItem('yuuka-auth-token') || '';
        const res = await fetch('/api/maid/avatar', {
          method: 'POST',
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          body: formData
        });
        const json = await res.json();
        if(!res.ok){ return { error: json.error || 'Upload failed' }; }
        if(json.avatar_url){
          // Avatar URL (server) -> We still want a local cached version? We'll just use URL.
          this._setAvatar(json.avatar_url);
        }
        return json;
      }catch(err){
        return { error: String(err) };
      }
    }

    _save(key, val){
      try{ localStorage.setItem(key, JSON.stringify(val)); }catch(err){ /* ignore */ }
    }
    _load(key, fallback){
      try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }catch(err){ return fallback; }
    }

    // --- Quick chat helpers ---
    _ensureQuickChatPanel(){
      if(this._quickChat.panel && document.body.contains(this._quickChat.panel)) return this._quickChat.panel;
      const panel = document.createElement('div');
      panel.className = 'maid-quick-chat-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Quick chat with Maid-chan');
      panel.innerHTML = `
        <div class="maid-quick-chat-body">
          <textarea class="maid-chan-chat-input maid-quick-chat-input" rows="1" placeholder="Nhắn cho Maid-chan..." aria-label="Quick chat input"></textarea>
          <button type="button" class="maid-chan-chat-send maid-quick-chat-send" aria-label="Send quick chat">
            <span class="material-symbols-outlined">send</span>
          </button>
        </div>
      `;
      document.body.appendChild(panel);
      const textarea = panel.querySelector('.maid-quick-chat-input');
      const sendBtn = panel.querySelector('.maid-quick-chat-send');
      if(textarea){
        textarea.addEventListener('input', ()=> this._autoResizeQuickInput());
        textarea.addEventListener('keydown', (e)=>{
          if(e.key === 'Enter' && !e.shiftKey){
            e.preventDefault();
            this._handleQuickChatSend();
          }else if(e.key === 'Escape'){
            e.preventDefault();
            this._toggleQuickChatPanel(false);
          }
        });
      }
      if(sendBtn){
        sendBtn.addEventListener('click', ()=> this._handleQuickChatSend());
      }
      if(!this._quickChat._outsideHandler){
        this._quickChat._outsideHandler = (e)=>{
          if(!this._quickChat.isOpen) return;
          if(panel.contains(e.target)) return;
          if(this.element && this.element.contains(e.target)) return;
          this._toggleQuickChatPanel(false);
        };
        document.addEventListener('click', this._quickChat._outsideHandler);
      }
      this._quickChat.panel = panel;
      this._quickChat.textarea = textarea;
      this._quickChat.sendBtn = sendBtn;
      this._quickChat.statusEl = null;
      this._positionQuickChatPanel();
      return panel;
    }

    _toggleQuickChatPanel(force){
      const panel = this._ensureQuickChatPanel();
      if(!panel) return;
      const shouldOpen = typeof force === 'boolean' ? force : !this._quickChat.isOpen;
      if(shouldOpen){
        panel.classList.add('open');
        panel.style.display = 'flex';
        this._quickChat.isOpen = true;
        this._idleDisabled = true;
        this._bumpActivity(null);
        this._positionQuickChatPanel();
        setTimeout(()=>{ this._quickChat.textarea?.focus(); }, 0);
      }else{
        panel.classList.remove('open');
        panel.style.display = 'none';
        this._quickChat.isOpen = false;
        this._idleDisabled = false;
        this._bumpActivity();
      }
    }

    _positionQuickChatPanel(){
      const panel = this._quickChat.panel;
      if(!panel || !this.element || !this._quickChat.isOpen) return;
      const r = this.element.getBoundingClientRect();
      const panelWidth = panel.offsetWidth || 280;
      const panelHeight = panel.offsetHeight || 160;
      const centerX = (r.left + r.right) / 2;
      const x = Math.max(8, Math.min(centerX - panelWidth / 2, window.innerWidth - panelWidth - 8));
      const baseY = r.bottom + 54; // leave space for quick menu buttons
      const y = Math.min(baseY, window.innerHeight - panelHeight - 8);
      panel.style.left = `${Math.round(x)}px`;
      panel.style.top = `${Math.round(y)}px`;
    }

    _setQuickChatStatus(text){
      if(this._quickChat.statusEl){
        this._quickChat.statusEl.textContent = text || '';
      }
    }

    _autoResizeQuickInput(){
      const textarea = this._quickChat.textarea;
      if(!textarea) return;
      textarea.style.height = 'auto';
      const computed = window.getComputedStyle(textarea);
      const border = parseFloat(computed.borderTopWidth || '0') + parseFloat(computed.borderBottomWidth || '0');
      const target = Math.min(160, textarea.scrollHeight + border);
      textarea.style.height = `${target}px`;
      this._positionQuickChatPanel();
    }

    async _ensureQuickChatHistory(){
      if(this._quickChat.historyLoaded) return;
      if(this._quickChat.historyPromise) return this._quickChat.historyPromise;
      this._quickChat.historyPromise = (async ()=>{
        try{
          const storage = mcGetMaidStorage();
          let list = [];
          if(storage && typeof storage.loadHistory === 'function'){
            const raw = await storage.loadHistory();
            list = Array.isArray(raw) ? raw : [];
          }else{
            const data = await mcApiGet('/api/plugin/maid/chat/history');
            list = Array.isArray(data?.items) ? data.items : [];
          }
          this._quickChat.history = list.map(it => ({
            id: it.id || null,
            role: it.role || 'user',
            text: it.role === 'assistant' ? undefined : (it.text || ''),
            kind: it.kind || 'chat',
            timestamp: it.role === 'assistant' ? undefined : (it.timestamp || Date.now()),
            snapshots: (it.role === 'assistant' && it.snapshots && it.snapshots.parts) ? it.snapshots : undefined,
            tool_contents: Array.isArray(it.tool_contents) ? it.tool_contents : undefined
          }));
        }catch(err){
          console.warn('[Maid-chan quick chat] history load failed', err);
          this._quickChat.history = [];
        }finally{
          this._quickChat.historyLoaded = true;
        }
      })();
      await this._quickChat.historyPromise;
      this._quickChat.historyPromise = null;
    }

    _updateQuickChatHistory(message){
      if(!message) return;
      const entry = {
        id: message.id || ('ext_'+Date.now()),
        role: message.role || 'system',
        text: message.text,
        kind: message.kind || 'chat',
        timestamp: message.timestamp || Date.now(),
        snapshots: message.snapshots ? JSON.parse(JSON.stringify(message.snapshots)) : undefined,
        tool_contents: message.tool_contents ? JSON.parse(JSON.stringify(message.tool_contents)) : undefined
      };
      const idx = this._quickChat.history.findIndex(m => m.id === entry.id);
      if(idx >= 0) this._quickChat.history[idx] = entry;
      else this._quickChat.history.push(entry);
      if(this._quickChat.history.length > this._quickChatHistoryLimit){
        this._quickChat.history.splice(0, this._quickChat.history.length - this._quickChatHistoryLimit);
      }
    }

    _handleChatMessageAppended(ev){
      if(!this._quickChat.historyLoaded) return;
      const msg = ev && ev.detail && ev.detail.message;
      if(!msg) return;
      this._updateQuickChatHistory(msg);
    }

    async _persistQuickChatMessage(msg){
      if(mcIsLogicEnabled()) return;
      try{
        const storage = mcGetMaidStorage();
        if(storage && typeof storage.appendMessage === 'function'){
          await storage.appendMessage(msg);
        }else{
          await mcApiPost('/api/plugin/maid/chat/append', { message: msg });
        }
      }catch(err){
        console.warn('[Maid-chan quick chat] persist failed', err);
      }
    }

    _buildLLMHistory(excludeMessageId, logicMode){
      const source = logicMode ? this._quickChat.history.filter(m => m.id !== excludeMessageId) : this._quickChat.history;
      return source.map(m => {
        if(m.role === 'assistant'){
          const parts = (m.snapshots && Array.isArray(m.snapshots.parts)) ? m.snapshots.parts : [];
          if(parts.length){
            const idx = typeof m.snapshots.current_index === 'number' ? m.snapshots.current_index : (parts.length - 1);
            const safeIdx = Math.max(0, Math.min(idx, parts.length - 1));
            const part = parts[safeIdx];
            const base = typeof part === 'string' ? part : (part && part.text) || '';
            const toolText = (part && typeof part.tool_results_text === 'string') ? part.tool_results_text : '';
            return { role: 'assistant', content: toolText ? (base + '\n\n' + toolText) : base };
          }
          return { role: 'assistant', content: m.text || '' };
        }
        return { role: m.role, content: m.text || '' };
      });
    }

    _broadcastChatMessage(msg){
      try{
        window.dispatchEvent(new CustomEvent('maid-chan:chat:external-append', { detail: { message: msg, source: 'quick-chat' } }));
      }catch(_e){/* noop */}
    }

    async _handleQuickChatSend(){
      const textarea = this._quickChat.textarea;
      const sendBtn = this._quickChat.sendBtn;
      if(!textarea || !sendBtn) return;
      const raw = (textarea.value || '').trim();
      if(!raw || this._quickChat.sending) return;
      await this._ensureQuickChatHistory();
      this._quickChat.sending = true;
      sendBtn.disabled = true;
      this._setQuickChatStatus('Sending...');
      const now = Date.now();
      const userId = `quick_user_${now}_${Math.random().toString(16).slice(2)}`;
      const userMsg = { id: userId, role: 'user', text: raw, kind: 'chat', timestamp: now };
      textarea.value = '';
      this._autoResizeQuickInput();
      this._updateQuickChatHistory(userMsg);
      this._broadcastChatMessage(userMsg);
      await this._persistQuickChatMessage(userMsg);

      const logicOn = mcIsLogicEnabled();
      const assistantId = `quick_assistant_${now}_${Math.random().toString(16).slice(2)}`;
      const MaidCoreDynamic = mcGetMaidCore();
      const logic = mcGetAILogic();
      let result = null;
      let executedAny = false;
      try{
        const history = this._buildLLMHistory(userId, logicOn);
        if(logicOn && logic){
          try{
            const graph = (logic && typeof logic.loadGraph === 'function') ? logic.loadGraph() : null;
            const userNodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes.filter(n => n && n.type === 'User Input') : [];
            const seenFlows = new Set();
            for(const node of userNodes){
              const fid = node.flow_id !== undefined ? node.flow_id : 0;
              if(seenFlows.has(fid)) continue;
              seenFlows.add(fid);
              window.dispatchEvent(new CustomEvent('maid-chan:logic:run-stage', {
                detail: {
                  stage: 1,
                  nodeId: node.id,
                  text: raw,
                  runId: 'quick-'+Date.now()+'-'+Math.random().toString(16).slice(2),
                  userMessageId: userId,
                  assistantMessageId: assistantId,
                  context: { userMessageId: userId, assistantMessageId: assistantId }
                }
              }));
              executedAny = true;
            }
            if(!executedAny && typeof logic.execute === 'function'){
              const execRes = await logic.execute({ text: raw, context: { userMessageId: userId, assistantMessageId: assistantId }, history });
              result = execRes && (execRes.response || execRes) || null;
              if(result && typeof result === 'object' && !result._maid_assistant_id){
                result._maid_assistant_id = assistantId;
              }
            }
          }catch(err){ console.warn('[Maid-chan quick chat] logic run failed', err); }
        }else if(MaidCoreDynamic && typeof MaidCoreDynamic.askMaid === 'function'){
          try{
            result = await MaidCoreDynamic.askMaid(raw, { history });
            if(result && typeof result === 'object' && !result._maid_assistant_id){
              result._maid_assistant_id = assistantId;
            }
          }catch(err){ console.warn('[Maid-chan quick chat] askMaid failed', err); }
        }

        if(result){
          let assistantText = '';
          let toolResultsText = (result && typeof result === 'object' && typeof result.tool_results_text === 'string') ? result.tool_results_text.trim() : '';
          const toolContents = (result && typeof result === 'object' && Array.isArray(result.tool_contents)) ? result.tool_contents : [];
          if(typeof result === 'string'){
            assistantText = result;
          }else if(typeof result === 'object'){
            assistantText = result.text || result.message || result.content || '';
            if(!assistantText && Array.isArray(result.choices) && result.choices.length){
              const choice = result.choices[0];
              if(choice && choice.message && typeof choice.message.content === 'string'){
                assistantText = choice.message.content;
              }
            }
            if(!assistantText && Array.isArray(result.candidates) && result.candidates.length){
              const cand = result.candidates[0];
              const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
              if(parts.length && typeof parts[0].text === 'string'){
                assistantText = parts[0].text;
              }
            }
          }
          if(assistantText){
            const part = { text: assistantText, timestamp: Date.now() };
            if(toolResultsText) part.tool_results_text = toolResultsText;
            if(toolContents && toolContents.length){
              part.tool_info = toolContents.map(c => ({
                name: c.name || c.id,
                type: (c.type||'').toLowerCase(),
                pluginId: c.pluginId || '',
                stage: c.stage,
                arguments_list: Array.isArray(c?.arguments_list) ? c.arguments_list.slice() : (function(v){
                  const src = (v !== undefined ? v : (c.arguments !== undefined ? c.arguments : c.args));
                  if(src == null) return [];
                  if(Array.isArray(src)) return src.slice();
                  if(typeof src === 'object') return Object.values(src);
                  return [src];
                })(c.arguments_list),
                result_list: Array.isArray(c?.result_list) ? c.result_list.slice() : (function(v){
                  const src = (v !== undefined ? v : c.result);
                  if(src == null) return [];
                  if(Array.isArray(src)) return src.slice();
                  if(typeof src === 'object') return Object.values(src);
                  return [src];
                })(c.result_list)
              })).filter(t => t.name);
            }
            const maidMsg = { id: (result && typeof result === 'object' && result._maid_assistant_id) ? result._maid_assistant_id : assistantId, role: 'assistant', kind: 'chat', snapshots: { parts: [part], current_index: 0 } };
            if(toolContents && toolContents.length){ maidMsg.tool_contents = toolContents; }
            this._updateQuickChatHistory(maidMsg);
            this._broadcastChatMessage(maidMsg);
            await this._persistQuickChatMessage(maidMsg);
            const preview = assistantText.length > 220 ? assistantText.slice(0, 220)+'…' : assistantText;
            this._showChatBubble({ text: preview, duration: Math.min(9000, Math.max(5000, preview.length * 40)) });
            this._setQuickChatStatus('Reply received.');
          }else{
            this._setQuickChatStatus('Maid-chan replied without text.');
          }
        }else if(executedAny){
          this._setQuickChatStatus('Logic graph is processing...');
        }else{
          this._setQuickChatStatus('No reply received.');
        }
      }catch(err){
        console.warn('[Maid-chan quick chat] send failed', err);
        this._setQuickChatStatus('Failed to send message.');
        this._showChatBubble({ text: 'Không gửi được tin nhắn.', duration: 4000, type: 'error' });
      }finally{
        this._quickChat.sending = false;
        sendBtn.disabled = false;
        setTimeout(()=> this._setQuickChatStatus(''), 2500);
      }
    }

    // --- Quick menu helpers ---
    _ensureQuickMenu(){
      if(this._quickMenu.el && document.body.contains(this._quickMenu.el)) return this._quickMenu.el;
      const menu = document.createElement('div');
      menu.className = 'maid-quick-menu';
      menu.setAttribute('role', 'menu');
      menu.style.position = 'fixed';
      menu.style.display = 'none';

      // Render all quick actions (core + plugins)
      const renderButtons = ()=>{
        menu.innerHTML = '';
        let actions = (window.Yuuka?.plugins?.maidQuickActions || []).slice().sort((a,b)=> (a.order||0)-(b.order||0));
        // Limit maximum number of quick actions (excluding core settings) to 29
        if(actions.length > 29){
          actions = actions.slice(0, 29);
        }

        // Always include quick chat and core settings buttons
        actions.unshift({
          id: 'maid_core_settings',
          icon: 'settings_heart',
          title: 'Maid settings',
          order: -999,
          requireEnabled: false,
          handler: ({ bubble })=>{
            bubble?._openModal();
          }
        });
        actions.unshift({
          id: 'maid_quick_chat',
          icon: 'chat_bubble',
          title: 'Quick chat',
          order: -1000,
          requireEnabled: false,
          handler: ({ bubble })=>{
            if(bubble){
              bubble._toggleQuickChatPanel();
            }
          }
        });

        const isFeatureEnabled = (fid)=>{
          if(!fid) return true;
          try{ const raw = localStorage.getItem(`maid-chan:feature:${fid}:enabled`); return raw? JSON.parse(raw): false; }catch(_e){ return false; }
        };

        actions.forEach(act=>{
          if(act.featureId && act.requireEnabled !== false && !isFeatureEnabled(act.featureId)) return;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'maid-quick-btn';
          btn.setAttribute('role', 'menuitem');
          if(act.title) btn.title = act.title;
          const icon = document.createElement('span');
          icon.className = 'material-symbols-outlined';
          icon.textContent = act.icon || 'bolt';
          btn.appendChild(icon);
          btn.addEventListener('click', (e)=>{
            e.stopPropagation();
            try{
              // Any quick action click re-enables idle so bubble can dim later
              this._idleDisabled = false;
              this._bumpActivity();
              act.handler({
                bubble: this,
                element: this.element,
                showMessage: (opts)=> this._showChatBubble(opts),
                openModal: ()=> this._openModal(),
                closeModal: ()=> this._closeModal()
              });
            }catch(err){ console.warn('[Maid-chan] quick action handler error', err); }
            this._hideQuickMenu();
          });
          menu.appendChild(btn);
        });
      };

      renderButtons();

      // When pointer is over the quick menu area, keep Maid awake
      menu.addEventListener('mouseenter', ()=>{
        this._idleDisabled = true;
        this._bumpActivity(null);
      });
      menu.addEventListener('mouseleave', ()=>{
        this._idleDisabled = false;
        this._bumpActivity();
      });

      // Close when clicking outside
      document.addEventListener('click', (e)=>{
        if(!this._quickMenu.isOpen) return;
        if(this.element && this.element.contains(e.target)) return;
        if(menu.contains(e.target)) return;
        // User clicked somewhere else: allow idle again
        this._idleDisabled = false;
        this._bumpActivity();
        this._hideQuickMenu();
      });

      document.body.appendChild(menu);
      this._quickMenu.el = menu;
      this._positionQuickMenu();
      return menu;
    }

    _positionQuickMenu(){
      const menu = this._quickMenu.el;
      if(!menu || !this.element) return;
      const r = this.element.getBoundingClientRect();
      const gap = 6;
      const menuWidth = menu.offsetWidth || 40;
      const menuHeight = menu.offsetHeight || 40;
      // Center horizontally: bubble center minus half menu width, with a tiny tweak
      // for sub-pixel rendering so it looks visually centered.
      const x = (r.left + r.right) / 2 - (menuWidth / 2) - 10;
      const y = r.bottom + gap;
      const clampedX = Math.max(4, Math.min(x, window.innerWidth - menuWidth - 4));
      const clampedY = Math.min(y, window.innerHeight - menuHeight - 4);
      menu.style.left = `${clampedX}px`;
      menu.style.top = `${clampedY}px`;
    }

    _showQuickMenu(){
      const menu = this._ensureQuickMenu();
      menu.classList.remove('mc-leave');
      this._quickMenu.isOpen = true;
      // First position off-screen to measure proper size, then center
      menu.style.visibility = 'hidden';
      menu.style.display = 'flex';
      this._positionQuickMenu();
      // Now animate it in
      menu.style.visibility = 'visible';
      // force reflow to restart animation
      void menu.offsetWidth;
      menu.classList.add('mc-enter');
    }

    _hideQuickMenu(){
      const menu = this._quickMenu.el;
      if(!menu) return;
      menu.classList.remove('mc-enter');
      menu.classList.add('mc-leave');
      this._quickMenu.isOpen = false;
      const done = ()=>{
        menu.removeEventListener('animationend', done);
        if(!this._quickMenu.isOpen){ menu.style.display = 'none'; }
      };
      menu.addEventListener('animationend', done);
    }

    _toggleQuickMenu(){
      if(this._quickMenu.isOpen) this._hideQuickMenu();
      else this._showQuickMenu();
    }
  }

  // Register component for core system (if it auto-instantiates)
  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components['MaidChanComponent'] = MaidChanComponent;

  // Conditional auto-bootstrap: only if last session left it open
  const bootstrapIfNeeded = ()=>{
    try{
      const shouldOpen = JSON.parse(localStorage.getItem('maid-chan:isOpen') || 'false');
      if(!shouldOpen) return;
      if(window.Yuuka?.plugins?.maidChanInstance) return;
      const instance = new MaidChanComponent(document.body, window.Yuuka?.api);
      instance.open();
      window.Yuuka.plugins = window.Yuuka.plugins || {};
      window.Yuuka.plugins.maidChanInstance = instance;
    }catch(e){ /* ignore */ }
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bootstrapIfNeeded);
  }else{
    bootstrapIfNeeded();
  }
})();
