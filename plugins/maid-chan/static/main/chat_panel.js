(function(){
  // Maid-chan Chat Panel
  // Simple chat + log style UI with history persisted in data_cache via backend API.

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  const NAMESPACE = 'maid-chan:chat-panel';

  // Optional helpers from AI namespace (if loaded)
  const MaidStorage = (window.Yuuka.ai && window.Yuuka.ai.MaidStorage) || null;
  const MaidCore = (window.Yuuka.ai && window.Yuuka.ai.MaidCore) || null;

  // Backend helper: always ưu tiên API client có kèm auth token
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

  // Thin wrapper over gallery API, luôn đi qua lớp có Authorization header
  async function apiGet(path){
    const pluginApi = getPluginApi();
    if(pluginApi && typeof pluginApi.get === 'function'){
      // Chuẩn plugin route: strip prefix nếu cần
      const rel = path.replace(/^\/api\/plugin\/maid/, '');
      return await pluginApi.get(rel || '/chat/history');
    }
    if(window.Yuuka?.services?.api?.get){
      return await window.Yuuka.services.api.get(path);
    }
    const res = await fetch(path, { credentials: 'include' });
    if(res.status === 404){
      return { items: [] };
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }

  async function apiPost(path, payload){
    const pluginApi = getPluginApi();
    if(pluginApi && typeof pluginApi.post === 'function'){
      const rel = path.replace(/^\/api\/plugin\/maid/, '');
      return await pluginApi.post(rel || '/chat/append', payload);
    }
    if(window.Yuuka?.services?.api?.post){
      return await window.Yuuka.services.api.post(path, payload);
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload || {})
    });
    if(res.status === 404){
      return {};
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }

  async function apiPatch(path, payload){
    const pluginApi = getPluginApi();
    if(pluginApi && typeof pluginApi.post === 'function'){
      // backend currently exposes snapshot as POST
      const rel = path.replace(/^\/api\/plugin\/maid/, '');
      return await pluginApi.post(rel || '/chat/snapshot', payload);
    }
    if(window.Yuuka?.services?.api?.post){
      return await window.Yuuka.services.api.post(path, payload);
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload || {})
    });
    if(res.status === 404){
      return {};
    }
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }

  function createChatUI(root){
    root.classList.add('maid-chan-tab-panel-chat');
    root.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'maid-chan-panel-card maid-chan-chat-card';
    card.innerHTML = `
      <div class="maid-chan-features-header maid-chan-chat-header">
        <div class="maid-chan-features-title">Chat & Activity log</div>
        <div class="maid-chan-features-actions">
          <span class="maid-chan-chat-status" aria-live="polite">Loading history...</span>
          <button class="maid-chan-chat-prompt-btn" type="button" title="View full prompt" aria-label="View full prompt">
            <span class="material-symbols-outlined">call_to_action</span>
          </button>
        </div>
      </div>
      <div class="maid-chan-chat-body">
        <div class="maid-chan-chat-scroll" aria-label="Chat messages" role="log"></div>
        <div class="maid-chan-chat-prompt-view" aria-label="Prompt preview" role="group" hidden>
          <pre class="maid-chan-chat-prompt-text"></pre>
        </div>
      </div>
      <div class="maid-chan-chat-input-row">
        <textarea class="maid-chan-chat-input" rows="1" placeholder="Ra lệnh cho Maid-chan..." aria-label="Chat input"></textarea>
        <button class="maid-chan-chat-send" type="button">
          <span class="material-symbols-outlined">send</span>
        </button>
      </div>
    `;

    root.appendChild(card);

    const scrollBox = card.querySelector('.maid-chan-chat-scroll');
    const input = card.querySelector('.maid-chan-chat-input');
    const sendBtn = card.querySelector('.maid-chan-chat-send');
    const statusEl = card.querySelector('.maid-chan-chat-status');
    const promptBtn = card.querySelector('.maid-chan-chat-prompt-btn');
    const promptView = card.querySelector('.maid-chan-chat-prompt-view');
    const promptTextEl = card.querySelector('.maid-chan-chat-prompt-text');

    const state = {
      loading: true,
      sending: false,
      messages: [], // newest last
      snapshots: new Map() // messageId -> { entries, activeIndex, latestIndex, followLatest, pending }
    };

    const setStatus = (txt)=>{
      if(!statusEl) return;
      statusEl.textContent = txt || '';
    };

    const togglePromptView = ()=>{
      if(!promptView || !promptTextEl) return;
      const showing = !promptView.hasAttribute('hidden');
      if(showing){
        promptView.setAttribute('hidden', 'hidden');
        if(scrollBox) scrollBox.removeAttribute('hidden');
        return;
      }

      // Build full prompt using MaidCore.buildBasePrompt if available
      let promptStr = '';
      try{
        const core = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || MaidCore;
        if(core && typeof core.buildBasePrompt === 'function'){
          const base = core.buildBasePrompt({});
          if(typeof base === 'string'){
            promptStr = base;
          }else if(base && typeof base.prompt === 'string'){
            promptStr = base.prompt;
            // Append Chat samples section (use raw stored text for faithful preview)
            try{
              const rawSamples = window.localStorage.getItem('maid-chan:persona:chatSamples');
              const trimmed = rawSamples ? rawSamples.trim() : '';
              if(trimmed){
                promptStr += '\n\n## Chat samples\n\n' + trimmed;
              }
            }catch(_e){}
          }
        }
      }catch(_e){}

      promptTextEl.textContent = promptStr || '[No prompt configured]';
      if(scrollBox) scrollBox.setAttribute('hidden', 'hidden');
      promptView.removeAttribute('hidden');
    };


    const getSnapshotState = (msg)=>{
      if(!msg || msg.role !== 'assistant') return null;
      const sid = msg.id;
      if(!sid) return null;
      const snap = state.snapshots.get(sid) || null;
      return snap;
    };

    const ensureSnapshotForMessage = (msg)=>{
      if(!msg || msg.role !== 'assistant') return null;
      const id = msg.id;
      if(!id) return null;
      let snap = state.snapshots.get(id);
      const text = msg.text || '';
      if(!snap){
        const entries = Array.isArray(msg.snapshots) && msg.snapshots.length ? [...msg.snapshots] : [text];
        const latestIndex = entries.length - 1;
        let activeIndex = latestIndex;
        if(msg.metadata && typeof msg.metadata.selected_snapshot_index === 'number'){
          const idx = msg.metadata.selected_snapshot_index;
          if(idx >= 0 && idx <= latestIndex) activeIndex = idx;
        }
        snap = {
          entries,
          activeIndex,
          latestIndex,
          followLatest: activeIndex === latestIndex,
          pending: false,
          lastSyncedText: entries[latestIndex] || ''
        };
        state.snapshots.set(id, snap);
      }else{
        // Sync from msg.snapshots + metadata if provided.
        // Ưu tiên dữ liệu từ history (snapshots + selected_snapshot_index),
        // không cố "đoán" lại dựa trên msg.text để tránh lệch index.
        if(Array.isArray(msg.snapshots) && msg.snapshots.length){
          snap.entries = [...msg.snapshots];
          snap.latestIndex = snap.entries.length - 1;
          // Không override activeIndex bằng metadata nữa để giữ lựa chọn của user
          if(typeof snap.activeIndex !== 'number' || snap.activeIndex < 0 || snap.activeIndex > snap.latestIndex){
            snap.activeIndex = snap.latestIndex;
          }
          snap.followLatest = (snap.activeIndex === snap.latestIndex);
          snap.lastSyncedText = snap.entries[snap.latestIndex] || '';
        }else{
          const textNow = msg.text || '';
          if(textNow && (!snap.entries.length || textNow !== snap.entries[snap.latestIndex])){
            const existingIndex = snap.entries.findIndex(t => t === textNow);
            if(existingIndex >= 0){
              snap.latestIndex = existingIndex;
              snap.entries[existingIndex] = textNow;
            }else{
              snap.entries.push(textNow);
              snap.latestIndex = snap.entries.length - 1;
            }
          }
          if(snap.followLatest || snap.entries.length === 1){
            snap.activeIndex = snap.latestIndex;
          }else if(typeof snap.activeIndex !== 'number'){
            snap.activeIndex = snap.latestIndex;
          }
          snap.followLatest = snap.activeIndex === snap.latestIndex;
          snap.lastSyncedText = snap.entries[snap.latestIndex] || '';
        }
      }
      return snap;
    };

    const moveSnapshotPrev = (msg)=>{
      const snap = ensureSnapshotForMessage(msg);
      if(!snap) return;
      if(snap.activeIndex > 0){
        snap.activeIndex -= 1;
        snap.followLatest = snap.activeIndex === snap.latestIndex;
        // persist active index best-effort
        apiPatch('/api/plugin/maid/chat/snapshot', {
          id: msg.id,
          active_index: snap.activeIndex
        }).catch(()=>{});
      }
    };

    const moveSnapshotNext = (msg)=>{
      const snap = ensureSnapshotForMessage(msg);
      if(!snap) return Promise.resolve();
      if(snap.activeIndex < snap.entries.length - 1){
        snap.activeIndex += 1;
        snap.followLatest = snap.activeIndex === snap.latestIndex;
        return apiPatch('/api/plugin/maid/chat/snapshot', {
          id: msg.id,
          active_index: snap.activeIndex
        }).catch(()=>{});
      }
      if(snap.pending) return Promise.resolve();

      // At latest snapshot: trigger regeneration via backend (similar to chat plugin)
      snap.pending = true;

      // Backend /api/plugin/maid/chat expects full LLM config similar to MaidCore.callLLMChat.
      // Reuse localStorage config (provider/model/api_key/temperature/...) so backend has enough info.
      const historyForApi = state.messages.map(m => ({ role: m.role, content: m.text }));

      const cfgRaw = window.localStorage.getItem('maid-chan:llm-config');
      let cfg = {};
      if(cfgRaw){
        try{ cfg = JSON.parse(cfgRaw) || {}; }catch(_e){ cfg = {}; }
      }

      const payload = {
        provider: cfg.provider || 'openai',
        model: cfg.model || '',
        api_key: cfg.api_key || '',
        messages: historyForApi,
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
        top_p: typeof cfg.top_p === 'number' ? cfg.top_p : 1,
        max_tokens: typeof cfg.max_tokens === 'number' ? cfg.max_tokens : 512
      };

      // If using Gemini, attach tools so backend can expose function-calling intent
      try{
        if((payload.provider||'').toLowerCase() === 'gemini'){
          const tools = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore && typeof window.Yuuka.ai.MaidCore.buildToolsFromCapabilities === 'function')
            ? window.Yuuka.ai.MaidCore.buildToolsFromCapabilities()
            : [];
          if(Array.isArray(tools) && tools.length){
            payload.tools = tools;
            payload.tool_mode = 'auto';
          }
        }
      }catch(_e){}

      return apiPost('/api/plugin/maid/chat', payload).then(res => {
        snap.pending = false;
        if(!res) return;
        let assistantText = '';
        let usedTools = [];
        if(typeof res === 'string') assistantText = res;
        else if(res && typeof res === 'object'){
          assistantText = res.text || res.message || res.content || '';
          if(!assistantText && Array.isArray(res.choices) && res.choices[0]?.message?.content){
            assistantText = res.choices[0].message.content;
          }
          if(!assistantText && Array.isArray(res.candidates) && res.candidates[0]?.content?.parts?.length){
            const p0 = res.candidates[0].content.parts[0];
            if(typeof p0.text === 'string') assistantText = p0.text;
          }
          // Derive used_tools when Gemini returns a tool_call
          try{
            const isGem = (payload.provider||'').toLowerCase() === 'gemini';
            if(isGem && res.type === 'tool_call' && res.name){
              const fnName = String(res.name).trim();
              // Resolve capability by llmName/id from capabilities service
              const capsSvc = window.Yuuka?.services?.capabilities;
              let cap = null;
              if(capsSvc && typeof capsSvc.listLLMCallable === 'function'){
                const all = capsSvc.listLLMCallable() || [];
                const target = fnName.toLowerCase();
                cap = all.find(c=>{
                  if(!c || !c.llmCallable) return false;
                  const n = ((c.llmName && String(c.llmName)) || String(c.id || '')).trim().toLowerCase();
                  return n === target;
                }) || null;
              }
              if(cap){
                usedTools.push({ name: fnName, id: cap.id, pluginId: cap.pluginId || '', type: (cap.type||'action').toLowerCase() });
              }else{
                usedTools.push({ name: fnName });
              }
            }
          }catch(_e){}
        }
        if(!assistantText) return;

        // Append new snapshot entry and keep message id
        snap.entries.push(assistantText);
        snap.latestIndex = snap.entries.length - 1;
        snap.activeIndex = snap.latestIndex;
        snap.followLatest = true;
        snap.lastSyncedText = assistantText;

        // Persist snapshots + active index
        const snapshotPayload = {
          id: msg.id,
          snapshots: snap.entries,
          active_index: snap.activeIndex
        };
        if(usedTools && usedTools.length){
          snapshotPayload.used_tools = usedTools;
        }
        return apiPatch('/api/plugin/maid/chat/snapshot', snapshotPayload).catch(()=>{});
      }).catch(()=>{
        snap.pending = false;
      });
    };

    const renderToolbar = (msg)=>{
      const toolbar = document.createElement('div');
      toolbar.className = 'maid-chan-chat-toolbar';
      toolbar.dataset.messageId = msg.id || '';

      const isAssistant = msg.role === 'assistant';
      const isUser = msg.role === 'user';

      let snapshotState = null;
      if(isAssistant){
        snapshotState = ensureSnapshotForMessage(msg);
      }

      if(isAssistant || isUser){
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'maid-chan-chat-btn';
        deleteBtn.dataset.action = 'delete';
        deleteBtn.title = 'Delete message';
        deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';

        // Snapshot navigation chỉ dành cho assistant, nếu có snapshot state
        if(isAssistant && snapshotState){
          const atFirst = snapshotState.activeIndex <= 0;
          const atLast = snapshotState.activeIndex >= (snapshotState.entries.length - 1);

          const prevBtn = document.createElement('button');
          prevBtn.type = 'button';
          prevBtn.className = 'maid-chan-chat-btn';
          prevBtn.dataset.action = 'snapshot-prev';
          prevBtn.title = 'Previous snapshot';
          prevBtn.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_left</span>';

          if(atFirst){
            prevBtn.disabled = true;
            prevBtn.classList.add('is-disabled');
          }

          const nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'maid-chan-chat-btn';
          nextBtn.dataset.action = 'snapshot-next';
          nextBtn.title = 'Next / regenerate snapshot';
          nextBtn.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_right</span>';

          if(atLast && !snapshotState.pending){
            // atLast nhưng vẫn cho phép click để regenerate, nên không disable hoàn toàn.
            // Nếu bạn muốn chặn luôn regen, có thể bật dòng dưới:
            // nextBtn.disabled = true; nextBtn.classList.add('is-disabled');
          }

          toolbar.appendChild(prevBtn);
          toolbar.appendChild(nextBtn);
        }

        toolbar.appendChild(deleteBtn);
      }

      return toolbar;
    };

    const renderMessage = (msg)=>{
      const item = document.createElement('div');
      item.className = 'maid-chan-chat-item';
      item.dataset.kind = msg.kind || 'chat';
      if(msg.id){
        item.dataset.messageId = msg.id;
      }

      const header = document.createElement('div');
      header.className = 'maid-chan-chat-header-row';

      const meta = document.createElement('div');
      meta.className = 'maid-chan-chat-meta';
      const metaLabel = document.createElement('span');
      const metaStatus = document.createElement('span');
      metaStatus.className = 'maid-chan-chat-meta-status';
      metaStatus.textContent = '';
      // Lấy tên Maid-chan từ localStorage (maid-chan:title) nếu có,
      // đồng thời strip ngoặc đơn/kép bao quanh nếu user lưu "Yuuka" hoặc 'Yuuka'.
      let maidTitle = 'Maid-chan';
      try{
        const storedTitle = window.localStorage.getItem('maid-chan:title');
        if(storedTitle && storedTitle.trim()){
          let t = storedTitle.trim();
          if((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))){
            t = t.slice(1, -1).trim();
          }
          maidTitle = t || 'Maid-chan';
        }
      }catch(_e){}

      const roleLabel = msg.role === 'system'
        ? '[System]'
        : (msg.role === 'assistant' ? maidTitle : 'You');
      const ts = msg.timestamp ? new Date(msg.timestamp) : new Date();
      const tsStr = ts.toLocaleTimeString();

      // Snapshot indicator (current/total) inline với meta
      let metaText = `${roleLabel} · ${tsStr}`;
      const snapForHeader = getSnapshotState(msg) || (msg.role === 'assistant' ? ensureSnapshotForMessage(msg) : null);
      if(snapForHeader && Array.isArray(snapForHeader.entries) && typeof snapForHeader.activeIndex === 'number'){
        const idx = snapForHeader.activeIndex + 1;
        const total = snapForHeader.entries.length;
        metaText += ` · ${idx}/${total}`;
      }
      metaLabel.textContent = metaText;
      meta.appendChild(metaLabel);
      meta.appendChild(metaStatus);

      const toolbar = renderToolbar(msg);

      // Tool-hint buttons (query/action) based on metadata.used_tools
      const toolButtonsWrap = document.createElement('div');
      toolButtonsWrap.className = 'maid-chan-chat-tools';
      try{
        const used = (msg.metadata && Array.isArray(msg.metadata.used_tools)) ? msg.metadata.used_tools : [];
        const queries = used.filter(t => (t.type||'').toLowerCase() === 'query');
        const actions = used.filter(t => (t.type||'').toLowerCase() !== 'query');

        const makeBtn = (label, items)=>{
          if(!items.length) return null;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'maid-chan-chat-tools-btn';
          btn.textContent = `${label} (${items.length})`;
          btn.title = `Tools used: ${items.map(i=> i.name || i.id).join(', ')}`;

          // Popover hint
          const hint = document.createElement('div');
          hint.className = 'maid-chan-chat-tools-hint';
          const list = document.createElement('ul');
          list.className = 'maid-chan-chat-tools-list';
          items.forEach(i =>{
            const li = document.createElement('li');
            const n = i.name || i.id || 'unknown';
            const p = i.pluginId ? ` · ${i.pluginId}` : '';
            li.textContent = `${n}${p}`;
            list.appendChild(li);
          });
          hint.appendChild(list);
          hint.setAttribute('hidden', '');

          const toggleHint = (ev)=>{
            ev.preventDefault(); ev.stopPropagation();
            const show = hint.hasAttribute('hidden');
            // close others in this header
            toolButtonsWrap.querySelectorAll('.maid-chan-chat-tools-hint').forEach(h=> h.setAttribute('hidden',''));
            if(show) hint.removeAttribute('hidden'); else hint.setAttribute('hidden','');
          };
          btn.addEventListener('click', toggleHint);
          document.addEventListener('click', ()=> hint.setAttribute('hidden',''), { once: true });

          const wrapper = document.createElement('span');
          wrapper.className = 'maid-chan-chat-tools-item';
          wrapper.appendChild(btn);
          wrapper.appendChild(hint);
          return wrapper;
        };

        const qBtn = makeBtn('query', queries);
        const aBtn = makeBtn('action', actions);
        if(qBtn) toolButtonsWrap.appendChild(qBtn);
        if(aBtn) toolButtonsWrap.appendChild(aBtn);
      }catch(_e){}

      header.appendChild(meta);
      if(toolButtonsWrap.childElementCount) header.appendChild(toolButtonsWrap);
      header.appendChild(toolbar);

      const body = document.createElement('div');
      body.className = 'maid-chan-chat-text';

      const snap = getSnapshotState(msg);
      const displayText = (snap && Array.isArray(snap.entries) && typeof snap.activeIndex === 'number'
        ? snap.entries[snap.activeIndex]
        : msg.text) || '';

      body.textContent = displayText;
      body.contentEditable = (msg.role === 'assistant' || msg.role === 'user') ? 'true' : 'false';
      body.spellcheck = false;

      // Auto-save on blur (edit logic)
      body.addEventListener('blur', ()=>{
        const newText = (body.textContent || '').trim();
        const target = state.messages.find(m => m.id === msg.id);
        if(!target) return;

        // Nếu là assistant có snapshot thì chỉ update snapshot hiện tại,
        // KHÔNG gọi appendMessage để tránh tạo message mới.
        const snapState = ensureSnapshotForMessage(target);
        if(snapState && Array.isArray(snapState.entries) && typeof snapState.activeIndex === 'number'){
          const oldText = (snapState.entries[snapState.activeIndex] || '').trim();
          if(newText === oldText) return;
          snapState.entries[snapState.activeIndex] = newText;
          // Đồng bộ lại msg.text để history/phần khác dùng giá trị mới nhất
          target.text = newText;
          // Lưu snapshot + selected index lên server (best-effort)
          apiPatch('/api/plugin/maid/chat/snapshot', {
            id: target.id,
            snapshots: snapState.entries,
            active_index: snapState.activeIndex
          }).catch(()=>{});
        }else{
          // User message hoặc assistant không dùng snapshot: chỉ update text tại chỗ.
          const oldText = (target.text || '').trim();
          if(newText === oldText) return;
          target.text = newText;
          // Gửi update lên backend để sửa đúng history
          apiPost('/api/plugin/maid/chat/update', {
            id: target.id,
            text: newText
          }).catch(()=>{});
        }

        // Luôn sync local cache nhưng KHÔNG append message mới lên server.
        if(MaidStorage && typeof MaidStorage.saveLocal === 'function'){
          try{ MaidStorage.saveLocal(state.messages); }catch(_e){}
        }
      });

      // Toolbar actions: delete = remove, snapshot-prev/next = navigate/regenerate
      const buttons = toolbar.querySelectorAll('.maid-chan-chat-btn[data-action]');
      buttons.forEach(btn => {
        btn.addEventListener('click', (e)=>{
          e.preventDefault();
          e.stopPropagation();
          const action = btn.dataset.action;
          const updateSnapshotDisplay = ()=>{
            const snapState = getSnapshotState(msg);
            const displayTextState = (snapState && Array.isArray(snapState.entries) && typeof snapState.activeIndex === 'number'
              ? snapState.entries[snapState.activeIndex]
              : msg.text) || '';
            body.textContent = displayTextState;

            if(snapState && typeof snapState.activeIndex === 'number'){
              const idxNow = snapState.activeIndex + 1;
              const totalNow = snapState.entries.length;
              metaLabel.textContent = `${roleLabel} · ${tsStr} · ${idxNow}/${totalNow}`;

              const prevBtn = toolbar.querySelector('.maid-chan-chat-btn[data-action="snapshot-prev"]');
              const nextBtn = toolbar.querySelector('.maid-chan-chat-btn[data-action="snapshot-next"]');
              if(prevBtn){
                const atFirst = snapState.activeIndex <= 0;
                prevBtn.disabled = atFirst;
                prevBtn.classList.toggle('is-disabled', atFirst);
              }
              if(nextBtn){
                const atLast = snapState.activeIndex >= (snapState.entries.length - 1);
                // vẫn cho phép regenerate ở cuối, nên không disable hoàn toàn khi atLast
                // nextBtn.disabled = false;
                nextBtn.classList.toggle('is-disabled', snapState.pending === true);
              }
            }
          };

          if(action === 'snapshot-prev'){
            moveSnapshotPrev(msg);
            updateSnapshotDisplay();
          }else if(action === 'delete'){
            const id = msg.id;
            if(!id) return;
            // Remove from state: message này và toàn bộ phía dưới (state.messages: oldest -> newest)
            const idx = state.messages.findIndex(m => m.id === id);
            if(idx !== -1){
              state.messages.splice(idx); // remove from idx to end
            }

            if(MaidStorage && typeof MaidStorage.saveLocal === 'function'){
              try{ MaidStorage.saveLocal(state.messages); }catch(_e){}
            }

            // Xoá khỏi UI: remove chính item + tất cả sibling phía dưới
            if(item.parentElement){
              let cursor = item.nextSibling;
              while(cursor){
                const next = cursor.nextSibling;
                item.parentElement.removeChild(cursor);
                cursor = next;
              }
              item.parentElement.removeChild(item);
            }
            // Gọi backend xoá khỏi history thật (best-effort)
            apiPost('/api/plugin/maid/chat/delete', { id }).catch(()=>{});
          }else if(action === 'snapshot-next'){
            const toolbarBtns = toolbar.querySelectorAll('.maid-chan-chat-btn');
            toolbarBtns.forEach(b => { b.disabled = true; });
            metaStatus.classList.add('is-loading');

            moveSnapshotNext(msg).finally(()=>{
              metaStatus.classList.remove('is-loading');
              toolbarBtns.forEach(b => { b.disabled = false; });
              updateSnapshotDisplay();
            });
          }
        });
      });

      item.appendChild(header);
      item.appendChild(body);

      return item;
    };

    const renderAll = ()=>{
      if(!scrollBox) return;
      scrollBox.innerHTML = '';
      state.messages.forEach(m => {
        const el = renderMessage(m);
        scrollBox.appendChild(el);
      });
      requestAnimationFrame(()=>{
        scrollBox.scrollTop = scrollBox.scrollHeight;
      });
    };

    const appendMessage = (msg)=>{
      if(!msg.id){
        msg.id = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      }
      state.messages.push(msg);
      if(scrollBox){
        const el = renderMessage(msg);
        scrollBox.appendChild(el);
        requestAnimationFrame(()=>{
          scrollBox.scrollTop = scrollBox.scrollHeight;
        });
      }
    };

    const loadHistory = async ()=>{
      state.loading = true;
      setStatus('Loading history...');
      try{
        if(MaidStorage && typeof MaidStorage.loadHistory === 'function'){
          const list = await MaidStorage.loadHistory();
          state.messages = (Array.isArray(list) ? list : []).map(it => ({
            id: it.id || null,
            role: it.role || 'user',
            text: it.text || '',
            kind: it.kind || 'chat',
            timestamp: it.timestamp || Date.now(),
            snapshots: Array.isArray(it.snapshots) ? it.snapshots : undefined,
            metadata: it.metadata || undefined
          }));
        }else{
          // Đi qua tuyến plugin chuẩn để đảm bảo kèm Authorization
          const data = await apiGet('/api/plugin/maid/chat/history');
          const list = Array.isArray(data?.items) ? data.items : [];
          state.messages = list.map(it => ({
            id: it.id || null,
            role: it.role || 'user',
            text: it.text || '',
            kind: it.kind || 'chat',
            timestamp: it.timestamp || Date.now(),
            snapshots: Array.isArray(it.snapshots) ? it.snapshots : undefined,
            metadata: it.metadata || undefined
          }));
        }
        renderAll();
        setStatus(state.messages.length ? '' : 'No messages yet.');
      }catch(e){
        console.error('[Maid-chan chat] load error', e);
        setStatus('Failed to load history.');
      }finally{
        state.loading = false;
      }
    };

    const persistMessage = async (msg)=>{
      try{
        if(MaidStorage && typeof MaidStorage.appendMessage === 'function'){
          await MaidStorage.appendMessage(msg);
        }else{
          // Tuyến plugin chuẩn
          await apiPost('/api/plugin/maid/chat/append', { message: msg });
        }
      }catch(e){
        console.warn('[Maid-chan chat] persist failed', e);
      }
    };

    const send = async ()=>{
      const raw = (input.value || '').trim();
      if(!raw || state.sending) return;
      state.sending = true;
      sendBtn.disabled = true;
      try{
        const now = Date.now();
        const msg = { role: 'user', text: raw, kind: 'chat', timestamp: now };
        input.value = '';
        appendMessage(msg);
        await persistMessage(msg);

        // Optionally ask Maid-chan via LLM core and append assistant reply
        // Lấy MaidCore dynamic tại thời điểm send để tránh vấn đề thứ tự load script
        const MaidCoreDynamic = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || MaidCore;
        if(MaidCoreDynamic && typeof MaidCoreDynamic.askMaid === 'function'){
          try{
            const history = state.messages.map(m => ({ role: m.role, content: m.text }));
            const result = await MaidCoreDynamic.askMaid(raw, { history });

            // Backend may return OpenAI-style or Gemini-style payloads.
            let assistantText = '';
            let usedTools = Array.isArray(result?.used_tools) ? result.used_tools : [];
            if(result && typeof result === 'string'){
              assistantText = result;
            }else if(result && typeof result === 'object'){
              // 1) Explicit helper fields
              assistantText = result.text || result.message || result.content || '';

              // 2) OpenAI-compatible: { choices: [ { message: { content } } ] }
              if(!assistantText && Array.isArray(result.choices) && result.choices.length){
                const choice = result.choices[0];
                if(choice && choice.message && typeof choice.message.content === 'string'){
                  assistantText = choice.message.content;
                }
              }

              // 3) Gemini-style: { candidates: [ { content: { parts: [{ text }] } } ] }
              if(!assistantText && Array.isArray(result.candidates) && result.candidates.length){
                const cand = result.candidates[0];
                const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
                if(parts.length && typeof parts[0].text === 'string'){
                  assistantText = parts[0].text;
                }
              }
            }

            if(assistantText){
              const maidMsg = { role: 'assistant', text: assistantText, kind: 'chat', timestamp: Date.now(), metadata: {} };
              if(usedTools && usedTools.length){ maidMsg.metadata.used_tools = usedTools; }
              appendMessage(maidMsg);
              await persistMessage(maidMsg);
            }
          }catch(err){
            console.warn('[Maid-chan chat] AI reply failed', err);
          }
        }
        if(window.Yuuka?.events?.emit){
          window.Yuuka.events.emit('maid-chan:chat:sent', { message: msg, namespace: NAMESPACE });
        }
      }finally{
        state.sending = false;
        sendBtn.disabled = false;
        input.focus();
      }
    };

    sendBtn.addEventListener('click', ()=> send());
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        send();
      }
    });

    // Auto-grow textarea height up to a limit (max 6 lines).
    const autoResize = ()=>{
      if(!input) return;
      // Reset to single-line height first
      input.style.height = 'auto';
      const style = window.getComputedStyle(input);
      const lineHeight = parseFloat(style.lineHeight) || 18;
      const paddingTop = parseFloat(style.paddingTop) || 0;
      const paddingBottom = parseFloat(style.paddingBottom) || 0;
      const borderTop = parseFloat(style.borderTopWidth) || 0;
      const borderBottom = parseFloat(style.borderBottomWidth) || 0;
      const base = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;
      const max = (lineHeight * 6) + paddingTop + paddingBottom + borderTop + borderBottom;
      const needed = input.scrollHeight || base;
      const h = Math.max(base, Math.min(max, needed));
      input.style.height = h + 'px';
    };
    input.addEventListener('input', autoResize);
    autoResize();

    if(promptBtn){
      promptBtn.addEventListener('click', togglePromptView);
    }

    loadHistory();

    // Public API for external modules to push new messages/events
    const api = {
      push(message){
        if(!message) return;
        const msg = {
          role: message.role || 'system',
          text: message.text || '',
          kind: message.kind || 'event',
          timestamp: message.timestamp || Date.now()
        };
        appendMessage(msg);
        persistMessage(msg);
      },
      scrollToBottom(){
        if(!scrollBox) return;
        scrollBox.scrollTop = scrollBox.scrollHeight;
      }
    };

    return api;
  }

  window.Yuuka.components.MaidChanChatPanel = {
    init(root){
      if(!root) return null;
      if(root.__maidChanChatPanel) return root.__maidChanChatPanel;
      const api = createChatUI(root);
      root.__maidChanChatPanel = api;
      return api;
    }
  };
})();
