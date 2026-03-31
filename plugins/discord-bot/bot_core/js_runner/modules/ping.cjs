const { safeGuildName, safeUserTag } = require('../discord_utils.cjs');

module.exports = function createPingModule() {
  return {
    module_id: 'core.ping',
    name: 'Ping',
    setup(ctx) {
      ctx.subscribe('discord.message_create', async ({ message }) => {
        if (!message || message.author?.bot) {
          return;
        }
        if (message.content.trim().toLowerCase() !== '!ping') {
          return;
        }
        await message.reply('Pong!');
        ctx.publish('bot.command_executed', {
          command: 'ping',
          guild: safeGuildName(message.guild),
          author: safeUserTag(message.author),
        });
      });
    },
  };
};
