const { SlashCommandBuilder } = require('discord.js');
const { requestBrainReply } = require('../chat_bridge.cjs');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const { updateHybridMemo } = require('../memo_store.cjs');
const { addCommandDefinition } = require('../runtime_state.cjs');
const {
  conversationKeyFromMessage,
  extractMessageText,
  makeParticipant,
  safeChannelName,
  safeGuildName,
  safeUserTag,
  toIsoDate,
  truncateText,
} = require('../discord_utils.cjs');

module.exports = function createBrainModule(deps) {
  const { runtimeConfig, runtimeState, client } = deps;
  return {
    module_id: 'core.brain',
    name: 'Brain',
    setup(ctx) {
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('brain-ask')
        .setDescription('Ask the AI assistant using Brain orchestration')
        .addStringOption((option) => option.setName('prompt').setDescription('Your request').setRequired(true)));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('brain-summarize-channel')
        .setDescription('Summarize the recent memo state of the current channel'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('brain-decide-reply-mode')
        .setDescription('Show which reply mode Brain would currently use'));

      ctx.subscribe('discord.message_create', async ({ message }) => {
        if (!message || !message.author) {
          return;
        }
        const participant = makeParticipant(message.author);
        updateHybridMemo(runtimeState, {
          conversation_key: conversationKeyFromMessage(message),
          actor_uid: participant?.uid || '',
          actor_name: participant?.display_name || '',
          text: extractMessageText(message),
          kind: 'message',
          channel_name: safeChannelName(message.channel),
          participant_uids: participant?.uid ? [participant.uid] : [],
          at: toIsoDate(message.createdAt),
        });
        // Event facts should NOT include every chat message because the conversation summary already captures chat history.
        const raw = String(message.content || '').trim();
        const lowered = raw.toLowerCase();
        const isMention = Boolean(client.user && message.mentions?.users?.has(client.user.id));
        if (!raw || message.author?.bot) {
          return;
        }

        const { isPolicyEnabled, matchesPolicyChannelAllowlist } = require('../runtime_state.cjs');
        let shouldTriggerBrain = false;
        
        if (lowered.startsWith('!ask ')) {
          shouldTriggerBrain = true;
        } else if (isMention) {
          const naturalChatAllowed = isPolicyEnabled(runtimeState, 'core.chat.natural_chat') && 
                                     matchesPolicyChannelAllowlist(runtimeState, 'core.chat.natural_chat', message.channel?.id);
          if (!naturalChatAllowed) {
            shouldTriggerBrain = true;
          }
        }

        if (!shouldTriggerBrain) {
          return;
        }
        
        const prompt = lowered.startsWith('!ask ') ? raw.slice('!ask '.length).trim() : raw.replace(/<@!?\d+>/g, '').trim();
        if (!prompt) {
          return;
        }
        const reply = await requestBrainReply(runtimeConfig, client, runtimeState, {
          prompt,
          message,
          actor: message.author,
          channel: message.channel,
          guild: message.guild,
          event_context: { event_type: 'brain.message', trigger: lowered.startsWith('!ask ') ? '!ask' : 'mention' },
        });
        await message.reply(reply.reply);
        ctx.publish('brain.reply_ready', {
          conversation_key: reply.conversation_key,
          session_id: reply.session_id,
        });
        ctx.publish('bot.command_executed', {
          command: lowered.startsWith('!ask ') ? 'brain-ask' : 'brain-mention',
          guild: safeGuildName(message.guild),
          author: safeUserTag(message.author),
          payload: truncateText(prompt, 100),
        });
      });

      ctx.subscribe('bot.command_executed', async (payload) => {
        updateHybridMemo(runtimeState, {
          conversation_key: String(payload?.conversation_key || `command:${String(payload?.guild || 'dm')}`),
          actor_uid: String(payload?.author || 'system'),
          actor_name: String(payload?.author || 'system'),
          text: `${payload?.command || 'command'} ${payload?.payload || ''}`,
          kind: 'command',
          participant_uids: [String(payload?.author || 'system')],
          at: new Date().toISOString(),
        });
        ctx.publish('context.memo_fact', {
          key: 'command_execution',
          value: `${payload?.author || 'unknown'} used ${payload?.command || 'unknown'}`,
          guild_id: String(payload?.guild || ''),
        });
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand()) {
          return;
        }
        if (interaction.commandName === 'brain-summarize-channel') {
          const key = interaction.channel?.isDMBased && interaction.channel.isDMBased()
            ? `dm:${String(interaction.channelId || '')}`
            : `guild:${String(interaction.guildId || 'dm')}:channel:${String(interaction.channelId || '')}`;
          const summary = runtimeState.memo.conversationSummaries.get(key);
          await replyToInteraction(interaction, {
            content: summary ? truncateText(summary.summary, 1500) : 'Chưa có memo summary cho channel này.',
            ephemeral: true,
          });
          return;
        }
        if (interaction.commandName === 'brain-decide-reply-mode') {
          const mode = interaction.channel?.isDMBased && interaction.channel.isDMBased() ? 'private' : 'public';
          await replyToInteraction(interaction, { content: `Brain sẽ ưu tiên mode \`${mode}\` cho ngữ cảnh hiện tại.`, ephemeral: true });
          return;
        }
        if (interaction.commandName !== 'brain-ask') {
          return;
        }
        const prompt = interaction.options.getString('prompt', true);
        const reply = await requestBrainReply(runtimeConfig, client, runtimeState, {
          prompt,
          interaction,
          actor: interaction.user,
          channel: interaction.channel,
          guild: interaction.guild,
          event_context: { event_type: 'brain.app_command', command_name: 'brain-ask' },
        });
        await replyToInteraction(interaction, { content: reply.reply });
        ctx.publish('bot.command_executed', {
          command: 'brain-ask',
          guild: safeGuildName(interaction.guild),
          author: safeUserTag(interaction.user),
          payload: truncateText(prompt, 100),
        });
      });
    },
  };
};
