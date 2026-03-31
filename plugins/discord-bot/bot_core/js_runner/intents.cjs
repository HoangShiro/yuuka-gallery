const { GatewayIntentBits } = require('discord.js');

function mapIntents(intentNames) {
  const fallback = ['guilds', 'members', 'message_content'];
  const source = Array.isArray(intentNames) && intentNames.length ? intentNames : fallback;
  const map = {
    guilds: GatewayIntentBits.Guilds,
    members: GatewayIntentBits.GuildMembers,
    message_content: GatewayIntentBits.MessageContent,
    guild_messages: GatewayIntentBits.GuildMessages,
    guild_voice_states: GatewayIntentBits.GuildVoiceStates,
    guild_message_reactions: GatewayIntentBits.GuildMessageReactions,
    direct_messages: GatewayIntentBits.DirectMessages,
    direct_message_reactions: GatewayIntentBits.DirectMessageReactions,
  };

  // These intents are required for MessageCreate to fire at all.
  // Without them, discord.js silently drops all messages.
  const requiredIntents = ['guild_messages', 'direct_messages'];

  const activeNames = [];
  const activeBits = [];
  const combined = [...source];
  for (const req of requiredIntents) {
    if (!combined.includes(req)) {
      combined.push(req);
    }
  }
  for (const raw of combined) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) {
      continue;
    }
    const bit = map[key];
    if (!bit) {
      continue;
    }
    if (!activeNames.includes(key)) {
      activeNames.push(key);
      activeBits.push(bit);
    }
  }

  if (!activeBits.length) {
    activeNames.push('guilds');
    activeBits.push(GatewayIntentBits.Guilds);
  }

  return { activeNames, activeBits };
}

module.exports = {
  mapIntents,
};
