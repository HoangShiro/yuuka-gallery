const { SlashCommandBuilder } = require('discord.js');
const { normalizeDiscordPayload, replyToInteraction, sendManagedReply } = require('../interaction_helpers.cjs');
const { addCommandDefinition, resolveMessageView } = require('../runtime_state.cjs');
const { safeGuildName, safeUserTag, truncateText } = require('../discord_utils.cjs');

module.exports = function createMessageModule(deps) {
  const { runtimeState } = deps;
  return {
    module_id: 'core.message',
    name: 'Message Tools',
    setup(ctx) {
      ctx.registerBrainInstruction('Có thể gửi, chỉnh sửa hoặc xóa message do bot quản lý trong channel hiện tại.');
      ctx.registerBrainTool({
        tool_id: 'message_send',
        title: 'Send message',
        description: 'Gửi message văn bản đến channel.',
        call_event: 'message.send_requested',
        input_schema: {
          channel: 'DiscordTextChannel',
          content: 'string',
        },
      });
      ctx.registerBrainTool({
        tool_id: 'message_manage_last',
        title: 'Manage last bot message',
        description: 'Sửa hoặc xóa message gần nhất do bot gửi trong channel.',
        call_event: 'message.manage_requested',
        input_schema: {
          action: '"edit"|"delete"',
          channel_id: 'string',
          content: 'string?',
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'message_send',
        build_payload({ actor }) {
          return {
            content: 'Đã gửi message.',
            title: 'Message',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'message_manage_last',
        build_payload({ actor, meta }) {
          const action = String(meta?.call_payload?.action || '').trim().toLowerCase();
          const content = action === 'delete'
            ? 'Đã xóa message gần nhất của bot.'
            : (action === 'edit' ? 'Đã sửa message gần nhất của bot.' : 'Đã cập nhật message gần nhất của bot.');
          return {
            content,
            title: 'Message',
            tone: 'success',
            user: actor,
          };
        },
      });
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('message-send')
        .setDescription('Send a plain text message through the bot')
        .addStringOption((option) => option.setName('content').setDescription('Message content').setRequired(true)));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('message-edit-last')
        .setDescription('Edit the last bot-authored message in this channel')
        .addStringOption((option) => option.setName('content').setDescription('New content').setRequired(true)));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('message-delete-last')
        .setDescription('Delete the last bot-authored message in this channel'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('message-embed')
        .setDescription('Send a simple embed')
        .addStringOption((option) => option.setName('title').setDescription('Embed title').setRequired(true))
        .addStringOption((option) => option.setName('description').setDescription('Embed description').setRequired(true)));

      ctx.subscribe('message.send_requested', async (payload) => {
        const channel = payload?.channel;
        if (!channel || typeof channel.send !== 'function') {
          return;
        }
        let resolvedComponents = Array.isArray(payload?.components) ? payload.components.filter(Boolean) : [];
        if (!resolvedComponents.length && payload?.view_id) {
          const resolvedView = await resolveMessageView(runtimeState, payload.view_id, payload);
          if (resolvedView?.dropped_count > 0) {
            ctx.publish('message.view_warning', {
              channel_id: String(channel.id || ''),
              view_id: resolvedView.view_id,
              dropped_count: resolvedView.dropped_count,
            });
          }
          if (Array.isArray(resolvedView?.components)) {
            resolvedComponents = resolvedView.components.filter(Boolean);
          }
        }
        const outgoing = {
          content: payload.content,
          embeds: payload.embeds,
          files: payload.files,
          user: payload.user,
        };
        if (resolvedComponents.length) {
          outgoing.components = resolvedComponents;
        }
        const sent = await sendManagedReply(channel, outgoing);
        runtimeState.messageState.lastBotMessageByChannel.set(String(channel.id || ''), sent);
        ctx.publish('message.sent', {
          channel_id: String(channel.id || ''),
          message_id: String(sent.id || ''),
          content_preview: truncateText(payload.content || sent.content || '', 120),
        });
      });

      ctx.subscribe('message.manage_requested', async (payload) => {
        const channelId = String(payload?.channel_id || payload?.channel?.id || '');
        const lastMessage = runtimeState.messageState.lastBotMessageByChannel.get(channelId);
        if (!lastMessage) {
          throw new Error('No managed bot message found for this channel.');
        }
        if (payload.action === 'edit') {
          let resolvedComponents = Array.isArray(payload?.components) ? payload.components.filter(Boolean) : [];
          if (!resolvedComponents.length && payload?.view_id) {
            const resolvedView = await resolveMessageView(runtimeState, payload.view_id, payload);
            if (Array.isArray(resolvedView?.components)) {
              resolvedComponents = resolvedView.components.filter(Boolean);
            }
          }
          const editPayload = {
            content: String(payload.content || '').trim() || ' ',
            user: payload.user,
          };
          if (resolvedComponents.length) {
            editPayload.components = resolvedComponents;
          }
          await lastMessage.edit(normalizeDiscordPayload(editPayload));
        }
        if (payload.action === 'delete') {
          await lastMessage.delete();
          runtimeState.messageState.lastBotMessageByChannel.delete(channelId);
        }
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand()) {
          return;
        }
        const knownCommands = ['message-send', 'message-edit-last', 'message-delete-last', 'message-embed'];
        if (!knownCommands.includes(interaction.commandName)) {
          return;
        }
        if (!interaction.channel || typeof interaction.channel.send !== 'function') {
          await replyToInteraction(interaction, { content: 'Channel is unavailable.', ephemeral: true });
          return;
        }
        if (interaction.commandName === 'message-send') {
          const content = interaction.options.getString('content', true);
          const sent = await sendManagedReply(interaction.channel, { content, user: interaction.user });
          runtimeState.messageState.lastBotMessageByChannel.set(String(interaction.channelId || ''), sent);
          await replyToInteraction(interaction, { content: 'Đã gửi message.', tone: 'success', title: 'Message', user: interaction.user, ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'message-send',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
            payload: truncateText(content, 100),
          });
          return;
        }
        if (interaction.commandName === 'message-edit-last') {
          const content = interaction.options.getString('content', true);
          await ctx.call('message.manage_requested', {
            action: 'edit',
            channel_id: String(interaction.channelId || ''),
            content,
            user: interaction.user,
          });
          await replyToInteraction(interaction, { content: 'Đã sửa message gần nhất của bot.', tone: 'success', title: 'Message', user: interaction.user, ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'message-edit-last',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
          });
          return;
        }
        if (interaction.commandName === 'message-delete-last') {
          await ctx.call('message.manage_requested', {
            action: 'delete',
            channel_id: String(interaction.channelId || ''),
          });
          await replyToInteraction(interaction, { content: 'Đã xóa message gần nhất của bot.', tone: 'success', title: 'Message', user: interaction.user, ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'message-delete-last',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
          });
          return;
        }
        if (interaction.commandName === 'message-embed') {
          const title = interaction.options.getString('title', true);
          const description = interaction.options.getString('description', true);
          const sent = await sendManagedReply(interaction.channel, {
            content: description,
            title,
            tone: 'info',
            user: interaction.user,
          });
          runtimeState.messageState.lastBotMessageByChannel.set(String(interaction.channelId || ''), sent);
          await replyToInteraction(interaction, { content: 'Đã gửi embed.', tone: 'success', title: 'Message', user: interaction.user, ephemeral: true });
          ctx.publish('message.sent', {
            channel_id: String(interaction.channelId || ''),
            message_id: String(sent.id || ''),
            content_preview: truncateText(description, 120),
          });
          ctx.publish('bot.command_executed', {
            command: 'message-embed',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
            payload: truncateText(title, 80),
          });
        }
      });
    },
  };
};
