(function(){
  // Album plugin nodes for Maid-chan Logic UI
  // Register nodes via the central MaidChanNodes service

  function registerNodes(){
    const nodesApi = window.Yuuka?.services?.maidNodes || window.Yuuka?.components?.MaidChanNodes;
    if(!nodesApi || typeof nodesApi.register !== 'function'){
      console.warn('[Album Nodes] MaidChanNodes service not available, retrying in 500ms...');
      setTimeout(registerNodes, 500);
      return;
    }

    // Helper to call Album capabilities (avoid direct cross-plugin API access)
    async function callAlbumCapability(id, payload){
      const caps = window.Yuuka?.services?.capabilities;
      const def = caps?.get?.(id);
      if(!def || typeof def.invoke !== 'function'){
        throw new Error(`Album capability not available: ${id}`);
      }
      return await def.invoke(payload || {}, { source: 'album.nodes' });
    }

    // Helper to find album by name or hash
    async function findAlbum(identifier){
      if(!identifier || typeof identifier !== 'string') return null;
      
      // Normalization helper from capabilities.js
      const normalizeName = (s) => {
          if (!s) return '';
          return String(s)
              .toLowerCase()
              .replace(/_/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
      };

      const normQuery = normalizeName(identifier);
      if(!normQuery) return null;

      try {
        const albums = await callAlbumCapability('album.list_albums', {});
        if(!Array.isArray(albums)) return null;

        // First try exact hash match (case-insensitive)
        let matched = albums.find(a => a && normalizeName(a.hash) === normQuery);
        if(matched) return matched;

        // Then try name match using scoring similar to capabilities.js
        const scored = albums.map(album => {
            const name = album?.name || '';
            const normName = normalizeName(name);
            const hash = album?.hash || '';
            const normHash = normalizeName(hash);

            let score = 0;
            if (!normName && !normHash) return null;

            if (normName === normQuery || normHash === normQuery) {
                score = 100;
            } else if (normName.includes(normQuery) || normHash.includes(normQuery)) {
                score = 80;
            } else {
                // Check for partial word matches
                const parts = normQuery.split(' ');
                const matchedParts = parts.filter(p => p && (normName.includes(p) || normHash.includes(p)));
                if (matchedParts.length) {
                    score = 60 + matchedParts.length * 5;
                }
            }
            
            if (!score) return null;
            return { album, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

        return scored.length > 0 ? scored[0].album : null;
      } catch(err){
        console.warn('[Album Nodes] Failed to search albums:', err);
        return null;
      }
    }

    // Helper to get album settings/config
    async function getAlbumSettings(characterHash){
      if(!characterHash) return null;
      try {
        const data = await callAlbumCapability('album.get_comfyui_info', {
          character_hash: String(characterHash),
          no_choices: false,
        });
        return data || null;
      } catch(err){
        console.warn('[Album Nodes] Failed to get album settings:', err);
        return null;
      }
    }

    // --- Album info node ---
    nodesApi.register({
      type: 'Album info',
      category: 'input',
      pluginId: 'album',
      ports: {
        inputs: [{ id: 'raw_results', label: 'Raw Results' }],
        outputs: [{ id: 'raw_results', label: 'Raw Results' }]
      },
      defaultData(){ return { identifier: '' }; },
      buildConfigUI(bodyEl, node, { onDataChange }){
        const wrap = document.createElement('div');
        wrap.className = 'mc-node-col-loose';

        // Label
        const label = document.createElement('div');
        label.textContent = 'Character name or Album ID';
        label.className = 'mc-node-label';
        wrap.appendChild(label);

        // Input field
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter character name or album hash...';
        input.value = (node.data && node.data.identifier) || '';
        input.className = 'mc-node-input';
        input.addEventListener('change', () => {
          node.data = node.data || {};
          node.data.identifier = input.value.trim();
          if(typeof onDataChange === 'function') onDataChange();
        });
        wrap.appendChild(input);

        // Hint
        const hint = document.createElement('div');
        hint.textContent = 'Input port has higher priority than this field.';
        hint.className = 'mc-node-hint';
        wrap.appendChild(hint);

        bodyEl.appendChild(wrap);
      },
      async execute(ctx){
        const node = ctx && ctx.node;
        const inputs = ctx && ctx.inputs;

        // Determine identifier: input port takes priority
        let identifier = '';
        
        // Check input port first
        if(inputs && inputs.raw_results){
          const rawInput = Array.isArray(inputs.raw_results) ? inputs.raw_results[0] : inputs.raw_results;
          if(rawInput){
            // Handle various input formats
            if(typeof rawInput === 'string'){
              identifier = rawInput.trim();
            } else if(typeof rawInput === 'object'){
              // Could be { character_name: ... } or { character_hash: ... } or { value: ... }
              identifier = String(
                rawInput.character_name || 
                rawInput.character_hash || 
                rawInput.name || 
                rawInput.hash || 
                rawInput.value || 
                rawInput.id ||
                ''
              ).trim();
            }
          }
        }

        // Fallback to node data if no input
        if(!identifier && node && node.data && node.data.identifier){
          identifier = String(node.data.identifier).trim();
        }

        if(!identifier){
          return { raw_results: { error: 'No character name or album ID provided' } };
        }

        // Find the album
        const album = await findAlbum(identifier);
        if(!album || !album.hash){
          return { raw_results: { error: `Album not found for: ${identifier}` } };
        }

        // Get album settings
        const settings = await getAlbumSettings(album.hash);

        // Build output with all available info
        const result = {
          album: {
            hash: album.hash,
            name: album.name || '',
            ...(album.thumbnail ? { thumbnail: album.thumbnail } : {}),
            ...(album.image_count !== undefined ? { image_count: album.image_count } : {})
          },
          settings: settings ? {
            last_config: settings.last_config || {},
            global_choices: settings.global_choices || null
          } : null,
          // Flatten some common fields for convenience
          character_hash: album.hash,
          character_name: album.name || ''
        };

        return { raw_results: result };
      }
    });

    console.log('[Album Nodes] Registered Album info node');

    // --- Tags Manager Helpers (Ported from process.js) ---
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
        // Flatten tags for this category
        let catTags = [];
        let catRemoved = [];

        list.forEach((entry, idx) => {
          const prev = idx > 0 ? list[idx - 1] : null;
          const prevHas = prev && Array.isArray(prev.current) && prev.current.filter(Boolean).length > 0;
          const shouldEmit = entry.onlyWhenAboveEmpty ? !prevHas : true;
          
          const curated = Array.isArray(entry.current) ? entry.current.filter(Boolean) : [];
          if(shouldEmit) {
             catTags.push(...curated);
          }

          const removedList = Array.isArray(entry.removed) ? entry.removed.filter(Boolean) : [];
          if(shouldEmit) {
             catRemoved.push(...removedList);
          }
          
          if(Array.isArray(entry.customList) && entry.customList.length && curated.length === 0){
            custom.push(...entry.customList);
          }
        });
        
        structure[catName] = tmUniqueList(catTags);
        removedStructure[catName] = tmUniqueList(catRemoved);
      });
      return { structure, removedStructure, custom: tmUniqueList(custom) };
    }

    // --- Album Tags Manager Node ---
    nodesApi.register({
      type: 'Album tags manager',
      category: 'process',
      pluginId: 'album',
      ports: {
        inputs: [
          { id: 'raw_results', label: 'Raw Results' }, // Character Name / Album ID
          { id: 'tool_calls', label: 'Tool Calls' }
        ],
        outputs: [
          { id: 'raw_results', label: 'Current tags' },
          { id: 'removed_tags', label: 'Removed tags' },
          { id: 'custom_tags', label: 'Custom tags' }
        ]
      },
      defaultData(){
        return { 
          entries: [], 
          addCommandName: 'add', 
          removeCommandName: 'remove',
          identifier: '' 
        };
      },
      buildConfigUI(bodyEl, node, { onDataChange }){
        tmEnsureState(node);
        if(!node.data) node.data = {};
        if(typeof node.data.addCommandName !== 'string' || !node.data.addCommandName) node.data.addCommandName = 'add';
        if(typeof node.data.removeCommandName !== 'string' || !node.data.removeCommandName) node.data.removeCommandName = 'remove';
        
        // Ensure fixed categories exist
        const fixedCategories = ['outfits', 'expression', 'action', 'context'];
        let structureChanged = false;
        fixedCategories.forEach(cat => {
          // Check if entry exists for this category
          const exists = node.data.entries.some(e => e.category === cat);
          if(!exists){
             // Create new entry
             const newEntry = tmEnsureEntryShape({
               category: cat,
               component: 'tags', // Default component name
               current: [],
               removed: []
             });
             node.data.entries.push(newEntry);
             structureChanged = true;
          }
        });
        
        // Filter to only fixed categories
        const filtered = node.data.entries.filter(e => fixedCategories.includes(e.category));
        if(filtered.length !== node.data.entries.length){
          node.data.entries = filtered;
          structureChanged = true;
        }
        
        // Sort entries by fixed order
        node.data.entries.sort((a,b) => {
          return fixedCategories.indexOf(a.category) - fixedCategories.indexOf(b.category);
        });

        if(structureChanged && typeof onDataChange === 'function') onDataChange(node.data);

        const emitChange = () => {
          if(typeof onDataChange === 'function') onDataChange(node.data);
        };

        const wrap = document.createElement('div');
        wrap.className = 'mc-tags-manager-wrap';

        const controls = document.createElement('div');
        controls.className = 'mc-tags-manager-controls';
        controls.style.flexDirection = 'column';
        controls.style.gap = '8px';

        // Identifier Input Row
        const idRow = document.createElement('div');
        idRow.style.display = 'flex';
        idRow.style.gap = '6px';
        
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'mc-node-input';
        idInput.placeholder = 'Character Name or Album ID';
        idInput.value = node.data.identifier || '';
        idInput.style.flex = '1';
        idInput.onchange = () => {
          node.data.identifier = idInput.value;
          emitChange();
        };

        const fetchBtn = document.createElement('button');
        fetchBtn.type = 'button';
        fetchBtn.className = 'mc-history-view-btn';
        fetchBtn.textContent = 'Get tags';
        fetchBtn.style.width = 'auto';
        fetchBtn.style.padding = '0 12px';
        
        const doFetch = async () => {
          const id = idInput.value.trim();
          if(!id) return;
          
          fetchBtn.disabled = true;
          fetchBtn.textContent = '...';
          try {
            const album = await findAlbum(id);
            if(!album){
               alert('Album not found');
               return;
            }
            const settings = await getAlbumSettings(album.hash);
            if(settings && settings.last_config){
               let mutated = false;
               fixedCategories.forEach(cat => {
                 const tags = settings.last_config[cat];
                 const entry = node.data.entries.find(e => e.category === cat);
                 if(entry && (Array.isArray(tags) || typeof tags === 'string')){
                   const newTags = tmNormalizeList(tags);
                   if(!tmArrayEqual(entry.current, newTags)){
                     entry.current = newTags;
                     entry.removed = []; 
                     mutated = true;
                   }
                 }
               });
               
               if(mutated){
                 emitChange();
                 updateSnapshot();
                 render();
               }
            }
          } catch(e) {
            console.error(e);
            alert('Error fetching tags');
          } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Get tags';
          }
        };
        
        fetchBtn.onclick = doFetch;

        idRow.appendChild(idInput);
        idRow.appendChild(fetchBtn);
        controls.appendChild(idRow);

        // Command Inputs
        const cmdRow = document.createElement('div');
        cmdRow.style.display = 'flex';
        cmdRow.style.gap = '6px';

        const buildCommandInput = (action) => {
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'mc-tags-manager-command-input';
          input.placeholder = action === 'add' ? 'Add cmd (default: add)' : 'Remove cmd (default: remove)';
          input.value = action === 'add' ? (node.data.addCommandName || 'add') : (node.data.removeCommandName || 'remove');
          input.oninput = () => {
            const val = input.value.trim() || (action === 'add' ? 'add' : 'remove');
            if(action === 'add') node.data.addCommandName = val;
            else node.data.removeCommandName = val;
            emitChange();
          };
          return input;
        };
        cmdRow.appendChild(buildCommandInput('add'));
        cmdRow.appendChild(buildCommandInput('remove'));
        controls.appendChild(cmdRow);

        wrap.appendChild(controls);

        const listEl = document.createElement('div');
        listEl.className = 'mc-tags-manager-list';
        listEl.style.display = 'grid';
        listEl.style.gridTemplateColumns = '1fr 1fr';
        listEl.style.gap = '8px';
        wrap.appendChild(listEl);
        bodyEl.appendChild(wrap);

        const snapshot = () => tmEntriesSnapshot(node.data.entries);
        let lastSnapshot = snapshot();
        const updateSnapshot = () => { lastSnapshot = snapshot(); };

        const render = () => {
          const entries = tmEnsureState(node);
          listEl.innerHTML = '';
          
          entries.forEach(entry => {
            if(!fixedCategories.includes(entry.category)) return;

            const card = document.createElement('div');
            card.className = 'mc-tags-manager-card';

            const header = document.createElement('div');
            header.className = 'mc-tags-manager-header';
            const title = document.createElement('div');
            title.className = 'mc-tags-manager-title';
            title.textContent = entry.category.charAt(0).toUpperCase() + entry.category.slice(1);
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
            viewer.readOnly = false; 
            viewer.spellcheck = false;
            viewer.style.resize = 'none';
            viewer.style.overflow = 'hidden';
            
            const parseAndSync = (val, mode) => {
               const list = tmNormalizeList(val);
               if(mode === 'current') entry.current = list;
               else entry.removed = list;
               emitChange();
               updateSnapshot();
               refreshViewer(mode);
            };
            
            viewer.onchange = () => {
               const mode = currentBtn.classList.contains('active') ? 'current' : 'removed';
               parseAndSync(viewer.value, mode);
            };

            card.appendChild(viewer);

            const autoSizeViewer = () => {
              viewer.style.height = 'auto';
              const next = Math.min(180, Math.max(48, viewer.scrollHeight));
              viewer.style.height = `${next}px`;
            };

            const refreshViewer = (mode) => {
              const list = mode === 'removed' ? entry.removed : entry.current;
              viewer.value = list && list.length ? list.join(', ') : '';
              viewer.placeholder = list && list.length ? '' : '(Empty)';
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
            customInput.placeholder = 'tag1, tag2...';
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
          
          // Sync identifier if changed externally (e.g. by execute)
          if(node.data.identifier !== idInput.value){
             // Only update if not currently focused to avoid interrupting typing
             if(document.activeElement !== idInput){
                idInput.value = node.data.identifier || '';
                if(typeof onDataChange === 'function') onDataChange(node.data);
             }
          }

          const next = snapshot();
          if(next !== lastSnapshot){
            render();
            lastSnapshot = next;
            if(typeof onDataChange === 'function') onDataChange(node.data);
          }
        }, 650);
      },
      async execute(ctx){
        const nodeRef = ctx.node || {};
        tmEnsureState(nodeRef);
        const inputs = ctx.inputs || {};
        let mutated = false;

        let identifier = '';
        if(inputs.raw_results){
           if(Array.isArray(inputs.raw_results)) identifier = String(inputs.raw_results[0] || '').trim();
           else identifier = String(inputs.raw_results).trim();
        }
        
        if(identifier && identifier !== nodeRef.data.identifier){
           nodeRef.data.identifier = identifier;
           mutated = true;
           
           try {
              const album = await findAlbum(identifier);
              if(album){
                 const settings = await getAlbumSettings(album.hash);
                 if(settings && settings.last_config){
                    const fixedCategories = ['outfits', 'expression', 'action', 'context'];
                    fixedCategories.forEach(cat => {
                       const tags = settings.last_config[cat];
                       const entry = nodeRef.data.entries.find(e => e.category === cat);
                       if(entry && (Array.isArray(tags) || typeof tags === 'string')){
                          const newTags = tmNormalizeList(tags);
                          if(!tmArrayEqual(entry.current, newTags)){
                             entry.current = newTags;
                             entry.removed = [];
                             mutated = true;
                          }
                       }
                    });
                 }
              }
           } catch(err){
              console.warn('[Album Tags Manager] Auto-fetch failed:', err);
           }
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

    // --- Generate Image Node ---
    nodesApi.register({
      type: 'Generate Image',
      category: 'process',
      pluginId: 'album',
      ports: {
        inputs: [
          { id: 'name_id', label: 'Name/ID' },
          { id: 'tags', label: 'Tags' },
          { id: 'settings', label: 'Settings' }
        ],
        outputs: [
          { id: 'system_prompt', label: 'System Prompt' },
          { id: 'url', label: 'url' }
        ]
      },
      defaultData(){ return { identifier: '' }; },
      buildConfigUI(bodyEl, node, { onDataChange }){
        const wrap = document.createElement('div');
        wrap.className = 'mc-node-col-loose';

        // Character Name Display
        const charNameLabel = document.createElement('div');
        charNameLabel.className = 'mc-node-label';
        charNameLabel.textContent = 'Character: -';
        charNameLabel.style.fontWeight = 'bold';
        node.ui_char_name = charNameLabel;
        wrap.appendChild(charNameLabel);

        // Status Display
        const statusLabel = document.createElement('div');
        statusLabel.className = 'mc-node-hint';
        statusLabel.textContent = 'Status: Idle';
        statusLabel.style.marginTop = '5px';
        node.ui_status = statusLabel;
        wrap.appendChild(statusLabel);

        bodyEl.appendChild(wrap);
      },
      async execute(ctx){
        const node = ctx && ctx.node;
        const inputs = ctx && ctx.inputs;
        
        // Update UI helper
        const updateUI = (charName, status) => {
            if(node && node.ui_char_name) node.ui_char_name.textContent = `Character: ${charName || '-'}`;
            if(node && node.ui_status) node.ui_status.textContent = `Status: ${status || 'Idle'}`;
        };

        updateUI(null, 'Initializing...');

        // 1. Resolve Identifier
        let identifier = '';
        if(inputs && inputs.name_id){
            const val = inputs.name_id;
            identifier = Array.isArray(val) ? val[0] : val;
            if(typeof identifier === 'object' && identifier.character_name) identifier = identifier.character_name;
        }
        if(!identifier && node && node.data && node.data.identifier){
            identifier = node.data.identifier;
        }

        if(!identifier){
            updateUI(null, 'Error: No identifier');
            return { system_prompt: 'Error: No identifier provided' };
        }

        // 2. Find Album
        updateUI(identifier, 'Finding album...');
        const album = await findAlbum(identifier);
        if(!album || !album.hash){
            updateUI(identifier, 'Error: Album not found');
            return { system_prompt: `Error: Album not found for ${identifier}` };
        }
        updateUI(album.name || identifier, 'Loading settings...');

        // 3. Get Settings
        const settings = await getAlbumSettings(album.hash);
        if(!settings || !settings.last_config){
             updateUI(album.name, 'Error: No config found');
             return { system_prompt: 'Error: No last_config found for album' };
        }
        const lastConfig = settings.last_config;

        // 4. Process Tags & Build Config
        const genConfig = { ...lastConfig };
        // Remove combined prompt to force rebuild from components
        delete genConfig.combined_text_prompt;
        
        // Keys that should be cleared if not provided in input tags
        const clearingKeys = ['outfits', 'expression', 'action', 'context'];
        clearingKeys.forEach(k => genConfig[k] = '');

        const tagStructure = {};
        const extraTags = [];

        const processInputItem = (item) => {
            if(!item) return;
            if(typeof item === 'string'){
                if(item.trim()) extraTags.push(item.trim());
            } else if(Array.isArray(item)){
                item.forEach(processInputItem);
            } else if(typeof item === 'object'){
                // Assume structure object { category: [tags] }
                Object.entries(item).forEach(([key, val]) => {
                    const normKey = key.toLowerCase(); 
                    let tags = [];
                    if(Array.isArray(val)) tags = val;
                    else if(typeof val === 'string') tags = [val];
                    
                    if(tags.length > 0){
                        // Flatten tags in case they are nested
                        const flatTags = tags.flat(Infinity).map(t => String(t).trim()).filter(Boolean);
                        if(flatTags.length > 0){
                            if(!tagStructure[normKey]) tagStructure[normKey] = [];
                            tagStructure[normKey].push(...flatTags);
                        }
                    }
                });
            }
        };

        if(inputs && inputs.tags) processInputItem(inputs.tags);

        // Apply structure to config
        Object.keys(tagStructure).forEach(cat => {
            // Check if category exists in lastConfig (case-insensitive match?)
            // lastConfig keys are usually lowercase.
            const targetKey = Object.keys(lastConfig).find(k => k.toLowerCase() === cat);
            
            if(targetKey){
                const uniqueTags = [...new Set(tagStructure[cat])];
                genConfig[targetKey] = uniqueTags.join(', ');
            } else {
                // Not in config, add to extras
                extraTags.push(...tagStructure[cat]);
            }
        });

        // Append extra tags to outfits
        if(extraTags.length > 0){
            const uniqueExtras = [...new Set(extraTags)];
            const currentOutfits = genConfig['outfits'] ? genConfig['outfits'] : '';
            genConfig['outfits'] = currentOutfits ? `${currentOutfits}, ${uniqueExtras.join(', ')}` : uniqueExtras.join(', ');
        }

        // 6. Start Generation
        updateUI(album.name, 'Starting generation...');
        
        // Helper for auth headers

        // Helper for auth headers
        const getAuthHeaders = () => {
            const headers = { 'Content-Type': 'application/json' };
            const token = localStorage.getItem('yuuka-auth-token');
            if(token) headers['Authorization'] = `Bearer ${token}`;
            return headers;
        };

        try {
            const startRes = await fetch('/api/core/generate', {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    character_hash: album.hash,
                    generation_config: genConfig,
                    context: { source: 'node_generate_image' }
                })
            });
            
            if(!startRes.ok){
                const err = await startRes.json();
                throw new Error(err.error || startRes.statusText);
            }
            
            const startData = await startRes.json();
            const taskId = startData.task_id;
            const startTime = Date.now();

            // 7. Poll Status
            updateUI(album.name, 'Queued...');
            let finalImageUrl = null;

            while(true){
                await new Promise(r => setTimeout(r, 1000));
                
                // Check timeout (e.g. 5 minutes)
                if(Date.now() - startTime > 300000) throw new Error('Timeout');

                const statusRes = await fetch('/api/core/generate/status', { 
                    headers: getAuthHeaders(),
                    credentials: 'include' 
                });
                if(!statusRes.ok) continue;
                const statusData = await statusRes.json();
                
                // Check if task is running
                const task = statusData.tasks && statusData.tasks[taskId];
                
                if(task){
                    if(task.error_message) throw new Error(task.error_message);
                    updateUI(album.name, task.progress_message || 'Processing...');
                } else {
                    // Task is gone, assume finished.
                    // Fetch latest image for character
                    updateUI(album.name, 'Finalizing...');
                    
                    // Wait a bit for FS sync
                    await new Promise(r => setTimeout(r, 1000));
                    
                    const imgsRes = await fetch(`/api/core/images/by_character/${album.hash}`, { 
                        headers: getAuthHeaders(),
                        credentials: 'include' 
                    });
                    if(imgsRes.ok){
                        const images = await imgsRes.json();
                        if(Array.isArray(images) && images.length > 0){
                            // Assuming API returns sorted newest first or we take the first one
                            finalImageUrl = images[0].url;
                        }
                    }
                    break;
                }
            }

            if(finalImageUrl){
                updateUI(album.name, 'Done');
                return { 
                    system_prompt: 'Generation successful',
                    url: finalImageUrl
                };
            } else {
                throw new Error('Image not found after generation');
            }

        } catch(err){
            updateUI(album.name, `Error: ${err.message}`);
            return { system_prompt: `Generation failed: ${err.message}` };
        }
      }
    });

    console.log('[Album Nodes] Registered Album info and Album tags manager nodes');
  }

  // Register when DOM is ready or immediately if already loaded
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', registerNodes);
  } else {
    // Small delay to ensure MaidChanNodes service is initialized
    setTimeout(registerNodes, 100);
  }
})();
