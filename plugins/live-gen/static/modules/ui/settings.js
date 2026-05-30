(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const helpers = window.Yuuka.liveGen.helpers;

    class LiveGenSettingsUI {
        constructor(component) {
            this.component = component;
            this.state = component.state;
            this.apiClient = component.apiClient;
            this.wsClient = component.wsClient;
            this.loraMetadataMap = {};
            this.loraMetadataPromise = null;
        }

        async openSettings() {
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }

            const existingTimeline = document.querySelector(".live-gen-timeline-panel");
            if (existingTimeline) {
                existingTimeline.remove();
                document.body.classList.remove("live-gen-timeline-open");
                document.body.classList.add("live-gen-settings-open");
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
                if (navibar && !navibar._isSearchActive && !this.component.destroyed) {
                    setTimeout(() => this.component.promptUI.openPromptMode(), 0);
                }
            };

            panel.querySelector('[data-action="close"]').addEventListener("click", close);
            panel.querySelector('[data-action="close"]').addEventListener("mousedown", (e) => e.preventDefault());

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
                choices = await this.apiClient.getComfyInfo();
            } catch (err) {
                console.error("Could not fetch ComfyUI backend options:", err);
            }

            const formEl = panel.querySelector(".live-gen-settings-panel__form");
            const cfg = this.state.config || {};

            const loraDefaults = choices.lora_defaults || { lora_strength_model: 0.9, lora_strength_clip: 1.0 };
            
            const ensureLoraMetadata = () => {
                if (Object.keys(this.loraMetadataMap).length) return Promise.resolve(this.loraMetadataMap);
                if (this.loraMetadataPromise) return this.loraMetadataPromise;
                if (this.component.api['lora-downloader'] && typeof this.component.api['lora-downloader'].get === 'function') {
                    this.loraMetadataPromise = this.component.api['lora-downloader'].get('/lora-data')
                        .then(resp => { 
                            if (resp && typeof resp.models === 'object') this.loraMetadataMap = resp.models; 
                            return this.loraMetadataMap; 
                        })
                        .catch(err => { 
                            console.warn('[LiveGen] Unable to fetch LoRA metadata:', err); 
                            return this.loraMetadataMap; 
                        });
                } else {
                    this.loraMetadataPromise = Promise.resolve(this.loraMetadataMap);
                }
                return this.loraMetadataPromise;
            };

            const getModelData = (metadata) => {
                if (!metadata) return null;
                const raw = metadata.model_data;
                if (!raw) return null;
                if (typeof raw === 'object') return raw;
                if (typeof raw === 'string') {
                    try { return JSON.parse(raw); } catch (err) { console.warn('[LiveGen] Unable to parse LoRA metadata:', err); }
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
                if (primary) return helpers.prettifyLabel(primary);
                const tags = extractModelTags(metadata);
                if (tags.length) return helpers.prettifyLabel(tags[0]);
                const base = (metadata.name || metadata.filename || fallback || '').trim();
                if (!base) return fallback || 'LoRA';
                const words = base.split(/\s+/).filter(Boolean).slice(0, 2);
                return helpers.prettifyLabel(words.length ? words.join(' ') : base);
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
                const direct = (this.loraMetadataMap && typeof this.loraMetadataMap === 'object') ? this.loraMetadataMap[value] : undefined;
                if (direct) return direct;
                const list = Object.values(this.loraMetadataMap || {});
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
                        <div class="lora-card__thumb">${thumbUrl ? `<img src="${helpers.escapeAttr(thumbUrl)}" alt="${helpers.escapeAttr(displayName)}" loading="lazy">` : ''}</div>
                        <div class="lora-card__meta">
                            <div class="lora-card__title">${helpers.escapeHtml(helpers.truncateText(displayName, 32))}</div>
                            <div class="lora-card__subtitle">${helpers.escapeHtml(helpers.truncateText(subtitle, 32))}</div>
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

            formEl.innerHTML = `
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
                        <div class="lora-multi-container" data-role="lora-multi-container"></div>
                        <div class="lora-multi-add" data-role="lora-multi-add">
                            <button type="button" class="lora-multi-add__btn" title="Thêm LoRA (+)">
                                <span class="material-symbols-outlined">add</span>
                            </button>
                        </div>
                    </div>
                </div>

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
                            <span class="live-gen-slider-value" id="preview-blur-val">${(() => { const v = this.state.getPreviewBlur(); return v === 0 ? 'OFF' : v.toFixed(1) + 'px'; })()}</span>
                        </div>
                        <input type="range" min="0" max="5" step="0.5" data-role="preview_blur" value="${this.state.getPreviewBlur()}" oninput="const v = parseFloat(this.value); document.getElementById('preview-blur-val').innerText = v === 0 ? 'OFF' : v.toFixed(1) + 'px'; localStorage.setItem('yuuka.liveGen.previewBlur', this.value);">
                    </label>
                </div>

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

            if (document.activeElement && formEl.contains(document.activeElement)) {
                document.activeElement.blur();
            }

            const loraContainer = formEl.querySelector('[data-role="lora-multi-container"]');

            const createLoraWrapperHTML = (index, value, smVal, scVal) => {
                const valEsc = helpers.escapeAttr(value || 'None');
                const sm = (typeof smVal === 'number' && !Number.isNaN(smVal)) ? smVal : (Number(loraDefaults.lora_strength_model) || 0.9);
                const sc = (typeof scVal === 'number' && !Number.isNaN(scVal)) ? scVal : (Number(loraDefaults.lora_strength_clip) || 1.0);
                return `
                    <div class="lora-multi-wrapper" data-role="lora-multi-wrapper" data-index="${index}" data-empty="${(!value || value === 'None') ? 'true' : 'false'}">
                        <div class="form-group lora-select-group" data-role="lora-select-group">
                            <label>LoRA #${index + 1} <button type="button" class="lora-remove-btn" data-remove style="display:inline-flex" title="Xóa LoRA">&times;</button></label>
                            <button type="button" class="lora-select-toggle" aria-haspopup="listbox" aria-expanded="false">
                                <div class="lora-select-toggle__thumb"></div>
                                <div class="lora-select-toggle__meta">
                                    <span class="lora-select-toggle__title">${(value && value !== 'None') ? helpers.escapeHtml(value) : 'Chọn một LoRA'}</span>
                                    <span class="lora-select-toggle__subtitle">${(value && value !== 'None') ? helpers.escapeHtml(value) : 'Hoặc tải mới bằng Lora-downloader'}</span>
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
                const meta = this.loraMetadataMap[loraName] || findLoraMetadata(loraName);
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
                        const groupText = group.trim().toLowerCase();
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
                    body.textContent = group;
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
                    const meta = !isNone ? (this.loraMetadataMap[normalized] || findLoraMetadata(normalized)) : null;
                    const thumbUrl = meta ? getLoraThumbnailUrl(meta) : null;
                    if (thumbEl) {
                        thumbEl.innerHTML = (!isNone && thumbUrl)
                            ? `<img src="${helpers.escapeAttr(thumbUrl)}" alt="${helpers.escapeAttr(displayName || normalized)}" loading="lazy">`
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
                            const meta = this.loraMetadataMap[val] || findLoraMetadata(val);
                            const thumbUrl = meta ? getLoraThumbnailUrl(meta) : null;
                            if (thumbEl) {
                                thumbEl.innerHTML = thumbUrl ? `<img src="${helpers.escapeAttr(thumbUrl)}" alt="${helpers.escapeAttr(displayName)}" loading="lazy">` : '';
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

            let saveTimeout = null;
            const triggerAutoSave = () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => executeAutoSave(), 200);
            };

            const executeAutoSave = async () => {
                if (this.component.destroyed) return;
                const getVal = (selector) => formEl.querySelector(selector)?.value;
                const getNum = (selector) => {
                    const val = getVal(selector);
                    return val != null ? Number(val) : null;
                };

                const seed = Math.max(0, Math.floor(getNum('[data-role="seed"]') || 0));
                this.state.seed = seed;

                const sizeVal = getVal('[data-role="size"]');
                const [width, height] = sizeVal.split("x").map(Number);

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
                            if (raw) groups.push(raw.split(', ').map(s => s.trim()));
                        }
                    });
                    const formatted = groups.length ? `(${groups.map(g => g.join(', ')).join(', ')})` : '';
                    activeLoraEntries.push({ name: loraName, groupText: formatted, groups, sm: smVal, sc: scVal });
                });

                const loraNames = activeLoraEntries.map(e => e.name);
                const loraChain = activeLoraEntries.map(e => ({ lora_name: e.name, strength_model: e.sm, strength_clip: e.sc }));
                const multiTagsParts = activeLoraEntries.filter(e => e.groupText).map(e => e.groupText);
                const multiLoraPromptTags = multiTagsParts.join(', ');
                const multiLoraPromptGroups = activeLoraEntries.map(e => e.groups);

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
                    lora_name: loraNames[0] || 'None',
                    lora_strength_model: activeLoraEntries[0]?.sm ?? 0.9,
                    lora_strength_clip: activeLoraEntries[0]?.sc ?? 1.0,
                    lora_names: loraNames,
                    lora_chain: loraChain,
                    multi_lora_prompt_tags: multiLoraPromptTags,
                    multi_lora_prompt_groups: multiLoraPromptGroups
                };

                Object.keys(newConfig).forEach(k => {
                    if (newConfig[k] === undefined || (typeof newConfig[k] === 'number' && Number.isNaN(newConfig[k]))) {
                        delete newConfig[k];
                    }
                });

                try {
                    const saved = await this.apiClient.saveConfig(newConfig);
                    this.component._applyConfig(saved.config);
                    this.wsClient.send({ type: "update_config", config: saved.config });
                    this.component.lastGeneratedPrompt = "";
                    this.component._scheduleGeneration(15);
                } catch (err) {
                    console.error("Auto-save failed:", err);
                }
            };

            const attachAutoSaveListeners = () => {
                formEl.querySelectorAll('select').forEach(sel => {
                    sel.removeEventListener('change', triggerAutoSave);
                    sel.addEventListener('change', triggerAutoSave);
                });
                formEl.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(inp => {
                    inp.removeEventListener('blur', triggerAutoSave);
                    inp.addEventListener('blur', triggerAutoSave);
                });
                formEl.querySelectorAll('input[type="range"]').forEach(sld => {
                    sld.removeEventListener('blur', triggerAutoSave);
                    sld.addEventListener('blur', triggerAutoSave);
                    sld.removeEventListener('change', triggerAutoSave);
                    sld.addEventListener('change', triggerAutoSave);
                });
            };

            attachAutoSaveListeners();
        }
    }

    window.Yuuka.liveGen.SettingsUI = LiveGenSettingsUI;
})();
