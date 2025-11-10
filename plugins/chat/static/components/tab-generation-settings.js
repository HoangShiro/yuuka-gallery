// Rebuilt after corruption: full class definition restored with UI Settings integration.
(function registerGenerationSettingsTab(namespace) {
    class GenerationSettingsTab {
        constructor(store) {
            this.store = store;
            this._unsubscribers = [];
            this._MODEL_LS_PREFIX = 'yuuka-chat-model:';
            this.fields = {};
            this.form = null;
            this.modelOptions = null;
        }

        mount(container) {
            this.container = container;
            this.container.classList.add('chat-tab', 'chat-tab--settings');
            this.headerElement = this.container.querySelector('[data-role="tab-header"]');
            this.contentElement = this.container.querySelector('[data-role="tab-content"]') || this.container;
            if (this.headerElement) {
                this.headerElement.innerHTML = `
                    <header class="api-form__header">
                        <div class="api-form__header-main">
                            <h2 class="api-form__title">API Settings</h2>
                            <p class="chat-muted">Thiết lập chung về API model cho mọi phiên chat.</p>
                        </div>
                    </header>`;
            }
            this._ensureUiStylesheet();
            if (this.contentElement) {
                this.contentElement.innerHTML = `
                    <form class="api-form" data-role="settings-form">
                        <section class="api-form__section" data-group="api-core">
                            <h3 class="api-form__subtitle">Model & Provider</h3>
                            <label>Provider</label>
                            <select data-field="provider">
                                <option value="openai">OpenAI compatible</option>
                                <option value="gemini">Gemini</option>
                            </select>
                        </section>
                        <section class="api-form__section">
                            <label>API Key</label>
                            <input type="password" data-field="api-key" placeholder="sk-..." />
                        </section>
                        <section class="api-form__section">
                            <label>Model</label>
                            <select data-field="model"></select>
                            <p class="api-form__hint">Model mặc định áp dụng cho mọi cuộc hội thoại.</p>
                        </section>
                        <section class="api-form__section api-grid-2">
                            <div>
                                <label>Temperature</label>
                                <input type="number" step="0.1" min="0" max="2" data-field="temperature" />
                            </div>
                            <div>
                                <label>Max tokens</label>
                                <input type="number" min="1" data-field="max-tokens" />
                            </div>
                        </section>
                        <section class="api-form__section">
                            <label>System instruction</label>
                            <textarea rows="4" data-field="system-instruction" placeholder="Nhập hướng dẫn chung cho mọi cuộc chat."></textarea>
                            <p class="api-form__hint">Instruction này sẽ được thêm vào System prompt cho tất cả cuộc hội thoại.</p>
                        </section>
                        <hr class="api-form__divider" />
                        <section class="api-form__section" data-group="ui-settings">
                            <h3 class="api-form__subtitle">UI Settings</h3>
                            <div class="ui-preview" data-role="ui-preview">
                                <div class="ui-preview__bubble ui-preview__bubble--character" data-role="preview-character-bubble"></div>
                                <div class="ui-preview__bubble ui-preview__bubble--user" data-role="preview-user-bubble"></div>
                            </div>
                            <div class="ui-colors">
                                <label>Màu text hành động <input type="color" data-field="ui-color-action" /></label>
                                <label>Màu text lời nói <input type="color" data-field="ui-color-speech" /></label>
                                <label>Màu text dẫn chuyện <input type="color" data-field="ui-color-narration" /></label>
                                <label>Màu text in đậm <input type="color" data-field="ui-color-bold" /></label>
                                <label>Màu nền bubble chat <input type="color" data-field="ui-color-bubble" /></label>
                            </div>
                            <div class="ui-toggles">
                                <label class="toggle"><input type="checkbox" data-field="ui-auto-linebreak" /> Tự động xuống dòng lời nói nhân vật</label>
                                <label class="toggle"><input type="checkbox" data-field="ui-extra-spacing" /> Thêm khoảng cách giữa các đoạn</label>
                            </div>
                            <div class="api-form__actions-inline">
                                <button type="button" class="chat-btn chat-btn--reset" data-action="reset-ui">Reset UI Defaults</button>
                            </div>
                        </section>
                        <footer class="api-form__footer">
                            <button type="submit" class="chat-btn chat-btn--primary">
                                <span class="material-symbols-outlined">save</span>
                                Save settings
                            </button>
                        </footer>
                    </form>`;
            }
            this.form = this.contentElement ? this.contentElement.querySelector('[data-role="settings-form"]') : null;
            if (!this.form) return;
            this.fields = {
                provider: this.form.querySelector('[data-field="provider"]'),
                apiKey: this.form.querySelector('[data-field="api-key"]'),
                model: this.form.querySelector('[data-field="model"]'),
                temperature: this.form.querySelector('[data-field="temperature"]'),
                maxTokens: this.form.querySelector('[data-field="max-tokens"]'),
                systemInstruction: this.form.querySelector('[data-field="system-instruction"]'),
                uiColorAction: this.form.querySelector('[data-field="ui-color-action"]'),
                uiColorSpeech: this.form.querySelector('[data-field="ui-color-speech"]'),
                uiColorNarration: this.form.querySelector('[data-field="ui-color-narration"]'),
                uiColorBold: this.form.querySelector('[data-field="ui-color-bold"]'),
                uiColorBubble: this.form.querySelector('[data-field="ui-color-bubble"]'),
                uiAutoLinebreak: this.form.querySelector('[data-field="ui-auto-linebreak"]'),
                uiExtraSpacing: this.form.querySelector('[data-field="ui-extra-spacing"]'),
                uiPreviewCharacterBubble: this.form.querySelector('[data-role="preview-character-bubble"]'),
                uiPreviewUserBubble: this.form.querySelector('[data-role="preview-user-bubble"]'),
            };
            this.modelOptions = this.fields.model;
            this.form.addEventListener('submit', e => { e.preventDefault(); this._handleSubmit(); });
            const resetBtn = this.form.querySelector('[data-action="reset-ui"]');
            if (resetBtn) resetBtn.addEventListener('click', () => this._resetUiDefaults());
            this.fields.provider.addEventListener('change', () => {
                const newProvider = (this.fields.provider.value || 'openai').toLowerCase();
                const persisted = this._loadPersistedModel(newProvider);
                this.fields.model.value = persisted || '';
                this._fetchModels();
            });
            this.fields.apiKey.addEventListener('change', () => this._fetchModels());
            this.fields.apiKey.addEventListener('blur', () => this._fetchModels());
            this.fields.model.addEventListener('change', () => this._persistModelSelection());
            this._unsubscribers.push(this.store.on('settings', evt => this._applySettings(evt.detail.settings)));
            this._attachUiPreviewListeners();
            this._applySettings(this.store.state.settings);
        }

        destroy() {
            this._unsubscribers.forEach(u => u());
            this._unsubscribers = [];
            if (this.headerElement) this.headerElement.innerHTML = '';
            if (this.contentElement) this.contentElement.innerHTML = '';
            this.form = null; this.fields = null; this.modelOptions = null; this.headerElement = null; this.contentElement = null;
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
            // UI settings defaults
            this.fields.uiColorAction.value = config.ui_color_action || "#6a5acd"; // slate blue
            this.fields.uiColorSpeech.value = config.ui_color_speech || "#222222";
            this.fields.uiColorNarration.value = config.ui_color_narration || "#444444";
            this.fields.uiColorBold.value = config.ui_color_bold || "#000000";
            this.fields.uiColorBubble.value = config.ui_color_bubble || "#f0f3f9";
            this.fields.uiAutoLinebreak.checked = Boolean(config.ui_auto_linebreak);
            this.fields.uiExtraSpacing.checked = Boolean(config.ui_extra_spacing);
            this._updateUiPreview();
            // Normalize legacy Gemini names like "models/gemini-2.5-pro" -> "gemini-2.5-pro"
            const provider = (config.provider || "openai").toLowerCase();
            if (provider === "gemini" && this.fields.model.value && this.fields.model.value.startsWith("models/")) {
                this.fields.model.value = this.fields.model.value.split("/").pop();
            }
            // Try to fetch models if we have enough info
            if (this.fields.apiKey.value) {
                this._fetchModels();
            }
            // Apply CSS variables globally
            this._applyUiCssVariables();
        }

        async _handleSubmit() {
            const payload = {
                provider: this.fields.provider.value,
                api_key: this.fields.apiKey.value.trim() || null,
                model: this.fields.model.value.trim(),
                temperature: Number(this.fields.temperature.value) || 0,
                max_tokens: Number(this.fields.maxTokens.value) || null,
                system_instruction: this.fields.systemInstruction.value || "",
                ui_color_action: this.fields.uiColorAction.value || null,
                ui_color_speech: this.fields.uiColorSpeech.value || null,
                ui_color_narration: this.fields.uiColorNarration.value || null,
                ui_color_bold: this.fields.uiColorBold.value || null,
                ui_color_bubble: this.fields.uiColorBubble.value || null,
                ui_auto_linebreak: this.fields.uiAutoLinebreak.checked || false,
                ui_extra_spacing: this.fields.uiExtraSpacing.checked || false,
            };

            await this.store.saveSettings(payload);
            alert("Đã lưu Generation Settings.");
            this._applyUiCssVariables();
        }

        async _fetchModels() {
            // Guard against async race after destroy
            if (!this || !this.fields || !this.form) return;
            const provider = this.fields?.provider?.value || "openai";
            const apiKey = (this.fields?.apiKey?.value || "").trim();
            try {
                const payload = { provider, api_key: apiKey || null };
                if (!this.store || !this.store.api || typeof this.store.api.getModels !== 'function') return;
                const response = await this.store.api.getModels(payload);
                const models = (response && response.models) || [];
                // Verify still mounted before touching DOM
                if (!this.fields || !this.form) return;
                this._populateModelOptions(models);
            } catch (err) {
                if (typeof console !== "undefined") {
                    console.warn("[GenerationSettingsTab] Failed to fetch models:", err);
                }
                if (this.fields && this.form) this._populateModelOptions([]);
            }
        }

        _populateModelOptions(models) {
            // Defensive: component may be destroyed or fields not yet wired
            if (!this || !this.fields || !this.modelOptions) return;
            const current = (this.fields.model?.value || "").trim();
            const provider = (this.fields.provider?.value || "openai").toLowerCase();
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
            let desired = current;
            const persisted = this._loadPersistedModel(provider);
            const hasCurrent = desired && ids.includes(desired);
            if (!hasCurrent) desired = persisted && ids.includes(persisted) ? persisted : (ids[0] || '');
            if (desired) {
                const opts = this.modelOptions.options ? Array.from(this.modelOptions.options) : [];
                const idx = opts.findIndex(o => o.value === desired);
                if (idx >= 0) this.modelOptions.selectedIndex = idx;
            }
            this.modelOptions.disabled = (this.modelOptions.options?.length || 0) === 0;
            this._persistModelSelection();
        }

        _lightenColor(hex, percent) {
            // hex expected format #rrggbb
            try {
                const clean = hex.replace('#','');
                if (clean.length !== 6) return hex;
                const num = parseInt(clean, 16);
                let r = (num >> 16) & 255;
                let g = (num >> 8) & 255;
                let b = num & 255;
                const adjust = (c) => Math.min(255, Math.round(c + (255 - c) * (percent/100)));
                r = adjust(r); g = adjust(g); b = adjust(b);
                const out = '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
                return out;
            } catch { return hex; }
        }

        _ensureUiStylesheet() {
            try {
                if (document.querySelector('link[data-ui-settings="true"]')) return;
                // Try to locate base path from an existing chat.css link
                const existing = document.querySelector('link[href*="plugins/chat/static/"]') || document.querySelector('link[href$="/chat.css"], link[href*="chat.css"]');
                let base = '/plugins/chat/static/';
                if (existing && existing.href) {
                    base = existing.href.replace(/[^\/]+$/, '');
                } else if (window.Yuuka?.plugins?.chat?.staticPath) {
                    base = String(window.Yuuka.plugins.chat.staticPath).replace(/[^\/]*$/, '');
                }
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = base + 'ui-settings.css';
                link.dataset.uiSettings = 'true';
                link.onerror = () => {
                    // Inline fallback if the file isn't served
                    this._injectUiInlineStylesheet();
                };
                document.head.appendChild(link);
            } catch { this._injectUiInlineStylesheet(); }
        }

        _injectUiInlineStylesheet() {
            try {
                if (document.getElementById('yuuka-ui-inline-css')) return;
                const style = document.createElement('style');
                style.id = 'yuuka-ui-inline-css';
                style.textContent = `:root{--yuuka-action-color:#6a5acd;--yuuka-speech-color:#222;--yuuka-narration-color:#444;--yuuka-bold-color:#000;--yuuka-bubble-color:#f0f3f9;--yuuka-bubble-character-color:#f6f9fd}.ui-preview{display:flex;flex-direction:column;gap:10px;margin:8px 0 16px}.ui-preview__bubble{background:var(--yuuka-bubble-color);padding:8px 10px;border-radius:12px;font-size:14px;line-height:1.4;color:var(--yuuka-narration-color);border:1px solid rgba(0,0,0,.04);box-shadow:0 2px 4px rgba(0,0,0,.06)}.ui-preview__bubble--character{background:var(--yuuka-bubble-character-color)}.chat-text--action{color:var(--yuuka-action-color);font-style:italic}.chat-text--speech{color:var(--yuuka-speech-color)}.chat-text--narration{color:var(--yuuka-narration-color)}.chat-text--bold{color:var(--yuuka-bold-color);font-weight:700}.chat-message__bubble p{white-space:pre-line}.chat-message__bubble .chat-text--action{font-style:italic}.chat-message__bubble .chat-text--bold{font-weight:700}.chat-message__bubble .chat-text--narration{color:var(--yuuka-narration-color)}.chat-message__bubble .chat-text--speech{color:var(--yuuka-speech-color)}.chat-message__bubble{background:var(--yuuka-bubble-color)!important;color:var(--yuuka-narration-color)!important}.chat-message--assistant .chat-message__bubble{background:var(--yuuka-bubble-character-color)!important}`;
                document.head.appendChild(style);
            } catch {}
        }

        _applyUiCssVariables() {
            try {
                const root = document.documentElement;
                const bubble = this.fields.uiColorBubble.value || '#f0f3f9';
                const lighten = this._lightenColor(bubble, 12);
                root.style.setProperty('--yuuka-action-color', this.fields.uiColorAction.value || '#6a5acd');
                root.style.setProperty('--yuuka-speech-color', this.fields.uiColorSpeech.value || '#222222');
                root.style.setProperty('--yuuka-narration-color', this.fields.uiColorNarration.value || '#444444');
                root.style.setProperty('--yuuka-bold-color', this.fields.uiColorBold.value || '#000000');
                root.style.setProperty('--yuuka-bubble-color', bubble);
                root.style.setProperty('--yuuka-bubble-character-color', lighten);
            } catch {}
        }

        _resetUiDefaults() {
            const defaults = {
                ui_color_action: '#6a5acd',
                ui_color_speech: '#222222',
                ui_color_narration: '#444444',
                ui_color_bold: '#000000',
                ui_color_bubble: '#f0f3f9',
                ui_auto_linebreak: false,
                ui_extra_spacing: false,
            };
            this.fields.uiColorAction.value = defaults.ui_color_action;
            this.fields.uiColorSpeech.value = defaults.ui_color_speech;
            this.fields.uiColorNarration.value = defaults.ui_color_narration;
            this.fields.uiColorBold.value = defaults.ui_color_bold;
            this.fields.uiColorBubble.value = defaults.ui_color_bubble;
            this.fields.uiAutoLinebreak.checked = defaults.ui_auto_linebreak;
            this.fields.uiExtraSpacing.checked = defaults.ui_extra_spacing;
            this._updateUiPreview();
        }

        _formatUiSample(text, isCharacter) {
            // Apply formatting similar to ChatPage messages
            const esc = (v) => this._escapeInline(v);
            let safe = esc(text);
            // Bold **text** (do not re-escape inner)
            safe = safe.replace(/\*\*(.+?)\*\*/g, (m, inner) => `<span class="chat-text--bold">${inner}</span>`);
            // Actions *...* (single asterisk) without showing asterisks
            safe = safe.replace(/(^|\s)\*(.*?)\*(?=\s|$)/g, (m, prefix, inner) => `${prefix}<span class="chat-text--action">${inner}</span>`);
            // Speech "...": support both escaped quotes and curly quotes
            safe = safe.replace(/&quot;([^<>&]+?)&quot;/g, (m, inner) => `<span class="chat-text--speech">"${inner}"</span>`);
            safe = safe.replace(/[“](.+?)[”]/g, (m, inner) => `<span class="chat-text--speech">“${inner}”</span>`);
            // Wrap remaining narration segments (rough heuristic: untagged plain text)
            safe = safe.replace(/(>)([^<]+)(?=<|$)/g, (m, gt, plain) => {
                if (/chat-text--(action|speech|bold)/.test(m)) return m;
                return `${gt}<span class="chat-text--narration">${plain}</span>`;
            });
            // If auto linebreak enabled, ensure speech starts new line after action
            if (this.fields.uiAutoLinebreak.checked) {
                safe = safe.replace(/(<span class=\"chat-text--action\">.*?<\/span>)(\s*)(<span class=\"chat-text--speech\">)/, (m,a,b,c)=> `${a}<br/>${c}`);
            }
            return safe;
        }

        _escapeInline(text) {
            return String(text)
                .replace(/&/g,'&amp;')
                .replace(/</g,'&lt;')
                .replace(/>/g,'&gt;')
                .replace(/"/g,'&quot;');
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

        // Attach listeners for UI preview fields (colors & toggles)
        _attachUiPreviewListeners() {
            const colorFields = [
                this.fields.uiColorAction,
                this.fields.uiColorSpeech,
                this.fields.uiColorNarration,
                this.fields.uiColorBold,
                this.fields.uiColorBubble
            ];
            const toggleFields = [
                this.fields.uiAutoLinebreak,
                this.fields.uiExtraSpacing
            ];
            const rerender = () => {
                this._applyUiCssVariables();
                this._updateUiPreview();
            };
            colorFields.forEach(el => { if (el) el.addEventListener('input', rerender); });
            toggleFields.forEach(el => { if (el) el.addEventListener('change', rerender); });
        }

        // Update the small preview bubbles to reflect current settings
        _updateUiPreview() {
            try {
                const characterBubble = this.fields.uiPreviewCharacterBubble;
                const userBubble = this.fields.uiPreviewUserBubble;
                if (!characterBubble || !userBubble) return;
                const sampleCharacter = '*mỉm cười* "Xin chào, mình có thể giúp gì?" **Bold** câu chuyện tiếp tục.';
                const sampleUser = '"Cho mình xem ví dụ khác" *gõ nhẹ bàn phím*';
                characterBubble.innerHTML = this._formatUiSample(sampleCharacter, true);
                userBubble.innerHTML = this._formatUiSample(sampleUser, false);
                // Extra spacing toggle demonstration
                const extra = this.fields.uiExtraSpacing?.checked;
                characterBubble.style.marginBottom = extra ? '14px' : '6px';
            } catch {}
        }
    }
    namespace.GenerationSettingsTab = GenerationSettingsTab;
})(window.Yuuka.plugins.chat.components);
