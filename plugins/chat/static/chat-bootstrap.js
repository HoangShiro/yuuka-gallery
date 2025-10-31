(function initChatNamespace(global) {
    if (!global.Yuuka) {
        global.Yuuka = {};
    }
    const root = global.Yuuka;
    root.plugins = root.plugins || {};
    const namespace = root.plugins.chat = root.plugins.chat || {};

    namespace.services = namespace.services || {};
    namespace.stores = namespace.stores || {};
    namespace.components = namespace.components || {};
    namespace.modals = namespace.modals || {};
})(window);
