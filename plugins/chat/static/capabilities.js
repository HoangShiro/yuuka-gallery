function registerChatCapabilitiesAtLoad(windowObj = window) {
    (function () {
        try {
            const g = windowObj.Yuuka = windowObj.Yuuka || {};
            g.services = g.services || {};
            const caps = g.services.capabilities;
            if (!caps || typeof caps.register !== 'function') return;

            const safeRegister = (def) => {
                try {
                    return caps.register(def);
                } catch (e) {
                    console.warn('[Chat] Failed to register capability', def && def.id, e);
                    return null;
                }
            };

            safeRegister({
                id: 'chat.generate_reply',
                pluginId: 'chat',
                title: 'Generate chat reply',
                description: 'Generate a character reply and persist chat history in Chat plugin session storage.',
                type: 'action',
                tags: ['chat', 'llm', 'persona', 'session'],
                llmCallable: false,
                paramsSchema: {
                    type: 'object',
                    properties: {
                        character_id: { type: 'string', description: 'Character persona id from chat personas.' },
                        user_message: { type: 'string', description: 'Incoming user message.' },
                        session_id: { type: 'string', description: 'Optional stable session id.' },
                        model: { type: 'string', description: 'Optional model override.' },
                        temperature: { type: 'number', description: 'Optional temperature override.' },
                        user_name: { type: 'string', description: 'Optional display name in prompt.' },
                        user_persona: { type: 'string', description: 'Optional user persona text.' },
                        discord_context: {
                            type: 'object',
                            description: 'Optional Discord context metadata injected into prompt.',
                        },
                    },
                    required: ['character_id', 'user_message'],
                },
                example: {
                    defaultPayload: {
                        character_id: 'demo_character_id',
                        session_id: 'discord:guild:channel:user',
                        user_message: 'Xin chao, hom nay ban the nao?',
                        model: 'deepseek-v3.1:671b-cloud',
                        discord_context: {
                            guild_name: 'My Discord Guild',
                            channel_name: 'general',
                            author_tag: 'user#0001',
                        },
                    },
                    notes: 'Capability backend-first. Chat plugin tu build context + call LLM + save history cho session.',
                },
                async invoke(args = {}, ctx = {}) {
                    const apiRef = (typeof api !== 'undefined') ? api : windowObj.api;
                    if (!apiRef || !apiRef.chat || typeof apiRef.chat.post !== 'function') {
                        throw new Error('Chat API không khả dụng.');
                    }
                    return await apiRef.chat.post('/generate/discord_bridge', args || {});
                },
            });

            safeRegister({
                id: 'chat.reset_session',
                pluginId: 'chat',
                title: 'Reset chat session',
                description: 'Reset an existing chat session history while keeping persona selection.',
                type: 'action',
                tags: ['chat', 'session', 'reset'],
                llmCallable: false,
                paramsSchema: {
                    type: 'object',
                    properties: {
                        character_id: { type: 'string', description: 'Character persona id from chat personas.' },
                        session_id: { type: 'string', description: 'Stable session id to reset.' },
                    },
                    required: ['character_id', 'session_id'],
                },
                async invoke(args = {}, ctx = {}) {
                    const apiRef = (typeof api !== 'undefined') ? api : windowObj.api;
                    if (!apiRef || !apiRef.chat || typeof apiRef.chat.post !== 'function') {
                        throw new Error('Chat API không khả dụng.');
                    }
                    return await apiRef.chat.post('/generate/discord_bridge', {
                        ...(args || {}),
                        reset_session: true,
                    });
                },
            });
        } catch (e) {
            console.warn('[Chat] Capability bootstrap failed:', e);
        }
    })();
}

if (typeof window !== 'undefined') {
    try {
        registerChatCapabilitiesAtLoad(window);
    } catch (e) {
        console.warn('[Chat] Failed to auto-register capabilities:', e);
    }
}
