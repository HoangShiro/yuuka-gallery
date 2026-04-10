const { buildDiscordContextBundle } = require('./context_builder.cjs');
const { conversationKeyFromInteraction, conversationKeyFromMessage } = require('./discord_utils.cjs');

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
function parseBridgeResponse(resp) {
  if (!resp || typeof resp !== 'object') {
    return { ok: false, error: 'Invalid bridge response.' };
  }
  if (resp.error) {
    return { ok: false, error: String(resp.error) };
  }
  let reply = String(resp.response || '').trim();
  let secondaryReply = '';

  // Structure-based detection: find any wrapper tag that contains <message> children.
  // This handles <discord-reply>, <discursion-reply>, or any hallucinated tag name.
  const envelopeMatch = reply.match(/<([a-z][a-z0-9_-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/i);
  const envelopeBody = envelopeMatch ? envelopeMatch[2] : reply;
  const messageMatches = [...envelopeBody.matchAll(/<message\b[^>]*>([\s\S]*?)<\/message>/gi)];
  if (messageMatches.length > 0) {
    const primaryMessage = String(messageMatches[0][1] || '').trim();
    const secondaryMessage = messageMatches.length > 1 ? String(messageMatches[1][1] || '').trim() : '';
    reply = decodeHtmlEntities(primaryMessage);
    secondaryReply = decodeHtmlEntities(secondaryMessage);
  }

  // Extract call_commands (plural) and maintain call_command (singular) for compatibility
  let callCommands = [];
  const fullContent = resp.response || '';
  const commandMatches = [...fullContent.matchAll(/<call_command>([\s\S]*?)<\/call_command>/gi)];
  
  for (const match of commandMatches) {
    const rawCall = String(match[1] || '').trim();
    if (rawCall && rawCall.toLowerCase() !== 'null') {
      try {
        callCommands.push(JSON.parse(rawCall));
      } catch (e) {
        callCommands.push(rawCall); // fallback
      }
    }
  }

  const callCommand = callCommands.length > 0 ? callCommands[0] : null;

  // Detect [IGNORE] keyword within the response (specifically within discord-reply block if present)
  let ignore = false;
  if (envelopeMatch && envelopeMatch[1].toLowerCase() === 'discord-reply') {
    ignore = envelopeMatch[2].includes('[IGNORE]');
  } else {
    ignore = fullContent.includes('[IGNORE]');
  }

  // Strip internal system tags and any immediate trailing punctuation
  reply = reply.replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>[.,;]?\s*/gi, '').trim();
  secondaryReply = secondaryReply.replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>[.,;]?\s*/gi, '').trim();
  
  if (!reply && !ignore) {
    return { ok: false, error: 'Bridge returned empty response.' };
  }
  return {
    ok: true,
    reply,
    secondary_reply: secondaryReply,
    ignore,
    call_command: callCommand,
    call_commands: callCommands,
    session_id: resp.session_id || '',
    llm_input: resp.llm_input || [],
    raw_response: resp.response || '',
  };
}

function createBridgePayload(runtimeConfig, client, state, source = {}) {
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
  return {
    sessionId,
    conversationKey,
    payload: {
      user_hash: String(runtimeConfig.user_hash || ''),
      character_id: characterId,
      session_id: sessionId,
      user_message: prompt,
      record_only: Boolean(source.record_only),
      model: String(runtimeConfig.chat_model || '').trim() || undefined,
      primary_language: String(runtimeConfig.chat_primary_language || 'English').trim() || 'English',
      secondary_language: String(runtimeConfig.chat_secondary_language || 'Japanese').trim() || 'Japanese',
      discord_context: buildDiscordContextBundle(client, state, {
        ...source,
        conversation_key: conversationKey,
        actor_uid: actorId,
      }, runtimeConfig),
    },
  };
}

async function readNdjsonStream(response, onEvent) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Bridge streaming is not available in current runtime.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = String(line || '').trim();
      if (!trimmed) {
        continue;
      }
      let payload = null;
      try {
        payload = JSON.parse(trimmed);
      } catch (_err) {
        continue;
      }
      if (payload) {
        await onEvent(payload);
      }
    }
  }
  if (buffer.trim()) {
    try {
      await onEvent(JSON.parse(buffer.trim()));
    } catch (_err) {
    }
  }
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

async function streamBrainReply(runtimeConfig, client, state, source = {}, handlers = {}) {
  const bridgeUrl = String(runtimeConfig.chat_bridge_url || '').trim();
  if (!bridgeUrl) {
    throw new Error('chat_bridge_url is not configured.');
  }
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in current Node runtime.');
  }
  const { payload, sessionId, conversationKey } = createBridgePayload(runtimeConfig, client, state, source);
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/x-ndjson',
  };
  const bridgeKey = String(runtimeConfig.chat_bridge_key || '').trim();
  if (bridgeKey) {
    headers['X-Discord-Bot-Bridge-Key'] = bridgeKey;
  }
  const response = await fetch(bridgeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Bridge HTTP ${response.status}`);
  }
  let finalPayload = null;
  await readNdjsonStream(response, async (event) => {
    const eventName = String(event?.event || '').trim();
    if (eventName === 'delta' && typeof handlers.onDelta === 'function') {
      await handlers.onDelta(String(event.content || ''));
      return;
    }
    if (eventName === 'error') {
      throw new Error(String(event.error || 'Bridge streaming failed.'));
    }
    if (eventName === 'complete') {
      finalPayload = event;
      if (typeof handlers.onComplete === 'function') {
        await handlers.onComplete(event);
      }
    }
  });
  const bridge = parseBridgeResponse(finalPayload || {});
  if (!bridge.ok) {
    throw new Error(bridge.error || 'Bridge request failed.');
  }
  return {
    reply: bridge.reply,
    secondary_reply: bridge.secondary_reply || '',
    ignore: bridge.ignore,
    session_id: bridge.session_id || sessionId,
    conversation_key: conversationKey,
    llm_input: bridge.llm_input,
    raw_response: bridge.raw_response,
    call_command: bridge.call_command,
    call_commands: bridge.call_commands || [],
  };
}

async function requestBrainReply(runtimeConfig, client, state, source = {}) {
  const { payload, sessionId, conversationKey } = createBridgePayload(runtimeConfig, client, state, source);
  const bridgeRaw = await requestChatBridge(runtimeConfig, payload);
  const bridge = parseBridgeResponse(bridgeRaw);
  if (!bridge.ok) {
    throw new Error(bridge.error || 'Bridge request failed.');
  }
  return {
    reply: bridge.reply,
    secondary_reply: bridge.secondary_reply || '',
    ignore: bridge.ignore,
    session_id: bridge.session_id || sessionId,
    conversation_key: conversationKey,
    llm_input: bridge.llm_input,
    raw_response: bridge.raw_response,
    call_command: bridge.call_command,
    call_commands: bridge.call_commands || [],
  };
}

module.exports = {
  parseBridgeResponse,
  requestChatBridge,
  streamBrainReply,
  requestBrainReply,
};
