class DiscordBotDashboardPage {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.pluginApi = this.api['discord-bot'];

        this.state = {
            bots: [],
            activeBot: null,
            logs: [],
            lastSeq: 0,
            pollingTimer: null,
            pyCordAvailable: true,
            modules: [],
            isSubmitting: false,
        };
        this._uptimeTimer = null;
        this._refreshTimeout = null;

        this._handleStart = this._handleStart.bind(this);
        this._handleStop = this._handleStop.bind(this);
        this._handleRestart = this._handleRestart.bind(this);
        this._handleKill = this._handleKill.bind(this);
        this._handleFormSubmit = this._handleFormSubmit.bind(this);
        this._handleAutoScrollToggle = this._handleAutoScrollToggle.bind(this);
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
                            <label class="discord-bot-autoscroll">
                                <input type="checkbox" data-role="auto-scroll" checked />
                                <span>Auto scroll</span>
                            </label>
                        </div>
                        <div class="discord-bot-console-body" data-role="console"></div>
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
                                <button class="discord-bot-btn discord-bot-btn--stop" data-action="stop" disabled>
                                    <span class="material-symbols-outlined">stop</span>Stop
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
                </div>
                <div class="discord-bot-row discord-bot-row--form">
                    <form data-role="config-form" autocomplete="off">
                        <div class="discord-bot-field">
                            <label for="discord-bot-token">Discord Bot Token</label>
                            <div class="discord-bot-token-field">
                                <input id="discord-bot-token" type="password" data-role="token-input" placeholder="Paste bot token..." required />
                                <button type="submit" class="discord-bot-btn discord-bot-btn--accent">
                                    <span class="material-symbols-outlined">link</span>Connect
                                </button>
                            </div>
                        </div>
                        <div class="discord-bot-field">
                            <label>Modules</label>
                            <div class="discord-bot-module-grid" data-role="module-grid"></div>
                        </div>
                        <label class="discord-bot-checkbox">
                            <input type="checkbox" data-role="auto-start" />
                            <span>Auto start immediately after connect</span>
                        </label>
                    </form>
                </div>
            </div>
        `;

        this.consoleTitleEl = this.container.querySelector('[data-role="console-title"]');
        this.consoleEl = this.container.querySelector('[data-role="console"]');
        this.statusEl = this.container.querySelector('[data-role="status-indicator"]');
        this.infoEl = this.container.querySelector('[data-role="info"]');
        this.moduleGridEl = this.container.querySelector('[data-role="module-grid"]');
        this.formEl = this.container.querySelector('[data-role="config-form"]');
        this.tokenInput = this.container.querySelector('[data-role="token-input"]');
        this.autoStartCheckbox = this.container.querySelector('[data-role="auto-start"]');
        this.autoScrollCheckbox = this.container.querySelector('[data-role="auto-scroll"]');
        this.buttons = {
            start: this.container.querySelector('button[data-action="start"]'),
            stop: this.container.querySelector('button[data-action="stop"]'),
            restart: this.container.querySelector('button[data-action="restart"]'),
            kill: this.container.querySelector('button[data-action="kill"]'),
        };
    }

    _attachHandlers() {
        this.buttons.start.addEventListener('click', this._handleStart);
        this.buttons.stop.addEventListener('click', this._handleStop);
        this.buttons.restart.addEventListener('click', this._handleRestart);
        this.buttons.kill.addEventListener('click', this._handleKill);
        this.formEl.addEventListener('submit', this._handleFormSubmit);
        this.autoScrollCheckbox.addEventListener('change', this._handleAutoScrollToggle);
    }

    _handleAutoScrollToggle() {
        if (this.autoScrollCheckbox.checked) {
            this._scrollConsoleToBottom();
        }
    }

    // --------------------------------------------------------------------- //
    // Data loading
    // --------------------------------------------------------------------- //
    async refreshBots() {
        try {
            const response = await this.pluginApi.get('/bots');
            this.state.pyCordAvailable = Boolean(response.py_cord_available);
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

            this._renderModuleOptions();
            this._renderStatusRow();
            this._renderInfoRow();
            this._updateConsoleTitle();
            this._setupUptimeTicker();
            const needsNameRefresh = this.state.activeBot && this.state.activeBot.state === 'running' && !this.state.activeBot.actual_name;
            if (needsNameRefresh) {
                this._scheduleMetadataRefresh(2000);
            }
            this._updateButtons();
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
        if (autoStick) {
            const nearBottom = (this.consoleEl.scrollTop + this.consoleEl.clientHeight) >= (this.consoleEl.scrollHeight - 32);
            if (!nearBottom) {
                this.autoScrollCheckbox.checked = false;
            }
        }

        const lines = this.state.logs.map(entry => {
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
        this._scrollConsoleToBottom();
    }

    _scrollConsoleToBottom() {
        if (!this.autoScrollCheckbox.checked) return;
        requestAnimationFrame(() => {
            this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
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
                    <span class="discord-bot-status__hint">${this.state.pyCordAvailable ? 'Provide a token to create one.' : 'py-cord is not installed.'}</span>
                </div>
            `;
            return;
        }

        const statusMeta = this._resolveStatusMeta(bot.state);
        this.statusEl.className = `discord-bot-status discord-bot-status--${statusMeta.tone}`;
        const hint = !this.state.pyCordAvailable
            ? 'Install the py-cord package to run Discord bots.'
            : `Modules: ${bot.modules && bot.modules.length ? bot.modules.join(', ') : 'none'}`;
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

        if (!this.state.pyCordAvailable) {
            items.push({ label: 'py-cord', value: 'Not installed (install py-cord)' });
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
        if (!this.moduleGridEl) return;
        if (!this.state.modules.length) {
            this.moduleGridEl.innerHTML = `<div class="discord-bot-module-placeholder">No modules available.</div>`;
            return;
        }

        const activeModules = new Set(this.state.activeBot?.modules || []);
        this.moduleGridEl.innerHTML = this.state.modules.map(module => {
            const checked = activeModules.has(module.id) ? 'checked' : '';
            const safeId = this._escapeHtml(module.id);
            const safeName = this._escapeHtml(module.name || module.id);
            const safeDesc = this._escapeHtml(module.description || '');
            return `
                <label class="discord-bot-module">
                    <input type="checkbox" value="${safeId}" ${checked}/>
                    <div>
                        <span class="module-name">${safeName}</span>
                        <span class="module-desc">${safeDesc}</span>
                    </div>
                </label>
            `;
        }).join('');
    }

    _updateButtons() {
        const bot = this.state.activeBot;
        const pyCordReady = this.state.pyCordAvailable;
        const isRunning = bot && bot.state === 'running';
        const isStarting = bot && bot.state === 'starting';
        const hasBot = Boolean(bot);
        const disabling = this.state.isSubmitting;

        this.buttons.start.disabled = disabling || !hasBot || !pyCordReady || isRunning || isStarting;
        this.buttons.stop.disabled = disabling || !hasBot || (!isRunning && !isStarting);
        this.buttons.restart.disabled = disabling || !hasBot || (!isRunning && !isStarting) || !pyCordReady;
        this.buttons.kill.disabled = disabling || !hasBot;
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
    async _handleStart() {
        if (!this.state.activeBot) return;
        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            await this.pluginApi.post(`/bots/${this.state.activeBot.bot_id}/start`);
            await this.refreshBots();
            this._scheduleMetadataRefresh(2500);
            showError('Start request sent.');
        } catch (error) {
            console.error('[DiscordBot] Failed to start bot:', error);
            showError(`Unable to start bot: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }

    async _handleStop() {
        if (!this.state.activeBot) return;
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
        const token = this.tokenInput.value.trim();
        if (!token) {
            showError('Please enter a valid bot token.');
            return;
        }

        const selectedModules = Array
            .from(this.moduleGridEl.querySelectorAll('input[type="checkbox"]:checked'))
            .map(input => input.value);
        const autoStart = this.autoStartCheckbox.checked;

        this.state.isSubmitting = true;
        this._updateButtons();
        try {
            const payload = {
                bot_id: this.state.activeBot?.bot_id || 'default',
                token,
                modules: selectedModules,
                auto_start: autoStart,
                name: this.state.activeBot?.name || 'My Discord Bot',
            };
            await this.pluginApi.post('/bots', payload);
            await this.refreshBots();
            this.tokenInput.value = '';
            if (autoStart && this.state.activeBot) {
                await this._handleStart();
            }
            showError('Bot configuration saved.');
        } catch (error) {
            console.error('[DiscordBot] Failed to save configuration:', error);
            showError(`Unable to save bot configuration: ${error.message}`);
        } finally {
            this.state.isSubmitting = false;
            this._updateButtons();
        }
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.pages = window.Yuuka.pages || {};
window.Yuuka.pages.discordBot = window.Yuuka.pages.discordBot || {};
window.Yuuka.pages.discordBot.DashboardPage = DiscordBotDashboardPage;
