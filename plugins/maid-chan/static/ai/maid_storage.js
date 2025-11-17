(function(){
  // Maid-chan Storage helper
  // Manages chat/event/log history with backend-first, local fallback.

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.ai = window.Yuuka.ai || {};

  const NS = 'maid-chan:storage';
  const LOCAL_KEY = NS + ':messages';

  function clamp(n, min, max){
    n = Number(n);
    if(!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // Normalize strictly to the new structure for assistant messages
  // assistant messages carry snapshots only: { parts: [{text, tool_results_text, timestamp, tool_info?}], current_index }
  function normalizeItemStructure(it){
    if(!it || typeof it !== 'object') return it;
    const out = { ...it };

    if(out.role === 'assistant'){
      if(out.snapshots && typeof out.snapshots === 'object' && Array.isArray(out.snapshots.parts)){
        const baseTs = Date.now();
        const parts = out.snapshots.parts.map(p => {
          const part = {
            text: String((p && p.text) || ''),
            tool_results_text: (p && typeof p.tool_results_text === 'string') ? p.tool_results_text : undefined,
            timestamp: (p && Number.isFinite(p.timestamp)) ? p.timestamp : baseTs
          };
          if(p && Array.isArray(p.tool_info)){
            part.tool_info = p.tool_info.map(t=>{
              const argsList = Array.isArray(t?.arguments_list) ? t.arguments_list.slice() : (function(v){
                if(v == null) return [];
                if(Array.isArray(v)) return v.slice();
                if(typeof v === 'object') return Object.values(v);
                return [v];
              })(t && (t.arguments !== undefined ? t.arguments : t?.args));
              const resList = Array.isArray(t?.result_list) ? t.result_list.slice() : (function(v){
                if(v == null) return [];
                if(Array.isArray(v)) return v.slice();
                if(typeof v === 'object') return Object.values(v);
                return [v];
              })(t && t.result);
              return {
                name: t && t.name,
                type: t && t.type,
                pluginId: t && t.pluginId,
                stage: t && t.stage,
                arguments_list: argsList,
                result_list: resList
              };
            }).filter(t=> t.name);
          }
            return part;
        });
        let idx = clamp(out.snapshots.current_index || 0, 0, Math.max(0, parts.length - 1));
        out.snapshots = { parts, current_index: idx };
      }
      // Remove top-level legacy fields for assistant
      delete out.text;
      delete out.timestamp;
      delete out.metadata;
    }

    return out;
  }

  function loadLocal(){
    try{
      const raw = window.localStorage.getItem(LOCAL_KEY);
      if(!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    }catch(_e){ return []; }
  }

  function saveLocal(list){
    try{
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(list || []));
    }catch(_e){ /* ignore */ }
  }

  function getPluginApi(){
    const root = window.Yuuka || {};
    const ns = root.plugins && root.plugins['maid-chan'];
    const coreApi = ns && ns.coreApi;
    if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
      coreApi.createPluginApiClient('maid');
      return coreApi.maid || null;
    }
    return null;
  }

  async function apiGet(path){
    const pluginApi = getPluginApi();
    try{
      if(pluginApi && typeof pluginApi.get === 'function'){
        // path is a full plugin URL (e.g. '/api/plugin/maid/chat/history'),
        // but pluginApi.get expects only the relative part after '/api/plugin/maid'.
        const base = '/api/plugin/maid';
        const rel = path.startsWith(base) ? path.slice(base.length) || '/' : path;
        return await pluginApi.get(rel);
      }
      if(window.Yuuka?.services?.api?.get){
        return await window.Yuuka.services.api.get(path);
      }
      const res = await fetch(path, { credentials: 'include' });
      if(res.status === 404) return null;
      if(!res.ok) throw new Error('HTTP '+res.status);
      return await res.json();
    }catch(_e){ return null; }
  }

  async function apiPost(path, payload){
    const pluginApi = getPluginApi();
    try{
      if(pluginApi && typeof pluginApi.post === 'function'){
        const base = '/api/plugin/maid';
        const rel = path.startsWith(base) ? path.slice(base.length) || '/' : path;
        return await pluginApi.post(rel, payload);
      }
      if(window.Yuuka?.services?.api?.post){
        return await window.Yuuka.services.api.post(path, payload);
      }
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload || {})
      });
      if(res.status === 404) return null;
      if(!res.ok) throw new Error('HTTP '+res.status);
      return await res.json();
    }catch(_e){ return null; }
  }

  async function loadHistory(){
    const data = await apiGet('/api/plugin/maid/chat/history');
    if(data && Array.isArray(data.items)){
      const normalized = data.items.map(normalizeItemStructure);
      saveLocal(normalized);
      return normalized;
    }
    const local = loadLocal();
    const normalizedLocal = Array.isArray(local) ? local.map(normalizeItemStructure) : [];
    console.log('[MaidStorage] loadHistory: fallback to local', normalizedLocal);
    return normalizedLocal;
  }

  async function appendMessage(msg){
    const now = Date.now();
    // Always persist assistant messages with snapshots structure
    let snapshots = undefined;
    if(msg && msg.role === 'assistant'){
      if(msg.snapshots && typeof msg.snapshots === 'object' && Array.isArray(msg.snapshots.parts)){
        const idx = clamp(msg.snapshots.current_index || 0, 0, Math.max(0, msg.snapshots.parts.length - 1));
        const parts = msg.snapshots.parts.map(p=>{
          const part = {
            text: String((p && p.text) || ''),
            tool_results_text: (p && typeof p.tool_results_text === 'string') ? p.tool_results_text : undefined,
            timestamp: (p && Number.isFinite(p.timestamp)) ? p.timestamp : now
          };
          if(p && Array.isArray(p.tool_info)){
            part.tool_info = p.tool_info.map(t=>{
              const argsList = Array.isArray(t?.arguments_list) ? t.arguments_list.slice() : (function(v){
                if(v == null) return [];
                if(Array.isArray(v)) return v.slice();
                if(typeof v === 'object') return Object.values(v);
                return [v];
              })(t && (t.arguments !== undefined ? t.arguments : t?.args));
              const resList = Array.isArray(t?.result_list) ? t.result_list.slice() : (function(v){
                if(v == null) return [];
                if(Array.isArray(v)) return v.slice();
                if(typeof v === 'object') return Object.values(v);
                return [v];
              })(t && t.result);
              return {
                name: t && t.name,
                type: t && t.type,
                pluginId: t && t.pluginId,
                stage: t && t.stage,
                arguments_list: argsList,
                result_list: resList
              };
            }).filter(t=> t.name);
          }
          return part;
        });
        snapshots = { parts, current_index: idx };
      }else{
        const toolText = (msg && msg.metadata && typeof msg.metadata.tool_results_text === 'string') ? msg.metadata.tool_results_text : (typeof msg.tool_results_text === 'string' ? msg.tool_results_text : undefined);
        const part = { text: String(msg.text || ''), timestamp: now };
        if(toolText) part.tool_results_text = toolText;
        const idx = clamp((msg && msg.metadata && msg.metadata.selected_snapshot_index) ?? 0, 0, 0);
        snapshots = { parts: [part], current_index: idx };
      }
    }

    let normalized;
    if((msg.role || 'user') === 'assistant'){
      normalized = {
        id: msg.id || null,
        role: 'assistant',
        kind: msg.kind || 'chat',
        snapshots: snapshots || { parts: [{ text: '', timestamp: now }], current_index: 0 }
      };
    }else{
      normalized = {
        id: msg.id || null,
        role: msg.role || 'user',
        text: msg.text || '',
        kind: msg.kind || 'chat',
        timestamp: msg.timestamp || now
      };
    }
    const list = loadLocal();
    list.push(normalizeItemStructure(normalized));
    saveLocal(list);
    await apiPost('/api/plugin/maid/chat/append', { message: normalized });
    return normalized;
  }

  window.Yuuka.ai.MaidStorage = {
    loadHistory,
    appendMessage,
    loadLocal,
    saveLocal
  };
})();