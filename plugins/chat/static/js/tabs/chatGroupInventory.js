Object.assign(window.ChatComponent.prototype, {

    /**
     * Opens the inventory panel in group mode.
     * Renders member section with group name/delete controls + member picker,
     * then syncs status to the last speaking character.
     */
    _handleGroupInventoryOpen() {
        if (!this.state.activeChatGroupId) return false;

        // Ensure status tab is active and visible
        const statusTab = this.container.querySelector('#status-tab-status');
        const memoryTab = this.container.querySelector('#status-tab-memory');
        const scenesTab = this.container.querySelector('#status-tab-scenes');
        const albumTab = this.container.querySelector('#status-tab-album');
        if (statusTab) statusTab.style.display = '';
        if (memoryTab) memoryTab.style.display = 'none';
        if (scenesTab) scenesTab.style.display = 'none';
        if (albumTab) albumTab.style.display = 'none';

        // Reset active tab button
        this.container.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
        const statusBtn = this.container.querySelector('.status-tab-btn[data-tab="status"]');
        if (statusBtn) statusBtn.classList.add('active');

        this._renderGroupInventoryStatus();
        this._syncMemoryUI && this._syncMemoryUI();

        return true;
    },

    /**
     * Renders the group status tab: member section (name input + delete + avatar picker)
     * then auto-selects the last speaking character and syncs status UI.
     */
    _renderGroupInventoryStatus() {
        const session = this.state.activeChatGroupSession;
        if (!session) return;

        const statusTab = this.container.querySelector('#status-tab-status');
        if (!statusTab) return;

        // Sync location from group session
        const locationLabel = this.container.querySelector('#inventory-location-label');
        if (locationLabel) locationLabel.textContent = session.location || 'Unknown';

        // Render member section (name/delete controls + avatar picker)
        this._renderGroupMemberPicker();

        // Auto-select: last assistant message's character_hash, fallback to first member
        let autoSelectedHash = (session.member_hashes || [])[0] || null;
        const messages = session.messages || [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role === 'assistant' && m.character_hash) {
                autoSelectedHash = m.character_hash;
                break;
            }
        }

        if (autoSelectedHash) {
            this.state.activeGroupInventoryCharHash = autoSelectedHash;
            this._syncGroupStatusToUI(autoSelectedHash);
        }
    },

    /**
     * Renders #inventory-member-section with:
     * - Group name input (auto-save 800ms) + delete button on the first row
     * - Avatar buttons (one per member) for character selection
     */
    _renderGroupMemberPicker() {
        const session = this.state.activeChatGroupSession;
        if (!session) return;

        const memberSection = this.container.querySelector('#inventory-member-section');
        if (!memberSection) return;

        memberSection.innerHTML = '';

        // --- Row 1: group name input + delete button ---
        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;margin-bottom:6px;';

        const nameInput = document.createElement('input');
        nameInput.id = 'group-name-input';
        nameInput.type = 'text';
        nameInput.value = session.name || '';
        nameInput.placeholder = 'Group name...';
        nameInput.style.cssText = [
            'background:none',
            'border:none',
            'outline:none',
            'color:inherit',
            'font-size:1em',
            'font-weight:600',
            'flex:1',
            'min-width:0',
            'padding:0 4px',
            'font-family:inherit',
        ].join(';');

        let saveTimer = null;
        nameInput.addEventListener('input', () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => {
                const newName = nameInput.value.trim();
                if (!newName) return;
                try {
                    await this.api['chat'].put(`/group_sessions/${session.id}`, { name: newName });
                    this.state.activeChatGroupSession.name = newName;
                    const chatHeaderName = this.container.querySelector('#chat-header-name');
                    if (chatHeaderName) chatHeaderName.textContent = newName;
                } catch (e) {
                    console.error('Failed to save group name:', e);
                }
            }, 800);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.title = 'Delete group';
        deleteBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;color:var(--chat-text-secondary,#aaa);display:flex;align-items:center;flex-shrink:0;';
        deleteBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;">delete</span>';
        deleteBtn.addEventListener('click', async () => {
            const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
                ? (msg) => window.Yuuka.ui.confirm(msg)
                : (msg) => Promise.resolve(window.confirm(msg));
            const confirmed = await confirmFn(`Delete group "${session.name || 'this group'}"? This cannot be undone.`);
            if (!confirmed) return;
            try {
                await this.api['chat'].delete(`/group_sessions/${session.id}`);
                const panel = this.container.querySelector('#modal-inventory');
                if (panel) panel.classList.add('hidden');
                const chatView = this.container.querySelector('#view-chat');
                if (chatView) chatView.classList.remove('inventory-open');
                this.state.activeChatGroupId = null;
                this.state.activeChatGroupSession = null;
                this.state.activeChatSession = null;
                this._destroyCharacterBar && this._destroyCharacterBar();
                this.switchTab('chat_list');
                this.renderChatList && this.renderChatList();
            } catch (e) {
                console.error('Failed to delete group:', e);
                alert('Failed to delete group. Please try again.');
            }
        });

        nameRow.appendChild(nameInput);
        nameRow.appendChild(deleteBtn);
        memberSection.appendChild(nameRow);

        // --- Row 2: avatar buttons ---
        const memberHashes = session.member_hashes || [];
        if (memberHashes.length === 0) return;

        const avatarRow = document.createElement('div');
        avatarRow.style.cssText = 'display:flex;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:center;';

        const activeHash = this.state.activeGroupInventoryCharHash;

        memberHashes.forEach(charHash => {
            const persona = this.state.personas?.characters?.[charHash];
            const btn = document.createElement('button');
            btn.dataset.charHash = charHash;
            btn.title = persona?.name || charHash;

            const isActive = charHash === activeHash;
            btn.style.cssText = [
                'width:40px',
                'height:40px',
                'border-radius:50%',
                'border:2px solid transparent',
                'cursor:pointer',
                'background-color:var(--chat-bg-secondary,#2a2a2a)',
                'background-size:cover',
                'background-position:center',
                'overflow:hidden',
                'flex-shrink:0',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'padding:0',
                isActive
                    ? 'box-shadow:0 0 0 2px var(--accent,#7c6af7);border-color:var(--accent,#7c6af7);opacity:1'
                    : 'opacity:0.45',
            ].join(';');

            if (persona?.avatar) {
                btn.style.backgroundImage = `url('${persona.avatar}')`;
            } else {
                btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:22px;color:var(--chat-text-secondary,#aaa);pointer-events:none;">person</span>';
            }

            btn.addEventListener('click', () => {
                this.state.activeGroupInventoryCharHash = charHash;
                avatarRow.querySelectorAll('button').forEach(b => {
                    const isNowActive = b.dataset.charHash === charHash;
                    b.style.opacity = isNowActive ? '1' : '0.45';
                    b.style.boxShadow = isNowActive ? '0 0 0 2px var(--accent,#7c6af7)' : '';
                    b.style.borderColor = isNowActive ? 'var(--accent,#7c6af7)' : 'transparent';
                });
                this._syncGroupStatusToUI(charHash);
            });

            avatarRow.appendChild(btn);
        });

        memberSection.appendChild(avatarRow);
    },

    /**
     * Populates the existing inventory status DOM elements from character_states[charHash].
     * Shows the rows that _renderGroupInventoryStatus previously hid.
     */
    _syncGroupStatusToUI(charHash) {
        const session = this.state.activeChatGroupSession;
        if (!session) return;

        const charState = (session.character_states || {})[charHash] || {
            emotion_state: {},
            action_state: {},
            stamina: null,
            outfits: [],
            inventory: [],
        };

        // Show character-specific rows
        const showSelectors = [
            '#inventory-stamina-label',
            '#inventory-emotion-list',
            '#inventory-action-list',
            '#inventory-outfits-slot',
            '#inventory-bag-slot',
        ];
        const statusTab = this.container.querySelector('#status-tab-status');
        showSelectors.forEach(sel => {
            const el = this.container.querySelector(sel);
            if (!el) return;
            const row = el.closest('.inventory-row, .status-row, [class*="row"]') || el.parentElement;
            if (row && row !== statusTab) {
                row.style.display = '';
            } else {
                el.style.display = '';
            }
            const label = this.container.querySelector(`label[for="${sel.slice(1)}"], [data-for="${sel.slice(1)}"]`);
            if (label) label.style.display = '';
        });

        // Stamina
        const staminaLabel = this.container.querySelector('#inventory-stamina-label');
        if (staminaLabel) {
            const maxStamina = this.actionEngine?.getMaxStamina?.() || 100;
            const currentStamina = charState.stamina !== undefined && charState.stamina !== null
                ? charState.stamina : maxStamina;
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

        // Emotions
        const emotionList = this.container.querySelector('#inventory-emotion-list');
        if (emotionList) {
            emotionList.innerHTML = '';
            const activeEmotions = charState.emotion_state
                ? Object.entries(charState.emotion_state)
                    .filter(([k, v]) => Math.abs(v) > 0)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                : [];

            if (activeEmotions.length > 0) {
                activeEmotions.forEach(([type, value]) => {
                    const pill = document.createElement('span');
                    pill.className = 'inventory-item';
                    pill.style.cssText = 'cursor:default;text-transform:capitalize;';
                    pill.textContent = `${this._formatTypeName(type)}: ${value}`;
                    emotionList.appendChild(pill);
                });
            } else {
                const neutral = document.createElement('span');
                neutral.style.cssText = 'color:var(--chat-text-secondary);font-style:italic;';
                neutral.textContent = 'Neutral';
                emotionList.appendChild(neutral);
            }
        }

        // Actions
        const actionList = this.container.querySelector('#inventory-action-list');
        if (actionList) {
            actionList.innerHTML = '';
            const activeActions = charState.action_state
                ? Object.entries(charState.action_state).filter(([k, v]) => v > 0)
                : [];

            if (activeActions.length > 0) {
                activeActions.forEach(([type, value]) => {
                    const pill = document.createElement('span');
                    pill.className = 'inventory-item';
                    const isDuo = this.actionEngine?.isDuoType?.(type);
                    pill.style.cssText = `cursor:default;text-transform:capitalize;${isDuo ? 'border-color:var(--chat-primary);' : ''}`;
                    pill.textContent = isDuo ? `❤ ${this._formatTypeName(type)}` : this._formatTypeName(type);
                    actionList.appendChild(pill);
                });
            } else {
                const none = document.createElement('span');
                none.style.cssText = 'color:var(--chat-text-secondary);font-style:italic;';
                none.textContent = 'Idle';
                actionList.appendChild(none);
            }
        }

        // Outfits slot
        const outfitsSlot = this.container.querySelector('#inventory-outfits-slot');
        const bagSlot = this.container.querySelector('#inventory-bag-slot');

        if (outfitsSlot && bagSlot) {
            const outfits = charState.outfits || [];
            const inventory = charState.inventory || [];

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
                const outfitAction = (this.state.pendingActions || []).find(
                    a => a.type === 'outfit_change' && a.data?.charHash === charHash
                );
                if (outfitAction?.data?.moves?.some(m => m.item === itemText)) {
                    el.classList.add('inventory-item--pending');
                }

                el.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ item: itemText, source }));
                    el.classList.add('dragging');
                });
                el.addEventListener('dragend', () => el.classList.remove('dragging'));

                // Touch drag
                let ghost = null;
                let touchActive = false;

                el.addEventListener('touchstart', (e) => {
                    if (e.touches.length !== 1) return;
                    touchActive = true;
                    const touch = e.touches[0];
                    ghost = el.cloneNode(true);
                    ghost.className = 'inventory-item inventory-drag-ghost';
                    const rect = el.getBoundingClientRect();
                    ghost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;width:${rect.width}px;opacity:0.85;left:${touch.clientX - rect.width / 2}px;top:${touch.clientY - rect.height / 2}px;box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:none;`;
                    document.body.appendChild(ghost);
                    el.classList.add('dragging');
                }, { passive: true });

                el.addEventListener('touchmove', (e) => {
                    if (!touchActive || !ghost) return;
                    e.preventDefault();
                    const touch = e.touches[0];
                    const rect = ghost.getBoundingClientRect();
                    ghost.style.left = `${touch.clientX - rect.width / 2}px`;
                    ghost.style.top = `${touch.clientY - rect.height / 2}px`;
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
                    const touch = e.changedTouches[0];
                    for (const { el: zone, type: targetType } of dropZones) {
                        const zr = zone.getBoundingClientRect();
                        if (touch.clientX >= zr.left && touch.clientX <= zr.right &&
                            touch.clientY >= zr.top && touch.clientY <= zr.bottom) {
                            this._moveGroupInventoryItem(source, targetType, itemText);
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
            outfits.forEach(item => outfitsSlot.appendChild(createItemEl(item, 'outfits')));

            bagSlot.innerHTML = '';
            inventory.forEach(item => bagSlot.appendChild(createItemEl(item, 'inventory')));

            // Mouse drop handling
            const setupDropZone = (zone, targetType) => {
                zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
                zone.ondragleave = () => zone.classList.remove('drag-over');
                zone.ondrop = (e) => {
                    e.preventDefault();
                    zone.classList.remove('drag-over');
                    try {
                        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                        this._moveGroupInventoryItem(data.source, targetType, data.item);
                    } catch (err) { }
                };
            };

            setupDropZone(outfitsSlot, 'outfits');
            setupDropZone(bagSlot, 'inventory');
        }
    },

    /**
     * Moves an item between outfits and inventory for the active group character.
     * Pushes a system_action outfit_change message and persists the session.
     * Merges consecutive outfit_change actions of the same type (put_on / take_off)
     * within the same turn boundary, mirroring single-chat behaviour.
     */
    _moveGroupInventoryItem(sourceType, targetType, item) {
        if (sourceType === targetType) return;

        const activeHash = this.state.activeGroupInventoryCharHash;
        if (!activeHash) return;

        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const cs = (groupSession.character_states || {})[activeHash];
        if (!cs) return;

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
            a => a.type === 'outfit_change' && a.data?.charHash === activeHash
        );

        const charName = this.state.personas?.characters?.[activeHash]?.name || 'Character';

        if (outfitAction) {
            const prevMoveIdx = outfitAction.data.moves.findIndex(m => m.item === item);
            if (prevMoveIdx > -1) {
                const prev = outfitAction.data.moves[prevMoveIdx];
                if (prev.sourceType === targetType && prev.targetType === sourceType) {
                    outfitAction.data.moves.splice(prevMoveIdx, 1);
                    if (outfitAction.data.moves.length === 0) {
                        this._removePendingAction(outfitAction.id);
                        this._syncGroupStatusToUI(activeHash);
                        return;
                    }
                } else {
                    outfitAction.data.moves[prevMoveIdx] = { item, sourceType, targetType };
                }
            } else {
                outfitAction.data.moves.push({ item, sourceType, targetType });
            }
            outfitAction.revertFn = this._buildOutfitRevertFn(cs, outfitAction.data.moves);
            outfitAction.label = this._buildOutfitChangeLabel(outfitAction.data.moves, activeHash);
        } else {
            const moves = [{ item, sourceType, targetType }];
            const actionId = `outfit_change-${activeHash}`;
            const revertFn = this._buildOutfitRevertFn(cs, moves);
            const label = this._buildOutfitChangeLabel(moves, activeHash);
            this.state.pendingActions.push({
                id: actionId,
                type: 'outfit_change',
                label,
                chipLabel: `👗 ${charName}`,
                data: { charHash: activeHash, moves },
                revertFn
            });
            this._renderContextBar();
        }

        this._renderGroupMemberPicker && this._renderGroupMemberPicker();
        this._syncGroupStatusToUI(activeHash);
    },

    /**
     * Regenerates all_character_info_summary after member changes.
     */
    async _regenerateGroupCharacterSummary(memberHashes) {
        const session = this.state.activeChatGroupSession;
        if (!session) return;

        const model = localStorage.getItem('chat-llm-model') || undefined;

        try {
            const summaryRes = await this.api['chat'].post('/generate/group_character_summary', {
                group_id: session.id,
                member_hashes: memberHashes,
                model: model
            });
            const summary = (summaryRes && summaryRes.summary) ? summaryRes.summary : '';
            if (summary) {
                await this.api['chat'].put(`/group_sessions/${session.id}`, {
                    all_character_info_summary: summary
                });
                session.all_character_info_summary = summary;
            }
        } catch (e) {
            console.warn('Failed to regenerate character summary:', e);
        }
    },

    /**
     * Opens the inventory panel in group mode.
     * Called from chatGroupView.js when the inventory button is clicked.
     */
    _openGroupInventoryPanel() {
        this._handleGroupInventoryOpen();
        this._syncMemoryUI && this._syncMemoryUI();
        const panel = this.container.querySelector('#modal-inventory');
        const chatView = this.container.querySelector('#view-chat');
        if (panel) {
            panel.classList.remove('hidden');
            if (chatView) chatView.classList.add('inventory-open');
        }
    },
});
