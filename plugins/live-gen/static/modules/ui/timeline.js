(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const helpers = window.Yuuka.liveGen.helpers;

    class LiveGenTimelineUI {
        constructor(component) {
            this.component = component;
            this.state = component.state;
            this.apiClient = component.apiClient;
            this.wsClient = component.wsClient;
        }

        async openTimeline() {
            const existingSettings = document.querySelector(".live-gen-settings-panel");
            if (existingSettings) {
                existingSettings.remove();
                document.body.classList.remove("live-gen-settings-open");
                document.body.classList.add("live-gen-timeline-open");
            }

            const existingPanel = document.querySelector(".live-gen-timeline-panel");
            if (existingPanel) {
                this.closeTimeline(existingPanel);
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
                if (headerTitle) headerTitle.textContent = "Lịch sử & Yêu thích";
                if (editBtn) {
                    const editIcon = editBtn.querySelector(".material-symbols-outlined");
                    if (editIcon) editIcon.textContent = "edit";
                    editBtn.title = "Chỉnh sửa";
                }
                if (closeBtn) closeBtn.title = "Đóng";
                panel.querySelectorAll(".timeline-item").forEach(el => el.classList.remove("delete-selected"));
            };

            const enterDeleteMode = () => {
                panel.classList.add("delete-mode");
                if (headerTitle) headerTitle.textContent = "Chọn để xoá";
                if (editBtn) {
                    const editIcon = editBtn.querySelector(".material-symbols-outlined");
                    if (editIcon) editIcon.textContent = "delete";
                    editBtn.title = "Xóa các ảnh đã chọn";
                }
                if (closeBtn) closeBtn.title = "Thoát chế độ xóa";
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
                                await this.apiClient.deleteImage(imgId);
                            }
                        }
                        window.showSuccess?.(`Đã xóa thành công ${selectedItems.length} ảnh!`);
                        await Promise.all([
                            this.loadTimelineTab(panel, "history"),
                            this.loadTimelineTab(panel, "favorite")
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
                    this.closeTimeline(panel);
                }
            });

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

            await Promise.all([
                this.loadTimelineTab(panel, "history"),
                this.loadTimelineTab(panel, "favorite")
            ]);
        }

        closeTimeline(panel) {
            panel.classList.remove("open");
            document.body.classList.remove("live-gen-timeline-open");
            setTimeout(() => {
                panel.remove();
            }, 300);
            
            const navibar = window.Yuuka?.services?.navibar;
            if (navibar && !navibar._isSearchActive && !this.component.destroyed) {
                setTimeout(() => this.component.promptUI.openPromptMode(), 0);
            }
        }

        async loadTimelineTab(panel, tabType) {
            const contentEl = panel.querySelector(`[data-tab-content="${tabType}"]`);
            if (!contentEl) return;

            try {
                const resp = await (tabType === "history" ? this.apiClient.getHistory() : this.apiClient.getFavorites());
                let images = resp.images || [];

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
                        
                        const snapId = item.generationConfig?.snapshot_id;
                        if (snapId) {
                            div.dataset.snapshotId = snapId;
                        }
                        const isSelected = snapId && this.state.config?.snapshot_id === snapId;
                        if (isSelected) {
                            div.classList.add("selected");
                        }

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
                                this.applySnapshot(item, panel);
                            }
                        });
                        grid.appendChild(div);
                    });

                    dayGroup.appendChild(grid);
                    contentEl.appendChild(dayGroup);

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

        async applySnapshot(item, panel) {
            if (!item || !item.generationConfig) return;
            const cfg = { ...item.generationConfig };

            const isHires = cfg.hires_enabled === true || cfg.hires_enabled === 'true' || cfg.hires_enabled === 1 || cfg.hires_enabled === '1' || cfg.hires_enabled === 'yes';
            cfg.hires_enabled = isHires;

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

            this.state.prompt = cfg.prompt || "";
            this.state.setPrompt(this.state.prompt);
            
            this.state.seed = Number(cfg.seed) || 0;
            this.component._applyConfig(cfg);
            
            const textarea = document.querySelector(".live-gen-prompt-input");
            if (textarea) {
                textarea.value = this.state.prompt;
                this.component.promptUI.autoGrow(textarea);
            }

            this.component.previewUI.showImage(item.url, false);
            this.state.lastFinalImageBase64 = null;

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

            try {
                const response = await fetch(item.url);
                const blob = await response.blob();
                this.state.lastFinalImageBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch (err) {
                console.warn("⚠️ Không thể chuyển đổi ảnh sang Base64 cho Img2Img: ", err);
            }

            if (window.innerWidth <= 640) {
                this.closeTimeline(panel);
            }
        }
    }

    window.Yuuka.liveGen.TimelineUI = LiveGenTimelineUI;
})();
