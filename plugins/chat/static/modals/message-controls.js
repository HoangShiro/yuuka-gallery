(function registerMessageControlsModal(namespace) {
    class MessageControlsModal {
        constructor() {
            this.container = null;
        }

        ensureContainer() {
            if (this.container) return;
            const element = document.createElement("div");
            element.className = "chat-modal hidden";
            element.innerHTML = `
                <div class="chat-modal__overlay"></div>
                <div class="chat-modal__content">
                    <header class="chat-modal__header">
                        <h3>Message options</h3>
                        <button class="chat-btn chat-btn--ghost" data-action="close">
                        <span class="material-symbols-outlined">close</span>
                        </button>
                    </header>
                    <div class="chat-modal__body" data-role="modal-body"></div>
                </div>
            `;
            document.body.appendChild(element);
            element.querySelector('[data-action="close"]').addEventListener("click", () => this.close());
            element.querySelector(".chat-modal__overlay").addEventListener("click", () => this.close());
            this.container = element;
            this.body = element.querySelector('[data-role="modal-body"]');
        }

        open(options = {}) {
            this.ensureContainer();
            // Reset variant classes and apply if provided
            if (this.container) {
                this.container.classList.remove("chat-modal--edit");
                if (options.className) {
                    const classes = String(options.className).split(/\s+/).filter(Boolean);
                    this.container.classList.add(...classes);
                }
            }
            // Update title if provided
            const headerTitle = this.container?.querySelector(".chat-modal__header h3");
            if (headerTitle && options.title) {
                headerTitle.textContent = options.title;
            }
            this.body.innerHTML = options.body || "<p>Chức năng đang phát triển.</p>";
            this.container.classList.remove("hidden");
        }

        close() {
            if (this.container) {
                this.container.classList.add("hidden");
            }
        }
    }

    namespace.MessageControlsModal = MessageControlsModal;
})(window.Yuuka.plugins.chat.modals);
