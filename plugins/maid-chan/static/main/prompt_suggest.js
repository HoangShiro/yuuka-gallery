// Maid-chan sample feature: Prompt Suggestions
// This is a demo implementation showing how to inject a feature into the main tab frame.
/*
 * Maid-chan Prompt Suggestion (Rewritten)
 * Features:
 *  - Scan user image metadata (img_data.json via /api/core/images) to build tag frequency model.
 *  - Generate weighted random prompt suggestions influenced by user's historical usage.
 *  - Android-style toggle to allow bubble trigger to auto-generate an image with a suggested prompt
 *    for the currently open album (character).
 *  - Trigger sends generation request to /api/core/generate and shows confirmation chat bubble.
 */
(function(){
  const FEATURE_ID = 'prompt_suggest';
  const LS_SUGGEST = 'maid-chan:prompt-suggest:suggestions:v2';
  const LS_MODEL   = 'maid-chan:prompt-suggest:model-cache:v1';
  const LS_TRIGGER = 'maid-chan:prompt-suggest:trigger-enabled';
  const LS_PROMPT_TEXT = 'maid-chan:prompt-suggest:prompt-text:v1';
  const LS_CUSTOM_TAGS = 'maid-chan:prompt-suggest:custom-tags:v1';
  const LS_CAT_OUTFITS = 'maid-chan:prompt-suggest:cat-outfits:v1';
  const LS_CAT_EXPRESSION = 'maid-chan:prompt-suggest:cat-expression:v1';
  const LS_CAT_ACTION = 'maid-chan:prompt-suggest:cat-action:v1';
  const LS_CAT_CONTEXT = 'maid-chan:prompt-suggest:cat-context:v1';
  // Per-category reroll toggles for "Refresh all"
  const LS_REROLL_CATS = 'maid-chan:prompt-suggest:reroll-cats:v1';
  const MAX_SUGGESTIONS = 2;
  const DEFAULT_SUGGESTIONS = [
    'outfits: school uniform, ribbon; expression: smile; action: sitting; context: classroom, soft lighting',
    'outfits: casual, hoodie; expression: cheerful; action: waving; context: city street, evening light'
  ];

  // ---- Persistence helpers ----
  const safeJSON = (raw, fallback)=>{ try{ return JSON.parse(raw);}catch(_){ return fallback; }};
  const loadModel = ()=> safeJSON(localStorage.getItem(LS_MODEL), null);
  const saveModel = (m)=>{ try{ localStorage.setItem(LS_MODEL, JSON.stringify(m)); }catch(_e){} };
  const loadSuggestions = ()=> safeJSON(localStorage.getItem(LS_SUGGEST), []);
  const saveSuggestions = (list)=>{ try{ localStorage.setItem(LS_SUGGEST, JSON.stringify(list)); }catch(_e){} };
  const loadTriggerEnabled = ()=>{ try{ return JSON.parse(localStorage.getItem(LS_TRIGGER) || 'true'); }catch(_){ return true; } };
  const saveTriggerEnabled = (val)=>{ try{ localStorage.setItem(LS_TRIGGER, JSON.stringify(!!val)); }catch(_e){} };
  const loadPromptText = ()=>{ try{ return String(localStorage.getItem(LS_PROMPT_TEXT) || ''); }catch(_){ return ''; } };
  const savePromptText = (val)=>{ try{ localStorage.setItem(LS_PROMPT_TEXT, String(val||'')); }catch(_e){} };
  const loadCustomTags = ()=>{ try{ return String(localStorage.getItem(LS_CUSTOM_TAGS) || ''); }catch(_){ return ''; } };
  const saveCustomTags = (val)=>{ try{ localStorage.setItem(LS_CUSTOM_TAGS, String(val||'')); }catch(_e){} };
  const loadCat = (key)=>{ try{ return String(localStorage.getItem(key) || ''); }catch(_){ return ''; } };
  const saveCat = (key,val)=>{ try{ localStorage.setItem(key, String(val||'')); }catch(_e){} };
  const loadRerollCats = ()=>{
    try{
      const raw = localStorage.getItem(LS_REROLL_CATS);
      const obj = raw ? JSON.parse(raw) : null;
      // Defaults: enable reroll for all categories
      return {
        outfits: obj?.outfits !== undefined ? !!obj.outfits : true,
        expression: obj?.expression !== undefined ? !!obj.expression : true,
        action: obj?.action !== undefined ? !!obj.action : true,
        context: obj?.context !== undefined ? !!obj.context : true,
      };
    }catch(_){ return { outfits:true, expression:true, action:true, context:true }; }
  };
  const saveRerollCats = (cfg)=>{ try{ localStorage.setItem(LS_REROLL_CATS, JSON.stringify(cfg||{})); }catch(_e){} };

  // ---- Data acquisition & model building ----
  async function fetchAllImages(){
    const token = localStorage.getItem('yuuka-auth-token') || '';
    try{
      const res = await fetch('/api/core/images', { headers: token? { 'Authorization': 'Bearer '+token }: {} });
      if(!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      if(!Array.isArray(json)) return [];
      return json;
    }catch(err){
      console.warn('[PromptSuggest] Failed to fetch images:', err);
      return [];
    }
  }

  function extractCategoryTags(cfg){
    if(!cfg || typeof cfg !== 'object') return { outfits:[], expression:[], action:[], context:[] };
    const out = { outfits:[], expression:[], action:[], context:[] };
    const map = {
      outfits: cfg.outfits,
      expression: cfg.expression,
      action: cfg.action,
      context: cfg.context,
    };
    for(const cat of Object.keys(map)){
      const val = map[cat];
      if(!val) continue;
      if(Array.isArray(val)){
        val.forEach(v=> collectText(v, out[cat]));
      }else{
        collectText(val, out[cat]);
      }
    }
    // Ensure unique within each category
    for(const k of Object.keys(out)){
      const seen = new Set();
      out[k] = out[k].filter(t=>{ if(!t) return false; if(seen.has(t)) return false; seen.add(t); return true; });
    }
    return out;
  }

  function collectText(value, out){
    if(typeof value !== 'string') return;
    // Split by commas / newlines
    value.split(/[,\n]/).map(s=> s.trim()).forEach(tok=>{
      if(!tok) return;
      // basic filters
      if(/^(masterpiece|best quality)$/i.test(tok)) { out.push(tok); return; }
      if(/^(bad|worst) (hands|quality|detail)/i.test(tok)) { out.push(tok); return; }
      if(tok.length < 2) return;
      out.push(tok);
    });
  }

  function buildFrequencyModel(images){
    const makeMap = ()=> new Map();
    const freqs = { outfits: makeMap(), expression: makeMap(), action: makeMap(), context: makeMap() };
    images.forEach(img=>{
      const cfg = img?.generationConfig || img?.generation_config || img?.config;
      const cats = extractCategoryTags(cfg);
      for(const k of Object.keys(freqs)){
        const map = freqs[k];
        cats[k].forEach(t=> map.set(t, (map.get(t)||0)+1));
      }
    });
    const toItems = (m)=>{
      const total = Array.from(m.values()).reduce((a,b)=>a+b,0) || 1;
      const items = Array.from(m.entries()).map(([tag,cnt])=>({ tag, count: cnt, weight: Math.max(1e-6, cnt/total) }));
      return { total, items };
    };
    return {
      updated: Date.now(),
      outfits: toItems(freqs.outfits),
      expression: toItems(freqs.expression),
      action: toItems(freqs.action),
      context: toItems(freqs.context)
    };
  }

  function weightedRandomSample(model, k){
    if(!model || !Array.isArray(model.items) || !model.items.length) return [];
    // Copy array for partial sampling without replacement; recompute cumulative weights each pick
    const pool = model.items.slice();
    const chosen = [];
    while(chosen.length < k && pool.length){
      const sum = pool.reduce((a,it)=> a + it.weight, 0) || 1;
      let r = Math.random()*sum;
      let idx = 0;
      for(let i=0;i<pool.length;i++){
        r -= pool[i].weight;
        if(r <= 0){ idx = i; break; }
      }
      const picked = pool.splice(idx,1)[0];
      chosen.push(picked.tag);
    }
    return chosen;
  }

  function generateSuggestions(model, count=2){
    // Fallback: map default strings into objects
    const fallback = DEFAULT_SUGGESTIONS.slice(0, count).map(str=> ({ text: String(str), parts: null }));
    if(!model || !model.outfits || !model.expression || !model.action || !model.context){
      return fallback;
    }
    const pickCat = (catModel, minN, maxN)=>{
      const n = Math.max(minN, Math.min(maxN, Math.round(minN + Math.random()*(maxN-minN))));
      return weightedRandomSample(catModel, n);
    };
    const out = [];
    const seen = new Set();
    for(let i=0;i<count;i++){
      const outfits = pickCat(model.outfits, 1, 2);
      const expression = pickCat(model.expression, 1, 2);
      const action = pickCat(model.action, 1, 2);
      const context = pickCat(model.context, 2, 4);
      // Render combined string
      const prompt = [
        ...outfits,
        ...expression,
        ...action,
        ...context
      ].filter(Boolean).join(', ');
      if(seen.has(prompt)) { i--; continue; }
      seen.add(prompt);
      out.push({ text: prompt, parts: { outfits, expression, action, context } });
    }
    return out;
  }

  // ---- UI ----
  function buildUI(container){
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'prompt-suggest-wrapper';

    const header = document.createElement('div');
    header.className = 'prompt-suggest-header';
    // Title removed per requirement; feature title is registered separately
    header.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'prompt-suggest-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'prompt-suggest-refresh';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.title = 'Quét dữ liệu ảnh & tạo gợi ý mới';

    // Android-style internal toggle for trigger auto-generate
    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'ps-trigger-toggle';
    toggleWrap.innerHTML = `
      <span class="ps-toggle-label">Quick-Generate</span>
      <div class="ps-switch">
        <input type="checkbox" class="ps-switch-input" />
        <div class="ps-switch-track"><div class="ps-switch-thumb"></div></div>
      </div>`;
    const toggleInput = toggleWrap.querySelector('input');
    toggleInput.checked = loadTriggerEnabled();

    actions.appendChild(refreshBtn);
    actions.appendChild(toggleWrap);

    const statusLine = document.createElement('div');
    statusLine.className = 'prompt-suggest-status';
    statusLine.textContent = 'Đang chờ...';

  // Removed combined prompt preview per requirement

    // Category inputs
    const catGrid = document.createElement('div');
    catGrid.className = 'prompt-suggest-cat-grid';
    const mkCat = (label, lsKey, cls, catKey, minN=1, maxN=2) => {
      const wrap = document.createElement('div');
      wrap.className = 'prompt-suggest-cat-item';
      const header = document.createElement('div');
      header.className = 'ps-cat-header';
      const rerollCfg = loadRerollCats();
      header.innerHTML = `
        <span class="ps-cat-label">${label}</span>
        <div class="ps-cat-controls">
          <label class="ps-switch ps-cat-toggle" title="Include in Refresh">
            <input type="checkbox" class="ps-switch-input ps-cat-reroll-input" aria-label="Include ${label} in Refresh" />
            <div class="ps-switch-track"><div class="ps-switch-thumb"></div></div>
          </label>
          <button type="button" class="ps-cat-random-btn" title="Randomize ${label}">
            <span class="material-symbols-outlined">casino</span>
          </button>
        </div>`;
      wrap.appendChild(header);
      const ta = document.createElement('textarea');
      ta.className = cls;
      ta.rows = 1; ta.style.resize='none'; ta.style.overflow='hidden';
      ta.placeholder = `${label} tags...`;
      ta.value = loadCat(lsKey);
      wrap.appendChild(ta);
      catGrid.appendChild(wrap);
      // Attach randomize action
      const btn = header.querySelector('.ps-cat-random-btn');
      btn.addEventListener('click', async ()=>{
        try{
          btn.disabled = true;
          const model = await ensureModel();
          const picked = pickFromModel(model, catKey, minN, maxN);
          if(picked){ ta.value = picked; saveCat(lsKey, ta.value); autoResize(ta); recomputeCombinedPrompt(); }
        } finally { btn.disabled = false; }
      });
      // Initialize and wire reroll toggle
      const toggle = header.querySelector('.ps-cat-reroll-input');
      if(toggle){
        toggle.checked = !!rerollCfg[catKey];
        toggle.addEventListener('change', ()=>{
          const cfg = loadRerollCats();
          cfg[catKey] = !!toggle.checked;
          saveRerollCats(cfg);
        });
      }
      return ta;
    };
    const outfitsBox = mkCat('Outfits', LS_CAT_OUTFITS, 'ps-outfits-textarea', 'outfits', 1, 2);
    const expressionBox = mkCat('Expression', LS_CAT_EXPRESSION, 'ps-expression-textarea', 'expression', 1, 2);
    const actionBox = mkCat('Action', LS_CAT_ACTION, 'ps-action-textarea', 'action', 1, 2);
    const contextBox = mkCat('Context', LS_CAT_CONTEXT, 'ps-context-textarea', 'context', 2, 4);

    // Secondary textarea for custom tags appended on generation
    const customTagsBox = document.createElement('textarea');
    customTagsBox.className = 'prompt-custom-tags-textarea';
    customTagsBox.placeholder = 'Tags bổ sung (sẽ tự động thêm vào prompt khi tạo ảnh)';
    customTagsBox.style.resize = 'none';
    customTagsBox.style.overflow = 'hidden';
    customTagsBox.rows = 1;

    wrapper.appendChild(header);
    wrapper.appendChild(actions);
    wrapper.appendChild(statusLine);
  wrapper.appendChild(catGrid);
    wrapper.appendChild(customTagsBox);
    container.appendChild(wrapper);

    function setStatus(txt){ statusLine.textContent = txt || ''; }

    // Auto-resize helper
    function autoResize(el){
      try{
        el.style.height = 'auto';
        el.style.height = Math.max(40, el.scrollHeight) + 'px';
      }catch(_e){}
    }

    // Initialize textareas with saved values
    function recomputeCombinedPrompt(){
      const parts = [outfitsBox.value, expressionBox.value, actionBox.value, contextBox.value]
        .map(s=> s.split(/[,\n]/).map(t=>t.trim()).filter(Boolean).join(', '))
        .filter(Boolean);
      const combined = parts.join(', ');
      savePromptText(combined);
      return combined;
    }

    function initTextareas(){
      const savedPrompt = loadPromptText();
      const savedTags = loadCustomTags();
      if(savedTags){ customTagsBox.value = savedTags; }
      // If category boxes empty but we have a savedPrompt, attempt naive split into context
      [outfitsBox, expressionBox, actionBox, contextBox].forEach(autoResize);
      if(!outfitsBox.value && !expressionBox.value && !actionBox.value && !contextBox.value && savedPrompt){
        contextBox.value = savedPrompt; saveCat(LS_CAT_CONTEXT, contextBox.value);
      }
      recomputeCombinedPrompt();
      autoResize(customTagsBox);
    }

    async function doRefresh(){
      if(refreshBtn.disabled) return;
      refreshBtn.disabled = true; setStatus('Đang quét dữ liệu ảnh...');
      const imgs = await fetchAllImages();
      setStatus(`Đã tải ${imgs.length} ảnh. Đang phân tích...`);
      const model = buildFrequencyModel(imgs);
      saveModel(model);
      const suggestions = generateSuggestions(model, 1);
      saveSuggestions(suggestions);
      const first = suggestions[0]?.text || '';
      if(first){
        const parts = suggestions[0]?.parts || null;
        const reroll = loadRerollCats();
        if(parts){
          if(reroll.outfits){ outfitsBox.value = parts.outfits.join(', '); saveCat(LS_CAT_OUTFITS, outfitsBox.value); }
          if(reroll.expression){ expressionBox.value = parts.expression.join(', '); saveCat(LS_CAT_EXPRESSION, expressionBox.value); }
          if(reroll.action){ actionBox.value = parts.action.join(', '); saveCat(LS_CAT_ACTION, actionBox.value); }
          if(reroll.context){ contextBox.value = parts.context.join(', '); saveCat(LS_CAT_CONTEXT, contextBox.value); }
        } else {
          if(loadRerollCats().context){ contextBox.value = first; saveCat(LS_CAT_CONTEXT, contextBox.value); }
        }
        recomputeCombinedPrompt();
      }
      setStatus('Hoàn tất!');
      refreshBtn.disabled = false;
    }

    refreshBtn.addEventListener('click', ()=>{ doRefresh(); });
    toggleInput.addEventListener('change', ()=>{ saveTriggerEnabled(toggleInput.checked); });

    // Auto-save + auto-resize on input
    customTagsBox.addEventListener('input', ()=>{ saveCustomTags(customTagsBox.value); autoResize(customTagsBox); });
  const catInputHandler = (box,key)=>{ box.addEventListener('input', ()=>{ saveCat(key, box.value); autoResize(box); recomputeCombinedPrompt(); }); };
  catInputHandler(outfitsBox, LS_CAT_OUTFITS);
  catInputHandler(expressionBox, LS_CAT_EXPRESSION);
  catInputHandler(actionBox, LS_CAT_ACTION);
  catInputHandler(contextBox, LS_CAT_CONTEXT);

    // Initial render
    initTextareas();
    const existing = loadPromptText();
    if(existing){ setStatus('Sẵn sàng (đã lưu)'); }
    else {
      const cachedList = loadSuggestions();
      if(cachedList.length){
        const first = cachedList[0]?.text || '';
        if(first){
          const parts = cachedList[0]?.parts || null;
          if(parts){
            outfitsBox.value = parts.outfits.join(', ');
            expressionBox.value = parts.expression.join(', ');
            actionBox.value = parts.action.join(', ');
            contextBox.value = parts.context.join(', ');
            saveCat(LS_CAT_OUTFITS, outfitsBox.value);
            saveCat(LS_CAT_EXPRESSION, expressionBox.value);
            saveCat(LS_CAT_ACTION, actionBox.value);
            saveCat(LS_CAT_CONTEXT, contextBox.value);
          } else { contextBox.value = first; saveCat(LS_CAT_CONTEXT, contextBox.value); }
          recomputeCombinedPrompt();
          setStatus('Sẵn sàng (cache)');
        }
      } else {
        const def = String(DEFAULT_SUGGESTIONS[0] || '');
        contextBox.value = def; saveCat(LS_CAT_CONTEXT, contextBox.value); recomputeCombinedPrompt(); setStatus('Gợi ý mặc định');
      }
    }
  }

  function mount(container){ buildUI(container); }
  function unmount(container){ container.innerHTML=''; }

  // ---- Trigger (bubble) ----
  function attemptRegisterTrigger(retries=25){
    const bubble = window.Yuuka?.components?.MaidChanBubble;
    if(bubble && bubble.registerTrigger){
      bubble.registerTrigger({
        id: 'prompt_suggest_chat',
        featureId: FEATURE_ID,
        requireEnabled: true,
        handler: async ({ showMessage })=>{
          // Respect internal toggle
            if(!loadTriggerEnabled()){
              showMessage?.({ text: 'Prompt Suggest: (Tắt auto-generate)', duration: 2200, type: 'info' });
              return;
            }
            // Find selected album / character (robust scan)
            const selectedChar = findSelectedCharacter();
            if(!selectedChar){
              showMessage?.({ text: 'Chưa mở album nhân vật nào.', duration: 3000, type: 'warning' });
              return;
            }
            const characterName = selectedChar?.name || selectedChar?.character || 'nhân vật';
            // Determine prompt text: prefer saved textarea, else model, else default
            let promptText = (loadPromptText() || '').trim();
            if(!promptText){
              const model = loadModel();
              const generated = generateSuggestions(model, 1);
              const first = generated[0]?.text || '';
              promptText = first || String(DEFAULT_SUGGESTIONS[0] || '');
              // cache
              saveSuggestions(generated);
              savePromptText(promptText);
            }
            const picked = { text: promptText, parts: null };
            // Build generation config minimal (fill category fields if available)
            // FIX: ensure we await async config builder (was returning a Promise, causing empty Object.keys & abort)
            const genConfig = await buildGenerationConfigFromPrompt(picked, selectedChar);
            // Debug trace to help diagnose 400/401 issues
            console.debug('[PromptSuggest] Trigger generation debug', {
              selectedChar,
              characterHash: selectedChar.hash,
              hasConfig: !!genConfig,
              configKeys: Object.keys(genConfig||{}),
              sampleFields: {
                character: genConfig.character,
                width: genConfig.width,
                height: genConfig.height,
                steps: genConfig.steps
              }
            });
            const result = await startGeneration(selectedChar.hash, genConfig);
            if(result && result.task_id){
              // Notify album UI immediately
              try{ window.Yuuka?.events?.emit('generation:task_created_locally', { task_id: result.task_id, character_hash: selectedChar.hash }); }catch(_e){}
              try{ window.Yuuka?.events?.emit('album:request_refresh'); }catch(_e){}
              showMessage?.({ text: `Đã tạo ảnh cho ${characterName}~!`, duration: 3500, type: 'success' });
            }else{
              showMessage?.({ text: 'Không thể tạo ảnh (lỗi).', duration: 3500, type: 'error' });
            }
        }
      });
      return true;
    }
    if(retries<=0) return false;
    setTimeout(()=> attemptRegisterTrigger(retries-1), 350);
    return false;
  }

  async function buildGenerationConfigFromPrompt(suggestion, selectedChar){
    // Fetch album last_config (without global choices for speed)
    let albumConfig = null;
    try {
      if(selectedChar?.hash){
        // Prefer unified plugin API client if available
        const token = localStorage.getItem('yuuka-auth-token') || '';
        const apiAlbum = (window.Yuuka?.coreApi?.album) || (window.Yuuka?.api?.album); // two naming variants
        let data = null;
        if(apiAlbum?.get){
          try {
            data = await apiAlbum.get(`/comfyui/info?character_hash=${encodeURIComponent(selectedChar.hash)}&no_choices=true`);
          } catch(e){ console.warn('[PromptSuggest] Album API client get failed', e); }
        }
        if(!data){
          const infoUrl = `/api/plugin/album/comfyui/info?character_hash=${encodeURIComponent(selectedChar.hash)}&no_choices=true`;
          const headers = token ? { 'Authorization': 'Bearer '+token } : {};
          const res = await fetch(infoUrl, { headers });
          if(res.ok){
            data = await res.json().catch(()=>null);
          } else {
            console.warn('[PromptSuggest] Album info fetch failed', res.status);
          }
        }
        albumConfig = data?.last_config || null;
      }
    }catch(_e){ /* ignore, fallback below */ }
    const extraTags = (loadCustomTags() || '').trim();
    const outfits = loadCat(LS_CAT_OUTFITS);
    const expression = loadCat(LS_CAT_EXPRESSION);
    const action = loadCat(LS_CAT_ACTION);
    const contextRaw = loadCat(LS_CAT_CONTEXT);
    const combinedContext = extraTags ? [contextRaw, extraTags].filter(Boolean).join(', ') : contextRaw;
    // Clone album config or default skeleton
    // Always layer defaults first, then albumConfig (may be empty object). Prevent empty final config.
    const defaults = {
      quality: 'masterpiece, best quality',
      negative: 'bad quality, worst quality, lowres',
      steps: 12,
      cfg: 2.2,
      width: 832,
      height: 1216,
      batch_size: 1,
      sampler_name: 'dpmpp_sde',
      scheduler: 'beta',
      hires_enabled: false,
      workflow_type: 'standard'
    };
    const base = { ...defaults, ...(albumConfig || {}) };
    // Minimal sanity: number coercion & presence
    const coerceInt = (v, d)=>{ const n = parseInt(v,10); return Number.isFinite(n) && n>0? n: d; };
    base.width = coerceInt(base.width, defaults.width);
    base.height = coerceInt(base.height, defaults.height);
    base.steps = coerceInt(base.steps, defaults.steps);
    const coerceFloat = (v,d)=>{ const n = parseFloat(v); return Number.isFinite(n)&&n>0? n: d; };
    base.cfg = coerceFloat(base.cfg, defaults.cfg);
    base.batch_size = coerceInt(base.batch_size, defaults.batch_size);
    if(!base.sampler_name) base.sampler_name = defaults.sampler_name;
    if(!base.scheduler) base.scheduler = defaults.scheduler;
    if(typeof base.quality !== 'string' || !base.quality.trim()) base.quality = defaults.quality;
    if(typeof base.negative !== 'string' || !base.negative.trim()) base.negative = defaults.negative;
    if(!base.workflow_type) base.workflow_type = defaults.workflow_type;
    // Only override fields if user has explicitly provided category values.
    const overrideIf = (val, existing) => (val && String(val).trim()) ? String(val).trim() : (existing||'');
    base.character = overrideIf(selectedChar?.name || selectedChar?.character, base.character);
    base.outfits = overrideIf(outfits, albumConfig?.outfits || base.outfits);
    base.expression = overrideIf(expression, albumConfig?.expression || base.expression);
    base.action = overrideIf(action, albumConfig?.action || base.action);
    base.context = overrideIf(combinedContext, albumConfig?.context || base.context);
    console.debug('[PromptSuggest] Built generation config', { character: base.character, width: base.width, height: base.height, steps: base.steps, sampler: base.sampler_name });
    return base;
  }

  async function startGeneration(characterHash, config){
    try {
      // Defensive: if a Promise was accidentally passed, resolve it.
      if(config && typeof config.then === 'function'){
        try { config = await config; } catch(e){ console.warn('[PromptSuggest] Failed to resolve config promise', e); return null; }
      }
      if(!characterHash){ console.warn('[PromptSuggest] Missing character hash; aborting generation.'); return null; }
      if(!config || Object.keys(config).length === 0){ console.warn('[PromptSuggest] Empty generation config; aborting.'); return null; }
      // Prefer unified core API client if available for consistent headers & events
      const apiClient = window.Yuuka?.coreApi?.generation || window.Yuuka?.api?.generation;
      if(apiClient?.start){
        console.debug('[PromptSuggest] Using unified generation API start()', { characterHash, cfg: { steps: config.steps, width: config.width, height: config.height } });
        return await apiClient.start(characterHash, config, { origin: 'prompt_suggest.auto' });
      }
      // Fallback manual fetch
      const token = localStorage.getItem('yuuka-auth-token') || '';
      if(!token){ console.warn('[PromptSuggest] No auth token present, manual generation may fail.'); }
      const payload = { character_hash: characterHash, generation_config: config, context: { origin: 'prompt_suggest.auto' } };
      const res = await fetch('/api/core/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token? { 'Authorization': 'Bearer '+token }: {}) },
        body: JSON.stringify(payload)
      });
      let json = null;
      try{ json = await res.json(); }catch(_e){ json = null; }
      if(res.status === 401){ console.warn('[PromptSuggest] Unauthorized generation attempt.'); }
      if(!res.ok){ console.warn('[PromptSuggest] generate failed', json || payload); return null; }
      // Emit local event similar to core API for UI consistency
      try { window.Yuuka?.events?.emit('generation:task_created_locally', json); }catch(_e){}
      return json;
    } catch(err){ console.warn('[PromptSuggest] generate error', err); return null; }
  }

  function findSelectedCharacter(){
    const LS_LAST = 'maid-chan:prompt-suggest:last-selection';
    const persist = (sel)=>{ try{ localStorage.setItem(LS_LAST, JSON.stringify(sel)); }catch(_e){} };
    const loadPersisted = ()=>{ try{ return JSON.parse(localStorage.getItem(LS_LAST)||'null'); }catch(_e){ return null; } };
    try {
      const yuuka = window.Yuuka || {};
      // 0. Prefer DOM marker set by AlbumComponent
      const albumRoot = document.querySelector('.plugin-album[data-character-hash]');
      if (albumRoot) {
        const sel = { hash: albumRoot.getAttribute('data-character-hash'), name: albumRoot.getAttribute('data-character-name') || '' };
        if (sel.hash) { persist(sel); return sel; }
      }
      // 1. Direct known instance path
      const direct = yuuka?.instances?.AlbumComponent?.state?.selectedCharacter;
      if(direct){ persist(direct); return direct; }
      // 2. Components namespace scan
      const comps = yuuka.components || {};
      for(const key of Object.keys(comps)){
        const obj = comps[key];
        if(!obj) continue;
        // Instance with state
        if(obj.state?.selectedCharacter){ persist(obj.state.selectedCharacter); return obj.state.selectedCharacter; }
        // Wrapper holding instance
        if(obj.instance?.state?.selectedCharacter){ persist(obj.instance.state.selectedCharacter); return obj.instance.state.selectedCharacter; }
      }
      // 3. Generic scan of top-level Yuuka properties
      for(const key of Object.keys(yuuka)){
        const val = yuuka[key];
        if(val && typeof val === 'object'){
          const sc = val.state?.selectedCharacter;
            if(sc){ persist(sc); return sc; }
            if(val.viewMode === 'album' && val.state?.selectedCharacter){ persist(val.state.selectedCharacter); return val.state.selectedCharacter; }
        }
      }
      // 4. Plugins namespace scan
      const plugins = yuuka.plugins || {};
      for(const k of Object.keys(plugins)){
        const p = plugins[k];
        if(p && p.state?.selectedCharacter){ persist(p.state.selectedCharacter); return p.state.selectedCharacter; }
      }
      // 5. DOM heuristic: look for album container with data-hash
      const albumEl = document.querySelector('.plugin-album .character-header,[data-character-hash]');
      if(albumEl){
        const hash = albumEl.getAttribute('data-character-hash') || null;
        const name = albumEl.getAttribute('data-character-name') || albumEl.textContent?.trim() || '';
        if(hash){ const sel = { hash, name }; persist(sel); return sel; }
      }
    }catch(_e){ /* ignore */ }
    // 6. Fallback to last persisted selection
    return loadPersisted();
  }

  // ---- Feature registration ----
  function attemptRegisterFeature(retries=25){
    const frame = window.Yuuka?.components?.MaidChanMainFrame;
    if(frame && frame.registerFeature){
      frame.registerFeature({
        id: FEATURE_ID,
        title: 'Prompt Suggestions',
        description: 'Quét lịch sử ảnh để tạo prompt gợi ý & auto-generate.',
        defaultEnabled: true,
        mount,
        unmount
      });
      return true;
    }
    if(retries<=0) return false;
    setTimeout(()=> attemptRegisterFeature(retries-1), 350);
    return false;
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ attemptRegisterFeature(); attemptRegisterTrigger(); });
  }else{
    attemptRegisterFeature();
    attemptRegisterTrigger();
  }

  // Expose (debug)
  window.Yuuka = window.Yuuka || {}; window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components.PromptSuggestFeature = { regenerate: async ()=>{
      const imgs = await fetchAllImages();
      const model = buildFrequencyModel(imgs); saveModel(model); const sugg = generateSuggestions(model,5); saveSuggestions(sugg); return sugg;
    }
  };

  // Helpers for per-category randomization
  async function ensureModel(){
    let m = loadModel();
    if(m && m.outfits && m.expression && m.action && m.context) return m;
    const imgs = await fetchAllImages();
    m = buildFrequencyModel(imgs); saveModel(m); return m;
  }
  function pickFromModel(model, catKey, minN, maxN){
    if(!model || !model[catKey]) return '';
    const n = Math.max(minN, Math.min(maxN, Math.round(minN + Math.random()*(maxN-minN))));
    const arr = weightedRandomSample(model[catKey], n);
    return arr.filter(Boolean).join(', ');
  }
})();
