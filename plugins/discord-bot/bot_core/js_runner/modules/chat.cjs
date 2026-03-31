const { SlashCommandBuilder } = require('discord.js');
const { requestBrainReply, requestChatBridge } = require('../chat_bridge.cjs');
const { buildDiscordContextBundle } = require('../context_builder.cjs');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const { clearMemoForConversation, clearActorSummary } = require('../memo_store.cjs');
const {
  addCommandDefinition,
  isPolicyEnabled,
  matchesPolicyChannelAllowlist,
  registerPolicyDefinition,
} = require('../runtime_state.cjs');
const {
  conversationKeyFromInteraction,
  conversationKeyFromMessage,
  safeChannelName,
  safeGuildName,
  safeUserTag,
  sessionIdFromInteraction,
  sessionIdFromMessage,
} = require('../discord_utils.cjs');

const POLICY_MESSAGE_COMMANDS = 'core.chat.message_commands';
const POLICY_NATURAL_CHAT = 'core.chat.natural_chat';
const POLICY_APP_RESET = 'core.chat.app_command_reset';

function wantsNaturalReply(message, runtimeState) {
  if (!message || message.author?.bot) {
    return false;
  }
  const raw = String(message.content || '').trim();
  if (!raw || raw.startsWith('!')) {
    return false;
  }
  if (!isPolicyEnabled(runtimeState, POLICY_NATURAL_CHAT)) {
    return false;
  }
  return matchesPolicyChannelAllowlist(runtimeState, POLICY_NATURAL_CHAT, message.channel?.id);
}

module.exports = function createChatModule(deps) {
  const { runtimeConfig, runtimeState, client } = deps;
  return {
    module_id: 'core.chat',
    name: 'Character',
    setup(ctx) {
      registerPolicyDefinition(runtimeState, 'core.chat', {
        policy_id: POLICY_NATURAL_CHAT,
        group_id: 'chat',
        group_name: 'Chat',
        title: 'Natural chat in allowed channels',
        description: 'Allow the bot to reply naturally to normal messages in configured channels without requiring a slash command.',
        default_enabled: false,
        settings: {
          allowed_channel_ids: '',
        },
      });
      registerPolicyDefinition(runtimeState, 'core.chat', {
        policy_id: POLICY_MESSAGE_COMMANDS,
        group_id: 'chat',
        group_name: 'Chat',
        title: 'Message chat commands',
        description: 'Allow message-based chat commands such as !chat and !chat-reset.',
        default_enabled: true,
      });
      registerPolicyDefinition(runtimeState, 'core.chat', {
        policy_id: POLICY_APP_RESET,
        group_id: 'chat',
        group_name: 'Chat',
        title: 'App command reset',
        description: 'Allow utility reset through /chat-reset while keeping natural chat separate from app commands.',
        default_enabled: true,
      });
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('chat-reset')
        .setDescription('Reset the current chat session for this channel'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('fact-reset')
        .setDescription('Reset your personal facts/summaries in my memory'));

      ctx.subscribe('discord.message_create', async ({ message }) => {
        if (!message || message.author?.bot) {
          return;
        }
        const raw = String(message.content || '').trim();
        if (!raw) {
          return;
        }
        const lowered = raw.toLowerCase();
        const characterId = String(runtimeConfig.chat_character_id || '').trim();
        if (lowered === '!chat-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) {
            return;
          }
          if (!characterId) {
            await message.reply('Chat module chưa được cấu hình `chat_character_id`.');
            return;
          }
          const resetPayload = {
            user_hash: String(runtimeConfig.user_hash || ''),
            character_id: characterId,
            session_id: sessionIdFromMessage(message),
            reset_session: true,
            discord_context: buildDiscordContextBundle(client, runtimeState, { message, actor: message.author, channel: message.channel, guild: message.guild }),
          };
          const c_key = conversationKeyFromMessage(message);
          clearMemoForConversation(runtimeState, c_key);
          await requestChatBridge(runtimeConfig, resetPayload);
          await message.reply('Đã reset session chat cho kênh hiện tại.');
          ctx.publish('bot.command_executed', {
            command: 'chat-reset',
            guild: safeGuildName(message.guild),
            author: safeUserTag(message.author),
            character_id: characterId,
            conversation_key: c_key,
          });
          return;
        }

        if (lowered === '!fact-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) return;
          clearActorSummary(runtimeState, String(message.author.id));
          await message.reply('Đã xóa tất cả thông tin tóm tắt về bạn trong bộ nhớ của tôi.');
          ctx.publish('bot.command_executed', {
            command: 'fact-reset',
            guild: safeGuildName(message.guild),
            author: safeUserTag(message.author),
          });
          return;
        }
        let prompt = '';
        let eventContext = null;
        if (lowered.startsWith('!chat ')) {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) {
            return;
          }
          prompt = raw.slice('!chat '.length).trim();
          eventContext = { event_type: 'message.command', trigger: '!chat' };
        } else if (wantsNaturalReply(message, runtimeState)) {
          prompt = raw;
          eventContext = { event_type: 'message.natural_chat', trigger: 'allowed_channel' };
        } else {
          return;
        }
        if (!characterId) {
          await message.reply('Chat module chưa được cấu hình `chat_character_id`.');
          return;
        }
        if (!prompt) {
          return;
        }
        await message.channel.sendTyping();
        const bridge = await requestBrainReply(runtimeConfig, client, runtimeState, {
          prompt,
          message,
          actor: message.author,
          channel: message.channel,
          guild: message.guild,
          event_context: eventContext,
        });
        const sent = await message.reply(bridge.reply);
        runtimeState.messageState.lastBotMessageByChannel.set(String(message.channel?.id || ''), sent);

        ctx.publish('bot.llm_trace', {
          guild: safeGuildName(message.guild),
          channel: safeChannelName(message.channel),
          author: safeUserTag(message.author),
          prompt: bridge.llm_input,
          response: bridge.raw_response
        });

        ctx.publish('bot.command_executed', {
          command: eventContext?.event_type === 'message.natural_chat' ? 'natural-chat' : 'chat',
          guild: safeGuildName(message.guild),
          author: safeUserTag(message.author),
          character_id: characterId,
          session_id: bridge.session_id,
          conversation_key: bridge.conversation_key,
          payload: prompt,
        });
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand()) {
          return;
        }
        if (interaction.commandName === 'chat-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_APP_RESET)) {
            await replyToInteraction(interaction, { content: 'Chat reset qua App Command đang bị tắt.', ephemeral: true });
            return;
          }
          const characterId = String(runtimeConfig.chat_character_id || '').trim();
          if (!characterId) {
            await replyToInteraction(interaction, { content: 'Chat module chưa được cấu hình `chat_character_id`.', ephemeral: true });
            return;
          }
          const resetPayload = {
            user_hash: String(runtimeConfig.user_hash || ''),
            character_id: characterId,
            session_id: sessionIdFromInteraction(interaction),
            reset_session: true,
            discord_context: buildDiscordContextBundle(client, runtimeState, {
              interaction,
              actor: interaction.user,
              channel: interaction.channel,
              guild: interaction.guild,
              event_context: { event_type: 'app_command', command_name: 'chat-reset' },
            }),
          };
          const c_key = conversationKeyFromInteraction(interaction);
          clearMemoForConversation(runtimeState, c_key);
          await requestChatBridge(runtimeConfig, resetPayload);
          await replyToInteraction(interaction, { content: 'Đã reset session chat cho ngữ cảnh hiện tại.', ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'chat-reset',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
            character_id: characterId,
            conversation_key: c_key,
          });
          return;
        }
        if (interaction.commandName === 'fact-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_APP_RESET)) {
            await replyToInteraction(interaction, { content: 'Fact reset qua App Command đang bị tắt.', ephemeral: true });
            return;
          }
          clearActorSummary(runtimeState, String(interaction.user.id));
          await replyToInteraction(interaction, { content: 'Đã xóa tất cả thông tin tóm tắt về bạn trong bộ nhớ của tôi.', ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'fact-reset',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
          });
          return;
        }
      });
    },
  };
};
