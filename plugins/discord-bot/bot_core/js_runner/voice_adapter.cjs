const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

class TrackingVoiceAdapter {
  constructor(runtimeState, client) {
    this.runtimeState = runtimeState;
    this.client = client;
  }

  async connect(guildId, channelId, metadata = {}) {
    const guild = this.client?.guilds?.cache?.get(String(guildId || ''));
    if (!guild) {
      throw new Error(`Guild ${guildId} not found in client cache.`);
    }

    const connection = joinVoiceChannel({
      channelId: String(channelId || ''),
      guildId: String(guildId || ''),
      adapterCreator: guild.voiceAdapterCreator,
    });

    const record = {
      guild_id: String(guildId || ''),
      voice_channel_id: String(channelId || ''),
      voice_channel_name: String(metadata.voice_channel_name || ''),
      member_count: Number(metadata.member_count || 0),
      at: new Date().toISOString(),
      mode: 'live',
      connected: true,
    };
    this.runtimeState.voiceState.joinedChannelByGuild.set(String(guildId || ''), record);
    if (typeof this.runtimeState.schedulePersist === 'function') {
      this.runtimeState.schedulePersist();
    }
    return record;
  }

  async disconnect(guildId) {
    const connection = getVoiceConnection(String(guildId || ''));
    if (connection) {
      connection.destroy();
    }

    this.runtimeState.voiceState.joinedChannelByGuild.delete(String(guildId || ''));
    if (typeof this.runtimeState.schedulePersist === 'function') {
      this.runtimeState.schedulePersist();
    }
    return { guild_id: String(guildId || ''), connected: false };
  }

  getStatus(guildId) {
    return this.runtimeState.voiceState.joinedChannelByGuild.get(String(guildId || '')) || null;
  }

  async enqueueSpeech(guildId, text) {
    const current = this.getStatus(guildId) || { guild_id: String(guildId || '') };
    return {
      ...current,
      queued_text: String(text || ''),
      implemented: false,
      mode: 'live',
    };
  }
}

function createVoiceAdapter(runtimeState, client) {
  return new TrackingVoiceAdapter(runtimeState, client);
}

module.exports = {
  TrackingVoiceAdapter,
  createVoiceAdapter,
};
