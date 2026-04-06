class DiscordBotDashboardPage {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.pluginApi = this.api['discord-bot'];
        
        // Alias để dễ sử dụng utils trong các method
        this.Utils = window.Yuuka?.utils?.discordBot || {};

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
        this._handleAutoStartToggle = this._handleAutoStartToggle.bind(this);
        this._handleModuleGridClick = this._handleModuleGridClick.bind(this);
        this._handleModuleGridChange = this._handleModuleGridChange.bind(this);
        this._handleModulePageBack = this._handleModulePageBack.bind(this);
        this._handleModulePageClick = this._handleModulePageClick.bind(this);
        this._handleModulePageChange = this._handleModulePageChange.bind(this);
        this._handleConsoleTabClick = this._handleConsoleTabClick.bind(this);
        this._handleNewBot = this._handleNewBot.bind(this);
        this._handleDeleteBot = this._handleDeleteBot.bind(this);
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
            <div class="discord-bot-layout">
                <aside class="discord-bot-sidebar">
                    <div class="discord-bot-selector" data-role="bot-selector"></div>
                    <button class="discord-bot-sidebar__new" data-action="new-bot" title="New Bot">
                        <span class="material-symbols-outlined">add</span>
                    </button>
                </aside>
                <main class="discord-bot-main-content">
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
                                        <button class="discord-bot-btn discord-bot-btn--danger" data-action="kill" disabled title="Force stop the process">
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
                </main>
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
        this.botSelectorEl = this.container.querySelector('[data-role="bot-selector"]');
        this.newBotBtn = this.container.querySelector('button[data-action="new-bot"]');
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
        this.autoStartCheckbox.addEventListener('change', this._handleAutoStartToggle);
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
        if (this.newBotBtn) {
            this.newBotBtn.addEventListener('click', this._handleNewBot);
        }
        if (this.botSelectorEl) {
            this.botSelectorEl.addEventListener('click', async (e) => {
                const deleteBtn = e.target.closest('[data-action="delete-bot"]');
                if (deleteBtn) {
                    const botId = deleteBtn.getAttribute('data-bot-id');
                    await this._handleDeleteBot(botId);
                    return;
                }
                const item = e.target.closest('.discord-bot-sidebar-icon');
                if (item) {
                    const botId = item.getAttribute('data-bot-id');
                    const bot = this.state.bots.find(b => b.bot_id === botId);
                    if (bot && (!this.state.activeBot || bot.bot_id !== this.state.activeBot.bot_id)) {
                        this.state.activeBot = bot;
                        this.state.logs = [];
                        this.state.lastSeq = 0;
                        await this._loadInitialLogs();
                        await this.refreshBots();
                    }
                }
            });
        }
    }

    async _handleAutoStartToggle() {
        if (!this.state.activeBot) return;
        await this._saveBotConfiguration({
            modules: this._collectSelectedModules(),
            autoStart: this.autoStartCheckbox.checked,
            showSuccessMessage: false,
        });
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

            // Sync auto-start checkbox với bot config
            if (this.state.activeBot && this.autoStartCheckbox) {
                this.autoStartCheckbox.checked = Boolean(this.state.activeBot.auto_start);
            }

            this._renderModuleOptions();
            this._renderModulePage();
            this._renderStatusRow();
            this._renderInfoRow();
            this._renderBotSelector();
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
            const displayName = this.Utils.getBotDisplayName(bot) || 'this bot';
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
                const formattedTs = this.Utils.formatDisplayTimestamp(entry.timestamp);
                const levelLabel = (levelKey || 'info').toUpperCase();
                const msg = (entry.message || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                return `<div class="discord-log ${levelClass}">
                    <div class="discord-log__meta">
                        <span class="discord-log__ts">${this.Utils.escapeHtml(formattedTs)}</span>
                        <span class="discord-log__level">${this.Utils.escapeHtml(levelLabel)}</span>
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
                
                const formattedTs = this.Utils.formatDisplayTimestamp(entry.timestamp);
                const guildCh = `[${this.Utils.escapeHtml(payload.guild || '')} - ${this.Utils.escapeHtml(payload.channel || '')}]`;
                const author = this.Utils.escapeHtml(payload.author || '');
                const response = this.Utils.escapeHtml(payload.response || '');
                
                let promptHtml = '';
                if (Array.isArray(payload.prompt)) {
                    promptHtml = payload.prompt.map(msg => {
                        const r = this.Utils.escapeHtml(msg.role);
                        const c = this.Utils.escapeHtml(msg.content);
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
        const activeContainer = this.state.activeConsoleTab === 'log' ? this.consoleEl : this.consoleMessageEl;
        this.Utils.scrollToBottom(activeContainer, this.autoScrollCheckbox);
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

        const statusMeta = this.Utils.resolveStatusMeta(bot.state);
        this.statusEl.className = `discord-bot-status discord-bot-status--${statusMeta.tone}`;
        const hint = !this.state.jsRuntimeAvailable
            ? 'Install Node.js and discord.js dependencies to run Discord bots.'
            : (bot.last_error ? `Last error: ${bot.last_error}` : '');
        const safeLabel = this.Utils.escapeHtml(statusMeta.label);
        const safeHint = this.Utils.escapeHtml(hint);

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
            const moduleNames = this.state.modules.map(m => this.Utils.escapeHtml(m.name)).join(', ') || '---';
            this.infoEl.innerHTML = `
                <div class="discord-bot-info__item">
                    <span class="label">Available Modules</span>
                    <span class="value">${moduleNames}</span>
                </div>
            `;
            return;
        }

        const taskInfo = bot.task || {};
        const displayName = this.Utils.getBotDisplayName(bot) || '---';
        const modulesText = bot.modules && bot.modules.length ? bot.modules.join(', ') : '---';
        const intentsText = bot.intents && bot.intents.length ? bot.intents.join(', ') : 'Default';
        const threadText = taskInfo.is_running ? 'Running' : (taskInfo.status || '---');
        const uptimeInitial = this.Utils.computeUptimeText(bot);
        const lastUpdateText = this.Utils.formatDisplayTimestamp(bot.updated_at);

        const items = [
            { label: 'Bot ID', value: bot.actual_id || bot.bot_id },
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
                <span class="label">${this.Utils.escapeHtml(item.label)}</span>
                <span class="value">${this.Utils.escapeHtml(item.value)}</span>
            </div>
        `);

        infoHtml.push(`
            <div class="discord-bot-info__item">
                <span class="label">Uptime</span>
                <span class="value" data-role="uptime-value">${this.Utils.escapeHtml(uptimeInitial)}</span>
            </div>
        `);

        // Thêm Invite link nếu có actual_id (client_id)
        if (bot.actual_id) {
            const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${bot.actual_id}&permissions=8&scope=bot`;
            const shortUrl = inviteUrl.length > 50 ? inviteUrl.substring(0, 47) + '...' : inviteUrl;

            infoHtml.push(`
                <div class="discord-bot-info__item">
                    <span class="label">Invite</span>
                    <span class="value" style="display: flex; align-items: center; gap: 8px;">
                        <a href="${this.Utils.escapeHtml(inviteUrl)}" target="_blank" rel="noopener noreferrer" 
                           style="color: var(--color-accent); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;"
                           title="${this.Utils.escapeHtml(inviteUrl)}">
                            ${this.Utils.escapeHtml(shortUrl)}
                        </a>
                        <button type="button" class="discord-bot-btn discord-bot-btn--sm" 
                                data-action="copy-invite" data-url="${this.Utils.escapeHtml(inviteUrl)}"
                                title="Copy invite link"
                                style="padding: 4px 8px; min-width: auto;">
                            <span class="material-symbols-outlined" style="font-size: 18px;">content_copy</span>
                        </button>
                    </span>
                </div>
            `);
        }

        // Dev Portal link (hiển thị kể cả khi chưa có actual_id)
        const devPortalUrl = bot.actual_id 
            ? `https://discord.com/developers/applications/${bot.actual_id}/bot`
            : `https://discord.com/developers/applications`;
        const shortDevPortalUrl = devPortalUrl.length > 50 ? devPortalUrl.substring(0, 47) + '...' : devPortalUrl;

        infoHtml.push(`
            <div class="discord-bot-info__item">
                <span class="label">Dev Portal</span>
                <span class="value" style="display: flex; align-items: center; gap: 8px;">
                    <a href="${this.Utils.escapeHtml(devPortalUrl)}" target="_blank" rel="noopener noreferrer" 
                       style="color: var(--color-accent); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;"
                       title="${this.Utils.escapeHtml(devPortalUrl)}">
                        ${this.Utils.escapeHtml(shortDevPortalUrl)}
                    </a>
                    <a href="${this.Utils.escapeHtml(devPortalUrl)}" target="_blank" rel="noopener noreferrer" 
                       class="discord-bot-btn discord-bot-btn--sm" 
                       title="Open Developer Portal"
                       style="padding: 4px 8px; min-width: auto; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; color: var(--color-primary-text);">
                        <span class="material-symbols-outlined" style="font-size: 18px;">open_in_new</span>
                    </a>
                </span>
            </div>
        `);

        this.infoEl.innerHTML = infoHtml.join('');

        // Attach copy handler
        const copyBtn = this.infoEl.querySelector('[data-action="copy-invite"]');
        if (copyBtn) {
            copyBtn.addEventListener('click', async (e) => {
                const url = e.currentTarget.getAttribute('data-url');
                if (url) {
                    try {
                        await navigator.clipboard.writeText(url);
                        const icon = copyBtn.querySelector('.material-symbols-outlined');
                        const originalText = icon.textContent;
                        icon.textContent = 'check';
                        setTimeout(() => {
                            icon.textContent = originalText;
                        }, 2000);
                    } catch (error) {
                        console.error('[DiscordBot] Failed to copy invite link:', error);
                        showError('Failed to copy invite link.');
                    }
                }
            });
        }
    }

    _updateConsoleTitle() {
        if (!this.consoleTitleEl) return;
        const bot = this.state.activeBot;
        const displayName = this.Utils.getBotDisplayName(bot);
        if (displayName) {
            this.consoleTitleEl.textContent = `${displayName} console`;
        } else {
            this.consoleTitleEl.textContent = 'Bot console';
        }
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
            uptimeEl.textContent = bot.state === 'running' ? this.Utils.formatDuration(diffMs) : '--';
        };

        if (bot.state === 'running' && started && !Number.isNaN(started.getTime())) {
            updateValue();
            this._uptimeTimer = setInterval(updateValue, 1000);
        } else {
            uptimeEl.textContent = this.Utils.computeUptimeText(bot);
        }
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
        const groups = this.Utils.groupModulesByType(this.state.modules);

        const buildModuleCard = (module) => {
            if (!module || !module.id) {
                return '';
            }
            const moduleType = this.Utils.getModuleType(module);
            const isCore = moduleType === 'core';
            const isChecked = isCore || activeModules.has(module.id);
            const checked = isChecked ? 'checked' : '';
            const disabled = isCore ? 'disabled' : '';
            const safeId = this.Utils.escapeHtml(module.id);
            const safeName = this.Utils.escapeHtml(module.name || module.id);
            const safeDesc = this.Utils.escapeHtml(module.description || 'No description available.');
            const safeType = this.Utils.escapeHtml(moduleType);
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

    async _handleModulePageClick(event) {
        if (await this._forwardModulePageEventToRenderer('onClick', event)) {
            return;
        }

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
        if (await this._forwardModulePageEventToRenderer('onChange', event)) {
            return;
        }

        const brainToolToggle = event.target.closest('[data-role="brain-tool-toggle"]');
        if (brainToolToggle && this.modulePageBodyEl.contains(brainToolToggle)) {
            await this._saveBrainToolStateFromModulePage();
            return;
        }

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

    async _saveBrainToolStateFromModulePage() {
        const bot = this.state.activeBot;
        if (!bot || !this.modulePageBodyEl) {
            return;
        }
        const toggles = {};
        this.modulePageBodyEl.querySelectorAll('[data-role="brain-tool-toggle"]').forEach((input) => {
            const toolKey = input.getAttribute('data-tool-key');
            if (!toolKey) return;
            toggles[toolKey] = Boolean(input.checked);
        });
        await this._saveBotConfiguration({
            showSuccessMessage: false,
            extraProps: {
                brain_tools: {
                    toggles
                }
            }
        });
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

            const cacheKey = this.Utils.createModuleUiCacheKey(this.state.activeModulePage, bot.bot_id);
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

    _openModulePage(moduleId) {
        if (!moduleId) return;
        this.state.activeModulePage = moduleId;
        this._renderModulePage();
        this._loadModuleUi(moduleId);
    }

    async _loadModuleUi(moduleId) {
        if (!moduleId) return;
        const cacheKey = this.Utils.createModuleUiCacheKey(moduleId, this.state.activeBot?.bot_id);
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

    _invalidateModuleUiCache(moduleId, botId = this.state.activeBot?.bot_id) {
        if (!moduleId) {
            return;
        }
        const cacheKey = this.Utils.createModuleUiCacheKey(moduleId, botId);
        delete this.state.moduleUiCache[cacheKey];
        delete this.state.moduleUiLoading[moduleId];
    }

    _parseChannelIdList(value) {
        if (!value || typeof value !== 'string') {
            return [];
        }
        return value.split(',').map(v => v.trim()).filter(Boolean);
    }

    _setPolicyCardSaving(policyCard, isSaving) {
        if (!policyCard) return;
        if (isSaving) {
            policyCard.style.opacity = '0.6';
            policyCard.style.pointerEvents = 'none';
        } else {
            policyCard.style.opacity = '';
            policyCard.style.pointerEvents = '';
        }
    }

    async _refreshActiveModulePageUi() {
        const moduleId = this.state.activeModulePage;
        if (!moduleId) {
            return;
        }
        this._invalidateModuleUiCache(moduleId);
        await this._loadModuleUi(moduleId);
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
        const moduleType = this.Utils.getModuleType(module);
        const isEnabled = activeModules.has(module.id);
        const isLoading = Boolean(this.state.moduleUiLoading[module.id]);
        const cacheKey = this.Utils.createModuleUiCacheKey(moduleId, this.state.activeBot?.bot_id);
        const moduleUi = this.state.moduleUiCache[cacheKey] || module.ui || {};
        const summaryText = this.Utils.escapeHtml(moduleUi?.summary || module.description || 'No description provided for this module yet.');

        const specialRendererBlock = this._renderSpecialModuleUi(module, moduleUi);
        const sectionBlocks = specialRendererBlock || (Array.isArray(moduleUi?.sections)
            ? moduleUi.sections.map(section => this._renderModuleUiSection(section)).filter(Boolean).join('')
            : '');

        const loadingBlock = isLoading
            ? '<div class="discord-bot-module-page-loading">Loading module UI...</div>'
            : '';

        const errorBlock = moduleUi && moduleUi._error
            ? `<div class="discord-bot-module-page-error">${this.Utils.escapeHtml(moduleUi._error)}</div>`
            : '';

        const fallbackBlock = (!isLoading && !sectionBlocks && !errorBlock)
            ? `<div class="discord-bot-module-page-placeholder">${this.Utils.escapeHtml(module.id)}</div>`
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

        const title = this.Utils.escapeHtml(section.title || 'Section');
        const text = typeof section.text === 'string' ? this.Utils.escapeHtml(section.text) : '';
        const code = typeof section.code === 'string' ? this.Utils.escapeHtml(section.code) : '';

        let itemsHtml = '';
        if (Array.isArray(section.items) && section.items.length) {
            itemsHtml = `
                <ul class="discord-bot-module-ui-list">
                    ${section.items.map((item) => {
                        if (item && typeof item === 'object') {
                            const label = this.Utils.escapeHtml(item.label || '');
                            const value = this.Utils.escapeHtml(item.value || '');
                            return `<li class="discord-bot-module-ui-item"><span class="discord-bot-module-ui-item__label">${label}</span><span class="discord-bot-module-ui-item__value">${value}</span></li>`;
                        }
                        const value = this.Utils.escapeHtml(String(item ?? ''));
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

    _collectSelectedModules() {
        return this.Utils.collectSelectedModules(this.moduleGridEl, this.state.modules);
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
        if (!moduleUi || !moduleUi.renderer) return '';
        if (window.Yuuka?.plugins?.discordBotRenderers) {
            const renderer = window.Yuuka.plugins.discordBotRenderers[moduleUi.renderer];
            if (renderer && typeof renderer.render === 'function') {
                return renderer.render(this, module, moduleUi);
            }
        }
        return '';
    }

    _getActiveModuleRenderer() {
        const moduleId = this.state.activeModulePage;
        if (!moduleId) {
            return null;
        }
        const module = this.state.modules.find((item) => item.id === moduleId);
        if (!module) {
            return null;
        }
        const cacheKey = this.Utils.createModuleUiCacheKey(moduleId, this.state.activeBot?.bot_id);
        const moduleUi = this.state.moduleUiCache[cacheKey] || module.ui || {};
        const rendererName = moduleUi?.renderer;
        if (!rendererName) {
            return null;
        }
        return window.Yuuka?.plugins?.discordBotRenderers?.[rendererName] || null;
    }

    async _forwardModulePageEventToRenderer(handlerName, event) {
        const renderer = this._getActiveModuleRenderer();
        if (!renderer || typeof renderer[handlerName] !== 'function') {
            return false;
        }
        try {
            return Boolean(await renderer[handlerName](this, event));
        } catch (error) {
            console.error('[DiscordBot] Renderer event handler failed:', error);
            return false;
        }
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

        const requestedModuleIds = Array.isArray(pending.requestedModules) ? pending.requestedModules : [];
        const requestedModuleSet = new Set(requestedModuleIds);
        const moduleMap = new Map(this.state.modules.map(module => [module.id, module]));
        const recentLogs = this.state.logs.filter(entry => (entry.seq || 0) > pending.afterSeq);

        const loadedTokens = new Set(
            recentLogs
                .map((entry) => {
                    const msg = typeof entry?.message === 'string' ? entry.message : '';
                    const match = msg.match(/^Loaded module:\s*(.+)$/i);
                    return match ? this.Utils.normalizeToken(match[1]) : null;
                })
                .filter(Boolean)
        );

        const failedTokens = new Set(
            recentLogs
                .map((entry) => {
                    const msg = typeof entry?.message === 'string' ? entry.message : '';
                    const match = msg.match(/^(.+?)\s+module failed:/i);
                    return match ? this.Utils.normalizeToken(match[1]) : null;
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
                this.Utils.normalizeToken(moduleId),
                this.Utils.normalizeToken(moduleMeta?.name),
                this.Utils.normalizeToken(String(moduleId).split('.').pop()),
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
                this.Utils.normalizeToken(moduleId),
                this.Utils.normalizeToken(moduleMeta?.name),
                this.Utils.normalizeToken(String(moduleId).split('.').pop()),
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
            
            // Clear logs and console UI
            this.state.logs = [];
            this.state.lastSeq = 0;
            this._renderConsole();
            
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

    _renderBotSelector() {
        if (!this.botSelectorEl) return;
        const bots = this.state.bots || [];
        this.botSelectorEl.innerHTML = bots.map(bot => {
            const isActive = this.state.activeBot && bot.bot_id === this.state.activeBot.bot_id;
            const statusMeta = this.Utils.resolveStatusMeta(bot.state);
            const displayName = bot.name || bot.bot_id;
            const initial = displayName.charAt(0).toUpperCase();
            const avatarUrl = bot.avatar_url;
            const isOffline = bot.state === 'stopped' || bot.state === 'error';
            
            return `
                <div class="discord-bot-sidebar-icon-wrap">
                    <div class="discord-bot-sidebar-icon ${isActive ? 'active' : ''} ${isOffline ? 'discord-bot-sidebar-icon--offline' : ''} discord-bot-status-border--${statusMeta.tone}" 
                         data-bot-id="${bot.bot_id}" title="${this.Utils.escapeHtml(displayName)}">
                        ${avatarUrl ? `<img src="${this.Utils.escapeHtml(avatarUrl)}" alt="${this.Utils.escapeHtml(displayName)}" />` : initial}
                    </div>
                    <button class="discord-bot-sidebar-delete" data-action="delete-bot" data-bot-id="${bot.bot_id}" title="Delete bot">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
            `;
        }).join('');

        // Ẩn/hiện nút "New Bot" dựa trên giới hạn
        if (this.newBotBtn) {
            if (bots.length >= 5) {
                this.newBotBtn.style.display = 'none';
            } else {
                this.newBotBtn.style.display = 'flex';
            }
        }
    }

    async _handleNewBot() {
        if (this.state.isSubmitting) return;

        // Giới hạn tối đa 5 bot
        if (this.state.bots && this.state.bots.length >= 5) {
            if (window.showError) {
                window.showError('Bạn đã đạt giới hạn tối đa 5 bot. Vui lòng xóa bot cũ trước khi tạo bot mới.');
            }
            return;
        }

        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            const payload = {
                token: '',
                name: 'New Discord Bot',
                auto_start: false,
                modules: [],
            };
            const response = await this.pluginApi.post('/bots', payload);

            // Re-fetch the list to get the new bot object
            const listResponse = await this.pluginApi.get('/bots');
            this.state.bots = listResponse.bots || [];

            if (response.bot_id) {
                const newBot = this.state.bots.find(b => b.bot_id === response.bot_id);
                if (newBot) {
                    this.state.activeBot = newBot;
                    this.state.logs = [];
                    this.state.lastSeq = 0;
                    // Fully refresh the UI for the new bot
                    await this.refreshBots();
                }
            }
        } catch (error) {
            console.error('[DiscordBot] Failed to create new bot:', error);
            if (window.showError) window.showError(`Unable to create bot: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    async _handleDeleteBot(botId) {
        if (!botId) return;
        const confirmed = await confirm(`Are you sure you want to delete bot "${botId}"?`);
        if (!confirmed) return;

        try {
            await this.pluginApi.delete(`/bots/${botId}`);
            if (this.state.activeBot && this.state.activeBot.bot_id === botId) {
                this.state.activeBot = null;
                this.state.logs = [];
                this.state.lastSeq = 0;
            }
            await this.refreshBots();
        } catch (error) {
            console.error('[DiscordBot] Failed to delete bot:', error);
        }
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.pages = window.Yuuka.pages || {};
window.Yuuka.pages.discordBot = window.Yuuka.pages.discordBot || {};
window.Yuuka.pages.discordBot.DashboardPage = DiscordBotDashboardPage;
