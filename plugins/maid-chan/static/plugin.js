(function(){
  // Central registration & access helpers for node definitions
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  const api = {
    register(def){
      if(!def || !def.type) return;
      // Optional: store pluginId if provided
      if(def.pluginId) def._pluginId = def.pluginId;
      window.MaidChanNodeDefs[def.type] = def;
      // Dispatch event so UI can update palette if needed
      window.dispatchEvent(new CustomEvent('maid-chan:node:registered', { detail: def }));
    },
    unregister(type){
      if(!type) return;
      delete window.MaidChanNodeDefs[type];
      window.dispatchEvent(new CustomEvent('maid-chan:node:unregistered', { detail: { type } }));
    },
    get(type){ return window.MaidChanNodeDefs[type]; },
    list(){ return Object.values(window.MaidChanNodeDefs); },
    categories(){
      const byCat = { input:[], process:[], output:[] };
      for(const def of Object.values(window.MaidChanNodeDefs)){
        if(!def) continue; const c = def.category || 'other';
        if(!byCat[c]) byCat[c] = []; byCat[c].push(def.type);
      }
      return byCat;
    }
  };
  window.Yuuka = window.Yuuka || {}; window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components.MaidChanNodes = api;
  // Alias for consistency with services
  window.Yuuka.services = window.Yuuka.services || {};
  window.Yuuka.services.maidNodes = api;
})();
