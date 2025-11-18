(function(){
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  function add(def){ window.MaidChanNodeDefs[def.type] = def; }


  add({
    type: 'LLM',
    category: 'process',
    ports: { inputs: [
        { id:'prompt', label:'Prompt' },
        { id:'history', label:'History' },
        { id:'tools', label:'Tools' },
        { id:'settings', label:'Settings' }
      ], outputs: [
        { id:'message', label:'Message' },
        { id:'tools_result', label:'Tools result' }
      ] },
    defaultData(){ return {}; },
    buildConfigUI(bodyEl){
      const hint = document.createElement('div'); hint.className='mc-chip'; hint.textContent='No settings'; bodyEl.appendChild(hint);
    },
    execute(ctx){
      // Placeholder aggregation of inputs -> message
      const inputs = ctx.inputs || {};
      const promptParts = [];
      if(inputs.prompt) promptParts.push(inputs.prompt);
      if(inputs.history) promptParts.push('[History]\n' + inputs.history);
      const toolsDisabled = inputs.tools && inputs.tools.disabled;
      if(toolsDisabled) promptParts.push('[Tools Disabled]');
      const combined = promptParts.join('\n\n');
      return { message: combined || '...', tools_result: toolsDisabled? null : 'tools_executed_stub' };
    }
  });

  // Choice node: exposes a custom tool for LLM to pick among 3 options,
  // and emits activation-only outputs for wiring into downstream LLM Prompt ports.
  add({
    type: 'Choice',
    category: 'process',
    ports: { inputs: [ { id:'tools_result', label:'Tools result' } ], outputs: [ { id:'tools', label:'Tools' }, { id:'choice1', label:'Choice 1' }, { id:'choice2', label:'Choice 2' }, { id:'choice3', label:'Choice 3' } ] },
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
      return { tools: { custom: [tool] } };
    }
  });
})();
