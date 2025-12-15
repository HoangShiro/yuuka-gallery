(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }

  function makeDefaultKey(node){
    const nodeId = node && node.id ? node.id : 'unknown';
    return `maid-chan:storage:${nodeId}`;
  }

  function safeClone(value){
    if(value === undefined) return null;
    if(typeof value === 'function') return null;
    try{
      return JSON.parse(JSON.stringify(value));
    }catch(_e){
      try{
        return typeof value === 'string' ? value : String(value);
      }catch(_e2){
        return null;
      }
    }
  }

  function readLocal(key){
    if(!key) return null;
    try{
      const raw = window.localStorage.getItem(key);
      if(raw == null) return null;
      try{
        return JSON.parse(raw);
      }catch(_e){
        return raw;
      }
    }catch(_e){ return null; }
  }

  function writeLocal(key, payload){
    if(!key) return;
    try{
      if(payload === undefined || payload === null){
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(payload));
    }catch(_e){ }
  }

  function tagsCreateId(){
    return `tag_${Math.random().toString(36).slice(2, 10)}`;
  }

  function tagsNormalizeList(value){
    if(value == null) return [];
    if(Array.isArray(value)){
      return value.map(v => (v == null ? '' : String(v))).map(v => v.trim()).filter(Boolean);
    }
    if(typeof value === 'string'){
      return value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
    }
    return [];
  }

  function tagsIsPlainObject(value){
    if(!value || typeof value !== 'object') return false;
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function tagsEnsureState(node){
    node.data = node.data || {};
    if(!Array.isArray(node.data.categories)) node.data.categories = [];
    node.data.categories.forEach(cat => {
      if(!Array.isArray(cat.components)) cat.components = [];
      cat.components.forEach(comp => {
        if(!Array.isArray(comp.tags)) comp.tags = [];
      });
    });
    return node.data.categories;
  }

  function tagsStructureToCategories(payload){
    const categories = [];
    if(!tagsIsPlainObject(payload)) return categories;
    Object.entries(payload).forEach(([catName, compObj]) => {
      const category = { id: tagsCreateId(), name: catName, components: [] };
      if(tagsIsPlainObject(compObj)){
        Object.entries(compObj).forEach(([compName, tagList]) => {
          category.components.push({
            id: tagsCreateId(),
            name: compName,
            tags: tagsNormalizeList(tagList)
          });
        });
      }
      categories.push(category);
    });
    return categories;
  }

  function tagsCategoriesToStructure(categories){
    const result = {};
    (categories || []).forEach(cat => {
      const catName = (cat && typeof cat.name === 'string') ? cat.name.trim() : '';
      if(!catName) return;
      const compMap = {};
      (cat.components || []).forEach(comp => {
        const compName = (comp && typeof comp.name === 'string') ? comp.name.trim() : '';
        if(!compName) return;
        compMap[compName] = tagsNormalizeList(comp.tags);
      });
      result[catName] = compMap;
    });
    return result;
  }

  function tagsIsStructure(payload){
    if(!tagsIsPlainObject(payload)) return false;
    return Object.values(payload).every(compObj => {
      if(!tagsIsPlainObject(compObj)) return false;
      return Object.values(compObj).every(tagList => Array.isArray(tagList));
    });
  }

  function tagsExtractComponentUpdates(payload){
    const updates = [];
    const push = (name, tags) => {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      const list = tagsNormalizeList(tags);
      if(!trimmed || list.length === 0) return;
      updates.push({ name: trimmed, tags: list });
    };
    const visit = (val) => {
      if(val == null) return;
      if(Array.isArray(val)){
        val.forEach(visit);
        return;
      }
      if(typeof val === 'string') return;
      if(!tagsIsPlainObject(val)) return;
      const name = val.name || val.component || val.componentName;
      if(name){
        push(name, val.tags || val.values || val.list || val.raw || val.raw_results || val.data);
        return;
      }
      Object.entries(val).forEach(([key, inner]) => {
        if(typeof inner === 'string' || Array.isArray(inner)){
          push(key, inner);
        }else if(tagsIsPlainObject(inner) && (inner.tags || inner.values)){
          push(key, inner.tags || inner.values);
        }
      });
    };
    visit(payload);
    return updates;
  }

  function tagsApplyComponentUpdates(categories, updates){
    if(!Array.isArray(categories) || !updates.length) return false;
    const map = new Map();
    categories.forEach(cat => {
      (cat.components || []).forEach(comp => {
        if(comp && comp.name){
          map.set(comp.name.trim().toLowerCase(), comp);
        }
      });
    });
    let mutated = false;
    updates.forEach(update => {
      const key = update.name.toLowerCase();
      const target = map.get(key);
      if(target){
        target.tags = update.tags.slice();
        mutated = true;
      }
    });
    return mutated;
  }

  const TAGS_DISPATCH_EVENT = 'maid-chan:logic:dispatch';
  const TAGS_UPDATED_EVENT = 'maid-chan:tags-storage:updated';

  function tagsGetAILogic(){
    return window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.AILogic;
  }

  function tagsLoadGraphFallback(){
    try{
      const raw = window.localStorage.getItem('maid-chan:logic:graph');
      return raw ? JSON.parse(raw) : { nodes: [], edges: [] };
    }catch(_e){ return { nodes: [], edges: [] }; }
  }

  function tagsSaveGraphFallback(graph){
    try{
      window.localStorage.setItem('maid-chan:logic:graph', JSON.stringify(graph || { nodes: [], edges: [] }));
    }catch(_e){}
  }

  function tagsLoadGraphWithSaver(){
    const api = tagsGetAILogic();
    if(api && typeof api.loadGraph === 'function'){
      return {
        graph: api.loadGraph(),
        save(next){
          if(api && typeof api.saveGraph === 'function') api.saveGraph(next);
          else tagsSaveGraphFallback(next);
        }
      };
    }
    return {
      graph: tagsLoadGraphFallback(),
      save: tagsSaveGraphFallback
    };
  }

  function tagsStoreSnapshot(nodeId, structure){
    if(!nodeId) return;
    try{
      window.localStorage.setItem(`maid-chan:tags-storage:last:${nodeId}`, JSON.stringify({ ts: Date.now(), structure }));
    }catch(_e){}
  }

  function tagsConsumePayload(node, payload){
    if(!node || payload == null) return false;
    tagsEnsureState(node);
    let mutated = false;
    if(tagsIsStructure(payload)){
      node.data.categories = tagsStructureToCategories(payload);
      tagsEnsureState(node);
      mutated = true;
    }else{
      const updates = tagsExtractComponentUpdates(payload);
      if(updates.length){
        mutated = tagsApplyComponentUpdates(node.data.categories, updates) || mutated;
      }
    }
    return mutated;
  }

  function tagsApplyPayloadToGraph(targetNodeId, payload){
    if(targetNodeId == null || payload == null) return false;
    const sanitized = safeClone(payload);
    if(sanitized == null) return false;
    let updated = false;
    try{
      const { graph, save } = tagsLoadGraphWithSaver();
      if(!graph || !Array.isArray(graph.nodes)) return false;
      const target = graph.nodes.find(n => String(n && n.id) === String(targetNodeId));
      if(!target || target.type !== 'Tags storage') return false;
      if(!tagsConsumePayload(target, sanitized)) return false;
      if(typeof save === 'function') save(graph);
      const structure = tagsCategoriesToStructure(target.data.categories);
      tagsStoreSnapshot(target.id, structure);
      try{
        window.dispatchEvent(new CustomEvent(TAGS_UPDATED_EVENT, { detail: { nodeId: target.id, source: 'dispatch', structure } }));
      }catch(_e){}
      updated = true;
    }catch(_e){ return false; }
    return updated;
  }

  if(!window.__MaidChanTagsDispatchListener){
    window.__MaidChanTagsDispatchListener = true;
    window.addEventListener(TAGS_DISPATCH_EVENT, (ev)=>{
      const detail = ev && ev.detail;
      if(!detail || detail.targetNodeId == null) return;
      tagsApplyPayloadToGraph(detail.targetNodeId, detail.payload);
    });
  }

  // Local storage buffer node
  add({
    type: 'Local storage buffer',
    category: 'storage',
    ports: {
      inputs: [ { id: 'raw_results', label: 'Raw Results' } ],
      outputs: [ { id: 'raw_results', label: 'Raw Results' } ]
    },
    defaultData(){
      return {
        storageKey: '',
        mode: 'replace',
        historyLimit: 20,
        emitStoredWhenEmpty: true,
        autoTimestamp: true
      };
    },
    buildConfigUI(bodyEl, node, { onDataChange }){
      node.data = node.data || {};
      if(typeof node.data.mode !== 'string') node.data.mode = 'replace';
      if(typeof node.data.historyLimit !== 'number') node.data.historyLimit = 20;
      if(typeof node.data.emitStoredWhenEmpty !== 'boolean') node.data.emitStoredWhenEmpty = true;
      if(typeof node.data.autoTimestamp !== 'boolean') node.data.autoTimestamp = true;

      const wrap = document.createElement('div');
      wrap.className = 'mc-node-col-loose';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'mc-node-input';
      keyInput.placeholder = 'localStorage key (optional)';
      keyInput.value = node.data.storageKey || '';
      keyInput.onchange = ()=>{
        node.data.storageKey = keyInput.value.trim();
        onDataChange();
      };

      const modeRow = document.createElement('div');
      modeRow.className = 'mc-node-row';
      const modeLabel = document.createElement('span');
      modeLabel.className = 'mc-node-label';
      modeLabel.textContent = 'Mode:';
      const modeSelect = document.createElement('select');
      modeSelect.className = 'mc-node-select';
      ['replace','append'].forEach(opt=>{
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt === 'append' ? 'Append history' : 'Replace value';
        modeSelect.appendChild(o);
      });
      modeSelect.value = node.data.mode;
      modeSelect.onchange = ()=>{
        node.data.mode = modeSelect.value;
        historyWrap.style.display = node.data.mode === 'append' ? 'flex' : 'none';
        onDataChange();
      };
      modeRow.appendChild(modeLabel);
      modeRow.appendChild(modeSelect);

      const historyWrap = document.createElement('div');
      historyWrap.className = 'mc-node-row';
      historyWrap.style.display = node.data.mode === 'append' ? 'flex' : 'none';
      const historyLabel = document.createElement('span');
      historyLabel.className = 'mc-node-label';
      historyLabel.textContent = 'History limit:';
      const historyInput = document.createElement('input');
      historyInput.type = 'number';
      historyInput.className = 'mc-node-input';
      historyInput.min = '0';
      historyInput.value = String(node.data.historyLimit || 0);
      historyInput.onchange = ()=>{
        const v = parseInt(historyInput.value, 10);
        node.data.historyLimit = isNaN(v) ? 0 : v;
        onDataChange();
      };
      historyWrap.appendChild(historyLabel);
      historyWrap.appendChild(historyInput);

      const optionsRow = document.createElement('label');
      optionsRow.className = 'mc-node-checkbox-row';
      const emitCheck = document.createElement('input');
      emitCheck.type = 'checkbox';
      emitCheck.checked = !!node.data.emitStoredWhenEmpty;
      emitCheck.onchange = ()=>{
        node.data.emitStoredWhenEmpty = emitCheck.checked;
        onDataChange();
      };
      const emitText = document.createElement('span');
      emitText.textContent = 'Emit stored value when input is empty';
      optionsRow.appendChild(emitCheck);
      optionsRow.appendChild(emitText);

      const tsRow = document.createElement('label');
      tsRow.className = 'mc-node-checkbox-row';
      const tsCheck = document.createElement('input');
      tsCheck.type = 'checkbox';
      tsCheck.checked = !!node.data.autoTimestamp;
      tsCheck.onchange = ()=>{
        node.data.autoTimestamp = tsCheck.checked;
        onDataChange();
      };
      const tsText = document.createElement('span');
      tsText.textContent = 'Wrap entries with timestamp (append mode)';
      tsRow.appendChild(tsCheck);
      tsRow.appendChild(tsText);

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'mc-node-btn';
      viewBtn.textContent = 'View stored value';
      viewBtn.onclick = ()=>{
        const key = (node.data.storageKey && node.data.storageKey.trim()) || makeDefaultKey(node);
        const val = readLocal(key);
        const pre = document.createElement('pre');
        pre.className = 'mc-preview-message';
        pre.style.maxHeight = '240px';
        pre.style.overflow = 'auto';
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = val == null ? '(empty)' : JSON.stringify(val, null, 2);
        const overlay = document.createElement('div');
        overlay.className = 'mc-overlay';
        overlay.style.zIndex = 10000;
        const inner = document.createElement('div');
        inner.className = 'mc-overlay-body';
        inner.style.maxWidth = '480px';
        inner.appendChild(pre);
        overlay.appendChild(inner);
        overlay.addEventListener('click', (ev)=>{
          if(ev.target === overlay){ document.body.removeChild(overlay); }
        });
        document.body.appendChild(overlay);
      };

      wrap.appendChild(keyInput);
      wrap.appendChild(modeRow);
      wrap.appendChild(historyWrap);
      wrap.appendChild(optionsRow);
      wrap.appendChild(tsRow);
      wrap.appendChild(viewBtn);

      bodyEl.appendChild(wrap);
    },
    execute(ctx){
      const node = ctx.node || {};
      node.data = node.data || {};
      const inputs = ctx.inputs || {};
      const incoming = inputs.raw_results;
      const key = (node.data.storageKey && node.data.storageKey.trim()) || makeDefaultKey(node);
      const mode = node.data.mode === 'append' ? 'append' : 'replace';
      const limit = typeof node.data.historyLimit === 'number' ? node.data.historyLimit : 0;

      const normalized = safeClone(incoming);

      if(key){
        if(mode === 'append'){
          let records = readLocal(key);
          if(!Array.isArray(records)) records = [];
          if(normalized !== null){
            const entry = node.data.autoTimestamp === false ? normalized : { timestamp: Date.now(), value: normalized };
            records.push(entry);
            if(limit > 0 && records.length > limit){
              records.splice(0, records.length - limit);
            }
          }
          if(records.length > 0){
            writeLocal(key, records);
          }else{
            writeLocal(key, null);
          }
        }else{
          if(normalized === null){
            writeLocal(key, null);
          }else{
            writeLocal(key, normalized);
          }
        }
      }

      let passthrough = incoming;
      if((passthrough === undefined || passthrough === null) && node.data.emitStoredWhenEmpty){
        passthrough = readLocal(key);
      }
      return { raw_results: passthrough };
    }
  });

  // Logger node moved from process.js into storage category
  add({
    type: 'Logger',
    category: 'storage',
    ports: {
      inputs: [
        { id: 'raw_results', label: 'Raw Results' }
      ],
      outputs: [
        { id: 'system_prompt', label: 'System Prompt' }
      ]
    },
    defaultData() {
      return {
        logs: [],
        minuteLimit: 60,
        logLimit: 50
      };
    },
    buildConfigUI(bodyEl, node, { onDataChange }) {
      node.data = node.data || {};
      if (!Array.isArray(node.data.logs)) node.data.logs = [];
      if (typeof node.data.minuteLimit !== 'number') node.data.minuteLimit = 60;
      if (typeof node.data.logLimit !== 'number') node.data.logLimit = 50;

      const container = document.createElement('div');
      container.className = 'mc-node-col-loose';

      const listEl = document.createElement('div');
      listEl.className = 'mc-node-col';
      container.appendChild(listEl);

      const controlsRow = document.createElement('div');
      controlsRow.className = 'mc-node-row';

      const minuteWrap = document.createElement('div');
      minuteWrap.className = 'mc-node-col';
      const minuteLabel = document.createElement('span');
      minuteLabel.className = 'mc-node-label';
      minuteLabel.textContent = 'Minute limit';
      const minuteInput = document.createElement('input');
      minuteInput.type = 'number';
      minuteInput.className = 'mc-node-input';
      minuteInput.min = '0';
      minuteInput.value = String(node.data.minuteLimit || 0);
      minuteInput.onchange = () => {
        const v = parseInt(minuteInput.value, 10);
        node.data.minuteLimit = isNaN(v) ? 0 : v;
        onDataChange();
      };
      minuteWrap.appendChild(minuteLabel);
      minuteWrap.appendChild(minuteInput);

      const logWrap = document.createElement('div');
      logWrap.className = 'mc-node-col';
      const logLabel = document.createElement('span');
      logLabel.className = 'mc-node-label';
      logLabel.textContent = 'Log limit';
      const logInput = document.createElement('input');
      logInput.type = 'number';
      logInput.className = 'mc-node-input';
      logInput.min = '0';
      logInput.value = String(node.data.logLimit || 0);
      logInput.onchange = () => {
        const v = parseInt(logInput.value, 10);
        node.data.logLimit = isNaN(v) ? 0 : v;
        if (node.data.logLimit > 0 && node.data.logs.length > node.data.logLimit) {
          node.data.logs.splice(0, node.data.logs.length - node.data.logLimit);
        }
        renderList();
        onDataChange();
      };
      logWrap.appendChild(logLabel);
      logWrap.appendChild(logInput);

      controlsRow.appendChild(minuteWrap);
      controlsRow.appendChild(logWrap);
      container.appendChild(controlsRow);

      let lastSnapshot = '';

      function formatLocalTime(ts) {
        const d = new Date(ts);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}/${dd} - ${hh}:${mi}`;
      }

      function renderList() {
        listEl.innerHTML = '';
        const now = Date.now();
        const minuteMs = (node.data.minuteLimit || 0) * 60 * 1000;
        node.data.logs = node.data.logs.filter(l => {
          if (!minuteMs) return true;
          return now - l.timestamp <= minuteMs;
        });
        if (node.data.logLimit > 0 && node.data.logs.length > node.data.logLimit) {
          node.data.logs.splice(0, node.data.logs.length - node.data.logLimit);
        }

        node.data.logs.forEach((log, idx) => {
          const row = document.createElement('div');
          row.className = 'mc-node-row';

          const timeSpan = document.createElement('span');
          timeSpan.style.fontSize = '10px';
          timeSpan.style.color = 'var(--mc-text-dim)';
          timeSpan.style.minWidth = '70px';
          timeSpan.textContent = formatLocalTime(log.timestamp);

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'mc-node-input';
          input.value = log.text || '';
          input.onchange = () => {
            log.text = input.value;
            onDataChange();
          };

          const btn = document.createElement('button');
          btn.className = 'mc-node-btn danger';
          btn.textContent = 'x';
          btn.style.width = '24px';
          btn.onclick = () => {
            node.data.logs.splice(idx, 1);
            renderList();
            onDataChange();
          };

          row.appendChild(timeSpan);
          row.appendChild(input);
          row.appendChild(btn);
          listEl.appendChild(row);
        });

        try {
          lastSnapshot = JSON.stringify(node.data.logs.map(l => ({
            t: l.timestamp,
            x: l.text
          })));
        } catch (_e) {
          lastSnapshot = '';
        }
      }

      renderList();
      bodyEl.appendChild(container);

      const pollInterval = setInterval(() => {
        if (!document.body.contains(bodyEl)) {
          clearInterval(pollInterval);
          return;
        }
        if (!node.data || !Array.isArray(node.data.logs)) return;
        let current = '';
        try {
          current = JSON.stringify(node.data.logs.map(l => ({
            t: l.timestamp,
            x: l.text
          })));
        } catch (_e) {
          current = '';
        }
        if (current !== lastSnapshot) {
          renderList();
        }
      }, 800);
    },
    execute(ctx) {
      const node = ctx.node;
      node.data = node.data || {};
      if (!Array.isArray(node.data.logs)) node.data.logs = [];

      const inputs = ctx.inputs || {};
      const raw = inputs.raw_results;
      const now = Date.now();

      let changed = false;

      if (raw !== undefined && raw !== null) {
        let text = '';
        try {
          if (typeof raw === 'string') {
            text = raw;
          } else if (Array.isArray(raw)) {
            text = raw.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
          } else if (typeof raw === 'object') {
            text = JSON.stringify(raw);
          } else {
            text = String(raw);
          }
        } catch (_e) {
          text = String(raw);
        }

        if (text) {
          node.data.logs.push({
            timestamp: now,
            text
          });
          changed = true;
        }
      }

      const beforeLen = node.data.logs.length;
      const minuteMs = (node.data.minuteLimit || 0) * 60 * 1000;
      if (minuteMs) {
        node.data.logs = node.data.logs.filter(l => now - l.timestamp <= minuteMs);
      }
      if (node.data.logLimit > 0 && node.data.logs.length > node.data.logLimit) {
        node.data.logs.splice(0, node.data.logs.length - node.data.logLimit);
      }
      if (beforeLen !== node.data.logs.length) {
        changed = true;
      }

      if (changed && typeof ctx.onDataChange === 'function') {
        ctx.onDataChange(node.data);
      }

      const lines = node.data.logs.map(l => {
        const d = new Date(l.timestamp);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        const timeStr = `${dd}/${mm} - ${hh}:${mi}`;
        return `${timeStr} | ${l.text || ''}`;
      });

      return {
        system_prompt: lines.join('\n')
      };
    }
  });

  add({
    type: 'Tags storage',
    category: 'storage',
    ports: {
      inputs: [
        { id: 'raw_results', label: 'Raw Results' }
      ],
      outputs: [
        { id: 'raw_results', label: 'Raw Results' }
      ]
    },
    defaultData(){
      return { categories: [] };
    },
    buildConfigUI(bodyEl, node, { onDataChange }){
      tagsEnsureState(node);
      const emitChange = () => {
        if(typeof onDataChange === 'function') onDataChange(node.data);
      };

      function snapshotValue(){
        try{
          return JSON.stringify((node.data && node.data.categories) || []);
        }catch(_e){ return ''; }
      }

      let lastSnapshot = snapshotValue();
      const updateSnapshot = () => { lastSnapshot = snapshotValue(); };

      const wrap = document.createElement('div');
      wrap.className = 'mc-tags-node-wrap';

      const hint = document.createElement('div');
      hint.className = 'mc-chip mc-tags-node-hint';
      hint.textContent = 'Quản lý danh sách tags theo loại / thành phần';
      wrap.appendChild(hint);

      const categoriesContainer = document.createElement('div');
      categoriesContainer.className = 'mc-tags-node-categories';
      wrap.appendChild(categoriesContainer);

      const addCategoryBtn = document.createElement('button');
      addCategoryBtn.type = 'button';
      addCategoryBtn.className = 'mc-node-btn mc-tags-node-add-category';
      addCategoryBtn.textContent = '+ Thêm loại tags';
      addCategoryBtn.onclick = () => {
        node.data.categories.push({ id: tagsCreateId(), name: '', components: [] });
        tagsEnsureState(node);
        emitChange();
        renderAndStore();
      };
      wrap.appendChild(addCategoryBtn);

      bodyEl.appendChild(wrap);

      function renderCategories(){
        tagsEnsureState(node);
        categoriesContainer.innerHTML = '';
        const categories = node.data.categories;
        if(!categories.length){
          const empty = document.createElement('div');
          empty.className = 'mc-tags-node-empty';
          empty.textContent = 'Chưa có loại tags. Nhấn nút để tạo mới.';
          categoriesContainer.appendChild(empty);
          return;
        }

        categories.forEach((cat, catIdx) => {
          const card = document.createElement('div');
          card.className = 'mc-tags-node-card';

          const header = document.createElement('div');
          header.className = 'mc-tags-node-header';

          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.placeholder = 'Tên loại tags (vd: Appearance)';
          nameInput.value = cat.name || '';
          nameInput.className = 'mc-tags-node-input';
          nameInput.oninput = () => {
            cat.name = nameInput.value;
            emitChange();
            updateSnapshot();
          };

          const removeBtn = document.createElement('button');
          removeBtn.className = 'mc-logger-remove';
          removeBtn.textContent = '×';
          removeBtn.onclick = () => {
            categories.splice(catIdx, 1);
            emitChange();
            renderAndStore();
          };

          header.appendChild(nameInput);
          header.appendChild(removeBtn);
          card.appendChild(header);

          const componentsContainer = document.createElement('div');
          componentsContainer.className = 'mc-tags-node-components';
          card.appendChild(componentsContainer);

          const renderComponents = () => {
            componentsContainer.innerHTML = '';
            (cat.components || []).forEach((comp, compIdx) => {
              const compCard = document.createElement('div');
              compCard.className = 'mc-tags-node-component-card';

              const compHeader = document.createElement('div');
              compHeader.className = 'mc-tags-node-component-header';

              const compInput = document.createElement('input');
              compInput.type = 'text';
              compInput.placeholder = 'Tên thành phần tags (vd: Hair)';
              compInput.value = comp.name || '';
              compInput.className = 'mc-tags-node-input';
              compInput.oninput = () => {
                comp.name = compInput.value;
                emitChange();
                updateSnapshot();
              };

              const compRemove = document.createElement('button');
              compRemove.className = 'mc-logger-remove';
              compRemove.textContent = '×';
              compRemove.onclick = () => {
                cat.components.splice(compIdx, 1);
                emitChange();
                renderAndStore();
              };

              compHeader.appendChild(compInput);
              compHeader.appendChild(compRemove);
              compCard.appendChild(compHeader);

              const tagsList = document.createElement('div');
              tagsList.className = 'mc-tags-node-tags';

              const textarea = document.createElement('textarea');
              textarea.className = 'mc-tags-node-textarea';
              textarea.placeholder = 'Tag1, Tag2...';
              textarea.value = (Array.isArray(comp.tags) && comp.tags.length) ? comp.tags.join(', ') : '';
              textarea.rows = 2;
              textarea.spellcheck = false;
              textarea.style.resize = 'none';
              textarea.style.overflow = 'hidden';

              const applyTextareaSize = () => {
                textarea.style.height = 'auto';
                const nextHeight = Math.min(200, Math.max(60, textarea.scrollHeight));
                textarea.style.height = `${nextHeight}px`;
              };

              const syncTags = () => {
                const raw = textarea.value || '';
                comp.tags = raw ? raw.split(/[\n,]+/).map(v => v.trim()).filter(Boolean) : [];
                emitChange();
                updateSnapshot();
              };

              textarea.addEventListener('input', () => {
                syncTags();
                applyTextareaSize();
              });

              applyTextareaSize();
              tagsList.appendChild(textarea);

              compCard.appendChild(tagsList);
              componentsContainer.appendChild(compCard);
            });

            const addComponentBtn = document.createElement('button');
            addComponentBtn.type = 'button';
            addComponentBtn.className = 'mc-node-btn mc-tags-node-add-component';
            addComponentBtn.textContent = '+ Thêm thành phần';
            addComponentBtn.onclick = () => {
              cat.components = cat.components || [];
              cat.components.push({ id: tagsCreateId(), name: '', tags: [] });
              emitChange();
              renderAndStore();
            };
            componentsContainer.appendChild(addComponentBtn);
          };

          renderComponents();
          categoriesContainer.appendChild(card);
        });
      }

      function renderAndStore(){
        renderCategories();
        lastSnapshot = snapshotValue();
      }

      const handleExternalUpdate = (ev) => {
        const detail = ev && ev.detail;
        if(!detail || String(detail.nodeId) !== String(node.id)) return;
        let applied = false;
        if(detail.structure && tagsIsStructure(detail.structure)){
          node.data.categories = tagsStructureToCategories(safeClone(detail.structure));
          applied = true;
        }else{
          const { graph } = tagsLoadGraphWithSaver();
          if(graph && Array.isArray(graph.nodes)){
            const latest = graph.nodes.find(n => String(n && n.id) === String(node.id));
            if(latest && latest.data && Array.isArray(latest.data.categories)){
              node.data.categories = JSON.parse(JSON.stringify(latest.data.categories));
              applied = true;
            }
          }
        }
        if(applied){
          renderAndStore();
          updateSnapshot();
        }
      };

      window.addEventListener(TAGS_UPDATED_EVENT, handleExternalUpdate);

      function teardown(){
        window.removeEventListener(TAGS_UPDATED_EVENT, handleExternalUpdate);
      }

      renderAndStore();

      const pollInterval = setInterval(() => {
        if(!document.body.contains(bodyEl)){
          clearInterval(pollInterval);
          teardown();
          return;
        }
        const next = snapshotValue();
        if(next !== lastSnapshot){
          renderAndStore();
        }
      }, 600);
    },
    execute(ctx){
      const node = ctx.node || {};
      tagsEnsureState(node);
      const incoming = ctx && ctx.inputs ? ctx.inputs.raw_results : undefined;
      const mutated = tagsConsumePayload(node, incoming);

      if(mutated && typeof ctx.onDataChange === 'function'){
        ctx.onDataChange(node.data);
      }

      const payload = tagsCategoriesToStructure(node.data.categories);
      tagsStoreSnapshot(node.id, payload);
      return { raw_results: payload };
    }
  });
})();
