const { registerBrainInstruction, registerBrainTool, registerMessageView, registerToolReplyFormatter } = require('./runtime_state.cjs');

function createModuleContext(eventBus, moduleDef, runtimeState) {
  return {
    module_id: moduleDef.module_id,
    subscribe(eventName, handler) {
      return eventBus.subscribe(eventName, async (payload) => {
        try {
          return await handler(payload);
        } catch (error) {
          eventBus.publish('core.module_error', {
            module_id: moduleDef.module_id,
            event: eventName,
            error: error?.message || String(error),
          });
        }
      });
    },
    async call(eventName, payload) {
      const key = String(eventName || '').trim();
      const handlers = [...(eventBus._handlers.get(key) || [])];
      const results = [];
      for (const handler of handlers) {
        results.push(await handler(payload));
      }
      return results;
    },
    publish(eventName, payload) {
      eventBus.publish(eventName, {
        ...(payload || {}),
        module_id: moduleDef.module_id,
      });
    },
    registerBrainInstruction(instruction) {
      return registerBrainInstruction(runtimeState, moduleDef.module_id, instruction);
    },
    registerBrainTool(definition = {}) {
      return registerBrainTool(runtimeState, moduleDef.module_id, definition);
    },
    registerMessageView(definition = {}) {
      return registerMessageView(runtimeState, moduleDef.module_id, definition);
    },
    registerToolReplyFormatter(definition = {}) {
      return registerToolReplyFormatter(runtimeState, moduleDef.module_id, definition);
    },
  };
}

module.exports = {
  createModuleContext,
};
