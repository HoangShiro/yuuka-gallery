(function(){
  // Maid-chan AI Core
  // Centralizes prompt building and LLM calls for Maid-chan.

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.ai = window.Yuuka.ai || {};

  const STORAGE_KEY = 'maid-chan:llm-config';

  function loadLLMConfig(){
    try{
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if(!raw) return {};
      return JSON.parse(raw);
    }catch(_e){ return {}; }
  }

  // Parse persona "Chat samples" into structured chat history messages.
  // Expected format per line (before the first colon):
  //   - For maid/assistant: "char", "{{char}}", "<char_name>", or "maid"
  //   - For user:          "user", "{{user}}", or "<user_name>"
  function parseChatSamples(personaChatSamples){
    if(!personaChatSamples) return [];
    let raw = String(personaChatSamples).trim();
    // If entire block is quoted, strip enclosing quotes.
    if((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))){
      raw = raw.slice(1, -1);
    }
    // Replace escaped newlines with real newlines (textarea may have been stored with \n sequences)
    raw = raw.replace(/\\n/g, '\n');
    const lines = raw.split(/\r?\n/);
    const messages = [];

    for(const rawLine of lines){
      if(!rawLine) continue;
      const line = String(rawLine).trim();
      if(!line) continue;

      const m = /^([^:]+):\s*(.*)$/.exec(line);
      if(!m) continue;

      let prefix = m[1].trim();
      // Strip any surrounding quotes around prefix token (e.g. "user or 'char)
      prefix = prefix.replace(/^['"]+|['"]+$/g, '');
      const text = m[2].trim();
      if(!text) continue;

      // Normalize prefix for matching.
      const p = prefix.toLowerCase();

      // Assistant / maid patterns
      const isMaid = (
        p === 'char' ||
        p === '{{char}}' ||
        p === 'maid' ||
        /^<[^>]+>$/.test(prefix) // e.g. <Yuuka>
      );

      // User patterns
      const isUser = (
        p === 'user' ||
        p === '{{user}}' ||
        /^<[^>]+>$/.test(prefix) // e.g. <Shiro>
      );

      if(isMaid && !isUser){
        messages.push({ role: 'assistant', content: text });
      }else if(isUser && !isMaid){
        messages.push({ role: 'user', content: text });
      }
    }

    return messages;
  }

  function buildBasePrompt(context){
    const cfg = loadLLMConfig();
    const title = window.localStorage.getItem('maid-chan:title') || 'Maid-chan';
    const personaAboutMaid = window.localStorage.getItem('maid-chan:persona:aboutMaid') || '';
    const personaAboutUser = window.localStorage.getItem('maid-chan:persona:aboutUser') || '';
    const personaChatSamples = window.localStorage.getItem('maid-chan:persona:chatSamples') || '';

    const lines = [];
    lines.push(`# Character: ${title}`);
    if(personaAboutMaid){ lines.push('## About maid'); lines.push(personaAboutMaid); }
    if(personaAboutUser){ lines.push('## About user'); lines.push(personaAboutUser); }
    if(context && context.extra){ lines.push('## Context'); lines.push(String(context.extra)); }
    const promptText = lines.join('\n\n');

    // Return both the prompt text and parsed chat-sample history
    const sampleMessages = parseChatSamples(personaChatSamples);
    return { prompt: promptText, samples: sampleMessages };
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

  // Build Gemini-style tools/function declarations from global capabilities service.
  // Each capability with llmCallable=true will be exposed as a function.
  function buildToolsFromCapabilities(){
    const root = window.Yuuka || {};
    const services = root.services || {};
    const capsSvc = services.capabilities;
    if(!capsSvc || typeof capsSvc.listLLMCallable !== 'function') return [];

    const items = capsSvc.listLLMCallable();
    if(!Array.isArray(items) || !items.length) return [];

    const tools = [];
    // Ability tab stores per-capability enable state in localStorage keys:
    //   maid-chan:capability:<pluginId>:<capId> (boolean JSON)
    // and group default key:
    //   maid-chan:capability:<pluginId>:enabledAll (boolean JSON, default true)
    // If the per-cap key is absent we fall back to group key. This allows
    // users to disable capabilities and immediately prevent the LLM from
    // calling them. Previously we exposed all llmCallable capabilities
    // unconditionally which caused function calling to occur even when
    // toggled off in the UI.
    const CAP_NS = 'maid-chan:capability:';
    const loadFlag = (k, fb)=>{
      try {
        const raw = window.localStorage.getItem(k);
        if(raw === null) return fb;
        return JSON.parse(raw);
      } catch(_e){ return fb; }
    };
    for(const c of items){
      if(!c || !c.llmCallable) continue;
      const fnName = (c.llmName && String(c.llmName).trim()) || String(c.id || '').trim();
      if(!fnName) continue;
      const pluginId = (c.pluginId || 'core').trim();
      const capId = (c.id || '').trim();
      if(!capId) continue;
      // Determine enabled state
      const perKey = CAP_NS + pluginId + ':' + capId;
      const groupKey = CAP_NS + pluginId + ':enabledAll';
      let enabled = loadFlag(perKey, undefined);
      if(enabled === undefined){
        enabled = loadFlag(groupKey, true); // default group enabled
      }
      if(!enabled){
        continue; // skip disabled capabilities
      }
      const paramsSchema = (c.paramsSchema && typeof c.paramsSchema === 'object')
        ? c.paramsSchema
        : { type: 'object', properties: {} };
      const description = c.description || c.title || c.id || '';

      tools.push({
        name: fnName,
        description,
        parameters: paramsSchema
      });
    }
    return tools;
  }

  async function callLLMChat({ messages, signal, disableTools, allowedTools, customTools, settings } = {}){
    const cfg = loadLLMConfig();
    const provider = cfg.provider || 'openai';
    const model = cfg.model || '';

    if(!cfg.api_key){
      throw new Error('Maid-chan LLM API key is not configured.');
    }

    const payload = {
      provider,
      model,
      api_key: cfg.api_key,
      messages: messages || [],
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
      top_p: typeof cfg.top_p === 'number' ? cfg.top_p : 1,
      max_tokens: typeof cfg.max_tokens === 'number' ? cfg.max_tokens : 512
    };

    // Apply per-node settings overrides (from LLM settings nodes)
    if(settings && typeof settings === 'object'){
      if(settings.model) payload.model = settings.model;
      if(settings.provider) payload.provider = settings.provider;
      if(Number.isFinite(settings.temperature)) payload.temperature = settings.temperature;
      if(Number.isFinite(settings.top_p)) payload.top_p = settings.top_p;
      if(Number.isFinite(settings.max_tokens)) payload.max_tokens = settings.max_tokens;
    }

    // When using Gemini, attach tools built from capabilities so the model
    // can perform function calling. Other providers simply ignore this field.
    // Support explicit disabling of tools in final stage
    if(provider === 'gemini' && !disableTools){
      let tools = buildToolsFromCapabilities();
      if(Array.isArray(allowedTools)){
        const allowSet = new Set(allowedTools.filter(Boolean).map(String));
        if(allowSet.size === 0){
          // Explicitly connected Tools Control but empty selection -> disable all tools
          payload.tool_mode = 'none';
        }else{
          tools = tools.filter(t => allowSet.has(t.name));
        }
      }
      // Merge custom tools from upstream nodes (e.g., Choice)
      if(Array.isArray(customTools) && customTools.length){
        tools = tools.concat(customTools);
      }
      if(tools.length){
        payload.tools = tools;
        payload.tool_mode = 'auto';
      } else if(payload.tool_mode !== 'none'){
        // No tools available after filtering
        payload.tool_mode = 'none';
      }
    }else if(provider === 'gemini' && disableTools){
      // Explicitly disable tools for this round
      payload.tool_mode = 'none';
    }

    // Prefer using plugin API client
    const pluginApi = getPluginApi();
    if(pluginApi && typeof pluginApi.post === 'function'){
      return await pluginApi.post('/chat', payload, { signal });
    }

    // Fallback: call plugin backend directly via fetch
    const res = await fetch('/api/plugin/maid/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
      signal
    });
    if(!res.ok){
      let errMsg = 'LLM request failed with status '+res.status;
      try{
        const data = await res.json();
        if(data && data.error) errMsg = data.error;
      }catch(_e){ /* ignore */ }
      throw new Error(errMsg);
    }
    return await res.json();
  }

  async function askMaid(text, opts = {}){
    // Optional routing through AILogic when enabled
    try{
      const AILogic = (window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.AILogic) || null;
      if(AILogic && typeof AILogic.isEnabled === 'function' && typeof AILogic.execute === 'function' && AILogic.isEnabled()){
        const r = await AILogic.execute({ text, context: opts.context || {}, history: opts.history || [], signal: opts.signal });
        if(r && r.__maidLogicHandled){
          return r.response || r;
        }
      }
    }catch(_e){ /* ignore and fallback to legacy flow */ }
    const base = buildBasePrompt(opts.context || {});
    const systemMsg = { role: 'system', content: typeof base === 'string' ? base : (base.prompt || '') };

    // Inject parsed chat samples as few-shot history before real history.
    const sampleMessages = base && Array.isArray(base.samples) ? base.samples : [];
    const rawHistory = Array.isArray(opts.history) ? opts.history : (opts.history ? [opts.history] : []);

    // Convert our UI history to LLM chat messages format, honoring snapshots.current_index
    function toLLMMessages(items){
      const msgs = [];
      for(const it of items){
        if(!it) continue;
        const role = it.role || 'user';
        if(role !== 'user' && role !== 'assistant') continue;

        if(role === 'assistant'){
          const snap = it.snapshots;
          const idx = (snap && typeof snap === 'object' && Array.isArray(snap.parts))
            ? Math.max(0, Math.min((snap.current_index|0), snap.parts.length - 1))
            : 0;
          const part = snap && snap.parts ? (snap.parts[idx] || {}) : {};
          const t = String(part.text || '');
          const tr = typeof part.tool_results_text === 'string' ? part.tool_results_text : '';
          const content = tr ? (t + "\n\n" + tr) : t;
          msgs.push({ role: 'assistant', content });
        }else{
          // user message
          const t = String(it.text || it.content || '');
          msgs.push({ role: 'user', content: t });
        }
      }
      return msgs;
    }

    const convertedHistory = toLLMMessages(rawHistory);

    const messages = [
      systemMsg,
      ...sampleMessages,
      ...convertedHistory,
      { role: 'user', content: text }
    ];

    const controller = new AbortController();
    if(opts.signal){
      const ext = opts.signal;
      if(ext.aborted) controller.abort();
      else{
        ext.addEventListener('abort', ()=> controller.abort(), { once: true });
      }
    }

    // Multi-stage orchestration (up to 4 stages by default; can be limited via opts.maxStages):
    // Stage 1: initial chat
    // If tool_call -> execute tool, append system summary, proceed Stage 2
    // Stage 2: chat with tool result context
    // If tool_call -> execute tool, append system summary, proceed Stage 3
    // Stage 3: chat with second tool result context
    // If tool_call -> execute tool, append system summary, Stage 4 final forced plain chat (tools disabled)
    // Stage 4: final response (tools disabled regardless of model output intent)
    const cfg = loadLLMConfig();
    const provider = cfg.provider || 'openai';

    // Helper: map LLM function name -> capability id definition
    function resolveCapabilityByFunctionName(fnName){
      const root = window.Yuuka || {};
      const services = root.services || {};
      const capsSvc = services.capabilities;
      if(!capsSvc || typeof capsSvc.listLLMCallable !== 'function') return null;
      const all = capsSvc.listLLMCallable() || [];
      const target = String(fnName || '').trim().toLowerCase();
      if(!target) return null;
      for(const c of all){
        if(!c || !c.llmCallable) continue;
        const n = ((c.llmName && String(c.llmName)) || String(c.id || '')).trim().toLowerCase();
        if(n && n === target) return c;
      }
      return null;
    }

    async function invokeCapability(functionName, args){
      const cap = resolveCapabilityByFunctionName(functionName);
      if(!cap) throw new Error('Unknown capability for function: '+functionName);
      const root = window.Yuuka || {};
      const services = root.services || {};
      const capsSvc = services.capabilities;
      if(!capsSvc || typeof capsSvc.invoke !== 'function'){
        throw new Error('Capabilities service is not available for function: '+functionName);
      }
      return await capsSvc.invoke(cap.id, args || {}, { source: 'maid' });
    }

    // Single-shot for non-Gemini providers
    if(provider !== 'gemini'){
      return await callLLMChat({ messages, signal: controller.signal });
    }

    let historyMessages = messages.slice();
    const executedTools = [];
    const stageSummaries = [];
    const stageToolContentsAll = [];
    let stage = 1;
    const maxStages = Math.max(1, Number.isFinite(opts.maxStages) ? opts.maxStages : 4);
    let lastResponse = null;

    function formatJson(value, maxLen){
      try{
        const s = JSON.stringify(value, null, 2);
        if(!maxLen || s.length <= maxLen) return s;
        return s.slice(0, maxLen) + '...';
      }catch(_e){
        try{ return String(value); }catch(__e){ return '[Unserializable]'; }
      }
    }

    function summarizeToolBatch(items, stage){
      const lines = [];
      lines.push(`[TOOL RESULTS - STAGE ${stage}]`);
      for(const it of items){
        const name = it && it.name ? String(it.name) : 'unknown';
        const argsStr = formatJson(it.arguments || it.args || {}, 500);
        const resStr = 'error' in it && it.error ? String(it.error) : formatJson(it.result, 1000);
        const type = (it.capType || it.type || '').toLowerCase();
        const plugin = it.pluginId ? ` · ${it.pluginId}` : '';
        lines.push(`- ${name}${plugin}${type?` [${type}]`:''}`);
        lines.push(`  args: ${argsStr}`);
        lines.push(`  -> result: ${resStr}`);
      }
      return lines.join('\n');
    }

    async function executeToolAndAppend(fnName, args){
      const cap = resolveCapabilityByFunctionName(fnName);
      if(!cap) {
        historyMessages.push({ role: 'assistant', content: `[SYSTEM]: Unknown function ${fnName}. Continue without it.` });
        return { error: 'Unknown function '+fnName };
      }
      const root = window.Yuuka || {}; const services = root.services || {}; const capsSvc = services.capabilities;
      if(!capsSvc || typeof capsSvc.invoke !== 'function'){
        historyMessages.push({ role: 'assistant', content: '[SYSTEM]: Capability service unavailable. Continue conversation.' });
        return { error: 'Capabilities unavailable' };
      }
      try {
        const result = await capsSvc.invoke(cap.id, args, { source: 'maid' });
        executedTools.push({ name: fnName, id: cap.id, pluginId: cap.pluginId || '', type: (cap.type || 'action').toLowerCase(), stage });
        return { ok: true, result, fnName, capType: (cap.type || '').toLowerCase() };
      }catch(err){
        const msg = (err && err.message) ? err.message : String(err);
        historyMessages.push({ role: 'assistant', content: `[SYSTEM]: Tool ${fnName} failed (${msg}). Continue conversation.` });
        return { error: msg };
      }
    }

    while(stage <= maxStages){
      // Determine if tools should be disabled (final stage or flagged by prior action tool)
      const disableToolsNow = (stage === maxStages) || historyMessages.__forceDisableTools === true || (opts.forceDisableAfterFirst === true && stage >= 2);
      const res = await callLLMChat({ messages: historyMessages, signal: controller.signal, disableTools: disableToolsNow });
      if(!res || typeof res !== 'object' || !res.type || res.type === 'message' || res.type === 'error'){
        lastResponse = res;
        break;
      }
      if(res.type === 'tool_call' || res.type === 'tool_calls'){
        // Normalize to an array of calls
        const calls = res.type === 'tool_calls' ? (Array.isArray(res.calls) ? res.calls : []) : [{ name: res.name, arguments: res.arguments || {} }];
        const batchExec = [];
        for(const c of calls){
          const fn = c && c.name ? String(c.name) : '';
          const args = (c && (c.arguments || c.args)) || {};
          const exec = await executeToolAndAppend(fn, args);
          batchExec.push({ name: fn, arguments: args, ...(exec.ok?{ result: exec.result }: { error: exec.error }), capType: exec.capType, pluginId: (function(){
            const last = executedTools[executedTools.length - 1];
            return last && last.name === fn ? last.pluginId : undefined;
          })() });
        }
        // Append Gemini-style function_response parts FIRST so model sees structured tool output (all in one message)
        const parts = batchExec.map(b=> ({ function_response: { name: b.name, response: ('error' in b && b.error) ? { error: b.error } : (b.result || null) } }));
        historyMessages.push({ role: 'user', parts });
        // Build a summarized system directive and readable log for next stage
        const readable = summarizeToolBatch(batchExec, stage);
        stageSummaries.push(readable);
        // Collect structured tool contents for final embedding on assistant message
        for(const b of batchExec){
          stageToolContentsAll.push({
            stage,
            name: b.name,
            arguments: b.arguments || b.args || {},
            result: ('error' in b && b.error) ? { error: b.error } : (b.result || null),
            type: (b.capType || b.type || ''),
            pluginId: b.pluginId || ''
          });
        }
        // Build system context message summarizing tool result for next stage
        function extractLastUserText(msgs){
          for(let i = msgs.length - 1; i >= 0; i--){
            const m = msgs[i];
            if(m && m.role === 'user'){
              if(typeof m.content === 'string' && m.content.trim()) return m.content.trim();
              if(Array.isArray(m.parts)){
                const t = m.parts.map(p => (p && p.text) ? p.text : '').join(' ').trim();
                if(t) return t;
              }
            }
          }
          return '';
        }
        const lastUserText = extractLastUserText(historyMessages);
        let directive;
        if(stage < Math.min(3, maxStages)){
          directive = 'Use the tool result (already provided as function_response) to continue the conversation. Only call another tool if strictly necessary.';
        }else if(stage === Math.min(3, maxStages)){
          directive = 'Use the tool result (function_response) and provide a final helpful answer. If you still insist on a tool, the system will force a plain answer next.';
        }else{ // stage 4 should not reach here because disableTools true
          directive = 'Provide the final answer.';
        }
        const sysLines = [];
        sysLines.push(`[TOOL_RESULT_STAGE_${stage}]`);
        if(lastUserText){ sysLines.push(`Last user request: ${lastUserText}`); }
        if(res.type === 'tool_calls'){
          try{
            const names = calls.map(c=> c && c.name).filter(Boolean).join(', ');
            sysLines.push(`([System]: Executed tool calls: ${names}. Function responses are attached. Continue naturally.)`);
          }catch(_e){
            sysLines.push('([System]: Executed multiple tool calls. Function responses are attached. Continue naturally.)');
          }
        }else{
          sysLines.push(`([System]: Executed tool call ${calls[0] && calls[0].name}. The structured result is already included as function_response. Please continue the conversation naturally.)`);
        }
        sysLines.push('\n' + readable);
        sysLines.push(directive);
        historyMessages.push({ role: 'system', content: sysLines.join('\n') });
        // If the tool was an ACTION we generally expect completion -> disable tools next stage
        if(batchExec.some(b=> (b.capType||'').toLowerCase() === 'action')){ historyMessages.__forceDisableTools = true; }
        if(stage === Math.min(3, maxStages)){
          // Next stage (4) disable tools to force answer
        }
        stage += 1;
        if(stage > maxStages){
          // Safety fallback
          lastResponse = { type: 'message', text: 'Tool execution sequence ended without final answer.' };
          break;
        }
        continue; // proceed to next stage loop
      } else {
        // Non tool structured type: treat as final
        lastResponse = res;
        break;
      }
    }

    // Final forced round if we ended at stage 4 with last response still a tool_call (edge case)
    if(stage === maxStages && lastResponse && lastResponse.type === 'tool_call'){
      historyMessages.push({ role: 'system', content: 'Provide a final answer in plain text without calling tools.' });
      const resFinal = await callLLMChat({ messages: historyMessages, signal: controller.signal, disableTools: true });
      lastResponse = resFinal;
    }

    try {
      if(lastResponse && typeof lastResponse === 'object'){
        lastResponse.used_tools = executedTools.slice();
        if(stageSummaries.length){
          lastResponse.tool_results_text = stageSummaries.join('\n\n');
        }
        if(stageToolContentsAll.length){
          lastResponse.tool_contents = stageToolContentsAll.slice();
        }
        lastResponse._stages_executed = stage;
        return lastResponse;
      }
      if(typeof lastResponse === 'string'){
        const obj = { type: 'message', text: lastResponse, used_tools: executedTools.slice(), _stages_executed: stage };
        if(stageSummaries.length){ obj.tool_results_text = stageSummaries.join('\n\n'); }
        if(stageToolContentsAll.length){ obj.tool_contents = stageToolContentsAll.slice(); }
        return obj;
      }
    }catch(_e){/* ignore */}
    return lastResponse;
  }

  window.Yuuka.ai.MaidCore = {
    loadLLMConfig,
    buildBasePrompt,
    // Expose tools builder so other modules (e.g., chat regen) can attach tools
    buildToolsFromCapabilities,
    callLLMChat,
    askMaid
  };
})();