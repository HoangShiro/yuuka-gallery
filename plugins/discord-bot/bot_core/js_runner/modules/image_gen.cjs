const { AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const { addCommandDefinition } = require('../runtime_state.cjs');
const { replyToInteraction, sendManagedReply } = require('../interaction_helpers.cjs');
const { safeGuildName, safeUserTag, truncateText } = require('../discord_utils.cjs');
const EmbedUI = require('../embed_ui.cjs');

const SIZE_CHOICES = [
  ['832x1216 Portrait', '832x1216'],
  ['1216x832 Landscape', '1216x832'],
  ['1024x1024 Square', '1024x1024'],
  ['1344x768 Wide', '1344x768'],
];
const BRAIN_SIZE_PRESETS = {
  portrait: '832x1216',
  landscape: '1216x832',
  square: '1024x1024',
  wide: '1344x768',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runtimeApiRoot(runtimeConfig) {
  const base = String(runtimeConfig.runtime_api_base_url || 'http://127.0.0.1:5000/api/plugin/discord-bot/runtime').trim().replace(/\/$/, '');
  const userHash = encodeURIComponent(String(runtimeConfig.user_hash || '').trim());
  const botId = encodeURIComponent(String(runtimeConfig.bot_id || '').trim());
  if (!userHash || !botId) {
    throw new Error('Runtime config is missing user_hash or bot_id.');
  }
  return `${base}/${userHash}/${botId}/image-gen`;
}

function runtimeHeaders(runtimeConfig, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Discord-Bot-Secret': String(runtimeConfig.runtime_secret || '').trim(),
    ...extra,
  };
  if (!headers['X-Discord-Bot-Secret']) {
    throw new Error('Runtime secret is missing.');
  }
  return headers;
}

async function runtimeJson(runtimeConfig, url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = { error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    throw new Error(String(body.error || body.description || `HTTP ${response.status}`));
  }
  return body;
}

async function runtimePost(runtimeConfig, path, payload = {}) {
  return runtimeJson(runtimeConfig, `${runtimeApiRoot(runtimeConfig)}${path}`, {
    method: 'POST',
    headers: runtimeHeaders(runtimeConfig),
    body: JSON.stringify(payload || {}),
  });
}

async function runtimeGet(runtimeConfig, path) {
  return runtimeJson(runtimeConfig, `${runtimeApiRoot(runtimeConfig)}${path}`, {
    method: 'GET',
    headers: { 'X-Discord-Bot-Secret': String(runtimeConfig.runtime_secret || '').trim() },
  });
}

async function runtimeAutocomplete(runtimeConfig, field, value, extra = {}) {
  const params = new URLSearchParams();
  params.set('field', String(field || '').trim());
  params.set('value', String(value || ''));
  params.set('limit', String(Math.max(1, Math.min(25, Number(extra.limit || 25)))));
  if (extra.server_address) {
    params.set('server_address', String(extra.server_address || '').trim());
  }
  return runtimeGet(runtimeConfig, `/autocomplete?${params.toString()}`);
}

async function runtimeBinary(runtimeConfig, absoluteUrl) {
  const response = await fetch(absoluteUrl, {
    method: 'GET',
    headers: { 'X-Discord-Bot-Secret': String(runtimeConfig.runtime_secret || '').trim() },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function promptPreview(cfg = {}) {
  const text = String(cfg.combined_text_prompt || '').trim();
  if (!text) {
    return 'None';
  }
  const normalized = text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ');
  return truncateText(normalized, 220) || 'None';
}

function statusText(status = '') {
  const raw = String(status || '').trim().toLowerCase();
  if (raw === 'running') return 'Running';
  if (raw === 'completed') return 'Completed';
  if (raw === 'cancelled') return 'Cancelled';
  if (raw === 'error') return 'Error';
  return raw || 'Unknown';
}

function buildProgressEmbed(snapshot = {}, actor = null) {
  const cfg = snapshot?.request?.user_facing_config || {};
  const embed = EmbedUI.createBase({ user: actor })
    .setColor(EmbedUI.COLORS.PRIMARY)
    .setTitle('Image Generation')
    .setDescription([
      `**Status:** ${statusText(snapshot.status)}`,
      `**Progress:** ${Math.max(0, Math.min(100, Number(snapshot.progress_percent || 0)))}%`,
      `**Prompt:** \`${promptPreview(cfg)}\``,
    ].join('\n'));

  const lines = [
    `Size: \`${cfg.width || 832}x${cfg.height || 1216}\``,
    `Steps: \`${cfg.steps || 12}\` CFG: \`${cfg.cfg || 2.2}\``,
    `Sampler: \`${cfg.sampler_name || 'dpmpp_sde'}\` Scheduler: \`${cfg.scheduler || 'beta'}\``,
    `Seed: \`${snapshot?.request?.seed || 0}\``,
  ];
  if (snapshot.prompt_id) {
    lines.push(`Prompt ID: \`${snapshot.prompt_id}\``);
  }
  if (Number(snapshot.queue_position || 0) > 0) {
    lines.push(`Queue Ahead: \`${snapshot.queue_position}\``);
  }
  if (snapshot.progress_message) {
    lines.push(`Backend: ${truncateText(String(snapshot.progress_message || ''), 120)}`);
  }
  embed.addFields({ name: 'Details', value: lines.join('\n'), inline: false });
  return embed;
}

function buildTerminalEmbed(snapshot = {}, actor = null, attachmentName = '') {
  const cfg = snapshot?.request?.user_facing_config || {};
  const isError = snapshot.status === 'error';
  const isCancelled = snapshot.status === 'cancelled';
  const color = isError
    ? EmbedUI.COLORS.ERROR
    : (isCancelled ? EmbedUI.COLORS.WARNING : EmbedUI.COLORS.SUCCESS);
  const title = isError
    ? 'Image Generation Failed'
    : (isCancelled ? 'Image Generation Cancelled' : 'Image Generated');
  const embed = EmbedUI.createBase({ user: actor })
    .setColor(color)
    .setTitle(title)
    .setDescription([
      `**Status:** ${statusText(snapshot.status)}`,
      `**Prompt:** \`${promptPreview(cfg)}\``,
      snapshot.error ? `**Error:** ${truncateText(String(snapshot.error || ''), 200)}` : '',
    ].filter(Boolean).join('\n'));
  const lines = [
    `Size: \`${cfg.width || 832}x${cfg.height || 1216}\``,
    `Steps: \`${cfg.steps || 12}\` CFG: \`${cfg.cfg || 2.2}\``,
    `Sampler: \`${cfg.sampler_name || 'dpmpp_sde'}\` Scheduler: \`${cfg.scheduler || 'beta'}\``,
    `Seed: \`${snapshot?.request?.seed || 0}\``,
  ];
  if (snapshot?.result?.image_data?.creationTime != null) {
    lines.push(`Time: \`${snapshot.result.image_data.creationTime}s\``);
  }
  embed.addFields({ name: 'Details', value: lines.join('\n'), inline: false });
  if (!isError && !isCancelled && attachmentName) {
    embed.setImage(`attachment://${attachmentName}`);
  }
  return embed;
}

function normalizeAutocompleteChoices(payload = {}) {
  const source = Array.isArray(payload?.choices) ? payload.choices : [];
  return source
    .map((item) => ({
      name: String(item?.name || item?.value || '').trim().slice(0, 100),
      value: String(item?.value || item?.name || '').trim().slice(0, 100),
    }))
    .filter((item) => item.name && item.value)
    .slice(0, 25);
}

function normalizeToolSize(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  const aliasMap = {
    portrait: BRAIN_SIZE_PRESETS.portrait,
    vertical: BRAIN_SIZE_PRESETS.portrait,
    tall: BRAIN_SIZE_PRESETS.portrait,
    landscape: BRAIN_SIZE_PRESETS.landscape,
    horizontal: BRAIN_SIZE_PRESETS.landscape,
    square: BRAIN_SIZE_PRESETS.square,
    wide: BRAIN_SIZE_PRESETS.wide,
    cinematic: BRAIN_SIZE_PRESETS.wide,
  };
  return aliasMap[raw] || '';
}

function describeToolSize(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'default';
  }
  const normalized = normalizeToolSize(raw) || raw;
  if (normalized === BRAIN_SIZE_PRESETS.portrait) return 'portrait';
  if (normalized === BRAIN_SIZE_PRESETS.landscape) return 'landscape';
  if (normalized === BRAIN_SIZE_PRESETS.square) return 'square';
  if (normalized === BRAIN_SIZE_PRESETS.wide) return 'wide';
  return raw;
}

module.exports = function createImageGenModule(deps) {
  const { runtimeConfig, runtimeState, logger } = deps;
  const activeTaskByActorChannel = new Map();
  let isSetup = false;

  async function pollTask(interaction, taskId, actorKey) {
    let lastRenderedState = '';
    let unknownCount = 0;
    while (true) {
      const snapshot = await runtimeGet(runtimeConfig, `/status/${encodeURIComponent(taskId)}`);
      if (snapshot.status === 'unknown') {
        unknownCount += 1;
      } else {
        unknownCount = 0;
      }
      const renderState = JSON.stringify([
        snapshot.status,
        snapshot.progress_percent,
        snapshot.progress_message,
        snapshot.queue_position,
        snapshot.prompt_id,
      ]);
      if (renderState !== lastRenderedState && snapshot.status === 'running') {
        lastRenderedState = renderState;
        await replyToInteraction(interaction, {
          embeds: [buildProgressEmbed(snapshot, interaction.user)],
          user: interaction.user,
        });
      }

      if (snapshot.status === 'completed') {
        let files = [];
        let attachmentName = '';
        if (snapshot?.result?.media_endpoint) {
          attachmentName = String(snapshot?.result?.filename || 'generated.png').trim() || 'generated.png';
          const binary = await runtimeBinary(runtimeConfig, snapshot.result.media_endpoint);
          files = [new AttachmentBuilder(binary, { name: attachmentName })];
        }
        await replyToInteraction(interaction, {
          embeds: [buildTerminalEmbed(snapshot, interaction.user, attachmentName)],
          files,
          user: interaction.user,
        });
        await runtimeGet(runtimeConfig, `/status/${encodeURIComponent(taskId)}?consume=1`).catch(() => null);
        activeTaskByActorChannel.delete(actorKey);
        return;
      }

      if (snapshot.status === 'error' || snapshot.status === 'cancelled') {
        await replyToInteraction(interaction, {
          embeds: [buildTerminalEmbed(snapshot, interaction.user)],
          user: interaction.user,
        });
        await runtimeGet(runtimeConfig, `/status/${encodeURIComponent(taskId)}?consume=1`).catch(() => null);
        activeTaskByActorChannel.delete(actorKey);
        return;
      }

      if (unknownCount >= 3) {
        await replyToInteraction(interaction, {
          embeds: [buildTerminalEmbed({
            status: 'error',
            error: 'The generation task is no longer visible in the backend state.',
            request: snapshot.request || { user_facing_config: {} },
          }, interaction.user)],
          user: interaction.user,
        });
        activeTaskByActorChannel.delete(actorKey);
        return;
      }

      await sleep(1200);
    }
  }

  function actorChannelKey(interaction) {
    return actorChannelKeyFromParts({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      actorId: interaction.user?.id,
    });
  }

  function actorChannelKeyFromParts({ guildId = '', channelId = '', actorId = '' } = {}) {
    return [
      String(guildId || 'dm'),
      String(channelId || 'unknown'),
      String(actorId || 'unknown'),
    ].join(':');
  }

  function buildGeneratePayload(interaction) {
    return {
      options: {
        prompt: interaction.options.getString('prompt'),
        character: interaction.options.getString('character'),
        outfits: interaction.options.getString('outfits'),
        expression: interaction.options.getString('expression'),
        action: interaction.options.getString('action'),
        context: interaction.options.getString('context'),
        quality: interaction.options.getString('quality'),
        negative: interaction.options.getString('negative'),
        size: interaction.options.getString('size'),
        steps: interaction.options.getInteger('steps'),
        cfg: interaction.options.getNumber('cfg'),
        seed: interaction.options.getInteger('seed'),
        ckpt_name: interaction.options.getString('ckpt'),
        lora_name: interaction.options.getString('lora'),
        sampler_name: interaction.options.getString('sampler'),
        scheduler: interaction.options.getString('scheduler'),
        server_address: interaction.options.getString('server'),
      },
      guild_id: String(interaction.guildId || ''),
      channel_id: String(interaction.channelId || ''),
      actor_id: String(interaction.user?.id || ''),
      actor_name: safeUserTag(interaction.user),
    };
  }

  async function handleAutocomplete(interaction) {
    const focused = interaction?.options?.getFocused?.(true);
    const field = String(focused?.name || '').trim();
    if (!field) {
      await interaction.respond([]).catch(() => null);
      return;
    }
    try {
      const payload = await runtimeAutocomplete(runtimeConfig, field, focused?.value || '', {
        server_address: interaction.options.getString('server') || runtimeConfig.image_gen_server_address || '',
        limit: 25,
      });
      await interaction.respond(normalizeAutocompleteChoices(payload)).catch(() => null);
    } catch (error) {
      logger?.log('warning', `[ImageGen] autocomplete failed for ${field}: ${error.message || String(error)}`);
      await interaction.respond([]).catch(() => null);
    }
  }

  async function monitorTaskForChannel(target, taskId, actor, actorKey) {
    let unknownCount = 0;
    while (true) {
      const snapshot = await runtimeGet(runtimeConfig, `/status/${encodeURIComponent(taskId)}`);
      if (snapshot.status === 'unknown') {
        unknownCount += 1;
      } else {
        unknownCount = 0;
      }

      if (snapshot.status === 'completed') {
        let files = [];
        let attachmentName = '';
        if (snapshot?.result?.media_endpoint) {
          attachmentName = String(snapshot?.result?.filename || 'generated.png').trim() || 'generated.png';
          const binary = await runtimeBinary(runtimeConfig, snapshot.result.media_endpoint);
          files = [new AttachmentBuilder(binary, { name: attachmentName })];
        }
        await sendManagedReply(target, {
          embeds: [buildTerminalEmbed(snapshot, actor, attachmentName)],
          files,
          user: actor,
        });
        await runtimeGet(runtimeConfig, `/status/${encodeURIComponent(taskId)}?consume=1`).catch(() => null);
        activeTaskByActorChannel.delete(actorKey);
        return;
      }

      if (snapshot.status === 'error' || snapshot.status === 'cancelled') {
        await sendManagedReply(target, {
          embeds: [buildTerminalEmbed(snapshot, actor)],
          user: actor,
        });
        await runtimeGet(runtimeConfig, `/status/${encodeURIComponent(taskId)}?consume=1`).catch(() => null);
        activeTaskByActorChannel.delete(actorKey);
        return;
      }

      if (unknownCount >= 3) {
        await sendManagedReply(target, {
          embeds: [buildTerminalEmbed({
            status: 'error',
            error: 'The generation task is no longer visible in the backend state.',
            request: snapshot.request || { user_facing_config: {} },
          }, actor)],
          user: actor,
        }).catch(() => null);
        activeTaskByActorChannel.delete(actorKey);
        return;
      }

      await sleep(1200);
    }
  }

  return {
    module_id: 'core.image-gen',
    name: 'Image Generation',

    setup(ctx) {
      if (isSetup) {
        return;
      }
      isSetup = true;
      ctx.registerBrainInstruction('Use the image generation tool when the user asks to create or render an image. Fill `prompt` with concise comma-separated booru-style tags only, for example: "1girl, silver hair, smile, school uniform, rooftop, sunset, masterpiece, best quality". Leave `size` empty to use the configured default size. If the user explicitly requests a framing, set `size` to one of: portrait, landscape, square, or wide.');
      ctx.registerBrainTool({
        tool_id: 'image_generate',
        title: 'Generate image',
        description: 'Queue an image generation job through the core ComfyUI pipeline using a booru-style prompt and an optional natural-language size preset. Example: "Generate an image with prompt 1girl, blue hair, smile, cafe, warm lighting, masterpiece, best quality" or set size to portrait, landscape, square, or wide.',
        call_event: 'image_gen.generate_requested',
        input_schema: {
          prompt: 'string',
          size: '"portrait"|"landscape"|"square"|"wide"?',
        },
        default_enabled: true,
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'image_generate',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          if (!result || result.ok === false) {
            return {
              content: `Image generation failed: ${String(result?.message || result?.reason || 'unknown_error')}`,
              title: 'Image Generation',
              tone: 'warning',
              followup: true,
              user: actor,
            };
          }
          return {
            content: `Queued image generation (${describeToolSize(result.size)}) for prompt: ${truncateText(String(result.prompt || ''), 220)}`,
            title: 'Image Generation',
            tone: 'success',
            user: actor,
          };
        },
      });
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('img')
        .setDescription('Generate an image through the core ComfyUI pipeline')
        .addStringOption((option) => option.setName('prompt').setDescription('Prompt override or main prompt block').setAutocomplete(true))
        .addStringOption((option) => option.setName('character').setDescription('Character name override').setAutocomplete(true))
        .addStringOption((option) => option.setName('outfits').setDescription('Outfit tags').setAutocomplete(true))
        .addStringOption((option) => option.setName('expression').setDescription('Expression tags').setAutocomplete(true))
        .addStringOption((option) => option.setName('action').setDescription('Action tags').setAutocomplete(true))
        .addStringOption((option) => option.setName('context').setDescription('Context tags').setAutocomplete(true))
        .addStringOption((option) => option.setName('quality').setDescription('Quality tags').setAutocomplete(true))
        .addStringOption((option) => option.setName('negative').setDescription('Negative prompt tags').setAutocomplete(true))
        .addStringOption((option) => {
          option.setName('size').setDescription('Image size preset');
          for (const [label, value] of SIZE_CHOICES) {
            option.addChoices({ name: label, value });
          }
          return option;
        })
        .addIntegerOption((option) => option.setName('steps').setDescription('Sampling steps').setMinValue(1).setMaxValue(60))
        .addNumberOption((option) => option.setName('cfg').setDescription('CFG scale').setMinValue(0).setMaxValue(30))
        .addIntegerOption((option) => option.setName('seed').setDescription('Seed (0 or omit for random)'))
        .addStringOption((option) => option.setName('ckpt').setDescription('Checkpoint name override').setAutocomplete(true))
        .addStringOption((option) => option.setName('lora').setDescription('LoRA name override').setAutocomplete(true))
        .addStringOption((option) => option.setName('sampler').setDescription('Sampler override').setAutocomplete(true))
        .addStringOption((option) => option.setName('scheduler').setDescription('Scheduler override').setAutocomplete(true))
        .addStringOption((option) => option.setName('server').setDescription('ComfyUI server address override')));

      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('img-cancel')
        .setDescription('Cancel your current image generation task in this channel'));

      ctx.subscribe('image_gen.generate_requested', async (payload) => {
        const target = payload?.channel;
        if (!target || typeof target.send !== 'function') {
          throw new Error('A Discord text channel is required to queue image generation.');
        }
        const actor = payload?.actor || null;
        const prompt = String(payload?.prompt || '').trim();
        if (!prompt) {
          throw new Error('prompt is required.');
        }
        const size = normalizeToolSize(payload?.size);
        const requestPayload = {
          options: {
            prompt,
            ...(size ? { size } : {}),
          },
          guild_id: String(payload?.guild_id || payload?.guild?.id || ''),
          channel_id: String(payload?.channel_id || target.id || ''),
          actor_id: String(payload?.actor_id || payload?.requester_id || actor?.id || ''),
          actor_name: String(payload?.requester_name || safeUserTag(actor) || '').trim(),
        };
        const started = await runtimePost(runtimeConfig, '/generate', requestPayload);
        const actorKey = actorChannelKeyFromParts({
          guildId: requestPayload.guild_id,
          channelId: requestPayload.channel_id,
          actorId: requestPayload.actor_id,
        });
        activeTaskByActorChannel.set(actorKey, started.task_id);
        monitorTaskForChannel(target, started.task_id, actor, actorKey).catch((error) => {
          logger?.log('error', `[ImageGen] background tool monitor failed: ${error.message || String(error)}`);
          activeTaskByActorChannel.delete(actorKey);
          sendManagedReply(target, {
            embeds: [buildTerminalEmbed({
              status: 'error',
              error: error.message || String(error),
              request: started.request || { user_facing_config: {} },
            }, actor)],
            user: actor,
          }).catch(() => null);
        });
        return {
          ok: true,
          status: 'queued',
          task_id: started.task_id,
          prompt: started?.request?.user_facing_config?.combined_text_prompt || prompt,
          size: size || `${started?.request?.user_facing_config?.width || 832}x${started?.request?.user_facing_config?.height || 1216}`,
        };
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction) {
          return;
        }

        if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
          if (interaction.commandName === 'img') {
            await handleAutocomplete(interaction);
          }
          return;
        }

        if (!interaction.isChatInputCommand()) {
          return;
        }

        if (interaction.commandName === 'img') {
          await interaction.deferReply();
          const payload = buildGeneratePayload(interaction);
          const actorKey = actorChannelKey(interaction);
          try {
            const started = await runtimePost(runtimeConfig, '/generate', payload);
            activeTaskByActorChannel.set(actorKey, started.task_id);
            await replyToInteraction(interaction, {
              embeds: [buildProgressEmbed({
                status: 'running',
                request: started.request,
                progress_percent: 0,
                progress_message: 'Queued in core generation service...',
                queue_position: 0,
              }, interaction.user)],
              user: interaction.user,
            });
            ctx.publish('bot.command_executed', {
              command: 'img',
              guild: safeGuildName(interaction.guild),
              author: safeUserTag(interaction.user),
              payload: truncateText(String(started?.request?.user_facing_config?.combined_text_prompt || ''), 120),
            });
            await pollTask(interaction, started.task_id, actorKey);
          } catch (error) {
            activeTaskByActorChannel.delete(actorKey);
            logger?.log('error', `[ImageGen] /img failed: ${error.message || String(error)}`);
            await replyToInteraction(interaction, {
              embeds: [buildTerminalEmbed({
                status: 'error',
                error: error.message || String(error),
                request: { user_facing_config: {} },
              }, interaction.user)],
              user: interaction.user,
            });
          }
          return;
        }

        if (interaction.commandName === 'img-cancel') {
          await interaction.deferReply({ ephemeral: true }).catch(() => null);
          const actorKey = actorChannelKey(interaction);
          const taskId = activeTaskByActorChannel.get(actorKey);
          if (!taskId) {
            await replyToInteraction(interaction, {
              content: 'No active image task was tracked for you in this channel.',
              title: 'Image Generation',
              tone: 'warning',
              user: interaction.user,
              ephemeral: true,
            });
            return;
          }
          try {
            await runtimePost(runtimeConfig, '/cancel', { task_id: taskId });
            await replyToInteraction(interaction, {
              content: 'Cancellation request sent to the core generation service.',
              title: 'Image Generation',
              tone: 'success',
              user: interaction.user,
              ephemeral: true,
            });
          } catch (error) {
            await replyToInteraction(interaction, {
              content: String(error.message || error || 'Failed to cancel image task.'),
              title: 'Image Generation',
              tone: 'error',
              user: interaction.user,
              ephemeral: true,
            });
          }
        }
      });
    },
  };
};
