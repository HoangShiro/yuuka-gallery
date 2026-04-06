const createAccessModule = require('./access.cjs');
const createPingModule = require('./ping.cjs');
const createEchoModule = require('./echo.cjs');
const createChatModule = require('./chat.cjs');
const createMessageModule = require('./message.cjs');
const createChannelModule = require('./channel.cjs');
const createVoiceModule = require('./voice.cjs');
const createTtsModule = require('./tts.cjs');
const createBrainModule = require('./brain.cjs');
const createSummarizerModule = require('./summarizer.cjs');
const createPlayMusicModule = require('./play_music.cjs');

function createBuiltInModuleRegistry(deps) {
  return {
    'core.access': createAccessModule(deps),
    'core.ping': createPingModule(deps),
    'core.echo': createEchoModule(deps),
    'core.chat': createChatModule(deps),
    'core.message': createMessageModule(deps),
    'core.channel': createChannelModule(deps),
    'core.tts': createTtsModule(deps),
    'core.voice': createVoiceModule(deps),
    'core.brain': createBrainModule(deps),
    'core.summarizer': createSummarizerModule(deps),
    'core.play-music': createPlayMusicModule(deps),
  };
}

module.exports = {
  createBuiltInModuleRegistry,
};
