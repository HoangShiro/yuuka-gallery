function getCollectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (typeof collection.values === 'function') {
    return [...collection.values()];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  return [];
}

function safeAttachmentTypeLabel(attachment) {
  const rawContentType = String(
    attachment?.contentType
    || attachment?.content_type
    || ''
  ).trim().toLowerCase();
  if (rawContentType) {
    return rawContentType.split(';')[0] || rawContentType;
  }
  const name = String(attachment?.name || '').trim();
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex >= 0 && dotIndex < name.length - 1) {
    return name.slice(dotIndex + 1).toLowerCase();
  }
  return 'unknown';
}

function collectMessageAttachments(message) {
  return getCollectionValues(message?.attachments).map((attachment) => {
    const name = truncateText(String(attachment?.name || 'unnamed file').trim(), 120) || 'unnamed file';
    const type = truncateText(safeAttachmentTypeLabel(attachment), 80) || 'unknown';
    return {
      name,
      type,
      label: `${name} (${type})`,
      url: String(attachment?.url || attachment?.proxyURL || '').trim(),
      size: Number(attachment?.size || 0) || 0,
      content_type: String(attachment?.contentType || attachment?.content_type || '').trim(),
    };
  }).filter((attachment) => attachment.name);
}

function safeUserTag(user) {
  if (!user) {
    return 'UnknownUser';
  }
  return user.tag || user.username || String(user.id || 'UnknownUser');
}

function safeDisplayName(user, member) {
  if (member && member.displayName) {
    return member.displayName;
  }
  if (user && user.displayName) {
    return user.displayName;
  }
  if (user && user.globalName) {
    return user.globalName;
  }
  return safeUserTag(user);
}

function safeGuildName(guild) {
  if (!guild) {
    return 'DM';
  }
  return guild.name || String(guild.id || 'UnknownGuild');
}

function safeChannelName(channel) {
  if (!channel) {
    return 'unknown-channel';
  }
  return channel.name || String(channel.id || 'unknown-channel');
}

function avatarUrlOfUser(user) {
  if (!user || typeof user.displayAvatarURL !== 'function') {
    return '';
  }
  try {
    return String(user.displayAvatarURL() || '');
  } catch (_) {
    return '';
  }
}

function toIsoDate(value) {
  try {
    if (!value) {
      return new Date().toISOString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value.toISOString === 'function') {
      return value.toISOString();
    }
  } catch (_) {
  }
  return new Date().toISOString();
}

function truncateText(value, limit = 400) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function conversationKeyFromMessage(message) {
  if (!message) {
    return 'unknown';
  }
  const guildId = String(message.guild?.id || 'dm');
  const channelId = String(message.channel?.id || 'unknown');
  if (message.channel?.isDMBased && message.channel.isDMBased()) {
    return `dm:${channelId}`;
  }
  if (message.channel?.isThread && message.channel.isThread()) {
    return `guild:${guildId}:thread:${channelId}`;
  }
  return `guild:${guildId}:channel:${channelId}`;
}

function conversationKeyFromInteraction(interaction) {
  if (!interaction) {
    return '';
  }
  if (interaction.channel?.isDMBased && interaction.channel.isDMBased()) {
    return `dm:${String(interaction.channelId || '')}`;
  }
  return `guild:${String(interaction.guildId || 'dm')}:channel:${String(interaction.channelId || '')}`;
}

function sessionIdFromMessage(message) {
  return `discord:${String(message.guild?.id || 'dm')}:${String(message.channel?.id || 'dm')}:${String(message.author?.id || 'unknown')}`;
}

function sessionIdFromInteraction(interaction) {
  return `discord:${String(interaction.guildId || 'dm')}:${String(interaction.channelId || 'dm')}:${String(interaction.user?.id || 'unknown')}`;
}

function extractMessageText(message) {
  if (!message) {
    return '';
  }
  const rawText = truncateText(message.content || '', 500);
  const attachments = collectMessageAttachments(message);
  if (!attachments.length) {
    return rawText;
  }
  const attachmentLine = attachments.length === 1
    ? `*Send the file ${attachments[0].label}*`
    : `*Send the files ${attachments.map((item) => item.label).join(', ')}*`;
  if (!rawText) {
    return truncateText(attachmentLine, 500);
  }
  return truncateText(`${rawText}\n${attachmentLine}`, 500);
}

function extractAttachmentText(message) {
  const attachments = collectMessageAttachments(message);
  if (!attachments.length) {
    return '';
  }
  if (attachments.length === 1) {
    return `*Send the file ${attachments[0].label}*`;
  }
  return `*Send the files ${attachments.map((item) => item.label).join(', ')}*`;
}

function makeParticipant(user, member) {
  if (!user) {
    return null;
  }
  return {
    uid: String(user.id || ''),
    display_name: safeDisplayName(user, member),
    avatar_url: avatarUrlOfUser(user),
    is_bot: Boolean(user.bot),
  };
}

module.exports = {
  safeUserTag,
  safeDisplayName,
  safeGuildName,
  safeChannelName,
  avatarUrlOfUser,
  toIsoDate,
  truncateText,
  conversationKeyFromMessage,
  conversationKeyFromInteraction,
  sessionIdFromMessage,
  sessionIdFromInteraction,
  collectMessageAttachments,
  extractAttachmentText,
  extractMessageText,
  makeParticipant,
};
