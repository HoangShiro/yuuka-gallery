Object.assign(window.ChatComponent.prototype, {

    // --- Group Chat Streaming & Message Sending ---

    _sendGroupMessage(content) {
        // Abort any ongoing stream
        if (this.state.currentAbortController) {
            this.state.currentAbortController.abort();
            this.state.currentAbortController = null;
        }
        this.state.isStreaming = false;
        this._setStreamingUI(false);

        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        // Capture statusBefore BEFORE flush so it reflects state prior to gift/action being applied
        const memberHashes = groupSession.member_hashes || [];
        const preFlushSnapshots = {};
        memberHashes.forEach(h => {
            if (groupSession.character_states?.[h]) {
                preFlushSnapshots[h] = window.HistoryStateEngine.capture(groupSession, h);
            }
        });

        // Flush pending actions — collects action items for snapshot[3] display.
        // State changes are applied AFTER the assistant replies during stream processing.
        const pendingActionsSnapshot = this.state.pendingActions ? [...this.state.pendingActions] : [];
        const flushedActions = this._flushPendingActionsToMessages
            ? this._flushPendingActionsToMessages()
            : [];
        this._clearPendingActions && this._clearPendingActions();

        // Push user message
        groupSession.messages.push({
            role: 'user',
            snapshots: [['', [], null, flushedActions.length > 0 ? flushedActions : null]],
            activeIndex: 0
        });
        // Set the actual content on the snapshot
        groupSession.messages[groupSession.messages.length - 1].snapshots[0][0] = content;

        const selection = this.state.groupCharacterBarSelection;

        let mainCharHash = null;

        if (selection === 'random') {
            mainCharHash = this._turnSelector(content, memberHashes);
        } else {
            // Specific character hash selected
            mainCharHash = selection || (memberHashes[0] || null);
        }

        // Push empty assistant message placeholder
        groupSession.messages.push({
            role: 'assistant',
            snapshots: [''],
            activeIndex: 0,
            character_hash: mainCharHash,
            response_mode: 'default'
        });

        this.renderMessages();

        const targetIndex = groupSession.messages.length - 1;
        this._streamGroupDefaultMode(mainCharHash, null, targetIndex, null, false, false, false, preFlushSnapshots[mainCharHash] || null, pendingActionsSnapshot);
    },

    _turnSelector(userMessage, memberHashes) {
        const groupSession = this.state.activeChatGroupSession;
        const chars = (this.state.personas && this.state.personas.characters) || {};

        const scores = {};
        memberHashes.forEach(h => { scores[h] = 0; });

        // 1. Name mention bonus
        memberHashes.forEach(h => {
            const persona = chars[h];
            if (persona && persona.name) {
                const name = persona.name.toLowerCase();
                if (userMessage.toLowerCase().includes(name)) {
                    scores[h] += 3;
                }
            }
        });

        // 2. Recency penalty: walk backwards through assistant messages
        const messages = (groupSession && groupSession.messages) || [];
        let assistantCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant' && msg.character_hash && memberHashes.includes(msg.character_hash)) {
                scores[msg.character_hash] -= 1 / (assistantCount + 1);
                assistantCount++;
            }
        }

        // 3. Find highest score with random tiebreak
        let maxScore = -Infinity;
        memberHashes.forEach(h => {
            if (scores[h] > maxScore) maxScore = scores[h];
        });

        const topCandidates = memberHashes.filter(h => scores[h] === maxScore);
        return topCandidates[Math.floor(Math.random() * topCandidates.length)];
    },

    _buildGroupContextMessages(messages, mainCharHash, mode) {
        // Flatten messages for context building
        // Default mode: other character assistant messages use role "user"
        // All Character mode: group consecutive assistant messages into JSON blocks
        if (mode === 'default') {
            return messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => {
                    if (m.role === 'user') {
                        const migrated = this.migrateMessage ? this.migrateMessage(m) : m;
                        let content = (migrated.snapshots[migrated.activeIndex] && migrated.snapshots[migrated.activeIndex][0]) || '';
                        // Append action_context from snapshot[3] to LLM context
                        const actionContext = migrated.snapshots[migrated.activeIndex] && migrated.snapshots[migrated.activeIndex][3];
                        if (actionContext && actionContext.length > 0) {
                            const actionText = actionContext.map(a => a.label).filter(Boolean).join(', ');
                            if (actionText) content = content ? `${content}\n${actionText}` : actionText;
                        }
                        return { role: 'user', content };
                    }
                    // assistant message
                    const content = m.snapshots[m.activeIndex] || '';
                    const text = Array.isArray(content) ? content[0] : content;
                    if (m.character_hash && m.character_hash !== mainCharHash) {
                        // Other character — treat as user message in context
                        const charName = this._getCharNameByHash(m.character_hash);
                        return { role: 'user', content: charName ? `[${charName}]: ${text}` : text };
                    }
                    return { role: 'assistant', content: text };
                });
        } else {
            // All Character mode: group consecutive assistant messages into JSON blocks
            const result = [];
            let i = 0;
            while (i < messages.length) {
                const m = messages[i];
                if (m.role === 'user') {
                    const migrated = this.migrateMessage ? this.migrateMessage(m) : m;
                    let content = (migrated.snapshots[migrated.activeIndex] && migrated.snapshots[migrated.activeIndex][0]) || '';
                    const actionContext = migrated.snapshots[migrated.activeIndex] && migrated.snapshots[migrated.activeIndex][3];
                    if (actionContext && actionContext.length > 0) {
                        const actionText = actionContext.map(a => a.label).filter(Boolean).join(', ');
                        if (actionText) content = content ? `${content}\n${actionText}` : actionText;
                    }
                    result.push({ role: 'user', content });
                    i++;
                } else if (m.role === 'assistant') {
                    // Collect consecutive assistant messages
                    const block = [];
                    while (i < messages.length && messages[i].role === 'assistant') {
                        const am = messages[i];
                        const charName = this._getCharNameByHash(am.character_hash);
                        const snap = am.snapshots[am.activeIndex];
                        const text = Array.isArray(snap) ? snap[0] : (snap || '');
                        block.push({
                            character_name: charName || am.character_hash || 'Unknown',
                            content: text
                        });
                        i++;
                    }
                    result.push({ role: 'assistant', content: JSON.stringify(block) });
                } else {
                    i++;
                }
            }
            return result;
        }
    },

    _getCharNameByHash(charHash) {
        if (!charHash) return null;
        const chars = (this.state.personas && this.state.personas.characters) || {};
        return (chars[charHash] && chars[charHash].name) || null;
    },

    async _streamGroupDefaultMode(mainCharHash, contextMessages, targetIndex, sessionMessagesOverride = null, isFirstMessage = false, isContinue = false, skipFollowUps = false, statusBeforeOverride = null, pendingActions = []) {
        this.state.isStreaming = true;
        this._setStreamingUI(true);

        const controller = new AbortController();
        this.state.currentAbortController = controller;

        const groupSession = this.state.activeChatGroupSession;
        const targetMsg = groupSession.messages[targetIndex];
        if (!targetMsg) {
            this.state.isStreaming = false;
            this._setStreamingUI(false);
            return;
        }

        // Ensure character_states[mainCharHash] exists before capture
        window.HistoryStateEngine.ensureGroupCharState(groupSession, mainCharHash);
        // Use pre-flush snapshot if provided (from _sendGroupMessage), otherwise capture now (regen/follow-up path)
        const statusBefore = statusBeforeOverride !== null
            ? statusBeforeOverride
            : window.HistoryStateEngine.capture(groupSession, mainCharHash);
        window.HistoryStateEngine.beginTurn();

        const userPersona = this.state.personas.users[this.state.activeUserPersonaId] || {};

        let fullText = '';

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/generate/group_chat_stream', {
                method: 'POST',
                body: JSON.stringify({
                    group_id: groupSession.id,
                    response_mode: 'default',
                    main_char_hash: mainCharHash,
                    member_hashes: groupSession.member_hashes,
                    all_character_info_summary: groupSession.all_character_info_summary || '',
                    user_name: userPersona.name || '',
                    user_persona: userPersona.persona || '',
                    session_messages: sessionMessagesOverride !== null ? sessionMessagesOverride : groupSession.messages,
                    system_prompt: groupSession.memory_summary || '',
                    scene_ids: groupSession.scenes || [],
                    is_first_message: isFirstMessage,
                    is_continue: isContinue,
                    emotion_rules: (this.emotionEngine && this.emotionEngine.rules) ? this.emotionEngine.rules : null,
                    action_rules: (this.actionEngine && this.actionEngine.rules) ? this.actionEngine.rules : null,
                    available_capabilities: (window.Yuuka?.services?.capabilities?.getCapabilities?.()) || [],
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                }),
                headers,
                signal: controller.signal
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText);
            }

            // Force render so the bubble is in the DOM, then lock against external re-renders
            this.renderMessages();
            this.state._groupStreamingActive = true;

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;

            // Helper to find the target bubble's text element in current DOM
            const getTargetBubble = () => {
                const wrapper = this.container.querySelector(`.chat-bubble-wrapper[data-msg-index="${targetIndex}"]`);
                return wrapper ? wrapper.querySelector('.chat-bubble .text') : null;
            };

            let targetBubble = getTargetBubble();
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
                    targetMsg.snapshots[targetMsg.activeIndex] = fullText;

                    // Always re-query the bubble — a concurrent renderMessages() (e.g. from image gen)
                    // may have rebuilt the DOM, making any cached reference stale.
                    targetBubble = getTargetBubble();
                    if (targetBubble) {
                        if (!targetBubble.classList.contains('streaming')) {
                            targetBubble.classList.add('streaming');
                        }
                        targetBubble.innerHTML = this.formatMessageContent(fullText);
                        const messagesContainer = this.container.querySelector('#chat-messages-container');
                        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }
                }
            }

            this.state._groupStreamingActive = false;
            targetBubble = getTargetBubble();
            if (targetBubble) {
                targetBubble.classList.remove('streaming');
            }

            // Apply deferred gift/duo_action BEFORE parsing system_update.
            // This way if LLM does "put_on: [gifted_item]", the item is already in inventory
            // so _parseAndApplyGroupUpdate can correctly move it from inventory → outfits.
            if (pendingActions.length > 0) {
                const cs = window.HistoryStateEngine.ensureGroupCharState(groupSession, mainCharHash);
                pendingActions.forEach(action => {
                    if (action.data?.charHash && action.data.charHash !== mainCharHash) return;
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

            // Parse system_update tags and apply per-character state changes
            const cleanedText = this._parseAndApplyGroupUpdate(mainCharHash, fullText, false, targetMsg);
            targetMsg.snapshots[targetMsg.activeIndex] = cleanedText;

            // Write status_after into snapshot[2] and outfit/stamina cards into snapshot[3]
            const targetMsgIndex = groupSession.messages.indexOf(targetMsg);
            if (targetMsgIndex !== -1) {
                const statusAfter = window.HistoryStateEngine.capture(groupSession, mainCharHash);
                window.HistoryStateEngine.writeStatus(targetMsg, targetMsg.activeIndex, statusAfter);

                const sideEffectCards = window.HistoryStateEngine.flushPendingCards();
                const outfitCards = (targetMsg.linked_outfit_changes || []).map(c => ({
                    type: 'outfit_change',
                    label: c.label
                }));
                delete targetMsg.linked_outfit_changes;
                // Gift cards — only those targeting this character
                const giftCards = pendingActions
                    .filter(a => a.type === 'gift' && (!a.data?.charHash || a.data.charHash === mainCharHash))
                    .map(a => ({
                        type: 'gift_received',
                        item: a.data?.name || a.chipLabel || '',
                        sender: this._getActiveUserName()
                    }));
                // Manual outfit_change cards — drag-drop changes targeting this character
                const manualOutfitCards = pendingActions
                    .filter(a => a.type === 'outfit_change' && a.data?.charHash === mainCharHash)
                    .map(a => ({ type: 'outfit_change', label: a.label }));
                const allActionContext = [...giftCards, ...manualOutfitCards, ...outfitCards, ...sideEffectCards];
                if (allActionContext.length > 0) {
                    window.HistoryStateEngine.writeActionContext(targetMsg, targetMsg.activeIndex, allActionContext);
                }
            }

            // If LLM returned only system_update with no actual text, remove the empty bubble
            if (!cleanedText.trim()) {
                const idx = groupSession.messages.indexOf(targetMsg);
                if (idx !== -1) groupSession.messages.splice(idx, 1);
            }

            await this._saveGroupSession();
            this.renderMessages();

            // Auto image generation — fire immediately after this char's response
            const autoGenToggle = this.container.querySelector('#chat-image-gen-every-message');
            if (autoGenToggle?.checked) {
                this._autoGenerateGroupImage(mainCharHash, targetIndex, this._statusForImageGen?.[mainCharHash] || null);
            }

            // Trigger follow-up responses for mentioned characters (non-blocking)
            if (!skipFollowUps) {
                this._triggerMentionedFollowUps(mainCharHash, fullText, targetMsg, pendingActions);
            }

        } catch (err) {
            this.state._groupStreamingActive = false;
            if (err.name === 'AbortError' || (err.message && err.message.includes('aborted'))) {
                console.log('[GroupChat] Stream aborted.');

                if (targetMsg) {
                    let cleanedText = fullText
                        .replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '')
                        .trim();

                    if (cleanedText === '') {
                        const idx = groupSession.messages.indexOf(targetMsg);
                        if (idx !== -1) groupSession.messages.splice(idx, 1);
                    } else {
                        targetMsg.snapshots[targetMsg.activeIndex] = cleanedText;
                    }
                }

                await this._saveGroupSession();
                this.renderMessages();

            } else {
                console.error('[GroupChat] Stream error:', err);
                if (targetMsg && targetMsg.snapshots[targetMsg.activeIndex] === '') {
                    const idx = groupSession.messages.indexOf(targetMsg);
                    if (idx !== -1) groupSession.messages.splice(idx, 1);
                }
                this.renderMessages();
                alert('Lỗi khi chat group: ' + (err.message || err));
            }
        } finally {
            if (this.state.currentAbortController === controller) {
                this.state.isStreaming = false;
                this.state.currentAbortController = null;
                this._setStreamingUI(false);
            }
            this._syncInventoryPanelToLastSpeaker();

            // Asynchronously trigger memory compression if the buffer gets large
            this._triggerGroupMemoryCompression();
        }
    },

    async _regenGroupMessage(messageIndex) {
        if (this.state.currentAbortController) {
            this.state.currentAbortController.abort();
            this.state.currentAbortController = null;
        }
        this.state.isStreaming = false;
        this._setStreamingUI(false);

        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const messages = groupSession.messages;
        const msg = messages[messageIndex];
        if (!msg || msg.role !== 'assistant') return;

        const mainCharHash = msg.character_hash || null;

        // Restore character state from the status stored in the slot being replaced
        if (mainCharHash) {
            const prevStatus = window.HistoryStateEngine.findStatusBefore(messages, messageIndex);
            if (prevStatus) {
                window.HistoryStateEngine.restore(groupSession, mainCharHash, prevStatus);
            }
        }

        // Add a new snapshot slot for the regen
        msg.snapshots.push(['', [], null, null]);
        msg.activeIndex = msg.snapshots.length - 1;

        this.renderMessages();

        // Pass messages up to (not including) this assistant message as context
        await this._streamGroupDefaultMode(mainCharHash, null, messageIndex, messages.slice(0, messageIndex));
    },

    /**
     * Trigger group generation without a user message (character continues on their own).
     * Called by long-press on character bar buttons.
     */
    _triggerGroupContinue(selection) {
        if (this.state.isStreaming) return;

        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const memberHashes = groupSession.member_hashes || [];

        let mainCharHash = null;

        if (selection === 'random') {
            mainCharHash = this._turnSelector('', memberHashes);
        } else {
            mainCharHash = selection || (memberHashes[0] || null);
        }

        const isFirstMessage = !groupSession.messages || groupSession.messages.length === 0;

        groupSession.messages = groupSession.messages || [];
        groupSession.messages.push({
            role: 'assistant',
            snapshots: [''],
            activeIndex: 0,
            character_hash: mainCharHash,
            response_mode: 'default',
        });
        this.renderMessages();
        const targetIndex = groupSession.messages.length - 1;
        this._streamGroupDefaultMode(mainCharHash, null, targetIndex, null, isFirstMessage, true);
    },

    /**
     * No-op: outfit cards are now stored in snapshot[3], no separate messages to sync.
     */
    _syncGroupOutfitCardsForSnapshot(assistantIndex, snapshotIndex, groupSession) {
        // No-op
    },

    /**
     * Parse <system_update> tags from a group chat response and apply state changes
     * to the per-character state in character_states[charHash].
     *
     * Mirrors _parseAndCleanContent from chatStreaming.js but operates on group session state.
     *
     * @param {string} charHash - The character hash whose state to update
     * @param {string} fullText - The full streamed text (may contain <system_update> tags)
     * @param {boolean} isNarrator - If true, only strip tags without applying any state changes
     * @param {object|null} targetMsg - The message object to store status_snapshots on (optional)
     * @returns {string} The cleaned text with <system_update> tags stripped
     */
    _parseAndApplyGroupUpdate(charHash, fullText, isNarrator = false, targetMsg = null) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return fullText;

        // Use engine to ensure character_states[charHash] exists with correct defaults
        window.HistoryStateEngine.ensureGroupCharState(groupSession, charHash);
        const charState = groupSession.character_states[charHash];

        // For narrator messages: only strip tags, do NOT apply any state changes
        if (isNarrator) {
            fullText = fullText.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '').trim();
            fullText = fullText.replace(/<emotion_update>[\s\S]*?(<\/emotion_update>|$)/gi, '').trim();
            return fullText;
        }

        let emotionDecayApplied = false;
        const stateMatch = fullText.match(/<system_update>([\s\S]*?)<\/system_update>/i);

        // If LLM forgot the tag, inject a fallback so history always has it
        if (!stateMatch) {
            const fallback = this._buildFallbackSystemUpdate ? this._buildFallbackSystemUpdate() : '';
            if (fallback) {
                console.warn('[GroupChat] LLM missing <system_update>, injecting fallback:', fallback);
                fullText = fullText.trimEnd() + '\n' + fallback;
            }
        }

        if (stateMatch) {
            try {
                // Extract the first JSON object from the tag content (LLM may include extra text)
                const rawContent = stateMatch[1].trim();
                const jsonStart = rawContent.indexOf('{');
                const jsonEnd = rawContent.lastIndexOf('}');
                if (jsonStart === -1 || jsonEnd === -1) throw new SyntaxError('No JSON object found in system_update');
                const updates = JSON.parse(rawContent.slice(jsonStart, jsonEnd + 1));

                // Location is updated for the character and synchronized to the global group session
                // We sync it to ALL character states so the next responder sees the new location.
                if (updates.location) {
                    charState.location = updates.location;
                    groupSession.location = updates.location;
                    if (groupSession.character_states) {
                        for (const h in groupSession.character_states) {
                            groupSession.character_states[h].location = updates.location;
                        }
                    }
                }

                // Outfit changes go to this character's state only
                if (updates.put_on && Array.isArray(updates.put_on)) {
                    if (!charState.outfits) charState.outfits = [];
                    if (!charState.inventory) charState.inventory = [];
                    updates.put_on.forEach(item => {
                        if (!charState.outfits.includes(item)) {
                            charState.outfits.push(item);
                        }
                        const invIdx = charState.inventory.indexOf(item);
                        if (invIdx > -1) charState.inventory.splice(invIdx, 1);
                    });
                }
                if (updates.take_off && Array.isArray(updates.take_off)) {
                    if (!charState.outfits) charState.outfits = [];
                    if (!charState.inventory) charState.inventory = [];
                    updates.take_off.forEach(item => {
                        const outIdx = charState.outfits.indexOf(item);
                        if (outIdx > -1) charState.outfits.splice(outIdx, 1);
                        if (!charState.inventory.includes(item)) {
                            charState.inventory.push(item);
                        }
                    });
                }

                // Attach outfit changes to the target assistant message for bubble display
                const charName = this.state.personas?.characters?.[charHash]?.name || 'Character';
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
                    console.log('[GroupChat] Time skip detected for', charHash, '. Applying time-skip decay.');
                    if (this.actionEngine?.rules?.stamina) {
                        charState.stamina = this.actionEngine.getMaxStamina();
                    }
                }

                if (this.emotionEngine) {
                    if (!charState.emotion_state) charState.emotion_state = {};
                    if (isTimeSkip) {
                        charState.emotion_state = this.emotionEngine.applyTimeSkip(charState.emotion_state);
                    }
                    const delta = updates.emotion ? { value: updates.emotion } : {};
                    charState.emotion_state = this.emotionEngine.applyDelta(charState.emotion_state, delta);
                    emotionDecayApplied = true;
                }

                if (this.actionEngine) {
                    if (!charState.action_state) charState.action_state = {};
                    if (isTimeSkip) {
                        charState.action_state = this.actionEngine.applyTimeSkip();
                    }
                    if (updates.action || updates.stop_action) {
                        charState.action_state = this.actionEngine.applyDelta(charState.action_state, {
                            action: updates.action || [],
                            stop_action: updates.stop_action || []
                        });
                    }
                }

            } catch (e) {
                console.warn('[GroupChat] Failed to parse system_update JSON:', e);
            }
        }

        // Handle legacy <emotion_update> tag (fallback when no system_update)
        const emotionMatch = fullText.match(/<emotion_update>([\s\S]*?)<\/emotion_update>/i);
        if (emotionMatch && this.emotionEngine && !emotionDecayApplied && !stateMatch) {
            try {
                const delta = JSON.parse(emotionMatch[1].trim());
                if (!charState.emotion_state) charState.emotion_state = {};
                charState.emotion_state = this.emotionEngine.applyDelta(charState.emotion_state, delta);
                emotionDecayApplied = true;
            } catch (e) {
                console.warn('[GroupChat] Failed to parse emotion_update JSON:', e);
            }
        }

        // Apply passive emotion decay if no explicit emotion update occurred
        if (this.emotionEngine && !emotionDecayApplied) {
            if (!charState.emotion_state) charState.emotion_state = {};
            charState.emotion_state = this.emotionEngine.applyDelta(charState.emotion_state, {});
        }

        // Apply stamina cost from active actions
        if (this.actionEngine?.rules?.stamina) {
            if (charState.stamina == null) charState.stamina = this.actionEngine.getMaxStamina();
            const oldActionState = { ...charState.action_state };
            const staminaResult = this.actionEngine.applyStamina(charState.stamina, charState.action_state || {});
            charState.stamina = staminaResult.stamina;

            if (staminaResult.forcedIdle) {
                // Use engine capture for consistency
                if (!this._statusForImageGen) this._statusForImageGen = {};
                this._statusForImageGen[charHash] = window.HistoryStateEngine.capture(groupSession, charHash);

                charState.action_state = this.actionEngine.handleStaminaExhaustion(charState.action_state || {});

                const hasConsumingActions = Object.keys(oldActionState).some(type => {
                    const config = this.actionEngine.getTypeConfig(type);
                    return config?.stamina < 0;
                });
                if (hasConsumingActions) {
                    const activeActions = Object.keys(charState.action_state);
                    const newActionName = activeActions.length > 0
                        ? activeActions.map(a => a.replace(/_/g, ' ')).join(', ')
                        : 'Idle';
                    const charName = this.state.personas?.characters?.[charHash]?.name || 'Character';
                    const label = this._buildActionLabel('stamina_exhausted', { actor: charName, newAction: newActionName });
                    // Store as pending card — will be written into snapshot[3] after stream
                    window.HistoryStateEngine.addPendingCard({ type: 'stamina_exhausted', label });
                }
            }
        }

        // status_after is now captured by the caller via HistoryStateEngine.capture() after this function returns.
        // We no longer write status_snapshots here — the caller (_streamGroupDefaultMode) handles writeRecord.

        // Strip system_update and emotion_update tags from the returned text
        fullText = fullText.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '').trim();
        fullText = fullText.replace(/<emotion_update>[\s\S]*?(<\/emotion_update>|$)/gi, '').trim();

        return fullText;
    },

    /**
     * Extract "mentioned" array from a raw LLM response text (reads system_update JSON).
     * Returns array of character names (strings), or empty array.
     */
    _extractMentionedFromText(text) {
        if (!text) return [];

        const match = text.match(/<system_update>([\s\S]*?)<\/system_update>/i);
        if (!match) return [];
        try {
            const raw = match[1].trim();
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            if (start === -1 || end === -1) return [];
            const obj = JSON.parse(raw.slice(start, end + 1));
            if (Array.isArray(obj.mentioned)) {
                return obj.mentioned.filter(n => typeof n === 'string' && n.trim());
            }
        } catch (_) {}
        return [];
    },
    _resolveCharHashByName(name) {
        if (!name) return null;
        const chars = (this.state.personas && this.state.personas.characters) || {};
        const lowerName = name.toLowerCase();
        for (const [hash, persona] of Object.entries(chars)) {
            if (persona.name && persona.name.toLowerCase() === lowerName) {
                return hash;
            }
        }
        return null;
    },

    /**
     * After a default-mode response, check "mentioned" in system_update and trigger
     * follow-up responses for those characters (max 1 per char per user turn, skip self & user).
     */
    async _triggerMentionedFollowUps(respondingCharHash, rawText, _originMsg, pendingActions = []) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const mentioned = this._extractMentionedFromText(rawText);
        if (!mentioned.length) return;

        const userPersona = this.state.personas?.users?.[this.state.activeUserPersonaId] || {};
        const userName = (userPersona.name || '').toLowerCase();
        const memberHashes = groupSession.member_hashes || [];

        // Build set of chars that already replied in this turn (since last user message)
        const repliedThisTurn = new Set();
        repliedThisTurn.add(respondingCharHash);
        const messages = groupSession.messages;
        // Walk backwards from end until we hit a user message
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === 'user') break;
            if (m.role === 'assistant' && m.character_hash) {
                repliedThisTurn.add(m.character_hash);
            }
        }

        for (const name of mentioned) {
            // Skip user name
            if (name.toLowerCase() === userName) continue;

            const charHash = this._resolveCharHashByName(name);
            if (!charHash) continue;

            // Skip self
            if (charHash === respondingCharHash) continue;

            // Skip if not a member of this group
            if (!memberHashes.includes(charHash)) continue;

            // Skip if already replied this turn
            if (repliedThisTurn.has(charHash)) continue;

            // Mark as replied so subsequent mentions in the same chain don't double-trigger
            repliedThisTurn.add(charHash);

            // Push placeholder and stream
            groupSession.messages.push({
                role: 'assistant',
                snapshots: [''],
                activeIndex: 0,
                character_hash: charHash,
                response_mode: 'default',
            });
            this.renderMessages();
            const targetIndex = groupSession.messages.length - 1;

            // Stream synchronously (await) so follow-ups chain in order
            await this._streamGroupDefaultMode(charHash, null, targetIndex, null, false, false, false, null, pendingActions);
        }
    },

    /**
     * Group Random Event: push a narrator message and stream from the group_random_event endpoint.
     * The LLM will generate an event involving 1+ existing members, or introduce a new character
     * (system auto-picks + adds to group if not full).
     */
    async _executeGroupRandomEvent() {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        groupSession.messages.push({
            role: 'system',
            type: 'narrator',
            narrator_type: 'group_random_event',
            snapshots: [''],
            activeIndex: 0
        });

        const targetIndex = groupSession.messages.length - 1;
        await this._saveGroupSession();
        this.renderMessages();

        const container = this.container.querySelector('#chat-messages-container');
        if (container) container.scrollTop = container.scrollHeight;

        await this._streamGroupNarratorResponse(targetIndex);
    },

    /**
     * Stream a group narrator (random event) response.
     * Handles the special `new_character` action in the response to auto-add a new member.
     */
    async _streamGroupNarratorResponse(targetIndex) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        this.state.isStreaming = true;
        this._setStreamingUI(true);

        const userPersona = this.state.personas?.users?.[this.state.activeUserPersonaId] || {};
        const chars = (this.state.personas && this.state.personas.characters) || {};

        // Build member info for the prompt
        const memberInfos = (groupSession.member_hashes || []).map(h => {
            const p = chars[h] || {};
            return { hash: h, name: p.name || h };
        });

        // Collect all available characters NOT in the group (candidates for new member)
        const allCharHashes = Object.keys(chars);
        const candidateHashes = allCharHashes.filter(h => !(groupSession.member_hashes || []).includes(h));
        const candidateInfos = candidateHashes.map(h => ({ hash: h, name: chars[h]?.name || h }));

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/scripting/group_random_event', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    group_id: groupSession.id,
                    member_hashes: groupSession.member_hashes || [],
                    member_infos: memberInfos,
                    candidate_hashes: candidateHashes,
                    candidate_infos: candidateInfos,
                    is_full: (groupSession.member_hashes || []).length >= 5,
                    all_character_info_summary: groupSession.all_character_info_summary || '',
                    user_name: userPersona.name || '',
                    user_persona: userPersona.persona || '',
                    session_messages: groupSession.messages,
                    memory_summary: groupSession.memory_summary || '',
                    scene_ids: groupSession.scenes || [],
                    emotion_rules: this.emotionEngine?.rules || null,
                    action_rules: this.actionEngine?.rules || null,
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                })
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let fullText = '';

            const getTargetBubble = () => {
                const wrapper = this.container.querySelector(`.narrator-bubble-wrapper[data-msg-index="${targetIndex}"]`);
                return wrapper ? wrapper.querySelector('.narrator-content') : null;
            };

            let bubble = getTargetBubble();
            if (bubble) {
                bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            }

            this.state._groupStreamingActive = true;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    fullText += decoder.decode(value, { stream: true });
                    const msg = groupSession.messages[targetIndex];
                    if (msg) msg.snapshots[msg.activeIndex] = fullText;

                    bubble = getTargetBubble();
                    if (bubble) {
                        // Strip complete tags AND any partial/incomplete opening tag still being streamed
                        let displayText = fullText
                            .replace(/<group_action>[\s\S]*?<\/group_action>/gi, '')
                            .replace(/<group_action>[\s\S]*/gi, '')
                            .trim();
                        bubble.innerHTML = this.formatMessageContent(displayText);
                    }
                    const container = this.container.querySelector('#chat-messages-container');
                    if (container) container.scrollTop = container.scrollHeight;
                }
            }

            this.state._groupStreamingActive = false;

            // Parse <group_action> tag for new character introduction
            const actionMatch = fullText.match(/<group_action>([\s\S]*?)<\/group_action>/i);
            if (actionMatch) {
                try {
                    const action = JSON.parse(actionMatch[1].trim());
                    if (action.type === 'new_character' && action.character_hash) {
                        // Store member_hashes snapshot BEFORE adding the character so delete/regen can undo it
                        const narratorMsg = groupSession.messages[targetIndex];
                        if (narratorMsg) {
                            narratorMsg.member_hashes_before = [...(groupSession.member_hashes || [])];
                        }
                        await this._groupRandomEventAddCharacter(action.character_hash, action.character_summary || null);
                    }
                } catch (e) {
                    console.warn('[GroupChat] Failed to parse group_action:', e);
                }
            }

            // Strip group_action tag from stored text
            const cleanedText = fullText.replace(/<group_action>[\s\S]*?<\/group_action>/gi, '').trim();
            const msg = groupSession.messages[targetIndex];
            if (msg) msg.snapshots[msg.activeIndex] = cleanedText;

            await this._saveGroupSession();
            this.renderMessages();

        } catch (e) {
            this.state._groupStreamingActive = false;
            console.error('[GroupChat] Group random event error:', e);
            const msg = groupSession.messages[targetIndex];
            if (msg && msg.snapshots[msg.activeIndex] === '') {
                groupSession.messages.splice(targetIndex, 1);
            }
            this.renderMessages();
        } finally {
            this.state.isStreaming = false;
            this._setStreamingUI(false);
        }
    },

    /**
     * Add a new character to the group after a random event introduction.
     * Initializes character_states and updates member_hashes, then saves and refreshes UI.
     * @param {string} charHash - The character hash to add
     * @param {string|null} characterSummary - Optional flat-text summary from the LLM
     */
    async _groupRandomEventAddCharacter(charHash, characterSummary = null) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const memberHashes = groupSession.member_hashes || [];
        if (memberHashes.includes(charHash)) return;
        if (memberHashes.length >= 5) return;

        const chars = (this.state.personas && this.state.personas.characters) || {};
        const persona = chars[charHash] || {};
        const maxStamina = this.actionEngine?.getMaxStamina?.() ?? 100;

        groupSession.member_hashes = [...memberHashes, charHash];
        if (!groupSession.character_states) groupSession.character_states = {};
        window.HistoryStateEngine.ensureGroupCharState(groupSession, charHash, persona.default_outfits || []);
        // Reset to clean state for new member
        const cs = groupSession.character_states[charHash];
        cs.emotion_state = {};
        cs.action_state  = {};
        cs.stamina       = this.actionEngine?.getMaxStamina?.() ?? 100;

        // If a character_summary was provided by the LLM, append it to all_character_info_summary
        if (characterSummary) {
            const charName = persona.name || charHash;
            const summaryEntry = `[${charName}]\n${characterSummary}`;
            const existing = (groupSession.all_character_info_summary || '').trim();
            groupSession.all_character_info_summary = existing
                ? existing + '\n\n' + summaryEntry
                : summaryEntry;
        }

        // Save to server first
        await this._saveGroupSession();

        // Re-render character bar to include the new member
        this._renderCharacterBar && this._renderCharacterBar(groupSession);

        this._syncInventoryPanelToLastSpeaker();

        // Only regenerate summary in background if no summary was provided by the LLM
        if (!characterSummary) {
            this._regenerateGroupCharacterSummary && this._regenerateGroupCharacterSummary(groupSession.member_hashes);
        }
    },

    _syncInventoryPanelToLastSpeaker() {
        const panel = this.container.querySelector('#modal-inventory');
        if (!panel || panel.classList.contains('hidden')) return;

        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        if (this.state.activeGroupInventoryCharHash) {
            // Still re-render the picker to keep button highlights in sync
            this._renderGroupMemberPicker && this._renderGroupMemberPicker();

            // Always sync the group location label
            const locationLabel = this.container.querySelector('#inventory-location-label');
            if (locationLabel) locationLabel.value = groupSession.location || 'Unknown';

            // Sync the active character's status so the stats UI updates in real-time
            this._syncGroupStatusToUI && this._syncGroupStatusToUI(this.state.activeGroupInventoryCharHash);
            return;
        }

        const messages = groupSession.messages || [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === 'assistant' && m.character_hash) {
                this.state.activeGroupInventoryCharHash = m.character_hash;
                break;
            }
        }

        this._renderGroupMemberPicker && this._renderGroupMemberPicker();
        
        const locationLabel = this.container.querySelector('#inventory-location-label');
        if (locationLabel) locationLabel.value = groupSession.location || 'Unknown';

        const activeHash = this.state.activeGroupInventoryCharHash;
        if (activeHash) {
            this._syncGroupStatusToUI && this._syncGroupStatusToUI(activeHash);
        }
    },

    async _saveGroupSession() {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession || !groupSession.id) return;

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch(`/api/plugin/chat/group_sessions/${groupSession.id}`, {
                method: 'PUT',
                body: JSON.stringify(groupSession),
                headers
            });

            if (res.ok) {
                const data = await res.json();
                const updated = data.session || data.data || data;
                if (updated && updated.id) {
                    // Only sync non-messages fields from server (id, name, metadata, etc.)
                    // Never replace in-memory messages — they may have streaming content
                    // or placeholders that the server response doesn't know about yet.
                    const inMemory = this.state.activeChatGroupSession;
                    if (inMemory && inMemory.id === updated.id) {
                        Object.assign(inMemory, { ...updated, messages: inMemory.messages });
                    }
                }
            }
        } catch (e) {
            console.error('[GroupChat] Failed to save group session:', e);
        }
    }
});
