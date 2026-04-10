const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const {
  addCommandDefinition, isPolicyEnabled,
  registerPolicyDefinition, resolvePolicySetting
} = require('../runtime_state.cjs');
const { safeGuildName, safeUserTag } = require('../discord_utils.cjs');
const { normalizePrimaryResult, formatMusicDuration } = require('../tool_reply_helpers.cjs');
const EmbedUI = require('../embed_ui.cjs');
const path = require('path');
const { checkYtDlp, MusicCache, resolveTrack, resolvePlaylist, getAudioStream } = require('../music_resolver.cjs');

const POLICY_APP = 'core.play_music.app_commands';
const POLICY_CACHE = 'core.play_music.cache';
const POLICY_YTDLP = 'core.play_music.ytdlp';
const FALLBACK_THUMBNAIL_URL = 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg';
const AUDIO_EXTENSIONS = new Set(['wav', 'wave', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm', 'mp4', 'mpeg']);

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Unknown';
  }
  if (!Number.isFinite(Number(maxLength)) || maxLength < 4 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function pickTrackAuthor(metadata = {}) {
  return truncateText(metadata.author || metadata.uploader || metadata.requester || 'Unknown', 48);
}

function pickUserAvatarUrl(user = null) {
  if (!user || typeof user.displayAvatarURL !== 'function') {
    return '';
  }
  try {
    return String(user.displayAvatarURL() || '').trim();
  } catch (_) {
    return '';
  }
}

function pickTrackThumbnail(metadata = {}, { requester = null, botUser = null } = {}) {
  const metadataThumbnail = String(metadata.thumbnail || '').trim();
  if (metadataThumbnail) {
    return metadataThumbnail;
  }
  const requesterAvatarFromMetadata = String(metadata.requester_avatar_url || '').trim();
  if (requesterAvatarFromMetadata) {
    return requesterAvatarFromMetadata;
  }
  const requesterAvatar = pickUserAvatarUrl(requester);
  if (requesterAvatar) {
    return requesterAvatar;
  }
  const botAvatar = pickUserAvatarUrl(botUser);
  if (botAvatar) {
    return botAvatar;
  }
  return FALLBACK_THUMBNAIL_URL;
}

function buildTrackLink(title, sourceUrl) {
  const safeTitle = truncateText(title || 'Unknown track', 128);
  const url = String(sourceUrl || '').trim();
  return url ? `[${safeTitle}](<${url}>)` : safeTitle;
}

function buildQueueLine(entry = {}, index = 0) {
  const metadata = entry?.metadata || {};
  const title = truncateText(metadata.title || entry.id || 'Unknown track', 56);
  const author = pickTrackAuthor(metadata);
  return `**${index + 1}.** ${truncateText(`${title} - ${author}`, 84)} • ${formatMusicDuration(metadata.duration)}`;
}

function buildMusicQueueEmbed(queue = [], user = null, botUser = null) {
  const safeQueue = Array.isArray(queue) ? queue : [];
  const top = safeQueue.slice(0, 8);
  const description = top.length
    ? top.map((item, i) => buildQueueLine(item, i)).join('\n')
    : 'Hàng đợi trống.';
  const remaining = Math.max(0, safeQueue.length - top.length);
  const embed = EmbedUI.createBase({ user })
    .setColor(EmbedUI.COLORS.MUSIC)
    .setTitle(`🎶 Music Queue • ${safeQueue.length} track(s)`)
    .setDescription(remaining > 0 ? `${description}\n\n... và **${remaining}** bài nữa.` : description)
    .setThumbnail(pickTrackThumbnail((safeQueue[0] || {}).metadata || {}, { requester: user, botUser }));
  return embed;
}

function buildMusicControlsUi(nowPlaying, queue = [], page = 0, isPaused = false) {
  const safeQueue = Array.isArray(queue) ? queue : [];
  const allTracks = [];
  if (nowPlaying) allTracks.push(nowPlaying);
  allTracks.push(...safeQueue);

  const PAGE_SIZE = 23;
  const totalPages = Math.ceil(allTracks.length / PAGE_SIZE) || 1;
  const validPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = validPage * PAGE_SIZE;
  const pageTracks = allTracks.slice(startIndex, startIndex + PAGE_SIZE);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`play_music_select_page_${validPage}`)
    .setPlaceholder('Chọn bài hát để phát...');

  if (pageTracks.length === 0) {
    selectMenu.addOptions(new StringSelectMenuOptionBuilder().setLabel('Không có bài hát').setValue('none').setDescription('Hàng chờ trống.'));
    selectMenu.setDisabled(true);
  } else {
    const options = [];
    if (validPage > 0) {
      options.push(new StringSelectMenuOptionBuilder()
        .setLabel('Previous page')
        .setEmoji('⬅️')
        .setValue(`page_${validPage - 1}`)
      );
    }
    
    pageTracks.forEach((track) => {
      const isNowPlaying = (nowPlaying && track.id === nowPlaying.id);
      const icon = isNowPlaying ? '💠' : '🔸';
      
      const trackMeta = track.metadata || {};
      const title = truncateText(trackMeta.title || track.id || 'Unknown', 90);
      options.push(new StringSelectMenuOptionBuilder()
        .setLabel(title)
        .setDescription(truncateText(trackMeta.author || 'Unknown', 40))
        .setEmoji(icon)
        .setValue(`jump_${track.id}`)
      );
    });

    if (validPage < totalPages - 1) {
      options.push(new StringSelectMenuOptionBuilder()
        .setLabel('Next page')
        .setEmoji('➡️')
        .setValue(`page_${validPage + 1}`)
      );
    }
    
    selectMenu.addOptions(options);
  }

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  const toggleBtn = new ButtonBuilder()
    .setCustomId('play_music_btn_toggle')
    .setEmoji(isPaused ? '▶️' : '⏸️')
    .setStyle(ButtonStyle.Success);

  const prevBtn = new ButtonBuilder()
    .setCustomId('play_music_btn_prev')
    .setEmoji('⏮️')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId('play_music_btn_next')
    .setEmoji('⏭️')
    .setStyle(ButtonStyle.Secondary);
  if (allTracks.length === 0) nextBtn.setDisabled(true);

  const stopBtn = new ButtonBuilder()
    .setCustomId('play_music_btn_stop')
    .setEmoji('⏹️')
    .setStyle(ButtonStyle.Secondary);

  const loopBtn = new ButtonBuilder()
    .setCustomId('play_music_btn_loop')
    .setEmoji('🔂')
    .setStyle(ButtonStyle.Secondary);

  const btnRow = new ActionRowBuilder().addComponents(toggleBtn, prevBtn, nextBtn, stopBtn, loopBtn);

  return [selectRow, btnRow];
}

function buildMusicPlayerEmbed({ nowPlaying, queue = [], requester = null, botUser = null } = {}) {
  const metadata = nowPlaying?.metadata || {};
  const safeQueue = Array.isArray(queue) ? queue : [];
  const durationSec = Number(metadata.duration || 0);
  const trackTitle = truncateText(metadata.title || nowPlaying?.id || 'Unknown track', 128);
  const linkedTrackTitle = buildTrackLink(trackTitle, metadata.source_url);
  const author = pickTrackAuthor(metadata);
  const requestedByName = requester?.tag || requester?.username || metadata.requester || 'Unknown';
  const embed = new EmbedBuilder()
    .setColor(EmbedUI.COLORS.MUSIC)
    .setTitle(trackTitle)
    .setDescription(`🎵 ${linkedTrackTitle}\n👤 ${author} • ⏱️ ${formatMusicDuration(durationSec)}`)
    .setThumbnail(pickTrackThumbnail(metadata, { requester, botUser }));
  const footer = {
    text: `Requested by ${requestedByName}`,
  };
  if (requester && typeof requester.displayAvatarURL === 'function') {
    footer.iconURL = requester.displayAvatarURL();
  }
  embed.setFooter(footer);

  const nextTracks = safeQueue.slice(0, 3);
  if (nextTracks.length > 0) {
    const lines = nextTracks.map((item, i) => {
      const nextMeta = item?.metadata || {};
      const nextTitle = truncateText(nextMeta.title || item?.id || 'Unknown track', 54);
      const linkedNextTitle = buildTrackLink(nextTitle, nextMeta.source_url);
      const nextAuthor = pickTrackAuthor(nextMeta);
      return `${i + 1}. ${linkedNextTitle}\n👤 ${nextAuthor} • ⏱️ ${formatMusicDuration(nextMeta.duration)}`;
    });
    embed.addFields({
      name: 'Next:',
      value: lines.join('\n\n'),
      inline: false,
    });
  }

  const extra = safeQueue.length - nextTracks.length;
  if (extra > 0) {
    embed.addFields({
      name: 'Queue',
      value: `... và **${extra}** bài nữa trong hàng chờ.`,
      inline: false,
    });
  }

  return embed;
}

function getExtensionFromValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  const sanitized = raw.split('?')[0].split('#')[0];
  const dotIndex = sanitized.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex >= sanitized.length - 1) {
    return '';
  }
  return sanitized.slice(dotIndex + 1);
}

function normalizeAudioInputType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  if (raw === 'wave' || raw === 'x-wav' || raw === 'vnd.wave') return 'wav';
  if (raw === 'mpeg' || raw === 'x-mp3') return 'mp3';
  if (raw === 'oga') return 'ogg';
  return raw;
}

function inferAudioInputType({ fileName = '', contentType = '', sourceUrl = '' } = {}) {
  const rawMime = String(contentType || '').trim().toLowerCase();
  if (rawMime) {
    const mimeWithoutParams = rawMime.split(';')[0];
    if (mimeWithoutParams.startsWith('audio/')) {
      return normalizeAudioInputType(mimeWithoutParams.slice('audio/'.length));
    }
    if (mimeWithoutParams === 'application/ogg') {
      return 'ogg';
    }
  }
  const ext = normalizeAudioInputType(getExtensionFromValue(fileName) || getExtensionFromValue(sourceUrl));
  return ext;
}

function isDirectAudioSource({ fileName = '', contentType = '', sourceUrl = '' } = {}) {
  const normalizedType = inferAudioInputType({ fileName, contentType, sourceUrl });
  if (normalizedType && AUDIO_EXTENSIONS.has(normalizedType)) {
    return true;
  }
  const rawMime = String(contentType || '').trim().toLowerCase();
  return rawMime.startsWith('audio/');
}

module.exports = function createPlayMusicModule(deps) {
  const { runtimeConfig, runtimeState, logger, client } = deps;
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

      function getYtDlpOptions() {
        return {
          sponsorblock_enabled: Boolean(resolvePolicySetting(runtimeState, POLICY_YTDLP, 'sponsorblock_enabled', true)),
          sponsorblock_categories: String(resolvePolicySetting(runtimeState, POLICY_YTDLP, 'sponsorblock_categories', 'sponsor,selfpromo,intro,outro,interaction') || ''),
          cookies_file: String(resolvePolicySetting(runtimeState, POLICY_YTDLP, 'cookies_file', '') || ''),
          cookies_from_browser: String(resolvePolicySetting(runtimeState, POLICY_YTDLP, 'cookies_from_browser', '') || ''),
        };
      }

      async function resolveTextChannel(payload = {}, guildId = '') {
        const directChannel = payload?.channel;
        if (directChannel && typeof directChannel.send === 'function') {
          return directChannel;
        }
        const textChannelId = String(payload?.channel_id || '').trim();
        if (!textChannelId || !client) {
          return null;
        }
        const cached = client.channels?.cache?.get(textChannelId);
        if (cached && typeof cached.send === 'function') {
          return cached;
        }
        if (typeof client.channels?.fetch === 'function') {
          try {
            const fetched = await client.channels.fetch(textChannelId);
            if (fetched && typeof fetched.send === 'function') {
              return fetched;
            }
          } catch (_) {}
        }
        const guild = client.guilds?.cache?.get(String(guildId || ''));
        const systemChannel = guild?.systemChannel;
        if (systemChannel && typeof systemChannel.send === 'function') {
          return systemChannel;
        }
        return null;
      }

      async function enqueueDirectAudioSource(payload = {}) {
        const gid = String(payload?.guild_id || '').trim();
        if (!gid) {
          throw new Error('guild_id required');
        }
        const sourceUrl = String(payload?.audio_source_url || payload?.source_url || payload?.query || '').trim();
        if (!sourceUrl) {
          throw new Error('audio source URL required');
        }
        const textChannel = await resolveTextChannel(payload, gid);
        const textChannelId = String(textChannel?.id || payload?.channel_id || '').trim();
        const requesterName = String(payload?.requester_name || 'LLM').trim() || 'LLM';
        const requesterAvatarUrl = String(payload?.requester_avatar_url || '').trim();
        const attachmentName = String(payload?.attachment_name || '').trim();
        const attachmentContentType = String(payload?.attachment_content_type || '').trim();
        const inferredType = inferAudioInputType({
          fileName: attachmentName,
          contentType: attachmentContentType,
          sourceUrl,
        });

        const statusBeforeList = await ctx.call('voice.status_requested', { guild_id: gid });
        const statusBefore = Array.isArray(statusBeforeList) ? statusBeforeList[0] : null;
        const wasIdle = !statusBefore?.music?.now_playing;

        const title = attachmentName || 'Uploaded audio file';
        await ctx.call('voice.play_requested', {
          guild_id: gid,
          channel: 'music',
          source: sourceUrl,
          input_type: inferredType || undefined,
          metadata: {
            title,
            duration: 0,
            thumbnail: '',
            author: requesterName,
            source_url: sourceUrl,
            requester: requesterName,
            requester_avatar_url: requesterAvatarUrl,
            text_channel_id: textChannelId,
            suppress_auto_player_embed: Boolean(wasIdle),
            track_id: `attachment:${title}`,
            content_type: attachmentContentType,
            original_file_name: attachmentName,
          }
        });

        const statusAfterList = await ctx.call('voice.status_requested', { guild_id: gid });
        const statusAfter = Array.isArray(statusAfterList) ? statusAfterList[0] : null;
        return {
          track: {
            id: `attachment:${title}`,
            title,
            duration_sec: 0,
            thumbnail: '',
            uploader: requesterName,
            source_url: sourceUrl,
            platform: attachmentContentType || inferredType || 'discord_attachment',
          },
          was_idle: wasIdle,
          now_playing: statusAfter?.music?.now_playing || null,
          queue: statusAfter?.music?.queue || [],
          paused: statusAfter?.music?.paused || false,
          requested_at_unix: Math.floor(Date.now() / 1000),
        };
      }

      ctx.registerBrainInstruction('Use the music tools when the user asks to search for or play a song, queue an uploaded audio attachment, query the music queue, or check what is currently playing. Example: "Play some lofi chill music" or "Play the uploaded mp3 file".');
      
      ctx.registerBrainTool({
        tool_id: 'music_play',
        title: 'Play or search music',
        description: 'Đưa một bài hát từ text/url vào hàng đợi. Dùng `query` cho link YouTube/YouTube Music hoặc text tìm kiếm. Chỉ dùng `audio_source_url` cho file audio trực tiếp hay attachment.',
        call_event: 'music.play_requested',
        input_schema: {
          guild_id: 'string',
          query: 'string?',
          audio_source_url: 'string?',
          attachment_name: 'string?',
          attachment_content_type: 'string?'
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

      ctx.registerToolReplyFormatter({
        tool_id: 'music_play',
        build_payload({ call_results, actor }) {
          const normalized = normalizePrimaryResult(call_results);
          if (normalized?.embeds) {
            return {
              embeds: normalized.embeds,
              user: actor,
            };
          }
          if (normalized?.status) {
            return {
              content: String(normalized.status),
              title: 'Music Queue',
              tone: 'success',
              user: actor,
            };
          }
          if (normalized?.track) {
            const track = normalized.track || {};
            const wasIdle = Boolean(normalized.was_idle);
            const nowPlaying = normalized.now_playing || null;
            const queue = Array.isArray(normalized.queue) ? normalized.queue : [];
            if (wasIdle && nowPlaying) {
              return {
                embeds: [buildMusicPlayerEmbed({
                  nowPlaying,
                  queue,
                  requester: actor,
                  botUser: client?.user || null,
                })],
                components: buildMusicControlsUi(nowPlaying, queue, 0, Boolean(normalized.paused)),
                user: actor,
              };
            }
            const trackTitle = truncateText(track.title || 'Unknown track', 72);
            const author = truncateText(track.uploader || 'Unknown', 40);
            const linkedTitle = String(track.source_url || '').trim()
              ? `[${trackTitle}](<${track.source_url}>)`
              : `**${trackTitle}**`;
            return {
              embeds: [
                EmbedUI.createBase({ user: actor })
                  .setColor(EmbedUI.COLORS.SUCCESS)
                  .setTitle('✅ Added to Queue')
                  .setDescription(`🎵 ${linkedTitle}\n👤 ${author} • ⏱️ ${formatMusicDuration(track.duration_sec)}`)
                  .setThumbnail(pickTrackThumbnail(track, { requester: actor, botUser: client?.user || null })),
              ],
              user: actor,
            };
          }
          return {
            content: 'Đã xử lý yêu cầu phát nhạc.',
            title: 'Music Queue',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'music_queue',
        build_payload({ call_results, actor }) {
          const normalized = normalizePrimaryResult(call_results);
          const queue = Array.isArray(normalized?.queue) ? normalized.queue : [];
          if (!queue.length) {
            return {
              content: 'Hàng đợi trống.',
              title: 'Music Queue',
              tone: 'warning',
              user: actor,
            };
          }
          return {
            embeds: [buildMusicQueueEmbed(queue, actor, client?.user || null)],
            components: buildMusicControlsUi(normalized.now_playing, queue, 0, Boolean(normalized.paused)),
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'music_now_playing',
        build_payload({ call_results, actor }) {
          const normalized = normalizePrimaryResult(call_results);
          const nowPlaying = normalized?.now_playing || null;
          const queue = Array.isArray(normalized?.queue) ? normalized.queue : [];
          if (!nowPlaying) {
            return {
              content: 'Không có bài nào đang phát.',
              title: 'Now Playing',
              tone: 'warning',
              user: actor,
            };
          }
          return {
            embeds: [buildMusicPlayerEmbed({
              nowPlaying,
              queue,
              requester: actor,
              botUser: client?.user || null,
            })],
            components: buildMusicControlsUi(nowPlaying, queue, 0, Boolean(normalized.paused)),
            user: actor,
          };
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

      registerPolicyDefinition(runtimeState, 'core.play-music', {
        policy_id: POLICY_YTDLP, group_id: 'music', group_name: 'Music Player',
        title: 'yt-dlp settings',
        description: 'Configure yt-dlp options like SponsorBlock and cookies for age-restricted content.',
        default_enabled: true,
        settings: {
          sponsorblock_enabled: true,
          sponsorblock_categories: 'sponsor,selfpromo,intro,outro,interaction',
          cookies_file: '',
          cookies_from_browser: '',
        },
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
        const directAudioUrl = String(p?.audio_source_url || p?.source_url || '').trim();
        let query = String(p?.query || '').trim();
        if (directAudioUrl) {
          const isDirectAudio = isDirectAudioSource({
            fileName: p?.attachment_name,
            contentType: p?.attachment_content_type,
            sourceUrl: directAudioUrl,
          });
          if (isDirectAudio) {
            return enqueueDirectAudioSource({
              ...p,
              guild_id: gid,
              audio_source_url: directAudioUrl,
            });
          }
          query = query || directAudioUrl;
        }
        if (!query) throw new Error('Query required');
        if (!ytDlpAvailable) throw new Error('yt-dlp is not available. System cannot download music.');

        const requesterName = p.requester_name || 'LLM';
        const requesterAvatarUrl = String(p?.requester_avatar_url || '').trim();
        const textChannel = await resolveTextChannel(p, gid);
        const textChannelId = String(textChannel?.id || p?.channel_id || '').trim();
        const ytDlpOptions = getYtDlpOptions();

        // Check if it's a playlist
        if (query.includes('playlist?list=') || query.includes('&list=')) {
          const statusBeforeList = await ctx.call('voice.status_requested', { guild_id: gid });
          const statusBefore = Array.isArray(statusBeforeList) ? statusBeforeList[0] : null;
          const wasIdleBeforePlaylist = !statusBefore?.music?.now_playing;
          const tracks = await resolvePlaylist(query, 50, ytDlpOptions);
          if (!tracks || tracks.length === 0) throw new Error('No tracks found in playlist.');
          
          const embed = EmbedUI.createBase({ user: { tag: requesterName, username: requesterName, displayAvatarURL: () => requesterAvatarUrl || null } })
            .setColor(EmbedUI.COLORS.MUSIC)
            .setTitle('⏳ Loading Playlist')
            .setDescription(`Hệ thống đang tải **${tracks.length}** bài hát từ playlist vào hàng chờ...`);
          
          if (tracks[0] && tracks[0].thumbnail) {
            embed.setThumbnail(tracks[0].thumbnail);
          }

          (async () => {
            let enqueued = 0;
            let firstTrack = true;
            for (const track of tracks) {
              try {
                const audioPath = await getAudioStream(track, getMusicCache(), ytDlpOptions);
                await ctx.call('voice.play_requested', {
                  guild_id: gid,
                  channel: 'music',
                  source: audioPath,
                  input_type: inferAudioInputType({ fileName: audioPath, sourceUrl: audioPath }) || 'opus',
                  metadata: {
                    title: track.title,
                    duration: track.duration_sec,
                    thumbnail: track.thumbnail,
                    author: track.uploader,
                    source_url: track.source_url,
                    requester: requesterName,
                    requester_avatar_url: requesterAvatarUrl,
                    text_channel_id: textChannelId,
                    suppress_auto_player_embed: false, // Never suppress for playlist tracks now since early return doesn't contain Now Playing embed
                    track_id: track.id
                  }
                });
                enqueued++;
                firstTrack = false;
              } catch (err) {
                logger?.log('warning', `[PlayMusic] Failed to enqueue track ${track.title}: ${err.message}`);
              }
            }
          })();

          return { embeds: [embed] };
        } else {
          const statusBeforeList = await ctx.call('voice.status_requested', { guild_id: gid });
          const statusBefore = Array.isArray(statusBeforeList) ? statusBeforeList[0] : null;
          const wasIdle = !statusBefore?.music?.now_playing;
          const results = await resolveTrack(query, false, 1, ytDlpOptions);
          if (!results || results.length === 0) throw new Error('No results found for query.');
          
          const track = results[0];
          const audioPath = await getAudioStream(track, getMusicCache(), ytDlpOptions);
          
          await ctx.call('voice.play_requested', {
            guild_id: gid,
            channel: 'music',
            source: audioPath,
            input_type: inferAudioInputType({ fileName: audioPath, sourceUrl: audioPath }) || 'opus',
            metadata: {
              title: track.title,
              duration: track.duration_sec,
              thumbnail: track.thumbnail,
              author: track.uploader,
              source_url: track.source_url,
              requester: requesterName,
              requester_avatar_url: requesterAvatarUrl,
              text_channel_id: textChannelId,
              suppress_auto_player_embed: Boolean(wasIdle),
              track_id: track.id
            }
          });

          const statusAfterList = await ctx.call('voice.status_requested', { guild_id: gid });
          const statusAfter = Array.isArray(statusAfterList) ? statusAfterList[0] : null;
          
          ctx.publish('context.event_fact', {
            scope: 'music', event_name: 'music.play_enqueued', guild_id: gid,
            value: `Enqueued: ${track.title} (${track.platform})`,
            ttl_sec: 120
          });

          return {
            track,
            was_idle: wasIdle,
            now_playing: statusAfter?.music?.now_playing || null,
            queue: statusAfter?.music?.queue || [],
            paused: statusAfter?.music?.paused || false,
            requested_at_unix: Math.floor(Date.now() / 1000),
          };
        }
      });

      ctx.subscribe('music.search_requested', async (p) => {
        const query = String(p?.query || '').trim();
        if (!query) throw new Error('Query required');
        const limit = p.limit || 5;
        const results = await resolveTrack(query, true, limit, getYtDlpOptions());
        return { results };
      });

      ctx.subscribe('music.resolve_requested', async (p) => {
        const query = String(p?.query || '').trim();
        if (!query) throw new Error('Query required');
        const results = await resolveTrack(query, false, 1, getYtDlpOptions());
        return { track: (results && results[0]) ? results[0] : null };
      });

      ctx.subscribe('music.queue_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        const statusList = await ctx.call('voice.status_requested', { guild_id: gid });
        if (!statusList || statusList.length === 0) return { queue: [] };
        const status = statusList[0];
        return { 
          queue: status?.music?.queue || [],
          now_playing: status?.music?.now_playing || null,
          paused: status?.music?.paused || false
        };
      });

      ctx.subscribe('music.now_playing_requested', async (p) => {
        const gid = String(p?.guild_id || '');
        if (!gid) throw new Error('guild_id required');
        const statusList = await ctx.call('voice.status_requested', { guild_id: gid });
        if (!statusList || statusList.length === 0) return { now_playing: null, queue: [] };
        const status = statusList[0];
        return {
          now_playing: status?.music?.now_playing || null,
          queue: status?.music?.queue || [],
          paused: status?.music?.paused || false,
        };
      });

      ctx.subscribe('voice.track_start', async (payload) => {
        if (String(payload?.channel || '') !== 'music') {
          return;
        }
        const gid = String(payload?.guild_id || '');
        if (!gid) {
          return;
        }
        const nowPlaying = payload?.item || null;
        if (!nowPlaying) {
          return;
        }
        const metadata = nowPlaying?.metadata || {};
        if (metadata?.suppress_auto_player_embed) {
          return;
        }
        const textChannelId = String(metadata?.text_channel_id || '').trim();
        if (!textChannelId) {
          return;
        }
        const textChannel = await resolveTextChannel({ channel_id: textChannelId }, gid);
        if (!textChannel) {
          return;
        }
        const statusList = await ctx.call('voice.status_requested', { guild_id: gid });
        const status = Array.isArray(statusList) ? statusList[0] : null;
        const queue = status?.music?.queue || [];
        await ctx.call('message.send_requested', {
          channel: textChannel,
          embeds: [buildMusicPlayerEmbed({
            nowPlaying,
            queue,
            requester: null,
            botUser: client?.user || null,
          })],
          components: buildMusicControlsUi(nowPlaying, queue, 0, Boolean(status?.music?.paused)),
        });
      });
      
      function formatDuration(sec) {
        if (!sec) return 'LIVE/Unknown';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
      }

      // =====================================================================
      // SLASH COMMAND HANDLER
      // =====================================================================
      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction) return;
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
          const cid = String(interaction.customId || '');
          if (!cid.startsWith('play_music_')) return;
          
          if (!isPolicyEnabled(runtimeState, POLICY_APP)) {
             await replyToInteraction(interaction, { content: 'Music commands are disabled by policy.', ephemeral: true });
             return;
          }
          const gid = String(interaction.guildId || '');
          try {
             let newPage = null;

             if (interaction.isStringSelectMenu()) {
                const val = interaction.values[0] || '';
                if (val.startsWith('page_')) {
                   newPage = parseInt(val.split('_')[1], 10);
                } else if (val.startsWith('jump_')) {
                   const targetId = val.substring(5);
                   const qs = await ctx.call('voice.status_requested', { guild_id: gid });
                   const status = qs[0]?.music || {};
                   const queue = status.queue || [];
                   const np = status.now_playing;
                   if (np?.id !== targetId) {
                       const targetIdx = queue.findIndex(q => q.id === targetId);
                       if (targetIdx !== -1) {
                           for (let i = 0; i < targetIdx; i++) {
                              await ctx.call('voice.remove_requested', { guild_id: gid, channel: 'music', item_id: queue[i].id });
                           }
                           await ctx.call('voice.skip_requested', { guild_id: gid, channel: 'music' });
                       }
                   }
                }
             } else if (interaction.isButton()) {
                if (cid === 'play_music_btn_toggle') {
                   const qs = await ctx.call('voice.status_requested', { guild_id: gid });
                   const isPaused = Boolean(qs[0]?.music?.paused);
                   if (isPaused) await ctx.call('voice.resume_requested', { guild_id: gid, channel: 'music' });
                   else await ctx.call('voice.pause_requested', { guild_id: gid, channel: 'music' });
                } else if (cid === 'play_music_btn_prev') {
                   await replyToInteraction(interaction, { content: 'Tính năng Previous hiện chưa được thiết kế trên hệ thống.', ephemeral: true });
                   return;
                } else if (cid === 'play_music_btn_next') {
                   await ctx.call('voice.skip_requested', { guild_id: gid, channel: 'music' });
                } else if (cid === 'play_music_btn_stop') {
                   await ctx.call('voice.stop_requested', { guild_id: gid, channel: 'music' });
                } else if (cid === 'play_music_btn_loop') {
                   await replyToInteraction(interaction, { content: 'Tính năng Loop đang phát triển.', ephemeral: true });
                   return;
                }
             }

             // Render UI again
             const freshQs = await ctx.call('voice.status_requested', { guild_id: gid });
             const fStatus = freshQs[0]?.music || {};
             const fQueue = fStatus.queue || [];
             const fNp = fStatus.now_playing || null;
             const fPaused = Boolean(fStatus.paused);
             
             let currentPage = newPage;
             if (currentPage === null) {
                 const m = cid.match(/page_(\d+)/);
                 if (m) currentPage = parseInt(m[1], 10);
                 else currentPage = 0;
             }
             
             const components = buildMusicControlsUi(fNp, fQueue, currentPage, fPaused);
             const embedTitle = String(interaction.message?.embeds?.[0]?.title || '');
             let newEmbeds = [];
             if (embedTitle.includes('Music Queue')) {
                 newEmbeds = [buildMusicQueueEmbed(fQueue, interaction.user, client?.user || null)];
             } else {
                 newEmbeds = [buildMusicPlayerEmbed({
                     nowPlaying: fNp,
                     queue: fQueue,
                     requester: interaction.user, // best effort requester update? (doesn't matter)
                     botUser: client?.user || null,
                 })];
             }
             
             if (typeof interaction.update === 'function') {
                 await interaction.update({ embeds: newEmbeds, components });
             } else {
                 await replyToInteraction(interaction, { content: 'Đã hoàn tất', ephemeral: true });
             }
          } catch(err) {
             logger?.log('error', `[PlayMusic] Component error: ${err.message}`);
          }
          return;
        }

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
                channel: interaction.channel,
                channel_id: String(interaction.channelId || interaction.channel?.id || ''),
                requester_id: interaction.user.id,
                requester_name: safeUserTag(interaction.user),
                requester_avatar_url: pickUserAvatarUrl(interaction.user),
              });
              
              const res = resList[0];
              if (res && res.embeds) {
                 await replyToInteraction(interaction, { embeds: res.embeds, user: interaction.user });
              } else if (res && res.status) {
                 await replyToInteraction(interaction, { content: res.status, tone: 'success', title: 'Music Queue', user: interaction.user });
              } else if (res && res.track) {
                 const t = res.track;
                 if (res.was_idle && res.now_playing) {
                   const safeQueue = Array.isArray(res.queue) ? res.queue : [];
                   await replyToInteraction(interaction, {
                     embeds: [buildMusicPlayerEmbed({
                       nowPlaying: res.now_playing,
                       queue: safeQueue,
                       requester: interaction.user,
                       botUser: client?.user || null,
                     })],
                     components: buildMusicControlsUi(res.now_playing, safeQueue, 0, Boolean(res.paused)),
                     user: interaction.user,
                   });
                 } else {
                   await replyToInteraction(interaction, {
                     embeds: [
                       EmbedUI.createBase({ user: interaction.user })
                         .setColor(EmbedUI.COLORS.SUCCESS)
                         .setTitle('✅ Added to Queue')
                         .setDescription(`🎵 [${truncateText(t.title, 72)}](<${t.source_url}>)\n👤 ${truncateText(t.uploader || 'Unknown', 40)} • ⏱️ ${formatDuration(t.duration_sec)}`)
                         .setThumbnail(pickTrackThumbnail(t, { requester: interaction.user, botUser: client?.user || null })),
                     ],
                     user: interaction.user,
                   });
                 }
              }
            } catch (err) {
              await replyToInteraction(interaction, { content: String(err?.message || err || 'Unknown error'), tone: 'error', title: 'Play Music', user: interaction.user });
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
              await replyToInteraction(interaction, { content: 'Không tìm thấy kết quả.', tone: 'error', title: 'Music Search', user: interaction.user });
              return;
            }
            
            const lines = results.map((t, i) => `${i + 1}. **${t.title}** (${formatDuration(t.duration_sec)}) - [Link](<${t.source_url}>)`);
            await replyToInteraction(interaction, {
              content: `Kết quả tìm kiếm cho: \`${query}\`\n\n${lines.join('\n')}\nChọn bằng \`/play <link>\` để phát.`,
              title: 'Search Results',
              tone: 'info',
              user: interaction.user,
            });
            ctx.publish('bot.command_executed', { command: 'play-search', guild: safeGuildName(interaction.guild), author: safeUserTag(interaction.user) });
            return;
          }

          if (interaction.commandName === 'play-queue') {
             const qs = await ctx.call('music.queue_requested', { guild_id: gid });
             const queue = (qs[0] || {}).queue || [];
             if (queue.length === 0) {
               await replyToInteraction(interaction, { content: 'Hàng đợi trống.', title: 'Music Queue', tone: 'warning', user: interaction.user, ephemeral: true });
               return;
             }
             await replyToInteraction(interaction, {
               embeds: [buildMusicQueueEmbed(queue, interaction.user, client?.user || null)],
               components: buildMusicControlsUi(qs[0]?.now_playing, queue, 0, Boolean(qs[0]?.paused)),
               user: interaction.user,
             });
             return;
          }

          if (interaction.commandName === 'play-now') {
             const npAll = await ctx.call('music.now_playing_requested', { guild_id: gid });
             const npData = npAll[0] || {};
             const np = npData.now_playing;
             if (!np) {
               await replyToInteraction(interaction, { content: 'Không có bài nào đang phát.', title: 'Now Playing', tone: 'warning', user: interaction.user, ephemeral: true });
               return;
             }
             const safeQueue2 = Array.isArray(npData.queue) ? npData.queue : [];
             await replyToInteraction(interaction, {
               embeds: [buildMusicPlayerEmbed({
                 nowPlaying: np,
                 queue: safeQueue2,
                 requester: interaction.user,
                 botUser: client?.user || null,
               })],
               components: buildMusicControlsUi(np, safeQueue2, 0, Boolean(npData.paused)),
               user: interaction.user,
             });
             return;
          }

          if (interaction.commandName === 'play-cache') {
             const cache = getMusicCache();
             const stats = cache.getStats();
             const mb = (stats.total_size_bytes / (1024 * 1024)).toFixed(2);
             const maxGb = Number(resolvePolicySetting(runtimeState, POLICY_CACHE, 'max_size_gb', 1));
             await replyToInteraction(interaction, {
               content: `Số lượng file: ${stats.total_files}\nDung lượng: ${mb} MB / ${maxGb * 1024} MB`,
               title: 'Music Cache Stats',
               tone: 'info',
               user: interaction.user,
               ephemeral: true,
             });
             return;
          }

          if (interaction.commandName === 'play-cache-clear') {
             const cache = getMusicCache();
             cache.clear();
             await replyToInteraction(interaction, { content: 'Đã xóa toàn bộ music cache.', title: 'Music Cache', tone: 'success', user: interaction.user, ephemeral: true });
             return;
          }
        } catch (err) {
          logger?.log('error', `[PlayMusic] Error in command ${interaction.commandName}: ${err.message}`);
          if (!interaction.replied && !interaction.deferred) {
            await replyToInteraction(interaction, { content: `Đã xảy ra lỗi: ${err.message}`, tone: 'error', title: 'Play Music', user: interaction.user, ephemeral: true });
          } else {
            await replyToInteraction(interaction, { content: `Đã xảy ra lỗi: ${err.message}`, tone: 'error', title: 'Play Music', user: interaction.user }).catch(()=>{});
          }
        }
      });

      ctx.subscribe('music.prefetch_requested', async (p) => {
        const url = String(p?.url || '').trim();
        if (!url || !ytDlpAvailable) return;
        try {
          // Resolve and download to cache in background
          const tracks = await resolveTrack(url, false, 1, getYtDlpOptions());
          if (tracks && tracks.length > 0) {
            await getAudioStream(tracks[0], getMusicCache(), getYtDlpOptions());
            logger?.log('info', `[PlayMusic] Prefetched background track: ${tracks[0].title}`);
          }
        } catch (err) {
          // Silently ignore prefetch failures as it's just an optimization
        }
      });
    },
  };
};
