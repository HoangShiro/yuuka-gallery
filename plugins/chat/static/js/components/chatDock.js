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

                // Auto-expand textarea + toggle add button
                textarea.addEventListener('input', function () {
                    this.style.height = 'auto';
                    this.style.height = Math.min(this.scrollHeight, 190) + 'px';
                    if (this.value === '') {
                        this.style.height = '24px';
                        addBtn.classList.remove('is-hidden');
                    } else {
                        addBtn.classList.add('is-hidden');
                    }
                });

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

        textarea.value = '';
        textarea.style.height = '24px';

        // Show "+" button again after sending
        const addBtn = textarea.parentElement?.querySelector('.nav-btn--system-action');
        if (addBtn) addBtn.classList.remove('is-hidden');

        this._sendMessage(content);
    }
});
