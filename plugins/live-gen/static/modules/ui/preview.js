(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const helpers = window.Yuuka.liveGen.helpers;

    class LiveGenPreviewUI {
        constructor(component) {
            this.component = component;
            this.state = component.state;
            this.apiClient = component.apiClient;
            this.wsClient = component.wsClient;

            // Slides state management
            this.slides = []; // Array of { id, url, pvUrl, isPreview, generationConfig, snapshotId, el }
            this.currentIndex = -1;
            this.isPreGenerating = false;

            // Swiping / Dragging state
            this.dragState = {
                isDragging: false,
                startX: 0,
                startY: 0,
                currentX: 0,
                currentY: 0,
                deltaX: 0,
                deltaY: 0,
                startTime: 0
            };

            // Bind drag handlers
            this.handlePointerDown = this.handlePointerDown.bind(this);
            this.handlePointerMove = this.handlePointerMove.bind(this);
            this.handlePointerUp = this.handlePointerUp.bind(this);

            this.userTriggeredGeneration = false;
            this.isBouncingBack = false;
        }

        initDOMElements() {
            // Main container of the preview component
            this.container = this.component.container.querySelector('[data-role="preview"]');
            this.emptyEl = this.component.container.querySelector('[data-role="empty"]');
            this.statusEl = this.component.container.querySelector('[data-role="status-text"]');
            this.dotEl = this.component.container.querySelector('[data-role="dot"]');
            this.progressBarEl = this.component.container.querySelector('[data-role="progress-bar"]');
            this.keepBtn = this.component.container.querySelector('[data-action="keep"]');
            this.hiresBtn = this.component.container.querySelector('[data-action="hires"]');
            this.settingsBtn = this.component.container.querySelector('[data-action="settings"]');
            this.timelineBtn = this.component.container.querySelector('[data-action="timeline"]');

            this.keepBtn?.addEventListener("click", () => this.component._toggleKeep());
            this.keepBtn?.addEventListener("mousedown", (e) => e.preventDefault());
            this.hiresBtn?.addEventListener("click", () => this.component._toggleHires());
            this.hiresBtn?.addEventListener("mousedown", (e) => e.preventDefault());
            this.settingsBtn?.addEventListener("click", () => this.component._openSettings());
            this.settingsBtn?.addEventListener("mousedown", (e) => e.preventDefault());
            this.timelineBtn?.addEventListener("click", () => this.component._openTimeline());
            this.timelineBtn?.addEventListener("mousedown", (e) => e.preventDefault());

            // Add Pointer Event Listeners for dragging/swiping
            if (this.container) {
                this.container.addEventListener("pointerdown", this.handlePointerDown);
                this.container.addEventListener("pointermove", this.handlePointerMove);
                this.container.addEventListener("pointerup", this.handlePointerUp);
                this.container.addEventListener("pointercancel", this.handlePointerUp);
                
                // Disable browser default image dragging inside preview
                this.container.addEventListener("dragstart", (e) => e.preventDefault());
            }

            this.setStatus("Đang chuẩn bị...", "idle");
        }

        async loadHistory() {
            try {
                const resp = await this.apiClient.getHistory();
                const rawImages = resp.images || [];
                
                const uniqueImages = [];
                const seenSnapshots = new Set();
                
                rawImages.forEach(img => {
                    const snapId = img.generationConfig?.snapshot_id;
                    if (snapId) {
                        if (!seenSnapshots.has(snapId)) {
                            seenSnapshots.add(snapId);
                            const sameSnap = rawImages.filter(i => i.generationConfig?.snapshot_id === snapId);
                            const best = sameSnap.find(i => {
                                const h = i.generationConfig?.hires_enabled;
                                return h === true || h === 'true' || h === '1' || h === 'yes';
                            }) || sameSnap[0];
                            uniqueImages.push(best);
                        }
                    } else {
                        uniqueImages.push(img);
                    }
                });

                // Chronological order: oldest first, newest last
                uniqueImages.reverse();

                this.slides = uniqueImages.map(img => ({
                    id: img.id,
                    url: img.url,
                    pvUrl: img.pv_url || img.url,
                    isPreview: false,
                    generationConfig: img.generationConfig,
                    snapshotId: img.generationConfig?.snapshot_id,
                    createdAt: img.createdAt,
                    el: null
                }));

                this.currentIndex = this.slides.length - 1;
                this.renderSlides();

                // Highlight correct selection in timeline if timeline is open
                if (this.currentIndex >= 0) {
                    const currentSlide = this.slides[this.currentIndex];
                    this.applySlideSnapshot(currentSlide, true);

                    // Set lastGeneratedPrompt to prevent useless generation on load
                    if (currentSlide.generationConfig?.prompt) {
                        this.component.lastGeneratedPrompt = this.component.helpers.normalizePrompt(currentSlide.generationConfig.prompt);
                    }

                    // Trigger pre-gen!
                    this.checkAndTriggerPreGen();
                }
            } catch (e) {
                console.warn("[LiveGen] Lỗi nạp lịch sử ảnh cho slides:", e);
                this.slides = [];
                this.currentIndex = -1;
                this.renderSlides();
            }
        }

        renderSlides() {
            if (!this.container) return;

            if (this.slides.length === 0) {
                this.emptyEl?.classList.remove("is-hidden");
                // Clean up any remaining slide elements
                this.container.querySelectorAll(".live-gen-preview__slide, .live-gen-preview__slide-loader").forEach(el => el.remove());
                return;
            }

            this.emptyEl?.classList.add("is-hidden");
 
            // Bất kỳ slide nào từ currentIndex trở về trước đều đã được người dùng duyệt qua/xem,
            // vì thế chúng không còn đóng vai trò là slide pre-generated ngầm ở tương lai nữa.
            this.slides.forEach((slide, idx) => {
                if (idx <= this.currentIndex && slide.isPreGenerated) {
                    slide.isPreGenerated = false;
                }
            });

            // Range of slides to render in DOM [currentIndex - 2, currentIndex + 2]
            const isSliderOn = this.state.getSliderMode() !== false;
            const visibleMin = isSliderOn ? Math.max(0, this.currentIndex - 2) : this.currentIndex;
            const visibleMax = isSliderOn ? Math.min(this.slides.length - 1, this.currentIndex + 2) : this.currentIndex;

            // Clean up slides out of view bounds
            this.slides.forEach((slide, idx) => {
                if ((idx < visibleMin || idx > visibleMax) && slide.el) {
                    slide.el.remove();
                    slide.el = null;
                }
            });

            // Render or update visible slides
            this.slides.forEach((slide, idx) => {
                if (idx >= visibleMin && idx <= visibleMax) {
                    let isNew = false;
                    if (!slide.el) {
                        slide.el = document.createElement("div");
                        slide.el.className = "live-gen-preview__slide";
                        isNew = true;
                        // Prevent initial transition animation from center (0,0,0) by setting transition none
                        slide.el.style.transition = "none";
                        this.container.appendChild(slide.el);
                    }

                    // Check if we need to render the loader or the image
                    const needsLoader = slide.isPreview && !slide.url;
                    const hasLoader = slide.el.querySelector(".live-gen-preview__slide-loader") !== null;

                    if (needsLoader) {
                        if (!hasLoader) {
                            const w = this.state.config?.width || 896;
                            const h = this.state.config?.height || 1152;
                            const ratio = w / h;
                            slide.el.innerHTML = `
                                <div class="live-gen-preview__slide-loader" style="--preview-aspect-ratio: ${w} / ${h}; --preview-aspect-ratio-num: ${ratio};">
                                    <span class="material-symbols-outlined live-gen-loader-icon">auto_awesome</span>
                                    <p>Đang chuẩn bị tạo ảnh...</p>
                                </div>
                            `;
                        }
                    } else {
                        // Needs image! If it has the loader or doesn't have an img, reset and create img
                        const img = slide.el.querySelector(".live-gen-preview__image");
                        if (!img) {
                            slide.el.innerHTML = "";
                            const newImg = document.createElement("img");
                            newImg.className = "live-gen-preview__image";
                            newImg.alt = "Live Gen Preview";
                            slide.el.appendChild(newImg);
                        }
                    }

                    // Apply content updates
                    if (!slide.isPreview || slide.url) {
                        const img = slide.el.querySelector(".live-gen-preview__image");
                        if (img) {
                            const targetUrl = slide.url || slide.pvUrl;
                            if (img.src !== targetUrl) {
                                if (idx === this.currentIndex) {
                                    // Load instantly for active snapshot
                                    img.src = targetUrl;
                                    img.onload = () => img.classList.add("is-loaded");
                                } else {
                                    // Delay loading for adjacent slides to prioritize the active main slide load
                                    // If we are fading in place (far jump), prioritize the main slide even more by delaying adjacent slides by 500ms
                                    const delay = this.isFadingInPlace ? 500 : 150;
                                    setTimeout(() => {
                                        if (slide.el && this.slides[idx] === slide) {
                                            const lazyImg = slide.el.querySelector(".live-gen-preview__image");
                                            if (lazyImg && lazyImg.src !== targetUrl) {
                                                lazyImg.src = targetUrl;
                                                lazyImg.onload = () => lazyImg.classList.add("is-loaded");
                                            }
                                        }
                                    }, delay);
                                }
                            }
                            
                            // Handle preview dynamic blur
                            if (slide.isPreview) {
                                img.classList.add("is-preview");
                                img.classList.remove("is-preview-fading");
                                
                                const baseBlur = this.state.getPreviewBlur();
                                let finalBlur = baseBlur;
                                if (baseBlur > 0) {
                                    const totalSteps = Number(this.state.config?.steps) || 12;
                                    const currentStep = Number(this.state.currentStep) || 0;
                                    if (totalSteps > 1 && currentStep > 0) {
                                        const maxBlurLimit = 20;
                                        if (maxBlurLimit > baseBlur) {
                                            const t = Math.min(1, Math.max(0, (currentStep - 1) / (totalSteps - 1)));
                                            const decay = Math.pow(1 - t, 3);
                                            finalBlur = baseBlur + (maxBlurLimit - baseBlur) * decay;
                                        }
                                    }
                                }
                                img.style.setProperty("--preview-blur", `${finalBlur.toFixed(1)}px`);
                            } else {
                                const wasPreview = img.classList.contains("is-preview");
                                img.classList.remove("is-preview");
                                img.classList.toggle("is-preview-fading", wasPreview);
                                img.style.removeProperty("--preview-blur");
                            }
                        }
                    }

                    // Toggle pointer interactive class only on the active centered slide
                    slide.el.classList.toggle("is-active", idx === this.currentIndex);

                    // Apply static ultra-tight peeking card stack positions (compact peeking deck style)
                    const diff = idx - this.currentIndex;
                    let translateX = diff * 6; // ultra-tight overlap translate percentage
                    let scale = 1.0;
                    let opacity = 1.0;
                    let zIndex = 2;
                    let translateZ = 0; // Standard premium Z-depth positioning

                    if (diff === 0) {
                        translateX = 0;
                        scale = 1.0;
                        opacity = 1.0;
                        zIndex = 2;
                        translateZ = 0;
                    } else if (diff === -1 || diff === 1) {
                        translateX = diff * 6;
                        scale = 0.98;
                        opacity = 0.55;
                        zIndex = 1;
                        translateZ = -60;
                    } else {
                        translateX = diff * 4.5;
                        scale = 0.96;
                        opacity = 0;
                        zIndex = 0;
                        translateZ = -120;
                    }

                    if (this.isFadingInPlace) {
                        // Position instantly without sliding transition, but animate opacity beautifully
                        slide.el.style.transition = "none";
                        slide.el.style.transform = `translate3d(${translateX}%, 0, ${translateZ}px) scale(${scale})`;
                        slide.el.style.opacity = 0;
                        slide.el.style.zIndex = zIndex;
                        
                        // Force a reflow
                        void slide.el.offsetWidth;
                        
                        // Fade in opacity smoothly
                        slide.el.style.transition = "opacity 0.4s ease";
                        slide.el.style.opacity = opacity;
                    } else {
                        // Restore standard premium translation animations
                        if (isNew) {
                            // Instantly position new slide at its initial state
                            slide.el.style.transform = `translate3d(${translateX}%, 0, ${translateZ}px) scale(${scale})`;
                            slide.el.style.opacity = opacity;
                            slide.el.style.zIndex = zIndex;
                            
                            // Force reflow so the browser registers the starting coordinates before applying transition
                            void slide.el.offsetWidth;
                            
                            // Re-enable smooth standard transition for subsequent interactions
                            const useTransform = isSliderOn || this.isBouncingBack;
                            if (diff === 0) {
                                slide.el.style.transition = useTransform
                                    ? "transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.16s ease-out, scale 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), filter 0.4s ease"
                                    : "opacity 0.3s ease, filter 0.4s ease";
                            } else {
                                slide.el.style.transition = useTransform
                                    ? "transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.4s ease, scale 0.4s ease, filter 0.4s ease"
                                    : "opacity 0.3s ease, filter 0.4s ease";
                            }
                        } else {
                            const useTransform = isSliderOn || this.isBouncingBack;
                            if (diff === 0) {
                                slide.el.style.transition = useTransform
                                    ? "transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.16s ease-out, scale 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), filter 0.4s ease"
                                    : "opacity 0.3s ease, filter 0.4s ease";
                            } else {
                                slide.el.style.transition = useTransform
                                    ? "transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.4s ease, scale 0.4s ease, filter 0.4s ease"
                                    : "opacity 0.3s ease, filter 0.4s ease";
                            }
                            slide.el.style.transform = `translate3d(${translateX}%, 0, ${translateZ}px) scale(${scale})`;
                            slide.el.style.opacity = opacity;
                            slide.el.style.zIndex = zIndex;
                        }
                    }
                }
            });
        }

        updateSlidesTransform(deltaX) {
            const w = this.container.clientWidth || window.innerWidth;
            let pct = deltaX / w;

            // Rubber banding resistance if sliding past endpoints
            if (this.currentIndex === 0 && deltaX > 0) {
                pct = (deltaX * 0.3) / w;
            } else if (this.currentIndex === this.slides.length - 1 && deltaX < 0) {
                pct = (deltaX * 0.3) / w;
            }

            const visibleMin = Math.max(0, this.currentIndex - 2);
            const visibleMax = Math.min(this.slides.length - 1, this.currentIndex + 2);

            this.slides.forEach((slide, idx) => {
                if (idx >= visibleMin && idx <= visibleMax && slide.el) {
                    // Disable CSS transitions during live mouse tracking for absolute responsive feel
                    slide.el.style.transition = "none";
                    const diff = idx - this.currentIndex;
                    let translateX = diff * 6;
                    let scale = 1.0;
                    let opacity = 1.0;
                    let zIndex = 1;
                    let translateZ = 0;

                    if (diff === 0) {
                        // Current card slides off slightly (tight deck shift)
                        translateX = pct * 20;
                        scale = 1.0 - Math.min(0.02, Math.abs(pct) * 0.02);
                        opacity = 1.0 - Math.min(0.45, Math.abs(pct) * 0.45);
                        zIndex = 2;
                        translateZ = pct * -60;
                    } else if (diff === -1) {
                        // Bringing left card in (6% movement) or pushing it to its disappearing offset (-9% at pct = -1, i.e. 3% movement)
                        if (pct > 0) {
                            translateX = -6 + pct * 6;
                            scale = 0.98 + Math.min(0.02, pct * 0.02);
                            opacity = 0.55 + Math.min(0.45, pct * 0.45);
                            translateZ = -60 + pct * 60;
                        } else {
                            translateX = -6 + pct * 3;
                            scale = 0.98 - Math.min(0.02, Math.abs(pct) * 0.02);
                            opacity = 0.55 - Math.min(0.55, Math.abs(pct) * 0.55);
                            translateZ = -60 + pct * 60;
                        }
                    } else if (diff === 1) {
                        // Bringing right card in (6% movement) or pushing it to its disappearing offset (9% at pct = 1, i.e. 3% movement)
                        if (pct < 0) {
                            translateX = 6 + pct * 6;
                            scale = 0.98 + Math.min(0.02, Math.abs(pct) * 0.02);
                            opacity = 0.55 + Math.min(0.45, Math.abs(pct) * 0.45);
                            translateZ = -60 + Math.abs(pct) * 60;
                        } else {
                            translateX = 6 + pct * 3;
                            scale = 0.98 - Math.min(0.02, Math.abs(pct) * 0.02);
                            opacity = 0.55 - Math.min(0.55, Math.abs(pct) * 0.55);
                            translateZ = -60 - pct * 60;
                        }
                    } else {
                        // Other cards transition tightly with exactly 3% movement rate (half of adjacent's 6%)
                        translateX = diff * 4.5 + pct * 3;
                        scale = 0.96;
                        opacity = 0;
                        zIndex = 0;
                        translateZ = diff > 0 ? -120 + Math.abs(pct) * 60 : -120 - Math.abs(pct) * 60;
                    }

                    slide.el.style.transform = `translate3d(${translateX}%, 0, ${translateZ}px) scale(${scale})`;
                    slide.el.style.opacity = opacity;
                    slide.el.style.zIndex = zIndex;
                }
            });
        }

        handlePointerDown(e) {
            if (this.slides.length <= 1) return;
            if (e.target.closest("button") || e.target.closest(".live-gen-header") || e.target.closest(".live-gen-progress")) {
                return;
            }

            this.dragState.isDragging = true;
            this.dragState.startX = e.clientX;
            this.dragState.startY = e.clientY;
            this.dragState.currentX = e.clientX;
            this.dragState.currentY = e.clientY;
            this.dragState.deltaX = 0;
            this.dragState.deltaY = 0;
            this.dragState.startTime = Date.now();

            this.container.setPointerCapture(e.pointerId);
            this.container.classList.add("is-dragging");
        }

        handlePointerMove(e) {
            if (!this.dragState.isDragging) return;

            this.dragState.currentX = e.clientX;
            this.dragState.currentY = e.clientY;
            this.dragState.deltaX = e.clientX - this.dragState.startX;
            this.dragState.deltaY = e.clientY - this.dragState.startY;

            this.updateSlidesTransform(this.dragState.deltaX);
        }

        handlePointerUp(e) {
            if (!this.dragState.isDragging) return;

            this.dragState.isDragging = false;
            this.container.releasePointerCapture(e.pointerId);
            this.container.classList.remove("is-dragging");

            const isSliderOn = this.state.getSliderMode() !== false;
            const deltaX = this.dragState.deltaX;
            const threshold = this.container.clientWidth * 0.075; // 7.5% swipe threshold
            const duration = Date.now() - this.dragState.startTime;
            
            const isSwipe = Math.abs(deltaX) > 50 && duration < 250;
            let success = false;
            let dir = 0; // 1: right (prev), -1: left (next)

            if (isSliderOn) {
                if (deltaX > threshold || (isSwipe && deltaX > 0)) {
                    if (this.currentIndex > 0) {
                        success = true;
                        dir = 1;
                    }
                } else if (deltaX < -threshold || (isSwipe && deltaX < 0)) {
                    if (this.currentIndex < this.slides.length - 1) {
                        success = true;
                        dir = -1;
                    } else {
                        // Trigger new image generation with random seed when trying to swipe next past the latest snapshot
                        this.component._rerollSeed();
                    }
                }
            }

            if (success) {
                if (dir === 1) {
                    this.currentIndex--;
                } else {
                    this.currentIndex++;
                }

                this.renderSlides();

                const activeSlide = this.slides[this.currentIndex];
                if (activeSlide && !activeSlide.isPreview && activeSlide.generationConfig) {
                    // Slide successfully: load temporary snapshot UI configurations without interrupting background tasks
                    const isNewest = this.currentIndex === this.slides.length - 1;
                    this.applySlideSnapshot(activeSlide, !isNewest);

                    this.checkAndTriggerPreGen();
                }
            } else {
                // If it's a simple rapid click/tap, trigger Simple Viewer Zoom
                const isTap = Math.abs(deltaX) < 5 && Math.abs(this.dragState.deltaY) < 5 && duration < 250;
                if (isTap) {
                    const activeSlide = this.slides[this.currentIndex];
                    if (activeSlide && !activeSlide.isPreview && activeSlide.url) {
                        this.openSimpleViewer();
                    }
                } else {
                    // Bounce back animation
                    this.isBouncingBack = true;
                    this.renderSlides();
                    setTimeout(() => {
                        this.isBouncingBack = false;
                    }, 400);
                }
            }
        }

        async applySlideSnapshot(slide, isTemporary = false, keepPrompt = false) {
            if (!slide || !slide.generationConfig) return;
            const cfg = { ...slide.generationConfig };

            this.isApplyingSnapshot = true;
            if (this.component.settingsUI) {
                this.component.settingsUI.isApplyingSnapshot = true;
            }

            try {
                // Normalize Hires Fix values
                const isHires = cfg.hires_enabled === true || cfg.hires_enabled === 'true' || cfg.hires_enabled === 1 || cfg.hires_enabled === '1' || cfg.hires_enabled === 'yes';
                cfg.hires_enabled = isHires;

                // Normalize Multi-LoRA
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

                // Sync prompt text area
                const promptStr = cfg.prompt || "";
                const textarea = document.querySelector(".live-gen-prompt-input");
                const isFocused = textarea && document.activeElement === textarea;
                if (textarea && !keepPrompt && !isFocused) {
                    const isLatest = slide === this.slides[this.slides.length - 1];
                    // Do not overwrite the prompt input if the user is actively focusing and editing the latest slide
                    if (!isLatest) {
                        textarea.value = promptStr;
                        this.component.promptUI.autoGrow(textarea);
                    }
                }

                // Sync sliders / inputs in Settings Panel if open
                const settingsPanel = document.querySelector(".live-gen-settings-panel");
                if (settingsPanel) {
                    const seedInput = settingsPanel.querySelector('[data-role="seed"]');
                    if (seedInput) seedInput.value = String(cfg.seed || 0);

                    const stepsInput = settingsPanel.querySelector('[data-role="steps"]');
                    const stepsVal = settingsPanel.querySelector('[data-role="steps-val"]');
                    if (stepsInput) {
                        stepsInput.value = String(cfg.steps || 12);
                        if (stepsVal) stepsVal.textContent = stepsInput.value;
                    }

                    const cfgScaleInput = settingsPanel.querySelector('[data-role="cfg"]');
                    const cfgVal = settingsPanel.querySelector('[data-role="cfg-val"]');
                    if (cfgScaleInput) {
                        cfgScaleInput.value = String(cfg.cfg || 1.0);
                        if (cfgVal) cfgVal.textContent = cfgScaleInput.value;
                    }

                    const widthInput = settingsPanel.querySelector('[data-role="width"]');
                    if (widthInput) widthInput.value = String(cfg.width || 896);

                    const heightInput = settingsPanel.querySelector('[data-role="height"]');
                    if (heightInput) heightInput.value = String(cfg.height || 1152);
                }

                // Synchronize highlights in Timeline Panel if open
                const timelinePanel = document.querySelector(".live-gen-timeline-panel");
                if (timelinePanel) {
                    timelinePanel.querySelectorAll(".timeline-item").forEach(el => el.classList.remove("selected"));
                    
                    const snapId = slide.snapshotId;
                    const targetUrl = slide.pvUrl || slide.url;

                    const matchingItems = Array.from(timelinePanel.querySelectorAll(".timeline-item")).filter(el => {
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
                    
                    if (matchingItems.length > 0) {
                        matchingItems.forEach(el => el.classList.add("selected"));
                        // Smoothly scroll the highlighted timeline item into view
                        matchingItems[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }
                }

                // Sync Keep Img2Img badges
                if (this.hiresBtn) {
                    this.hiresBtn.classList.toggle("active", !!cfg.hires_enabled);
                }
                this.component._syncMobileNavButtonStates();

                if (!isTemporary) {
                    // Perform complete state modifications for active generation configs
                    if (!keepPrompt && !isFocused) {
                        this.state.prompt = promptStr;
                        this.state.setPrompt(promptStr);
                    } else {
                        cfg.prompt = this.state.prompt;
                    }
                    this.state.seed = Number(cfg.seed) || 0;
                    this.component._applyConfig(cfg);

                    this.state.lastFinalImageBase64 = null;
                    try {
                        const response = await fetch(slide.url);
                        const blob = await response.blob();
                        this.state.lastFinalImageBase64 = await new Promise((resolve) => {
                            const reader = new FileReader();
                            const r = reader;
                            r.onloadend = () => resolve(r.result);
                            r.readAsDataURL(blob);
                        });
                    } catch (err) {
                        console.warn("⚠️ Không thể chuyển đổi ảnh sang Base64 cho Img2Img Keep: ", err);
                    }
                }
            } finally {
                setTimeout(() => {
                    this.isApplyingSnapshot = false;
                    if (this.component.settingsUI) {
                        this.component.settingsUI.isApplyingSnapshot = false;
                    }
                }, 50);
            }
        }

        slideToImage(url, snapshotId, generationConfig = null, isTemporaryOverride = null) {
            if (this.slides.length === 0) {
                return false;
            }
            
            const index = this.slides.findIndex((s, idx) => {
                const matchSnap = snapshotId && s.snapshotId === snapshotId;
                let matchUrl = false;
                try {
                    const path1 = new URL(s.url, window.location.origin).pathname;
                    const path2 = new URL(url, window.location.origin).pathname;
                    matchUrl = path1 === path2;
                } catch (e) {
                    matchUrl = s.url === url || s.url.includes(url) || url.includes(s.url);
                }
                return matchSnap || matchUrl;
            });

            if (index !== -1) {
                const slide = this.slides[index];
                if (url && slide.url !== url) {
                    // Only update url if it's not a giant base64 string replacing a clean server URL
                    const isBase64 = url.startsWith("data:");
                    const isCleanUrl = slide.url && (slide.url.startsWith("/") || slide.url.startsWith("http"));
                    if (!isBase64 || !isCleanUrl) {
                        const wasBase64 = slide.url && slide.url.startsWith("data:");
                        slide.url = url;
                        slide.pvUrl = url;
                        if (slide.el) {
                            const img = slide.el.querySelector(".live-gen-preview__image");
                            if (img) {
                                if (wasBase64 && !isBase64) {
                                    // If already loaded as base64 and transitioning to a clean URL, do not remove is-loaded to prevent fade-out opacity flicker
                                    img.src = url;
                                } else {
                                    img.src = url;
                                    img.classList.remove("is-loaded");
                                    img.onload = () => img.classList.add("is-loaded");
                                }
                            }
                        }
                    }
                }

                if (generationConfig) {
                    slide.generationConfig = { ...generationConfig };
                }

                const isFar = this.currentIndex !== -1 && Math.abs(index - this.currentIndex) > 1;
                // Check if it's a cached snapshot hit (we were looking at a preview loader placeholder)
                const isCachedHit = (this.currentIndex >= 0 && this.currentIndex < this.slides.length && this.slides[this.currentIndex].isPreview && !this.slides[this.currentIndex].url);
                
                if (isCachedHit) {
                    // Remove the temporary preview loader slide
                    const loaderSlide = this.slides[this.slides.length - 1];
                    if (loaderSlide && loaderSlide.el) {
                        loaderSlide.el.remove();
                    }
                    this.slides.pop();
                    
                    // Update index to the matched historical slide
                    this.currentIndex = index;
                    
                    // Trigger premium fade-in in-place transition!
                    this.isFadingInPlace = true;
                    this.renderSlides();
                    
                    // Reset fading flag after transition completes
                    setTimeout(() => {
                        this.isFadingInPlace = false;
                        this.renderSlides();
                    }, 500);
                } else if (isFar) {
                    this.currentIndex = index;
                    this.isFadingInPlace = true;
                    this.renderSlides();
                    
                    setTimeout(() => {
                        this.isFadingInPlace = false;
                        this.renderSlides();
                    }, 500);
                } else {
                    this.currentIndex = index;
                    this.renderSlides();
                }
                
                const currentSlide = this.slides[this.currentIndex];
                if (currentSlide && !currentSlide.isPreview && currentSlide.generationConfig) {
                    const isNewest = this.currentIndex === this.slides.length - 1;
                    const isTemp = isTemporaryOverride !== null ? isTemporaryOverride : !isNewest;
                    this.applySlideSnapshot(currentSlide, isTemp);

                    this.checkAndTriggerPreGen();
                }
                return true;
            }
            return false;
        }

        showImage(src, isPreview, metadata) {
            if (!src) return;

            // Only auto-slide/steal focus if the user is currently watching the active generation slide at the end
            const isViewingGeneration = this.currentIndex === this.slides.length - 1 || this.currentIndex === -1;

            // Check if the image already exists in our historical slides
            const existingIndex = this.slides.findIndex((s, idx) => {
                const matchSnap = metadata?.snapshotId && s.snapshotId === metadata.snapshotId;
                let matchUrl = false;
                try {
                    const path1 = new URL(s.url, window.location.origin).pathname;
                    const path2 = new URL(src, window.location.origin).pathname;
                    matchUrl = path1 === path2;
                } catch (e) {
                    matchUrl = s.url === src || s.url.includes(src) || src.includes(s.url);
                }
                return matchSnap || matchUrl;
            });

            // Always allow sliding to existing older historical slides (e.g. clicking timeline).
            // For the active generation slide at the end, only slide if the user is actively viewing the generation.
            const canSlide = existingIndex !== -1 && (existingIndex < this.slides.length - 1 || isViewingGeneration);

            // If we are showing a final image and we can slide to it, do that instead of creating a duplicate
            if (!isPreview && canSlide && this.slideToImage(src, metadata?.snapshotId, metadata?.generationConfig, false)) {
                return;
            }

            // Find or create last slide representing the active generation
            let activeSlide = this.slides[this.slides.length - 1];
            if (!activeSlide || !activeSlide.isPreview) {
                activeSlide = {
                    id: null,
                    url: src,
                    pvUrl: src,
                    isPreview: isPreview,
                    generationConfig: metadata?.generationConfig || null,
                    snapshotId: metadata?.snapshotId || null,
                    el: null,
                    isPreGenerated: metadata?.isPreGenerated || this.isPreGenerating
                };
                this.slides.push(activeSlide);
            } else {
                activeSlide.url = src;
                activeSlide.pvUrl = src;
                activeSlide.isPreview = isPreview;
                if (metadata) {
                    activeSlide.generationConfig = metadata.generationConfig;
                    activeSlide.snapshotId = metadata.snapshotId;
                    if (metadata.isPreGenerated !== undefined) {
                        activeSlide.isPreGenerated = metadata.isPreGenerated;
                    }
                }
            }

            // Only auto-slide focus to the newest preview if the user was already looking at the newest/latest slide
            if (isViewingGeneration) {
                this.currentIndex = this.slides.length - 1;
            }

            this.renderSlides();

            // If the final generation completed and the user is viewing the latest snapshot sequence, trigger pre-gen check
            const isViewingLatest = this.isViewingLatestSnapshot();
            if (!isPreview && isViewingLatest) {
                const isActiveSlide = this.currentIndex >= 0 && this.slides[this.currentIndex] === activeSlide;
                if (isActiveSlide) {
                    this.applySlideSnapshot(activeSlide, false);
                }

                this.checkAndTriggerPreGen();
            }
        }

        onGenerationStarting() {
            // Check if there is already an active preview slide
            const lastSlide = this.slides[this.slides.length - 1];
            if (lastSlide && lastSlide.isPreview) {
                if (this.userTriggeredGeneration) {
                    this.currentIndex = this.slides.length - 1;
                    this.userTriggeredGeneration = false;
                    this.renderSlides();
                }
                return;
            }

            // Push a placeholder preview loader slide
            const newSlide = {
                id: null,
                url: "",
                pvUrl: "",
                isPreview: true,
                generationConfig: null,
                snapshotId: null,
                el: null,
                isPreGenerated: this.isPreGenerating
            };

            const wasAtEnd = this.currentIndex === this.slides.length - 1 || this.currentIndex === -1 || this.userTriggeredGeneration;
            this.userTriggeredGeneration = false;
            
            this.slides.push(newSlide);

            if (wasAtEnd && !this.isPreGenerating) {
                this.currentIndex = this.slides.length - 1;
            }

            this.renderSlides();
        }

        removeImageById(id, url, snapshotId) {
            const index = this.slides.findIndex(s => {
                if (id && s.id === id) return true;
                if (snapshotId && s.snapshotId === snapshotId) return true;
                if (url) {
                    try {
                        const path1 = new URL(s.url, window.location.origin).pathname;
                        const path2 = new URL(url, window.location.origin).pathname;
                        return path1 === path2;
                    } catch (e) {
                        return s.url === url || s.url.includes(url) || url.includes(s.url);
                    }
                }
                return false;
            });
            if (index === -1) return;

            const slide = this.slides[index];
            if (slide.el) {
                slide.el.remove();
            }

            this.slides.splice(index, 1);

            // Re-adjust active index
            if (this.currentIndex >= this.slides.length) {
                this.currentIndex = this.slides.length - 1;
            } else if (this.currentIndex === index && this.currentIndex > 0) {
                this.currentIndex--;
            }

            this.renderSlides();

            // Re-apply active configs
            if (this.currentIndex >= 0) {
                const activeSlide = this.slides[this.currentIndex];
                if (activeSlide && !activeSlide.isPreview && activeSlide.generationConfig) {
                    const isNewest = this.currentIndex === this.slides.length - 1;
                    this.applySlideSnapshot(activeSlide, !isNewest);

                    this.checkAndTriggerPreGen();
                }
            } else {
                this.state.lastFinalImageBase64 = null;
                if (this.state.config) delete this.state.config.snapshot_id;
            }
        }

        isViewingLatestSnapshot() {
            if (this.slides.length === 0) return false;
            if (this.currentIndex === -1) return true;
            
            // Một slide được coi là "mới nhất" nếu phía sau nó (từ currentIndex + 1 đến cuối) 
            // không có slide nào được tạo chủ động bởi người dùng (tức là tất cả slides phía sau, nếu có, đều là isPreGenerated).
            for (let i = this.currentIndex + 1; i < this.slides.length; i++) {
                if (!this.slides[i].isPreGenerated) {
                    return false;
                }
            }
            return true;
        }

        getPreGeneratedCount() {
            let count = 0;
            for (let i = this.slides.length - 1; i >= 0; i--) {
                if (this.slides[i].isPreGenerated) {
                    count++;
                } else {
                    break;
                }
            }
            return count;
        }

        checkAndTriggerPreGen() {
            if (this.slides.length === 0) return;

            const isSliderOn = this.state.getSliderMode() !== false;
            const maxPreGen = isSliderOn ? this.state.getPreGen() : 0;
            if (maxPreGen === 0) return;

            const lastSlide = this.slides[this.slides.length - 1];
            if (lastSlide.isPreview) return;

            const isViewingLatest = this.isViewingLatestSnapshot();
            if (!isViewingLatest) return;

            if (this.component.state.running) return;

            const currentPreGenCount = this.getPreGeneratedCount();
            if (currentPreGenCount >= maxPreGen) {
                return;
            }

            this.triggerPreGen(lastSlide);
        }

        triggerPreGen(baseSlide) {
            if (this.isPreGenerating) return;
            this.isPreGenerating = true;
            this.component._generatePreGen(baseSlide);
        }

        removeActivePreviewSlide() {
            if (this.slides.length === 0) return;
            const lastSlide = this.slides[this.slides.length - 1];
            if (lastSlide && lastSlide.isPreview) {
                if (lastSlide.el) {
                    lastSlide.el.remove();
                }
                this.slides.pop();
                
                // If the user was looking at the deleted preview slide, move the index to the new last slide
                if (this.currentIndex >= this.slides.length) {
                    this.currentIndex = this.slides.length - 1;
                }
                
                // Make sure the current slide configuration is applied permanently
                const currentSlide = this.slides[this.currentIndex];
                if (currentSlide && !currentSlide.isPreview && currentSlide.generationConfig) {
                    this.applySlideSnapshot(currentSlide, false);
                }
                
                this.renderSlides();
            }
        }

        removePreGenSlide() {
            this.removeActivePreviewSlide();
        }

        setStatus(text, mode = "idle") {
            if (this.statusEl) this.statusEl.textContent = text;
            if (this.dotEl) {
                this.dotEl.dataset.mode = mode;
            }
        }

        setProgress(percent) {
            const safe = Math.max(0, Math.min(100, Number(percent) || 0));
            if (this.progressBarEl) this.progressBarEl.style.width = `${safe}%`;
        }

        async openSimpleViewer() {
            const viewer = window.Yuuka?.plugins?.simpleViewer;
            if (!viewer || typeof viewer.open !== "function") {
                console.warn("Simple Viewer plugin not found or not loaded.");
                return;
            }

            const activeSlide = this.slides[this.currentIndex];
            if (!activeSlide || !activeSlide.url) return;

            // Load and filter slides that are completed (non-preview) for simple viewer carousels
            const items = this.slides.filter(s => !s.isPreview && s.url).map(s => ({
                id: s.id,
                imageUrl: s.url,
                pvUrl: s.pvUrl || s.url,
                title: s.generationConfig?.prompt || this.state.prompt || "Live Gen Image",
                generationConfig: s.generationConfig,
                createdAt: s.createdAt
            }));

            let startIndex = items.findIndex(item => {
                if (item.imageUrl === activeSlide.url) return true;
                if (activeSlide.id && item.id === activeSlide.id) return true;
                if (activeSlide.snapshotId && item.generationConfig?.snapshot_id === activeSlide.snapshotId) return true;
                return false;
            });
            if (startIndex === -1) startIndex = 0;

            let isFavorited = false;
            try {
                const favResp = await this.apiClient.getFavorites();
                const favImages = favResp.images || [];
                isFavorited = favImages.some(img => {
                    if (activeSlide.snapshotId) {
                        const favSnapId = img.generationConfig?.snapshot_id;
                        if (favSnapId && favSnapId === activeSlide.snapshotId) return true;
                    }
                    try {
                        const path1 = new URL(img.url, window.location.origin).pathname;
                        const path2 = new URL(activeSlide.url, window.location.origin).pathname;
                        return path1 === path2;
                    } catch (e) {
                        return img.url.includes(activeSlide.url);
                    }
                });
            } catch (e) {
                console.warn("[LiveGen] Không thể kiểm tra trạng thái yêu thích:", e);
            }

            viewer.open({
                items,
                startIndex,
                renderInfoPanel: (item) => `
                    <div style="padding: 12px; font-size: 14px; line-height: 1.4; color: var(--color-primary-text);">
                        <strong style="display: block; margin-bottom: 6px; color: var(--color-accent); font-weight: 600;">Prompt gõ:</strong>
                        <div style="font-family: monospace; white-space: pre-wrap; word-break: break-all; max-height: 140px; overflow-y: auto; background: var(--color-primary-bg); padding: 8px; border-radius: var(--rounded-md); border: 1px solid var(--color-border); font-size: 13px;">${helpers.escapeHtml(item.generationConfig?.prompt || item.title || "")}</div>
                    </div>
                `,
                toolbarButtons: [
                    {
                        icon: "content_copy",
                        title: "Sao chép prompt",
                        onClick: (item) => {
                            const promptText = item.generationConfig?.prompt || item.title || "";
                            if (navigator.clipboard) {
                                navigator.clipboard.writeText(promptText)
                                    .then(() => window.showSuccess?.("Đã sao chép prompt vào bộ nhớ tạm!"))
                                    .catch(() => window.showError?.("Không thể sao chép prompt."));
                            }
                        }
                    },
                    {
                        icon: "favorite",
                        title: "Yêu thích",
                        _initialFilled: isFavorited,
                        onClick: async (item) => {
                            try {
                                const relativeUrl = new URL(item.imageUrl, window.location.href).pathname;
                                const resp = await this.apiClient.addFavorite(relativeUrl);
                                if (resp.status === "success" || resp.status === "exists") {
                                    window.showSuccess?.(resp.message);

                                    const toolbar = document.querySelector('.sv-viewer-toolbar');
                                    if (toolbar) {
                                        const favBtn = toolbar.querySelector('.sv-viewer-toolbar-btn[title="Yêu thích"] .material-symbols-outlined');
                                        if (favBtn) favBtn.style.fontVariationSettings = "'FILL' 1";
                                    }
                                    
                                    const panel = document.querySelector(".live-gen-timeline-panel");
                                    if (panel) {
                                        this.component.timelineUI.loadTimelineTab(panel, "favorite");
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
                                    this.apiClient.getHistory(),
                                    this.apiClient.getFavorites()
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
                                    await this.apiClient.deleteImage(img.id);
                                }

                                window.showSuccess?.("Đã xóa ảnh thành công!");
                                closeViewer();

                                // Update slides
                                matchingItems.forEach(img => {
                                    this.removeImageById(img.id);
                                });

                                const panel = document.querySelector(".live-gen-timeline-panel");
                                if (panel) {
                                    this.component.timelineUI.loadTimelineTab(panel, "history");
                                    this.component.timelineUI.loadTimelineTab(panel, "favorite");
                                }
                            } catch (err) {
                                window.showError?.(`Lỗi xóa ảnh: ${err.message}`);
                            }
                        }
                    }
                ]
            });
        }
    }

    window.Yuuka.liveGen.PreviewUI = LiveGenPreviewUI;
})();
