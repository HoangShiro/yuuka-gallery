(function(){
  // Maid-chan AI Logic Manager
  // Provides an optional, configurable routing layer between ai_core and the UI.
  // Default remains legacy routing; this module activates only when its feature is enabled.

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.ai = window.Yuuka.ai || {};

  const GRAPH_KEY = 'maid-chan:logic:graph';
  const FEATURE_TOGGLE_KEY = 'maid-chan:feature:logic_ui:enabled';
  const LEGACY_ENABLE_KEY = 'maid-chan:logic:enabled'; // optional override if feature system unavailable

  function parseBool(v){
    if(v === true) return true;
    if(v === false) return false;
    if(v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
  }

  function isEnabled(){
    try{
      const raw = window.localStorage.getItem(FEATURE_TOGGLE_KEY);
      if(raw != null){
        try{ return !!JSON.parse(raw); }catch(_e){ return parseBool(raw); }
      }
      // Fallback to legacy override key
      const legacy = window.localStorage.getItem(LEGACY_ENABLE_KEY);
      return parseBool(legacy);
    }catch(_e){ return false; }
  }

  function loadGraph(){
    try{
      const raw = window.localStorage.getItem(GRAPH_KEY);
      if(!raw) return { nodes: [], edges: [] };
      const g = JSON.parse(raw);
      if(!g || typeof g !== 'object') return { nodes: [], edges: [] };
      if(!Array.isArray(g.nodes)) g.nodes = [];
      if(!Array.isArray(g.edges)) g.edges = [];
      return g;
    }catch(_e){ return { nodes: [], edges: [] }; }
  }

  function saveGraph(graph){
    try{
      const g = graph && typeof graph === 'object' ? graph : { nodes: [], edges: [] };
      window.localStorage.setItem(GRAPH_KEY, JSON.stringify(g));
    }catch(_e){ /* ignore */ }
  }

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

  // Backend chat history helpers
  let __historyItemsCache = null;
  async function fetchHistoryItems(){
    // Prefer plugin API client with auth
    try{
      const pluginApi = getPluginApi();
      if(pluginApi && typeof pluginApi.get === 'function'){
        const res = await pluginApi.get('/chat/history');
        const items = Array.isArray(res?.items) ? res.items : [];
        return items;
      }
    }catch(_e){}
    try{
      const res = await fetch('/api/plugin/maid/chat/history', { credentials: 'include' });
      if(!res.ok) throw new Error('http '+res.status);
      const data = await res.json();
      return Array.isArray(data?.items) ? data.items : [];
    }catch(_e){ return []; }
  }
  function historyItemsToMessages(items){
    const out = [];
    for(const it of (items||[])){
      if(!it || typeof it !== 'object') continue;
      if(it.role === 'assistant'){
        const snaps = it.snapshots || {};
        const parts = Array.isArray(snaps.parts) ? snaps.parts : [];
        const idx = Math.max(0, Math.min((snaps.current_index|0), Math.max(0, parts.length-1)));
        const part = parts[idx] || {};
        out.push({ role:'assistant', content: String(part.text || '') });
      }else if(it.role === 'user'){
        out.push({ role:'user', content: String(it.text || '') });
      }
    }
    return out;
  }

  function toLLMMessages(history){
    if(!Array.isArray(history)) return [];
    const out = [];
    for(const h of history){
      if(!h) continue;
      if(typeof h === 'string'){
        out.push({ role: 'user', content: h });
      }else if(h.role && h.content != null){
        out.push({ role: String(h.role), content: String(h.content) });
      }
    }
    return out;
  }

  async function persistHistoryMessage(msg){
    // Normalize to backend schema
    const now = Date.now();
    let messagePayload;
    try{
      if(!msg || typeof msg !== 'object'){
        // Treat as plain user text if string
        const text = typeof msg === 'string' ? msg : '';
        messagePayload = { role: 'user', text, kind: 'chat', timestamp: now };
      }else{
        const role = String(msg.role || 'user').toLowerCase();
        if(role === 'assistant'){
          const content = String(msg.content || msg.text || '');
          const part = {
            text: content,
            timestamp: now
          };
          // Optional tool metadata
          if(typeof msg.tool_results_text === 'string'){
            part.tool_results_text = msg.tool_results_text;
          }
          if(Array.isArray(msg.tool_info)){
            part.tool_info = msg.tool_info;
          }
          messagePayload = {
            id: msg.id,
            role: 'assistant',
            kind: msg.kind || 'chat',
            snapshots: { parts: [part], current_index: 0 }
          };
          if(Array.isArray(msg.tool_contents)){
            messagePayload.tool_contents = msg.tool_contents;
          }
        }else{
          const text = String(msg.content || msg.text || '');
          messagePayload = {
            id: msg.id,
            role: role,
            text,
            kind: msg.kind || 'chat',
            timestamp: Number.isFinite(msg.timestamp) ? msg.timestamp : now
          };
        }
      }

      const pluginApi = getPluginApi();
      const payload = { message: messagePayload };
      if(pluginApi && typeof pluginApi.post === 'function'){
        await pluginApi.post('/chat/append', payload);
        return;
      }
      // Fallback fetch
      await fetch('/api/plugin/maid/chat/append', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload)
      });
    }catch(_e){ /* ignore persistence failures */ }
  }

  function getNodeByType(graph, type){
    if(!graph || !Array.isArray(graph.nodes)) return null;
    return graph.nodes.find(n => n && n.type === type) || null;
  }

  function getOutputTargets(graph){
    if(!graph || !Array.isArray(graph.nodes)) return [];
    return graph.nodes.filter(n => n && (n.type === 'Save history' || n.type === 'Send to chat UI' || n.type === 'Send to chat bubble' || n.type === 'Preview' || n.type === 'Tools execution'));
  }

  // Build stage mapping for LLM nodes only
  function computeLLMStages(graph){
    const nodes = (graph && graph.nodes)||[];
    const edges = (graph && graph.edges)||[];
    const llms = nodes.filter(n=> n && n.type === 'LLM');
    const idSet = new Set(llms.map(n=>n.id));
    const outMap = new Map();
    const inDeg = new Map();
    for(const e of edges){
      if(!e) continue;
      if(!idSet.has(e.fromNodeId) || !idSet.has(e.toNodeId)) continue;
      if(!outMap.has(e.fromNodeId)) outMap.set(e.fromNodeId, []);
      outMap.get(e.fromNodeId).push(e.toNodeId);
      inDeg.set(e.toNodeId, (inDeg.get(e.toNodeId)||0)+1);
      if(!inDeg.has(e.fromNodeId)) inDeg.set(e.fromNodeId, inDeg.get(e.fromNodeId)||0);
    }
    const stage = new Map();
    const q = [];
    for(const n of llms){ if((inDeg.get(n.id)||0)===0){ stage.set(n.id,1); q.push(n.id);} }
    while(q.length){
      const v = q.shift();
      const nexts = outMap.get(v)||[];
      for(const w of nexts){
        const ns = (stage.get(v)||1)+1;
        if(!stage.has(w) || ns > stage.get(w)) stage.set(w, ns);
        inDeg.set(w, (inDeg.get(w)||1)-1);
        if(inDeg.get(w)===0) q.push(w);
      }
    }
    return stage;
  }

  async function execute({ text = '', context = {}, history = [], signal, userMessageId, assistantMessageId, suppressPersistence } = {}){
    // If not enabled or graph is empty: indicate not handled so ai_core can fallback.
    if(!isEnabled()) return null;
    const graph = loadGraph();
    if(!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0){
      return null;
    }

    const MaidCore = window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore;
    if(!MaidCore || typeof MaidCore.callLLMChat !== 'function'){
      return null; // cannot operate without core helpers
    }

    // Helpers
    const title = window.localStorage.getItem('maid-chan:title') || 'Maid-chan';
    const historyMessages = toLLMMessages(history);
    const nodeById = new Map();
    for(const n of (graph.nodes||[])){ if(n && n.id) nodeById.set(n.id, n); }
    const getIncomingEdges = (nodeId, port)=>{
      const list = (graph.edges||[]).filter(e => e && e.toNodeId === nodeId && (e.toPort||0) === (port||0));
      list.sort((a,b)=>{
        const ia = Number.isFinite(a.index)? a.index : Infinity;
        const ib = Number.isFinite(b.index)? b.index : Infinity;
        if(ia !== ib) return ia - ib; return String(a.id).localeCompare(String(b.id));
      });
      return list;
    };
    const getOutgoingEdges = (nodeId)=> (graph.edges||[]).filter(e=> e && e.fromNodeId === nodeId);

    // If graph has a direct User Input -> Save history edge, save user text once
    try{
      const nmap = new Map(); for(const n of (graph.nodes||[])){ if(n && n.id) nmap.set(n.id, n); }
      const edges = graph.edges||[];
      if(!suppressPersistence){
        // Save history for real chat input
        const hasUserSave = edges.some(e=>{ const from = nmap.get(e && e.fromNodeId); const to = nmap.get(e && e.toNodeId); return from && to && from.type === 'User Input' && to.type === 'Save history'; });
        if(hasUserSave && String(text||'').trim()){
          await persistHistoryMessage({ id: userMessageId, role:'user', content: text });
        }
        // Save history for simulated input nodes (User Input SM)
        for(const e of edges){
          const from = nmap.get(e && e.fromNodeId); const to = nmap.get(e && e.toNodeId);
          if(from && to && from.type === 'User Input SM' && to.type === 'Save history'){
            const content = (from.data && typeof from.data.text === 'string') ? from.data.text : '';
            if(content && content.trim()){
              await persistHistoryMessage({ role:'user', content: content });
            }
          }
        }
      }
    }catch(_e){}

    // Build process graph (LLM nodes only) for staged execution
    const procNodes = (graph.nodes||[]).filter(n=> n && n.type === 'LLM');
    const idSet = new Set(procNodes.map(n=>n.id));
    const outMap = new Map();
    const inDeg = new Map();
    for(const e of (graph.edges||[])){
      if(!e) continue;
      if(!idSet.has(e.fromNodeId) || !idSet.has(e.toNodeId)) continue;
      if(!outMap.has(e.fromNodeId)) outMap.set(e.fromNodeId, []);
      outMap.get(e.fromNodeId).push(e.toNodeId);
      inDeg.set(e.toNodeId, (inDeg.get(e.toNodeId)||0)+1);
      if(!inDeg.has(e.fromNodeId)) inDeg.set(e.fromNodeId, inDeg.get(e.fromNodeId)||0);
    }
    // Kahn topological order
    const q = [];
    for(const n of procNodes){ if((inDeg.get(n.id)||0)===0) q.push(n.id); }
    const topo = [];
    while(q.length){
      const v = q.shift(); topo.push(v);
      const nexts = outMap.get(v)||[];
      for(const w of nexts){
        inDeg.set(w, (inDeg.get(w)||1)-1);
        if(inDeg.get(w)===0) q.push(w);
      }
    }
    if(procNodes.length===0){ return null; }
    if(topo.length===0 && procNodes.length){ topo.push(procNodes[0].id); }

    // Cache previous LLM results by nodeId
    const results = new Map();

    // Helper: Chat Samples from storage (not auto base)
    const getChatSamples = ()=>{
      try{
        const raw = String(window.localStorage.getItem('maid-chan:persona:chatSamples')||'').trim();
        if(!raw) return [];
        if(raw.startsWith('[')){
          const arr = JSON.parse(raw);
          return toLLMMessages(arr);
        }
        return [{ role:'system', content: raw }];
      }catch(_e){ return []; }
    };

    // Track which Choice nodes have been activated by prior LLM tool-calls
    const activatedChoices = new Set();

    // Execute each LLM in topological order
    for(const llmId of topo){
      const llmNode = nodeById.get(llmId);
      if(!llmNode) continue;
      // Gate: if this LLM is wired from any Choice node into Prompt port, only run if the Choice is activated
      const choicePromptEdges = getIncomingEdges(llmId, 0).filter(e=>{ const src = nodeById.get(e.fromNodeId); return src && src.type === 'Choice'; });
      if(choicePromptEdges.length){
        const anyActive = choicePromptEdges.some(e=> activatedChoices.has(e.fromNodeId));
        if(!anyActive){ continue; }
      }
      const messages = [ { role:'system', content: `# Character: ${title}` } ];

      // Prompt (port 0)
      const pEdges = getIncomingEdges(llmId, 0);
      for(const e of pEdges){
        const src = nodeById.get(e.fromNodeId); if(!src) continue;
        if(src.type === 'Maid Persona'){
          const piece = String(window.localStorage.getItem('maid-chan:persona:aboutMaid')||'').trim();
          if(piece) messages.push({ role:'system', content: piece });
        }else if(src.type === 'User Persona'){
          const piece = String(window.localStorage.getItem('maid-chan:persona:aboutUser')||'').trim();
          if(piece) messages.push({ role:'system', content: piece });
        }else if(src.type === 'Custom Prompt'){
          const piece = String((src.data && src.data.text) || '').trim();
          if(piece) messages.push({ role:'system', content: piece });
        }else if(src.type === 'LLM'){
          const prev = results.get(src.id);
          const prevText = prev && (prev.text || prev.message || prev.content) || '';
          const toolsRes = prev && (prev.tools_result || prev.toolsResult);
          if(prevText) messages.push({ role:'system', content: String(prevText) });
          if(toolsRes!=null && toolsRes!==''){
            const ttxt = typeof toolsRes==='string' ? toolsRes : JSON.stringify(toolsRes);
            messages.push({ role:'system', content: ttxt });
          }
        }
      }

      // History (port 1)
      let userInputInjected = false;
      const hEdges = getIncomingEdges(llmId, 1);
      const wiredUser = hEdges.some(e=>{ const src = nodeById.get(e.fromNodeId); return src && (src.type === 'User Input' || src.type === 'User Input SM'); });
      for(const e of hEdges){
        const src = nodeById.get(e.fromNodeId); if(!src) continue;
        if(src.type === 'Chat Samples'){
          messages.push(...getChatSamples());
        }else if(src.type === 'Read history'){
          try{
            if(!__historyItemsCache){ __historyItemsCache = await fetchHistoryItems(); }
            const max = (src.data && src.data.maxItems) || 20;
            const recent = (__historyItemsCache||[]).slice(-max);
            messages.push(...historyItemsToMessages(recent));
          }catch(_e){
            try{ const raw = window.localStorage.getItem('maid-chan:history-log'); const arr = raw? JSON.parse(raw): []; for(const item of arr){ if(item && item.msg){ messages.push({ role:'assistant', content: String(item.msg) }); } } }catch(__e){}
          }
        }else if(src.type === 'User Input'){
          messages.push({ role:'user', content: text });
          userInputInjected = true;
        }else if(src.type === 'User Input SM'){
          const content = (src.data && typeof src.data.text === 'string') ? src.data.text : '';
          if(content && content.trim()){
            messages.push({ role:'user', content });
            userInputInjected = true;
          }
        }else if(src.type === 'LLM'){
          const prev = results.get(src.id);
          const prevText = prev && (prev.text || prev.message || prev.content) || '';
          if(prevText) messages.push({ role:'assistant', content: String(prevText) });
        }
      }
      if(hEdges.length===0){
        // If no explicit history edges provided, include provided runtime history for compatibility
        messages.push(...historyMessages);
        if(String(text||'').trim()) messages.push({ role:'user', content: text });
      }
      // Do NOT auto-inject user text when history edges exist but "User Input" is not wired.
      // This prevents chat input from triggering LLM nodes that are not connected to User Input.
      if(hEdges.length>0 && userInputInjected===false){ /* no implicit user injection */ }

      // If this call is chat-triggered (text present) but this LLM isn't wired to User Input,
      // and no User Input was injected, skip executing this LLM for this request.
      if(String(text||'').trim() && !wiredUser && !userInputInjected){
        continue;
      }

      // Tools (port 2): collect allow-list and any custom tool declarations (from Choice nodes)
      let disableTools = false; // legacy flag retained (no longer driven by UI)
      const tEdges = getIncomingEdges(llmId, 2);
      let allowedTools = null;
      const customTools = [];
      if(tEdges.length){
        const allowSet = new Set();
        for(const e of tEdges){
          const src = nodeById.get(e.fromNodeId);
          if(!src) continue;
          if(src.type === 'Tools Control'){
            const arr = (src.data && Array.isArray(src.data.selected)) ? src.data.selected : [];
            for(const name of arr){ if(name) allowSet.add(String(name)); }
          } else if(src.type === 'Choice'){
            try{
              const d = src.data || {};
              const name = (d.toolName || 'mc_choice').toString();
              const c1 = (d.choice1 || 'Choice 1').toString();
              const c2 = (d.choice2 || 'Choice 2').toString();
              const c3 = (d.choice3 || 'Choice 3').toString();
              const tool = {
                name,
                description: 'Select one or more predefined options.',
                parameters: {
                  type: 'object',
                  properties: {
                    choice: {
                      description: 'List of chosen options by label or index',
                      anyOf: [
                        { type: 'string', enum: [c1, c2, c3, '1', '2', '3'] },
                        { type: 'array', items: { type: 'string', enum: [c1, c2, c3, '1', '2', '3'] } }
                      ]
                    }
                  },
                  additionalProperties: true
                }
              };
              customTools.push(tool);
            }catch(_e){ /* ignore malformed */ }
          }
        }
        allowedTools = Array.from(allowSet);
      }

      // Settings (port 3)
      let settings = {};
      const sEdges = getIncomingEdges(llmId, 3);
      for(const e of sEdges){
        const src = nodeById.get(e.fromNodeId);
        if(src && src.type === 'LLM settings' && src.data){ settings = { ...settings, ...src.data }; }
      }
      // Also allow fallback to global cached config, but only if no settings wired
      if(Object.keys(settings).length===0){
        try{ const raw = window.localStorage.getItem('maid-chan:llm-config'); if(raw){ const cfg = JSON.parse(raw); if(cfg && typeof cfg==='object') settings = cfg; } }catch(_e){}
      }

      // Execute this LLM node
      const res = await MaidCore.callLLMChat({ messages, signal, disableTools, allowedTools, customTools, settings });
      results.set(llmId, res || {});

      // Detect custom choice tool calls to activate downstream Choice nodes
      try{
        const calls = (function(r){ if(!r||typeof r!=='object') return []; if(r.type==='tool_calls'&&Array.isArray(r.calls)) return r.calls; if(r.type==='tool_call'&&r.name){return[{name:r.name,arguments:r.arguments||r.args||{}}];} return []; })(res);
        if(calls.some(c=>{ const n=(c&&c.name||'').toString().toLowerCase(); return n==='mc_choice'||n==='choice'||n.includes('choice'); })){
          const outsFromThis = getOutgoingEdges(llmId);
          for(const oe of outsFromThis){ const tgt = nodeById.get(oe.toNodeId); if(tgt && tgt.type==='Choice'){ activatedChoices.add(tgt.id); } }
        }
      }catch(_e){}

      // Route outputs for this LLM based on edges
      const outs = getOutgoingEdges(llmId);
      const assistantText = (res && (res.text || res.message || res.content)) || '';
      const toolsBlob = (res && (res.tools_result || res.toolsResult));
      const toolContentsRaw = Array.isArray(res && res.tool_contents) ? res.tool_contents : null;
      const usedToolsRaw = Array.isArray(res && res.used_tools) ? res.used_tools : null;
      const assistantMsg = { role:'assistant', content: assistantText, id: assistantMessageId || (res && (res.id || res.message_id)) || undefined };
      if(toolsBlob != null && toolsBlob !== ''){
        try{ assistantMsg.tool_results_text = (typeof toolsBlob === 'string') ? toolsBlob : JSON.stringify(toolsBlob); }catch(_e){}
      }
      // Attach structured tools if available
      if(toolContentsRaw && toolContentsRaw.length){
        try{ assistantMsg.tool_contents = toolContentsRaw.slice(); }catch(_e){}
        try{
          const arr = toolContentsRaw.map(t=>({
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
          })).filter(x=> x.name);
          if(arr.length) assistantMsg.tool_info = arr;
        }catch(_e){}
      } else if(usedToolsRaw && usedToolsRaw.length){
        try{ assistantMsg.tool_info = usedToolsRaw.filter(Boolean).map(u=>({ name: u.name || u.id })); }catch(_e){}
      }
      let shouldSaveAssistant = false;
      for(const e of outs){
        const target = nodeById.get(e.toNodeId); if(!target) continue;
        if(target.type === 'Save history'){
          shouldSaveAssistant = true; // defer actual save to avoid double-saving when both outputs connect
        }else if(target.type === 'Send to chat UI'){
          try{ window.dispatchEvent(new CustomEvent('maid-chan:chat:append', { detail: { message: assistantMsg } })); }catch(_e){}
        }else if(target.type === 'Send to chat bubble'){
          try{
            const inst = window.Yuuka && window.Yuuka.plugins && window.Yuuka.plugins.maidChanInstance;
            if(inst && typeof inst._showChatBubble === 'function'){ inst._showChatBubble({ text: assistantText, duration: 5000, type: 'info' }); }
            else { window.dispatchEvent(new CustomEvent('maid-chan:bubble:toast', { detail: { text: assistantText } })); }
          }catch(_e){}
        }else if(target.type === 'Preview'){
          try{ window.dispatchEvent(new CustomEvent('maid-chan:preview:update', { detail: { nodeId: target.id, message: assistantMsg, toolsResult: (res && (res.tools_result || res.toolsResult)) || null } })); }catch(_e){}
        }else if(target.type === 'Tools execution'){
          // Execute tool calls (single-shot). Do not loop LLM.
          try{
            const execCalls = (function(r){
              if(!r || typeof r !== 'object') return [];
              if(r.type === 'tool_calls' && Array.isArray(r.calls)) return r.calls;
              if(r.type === 'tool_call' && r.name){ return [{ name: r.name, arguments: r.arguments || r.args || {} }]; }
              // Some providers may embed function_calls
              if(Array.isArray(r.function_calls)) return r.function_calls;
              return [];
            })(res);
            if(execCalls.length){
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
              for(const c of execCalls){
                const fn = c && c.name ? String(c.name) : '';
                if(!fn) continue;
                // Skip custom choice tool, handled by Choice node edges/UI
                if(fn === 'mc_choice' || fn === 'choice' || fn.toLowerCase().includes('choice')) continue;
                const args = (c && (c.arguments || c.args)) || {};
                try{
                  const cap = resolveCap(fn);
                  if(cap && capsSvc && typeof capsSvc.invoke === 'function'){
                    // Fire and forget
                    capsSvc.invoke(cap.id, args, { source: 'maid' }).catch(()=>{});
                  }else{
                    // Fallback: broadcast event for external handlers
                    window.dispatchEvent(new CustomEvent('maid-chan:tools:execute', { detail: { name: fn, args } }));
                  }
                }catch(_e){ /* ignore tool errors */ }
              }
            }
          }catch(_e){ /* ignore */ }
        }
      }
      if(!suppressPersistence && shouldSaveAssistant){ await persistHistoryMessage(assistantMsg); }
    }

    // Prefer last executed LLM response for return value
    let lastRes = null;
    for(const id of topo){ lastRes = results.get(id) || lastRes; }
    return { __maidLogicHandled: true, response: lastRes };
  }

  // Stage runner: run from a given stage to the end, emitting begin/done per stage
  async function runFromStage({ startStage = 1, text = '', context = {}, history = [], signal, graph: providedGraph, runId, presetId } = {}){
    const graph = providedGraph || loadGraph();
    if(!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return;
    const MaidCore = window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore;
    if(!MaidCore || typeof MaidCore.callLLMChat !== 'function') return;

    const title = window.localStorage.getItem('maid-chan:title') || 'Maid-chan';
    const historyMessages = toLLMMessages(history);

    const nodeById = new Map();
    for(const n of (graph.nodes||[])){ if(n && n.id) nodeById.set(n.id, n); }
    const getIncomingEdges = (nodeId, port)=>{
      const list = (graph.edges||[]).filter(e => e && e.toNodeId === nodeId && (e.toPort||0) === (port||0));
      list.sort((a,b)=>{
        const ia = Number.isFinite(a.index)? a.index : Infinity;
        const ib = Number.isFinite(b.index)? b.index : Infinity;
        if(ia !== ib) return ia - ib; return String(a.id).localeCompare(String(b.id));
      });
      return list;
    };
    const getOutgoingEdges = (nodeId)=> (graph.edges||[]).filter(e=> e && e.fromNodeId === nodeId);

    // Build stage buckets
    const stageMap = computeLLMStages(graph);
    if(stageMap.size===0) return;
    let maxStage = 0;
    for(const v of stageMap.values()){ if(v>maxStage) maxStage=v; }
    const stages = new Array(maxStage+1).fill(null).map(()=>[]);
    for(const [id, s] of stageMap){ stages[s].push(id); }
    for(let s=1;s<stages.length;s++){ stages[s].sort(); }

    const results = new Map();

    const getChatSamples = ()=>{
      try{ const raw = String(window.localStorage.getItem('maid-chan:persona:chatSamples')||'').trim(); if(!raw) return []; if(raw.startsWith('[')){ return toLLMMessages(JSON.parse(raw)); } return [{ role:'system', content: raw }]; }catch(_e){ return []; }
    };

    // If graph has a direct User Input -> Save history edge, save user text once before stages
    try{
      const hasUserSave = (()=>{
        const nmap = new Map(); for(const n of (graph.nodes||[])){ if(n && n.id) nmap.set(n.id, n); }
        return (graph.edges||[]).some(e=>{ const from = nmap.get(e && e.fromNodeId); const to = nmap.get(e && e.toNodeId); return from && to && from.type === 'User Input' && to.type === 'Save history'; });
      })();
      if(hasUserSave && String(text||'').trim()){
        await persistHistoryMessage({ role:'user', content: text });
      }
    }catch(_e){}

    // Track activated Choice nodes during staged run
    const activatedChoices = new Set();

    for(let s=startStage; s<=maxStage; s++){
      const ids = stages[s]||[]; if(ids.length===0) continue;
      try{ window.dispatchEvent(new CustomEvent('maid-chan:logic:stage:begin', { detail: { stage: s, runId, presetId } })); }catch(_e){}
      for(const llmId of ids){
        const llmNode = nodeById.get(llmId); if(!llmNode) continue;
        // Gate by Choice prompt inputs
        const choicePromptEdges = getIncomingEdges(llmId, 0).filter(e=>{ const src = nodeById.get(e.fromNodeId); return src && src.type === 'Choice'; });
        if(choicePromptEdges.length){
          const anyActive = choicePromptEdges.some(e=> activatedChoices.has(e.fromNodeId));
          if(!anyActive){ continue; }
        }
        const messages = [ { role:'system', content: `# Character: ${title}` } ];
        // Prompt
        const pEdges = getIncomingEdges(llmId, 0);
        for(const e of pEdges){
          const src = nodeById.get(e.fromNodeId); if(!src) continue;
          if(src.type === 'Maid Persona'){
            const piece = String(window.localStorage.getItem('maid-chan:persona:aboutMaid')||'').trim(); if(piece) messages.push({ role:'system', content: piece });
          }else if(src.type === 'User Persona'){
            const piece = String(window.localStorage.getItem('maid-chan:persona:aboutUser')||'').trim(); if(piece) messages.push({ role:'system', content: piece });
          }else if(src.type === 'Custom Prompt'){
            const piece = String((src.data && src.data.text) || '').trim(); if(piece) messages.push({ role:'system', content: piece });
          }else if(src.type === 'LLM'){
            const prev = results.get(src.id); const prevText = prev && (prev.text || prev.message || prev.content) || ''; const toolsRes = prev && (prev.tools_result || prev.toolsResult);
            if(prevText) messages.push({ role:'system', content: String(prevText) });
            if(toolsRes!=null && toolsRes!==''){ const ttxt = typeof toolsRes==='string' ? toolsRes : JSON.stringify(toolsRes); messages.push({ role:'system', content: ttxt }); }
          }
        }
        // History
        let userInputInjected = false;
        const hEdges = getIncomingEdges(llmId, 1);
        const wiredUser = hEdges.some(e=>{ const src = nodeById.get(e.fromNodeId); return src && (src.type === 'User Input' || src.type === 'User Input SM'); });
        for(const e of hEdges){
          const src = nodeById.get(e.fromNodeId); if(!src) continue;
          if(src.type === 'Chat Samples'){ messages.push(...getChatSamples()); }
          else if(src.type === 'Read history'){
            try{ if(!__historyItemsCache){ __historyItemsCache = await fetchHistoryItems(); } const max = (src.data && src.data.maxItems) || 20; const recent = (__historyItemsCache||[]).slice(-max); messages.push(...historyItemsToMessages(recent)); }catch(_e){ try{ const raw = window.localStorage.getItem('maid-chan:history-log'); const arr = raw? JSON.parse(raw): []; for(const item of arr){ if(item && item.msg){ messages.push({ role:'assistant', content: String(item.msg) }); } } }catch(__e){} }
          }else if(src.type === 'User Input'){ messages.push({ role:'user', content: text }); userInputInjected = true; }
          else if(src.type === 'User Input SM'){ const content = (src.data && typeof src.data.text === 'string') ? src.data.text : ''; if(content && content.trim()){ messages.push({ role:'user', content }); userInputInjected = true; } }
          else if(src.type === 'LLM'){ const prev = results.get(src.id); const prevText = prev && (prev.text || prev.message || prev.content) || ''; if(prevText) messages.push({ role:'assistant', content: String(prevText) }); }
        }
        if(hEdges.length===0){ messages.push(...historyMessages); if(String(text||'').trim()) messages.push({ role:'user', content: text }); }
        // Do not implicitly inject when history edges exist but User Input isn't wired
        if(hEdges.length>0 && userInputInjected===false){ /* skip implicit injection */ }
        if(String(text||'').trim() && !wiredUser && !userInputInjected){
          continue; // skip executing this LLM in staged run for chat-triggered input
        }
        // Tools: gather allow-list and custom tools from Choice nodes
        let disableTools = false;
        const tEdges = getIncomingEdges(llmId, 2);
        let allowedTools = null;
        const customTools = [];
        if(tEdges.length){
          const allowSet = new Set();
          for(const e of tEdges){
            const src = nodeById.get(e.fromNodeId);
            if(!src) continue;
            if(src.type === 'Tools Control'){
              const arr = (src.data && Array.isArray(src.data.selected)) ? src.data.selected : [];
              for(const name of arr){ if(name) allowSet.add(String(name)); }
            } else if(src.type === 'Choice'){
              try{
                const d = src.data || {};
                const name = (d.toolName || 'mc_choice').toString();
                const c1 = (d.choice1 || 'Choice 1').toString();
                const c2 = (d.choice2 || 'Choice 2').toString();
                const c3 = (d.choice3 || 'Choice 3').toString();
                customTools.push({
                  name,
                  description: 'Select one or more predefined options.',
                  parameters: {
                    type: 'object',
                    properties: { choice: { anyOf: [ { type:'string', enum:[c1,c2,c3,'1','2','3'] }, { type:'array', items: { type:'string', enum:[c1,c2,c3,'1','2','3'] } } ] } },
                    additionalProperties: true
                  }
                });
              }catch(_e){}
            }
          }
          allowedTools = Array.from(allowSet);
        }
        // Settings
        let settings = {};
        const sEdges = getIncomingEdges(llmId, 3);
        for(const e of sEdges){ const src = nodeById.get(e.fromNodeId); if(src && src.type === 'LLM settings' && src.data){ settings = { ...settings, ...src.data }; } }
        if(Object.keys(settings).length===0){ try{ const raw = window.localStorage.getItem('maid-chan:llm-config'); if(raw){ const cfg = JSON.parse(raw); if(cfg && typeof cfg==='object') settings = cfg; } }catch(_e){} }

        const res = await MaidCore.callLLMChat({ messages, signal, disableTools, allowedTools, customTools, settings });
        results.set(llmId, res || {});

        // Activate downstream Choice nodes if this LLM produced a choice tool call
        try{
          const calls = (function(r){ if(!r||typeof r!=='object') return []; if(r.type==='tool_calls'&&Array.isArray(r.calls)) return r.calls; if(r.type==='tool_call'&&r.name){return[{name:r.name,arguments:r.arguments||r.args||{}}];} return []; })(res);
          if(calls.some(c=>{ const n=(c&&c.name||'').toString().toLowerCase(); return n==='mc_choice'||n==='choice'||n.includes('choice'); })){
            const outsFromThis = getOutgoingEdges(llmId);
            for(const oe of outsFromThis){ const tgt = nodeById.get(oe.toNodeId); if(tgt && tgt.type==='Choice'){ activatedChoices.add(tgt.id); } }
          }
        }catch(_e){}

        // Route outputs
        const outs = getOutgoingEdges(llmId);
        const assistantText = (res && (res.text || res.message || res.content)) || '';
        const toolsBlob = (res && (res.tools_result || res.toolsResult));
        const toolContentsRaw = Array.isArray(res && res.tool_contents) ? res.tool_contents : null;
        const usedToolsRaw = Array.isArray(res && res.used_tools) ? res.used_tools : null;
        const assistantMsg = { role:'assistant', content: assistantText, id: (res && (res.id || res.message_id)) || undefined };
        if(toolsBlob != null && toolsBlob !== ''){ try{ assistantMsg.tool_results_text = (typeof toolsBlob === 'string') ? toolsBlob : JSON.stringify(toolsBlob); }catch(_e){} }
        if(toolContentsRaw && toolContentsRaw.length){
          try{ assistantMsg.tool_contents = toolContentsRaw.slice(); }catch(_e){}
          try{
            const arr = toolContentsRaw.map(t=>({
              name: t.name || t.id,
              type: (t.type||'').toLowerCase(),
              pluginId: t.pluginId || '',
              stage: t.stage,
              arguments_list: Array.isArray(t?.arguments_list) ? t.arguments_list.slice() : (function(v){ const src = (v!==undefined ? v : (t.arguments!==undefined ? t.arguments : t.args)); if(src==null) return []; if(Array.isArray(src)) return src.slice(); if(typeof src==='object') return Object.values(src); return [src]; })(t.arguments_list),
              result_list: Array.isArray(t?.result_list) ? t.result_list.slice() : (function(v){ const src = (v!==undefined ? v : t.result); if(src==null) return []; if(Array.isArray(src)) return src.slice(); if(typeof src==='object') return Object.values(src); return [src]; })(t.result_list)
            })).filter(x=> x.name);
            if(arr.length) assistantMsg.tool_info = arr;
          }catch(_e){}
        } else if(usedToolsRaw && usedToolsRaw.length){
          try{ assistantMsg.tool_info = usedToolsRaw.filter(Boolean).map(u=>({ name: u.name || u.id })); }catch(_e){}
        }
        let shouldSaveAssistant = false;
        for(const e of outs){
          const target = nodeById.get(e.toNodeId); if(!target) continue;
          if(target.type === 'Save history'){
            shouldSaveAssistant = true; // defer to avoid double-save when both outputs wired
          }else if(target.type === 'Send to chat UI'){
            try{ window.dispatchEvent(new CustomEvent('maid-chan:chat:append', { detail: { message: assistantMsg } })); }catch(_e){}
          }else if(target.type === 'Send to chat bubble'){
            try{ const inst = window.Yuuka && window.Yuuka.plugins && window.Yuuka.plugins.maidChanInstance; if(inst && typeof inst._showChatBubble === 'function'){ inst._showChatBubble({ text: assistantText, duration: 5000, type: 'info' }); } else { window.dispatchEvent(new CustomEvent('maid-chan:bubble:toast', { detail: { text: assistantText } })); } }catch(_e){}
          }else if(target.type === 'Preview'){
            try{ window.dispatchEvent(new CustomEvent('maid-chan:preview:update', { detail: { nodeId: target.id, message: assistantMsg, toolsResult: (res && (res.tools_result || res.toolsResult)) || null } })); }catch(_e){}
          }else if(target.type === 'Tools execution'){
            try{
              const execCalls = (function(r){ if(!r||typeof r!=='object') return []; if(r.type==='tool_calls'&&Array.isArray(r.calls)) return r.calls; if(r.type==='tool_call'&&r.name){return[{name:r.name,arguments:r.arguments||r.args||{}}];} if(Array.isArray(r.function_calls)) return r.function_calls; return []; })(res);
              if(execCalls.length){
                const root = window.Yuuka || {}; const services = root.services || {}; const capsSvc = services.capabilities;
                const resolveCap = (fnName)=>{ if(!capsSvc||typeof capsSvc.listLLMCallable!=='function') return null; const all=capsSvc.listLLMCallable()||[]; const target=String(fnName||'').trim().toLowerCase(); for(const c of all){ if(!c||!c.llmCallable) continue; const n=((c.llmName&&String(c.llmName))||String(c.id||'')).trim().toLowerCase(); if(n&&n===target) return c; } return null; };
                for(const c of execCalls){ const fn=c&&c.name?String(c.name):''; if(!fn) continue; if(fn==='mc_choice'||fn==='choice'||fn.toLowerCase().includes('choice')) continue; const args=(c&&(c.arguments||c.args))||{}; try{ const cap=resolveCap(fn); if(cap&&capsSvc&&typeof capsSvc.invoke==='function'){ capsSvc.invoke(cap.id, args, { source: 'maid' }).catch(()=>{}); } else { window.dispatchEvent(new CustomEvent('maid-chan:tools:execute', { detail: { name: fn, args } })); } }catch(_e){} }
              }
            }catch(_e){}
          }
        }
        if(shouldSaveAssistant){ await persistHistoryMessage(assistantMsg); }
      }
      try{ window.dispatchEvent(new CustomEvent('maid-chan:logic:stage:done', { detail: { stage: s, runId, presetId } })); }catch(_e){}
    }
    try{ window.dispatchEvent(new CustomEvent('maid-chan:logic:run:done', { detail: { runId, presetId } })); }catch(_e){}
  }

  // Listen for UI play requests
  window.addEventListener('maid-chan:logic:run-stage', (ev)=>{
    const d = (ev && ev.detail) || {};
    const startStage = d.stage || 1;
    const runId = d.runId;
    const presetId = d.presetId;
    const graph = d.graph || null;
    // We don't have text/context/history here; run with empty input unless provided externally
    runFromStage({ startStage, runId, presetId, graph }).catch(()=>{});
  });

  // Expose API
  window.Yuuka.ai.AILogic = {
    isEnabled,
    loadGraph,
    saveGraph,
    execute
  };
})();
