Object.assign(window.ChatComponent.prototype, {

    /**
     * Group-aware save: routes to _saveGroupSession when in group mode,
     * otherwise falls back to the standard character session save.
     * Overrides the base _saveCurrentSession defined in chatStatusUI.js.
     */
    _saveCurrentSession() {
        if (!this.state.activeChatSession) return;
        if (this.state.activeChatGroupId) {
            // Group mode — delegate to group save
            this._saveGroupSession && this._saveGroupSession();
        } else {
            const charHash = this.state.activeChatCharacterHash;
            const sessionId = this.state.activeChatSession.id;
            this.api['chat'].post(`/sessions/${charHash}/${sessionId}`, this.state.activeChatSession);
        }
    },

    /**
     * Returns { avatar, name } for an assistant message.
     * In group mode, resolves from msg.character_hash.
     * In normal mode, resolves from activeChatCharacterHash.
     */
    _getAssistantPersonaForMessage(msg) {
        const chars = (this.state.personas && this.state.personas.characters) || {};
        if (this.state.activeChatGroupId && msg && msg.character_hash) {
            const p = chars[msg.character_hash] || {};
            return { avatar: p.avatar || `/image/${msg.character_hash}`, name: p.name || '' };
        }
        const charHash = this.state.activeChatCharacterHash;
        const p = chars[charHash] || {};
        return { avatar: p.avatar || `/image/${charHash}`, name: p.name || '' };
    },

    async openGroupChat(groupId) {
        // Remove any existing character bar from a previous group chat
        this._destroyCharacterBar();

        // Fetch group session
        let groupSession;
        try {
            const res = await this.api['chat'].get(`/group_sessions/${groupId}`);
            groupSession = res.session || res.data || res;
            if (!groupSession || !groupSession.id) throw new Error('Not found');
        } catch (e) {
            alert('Không tìm thấy group chat. Đang chuyển về danh sách...');
            this.switchTab('chat_list');
            return;
        }

        // Set group state, clear character-specific state
        this.state.activeChatGroupId = groupId;
        this.state.activeChatGroupSession = groupSession;
        this.state.activeGroupInventoryCharHash = null; // reset stale selection from previous session
        this.state.activeChatCharacterHash = null;
        this.state.activeChatSession = groupSession;

        // Clear any pending actions from previous session
        this.state.pendingActions = [];

        // Update chat header
        const nameEl = this.container.querySelector('#chat-header-name');
        if (nameEl) {
            nameEl.textContent = groupSession.name || 'Group Chat';
            nameEl.title = groupSession.name || 'Group Chat';
        }
        const avatarEl = this.container.querySelector('#chat-header-avatar');
        if (avatarEl) {
            if (groupSession.avatar) {
                avatarEl.src = groupSession.avatar;
            } else {
                // Use first member's avatar as fallback, or empty
                const firstHash = groupSession.member_hashes && groupSession.member_hashes[0];
                const firstChar = firstHash && this.state.personas && this.state.personas.characters && this.state.personas.characters[firstHash];
                avatarEl.src = (firstChar && firstChar.avatar) ? firstChar.avatar : (firstHash ? `/image/${firstHash}` : '');
            }
        }

        // Hide the "edit character" button (not applicable for group)
        const editCharBtn = this.container.querySelector('#btn-edit-active-character');
        if (editCharBtn) editCharBtn.style.display = 'none';

        // Show/add "Edit Group chat" button in header
        let editGroupBtn = this.container.querySelector('#btn-edit-group-chat');
        if (!editGroupBtn) {
            editGroupBtn = document.createElement('button');
            editGroupBtn.id = 'btn-edit-group-chat';
            editGroupBtn.className = 'icon-btn';
            editGroupBtn.title = 'Edit Group chat';
            editGroupBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
            // Insert after btn-chat-inventory (right of Character Status icon)
            const inventoryBtn = this.container.querySelector('#btn-chat-inventory');
            if (inventoryBtn && inventoryBtn.parentNode) {
                inventoryBtn.parentNode.insertBefore(editGroupBtn, inventoryBtn.nextSibling);
            }
        }
        editGroupBtn.style.display = '';
        editGroupBtn.onclick = () => {
            this.openGroupEdit && this.openGroupEdit(groupId);
        };

        // Init inventory resize (same as openChat)
        this._initInventoryResize && this._initInventoryResize();

        // Bind inventory button for group mode
        const inventoryBtn = this.container.querySelector('#btn-chat-inventory');
        if (inventoryBtn) {
            inventoryBtn.onclick = () => {
                this._openGroupInventoryPanel && this._openGroupInventoryPanel();
            };
        }

        // Bind close modal button
        const closeModalBtn = this.container.querySelector('.close-modal-btn[data-modal="modal-inventory"]');
        if (closeModalBtn) {
            closeModalBtn.onclick = () => {
                const panel = this.container.querySelector('#modal-inventory');
                if (panel) panel.classList.add('hidden');
                const chatView = this.container.querySelector('#view-chat');
                if (chatView) chatView.classList.remove('inventory-open');
            };
        }

        // Bind inventory tab buttons (Memory, Scenes, Album) — same logic as openChat
        const inventoryPanel = this.container.querySelector('#modal-inventory');
        inventoryPanel?.querySelectorAll('.status-tab-btn').forEach(btn => {
            // Clone to remove any previous listeners
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
        });
        inventoryPanel?.querySelectorAll('.status-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                inventoryPanel.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                const statusTab = this.container.querySelector('#status-tab-status');
                const memoryTab = this.container.querySelector('#status-tab-memory');
                const scenesTab = this.container.querySelector('#status-tab-scenes');
                const albumTab = this.container.querySelector('#status-tab-album');
                if (statusTab) statusTab.style.display = tab === 'status' ? '' : 'none';
                if (memoryTab) memoryTab.style.display = tab === 'memory' ? '' : 'none';
                if (scenesTab) scenesTab.style.display = tab === 'scenes' ? '' : 'none';
                if (albumTab) albumTab.style.display = tab === 'album' ? '' : 'none';
                if (tab === 'memory' && this._autoScaleMemory) {
                    requestAnimationFrame(() => this._autoScaleMemory());
                }
                if (tab === 'scenes') {
                    this._renderActiveScenesList && this._renderActiveScenesList();
                }
                if (tab === 'album') {
                    this._renderInventoryAlbumTab && this._renderInventoryAlbumTab();
                }
            });
        });

        // Bind memory tab events for group mode
        const memNameInput = this.container.querySelector('#memory-name-input');
        if (memNameInput) {
            const newInput = memNameInput.cloneNode(true);
            memNameInput.parentNode.replaceChild(newInput, memNameInput);
            newInput.addEventListener('input', () => {
                const s = this.state.activeChatGroupSession;
                if (!s) return;
                s.memory_name = newInput.value;
                clearTimeout(this._memoryNameSaveTimeout);
                this._memoryNameSaveTimeout = setTimeout(() => this._saveGroupSession(), 800);
            });
        }

        const memTextarea = this.container.querySelector('#memory-summary-textarea');
        if (memTextarea) {
            const newTextarea = memTextarea.cloneNode(true);
            memTextarea.parentNode.replaceChild(newTextarea, memTextarea);
            this._autoScaleMemory = () => {
                newTextarea.style.height = 'auto';
                newTextarea.style.height = newTextarea.scrollHeight + 'px';
            };
            newTextarea.addEventListener('input', () => {
                this._autoScaleMemory();
                const s = this.state.activeChatGroupSession;
                if (!s) return;
                s.memory_summary = newTextarea.value;
                clearTimeout(this._memorySaveTimeout);
                this._memorySaveTimeout = setTimeout(() => this._saveGroupSession(), 800);
            });
        }

        const summarizeBtn = this.container.querySelector('#btn-memory-summarize');
        if (summarizeBtn) {
            summarizeBtn.onclick = () => {
                if (this._memorySummarizeAbort) {
                    this._memorySummarizeAbort.abort();
                    this._memorySummarizeAbort = null;
                    summarizeBtn.textContent = 'Summarize';
                    const ta = this.container.querySelector('#memory-summary-textarea');
                    if (ta) ta.readOnly = false;
                } else {
                    this._runMemorySummarize && this._runMemorySummarize();
                }
            };
        }

        const saveSceneBtn = this.container.querySelector('#btn-memory-save-scene');
        if (saveSceneBtn) {
            saveSceneBtn.onclick = () => this._saveMemoryAsScene && this._saveMemoryAsScene();
        }

        const clearMemBtn = this.container.querySelector('#btn-memory-clear');
        if (clearMemBtn) {
            clearMemBtn.onclick = () => {
                const s = this.state.activeChatGroupSession;
                if (!s) return;
                s.memory_summary = '';
                s.memory_name = '';
                s.last_summarized_index = 0;
                const ta = this.container.querySelector('#memory-summary-textarea');
                const ni = this.container.querySelector('#memory-name-input');
                if (ta) { ta.value = ''; ta.style.height = 'auto'; }
                if (ni) ni.value = '';
                this._saveGroupSession && this._saveGroupSession();
            };
        }

        // Bind scene tab events for group mode
        const btnAddScene = this.container.querySelector('#btn-add-scene-to-chat');
        if (btnAddScene) {
            btnAddScene.onclick = () => this._showScenePickerForChat && this._showScenePickerForChat();
        }

        // Override _handleDockSend to route to group message handler
        // Wrap instead of replace so command system (@gift, etc.) still intercepts first
        if (!this._originalHandleDockSend) {
            this._originalHandleDockSend = this._handleDockSend;
        }
        this._handleDockSend = async (textarea) => {
            // Let command system intercept first (e.g. @gift inline form)
            if (this._cmdState && this._cmdState.inlineFormEl && typeof this._cmdState.submitForm === 'function') {
                const intercepted = await this._cmdState.submitForm();
                if (intercepted) return;
            }
            if (this.state.isStreaming) return;

            const hasPending = (this.state.pendingActions?.length ?? 0) > 0;
            const content = textarea.value.trim();

            if (!content && !hasPending) {
                const selection = this.state.groupCharacterBarSelection || null;
                if (selection && this._triggerGroupContinue) {
                    this._triggerGroupContinue(selection);
                }
                return;
            }

            // Clear autosave
            if (this.state.activeChatGroupId) {
                localStorage.removeItem(`chat-autosave-group-${this.state.activeChatGroupId}`);
            }

            textarea.value = '';
            textarea.style.height = '24px';
            const addBtn = textarea.parentElement?.querySelector('.nav-btn--system-action');
            if (addBtn) addBtn.classList.remove('is-hidden');
            this._sendGroupMessage && this._sendGroupMessage(content);
        };

        // Initialize character_states if absent (one entry per member)
        const chars = (this.state.personas && this.state.personas.characters) || {};
        (groupSession.member_hashes || []).forEach(memberHash => {
            const persona = chars[memberHash] || {};
            window.HistoryStateEngine.ensureGroupCharState(groupSession, memberHash, persona.default_outfits || []);
        });

        // Hide mood indicator in group mode
        const moodEl = this.container.querySelector('#chat-header-mood');
        if (moodEl) moodEl.style.display = 'none';

        // Switch to chat tab and render messages
        this.switchTab('chat');
        this.state.activeChatSession = groupSession;
        this.state.activeChatSession.scenes = this.state.activeChatSession.scenes || [];
        this._lastRenderedMessageCount = (groupSession.messages && groupSession.messages.length) || 0;
        this.renderMessages && this.renderMessages();

        // Render character bar AFTER dock is open (switchTab triggers _openChatDock which clears dock)
        requestAnimationFrame(() => this._renderCharacterBar(groupSession));

        // Bind send button to group message handler
        const sendBtn = this.container.querySelector('#btn-send-message');
        if (sendBtn) {
            sendBtn.onclick = () => {
                const inputEl = this.container.querySelector('#chat-input');
                const content = inputEl ? inputEl.value.trim() : '';
                if (!content) return;
                if (inputEl) inputEl.value = '';
                this._sendGroupMessage && this._sendGroupMessage(content);
            };
        }

        // Also bind Enter key on input for group mode
        const chatInput = this.container.querySelector('#chat-input');
        if (chatInput) {
            chatInput._groupKeyHandler = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const content = chatInput.value.trim();
                    if (!content) return;
                    chatInput.value = '';
                    this._sendGroupMessage && this._sendGroupMessage(content);
                }
            };
            chatInput.removeEventListener('keydown', chatInput._groupKeyHandler);
            chatInput.addEventListener('keydown', chatInput._groupKeyHandler);
        }

        // Scroll to bottom
        setTimeout(() => {
            const container = this.container.querySelector('#chat-messages-container');
            if (container) container.scrollTop = container.scrollHeight;
        }, 50);
    },

    _renderCharacterBar(groupSession) {
        // Remove any existing bar first
        this._removeCharacterBar();

        const memberHashes = (groupSession && groupSession.member_hashes) || [];
        if (memberHashes.length === 0) return;

        const bar = document.createElement('div');
        bar.id = 'character-bar';
        bar.style.cssText = [
            'display:flex',
            'flex-direction:row',
            'align-items:center',
            'justify-content:center',
            'gap:8px',
            'padding:4px 12px 6px',
            'background:transparent',
            'border:none',
            'width:100%',
            'box-sizing:border-box',
        ].join(';');

        const chars = (this.state.personas && this.state.personas.characters) || {};

        // Avatar buttons for each member
        memberHashes.forEach(charHash => {
            const persona = chars[charHash];
            const btn = document.createElement('button');
            btn.className = 'char-bar-btn';
            btn.dataset.charHash = charHash;
            btn.title = (persona && persona.name) ? persona.name : charHash;
            btn.style.cssText = [
                'width:40px',
                'height:40px',
                'border-radius:50%',
                'border:2px solid transparent',
                'padding:0',
                'cursor:pointer',
                'background:var(--bg-secondary,#2a2a2a)',
                'overflow:hidden',
                'transition:opacity 0.2s,box-shadow 0.2s,border-color 0.2s',
                'flex-shrink:0',
            ].join(';');

            const avatarSrc = (persona && persona.avatar) ? persona.avatar : `/image/${charHash}`;
            btn.innerHTML = `<img src="${avatarSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${this.escapeHTML((persona && persona.name) ? persona.name : '')}" onerror="this.outerHTML='<span class=\\'material-symbols-outlined\\' style=\\'font-size:22px;line-height:40px;color:var(--chat-text-secondary,#aaa);\\'>person</span>'" />`;

            btn.addEventListener('click', () => this._selectCharacterBarItem(charHash));
            this._attachCharBarLongPress(btn, charHash);
            bar.appendChild(btn);
        });

        // Random (dice) button
        const randomBtn = document.createElement('button');
        randomBtn.className = 'char-bar-btn char-bar-special';
        randomBtn.dataset.charHash = 'random';
        randomBtn.title = 'Random character';
        randomBtn.style.cssText = [
            'width:40px',
            'height:40px',
            'border-radius:50%',
            'border:2px solid transparent',
            'padding:0',
            'cursor:pointer',
            'background:var(--bg-secondary,#2a2a2a)',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'transition:opacity 0.2s,box-shadow 0.2s,border-color 0.2s',
            'flex-shrink:0',
        ].join(';');
        randomBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:22px;color:var(--chat-text-secondary,#aaa);">casino</span>`;
        randomBtn.addEventListener('click', () => this._selectCharacterBarItem('random'));
        this._attachCharBarLongPress(randomBtn, 'random');
        bar.appendChild(randomBtn);

        // Inject bar into navibar dock, above the composer
        const dockContainer = document.querySelector('#navibar-dock');
        if (dockContainer) {
            dockContainer.prepend(bar);
        }

        // Extra padding so the last message's msg-actions aren't hidden behind dock + character-bar
        const messagesContainer = this.container.querySelector('#chat-messages-container');
        if (messagesContainer) {
            messagesContainer.style.paddingBottom = 'calc(150px + env(safe-area-inset-bottom, 0px))';
        }

        // Default: select first character
        if (memberHashes.length > 0) {
            this._selectCharacterBarItem(memberHashes[0]);
        }
    },

    _selectCharacterBarItem(selection) {
        this.state.groupCharacterBarSelection = selection;

        const bar = this.container.querySelector('#character-bar') || document.querySelector('#character-bar');
        if (!bar) return;

        const buttons = bar.querySelectorAll('.char-bar-btn');
        buttons.forEach(btn => {
            const isActive = btn.dataset.charHash === String(selection);
            if (isActive) {
                btn.style.opacity = '1';
                btn.style.boxShadow = '0 0 0 2px var(--accent,#7c6af7), 0 0 8px 2px rgba(124,106,247,0.5)';
                btn.style.borderColor = 'var(--accent,#7c6af7)';
            } else {
                btn.style.opacity = '0.45';
                btn.style.boxShadow = 'none';
                btn.style.borderColor = 'transparent';
            }
        });
    },

    _destroyCharacterBar() {
        const bar = this.container && this.container.querySelector('#character-bar')
            || document.querySelector('#character-bar');
        if (bar) bar.remove();
        const messagesContainer = this.container && this.container.querySelector('#chat-messages-container');
        if (messagesContainer) messagesContainer.style.paddingBottom = '';
    },

    // Alias for backward compatibility
    _removeCharacterBar() {
        this._destroyCharacterBar();
    },

    /**
     * Attach long-press (500ms) handler to a character bar button.
     * Long press triggers group continue (generation without a user message).
     */
    _attachCharBarLongPress(btn, selection) {
        const LONG_PRESS_MS = 500;
        let timer = null;
        let didLongPress = false;

        const start = (e) => {
            didLongPress = false;
            timer = setTimeout(() => {
                didLongPress = true;
                // Visual feedback: brief scale pulse
                btn.style.transform = 'scale(0.92)';
                setTimeout(() => { btn.style.transform = ''; }, 150);
                this._selectCharacterBarItem(selection);
                this._triggerGroupContinue && this._triggerGroupContinue(selection);
            }, LONG_PRESS_MS);
        };

        const cancel = () => {
            if (timer) { clearTimeout(timer); timer = null; }
        };

        // Prevent click from firing after a long press
        btn.addEventListener('mousedown', start);
        btn.addEventListener('touchstart', start, { passive: true });
        btn.addEventListener('mouseup', cancel);
        btn.addEventListener('mouseleave', cancel);
        btn.addEventListener('touchend', cancel);
        btn.addEventListener('touchcancel', cancel);
        btn.addEventListener('click', (e) => {
            if (didLongPress) { e.stopImmediatePropagation(); didLongPress = false; }
        }, true);
    },

    _isGroupEmpty() {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession || !groupSession.messages) return true;
        return groupSession.messages.length === 0;
    },

    _generateGroupFirstMessage() {
        if (this.state.isStreaming) return;
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;

        const memberHashes = groupSession.member_hashes || [];
        if (memberHashes.length === 0) return;

        // Stream each member sequentially in default mode (same as _triggerGroupResponseAfterAction)
        const streamNext = (index) => {
            if (index >= memberHashes.length) return;
            const charHash = memberHashes[index];

            groupSession.messages = groupSession.messages || [];
            groupSession.messages.push({
                role: 'assistant',
                snapshots: [''],
                activeIndex: 0,
                character_hash: charHash,
                response_mode: 'default',
            });

            const targetIndex = groupSession.messages.length - 1;
            this.renderMessages();

            this._streamGroupDefaultMode(charHash, null, targetIndex, null, true, false, true).then(() => {
                streamNext(index + 1);
            });
        };

        streamNext(0);
    },
});
