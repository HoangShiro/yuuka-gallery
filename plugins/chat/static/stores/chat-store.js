(function registerChatStore(namespace) {
    const ChatAPI = window.Yuuka.plugins.chat.services.ChatAPI;

    class ChatStore extends EventTarget {
        /**
         * Insert a transient assistant placeholder to show typing dots for continuation on narrow/mobile
         * or when backend uses non-streaming jobs. It will be replaced on next history refresh.
         */
        startContinuationPlaceholder(characterId) {
            try {
                if (!characterId) return null;
                const placeId = `placeholder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
                const placeholder = {
                    id: placeId,
                    role: "assistant",
                    type: "text",
                    content: { text: "" },
                    metadata: { streaming: true, transient: true, placeholder: true },
                };
                if (this.state.activeCharacterId === characterId) {
                    const next = Array.isArray(this.state.activeHistory) ? [...this.state.activeHistory, placeholder] : [placeholder];
                    this.state.activeHistory = next;
                    this._emit("active-character", {
                        characterId,
                        definition: this.state.activeCharacterDefinition,
                        messages: this.state.activeHistory,
                    });
                }
                return placeId;
            } catch (err) {
                console.warn("[ChatStore] Failed to create continuation placeholder", err);
                return null;
            }
        }
        async regenMessageStreaming(characterId, payload) {
            let settled = false;
            let resolveFinal;
            let rejectFinal;
            const completion = new Promise((resolve, reject) => {
                resolveFinal = resolve;
                rejectFinal = reject;
            });
            if (payload?.message_id) {
                this._startLocalRegeneration(characterId, payload.message_id);
            }
            const stream = this.api.streamRegeneration(characterId, payload, {
                sessionId: this.state.activeSessionId,
                onEvent: (event) => {
                    try {
                        this._handleStreamEvent(characterId, event);
                        if (event?.type === "done") {
                            settled = true;
                            resolveFinal?.(event.message || null);
                            void this.refreshSessions();
                        } else if (event?.type === "error") {
                            settled = true;
                            rejectFinal?.(new Error(event.error || "Streaming failed"));
                            void this.refreshSessions();
                        }
                    } catch (err) {
                        console.error("[ChatStore] Stream event handling failed", err);
                    }
                },
            });
            stream.done
                .then(() => {
                    if (!settled) {
                        settled = true;
                        resolveFinal?.(null);
                    }
                })
                .catch(error => {
                    settled = true;
                    rejectFinal?.(error);
                });
            const resultPromise = completion.finally(() => {
                if (!settled) {
                    stream.cancel?.();
                }
            });
            return resultPromise;
        }
        constructor(apiInstance) {
            super();
            this.api = apiInstance || new ChatAPI();
            this.state = {
                characters: [],
                sessions: [],
                settings: null,
                activeCharacterId: null,
                activeSessionId: null,
                activeCharacterDefinition: null,
                activeHistory: [],
                jobs: new Map(),
            };
            this._jobTimers = new Map();
            this.jobPollInterval = 4000;
        }

        destroy() {
            this._jobTimers.forEach(timeoutId => clearTimeout(timeoutId));
            this._jobTimers.clear();
        }

        on(eventName, listener) {
            this.addEventListener(eventName, listener);
            return () => this.removeEventListener(eventName, listener);
        }

        _emit(eventName, detail) {
            this.dispatchEvent(new CustomEvent(eventName, { detail }));
        }

        async bootstrap() {
            await Promise.all([
                this.refreshCharacters(),
                this.refreshSessions(),
                this.loadSettings(),
            ]);
        }

        async refreshCharacters() {
            const response = await this.api.getCharacterCards();
            this.state.characters = response.characters || [];
            if (typeof console !== "undefined") {
                console.debug("[ChatStore] Loaded character cards:", this.state.characters.length);
            }
            this._emit("characters", { characters: this.state.characters });
            return this.state.characters;
        }

        async refreshSessions() {
            const response = await this.api.listSessions();
            this.state.sessions = response.sessions || [];
            if (typeof console !== "undefined") {
                console.debug("[ChatStore] Loaded chat sessions:", this.state.sessions.length);
            }
            this._emit("sessions", { sessions: this.state.sessions });
            return this.state.sessions;
        }

        async loadSettings() {
            this.state.settings = await this.api.getSettings();
            this._emit("settings", { settings: this.state.settings });
            return this.state.settings;
        }

        async saveSettings(payload) {
            this.state.settings = await this.api.saveSettings(payload);
            this._emit("settings", { settings: this.state.settings });
            return this.state.settings;
        }

        async selectCharacter(characterId, sessionId = null) {
            if (!characterId) {
                this.state.activeCharacterId = null;
                this.state.activeSessionId = null;
                this.state.activeCharacterDefinition = null;
                this.state.activeHistory = [];
                this._emit("active-character", { characterId: null });
                return;
            }

            const response = await this.api.getHistory(characterId, sessionId);
            this.state.activeCharacterId = characterId;
            this.state.activeSessionId = response.session_id || sessionId || null;
            this.state.activeCharacterDefinition = response.definition || null;
            this.state.activeHistory = response.messages || [];
            this._emit("active-character", {
                characterId,
                sessionId: this.state.activeSessionId,
                definition: this.state.activeCharacterDefinition,
                messages: this.state.activeHistory,
            });
            return response;
        }

        async saveCharacterDefinition(characterId, payload) {
            let response;
            let resolvedId = characterId;

            if (characterId) {
                response = await this.api.saveCharacterDefinition(characterId, payload);
                resolvedId = response?.id || characterId;
            } else {
                response = await this.api.createCharacterDefinition(payload);
                resolvedId = response?.id || null;
            }

            await this.refreshCharacters();
            await this.refreshSessions();
            let latest = null;
            if (resolvedId) {
                const history = await this.selectCharacter(resolvedId);
                latest = history?.definition || response?.definition || payload;
            } else {
                await this.selectCharacter(null);
            }

            return {
                id: resolvedId,
                definition: latest || response?.definition || payload,
            };
        }

        async deleteCharacter(characterId) {
            await this.api.deleteCharacterDefinition(characterId);
            if (this.state.activeCharacterId === characterId) {
                await this.selectCharacter(null);
            }
            await Promise.all([this.refreshCharacters(), this.refreshSessions()]);
        }

        async addMessage(characterId, payload, options = {}) {
            const useStream = options.stream ?? this._shouldUseStreaming();
            if (useStream) {
                return this._sendMessageStreaming(characterId, payload);
            }

            const response = await this.api.createMessage(characterId, payload, this.state.activeSessionId);
            const message = response?.message || response;

            if (message) {
                if (this.state.activeCharacterId === characterId) {
                    this.state.activeHistory = [...this.state.activeHistory, message];
                    this._emit("active-character", {
                        characterId,
                        definition: this.state.activeCharacterDefinition,
                        messages: this.state.activeHistory,
                    });
                }
                await this.refreshSessions();
            }

            if (response?.job && response.job.job_id) {
                this.trackJob(response.job.job_id);
            }

            return response;
        }

        _shouldUseStreaming() {
            const provider = (this.state.settings?.provider || "").toLowerCase();
            return provider === "openai" || provider === "gemini";
        }

        _sendMessageStreaming(characterId, payload) {
            let settled = false;
            let resolveFinal;
            let rejectFinal;
            const completion = new Promise((resolve, reject) => {
                resolveFinal = resolve;
                rejectFinal = reject;
            });

            const settleResolve = (value) => {
                if (settled) return;
                settled = true;
                resolveFinal?.(value);
            };
            const settleReject = (error) => {
                if (settled) return;
                settled = true;
                rejectFinal?.(error);
            };

            const stream = this.api.streamMessage(characterId, payload, {
                sessionId: this.state.activeSessionId,
                onEvent: (event) => {
                    try {
                        this._handleStreamEvent(characterId, event);
                        if (event?.type === "done") {
                            settleResolve(event.message || null);
                            void this.refreshSessions();
                        } else if (event?.type === "error") {
                            settleReject(new Error(event.error || "Streaming failed"));
                            void this.refreshSessions();
                        }
                    } catch (err) {
                        console.error("[ChatStore] Stream event handling failed", err);
                    }
                },
            });

            stream.done
                .then(() => {
                    if (!settled) {
                        settleResolve(null);
                    }
                })
                .catch(error => {
                    settleReject(error);
                });

            const resultPromise = completion.finally(() => {
                if (!settled) {
                    stream.cancel?.();
                }
            });

            return resultPromise;
        }

        _handleStreamEvent(characterId, event) {
            if (!event || typeof event !== "object") {
                return;
            }
            const { type } = event;
            if (type === "user_message" && event.message) {
                this._mergeMessageIntoHistory(characterId, event.message);
                return;
            }
            if (type === "assistant_message" && event.message) {
                this._mergeMessageIntoHistory(characterId, event.message);
                return;
            }
            if (type === "delta") {
                this._applyStreamDelta(characterId, event);
                return;
            }
            if (type === "done" && event.message) {
                this._mergeMessageIntoHistory(characterId, event.message);
                return;
            }
            if (type === "error") {
                const errorMessage = event.error || "Streaming failed";
                console.error("[ChatStore] Streaming error event", errorMessage);
                const messageId = event.message_id;
                if (messageId && this.state.activeCharacterId === characterId) {
                    if (event.remove_message) {
                        const nextHistory = this.state.activeHistory.filter(item => item.id !== messageId);
                        if (nextHistory.length !== this.state.activeHistory.length) {
                            this.state.activeHistory = nextHistory;
                            this._emit("active-character", {
                                characterId,
                                definition: this.state.activeCharacterDefinition,
                                messages: this.state.activeHistory,
                            });
                        }
                    } else if (event.message) {
                        this._mergeMessageIntoHistory(characterId, event.message);
                    }
                }
                this._emit("error", {
                    characterId,
                    messageId,
                    error: errorMessage,
                });
            }
        }

        _mergeMessageIntoHistory(characterId, message) {
            if (!message) {
                return;
            }
            if (this.state.activeCharacterId !== characterId) {
                return;
            }
            const existingIndex = this.state.activeHistory.findIndex(item => item.id === message.id);
            if (existingIndex === -1) {
                // Nếu là assistant, khởi tạo snapshots
                if (message.role === "assistant") {
                    const text = message.content?.text ?? "";
                    const streamingFlag = Boolean(message.metadata?.streaming);
                    if (streamingFlag) {
                        message.snapshots = [text];
                    } else {
                        message.snapshots = text ? [text] : [];
                    }
                }
                this.state.activeHistory = [...this.state.activeHistory, message];
            } else {
                const existing = this.state.activeHistory[existingIndex];
                let snapshots = Array.isArray(existing.snapshots) ? [...existing.snapshots] : [];
                // Nếu là assistant, cập nhật snapshots
                if (message.role === "assistant") {
                    const text = message.content?.text ?? "";
                    const streamingFlag = Boolean(message.metadata?.streaming);
                    const prevStreaming = Boolean(existing.metadata?.streaming);
                    if (streamingFlag) {
                        if (!prevStreaming) {
                            snapshots = [...snapshots, text];
                        } else if (snapshots.length) {
                            snapshots = [...snapshots.slice(0, -1), text];
                        } else {
                            snapshots = [text];
                        }
                    } else if (prevStreaming) {
                        if (snapshots.length) {
                            snapshots = [...snapshots.slice(0, -1), text];
                        } else if (text) {
                            snapshots = [text];
                        }
                    } else if (text) {
                        const last = snapshots[snapshots.length - 1];
                        if (last !== text) {
                            snapshots = [...snapshots, text];
                        }
                    }
                }
                const merged = {
                    ...existing,
                    ...message,
                    content: {
                        ...(existing.content || {}),
                        ...(message.content || {}),
                    },
                    metadata: {
                        ...(existing.metadata || {}),
                        ...(message.metadata || {}),
                    },
                    snapshots,
                };
                this.state.activeHistory = [
                    ...this.state.activeHistory.slice(0, existingIndex),
                    merged,
                    ...this.state.activeHistory.slice(existingIndex + 1),
                ];
            }
            this._emit("active-character", {
                characterId,
                definition: this.state.activeCharacterDefinition,
                messages: this.state.activeHistory,
            });
        }

        _startLocalRegeneration(characterId, messageId) {
            if (!characterId || !messageId) {
                return;
            }
            if (this.state.activeCharacterId !== characterId) {
                return;
            }
            const existing = this.state.activeHistory.find(item => item.id === messageId);
            if (!existing || existing.role !== "assistant") {
                return;
            }
            const placeholder = {
                ...existing,
                content: {
                    ...(existing.content || {}),
                    text: "",
                },
                metadata: {
                    ...(existing.metadata || {}),
                    streaming: true,
                    regen: true,
                },
            };
            this._mergeMessageIntoHistory(characterId, placeholder);
        }

        _applyStreamDelta(characterId, event) {
            if (this.state.activeCharacterId !== characterId) {
                return;
            }
            const messageId = event.message_id;
            if (!messageId) {
                return;
            }
            const text = event.text ?? "";
            const existingIndex = this.state.activeHistory.findIndex(item => item.id === messageId);
            if (existingIndex === -1) {
                const message = event.message || {
                    id: messageId,
                    role: "assistant",
                    character_id: characterId,
                    content: { text },
                };
                if (!message.content) {
                    message.content = { text };
                } else {
                    message.content = { ...message.content, text };
                }
                this._mergeMessageIntoHistory(characterId, message);
                return;
            }
            const existing = this.state.activeHistory[existingIndex];
            const merged = {
                ...existing,
                content: {
                    ...(existing.content || {}),
                    text,
                },
                metadata: {
                    ...(existing.metadata || {}),
                    ...((event.message && event.message.metadata) || {}),
                },
            };
            this.state.activeHistory = [
                ...this.state.activeHistory.slice(0, existingIndex),
                merged,
                ...this.state.activeHistory.slice(existingIndex + 1),
            ];
            this._emit("active-character", {
                characterId,
                definition: this.state.activeCharacterDefinition,
                messages: this.state.activeHistory,
            });
        }

        async updateMessage(characterId, messageId, payload) {
            const message = await this.api.updateMessage(characterId, messageId, payload, this.state.activeSessionId);
            if (this.state.activeCharacterId === characterId) {
                this.state.activeHistory = this.state.activeHistory.map(msg =>
                    msg.id === messageId ? { ...msg, ...message } : msg
                );
                this._emit("active-character", {
                    characterId,
                    definition: this.state.activeCharacterDefinition,
                    messages: this.state.activeHistory,
                });
            }
            return message;
        }

        async deleteMessage(characterId, messageId) {
            await this.api.deleteMessage(characterId, messageId, this.state.activeSessionId);
            if (this.state.activeCharacterId === characterId) {
                const history = this.state.activeHistory || [];
                const targetIdx = history.findIndex(msg => msg.id === messageId);
                if (targetIdx !== -1) {
                    this.state.activeHistory = history.slice(0, targetIdx);
                }
                this._emit("active-character", {
                    characterId,
                    definition: this.state.activeCharacterDefinition,
                    messages: this.state.activeHistory,
                });
            }
            await this.refreshSessions();
        }

        async setSelectedSnapshotIndex(characterId, messageId, snapshotIndex) {
            if (!characterId || !messageId || typeof snapshotIndex !== "number" || snapshotIndex < 0) {
                return;
            }
            if (this.state.activeCharacterId === characterId) {
                const history = this.state.activeHistory || [];
                const targetIdx = history.findIndex(item => item.id === messageId);
                if (targetIdx !== -1) {
                    const existing = history[targetIdx];
                    const currentIndex = existing?.metadata?.selected_snapshot_index;
                    if (currentIndex !== snapshotIndex) {
                        const updated = {
                            ...existing,
                            metadata: { ...(existing.metadata || {}), selected_snapshot_index: snapshotIndex },
                        };
                        this.state.activeHistory = [
                            ...history.slice(0, targetIdx),
                            updated,
                            ...history.slice(targetIdx + 1),
                        ];
                        this._emit("active-character", {
                            characterId,
                            definition: this.state.activeCharacterDefinition,
                            messages: this.state.activeHistory,
                        });
                    }
                }
            }
            try {
                await this.updateMessage(characterId, messageId, {
                    metadata: { selected_snapshot_index: snapshotIndex },
                });
            } catch (err) {
                console.error("[ChatStore] Failed to persist snapshot selection", err);
            }
        }

        async queueAction(characterId, action, payload) {
            let response;
            if (action === "regen") {
                if (this._shouldUseStreaming()) {
                    response = await this.regenMessageStreaming(characterId, payload);
                } else {
                    response = await this.api.requestRegeneration(characterId, payload, this.state.activeSessionId);
                    if (response && response.job_id) {
                        this.trackJob(response.job_id);
                    }
                }
            } else if (action === "swipe") {
                response = await this.api.requestSwipe(characterId, payload, this.state.activeSessionId);
                if (response && response.job_id) {
                    this.trackJob(response.job_id);
                }
            } else if (action === "continue") {
                if (this._shouldUseStreaming()) {
                    // Stream a synthetic user message that asks to continue
                    const prompt = (payload && payload.prompt) || "[Continue]";
                    response = await this._sendMessageStreaming(characterId, {
                        role: "user",
                        type: "text",
                        content: { text: prompt },
                        metadata: { seed: payload?.seed, continue: true, instruction: true, transient: true },
                    });
                } else {
                    response = await this.api.requestContinuation(characterId, payload, this.state.activeSessionId);
                    if (response && response.job_id) {
                        this.trackJob(response.job_id);
                    }
                }
            } else {
                throw new Error(`Unsupported action: ${action}`);
            }
            return response;
        }

        async createNewChatSession(characterId) {
            const data = await this.api.createNewSession(characterId);
            const newSessionId = data?.session_id || null;
            await this.refreshSessions();
            await this.selectCharacter(characterId, newSessionId);
            return { characterId, sessionId: newSessionId };
        }

        trackJob(jobId) {
            if (!jobId || this._jobTimers.has(jobId)) {
                return;
            }

            const poll = async () => {
                try {
                    const status = await this.api.getJobStatus(jobId);
                    this.state.jobs.set(jobId, status);
                    this._emit("jobs", { jobId, status });
                    if (status.status === "queued" || status.status === "running") {
                        const timer = setTimeout(poll, this.jobPollInterval);
                        this._jobTimers.set(jobId, timer);
                    } else {
                        if (status.status === "completed" && status.message && status.message.character_id) {
                            if (this.state.activeCharacterId === status.message.character_id) {
                                await this.selectCharacter(status.message.character_id);
                            }
                            await this.refreshSessions();
                        }
                        this._jobTimers.delete(jobId);
                    }
                } catch (err) {
                    console.error("[ChatStore] Failed to poll job", jobId, err);
                    this._jobTimers.delete(jobId);
                }
            };

            poll();
        }
    }

    namespace.ChatStore = ChatStore;
})(window.Yuuka.plugins.chat.stores);
