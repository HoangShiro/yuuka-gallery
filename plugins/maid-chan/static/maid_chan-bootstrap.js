(function initMaidChanNamespace(global) {
  if (!global.Yuuka) {
    global.Yuuka = {};
  }
  const root = global.Yuuka;
  root.plugins = root.plugins || {};
  const namespace = root.plugins['maid-chan'] = root.plugins['maid-chan'] || {};

  namespace.services = namespace.services || {};
  namespace.components = namespace.components || {};

  // Expose a small helper to access the core API
  // This mirrors how other plugins rely on the global `api` instance
  Object.defineProperty(namespace, 'coreApi', {
    configurable: true,
    enumerable: true,
    get: function () {
      // Prefer window.api if core already attached it; fall back to global `api`
      const coreApi = (global.api || (typeof api !== 'undefined' ? api : null));
      return coreApi || null;
    },
  });

  // --- Maid-chan: Event bus registry + optional AILogic bridge ---
  // Mặc định chỉ dùng registry để node "Events" hiển thị danh sách event.
  // Nếu người dùng muốn cho phép chạy graph khi có event nhất định,
  // họ phải bật cờ trong localStorage:
  //   maid-chan:events:bridge:enabled = true
  // Khi đó, bridge sẽ gọi AILogic.execute với context { eventName, eventPayload },
  // và chỉ những graph có node "Events" đã nối line mới tạo ra output.
  try {
    const ev = root.events;
    if (ev && typeof ev.emit === 'function') {
      const REG_KEY = 'maid-chan:event-names';

      function loadSet(){
        try{
          const raw = global.localStorage && global.localStorage.getItem(REG_KEY);
          if(!raw) return new Set();
          const arr = JSON.parse(raw);
          if(!Array.isArray(arr)) return new Set();
          return new Set(arr.filter(x => typeof x === 'string'));
        }catch(_e){ return new Set(); }
      }

      function saveSet(set){
        try{
          if(!global.localStorage) return;
          const arr = Array.from(set);
          global.localStorage.setItem(REG_KEY, JSON.stringify(arr));
        }catch(_e){}
      }

      const seen = loadSet();

      // Helper: kiểm tra có bật bridge event -> AILogic không
      function isBridgeEnabled(){
        try{
          const raw = global.localStorage && global.localStorage.getItem('maid-chan:events:bridge:enabled');
          if(raw == null) return false;
          const s = String(raw).trim().toLowerCase();
          return s === 'true' || s === '1' || s === 'yes' || s === 'on';
        }catch(_e){ return false; }
      }

      const origEmit = ev.emit.bind(ev);
      ev.emit = function(name, payload){
        try{
          if(typeof name === 'string' && !seen.has(name)){
            seen.add(name);
            saveSet(seen);
          }
        }catch(_e){}

        // Optional: bridge event sang AILogic nếu được bật
        try{
          if(isBridgeEnabled()){
            const ai = root.ai && root.ai.AILogic;
            if(ai && typeof ai.execute === 'function' && typeof ai.isEnabled === 'function' && ai.isEnabled()){
              // Fire-and-forget, không chờ kết quả; graph sẽ tự xử lý.
              // AILogic sẽ dùng graph đang active (từ localStorage) và chỉ
              // node "Events" nối line mới tạo ra output.
              ai.execute({
                text: '',
                context: { eventName: name, eventPayload: payload },
                history: []
              }).catch(function(){ /* swallow */ });
            }
          }
        }catch(_e){}

        return origEmit(name, payload);
      };

      // Expose a tiny helper for Events node UI
      root.maidEventRegistry = {
        list: function(){ return Array.from(seen); }
      };
    }
  } catch (_e) {
    // Do not crash bootstrap if event bus is unavailable
  }
})(window);
