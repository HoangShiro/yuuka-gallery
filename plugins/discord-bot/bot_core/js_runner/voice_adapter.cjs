class TrackingVoiceAdapter {
  constructor(runtimeState) {
    this.runtimeState = runtimeState;
  }

  async connect(guildId, channelId, metadata = {}) {
    const record = {
      guild_id: String(guildId || ''),
      voice_channel_id: String(channelId || ''),
      voice_channel_name: String(metadata.voice_channel_name || ''),
      member_count: Number(metadata.member_count || 0),
      at: new Date().toISOString(),
      mode: 'tracking',
      connected: true,
    };
    this.runtimeState.voiceState.joinedChannelByGuild.set(String(guildId || ''), record);
    if (typeof this.runtimeState.schedulePersist === 'function') {
      this.runtimeState.schedulePersist();
    }
    return record;
  }

  async disconnect(guildId) {
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
      mode: 'tracking',
    };
  }
}

function createVoiceAdapter(runtimeState) {
  return new TrackingVoiceAdapter(runtimeState);
}

module.exports = {
  TrackingVoiceAdapter,
  createVoiceAdapter,
};
