class UpdateComfyUIService {
    constructor(container, api) {
        this.api = api;
        this.pluginApi = api['update-comfyui'];
        this.overlay = null;
        this.restartButton = null;
        this.statusText = null;
        this.statusBadge = null;
        this.labelText = null;
        this.metaText = null;
        this.isOpen = false;
        this.state = null;
        this.pollTimer = null;

        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleRestart = this.handleRestart.bind(this);
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
        this._renderOverlay();
        await this.refreshStatus(true);
        this._beginPolling();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this._endPolling();
        document.removeEventListener('keydown', this.handleKeyDown);

        if (this.overlay) {
            this.overlay.removeEventListener('click', this.handleBackdropClick);
            this.overlay.remove();
            this.overlay = null;
        }
        document.body.classList.remove('update-comfyui-open');
    }

    async refreshStatus(showLoader = false) {
        if (!this.pluginApi) return;
        if (showLoader && this.restartButton) {
            this.restartButton.classList.add('is-loading');
        }
        try {
            const data = await this.pluginApi.get('/status');
            this.state = data;
            this._syncUI();
        } catch (error) {
            console.error('[UpdateComfyUI] Failed to fetch status:', error);
            showError(error.message || 'Khong the kiem tra trang thai ComfyUI.');
        } finally {
            if (this.restartButton) {
                this.restartButton.classList.remove('is-loading');
            }
        }
    }

    async handleRestart(event) {
        event.preventDefault();
        if (!this.state?.is_ready || !this.pluginApi) return;
        this.restartButton.disabled = true;
        this.restartButton.classList.add('is-busy');
        try {
            await this.pluginApi.post('/restart', {
                server_address: this.state.server_address,
                executable_path: this.state.executable_path,
            });
            await this.refreshStatus(true);
        } catch (error) {
            console.error('[UpdateComfyUI] Restart failed:', error);
            showError(error.message || 'Khong the restart ComfyUI.');
        } finally {
            this.restartButton.classList.remove('is-busy');
            this._syncUI();
        }
    }

    handleBackdropClick(event) {
        if (event.target.classList.contains('uc-backdrop')) {
            this.close();
        }
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            this.close();
        }
    }

    _renderOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'update-comfyui-overlay';
        this.overlay.innerHTML = `
            <div class="uc-backdrop"></div>
            <div class="uc-panel">
                <header class="uc-header">
                    <span class="material-symbols-outlined uc-status-icon">rule_settings</span>
                    <button class="uc-close" title="Dong">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </header>
                <div class="uc-body">
                    <p class="uc-status-text">Dang kiem tra trang thai ComfyUI...</p>
                    <span class="uc-badge uc-badge--stopped">OFFLINE</span>
                    <div class="uc-action">
                        <button class="uc-restart-btn" aria-label="Restart Comfyui" disabled>
                            <span class="material-symbols-outlined">restart_alt</span>
                        </button>
                        <span class="uc-action-label">Restart Comfyui</span>
                    </div>
                    <small class="uc-meta-text">&nbsp;</small>
                </div>
            </div>
        `;

        document.body.appendChild(this.overlay);
        document.body.classList.add('update-comfyui-open');

        this.overlay.addEventListener('click', this.handleBackdropClick);
        document.addEventListener('keydown', this.handleKeyDown);

        const closeBtn = this.overlay.querySelector('.uc-close');
        closeBtn.addEventListener('click', () => this.close());

        this.restartButton = this.overlay.querySelector('.uc-restart-btn');
        this.statusText = this.overlay.querySelector('.uc-status-text');
        this.statusBadge = this.overlay.querySelector('.uc-badge');
        this.labelText = this.overlay.querySelector('.uc-action-label');
        this.metaText = this.overlay.querySelector('.uc-meta-text');

        this.restartButton.addEventListener('click', this.handleRestart);
    }

    _syncUI() {
        if (!this.state || !this.overlay) return;
        const { is_ready, is_running, server_address, status, ready_error } = this.state;

        let statusMessage = 'ComfyUI chua chay.';
        if (is_ready) {
            statusMessage = `ComfyUI san sang tai ${server_address}.`;
        } else if (is_running) {
            statusMessage = 'ComfyUI dang chay nhung khong phan hoi.';
        }
        this.statusText.textContent = statusMessage;

        this.statusBadge.textContent = is_ready ? 'READY' : (is_running ? 'RUNNING' : 'OFFLINE');
        this.statusBadge.classList.toggle('uc-badge--ready', is_ready);
        this.statusBadge.classList.toggle('uc-badge--running', is_running && !is_ready);
        this.statusBadge.classList.toggle('uc-badge--stopped', !is_running);

        const canRestart = is_ready && !this.restartButton.classList.contains('is-busy');
        this.restartButton.disabled = !canRestart;
        this.labelText.textContent = canRestart ? 'Restart Comfyui' : 'Restart khong kha dung';

        if (ready_error && is_running && !is_ready) {
            this.metaText.textContent = ready_error.substring(0, 120);
        } else if (this.state.timestamp) {
            const date = new Date(this.state.timestamp * 1000);
            this.metaText.textContent = `Cap nhat luc ${date.toLocaleTimeString()}`;
        } else {
            this.metaText.textContent = ' ';
        }
    }

    _beginPolling() {
        this._endPolling();
        this.pollTimer = setInterval(() => this.refreshStatus(false), 4000);
    }

    _endPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
}

window.Yuuka.components['UpdateComfyUIService'] = UpdateComfyUIService;
