(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }

  add({
    type: 'Save history',
    category: 'output',
    ports: { inputs: [ { id:'message', label:'Message' }, { id:'tools_result', label:'Tools result' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){
      const now = Date.now();
      const text = String((ctx && ctx.inputs && ctx.inputs.message) || '');
      const tools = ctx && ctx.inputs ? ctx.inputs.tools_result : null;

      // Fire-and-forget: post to backend API in background
      (async function(){
        try{
          // Build assistant message using snapshots schema expected by backend
          const part = { text, timestamp: now };
          if(tools != null && tools !== ''){
            try{ part.tool_results_text = (typeof tools === 'string') ? tools : JSON.stringify(tools); }catch(_e){}
          }
          const message = {
            role: 'assistant',
            kind: 'chat',
            snapshots: { parts: [part], current_index: 0 }
          };

          // Prefer plugin API client (includes auth)
          const root = window.Yuuka || {};
          const ns = root.plugins && root.plugins['maid-chan'];
          const coreApi = ns && ns.coreApi;
          if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
            coreApi.createPluginApiClient('maid');
            const client = coreApi.maid;
            if(client && typeof client.post === 'function'){
              await client.post('/chat/append', { message });
              return;
            }
          }
          // Fallback direct fetch
          await fetch('/api/plugin/maid/chat/append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ message })
          });
        }catch(_e){ /* swallow network errors */ }
      })();

      // Legacy localStorage fallback for offline/debugging
      try{
        const key='maid-chan:history-log';
        const raw=localStorage.getItem(key);
        const arr=raw? JSON.parse(raw):[];
        arr.push({ ts: now, msg: text, tools });
        localStorage.setItem(key, JSON.stringify(arr.slice(-500)));
      }catch(_e){}

      return {};
    }
  });

  add({
    type: 'Send to chat UI',
    category: 'output',
    ports: { inputs: [ { id:'message', label:'Message' }, { id:'tools_result', label:'Tools result' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){ /* stub: dispatch event */ try{ window.dispatchEvent(new CustomEvent('maid-chan:new-chat-message',{ detail:{ message: ctx.inputs?.message||'', tools: ctx.inputs?.tools_result||null }})); }catch(e){} return {}; }
  });

  add({
    type: 'Send to chat bubble',
    category: 'output',
    ports: { inputs: [ { id:'message', label:'Message' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){ try{ window.dispatchEvent(new CustomEvent('maid-chan:new-bubble-message',{ detail:{ message: ctx.inputs?.message||'' }})); }catch(e){} return {}; }
  });

  // Preview node: displays the latest LLM result directly inside this node's body.
  const PreviewRegistry = (function(){
    if(!window.__MaidChanPreviewRegistry){ window.__MaidChanPreviewRegistry = new Map(); }
    // One-time global listener that routes updates by nodeId
    if(!window.__MaidChanPreviewListener){
      window.__MaidChanPreviewListener = true;
      window.addEventListener('maid-chan:preview:update', (ev)=>{
        try{
          const det = ev && ev.detail || {};
          const id = det.nodeId;
          const updater = window.__MaidChanPreviewRegistry && window.__MaidChanPreviewRegistry.get(id);
          if(typeof updater === 'function') updater(det);
        }catch(_e){}
      });
    }
    return window.__MaidChanPreviewRegistry;
  })();

  add({
    type: 'Preview',
    category: 'output',
    ports: { inputs: [ { id:'message', label:'Message' }, { id:'tools_result', label:'Tools result' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl, node){
      const wrap = document.createElement('div'); wrap.className = 'mc-preview';
      const msg = document.createElement('div'); msg.className = 'mc-preview-message'; msg.textContent = '(no message)';
      const tools = document.createElement('div'); tools.className = 'mc-preview-tools'; tools.textContent = '';
      wrap.appendChild(msg); wrap.appendChild(tools); bodyEl.appendChild(wrap);
      const set = ({ message, text, toolsResult })=>{
        const content = (message && (message.content||message.text)) || text || '';
        msg.textContent = content || '(empty)';
        if(toolsResult == null || toolsResult === ''){ tools.style.display='none'; }
        else { tools.style.display='block'; tools.textContent = typeof toolsResult === 'string' ? toolsResult : JSON.stringify(toolsResult, null, 2); }
        // Auto-save preview payload per node (persist last seen content + tools)
        try{
          const key = 'maid-chan:preview:'+ node.id;
            const payload = { ts: Date.now(), content: content, tools: toolsResult };
            window.localStorage.setItem(key, JSON.stringify(payload));
        }catch(_e){}
      };
      PreviewRegistry.set(node.id, set);
      // Load previously saved preview state (if any)
      try{
        const raw = window.localStorage.getItem('maid-chan:preview:'+node.id);
        if(raw){
          const saved = JSON.parse(raw);
          if(saved && typeof saved === 'object'){
            msg.textContent = saved.content ? String(saved.content) : '(empty)';
            if(saved.tools == null || saved.tools === ''){ tools.style.display='none'; }
            else { tools.style.display='block'; tools.textContent = typeof saved.tools === 'string' ? saved.tools : JSON.stringify(saved.tools, null, 2); }
          }
        }
      }catch(_e){}
    },
    execute(ctx){ /* UI-only; no side-effect */ return {}; }
  });

  // Tools execution node: executes tool calls emitted by an LLM
  add({
    type: 'Tools execution',
    category: 'output',
    ports: { inputs: [ { id:'tools_result', label:'Tools result' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){
      const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='Executes tool calls from LLM'; bodyEl.appendChild(hint);
      const note = document.createElement('div'); note.style.fontSize='12px'; note.style.opacity='.8'; note.textContent='Runs capabilities for standard tools. Custom choice tools are ignored here.'; bodyEl.appendChild(note);
    },
    execute(ctx){
      try{
        const input = ctx && ctx.inputs ? ctx.inputs.tools_result : null;
        const calls = (function(r){
          if(!r || typeof r !== 'object') return [];
          if(r.type === 'tool_calls' && Array.isArray(r.calls)) return r.calls;
          if(r.type === 'tool_call' && r.name){ return [{ name: r.name, arguments: r.arguments || r.args || {} }]; }
          if(Array.isArray(r.function_calls)) return r.function_calls;
          return [];
        })(input);
        if(!calls.length) return {};

        const root = window.Yuuka || {}; const services = root.services || {}; const capsSvc = services.capabilities;
        const resolveCap = (fnName)=>{
          if(!capsSvc || typeof capsSvc.listLLMCallable !== 'function') return null;
          const all = capsSvc.listLLMCallable() || [];
          const target = String(fnName||'').trim().toLowerCase();
          for(const c of all){
            if(!c || !c.llmCallable) continue;
            const n = ((c.llmName && String(c.llmName)) || String(c.id||'')).trim().toLowerCase();
            if(n && n === target) return c;
          }
          return null;
        };

        (async function(){
          for(const c of calls){
            const fn = c && c.name ? String(c.name) : '';
            if(!fn) continue;
            // Skip custom choice tool; handled by Choice nodes
            if(fn === 'mc_choice' || fn === 'choice' || fn.toLowerCase().includes('choice')) continue;
            const args = (c && (c.arguments || c.args)) || {};
            try{
              const cap = resolveCap(fn);
              if(cap && capsSvc && typeof capsSvc.invoke === 'function'){
                await capsSvc.invoke(cap.id, args, { source: 'maid' });
              }else{
                // Broadcast event for external handlers
                window.dispatchEvent(new CustomEvent('maid-chan:tools:execute', { detail: { name: fn, args } }));
              }
            }catch(_e){ /* ignore errors */ }
          }
        })();

        return {};
      }catch(_e){ return {}; }
    }
  });
})();
