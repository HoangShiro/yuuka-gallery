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
      // Chat bubbles state
      this._chat = { container: null, items: [] };
      // Quick menu state (uses maid idle timer for auto-hide)
      this._quickMenu = { el: null, isOpen: false };
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
        this.state.isDragging = true;
        const rect = el.getBoundingClientRect();
        this._dragOffset = {x: e.clientX - rect.left, y: e.clientY - rect.top};
        el.classList.add('is-dragging');
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
    _positionChatContainer(){
      const c = this._chat.container; if(!c || !this.element) return;
      const r = this.element.getBoundingClientRect();
      const gap = 10;
      const vw = window.innerWidth;
      const preferRightSpace = vw - (r.right + gap);
      const preferLeftSpace = r.left - gap;
      // Decide side: if not enough space on right (<340px) but left has space, use left.
      const needed = 340; // approximate bubble max width + margin
      const useLeft = preferRightSpace < needed && preferLeftSpace > needed;
      c.classList.toggle('left', useLeft);
      c.classList.toggle('right', !useLeft);
      c.style.position = 'fixed';
      if(useLeft){
        c.style.left = 'auto';
        c.style.right = `${Math.round(vw - r.left + gap)}px`; // anchor to left side of maid
      }else{
        c.style.left = `${Math.round(r.right + gap)}px`;
        c.style.right = 'auto';
      }
      c.style.top = `${Math.round(r.top)}px`;
      c.style.bottom = 'auto';
    }
    _showChatBubble({ text = '', duration = 5000, type = 'info' } = {}){
      const c = this._ensureChatContainer();
      const item = document.createElement('div');
      item.className = `maid-chat-bubble type-${type}`;
      item.setAttribute('role', 'status');
      item.setAttribute('aria-live', 'polite');
      const content = document.createElement('div');
      content.className = 'maid-chat-text';
      content.textContent = String(text || '');
      item.appendChild(content);

      // enter animation
      item.classList.add('enter');
      c.appendChild(item);
      this._positionChatContainer();

      const removeItem = ()=>{
        if(!item.isConnected) return;
        item.classList.remove('enter');
        item.classList.add('leaving');
        const finish = ()=>{ try{ item.removeEventListener('animationend', finish); item.remove(); }catch(_){} };
        item.addEventListener('animationend', finish);
        // Fallback remove
        setTimeout(finish, 600);
      };

  const tId = setTimeout(removeItem, Math.max(1000, duration|0 || 5000));
      item.addEventListener('click', (e)=>{ if(e.target === item || e.target === content){ clearTimeout(tId); removeItem(); }});

      this._chat.items.push({ el: item, timer: tId, remove: removeItem });
      // Cleanup array on removal
      const obs = new MutationObserver(()=>{
        if(!item.isConnected){
          this._chat.items = this._chat.items.filter(x=> x.el !== item);
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

        // Always include core settings button
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
