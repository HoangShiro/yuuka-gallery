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
            this.activeGroupingMode = localStorage.getItem("yuuka-live-gen-group-mode") || "ungroup";
            this.expandedGroupId = null;
            this.tabNeedsReload = { history: false, favorite: false };
            this.selectedImageIds = new Set();
        }

        updateHeaderTitle(panel) {
            const headerTitle = panel.querySelector('.live-gen-settings-panel__header h2');
            if (!headerTitle) return;
            
            if (panel.classList.contains("delete-mode")) {
                const count = this.selectedImageIds.size;
                if (count > 0) {
                    headerTitle.innerHTML = `Chọn để xoá <span style="color: var(--color-accent); font-weight: var(--font-weight-bold); font-variant-numeric: tabular-nums;">(${count})</span>`;
                } else {
                    headerTitle.textContent = "Chọn để xoá";
                }
            } else {
                headerTitle.textContent = "Lịch sử & Yêu thích";
            }
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
                    
                    <div class="live-gen-timeline-group-controls">
                        <button type="button" class="live-gen-group-btn" data-group="ungroup" title="Ungroup">
                            <span class="material-symbols-outlined">grid_view</span>
                        </button>
                        <button type="button" class="live-gen-group-btn" data-group="prompt" title="Group theo Prompt">
                            <span class="material-symbols-outlined">notes</span>
                        </button>
                        <button type="button" class="live-gen-group-btn" data-group="character" title="Group theo Character">
                            <span class="material-symbols-outlined">person</span>
                        </button>
                        <button type="button" class="live-gen-group-btn" data-group="lora" title="Group theo LoRA">
                            <span class="material-symbols-outlined">layers</span>
                        </button>
                    </div>
                </div>

                <div class="live-gen-timeline-content active" data-tab-content="history">
                    <div style="text-align: center; padding: 20px; color: var(--color-secondary-text);">Đang tải lịch sử...</div>
                </div>
                
                <div class="live-gen-timeline-content" data-tab-content="favorite">
                    <div style="text-align: center; padding: 20px; color: var(--color-secondary-text);">Đang tải yêu thích...</div>
                </div>
            `;

            document.body.appendChild(panel);

            // Set active class on current grouping button
            const savedMode = this.activeGroupingMode || "ungroup";
            const activeGroupBtn = panel.querySelector(`.live-gen-group-btn[data-group="${savedMode}"]`);
            if (activeGroupBtn) {
                activeGroupBtn.classList.add("active");
            }

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
                this.updateHeaderTitle(panel);
                if (editBtn) {
                    const editIcon = editBtn.querySelector(".material-symbols-outlined");
                    if (editIcon) editIcon.textContent = "edit";
                    editBtn.title = "Chỉnh sửa";
                }
                if (closeBtn) closeBtn.title = "Đóng";
                this.selectedImageIds.clear();
                panel.querySelectorAll(".timeline-item").forEach(el => el.classList.remove("delete-selected"));
                panel.querySelectorAll(".timeline-group-stack").forEach(el => el.classList.remove("delete-selected"));
            };

            const enterDeleteMode = () => {
                panel.classList.add("delete-mode");
                this.updateHeaderTitle(panel);
                if (editBtn) {
                    const editIcon = editBtn.querySelector(".material-symbols-outlined");
                    if (editIcon) editIcon.textContent = "delete";
                    editBtn.title = "Xóa các ảnh đã chọn";
                }
                if (closeBtn) closeBtn.title = "Thoát chế độ xóa";
            };

            editBtn?.addEventListener("click", async () => {
                if (panel.classList.contains("delete-mode")) {
                    if (this.selectedImageIds.size === 0) {
                        window.showError?.("Vui lòng chọn ít nhất một ảnh để xóa.");
                        return;
                    }
                    
                    const confirmDelete = typeof window.Yuuka?.ui?.confirm === 'function'
                        ? await window.Yuuka.ui.confirm(`Bạn có chắc chắn muốn xóa ${this.selectedImageIds.size} ảnh đã chọn không?`)
                        : window.confirm(`Bạn có chắc chắn muốn xóa ${this.selectedImageIds.size} ảnh đã chọn không?`);
                    
                    if (!confirmDelete) return;
                    
                    try {
                        for (const imgId of this.selectedImageIds) {
                            let url = null;
                            let snapshotId = null;
                            const el = panel.querySelector(`[data-image-id="${imgId}"]`);
                            if (el) {
                                snapshotId = el.dataset.snapshotId || null;
                                const img = el.querySelector("img");
                                if (img) {
                                    url = img.getAttribute("src") || img.src || null;
                                }
                            }

                            await this.apiClient.deleteImage(imgId);
                            if (this.component.previewUI && typeof this.component.previewUI.removeImageById === 'function') {
                                this.component.previewUI.removeImageById(imgId, url, snapshotId);
                            }
                        }
                        window.showSuccess?.(`Đã xóa thành công ${this.selectedImageIds.size} ảnh!`);
                        
                        const activeTabBtn = panel.querySelector(".live-gen-tab-btn.active");
                        const activeTabId = activeTabBtn ? activeTabBtn.dataset.tab : "history";
                        const inactiveTabId = activeTabId === "history" ? "favorite" : "history";

                        this.selectedImageIds.clear();
                        await this.loadTimelineTab(panel, activeTabId);
                        this.tabNeedsReload[inactiveTabId] = true;

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

            // Initialize tab reload flags
            this.tabNeedsReload = { history: false, favorite: true };

            const tabBtns = panel.querySelectorAll(".live-gen-tab-btn");
            tabBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    const previousActiveBtn = panel.querySelector(".live-gen-tab-btn.active");
                    const prevTabId = previousActiveBtn ? previousActiveBtn.dataset.tab : null;
                    const nextTabId = btn.dataset.tab;
                    
                    if (prevTabId === nextTabId) return;

                    tabBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    
                    panel.querySelectorAll(".live-gen-timeline-content").forEach(c => {
                        c.classList.toggle("active", c.dataset.tabContent === nextTabId);
                    });

                    // Collapse active group in previous tab if there was one
                    if (this.expandedGroupId !== null) {
                        this.expandedGroupId = null;
                        if (prevTabId) {
                            this.loadTimelineTab(panel, prevTabId);
                        }
                    }

                    // Lazily load next tab if needed
                    if (this.tabNeedsReload[nextTabId]) {
                        this.tabNeedsReload[nextTabId] = false;
                        this.loadTimelineTab(panel, nextTabId);
                    }
                });
            });

            // Grouping buttons event listeners
            const groupBtns = panel.querySelectorAll(".live-gen-group-btn");
            groupBtns.forEach(btn => {
                btn.addEventListener("click", async () => {
                    groupBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");

                    this.activeGroupingMode = btn.dataset.group;
                    localStorage.setItem("yuuka-live-gen-group-mode", btn.dataset.group);
                    this.expandedGroupId = null;

                    const activeTabBtn = panel.querySelector(".live-gen-tab-btn.active");
                    const activeTabId = activeTabBtn ? activeTabBtn.dataset.tab : "history";
                    const inactiveTabId = activeTabId === "history" ? "favorite" : "history";

                    // Reload active tab immediately
                    this.loadTimelineTab(panel, activeTabId);
                    
                    // Mark inactive tab as dirty
                    this.tabNeedsReload[inactiveTabId] = true;
                });
            });

            // Initial load of the active tab (history by default)
            await this.loadTimelineTab(panel, "history");
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

        getMainPrompt(item) {
            const cfg = item.generationConfig || {};
            let prompt = cfg.prompt || "";
            
            const qualityStr = cfg.quality || "";
            const qualityTags = new Set(qualityStr.split(",").map(t => t.trim().toLowerCase()).filter(Boolean));
            
            const negativeStr = cfg.negative || "";
            const negativeTags = new Set(negativeStr.split(",").map(t => t.trim().toLowerCase()).filter(Boolean));
            
            const tags = prompt.split(",")
                .map(t => t.trim())
                .filter(t => {
                    const tLower = t.toLowerCase();
                    return t && !qualityTags.has(tLower) && !negativeTags.has(tLower);
                });
                
            return tags.join(", ");
        }

        getCharactersInPrompt(prompt, characters) {
            if (!characters || !characters.length) return [];
            const tags = prompt.split(",").map(t => t.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
            const found = [];
            characters.forEach(c => {
                if (!c || !c.name) return;
                const cNameNorm = c.name.trim().toLowerCase().replace(/\s+/g, '_');
                const match = tags.some(tag => {
                    return tag === cNameNorm || tag.startsWith(cNameNorm + '_(') || tag.startsWith(cNameNorm + '(');
                });
                if (match) {
                    found.push(c.name);
                }
            });
            return found;
        }

        getLorasInSnapshot(item) {
            const cfg = item.generationConfig || {};
            let loras = [];
            if (Array.isArray(cfg.lora_names) && cfg.lora_names.length > 0) {
                loras = cfg.lora_names.filter(name => name && name !== 'None');
            } else if (cfg.lora_name && cfg.lora_name !== 'None') {
                loras = [cfg.lora_name];
            }
            return loras;
        }

        groupItemsByMode(items, mode) {
            const subGroups = {};
            if (mode === "prompt") {
                items.forEach(item => {
                    const key = this.getMainPrompt(item) || "Không có prompt";
                    if (!subGroups[key]) subGroups[key] = [];
                    subGroups[key].push(item);
                });
            } else if (mode === "character") {
                const charactersList = Array.isArray(this.component.characters) ? this.component.characters : [];
                items.forEach(item => {
                    const prompt = item.generationConfig?.prompt || "";
                    const matchedChars = this.getCharactersInPrompt(prompt, charactersList);
                    if (matchedChars.length === 0) {
                        const key = "Không có nhân vật";
                        if (!subGroups[key]) subGroups[key] = [];
                        subGroups[key].push(item);
                    } else {
                        matchedChars.forEach(charName => {
                            const key = charName;
                            if (!subGroups[key]) subGroups[key] = [];
                            subGroups[key].push(item);
                        });
                    }
                });
            } else if (mode === "lora") {
                items.forEach(item => {
                    const matchedLoras = this.getLorasInSnapshot(item);
                    if (matchedLoras.length === 0) {
                        const key = "Không dùng LoRA";
                        if (!subGroups[key]) subGroups[key] = [];
                        subGroups[key].push(item);
                    } else {
                        matchedLoras.forEach(loraName => {
                            const key = loraName;
                            if (!subGroups[key]) subGroups[key] = [];
                            subGroups[key].push(item);
                        });
                    }
                });
            }
            return subGroups;
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
                const mode = this.activeGroupingMode || "ungroup";
                
                for (const [dayTitle, items] of Object.entries(groups)) {
                    const dayGroup = document.createElement("div");
                    dayGroup.className = "timeline-day-group";

                    const header = document.createElement("div");
                    header.className = "timeline-day-header";
                    header.textContent = dayTitle;
                    dayGroup.appendChild(header);

                    const grid = document.createElement("div");
                    grid.className = "timeline-grid";

                    if (mode === "ungroup") {
                        items.forEach(item => {
                            const div = document.createElement("div");
                            div.className = "timeline-item animate-fade-in";
                            
                            const snapId = item.generationConfig?.snapshot_id;
                            if (snapId) div.dataset.snapshotId = snapId;
                            const isSelected = snapId && this.state.config?.snapshot_id === snapId;
                            if (isSelected) div.classList.add("selected");
                            div.dataset.imageId = item.id;

                            const h = item.generationConfig?.hires_enabled;
                            const isHires = h === true || h === 'true' || h === '1' || h === 'yes' || item.hasHires;

                            if (isHires) {
                                div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy"><span class="timeline-item__badge material-symbols-outlined" title="High Resolution">high_quality</span>`;
                            } else {
                                div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy">`;
                            }

                            const isSelectedForDelete = this.selectedImageIds.has(item.id);
                            if (isSelectedForDelete) {
                                div.classList.add("delete-selected");
                            }

                            div.addEventListener("click", () => {
                                if (panel.classList.contains("delete-mode")) {
                                    if (this.selectedImageIds.has(item.id)) {
                                        this.selectedImageIds.delete(item.id);
                                        div.classList.remove("delete-selected");
                                    } else {
                                        this.selectedImageIds.add(item.id);
                                        div.classList.add("delete-selected");
                                    }
                                    this.updateHeaderTitle(panel);
                                } else {
                                    this.applySnapshot(item, panel);
                                }
                            });
                            grid.appendChild(div);
                        });
                    } else {
                        const subGroups = this.groupItemsByMode(items, mode);
                        for (const [subGroupKey, subGroupItems] of Object.entries(subGroups)) {
                            if (subGroupItems.length === 1) {
                                const item = subGroupItems[0];
                                const div = document.createElement("div");
                                div.className = "timeline-item animate-fade-in";
                                div.title = `Nhóm: ${subGroupKey}`;
                                
                                const snapId = item.generationConfig?.snapshot_id;
                                if (snapId) div.dataset.snapshotId = snapId;
                                const isSelected = snapId && this.state.config?.snapshot_id === snapId;
                                if (isSelected) div.classList.add("selected");
                                div.dataset.imageId = item.id;

                                const h = item.generationConfig?.hires_enabled;
                                const isHires = h === true || h === 'true' || h === '1' || h === 'yes' || item.hasHires;

                                if (isHires) {
                                    div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy"><span class="timeline-item__badge material-symbols-outlined" title="High Resolution">high_quality</span>`;
                                } else {
                                    div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy">`;
                                }

                                const isSelectedForDelete = this.selectedImageIds.has(item.id);
                                if (isSelectedForDelete) {
                                    div.classList.add("delete-selected");
                                }

                                div.addEventListener("click", () => {
                                    if (panel.classList.contains("delete-mode")) {
                                        if (this.selectedImageIds.has(item.id)) {
                                            this.selectedImageIds.delete(item.id);
                                            div.classList.remove("delete-selected");
                                        } else {
                                            this.selectedImageIds.add(item.id);
                                            div.classList.add("delete-selected");
                                        }
                                        this.updateHeaderTitle(panel);
                                    } else {
                                        this.applySnapshot(item, panel);
                                    }
                                });
                                grid.appendChild(div);
                            } else {
                                const groupId = `${dayTitle}_${subGroupKey}`;
                                const isExpanded = this.expandedGroupId === groupId;
                                
                                if (!isExpanded) {
                                    const div = document.createElement("div");
                                    div.className = "timeline-group-stack animate-fade-in";
                                    div.dataset.groupId = groupId;
                                    div.title = `${subGroupKey} (${subGroupItems.length} ảnh)`;
                                    
                                    const item1 = subGroupItems[0];
                                    const item2 = subGroupItems[1];
                                    const urlFront = item1.pv_url || item1.url;
                                    const urlBack = item2.pv_url || item2.url;
                                    
                                    div.innerHTML = `
                                        <div class="timeline-group-stack__layer-back"><img src="${urlBack}" alt="Back thumbnail" loading="lazy"></div>
                                        <div class="timeline-group-stack__layer-front"><img src="${urlFront}" alt="Front thumbnail" loading="lazy"><span class="timeline-group-stack__count">${subGroupItems.length}</span></div>
                                    `;

                                    const allSelected = subGroupItems.every(item => this.selectedImageIds.has(item.id));
                                    if (allSelected) {
                                        div.classList.add("delete-selected");
                                    }
                                    
                                    div.addEventListener("click", () => {
                                        this.expandedGroupId = groupId;
                                        this.loadTimelineTab(panel, tabType);
                                    });
                                    grid.appendChild(div);
                                } else {
                                    const headerRow = document.createElement("div");
                                    headerRow.className = "timeline-expanded-group-header animate-fade-in";
                                    headerRow.style.gridColumn = "span 3";
                                    
                                    let iconHtml = "";
                                    let characterImgUrl = null;
                                    if (mode === "character" && subGroupKey !== "Không có nhân vật") {
                                        const charactersList = Array.isArray(this.component.characters) ? this.component.characters : [];
                                        const foundChar = charactersList.find(c => c && c.name && c.name.toLowerCase() === subGroupKey.toLowerCase());
                                        if (foundChar) characterImgUrl = `/image/${foundChar.hash}`;
                                    }

                                    if (characterImgUrl) {
                                        iconHtml = `<div class="timeline-expanded-group-header__char-thumb"><img src="${characterImgUrl}" alt="${window.Yuuka.liveGen.helpers.escapeHtml(subGroupKey)}"></div>`;
                                    } else {
                                        let iconName = "folder_open";
                                        if (mode === "prompt") iconName = "notes";
                                        else if (mode === "character") iconName = "person";
                                        else if (mode === "lora") iconName = "layers";
                                        iconHtml = `<span class="material-symbols-outlined">${iconName}</span>`;
                                    }
                                    
                                    headerRow.innerHTML = `
                                        ${iconHtml}
                                        <span class="group-title-text" title="${window.Yuuka.liveGen.helpers.escapeHtml(subGroupKey)}">${window.Yuuka.liveGen.helpers.escapeHtml(subGroupKey)}</span>
                                        <button type="button" class="live-gen-collapse-btn hide-in-delete-mode"><span class="material-symbols-outlined">expand_less</span> Thu nhỏ</button>
                                        <button type="button" class="live-gen-select-group-btn show-in-delete-mode"><span class="material-symbols-outlined">library_add_check</span> Chọn cả nhóm</button>
                                    `;
                                    
                                    headerRow.querySelector(".live-gen-collapse-btn").addEventListener("click", (e) => {
                                        e.stopPropagation();
                                        this.expandedGroupId = null;
                                        this.loadTimelineTab(panel, tabType);
                                    });
                                    
                                    headerRow.querySelector(".live-gen-select-group-btn").addEventListener("click", (e) => {
                                        e.stopPropagation();
                                        const currentlyAllSelected = subGroupItems.every(item => this.selectedImageIds.has(item.id));
                                        subGroupItems.forEach(item => {
                                            if (currentlyAllSelected) this.selectedImageIds.delete(item.id);
                                            else this.selectedImageIds.add(item.id);
                                        });
                                        this.loadTimelineTab(panel, tabType);
                                    });
                                    
                                    grid.appendChild(headerRow);
                                    
                                    subGroupItems.forEach(item => {
                                        const div = document.createElement("div");
                                        div.className = "timeline-item in-expanded-group animate-fade-in";
                                        
                                        const snapId = item.generationConfig?.snapshot_id;
                                        if (snapId) div.dataset.snapshotId = snapId;
                                        const isSelected = snapId && this.state.config?.snapshot_id === snapId;
                                        if (isSelected) div.classList.add("selected");
                                        div.dataset.imageId = item.id;

                                        const h = item.generationConfig?.hires_enabled;
                                        const isHires = h === true || h === 'true' || h === '1' || h === 'yes' || item.hasHires;

                                        if (isHires) {
                                            div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy"><span class="timeline-item__badge material-symbols-outlined" title="High Resolution">high_quality</span>`;
                                        } else {
                                            div.innerHTML = `<img src="${item.pv_url || item.url}" alt="Preview" loading="lazy">`;
                                        }

                                        const isSelectedForDelete = this.selectedImageIds.has(item.id);
                                        if (isSelectedForDelete) div.classList.add("delete-selected");

                                        div.addEventListener("click", () => {
                                            if (panel.classList.contains("delete-mode")) {
                                                if (this.selectedImageIds.has(item.id)) this.selectedImageIds.delete(item.id);
                                                else this.selectedImageIds.add(item.id);
                                                this.loadTimelineTab(panel, tabType);
                                            } else {
                                                this.applySnapshot(item, panel);
                                            }
                                        });
                                        grid.appendChild(div);
                                    });
                                    
                                    const footerRow = document.createElement("div");
                                    footerRow.className = "timeline-expanded-group-footer animate-fade-in";
                                    footerRow.style.gridColumn = "span 3";
                                    footerRow.style.height = "1px";
                                    footerRow.style.background = "var(--color-border)";
                                    footerRow.style.margin = "8px 0";
                                    grid.appendChild(footerRow);
                                }
                            }
                        }
                    }

                    dayGroup.appendChild(grid);
                    contentEl.appendChild(dayGroup);

                    header.addEventListener("click", () => {
                        if (!panel.classList.contains("delete-mode")) return;
                        const currentlyAllSelected = items.every(item => this.selectedImageIds.has(item.id));
                        items.forEach(item => {
                            if (currentlyAllSelected) this.selectedImageIds.delete(item.id);
                            else this.selectedImageIds.add(item.id);
                        });
                        this.loadTimelineTab(panel, tabType);
                    });
                }
                this.updateHeaderTitle(panel);
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

            if (!this.component.previewUI.slideToImage(item.url, item.generationConfig?.snapshot_id)) {
                this.component.previewUI.showImage(item.url, false);
            }
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
