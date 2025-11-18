(function(){
  // Central registration & access helpers for node definitions
  window.MaidChanNodeDefs = window.MaidChanNodeDefs || {};
  const api = {
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
})();
