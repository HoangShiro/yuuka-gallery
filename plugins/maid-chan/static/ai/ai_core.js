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
    for(const c of items){
      if(!c || !c.llmCallable) continue;
      const fnName = (c.llmName && String(c.llmName).trim()) || String(c.id || '').trim();
      if(!fnName) continue;
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

  async function callLLMChat({ messages, signal } = {}){
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

    // When using Gemini, attach tools built from capabilities so the model
    // can perform function calling. Other providers simply ignore this field.
    if(provider === 'gemini'){
      const tools = buildToolsFromCapabilities();
      if(tools.length){
        payload.tools = tools;
        // Default tool calling mode: "auto" lets the model decide.
        payload.tool_mode = 'auto';
      }
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
    const base = buildBasePrompt(opts.context || {});
    const systemMsg = { role: 'system', content: typeof base === 'string' ? base : (base.prompt || '') };

    // Inject parsed chat samples as few-shot history before real history.
    const sampleMessages = base && Array.isArray(base.samples) ? base.samples : [];
    const history = Array.isArray(opts.history) ? opts.history : (opts.history ? [opts.history] : []);

      const messages = [
      systemMsg,
      ...sampleMessages,
      ...history,
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

    // Orchestrate up to 3 tool-calling rounds for Gemini.
    // Other providers fall back to a single plain chat call.
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
    let lastResponse = null;
    // Track executed tools for UI hints
    const executedTools = [];

    for(let round=0; round<3; round++){
      const res = await callLLMChat({ messages: historyMessages, signal: controller.signal });

      // When tools are enabled, gemini_api.chat returns structured payload.
      if(!res || typeof res !== 'object' || !res.type || res.type === 'message' || res.type === 'error'){
        lastResponse = res;
        break;
      }

      if(res.type === 'tool_call'){
        const fnName = res.name;
        const args = res.arguments || {};
        try { console.debug('[MaidCore] Tool call received:', fnName, args); } catch(_logErr) {}
        const cap = resolveCapabilityByFunctionName(fnName);
        if(!cap){
          // Unknown tool: inform model and let it try another one.
          historyMessages.push({
            role: 'assistant',
            content: `[SYSTEM]: This tool is not available, please try other tools. Error: Unknown function: ${fnName}`
          });
          lastResponse = { type: 'error', error: `Unknown function: ${fnName}` };
          continue;
        }

        const root = window.Yuuka || {};
        const services = root.services || {};
        const capsSvc = services.capabilities;
        if(!capsSvc || typeof capsSvc.invoke !== 'function'){
          historyMessages.push({
            role: 'assistant',
            content: '[SYSTEM]: Capability service is not available, please try other tools.'
          });
          lastResponse = { type: 'error', error: 'Capabilities service is not available' };
          continue;
        }

        try{
          const toolResult = await capsSvc.invoke(cap.id, args, { source: 'maid' });
          try { console.debug('[MaidCore] Tool executed:', fnName, 'result:', toolResult); } catch(_e) {}
          try{
            executedTools.push({
              name: fnName,
              id: cap.id,
              pluginId: cap.pluginId || '',
              type: (cap.type || 'action').toLowerCase()
            });
          }catch(_e){/* ignore */}
          const capType = (cap.type || '').toLowerCase();

          if(capType === 'query'){
            // Feed back to model for next round
            historyMessages.push({
              role: 'assistant',
              content: JSON.stringify({ function: fnName, result: toolResult })
            });
            lastResponse = { type: 'tool_result', name: fnName, result: toolResult };
            continue;
          }

          // Action or other: finish immediately
          lastResponse = { type: 'tool_result', name: fnName, result: toolResult };
          break;
        }catch(err){
          // Tool execution failed: surface as system note so LLM can pick another tool.
          const safeMsg = (err && err.message) ? String(err.message) : String(err);
          try { console.warn('[MaidCore] Tool execution error for', fnName, safeMsg); } catch(_e) {}
          historyMessages.push({
            role: 'assistant',
            content: `[SYSTEM]: This tool is not available, please try other tools. Error: ${safeMsg}`
          });
          lastResponse = { type: 'error', error: safeMsg };
          continue;
        }
      }

      // Anything else: treat as final.
      lastResponse = res;
      break;
    }

    // Attach used_tools metadata for UI consumers when possible
    try{
      if(lastResponse && typeof lastResponse === 'object'){
        lastResponse.used_tools = executedTools.slice();
        return lastResponse;
      }
      if(typeof lastResponse === 'string'){
        return { type: 'message', text: lastResponse, used_tools: executedTools.slice() };
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