const { buildDiscordContextBundle } = require('./context_builder.cjs');
const { conversationKeyFromInteraction, conversationKeyFromMessage } = require('./discord_utils.cjs');

function parseBridgeResponse(resp) {
  if (!resp || typeof resp !== 'object') {
    return { ok: false, error: 'Invalid bridge response.' };
  }
  if (resp.error) {
    return { ok: false, error: String(resp.error) };
  }
  let reply = String(resp.response || '').trim();
  // Strip internal system tags and any immediate trailing punctuation
  reply = reply.replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>[.,;]?\s*/gi, '').trim();
  if (!reply) {
    return { ok: false, error: 'Bridge returned empty response.' };
  }
  return {
    ok: true,
    reply,
    session_id: resp.session_id || '',
    llm_input: resp.llm_input || [],
    raw_response: resp.response || '',
  };
}

async function requestChatBridge(runtimeConfig, payload) {
  const bridgeUrl = String(runtimeConfig.chat_bridge_url || '').trim();
  if (!bridgeUrl) {
    throw new Error('chat_bridge_url is not configured.');
  }
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in current Node runtime.');
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  const bridgeKey = String(runtimeConfig.chat_bridge_key || '').trim();
  if (bridgeKey) {
    headers['X-Discord-Bot-Bridge-Key'] = bridgeKey;
  }

  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {}),
  });

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_err) {
    body = { error: text || `Bridge HTTP ${response.status}` };
  }

  if (!response.ok) {
    const err = body && body.error ? String(body.error) : `Bridge HTTP ${response.status}`;
    throw new Error(err);
  }

  return body;
}

async function requestBrainReply(runtimeConfig, client, state, source = {}) {
  const characterId = String(runtimeConfig.chat_character_id || '').trim();
  if (!characterId) {
    throw new Error('Chat module chưa được cấu hình `chat_character_id`.');
  }
  const prompt = String(source.prompt || '').trim();
  if (!prompt) {
    throw new Error('Prompt is empty.');
  }
  const message = source.message || null;
  const interaction = source.interaction || null;
  const conversationKey = String(
    source.conversation_key
      || (message ? conversationKeyFromMessage(message) : '')
      || (interaction ? conversationKeyFromInteraction(interaction) : '')
      || ''
  ).trim();
  const actorId = String(source.actor?.id || message?.author?.id || interaction?.user?.id || 'unknown');
  const sessionId = source.session_id || `discord:${String(source.guild?.id || message?.guild?.id || interaction?.guildId || 'dm')}:${String(source.channel?.id || message?.channel?.id || interaction?.channelId || 'dm')}:${actorId}`;
  const payload = {
    user_hash: String(runtimeConfig.user_hash || ''),
    character_id: characterId,
    session_id: sessionId,
    user_message: prompt,
    model: String(runtimeConfig.chat_model || '').trim() || undefined,
    discord_context: buildDiscordContextBundle(client, state, {
      ...source,
      conversation_key: conversationKey,
      actor_uid: actorId,
    }),
  };
  const bridgeRaw = await requestChatBridge(runtimeConfig, payload);
  const bridge = parseBridgeResponse(bridgeRaw);
  if (!bridge.ok) {
    throw new Error(bridge.error || 'Bridge request failed.');
  }
  return {
    reply: bridge.reply,
    session_id: bridge.session_id || sessionId,
    conversation_key: conversationKey,
    llm_input: bridge.llm_input,
    raw_response: bridge.raw_response,
  };
}

module.exports = {
  parseBridgeResponse,
  requestChatBridge,
  requestBrainReply,
};
