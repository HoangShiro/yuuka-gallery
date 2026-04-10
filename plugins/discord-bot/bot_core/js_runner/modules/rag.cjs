const { SlashCommandBuilder } = require('discord.js');
const { addCommandDefinition } = require('../runtime_state.cjs');
const { replyToInteraction } = require('../interaction_helpers.cjs');
const { safeGuildName, safeUserTag, truncateText } = require('../discord_utils.cjs');

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;

function normalizeMaxResults(value, fallback = DEFAULT_MAX_RESULTS) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const bounded = Math.max(1, Math.min(MAX_RESULTS_LIMIT, Math.floor(n)));
  return bounded;
}

function getConfiguredApiKey(runtimeConfig, payload = {}) {
  const payloadKey = String(payload?.tavily_api_key || '').trim();
  if (payloadKey) {
    return payloadKey;
  }
  const runtimeKey = String(runtimeConfig?.tavily_api_key || '').trim();
  if (runtimeKey) {
    return runtimeKey;
  }
  return String(process.env.TAVILY_API_KEY || process.env.TAVILY_API_TOKEN || '').trim();
}

function sanitizeResultItem(item = {}, index = 0) {
  const title = String(item?.title || '').trim();
  const url = String(item?.url || '').trim();
  const content = String(item?.content || '').replace(/\s+/g, ' ').trim();
  return {
    index: index + 1,
    title,
    url,
    content: truncateText(content, 280),
    score: Number(item?.score || 0),
  };
}

function buildSummaryLines(items = []) {
  return items.slice(0, MAX_RESULTS_LIMIT).map((item) => {
    const header = `${item.index}. ${item.title || '(no title)'}`;
    const snippet = item.content ? `\n${item.content}` : '';
    const source = item.url ? `\nSource: ${item.url}` : '';
    return `${header}${snippet}${source}`;
  });
}

async function searchTavily(runtimeConfig, payload = {}) {
  const apiKey = getConfiguredApiKey(runtimeConfig, payload);
  if (!apiKey) {
    return {
      ok: false,
      reason: 'missing_api_key',
      message: 'Tavily API key is not configured.',
      query: String(payload?.query || '').trim(),
      results: [],
      max_results: normalizeMaxResults(payload?.max_results || runtimeConfig?.tavily_max_results || DEFAULT_MAX_RESULTS),
    };
  }

  const query = String(payload?.query || '').trim();
  if (!query) {
    return {
      ok: false,
      reason: 'empty_query',
      message: 'query is required.',
      query: '',
      results: [],
      max_results: normalizeMaxResults(payload?.max_results || runtimeConfig?.tavily_max_results || DEFAULT_MAX_RESULTS),
    };
  }

  const maxResults = normalizeMaxResults(payload?.max_results || runtimeConfig?.tavily_max_results || DEFAULT_MAX_RESULTS);
  const topic = String(payload?.topic || 'general').trim() || 'general';

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic,
      search_depth: 'advanced',
      include_answer: true,
      include_images: false,
      include_raw_content: false,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    return {
      ok: false,
      reason: 'upstream_error',
      message: `Tavily request failed: HTTP ${response.status}${bodyText ? ` - ${truncateText(bodyText, 200)}` : ''}`,
      query,
      results: [],
      max_results: maxResults,
    };
  }

  const data = await response.json();
  const rawResults = Array.isArray(data?.results) ? data.results : [];
  const results = rawResults.map((item, index) => sanitizeResultItem(item, index)).filter((item) => item.title || item.url || item.content);

  return {
    ok: true,
    query,
    answer: String(data?.answer || '').trim(),
    results,
    max_results: maxResults,
  };
}

module.exports = function createRagModule(deps) {
  const { runtimeConfig } = deps;
  return {
    module_id: 'core.rag',
    name: 'RAG Search',
    setup(ctx) {
      ctx.registerBrainInstruction('Use the Tavily web search tool when the user asks for up-to-date information, references, or fact checks. Example: "Search the latest Discord API changelog".');
      ctx.registerBrainTool({
        tool_id: 'rag_search_web',
        title: 'Search web with Tavily',
        description: 'Search the public web and return concise cited snippets. Example: "Find official docs about Discord slash command permissions".',
        call_event: 'rag.search_requested',
        input_schema: {
          query: 'string',
          max_results: 'number?',
          topic: '"general"|"news"?',
        },
        default_enabled: true,
      });
      ctx.registerToolReplyFormatter({
        tool_id: 'rag_search_web',
        build_payload({ call_results, actor }) {
          const result = Array.isArray(call_results) ? (call_results.find(Boolean) || null) : call_results;
          if (!result || result.ok === false) {
            return {
              content: `RAG search failed: ${String(result?.message || result?.reason || 'unknown_error')}`,
              title: 'RAG Search',
              tone: 'warning',
              followup: true,
              user: actor,
            };
          }
          const lines = buildSummaryLines(result.results || []);
          const summaryBlock = lines.length ? lines.join('\n\n') : 'No web results found.';
          const answer = String(result.answer || '').trim();
          const content = answer
            ? `Answer: ${truncateText(answer, 500)}\n\n${truncateText(summaryBlock, 1200)}`
            : truncateText(summaryBlock, 1500);
          return {
            content,
            title: `RAG Search · ${result.query || 'query'}`,
            tone: 'success',
            followup: true,
            llm_followup_hint: 'Call the next tool if needed, or report the result to the user.',
            user: actor,
          };
        },
      });

      addCommandDefinition(deps.runtimeState, new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search the web using Tavily')
        .addStringOption((option) => option.setName('query').setDescription('Search query').setRequired(true))
        .addIntegerOption((option) => option
          .setName('max_results')
          .setDescription('Maximum number of results (1-10)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10)));

      ctx.subscribe('rag.search_requested', async (payload) => {
        return await searchTavily(runtimeConfig, payload || {});
      });

      ctx.subscribe('discord.app_command', async ({ interaction }) => {
        if (!interaction || !interaction.isChatInputCommand() || interaction.commandName !== 'search') {
          return;
        }
        const query = interaction.options.getString('query', true);
        const maxResults = interaction.options.getInteger('max_results', false);
        const result = await searchTavily(runtimeConfig, {
          query,
          max_results: maxResults,
          topic: 'general',
        });

        if (!result.ok) {
          await replyToInteraction(interaction, {
            content: `Search failed: ${String(result.message || result.reason || 'unknown_error')}`,
            title: 'RAG Search',
            tone: 'warning',
            user: interaction.user,
            ephemeral: true,
          });
          return;
        }

        const lines = buildSummaryLines(result.results || []);
        const detailBlock = lines.length ? lines.join('\n\n') : 'No web results found.';
        const answer = String(result.answer || '').trim();
        const content = answer
          ? `Answer: ${truncateText(answer, 600)}\n\n${truncateText(detailBlock, 1400)}`
          : truncateText(detailBlock, 1800);

        await replyToInteraction(interaction, {
          content,
          title: `RAG Search · ${truncateText(result.query || query, 80)}`,
          tone: 'info',
          user: interaction.user,
        });

        ctx.publish('bot.command_executed', {
          command: 'search',
          guild: safeGuildName(interaction.guild),
          author: safeUserTag(interaction.user),
          payload: truncateText(query, 120),
        });
      });
    },
  };
};
