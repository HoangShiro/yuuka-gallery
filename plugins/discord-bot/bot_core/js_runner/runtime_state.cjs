const { ActionRowBuilder, ComponentType } = require('discord.js');

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
    messageViewState: {
      definitionsById: new Map(),
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
    brainState: {
      instructionsByModule: new Map(),
      toolsByModule: new Map(),
    },
    toolReplyState: {
      formattersByToolId: new Map(),
    },
  };
}

function mapToObject(mapValue) {
  if (!(mapValue instanceof Map)) {
    return {};
  }
  const obj = {};
  for (const [key, value] of mapValue.entries()) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      continue;
    }
    obj[normalizedKey] = value;
  }
  return obj;
}

function snapshotPolicyState(state) {
  if (!state?.policyState) {
    return { toggles: {}, settings: {} };
  }
  return {
    toggles: mapToObject(state.policyState.toggles),
    settings: mapToObject(state.policyState.settings),
  };
}

function notifyPolicyStateChanged(state, reason = 'updated') {
  if (typeof state?.onPolicyStateChanged !== 'function') {
    return;
  }
  try {
    state.onPolicyStateChanged({
      reason,
      policy_state: snapshotPolicyState(state),
    });
  } catch (_) {
    // ignore notification failures to keep runtime stable
  }
}

function normalizeToolReplyFormatter(moduleId, definition = {}) {
  const toolId = String(definition.tool_id || definition.id || '').trim();
  if (!toolId) {
    return null;
  }
  if (typeof definition.build_payload !== 'function') {
    return null;
  }
  return {
    module_id: String(moduleId || '').trim() || 'unknown',
    tool_id: toolId,
    build_payload: definition.build_payload,
  };
}

function registerToolReplyFormatter(state, moduleId, definition = {}) {
  if (!(state?.toolReplyState?.formattersByToolId instanceof Map)) {
    return null;
  }
  const normalized = normalizeToolReplyFormatter(moduleId, definition);
  if (!normalized) {
    return null;
  }
  state.toolReplyState.formattersByToolId.set(normalized.tool_id, normalized);
  return normalized;
}

function resolveToolReplyFormatter(state, toolId) {
  if (!(state?.toolReplyState?.formattersByToolId instanceof Map)) {
    return null;
  }
  const normalizedToolId = String(toolId || '').trim();
  if (!normalizedToolId) {
    return null;
  }
  return state.toolReplyState.formattersByToolId.get(normalizedToolId) || null;
}

function normalizeMessageViewDefinition(moduleId, definition = {}) {
  const viewId = String(definition.view_id || definition.id || '').trim();
  if (!viewId) {
    return null;
  }
  const moduleIdNormalized = String(moduleId || definition.module_id || '').trim() || 'unknown';
  const title = String(definition.title || viewId).trim() || viewId;
  const description = String(definition.description || '').trim();
  const build = typeof definition.build === 'function' ? definition.build : null;
  const items = Array.isArray(definition.items) ? [...definition.items] : [];
  const components = Array.isArray(definition.components) ? [...definition.components] : [];
  return {
    module_id: moduleIdNormalized,
    view_id: viewId,
    title,
    description,
    build,
    items,
    components,
  };
}

function registerMessageView(state, moduleId, definition = {}) {
  if (!(state?.messageViewState?.definitionsById instanceof Map)) {
    return null;
  }
  const normalized = normalizeMessageViewDefinition(moduleId, definition);
  if (!normalized) {
    return null;
  }
  state.messageViewState.definitionsById.set(normalized.view_id, normalized);
  return normalized;
}

function toRowIndex(item) {
  const candidate = item?.row ?? item?.data?.row;
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 4) {
    return null;
  }
  return parsed;
}

function isActionRowComponent(item) {
  if (!item) {
    return false;
  }
  if (typeof item.toJSON === 'function') {
    const raw = item.toJSON();
    return Number(raw?.type) === Number(ComponentType.ActionRow);
  }
  return Number(item?.type) === Number(ComponentType.ActionRow);
}

function assembleActionRows(items = []) {
  const rows = [[], [], [], [], []];
  const actionRows = [];
  let droppedCount = 0;

  for (const item of items) {
    if (!item) {
      continue;
    }
    if (isActionRowComponent(item)) {
      if (actionRows.length >= 5) {
        droppedCount += 1;
        continue;
      }
      actionRows.push(item);
      continue;
    }

    let placed = false;
    const targetRow = toRowIndex(item);
    if (targetRow != null && rows[targetRow].length < 5) {
      rows[targetRow].push(item);
      placed = true;
    }
    if (!placed) {
      for (let i = 0; i < 5; i += 1) {
        if (rows[i].length < 5) {
          rows[i].push(item);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      droppedCount += 1;
    }
  }

  const filledRows = rows
    .filter((entry) => entry.length > 0)
    .map((entry) => new ActionRowBuilder().addComponents(...entry));
  const merged = [...actionRows, ...filledRows];
  if (merged.length > 5) {
    droppedCount += (merged.length - 5);
    merged.length = 5;
  }

  return {
    components: merged,
    dropped_count: droppedCount,
  };
}

async function resolveMessageView(state, viewRef, payload = {}) {
  if (!(state?.messageViewState?.definitionsById instanceof Map)) {
    return null;
  }
  const viewId = typeof viewRef === 'string'
    ? String(viewRef).trim()
    : String(viewRef?.view_id || viewRef?.id || '').trim();
  if (!viewId) {
    return null;
  }
  const definition = state.messageViewState.definitionsById.get(viewId);
  if (!definition) {
    return null;
  }

  const buildCtx = {
    payload,
    view_ref: viewRef,
    module_id: definition.module_id,
    view_id: definition.view_id,
  };
  const built = definition.build
    ? await Promise.resolve(definition.build(buildCtx))
    : null;

  const directComponents = Array.isArray(built?.components)
    ? built.components
    : (Array.isArray(definition.components) && definition.components.length ? definition.components : []);
  if (directComponents.length > 0) {
    return {
      module_id: definition.module_id,
      view_id: definition.view_id,
      components: directComponents.filter(Boolean),
      dropped_count: 0,
    };
  }

  const items = Array.isArray(built?.items)
    ? built.items
    : (Array.isArray(built) ? built : definition.items);
  const assembled = assembleActionRows(Array.isArray(items) ? items : []);
  return {
    module_id: definition.module_id,
    view_id: definition.view_id,
    components: assembled.components,
    dropped_count: assembled.dropped_count,
  };
}

function addCommandDefinition(state, builder) {
  if (!builder || typeof builder.toJSON !== 'function') {
    return;
  }
  state.commandDefinitions.push(builder.toJSON());
}

function normalizeBrainInstruction(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.replace(/\s+/g, ' ');
}

function normalizeBrainTool(moduleId, definition = {}) {
  const toolId = String(definition.tool_id || definition.id || '').trim();
  if (!toolId) {
    return null;
  }
  const title = String(definition.title || toolId).trim() || toolId;
  const description = String(definition.description || '').trim();
  const callEvent = String(definition.call_event || '').trim();
  const inputSchema = definition.input_schema && typeof definition.input_schema === 'object' && !Array.isArray(definition.input_schema)
    ? { ...definition.input_schema }
    : {};
  return {
    module_id: String(moduleId || '').trim() || 'unknown',
    tool_id: toolId,
    title,
    description,
    call_event: callEvent,
    input_schema: inputSchema,
    default_enabled: definition.default_enabled !== false,
  };
}

function registerBrainInstruction(state, moduleId, instruction) {
  if (!state?.brainState?.instructionsByModule) {
    return null;
  }
  const normalizedModuleId = String(moduleId || '').trim() || 'unknown';
  const normalizedInstruction = normalizeBrainInstruction(instruction);
  if (!normalizedInstruction) {
    return null;
  }
  const current = state.brainState.instructionsByModule.get(normalizedModuleId) || [];
  if (!current.includes(normalizedInstruction)) {
    current.push(normalizedInstruction);
    state.brainState.instructionsByModule.set(normalizedModuleId, current);
  }
  return {
    module_id: normalizedModuleId,
    instruction: normalizedInstruction,
  };
}

function registerBrainTool(state, moduleId, definition = {}) {
  if (!state?.brainState?.toolsByModule) {
    return null;
  }
  const normalized = normalizeBrainTool(moduleId, definition);
  if (!normalized) {
    return null;
  }
  const current = state.brainState.toolsByModule.get(normalized.module_id) || [];
  const existingIndex = current.findIndex((item) => item.tool_id === normalized.tool_id);
  if (existingIndex >= 0) {
    current[existingIndex] = {
      ...current[existingIndex],
      ...normalized,
    };
  } else {
    current.push(normalized);
  }
  state.brainState.toolsByModule.set(normalized.module_id, current);
  return normalized;
}

function isBrainToolEnabled(runtimeConfig, moduleId, toolId, defaultEnabled = true) {
  const toggles = runtimeConfig?.brain_tools && typeof runtimeConfig.brain_tools === 'object'
    ? runtimeConfig.brain_tools.toggles || {}
    : {};
  const key = `${String(moduleId || '').trim()}:${String(toolId || '').trim()}`;
  if (Object.prototype.hasOwnProperty.call(toggles, key)) {
    return Boolean(toggles[key]);
  }
  return Boolean(defaultEnabled);
}

function collectBrainAbilities(state, runtimeConfig = {}) {
  const toolsByModuleMap = state?.brainState?.toolsByModule instanceof Map
    ? state.brainState.toolsByModule
    : new Map();
  const instructionsByModuleMap = state?.brainState?.instructionsByModule instanceof Map
    ? state.brainState.instructionsByModule
    : new Map();
  const moduleIds = new Set([
    ...toolsByModuleMap.keys(),
    ...instructionsByModuleMap.keys(),
  ]);
  const modules = [];
  const toolsForLlm = [];
  for (const moduleId of [...moduleIds].sort()) {
    const instructions = [...(instructionsByModuleMap.get(moduleId) || [])];
    const allTools = [...(toolsByModuleMap.get(moduleId) || [])];
    const tools = allTools.map((tool) => {
      const enabled = isBrainToolEnabled(runtimeConfig, moduleId, tool.tool_id, tool.default_enabled);
      return {
        ...tool,
        enabled,
      };
    });
    const enabledTools = tools.filter((tool) => tool.enabled);
    toolsForLlm.push(...enabledTools.map((tool) => ({
      module_id: moduleId,
      tool_id: tool.tool_id,
      title: tool.title,
      description: tool.description,
      call_event: tool.call_event,
      input_schema: tool.input_schema,
    })));
    modules.push({
      module_id: moduleId,
      instructions,
      tools,
    });
  }
  return {
    modules,
    tools_for_llm: toolsForLlm,
  };
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
  notifyPolicyStateChanged(state, 'definition_registered');
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
  notifyPolicyStateChanged(state, 'settings_updated');
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
  notifyPolicyStateChanged(state, 'toggle_updated');
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
  registerBrainInstruction,
  registerBrainTool,
  registerToolReplyFormatter,
  resolveToolReplyFormatter,
  registerMessageView,
  resolveMessageView,
  collectBrainAbilities,
  registerPolicyDefinition,
  setPolicyToggle,
  setPolicySettings,
  snapshotPolicyState,
  applyConfiguredPolicies,
  isPolicyEnabled,
  resolvePolicySetting,
  matchesPolicyChannelAllowlist,
  addContextFact,
  selectContextFacts,
};
