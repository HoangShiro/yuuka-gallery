const { SlashCommandBuilder } = require('discord.js');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const {
  addCommandDefinition, isPolicyEnabled,
  matchesPolicyChannelAllowlist, registerPolicyDefinition,
} = require('../runtime_state.cjs');
const { safeChannelName, safeDisplayName, safeGuildName, safeUserTag, truncateText } = require('../discord_utils.cjs');

const POLICY_APP = 'core.voice.app_commands';
const POLICY_CHANNELS = 'core.voice.allowed_channels';
const POLICY_VOLUMES = 'core.voice.volumes';

const VALID_CHANNELS = ['music', 'speak'];
const resolveChannel = (v) => (VALID_CHANNELS.includes(v) ? v : 'music');

function isAllowedVC(rs, id) {
  if (!isPolicyEnabled(rs, POLICY_CHANNELS)) return true;
  return matchesPolicyChannelAllowlist(rs, POLICY_CHANNELS, id);
}

module.exports = function createVoiceModule(deps) {
  const { runtimeState, voiceAdapter } = deps;
  return {
    module_id: 'core.voice',
    name: 'Voice Tools',

    async onReady() {
      for (const rec of runtimeState.voiceState.joinedChannelByGuild.values()) {
        if (rec.connected && rec.voice_channel_id) {
          try {
            await voiceAdapter.connect(rec.guild_id, rec.voice_channel_id, rec);
            deps.logger?.log('info', `[Voice] Reconnected ${rec.voice_channel_id} in guild ${rec.guild_id}`);
          } catch (err) {
            deps.logger?.log('warning', `[Voice] Reconnect failed ${rec.voice_channel_id}: ${err.message}`);
          }
        }
      }
    },

    setup(ctx) {
      ctx.registerBrainInstruction('Điều khiển voice queue theo 2 kênh music/speak với join, leave, pause, resume, skip, stop.');
      ctx.registerBrainTool({
        tool_id: 'voice_join',
        title: 'Join voice channel',
        description: 'Kết nối bot vào voice channel của người dùng hiện tại, hoặc theo ID được chỉ định.',
        call_event: 'voice.join_requested',
        input_schema: { voice_channel_id: 'string?' },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_play',
        title: 'Queue audio',
        description: 'Đưa audio vào hàng chờ phát cho music hoặc speak.',
        call_event: 'voice.play_requested',
        default_enabled: true,
        input_schema: {
          guild_id: 'string',
          channel: '"music"|"speak"',
          source: 'string',
          input_type: 'string?',
          noDuck: 'boolean?',
          metadata: 'object?',
        },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_leave',
        title: 'Leave voice channel',
        description: 'Disconnect from the voice channel.',
        call_event: 'voice.leave_requested',
        default_enabled: true,
        input_schema: {},
      });
      ctx.registerBrainTool({
        tool_id: 'voice_pause',
        title: 'Pause playback',
        description: 'Pause audio playback for a specific channel.',
        call_event: 'voice.pause_requested',
        default_enabled: true,
        input_schema: { channel: '"music"|"speak"' },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_resume',
        title: 'Resume playback',
        description: 'Resume audio playback for a specific channel.',
        call_event: 'voice.resume_requested',
        default_enabled: true,
        input_schema: { channel: '"music"|"speak"' },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_skip',
        title: 'Skip track',
        description: 'Skip the current playing audio track.',
        call_event: 'voice.skip_requested',
        default_enabled: true,
        input_schema: { channel: '"music"|"speak"' },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_stop',
        title: 'Stop and clear queue',
        description: 'Stop audio playback and clear the queue.',
        call_event: 'voice.stop_requested',
        default_enabled: true,
        input_schema: { channel: '"music"|"speak"|"all"?' },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_set_volume',
        title: 'Set channel volume',
        description: 'Thay đổi mức âm lượng (0-100) cho music channel hoặc speak channel.',
        call_event: 'voice.set_volume',
        input_schema: {
          channel: '"music"|"speak"',
          volume: 'number',
        },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_set_playback_speed',
        title: 'Set playback speed',
        description: 'Set playback speed (0.25-3.0) for music or speak channel.',
        call_event: 'voice.set_playback_speed',
        input_schema: {
          guild_id: 'string',
          channel: '"music"|"speak"',
          speed: 'number',
        },
      });
      ctx.registerBrainTool({
        tool_id: 'voice_set_skip_silence',
        title: 'Toggle skip silence',
        description: 'Enable or disable silence skipping for music or speak channel.',
        call_event: 'voice.set_skip_silence',
        input_schema: {
          guild_id: 'string',
          channel: '"music"|"speak"',
          enabled: 'boolean',
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_join',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channelName = safeChannelName({ name: result?.voice_channel_name, id: result?.voice_channel_id }) || result?.voice_channel_id || 'voice channel';
          return {
            content: `Đã tham gia: **${channelName}**`,
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_play',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const title = result?.item?.metadata?.title || result?.metadata?.title || result?.item?.id || 'audio';
          const channel = String(result?.channel || 'music');
          return {
            content: `[${channel}] Đã thêm vào hàng chờ: **${title}**.`,
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_leave',
        build_payload({ actor }) {
          return {
            content: 'Đã rời voice channel.',
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_pause',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(result?.channel || 'music');
          const ok = Boolean(result?.paused);
          return {
            content: ok ? `[${channel}] Đã tạm dừng.` : `[${channel}] Không thể tạm dừng.`,
            title: 'Voice Tools',
            tone: ok ? 'success' : 'warning',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_resume',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(result?.channel || 'music');
          const ok = Boolean(result?.resumed);
          return {
            content: ok ? `[${channel}] Đã tiếp tục.` : `[${channel}] Không thể tiếp tục.`,
            title: 'Voice Tools',
            tone: ok ? 'success' : 'warning',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_skip',
        build_payload({ call_results, actor, meta }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(meta?.call_payload?.channel || result?.channel || 'music');
          const skippedTitle = result?.skipped?.metadata?.title || result?.skipped?.id || 'nothing';
          return {
            content: `[${channel}] Skip: **${skippedTitle}** (${Number(result?.remaining || 0)} còn lại).`,
            title: 'Voice Tools',
            tone: 'info',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_stop',
        build_payload({ call_results, actor, meta }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(meta?.call_payload?.channel || 'music');
          if (channel === 'all') {
            return {
              content: `Đã dừng tất cả. Music: ${Number(result?.music?.cleared || 0)}, Speak: ${Number(result?.speak?.cleared || 0)} cleared.`,
              title: 'Voice Tools',
              tone: 'success',
              user: actor,
            };
          }
          return {
            content: `[${channel}] Đã dừng, xoá ${Number(result?.cleared || 0)} track.`,
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_set_volume',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(result?.channel || 'music');
          const volume = Number(result?.volume || 0);
          return {
            content: `[${channel}] Volume set to **${volume}%**.`,
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_set_playback_speed',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(result?.channel || 'music');
          const speed = Number(result?.speed || 1);
          return {
            content: `[${channel}] Playback speed set to **${speed.toFixed(2)}x**.`,
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'voice_set_skip_silence',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          const channel = String(result?.channel || 'music');
          const enabled = Boolean(result?.enabled);
          return {
            content: `[${channel}] Skip silence: **${enabled ? 'ON' : 'OFF'}**.`,
            title: 'Voice Tools',
            tone: 'success',
            user: actor,
          };
        },
      });
      // Relay adapter events → eventBus
      voiceAdapter._onEvent = (name, payload) => ctx.publish(name, payload);

      // -- Policies --
      registerPolicyDefinition(runtimeState, 'core.voice', {
        policy_id: POLICY_APP, group_id: 'voice', group_name: 'Voice',
        title: 'Voice app commands',
        description: 'Allow voice slash commands (join, leave, status, pause, resume, skip, stop).',
        default_enabled: true,
      });
      registerPolicyDefinition(runtimeState, 'core.voice', {
        policy_id: POLICY_CHANNELS, group_id: 'voice', group_name: 'Voice',
        title: 'Allowed voice channels',
        description: 'Restrict to specific voice channel IDs. Empty = allow all.',
        default_enabled: false,
        settings: { allowed_channel_ids: '' },
      });
      registerPolicyDefinition(runtimeState, 'core.voice', {
        policy_id: POLICY_VOLUMES, group_id: 'voice', group_name: 'Voice',
        title: 'Channel Volumes',
        description: 'Set base volume levels for channels (0-100%). Duck ratio automatically calculates relative to music_volume.',
        default_enabled: true,
        settings: { music_volume: 50, speak_volume: 100 },
      });

      // -- Slash commands --
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('join-voice').setDescription('Join your current voice channel'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('leave-voice').setDescription('Leave voice channel'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-status').setDescription('Show voice & player status'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-pause').setDescription('Pause a channel')
        .addStringOption(o => o.setName('channel').setDescription('music or speak').addChoices({ name: 'music', value: 'music' }, { name: 'speak', value: 'speak' })));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-resume').setDescription('Resume a channel')
        .addStringOption(o => o.setName('channel').setDescription('music or speak').addChoices({ name: 'music', value: 'music' }, { name: 'speak', value: 'speak' })));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-skip').setDescription('Skip current track')
        .addStringOption(o => o.setName('channel').setDescription('music or speak').addChoices({ name: 'music', value: 'music' }, { name: 'speak', value: 'speak' })));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-stop').setDescription('Stop & clear queue')
        .addStringOption(o => o.setName('channel').setDescription('music, speak, or all').addChoices({ name: 'music', value: 'music' }, { name: 'speak', value: 'speak' }, { name: 'all', value: 'all' })));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-speed').setDescription('Set playback speed for a channel')
        .addStringOption(o => o.setName('channel').setDescription('music or speak').setRequired(true).addChoices({ name: 'music', value: 'music' }, { name: 'speak', value: 'speak' }))
        .addNumberOption(o => o.setName('speed').setDescription('Playback speed from 0.25 to 3.0').setRequired(true).setMinValue(0.25).setMaxValue(3.0)));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-skip-silence').setDescription('Enable/disable silence skipping for a channel')
        .addStringOption(o => o.setName('channel').setDescription('music or speak').setRequired(true).addChoices({ name: 'music', value: 'music' }, { name: 'speak', value: 'speak' }))
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable skip silence').setRequired(true)));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('voice-speak').setDescription('TTS placeholder')
        .addStringOption(o => o.setName('text').setDescription('Text to speak').setRequired(true)));

      // -- Voice state tracking --
      ctx.subscribe('discord.voice_state_update', async ({ oldState, newState }) => {
        const guild = newState?.guild || oldState?.guild;
        const member = newState?.member || oldState?.member;
        const channel = newState?.channel || null;
        const members = (() => {
          const col = channel?.members;
          if (!col) return [];
          const arr = typeof col.values === 'function' ? [...col.values()] : (Array.isArray(col) ? col : []);
          return arr.slice(0, 20).map((m) => ({
            uid: String(m.id || m.user?.id || ''),
            display_name: safeDisplayName(m.user || m, m),
            is_bot: Boolean(m.user?.bot || m.bot),
          }));
        })();
        const fact = {
          guild_id: String(guild?.id || ''), actor_uid: String(member?.id || ''),
          voice_channel_id: String(channel?.id || ''), voice_channel_name: safeChannelName(channel),
          member_count: Number(channel?.members?.size || 0), members, at: new Date().toISOString(),
        };
        runtimeState.voiceState.lastVoiceFactByGuild.set(String(guild?.id || ''), fact);
        if (typeof runtimeState.schedulePersist === 'function') runtimeState.schedulePersist();
        ctx.publish('voice.state_fact', fact);
        ctx.publish('context.voice_fact', fact);
      });

      // =====================================================================
      // EVENT BUS ENDPOINTS
      // =====================================================================

      ctx.subscribe('voice.join_requested', async (p) => {
        const gid = String(p?.guild_id || p?.guild?.id || '');
        if (!gid) throw new Error('guild_id required');
        const vcid = String(p?.voice_channel_id || '');
        if (!vcid) throw new Error('User is not in a voice channel or voice_channel_id is missing.');
        return voiceAdapter.connect(gid, vcid, p);
      });

      ctx.subscribe('voice.leave_requested', async (p) => {
        const gid = String(p?.guild_id || p?.guild?.id || '');
        if (!gid) throw new Error('guild_id required');

        voiceAdapter.pause(gid, 'music');
        voiceAdapter.pause(gid, 'speak');

        const maxWaitMs = 60000; // wait up to 60s for TTS to finish
        const checkInterval = 500;
        let elapsed = 0;
        
        while (elapsed < maxWaitMs) {
          const st = voiceAdapter.getPlayerStatus(gid);
          if (!st || !st.speak) break;
          const isSpeaking = st.speak.now_playing || st.speak.queue_length > 0;
          if (!isSpeaking) {
            await new Promise(r => setTimeout(r, 600)); // small padding after speaker clears
            break;
          }
          await new Promise(r => setTimeout(r, checkInterval));
          elapsed += checkInterval;
        }

        return voiceAdapter.disconnect(gid);
      });

      // -- Play (channel-aware) --
      ctx.subscribe('voice.play_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        if (!p?.source) throw new Error('source required');
        const conn = voiceAdapter.getStatus(gid);
        if (!conn?.connected) throw new Error(`Not connected in guild ${gid}`);
        const ch = resolveChannel(p.channel);
        const playback = {};
        if (p?.playback && Object.prototype.hasOwnProperty.call(p.playback, 'speed')) {
          playback.speed = p.playback.speed;
        } else if (Object.prototype.hasOwnProperty.call(p || {}, 'playback_speed')) {
          playback.speed = p.playback_speed;
        }
        if (p?.playback && Object.prototype.hasOwnProperty.call(p.playback, 'skip_silence')) {
          playback.skip_silence = p.playback.skip_silence;
        } else if (Object.prototype.hasOwnProperty.call(p || {}, 'skip_silence')) {
          playback.skip_silence = p.skip_silence;
        }
        const result = voiceAdapter.enqueue(gid, ch, p.source, {
          inputType: p.inputType || p.input_type,
          metadata: { ...(p.metadata || {}), noDuck: Boolean(p.noDuck) },
          playback,
        });
        // Don't record bot's own TTS output as context facts — it's redundant
        if (!p.metadata?.tts) {
          ctx.publish('context.event_fact', {
            scope: 'voice', event_name: 'voice.play_requested', guild_id: gid,
            text_preview: truncateText(String(p.metadata?.title || (typeof p.source === 'string' ? p.source : 'stream')), 120),
          });
        }
        // deps.logger?.log('info', `[Voice] Enqueued ${ch} item...`);
        return result;
      });

      ctx.subscribe('voice.track_enqueued', async (payload) => {
        // deps.logger?.log('info', `[Voice] Track enqueued [${payload?.channel || 'unknown'}] ${payload?.item?.id || 'unknown'} title=${truncateText(String(payload?.item?.metadata?.title || ''), 120)}`);
      });

      ctx.subscribe('voice.track_start', async (payload) => {
        // deps.logger?.log('info', `[Voice] Track start [${payload?.channel || 'unknown'}] title=${truncateText(String(payload?.item?.metadata?.title || ''), 120)}`);
      });

      ctx.subscribe('voice.track_end', async (payload) => {
        // deps.logger?.log('info', `[Voice] Track end [${payload?.channel || 'unknown'}] ${payload?.item?.id || 'unknown'} skipped=${Boolean(payload?.skipped)}`);
      });

      ctx.subscribe('voice.track_error', async (payload) => {
        deps.logger?.log('warning', `[Voice] Track error [${payload?.channel || 'unknown'}] ${payload?.item?.id || 'unknown'}: ${payload?.error || 'Unknown error'}`);
      });

      ctx.subscribe('voice.channel_empty', async (payload) => {
        // deps.logger?.log('info', `[Voice] Channel empty [${payload?.channel || 'unknown'}] guild=${payload?.guild_id || 'unknown'}`);
      });

      ctx.subscribe('voice.audio_debug', async (payload) => {
        // deps.logger?.log('info', `[Voice] Audio debug ...`);
      });

      ctx.subscribe('voice.pause_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        return { guild_id: gid, channel: resolveChannel(p.channel), paused: voiceAdapter.pause(gid, resolveChannel(p.channel)) };
      });

      ctx.subscribe('voice.resume_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        return { guild_id: gid, channel: resolveChannel(p.channel), resumed: voiceAdapter.resume(gid, resolveChannel(p.channel)) };
      });

      ctx.subscribe('voice.skip_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        return voiceAdapter.skip(gid, resolveChannel(p.channel));
      });

      ctx.subscribe('voice.stop_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        if (p.channel === 'all') return voiceAdapter.stopAll(gid);
        return voiceAdapter.stopChannel(gid, resolveChannel(p.channel));
      });

      ctx.subscribe('voice.remove_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid || !p?.item_id) throw new Error('guild_id and item_id required');
        return voiceAdapter.removeFromQueue(gid, resolveChannel(p.channel), p.item_id);
      });

      ctx.subscribe('voice.status_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        return voiceAdapter.getPlayerStatus(gid);
      });

      ctx.subscribe('voice.set_duck_ratio', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        voiceAdapter.setDuckRatio(gid, p.ratio);
        return { guild_id: gid, ratio: p.ratio };
      });

      ctx.subscribe('voice.set_volume', async (p) => {
        const channel = resolveChannel(p.channel);
        let volume = Number(p.volume);
        if (isNaN(volume)) volume = 50;
        volume = Math.max(0, Math.min(100, volume));
        
        const { setPolicySettings } = require('../runtime_state.cjs');
        setPolicySettings(runtimeState, POLICY_VOLUMES, { [`${channel}_volume`]: volume });
        
        deps.logger?.log('info', `[Voice] Set volume ${channel}=${volume}% via Brain`);
        return { success: true, channel, volume };
      });

      ctx.subscribe('voice.set_playback_speed', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        const channel = resolveChannel(p.channel);
        const speed = voiceAdapter.setChannelPlaybackSpeed(gid, channel, p.speed);
        deps.logger?.log('info', `[Voice] Set playback speed ${channel}=${speed} in guild ${gid}`);
        return { guild_id: gid, channel, speed };
      });

      ctx.subscribe('voice.set_skip_silence', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        const channel = resolveChannel(p.channel);
        const enabled = voiceAdapter.setChannelSkipSilence(gid, channel, Boolean(p.enabled));
        deps.logger?.log('info', `[Voice] Set skip silence ${channel}=${enabled} in guild ${gid}`);
        return { guild_id: gid, channel, enabled };
      });

      // Legacy TTS placeholder
      ctx.subscribe('voice.speak_requested', async (p) => {
        const result = await voiceAdapter.enqueueSpeech(String(p?.guild_id || ''), String(p?.text || ''));
        ctx.publish('context.event_fact', {
          scope: 'voice', event_name: 'voice.speak_requested',
          text_preview: truncateText(p?.text || '', 120),
          implemented: false, mode: 'tracking',
        });
        return result;
      });

      // =====================================================================
      // SLASH COMMAND HANDLER
      // =====================================================================
      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction?.isChatInputCommand()) return;
        const cmds = ['join-voice','leave-voice','voice-status','voice-pause','voice-resume','voice-skip','voice-stop','voice-speed','voice-skip-silence','voice-speak'];
        if (!cmds.includes(interaction.commandName)) return;
        if (!isPolicyEnabled(runtimeState, POLICY_APP)) {
          await replyToInteraction(interaction, { content: 'Voice commands đang bị tắt.', title: 'Voice Tools', tone: 'warning', user: interaction.user, ephemeral: true }); return;
        }
        const gid = String(interaction.guildId || '');
        const memberVC = interaction.member?.voice?.channel || null;
        const chOpt = interaction.options?.getString('channel') || 'music';

        if (interaction.commandName === 'join-voice') {
          if (!memberVC) { await replyToInteraction(interaction, { content: 'Bạn chưa ở trong voice channel.', title: 'Voice Tools', tone: 'warning', user: interaction.user, ephemeral: true }); return; }
          if (!isAllowedVC(runtimeState, String(memberVC.id||''))) { await replyToInteraction(interaction, { content: 'Channel không nằm trong allowlist.', title: 'Voice Tools', tone: 'error', user: interaction.user, ephemeral: true }); return; }
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
          }
          await ctx.call('voice.join_requested', { guild_id: gid, voice_channel_id: String(memberVC.id||''), voice_channel_name: safeChannelName(memberVC), member_count: Number(memberVC.members?.size||0) });
          await replyToInteraction(interaction, { content: `Đã tham gia: **${safeChannelName(memberVC)}**`, title: 'Voice Tools', tone: 'success', user: interaction.user, ephemeral: true });
          ctx.publish('bot.command_executed', { command: 'join-voice', guild: safeGuildName(interaction.guild), author: safeUserTag(interaction.user) });
          return;
        }

        if (interaction.commandName === 'leave-voice') {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
          }
          await ctx.call('voice.leave_requested', { guild_id: gid });
          await replyToInteraction(interaction, { content: 'Đã rời voice channel.', title: 'Voice Tools', tone: 'success', user: interaction.user, ephemeral: true });
          ctx.publish('bot.command_executed', { command: 'leave-voice', guild: safeGuildName(interaction.guild), author: safeUserTag(interaction.user) });
          return;
        }

        if (interaction.commandName === 'voice-status') {
          const conn = voiceAdapter.getStatus(gid) || runtimeState.voiceState.lastVoiceFactByGuild.get(gid);
          const ps = voiceAdapter.getPlayerStatus(gid);
          const L = [];
          L.push(conn ? `🔊 **Channel:** ${conn.voice_channel_name||conn.voice_channel_id}` : '🔇 Chưa kết nối.');
          for (const ch of ['music', 'speak']) {
            const s = ps[ch] || {};
            const np = s.now_playing;
            const playbackSettings = s.playback_settings || {};
            L.push(`\n**[${ch.toUpperCase()}]** ${s.paused ? '⏸️' : (np ? '▶️' : '⏹️')}`);
            if (np) L.push(`  Đang phát: ${np.metadata?.title || np.id}`);
            L.push(`  Speed: ${Number(playbackSettings.speed || 1).toFixed(2)}x | Skip silence: ${playbackSettings.skip_silence ? 'ON' : 'OFF'}`);
            if (s.queue_length) L.push(`  Hàng chờ: ${s.queue_length} track(s)`);
          }
          await replyToInteraction(interaction, { content: L.join('\n'), title: 'Voice Status', tone: 'info', user: interaction.user, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-pause') {
          const ch = resolveChannel(chOpt);
          const ok = voiceAdapter.pause(gid, ch);
          await replyToInteraction(interaction, { content: ok ? `[${ch}] Đã tạm dừng.` : `[${ch}] Không thể tạm dừng.`, title: 'Voice Tools', tone: ok ? 'success' : 'warning', user: interaction.user, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-resume') {
          const ch = resolveChannel(chOpt);
          const ok = voiceAdapter.resume(gid, ch);
          await replyToInteraction(interaction, { content: ok ? `[${ch}] Đã tiếp tục.` : `[${ch}] Không thể tiếp tục.`, title: 'Voice Tools', tone: ok ? 'success' : 'warning', user: interaction.user, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-skip') {
          const ch = resolveChannel(chOpt);
          const r = voiceAdapter.skip(gid, ch);
          const title = r.skipped?.metadata?.title || r.skipped?.id || 'nothing';
          await replyToInteraction(interaction, { content: `[${ch}] Skip: **${title}** (${r.remaining} còn lại).`, title: 'Voice Tools', tone: 'info', user: interaction.user, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-stop') {
          if (chOpt === 'all') {
            const r = voiceAdapter.stopAll(gid);
            await replyToInteraction(interaction, { content: `Đã dừng tất cả. Music: ${r.music.cleared}, Speak: ${r.speak.cleared} cleared.`, title: 'Voice Tools', tone: 'success', user: interaction.user, ephemeral: true });
          } else {
            const ch = resolveChannel(chOpt);
            const r = voiceAdapter.stopChannel(gid, ch);
            await replyToInteraction(interaction, { content: `[${ch}] Đã dừng, xoá ${r.cleared} track.`, title: 'Voice Tools', tone: 'success', user: interaction.user, ephemeral: true });
          }
          return;
        }

        if (interaction.commandName === 'voice-speed') {
          const ch = resolveChannel(interaction.options.getString('channel', true));
          const speed = interaction.options.getNumber('speed', true);
          const applied = voiceAdapter.setChannelPlaybackSpeed(gid, ch, speed);
          await replyToInteraction(interaction, { content: `[${ch}] Playback speed set to **${applied.toFixed(2)}x**.`, title: 'Voice Tools', tone: 'success', user: interaction.user, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-skip-silence') {
          const ch = resolveChannel(interaction.options.getString('channel', true));
          const enabled = interaction.options.getBoolean('enabled', true);
          const applied = voiceAdapter.setChannelSkipSilence(gid, ch, enabled);
          await replyToInteraction(interaction, { content: `[${ch}] Skip silence: **${applied ? 'ON' : 'OFF'}**.`, title: 'Voice Tools', tone: 'success', user: interaction.user, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-speak') {
          const text = interaction.options.getString('text', true);
          await ctx.call('voice.speak_requested', { guild_id: gid, text });
          await replyToInteraction(interaction, { content: 'Đã nhận yêu cầu speak (TTS placeholder).', title: 'Voice Tools', tone: 'info', user: interaction.user, ephemeral: true });
        }
      });
    },
  };
};
