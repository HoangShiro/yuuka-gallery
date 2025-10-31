(function setupChatPlugin(global) {
    const chatNamespace = global.Yuuka.plugins.chat;
    const { ChatAPI } = chatNamespace.services;
    const { ChatStore } = chatNamespace.stores;
    const {
        CharacterListTab,
        ChatListTab,
        ChatPageTab,
        CharacterDefinitionTab,
        GenerationSettingsTab,
    } = chatNamespace.components;
    const { MessageControlsModal } = chatNamespace.modals;

    class ChatComponent {
        constructor(container, api) {
            this.container = container;
            this.coreApi = api || null;
            this.api = new ChatAPI();
            this.store = new ChatStore(this.api);

            this.page1Tabs = new Map();
            this.page2Tabs = new Map();
            this._activePage1Tab = "character-list";
            this._activePage2Tab = "chat-page";
            this._activePage = "page1";
            this._creatingNew = false;
            this._cleanupFns = [];

            this.messageModal = new MessageControlsModal();

            this.page2TabMenuButton = null;
            this.pageAvatarElement = null;
            this.pageAvatarImage = null;
            this.pageAvatarFallback = null;
        }

        async init() {
            this._renderShell();
            this._instantiateTabs();
            this._registerNavButtons();
            await this.store.bootstrap();
        }

        destroy() {
            this.page1Tabs.forEach(tab => tab.instance?.destroy?.());
            this.page2Tabs.forEach(tab => tab.instance?.destroy?.());
            this._cleanupFns.forEach(dispose => {
                if (typeof dispose === "function") {
                    dispose();
                }
            });
            this._cleanupFns = [];
            this.store.destroy();
            this.container.innerHTML = "";
        }

        _renderShell() {
            this.container.innerHTML = `
                <div class="chat-plugin">
                    <div class="chat-page-wrapper chat-page-wrapper--page1 active" data-page="page1">
                        <nav class="chat-tab-bar" data-role="page1-tabs">
                            <button class="chat-tab-bar__btn active" data-tab="character-list">Character list</button>
                            <button class="chat-tab-bar__btn" data-tab="chat-list">Chat list</button>
                        </nav>
                        <div class="chat-tab-panels" data-role="page1-panels">
                            <section class="chat-tab-panel active" data-panel="character-list">
                                <div class="chat-tab-panel__header" data-role="tab-header"></div>
                                <div class="chat-tab-panel__content" data-role="tab-content"></div>
                            </section>
                            <section class="chat-tab-panel" data-panel="chat-list">
                                <div class="chat-tab-panel__header" data-role="tab-header"></div>
                                <div class="chat-tab-panel__content" data-role="tab-content"></div>
                            </section>
                        </div>
                    </div>

                    <div class="chat-page-wrapper chat-page-wrapper--page2" data-page="page2">
                        <div class="chat-page2-header">
                            <div class="chat-page2-header__navigation">
                                <button class="chat-back-btn" data-action="go-page1">
                                    <span class="material-symbols-outlined">arrow_back</span>
                                    <span>Back to characters</span>
                                </button>
                            </div>
                            <div class="chat-page2-identity" data-role="page2-identity">
                                <div class="chat-page2-avatar" data-role="page2-avatar">
                                    <span class="chat-page2-avatar__fallback material-symbols-outlined" data-role="page2-avatar-fallback">account_circle</span>
                                    <img class="chat-page2-avatar__image" data-role="page2-avatar-img" alt="" hidden>
                                </div>
                                <h2 class="chat-page2-title" data-role="page2-title">Chat</h2>
                                <nav class="chat-page-action" data-role="page2-action-menu" aria-label="Chat actions" hidden>
                                    <button class="chat-tab-bar__btn chat-tab-bar__btn--icon" data-action="new-chat" title="New chat">
                                        <span class="material-symbols-outlined">chat_add_on</span>
                                        <span class="chat-tab-bar__label">New chat</span>
                                    </button>
                                    <button class="chat-tab-bar__btn chat-tab-bar__btn--icon" data-action="remove-chat" title="Remove chat">
                                        <span class="material-symbols-outlined">chat_error</span>
                                        <span class="chat-tab-bar__label">Remove chat</span>
                                    </button>
                                    <button class="chat-tab-bar__btn chat-tab-bar__btn--icon" data-action="view-avatar" title="View avatar">
                                        <span class="material-symbols-outlined">account_box</span>
                                        <span class="chat-tab-bar__label">View avatar</span>
                                    </button>
                                </nav>
                            </div>
                            <div class="chat-page2-tabs">
                                <button type="button" class="chat-tab-menu-btn" data-role="page2-tab-menu" aria-label="Chat tabs menu" aria-expanded="false" aria-controls="chat-page2-tabs-nav">
                                    <span class="material-symbols-outlined">menu</span>
                                </button>
                                <nav id="chat-page2-tabs-nav" class="chat-tab-bar chat-tab-bar--icons" data-role="page2-tabs">
                                    <button class="chat-tab-bar__btn chat-tab-bar__btn--icon active" data-tab="chat-page" aria-label="Chat page" title="Chat page">
                                        <span class="material-symbols-outlined">chat_bubble</span>
                                        <span class="chat-tab-bar__label">Chat</span>
                                    </button>
                                    <button class="chat-tab-bar__btn chat-tab-bar__btn--icon" data-tab="definition" aria-label="Character definition" title="Character definition">
                                        <span class="material-symbols-outlined">article_person</span>
                                        <span class="chat-tab-bar__label">Definition</span>
                                    </button>
                                    <button class="chat-tab-bar__btn chat-tab-bar__btn--icon" data-tab="settings" aria-label="Generation settings" title="Generation settings">
                                        <span class="material-symbols-outlined">settings_account_box</span>
                                        <span class="chat-tab-bar__label">Settings</span>
                                    </button>
                                </nav>
                            </div>
                        </div>
                        <div class="chat-tab-panels" data-role="page2-panels">
                            <section class="chat-tab-panel active" data-panel="chat-page">
                                <div class="chat-tab-panel__header" data-role="tab-header"></div>
                                <div class="chat-tab-panel__content" data-role="tab-content"></div>
                            </section>
                            <section class="chat-tab-panel" data-panel="definition">
                                <div class="chat-tab-panel__header" data-role="tab-header"></div>
                                <div class="chat-tab-panel__content" data-role="tab-content"></div>
                            </section>
                            <section class="chat-tab-panel" data-panel="settings">
                                <div class="chat-tab-panel__header" data-role="tab-header"></div>
                                <div class="chat-tab-panel__content" data-role="tab-content"></div>
                            </section>
                        </div>
                    </div>
                </div>
            `;

            this.page1TabBar = this.container.querySelector('[data-role="page1-tabs"]');
            this.page2TabBar = this.container.querySelector('[data-role="page2-tabs"]');
            this.page2TabMenuButton = this.container.querySelector('[data-role="page2-tab-menu"]');
            this.pageTitleElement = this.container.querySelector('[data-role="page2-title"]');
            this.page2IdentityElement = this.container.querySelector('[data-role="page2-identity"]');
            this.page2ActionMenu = this.container.querySelector('[data-role="page2-action-menu"]');
            this.pageAvatarElement = this.container.querySelector('[data-role="page2-avatar"]');
            this.pageAvatarImage = this.container.querySelector('[data-role="page2-avatar-img"]');
            this.pageAvatarFallback = this.container.querySelector('[data-role="page2-avatar-fallback"]');
            this._applyPage2Identity({
                displayName: "Chat",
                avatarUrl: null,
            });
            const backButton = this.container.querySelector('[data-action="go-page1"]');
            if (backButton) {
                const backHandler = () => this.showPage1();
                backButton.addEventListener("click", backHandler);
                this._cleanupFns.push(() => backButton.removeEventListener("click", backHandler));
            }

            if (this.page2TabMenuButton && this.page2TabBar) {
                const toggleMenu = (event) => {
                    event.preventDefault();
                    this._togglePage2Menu();
                };
                const handleOutsidePointer = (event) => {
                    if (!this.page2TabBar.classList.contains("is-open")) {
                        return;
                    }
                    if (this.page2TabMenuButton.contains(event.target)) {
                        return;
                    }
                    if (this.page2TabBar.contains(event.target)) {
                        return;
                    }
                    this._closePage2Menu();
                };
                const handleEscape = (event) => {
                    if (event.key === "Escape" && this.page2TabBar.classList.contains("is-open")) {
                        this._closePage2Menu();
                        this.page2TabMenuButton.focus();
                    }
                };

                this.page2TabMenuButton.addEventListener("click", toggleMenu);
                document.addEventListener("pointerdown", handleOutsidePointer);
                document.addEventListener("keydown", handleEscape);

                this._cleanupFns.push(() => this.page2TabMenuButton.removeEventListener("click", toggleMenu));
                this._cleanupFns.push(() => document.removeEventListener("pointerdown", handleOutsidePointer));
                this._cleanupFns.push(() => document.removeEventListener("keydown", handleEscape));
            }

            // Identity action menu: open when clicking the identity area
            if (this.page2IdentityElement && this.page2ActionMenu) {
                const identityClick = (event) => {
                    // Avoid toggling if clicking on a button inside the menu
                    const isActionButton = event.target.closest('[data-role="page2-action-menu"]');
                    if (isActionButton) return;
                    event.preventDefault();
                    this._toggleActionMenu();
                };
                const handleActionClick = async (event) => {
                    const button = event.target.closest('[data-action]');
                    if (!button) return;
                    const action = button.getAttribute('data-action');
                    const characterId = this.store.state.activeCharacterId;
                    if (!characterId) return;
                    try {
                        if (action === 'new-chat') {
                            await this.store.createNewChatSession(characterId);
                            this.switchPage2Tab('chat-page', { requireSelection: false });
                        } else if (action === 'remove-chat') {
                            const sessionId = this.store.state.activeSessionId;
                            await this.api.deleteSession(characterId, sessionId);
                            await this.store.refreshSessions();
                            // If you removed the active chat session, deselect and go back to chat list
                            if (this.store.state.activeCharacterId === characterId) {
                                // Clear selection if that session was active
                                await this.store.selectCharacter(null);
                                this.showPage1();
                                this.switchPage1Tab('chat-list');
                            }
                        } else if (action === 'view-avatar') {
                            const avatarUrl = this.pageAvatarImage?.getAttribute('src');
                            if (avatarUrl && window.Yuuka?.plugins?.simpleViewer?.open) {
                                window.Yuuka.plugins.simpleViewer.open({
                                    items: [{ id: 'character-avatar', imageUrl: avatarUrl }],
                                    startIndex: 0,
                                });
                            } else if (avatarUrl) {
                                // Fallback: open in a new tab
                                window.open(avatarUrl, '_blank', 'noopener');
                            }
                        }
                    } catch (err) {
                        if (typeof window.showError === 'function') {
                            window.showError(err?.message || 'Action failed');
                        }
                    } finally {
                        this._closeActionMenu();
                    }
                };
                const handleOutsidePointerActions = (event) => {
                    if (this.page2ActionMenu.hasAttribute('hidden')) return;
                    if (this.page2IdentityElement.contains(event.target)) return;
                    this._closeActionMenu();
                };
                const handleEscapeActions = (event) => {
                    if (event.key === 'Escape' && !this.page2ActionMenu.hasAttribute('hidden')) {
                        this._closeActionMenu();
                    }
                };

                this.page2IdentityElement.addEventListener('click', identityClick);
                this.page2ActionMenu.addEventListener('click', handleActionClick);
                document.addEventListener('pointerdown', handleOutsidePointerActions);
                document.addEventListener('keydown', handleEscapeActions);

                this._cleanupFns.push(() => this.page2IdentityElement.removeEventListener('click', identityClick));
                this._cleanupFns.push(() => this.page2ActionMenu.removeEventListener('click', handleActionClick));
                this._cleanupFns.push(() => document.removeEventListener('pointerdown', handleOutsidePointerActions));
                this._cleanupFns.push(() => document.removeEventListener('keydown', handleEscapeActions));
            }

            this.page1TabBar.addEventListener("click", (event) => {
                const target = event.target.closest("[data-tab]");
                if (target) {
                    this.switchPage1Tab(target.getAttribute("data-tab"));
                }
            });

            this.page2TabBar.addEventListener("click", (event) => {
                const target = event.target.closest("[data-tab]");
                if (target) {
                    this.switchPage2Tab(target.getAttribute("data-tab"));
                    this._closePage2Menu();
                }
            });
        }

        _instantiateTabs() {
            const characterListContainer = this.container.querySelector('[data-page="page1"] [data-panel="character-list"]');
            const chatListContainer = this.container.querySelector('[data-page="page1"] [data-panel="chat-list"]');
            const chatPageContainer = this.container.querySelector('[data-page="page2"] [data-panel="chat-page"]');
            const definitionContainer = this.container.querySelector('[data-page="page2"] [data-panel="definition"]');
            const settingsContainer = this.container.querySelector('[data-page="page2"] [data-panel="settings"]');

            this.characterListTab = new CharacterListTab(this.store, {
                onSelect: (characterId) => {
                    this.store.selectCharacter(characterId);
                    this.switchPage1Tab("chat-list");
                    this.switchPage2Tab("chat-page", { requireSelection: false });
                },
                onCreate: () => this._handleCreateCharacter(),
            });
            this.characterListTab.mount(characterListContainer);
            this.page1Tabs.set("character-list", { instance: this.characterListTab, container: characterListContainer });

            this.chatListTab = new ChatListTab(this.store, {
                onSelect: (characterId, sessionId) => {
                    this.store.selectCharacter(characterId, sessionId);
                    this.switchPage2Tab("chat-page", { requireSelection: false });
                },
            });
            this.chatListTab.mount(chatListContainer);
            this.page1Tabs.set("chat-list", { instance: this.chatListTab, container: chatListContainer });

            this.chatPageTab = new ChatPageTab(this.store);
            this.chatPageTab.mount(chatPageContainer);
            this.page2Tabs.set("chat-page", { instance: this.chatPageTab, container: chatPageContainer });
            if (typeof this.chatPageTab.setPageActive === "function") {
                this.chatPageTab.setPageActive(this._activePage === "page2");
            }
            if (typeof this.chatPageTab.setTabActive === "function") {
                this.chatPageTab.setTabActive(this._activePage2Tab === "chat-page");
            }

            this.definitionTab = new CharacterDefinitionTab(this.store);
            this.definitionTab.mount(definitionContainer);
            this.page2Tabs.set("definition", { instance: this.definitionTab, container: definitionContainer });

            this.settingsTab = new GenerationSettingsTab(this.store);
            this.settingsTab.mount(settingsContainer);
            this.page2Tabs.set("settings", { instance: this.settingsTab, container: settingsContainer });

            const unsubscribeActiveCharacter = this.store.on("active-character", (event) => {
                const detail = event.detail || {};
                const definition = detail.definition || {};
                const displayName = definition.display_name || definition.name || (this._creatingNew ? "New Character" : "Chat");
                this._applyPage2Identity({
                    displayName: displayName || "Chat",
                    avatarUrl: definition.avatar || null,
                });
                if (detail.characterId) {
                    this.showPage2(true);
                } else if (this._creatingNew) {
                    this.showPage2(true);
                    this.switchPage2Tab("definition", { requireSelection: false });
                } else {
                    this.showPage1();
                }
                if (!detail.characterId && !this._creatingNew && this.definitionTab && typeof this.definitionTab.prepareNewDefinition === "function") {
                    // ensure form cleared when no character selected (e.g., deleted)
                    this.definitionTab.prepareNewDefinition();
                }
            });
            this._cleanupFns.push(unsubscribeActiveCharacter);
        }

        switchPage1Tab(tabId) {
            if (!this.page1Tabs.has(tabId) || this._activePage1Tab === tabId) {
                return;
            }
            this._activePage1Tab = tabId;
            this.page1Tabs.forEach(({ container }, id) => {
                container.classList.toggle("active", id === tabId);
            });
            this.page1TabBar.querySelectorAll("[data-tab]").forEach(button => {
                button.classList.toggle("active", button.getAttribute("data-tab") === tabId);
            });
        }

        switchPage2Tab(tabId, options = {}) {
            if (!this.page2Tabs.has(tabId)) {
                return;
            }
            const requireSelection = options.requireSelection !== false;
            if (requireSelection) {
                if (!this.showPage2()) {
                    return;
                }
            } else {
                this.showPage2(true);
            }

            if (this._activePage2Tab === tabId) {
                return;
            }
            this._activePage2Tab = tabId;
            this.page2Tabs.forEach(({ container, instance }, id) => {
                const isActive = id === tabId;
                container.classList.toggle("active", isActive);
                if (instance && typeof instance.setTabActive === "function") {
                    instance.setTabActive(isActive);
                }
            });
            this.page2TabBar.querySelectorAll("[data-tab]").forEach(button => {
                button.classList.toggle("active", button.getAttribute("data-tab") === tabId);
            });
            this._closePage2Menu();
        }

        _applyPage2Identity(identity = {}) {
            const displayName = identity.displayName || "Chat";
            if (this.pageTitleElement) {
                this.pageTitleElement.textContent = displayName;
            }

            if (!this.pageAvatarElement) {
                return;
            }

            const avatarUrl = identity.avatarUrl || null;
            if (this.pageAvatarImage) {
                this.pageAvatarImage.onerror = () => {
                    this.pageAvatarImage.removeAttribute("src");
                    this.pageAvatarImage.alt = "";
                    this.pageAvatarImage.setAttribute("hidden", "true");
                    if (this.pageAvatarFallback) {
                        this.pageAvatarFallback.removeAttribute("hidden");
                    }
                    this.pageAvatarElement.dataset.hasImage = "false";
                };
                if (avatarUrl) {
                    this.pageAvatarImage.src = avatarUrl;
                    this.pageAvatarImage.alt = displayName ? `${displayName} avatar` : "Character avatar";
                    this.pageAvatarImage.removeAttribute("hidden");
                } else {
                    this.pageAvatarImage.removeAttribute("src");
                    this.pageAvatarImage.alt = "";
                    this.pageAvatarImage.setAttribute("hidden", "true");
                }
            }

            if (this.pageAvatarFallback) {
                if (avatarUrl) {
                    this.pageAvatarFallback.setAttribute("hidden", "true");
                } else {
                    this.pageAvatarFallback.removeAttribute("hidden");
                }
            }

            this.pageAvatarElement.dataset.hasImage = avatarUrl ? "true" : "false";
        }

        _togglePage2Menu(force) {
            if (!this.page2TabBar || !this.page2TabMenuButton) {
                return;
            }
            const shouldOpen = typeof force === "boolean"
                ? force
                : !this.page2TabBar.classList.contains("is-open");
            this.page2TabBar.classList.toggle("is-open", shouldOpen);
            this.page2TabMenuButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
        }

        _closePage2Menu() {
            this._togglePage2Menu(false);
        }

        _toggleActionMenu(force) {
            if (!this.page2ActionMenu) return;
            const shouldOpen = typeof force === 'boolean' ? force : this.page2ActionMenu.hasAttribute('hidden');
            if (shouldOpen) {
                this.page2ActionMenu.removeAttribute('hidden');
            } else {
                this.page2ActionMenu.setAttribute('hidden', '');
            }
        }

        _closeActionMenu() {
            this._toggleActionMenu(false);
        }

        _setActivePage(page) {
            if (this._activePage === page) return;
            this._activePage = page;
            this.container.querySelectorAll(".chat-page-wrapper").forEach(wrapper => {
                wrapper.classList.toggle("active", wrapper.getAttribute("data-page") === page);
            });
            if (page !== "page2") {
                this._closePage2Menu();
            }
            if (this.chatPageTab && typeof this.chatPageTab.setPageActive === "function") {
                this.chatPageTab.setPageActive(page === "page2");
            }
        }

        showPage1() {
            if (this._activePage !== "page1") {
                this._setActivePage("page1");
            }
        }

        showPage2(force = false) {
            if (!force && !this.store.state.activeCharacterId) {
                if (typeof window.showError === "function") {
                    window.showError("Vui lòng chọn nhân vật trước.");
                }
                return false;
            }
            this._setActivePage("page2");
            return true;
        }

        _registerNavButtons() {
            const attempt = () => {
                const navibar = global.Yuuka?.services?.navibar;
                if (!navibar) {
                    setTimeout(attempt, 500);
                    return;
                }

                navibar.registerButton({
                    id: "chat-tools-definition",
                    type: "tools",
                    pluginId: "chat",
                    order: 10,
                    icon: "settings_heart",
                    title: "Character definition",
                    isActive: () => this._activePage2Tab === "definition" && this._activePage === "page2",
                    onClick: () => this.switchPage2Tab("definition"),
                });

                navibar.registerButton({
                    id: "chat-tools-apps",
                    type: "tools",
                    pluginId: "chat",
                    order: 20,
                    icon: "apps",
                    title: "Chat list",
                    isActive: () => this._activePage1Tab === "chat-list" && this._activePage === "page1",
                    onClick: () => {
                        this.showPage1();
                        this.switchPage1Tab("chat-list");
                    },
                });

                if (typeof navibar.setActivePlugin === "function") {
                    navibar.setActivePlugin("chat");
                }
            };

            attempt();
        }
    }

    global.ChatComponent = ChatComponent;
    if (global.Yuuka && global.Yuuka.components) {
        global.Yuuka.components["ChatComponent"] = ChatComponent;
    }
})(window);
