const { SlashCommandBuilder } = require('discord.js');
const { requestBrainReply, requestChatBridge, streamBrainReply } = require('../chat_bridge.cjs');
const { buildDiscordContextBundle } = require('../context_builder.cjs');
const { normalizeDiscordPayload, replyToInteraction, replyToMessage } = require('../interaction_helpers.cjs');
const { buildToolReplyPayload, buildToolErrorPayload, buildUnknownToolPayload } = require('../tool_reply_helpers.cjs');
const { clearMemoForConversation, clearActorSummary } = require('../memo_store.cjs');
const {
  addCommandDefinition,
  isPolicyEnabled,
  matchesPolicyChannelAllowlist,
  registerPolicyDefinition,
} = require('../runtime_state.cjs');
const {
  collectMessageAttachments,
  conversationKeyFromInteraction,
  conversationKeyFromMessage,
  extractAttachmentText,
  extractMessageText,
  safeChannelName,
  safeDisplayName,
  safeGuildName,
  safeUserTag,
  sessionIdFromInteraction,
  sessionIdFromMessage,
} = require('../discord_utils.cjs');

const POLICY_MESSAGE_COMMANDS = 'core.chat.message_commands';
const POLICY_NATURAL_CHAT = 'core.chat.natural_chat';
const POLICY_APP_RESET = 'core.chat.app_command_reset';
const MAX_TOOL_FOLLOW_UP_ATTEMPTS = 2;

function isToolFollowUpRequested(payload) {
  return payload?.followup === true;
}

function summarizeToolIssue(toolId, payload) {
  const normalizedToolId = String(toolId || '').trim() || 'unknown_tool';
  const tone = String(payload?.tone || 'warning').trim().toLowerCase() || 'warning';
  const content = String(payload?.content || '').trim();
  const llmHint = String(payload?.llm_followup_hint || '').trim();
  return {
    toolId: normalizedToolId,
    tone,
    content,
    llmHint,
  };
}

function buildToolIssueFollowUpPrompt(issueSummaries = [], attempt = 1) {
  const details = issueSummaries
    .filter(Boolean)
    .slice(0, 6)
    .map((item) => {
      const toolId = String(item?.toolId || '').trim() || 'unknown_tool';
      const tone = String(item?.tone || 'warning').trim() || 'warning';
      const content = String(item?.content || '').trim();
      const llmHint = String(item?.llmHint || '').trim();
      const resultBlock = content ? `Result:\n---\n${content}\n---` : 'Result: (empty)';
      const hintBlock = llmHint ? `Instruction:\n${llmHint}` : '';
      return [`- ${toolId} (${tone})`, resultBlock, hintBlock].filter(Boolean).join('\n');
    })
    .join('\n\n');
  const detailBlock = details ? `\nTool follow-up details:\n${details}\n` : '';
  return [
    `[System] Follow-up tool attempt ${attempt}/${MAX_TOOL_FOLLOW_UP_ATTEMPTS}.`,
    'One or more tools requested follow-up.',
    detailBlock.trim(),
    'Continue handling the user\'s most recent request.',
    'If needed, select another appropriate tool and call it again with <call_command>.',
    'Prioritize the most reasonable next step based on the latest tool results.',
  ].filter(Boolean).join('\n');
}

function buildDiscordReplyText(bridge, runtimeConfig) {
  const primaryReply = String(bridge?.reply || '').trim();
  const secondaryReply = String(bridge?.secondary_reply || '').trim();
  const sendSecondaryToChannel = Boolean(runtimeConfig?.chat_secondary_to_channel);
  if (!sendSecondaryToChannel || !secondaryReply) {
    return primaryReply;
  }
  return `${primaryReply}\n\n${secondaryReply}`.trim();
}

function wantsNaturalReply(message, runtimeState) {
  if (!message || message.author?.bot) {
    return false;
  }
  const raw = String(message.content || '').trim();
  const normalizedText = extractMessageText(message);
  if (!normalizedText || raw.startsWith('!')) {
    return false;
  }
  if (!isPolicyEnabled(runtimeState, POLICY_NATURAL_CHAT)) {
    return false;
  }
  return matchesPolicyChannelAllowlist(runtimeState, POLICY_NATURAL_CHAT, message.channel?.id);
}

function splitCompletedSentences(buffer) {
  const sentences = [];
  const working = String(buffer || '');
  const boundary = /([.!?。！？…]+["'”’）\]\s]*|\n+)/g;
  let match = null;
  let lastIndex = 0;
  while ((match = boundary.exec(working)) !== null) {
    const endIndex = boundary.lastIndex;
    const sentence = working.slice(lastIndex, endIndex).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    lastIndex = endIndex;
  }
  return {
    sentences,
    rest: working.slice(lastIndex),
  };
}

function extractVisibleMessages(rawText) {
  const raw = String(rawText || '');
  if (!raw.includes('<')) {
    return [raw, ''];
  }
  const messages = ['', ''];
  const tagRegex = /<[^>]*>/g;
  let cursor = 0;
  let currentMessageIndex = -1;
  let messageOpenCount = 0;
  let sawMessageTag = false;
  let match = null;
  while ((match = tagRegex.exec(raw)) !== null) {
    const tagStart = match.index;
    const tagEnd = tagRegex.lastIndex;
    const textChunk = raw.slice(cursor, tagStart);
    if (textChunk) {
      const targetIndex = currentMessageIndex >= 0 ? currentMessageIndex : (!sawMessageTag ? 0 : -1);
      if (targetIndex >= 0 && targetIndex < messages.length) {
        messages[targetIndex] += textChunk;
      }
    }
    const tag = String(match[0] || '').toLowerCase();
    if (/^<message\b/.test(tag)) {
      sawMessageTag = true;
      currentMessageIndex = Math.min(messageOpenCount, 1);
      messageOpenCount += 1;
    } else if (tag === '</message>') {
      currentMessageIndex = -1;
    }
    cursor = tagEnd;
  }
  const tail = raw.slice(cursor);
  if (tail) {
    const targetIndex = currentMessageIndex >= 0 ? currentMessageIndex : (!sawMessageTag ? 0 : -1);
    if (targetIndex >= 0 && targetIndex < messages.length) {
      messages[targetIndex] += tail;
    }
  }
  return messages;
}

function stripStreamMarkupFragments(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/<[^\s<]*$/g, '')
    .replace(/<\/?[a-z_][^\s<]*$/gi, '')
    .trim();
}

const MUSIC_URL_REGEX = /https?:\/\/(?:www\.|music\.)?(?:youtube\.com|youtu\.be|soundcloud\.com)[^\s>"]+/gi;

function collectMusicUrls(text) {
  const matches = String(text || '').match(MUSIC_URL_REGEX);
  if (!matches || matches.length === 0) {
    return [];
  }
  return [...new Set(matches.map((u) => String(u || '').trim()).filter(Boolean))];
}

function buildResolvedTrackContextLines(resolvedTracks = []) {
  const lines = [];
  for (const item of resolvedTracks) {
    const title = String(item?.title || '').trim();
    const uploader = String(item?.uploader || '').trim();
    if (!title) continue;
    if (uploader) {
      lines.push(`("${title}" by "${uploader}")`);
    } else {
      lines.push(`("${title}")`);
    }
  }
  return lines;
}

function buildAttachmentEventContext(message) {
  const audioTypes = new Set(['wav', 'wave', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm', 'mp4', 'mpeg']);
  return collectMessageAttachments(message).slice(0, 4).map((item) => ({
    name: item.name,
    content_type: item.content_type || item.type,
    type: item.type,
    url: item.url,
    size: item.size,
    is_audio: (() => {
      const normalizedType = String(item.content_type || item.type || '').toLowerCase();
      if (normalizedType.startsWith('audio/')) {
        return true;
      }
      return audioTypes.has(normalizedType);
    })(),
  }));
}

function createReplySentenceEmitter(ctx, runtimeConfig, sourceMeta = {}) {
  const textSource = String(runtimeConfig?.tts_text_source || 'secondary').trim().toLowerCase() || 'secondary';
  let raw = '';
  let consumedLength = 0;
  let sentenceBuffer = '';
  /** @type {Promise} */
  let _chain = Promise.resolve();

  function _emitSentence(text, extra = {}) {
    const payload = { ...sourceMeta, text_source: textSource, text, ...extra };
    // Chain sequentially to guarantee TTS synthesis order.
    _chain = _chain.then(() => ctx.call('chat.reply_sentence', payload)).catch(() => {});
  }

  return {
    push(delta) {
      raw += String(delta || '');
      const [primaryText, secondaryText] = extractVisibleMessages(raw);
      const visible = stripStreamMarkupFragments(textSource === 'primary' ? primaryText : (secondaryText || ''));
      if (!visible || visible.length <= consumedLength) {
        return;
      }
      sentenceBuffer += visible.slice(consumedLength);
      consumedLength = visible.length;
      const { sentences, rest } = splitCompletedSentences(sentenceBuffer);
      sentenceBuffer = rest;
      for (const sentence of sentences) {
        _emitSentence(sentence);
      }
    },
    flush(finalBridge) {
      const finalText = stripStreamMarkupFragments(textSource === 'primary'
        ? String(finalBridge?.reply || '')
        : String(finalBridge?.secondary_reply || finalBridge?.reply || ''));
      if (finalText.length > consumedLength) {
        sentenceBuffer += finalText.slice(consumedLength);
      }
      const tail = sentenceBuffer.trim();
      if (tail) {
        _emitSentence(tail, { final: true });
      }
      sentenceBuffer = '';
      consumedLength = finalText.length;
    },
    /** Await all pending TTS synthesis promises. Call before sending the Discord reply. */
    async drain() {
      await _chain;
    },
  };
}

/**
 * Ensure the bot's nickname in a guild matches the configured character name.
 * Runs as a fire-and-forget side effect — errors are silently swallowed.
 */
async function ensureNickname(guild, client, characterName) {
  if (!guild || !client || !characterName) {
    return;
  }
  try {
    const me = guild.members?.me || (client.user && await guild.members.fetch(client.user.id).catch(() => null));
    if (!me) {
      return;
    }
    const currentNick = me.nickname || '';
    
    // Discord limits nickname to 32 characters.
    let targetNick = characterName;
    if (targetNick.length > 32) {
      // Attempt to remove series name in parentheses elegantly first
      targetNick = targetNick.replace(/\s*\([^)]*\)/g, '').trim();
    }

    // Capitalize the first letter of each word (Title Case)
    targetNick = targetNick.split(/\s+/).map(word => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');

    // Hard truncate if still too long
    if (targetNick.length > 32) {
      targetNick = targetNick.slice(0, 31) + '…';
    }

    if (currentNick === targetNick) {
      console.log(`[Nickname Sync] Nickname is already "${targetNick}" in guild ${guild.name}.`);
      return;
    }
    console.log(`[Nickname Sync] Changing nickname from "${currentNick}" to "${targetNick}" in guild ${guild.name}...`);
    await me.setNickname(targetNick).catch((err) => {
      console.log(`[Nickname Sync Error] ${err.message}`);
    });
  } catch (err) {
    console.log(`[Nickname Sync Error] ${err.message || String(err)}`);
  }
}

module.exports = function createChatModule(deps) {
  const { runtimeConfig, runtimeState, client } = deps;
  return {
    module_id: 'core.chat',
    name: 'Character',
    setup(ctx) {
      ctx.registerBrainInstruction('Dùng character bridge để sinh phản hồi theo persona và lịch sử ngữ cảnh Discord.');
      ctx.registerBrainInstruction('Có thể reset phiên chat hoặc xóa fact của actor khi người dùng yêu cầu.');
      ctx.registerBrainInstruction('Bạn có thể thực thi nhiều lệnh cùng một lúc bằng cách sử dụng nhiều thẻ <call_command> trong cùng một phản hồi.');
      ctx.registerBrainTool({
        tool_id: 'chat_reset_session',
        title: 'Reset chat session',
        description: 'Reset phiên chat theo channel hiện tại thông qua bridge.',
        call_event: 'chat.reset_requested',
        input_schema: {
          guild_id: 'string',
          channel_id: 'string',
          actor_id: 'string',
          reason: 'string?',
        },
      });
      ctx.registerBrainTool({
        tool_id: 'chat_reset_actor_fact',
        title: 'Reset actor facts',
        description: 'Xóa tóm tắt/facts của một actor trong bộ nhớ.',
        call_event: 'chat.fact_reset_requested',
        input_schema: {
          actor_id: 'string',
          guild_id: 'string?',
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'chat_reset_session',
        build_payload({ actor }) {
          return {
            content: 'Đã reset session chat cho ngữ cảnh hiện tại.',
            title: 'Chat',
            tone: 'success',
            user: actor,
          };
        },
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'chat_reset_actor_fact',
        build_payload({ actor }) {
          return {
            content: 'Đã xóa thông tin tóm tắt/facts của actor.',
            title: 'Chat',
            tone: 'success',
            user: actor,
          };
        },
      });
      registerPolicyDefinition(runtimeState, 'core.chat', {
        policy_id: POLICY_NATURAL_CHAT,
        group_id: 'chat',
        group_name: 'Chat',
        title: 'Natural chat in allowed channels',
        description: 'Allow the bot to reply naturally to normal messages in configured channels without requiring a slash command.',
        default_enabled: false,
        settings: {
          allowed_channel_ids: '',
        },
      });
      registerPolicyDefinition(runtimeState, 'core.chat', {
        policy_id: POLICY_MESSAGE_COMMANDS,
        group_id: 'chat',
        group_name: 'Chat',
        title: 'Message chat commands',
        description: 'Allow message-based chat commands such as !chat and !chat-reset.',
        default_enabled: true,
      });
      registerPolicyDefinition(runtimeState, 'core.chat', {
        policy_id: POLICY_APP_RESET,
        group_id: 'chat',
        group_name: 'Chat',
        title: 'App command reset',
        description: 'Allow utility reset through /chat-reset while keeping natural chat separate from app commands.',
        default_enabled: true,
      });
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('chat-reset')
        .setDescription('Reset the current chat session for this channel'));
      addCommandDefinition(runtimeState, new SlashCommandBuilder()
        .setName('fact-reset')
        .setDescription('Reset your personal facts/summaries in my memory'));

      ctx.subscribe('chat.reset_requested', async (payload) => {
        const characterId = String(runtimeConfig.chat_character_id || '').trim();
        if (!characterId) {
          throw new Error('Chat module chưa được cấu hình `chat_character_id`.');
        }
        const guildId = String(payload?.guild_id || payload?.guild?.id || 'dm');
        const channelId = String(payload?.channel_id || payload?.channel?.id || 'dm');
        const actorId = String(payload?.actor_id || payload?.actor_uid || 'system');
        const sessionId = `discord:${guildId}:${channelId}:${actorId}`;
        const resetPayload = {
          user_hash: String(runtimeConfig.user_hash || ''),
          character_id: characterId,
          session_id: sessionId,
          reset_session: true,
          discord_context: buildDiscordContextBundle(client, runtimeState, {
            guild: payload?.guild || null,
            channel: payload?.channel || null,
            actor: payload?.actor || null,
            event_context: { event_type: 'tool.chat_reset', trigger: payload?.reason || 'brain_tool' },
          }, runtimeConfig),
        };
        clearMemoForConversation(runtimeState, String(payload?.conversation_key || `guild:${guildId}:channel:${channelId}`));
        await requestChatBridge(runtimeConfig, resetPayload);
        return {
          ok: true,
          session_id: sessionId,
        };
      });

      ctx.subscribe('chat.fact_reset_requested', async (payload) => {
        const actorId = String(payload?.actor_id || '').trim();
        if (!actorId) {
          throw new Error('actor_id is required.');
        }
        clearActorSummary(runtimeState, actorId);
        return {
          ok: true,
          actor_id: actorId,
        };
      });

      ctx.subscribe('discord.message_create', async ({ message }) => {
        if (!message || message.author?.bot) {
          return;
        }
        const raw = String(message.content || '').trim();
        const attachmentText = extractAttachmentText(message);
        const normalizedMessageText = extractMessageText(message);
        const lowered = raw.toLowerCase();
        if (!raw && !attachmentText) {
          return;
        }
        const characterId = String(runtimeConfig.chat_character_id || '').trim();
        if (lowered === '!chat-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) {
            return;
          }
          if (!characterId) {
            await replyToMessage(message, { content: 'Chat module chưa được cấu hình `chat_character_id`.', title: 'Chat', tone: 'error', user: message.author });
            return;
          }
          const resetPayload = {
            user_hash: String(runtimeConfig.user_hash || ''),
            character_id: characterId,
            session_id: sessionIdFromMessage(message),
            reset_session: true,
            discord_context: buildDiscordContextBundle(client, runtimeState, { message, actor: message.author, channel: message.channel, guild: message.guild }, runtimeConfig),
          };
          const c_key = conversationKeyFromMessage(message);
          clearMemoForConversation(runtimeState, c_key);
          await requestChatBridge(runtimeConfig, resetPayload);
          await replyToMessage(message, { content: 'Đã reset session chat cho kênh hiện tại.', title: 'Chat', tone: 'success', user: message.author });
          ctx.publish('bot.command_executed', {
            command: 'chat-reset',
            guild: safeGuildName(message.guild),
            author: safeUserTag(message.author),
            character_id: characterId,
            conversation_key: c_key,
          });
          return;
        }

        if (lowered === '!fact-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) return;
          clearActorSummary(runtimeState, String(message.author.id));
          await replyToMessage(message, { content: 'Đã xóa tất cả thông tin tóm tắt về bạn trong bộ nhớ của tôi.', title: 'Chat', tone: 'success', user: message.author });
          ctx.publish('bot.command_executed', {
            command: 'fact-reset',
            guild: safeGuildName(message.guild),
            author: safeUserTag(message.author),
          });
          return;
        }
        let prompt = '';
        let eventContext = null;
        if (lowered.startsWith('!chat ')) {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) {
            return;
          }
          const commandPrompt = raw.slice('!chat '.length).trim();
          prompt = [commandPrompt, attachmentText].filter(Boolean).join('\n').trim();
          eventContext = { event_type: 'message.command', trigger: '!chat' };
        } else if (lowered === '!chat' && attachmentText) {
          if (!isPolicyEnabled(runtimeState, POLICY_MESSAGE_COMMANDS)) {
            return;
          }
          prompt = attachmentText;
          eventContext = { event_type: 'message.command', trigger: '!chat' };
        } else if (wantsNaturalReply(message, runtimeState)) {
          prompt = normalizedMessageText;
          eventContext = { event_type: 'message.natural_chat', trigger: 'allowed_channel' };
        } else {
          return;
        }
        if (!characterId) {
          await replyToMessage(message, { content: 'Chat module chưa được cấu hình `chat_character_id`.', title: 'Chat', tone: 'error', user: message.author });
          return;
        }
        if (!prompt) {
          return;
        }
        const latestAttachments = buildAttachmentEventContext(message);
        if (latestAttachments.length > 0) {
          eventContext.attachments = latestAttachments;
        }

        const mentionsBot = client.user && message.mentions?.users?.has(client.user.id);
        const mentionMatch = raw.match(/^<@!?(\d+)>|^<@&(\d+)>/);
        let recordOnly = false;
        
        if (mentionMatch && !mentionsBot) {
          recordOnly = true;
        }

        // --- Fetch referenced (replied-to) message for user_info context ---
        if (message.reference && message.reference.messageId) {
          try {
            const refMsg = await message.channel.messages.fetch(message.reference.messageId);
            if (refMsg) {
              const refContent = extractMessageText(refMsg);
              const isBot = refMsg.author?.id === client.user?.id;
              if (isBot) {
                recordOnly = false;
              }
              const refDisplayName = isBot
                ? 'YOUR'
                : safeDisplayName(refMsg.author, refMsg.member);
              if (refContent) {
                const truncated = refContent.length > 300
                  ? refContent.slice(0, 297) + '...'
                  : refContent;
                eventContext.reply_reference = {
                  display_name: refDisplayName,
                  content: truncated,
                };
              }
            }
          } catch (refErr) {
            console.log(`[Chat] Failed to fetch referenced message: ${refErr.message || refErr}`);
          }
        }

        await message.channel.sendTyping();

        // --- Music URL Context + Prefetch ---
        const combinedForMusic = `${prompt} ${eventContext?.reply_reference?.content || ''}`;
        const musicUrls = collectMusicUrls(combinedForMusic);
        if (musicUrls.length > 0) {
          const resolvedTracks = [];
          for (const url of musicUrls.slice(0, 3)) {
            try {
              const resList = await ctx.call('music.resolve_requested', { query: url });
              const resolved = Array.isArray(resList) ? resList[0] : null;
              if (resolved?.track) {
                resolvedTracks.push(resolved.track);
              }
            } catch (_) {}
          }
          const contextLines = buildResolvedTrackContextLines(resolvedTracks);
          if (contextLines.length > 0) {
            prompt = `${prompt}\n${contextLines.join('\n')}`.trim();
          }
          for (const url of musicUrls) {
            ctx.publish('music.prefetch_requested', { url });
          }
        }
        // Fire-and-forget: sync bot nickname to character name in this guild.
        const characterName = String(runtimeConfig.chat_character_name || '').trim();
        if (message.guild && characterName) {
          ensureNickname(message.guild, client, characterName);
        } else if (message.guild) {
          console.log(`[Nickname Sync] Skipped. Character name is either missing or empty in config.`);
        }
        const sourceMeta = {
          guild_id: String(message.guild?.id || ''),
          channel_id: String(message.channel?.id || ''),
          actor_id: String(message.author?.id || ''),
          conversation_key: conversationKeyFromMessage(message),
          message,
          actor: message.author,
          guild: message.guild,
          channel: message.channel,
        };

        const publishBridgeTrace = (bridgePayload = {}) => {
          ctx.publish('bot.llm_trace', {
            guild: safeGuildName(message.guild),
            channel: safeChannelName(message.channel),
            author: safeUserTag(message.author),
            prompt: bridgePayload.llm_input,
            response: bridgePayload.raw_response,
          });
        };

        const emitReplyCompletion = (bridgePayload = {}, extra = {}) => {
          ctx.publish('chat.reply_completed', {
            ...sourceMeta,
            ...extra,
            session_id: bridgePayload.session_id,
            conversation_key: bridgePayload.conversation_key,
            reply: bridgePayload.reply,
            secondary_reply: bridgePayload.secondary_reply || '',
          });
        };

        const processFollowUpBridge = async (followUpBridge = {}, followUpAttempt = 1) => {
          const followUpEmitter = createReplySentenceEmitter(ctx, runtimeConfig, sourceMeta);
          followUpEmitter.flush(followUpBridge);
          await followUpEmitter.drain();

          const followUpContent = buildDiscordReplyText(followUpBridge, runtimeConfig);
          let followUpMessage = null;
          if (followUpContent) {
            if (isNaturalChat) {
              followUpMessage = await message.reply(followUpContent).catch(() => null);
            } else {
              followUpMessage = await replyToMessage(message, {
                content: followUpContent,
                title: 'Chat',
                tone: 'info',
                user: message.author,
              }).catch(() => null);
            }
          }

          if (followUpMessage) {
            runtimeState.messageState.lastBotMessageByChannel.set(String(message.channel?.id || ''), followUpMessage);
          }

          emitReplyCompletion(followUpBridge, {
            follow_up_attempt: followUpAttempt,
            follow_up: true,
          });
          publishBridgeTrace(followUpBridge);
        };
        const sentenceEmitter = createReplySentenceEmitter(ctx, runtimeConfig, sourceMeta);
        const isNaturalChat = eventContext?.event_type === 'message.natural_chat';
        
        let earlyReplyPromise = null;
        let primarySent = false;
        let rawStreamText = '';

        const bridge = await streamBrainReply(runtimeConfig, client, runtimeState, {
          prompt,
          message,
          actor: message.author,
          channel: message.channel,
          guild: message.guild,
          emit_on_delta: true,
          event_context: eventContext,
          record_only: recordOnly,
        }, {
          onDelta(delta) {
            rawStreamText += String(delta || '');
            if (rawStreamText.includes('[IGNORE]')) {
              return;
            }
            sentenceEmitter.push(delta);
            
            if (isNaturalChat && !primarySent && rawStreamText.includes('</message>')) {
              primarySent = true;
              const [primaryReply] = extractVisibleMessages(rawStreamText);
              const cleanPrimary = stripStreamMarkupFragments(primaryReply)
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&')
                .trim();
                
              if (cleanPrimary && !cleanPrimary.includes('[IGNORE]')) {
                earlyReplyPromise = message.reply(cleanPrimary).catch(err => {
                  console.error('[Chat] Early reply error:', err);
                  return null;
                });
              }
            }
          },
        });
        
        if (bridge.ignore) {
          console.log('[Chat] Bot decided to ignore this message ([IGNORE] keyword detected).');
          
          if (!recordOnly) {
            // Notify user that bot has "seen" the message
            const botName = String(runtimeConfig.chat_character_name || 'Bot').trim();
            await replyToMessage(message, {
              content: `*${botName} đã seen tin nhắn của bạn.*`,
              title: 'Chat',
              tone: 'info',
              user: message.author
            }).catch(() => {});
          }
        } else {
          sentenceEmitter.flush(bridge);
        }
        await sentenceEmitter.drain();
        
        const finalContent = buildDiscordReplyText(bridge, runtimeConfig);
        let sentMessage = null;
        
        if (earlyReplyPromise) {
          sentMessage = await earlyReplyPromise;
        }

        if (bridge.ignore) {
          // If we are ignoring, but somehow an early reply was sent (should not happen with the check above),
          // we might want to delete it or just leave it. The check cleanPrimary.includes('[IGNORE]') 
          // should prevent it.
          if (sentMessage) {
            await sentMessage.delete().catch(() => {});
            sentMessage = null;
          }
        } else {
          if (sentMessage) {
            if (finalContent && finalContent !== sentMessage.content) {
              const editPayload = isNaturalChat
                ? finalContent
                : normalizeDiscordPayload({ content: finalContent, title: 'Chat', tone: 'info', user: message.author });
              sentMessage = await sentMessage.edit(editPayload).catch(err => {
                console.error('[Chat] Edit reply error:', err);
                return sentMessage;
              });
            }
          } else {
            if (isNaturalChat) {
              sentMessage = await message.reply(finalContent).catch(() => null);
            } else {
              sentMessage = await replyToMessage(message, { content: finalContent, title: 'Chat', tone: 'info', user: message.author }).catch(() => null);
            }
          }
        }
        
        if (sentMessage) {
          runtimeState.messageState.lastBotMessageByChannel.set(String(message.channel?.id || ''), sentMessage);
        }

        emitReplyCompletion(bridge, { ignored: bridge.ignore });

        // --- Multi-Tool Execution Pipeline ---
        // Handle one or more <call_command> tags from the LLM response
        const rawCommands = Array.isArray(bridge.call_commands) && bridge.call_commands.length > 0
          ? bridge.call_commands
          : (bridge.call_command && typeof bridge.call_command === 'object' && bridge.call_command.tool_id ? [bridge.call_command] : []);

        const executeToolCommands = async (commands = [], followUpAttempt = 0) => {
          if (!Array.isArray(commands) || commands.length === 0) {
            return;
          }
          const { collectBrainAbilities } = require('../runtime_state.cjs');
          const abilities = collectBrainAbilities(runtimeState, runtimeConfig);
          const toolsForLlm = (abilities && typeof abilities === 'object' && Array.isArray(abilities.tools_for_llm)) ? abilities.tools_for_llm : [];
          const issueSummaries = [];

          for (const activeCmd of commands) {
            if (!activeCmd || typeof activeCmd !== 'object' || !activeCmd.tool_id) continue;

            const reqId = String(activeCmd.tool_id || '').trim();
            // Fuzzy match: exact tool_id → separator match (::, :, /, .) → module_id match
            let tool = toolsForLlm.find(t => t.tool_id === reqId);

            if (!tool) {
              // Try splitting by common separators like :: or / or .
              const parts = reqId.split(/[:.\/]+/).map(p => p.trim()).filter(Boolean);
              for (const p of parts) {
                const found = toolsForLlm.find(t => t.tool_id === p);
                if (found) { tool = found; break; }
              }
            }

            // Fallback: If still not found and reqId matches a module, pick the first tool in that module
            if (!tool) tool = toolsForLlm.find(t => t.module_id === reqId);

            if (tool && tool.call_event) {
              console.log(`[Tool Call] LLM executed internal tool: ${tool.tool_id} (requested: ${reqId})`);

              // --- Super-Fuzzy Tool Resolver ---
              let rawPayload = activeCmd.payload || activeCmd.args || {};

              if (rawPayload && typeof rawPayload === 'object') {
                const payloadKeys = Object.keys(rawPayload);

                // Priority 1: Check if any key in the payload is actually the name of a tool (LLM Hallucination)
                for (const key of payloadKeys) {
                  const val = rawPayload[key];
                  if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const matched = toolsForLlm.find(t => t.tool_id === key || (t.module_id === reqId && t.tool_id === key));
                    if (matched) {
                      console.log(`[Tool Resolver] Detected nested tool "${key}" in payload. Unwrapping...`);
                      tool = matched;
                      rawPayload = val;
                      break;
                    }
                  }
                }
              }

              const fullPayload = {
                ...rawPayload,
                guild_id: sourceMeta.guild_id,
                channel_id: sourceMeta.channel_id,
                actor_id: sourceMeta.actor_id,
                guild: message.guild,
                channel: message.channel,
                actor: message.author,
                conversation_key: sourceMeta.conversation_key,
                requester_name: safeUserTag(message.author),
                requester_id: String(message.author?.id || ''),
              };

              if (tool.tool_id === 'rag_search_web') {
                const tavilyKey = String(runtimeConfig?.tavily_api_key || '').trim();
                if (tavilyKey) {
                  fullPayload.tavily_api_key = tavilyKey;
                }
              }

              // Sanitize placeholder guild_id values from LLM
              if (fullPayload.guild_id === 'current' || fullPayload.guild_id === 'auto') {
                fullPayload.guild_id = sourceMeta.guild_id;
              }

              // Auto-inject actor's voice channel if missing or "current"
              if (tool.tool_id === 'voice_join') {
                const actorVoiceId = message.member?.voice?.channelId || message.guild?.members?.cache?.get(message.author?.id)?.voice?.channelId;
                if (!fullPayload.voice_channel_id || fullPayload.voice_channel_id === 'current' || fullPayload.voice_channel_id === 'auto') {
                  fullPayload.voice_channel_id = String(actorVoiceId || '');
                }
              }

              if (typeof ctx.call === 'function') {
                try {
                  const callResults = await ctx.call(tool.call_event, fullPayload);
                  const payload = buildToolReplyPayload(runtimeState, tool.tool_id, callResults, message.author, {
                    call_event: tool.call_event,
                    call_payload: fullPayload,
                  });
                  await replyToMessage(message, payload);
                  if (isToolFollowUpRequested(payload)) {
                    issueSummaries.push(summarizeToolIssue(tool.tool_id, payload));
                  }
                } catch (e) {
                  console.log(`[Tool Call Error] ${tool.tool_id}: ${e.message}`);
                  const errorPayload = buildToolErrorPayload(tool.tool_id, e, message.author);
                  await replyToMessage(message, errorPayload).catch(() => {});
                }
              } else {
                ctx.publish(tool.call_event, fullPayload);
              }
            } else {
              console.log(`[Tool Call Warning] Unknown tool requested: ${activeCmd.tool_id}`);
              const warningPayload = buildUnknownToolPayload(activeCmd.tool_id, message.author);
              await replyToMessage(message, warningPayload).catch(() => {});
            }
          }

          if (issueSummaries.length > 0 && followUpAttempt < MAX_TOOL_FOLLOW_UP_ATTEMPTS) {
            const nextAttempt = followUpAttempt + 1;
            const followUpPrompt = buildToolIssueFollowUpPrompt(issueSummaries, nextAttempt);
            try {
              await message.channel.sendTyping().catch(() => {});
              const followUpBridge = await requestBrainReply(runtimeConfig, client, runtimeState, {
                prompt: followUpPrompt,
                message,
                actor: message.author,
                channel: message.channel,
                guild: message.guild,
                event_context: {
                  event_type: 'message.tool_issue_follow_up',
                  trigger: 'tool_followup_flag',
                  follow_up_attempt: nextAttempt,
                },
              });
              await processFollowUpBridge(followUpBridge, nextAttempt);
              const followUpCommands = Array.isArray(followUpBridge.call_commands) && followUpBridge.call_commands.length > 0
                ? followUpBridge.call_commands
                : (followUpBridge.call_command && typeof followUpBridge.call_command === 'object' && followUpBridge.call_command.tool_id ? [followUpBridge.call_command] : []);
              if (followUpCommands.length > 0) {
                await executeToolCommands(followUpCommands, nextAttempt);
              }
            } catch (followUpErr) {
              const followUpErrorPayload = {
                content: `[System] Không thể follow-up LLM sau tool followup: ${String(followUpErr?.message || followUpErr || 'Unknown error')}`,
                title: 'Tool Follow-up',
                tone: 'error',
                user: message.author,
              };
              await replyToMessage(message, followUpErrorPayload).catch(() => {});
            }
          }
        };

        if (rawCommands.length > 0) {
          await executeToolCommands(rawCommands, 0);
        }

        publishBridgeTrace(bridge);

        ctx.publish('bot.command_executed', {
          command: eventContext?.event_type === 'message.natural_chat' ? 'natural-chat' : 'chat',
          guild: safeGuildName(message.guild),
          author: safeUserTag(message.author),
          character_id: characterId,
          session_id: bridge.session_id,
          conversation_key: bridge.conversation_key,
          payload: prompt,
        });
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand()) {
          return;
        }
        if (interaction.commandName === 'chat-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_APP_RESET)) {
            await replyToInteraction(interaction, { content: 'Chat reset qua App Command đang bị tắt.', ephemeral: true });
            return;
          }
          const characterId = String(runtimeConfig.chat_character_id || '').trim();
          if (!characterId) {
            await replyToInteraction(interaction, { content: 'Chat module chưa được cấu hình `chat_character_id`.', ephemeral: true });
            return;
          }
          const resetPayload = {
            user_hash: String(runtimeConfig.user_hash || ''),
            character_id: characterId,
            session_id: sessionIdFromInteraction(interaction),
            reset_session: true,
            discord_context: buildDiscordContextBundle(client, runtimeState, {
              interaction,
              actor: interaction.user,
              channel: interaction.channel,
              guild: interaction.guild,
              event_context: { event_type: 'app_command', command_name: 'chat-reset' },
            }, runtimeConfig),
          };
          const c_key = conversationKeyFromInteraction(interaction);
          clearMemoForConversation(runtimeState, c_key);
          await requestChatBridge(runtimeConfig, resetPayload);
          await replyToInteraction(interaction, {
            content: 'Đã reset session chat cho ngữ cảnh hiện tại.',
            title: 'Chat',
            tone: 'success',
            user: interaction.user,
          });
          ctx.publish('bot.command_executed', {
            command: 'chat-reset',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
            character_id: characterId,
            conversation_key: c_key,
          });
          return;
        }
        if (interaction.commandName === 'fact-reset') {
          if (!isPolicyEnabled(runtimeState, POLICY_APP_RESET)) {
            await replyToInteraction(interaction, { content: 'Fact reset qua App Command đang bị tắt.', ephemeral: true });
            return;
          }
          clearActorSummary(runtimeState, String(interaction.user.id));
          await replyToInteraction(interaction, { content: 'Đã xóa tất cả thông tin tóm tắt về bạn trong bộ nhớ của tôi.', ephemeral: true });
          ctx.publish('bot.command_executed', {
            command: 'fact-reset',
            guild: safeGuildName(interaction.guild),
            author: safeUserTag(interaction.user),
          });
          return;
        }
      });
    },
  };
};
