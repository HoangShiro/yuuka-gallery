(function () {
    const PLUGIN_ID = "live-gen";
    const STORAGE_PROMPT = "yuuka.liveGen.prompt";
    const STORAGE_BLUR = "yuuka.liveGen.previewBlur";

    class LiveGenComponent {
        constructor(container, api) {
            this.container = container;
            this.api = api;
            this.pluginApi = api[PLUGIN_ID];
            this.ws = null;
            this.destroyed = false;
            this.reconnectTimer = null;
            this.debounceTimer = null;
            this.seq = 0;
            this.tags = [];
            this.state = {
                prompt: localStorage.getItem(STORAGE_PROMPT) || "",
                seed: 123456789,
                connected: false,
                running: false,
                latestSeq: 0,
            };
            this.lastGeneratedPrompt = "";
            this.currentStep = 0;
            this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
        }

        async init() {
            document.body.classList.add("live-gen-active");
            this.render();
            this._updateNav();
            await this._loadConfig();
            this._loadTags();
            this._connect();
            window.addEventListener("beforeunload", this.handleBeforeUnload);
            // Luôn mở prompt field ngay khi truy cập plugin
            this._openPromptMode();
            if (this.state.prompt.trim()) {
                this._scheduleGeneration(120);
            }
        }

        destroy() {
            this.destroyed = true;
            document.body.classList.remove("live-gen-active");
            document.body.classList.remove("live-gen-prompt-focused");
            window.removeEventListener("beforeunload", this.handleBeforeUnload);
            clearTimeout(this.reconnectTimer);
            clearTimeout(this.debounceTimer);
            const navibar = window.Yuuka?.services?.navibar;
            if (navibar) {
                navibar.showSearchBar(null);
                navibar.setActivePlugin(null);
            }
            this._closeSocket();
            this._removeMobileNavButtons();

            // Close settings panel if open when exiting
            const panel = document.querySelector(".live-gen-settings-panel");
            if (panel) {
                panel.classList.remove("open");
                document.body.classList.remove("live-gen-settings-open");
                panel.remove();
            }
        }

        handleBeforeUnload() {
            this._send({ type: "cancel" });
        }

        render() {
            this.container.innerHTML = `
                <section class="live-gen-page" aria-label="Live image generation preview">
                    <div class="live-gen-preview" data-role="preview">
                        <img class="live-gen-preview__image" data-role="image" alt="">
                        <div class="live-gen-empty" data-role="empty">
                            <span class="material-symbols-outlined">stylus</span>
                            <p>Nhập prompt để bắt đầu.</p>
                        </div>
                    </div>
                    <!-- Unified Top Control Wrapper -->
                    <div class="live-gen-header" data-role="header">
                        <div class="live-gen-status" data-role="status">
                            <span class="live-gen-status__dot" data-role="dot"></span>
                            <span data-role="status-text">Đang chuẩn bị...</span>
                        </div>
                        <div class="live-gen-actions-bar" data-role="actions-bar">
                            <button type="button" class="live-gen-action-btn-pill" data-action="keep" title="Ghim ảnh để chỉnh sửa (Img2Img)">
                                <span class="material-symbols-outlined">keep</span>
                                <span class="btn-label">Keep</span>
                            </button>
                            <button type="button" class="live-gen-action-btn-pill" data-action="hires" title="Kích hoạt Hires Fix (Nâng cao chất lượng)">
                                <span class="material-symbols-outlined">hd</span>
                                <span class="btn-label">Hires</span>
                            </button>
                            <button type="button" class="live-gen-action-btn-pill" data-action="settings" title="Cấu hình Live Gen">
                                <span class="material-symbols-outlined">settings</span>
                                <span class="btn-label">Settings</span>
                            </button>
                            <button type="button" class="live-gen-action-btn-pill" data-action="timeline" title="Lịch sử & Yêu thích">
                                <span class="material-symbols-outlined">history</span>
                                <span class="btn-label">History</span>
                            </button>
                        </div>
                    </div>
                    <div class="live-gen-progress" data-role="progress">
                        <div class="live-gen-progress__bar" data-role="progress-bar"></div>
                    </div>
                </section>
            `;
            this.imageEl = this.container.querySelector('[data-role="image"]');
            this.emptyEl = this.container.querySelector('[data-role="empty"]');
            this.statusEl = this.container.querySelector('[data-role="status-text"]');
            this.dotEl = this.container.querySelector('[data-role="dot"]');
            this.progressBarEl = this.container.querySelector('[data-role="progress-bar"]');
            this.keepBtn = this.container.querySelector('[data-action="keep"]');
            this.hiresBtn = this.container.querySelector('[data-action="hires"]');
            this.settingsBtn = this.container.querySelector('[data-action="settings"]');
            this.timelineBtn = this.container.querySelector('[data-action="timeline"]');

            this.keepBtn?.addEventListener("click", () => this._toggleKeep());
            this.keepBtn?.addEventListener("mousedown", (e) => e.preventDefault());
            this.hiresBtn?.addEventListener("click", () => this._toggleHires());
            this.hiresBtn?.addEventListener("mousedown", (e) => e.preventDefault());
            this.settingsBtn?.addEventListener("click", () => this._openSettings());
            this.settingsBtn?.addEventListener("mousedown", (e) => e.preventDefault());
            this.timelineBtn?.addEventListener("click", () => this._openTimeline());
            this.timelineBtn?.addEventListener("mousedown", (e) => e.preventDefault());

            this.imageEl?.addEventListener("click", () => {
                if (!this.imageEl.src || this.imageEl.src === window.location.href || !this.imageEl.classList.contains("is-loaded")) return;
                this._openSimpleViewer();
            });

            this._setStatus("Đang chuẩn bị...", "idle");
        }

        async _loadConfig() {
            try {
                const config = await this.pluginApi.get("/config");
                this._applyConfig(config);
            } catch (err) {
                this._setStatus("Không tải được cấu hình.", "error");
                window.showError?.(`Live Gen: ${err.message}`);
            }
        }

        async _loadTags() {
            try {
                const [tags, charsData] = await Promise.all([
                    this.api.getTags(),
                    this.api.getAllCharacters().catch(() => ({ characters: [] }))
                ]);
                this.tags = tags;
                this.characters = charsData?.characters || [];
                
                const promptInput = document.querySelector(".live-gen-prompt-input");
                if (promptInput) this._attachAutocomplete(promptInput);
            } catch (err) {
                this.tags = [];
                this.characters = [];
            }
        }

        _applyConfig(config) {
            if (!config || typeof config !== "object") return;
            const seed = Number(config.seed);
            if (Number.isFinite(seed)) this.state.seed = seed;
            this.state.config = { ...(this.state.config || {}), ...config };
            if (this.hiresBtn) {
                this.hiresBtn.classList.toggle("active", !!this.state.config.hires_enabled);
            }
            this._syncMobileNavButtonStates();
        }

        _connect() {
            if (this.destroyed) return;
            const token = localStorage.getItem("yuuka-auth-token") || "";
            if (!token) {
                this._setStatus("Thiếu token đăng nhập.", "error");
                return;
            }

            this._closeSocket(false);
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const url = `${protocol}//${window.location.host}/ws/live-gen?token=${encodeURIComponent(token)}`;
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.state.connected = true;
                this._setStatus("Sẵn sàng.", "ready");
                if (this.state.prompt.trim()) this._scheduleGeneration(80);
            };

            this.ws.onmessage = (event) => {
                this._handleMessage(event.data);
            };

            this.ws.onerror = () => {
                this._setStatus("WebSocket lỗi.", "error");
            };

            this.ws.onclose = () => {
                this.state.connected = false;
                if (this.destroyed) return;
                this._setStatus("Đang kết nối lại...", "idle");
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => this._connect(), 1500);
            };
        }

        _closeSocket(sendCancel = true) {
            if (!this.ws) return;
            if (sendCancel) this._send({ type: "cancel" });
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch (_) {}
            this.ws = null;
        }

        _send(payload) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
            this.ws.send(JSON.stringify(payload));
            return true;
        }

        _handleMessage(raw) {
            let message;
            try {
                message = JSON.parse(raw);
            } catch (_) {
                return;
            }

            if (message.seq != null && Number(message.seq) < this.state.latestSeq) {
                return;
            }

            switch (message.type) {
                case "ready":
                case "config":
                    this._applyConfig(message.config);
                    break;
                case "starting":
                    this.state.running = true;
                    this.generationStartTime = Date.now();
                    this.currentStep = 0;
                    this._setProgress(0);
                    this._setStatus("Đang gửi prompt...", "running");
                    break;
                case "queued":
                    this.state.running = true;
                    this._setStatus("Đang chờ ComfyUI...", "running");
                    break;
                case "node":
                    this._setStatus(message.message || "Đang xử lý node...", "running");
                    break;
                case "progress":
                    this.state.running = true;
                    this.currentStep = Number(message.value) || 0;
                    this._setProgress(Number(message.percent) || 0);
                    this._setStatus(message.message || "Đang tạo...", "running");
                    break;
                case "preview":
                    const pMode = (this.state.config || {}).preview_mode || "live";
                    if (pMode === "live") {
                        this._showImage(message.image, true);
                    } else if (pMode === "every_5") {
                        if (this.currentStep > 0 && this.currentStep % 5 === 0) {
                            this._showImage(message.image, true);
                        }
                    }
                    break;
                case "final":
                    this.state.running = false;
                    this._setProgress(100);
                    this._showImage(message.image, false);
                    this.lastFinalImageBase64 = message.image; // Lưu ảnh để ghim/refine

                    if (message.snapshot_id && this.state.config) {
                        this.state.config.snapshot_id = message.snapshot_id;
                    }
                    if (message.config && this.state.config) {
                        this.state.config = { ...this.state.config, ...message.config };
                    }

                    const elapsed = this.generationStartTime
                        ? ((Date.now() - this.generationStartTime) / 1000).toFixed(1)
                        : null;
                    const timeText = elapsed ? `${elapsed}s` : "hoàn tất";
                    this._setStatus(`Hoàn tất trong ${timeText}`, "ready");

                    // Tự động tải lại lưới lịch sử & yêu thích nếu panel timeline đang mở
                    const panel = document.querySelector(".live-gen-timeline-panel");
                    if (panel) {
                        this._loadTimelineTab(panel, "history");
                        this._loadTimelineTab(panel, "favorite");
                    }
                    break;
                case "idle":
                    this.state.running = false;
                    this._setProgress(0);
                    this._setStatus("Sẵn sàng.", "ready");
                    break;
                case "cancelled":
                    this.state.running = false;
                    this._setStatus("Đã hủy tác vụ cũ.", "idle");
                    break;
                case "error":
                    this.state.running = false;
                    this._setStatus(message.message || "Live Gen lỗi.", "error");
                    window.showError?.(`Live Gen: ${message.message || "Lỗi không xác định."}`);
                    break;
            }
        }

        _showImage(src, isPreview) {
            if (!src || !this.imageEl) return;
            const wasPreview = this.imageEl.classList.contains("is-preview");
            if (isPreview) {
                this.imageEl.classList.remove("is-preview-fading");
                const blur = parseFloat(localStorage.getItem(STORAGE_BLUR)) || 0;
                this.imageEl.style.setProperty("--preview-blur", `${blur}px`);
            } else {
                this.imageEl.classList.toggle("is-preview-fading", wasPreview);
            }
            this.imageEl.src = src;
            this.imageEl.classList.toggle("is-preview", !!isPreview);
            this.imageEl.classList.add("is-loaded");
            this.emptyEl?.classList.add("is-hidden");
        }

        _setStatus(text, mode = "idle") {
            if (this.statusEl) this.statusEl.textContent = text;
            if (this.dotEl) {
                this.dotEl.dataset.mode = mode;
            }
        }

        _setProgress(percent) {
            const safe = Math.max(0, Math.min(100, Number(percent) || 0));
            if (this.progressBarEl) this.progressBarEl.style.width = `${safe}%`;
        }

        _updateNav() {
            const navibar = window.Yuuka?.services?.navibar;
            if (!navibar) return;

            navibar.registerButton({
                id: "live-gen-edit",
                type: "tools",
                pluginId: PLUGIN_ID,
                order: 10,
                icon: "stylus",
                title: "Sửa prompt",
                isActive: () => !!document.querySelector(".live-gen-prompt-shell"),
                onClick: () => this._openPromptMode(),
            });

            navibar.setActivePlugin(PLUGIN_ID);
        }

        _openPromptMode() {
            const navibar = window.Yuuka?.services?.navibar;
            if (!navibar) return;

            const shell = document.createElement("div");
            shell.className = "live-gen-prompt-shell";
            shell.innerHTML = `
                <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="back" title="Trở lại">
                    <span class="material-symbols-outlined">keyboard_arrow_down</span>
                </button>
                <div class="live-gen-prompt-field">
                    <textarea class="live-gen-prompt-input" rows="1" placeholder="Nhập prompt..."></textarea>
                </div>
                <div class="live-gen-prompt-actions-wrapper">
                    <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="dice" title="Đổi seed ngẫu nhiên (Reroll Seed)">
                        <span class="material-symbols-outlined">casino</span>
                    </button>
                    <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="refine" title="Tinh chỉnh ảnh (+10 steps)">
                        <span class="material-symbols-outlined">auto_awesome</span>
                    </button>
                </div>
            `;

            const input = shell.querySelector(".live-gen-prompt-input");
            input.value = this.state.prompt;
            this._attachAutocomplete(input);
            this._autoGrow(input);

            shell.querySelector('[data-action="back"]').addEventListener("click", () => navibar.showSearchBar(null));
            
            const diceBtn = shell.querySelector('[data-action="dice"]');
            diceBtn.addEventListener("click", async () => {
                const newSeed = Math.floor(Math.random() * 1000000000);
                try {
                    const saved = await this.pluginApi.post("/config", { seed: newSeed });
                    this._applyConfig(saved.config);
                    this._send({ type: "update_config", config: saved.config });
                    // Sync seed input in settings panel if open
                    const seedInput = document.querySelector('.live-gen-settings-panel [data-role="seed"]');
                    if (seedInput) seedInput.value = String(newSeed);
                    this.lastGeneratedPrompt = "";
                    this._scheduleGeneration(15);
                    window.showSuccess?.(`Đã đổi ngẫu nhiên seed mới: ${newSeed}`);
                } catch (err) {
                    window.showError?.(`Không thể lưu seed mới: ${err.message}`);
                }
            });
            diceBtn.addEventListener("mousedown", (e) => e.preventDefault());

            const refineBtn = shell.querySelector('[data-action="refine"]');
            refineBtn.addEventListener("click", () => this._runRefine());
            refineBtn.addEventListener("mousedown", (e) => e.preventDefault());
            input.addEventListener("input", () => {
                this.state.prompt = input.value;
                localStorage.setItem(STORAGE_PROMPT, this.state.prompt);
                this._autoGrow(input);
                const trimmed = this.state.prompt.trim();
                if (!trimmed) {
                    this.lastGeneratedPrompt = "";
                    clearTimeout(this.debounceTimer);
                    this._send({ type: "cancel" });
                    this._setProgress(0);
                    this._setStatus("Sẵn sàng.", "ready");
                    return;
                }
                const immediate = /[\r\n,]\s*$/.test(trimmed);
                this._scheduleGeneration(immediate ? 200 : 600);
            });

            navibar.showSearchBar(shell);
            this._autoGrow(input);
            
            // Tạo mobile nav buttons
            this._setupMobileNavButtons();
            
            // Xử lý focus/blur để hiển thị mobile nav buttons
            input.addEventListener("focus", () => {
                document.body.classList.add("live-gen-prompt-focused");
                this._updateMobileNavButtonsPosition();
            });
            input.addEventListener("blur", () => {
                document.body.classList.remove("live-gen-prompt-focused");
            });
            
            setTimeout(() => {
                this._autoGrow(input);
                input.focus({ preventScroll: true });
                input.setSelectionRange(input.value.length, input.value.length);
                this._updateMobileNavButtonsPosition();
            }, 0);
        }

        _attachAutocomplete(input) {
            if (!input || !this.tags.length) return;
            const field = input.closest(".live-gen-prompt-field");
            if (!field || field.dataset.autocompleteReady === "true") return;
            field.dataset.autocompleteReady = "true";
            try {
                this._initTagAutocompleteWithThumbnail(field, this.tags, this.characters);
            } catch (_) {}
        }

        _initTagAutocompleteWithThumbnail(formContainer, tagPredictions, characters) {
            if (!tagPredictions || !tagPredictions.length) return;
            formContainer.querySelectorAll('textarea, input[type="text"]').forEach(input => {
                if (input.parentElement.classList.contains('tag-autocomplete-container')) return;
                const wrapper = document.createElement('div');
                wrapper.className = 'tag-autocomplete-container';
                input.parentElement.insertBefore(wrapper, input);
                wrapper.appendChild(input);
                const list = document.createElement('ul');
                list.className = 'tag-autocomplete-list';
                wrapper.appendChild(list);
                let activeIndex = -1;
                const hide = () => { list.style.display = 'none'; list.innerHTML = ''; activeIndex = -1; };
                
                input.addEventListener('input', () => {
                    const textValue = input.value;
                    const cursor = input.selectionStart;
                    const before = textValue.substring(0, cursor);
                    const lastComma = before.lastIndexOf(',');
                    const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
                    const lastSep = Math.max(lastComma, lastNewline);
                    const current = before.substring(lastSep + 1).trim();
                    
                    if (current.length < 1) { hide(); return; }
                    const search = current.replace(/\s+/g, '_').toLowerCase();
                    
                    // Intelligent scoring and ranking search algorithm
                    const matches = tagPredictions
                        .map(t => {
                            const tLower = t.toLowerCase();
                            let score = 0;
                            if (tLower === search) {
                                score = 4; // Perfect match
                            } else if (tLower.startsWith(search)) {
                                score = 3; // Starts with (prefix)
                            } else if (tLower.includes('_' + search) || tLower.includes('(' + search)) {
                                score = 2; // Word boundary match (e.g., "mahiru" matches "shiina_mahiru")
                            } else if (tLower.includes(search)) {
                                score = 1; // Substring match anywhere
                            }
                            return { tag: t, score };
                        })
                        .filter(x => x.score > 0)
                        // Sort by score descending. Since JavaScript's sort is stable in modern engines,
                        // items with the same score maintain their original order (popularity descending).
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 15)
                        .map(x => x.tag);

                    if (matches.length) {
                        list.innerHTML = matches.map(m => {
                            const foundChar = (Array.isArray(characters) && characters.length) ? characters.find(c => {
                                if (!c || !c.name) return false;
                                const cName = c.name.replace(/\s+/g, '_').toLowerCase();
                                return cName === m || cName.startsWith(m) || m.startsWith(cName);
                            }) : null;
                            
                            if (foundChar) {
                                const imgUrl = `/image/${foundChar.hash}`;
                                return `
                                    <li class="tag-autocomplete-item tag-autocomplete-item--character" data-tag="${m}">
                                        <div class="autocomplete-char-thumb">
                                            <img src="${imgUrl}" alt="${this._escapeHtml(foundChar.name)}" loading="lazy">
                                        </div>
                                        <div class="autocomplete-char-meta">
                                            <span class="autocomplete-char-name">${this._escapeHtml(m.replace(/_/g, ' '))}</span>
                                            <span class="autocomplete-char-label">Nhân vật</span>
                                        </div>
                                    </li>`;
                            } else {
                                return `<li class="tag-autocomplete-item" data-tag="${m}">${m.replace(/_/g, ' ')}</li>`;
                            }
                        }).join('');
                        list.style.display = 'block';
                        activeIndex = -1;
                    } else hide();
                });
                
                const applyTag = tag => {
                    const textValue = input.value;
                    const cursor = input.selectionStart;
                    const before = textValue.substring(0, cursor);
                    const after = textValue.substring(cursor);
                    
                    const lastComma = before.lastIndexOf(',');
                    const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
                    const lastSep = Math.max(lastComma, lastNewline);
                    
                    const nextComma = after.indexOf(',');
                    const nextNewline = after.indexOf('\n');
                    const nextCarriageReturn = after.indexOf('\r');
                    const afterSepIndices = [nextComma, nextNewline, nextCarriageReturn].filter(idx => idx !== -1);
                    const nextSep = afterSepIndices.length > 0 ? Math.min(...afterSepIndices) : -1;
                    
                    let prefix = textValue.substring(0, lastSep + 1);
                    let suffix = nextSep !== -1 ? after.substring(nextSep) : "";
                    
                    if (prefix.endsWith(',')) {
                        prefix += ' ';
                    } else if (prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n') && !prefix.endsWith('\r')) {
                        prefix += ' ';
                    }
                    
                    if (suffix.startsWith(',')) {
                        suffix = suffix.substring(1).replace(/^\s+/, '');
                    }
                    
                    const insertedTag = tag.replace(/_/g, ' ');
                    const result = `${prefix}${insertedTag}, ${suffix}`;
                    
                    input.value = result;
                    const newCursor = prefix.length + insertedTag.length + 2;
                    input.focus();
                    input.setSelectionRange(newCursor, newCursor);
                    hide();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                
                list.addEventListener('mousedown', ev => {
                    ev.preventDefault();
                    const item = ev.target.closest('.tag-autocomplete-item');
                    if (item) applyTag(item.dataset.tag);
                });
                input.addEventListener('keydown', ev => {
                    const items = list.querySelectorAll('.tag-autocomplete-item');
                    if (!items.length) return;
                    if (ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        activeIndex = (activeIndex + 1) % items.length;
                    } else if (ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        activeIndex = (activeIndex - 1 + items.length) % items.length;
                    } else if ((ev.key === 'Enter' || ev.key === 'Tab') && activeIndex > -1) {
                        ev.preventDefault();
                        applyTag(items[activeIndex].dataset.tag);
                    } else if (ev.key === 'Escape') {
                        hide();
                    }
                    items.forEach((it, idx) => it.classList.toggle('active', idx === activeIndex));
                });
                input.addEventListener('blur', () => setTimeout(hide, 150));
            });
        }

        _autoGrow(input) {
            if (!input) return;
            input.style.height = "auto";
            const currentHeight = input.scrollHeight;
            const spill = currentHeight > 150;
            input.style.height = `${Math.min(currentHeight, 150)}px`;
            input.style.overflowY = spill ? "auto" : "hidden";

            const shell = input.closest(".live-gen-prompt-shell");
            if (shell) {
                // If scrollHeight is greater than 40px (single line height is ~36px), it's multiline
                shell.classList.toggle("is-multiline", currentHeight > 40);
            }
            
            // Cập nhật vị trí mobile nav buttons theo chiều cao của prompt shell
            this._updateMobileNavButtonsPosition();
        }

        _updateMobileNavButtonsPosition() {
            const mobileButtons = document.getElementById("live-gen-mobile-nav-buttons");
            if (!mobileButtons) return;
            
            const promptShell = document.querySelector(".live-gen-prompt-shell");
            if (!promptShell) return;
            
            // Lấy chiều cao của prompt shell
            const shellHeight = promptShell.offsetHeight;
            const gap = 8; // Khoảng cách giữa buttons và prompt shell
            
            // Tính toán vị trí bottom: shell height + gap
            // (shell đã nằm trên navibar rồi, nên chỉ cần tính từ shell)
            const bottomPosition = shellHeight + gap;
            mobileButtons.style.bottom = `${bottomPosition}px`;
        }

        _setupMobileNavButtons() {
            // Xóa buttons cũ nếu có
            this._removeMobileNavButtons();
            
            // Tạo container cho mobile nav buttons
            const container = document.createElement("div");
            container.className = "live-gen-mobile-nav-buttons";
            container.id = "live-gen-mobile-nav-buttons";
            
            // Tạo Keep button
            const keepBtn = document.createElement("button");
            keepBtn.className = "live-gen-mobile-nav-btn";
            keepBtn.dataset.action = "keep";
            keepBtn.innerHTML = `
                <span class="material-symbols-outlined">keep</span>
                <span>Keep</span>
            `;
            keepBtn.addEventListener("mousedown", (e) => e.preventDefault()); // Ngăn blur
            keepBtn.addEventListener("click", () => this._toggleKeep());
            
            // Tạo Hires button
            const hiresBtn = document.createElement("button");
            hiresBtn.className = "live-gen-mobile-nav-btn";
            hiresBtn.dataset.action = "hires";
            hiresBtn.innerHTML = `
                <span class="material-symbols-outlined">hd</span>
                <span>Hires</span>
            `;
            hiresBtn.addEventListener("mousedown", (e) => e.preventDefault()); // Ngăn blur
            hiresBtn.addEventListener("click", () => this._toggleHires());
            
            // Tạo Settings button
            const settingsBtn = document.createElement("button");
            settingsBtn.className = "live-gen-mobile-nav-btn";
            settingsBtn.dataset.action = "settings";
            settingsBtn.innerHTML = `
                <span class="material-symbols-outlined">settings</span>
                <span>Settings</span>
            `;
            settingsBtn.addEventListener("mousedown", (e) => e.preventDefault()); // Ngăn blur
            settingsBtn.addEventListener("click", () => this._openSettings());
            
            // Tạo Timeline button
            const timelineBtn = document.createElement("button");
            timelineBtn.className = "live-gen-mobile-nav-btn";
            timelineBtn.dataset.action = "timeline";
            timelineBtn.innerHTML = `
                <span class="material-symbols-outlined">history</span>
                <span>History</span>
            `;
            timelineBtn.addEventListener("mousedown", (e) => e.preventDefault()); // Ngăn blur
            timelineBtn.addEventListener("click", () => this._openTimeline());
            
            container.appendChild(keepBtn);
            container.appendChild(hiresBtn);
            container.appendChild(settingsBtn);
            container.appendChild(timelineBtn);
            
            // Thêm vào body (fixed position, nằm trên navibar)
            document.body.appendChild(container);
            
            // Đồng bộ trạng thái active
            this._syncMobileNavButtonStates();
        }

        _removeMobileNavButtons() {
            const existing = document.getElementById("live-gen-mobile-nav-buttons");
            if (existing) {
                existing.remove();
            }
        }

        _syncMobileNavButtonStates() {
            const mobileContainer = document.getElementById("live-gen-mobile-nav-buttons");
            if (!mobileContainer) return;
            
            // Sync Keep button
            const mobileKeepBtn = mobileContainer.querySelector('[data-action="keep"]');
            if (mobileKeepBtn && this.keepBtn) {
                mobileKeepBtn.classList.toggle("active", this.keepBtn.classList.contains("active"));
            }
            
            // Sync Hires button
            const mobileHiresBtn = mobileContainer.querySelector('[data-action="hires"]');
            if (mobileHiresBtn && this.hiresBtn) {
                mobileHiresBtn.classList.toggle("active", this.hiresBtn.classList.contains("active"));
            }
        }

         _normalizePrompt(rawPrompt) {
            if (!rawPrompt) return "";
            let normalized = rawPrompt.replace(/[\r\n]+/g, ", ");
            normalized = normalized.replace(/,\s*,/g, ",");
            normalized = normalized.replace(/\s*,\s*/g, ", ");
            return normalized.trim().replace(/^,|,$/g, "").trim();
        }

        _escapeHtml(str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        async _openSimpleViewer() {
            const viewer = window.Yuuka?.plugins?.simpleViewer;
            if (!viewer || typeof viewer.open !== "function") {
                console.warn("Simple Viewer plugin not found or not loaded.");
                return;
            }

            const currentSrc = this.imageEl.src;
            if (!currentSrc) return;

            // Kiểm tra xem ảnh hiện tại đã nằm trong Favorites chưa
            let isFavorited = false;
            try {
                const currentPath = new URL(currentSrc, window.location.href).pathname;
                const currentSnapshotId = this.state.config?.snapshot_id;
                const favResp = await this.pluginApi.get("/favorites");
                const favImages = favResp.images || [];
                isFavorited = favImages.some(img => {
                    // So khớp bằng snapshot_id (đáng tin cậy nhất vì file đã duplicate)
                    if (currentSnapshotId) {
                        const favSnapId = img.generationConfig?.snapshot_id;
                        if (favSnapId && favSnapId === currentSnapshotId) return true;
                    }
                    // Fallback: so khớp bằng URL path
                    try {
                        const imgPath = new URL(img.url, window.location.origin).pathname;
                        const pvPath = new URL(img.pv_url || img.url, window.location.origin).pathname;
                        return imgPath === currentPath || pvPath === currentPath;
                    } catch (e) {
                        return (img.url && img.url.includes(currentPath)) || (img.pv_url && img.pv_url.includes(currentPath));
                    }
                });
            } catch (e) {
                console.warn("[LiveGen] Không thể kiểm tra trạng thái yêu thích:", e);
            }

            viewer.open({
                items: [
                    { imageUrl: currentSrc, title: this.state.prompt || "Live Gen Image" }
                ],
                startIndex: 0,
                renderInfoPanel: (item) => `
                    <div style="padding: 12px; font-size: 14px; line-height: 1.4; color: var(--color-primary-text);">
                        <strong style="display: block; margin-bottom: 6px; color: var(--color-accent); font-weight: 600;">Prompt gõ:</strong>
                        <div style="font-family: monospace; white-space: pre-wrap; word-break: break-all; max-height: 140px; overflow-y: auto; background: var(--color-primary-bg); padding: 8px; border-radius: var(--rounded-md); border: 1px solid var(--color-border); font-size: 13px;">${this._escapeHtml(item.title)}</div>
                    </div>
                `,
                toolbarButtons: [
                    {
                        icon: "content_copy",
                        title: "Sao chép prompt",
                        onClick: (item, closeViewer) => {
                            if (navigator.clipboard) {
                                navigator.clipboard.writeText(this.state.prompt || "")
                                    .then(() => window.showSuccess?.("Đã sao chép prompt vào bộ nhớ tạm!"))
                                    .catch(() => window.showError?.("Không thể sao chép prompt."));
                            }
                        }
                    },
                    {
                        icon: "favorite",
                        title: "Yêu thích",
                        _initialFilled: isFavorited,
                        onClick: async (item, closeViewer) => {
                            try {
                                const relativeUrl = new URL(item.imageUrl, window.location.href).pathname;
                                const resp = await this.pluginApi.post("/favorite", { imageUrl: relativeUrl });
                                if (resp.status === "success" || resp.status === "exists") {
                                    window.showSuccess?.(resp.message);

                                    // Cập nhật icon sang trạng thái filled
                                    const toolbar = document.querySelector('.sv-viewer-toolbar');
                                    if (toolbar) {
                                        const favBtn = toolbar.querySelector('.sv-viewer-toolbar-btn[title="Yêu thích"] .material-symbols-outlined');
                                        if (favBtn) favBtn.style.fontVariationSettings = "'FILL' 1";
                                    }
                                    
                                    // Cập nhật lại Timeline panel nếu đang mở
                                    const panel = document.querySelector(".live-gen-timeline-panel");
                                    if (panel) {
                                        this._loadTimelineTab(panel, "favorite");
                                    }
                                } else {
                                    window.showError?.(resp.error || "Không thể yêu thích.");
                                }
                            } catch (err) {
                                window.showError?.(`Lỗi yêu thích: ${err.message}`);
                            }
                        }
                    },
                    {
                        icon: "delete",
                        title: "Xóa ảnh",
                        onClick: async (item, closeViewer) => {
                            try {
                                const relativeUrl = new URL(item.imageUrl, window.location.href).pathname;
                                const [historyResp, favResp] = await Promise.all([
                                    this.pluginApi.get("/history"),
                                    this.pluginApi.get("/favorites")
                                ]);
                                const allItems = [...(historyResp.images || []), ...(favResp.images || [])];
                                const matchingItems = allItems.filter(img => {
                                    try {
                                        const dbPath = new URL(img.url, window.location.origin).pathname;
                                        const dbPvPath = new URL(img.pv_url || img.url, window.location.origin).pathname;
                                        return dbPath === relativeUrl || dbPvPath === relativeUrl;
                                    } catch (e) {
                                        return img.url.includes(relativeUrl) || (img.pv_url && img.pv_url.includes(relativeUrl));
                                    }
                                });

                                if (matchingItems.length === 0) {
                                    window.showError?.("Không tìm thấy ảnh này trong lịch sử để xóa.");
                                    return;
                                }

                                const urlsToDelete = new Set(matchingItems.map(img => img.url));
                                const itemsToDelete = allItems.filter(img => urlsToDelete.has(img.url));

                                const confirmDelete = typeof window.Yuuka?.ui?.confirm === 'function'
                                    ? await window.Yuuka.ui.confirm('Bạn có chắc chắn muốn xóa ảnh này cùng các snapshot liên quan?')
                                    : window.confirm('Bạn có chắc chắn muốn xóa ảnh này cùng các snapshot liên quan?');

                                if (!confirmDelete) return;

                                for (const img of itemsToDelete) {
                                    await this.api.images.delete(img.id);
                                }

                                window.showSuccess?.("Đã xóa ảnh thành công!");
                                closeViewer();

                                // Reset lại màn hình preview nếu ảnh vừa xóa chính là ảnh đang hiển thị
                                try {
                                    const currentPreviewUrl = new URL(this.imageEl.src, window.location.href).pathname;
                                    if (currentPreviewUrl === relativeUrl) {
                                        this.imageEl.removeAttribute("src");
                                        this.imageEl.classList.remove("is-loaded");
                                        this.emptyEl?.classList.remove("is-hidden");
                                        if (this.state.config) delete this.state.config.snapshot_id;
                                    }
                                } catch (e) {}

                                // Cập nhật lại Timeline panel nếu đang mở
                                const panel = document.querySelector(".live-gen-timeline-panel");
                                if (panel) {
                                    this._loadTimelineTab(panel, "history");
                                    this._loadTimelineTab(panel, "favorite");
                                }
                            } catch (err) {
                                window.showError?.(`Lỗi xóa ảnh: ${err.message}`);
                            }
                        }
                    }
                ]
            });
        }

        _scheduleGeneration(delay) {
            clearTimeout(this.debounceTimer);
            if (this.state.config) {
                delete this.state.config.snapshot_id;
            }
            this.debounceTimer = setTimeout(() => this._generateNow(), delay);
        }

        _generateNow() {
            const prompt = this._normalizePrompt(this.state.prompt);
            if (!prompt) return;
            if (prompt === this.lastGeneratedPrompt) {
                return;
            }
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this._setStatus("Đang đợi WebSocket...", "idle");
                this._connect();
                return;
            }
            this.lastGeneratedPrompt = prompt;
            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Đang gửi prompt...", "running");
            
            const payload = {
                type: "generate",
                seq: this.seq,
                prompt,
                seed: this.state.seed,
                config: {
                    ...(this.state.config || {}),
                    seed: this.state.seed,
                },
            };

            if (this.state.keepActive && this.lastFinalImageBase64) {
                payload.input_image_base64 = this.lastFinalImageBase64;
                payload.config._workflow_type = "image2image";
                payload.config.denoise = this.state.config.i2i_keep_denoise != null ? this.state.config.i2i_keep_denoise : 0.45;
            }

            this._send(payload);
        }

        _toggleKeep() {
            if (!this.lastFinalImageBase64) {
                window.showError?.("Không có ảnh để ghim. Hãy đợi ảnh tạo xong.");
                return;
            }
            this.state.keepActive = !this.state.keepActive;
            if (this.keepBtn) {
                this.keepBtn.classList.toggle("active", !!this.state.keepActive);
            }
            this._syncMobileNavButtonStates();
        }

        async _toggleHires() {
            if (!this.state.config) return;
            const newHires = !this.state.config.hires_enabled;
            
            const updatedConfig = {
                ...this.state.config,
                hires_enabled: newHires
            };

            try {
                const saved = await this.pluginApi.post("/config", updatedConfig);
                this._applyConfig(saved.config);
                this._send({ type: "update_config", config: saved.config });
                
                if (newHires && this.lastFinalImageBase64) {
                    this._runHiresOnCurrentImage();
                } else {
                    this.lastGeneratedPrompt = "";
                    this._scheduleGeneration(15);
                }
            } catch (err) {
                window.showError?.(`Không thể lưu cấu hình Hires: ${err.message}`);
            }
        }

        _runHiresOnCurrentImage() {
            if (!this.lastFinalImageBase64) return;
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this._setStatus("Đang đợi WebSocket...", "idle");
                this._connect();
                return;
            }

            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Upscaling (Hires Fix)...", "running");

            this._send({
                type: "generate",
                seq: this.seq,
                prompt: this._normalizePrompt(this.state.prompt),
                seed: this.state.seed,
                input_image_base64: this.lastFinalImageBase64,
                config: {
                    ...(this.state.config || {}),
                    seed: this.state.seed,
                    _workflow_type: "image2image",
                    hires_enabled: true,
                }
            });
        }

        _runRefine() {
            if (!this.lastFinalImageBase64) {
                window.showError?.("Không có ảnh để Refine. Hãy đợi ảnh tạo xong.");
                return;
            }
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                window.showError?.("WebSocket chưa kết nối!");
                return;
            }
            
            const steps = (Number(this.state.config.steps) || 12) + 10;
            const denoise = this.state.config.i2i_refine_denoise != null ? this.state.config.i2i_refine_denoise : 0.25;
            
            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Refining...", "running");
            
            this._send({
                type: "generate",
                seq: this.seq,
                prompt: this._normalizePrompt(this.state.prompt),
                seed: this.state.seed,
                input_image_base64: this.lastFinalImageBase64,
                config: {
                    ...(this.state.config || {}),
                    seed: this.state.seed,
                    _workflow_type: "image2image",
                    denoise: denoise,
                    steps: steps,
                }
            });
            window.showSuccess?.(`Đang Refine với +10 steps (tổng: ${steps})!`);
        }

        async _openSettings() {
            // Dismiss mobile keyboard if prompt or any input is focused
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }

            const existingTimeline = document.querySelector(".live-gen-timeline-panel");
            if (existingTimeline) {
                existingTimeline.classList.remove("open");
                document.body.classList.remove("live-gen-timeline-open");
                document.body.classList.add("live-gen-settings-open");
                existingTimeline.remove();
            }

            const existingPanel = document.querySelector(".live-gen-settings-panel");
            if (existingPanel) {
                const closeBtn = existingPanel.querySelector('[data-action="close"]');
                if (closeBtn) {
                    closeBtn.click();
                } else {
                    existingPanel.classList.remove("open");
                    document.body.classList.remove("live-gen-settings-open");
                    setTimeout(() => existingPanel.remove(), 300);
                }
                return;
            }
            const panel = document.createElement("div");
            panel.className = "live-gen-settings-panel";
            panel.innerHTML = `
                <header class="live-gen-settings-panel__header">
                    <h2>Cấu hình Live Gen</h2>
                    <button type="button" class="live-gen-icon-btn" data-action="close" title="Đóng">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </header>
                
                <div class="live-gen-settings-tabs">
                    <button type="button" class="live-gen-tab-btn active" data-tab="style_lora">Style & LoRA</button>
                    <button type="button" class="live-gen-tab-btn" data-tab="generation">Generation</button>
                    <button type="button" class="live-gen-tab-btn" data-tab="i2i">I2I</button>
                </div>

                <div class="live-gen-settings-panel__form" style="opacity: 0.6; pointer-events: none;">
                    <p style="text-align: center; padding: 20px;">Đang tải danh sách từ ComfyUI...</p>
                </div>
            `;

            document.body.appendChild(panel);

            // Add classes for opening slide animation
            setTimeout(() => {
                panel.classList.add("open");
                document.body.classList.add("live-gen-settings-open");
            }, 10);

            panel.addEventListener("mousedown", (event) => event.stopPropagation());
            panel.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });

            const close = () => {
                panel.classList.remove("open");
                document.body.classList.remove("live-gen-settings-open");
                setTimeout(() => {
                    panel.remove();
                }, 300);
                const navibar = window.Yuuka?.services?.navibar;
                if (navibar && !navibar._isSearchActive && !this.destroyed) {
                    setTimeout(() => this._openPromptMode(), 0);
                }
            };

            panel.querySelector('[data-action="close"]').addEventListener("click", close);
            panel.querySelector('[data-action="close"]').addEventListener("mousedown", (e) => e.preventDefault());

            // Tab switching logic
            const tabButtons = panel.querySelectorAll(".live-gen-tab-btn");
            tabButtons.forEach(btn => {
                btn.addEventListener("click", () => {
                    tabButtons.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    
                    const tabId = btn.dataset.tab;
                    const contents = panel.querySelectorAll(".live-gen-tab-content");
                    contents.forEach(c => {
                        c.classList.toggle("active", c.dataset.tabContent === tabId);
                    });
                });
            });

            let choices = { checkpoints: [], loras: [], samplers: [], schedulers: [] };
            try {
                choices = await this.pluginApi.get("/comfy-info");
            } catch (err) {
                console.error("Could not fetch ComfyUI backend options:", err);
            }

            const formEl = panel.querySelector(".live-gen-settings-panel__form");
            const cfg = this.state.config || {};

            // --- Multi-LoRA Preparation & Helpers ---
            const escapeHtml = (value) => {
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
            };
            const escapeAttr = (value) => escapeHtml(value).replace(/`/g, '&#96;');
            const truncateText = (value, maxLength = 40) => {
                if (value === null || value === undefined) return '';
                const text = String(value);
                if (text.length <= maxLength) return text;
                const suffix = '...';
                const sliceLength = Math.max(0, maxLength - suffix.length);
                return `${text.slice(0, sliceLength).trimEnd()}${suffix}`;
            };

            const normalizeTag = (tag) => tag.trim().toLowerCase();
            const parseWordGroup = (group) => {
                if (typeof group === 'string') {
                    const parts = group.split(',').map(s => s.trim()).filter(Boolean);
                    if (parts.length) return parts;
                    const trimmed = group.trim();
                    return trimmed ? [trimmed] : [];
                }
                if (Array.isArray(group)) {
                    return group.map(item => String(item).trim()).filter(Boolean);
                }
                return [];
            };
            const formatGroupText = (group) => parseWordGroup(group).join(', ');
            const prettifyLabel = (value) => {
                if (typeof value !== 'string') return '';
                return value
                    .replace(/[_-]+/g, ' ')
                    .split(/\s+/)
                    .filter(Boolean)
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            };

            const getModelData = (metadata) => {
                if (!metadata) return null;
                const raw = metadata.model_data;
                if (!raw) return null;
                if (typeof raw === 'object') return raw;
                if (typeof raw === 'string') {
                    try {
                        return JSON.parse(raw);
                    } catch (err) {
                        console.warn('[LiveGen] Unable to parse LoRA metadata:', err);
                    }
                }
                return null;
            };
            const getPrimaryModelTag = (metadata) => {
                const modelData = getModelData(metadata);
                const versions = modelData?.modelVersions;
                if (Array.isArray(versions) && versions.length) {
                    for (const version of versions) {
                        const words = version?.trainedWords;
                        if (Array.isArray(words)) {
                            for (const entry of words) {
                                if (Array.isArray(entry)) {
                                    const cleaned = entry.map(part => String(part).trim()).filter(Boolean);
                                    if (cleaned.length) return cleaned[0];
                                    continue;
                                }
                                if (typeof entry === 'string') {
                                    const parts = entry.split(',').map(part => part.trim()).filter(Boolean);
                                    if (parts.length) return parts[0];
                                    if (entry.trim()) return entry.trim();
                                }
                            }
                        } else if (typeof words === 'string') {
                            const parts = words.split(',').map(part => part.trim()).filter(Boolean);
                            if (parts.length) return parts[0];
                            if (words.trim()) return words.trim();
                        }
                    }
                }
                return null;
            };
            const normalizeTagValue = (value) => {
                if (typeof value !== 'string') return '';
                return value.replace(/[_\s]+/g, ' ').trim().toLowerCase();
            };
            const extractModelTags = (metadata) => {
                const tags = [];
                const seen = new Set();
                const addTag = (raw) => {
                    if (typeof raw !== 'string') return;
                    const trimmed = raw.trim();
                    if (!trimmed) return;
                    const normalized = normalizeTagValue(trimmed);
                    if (!normalized || seen.has(normalized)) return;
                    seen.add(normalized);
                    tags.push(trimmed);
                };

                const modelData = getModelData(metadata);
                const trainedWords = modelData?.trainedWords;
                if (Array.isArray(trainedWords)) {
                    trainedWords.forEach(entry => {
                        if (typeof entry !== 'string') return;
                        entry.split(',').forEach(addTag);
                    });
                } else if (typeof trainedWords === 'string') {
                    trainedWords.split(',').forEach(addTag);
                }

                const versions = modelData?.modelVersions;
                if (Array.isArray(versions)) {
                    versions.forEach(version => {
                        const words = version?.trainedWords;
                        if (!Array.isArray(words)) return;
                        words.forEach(entry => {
                            if (typeof entry !== 'string') return;
                            entry.split(',').forEach(addTag);
                        });
                    });
                }

                const dataTags = modelData?.tags;
                if (Array.isArray(dataTags)) {
                    dataTags.forEach(addTag);
                }

                const rootTags = metadata?.tags;
                if (Array.isArray(rootTags)) {
                    rootTags.forEach(addTag);
                }

                return tags;
            };
            const resolveLoraCharacterName = (metadata, fallback = '') => {
                if (!metadata) return fallback || 'LoRA';
                const primary = getPrimaryModelTag(metadata);
                if (primary) return prettifyLabel(primary);
                const tags = extractModelTags(metadata);
                if (tags.length) return prettifyLabel(tags[0]);
                const base = (metadata.name || metadata.filename || fallback || '').trim();
                if (!base) return fallback || 'LoRA';
                const words = base.split(/\s+/).filter(Boolean).slice(0, 2);
                return prettifyLabel(words.length ? words.join(' ') : base);
            };
            const getLoraThumbnailUrl = (metadata) => {
                if (!metadata) return null;
                const directUrl = metadata.preview_url || metadata.thumbnail || metadata.cover_image;
                if (typeof directUrl === 'string' && directUrl.trim()) {
                    return directUrl.trim();
                }
                const modelData = getModelData(metadata);
                const versions = modelData?.modelVersions;
                if (Array.isArray(versions)) {
                    for (const version of versions) {
                        const images = version?.images;
                        if (!Array.isArray(images)) continue;
                        for (const image of images) {
                            const url = image?.url || image?.imageUrl || image?.meta?.url;
                            if (typeof url === 'string' && url.trim()) {
                                return url.trim();
                            }
                        }
                    }
                }
                return null;
            };

            const loraDefaults = choices.lora_defaults || { lora_strength_model: 0.9, lora_strength_clip: 1.0 };
            let loraMetadataMap = {};
            let loraMetadataPromise = null;
            const ensureLoraMetadata = () => {
                if (Object.keys(loraMetadataMap).length) return Promise.resolve(loraMetadataMap);
                if (loraMetadataPromise) return loraMetadataPromise;
                if (this.api['lora-downloader'] && typeof this.api['lora-downloader'].get === 'function') {
                    loraMetadataPromise = this.api['lora-downloader'].get('/lora-data')
                        .then(resp => { if (resp && typeof resp.models === 'object') loraMetadataMap = resp.models; return loraMetadataMap; })
                        .catch(err => { console.warn('[LiveGen] Unable to fetch LoRA metadata:', err); return loraMetadataMap; });
                } else {
                    loraMetadataPromise = Promise.resolve(loraMetadataMap);
                }
                return loraMetadataPromise;
            };

            const openSimpleViewer = (metadata, initialUrl = null) => {
                if (!metadata) {
                    window.showError?.('Không tìm thấy dữ liệu LoRA để hiện preview.');
                    return;
                }
                const viewer = window?.Yuuka?.plugins?.simpleViewer;
                if (!viewer || typeof viewer.open !== 'function') {
                    window.showError?.('Simple viewer chưa sẵn sàng.');
                    return;
                }
                const items = [];
                const seen = new Set();
                const addUrl = (url) => {
                    if (typeof url !== 'string') return;
                    const trimmed = url.trim();
                    if (!trimmed || seen.has(trimmed)) return;
                    seen.add(trimmed);
                    items.push({
                        imageUrl: trimmed,
                        title: metadata?.name || metadata?.filename || 'Preview',
                    });
                };
                addUrl(metadata?.preview_url);
                addUrl(metadata?.thumbnail);
                addUrl(metadata?.cover_image);
                const modelData = getModelData(metadata);
                const versions = modelData?.modelVersions;
                if (Array.isArray(versions)) {
                    versions.forEach((version) => {
                        const images = version?.images;
                        if (!Array.isArray(images)) return;
                        images.forEach((image) => {
                            addUrl(image?.url || image?.imageUrl || image?.meta?.url);
                        });
                    });
                }
                const galleries = modelData?.galleries;
                if (Array.isArray(galleries)) {
                    galleries.forEach((entry) => addUrl(entry?.url));
                }
                if (!items.length) {
                    window.showError?.('LoRA này không có ảnh preview.');
                    return;
                }
                const startIndex = initialUrl
                    ? items.findIndex(item => item.imageUrl === initialUrl)
                    : 0;
                viewer.open({
                    items,
                    startIndex: startIndex >= 0 ? startIndex : 0,
                });
            };

            const findLoraMetadata = (value) => {
                if (!value) return undefined;
                const direct = (loraMetadataMap && typeof loraMetadataMap === 'object') ? loraMetadataMap[value] : undefined;
                if (direct) return direct;
                const list = Object.values(loraMetadataMap || {});
                for (const entry of list) {
                    if (!entry) continue;
                    if (entry.filename && entry.filename === value) return entry;
                    if (entry.name && entry.name === value) return entry;
                }
                return undefined;
            };

            const extractTrainedWords = (metadata) => {
                const collected = [];
                if (!metadata || !metadata.model_data) return collected;
                const versions = Array.isArray(metadata.model_data.modelVersions) ? metadata.model_data.modelVersions : [];
                for (const version of versions) {
                    if (!Array.isArray(version.trainedWords)) continue;
                    const normalized = version.trainedWords
                        .map(entry => {
                            if (Array.isArray(entry)) {
                                return entry.join(', ').trim();
                            }
                            if (typeof entry === 'string') {
                                return entry.trim();
                            }
                            return '';
                        })
                        .filter(Boolean);
                    if (normalized.length) {
                        collected.push(...normalized);
                        break;
                    }
                }
                return collected;
            };

            const buildLoraCards = (grid, wrappersCtx) => {
                if (!grid) return;
                grid.innerHTML = '';
                const cardOptions = Array.isArray(choices.loras) && choices.loras.length ? choices.loras : [];
                cardOptions.forEach(loraName => {
                    if (!loraName || loraName === 'None') return;
                    const metadata = findLoraMetadata(loraName);
                    let displayName = resolveLoraCharacterName(metadata, loraName);
                    let subtitle = (metadata?.filename || metadata?.name || loraName);
                    const thumbUrl = getLoraThumbnailUrl(metadata);

                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'lora-card';
                    card.dataset.value = loraName;
                    card.setAttribute('role', 'option');
                    card.innerHTML = `
                        <div class="lora-card__thumb">${thumbUrl ? `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(displayName)}" loading="lazy">` : ''}</div>
                        <div class="lora-card__meta">
                            <div class="lora-card__title">${escapeHtml(truncateText(displayName, 32))}</div>
                            <div class="lora-card__subtitle">${escapeHtml(truncateText(subtitle, 32))}</div>
                        </div>
                    `;

                    if (thumbUrl && metadata) {
                        const thumbEl = card.querySelector('.lora-card__thumb');
                        if (thumbEl) {
                            thumbEl.title = 'Xem ảnh preview';
                            thumbEl.style.cursor = 'zoom-in';
                            thumbEl.addEventListener('click', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openSimpleViewer(metadata, thumbUrl);
                            });
                        }
                    }

                    card.addEventListener('click', () => wrappersCtx.select(loraName, displayName));
                    grid.appendChild(card);
                });
            };

            // Options mapping for selectors
            const ckptOptions = (choices.checkpoints || [])
                .map(c => `<option value="${c}" ${cfg.ckpt_name === c ? "selected" : ""}>${c}</option>`)
                .join("") || `<option value="${cfg.ckpt_name || ""}">${cfg.ckpt_name || "Mặc định"}</option>`;

            const samplerOptions = (choices.samplers || [])
                .map(s => `<option value="${s}" ${cfg.sampler_name === s ? "selected" : ""}>${s}</option>`)
                .join("") || `<option value="${cfg.sampler_name || ""}">${cfg.sampler_name || "Mặc định"}</option>`;

            const schedulerOptions = (choices.schedulers || [])
                .map(s => `<option value="${s}" ${cfg.scheduler === s ? "selected" : ""}>${s}</option>`)
                .join("") || `<option value="${cfg.scheduler || ""}">${cfg.scheduler || "Mặc định"}</option>`;

            const currentSize = `${cfg.width || 832}x${cfg.height || 1216}`;
            const baseSizeOptions = [
                { name: "IL 832x1216 - Chân dung (Khuyến nghị)", value: "832x1216" },
                { name: "IL 1216x832 - Phong cảnh", value: "1216x832" },
                { name: "IL 1344x768", value: "1344x768" },
                { name: "IL 1024x1024 - Vuông", value: "1024x1024" }
            ];
            const sizeVariants = [];
            baseSizeOptions.forEach(opt => {
                const [w, h] = opt.value.split("x").map(Number);
                const sw = Math.round(w / 1.5 / 8) * 8;
                const sh = Math.round(h / 1.5 / 8) * 8;
                sizeVariants.push({ name: `${opt.name} / 1.5 (${sw}x${sh})`, value: `${sw}x${sh}` });
                sizeVariants.push({ name: opt.name, value: opt.value });
                sizeVariants.push({ name: `${opt.name} x2 (${w*2}x${h*2})`, value: `${w*2}x${h*2}` });
            });

            if (!sizeVariants.some(opt => opt.value === currentSize)) {
                sizeVariants.unshift({ name: `Tùy chỉnh (${currentSize})`, value: currentSize });
            }

            const sizeOptions = sizeVariants
                .map(opt => `<option value="${opt.value}" ${currentSize === opt.value ? "selected" : ""}>${opt.name}</option>`)
                .join("");

            // Rebuild Form Content HTML
            formEl.innerHTML = `
                <!-- Tab 1: Style & LoRA -->
                <div class="live-gen-tab-content active" data-tab-content="style_lora">
                    <label class="live-gen-setting-row">
                        <span>Quality Tags</span>
                        <input type="text" data-role="quality" value="${cfg.quality || ""}">
                    </label>

                    <label class="live-gen-setting-row">
                        <span>Negative Tags</span>
                        <input type="text" data-role="negative" value="${cfg.negative || ""}">
                    </label>

                    <div class="form-group lora-select-group" style="gap: var(--spacing-2); display: flex; flex-direction: column;">
                        <span>LoRA</span>
                        <!-- Yuuka: Multi-LoRA preparation wrapper v1.0 -->
                        <div class="lora-multi-container" data-role="lora-multi-container"></div>
                        <div class="lora-multi-add" data-role="lora-multi-add">
                            <button type="button" class="lora-multi-add__btn" title="Thêm LoRA (+)">
                                <span class="material-symbols-outlined">add</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Tab 2: Generation -->
                <div class="live-gen-tab-content" data-tab-content="generation">
                    <label class="live-gen-setting-row">
                        <span>Kích thước (Size)</span>
                        <select data-role="size">
                            ${sizeOptions}
                        </select>
                    </label>

                    <label class="live-gen-setting-row">
                        <span>Checkpoint</span>
                        <select data-role="ckpt_name">
                            ${ckptOptions}
                        </select>
                    </label>

                    <div class="live-gen-setting-group">
                        <label class="live-gen-setting-row">
                            <span>Sampler</span>
                            <select data-role="sampler_name">
                                ${samplerOptions}
                            </select>
                        </label>
                        <label class="live-gen-setting-row">
                            <span>Scheduler</span>
                            <select data-role="scheduler">
                                ${schedulerOptions}
                            </select>
                        </label>
                    </div>

                    <div class="live-gen-setting-group">
                        <label class="live-gen-setting-row">
                            <div class="live-gen-label-container">
                                <span>Số bước (Steps)</span>
                                <span class="live-gen-slider-value" id="steps-val">${cfg.steps || 12}</span>
                            </div>
                            <input type="range" min="1" max="50" step="1" data-role="steps" value="${cfg.steps || 12}" oninput="document.getElementById('steps-val').innerText = this.value">
                        </label>

                        <label class="live-gen-setting-row">
                            <div class="live-gen-label-container">
                                <span>CFG Scale</span>
                                <span class="live-gen-slider-value" id="cfg-val">${cfg.cfg || 3}</span>
                            </div>
                            <input type="range" min="1" max="12" step="0.1" data-role="cfg" value="${cfg.cfg || 3}" oninput="document.getElementById('cfg-val').innerText = this.value">
                        </label>
                    </div>

                    <label class="live-gen-setting-row">
                        <span>Seed (0 = Ngẫu nhiên)</span>
                        <input type="number" inputmode="numeric" step="1" min="0" data-role="seed" value="${String(this.state.seed)}">
                    </label>

                    <label class="live-gen-setting-row">
                        <span>Chế độ Preview (Preview Mode)</span>
                        <select data-role="preview_mode">
                            <option value="live" ${cfg.preview_mode === "live" || !cfg.preview_mode ? "selected" : ""}>Live (Mọi step)</option>
                            <option value="every_5" ${cfg.preview_mode === "every_5" ? "selected" : ""}>Every 5 steps (5 step 1 lần)</option>
                            <option value="full" ${cfg.preview_mode === "full" ? "selected" : ""}>Full (Chỉ hiển thị kết quả cuối)</option>
                        </select>
                    </label>

                    <label class="live-gen-setting-row">
                        <div class="live-gen-label-container">
                            <span>Preview Blur (Khử noise)</span>
                            <span class="live-gen-slider-value" id="preview-blur-val">${(() => { const v = parseFloat(localStorage.getItem(STORAGE_BLUR)) || 0; return v === 0 ? 'OFF' : v.toFixed(1) + 'px'; })()}</span>
                        </div>
                        <input type="range" min="0" max="5" step="0.5" data-role="preview_blur" value="${parseFloat(localStorage.getItem(STORAGE_BLUR)) || 0}" oninput="const v = parseFloat(this.value); document.getElementById('preview-blur-val').innerText = v === 0 ? 'OFF' : v.toFixed(1) + 'px'; localStorage.setItem('${STORAGE_BLUR}', this.value);">
                    </label>
                </div>

                <!-- Tab 3: I2I -->
                <div class="live-gen-tab-content" data-tab-content="i2i">
                    <label class="live-gen-setting-row">
                        <div class="live-gen-label-container">
                            <span>Keep Denoise (Ghim để sửa)</span>
                            <span class="live-gen-slider-value" id="keep-denoise-val">${cfg.i2i_keep_denoise != null ? cfg.i2i_keep_denoise : 0.45}</span>
                        </div>
                        <input type="range" min="0.05" max="0.95" step="0.05" data-role="i2i_keep_denoise" value="${cfg.i2i_keep_denoise != null ? cfg.i2i_keep_denoise : 0.45}" oninput="document.getElementById('keep-denoise-val').innerText = this.value">
                    </label>

                    <label class="live-gen-setting-row">
                        <div class="live-gen-label-container">
                            <span>Refine Denoise (Tinh chỉnh)</span>
                            <span class="live-gen-slider-value" id="refine-denoise-val">${cfg.i2i_refine_denoise != null ? cfg.i2i_refine_denoise : 0.25}</span>
                        </div>
                        <input type="range" min="0.05" max="0.95" step="0.05" data-role="i2i_refine_denoise" value="${cfg.i2i_refine_denoise != null ? cfg.i2i_refine_denoise : 0.25}" oninput="document.getElementById('refine-denoise-val').innerText = this.value">
                    </label>
                </div>
            `;

            formEl.style.opacity = "1";
            formEl.style.pointerEvents = "auto";

            // Prevent mobile browsers from auto-focusing the first text input (opens keyboard unexpectedly)
            if (document.activeElement && formEl.contains(document.activeElement)) {
                document.activeElement.blur();
            }

            // --- Multi-LoRA Initialization & Rendering ---
            const loraContainer = formEl.querySelector('[data-role="lora-multi-container"]');

            const createLoraWrapperHTML = (index, value, smVal, scVal) => {
                const valEsc = escapeAttr(value || 'None');
                const sm = (typeof smVal === 'number' && !Number.isNaN(smVal)) ? smVal : (Number(loraDefaults.lora_strength_model) || 0.9);
                const sc = (typeof scVal === 'number' && !Number.isNaN(scVal)) ? scVal : (Number(loraDefaults.lora_strength_clip) || 1.0);
                return `
                    <div class="lora-multi-wrapper" data-role="lora-multi-wrapper" data-index="${index}" data-empty="${(!value || value === 'None') ? 'true' : 'false'}">
                        <div class="form-group lora-select-group" data-role="lora-select-group">
                            <label>LoRA #${index + 1} <button type="button" class="lora-remove-btn" data-remove style="display:inline-flex" title="Xóa LoRA">&times;</button></label>
                            <button type="button" class="lora-select-toggle" aria-haspopup="listbox" aria-expanded="false">
                                <div class="lora-select-toggle__thumb"></div>
                                <div class="lora-select-toggle__meta">
                                    <span class="lora-select-toggle__title">${(value && value !== 'None') ? escapeHtml(value) : 'Chọn một LoRA'}</span>
                                    <span class="lora-select-toggle__subtitle">${(value && value !== 'None') ? escapeHtml(value) : 'Hoặc tải mới bằng Lora-downloader'}</span>
                                </div>
                                <span class="material-symbols-outlined lora-select-toggle__icon">expand_more</span>
                            </button>
                            <div class="lora-card-panel" role="listbox" style="display:none">
                                <div class="lora-card-panel__controls">
                                    <input type="search" class="lora-card-panel__search-input" placeholder="Search LoRA">
                                    <button type="button" class="lora-card-panel__search-button" title="Clear search">x</button>
                                </div>
                                <div class="lora-card-grid"></div>
                            </div>
                            <input type="hidden" name="lora_name_${index}" value="${valEsc}">
                        </div>
                        <div class="lora-strength-row" style="display:flex; gap: 12px; margin-top: var(--spacing-2);">
                            <label class="live-gen-setting-row form-group-slider" style="flex: 1 1 0%; min-width: 0;">
                                <div class="live-gen-label-container">
                                    <span>Model Strength</span>
                                    <span class="live-gen-slider-value" id="val-lora_strength_model_${index}">${sm}</span>
                                </div>
                                <input type="range" data-lora-strength="model" id="cfg-lora_strength_model_${index}" name="lora_strength_model_${index}" value="${sm}" min="0" max="2.0" step="0.05" oninput="document.getElementById('val-lora_strength_model_${index}').textContent = this.value">
                            </label>
                            <label class="live-gen-setting-row form-group-slider" style="flex: 1 1 0%; min-width: 0;">
                                <div class="live-gen-label-container">
                                    <span>Clip Strength</span>
                                    <span class="live-gen-slider-value" id="val-lora_strength_clip_${index}">${sc}</span>
                                </div>
                                <input type="range" data-lora-strength="clip" id="cfg-lora_strength_clip_${index}" name="lora_strength_clip_${index}" value="${sc}" min="0" max="2.0" step="0.05" oninput="document.getElementById('val-lora_strength_clip_${index}').textContent = this.value">
                            </label>
                        </div>
                        <div class="lora-tags-wrapper" data-role="lora-tags-wrapper"></div>
                    </div>`;
            };

            const parseMultiLoraPreset = () => {
                let names = [];
                const chain = cfg.lora_chain;
                if (Array.isArray(chain) && chain.length) {
                    names = chain.map(e => String(e.lora_name || '').trim()).filter(Boolean);
                }
                if (!names.length) {
                    const namesRaw = cfg.lora_names || [];
                    names = Array.isArray(namesRaw) ? namesRaw.filter(v => typeof v === 'string' && v.trim()) : [];
                }
                const structured = Array.isArray(cfg.multi_lora_prompt_groups) ? cfg.multi_lora_prompt_groups : null;
                if (structured) {
                    return { names, perLoraGroups: structured };
                }
                const presetString = cfg.multi_lora_prompt_tags || '';
                const groupRegex = /\(([^)]*)\)/g;
                const perLoraGroups = [];
                let match;
                while ((match = groupRegex.exec(presetString)) !== null) {
                    const content = (match[1] || '').trim();
                    perLoraGroups.push(content ? content.split(',').map(s => s.trim()).filter(Boolean) : []);
                }
                return { names, perLoraGroups };
            };

            const applyPresetToWrapper = (wrapper, loraName, groupList) => {
                if (!wrapper) return;
                const hidden = wrapper.querySelector('input[type="hidden"][name^="lora_name_"]');
                if (hidden) hidden.value = loraName || 'None';
                const titleEl = wrapper.querySelector('.lora-select-toggle__title');
                const subtitleEl = wrapper.querySelector('.lora-select-toggle__subtitle');
                if (titleEl) titleEl.textContent = (loraName && loraName !== 'None') ? loraName : 'Chọn một LoRA';
                if (subtitleEl) subtitleEl.textContent = (loraName && loraName !== 'None') ? loraName : 'Hoặc tải mới bằng Lora-downloader';
                wrapper.dataset.presetGroups = JSON.stringify(groupList || []);
            };

            const mountInitialWrappers = () => {
                if (!loraContainer) return [];
                const { names, perLoraGroups } = parseMultiLoraPreset();
                const finalNames = names.length ? names : ['None'];
                loraContainer.innerHTML = '';
                const getInitStrengths = (idx, name) => {
                    let sm = Number(loraDefaults.lora_strength_model) || 0.9;
                    let sc = Number(loraDefaults.lora_strength_clip) || 1.0;
                    const chain = cfg.lora_chain;
                    if (Array.isArray(chain) && chain.length) {
                        const byIdx = chain[idx];
                        if (byIdx && (!name || byIdx.lora_name === name)) {
                            sm = byIdx.strength_model ?? sm;
                            sc = byIdx.strength_clip ?? sc;
                        } else if (name) {
                            const found = chain.find(e => e && e.lora_name === name);
                            if (found) {
                                sm = found.strength_model ?? sm;
                                sc = found.strength_clip ?? sc;
                            }
                        }
                    }
                    return { sm, sc };
                };
                finalNames.forEach((n, idx) => {
                    const { sm, sc } = getInitStrengths(idx, n);
                    const html = createLoraWrapperHTML(idx, n || 'None', sm, sc);
                    const temp = document.createElement('div');
                    temp.innerHTML = html.trim();
                    const wrapper = temp.firstElementChild;
                    loraContainer.appendChild(wrapper);
                    applyPresetToWrapper(wrapper, n, perLoraGroups[idx] || []);
                });
                return Array.from(loraContainer.querySelectorAll('.lora-multi-wrapper'));
            };

            const reindexLoraWrappers = () => {
                const wrappers = Array.from(formEl.querySelectorAll('.lora-multi-wrapper'));
                wrappers.forEach((wrapper, idx) => {
                    wrapper.dataset.index = String(idx);
                    const hidden = wrapper.querySelector('input[type="hidden"][name^="lora_name_"]');
                    if (hidden) hidden.name = `lora_name_${idx}`;
                    const label = wrapper.querySelector('.lora-select-group > label');
                    if (label) {
                        const removeBtn = label.querySelector('[data-remove]');
                        label.childNodes.forEach(node => { if (node.nodeType === 3) node.textContent = `LoRA #${idx + 1} `; });
                        if (removeBtn) removeBtn.style.display = '';
                    }
                    const modelInput = wrapper.querySelector('input[data-lora-strength="model"]');
                    const clipInput = wrapper.querySelector('input[data-lora-strength="clip"]');
                    if (modelInput) {
                        const labelEl = modelInput.closest('.form-group-slider');
                        const spanEl = labelEl ? labelEl.querySelector('span[id^="val-lora_strength_model_"]') : null;
                        modelInput.name = `lora_strength_model_${idx}`;
                        modelInput.id = `cfg-lora_strength_model_${idx}`;
                        modelInput.setAttribute('oninput', `document.getElementById('val-lora_strength_model_${idx}').textContent = this.value`);
                        if (labelEl) labelEl.setAttribute('for', `cfg-lora_strength_model_${idx}`);
                        if (spanEl) spanEl.id = `val-lora_strength_model_${idx}`;
                    }
                    if (clipInput) {
                        const labelEl = clipInput.closest('.form-group-slider');
                        const spanEl = labelEl ? labelEl.querySelector('span[id^="val-lora_strength_clip_"]') : null;
                        clipInput.name = `lora_strength_clip_${idx}`;
                        clipInput.id = `cfg-lora_strength_clip_${idx}`;
                        clipInput.setAttribute('oninput', `document.getElementById('val-lora_strength_clip_${idx}').textContent = this.value`);
                        if (labelEl) labelEl.setAttribute('for', `cfg-lora_strength_clip_${idx}`);
                        if (spanEl) spanEl.id = `val-lora_strength_clip_${idx}`;
                    }
                });
            };

            const wrapperTagStates = new Map();
            const renderWrapperTags = (tagsWrapper, loraName) => {
                if (!tagsWrapper) return;
                tagsWrapper.innerHTML = '';
                tagsWrapper.style.display = 'none';
                if (!loraName || loraName.toLowerCase() === 'none') return;
                const meta = loraMetadataMap[loraName] || findLoraMetadata(loraName);
                const trainedWords = meta ? extractTrainedWords(meta) : [];
                if (!trainedWords.length) return;
                const parentWrapper = tagsWrapper.closest('.lora-multi-wrapper');
                const stateKey = `${loraName}#${parentWrapper?.dataset.index || ''}`;
                let state = wrapperTagStates.get(stateKey);
                let presetGroups = [];
                if (parentWrapper && parentWrapper.dataset.presetGroups) {
                    try { presetGroups = JSON.parse(parentWrapper.dataset.presetGroups) || []; } catch (_) { }
                }
                const normalizedPreset = presetGroups.map(g => g.trim().toLowerCase());
                if (!state || state.length !== trainedWords.length) {
                    state = trainedWords.map((group, idx) => {
                        const groupText = formatGroupText(group).trim().toLowerCase();
                        if (normalizedPreset.length) return normalizedPreset.includes(groupText);
                        return false;
                    });
                    wrapperTagStates.set(stateKey, state);
                }
                tagsWrapper.style.display = 'flex';
                trainedWords.forEach((group, idx) => {
                    const card = document.createElement('div');
                    card.className = 'lora-tag-card';
                    const header = document.createElement('div');
                    header.className = 'lora-tag-card__header';
                    const title = document.createElement('span');
                    title.textContent = `LoRA tags ${idx + 1}`;
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'lora-tag-toggle';
                    toggle.classList.toggle('is-active', !!state[idx]);
                    toggle.setAttribute('aria-pressed', state[idx] ? 'true' : 'false');
                    toggle.addEventListener('click', () => {
                        state[idx] = !state[idx];
                        toggle.classList.toggle('is-active', state[idx]);
                        toggle.setAttribute('aria-pressed', state[idx] ? 'true' : 'false');
                        wrapperTagStates.set(stateKey, [...state]);
                        triggerAutoSave();
                    });
                    header.append(title, toggle);
                    const body = document.createElement('div');
                    body.className = 'lora-tag-card__body';
                    body.textContent = formatGroupText(group);
                    card.append(header, body);
                    tagsWrapper.appendChild(card);
                });
            };

            const initSingleLoraWrapper = (wrapper) => {
                const selectGroup = wrapper.querySelector('.lora-select-group');
                const toggle = selectGroup?.querySelector('.lora-select-toggle');
                const cardPanel = selectGroup?.querySelector('.lora-card-panel');
                const searchInput = cardPanel?.querySelector('.lora-card-panel__search-input');
                const clearBtn = cardPanel?.querySelector('.lora-card-panel__search-button');
                const cardGrid = cardPanel?.querySelector('.lora-card-grid');
                const titleEl = toggle?.querySelector('.lora-select-toggle__title');
                const subtitleEl = toggle?.querySelector('.lora-select-toggle__subtitle');
                const iconEl = toggle?.querySelector('.lora-select-toggle__icon');
                const thumbEl = toggle?.querySelector('.lora-select-toggle__thumb');
                const hiddenInput = selectGroup?.querySelector('input[type="hidden"][name^="lora_name_"]');
                const tagsWrapper = wrapper.querySelector('[data-role="lora-tags-wrapper"]');
                const removeBtn = selectGroup?.querySelector('[data-remove]');
                let panelOpen = false;
                const setPanel = (open) => {
                    panelOpen = open;
                    selectGroup.classList.toggle('is-open', open);
                    if (cardPanel) cardPanel.style.display = open ? '' : 'none';
                    if (iconEl) iconEl.textContent = open ? 'expand_less' : 'expand_more';
                };
                const selectLoRA = (value, displayName) => {
                    if (!hiddenInput) return;
                    const normalized = value || 'None';
                    const oldVal = hiddenInput.value;
                    hiddenInput.value = normalized;
                    const isNone = normalized === 'None';
                    if (titleEl) titleEl.textContent = isNone ? 'Chọn một LoRA' : (displayName || normalized);
                    if (subtitleEl) subtitleEl.textContent = isNone ? 'Hoặc tải mới bằng Lora-downloader' : (normalized);
                    wrapper.setAttribute('data-empty', isNone ? 'true' : 'false');
                    const meta = !isNone ? (loraMetadataMap[normalized] || findLoraMetadata(normalized)) : null;
                    const thumbUrl = meta ? getLoraThumbnailUrl(meta) : null;
                    if (thumbEl) {
                        thumbEl.innerHTML = (!isNone && thumbUrl)
                            ? `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(displayName || normalized)}" loading="lazy">`
                            : '';
                        if (thumbEl._previewHandler) {
                            thumbEl.removeEventListener('click', thumbEl._previewHandler);
                            delete thumbEl._previewHandler;
                        }
                        if (!isNone && meta && thumbUrl) {
                            const handler = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openSimpleViewer(meta, thumbUrl);
                            };
                            thumbEl._previewHandler = handler;
                            thumbEl.addEventListener('click', handler);
                            thumbEl.title = 'Xem ảnh preview';
                            thumbEl.style.cursor = 'zoom-in';
                        } else {
                            thumbEl.removeAttribute('title');
                            thumbEl.style.cursor = '';
                        }
                    }
                    renderWrapperTags(tagsWrapper, normalized);
                    setPanel(false);
                    if (normalized !== oldVal) {
                        triggerAutoSave();
                    }
                };
                const ctx = { select: selectLoRA };
                if (cardGrid && !cardGrid.dataset.built) {
                    buildLoraCards(cardGrid, ctx);
                    cardGrid.dataset.built = 'true';
                    ensureLoraMetadata().then(() => {
                        buildLoraCards(cardGrid, ctx);
                        const currentVal = hiddenInput?.value;
                        if (currentVal && currentVal !== 'None') {
                            if (!panelOpen) {
                                selectLoRA(currentVal, titleEl?.textContent || currentVal);
                            } else {
                                renderWrapperTags(tagsWrapper, currentVal);
                            }
                        }
                    });
                }
                if (hiddenInput && typeof hiddenInput.value === 'string') {
                    const initialVal = hiddenInput.value.trim();
                    selectLoRA(initialVal, initialVal);
                }
                toggle?.addEventListener('click', () => setPanel(!panelOpen));
                searchInput?.addEventListener('input', () => {
                    const term = (searchInput.value || '').toLowerCase();
                    cardGrid?.querySelectorAll('.lora-card').forEach(card => {
                        const value = card.dataset.value.toLowerCase();
                        const text = card.querySelector('.lora-card__title')?.textContent.toLowerCase() || '';
                        card.style.display = (!term || value.includes(term) || text.includes(term)) ? '' : 'none';
                    });
                });
                clearBtn?.addEventListener('click', () => { if (searchInput) { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); } });
                removeBtn?.addEventListener('click', () => {
                    wrapper.remove();
                    reindexLoraWrappers();
                    triggerAutoSave();
                });
            };

            const mountedWrappers = mountInitialWrappers();
            const multiAddContainer = formEl.querySelector('[data-role="lora-multi-add"]');
            const createNewLoraWrapper = (index) => {
                const defSm = Number(loraDefaults.lora_strength_model) || 0.9;
                const defSc = Number(loraDefaults.lora_strength_clip) || 1.0;
                const html = createLoraWrapperHTML(index, 'None', defSm, defSc);
                const temp = document.createElement('div');
                temp.innerHTML = html.trim();
                return temp.firstElementChild;
            };
            const getLoraWrappers = () => Array.from(formEl.querySelectorAll('.lora-multi-wrapper'));
            const nextIndex = () => getLoraWrappers().length;
            if (multiAddContainer) {
                const addBtn = multiAddContainer.querySelector('.lora-multi-add__btn');
                addBtn?.addEventListener('click', () => {
                    const index = nextIndex();
                    const wrapper = createNewLoraWrapper(index);
                    multiAddContainer.before(wrapper);
                    initSingleLoraWrapper(wrapper);
                    reindexLoraWrappers();
                    attachAutoSaveListeners();
                    triggerAutoSave();
                });
            }

            // Initialize existing wrapper(s)
            mountedWrappers.forEach(w => {
                initSingleLoraWrapper(w);
                const hidden = w.querySelector('input[type="hidden"][name^="lora_name_"]');
                const loraName = hidden ? hidden.value : 'None';
                if (loraName && loraName !== 'None') {
                    renderWrapperTags(w.querySelector('[data-role="lora-tags-wrapper"]'), loraName);
                }
            });
            reindexLoraWrappers();

            const hasPreSelected = mountedWrappers.some(w => {
                const h = w.querySelector('input[type="hidden"][name^="lora_name_"]');
                return h && h.value && h.value !== 'None';
            });
            if (hasPreSelected) {
                ensureLoraMetadata().then(() => {
                    mountedWrappers.forEach(w => {
                        const h = w.querySelector('input[type="hidden"][name^="lora_name_"]');
                        const val = h ? h.value : 'None';
                        if (val && val !== 'None') {
                            const selectGroup = w.querySelector('.lora-select-group');
                            const toggle = selectGroup?.querySelector('.lora-select-toggle');
                            const titleEl = toggle?.querySelector('.lora-select-toggle__title');
                            const displayName = titleEl?.textContent || val;
                            const thumbEl = toggle?.querySelector('.lora-select-toggle__thumb');
                            const tagsWrapper = w.querySelector('[data-role="lora-tags-wrapper"]');
                            const meta = loraMetadataMap[val] || findLoraMetadata(val);
                            const thumbUrl = meta ? getLoraThumbnailUrl(meta) : null;
                            if (thumbEl) {
                                thumbEl.innerHTML = thumbUrl ? `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(displayName)}" loading="lazy">` : '';
                                if (thumbUrl && meta) {
                                    thumbEl.title = 'Xem ảnh preview';
                                    thumbEl.style.cursor = 'zoom-in';
                                    if (!thumbEl._previewHandler) {
                                        const handler = (e) => { e.preventDefault(); e.stopPropagation(); openSimpleViewer(meta, thumbUrl); };
                                        thumbEl._previewHandler = handler;
                                        thumbEl.addEventListener('click', handler);
                                    }
                                }
                            }
                            renderWrapperTags(tagsWrapper, val);
                        }
                    });
                });
            }

            // --- Auto-Save Mechanism ---
            let saveTimeout = null;
            const triggerAutoSave = () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => executeAutoSave(), 200);
            };

            const executeAutoSave = async () => {
                if (this.destroyed) return;
                const getVal = (selector) => formEl.querySelector(selector)?.value;
                const getNum = (selector) => {
                    const val = getVal(selector);
                    return val != null ? Number(val) : null;
                };

                const seed = Math.max(0, Math.floor(getNum('[data-role="seed"]') || 0));
                this.state.seed = seed;

                const sizeVal = getVal('[data-role="size"]');
                const [width, height] = sizeVal.split("x").map(Number);

                // Collect multi-LoRA values
                let loraWrappers = Array.from(formEl.querySelectorAll('.lora-multi-wrapper'));
                const activeLoraEntries = [];
                loraWrappers.forEach(wrapper => {
                    const hidden = wrapper.querySelector('input[type="hidden"][name^="lora_name_"]');
                    const loraName = (hidden?.value || 'None').trim();
                    if (!loraName || loraName.toLowerCase() === 'none') return;
                    
                    const smInput = wrapper.querySelector('input[data-lora-strength="model"]');
                    const scInput = wrapper.querySelector('input[data-lora-strength="clip"]');
                    let smVal = parseFloat(smInput ? smInput.value : '');
                    let scVal = parseFloat(scInput ? scInput.value : '');
                    if (Number.isNaN(smVal)) smVal = 0.9;
                    if (Number.isNaN(scVal)) scVal = 1.0;

                    const loraTagCards = wrapper.querySelectorAll('.lora-tag-card');
                    const groups = [];
                    loraTagCards.forEach(card => {
                        const toggle = card.querySelector('.lora-tag-toggle');
                        const body = card.querySelector('.lora-tag-card__body');
                        if (toggle && toggle.classList.contains('is-active')) {
                            const raw = body?.textContent?.trim() || '';
                            if (raw) groups.push(raw);
                        }
                    });
                    const formatted = groups.length ? `(${groups.join(', ')})` : '';
                    activeLoraEntries.push({ name: loraName, groupText: formatted, groups, sm: smVal, sc: scVal });
                });

                const loraNames = activeLoraEntries.map(e => e.name);
                const loraChain = activeLoraEntries.map(e => ({ lora_name: e.name, strength_model: e.sm, strength_clip: e.sc }));
                const multiTagsParts = activeLoraEntries.filter(e => e.groupText).map(e => e.groupText);
                const multiLoraPromptTags = multiTagsParts.join(', ');
                const multiLoraPromptGroups = activeLoraEntries.map(e => e.groups);

                // Build new config payload
                const newConfig = {
                    ckpt_name: getVal('[data-role="ckpt_name"]'),
                    width: width,
                    height: height,
                    sampler_name: getVal('[data-role="sampler_name"]'),
                    scheduler: getVal('[data-role="scheduler"]'),
                    steps: getNum('[data-role="steps"]'),
                    cfg: getNum('[data-role="cfg"]'),
                    seed: seed,
                    preview_mode: getVal('[data-role="preview_mode"]'),
                    quality: getVal('[data-role="quality"]'),
                    negative: getVal('[data-role="negative"]'),
                    i2i_keep_denoise: getNum('[data-role="i2i_keep_denoise"]'),
                    i2i_refine_denoise: getNum('[data-role="i2i_refine_denoise"]'),
                    // Multi-LoRA support
                    lora_name: loraNames[0] || 'None',
                    lora_strength_model: activeLoraEntries[0]?.sm ?? 0.9,
                    lora_strength_clip: activeLoraEntries[0]?.sc ?? 1.0,
                    lora_names: loraNames,
                    lora_chain: loraChain,
                    multi_lora_prompt_tags: multiLoraPromptTags,
                    multi_lora_prompt_groups: multiLoraPromptGroups
                };

                // Filter out any undefined or NaN properties
                Object.keys(newConfig).forEach(k => {
                    if (newConfig[k] === undefined || (typeof newConfig[k] === 'number' && Number.isNaN(newConfig[k]))) {
                        delete newConfig[k];
                    }
                });

                try {
                    const saved = await this.pluginApi.post("/config", newConfig);
                    this._applyConfig(saved.config);
                    this._send({ type: "update_config", config: saved.config });
                    this.lastGeneratedPrompt = "";
                    this._scheduleGeneration(15);
                } catch (err) {
                    console.error("Auto-save failed:", err);
                }
            };

            const attachAutoSaveListeners = () => {
                // Selects: change event
                formEl.querySelectorAll('select').forEach(sel => {
                    sel.removeEventListener('change', triggerAutoSave);
                    sel.addEventListener('change', triggerAutoSave);
                });
                // Text, numbers, textarea inputs: blur event
                formEl.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(inp => {
                    inp.removeEventListener('blur', triggerAutoSave);
                    inp.addEventListener('blur', triggerAutoSave);
                });
                // Sliders: blur and change
                formEl.querySelectorAll('input[type="range"]').forEach(sld => {
                    sld.removeEventListener('blur', triggerAutoSave);
                    sld.addEventListener('blur', triggerAutoSave);
                    sld.removeEventListener('change', triggerAutoSave);
                    sld.addEventListener('change', triggerAutoSave);
                });
            };

            // Call initial listener attach
            attachAutoSaveListeners();
        }

        async _openTimeline() {
            // Tự động đóng settings panel nếu đang mở
            const existingSettings = document.querySelector(".live-gen-settings-panel");
            if (existingSettings) {
                existingSettings.remove();
                document.body.classList.remove("live-gen-settings-open");
                document.body.classList.add("live-gen-timeline-open");
            }

            // Nếu panel timeline đã có, thì đóng nó lại (toggle)
            const existingPanel = document.querySelector(".live-gen-timeline-panel");
            if (existingPanel) {
                this._closeTimeline(existingPanel);
                return;
            }

            const panel = document.createElement("div");
            panel.className = "live-gen-timeline-panel";
            panel.innerHTML = `
                <header class="live-gen-settings-panel__header">
                    <h2>Lịch sử & Yêu thích</h2>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button type="button" class="live-gen-icon-btn" data-action="edit" title="Chỉnh sửa">
                            <span class="material-symbols-outlined">edit</span>
                        </button>
                        <button type="button" class="live-gen-icon-btn" data-action="close" title="Đóng">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                </header>
                
                <div class="live-gen-settings-tabs">
                    <button type="button" class="live-gen-tab-btn active" data-tab="history">History</button>
                    <button type="button" class="live-gen-tab-btn" data-tab="favorite">Favorite</button>
                </div>

                <div class="live-gen-timeline-content active" data-tab-content="history">
                    <div style="text-align: center; padding: 20px; color: var(--color-secondary-text);">Đang tải lịch sử...</div>
                </div>
                
                <div class="live-gen-timeline-content" data-tab-content="favorite">
                    <div style="text-align: center; padding: 20px; color: var(--color-secondary-text);">Đang tải yêu thích...</div>
                </div>
            `;

            document.body.appendChild(panel);

            setTimeout(() => {
                panel.classList.add("open");
                document.body.classList.add("live-gen-timeline-open");
            }, 10);

            panel.addEventListener("mousedown", (e) => e.stopPropagation());
            panel.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });

            const editBtn = panel.querySelector('[data-action="edit"]');
            const closeBtn = panel.querySelector('[data-action="close"]');
            const headerTitle = panel.querySelector('.live-gen-settings-panel__header h2');

            const exitDeleteMode = () => {
                panel.classList.remove("delete-mode");
                
                if (headerTitle) {
                    headerTitle.textContent = "Lịch sử & Yêu thích";
                }
                
                if (editBtn) {
                    const editIcon = editBtn.querySelector(".material-symbols-outlined");
                    if (editIcon) editIcon.textContent = "edit";
                    editBtn.title = "Chỉnh sửa";
                }
                
                if (closeBtn) {
                    closeBtn.title = "Đóng";
                }
                
                panel.querySelectorAll(".timeline-item").forEach(el => {
                    el.classList.remove("delete-selected");
                });
            };

            const enterDeleteMode = () => {
                panel.classList.add("delete-mode");
                
                if (headerTitle) {
                    headerTitle.textContent = "Chọn để xoá";
                }
                
                if (editBtn) {
                    const editIcon = editBtn.querySelector(".material-symbols-outlined");
                    if (editIcon) editIcon.textContent = "delete";
                    editBtn.title = "Xóa các ảnh đã chọn";
                }
                
                if (closeBtn) {
                    closeBtn.title = "Thoát chế độ xóa";
                }
            };

            editBtn?.addEventListener("click", async () => {
                if (panel.classList.contains("delete-mode")) {
                    const selectedItems = panel.querySelectorAll(".timeline-item.delete-selected");
                    if (selectedItems.length === 0) {
                        window.showError?.("Vui lòng chọn ít nhất một ảnh để xóa.");
                        return;
                    }
                    
                    const confirmDelete = typeof window.Yuuka?.ui?.confirm === 'function'
                        ? await window.Yuuka.ui.confirm(`Bạn có chắc chắn muốn xóa ${selectedItems.length} ảnh đã chọn không?`)
                        : window.confirm(`Bạn có chắc chắn muốn xóa ${selectedItems.length} ảnh đã chọn không?`);
                    
                    if (!confirmDelete) return;
                    
                    try {
                        for (const el of selectedItems) {
                            const imgId = el.dataset.imageId;
                            if (imgId) {
                                await this.api.images.delete(imgId);
                            }
                        }
                        
                        window.showSuccess?.(`Đã xóa thành công ${selectedItems.length} ảnh!`);
                        
                        await Promise.all([
                            this._loadTimelineTab(panel, "history"),
                            this._loadTimelineTab(panel, "favorite")
                        ]);
                        
                        exitDeleteMode();
                    } catch (err) {
                        window.showError?.(`Lỗi khi xóa ảnh: ${err.message}`);
                    }
                } else {
                    enterDeleteMode();
                }
            });

            closeBtn?.addEventListener("click", () => {
                if (panel.classList.contains("delete-mode")) {
                    exitDeleteMode();
                } else {
                    this._closeTimeline(panel);
                }
            });

            // Quản lý Tabs
            const tabBtns = panel.querySelectorAll(".live-gen-tab-btn");
            tabBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    tabBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    
                    const tabId = btn.dataset.tab;
                    panel.querySelectorAll(".live-gen-timeline-content").forEach(c => {
                        c.classList.toggle("active", c.dataset.tabContent === tabId);
                    });
                });
            });

            // Tải và hiển thị dữ liệu ban đầu
            await Promise.all([
                this._loadTimelineTab(panel, "history"),
                this._loadTimelineTab(panel, "favorite")
            ]);
        }

        _closeTimeline(panel) {
            panel.classList.remove("open");
            document.body.classList.remove("live-gen-timeline-open");
            setTimeout(() => {
                panel.remove();
            }, 300);
            
            const navibar = window.Yuuka?.services?.navibar;
            if (navibar && !navibar._isSearchActive && !this.destroyed) {
                setTimeout(() => this._openPromptMode(), 0);
            }
        }

        async _loadTimelineTab(panel, tabType) {
            const contentEl = panel.querySelector(`[data-tab-content="${tabType}"]`);
            if (!contentEl) return;

            try {
                const endpoint = tabType === "history" ? "/history" : "/favorites";
                const resp = await this.pluginApi.get(endpoint);
                let images = resp.images || [];

                // Deduplicate history snapshots on the timeline list, preferring the Hires version
                if (tabType === "history") {
                    const uniqueImages = [];
                    const seenSnapshots = new Set();
                    images.forEach(img => {
                        const snapId = img.generationConfig?.snapshot_id;
                        if (snapId) {
                            if (!seenSnapshots.has(snapId)) {
                                seenSnapshots.add(snapId);
                                const sameSnap = images.filter(i => i.generationConfig?.snapshot_id === snapId);
                                const hasHires = sameSnap.some(i => {
                                    const h = i.generationConfig?.hires_enabled;
                                    return h === true || h === 'true' || h === '1' || h === 'yes';
                                });
                                const best = sameSnap.find(i => {
                                    const h = i.generationConfig?.hires_enabled;
                                    return h === true || h === 'true' || h === '1' || h === 'yes';
                                }) || sameSnap[0];
                                
                                // Tag the item if a Hires version exists
                                best.hasHires = hasHires;
                                uniqueImages.push(best);
                            }
                        } else {
                            uniqueImages.push(img);
                        }
                    });
                    images = uniqueImages;
                }

                if (images.length === 0) {
                    contentEl.innerHTML = `
                        <div class="timeline-empty-message">
                            <span class="material-symbols-outlined">${tabType === "history" ? "history" : "favorite"}</span>
                            <p>Không tìm thấy ảnh nào.</p>
                        </div>
                    `;
                    return;
                }

                // Gom nhóm ảnh theo ngày
                const groups = {};
                const getDayTitle = (timestampSec) => {
                    const date = new Date(timestampSec * 1000);
                    const today = new Date();
                    const yesterday = new Date();
                    yesterday.setDate(today.getDate() - 1);
                    
                    if (date.toDateString() === today.toDateString()) {
                        return "Hôm nay";
                    } else if (date.toDateString() === yesterday.toDateString()) {
                        return "Hôm qua";
                    } else {
                        return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
                    }
                };

                images.forEach(img => {
                    const title = getDayTitle(img.createdAt);
                    if (!groups[title]) groups[title] = [];
                    groups[title].push(img);
                });

                contentEl.innerHTML = "";
                
                for (const [dayTitle, items] of Object.entries(groups)) {
                    const dayGroup = document.createElement("div");
                    dayGroup.className = "timeline-day-group";

                    const header = document.createElement("div");
                    header.className = "timeline-day-header";
                    header.textContent = dayTitle;
                    dayGroup.appendChild(header);

                    const grid = document.createElement("div");
                    grid.className = "timeline-grid";

                    items.forEach(item => {
                        const div = document.createElement("div");
                        div.className = "timeline-item";
                        
                        // Đánh dấu ảnh đang chọn
                        const snapId = item.generationConfig?.snapshot_id;
                        if (snapId) {
                            div.dataset.snapshotId = snapId;
                        }
                        const isSelected = snapId && this.state.config?.snapshot_id === snapId;
                        if (isSelected) {
                            div.classList.add("selected");
                        }

                        // Lưu image ID để phục vụ xóa hàng loạt
                        div.dataset.imageId = item.id;

                        const h = item.generationConfig?.hires_enabled;
                        const isHires = h === true || h === 'true' || h === '1' || h === 'yes' || item.hasHires;

                        if (isHires) {
                            div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy"><span class="timeline-item__badge material-symbols-outlined" title="High Resolution">high_quality</span>`;
                        } else {
                            div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy">`;
                        }

                        div.addEventListener("click", () => {
                            if (panel.classList.contains("delete-mode")) {
                                div.classList.toggle("delete-selected");
                            } else {
                                this._applySnapshot(item, panel);
                            }
                        });
                        grid.appendChild(div);
                    });

                    dayGroup.appendChild(grid);
                    contentEl.appendChild(dayGroup);

                    // Bấm vào date title để chọn / bỏ chọn toàn bộ trong ngày
                    header.addEventListener("click", () => {
                        if (!panel.classList.contains("delete-mode")) return;
                        const gridItems = grid.querySelectorAll(".timeline-item");
                        const allSelected = Array.from(gridItems).every(el => el.classList.contains("delete-selected"));
                        gridItems.forEach(el => {
                            el.classList.toggle("delete-selected", !allSelected);
                        });
                    });
                }
            } catch (err) {
                contentEl.innerHTML = `<div style="padding: 20px; color: var(--color-error); text-align: center;">Lỗi tải dữ liệu: ${err.message}</div>`;
            }
        }

        async _applySnapshot(item, panel) {
            if (!item || !item.generationConfig) return;
            const cfg = { ...item.generationConfig };

            // Ensure hires_enabled is explicitly boolean true/false so it toggles correctly
            const isHires = cfg.hires_enabled === true || cfg.hires_enabled === 'true' || cfg.hires_enabled === 1 || cfg.hires_enabled === '1' || cfg.hires_enabled === 'yes';
            cfg.hires_enabled = isHires;

            // Clear or normalize LoRA keys to prevent inheriting old state when loading a non-LoRA snapshot
            if (!cfg.lora_name || cfg.lora_name === 'None') {
                cfg.lora_name = 'None';
                cfg.lora_names = [];
                cfg.lora_chain = [];
                cfg.multi_lora_prompt_tags = '';
                cfg.multi_lora_prompt_groups = [];
            } else {
                if (!cfg.lora_chain) {
                    cfg.lora_chain = [{
                        lora_name: cfg.lora_name,
                        strength_model: cfg.lora_strength_model ?? 0.9,
                        strength_clip: cfg.lora_strength_clip ?? 1.0
                    }];
                }
                if (!cfg.lora_names) {
                    cfg.lora_names = [cfg.lora_name];
                }
            }

            // 1. Áp dụng Prompt & Settings vào state
            this.state.prompt = cfg.prompt || "";
            localStorage.setItem(STORAGE_PROMPT, this.state.prompt);
            
            this.state.seed = Number(cfg.seed) || 0;
            this._applyConfig(cfg);
            
            // Cập nhật giá trị vào Prompt Textarea
            const textarea = document.querySelector(".live-gen-prompt-input");
            if (textarea) {
                textarea.value = this.state.prompt;
                this._autoGrow(textarea);
            }

            // 2. Hiển thị ảnh lập tức ra màn hình xem
            this._showImage(item.url, false);
            this.lastFinalImageBase64 = null; // Tạm thời xóa để tải base64 mới

            // Khóa cờ chọn trong giao diện cho toàn bộ panel (cả tab history và favorite)
            panel.querySelectorAll(".timeline-item").forEach(el => el.classList.remove("selected"));
            
            const snapId = item.generationConfig?.snapshot_id;
            const targetUrl = item.pv_url || item.url;
            
            const matchingItems = Array.from(panel.querySelectorAll(".timeline-item")).filter(el => {
                const elSnapId = el.dataset.snapshotId;
                if (snapId && elSnapId) {
                    return elSnapId === snapId;
                }
                const imgEl = el.querySelector("img");
                if (!imgEl) return false;
                try {
                    const path1 = new URL(imgEl.src, window.location.href).pathname;
                    const path2 = new URL(targetUrl, window.location.href).pathname;
                    return path1 === path2;
                } catch (e) {
                    return imgEl.src.includes(targetUrl);
                }
            });
            
            matchingItems.forEach(el => el.classList.add("selected"));

            // 3. Tải mượt mà ảnh gốc thành Base64 dưới nền để sẵn sàng cho Img2Img Keep/Refine
            try {
                const response = await fetch(item.url);
                const blob = await response.blob();
                this.lastFinalImageBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.warn("⚠️ Không thể chuyển đổi ảnh sang Base64 cho Img2Img: ", err);
            }

            // 4. Tự động đóng timeline panel trên mobile (màn hình ≤ 640px)
            if (window.innerWidth <= 640) {
                this._closeTimeline(panel);
            }
        }
    }

    window.Yuuka.components.LiveGenComponent = LiveGenComponent;
})();
