const createAccessModule = require('./access.cjs');
const createPingModule = require('./ping.cjs');
const createEchoModule = require('./echo.cjs');
const createChatModule = require('./chat.cjs');
const createMessageModule = require('./message.cjs');
const createChannelModule = require('./channel.cjs');
const createVoiceModule = require('./voice.cjs');
const createBrainModule = require('./brain.cjs');
const createSummarizerModule = require('./summarizer.cjs');

function createBuiltInModuleRegistry(deps) {
  return {
    'core.access': createAccessModule(deps),
    'core.ping': createPingModule(deps),
    'core.echo': createEchoModule(deps),
    'core.chat': createChatModule(deps),
    'core.message': createMessageModule(deps),
    'core.channel': createChannelModule(deps),
    'core.voice': createVoiceModule(deps),
    'core.brain': createBrainModule(deps),
    'core.summarizer': createSummarizerModule(deps),
  };
}

module.exports = {
  createBuiltInModuleRegistry,
};
