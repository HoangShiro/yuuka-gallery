(function registerChatPageTab(namespace) {
    class ChatPageTab {
        constructor(store) {
            this.store = store;
            this._unsubscribers = [];
            this.maxVisibleMessages = 100;
            this._messageSnapshots = new Map();
            this._pendingRegenerations = new Set();
            this._editingMessageId = null;
            this._editingDraftText = "";
            this._editingBubbleHeight = null;
            this._editingBubbleWidth = null;
            this._confirmModal = null;
            this._confirmModalElements = null;
            this._lastRenderedMessageSignature = null;
            this._lastRenderedMessageCount = 0;
            // (removed) scroll/lazy state for reversed rendering

            // UI refs
            this.container = null;
            this.headerElement = null;
            this.contentElement = null;
            this.messagesElement = null;
            this.messagesContainer = null;

            // Navibar/composer
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

            if (this.headerElement) {
                this.headerElement.innerHTML = "";
            }

            if (this.contentElement) {
                this.contentElement.classList.add("chat-tab-panel__content--no-scroll");
                this.contentElement.innerHTML = `
                    <div class="chat-page" data-role="chat-messages">
                        <div class="chat-empty-state">
                            <span class="material-symbols-outlined">forum</span>
                            <p>Select a character in the side tab or create a new one to begin.</p>
                        </div>
                    </div>
                `;
                this.messagesElement = this.contentElement.querySelector('[data-role="chat-messages"]');
                this.messagesContainer = this.messagesElement;
                // no scroll listener
            } else {
                this.messagesContainer = null;
                this.messagesElement = null;
            }

            // Events
            this._unsubscribers.push(
                this.store.on("active-character", (event) => this._renderActiveCharacter(event.detail))
            );
            this._unsubscribers.push(
                this.store.on("error", (event) => {
                    const detail = event?.detail || {};
                    const message = typeof detail.error === "string" && detail.error.trim()
                        ? detail.error
                        : "Unable to complete the request. Please try again.";
                    if (detail.messageId) {
                        this._pendingRegenerations.delete(detail.messageId);
                    }
                    this._notifyError(message);
                })
            );

            this._renderActiveCharacter({
                characterId: this.store.state.activeCharacterId,
                definition: this.store.state.activeCharacterDefinition,
                messages: this.store.state.activeHistory,
            });

            this._ensureNavibarService();
        }

        destroy() {
            this._unsubscribers.forEach(unsub => unsub());
            this._unsubscribers = [];
            this._isDockRequested = false;
            this._teardownNavComposer();
            this._lastRenderedMessageSignature = null;
            this._lastRenderedMessageCount = 0;
            // no scroll listener cleanup
            if (this._navServiceWaitTimer) {
                clearTimeout(this._navServiceWaitTimer);
                this._navServiceWaitTimer = null;
            }
            this.navibar = null;
            if (this.headerElement) {
                this.headerElement.innerHTML = "";
            }
            if (this.contentElement) {
                this.contentElement.innerHTML = "";
                this.contentElement.classList.remove("chat-tab-panel__content--no-scroll");
            }
            this.headerElement = null;
            this.contentElement = null;
            this.messagesContainer = null;
            this.messagesElement = null;
        }

        // removed scroll listeners

        _renderActiveCharacter(detail) {
            const { characterId, messages } = detail || {};
            const previousCharacterId = this.currentCharacterId;
            this.currentCharacterId = characterId;
            this._updateComposerState();
            if (previousCharacterId !== characterId) {
                this._editingMessageId = null;
                this._editingDraftText = "";
            }

            if (!characterId) {
                if (this.messagesElement) {
                    this.messagesElement.innerHTML = `
                        <div class="chat-empty-state">
                            <span class="material-symbols-outlined">forum</span>
                            <p>Select a character in the side tab or create a new one to begin.</p>
                        </div>
                    `;
                    this.messagesElement.dataset.truncated = "false";
                    this.messagesElement.scrollTop = 0;
                }
                this._lastRenderedMessageSignature = null;
                this._lastRenderedMessageCount = 0;
                return;
            }

            const normalizedMessages = Array.isArray(messages) ? messages : [];
            // Khôi phục snapshot từ backend nhưng giữ nguyên trạng thái snapshot đang hiện thị
            if (normalizedMessages.length > 0) {
                const switchedCharacter = previousCharacterId !== characterId;
                if (switchedCharacter) {
                    this._messageSnapshots = new Map();
                }
                normalizedMessages.forEach(msg => {
                    if (msg.role !== "assistant" || !Array.isArray(msg.snapshots) || msg.snapshots.length === 0) {
                        return;
                    }
                    const entries = [...msg.snapshots];
                    const latestIndex = entries.length - 1;
                    const latestText = entries[latestIndex];
                    const selectedIndex = this._getSelectedSnapshotIndexFromMessage(msg);
                    const targetIndex = this._isValidSnapshotIndex(selectedIndex) && selectedIndex < entries.length
                        ? selectedIndex
                        : latestIndex;
                    const existingState = this._messageSnapshots.get(msg.id);
                    if (existingState) {
                        existingState.entries = entries;
                        existingState.latestIndex = latestIndex;
                        if (this._isValidSnapshotIndex(selectedIndex) && selectedIndex < entries.length) {
                            existingState.activeIndex = selectedIndex;
                        } else if (
                            existingState.followLatest ||
                            typeof existingState.activeIndex !== "number" ||
                            existingState.activeIndex >= entries.length
                        ) {
                            existingState.activeIndex = latestIndex;
                        }
                        existingState.followLatest = existingState.activeIndex === existingState.latestIndex;
                        existingState.lastSyncedText = latestText;
                    } else {
                        this._messageSnapshots.set(msg.id, {
                            entries,
                            activeIndex: targetIndex,
                            latestIndex,
                            followLatest: targetIndex === latestIndex,
                            lastSyncedText: latestText,
                        });
                    }
                });
            }

            this._renderMessages(normalizedMessages);
        }

        setTabActive(isActive) {
            this._isTabActive = Boolean(isActive);
            if (!this._isTabActive) {
                this._dockSuppressed = false;
            }
            this._isDockRequested = !this._dockSuppressed && this._isTabActive && this._isPageActive;
            this._syncNavComposer();
        }

        setPageActive(isActive) {
            this._isPageActive = Boolean(isActive);
            if (!this._isPageActive) {
                this._dockSuppressed = false;
            }
            this._isDockRequested = !this._dockSuppressed && this._isTabActive && this._isPageActive;
            this._syncNavComposer();
        }

        _ensureNavibarService() {
            if (this.navibar && typeof this.navibar.openDock === "function") {
                this._syncNavComposer();
                return;
            }
            const service = window?.Yuuka?.services?.navibar;
            if (service && typeof service.openDock === "function") {
                this.navibar = service;
                this._syncNavComposer();
                return;
            }
            if (this._navServiceWaitTimer) {
                return;
            }
            const retry = () => {
                this._navServiceWaitTimer = null;
                const nav = window?.Yuuka?.services?.navibar;
                if (nav && typeof nav.openDock === "function") {
                    this.navibar = nav;
                    this._syncNavComposer();
                } else {
                    this._navServiceWaitTimer = setTimeout(retry, 500);
                }
            };
            this._navServiceWaitTimer = setTimeout(retry, 500);
        }

        _syncNavComposer() {
            const shouldShow = this._isDockRequested && this._isTabActive && this._isPageActive;
            if (!shouldShow) {
                this._teardownNavComposer();
                return;
            }
            if (!this.navibar || typeof this.navibar.openDock !== "function") {
                this._ensureNavibarService();
                return;
            }
            if (!this._navDockHandle) {
                this._mountNavComposer();
                return;
            }
            this._updateComposerState();
        }

        _mountNavComposer() {
            if (!this.navibar || this._navDockHandle) {
                return;
            }
            const composer = this._createNavComposerElement();
            if (!composer || !composer.root) {
                return;
            }
            const handle = this.navibar.openDock(this._navOwnerId, {
                element: composer.root,
                className: "navibar-dock--composer",
                onClose: () => this._handleDockClosed(),
                // Avoid auto-focusing the textarea on coarse-pointer/mobile devices to prevent keyboard popup
                focusSelector: this._shouldKeepComposerFocus ? (this._shouldKeepComposerFocus() ? '[data-role="composer-input"]' : null) : '[data-role="composer-input"]',
            });
            if (!handle) {
                return;
            }
            this._navDockHandle = handle;
            this._navComposerElements = composer;
            this._registerComposerListeners(composer);
            this._autoResizeComposerInput();
            this._updateComposerState();
        }

        _teardownNavComposer() {
            if (this._navDockHandle && this.navibar && typeof this.navibar.closeDock === "function") {
                this.navibar.closeDock(this._navOwnerId);
                return;
            }
            this._handleDockClosed();
        }

        _handleDockClosed() {
            this._clearComposerListeners();
            this._navComposerElements = null;
            this._navDockHandle = null;
            if (this._isDockRequested) {
                // Attempt to remount when dock should stay visible.
                this._mountNavComposer();
            }
        }

        _createNavComposerElement() {
            if (typeof document === "undefined") {
                return null;
            }
            const form = document.createElement("form");
            form.className = "navibar-composer";
            form.innerHTML = `
                <button type="button" class="nav-btn nav-btn--minimal" data-role="composer-menu" title="Open menu">
                    <span class="material-symbols-outlined">menu</span>
                </button>
                <textarea class="navibar-composer__input" data-role="composer-input" rows="1" placeholder="Type a message..."></textarea>
                <button type="submit" class="nav-btn nav-btn--minimal nav-btn--submit" data-action="send-message" title="Send message">
                    <span class="material-symbols-outlined">send</span>
                </button>
            `;
            return {
                root: form,
                form,
                input: form.querySelector('[data-role="composer-input"]'),
                sendButton: form.querySelector('[data-action="send-message"]'),
                menuButton: form.querySelector('[data-role="composer-menu"]'),
            };
        }

        _registerComposerListeners(composer) {
            if (!composer) {
                return;
            }
            const updateMenuButtonState = (isOpen) => {
                if (!composer.menuButton) {
                    return;
                }
                const active = Boolean(isOpen);
                composer.menuButton.classList.toggle("is-active", active);
                composer.menuButton.setAttribute("aria-pressed", active ? "true" : "false");
            };
            const register = (element, type, handler) => {
                if (!element || typeof element.addEventListener !== "function") return;
                element.addEventListener(type, handler);
                this._composerListeners.push({ element, type, handler });
            };
            if (composer.form) {
                register(composer.form, "submit", (event) => {
                    event.preventDefault();
                    this._handleSend();
                });
            }
            if (composer.menuButton) {
                register(composer.menuButton, "click", () => {
                    if (this.navibar && typeof this.navibar.toggleDockPeek === "function") {
                        const next = this.navibar.toggleDockPeek();
                        updateMenuButtonState(next);
                        return;
                    }
                    this._dockSuppressed = true;
                    this._isDockRequested = false;
                    if (this.navibar && typeof this.navibar.closeDock === "function") {
                        this.navibar.closeDock(this._navOwnerId);
                    } else {
                        this._handleDockClosed();
                    }
                    updateMenuButtonState(false);
                    this._syncNavComposer();
                });

                register(document, "navibar:dockPeekChange", (event) => {
                    const detail = event?.detail || {};
                    if (detail.ownerId && detail.ownerId !== this._navOwnerId) {
                        return;
                    }
                    updateMenuButtonState(Boolean(detail.isDockActive && detail.isOpen));
                });
            }
            if (composer.input) {
                register(composer.input, "keydown", (event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        this._handleSend();
                    }
                });
                register(composer.input, "input", () => this._autoResizeComposerInput());
            }
            if (composer.sendButton) {
                register(composer.sendButton, "click", (event) => {
                    event.preventDefault();
                    this._handleSend();
                });
            }

            const initialPeekState = (this.navibar && typeof this.navibar.isDockPeekOpen === "function")
                ? this.navibar.isDockPeekOpen()
                : false;
            updateMenuButtonState(initialPeekState);
        }

        _clearComposerListeners() {
            this._composerListeners.forEach(({ element, type, handler }) => {
                if (element && typeof element.removeEventListener === "function") {
                    element.removeEventListener(type, handler);
                }
            });
            this._composerListeners = [];
        }

        _autoResizeComposerInput() {
            const input = this._navComposerElements?.input;
            if (!input) return;
            const minHeight = 24;
            const maxHeight = 190;
            input.style.height = "auto";
            const next = Math.min(Math.max(minHeight, input.scrollHeight), maxHeight);
            input.style.height = `${next}px`;
        }

        _updateComposerState() {
            const input = this._navComposerElements?.input;
            const sendButton = this._navComposerElements?.sendButton;
            const hasCharacter = Boolean(this.currentCharacterId);
            if (input) {
                input.disabled = !hasCharacter;
                input.placeholder = hasCharacter ? "Type a message..." : "Select a character to start chatting.";
                if (!hasCharacter) {
                    input.value = "";
                    this._autoResizeComposerInput();
                }
            }
            if (sendButton) {
                sendButton.disabled = !hasCharacter;
            }
        }

        // Decide whether we should keep focus on the composer input after actions like submit.
        // On mobile (coarse pointer) keeping focus will pop up the virtual keyboard, which is undesirable.
        _shouldKeepComposerFocus() {
            try {
                if (typeof window !== "undefined" && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
                    return false;
                }
                // Fallback UA check for older browsers
                const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
                if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
                    return false;
                }
            } catch (e) {
                // If detection fails, default to keeping focus (desktop-like behavior)
            }
            return true;
        }

        _syncMessageSnapshots(messages) {
            const activeIds = new Set(messages.map(msg => msg.id));
            for (const id of Array.from(this._messageSnapshots.keys())) {
                if (!activeIds.has(id)) {
                    this._messageSnapshots.delete(id);
                    this._pendingRegenerations.delete(id);
                }
            }

            messages.forEach(message => {
                const messageId = message.id;
                if (!messageId || message.role !== "assistant" || message.type === "image" || message.type === "audio") {
                    return;
                }
                // N?u dang streaming (regen), v?n c?p nh?t n?i dung vào snapshot
                const text = message.content?.text ?? "";
                let snapshot = this._messageSnapshots.get(messageId);
                if (!snapshot) {
                    const entries = Array.isArray(message.snapshots) && message.snapshots.length > 0
                        ? [...message.snapshots]
                        : [text];
                    const latestIndex = entries.length - 1;
                    snapshot = {
                        entries,
                        activeIndex: latestIndex,
                        latestIndex,
                        followLatest: true,
                        lastSyncedText: entries[latestIndex] ?? "",
                    };
                    this._messageSnapshots.set(messageId, snapshot);
                }

                if (Array.isArray(message.snapshots) && message.snapshots.length > 0) {
                    snapshot.entries = [...message.snapshots];
                    snapshot.latestIndex = snapshot.entries.length - 1;
                    snapshot.lastSyncedText = snapshot.entries[snapshot.latestIndex] ?? "";
                }

                // N?u dang regen (streaming), c?p nh?t n?i dung m?i nh?t vào snapshot
                if (message?.metadata?.streaming) {
                    // N?u n?i dung m?i khác v?i snapshot cu?i, thêm vào entries
                    if (snapshot.entries.length === 0 || snapshot.entries[snapshot.entries.length - 1] !== text) {
                        snapshot.entries.push(text);
                        snapshot.latestIndex = snapshot.entries.length - 1;
                        snapshot.activeIndex = snapshot.latestIndex;
                        snapshot.followLatest = true;
                        snapshot.lastSyncedText = text;
                    }
                    return;
                }

                const previousLatestIndex = snapshot.latestIndex;
                const previousLatestText = snapshot.entries[previousLatestIndex] ?? "";
                let updatedLatest = false;

                if (snapshot.entries[snapshot.latestIndex] !== text) {
                    const existingIndex = snapshot.entries.findIndex(entry => entry === text);
                    if (existingIndex >= 0) {
                        snapshot.latestIndex = existingIndex;
                        snapshot.entries[existingIndex] = text;
                    } else {
                        snapshot.entries.push(text);
                        snapshot.latestIndex = snapshot.entries.length - 1;
                    }
                    updatedLatest = true;
                } else {
                    snapshot.entries[snapshot.latestIndex] = text;
                }

                if (snapshot.followLatest || snapshot.entries.length === 1) {
                    snapshot.activeIndex = snapshot.latestIndex;
                } else if (typeof snapshot.activeIndex !== "number") {
                    snapshot.activeIndex = snapshot.latestIndex;
                }

                snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;

                if (!message?.metadata?.streaming) {
                    const selectedIndex = this._getSelectedSnapshotIndexFromMessage(message);
                    if (this._isValidSnapshotIndex(selectedIndex) && selectedIndex < snapshot.entries.length) {
                        snapshot.activeIndex = selectedIndex;
                        snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;
                    }
                }

                if (updatedLatest && this._pendingRegenerations.has(messageId) && text !== snapshot.lastSyncedText) {
                    this._pendingRegenerations.delete(messageId);
                }

                snapshot.lastSyncedText = text;

                if (!message?.metadata?.streaming && this._pendingRegenerations.has(messageId)) {
                    this._pendingRegenerations.delete(messageId);
                }
            });
        }

        _isValidSnapshotIndex(value) {
            if (typeof value !== "number" || value < 0) {
                return false;
            }
            if (typeof Number.isInteger === "function") {
                return Number.isInteger(value);
            }
            return Math.floor(value) === value;
        }

        _getSelectedSnapshotIndexFromMessage(message) {
            if (!message || !message.metadata) {
                return null;
            }
            const value = message.metadata.selected_snapshot_index;
            if (this._isValidSnapshotIndex(value)) {
                return value;
            }
            return null;
        }

        async _persistSnapshotSelection(messageId, snapshotState) {
            if (!this.currentCharacterId || !snapshotState) {
                return;
            }
            const activeIndex = snapshotState.activeIndex;
            if (!this._isValidSnapshotIndex(activeIndex)) {
                return;
            }
            const history = this.store.state.activeHistory || [];
            const message = history.find(item => item.id === messageId);
            if (!message) {
                return;
            }
            const currentIndex = this._getSelectedSnapshotIndexFromMessage(message);
            if (currentIndex === activeIndex) {
                return;
            }
            message.metadata = { ...(message.metadata || {}), selected_snapshot_index: activeIndex };
            if (typeof this.store.setSelectedSnapshotIndex === "function") {
                await this.store.setSelectedSnapshotIndex(this.currentCharacterId, messageId, activeIndex);
            } else {
                await this.store.updateMessage(this.currentCharacterId, messageId, {
                    metadata: { selected_snapshot_index: activeIndex },
                }).catch(error => {
                    console.error("[ChatPage] Failed to persist snapshot selection", error);
                });
            }
        }

        _getSnapshotState(message) {
            if (!message || message.role !== "assistant" || message.type === "image" || message.type === "audio") {
                return null;
            }
            return this._messageSnapshots.get(message.id) || null;
        }

        _buildToolbarHtml(message, snapshotState) {
            const buttons = [];
            const isAssistant = message.role === "assistant";
            const isUser = message.role === "user";
            const messageId = message.id;
            const pending = this._pendingRegenerations.has(messageId);

            if (isAssistant && snapshotState) {
                const hasPrev = snapshotState.activeIndex > 0;
                const hasNextStored = snapshotState.activeIndex < (snapshotState.entries.length - 1);
                const prevDisabledAttr = hasPrev
                    ? ' aria-disabled="false"'
                    : ' disabled aria-disabled="true" data-disabled="true"';
                const nextDisabledAttr = pending
                    ? ' disabled aria-disabled="true"'
                    : ' aria-disabled="false"';
                buttons.push(`
                    <button class="chat-btn chat-btn--ghost" data-action="snapshot-prev" title="Previous response"${prevDisabledAttr}>
                        <span class="material-symbols-outlined">keyboard_arrow_left</span>
                    </button>
                `);
                buttons.push(`
                    <button class="chat-btn chat-btn--ghost" data-action="snapshot-next" title="Next response"${nextDisabledAttr} data-has-next="${hasNextStored ? "true" : "false"}" data-loading="${pending ? "true" : "false"}">
                        <span class="material-symbols-outlined">keyboard_arrow_right</span>
                    </button>
                `);
            }

            if (isAssistant || isUser) {
                buttons.push(`
                    <button class="chat-btn chat-btn--ghost" data-action="edit" title="Edit message">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                `);
                buttons.push(`
                    <button class="chat-btn chat-btn--ghost" data-action="delete" title="Delete message">
                        <span class="material-symbols-outlined">delete</span>
                    </button>
                `);
            }

            if (buttons.length === 0) {
                return "";
            }

            return `
                <div class="chat-message__toolbar" data-message-id="${messageId}">
                    ${buttons.join("")}
                </div>
            `;
        }

        _getDisplayContent(message) {
            const snapshotState = this._getSnapshotState(message);
            if (snapshotState && typeof snapshotState.activeIndex === "number") {
                const text = snapshotState.entries[snapshotState.activeIndex];
                return this._renderMessageContent(message, text);
            }
            return this._renderMessageContent(message);
        }

        _renderMessages(messages) {
            if (!this.messagesElement || !this.messagesContainer) {
                return;
            }
            const el = this.messagesElement;
            // No anchor, no scroll manipulation: keep rendering minimal and stable
            const list = Array.isArray(messages) ? messages : [];
            const isEmpty = list.length === 0;
            this.messagesContainer.classList.toggle("chat-page--empty", isEmpty);
            if (isEmpty) {
                el.innerHTML = `
                    <div class="chat-empty-state">
                        <span class="material-symbols-outlined">forum</span>
                        <p>No messages yet.</p>
                    </div>
                `;
                el.dataset.truncated = "false";
                if (this.messagesContainer) {
                    this.messagesContainer.scrollTop = 0;
                }
                this._lastRenderedMessageSignature = null;
                this._lastRenderedMessageCount = 0;
                return;
            }

            const limit = Number.isFinite(this.maxVisibleMessages) && this.maxVisibleMessages > 0
                ? Math.floor(this.maxVisibleMessages)
                : list.length;
            const startIndex = Math.max(0, list.length - limit);
            // Default order: older -> newer (newest at the bottom)
            const visibleMessages = startIndex > 0 ? list.slice(startIndex) : list;

            el.dataset.truncated = startIndex > 0 ? "true" : "false";

            if (this._editingMessageId && !visibleMessages.some(msg => msg.id === this._editingMessageId)) {
                this._editingMessageId = null;
                this._editingDraftText = "";
            }

            this._syncMessageSnapshots(visibleMessages);

            const latestMessage = visibleMessages.length > 0
                ? visibleMessages[visibleMessages.length - 1]
                : null;
            const latestSnapshotState = latestMessage ? this._getSnapshotState(latestMessage) : null;
            const latestSignature = this._createMessageSignature(latestMessage, latestSnapshotState);

            el.innerHTML = visibleMessages.map(message => {
                const snapshotState = this._getSnapshotState(message);
                const isEditing = this._editingMessageId === message.id;
                const contentHtml = isEditing
                    ? this._renderEditingContent(message, snapshotState)
                    : this._getDisplayContent(message);
                const toolbarHtml = isEditing ? this._buildEditingToolbarHtml(message) : this._buildToolbarHtml(message, snapshotState);
                const bubbleClasses = ["chat-message__bubble"];
                const isGenerating = !isEditing && this._isMessageGenerating(message);
                if (isEditing) {
                    bubbleClasses.push("chat-message__bubble--editing");
                }
                if (isGenerating) {
                    bubbleClasses.push("chat-message__bubble--loading");
                }
                const typingHtml = isGenerating ? this._renderTypingIndicator() : "";
                let bubbleStyle = "";
                if (isEditing && Number.isFinite(this._editingBubbleWidth)) {
                    bubbleStyle = ` style=\"width: ${this._editingBubbleWidth}px\"`;
                }
                return `
                <article class="chat-message chat-message--${message.role}" data-message-id="${message.id}">
                    <div class="${bubbleClasses.join(" ")}" data-editing="${isEditing ? "true" : "false"}"${bubbleStyle}>
                        ${contentHtml}
                        ${typingHtml}
                    </div>
                    ${toolbarHtml}
                </article>
            `;
            }).join("");

            el.querySelectorAll(".chat-message").forEach(messageElement => {
                messageElement.querySelectorAll("[data-action]").forEach(button => {
                    button.addEventListener("click", (event) => this._handleMessageAction(event, messageElement));
                });
                const editInput = messageElement.querySelector("textarea[data-role=\"edit-input\"]");
                if (editInput) {
                    editInput.addEventListener("input", () => {
                        this._editingDraftText = editInput.value;
                        this._autoResizeEditTextarea(editInput);
                        this._updateEditingBubbleWidth(messageElement, editInput);
                    });
                    editInput.addEventListener("keydown", (event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            this._cancelEditingMessage();
                        } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                            event.preventDefault();
                            const messageId = messageElement.getAttribute("data-message-id");
                            const messageRef = this.store.state.activeHistory.find(item => item.id === messageId);
                            if (messageRef) {
                                this._saveEditingMessage(messageRef);
                            }
                        }
                    });
                    // Initial autoresize and width sync for current content
                    this._autoResizeEditTextarea(editInput);
                    this._updateEditingBubbleWidth(messageElement, editInput);
                }

                // Narrow-screen: toggle toolbar visibility when tapping the bubble
                const bubble = messageElement.querySelector('.chat-message__bubble');
                if (bubble) {
                    bubble.addEventListener('click', (ev) => {
                        try {
                            // Only apply on narrow screens
                            const isNarrow = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
                            if (!isNarrow) return;
                            // Ignore if user is selecting text
                            const sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
                            if (sel && sel.toString && sel.toString().length > 0) return;
                            // Close other toolbars
                            this.messagesElement?.querySelectorAll('.chat-message.is-toolbar-open').forEach(el => {
                                if (el !== messageElement) el.classList.remove('is-toolbar-open');
                            });
                            messageElement.classList.toggle('is-toolbar-open');
                        } catch {}
                    });
                }
            });

            if (this._editingMessageId) {
                this._focusEditingInput();
            }

            this._lastRenderedMessageSignature = latestSignature;
            this._lastRenderedMessageCount = visibleMessages.length;
        }

        _createMessageSignature(message, snapshotState) {
            if (!message) {
                return null;
            }
            if (message.type === "image" || message.type === "audio") {
                const url = message.content?.url ?? "";
                return `${message.id}|${message.type}|${url}`;
            }
            const text = this._getMessageText(message, snapshotState);
            const activeIndex = snapshotState && typeof snapshotState.activeIndex === "number"
                ? snapshotState.activeIndex
                : "";
            const entryCount = snapshotState && Array.isArray(snapshotState.entries)
                ? snapshotState.entries.length
                : "";
            const streamingFlag = message?.metadata?.streaming ? "|streaming" : "";
            return `${message.id}|${message.role}|${activeIndex}|${entryCount}|${text}${streamingFlag}`;
        }

        // Auto-scroll handlers removed

        _renderMessageContent(message, textOverride) {
            if (message.type === "image" && message.content?.url) {
                return `<img src="${message.content.url}" alt="Image message">`;
            }
            if (message.type === "audio" && message.content?.url) {
                return `<audio controls src="${message.content.url}"></audio>`;
            }
            const text = textOverride ?? (message.content?.text ?? "");
            return `<p>${this._escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
        }

        _isMessageGenerating(message) {
            if (!message || message.role !== "assistant") {
                return false;
            }
            if (this._pendingRegenerations.has(message.id)) {
                return true;
            }
            return Boolean(message?.metadata?.streaming);
        }

        _renderTypingIndicator() {
            return `
                <div class="chat-message__typing-indicator" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
        }

        _getMessageText(message, snapshotState) {
            if (!message) {
                return "";
            }
            if (snapshotState && typeof snapshotState.activeIndex === "number") {
                const { activeIndex, entries } = snapshotState;
                if (Array.isArray(entries) && entries[activeIndex] !== undefined) {
                    return entries[activeIndex];
                }
            }
            return message.content?.text ?? "";
        }

        _renderEditingContent(message, snapshotState) {
            let draft = typeof this._editingDraftText === "string" ? this._editingDraftText : "";
            if (message?.id !== this._editingMessageId || typeof this._editingDraftText !== "string") {
                draft = this._getMessageText(message, snapshotState);
                this._editingDraftText = draft;
            }
            const safeDraft = this._escapeHtml(draft);
            return `
                <div class="chat-message__edit" data-role="message-edit">
                    <textarea class="chat-message__edit-input" data-role="edit-input" rows="1">${safeDraft}</textarea>
                </div>
            `;
        }

        _buildEditingToolbarHtml(message) {
            const messageId = message?.id;
            if (!messageId) return "";
            return `
                <div class="chat-message__toolbar" data-message-id="${messageId}">
                    <button type="button" class="chat-btn chat-btn--ghost" data-action="edit-save" title="Save">
                        <span class="material-symbols-outlined">check</span>
                    </button>
                    <button type="button" class="chat-btn chat-btn--ghost" data-action="edit-cancel" title="Cancel">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            `;
        }

        _autoResizeEditTextarea(input) {
            if (!input) return;
            const min = 24;
            const max = 600;
            input.style.height = "auto";
            const next = Math.min(Math.max(min, input.scrollHeight), max);
            input.style.height = `${next}px`;
        }

        _updateEditingBubbleWidth(messageElement, input) {
            try {
                if (!messageElement) return;
                const bubble = messageElement.querySelector('.chat-message__bubble');
                if (!bubble) return;
                const container = this.messagesElement || bubble.parentElement;
                const containerRect = container?.getBoundingClientRect();
                const maxContainerWidth = containerRect ? containerRect.width : bubble.parentElement?.clientWidth || 0;
                // Max bubble width is 80% per CSS
                const maxBubbleWidth = maxContainerWidth ? Math.floor(maxContainerWidth * 0.8) : undefined;
                const paddingX = this._getHorizontalExtras(bubble);
                const text = (input?.value ?? '').replace(/\r\n/g, '\n');
                const contentWidth = this._measureLongestLineWidth(text, bubble);
                let desired = Math.ceil(contentWidth + paddingX);
                const minWidth = 80; // a small visual minimum
                if (Number.isFinite(minWidth)) desired = Math.max(desired, minWidth);
                if (Number.isFinite(maxBubbleWidth)) desired = Math.min(desired, maxBubbleWidth);
                bubble.style.width = `${desired}px`;
                this._editingBubbleWidth = desired;
            } catch (err) {
                // Fallback: do nothing
            }
        }

        _getHorizontalExtras(element) {
            try {
                const cs = window.getComputedStyle(element);
                const padL = parseFloat(cs.paddingLeft) || 0;
                const padR = parseFloat(cs.paddingRight) || 0;
                const borL = parseFloat(cs.borderLeftWidth) || 0;
                const borR = parseFloat(cs.borderRightWidth) || 0;
                return padL + padR + borL + borR;
            } catch {
                return 0;
            }
        }

        _measureLongestLineWidth(text, referenceEl) {
            const lines = String(text).split('\n');
            const measurer = this._ensureTextMeasurer(referenceEl);
            let max = 0;
            for (const line of lines) {
                // Use non-breaking spaces for consistent width with spaces
                measurer.textContent = line.replace(/ /g, '\u00A0') || '\u00A0';
                const rect = measurer.getBoundingClientRect();
                if (rect.width > max) max = rect.width;
            }
            return max;
        }

        _ensureTextMeasurer(referenceEl) {
            if (this._textMeasurer && document.body.contains(this._textMeasurer)) {
                this._copyTextStyles(referenceEl, this._textMeasurer);
                return this._textMeasurer;
            }
            const span = document.createElement('span');
            span.style.position = 'absolute';
            span.style.visibility = 'hidden';
            span.style.whiteSpace = 'pre';
            span.style.left = '-9999px';
            span.style.top = '-9999px';
            this._copyTextStyles(referenceEl, span);
            document.body.appendChild(span);
            this._textMeasurer = span;
            return span;
        }

        _copyTextStyles(fromEl, toEl) {
            try {
                const cs = window.getComputedStyle(fromEl);
                toEl.style.fontFamily = cs.fontFamily;
                toEl.style.fontSize = cs.fontSize;
                toEl.style.fontWeight = cs.fontWeight;
                toEl.style.fontStyle = cs.fontStyle;
                toEl.style.letterSpacing = cs.letterSpacing;
                toEl.style.textTransform = cs.textTransform;
            } catch {
                // ignore
            }
        }

        _focusEditingInput() {
            if (!this._editingMessageId || !this.messagesElement) {
                return;
            }
            const escapeId = (value) => {
                if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
                    return window.CSS.escape(value);
                }
                return String(value).replace(/"/g, '\\"');
            };
            const selector = `.chat-message[data-message-id="${escapeId(this._editingMessageId)}"] textarea[data-role="edit-input"]`;
            const focusInput = () => {
                if (!this.messagesElement || !this._editingMessageId) {
                    return;
                }
                const input = this.messagesElement.querySelector(selector);
                if (!input || document.activeElement === input) {
                    return;
                }
                input.focus();
                if (typeof input.setSelectionRange === "function") {
                    const length = input.value.length;
                    input.setSelectionRange(length, length);
                }
            };
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(focusInput);
            } else {
                setTimeout(focusInput, 0);
            }
        }

        _startEditingMessage(message) {
            if (!message || !message.id) {
                return;
            }
            // Measure current bubble size before switching to edit mode (lock width only)
            try {
                if (this.messagesElement) {
                    const escapeId = (value) => {
                        if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
                            return window.CSS.escape(value);
                        }
                        return String(value).replace(/"/g, '\\"');
                    };
                    const selector = `.chat-message[data-message-id="${escapeId(message.id)}"] .chat-message__bubble`;
                    const bubble = this.messagesElement.querySelector(selector);
                    if (bubble) {
                        const rect = bubble.getBoundingClientRect();
                        this._editingBubbleHeight = null; // allow auto-grow in height
                        this._editingBubbleWidth = Math.round(rect.width);
                    } else {
                        this._editingBubbleHeight = null;
                        this._editingBubbleWidth = null;
                    }
                }
            } catch {
                this._editingBubbleHeight = null;
                this._editingBubbleWidth = null;
            }
            const snapshotState = this._getSnapshotState(message);
            this._editingMessageId = message.id;
            this._editingDraftText = this._getMessageText(message, snapshotState);
            this._renderMessages(this.store.state.activeHistory);
        }

        _cancelEditingMessage() {
            if (!this._editingMessageId) {
                return;
            }
            this._editingMessageId = null;
            this._editingDraftText = "";
            this._editingBubbleHeight = null;
            this._editingBubbleWidth = null;
            this._renderMessages(this.store.state.activeHistory);
        }

        async _saveEditingMessage(message) {
            if (!message || message.id !== this._editingMessageId) {
                return;
            }
            if (!this.currentCharacterId || !this.messagesElement) {
                return;
            }
            const escapeId = (value) => {
                if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
                    return window.CSS.escape(value);
                }
                return String(value).replace(/"/g, '\\"');
            };
            const selector = `.chat-message[data-message-id="${escapeId(message.id)}"] textarea[data-role="edit-input"]`;
            const input = this.messagesElement.querySelector(selector);
            if (!input) {
                return;
            }
            const nextText = input.value;
            this._editingDraftText = nextText;
            const snapshotState = this._getSnapshotState(message);
            const previousText = this._getMessageText(message, snapshotState);
            if (nextText === previousText) {
                this._cancelEditingMessage();
                return;
            }
            try {
                await this.store.updateMessage(this.currentCharacterId, message.id, {
                    content: { text: nextText },
                });
                this._editingMessageId = null;
                this._editingDraftText = "";
                this._editingBubbleHeight = null;
                this._editingBubbleWidth = null;
            } catch (error) {
                console.error("[ChatPage] Failed to update message:", error);
                this._notifyError("Unable to update the message. Please try again.");
                input.focus();
                if (typeof input.setSelectionRange === "function") {
                    const length = nextText.length;
                    input.setSelectionRange(length, length);
                }
                return;
            }
            this._renderMessages(this.store.state.activeHistory);
        }

        _ensureConfirmModal() {
            if (this._confirmModalElements) {
                return this._confirmModalElements;
            }
            const modal = document.createElement("div");
            modal.className = "chat-modal chat-modal--confirm hidden";
            modal.innerHTML = `
                <div class="chat-modal__overlay" data-role="overlay"></div>
                <div class="chat-modal__content">
                    <header class="chat-modal__header">
                        <h3>Confirm action</h3>
                        <button class="chat-btn chat-btn--ghost" data-action="cancel" data-role="cancel-close" type="button">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </header>
                    <div class="chat-modal__body">
                        <p data-role="confirm-message">Are you sure?</p>
                    </div>
                    <footer class="chat-modal__footer">
                        <button class="chat-btn chat-btn--ghost" data-action="cancel" data-role="cancel-button" type="button">Cancel</button>
                        <button class="chat-btn chat-btn--primary" data-action="confirm" type="button">Confirm</button>
                    </footer>
                </div>
            `;
            document.body.appendChild(modal);
            const overlay = modal.querySelector('[data-role="overlay"]');
            const messageElement = modal.querySelector('[data-role="confirm-message"]');
            const confirmButton = modal.querySelector('[data-action="confirm"]');
            const cancelButton = modal.querySelector('[data-role="cancel-button"]');
            const cancelClose = modal.querySelector('[data-role="cancel-close"]');
            this._confirmModal = modal;
            this._confirmModalElements = {
                modal,
                overlay,
                messageElement,
                confirmButton,
                cancelButton,
                cancelClose,
            };
            return this._confirmModalElements;
        }

        _confirmAction(options = {}) {
            const elements = this._ensureConfirmModal();
            const { modal, overlay, messageElement, confirmButton, cancelButton, cancelClose } = elements;
            const messageText = options.message || "Are you sure?";
            const confirmLabel = options.confirmLabel || "Confirm";
            const cancelLabel = options.cancelLabel || "Cancel";
            if (messageElement) {
                messageElement.textContent = messageText;
            }
            if (confirmButton) {
                confirmButton.textContent = confirmLabel;
            }
            if (cancelButton) {
                cancelButton.textContent = cancelLabel;
            }
            modal.classList.remove("hidden");

            return new Promise(resolve => {
                let settled = false;
                const cleanup = () => {
                    modal.classList.add("hidden");
                    confirmButton?.removeEventListener("click", onConfirm);
                    overlay?.removeEventListener("click", onCancel);
                    cancelButton?.removeEventListener("click", onCancel);
                    cancelClose?.removeEventListener("click", onCancel);
                    document.removeEventListener("keydown", onKeydown);
                };
                const onConfirm = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(true);
                };
                const onCancel = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(false);
                };
                const onKeydown = (event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        onCancel();
                    }
                };
                confirmButton?.addEventListener("click", onConfirm);
                overlay?.addEventListener("click", onCancel);
                cancelButton?.addEventListener("click", onCancel);
                cancelClose?.addEventListener("click", onCancel);
                document.addEventListener("keydown", onKeydown);
                setTimeout(() => {
                    if (confirmButton && typeof confirmButton.focus === "function") {
                        confirmButton.focus();
                    }
                }, 0);
            });
        }

        _notifyError(message) {
            const text = message || "An unexpected error occurred. Please try again.";
            if (typeof window?.showError === "function") {
                window.showError(text);
                return;
            }
            const toast = window?.Yuuka?.ui?.toast;
            if (toast && typeof toast.error === "function") {
                toast.error(text);
                return;
            }
            console.error("[ChatPage]", text);
        }


        async _handleSend() {
            if (!this.currentCharacterId) {
                return;
            }
            const input = this._navComposerElements?.input;
            if (!input || input.disabled) {
                return;
            }
            const raw = input.value.trim();
            if (!raw) {
                input.value = "";
                this._autoResizeComposerInput();
                if (this._shouldKeepComposerFocus && this._shouldKeepComposerFocus()) {
                    input.focus();
                } else if (typeof input.blur === 'function') {
                    // Prevent mobile keyboard from popping up after submit with empty message (continuation)
                    input.blur();
                }
                await this._requestContinuation();
                return;
            }
            input.value = "";
            this._autoResizeComposerInput();
            if (this._shouldKeepComposerFocus && this._shouldKeepComposerFocus()) {
                input.focus();
            } else if (typeof input.blur === 'function') {
                // Prevent mobile keyboard from popping up immediately after sending
                input.blur();
            }
            try {
                const response = await this.store.addMessage(this.currentCharacterId, {
                    role: "user",
                    type: "text",
                    content: { text: raw },
                });
                if (response && response.error) {
                    console.error("[ChatPage] Failed to queue AI response:", response.error);
                    const errorText = "Unable to contact the AI service. Please check your configuration.";
                    this._notifyError(errorText);
                }
            } catch (error) {
                console.error("[ChatPage] Streaming send failed:", error);
                const message = error?.message || "Unable to contact the AI service. Please check your configuration.";
                this._notifyError(message);
                input.value = raw;
                this._autoResizeComposerInput();
            }
        }

        async _requestContinuation() {
            if (!this.currentCharacterId) {
                return;
            }
            const seed = this._generateContinuationSeed();
            const promptText = `[Continue ${seed}]`;
            const clonedMessages = JSON.parse(JSON.stringify(this.store.state.activeHistory || []));
            clonedMessages.push({
                role: "user",
                type: "text",
                content: { text: promptText },
                metadata: { seed, transient: true, instruction: true, continue: true },
            });
            try {
                // Only insert a local placeholder if we are NOT streaming
                if (!(this.store._shouldUseStreaming && this.store._shouldUseStreaming())) {
                    if (typeof this.store.startContinuationPlaceholder === 'function') {
                        this.store.startContinuationPlaceholder(this.currentCharacterId);
                    }
                }
                await this.store.queueAction(this.currentCharacterId, "continue", {
                    seed,
                    prompt: promptText,
                    messages: clonedMessages,
                });
            } catch (error) {
                console.error("[ChatPage] Failed to request continuation:", error);
                const fallback = "Unable to continue the conversation. Please try again.";
                this._notifyError(fallback);
            }
        }

        _generateContinuationSeed() {
            try {
                if (typeof crypto !== "undefined") {
                    if (typeof crypto.randomUUID === "function") {
                        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                    }
                    if (typeof crypto.getRandomValues === "function") {
                        const bytes = new Uint32Array(3);
                        crypto.getRandomValues(bytes);
                        return Array.from(bytes, value => value.toString(16).padStart(8, "0")).join("").slice(0, 18);
                    }
                }
            } catch (err) {
                console.warn("[ChatPage] Failed to create crypto seed, falling back to Math.random()", err);
            }
            return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16);
        }

        async _handleMessageAction(event, messageElement) {
            const action = event.currentTarget.getAttribute("data-action");
            const messageId = messageElement.getAttribute("data-message-id");
            const message = this.store.state.activeHistory.find(msg => msg.id === messageId);
            event.preventDefault();
            event.stopPropagation();

            if (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.disabled) {
                return;
            }

            if (action === "edit-cancel") {
                this._cancelEditingMessage();
                return;
            }

            if (action === "edit-save") {
                if (message) {
                    await this._saveEditingMessage(message);
                }
                return;
            }

            if (!message || !this.currentCharacterId) {
                if (action === "edit") {
                    this._startEditingMessage(message);
                }
                return;
            }

            if (action === "edit") {
                this._startEditingMessage(message);
                return;
            }

            if (action === "snapshot-prev") {
                const snapshot = this._messageSnapshots.get(messageId);
                if (snapshot && snapshot.activeIndex > 0) {
                    snapshot.activeIndex -= 1;
                    snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;
                    void this._persistSnapshotSelection(messageId, snapshot);
                    this._renderMessages(this.store.state.activeHistory);
                }
                return;
            }

            if (action === "snapshot-next") {
                const snapshot = this._messageSnapshots.get(messageId);
                if (!snapshot) {
                    return;
                }
                if (snapshot.activeIndex < snapshot.entries.length - 1) {
                    snapshot.activeIndex += 1;
                    snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;
                    void this._persistSnapshotSelection(messageId, snapshot);
                    this._renderMessages(this.store.state.activeHistory);
                    return;
                }
                if (this._pendingRegenerations.has(messageId)) {
                    return;
                }
                this._pendingRegenerations.add(messageId);
                snapshot.followLatest = true;
                await this._persistSnapshotSelection(messageId, snapshot);
                this._renderMessages(this.store.state.activeHistory);
                try {
                    await this.store.queueAction(this.currentCharacterId, "regen", {
                        message_id: messageId,
                        messages: this.store.state.activeHistory,
                    });
                } catch (error) {
                    console.error("[ChatPage] Failed to regenerate message:", error);
                    const fallback = "Unable to ask the AI right now. Please try again.";
                    this._notifyError(fallback);
                    this._pendingRegenerations.delete(messageId);
                    this._renderMessages(this.store.state.activeHistory);
                }
                return;
            }

            if (action === "delete") {
                const confirmed = await this._confirmAction({
                    message: "Are you sure you want to delete this message?",
                    confirmLabel: "Delete",
                    cancelLabel: "Cancel",
                });
                if (!confirmed) {
                    return;
                }
                if (this._editingMessageId === messageId) {
                    this._cancelEditingMessage();
                }
                try {
                    await this.store.deleteMessage(this.currentCharacterId, messageId);
                    this._messageSnapshots.delete(messageId);
                    this._pendingRegenerations.delete(messageId);
                    // Re-render to immediately reflect deletion in newest-first layout
                    this._renderMessages(this.store.state.activeHistory);
                } catch (error) {
                    console.error("[ChatPage] Failed to delete message:", error);
                    this._notifyError("Unable to delete the message. Please try again.");
                }
                return;
            }
        }

        _escapeHtml(text) {
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    }

    namespace.ChatPageTab = ChatPageTab;
})(window.Yuuka.plugins.chat.components);

