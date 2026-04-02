const { SlashCommandBuilder } = require('discord.js');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const {
  addCommandDefinition,
  isPolicyEnabled,
  matchesPolicyChannelAllowlist,
  registerPolicyDefinition,
} = require('../runtime_state.cjs');
const { safeChannelName, safeGuildName, safeUserTag, truncateText } = require('../discord_utils.cjs');

const POLICY_APP_COMMANDS = 'core.voice.app_commands';
const POLICY_ALLOWED_CHANNELS = 'core.voice.allowed_channels';

function isAllowedVoiceChannel(runtimeState, voiceChannelId) {
  if (!isPolicyEnabled(runtimeState, POLICY_ALLOWED_CHANNELS)) {
    return true;
  }
  return matchesPolicyChannelAllowlist(runtimeState, POLICY_ALLOWED_CHANNELS, voiceChannelId);
}

module.exports = function createVoiceModule(deps) {
  const { runtimeState, voiceAdapter } = deps;
  return {
    module_id: 'core.voice',
    name: 'Voice Tools',
    async onReady() {
      const records = runtimeState.voiceState.joinedChannelByGuild.values();
      for (const record of records) {
        if (record.connected && record.voice_channel_id) {
          try {
            await voiceAdapter.connect(record.guild_id, record.voice_channel_id, record);
            deps.logger?.log('info', `[Voice] Reconnected to channel ${record.voice_channel_id} in guild ${record.guild_id}`);
          } catch (err) {
            deps.logger?.log('warning', `[Voice] Failed to reconnect to channel ${record.voice_channel_id}: ${err.message}`);
          }
        }
      }
    },
    setup(ctx) {
      registerPolicyDefinition(runtimeState, 'core.voice', {
        policy_id: POLICY_APP_COMMANDS,
        group_id: 'voice',
        group_name: 'Voice',
        title: 'Voice app commands',
        description: 'Allow voice-related utility app commands such as join, leave, status, and speak placeholders.',
        default_enabled: true,
      });
      registerPolicyDefinition(runtimeState, 'core.voice', {
        policy_id: POLICY_ALLOWED_CHANNELS,
        group_id: 'voice',
        group_name: 'Voice',
        title: 'Allowed voice channels',
        description: 'Restrict voice workflows to selected voice channel IDs. Leave empty to allow any voice channel when the module policy is enabled.',
        default_enabled: false,
        settings: {
          allowed_channel_ids: '',
        },
      });
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('join-voice')
        .setDescription('Track the caller\'s current voice channel as the active voice context'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('leave-voice')
        .setDescription('Clear the active voice context for this guild'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('voice-status')
        .setDescription('Show the current tracked voice context'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('voice-speak')
        .setDescription('Queue a voice utterance placeholder for future TTS support')
        .addStringOption((option) => option.setName('text').setDescription('Text to speak').setRequired(true)));

      ctx.subscribe('discord.voice_state_update', async ({ oldState, newState }) => {
        const guild = newState?.guild || oldState?.guild;
        const member = newState?.member || oldState?.member;
        const channel = newState?.channel || null;
        const fact = {
          guild_id: String(guild?.id || ''),
          actor_uid: String(member?.id || ''),
          voice_channel_id: String(channel?.id || ''),
          voice_channel_name: safeChannelName(channel),
          member_count: Number(channel?.members?.size || 0),
          at: new Date().toISOString(),
        };
        runtimeState.voiceState.lastVoiceFactByGuild.set(String(guild?.id || ''), fact);
        if (typeof runtimeState.schedulePersist === 'function') {
          runtimeState.schedulePersist();
        }
        ctx.publish('voice.state_fact', fact);
        ctx.publish('context.voice_fact', fact);
      });

      ctx.subscribe('voice.join_requested', async (payload) => {
        const guildId = String(payload?.guild_id || payload?.guild?.id || '');
        if (!guildId) {
          throw new Error('Guild is required for voice join.');
        }
        return voiceAdapter.connect(guildId, payload.voice_channel_id, payload);
      });

      ctx.subscribe('voice.leave_requested', async (payload) => {
        const guildId = String(payload?.guild_id || payload?.guild?.id || '');
        if (!guildId) {
          throw new Error('Guild is required for voice leave.');
        }
        return voiceAdapter.disconnect(guildId);
      });

      ctx.subscribe('voice.speak_requested', async (payload) => {
        const result = await voiceAdapter.enqueueSpeech(String(payload?.guild_id || ''), String(payload?.text || ''));
        ctx.publish('context.event_fact', {
          scope: 'voice',
          event_name: 'voice.speak_requested',
          text_preview: truncateText(payload?.text || '', 120),
          implemented: Boolean(result?.implemented),
          mode: result?.mode || 'tracking',
        });
        return result;
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand()) {
          return;
        }
        if (!['join-voice', 'leave-voice', 'voice-status', 'voice-speak'].includes(interaction.commandName)) {
          return;
        }
        if (!isPolicyEnabled(runtimeState, POLICY_APP_COMMANDS)) {
          await replyToInteraction(interaction, { content: 'Voice app commands đang bị tắt.', ephemeral: true });
          return;
        }
        const memberVoice = interaction.member?.voice?.channel || null;
        const guildId = String(interaction.guildId || '');
        if (interaction.commandName === 'join-voice') {
          if (!memberVoice) {
            await replyToInteraction(interaction, { content: 'Bạn chưa ở trong voice channel.', ephemeral: true });
            return;
          }
          if (!isAllowedVoiceChannel(runtimeState, String(memberVoice.id || ''))) {
            await replyToInteraction(interaction, { content: 'Voice channel hiện tại không nằm trong allowlist.', ephemeral: true });
            return;
          }
          await ctx.call('voice.join_requested', {
            guild_id: guildId,
            voice_channel_id: String(memberVoice.id || ''),
            voice_channel_name: safeChannelName(memberVoice),
            member_count: Number(memberVoice.members?.size || 0),
          });
          await replyToInteraction(interaction, { content: `Bot đang tham gia voice channel: ${safeChannelName(memberVoice)}.`, ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'join-voice',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
            payload: safeChannelName(memberVoice),
          });
          return;
        }
        if (interaction.commandName === 'leave-voice') {
          await ctx.call('voice.leave_requested', { guild_id: guildId });
          await replyToInteraction(interaction, { content: 'Đã xóa voice context hiện tại.', ephemeral: true });
          ctx.publish('voice.left', { guild_id: guildId });
          ctx.publish('bot.command_executed', {
            command: 'leave-voice',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
          });
          return;
        }
        if (interaction.commandName === 'voice-status') {
          const state = voiceAdapter.getStatus(guildId) || runtimeState.voiceState.lastVoiceFactByGuild.get(guildId);
          await replyToInteraction(interaction, {
            content: state
              ? `Voice context: ${state.voice_channel_name || state.voice_channel_id} (${state.member_count || 0} members).`
              : 'Chưa có voice context nào được ghi nhận.',
            ephemeral: true,
          });
          return;
        }
        if (interaction.commandName === 'voice-speak') {
          const text = interaction.options.getString('text', true);
          const activeVoice = voiceAdapter.getStatus(guildId) || runtimeState.voiceState.lastVoiceFactByGuild.get(guildId);
          if (activeVoice?.voice_channel_id && !isAllowedVoiceChannel(runtimeState, String(activeVoice.voice_channel_id || ''))) {
            await replyToInteraction(interaction, { content: 'Voice context hiện tại không nằm trong allowlist.', ephemeral: true });
            return;
          }
          await ctx.call('voice.speak_requested', {
            guild_id: guildId,
            text,
          });
          await replyToInteraction(interaction, { content: 'Đã nhận yêu cầu speak. MVP hiện mới ghi nhận context, chưa phát audio trực tiếp.', ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'voice-speak',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
            payload: truncateText(text, 80),
          });
        }
      });
    },
  };
};
