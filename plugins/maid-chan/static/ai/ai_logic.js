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

  // Compute flow_id per weakly-connected component so that each
  // disconnected branch becomes its own flow. This is kept lightweight
  // and only affects the in-memory graph used by AILogic; the editor
  // persists flow ids separately.
  function normalizeFlows(graph){
    if(!graph || !Array.isArray(graph.nodes)) return graph || { nodes: [], edges: [] };
    const nodes = graph.nodes;
    const edges = Array.isArray(graph.edges) ? graph.edges : [];

    const nodeIds = nodes.map(n=>n && n.id).filter(id=>id!==undefined && id!==null);
    const adj = new Map();
    for(const id of nodeIds){ adj.set(id, new Set()); }

    for(const e of edges){
      if(!e) continue;
      const a = e.fromNodeId;
      const b = e.toNodeId;
      if(!adj.has(a) || !adj.has(b)) continue;
      adj.get(a).add(b);
      adj.get(b).add(a);
    }

    const visited = new Set();
    let nextFlowId = 0;
    for(const id of nodeIds){
      if(visited.has(id)) continue;
      const stack = [id];
      const comp = [];
      visited.add(id);
      while(stack.length){
        const v = stack.pop();
        comp.push(v);
        const nbrs = adj.get(v) || [];
        for(const nId of nbrs){
          if(!visited.has(nId)){
            visited.add(nId);
            stack.push(nId);
          }
        }
      }
      for(const nid of comp){
        const n = nodes.find(x=>x && x.id === nid);
        if(n){ n.flow_id = nextFlowId; }
      }
      nextFlowId += 1;
    }
    return graph;
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

  async function execute({ text = '', context = {}, history = [], signal, graph: providedGraph, runId, presetId, startNodeId } = {}){
    if(!isEnabled()) return null;
    const rawGraph = providedGraph || loadGraph();
    const graph = normalizeFlows(rawGraph);
    if(!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0){
      return null;
    }

    // Build basic maps used by routing logic
    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const results = new Map();

    // Determine target flow
    let targetFlowId = 0;
    if (startNodeId && nodeById.has(startNodeId)) {
        targetFlowId = nodeById.get(startNodeId).flow_id || 0;
    }

    // Filter nodes by flow_id
    const flowNodes = graph.nodes.filter(n => (n.flow_id !== undefined ? n.flow_id : 0) === targetFlowId);
    const flowNodeIds = new Set(flowNodes.map(n => n.id));
    
    // Create a subgraph for topological sort
    const subGraph = {
        nodes: flowNodes,
        edges: (graph.edges || []).filter(e => flowNodeIds.has(e.fromNodeId) && flowNodeIds.has(e.toNodeId))
    };

    // If a startNodeId is provided, restrict execution to the subgraph that
    // is reachable from that node ("play" semantics). Otherwise fall back
    // to running the entire graph as before.
    let sortedIds;
    if(startNodeId && nodeById.has(startNodeId)){
      // Collect downstream nodes from the start and all ancestors of any
      // of those downstream nodes. This ensures dependencies of nodes
      // we plan to run (e.g. prompts/settings) are included even if they
      // are not ancestors of the start node itself.
      const forwardAdj = new Map();
      const reverseAdj = new Map();
      for(const e of subGraph.edges){
        if(!forwardAdj.has(e.fromNodeId)) forwardAdj.set(e.fromNodeId, new Set());
        forwardAdj.get(e.fromNodeId).add(e.toNodeId);
        if(!reverseAdj.has(e.toNodeId)) reverseAdj.set(e.toNodeId, new Set());
        reverseAdj.get(e.toNodeId).add(e.fromNodeId);
      }
      const downstream = new Set();
      // Forward DFS from start
      (function collectDown(start){
        const stack = [start];
        while(stack.length){
          const id = stack.pop();
          if(downstream.has(id)) continue;
          downstream.add(id);
          const nexts = forwardAdj.get(id) || [];
          for(const nid of nexts){ stack.push(nid); }
        }
      })(startNodeId);

      // Collect ancestors for every downstream node
      const ancestors = new Set();
      const collectUp = (node)=>{
        const stack = [node];
        while(stack.length){
          const id = stack.pop();
          if(ancestors.has(id)) continue;
          ancestors.add(id);
          const prevs = reverseAdj.get(id) || [];
          for(const pid of prevs){ stack.push(pid); }
        }
      };
      for(const d of downstream){ collectUp(d); }

      const needed = new Set([...downstream, ...ancestors]);
      const allSorted = getSortedNodes(subGraph);
      sortedIds = allSorted.filter(id => needed.has(id));
    } else {
      sortedIds = getSortedNodes(subGraph);
    }

    if(!sortedIds || sortedIds.length === 0){
      return null;
    }

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
              let value = sourceRes[outPortId];
                
              // Check for branching logic
              const srcDef = window.MaidChanNodeDefs && window.MaidChanNodeDefs[srcNode.type];
              const outPortDef = srcDef && srcDef.ports && srcDef.ports.outputs && srcDef.ports.outputs[edge.fromPort];
                
              if(outPortDef && (outPortDef.branching === true || outPortDef.type === 'branching')){
                const outgoing = (graph.edges || []).filter(e => e.fromNodeId === edge.fromNodeId && e.fromPort === edge.fromPort);
                outgoing.sort((a,b) => String(a.id).localeCompare(String(b.id)));
                const myIndex = outgoing.findIndex(e => e.id === edge.id);
                    
                if(value && typeof value === 'object' && '__branchIndex' in value){
                  if(value.__branchIndex === myIndex){
                    // For trigger-only flows, downstream nodes don't use the payload itself.
                    // We still normalize to the inner value (typically boolean true).
                    value = value.value;
                  } else {
                    value = undefined; 
                  }
                }
              }

              if (!inputs[inPortId]) inputs[inPortId] = [];
              if (value !== undefined) {
                inputs[inPortId].push(value);
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
  async function runFromStage({ startStage = 1, text = '', context = {}, history = [], signal, graph: providedGraph, runId, presetId, nodeId } = {}){
    // Stage semantics are currently UI-level only. For execution we
    // interpret a run-stage request as "run from this node forward" if
    // a nodeId is provided, otherwise fall back to full-graph execution.
    return execute({ text, context, history, signal, graph: providedGraph, runId, presetId, startNodeId: nodeId });
  }

  // Listen for UI play requests
  window.addEventListener('maid-chan:logic:run-stage', (ev)=>{
    const d = (ev && ev.detail) || {};
    const startStage = d.stage || 1;
    const runId = d.runId;
    const presetId = d.presetId;
    const graph = d.graph || null;
    const nodeId = d.nodeId || d.startNodeId || null;
    // Support passing text and history from event detail so chat panel can trigger per-flow runs.
    const text = typeof d.text === 'string' ? d.text : '';
    const history = Array.isArray(d.history) ? d.history : [];
    // Build context from event detail: allow userMessageId / assistantMessageId or an explicit context object
    const context = Object.assign({}, (d.context && typeof d.context === 'object') ? d.context : {});
    if(d.userMessageId) context.userMessageId = d.userMessageId;
    if(d.assistantMessageId) context.assistantMessageId = d.assistantMessageId;
    runFromStage({ startStage, runId, presetId, graph, nodeId, text, history, context }).catch(()=>{});
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
    
    const targetFlowId = targetNode.flow_id !== undefined ? targetNode.flow_id : 0;

    const getIncomingEdges = (nid)=>{
      const list = (graph.edges||[]).filter(e => e && e.toNodeId === nid);
      // Filter out edges from different flows
      const filtered = list.filter(e => {
          const src = nodeById.get(e.fromNodeId);
          return src && (src.flow_id !== undefined ? src.flow_id : 0) === targetFlowId;
      });
      filtered.sort((a,b)=>{
        const ia = Number.isFinite(a.index)? a.index : Infinity;
        const ib = Number.isFinite(b.index)? b.index : Infinity;
        if(ia !== ib) return ia - ib;
        return String(a.id).localeCompare(String(b.id));
      });
      return filtered;
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
            let val = srcRes[outPort.id];
            
            // Branching logic
            if(outPort.branching === true || outPort.type === 'branching'){
                const outgoing = (graph.edges || []).filter(ed => ed.fromNodeId === e.fromNodeId && ed.fromPort === e.fromPort);
                outgoing.sort((a,b) => String(a.id).localeCompare(String(b.id)));
                const myIndex = outgoing.findIndex(ed => ed.id === e.id);
                if(val && typeof val === 'object' && '__branchIndex' in val){
                    if(val.__branchIndex === myIndex) val = val.value;
                    else val = undefined;
                }
            }

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
                let val = srcRes[outPort.id];
                
                // Branching logic
                if(outPort.branching === true || outPort.type === 'branching'){
                    const outgoing = (graph.edges || []).filter(ed => ed.fromNodeId === e.fromNodeId && ed.fromPort === e.fromPort);
                    outgoing.sort((a,b) => String(a.id).localeCompare(String(b.id)));
                    const myIndex = outgoing.findIndex(ed => ed.id === e.id);
                    if(val && typeof val === 'object' && '__branchIndex' in val){
                        if(val.__branchIndex === myIndex) val = val.value;
                        else val = undefined;
                    }
                }

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
