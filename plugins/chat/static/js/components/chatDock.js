Object.assign(window.ChatComponent.prototype, {
    // --- Navibar Dock Integration ---

    _openChatDock() {
        const navibar = window.Yuuka?.services?.navibar;
        if (!navibar || typeof navibar.openDock !== 'function') {
            console.warn("[Plugin:Chat] Navibar service not available, cannot open chat dock.");
            return;
        }

        this._dockHandle = navibar.openDock('chat', {
            classes: ['navibar-dock--composer'],
            render: (dockContainer) => {
                const composer = document.createElement('div');
                composer.className = 'navibar-composer';

                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'nav-btn nav-btn--minimal nav-btn--system-action';
                addBtn.title = 'System Action';
                addBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._openSystemActionMenu(addBtn);
                });

                const textarea = document.createElement('textarea');
                textarea.className = 'navibar-composer__input';
                textarea.placeholder = 'Type a message...';
                textarea.rows = 1;
                textarea.id = 'chat-dock-input';

                const sendBtn = document.createElement('button');
                sendBtn.type = 'button';
                sendBtn.className = 'nav-btn nav-btn--minimal nav-btn--submit';
                sendBtn.title = 'Send';
                sendBtn.innerHTML = '<span class="material-symbols-outlined">send</span>';

                const getSessionAutoSaveKey = () => {
                    if (this.state.activeChatGroupId) return `chat-autosave-group-${this.state.activeChatGroupId}`;
                    if (this.state.activeChatCharacterHash) return `chat-autosave-char-${this.state.activeChatCharacterHash}`;
                    return null;
                };

                const updateHeight = () => {
                    if (textarea.offsetWidth === 0) return;
                    textarea.style.height = 'auto';
                    textarea.style.height = Math.min(textarea.scrollHeight, 190) + 'px';
                    if (textarea.value === '') {
                        textarea.style.height = '24px';
                        addBtn.classList.remove('is-hidden');
                    } else {
                        addBtn.classList.add('is-hidden');
                    }
                };

                // Restore autosave
                const saveKey = getSessionAutoSaveKey();
                if (saveKey) {
                    const saved = localStorage.getItem(saveKey);
                    if (saved) {
                        textarea.value = saved;
                    }
                }

                // Auto-expand textarea + toggle add button + autosave
                textarea.addEventListener('input', () => {
                    updateHeight();
                    const key = getSessionAutoSaveKey();
                    if (key) {
                        localStorage.setItem(key, textarea.value);
                    }
                });

                // Use ResizeObserver to handle initial dock expansion and mobile layout shifts
                // This prevents the height from being miscalculated when width is 0 or animating
                let lastWidth = 0;
                const resizeObserver = new ResizeObserver((entries) => {
                    const width = entries[0]?.contentRect?.width || 0;
                    if (width !== lastWidth) {
                        lastWidth = width;
                        updateHeight();
                    }
                });
                resizeObserver.observe(textarea);

                // Enter to send
                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        const isMobile = window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
                        if (isMobile) {
                            return; // Allow default new line behavior on mobile
                        }
                        e.preventDefault();
                        this._handleDockSend(textarea);
                    }
                });

                sendBtn.addEventListener('click', () => {
                    if (this.state.isStreaming) {
                        if (this.state.currentAbortController) {
                            this.state.currentAbortController.abort();
                            this.state.currentAbortController = null;
                        }
                        this.state.isStreaming = false;
                        this._setStreamingUI(false);
                        return;
                    }
                    this._handleDockSend(textarea);
                });

                const contextBar = document.createElement('div');
                contextBar.id = 'chat-context-bar';
                contextBar.className = 'chat-context-bar';

                composer.appendChild(addBtn);
                composer.appendChild(contextBar);
                composer.appendChild(textarea);
                composer.appendChild(sendBtn);

                if (this._initCommandSystem) {
                    this._initCommandSystem(composer, textarea);
                }

                return {
                    element: composer,
                    cleanup: () => {
                        resizeObserver.disconnect();
                        this._dockHandle = null;
                    }
                };
            },
            focusSelector: '#chat-dock-input',
        });


        // Dock content is visible via is-dock-active class.
        // Do NOT call setDockPeekOpen(true) — that would show the main bar.
    },

    _closeChatDock() {
        // Clear pending actions when dock is closed
        this.state.pendingActions = [];
        if (this._dockHandle) {
            this._dockHandle.close();
            this._dockHandle = null;
        }
    },

    _handleDockSend(textarea) {
        if (this.state.isStreaming) return;

        const hasPending = (this.state.pendingActions?.length ?? 0) > 0;
        const content = textarea.value.trim();

        if (!content && !hasPending) {
            // If in Group chat but somehow not intercepted by chatGroupView override
            if (this.state.activeChatGroupId && this._triggerGroupContinue) {
                const selection = this.state.groupCharacterBarSelection || null;
                if (selection) this._triggerGroupContinue(selection);
            } else if (this._triggerContinue) {
                this._triggerContinue();
            }
            return;
        }

        // Clear autosave
        const saveKey = this.state.activeChatGroupId ? `chat-autosave-group-${this.state.activeChatGroupId}` : (this.state.activeChatCharacterHash ? `chat-autosave-char-${this.state.activeChatCharacterHash}` : null);
        if (saveKey) {
            localStorage.removeItem(saveKey);
        }

        textarea.value = '';
        textarea.style.height = '24px';

        // Show "+" button again after sending
        const addBtn = textarea.parentElement?.querySelector('.nav-btn--system-action');
        if (addBtn) addBtn.classList.remove('is-hidden');

        this._sendMessage(content);
    }

});
