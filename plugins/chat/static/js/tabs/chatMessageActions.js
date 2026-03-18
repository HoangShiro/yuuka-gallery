Object.assign(window.ChatComponent.prototype, {
    // --- Message Actions (edit, delete, snapshot, regenerate) ---

    _bindMessageActions(wrapper, index, msg) {
        const isAssistant = msg.role === 'assistant';
        const isUser = msg.role === 'user';
        const markActive = () => this.state.activeActionIndex = index;

        const editBtn = wrapper.querySelector('.msg-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                markActive();
                this._startInlineEdit(wrapper, index, msg);
            });
        }

        const deleteBtn = wrapper.querySelector('.msg-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                markActive();
                this.handleDeleteMessage(index);
            });
        }

        const regenBtn = wrapper.querySelector('.msg-regen-btn');
        if (regenBtn) {
            regenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                markActive();
                if (isUser) {
                    this.handleRegenerateFromUserMessage(index);
                } else {
                    this.handleRegenerateMessage(index);
                }
            });
        }

        if (isAssistant) {

            const prevBtn = wrapper.querySelector('.snapshot-prev');
            const nextBtn = wrapper.querySelector('.snapshot-next');
            if (prevBtn) {
                prevBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    markActive();
                    this.handleSnapshotNav(index, -1);
                });
            }
            if (nextBtn) {
                nextBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    markActive();
                    this.handleSnapshotNav(index, 1);
                });
            }
        }
    },

    _startInlineEdit(wrapper, index, msg) {
        let currentContent = this.getMessageContent(msg);

        // Strip system XML tags so users only see the visible chat text
        currentContent = currentContent.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '');
        currentContent = currentContent.replace(/<call_capability[^>]*>[\s\S]*?(<\/call_capability>|$)/gi, '');
        currentContent = currentContent.trim();

        // Apply auto line break so textarea matches bubble display
        const autoLineBreak = localStorage.getItem('chat-auto-line-break') !== 'false';
        if (autoLineBreak) {
            currentContent = currentContent.replace(/(\*[^*]+\*)/g, '\n$1\n');
            currentContent = currentContent.replace(/("[^"]+")/g, '\n$1\n');
            currentContent = currentContent.replace(/\n{2,}/g, '\n');
            currentContent = currentContent.trim();
        }

        wrapper.classList.add('is-editing');

        const textarea = document.createElement('textarea');
        textarea.className = 'inline-edit-textarea';
        textarea.value = currentContent;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'inline-edit-actions';
        actionsDiv.innerHTML = `
            <button class="inline-edit-save" title="Save"><span class="material-symbols-outlined">check</span></button>
            <button class="inline-edit-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
        `;

        const bubble = wrapper.querySelector('.chat-bubble') || wrapper.querySelector('.narrator-content');

        // Measure only the text element, not the full bubble (which may include media)
        const textEl = bubble.querySelector('.text') || bubble;
        const textRect = textEl ? textEl.getBoundingClientRect() : bubble.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const editHeight = Math.max(textRect.height, 80); // minimum 80px for comfortable editing

        bubble.style.width = Math.max(bubbleRect.width, 100) + 'px';
        bubble.style.height = editHeight + 'px';

        bubble.innerHTML = '';
        bubble.appendChild(textarea);

        // Move save/cancel to the action bar
        const msgActions = wrapper.querySelector('.msg-actions-inner');
        if (msgActions) {
            msgActions.innerHTML = '';
            msgActions.appendChild(actionsDiv);
        }

        textarea.focus();

        actionsDiv.querySelector('.inline-edit-save').addEventListener('click', () => {
            let newContent = textarea.value;

            // Reverse auto line break before saving: strip \n around *...* and "..."
            // so only clean text is persisted (auto-break re-applies on render)
            if (autoLineBreak) {
                newContent = newContent.replace(/\n(\*[^*]+\*)/g, ' $1');
                newContent = newContent.replace(/(\*[^*]+\*)\n/g, '$1 ');
                newContent = newContent.replace(/\n("[^"]+")/g, ' $1');
                newContent = newContent.replace(/("[^"]+")\n/g, '$1 ');
                newContent = newContent.replace(/ {2,}/g, ' ');
                newContent = newContent.trim();
            }

            const session = this._getActiveSession();
            const m = session.messages[index];
            const migrated = this.migrateMessage(m);
            const snap = migrated.snapshots[migrated.activeIndex];
            if (Array.isArray(snap)) {
                snap[0] = newContent; // preserve images in snap[1]
            } else {
                migrated.snapshots[migrated.activeIndex] = [newContent, []];
            }
            session.messages[index] = migrated;
            this._saveSession();
            this.renderMessages();
        });

        actionsDiv.querySelector('.inline-edit-cancel').addEventListener('click', () => {
            this.renderMessages();
        });
    },

    handleSnapshotNav(index, direction) {
        const session = this._getActiveSession();
        const msg = session.messages[index];
        const migrated = this.migrateMessage(msg);
        const newIndex = migrated.activeIndex + direction;
        if (newIndex < 0 || newIndex >= migrated.snapshots.length) return;
        migrated.activeIndex = newIndex;
        session.messages[index] = migrated;

        // Restore the status for the new snapshot via engine
        const status = window.HistoryStateEngine.readStatus(migrated, newIndex);
        if (status) {
            const charHash = this._getActiveCharHash(migrated);
            window.HistoryStateEngine.restore(session, charHash, status,
                () => this._syncStatusToUI());
        }

        this._saveSession();
        this.renderMessages();
    },

    async handleDeleteMessage(index) {
        const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
            ? (msg) => window.Yuuka.ui.confirm(msg)
            : (msg) => Promise.resolve(window.confirm(msg));
        if (!await confirmFn('Xoá message này và toàn bộ messages sau nó?')) return;

        const session = this._getActiveSession();
        const messages = session.messages;
        const isGroup = !!this.state.activeChatGroupId;

        // Group mode: restore member list if a random event added a character
        if (isGroup) {
            for (let i = index; i < messages.length; i++) {
                const m = messages[i];
                if (m.member_hashes_before) {
                    const removedHashes = (session.member_hashes || []).filter(
                        h => !m.member_hashes_before.includes(h)
                    );
                    session.member_hashes = [...m.member_hashes_before];
                    removedHashes.forEach(h => {
                        if (session.character_states) delete session.character_states[h];
                    });
                    this._renderCharacterBar && this._renderCharacterBar(session);
                    break;
                }
            }
        }

        // Restore state based on what will remain after the slice.
        // For each affected character, find their last assistant msg in messages[0..index-1]
        // and restore to its status_after (snapshot[2]). If none found, no restore needed.
        if (isGroup) {
            const affectedHashes = new Set();
            for (let i = index; i < messages.length; i++) {
                const m = messages[i];
                if (m.role === 'assistant' && m.character_hash) affectedHashes.add(m.character_hash);
            }
            affectedHashes.forEach(charHash => {
                for (let i = index - 1; i >= 0; i--) {
                    const m = messages[i];
                    if (m.role !== 'assistant') continue;
                    if (m.type === 'narrator' && m.narrator_type !== 'first_message') continue;
                    if (m.character_hash && m.character_hash !== charHash) continue;
                    const migrated = this.migrateMessage(m);
                    const status = window.HistoryStateEngine.readStatus(migrated, migrated.activeIndex);
                    if (status) {
                        window.HistoryStateEngine.restore(session, charHash, status,
                            () => this._syncStatusToUI());
                    }
                    return; // found, stop
                }
                // No prior assistant msg for this char — restore to statusBefore of their first msg
                const firstMsg = messages.find((m, i) => i >= index && m.role === 'assistant' && m.character_hash === charHash);
                if (firstMsg) {
                    const firstIdx = messages.indexOf(firstMsg);
                    const statusBefore = window.HistoryStateEngine.findStatusBefore(messages, firstIdx);
                    if (statusBefore) {
                        window.HistoryStateEngine.restore(session, charHash, statusBefore,
                            () => this._syncStatusToUI());
                    } else {
                        // Absolute fallback: reset to character defaults
                        const charObj = this.state.personas?.characters?.[charHash] || {};
                        const cs = window.HistoryStateEngine.ensureCharState(session, charHash);
                        cs.inventory = [];
                        cs.outfits = [...(charObj.default_outfits || [])];
                        cs.emotion_state = {};
                        cs.action_state = {};
                        this._syncStatusToUI();
                    }
                }
            });
        } else {
            // Single: restore to status_after of the last assistant msg before index.
            // If no assistant msg exists before index, restore to the statusBefore of
            // the assistant msg being deleted (i.e. state at session start).
            const charHash = this._getActiveCharHash();
            let restored = false;
            for (let i = index - 1; i >= 0; i--) {
                const m = messages[i];
                if (m.role !== 'assistant') continue;
                if (m.type === 'narrator' && m.narrator_type !== 'first_message') continue;
                const migrated = this.migrateMessage(m);
                const status = window.HistoryStateEngine.readStatus(migrated, migrated.activeIndex);
                if (status) {
                    window.HistoryStateEngine.restore(session, charHash, status,
                        () => this._syncStatusToUI());
                }
                restored = true;
                break;
            }
            if (!restored) {
                // No prior assistant msg — this is the first assistant msg in the session.
                // Restore to the statusBefore captured at stream start (stored nowhere explicitly),
                // so fall back to resetting character state to session-initial defaults.
                const statusBefore = window.HistoryStateEngine.findStatusBefore(messages, index);
                if (statusBefore) {
                    window.HistoryStateEngine.restore(session, charHash, statusBefore,
                        () => this._syncStatusToUI());
                } else {
                    // Absolute fallback: reset to character defaults (outfits from persona, empty inventory)
                    const charObj = this.state.personas?.characters?.[charHash] || {};
                    const cs = window.HistoryStateEngine.ensureCharState(session, charHash);
                    cs.inventory = [];
                    cs.outfits = [...(charObj.default_outfits || [])];
                    cs.emotion_state = {};
                    cs.action_state = {};
                    this._syncStatusToUI();
                }
            }
        }

        session.messages = messages.slice(0, index);
        this._saveSession();
        this.renderMessages();
    },

    removeImageFromMessage(index, url) {
        const session = this._getActiveSession();
        const msg = session?.messages[index];
        if (!msg) return;
        const migrated = this.migrateMessage(msg);
        const snap = migrated.snapshots[migrated.activeIndex];
        if (snap && snap[1]) {
            const urlObjIndex = snap[1].findIndex(item => (typeof item === 'string' ? item : item.url) === url);
            if (urlObjIndex > -1) {
                snap[1].splice(urlObjIndex, 1);
                session.messages[index] = migrated;
                this._saveSession();
                this.renderMessages();
            }
        }
    },

    async handleRegenerateMessage(index) {
        if (this.state.currentAbortController) {
            console.log("[Chat] User interrupted stream. Aborting current background stream.");
            this.state.currentAbortController.abort();
            this.state.currentAbortController = null;
        }
        this.state.isStreaming = false;
        this._setStreamingUI(false);

        const messages = this._getActiveMessages();
        const contextMessages = this.flattenMessages(messages.slice(0, index));

        const msg = this.migrateMessage(messages[index]);
        this._getActiveSession().messages[index] = msg;

        // Restore status to what it was BEFORE this message's turn
        // (only for single mode — group regen handles its own restore inside _regenGroupMessage)
        if (!this.state.activeChatGroupId) {
            const statusBefore = window.HistoryStateEngine.findStatusBefore(messages, index);
            if (statusBefore) this._restoreStatusSnapshot(statusBefore);
        }

        // Group mode: delegate entirely to _regenGroupMessage which handles
        // group regen correctly.
        if (this.state.activeChatGroupId) {
            await this._regenGroupMessage(index);
            return;
        }

        msg.snapshots.push(['', [], null, null]);
        msg.activeIndex = msg.snapshots.length - 1;
        this.renderMessages();

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};

        await this._streamChatResponse(charObj, userObj, contextMessages, index);
    },

    async handleRegenerateFromUserMessage(index) {
        const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
            ? (msg) => window.Yuuka.ui.confirm(msg)
            : (msg) => Promise.resolve(window.confirm(msg));
        if (!await confirmFn('Cắt bỏ tất cả các messages sau tin nhắn này và yêu cầu bot trả lời lại?')) return;

        if (this.state.currentAbortController) {
            this.state.currentAbortController.abort();
            this.state.currentAbortController = null;
        }
        this.state.isStreaming = false;
        this._setStreamingUI(false);

        const session = this._getActiveSession();
        const messages = session.messages;

        // --- Group mode ---
        if (this.state.activeChatGroupId) {
            const removedAssistants = messages.filter((m, i) => i > index && m.role === 'assistant' && m.character_hash);
            const restoredHashes = new Set();
            for (const m of removedAssistants) {
                if (restoredHashes.has(m.character_hash)) continue;
                const statusBefore = window.HistoryStateEngine.findStatusBefore(messages, messages.indexOf(m));
                if (statusBefore) {
                    window.HistoryStateEngine.restore(session, m.character_hash, statusBefore);
                    restoredHashes.add(m.character_hash);
                }
            }

            session.messages = messages.slice(0, index + 1);

            const selection = this.state.groupCharacterBarSelection;
            const memberHashes = session.member_hashes || [];
            let mainCharHash = null;
            if (selection === 'random') {
                const userMsg = session.messages[index];
                const userContent = userMsg
                    ? (Array.isArray(userMsg.snapshots?.[userMsg.activeIndex])
                        ? userMsg.snapshots[userMsg.activeIndex][0]
                        : userMsg.snapshots?.[userMsg.activeIndex]) || ''
                    : '';
                mainCharHash = this._turnSelector ? this._turnSelector(userContent, memberHashes) : memberHashes[0];
            } else {
                mainCharHash = selection || memberHashes[0] || null;
            }

            session.messages.push({
                role: 'assistant',
                snapshots: [['', [], null, null]],
                activeIndex: 0,
                character_hash: mainCharHash,
                response_mode: 'default',
            });

            this._saveSession();
            this.renderMessages();
            const targetIndex = session.messages.length - 1;
            await this._streamGroupDefaultMode(mainCharHash, null, targetIndex);
            return;
        }

        // --- Single mode ---
        const nextAssistantIndex = messages.findIndex((m, i) => i > index && m.role === 'assistant' && m.type !== 'narrator');
        if (nextAssistantIndex !== -1) {
            const statusBefore = window.HistoryStateEngine.findStatusBefore(messages, nextAssistantIndex);
            if (statusBefore) this._restoreStatusSnapshot(statusBefore);
        }

        session.messages = messages.slice(0, index + 1);
        session.messages.push({
            role: 'assistant',
            snapshots: [['', [], null, null]],
            activeIndex: 0
        });

        this._saveSession();
        this.renderMessages();

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};
        const contextMessages = this.flattenMessages(session.messages.slice(0, -1));
        const newAssistantIndex = session.messages.length - 1;
        await this._streamChatResponse(charObj, userObj, contextMessages, newAssistantIndex);
    }
});
