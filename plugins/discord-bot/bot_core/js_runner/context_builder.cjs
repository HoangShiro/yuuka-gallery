const {
  avatarUrlOfUser,
  conversationKeyFromMessage,
  safeChannelName,
  safeGuildName,
  safeUserTag,
  safeDisplayName,
  toIsoDate,
  truncateText,
} = require('./discord_utils.cjs');
const { collectBrainAbilities, selectContextFacts } = require('./runtime_state.cjs');

function buildInfoContext(client, source = {}) {
  const message = source.message || null;
  const interaction = source.interaction || null;
  const channel = source.channel || message?.channel || interaction?.channel || null;
  const guild = source.guild || message?.guild || interaction?.guild || null;
  const actor = source.actor || message?.author || interaction?.user || null;
  const recentVoiceFact = source.voice_fact || null;
  const botVoiceChannel = guild?.members?.me?.voice?.channel || null;
  const userVoiceChannel = actor && guild ? guild.members?.cache?.get(actor.id)?.voice?.channel || null : null;
  const guilds = client.guilds?.cache ? [...client.guilds.cache.values()].slice(0, 8) : [];
  const accessibleChannels = guild?.channels?.cache
    ? [...guild.channels.cache.values()]
        .filter((item) => item && typeof item.isTextBased === 'function' && item.isTextBased())
        .slice(0, 10)
        .map((item) => ({ id: String(item.id || ''), name: safeChannelName(item), type: String(item.type || '') }))
    : [];
  return {
    actor: actor
      ? {
          uid: String(actor.id || ''),
          display_name: safeUserTag(actor),
          avatar_url: avatarUrlOfUser(actor),
          is_bot: Boolean(actor.bot),
          timestamp: toIsoDate(source.timestamp || message?.createdAt || interaction?.createdAt || new Date()),
        }
      : null,
    channel: channel
      ? {
          channel_id: String(channel.id || ''),
          channel_name: safeChannelName(channel),
          channel_type: String(channel.type || ''),
          is_nsfw: Boolean(typeof channel.nsfw === 'boolean' ? channel.nsfw : false),
        }
      : null,
    guild: guild
      ? {
          guild_id: String(guild.id || ''),
          guild_name: safeGuildName(guild),
        }
      : null,
    bot_voice: botVoiceChannel
      ? {
          channel_id: String(botVoiceChannel.id || ''),
          channel_name: safeChannelName(botVoiceChannel),
          members: Array.isArray(botVoiceChannel.members) ? botVoiceChannel.members : (botVoiceChannel.members ? [...botVoiceChannel.members.values()] : [])
            .slice(0, 20).map((m) => ({ uid: String(m.id || m.user?.id || ''), display_name: safeDisplayName(m.user || m, m), is_bot: Boolean(m.user?.bot || m.bot) })),
        }
      : recentVoiceFact
        ? {
            channel_id: String(recentVoiceFact.voice_channel_id || ''),
            channel_name: String(recentVoiceFact.voice_channel_name || recentVoiceFact.voice_channel_id || ''),
            members: Array.isArray(recentVoiceFact.members) ? recentVoiceFact.members : [],
          }
      : null,
    user_voice: userVoiceChannel
      ? {
          channel_id: String(userVoiceChannel.id || ''),
          channel_name: safeChannelName(userVoiceChannel),
        }
      : null,
    available_guilds: guilds.map((item) => ({ id: String(item.id || ''), name: safeGuildName(item) })),
    accessible_channels: accessibleChannels,
  };
}

function buildHistoryContext(state, source = {}) {
  const message = source.message || null;
  const conversationKey = String(source.conversation_key || (message ? conversationKeyFromMessage(message) : '') || '').trim();
  if (!conversationKey) {
    return { mode: 'unknown', primary: [], related_channels: [] };
  }
  const turns = state.memo.conversationTurns.get(conversationKey) || [];
  const primary = turns.slice(-8).map((item) => ({
    at: item.at,
    actor_uid: item.actor_uid,
    actor_name: item.actor_name,
    text: item.text,
    kind: item.kind,
  }));
  const relatedChannels = [...state.memo.conversationSummaries.values()]
    .filter((item) => item.conversation_key !== conversationKey)
    .slice(-2)
    .map((item) => ({
      conversation_key: item.conversation_key,
      summary: truncateText(item.summary, 180),
      participant_uids: item.participant_uids,
    }));
  const mode = conversationKey.startsWith('dm:') ? 'private' : 'public';
  return { mode, primary, related_channels: relatedChannels };
}

function buildMemoContext(state, source = {}) {
  const actorUid = String(source.actor_uid || source.message?.author?.id || source.interaction?.user?.id || '').trim();
  const conversationKey = String(source.conversation_key || (source.message ? conversationKeyFromMessage(source.message) : '') || '').trim();
  const conversationSummary = conversationKey ? state.memo.conversationSummaries.get(conversationKey) || null : null;
  const relatedActorUids = conversationSummary?.participant_uids || (actorUid ? [actorUid] : []);
  const actorSummaries = relatedActorUids
    .slice(-3)
    .map((uid) => state.memo.actorSummaries.get(uid))
    .filter(Boolean)
    .map((item) => ({ actor_uid: item.actor_uid, actor_name: item.actor_name, summary: item.summary, updated_at: item.updated_at }));
  const actorGlobal = actorUid ? state.memo.actorSummaries.get(actorUid) || null : null;
  return {
    conversation_summary: conversationSummary,
    actor_summaries: actorSummaries,
    actor_global_summary: actorGlobal,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAbilitiesHtml(abilities = { modules: [] }, commandDefinitions = []) {
  const modules = Array.isArray(abilities.modules) ? abilities.modules : [];
  const commands = Array.isArray(commandDefinitions) ? commandDefinitions : [];
  if (!modules.length && !commands.length) {
    return '<YOUR ABILITIES>No extra abilities registered.</YOUR ABILITIES>';
  }
  const lines = ['<YOUR ABILITIES>'];
  let hasTools = false;
  for (const moduleEntry of modules) {
    const moduleId = escapeHtml(moduleEntry.module_id || 'unknown');
    lines.push(`\n<MODULE id="${moduleId}">`);
    const instructions = Array.isArray(moduleEntry.instructions) ? moduleEntry.instructions : [];
    if (instructions.length) {
      lines.push('Instructions:');
      for (const text of instructions) {
        lines.push(`- ${escapeHtml(text)}`);
      }
    }
    const enabledTools = (Array.isArray(moduleEntry.tools) ? moduleEntry.tools : []).filter((item) => item && item.enabled);
    if (enabledTools.length) {
      lines.push('Internal Tools (Callable by you):');
      for (const tool of enabledTools) {
        hasTools = true;
        const schemaString = tool.input_schema ? JSON.stringify(tool.input_schema) : '{}';
        lines.push(`- ${escapeHtml(tool.tool_id)}: ${escapeHtml(tool.title || '')} - ${escapeHtml(tool.description || '')}`);
        lines.push(`  Schema: ${schemaString}`);
      }
    }
    lines.push('</MODULE>');
  }
  if (hasTools) {
    lines.push('\n<TOOL_CALL_TUTORIAL>');
    lines.push('To use Internal Tools, you MUST return strict JSON payloads enclosed in `<call_command>...</call_command>` tags at the very end of your response.');
    lines.push('Format: <call_command>{"tool_id": "tool_name", "payload": {"arg1": "val"}}</call_command>');
    lines.push('You CAN execute multiple tools at once by providing multiple `<call_command>` blocks.');
    lines.push('If you DO NOT want to call any tool, you MUST return exactly: <call_command>Null</call_command>');
    lines.push('</TOOL_CALL_TUTORIAL>');
  }
  lines.push('</YOUR ABILITIES>');
  return lines.join('\n');
}

function buildDiscordContextBundle(client, state, source = {}, runtimeConfig = {}) {
  const message = source.message || null;
  const interaction = source.interaction || null;
  const conversationKey = String(source.conversation_key || (message ? conversationKeyFromMessage(message) : '') || '').trim();
  const scope = {
    guild_id: String(source.guild?.id || message?.guild?.id || interaction?.guild?.id || ''),
    channel_id: String(source.channel?.id || message?.channel?.id || interaction?.channel?.id || ''),
    author_id: String(source.actor?.id || message?.author?.id || interaction?.user?.id || source.actor_uid || ''),
  };
  const selectedFacts = selectContextFacts(state, scope, { limit: 8 });
  const abilities = collectBrainAbilities(state, runtimeConfig);
  const voiceFact = selectedFacts
    .map((item) => item?.payload || null)
    .find((payload) => payload && (payload.voice_channel_id || payload.voice_channel_name));
  const { resolvePolicySetting } = require('./runtime_state.cjs');
  const voiceStatus = state?.voiceState?.adapter ? state.voiceState.adapter.getPlayerStatus(scope.guild_id) : null;
  if (voiceStatus) {
    voiceStatus.music_volume = resolvePolicySetting(state, 'core.voice.volumes', 'music_volume', 50);
    voiceStatus.speak_volume = resolvePolicySetting(state, 'core.voice.volumes', 'speak_volume', 100);
  }

  return {
    conversation_key: conversationKey,
    session_mode: conversationKey.startsWith('dm:') ? 'private' : 'public',
    history_context: buildHistoryContext(state, { ...source, conversation_key: conversationKey }),
    long_memo_context: buildMemoContext(state, { ...source, conversation_key: conversationKey }),
    info_context: {
      ...buildInfoContext(client, { ...source, voice_fact: voiceFact }),
      voice_status: voiceStatus,
    },
    selected_facts: selectedFacts.map((item) => ({
      fact_type: item.fact_type,
      event_name: item.event_name,
      guild_id: item.guild_id,
      channel_id: item.channel_id,
      author_id: item.author_id,
      key: item.key,
      value: truncateText(item.value, 180),
      score: item.score,
      created_at: item.created_at,
    })),
    abilities_context: {
      abilities_html: buildAbilitiesHtml(abilities, state.commandDefinitions),
      tools: abilities.tools_for_llm,
      modules: abilities.modules,
    },
    event_context: source.event_context || null,
    base: {
      guild_id: scope.guild_id,
      guild_name: safeGuildName(source.guild || message?.guild || interaction?.guild),
      channel_id: scope.channel_id,
      channel_name: safeChannelName(source.channel || message?.channel || interaction?.channel),
      author_id: scope.author_id,
      author_tag: safeUserTag(source.actor || message?.author || interaction?.user),
      author_name: safeDisplayName(source.actor || message?.author || interaction?.user, message?.member || interaction?.member),
      message_id: String(message?.id || ''),
      interaction_name: interaction?.commandName ? String(interaction.commandName) : '',
    },
  };
}

module.exports = {
  buildInfoContext,
  buildHistoryContext,
  buildMemoContext,
  buildDiscordContextBundle,
};
