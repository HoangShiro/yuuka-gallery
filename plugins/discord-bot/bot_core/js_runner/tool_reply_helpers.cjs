const { resolveToolReplyFormatter } = require('./runtime_state.cjs');

function safeJsonPreview(value, maxLength = 900) {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 3)}...`;
  } catch (_) {
    return String(value || '');
  }
}

function extractToolResultText(value) {
  if (value == null) {
    return 'Đã thực thi thành công (không có dữ liệu trả về).';
  }
  if (typeof value === 'string') {
    const text = value.trim();
    return text || 'Đã thực thi thành công.';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'Đã thực thi thành công (mảng kết quả rỗng).';
    }
    if (value.length === 1) {
      return extractToolResultText(value[0]);
    }
    const preview = safeJsonPreview(value);
    return preview ? `\`\`\`json\n${preview}\n\`\`\`` : `Đã nhận ${value.length} kết quả.`;
  }
  if (typeof value === 'object') {
    for (const key of ['message', 'status', 'summary', 'reason']) {
      const candidate = String(value[key] || '').trim();
      if (candidate) {
        return candidate;
      }
    }
    const preview = safeJsonPreview(value);
    return preview ? `\`\`\`json\n${preview}\n\`\`\`` : 'Đã thực thi thành công.';
  }
  return String(value);
}

function formatMusicDuration(sec) {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return 'LIVE/Unknown';
  }
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function normalizePrimaryResult(callResults) {
  return Array.isArray(callResults)
    ? (callResults.find(Boolean) || callResults[0] || null)
    : callResults;
}

function shouldAttachFollowUp(payload = {}) {
  if (payload?.followup === true) {
    return true;
  }
  const tone = String(payload?.tone || '').trim().toLowerCase();
  return tone === 'warning' || tone === 'error';
}

function buildFallbackPayload(toolId, callResults, actor) {
  const fallback = extractToolResultText(callResults);
  return {
    content: `Tool \`${toolId}\`: ${fallback}`,
    title: 'Tool Result',
    tone: 'success',
    user: actor,
  };
}

function buildToolReplyPayload(runtimeState, toolId, callResults, actor, meta = {}) {
  const formatter = resolveToolReplyFormatter(runtimeState, toolId);
  if (formatter && typeof formatter.build_payload === 'function') {
    try {
      const payload = formatter.build_payload({
        tool_id: toolId,
        call_results: callResults,
        actor,
        meta,
      });
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const followUp = shouldAttachFollowUp(payload);
        return {
          ...payload,
          user: payload.user || actor,
          ...(followUp ? { followup: true } : {}),
        };
      }
    } catch (_) {
      return buildFallbackPayload(toolId, callResults, actor);
    }
  }
  return buildFallbackPayload(toolId, callResults, actor);
}

function buildToolErrorPayload(toolId, error, actor) {
  return {
    content: `Tool \`${toolId}\` lỗi: ${String(error?.message || error || 'Unknown error')}`,
    title: 'Tool Result',
    tone: 'error',
    followup: true,
    user: actor,
  };
}

function buildUnknownToolPayload(requestedToolId, actor) {
  return {
    content: `LLM yêu cầu tool không hợp lệ: \`${String(requestedToolId || '').trim() || 'unknown'}\``,
    title: 'Tool Result',
    tone: 'warning',
    followup: true,
    user: actor,
  };
}

module.exports = {
  normalizePrimaryResult,
  formatMusicDuration,
  buildToolReplyPayload,
  buildToolErrorPayload,
  buildUnknownToolPayload,
};
