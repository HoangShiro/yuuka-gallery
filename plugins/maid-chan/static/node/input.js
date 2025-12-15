(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }

  // Read-only viewer for persona data stored in localStorage
  function buildPersonaReadonly(bodyEl, key, label){
    const wrap = document.createElement('div');
    const lab = document.createElement('div'); lab.textContent = label || 'Persona'; lab.className = 'mc-node-label';
    const pre = document.createElement('pre');
    pre.className = 'mc-preview-message';
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
    ports: { inputs: [], outputs: [ { id:'system_prompt', label:'System Prompt' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ buildPersonaReadonly(bodyEl, 'maid-chan:persona:aboutMaid', 'Maid Persona (read-only)'); },
    execute(ctx){ /* stub: returns prompt text */ return { system_prompt: window.localStorage.getItem('maid-chan:persona:aboutMaid')||'' }; }
  });

  add({
    type: 'User Persona',
    category: 'input',
    personaKey: 'maid-chan:persona:aboutUser',
    ports: { inputs: [], outputs: [ { id:'system_prompt', label:'System Prompt' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ buildPersonaReadonly(bodyEl, 'maid-chan:persona:aboutUser', 'User Persona (read-only)'); },
    execute(ctx){ return { system_prompt: window.localStorage.getItem('maid-chan:persona:aboutUser')||'' }; }
  });

  add({
    type: 'Chat Samples',
    category: 'input',
    personaKey: 'maid-chan:persona:chatSamples',
    ports: { inputs: [], outputs: [ { id:'messages', label:'Messages' } ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ buildPersonaReadonly(bodyEl, 'maid-chan:persona:chatSamples', 'Chat Samples (read-only)'); },
    execute(ctx){
      // Parse chat samples into message objects
      let raw = window.localStorage.getItem('maid-chan:persona:chatSamples')||'';
      // Try parsing as JSON
      try {
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed)) return { messages: parsed };
        if(typeof parsed === 'object' && parsed !== null) return { messages: [parsed] };
        // If it's a string, it means the content was stringified. Use the parsed string as the raw text.
        if(typeof parsed === 'string') raw = parsed;
      } catch(e){}
      
      // Fallback: try parsing text format (User: ... Char: ...)
      // Simple regex-based parser for common formats
      const lines = raw.split(/\r?\n/);
      const messages = [];
      let currentRole = null;
      let currentContent = [];
      
      const flush = () => {
        if(currentRole && currentContent.length){
          messages.push({ role: currentRole, content: currentContent.join('\n').trim() });
        }
        currentContent = [];
      };

      for(const line of lines){
        // Check for role markers like "User:", "Char:", "You:", "Maid:", "{{user}}:", "{{char}}:"
        // We map them to 'user' or 'assistant'
        // Allow optional leading whitespace
        const match = line.match(/^\s*(\{\{)?(User|You|Char|Character|Maid|Model|Assistant|System)(\}\})?:\s*(.*)$/i);
        if(match){
          flush();
          const r = match[2].toLowerCase();
          if(r === 'user' || r === 'you') currentRole = 'user';
          else if(r === 'system') currentRole = 'system';
          else currentRole = 'assistant';
          
          // match[4] is the content part
          if(match[4]) currentContent.push(match[4]);
        } else {
          if(currentRole) currentContent.push(line);
          else {
            // If no role started yet, treat as system or user? 
            // If it's the very beginning, maybe treat as user if it doesn't look like a header?
            // For safety, let's just append to a default user block if we haven't started.
            if(line.trim()){
                if(messages.length === 0 && !currentRole) currentRole = 'user';
                currentContent.push(line);
            }
          }
        }
      }
      flush();

      if(messages.length > 0) return { messages };

      // If parsing failed to produce structured messages, return raw string
      return { messages: raw };
    }
  });

  const CustomPromptRegistry = (function(){
    if(!window.__MaidChanCustomPromptRegistry){ window.__MaidChanCustomPromptRegistry = new Map(); }
    if(!window.__MaidChanCustomPromptListener){
      window.__MaidChanCustomPromptListener = true;
      window.addEventListener('maid-chan:logic:dispatch', (ev)=>{
        try{
          const { targetNodeId, payload } = ev.detail || {};
          if(!targetNodeId) return;
          const updater = window.__MaidChanCustomPromptRegistry.get(targetNodeId);
          if(typeof updater === 'function'){
             let content = '';
             if(typeof payload === 'string') content = payload;
             else if(typeof payload === 'object') content = payload.content || payload.text || JSON.stringify(payload);
             else content = String(payload);
             updater(content);
          }
        }catch(_e){}
      });
    }
    return window.__MaidChanCustomPromptRegistry;
  })();

  add({
    type: 'Custom Prompt',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'system_prompt', label:'System Prompt' } ] },
    defaultData(){ return { text: '' }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      const ta = document.createElement('textarea');
      ta.placeholder = 'Additional system context...';
      ta.value = (node.data && node.data.text) || '';
      ta.classList.add('mc-node-textarea-small');
      
      const updateVal = (newText) => {
          ta.value = newText;
          node.data = node.data || {};
          node.data.text = newText;
          if(onDataChange) onDataChange();
      };

      ta.addEventListener('change', ()=>{ updateVal(ta.value); });
      bodyEl.appendChild(ta);

      CustomPromptRegistry.set(String(node.id), updateVal);
    },
    onDelete(node){
      try{
        window.localStorage.removeItem(`maid-chan:dispatch:last:${node.id}`);
        CustomPromptRegistry.delete(String(node.id));
      }catch(e){}
    },
    execute(ctx){
      try {
        const raw = window.localStorage.getItem(`maid-chan:dispatch:last:${ctx.node.id}`);
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.payload) {
             const p = data.payload;
             let val = '';
             if (typeof p === 'string') val = p;
             else if (typeof p === 'object') {
                val = p.content || p.text || JSON.stringify(p);
             } else {
                val = String(p);
             }
             return { system_prompt: val };
          }
        }
      } catch(e) {}
      return { system_prompt: (ctx.node.data && ctx.node.data.text) || '' }; 
    }
  });

  // Represents the current user's input text (the prompt being sent).
  // No configuration UI; logic layer will insert the runtime text based on edge ordering.
  add({
    type: 'User Input',
    category: 'input',
    // Added Message control output to coordinate Regen mode behavior downstream
    ports: { inputs: [], outputs: [ { id:'messages', label:'Messages' }, { id:'message_control', label:'Message control' } ] },
    defaultData(){ return { user_text: '', user_msg_id: '', assistant_msg_id: '' }; },
    buildConfigUI(bodyEl, node, { onDataChange }){
      const makeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('msg_'+Date.now()+'_'+Math.random().toString(36).slice(2)));
      
      const createRow = (label, key, elType='input', props={}) => {
        const div = document.createElement('div');
        div.className = 'mc-node-col';
        const lab = document.createElement('div');
        lab.textContent = label;
        lab.className = 'mc-node-label';
        const el = document.createElement(elType);
        el.classList.add('mc-node-input');
        if(elType === 'textarea') {
            el.rows = 3;
            el.classList.add('mc-node-textarea-small');
        }
        el.value = (node.data && node.data[key]) || '';
        Object.assign(el, props);
        el.addEventListener('change', (e) => {
            node.data[key] = e.target.value;
            onDataChange();
        });
        div.appendChild(lab);
        div.appendChild(el);
        bodyEl.appendChild(div);
        return el;
      };

      createRow('User Text (Manual)', 'user_text', 'textarea', { placeholder: 'Enter text for manual run...' });
      const userIdInput = createRow('User Msg ID', 'user_msg_id', 'input', { placeholder: 'Optional UUID...' });
      const asstIdInput = createRow('Assistant Msg ID', 'assistant_msg_id', 'input', { placeholder: 'Optional UUID...' });

      const btn = document.createElement('button');
      btn.textContent = 'Random IDs';
      btn.className = 'mc-node-btn';
      btn.onclick = () => {
        const u = makeId();
        const a = makeId();
        userIdInput.value = u;
        asstIdInput.value = a;
        node.data.user_msg_id = u;
        node.data.assistant_msg_id = a;
        onDataChange();
      };
      bodyEl.appendChild(btn);
    },
    execute(ctx){
      // Enhanced to support two modes: New msg (default) and Regen.
      // Mode is expected from ctx.context.mode or ctx.context.userInputMode provided by chat_panel.
      let text = (ctx && ctx.text) || '';
      let context = (ctx && ctx.context) || {};
      
      // Detect if run from Chat Panel (context usually has keys like mode, userMessageId etc)
      // If text is empty and context is empty, assume manual run from editor.
      const isChatPanel = (text !== '') || (Object.keys(context).length > 0);

      if (!isChatPanel) {
          // Manual run: use node data
          text = (ctx.node.data && ctx.node.data.user_text) || '';
          // Inject IDs into context if provided
          if (ctx.node.data && ctx.node.data.user_msg_id) {
              context = { ...context, userMessageId: ctx.node.data.user_msg_id };
          }
          if (ctx.node.data && ctx.node.data.assistant_msg_id) {
              context = { ...context, assistantMessageId: ctx.node.data.assistant_msg_id };
          }
          // Force mode to new for manual run
          context.mode = 'new';
      }

      const modeRaw = context.mode || context.userInputMode || 'new';
      const mode = String(modeRaw).toLowerCase() === 'regen' ? 'regen' : 'new';

      // History passed in via ctx.history for determining existing user msg id in Regen mode.
      const history = Array.isArray(ctx && ctx.history) ? ctx.history : [];

      // Helper create new id
      const makeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('msg_'+Date.now()+'_'+Math.random().toString(36).slice(2)));

      let userMsgId = context.userMessageId || context.messageId;
      if(mode === 'regen'){
        // Find last user message id from history
        for(let i = history.length - 1; i >= 0; i--){
          const m = history[i];
          if(m && m.role === 'user' && m.id){ userMsgId = m.id; break; }
        }
        if(!userMsgId) userMsgId = makeId(); // fallback if history missing
      }else{
        if(!userMsgId) userMsgId = makeId();
      }

      // Determine if tail assistant/model exists (used by Read history to trim on regen)
      let lastAssistantId = null;
      for(let i = history.length - 1; i >= 0; i--){
        const m = history[i];
        if(m && (m.role === 'assistant' || m.role === 'model')){ lastAssistantId = m.id || null; break; }
      }

      let assistantMsgId = context.assistantMessageId || context.assistant_message_id || null;
      if(mode === 'regen'){
        if(!assistantMsgId) assistantMsgId = lastAssistantId || makeId();
      }else{
        if(!assistantMsgId) assistantMsgId = makeId();
      }

      // Build user message object embedding id and mode for downstream Save history logic.
      const userMessage = text ? { role: 'user', content: text, id: userMsgId, mode } : null;

      // Message control payload
      const control = {
        mode,
        user_message_id: userMsgId,
        last_assistant_id: lastAssistantId,
        assistant_message_id: assistantMsgId,
        assistantMessageId: assistantMsgId,
        has_tail_assistant: !!lastAssistantId
      };

      return {
        messages: userMessage ? [userMessage] : [],
        message_control: control
      };
    }
  });

  // Reads previously saved chat history (local truncated log) to provide context.
  add({
    type: 'Read history',
    category: 'input',
    // Added Message control input to allow regen trimming of last assistant/model message.
    ports: { inputs: [ { id:'message_control', label:'Message control' } ], outputs: [ { id:'messages', label:'Messages' } ] },
    defaultData(){ return { maxItems: 20 }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      // ...existing code...
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
      
      const wrap = document.createElement('div'); wrap.className = 'mc-node-col-loose'; wrap.style.fontSize='12px'; wrap.style.opacity='.85';
      const lab = document.createElement('div'); lab.textContent='Reads recent chat history.'; wrap.appendChild(lab);
      const numWrap = document.createElement('div'); numWrap.className = 'mc-node-row';
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
    async execute(ctx){
      // Try to fetch from backend first (async)
      const max = (ctx.node.data && ctx.node.data.maxItems) || 20;
      const controlInputRaw = (ctx && ctx.inputs && ctx.inputs.message_control) ? ctx.inputs.message_control : null;
      const controlObj = Array.isArray(controlInputRaw) ? (controlInputRaw[controlInputRaw.length-1] || null) : controlInputRaw;
      const regenMode = controlObj && typeof controlObj === 'object' && String(controlObj.mode).toLowerCase() === 'regen';
      
      // Helper to fetch from backend
      const fetchHistory = async () => {
        try{
            const root = window.Yuuka || {};
            const ns = root.plugins && root.plugins['maid-chan'];
            const coreApi = ns && ns.coreApi;
            if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
                coreApi.createPluginApiClient('maid');
                const client = coreApi.maid;
                if(client && typeof client.get === 'function'){
                    const res = await client.get('/chat/history');
                    return Array.isArray(res?.items) ? res.items : [];
                }
            }
        }catch(_e){}
        try{
            const res = await fetch('/api/plugin/maid/chat/history', { credentials: 'include' });
            if(!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data?.items) ? data.items : [];
        }catch(_e){ return []; }
      };

      let items = await fetchHistory();
      
      // Fallback to local storage if backend empty or failed
      if(!items || items.length === 0){
          try {
            const raw = window.localStorage.getItem('maid-chan:history-log');
            const arr = raw? JSON.parse(raw): [];
            // Local storage format is { ts, msg, tools }
            // Convert to backend-like format for uniform processing
            items = arr.map(i => ({ role: 'assistant', text: i.msg })); 
          }catch(e){ items = []; }
      }

      const recent = items.slice(-max);

      // Regen mode trimming (option 1):
      // nếu có assistant/model cuối, tìm user ngay trước nó và cắt luôn cặp user+assistant này
      if(regenMode && recent.length){
        let lastAssistantIdx = -1;
        for(let i = recent.length - 1; i >= 0; i--){
          const it = recent[i];
          if(it && (it.role === 'assistant' || it.role === 'model')){ lastAssistantIdx = i; break; }
        }
        if(lastAssistantIdx !== -1){
          // tìm user ngay trước assistant cuối
          let lastUserIdx = -1;
          for(let j = lastAssistantIdx - 1; j >= 0; j--){
            const it = recent[j];
            if(it && it.role === 'user'){ lastUserIdx = j; break; }
          }
          const cutFrom = lastUserIdx !== -1 ? lastUserIdx : lastAssistantIdx;
          recent.splice(cutFrom); // bỏ từ user/assistant đó trở về cuối
        }
      }
      
      // Convert to standard message objects
      const messages = recent.map(entry => {
          if(!entry) return null;
          if(entry.role === 'assistant'){
              // Handle backend snapshot format
              let text = '';
              if(entry.snapshots && Array.isArray(entry.snapshots.parts)){
                  const parts = entry.snapshots.parts;
                  const idx = entry.snapshots.current_index || 0;
                  text = (parts[idx] && parts[idx].text) || '';
              } else {
                  text = entry.text || entry.content || '';
              }
              return { role: 'assistant', content: String(text) };
          } else {
              return { role: 'user', content: String(entry.text || entry.content || '') };
          }
      }).filter(Boolean);

      return { messages };
    }
  });

  // Tools loader (renamed from "Tools Control")
  add({
    type: 'Tools loader',
    category: 'input',
    // Expose both outputs; UI toggles visibility when Execute is enabled
    ports: { inputs: [], outputs: [ { id:'tool_definitions', label:'Tool Definitions' }, { id:'system_prompt', label:'System Prompt' }, { id:'tool_results', label:'Raw Results' } ] },
    defaultData(){ return { selected: [], execute: false, payloads: {} }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      // ...existing code...
      const wrap = document.createElement('div');
      wrap.className = 'mc-node-col-loose';

      const hint = document.createElement('div');
      hint.className = 'mc-chip';
      hint.textContent = 'Select tools to allow (adds rows automatically)';
      wrap.appendChild(hint);

      // Execute toggle
      const execRow = document.createElement('div');
      execRow.className = 'mc-node-row';
      const execLab = document.createElement('span'); execLab.textContent = 'Execute'; execLab.className = 'mc-node-label'; execLab.style.marginBottom = '0';
      const execSwitch = document.createElement('label'); execSwitch.className = 'mc-switch'; execSwitch.innerHTML = '<input type="checkbox" role="switch" aria-checked="false" /><span class="mc-slider"></span>';
      const execInput = execSwitch.querySelector('input'); execInput.checked = !!(node.data && node.data.execute); execInput.setAttribute('aria-checked', execInput.checked ? 'true' : 'false');
      // Will be assigned inside render() to access its local DOM
      let _renderPayloadEditors = ()=>{};
      execInput.addEventListener('change', ()=>{ node.data=node.data||{}; node.data.execute=!!execInput.checked; execInput.setAttribute('aria-checked', execInput.checked?'true':'false'); onDataChange && onDataChange(node.data); reRenderPortVisibility(); _renderPayloadEditors(); });
      execRow.appendChild(execLab); execRow.appendChild(execSwitch); wrap.appendChild(execRow);

      const rows = document.createElement('div');
      rows.className = 'mc-node-col-loose';
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
            out.push({ id: String(c.id||'').trim() || fn, name: fn, label: `${pluginId}: ${title}` });
          }
          out.sort((a,b)=> a.label.localeCompare(b.label));
          return out;
        }catch(_e){ return []; }
      }

      const options = getCaps();

      function render(){
        rows.innerHTML = '';
        node.data = node.data || {};
        if(!Array.isArray(node.data.selected)) node.data.selected = [];
        node.data.payloads = node.data.payloads || {};
        const sel = node.data.selected.slice();
        const used = new Set(sel);

        function makeRow(value, isTrailing, idxInSel){
          const row = document.createElement('div');
          row.className = 'mc-node-row';
          const select = document.createElement('select'); select.style.flex = '1 1 auto';
          const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = isTrailing ? 'Add a tool…' : '(none)'; select.appendChild(emptyOpt);
          for(const opt of options){ const o = document.createElement('option'); o.value = opt.name; o.textContent = opt.label; select.appendChild(o); }
          select.value = value || '';

          const removeBtn = document.createElement('button'); removeBtn.type='button'; removeBtn.className='mc-icon-btn'; removeBtn.title='Remove'; removeBtn.innerHTML='<span class="material-symbols-outlined">close</span>';
          removeBtn.addEventListener('click', ()=>{
            if(isTrailing) return;
            if(idxInSel>=0){ sel.splice(idxInSel,1); node.data.selected = sel; onDataChange && onDataChange(); render(); }
          });

          select.addEventListener('change', ()=>{
            const v = select.value;
            if(!v){
              if(!isTrailing && value){
                if(idxInSel>=0){ sel.splice(idxInSel,1); node.data.selected = sel; onDataChange && onDataChange(); render(); }
              }
              return;
            }
            if(isTrailing){
              // Add new entry only if not already selected
              if(!sel.includes(v)){
                sel.push(v);
                node.data.selected = sel; onDataChange && onDataChange(); render();
              } else {
                select.value = '';
              }
            } else {
              // Replace the current selection instead of pushing a new one
              const current = value || '';
              if(v === current) return;
              const dupIdx = sel.indexOf(v);
              if(dupIdx !== -1 && dupIdx !== idxInSel){
                // Prevent duplicates: revert to previous value
                select.value = current;
                return;
              }
              if(idxInSel>=0){ sel[idxInSel] = v; node.data.selected = sel; onDataChange && onDataChange(); render(); }
            }
          });

          row.appendChild(select);
          if(!isTrailing){ row.appendChild(removeBtn); }
          rows.appendChild(row);
        }

        sel.forEach((v, i)=> makeRow(v, false, i));
        makeRow('', true, -1);

        // Payload editors (only visible in Execute mode)
        const payloadWrap = document.createElement('div'); payloadWrap.className = 'mc-node-col-loose'; payloadWrap.style.display = (node.data.execute ? 'flex' : 'none'); rows.appendChild(payloadWrap);

        function mkPayloadBlock(toolId, label){
          const block = document.createElement('div'); block.className = 'mc-node-group';
          const head = document.createElement('div'); head.className = 'mc-node-row'; head.style.justifyContent='space-between'; head.style.marginBottom='6px';
          const title = document.createElement('div'); title.className = 'mc-node-label'; title.textContent = label || toolId; head.appendChild(title);
          const actions = document.createElement('div'); actions.className = 'mc-node-row';
          const status = document.createElement('span'); status.style.fontSize='11px'; status.style.opacity='.75'; status.textContent='';
          const playBtn = document.createElement('button'); playBtn.type='button'; playBtn.className='mc-icon-btn'; playBtn.title='Run this tool'; playBtn.innerHTML='<span class="material-symbols-outlined">play_arrow</span>';
          actions.appendChild(status); actions.appendChild(playBtn); head.appendChild(actions);
          block.appendChild(head);
          const ta = document.createElement('textarea'); ta.className='mc-node-textarea-small'; ta.rows=5; ta.placeholder='{ }';
          const current = (node.data.payloads && node.data.payloads[toolId]) || '';
          ta.value = typeof current === 'string' ? current : JSON.stringify(current||{}, null, 2);
          ta.addEventListener('change', ()=>{ node.data.payloads = node.data.payloads || {}; node.data.payloads[toolId] = ta.value; onDataChange && onDataChange(node.data); });
          block.appendChild(ta);

          // Per-payload execution
          playBtn.addEventListener('click', async ()=>{
            const setStatus = (t, color)=>{ status.textContent = t||''; status.style.color = color||''; };
            let args = {};
            try{ const raw = ta.value || '{}'; args = raw.trim()? JSON.parse(raw) : {}; }
            catch(e){ setStatus('Invalid JSON', '#ff6b6b'); return; }
            try{
              setStatus('Running...', '#bdbdc7');
              const root = window.Yuuka || {}; const services = root.services || {}; const capsSvc = services.capabilities;
              const all = (capsSvc && typeof capsSvc.listLLMCallable === 'function') ? (capsSvc.listLLMCallable()||[]) : [];
              const target = String(toolId||'').trim().toLowerCase();
              let cap = null;
              for(const c of all){ if(!c || !c.llmCallable) continue; const n = ((c.llmName && String(c.llmName)) || String(c.id||'')).trim().toLowerCase(); if(n && n === target){ cap = c; break; } }
              if(cap && capsSvc && typeof capsSvc.invoke === 'function'){
                const res = await capsSvc.invoke(cap.id, args, { source:'maid' });
                setStatus('OK', '#34c759');
                try{ window.dispatchEvent(new CustomEvent('maid-chan:tools:executed', { detail: { results: [ { name: toolId, ok:true, result: res } ] } })); }catch(_e){}
              }else{
                // Fallback: fire event for external handlers
                window.dispatchEvent(new CustomEvent('maid-chan:tools:execute', { detail: { name: toolId, args } }));
                setStatus('Sent', '#34c759');
              }
            }catch(err){ setStatus('Error', '#ff6b6b'); }
          });

          return block;
        }

        function renderPayloadEditors(){
          payloadWrap.style.display = (node.data && node.data.execute) ? 'flex' : 'none';
          payloadWrap.innerHTML = '';
          if(!(node.data && node.data.execute)) return;
          for(const id of (node.data.selected||[])){
            const meta = options.find(o=> o.name === id) || { name: id, label: id };
            payloadWrap.appendChild(mkPayloadBlock(id, meta.label));
          }
        }

        // expose to outer scope so Execute toggle can call it
        _renderPayloadEditors = renderPayloadEditors;
        renderPayloadEditors();
        reRenderPortVisibility();
      }

      function reRenderPortVisibility(){
        try{
          const el = bodyEl.closest('.mc-node'); if(!el) return;
          const portsWrap = el.querySelector('.mc-node-ports'); if(!portsWrap) return;
          const outs = portsWrap.querySelectorAll('[data-port="out"]');
          const exec = !!(node.data && node.data.execute);
          outs.forEach((p, idx)=>{
            if(idx === 0){ p.style.visibility = exec ? 'hidden' : 'visible'; p.style.pointerEvents = exec ? 'none' : ''; }
            else if(idx === 1){ p.style.visibility = exec ? 'visible' : 'hidden'; p.style.pointerEvents = exec ? '' : 'none'; }
          });
        }catch(_e){}
      }

      render();
      bodyEl.appendChild(wrap);
    },
    async execute(ctx){
      const d = (ctx && ctx.node && ctx.node.data) || {};
      const selected = Array.isArray(d.selected) ? d.selected.slice() : [];
      const root = window.Yuuka || {};
      const services = root.services || {};
      const capsSvc = services.capabilities;
      const allCaps = (capsSvc && typeof capsSvc.listLLMCallable === 'function') ? (capsSvc.listLLMCallable() || []) : [];
      const resolveCap = (fnName)=>{
        const target = String(fnName||'').trim().toLowerCase();
        if(!target) return null;
        for(const c of allCaps){
          if(!c || !c.llmCallable) continue;
          const n = ((c.llmName && String(c.llmName)) || String(c.id||'')).trim().toLowerCase();
          if(n && n === target) return c;
        }
        return null;
      };
      
      const defs = { selected };

      const structuredProps = {};
      selected.forEach(name => {
        const key = typeof name === 'string' ? name.trim() : '';
        if(!key) return;
        const cap = resolveCap(key);
        const label = cap && (cap.title || cap.description || cap.id);
        structuredProps[key] = {
          type: ['string', 'null'],
          description: label ? `Summary field for tool "${label}"` : `Summary field for tool "${key}"`
        };
      });
      if(Object.keys(structuredProps).length){
        defs.structured_output = { properties: structuredProps };
      }

      if(!d.execute){
        return { tool_definitions: defs };
      }
      // Build calls
      const calls = selected.map(id=>{
        let args = {};
        try{
          const raw = d.payloads && d.payloads[id];
          if(typeof raw === 'string' && raw.trim()) args = JSON.parse(raw);
          else if(raw && typeof raw === 'object') args = raw;
        }catch(_e){ args = {}; }
        return { name: id, args, arguments: args };
      });

      // Execute synchronously so stage runner can route results to Preview
      const results = [];
      for(const c of calls){
        const cap = resolveCap(c.name);
        if(!cap){ results.push({ name:c.name, ok:false, error:'Not available' }); continue; }
        try{
          const res = (capsSvc && typeof capsSvc.invoke==='function') ? await capsSvc.invoke(cap.id, c.args, { source:'maid' }) : await (cap.invoke ? cap.invoke(c.args) : Promise.resolve(null));
          results.push({ name:c.name, ok:true, result: res });
        }catch(err){ results.push({ name:c.name, ok:false, error:String(err&&err.message||err) }); }
      }
      try{ window.dispatchEvent(new CustomEvent('maid-chan:tools:executed', { detail: { results } })); }catch(_e){}

      // Format for System Prompt (summary)
      const formatResult = (r) => {
            if (!r || !r.result) return '';
            const res = r.result;
            if (typeof res === 'string') return res;
            if (typeof res === 'object') {
                const parts = [];
                for (const [k, v] of Object.entries(res)) {
                    parts.push(`${k}: ${v}`);
                }
                return `[${parts.join(', ')}]`;
            }
            return String(res);
      };
      const summary = results.map(formatResult).join('\n');

      return { 
          tool_definitions: defs,
          tool_results: results,
          system_prompt: { role: 'system', content: summary }
      };
    }
  });

  // LLM loader (renamed from "LLM settings")
  add({
    type: 'LLM loader',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'llm_settings', label:'LLM Settings' } ] },
    defaultData(){ return { model: '', temperature: 0.7, top_p: 1, max_tokens: 512 }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      // ...existing code...
      // Model list (from settings/llm_api.js cached storage) - per-node override
      const modelsKey = 'maid-chan:llm-models';
      const loadModels = ()=>{ try{ const raw = window.localStorage.getItem(modelsKey); return raw? JSON.parse(raw):[]; }catch(_e){ return []; } };

      const modelWrap = document.createElement('div'); modelWrap.className = 'mc-node-col';
      const modelLab = document.createElement('div'); modelLab.textContent = 'Model'; modelLab.className = 'mc-node-label'; modelWrap.appendChild(modelLab);
      const modelSel = document.createElement('select');
      const models = loadModels();
      const getId = (m)=> typeof m==='string' ? m : (m && (m.id||m.name||''));
      let currentModel = (node.data && node.data.model) || '';
      if(!models.length){
        const opt = document.createElement('option'); opt.value=''; opt.textContent='No models available'; modelSel.appendChild(opt); modelSel.disabled = true;
      }else{
        const ids = models.map(getId);
        if(currentModel && !ids.includes(currentModel)){
          currentModel = ids[0] || '';
          node.data = node.data || {}; node.data.model = currentModel; if(onDataChange) onDataChange(node.data);
        }
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
        const wrap = document.createElement('div'); wrap.className = 'mc-node-col';
        const lab = document.createElement('div'); lab.textContent = labelTxt; lab.className = 'mc-node-label'; wrap.appendChild(lab);
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
    execute(ctx){
      const modelsKey = 'maid-chan:llm-models';
      const cfgKey = 'maid-chan:llm-config';
      const loadJson = (k)=>{ try{ const raw = window.localStorage.getItem(k); return raw? JSON.parse(raw):null; }catch(_e){ return null; } };
      const models = (()=>{ const m = loadJson(modelsKey); return Array.isArray(m)? m: []; })();
      const cfg = loadJson(cfgKey) || {};
      const data = Object.assign({}, ctx.node.data || {});
      const getId = (m)=> typeof m==='string' ? m : (m && (m.id||m.name||''));
      const ids = models.map(getId);

      // Provider/endpoint fallback from global config unless explicitly set on node
      if(!data.provider && cfg.provider){ data.provider = cfg.provider; }
      if(!data.endpoint && cfg.endpoint){ data.endpoint = cfg.endpoint; }

      // Pick a model: prefer node data if still present in current list, else fallback to config or first available
      let model = data.model;
      if(model && !ids.includes(model)){
        model = '';
      }
      if(!model && cfg.model){
        model = cfg.model;
      }
      if(!model && ids.length){
        model = ids[0];
      }
      if(model){ data.model = model; }

      return { llm_settings: data };
    }
  });

  add({
    type: 'Events',
    category: 'input',
    ports: { inputs: [], outputs: [ { id:'system_prompt', label:'System Prompt' }, { id:'messages', label:'Messages' } ] },
    defaultData(){ return { selected: [], prompts: {} }; },
    buildConfigUI(bodyEl, node, {onDataChange}){
      const wrap = document.createElement('div');
      wrap.className = 'mc-node-col-loose';

      const hint = document.createElement('div');
      hint.className = 'mc-chip';
      hint.textContent = 'Select events to include context for';
      wrap.appendChild(hint);

      const rows = document.createElement('div');
      rows.className = 'mc-node-col-loose';
      wrap.appendChild(rows);

      function getEvents(){
        try{
          const root = window.Yuuka || {};
          // Prefer registry if bootstrap has attached one
          const reg = root.maidEventRegistry;
          if(reg && typeof reg.list === 'function'){
            const names = reg.list() || [];
            const out = names
              .filter(n => typeof n === 'string' && n.trim())
              .map(n => ({ name: n, label: n }));
            out.sort((a,b)=> a.label.localeCompare(b.label));
            return out;
          }
          return [];
        }catch(_e){ return []; }
      }

      const options = getEvents();

      function render(){
        rows.innerHTML = '';
        node.data = node.data || {};
        if(!Array.isArray(node.data.selected)) node.data.selected = [];
        node.data.prompts = node.data.prompts || {};
        const sel = node.data.selected.slice();

        function makeRow(value, isTrailing, idxInSel){
          const container = document.createElement('div');
          container.className = 'mc-node-col';
          if(!isTrailing) {
              container.className = 'mc-node-group';
          }

          const row = document.createElement('div');
          row.className = 'mc-node-row';
          
          const select = document.createElement('select'); select.style.flex = '1 1 auto';
          const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = isTrailing ? 'Add event...' : '(select event)'; select.appendChild(emptyOpt);
          for(const opt of options){ const o = document.createElement('option'); o.value = opt.name; o.textContent = opt.label; select.appendChild(o); }
          select.value = value || '';

          const removeBtn = document.createElement('button'); removeBtn.type='button'; removeBtn.className='mc-icon-btn'; removeBtn.title='Remove'; removeBtn.innerHTML='<span class="material-symbols-outlined">close</span>';
          removeBtn.addEventListener('click', ()=>{
            if(isTrailing) return;
            if(idxInSel>=0){ sel.splice(idxInSel,1); node.data.selected = sel; onDataChange && onDataChange(); render(); }
          });

          select.addEventListener('change', ()=>{
            const v = select.value;
            if(!v){
              if(!isTrailing && value){
                if(idxInSel>=0){ sel.splice(idxInSel,1); node.data.selected = sel; onDataChange && onDataChange(); render(); }
              }
              return;
            }
            if(isTrailing){
              if(!sel.includes(v)){
                sel.push(v);
                node.data.selected = sel; onDataChange && onDataChange(); render();
              } else {
                select.value = '';
              }
            } else {
              const current = value || '';
              if(v === current) return;
              const dupIdx = sel.indexOf(v);
              if(dupIdx !== -1 && dupIdx !== idxInSel){
                select.value = current;
                return;
              }
              if(idxInSel>=0){ sel[idxInSel] = v; node.data.selected = sel; onDataChange && onDataChange(); render(); }
            }
          });

          row.appendChild(select);
          if(!isTrailing){ row.appendChild(removeBtn); }
          container.appendChild(row);

          if(!isTrailing){
              const ta = document.createElement('textarea');
              ta.className = 'mc-node-textarea-small';
              ta.rows = 3;
              ta.placeholder = 'Custom output prompt...';
              ta.value = (node.data.prompts && node.data.prompts[value]) || '';
              ta.addEventListener('change', ()=>{
                  node.data.prompts = node.data.prompts || {};
                  node.data.prompts[value] = ta.value;
                  onDataChange && onDataChange(node.data);
              });
              container.appendChild(ta);
          }

          rows.appendChild(container);
        }

        sel.forEach((v, i)=> makeRow(v, false, i));
        makeRow('', true, -1);
      }

      render();
      bodyEl.appendChild(wrap);
    },
    execute(ctx){
      const d = (ctx && ctx.node && ctx.node.data) || {};
      const selected = Array.isArray(d.selected) ? d.selected : [];
      const promptsMap = d.prompts || {};

      // If executed without an event context, emit nothing (acts as a filter).
      const context = (ctx && ctx.context) || {};
      const evName = context.eventName;
      const evPayload = context.eventPayload;

      if(!evName || !selected.includes(evName)){
        return { system_prompt: [], messages: [] };
      }

      const basePrompt = (promptsMap[evName] || '').trim();
      if(!basePrompt){
        return { system_prompt: [], messages: [] };
      }

      // Template substitution: {{key}} -> find value recursively in evPayload
      let processedPrompt = basePrompt;
      if(evPayload && typeof evPayload === 'object'){
        const findVal = (obj, target) => {
            if(!obj || typeof obj !== 'object') return undefined;
            if(Object.prototype.hasOwnProperty.call(obj, target)) return obj[target];
            for(const k in obj){
                if(Object.prototype.hasOwnProperty.call(obj, k) && typeof obj[k] === 'object'){
                    const res = findVal(obj[k], target);
                    if(res !== undefined) return res;
                }
            }
            return undefined;
        };

        processedPrompt = processedPrompt.replace(/\{\{([^}]+)\}\}/g, (m, k)=>{
           const key = k.trim();
           const val = findVal(evPayload, key);
           if(val !== undefined){
             return (typeof val === 'object') ? JSON.stringify(val) : String(val);
           }
           return m;
        });
      }

      // Attach payload as JSON block to help LLM reason about the event
      let payloadText = '';
      if(evPayload !== undefined){
        try{ payloadText = '\n\n[Event payload]\n' + JSON.stringify(evPayload, null, 2); }
        catch(_e){ payloadText = '\n\n[Event payload]\n' + String(evPayload); }
      }

      const finalText = processedPrompt + payloadText;
      const msg = { role: 'system', content: finalText };

      return {
        system_prompt: [processedPrompt],
        messages: [msg]
      };
    }
  });
})();
