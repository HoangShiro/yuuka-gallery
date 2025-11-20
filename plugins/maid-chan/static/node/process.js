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
      const title = window.localStorage.getItem('maid-chan:title') || 'Maid-chan';
      systemParts.push(`# Character: ${title}`);
      
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
        { id:'llm_settings', label:'LLM Settings' }
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
    // Gating: Only run if we have messages or a prompt
    shouldRun(ctx) {
        const inputs = ctx.inputs || {};
        const hasMsg = inputs.messages && inputs.messages.length > 0;
        const hasPrompt = inputs.system_prompt && inputs.system_prompt.length > 0;
        return hasMsg || hasPrompt;
    },
    async execute(ctx){
      const inputs = ctx.inputs || {};
      const { messages, settings, allowedTools, customTools } = prepareLLMRequest(inputs);

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

  // Choice node: exposes a custom tool for LLM to pick among 3 options,
  // and emits activation-only outputs for wiring into downstream LLM Prompt ports.
  add({
    type: 'Choice',
    category: 'process',
    ports: { inputs: [], outputs: [ { id:'tool_definitions', label:'Tool Definitions' }, { id:'choice1', label:'Choice 1' }, { id:'choice2', label:'Choice 2' }, { id:'choice3', label:'Choice 3' } ] },
    defaultData(){ return { toolName: 'mc_choice', choice1: 'Choice 1', choice2: 'Choice 2', choice3: 'Choice 3' }; },
    buildConfigUI(bodyEl, node, { onDataChange }){
      const wrap = document.createElement('div');
      wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.gap='6px';
      const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='Defines a simple choice tool for the LLM'; wrap.appendChild(hint);

      const nameRow = document.createElement('div'); nameRow.style.display='flex'; nameRow.style.gap='6px'; nameRow.style.alignItems='center';
      const nameLab = document.createElement('span'); nameLab.textContent='Tool name'; nameLab.style.fontSize='12px'; nameLab.style.opacity='.8'; nameRow.appendChild(nameLab);
      const nameInp = document.createElement('input'); nameInp.type='text'; nameInp.value=(node.data && node.data.toolName) || 'mc_choice'; nameInp.style.flex='1';
      nameInp.addEventListener('change', ()=>{ node.data = node.data||{}; node.data.toolName = String(nameInp.value||'mc_choice'); onDataChange && onDataChange(node.data); reRenderLabels(); });
      nameRow.appendChild(nameInp); wrap.appendChild(nameRow);

      function mkRow(key, label){
        const row = document.createElement('div'); row.style.display='flex'; row.style.gap='6px'; row.style.alignItems='center';
        const lab = document.createElement('span'); lab.textContent=label; lab.style.fontSize='12px'; lab.style.opacity='.8'; row.appendChild(lab);
        const inp = document.createElement('input'); inp.type='text'; inp.value=(node.data && node.data[key]) || label; inp.style.flex='1';
        inp.addEventListener('change', ()=>{ node.data=node.data||{}; node.data[key]=String(inp.value||label); onDataChange && onDataChange(node.data); reRenderLabels(); });
        row.appendChild(inp);
        return row;
      }
      const c1 = mkRow('choice1','Choice 1');
      const c2 = mkRow('choice2','Choice 2');
      const c3 = mkRow('choice3','Choice 3');
      wrap.appendChild(c1); wrap.appendChild(c2); wrap.appendChild(c3);

      function reRenderLabels(){
        try{
          const el = bodyEl.closest('.mc-node'); if(!el) return;
          const portsWrap = el.querySelector('.mc-node-ports'); if(!portsWrap) return;
          // Update output labels (indexes: 1..3 are choice ports)
          const outs = portsWrap.querySelectorAll('[data-port="out"]');
          const labels = [null, node.data?.choice1 || 'Choice 1', node.data?.choice2 || 'Choice 2', node.data?.choice3 || 'Choice 3'];
          outs.forEach((p, idx)=>{ if(labels[idx]){ const s = p.querySelector('span'); if(s) s.textContent = labels[idx]; } });
        }catch(_e){}
      }

      bodyEl.appendChild(wrap);
    },
    execute(ctx){
      // Provide custom tool declaration via Tools output; choice outputs are activation-only.
      const d = (ctx && ctx.node && ctx.node.data) || {};
      const name = (d.toolName || 'mc_choice').toString();
      const choice1 = (d.choice1 || 'Choice 1').toString();
      const choice2 = (d.choice2 || 'Choice 2').toString();
      const choice3 = (d.choice3 || 'Choice 3').toString();
      const tool = { name, description: 'Select among predefined options', parameters: { type:'object', properties:{ choice:{ anyOf:[ {type:'string', enum:[choice1,choice2,choice3,'1','2','3']}, {type:'array', items:{ type:'string', enum:[choice1,choice2,choice3,'1','2','3'] } } ] } }, additionalProperties:true } };
      return { tool_definitions: { custom: [tool] } };
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

})();
