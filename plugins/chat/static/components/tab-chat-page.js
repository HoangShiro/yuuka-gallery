// Restored original file structure after accidental corruption.
(function registerChatPageTab(namespace) {
            const controllersNs = window.Yuuka?.plugins?.chat?.controllers || {};
            const ChatSnapshotManager = controllersNs.ChatSnapshotManager;
            const ChatMessageActions = controllersNs.ChatMessageActions;

            function createSnapshotManager(store) {
                if (typeof ChatSnapshotManager === "function") {
                    try { return new ChatSnapshotManager(store); } catch (err) { console.warn("[ChatPage] Failed to construct ChatSnapshotManager", err); }
                }
                console.warn("[ChatPage] ChatSnapshotManager unavailable; using no-op fallback.");
                return { reset() {}, syncFromMessages() {}, getState() { return null; }, isValidIndex() { return false; }, getSelectedSnapshotIndexFromMessage() { return null; }, isPending() { return false; }, setPending() {} };
            }
            function createMessageActions(store, snapshotManager, deps) {
                if (typeof ChatMessageActions === "function") {
                    try { return new ChatMessageActions(store, snapshotManager, deps); } catch (err) { console.warn("[ChatPage] Failed to construct ChatMessageActions", err); }
                }
                console.warn("[ChatPage] ChatMessageActions unavailable; using minimal fallback.");
                return { async handleSnapshotPrev() {}, async handleSnapshotNext() {}, async handleDelete() {} };
            }

    class ChatPageTab {
                constructor(store) {
                    this.store = store;
                    this._unsubscribers = [];
                    this.maxVisibleMessages = 100;
                    this._snapshotManager = createSnapshotManager(this.store);
                    this._actions = createMessageActions(this.store, this._snapshotManager, {
                        notifyError: (msg) => this._notifyError(msg),
                        confirmAction: (opts) => this._confirmAction(opts),
                        reRender: () => this._renderMessages(this.store.state.activeHistory),
                        getActiveHistory: () => this.store.state.activeHistory,
                        getCurrentCharacterId: () => this.currentCharacterId,
                    });
                    this._editingMessageId = null;
                    this._editingDraftText = "";
                    this._editingBubbleHeight = null;
                    this._editingBubbleWidth = null;
                    this._confirmModal = null;
                    this._confirmModalElements = null;
                    this._lastRenderedMessageSignature = null;
                    this._lastRenderedMessageCount = 0;
                    this.container = null;
                    this.headerElement = null;
                    this.contentElement = null;
                    this.messagesElement = null;
                    this.messagesContainer = null;
                    this.navibar = null;
                    this._navDockHandle = null;
                    this._navComposerElements = null;
                    this._composerListeners = [];
                    this._navOwnerId = "chat-composer";
                    this._navServiceWaitTimer = null;
                    this._isTabActive = false;
                    this._isPageActive = false;
                    this._isDockRequested = false;
                    this._dockSuppressed = false;
                }

    mount(container) {
                    this.container = container;
                    this.container.classList.add("chat-tab", "chat-tab--chat-page");
                    this.headerElement = this.container.querySelector('[data-role="tab-header"]');
                    this.contentElement = this.container.querySelector('[data-role="tab-content"]') || this.container;
                    this._ensureUiStylesheet();
                    if (this.headerElement) { this.headerElement.innerHTML = ""; }
                    if (this.contentElement) {
                        this.contentElement.classList.add("chat-tab-panel__content--no-scroll");
                        this.contentElement.innerHTML = `
                            <div class="chat-page" data-role="chat-messages">
                                <div class="chat-empty-state">
                                    <span class="material-symbols-outlined">forum</span>
                                    <p>Select a character in the side tab or create a new one to begin.</p>
                                </div>
                            </div>`;
                        this.messagesElement = this.contentElement.querySelector('[data-role="chat-messages"]');
                        this.messagesContainer = this.messagesElement;
                    } else {
                        this.messagesContainer = null; this.messagesElement = null;
                    }
                    this._unsubscribers.push(this.store.on("active-character", (event) => this._renderActiveCharacter(event.detail)));
                    // Re-render and re-apply UI variables when settings change
                    this._unsubscribers.push(this.store.on("settings", (event) => { try { this._applyUiCssVariables(event.detail?.settings || this.store.state.settings); } catch {} this._renderMessages(this.store.state.activeHistory); }));
                    this._unsubscribers.push(this.store.on("error", (event) => {
                        const detail = event?.detail || {};
                        const message = typeof detail.error === "string" && detail.error.trim() ? detail.error : "Unable to complete the request. Please try again.";
                        if (detail.messageId) { this._snapshotManager.setPending(detail.messageId, false); }
                        this._notifyError(message);
                    }));
                    this._applyUiCssVariables(this.store.state.settings);
                    this._renderActiveCharacter({ characterId: this.store.state.activeCharacterId, definition: this.store.state.activeCharacterDefinition, messages: this.store.state.activeHistory });
                    this._ensureNavibarService();
                }

    destroy() {
                    this._unsubscribers.forEach(unsub => unsub());
                    this._unsubscribers = [];
                    this._isDockRequested = false;
                    this._teardownNavComposer();
                    this._lastRenderedMessageSignature = null;
                    this._lastRenderedMessageCount = 0;
                    if (this._navServiceWaitTimer) { clearTimeout(this._navServiceWaitTimer); this._navServiceWaitTimer = null; }
                    this.navibar = null;
                    if (this.headerElement) { this.headerElement.innerHTML = ""; }
                    if (this.contentElement) { this.contentElement.innerHTML = ""; this.contentElement.classList.remove("chat-tab-panel__content--no-scroll"); }
                    this.headerElement = null; this.contentElement = null; this.messagesContainer = null; this.messagesElement = null;
                }

    _renderActiveCharacter(detail) {
                    const { characterId, messages } = detail || {};
                    const previousCharacterId = this.currentCharacterId;
                    this.currentCharacterId = characterId;
                    this._updateComposerState();
                    if (previousCharacterId !== characterId) { this._editingMessageId = null; this._editingDraftText = ""; this._snapshotManager.reset(); }
                    if (!characterId) {
                        if (this.messagesElement) {
                            this.messagesElement.innerHTML = `
                                <div class="chat-empty-state">
                                    <span class="material-symbols-outlined">forum</span>
                                    <p>Select a character in the side tab or create a new one to begin.</p>
                                </div>`;
                            this.messagesElement.dataset.truncated = "false";
                            this.messagesElement.scrollTop = 0;
                        }
                        this._lastRenderedMessageSignature = null; this._lastRenderedMessageCount = 0; return;
                    }
                    const normalizedMessages = Array.isArray(messages) ? messages : [];
                    this._snapshotManager.syncFromMessages(normalizedMessages);
                    this._renderMessages(normalizedMessages);
                }

    setTabActive(isActive) {
                    this._isTabActive = Boolean(isActive);
                    if (!this._isTabActive) { this._dockSuppressed = false; }
                    this._isDockRequested = !this._dockSuppressed && this._isTabActive && this._isPageActive; this._syncNavComposer();
                }
    setPageActive(isActive) {
                    this._isPageActive = Boolean(isActive);
                    if (!this._isPageActive) { this._dockSuppressed = false; }
                    this._isDockRequested = !this._dockSuppressed && this._isTabActive && this._isPageActive; this._syncNavComposer();
                }

    _ensureNavibarService() {
                    if (this.navibar && typeof this.navibar.openDock === "function") { this._syncNavComposer(); return; }
                    const service = window?.Yuuka?.services?.navibar;
                    if (service && typeof service.openDock === "function") { this.navibar = service; this._syncNavComposer(); return; }
                    if (this._navServiceWaitTimer) { return; }
                    const retry = () => { this._navServiceWaitTimer = null; const nav = window?.Yuuka?.services?.navibar; if (nav && typeof nav.openDock === "function") { this.navibar = nav; this._syncNavComposer(); } else { this._navServiceWaitTimer = setTimeout(retry, 500); } };
                    this._navServiceWaitTimer = setTimeout(retry, 500);
                }
    _syncNavComposer() {
                    const shouldShow = this._isDockRequested && this._isTabActive && this._isPageActive;
                    if (!shouldShow) { this._teardownNavComposer(); return; }
                    if (!this.navibar || typeof this.navibar.openDock !== "function") { this._ensureNavibarService(); return; }
                    if (!this._navDockHandle) { this._mountNavComposer(); return; }
                    this._updateComposerState();
                }
    _mountNavComposer() {
                    if (!this.navibar || this._navDockHandle) { return; }
                    const composer = this._createNavComposerElement(); if (!composer || !composer.root) { return; }
                    const handle = this.navibar.openDock(this._navOwnerId, { element: composer.root, className: "navibar-dock--composer", onClose: () => this._handleDockClosed(), focusSelector: this._shouldKeepComposerFocus ? (this._shouldKeepComposerFocus() ? '[data-role="composer-input"]' : null) : '[data-role="composer-input"]' });
                    if (!handle) { return; }
                    this._navDockHandle = handle; this._navComposerElements = composer; this._registerComposerListeners(composer); this._autoResizeComposerInput(); this._updateComposerState();
                }
    _teardownNavComposer() { if (this._navDockHandle && this.navibar && typeof this.navibar.closeDock === "function") { this.navibar.closeDock(this._navOwnerId); return; } this._handleDockClosed(); }
    _handleDockClosed() { this._clearComposerListeners(); this._navComposerElements = null; this._navDockHandle = null; if (this._isDockRequested) { this._mountNavComposer(); } }
    _createNavComposerElement() { if (typeof document === "undefined") { return null; } const form = document.createElement("form"); form.className = "navibar-composer"; form.innerHTML = `
                        <button type="button" class="nav-btn nav-btn--minimal" data-role="composer-menu" title="Open menu"><span class="material-symbols-outlined">menu</span></button>
                        <textarea class="navibar-composer__input" data-role="composer-input" rows="1" placeholder="Type a message..."></textarea>
                        <button type="submit" class="nav-btn nav-btn--minimal nav-btn--submit" data-action="send-message" title="Send message"><span class="material-symbols-outlined">send</span></button>`; return { root: form, form, input: form.querySelector('[data-role="composer-input"]'), sendButton: form.querySelector('[data-action="send-message"]'), menuButton: form.querySelector('[data-role="composer-menu"]') }; }
    _registerComposerListeners(composer) {
                    if (!composer) { return; }
                    const updateMenuButtonState = (isOpen) => { if (!composer.menuButton) return; const active = Boolean(isOpen); composer.menuButton.classList.toggle("is-active", active); composer.menuButton.setAttribute("aria-pressed", active ? "true" : "false"); };
                    const register = (element, type, handler) => { if (!element || typeof element.addEventListener !== "function") return; element.addEventListener(type, handler); this._composerListeners.push({ element, type, handler }); };
                    if (composer.form) { register(composer.form, "submit", (event) => { event.preventDefault(); this._handleSend(); }); }
                    if (composer.menuButton) {
                        register(composer.menuButton, "click", () => {
                            if (this.navibar && typeof this.navibar.toggleDockPeek === "function") { const next = this.navibar.toggleDockPeek(); updateMenuButtonState(next); return; }
                            this._dockSuppressed = true; this._isDockRequested = false;
                            if (this.navibar && typeof this.navibar.closeDock === "function") { this.navibar.closeDock(this._navOwnerId); } else { this._handleDockClosed(); }
                            updateMenuButtonState(false); this._syncNavComposer();
                        });
                        register(document, "navibar:dockPeekChange", (event) => { const detail = event?.detail || {}; if (detail.ownerId && detail.ownerId !== this._navOwnerId) { return; } updateMenuButtonState(Boolean(detail.isDockActive && detail.isOpen)); });
                    }
                    if (composer.input) {
                        register(composer.input, "keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this._handleSend(); } });
                        register(composer.input, "input", () => this._autoResizeComposerInput());
                    }
                    if (composer.sendButton) { register(composer.sendButton, "click", (event) => { event.preventDefault(); this._handleSend(); }); }
                    const initialPeekState = (this.navibar && typeof this.navibar.isDockPeekOpen === "function") ? this.navibar.isDockPeekOpen() : false; updateMenuButtonState(initialPeekState);
                }
    _clearComposerListeners() { this._composerListeners.forEach(({ element, type, handler }) => { if (element && typeof element.removeEventListener === "function") { element.removeEventListener(type, handler); } }); this._composerListeners = []; }
    _autoResizeComposerInput() { const input = this._navComposerElements?.input; if (!input) return; const minHeight = 24; const maxHeight = 190; const hasText = !!(input.value && input.value.trim().length > 0); if (!hasText) { input.style.height = `${minHeight}px`; return; } input.style.height = "auto"; const next = Math.min(Math.max(minHeight, input.scrollHeight), maxHeight); input.style.height = `${next}px`; }
    _updateComposerState() { const input = this._navComposerElements?.input; const sendButton = this._navComposerElements?.sendButton; const hasCharacter = Boolean(this.currentCharacterId); if (input) { input.disabled = !hasCharacter; input.placeholder = hasCharacter ? "Type a message..." : "Select a character to start chatting."; if (!hasCharacter) { input.value = ""; this._autoResizeComposerInput(); } } if (sendButton) { sendButton.disabled = !hasCharacter; } }
    _shouldKeepComposerFocus() { try { if (typeof window !== "undefined" && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) { return false; } const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''; if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) { return false; } } catch (e) {} return true; }
    _syncMessageSnapshots(messages) { this._snapshotManager.syncFromMessages(messages || []); }
    _isValidSnapshotIndex(value) { return this._snapshotManager.isValidIndex(value); }
    _getSelectedSnapshotIndexFromMessage(message) { return this._snapshotManager.getSelectedSnapshotIndexFromMessage(message); }
    async _persistSnapshotSelection(messageId, snapshotState) { if (!this.currentCharacterId || !snapshotState) { return; } const activeIndex = snapshotState.activeIndex; if (!this._isValidSnapshotIndex(activeIndex)) { return; } const history = this.store.state.activeHistory || []; const message = history.find(item => item.id === messageId); if (!message) { return; } const currentIndex = this._getSelectedSnapshotIndexFromMessage(message); if (currentIndex === activeIndex) { return; } message.metadata = { ...(message.metadata || {}), selected_snapshot_index: activeIndex }; if (typeof this.store.setSelectedSnapshotIndex === "function") { await this.store.setSelectedSnapshotIndex(this.currentCharacterId, messageId, activeIndex); } else { await this.store.updateMessage(this.currentCharacterId, messageId, { metadata: { selected_snapshot_index: activeIndex } }).catch(error => { console.error("[ChatPage] Failed to persist snapshot selection", error); }); } }
    _getSnapshotState(message) { return this._snapshotManager.getState(message); }
    _buildToolbarHtml(message, snapshotState) {
                    const buttons = [];
                    const isAssistant = message.role === "assistant";
                    const isUser = message.role === "user";
                    const messageId = message.id;
                    const pending = this._snapshotManager.isPending(messageId);
                    const isFirstSeed = message?.metadata?.seed === 'first_message' || message?.metadata?.combined_first_messages;
                    const snapshotIndicatorHtml = (isAssistant && snapshotState && Array.isArray(snapshotState.entries) && typeof snapshotState.activeIndex === "number") ? `<span class="chat-message__snapshot-indicator" aria-label="Snapshot ${snapshotState.activeIndex + 1} of ${snapshotState.entries.length}">${snapshotState.activeIndex + 1}/${snapshotState.entries.length}</span>` : "";
                    if (isAssistant && snapshotState) {
                        const hasPrev = snapshotState.activeIndex > 0;
                        const hasNextStored = snapshotState.activeIndex < (snapshotState.entries.length - 1);
                        const prevDisabledAttr = isFirstSeed ? ' disabled aria-disabled="true" data-disabled="true"' : (hasPrev ? ' aria-disabled="false"' : ' disabled aria-disabled="true" data-disabled="true"');
                        const nextDisabledAttr = (isFirstSeed || pending) ? ' disabled aria-disabled="true"' : ' aria-disabled="false"';
                        buttons.push(`<button class="chat-btn chat-btn--ghost" data-action="snapshot-prev" title="Previous response"${prevDisabledAttr}><span class="material-symbols-outlined">keyboard_arrow_left</span></button>`);
                        buttons.push(`<button class="chat-btn chat-btn--ghost" data-action="snapshot-next" title="Next response"${nextDisabledAttr} data-has-next="${isFirstSeed ? "false" : (hasNextStored ? "true" : "false")}" data-loading="${isFirstSeed ? "false" : (pending ? "true" : "false")}"><span class="material-symbols-outlined">keyboard_arrow_right</span></button>`);
                    }
                    if (isAssistant || isUser) {
                        buttons.push(`<button class="chat-btn chat-btn--ghost" data-action="edit" title="Edit message"><span class="material-symbols-outlined">edit</span></button>`);
                        buttons.push(`<button class="chat-btn chat-btn--ghost" data-action="delete" title="Delete message"><span class="material-symbols-outlined">delete</span></button>`);
                    }
                    if (buttons.length === 0 && !snapshotIndicatorHtml) { return ""; }
                    return `<div class="chat-message__toolbar" data-message-id="${messageId}">${buttons.join("")}${snapshotIndicatorHtml}</div>`;
                }
                _getDisplayContent(message) { const snapshotState = this._getSnapshotState(message); if (snapshotState && typeof snapshotState.activeIndex === "number") { const text = snapshotState.entries[snapshotState.activeIndex]; return this._renderMessageContent(message, text); } return this._renderMessageContent(message); }
                _renderMessages(messages) {
                    if (!this.messagesElement || !this.messagesContainer) { return; }
                    const el = this.messagesElement;
                    const list = Array.isArray(messages) ? messages : [];
                    const isEmpty = list.length === 0;
                    this.messagesContainer.classList.toggle("chat-page--empty", isEmpty);
                    if (isEmpty) {
                        el.innerHTML = `<div class="chat-empty-state"><span class="material-symbols-outlined">forum</span><p>No messages yet.</p></div>`;
                        el.dataset.truncated = "false";
                        if (this.messagesContainer) { this.messagesContainer.scrollTop = 0; }
                        this._lastRenderedMessageSignature = null; this._lastRenderedMessageCount = 0; return;
                    }
                    const limit = Number.isFinite(this.maxVisibleMessages) && this.maxVisibleMessages > 0 ? Math.floor(this.maxVisibleMessages) : list.length;
                    const startIndex = Math.max(0, list.length - limit);
                    const visibleMessages = startIndex > 0 ? list.slice(startIndex) : list;
                    // Merge leading first_message assistant messages
                    const combinedVisibleMessages = (() => {
                        if (!visibleMessages.length) return visibleMessages;
                        let idx = 0; const firstGroup = [];
                        while (idx < visibleMessages.length) { const m = visibleMessages[idx]; if (m && m.role === 'assistant' && m.metadata && m.metadata.seed === 'first_message') { firstGroup.push(m); idx++; continue; } break; }
                        if (firstGroup.length <= 1) return visibleMessages;
                        const combinedText = firstGroup.map(m => (m?.content?.text || '').trim()).filter(Boolean).join('\n\n');
                        const base = firstGroup[0];
                        const synthetic = { id: base.id + '-first-group', role: 'assistant', type: 'text', content: { text: combinedText }, metadata: { ...(base.metadata || {}), seed: 'first_message', combined_first_messages: true }, created_at: base.created_at, character_id: base.character_id, session_id: base.session_id };
                        return [synthetic, ...visibleMessages.slice(firstGroup.length)];
                    })();
                    el.dataset.truncated = startIndex > 0 ? "true" : "false";
                    if (this._editingMessageId && !combinedVisibleMessages.some(msg => msg.id === this._editingMessageId)) { this._editingMessageId = null; this._editingDraftText = ""; }
                    this._syncMessageSnapshots(combinedVisibleMessages);
                    const latestMessage = combinedVisibleMessages.length > 0 ? combinedVisibleMessages[combinedVisibleMessages.length - 1] : null;
                    const latestSnapshotState = latestMessage ? this._getSnapshotState(latestMessage) : null;
                    const latestSignature = this._createMessageSignature(latestMessage, latestSnapshotState);
                    el.innerHTML = combinedVisibleMessages.map(message => {
                        const snapshotState = this._getSnapshotState(message);
                        const isEditing = this._editingMessageId === message.id;
                        const contentHtml = isEditing ? this._renderEditingContent(message, snapshotState) : this._getDisplayContent(message);
                        const toolbarHtml = isEditing ? this._buildEditingToolbarHtml(message) : this._buildToolbarHtml(message, snapshotState);
                        const bubbleClasses = ["chat-message__bubble"]; const isGenerating = !isEditing && this._isMessageGenerating(message); if (isEditing) bubbleClasses.push("chat-message__bubble--editing"); if (isGenerating) bubbleClasses.push("chat-message__bubble--loading"); const typingHtml = isGenerating ? this._renderTypingIndicator() : ""; let bubbleStyle = ""; if (isEditing && Number.isFinite(this._editingBubbleWidth)) { bubbleStyle = ` style=\"width: ${this._editingBubbleWidth}px\"`; }
                        return `<article class="chat-message chat-message--${message.role}" data-message-id="${message.id}"><div class="${bubbleClasses.join(" ")}" data-editing="${isEditing ? "true" : "false"}"${bubbleStyle}>${contentHtml}${typingHtml}</div>${toolbarHtml}</article>`;
                    }).join("");
                    el.querySelectorAll(".chat-message").forEach(messageElement => {
                        messageElement.querySelectorAll("[data-action]").forEach(button => { button.addEventListener("click", (event) => this._handleMessageAction(event, messageElement)); });
                        const editInput = messageElement.querySelector("textarea[data-role=\"edit-input\"]");
                        if (editInput) {
                            editInput.addEventListener("input", () => { this._editingDraftText = editInput.value; this._autoResizeEditTextarea(editInput); this._updateEditingBubbleWidth(messageElement, editInput); });
                            editInput.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); this._cancelEditingMessage(); } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); const messageId = messageElement.getAttribute("data-message-id"); const messageRef = this.store.state.activeHistory.find(item => item.id === messageId); if (messageRef) { this._saveEditingMessage(messageRef); } } });
                            this._autoResizeEditTextarea(editInput); this._updateEditingBubbleWidth(messageElement, editInput);
                        }
                        const bubble = messageElement.querySelector('.chat-message__bubble');
                        if (bubble) { bubble.addEventListener('click', () => { try { const isNarrow = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches; if (!isNarrow) return; const sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null; if (sel && sel.toString && sel.toString().length > 0) return; this.messagesElement?.querySelectorAll('.chat-message.is-toolbar-open').forEach(el => { if (el !== messageElement) el.classList.remove('is-toolbar-open'); }); messageElement.classList.toggle('is-toolbar-open'); } catch {} }); }
                    });
                    if (this._editingMessageId) { this._focusEditingInput(); }
                    this._lastRenderedMessageSignature = latestSignature; this._lastRenderedMessageCount = combinedVisibleMessages.length;
                }
                _createMessageSignature(message, snapshotState) { if (!message) { return null; } if (message.type === "image" || message.type === "audio") { const url = message.content?.url ?? ""; return `${message.id}|${message.type}|${url}`; } const text = this._getMessageText(message, snapshotState); const activeIndex = snapshotState && typeof snapshotState.activeIndex === "number" ? snapshotState.activeIndex : ""; const entryCount = snapshotState && Array.isArray(snapshotState.entries) ? snapshotState.entries.length : ""; const streamingFlag = message?.metadata?.streaming ? "|streaming" : ""; return `${message.id}|${message.role}|${activeIndex}|${entryCount}|${text}${streamingFlag}`; }
                _renderMessageContent(message, textOverride) { if (message.type === "image" && message.content?.url) { return `<img src="${message.content.url}" alt="Image message">`; } if (message.type === "audio" && message.content?.url) { return `<audio controls src="${message.content.url}"></audio>`; } const text = textOverride ?? (message.content?.text ?? ""); return `<p class="yuui-paragraph">${this._formatChatText(text)}</p>`; }
                _isMessageGenerating(message) { if (!message || message.role !== "assistant") { return false; } if (this._snapshotManager.isPending(message.id)) { return true; } return Boolean(message?.metadata?.streaming); }
                _renderTypingIndicator() { return `<div class="chat-message__typing-indicator" aria-hidden="true"><span></span><span></span><span></span></div>`; }
                _getMessageText(message, snapshotState) { if (!message) { return ""; } if (snapshotState && typeof snapshotState.activeIndex === "number") { const { activeIndex, entries } = snapshotState; if (Array.isArray(entries) && entries[activeIndex] !== undefined) { return entries[activeIndex]; } } return message.content?.text ?? ""; }
                _renderEditingContent(message, snapshotState) { let draft = typeof this._editingDraftText === "string" ? this._editingDraftText : ""; if (message?.id !== this._editingMessageId || typeof this._editingDraftText !== "string") { draft = this._getMessageText(message, snapshotState); this._editingDraftText = draft; } const safeDraft = this._escapeHtml(draft); return `<div class="chat-message__edit" data-role="message-edit"><textarea class="chat-message__edit-input" data-role="edit-input" rows="1">${safeDraft}</textarea></div>`; }
                _buildEditingToolbarHtml(message) { const messageId = message?.id; if (!messageId) return ""; return `<div class="chat-message__toolbar" data-message-id="${messageId}"><button type="button" class="chat-btn chat-btn--ghost" data-action="edit-save" title="Save"><span class="material-symbols-outlined">check</span></button><button type="button" class="chat-btn chat-btn--ghost" data-action="edit-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button></div>`; }
                _autoResizeEditTextarea(input) { if (!input) return; const min = 24; const max = 600; input.style.height = "auto"; const next = Math.min(Math.max(min, input.scrollHeight), max); input.style.height = `${next}px`; }
                _updateEditingBubbleWidth(messageElement, input) { try { if (!messageElement) return; const bubble = messageElement.querySelector('.chat-message__bubble'); if (!bubble) return; const container = this.messagesElement || bubble.parentElement; const containerRect = container?.getBoundingClientRect(); const maxContainerWidth = containerRect ? containerRect.width : bubble.parentElement?.clientWidth || 0; const maxBubbleWidth = maxContainerWidth ? Math.floor(maxContainerWidth * 0.8) : undefined; const paddingX = this._getHorizontalExtras(bubble); const text = (input?.value ?? '').replace(/\r\n/g, '\n'); const contentWidth = this._measureLongestLineWidth(text, bubble); let desired = Math.ceil(contentWidth + paddingX); const minWidth = 80; if (Number.isFinite(minWidth)) desired = Math.max(desired, minWidth); if (Number.isFinite(maxBubbleWidth)) desired = Math.min(desired, maxBubbleWidth); bubble.style.width = `${desired}px`; this._editingBubbleWidth = desired; } catch (err) {} }
                _getHorizontalExtras(element) { try { const cs = window.getComputedStyle(element); const padL = parseFloat(cs.paddingLeft) || 0; const padR = parseFloat(cs.paddingRight) || 0; const borL = parseFloat(cs.borderLeftWidth) || 0; const borR = parseFloat(cs.borderRightWidth) || 0; return padL + padR + borL + borR; } catch { return 0; } }
                _measureLongestLineWidth(text, referenceEl) { const lines = String(text).split('\n'); const measurer = this._ensureTextMeasurer(referenceEl); let max = 0; for (const line of lines) { measurer.textContent = line.replace(/ /g, '\u00A0') || '\u00A0'; const rect = measurer.getBoundingClientRect(); if (rect.width > max) max = rect.width; } return max; }
                _ensureTextMeasurer(referenceEl) { if (this._textMeasurer && document.body.contains(this._textMeasurer)) { this._copyTextStyles(referenceEl, this._textMeasurer); return this._textMeasurer; } const span = document.createElement('span'); span.style.position = 'absolute'; span.style.visibility = 'hidden'; span.style.whiteSpace = 'pre'; span.style.left = '-9999px'; span.style.top = '-9999px'; this._copyTextStyles(referenceEl, span); document.body.appendChild(span); this._textMeasurer = span; return span; }
                _copyTextStyles(fromEl, toEl) { try { const cs = window.getComputedStyle(fromEl); toEl.style.fontFamily = cs.fontFamily; toEl.style.fontSize = cs.fontSize; toEl.style.fontWeight = cs.fontWeight; toEl.style.fontStyle = cs.fontStyle; toEl.style.letterSpacing = cs.letterSpacing; toEl.style.textTransform = cs.textTransform; } catch {} }
                _focusEditingInput() { if (!this._editingMessageId || !this.messagesElement) { return; } const escapeId = (value) => { if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") { return window.CSS.escape(value); } return String(value).replace(/"/g, '\\"'); }; const selector = `.chat-message[data-message-id="${escapeId(this._editingMessageId)}"] textarea[data-role="edit-input"]`; const focusInput = () => { if (!this.messagesElement || !this._editingMessageId) { return; } const input = this.messagesElement.querySelector(selector); if (!input || document.activeElement === input) { return; } input.focus(); if (typeof input.setSelectionRange === "function") { const length = input.value.length; input.setSelectionRange(length, length); } }; if (typeof requestAnimationFrame === "function") { requestAnimationFrame(focusInput); } else { setTimeout(focusInput, 0); } }
                _startEditingMessage(message) { if (!message || !message.id) { return; } try { if (this.messagesElement) { const escapeId = (value) => { if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") { return window.CSS.escape(value); } return String(value).replace(/"/g, '\\"'); }; const selector = `.chat-message[data-message-id="${escapeId(message.id)}"] .chat-message__bubble`; const bubble = this.messagesElement.querySelector(selector); if (bubble) { const rect = bubble.getBoundingClientRect(); this._editingBubbleHeight = null; this._editingBubbleWidth = Math.round(rect.width); } else { this._editingBubbleHeight = null; this._editingBubbleWidth = null; } } } catch { this._editingBubbleHeight = null; this._editingBubbleWidth = null; }
                    const snapshotState = this._getSnapshotState(message); this._editingMessageId = message.id; this._editingDraftText = this._getMessageText(message, snapshotState); this._renderMessages(this.store.state.activeHistory); }
                _cancelEditingMessage() { if (!this._editingMessageId) { return; } this._editingMessageId = null; this._editingDraftText = ""; this._editingBubbleHeight = null; this._editingBubbleWidth = null; this._renderMessages(this.store.state.activeHistory); }
                async _saveEditingMessage(message) { if (!message || message.id !== this._editingMessageId) { return; } if (!this.currentCharacterId || !this.messagesElement) { return; } const escapeId = (value) => { if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") { return window.CSS.escape(value); } return String(value).replace(/"/g, '\\"'); }; const selector = `.chat-message[data-message-id="${escapeId(message.id)}"] textarea[data-role="edit-input"]`; const input = this.messagesElement.querySelector(selector); if (!input) { return; } const nextText = input.value; this._editingDraftText = nextText; const snapshotState = this._getSnapshotState(message); const previousText = this._getMessageText(message, snapshotState); if (nextText === previousText) { this._cancelEditingMessage(); return; } try { await this.store.updateMessage(this.currentCharacterId, message.id, { content: { text: nextText } }); this._editingMessageId = null; this._editingDraftText = ""; this._editingBubbleHeight = null; this._editingBubbleWidth = null; } catch (error) { console.error("[ChatPage] Failed to update message:", error); this._notifyError("Unable to update the message. Please try again."); input.focus(); if (typeof input.setSelectionRange === "function") { const length = nextText.length; input.setSelectionRange(length, length); } return; } this._renderMessages(this.store.state.activeHistory); }
                _ensureConfirmModal() { if (this._confirmModalElements) { return this._confirmModalElements; } const modal = document.createElement("div"); modal.className = "chat-modal chat-modal--confirm hidden"; modal.innerHTML = `<div class="chat-modal__overlay" data-role="overlay"></div><div class="chat-modal__content"><header class="chat-modal__header"><h3>Confirm action</h3><button class="chat-btn chat-btn--ghost" data-action="cancel" data-role="cancel-close" type="button"><span class="material-symbols-outlined">close</span></button></header><div class="chat-modal__body"><p data-role="confirm-message">Are you sure?</p></div><footer class="chat-modal__footer"><button class="chat-btn chat-btn--ghost" data-action="cancel" data-role="cancel-button" type="button">Cancel</button><button class="chat-btn chat-btn--primary" data-action="confirm" type="button">Confirm</button></footer></div>`; document.body.appendChild(modal); const overlay = modal.querySelector('[data-role="overlay"]'); const messageElement = modal.querySelector('[data-role="confirm-message"]'); const confirmButton = modal.querySelector('[data-action="confirm"]'); const cancelButton = modal.querySelector('[data-role="cancel-button"]'); const cancelClose = modal.querySelector('[data-role="cancel-close"]'); this._confirmModal = modal; this._confirmModalElements = { modal, overlay, messageElement, confirmButton, cancelButton, cancelClose }; return this._confirmModalElements; }
                _confirmAction(options = {}) { const elements = this._ensureConfirmModal(); const { modal, overlay, messageElement, confirmButton, cancelButton, cancelClose } = elements; const messageText = options.message || "Are you sure?"; const confirmLabel = options.confirmLabel || "Confirm"; const cancelLabel = options.cancelLabel || "Cancel"; if (messageElement) { messageElement.textContent = messageText; } if (confirmButton) { confirmButton.textContent = confirmLabel; } if (cancelButton) { cancelButton.textContent = cancelLabel; } modal.classList.remove("hidden"); return new Promise(resolve => { let settled = false; const cleanup = () => { modal.classList.add("hidden"); confirmButton?.removeEventListener("click", onConfirm); overlay?.removeEventListener("click", onCancel); cancelButton?.removeEventListener("click", onCancel); cancelClose?.removeEventListener("click", onCancel); document.removeEventListener("keydown", onKeydown); }; const onConfirm = () => { if (settled) return; settled = true; cleanup(); resolve(true); }; const onCancel = () => { if (settled) return; settled = true; cleanup(); resolve(false); }; const onKeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }; confirmButton?.addEventListener("click", onConfirm); overlay?.addEventListener("click", onCancel); cancelButton?.addEventListener("click", onCancel); cancelClose?.addEventListener("click", onCancel); document.addEventListener("keydown", onKeydown); setTimeout(() => { if (confirmButton && typeof confirmButton.focus === "function") { confirmButton.focus(); } }, 0); }); }
                _notifyError(message) { const text = message || "An unexpected error occurred. Please try again."; if (typeof window?.showError === "function") { window.showError(text); return; } const toast = window?.Yuuka?.ui?.toast; if (toast && typeof toast.error === "function") { toast.error(text); return; } console.error("[ChatPage]", text); }
                async _handleSend() { if (!this.currentCharacterId) { return; } const input = this._navComposerElements?.input; if (!input || input.disabled) { return; } const raw = input.value.trim(); if (!raw) { input.value = ""; this._autoResizeComposerInput(); if (this._shouldKeepComposerFocus && this._shouldKeepComposerFocus()) { input.focus(); } else if (typeof input.blur === 'function') { input.blur(); } await this._requestContinuation(); return; } input.value = ""; this._autoResizeComposerInput(); if (this._shouldKeepComposerFocus && this._shouldKeepComposerFocus()) { input.focus(); } else if (typeof input.blur === 'function') { input.blur(); } try { const response = await this.store.addMessage(this.currentCharacterId, { role: "user", type: "text", content: { text: raw } }); if (response && response.error) { console.error("[ChatPage] Failed to queue AI response:", response.error); this._notifyError("Unable to contact the AI service. Please check your configuration."); } } catch (error) { console.error("[ChatPage] Streaming send failed:", error); const message = error?.message || "Unable to contact the AI service. Please check your configuration."; this._notifyError(message); input.value = raw; this._autoResizeComposerInput(); }
                }
                async _requestContinuation() { if (!this.currentCharacterId) { return; } const seed = this._generateContinuationSeed(); const promptText = `[Continue ${seed}]`; const clonedMessages = JSON.parse(JSON.stringify(this.store.state.activeHistory || [])); clonedMessages.push({ role: "user", type: "text", content: { text: promptText }, metadata: { seed, transient: true, instruction: true, continue: true } }); try { if (!(this.store._shouldUseStreaming && this.store._shouldUseStreaming())) { if (typeof this.store.startContinuationPlaceholder === 'function') { this.store.startContinuationPlaceholder(this.currentCharacterId); } } await this.store.queueAction(this.currentCharacterId, "continue", { seed, prompt: promptText, messages: clonedMessages }); } catch (error) { console.error("[ChatPage] Failed to request continuation:", error); this._notifyError("Unable to continue the conversation. Please try again."); } }
                _generateContinuationSeed() { try { if (typeof crypto !== "undefined") { if (typeof crypto.randomUUID === "function") { return crypto.randomUUID().replace(/-/g, "").slice(0, 12); } if (typeof crypto.getRandomValues === "function") { const bytes = new Uint32Array(3); crypto.getRandomValues(bytes); return Array.from(bytes, value => value.toString(16).padStart(8, "0")).join("").slice(0, 18); } } } catch (err) { console.warn("[ChatPage] Failed to create crypto seed, falling back to Math.random()", err); } return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16); }
                async _handleMessageAction(event, messageElement) { const action = event.currentTarget.getAttribute("data-action"); const messageId = messageElement.getAttribute("data-message-id"); const message = this.store.state.activeHistory.find(msg => msg.id === messageId); event.preventDefault(); event.stopPropagation(); if (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.disabled) { return; } if (action === "edit-cancel") { this._cancelEditingMessage(); return; } if (action === "edit-save") { if (message) { await this._saveEditingMessage(message); } return; } if (!message || !this.currentCharacterId) { if (action === "edit") { this._startEditingMessage(message); } return; } if (action === "edit") { this._startEditingMessage(message); return; } if (action === "snapshot-prev") { await this._actions.handleSnapshotPrev(messageId); return; } if (action === "snapshot-next") { await this._actions.handleSnapshotNext(messageId); return; } if (action === "delete") { await this._actions.handleDelete(messageId); return; } }
                _escapeHtml(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

                _formatChatText(text) {
                    const esc = (v) => this._escapeHtml(String(v));
                    let safe = esc(text);
                    // Bold via **text** (do not re-escape inner, it is already escaped)
                    safe = safe.replace(/\*\*(.+?)\*\*/g, (m, inner) => `<span class="chat-text--bold">${inner}</span>`);
                    // Actions as *action* — italic without the surrounding asterisks
                    safe = safe.replace(/(^|\s)\*(.*?)\*(?=\s|$)/g, (m, prefix, inner) => `${prefix}<span class="chat-text--action">${inner}</span>`);
                    // Speech in quotes: support both escaped quotes &quot;...&quot; and curly quotes “...”
                    safe = safe.replace(/&quot;([^<>&]+?)&quot;/g, (m, inner) => `<span class="chat-text--speech">"${inner}"</span>`);
                    safe = safe.replace(/[“](.+?)[”]/g, (m, inner) => `<span class="chat-text--speech">“${inner}”</span>`);
                    // Default narration color for remaining plain segments within the paragraph
                    safe = safe.replace(/(^|>)([^<]+)(?=<|$)/g, (m, prefix, textSeg) => {
                        // If the segment already contains styled spans, skip
                        if (/<span class=\"chat-text--(speech|action|bold)\">/.test(textSeg)) return m;
                        const t = textSeg; if (!t.trim()) return m; return `${prefix}<span class="chat-text--narration">${t}</span>`;
                    });
                    // Respect newlines
                    safe = safe.replace(/\n/g, '<br>');
                    // Auto-linebreak for speech after action, if enabled at settings
                    try { const cfg = this.store.state.settings || {}; if (cfg.ui_auto_linebreak) { safe = safe.replace(/(<span class=\"chat-text--action\">.*?<\/span>)(\s*)(<span class=\"chat-text--speech\">)/, (m,a,_,c)=> `${a}<br/>${c}`); } } catch {}
                    return safe;
                }

                _ensureUiStylesheet() {
                    try {
                        // Avoid duplicate injection
                        if (document.querySelector('link[data-ui-settings="true"], style#yuuka-ui-inline-css')) return;
                        // Try to detect an existing chat.css to derive correct base path
                        const existing = document.querySelector('link[href*="plugins/chat/static/"]') || document.querySelector('link[href$="/chat.css"], link[href*="chat.css"]');
                        let base = '/plugins/chat/static/';
                        if (existing && existing.href) {
                            base = existing.href.replace(/[^\/]+$/, '');
                        } else if (window.Yuuka?.plugins?.chat?.staticPath) {
                            // Ensure trailing slash
                            base = String(window.Yuuka.plugins.chat.staticPath).replace(/[^\/]*$/, '');
                            if (!/\/$/.test(base)) base += '/';
                        }
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = base + 'ui-settings.css';
                        link.dataset.uiSettings = 'true';
                        link.onerror = () => {
                            // Fallback: inject minimal inline styles so preview & bubbles still display correctly
                            if (document.getElementById('yuuka-ui-inline-css')) return;
                            const style = document.createElement('style');
                            style.id = 'yuuka-ui-inline-css';
                            style.textContent = ':root{--yuuka-action-color:#6a5acd;--yuuka-speech-color:#222;--yuuka-narration-color:#444;--yuuka-bold-color:#000;--yuuka-bubble-color:#f0f3f9;--yuuka-bubble-character-color:#f6f9fd}';
                            document.head.appendChild(style);
                        };
                        document.head.appendChild(link);
                    } catch {
                        // As a last resort inject inline defaults
                        if (!document.getElementById('yuuka-ui-inline-css')) {
                            const style = document.createElement('style');
                            style.id = 'yuuka-ui-inline-css';
                            style.textContent = ':root{--yuuka-action-color:#6a5acd;--yuuka-speech-color:#222;--yuuka-narration-color:#444;--yuuka-bold-color:#000;--yuuka-bubble-color:#f0f3f9;--yuuka-bubble-character-color:#f6f9fd}';
                            document.head.appendChild(style);
                        }
                    }
                }
                _applyUiCssVariables(settings) { try { const cfg = settings || this.store.state.settings || {}; const root = document.documentElement; const bubble = cfg.ui_color_bubble || '#f0f3f9'; const lighten = this._lightenColorForUi(bubble, 12); root.style.setProperty('--yuuka-action-color', cfg.ui_color_action || '#6a5acd'); root.style.setProperty('--yuuka-speech-color', cfg.ui_color_speech || '#222222'); root.style.setProperty('--yuuka-narration-color', cfg.ui_color_narration || '#444444'); root.style.setProperty('--yuuka-bold-color', cfg.ui_color_bold || '#000000'); root.style.setProperty('--yuuka-bubble-color', bubble); root.style.setProperty('--yuuka-bubble-character-color', lighten); } catch {} }
                _lightenColorForUi(hex, percent) { try { const clean = String(hex).replace('#',''); if (clean.length !== 6) return hex; const num = parseInt(clean, 16); let r=(num>>16)&255,g=(num>>8)&255,b=num&255; const adj=(c)=> Math.min(255, Math.round(c + (255-c)*(percent/100))); r=adj(r); g=adj(g); b=adj(b); return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); } catch { return hex; } }
            }

            namespace.ChatPageTab = ChatPageTab;
        })(window.Yuuka.plugins.chat.components);

