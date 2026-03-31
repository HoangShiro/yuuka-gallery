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
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(normalized);
  }
  return interaction.reply({ ...normalized, ephemeral: Boolean(payload.ephemeral) });
}

module.exports = {
  sendManagedReply,
  replyToInteraction,
};
