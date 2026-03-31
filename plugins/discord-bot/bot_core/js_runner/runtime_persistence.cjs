const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  if (!dirPath) {
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mapToEntries(mapValue) {
  if (!(mapValue instanceof Map)) {
    return [];
  }
  return [...mapValue.entries()];
}

function restoreMap(entries, fallback = []) {
  return new Map(Array.isArray(entries) ? entries : fallback);
}

function serializeRuntimeState(state) {
  return {
    saved_at: new Date().toISOString(),
    policyState: {
      definitions: mapToEntries(state?.policyState?.definitions),
      toggles: mapToEntries(state?.policyState?.toggles),
      settings: mapToEntries(state?.policyState?.settings),
    },
    memo: {
      conversationTurns: mapToEntries(state?.memo?.conversationTurns),
      conversationSummaries: mapToEntries(state?.memo?.conversationSummaries),
      actorSummaries: mapToEntries(state?.memo?.actorSummaries),
    },
    contextFacts: {
      sequence: Number(state?.contextFacts?.sequence || 0),
      records: safeArray(state?.contextFacts?.records),
    },
    voiceState: {
      joinedChannelByGuild: mapToEntries(state?.voiceState?.joinedChannelByGuild),
      lastVoiceFactByGuild: mapToEntries(state?.voiceState?.lastVoiceFactByGuild),
    },
  };
}

function hydrateRuntimeState(state, payload = {}) {
  const data = safeObject(payload);
  const policyState = safeObject(data.policyState);
  const memo = safeObject(data.memo);
  const contextFacts = safeObject(data.contextFacts);
  const voiceState = safeObject(data.voiceState);

  state.policyState.definitions = restoreMap(policyState.definitions);
  state.policyState.toggles = restoreMap(policyState.toggles);
  state.policyState.settings = restoreMap(policyState.settings);

  state.memo.conversationTurns = restoreMap(memo.conversationTurns);
  state.memo.conversationSummaries = restoreMap(memo.conversationSummaries);
  state.memo.actorSummaries = restoreMap(memo.actorSummaries);

  state.contextFacts.sequence = Number(contextFacts.sequence || 0);
  state.contextFacts.records = safeArray(contextFacts.records);

  state.voiceState.joinedChannelByGuild = restoreMap(voiceState.joinedChannelByGuild);
  state.voiceState.lastVoiceFactByGuild = restoreMap(voiceState.lastVoiceFactByGuild);
}

function createRuntimePersistence(runtimeConfig, logger) {
  const baseDir = String(runtimeConfig?.cache_dir || '').trim();
  const stateFile = baseDir ? path.join(baseDir, 'runtime_state.json') : '';
  let saveTimer = null;

  function loadInto(state) {
    if (!baseDir || !stateFile) {
      return false;
    }
    try {
      ensureDir(baseDir);
      if (!fs.existsSync(stateFile)) {
        return false;
      }
      const raw = fs.readFileSync(stateFile, 'utf8');
      if (!raw.trim()) {
        return false;
      }
      const parsed = JSON.parse(raw);
      hydrateRuntimeState(state, parsed);
      if (logger && typeof logger.log === 'function') {
        logger.log('info', `Loaded runtime cache from ${stateFile}`);
      }
      return true;
    } catch (error) {
      if (logger && typeof logger.log === 'function') {
        logger.log('warning', `Failed to load runtime cache: ${error.message || String(error)}`);
      }
      return false;
    }
  }

  function saveNow(state) {
    if (!baseDir || !stateFile) {
      return false;
    }
    try {
      ensureDir(baseDir);
      const payload = serializeRuntimeState(state);
      fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2), 'utf8');
      return true;
    } catch (error) {
      if (logger && typeof logger.log === 'function') {
        logger.log('warning', `Failed to save runtime cache: ${error.message || String(error)}`);
      }
      return false;
    }
  }

  function scheduleSave(state, delayMs = 350) {
    if (!baseDir || !stateFile) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow(state);
    }, Math.max(50, Number(delayMs || 0)));
  }

  function flush(state) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveNow(state);
  }

  return {
    baseDir,
    loadInto,
    saveNow,
    scheduleSave,
    flush,
  };
}

module.exports = {
  createRuntimePersistence,
  hydrateRuntimeState,
  serializeRuntimeState,
};
