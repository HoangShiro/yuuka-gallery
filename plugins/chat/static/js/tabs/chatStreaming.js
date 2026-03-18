Object.assign(window.ChatComponent.prototype, {
    // --- Chat Streaming & Message Sending ---

    _sendMessage(content) {
        if (this.state.currentAbortController) {
            console.log("[Chat] User interrupted stream. Aborting current background stream.");
            this.state.currentAbortController.abort();
            this.state.currentAbortController = null;
        }
        this.state.isStreaming = false;
        this._setStreamingUI(false);

        const charHash = this.state.activeChatCharacterHash;

        // Capture status BEFORE flush so status_before on the assistant message reflects
        // state prior to any gift/action being applied.
        const statusBefore = window.HistoryStateEngine.capture(
            this.state.activeChatSession, charHash
        );

        // Flush pending actions — collects action items for snapshot[3] display.
        // State changes (inventory, action_state) are applied AFTER the assistant replies,
        // during stream processing in _parseAndCleanContent.
        const pendingActionsSnapshot = this.state.pendingActions ? [...this.state.pendingActions] : [];
        const flushedActions = this._flushPendingActionsToMessages
            ? this._flushPendingActionsToMessages()
            : [];
        this._clearPendingActions && this._clearPendingActions();

        this.state.activeChatSession.messages.push({
            role: 'user',
            snapshots: [['', [], null, flushedActions.length > 0 ? flushedActions : null]],
            activeIndex: 0
        });
        // Set the actual content on the snapshot
        this.state.activeChatSession.messages[this.state.activeChatSession.messages.length - 1].snapshots[0][0] = content;

        this.state.activeChatSession.messages.push({
            role: 'assistant',
            snapshots: [''],
            activeIndex: 0
        });

        this.renderMessages();

        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};

        const contextMessages = this.flattenMessages(
            this.state.activeChatSession.messages.slice(0, -1)
        );

        const assistantIndex = this.state.activeChatSession.messages.length - 1;

        this._streamChatResponse(charObj, userObj, contextMessages, assistantIndex, statusBefore, pendingActionsSnapshot);
    },

    async _streamChatResponse(charObj, userObj, contextMessages, targetIndex, statusBefore = null, pendingActions = []) {
        this.state.isStreaming = true;
        this._setStreamingUI(true);

        const targetMsg = this.state.activeChatSession.messages[targetIndex];
        if (!targetMsg) {
            console.error('[Chat] Target message not found at index', targetIndex);
            this.state.isStreaming = false;
            this._setStreamingUI(false);
            return;
        }

        const charHash = this.state.activeChatCharacterHash;
        window.HistoryStateEngine.ensureCharState(this.state.activeChatSession, charHash);

        // Use pre-flush statusBefore if provided (from _sendMessage), otherwise capture now (regen path)
        if (!statusBefore) {
            statusBefore = window.HistoryStateEngine.capture(this.state.activeChatSession, charHash);
        }
        window.HistoryStateEngine.beginTurn();

        const controller = new AbortController();
        this.state.currentAbortController = controller;

        let foundCapabilityCall = null;
        let hasHitSystemTags = false;

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken} `;

            // Build advanced contextual system prompt
            let contextualSystemInfo = '';
            const memorySummary = this.state.activeChatSession.memory_summary || '';
            if (memorySummary) {
                contextualSystemInfo += `\n\n[PAST CONTEXT SUMMARY]\n${memorySummary} \n[/PAST CONTEXT SUMMARY]\n`;
            }
            // Truncate messages to a short-term sliding window (e.g., last 20 messages)
            // to optimize token usage and rely on the summary for older context.
            const MAX_WINDOW_SIZE = 20;
            const windowedMessages = contextMessages.slice(-MAX_WINDOW_SIZE);

            const res = await fetch('/api/plugin/chat/generate/chat_stream', {
                method: 'POST',
                body: JSON.stringify({
                    character_name: charObj.name || '',
                    character_persona: charObj.persona || '',
                    character_appearance: charObj.appearance || [],
                    chat_sample: charObj.chat_sample || '',
                    user_name: userObj.name || '',
                    user_persona: userObj.persona || '',
                    messages: windowedMessages,
                    system_prompt: contextualSystemInfo,
                    session_state: {
                        location: statusBefore.location,
                        outfits: statusBefore.outfits,
                        inventory: statusBefore.inventory
                    },
                    available_capabilities: (window.Yuuka?.services?.capabilities?.getCapabilities && window.Yuuka.services.capabilities.getCapabilities()) || [],
                    emotion_rules: (this.emotionEngine && this.emotionEngine.rules) ? this.emotionEngine.rules : null,
                    action_rules: (this.actionEngine && this.actionEngine.rules) ? this.actionEngine.rules : null,
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                }),
                headers: headers,
                signal: controller.signal
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText);
            }

            // Immediately force a render to ensure the new empty assistant bubble 
            // is attached to the DOM so we can fetch it for the typing indicator
            this.renderMessages();

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let fullText = '';

            const allWrappers = this.container.querySelectorAll('.chat-bubble-wrapper');
            let targetBubble = null;
            allWrappers.forEach(w => {
                if (parseInt(w.dataset.msgIndex) === targetIndex) {
                    targetBubble = w.querySelector('.chat-bubble .text');
                }
            });

            if (targetBubble) {
                targetBubble.classList.add('streaming');
                targetBubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            }

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    fullText += chunk;

                    // Use captured reference instead of index lookup
                    targetMsg.snapshots[targetMsg.activeIndex] = fullText;

                    if (!hasHitSystemTags) {
                        const checkMatch = fullText.match(/<(system_update|call_capability)/i);
                        if (checkMatch) {
                            hasHitSystemTags = true;
                            this.state.isStreaming = false;
                            this._setStreamingUI(false);
                            if (targetBubble) {
                                targetBubble.classList.remove('streaming');
                            }
                        }
                    }

                    if (targetBubble) {
                        targetBubble.innerHTML = this.formatMessageContent(fullText);
                        const messagesContainer = this.container.querySelector('#chat-messages-container');
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }

                    const capMatch = fullText.match(/<call_capability\s+name="([^"]+)">([\s\S]*?)<\/call_capability>/i);
                    if (capMatch) {
                        foundCapabilityCall = { name: capMatch[1], payload: capMatch[2] };
                        controller.abort();
                        break;
                    }
                }
            }

            if (targetBubble) {
                targetBubble.classList.remove('streaming');
            }

            console.log('[Chat] LLM raw output:', fullText);

            // Apply deferred gift/duo_action BEFORE parsing system_update.
            // This way if LLM does "put_on: [gifted_item]", the item is already in inventory
            // so _parseAndCleanContent can correctly move it from inventory → outfits.
            if (pendingActions.length > 0) {
                const cs = window.HistoryStateEngine.ensureCharState(this.state.activeChatSession, charHash);
                pendingActions.forEach(action => {
                    if (action.type === 'gift') {
                        // Store item name (not tags) — tags are resolved at image gen time
                        const itemName = action.data?.name || action.chipLabel;
                        if (itemName) {
                            if (!cs.inventory) cs.inventory = [];
                            if (!cs.inventory.includes(itemName)) cs.inventory.push(itemName);
                        }
                    } else if (action.type === 'duo_action') {
                        const actionType = action.data?.actionType;
                        if (actionType && this.actionEngine) {
                            if (!cs.action_state) cs.action_state = {};
                            cs.action_state = this.actionEngine.applyDelta(cs.action_state,
                                { action: [actionType], stop_action: [] });
                        }
                    }
                });
            }

            fullText = this._parseAndCleanContent(fullText, false, targetIndex);
            targetMsg.snapshots[targetMsg.activeIndex] = fullText;

            // Write status_after into snapshot[2] via engine
            const statusAfter = window.HistoryStateEngine.capture(this.state.activeChatSession, charHash);
            window.HistoryStateEngine.writeStatus(targetMsg, targetMsg.activeIndex, statusAfter);

            // Collect outfit/stamina side-effect cards and write into snapshot[3]
            const sideEffectCards = window.HistoryStateEngine.flushPendingCards();
            // Also gather linked_outfit_changes from the message itself (set by _parseAndCleanContent)
            const outfitCards = (targetMsg.linked_outfit_changes || []).map(c => ({
                type: 'outfit_change',
                label: c.label
            }));
            delete targetMsg.linked_outfit_changes;
            // Gift cards — show what was received this turn
            const giftCards = pendingActions
                .filter(a => a.type === 'gift')
                .map(a => ({
                    type: 'gift_received',
                    item: a.data?.name || a.chipLabel || '',
                    sender: this._getActiveUserName()
                }));
            // Manual outfit_change cards from drag-drop
            const manualOutfitCards = pendingActions
                .filter(a => a.type === 'outfit_change')
                .map(a => ({ type: 'outfit_change', label: a.label }));
            const allActionContext = [...giftCards, ...manualOutfitCards, ...outfitCards, ...sideEffectCards];
            if (allActionContext.length > 0) {
                window.HistoryStateEngine.writeActionContext(targetMsg, targetMsg.activeIndex, allActionContext);
            }

            this._saveCurrentSession();
            this.renderMessages();

            // --- XML Parser: Capability Handling ---
            if (foundCapabilityCall) {
                let callResult = "";
                try {
                    const payload = JSON.parse(foundCapabilityCall.payload);
                    const capsSvc = window.Yuuka?.services?.capabilities;
                    if (capsSvc && typeof capsSvc.getCapabilities === 'function') {
                        const caps = capsSvc.getCapabilities();
                        const cap = caps.find(c => c.id === foundCapabilityCall.name || c.llmName === foundCapabilityCall.name);
                        if (cap && typeof cap.invoke === 'function') {
                            const rawRes = await cap.invoke(payload, { source: 'chat_llm' });
                            callResult = JSON.stringify(rawRes);
                        } else {
                            callResult = "Error: Capability not found or not invocable.";
                        }
                    } else {
                        callResult = "Error: Capabilities service not available.";
                    }
                } catch (ce) {
                    callResult = "Error parsing capability payload or invoking: " + ce.message;
                }

                this.state.activeChatSession.messages.push({
                    role: 'system',
                    snapshots: [`[Capability ${foundCapabilityCall.name} result]: \n${callResult} `],
                    activeIndex: 0
                });
                this.state.activeChatSession.messages.push({
                    role: 'assistant',
                    snapshots: [''],
                    activeIndex: 0
                });
                this._saveCurrentSession();
                this.renderMessages();

                const newContextMsgs = this.flattenMessages(this.state.activeChatSession.messages.slice(0, -1));
                const newAssistantIdx = this.state.activeChatSession.messages.length - 1;
                // Clean up current context before recursive call
                this.state.isStreaming = false;
                this.state.currentAbortController = null;
                this._setStreamingUI(false);
                return this._streamChatResponse(charObj, userObj, newContextMsgs, newAssistantIdx);
            }

        } catch (err) {
            if (err.name === 'AbortError' || (err.message && err.message.includes('aborted'))) {
                console.log("[Chat] Stream aborted by user. Skipping background updates.");

                // Keep whatever text was generated so far
                if (targetMsg) {
                    let cleanedText = fullText;
                    cleanedText = cleanedText.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '');
                    cleanedText = cleanedText.replace(/<call_capability[^>]*>[\s\S]*?(<\/call_capability>|$)/gi, '');
                    cleanedText = cleanedText.replace(/<emotion_update>[\s\S]*?(<\/emotion_update>|$)/gi, '');
                    cleanedText = cleanedText.trim();

                    if (cleanedText === '') {
                        // If no text was generated at all, remove the empty assistant message bubble
                        const idx = this.state.activeChatSession.messages.indexOf(targetMsg);
                        if (idx !== -1) {
                            this.state.activeChatSession.messages.splice(idx, 1);
                        }
                    } else {
                        // Save the partial text generated so far
                        targetMsg.snapshots[targetMsg.activeIndex] = cleanedText;
                    }
                }

                this._syncStatusToUI();
                this._saveCurrentSession();
                this.renderMessages();

            } else {
                console.error(err);
                if (targetMsg && targetMsg.snapshots[targetMsg.activeIndex] === '') {
                    const idx = this.state.activeChatSession.messages.indexOf(targetMsg);
                    if (idx !== -1) this.state.activeChatSession.messages.splice(idx, 1);
                }
                this.renderMessages();
                alert("Lỗi khi chat: " + (err.message || err));
            }
        } finally {
            if (this.state.currentAbortController === controller) {
                this.state.isStreaming = false;
                this.state.currentAbortController = null;
                this._setStreamingUI(false);
            }

            // Asynchronously trigger memory compression if the buffer gets large
            this._triggerMemoryCompression();

            // Auto Image Generation
            const autoGenToggle = this.container.querySelector('#chat-image-gen-every-message');
            if (autoGenToggle && autoGenToggle.checked && foundCapabilityCall === null) {
                // If stamina exhaustion occurred this turn, use the status captured BEFORE
                // force-idle so the image reflects the actual reply state, not the idle fallback.
                if (this._statusForImageGen) {
                    const snapStatus = this._statusForImageGen;
                    this._statusForImageGen = null;
                    this._autoGenerateImageForMessage(charObj, targetIndex, null, snapStatus);
                } else {
                    this._autoGenerateImageForMessage(charObj, targetIndex);
                }
            } else {
                this._statusForImageGen = null;
            }
        }
    },

    // --- Narrator Streaming ---

    async _streamNarratorResponse(endpoint, payload, targetIndex) {
        const session = this.state.activeChatSession;
        if (!session) return;

        this.state.isStreaming = true;

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch(`/api/plugin/chat${endpoint}`, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let fullText = '';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    fullText += decoder.decode(value, { stream: true });

                    // Update the message content
                    const msg = session.messages[targetIndex];
                    if (msg) {
                        msg.snapshots[msg.activeIndex] = fullText;

                        // Update the DOM directly without full re-render
                        const bubble = this.container.querySelector(`.narrator-bubble-wrapper[data-msg-index="${targetIndex}"] .narrator-content`);
                        if (bubble) {
                            bubble.innerHTML = this.formatMessageContent(fullText);
                        }
                    }
                }
            }

            // Parse tags — narrator messages do NOT apply emotion/action/stamina decay
            fullText = this._parseAndCleanContent(fullText, true);
            const msg = session.messages[targetIndex];
            if (msg) {
                msg.snapshots[msg.activeIndex] = fullText;

                // For first_message: capture current state as statusAfter so it can serve
                // as a restore point when subsequent messages are deleted.
                // (Narrator doesn't mutate state, so this is just a snapshot of initial state.)
                if (msg.narrator_type === 'first_message') {
                    const charHash = this.state.activeChatCharacterHash;
                    const status = window.HistoryStateEngine.capture(session, charHash);
                    window.HistoryStateEngine.writeStatus(msg, msg.activeIndex, status);
                }
            }

            // Final save
            this._saveCurrentSession();
            this.renderMessages();
        } catch (e) {
            console.error('[Chat] Narrator stream error:', e);
        } finally {
            this.state.isStreaming = false;
            const autoGenToggle = this.container.querySelector('#chat-image-gen-every-message');
            if (autoGenToggle && autoGenToggle.checked && this._autoGenerateImageForMessage) {
                const charHash = this.state.activeChatCharacterHash;
                const charObj = this.state.personas.characters[charHash] || {};
                this._autoGenerateImageForMessage(charObj, targetIndex);
            }
        }
    },

    async _executeRandomEventAtIndex(targetIndex) {
        const session = this.state.activeChatSession;
        if (!session) return;

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};

        await this._streamNarratorResponse(
            '/scripting/random_event',
            {
                character_name: charObj.name || '',
                character_persona: charObj.persona || '',
                user_name: userObj.name || '',
                user_persona: userObj.persona || '',
                messages: session.messages || [],
                memory_summary: session.memory_summary || '',
                session_state: {
                    location: session.character_states?.[charHash]?.location || '',
                    outfits: session.character_states?.[charHash]?.outfits || [],
                    inventory: session.character_states?.[charHash]?.inventory || []
                },
                scene_ids: session.scenes || [],
                emotion_rules: (this.emotionEngine && this.emotionEngine.rules) ? this.emotionEngine.rules : null,
                action_rules: (this.actionEngine && this.actionEngine.rules) ? this.actionEngine.rules : null,
                model: localStorage.getItem('chat-llm-model') || undefined,
                temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
            },
            targetIndex
        );
    },

    _buildFallbackSystemUpdate() {
        // Build a null-filled system_update tag for when the LLM forgets to include one.
        // All non-bool fields are null (no change), bool fields default to false.
        const obj = {
            location: null,
            put_on: null,
            take_off: null,
            mentioned: [],
            time_skip: false,
        };
        if (this.emotionEngine) obj.emotion = null;
        if (this.actionEngine) obj.action = null;
        return `<system_update>${JSON.stringify(obj)}</system_update>`;
    },

    // --- Status Snapshot Helpers (delegate to HistoryStateEngine) ---

    _captureStatusSnapshot() {
        const charHash = this.state.activeChatCharacterHash;
        return window.HistoryStateEngine.capture(this.state.activeChatSession, charHash);
    },

    _restoreStatusSnapshot(snap) {
        const charHash = this.state.activeChatCharacterHash;
        const session = this.state.activeChatSession;
        window.HistoryStateEngine.restore(session, charHash, snap, () => {
            this._syncStatusToUI();
        });
    },

    _syncOutfitCardsForSnapshot(assistantIndex, snapshotIndex = null) {
        // No-op: outfit cards are now stored in snapshot[3], no separate messages to sync
    },

    _getStatusBeforeIndex(index) {
        return window.HistoryStateEngine.findStatusBefore(
            this.state.activeChatSession.messages, index
        );
    },

    // --- Parse & Clean Content (with decay) ---

    /**
     * Parse system_update / emotion_update tags from LLM output, apply decay/state changes,
     * and return the cleaned text.
     *
     * @param {string} fullText - Raw LLM output
     * @param {boolean} isNarrator - If true, skip emotion/action/stamina decay (narrator/first message)
     */
    _parseAndCleanContent(fullText, isNarrator = false, targetIndex = null) {
        // For narrator messages: only strip tags, no state changes
        if (isNarrator) {
            fullText = fullText.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '').trim();
            fullText = fullText.replace(/<emotion_update>[\s\S]*?(<\/emotion_update>|$)/gi, '').trim();
            return fullText;
        }

        const stateMatch = fullText.match(/<system_update>([\s\S]*?)<\/system_update>/i);

        // If LLM forgot the tag, inject a fallback
        if (!stateMatch) {
            const fallback = this._buildFallbackSystemUpdate();
            console.warn('[Chat] LLM missing <system_update>, injecting fallback:', fallback);
            fullText = fullText.trimEnd() + '\n' + fallback;
        }

        // Get character_states[charHash] — single source of truth
        const charHash = this.state.activeChatCharacterHash;
        const session = this.state.activeChatSession;
        const cs = window.HistoryStateEngine.ensureCharState(session, charHash);

        let emotionDecayApplied = false;

        if (stateMatch) {
            try {
                const updates = JSON.parse(stateMatch[1]);

                if (updates.location) {
                    cs.location = updates.location;
                }

                if (updates.put_on && Array.isArray(updates.put_on)) {
                    if (!cs.outfits) cs.outfits = [];
                    if (!cs.inventory) cs.inventory = [];
                    updates.put_on.forEach(item => {
                        if (!cs.outfits.includes(item)) cs.outfits.push(item);
                        const i = cs.inventory.indexOf(item);
                        if (i > -1) cs.inventory.splice(i, 1);
                    });
                }
                if (updates.take_off && Array.isArray(updates.take_off)) {
                    if (!cs.outfits) cs.outfits = [];
                    if (!cs.inventory) cs.inventory = [];
                    updates.take_off.forEach(item => {
                        const i = cs.outfits.indexOf(item);
                        if (i > -1) cs.outfits.splice(i, 1);
                        if (!cs.inventory.includes(item)) cs.inventory.push(item);
                    });
                }

                // Attach outfit changes to the target assistant message for bubble display
                const charName = this.state.personas?.characters?.[charHash]?.name || 'Character';
                const targetMsg = targetIndex !== null ? session.messages[targetIndex] : null;
                if (updates.put_on?.length > 0) {
                    if (targetMsg) {
                        if (!targetMsg.linked_outfit_changes) targetMsg.linked_outfit_changes = [];
                        targetMsg.linked_outfit_changes.push({
                            verb: 'put on', items: updates.put_on,
                            label: this._buildActionLabel('outfit_change', { actor: charName, verb: 'put on', items: updates.put_on })
                        });
                    }
                }
                if (updates.take_off?.length > 0) {
                    if (targetMsg) {
                        if (!targetMsg.linked_outfit_changes) targetMsg.linked_outfit_changes = [];
                        targetMsg.linked_outfit_changes.push({
                            verb: 'took off', items: updates.take_off,
                            label: this._buildActionLabel('outfit_change', { actor: charName, verb: 'took off', items: updates.take_off })
                        });
                    }
                }

                const isTimeSkip = !!updates.time_skip;
                if (isTimeSkip) {
                    console.log('[Chat] Time skip detected. Applying time-skip decay.');
                    if (this.actionEngine?.rules?.stamina) cs.stamina = this.actionEngine.getMaxStamina();
                }

                if (this.emotionEngine) {
                    if (!cs.emotion_state) cs.emotion_state = {};
                    if (isTimeSkip) cs.emotion_state = this.emotionEngine.applyTimeSkip(cs.emotion_state);
                    const delta = updates.emotion ? { value: updates.emotion } : {};
                    cs.emotion_state = this.emotionEngine.applyDelta(cs.emotion_state, delta);
                    emotionDecayApplied = true;
                }

                if (this.actionEngine) {
                    if (!cs.action_state) cs.action_state = {};
                    if (isTimeSkip) cs.action_state = this.actionEngine.applyTimeSkip();
                    if (updates.action || updates.stop_action) {
                        cs.action_state = this.actionEngine.applyDelta(cs.action_state, {
                            action: updates.action || [],
                            stop_action: updates.stop_action || []
                        });
                    }
                }

            } catch (e) {
                console.warn('[Chat] Failed to parse system_update JSON:', e);
            }
        }

        // Legacy <emotion_update> fallback
        const emotionMatch = fullText.match(/<emotion_update>([\s\S]*?)<\/emotion_update>/i);
        if (emotionMatch && this.emotionEngine && !emotionDecayApplied && !stateMatch) {
            try {
                if (!cs.emotion_state) cs.emotion_state = {};
                cs.emotion_state = this.emotionEngine.applyDelta(cs.emotion_state, JSON.parse(emotionMatch[1].trim()));
                emotionDecayApplied = true;
            } catch (e) {
                console.warn('[Chat] Failed to parse emotion_update JSON:', e);
            }
        }

        // Passive emotion decay
        if (this.emotionEngine && !emotionDecayApplied) {
            if (!cs.emotion_state) cs.emotion_state = {};
            cs.emotion_state = this.emotionEngine.applyDelta(cs.emotion_state, {});
        }

        // Stamina decay
        if (this.actionEngine?.rules?.stamina) {
            if (cs.stamina == null) cs.stamina = this.actionEngine.getMaxStamina();
            const oldActionState = { ...cs.action_state };
            const staminaResult = this.actionEngine.applyStamina(cs.stamina, cs.action_state || {});
            cs.stamina = staminaResult.stamina;

            if (staminaResult.forcedIdle) {
                this._statusForImageGen = window.HistoryStateEngine.capture(session, charHash);
                cs.action_state = this.actionEngine.handleStaminaExhaustion(cs.action_state || {});

                const hasConsumingActions = Object.keys(oldActionState).some(type => {
                    const config = this.actionEngine.getTypeConfig(type);
                    return config?.stamina < 0;
                });
                if (hasConsumingActions) {
                    const activeActions = Object.keys(cs.action_state);
                    const newActionName = activeActions.length > 0
                        ? activeActions.map(a => a.replace(/_/g, ' ')).join(', ')
                        : 'Idle';
                    const charName = this.state.personas.characters[charHash]?.name || 'Character';
                    const label = this._buildActionLabel('stamina_exhausted', { actor: charName, newAction: newActionName });
                    // Store as pending card — will be written into snapshot[3] after stream
                    window.HistoryStateEngine.addPendingCard({ type: 'stamina_exhausted', label });
                }
            }
        }

        this._syncStatusToUI();

        return fullText;
    }
});
