(function registerCharacterListTab(namespace) {
    class CharacterListTab {
        constructor(store, options = {}) {
            this.store = store;
            this.onSelect = options.onSelect || (() => {});
            this.onCreate = options.onCreate || (() => {});
            this._unsubscribers = [];
        }

        mount(container) {
            this.container = container;
            this.container.classList.add("chat-tab", "chat-tab--character-list");
            this.headerElement = this.container.querySelector('[data-role="tab-header"]');
            this.contentElement = this.container.querySelector('[data-role="tab-content"]') || this.container;

            if (this.headerElement) {
                this.headerElement.innerHTML = `
                    <div class="chat-tab-header">
                        <h2>Characters</h2>
                        <button class="chat-btn chat-btn--primary" data-action="create-character">
                            <span class="material-symbols-outlined">add</span>
                            New Character
                        </button>
                    </div>
                `;
                const createButton = this.headerElement.querySelector('[data-action="create-character"]');
                if (createButton) {
                    createButton.addEventListener("click", () => this.onCreate());
                }
            }

            this.contentElement.innerHTML = `
                <div class="chat-empty-container" data-role="empty-container">
                    <div class="chat-empty-state">
                        <span class="material-symbols-outlined">person_add</span>
                        <p>No characters yet. Use "New Character" to get started.</p>
                    </div>
                </div>
                <div class="chat-grid" data-role="character-grid"></div>
            `;
            this.gridElement = this.contentElement.querySelector('[data-role="character-grid"]');
            this.emptyContainer = this.contentElement.querySelector('[data-role="empty-container"]');

            this._unsubscribers.push(
                this.store.on("characters", (event) => this._renderCards(event.detail.characters))
            );
            this._renderCards(this.store.state.characters);
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
            this.gridElement = null;
            this.emptyContainer = null;
        }

        _renderCards(characters) {
            if (!this.gridElement) return;
            const items = characters || [];
            if (typeof console !== "undefined") {
                console.debug("[CharacterListTab] Rendering character cards:", items.length);
            }

            if (items.length === 0) {
                this.gridElement.innerHTML = "";
                this.gridElement.classList.add("is-hidden");
                if (this.emptyContainer) {
                    this.emptyContainer.classList.add("is-active");
                }
                console.debug("[CharacterListTab] Grid state: hidden");
                return;
            }

            if (this.emptyContainer) {
                this.emptyContainer.classList.remove("is-active");
            }
            this.gridElement.classList.remove("is-hidden");

            this.gridElement.innerHTML = items.map(character => `
                <div class="chat-card" data-character-id="${character.id || ""}">
                    <div class="chat-card-avatar">
                        ${character.avatar ? `<img src="${character.avatar}" alt="${character.display_name || character.id}">`
                            : `<div class="chat-card-avatar__fallback"><span class="material-symbols-outlined">face</span></div>`}
                    </div>
                    <div class="chat-card-body">
                        <div class="chat-card-title">${character.display_name || "Unnamed Character"}</div>
                    </div>
                </div>
            `).join("");

            this.gridElement.querySelectorAll(".chat-card[data-character-id]").forEach(card => {
                card.addEventListener("click", () => {
                    const characterId = card.getAttribute("data-character-id");
                    this.onSelect(characterId);
                });
            });
            console.debug("[CharacterListTab] Grid HTML:", this.gridElement.innerHTML);
        }
    }

    namespace.CharacterListTab = CharacterListTab;
})(window.Yuuka.plugins.chat.components);
