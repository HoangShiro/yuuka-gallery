class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  subscribe(eventName, handler) {
    const key = String(eventName || '').trim();
    if (!key || typeof handler !== 'function') {
      return () => {};
    }
    const list = this._handlers.get(key) || [];
    list.push(handler);
    this._handlers.set(key, list);
    return () => {
      const current = this._handlers.get(key) || [];
      this._handlers.set(key, current.filter((fn) => fn !== handler));
    };
  }

  publish(eventName, payload) {
    const key = String(eventName || '').trim();
    if (!key) {
      return;
    }
    const handlers = [...(this._handlers.get(key) || [])];
    for (const handler of handlers) {
      try {
        const maybePromise = handler(payload);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((error) => {
            this.publish('core.module_error', {
              event: key,
              error: error?.message || String(error),
            });
          });
        }
      } catch (error) {
        this.publish('core.module_error', {
          event: key,
          error: error?.message || String(error),
        });
      }
    }
  }
}

module.exports = {
  EventBus,
};
