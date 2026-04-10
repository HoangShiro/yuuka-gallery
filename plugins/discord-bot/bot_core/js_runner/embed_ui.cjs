const { EmbedBuilder } = require('discord.js');

/**
 * Thư viện UI để tạo các Embed chuẩn cho Discord Bot.
 */
const EmbedUI = {
  // Bảng màu chuẩn
  COLORS: {
    PRIMARY: 0x3498db, // Blue
    SUCCESS: 0x2ecc71, // Green
    WARNING: 0xf1c40f, // Yellow
    ERROR: 0xe74c3c,   // Red
    MUSIC: 0x9b59b6,   // Purple
    AI: 0x1abc9c,      // Turquoise
  },

  /**
   * Tạo một thanh tiến trình văn bản.
   * @param {number} percent - Phần trăm (0-100).
   * @param {Object} [config] - Cấu hình tùy chỉnh.
   * @returns {string}
   */
  loadingBar(percent, config = {}) {
    const barSettings = config.loading_bar || [];
    const icon = barSettings[0] || '';
    const startB = barSettings[1] || '[';
    const filledB = barSettings[2] || '█';
    const emptyB = barSettings[3] || '░';
    const endB = barSettings[4] || ']';

    const safePercent = Math.max(0, Math.min(100, percent));
    const filledCount = Math.floor(safePercent / 10);
    const emptyCount = 10 - filledCount;
    
    const iconStr = icon ? `${icon} ` : '';
    return `${iconStr}${startB}${filledB.repeat(filledCount)}${emptyB.repeat(emptyCount)}${endB}`;
  },

  /**
   * Tạo một Embed cơ bản với footer chuẩn.
   * @param {Object} [options]
   * @returns {EmbedBuilder}
   */
  createBase(options = {}) {
    const embed = new EmbedBuilder()
      .setTimestamp(new Date());

    if (options.user) {
      embed.setFooter({ 
        text: `Requested by ${options.user.tag || options.user.username}`, 
        iconURL: typeof options.user.displayAvatarURL === 'function' ? options.user.displayAvatarURL() : null 
      });
    }

    return embed;
  },

  /**
   * Tạo Embed thông báo thành công.
   */
  createSuccess(title, description, user = null) {
    return this.createBase({ user })
      .setColor(this.COLORS.SUCCESS)
      .setTitle(`✅ ${title}`)
      .setDescription(description || ' ');
  },

  /**
   * Tạo Embed thông báo lỗi.
   */
  createError(title, description, user = null) {
    return this.createBase({ user })
      .setColor(this.COLORS.ERROR)
      .setTitle(`❌ ${title}`)
      .setDescription(description || ' ');
  },

  /**
   * Tạo Embed thông tin.
   */
  createInfo(title, description, user = null) {
    return this.createBase({ user })
      .setColor(this.COLORS.PRIMARY)
      .setTitle(`ℹ️ ${title}`)
      .setDescription(description || ' ');
  },

  /**
   * Tạo Embed cho trình phát nhạc.
   */
  createMusicTrack(track, status = 'Now Playing', user = null) {
    const embed = this.createBase({ user })
      .setColor(this.COLORS.MUSIC)
      .setTitle(`🎵 ${status}`)
      .setDescription(`**[${track.title}](${track.source_url || '#'})**`)
      .addFields(
        { name: 'Thời lượng', value: track.duration || 'Unknown', inline: true },
        { name: 'Yêu cầu bởi', value: track.requester || 'Unknown', inline: true }
      );

    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    return embed;
  },

  /**
   * Tạo Embed cho quá trình tạo ảnh (Art Generation).
   * @param {Object} state - Trạng thái của GenerationTask.
   * @returns {EmbedBuilder}
   */
  createArtGeneration(state) {
    const req = state.request || {};
    const cfg = req.user_facing_config || {};
    
    // 1. Xác định Title và Màu sắc
    const errorOccurred = !!(state.result && state.result.error_message);
    const isFinished = !!state.result;
    const isCancelled = !!(state.result && state.result.was_cancelled);
    
    const baseTitle = cfg._custom_generation_title || '🎨 Art Generation';
    let embedTitle = baseTitle;
    if (errorOccurred) embedTitle = `❌ Error: ${baseTitle}`;
    else if (isCancelled) embedTitle = `❌ Cancelled: ${baseTitle}`;

    let embedColor = this.COLORS.PRIMARY; // Mặc định là Blue (Đang chạy)
    if (errorOccurred) embedColor = this.COLORS.ERROR;
    else if (isFinished) embedColor = this.COLORS.SUCCESS;

    const embed = new EmbedBuilder()
      .setTitle(embedTitle)
      .setColor(embedColor)
      .setTimestamp(new Date());

    // 2. Xử lý Description và Prompt
    const fullPrompt = cfg.combined_text_prompt || '';
    // Normalize tags tương đương tag_utils.normalize_tag_list
    const promptTags = fullPrompt.split(',').map(t => t.trim()).filter(Boolean);
    const MAX_TAGS = 15;
    const displayPrompt = promptTags.length > MAX_TAGS 
      ? promptTags.slice(0, MAX_TAGS).join(', ') + ', ... ℹ️ Show Info for more.'
      : promptTags.join(', ') || 'None';

    let statusLine = `**Status:** ${state.status || 'Processing...'}`;
    if (!isFinished && !errorOccurred && state.queue_info) {
      statusLine += `  \`[${state.queue_info.current || 0}/${state.queue_info.max || 0}]\``;
    }
    embed.setDescription(`${statusLine}\n**Prompt:** \`${displayPrompt}\``);

    // 3. Xử lý Details Field
    const detailsLines = [
      `H x W: \`${cfg.height || 512}x${cfg.width || 512}\` Steps: \`${cfg.steps || 20}\` CFG: \`${cfg.cfg || 7.0}\``,
      `Sampler: \`${cfg.sampler_name || 'euler'}\` Scheduler: \`${cfg.scheduler || 'normal'}\``
    ];

    // LoRA Info
    if (cfg.lora_name && cfg.lora_name !== 'None') {
      const loraName = cfg.lora_name;
      // Trong môi trường JS, việc đọc file library cần được xử lý bên ngoài hoặc qua deps.
      // Ở đây ta sử dụng format mặc định nếu không có thư viện truyền vào.
      const loraDisplayName = loraName.split('.')[0].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      detailsLines.push(`LoRA: \`${loraDisplayName}\``);
    }

    // Seed & Time
    let timeStr = '';
    if (state.result) {
      const exec = state.result.execution_duration;
      const total = state.result.total_duration;
      if (exec != null && total != null) timeStr = `Time: \`${exec.toFixed(2)}s | ${total.toFixed(2)}s\``;
      else if (total != null) timeStr = `Time: \`${total.toFixed(2)}s\``;
    }

    let seedStr = `Seed: \`${req.seed || '0'}\``;
    if (state.prompt_id && !isFinished) {
      seedStr += ` | Prompt ID: \`${state.prompt_id}\``;
    }
    detailsLines.push(`${seedStr} ${timeStr}`.trim());

    embed.addFields({ name: 'Details', value: detailsLines.join('\n'), inline: false });

    // 4. Footer
    const userName = req.user_display_name || 'Unknown User';
    const gpStr = state.user_stats?.generate_point != null 
      ? Number(state.user_stats.generate_point).toLocaleString() 
      : 'N/A';
    const rankEmoji = state.user_rank?.[1] || '🔩';
    const rankName = state.user_rank?.[0] || 'Steel';

    embed.setFooter({ text: `⚜️: ${userName} | ${rankEmoji} ${rankName} | 🪙: ${gpStr}` });

    // 5. Images & Thumbnail
    if (state.result?.image_tuples?.length === 1) {
      const imgPath = state.result.image_tuples[0][1];
      if (imgPath) {
        const filename = imgPath.split(/[\\/]/).pop();
        embed.setImage(`attachment://${filename}`);
      }
    }

    if (state.avatar_thumbnail_file) {
      embed.setThumbnail(`attachment://${state.avatar_thumbnail_file}`);
    }

    return embed;
  }
};

module.exports = EmbedUI;
