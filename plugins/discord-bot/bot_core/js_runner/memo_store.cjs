const { truncateText } = require('./discord_utils.cjs');

function ensureConversationEntry(state, conversationKey) {
  const memoState = state.memo;
  if (!memoState.conversationTurns.has(conversationKey)) {
    memoState.conversationTurns.set(conversationKey, []);
  }
  return memoState.conversationTurns.get(conversationKey);
}

function updateHybridMemo(state, payload = {}) {
  const memoState = state.memo;
  const conversationKey = String(payload.conversation_key || '').trim();
  if (!conversationKey) {
    return;
  }
  const actorUid = String(payload.actor_uid || '').trim();
  const participants = Array.isArray(payload.participant_uids)
    ? payload.participant_uids.map((item) => String(item || '').trim()).filter(Boolean)
    : actorUid
      ? [actorUid]
      : [];
  const turn = {
    at: String(payload.at || new Date().toISOString()),
    actor_uid: actorUid,
    actor_name: String(payload.actor_name || ''),
    text: truncateText(payload.text || '', 320),
    kind: String(payload.kind || 'message'),
    channel_name: String(payload.channel_name || ''),
    participant_uids: participants,
  };
  const turns = ensureConversationEntry(state, conversationKey);
  turns.push(turn);
  if (turns.length > 20) {
    turns.splice(0, turns.length - 20);
  }
  const existingSummary = memoState.conversationSummaries.get(conversationKey) || {};
  const summary = {
    conversation_key: conversationKey,
    participant_uids: [...new Set(turns.flatMap((item) => item.participant_uids || []).filter(Boolean))].slice(0, 12),
    time_range: [turns[0]?.at || turn.at, turns[turns.length - 1]?.at || turn.at],
    summary: existingSummary.summary || '', // Reserved for async LLM summarization
    highlights: turns
      .slice(-5)
      .filter((item) => item.text)
      .map((item) => ({ uid: item.actor_uid, fact: truncateText(item.text, 120) })),
    updated_at: turn.at,
  };
  memoState.conversationSummaries.set(conversationKey, summary);
  for (const uid of participants) {
    const existingActor = memoState.actorSummaries.get(uid) || {};
    memoState.actorSummaries.set(uid, {
      actor_uid: uid,
      actor_name: String(payload.actor_name || existingActor.actor_name || ''),
      updated_at: turn.at,
      summary: existingActor.summary || '', // Reserved for async LLM summarization
      conversation_key: conversationKey,
    });
  }
  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
}

function clearMemoForConversation(state, conversationKey) {
  const memoState = state.memo;
  if (!conversationKey) return;
  
  memoState.conversationTurns.delete(conversationKey);
  memoState.conversationSummaries.delete(conversationKey);

  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
}

function clearActorSummary(state, actorId) {
  const memoState = state.memo;
  if (!actorId) return;
  memoState.actorSummaries.delete(actorId);
  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
}

module.exports = {
  ensureConversationEntry,
  updateHybridMemo,
  clearMemoForConversation,
  clearActorSummary,
};
