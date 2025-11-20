(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }

  add({
    type: 'Save history',
    category: 'output',
    ports: { inputs: [ { id:'response_message', label:'Response Message' }, { id:'tool_results', label:'Tool Results' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){
      const now = Date.now();
      // Handle generic array inputs
      const msgInputs = (ctx && ctx.inputs && ctx.inputs.response_message) ? ctx.inputs.response_message : [];
      const toolInputs = (ctx && ctx.inputs && ctx.inputs.tool_results) ? ctx.inputs.tool_results : [];
      
      const msgs = msgInputs.flat();
      const tools = toolInputs.flat();

      // If no messages, nothing to save
      if (msgs.length === 0) return {};

      // Determine tool metadata according to source semantics.
      // Cho phép đồng thời:
      // - Nhiều dòng System Prompt summary -> gộp vào tool_results_text.
      // - Nhiều Raw Results (mảng object) -> gộp vào tool_info.
      let toolResultsText = null;
      const toolInfo = [];

      if (tools.length > 0) {
        const rawResultChunks = [];
        const systemPromptChunks = [];

        for (const item of tools) {
          if (!item) continue;

          // Raw Results: mảng object { name/result/error/... }
          if (Array.isArray(item) && item.every(t => t && typeof t === 'object' && ('name' in t || 'result' in t || 'error' in t))) {
            rawResultChunks.push(...item);
            continue;
          }

          // Một object đơn lẻ kiểu result cũng tính là raw
          if (!Array.isArray(item) && typeof item === 'object' && ('name' in item || 'result' in item || 'error' in item)) {
            rawResultChunks.push(item);
            continue;
          }

          // Còn lại xem như summary text từ System Prompt
          systemPromptChunks.push(item);
        }

        if (rawResultChunks.length > 0) {
          toolInfo.push(...rawResultChunks);
        }

        if (systemPromptChunks.length > 0) {
          try { toolResultsText = JSON.stringify(systemPromptChunks); }
          catch(_e){ toolResultsText = String(systemPromptChunks); }
        }
      }

      // Fire-and-forget: post to backend API in background
      (async function(){
        try{
          // Prefer plugin API client (includes auth)
          const root = window.Yuuka || {};
          const ns = root.plugins && root.plugins['maid-chan'];
          const coreApi = ns && ns.coreApi;
          let client = null;
          if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
            coreApi.createPluginApiClient('maid');
            client = coreApi.maid;
          }

          for (const msgItem of msgs) {
              const text = (msgItem && (msgItem.content || msgItem.text)) ? String(msgItem.content || msgItem.text) : '';
              const role = (msgItem && msgItem.role) ? String(msgItem.role).toLowerCase() : 'assistant';
              const msgId = msgItem.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('msg_'+Date.now()+'_'+Math.random().toString(36).slice(2)));

              let message;
              if(role === 'assistant'){
                  // Build assistant message using snapshots schema expected by backend
                  const part = { text, timestamp: now };

                  // Persist tool metadata according to resolved semantics
                  if(toolResultsText != null){
                    part.tool_results_text = toolResultsText;
                  }
                  if(toolInfo && toolInfo.length){
                    part.tool_info = toolInfo;
                  } else if(msgItem.tool_calls && Array.isArray(msgItem.tool_calls)){
                    // Fallback: legacy LLM tool_calls still attached on response_message
                    part.tool_info = msgItem.tool_calls;
                  }
                  message = {
                    id: msgId,
                    role: 'assistant',
                    kind: 'chat',
                    snapshots: { parts: [part], current_index: 0 }
                  };
              } else {
                 // User, system, or other roles use simple structure
                 message = {
                    id: msgId,
                    role: role,
                    text: text,
                    kind: 'chat',
                    timestamp: now
                 };
              }

              if(client && typeof client.post === 'function'){
                await client.post('/chat/append', { message });
              } else {
                // Fallback direct fetch
                await fetch('/api/plugin/maid/chat/append', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ message })
                });
              }
          }
        }catch(_e){ /* swallow network errors */ }
      })();

      return {};
    }
  });

  add({
    type: 'Send to chat UI',
    category: 'output',
    ports: { inputs: [ { id:'response_message', label:'Response Message' }, { id:'tool_results', label:'Tool Results' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){ 
        try{ 
            const msgInputs = (ctx.inputs && ctx.inputs.response_message) ? ctx.inputs.response_message : [];
            const toolInputs = (ctx.inputs && ctx.inputs.tool_results) ? ctx.inputs.tool_results : [];
            
            const msgs = msgInputs.flat();
            const tools = toolInputs.flat();

            for (const msgItem of msgs) {
                window.dispatchEvent(new CustomEvent('maid-chan:new-chat-message',{ detail:{ message: msgItem||'', tools: tools.length ? tools : null }})); 
            }
        }catch(e){} 
        return {}; 
    }
  });

  add({
    type: 'Send to chat bubble',
    category: 'output',
    ports: { inputs: [ { id:'response_message', label:'Response Message' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){ 
        try{ 
            const msgInputs = (ctx.inputs && ctx.inputs.response_message) ? ctx.inputs.response_message : [];
            const msgs = msgInputs.flat();

            for (const msgItem of msgs) {
                let text = '';
                if(typeof msgItem === 'string') text = msgItem;
                else if(msgItem && (msgItem.content || msgItem.text)) text = String(msgItem.content || msgItem.text);

                // Prefer calling Maid bubble helper directly if available
                try{
                  const MaidComp = window.Yuuka && window.Yuuka.components && window.Yuuka.components.MaidChanComponent;
                  const inst = window.Yuuka && window.Yuuka.plugins && window.Yuuka.plugins.maidChanInstance;
                  if(inst && typeof inst._showChatBubble === 'function'){
                    inst._showChatBubble({ text });
                  }else if(typeof MaidComp === 'function'){
                    // Lazy-create a temporary component instance if none exists yet
                    const tmp = new MaidComp(document.body, window.Yuuka && window.Yuuka.ai);
                    if(tmp && typeof tmp._createBubble === 'function'){
                      tmp._createBubble();
                    }
                    if(tmp && typeof tmp._showChatBubble === 'function'){
                      tmp._showChatBubble({ text });
                    }
                  }else{
                    // Fallback: legacy event so older listeners still work
                    window.dispatchEvent(new CustomEvent('maid-chan:new-bubble-message',{ detail:{ message: text }}));
                  }
                }catch(_inner){}
            }
        }catch(e){} 
        return {}; 
    }
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
    ports: { inputs: [ { id:'response_message', label:'Response Message' }, { id:'tool_results', label:'Raw Results' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl, node){
      const wrap = document.createElement('div'); wrap.className = 'mc-preview';
      const msg = document.createElement('div'); msg.className = 'mc-preview-message'; msg.textContent = '(no message)';
      const tools = document.createElement('div'); tools.className = 'mc-preview-tools'; tools.textContent = '';
      wrap.appendChild(msg); wrap.appendChild(tools); bodyEl.appendChild(wrap);
      const set = ({ message, response_message, text, toolsResult, tool_results })=>{
        // Handle message object or text string
        let msgObj = message || response_message || text;
        
        // Helper to extract text content from a single item
        const getText = (v) => {
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object') return v.content || v.text || '';
            return '';
        };

        let content = '';
        if (Array.isArray(msgObj)) {
            // If the array contains arrays (e.g. multiple inputs), flatten it
            if (msgObj.length > 0 && Array.isArray(msgObj[0])) {
                msgObj = msgObj.flat();
            }
            // Take the last item (assuming it's the latest message in a history or the result)
            if (msgObj.length > 0) {
                content = getText(msgObj[msgObj.length - 1]);
            }
        } else {
            content = getText(msgObj);
        }

        msg.textContent = content || '(empty)';
        
        const tRes = toolsResult || tool_results;
        if(tRes == null || tRes === ''){ tools.style.display='none'; }
        else { 
          tools.style.display='block'; 
          let val = tRes;
          if(typeof val !== 'string'){
            try{ val = JSON.stringify(val, null, 2); }catch(e){ val = String(val); }
          }
          tools.textContent = val;
        }
        
        // Auto-save preview payload per node (persist last seen content + tools)
        try{
          const key = 'maid-chan:preview:'+ node.id;
            const payload = { ts: Date.now(), content: content, tools: tRes };
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
            else { 
              tools.style.display='block'; 
              let val = saved.tools;
              if(typeof val !== 'string'){
                try{ val = JSON.stringify(val, null, 2); }catch(e){ val = String(val); }
              }
              tools.textContent = val;
            }
          }
        }
      }catch(_e){}
    },
    execute(ctx){ 
      /* UI-only; no side-effect */ 
      try{
        const updater = PreviewRegistry.get(ctx.node.id);
        if(updater){
          const msgObj = (ctx.inputs && ctx.inputs.response_message) ? ctx.inputs.response_message : null;
          const toolsInput = ctx.inputs ? ctx.inputs.tool_results : null;
          const tools = (Array.isArray(toolsInput) && Array.isArray(toolsInput[0])) ? toolsInput.flat() : toolsInput;
          
          // Update UI immediately
          updater({ message: msgObj, toolsResult: tools });
          
          // Return data so the preview event contains it (preventing overwrite with empty data)
          // Include both keys to be safe for the updater
          return { 
            message: msgObj,
            response_message: msgObj, 
            toolsResult: tools,
            tool_results: tools 
          };
        }
      }catch(e){}
      return {}; 
    }
  });

})();
