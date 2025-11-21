// --- NEW FILE: plugins/maid-chan/static/node/output.js ---
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
      const msgInputs = (ctx && ctx.inputs && ctx.inputs.response_message) ? ctx.inputs.response_message : [];
      const toolInputs = (ctx && ctx.inputs && ctx.inputs.tool_results) ? ctx.inputs.tool_results : [];
      
      const msgs = msgInputs.flat();
      const tools = toolInputs.flat();

      if (msgs.length === 0) return {};

      let toolResultsText = null;
      const toolInfo = [];

      if (tools.length > 0) {
        const rawResultChunks = [];
        const systemPromptChunks = [];

        for (const item of tools) {
          if (!item) continue;
          if (Array.isArray(item) && item.every(t => t && typeof t === 'object' && ('name' in t || 'result' in t || 'error' in t))) {
            rawResultChunks.push(...item);
            continue;
          }
          if (!Array.isArray(item) && typeof item === 'object' && ('name' in item || 'result' in item || 'error' in item)) {
            rawResultChunks.push(item);
            continue;
          }
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

      const ctxAssistantId = (ctx && ctx.context && (ctx.context.assistantMessageId || ctx.context.assistant_message_id)) || null;
      const ctxUserId = (ctx && ctx.context && (ctx.context.userMessageId || ctx.context.user_message_id)) || null;

      (async function(){
        try{
          const root = window.Yuuka || {};
          const ns = root.plugins && root.plugins['maid-chan'];
          const coreApi = ns && ns.coreApi;
          let client = null;
          if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
            coreApi.createPluginApiClient('maid');
            client = coreApi.maid;
          }

          let regenMode = false;
          const ctxModeRaw = (ctx && ctx.context && (ctx.context.mode || ctx.context.userInputMode)) || null;
          if(ctxModeRaw && String(ctxModeRaw).toLowerCase() === 'regen'){
            regenMode = true;
          }else{
            for(const m of msgs){
              if(m && m.role === 'user' && (m.mode === 'regen' || m.regen_mode === true)){
                regenMode = true; break;
              }
            }
          }

          let historyItems = [];
          if(regenMode){
            try{
              if(client && typeof client.get === 'function'){
                const res = await client.get('/chat/history');
                historyItems = Array.isArray(res?.items) ? res.items : [];
              } else {
                const r = await fetch('/api/plugin/maid/chat/history', { credentials:'include' });
                if(r.ok){ const d = await r.json(); historyItems = Array.isArray(d?.items)? d.items: []; }
              }
            }catch(_e){ historyItems = []; }
          }

          const findLastAssistant = () => {
            for(let i = historyItems.length - 1; i >= 0; i--){
              const it = historyItems[i];
              if(it && (it.role === 'assistant' || it.role === 'model')) return it;
            }
            return null;
          };
          const lastAssistant = regenMode ? findLastAssistant() : null;

          const incomingUser = [];
          const incomingAssistant = [];
          for(const m of msgs){
            if(!m) continue;
            const role = String(m.role||'').toLowerCase();
            if(role === 'user') incomingUser.push(m);
            else if(role === 'assistant' || role === 'model') incomingAssistant.push(m);
          }

          for(const m of incomingUser){
            if(m && (m.mode === 'regen' || m.regen_mode === true)){
              try{ console.log('[MaidLogic][SaveHistory][user-skip-regen]', { messageId: m.id || m.user_message_id, nodeId: ctx?.node?.id }); }catch(_e){}
              continue;
            }
            const text = (m.content || m.text || '');
            const msgId = m.id || m.user_message_id || m.message_id || ctxUserId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('msg_'+Date.now()+'_'+Math.random().toString(36).slice(2)));
            const userMessage = { id: msgId, role:'user', text:String(text), kind:'chat', timestamp: now };
            try{
              console.log('[MaidLogic][SaveHistory][user]', { messageId: msgId, nodeId: ctx?.node?.id });
            }catch(_e){/* noop */}
            const payload = { message: userMessage };
            if(client && typeof client.post === 'function'){
              await client.post('/chat/append', payload);
            }else{
              await fetch('/api/plugin/maid/chat/append', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
            }
          }

          if(!regenMode || !lastAssistant){
            for(const m of incomingAssistant){
              const text = (m.content || m.text || '');
              const msgId = m.id || m.assistant_message_id || m.user_message_id || ctxAssistantId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : ('msg_'+Date.now()+'_'+Math.random().toString(36).slice(2)));
              const part = { text:String(text), timestamp: now };
              if(toolResultsText != null) part.tool_results_text = toolResultsText;
              if(toolInfo.length) part.tool_info = toolInfo;
              else if(m.tool_calls && Array.isArray(m.tool_calls)) part.tool_info = m.tool_calls;
              const assistantMessage = { id: msgId, role:'assistant', kind:'chat', snapshots:{ parts:[part], current_index:0 } };
              try{
                console.log('[MaidLogic][SaveHistory][assistant-new]', { messageId: msgId, nodeId: ctx?.node?.id });
              }catch(_e){/* noop */}
              const payload = { message: assistantMessage };
              if(client && typeof client.post === 'function') await client.post('/chat/append', payload);
              else await fetch('/api/plugin/maid/chat/append', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
            }
          } else {
            const existingParts = (lastAssistant.snapshots && Array.isArray(lastAssistant.snapshots.parts)) ? lastAssistant.snapshots.parts.slice() : [];
            for(const m of incomingAssistant){
              const text = (m.content || m.text || '');
              const part = { text:String(text), timestamp: now };
              if(toolResultsText != null) part.tool_results_text = toolResultsText;
              if(toolInfo.length) part.tool_info = toolInfo;
              else if(m.tool_calls && Array.isArray(m.tool_calls)) part.tool_info = m.tool_calls;
              existingParts.push(part);
            }
            if(existingParts.length){
              try{
                console.log('[MaidLogic][SaveHistory][assistant-regen]', { messageId: lastAssistant.id, nodeId: ctx?.node?.id });
              }catch(_e){/* noop */}
              const payload = {
                id: lastAssistant.id,
                snapshots: {
                  parts: existingParts,
                  current_index: existingParts.length - 1
                }
              };
              if(client && typeof client.post === 'function') await client.post('/chat/snapshot', payload);
              else await fetch('/api/plugin/maid/chat/snapshot', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
            }
          }
        }catch(_e){ }
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

            // Resolve display names
            let maidTitle = 'Maid-chan';
            let userTitle = 'You';
            try{
              const storedTitle = window.localStorage.getItem('maid-chan:title');
              if(storedTitle && storedTitle.trim()){
                let t = storedTitle.trim();
                if((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('\'') && t.endsWith('\''))){
                  t = t.slice(1, -1).trim();
                }
                maidTitle = t || 'Maid-chan';
              }
              const storedUser = window.localStorage.getItem('maid-chan:user-name');
              if(storedUser && storedUser.trim()){
                userTitle = storedUser.trim();
              }
            }catch(_e){}

            for (const msgItem of msgs) {
              if(!msgItem) continue;
              let role = (msgItem.role || '').toLowerCase();
              if(role === 'assistant' || role === 'model') role = 'assistant';
              else if(role !== 'user' && role !== 'system') role = 'user';

              const text = (msgItem.content || msgItem.text || '');
              const now = Date.now();
              
              const providedId = msgItem.id || msgItem.assistant_message_id || msgItem.user_message_id;
              const messageId = providedId || ('gen_' + now + '_' + Math.random().toString(36).slice(2));
              const message = {
                id: messageId,
                role,
                text: String(text),
                kind: msgItem.kind || 'chat',
                timestamp: msgItem.timestamp || now,
                display_name: role === 'assistant' ? maidTitle : (role === 'user' ? userTitle : '[System]'),
                tool_contents: msgItem.tool_contents || null
              };
              if(role === 'assistant'){
                message.assistant_message_id = messageId;
              }
              try{
                console.log('[MaidLogic][SendToChatUI]', { messageId, role, nodeId: ctx?.node?.id });
              }catch(_e){/* noop */}

              // *** FIX: Tự tạo snapshots nếu là Assistant để UI hiển thị nội dung ***
              // Chat Panel hiện tại ưu tiên hiển thị snapshots cho assistant.
              if (role === 'assistant') {
                  if (msgItem.snapshots && typeof msgItem.snapshots === 'object') {
                      message.snapshots = msgItem.snapshots;
                  } else {
                      // Đóng gói text thành snapshot part 0
                      message.snapshots = {
                          current_index: 0,
                          parts: [{
                              text: String(text),
                              timestamp: now,
                              // Nếu có tool results từ input thứ 2, có thể gắn vào đây
                          }]
                      };
                  }
              }

              // Tìm DOM UI Chat Panel
              const panelEl = document.querySelector('.maid-chan-tab-panel-chat') || 
                              document.querySelector('.maid-chan-tab-panel[data-tab="chat"]');
              
              if(panelEl && panelEl.__maidChanChatPanel && typeof panelEl.__maidChanChatPanel.push === 'function'){
                // Gọi trực tiếp API của Panel để push tin nhắn
                panelEl.__maidChanChatPanel.push(message);
              } else {
                // Fallback bắn event
                window.dispatchEvent(new CustomEvent('maid-chan:new-chat-message',{
                  detail:{ message, tools: tools.length ? tools : null }
                })); 
              }
            }
        }catch(e){ console.error('[Send to chat UI] Error:', e); } 
        return {}; 
    }
  });

  add({
    type: 'Reply UI effect',
    category: 'output',
    ports: { inputs: [ { id:'start_signal', label:'Start signal' }, { id:'end_signal', label:'End signal' } ], outputs: [] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){ const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint); },
    execute(ctx){
      try{
        const startRaw = ctx && ctx.inputs && ctx.inputs.start_signal;
        const endRaw = ctx && ctx.inputs && ctx.inputs.end_signal;
        const hasStart = Array.isArray(startRaw) ? startRaw.length > 0 : !!startRaw;
        const hasEnd = Array.isArray(endRaw) ? endRaw.length > 0 : !!endRaw;

        // Tìm phần tử hiển thị status text trong Chat Panel (tìm global cho chắc chắn)
        const statusEls = document.getElementsByClassName('maid-chan-chat-status');
        const statusEl = statusEls.length > 0 ? statusEls[0] : null;

        if(hasEnd){
          // Nếu có tín hiệu kết thúc, ưu tiên xóa status
          if(statusEl){
             statusEl.textContent = '';
          }
          window.dispatchEvent(new CustomEvent('maid-chan:chat:typing', { detail:{ active:false }}));
          window.dispatchEvent(new CustomEvent('maid-chan:chat:placeholder', { detail:{ active:false, nodeId: ctx?.node?.id } }));
        } 
        else if(hasStart){
          // Chỉ hiện typing nếu không có tín hiệu kết thúc
          if(statusEl){
             let maidName = 'Maid-chan';
             try{
               const storedTitle = window.localStorage.getItem('maid-chan:title');
               if(storedTitle && storedTitle.trim()){
                 let s = storedTitle.trim();
                 if((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))){ s = s.slice(1, -1).trim(); }
                 if(s) maidName = s;
               }
             }catch(_e){}
             statusEl.textContent = maidName + ' đang trả lời...';
          }
          window.dispatchEvent(new CustomEvent('maid-chan:chat:typing', { detail:{ active:true }}));
           window.dispatchEvent(new CustomEvent('maid-chan:chat:placeholder', { detail:{ active:true, nodeId: ctx?.node?.id } }));
        }
      }catch(_e){ console.error('[Reply UI effect] Error:', _e); }
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

                try{
                  const MaidComp = window.Yuuka && window.Yuuka.components && window.Yuuka.components.MaidChanComponent;
                  const inst = window.Yuuka && window.Yuuka.plugins && window.Yuuka.plugins.maidChanInstance;
                  if(inst && typeof inst._showChatBubble === 'function'){
                    inst._showChatBubble({ text });
                  }else if(typeof MaidComp === 'function'){
                    const tmp = new MaidComp(document.body, window.Yuuka && window.Yuuka.ai);
                    if(tmp && typeof tmp._createBubble === 'function'){
                      tmp._createBubble();
                    }
                    if(tmp && typeof tmp._showChatBubble === 'function'){
                      tmp._showChatBubble({ text });
                    }
                  }else{
                    window.dispatchEvent(new CustomEvent('maid-chan:new-bubble-message',{ detail:{ message: text }}));
                  }
                }catch(_inner){}
            }
        }catch(e){} 
        return {}; 
    }
  });

  const PreviewRegistry = (function(){
    if(!window.__MaidChanPreviewRegistry){ window.__MaidChanPreviewRegistry = new Map(); }
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
        let msgObj = message || response_message || text;
        
        const getText = (v) => {
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object') return v.content || v.text || '';
            return '';
        };

        let content = '';
        if (Array.isArray(msgObj)) {
            if (msgObj.length > 0 && Array.isArray(msgObj[0])) {
                msgObj = msgObj.flat();
            }
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
        
        try{
          const key = 'maid-chan:preview:'+ node.id;
            const payload = { ts: Date.now(), content: content, tools: tRes };
            window.localStorage.setItem(key, JSON.stringify(payload));
        }catch(_e){}
      };
      PreviewRegistry.set(node.id, set);
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
      try{
        const updater = PreviewRegistry.get(ctx.node.id);
        if(updater){
          const msgObj = (ctx.inputs && ctx.inputs.response_message) ? ctx.inputs.response_message : null;
          const toolsInput = ctx.inputs ? ctx.inputs.tool_results : null;
          const tools = (Array.isArray(toolsInput) && Array.isArray(toolsInput[0])) ? toolsInput.flat() : toolsInput;
          
          updater({ message: msgObj, toolsResult: tools });
          
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