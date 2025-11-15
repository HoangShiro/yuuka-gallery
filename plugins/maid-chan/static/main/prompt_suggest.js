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
    // Basic normalization: strip parentheses first
    value = value.replace(/[()]/g, '');
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

  // ---- Sampling helpers ----
  function weightedRandomSample(bucket, n){
    if(!bucket || !Array.isArray(bucket.items) || !bucket.items.length || !n) return [];
    const items = bucket.items;
    const out = [];
    for(let i=0;i<n;i++){
      let r = Math.random();
      let acc = 0;
      for(const it of items){
        acc += it.weight || 0;
        if(r <= acc){ out.push(it.tag); break; }
      }
    }
    return out;
  }

  function generateSuggestions(modelOrNull){
    const model = modelOrNull || loadModel();
    if(!model) return {
      outfits: 'school uniform, ribbon',
      expression: 'smile',
      action: 'sitting',
      context: 'classroom, soft lighting'
    };
    const pick = (catKey, minN, maxN)=>{
      if(!model[catKey]) return '';
      const n = Math.max(minN, Math.min(maxN, Math.round(minN + Math.random()*(maxN-minN))));
      const arr = weightedRandomSample(model[catKey], n);
      return arr.filter(Boolean).join(', ');
    };
    return {
      outfits: pick('outfits', 1, 3),
      expression: pick('expression', 1, 2),
      action: pick('action', 1, 2),
      context: pick('context', 1, 3)
    };
  }

  // ---- Maid quick menu integration (use MaidChanBubble quick actions) ----
  function registerQuickMenuAction(retries=25){
    const maid = window.Yuuka?.components?.MaidChanBubble;
    if(maid && typeof maid.registerQuickAction === 'function'){
      // Main quick-generate button
      maid.registerQuickAction({
        id: 'prompt_suggest_quick_generate',
        featureId: FEATURE_ID,
        icon: 'auto_awesome',
        title: 'Prompt Suggest auto-generate',
        order: 30,
        async handler(ctx={}){
          const showMessage = ctx.showMessage || (msg=>console.info('[PromptSuggest]', msg?.text || msg));

          if(!loadTriggerEnabled()){
            showMessage({ text: 'Prompt Suggest: (Tắt auto-generate)', duration: 2200, type: 'info' });
            return;
          }

          const caps = window.Yuuka?.services?.capabilities;
          if(!caps || typeof caps.invoke !== 'function'){
            showMessage({ text: 'Capabilities chưa sẵn sàng.', duration: 2500, type: 'error' });
            return;
          }

          let ctxAlbum;
          try{
            ctxAlbum = await caps.invoke('album.get_context', {});
          }catch(err){
            console.warn('[PromptSuggest] album.get_context failed', err);
            showMessage({ text: 'Không đọc được trạng thái album.', duration: 3000, type: 'error' });
            return;
          }

          const current = ctxAlbum?.current;
          if(!current || !current.hash){
            showMessage({ text: 'Chưa mở album nhân vật nào.', duration: 3000, type: 'warning' });
            return;
          }
          const characterHash = current.hash;
          const characterName = current.name || 'nhân vật';

          let promptText = (loadPromptText() || '').trim();
          if(!promptText){
            const sug = generateSuggestions(loadModel());
            promptText = `outfits: ${sug.outfits}; expression: ${sug.expression}; action: ${sug.action}; context: ${sug.context}`;
            savePromptText(promptText);
          }

          const extraTags = (loadCustomTags() || '').trim();
          let finalPrompt = promptText;
          if(extraTags){
            finalPrompt = `${promptText.replace(/[.,\s]*$/, '')}, ${extraTags}`;
          }

          try{
            await caps.invoke('image.generate', {
              character_hash: characterHash,
              prompt: finalPrompt,
            });
          }catch(err){
            console.warn('[PromptSuggest] image.generate failed', err);
            showMessage({ text: 'Không thể tạo ảnh (capability lỗi).', duration: 3500, type: 'error' });
            return;
          }

          showMessage({ text: `Đã tạo ảnh cho ${characterName}~!`, duration: 3500, type: 'success' });
        }
      });

      // Info / open-feature button so quick menu always has at least two buttons
      maid.registerQuickAction({
        id: 'prompt_suggest_info',
        featureId: FEATURE_ID,
        icon: 'chat_info',
        title: 'Mở tab Prompt Suggestions',
        order: 31,
        async handler(ctx={}){
          const showMessage = ctx.showMessage || (msg=>console.info('[PromptSuggest]', msg?.text || msg));
          const frame = window.Yuuka?.components?.MaidChanMainFrame;
          if(frame && typeof frame.open === 'function'){
            try{
              await frame.open({ focusFeatureId: FEATURE_ID });
              showMessage({ text: 'Đã mở tab Prompt Suggestions.', duration: 2600, type: 'info' });
            }catch(err){
              console.warn('[PromptSuggest] open Prompt Suggestions failed', err);
              showMessage({ text: 'Không mở được tab Prompt Suggestions.', duration: 2800, type: 'error' });
            }
          }else{
            showMessage({ text: 'UI Maid-chan chưa sẵn sàng để mở tab.', duration: 2600, type: 'warning' });
          }
        }
      });
      return true;
    }
    if(retries<=0) return false;
    setTimeout(()=> registerQuickMenuAction(retries-1), 350);
    return false;
  }

  // ---- Main tab UI ----
  function buildUI(container){
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'prompt-suggest-wrapper';

    const currentPrompt = loadPromptText();
    const parts = (currentPrompt || '').split(';');
    const parsePart = (label)=>{
      const match = parts.find(p=> p.trim().toLowerCase().startsWith(label+':'));
      if(!match) return '';
      return match.split(':').slice(1).join(':').trim();
    };

    const outfitsInitial = parsePart('outfits');
    const expressionInitial = parsePart('expression');
    const actionInitial = parsePart('action');
    const contextInitial = parsePart('context');

    function composePromptText(){
      const outfits = outfitsArea.value.trim();
      const expr = expressionArea.value.trim();
      const act = actionArea.value.trim();
      const ctx = contextArea.value.trim();
      const segments = [];
      if(outfits) segments.push(`outfits: ${outfits}`);
      if(expr) segments.push(`expression: ${expr}`);
      if(act) segments.push(`action: ${act}`);
      if(ctx) segments.push(`context: ${ctx}`);
      const text = segments.join('; ');
      savePromptText(text);
      return text;
    }

    function autoResize(ta){
      ta.style.height = 'auto';
      ta.style.height = (ta.scrollHeight||40) + 'px';
    }

    function createLabeledArea(labelText, placeholder, initial){
      const wrapper = document.createElement('div');
      wrapper.className = 'prompt-suggest-field';
      const label = document.createElement('div');
      label.className = 'prompt-suggest-field-label';
      label.textContent = labelText;
      const ta = document.createElement('textarea');
      ta.className = 'prompt-suggest-textarea';
      ta.placeholder = placeholder;
      ta.value = initial || '';
      autoResize(ta);
      ta.addEventListener('input', ()=>{
        autoResize(ta);
        composePromptText();
      });
      wrapper.appendChild(label);
      wrapper.appendChild(ta);
      return { wrapper, textarea: ta, labelEl: label };
    }

    const outfitsField = createLabeledArea('Outfits', 'VD: school uniform, ribbon', outfitsInitial);
    const expressionField = createLabeledArea('Expression', 'VD: smile, cheerful', expressionInitial);
    const actionField = createLabeledArea('Action', 'VD: sitting, waving', actionInitial);
    const contextField = createLabeledArea('Context', 'VD: classroom, soft lighting', contextInitial);

    const outfitsArea = outfitsField.textarea;
    const expressionArea = expressionField.textarea;
    const actionArea = actionField.textarea;
    const contextArea = contextField.textarea;

    root.appendChild(outfitsField.wrapper);
    root.appendChild(expressionField.wrapper);
    root.appendChild(actionField.wrapper);
    root.appendChild(contextField.wrapper);

    const extraArea = document.createElement('textarea');
    extraArea.className = 'prompt-custom-tags-textarea';
    extraArea.placeholder = 'Custom tags thêm (optional)';
    extraArea.value = loadCustomTags();
    autoResize(extraArea);
    extraArea.addEventListener('input', ()=>{
      autoResize(extraArea);
      saveCustomTags(extraArea.value);
    });
    root.appendChild(extraArea);

    const actions = document.createElement('div');
    actions.className = 'prompt-suggest-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh gợi ý';
    actions.appendChild(refreshBtn);

    const makeFieldReroll = (fieldKey, area)=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'prompt-suggest-reroll-btn';
      btn.innerHTML = '<span class="material-symbols-outlined">ifl</span>';
      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        try{
          const imgs = await fetchAllImages();
          const model = buildFrequencyModel(imgs);
          saveModel(model);
          const part = generateSuggestions(model)[fieldKey] || '';
          area.value = part;
          autoResize(area);
          composePromptText();
        }finally{
          btn.disabled = false;
        }
      });
      return btn;
    };

    outfitsField.labelEl.prepend(makeFieldReroll('outfits', outfitsArea));
    expressionField.labelEl.prepend(makeFieldReroll('expression', expressionArea));
    actionField.labelEl.prepend(makeFieldReroll('action', actionArea));
    contextField.labelEl.prepend(makeFieldReroll('context', contextArea));

    refreshBtn.addEventListener('click', async ()=>{
      refreshBtn.disabled = true;
      try{
        const imgs = await fetchAllImages();
        const model = buildFrequencyModel(imgs);
        saveModel(model);
        const sug = generateSuggestions(model);
        outfitsArea.value = sug.outfits || '';
        expressionArea.value = sug.expression || '';
        actionArea.value = sug.action || '';
        contextArea.value = sug.context || '';
        autoResize(outfitsArea);
        autoResize(expressionArea);
        autoResize(actionArea);
        autoResize(contextArea);
        composePromptText();
      }finally{
        refreshBtn.disabled = false;
      }
    });

    root.appendChild(actions);

    container.appendChild(root);
  }

    function mount(container){ buildUI(container); }
    function unmount(container){ container.innerHTML=''; }

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
      document.addEventListener('DOMContentLoaded', ()=>{ attemptRegisterFeature(); registerQuickMenuAction(); });
    }else{
      attemptRegisterFeature();
      registerQuickMenuAction();
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
