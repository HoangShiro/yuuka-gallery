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
})(window);
