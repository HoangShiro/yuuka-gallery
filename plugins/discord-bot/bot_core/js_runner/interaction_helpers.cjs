async function sendManagedReply(target, payload = {}) {
  const content = payload.content == null ? null : String(payload.content);
  const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
  const files = Array.isArray(payload.files) ? payload.files : [];
  const responsePayload = {};
  if (content && content.trim()) {
    responsePayload.content = content;
  }
  if (embeds.length) {
    responsePayload.embeds = embeds;
  }
  if (files.length) {
    responsePayload.files = files;
  }
  if (!responsePayload.content && !responsePayload.embeds && !responsePayload.files) {
    responsePayload.content = ' ';
  }
  return target.send ? target.send(responsePayload) : target.reply(responsePayload);
}

async function replyToInteraction(interaction, payload = {}) {
  const normalized = { ...payload };
  if (!normalized.content && !normalized.embeds) {
    normalized.content = 'Done.';
  }
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

module.exports = {
  sendManagedReply,
  replyToInteraction,
};
