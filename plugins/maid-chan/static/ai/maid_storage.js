(function(){
  // Maid-chan Storage helper
  // Manages chat/event/log history with backend-first, local fallback.

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.ai = window.Yuuka.ai || {};

  const NS = 'maid-chan:storage';
  const LOCAL_KEY = NS + ':messages';

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
      saveLocal(data.items);
      return data.items;
    }
    const local = loadLocal();
    console.log('[MaidStorage] loadHistory: fallback to local', local);
    return local;
  }

  async function appendMessage(msg){
    const now = Date.now();
    const normalized = {
      id: msg.id || null,
      role: msg.role || 'user',
      text: msg.text || '',
      kind: msg.kind || 'chat',
      timestamp: msg.timestamp || now,
      // Persist optional metadata such as used_tools or snapshot info
      metadata: (msg && typeof msg.metadata === 'object') ? msg.metadata : undefined
    };
    const list = loadLocal();
    list.push(normalized);
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