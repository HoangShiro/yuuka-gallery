#!/usr/bin/env node

const { Client, Events, Partials } = require('discord.js');

const { mapIntents } = require('./intents.cjs');
const { emit, createLogger } = require('./logging.cjs');
const { setupModules } = require('./setup_runtime.cjs');

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === '--config') {
      result.config = argv[i + 1];
      i += 1;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) {
    emit({ event: 'error', message: 'Missing --config payload.' });
    process.exit(2);
    return;
  }

  let config;
  try {
    config = JSON.parse(args.config);
  } catch (_) {
    emit({ event: 'error', message: 'Invalid JSON in --config payload.' });
    process.exit(2);
    return;
  }

  const token = String(config.token || '').trim();
  if (!token) {
    emit({ event: 'error', message: 'Discord token is missing.' });
    process.exit(2);
    return;
  }

  const logger = createLogger();
  const { activeNames, activeBits } = mapIntents(config.intents);
  emit({ event: 'intents', intents: activeNames });

  const client = new Client({ intents: activeBits, partials: [Partials.Channel] });
  const { runtimeState, onReady } = setupModules(client, config.modules, config, logger);
  let shuttingDown = false;
  let hasFlushedState = false;

  const flushRuntimeState = () => {
    if (hasFlushedState) {
      return;
    }
    hasFlushedState = true;
    if (runtimeState && typeof runtimeState.flushPersist === 'function') {
      runtimeState.flushPersist();
    }
  };

  const beginShutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.log('info', 'Stopping discord.js client...');
    try {
      await client.destroy();
    } catch (error) {
      logger.log('warning', `Error during shutdown: ${error.message || String(error)}`);
    } finally {
      flushRuntimeState();
      emit({ event: 'stopped' });
      process.exit(0);
    }
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    const raw = String(chunk || '').trim();
    const lines = raw.split('\n');
    for (const line of lines) {
      const payloadStr = line.trim();
      if (!payloadStr) continue;

      if (payloadStr.toUpperCase() === 'STOP') {
        beginShutdown().catch((error) => {
          emit({ event: 'error', message: error.message || String(error) });
          process.exit(1);
        });
        return;
      }
      
      try {
        if (payloadStr.startsWith('{')) {
          const payload = JSON.parse(payloadStr);
          if (payload.event === 'CONFIG_UPDATE' && payload.config) {
            Object.assign(config, payload.config);
            const { applyConfiguredPolicies } = require('./runtime_state.cjs');
            applyConfiguredPolicies(runtimeState, config.policies || {});
            logger.log('info', 'Configuration and policies hot-reloaded.');
          }

          if (payload.event === 'MEMO_UPDATE') {
            if (payload.conversation_key && payload.summary != null) {
              const existing = runtimeState.memo.conversationSummaries.get(payload.conversation_key) || {};
              runtimeState.memo.conversationSummaries.set(payload.conversation_key, {
                ...existing,
                summary: String(payload.summary),
                updated_at: new Date().toISOString()
              });
              logger.log('info', `Conversation summary updated for ${payload.conversation_key}`);
            }
            if (payload.actor_uid && payload.summary != null) {
              const existing = runtimeState.memo.actorSummaries.get(payload.actor_uid) || {};
              runtimeState.memo.actorSummaries.set(payload.actor_uid, {
                ...existing,
                summary: String(payload.summary),
                updated_at: new Date().toISOString()
              });
              logger.log('info', `Actor summary updated for ${payload.actor_uid}`);
            }
          }
        }
      } catch (err) {
        // ignore incomplete or malformed JSON chunks
      }
    }
  });

  process.on('SIGINT', () => {
    beginShutdown().catch(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    beginShutdown().catch(() => process.exit(1));
  });
  process.on('exit', () => {
    flushRuntimeState();
  });

  client.once(Events.ClientReady, async () => {
    const botName = client.user?.username || null;
    const botId = client.user?.id || null;
    const botTag = client.user?.tag || botName || 'unknown';
    const avatarUrl = client.user?.displayAvatarURL({ size: 128 }) || null;
    emit({
      event: 'ready',
      actual_name: botName,
      actual_id: botId,
      avatar_url: avatarUrl,
      intents: activeNames,
      started_at: new Date().toISOString(),
    });
    logger.log('info', `Connected as ${botTag} - Guilds: ${client.guilds.cache.size}`);
    try {
      if (client.application && runtimeState.commandDefinitions.length) {
        await client.application.commands.set(runtimeState.commandDefinitions);
        logger.log('info', `Registered ${runtimeState.commandDefinitions.length} global application commands.`);
      }
    } catch (error) {
      logger.log('warning', `Failed to register application commands: ${error.message || String(error)}`);
    }

    if (typeof onReady === 'function') {
      await onReady();
    }
  });

  client.on(Events.ShardDisconnect, () => {
    logger.log('warning', 'Disconnected from Discord gateway.');
  });

  client.on(Events.ShardResume, () => {
    logger.log('info', 'Session resumed from Discord.');
  });

  client.on(Events.Error, (error) => {
    emit({ event: 'error', message: error.message || String(error) });
  });

  try {
    logger.log('info', 'Logging in with discord.js...');
    await client.login(token);
  } catch (error) {
    emit({ event: 'error', message: error.message || String(error) });
    process.exit(1);
  }
}

main().catch((error) => {
  emit({ event: 'error', message: error.message || String(error) });
  process.exit(1);
});
