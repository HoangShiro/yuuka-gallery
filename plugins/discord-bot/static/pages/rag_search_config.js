window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['rag-search-config'] = {
    _saveTimer: null,
    _savedStatusTimer: null,

    _setSaveStatus: function(dashboard, status, text) {
        const statusEl = dashboard?.modulePageBodyEl?.querySelector('[data-role="rag-api-key-save-status"]');
        if (!statusEl) {
            return;
        }
        statusEl.textContent = text || '';
        statusEl.style.color = status === 'saved'
            ? '#22c55e'
            : (status === 'saving' ? '#94a3b8' : '#ef4444');
        statusEl.style.opacity = text ? '1' : '0';
    },

    _showSaved: function(dashboard) {
        this._setSaveStatus(dashboard, 'saved', 'Saved');
        if (this._savedStatusTimer) {
            clearTimeout(this._savedStatusTimer);
        }
        this._savedStatusTimer = setTimeout(() => {
            this._setSaveStatus(dashboard, 'idle', '');
        }, 1500);
    },

    _scheduleSave: function(dashboard, delayMs) {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this._setSaveStatus(dashboard, 'saving', 'Saving...');
        this._saveTimer = setTimeout(async () => {
            this._saveTimer = null;
            const ok = await dashboard._saveBotConfiguration({
                extraProps: this._buildConfigProps(dashboard),
                showSuccessMessage: false,
            });
            if (ok) {
                this._showSaved(dashboard);
            } else {
                this._setSaveStatus(dashboard, 'error', 'Save failed');
            }
        }, Math.max(0, Number(delayMs) || 0));
    },

    render: function(dashboard, module, moduleUi) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>RAG Search</h4>
                    <p>Create or connect a bot first to configure Tavily search.</p>
                </section>
            `;
        }

        const apiKey = String(moduleUi.tavily_api_key || '');
        const maxResultsRaw = Number(moduleUi.tavily_max_results || 5);
        const maxResults = Number.isFinite(maxResultsRaw) ? Math.max(1, Math.min(10, Math.floor(maxResultsRaw))) : 5;

        return `
            <section class="discord-bot-module-page-section">
                <h4>Tavily Configuration</h4>
                <div class="discord-policy-settings">
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">API Key <span data-role="rag-api-key-save-status" style="margin-left: 8px; color: #22c55e; font-size: 0.85em; opacity: 0; transition: opacity 0.2s;">Saved</span></span>
                        <input
                            type="password"
                            class="discord-policy-setting__input"
                            data-role="rag-tavily-api-key"
                            value="${dashboard.Utils.escapeHtml(apiKey)}"
                            placeholder="tvly-..."
                            autocomplete="off"
                        />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Default max results</span>
                        <input
                            type="number"
                            min="1"
                            max="10"
                            class="discord-policy-setting__input"
                            data-role="rag-max-results"
                            value="${dashboard.Utils.escapeHtml(String(maxResults))}"
                        />
                    </label>
                </div>
                <p style="margin-top: var(--spacing-3); color: var(--color-secondary-text); font-size: 0.9em;">
                    This module enables <code>/search</code> slash command and the <code>rag_search_web</code> Brain tool.
                </p>
            </section>
        `;
    },

    _buildConfigProps: function(dashboard) {
        const apiKey = dashboard.modulePageBodyEl.querySelector('[data-role="rag-tavily-api-key"]')?.value || '';
        const maxInput = dashboard.modulePageBodyEl.querySelector('[data-role="rag-max-results"]')?.value || '5';
        const parsed = Number(maxInput);
        const maxResults = Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.floor(parsed))) : 5;
        return {
            tavily_api_key: apiKey.trim(),
            tavily_max_results: maxResults,
        };
    },

    onChange: async function(dashboard, event) {
        const input = event.target.closest('[data-role="rag-tavily-api-key"], [data-role="rag-max-results"]');
        if (!input || !dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }

        this._scheduleSave(dashboard, 0);
        return true;
    },

    onInput: async function(dashboard, event) {
        const input = event.target.closest('[data-role="rag-tavily-api-key"], [data-role="rag-max-results"]');
        if (!input || !dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }

        const isApiKeyInput = input.matches('[data-role="rag-tavily-api-key"]');
        this._scheduleSave(dashboard, isApiKeyInput ? 450 : 250);
        return true;
    }
};
