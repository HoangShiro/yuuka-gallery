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
        const result = voiceAdapter.enqueue(gid, ch, p.source, {
          inputType: p.inputType || p.input_type,
          metadata: { ...(p.metadata || {}), noDuck: Boolean(p.noDuck) },
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
        const cmds = ['join-voice','leave-voice','voice-status','voice-pause','voice-resume','voice-skip','voice-stop','voice-speak'];
        if (!cmds.includes(interaction.commandName)) return;
        if (!isPolicyEnabled(runtimeState, POLICY_APP)) {
          await replyToInteraction(interaction, { content: 'Voice commands đang bị tắt.', ephemeral: true }); return;
        }
        const gid = String(interaction.guildId || '');
        const memberVC = interaction.member?.voice?.channel || null;
        const chOpt = interaction.options?.getString('channel') || 'music';

        if (interaction.commandName === 'join-voice') {
          if (!memberVC) { await replyToInteraction(interaction, { content: 'Bạn chưa ở trong voice channel.', ephemeral: true }); return; }
          if (!isAllowedVC(runtimeState, String(memberVC.id||''))) { await replyToInteraction(interaction, { content: 'Channel không nằm trong allowlist.', ephemeral: true }); return; }
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
          }
          await ctx.call('voice.join_requested', { guild_id: gid, voice_channel_id: String(memberVC.id||''), voice_channel_name: safeChannelName(memberVC), member_count: Number(memberVC.members?.size||0) });
          await replyToInteraction(interaction, { content: `✅ Đã tham gia: **${safeChannelName(memberVC)}**`, ephemeral: true });
          ctx.publish('bot.command_executed', { command: 'join-voice', guild: safeGuildName(interaction.guild), author: safeUserTag(interaction.user) });
          return;
        }

        if (interaction.commandName === 'leave-voice') {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
          }
          await ctx.call('voice.leave_requested', { guild_id: gid });
          await replyToInteraction(interaction, { content: '✅ Đã rời voice channel.', ephemeral: true });
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
            L.push(`\n**[${ch.toUpperCase()}]** ${s.paused ? '⏸️' : (np ? '▶️' : '⏹️')}`);
            if (np) L.push(`  Đang phát: ${np.metadata?.title || np.id}`);
            if (s.queue_length) L.push(`  Hàng chờ: ${s.queue_length} track(s)`);
          }
          await replyToInteraction(interaction, { content: L.join('\n'), ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-pause') {
          const ch = resolveChannel(chOpt);
          const ok = voiceAdapter.pause(gid, ch);
          await replyToInteraction(interaction, { content: ok ? `⏸️ [${ch}] Đã tạm dừng.` : `⚠️ [${ch}] Không thể tạm dừng.`, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-resume') {
          const ch = resolveChannel(chOpt);
          const ok = voiceAdapter.resume(gid, ch);
          await replyToInteraction(interaction, { content: ok ? `▶️ [${ch}] Đã tiếp tục.` : `⚠️ [${ch}] Không thể tiếp tục.`, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-skip') {
          const ch = resolveChannel(chOpt);
          const r = voiceAdapter.skip(gid, ch);
          const title = r.skipped?.metadata?.title || r.skipped?.id || 'nothing';
          await replyToInteraction(interaction, { content: `⏭️ [${ch}] Skip: **${title}** (${r.remaining} còn lại).`, ephemeral: true });
          return;
        }

        if (interaction.commandName === 'voice-stop') {
          if (chOpt === 'all') {
            const r = voiceAdapter.stopAll(gid);
            await replyToInteraction(interaction, { content: `⏹️ Đã dừng tất cả. Music: ${r.music.cleared}, Speak: ${r.speak.cleared} cleared.`, ephemeral: true });
          } else {
            const ch = resolveChannel(chOpt);
            const r = voiceAdapter.stopChannel(gid, ch);
            await replyToInteraction(interaction, { content: `⏹️ [${ch}] Đã dừng, xoá ${r.cleared} track.`, ephemeral: true });
          }
          return;
        }

        if (interaction.commandName === 'voice-speak') {
          const text = interaction.options.getString('text', true);
          await ctx.call('voice.speak_requested', { guild_id: gid, text });
          await replyToInteraction(interaction, { content: '🔊 Đã nhận yêu cầu speak (TTS placeholder).', ephemeral: true });
        }
      });
    },
  };
};
