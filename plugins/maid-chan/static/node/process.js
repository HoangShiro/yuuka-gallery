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

      for(const t of toolsList){
        const val = (t && t.tool_definitions) ? t.tool_definitions : t;
        if(val && val.selected && Array.isArray(val.selected)){
            val.selected.forEach(s => allowSet.add(String(s)));
        }
        if(val && val.custom && Array.isArray(val.custom)){
            customTools.push(...val.custom);
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
      
      return { messages, settings, allowedTools, customTools };
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
    defaultData(){ return {}; },
    buildConfigUI(bodyEl, node){
      const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint);
      
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
      const { messages, settings, allowedTools, customTools } = prepareLLMRequest(inputs);
      const controlRaw = inputs.message_control;
      const control = Array.isArray(controlRaw) ? controlRaw[controlRaw.length - 1] : controlRaw;
      const assistantIdFromControl = control && (control.assistant_message_id || control.assistantMessageId);
      const assistantIdFromContext = ctx && ctx.context && (ctx.context.assistantMessageId || ctx.context.assistant_message_id);
      const assistantMsgId = assistantIdFromControl || assistantIdFromContext || null;

      // 5. Call LLM
      const MaidCore = window.Yuuka && window.Yuuka.ai && window.Yuuka.ai.MaidCore;
      if(!MaidCore) return { response_message: { role: 'assistant', content: '(Error: MaidCore not found)' } };

      try {
        const res = await MaidCore.callLLMChat({ messages, settings, allowedTools, customTools, signal: ctx.signal });
        
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

        const responseMsg = { role: 'assistant', content: text };
        if(assistantMsgId){
          responseMsg.id = assistantMsgId;
          responseMsg.assistant_message_id = assistantMsgId;
        }
        try{
          console.log('[MaidLogic][LLM]', { nodeId: ctx?.node?.id, assistantMessageId: responseMsg.id || null, hadControlId: !!assistantMsgId });
        }catch(_e){/* noop */}
        if(calls.length) responseMsg.tool_calls = calls;

        return { 
            response_message: responseMsg,
            tool_calls: calls.length ? calls : null,
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
    defaultData(){ return { mode: 'prompt', template: '', replacements: [] }; },
    buildConfigUI(bodyEl, node, { onDataChange }){
      node.data = node.data || {};
      if(!node.data.mode) node.data.mode = 'prompt';
      if(!node.data.template) node.data.template = '';
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

        if (template.includes('{{raw}}')) {
            let rawStr = '';
            try { rawStr = JSON.stringify(rawResults, null, 2); }
            catch(e) { rawStr = String(rawResults); }
            template = template.replace(/\{\{raw\}\}/g, rawStr);
        }

        template = template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
            key = key.trim();
            if (key === 'raw') return match;
            let val = findValue(rawResults, key);
            return val !== undefined ? String(val) : match;
        });

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
  add({
    type: 'Infinite Choice',
    category: 'process',
    ports: { 
        inputs: [ { id:'tool_calls', label:'Tool Calls' } ], 
        outputs: [ 
            { id:'tool_definitions', label:'Tool Definitions' }, 
            { id:'flow', label:'Flow', branching: true } 
        ] 
    },
    defaultData(){ return { toolName: 'mc_choice', description: 'Select one option from the list', options: 'Option 1\nOption 2' }; },
    buildConfigUI(bodyEl, node, { onDataChange }){
      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.gap='6px';
      
      const nameRow = document.createElement('div'); nameRow.style.display='flex'; nameRow.style.gap='6px'; nameRow.style.alignItems='center';
      const nameLab = document.createElement('span'); nameLab.textContent='Tool name'; nameLab.style.fontSize='12px'; nameLab.style.opacity='.8'; nameRow.appendChild(nameLab);
      const nameInp = document.createElement('input'); nameInp.type='text'; nameInp.value=(node.data && node.data.toolName) || 'mc_choice'; nameInp.style.flex='1';
      nameInp.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.toolName = String(nameInp.value||'mc_choice'); onDataChange && onDataChange(node.data); });
      nameRow.appendChild(nameInp); wrap.appendChild(nameRow);

      const descLab = document.createElement('div'); descLab.textContent='Description'; descLab.style.fontSize='12px'; descLab.style.opacity='.8'; wrap.appendChild(descLab);
      const descTa = document.createElement('textarea');
      descTa.rows = 2;
      descTa.classList.add('mc-node-textarea-small');
      descTa.placeholder = 'Tool description for the LLM...';
      descTa.value = (node.data && node.data.description) || 'Select one option from the list';
      descTa.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.description = descTa.value; onDataChange && onDataChange(node.data); });
      wrap.appendChild(descTa);

      const optLab = document.createElement('div'); optLab.textContent='Options (one per line)'; optLab.style.fontSize='12px'; optLab.style.opacity='.8'; wrap.appendChild(optLab);
      const optTa = document.createElement('textarea');
      optTa.rows = 5;
      optTa.value = (node.data && node.data.options) || '';
      optTa.classList.add('mc-node-textarea-small');
      optTa.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.options = optTa.value; onDataChange && onDataChange(node.data); });
      wrap.appendChild(optTa);

      bodyEl.appendChild(wrap);
    },
    execute(ctx){
      const d = (ctx && ctx.node && ctx.node.data) || {};
      const name = (d.toolName || 'mc_choice').toString();
      const description = (d.description || 'Select one option from the list').toString();
      const rawOpts = (d.options || '').split('\n').map(s => s.trim()).filter(s => s);
      const options = rawOpts.length ? rawOpts : ['Option 1', 'Option 2'];

      // 1. Generate Tool Definition
      const tool = { 
          name, 
        description, 
          parameters: { 
              type:'object', 
              properties:{ 
                  choice:{ type:'string', enum: options },
                  index:{ type:'integer', description: 'Index of the selected option (0-based)' }
              },
              required: ['choice']
          } 
      };

      // 2. Check for execution results
      let selectedIndex = -1;
      let selectedValue = null;

      const inputs = (ctx.inputs && ctx.inputs.tool_calls) ? ctx.inputs.tool_calls : [];
      const calls = inputs.flat();
      
      for(const call of calls){
          // call structure: { name: '...', arguments: {...} }
          if(call && call.name === name){
             const args = call.arguments || {};
             if(args.choice){
                  const idx = options.indexOf(args.choice);
                  if(idx >= 0) { selectedIndex = idx; selectedValue = args.choice; }
              }
              // Fallback: check if index was provided directly
              if(selectedIndex === -1 && typeof args.index === 'number'){
                  if(args.index >= 0 && args.index < options.length){
                      selectedIndex = args.index;
                      selectedValue = options[selectedIndex];
                  }
              }
          }
      }

      const result = { tool_definitions: { custom: [tool] } };
      
      // Flow output is trigger-only: we only care which branch index is active.
      // Downstream nodes should not rely on the payload value itself.
      if(selectedIndex >= 0){
          result.flow = { __branchIndex: selectedIndex, value: true };
      }

      return result;
    }
  });

  // Logger node: keep editable log lines with time + limits
  add({
    type: 'Logger',
    category: 'process',
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
      container.className = 'mc-logger-container';

      const listEl = document.createElement('div');
      listEl.className = 'mc-logger-list';
      container.appendChild(listEl);

      const controlsRow = document.createElement('div');
      controlsRow.className = 'mc-logger-controls';

      const minuteWrap = document.createElement('div');
      minuteWrap.className = 'mc-logger-control';
      const minuteLabel = document.createElement('span');
      minuteLabel.textContent = 'Minute limit';
      const minuteInput = document.createElement('input');
      minuteInput.type = 'number';
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
      logWrap.className = 'mc-logger-control';
      const logLabel = document.createElement('span');
      logLabel.textContent = 'Log limit';
      const logInput = document.createElement('input');
      logInput.type = 'number';
      logInput.min = '0';
      logInput.value = String(node.data.logLimit || 0);
      logInput.onchange = () => {
        const v = parseInt(logInput.value, 10);
        node.data.logLimit = isNaN(v) ? 0 : v;
        // trim immediately if needed
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
        // filter expired logs
        node.data.logs = node.data.logs.filter(l => {
          if (!minuteMs) return true;
          return now - l.timestamp <= minuteMs;
        });
        // enforce limit
        if (node.data.logLimit > 0 && node.data.logs.length > node.data.logLimit) {
          node.data.logs.splice(0, node.data.logs.length - node.data.logLimit);
        }

        node.data.logs.forEach((log, idx) => {
          const row = document.createElement('div');
          row.className = 'mc-logger-row';

          const timeSpan = document.createElement('span');
          timeSpan.className = 'mc-logger-time';
          timeSpan.textContent = formatLocalTime(log.timestamp);

          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'mc-logger-input';
          input.value = log.text || '';
          input.onchange = () => {
            log.text = input.value;
            onDataChange();
          };

          const btn = document.createElement('button');
          btn.className = 'mc-logger-remove';
          btn.textContent = 'x';
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

        // update snapshot after render
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

      // Poll for runtime changes in node.data.logs while panel is open
      const pollInterval = setInterval(() => {
        // stop if panel removed
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
})();
