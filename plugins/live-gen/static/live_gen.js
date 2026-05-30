(function () {
    const PLUGIN_ID = "live-gen";

    // Sub-modules references
    const liveGen = window.Yuuka.liveGen;

    class LiveGenComponent {
        constructor(container, api) {
            this.container = container;
            this.api = api;
            this.destroyed = false;
            
            // Core APIs
            this.apiClient = new liveGen.Api(api[PLUGIN_ID], api);
            this.state = new liveGen.State();
            this.wsClient = new liveGen.WebSocket(this);

            // UI Modules
            this.promptUI = new liveGen.PromptUI(this);
            this.settingsUI = new liveGen.SettingsUI(this);
            this.timelineUI = new liveGen.TimelineUI(this);
            this.previewUI = new liveGen.PreviewUI(this);

            // Helpers
            this.helpers = liveGen.helpers;

            // Debouncing / sequencing logic
            this.debounceTimer = null;
            this.seq = 0;
            this.tags = [];
            this.characters = [];
            this.lastGeneratedPrompt = "";
            this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
        }

        async init() {
            document.body.classList.add("live-gen-active");
            this.render();
            this.previewUI.initDOMElements();
            await this.previewUI.loadHistory();
            this._updateNav();
            await this._loadConfig();
            this._loadTags();
            this.wsClient.connect();
            window.addEventListener("beforeunload", this.handleBeforeUnload);
            
            // Luôn mở prompt field ngay khi truy cập plugin
            this.promptUI.openPromptMode();
            if (this.state.prompt.trim()) {
                this._scheduleGeneration(120, false);
            }
        }

        destroy() {
            this.destroyed = true;
            document.body.classList.remove("live-gen-active");
            document.body.classList.remove("live-gen-prompt-focused");
            window.removeEventListener("beforeunload", this.handleBeforeUnload);
            clearTimeout(this.debounceTimer);
            const navibar = window.Yuuka?.services?.navibar;
            if (navibar) {
                navibar.showSearchBar(null);
                navibar.setActivePlugin(null);
            }
            this.wsClient.close();
            this.promptUI.removeMobileNavButtons();

            // Close settings panel if open when exiting
            const panel = document.querySelector(".live-gen-settings-panel");
            if (panel) {
                panel.classList.remove("open");
                document.body.classList.remove("live-gen-settings-open");
                panel.remove();
            }
        }

        handleBeforeUnload() {
            this.wsClient.send({ type: "cancel" });
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
        }

        async _loadConfig() {
            try {
                const config = await this.apiClient.getConfig();
                this._applyConfig(config);
            } catch (err) {
                this._setStatus("Không tải được cấu hình.", "error");
                window.showError?.(`Live Gen: ${err.message}`);
            }
        }

        async _loadTags() {
            try {
                const [tags, charsData] = await Promise.all([
                    this.apiClient.getTags(),
                    this.apiClient.getAllCharacters()
                ]);
                this.tags = tags;
                this.characters = charsData?.characters || [];
                
                const promptInput = document.querySelector(".live-gen-prompt-input");
                if (promptInput) this.promptUI.attachAutocomplete(promptInput);
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
            if (this.previewUI.hiresBtn) {
                this.previewUI.hiresBtn.classList.toggle("active", !!this.state.config.hires_enabled);
            }
            this._syncMobileNavButtonStates();
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
                    this.state.generationStartTime = Date.now();
                    this.state.currentStep = 0;
                    this._setProgress(0);
                    this._setStatus("Đang gửi prompt...", "running");
                    this.receivedPreviewThisRun = false;
                    this.previewUI.onGenerationStarting();
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
                    this.state.currentStep = Number(message.value) || 0;
                    this._setProgress(Number(message.percent) || 0);
                    this._setStatus(message.message || "Đang tạo...", "running");
                    break;
                case "preview":
                    this.receivedPreviewThisRun = true;
                    const pMode = (this.state.config || {}).preview_mode || "live";
                    if (pMode === "live") {
                        this.previewUI.showImage(message.image, true);
                    } else if (pMode === "every_5") {
                        if (this.state.currentStep === 1 || (this.state.currentStep > 0 && this.state.currentStep % 5 === 0)) {
                            this.previewUI.showImage(message.image, true);
                        }
                    }
                    break;
                case "final":
                    this.state.running = false;
                    this._setProgress(100);

                    // Detect preview support and update state dynamically
                    const isCached = message.prompt_id && String(message.prompt_id).startsWith("cached_");
                    if (!isCached) {
                        const supportsPreview = !!this.receivedPreviewThisRun;
                        if (this.state.comfySupportsPreview !== supportsPreview) {
                            this.state.comfySupportsPreview = supportsPreview;
                            localStorage.setItem("yuuka.liveGen.comfySupportsPreview", String(supportsPreview));
                            this.settingsUI.updatePreviewModeState();
                        }
                    }

                    // Only update the core active generation configs if the user is currently viewing the active generation slide
                    const isViewingActive = this.previewUI.currentIndex === this.previewUI.slides.length - 1 || this.previewUI.currentIndex === -1;

                    if (isViewingActive) {
                        this.state.lastFinalImageBase64 = message.image;
                        if (message.snapshot_id && this.state.config) {
                            this.state.config.snapshot_id = message.snapshot_id;
                        }
                        if (message.config && this.state.config) {
                            this.state.config = { ...this.state.config, ...message.config };
                        }
                    }

                    // Reset isPreGenerating BEFORE calling showImage
                    const wasPreGenerating = this.previewUI.isPreGenerating;
                    this.previewUI.isPreGenerating = false;

                    this.previewUI.showImage(message.image, false, {
                        snapshotId: message.snapshot_id,
                        generationConfig: message.config || { ...this.state.config, seed: message.seed, snapshot_id: message.snapshot_id },
                        isPreGenerated: wasPreGenerating
                    });

                    const elapsed = this.state.generationStartTime
                        ? ((Date.now() - this.state.generationStartTime) / 1000).toFixed(1)
                        : null;
                    const timeText = elapsed ? `${elapsed}s` : "hoàn tất";
                    this._setStatus(`Hoàn tất trong ${timeText}`, "ready");

                    const panel = document.querySelector(".live-gen-timeline-panel");
                    if (panel) {
                        this.timelineUI.loadTimelineTab(panel, "history");
                        this.timelineUI.loadTimelineTab(panel, "favorite");
                    }
                    break;
                case "idle":
                    this.state.running = false;
                    this._setProgress(0);
                    this._setStatus("Sẵn sàng.", "ready");
                    if (this.previewUI.isPreGenerating) {
                        this.previewUI.removePreGenSlide();
                        this.previewUI.isPreGenerating = false;
                    }
                    break;
                case "cancelled":
                    this.state.running = false;
                    this._setStatus("Đã hủy tác vụ cũ.", "idle");
                    if (this.previewUI.isPreGenerating) {
                        this.previewUI.removePreGenSlide();
                        this.previewUI.isPreGenerating = false;
                    }
                    break;
                case "user_preferences_updated":
                    if (this.state.config) {
                        this.state.config.llm_user_preferences = message.preferences;
                    }
                    const prefTextarea = document.querySelector('.live-gen-settings-panel [data-role="llm_user_preferences"]');
                    if (prefTextarea) {
                        prefTextarea.value = message.preferences;
                    }
                    window.showSuccess?.("Sở thích người dùng (User Preferences) vừa được LLM tự động cập nhật!");
                    break;
                case "error":
                    this.state.running = false;
                    this._setStatus(message.message || "Live Gen lỗi.", "error");
                    window.showError?.(`Live Gen: ${message.message || "Lỗi không xác định."}`);
                    if (this.previewUI.isPreGenerating) {
                        this.previewUI.removePreGenSlide();
                        this.previewUI.isPreGenerating = false;
                    }
                    break;
            }
        }

        _setStatus(text, mode = "idle") {
            this.previewUI.setStatus(text, mode);
        }

        _setProgress(percent) {
            this.previewUI.setProgress(percent);
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
                onClick: () => this.promptUI.openPromptMode(),
            });

            navibar.setActivePlugin(PLUGIN_ID);
        }

        _scheduleGeneration(delay) {
            clearTimeout(this.debounceTimer);
            if (this.state.config) {
                delete this.state.config.snapshot_id;
            }
            if (this.previewUI) {
                this.previewUI.userTriggeredGeneration = true;
                this.previewUI.isPreGenerating = false;
            }
            this.debounceTimer = setTimeout(() => this._generateNow(), delay);
        }

        async _generateNow() {
            const prompt = this.helpers.normalizePrompt(this.state.prompt);
            if (!prompt) return;
            if (prompt === this.lastGeneratedPrompt) return;
            
            const previewUI = this.previewUI;
            const isViewingOldSlide = previewUI && previewUI.slides && previewUI.currentIndex >= 0 && previewUI.currentIndex < previewUI.slides.length - 1;
            if (isViewingOldSlide) {
                const activeSlide = previewUI.slides[previewUI.currentIndex];
                if (activeSlide && !activeSlide.isPreview && activeSlide.generationConfig) {
                    await previewUI.applySlideSnapshot(activeSlide, false, true);
                }
            }
            
            if (!this.wsClient.ws || this.wsClient.ws.readyState !== WebSocket.OPEN) {
                this._setStatus("Đang đợi WebSocket...", "idle");
                this.wsClient.connect();
                return;
            }
            this.lastGeneratedPrompt = prompt;
            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Đang gửi prompt...", "running");
            
            const payload = {
                type: "generate",
                seq: this.seq,
                prompt: this.state.prompt, // Save the raw prompt with newlines
                seed: this.state.seed,
                config: {
                    ...(this.state.config || {}),
                    seed: this.state.seed,
                },
            };

            if (this.state.keepActive && this.state.lastFinalImageBase64) {
                payload.input_image_base64 = this.state.lastFinalImageBase64;
                payload.config._workflow_type = "image2image";
                payload.config.denoise = this.state.config.i2i_keep_denoise != null ? this.state.config.i2i_keep_denoise : 0.45;
            }

            this.wsClient.send(payload);
        }

        _toggleKeep() {
            if (!this.state.lastFinalImageBase64) {
                window.showError?.("Không có ảnh để ghim. Hãy đợi ảnh tạo xong.");
                return;
            }
            this.state.keepActive = !this.state.keepActive;
            if (this.previewUI.keepBtn) {
                this.previewUI.keepBtn.classList.toggle("active", !!this.state.keepActive);
            }
            this._syncMobileNavButtonStates();
        }

        async _urlToBase64(url) {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.warn("⚠️ Không thể chuyển đổi ảnh sang Base64: ", err);
                return null;
            }
        }

        async _toggleHires() {
            const previewUI = this.previewUI;
            const isViewingOldSlide = previewUI && previewUI.slides && previewUI.currentIndex >= 0 && previewUI.currentIndex < previewUI.slides.length - 1;

            if (isViewingOldSlide) {
                const activeSlide = previewUI.slides[previewUI.currentIndex];
                if (!activeSlide || activeSlide.isPreview || !activeSlide.generationConfig) return;

                const newHires = !activeSlide.generationConfig.hires_enabled;
                activeSlide.generationConfig.hires_enabled = newHires;

                if (previewUI.hiresBtn) {
                    previewUI.hiresBtn.classList.toggle("active", newHires);
                }
                this._syncMobileNavButtonStates();

                try {
                    const updatedConfig = {
                        ...this.state.config,
                        ...activeSlide.generationConfig,
                        hires_enabled: newHires
                    };
                    const saved = await this.apiClient.saveConfig(updatedConfig);
                    this.state.config = { ...this.state.config, ...saved.config };
                    this.wsClient.send({ type: "update_config", config: saved.config });

                    if (newHires && activeSlide.url) {
                        this._setStatus("Upscaling (Hires Fix)...", "running");
                        const base64 = await this._urlToBase64(activeSlide.url);
                        if (base64) {
                            this._runHiresOnSlide(base64, activeSlide.generationConfig);
                        } else {
                            window.showError?.("Không thể tải dữ liệu ảnh của snapshot cũ này để nâng cấp.");
                        }
                    } else if (!newHires && activeSlide.snapshotId) {
                        try {
                            const resp = await this.apiClient.getHistory();
                            const rawImages = resp.images || [];
                            const lowResImg = rawImages.find(img => 
                                img.generationConfig?.snapshot_id === activeSlide.snapshotId && 
                                !(img.generationConfig?.hires_enabled === true || img.generationConfig?.hires_enabled === 'true' || img.generationConfig?.hires_enabled === '1' || img.generationConfig?.hires_enabled === 'yes')
                            );
                            if (lowResImg) {
                                activeSlide.url = lowResImg.url;
                                activeSlide.pvUrl = lowResImg.pv_url || lowResImg.url;
                                if (activeSlide.el) {
                                    const img = activeSlide.el.querySelector(".live-gen-preview__image");
                                    if (img) {
                                        img.src = activeSlide.url;
                                        img.classList.remove("is-loaded");
                                        img.onload = () => img.classList.add("is-loaded");
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn("Không thể tìm phiên bản low-res trong lịch sử:", e);
                        }
                    }
                } catch (err) {
                    window.showError?.(`Không thể lưu cấu hình Hires: ${err.message}`);
                }
                return;
            }

            if (!this.state.config) return;
            const newHires = !this.state.config.hires_enabled;
            
            const updatedConfig = {
                ...this.state.config,
                hires_enabled: newHires
            };

            try {
                const saved = await this.apiClient.saveConfig(updatedConfig);
                this._applyConfig(saved.config);
                this.wsClient.send({ type: "update_config", config: saved.config });
                
                if (newHires && this.state.lastFinalImageBase64) {
                    this._runHiresOnCurrentImage();
                } else {
                    this.lastGeneratedPrompt = "";
                    this._scheduleGeneration(15);
                }
            } catch (err) {
                window.showError?.(`Không thể lưu cấu hình Hires: ${err.message}`);
            }
        }

        _runHiresOnSlide(base64, slideConfig) {
            if (!this.wsClient.ws || this.wsClient.ws.readyState !== WebSocket.OPEN) {
                this._setStatus("Đang đợi WebSocket...", "idle");
                this.wsClient.connect();
                return;
            }

            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Upscaling (Hires Fix)...", "running");
            if (this.previewUI) {
                this.previewUI.userTriggeredGeneration = true;
                this.previewUI.isPreGenerating = false;
            }

            this.wsClient.send({
                type: "generate",
                seq: this.seq,
                prompt: slideConfig.prompt,
                seed: slideConfig.seed,
                input_image_base64: base64,
                config: {
                    ...slideConfig,
                    seed: slideConfig.seed,
                    _workflow_type: "image2image",
                    hires_enabled: true,
                }
            });
        }

        _runHiresOnCurrentImage() {
            if (!this.state.lastFinalImageBase64) return;
            if (!this.wsClient.ws || this.wsClient.ws.readyState !== WebSocket.OPEN) {
                this._setStatus("Đang đợi WebSocket...", "idle");
                this.wsClient.connect();
                return;
            }

            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Upscaling (Hires Fix)...", "running");
            if (this.previewUI) {
                this.previewUI.userTriggeredGeneration = true;
                this.previewUI.isPreGenerating = false;
            }

            this.wsClient.send({
                type: "generate",
                seq: this.seq,
                prompt: this.state.prompt,
                seed: this.state.seed,
                input_image_base64: this.state.lastFinalImageBase64,
                config: {
                    ...(this.state.config || {}),
                    seed: this.state.seed,
                    _workflow_type: "image2image",
                    hires_enabled: true,
                }
            });
        }

        _runRefine() {
            if (!this.state.lastFinalImageBase64) {
                window.showError?.("Không có ảnh để Refine. Hãy đợi ảnh tạo xong.");
                return;
            }
            if (!this.wsClient.ws || this.wsClient.ws.readyState !== WebSocket.OPEN) {
                window.showError?.("WebSocket chưa kết nối!");
                return;
            }
            
            const steps = (Number(this.state.config.steps) || 12) + 10;
            const denoise = this.state.config.i2i_refine_denoise != null ? this.state.config.i2i_refine_denoise : 0.25;
            
            this.seq += 1;
            this.state.latestSeq = this.seq;
            this._setStatus("Refining...", "running");
            if (this.previewUI) {
                this.previewUI.userTriggeredGeneration = true;
                this.previewUI.isPreGenerating = false;
            }
            
            this.wsClient.send({
                type: "generate",
                seq: this.seq,
                prompt: this.state.prompt,
                seed: this.state.seed,
                input_image_base64: this.state.lastFinalImageBase64,
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

        _openSettings() {
            this.settingsUI.openSettings();
        }

        async _rerollSeed() {
            const previewUI = this.previewUI;
            const isViewingOldSlide = previewUI && previewUI.slides && previewUI.currentIndex >= 0 && previewUI.currentIndex < previewUI.slides.length - 1;

            const newSeed = Math.floor(Math.random() * 1000000000);
            try {
                let configToSave = { seed: newSeed };
                if (isViewingOldSlide) {
                    const activeSlide = previewUI.slides[previewUI.currentIndex];
                    if (activeSlide && !activeSlide.isPreview && activeSlide.generationConfig) {
                        await previewUI.applySlideSnapshot(activeSlide, false);
                        configToSave = { ...activeSlide.generationConfig, seed: newSeed };
                    }
                }
                const saved = await this.apiClient.saveConfig(configToSave);
                this._applyConfig(saved.config);
                this.wsClient.send({ type: "update_config", config: saved.config });
                // Sync seed input in settings panel if open
                const seedInput = document.querySelector('.live-gen-settings-panel [data-role="seed"]');
                if (seedInput) seedInput.value = String(newSeed);
                this.lastGeneratedPrompt = "";
                this._scheduleGeneration(15);
            } catch (err) {
                window.showError?.(`Không thể lưu seed mới: ${err.message}`);
            }
        }

        _generatePreGen(baseSlide) {
            const prompt = this.helpers.normalizePrompt(baseSlide.generationConfig.prompt);
            if (!prompt) {
                this.previewUI.isPreGenerating = false;
                return;
            }

            if (!this.wsClient.ws || this.wsClient.ws.readyState !== WebSocket.OPEN) {
                this.previewUI.isPreGenerating = false;
                return;
            }

            const preGenSeed = Math.floor(Math.random() * 1000000000);

            this.seq += 1;
            this.state.latestSeq = this.seq;

            const payload = {
                type: "generate",
                seq: this.seq,
                prompt: baseSlide.generationConfig.prompt,
                seed: preGenSeed,
                config: {
                    ...baseSlide.generationConfig,
                    seed: preGenSeed,
                },
            };

            if (this.state.keepActive && this.state.lastFinalImageBase64) {
                payload.input_image_base64 = this.state.lastFinalImageBase64;
                payload.config._workflow_type = "image2image";
                payload.config.denoise = this.state.config.i2i_keep_denoise != null ? this.state.config.i2i_keep_denoise : 0.45;
            }

            this.wsClient.send(payload);
        }

        _openTimeline() {
            this.timelineUI.openTimeline();
        }

        _syncMobileNavButtonStates() {
            const mobileContainer = document.getElementById("live-gen-mobile-nav-buttons");
            if (!mobileContainer) return;
            
            const mobileKeepBtn = mobileContainer.querySelector('[data-action="keep"]');
            if (mobileKeepBtn && this.previewUI.keepBtn) {
                mobileKeepBtn.classList.toggle("active", this.previewUI.keepBtn.classList.contains("active"));
            }
            
            const mobileHiresBtn = mobileContainer.querySelector('[data-action="hires"]');
            if (mobileHiresBtn && this.previewUI.hiresBtn) {
                mobileHiresBtn.classList.toggle("active", this.previewUI.hiresBtn.classList.contains("active"));
            }
        }
    }

    window.Yuuka.components.LiveGenComponent = LiveGenComponent;
})();
