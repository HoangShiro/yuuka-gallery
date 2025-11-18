(function(){
  // Maid-chan Chat Panel
  // Simple chat + log style UI with history persisted in data_cache via backend API.

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  const NAMESPACE = 'maid-chan:chat-panel';

  // Optional helpers from AI namespace (if loaded)
  const MaidStorage = (window.Yuuka.ai && window.Yuuka.ai.MaidStorage) || null;
  const MaidCore = (window.Yuuka.ai && window.Yuuka.ai.MaidCore) || null;
  const AILogic = (window.Yuuka.ai && window.Yuuka.ai.AILogic) || null;

  function isLogicEnabled(){
    try{
      return !!(AILogic && typeof AILogic.isEnabled === 'function' && AILogic.isEnabled());
    }catch(_e){ return false; }
  }

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
      snapshots: new Map(), // messageId -> { entries, activeIndex, latestIndex, followLatest, pending }
      loadingAssistant: null // { el, startedAt, timerId, timeoutId }
    };

    const setStatus = (txt)=>{
      if(!statusEl) return;
      statusEl.textContent = txt || '';
    };

    const togglePromptView = ()=>{
      if(!promptView) return;
      const showing = !promptView.hasAttribute('hidden');
      if(showing){
        promptView.setAttribute('hidden', 'hidden');
        if(scrollBox){
          scrollBox.style.display = '';
          scrollBox.removeAttribute('aria-hidden');
          scrollBox.removeAttribute('hidden');
        }
        return;
      }

      let inputPrompt = '';
      let toolsConfig = [];
      let llmOutput = '';
      let chatSamplesRaw = '';
      let userRequest = '';
      let llmToolOutput = '';

      try {
        chatSamplesRaw = String(window.localStorage.getItem('maid-chan:persona:chatSamples') || '').trim();
      }catch(_e){ chatSamplesRaw=''; }

      try{
        const core = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || MaidCore;
        if(core && typeof core.buildBasePrompt === 'function'){
          const base = core.buildBasePrompt({});
          inputPrompt = (typeof base === 'string') ? base : (base && base.prompt) || '';
        }
        if(core && typeof core.buildToolsFromCapabilities === 'function'){
          const tools = core.buildToolsFromCapabilities();
          if(Array.isArray(tools)) toolsConfig = tools;
        }
      }catch(_e){ /* ignore */ }

      try{
        // Find latest assistant message and its preceding user request
        let lastAssistantIndex = -1;
        for(let i = state.messages.length - 1; i >= 0; i--){
          const m = state.messages[i];
            if(m && m.role === 'assistant') { lastAssistantIndex = i; break; }
        }
        if(lastAssistantIndex !== -1){
          const m = state.messages[lastAssistantIndex];
          const s = getSnapshotState(m) || ensureSnapshotForMessage(m);
          if(s && Array.isArray(s.entries) && typeof s.activeIndex === 'number'){
            llmOutput = String(s.entries[s.activeIndex] || '');
            // tool output from snapshot part metadata
            if(m.snapshots && m.snapshots.parts){
              const idx = s.activeIndex;
              const partMeta = m.snapshots.parts[idx];
              if(partMeta && typeof partMeta.tool_results_text === 'string'){
                llmToolOutput = partMeta.tool_results_text;
              }
            }
          }else{
            llmOutput = String(m.text || '');
          }
          // Find preceding user request
          for(let j = lastAssistantIndex - 1; j >= 0; j--){
            const u = state.messages[j];
            if(u && u.role === 'user' && typeof u.text === 'string' && u.text.trim()){
              userRequest = u.text.trim();
              break;
            }
          }
        } else {
          // Fallback: last user message if no assistant yet
          for(let i = state.messages.length - 1; i >= 0; i--){
            const u = state.messages[i];
            if(u && u.role === 'user' && typeof u.text === 'string' && u.text.trim()){
              userRequest = u.text.trim();
              break;
            }
          }
        }
      }catch(_e){ /* ignore */ }

      // Build prompt items UI
      while(promptView.firstChild) promptView.removeChild(promptView.firstChild);

      function createPromptItem(key, raw){
        const wrap = document.createElement('div');
        wrap.className = 'maid-chan-prompt-item';
        wrap.dataset.key = key;
        const header = document.createElement('div');
        header.className = 'maid-chan-prompt-header';
        const title = document.createElement('span');
        title.className = 'maid-chan-prompt-title';
        title.textContent = key;
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'maid-chan-prompt-toggle';
        toggleBtn.innerHTML = '<span class="material-symbols-outlined">unfold_less</span>';
        toggleBtn.setAttribute('aria-expanded','true');
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'maid-chan-prompt-copy';
        copyBtn.title = 'Copy contents';
        copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';
        const body = document.createElement('pre');
        body.className = 'maid-chan-prompt-body';
        body.textContent = raw || '';
        const actionsWrap = document.createElement('div');
        actionsWrap.className = 'maid-chan-prompt-actions';
        actionsWrap.appendChild(copyBtn);
        actionsWrap.appendChild(toggleBtn);
        header.appendChild(title);
        header.appendChild(actionsWrap);
        wrap.appendChild(header);
        wrap.appendChild(body);
        function collapse(){
          wrap.classList.add('is-collapsed');
          body.style.display = 'none';
          toggleBtn.innerHTML = '<span class="material-symbols-outlined">unfold_more</span>';
          toggleBtn.setAttribute('aria-expanded','false');
        }
        function expand(){
          wrap.classList.remove('is-collapsed');
          body.style.display = '';
          toggleBtn.innerHTML = '<span class="material-symbols-outlined">unfold_less</span>';
          toggleBtn.setAttribute('aria-expanded','true');
        }
        toggleBtn.addEventListener('click', (e)=>{
          e.preventDefault(); e.stopPropagation();
          if(wrap.classList.contains('is-collapsed')) expand(); else collapse();
        });
        // Double-click header toggles
        header.addEventListener('dblclick', ()=>{ if(wrap.classList.contains('is-collapsed')) expand(); else collapse(); });
        copyBtn.addEventListener('click', (e)=>{
          e.preventDefault(); e.stopPropagation();
          const text = body.textContent || '';
          const attempt = async ()=>{
            try{
              if(navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
                await navigator.clipboard.writeText(text);
                copyBtn.classList.add('is-copied');
                setTimeout(()=> copyBtn.classList.remove('is-copied'), 1200);
                return true;
              }
            }catch(_e){}
            try{
              const ta = document.createElement('textarea');
              ta.value = text;
              ta.style.position = 'fixed';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
              copyBtn.classList.add('is-copied');
              setTimeout(()=> copyBtn.classList.remove('is-copied'), 1200);
              return true;
            }catch(_e2){ return false; }
          };
          attempt();
        });
        return wrap;
      }

      // Prepare text forms
      let toolsJson = '[]';
      try { toolsJson = JSON.stringify(toolsConfig || [], null, 2); }catch(_e){ toolsJson='[]'; }

      const items = [
        ['INPUT_PROMPT', inputPrompt],
        ['CHAT_SAMPLES', chatSamplesRaw],
        ['INPUT_TOOLS_CONFIG', toolsJson],
        ['USER_REQUEST', userRequest],
        ['LLM_TOOL_OUTPUT', llmToolOutput],
        ['LLM_CHAT_OUTPUT', llmOutput]
      ];

      items.forEach(([k,v])=>{
        const el = createPromptItem(k, v || '');
        promptView.appendChild(el);
      });

      // Hide chat scroll while prompt view shown
      if(scrollBox){
        scrollBox.style.display = 'none';
        scrollBox.setAttribute('aria-hidden','true');
      }
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
      if(!snap){
        const parts = (msg.snapshots && msg.snapshots.parts) ? msg.snapshots.parts : [];
        const entries = parts.map(p => String((p && p.text) || ''));
        const timestamps = parts.map(p => (p && p.timestamp) ? Number(p.timestamp) : Date.now());
        const latestIndex = Math.max(0, entries.length - 1);
        const activeIndex = (msg.snapshots && Number.isFinite(msg.snapshots.current_index))
          ? Math.max(0, Math.min(Number(msg.snapshots.current_index), latestIndex))
          : latestIndex;
        snap = {
          entries,
          timestamps,
          activeIndex,
          latestIndex,
          followLatest: activeIndex === latestIndex,
          pending: false,
          lastSyncedText: entries[latestIndex] || ''
        };
        state.snapshots.set(id, snap);
      }else{
        // Only update from msg.snapshots if it carries more parts than our local cache
        const parts = (msg.snapshots && msg.snapshots.parts) ? msg.snapshots.parts : [];
        const incomingCount = Array.isArray(parts) ? parts.length : 0;
        if(incomingCount > (Array.isArray(snap.entries) ? snap.entries.length : 0)){
          snap.entries = parts.map(p => String((p && p.text) || ''));
          snap.timestamps = parts.map(p => (p && Number.isFinite(p.timestamp)) ? Number(p.timestamp) : Date.now());
          snap.latestIndex = Math.max(0, snap.entries.length - 1);
          // Adopt server current_index if provided; otherwise keep local
          if(msg.snapshots && Number.isFinite(msg.snapshots.current_index)){
            snap.activeIndex = Math.max(0, Math.min(Number(msg.snapshots.current_index), snap.latestIndex));
          }else if(typeof snap.activeIndex !== 'number' || snap.activeIndex < 0 || snap.activeIndex > snap.latestIndex){
            snap.activeIndex = snap.latestIndex;
          }
          snap.followLatest = (snap.activeIndex === snap.latestIndex);
          snap.lastSyncedText = snap.entries[snap.latestIndex] || '';
        }
      }
      return snap;
    };

    // Helper: build parts array from current UI state while preserving existing
    // per-part properties like tool_results_text if present in msg.snapshots.
    const buildPartsPreservingMeta = (msg, snap)=>{
      const now = Date.now();
      const existingParts = (msg && msg.snapshots && Array.isArray(msg.snapshots.parts)) ? msg.snapshots.parts : [];
      const out = [];
      const count = Array.isArray(snap.entries) ? snap.entries.length : 0;
      for(let i=0;i<count;i++){
        const prev = existingParts[i] || {};
        const part = {
          text: String(snap.entries[i] || ''),
          timestamp: (snap.timestamps && Number.isFinite(snap.timestamps[i])) ? snap.timestamps[i] : (Number.isFinite(prev.timestamp) ? prev.timestamp : now)
        };
        // Prefer freshly captured tool results stored on snap.toolResultsTexts; fallback to previous part metadata
        if(Array.isArray(snap.toolResultsTexts) && typeof snap.toolResultsTexts[i] === 'string' && snap.toolResultsTexts[i].trim()){
          part.tool_results_text = snap.toolResultsTexts[i].trim();
        }else if(typeof prev.tool_results_text === 'string'){
          part.tool_results_text = prev.tool_results_text;
        }
        // Copy or update tool_info if available (parallel array snap.toolInfos)
        if(Array.isArray(snap.toolInfos) && Array.isArray(snap.toolInfos[i])){
          part.tool_info = snap.toolInfos[i].map(t=>({
            name: t && t.name,
            type: t && t.type,
            pluginId: t && t.pluginId,
            stage: t && t.stage,
            arguments_list: Array.isArray(t?.arguments_list) ? t.arguments_list.slice() : (function(v){
              if(v==null) return [];
              if(Array.isArray(v)) return v.slice();
              if(typeof v==='object') return Object.values(v);
              return [v];
            })(t && (t.arguments!==undefined ? t.arguments : t?.args)),
            result_list: Array.isArray(t?.result_list) ? t.result_list.slice() : (function(v){
              if(v==null) return [];
              if(Array.isArray(v)) return v.slice();
              if(typeof v==='object') return Object.values(v);
              return [v];
            })(t && t.result)
          })).filter(t=> t.name);
        }else if(Array.isArray(prev.tool_info)){
          part.tool_info = prev.tool_info.map(t=>({
            name: t && t.name,
            type: t && t.type,
            pluginId: t && t.pluginId,
            stage: t && t.stage,
            arguments_list: Array.isArray(t?.arguments_list) ? t.arguments_list.slice() : (function(v){
              if(v==null) return [];
              if(Array.isArray(v)) return v.slice();
              if(typeof v==='object') return Object.values(v);
              return [v];
            })(t && (t.arguments!==undefined ? t.arguments : t?.args)),
            result_list: Array.isArray(t?.result_list) ? t.result_list.slice() : (function(v){
              if(v==null) return [];
              if(Array.isArray(v)) return v.slice();
              if(typeof v==='object') return Object.values(v);
              return [v];
            })(t && t.result)
          })).filter(t=> t.name);
        }
        out.push(part);
      }
      return out;
    };

    const moveSnapshotPrev = (msg)=>{
      const snap = ensureSnapshotForMessage(msg);
      if(!snap) return;
      if(snap.activeIndex > 0){
        snap.activeIndex -= 1;
        snap.followLatest = snap.activeIndex === snap.latestIndex;
        // persist snapshots + active index (new structure)
        const parts = buildPartsPreservingMeta(msg, snap);
        const payload = {
          id: msg.id,
          snapshots: { parts, current_index: snap.activeIndex }
        };
        // Reflect on message object to keep UI in sync without reload
        msg.snapshots = payload.snapshots;
        apiPatch('/api/plugin/maid/chat/snapshot', payload).catch(()=>{});
      }
    };

    const moveSnapshotNext = (msg)=>{
      const snap = ensureSnapshotForMessage(msg);
      if(!snap) return Promise.resolve();
      if(snap.activeIndex < snap.entries.length - 1){
        snap.activeIndex += 1;
        snap.followLatest = snap.activeIndex === snap.latestIndex;
        const parts = buildPartsPreservingMeta(msg, snap);
        const payload = {
          id: msg.id,
          snapshots: { parts, current_index: snap.activeIndex }
        };
        msg.snapshots = payload.snapshots;
        return apiPatch('/api/plugin/maid/chat/snapshot', payload).catch(()=>{});
      }
      if(snap.pending) return Promise.resolve();

      // At latest snapshot: trigger regeneration via backend (similar to chat plugin)
      snap.pending = true;

      // Build conversation for snapshot regeneration by rewinding to just BEFORE this assistant message.
      // Use only prior history so we regenerate this message as a fresh reply to the last user.
      const msgIndex = state.messages.findIndex(m => m.id === msg.id);
      const priorMessages = msgIndex > 0 ? state.messages.slice(0, msgIndex) : [];
      const historyForApi = priorMessages.map(m => {
        if(m.role === 'assistant'){
          const s = getSnapshotState(m) || ensureSnapshotForMessage(m);
          if(s && Array.isArray(s.entries) && typeof s.activeIndex === 'number'){
            const idx = s.activeIndex;
            const partText = s.entries[idx] || '';
            let toolText = '';
            if(m.snapshots && m.snapshots.parts && m.snapshots.parts[idx] && typeof m.snapshots.parts[idx].tool_results_text === 'string'){
              toolText = m.snapshots.parts[idx].tool_results_text;
            }
            return { role: 'assistant', content: toolText ? (partText + '\n\n' + toolText) : partText };
          }
          return { role: 'assistant', content: '' };
        }
        return { role: m.role, content: m.text || '' };
      });
      // Find the last user request from the prior messages
      const lastUserText = (() => {
        for(let i = priorMessages.length - 1; i >= 0; i--){
          const m = priorMessages[i];
          if(m && m.role === 'user' && typeof m.text === 'string' && m.text.trim()){
            return m.text.trim();
          }
        }
        return '';
      })();
      // Add a system directive to steer a two-stage regen with tool-on-first when needed
      historyForApi.push({
        role: 'system',
        content: 'Regeneration: Provide a concise alternative answer to the last user request using the same context. If the request involves album or image actions, call the appropriate tool (e.g., open_album) in your first response. A subsequent response will be required without calling tools.'
      });

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

      // Prefer AILogic when enabled; suppress persistence because regen should append snapshot to existing message id
      const MaidCoreDynamic = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || MaidCore;
      const logicOn = isLogicEnabled();
      const callPromise = (logicOn && AILogic && typeof AILogic.execute === 'function')
        ? AILogic.execute({ text: lastUserText || 'Please continue.', history: historyForApi, suppressPersistence: true })
        : ((MaidCoreDynamic && typeof MaidCoreDynamic.askMaid === 'function')
            ? MaidCoreDynamic.askMaid(lastUserText || 'Please continue.', { history: historyForApi, maxStages: 2, forceDisableAfterFirst: true })
            : apiPost('/api/plugin/maid/chat', payload));

      return Promise.resolve(callPromise).then(res => {
        snap.pending = false;
        if(!res) return;
        let assistantText = '';
        let usedTools = [];
        // Default tool results text placeholder for alignment
        let regenToolResultsText = '';
        const out = (res && res.response) ? res.response : res;
        if(typeof out === 'string') assistantText = out;
        else if(out && typeof out === 'object'){
          assistantText = out.text || out.message || out.content || '';
          if(!assistantText && Array.isArray(out.choices) && out.choices[0]?.message?.content){
            assistantText = out.choices[0].message.content;
          }
          if(!assistantText && Array.isArray(out.candidates) && out.candidates[0]?.content?.parts?.length){
            const p0 = out.candidates[0].content.parts[0];
            if(typeof p0.text === 'string') assistantText = p0.text;
          }
          if(Array.isArray(out.used_tools)) usedTools = out.used_tools;
          // Capture tool_results_text from LLM response (multi-stage Gemini orchestration)
          regenToolResultsText = (typeof out.tool_results_text === 'string' && out.tool_results_text.trim()) ? out.tool_results_text.trim() : '';
          // Derive used_tools when Gemini returns a tool_call
          try{
            const isGem = (payload.provider||'').toLowerCase() === 'gemini';
            if(isGem && out.type === 'tool_call' && out.name){
              const fnName = String(out.name).trim();
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
        const assistantTrim = (assistantText || '').trim();
        if(!assistantTrim) return;

        // Append new snapshot entry and keep message id
        snap.entries.push(assistantTrim);
        if(Array.isArray(snap.timestamps)) snap.timestamps.push(Date.now());
        if(!Array.isArray(snap.usedTools)) snap.usedTools = [];
        snap.usedTools.push(usedTools && usedTools.length ? usedTools : undefined);
        snap.latestIndex = snap.entries.length - 1;
        snap.activeIndex = snap.latestIndex;
        snap.followLatest = true;
        snap.lastSyncedText = assistantTrim;

        // Align tool results text & tool info with the newly added snapshot entry index
        if(!Array.isArray(snap.toolResultsTexts)) snap.toolResultsTexts = [];
        // Ensure array has placeholders up to previous last index
        while(snap.toolResultsTexts.length < (snap.entries.length - 1)) snap.toolResultsTexts.push(undefined);
        const newIdx = snap.entries.length - 1;
        snap.toolResultsTexts[newIdx] = regenToolResultsText && regenToolResultsText.trim() ? regenToolResultsText.trim() : undefined;
        // Capture tool info list (prefer res.tool_contents; fallback to usedTools list)
        if(!Array.isArray(snap.toolInfos)) snap.toolInfos = [];
        while(snap.toolInfos.length < (snap.entries.length - 1)) snap.toolInfos.push(undefined);
        const toolInfoRaw = Array.isArray(res?.tool_contents) ? res.tool_contents : (Array.isArray(usedTools) ? usedTools : []);
        const simplified = toolInfoRaw.filter(Boolean).map(t=>({
          name: t.name || t.id,
          type: (t.type||'').toLowerCase(),
          pluginId: t.pluginId || '',
          stage: t.stage,
          arguments_list: Array.isArray(t?.arguments_list) ? t.arguments_list.slice() : (function(v){
            const src = (v!==undefined ? v : (t.arguments!==undefined ? t.arguments : t.args));
            if(src==null) return [];
            if(Array.isArray(src)) return src.slice();
            if(typeof src==='object') return Object.values(src);
            return [src];
          })(t.arguments_list),
          result_list: Array.isArray(t?.result_list) ? t.result_list.slice() : (function(v){
            const src = (v!==undefined ? v : t.result);
            if(src==null) return [];
            if(Array.isArray(src)) return src.slice();
            if(typeof src==='object') return Object.values(src);
            return [src];
          })(t.result_list)
        })).filter(t=> t.name);
        snap.toolInfos[newIdx] = simplified.length ? simplified : undefined;

        // Persist snapshots + active index (new structure)
        const parts = buildPartsPreservingMeta(msg, snap);
        const payload = {
          id: msg.id,
          snapshots: { parts, current_index: snap.activeIndex }
        };
        msg.snapshots = payload.snapshots;
        return apiPatch('/api/plugin/maid/chat/snapshot', payload).catch(()=>{});
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

        // Replay button for user messages: rollback to this message and resend it without creating a new user entry
        if(isUser){
          const replayBtn = document.createElement('button');
          replayBtn.type = 'button';
          replayBtn.className = 'maid-chan-chat-btn';
          replayBtn.dataset.action = 'replay';
          replayBtn.title = 'Replay this message';
          replayBtn.innerHTML = '<span class="material-symbols-outlined">replay</span>';
          toolbar.appendChild(replayBtn);
        }

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
      // timestamp: for assistant, prefer active snapshot part timestamp; else msg.timestamp
      let tsMs = msg.timestamp || Date.now();
      if(msg.role === 'assistant'){
        const s = getSnapshotState(msg) || ensureSnapshotForMessage(msg);
        if(s && Array.isArray(s.timestamps) && typeof s.activeIndex === 'number'){
          const partTs = s.timestamps[s.activeIndex];
          if(Number.isFinite(partTs)) tsMs = partTs;
        }else if(msg.snapshots && msg.snapshots.parts && msg.snapshots.parts.length){
          const idx = Math.max(0, Math.min(Number(msg.snapshots.current_index||0), msg.snapshots.parts.length-1));
          const partTs = Number(msg.snapshots.parts[idx]?.timestamp);
          if(Number.isFinite(partTs)) tsMs = partTs;
        }
      }
      const ts = new Date(tsMs);
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

      // Tool-hint buttons: derive from message-level tool_contents OR active snapshot tool_info OR tool_results_text
      const toolButtonsWrap = document.createElement('div');
      toolButtonsWrap.className = 'maid-chan-chat-tools';

      const buildToolButtons = ()=>{
        while(toolButtonsWrap.firstChild) toolButtonsWrap.removeChild(toolButtonsWrap.firstChild);
        let queries = [];
        let actions = [];
        // Prefer structured msg.tool_contents if present
        const used = Array.isArray(msg.tool_contents) ? msg.tool_contents : [];
        if(used.length){
          queries = used.filter(t => (t.type||'').toLowerCase() === 'query');
          actions = used.filter(t => (t.type||'').toLowerCase() !== 'query');
        } else if(msg.role === 'assistant'){ // Fallback: parse active snapshot part tool_results_text
          const snapState = getSnapshotState(msg) || ensureSnapshotForMessage(msg);
          if(snapState && Array.isArray(snapState.entries) && typeof snapState.activeIndex === 'number'){
            const idx = snapState.activeIndex;
            // Attempt to read tool_results_text from original message snapshots structure
            const partMeta = msg.snapshots && msg.snapshots.parts && msg.snapshots.parts[idx];
            // Prefer structured tool_info first
            const toolInfoArr = Array.isArray(partMeta?.tool_info) ? partMeta.tool_info : [];
            if(toolInfoArr.length){
              queries = toolInfoArr.filter(t=> (t.type||'').toLowerCase() === 'query');
              actions = toolInfoArr.filter(t=> (t.type||'').toLowerCase() !== 'query');
            }
            const toolText = (!queries.length && !actions.length && partMeta && typeof partMeta.tool_results_text === 'string') ? partMeta.tool_results_text : '';
            if(toolText && toolText.includes('[TOOL RESULTS')){
              // Parse lines starting with '- ' capturing name and type marker [action]/[query]
              const lines = toolText.split(/\r?\n/);
              for(const line of lines){
                if(!/^\s*-\s+/.test(line)) continue;
                // Extract name and type from pattern like: - open_album · album [action]
                const m = /^\s*-\s+([^\[]+?)\s*(?:\[[^\]]+\])?\s*(?:\[(action|query)\])?/i.exec(line);
                // Fallback: search explicit [action]/[query]
                const typeMatch = /(\[(action|query)\])/i.exec(line);
                const type = (typeMatch && typeMatch[2]) ? typeMatch[2].toLowerCase() : (m && m[2] ? m[2].toLowerCase() : '');
                const nameRaw = (m && m[1]) ? m[1].trim() : 'unknown';
                const name = nameRaw.split('·')[0].trim();
                if(type === 'query') queries.push({ name }); else actions.push({ name });
              }
            }
          }
        }

        const makeBtn = (label, items)=>{
          if(!items.length) return null;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'maid-chan-chat-tools-btn';
          btn.textContent = `${label} (${items.length})`;
          btn.title = `Tools used: ${items.map(i=> i.name || i.id).join(', ')}`;

          const hint = document.createElement('div');
          hint.className = 'maid-chan-chat-tools-hint';
          const list = document.createElement('ul');
          list.className = 'maid-chan-chat-tools-list';
          items.forEach(i =>{
            const li = document.createElement('li');
            const n = i.name || i.id || 'unknown';
            const type = (i.type||'').toLowerCase();
            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined maid-chan-tool-icon';
            iconSpan.textContent = type === 'query' ? 'search' : (type === 'action' ? 'bolt' : 'extension');
            const nameSpan = document.createElement('span');
            nameSpan.className = 'maid-chan-tool-name';
            nameSpan.textContent = n;
            const headWrap = document.createElement('div');
            headWrap.className = 'maid-chan-tool-line-head';
            headWrap.appendChild(iconSpan);
            headWrap.appendChild(nameSpan);
            li.appendChild(headWrap);
            const argsList = Array.isArray(i?.arguments_list) ? i.arguments_list : (i.arguments!=null ? (Array.isArray(i.arguments)? i.arguments : (typeof i.arguments==='object'? Object.values(i.arguments): [i.arguments])) : []);
            const resList = Array.isArray(i?.result_list) ? i.result_list : (i.result!=null ? (Array.isArray(i.result)? i.result : (typeof i.result==='object'? Object.values(i.result): [i.result])) : []);
            const argsStr = argsList.length ? (()=>{ try{ return JSON.stringify(argsList, null, 2);}catch(_e){ return String(argsList); } })() : '';
            const resStr = resList.length ? (()=>{ try{ return JSON.stringify(resList, null, 2);}catch(_e){ return String(resList); } })() : '';
            if(argsStr || resStr){
              const toggle = document.createElement('button');
              toggle.type = 'button';
              toggle.className = 'maid-chan-tool-toggle';
              toggle.innerHTML = '<span class="material-symbols-outlined">data_object</span>';
              toggle.title = 'Show tool details';
              headWrap.appendChild(toggle);
              const details = document.createElement('div');
              details.className = 'maid-chan-tool-details';
              if(argsStr){ const preA = document.createElement('pre'); preA.className='maid-chan-tool-args'; preA.textContent=argsStr; details.appendChild(preA); }
              if(resStr){ const preR = document.createElement('pre'); preR.className='maid-chan-tool-result'; preR.textContent=resStr; details.appendChild(preR); }
              details.setAttribute('hidden','');
              toggle.addEventListener('click', ev=>{ ev.preventDefault(); ev.stopPropagation(); const show = details.hasAttribute('hidden'); if(show) details.removeAttribute('hidden'); else details.setAttribute('hidden',''); });
              li.appendChild(details);
            }
            list.appendChild(li);
          });
          hint.appendChild(list);
          hint.setAttribute('hidden', '');
          const toggleHint = (ev)=>{
            ev.preventDefault(); ev.stopPropagation();
            const show = hint.hasAttribute('hidden');
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
      };

      try{ buildToolButtons(); }catch(_e){}

      header.appendChild(meta);
      if(toolButtonsWrap.childElementCount) header.appendChild(toolButtonsWrap);
      header.appendChild(toolbar);

      const body = document.createElement('div');
      body.className = 'maid-chan-chat-text';

      const snap = getSnapshotState(msg);
      const displayText = (snap && Array.isArray(snap.entries) && typeof snap.activeIndex === 'number'
        ? snap.entries[snap.activeIndex]
        : (msg.text || '')) || '';

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
          // Persist snapshots in new structure
          const parts = buildPartsPreservingMeta(target, snapState);
          const payload = { id: target.id, snapshots: { parts, current_index: snapState.activeIndex } };
          apiPatch('/api/plugin/maid/chat/snapshot', payload).catch(()=>{});
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
              // Rebuild tool buttons for new active snapshot if no structured tool_contents present
              try{ if(!Array.isArray(msg.tool_contents) || !msg.tool_contents.length){ buildToolButtons(); } }catch(_e){}
            }
          };

          if(action === 'snapshot-prev'){
            moveSnapshotPrev(msg);
            updateSnapshotDisplay();
          }else if(action === 'replay'){
            // Only for user messages: rollback conversation to this message and resend it to LLM
            if(msg.role !== 'user') return;
            const id = msg.id;
            // Capture the current displayed text (may include unsaved edits)
            const replayText = (body.textContent || msg.text || '').trim();
            if(!replayText){ return; }

            // Disable toolbar while processing
            const toolbarBtns = toolbar.querySelectorAll('.maid-chan-chat-btn');
            toolbarBtns.forEach(b => { b.disabled = true; });
            metaStatus.classList.add('is-loading');
            setStatus('Replaying...');

            // Compute index and prior history BEFORE removing from UI
            const idx = state.messages.findIndex(m => m.id === id);
            const priorMessages = idx > 0 ? state.messages.slice(0, idx) : [];
            const nextMsg = (idx !== -1 && (idx + 1) < state.messages.length) ? state.messages[idx + 1] : null;

            // Rollback locally (same behavior as delete) and best-effort persist
            if(idx !== -1){ state.messages.splice(idx + 1); }
            if(MaidStorage && typeof MaidStorage.saveLocal === 'function'){
              try{ MaidStorage.saveLocal(state.messages); }catch(_e){}
            }
            if(item.parentElement){
              let cursor = item.nextSibling;
              while(cursor){ const next = cursor.nextSibling; item.parentElement.removeChild(cursor); cursor = next; }
              // keep current item; do not remove it for rollback-to-this-message behavior
            }
            // Notify backend to truncate history after this message: delete starting from the next message if it exists
            if(nextMsg && nextMsg.id){
              apiPost('/api/plugin/maid/chat/delete', { id: nextMsg.id }).catch(()=>{});
            }

            // Build LLM history mapping (mirror send() conversion honoring assistant snapshots/tools)
            const history = priorMessages.map(m => {
              if(m.role === 'assistant'){
                const s = getSnapshotState(m) || ensureSnapshotForMessage(m);
                if(s && Array.isArray(s.entries) && typeof s.activeIndex === 'number'){
                  const i = s.activeIndex;
                  const partText = s.entries[i] || '';
                  let toolText = '';
                  if(m.snapshots && m.snapshots.parts && m.snapshots.parts[i] && typeof m.snapshots.parts[i].tool_results_text === 'string'){
                    toolText = m.snapshots.parts[i].tool_results_text;
                  }
                  return { role: 'assistant', content: toolText ? (partText + '\n\n' + toolText) : partText };
                }
                return { role: 'assistant', content: '' };
              }
              return { role: m.role, content: m.text || '' };
            });

            // Ask Maid without creating new user message in UI or backend
            const MaidCoreDynamic = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || MaidCore;
            const doReplay = async ()=>{
              try{
                const result = (MaidCoreDynamic && typeof MaidCoreDynamic.askMaid === 'function')
                  ? await MaidCoreDynamic.askMaid(replayText, { history })
                  : null;

                let assistantText = '';
                const toolResultsText = (result && typeof result === 'object' && typeof result.tool_results_text === 'string') ? result.tool_results_text.trim() : '';
                const toolContents = (result && typeof result === 'object' && Array.isArray(result.tool_contents)) ? result.tool_contents : [];
                if(result && typeof result === 'string'){
                  assistantText = result;
                }else if(result && typeof result === 'object'){
                  assistantText = result.text || result.message || result.content || '';
                  if(!assistantText && Array.isArray(result.choices) && result.choices.length){
                    const choice = result.choices[0];
                    if(choice?.message?.content) assistantText = choice.message.content;
                  }
                  if(!assistantText && Array.isArray(result.candidates) && result.candidates.length){
                    const cand = result.candidates[0];
                    const parts = cand?.content?.parts || [];
                    if(parts.length && typeof parts[0].text === 'string') assistantText = parts[0].text;
                  }
                }

                if(assistantText){
                  const part = { text: assistantText, timestamp: Date.now() };
                  if(toolResultsText) part.tool_results_text = toolResultsText;
                  if(toolContents && toolContents.length){
                    part.tool_info = toolContents.map(c=>({
                      name: c.name || c.id,
                      type: (c.type||'').toLowerCase(),
                      pluginId: c.pluginId || '',
                      stage: c.stage,
                      arguments_list: Array.isArray(c?.arguments_list) ? c.arguments_list.slice() : (function(v){
                        const src = (v!==undefined ? v : (c.arguments!==undefined ? c.arguments : c.args));
                        if(src==null) return [];
                        if(Array.isArray(src)) return src.slice();
                        if(typeof src==='object') return Object.values(src);
                        return [src];
                      })(c.arguments_list),
                      result_list: Array.isArray(c?.result_list) ? c.result_list.slice() : (function(v){
                        const src = (v!==undefined ? v : c.result);
                        if(src==null) return [];
                        if(Array.isArray(src)) return src.slice();
                        if(typeof src==='object') return Object.values(src);
                        return [src];
                      })(c.result_list)
                    })).filter(t=> t.name);
                  }
                  const maidMsg = { role: 'assistant', kind: 'chat', snapshots: { parts: [part], current_index: 0 } };
                  if(toolContents && toolContents.length){ maidMsg.tool_contents = toolContents; }
                  appendMessage(maidMsg);
                  await persistMessage(maidMsg);
                }
              }catch(err){
                console.warn('[Maid-chan chat] Replay failed', err);
              }finally{
                metaStatus.classList.remove('is-loading');
                toolbarBtns.forEach(b => { b.disabled = false; });
                setStatus('');
              }
            };
            doReplay();
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

    const removeLoadingPlaceholder = ()=>{
      const la = state.loadingAssistant;
      if(!la) return;
      if(la.timerId) clearInterval(la.timerId);
      if(la.timeoutId) clearTimeout(la.timeoutId);
      if(la.el && la.el.parentElement){ la.el.parentElement.removeChild(la.el); }
      state.loadingAssistant = null;
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
          state.messages = Array.isArray(list) ? list.map(it => ({
            id: it.id || null,
            role: it.role || 'user',
            // For assistant, timestamp is taken from active part; keep top-level only for user/system
            text: it.role === 'assistant' ? undefined : (it.text || ''),
            kind: it.kind || 'chat',
            timestamp: it.role === 'assistant' ? undefined : (it.timestamp || Date.now()),
            snapshots: (it.role === 'assistant' && it.snapshots && it.snapshots.parts) ? it.snapshots : undefined,
            tool_contents: Array.isArray(it.tool_contents) ? it.tool_contents : undefined
          })) : [];
        }else{
          // Đi qua tuyến plugin chuẩn để đảm bảo kèm Authorization
          const data = await apiGet('/api/plugin/maid/chat/history');
          const list = Array.isArray(data?.items) ? data.items : [];
          state.messages = list.map(it => ({
            id: it.id || null,
            role: it.role || 'user',
            text: it.role === 'assistant' ? undefined : (it.text || ''),
            kind: it.kind || 'chat',
            timestamp: it.role === 'assistant' ? undefined : (it.timestamp || Date.now()),
            snapshots: (it.role === 'assistant' && it.snapshots && it.snapshots.parts) ? it.snapshots : undefined,
            tool_contents: Array.isArray(it.tool_contents) ? it.tool_contents : undefined
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
        // When AI Logic is enabled, let the logic pipeline (graph) handle persistence via "Save history" node.
        if(isLogicEnabled()){
          return; // skip legacy persistence to avoid duplicates
        }
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
        // In logic mode, persistence is managed by graph (Save history). Skip legacy save.
        await persistMessage(msg);

        // Optionally ask Maid-chan via LLM core and append assistant reply
        // Lấy MaidCore dynamic tại thời điểm send để tránh vấn đề thứ tự load script
        const MaidCoreDynamic = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore) || MaidCore;
        const logicOn = isLogicEnabled();
        if(logicOn || (MaidCoreDynamic && typeof MaidCoreDynamic.askMaid === 'function')){
          try{
            // Build history strictly using snapshots for assistant
            // If logic is enabled, exclude the just-appended user message from history, since we pass `text` separately.
            const sourceMessages = logicOn ? state.messages.slice(0, Math.max(0, state.messages.length - 1)) : state.messages;
            const history = sourceMessages.map(m => {
              if(m.role === 'assistant'){
                const s = getSnapshotState(m) || ensureSnapshotForMessage(m);
                if(s && Array.isArray(s.entries) && typeof s.activeIndex === 'number'){
                  const idx = s.activeIndex;
                  const partText = s.entries[idx] || '';
                  // Append tool_results_text if available in msg.snapshots.parts
                  let toolText = '';
                  if(m.snapshots && m.snapshots.parts && m.snapshots.parts[idx] && typeof m.snapshots.parts[idx].tool_results_text === 'string'){
                    toolText = m.snapshots.parts[idx].tool_results_text;
                  }
                  return { role: 'assistant', content: toolText ? (partText + '\n\n' + toolText) : partText };
                }
                return { role: 'assistant', content: '' };
              }
              return { role: m.role, content: m.text || '' };
            });
            // create loading placeholder
            removeLoadingPlaceholder();
            let placeholderEl = null;
            let timerEl = null;
            if(scrollBox){
              placeholderEl = document.createElement('div');
              placeholderEl.className = 'maid-chan-chat-placeholder';
              timerEl = document.createElement('span');
              timerEl.className = 'maid-chan-chat-placeholder-timer';
              timerEl.textContent = '0s';
              placeholderEl.appendChild(timerEl);
              scrollBox.appendChild(placeholderEl);
              requestAnimationFrame(()=>{
                scrollBox.scrollTop = scrollBox.scrollHeight;
              });
            }

            const startedAt = Date.now();
            let secs = 0;
            const timerId = window.setInterval(()=>{
              secs = Math.floor((Date.now() - startedAt) / 1000);
              if(timerEl) timerEl.textContent = secs + 's';
            }, 1000);

            const timeoutId = window.setTimeout(()=>{
              removeLoadingPlaceholder();
              const maidTitle = (function(){
                let t = 'Maid-chan';
                try{
                  const storedTitle = window.localStorage.getItem('maid-chan:title');
                  if(storedTitle && storedTitle.trim()){
                    let s = storedTitle.trim();
                    if((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))){
                      s = s.slice(1, -1).trim();
                    }
                    if(s) t = s;
                  }
                }catch(_e){}
                return t;
              })();
              const timeoutMsg = {
                role: 'assistant',
                kind: 'chat',
                snapshots: { parts: [{ text: maidTitle + ' hiện đang bận, hãy chat lại sau.', timestamp: Date.now() }], current_index: 0 }
              };
              appendMessage(timeoutMsg);
            }, 30000);

            state.loadingAssistant = {
              el: placeholderEl,
              timerEl,
              startedAt,
              timerId,
              timeoutId
            };
            let result = null;
            if(logicOn && AILogic && typeof AILogic.execute === 'function'){
              // Pre-generate assistant message id so AILogic can persist using the same id
              const assistantId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
              const r = await AILogic.execute({ text: raw, history, userMessageId: msg.id, assistantMessageId: assistantId });
              // AILogic returns { __maidLogicHandled, response }
              result = (r && (r.response || r)) || null;
              // Attach the predetermined id to be used by UI append
              if(result && typeof result === 'object'){
                result._maid_assistant_id = assistantId;
              }
            } else {
              result = await MaidCoreDynamic.askMaid(raw, { history });
            }

            // if we got result before timeout, clear placeholder & timers
            const la = state.loadingAssistant;
            if(la){
              if(la.timerId) clearInterval(la.timerId);
              if(la.timeoutId) clearTimeout(la.timeoutId);
              if(la.el && la.el.parentElement){ la.el.parentElement.removeChild(la.el); }
              state.loadingAssistant = null;
            }

            // Backend may return OpenAI-style or Gemini-style payloads.
            let assistantText = '';
            let usedTools = Array.isArray(result?.used_tools) ? result.used_tools : [];
            const toolResultsText = (result && typeof result === 'object' && typeof result.tool_results_text === 'string') ? result.tool_results_text.trim() : '';
            const toolContents = (result && typeof result === 'object' && Array.isArray(result.tool_contents)) ? result.tool_contents : [];
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
              const part = { text: assistantText, timestamp: Date.now() };
              if(toolResultsText) part.tool_results_text = toolResultsText;
              if(Array.isArray(toolContents) && toolContents.length){
                part.tool_info = toolContents.map(c=>({
                  name: c.name || c.id,
                  type: (c.type||'').toLowerCase(),
                  pluginId: c.pluginId || '',
                  stage: c.stage,
                  arguments_list: Array.isArray(c?.arguments_list) ? c.arguments_list.slice() : (function(v){
                    const src = (v!==undefined ? v : (c.arguments!==undefined ? c.arguments : c.args));
                    if(src==null) return [];
                    if(Array.isArray(src)) return src.slice();
                    if(typeof src==='object') return Object.values(src);
                    return [src];
                  })(c.arguments_list),
                  result_list: Array.isArray(c?.result_list) ? c.result_list.slice() : (function(v){
                    const src = (v!==undefined ? v : c.result);
                    if(src==null) return [];
                    if(Array.isArray(src)) return src.slice();
                    if(typeof src==='object') return Object.values(src);
                    return [src];
                  })(c.result_list)
                })).filter(t=> t.name);
              }
              const predefinedId = (result && typeof result === 'object' && result._maid_assistant_id) ? result._maid_assistant_id : undefined;
              const maidMsg = { id: predefinedId, role: 'assistant', kind: 'chat', snapshots: { parts: [part], current_index: 0 } };
              if(toolContents && toolContents.length){ maidMsg.tool_contents = toolContents; }
              appendMessage(maidMsg);
              // In logic mode, persistence is handled by graph. Skip legacy save.
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
        // Support pushing assistant with snapshots/tool info from AI Logic UI
        if(message.snapshots && message.snapshots.parts){ msg.snapshots = message.snapshots; }
        if(Array.isArray(message.tool_contents)){ msg.tool_contents = message.tool_contents; }
        appendMessage(msg);
        // When logic mode is enabled, do not persist pushes; assume logic handled it.
        if(!isLogicEnabled()) persistMessage(msg);
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
