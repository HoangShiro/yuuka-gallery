(function () {
    const ensureNamespace = () => {
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.plugins = window.Yuuka.plugins || {};
    };

    const ct = (key, label, value) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><textarea id="cfg-${key}" name="${key}" rows="1">${value || ''}</textarea></div>`;
    const cs = (key, label, value, min, max, step) =>
        `<div class="form-group form-group-slider"><label for="cfg-${key}">${label}: <span id="val-${key}">${value}</span></label><input type="range" id="cfg-${key}" name="${key}" value="${value}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${key}').textContent = this.value"></div>`;
    const cse = (key, label, value, options = []) => {
        const optionsHTML = (options || []).map(opt => {
            if (!opt) return '';
            const optValue = opt.value ?? '';
            const optName = opt.name ?? optValue;
            const selected = String(optValue) === String(value) ? ' selected' : '';
            const dataAttrs = (opt.dataAttrs && typeof opt.dataAttrs === 'object')
                ? Object.entries(opt.dataAttrs)
                    .map(([attr, attrValue]) => {
                        const kebab = attr.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
                        return ` data-${kebab}="${String(attrValue)}"`;
                    })
                    .join('')
                : '';
            return `<option value="${optValue}"${selected}${dataAttrs}>${optName}</option>`;
        }).join('');
        return `<div class="form-group"><label for="cfg-${key}">${label}</label><select id="cfg-${key}" name="${key}">${optionsHTML}</select></div>`;
    };
    const ciwb = (key, label, value) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><div class="input-with-button"><input type="text" id="cfg-${key}" name="${key}" value="${value || ''}"><button type="button" class="connect-btn">Connect</button></div></div>`;

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
    const normalizeStoredGroup = (group) => {
        if (typeof group !== 'string') return '';
        const cleaned = group.replace(/^\(|\)$/g, '');
        return parseWordGroup(cleaned).map(normalizeTag).join(',');
    };
    const buildSearchTokensFromText = (text) => {
        if (typeof text !== 'string') return [];
        const tokens = new Set();
        const addToken = (value) => {
            if (typeof value !== 'string') return;
            const trimmed = value.trim().toLowerCase();
            if (!trimmed || trimmed.length < 2) return;
            tokens.add(trimmed);
        };
        addToken(text);
        text
            .split(/[\s,;:|\/\\\-]+/)
            .forEach(addToken);
        return Array.from(tokens);
    };

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

    const getModelData = (metadata) => {
        if (!metadata) return null;
        const raw = metadata.model_data;
        if (!raw) return null;
        if (typeof raw === 'object') return raw;
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw);
            } catch (err) {
                console.warn('[AlbumModal] Unable to parse LoRA metadata:', err);
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
    const prettifyLabel = (value) => {
        if (typeof value !== 'string') return '';
        return value
            .replace(/[_-]+/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
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
    const collectModelImages = (metadata) => {
        if (!metadata) return [];
        const results = [];
        const seen = new Set();
        const addUrl = (url) => {
            if (typeof url !== 'string') return;
            const trimmed = url.trim();
            if (!trimmed || seen.has(trimmed)) return;
            seen.add(trimmed);
            results.push({
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
        return results;
    };
    const openSimpleViewer = (metadata, initialUrl = null) => {
        if (!metadata) {
            showError('Không tìm thấy dữ liệu LoRA để hiện preview.');
            return;
        }
        const viewer = window?.Yuuka?.plugins?.simpleViewer;
        if (!viewer || typeof viewer.open !== 'function') {
            showError('Simple viewer chưa sẵn sàng.');
            return;
        }
        const items = collectModelImages(metadata);
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
    };

    ensureNamespace();


    async function openSettingsModal(options) {
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop settings-modal-backdrop';
        if (options.modalClass) {
            modal.classList.add(options.modalClass);
        }
        document.body.appendChild(modal);
        modal.innerHTML = `<div class="modal-dialog"><h3>Đang tải...</h3></div>`;
        const cleanupFns = [];
        const close = () => {
            cleanupFns.forEach(fn => {
                try { fn(); } catch (err) { /* ignore cleanup errors */ }
            });
            modal.remove();
        };

        try {
            const infoPayload = await options.fetchInfo();
            const { last_config, global_choices } = infoPayload;
            // Prefer backend-provided normalized chain; otherwise derive from last_config
            const deriveNormalizedChain = (cfg) => {
                const result = [];
                if (!cfg || typeof cfg !== 'object') return result;
                const smDef = Number((global_choices?.lora_defaults?.lora_strength_model) ?? last_config?.lora_strength_model ?? 1.0) || 1.0;
                const scDef = Number((global_choices?.lora_defaults?.lora_strength_clip) ?? last_config?.lora_strength_clip ?? 1.0) || 1.0;
                const pushEntry = (name, sm, sc) => {
                    const n = (name || '').trim();
                    if (!n || n.toLowerCase() === 'none') return;
                    let _sm = parseFloat(sm);
                    let _sc = parseFloat(sc);
                    if (Number.isNaN(_sm)) _sm = smDef;
                    if (Number.isNaN(_sc)) _sc = scDef;
                    result.push({ lora_name: n, strength_model: _sm, strength_clip: _sc });
                };
                const chain = cfg.lora_chain;
                if (Array.isArray(chain) && chain.length) {
                    chain.forEach(item => {
                        if (!item) return;
                        if (typeof item === 'string') {
                            pushEntry(item, smDef, scDef);
                        } else if (typeof item === 'object') {
                            const name = item.name ?? item.lora_name ?? '';
                            const sm = item.strength_model ?? item.lora_strength_model ?? smDef;
                            const sc = item.strength_clip ?? item.lora_strength_clip ?? scDef;
                            pushEntry(String(name), sm, sc);
                        }
                    });
                    return result;
                }
                // Fallback: lora_names array or CSV
                const namesRaw = cfg.lora_names ?? cfg.multi_lora_names ?? cfg.lora_name;
                if (Array.isArray(namesRaw)) {
                    namesRaw.forEach(n => pushEntry(String(n || ''), smDef, scDef));
                } else if (typeof namesRaw === 'string') {
                    namesRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(n => pushEntry(n, smDef, scDef));
                }
                return result;
            };
            let normalizedLoraChain = Array.isArray(infoPayload?.normalized_lora_chain) ? infoPayload.normalized_lora_chain : [];
            if (!normalizedLoraChain || !normalizedLoraChain.length) {
                normalizedLoraChain = deriveNormalizedChain(last_config || {});
            }
            const loraNamesFromInfo = Array.isArray(infoPayload?.lora_names) ? infoPayload.lora_names : [];
            // --- Tag dataset global cache (non-blocking) ---
            const tagService = (() => {
                window.Yuuka = window.Yuuka || {}; window.Yuuka.services = window.Yuuka.services || {};
                if (!window.Yuuka.services.tagDataset) {
                    window.Yuuka.services.tagDataset = {
                        data: null,
                        promise: null,
                        lastFetched: 0,
                        ttl: 1000 * 60 * 60 * 6, // 6h default (rarely changes per user requirement)
                        prefetch(apiObj) {
                            if (this.data && (Date.now() - this.lastFetched) < this.ttl) return Promise.resolve(this.data);
                            if (this.promise) return this.promise;
                            if (!apiObj || typeof apiObj.getTags !== 'function') {
                                this.promise = Promise.resolve([]);
                                return this.promise;
                            }
                            this.promise = apiObj.getTags()
                                .then(arr => {
                                    if (Array.isArray(arr)) {
                                        this.data = arr;
                                        this.lastFetched = Date.now();
                                    } else {
                                        this.data = [];
                                    }
                                    return this.data;
                                })
                                .catch(err => { console.warn('[AlbumModal] tag prefetch failed:', err); return this.data || []; })
                                .finally(() => { this.promise = null; });
                            return this.promise;
                        },
                        get() { return Array.isArray(this.data) ? this.data : []; },
                        clear() { this.data = null; this.lastFetched = 0; }
                    };
                }
                return window.Yuuka.services.tagDataset;
            })();
            // Immediate (possibly empty) tags; don't block modal render
            let tagPredictions = tagService.get();
            if (!tagPredictions.length) {
                // Fire prefetch in background; when done, re-init autocomplete if present
                tagService.prefetch(api).then(fresh => {
                    if (window.Yuuka?.ui?._initTagAutocomplete && dialog) {
                        try { window.Yuuka.ui._initTagAutocomplete(dialog, fresh); } catch(_) {}
                    }
                });
            }

            // --- Lazy LoRA metadata (load only when panel/cards need it) ---
            let loraMetadataMap = {}; // initially empty
            let loraMetadataPromise = null;
            const ensureLoraMetadata = () => {
                if (Object.keys(loraMetadataMap).length) return Promise.resolve(loraMetadataMap);
                if (loraMetadataPromise) return loraMetadataPromise;
                if (api['lora-downloader'] && typeof api['lora-downloader'].get === 'function') {
                    loraMetadataPromise = api['lora-downloader'].get('/lora-data')
                        .then(resp => { if (resp && typeof resp.models === 'object') loraMetadataMap = resp.models; return loraMetadataMap; })
                        .catch(err => { console.warn('[AlbumModal] Unable to fetch LoRA metadata (lazy):', err); return loraMetadataMap; });
                } else {
                    loraMetadataPromise = Promise.resolve(loraMetadataMap);
                }
                return loraMetadataPromise;
            };

            const dialog = modal.querySelector('.modal-dialog');
            const loraOptions = (global_choices && Array.isArray(global_choices.loras) && global_choices.loras.length > 0)
                ? global_choices.loras
                : [{ name: 'None', value: 'None' }];
            const toNumber = (val, fallback) => {
                const parsed = parseFloat(val);
                return Number.isNaN(parsed) ? fallback : parsed;
            };
            const toInteger = (val, fallback) => {
                const parsed = parseInt(val, 10);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
            };
            const standardDefaults = {
                steps: 25,
                cfg: 2.5,
                sampler: 'euler_ancestral',
                scheduler: 'karras',
                denoise: 1.0
            };
            const hiresDefaults = {
                stage1Steps: 12,
                stage1Cfg: 2.5,
                stage1Sampler: 'euler_ancestral',
                stage1Scheduler: 'karras',
                stage1Denoise: 1.0,
                stage2Steps: 14,
                stage2Cfg: 2.5,
                stage2Sampler: 'euler_ancestral',
                stage2Scheduler: 'karras',
                stage2Denoise: 0.5,
                upscaleModel: '4x-UltraSharp.pth',
                upscaleMethod: 'bilinear'
            };

            const finalWidth = toInteger(last_config.width, 0);
            const finalHeight = toInteger(last_config.height, 0);
            const savedIsHires = Boolean(last_config.hires_enabled) || (
                toInteger(last_config.hires_base_width, 0) > 0 &&
                toInteger(last_config.hires_base_height, 0) > 0 &&
                finalWidth >= toInteger(last_config.hires_base_width, 0) * 2 &&
                finalHeight >= toInteger(last_config.hires_base_height, 0) * 2
            );

            const hiresStage1Steps = toInteger(
                last_config.steps,
                savedIsHires ? hiresDefaults.stage1Steps : standardDefaults.steps
            );
            const hiresStage1Cfg = toNumber(
                last_config.cfg,
                savedIsHires ? hiresDefaults.stage1Cfg : standardDefaults.cfg
            );
            const hiresStage1Sampler = (last_config.sampler_name || (savedIsHires ? hiresDefaults.stage1Sampler : standardDefaults.sampler));
            const hiresStage1Scheduler = (last_config.scheduler || (savedIsHires ? hiresDefaults.stage1Scheduler : standardDefaults.scheduler));
            const hiresStage1Denoise = toNumber(last_config.hires_stage1_denoise, hiresDefaults.stage1Denoise);
            const hiresStage2Steps = toInteger(last_config.hires_stage2_steps, hiresDefaults.stage2Steps);
            const hiresStage2Cfg = toNumber(last_config.hires_stage2_cfg, hiresDefaults.stage2Cfg);
            const hiresStage2Denoise = toNumber(last_config.hires_stage2_denoise, hiresDefaults.stage2Denoise);
            const stage2SamplerValue = last_config.hires_stage2_sampler_name || hiresDefaults.stage2Sampler;
            const stage2SchedulerValue = last_config.hires_stage2_scheduler || hiresDefaults.stage2Scheduler;
            const hiresUpscaleModelValue = last_config.hires_upscale_model || hiresDefaults.upscaleModel;
            const hiresUpscaleMethodValue = last_config.hires_upscale_method || hiresDefaults.upscaleMethod;
            const hiresBaseWidth = toInteger(last_config.hires_base_width, finalWidth ? Math.round(finalWidth / 2) : 0);
            const hiresBaseHeight = toInteger(last_config.hires_base_height, finalHeight ? Math.round(finalHeight / 2) : 0);

            const sizeOptions = (global_choices && Array.isArray(global_choices.sizes)) ? global_choices.sizes : [];
            const samplerOptions = (global_choices && Array.isArray(global_choices.samplers)) ? global_choices.samplers : [];
            const schedulerOptions = (global_choices && Array.isArray(global_choices.schedulers)) ? global_choices.schedulers : [];
            const checkpointOptions = (global_choices && Array.isArray(global_choices.checkpoints)) ? global_choices.checkpoints : [];

            const hiresUpscaleModels = (global_choices && Array.isArray(global_choices.hires_upscale_models) && global_choices.hires_upscale_models.length > 0)
                ? global_choices.hires_upscale_models
                : [{ name: hiresUpscaleModelValue, value: hiresUpscaleModelValue }];
            if (hiresUpscaleModelValue && !hiresUpscaleModels.some(opt => opt && opt.value === hiresUpscaleModelValue)) {
                hiresUpscaleModels.unshift({ name: hiresUpscaleModelValue, value: hiresUpscaleModelValue });
            }
            const hiresUpscaleMethods = (global_choices && Array.isArray(global_choices.hires_upscale_methods) && global_choices.hires_upscale_methods.length > 0)
                ? global_choices.hires_upscale_methods
                : [{ name: hiresUpscaleMethodValue, value: hiresUpscaleMethodValue }];
            if (hiresUpscaleMethodValue && !hiresUpscaleMethods.some(opt => opt && opt.value === hiresUpscaleMethodValue)) {
                hiresUpscaleMethods.unshift({ name: hiresUpscaleMethodValue, value: hiresUpscaleMethodValue });
            }

            const hiresConfigHTML = `
                        <div class="stage-config-grid" data-stage-config>
                            <div class="stage-config-column" data-stage="stage1">
                                <h5>Stage 1</h5>
                                ${cs('steps', 'Steps', hiresStage1Steps, 5, 50, 1)}
                                ${cs('cfg', 'CFG', hiresStage1Cfg, 1.0, 7.0, 0.1)}
                                ${cse('sampler_name', 'Sampler', hiresStage1Sampler, samplerOptions)}
                                ${cse('scheduler', 'Scheduler', hiresStage1Scheduler, schedulerOptions)}
                                <div data-stage1-denoise>${cs('hires_stage1_denoise', 'Denoise', hiresStage1Denoise, 0, 1, 0.05)}</div>
                            </div>
                            <div class="stage-config-column" data-stage="stage2">
                                <h5>Stage 2</h5>
                                ${cs('hires_stage2_steps', 'Steps', hiresStage2Steps, 10, 60, 1)}
                                ${cs('hires_stage2_cfg', 'CFG', hiresStage2Cfg, 1.0, 7.0, 0.1)}
                                ${cse('hires_stage2_sampler_name', 'Sampler', stage2SamplerValue, samplerOptions)}
                                ${cse('hires_stage2_scheduler', 'Scheduler', stage2SchedulerValue, schedulerOptions)}
                                ${cs('hires_stage2_denoise', 'Denoise', hiresStage2Denoise, 0, 1, 0.05)}
                            </div>
                        </div>
                        <div data-hires-only>
                            ${cse('hires_upscale_model', 'Upscale Model', hiresUpscaleModelValue, hiresUpscaleModels)}
                            ${cse('hires_upscale_method', 'Upscale Method', hiresUpscaleMethodValue, hiresUpscaleMethods)}
                            <input type="hidden" name="hires_base_width" value="${hiresBaseWidth}">
                            <input type="hidden" name="hires_base_height" value="${hiresBaseHeight}">
                        </div>
            `;

            const columnsHTML = `
                <div class="album-settings-columns">
                    <div class="album-settings-column" data-column="prompts">
                        <div class="album-settings-section">
                            <h4>Prompts</h4>
                            <div class="album-settings-section__body">
                                ${ct('character', 'Character', last_config.character)}
                                ${ct('outfits', 'Outfits', last_config.outfits)}
                                ${ct('expression', 'Expression', last_config.expression)}
                                ${ct('action', 'Action', last_config.action)}
                                ${ct('context', 'Context', last_config.context)}
                                ${ct('quality', 'Quality', last_config.quality)}
                                ${ct('negative', 'Negative', last_config.negative)}
                            </div>
                        </div>
                    </div>
                    <div class="album-settings-column" data-column="lora">
                        <div class="album-settings-section">
                            <h4>LoRA</h4>
                            <div class="album-settings-section__body">
                                <!-- Yuuka: Multi-LoRA preparation wrapper v1.0 -->
                                <div class="lora-multi-container" data-role="lora-multi-container"></div>
                                <div class="lora-multi-add" data-role="lora-multi-add">
                                    <button type="button" class="lora-multi-add__btn" title="Thêm LoRA (+)">
                                        <span class="material-symbols-outlined">add</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="album-settings-column" data-column="configs">
                        <div class="album-settings-section">
                            <h4>Configs</h4>
                            <div class="album-settings-section__body">
                                ${cse('size', 'Size', `${last_config.width}x${last_config.height}`, sizeOptions)}
                                ${hiresConfigHTML}
                                ${cse('ckpt_name', 'Checkpoint', last_config.ckpt_name, checkpointOptions)}
                                ${ciwb('server_address', 'Server Address', last_config.server_address)}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Removed <h3> title per user request; keep accessible label via aria-label
            dialog.innerHTML = `
                <div class="modal-header" aria-label="${escapeAttr(options.title)}">
                    <div class="album-settings-tabs"></div>
                </div>
                <div class="settings-form-container album-settings-container">
                    <form id="album-settings-form">${columnsHTML}</form>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-paste" title="Paste"><span class="material-symbols-outlined">content_paste</span></button>
                    <button type="button" class="btn-copy" title="Copy"><span class="material-symbols-outlined">content_copy</span></button>
                    <button type="button" class="btn-delete" title="Delete"><span class="material-symbols-outlined">delete_forever</span></button>
                    <button type="button" class="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                    <button type="submit" class="btn-save" title="Save" form="album-settings-form"><span class="material-symbols-outlined">save</span></button>
                    <button type="button" class="btn-generate" title="Generate" style="display:none"><span class="material-symbols-outlined">auto_awesome</span></button>
                </div>
            `;

            const form = dialog.querySelector('#album-settings-form');
            const loraDefaults = (global_choices && global_choices.lora_defaults)
                ? global_choices.lora_defaults
                : { lora_strength_model: 1.0, lora_strength_clip: 1.0 };
            const saveBtn = dialog.querySelector('.btn-save');
            const generateBtn = dialog.querySelector('.btn-generate');
                        // Unified LoRA wrapper template & initialization
                        const loraContainer = dialog.querySelector('[data-role="lora-multi-container"]');

            const createLoraWrapperHTML = (index, value, smVal, scVal) => {
                                const valEsc = escapeAttr(value || 'None');
                                const sm = (typeof smVal === 'number' && !Number.isNaN(smVal)) ? smVal : (Number(loraDefaults.lora_strength_model) || 1.0);
                                const sc = (typeof scVal === 'number' && !Number.isNaN(scVal)) ? scVal : (Number(loraDefaults.lora_strength_clip) || 1.0);
                                return `
                <div class=\"lora-multi-wrapper\" data-role=\"lora-multi-wrapper\" data-index=\"${index}\" data-empty=\"${(!value || value==='None') ? 'true' : 'false'}\">\n
                                    <div class=\"form-group lora-select-group\" data-role=\"lora-select-group\">\n
                                        <label>LoRA #${index+1} <button type=\"button\" class=\"lora-remove-btn\" data-remove style=\"display:inline-flex\" title=\"Xóa LoRA\">&times;</button></label>\n
                                        <button type=\"button\" class=\"lora-select-toggle\" aria-haspopup=\"listbox\" aria-expanded=\"false\">\n
                                            <div class=\"lora-select-toggle__thumb\"></div>\n
                                            <div class=\"lora-select-toggle__meta\">\n
                                                <span class=\"lora-select-toggle__title\">${(value && value!=='None') ? escapeHtml(value) : 'Chọn một LoRA'}</span>\n
                                                <span class=\"lora-select-toggle__subtitle\">${(value && value!=='None') ? escapeHtml(value) : 'Hoặc tải mới bằng Lora-downloader'}</span>\n
                                            </div>\n
                                            <span class=\"material-symbols-outlined lora-select-toggle__icon\">expand_more</span>\n
                                        </button>\n
                                        <div class=\"lora-card-panel\" role=\"listbox\" style=\"display:none\">\n
                                            <div class=\"lora-card-panel__controls\">\n
                                                <input type=\"search\" class=\"lora-card-panel__search-input\" placeholder=\"Search LoRA\">\n
                                                <button type=\"button\" class=\"lora-card-panel__search-button\" title=\"Clear search\">x</button>\n
                                            </div>\n
                                            <div class=\"lora-card-grid\"></div>\n
                                        </div>\n
                                        <input type=\"hidden\" name=\"lora_name_${index}\" value=\"${valEsc}\">\n
                                    </div>\n
                                    <div class=\"lora-strength-row\" style=\"display:flex; gap: 12px;\">\n
                                        <div class=\"form-group form-group-slider\">\n
                                            <label for=\"cfg-lora_strength_model_${index}\">Model: <span id=\"val-lora_strength_model_${index}\">${sm}</span></label>\n
                                            <input type=\"range\" data-lora-strength=\"model\" id=\"cfg-lora_strength_model_${index}\" name=\"lora_strength_model_${index}\" value=\"${sm}\" min=\"0\" max=\"1.5\" step=\"0.05\" oninput=\"document.getElementById('val-lora_strength_model_${index}').textContent = this.value\">\n
                                        </div>\n
                                        <div class=\"form-group form-group-slider\">\n
                                            <label for=\"cfg-lora_strength_clip_${index}\">Clip: <span id=\"val-lora_strength_clip_${index}\">${sc}</span></label>\n
                                            <input type=\"range\" data-lora-strength=\"clip\" id=\"cfg-lora_strength_clip_${index}\" name=\"lora_strength_clip_${index}\" value=\"${sc}\" min=\"0\" max=\"1.5\" step=\"0.05\" oninput=\"document.getElementById('val-lora_strength_clip_${index}').textContent = this.value\">\n
                                        </div>\n
                                    </div>\n
                                    <div class=\"lora-tags-wrapper\" data-role=\"lora-tags-wrapper\"></div>\n
                                </div>`;
                        };

                        const parseMultiLoraPreset = () => {
                            // Priority: normalized chain from info -> last_config.lora_names -> multi_lora_names
                            let names = [];
                            if (normalizedLoraChain.length) {
                                names = normalizedLoraChain.map(e => String(e.lora_name || '').trim()).filter(Boolean);
                            }
                            if (!names.length) {
                                const namesRaw = loraNamesFromInfo.length ? loraNamesFromInfo : (last_config.lora_names || last_config.multi_lora_names || []);
                                names = Array.isArray(namesRaw) ? namesRaw.filter(v => typeof v === 'string' && v.trim()) : [];
                            }
                            // Preferred structured format: array-of-arrays of strings
                            const structured = Array.isArray(last_config.multi_lora_prompt_groups)
                                ? last_config.multi_lora_prompt_groups.map(arr => Array.isArray(arr) ? arr.filter(Boolean) : [])
                                : null;
                            if (structured) {
                                return { names, perLoraGroups: structured };
                            }
                            // Legacy string format: one parentheses block per LoRA; split content by comma into multiple groups
                            const presetString = last_config.multi_lora_prompt_tags || '';
                            const groupRegex = /\(([^)]*)\)/g;
                            const perLoraGroups = [];
                            let match;
                            while ((match = groupRegex.exec(presetString)) !== null) {
                                const content = (match[1] || '').trim();
                                if (content) {
                                    const parts = content.split(',').map(s => s.trim()).filter(Boolean);
                                    perLoraGroups.push(parts);
                                } else {
                                    perLoraGroups.push([]);
                                }
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
                            // After init, when tags are rendered we will toggle according to groupList
                            wrapper.dataset.presetGroups = JSON.stringify(groupList || []);
                        };

                        const mountInitialWrappers = () => {
                            if (!loraContainer) return [];
                            const { names, perLoraGroups } = parseMultiLoraPreset();
                            // Always render at least one wrapper; prefer normalized/explicit names
                            const finalNames = names.length ? names : ['None'];
                            loraContainer.innerHTML = '';
                            const getInitStrengths = (idx, name) => {
                                let sm = Number(loraDefaults.lora_strength_model) || 1.0;
                                let sc = Number(loraDefaults.lora_strength_clip) || 1.0;
                                if (Array.isArray(normalizedLoraChain) && normalizedLoraChain.length) {
                                    const byIdx = normalizedLoraChain[idx];
                                    if (byIdx && (!name || byIdx.lora_name === name)) {
                                        const smRaw = byIdx.strength_model ?? byIdx.lora_strength_model;
                                        const scRaw = byIdx.strength_clip ?? byIdx.lora_strength_clip;
                                        if (typeof smRaw === 'number') sm = smRaw; else if (typeof smRaw === 'string') { const t = parseFloat(smRaw); if (!Number.isNaN(t)) sm = t; }
                                        if (typeof scRaw === 'number') sc = scRaw; else if (typeof scRaw === 'string') { const t2 = parseFloat(scRaw); if (!Number.isNaN(t2)) sc = t2; }
                                    } else if (name) {
                                        const found = normalizedLoraChain.find(e => e && e.lora_name === name);
                                        if (found) {
                                            const smRaw = found.strength_model ?? found.lora_strength_model;
                                            const scRaw = found.strength_clip ?? found.lora_strength_clip;
                                            if (typeof smRaw === 'number') sm = smRaw; else if (typeof smRaw === 'string') { const t = parseFloat(smRaw); if (!Number.isNaN(t)) sm = t; }
                                            if (typeof scRaw === 'number') sc = scRaw; else if (typeof scRaw === 'string') { const t2 = parseFloat(scRaw); if (!Number.isNaN(t2)) sc = t2; }
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
                        const mountedWrappers = mountInitialWrappers();
                        const initialWrapper = mountedWrappers[0] || null;


            // --- Yuuka: Multi-LoRA dynamic add v1.0 ---
            const multiAddContainer = dialog.querySelector('[data-role="lora-multi-add"]');
            const createNewLoraWrapper = (index) => {
                const defSm = Number(loraDefaults.lora_strength_model) || 1.0;
                const defSc = Number(loraDefaults.lora_strength_clip) || 1.0;
                const html = createLoraWrapperHTML(index, 'None', defSm, defSc);
                const temp = document.createElement('div');
                temp.innerHTML = html.trim();
                const wrapper = temp.firstElementChild;
                return wrapper;
            };
            const getLoraWrappers = () => Array.from(dialog.querySelectorAll('.lora-multi-wrapper'));
            const nextIndex = () => getLoraWrappers().length;
            if (multiAddContainer) {
                const addBtn = multiAddContainer.querySelector('.lora-multi-add__btn');
                addBtn?.addEventListener('click', () => {
                    const index = nextIndex();
                    const wrapper = createNewLoraWrapper(index);
                    multiAddContainer.before(wrapper);
                    initSingleLoraWrapper(wrapper);
                    reindexLoraWrappers();
                });
            }

            // --- Yuuka: Multi-LoRA enhancement v1.1 ---
            const buildLoraCards = (grid, wrappersCtx) => {
                if (!grid) return;
                grid.innerHTML = '';
                const cardOptions = Array.isArray(loraOptions) && loraOptions.length ? loraOptions : [{ name: 'None', value: 'None' }];
                cardOptions.forEach(option => {
                    if (!option) return;
                    const value = option.value ?? option.name ?? '';
                    if (typeof value !== 'string') return;
                    // Metadata may not be loaded yet; attempt local lookup only
                    const metadata = (Object.keys(loraMetadataMap).length && value !== 'None') ? findLoraMetadata(value) : null;
                    // Hide 'None' option from panel (user can remove wrapper to clear)
                    if (value === 'None') return; 
                    let displayName = resolveLoraCharacterName(metadata, option.name || value);
                    let subtitle = (metadata?.filename || metadata?.name || option.name || value);
                    const thumbUrl = value === 'None' ? null : getLoraThumbnailUrl(metadata);
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'lora-card';
                    card.dataset.value = value;
                    card.setAttribute('role','option');
                    card.innerHTML = `
                        <div class="lora-card__thumb">${thumbUrl ? `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(displayName)}" loading="lazy">` : ''}</div>
                        <div class="lora-card__meta">
                            <div class="lora-card__title">${escapeHtml(truncateText(displayName,40))}</div>
                            <div class="lora-card__subtitle">${escapeHtml(truncateText(subtitle,40))}</div>
                        </div>
                    `;
                    // Clicking the thumbnail opens simple-viewer (does not select the LoRA)
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
                    card.addEventListener('click', () => wrappersCtx.select(value, displayName));
                    grid.appendChild(card);
                });
            };

            // Per-wrapper tag selection state
            const wrapperTagStates = new Map(); // key: loraName -> array<boolean>
            const renderWrapperTags = (tagsWrapper, loraName) => {
                if (!tagsWrapper) return;
                tagsWrapper.innerHTML = '';
                tagsWrapper.style.display = 'none';
                if (!loraName || loraName.toLowerCase() === 'none') return;
                const meta = loraMetadataMap[loraName] || findLoraMetadata(loraName);
                const trainedWords = meta ? extractTrainedWords(meta) : [];
                if (!trainedWords.length) return;
                // Check preset groups on parent wrapper
                const parentWrapper = tagsWrapper.closest('.lora-multi-wrapper');
                const stateKey = `${loraName}#${parentWrapper?.dataset.index || ''}`;
                let state = wrapperTagStates.get(stateKey);
                let presetGroups = [];
                if (parentWrapper && parentWrapper.dataset.presetGroups) {
                    try { presetGroups = JSON.parse(parentWrapper.dataset.presetGroups) || []; } catch (_) {}
                }
                const normalizedPreset = presetGroups.map(g => g.trim().toLowerCase());
                if (!state || state.length !== trainedWords.length) {
                    state = trainedWords.map((group, idx) => {
                        const groupText = formatGroupText(group).trim().toLowerCase();
                        if (normalizedPreset.length) return normalizedPreset.includes(groupText);
                        // Default: no group selected unless preset says so
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
                    title.textContent = `LoRA tags ${idx+1}`;
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'lora-tag-toggle';
                    toggle.classList.toggle('is-active', !!state[idx]);
                    toggle.setAttribute('aria-pressed', state[idx] ? 'true' : 'false');
                    toggle.addEventListener('click', () => {
                        // Allow turning all off as well
                        state[idx] = !state[idx];
                        toggle.classList.toggle('is-active', state[idx]);
                        toggle.setAttribute('aria-pressed', state[idx] ? 'true' : 'false');
                        wrapperTagStates.set(stateKey, [...state]);
                    });
                    header.append(title, toggle);
                    const body = document.createElement('div');
                    body.className = 'lora-tag-card__body';
                    body.textContent = formatGroupText(group);
                    card.append(header, body);
                    tagsWrapper.appendChild(card);
                });
            };

            const reindexLoraWrappers = () => {
                getLoraWrappers().forEach((wrapper, idx) => {
                    wrapper.dataset.index = String(idx);
                    const hidden = wrapper.querySelector('input[type="hidden"][name^="lora_name_"]');
                    if (hidden) hidden.name = `lora_name_${idx}`;
                    const label = wrapper.querySelector('.lora-select-group > label');
                    if (label) {
                        const removeBtn = label.querySelector('[data-remove]');
                        // Reset text (firstChild text node)
                        label.childNodes.forEach(node => { if (node.nodeType===3) node.textContent = `LoRA #${idx+1} `; });
                        if (removeBtn) removeBtn.style.display = '';
                    }
                    // Update strength inputs' name/id/for and display span ids to keep inline oninput working
                    const modelInput = wrapper.querySelector('input[data-lora-strength="model"]');
                    const clipInput = wrapper.querySelector('input[data-lora-strength="clip"]');
                    if (modelInput) {
                        const group = modelInput.closest('.form-group');
                        const labelEl = group ? group.querySelector('label') : null;
                        const spanEl = labelEl ? labelEl.querySelector('span[id^="val-lora_strength_model_"]') : null;
                        modelInput.name = `lora_strength_model_${idx}`;
                        modelInput.id = `cfg-lora_strength_model_${idx}`;
                        modelInput.setAttribute('oninput', `document.getElementById('val-lora_strength_model_${idx}').textContent = this.value`);
                        if (labelEl) labelEl.setAttribute('for', `cfg-lora_strength_model_${idx}`);
                        if (spanEl) spanEl.id = `val-lora_strength_model_${idx}`;
                    }
                    if (clipInput) {
                        const group = clipInput.closest('.form-group');
                        const labelEl = group ? group.querySelector('label') : null;
                        const spanEl = labelEl ? labelEl.querySelector('span[id^="val-lora_strength_clip_"]') : null;
                        clipInput.name = `lora_strength_clip_${idx}`;
                        clipInput.id = `cfg-lora_strength_clip_${idx}`;
                        clipInput.setAttribute('oninput', `document.getElementById('val-lora_strength_clip_${idx}').textContent = this.value`);
                        if (labelEl) labelEl.setAttribute('for', `cfg-lora_strength_clip_${idx}`);
                        if (spanEl) spanEl.id = `val-lora_strength_clip_${idx}`;
                    }
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
                    hiddenInput.value = normalized;
                    const isNone = normalized === 'None';
                    if (titleEl) titleEl.textContent = isNone ? 'Chọn một LoRA' : (displayName || normalized);
                    if (subtitleEl) subtitleEl.textContent = isNone ? 'Hoặc tải mới bằng Lora-downloader' : (normalized);
                    // Toggle strength row visibility via data-empty
                    wrapper.setAttribute('data-empty', isNone ? 'true' : 'false');
                    const meta = !isNone ? (loraMetadataMap[normalized] || findLoraMetadata(normalized)) : null;
                    const thumbUrl = meta ? getLoraThumbnailUrl(meta) : null;
                    if (thumbEl) {
                        // Clear previous content
                        thumbEl.innerHTML = (!isNone && thumbUrl)
                            ? `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(displayName || normalized)}" loading="lazy">`
                            : '';
                        // Remove old listener if exists
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
                };
                const ctx = { select: selectLoRA };
                if (cardGrid && !cardGrid.dataset.built) {
                    buildLoraCards(cardGrid, ctx); // initial quick build (no metadata thumbnails maybe)
                    cardGrid.dataset.built = 'true';
                    // Lazy metadata fetch then rebuild for thumbnails & tags
                    ensureLoraMetadata().then(() => {
                        buildLoraCards(cardGrid, ctx);
                        // Re-render tags for current selection after metadata arrives
                        const currentVal = hiddenInput?.value;
                        if (currentVal && currentVal !== 'None') {
                            renderWrapperTags(tagsWrapper, currentVal);
                        }
                    });
                }
                // Ensure initial thumbnail & tags are rendered for every wrapper (previously only first got updated via legacy logic)
                if (hiddenInput && typeof hiddenInput.value === 'string') {
                    const initialVal = hiddenInput.value.trim();
                    // Avoid double render if already processed, but safe to call.
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
                clearBtn?.addEventListener('click', () => { if (searchInput){ searchInput.value=''; searchInput.dispatchEvent(new Event('input')); } });
                removeBtn?.addEventListener('click', () => {
                    wrapper.remove();
                    reindexLoraWrappers();
                });
            };

            // Initialize existing wrapper(s)
            getLoraWrappers().forEach(w => {
                initSingleLoraWrapper(w);
                // After init, force apply preset tags if any
                const hidden = w.querySelector('input[type="hidden"][name^="lora_name_"]');
                const loraName = hidden ? hidden.value : 'None';
                if (loraName && loraName !== 'None') {
                    renderWrapperTags(w.querySelector('[data-role="lora-tags-wrapper"]'), loraName);
                }
            });
            reindexLoraWrappers();

            // Legacy single-LoRA panel removed; per-wrapper selectors handle their own panel state.

            const sizeSelect = form?.elements?.['size'];
            const stageConfigGrid = dialog.querySelector('[data-stage-config]');
            const stage2Column = stageConfigGrid ? stageConfigGrid.querySelector('[data-stage="stage2"]') : null;
            const stage1Denoise = stageConfigGrid ? stageConfigGrid.querySelector('[data-stage1-denoise]') : null;
            const hiresBaseWidthInput = form?.elements?.['hires_base_width'];
            const hiresBaseHeightInput = form?.elements?.['hires_base_height'];

            const updateHiresConfigVisibility = () => {
                if (!sizeSelect) return;
                const selectedOption = sizeSelect.options[sizeSelect.selectedIndex];
                const isHires = selectedOption?.dataset?.mode === "hires";
                if (stageConfigGrid) {
                    stageConfigGrid.classList.toggle('is-hires', !!isHires);
                }
                if (stage2Column) {
                    stage2Column.style.display = isHires ? "" : "none";
                }
                if (stage1Denoise) {
                    stage1Denoise.style.display = isHires ? "" : "none";
                }
                const hiresOnlyBlocks = dialog.querySelectorAll('[data-hires-only]');
                hiresOnlyBlocks.forEach(block => {
                    block.style.display = isHires ? "" : "none";
                });
                form.dataset.hiresEnabled = isHires ? "true" : "false";

                const computeBase = (datasetValue, sizeValue, existingValue) => {
                    const datasetParsed = parseInt(datasetValue, 10);
                    if (Number.isFinite(datasetParsed) && datasetParsed > 0) return datasetParsed;
                    const sizeParsed = parseInt(sizeValue, 10);
                    if (Number.isFinite(sizeParsed) && sizeParsed > 0) return Math.round(sizeParsed / 2);
                    const existingParsed = parseInt(existingValue, 10);
                    return Number.isFinite(existingParsed) && existingParsed > 0 ? existingParsed : 0;
                };

                const sizeParts = (sizeSelect.value || "").split("x");
                if (hiresBaseWidthInput) {
                    const baseWidth = isHires ? computeBase(selectedOption?.dataset?.baseWidth, sizeParts[0], hiresBaseWidthInput.value) : 0;
                    hiresBaseWidthInput.value = baseWidth > 0 ? String(baseWidth) : "0";
                }
                if (hiresBaseHeightInput) {
                    const baseHeight = isHires ? computeBase(selectedOption?.dataset?.baseHeight, sizeParts[1], hiresBaseHeightInput.value) : 0;
                    hiresBaseHeightInput.value = baseHeight > 0 ? String(baseHeight) : "0";
                }
            };

            if (sizeSelect) {
                sizeSelect.addEventListener('change', updateHiresConfigVisibility);
            }
            updateHiresConfigVisibility();

            const connectBtn = dialog.querySelector('.connect-btn');

            const columnsContainer = dialog.querySelector('.album-settings-columns');
            const columns = Array.from(columnsContainer.querySelectorAll('.album-settings-column'));
            columns.forEach(col => col.classList.add('is-active'));

            const tabsNav = dialog.querySelector('.album-settings-tabs');
            if (tabsNav) {
                tabsNav.innerHTML = '';
            }
            const tabButtons = [];
            let activeTab = columns[0]?.dataset.column || 'prompts';
            columns.forEach(col => {
                const columnId = col.dataset.column;
                const label = col.querySelector('h4')?.textContent?.trim() || columnId;
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.target = columnId;
                button.textContent = label;
                if (tabsNav) {
                    tabsNav.appendChild(button);
                }
                tabButtons.push(button);
            });
            if (tabsNav) {
                tabsNav.hidden = true;
            }

            const setActiveTab = (target) => {
                activeTab = target;
                columns.forEach(col => col.classList.toggle('is-active', col.dataset.column === activeTab));
                tabButtons.forEach(btn => btn.classList.toggle('is-active', btn.dataset.target === activeTab));
            };

            tabButtons.forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.target)));

            const mobileQuery = window.matchMedia('(max-width: 768px)');
            const applyLayout = () => {
                const isMobile = mobileQuery.matches;
                modal.classList.toggle('is-mobile', isMobile);
                if (isMobile) {
                    setActiveTab(activeTab);
                    if (tabsNav) {
                        tabsNav.hidden = false;
                    }
                } else {
                    columns.forEach(col => col.classList.add('is-active'));
                    tabButtons.forEach(btn => btn.classList.remove('is-active'));
                    if (tabsNav) {
                        tabsNav.hidden = true;
                    }
                }
            };

            mobileQuery.addEventListener('change', applyLayout);
            cleanupFns.push(() => mobileQuery.removeEventListener('change', applyLayout));
            applyLayout();

            // Legacy global single-LoRA state removed; metadata lookups provided below for per-wrapper UIs.
            // Hoisted function so multi-LoRA code above can use it without TDZ errors
            function findLoraMetadata(value) {
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
            }

            function extractTrainedWords(metadata) {
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
            }

            // Legacy single-LoRA search panel and global tag toggles removed; selection is managed per-wrapper.

            if (window.Yuuka?.ui?._initTagAutocomplete) {
                try { window.Yuuka.ui._initTagAutocomplete(dialog, tagPredictions); } catch(_) {}
            }
            dialog.querySelectorAll('textarea').forEach(t => {
                const autoResize = () => {
                    t.style.height = 'auto';
                    t.style.height = `${t.scrollHeight}px`;
                };
                t.addEventListener('input', autoResize);
                setTimeout(autoResize, 0);
            });

            const getPromptClipboard = () => {
                if (typeof options.getPromptClipboard === 'function') {
                    const result = options.getPromptClipboard();
                    if (result instanceof Map) return result;
                    if (result && typeof result === 'object') return new Map(Object.entries(result));
                    return null;
                }
                const fallback = options.promptClipboard;
                if (fallback instanceof Map) return fallback;
                if (fallback && typeof fallback === 'object') return new Map(Object.entries(fallback));
                return null;
            };

            const setPromptClipboard = (entries) => {
                let map = null;
                if (entries instanceof Map) {
                    map = entries;
                } else if (Array.isArray(entries)) {
                    map = new Map(entries);
                } else if (entries && typeof entries === 'object') {
                    map = new Map(Object.entries(entries));
                }
                if (typeof options.setPromptClipboard === 'function') {
                    return options.setPromptClipboard(map || null);
                }
                options.promptClipboard = map || null;
                return options.promptClipboard;
            };

            dialog.querySelector('.btn-cancel').addEventListener('click', close);
            dialog.querySelector('.btn-copy').addEventListener('click', () => {
                const keys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
                const clipboardEntries = keys.map(k => [k, form.elements[k] ? form.elements[k].value.trim() : '']);
                setPromptClipboard(clipboardEntries);
                showError("Prompt đã sao chép.");
            });
            dialog.querySelector('.btn-paste').addEventListener('click', () => {
                const clipboard = getPromptClipboard();
                const entries = clipboard instanceof Map ? clipboard : clipboard ? new Map(Object.entries(clipboard)) : null;
                if (!entries || entries.size === 0) { showError("Chưa sao chép prompt."); return; }
                entries.forEach((v, k) => {
                    if (form.elements[k]) form.elements[k].value = v;
                });
                dialog.querySelectorAll('textarea').forEach(t => t.dispatchEvent(new Event('input', { bubbles: true })));
                showError("Đã dán prompt.");
            });

            const deleteBtn = dialog.querySelector('.btn-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    if (typeof options.onDelete !== 'function') {
                        showError("Chưa có hàm xóa album.");
                        return;
                    }
                    const confirmDelete = typeof window.Yuuka?.ui?.confirm === 'function'
                        ? await window.Yuuka.ui.confirm('Bạn có chắc muốn xóa album này và tất cả config liên quan?')
                        : window.confirm('Bạn có chắc muốn xóa album này và tất cả config liên quan?');
                    if (!confirmDelete) return;
                    deleteBtn.disabled = true;
                    try {
                        await options.onDelete();
                        close();
                    } catch (err) {
                        showError(`Không thể xóa album: ${err?.message || err}`);
                    } finally {
                        deleteBtn.disabled = false;
                    }
                });
            }

            const collectFormValues = () => {
                const payload = {};
                ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name']
                    .forEach(k => {
                        if (form.elements[k]) {
                            payload[k] = form.elements[k].value;
                        }
                    });
                // Yuuka: multi-LoRA collect - gather all lora inputs if present
                let loraWrappers = Array.from(dialog.querySelectorAll('.lora-multi-wrapper'));
                const activeLoraEntries = [];
                loraWrappers.forEach(wrapper => {
                    const hidden = wrapper.querySelector('input[type="hidden"][name^="lora_name_"]');
                    const loraName = (hidden?.value || 'None').trim();
                    if (!loraName || loraName.toLowerCase()==='none') return;
                    // Read per-LoRA strengths from sliders in this wrapper
                    const smInput = wrapper.querySelector('input[data-lora-strength="model"]');
                    const scInput = wrapper.querySelector('input[data-lora-strength="clip"]');
                    let smVal = parseFloat(smInput ? smInput.value : '');
                    let scVal = parseFloat(scInput ? scInput.value : '');
                    if (Number.isNaN(smVal)) smVal = Number(loraDefaults.lora_strength_model) || 1.0;
                    if (Number.isNaN(scVal)) scVal = Number(loraDefaults.lora_strength_clip) || 1.0;
                    // Collect tag groups toggled on for this LoRA
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
                    // Build legacy string per-LoRA: include all selected groups within one parentheses block
                    const formatted = groups.length ? `(${groups.join(', ')})` : '';
                    activeLoraEntries.push({ name: loraName, groupText: formatted, groups, sm: smVal, sc: scVal });
                });
                const loraNames = activeLoraEntries.map(e => e.name);
                payload.lora_names = loraNames;
                // Construct lora_chain with per-LoRA strengths
                if (loraNames.length) {
                    payload.lora_chain = activeLoraEntries.map(e => ({ lora_name: e.name, strength_model: e.sm, strength_clip: e.sc }));
                } else {
                    payload.lora_chain = [];
                }
                // Build combined tags string: (LoRA1 groups...), (LoRA2 groups...), ...
                const multiTagsParts = activeLoraEntries
                    .filter(e => e.groupText)
                    .map(e => e.groupText);
                payload.multi_lora_prompt_tags = multiTagsParts.join(', ');
                // New structured multi-select payload aligned with lora_names
                payload.multi_lora_prompt_groups = activeLoraEntries.map(e => e.groups);
                ['steps', 'cfg'].forEach(k => {
                    if (!form.elements[k]) return;
                    const val = parseFloat(form.elements[k].value);
                    payload[k] = Number.isNaN(val) ? last_config[k] : val;
                });

                const sizeField = form.elements['size'];
                const sizeValue = sizeField ? sizeField.value : `${finalWidth}x${finalHeight}`;
                const [sizeW, sizeH] = (sizeValue || '').split('x');
                const parsedWidth = parseInt(sizeW, 10);
                const parsedHeight = parseInt(sizeH, 10);
                payload.width = Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : finalWidth;
                payload.height = Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : finalHeight;

                const selectedOption = sizeField?.options?.[sizeField.selectedIndex];
                const isHires = selectedOption?.dataset?.mode === 'hires';
                payload.hires_enabled = !!isHires;

                const baseWidthValue = parseInt(form.elements['hires_base_width']?.value ?? '0', 10);
                payload.hires_base_width = Number.isFinite(baseWidthValue) && baseWidthValue > 0 ? baseWidthValue : 0;
                const baseHeightValue = parseInt(form.elements['hires_base_height']?.value ?? '0', 10);
                payload.hires_base_height = Number.isFinite(baseHeightValue) && baseHeightValue > 0 ? baseHeightValue : 0;

                const stage1DenoiseInput = form.elements['hires_stage1_denoise'];
                const stage1DenoiseValue = stage1DenoiseInput ? parseFloat(stage1DenoiseInput.value) : NaN;
                payload.hires_stage1_denoise = Number.isNaN(stage1DenoiseValue) ? hiresDefaults.stage1Denoise : stage1DenoiseValue;

                const stage2StepsInput = form.elements['hires_stage2_steps'];
                const stage2StepsValue = stage2StepsInput ? parseInt(stage2StepsInput.value, 10) : NaN;
                payload.hires_stage2_steps = Number.isFinite(stage2StepsValue) && stage2StepsValue > 0 ? stage2StepsValue : hiresDefaults.stage2Steps;

                const stage2CfgInput = form.elements['hires_stage2_cfg'];
                const stage2CfgValue = stage2CfgInput ? parseFloat(stage2CfgInput.value) : NaN;
                payload.hires_stage2_cfg = Number.isNaN(stage2CfgValue) ? hiresDefaults.stage2Cfg : stage2CfgValue;

                const stage2DenoiseInput = form.elements['hires_stage2_denoise'];
                const stage2DenoiseValue = stage2DenoiseInput ? parseFloat(stage2DenoiseInput.value) : NaN;
                payload.hires_stage2_denoise = Number.isNaN(stage2DenoiseValue) ? hiresDefaults.stage2Denoise : stage2DenoiseValue;

                payload.hires_stage2_sampler_name = form.elements['hires_stage2_sampler_name']?.value || stage2SamplerValue;
                payload.hires_stage2_scheduler = form.elements['hires_stage2_scheduler']?.value || stage2SchedulerValue;
                payload.hires_upscale_model = form.elements['hires_upscale_model']?.value || hiresUpscaleModelValue;
                payload.hires_upscale_method = form.elements['hires_upscale_method']?.value || hiresUpscaleMethodValue;

                // Expanded legacy compatibility: include ALL selected groups for EVERY LoRA in lora_prompt_tags
                // so older consumer code can still display them (each group wrapped in parentheses).
                const allGroupsFlattened = [];
                loraWrappers.forEach(wrapper => {
                    const cards = wrapper.querySelectorAll('.lora-tag-card');
                    cards.forEach(card => {
                        const toggle = card.querySelector('.lora-tag-toggle');
                        const body = card.querySelector('.lora-tag-card__body');
                        if (toggle && toggle.classList.contains('is-active')) {
                            const raw = body?.textContent?.trim() || '';
                            if (raw) allGroupsFlattened.push(`(${raw})`);
                        }
                    });
                });
                payload.lora_prompt_tags = allGroupsFlattened;
                return payload;
            };

            const setActionButtonsDisabled = (disabled) => {
                if (saveBtn) saveBtn.disabled = disabled;
                if (generateBtn) generateBtn.disabled = disabled;
            };

            const handleSave = async (shouldGenerate = false) => {
                const payload = collectFormValues();
                setActionButtonsDisabled(true);
                try {
                    try {
                        await options.onSave(payload);
                    } catch (err) {
                        showError(`Lỗi khi lưu: ${err.message}`);
                        return;
                    }
                    if (shouldGenerate && typeof options.onGenerate === 'function') {
                        try {
                            await options.onGenerate(payload);
                        } catch (err) {
                            showError(`Lỗi khi generate: ${err.message}`);
                            return;
                        }
                    }
                    const successMessage = shouldGenerate && typeof options.onGenerate === 'function'
                        ? 'Đã lưu cấu hình và bắt đầu generate!'
                        : 'Lưu cấu hình thành công!';
                    showError(successMessage);
                    close();
                } finally {
                    setActionButtonsDisabled(false);
                }
            };

            connectBtn.addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const address = form.elements['server_address'].value.trim();
                if (!address) {
                    showError("Vui lòng nhập địa chỉ server.");
                    return;
                }
                const originalText = btn.textContent;
                btn.textContent = '...';
                btn.disabled = true;
                try {
                    if (options.onConnect) {
                        await options.onConnect(address, btn, close);
                    } else {
                        await api.server.checkComfyUIStatus(address);
                        showError("Kết nối thành công!");
                    }
                } catch (err) {
                    showError(`Kết nối thất bại: ${err.message || err}`);
                } finally {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleSave(false);
            });

            if (generateBtn) {
                if (typeof options.onGenerate === 'function') {
                    generateBtn.style.display = '';
                    generateBtn.addEventListener('click', () => { handleSave(true); });
                } else {
                    generateBtn.style.display = 'none';
                }
            }
        } catch (e) {
            close();
            let friendlyMessage = "Lỗi: Không thể mở modal cấu hình.";
            if (e?.message && (e.message.includes("10061") || e.message.toLowerCase().includes("connection refused"))) {
                friendlyMessage = "Lỗi: Không thể kết nối đến ComfyUI. Vui lòng kiểm tra xem ComfyUI đã được khởi động chưa.";
            } else if (e?.message) {
                friendlyMessage = `Lỗi tải cấu hình: ${e.message}`;
            }
            showError(friendlyMessage);
        }
    }

    window.Yuuka.plugins.albumModal = { openSettingsModal };
})();
