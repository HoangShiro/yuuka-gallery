const { EventBus } = require('./event_bus.cjs');
const { wireDiscordEvents } = require('./discord_event_wiring.cjs');
const { createModuleContext } = require('./module_context.cjs');
const { createBuiltInModuleRegistry } = require('./modules/index.cjs');
const { addContextFact, applyConfiguredPolicies, createRuntimeState } = require('./runtime_state.cjs');
const { createRuntimePersistence } = require('./runtime_persistence.cjs');
const { createVoiceAdapter } = require('./voice_adapter.cjs');
const { truncateText } = require('./discord_utils.cjs');

function installRuntimeObservers(eventBus, logger, runtimeState) {
  eventBus.subscribe('bot.command_executed', (payload) => {
    if (!payload || !payload.command) {
      return;
    }
    if (payload.command === 'ping') {
      logger.log('info', `[${payload.guild}] ${payload.author} used !ping`);
      return;
    }
    if (payload.command === 'echo') {
      logger.log('info', `[${payload.guild}] ${payload.author} echoed: ${payload.payload || ''}`);
      return;
    }
    if (payload.command === 'chat') {
      logger.log('info', `[${payload.guild}] ${payload.author} used !chat (${payload.character_id || 'no-character'})`);
      return;
    }
    if (payload.command === 'chat-reset') {
      logger.log('info', `[${payload.guild}] ${payload.author} used !chat-reset (${payload.character_id || 'no-character'})`);
    }
  });

  eventBus.subscribe('core.module_error', (payload) => {
    if (!payload) {
      return;
    }
    const modulePrefix = payload.module_id ? `${payload.module_id} ` : '';
    const eventPart = payload.event ? ` (${payload.event})` : '';
    logger.log('error', `${modulePrefix}failed${eventPart}: ${payload.error || 'Unknown error'}`);
  });

  eventBus.subscribe('bot.llm_trace', (payload) => {
    if (!payload) return;
    logger.log('bridge_trace', JSON.stringify({
      guild: payload.guild || '',
      channel: payload.channel || '',
      author: payload.author || '',
      prompt: payload.prompt || [],
      response: payload.response || '',
    }));
  });

  const contextFactEvents = [
    'context.user_fact',
    'context.channel_fact',
    'context.task_fact',
    'context.voice_fact',
    'context.memo_fact',
    'context.event_fact',
  ];

  for (const eventName of contextFactEvents) {
    eventBus.subscribe(eventName, (payload) => {
      if (!payload) {
        return;
      }
      addContextFact(runtimeState, eventName, payload);
      if (eventName !== 'context.event_fact') {
        return;
      }
      logger.log('info', `context.event_fact ${truncateText(JSON.stringify(payload), 220)}`);
    });
  }
}

function setupModules(client, modules, runtimeConfig, logger) {
  const selected = Array.isArray(modules) ? modules : [];
  const eventBus = new EventBus();
  const runtimeState = createRuntimeState();
  const persistence = createRuntimePersistence(runtimeConfig, logger);
  runtimeState.schedulePersist = () => persistence.scheduleSave(runtimeState);
  runtimeState.flushPersist = () => persistence.flush(runtimeState);
  persistence.loadInto(runtimeState);
  applyConfiguredPolicies(runtimeState, runtimeConfig?.policies || {});
  const voiceAdapter = createVoiceAdapter(runtimeState, client);
  runtimeState.voiceState.adapter = voiceAdapter;

  const registry = createBuiltInModuleRegistry({
    runtimeConfig,
    runtimeState,
    client,
    voiceAdapter,
    logger,
  });

  installRuntimeObservers(eventBus, logger, runtimeState);
  wireDiscordEvents(client, eventBus);

  const activeModules = [];
  for (const moduleId of selected) {
    const moduleDef = registry[moduleId];
    if (!moduleDef || typeof moduleDef.setup !== 'function') {
      logger.log('warning', `Unknown module skipped: ${moduleId}`);
      continue;
    }
    const moduleContext = createModuleContext(eventBus, moduleDef, runtimeState);
    try {
      moduleDef.setup(moduleContext);
      activeModules.push(moduleDef);
      logger.log('info', `Loaded module: ${moduleDef.name}`);
    } catch (error) {
      eventBus.publish('core.module_error', {
        module_id: moduleDef.module_id,
        event: 'setup',
        error: error?.message || String(error),
      });
    }
  }

  const onReady = async () => {
    for (const mod of activeModules) {
      if (typeof mod.onReady === 'function') {
        try {
          await mod.onReady();
        } catch (error) {
          logger.log('error', `Module ${mod.module_id} ready hook failed: ${error.message}`);
        }
      }
    }
  };

  return { eventBus, runtimeState, voiceAdapter, persistence, onReady };
}

module.exports = {
  setupModules,
};
