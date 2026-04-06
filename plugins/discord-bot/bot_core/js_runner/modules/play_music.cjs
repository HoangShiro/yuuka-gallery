const { SlashCommandBuilder } = require('discord.js');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const {
  addCommandDefinition, isPolicyEnabled,
  registerPolicyDefinition, resolvePolicySetting
} = require('../runtime_state.cjs');
const { safeGuildName, safeUserTag } = require('../discord_utils.cjs');
const path = require('path');
const { checkYtDlp, MusicCache, resolveTrack, resolvePlaylist, getAudioStream } = require('../music_resolver.cjs');

const POLICY_APP = 'core.play_music.app_commands';
const POLICY_CACHE = 'core.play_music.cache';

module.exports = function createPlayMusicModule(deps) {
  const { runtimeConfig, runtimeState, logger } = deps;
  let musicCache = null;
  let ytDlpAvailable = false;

  return {
    module_id: 'core.play-music',
    name: 'Play Music',

    async onReady() {
      ytDlpAvailable = await checkYtDlp();
      if (!ytDlpAvailable) {
        logger?.log('warning', '[PlayMusic] yt-dlp binary not found in PATH! Play commands will fail.');
      } else {
        logger?.log('info', '[PlayMusic] yt-dlp initialized successfully.');
      }
    },

    setup(ctx) {
      // The cache directory is in the bot's runtime cache_dir
      const baseCacheDir = runtimeConfig.cache_dir || path.join(process.cwd(), 'data_cache', 'discord-bot', 'default');
      const musicCacheDir = path.join(baseCacheDir, 'music_cache');
      
      // We will init MusicCache later with configured max size
      function getMusicCache() {
        if (!musicCache) {
          const maxGb = Number(resolvePolicySetting(runtimeState, POLICY_CACHE, 'max_size_gb', 1));
          musicCache = new MusicCache(musicCacheDir, (maxGb || 1) * 1024 * 1024 * 1024);
        }
        return musicCache;
      }

      ctx.registerBrainInstruction('Use the music tools when the user asks to search for or play a song, query the music queue, or check what is currently playing. Example: "Play some lofi chill music".');
      
      ctx.registerBrainTool({
        tool_id: 'music_play',
        title: 'Play or search music',
        description: 'Đưa một bài hát từ text/url vào hàng đợi. Nếu không phải URL, nó sẽ ưu tiên youtube music hoặc youtube.',
        call_event: 'music.play_requested',
        input_schema: {
          guild_id: 'string',
          query: 'string'
        },
      });

      ctx.registerBrainTool({
        tool_id: 'music_queue',
        title: 'View music queue',
        description: 'Xem danh sách các bài hát trong hàng chờ.',
        call_event: 'music.queue_requested',
        input_schema: {
          guild_id: 'string'
        },
      });

      ctx.registerBrainTool({
        tool_id: 'music_now_playing',
        title: 'View currently playing track',
        description: 'Xem bài hát nào đang được phát.',
        call_event: 'music.now_playing_requested',
        input_schema: {
          guild_id: 'string'
        },
      });

      // -- Policies --
      registerPolicyDefinition(runtimeState, 'core.play-music', {
        policy_id: POLICY_APP, group_id: 'music', group_name: 'Music Player',
        title: 'Music commands',
        description: 'Allow /play, /play-search, /play-queue etc.',
        default_enabled: true,
      });

      registerPolicyDefinition(runtimeState, 'core.play-music', {
        policy_id: POLICY_CACHE, group_id: 'music', group_name: 'Music Player',
        title: 'Music cache settings',
        description: 'Configure local storage cache for downloaded music.',
        default_enabled: true,
        settings: { max_size_gb: 1 },
      });

      // -- Slash commands --
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from YouTube/SoundCloud/etc. using text or URL')
        .addStringOption(o => o.setName('query').setDescription('Title or URL to play').setRequired(true))
      );
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('play-search')
        .setDescription('Search for a song and list top 5 results')
        .addStringOption(o => o.setName('query').setDescription('Keywords to search').setRequired(true))
      );
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('play-queue').setDescription('Show the current music queue'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('play-now').setDescription('Show what is currently playing'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('play-cache').setDescription('Show music cache statistics'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder().setName('play-cache-clear').setDescription('Clear the downloaded music cache'));

      // =====================================================================
      // EVENT BUS ENDPOINTS
      // =====================================================================
      ctx.subscribe('music.play_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        if (!ytDlpAvailable) throw new Error('yt-dlp is not available. System cannot download music.');

        const query = String(p.query || '').trim();
        if (!query) throw new Error('Query required');

        const requesterId = p.requester_id || 'llm';
        const requesterName = p.requester_name || 'LLM';

        // Check if it's a playlist
        if (query.includes('playlist?list=') || query.includes('&list=')) {
          const tracks = await resolvePlaylist(query, 50);
          if (!tracks || tracks.length === 0) throw new Error('No tracks found in playlist.');
          
          let enqueued = 0;
          for (const track of tracks) {
            try {
              const audioPath = await getAudioStream(track, getMusicCache());
              await ctx.call('voice.play_requested', {
                guild_id: gid,
                channel: 'music',
                source: audioPath,
                input_type: 'wav', // opus outputs from yt-dlp can be streamed standard pipe to ffmpeg
                metadata: {
                  title: track.title,
                  duration: track.duration_sec,
                  thumbnail: track.thumbnail,
                  requester: requesterName,
                  track_id: track.id
                }
              });
              enqueued++;
            } catch (err) {
              logger?.log('warning', `[PlayMusic] Failed to enqueue track ${track.title}: ${err.message}`);
            }
          }
          return { status: `Enqueued ${enqueued} tracks from playlist.` };
        } else {
          const results = await resolveTrack(query, false, 1);
          if (!results || results.length === 0) throw new Error('No results found for query.');
          
          const track = results[0];
          const audioPath = await getAudioStream(track, getMusicCache());
          
          await ctx.call('voice.play_requested', {
            guild_id: gid,
            channel: 'music',
            source: audioPath,
            input_type: 'wav',
            metadata: {
              title: track.title,
              duration: track.duration_sec,
              thumbnail: track.thumbnail,
              requester: requesterName,
              track_id: track.id
            }
          });
          
          ctx.publish('context.event_fact', {
            scope: 'music', event_name: 'music.play_enqueued', guild_id: gid,
            value: `Enqueued: ${track.title} (${track.platform})`,
            ttl_sec: 120
          });

          return { track };
        }
      });

      ctx.subscribe('music.search_requested', async (p) => {
        const query = String(p?.query || '').trim();
        if (!query) throw new Error('Query required');
        const limit = p.limit || 5;
        const results = await resolveTrack(query, true, limit);
        return { results };
      });

      ctx.subscribe('music.queue_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        const statusList = await ctx.call('voice.status_requested', { guild_id: gid });
        if (!statusList || statusList.length === 0) return { queue: [] };
        const status = statusList[0];
        return { queue: status?.music?.queue || [] };
      });

      ctx.subscribe('music.now_playing_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        const statusList = await ctx.call('voice.status_requested', { guild_id: gid });
        if (!statusList || statusList.length === 0) return { now_playing: null };
        const status = statusList[0];
        return { now_playing: status?.music?.now_playing || null };
      });
      
      function formatDuration(sec) {
        if (!sec) return 'LIVE/Unknown';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
      }

      // =====================================================================
      // SLASH COMMAND HANDLER
      // =====================================================================
      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction?.isChatInputCommand()) return;
        const cmds = ['play', 'play-search', 'play-queue', 'play-now', 'play-cache', 'play-cache-clear'];
        if (!cmds.includes(interaction.commandName)) return;
        
        if (!isPolicyEnabled(runtimeState, POLICY_APP)) {
          await replyToInteraction(interaction, { content: 'Music commands are disabled by policy.', ephemeral: true });
          return;
        }

        const gid = String(interaction.guildId || '');
        
        if (['play', 'play-search'].includes(interaction.commandName)) {
          if (!ytDlpAvailable) {
            await replyToInteraction(interaction, { content: '❌ System error: yt-dlp binary not found. Cannot search or download music.', ephemeral: true });
            return;
          }
        }

        try {
          if (interaction.commandName === 'play') {
            await interaction.deferReply();
            const query = interaction.options.getString('query', true);
            
            try {
              const resList = await ctx.call('music.play_requested', {
                guild_id: gid,
                query: query,
                requester_id: interaction.user.id,
                requester_name: safeUserTag(interaction.user)
              });
              
              const res = resList[0];
              if (res && res.status) {
                 await interaction.editReply(`🎵 ${res.status}`);
              } else if (res && res.track) {
                 const t = res.track;
                 await interaction.editReply(`🎵 **Đã thêm vào hàng đợi:** [${t.title}](<${t.source_url}>)\n⏱️ Lượng: ${formatDuration(t.duration_sec)} | 👤 Bởi: ${safeUserTag(interaction.user)}`);
              }
            } catch (err) {
              await interaction.editReply(`❌ Lỗi: ${err.message}`);
            }
            ctx.publish('bot.command_executed', { command: 'play', guild: safeGuildName(interaction.guild), author: safeUserTag(interaction.user) });
            return;
          }

          if (interaction.commandName === 'play-search') {
            await interaction.deferReply();
            const query = interaction.options.getString('query', true);
            const resList = await ctx.call('music.search_requested', { query: query, limit: 5 });
            const results = (resList[0] || {}).results || [];
            
            if (results.length === 0) {
              await interaction.editReply('❌ Không tìm thấy kết quả.');
              return;
            }
            
            const lines = results.map((t, i) => `${i + 1}. **${t.title}** (${formatDuration(t.duration_sec)}) - [Link](<${t.source_url}>)`);
            await interaction.editReply(`🔎 **Kết quả tìm kiếm cho:** \`${query}\`\n\n${lines.join('\n')}\n*Dùng \`/play <link>\` để phát.*`);
            ctx.publish('bot.command_executed', { command: 'play-search', guild: safeGuildName(interaction.guild), author: safeUserTag(interaction.user) });
            return;
          }

          if (interaction.commandName === 'play-queue') {
             const qs = await ctx.call('music.queue_requested', { guild_id: gid });
             const queue = (qs[0] || {}).queue || [];
             if (queue.length === 0) {
               await replyToInteraction(interaction, { content: '📭 Hàng đợi trống.', ephemeral: true });
               return;
             }
             
             const lines = queue.slice(0, 10).map((q, i) => `${i + 1}. ${q.metadata?.title || q.id} (${formatDuration(q.metadata?.duration)} - req: ${q.metadata?.requester})`);
             let extra = '';
             if (queue.length > 10) extra = `\n... và ${queue.length - 10} bài nữa.`;
             await replyToInteraction(interaction, { content: `**🎶 Hàng đợi**\n${lines.join('\n')}${extra}` });
             return;
          }

          if (interaction.commandName === 'play-now') {
             const npAll = await ctx.call('music.now_playing_requested', { guild_id: gid });
             const np = (npAll[0] || {}).now_playing;
             if (!np) {
               await replyToInteraction(interaction, { content: '⏹️ Không có bài nào đang phát.', ephemeral: true });
               return;
             }
             await replyToInteraction(interaction, { content: `▶️ **Đang phát:** ${np.metadata?.title || np.id}\n⏱️ Lượng: ${formatDuration(np.metadata?.duration)} | 👤 By: ${np.metadata?.requester || 'Unknown'}` });
             return;
          }

          if (interaction.commandName === 'play-cache') {
             const cache = getMusicCache();
             const stats = cache.getStats();
             const mb = (stats.total_size_bytes / (1024 * 1024)).toFixed(2);
             const maxGb = Number(resolvePolicySetting(runtimeState, POLICY_CACHE, 'max_size_gb', 1));
             await replyToInteraction(interaction, { content: `🗂️ **Music Cache Stats**\nSố lượng file: ${stats.total_files}\nDung lượng: ${mb} MB / ${maxGb * 1024} MB`, ephemeral: true });
             return;
          }

          if (interaction.commandName === 'play-cache-clear') {
             const cache = getMusicCache();
             cache.clear();
             await replyToInteraction(interaction, { content: '🗑️ Đã xóa toàn bộ music cache.', ephemeral: true });
             return;
          }
        } catch (err) {
          logger?.log('error', `[PlayMusic] Error in command ${interaction.commandName}: ${err.message}`);
          if (!interaction.replied && !interaction.deferred) {
            await replyToInteraction(interaction, { content: `❌ Đã xảy ra lỗi: ${err.message}`, ephemeral: true });
          } else {
            await interaction.editReply(`❌ Đã xảy ra lỗi: ${err.message}`).catch(()=>{});
          }
        }
      });

      ctx.subscribe('music.prefetch_requested', async (p) => {
        const url = String(p?.url || '').trim();
        if (!url || !ytDlpAvailable) return;
        try {
          // Resolve and download to cache in background
          const tracks = await resolveTrack(url);
          if (tracks && tracks.length > 0) {
            await getAudioStream(tracks[0], getMusicCache());
            logger?.log('info', `[PlayMusic] Prefetched background track: ${tracks[0].title}`);
          }
        } catch (err) {
          // Silently ignore prefetch failures as it's just an optimization
        }
      });
    },
  };
};
