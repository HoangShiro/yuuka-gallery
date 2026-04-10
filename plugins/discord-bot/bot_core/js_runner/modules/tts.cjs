const { safeGuildName, safeUserTag, truncateText } = require('../discord_utils.cjs');

function sanitizeTtsText(text) {
  return String(text || '')
    .replace(/<a?:[^>]+>/gi, ' ')
    .replace(/<[@#:&!]?[^>]+>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^\s<]*$/g, ' ')
    .replace(/<\/?[a-z_][^\s<]*$/gi, ' ')
    .replace(/\*\*[^*]+\*\*/g, ' ')
    .replace(/\*[^*]+\*/g, ' ')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesizeAivisSpeech(runtimeConfig, text) {
  const baseUrl = String(runtimeConfig.tts_engine_base_url || 'http://127.0.0.1:10101').trim().replace(/\/$/, '') || 'http://127.0.0.1:10101';
  const speaker = String(runtimeConfig.tts_speaker_id || '').trim();
  if (!speaker) {
    throw new Error('TTS speaker is not configured.');
  }
  const audioQueryUrl = `${baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speaker)}`;
  const queryResponse = await fetch(audioQueryUrl, {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
  });
  if (!queryResponse.ok) {
    throw new Error(`AivisSpeech audio_query failed: HTTP ${queryResponse.status}`);
  }
  const query = await queryResponse.json();
  const synthesisUrl = `${baseUrl}/synthesis?speaker=${encodeURIComponent(speaker)}`;
  const synthesisResponse = await fetch(synthesisUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'audio/wav',
    },
    body: JSON.stringify(query || {}),
  });
  if (!synthesisResponse.ok) {
    throw new Error(`AivisSpeech synthesis failed: HTTP ${synthesisResponse.status}`);
  }
  const audioBuffer = Buffer.from(await synthesisResponse.arrayBuffer());
  return {
    audioBuffer,
    baseUrl,
    speaker,
  };
}

module.exports = function createTtsModule(deps) {
  const { runtimeConfig, runtimeState, client, logger } = deps;
  const sequenceByKey = new Map();
  let moduleCtx = null;

  function getTargetVoiceState(guildId, actorId, payload) {
    const guild = payload?.guild || client?.guilds?.cache?.get(String(guildId || '')) || null;
    const botVoiceChannelId = String(guild?.members?.me?.voice?.channelId || runtimeState.voiceState.joinedChannelByGuild.get(String(guildId || ''))?.voice_channel_id || '');
    let actorVoiceChannelId = '';
    if (payload?.message?.member?.voice?.channelId) {
      actorVoiceChannelId = String(payload.message.member.voice.channelId || '');
    } else if (payload?.actor?.id && guild?.members?.cache?.get(String(payload.actor.id || ''))?.voice?.channelId) {
      actorVoiceChannelId = String(guild.members.cache.get(String(payload.actor.id || '')).voice.channelId || '');
    } else if (actorId && guild?.members?.cache?.get(String(actorId || ''))?.voice?.channelId) {
      actorVoiceChannelId = String(guild.members.cache.get(String(actorId || '')).voice.channelId || '');
    }
    return {
      guild,
      botVoiceChannelId,
      actorVoiceChannelId,
    };
  }

  async function enqueueSentence(payload, sentence) {
    const guildId = String(payload?.guild_id || payload?.guild?.id || '');
    const actorId = String(payload?.actor_id || payload?.actor?.id || '');
    if (!guildId || !sentence) {
      return;
    }
    const voiceStatus = runtimeState.voiceState.joinedChannelByGuild.get(guildId);
    if (!voiceStatus?.connected) {
      return;
    }
    const { guild, botVoiceChannelId, actorVoiceChannelId } = getTargetVoiceState(guildId, actorId, payload);
    if (!botVoiceChannelId || !actorVoiceChannelId || botVoiceChannelId !== actorVoiceChannelId) {
      return;
    }
    const cleaned = sanitizeTtsText(sentence);
    if (!cleaned) {
      return;
    }
    if (String(runtimeConfig.tts_engine || 'aivisspeech').trim().toLowerCase() !== 'aivisspeech') {
      throw new Error(`Unsupported TTS engine '${runtimeConfig.tts_engine}'.`);
    }
    const { audioBuffer, speaker } = await synthesizeAivisSpeech(runtimeConfig, cleaned);
    const sequenceKey = `${guildId}:${String(payload?.conversation_key || payload?.session_id || 'global')}`;
    const nextSeq = Number(sequenceByKey.get(sequenceKey) || 0) + 1;
    sequenceByKey.set(sequenceKey, nextSeq);
    await moduleCtx.call('voice.play_requested', {
      guild_id: guildId,
      channel: 'speak',
      source: audioBuffer,
      input_type: 'wav',
      metadata: {
        title: `TTS ${nextSeq}: ${truncateText(cleaned, 60)}`,
        tts: true,
        tts_engine: 'aivisspeech',
        tts_speaker_id: speaker,
        tts_speaker_name: String(runtimeConfig.tts_speaker_name || ''),
        tts_speaker_avatar_url: String(runtimeConfig.tts_speaker_avatar_url || ''),
        tts_text: cleaned,
        conversation_key: String(payload?.conversation_key || ''),
        session_id: String(payload?.session_id || ''),
        actor_id: actorId,
      },
    });
    // logger?.log('info', `[TTS] Queued sentence for ${safeGuildName(guild)} / ${safeUserTag(payload?.actor)}: ${truncateText(cleaned, 100)}`);
  }

  return {
    module_id: 'core.tts',
    name: 'Text To Speech',
    setup(ctx) {
      moduleCtx = ctx;
      ctx.registerBrainInstruction('Đọc câu trả lời ra voice speak channel bằng TTS khi bot và người dùng ở cùng voice channel.');
      ctx.registerBrainTool({
        tool_id: 'tts_speak',
        title: 'Speak text in voice channel',
        description: 'Tạo audio TTS và đưa vào speak channel của voice module.',
        call_event: 'tts.speak_requested',
        input_schema: {
          guild_id: 'string',
          actor_id: 'string?',
          text: 'string',
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'tts_speak',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          if (result?.ok === false) {
            return {
              content: `Không thể speak: ${String(result?.reason || 'unknown_reason')}`,
              title: 'TTS',
              tone: 'warning',
              user: actor,
            };
          }
          return {
            content: 'Đã nhận yêu cầu TTS.',
            title: 'TTS',
            tone: 'success',
            user: actor,
          };
        },
      });

      ctx.subscribe('chat.reply_sentence', async (payload) => {
        const sentence = String(payload?.text || '').trim();
        if (!sentence) {
          return;
        }
        await enqueueSentence(payload, sentence);
      });

      ctx.subscribe('chat.reply_completed', async (payload) => {
        return payload;
      });

      ctx.subscribe('tts.speak_requested', async (payload) => {
        const sentence = String(payload?.text || '').trim();
        if (!sentence) {
          return { ok: false, reason: 'empty_text' };
        }
        await enqueueSentence(payload, sentence);
        return { ok: true };
      });

      ctx.subscribe('voice.track_error', async (payload) => {
        if (!payload?.item?.metadata?.tts) {
          return;
        }
        logger?.log('warning', `[TTS] Voice track error on ${payload.guild_id || 'unknown'}: ${payload.error || 'Unknown error'}`);
      });

      ctx.publish('context.event_fact', {
        scope: 'tts',
        event_name: 'tts.module_ready',
        value: `engine:${String(runtimeConfig.tts_engine || 'aivisspeech')}`,
      });
    },
  };
};
