const EmbedUI = require('./embed_ui.cjs');

function createNotificationEmbed(payload = {}, actor = null) {
  const description = String(payload.content || '').trim();
  if (!description) {
    return null;
  }
  const tone = String(payload.tone || 'info').trim().toLowerCase();
  const title = String(payload.title || '').trim();
  if (tone === 'success') {
    return EmbedUI.createSuccess(title || 'Success', description, actor);
  }
  if (tone === 'error') {
    return EmbedUI.createError(title || 'Error', description, actor);
  }
  if (tone === 'warning') {
    return EmbedUI.createBase({ user: actor })
      .setColor(EmbedUI.COLORS.WARNING)
      .setTitle(`⚠️ ${title || 'Warning'}`)
      .setDescription(description);
  }
  return EmbedUI.createInfo(title || 'Notification', description, actor);
}

function normalizeDiscordPayload(payload = {}, actor = null) {
  const normalized = { ...(payload || {}) };
  const content = payload.content == null ? '' : String(payload.content);
  const files = Array.isArray(payload.files) ? payload.files : [];
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.filter(Boolean) : [];
  const components = Array.isArray(payload.components) ? payload.components : undefined;

  if (!embeds.length && content.trim() && !payload.raw_content) {
    const generated = createNotificationEmbed(payload, payload.user || actor);
    if (generated) {
      normalized.embeds = [generated];
      delete normalized.content;
    }
  } else if (content.trim()) {
    normalized.content = content;
  } else {
    delete normalized.content;
  }

  if (files.length) {
    normalized.files = files;
  }
  if (!normalized.content && (!Array.isArray(normalized.embeds) || normalized.embeds.length === 0) && !normalized.files) {
    normalized.content = ' ';
  }

  if (components !== undefined) {
    normalized.components = components;
  }

  delete normalized.user;
  delete normalized.title;
  delete normalized.tone;
  delete normalized.raw_content;
  delete normalized.followup;
  delete normalized.llm_followup_hint;

  return normalized;
}

async function sendManagedReply(target, payload = {}) {
  const responsePayload = normalizeDiscordPayload(payload, payload.user || null);
  return target.send ? target.send(responsePayload) : target.reply(responsePayload);
}

async function replyToInteraction(interaction, payload = {}) {
  const normalized = normalizeDiscordPayload(payload, payload.user || interaction?.user || null);
  const replyPayload = { ...normalized, ephemeral: Boolean(payload.ephemeral) };
  const editPayload = { ...normalized };
  delete editPayload.ephemeral;
  try {
    if (interaction.deferred || interaction.replied) {
      try {
        return await interaction.editReply(editPayload);
      } catch (error) {
        const message = String(error?.message || error || '');
        const code = Number(error?.code || 0);
        if (typeof interaction.followUp === 'function' && (code === 40060 || /interaction has already been acknowledged/i.test(message))) {
          return await interaction.followUp(replyPayload);
        }
        throw error;
      }
    }
    return await interaction.reply(replyPayload);
  } catch (error) {
    const message = String(error?.message || error || '');
    const code = Number(error?.code || 0);
    if (code === 10062 || /unknown interaction/i.test(message)) {
      return null;
    }
    throw error;
  }
}

async function replyToMessage(message, payload = {}) {
  if (!message || typeof message.reply !== 'function') {
    return null;
  }
  const normalized = normalizeDiscordPayload(payload, payload.user || message.author || null);
  return message.reply(normalized);
}

module.exports = {
  normalizeDiscordPayload,
  sendManagedReply,
  replyToInteraction,
  replyToMessage,
};
