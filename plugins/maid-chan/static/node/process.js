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
})();
