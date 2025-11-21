(function(){
  // Maid-chan Logic UI (node-based workflow editor)
  // Fullscreen modal with draggable nodes; persists graph to localStorage.

  const GRAPH_KEY = 'maid-chan:logic:graph';
  const FEATURE_ID = 'logic_ui';

  // Node sizing constraints
  const NODE_MIN_W = 220;
  const NODE_MAX_W = 520; // Prevent overly wide nodes when long content loads
  const NODE_MIN_H = 120;

  // Node definitions are provided by files under static/node/*.js

  // Node definition access
  function getNodeDef(type){
    const defs = window.MaidChanNodeDefs || {};
    return defs[type];
  }
  function getPortConfig(type){
    const def = getNodeDef(type);
    return def && def.ports ? def.ports : { inputs: [], outputs: [] };
  }
  function getDefaultNodeData(type){
    const def = getNodeDef(type);
    if(def && typeof def.defaultData === 'function') return def.defaultData();
    return {};
  }
  function defaultPersonaKey(type){
    const def = getNodeDef(type);
    return def && def.personaKey ? def.personaKey : null;
  }

  function loadGraph(){
    try{
      const raw = window.localStorage.getItem(GRAPH_KEY);
      if(!raw) return null;
      const g = JSON.parse(raw);
      
      // Legacy migrations
      if(g && Array.isArray(g.edges)){
        for(let i=0;i<g.edges.length;i++){
          const e = g.edges[i];
          if(e && typeof e.from === 'string' && typeof e.to === 'string' && (e.fromNodeId == null || e.toNodeId == null)){
            g.edges[i] = {
              id: e.id || ('e' + Math.random().toString(36).slice(2,9)),
              fromNodeId: e.from,
              fromPort: 0,
              toNodeId: e.to,
              toPort: 0
            };
          }
        }
      }
      if(g && Array.isArray(g.nodes)){
        for(const n of g.nodes){
          if(!n || !n.type) continue;
          if(n.type === 'Tools Control') n.type = 'Tools loader';
          if(n.type === 'LLM settings') n.type = 'LLM loader';
        }
      }

      migrateGraph(g);
      return g;
    }catch(_e){ return null; }
  }

  function saveGraph(g){
    try{ window.localStorage.setItem(GRAPH_KEY, JSON.stringify(g||{nodes:[],edges:[]})); }catch(_e){/* ignore */}
  }

  function ensureDefaultGraph(){
    let g = loadGraph();
    if(g && Array.isArray(g.nodes) && g.nodes.length) return g;
    // Create a minimal default: Persona -> LLM -> Save + Send to chat UI
    g = {
      nodes: [
        { id:1, flow_id:0, type:'Maid Persona', x:80, y:120, data:getDefaultNodeData('Maid Persona') },
        { id:2, flow_id:0, type:'User Persona', x:80, y:260, data:getDefaultNodeData('User Persona') },
        { id:3, flow_id:0, type:'Chat Samples', x:80, y:400, data:getDefaultNodeData('Chat Samples') },
        { id:4, flow_id:0, type:'Custom Prompt', x:80, y:40, data:getDefaultNodeData('Custom Prompt') },
        { id:5, flow_id:0, type:'LLM', x:360, y:220, data:getDefaultNodeData('LLM') },
        { id:6, flow_id:0, type:'Tools loader', x:360, y:360, data:getDefaultNodeData('Tools loader') },
        { id:7, flow_id:0, type:'Save history', x:660, y:200, data:getDefaultNodeData('Save history') },
        { id:8, flow_id:0, type:'Send to chat UI', x:660, y:300, data:getDefaultNodeData('Send to chat UI') }
      ],
      edges: [
        // New mapping: Maid/User/Custom -> Prompt input (port 0), Chat Samples -> History (port 1), Tools Control -> Tools control (port 2)
        { id:1, fromNodeId:1, fromPort:0, toNodeId:5, toPort:0 },
        { id:2, fromNodeId:2, fromPort:0, toNodeId:5, toPort:0 },
        { id:3, fromNodeId:4, fromPort:0, toNodeId:5, toPort:0 },
        { id:4, fromNodeId:3, fromPort:0, toNodeId:5, toPort:1 },
        { id:5, fromNodeId:6, fromPort:0, toNodeId:5, toPort:2 },
        { id:6, fromNodeId:5, fromPort:0, toNodeId:7, toPort:0 },
        { id:7, fromNodeId:5, fromPort:0, toNodeId:8, toPort:0 }
      ]
    };
    saveGraph(g);
    return g;
  }

  // Styles are now in maid_chan.css (no inline injection)

  function getNextId(list) {
    let max = 0;
    for (const item of list) {
      if (item && typeof item.id === 'number') {
        if (item.id > max) max = item.id;
      }
    }
    return max + 1;
  }

  function migrateGraph(g) {
    if (!g || typeof g !== 'object') return;
    if (!Array.isArray(g.nodes)) g.nodes = [];
    if (!Array.isArray(g.edges)) g.edges = [];

    // Build a map of *normalized* node ids without changing them yet
    // This lets us handle cases like fromNodeId: "1" while node.id is number 1.
    const idMap = new Map(); // key: original id (string or number) -> canonical numeric id
    let maxNodeId = 0;
    for (const n of g.nodes) {
      if (!n) continue;
      const rawId = n.id;
      let numId = null;
      if (typeof rawId === 'number' && Number.isFinite(rawId)) {
        numId = rawId;
      } else if (typeof rawId === 'string' && rawId.trim() !== '') {
        const parsed = Number(rawId);
        if (Number.isFinite(parsed)) numId = parsed;
      }
      if (numId == null || !Number.isFinite(numId)) {
        // Assign a fresh id later
        continue;
      }
      if (numId > maxNodeId) maxNodeId = numId;
      idMap.set(rawId, numId);
    }

    // Second pass: ensure every node has a numeric id and flow_id.
    // flow_id is preserved if present; it can be assigned/overridden
    // by the runtime logic (AILogic.normalizeFlows) on load so that
    // each disconnected branch forms its own flow, but we never drop
    // or reassign it here to avoid fighting the execution layer.
    for (const n of g.nodes) {
      if (!n) continue;
      const rawId = n.id;
      let numId = idMap.get(rawId);
      if (numId == null) {
        maxNodeId += 1;
        numId = maxNodeId;
        idMap.set(rawId, numId);
      }
      n.id = numId;
      if (n.flow_id === undefined) {
        n.flow_id = 0;
      }
    }

    // Normalize edges but NEVER drop them when migrating old data
    const validEdges = [];
    let maxEdgeId = 0;
    for (const e of g.edges) {
      if (!e) continue;
      // Preserve original refs but normalize if possible
      const fromKey = e.fromNodeId;
      const toKey = e.toNodeId;
      const mappedFrom = idMap.has(fromKey) ? idMap.get(fromKey) : fromKey;
      const mappedTo = idMap.has(toKey) ? idMap.get(toKey) : toKey;
      e.fromNodeId = mappedFrom;
      e.toNodeId = mappedTo;

      // Edge id normalization (best‑effort, non‑destructive)
      if (typeof e.id === 'number' && Number.isFinite(e.id)) {
        if (e.id > maxEdgeId) maxEdgeId = e.id;
      } else if (typeof e.id === 'string') {
        const parsed = Number(e.id);
        if (Number.isFinite(parsed)) {
          e.id = parsed;
          if (e.id > maxEdgeId) maxEdgeId = e.id;
        } else {
          maxEdgeId += 1;
          e.id = maxEdgeId;
        }
      } else {
        maxEdgeId += 1;
        e.id = maxEdgeId;
      }
      validEdges.push(e);
    }
    g.edges = validEdges;
  }

  // Assign flow_id so that each weakly-connected component (branch)
  // forms its own flow. This is applied on the editor side whenever
  // the graph is created or mutated, so presets persist sensible
  // per-branch flow ids instead of lumping everything into 0.
  function assignFlowsPerBranch(g){
    if(!g || !Array.isArray(g.nodes)) return;
    const nodes = g.nodes;
    const edges = Array.isArray(g.edges) ? g.edges : [];
    const nodeIds = nodes.map(n=>n && n.id).filter(id=>id!==undefined && id!==null);
    if(!nodeIds.length) return;

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
        for(const nid of nbrs){
          if(!visited.has(nid)){
            visited.add(nid);
            stack.push(nid);
          }
        }
      }
      for(const nid of comp){
        const n = nodes.find(x=>x && x.id === nid);
        if(n){ n.flow_id = nextFlowId; }
      }
      nextFlowId += 1;
    }
  }

  function drawEdges(svg, nodesPortMap, graph, onRemove, onReindex){
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    const ns = 'http://www.w3.org/2000/svg';
    // Use transformed client rects and inverse current scale to recover logical coords.
    // This keeps edge endpoints centered even with nested port layout.
    const pr = svg.parentElement.getBoundingClientRect();
    const currentScale = window.__MaidLogicScale || 1;
    // Remove existing edge buttons before re-render
    const overlay = svg.parentElement;
    const oldButtons = overlay.querySelectorAll('[data-edge-button]');
    oldButtons.forEach(b => b.remove());
    
    // Build group map for incoming edges sharing the same input port
    const groups = new Map(); // key: `${toNodeId}:${toPort}` -> { list: Edge[] }
    // Build group map for outgoing edges sharing the same output port (for branching)
    const outgoingGroups = new Map(); // key: `${fromNodeId}:${fromPort}` -> { list: Edge[] }

    const edges = (graph && Array.isArray(graph.edges)) ? graph.edges : [];
    for(const e of edges){
      if(!e) continue;
      // Incoming groups
      const key = `${e.toNodeId}:${e.toPort||0}`;
      let g = groups.get(key); if(!g){ g = { list: [] }; groups.set(key, g); }
      g.list.push(e);
      
      // Outgoing groups
      const outKey = `${e.fromNodeId}:${e.fromPort||0}`;
      let og = outgoingGroups.get(outKey); if(!og){ og = { list: [] }; outgoingGroups.set(outKey, og); }
      og.list.push(e);
    }
    
    // Ensure indices 1..N in each incoming group (stable by existing index then id)
    for(const [,g] of groups){
      g.list.sort((a,b)=>{
        const ia = Number.isFinite(a.index)? a.index : Infinity;
        const ib = Number.isFinite(b.index)? b.index : Infinity;
        if(ia !== ib) return ia - ib;
        return String(a.id).localeCompare(String(b.id));
      });
      g.list.forEach((e, i)=>{ e.index = i+1; });
    }

    // Ensure indices 0..N in each outgoing group (stable by ID)
    for(const [,g] of outgoingGroups){
      g.list.sort((a,b)=> String(a.id).localeCompare(String(b.id)));
      g.list.forEach((e, i)=>{ e._branchIndex = i; });
    }

    // Helpers to get node and category
    const nodeById = new Map();
    for(const n of (graph.nodes||[])){ if(n && n.id) nodeById.set(n.id, n); }
    function nodeCat(node){
      const def = node && getNodeDef(node.type);
      return def && def.category || 'unknown';
    }
    // Helper to check if output port is branching
    function isBranchingPort(node, portIndex){
        const def = node && getNodeDef(node.type);
        if(!def || !def.ports || !def.ports.outputs) return false;
        const p = def.ports.outputs[portIndex];
        return p && (p.branching === true || p.type === 'branching');
    }

    for(const e of edges){
      if(!e) continue;
      const fromKey = `${e.fromNodeId}:out:${e.fromPort||0}`;
      const toKey = `${e.toNodeId}:in:${e.toPort||0}`;
      const a = nodesPortMap.get(fromKey);
      const b = nodesPortMap.get(toKey);
      if(!a || !b) continue;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      // Convert back to logical (unscaled) space.
      const x1 = (ar.left - pr.left + ar.width/2) / currentScale;
      const y1 = (ar.top - pr.top + ar.height/2) / currentScale;
      const x2 = (br.left - pr.left + br.width/2) / currentScale;
      const y2 = (br.top - pr.top + br.height/2) / currentScale;
      const path = document.createElementNS(ns,'path');
      const mx = (x1 + x2)/2;
      const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      path.setAttribute('d', d);
      
      // Color based on connection types
      const fromNode = nodeById.get(e.fromNodeId);
      const toNode = nodeById.get(e.toNodeId);
      const fromType = nodeCat(fromNode);
      const toType = nodeCat(toNode);
      let stroke = '#6d7ab4';
      let opacity = '0.85';
      
      const isBranching = isBranchingPort(fromNode, e.fromPort||0);

      if(isBranching){
          stroke = '#ffd700'; // Fallback if class not applied or overridden
          path.classList.add('mc-edge-branch');
      } else if(fromType === 'process' && toType === 'process'){ stroke = '#ff6fa9'; opacity = '0.95'; }
      else if(fromType === 'input' && toType === 'process'){ stroke = '#34c759'; opacity = '0.5'; }
      else if(fromType === 'process' && toType === 'output'){ stroke = '#6d7ab4'; opacity = '0.6'; }
      else if(fromType === 'input' && toType === 'output'){ stroke = '#8b8e9c'; opacity = '0.5'; }
      
      if(!isBranching){
          path.setAttribute('stroke', stroke);
          path.setAttribute('stroke-opacity', opacity);
      }
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('data-edge-id', e.id);
      svg.appendChild(path);

      // Draw branch index label if branching
      if(isBranching && Number.isFinite(e._branchIndex)){
          // Position near the end (target node), slightly offset along the curve
          // Cubic Bezier: B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
          // P0=(x1,y1), P1=(mx,y1), P2=(mx,y2), P3=(x2,y2)
          const t = 0.9; // 90% along the curve
          const mt = 1-t;
          const mt2 = mt*mt;
          const mt3 = mt2*mt;
          const t2 = t*t;
          const t3 = t2*t;

          const lx = mt3*x1 + 3*mt2*t*mx + 3*mt*t2*mx + t3*x2;
          const ly = mt3*y1 + 3*mt2*t*y1 + 3*mt*t2*y2 + t3*y2;
          
          const bg = document.createElementNS(ns, 'circle');
          bg.setAttribute('cx', lx);
          bg.setAttribute('cy', ly);
          bg.setAttribute('r', '7');
          bg.setAttribute('class', 'mc-edge-branch-bg');
          svg.appendChild(bg);

          const txt = document.createElementNS(ns, 'text');
          txt.setAttribute('x', lx);
          txt.setAttribute('y', ly);
          txt.setAttribute('class', 'mc-edge-branch-label');
          txt.textContent = String(e._branchIndex + 1); // 1-based for display
          svg.appendChild(txt);
      }

      // Add center delete button overlay
      const cx = (x1 + x2)/2;
      const cy = (y1 + y2)/2;
      // Priority/index button (appears when multiple edges feed the same input port)
      const gKey = `${e.toNodeId}:${e.toPort||0}`;
      const g = groups.get(gKey);
      if(g && g.list.length > 1){
        const idxBtn = document.createElement('button');
        idxBtn.className = 'mc-edge-btn';
        idxBtn.type = 'button';
        idxBtn.style.left = `${(cx - 36)}px`; // to the left of delete (base coords)
        idxBtn.style.top = `${(cy - 10)}px`;
        idxBtn.textContent = String(Number.isFinite(e.index)? e.index : '1');
        idxBtn.title = 'Edge priority index';
        idxBtn.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          // Simple chooser: small inline menu with options 1..N
          const menu = document.createElement('div');
          menu.className = 'mc-edge-index-menu';
          menu.style.position = 'absolute';
          menu.style.left = `${(cx - 36)}px`;
          menu.style.top = `${(cy + 14)}px`;
          menu.style.zIndex = '10';
          menu.style.background = '#1f2130';
          menu.style.border = '1px solid #3a3b44';
          menu.style.borderRadius = '8px';
          menu.style.padding = '4px';
          for(let i=1;i<=g.list.length;i++){
            const opt = document.createElement('button');
            opt.type='button';
            opt.className='mc-edge-index-option';
            opt.textContent = String(i);
            opt.style.minWidth='28px';
            opt.style.height='24px';
            opt.style.margin='2px';
            opt.addEventListener('click', (e2)=>{
              e2.stopPropagation();
              if(typeof onReindex === 'function') onReindex(e.id, i);
              menu.remove();
            });
            menu.appendChild(opt);
          }
          // Click-away to dismiss
          const off = (e3)=>{ if(!menu.contains(e3.target)){ menu.remove(); document.removeEventListener('mousedown', off); } };
          setTimeout(()=>{ document.addEventListener('mousedown', off); },0);
          overlay.appendChild(menu);
        });
        overlay.appendChild(idxBtn);
        idxBtn.setAttribute('data-edge-button', e.id);
      }
      const btn = document.createElement('button');
      btn.className = 'mc-edge-btn';
      btn.type = 'button';
      btn.style.left = `${(cx - 10)}px`;
      btn.style.top = `${(cy - 10)}px`;
      btn.innerHTML = '<span class="material-symbols-outlined">close</span>';
      btn.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        if(typeof onRemove === 'function') onRemove(e.id);
      });
      overlay.appendChild(btn);
      // Reattach button to overlay group reference for cleanup on redraw: tag it
      btn.setAttribute('data-edge-button', e.id);
    }
    // No need to clean orphans since we removed all before drawing
  }

  function createNodeEl(node, canvas, onMove, onDataChange, onResetNode, onDeleteNode, onStartConnect, onRunStage){
    const el = document.createElement('div'); el.className = 'mc-node'; el.style.left = (node.x||0)+'px'; el.style.top = (node.y||0)+'px'; el.dataset.id = node.id;
    // Apply visual clamps and defaults
    el.style.boxSizing = 'border-box';
    el.style.maxWidth = NODE_MAX_W + 'px';
    el.style.minWidth = NODE_MIN_W + 'px';
    el.style.minHeight = NODE_MIN_H + 'px';
    if(Number.isFinite(node.w)) el.style.width = Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, node.w|0)) + 'px';
    if(Number.isFinite(node.h)) el.style.height = Math.max(NODE_MIN_H, node.h|0) + 'px';
    const header = document.createElement('div'); header.className = 'mc-node-header';
    const title = document.createElement('span'); title.textContent = node.type; header.appendChild(title);
    const stage = document.createElement('span'); stage.className = 'mc-node-stage'; stage.textContent = ''; header.appendChild(stage);
    const actions = document.createElement('div'); actions.className = 'mc-node-actions';

    // Check if process node to add Play button
    const def = getNodeDef(node.type);
    const isProcess = (def && def.category === 'process') || (node.type === 'Tools loader' && node.data && node.data.execute === true);
      if(isProcess){
        const playBtn = document.createElement('button'); playBtn.type='button'; playBtn.className='mc-icon-btn'; playBtn.innerHTML='<span class="material-symbols-outlined">play_arrow</span>';
        playBtn.title = 'Run from this stage';
        playBtn.addEventListener('mousedown', (e)=> e.stopPropagation(), { capture: true });
        playBtn.addEventListener('click', (e)=>{
          e.stopPropagation();
          if(typeof onRunStage === 'function'){
            onRunStage(node);
          }
        });
        actions.appendChild(playBtn);
      }
    function runStageForNode(node){
      try{
        const nodeId = node && node.id;
        const s = currentStageMap && nodeId ? (currentStageMap.get(nodeId) || 1) : 1;
        window.dispatchEvent(new CustomEvent('maid-chan:logic:run-stage',{
          detail:{
            stage: s,
            nodeId,
            presetId: activePresetId,
            graph
          }
        }));
      }catch(_e){}
    }

    // Duplicate button: clone this node (with current data) near original
    const duplicateBtn = document.createElement('button'); duplicateBtn.type='button'; duplicateBtn.className='mc-icon-btn'; duplicateBtn.innerHTML='<span class="material-symbols-outlined">tab_duplicate</span>';
    const replayBtn = document.createElement('button'); replayBtn.type='button'; replayBtn.className='mc-icon-btn'; replayBtn.innerHTML='<span class="material-symbols-outlined">replay</span>';
    const closeBtn = document.createElement('button'); closeBtn.type='button'; closeBtn.className='mc-icon-btn'; closeBtn.innerHTML='<span class="material-symbols-outlined">close</span>';
    // Avoid bring-to-front/drag swallowing first click on buttons
    [duplicateBtn, replayBtn, closeBtn].forEach(btn=>{
      btn.addEventListener('mousedown', (e)=> e.stopPropagation(), { capture: true });
      btn.addEventListener('click', (e)=> e.stopPropagation());
    });
    actions.appendChild(duplicateBtn);
    actions.appendChild(replayBtn);
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    const body = document.createElement('div'); body.className = 'mc-node-body';
    // Ensure long content wraps and scrolls instead of expanding width
    body.style.overflow = 'auto';
    body.style.wordBreak = 'break-word';
    // Build config via node definition
    if(def && typeof def.buildConfigUI === 'function'){
      def.buildConfigUI(body, node, { onDataChange });
    } else {
      const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent = 'No settings'; body.appendChild(hint);
    }

    el.appendChild(header); el.appendChild(body);

    // Ports section below body: two columns Input | Output with multiple rows
    const ports = getPortConfig(node.type);
    const portsWrap = document.createElement('div'); portsWrap.className = 'mc-node-ports';
    const maxRows = Math.max((ports.inputs||[]).length, (ports.outputs||[]).length, 1);
    for(let i=0; i<maxRows; i++){
      const row = document.createElement('div'); row.className = 'mc-node-port-row';
      // Input column
      const inCol = document.createElement('div'); inCol.className = 'mc-node-port-col mc-node-port-col-in';
      if(ports.inputs && ports.inputs[i]){
        const meta = ports.inputs[i];
        const dot = document.createElement('div'); dot.className = 'mc-port mc-port-in'; dot.title = meta.label || 'Input';
        dot.dataset.nodeId = node.id; dot.dataset.direction = 'in'; dot.dataset.port = String(i);
        const lab = document.createElement('span'); lab.className = 'mc-port-label'; lab.textContent = meta.label || 'Input';
        inCol.appendChild(dot); inCol.appendChild(lab);
        dot.addEventListener('mousedown', (ev)=>{ ev.stopPropagation(); onStartConnect({ nodeId: node.id, direction:'in', port: i }, ev); });
      } else {
        const spacer = document.createElement('div'); spacer.className = 'mc-port-spacer'; inCol.appendChild(spacer);
      }
      // Output column
      const outCol = document.createElement('div'); outCol.className = 'mc-node-port-col mc-node-port-col-out';
      if(ports.outputs && ports.outputs[i]){
        const meta = ports.outputs[i];
        const lab = document.createElement('span'); lab.className = 'mc-port-label'; lab.textContent = meta.label || 'Output';
        const dot = document.createElement('div'); dot.className = 'mc-port mc-port-out'; dot.title = meta.label || 'Output';
        dot.dataset.nodeId = node.id; dot.dataset.direction = 'out'; dot.dataset.port = String(i);
        outCol.appendChild(lab); outCol.appendChild(dot);
        dot.addEventListener('mousedown', (ev)=>{ ev.stopPropagation(); onStartConnect({ nodeId: node.id, direction:'out', port: i }, ev); });
      } else {
        const spacer = document.createElement('div'); spacer.className = 'mc-port-spacer'; outCol.appendChild(spacer);
      }
      row.appendChild(inCol); row.appendChild(outCol); portsWrap.appendChild(row);
    }
    el.appendChild(portsWrap);

    // Bring-to-front on interaction (click/touch), but ignore interactive controls
    const bringToFront = (ev)=>{
      const t = ev && ev.target;
      if(t && (t.closest && t.closest('button, input, textarea, select, a'))) return;
      const p = el.parentElement; if(p && p.lastChild !== el){ p.appendChild(el); }
    };
    el.addEventListener('mousedown', bringToFront);
    el.addEventListener('touchstart', bringToFront, { passive: true });
    // Prevent starting drag when interacting with controls in header
    header.addEventListener('mousedown', (e)=>{
      const t = e && e.target; if(t && (t.closest && t.closest('button, input, textarea, select, a'))){ e.stopPropagation(); }
    }, { capture: true });

    // Resize handles (bottom-right and bottom-left)
    const handleBR = document.createElement('div'); handleBR.className = 'mc-node-resize mc-node-resize-br'; handleBR.innerHTML = '<span class="material-symbols-outlined">arrow_drop_down</span>';
    const handleBL = document.createElement('div'); handleBL.className = 'mc-node-resize mc-node-resize-bl'; handleBL.innerHTML = '<span class="material-symbols-outlined">arrow_drop_down</span>';
    el.appendChild(handleBR); el.appendChild(handleBL);

    let resizing = null; // 'br' | 'bl' | null
    let rsx=0, rsy=0, startW=0, startH=0, startL=0; // start left for BL
    // Compute a dynamic minimum height based on inner content to prevent overflow
    const computeMinNodeHeight = ()=>{
      try{
        const headerEl = header; // already defined above
        const bodyEl = body;     // already defined above
        const portsEl = portsWrap; // already defined above
        const h = (headerEl && headerEl.offsetHeight) || 24;
        const b = (bodyEl && bodyEl.scrollHeight) || 0;
        const p = (portsEl && portsEl.scrollHeight) || 0;
        // Add small buffer for borders/padding
        const buffer = 6;
        // Ensure a reasonable absolute floor as well
        return Math.max(100, h + b + p + buffer);
      }catch(_e){ return 100; }
    };
    const onResizeMove = (ev)=>{
      if(!resizing) return;
      const scale = window.__MaidLogicScale || 1;
      const dx = ((ev.clientX||0) - rsx) / scale;
      const dy = ((ev.clientY||0) - rsy) / scale;
      let newW = startW;
      let newH = startH + dy;
      let newL = startL;
      if(resizing === 'br'){
        newW = startW + dx;
      } else if(resizing === 'bl'){
        newW = startW - dx; // dragging right reduces width
        newL = startL + dx; // move left edge with mouse
      }
      // Clamp sizes (respect min/max width)
      newW = Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, newW));
      // Height must not be smaller than content to avoid overflow
      const minH = computeMinNodeHeight();
      newH = Math.max(Math.max(minH, NODE_MIN_H), newH);
      el.style.width = newW + 'px';
      el.style.height = newH + 'px';
      if(resizing === 'bl'){
        el.style.left = newL + 'px';
        node.x = newL;
      }
      node.w = newW; node.h = newH;
      onMove();
    };
    const onResizeUp = ()=>{ if(resizing){ resizing = null; onDataChange(); } };
    const startResize = (kind, ev)=>{
      ev.stopPropagation(); ev.preventDefault();
      resizing = kind;
      rsx = ev.clientX||0; rsy = ev.clientY||0;
      startW = parseInt(el.style.width || el.getBoundingClientRect().width/ (window.__MaidLogicScale||1), 10) || 0;
      startH = parseInt(el.style.height || el.getBoundingClientRect().height/ (window.__MaidLogicScale||1), 10) || 0;
      startL = parseInt(el.style.left||'0',10) || 0;
    };
    handleBR.addEventListener('mousedown', (e)=> startResize('br', e));
    handleBL.addEventListener('mousedown', (e)=> startResize('bl', e));
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeUp);

    // Dragging (scale-aware)
    let dragging=false, sx=0, sy=0, ox=0, oy=0;
    const onMoveInternal = (ev)=>{
      if(!dragging) return;
      const dx = (ev.clientX||0)-sx;
      const dy = (ev.clientY||0)-sy;
      // Access global transform state injected by openEditor
      const scale = window.__MaidLogicScale || 1;
      const nx = ox + dx/scale;
      const ny = oy + dy/scale;
      el.style.left = nx+'px'; el.style.top = ny+'px';
      node.x = nx; node.y = ny; onMove();
    };
    header.addEventListener('mousedown', (e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; ox=parseInt(el.style.left||'0',10); oy=parseInt(el.style.top||'0',10); e.preventDefault(); });
    window.addEventListener('mousemove', onMoveInternal);
    window.addEventListener('mouseup', ()=>{ if(dragging){ dragging=false; onDataChange(); } });

    // Header actions
    duplicateBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      try{
        if(!window.__MaidChanLogicDuplicateNode) return;
        window.__MaidChanLogicDuplicateNode(node);
      }catch(_e){}
    });
    replayBtn.addEventListener('click', (e)=>{ e.stopPropagation(); onResetNode(node); });
    closeBtn.addEventListener('click', (e)=>{ e.stopPropagation(); onDeleteNode(node); });

    // Auto-update edges when node size changes (e.g. content update)
    // Use ResizeObserver to detect size changes of the node element
    const ro = new ResizeObserver((entries)=>{
      // Use requestAnimationFrame to avoid "ResizeObserver loop limit exceeded"
      // and ensure we redraw after the layout is settled.
      window.requestAnimationFrame(()=>{
        if(typeof onMove === 'function') onMove();
      });
    });
    ro.observe(el);
    // Store observer on element to disconnect later if needed (though removing element disconnects automatically)
    el._mcResizeObserver = ro;

    return { el };
  }

  function computeAndRenderStages(graph, nodeEls){
    // Build process-only graph
    const nodes = graph.nodes||[];
    const edges = graph.edges||[];
    const defOf = (t)=> getNodeDef(t);
    // Dynamic process detection: treat Tools loader with execute=true as process
    const isProcess = (n)=>{
      const d = defOf(n.type) || {};
      if(d && d.category === 'process') return true;
      if(n && n.type === 'Tools loader' && n.data && n.data.execute === true) return true;
      return false;
    };
    const procNodes = new Map();
    for(const n of nodes){ if(n && isProcess(n)) procNodes.set(n.id, n); }
    const outMap = new Map();
    const inDeg = new Map();
    let anyProcEdge = false;
    for(const e of edges){
      const a = e && procNodes.get(e.fromNodeId);
      const b = e && procNodes.get(e.toNodeId);
      if(!a || !b) continue;
      anyProcEdge = true;
      if(!outMap.has(a.id)) outMap.set(a.id, []);
      outMap.get(a.id).push(b.id);
      inDeg.set(b.id, (inDeg.get(b.id)||0)+1);
      if(!inDeg.has(a.id)) inDeg.set(a.id, inDeg.get(a.id)||0);
    }
    // Compute stages via Kahn's algorithm
    const stage = new Map();
    const q = [];
    // Ensure isolated process nodes also receive a stage (1)
    for(const [id, n] of procNodes){ if(!inDeg.has(id)) inDeg.set(id, 0); }
    for(const [id, n] of procNodes){ if((inDeg.get(id)||0) === 0){ stage.set(id, 1); q.push(id); } }
    while(q.length){
      const v = q.shift();
      const nexts = outMap.get(v)||[];
      for(const w of nexts){
        const nextStage = (stage.get(v)||1) + 1;
        if(!stage.has(w) || nextStage > stage.get(w)) stage.set(w, nextStage);
        inDeg.set(w, (inDeg.get(w)||1)-1);
        if(inDeg.get(w) === 0) q.push(w);
      }
    }
    // Render stage badges
    for(const [id, el] of nodeEls){
      const node = graph.nodes.find(n=>n.id===id);
      if(!node) continue;
      const def = getNodeDef(node.type) || {};
      const badge = el.querySelector('.mc-node-stage');
      if(!badge) continue;
      // Use dynamic process check for stage badge
      if(!isProcess(node)){ badge.textContent = ''; badge.style.display='none'; continue; }
      const s = stage.get(id);
      if(s){ badge.textContent = `stage ${s}`; badge.style.display='inline-flex'; }
      else { badge.textContent = ''; badge.style.display='none'; }
    }
    return stage;
  }

  async function openEditor(){
    const overlay = document.createElement('div'); overlay.className='mc-logic-overlay';
    const toolbar = document.createElement('div'); toolbar.className='mc-logic-toolbar';
    // Preset management UI (autosave mode)
    const presetsSelect = document.createElement('select'); presetsSelect.style.minWidth='180px';
    const btnNew = document.createElement('button'); btnNew.textContent='New';
    const btnDelete = document.createElement('button'); btnDelete.textContent='Delete';
    const btnClose = document.createElement('button'); btnClose.textContent='Close';
    const help = document.createElement('div'); help.className='mc-logic-help'; help.textContent='Autosave on change. Right-click/double-click background to add nodes.';
    toolbar.appendChild(presetsSelect); toolbar.appendChild(btnNew); toolbar.appendChild(btnDelete); toolbar.appendChild(btnClose); toolbar.appendChild(help);
    const canvas = document.createElement('div'); canvas.className='mc-logic-canvas';
    const viewport = document.createElement('div'); viewport.className='mc-logic-viewport';
    // Grid background layer (checker dashed style)
    const grid = document.createElement('div'); grid.className = 'mc-logic-grid';
    viewport.appendChild(grid);
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.classList.add('mc-logic-svg'); svg.setAttribute('width','100%'); svg.setAttribute('height','100%'); viewport.appendChild(svg);
    canvas.appendChild(viewport);
    overlay.appendChild(toolbar); overlay.appendChild(canvas);
    // Transform state
    let scale = 1, tx = 0, ty = 0;
    window.__MaidLogicScale = scale; // expose for node dragging
    function applyTransform(){
      viewport.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
      window.__MaidLogicScale = scale;
      redraw();
      updateGridSize();
    }
    function contentBounds(){
      // Prefer real DOM measurement for accuracy (handles variable node sizes)
      if(nodeEls.size){
        const viewportRect = viewport.getBoundingClientRect();
        const s = scale || 1;
        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        for(const [,el] of nodeEls){
          const r = el.getBoundingClientRect();
          const x = (r.left - viewportRect.left)/s;
            const y = (r.top - viewportRect.top)/s;
            const w = r.width / s;
            const h = r.height / s;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }
        if(minX === Infinity) return { x:0,y:0,w:0,h:0 };
        return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
      }
      // Fallback to graph approximate if DOM not ready
      const nodes = graph.nodes||[];
      if(!nodes.length) return { x:0, y:0, w:0, h:0 };
      let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
      for(const n of nodes){
        const x = n.x||0, y=n.y||0;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x+240);
        maxY = Math.max(maxY, y+180); // slightly larger heuristic
      }
      return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
    }
    function autoFit(){
      const b = contentBounds();
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      if(b.w===0 || b.h===0){ scale = 1; tx = cw*0.5; ty = ch*0.5; applyTransform(); return; }
      const padX = 32; // tighter horizontal padding
      const padY = 32; // tighter vertical padding
      const targetScale = Math.min((cw - padX*2)/b.w, (ch - padY*2)/b.h, 1.25);
      scale = Math.max(0.2, targetScale);
      const cx = b.x + b.w/2;
      const cy = b.y + b.h/2;
      // Center with padding compensation
      tx = (cw/2) - cx*scale;
      ty = (ch/2) - cy*scale;
      applyTransform();
      updateGridSize();
    }
    // Zoom with wheel (no modifier needed)
    canvas.addEventListener('wheel', (e)=>{
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left - tx)/scale;
      const py = (e.clientY - rect.top - ty)/scale;
      const delta = -e.deltaY * 0.001; // wheel up -> zoom in
      const newScale = Math.min(2.5, Math.max(0.2, scale * (1 + delta)));
      tx = e.clientX - rect.left - px * newScale;
      ty = e.clientY - rect.top - py * newScale;
      scale = newScale; applyTransform();
    }, { passive:false });

    // Pinch zoom (two-finger on touch devices)
    let pinchStartDist = 0, pinchStartScale = 1, pinchCenter = null;
    canvas.addEventListener('touchstart', (e)=>{
      if(e.touches.length === 2){
        e.preventDefault();
        const t1 = e.touches[0]; const t2 = e.touches[1];
        pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchStartScale = scale;
        pinchCenter = {
          x: (t1.clientX + t2.clientX)/2,
          y: (t1.clientY + t2.clientY)/2
        };
      }
    }, { passive:false });
    canvas.addEventListener('touchmove', (e)=>{
      if(e.touches.length === 2 && pinchStartDist > 0){
        e.preventDefault();
        const t1 = e.touches[0]; const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const rect = canvas.getBoundingClientRect();
        const factor = dist / pinchStartDist;
        const newScale = Math.min(2.5, Math.max(0.2, pinchStartScale * factor));
        const px = (pinchCenter.x - rect.left - tx)/scale;
        const py = (pinchCenter.y - rect.top - ty)/scale;
        tx = pinchCenter.x - rect.left - px * newScale;
        ty = pinchCenter.y - rect.top - py * newScale;
        scale = newScale; applyTransform();
      }
    }, { passive:false });
    canvas.addEventListener('touchend', (e)=>{
      if(e.touches.length < 2){ pinchStartDist = 0; pinchCenter = null; }
    });

    // Panning (left or middle mouse on empty canvas)
    let panning = false, psx=0, psy=0, ptx=0, pty=0;
    canvas.addEventListener('mousedown', (e)=>{
      if(e.button === 0 || e.button === 1){
        // Only start pan if clicking background (not a node)
        if(e.target === canvas || e.target === viewport){
          panning = true; psx = e.clientX; psy = e.clientY; ptx = tx; pty = ty; e.preventDefault();
        }
      }
    });
    window.addEventListener('mousemove', (e)=>{
      if(!panning) return;
      const dx = e.clientX - psx; const dy = e.clientY - psy;
      tx = ptx + dx; ty = pty + dy; applyTransform();
    });
    window.addEventListener('mouseup', ()=>{ panning = false; });
    document.body.appendChild(overlay);
    // Lock page scroll while editor active
    document.body.classList.add('mc-logic-lock-scroll');

    // Preset storage helpers
    const PRESET_LIST_KEY = 'maid-chan:logic:presets';
    const PRESET_ITEM_PREFIX = 'maid-chan:logic:preset:';
    const CURRENT_PRESET_KEY = 'maid-chan:logic:current-preset';

    function readJSON(key, fb){ try{ const raw = window.localStorage.getItem(key); return raw? JSON.parse(raw): (fb===undefined? null: fb); }catch(_e){ return fb===undefined? null: fb; } }
    function writeJSON(key, val){ try{ window.localStorage.setItem(key, JSON.stringify(val)); }catch(_e){} }
    function listPresets(){ return readJSON(PRESET_LIST_KEY, []) || []; }
    function savePresetList(list){ writeJSON(PRESET_LIST_KEY, list||[]); }
    function presetKey(id){ return PRESET_ITEM_PREFIX + id; }
    function loadPresetGraph(id){
      const g = readJSON(presetKey(id), null);
      if(g && typeof g === 'object' && Array.isArray(g.nodes)){
        // Normalize graph structure (ids, flow_id, edges)
        migrateGraph(g);
      }
      return g;
    }
    function savePresetGraph(id, g){
      const graph = g && typeof g === 'object' ? g : { nodes: [], edges: [] };
      // Ensure we persist a normalized graph
      migrateGraph(graph);
      writeJSON(presetKey(id), graph);
    }
    function currentPresetId(){ return readJSON(CURRENT_PRESET_KEY, null); }
    function setCurrentPreset(id){ writeJSON(CURRENT_PRESET_KEY, id); }
    function newId(){ return 'p' + Math.random().toString(36).slice(2,9); }

    // Build a fresh default graph (do not depend on existing storage)
    function getLocalDefaultGraph(){
      return {
        nodes: [
          { id:'n1', type:'Maid Persona', x:80, y:120, data:getDefaultNodeData('Maid Persona') },
          { id:'n2', type:'User Persona', x:80, y:260, data:getDefaultNodeData('User Persona') },
          { id:'n3', type:'Chat Samples', x:80, y:400, data:getDefaultNodeData('Chat Samples') },
          { id:'n4', type:'Custom Prompt', x:80, y:40, data:getDefaultNodeData('Custom Prompt') },
          { id:'n5', type:'LLM', x:360, y:220, data:getDefaultNodeData('LLM') },
          { id:'n6', type:'Tools loader', x:360, y:360, data:getDefaultNodeData('Tools loader') },
          { id:'n7', type:'Save history', x:660, y:200, data:getDefaultNodeData('Save history') },
          { id:'n8', type:'Send to chat UI', x:660, y:300, data:getDefaultNodeData('Send to chat UI') }
        ],
        edges: [
          { id:'e1', fromNodeId:'n1', fromPort:0, toNodeId:'n5', toPort:0, index:1 },
          { id:'e2', fromNodeId:'n2', fromPort:0, toNodeId:'n5', toPort:0, index:2 },
          { id:'e3', fromNodeId:'n4', fromPort:0, toNodeId:'n5', toPort:0, index:3 },
          { id:'e4', fromNodeId:'n3', fromPort:0, toNodeId:'n5', toPort:1 },
          { id:'e5', fromNodeId:'n6', fromPort:0, toNodeId:'n5', toPort:2 },
          { id:'e6', fromNodeId:'n5', fromPort:0, toNodeId:'n7', toPort:0 },
          { id:'e7', fromNodeId:'n5', fromPort:0, toNodeId:'n8', toPort:0 }
        ]
      };
    }

    async function fetchDefaultGraph(){
      try{
        const res = await fetch('/plugins/maid-chan/static/presets/default.json');
        if(!res.ok) throw new Error('Status ' + res.status);
        const json = await res.json();
        if(json && Array.isArray(json.nodes)){
          for(const n of json.nodes){
            if(!n.data || Object.keys(n.data).length === 0){
              n.data = getDefaultNodeData(n.type);
            }
          }
        }
        return json;
      }catch(e){
        console.warn('Failed to fetch default preset, using local fallback', e);
        return getLocalDefaultGraph();
      }
    }

    // Initialize presets (migrate from single GRAPH_KEY if needed)
    let presetList = listPresets();
    let activePresetId = currentPresetId();
    if(!presetList.length){
      const initialGraph = loadGraph() || await fetchDefaultGraph();
      const id = newId();
      presetList = [{ id, name: 'Default' }];
      savePresetList(presetList);
      savePresetGraph(id, initialGraph);
      setCurrentPreset(id);
      activePresetId = id;
      // Keep compatibility for ai_logic by updating GRAPH_KEY
      saveGraph(initialGraph);
    }
    if(!activePresetId){ activePresetId = presetList[0].id; setCurrentPreset(activePresetId); }

    // Populate preset dropdown
    function refreshPresetSelect(){
      presetsSelect.innerHTML = '';
      presetList.forEach(p=>{
        const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name || p.id; if(p.id===activePresetId) opt.selected = true; presetsSelect.appendChild(opt);
      });
    }
    refreshPresetSelect();

    // Load active graph
    let graph = loadPresetGraph(activePresetId) || await fetchDefaultGraph();

    // Unified autosave: save active graph to preset and global key
    function persistGraph(){
      // Ensure flows are assigned per branch before saving so presets
      // store a stable, meaningful flow_id for each disconnected
      // subgraph.
      assignFlowsPerBranch(graph);
      savePresetGraph(activePresetId, graph);
      saveGraph(graph);
      // Also autosave to backend as <preset_name>.json
      try{
        const preset = (presetList||[]).find(p=>p && p.id===activePresetId) || null;
        const presetName = (preset && (preset.name||preset.id)) || activePresetId || 'preset';
        const payload = { preset_id: activePresetId, preset_name: presetName, graph, client_ts: Date.now() };
        // Prefer plugin API client (handles auth), fallback to fetch
        (async function(){
          try{
            const root = window.Yuuka || {}; const ns = root.plugins && root.plugins['maid-chan']; const coreApi = ns && ns.coreApi;
            if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
              coreApi.createPluginApiClient('maid');
              const client = coreApi.maid;
              if(client && typeof client.post === 'function'){
                await client.post('/logic/preset/save', payload);
                return;
              }
            }
          }catch(_e){}
          try{
            await fetch('/api/plugin/maid/logic/preset/save', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
          }catch(_e){}
        })();
      }catch(_e){}
    }
    const nodeEls = new Map();
    let currentStageMap = new Map();
    const nodesPortMap = new Map(); // key: `${nodeId}:in|out:${port}` -> HTMLElement
    let draggingEdge = null; // { src:{nodeId,port}, pathEl }

    // Expose a helper so header duplicate button can clone nodes with current graph context
    window.__MaidChanLogicDuplicateNode = (srcNode)=>{
      try{
        if(!srcNode || !srcNode.id || !Array.isArray(graph.nodes)) return;
        const baseX = Number.isFinite(srcNode.x) ? srcNode.x : 0;
        const baseY = Number.isFinite(srcNode.y) ? srcNode.y : 0;
        const copy = {
          id: getNextId(graph.nodes),
          flow_id: srcNode.flow_id !== undefined ? srcNode.flow_id : 0,
          type: srcNode.type,
          x: baseX + 40,
          y: baseY + 40,
          w: srcNode.w,
          h: srcNode.h,
          data: JSON.parse(JSON.stringify(srcNode.data||{}))
        };
        graph.nodes.push(copy);
        const built = createNodeEl(copy, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
        nodeEls.set(copy.id, built.el);
        viewport.appendChild(built.el);
        persistGraph();
        redraw();
      }catch(_e){}
    };

    // Normalize indices across all input groups
    function normalizeEdgeIndices(){
      const groups = new Map();
      for(const e of graph.edges||[]){
        const key = `${e.toNodeId}:${e.toPort||0}`;
        let g = groups.get(key); if(!g){ g = []; groups.set(key, g); }
        g.push(e);
      }
      for(const [,list] of groups){
        list.sort((a,b)=>{
          const ia = Number.isFinite(a.index)? a.index : Infinity;
          const ib = Number.isFinite(b.index)? b.index : Infinity;
          if(ia !== ib) return ia - ib;
          return String(a.id).localeCompare(String(b.id));
        });
        list.forEach((e,i)=>{ e.index = i+1; });
      }
    }

    const redraw = ()=>{
      // rebuild port map
      nodesPortMap.clear();
      for(const [nodeId, el] of nodeEls){
        const inDots = el.querySelectorAll('.mc-port-in');
        inDots.forEach(d => nodesPortMap.set(`${nodeId}:in:${d.dataset.port}`, d));
        const outDots = el.querySelectorAll('.mc-port-out');
        outDots.forEach(d => nodesPortMap.set(`${nodeId}:out:${d.dataset.port}`, d));
      }
      normalizeEdgeIndices();
      // Update stage badges before drawing edges and store stage map
      currentStageMap = computeAndRenderStages(graph, nodeEls) || new Map();
      drawEdges(
        svg,
        nodesPortMap,
        graph,
        (edgeId)=>{
          // Remove then renormalize indices for affected group
          const edge = (graph.edges||[]).find(e => e.id === edgeId);
          graph.edges = (graph.edges||[]).filter(e => e.id !== edgeId);
          if(edge){
            // After removal, reassign indices in that group
            const list = (graph.edges||[]).filter(ed => ed.toNodeId===edge.toNodeId && (ed.toPort||0)===(edge.toPort||0));
            list.sort((a,b)=>{
              const ia = Number.isFinite(a.index)? a.index : Infinity;
              const ib = Number.isFinite(b.index)? b.index : Infinity;
              if(ia !== ib) return ia - ib; return String(a.id).localeCompare(String(b.id));
            });
            list.forEach((e,i)=>{ e.index = i+1; });
          }
          persistGraph(); redraw();
        },
        (edgeId, newIndex)=>{
          const ed = (graph.edges||[]).find(e => e.id === edgeId);
          if(!ed) return;
          const group = (graph.edges||[]).filter(e => e.toNodeId===ed.toNodeId && (e.toPort||0)===(ed.toPort||0));
          group.sort((a,b)=>{
            const ia = Number.isFinite(a.index)? a.index : Infinity;
            const ib = Number.isFinite(b.index)? b.index : Infinity;
            if(ia !== ib) return ia - ib; return String(a.id).localeCompare(String(b.id));
          });
          const fromIdx = group.indexOf(ed);
          if(fromIdx === -1) return;
          const target = Math.max(1, Math.min(newIndex, group.length)) - 1;
          if(fromIdx !== target){
            group.splice(fromIdx,1);
            group.splice(target,0,ed);
          }
          group.forEach((e,i)=>{ e.index = i+1; });
          persistGraph(); redraw();
        }
      );
      // If dragging edge exists, keep it on top
      if(draggingEdge && draggingEdge.pathEl){ svg.appendChild(draggingEdge.pathEl); }
      updateGridSize();
    };

    // Ensure grid covers an area larger than current content so panning doesn't reveal empty background.
    function updateGridSize(){
      if(!grid) return;
      const b = contentBounds();
      // Add generous padding around content bounds in logical space.
      const pad = 1200; // logical units
      const w = Math.max(b.w + pad*2, 4400);
      const h = Math.max(b.h + pad*2, 6200);
      // Position grid so content roughly centered within it.
      const gx = (b.x - pad);
      const gy = (b.y - pad);
      
      // Update Grid
      grid.style.width = w + 'px';
      grid.style.height = h + 'px';
      grid.style.left = gx + 'px';
      grid.style.top = gy + 'px';
      grid.style.backgroundPosition = `${-gx}px ${-gy}px`;

      // Update SVG to match Grid (dynamic canvas size)
      if(svg){
        svg.style.left = gx + 'px';
        svg.style.top = gy + 'px';
        svg.style.width = w + 'px';
        svg.style.height = h + 'px';
        svg.style.right = 'auto';
        svg.style.bottom = 'auto';
        svg.setAttribute('viewBox', `${gx} ${gy} ${w} ${h}`);
      }
    }

    const onDataChange = ()=>{ persistGraph(); redraw(); };
    const onMove = ()=>{ redraw(); };

    function rebuildNode(node){
      const old = nodeEls.get(node.id);
      if(old){ old.remove(); nodeEls.delete(node.id); }
      const { el } = createNodeEl(node, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
      nodeEls.set(node.id, el); viewport.appendChild(el);
    }

    function resetNode(node){
      const def = getNodeDef(node.type);
      const personaKey = defaultPersonaKey(node.type);
      if(personaKey){ try{ window.localStorage.removeItem(personaKey); }catch(_e){} }
      if(def && (def.type === 'LLM loader' || def.type === 'LLM settings')){ try{ window.localStorage.removeItem('maid-chan:llm-config'); }catch(_e){} }
      // Special handling: Preview node stores its own last content; clear it on replay
      if(node && node.type === 'Preview'){
        try{ window.localStorage.removeItem('maid-chan:preview:'+node.id); }catch(_e){}
        try{ window.dispatchEvent(new CustomEvent('maid-chan:preview:update', { detail: { nodeId: node.id, message: null, text: '', toolsResult: null } })); }catch(_e){}
      }
      node.data = getDefaultNodeData(node.type);
      onDataChange();
      rebuildNode(node);
      redraw();
    }

    function deleteNode(node){
      graph.nodes = (graph.nodes||[]).filter(n => n.id !== node.id);
      graph.edges = (graph.edges||[]).filter(e => e.fromNodeId !== node.id && e.toNodeId !== node.id);
      onDataChange();
      const el = nodeEls.get(node.id); if(el){ el.remove(); nodeEls.delete(node.id); }
      redraw();
    }

    function startConnect(portInfo, ev){
      const ns = 'http://www.w3.org/2000/svg';
      if(draggingEdge && draggingEdge.pathEl){ draggingEdge.pathEl.remove(); draggingEdge = null; }
      if(portInfo.direction === 'in'){
        // Allow drag from in by flipping logic: handled at mouseup validation
      }
      // Disable text selection while dragging
      overlay.classList.add('mc-dragging');
      const pr = svg.parentElement.getBoundingClientRect();
      const path = document.createElementNS(ns,'path');
      path.setAttribute('stroke', '#9aa6ff');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
      draggingEdge = { src: portInfo, pathEl: path };

      const move = (e)=>{
        const srcKey = `${portInfo.nodeId}:${portInfo.direction}:${portInfo.port}`;
        let srcEl = nodesPortMap.get(srcKey);
        if(!srcEl && ev && ev.target && ev.target.classList && ev.target.classList.contains('mc-port')){
          srcEl = ev.target;
        }
        if(!srcEl){ return; }
        const sr = srcEl.getBoundingClientRect();
        const currentScale = window.__MaidLogicScale || 1;
        const x1 = (sr.left - pr.left + sr.width/2) / currentScale;
        const y1 = (sr.top - pr.top + sr.height/2) / currentScale;
        const x2 = ((e.clientX||0) - pr.left) / currentScale;
        const y2 = ((e.clientY||0) - pr.top) / currentScale;
        const mx = (x1 + x2)/2;
        const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
        path.setAttribute('d', d);
      };
      const up = (e)=>{
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        try{
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const targetDot = el && (el.closest && el.closest('.mc-port')) ? el.closest('.mc-port') : (el && el.classList && el.classList.contains('mc-port') ? el : null);
          if(targetDot){
            const toInfo = { nodeId: targetDot.dataset.nodeId, direction: targetDot.dataset.direction, port: parseInt(targetDot.dataset.port||'0',10) };
            // Must be opposite directions
            if(toInfo.direction !== portInfo.direction){
              const out = portInfo.direction === 'out' ? portInfo : toInfo;
              const inn = portInfo.direction === 'in' ? portInfo : toInfo;
              // Validation: allow specific mappings for LLM, else default behavior
              const outNode = graph.nodes.find(n => n.id === out.nodeId);
              const inNode = graph.nodes.find(n => n.id === inn.nodeId);
              let allow = true;
              if(inNode && inNode.type === 'LLM'){
                const inPorts = getPortConfig(inNode.type).inputs;
                const outPorts = outNode ? getPortConfig(outNode.type).outputs : [];
                const inMeta = inPorts[inn.port];
                const outMeta = outPorts[out.port];
                if(outNode && outNode.type === 'LLM'){
                  // Allow LLM -> LLM chaining: Message/Tools result -> Prompt (no self-loop)
                  const isTargetInput = !!(inMeta && (inMeta.id === 'system_prompt' || inMeta.id === 'messages'));
                  const isAllowedOut = !!(outMeta && (outMeta.id === 'response_message'));
                  const notSelf = out.nodeId !== inn.nodeId;
                  allow = isTargetInput && isAllowedOut && notSelf;
                } else {
                  // Default: require matching port ids (prompt/history/tools/settings)
                  // Exception: Allow System Prompt -> Messages
                  const isSysToMsg = (outMeta && outMeta.id === 'system_prompt' && inMeta && inMeta.id === 'messages');
                  if(!(inMeta && outMeta && inMeta.id === outMeta.id) && !isSysToMsg) allow = false;
                }
              }
              if(!allow){
                // silently ignore invalid connection
              } else {
              // prevent duplicate
                const fromId = Number(out.nodeId);
                const toId = Number(inn.nodeId);
                const exists = (graph.edges||[]).some(ed => ed.fromNodeId===fromId && ed.fromPort===out.port && ed.toNodeId===toId && ed.toPort===inn.port);
                if(!exists){
                  graph.edges = graph.edges || [];
                  // Assign default index at the end of this input group
                  const groupLen = (graph.edges||[]).filter(ed => ed.toNodeId===toId && (ed.toPort||0)===(inn.port||0)).length;
                  graph.edges.push({ id: getNextId(graph.edges), fromNodeId: fromId, fromPort: out.port, toNodeId: toId, toPort: inn.port, index: groupLen+1 });
                  // Normalize indices afterward for safety
                  const list = (graph.edges||[]).filter(ed => ed.toNodeId===toId && (ed.toPort||0)===(inn.port||0));
                  list.sort((a,b)=>{
                    const ia = Number.isFinite(a.index)? a.index : Infinity;
                    const ib = Number.isFinite(b.index)? b.index : Infinity;
                    if(ia !== ib) return ia - ib; return String(a.id).localeCompare(String(b.id));
                  });
                  list.forEach((e,i)=>{ e.index = i+1; });
                  persistGraph();
                }
              }
            }
          }
        }finally{
          if(draggingEdge && draggingEdge.pathEl){ draggingEdge.pathEl.remove(); }
          draggingEdge = null; redraw();
          overlay.classList.remove('mc-dragging');
        }
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    // Build nodes
    for(const n of graph.nodes){
      const { el } = createNodeEl(n, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
      nodeEls.set(n.id, el); viewport.appendChild(el);
    }
    // Initial fit after nodes laid out
    setTimeout(autoFit, 50);

    const onResize = ()=> redraw();
    new ResizeObserver(onResize).observe(canvas);
    window.addEventListener('resize', onResize);

    // Also refresh edges when preview content updates (even if node size is fixed)
    // This event is dispatched by ai_logic/output when a Preview node renders new data.
    const onPreviewUpdate = ()=> redraw();
    window.addEventListener('maid-chan:preview:update', onPreviewUpdate);
    setTimeout(redraw, 0);

    // Preset events
    presetsSelect.addEventListener('change', async ()=>{
      const sel = presetsSelect.value;
      if(!sel || sel === activePresetId) return;
      activePresetId = sel; setCurrentPreset(activePresetId);
      graph = loadPresetGraph(activePresetId) || await fetchDefaultGraph();
      // Rebuild UI
      for(const [,nodeEl] of nodeEls){ nodeEl.remove(); }
      nodeEls.clear();
      for(const n of graph.nodes){
        const { el } = createNodeEl(n, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
        nodeEls.set(n.id, el); viewport.appendChild(el);
      }
      autoFit();
      persistGraph();
      redraw();
    });

    btnNew.addEventListener('click', async ()=>{
      const name = (prompt('New preset name:', 'Preset ' + (presetList.length+1)) || '').trim();
      if(!name) return;
      const id = newId();
      const newGraph = await fetchDefaultGraph();
      presetList.push({ id, name }); savePresetList(presetList);
      savePresetGraph(id, newGraph);
      activePresetId = id; setCurrentPreset(id);
      refreshPresetSelect();
      // Load into UI
      graph = newGraph;
      for(const [,nodeEl] of nodeEls){ nodeEl.remove(); }
      nodeEls.clear();
      for(const n of graph.nodes){
        const { el } = createNodeEl(n, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
        nodeEls.set(n.id, el); viewport.appendChild(el);
      }
      autoFit();
      persistGraph();
      redraw();
    });

    btnDelete.addEventListener('click', async ()=>{
      if(!activePresetId) return;
      const p = presetList.find(p=>p.id===activePresetId);
      if(!confirm(`Delete preset "${p ? (p.name||p.id) : activePresetId}"?`)) return;
      // Remove preset entry and storage
      presetList = presetList.filter(p=>p.id!==activePresetId); savePresetList(presetList);
      try{ window.localStorage.removeItem(presetKey(activePresetId)); }catch(_e){}
      // Pick next active or create default
      if(!presetList.length){
        const id = newId(); const def = await fetchDefaultGraph();
        presetList = [{ id, name: 'Default' }]; savePresetList(presetList);
        savePresetGraph(id, def); activePresetId = id; setCurrentPreset(id); graph = def;
      }else{
        activePresetId = presetList[0].id; setCurrentPreset(activePresetId); graph = loadPresetGraph(activePresetId) || await fetchDefaultGraph();
      }
      refreshPresetSelect();
      // Rebuild UI
      for(const [,nodeEl] of nodeEls){ nodeEl.remove(); }
      nodeEls.clear();
      for(const n of graph.nodes){
        const { el } = createNodeEl(n, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
        nodeEls.set(n.id, el); viewport.appendChild(el);
      }
      autoFit();
      persistGraph();
      redraw();
    });

    btnClose.addEventListener('click', ()=>{ 
      overlay.remove(); 
      window.removeEventListener('resize', onResize); 
      window.removeEventListener('maid-chan:preview:update', onPreviewUpdate);
      document.body.classList.remove('mc-logic-lock-scroll'); 
    });

    // Node execution glow helpers
    function setNodeRunning(nodeId, running){
      const el = nodeEls.get(nodeId);
      if(el){
        if(running) el.classList.add('mc-node-running');
        else el.classList.remove('mc-node-running');
      }
    }

    function runStageForNode(node){
      const s = currentStageMap.get(node.id) || 1;
      const runId = 'run_' + Math.random().toString(36).slice(2,9);
      try{
        // Include nodeId so the runner can infer the correct flow_id
        const detail = { presetId: activePresetId, stage: s, runId, graph, nodeId: node.id };
        window.dispatchEvent(new CustomEvent('maid-chan:logic:run-stage', { detail }));
      }catch(_e){}
    }

    // Listen for precise node execution events
    const onNodeStart = (ev)=>{
      const d = ev && ev.detail || {};
      if(d.nodeId) setNodeRunning(d.nodeId, true);
    };
    const onNodeEnd = (ev)=>{
      const d = ev && ev.detail || {};
      if(d.nodeId) setNodeRunning(d.nodeId, false);
    };
    window.addEventListener('maid-chan:logic:node:start', onNodeStart);
    window.addEventListener('maid-chan:logic:node:end', onNodeEnd);

    // Background palette: right-click or double-click
    function openPalette(x, y){
      closePalette();
      const menu = document.createElement('div'); menu.className = 'mc-palette';
      // Position relative to overlay by converting logical (viewport) coords back to pixels
      try{
        const canvasRect = canvas.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        const sx = window.__MaidLogicScale || 1;
        const px = (canvasRect.left - overlayRect.left) + tx + x * sx;
        const py = (canvasRect.top - overlayRect.top) + ty + y * sx;
        menu.style.left = px + 'px';
        menu.style.top = py + 'px';
      }catch(_e){
        // Fallback to original logical placement
        menu.style.left = x+'px';
        menu.style.top = y+'px';
      }
      // Build palette dynamically from registered node definitions
      const cats = (function(){
        const out = [];
        function pushIf(label, arr){ if(Array.isArray(arr) && arr.length){ out.push({ id: label.toLowerCase(), title: label, nodes: arr.slice() }); } }
        try{
          const api = window.Yuuka && window.Yuuka.components && window.Yuuka.components.MaidChanNodes;
          if(api && typeof api.categories === 'function'){
            const byCat = api.categories();
            pushIf('Inputs', byCat.input);
            pushIf('Processing', byCat.process);
            pushIf('Outputs', byCat.output);
            // Any other categories
            for(const k of Object.keys(byCat)){
              if(k==='input'||k==='process'||k==='output') continue;
              const title = k.charAt(0).toUpperCase()+k.slice(1);
              pushIf(title, byCat[k]);
            }
            return out;
          }
        }catch(_e){}
        // Fallback: scan global defs directly
        try{
          const defs = window.MaidChanNodeDefs || {};
          const buckets = { input:[], process:[], output:[], other:[] };
          for(const def of Object.values(defs)){
            if(!def || !def.type) continue;
            const cat = (def.category||'').toLowerCase();
            if(cat==='input') buckets.input.push(def.type);
            else if(cat==='process') buckets.process.push(def.type);
            else if(cat==='output') buckets.output.push(def.type);
            else buckets.other.push(def.type);
          }
          pushIf('Inputs', buckets.input);
          pushIf('Processing', buckets.process);
          pushIf('Outputs', buckets.output);
          pushIf('Other', buckets.other);
          return out;
        }catch(_e){
          // Final hardcoded fallback
          return [
            { id:'inputs', title:'Inputs', nodes:['Maid Persona','User Persona','Chat Samples','Custom Prompt','User Input','User Input SM','Read history','Tools loader','LLM loader'] },
            { id:'processing', title:'Processing', nodes:['LLM','Choice'] },
            { id:'outputs', title:'Outputs', nodes:['Save history','Send to chat UI','Send to chat bubble','Preview','Tools execution'] }
          ];
        }
      })();
      const list = document.createElement('ul'); list.className='mc-palette-cats';
      const sub = document.createElement('div'); sub.className='mc-palette-sub';
      menu.appendChild(list); menu.appendChild(sub);
      const renderSub = (cat)=>{
        sub.innerHTML = '';
        const ul = document.createElement('ul'); ul.className='mc-palette-items';
        for(const t of cat.nodes){
          const li = document.createElement('li'); li.className='mc-palette-item'; li.textContent = t;
          li.addEventListener('click', ()=>{
            const id = getNextId(graph.nodes);
            const node = { id, flow_id: 0, type:t, x: x-80, y: y-20, data: getDefaultNodeData(t) };
            graph.nodes.push(node); persistGraph();
            const built = createNodeEl(node, canvas, onMove, onDataChange, resetNode, deleteNode, startConnect, runStageForNode);
            nodeEls.set(id, built.el); viewport.appendChild(built.el); redraw(); closePalette();
          });
          ul.appendChild(li);
        }
        sub.appendChild(ul);
      };
      for(const c of cats){
        const li = document.createElement('li'); li.className='mc-palette-cat'; li.textContent = c.title;
        li.addEventListener('mouseenter', ()=> renderSub(c));
        list.appendChild(li);
      }
      overlay.appendChild(menu);
      renderSub(cats[0]);
      setTimeout(()=>{
        const off = (e)=>{ if(!menu.contains(e.target)){ closePalette(); document.removeEventListener('mousedown', off); } };
        document.addEventListener('mousedown', off);
      },0);
    }
    function closePalette(){
      const ex = overlay.querySelector('.mc-palette'); if(ex) ex.remove();
    }
    canvas.addEventListener('contextmenu', (e)=>{ e.preventDefault(); if(e.target.closest('.mc-node')) return; const r = canvas.getBoundingClientRect(); const lx = (e.clientX - r.left - tx)/scale; const ly = (e.clientY - r.top - ty)/scale; openPalette(lx, ly); });
    canvas.addEventListener('dblclick', (e)=>{ if(e.target.closest('.mc-node')) return; const r = canvas.getBoundingClientRect(); const lx = (e.clientX - r.left - tx)/scale; const ly = (e.clientY - r.top - ty)/scale; openPalette(lx, ly); });
  }

  // Register as a Feature in the Features tab
  function registerFeature(){
    const MainFrame = window.Yuuka && window.Yuuka.components && window.Yuuka.components.MaidChanMainFrame;
    if(!MainFrame || typeof MainFrame.registerFeature !== 'function') return;
    MainFrame.registerFeature({
      id: FEATURE_ID,
      title: 'AI Logic Editor',
      description: 'Configure a node-based workflow that routes LLM requests. Toggle ON to enable routing via this logic instead of legacy.',
      defaultEnabled: false,
      mount(container /*, api*/){
        // Content is shown only when feature is toggled ON
        const wrap = document.createElement('div');
        const p = document.createElement('div'); p.style.marginBottom='8px'; p.textContent = 'Edit how Maid-chan builds prompts, uses tools, and routes outputs.';
        const btn = document.createElement('button'); btn.textContent='Open Logic Editor'; btn.className='maid-chan-chat-btn';
        btn.addEventListener('click', ()=> openEditor());
        wrap.appendChild(p); wrap.appendChild(btn); container.appendChild(wrap);
      },
      unmount(container /*, api*/){
        // Clear content when toggled OFF; description will be shown by the Features frame
        while(container.firstChild) container.removeChild(container.firstChild);
      }
    });
  }

  // Public API (optional)
  window.Yuuka = window.Yuuka || {}; window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components.MaidChanLogicUI = { open: openEditor };



  // Auto-register feature early
  registerFeature();
})();
