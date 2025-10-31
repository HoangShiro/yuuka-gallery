(function registerGenerationSettingsTab(namespace) {
    class GenerationSettingsTab {
        constructor(store) {
            this.store = store;
            this._unsubscribers = [];
            this._MODEL_LS_PREFIX = "yuuka-chat-model:";
        }

        mount(container) {
            this.container = container;
            this.container.classList.add("chat-tab", "chat-tab--settings");
            this.headerElement = this.container.querySelector('[data-role="tab-header"]');
            this.contentElement = this.container.querySelector('[data-role="tab-content"]') || this.container;

            if (this.headerElement) {
                this.headerElement.innerHTML = `
                    <header class="chat-form__header">
                        <div class="chat-form__header-main">
                            <h2>Generation Settings</h2>
                            <p class="chat-muted">Configure shared generation settings for all chats.</p>
                        </div>
                    </header>
                `;
            }

            if (this.contentElement) {
                this.contentElement.innerHTML = `
                    <form class="chat-form" data-role="settings-form">
                        <section class="chat-form__section">
                            <label>Provider</label>
                            <select data-field="provider">
                                <option value="openai">OpenAI compatible</option>
                                <option value="gemini">Gemini</option>
                            </select>
                        </section>
                        <section class="chat-form__section">
                            <label>API Key</label>
                            <input type="password" data-field="api-key" placeholder="sk-...">
                        </section>
                        <section class="chat-form__section">
                            <label>Model</label>
                            <select data-field="model"></select>
                            <p class="chat-form__hint">Default model applied across all conversations.</p>
                        </section>
                        <section class="chat-form__section chat-grid-2">
                            <div>
                                <label>Temperature</label>
                                <input type="number" step="0.1" min="0" max="2" data-field="temperature">
                            </div>
                            <div>
                                <label>Max tokens</label>
                                <input type="number" min="1" data-field="max-tokens">
                            </div>
                        </section>
                        <section class="chat-form__section">
                            <label>System instruction</label>
                            <textarea rows="4" data-field="system-instruction" placeholder="Write a concise, global instruction that will be prepended to the system prompt. For example: 'Keep replies under 80 words and avoid spoilers.'"></textarea>
                            <p class="chat-form__hint">Instruction này sẽ được thêm vào phần System prompt cho tất cả cuộc hội thoại.</p>
                        </section>
                        <footer class="chat-form__footer">
                            <button type="submit" class="chat-btn chat-btn--primary">
                                <span class="material-symbols-outlined">save</span>
                                Save settings
                            </button>
                        </footer>
                    </form>
                `;
            }

            this.form = this.contentElement ? this.contentElement.querySelector('[data-role="settings-form"]') : null;
            if (!this.form) {
                return;
            }

            this.fields = {
                provider: this.form.querySelector('[data-field="provider"]'),
                apiKey: this.form.querySelector('[data-field="api-key"]'),
                model: this.form.querySelector('[data-field="model"]'),
                temperature: this.form.querySelector('[data-field="temperature"]'),
                maxTokens: this.form.querySelector('[data-field="max-tokens"]'),
                systemInstruction: this.form.querySelector('[data-field="system-instruction"]'),
            };
            this.modelOptions = this.fields.model; // now a <select>

            this.form.addEventListener("submit", (event) => {
                event.preventDefault();
                this._handleSubmit();
            });

            // Auto-fetch models when provider/API key change
            this.fields.provider.addEventListener("change", () => {
                // Preselect persisted model for the new provider before fetching options
                const newProvider = (this.fields.provider.value || "openai").toLowerCase();
                const persisted = this._loadPersistedModel(newProvider);
                if (persisted) {
                    this.fields.model.value = persisted;
                } else {
                    this.fields.model.value = "";
                }
                this._fetchModels();
            });
            this.fields.apiKey.addEventListener("change", () => this._fetchModels());
            this.fields.apiKey.addEventListener("blur", () => this._fetchModels());
            // Persist model selection locally whenever it changes
            this.fields.model.addEventListener("change", () => {
                this._persistModelSelection();
            });

            this._unsubscribers.push(
                this.store.on("settings", (event) => this._applySettings(event.detail.settings))
            );
            this._applySettings(this.store.state.settings);
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
            this.form = null;
            this.fields = null;
            this.headerElement = null;
            this.contentElement = null;
        }

        _applySettings(settings) {
            const config = settings || {};
            this.fields.provider.value = config.provider || "openai";
            this.fields.apiKey.value = config.api_key || "";
            // Prefer server-configured model; fallback to locally persisted selection
            const providerNow = (config.provider || "openai").toLowerCase();
            const persisted = this._loadPersistedModel(providerNow);
            // Prefer the last locally chosen model over server value
            this.fields.model.value = (persisted || config.model || "");
            this.fields.temperature.value = config.temperature ?? 0.7;
            this.fields.maxTokens.value = config.max_tokens ?? 1024;
            this.fields.systemInstruction.value = (config.system_instruction || "");
            // Normalize legacy Gemini names like "models/gemini-2.5-pro" -> "gemini-2.5-pro"
            const provider = (config.provider || "openai").toLowerCase();
            if (provider === "gemini" && this.fields.model.value && this.fields.model.value.startsWith("models/")) {
                this.fields.model.value = this.fields.model.value.split("/").pop();
            }
            // Try to fetch models if we have enough info
            if (this.fields.apiKey.value) {
                this._fetchModels();
            }
        }

        async _handleSubmit() {
            const payload = {
                provider: this.fields.provider.value,
                api_key: this.fields.apiKey.value.trim() || null,
                model: this.fields.model.value.trim(),
                temperature: Number(this.fields.temperature.value) || 0,
                max_tokens: Number(this.fields.maxTokens.value) || null,
                system_instruction: this.fields.systemInstruction.value || "",
            };

            await this.store.saveSettings(payload);
            alert("Đã lưu Generation Settings.");
        }

        async _fetchModels() {
            const provider = this.fields.provider.value || "openai";
            const apiKey = (this.fields.apiKey.value || "").trim();
            try {
                const payload = { provider, api_key: apiKey || null };
                const response = await this.store.api.getModels(payload);
                const models = (response && response.models) || [];
                this._populateModelOptions(models);
            } catch (err) {
                if (typeof console !== "undefined") {
                    console.warn("[GenerationSettingsTab] Failed to fetch models:", err);
                }
                this._populateModelOptions([]);
            }
        }

        _populateModelOptions(models) {
            if (!this.modelOptions) return;
            const current = (this.fields.model.value || "").trim();
            const provider = (this.fields.provider.value || "openai").toLowerCase();
            // Sort by id for stable ordering
            const items = Array.isArray(models) ? [...models] : [];
            items.sort((a, b) => String(a.id || a.name || "").localeCompare(String(b.id || b.name || "")));
            // Reset options
            this.modelOptions.innerHTML = "";
            // Populate
            const ids = [];
            for (const m of items) {
                const id = m.id || m.name || "";
                ids.push(id);
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = m.owned_by ? `${id} — ${m.owned_by}` : id;
                this.modelOptions.appendChild(opt);
            }
            // Decide desired selection deterministically
            let desired = current;
            const persisted = this._loadPersistedModel(provider);
            const hasCurrent = desired && ids.includes(desired);
            if (!hasCurrent) {
                desired = persisted && ids.includes(persisted) ? persisted : (ids[0] || "");
            }
            if (desired) {
                const matchIndex = Array.from(this.modelOptions.options).findIndex(o => o.value === desired);
                if (matchIndex >= 0) {
                    this.modelOptions.selectedIndex = matchIndex;
                }
            }
            // Disable when empty to prevent picking an invalid value
            this.modelOptions.disabled = this.modelOptions.options.length === 0;
            // Persist the resolved selection so it's restored on next load
            this._persistModelSelection();
        }

        _persistModelSelection() {
            try {
                const provider = (this.fields.provider.value || "openai").toLowerCase();
                const model = (this.fields.model.value || "").trim();
                if (!provider) return;
                const key = `${this._MODEL_LS_PREFIX}${provider}`;
                if (model) {
                    localStorage.setItem(key, model);
                } else {
                    localStorage.removeItem(key);
                }
            } catch (err) {
                // localStorage might be unavailable; ignore
            }
        }

        _loadPersistedModel(provider) {
            try {
                const key = `${this._MODEL_LS_PREFIX}${provider}`;
                return localStorage.getItem(key) || "";
            } catch (err) {
                return "";
            }
        }
    }

    namespace.GenerationSettingsTab = GenerationSettingsTab;
})(window.Yuuka.plugins.chat.components);
