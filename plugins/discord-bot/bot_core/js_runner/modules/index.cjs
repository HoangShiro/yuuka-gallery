const createAccessModule = require('./access.cjs');
const createChatModule = require('./chat.cjs');
const createMessageModule = require('./message.cjs');
const createChannelModule = require('./channel.cjs');
const createVoiceModule = require('./voice.cjs');
const createTtsModule = require('./tts.cjs');
const createBrainModule = require('./brain.cjs');
const createSummarizerModule = require('./summarizer.cjs');
const createPlayMusicModule = require('./play_music.cjs');
const createRagModule = require('./rag.cjs');
const createImageGenModule = require('./image_gen.cjs');

function createBuiltInModuleRegistry(deps) {
  return {
    'core.access': createAccessModule(deps),
    'core.chat': createChatModule(deps),
    'core.message': createMessageModule(deps),
    'core.channel': createChannelModule(deps),
    'core.tts': createTtsModule(deps),
    'core.voice': createVoiceModule(deps),
    'core.brain': createBrainModule(deps),
    'core.summarizer': createSummarizerModule(deps),
    'core.play-music': createPlayMusicModule(deps),
    'core.rag': createRagModule(deps),
    'core.image-gen': createImageGenModule(deps),
  };
}

module.exports = {
  createBuiltInModuleRegistry,
};
