(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }

  // Read-only viewer for persona data stored in localStorage
  function buildPersonaReadonly(bodyEl, key, label){
    const wrap = document.createElement('div');
    const lab = document.createElement('div'); lab.textContent = label || 'Persona'; lab.style.fontSize='12px'; lab.style.opacity='.8'; lab.style.marginBottom='6px';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.fontSize = '12px';
    pre.style.margin = '0';
    pre.textContent = window.localStorage.getItem(key) || '';
    wrap.appendChild(lab);
    wrap.appendChild(pre);
    bodyEl.appendChild(wrap);
  }

  add({
    type: 'Maid Persona',
    category: 'input',
    personaKey: 'maid-chan:persona:aboutMaid',
    ports: { inputs: [], outputs: [ { id:'prompt', label:'Prompt' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ buildPersonaReadonly(bodyEl, 'maid-chan:persona:aboutMaid', 'Maid Persona (read-only)'); },
    execute(ctx){ /* stub: returns prompt text */ return { prompt: window.localStorage.getItem('maid-chan:persona:aboutMaid')||'' }; }
  });

  add({
    type: 'User Persona',
    category: 'input',
    personaKey: 'maid-chan:persona:aboutUser',
    ports: { inputs: [], outputs: [ { id:'prompt', label:'Prompt' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ buildPersonaReadonly(bodyEl, 'maid-chan:persona:aboutUser', 'User Persona (read-only)'); },
    execute(ctx){ return { prompt: window.localStorage.getItem('maid-chan:persona:aboutUser')||'' }; }
  });

  add({
    type: 'Chat Samples',
    category: 'input',
    personaKey: 'maid-chan:persona:chatSamples',
    ports: { inputs: [], outputs: [ { id:'history', label:'History' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ buildPersonaReadonly(bodyEl, 'maid-chan:persona:chatSamples', 'Chat Samples (read-only)'); },
    execute(ctx){ return { history: window.localStorage.getItem('maid-chan:persona:chatSamples')||'' }; }
  });

  add({
    type: 'Custom Prompt',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'prompt', label:'Prompt' } ] },
    defaultData(){ return { text: '' }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      const ta = document.createElement('textarea');
      ta.placeholder = 'Additional system context...';
      ta.value = (node.data && node.data.text) || '';
      ta.classList.add('mc-node-textarea-small');
      ta.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.text = ta.value; if(onDataChange) onDataChange(); });
      bodyEl.appendChild(ta);
    },
    execute(ctx){ return { prompt: (ctx.node.data && ctx.node.data.text) || '' }; }
  });

  // Represents the current user's input text (the prompt being sent).
  // No configuration UI; logic layer will insert the runtime text based on edge ordering.
  add({
    type: 'User Input',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'history', label:'History' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ /* intentionally blank */ },
    execute(ctx){
      // Execution at design time is a stub; runtime substitution happens in ai_logic.js.
      return { history: '' };
    }
  });

  // Simulated user input node: allows entering text directly on the node.
  // AILogic will inject this text into LLM history when wired to an LLM History port,
  // and will also persist it if wired to "Save history".
  add({
    type: 'User Input SM',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'history', label:'History' } ] },
    defaultData(){ return { text: '' }; },
    buildConfigUI(bodyEl, node, { onDataChange }){
      const lab = document.createElement('div');
      lab.textContent = 'Simulated user input';
      lab.style.fontSize = '12px';
      lab.style.opacity = '.8';
      lab.style.marginBottom = '6px';
      const ta = document.createElement('textarea');
      ta.placeholder = 'Type simulated user message...';
      ta.value = (node.data && node.data.text) || '';
      ta.style.width = '100%';
      ta.rows = 5;
      ta.classList.add('mc-node-textarea-small');
      ta.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.text = ta.value; if(onDataChange) onDataChange(); });
      bodyEl.appendChild(lab);
      bodyEl.appendChild(ta);
    },
    execute(ctx){
      return { history: (ctx.node.data && ctx.node.data.text) || '' };
    }
  });

  // Reads previously saved chat history (local truncated log) to provide context.
  add({
    type: 'Read history',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'history', label:'History' } ] },
    defaultData(){ return { maxItems: 20 }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      // Helper: backend API client (if available)
      function getPluginApi(){
        const root = window.Yuuka || {};
        const ns = root.plugins && root.plugins['maid-chan'];
        const coreApi = ns && ns.coreApi;
        if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
          coreApi.createPluginApiClient('maid');
          return coreApi.maid || null;
        }
        return null;
      }
      async function fetchServerHistory(){
        const max = (node.data && node.data.maxItems) || 20;
        // Try plugin API first (includes auth), then fall back to fetch
        try{
          const pluginApi = getPluginApi();
          if(pluginApi && typeof pluginApi.get === 'function'){
            const res = await pluginApi.get('/chat/history');
            return Array.isArray(res?.items) ? res.items.slice(-max) : [];
          }
        }catch(_e){}
        try{
          const res = await fetch('/api/plugin/maid/chat/history', { credentials: 'include' });
          if(!res.ok) throw new Error('http '+res.status);
          const data = await res.json();
          return Array.isArray(data?.items) ? data.items.slice(-max) : [];
        }catch(_e){ return []; }
      }
      function itemToDisplay(entry){
        if(!entry || typeof entry !== 'object') return { ts: Date.now(), msg: '' };
        if(entry.role === 'assistant'){
          const snaps = entry.snapshots || {};
          const parts = Array.isArray(snaps.parts) ? snaps.parts : [];
          const idx = Math.max(0, Math.min((snaps.current_index|0), Math.max(0, parts.length-1)));
          const part = parts[idx] || {};
          return { ts: part.timestamp || Date.now(), msg: String(part.text || '') };
        }
        // user or others
        return { ts: entry.timestamp || Date.now(), msg: String(entry.text || '') };
      }
      // Inject minimal styles once
      if(!document.getElementById('mc-history-overlay-style')){
        const style = document.createElement('style'); style.id='mc-history-overlay-style'; style.textContent = `
          .mc-history-view-btn{background:#1f2330;border:1px solid #2d313f;color:#dfe3f0;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;}
          .mc-history-view-btn:hover{background:#272c3d;}
          .mc-history-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(10,12,18,.7);}
          .mc-history-panel{width:720px;max-height:78vh;background:#12141b;border:1px solid #30323c;border-radius:14px;display:flex;flex-direction:column;box-shadow:0 8px 28px rgba(0,0,0,.55);}
          .mc-history-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #23252d;font-size:14px;font-weight:600;color:#e7e9ef;}
          .mc-history-body{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;}
          .mc-history-item{background:#1d2029;border:1px solid #2d3039;border-radius:10px;padding:8px 12px;font-size:12px;line-height:1.4;white-space:pre-wrap;word-break:break-word;color:#d6dae4;}
          .mc-history-item-meta{opacity:.55;font-size:11px;margin-bottom:4px;}
          .mc-history-footer{padding:10px 16px;border-top:1px solid #23252d;display:flex;justify-content:flex-end;gap:8px;}
          .mc-history-close-btn{background:#2d3445;border:1px solid #3a4254;color:#e5e9f3;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;}
          .mc-history-close-btn:hover{background:#364155;}
        `; document.head.appendChild(style);
      }
      const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.gap='6px'; wrap.style.fontSize='12px'; wrap.style.opacity='.85';
      const lab = document.createElement('div'); lab.textContent='Reads recent chat history.'; wrap.appendChild(lab);
      const numWrap = document.createElement('div'); numWrap.style.display='flex'; numWrap.style.gap='6px'; numWrap.style.alignItems='center';
      const numLab = document.createElement('span'); numLab.textContent='Max turns:'; numWrap.appendChild(numLab);
      const num = document.createElement('input'); num.type='number'; num.min='1'; num.max='200'; num.value=(node.data&&node.data.maxItems)||20; num.style.width='70px';
      num.addEventListener('change', ()=>{ node.data=node.data||{}; node.data.maxItems=parseInt(num.value||'20',10); if(onDataChange) onDataChange(); });
      numWrap.appendChild(num); wrap.appendChild(numWrap);
      const viewBtn = document.createElement('button'); viewBtn.type='button'; viewBtn.textContent='View'; viewBtn.className='mc-history-view-btn';
      viewBtn.addEventListener('click', ()=> openOverlay()); wrap.appendChild(viewBtn);
      bodyEl.appendChild(wrap);

      function openOverlay(){
        const overlay = document.createElement('div'); overlay.className='mc-history-overlay';
        const panel = document.createElement('div'); panel.className='mc-history-panel'; overlay.appendChild(panel);
        const header = document.createElement('div'); header.className='mc-history-header'; header.textContent='Chat History'; panel.appendChild(header);
        const body = document.createElement('div'); body.className='mc-history-body'; panel.appendChild(body);
        const footer = document.createElement('div'); footer.className='mc-history-footer'; panel.appendChild(footer);
        const closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.textContent='Close'; closeBtn.className='mc-history-close-btn'; footer.appendChild(closeBtn);
        closeBtn.addEventListener('click', ()=> overlay.remove());
        overlay.addEventListener('mousedown', (e)=>{ if(e.target===overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        renderItems(body);
      }
      async function renderItems(container){
        container.innerHTML='Loading...';
        // Prefer backend; fallback to localStorage
        let entries = await fetchServerHistory();
        if(!Array.isArray(entries) || entries.length===0){
          try{ const raw=window.localStorage.getItem('maid-chan:history-log'); entries = raw? JSON.parse(raw): []; }catch(_e){ entries=[]; }
          // Entries from localStorage already have {ts,msg}
          const recent = entries.slice(-((node.data && node.data.maxItems) || 20));
          container.innerHTML='';
          for(const item of recent){
            const div = document.createElement('div'); div.className='mc-history-item';
            const meta = document.createElement('div'); meta.className='mc-history-item-meta';
            const ts = item && item.ts ? new Date(item.ts).toLocaleString() : ''; meta.textContent = ts; div.appendChild(meta);
            const content = document.createElement('div'); content.textContent = (item && item.msg) ? item.msg : ''; div.appendChild(content);
            container.appendChild(div);
          }
          if(!recent.length){ const empty = document.createElement('div'); empty.className='mc-history-item'; empty.textContent='(no history)'; container.appendChild(empty); }
          return;
        }
        // Normalize backend entries then render
        const items = entries.map(itemToDisplay);
        container.innerHTML='';
        for(const it of items){
          const div = document.createElement('div'); div.className='mc-history-item';
          const meta = document.createElement('div'); meta.className='mc-history-item-meta'; meta.textContent = new Date(it.ts).toLocaleString(); div.appendChild(meta);
          const content = document.createElement('div'); content.textContent = it.msg || ''; div.appendChild(content);
          container.appendChild(div);
        }
        if(!items.length){ const empty = document.createElement('div'); empty.className='mc-history-item'; empty.textContent='(no history)'; container.appendChild(empty); }
      }
    },
    execute(ctx){
      try {
        const raw = window.localStorage.getItem('maid-chan:history-log');
        const arr = raw? JSON.parse(raw): [];
        const max = (ctx.node.data && ctx.node.data.maxItems) || 20;
        const recent = arr.slice(-max);
        // Provide concatenated text; ai_logic will split or treat as block.
        const combined = recent.map(i=> i.msg || '').join('\n');
        return { history: combined };
      }catch(e){ return { history: '' }; }
    }
  });

  // Tools Control (moved from process.js)
  add({
    type: 'Tools Control',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'tools', label:'Tools' } ] },
    defaultData(){ return { selected: [] }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '6px';

      const hint = document.createElement('div');
      hint.className = 'mc-chip';
      hint.textContent = 'Select tools to allow (adds rows automatically)';
      wrap.appendChild(hint);

      const rows = document.createElement('div');
      rows.style.display = 'flex';
      rows.style.flexDirection = 'column';
      rows.style.gap = '6px';
      wrap.appendChild(rows);

      function getCaps(){
        try{
          const root = window.Yuuka || {}; const services = root.services || {}; const capsSvc = services.capabilities;
          if(!capsSvc || typeof capsSvc.listLLMCallable !== 'function') return [];
          const items = capsSvc.listLLMCallable() || [];
          const out = [];
          for(const c of items){
            if(!c || !c.llmCallable) continue;
            const fn = (c.llmName && String(c.llmName).trim()) || String(c.id || '').trim();
            if(!fn) continue;
            const pluginId = (c.pluginId || 'core');
            const title = c.title || c.description || c.id || fn;
            out.push({ name: fn, label: `${pluginId}: ${title}`, pluginId, id: String(c.id || '').trim() });
          }
          out.sort((a,b)=> a.pluginId===b.pluginId ? a.label.localeCompare(b.label) : String(a.pluginId).localeCompare(String(b.pluginId)));
          return out;
        }catch(_e){ return []; }
      }

      const options = getCaps();

      function render(){
        rows.innerHTML = '';
        node.data = node.data || {};
        const sel = Array.isArray(node.data.selected) ? node.data.selected.slice() : [];
        const used = new Set(sel);

        function makeRow(value, isTrailing){
          const row = document.createElement('div');
          row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center';
          const select = document.createElement('select');
          select.style.flex = '1 1 auto';
          const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = isTrailing ? 'Add a tool…' : '(none)';
          select.appendChild(emptyOpt);
          for(const opt of options){
            const o = document.createElement('option'); o.value = opt.name; o.textContent = opt.label; select.appendChild(o);
          }
          select.value = value || '';

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'mc-icon-btn';
          removeBtn.title = 'Remove';
          removeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
          removeBtn.addEventListener('click', ()=>{
            if(!value) return;
            const idx = sel.indexOf(value);
            if(idx >= 0){ sel.splice(idx,1); node.data.selected = sel; if(onDataChange) onDataChange(); render(); }
          });

          select.addEventListener('change', ()=>{
            const v = select.value;
            if(!v){
              if(!isTrailing && value){
                const idx = sel.indexOf(value);
                if(idx >= 0){ sel.splice(idx,1); node.data.selected = sel; if(onDataChange) onDataChange(); render(); }
              }
              return;
            }
            if(!used.has(v)){
              sel.push(v); used.add(v); node.data.selected = sel; if(onDataChange) onDataChange();
              render();
            } else {
              select.value = value || '';
            }
          });

          row.appendChild(select);
          if(!isTrailing){ row.appendChild(removeBtn); }
          rows.appendChild(row);
        }

        for(const v of sel){ makeRow(v, false); }
        makeRow('', true);
      }

      render();
      bodyEl.appendChild(wrap);
    },
    execute(ctx){
      const selected = (ctx.node && ctx.node.data && Array.isArray(ctx.node.data.selected)) ? ctx.node.data.selected.slice() : [];
      return { tools: { allow: selected } };
    }
  });

  // LLM settings (moved from process.js)
  add({
    type: 'LLM settings',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'settings', label:'Settings' } ] },
    defaultData(){ return { model: '', temperature: 0.7, top_p: 1, max_tokens: 512 }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      // Model list (from settings/llm_api.js cached storage) - per-node override
      const modelsKey = 'maid-chan:llm-models';
      const loadModels = ()=>{ try{ const raw = window.localStorage.getItem(modelsKey); return raw? JSON.parse(raw):[]; }catch(_e){ return []; } };

      const modelWrap = document.createElement('div'); modelWrap.style.marginBottom='8px';
      const modelLab = document.createElement('div'); modelLab.textContent = 'Model'; modelLab.style.fontSize='12px'; modelLab.style.opacity='.8'; modelWrap.appendChild(modelLab);
      const modelSel = document.createElement('select'); modelSel.style.width='100%'; modelSel.style.background='#12141b'; modelSel.style.border='1px solid #2b2d36'; modelSel.style.color='#e5e7ee'; modelSel.style.borderRadius='6px'; modelSel.style.padding='6px';
      const models = loadModels();
      const currentModel = (node.data && node.data.model) || '';
      if(!models.length){
        const opt = document.createElement('option'); opt.value=''; opt.textContent='No models available'; modelSel.appendChild(opt); modelSel.disabled = true;
      }else{
        for(const m of models){
          const opt = document.createElement('option');
          if(typeof m === 'string'){ opt.value = m; opt.textContent = m; }
          else { opt.value = m.id || m.name || ''; opt.textContent = m.display_name || m.id || m.name || opt.value; }
          if(currentModel && opt.value === currentModel){ opt.selected = true; }
          modelSel.appendChild(opt);
        }
      }
      modelSel.addEventListener('change', ()=>{
        node.data = node.data || {};
        node.data.model = modelSel.value || '';
        if(onDataChange) onDataChange(node.data);
      });
      modelWrap.appendChild(modelSel); bodyEl.appendChild(modelWrap);

      const mkNumber = (key, labelTxt, step, defVal)=>{
        const wrap = document.createElement('div'); wrap.style.marginBottom='8px';
        const lab = document.createElement('div'); lab.textContent = labelTxt; lab.style.fontSize='12px'; lab.style.opacity='.8'; wrap.appendChild(lab);
        const inp = document.createElement('input'); inp.type='number'; inp.step=String(step||0.1);
        const data = node.data || {}; const val = data[key];
        inp.value = (typeof val === 'number' ? String(val) : (defVal!=null? String(defVal):''));
        inp.addEventListener('change', ()=>{
          node.data = node.data||{}; node.data[key] = parseFloat(inp.value);
          if(onDataChange) onDataChange(node.data);
        });
        wrap.appendChild(inp); bodyEl.appendChild(wrap);
      };
      mkNumber('temperature','Temperature',0.1,0.7);
      mkNumber('top_p','Top P',0.05,1);
      mkNumber('max_tokens','Max tokens',1,512);
    },
    execute(ctx){ return { settings: { ...(ctx.node.data||{}) } }; }
  });
})();
