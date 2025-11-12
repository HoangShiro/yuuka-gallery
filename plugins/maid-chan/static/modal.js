// Maid-chan modal component extracted from maid_chan.js
(function(){
  class MaidChanModal {
    constructor(){
      this.overlay = null;
      this._escHandler = null;
      this._activeTab = this._load('maid-chan:lastTab', 'main');
      // Title (editable) loads from storage, default 'Maid-chan'
      this._title = this._load('maid-chan:title', 'Maid-chan');
      this._titleSaveTimer = null;
      this._els = { modal: null, tabsBar: null, panels: {} };
    }

    open(){
      if(this.overlay) return; // already open
      const overlay = document.createElement('div');
      overlay.className = 'maid-chan-modal-overlay';
      overlay.addEventListener('click', (e)=>{ if(e.target === overlay) this.close(); });

      const modal = document.createElement('div');
      modal.className = 'maid-chan-modal';
      this._els.modal = modal;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'maid-chan-close';
      closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
      closeBtn.addEventListener('click', ()=> this.close());
      modal.appendChild(closeBtn);

      const header = document.createElement('h2');
      header.setAttribute('role', 'heading');
      header.setAttribute('aria-level', '2');
      // Icon span
      const iconSpan = document.createElement('span');
      iconSpan.className = 'material-symbols-outlined';
      iconSpan.style.verticalAlign = 'middle';
      iconSpan.style.marginRight = '6px';
      iconSpan.textContent = 'digital_wellbeing';
      header.appendChild(iconSpan);
      // Editable title input
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'maid-chan-title-input';
      titleInput.value = this._title;
      titleInput.placeholder = 'Maid-chan';
      titleInput.setAttribute('aria-label', 'Maid-chan title');
      titleInput.setAttribute('maxlength', '48');
      header.appendChild(titleInput);
      // Autosave (debounced) + blur immediate save
      const commitTitle = () => {
        const raw = titleInput.value.trim();
        this._title = raw || 'Maid-chan';
        titleInput.value = this._title; // normalize empty -> default
        this._save('maid-chan:title', this._title);
      };
      titleInput.addEventListener('input', ()=>{
        if(this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
        this._titleSaveTimer = setTimeout(()=>{ commitTitle(); }, 500);
      });
      titleInput.addEventListener('blur', ()=>{
        if(this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
        commitTitle();
      });
      titleInput.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter'){
          e.preventDefault();
          titleInput.blur();
        }
      });
      modal.appendChild(header);

      // Tabs bar
      const tabsBar = document.createElement('div');
      tabsBar.className = 'maid-chan-tabs';
      tabsBar.innerHTML = `
        <div class="maid-chan-tab-buttons" role="tablist" aria-label="Maid-chan Tabs">
          <button role="tab" data-tab="main" aria-selected="false">Main</button>
          <button role="tab" data-tab="settings" aria-selected="false">Settings</button>
        </div>
      `;
      modal.appendChild(tabsBar);
      this._els.tabsBar = tabsBar;

      // Panels
      const mainPanel = document.createElement('div');
      mainPanel.className = 'maid-chan-tab-panel';
      mainPanel.setAttribute('role', 'tabpanel');
      mainPanel.setAttribute('data-tab', 'main');
      // Feature frame: a reusable card template that modules can mount content into
      mainPanel.innerHTML = `
        <div class="maid-chan-panel-card">
          <div class="maid-chan-features-header">
            <div class="maid-chan-features-title">Features</div>
            <div class="maid-chan-features-actions">
              <button class="maid-chan-features-disable-all" title="Turn off all features">Turn off all</button>
            </div>
          </div>

          <div class="maid-chan-features-container" aria-live="polite"></div>

          <template id="maid-chan-feature-template">
            <section class="maid-chan-feature" data-feature-id="">
              <div class="feature-toggle-panel" aria-label="Feature toggle area">
                <label class="mc-switch" title="Enable/Disable feature">
                  <input type="checkbox" class="feature-toggle" role="switch" aria-checked="false" aria-label="Enable feature" />
                  <span class="mc-slider"></span>
                </label>
              </div>
              <div class="feature-content-panel" tabindex="0" aria-label="Feature content area"></div>
            </section>
          </template>
        </div>
      `;

      const settingsPanel = document.createElement('div');
      settingsPanel.className = 'maid-chan-tab-panel';
      settingsPanel.setAttribute('role', 'tabpanel');
      settingsPanel.setAttribute('data-tab', 'settings');
      settingsPanel.innerHTML = `
        <div class="maid-chan-panel-card">
          <div class="maid-chan-upload">
            <div class="maid-chan-upload-header">Maid avatar</div>
            <div class="maid-chan-upload-body">
              <div class="maid-chan-upload-preview" tabindex="0" role="button" aria-label="Choose avatar image (GIF supported)" title="Click to choose an image (GIF supported)">
                <img alt="Avatar preview" />
              </div>
              <div class="maid-chan-upload-controls">
                <input type="file" accept="image/*,.gif" class="maid-chan-upload-input maid-chan-visually-hidden" />
                <button class="maid-chan-upload-btn" disabled>Save</button>
                <div class="maid-chan-upload-hint">Click the preview to choose an image. PNG/JPEG/WebP/GIF. Will be center-cropped and resized to 256×256.</div>
                <div class="maid-chan-upload-status" aria-live="polite"></div>
              </div>
            </div>
          </div>
        </div>
        <footer>Tip: Right-click (desktop) or long-press (touch) to open this menu. Drop/paste an image onto the bubble to set an avatar.</footer>
      `;

      modal.appendChild(mainPanel);
      modal.appendChild(settingsPanel);
      this._els.panels = { main: mainPanel, settings: settingsPanel };

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      this.overlay = overlay;

      // Wire tab events
      this._wireTabs();
      this._switchTab(this._activeTab);
      // Initialize feature frame helper API before external modules mount
      if(this._els.panels.main){
        try { this._initMainFeatureFrame(this._els.panels.main); } catch(e){ /* ignore */ }
      }
      // Initialize external tab modules
      if(this._els.panels.settings){
        try { window.Yuuka?.components?.MaidChanSettings?.init?.(this._els.panels.settings); } catch(e){ /* ignore */ }
      }
      if(this._els.panels.main){
        try { window.Yuuka?.components?.MaidChanMain?.init?.(this._els.panels.main); } catch(e){ /* ignore */ }
      }

      // ESC to close
      this._escHandler = (e)=>{ if(e.key === 'Escape') this.close(); };
      document.addEventListener('keydown', this._escHandler);
    }

    // Expose a tiny helper for registering feature cards inside the Main tab
    _initMainFeatureFrame(panelEl){
      const container = panelEl.querySelector('.maid-chan-features-container');
      const template = panelEl.querySelector('#maid-chan-feature-template');
      const disableAllBtn = panelEl.querySelector('.maid-chan-features-disable-all');
      if(!container || !template) return;

      const save = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_e){} };
      const load = (k, fb)=>{ try{ const r = localStorage.getItem(k); return r? JSON.parse(r): fb; }catch(_e){ return fb; } };

      const FEATURE_NS = 'maid-chan:feature:';

      const createCard = ({ id, defaultEnabled=true, title, description, mount, unmount })=>{
        if(!id) throw new Error('Feature requires a stable id');
        // If this feature already exists in current container, return a handle to it instead of duplicating
        const existing = container.querySelector(`.maid-chan-feature[data-feature-id="${id}"]`);
        if(existing){
          const existingToggle = existing.querySelector('.feature-toggle');
          const existingContent = existing.querySelector('.feature-content-panel');
          return {
            el: existing,
            contentEl: existingContent,
            toggleEl: existingToggle,
            setEnabled: (v)=>{
              const inp = existing.querySelector('.feature-toggle');
              if(inp && Boolean(inp.checked) !== Boolean(v)){
                inp.checked = !!v;
                inp.dispatchEvent(new Event('change', { bubbles: true }));
              }
            },
            isEnabled: ()=> !!existing.querySelector('.feature-toggle')?.checked
          };
        }
        const frag = template.content.cloneNode(true);
        const el = frag.querySelector('.maid-chan-feature');
        const toggle = frag.querySelector('.feature-toggle');
        const content = frag.querySelector('.feature-content-panel');
        el.dataset.featureId = id;

        // Optional persistent header title (outside content panel so it won't be cleared by feature unmounts)
        if(title){
          const h = document.createElement('div');
          h.className = 'feature-title';
          h.textContent = title;
          // insert title before content panel
          content.parentNode.insertBefore(h, content);
        }

  // Optional description shown only when feature is disabled
  // Keep it detached by default; we'll attach it after unmount (disabled state)
  const descEl = document.createElement('div');
  descEl.className = 'feature-desc';
  if(description){ descEl.textContent = description; }

        const key = FEATURE_NS + id + ':enabled';
        const initial = !!load(key, defaultEnabled);
        const apply = (on)=>{
          toggle.checked = !!on;
          toggle.setAttribute('aria-checked', on? 'true':'false');
          el.classList.toggle('is-enabled', !!on);
          try{
            if(on){ mount && mount(content, { id }); }
            else { unmount && unmount(content, { id }); content.dataset.mounted = 'false'; }
          }catch(_e){ /* swallow */ }
          save(key, !!on);
          // Show description only when disabled. Append after unmount to ensure it's not cleared.
          if(!on){
            if(description && !descEl.isConnected){ content.appendChild(descEl); }
          }else{
            if(descEl.isConnected){ descEl.remove(); }
          }
        };

        toggle.addEventListener('change', ()=> apply(toggle.checked));

        container.appendChild(el);
        // Defer mount to next frame for smoother UI
        requestAnimationFrame(()=> apply(initial));

        return { el, contentEl: content, toggleEl: toggle, setEnabled: (v)=> apply(!!v), isEnabled: ()=> !!toggle.checked };
      };

      // Persistent registry of feature definitions so they survive modal close/reopen
      window.Yuuka = window.Yuuka || {}; window.Yuuka.components = window.Yuuka.components || {}; window.Yuuka.plugins = window.Yuuka.plugins || {};
      const registry = (window.Yuuka.plugins.maidMainFeatures = window.Yuuka.plugins.maidMainFeatures || []);

      const registerPersistent = (def)=>{
        if(!def || !def.id) return null;
        const idx = registry.findIndex(d=> d && d.id === def.id);
        if(idx >= 0){ registry[idx] = { ...registry[idx], ...def }; }
        else { registry.push(def); }
        // Mount into current container (idempotent due to createCard duplicate guard)
        try { return createCard(def); } catch(_e){ return null; }
      };

      // Global helper for other modules (stable across modal instances)
      window.Yuuka.components.MaidChanMainFrame = {
        getContainer: ()=> container,
        createFeatureCard: createCard,
        registerFeature: registerPersistent,
        listRegistered: ()=> registry.slice()
      };

      // Auto-mount any previously registered features into this fresh container
      try{ registry.forEach(def=>{ createCard(def); }); }catch(_e){ /* ignore */ }

      // Disable all button: turn off every feature toggle
      if(disableAllBtn){
        disableAllBtn.addEventListener('click', ()=>{
          const toggles = container.querySelectorAll('.feature-toggle');
          toggles.forEach(inp=>{
            if(inp.checked){ inp.checked = false; inp.dispatchEvent(new Event('change', { bubbles: true })); }
          });
        });
      }
    }

    close(){
      if(!this.overlay) return;
      document.removeEventListener('keydown', this._escHandler);
      this.overlay.remove();
      this.overlay = null;
      this._escHandler = null;
      this._els = { modal: null, tabsBar: null, panels: {} };
    }

    _wireTabs(){
      const buttons = this._els.tabsBar?.querySelectorAll('[role="tab"]') || [];
      buttons.forEach(btn=>{
        btn.addEventListener('click', ()=> this._switchTab(btn.dataset.tab));
      });
    }

    _switchTab(name){
      if(!name) return;
      this._activeTab = name;
      this._save('maid-chan:lastTab', name);
      // buttons
      const buttons = this._els.tabsBar?.querySelectorAll('[role="tab"]') || [];
      buttons.forEach(btn=>{
        const active = btn.dataset.tab === name;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      // panels
      Object.entries(this._els.panels).forEach(([key, panel])=>{
        const active = key === name;
        panel.classList.toggle('active', active);
        if(active){ panel.removeAttribute('hidden'); }
        else { panel.setAttribute('hidden', ''); }
      });
    }


    _save(k, v){
      try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){ /* ignore */ }
    }
    _load(k, fb){
      try{ const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : fb; }catch(e){ return fb; }
    }
  }

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components.MaidChanModal = MaidChanModal;
})();
