const { safeGuildName, safeUserTag } = require('../discord_utils.cjs');

module.exports = function createEchoModule() {
  return {
    module_id: 'core.echo',
    name: 'Echo',
    setup(ctx) {
      ctx.subscribe('discord.message_create', async ({ message }) => {
        if (!message || message.author?.bot) {
          return;
        }
        const content = message.content || '';
        if (!content.toLowerCase().startsWith('!echo ')) {
          return;
        }
        const echoed = content.slice('!echo '.length).trim();
        if (!echoed) {
          return;
        }
        await message.reply(echoed);
        ctx.publish('bot.command_executed', {
          command: 'echo',
          guild: safeGuildName(message.guild),
          author: safeUserTag(message.author),
          payload: echoed,
        });
      });
    },
  };
};
