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


  // Generic Topological Sort
  function getSortedNodes(graph) {
    if (!graph || !Array.isArray(graph.nodes)) return [];
    const nodes = graph.nodes;
    const edges = graph.edges || [];
    
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adj = new Map(nodes.map(n => [n.id, []]));

    for (const edge of edges) {
        if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) continue;
        if (!adj.has(edge.fromNodeId)) adj.set(edge.fromNodeId, []);
        adj.get(edge.fromNodeId).push(edge.toNodeId);
        inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
        const u = queue.shift();
        sorted.push(u);
        const neighbors = adj.get(u) || [];
        for (const v of neighbors) {
            inDegree.set(v, inDegree.get(v) - 1);
            if (inDegree.get(v) === 0) queue.push(v);
        }
    }
    return sorted;
  }

  async function execute({ text = '', context = {}, history = [], signal, graph: providedGraph, runId, presetId } = {}){
    if(!isEnabled()) return null;
    const graph = providedGraph || loadGraph();
    if(!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0){
      return null;
    }

    const sortedIds = getSortedNodes(graph);
    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const results = new Map();

    // Helper to get port definition ID
    const getPortId = (nodeType, portIndex, isInput) => {
        const def = window.MaidChanNodeDefs && window.MaidChanNodeDefs[nodeType];
        if (!def) return null;
        const ports = isInput ? def.ports.inputs : def.ports.outputs;
        return ports && ports[portIndex] ? ports[portIndex].id : null;
    };

    let lastResponse = null;

    for (const nodeId of sortedIds) {
        if (signal && signal.aborted) break;
        const node = nodeById.get(nodeId);
        const def = window.MaidChanNodeDefs && window.MaidChanNodeDefs[node.type];
        if (!def) continue;

        // 1. Gather Inputs Generic
        const inputs = {};
        const incomingEdges = (graph.edges || []).filter(e => e.toNodeId === nodeId);
        
        // Sort edges by index to ensure inputs are processed in visual order
        incomingEdges.sort((a, b) => {
            const ia = Number.isFinite(a.index) ? a.index : Infinity;
            const ib = Number.isFinite(b.index) ? b.index : Infinity;
            if (ia !== ib) return ia - ib;
            return String(a.id).localeCompare(String(b.id));
        });

        for (const edge of incomingEdges) {
            const sourceRes = results.get(edge.fromNodeId);
            if (!sourceRes) continue;

            const srcNode = nodeById.get(edge.fromNodeId);
            const outPortId = getPortId(srcNode.type, edge.fromPort, false);
            const inPortId = getPortId(node.type, edge.toPort, true);

            if (outPortId && inPortId) {
                if (!inputs[inPortId]) inputs[inPortId] = [];
                if (sourceRes[outPortId] !== undefined) {
                    inputs[inPortId].push(sourceRes[outPortId]);
                }
            }
        }

        // 2. Execute
        const ctx = {
            node,
            inputs,
            text,
            context,
            history,
            signal
        };

        try {
            // Generic Gating
            if (typeof def.shouldRun === 'function') {
                if (!def.shouldRun(ctx)) continue;
            }

            // Dispatch node start event
            window.dispatchEvent(new CustomEvent('maid-chan:logic:node:start', { 
                detail: { nodeId, runId } 
            }));

            const output = await def.execute(ctx);
            results.set(nodeId, output || {});

            // Capture last response for legacy return
            if (output && output.response_message) {
                lastResponse = output.response_message;
            }

            // Dispatch preview update
            window.dispatchEvent(new CustomEvent('maid-chan:preview:update', { 
                detail: { nodeId, ...output } 
            }));

            // Dispatch node end event
            window.dispatchEvent(new CustomEvent('maid-chan:logic:node:end', { 
                detail: { nodeId, runId, output } 
            }));

        } catch (err) {
            console.error(`Node ${node.type} (${nodeId}) execution failed:`, err);
            // Dispatch node end event even on error to clear glow
            window.dispatchEvent(new CustomEvent('maid-chan:logic:node:end', { 
                detail: { nodeId, runId, error: err } 
            }));
        }
    }

    window.dispatchEvent(new CustomEvent('maid-chan:logic:run:done', { detail: { runId, presetId } }));
    return { __maidLogicHandled: true, response: lastResponse };
  }

  // Stage runner: run from a given stage to the end, emitting begin/done per stage
  async function runFromStage({ startStage = 1, text = '', context = {}, history = [], signal, graph: providedGraph, runId, presetId } = {}){
    // Just delegate to generic execute
    return execute({ text, context, history, signal, graph: providedGraph, runId, presetId });
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
    execute,
    gatherInputs
  };

  // Helper to gather inputs for a specific node by executing its dependencies
  async function gatherInputs(nodeId){
    const graph = loadGraph();
    if(!graph || !Array.isArray(graph.nodes)) return {};
    
    const nodeById = new Map();
    for(const n of graph.nodes){ if(n && n.id) nodeById.set(n.id, n); }
    
    const targetNode = nodeById.get(nodeId);
    if(!targetNode) return {};

    const results = new Map();
    
    const getIncomingEdges = (nid)=>{
      const list = (graph.edges||[]).filter(e => e && e.toNodeId === nid);
      list.sort((a,b)=>{
        const ia = Number.isFinite(a.index)? a.index : Infinity;
        const ib = Number.isFinite(b.index)? b.index : Infinity;
        if(ia !== ib) return ia - ib;
        return String(a.id).localeCompare(String(b.id));
      });
      return list;
    };

    const executeDependency = async (nid, visited = new Set()) => {
      if(results.has(nid)) return results.get(nid);
      if(visited.has(nid)) return null; // Cycle
      visited.add(nid);

      const node = nodeById.get(nid);
      if(!node) return null;

      // Skip process nodes (LLM, Tools execution) in dependency chain?
      // Usually we only want to execute Input nodes.
      // If an LLM node depends on another LLM node, we probably can't easily preview it without running the full chain.
      // For now, let's assume we only execute non-process nodes or nodes that have 'execute' but are not 'LLM'.
      // Actually, 'Tools loader' is an input node but has side effects? No, it just returns definitions.
      
      const def = window.MaidChanNodeDefs && window.MaidChanNodeDefs[node.type];
      if(!def || typeof def.execute !== 'function') return null;
      
      // If it's an LLM node, we might stop here and return null/empty because we don't want to trigger LLM calls during preview.
      if(node.type === 'LLM' || node.type === 'Tools execution') return null;

      const inputs = {};
      const incoming = getIncomingEdges(nid);
      for(const e of incoming){
        const srcRes = await executeDependency(e.fromNodeId, visited);
        if(srcRes){
          const srcNode = nodeById.get(e.fromNodeId);
          const srcDef = window.MaidChanNodeDefs && window.MaidChanNodeDefs[srcNode.type];
          if(!srcDef) continue;
          const outPort = (srcDef.ports.outputs || [])[e.fromPort];
          const inPort = (def.ports.inputs || [])[e.toPort];
          if(outPort && inPort){
            const val = srcRes[outPort.id];
            if(val !== undefined){
              if(!inputs[inPort.id]) inputs[inPort.id] = [];
              inputs[inPort.id].push(val);
            }
          }
        }
      }

      const ctx = { node, inputs, text: '', context: {}, history: [], signal: null };
      try{
        const res = await def.execute(ctx);
        results.set(nid, res);
        return res;
      }catch(_e){ return null; }
    };

    // Gather inputs for the target node
    const inputs = {};
    const incoming = getIncomingEdges(nodeId);
    for(const e of incoming){
        const srcRes = await executeDependency(e.fromNodeId);
        if(srcRes){
            const srcNode = nodeById.get(e.fromNodeId);
            const srcDef = window.MaidChanNodeDefs && window.MaidChanNodeDefs[srcNode.type];
            if(!srcDef) continue;
            const outPort = (srcDef.ports.outputs || [])[e.fromPort];
            const inPort = (window.MaidChanNodeDefs[targetNode.type].ports.inputs || [])[e.toPort];
            if(outPort && inPort){
                const val = srcRes[outPort.id];
                if(val !== undefined){
                    if(!inputs[inPort.id]) inputs[inPort.id] = [];
                    inputs[inPort.id].push(val);
                }
            }
        }
    }
    return inputs;
  }
})();
