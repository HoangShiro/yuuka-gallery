const { requestChatBridge } = require('../chat_bridge.cjs');

module.exports = function createSummarizerModule(deps) {
  const { runtimeConfig, runtimeState, logger } = deps;
  const turnCounts = new Map();

  return {
    module_id: 'core.summarizer',
    name: 'Summarizer',
    setup(ctx) {
      ctx.subscribe('discord.message_create', async ({ message }) => {
        if (!message || message.author?.bot) return;

        const conversationKey = `guild:${message.guildId || 'dm'}:channel:${message.channelId}`;
        const count = (turnCounts.get(conversationKey) || 0) + 1;
        turnCounts.set(conversationKey, count);

        // Summarize every 10 messages
        if (count % 10 === 0) {
          try {
            const turns = runtimeState.memo.conversationTurns.get(conversationKey) || [];
            if (turns.length < 5) return;

            const payload = {
              user_hash: runtimeConfig.user_hash,
              mode: 'summarize_conversation',
              conversation_key: conversationKey,
              history: turns.map(t => `${t.actor_name}: ${t.text}`).join('\n')
            };

            logger.log('info', `Requesting background summarization for ${conversationKey}`);
            
            requestChatBridge(runtimeConfig, payload).then(resp => {
              if (resp && resp.status === 'success' && resp.summary) {
                // Check if history was cleared in the meantime
                const currentTurns = runtimeState.memo.conversationTurns.get(conversationKey) || [];
                if (currentTurns.length === 0) {
                  logger.log('info', `Aborting conversation summarization for ${conversationKey} - history was reset.`);
                  return;
                }

                const existing = runtimeState.memo.conversationSummaries.get(conversationKey) || {};
                runtimeState.memo.conversationSummaries.set(conversationKey, {
                  ...existing,
                  summary: String(resp.summary),
                  updated_at: new Date().toISOString()
                });
                logger.log('info', `Background conversation summary updated for ${conversationKey}`);
              }
            }).catch(err => {
               logger.log('warning', `Summarization failed: ${err.message}`);
            });
          } catch (err) {
            logger.log('warning', `Summarizer error: ${err.message}`);
          }
        }

        // Also summarize actor facts
        const actorId = String(message.author.id);
        const aCount = (turnCounts.get(`actor:${actorId}`) || 0) + 1;
        turnCounts.set(`actor:${actorId}`, aCount);

        if (aCount % 10 === 0) {
          try {
            const turns = runtimeState.memo.conversationTurns.get(conversationKey) || [];
            const actorTurns = turns.filter(t => t.actor_uid === actorId).slice(-10);
            if (actorTurns.length < 5) return;

            const payload = {
              user_hash: runtimeConfig.user_hash,
              mode: 'summarize_actor',
              actor_id: actorId,
              actor_name: String(message.author.globalName || message.author.username),
              history: actorTurns.map(t => t.text).join('\n')
            };

            logger.log('info', `Requesting actor summarization for ${actorId}`);
            requestChatBridge(runtimeConfig, payload).then(resp => {
              if (resp && resp.status === 'success' && resp.summary) {
                // Check if history was recently reset for this actor
                const currentTurns = runtimeState.memo.conversationTurns.get(conversationKey) || [];
                if (currentTurns.length === 0) {
                     return;
                }
                
                const existing = runtimeState.memo.actorSummaries.get(actorId) || {};
                runtimeState.memo.actorSummaries.set(actorId, {
                  ...existing,
                  summary: String(resp.summary),
                  updated_at: new Date().toISOString()
                });
                logger.log('info', `Actor summary updated for ${actorId}`);
              }
            }).catch(err => {
               logger.log('warning', `Actor summarization failed: ${err.message}`);
            });
          } catch (err) {
             // 
          }
        }
      });

      ctx.subscribe('bot.command_executed', (payload) => {
        if (!payload || payload.command !== 'chat-reset') return;
        
        // Reset turn count progress when session is reset
        if (payload.conversation_key) {
           turnCounts.delete(payload.conversation_key);
           logger.log('info', `Reset turn counters for ${payload.conversation_key}`);
        }
      });
    }
  };
};
