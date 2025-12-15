// Maid-chan modal component extracted from maid_chan.js
(function(){
  // Early global registry + stub so features can register before modal opens
  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.plugins = window.Yuuka.plugins || {};
  const __maidFeatureRegistry = (window.Yuuka.plugins.maidMainFeatures = window.Yuuka.plugins.maidMainFeatures || []);
  if(!window.Yuuka.components.MaidChanMainFrame){
    window.Yuuka.components.MaidChanMainFrame = {
      getContainer: ()=> null,
      createFeatureCard: ()=> null,
      registerFeature: (def)=>{
        if(!def || !def.id) return null;
        const i = __maidFeatureRegistry.findIndex(d=> d && d.id === def.id);
        if(i >= 0) __maidFeatureRegistry[i] = { ...__maidFeatureRegistry[i], ...def };
        else __maidFeatureRegistry.push(def);
        return def;
      },
      listRegistered: ()=> __maidFeatureRegistry.slice()
    };
  }
  class MaidChanModal {
    constructor(){
      this.overlay = null;
      this._escHandler = null;
      this._activeTab = this._load('maid-chan:lastTab', 'features');
      // Title (editable) loads from storage, default 'Maid-chan'
      this._title = this._load('maid-chan:title', 'Maid-chan');
      this._titleSaveTimer = null;
      this._els = { modal: null, tabsBar: null, panels: {} };
      this._vvHandlers = [];
    }

    open(){
      if(this.overlay) return; // already open
      const overlay = document.createElement('div');
      overlay.className = 'maid-chan-modal-overlay';
      overlay.addEventListener('click', (e)=>{ if(e.target === overlay) this.close(); });
      // Giữ overlay full-screen cố định, để CSS + 100vh xử lý chiều cao.
      // Không dịch chuyển overlay theo visualViewport nữa để tránh lệch layout
      // ở các trình duyệt mobile khác nhau.
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.boxSizing = 'border-box';

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
        // Live-update persona label if present
        try {
          this._updatePersonaMaidLabel(titleInput.value || 'Maid-chan');
        } catch(_e){}
      });
      titleInput.addEventListener('blur', ()=>{
        if(this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
        commitTitle();
        try {
          this._updatePersonaMaidLabel(titleInput.value || 'Maid-chan');
        } catch(_e){}
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
          <button role="tab" data-tab="chat" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">chat_bubble</span>
            <span class="maid-chan-tab-label">Chat</span>
          </button>
          <button role="tab" data-tab="persona" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">person_heart</span>
            <span class="maid-chan-tab-label">Persona</span>
          </button>
          <button role="tab" data-tab="features" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">app_registration</span>
            <span class="maid-chan-tab-label">Features</span>
          </button>
          <button role="tab" data-tab="ability" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">code_blocks</span>
            <span class="maid-chan-tab-label">Ability</span>
          </button>
          <button role="tab" data-tab="settings" aria-selected="false">
            <span class="material-symbols-outlined" aria-hidden="true">settings_heart</span>
            <span class="maid-chan-tab-label">Settings</span>
          </button>
        </div>
      `;
      modal.appendChild(tabsBar);
      this._els.tabsBar = tabsBar;

      // Panels
      const chatPanel = document.createElement('div');
      chatPanel.className = 'maid-chan-tab-panel';
      chatPanel.setAttribute('role', 'tabpanel');
      chatPanel.setAttribute('data-tab', 'chat');

      const mainPanel = document.createElement('div');
      mainPanel.className = 'maid-chan-tab-panel';
      mainPanel.setAttribute('role', 'tabpanel');
      mainPanel.setAttribute('data-tab', 'features');
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

      const personaPanel = document.createElement('div');
      personaPanel.className = 'maid-chan-tab-panel';
      personaPanel.setAttribute('role', 'tabpanel');
      personaPanel.setAttribute('data-tab', 'persona');
      personaPanel.innerHTML = `
        <div class="maid-chan-panel-card maid-chan-persona-card">
          <div class="maid-chan-persona-header">
            <div class="maid-chan-persona-title">Persona notes</div>
          </div>
          <div class="maid-chan-persona-body">
            <div class="maid-chan-persona-field">
              <label class="maid-chan-persona-label maid-chan-persona-label-maid">About &lt;maid_name&gt;</label>
              <textarea class="maid-chan-persona-textarea" data-key="maid-chan:persona:aboutMaid" placeholder="Ví dụ: tính cách, cách xưng hô, giọng nói, bối cảnh anime maid..."></textarea>
            </div>
            <div class="maid-chan-persona-field">
              <label class="maid-chan-persona-label">About you</label>
              <textarea class="maid-chan-persona-textarea" data-key="maid-chan:persona:aboutUser" placeholder="Ví dụ: bạn thích kiểu reply nào, sở thích, điều Maid-chan cần lưu ý..."></textarea>
            </div>
            <div class="maid-chan-persona-field">
              <label class="maid-chan-persona-label">
                <span class="maid-chan-persona-samples-label">Chat samples</span>
                <span class="maid-chan-persona-samples-count">(0)</span>
              </label>
              <textarea class="maid-chan-persona-textarea" data-key="maid-chan:persona:chatSamples" placeholder="Vài đoạn hội thoại mẫu giữa bạn và Maid-chan để giữ đúng vibe anime maid..."></textarea>
            </div>
          </div>
        </div>
      `;

      const abilityPanel = document.createElement('div');
      abilityPanel.className = 'maid-chan-tab-panel';
      abilityPanel.setAttribute('role', 'tabpanel');
      abilityPanel.setAttribute('data-tab', 'ability');
      abilityPanel.innerHTML = `
        <div class="maid-chan-panel-card">
          <div class="maid-chan-ability-header">
            <div class="maid-chan-ability-title">Capabilities</div>
            <div class="maid-chan-ability-actions">
              <button class="maid-chan-ability-refresh" title="Refresh capability list">Refresh</button>
            </div>
          </div>
          <div class="maid-chan-ability-body">
            <!-- capability groups will be rendered here -->
          </div>
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

          <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:16px 0;" />

          <div class="maid-chan-llm-settings">
            <div class="maid-chan-llm-row">
              <div class="maid-chan-llm-label">LLM Provider</div>
              <div class="maid-chan-llm-provider-row">
                <select class="maid-chan-llm-provider">
                  <option value="openai">OpenAI / compatible</option>
                  <option value="gemini">Gemini</option>
                  <option value="lmstudio">Local (LM Studio)</option>
                </select>
              </div>
            </div>

            <div class="maid-chan-llm-row maid-chan-llm-endpoint-row is-hidden">
              <div class="maid-chan-llm-label">IP</div>
              <input type="text" class="maid-chan-llm-endpoint" placeholder="http://127.0.0.1:1234" />
            </div>

            <div class="maid-chan-llm-row">
              <div class="maid-chan-llm-label">API key</div>
              <div class="maid-chan-llm-apikey-row">
                <input type="password" class="maid-chan-llm-apikey" placeholder="Enter API key" />
                <button type="button" class="maid-chan-llm-connect">Connect</button>
              </div>
            </div>

            <div class="maid-chan-llm-row maid-chan-llm-models-wrapper">
              <div class="maid-chan-llm-label">Model</div>
              <select class="maid-chan-llm-models" disabled>
                <option value="">Press Connect to load models</option>
              </select>
            </div>

            <div class="maid-chan-llm-row">
              <div class="maid-chan-llm-label">Generation</div>
              <div class="maid-chan-llm-sliders">
                <div class="maid-chan-llm-slider-row">
                  <div class="maid-chan-llm-slider-label">Temperature</div>
                  <div class="maid-chan-llm-slider-input">
                    <input type="range" min="0" max="2" step="0.01" class="maid-chan-llm-slider-temp" />
                  </div>
                  <div class="maid-chan-llm-slider-value maid-chan-llm-slider-temp-value">1.00</div>
                </div>

                <div class="maid-chan-llm-slider-row">
                  <div class="maid-chan-llm-slider-label">Top-p</div>
                  <div class="maid-chan-llm-slider-input">
                    <input type="range" min="0" max="1" step="0.01" class="maid-chan-llm-slider-top-p" />
                  </div>
                  <div class="maid-chan-llm-slider-value maid-chan-llm-slider-top-p-value">1.00</div>
                </div>

                <div class="maid-chan-llm-slider-row">
                  <div class="maid-chan-llm-slider-label">Max tokens</div>
                  <div class="maid-chan-llm-slider-input">
                    <input type="range" min="16" max="4096" step="16" class="maid-chan-llm-slider-max-tokens" />
                  </div>
                  <div class="maid-chan-llm-slider-value maid-chan-llm-slider-max-tokens-value">512</div>
                </div>
              </div>
            </div>

            <div class="maid-chan-llm-status" aria-live="polite"></div>
          </div>
        </div>
        <footer>Tip: Right-click (desktop) or long-press (touch) to open this menu. Drop/paste an image onto the bubble to set an avatar.</footer>
      `;

      modal.appendChild(chatPanel);
      modal.appendChild(personaPanel);
      modal.appendChild(mainPanel);
      modal.appendChild(abilityPanel);
      modal.appendChild(settingsPanel);
      this._els.panels = { chat: chatPanel, features: mainPanel, persona: personaPanel, ability: abilityPanel, settings: settingsPanel };

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      this.overlay = overlay;

      // Wire tab events
      this._wireTabs();
      // default to chat tab if first time
      if(!this._activeTab){ this._activeTab = 'chat'; }
      this._switchTab(this._activeTab);
      // Initialize feature frame helper API before external modules mount
      if(this._els.panels.features){
        try { this._initMainFeatureFrame(this._els.panels.features); } catch(e){ /* ignore */ }
      }
      // Initialize chat tab
      if(this._els.panels.chat){
        try { window.Yuuka?.components?.MaidChanChatPanel?.init?.(this._els.panels.chat); } catch(e){ /* ignore */ }
      }
      // Initialize persona tab
      if(this._els.panels.persona){
        try { this._initPersonaTab(this._els.panels.persona); } catch(e){ /* ignore */ }
      }
      // Initialize ability tab (capability list)
      if(this._els.panels.ability){
        try { this._initAbilityTab(this._els.panels.ability); } catch(e){ /* ignore */ }
      }
      // Initialize external tab modules
      if(this._els.panels.settings){
        try {
          window.Yuuka?.components?.MaidChanSettings?.init?.(this._els.panels.settings);
        } catch(e){ /* ignore */ }
        // Ensure LLM settings UI is wired even if MaidChanSettings is missing
        try {
          window.Yuuka?.components?.MaidChanLLMSettings?.init?.(this._els.panels.settings);
        } catch(e){ /* ignore */ }
      }
      if(this._els.panels.features){
        try { window.Yuuka?.components?.MaidChanMain?.init?.(this._els.panels.features); } catch(e){ /* ignore */ }
      }

      // Ensure Persona label reflects current title on first open
      try {
        this._updatePersonaMaidLabel(this._title || 'Maid-chan');
      } catch(_e){}

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

      // Ensure Logic UI feature is present even if its module hasn't loaded yet
      try{
        const hasLogic = registry.some(d=> d && d.id === 'logic_ui');
        if(!hasLogic){
          const computeStaticBase = ()=>{
            try{
              const scripts = Array.from(document.querySelectorAll('script[src]'));
              for(const s of scripts){
                const src = s.getAttribute('src');
                if(!src) continue;
                const i = src.indexOf('/static/');
                if(i > 0 && src.includes('maid-chan')){
                  return src.slice(0, i + '/static'.length);
                }
              }
            }catch(_e){}
            // Fallback guess
            return '/plugins/maid-chan/static';
          };

          registerPersistent({
            id: 'logic_ui',
            title: 'AI Logic Editor',
            description: 'Configure a node-based workflow that routes LLM requests. Toggle ON to enable routing via this logic instead of legacy.',
            defaultEnabled: false,
            mount(el){
              const wrap = document.createElement('div');
              const p = document.createElement('div'); p.style.marginBottom='8px'; p.textContent = 'Edit how Maid-chan builds prompts, uses tools, and routes outputs.';
              const btn = document.createElement('button'); btn.className = 'maid-chan-chat-btn'; btn.textContent = 'Open Logic Editor';
              btn.addEventListener('click', ()=>{
                const openFn = ()=> window.Yuuka?.components?.MaidChanLogicUI?.open?.();
                if(openFn){ openFn(); return; }
                // Lazy-load the module
                const base = computeStaticBase();
                const url = base + '/main/logic_ui.js';
                const s = document.createElement('script'); s.src = url; s.async = true;
                s.onload = ()=>{
                  try{ window.Yuuka?.components?.MaidChanLogicUI?.open?.(); }catch(_e){}
                };
                s.onerror = ()=>{
                  try{
                    const status = document.createElement('div'); status.style.marginTop='6px'; status.style.opacity='.8'; status.textContent = 'Failed to load logic UI script: ' + url;
                    wrap.appendChild(status);
                  }catch(_e){}
                };
                document.head.appendChild(s);
              });
              wrap.appendChild(p); wrap.appendChild(btn); el.appendChild(wrap);
            },
            unmount(el){ while(el.firstChild) el.removeChild(el.firstChild); }
          });
        }
      }catch(_e){ /* ignore fallback feature errors */ }
    }

    // Initialize Ability tab: grouped capability list with toggles (styled like Main tab)
    _initAbilityTab(panelEl){
      const bodyEl = panelEl.querySelector('.maid-chan-ability-body');
      const refreshBtn = panelEl.querySelector('.maid-chan-ability-refresh');
      const titleEl = panelEl.querySelector('.maid-chan-ability-title');
      if(!bodyEl) return;

      const capsService = window.Yuuka?.services?.capabilities;
      const save = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_e){} };
      const load = (k, fb)=>{ try{ const r = localStorage.getItem(k); return r? JSON.parse(r): fb; }catch(_e){ return fb; } };
      const CAP_NS = 'maid-chan:capability:';

      const render = ()=>{
        if(!capsService){
          bodyEl.innerHTML = '<div class="maid-chan-ability-empty">Capabilities service is not available.</div>';
          return;
        }
        const all = capsService.list();
        if(!all.length){
          bodyEl.innerHTML = '<div class="maid-chan-ability-empty">No capabilities registered yet.</div>';
          if(titleEl){
            titleEl.innerHTML = 'Capabilities <span class="maid-chan-ability-count">(0)</span>';
          }
          return;
        }

        // Update overall capabilities title with total count
        if(titleEl){
          const totalCount = all.length;
          titleEl.innerHTML = `Capabilities <span class="maid-chan-ability-count">(${totalCount})</span>`;
        }

        // Group by pluginId
        const groups = new Map();
        all.forEach(c => {
          const pid = c.pluginId || 'core';
          if(!groups.has(pid)) groups.set(pid, []);
          groups.get(pid).push(c);
        });

        // Sort groups and items
        const sortedPluginIds = Array.from(groups.keys()).sort();
        const htmlParts = [];

        sortedPluginIds.forEach(pluginId => {
          const caps = groups.get(pluginId).slice().sort((a,b)=> (a.id||'').localeCompare(b.id||''));
          const groupKey = CAP_NS + pluginId + ':enabledAll';
          const groupEnabled = !!load(groupKey, true);
          const groupCount = caps.length;

          const itemsHTML = caps.map(c => {
            const llm = c.llmCallable ? '<span class="maid-chan-ability-tag">LLM</span>' : '';
            const desc = (c.description || '').trim();
            const type = (c.type || 'action');
            const capKey = CAP_NS + pluginId + ':' + (c.id || '');
            const enabled = !!load(capKey, groupEnabled);
            return `
              <div class="maid-chan-ability-item maid-chan-feature ${enabled ? 'is-enabled' : ''}" data-cap-id="${c.id}" data-plugin-id="${pluginId}">
                <div class="feature-toggle-panel">
                  <button type="button" class="maid-chan-ability-playground-toggle" title="Toggle playground">
                    <span class="material-symbols-outlined">terminal</span>
                  </button>
                  <label class="mc-switch" title="Enable/Disable capability">
                    <input type="checkbox" class="cap-toggle" role="switch" aria-checked="${enabled ? 'true':'false'}" ${enabled ? 'checked' : ''} />
                    <span class="mc-slider"></span>
                  </label>
                </div>
                <div class="maid-chan-ability-item-main feature-content-panel" tabindex="0">
                  <div class="maid-chan-ability-row maid-chan-ability-row-main">
                    <div class="maid-chan-ability-name">${c.title || c.id}</div>
                    <div class="maid-chan-ability-meta">
                      <span class="maid-chan-ability-plugin">${pluginId}</span>
                      <span class="maid-chan-ability-type">${type}</span>
                      ${llm}
                    </div>
                  </div>
                  ${desc ? `<div class="maid-chan-ability-row maid-chan-ability-row-desc"><div class="maid-chan-ability-desc">${desc}</div></div>` : ''}
                </div>
                <div class="maid-chan-ability-playground" data-playground="1">
                  <div class="maid-chan-ability-playground-inner">
                    <div class="maid-chan-ability-playground-input">
                      <label class="prompt-suggest-field-label">Payload</label>
                      <textarea class="maid-chan-ability-payload" rows="4" spellcheck="false"></textarea>
                    </div>
                    <div class="maid-chan-ability-playground-actions">
                      <button type="button" class="maid-chan-ability-run">Run</button>
                      <button type="button" class="maid-chan-ability-reset">Reset</button>
                    </div>
                    <div class="maid-chan-ability-playground-result" aria-live="polite"></div>
                  </div>
                </div>
              </div>
            `;
          }).join('');

          htmlParts.push(`
            <section class="maid-chan-cap-group" data-plugin-id="${pluginId}">
              <div class="maid-chan-features-header maid-chan-ability-header">
                <div class="maid-chan-features-title maid-chan-ability-title">${pluginId} <span class="maid-chan-ability-count">(${groupCount})</span></div>
                <div class="maid-chan-features-actions maid-chan-ability-actions">
                  <button class="maid-chan-ability-toggle-all" data-plugin-id="${pluginId}" title="Toggle all capabilities for this plugin">Toggle all</button>
                </div>
              </div>
              <div class="maid-chan-ability-group-list">
                ${itemsHTML}
              </div>
            </section>
          `);
        });

        bodyEl.innerHTML = htmlParts.join('');

        // Wire per-capability toggles for persistence + styling
        bodyEl.querySelectorAll('.maid-chan-ability-item').forEach(itemEl => {
          const capId = itemEl.dataset.capId;
          const pluginId = itemEl.dataset.pluginId;
          const toggle = itemEl.querySelector('.cap-toggle');
          if(!toggle || !capId || !pluginId) return;
          const capKey = CAP_NS + pluginId + ':' + capId;
          toggle.addEventListener('change', () => {
            const on = !!toggle.checked;
            toggle.setAttribute('aria-checked', on ? 'true':'false');
            itemEl.classList.toggle('is-enabled', on);
            save(capKey, on);
          });

          // Playground wiring
          const capDef = all.find(c => c.id === capId && (c.pluginId || 'core') === pluginId);
          const pgToggle = itemEl.querySelector('.maid-chan-ability-playground-toggle');
          const pgRoot = itemEl.querySelector('.maid-chan-ability-playground');
          const pgInput = itemEl.querySelector('.maid-chan-ability-payload');
          const pgRun = itemEl.querySelector('.maid-chan-ability-run');
          const pgReset = itemEl.querySelector('.maid-chan-ability-reset');
          const pgResult = itemEl.querySelector('.maid-chan-ability-playground-result');
          if(!pgToggle || !pgRoot || !pgInput || !pgRun || !pgReset || !pgResult) return;

          const playgroundKey = CAP_NS + pluginId + ':' + capId + ':playgroundPayload';
          const example = capDef && capDef.example ? capDef.example : null;
          const defaultPayload = example && typeof example.defaultPayload !== 'undefined'
            ? example.defaultPayload
            : (capDef && capDef.paramsSchema ? { } : '');
          const storedPayload = load(playgroundKey, null);
          const initialPayload = storedPayload !== null ? storedPayload : defaultPayload;

          const serialize = (val)=>{
            if(val == null) return '';
            if(typeof val === 'string') return val;
            try{ return JSON.stringify(val, null, 2); }catch(_e){ return String(val); }
          };
          const parse = (text)=>{
            const trimmed = text.trim();
            if(!trimmed) return {};
            try{ return JSON.parse(trimmed); }catch(_e){ return trimmed; }
          };

          pgInput.value = serialize(initialPayload);

          // Inject preset payload buttons next to the label if variants exist
          try {
            const labelEl = itemEl.querySelector('.maid-chan-ability-playground-input .prompt-suggest-field-label');
            if (labelEl && example && Array.isArray(example.variants) && example.variants.length) {
              const presetsContainer = document.createElement('span');
              presetsContainer.className = 'maid-chan-ability-presets';

              example.variants.forEach((variant, idx) => {
                if (!variant || typeof variant.payload === 'undefined') return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'maid-chan-ability-preset-btn';
                btn.textContent = variant.name || `Preset ${idx + 1}`;
                btn.title = variant.notes || '';
                btn.addEventListener('click', () => {
                  const payloadToApply = variant.payload;
                  pgInput.value = serialize(payloadToApply);
                  save(playgroundKey, payloadToApply);
                  pgResult.textContent = '';
                  pgResult.dataset.kind = '';
                });
                presetsContainer.appendChild(btn);
              });

              if (presetsContainer.childElementCount > 0) {
                labelEl.appendChild(presetsContainer);
              }
            }
          } catch(_e) {/* ignore UI preset errors */}

          // Start collapsed via CSS (max-height:0); toggle .is-expanded on the item
          itemEl.classList.remove('is-expanded');

          pgToggle.addEventListener('click', ()=>{
            const expanded = itemEl.classList.toggle('is-expanded');
            // no-op: CSS handles visibility via .is-expanded
          });

          pgReset.addEventListener('click', ()=>{
            pgInput.value = serialize(defaultPayload);
            save(playgroundKey, defaultPayload);
            pgResult.textContent = '';
            pgResult.dataset.kind = '';
          });

          pgRun.addEventListener('click', async ()=>{
            if(!capDef) return;
            const raw = pgInput.value || '';
            const args = parse(raw);
            save(playgroundKey, args);
            pgResult.textContent = 'Running...';
            pgResult.dataset.kind = 'text';
            try{
              const res = await capsService.invoke(capDef.id, args, { source: 'maid-playground', pluginId });
              this._renderPlaygroundResult(pgResult, res);
            }catch(err){
              this._renderPlaygroundError(pgResult, err);
            }
          });
        });

        // Wire group "toggle all" buttons
        bodyEl.querySelectorAll('.maid-chan-ability-toggle-all').forEach(btn => {
          btn.addEventListener('click', () => {
            const pluginId = btn.dataset.pluginId;
            if(!pluginId) return;
            const groupKey = CAP_NS + pluginId + ':enabledAll';
            const current = !!load(groupKey, true);
            const next = !current;
            save(groupKey, next);
            const groupEl = bodyEl.querySelector(`.maid-chan-cap-group[data-plugin-id="${pluginId}"]`);
            if(!groupEl) return;
            const toggles = groupEl.querySelectorAll('.cap-toggle');
            toggles.forEach(inp => {
              if(!!inp.checked !== next){
                inp.checked = next;
                inp.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
          });
        });
      };

      render();

      if(refreshBtn){
        refreshBtn.addEventListener('click', ()=> render());
      }

      // React to runtime capability changes
      if(window.Yuuka?.events){
        try{
          const rebuilder = ()=> render();
          window.Yuuka.events.on('capability:registered', rebuilder);
          window.Yuuka.events.on('capability:unregistered', rebuilder);
        }catch(_e){/* ignore */}
      }
    }

    _updatePersonaMaidLabel(rawTitle){
      const name = (rawTitle || '').trim() || 'Maid-chan';
      const labelText = `About ${name}`;
      const root = this._els && this._els.panels && this._els.panels.persona;
      if(!root) return;
      const label = root.querySelector('.maid-chan-persona-label-maid');
      if(label) label.textContent = labelText;
    }

    // Generic renderer for playground result payloads
    _renderPlaygroundResult(container, value){
      if(!container) return;
      container.innerHTML = '';
      container.dataset.kind = '';

      const isBlobLike = (v)=> v && typeof v === 'object' && typeof v.type === 'string' && typeof v.data === 'string';

      const renderText = (txt)=>{
        const pre = document.createElement('pre');
        pre.textContent = txt;
        container.appendChild(pre);
        container.dataset.kind = 'text';
      };

      if(isBlobLike(value)){
        const { type, data } = value;
        if(type.startsWith('image/')){
          const img = document.createElement('img');
          img.src = data;
          img.alt = 'Capability image result';
          container.appendChild(img);
          container.dataset.kind = 'image';
          return;
        }
        if(type.startsWith('audio/')){
          const audio = document.createElement('audio');
          audio.controls = true;
          audio.src = data;
          container.appendChild(audio);
          container.dataset.kind = 'audio';
          return;
        }
        if(type.startsWith('video/')){
          const video = document.createElement('video');
          video.controls = true;
          video.src = data;
          container.appendChild(video);
          container.dataset.kind = 'video';
          return;
        }
      }

      if(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'){
        renderText(String(value));
        return;
      }

      try{
        const pretty = JSON.stringify(value, null, 2);
        renderText(pretty);
      }catch(_e){
        renderText(String(value));
      }
    }

    // Persona tab: multi-textarea with autosave + auto-resize
    _initPersonaTab(panelEl){
      if(!panelEl) return;
      const areas = panelEl.querySelectorAll('.maid-chan-persona-textarea');
      if(!areas.length) return;

      // Helper: parse chat samples using same rules as AI core
      const parseChatSamples = (personaChatSamples)=>{
        if(!personaChatSamples) return [];
        const lines = personaChatSamples.split(/\r?\n/);
        const messages = [];

        for(const rawLine of lines){
          if(!rawLine) continue;
          const line = String(rawLine).trim();
          if(!line) continue;

          const m = /^([^:]+):\s*(.*)$/.exec(line);
          if(!m) continue;

          const prefix = m[1].trim();
          const text = m[2].trim();
          if(!text) continue;

          const p = prefix.toLowerCase();

          const isMaid = (
            p === 'char' ||
            p === '{{char}}' ||
            p === 'maid' ||
            /^<[^>]+>$/.test(prefix)
          );

          const isUser = (
            p === 'user' ||
            p === '{{user}}' ||
            /^<[^>]+>$/.test(prefix)
          );

          if(isMaid && !isUser){
            messages.push({ role: 'assistant', content: text });
          }else if(isUser && !isMaid){
            messages.push({ role: 'user', content: text });
          }
        }

        return messages;
      };

      const autoResize = (ta)=>{
        ta.style.height = 'auto';
        ta.style.height = (ta.scrollHeight || 0) + 'px';
      };

      const updateSamplesCount = ()=>{
        try{
          const samplesRaw = this._load('maid-chan:persona:chatSamples', '');
          const samples = parseChatSamples(samplesRaw);
          const count = Array.isArray(samples) ? samples.length : 0;
          const counterEl = panelEl.querySelector('.maid-chan-persona-samples-count');
          if(counterEl){
            counterEl.textContent = `(${count})`;
          }
        }catch(_e){}
      };

      areas.forEach(ta => {
        const key = ta.dataset.key;
        if(!key) return;
        // Load stored value; keep textarea empty if none
        const stored = this._load(key, '');
        if(typeof stored === 'string'){
          ta.value = stored;
        }
        autoResize(ta);

        let timer = null;
        const saveNow = ()=>{
          this._save(key, ta.value || '');
          if(key === 'maid-chan:persona:chatSamples') updateSamplesCount();
        };

        ta.addEventListener('input', ()=>{
          autoResize(ta);
          if(timer) clearTimeout(timer);
          timer = setTimeout(saveNow, 500);
        });

        ta.addEventListener('blur', ()=>{
          if(timer) clearTimeout(timer);
          saveNow();
          if(key === 'maid-chan:persona:chatSamples') updateSamplesCount();
        });
      });

      // Initial count on open
      updateSamplesCount();
    }

    _renderPlaygroundError(container, err){
      if(!container) return;
      container.innerHTML = '';
      const pre = document.createElement('pre');
      pre.textContent = err && err.message ? String(err.message) : String(err);
      pre.className = 'maid-chan-ability-error';
      container.appendChild(pre);
      container.dataset.kind = 'error';
    }

    close(){
      if(!this.overlay) return;
      document.removeEventListener('keydown', this._escHandler);
      // Remove visualViewport listeners used for safe-area padding
      if(this._vvHandlers && window.visualViewport){
        try{ this._vvHandlers.forEach(([ev, fn])=> window.visualViewport.removeEventListener(ev, fn)); }catch(_e){}
      }
      this._vvHandlers = [];
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
