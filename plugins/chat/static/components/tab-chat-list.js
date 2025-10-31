(function registerChatListTab(namespace) {
    class ChatListTab {
        constructor(store, options = {}) {
            this.store = store;
            this.onSelect = options.onSelect || (() => {});
            this._unsubscribers = [];
        }

        mount(container) {
            this.container = container;
            this.container.classList.add("chat-tab", "chat-tab--chat-list");
            this.headerElement = this.container.querySelector('[data-role="tab-header"]');
            this.contentElement = this.container.querySelector('[data-role="tab-content"]') || this.container;

            if (this.headerElement) {
                this.headerElement.innerHTML = `
                    <div class="chat-tab-header">
                        <h2>Recent chats</h2>
                        <p class="chat-muted">Conversations are ordered from newest to oldest.</p>
                    </div>
                `;
            }

            if (this.contentElement) {
                this.contentElement.innerHTML = `
                    <div class="chat-session-list" data-role="session-list"></div>
                `;
                this.listElement = this.contentElement.querySelector('[data-role="session-list"]');
            }

            this._unsubscribers.push(
                this.store.on("sessions", (event) => this._renderSessions(event.detail.sessions))
            );
            this._renderSessions(this.store.state.sessions);
        }

        destroy() {
            this._unsubscribers.forEach(unsub => unsub());
            this._unsubscribers = [];
            if (this.headerElement) {
                this.headerElement.innerHTML = "";
            }
            if (this.contentElement) {
                this.contentElement.innerHTML = "";
            }
            this.headerElement = null;
            this.contentElement = null;
            this.listElement = null;
        }

        _renderSessions(sessions) {
            if (!this.listElement) return;
            const items = sessions || [];
            if (typeof console !== "undefined") {
                console.debug("[ChatListTab] Rendering chat sessions:", items.length);
            }
            if (items.length === 0) {
                this.listElement.innerHTML = `
                    <div class="chat-empty-state">
                        <span class="material-symbols-outlined">chat_bubble_outline</span>
                        <p>No conversations yet.</p>
                    </div>
                `;
                console.debug("[ChatListTab] List state: empty placeholder rendered");
                return;
            }

            this.listElement.innerHTML = items.map(session => `
                <div class="chat-session-item" data-character-id="${session.character_id}" data-session-id="${session.session_id ?? ''}">
                    <div class="chat-session-avatar">
                        ${session.avatar ? `<img src="${session.avatar}" alt="${session.display_name || ""}">`
                            : `<div class="chat-session-avatar__fallback"><span class="material-symbols-outlined">account_circle</span></div>`}
                    </div>
                    <div class="chat-session-meta">
                        <div class="chat-session-header">
                            <div class="chat-session-title">${session.display_name || "Unnamed"}</div>
                            <div class="chat-session-time">${session.updated_at ? new Date(session.updated_at * 1000).toLocaleString() : ""}</div>
                        </div>
                        <div class="chat-session-preview">${session.last_message?.content?.text || "No messages yet."}</div>
                    </div>
                </div>
            `).join("");

            this.listElement.querySelectorAll(".chat-session-item").forEach(item => {
                item.addEventListener("click", () => {
                    const characterId = item.getAttribute("data-character-id");
                    const sessionId = item.getAttribute("data-session-id") || null;
                    this.onSelect(characterId, sessionId);
                });
            });
            console.debug("[ChatListTab] List HTML:", this.listElement.innerHTML);
        }
    }

    namespace.ChatListTab = ChatListTab;
})(window.Yuuka.plugins.chat.components);
