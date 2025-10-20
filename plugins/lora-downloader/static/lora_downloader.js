class LoraDownloaderService {
    constructor(container, api) {
        this.api = api;
        this.isOpen = false;
        this.overlay = null;
        this.form = null;
        this.tasksContainer = null;
        this.modelsContainer = null;
        this.submitButton = null;
        this.serverInput = null;
        this.urlInput = null;
        this.apiKeyInput = null;
        this.taskPollTimer = null;
        this.state = {
            tasks: [],
            models: [],
            defaultServer: '',
        };
        this._userPrefKey = null;

        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
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
        this._startPolling();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this._stopPolling();
        if (this.overlay) {
            this.overlay.removeEventListener('click', this.handleBackdropClick);
            this.overlay.remove();
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
                <section class="lora-downloader-section">
                    <form class="lora-downloader-form">
                        <label>
                            <span>URL Civitai</span>
                            <input type="url" name="civitai_url" placeholder="https://civitai.com/models/..." required>
                        </label>
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
                        <div class="lora-downloader-actions">
                            <button type="submit" class="btn-primary">
                                <span class="material-symbols-outlined">cloud_download</span>
                                <span>Tải LoRA</span>
                            </button>
                        </div>
                    </form>
                </section>
                <section class="lora-downloader-section">
                    <header class="lora-downloader-subheader">
                        <h3>Tiến trình tải</h3>
                        <button type="button" class="btn-refresh" title="Làm mới">
                            <span class="material-symbols-outlined">refresh</span>
                        </button>
                    </header>
                    <div class="lora-downloader-tasks"></div>
                </section>
                <section class="lora-downloader-section">
                    <header class="lora-downloader-subheader">
                        <h3>LoRA đã lưu</h3>
                        <button type="button" class="btn-refresh-models" title="Làm mới danh sách">
                            <span class="material-symbols-outlined">refresh</span>
                        </button>
                    </header>
                    <div class="lora-downloader-models"></div>
                </section>
            </div>
        `;

        document.body.appendChild(overlay);

        this.overlay = overlay;
        this.form = overlay.querySelector('.lora-downloader-form');
        this.tasksContainer = overlay.querySelector('.lora-downloader-tasks');
        this.modelsContainer = overlay.querySelector('.lora-downloader-models');
        this.submitButton = overlay.querySelector('.lora-downloader-actions button');
        this.serverInput = overlay.querySelector('input[name="server_address"]');
        this.urlInput = overlay.querySelector('input[name="civitai_url"]');
        this.apiKeyInput = overlay.querySelector('input[name="api_key"]');

        const closeBtn = overlay.querySelector('.lora-downloader-close');
        closeBtn.addEventListener('click', () => this.close());
        overlay.addEventListener('click', this.handleBackdropClick);
        document.addEventListener('keydown', this.handleKeydown);

        const refreshTasksBtn = overlay.querySelector('.btn-refresh');
        const refreshModelsBtn = overlay.querySelector('.btn-refresh-models');
        refreshTasksBtn.addEventListener('click', () => this.refreshTasks(true));
        refreshModelsBtn.addEventListener('click', () => this.refreshModelData(true));

        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this._submitDownloadForm();
        });

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

    async _submitDownloadForm() {
        if (!this.submitButton) return;

        const civitaiUrl = (this.urlInput.value || '').trim();
        const serverAddress = (this.serverInput.value || '').trim();
        const apiKey = (this.apiKeyInput.value || '').trim();

        if (!civitaiUrl || !serverAddress) {
            showError('Vui lòng nhập URL và địa chỉ ComfyUI.');
            return;
        }

        this.submitButton.disabled = true;
        this.submitButton.classList.add('is-loading');

        try {
            await this.api['lora-downloader'].post('/download', {
                civitai_url: civitaiUrl,
                server_address: serverAddress,
                api_key: apiKey,
            });
            showError('Đã gửi yêu cầu tải LoRA.');
            this._persistFormState();
            this.urlInput.select();
            await this.refreshTasks(true);
        } catch (err) {
            showError(`Lỗi tải LoRA: ${err.message}`);
        } finally {
            this.submitButton.disabled = false;
            this.submitButton.classList.remove('is-loading');
        }
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

    async refreshTasks(forceToast = false) {
        try {
            const response = await this.api['lora-downloader'].get('/tasks');
            this.state.tasks = Array.isArray(response.tasks) ? response.tasks : [];
            this.state.defaultServer = response.default_server_address || this.state.defaultServer;
            this._renderTasks();
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
            this._renderModels();
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
    // Rendering helpers
    // ---------------------------------------------------------------------

    _renderTasks() {
        if (!this.tasksContainer) return;

        if (!this.state.tasks.length) {
            this.tasksContainer.innerHTML = `<div class="lora-downloader-empty">Chưa có yêu cầu nào.</div>`;
            return;
        }

        this.tasksContainer.innerHTML = '';
        this.state.tasks.forEach(task => {
            const item = document.createElement('div');
            item.className = `lora-task lora-task--${task.status || 'unknown'}`;
            const progress = typeof task.progress_percent === 'number' ? Math.min(Math.max(task.progress_percent, 0), 100) : null;
            const createdAt = task.created_at ? this._formatTime(task.created_at) : '';
            const updatedAt = task.updated_at ? this._formatTime(task.updated_at) : '';
            const filename = task.filename || '(đang chờ tên file)';

            item.innerHTML = `
                <div class="lora-task-header">
                    <div class="lora-task-title">
                        <span class="material-symbols-outlined">archive</span>
                        <strong>${filename}</strong>
                    </div>
                    <span class="lora-task-status">${this._formatStatus(task.status)}</span>
                </div>
                <div class="lora-task-body">
                    <p>${task.message || ''}</p>
                    <div class="lora-task-meta">
                        <span>Bắt đầu: ${createdAt}</span>
                        <span>Cập nhật: ${updatedAt}</span>
                    </div>
                    ${progress !== null ? `
                        <div class="lora-task-progress">
                            <div class="lora-task-progress-bar" style="width:${progress}%"></div>
                            <span class="lora-task-progress-value">${progress}%</span>
                        </div>
                    ` : ''}
                </div>
            `;

            this.tasksContainer.appendChild(item);
        });
    }

    _renderModels() {
        if (!this.modelsContainer) return;

        if (!this.state.models.length) {
            this.modelsContainer.innerHTML = `<div class="lora-downloader-empty">Chưa có LoRA nào được lưu.</div>`;
            return;
        }

        const rows = this.state.models
            .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
            .map(model => {
                const name = model.name || '(Không tên)';
                const filename = model.filename || 'Không rõ';
                const updated = model.updated_at ? this._formatTime(model.updated_at) : 'Không rõ';
                const url = model.civitai_url || '';
                return `
                    <div class="lora-model-row">
                        <div class="lora-model-main">
                            <span class="material-symbols-outlined">description</span>
                            <div>
                                <strong>${name}</strong>
                                <p>${filename}</p>
                            </div>
                        </div>
                        <div class="lora-model-meta">
                            <span>Cập nhật: ${updated}</span>
                            ${url ? `<a href="${url}" target="_blank" rel="noopener">Mở Civitai</a>` : ''}
                        </div>
                    </div>
                `;
            })
            .join('');

        this.modelsContainer.innerHTML = rows;
    }

    _formatStatus(status) {
        switch (status) {
            case 'queued': return 'Đang chờ';
            case 'running': return 'Đang tải';
            case 'completed': return 'Hoàn tất';
            case 'error': return 'Lỗi';
            default: return status || 'Không rõ';
        }
    }

    _formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp * 1000);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toLocaleString();
    }
}

window.Yuuka.components['LoraDownloaderService'] = LoraDownloaderService;
