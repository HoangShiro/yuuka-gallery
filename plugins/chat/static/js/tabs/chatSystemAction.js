Object.assign(window.ChatComponent.prototype, {
    // --- System Action: Context Menu & Execution ---

    _openSystemActionMenu(anchorEl) {
        this._closeSystemActionMenu();

        const isGroup = !!this.state.activeChatGroupId;

        const menu = document.createElement('div');
        menu.className = 'system-action-menu';
        menu.id = 'system-action-menu';

        const items = [
            { id: 'gift', label: 'Gift', icon: 'redeem', action: () => this._openGiftSubMenu(menu) },
            { id: 'action', label: 'Action', icon: 'emoji_people', action: () => this._openActionSubMenu(menu) },
            { id: 'random_event', label: 'Random Event', icon: 'casino', action: () => isGroup ? this._executeGroupRandomEvent() : this._executeRandomEvent() },
            { id: 'scenario', label: 'Scenario', icon: 'auto_stories', action: () => { this._closeSystemActionMenu(); this.openScenario(); } },
            { id: 'new_chat', label: 'New Chat', icon: 'chat_add_on', action: () => this._executeNewChat() }
        ];

        items.forEach(item => {
            const row = document.createElement('button');
            row.className = 'system-action-menu-item';
            row.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span><span>${item.label}</span>`;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
            });
            menu.appendChild(row);
        });

        // Position: anchor above the "+" button
        const rect = anchorEl.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

        document.body.appendChild(menu);

        // Copy theme class from chat-app-container so CSS variables resolve correctly
        const chatApp = this.container.querySelector('.chat-app-container');
        if (chatApp) {
            ['theme-yuuka', 'theme-modern'].forEach(cls => {
                if (chatApp.classList.contains(cls)) menu.classList.add(cls);
            });
        }

        // Close on click outside
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
                this._closeSystemActionMenu();
                document.removeEventListener('click', closeHandler, true);
            }
        };
        this._systemActionCloseHandler = closeHandler;
        setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
    },

    _closeSystemActionMenu() {
        const existing = document.getElementById('system-action-menu');
        if (existing) existing.remove();
        if (this._systemActionCloseHandler) {
            document.removeEventListener('click', this._systemActionCloseHandler, true);
            this._systemActionCloseHandler = null;
        }
    },

    _openGiftSubMenu(menu, editMode = false) {
        // Replace menu content with gift items
        menu.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'system-action-menu-header';

        const backBtn = document.createElement('button');
        backBtn.className = 'system-action-back-btn';
        backBtn.innerHTML = '<span class="material-symbols-outlined">arrow_back</span>';
        backBtn.addEventListener('click', (e) => { e.stopPropagation(); this._rebuildMainMenu(menu); });

        const title = document.createElement('span');
        title.style.flex = '1';
        title.textContent = 'Gift';

        const editBtn = document.createElement('button');
        editBtn.className = 'system-action-back-btn system-action-edit-btn';
        editBtn.title = editMode ? 'Done' : 'Edit';
        editBtn.innerHTML = `<span class="material-symbols-outlined">${editMode ? 'check' : 'edit'}</span>`;
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); this._openGiftSubMenu(menu, !editMode); });

        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(editBtn);
        menu.appendChild(header);

        const itemsToRender = this._giftItemsCache || [];

        if (itemsToRender.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'system-action-menu-empty';
            empty.textContent = 'No items. Use @gift command';
            menu.appendChild(empty);
            return;
        }

        itemsToRender.forEach(item => {
            const row = document.createElement('button');
            row.className = 'system-action-menu-item';

            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = 'redeem';

            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = item.name || item.label;

            row.appendChild(icon);
            row.appendChild(label);

            if (editMode) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'system-action-delete-btn';
                deleteBtn.title = 'Delete';
                deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await this.api['chat'].delete(`/items/${item.id}`);
                        this._loadGiftItems().then(() => this._openGiftSubMenu(menu, true));
                    } catch (err) {
                        console.error('Failed to delete item', err);
                    }
                });
                row.appendChild(deleteBtn);
                row.addEventListener('click', (e) => e.stopPropagation());
            } else {
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._executeGiftAction(item);
                    this._closeSystemActionMenu();
                });
            }

            menu.appendChild(row);
        });
    },

    _openActionSubMenu(menu) {
        menu.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'system-action-menu-header';
        header.innerHTML = `<button class="system-action-back-btn"><span class="material-symbols-outlined">arrow_back</span></button><span>Action</span>`;
        header.querySelector('.system-action-back-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this._rebuildMainMenu(menu);
        });
        menu.appendChild(header);

        const duoTypes = this.actionEngine?.rules?.duo_types || {};
        const typeNames = Object.keys(duoTypes);

        if (typeNames.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'system-action-menu-empty';
            empty.textContent = 'No actions available';
            menu.appendChild(empty);
            return;
        }

        typeNames.forEach(typeName => {
            const row = document.createElement('button');
            row.className = 'system-action-menu-item';
            row.innerHTML = `<span class="material-symbols-outlined">favorite</span><span style="text-transform: capitalize;">${typeName.replace(/_/g, ' ')}</span>`;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                this._executeDuoAction(typeName);
                this._closeSystemActionMenu();
            });
            menu.appendChild(row);
        });
    },

    _rebuildMainMenu(menu) {
        menu.innerHTML = '';
        const items = [
            { id: 'gift', label: 'Gift', icon: 'redeem', action: () => this._openGiftSubMenu(menu) },
            { id: 'action', label: 'Action', icon: 'emoji_people', action: () => this._openActionSubMenu(menu) },
            { id: 'new_chat', label: 'New Chat', icon: 'chat_add_on', action: () => this._executeNewChat() }
        ];
        items.forEach(item => {
            const row = document.createElement('button');
            row.className = 'system-action-menu-item';
            row.innerHTML = `<span class="material-symbols-outlined">${item.icon}</span><span>${item.label}</span>`;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
            });
            menu.appendChild(row);
        });
    },

    _executeGiftAction(item) {
        // Route to group handler if in group mode
        if (this.state.activeChatGroupId) {
            return this._executeGroupGiftAction(item);
        }

        const session = this.state.activeChatSession;
        if (!session) return;

        // Build label
        const userName = this._getActiveUserName();
        const charName = this._getActiveCharacterName();
        const label = this._buildActionLabel('gift', { giver: userName, receiver: charName, item: item.name || item.label });

        // Apply inventory changes only when flushed (on Send), not immediately.
        // revertFn is a no-op since nothing has been applied yet.
        this._addPendingAction({
            type: 'gift',
            label,
            chipLabel: item.name || item.label,
            data: { item: item.id, name: item.name || item.label, tags: item.tags, itemType: item.type },
            revertFn: null
        });
        this._closeSystemActionMenu();
    },

    _executeDuoAction(actionType) {
        // Route to group handler if in group mode
        if (this.state.activeChatGroupId) {
            return this._executeGroupDuoAction(actionType);
        }

        const session = this.state.activeChatSession;
        if (!session) return;

        const userName = this._getActiveUserName();
        const charName = this._getActiveCharacterName();
        const displayName = actionType.replace(/_/g, ' ');
        const label = this._buildActionLabel('action', { actor: userName, target: charName, actionName: displayName });

        // Apply action_state only when flushed (on Send), not immediately.
        this._addPendingAction({
            type: 'duo_action',
            label,
            chipLabel: displayName,
            data: { actionType },
            revertFn: null
        });
        this._closeSystemActionMenu();
    },

    _triggerResponseAfterAction(actionLabel) {
        const session = this.state.activeChatSession;
        if (!session) return;

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};

        // Push empty assistant message for streaming
        session.messages.push({
            role: 'assistant',
            snapshots: [''],
            activeIndex: 0
        });

        this._saveCurrentSession();
        this.renderMessages();

        const contextMessages = this.flattenMessages(session.messages.slice(0, -1));

        // Add a system instruction after the action for the LLM to reply properly
        contextMessages.push({
            role: 'system',
            content: '[System Note: The user just gifted you an item or performed an action on you. Acknowledge and react to this organically, staying closely in character and following the persona and your current emotion.]'
        });

        const assistantIndex = session.messages.length - 1;

        this._streamChatResponse(charObj, userObj, contextMessages, assistantIndex);
    },

    // --- Pending Actions: Context Bar ---

    _renderContextBar() {
        const bar = document.getElementById('chat-context-bar');
        if (!bar) return;

        const actions = this.state.pendingActions || [];
        if (actions.length === 0) {
            bar.style.display = 'none';
            return;
        }

        bar.style.display = 'flex';
        bar.innerHTML = '';

        const iconMap = { gift: 'redeem', duo_action: 'favorite', outfit_change: 'checkroom' };

        actions.forEach(action => {
            const chip = document.createElement('span');
            chip.className = 'action-chip';
            chip.dataset.id = action.id;

            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
            icon.textContent = iconMap[action.type] || 'bolt';

            const label = document.createElement('span');
            label.textContent = action.chipLabel || action.label;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'chip-remove';
            removeBtn.title = 'Remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.addEventListener('click', () => this._removePendingAction(action.id));

            chip.appendChild(icon);
            chip.appendChild(label);
            chip.appendChild(removeBtn);
            bar.appendChild(chip);
        });
    },

    _addPendingAction({ id, type, label, chipLabel, data, revertFn }) {
        if (!this.state.pendingActions) this.state.pendingActions = [];

        // Dedup: skip if same type+label already exists
        const exists = this.state.pendingActions.some(a => a.type === type && a.label === label);
        if (exists) return;

        const actionId = id || `${type}-${Date.now()}`;
        this.state.pendingActions.push({ id: actionId, type, label, chipLabel: chipLabel || label, data: data || {}, revertFn: revertFn || null });
        this._renderContextBar();
    },

    _removePendingAction(id) {
        if (!this.state.pendingActions) return;

        const index = this.state.pendingActions.findIndex(a => a.id === id);
        if (index === -1) return;

        const action = this.state.pendingActions[index];
        if (typeof action.revertFn === 'function') {
            try {
                action.revertFn();
            } catch (err) {
                console.error('[ChatSystemAction] revertFn error:', err);
            }
        }

        this.state.pendingActions.splice(index, 1);
        this._renderContextBar();

        // Re-render inventory slots after splice so dashed borders are cleared
        if (action.type === 'outfit_change') {
            if (this.state.activeChatGroupId) {
                // Re-render member picker (to update pending indicators if any) then
                // sync slots for whichever character is currently shown in the panel.
                this._renderGroupMemberPicker && this._renderGroupMemberPicker();
                const visibleHash = this.state.activeGroupInventoryCharHash;
                if (visibleHash) {
                    this._syncGroupStatusToUI && this._syncGroupStatusToUI(visibleHash);
                }
            } else {
                this._renderInventorySlots && this._renderInventorySlots();
            }
        }
    },

    _clearPendingActions() {
        this.state.pendingActions = [];
        this._renderContextBar();
    },

    _flushPendingActionsToMessages() {
        if (!this.state.pendingActions || this.state.pendingActions.length === 0) return [];

        // Do NOT apply inventory/action_state changes here.
        // Gifts and duo_actions are only applied to character_states AFTER the assistant
        // successfully replies (during stream processing in _parseAndCleanContent /
        // _parseAndApplyGroupUpdate). This ensures delete-restore works correctly:
        // status_after on the assistant msg already includes the gift, so restoring to
        // the previous assistant's status_after correctly removes it.

        // outfit_change: already applied visually to cs at drag time — just return display item.
        // After flush, clear pending dashed borders by removing the pending actions from state
        // (caller is responsible for calling _clearPendingActions after this).

        // Return action items — caller stores them in snapshot[3] of the user message for display.
        return this.state.pendingActions.map(a => ({ type: a.type, label: a.label }));
    },

    // Returns character_states[charHash] for Single mode.
    _getSingleCharState() {
        const session = this.state.activeChatSession;
        const charHash = this.state.activeChatCharacterHash;
        if (!session || !charHash) return null;
        return window.HistoryStateEngine.ensureCharState(session, charHash);
    },

    _getActiveUserName() {
        const userObj = this.state.personas.users[this.state.activeUserPersonaId];
        return userObj?.name || 'User';
    },

    _getActiveCharacterName() {
        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash];
        return charObj?.name || 'Character';
    },

    async _executeNewChat() {
        const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
            ? (msg) => window.Yuuka.ui.confirm(msg)
            : (msg) => Promise.resolve(window.confirm(msg));

        const ok = await confirmFn('Bạn có chắc chắn muốn bắt đầu cuộc trò chuyện mới? Toàn bộ tin nhắn và trạng thái sẽ bị xoá.');
        if (!ok) {
            this._closeSystemActionMenu();
            return;
        }

        // Route to group handler if in group mode
        if (this.state.activeChatGroupId) {
            return this._executeGroupNewChat();
        }

        const session = this.state.activeChatSession;
        if (!session) return;

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash];

        session.messages = [];
        // Reset state in character_states[charHash] — source of truth
        const cs = window.HistoryStateEngine.ensureCharState(session, charHash);
        cs.emotion_state = {};
        cs.action_state  = {};
        cs.stamina       = this.actionEngine?.getMaxStamina?.() || 100;
        cs.outfits       = [...(charObj?.default_outfits || [])];
        cs.inventory     = [];
        cs.location      = '';
        // memory_summary, memory_name, last_summarized_index and scenes are preserved

        this._closeSystemActionMenu();
        this._syncStatusToUI();
        this._saveCurrentSession();
        this.renderMessages();
    },

    async _executeRandomEvent() {
        this._closeSystemActionMenu();

        const session = this.state.activeChatSession;
        if (!session) return;

        // Push empty narrator message at the end
        session.messages.push({
            role: 'system',
            type: 'narrator',
            narrator_type: 'random_event',
            snapshots: [''],
            activeIndex: 0
        });

        const targetIndex = session.messages.length - 1;
        this._saveCurrentSession();
        this.renderMessages();

        // Scroll to bottom
        const container = this.container.querySelector('#chat-messages-container');
        if (container) container.scrollTop = container.scrollHeight;

        await this._executeRandomEventAtIndex(targetIndex);
    },

    // --- Group Chat System Actions ---

    /**
     * Gift action for group chat.
     * If selection is 'all', applies to every member.
     * Otherwise applies to the currently selected character on the character bar.
     */
    _executeGroupGiftAction(item) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const selection = this.state.groupCharacterBarSelection;
        const memberHashes = groupSession.member_hashes || [];
        const chars = (this.state.personas && this.state.personas.characters) || {};
        const userName = this._getActiveUserName();

        const targets = selection === 'all' ? memberHashes : [selection].filter(h => memberHashes.includes(h));
        if (targets.length === 0) return;

        targets.forEach(charHash => {
            const charState = groupSession.character_states?.[charHash];
            if (!charState) return;

            const charName = chars[charHash]?.name || 'Character';
            const label = this._buildActionLabel('gift', { giver: userName, receiver: charName, item: item.name || item.label });

            // Apply inventory changes only when flushed (on Send), not immediately.
            this._addPendingAction({
                type: 'gift',
                label,
                chipLabel: item.name || item.label,
                data: { item: item.id, name: item.name || item.label, tags: item.tags, itemType: item.type, character: charName, charHash },
                revertFn: null
            });
        });

        this._closeSystemActionMenu();
        this._saveGroupSession && this._saveGroupSession();
    },

    /**
     * Duo/action for group chat.
     * If selection is 'all', applies to every member.
     * Otherwise applies to the currently selected character.
     */
    _executeGroupDuoAction(actionType) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const selection = this.state.groupCharacterBarSelection;
        const memberHashes = groupSession.member_hashes || [];
        const chars = (this.state.personas && this.state.personas.characters) || {};
        const userName = this._getActiveUserName();

        const targets = selection === 'all' ? memberHashes : [selection].filter(h => memberHashes.includes(h));
        if (targets.length === 0) return;

        targets.forEach(charHash => {
            const charState = groupSession.character_states?.[charHash];
            if (!charState) return;

            const charName = chars[charHash]?.name || 'Character';
            const displayName = actionType.replace(/_/g, ' ');
            const label = this._buildActionLabel('action', { actor: userName, target: charName, actionName: displayName });

            // Apply action_state only when flushed (on Send), not immediately.
            this._addPendingAction({
                type: 'duo_action',
                label,
                chipLabel: displayName,
                data: { actionType, character: charName, charHash },
                revertFn: null
            });
        });

        this._closeSystemActionMenu();
        this._saveGroupSession && this._saveGroupSession();
    },

    /**
     * New Chat for group chat — resets messages and all character states.
     */
    _executeGroupNewChat() {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const chars = (this.state.personas && this.state.personas.characters) || {};

        groupSession.messages = [];
        groupSession.memory_summary = '';
        groupSession.last_summarized_index = 0;
        groupSession.location = '';

        // Reset per-character states via engine
        if (!groupSession.character_states) groupSession.character_states = {};
        (groupSession.member_hashes || []).forEach(charHash => {
            const persona = chars[charHash] || {};
            // Force re-init by clearing the entry first
            delete groupSession.character_states[charHash];
            window.HistoryStateEngine.ensureGroupCharState(groupSession, charHash, persona.default_outfits || []);
            const cs = groupSession.character_states[charHash];
            cs.emotion_state = {};
            cs.action_state  = {};
            cs.stamina       = this.actionEngine?.getMaxStamina?.() || 100;
        });

        this._closeSystemActionMenu();
        this._syncStatusToUI();
        this._saveGroupSession && this._saveGroupSession();
        this.renderMessages();
    },

    /**
     * Trigger LLM responses after a group system action.
     * Fires default-mode stream for each target character.
     */
    _triggerGroupResponseAfterAction(actionLabel, targetHashes) {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession || !targetHashes || targetHashes.length === 0) return;

        // Stream responses for each target character sequentially
        const streamNext = (index) => {
            if (index >= targetHashes.length) return;
            const charHash = targetHashes[index];

            groupSession.messages.push({
                role: 'assistant',
                snapshots: [''],
                activeIndex: 0,
                character_hash: charHash,
                response_mode: 'default'
            });

            const targetIndex = groupSession.messages.length - 1;
            this.renderMessages();

            this._streamGroupDefaultMode(charHash, null, targetIndex).then(() => {
                streamNext(index + 1);
            });
        };

        streamNext(0);
    }
});
