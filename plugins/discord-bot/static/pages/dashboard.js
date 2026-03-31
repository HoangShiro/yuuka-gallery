class DiscordBotDashboardPage {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.pluginApi = this.api['discord-bot'];

        this.state = {
            bots: [],
            activeBot: null,
            activeModulePage: null,
            moduleUiCache: {},
            moduleUiLoading: {},
            logs: [],
            lastSeq: 0,
            pendingStartSummary: null,
            pollingTimer: null,
            jsRuntimeAvailable: true,
            modules: [],
            isSubmitting: false,
            activeConsoleTab: 'log',
        };
        this._uptimeTimer = null;
        this._refreshTimeout = null;

        this._handleStartStop = this._handleStartStop.bind(this);
        this._handleStart = this._handleStart.bind(this);
        this._handleStop = this._handleStop.bind(this);
        this._handleRestart = this._handleRestart.bind(this);
        this._handleKill = this._handleKill.bind(this);
        this._handleFormSubmit = this._handleFormSubmit.bind(this);
        this._handleAutoScrollToggle = this._handleAutoScrollToggle.bind(this);
        this._handleModuleGridClick = this._handleModuleGridClick.bind(this);
        this._handleModuleGridChange = this._handleModuleGridChange.bind(this);
        this._handleModulePageBack = this._handleModulePageBack.bind(this);
        this._handleModulePageClick = this._handleModulePageClick.bind(this);
        this._handleModulePageChange = this._handleModulePageChange.bind(this);
        this._handleConsoleTabClick = this._handleConsoleTabClick.bind(this);
    }

    async init() {
        console.log("[Plugin:DiscordBot] Initializing dashboard...");
        this.container.classList.add('plugin-discord-bot');
        this._buildBaseLayout();
        await this.refreshBots();
        this._attachHandlers();
        this._startPolling();

        const navibar = window.Yuuka.services.navibar;
        if (navibar) {
            navibar.setActivePlugin('discord-bot');
        }
    }

    destroy() {
        this._stopPolling();
        if (this._uptimeTimer) {
            clearInterval(this._uptimeTimer);
            this._uptimeTimer = null;
        }
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }
        const navibar = window.Yuuka.services.navibar;
        if (navibar && navibar._activePluginId === 'discord-bot') {
            navibar.setActivePlugin(null);
        }
        this.container.innerHTML = '';
        this.container.classList.remove('plugin-discord-bot');
    }

    // --------------------------------------------------------------------- //
    // Layout & rendering
    // --------------------------------------------------------------------- //
    _buildBaseLayout() {
        this.container.innerHTML = `
            <div class="discord-bot-dashboard">
                <div class="discord-bot-row discord-bot-row--console">
                    <div class="discord-bot-console-card">
                        <div class="discord-bot-console-header">
                            <div class="discord-bot-console-title">
                                <span class="material-symbols-outlined" data-role="console-icon">terminal</span>
                                <span data-role="console-title">Bot console</span>
                            </div>
                            <div class="discord-bot-console-tabs" data-role="console-tabs" style="display: flex; gap: 8px; margin-left: 20px; align-items: center; justify-content: flex-start; flex: 1;">
                                <button class="discord-bot-btn discord-bot-btn--accent discord-bot-btn--sm" data-tab="log">Log</button>
                                <button class="discord-bot-btn discord-bot-btn--sm" data-tab="message">Message</button>
                            </div>
                            <label class="discord-bot-autoscroll">
                                <input type="checkbox" data-role="auto-scroll" checked />
                                <span>Auto scroll</span>
                            </label>
                        </div>
                        <div class="discord-bot-console-body active" data-role="console" data-view="log"></div>
                        <div class="discord-bot-console-body" data-role="console-message" data-view="message" hidden style="font-family: monospace; white-space: pre-wrap; font-size: 13px; overflow-y: auto;"></div>
                        <div class="discord-bot-console-controls">
                            <div class="discord-bot-status" data-role="status-indicator">
                                <span class="material-symbols-outlined">pause_circle</span>
                                <div>
                                    <span class="discord-bot-status__label">No bot</span>
                                    <span class="discord-bot-status__hint"></span>
                                </div>
                            </div>
                            <div class="discord-bot-actions">
                                <button class="discord-bot-btn discord-bot-btn--start" data-action="start" disabled>
                                    <span class="material-symbols-outlined">play_arrow</span>Start
                                </button>
                                <button class="discord-bot-btn discord-bot-btn--restart" data-action="restart" disabled>
                                    <span class="material-symbols-outlined">refresh</span>Restart
                                </button>
                                <button class="discord-bot-btn discord-bot-btn--danger" data-action="kill" disabled>
                                    <span class="material-symbols-outlined">close</span>Kill
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="discord-bot-row discord-bot-row--info">
                    <div class="discord-bot-info" data-role="info"></div>
                    <div class="discord-bot-info-token">
                        <label for="discord-bot-token">Discord Bot Token</label>
                        <div class="discord-bot-token-field">
                            <input id="discord-bot-token" type="password" data-role="token-input" form="discord-bot-config-form" placeholder="Paste bot token..." required />
                            <button type="submit" form="discord-bot-config-form" class="discord-bot-btn discord-bot-btn--accent">
                                <span class="material-symbols-outlined">link</span>Connect
                            </button>
                        </div>
                        <div class="discord-bot-auto-start">
                            <span class="discord-bot-auto-start__label">Auto start immediately after connect</span>
                            <label class="yuuka-switch" title="Auto start immediately after connect">
                                <input type="checkbox" data-role="auto-start" />
                                <span class="yuuka-switch__slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="discord-bot-row discord-bot-row--form">
                    <form id="discord-bot-config-form" data-role="config-form" autocomplete="off">
                        <div class="discord-bot-field">
                            <label>Modules</label>
                            <div class="discord-bot-module-grid" data-role="module-grid"></div>
                        </div>
                    </form>
                </div>
            </div>
            <div class="discord-bot-row discord-bot-row--module-page" data-role="module-page-row" hidden>
                <div class="discord-bot-module-page">
                    <div class="discord-bot-module-page__header">
                        <button type="button" class="discord-bot-btn" data-action="module-page-back">
                            <span class="material-symbols-outlined">arrow_back</span>Back
                        </button>
                        <div class="discord-bot-module-page__title-wrap">
                            <h3 class="discord-bot-module-page__title" data-role="module-page-title">Module</h3>
                            <span class="discord-bot-module-page__subtitle" data-role="module-page-subtitle"></span>
                        </div>
                    </div>
                    <div class="discord-bot-module-page__body" data-role="module-page-body"></div>
                </div>
            </div>
        `;

        this.dashboardEl = this.container.querySelector('.discord-bot-dashboard');
        this.consoleTitleEl = this.container.querySelector('[data-role="console-title"]');
        this.consoleTabsEl = this.container.querySelector('[data-role="console-tabs"]');
        this.consoleEl = this.container.querySelector('[data-role="console"]');
        this.consoleMessageEl = this.container.querySelector('[data-role="console-message"]');
        this.statusEl = this.container.querySelector('[data-role="status-indicator"]');
        this.infoEl = this.container.querySelector('[data-role="info"]');
        this.moduleGridEl = this.container.querySelector('[data-role="module-grid"]');
        this.modulePageRowEl = this.container.querySelector('[data-role="module-page-row"]');
        this.modulePageTitleEl = this.container.querySelector('[data-role="module-page-title"]');
        this.modulePageSubtitleEl = this.container.querySelector('[data-role="module-page-subtitle"]');
        this.modulePageBodyEl = this.container.querySelector('[data-role="module-page-body"]');
        this.modulePageBackBtn = this.container.querySelector('button[data-action="module-page-back"]');
        this.formEl = this.container.querySelector('[data-role="config-form"]');
        this.tokenInput = this.container.querySelector('[data-role="token-input"]');
        this.autoStartCheckbox = this.container.querySelector('[data-role="auto-start"]');
        this.autoScrollCheckbox = this.container.querySelector('[data-role="auto-scroll"]');
        this.buttons = {
            start: this.container.querySelector('button[data-action="start"]'),
            restart: this.container.querySelector('button[data-action="restart"]'),
            kill: this.container.querySelector('button[data-action="kill"]'),
        };
    }

    _attachHandlers() {
        this.buttons.start.addEventListener('click', this._handleStartStop);
        this.buttons.restart.addEventListener('click', this._handleRestart);
        this.buttons.kill.addEventListener('click', this._handleKill);
        this.formEl.addEventListener('submit', this._handleFormSubmit);
        this.autoScrollCheckbox.addEventListener('change', this._handleAutoScrollToggle);
        if (this.consoleTabsEl) {
            this.consoleTabsEl.addEventListener('click', this._handleConsoleTabClick);
        }
        this.moduleGridEl.addEventListener('click', this._handleModuleGridClick);
        this.moduleGridEl.addEventListener('change', this._handleModuleGridChange);
        if (this.modulePageBodyEl) {
            this.modulePageBodyEl.addEventListener('click', this._handleModulePageClick);
            this.modulePageBodyEl.addEventListener('change', this._handleModulePageChange);
        }
        if (this.modulePageBackBtn) {
            this.modulePageBackBtn.addEventListener('click', this._handleModulePageBack);
        }
    }

    _handleAutoScrollToggle() {
        if (this.autoScrollCheckbox.checked) {
            this._scrollConsoleToBottom();
        }
    }

    _handleConsoleTabClick(e) {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        const targetTab = btn.getAttribute('data-tab');
        
        const buttons = this.consoleTabsEl.querySelectorAll('[data-tab]');
        buttons.forEach(b => b.classList.toggle('discord-bot-btn--accent', b === btn));

        this.state.activeConsoleTab = targetTab;
        if (targetTab === 'log') {
            this.consoleEl.hidden = false;
            this.consoleMessageEl.hidden = true;
        } else {
            this.consoleEl.hidden = true;
            this.consoleMessageEl.hidden = false;
        }
        this._scrollConsoleToBottom();
    }

    // --------------------------------------------------------------------- //
    // Data loading
    // --------------------------------------------------------------------- //
    async refreshBots() {
        try {
            const response = await this.pluginApi.get('/bots');
            this.state.jsRuntimeAvailable = Boolean(response.js_runtime_available);
            this.state.modules = response.available_modules || [];
            this.state.bots = response.bots || [];

            if (!this.state.activeBot || !this.state.bots.find(b => b.bot_id === this.state.activeBot.bot_id)) {
                this.state.activeBot = this.state.bots[0] || null;
                this.state.lastSeq = 0;
                this.state.logs = [];
                if (this.state.activeBot) {
                    await this._loadInitialLogs();
                } else {
                    this._renderConsole();
                }
            } else if (this.state.activeBot) {
                const fresh = this.state.bots.find(b => b.bot_id === this.state.activeBot.bot_id);
                this.state.activeBot = fresh || null;
            }

            if (this.state.activeModulePage && !this.state.modules.find(m => m.id === this.state.activeModulePage)) {
                this._closeModulePage(false);
            }

            this._renderModuleOptions();
            this._renderModulePage();
            this._renderStatusRow();
            this._renderInfoRow();
            this._updateConsoleTitle();
            this._setupUptimeTicker();
            const needsNameRefresh = this.state.activeBot && this.state.activeBot.state === 'running' && !this.state.activeBot.actual_name;
            if (needsNameRefresh) {
                this._scheduleMetadataRefresh(2000);
            }
            this._updateButtons();
            this._maybeEmitModuleStartSummary();
            this._renderConsole();

            const activeState = this.state.activeBot?.state;
            if (activeState === 'starting' || activeState === 'stopping') {
                this._scheduleMetadataRefresh(1200);
            }
        } catch (error) {
            console.error('[DiscordBot] Failed to fetch bots:', error);
            showError(`Failed to load bot configuration: ${error.message}`);
        }
    }

    async _loadInitialLogs() {
        if (!this.state.activeBot) return;
        try {
            const resp = await this.pluginApi.get(`/bots/${this.state.activeBot.bot_id}/logs`);
            this.state.logs = resp.logs || [];
            this.state.lastSeq = this.state.logs.reduce((max, entry) => Math.max(max, entry.seq || 0), 0);
            this._renderConsole();
        } catch (error) {
            console.warn('[DiscordBot] Failed to load logs:', error);
        }
    }

    async _pollLogs() {
        if (!this.state.activeBot) return;
        try {
            const resp = await this.pluginApi.get(`/bots/${this.state.activeBot.bot_id}/logs?after=${this.state.lastSeq}`);
            const newLogs = resp.logs || [];
            if (newLogs.length > 0) {
                newLogs.forEach(entry => {
                    this.state.lastSeq = Math.max(this.state.lastSeq, entry.seq || 0);
                });
                this.state.logs = [...this.state.logs, ...newLogs].slice(-500);
                this._maybeEmitModuleStartSummary();
                this._renderConsole(true);
            }
        } catch (error) {
            console.warn('[DiscordBot] Log polling failed:', error);
        }
    }

    _startPolling() {
        if (this.state.pollingTimer) return;
        this.state.pollingTimer = setInterval(() => this._pollLogs(), 2500);
    }

    _stopPolling() {
        if (this.state.pollingTimer) {
            clearInterval(this.state.pollingTimer);
            this.state.pollingTimer = null;
        }
    }

    // --------------------------------------------------------------------- //
    // Rendering helpers
    // --------------------------------------------------------------------- //
    _renderConsole(shouldStick = false) {
        this._updateConsoleTitle();
        if (!this.consoleEl) return;
        const bot = this.state.activeBot;
        if (!bot) {
            this.consoleEl.innerHTML = `<div class="discord-bot-console-placeholder">
                No bot is configured yet. Connect using your token to begin.
            </div>`;
            return;
        }
        if (this.state.logs.length === 0) {
            const displayName = this._getBotDisplayName(bot) || 'this bot';
            const safeName = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            this.consoleEl.innerHTML = `<div class="discord-bot-console-placeholder">
                No log entries for ${safeName} yet.
            </div>`;
            return;
        }

        const autoStick = shouldStick && this.autoScrollCheckbox.checked;
        const activeContainer = this.state.activeConsoleTab === 'log' ? this.consoleEl : this.consoleMessageEl;
        if (autoStick && activeContainer && activeContainer.clientHeight > 0) {
            const nearBottom = (activeContainer.scrollTop + activeContainer.clientHeight) >= (activeContainer.scrollHeight - 32);
            if (!nearBottom) {
                this.autoScrollCheckbox.checked = false;
            }
        }

        const normalLogs = [];
        const traceLogs = [];
        this.state.logs.forEach(entry => {
            if (entry.level === 'bridge_trace') {
                traceLogs.push(entry);
            } else {
                normalLogs.push(entry);
            }
        });

        // 1. Render normal logs
        if (normalLogs.length === 0) {
            this.consoleEl.innerHTML = `<div class="discord-bot-console-placeholder">No standard logs.</div>`;
        } else {
            const lines = normalLogs.map(entry => {
                const levelKey = entry.level || 'info';
                const levelClass = `discord-log--${levelKey}`;
                const formattedTs = this._formatDisplayTimestamp(entry.timestamp);
                const levelLabel = (levelKey || 'info').toUpperCase();
                const msg = (entry.message || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                return `<div class="discord-log ${levelClass}">
                    <div class="discord-log__meta">
                        <span class="discord-log__ts">${this._escapeHtml(formattedTs)}</span>
                        <span class="discord-log__level">${this._escapeHtml(levelLabel)}</span>
                    </div>
                    <div class="discord-log__msg">${msg}</div>
                </div>`;
            });
            this.consoleEl.innerHTML = lines.join('');
        }

        // 2. Render trace logs
        if (!this.consoleMessageEl) return;
        if (traceLogs.length === 0) {
            this.consoleMessageEl.innerHTML = `<div class="discord-bot-console-placeholder">No message traces yet. Chat in a channel to generate LLM logs.</div>`;
        } else {
            const tracesHtml = traceLogs.map(entry => {
                let payload = {};
                try {
                    payload = typeof entry.message === 'string' ? JSON.parse(entry.message) : entry.message;
                } catch(e) {}
                
                const formattedTs = this._formatDisplayTimestamp(entry.timestamp);
                const guildCh = `[${this._escapeHtml(payload.guild || '')} - ${this._escapeHtml(payload.channel || '')}]`;
                const author = this._escapeHtml(payload.author || '');
                const response = this._escapeHtml(payload.response || '');
                
                let promptHtml = '';
                if (Array.isArray(payload.prompt)) {
                    promptHtml = payload.prompt.map(msg => {
                        const r = this._escapeHtml(msg.role);
                        const c = this._escapeHtml(msg.content);
                        return `<div style="margin-bottom:8px; border-bottom:1px solid #333; padding-bottom:4px;">
                            <span style="color:#d886ff; font-weight:bold;">[${r}]</span> <span>${c}</span>
                        </div>`;
                    }).join('');
                }
                
                return `<div style="margin-bottom: 24px; padding: 12px; border: 1px solid #333; background: #1a1a1a; border-radius: 4px;">
                    <div style="color: #888; font-size: 11px; margin-bottom: 8px;">${formattedTs} • ${guildCh} • ${author}</div>
                    <div style="color: #bbb; margin-bottom: 12px;">${promptHtml}</div>
                    <div style="color: #61ef87; font-weight: bold; margin-bottom: 4px;">[Model Response]</div>
                    <div style="color: #fff;">${response}</div>
                </div>`;
            });
            this.consoleMessageEl.innerHTML = tracesHtml.join('');
        }

        this._scrollConsoleToBottom();
    }

    _scrollConsoleToBottom() {
        if (!this.autoScrollCheckbox.checked) return;
        requestAnimationFrame(() => {
            if (this.state.activeConsoleTab === 'log' && this.consoleEl) {
                this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
            } else if (this.state.activeConsoleTab === 'message' && this.consoleMessageEl) {
                this.consoleMessageEl.scrollTop = this.consoleMessageEl.scrollHeight;
            }
        });
    }

    _renderStatusRow() {
        if (!this.statusEl) return;
        const bot = this.state.activeBot;
        if (!bot) {
            this.statusEl.className = 'discord-bot-status';
            this.statusEl.innerHTML = `
                <span class="material-symbols-outlined">pause_circle</span>
                <div>
                    <span class="discord-bot-status__label">No bot configured</span>
                    <span class="discord-bot-status__hint">${this.state.jsRuntimeAvailable ? 'Provide a token to create one.' : 'Node.js runtime is not available.'}</span>
                </div>
            `;
            return;
        }

        const statusMeta = this._resolveStatusMeta(bot.state);
        this.statusEl.className = `discord-bot-status discord-bot-status--${statusMeta.tone}`;
        const hint = !this.state.jsRuntimeAvailable
            ? 'Install Node.js and discord.js dependencies to run Discord bots.'
            : (bot.last_error ? `Last error: ${bot.last_error}` : '');
        const safeLabel = this._escapeHtml(statusMeta.label);
        const safeHint = this._escapeHtml(hint);

        this.statusEl.innerHTML = `
            <span class="material-symbols-outlined">${statusMeta.icon}</span>
            <div>
                <span class="discord-bot-status__label">${safeLabel}</span>
                <span class="discord-bot-status__hint">${safeHint}</span>
            </div>
        `;
    }

    _renderInfoRow() {
        if (!this.infoEl) return;
        const bot = this.state.activeBot;
        if (!bot) {
            const moduleNames = this.state.modules.map(m => this._escapeHtml(m.name)).join(', ') || '---';
            this.infoEl.innerHTML = `
                <div class="discord-bot-info__item">
                    <span class="label">Available Modules</span>
                    <span class="value">${moduleNames}</span>
                </div>
            `;
            return;
        }

        const taskInfo = bot.task || {};
        const displayName = this._getBotDisplayName(bot) || '---';
        const modulesText = bot.modules && bot.modules.length ? bot.modules.join(', ') : '---';
        const intentsText = bot.intents && bot.intents.length ? bot.intents.join(', ') : 'Default';
        const threadText = taskInfo.is_running ? 'Running' : (taskInfo.status || '---');
        const uptimeInitial = this._computeUptimeText(bot);
        const lastUpdateText = this._formatDisplayTimestamp(bot.updated_at);

        const items = [
            { label: 'Bot ID', value: bot.bot_id },
            { label: 'Name', value: displayName },
            { label: 'Modules', value: modulesText },
            { label: 'Intents', value: intentsText },
            { label: 'Auto start', value: bot.auto_start ? 'On' : 'Off' },
            { label: 'Thread', value: threadText },
            { label: 'Last update', value: lastUpdateText },
        ];

        if (!this.state.jsRuntimeAvailable) {
            items.push({ label: 'discord.js runtime', value: 'Unavailable (install Node.js and dependencies)' });
        }

        const infoHtml = items.map(item => `
            <div class="discord-bot-info__item">
                <span class="label">${this._escapeHtml(item.label)}</span>
                <span class="value">${this._escapeHtml(item.value)}</span>
            </div>
        `);

        infoHtml.push(`
            <div class="discord-bot-info__item">
                <span class="label">Uptime</span>
                <span class="value" data-role="uptime-value">${this._escapeHtml(uptimeInitial)}</span>
            </div>
        `);

        this.infoEl.innerHTML = infoHtml.join('');
    }

    _updateConsoleTitle() {
        if (!this.consoleTitleEl) return;
        const bot = this.state.activeBot;
        const displayName = this._getBotDisplayName(bot);
        if (displayName) {
            this.consoleTitleEl.textContent = `${displayName} console`;
        } else {
            this.consoleTitleEl.textContent = 'Bot console';
        }
    }

    _computeUptimeText(bot) {
        if (!bot || bot.state !== 'running' || !bot.started_at) {
            return '--';
        }
        const started = new Date(bot.started_at);
        if (Number.isNaN(started.getTime())) {
            return '--';
        }
        const diffMs = Date.now() - started.getTime();
        if (!Number.isFinite(diffMs) || diffMs <= 0) {
            return '--';
        }
        return this._formatDuration(diffMs);
    }

    _setupUptimeTicker() {
        if (this._uptimeTimer) {
            clearInterval(this._uptimeTimer);
            this._uptimeTimer = null;
        }

        const bot = this.state.activeBot;
        const uptimeEl = this.infoEl ? this.infoEl.querySelector('[data-role="uptime-value"]') : null;
        if (!bot || !uptimeEl) {
            return;
        }

        const started = bot.started_at ? new Date(bot.started_at) : null;
        const updateValue = () => {
            if (!started || Number.isNaN(started.getTime())) {
                uptimeEl.textContent = '--';
                return;
            }
            const diffMs = Math.max(Date.now() - started.getTime(), 0);
            uptimeEl.textContent = bot.state === 'running' ? this._formatDuration(diffMs) : '--';
        };

        if (bot.state === 'running' && started && !Number.isNaN(started.getTime())) {
            updateValue();
            this._uptimeTimer = setInterval(updateValue, 1000);
        } else {
            uptimeEl.textContent = this._computeUptimeText(bot);
        }
    }

    _formatDuration(ms) {
        if (!Number.isFinite(ms) || ms < 0) {
            return '--';
        }
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts = [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            seconds.toString().padStart(2, '0'),
        ];
        return parts.join(':');
    }

    _escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _formatDisplayTimestamp(value) {
        if (!value) {
            return '---';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        const pad = (num) => String(num).padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    _getBotDisplayName(bot) {
        if (!bot) return '';
        return bot.actual_name || bot.name || '';
    }

    _scheduleMetadataRefresh(delay = 2000) {
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
        }
        this._refreshTimeout = setTimeout(async () => {
            this._refreshTimeout = null;
            try {
                await this.refreshBots();
            } catch (error) {
                console.warn('[DiscordBot] Scheduled refresh failed:', error);
            }
        }, delay);
    }

    _renderModuleOptions() {
        if (!this.moduleGridEl) {
            return;
        }

        const activeModules = new Set(this.state.activeBot?.modules || []);
        const groups = {
            core: [],
            normal: [],
            admin: [],
        };

        for (const module of this.state.modules) {
            const moduleType = module?.type === 'core'
                ? 'core'
                : (module?.type === 'admin' || module?.admin ? 'admin' : 'normal');
            groups[moduleType].push(module);
        }

        const buildModuleCard = (module) => {
            if (!module || !module.id) {
                return '';
            }
            const moduleType = module?.type === 'core'
                ? 'core'
                : (module?.type === 'admin' || module?.admin ? 'admin' : 'normal');
            const isCore = moduleType === 'core';
            const isChecked = isCore || activeModules.has(module.id);
            const checked = isChecked ? 'checked' : '';
            const disabled = isCore ? 'disabled' : '';
            const safeId = this._escapeHtml(module.id);
            const safeName = this._escapeHtml(module.name || module.id);
            const safeDesc = this._escapeHtml(module.description || 'No description available.');
            const safeType = this._escapeHtml(moduleType);
            return `
                <div class="discord-bot-module discord-bot-module--${safeType}">
                    <label class="discord-bot-module__toggle yuuka-switch ${isCore ? 'discord-bot-module__toggle--locked' : ''}" title="${isCore ? 'Core modules are always enabled' : 'Enable/Disable module'}">
                        <input type="checkbox" class="discord-bot-module-checkbox" value="${safeId}" ${checked} ${disabled}/>
                        <span class="yuuka-switch__slider"></span>
                    </label>
                    <button type="button" class="discord-bot-module-main" data-action="open-module-page" data-module-id="${safeId}">
                        <span class="module-name">${safeName} <span class="module-type-badge module-type-badge--${safeType}">${safeType}</span></span>
                        <span class="module-desc">${safeDesc}</span>
                    </button>
                </div>
            `;
        };

        const sections = [];
        if (groups.core.length) {
            sections.push(`
                <div class="discord-bot-module-group">
                    <div class="discord-bot-module-group__title">Core modules</div>
                    <div class="discord-bot-module-grid">${groups.core.map(buildModuleCard).join('')}</div>
                </div>
            `);
        }
        if (groups.normal.length) {
            sections.push(`
                <div class="discord-bot-module-group">
                    <div class="discord-bot-module-group__title">Normal modules</div>
                    <div class="discord-bot-module-grid">${groups.normal.map(buildModuleCard).join('')}</div>
                </div>
            `);
        }
        if (groups.admin.length) {
            sections.push(`
                <div class="discord-bot-module-group">
                    <div class="discord-bot-module-group__title">Admin modules</div>
                    <div class="discord-bot-module-grid">${groups.admin.map(buildModuleCard).join('')}</div>
                </div>
            `);
        }

        this.moduleGridEl.innerHTML = sections.join('');
    }

    _handleModuleGridClick(event) {
        const trigger = event.target.closest('[data-action="open-module-page"]');
        if (!trigger || !this.moduleGridEl.contains(trigger)) {
            return;
        }
        const moduleId = trigger.getAttribute('data-module-id');
        this._openModulePage(moduleId);
    }

    async _handleModuleGridChange(event) {
        const checkbox = event.target.closest('input.discord-bot-module-checkbox');
        if (!checkbox || !this.moduleGridEl.contains(checkbox) || checkbox.disabled) {
            return;
        }
        await this._saveBotConfiguration({
            modules: this._collectSelectedModules(),
            showSuccessMessage: false,
        });
    }

    _handleModulePageBack() {
        this._closeModulePage();
    }

    _openModulePage(moduleId) {
        if (!moduleId) return;
        this.state.activeModulePage = moduleId;
        this._renderModulePage();
        this._loadModuleUi(moduleId);
    }

    async _loadModuleUi(moduleId) {
        if (!moduleId) return;
        const cacheKey = this._moduleUiCacheKey(moduleId);
        if (this.state.moduleUiCache[cacheKey]) return;
        if (this.state.moduleUiLoading[moduleId]) return;

        this.state.moduleUiLoading[moduleId] = true;
        try {
            const botId = this.state.activeBot?.bot_id;
            const query = botId ? `?bot_id=${encodeURIComponent(botId)}` : '';
            const response = await this.pluginApi.get(`/modules/${encodeURIComponent(moduleId)}/ui${query}`);
            this.state.moduleUiCache[cacheKey] = response?.ui && typeof response.ui === 'object' ? response.ui : {};
        } catch (error) {
            this.state.moduleUiCache[cacheKey] = {
                _error: error?.message || 'Unable to load module UI.',
            };
        } finally {
            delete this.state.moduleUiLoading[moduleId];
            if (this.state.activeModulePage === moduleId) {
                this._renderModulePage();
            }
        }
    }

    _closeModulePage(restoreFocus = true) {
        this.state.activeModulePage = null;
        if (this.modulePageRowEl) {
            this.modulePageRowEl.hidden = true;
        }
        if (this.dashboardEl) {
            this.dashboardEl.hidden = false;
        }
        if (restoreFocus) {
            const firstCard = this.moduleGridEl?.querySelector('[data-action="open-module-page"]');
            if (firstCard && typeof firstCard.focus === 'function') {
                firstCard.focus();
            }
        }
    }

    _renderModulePage() {
        if (!this.modulePageRowEl || !this.modulePageTitleEl || !this.modulePageBodyEl || !this.modulePageSubtitleEl) {
            return;
        }

        const moduleId = this.state.activeModulePage;
        if (!moduleId) {
            this.modulePageRowEl.hidden = true;
            if (this.dashboardEl) {
                this.dashboardEl.hidden = false;
            }
            return;
        }

        const module = this.state.modules.find(m => m.id === moduleId);
        if (!module) {
            this._closeModulePage(false);
            return;
        }

        const activeModules = new Set(this.state.activeBot?.modules || []);
        const moduleName = module.name || module.id;
        const moduleType = module?.type === 'core'
            ? 'core'
            : (module?.type === 'admin' || module?.admin ? 'admin' : 'normal');
        const isEnabled = activeModules.has(module.id);
        const isLoading = Boolean(this.state.moduleUiLoading[module.id]);
        const moduleUi = this.state.moduleUiCache[this._moduleUiCacheKey(module.id)] || module.ui || {};
        const summaryText = this._escapeHtml(moduleUi?.summary || module.description || 'No description provided for this module yet.');

        const specialRendererBlock = this._renderSpecialModuleUi(module, moduleUi);
        const sectionBlocks = specialRendererBlock || (Array.isArray(moduleUi?.sections)
            ? moduleUi.sections.map(section => this._renderModuleUiSection(section)).filter(Boolean).join('')
            : '');

        const loadingBlock = isLoading
            ? '<div class="discord-bot-module-page-loading">Loading module UI...</div>'
            : '';

        const errorBlock = moduleUi && moduleUi._error
            ? `<div class="discord-bot-module-page-error">${this._escapeHtml(moduleUi._error)}</div>`
            : '';

        const fallbackBlock = (!isLoading && !sectionBlocks && !errorBlock)
            ? `<div class="discord-bot-module-page-placeholder">${this._escapeHtml(module.id)}</div>`
            : '';

        this.modulePageTitleEl.textContent = moduleName;
        this.modulePageSubtitleEl.textContent = `${moduleType.toUpperCase()} module • ${isEnabled ? 'Enabled' : 'Disabled'}`;

        this.modulePageBodyEl.innerHTML = `
            <section class="discord-bot-module-page-section">
                <h4>Overview</h4>
                <p>${summaryText}</p>
            </section>
            ${loadingBlock}
            ${errorBlock}
            ${sectionBlocks}
            ${fallbackBlock}
        `;

        this.modulePageRowEl.hidden = false;
        if (this.dashboardEl) {
            this.dashboardEl.hidden = true;
        }
    }

    _renderModuleUiSection(section) {
        if (!section || typeof section !== 'object') {
            return '';
        }

        const title = this._escapeHtml(section.title || 'Section');
        const text = typeof section.text === 'string' ? this._escapeHtml(section.text) : '';
        const code = typeof section.code === 'string' ? this._escapeHtml(section.code) : '';

        let itemsHtml = '';
        if (Array.isArray(section.items) && section.items.length) {
            itemsHtml = `
                <ul class="discord-bot-module-ui-list">
                    ${section.items.map((item) => {
                        if (item && typeof item === 'object') {
                            const label = this._escapeHtml(item.label || '');
                            const value = this._escapeHtml(item.value || '');
                            return `<li class="discord-bot-module-ui-item"><span class="discord-bot-module-ui-item__label">${label}</span><span class="discord-bot-module-ui-item__value">${value}</span></li>`;
                        }
                        const value = this._escapeHtml(String(item ?? ''));
                        return `<li class="discord-bot-module-ui-item"><span class="discord-bot-module-ui-item__value">${value}</span></li>`;
                    }).join('')}
                </ul>
            `;
        }

        const textHtml = text ? `<p>${text}</p>` : '';
        const codeHtml = code ? `<pre class="discord-bot-module-ui-code">${code}</pre>` : '';

        return `
            <section class="discord-bot-module-page-section">
                <h4>${title}</h4>
                ${textHtml}
                ${itemsHtml}
                ${codeHtml}
            </section>
        `;
    }

    _moduleUiCacheKey(moduleId) {
        const botId = this.state.activeBot?.bot_id || '_no_bot';
        return `${botId}::${moduleId}`;
    }

    _invalidateModuleUiCache(moduleId, botId = this.state.activeBot?.bot_id) {
        if (!moduleId) {
            return;
        }
        const cacheKey = `${botId || '_no_bot'}::${moduleId}`;
        delete this.state.moduleUiCache[cacheKey];
        delete this.state.moduleUiLoading[moduleId];
    }

    async _refreshActiveModulePageUi() {
        const moduleId = this.state.activeModulePage;
        if (!moduleId) {
            return;
        }
        this._invalidateModuleUiCache(moduleId);
        await this._loadModuleUi(moduleId);
    }

    _collectSelectedModules() {
        const selectedModules = Array
            .from(this.moduleGridEl.querySelectorAll('input.discord-bot-module-checkbox:checked'))
            .map((input) => input.value);
        const coreModules = this.state.modules
            .filter((module) => module?.type === 'core')
            .map((module) => module.id);
        return [...new Set([...selectedModules, ...coreModules])];
    }

    async _saveBotConfiguration({ modules = this._collectSelectedModules(), autoStart = this.autoStartCheckbox.checked, showSuccessMessage = true, extraProps = {} } = {}) {
        const token = this.tokenInput.value.trim();
        if (!token && !this.state.activeBot) {
            showError('Please enter a valid bot token.');
            return false;
        }

        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            const payload = {
                bot_id: this.state.activeBot?.bot_id || 'default',
                token,
                modules,
                auto_start: autoStart,
                name: this.state.activeBot?.name || 'My Discord Bot',
                ...extraProps
            };
            await this.pluginApi.post('/bots', payload);
            await this.refreshBots();
            await this._refreshActiveModulePageUi();
            this.tokenInput.value = '';
            if (showSuccessMessage) {
                showError('Bot configuration saved.');
            }
            return true;
        } catch (error) {
            console.error('[DiscordBot] Failed to save configuration:', error);
            showError(`Unable to save bot configuration: ${error.message}`);
            await this.refreshBots();
            return false;
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    _renderSpecialModuleUi(module, moduleUi) {
        if (!moduleUi) return '';
        if (moduleUi.renderer === 'policy-manager') {
            return this._renderPolicyManagerUi(module, moduleUi);
        }
        if (moduleUi.renderer === 'character-picker') {
            return this._renderCharacterPickerUi(module, moduleUi);
        }
        return '';
    }

    _renderPolicyManagerUi(module, moduleUi) {
        const bot = this.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Policy groups</h4>
                    <p>Create or connect a bot first to manage policy groups.</p>
                </section>
            `;
        }
        const activeModules = new Set(bot.modules || []);
        const groups = Array.isArray(moduleUi.groups) ? moduleUi.groups : [];
        const filteredGroups = groups
            .map((group) => ({
                ...group,
                policies: Array.isArray(group.policies)
                    ? group.policies.filter((policy) => activeModules.has(policy.module_id) && policy.module_id !== module.id)
                    : [],
            }))
            .filter((group) => group.policies.length > 0);
        if (!filteredGroups.length) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Policy groups</h4>
                    <p>No registered policies are available for the currently enabled modules.</p>
                </section>
            `;
        }
        const groupsHtml = filteredGroups.map((group) => `
            <section class="discord-bot-module-page-section discord-policy-group">
                <div class="discord-policy-group__header">
                    <h4>${this._escapeHtml(group.group_name || group.group_id || 'Group')}</h4>
                    <span class="discord-policy-group__count">${group.policies.length} policies</span>
                </div>
                <div class="discord-policy-list">
                    ${group.policies.map((policy) => this._renderPolicyCard(policy)).join('')}
                </div>
            </section>
        `).join('');
        return `
            <section class="discord-bot-module-page-section">
                <h4>Policy groups</h4>
                <p>Each policy is registered by a module, shown in its group, and starts from the default toggle defined by that module.</p>
            </section>
            ${groupsHtml}
        `;
    }

    _renderPolicyCard(policy) {
        const policyId = this._escapeHtml(policy.policy_id || '');
        const title = this._escapeHtml(policy.title || policy.policy_id || 'Policy');
        const description = this._escapeHtml(policy.description || '');
        const moduleName = this._escapeHtml(policy.module_name || policy.module_id || 'Unknown module');
        const moduleId = this._escapeHtml(policy.module_id || '');
        const enabled = policy.enabled ? 'checked' : '';
        const defaultLabel = policy.default_enabled ? 'ON' : 'OFF';
        const settingSchema = policy.setting_schema && typeof policy.setting_schema === 'object' ? policy.setting_schema : {};
        const settings = policy.settings && typeof policy.settings === 'object' ? policy.settings : {};
        const settingFields = Object.entries(settingSchema).map(([key, defaultValue]) => {
            const currentValue = settings[key] == null ? defaultValue : settings[key];
            if (key === 'allowed_channel_ids') {
                return this._renderAllowedChannelIdsSetting({
                    policyId,
                    key,
                    currentValue,
                });
            }
            return `
                <label class="discord-policy-setting">
                    <span class="discord-policy-setting__label">${this._escapeHtml(key)}</span>
                    <input
                        type="text"
                        class="discord-policy-setting__input"
                        data-role="policy-setting"
                        data-policy-id="${policyId}"
                        data-setting-key="${this._escapeHtml(key)}"
                        value="${this._escapeHtml(String(currentValue ?? ''))}"
                        placeholder="${this._escapeHtml(String(defaultValue ?? ''))}"
                    />
                </label>
            `;
        }).join('');
        return `
            <article class="discord-policy-card" data-policy-id="${policyId}">
                <div class="discord-policy-card__header">
                    <div class="discord-policy-card__meta">
                        <div class="discord-policy-card__title-row">
                            <h5>${title}</h5>
                            <span class="discord-policy-card__default">Default ${defaultLabel}</span>
                        </div>
                        <div class="discord-policy-card__owner">Registered by ${moduleName} <span class="discord-policy-card__owner-id">${moduleId}</span></div>
                    </div>
                    <label class="yuuka-switch discord-policy-card__toggle" title="Toggle policy">
                        <input type="checkbox" data-role="policy-toggle" data-policy-id="${policyId}" ${enabled} />
                        <span class="yuuka-switch__slider"></span>
                    </label>
                </div>
                <p class="discord-policy-card__description">${description}</p>
                ${settingFields ? `<div class="discord-policy-settings">${settingFields}</div>` : ''}
            </article>
        `;
    }

    _renderCharacterPickerUi(module, moduleUi) {
        const bot = this.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Character</h4>
                    <p>Create or connect a bot first to configure.</p>
                </section>
            `;
        }
        const selectedId = moduleUi.chat_character_id || '';
        const bUrl = moduleUi.chat_bridge_url || '';
        const bKey = moduleUi.chat_bridge_key || '';
        
        setTimeout(() => this._loadAndRenderCharacterGrid(selectedId), 0);

        return `
            <section class="discord-bot-module-page-section">
                <h4>Bridge Network</h4>
                <div class="discord-policy-settings" style="margin-bottom: var(--spacing-4);">
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Bridge URL (Optional)</span>
                        <input type="text" class="discord-policy-setting__input" data-role="cb-url" value="${this._escapeHtml(bUrl)}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Bridge Key</span>
                        <input type="password" class="discord-policy-setting__input" data-role="cb-key" value="${this._escapeHtml(bKey)}" />
                    </label>
                </div>
                
                <h4>Character <span style="font-size: 0.8em; color: var(--color-secondary-text); font-weight: normal;">(Only characters with persona are shown)</span></h4>
                <div class="discord-bot-character-picker">
                    <input type="search" class="discord-policy-setting__input" style="width: 100%; margin-bottom: var(--spacing-3);" data-role="cb-search" placeholder="Search characters...">
                    <div class="discord-bot-character-grid" data-role="cb-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: var(--spacing-3); max-height: 400px; overflow-y: auto;">
                        <div class="discord-bot-module-page-loading">Loading characters...</div>
                    </div>
                </div>
                <input type="hidden" data-role="cb-selected" value="${this._escapeHtml(selectedId)}">
            </section>
        `;
    }

    async _loadAndRenderCharacterGrid(selectedId) {
        if (!this.modulePageBodyEl) return;
        const gridEl = this.modulePageBodyEl.querySelector('[data-role="cb-grid"]');
        const searchEl = this.modulePageBodyEl.querySelector('[data-role="cb-search"]');
        if (!gridEl) return;
        
        try {
            if (!this.api['chat']) throw new Error('Chat plugin is not active/available.');
            const res = await this.api['chat'].get('/personas');
            let chars = Object.values(res.characters || {}).filter(c => c && c.persona && c.persona.trim().length > 0);
            
            const renderGrid = (query = '') => {
                const q = query.toLowerCase().trim();
                const filtered = chars.filter(c => c.name.toLowerCase().includes(q) || (c.persona && c.persona.toLowerCase().includes(q)));
                
                if (filtered.length === 0) {
                    gridEl.innerHTML = '<div class="discord-bot-module-page-placeholder">No characters found.</div>';
                    return;
                }
                
                const cardsHtml = filtered.map(c => {
                    const isSelected = c.id === selectedId;
                    const avatar = c.avatar ? `<img src="${c.avatar}" style="width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: var(--rounded-md) var(--rounded-md) 0 0; display: block;" />` : `<div style="width:100%; aspect-ratio: 3/4; background: rgba(0,0,0,0.1); border-radius: var(--rounded-md) var(--rounded-md) 0 0; display:flex; align-items:center; justify-content:center;"><span class="material-symbols-outlined" style="opacity:0.5;">person</span></div>`;
                    return `
                        <div class="discord-cb-card" data-role="cb-card" data-id="${this._escapeHtml(c.id)}" style="cursor: pointer; border: 2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}; border-radius: var(--rounded-md); background: var(--color-card-bg); transition: border-color 0.2s;">
                            ${avatar}
                            <div style="padding: var(--spacing-2);">
                                <div style="font-weight: 500; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;">${this._escapeHtml(c.name || 'Unnamed')}</div>
                            </div>
                        </div>
                    `;
                }).join('');
                
                const isNoneSelected = !selectedId;
                const noneCardHtml = `
                    <div class="discord-cb-card" data-role="cb-card" data-id="" style="cursor: pointer; border: 2px solid ${isNoneSelected ? 'var(--color-accent)' : 'var(--color-border)'}; border-radius: var(--rounded-md); background: var(--color-card-bg); transition: border-color 0.2s;">
                        <div style="width:100%; aspect-ratio: 3/4; background: rgba(0,0,0,0.05); border-radius: var(--rounded-md) var(--rounded-md) 0 0; display:flex; align-items:center; justify-content:center;">
                            <span class="material-symbols-outlined" style="opacity: 0.5; font-size: 32px;">person_off</span>
                        </div>
                        <div style="padding: var(--spacing-2);">
                            <div style="font-weight: 500; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; color: var(--color-secondary-text);">None</div>
                        </div>
                    </div>
                `;
                
                gridEl.innerHTML = noneCardHtml + cardsHtml;
            };
            
            renderGrid();
            
            if (searchEl) {
                searchEl.addEventListener('input', (e) => renderGrid(e.target.value));
            }
        } catch (e) {
            gridEl.innerHTML = `<div class="discord-bot-module-page-error">Failed to load characters: ${e.message}</div>`;
        }
    }

    _renderAllowedChannelIdsSetting({ policyId, key, currentValue }) {
        const values = this._parseChannelIdList(currentValue);
        const itemsHtml = values.map((value) => `
            <span class="discord-policy-list-item" data-role="channel-id-item" data-value="${this._escapeHtml(value)}">
                <span class="discord-policy-list-item__text">${this._escapeHtml(value)}</span>
                <button
                    type="button"
                    class="discord-policy-list-item__remove"
                    data-action="remove-channel-id"
                    data-policy-id="${policyId}"
                    data-setting-key="${this._escapeHtml(key)}"
                    data-value="${this._escapeHtml(value)}"
                >-</button>
            </span>
        `).join('');
        return `
            <div class="discord-policy-setting discord-policy-setting--channel-list" data-role="channel-id-setting" data-policy-id="${policyId}" data-setting-key="${this._escapeHtml(key)}">
                <span class="discord-policy-setting__label">${this._escapeHtml(key)}</span>
                <div class="discord-policy-list-editor">
                    <div class="discord-policy-list-editor__controls">
                        <input
                            type="text"
                            class="discord-policy-setting__input discord-policy-list-editor__input"
                            data-role="channel-id-input"
                            data-policy-id="${policyId}"
                            data-setting-key="${this._escapeHtml(key)}"
                            placeholder="Add channel ID"
                        />
                        <button
                            type="button"
                            class="discord-bot-btn discord-bot-btn--accent discord-policy-list-editor__add"
                            data-action="add-channel-id"
                            data-policy-id="${policyId}"
                            data-setting-key="${this._escapeHtml(key)}"
                        >Add</button>
                    </div>
                    <div class="discord-policy-list-items" data-role="channel-id-items">${itemsHtml}</div>
                    <input type="hidden" data-role="policy-setting" data-policy-id="${policyId}" data-setting-key="${this._escapeHtml(key)}" value="${this._escapeHtml(values.join(','))}" />
                </div>
            </div>
        `;
    }

    _parseChannelIdList(value) {
        return String(value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    async _handleModulePageClick(event) {
        const addButton = event.target.closest('[data-action="add-channel-id"]');
        if (addButton && this.modulePageBodyEl.contains(addButton)) {
            const policyId = addButton.getAttribute('data-policy-id');
            const settingKey = addButton.getAttribute('data-setting-key');
            if (policyId && settingKey) {
                await this._addChannelIdFromModulePage(policyId, settingKey);
            }
            return;
        }
        const removeButton = event.target.closest('[data-action="remove-channel-id"]');
        if (removeButton && this.modulePageBodyEl.contains(removeButton)) {
            const policyId = removeButton.getAttribute('data-policy-id');
            const settingKey = removeButton.getAttribute('data-setting-key');
            const value = removeButton.getAttribute('data-value');
            if (policyId && settingKey && value) {
                await this._removeChannelIdFromModulePage(policyId, settingKey, value);
            }
            return;
        }
        const cbCard = event.target.closest('[data-role="cb-card"]');
        if (cbCard && this.modulePageBodyEl.contains(cbCard)) {
            const cId = cbCard.getAttribute('data-id');
            const hidden = this.modulePageBodyEl.querySelector('[data-role="cb-selected"]');
            if (hidden) hidden.value = cId;
            
            const cards = this.modulePageBodyEl.querySelectorAll('[data-role="cb-card"]');
            cards.forEach(c => c.style.borderColor = 'var(--color-border)');
            cbCard.style.borderColor = 'var(--color-accent)';
            
            const bUrl = this.modulePageBodyEl.querySelector('[data-role="cb-url"]')?.value || '';
            const bKey = this.modulePageBodyEl.querySelector('[data-role="cb-key"]')?.value || '';
            await this._saveBotConfiguration({
                extraProps: {
                    chat_character_id: cId,
                    chat_bridge_url: bUrl,
                    chat_bridge_key: bKey
                }
            });
            return;
        }
    }

    async _handleModulePageChange(event) {
        const toggle = event.target.closest('[data-role="policy-toggle"]');
        if (toggle && this.modulePageBodyEl.contains(toggle)) {
            const policyId = toggle.getAttribute('data-policy-id');
            if (policyId) {
                await this._savePolicyFromModulePage(policyId);
            }
            return;
        }

        const cbInput = event.target.closest('[data-role="cb-url"], [data-role="cb-key"]');
        if (cbInput && this.modulePageBodyEl.contains(cbInput)) {
            const bUrl = this.modulePageBodyEl.querySelector('[data-role="cb-url"]')?.value || '';
            const bKey = this.modulePageBodyEl.querySelector('[data-role="cb-key"]')?.value || '';
            const cId = this.modulePageBodyEl.querySelector('[data-role="cb-selected"]')?.value || '';
            await this._saveBotConfiguration({
                extraProps: {
                    chat_character_id: cId,
                    chat_bridge_url: bUrl,
                    chat_bridge_key: bKey
                }
            });
            return;
        }
    }

    async _addChannelIdFromModulePage(policyId, settingKey) {
        const policyCard = this.modulePageBodyEl?.querySelector(`.discord-policy-card[data-policy-id="${policyId}"]`);
        if (!policyCard) {
            return;
        }
        const container = policyCard.querySelector(`[data-role="channel-id-setting"][data-setting-key="${settingKey}"]`);
        const input = container?.querySelector('[data-role="channel-id-input"]');
        const hiddenInput = policyCard.querySelector(`[data-role="policy-setting"][data-setting-key="${settingKey}"]`);
        if (!container || !input || !hiddenInput) {
            return;
        }
        const candidate = input.value.trim();
        if (!candidate) {
            return;
        }
        const currentValues = this._parseChannelIdList(hiddenInput.value);
        if (!currentValues.includes(candidate)) {
            currentValues.push(candidate);
        }
        hiddenInput.value = currentValues.join(',');
        input.value = '';
        await this._savePolicyFromModulePage(policyId);
    }

    async _removeChannelIdFromModulePage(policyId, settingKey, valueToRemove) {
        const policyCard = this.modulePageBodyEl?.querySelector(`.discord-policy-card[data-policy-id="${policyId}"]`);
        const hiddenInput = policyCard?.querySelector(`[data-role="policy-setting"][data-setting-key="${settingKey}"]`);
        if (!policyCard || !hiddenInput) {
            return;
        }
        const currentValues = this._parseChannelIdList(hiddenInput.value);
        hiddenInput.value = currentValues.filter((value) => value !== valueToRemove).join(',');
        await this._savePolicyFromModulePage(policyId);
    }

    async _savePolicyFromModulePage(policyId) {
        const bot = this.state.activeBot;
        if (!bot) {
            showError('No active bot selected.');
            return;
        }
        const policyCard = this.modulePageBodyEl?.querySelector(`.discord-policy-card[data-policy-id="${policyId}"]`);
        if (!policyCard) {
            return;
        }
        const toggleEl = policyCard.querySelector('[data-role="policy-toggle"]');
        const settingEls = Array.from(policyCard.querySelectorAll('[data-role="policy-setting"]'));
        const settings = {};
        settingEls.forEach((input) => {
            const key = input.getAttribute('data-setting-key');
            if (key) {
                settings[key] = key === 'allowed_channel_ids'
                    ? this._parseChannelIdList(input.value).join(',')
                    : input.value;
            }
        });
        const payload = {
            toggles: {
                [policyId]: Boolean(toggleEl?.checked),
            },
            settings: Object.keys(settings).length ? { [policyId]: settings } : {},
        };
        try {
            this._setPolicyCardSaving(policyCard, true);
            const response = await this.pluginApi.post(`/bots/${encodeURIComponent(bot.bot_id)}/policies`, payload);
            const cacheKey = this._moduleUiCacheKey(this.state.activeModulePage);
            const existingUi = this.state.moduleUiCache[cacheKey] || {};
            this.state.moduleUiCache[cacheKey] = {
                ...existingUi,
                groups: Array.isArray(response?.groups) ? response.groups : [],
                bot_id: bot.bot_id,
            };
            this._renderModulePage();
            showError(`Saved policy: ${policyId}`);
        } catch (error) {
            console.error('[DiscordBot] Failed to save policy:', error);
            showError(`Unable to save policy: ${error.message}`);
        } finally {
            this._setPolicyCardSaving(policyCard, false);
        }
    }

    _setPolicyCardSaving(policyCard, isSaving) {
        if (!policyCard) {
            return;
        }
        policyCard.classList.toggle('discord-policy-card--saving', Boolean(isSaving));
        const inputs = policyCard.querySelectorAll('input');
        inputs.forEach((input) => {
            input.disabled = Boolean(isSaving);
        });
    }

    _updateButtons() {
        const bot = this.state.activeBot;
        const jsRuntimeReady = this.state.jsRuntimeAvailable;
        const isRunning = bot && bot.state === 'running';
        const isStarting = bot && bot.state === 'starting';
        const isStopping = bot && bot.state === 'stopping';
        const hasBot = Boolean(bot);
        const disabling = this.state.isSubmitting;
        const useStopAction = Boolean(isRunning || isStarting);

        this.buttons.start.classList.toggle('discord-bot-btn--start', !useStopAction);
        this.buttons.start.classList.toggle('discord-bot-btn--stop', useStopAction);
        this.buttons.start.innerHTML = `
            <span class="material-symbols-outlined">${useStopAction ? 'stop' : 'play_arrow'}</span>${useStopAction ? 'Stop' : 'Start'}
        `;
        this.buttons.start.disabled = disabling || !hasBot || isStopping || (!useStopAction && !jsRuntimeReady);

        this.buttons.restart.disabled = disabling || !hasBot || (!isRunning && !isStarting) || !jsRuntimeReady;
        this.buttons.kill.disabled = disabling || !hasBot;
    }

    _maybeEmitModuleStartSummary() {
        const pending = this.state.pendingStartSummary;
        if (!pending) return;

        const botState = this.state.activeBot?.state;
        if (!['running', 'error', 'stopped', 'idle'].includes(botState || '')) {
            return;
        }

        const normalizeToken = (value) => String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[._-]+/g, ' ')
            .replace(/\s+/g, ' ');
        const requestedModuleIds = Array.isArray(pending.requestedModules) ? pending.requestedModules : [];
        const requestedModuleSet = new Set(requestedModuleIds);
        const moduleMap = new Map(this.state.modules.map(module => [module.id, module]));
        const recentLogs = this.state.logs.filter(entry => (entry.seq || 0) > pending.afterSeq);

        const loadedTokens = new Set(
            recentLogs
                .map((entry) => {
                    const msg = typeof entry?.message === 'string' ? entry.message : '';
                    const match = msg.match(/^Loaded module:\s*(.+)$/i);
                    return match ? normalizeToken(match[1]) : null;
                })
                .filter(Boolean)
        );

        const failedTokens = new Set(
            recentLogs
                .map((entry) => {
                    const msg = typeof entry?.message === 'string' ? entry.message : '';
                    const match = msg.match(/^(.+?)\s+module failed:/i);
                    return match ? normalizeToken(match[1]) : null;
                })
                .filter(Boolean)
        );

        const toDisplayLabel = (moduleId) => {
            const moduleMeta = moduleMap.get(moduleId);
            if (moduleMeta?.name && moduleMeta.name !== moduleId) {
                return `${moduleMeta.name} (${moduleId})`;
            }
            return moduleId;
        };

        const successIds = [];
        const failedIds = [];
        for (const moduleId of requestedModuleIds) {
            const moduleMeta = moduleMap.get(moduleId);
            const candidates = new Set([
                normalizeToken(moduleId),
                normalizeToken(moduleMeta?.name),
                normalizeToken(String(moduleId).split('.').pop()),
            ]);

            let isLoaded = false;
            for (const candidate of candidates) {
                if (candidate && loadedTokens.has(candidate)) {
                    isLoaded = true;
                    break;
                }
            }

            if (isLoaded) {
                successIds.push(moduleId);
            } else {
                failedIds.push(moduleId);
            }
        }

        for (const moduleId of requestedModuleSet) {
            const moduleMeta = moduleMap.get(moduleId);
            const candidates = new Set([
                normalizeToken(moduleId),
                normalizeToken(moduleMeta?.name),
                normalizeToken(String(moduleId).split('.').pop()),
            ]);
            let markedAsFailed = false;
            for (const candidate of candidates) {
                if (candidate && failedTokens.has(candidate)) {
                    markedAsFailed = true;
                    break;
                }
            }
            if (markedAsFailed && !failedIds.includes(moduleId) && !successIds.includes(moduleId)) {
                failedIds.push(moduleId);
            }
        }

        const successText = successIds.length
            ? successIds.map(toDisplayLabel).join(', ')
            : 'none';
        const failedText = failedIds.length
            ? failedIds.map(toDisplayLabel).join(', ')
            : 'none';
        const summaryMessage = `Modules startup: success ${successIds.length}/${requestedModuleIds.length} [${successText}] | failed ${failedIds.length}/${requestedModuleIds.length} [${failedText}].`;

        this.state.lastSeq += 1;
        this.state.logs = [
            ...this.state.logs,
            {
                seq: this.state.lastSeq,
                timestamp: new Date().toISOString(),
                level: 'info',
                message: summaryMessage,
                metadata: { local: true },
            },
        ].slice(-500);
        this.state.pendingStartSummary = null;
    }

    _resolveStatusMeta(state) {
        const map = {
            running:  { icon: 'play_circle', label: 'Running', tone: 'success' },
            starting: { icon: 'pending', label: 'Starting', tone: 'info' },
            stopping: { icon: 'hourglass_bottom', label: 'Stopping', tone: 'warning' },
            error:    { icon: 'error', label: 'Error', tone: 'danger' },
            idle:     { icon: 'pause_circle', label: 'Idle', tone: 'muted' },
            stopped:  { icon: 'stop_circle', label: 'Stopped', tone: 'muted' },
        };
        return map[state] || map.stopped;
    }

    // --------------------------------------------------------------------- //
    // Action handlers
    // --------------------------------------------------------------------- //
    async _handleStartStop() {
        const bot = this.state.activeBot;
        if (!bot) return;

        if (bot.state === 'running' || bot.state === 'starting') {
            await this._handleStop();
            return;
        }

        await this._handleStart();
    }

    async _handleStart() {
        if (!this.state.activeBot) return;
        const requestedModules = Array.isArray(this.state.activeBot.modules) ? this.state.activeBot.modules : [];
        this.state.pendingStartSummary = {
            afterSeq: this.state.lastSeq,
            requestedModules,
        };
        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            await this.pluginApi.post(`/bots/${this.state.activeBot.bot_id}/start`);
            await this.refreshBots();
            this._scheduleMetadataRefresh(2500);
            showError('Start request sent.');
        } catch (error) {
            this.state.pendingStartSummary = null;
            console.error('[DiscordBot] Failed to start bot:', error);
            showError(`Unable to start bot: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    async _handleStop() {
        if (!this.state.activeBot) return;
        this.state.pendingStartSummary = null;
        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            await this.pluginApi.post(`/bots/${this.state.activeBot.bot_id}/stop`);
            await this.refreshBots();
            showError('Stop request sent.');
        } catch (error) {
            showError(`Unable to stop bot: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    async _handleRestart() {
        if (!this.state.activeBot) return;
        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            await this.pluginApi.post(`/bots/${this.state.activeBot.bot_id}/restart`);
            await this.refreshBots();
            this._scheduleMetadataRefresh(2500);
            showError('Restart request sent.');
        } catch (error) {
            showError(`Unable to restart bot: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    async _handleKill() {
        if (!this.state.activeBot) return;
        const confirmed = await Yuuka.ui.confirm('Kill the bot immediately?');
        if (!confirmed) return;

        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            await this.pluginApi.post(`/bots/${this.state.activeBot.bot_id}/kill`);
            await this.refreshBots();
            showError('Kill request sent.');
        } catch (error) {
            showError(`Unable to kill bot: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    async _handleFormSubmit(event) {
        event.preventDefault();
        const autoStart = this.autoStartCheckbox.checked;
        const saved = await this._saveBotConfiguration({
            modules: this._collectSelectedModules(),
            autoStart,
            showSuccessMessage: !autoStart,
        });
        if (saved && autoStart && this.state.activeBot) {
            await this._handleStart();
        }
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.pages = window.Yuuka.pages || {};
window.Yuuka.pages.discordBot = window.Yuuka.pages.discordBot || {};
window.Yuuka.pages.discordBot.DashboardPage = DiscordBotDashboardPage;
