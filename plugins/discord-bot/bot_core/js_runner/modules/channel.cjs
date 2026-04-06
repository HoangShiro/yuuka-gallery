const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const { addCommandDefinition } = require('../runtime_state.cjs');
const { safeChannelName, safeGuildName, safeUserTag } = require('../discord_utils.cjs');

module.exports = function createChannelModule(deps) {
  const { runtimeState } = deps;
  return {
    module_id: 'core.channel',
    name: 'Channel Tools',
    setup(ctx) {
      ctx.registerBrainInstruction('Quản lý text channel trong guild khi actor có quyền Manage Channels.');
      ctx.registerBrainTool({
        tool_id: 'channel_create_text',
        title: 'Create text channel',
        description: 'Tạo text channel mới trong guild.',
        call_event: 'channel.action_requested',
        input_schema: {
          action: '"create_text"',
          name: 'string',
          guild: 'DiscordGuild',
          interaction: 'DiscordInteraction',
        },
      });
      ctx.registerBrainTool({
        tool_id: 'channel_manage',
        title: 'Rename/lock/unlock channel',
        description: 'Đổi tên, khóa, hoặc mở khóa channel hiện tại.',
        call_event: 'channel.action_requested',
        input_schema: {
          action: '"rename"|"lock"|"unlock"',
          name: 'string?',
          channel: 'DiscordChannel',
          guild: 'DiscordGuild',
          interaction: 'DiscordInteraction',
        },
      });
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('create-text')
        .setDescription('Create a text channel in the current guild')
        .addStringOption((option) => option.setName('name').setDescription('Channel name').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('rename-channel')
        .setDescription('Rename the current channel')
        .addStringOption((option) => option.setName('name').setDescription('New channel name').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('lock-channel')
        .setDescription('Prevent @everyone from sending messages here')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('unlock-channel')
        .setDescription('Allow @everyone to send messages here again')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels));

      ctx.subscribe('channel.action_requested', async (payload) => {
        const interaction = payload?.interaction;
        const guild = payload?.guild;
        const channel = payload?.channel;
        const actor = interaction?.member;
        if (!guild || !interaction || !actor?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
          throw new Error('Missing Manage Channels permission.');
        }
        if (payload.action === 'create_text') {
          const created = await guild.channels.create({ name: payload.name, type: ChannelType.GuildText });
          ctx.publish('channel.action_completed', {
            action: payload.action,
            channel_id: String(created.id || ''),
            channel_name: safeChannelName(created),
          });
          return created;
        }
        if (!channel) {
          throw new Error('Target channel is missing.');
        }
        if (payload.action === 'rename') {
          await channel.setName(payload.name);
          ctx.publish('channel.action_completed', {
            action: payload.action,
            channel_id: String(channel.id || ''),
            channel_name: safeChannelName(channel),
          });
          return channel;
        }
        if (payload.action === 'lock' || payload.action === 'unlock') {
          await channel.permissionOverwrites.edit(guild.roles.everyone, {
            SendMessages: payload.action === 'unlock' ? null : false,
          });
          ctx.publish('channel.action_completed', {
            action: payload.action,
            channel_id: String(channel.id || ''),
            channel_name: safeChannelName(channel),
          });
        }
        return channel;
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand()) {
          return;
        }
        if (!['create-text', 'rename-channel', 'lock-channel', 'unlock-channel'].includes(interaction.commandName)) {
          return;
        }
        const payload = {
          interaction,
          guild: interaction.guild,
          channel: interaction.channel,
        };
        if (interaction.commandName === 'create-text') {
          payload.action = 'create_text';
          payload.name = interaction.options.getString('name', true);
        }
        if (interaction.commandName === 'rename-channel') {
          payload.action = 'rename';
          payload.name = interaction.options.getString('name', true);
        }
        if (interaction.commandName === 'lock-channel') {
          payload.action = 'lock';
        }
        if (interaction.commandName === 'unlock-channel') {
          payload.action = 'unlock';
        }
        const result = await ctx.call('channel.action_requested', payload);
        const resultChannel = Array.isArray(result) ? result.find(Boolean) : result;
        await replyToInteraction(interaction, {
          content: resultChannel ? `Đã thực hiện action cho channel ${safeChannelName(resultChannel)}.` : 'Đã thực hiện action cho channel.',
          ephemeral: true,
        });
        ctx.publish('bot.command_executed', {
          command: interaction.commandName,
          guild: safeGuildName(interaction.guild),
          author: safeUserTag(interaction.user),
          payload: payload.name || payload.action,
        });
      });
    },
  };
};
