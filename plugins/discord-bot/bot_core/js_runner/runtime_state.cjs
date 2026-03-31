function createRuntimeState() {
  return {
    commandDefinitions: [],
    policyState: {
      definitions: new Map(),
      toggles: new Map(),
      settings: new Map(),
    },
    memo: {
      conversationTurns: new Map(),
      conversationSummaries: new Map(),
      actorSummaries: new Map(),
    },
    messageState: {
      lastBotMessageByChannel: new Map(),
    },
    voiceState: {
      joinedChannelByGuild: new Map(),
      lastVoiceFactByGuild: new Map(),
      adapter: null,
    },
    contextFacts: {
      records: [],
      sequence: 0,
    },
  };
}

function addCommandDefinition(state, builder) {
  if (!builder || typeof builder.toJSON !== 'function') {
    return;
  }
  state.commandDefinitions.push(builder.toJSON());
}

function normalizePolicyDefinition(moduleId, definition = {}) {
  const policyId = String(definition.policy_id || '').trim();
  if (!policyId) {
    return null;
  }
  return {
    policy_id: policyId,
    module_id: String(moduleId || definition.module_id || '').trim() || 'unknown',
    group_id: String(definition.group_id || 'general').trim() || 'general',
    group_name: String(definition.group_name || definition.group_id || 'General').trim() || 'General',
    title: String(definition.title || policyId).trim() || policyId,
    description: String(definition.description || '').trim(),
    default_enabled: Boolean(definition.default_enabled),
    scope: String(definition.scope || 'global').trim() || 'global',
    settings: definition.settings && typeof definition.settings === 'object' && !Array.isArray(definition.settings)
      ? { ...definition.settings }
      : {},
  };
}

function registerPolicyDefinition(state, moduleId, definition = {}) {
  if (!state?.policyState?.definitions) {
    return null;
  }
  const normalized = normalizePolicyDefinition(moduleId, definition);
  if (!normalized) {
    return null;
  }
  const existing = state.policyState.definitions.get(normalized.policy_id) || {};
  state.policyState.definitions.set(normalized.policy_id, {
    ...existing,
    ...normalized,
  });
  if (!state.policyState.toggles.has(normalized.policy_id)) {
    state.policyState.toggles.set(normalized.policy_id, Boolean(normalized.default_enabled));
  }
  if (!state.policyState.settings.has(normalized.policy_id)) {
    state.policyState.settings.set(normalized.policy_id, { ...normalized.settings });
  } else {
    state.policyState.settings.set(normalized.policy_id, {
      ...normalized.settings,
      ...(state.policyState.settings.get(normalized.policy_id) || {}),
    });
  }
  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
  return normalized;
}

function setPolicySettings(state, policyId, settings = {}) {
  const normalizedId = String(policyId || '').trim();
  if (!normalizedId || !(settings && typeof settings === 'object') || Array.isArray(settings)) {
    return false;
  }
  if (!state?.policyState?.settings) {
    return false;
  }
  const current = state.policyState.settings.get(normalizedId) || {};
  state.policyState.settings.set(normalizedId, {
    ...current,
    ...settings,
  });
  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
  return true;
}

function applyConfiguredPolicies(state, policyState = {}) {
  if (!state?.policyState) {
    return;
  }
  const toggles = policyState && typeof policyState === 'object' && !Array.isArray(policyState)
    ? policyState.toggles || {}
    : {};
  const settings = policyState && typeof policyState === 'object' && !Array.isArray(policyState)
    ? policyState.settings || {}
    : {};
  for (const [policyId, enabled] of Object.entries(toggles || {})) {
    setPolicyToggle(state, policyId, Boolean(enabled));
  }
  for (const [policyId, value] of Object.entries(settings || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      setPolicySettings(state, policyId, value);
    }
  }
}

function setPolicyToggle(state, policyId, enabled) {
  const normalizedId = String(policyId || '').trim();
  if (!normalizedId || !state?.policyState?.toggles) {
    return false;
  }
  state.policyState.toggles.set(normalizedId, Boolean(enabled));
  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
  return true;
}

function isPolicyEnabled(state, policyId) {
  const normalizedId = String(policyId || '').trim();
  if (!normalizedId) {
    return false;
  }
  const stored = state?.policyState?.toggles instanceof Map
    ? state.policyState.toggles.get(normalizedId)
    : undefined;
  if (typeof stored === 'boolean') {
    return stored;
  }
  const definition = state?.policyState?.definitions instanceof Map
    ? state.policyState.definitions.get(normalizedId)
    : null;
  return Boolean(definition?.default_enabled);
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolvePolicySetting(state, policyId, key, fallback = '') {
  const normalizedId = String(policyId || '').trim();
  const storedSettings = state?.policyState?.settings instanceof Map
    ? state.policyState.settings.get(normalizedId)
    : null;
  if (storedSettings && typeof storedSettings === 'object' && key in storedSettings) {
    const storedValue = storedSettings[key];
    return storedValue == null ? fallback : storedValue;
  }
  const definition = state?.policyState?.definitions instanceof Map
    ? state.policyState.definitions.get(normalizedId)
    : null;
  if (!definition || !definition.settings || typeof definition.settings !== 'object') {
    return fallback;
  }
  const value = definition.settings[key];
  return value == null ? fallback : value;
}

function matchesPolicyChannelAllowlist(state, policyId, channelId) {
  const normalizedChannelId = String(channelId || '').trim();
  if (!normalizedChannelId) {
    return false;
  }
  const allowlist = parseIdList(resolvePolicySetting(state, policyId, 'allowed_channel_ids', ''));
  if (!allowlist.length) {
    return true;
  }
  return allowlist.includes(normalizedChannelId);
}

function toNumberOrDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function matchesScopedFact(record, scope = {}) {
  if (!record) {
    return false;
  }
  const guildId = String(scope.guild_id || '');
  const channelId = String(scope.channel_id || '');
  const authorId = String(scope.author_id || '');
  if (record.guild_id && guildId && record.guild_id !== guildId) {
    return false;
  }
  if (record.guild_id && !guildId) {
    return false;
  }
  if (record.channel_id && channelId && record.channel_id !== channelId) {
    return false;
  }
  if (record.channel_id && !channelId) {
    return false;
  }
  if (record.author_id && authorId && record.author_id !== authorId) {
    return false;
  }
  if (record.author_id && !authorId) {
    return false;
  }
  return true;
}

function addContextFact(state, eventName, payload = {}) {
  if (!state?.contextFacts || !eventName || !payload || typeof payload !== 'object') {
    return null;
  }
  const now = Date.now();
  const sequence = Number(state.contextFacts.sequence || 0) + 1;
  state.contextFacts.sequence = sequence;
  const ttlSec = Math.max(0, toNumberOrDefault(payload.ttl_sec, 900));
  const record = {
    sequence,
    event_name: String(eventName || ''),
    fact_type: String(eventName || '').replace(/^context\./, '').replace(/_fact$/, ''),
    guild_id: String(payload.guild_id || ''),
    channel_id: String(payload.channel_id || ''),
    author_id: String(payload.author_id || payload.actor_uid || ''),
    key: String(payload.key || payload.task_id || payload.event_name || payload.scope || ''),
    value: String(payload.value || payload.note || payload.state || payload.text_preview || payload.voice_channel_name || ''),
    score: toNumberOrDefault(payload.score, 0),
    ttl_sec: ttlSec,
    created_at: String(payload.at || new Date(now).toISOString()),
    expires_at_ms: ttlSec > 0 ? now + (ttlSec * 1000) : 0,
    payload: { ...payload },
  };
  state.contextFacts.records.push(record);
  if (state.contextFacts.records.length > 250) {
    state.contextFacts.records.splice(0, state.contextFacts.records.length - 250);
  }
  if (typeof state.schedulePersist === 'function') {
    state.schedulePersist();
  }
  return record;
}

function selectContextFacts(state, scope = {}, options = {}) {
  const records = Array.isArray(state?.contextFacts?.records) ? state.contextFacts.records : [];
  const now = Date.now();
  const limit = Math.max(1, toNumberOrDefault(options.limit, 8));
  const filtered = records
    .filter((item) => item && matchesScopedFact(item, scope))
    .filter((item) => !item.expires_at_ms || item.expires_at_ms > now)
    .sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      return (b.sequence || 0) - (a.sequence || 0);
    });
  const deduped = [];
  const seen = new Set();
  for (const item of filtered) {
    const dedupeKey = [item.fact_type, item.guild_id, item.channel_id, item.author_id, item.key, item.value].join('|');
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push({
      fact_type: item.fact_type,
      event_name: item.event_name,
      guild_id: item.guild_id,
      channel_id: item.channel_id,
      author_id: item.author_id,
      key: item.key,
      value: item.value,
      score: item.score,
      created_at: item.created_at,
      payload: item.payload,
    });
    if (deduped.length >= limit) {
      break;
    }
  }
  return deduped;
}

module.exports = {
  createRuntimeState,
  addCommandDefinition,
  registerPolicyDefinition,
  setPolicyToggle,
  setPolicySettings,
  applyConfiguredPolicies,
  isPolicyEnabled,
  resolvePolicySetting,
  matchesPolicyChannelAllowlist,
  addContextFact,
  selectContextFacts,
};
