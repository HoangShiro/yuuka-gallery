const { Events } = require('discord.js');

function wireDiscordEvents(client, eventBus) {
  client.on(Events.MessageCreate, (message) => {
    eventBus.publish('discord.message_create', { message });
  });
  client.on(Events.InteractionCreate, (interaction) => {
    eventBus.publish('discord.app_command', { interaction });
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    eventBus.publish('discord.voice_state_update', { oldState, newState });
  });
  client.on(Events.ChannelCreate, (channel) => {
    eventBus.publish('discord.channel_create', { channel });
  });
  client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
    eventBus.publish('discord.channel_update', { oldChannel, newChannel });
  });
}

module.exports = {
  wireDiscordEvents,
};
