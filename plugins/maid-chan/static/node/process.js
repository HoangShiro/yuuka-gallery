(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }

  // --- Inspector Logic ---
  async function showInspector(nodeId){
    // Create UI immediately with loading state
    const overlay = document.createElement('div');
    overlay.className = 'mc-inspector-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'mc-inspector-modal';
    
    const header = document.createElement('div');
    header.className = 'mc-inspector-header';
    header.innerHTML = `<div class="mc-inspector-title">LLM Inspector</div><button class="mc-inspector-close">✕</button>`;
    header.querySelector('button').onclick = () => document.body.removeChild(overlay);
    
    const content = document.createElement('div');
    content.className = 'mc-inspector-content';
    content.innerHTML = `<div class="mc-inspector-loading"><div class="mc-inspector-spinner"></div><div>Gathering inputs...</div></div>`;
    
    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    try {
        // 1. Gather inputs via AILogic
        const inputs = await (window.Yuuka.ai.AILogic && window.Yuuka.ai.AILogic.gatherInputs ? window.Yuuka.ai.AILogic.gatherInputs(nodeId) : Promise.resolve({}));
        
        // 2. Process inputs locally
        const processed = prepareLLMRequest(inputs);
        
        // 3. Render data
        content.innerHTML = '';
        
        const sections = [
            { title: 'Final Messages (Context)', data: processed.messages },
            { title: 'Settings', data: processed.settings },
            { title: 'Allowed Tools', data: processed.allowedTools },
            { title: 'Custom Tools', data: processed.customTools },
          { title: 'Structured Output Hints', data: processed.structuredOutput },
            { title: 'Raw Inputs', data: inputs }
        ];
        
        sections.forEach(sec => {
            const secDiv = document.createElement('div');
            secDiv.className = 'mc-inspector-section';
            
            const secTitle = document.createElement('div');
            secTitle.className = 'mc-inspector-section-title';
            secTitle.textContent = sec.title;
            secDiv.appendChild(secTitle);
            
            const pre = document.createElement('div');
            pre.className = 'mc-inspector-pre';
            pre.textContent = JSON.stringify(sec.data, null, 2);
            secDiv.appendChild(pre);
            content.appendChild(secDiv);
        });
        
        // Update timestamp in header
        const timeSpan = document.createElement('span');
        timeSpan.className = 'mc-inspector-time';
        timeSpan.textContent = new Date().toLocaleTimeString();
        header.querySelector('.mc-inspector-title').appendChild(timeSpan);

    } catch(err) {
        content.innerHTML = `<div style="color:#ff5252; padding:20px;">Error: ${err.message}</div>`;
    }
  }

  // Helper to prepare LLM request data from inputs (shared by execute and inspector)
  function prepareLLMRequest(inputs){
      inputs = inputs || {};
      const prompts = Array.isArray(inputs.system_prompt) ? inputs.system_prompt : (inputs.system_prompt ? [inputs.system_prompt] : []);
      const histories = Array.isArray(inputs.messages) ? inputs.messages : (inputs.messages ? [inputs.messages] : []);
      const toolsList = Array.isArray(inputs.tool_definitions) ? inputs.tool_definitions : (inputs.tool_definitions ? [inputs.tool_definitions] : []);
      const settingsList = Array.isArray(inputs.llm_settings) ? inputs.llm_settings : (inputs.llm_settings ? [inputs.llm_settings] : []);

      // 1. Build System Prompt
      const systemParts = [];
      
      for(const p of prompts){
        let val = (p && typeof p === 'object' && p.system_prompt) ? p.system_prompt : p;
        if(val && typeof val === 'object' && val.content) val = val.content;
        if(val && typeof val === 'string') systemParts.push(val);
      }
      
      const messages = [];
      if(systemParts.length){
        messages.push({ role: 'system', content: systemParts.join('\n\n') });
      }

      // 2. Build History
      const normalize = (item) => {
        if(!item) return [];
        if(Array.isArray(item)) return item.flatMap(normalize);
        // Handle system_prompt from upstream nodes connected to Messages port
        if(typeof item === 'object' && item.system_prompt){
            const sp = item.system_prompt;
            if(typeof sp === 'string') return [{ role: 'system', content: sp }];
            if(typeof sp === 'object' && sp.role && sp.content) return [sp];
        }
        if(typeof item === 'object' && item.role && item.content) return [item];
        if(typeof item === 'string') return [{ role: 'assistant', content: item }];
        return [];
      };

      for(const h of histories){
        const val = (h && typeof h === 'object' && h.messages) ? h.messages : h;
        messages.push(...normalize(val));
      }

      // 3. Tools
      let allowedTools = [];
      const customTools = [];
      const allowSet = new Set();
      const structuredProps = {};
      const structuredRequired = new Set();
      let hasStructuredContrib = false;
      const cloneSchema = (val) => {
        try {
          return JSON.parse(JSON.stringify(val));
        } catch(_e) {
          return val;
        }
      };

      for(const t of toolsList){
        const val = (t && t.tool_definitions) ? t.tool_definitions : t;
        if(val && val.selected && Array.isArray(val.selected)){
            val.selected.forEach(s => allowSet.add(String(s)));
        }
        if(val && val.custom && Array.isArray(val.custom)){
            customTools.push(...val.custom);
        }
        if(val && val.structured_output && typeof val.structured_output === 'object'){
            const contrib = val.structured_output;
            const props = contrib.properties;
            if(props && typeof props === 'object'){
                Object.entries(props).forEach(([key, schema]) => {
                    if(!key) return;
                    structuredProps[key] = cloneSchema(schema);
                    hasStructuredContrib = true;
                });
            }
            if(Array.isArray(contrib.required)){
                contrib.required.forEach(req => {
                    if(req) structuredRequired.add(req);
                });
            }
        }
      }
      allowedTools = Array.from(allowSet);

      // 4. Settings
      let settings = {};
      for(const s of settingsList){
         const val = (s && s.llm_settings) ? s.llm_settings : s;
         if(val && typeof val === 'object') Object.assign(settings, val);
      }
      if(Object.keys(settings).length === 0){
        try{ const raw = window.localStorage.getItem('maid-chan:llm-config'); if(raw){ const cfg = JSON.parse(raw); if(cfg && typeof cfg==='object') settings = cfg; } }catch(_e){}
      }
      
      const structuredOutput = hasStructuredContrib ? {
        properties: structuredProps,
        required: Array.from(structuredRequired)
      } : null;

      return { messages, settings, allowedTools, customTools, structuredOutput };
  }
  // -----------------------
  
  // --- Tags manager helpers ---
  function tmNormalizeList(value){
    if(value == null) return [];
    if(Array.isArray(value)){
      return value.map(v => (v == null ? '' : String(v))).map(v => v.trim()).filter(Boolean);
    }
    if(typeof value === 'string'){
      return value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
    }
    if(typeof value === 'object' && value){
      if(Array.isArray(value.tags)) return tmNormalizeList(value.tags);
      if(Array.isArray(value.values)) return tmNormalizeList(value.values);
    }
    return [];
  }

  function tmNormalizeKey(value){
    if(value == null) return '';
    let text = String(value).toLowerCase();
    try{ text = text.normalize('NFD'); }catch(_e){}
    text = text.replace(/[\u0300-\u036f]/g, '');
    text = text.replace(/[\s_\-]+/g, ' ');
    text = text.replace(/[^a-z0-9]+/g, '');
    return text;
  }

  function tmNormalizeName(value){
    if(typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  }

  function tmUniqueList(list, blocked){
    const blockedSet = new Set(blocked ? Array.from(blocked) : []);
    const result = [];
    (list || []).forEach(item => {
      const text = item == null ? '' : String(item).trim();
      if(!text) return;
      const key = tmNormalizeKey(text);
      if(!key || blockedSet.has(key)) return;
      blockedSet.add(key);
      result.push(text);
    });
    return result;
  }

  function tmEnsureEntryShape(entry){
    const next = entry || {};
    if(!next.id) next.id = `tm_${Math.random().toString(36).slice(2, 9)}`;
    next.category = typeof next.category === 'string' ? next.category : '';
    next.component = typeof next.component === 'string' ? next.component : '';
    if(!Array.isArray(next.current)) next.current = [];
    if(!Array.isArray(next.removed)) next.removed = [];
    next.current = tmUniqueList(next.current);
    next.removed = tmUniqueList(next.removed, next.current.map(tmNormalizeKey));
    next.onlyWhenAboveEmpty = !!next.onlyWhenAboveEmpty;
    next.customRaw = typeof next.customRaw === 'string' ? next.customRaw : '';
    next.customList = Array.isArray(next.customList) ? tmUniqueList(next.customList) : tmNormalizeList(next.customRaw);
    return next;
  }

  function tmEnsureState(node){
    node.data = node.data || {};
    if(!Array.isArray(node.data.entries)) node.data.entries = [];
    node.data.entries = node.data.entries.map(tmEnsureEntryShape);
    if(typeof node.data.addCommandName !== 'string' || !node.data.addCommandName) node.data.addCommandName = 'add';
    if(typeof node.data.removeCommandName !== 'string' || !node.data.removeCommandName) node.data.removeCommandName = 'remove';
    return node.data.entries;
  }

  function tmEntryKey(category, component){
    return `${tmNormalizeName(category)}::${tmNormalizeName(component)}`;
  }

  function tmArrayEqual(a, b){
    if(a === b) return true;
    if(!Array.isArray(a) || !Array.isArray(b)) return false;
    if(a.length !== b.length) return false;
    for(let i = 0; i < a.length; i++){
      if(a[i] !== b[i]) return false;
    }
    return true;
  }

  function tmParseStructure(payload){
    if(!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const entries = [];
    Object.entries(payload).forEach(([catName, compObj]) => {
      if(!compObj || typeof compObj !== 'object' || Array.isArray(compObj)) return;
      Object.entries(compObj).forEach(([compName, tags]) => {
        entries.push({
          category: typeof catName === 'string' ? catName : '',
          component: typeof compName === 'string' ? compName : '',
          tags: tmNormalizeList(tags)
        });
      });
    });
    return entries.length ? entries : null;
  }

  function tmSyncEntriesFromStructure(node, structure){
    if(!Array.isArray(structure) || !structure.length) return false;
    const prevMap = new Map();
    (node.data.entries || []).forEach(entry => {
      prevMap.set(tmEntryKey(entry.category, entry.component), tmEnsureEntryShape(entry));
    });
    const nextEntries = [];
    let mutated = false;
    structure.forEach(item => {
      const key = tmEntryKey(item.category, item.component);
      const prev = prevMap.get(key);
      const inbound = tmUniqueList(item.tags);
      if(prev){
        if(!tmArrayEqual(prev.current, inbound)){
          prev.current = inbound;
          mutated = true;
        }
        const blocked = inbound.map(tmNormalizeKey);
        const filteredRemoved = tmUniqueList(prev.removed, blocked);
        if(!tmArrayEqual(prev.removed, filteredRemoved)){
          prev.removed = filteredRemoved;
          mutated = true;
        }
        prev.category = item.category;
        prev.component = item.component;
        nextEntries.push(prev);
        prevMap.delete(key);
      }else{
        const created = tmEnsureEntryShape({
          category: item.category,
          component: item.component,
          current: inbound,
          removed: [],
          onlyWhenAboveEmpty: false,
          customRaw: '',
          customList: []
        });
        nextEntries.push(created);
        mutated = true;
      }
    });
    if(prevMap.size) mutated = true;
    node.data.entries = nextEntries;
    return mutated;
  }

  function tmFindTagIndex(list, normalizedKey){
    if(!Array.isArray(list)) return -1;
    for(let i = 0; i < list.length; i++){
      if(tmNormalizeKey(list[i]) === normalizedKey) return i;
    }
    return -1;
  }

  function tmMoveTag(entry, normalizedKey, fromField, toField){
    if(!Array.isArray(entry[fromField])) entry[fromField] = [];
    if(!Array.isArray(entry[toField])) entry[toField] = [];
    const idx = tmFindTagIndex(entry[fromField], normalizedKey);
    if(idx === -1) return false;
    const [tag] = entry[fromField].splice(idx, 1);
    if(tmFindTagIndex(entry[toField], normalizedKey) === -1){
      entry[toField].push(tag);
    }
    return true;
  }

  function tmPickMetaField(sources, keys){
    for(const src of sources){
      if(!src || typeof src !== 'object') continue;
      for(const key of keys){
        if(src[key] !== undefined && src[key] !== null){
          return src[key];
        }
      }
    }
    return '';
  }

  function tmNormalizeCommandToken(value){
    if(typeof value !== 'string') return '';
    return value.trim().toLowerCase().replace(/[\s_]+/g, '');
  }

  function tmParseCommands(input, options){
    options = options || {};
    const addAliasNorm = tmNormalizeCommandToken(options.addAlias) || 'add';
    const removeAliasNorm = tmNormalizeCommandToken(options.removeAlias) || 'remove';
    const matchAction = (name) => {
      const normalized = tmNormalizeCommandToken(name);
      if(!normalized) return null;
      if(normalized === addAliasNorm || normalized === 'add') return 'add';
      if(normalized === removeAliasNorm || normalized === 'remove') return 'remove';
      return null;
    };
    const pickCommandField = (obj, action) => {
      if(!obj || typeof obj !== 'object') return undefined;
      for(const key of Object.keys(obj)){
        if(matchAction(key) === action){
          return obj[key];
        }
      }
      return undefined;
    };
    const commands = [];
    const pushCommand = (action, tagsSource, metaSources) => {
      const tags = tmNormalizeList(tagsSource);
      if(!tags.length) return;
      const componentRaw = tmPickMetaField(metaSources, ['component','component_name','componentName','target_component','targetComponent']);
      const categoryRaw = tmPickMetaField(metaSources, ['category','category_name','categoryName']);
      commands.push({
        action,
        tags,
        component: tmNormalizeName(componentRaw),
        category: tmNormalizeName(categoryRaw)
      });
    };

    const tryParseJson = (value) => {
      if(typeof value !== 'string') return null;
      const trimmed = value.trim();
      if(!trimmed) return null;
      try{ return JSON.parse(trimmed); }
      catch(_e){ return null; }
    };

    const emitCommand = (action, payload, metaSources = []) => {
      if(payload == null) return;
      let source = payload;
      let meta = Array.isArray(metaSources) ? metaSources.slice() : [];
      if(typeof source === 'string'){
        const parsed = tryParseJson(source);
        if(parsed !== null) source = parsed;
      }
      if(source && typeof source === 'object' && !Array.isArray(source)){
        meta.unshift(source);
        const nested = source.tags || source.values || source.list || source.data || source.raw || source.allowed || pickCommandField(source, action);
        if(nested !== undefined) source = nested;
      }
      pushCommand(action, source, meta);
    };

    const visit = (item, metaStack = [], depth = 0) => {
      if(item == null || depth > 16) return;
      if(typeof item === 'string'){
        const parsed = tryParseJson(item);
        if(parsed !== null){
          visit(parsed, metaStack, depth + 1);
        }
        return;
      }
      if(Array.isArray(item)){
        item.forEach(child => visit(child, metaStack, depth + 1));
        return;
      }
      if(typeof item !== 'object') return;

      Object.keys(item).forEach(key => {
        const maybeAction = matchAction(key);
        if(maybeAction){
          emitCommand(maybeAction, item[key], [item, ...metaStack]);
        }
      });

      const rawName = item.name || (item.function && item.function.name) || '';
      const actionName = matchAction(rawName);
      if(actionName === 'add' || actionName === 'remove'){
        let args = item.arguments || item.args || (item.function && item.function.arguments) || {};
        if(typeof args === 'string'){
          const parsedArgs = tryParseJson(args);
          if(parsedArgs !== null) args = parsedArgs;
        }
        let tagSource;
        if(Array.isArray(args) || typeof args === 'string'){
          tagSource = args;
        }else if(args && typeof args === 'object'){
          tagSource = args.tags || args.values || args.list || args.tag || args.value || args.data || pickCommandField(args, actionName);
        }
        if(tagSource === undefined && item && typeof item === 'object'){
          tagSource = pickCommandField(item, actionName);
        }
        if(tagSource === undefined) tagSource = args;
        emitCommand(actionName, tagSource, [args, item, ...metaStack]);
        visit(args, [args, item, ...metaStack], depth + 1);
      }

      Object.values(item).forEach(child => visit(child, [item, ...metaStack], depth + 1));
    };

    const initial = Array.isArray(input) ? input.flat(Infinity) : (input ? [input] : []);
    initial.forEach(item => visit(item, []));
    return commands;
  }

  function tmApplyCommands(entries, commands){
    if(!Array.isArray(entries) || !Array.isArray(commands) || !commands.length) return false;
    let mutated = false;
    commands.forEach(cmd => {
      entries.forEach(entry => {
        if(cmd.component && tmNormalizeName(entry.component) !== cmd.component) return;
        if(cmd.category && tmNormalizeName(entry.category) !== cmd.category) return;
        cmd.tags.forEach(tag => {
          const key = tmNormalizeKey(tag);
          if(!key) return;
          if(cmd.action === 'remove'){
            mutated = tmMoveTag(entry, key, 'current', 'removed') || mutated;
          }else if(cmd.action === 'add'){
            mutated = tmMoveTag(entry, key, 'removed', 'current') || mutated;
          }
        });
      });
    });
    return mutated;
  }

  function tmEntriesSnapshot(entries){
    try{
      return JSON.stringify((entries || []).map(e => ({
        id: e.id,
        category: e.category,
        component: e.component,
        current: e.current,
        removed: e.removed,
        onlyWhenAboveEmpty: !!e.onlyWhenAboveEmpty,
        customRaw: e.customRaw
      })));
    }catch(_e){ return String(Date.now()); }
  }

  function tmBuildOutputs(entries){
    const structure = {};
    const removedStructure = {};
    const custom = [];
    if(!Array.isArray(entries) || !entries.length){
      return { structure, removedStructure, custom };
    }
    const catMap = new Map();
    entries.forEach(entry => {
      const cat = entry && typeof entry.category === 'string' && entry.category ? entry.category : null;
      const comp = entry && typeof entry.component === 'string' && entry.component ? entry.component : null;
      if(!cat || !comp) return;
      if(!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push(entry);
    });
    catMap.forEach((list, catName) => {
      structure[catName] = {};
      removedStructure[catName] = {};
      list.forEach((entry, idx) => {
        const prev = idx > 0 ? list[idx - 1] : null;
        const prevHas = prev && Array.isArray(prev.current) && prev.current.filter(Boolean).length > 0;
        const shouldEmit = entry.onlyWhenAboveEmpty ? !prevHas : true;
        const curated = Array.isArray(entry.current) ? entry.current.filter(Boolean) : [];
        structure[catName][entry.component] = shouldEmit ? curated.slice() : [];
        const removedList = Array.isArray(entry.removed) ? entry.removed.filter(Boolean) : [];
        removedStructure[catName][entry.component] = shouldEmit ? removedList.slice() : [];
        if(Array.isArray(entry.customList) && entry.customList.length && curated.length === 0){
          custom.push(...entry.customList);
        }
      });
    });
    return { structure, removedStructure, custom: tmUniqueList(custom) };
  }
  
  const TM_TAGS_UPDATED_EVENT = 'maid-chan:tags-storage:updated';

  function tmLoadGraphSnapshot(){
    try{
      const api = window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.AILogic;
      if(api && typeof api.loadGraph === 'function'){
        const graph = api.loadGraph();
        if(graph && typeof graph === 'object') return graph;
      }
    }catch(_e){}
    try{
      const raw = window.localStorage.getItem('maid-chan:logic:graph');
      return raw ? JSON.parse(raw) : {};
    }catch(_e){ return {}; }
  }

  function tmCategoriesToStructureSnapshot(categories){
    const result = {};
    (categories || []).forEach(cat => {
      if(!cat || typeof cat !== 'object') return;
      const catName = typeof cat.name === 'string' ? cat.name.trim() : '';
      if(!catName) return;
      const compMap = {};
      (cat.components || []).forEach(comp => {
        if(!comp || typeof comp !== 'object') return;
        const compName = typeof comp.name === 'string' ? comp.name.trim() : '';
        if(!compName) return;
        compMap[compName] = tmNormalizeList(comp.tags);
      });
      result[catName] = compMap;
    });
    return result;
  }

  function tmReadStoredSnapshot(nodeId){
    if(nodeId == null) return null;
    try{
      const raw = window.localStorage.getItem(`maid-chan:tags-storage:last:${nodeId}`);
      if(!raw) return null;
      const payload = JSON.parse(raw);
      if(payload && typeof payload === 'object'){
        if(payload.structure && typeof payload.structure === 'object'){
          return payload.structure;
        }
      }
    }catch(_e){ return null; }
    return null;
  }

  function tmFindConnectedStorageInfo(nodeId){
    if(nodeId == null) return null;
    const graph = tmLoadGraphSnapshot();
    const nodes = new Map();
    (Array.isArray(graph.nodes) ? graph.nodes : []).forEach(n => {
      if(n && n.id !== undefined && n.id !== null){
        nodes.set(String(n.id), n);
      }
    });
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const targetId = String(nodeId);
    for(const edge of edges){
      if(!edge) continue;
      if(String(edge.toNodeId) !== targetId) continue;
      const idxRaw = edge.toPort;
      const idx = typeof idxRaw === 'number' ? idxRaw : (idxRaw == null ? 0 : parseInt(idxRaw, 10));
      if(idx !== 0) continue; // raw_results port
      const source = nodes.get(String(edge.fromNodeId));
      if(!source || source.type !== 'Tags storage') continue;
      const fromGraph = tmCategoriesToStructureSnapshot(source.data && source.data.categories);
      const fallback = tmReadStoredSnapshot(source.id);
      return {
        storageNodeId: String(source.id),
        structure: (fromGraph && typeof fromGraph === 'object') ? fromGraph : fallback
      };
    }
    return null;
  }
  // -----------------------

  add({
    type: 'LLM',
    category: 'process',
    ports: { inputs: [
        { id:'system_prompt', label:'System Prompt' },
        { id:'messages', label:'Messages' },
        { id:'tool_definitions', label:'Tool Definitions' },
        { id:'llm_settings', label:'LLM Settings' },
        { id:'flow', label:'Flow' },
        { id:'message_control', label:'Message Control' }
      ], outputs: [
        { id:'response_message', label:'Response Message' },
        { id:'tool_calls', label:'Tool Calls' }
      ] },
    defaultData(){ return { structured_output_enabled: false }; },
    buildConfigUI(bodyEl, node){
      node.data = node.data || {};
      if(typeof node.data.structured_output_enabled !== 'boolean'){
        node.data.structured_output_enabled = false;
      }

      const hint = document.createElement('div');
      hint.className='mc-chip';
      hint.textContent='Outputs plain text unless structured mode is enabled.';
      bodyEl.appendChild(hint);

      const toggleRow = document.createElement('div');
      toggleRow.className = 'mc-custom-msg-toggle-row';
      const toggleLabel = document.createElement('span');
      toggleLabel.className = 'mc-custom-msg-label';
      toggleLabel.textContent = 'Structured outputs (Gemini)';
      const toggleSwitch = document.createElement('div');
      toggleSwitch.className = 'mc-custom-msg-switch';
      const toggleKnob = document.createElement('div');
      toggleKnob.className = 'mc-custom-msg-knob';
      toggleSwitch.appendChild(toggleKnob);
      const syncToggle = () => {
        const enabled = !!node.data.structured_output_enabled;
        toggleSwitch.style.background = enabled ? '#ff6fa9' : '#3a3b44';
        toggleKnob.style.left = enabled ? '18px' : '2px';
      };
      toggleSwitch.onclick = () => {
        node.data.structured_output_enabled = !node.data.structured_output_enabled;
        syncToggle();
      };
      syncToggle();
      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggleSwitch);
      bodyEl.appendChild(toggleRow);

      const toggleHint = document.createElement('div');
      toggleHint.className = 'mc-chip';
      toggleHint.textContent = 'When on, Gemini returns JSON (text + optional fields from Tool Definitions).';
      bodyEl.appendChild(toggleHint);
      
      const btn = document.createElement('button');
      btn.textContent = 'Inspect Inputs';
      btn.className = 'mc-history-view-btn';
      btn.style.width = '100%';
      btn.style.marginTop = '8px';
      btn.onclick = () => showInspector(node.id);
      bodyEl.appendChild(btn);
    },
    // Gating: Only run if we have messages or a prompt.
    // If a Flow input is connected, it acts as an additional trigger-only gate.
    shouldRun(ctx) {
        const inputs = ctx.inputs || {};
        const hasMsg = Array.isArray(inputs.messages) ? inputs.messages.length > 0 : !!inputs.messages;
        const hasPrompt = Array.isArray(inputs.system_prompt) ? inputs.system_prompt.length > 0 : !!inputs.system_prompt;
        const hasFlow = Array.isArray(inputs.flow) ? inputs.flow.length > 0 : !!inputs.flow;
        if ('flow' in inputs) {
          return hasFlow && (hasMsg || hasPrompt);
        }
        return hasMsg || hasPrompt;
    },
    async execute(ctx){
      const inputs = ctx.inputs || {};
      const { messages, settings, allowedTools, customTools, structuredOutput } = prepareLLMRequest(inputs);
      const nodeData = (ctx && ctx.node && ctx.node.data) || {};
      const structuredModeEnabled = !!nodeData.structured_output_enabled;
      const cloneSchema = (schema) => {
        try { return JSON.parse(JSON.stringify(schema)); }
        catch(_e){ return schema; }
      };
      const buildStructuredPayload = (hints) => {
        const props = {};
        if(hints && hints.properties && typeof hints.properties === 'object'){
          Object.entries(hints.properties).forEach(([key, schema]) => {
            if(!key) return;
            const cloned = cloneSchema(schema);
            if(cloned && typeof cloned === 'object' && !cloned.type){
              cloned.type = 'string';
            }
            props[key] = cloned || { type: 'string' };
          });
        }
        if(!props.text){
          props.text = { type: 'string', description: 'Primary assistant reply text.' };
        }else if(typeof props.text === 'object'){
          if(!props.text.type) props.text.type = 'string';
          if(!props.text.description) props.text.description = 'Primary assistant reply text.';
        }
        const requiredSet = new Set(['text']);
        if(hints && Array.isArray(hints.required)){
          hints.required.forEach(r => { if(r) requiredSet.add(r); });
        }
        const requiredList = Array.from(requiredSet);
        const metadata = {
          fields: Object.keys(props),
          optional_fields: Object.keys(props).filter(name => !requiredSet.has(name)),
          source: 'maid-chan-llm'
        };
        return {
          enabled: true,
          schema: {
            type: 'object',
            properties: props,
            required: requiredList,
            additionalProperties: false
          },
          metadata
        };
      };
      const structuredPayload = structuredModeEnabled ? buildStructuredPayload(structuredOutput || null) : null;
      const controlRaw = inputs.message_control;
      const control = Array.isArray(controlRaw) ? controlRaw[controlRaw.length - 1] : controlRaw;
      const assistantIdFromControl = control && (control.assistant_message_id || control.assistantMessageId);
      const assistantIdFromContext = ctx && ctx.context && (ctx.context.assistantMessageId || ctx.context.assistant_message_id);
      const assistantMsgId = assistantIdFromControl || assistantIdFromContext || null;

      // 5. Call LLM
      const MaidCore = window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore;
      if(!MaidCore) return { response_message: { role: 'assistant', content: '(Error: MaidCore not found)' } };

      try {
        const res = await MaidCore.callLLMChat({ messages, settings, allowedTools, customTools, signal: ctx.signal, structuredOutput: structuredPayload });
        
        // 6. Return outputs
        const text = res.text || res.message || res.content || '';
        
        // Extract tool calls
        const calls = (function(r){
          if(!r || typeof r !== 'object') return [];
          if(r.type === 'tool_calls' && Array.isArray(r.calls)) return r.calls;
          if(r.type === 'tool_call' && r.name) return [r];
          if(Array.isArray(r.function_calls)) return r.function_calls;
          return [];
        })(res);

        let structuredData = null;
        if(structuredPayload){
          if(res && typeof res.structured_output === 'object'){
            structuredData = res.structured_output;
          }else if(res && res.structured_output_raw){
            structuredData = {
              raw: res.structured_output_raw,
              error: res.structured_output_error || 'Structured output missing'
            };
          }else if(res && res.structured_output_error){
            structuredData = { error: res.structured_output_error };
          }
        }

        const responseMsg = { role: 'assistant', content: text };
        if(assistantMsgId){
          responseMsg.id = assistantMsgId;
          responseMsg.assistant_message_id = assistantMsgId;
        }
        try{
          console.log('[MaidLogic][LLM]', { nodeId: ctx?.node?.id, assistantMessageId: responseMsg.id || null, hadControlId: !!assistantMsgId });
        }catch(_e){/* noop */}
        if(!structuredPayload && calls.length) responseMsg.tool_calls = calls;

        const toolOutput = structuredPayload ? (structuredData || null) : (calls.length ? calls : null);

        return { 
            response_message: responseMsg,
            tool_calls: toolOutput,
            _raw: res 
        };
      } catch(err) {
        return { response_message: { role: 'assistant', content: `(Error: ${err.message})` } };
      }
    }
  });

  // Tools execution node (moved from output.js): executes tool calls emitted by an LLM
  add({
    type: 'Tools execution',
    category: 'process',
    ports: { 
        inputs: [ { id:'tool_calls', label:'Tool Calls' } ], 
        outputs: [ 
            { id:'system_prompt', label:'System Prompt' }, 
            { id:'tool_results', label:'Raw Results' } 
        ] 
    },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){
      const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='Executes tool calls from LLM'; bodyEl.appendChild(hint);
      const note = document.createElement('div'); note.style.fontSize='12px'; note.style.opacity='.8'; note.textContent='Runs capabilities for standard tools. Custom choice tools are ignored here.'; bodyEl.appendChild(note);
    },
    async execute(ctx){
      try{
        const input = ctx && ctx.inputs ? ctx.inputs.tool_calls : null;
        // Flatten inputs
        const calls = (Array.isArray(input) ? input.flat() : []).filter(c => c && typeof c === 'object');
        
        if(!calls.length) return {};

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

        const results = [];
        const outputMessages = [];

        // Execute tools
        for (const call of calls) {
            // Handle both OpenAI style and internal style
            const name = call.name || (call.function && call.function.name);
            let args = call.arguments || call.args || (call.function && call.function.arguments) || {};
            if (typeof args === 'string') {
                try { args = JSON.parse(args); } catch(e) {}
            }

            let result = null;
            const fn = name ? String(name) : '';
            if(!fn) continue;
            // Skip custom choice tool; handled by Choice nodes
            if(fn === 'mc_choice' || fn === 'choice' || fn.toLowerCase().includes('choice')) continue;

            try{
              const cap = resolveCap(fn);
              if(cap && capsSvc && typeof capsSvc.invoke === 'function'){
                result = await capsSvc.invoke(cap.id, args, { source: 'maid' });
                results.push({ name: fn, args, result, ok: true });
              }else{
                // Broadcast event for external handlers
                window.dispatchEvent(new CustomEvent('maid-chan:tools:execute', { detail: { name: fn, args } }));
                results.push({ name: fn, args, result: null, ok: true, via: 'event' });
              }
              
              // Create tool output message
              outputMessages.push({
                  role: 'tool',
                  tool_call_id: call.id, 
                  name: fn,
                  content: typeof result === 'string' ? result : JSON.stringify(result)
              });

            }catch(_e){ 
                const err = String(_e&&_e.message||_e);
                results.push({ name: fn, args, ok: false, error: err }); 
                outputMessages.push({
                  role: 'tool',
                  tool_call_id: call.id,
                  name: fn,
                  content: `Error: ${err}`
                });
            }
        }

        // Format for System Prompt (summary)
        const formatResult = (r) => {
            if (!r || !r.result) return '';
            const res = r.result;
            if (typeof res === 'string') return res;
            if (typeof res === 'object') {
                const parts = [];
                for (const [k, v] of Object.entries(res)) {
                    parts.push(`${k}: ${v}`);
                }
                return `[${parts.join(', ')}]`;
            }
            return String(res);
        };
        const summary = results.map(formatResult).join('\n');

        return { 
            system_prompt: { role: 'system', content: summary },
            tool_results: results 
        };
      }catch(_e){ return {}; }
    }
  });
  // Custom messages node: allows formatting or replacing content from Raw Results
  add({
    type: 'Custom messages',
    category: 'process',
    ports: { 
      inputs: [ { id:'tool_results', label:'Raw Results' } ], 
      outputs: [ { id:'response_message', label:'Response Message' } ] 
    },
    defaultData(){ return { mode: 'prompt', template: '', customWords: '', replacements: [] }; },
    buildConfigUI(bodyEl, node, { onDataChange }){
      node.data = node.data || {};
      if(!node.data.mode) node.data.mode = 'prompt';
      if(!node.data.template) node.data.template = '';
      if(typeof node.data.customWords !== 'string') node.data.customWords = '';
      if(!Array.isArray(node.data.replacements)) node.data.replacements = [];

      const container = document.createElement('div');
      container.className = 'mc-custom-msg-container';

      // Toggle Switch
      const toggleRow = document.createElement('div');
      toggleRow.className = 'mc-custom-msg-toggle-row';
      
      const label = document.createElement('span');
      label.className = 'mc-custom-msg-label';
      label.textContent = node.data.mode === 'prompt' ? 'System Prompt Mode' : 'Replacer Mode';

      const toggleSwitch = document.createElement('div');
      toggleSwitch.className = 'mc-custom-msg-switch';
      toggleSwitch.style.background = node.data.mode === 'prompt' ? '#3a3b44' : '#ff6fa9';

      const toggleKnob = document.createElement('div');
      toggleKnob.className = 'mc-custom-msg-knob';
      toggleKnob.style.left = node.data.mode === 'prompt' ? '2px' : '18px';

      toggleSwitch.appendChild(toggleKnob);
      toggleSwitch.onclick = () => {
        node.data.mode = node.data.mode === 'prompt' ? 'replacer' : 'prompt';
        label.textContent = node.data.mode === 'prompt' ? 'System Prompt Mode' : 'Replacer Mode';
        toggleSwitch.style.background = node.data.mode === 'prompt' ? '#3a3b44' : '#ff6fa9';
        toggleKnob.style.left = node.data.mode === 'prompt' ? '2px' : '18px';
        updateVisibility();
        onDataChange();
      };

      toggleRow.appendChild(label);
      toggleRow.appendChild(toggleSwitch);
      container.appendChild(toggleRow);

      // Prompt Mode UI
      const promptContainer = document.createElement('div');
      const promptDesc = document.createElement('div');
      promptDesc.className = 'mc-chip';
      promptDesc.textContent = 'Use {{key}} to insert values from Raw Results. {{raw}} for full content.';
      promptContainer.appendChild(promptDesc);

      const fallbackWrap = document.createElement('div');
      fallbackWrap.className = 'mc-custom-msg-fallback';

      const fallbackLabel = document.createElement('label');
      fallbackLabel.className = 'mc-custom-msg-fallback-label';
      fallbackLabel.textContent = 'Custom words when {{key}} missing';

      const fallbackInput = document.createElement('input');
      fallbackInput.type = 'text';
      fallbackInput.className = 'mc-custom-msg-fallback-input';
      fallbackInput.value = node.data.customWords || '';
      fallbackInput.placeholder = 'Example: (unknown)';
      fallbackInput.oninput = () => {
        node.data.customWords = fallbackInput.value;
        onDataChange();
      };

      const fallbackHint = document.createElement('div');
      fallbackHint.className = 'mc-custom-msg-fallback-hint';
      fallbackHint.textContent = 'Fallback text when a key is missing or empty.';

      fallbackWrap.appendChild(fallbackLabel);
      fallbackWrap.appendChild(fallbackInput);
      fallbackWrap.appendChild(fallbackHint);
      promptContainer.appendChild(fallbackWrap);

      const textarea = document.createElement('textarea');
      textarea.className = 'mc-custom-msg-textarea';
      textarea.value = node.data.template;
      textarea.placeholder = 'Example: Her name is {{char_name}}...';
      textarea.oninput = () => {
        node.data.template = textarea.value;
        onDataChange();
      };
      promptContainer.appendChild(textarea);

      // Replacer Mode UI
      const replacerContainer = document.createElement('div');
      replacerContainer.className = 'mc-custom-msg-replacer-container';

      const replacerHeader = document.createElement('div');
      replacerHeader.className = 'mc-custom-msg-replacer-header';
      
      const replacerTitle = document.createElement('span');
      replacerTitle.className = 'mc-custom-msg-replacer-title';
      replacerTitle.textContent = 'Replacements';

      const addBtn = document.createElement('button');
      addBtn.className = 'mc-custom-msg-add-btn';
      addBtn.textContent = '+';
      addBtn.onclick = () => {
        node.data.replacements.push({ from: '', to: '' });
        renderReplacements();
        onDataChange();
      };

      replacerHeader.appendChild(replacerTitle);
      replacerHeader.appendChild(addBtn);
      replacerContainer.appendChild(replacerHeader);

      const listContainer = document.createElement('div');
      listContainer.className = 'mc-custom-msg-list';
      replacerContainer.appendChild(listContainer);

      function renderReplacements() {
        listContainer.innerHTML = '';
        node.data.replacements.forEach((rep, idx) => {
          const row = document.createElement('div');
          row.className = 'mc-custom-msg-row';

          const fromInp = document.createElement('input');
          fromInp.type = 'text';
          fromInp.className = 'mc-custom-msg-input';
          fromInp.value = rep.from;
          fromInp.placeholder = 'To replace';
          fromInp.onchange = () => { rep.from = fromInp.value; onDataChange(); };

          const arrow = document.createElement('span');
          arrow.className = 'mc-custom-msg-arrow';
          arrow.textContent = '→';

          const toInp = document.createElement('input');
          toInp.type = 'text';
          toInp.className = 'mc-custom-msg-input';
          toInp.value = rep.to;
          toInp.placeholder = 'Replacement';
          toInp.onchange = () => { rep.to = toInp.value; onDataChange(); };

          const delBtn = document.createElement('button');
          delBtn.className = 'mc-custom-msg-del-btn';
          delBtn.textContent = '✕';
          delBtn.onclick = () => {
            node.data.replacements.splice(idx, 1);
            renderReplacements();
            onDataChange();
          };

          row.appendChild(fromInp);
          row.appendChild(arrow);
          row.appendChild(toInp);
          row.appendChild(delBtn);
          listContainer.appendChild(row);
        });
      }

      function updateVisibility() {
        if (node.data.mode === 'prompt') {
          promptContainer.style.display = 'block';
          replacerContainer.style.display = 'none';
        } else {
          promptContainer.style.display = 'none';
          replacerContainer.style.display = 'flex';
          renderReplacements();
        }
      }

      container.appendChild(promptContainer);
      container.appendChild(replacerContainer);
      bodyEl.appendChild(container);
      
      updateVisibility();
    },
    execute(ctx) {
      const inputs = ctx.inputs || {};
      let rawResults = inputs.tool_results;
      if (!rawResults) rawResults = [];
      
      const mode = ctx.node.data.mode || 'prompt';

      if (mode === 'prompt') {
        let template = ctx.node.data.template || '';
        const originalTemplate = template;
        const placeholderRegex = /\{\{([^}]+)\}\}/g;
        const hasNonPlaceholderContent = originalTemplate.replace(placeholderRegex, '').trim().length > 0;
        let insertedAnyValue = false;
        const whitespaceOnlyRegex = /^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
        const isBlankString = (value) => typeof value === 'string' && whitespaceOnlyRegex.test(value);
        const isBlankValue = (value) => {
          if(value === undefined || value === null) return true;
          if(typeof value === 'string') return isBlankString(value);
          if(Array.isArray(value)) return value.length === 0 || value.every(isBlankValue);
          if(typeof value === 'object') return Object.keys(value).length === 0;
          return false;
        };
        const formatValue = (value) => {
          if(value === undefined || value === null) return '';
          if(Array.isArray(value)){
            const parts = value.map(v => formatValue(v)).filter(part => part !== '');
            return parts.join(', ');
          }
          if(typeof value === 'object'){
            try { return JSON.stringify(value); }
            catch(_e){ return String(value); }
          }
          return String(value);
        };
        
        const findValue = (obj, key) => {
            if (!obj) return undefined;
            if (typeof obj !== 'object') return undefined;
            if (!Array.isArray(obj) && key in obj) return obj[key];
            
            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const found = findValue(item, key);
                    if (found !== undefined) return found;
                }
            } else {
                for (const k in obj) {
                    if (obj[k] && typeof obj[k] === 'object') {
                        const found = findValue(obj[k], key);
                        if (found !== undefined) return found;
                    }
                }
            }
            return undefined;
        };

        const fallbackText = typeof ctx.node.data.customWords === 'string' ? ctx.node.data.customWords : '';
        const hasFallbackText = fallbackText.trim().length > 0;

        if (template.includes('{{raw}}')) {
          let rawStr = '';
          try { rawStr = JSON.stringify(rawResults, null, 2); }
          catch(e) { rawStr = String(rawResults); }
          template = template.replace(/\{\{raw\}\}/g, () => {
            if(rawStr) insertedAnyValue = true;
            return rawStr;
          });
        }

        template = template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
            key = key.trim();
            if (key === 'raw') return match;
            let val = findValue(rawResults, key);
          if (!isBlankValue(val)) {
            insertedAnyValue = true;
            return formatValue(val);
          }
          if (hasFallbackText) {
            insertedAnyValue = true;
            return fallbackText;
          }
          return match;
        });

        if (!hasNonPlaceholderContent && !insertedAnyValue) {
          return { response_message: null };
        }

        return { response_message: template };

      } else {
        const replacements = ctx.node.data.replacements || [];
        if (!replacements.length) return { response_message: rawResults };

        const applyReplacements = (str) => {
            let res = str;
            for (const rep of replacements) {
                if (rep.from) {
                    res = res.split(rep.from).join(rep.to || '');
                }
            }
            return res;
        };

        const process = (item) => {
            if (typeof item === 'string') {
                return applyReplacements(item);
            }
            if (Array.isArray(item)) {
                return item.map(process);
            }
            if (item && typeof item === 'object') {
                const newObj = {};
                for (const k in item) {
                    newObj[k] = process(item[k]);
                }
                return newObj;
            }
            return item;
        };

        const result = process(rawResults);
        return { response_message: result };
      }
    }
  });

  // Add Infinite Choice node: exposes a custom tool for LLM to pick among N options,
  // and emits a flow output to branch the execution context.
  const sanitizeIdentifier = (value) => {
    if(value == null) return '';
    const trimmed = String(value).trim();
    if(!trimmed) return '';
    return trimmed.replace(/\s+/g, '_');
  };

  add({
    type: 'Infinite Choice',
    category: 'process',
    ports: { 
        inputs: [ { id:'tool_calls', label:'Tool Calls' } ], 
        outputs: [ 
            { id:'tool_definitions', label:'Tool Definitions' }, 
            { id:'flow', label:'Flow', branching: true },
            { id:'raw_results', label:'Raw Results' }
        ] 
    },
    defaultData(){ 
      return { 
        toolName: 'mc_choice', 
        description: 'Select one option from the list', 
        properties: [],
        required: ''
      }; 
    },
    buildConfigUI(bodyEl, node, { onDataChange }){
      node.data = node.data || {};
      let mutated = false;
      if (!Array.isArray(node.data.properties)){
        const legacy = typeof node.data.options === 'string' ? node.data.options : '';
        const legacyList = legacy.split('\n').map(s=>s.trim()).filter(Boolean);
        node.data.properties = legacyList.length ? legacyList.map(opt => ({ name: opt, description: '' })) : [{ name: 'choice', description: 'Selected option name or description' }];
        delete node.data.options;
        mutated = true;
      }
      if (Array.isArray(node.data.required)){
        node.data.required = node.data.required.join('\n');
        mutated = true;
      }
      if(mutated && onDataChange){ onDataChange(node.data); }

      const applyAutoSize = (textarea) => {
        if(!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      };
      const initAutoSize = (textarea) => {
        if(!textarea) return;
        textarea.rows = 1;
        textarea.style.minHeight = '22px';
        textarea.style.resize = 'none';
        textarea.style.overflowY = 'hidden';
        const syncHeight = () => applyAutoSize(textarea);
        syncHeight();
        if(typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(syncHeight);
        } else {
          setTimeout(syncHeight, 0);
        }
      };

      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.gap='6px';
      
      const nameRow = document.createElement('div'); nameRow.style.display='flex'; nameRow.style.gap='6px'; nameRow.style.alignItems='center';
      const nameLab = document.createElement('span'); nameLab.textContent='Tool name'; nameLab.style.fontSize='12px'; nameLab.style.opacity='.8'; nameRow.appendChild(nameLab);
      const nameInp = document.createElement('input'); nameInp.type='text';
      const initialToolName = sanitizeIdentifier((node.data && node.data.toolName) || 'mc_choice') || 'mc_choice';
      nameInp.value = initialToolName;
      if(!node.data) node.data = {};
      node.data.toolName = initialToolName;
      nameInp.style.flex='1';
      nameInp.addEventListener('input', ()=>{
        const sanitized = sanitizeIdentifier(nameInp.value) || 'mc_choice';
        if(nameInp.value !== sanitized){
          nameInp.value = sanitized;
        }
        node.data.toolName = sanitized;
        onDataChange && onDataChange(node.data);
      });
      nameRow.appendChild(nameInp); wrap.appendChild(nameRow);

      const descLab = document.createElement('div'); descLab.textContent='Description'; descLab.style.fontSize='12px'; descLab.style.opacity='.8'; wrap.appendChild(descLab);
      const descTa = document.createElement('textarea');
      descTa.classList.add('mc-node-textarea-small');
      descTa.placeholder = 'Tool description for the LLM...';
      descTa.value = (node.data && node.data.description) || 'Select one option from the list';
      descTa.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.description = descTa.value; onDataChange && onDataChange(node.data); });
      descTa.addEventListener('input', ()=> applyAutoSize(descTa));
      initAutoSize(descTa);
      wrap.appendChild(descTa);

      const propLab = document.createElement('div'); propLab.textContent='Properties (string type)'; propLab.style.fontSize='12px'; propLab.style.opacity='.8'; wrap.appendChild(propLab);
      const propsContainer = document.createElement('div');
      propsContainer.style.display = 'flex';
      propsContainer.style.flexDirection = 'column';
      propsContainer.style.gap = '6px';
      wrap.appendChild(propsContainer);

      const renderProps = () => {
        propsContainer.innerHTML = '';
        const list = node.data.properties; 
        if(!list.length){
          list.push({ name: '', description: '' });
          onDataChange && onDataChange(node.data);
        }
        list.forEach((prop, idx) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.flexDirection = 'column';
          row.style.gap = '4px';
          row.style.padding = '8px';
          row.style.border = '1px solid #2b2d36';
          row.style.borderRadius = '6px';
          row.style.background = '#11131a';

          const header = document.createElement('div');
          header.style.display = 'flex';
          header.style.gap = '6px';
          header.style.alignItems = 'center';

          const nameInp = document.createElement('input');
          nameInp.type = 'text';
          nameInp.placeholder = 'Property name';
          const sanitizedPropName = sanitizeIdentifier(prop.name || '');
          prop.name = sanitizedPropName;
          nameInp.value = sanitizedPropName;
          nameInp.style.flex = '1';
          nameInp.addEventListener('input', ()=>{
            const sanitized = sanitizeIdentifier(nameInp.value);
            if(nameInp.value !== sanitized){
              nameInp.value = sanitized;
            }
            prop.name = sanitized;
            onDataChange && onDataChange(node.data);
          });
          header.appendChild(nameInp);

          const delBtn = document.createElement('button');
          delBtn.textContent = '✕';
          delBtn.style.fontSize = '11px';
          delBtn.style.padding = '2px 6px';
          delBtn.onclick = () => {
            node.data.properties.splice(idx, 1);
            renderProps();
            onDataChange && onDataChange(node.data);
          };
          header.appendChild(delBtn);

          const descTa = document.createElement('textarea');
          descTa.classList.add('mc-node-textarea-small');
          descTa.placeholder = 'Description shown to the LLM...';
          descTa.value = prop.description || '';
          descTa.addEventListener('input', ()=>{ prop.description = descTa.value; onDataChange && onDataChange(node.data); applyAutoSize(descTa); });
          initAutoSize(descTa);

          row.appendChild(header);
          row.appendChild(descTa);
          propsContainer.appendChild(row);
        });

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Add property';
        addBtn.style.fontSize = '12px';
        addBtn.style.alignSelf = 'flex-start';
        addBtn.onclick = () => {
          node.data.properties.push({ name: '', description: '' });
          renderProps();
          onDataChange && onDataChange(node.data);
        };
        propsContainer.appendChild(addBtn);
      };

      renderProps();

      const reqLab = document.createElement('div');
      reqLab.textContent = 'Required fields (comma or newline)';
      reqLab.style.fontSize = '12px';
      reqLab.style.opacity = '.8';
      wrap.appendChild(reqLab);
      const reqTa = document.createElement('textarea');
      reqTa.rows = 2;
      reqTa.placeholder = 'date, time, topic';
      reqTa.classList.add('mc-node-textarea-small');
      reqTa.value = typeof node.data.required === 'string' ? node.data.required : '';
      reqTa.addEventListener('input', ()=>{ node.data.required = reqTa.value; onDataChange && onDataChange(node.data); });
      wrap.appendChild(reqTa);

      bodyEl.appendChild(wrap);
    },
    execute(ctx){
      const d = (ctx && ctx.node && ctx.node.data) || {};
      const rawName = (d.toolName || 'mc_choice').toString();
      const name = sanitizeIdentifier(rawName) || 'mc_choice';
      const description = (d.description || 'Select one option from the list').toString();
      const rawProps = Array.isArray(d.properties) ? d.properties : [];
      const properties = rawProps.map(prop => ({
        name: sanitizeIdentifier(prop && prop.name ? prop.name : ''),
        description: (prop && prop.description ? String(prop.description) : '').trim()
      })).filter(prop => prop.name);
      if(!properties.length){
        properties.push({ name: 'choice', description: 'Selected option name or description' });
      }

      const propertiesMap = {};
      properties.forEach(prop => {
        const def = { type: 'string' };
        if(prop.description) def.description = prop.description;
        propertiesMap[prop.name] = def;
      });

      const requiredRaw = Array.isArray(d.required)
        ? d.required
        : (typeof d.required === 'string' ? d.required.split(/[\n,]+/) : []);
      const required = requiredRaw
        .map(s => sanitizeIdentifier(s))
        .filter(Boolean)
        .filter(key => propertiesMap[key]);

      // 1. Generate Tool Definition
      const tool = { 
          name, 
          description, 
          parameters: { 
              type:'object', 
              properties: propertiesMap
          } 
      };
      if(required.length){
        tool.parameters.required = required;
      }

      const normalizeArgs = (raw) => {
        if(!raw) return {};
        if(typeof raw === 'object') return raw;
        if(typeof raw === 'string'){
          try{ return JSON.parse(raw); }catch(_e){ return {}; }
        }
        return {};
      };

      // 2. Check for execution results
      const selectedIndexes = new Set();
      const propertyValues = {};
      const pushSelection = (idx, key, value) => {
        if(!Number.isInteger(idx)) return;
        if(idx < 0 || idx >= properties.length) return;
        selectedIndexes.add(idx);
        if(key){
          if(value === undefined || value === null) return;
          const str = String(value).trim();
          if(str === '') return;
          if(!(key in propertyValues)){
            propertyValues[key] = value;
          }
        }
      };

      const inputs = (ctx.inputs && ctx.inputs.tool_calls) ? ctx.inputs.tool_calls : [];
      const calls = inputs.flat();
      const matches = [];
      
      for(const call of calls){
          if(!(call && call.name === name)) continue;
          const parsedArgs = normalizeArgs(call.arguments);
          matches.push(Object.assign({}, call, { arguments: parsedArgs }));
          if(parsedArgs){
            for(let i = 0; i < properties.length; i += 1){
              const key = properties[i].name;
              if(Object.prototype.hasOwnProperty.call(parsedArgs, key)){
                const val = parsedArgs[key];
                if(val !== undefined && val !== null && String(val).trim() !== ''){
                  pushSelection(i, key, val);
                }
              }
            }
            if(typeof parsedArgs.choice === 'string'){
              const idx = properties.findIndex(prop => prop.name === parsedArgs.choice);
              if(idx >= 0){
                const key = properties[idx].name;
                const val = parsedArgs[key] !== undefined ? parsedArgs[key] : parsedArgs.choice;
                pushSelection(idx, key, val);
              }
            }
            if(typeof parsedArgs.index === 'number'){
              pushSelection(parsedArgs.index, properties[parsedArgs.index] && properties[parsedArgs.index].name, parsedArgs.choice || parsedArgs.value || parsedArgs.index);
            }
          }
      }

      const result = { tool_definitions: { custom: [tool] }, raw_results: matches };
      const structuredProps = {};
      properties.forEach(prop => {
        if(!prop || !prop.name) return;
        structuredProps[prop.name] = {
          type: 'string',
          description: prop.description || `Value captured for ${prop.name}`
        };
      });
      if(Object.keys(structuredProps).length){
        const structuredContribution = { properties: structuredProps };
        if(required.length){
          structuredContribution.required = required.slice();
        }
        result.tool_definitions.structured_output = structuredContribution;
      }
      
      if(selectedIndexes.size){
          const indexesArr = Array.from(selectedIndexes).sort((a,b) => a - b);
          const selectedProps = indexesArr
            .map(idx => properties[idx] && properties[idx].name)
            .filter(Boolean)
            .map(name => ({ name, value: propertyValues[name] }));
          const flowPayload = { indexes: indexesArr, value: { properties: selectedProps } };
          if(indexesArr.length === 1){
            flowPayload.__branchIndex = indexesArr[0];
            if(selectedProps.length === 1){
              flowPayload.value.property = selectedProps[0].name;
            }
          }
          result.flow = flowPayload;
      }

      return result;
    }
  });

  add({
    type: 'Message builder',
    category: 'process',
    ports: {
      inputs: [ { id: 'raw_results', label: 'Raw Results' } ],
      outputs: [ { id: 'system_prompt', label: 'System Prompt' }, { id: 'messages', label: 'Messages' } ]
    },
    defaultData() { return { role: 'system' }; },
    buildConfigUI(bodyEl, node, { onDataChange }) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      
      const label = document.createElement('span');
      label.textContent = 'Role:';
      label.style.fontSize = '12px';
      
      const select = document.createElement('select');
      select.className = 'mc-node-select';
      select.style.flex = '1';
      ['system', 'user', 'assistant', 'model'].forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        if (r === (node.data.role || 'system')) opt.selected = true;
        select.appendChild(opt);
      });
      
      select.addEventListener('change', () => {
        node.data.role = select.value;
        onDataChange(node.data);
      });
      
      row.appendChild(label);
      row.appendChild(select);
      bodyEl.appendChild(row);
    },
    execute(ctx) {
      const raw = (ctx.inputs && ctx.inputs.raw_results);
      const targetRole = ctx.node.data.role || 'system';
      
      const processItem = (item) => {
          if (item === undefined || item === null) return null;
          
          let content = '';
          let baseMsg = {};
          
          if (typeof item === 'string') {
              content = item;
              baseMsg = { role: targetRole, content: item };
          } else if (typeof item === 'object') {
              if ('content' in item) {
                  content = item.content;
                  baseMsg = { ...item, role: targetRole };
              } else {
                  content = JSON.stringify(item);
                  baseMsg = { role: targetRole, content: content };
              }
          } else {
              content = String(item);
              baseMsg = { role: targetRole, content: content };
          }
          
          return { content, message: baseMsg };
      };

      let system_prompt = [];
      let messages = [];

      if (Array.isArray(raw)) {
          const flat = raw.flat();
          for (const item of flat) {
              const res = processItem(item);
              if (res) {
                  system_prompt.push(res.content);
                  messages.push(res.message);
              }
          }
      } else {
          const res = processItem(raw);
          if (res) {
              system_prompt.push(res.content);
              messages.push(res.message);
          }
      }

      return {
          system_prompt: system_prompt.length === 1 ? system_prompt[0] : system_prompt,
          messages: messages
      };
    }
  });

  add({
    type: 'Tags manager',
    category: 'process',
    ports: {
      inputs: [
        { id: 'raw_results', label: 'Raw Results' },
        { id: 'tool_calls', label: 'Tool Calls' }
      ],
      outputs: [
        { id: 'raw_results', label: 'Current tags' },
        { id: 'removed_tags', label: 'Removed tags' },
        { id: 'custom_tags', label: 'Custom tags' }
      ]
    },
    defaultData(){
      return { entries: [], addCommandName: 'add', removeCommandName: 'remove' };
    },
    buildConfigUI(bodyEl, node, { onDataChange }){
      tmEnsureState(node);
      if(!node.data) node.data = {};
      if(typeof node.data.addCommandName !== 'string' || !node.data.addCommandName) node.data.addCommandName = 'add';
      if(typeof node.data.removeCommandName !== 'string' || !node.data.removeCommandName) node.data.removeCommandName = 'remove';
      const emitChange = () => {
        if(typeof onDataChange === 'function') onDataChange(node.data);
      };

      const applyStructureFromStorage = (structure) => {
        const parsed = tmParseStructure(structure);
        if(!parsed) return false;
        const mutated = tmSyncEntriesFromStructure(node, parsed);
        if(mutated){
          emitChange();
          updateSnapshot();
          render();
        }
        return mutated;
      };

      const wrap = document.createElement('div');
      wrap.className = 'mc-tags-manager-wrap';

      const controls = document.createElement('div');
      controls.className = 'mc-tags-manager-controls';

      const buildCommandInput = (action) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mc-tags-manager-command-input';
        input.placeholder = action === 'add'
          ? 'Tên lệnh Add (mặc định: add)'
          : 'Tên lệnh Remove (mặc định: remove)';
        input.value = action === 'add' ? (node.data.addCommandName || 'add') : (node.data.removeCommandName || 'remove');
        input.oninput = () => {
          const val = input.value.trim() || (action === 'add' ? 'add' : 'remove');
          if(action === 'add') node.data.addCommandName = val;
          else node.data.removeCommandName = val;
          emitChange();
        };
        return input;
      };

      controls.appendChild(buildCommandInput('add'));
      controls.appendChild(buildCommandInput('remove'));
      const fetchBtn = document.createElement('button');
      fetchBtn.type = 'button';
      fetchBtn.className = 'mc-history-view-btn';
      fetchBtn.textContent = 'Get tags';
      fetchBtn.onclick = () => {
        fetchBtn.disabled = true;
        try{
          const info = tmFindConnectedStorageInfo(node.id);
          if(info && info.structure){
            applyStructureFromStorage(info.structure);
          }
        }finally{
          fetchBtn.disabled = false;
        }
      };
      controls.appendChild(fetchBtn);

      const hint = document.createElement('div');
      hint.className = 'mc-chip';
      hint.textContent = 'Theo dõi Current/Removed và thiết lập custom tags.';
      wrap.appendChild(controls);
      wrap.appendChild(hint);

      const listEl = document.createElement('div');
      listEl.className = 'mc-tags-manager-list';
      wrap.appendChild(listEl);
      bodyEl.appendChild(wrap);

      const snapshot = () => tmEntriesSnapshot(node.data.entries);
      let lastSnapshot = snapshot();
      const updateSnapshot = () => { lastSnapshot = snapshot(); };

      const render = () => {
        const entries = tmEnsureState(node);
        listEl.innerHTML = '';
        if(!entries.length){
          const empty = document.createElement('div');
          empty.className = 'mc-tags-manager-empty';
          empty.textContent = 'Chờ dữ liệu từ Raw Results (Tags storage).';
          listEl.appendChild(empty);
          return;
        }

        entries.forEach(entry => {
          const card = document.createElement('div');
          card.className = 'mc-tags-manager-card';

          const header = document.createElement('div');
          header.className = 'mc-tags-manager-header';
          const title = document.createElement('div');
          title.className = 'mc-tags-manager-title';
          title.textContent = `${entry.category || 'Không tên'} · ${entry.component || 'Component'}`;
          header.appendChild(title);

          const meta = document.createElement('div');
          meta.className = 'mc-tags-manager-meta';
          meta.textContent = `${entry.current.length} current · ${entry.removed.length} removed`;
          header.appendChild(meta);
          card.appendChild(header);

          const tabs = document.createElement('div');
          tabs.className = 'mc-tags-manager-tabs';
          const currentBtn = document.createElement('button');
          currentBtn.type = 'button';
          currentBtn.className = 'mc-tags-manager-tab active';
          currentBtn.textContent = 'Current';
          const removedBtn = document.createElement('button');
          removedBtn.type = 'button';
          removedBtn.className = 'mc-tags-manager-tab';
          removedBtn.textContent = 'Removed';
          tabs.appendChild(currentBtn);
          tabs.appendChild(removedBtn);
          card.appendChild(tabs);

          const viewer = document.createElement('textarea');
          viewer.className = 'mc-tags-manager-viewer';
          viewer.readOnly = true;
          viewer.spellcheck = false;
          viewer.style.resize = 'none';
          viewer.style.overflow = 'hidden';
          card.appendChild(viewer);

          const autoSizeViewer = () => {
            viewer.style.height = 'auto';
            const next = Math.min(180, Math.max(48, viewer.scrollHeight));
            viewer.style.height = `${next}px`;
          };

          const refreshViewer = (mode) => {
            const list = mode === 'removed' ? entry.removed : entry.current;
            viewer.value = list && list.length ? list.join(', ') : '(Empty)';
            viewer.dataset.empty = list && list.length ? '0' : '1';
            autoSizeViewer();
          };
          let active = 'current';
          const switchView = (mode) => {
            active = mode;
            if(mode === 'current'){
              currentBtn.classList.add('active');
              removedBtn.classList.remove('active');
            }else{
              removedBtn.classList.add('active');
              currentBtn.classList.remove('active');
            }
            refreshViewer(mode);
          };
          currentBtn.onclick = () => switchView('current');
          removedBtn.onclick = () => switchView('removed');
          switchView(active);

          const checkbox = document.createElement('label');
          checkbox.className = 'mc-tags-manager-checkbox';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!entry.onlyWhenAboveEmpty;
          cb.onchange = () => {
            entry.onlyWhenAboveEmpty = cb.checked;
            emitChange();
            updateSnapshot();
          };
          const cbText = document.createElement('span');
          cbText.textContent = 'Chỉ trả về khi thành phần trên trống';
          checkbox.appendChild(cb);
          checkbox.appendChild(cbText);
          card.appendChild(checkbox);

          const customWrap = document.createElement('div');
          customWrap.className = 'mc-tags-manager-custom';
          const customLabel = document.createElement('div');
          customLabel.textContent = 'Custom tags (fallback)';
          customWrap.appendChild(customLabel);
          const customInput = document.createElement('textarea');
          customInput.className = 'mc-tags-manager-custom-input';
          customInput.placeholder = 'tag1, tag2 hoặc xuống dòng';
          customInput.value = entry.customRaw || '';
          const autoSize = () => {
            customInput.style.height = 'auto';
            const next = Math.min(140, Math.max(48, customInput.scrollHeight));
            customInput.style.height = `${next}px`;
          };
          customInput.addEventListener('input', () => {
            entry.customRaw = customInput.value;
            entry.customList = tmNormalizeList(customInput.value);
            autoSize();
            emitChange();
            updateSnapshot();
          });
          autoSize();
          customWrap.appendChild(customInput);
          const customHint = document.createElement('div');
          customHint.className = 'mc-tags-manager-hint';
          customHint.textContent = 'Chỉ đẩy ra Custom tags khi Current trống.';
          customWrap.appendChild(customHint);
          card.appendChild(customWrap);

          listEl.appendChild(card);
        });
      };

      render();

      let poll = null;
      const teardown = () => {
        if(poll){
          clearInterval(poll);
          poll = null;
        }
      };

      poll = setInterval(() => {
        if(!document.body.contains(bodyEl)){
          teardown();
          return;
        }
        const next = snapshot();
        if(next !== lastSnapshot){
          render();
          lastSnapshot = next;
        }
      }, 650);

    },
    execute(ctx){
      const nodeRef = ctx.node || {};
      tmEnsureState(nodeRef);
      const inputs = ctx.inputs || {};
      let mutated = false;

      const structure = tmParseStructure(inputs.raw_results);
      if(structure){
        mutated = tmSyncEntriesFromStructure(nodeRef, structure) || mutated;
      }

      const commands = tmParseCommands(inputs.tool_calls, {
        addAlias: nodeRef.data.addCommandName,
        removeAlias: nodeRef.data.removeCommandName
      });
      if(commands.length){
        mutated = tmApplyCommands(nodeRef.data.entries, commands) || mutated;
      }

      if(mutated && typeof ctx.onDataChange === 'function'){
        ctx.onDataChange(nodeRef.data);
      }

      const outputs = tmBuildOutputs(nodeRef.data.entries);
      return {
        raw_results: outputs.structure,
        removed_tags: outputs.removedStructure,
        custom_tags: outputs.custom
      };
    }
  });
})();
