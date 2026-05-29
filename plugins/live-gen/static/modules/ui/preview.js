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
        }

        initDOMElements() {
            this.imageEl = this.component.container.querySelector('[data-role="image"]');
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

            this.imageEl?.addEventListener("click", () => {
                if (!this.imageEl.src || this.imageEl.src === window.location.href || !this.imageEl.classList.contains("is-loaded")) return;
                this.openSimpleViewer();
            });

            this.setStatus("Đang chuẩn bị...", "idle");
        }

        showImage(src, isPreview) {
            if (!src || !this.imageEl) return;
            const wasPreview = this.imageEl.classList.contains("is-preview");
            if (isPreview) {
                this.imageEl.classList.remove("is-preview-fading");
                const blur = this.state.getPreviewBlur();
                this.imageEl.style.setProperty("--preview-blur", `${blur}px`);
            } else {
                this.imageEl.classList.toggle("is-preview-fading", wasPreview);
            }
            this.imageEl.src = src;
            this.imageEl.classList.toggle("is-preview", !!isPreview);
            this.imageEl.classList.add("is-loaded");
            this.emptyEl?.classList.add("is-hidden");
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

            const currentSrc = this.imageEl.src;
            if (!currentSrc) return;

            let isFavorited = false;
            try {
                const currentPath = new URL(currentSrc, window.location.href).pathname;
                const currentSnapshotId = this.state.config?.snapshot_id;
                const favResp = await this.apiClient.getFavorites();
                const favImages = favResp.images || [];
                isFavorited = favImages.some(img => {
                    if (currentSnapshotId) {
                        const favSnapId = img.generationConfig?.snapshot_id;
                        if (favSnapId && favSnapId === currentSnapshotId) return true;
                    }
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
                        <div style="font-family: monospace; white-space: pre-wrap; word-break: break-all; max-height: 140px; overflow-y: auto; background: var(--color-primary-bg); padding: 8px; border-radius: var(--rounded-md); border: 1px solid var(--color-border); font-size: 13px;">${helpers.escapeHtml(item.title)}</div>
                    </div>
                `,
                toolbarButtons: [
                    {
                        icon: "content_copy",
                        title: "Sao chép prompt",
                        onClick: () => {
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

                                try {
                                    const currentPreviewUrl = new URL(this.imageEl.src, window.location.href).pathname;
                                    if (currentPreviewUrl === relativeUrl) {
                                        this.imageEl.removeAttribute("src");
                                        this.imageEl.classList.remove("is-loaded");
                                        this.emptyEl?.classList.remove("is-hidden");
                                        if (this.state.config) delete this.state.config.snapshot_id;
                                    }
                                } catch (e) {}

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
