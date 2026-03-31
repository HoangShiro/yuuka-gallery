Object.assign(window.ChatComponent.prototype, {
    // --- Streaming UI, Save, Status Sync, Inventory ---

    _formatTypeName(name) {
        return name.replaceAll('_', ' ');
    },

    _setStreamingUI(isStreaming) {
        // Keep the dock input enabled even while streaming so users can type drafts
        const dockInput = document.querySelector('#chat-dock-input');
        
        // Change send button icon
        const dockSendBtn = dockInput?.parentElement?.querySelector('.nav-btn--submit');
        if (dockSendBtn) {
            if (isStreaming) {
                dockSendBtn.innerHTML = '<span class="material-symbols-outlined">stop_circle</span>';
                dockSendBtn.title = 'Stop Generating';
                dockSendBtn.style.color = 'var(--chat-primary, #6fa)'; // optional visual cue
            } else {
                dockSendBtn.innerHTML = '<span class="material-symbols-outlined">send</span>';
                dockSendBtn.title = 'Send';
                dockSendBtn.style.color = '';
            }
        }
    },

    _saveCurrentSession() {
        if (!this.state.activeChatSession) return;
        const charHash = this.state.activeChatCharacterHash;
        const sessionId = this.state.activeChatSession.id;
        this.api['chat'].post(`/sessions/${charHash}/${sessionId}`, this.state.activeChatSession);
    },

    /**
     * Save the current session, routing to the correct endpoint for Single vs Group mode.
     * Use this instead of _saveCurrentSession() in action handlers that run in both modes.
     */
    _saveSession() {
        if (this.state.activeChatGroupId) {
            this._saveGroupSession && this._saveGroupSession();
        } else {
            this._saveCurrentSession();
        }
    },

    /**
     * Returns the active session object regardless of mode.
     * Group mode → activeChatGroupSession
     * Single mode → activeChatSession
     */
    _getActiveSession() {
        return this.state.activeChatGroupId
            ? this.state.activeChatGroupSession
            : this.state.activeChatSession;
    },

    /**
     * Returns the messages array of the active session.
     */
    _getActiveMessages() {
        return this._getActiveSession()?.messages || [];
    },

    /**
     * Returns the charHash relevant to a given message (or the active char if no msg given).
     * Group mode → msg.character_hash (for assistant msgs) or groupCharacterBarSelection
     * Single mode → activeChatCharacterHash
     * @param {object|null} msg - Optional message object (used in group mode for assistant msgs)
     */
    _getActiveCharHash(msg = null) {
        if (this.state.activeChatGroupId) {
            return (msg && msg.character_hash) || this.state.groupCharacterBarSelection || null;
        }
        return this.state.activeChatCharacterHash;
    },

    /**
     * Sync character_states from the active snapshot[2] of the last assistant message.
     *
     * character_states is the live working state used during streaming. But after a
     * snapshot nav (prev/next) or a delete/regen, the active snapshot may differ from
     * what was last streamed. This method ensures character_states always matches the
     * currently active snapshot so that _syncStatusToUI shows the correct values.
     *
     * Skipped during active streaming — the stream mutates character_states directly.
     */
    _syncLiveStateFromHistory() {
        if (this.state.isStreaming) return;

        const session = this.state.activeChatSession;
        if (!session) return;

        const isGroup = !!this.state.activeChatGroupId;
        const groupSession = isGroup ? this.state.activeChatGroupSession : null;
        const messages = (isGroup ? groupSession?.messages : session.messages) || [];

        if (isGroup) {
            // For group: sync each character's live state from their last assistant message
            const memberHashes = groupSession?.member_hashes || [];
            const lastStatusPerChar = {};

            for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (m.role !== 'assistant' || m.type === 'narrator' || !m.character_hash) continue;
                if (lastStatusPerChar[m.character_hash] !== undefined) continue;

                const migrated = this.migrateMessage(m);
                const status = window.HistoryStateEngine.readStatus(migrated, migrated.activeIndex);
                lastStatusPerChar[m.character_hash] = status || null;

                if (Object.keys(lastStatusPerChar).length === memberHashes.length) break;
            }

            memberHashes.forEach(charHash => {
                const status = lastStatusPerChar[charHash];
                if (status) {
                    window.HistoryStateEngine.restore(groupSession, charHash, status);
                }
            });
        } else {
            // Single mode: sync from the last assistant message's active snapshot
            const charHash = this.state.activeChatCharacterHash;
            if (!charHash) return;

            for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (m.role !== 'assistant' || m.type === 'narrator') continue;

                const migrated = this.migrateMessage(m);
                const status = window.HistoryStateEngine.readStatus(migrated, migrated.activeIndex);
                if (status) {
                    window.HistoryStateEngine.restore(session, charHash, status);
                }
                break; // only need the last one
            }
        }
    },

    _syncStatusToUI() {
        const session = this.state.activeChatSession;
        if (!session) return;

        // Location UI — Shared across both modes
        const locLabel = this.container.querySelector('#inventory-location-label');
        if (locLabel) {
            let currentLoc = "";
            if (this.state.activeChatGroupId) {
                currentLoc = session.location || "";
            } else {
                const charHash = this.state.activeChatCharacterHash;
                const cs = window.HistoryStateEngine.ensureCharState(session, charHash);
                currentLoc = cs.location || "";
            }
            locLabel.value = currentLoc || "Unknown";

            // Add auto-save if not already bound — handles both modes internally
            if (!locLabel._bound) {
                locLabel.addEventListener('input', () => {
                    const newLoc = locLabel.value.trim();
                    const s = this._getActiveSession();
                    if (!s) return;
                    
                    if (this.state.activeChatGroupId) {
                        s.location = newLoc;
                        this._saveSession();
                    } else {
                        const ch = this.state.activeChatCharacterHash;
                        if (ch) {
                            const cs = window.HistoryStateEngine.ensureCharState(s, ch);
                            cs.location = newLoc;
                            this._saveSession();
                        }
                    }
                });
                locLabel._bound = true;
            }
        }

        // In group mode, delegate character-specific UI to the group-aware version
        if (this.state.activeChatGroupId) {
            const activeHash = this.state.activeGroupInventoryCharHash;
            if (activeHash && this._syncGroupStatusToUI) {
                this._syncGroupStatusToUI(activeHash);
            }
            return;
        }

        // Single mode: read directly from character_states[charHash]
        const charHash = this.state.activeChatCharacterHash;
        const cs = window.HistoryStateEngine.ensureCharState(session, charHash);

        // Emotion Engine UI — show top 2 type names below character name
        const moodContainer = this.container.querySelector('#chat-header-mood');
        if (moodContainer) {
            moodContainer.innerHTML = '';
            let hasContent = false;

            let activeEmotions = [];
            if (cs.emotion_state && Object.keys(cs.emotion_state).length > 0) {
                activeEmotions = Object.entries(cs.emotion_state)
                    .filter(([k, v]) => Math.abs(v) > 0)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .map(([k]) => k);
            }

            let activeActions = [];
            if (cs.action_state && Object.keys(cs.action_state).length > 0) {
                activeActions = Object.keys(cs.action_state);
                if (this.actionEngine) {
                    activeActions.sort((a, b) => {
                        const isDuoA = this.actionEngine.isDuoType(a) ? 1 : 0;
                        const isDuoB = this.actionEngine.isDuoType(b) ? 1 : 0;
                        return isDuoB - isDuoA; // Duo first
                    });
                }
            }

            let takeActions = 0, takeEmotions = 0;
            if (activeActions.length > 0 && activeEmotions.length > 0) {
                takeActions = 1;
                takeEmotions = 1;
            } else if (activeActions.length > 0) {
                takeActions = Math.min(2, activeActions.length);
            } else if (activeEmotions.length > 0) {
                takeEmotions = Math.min(2, activeEmotions.length);
            }

            const finalEmotions = activeEmotions.slice(0, takeEmotions);
            const finalActions = activeActions.slice(0, takeActions);

            if (finalEmotions.length > 0) {
                const span = document.createElement('span');
                const emotionText = finalEmotions.map(e => this._formatTypeName(e)).join(', ');
                span.textContent = emotionText;
                span.title = emotionText;
                span.style.cssText = 'flex: 0 1 auto; min-width: 0; font-size: 0.85em; color: var(--chat-text, #fff); font-weight: 500; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                moodContainer.appendChild(span);
                hasContent = true;
            }

            if (finalActions.length > 0) {
                if (hasContent) {
                    const sep = document.createElement('span');
                    sep.textContent = ' · ';
                    sep.style.cssText = 'font-size: 0.8em; color: var(--chat-text-secondary, #666); flex-shrink: 0;';
                    moodContainer.appendChild(sep);
                }
                const span = document.createElement('span');
                const actionText = finalActions.map(a => this._formatTypeName(a)).join(', ');
                span.textContent = actionText;
                span.title = actionText;
                span.style.cssText = 'flex: 0 1 auto; min-width: 0; font-size: 0.8em; color: var(--chat-primary, #6fa); text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                moodContainer.appendChild(span);
                hasContent = true;
            }

            moodContainer.style.display = hasContent ? 'flex' : 'none';
        }

        // Stamina UI
        const staminaLabel = this.container.querySelector('#inventory-stamina-label');
        if (staminaLabel) {
            const maxStamina = this.actionEngine?.getMaxStamina?.() || 100;
            const currentStamina = cs.stamina !== undefined && cs.stamina !== null
                ? cs.stamina : maxStamina;
            staminaLabel.textContent = `⚡ ${Math.round(currentStamina)}`;

            const ratio = currentStamina / maxStamina;
            if (ratio <= 0.25) {
                staminaLabel.style.color = '#f44336';
            } else if (ratio <= 0.5) {
                staminaLabel.style.color = '#ff9800';
            } else {
                staminaLabel.style.color = 'var(--chat-primary)';
            }
        }

        // Emotion list in inventory modal
        const emotionList = this.container.querySelector('#inventory-emotion-list');
        if (emotionList) {
            emotionList.innerHTML = '';
            const activeEmotions = cs.emotion_state
                ? Object.entries(cs.emotion_state)
                    .filter(([k, v]) => Math.abs(v) > 0)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                : [];

            if (activeEmotions.length > 0) {
                activeEmotions.forEach(([type, value]) => {
                    const pill = document.createElement('span');
                    pill.className = 'inventory-item';
                    pill.style.cssText = 'cursor: default; text-transform: capitalize;';
                    pill.textContent = `${this._formatTypeName(type)}: ${value}`;
                    emotionList.appendChild(pill);
                });
            } else {
                const neutral = document.createElement('span');
                neutral.style.cssText = 'color: var(--chat-text-secondary); font-style: italic;';
                neutral.textContent = 'Neutral';
                emotionList.appendChild(neutral);
            }
        }

        // Action list in inventory modal
        const actionList = this.container.querySelector('#inventory-action-list');
        if (actionList) {
            actionList.innerHTML = '';
            const activeActions = cs.action_state
                ? Object.entries(cs.action_state).filter(([k, v]) => v > 0)
                : [];

            if (activeActions.length > 0) {
                activeActions.forEach(([type, value]) => {
                    const pill = document.createElement('span');
                    pill.className = 'inventory-item';
                    const isDuo = this.actionEngine?.isDuoType?.(type);
                    pill.style.cssText = `cursor: default; text-transform: capitalize; ${isDuo ? 'border-color: var(--chat-primary);' : ''}`;
                    pill.textContent = isDuo ? `❤ ${this._formatTypeName(type)}` : this._formatTypeName(type);
                    actionList.appendChild(pill);
                });
            } else {
                const none = document.createElement('span');
                none.style.cssText = 'color: var(--chat-text-secondary); font-style: italic;';
                none.textContent = 'Idle';
                actionList.appendChild(none);
            }
        }

        this._renderInventorySlots(cs);
    },

    _moveInventoryItem(sourceType, targetType, item) {
        if (sourceType === targetType) return;

        const session = this._getActiveSession();
        if (!session) return;

        // Inventory panel always operates on the character selected in the inventory panel,
        // not the character bar selection (those are independent UI concerns).
        const charHash = this.state.activeChatGroupId
            ? this.state.activeGroupInventoryCharHash
            : this.state.activeChatCharacterHash;
        if (!charHash) return;

        const cs = window.HistoryStateEngine.ensureCharState(session, charHash);

        // Apply the visual move immediately to cs so the UI reflects the new state.
        const sourceArr = sourceType === 'outfits' ? cs.outfits : cs.inventory;
        const idx = sourceArr.indexOf(item);
        if (idx === -1) return;
        sourceArr.splice(idx, 1);
        const targetArr = targetType === 'outfits' ? cs.outfits : cs.inventory;
        targetArr.push(item);

        // Find or create the single "Outfits change" pending action for this charHash.
        if (!this.state.pendingActions) this.state.pendingActions = [];
        let outfitAction = this.state.pendingActions.find(
            a => a.type === 'outfit_change' && a.data?.charHash === charHash
        );

        if (outfitAction) {
            // Check if this move cancels a previous move for the same item
            const prevMoveIdx = outfitAction.data.moves.findIndex(m => m.item === item);
            if (prevMoveIdx > -1) {
                // Item was already moved — this drag reverses it, cancel the previous move
                const prev = outfitAction.data.moves[prevMoveIdx];
                // Verify it's actually a reversal (going back to original slot)
                if (prev.sourceType === targetType && prev.targetType === sourceType) {
                    outfitAction.data.moves.splice(prevMoveIdx, 1);
                    // If no moves left, remove the whole pending action
                    if (outfitAction.data.moves.length === 0) {
                        this._removePendingAction(outfitAction.id);
                        this._renderInventorySlots(cs);
                        return;
                    }
                } else {
                    // Different direction — update the move record
                    outfitAction.data.moves[prevMoveIdx] = { item, sourceType, targetType };
                }
            } else {
                outfitAction.data.moves.push({ item, sourceType, targetType });
            }
            // Rebuild revertFn and label to cover all current moves
            outfitAction.revertFn = this._buildOutfitRevertFn(cs, outfitAction.data.moves);
            outfitAction.label = this._buildOutfitChangeLabel(outfitAction.data.moves, charHash);
        } else {
            // First outfit change — create the single chip
            const moves = [{ item, sourceType, targetType }];
            const actionId = `outfit_change-${charHash}`;
            const revertFn = this._buildOutfitRevertFn(cs, moves);
            const label = this._buildOutfitChangeLabel(moves, charHash);
            this.state.pendingActions.push({
                id: actionId,
                type: 'outfit_change',
                label,
                chipLabel: 'Outfits change',
                data: { charHash, moves },
                revertFn
            });
            this._renderContextBar();
        }

        this._renderInventorySlots(cs);
    },

    _buildOutfitRevertFn(cs, moves) {
        // Capture a snapshot of moves at the time of building so revert is stable
        const snapshot = moves.map(m => ({ ...m }));
        return () => {
            // Undo all moves in reverse order — do NOT call _renderInventorySlots here,
            // _removePendingAction will re-render after splice so dashed borders are gone.
            for (let i = snapshot.length - 1; i >= 0; i--) {
                const { item, sourceType, targetType } = snapshot[i];
                const revertTarget = targetType === 'outfits' ? cs.outfits : cs.inventory;
                const revertIdx = revertTarget.indexOf(item);
                if (revertIdx > -1) revertTarget.splice(revertIdx, 1);
                const revertSource = sourceType === 'outfits' ? cs.outfits : cs.inventory;
                if (!revertSource.includes(item)) revertSource.push(item);
            }
        };
    },

    /**
     * Build a descriptive label for an outfit_change pending action.
     * Groups moves by verb (put on / took off) and formats them for LLM context.
     * e.g. "*User put on **Maid outfits** for Arut; took off **Casual dress** for Arut*"
     */
    _buildOutfitChangeLabel(moves, charHash) {
        const userName = this.state.personas.users[this.state.activeUserPersonaId]?.name || 'User';
        const charName = this.state.personas.characters[charHash]?.name || 'Character';

        const putOn = moves.filter(m => m.targetType === 'outfits').map(m => m.item);
        const tookOff = moves.filter(m => m.sourceType === 'outfits').map(m => m.item);

        const parts = [];
        if (putOn.length > 0) {
            parts.push(this._buildActionLabel('outfit_change', {
                actor: userName, verb: 'put on', items: putOn, target: charName
            }));
        }
        if (tookOff.length > 0) {
            parts.push(this._buildActionLabel('outfit_change', {
                actor: userName, verb: 'took off', items: tookOff, target: charName
            }));
        }

        if (parts.length === 0) return '*Outfits change*';
        if (parts.length === 1) return parts[0];
        // Merge two italic strings: strip trailing * from first, leading * from second
        return parts[0].replace(/\*$/, '') + '; ' + parts[1].replace(/^\*/, '');
    },

    _renderInventorySlots(cs) {
        const session = this._getActiveSession();
        if (!session) return;
        if (!cs) {
            const charHash = this.state.activeChatGroupId
                ? this.state.activeGroupInventoryCharHash
                : this.state.activeChatCharacterHash;
            if (!charHash) return;
            cs = window.HistoryStateEngine.ensureCharState(session, charHash);
        }

        const outfitsSlot = this.container.querySelector('#inventory-outfits-slot');
        const bagSlot = this.container.querySelector('#inventory-bag-slot');

        if (!outfitsSlot || !bagSlot) return;

        const dropZones = [
            { el: outfitsSlot, type: 'outfits' },
            { el: bagSlot, type: 'inventory' },
        ];

        const createItemEl = (itemText, source) => {
            const el = document.createElement('div');
            el.className = 'inventory-item';
            el.draggable = true;
            el.textContent = itemText;
            el.dataset.source = source;
            el.dataset.item = itemText;

            // Mark item as pending if there's a pending outfit_change move for it
            const charHash = this.state.activeChatGroupId
                ? this.state.activeGroupInventoryCharHash
                : this.state.activeChatCharacterHash;
            const outfitAction = (this.state.pendingActions || []).find(
                a => a.type === 'outfit_change' && a.data?.charHash === charHash
            );
            const isPending = outfitAction?.data?.moves?.some(m => m.item === itemText);
            if (isPending) el.classList.add('inventory-item--pending');

            // --- Mouse drag ---
            el.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ item: itemText, source }));
                el.classList.add('dragging');
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
            });

            // --- Touch drag ---
            let ghost = null;
            let touchActive = false;

            el.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                touchActive = true;
                const touch = e.touches[0];

                // Create ghost clone
                ghost = el.cloneNode(true);
                ghost.className = 'inventory-item inventory-drag-ghost';
                const rect = el.getBoundingClientRect();
                ghost.style.cssText = `
                    position: fixed; z-index: 9999; pointer-events: none;
                    width: ${rect.width}px; opacity: 0.85;
                    left: ${touch.clientX - rect.width / 2}px;
                    top: ${touch.clientY - rect.height / 2}px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
                    transition: none;
                `;
                document.body.appendChild(ghost);
                el.classList.add('dragging');
            }, { passive: true });

            el.addEventListener('touchmove', (e) => {
                if (!touchActive || !ghost) return;
                e.preventDefault(); // Prevent scroll while dragging
                const touch = e.touches[0];
                const rect = ghost.getBoundingClientRect();
                ghost.style.left = `${touch.clientX - rect.width / 2}px`;
                ghost.style.top = `${touch.clientY - rect.height / 2}px`;

                // Highlight drop zone under finger
                dropZones.forEach(({ el: zone }) => zone.classList.remove('drag-over'));
                for (const { el: zone } of dropZones) {
                    const zr = zone.getBoundingClientRect();
                    if (touch.clientX >= zr.left && touch.clientX <= zr.right &&
                        touch.clientY >= zr.top && touch.clientY <= zr.bottom) {
                        zone.classList.add('drag-over');
                        break;
                    }
                }
            }, { passive: false });

            el.addEventListener('touchend', (e) => {
                if (!touchActive) return;
                touchActive = false;
                if (ghost) { ghost.remove(); ghost = null; }
                el.classList.remove('dragging');
                dropZones.forEach(({ el: zone }) => zone.classList.remove('drag-over'));

                // Detect drop target
                const touch = e.changedTouches[0];
                for (const { el: zone, type: targetType } of dropZones) {
                    const zr = zone.getBoundingClientRect();
                    if (touch.clientX >= zr.left && touch.clientX <= zr.right &&
                        touch.clientY >= zr.top && touch.clientY <= zr.bottom) {
                        this._moveInventoryItem(source, targetType, itemText);
                        break;
                    }
                }
            }, { passive: true });

            el.addEventListener('touchcancel', () => {
                touchActive = false;
                if (ghost) { ghost.remove(); ghost = null; }
                el.classList.remove('dragging');
                dropZones.forEach(({ el: zone }) => zone.classList.remove('drag-over'));
            }, { passive: true });

            return el;
        };

        outfitsSlot.innerHTML = '';
        cs.outfits.forEach(item => {
            outfitsSlot.appendChild(createItemEl(item, 'outfits'));
        });

        bagSlot.innerHTML = '';
        cs.inventory.forEach(item => {
            bagSlot.appendChild(createItemEl(item, 'inventory'));
        });

        // Mouse drop handling
        const setupDropZone = (zone, targetType) => {
            zone.ondragover = (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            };
            zone.ondragleave = () => {
                zone.classList.remove('drag-over');
            };
            zone.ondrop = (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    this._moveInventoryItem(data.source, targetType, data.item);
                } catch (err) { }
            };
        };

        setupDropZone(outfitsSlot, 'outfits');
        setupDropZone(bagSlot, 'inventory');
    }
});
