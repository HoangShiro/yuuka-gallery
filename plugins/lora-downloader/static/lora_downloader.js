class LoraDownloaderService {
    constructor(container, api, activePlugins = []) {
        this.api = api;
        this.activePlugins = Array.isArray(activePlugins) ? activePlugins : [];
        this._albumPluginEnabled = Boolean(this.api?.album && this.activePlugins.some(plugin => plugin.id === 'album'));
        this.isOpen = false;
        this.overlay = null;
        this.form = null;
        this.activityContainer = null;
        this.submitButton = null;
        this.serverInput = null;
        this.urlInput = null;
        this.apiKeyInput = null;
        this.taskPollTimer = null;
        this.state = {
            tasks: [],
            models: [],
            defaultServer: '',
            searchQuery: '',
            remoteResults: [],
        };
        this._userPrefKey = null;
        this._knownStoredTaskIds = new Set();

        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleActivityClick = this.handleActivityClick.bind(this);
    }

    start() {
        this.toggle();
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    async open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this._buildOverlay();
        await this._loadInitialData();
        // Evaluate whether we should start polling based on current tasks
        this._evaluatePolling();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this._stopPolling();
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
        this.state.searchQuery = '';
        this.state.remoteResults = [];
        if (this.overlay) {
            this.overlay.removeEventListener('click', this.handleBackdropClick);
            this.overlay.remove();
            this.form = null;
            this.activityContainer = null;
            this.submitButton = null;
            this.serverInput = null;
            this.urlInput = null;
            this.apiKeyInput = null;
            this.overlay = null;
        }
        document.removeEventListener('keydown', this.handleKeydown);
        document.body.classList.remove('lora-downloader-open');
    }

    // ---------------------------------------------------------------------
    // UI construction
    // ---------------------------------------------------------------------

    _buildOverlay() {
        if (this.overlay) return;

        document.body.classList.add('lora-downloader-open');

        this._knownStoredTaskIds.clear();
        const overlay = document.createElement('div');
        overlay.className = 'lora-downloader-overlay';
        overlay.innerHTML = `
            <div class="lora-downloader-backdrop"></div>
            <div class="lora-downloader-panel">
                <header class="lora-downloader-header">
                    <div>
                        <h2>LoRA Downloader</h2>
                        <p>Gửi URL Civitai tới ComfyUI để tải và lưu metadata.</p>
                    </div>
                    <button class="lora-downloader-close" title="Đóng">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </header>
                <div class="lora-downloader-body">
                    <section class="lora-downloader-section lora-downloader-form-section">
                        <form class="lora-downloader-form">
                            <div class="lora-downloader-form-card">
                                <div class="lora-downloader-form-row lora-downloader-form-row--primary">
                                    <label class="lora-form-field lora-form-field--url">
                                        <span>URL Civitai</span>
                                        <input type="text" name="civitai_url" placeholder="Dán URL/ID để tải, hoặc nhập tên để tìm" required>
                                    </label>
                                    <div class="lora-downloader-form-actions">
                                        <button type="submit" class="lora-form-action lora-form-action--download" title="Tải LoRA" aria-label="Tải LoRA">
                                            <span class="material-symbols-outlined">cloud_download</span>
                                        </button>
                                        <button type="button" class="lora-form-action lora-form-action--exit" title="Thoát" aria-label="Thoát">
                                            <span class="material-symbols-outlined">logout</span>
                                        </button>
                                        <button type="button" class="lora-form-action lora-form-action--toggle" title="Thu gọn" aria-label="Thu gọn" aria-expanded="true">
                                            <span class="material-symbols-outlined">unfold_less</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="lora-downloader-form-collapsible">
                                    <div class="lora-downloader-field-grid">
                                        <label>
                                            <span>Máy chủ ComfyUI</span>
                                            <input type="text" name="server_address" placeholder="127.0.0.1:8888" required>
                                        </label>
                                        <label>
                                            <span>API Key (tùy chọn)</span>
                                            <input type="password" name="api_key" placeholder="Để trống nếu dùng mặc định">
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </section>
                    <section class="lora-downloader-section lora-downloader-activity-section">
                        <header class="lora-downloader-subheader">
                            <div>
                                <h3 class="lora-list-title">Danh sách LoRA</h3>
                                <p>Theo dõi tiến trình tải và các LoRA đã lưu.</p>
                            </div>
                            <div class="lora-downloader-subheader-actions">
                                <button type="button" class="btn-copy-ids" title="Sao chép ID LoRA" aria-label="Sao chép ID LoRA">
                                    <span class="material-symbols-outlined">content_copy</span>
                                </button>
                                <button type="button" class="btn-refresh" title="Làm mới danh sách">
                                    <span class="material-symbols-outlined">refresh</span>
                                </button>
                            </div>
                        </header>
                        <div class="lora-downloader-activity-list"></div>
                    </section>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        this.overlay = overlay;
        this.form = overlay.querySelector('.lora-downloader-form');
        this.activityContainer = overlay.querySelector('.lora-downloader-activity-list');
        this.submitButton = overlay.querySelector('.lora-form-action--download');
        this.serverInput = overlay.querySelector('input[name="server_address"]');
        this.urlInput = overlay.querySelector('input[name="civitai_url"]');
        this.apiKeyInput = overlay.querySelector('input[name="api_key"]');
        this._searchDebounceTimer = null;
        this._latestSearchToken = 0;

        const closeBtn = overlay.querySelector('.lora-downloader-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
        overlay.addEventListener('click', this.handleBackdropClick);
        document.addEventListener('keydown', this.handleKeydown);

        const exitBtn = overlay.querySelector('.lora-form-action--exit');
        if (exitBtn) {
            exitBtn.addEventListener('click', (event) => {
                event.preventDefault();
                this.close();
            });
        }

        const toggleBtn = overlay.querySelector('.lora-form-action--toggle');
        const collapsible = overlay.querySelector('.lora-downloader-form-collapsible');
        const formCard = overlay.querySelector('.lora-downloader-form-card');
        if (toggleBtn && collapsible && formCard) {
            const icon = toggleBtn.querySelector('.material-symbols-outlined');
            const updateToggleState = (collapsed) => {
                formCard.classList.toggle('is-collapsed', collapsed);
                if (collapsed) {
                    collapsible.setAttribute('hidden', 'hidden');
                } else {
                    collapsible.removeAttribute('hidden');
                }
                if (icon) {
                    icon.textContent = collapsed ? 'expand_all' : 'unfold_less';
                }
                toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                const label = collapsed ? 'Mở rộng' : 'Thu gọn';
                toggleBtn.setAttribute('title', label);
                toggleBtn.setAttribute('aria-label', label);
            };
            // Default to collapsed state on open
            updateToggleState(true);
            toggleBtn.addEventListener('click', (event) => {
                event.preventDefault();
                const collapsed = !formCard.classList.contains('is-collapsed');
                updateToggleState(collapsed);
            });
        }

        const refreshBtn = overlay.querySelector('.btn-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this._manualRefresh());
        }

        const copyIdsBtn = overlay.querySelector('.btn-copy-ids');
        if (copyIdsBtn) {
            copyIdsBtn.addEventListener('click', () => this._copyAllLoraIds());
        }

        if (this.activityContainer) {
            this.activityContainer.addEventListener('click', this.handleActivityClick);
        }

        if (this.form) {
            this.form.addEventListener('submit', (event) => {
                event.preventDefault();
                this._submitDownloadForm();
            });
        }

        if (this.urlInput) {
            // Unified input: search when keyword-like, skip when download-like
            this.urlInput.addEventListener('input', () => this._handleUnifiedInput());
        }

        this._userPrefKey = this._resolveUserPrefKey();
        this._restoreFormState();
    }

    handleBackdropClick(event) {
        if (event.target.classList.contains('lora-downloader-backdrop')) {
            this.close();
        }
    }

    handleKeydown(event) {
        if (event.key === 'Escape') {
            this.close();
        }
    }

    async handleActivityClick(event) {
        if (!this.activityContainer) return;
        const cancelBtn = event.target.closest('.lora-task-cancel');
        if (!cancelBtn || !this.activityContainer.contains(cancelBtn)) {
            return;
        }

        const taskId = cancelBtn.dataset.taskId;
        if (!taskId || cancelBtn.disabled) {
            return;
        }

        cancelBtn.disabled = true;
        cancelBtn.classList.add('is-busy');
        await this._cancelDownloadTask(taskId, cancelBtn);
    }

    _restoreFormState() {
        let savedPrefs = null;
        if (this._userPrefKey) {
            try {
                savedPrefs = JSON.parse(localStorage.getItem(this._userPrefKey) || 'null');
            } catch (err) {
                savedPrefs = null;
            }
        }

        const savedServer = savedPrefs?.server;
        const savedApiKey = savedPrefs?.apiKey;
        const fallbackServer = savedPrefs ? null : localStorage.getItem('yuuka-lora-downloader-server');
        const fallbackApiKey = savedPrefs ? null : localStorage.getItem('yuuka-lora-downloader-api-key');

        if (savedServer) {
            this.serverInput.value = savedServer;
        } else if (fallbackServer) {
            this.serverInput.value = fallbackServer;
        } else if (this.state.defaultServer) {
            this.serverInput.value = this.state.defaultServer;
        }

        if (savedApiKey) {
            this.apiKeyInput.value = savedApiKey;
        } else if (fallbackApiKey) {
            this.apiKeyInput.value = fallbackApiKey;
        }

        const savedUrl = sessionStorage.getItem('yuuka-lora-downloader-url');
        if (savedUrl) {
            this.urlInput.value = savedUrl;
        }
    }

    _persistFormState() {
        const server = (this.serverInput.value || '').trim();
        const apiKey = (this.apiKeyInput.value || '').trim();

        if (this._userPrefKey) {
            const prefs = {};
            if (server) prefs.server = server;
            if (apiKey) prefs.apiKey = apiKey;
            if (Object.keys(prefs).length) {
                localStorage.setItem(this._userPrefKey, JSON.stringify(prefs));
            } else {
                localStorage.removeItem(this._userPrefKey);
            }
            localStorage.removeItem('yuuka-lora-downloader-server');
            localStorage.removeItem('yuuka-lora-downloader-api-key');
        } else {
            if (server) {
                localStorage.setItem('yuuka-lora-downloader-server', server);
            } else {
                localStorage.removeItem('yuuka-lora-downloader-server');
            }

            if (apiKey) {
                localStorage.setItem('yuuka-lora-downloader-api-key', apiKey);
            } else {
                localStorage.removeItem('yuuka-lora-downloader-api-key');
            }
        }
        const url = (this.urlInput.value || '').trim();
        if (url) {
            sessionStorage.setItem('yuuka-lora-downloader-url', url);
        }
    }

    async _cancelDownloadTask(taskId, triggerButton) {
        if (!taskId) return;
        const button = triggerButton || null;
        try {
            await this.api['lora-downloader'].post(`/tasks/${taskId}/cancel`, {});
            showError('Đã gửi yêu cầu hủy tải.');
        } catch (err) {
            if (button) {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
            showError(`Không thể hủy tải: ${err.message}`);
            return;
        }

        try {
            await this.refreshTasks(false);
        } catch (err) {
            if (button) {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
            showError(`Không thể cập nhật tiến trình: ${err.message}`);
        }
    }

    async _submitDownloadForm() {
        if (!this.submitButton) return;

        const civitaiInput = (this.urlInput.value || '').trim();
        const serverAddress = (this.serverInput.value || '').trim();
        const apiKey = (this.apiKeyInput.value || '').trim();

        if (!civitaiInput || !serverAddress) {
            showError('Vui lòng nhập URL và địa chỉ ComfyUI.');
            return;
        }

        // Guard: if input looks like a search keyword (not URL/ID), prevent accidental downloads
        if (!this._isDownloadLikeInput(civitaiInput)) {
            this.state.searchQuery = civitaiInput;
            await (async () => {
                // kick off a remote search immediately for better UX
                const token = ++this._latestSearchToken;
                const remote = await this._performRemoteSearch(civitaiInput);
                if (token === this._latestSearchToken) {
                    this.state.remoteResults = remote;
                }
                this._renderActivity();
            })();
            showError('Chuỗi nhập giống tìm kiếm. Hãy nhập URL hoặc ID (có thể nhiều) để tải.');
            return;
        }

        const civitaiTargets = this._parseCivitaiInput(civitaiInput);
        if (!civitaiTargets.length) {
            showError('Định dạng URL/ID Civitai không hợp lệ.');
            return;
        }

        this.submitButton.disabled = true;
        this.submitButton.classList.add('is-loading');

        try {
            const failures = [];
            for (const targetUrl of civitaiTargets) {
                try {
                    await this.api['lora-downloader'].post('/download', {
                        civitai_url: targetUrl,
                        server_address: serverAddress,
                        api_key: apiKey,
                    });
                } catch (err) {
                    failures.push({ url: targetUrl, error: err });
                    console.error('[LoraDownloader] Gửi yêu cầu tải thất bại:', err);
                }
            }

            const successCount = civitaiTargets.length - failures.length;
            if (successCount && failures.length) {
                showError(`Đã gửi ${successCount}/${civitaiTargets.length} yêu cầu tải LoRA.`);
            } else if (successCount) {
                showError(successCount > 1 ? `Đã gửi ${successCount} yêu cầu tải LoRA.` : 'Đã gửi yêu cầu tải LoRA.');
            } else {
                showError('Không thể gửi yêu cầu tải LoRA.');
            }

            this._persistFormState();
            this.urlInput.select();
            // If we just enqueued tasks, begin polling immediately
            if (successCount > 0) {
                this._startPolling();
            }
            await this.refreshTasks(true);
        } catch (err) {
            showError(`Lỗi tải LoRA: ${err.message}`);
        } finally {
            this.submitButton.disabled = false;
            this.submitButton.classList.remove('is-loading');
        }
    }
    
    // Decide when input should be treated as a direct download (URL or list of numeric IDs)
    _isDownloadLikeInput(rawInput) {
        const s = (rawInput || '').trim();
        if (!s) return false;
        // Any URL anywhere implies download-like
        if (/https?:\/\//i.test(s)) return true;
        const tokens = s.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
        if (!tokens.length) return false;
        // All tokens must be numeric IDs to qualify
        const allNumeric = tokens.every(t => /^\d+$/.test(t));
        if (allNumeric) return true;
        // Mixed tokens: if any token is non-numeric and not a URL, treat as search-like
        // This avoids turning arbitrary words into civitai URLs
        return false;
    }
    _resolveUserPrefKey() {
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            if (!token) return null;
            const safeToken = btoa(unescape(encodeURIComponent(token))).replace(/=+$/g, '');
            return `yuuka-lora-downloader-pref:${safeToken}`;
        } catch (err) {
            return null;
        }
    }

    // ---------------------------------------------------------------------
    // Data loading
    // ---------------------------------------------------------------------

    async _loadInitialData() {
        try {
            await Promise.all([this.refreshTasks(false), this.refreshModelData(false)]);
            this._restoreFormState();
        } catch (err) {
            showError(`Không thể tải dữ liệu LoRA: ${err.message}`);
        }
    }

    async _manualRefresh() {
        try {
            await this.refreshTasks(true);
            await this.refreshModelData(false);
        } catch (err) {
            showError(`Không thể làm mới: ${err.message}`);
        }
    }

    async _copyAllLoraIds() {
        const models = Array.isArray(this.state.models) ? this.state.models.filter(Boolean) : [];
        const uniqueIds = Array.from(new Set(models.map((model) => this._extractLoraId(model)).filter(Boolean)));

        if (!uniqueIds.length) {
            showError('Chưa có ID LoRA để sao chép.');
            return;
        }

        const payload = uniqueIds.join('\n');
        const copied = await this._writeToClipboard(payload);
        if (copied) {
            showError(`Đã sao chép ${uniqueIds.length} ID LoRA.`);
        } else {
            showError('Không thể sao chép ID LoRA.');
        }
    }

    async _writeToClipboard(text) {
        if (!text) return false;

        if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (err) {
                console.warn('[LoraDownloader] Sao chép bằng Clipboard API thất bại:', err);
            }
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            const result = document.execCommand('copy');
            document.body.removeChild(textarea);
            return result;
        } catch (err) {
            console.warn('[LoraDownloader] Sao chép bằng execCommand thất bại:', err);
            return false;
        }
    }

    _extractLoraId(model) {
        if (!model) return '';
        const directId = model?.id;
        const nestedId = model?.model_data?.id || model?.model_data?.modelId || model?.model_data?.model_id;
        const value = directId ?? nestedId ?? '';
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).trim();
    }

    _parseCivitaiInput(rawInput) {
        const trimmed = (rawInput || '').trim();
        if (!trimmed) return [];

        // Single plain URL
        if (/^https?:\/\//i.test(trimmed) && !/[,\s;]/.test(trimmed)) {
            return [trimmed];
        }

        const tokens = trimmed
            .split(/[\s,;]+/)
            .map((token) => token.trim())
            .filter(Boolean);

        if (!tokens.length) {
            return [];
        }

        return tokens
            .map((token) => this._buildCivitaiModelUrl(token))
            .filter(Boolean);
    }

    _buildCivitaiModelUrl(identifier) {
        if (!identifier) return '';
        const value = String(identifier).trim();
        if (!value) return '';

        if (/^https?:\/\//i.test(value)) {
            return value;
        }

        const numericId = value.match(/^\d+$/);
        if (numericId) {
            return `https://civitai.com/models/${numericId[0]}`;
        }

        return `https://civitai.com/models/${encodeURIComponent(value)}`;
    }

    async refreshTasks(forceToast = false) {
        try {
            const response = await this.api['lora-downloader'].get('/tasks');
            const rawTasks = Array.isArray(response.tasks) ? response.tasks : [];
            const activeTasks = [];
            let hasNewStored = false;

            rawTasks.forEach((task) => {
                if (!task) {
                    return;
                }
                if (task.status === 'completed' && task.stored) {
                    if (task.task_id && !this._knownStoredTaskIds.has(task.task_id)) {
                        this._knownStoredTaskIds.add(task.task_id);
                        hasNewStored = true;
                    }
                    return;
                }
                activeTasks.push(task);
            });

            this.state.tasks = activeTasks;
            this.state.defaultServer = response.default_server_address || this.state.defaultServer;
            this._renderActivity();

            // Start or stop polling depending on whether there are active tasks
            this._evaluatePolling();

            if (hasNewStored) {
                await this.refreshModelData(false);
            }

            if (forceToast) {
                showError('Đã làm mới tiến trình tải.');
            }
        } catch (err) {
            if (forceToast) {
                showError(`Lỗi làm mới tiến trình: ${err.message}`);
            }
        }
    }

    async refreshModelData(forceToast = false) {
        try {
            const response = await this.api['lora-downloader'].get('/lora-data');
            const modelsMap = response.models || {};
            this.state.models = Object.values(modelsMap);
            this.state.defaultServer = response.default_server_address || this.state.defaultServer;
            this._renderActivity();
            if (forceToast) {
                showError('Đã làm mới danh sách LoRA.');
            }
        } catch (err) {
            if (forceToast) {
                showError(`Lỗi tải danh sách LoRA: ${err.message}`);
            }
        }
    }

    _startPolling() {
        this._stopPolling();
        this.taskPollTimer = setInterval(() => {
            if (this.isOpen) {
                this.refreshTasks(false);
            }
        }, 3000);
    }

    _stopPolling() {
        if (this.taskPollTimer) {
            clearInterval(this.taskPollTimer);
            this.taskPollTimer = null;
        }
    }

    // ---------------------------------------------------------------------
    // Polling control helpers
    // ---------------------------------------------------------------------

    _hasActiveTasks() {
        try {
            const tasks = Array.isArray(this.state.tasks) ? this.state.tasks : [];
            return tasks.some(t => t && ['queued', 'running'].includes(t.status));
        } catch {
            return false;
        }
    }

    _evaluatePolling() {
        // Only poll while the panel is open and there are active tasks
        if (!this.isOpen) {
            this._stopPolling();
            return;
        }
        if (this._hasActiveTasks()) {
            if (!this.taskPollTimer) {
                this._startPolling();
            }
        } else {
            this._stopPolling();
        }
    }

    // ---------------------------------------------------------------------
    // Rendering helpers
    // ---------------------------------------------------------------------

    _renderActivity() {
        if (!this.activityContainer) return;

        const tasks = Array.isArray(this.state.tasks) ? this.state.tasks.filter(Boolean) : [];
        const models = Array.isArray(this.state.models) ? this.state.models.filter(Boolean) : [];

    const query = (this.state.searchQuery || '').trim();
    const isSearching = query.length > 0 && !this._isDownloadLikeInput(query);
    const filteredModels = isSearching ? models.filter((m) => this._matchesQuery(m, query)) : models;
    const remote = Array.isArray(this.state.remoteResults) ? this.state.remoteResults : [];

    const hasTasks = !isSearching && tasks.length > 0;
    const hasModels = filteredModels.length > 0 || (isSearching && remote.length > 0);

        this.activityContainer.classList.toggle('has-models', hasModels);
        this.activityContainer.classList.toggle('has-tasks', hasTasks);

        if (!hasTasks && !hasModels && (!isSearching || !(this.state.remoteResults && this.state.remoteResults.length))) {
            this.activityContainer.innerHTML = `<div class="lora-downloader-empty">Chưa có LoRA nào được tải hoặc lưu.</div>`;
            this._updateTitleCount(isSearching, 0, models.length);
            return;
        }

        let entries = [];
        if (isSearching) {
            entries = [
                ...filteredModels.map((model) => ({ type: 'model', updated: model.updated_at || 0, payload: model })),
            ];
            entries.push(...remote.slice(0, 9).map((rm) => ({ type: 'remote', updated: 0, payload: rm })));
        } else {
            entries = [
                ...tasks.map((task) => ({
                    type: 'task',
                    updated: task.updated_at || task.created_at || 0,
                    payload: task,
                })),
                ...models.map((model) => ({
                    type: 'model',
                    updated: model.updated_at || 0,
                    payload: model,
                })),
            ].sort((a, b) => (b.updated || 0) - (a.updated || 0));
        }

        const fragment = document.createDocumentFragment();
        entries.forEach((entry) => {
            if (entry.type === 'task') {
                fragment.appendChild(this._createTaskEntry(entry.payload));
            } else if (entry.type === 'model') {
                fragment.appendChild(this._createModelEntry(entry.payload));
            } else if (entry.type === 'remote') {
                fragment.appendChild(this._createRemoteModelEntry(entry.payload));
            }
        });

        this.activityContainer.innerHTML = '';
        this.activityContainer.appendChild(fragment);

        // Update title counts
        const displayedRemoteCount = isSearching ? Math.min(remote.length, 9) : 0;
        const displayedLocalCount = isSearching ? filteredModels.length : models.length;
        const totalDisplayed = isSearching ? (displayedLocalCount + displayedRemoteCount) : displayedLocalCount;
        this._updateTitleCount(isSearching, totalDisplayed, models.length);
    }

    _updateTitleCount(isSearching, displayed, totalDownloaded) {
        try {
            const titleEl = this.overlay?.querySelector('.lora-list-title');
            if (!titleEl) return;
            if (isSearching) {
                titleEl.textContent = `Danh sách LoRA (${displayed})`;
            } else {
                titleEl.textContent = `Danh sách LoRA (${totalDownloaded})`;
            }
        } catch {}
    }

    _createTaskEntry(task) {
        const item = document.createElement('article');
        item.className = `lora-entry lora-entry--task lora-task lora-task--${task?.status || 'unknown'}`;
        if (task?.cancel_requested) {
            item.classList.add('lora-task--cancel-requested');
        }

        const progressValue = typeof task?.progress_percent === 'number' ? Math.min(Math.max(task.progress_percent, 0), 100) : null;
        const createdAt = task?.created_at ? this._formatTime(task.created_at) : '';
        const updatedAt = task?.updated_at ? this._formatTime(task.updated_at) : '';
        const filename = task?.filename || '(đang chờ tên file)';
        const cancellable = Boolean(task?.task_id) && ['queued', 'running'].includes(task?.status) && !task?.cancel_requested;

        item.innerHTML = `
            <div class="lora-task-header">
                <div class="lora-task-title">
                    <span class="material-symbols-outlined">archive</span>
                    <strong>${filename}</strong>
                </div>
                <div class="lora-task-actions">
                    <span class="lora-task-status">${this._formatStatus(task?.status)}</span>
                    ${cancellable ? `
                        <button type="button" class="lora-task-cancel" data-task-id="${task.task_id}">
                            <span class="material-symbols-outlined">cancel</span>
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="lora-task-body">
                <p>${task?.message || ''}</p>
                <div class="lora-task-meta">
                    <span>Bắt đầu: ${createdAt}</span>
                    <span>Cập nhật: ${updatedAt}</span>
                </div>
                ${progressValue !== null ? `
                    <div class="lora-task-progress">
                        <div class="lora-task-progress-bar" style="width:${progressValue}%"></div>
                        <span class="lora-task-progress-value">${progressValue}%</span>
                    </div>
                ` : ''}
            </div>
        `;

        if (cancellable && task?.cancel_requested) {
            const btn = item.querySelector('.lora-task-cancel');
            if (btn) {
                btn.disabled = true;
            }
        }

        return item;
    }

    _createModelEntry(model) {
        const item = document.createElement('article');
        item.className = 'lora-entry lora-entry--model';

        const fileMissing = model?.available === false;
        const metadataMissing = Boolean(model?.missing_metadata);
        if (fileMissing) {
            item.classList.add('lora-entry--missing');
        }
        if (metadataMissing) {
            item.classList.add('lora-entry--no-metadata');
        }

        const displayName = metadataMissing
            ? (model?.filename || '(Không tên)')
            : (model?.name || '(Không tên)');
        const updated = model?.updated_at ? this._formatTime(model.updated_at) : 'Không rõ';
        const url = metadataMissing ? '' : (model?.civitai_url || '');

        const modelData = metadataMissing ? null : this._getModelData(model);
        const version = Array.isArray(modelData?.modelVersions) && modelData.modelVersions.length
            ? modelData.modelVersions[0]
            : null;
        let baseModel = metadataMissing ? '' : (version?.baseModel || version?.base_model || model?.base_model || '');
        if (typeof baseModel !== 'string') {
            baseModel = '';
        }
        baseModel = baseModel.trim();

        let thumbUrl = metadataMissing ? null : this._getModelThumbnailUrl(model);
        let thumbInner;
        if (thumbUrl) {
            thumbInner = `<img class="lora-model-thumb" src="${this._escapeAttr(thumbUrl)}" alt="${this._escapeAttr(displayName)}" loading="lazy">`;
        } else if (metadataMissing) {
            thumbInner = `<span class="lora-model-thumb-placeholder"></span>`;
        } else {
            thumbInner = `<span class="material-symbols-outlined">description</span>`;
        }

        const thumbWrapperClasses = ['lora-model-thumb-wrapper'];
        if (fileMissing) {
            thumbWrapperClasses.push('is-missing');
        }
        if (metadataMissing) {
            thumbWrapperClasses.push('is-no-metadata');
        }
        const thumbHtml = `
            <div class="${thumbWrapperClasses.join(' ')}">
                ${thumbInner}
                ${baseModel && !metadataMissing ? `<span class="lora-model-base-mobile">${this._escapeHtml(baseModel)}</span>` : ''}
                ${fileMissing ? `
                    <button type="button" class="lora-model-thumb-overlay-button" title="Tải lại LoRA" aria-label="Tải lại LoRA">
                        <span class="material-symbols-outlined">cloud_download</span>
                    </button>
                ` : ''}
            </div>
        `;

        const actions = [];
        actions.push(`
            <button type="button" class="lora-model-action lora-model-action--delete" title="Xóa LoRA" aria-label="Xóa LoRA">
                <span class="material-symbols-outlined">delete_forever</span>
            </button>
        `);
        if (!metadataMissing && url) {
            actions.push(`
                <a class="lora-model-action lora-model-action--link" href="${this._escapeAttr(url)}" target="_blank" rel="noopener" title="Mở Civitai" aria-label="Mở Civitai">
                    <span class="material-symbols-outlined">link</span>
                </a>
            `);
        }
        if (!metadataMissing && this._hasAlbumPlugin()) {
            actions.push(`
                <button type="button" class="lora-model-action lora-model-action--album" title="Tạo album từ LoRA" aria-label="Tạo album từ LoRA">
                    <span class="material-symbols-outlined">photo_album</span>
                </button>
            `);
        }
        const actionsHtml = actions.length ? `<div class="lora-model-actions">${actions.join('')}</div>` : '';
        const safeName = this._escapeHtml(displayName);
        const safeUpdated = this._escapeHtml(updated);
        const baseModelHtml = (!metadataMissing && baseModel)
            ? `<span class="lora-model-base">${this._escapeHtml(baseModel)}</span>`
            : '';
        const controlsHtml = baseModelHtml || actionsHtml
            ? `<div class="lora-model-controls">${baseModelHtml}${actionsHtml}</div>`
            : '';
        const textClasses = ['lora-model-text'];
        if (fileMissing) {
            textClasses.push('is-missing');
        }
        if (metadataMissing) {
            textClasses.push('is-no-metadata');
        }

        item.innerHTML = `
            <div class="lora-model-row">
                <div class="lora-model-main">
                    ${thumbHtml}
                    <div class="${textClasses.join(' ')}">
                        <strong title="${this._escapeAttr(displayName)}">${safeName}</strong>
                        <p class="lora-model-updated-inline">${safeUpdated}</p>
                    </div>
                </div>
                ${controlsHtml}
                <div class="lora-model-meta">
                    <span class="lora-model-meta-updated">${safeUpdated}</span>
                    ${metadataMissing ? '<span class="lora-model-meta-warning">Chưa có metadata</span>' : ''}
                </div>
            </div>
        `;

        if (!metadataMissing) {
            const previewTarget = item.querySelector('.lora-model-thumb') || item.querySelector('.lora-model-main > span.material-symbols-outlined');
            if (previewTarget) {
                previewTarget.classList.add('lora-model-preview-trigger');
                previewTarget.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this._openModelPreview(model, thumbUrl);
                });
            }
        }

        if (!metadataMissing) {
            const albumButton = item.querySelector('.lora-model-action--album');
            if (albumButton) {
                albumButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this._createAlbumFromModel(model, albumButton);
                });
            }
        }

        const deleteButton = item.querySelector('.lora-model-action--delete');
        if (deleteButton) {
            deleteButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this._deleteModel(model, deleteButton);
            });
        }

        if (fileMissing) {
            const reDownloadButton = item.querySelector('.lora-model-thumb-overlay-button');
            if (reDownloadButton) {
                reDownloadButton.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    await this._redownloadModel(model, reDownloadButton);
                });
            }
        }

        return item;
    }

    _createRemoteModelEntry(remote) {
        const url = remote?.civitai_url || '';
        const thumb = remote?.thumbnail || '';
        const name = remote?.name || '(Không tên)';
        const id = remote?.id != null ? String(remote.id) : '';
        const baseModel = (remote?.base_model || '').trim();

        const item = document.createElement('article');
        item.className = 'lora-entry lora-entry--model lora-entry--remote';
        item.innerHTML = `
            <div class="lora-model-row">
                <div class="lora-model-main">
                    <div class="lora-model-thumb-wrapper">
                        ${thumb ? `<img class="lora-model-thumb lora-model-preview-trigger" src="${this._escapeAttr(thumb)}" alt="${this._escapeAttr(name)}" loading="lazy">` : `
                        <div class="lora-model-thumb-placeholder lora-model-preview-trigger">
                            <span class="material-symbols-outlined">image</span>
                        </div>`}
                        ${baseModel ? `<span class="lora-model-base-mobile">${this._escapeHtml(baseModel)}</span>` : ''}
                    </div>
                    <div class="lora-model-text">
                        <strong class="lora-model-preview-trigger" title="${this._escapeAttr(name)}">${this._escapeHtml(name)}</strong>
                        <span class="lora-model-updated-inline">Civitai ID: ${this._escapeHtml(id)}</span>
                    </div>
                </div>
                <div class="lora-model-controls">
                    ${baseModel ? `<span class="lora-model-base">${this._escapeHtml(baseModel)}</span>` : ''}
                    <div class="lora-model-actions">
                        ${url ? `<button type="button" class="lora-model-action lora-model-action--download" data-url="${this._escapeAttr(url)}" title="Tải LoRA" aria-label="Tải LoRA">
                            <span class="material-symbols-outlined">cloud_download</span>
                        </button>` : ''}
                        ${url ? `<a class="lora-model-action" href="${this._escapeAttr(url)}" target="_blank" rel="noopener" title="Mở trên Civitai" aria-label="Mở trên Civitai">
                            <span class="material-symbols-outlined">link</span>
                        </a>` : ''}
                    </div>
                </div>
            </div>
        `;

        const dlBtn = item.querySelector('.lora-model-action--download');
        if (dlBtn && url) {
            dlBtn.addEventListener('click', async () => {
                dlBtn.disabled = true;
                dlBtn.classList.add('is-busy');
                try {
                    // Reset search immediately so list returns to default view
                    this._resetSearch();
                    await this._enqueueSingleDownload(url);
                } finally {
                    dlBtn.disabled = false;
                    dlBtn.classList.remove('is-busy');
                }
            });
        }

        // Preview support for remote items using images in model_data.modelVersions[0]
        const previewTargets = item.querySelectorAll('.lora-model-preview-trigger');
        if (previewTargets.length && remote?.model_data?.modelVersions) {
            const handlePreview = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const images = [];
                try {
                    const versions = remote.model_data.modelVersions;
                    if (Array.isArray(versions)) {
                        versions.forEach(v => {
                            if (Array.isArray(v.images)) {
                                v.images.forEach(img => {
                                    const urlCandidate = img?.url || img?.imageUrl;
                                    if (typeof urlCandidate === 'string' && urlCandidate.trim()) {
                                        images.push({ imageUrl: urlCandidate.trim(), title: remote?.name || 'Preview' });
                                    }
                                });
                            }
                        });
                    }
                } catch {}
                if (!images.length) {
                    showError('Remote LoRA không có ảnh preview.');
                    return;
                }
                const viewer = window?.Yuuka?.plugins?.simpleViewer;
                if (!viewer || typeof viewer.open !== 'function') {
                    showError('Simple viewer chưa sẵn sàng.');
                    return;
                }
                viewer.open({ items: images, startIndex: 0 });
            };
            previewTargets.forEach(el => el.addEventListener('click', handlePreview));
        }

        return item;
    }

    async _enqueueSingleDownload(url) {
        if (!url) return;
        if (!this.serverInput || !this.urlInput) return;
        const prev = this.urlInput.value;
        try {
            this.urlInput.value = url;
            await this._submitDownloadForm();
        } finally {
            this.urlInput.value = prev;
        }
    }

    _resetSearch() {
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
        this._latestSearchToken = (this._latestSearchToken || 0) + 1;
        this.state.searchQuery = '';
        this.state.remoteResults = [];
        // Do not clear urlInput content automatically; user may be preparing batch download
        this._renderActivity();
    }

    _matchesQuery(model, query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) return true;
        const name = (model?.name || model?.filename || '').toLowerCase();
        if (name.includes(q)) return true;
        const id = (this._extractLoraId(model) || '').toLowerCase();
        if (id && id.includes(q)) return true;
        try {
            const tags = this._extractModelTags(model) || [];
            if (tags.some(t => (t || '').toLowerCase().includes(q))) return true;
        } catch {}
        return false;
    }

    _handleUnifiedInput() {
        const raw = (this.urlInput?.value || '').trim();
        if (!raw) {
            this._resetSearch();
            return;
        }
        // If input is download-like, suppress search mode & clear previous search results
        if (this._isDownloadLikeInput(raw)) {
            if (this.state.searchQuery || this.state.remoteResults.length) {
                this._resetSearch();
            }
            return; // leave value for download submit
        }
        // Otherwise treat as search query
        this.state.searchQuery = raw;
        this._renderActivity(); // immediate local filter
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
        const token = ++this._latestSearchToken;
        this._searchDebounceTimer = setTimeout(async () => {
            const remote = await this._performRemoteSearch(raw);
            if (token !== this._latestSearchToken) return;
            this.state.remoteResults = remote;
            this._renderActivity();
        }, 300);
    }

    async _performRemoteSearch(query) {
        try {
            const searchApi = (typeof window !== 'undefined' && window.Yuuka && window.Yuuka.loraSearch && window.Yuuka.loraSearch.searchModelsRaw)
                ? window.Yuuka.loraSearch.searchModelsRaw
                : null;
            let items = [];
            if (searchApi) {
                items = await searchApi(query, 'LORA');
            } else {
                const url = new URL('https://civitai.com/api/v1/models');
                url.searchParams.append('query', query);
                url.searchParams.append('types', 'LORA');
                const res = await fetch(url.toString());
                if (res.ok) {
                    const data = await res.json();
                    items = Array.isArray(data?.items) ? data.items : [];
                }
            }
            const knownIds = new Set(
                (Array.isArray(this.state.models) ? this.state.models : [])
                    .map((m) => this._extractLoraId(m))
                    .filter(Boolean)
                    .map(String)
            );
            const remotes = items
                .filter(it => it && !knownIds.has(String(it.id)))
                .map(it => ({
                    id: it.id,
                    name: it.name,
                    civitai_url: `https://civitai.com/models/${encodeURIComponent(it.id)}`,
                    thumbnail: (it.modelVersions && it.modelVersions[0] && it.modelVersions[0].images && it.modelVersions[0].images[0]) ? it.modelVersions[0].images[0].url : '',
                    base_model: (it.modelVersions && it.modelVersions[0] && (it.modelVersions[0].baseModel || it.modelVersions[0].base_model)) ? (it.modelVersions[0].baseModel || it.modelVersions[0].base_model) : '',
                    model_data: it, // attach full item as model_data-like for preview consumption
                }));
            return remotes;
        } catch (err) {
            console.warn('Remote search failed:', err);
            return [];
        }
    }

    _formatStatus(status) {
        switch (status) {
            case 'queued': return 'Đang chờ';
            case 'running': return 'Đang tải';
            case 'completed': return 'Hoàn tất';
            case 'cancelled': return 'Đã hủy';
            case 'error': return 'Lỗi';
            default: return status || 'Không rõ';
        }
    }

    _openModelPreview(model, initialUrl) {
        const viewer = window?.Yuuka?.plugins?.simpleViewer;
        if (!viewer || typeof viewer.open !== 'function') {
            showError('Simple viewer chưa sẵn sàng.');
            return;
        }

        const items = this._collectModelImages(model);
        if (!items.length) {
            showError('LoRA này không có ảnh preview.');
            return;
        }

        const startIndex = initialUrl
            ? items.findIndex(item => item.imageUrl === initialUrl)
            : 0;

        viewer.open({
            items,
            startIndex: startIndex >= 0 ? startIndex : 0,
        });
    }

    async _createAlbumFromModel(model, triggerElement) {
        if (!this._hasAlbumPlugin() || !this.api?.album) {
            showError('Plugin Album chưa sẵn sàng.');
            return;
        }

        const primaryTag = this._getPrimaryModelTag(model);
        const normalizedIdentifier = this._normalizeLoraIdentifier(model);
        const fallbackName = this._resolveAlbumName(model);
        const albumName = (primaryTag || fallbackName || normalizedIdentifier || (model?.name || model?.filename || '').trim() || 'LoRA Album').trim();
        const loraIdentifier = normalizedIdentifier || primaryTag || (model?.name || model?.filename || '').trim() || albumName;
        const albumHash = this._deriveAlbumHash(model);
        const tags = this._collectUniqueTags(model, primaryTag, albumName);

        const button = triggerElement;
        if (button) {
            button.disabled = true;
            button.classList.add('is-busy');
        }

        try {
            const existingAlbum = await this._findExistingAlbumForModel(albumName, primaryTag, loraIdentifier);
            if (existingAlbum) {
                if (button) {
                    button.disabled = false;
                    button.classList.remove('is-busy');
                }
                await this._navigateToAlbum(existingAlbum.hash, existingAlbum.name, false);
                return;
            }

            const baseConfig = await this._fetchAlbumBaseConfig(albumHash);
            const payload = {
                ...(baseConfig && typeof baseConfig === 'object' ? baseConfig : {}),
                character: albumName,
                lora_prompt_tags: tags,
                lora_name: loraIdentifier,
                civitai_url: model?.civitai_url || baseConfig?.civitai_url || '',
            };

            await this.api.album.post(`/${albumHash}/config`, payload);

            if (button) {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
            await this._navigateToAlbum(albumHash, albumName, true);
        } catch (err) {
            console.error('[LoraDownloader] Tạo album thất bại:', err);
            showError(`Không thể tạo album: ${err.message}`);
            if (button) {
                button.disabled = false;
                button.classList.remove('is-busy');
            }
        }
    }

    _hasAlbumPlugin() {
        if (this._albumPluginEnabled) {
            return true;
        }
        if (this._albumPluginEnabled === false) {
            return false;
        }
        this._albumPluginEnabled = Boolean(this.api?.album && Array.isArray(this.activePlugins) && this.activePlugins.some(plugin => plugin.id === 'album'));
        return this._albumPluginEnabled;
    }

    async _fetchAlbumBaseConfig(characterHash) {
        if (!this.api?.album) {
            return {};
        }
        try {
            const response = await this.api.album.get(`/comfyui/info?character_hash=${encodeURIComponent(characterHash)}`);
            return (response && typeof response === 'object') ? response : {};
        } catch (err) {
            console.warn('[LoraDownloader] Không thể lấy cấu hình cơ bản của album:', err);
            return {};
        }
    }

    _deriveAlbumHash(model) {
        if (model?.album_hash) {
            return model.album_hash;
        }
        const source = model?.model_data?.id
            || model?.id
            || model?.filename
            || model?.name
            || Date.now().toString(36);
        const normalized = String(source)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const hash = `album-custom-${normalized || Date.now().toString(36)}`;
        if (model && typeof model === 'object') {
            model.album_hash = hash;
        }
        return hash;
    }

    _resolveAlbumName(model) {
        const primary = this._getPrimaryModelTag(model);
        if (primary) {
            return primary.trim();
        }
        const tags = this._extractModelTags(model);
        if (tags.length) {
            return this._prettifyLabel(tags[0]);
        }
        const baseName = (model?.name || model?.filename || 'LoRA Album').replace(/[_-]+/g, ' ').trim();
        if (!baseName) {
            return 'LoRA Album';
        }
        const words = baseName.split(/\s+/).filter(Boolean).slice(0, 2);
        if (!words.length) {
            return 'LoRA Album';
        }
        return this._prettifyLabel(words.join(' '));
    }

    _extractModelTags(model) {
        const tags = [];
        const seen = new Set();
        const addTag = (value) => {
            if (typeof value !== 'string') return;
            const trimmed = value.trim();
            if (!trimmed) return;
            const normalized = this._normalizeTagValue(trimmed);
            if (!normalized) return;
            if (seen.has(normalized)) return;
            seen.add(normalized);
            tags.push(trimmed);
        };

        const modelData = this._getModelData(model);
        const trainedWords = modelData?.trainedWords;
        if (Array.isArray(trainedWords)) {
            trainedWords.forEach((entry) => {
                if (typeof entry !== 'string') return;
                entry.split(',').forEach(part => addTag(part));
            });
        } else if (typeof trainedWords === 'string') {
            trainedWords.split(',').forEach(part => addTag(part));
        }

        const versions = modelData?.modelVersions;
        if (Array.isArray(versions)) {
            versions.forEach((version) => {
                const words = version?.trainedWords;
                if (!Array.isArray(words)) return;
                words.forEach(entry => {
                    if (typeof entry !== 'string') return;
                    entry.split(',').forEach(part => addTag(part));
                });
            });
        }

        const dataTags = modelData?.tags;
        if (Array.isArray(dataTags)) {
            dataTags.forEach(addTag);
        }

        const rootTags = model?.tags;
        if (Array.isArray(rootTags)) {
            rootTags.forEach(addTag);
        }

        return tags.slice(0, 20);
    }

    _prettifyLabel(value) {
        return value
            .replace(/[_-]+/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    _collectModelImages(model) {
        const results = [];
        const seen = new Set();
        const addUrl = (url) => {
            if (typeof url !== 'string') return;
            const trimmed = url.trim();
            if (!trimmed || seen.has(trimmed)) return;
            seen.add(trimmed);
            results.push({
                imageUrl: trimmed,
                title: model?.name || model?.filename || 'Preview',
            });
        };

        addUrl(model?.preview_url);
        addUrl(model?.thumbnail);
        addUrl(model?.cover_image);

        const modelData = this._getModelData(model);
        const versions = modelData?.modelVersions;
        if (Array.isArray(versions)) {
            versions.forEach((version) => {
                const images = version?.images;
                if (!Array.isArray(images)) return;
                images.forEach((img) => {
                    addUrl(img?.url);
                    addUrl(img?.imageUrl);
                    addUrl(img?.meta?.url);
                });
            });
        }

        return results;
    }

    _collectUniqueTags(model, primaryTag, albumName) {
        const collected = this._extractModelTags(model);
        const targetPrimary = primaryTag ? this._normalizeTagValue(primaryTag) : '';
        if (primaryTag && targetPrimary) {
            const exists = collected.some(tag => this._normalizeTagValue(tag) === targetPrimary);
            if (!exists) {
                collected.unshift(primaryTag);
            }
        }
        if (!collected.length && albumName) {
            collected.push(albumName);
        }
        const unique = [];
        const seen = new Set();
        collected.forEach(tag => {
            if (typeof tag !== 'string') return;
            const normalized = this._normalizeTagValue(tag);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            unique.push(tag.trim());
        });
        return unique;
    }

    _getModelThumbnailUrl(model) {
        const directUrl = model?.preview_url || model?.thumbnail || model?.cover_image;
        if (typeof directUrl === 'string' && directUrl.trim()) {
            return directUrl.trim();
        }

        const modelData = this._getModelData(model);
        const versions = modelData?.modelVersions;
        if (Array.isArray(versions)) {
            for (const version of versions) {
                const images = version?.images;
                if (Array.isArray(images) && images.length) {
                    for (const image of images) {
                        const url = image?.url || image?.imageUrl || image?.meta?.url;
                        if (typeof url === 'string' && url.trim()) {
                            return url.trim();
                        }
                    }
                }
            }
        }

        return null;
    }

    _getPrimaryModelTag(model) {
        const modelData = this._getModelData(model);
        const versions = modelData?.modelVersions;
        if (Array.isArray(versions) && versions.length) {
            const trainedWords = versions[0]?.trainedWords;
            if (Array.isArray(trainedWords) && trainedWords.length) {
                const firstEntry = trainedWords[0];
                if (typeof firstEntry === 'string') {
                    const candidates = firstEntry.split(',').map(part => part.trim()).filter(Boolean);
                    if (candidates.length) {
                        return candidates[0];
                    }
                    if (firstEntry.trim()) return firstEntry.trim();
                }
            }
        }
        return null;
    }

    _normalizeTagValue(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[_\s]+/g, ' ').trim().toLowerCase();
    }

    _normalizeLoraValue(value) {
        if (typeof value !== 'string') return '';
        return value.trim().toLowerCase();
    }

    _normalizeLoraIdentifier(model) {
        return (model?.filename || model?.name || '').trim();
    }

    _getModelData(model) {
        const data = model?.model_data;
        if (!data) return null;
        if (typeof data === 'object') {
            return data;
        }
        if (typeof data === 'string') {
            try {
                return JSON.parse(data);
            } catch (err) {
                console.warn('[LoraDownloader] Không thể parse model_data cho preview:', err);
            }
        }
        return null;
    }

    async _findExistingAlbumForModel(albumName, primaryTag, loraIdentifier) {
        if (!this._hasAlbumPlugin()) return null;
        const normalizedName = (albumName || '').trim().toLowerCase();
        if (!normalizedName) return null;
        const targetLora = this._normalizeLoraValue(loraIdentifier);
        const targetTag = primaryTag ? this._normalizeTagValue(primaryTag) : '';
        try {
            const albums = await this.api.album.get('/albums');
            if (!Array.isArray(albums) || !albums.length) return null;
            for (const album of albums) {
                const name = (album?.name || '').trim();
                if (!name || name.toLowerCase() !== normalizedName) continue;
                const hash = album?.hash;
                if (!hash) continue;
                const config = await this._fetchAlbumBaseConfig(hash);
                const configLora = this._normalizeLoraValue(config?.lora_name);
                const rawConfigTags = Array.isArray(config?.lora_prompt_tags)
                    ? config.lora_prompt_tags
                    : (typeof config?.lora_prompt_tags === 'string' ? config.lora_prompt_tags.split(',') : []);
                const configTags = rawConfigTags.map(tag => typeof tag === 'string' ? tag : '').filter(Boolean);
                const hasMatchingTag = targetTag && configTags.some(tag => this._normalizeTagValue(tag) === targetTag);
                if ((targetLora && configLora === targetLora) || hasMatchingTag) {
                    return { hash, name };
                }
            }
        } catch (err) {
            console.warn('[LoraDownloader] Không thể kiểm tra album hiện có:', err);
        }
        return null;
    }

    async _navigateToAlbum(characterHash, characterName, openSettings = false) {
        window.Yuuka.initialPluginState.album = {
            character: { hash: characterHash, name: characterName },
        };
        if (openSettings) {
            window.Yuuka.initialPluginState.album.openSettings = true;
        }
        this.close();
        try {
            if (window?.Yuuka?.ui?.switchTab) {
                window.Yuuka.ui.switchTab('album');
            } else if (typeof window.switchTab === 'function') {
                window.switchTab('album');
            }
        } catch (err) {
            console.error('[LoraDownloader] Không thể chuyển sang tab Album:', err);
            showError('Không thể chuyển sang tab Album.');
        }
    }

    _escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#39;';
                default: return char;
            }
        });
    }

    _escapeAttr(value) {
        return this._escapeHtml(value).replace(/`/g, '&#96;');
    }

    _formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toLocaleString();
    }

    async _deleteModel(model, triggerElement) {
        const filename = (model?.filename || '').trim();
        if (!filename) {
            showError('Không xác định tên file LoRA.');
            return;
        }
        const ok = window.confirm(`Xóa LoRA '${filename}'?`);
        if (!ok) return;

        const btn = triggerElement;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-busy');
        }
        try {
            await this.api['lora-downloader'].post('/delete', { filename });
            await this.refreshModelData(false);
        } catch (err) {
            console.error('[LoraDownloader] Delete failed:', err);
            showError(`Không thể xóa LoRA: ${err?.message || err}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('is-busy');
            }
        }
    }

    async _redownloadModel(model, triggerElement) {
        const civitaiUrl = (model?.civitai_url || '').trim();
        if (!civitaiUrl) {
            showError('Không tìm thấy URL Civitai để tải lại.');
            return;
        }

        const serverAddress = (this.serverInput?.value || this.state.defaultServer || '').trim();
        if (!serverAddress) {
            showError('Chưa cấu hình địa chỉ ComfyUI.');
            return;
        }

        const payload = {
            civitai_url: civitaiUrl,
            server_address: serverAddress,
        };
        const apiKeyValue = (this.apiKeyInput?.value || '').trim();
        if (apiKeyValue) {
            payload.api_key = apiKeyValue;
        }

        const btn = triggerElement;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('is-busy');
        }

        try {
            await this.api['lora-downloader'].post('/download', payload);
            showError('Đã gửi yêu cầu tải lại LoRA.');
            // Ensure polling resumes to track the redownload task
            this._startPolling();
            await this.refreshTasks(false);
        } catch (err) {
            console.error('[LoraDownloader] Redownload failed:', err);
            showError(`Không thể tải lại LoRA: ${err?.message || err}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('is-busy');
            }
        }
    }
}

window.Yuuka.components['LoraDownloaderService'] = LoraDownloaderService;