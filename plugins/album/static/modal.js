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
            const { last_config, global_choices } = await options.fetchInfo();
            const tagPredictions = await api.getTags().catch(() => []);

            let loraMetadataMap = {};
            try {
                if (api['lora-downloader'] && typeof api['lora-downloader'].get === 'function') {
                    const loraResponse = await api['lora-downloader'].get('/lora-data');
                    if (loraResponse && typeof loraResponse.models === 'object') {
                        loraMetadataMap = loraResponse.models;
                    }
                }
            } catch (err) {
                console.warn('[AlbumModal] Unable to fetch LoRA metadata:', err);
            }

            const dialog = modal.querySelector('.modal-dialog');
            const loraOptions = (global_choices && Array.isArray(global_choices.loras) && global_choices.loras.length > 0)
                ? global_choices.loras
                : [{ name: 'None', value: 'None' }];
            const selectedLora = last_config.lora_name || 'None';
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
                                <div class="form-group lora-select-group">
                                    <label for="cfg-lora_name">LoRA Name</label>
                                    <button type="button" class="lora-select-toggle" aria-haspopup="listbox" aria-expanded="false">
                                        <div class="lora-select-toggle__thumb"></div>
                                        <div class="lora-select-toggle__meta">
                                            <span class="lora-select-toggle__title">None</span>
                                            <span class="lora-select-toggle__subtitle">Không dùng LoRA</span>
                                        </div>
                                        <span class="material-symbols-outlined lora-select-toggle__icon">expand_more</span>
                                    </button>
                                    <div class="lora-card-panel" role="listbox">
                                        <div class="lora-card-panel__controls">
                                            <input type="search" class="lora-card-panel__search-input" placeholder="Search LoRA">
                                            <button type="button" class="lora-card-panel__search-button" title="Clear search">x</button>
                                        </div>
                                        <div class="lora-card-grid"></div>
                                    </div>
                                    <input type="hidden" id="cfg-lora_name" name="lora_name" value="${escapeAttr(selectedLora)}">
                                </div>
                                <div class="lora-tags-wrapper"></div>
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
            const saveBtn = dialog.querySelector('.btn-save');
            const generateBtn = dialog.querySelector('.btn-generate');
            const loraInput = form?.elements?.['lora_name'];
            const loraFieldGroup = loraInput ? loraInput.closest('.form-group') : null;
            const loraSelectGroup = loraFieldGroup;
            const loraCardPanel = loraSelectGroup ? loraSelectGroup.querySelector('.lora-card-panel') : null;
            const loraSearchInput = loraCardPanel ? loraCardPanel.querySelector('.lora-card-panel__search-input') : null;
            const loraSearchButton = loraCardPanel ? loraCardPanel.querySelector('.lora-card-panel__search-button') : null;
            const loraCardGrid = loraCardPanel ? loraCardPanel.querySelector('.lora-card-grid') : null;
            const loraToggle = loraSelectGroup ? loraSelectGroup.querySelector('.lora-select-toggle') : null;
            const loraToggleThumb = loraToggle ? loraToggle.querySelector('.lora-select-toggle__thumb') : null;
            const loraToggleTitle = loraToggle ? loraToggle.querySelector('.lora-select-toggle__title') : null;
            const loraToggleSubtitle = loraToggle ? loraToggle.querySelector('.lora-select-toggle__subtitle') : null;
            const loraToggleIcon = loraToggle ? loraToggle.querySelector('.lora-select-toggle__icon') : null;
            const loraColumn = dialog.querySelector('[data-column="lora"]');
            const loraColumnBody = loraColumn ? loraColumn.querySelector('.album-settings-section__body') : null;
            let loraTagsWrapper = null;
            if (loraFieldGroup) {
                loraTagsWrapper = loraFieldGroup.querySelector('.lora-tags-wrapper');
                if (!loraTagsWrapper) {
                    const body = loraFieldGroup.closest('.album-settings-section__body');
                    loraTagsWrapper = body ? body.querySelector('.lora-tags-wrapper') : null;
                }
            } else if (loraColumnBody) {
                loraTagsWrapper = loraColumnBody.querySelector('.lora-tags-wrapper');
            }
            if (!loraTagsWrapper && loraColumnBody) {
                loraTagsWrapper = document.createElement('div');
                loraTagsWrapper.className = 'lora-tags-wrapper';
                loraColumnBody.appendChild(loraTagsWrapper);
            }

            let isLoraPanelOpen = false;
            let hasPanelListeners = false;
            const outsideClickListener = (event) => {
                if (!loraSelectGroup?.contains(event.target)) {
                    setLoraPanelOpen(false);
                }
            };
            const escapeListener = (event) => {
                if (event.key === 'Escape') {
                    setLoraPanelOpen(false);
                }
            };
            const setLoraPanelOpen = (open) => {
                if (!loraSelectGroup) return;
                if (isLoraPanelOpen === open) return;
                isLoraPanelOpen = open;
                loraSelectGroup.classList.toggle('is-open', open);
                if (loraCardPanel) {
                    loraCardPanel.style.display = open ? '' : 'none';
                }
                if (loraToggle) {
                    loraToggle.classList.toggle('is-open', open);
                    loraToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                }
                if (loraToggleIcon) {
                    loraToggleIcon.textContent = open ? 'expand_less' : 'expand_more';
                }
                if (open) {
                    if (!hasPanelListeners) {
                        document.addEventListener('mousedown', outsideClickListener);
                        document.addEventListener('keydown', escapeListener);
                        hasPanelListeners = true;
                    }
                } else if (hasPanelListeners) {
                    document.removeEventListener('mousedown', outsideClickListener);
                    document.removeEventListener('keydown', escapeListener);
                    hasPanelListeners = false;
                }
            };
            if (loraCardPanel) {
                loraCardPanel.style.display = 'none';
            }
            if (loraToggle) {
                loraToggle.addEventListener('click', () => {
                    setLoraPanelOpen(!isLoraPanelOpen);
                });
            }
            cleanupFns.push(() => {
                if (hasPanelListeners) {
                    document.removeEventListener('mousedown', outsideClickListener);
                    document.removeEventListener('keydown', escapeListener);
                    hasPanelListeners = false;
                }
                isLoraPanelOpen = false;
            });

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

            const loraMetadataList = Object.values(loraMetadataMap || {});
            let existingLoraSelections = Array.isArray(last_config.lora_prompt_tags) ? last_config.lora_prompt_tags.slice() : [];
            const findLoraMetadata = (value) => loraMetadataList.find(entry => {
                if (!entry) return false;
                if (entry.filename && entry.filename === value) return true;
                if (entry.name && entry.name === value) return true;
                return false;
            });

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

            const loraTagState = new Map();
            let currentLoraKey = null;
            let currentLoraGroups = [];

            const getSelectedLoraPromptTags = () => {
                if (!currentLoraKey || !currentLoraGroups.length) return [];
                const state = loraTagState.get(currentLoraKey) || [];
                return currentLoraGroups.reduce((acc, group, idx) => {
                    if (!state[idx]) return acc;
                    const formatted = formatGroupText(group).trim();
                    if (formatted) acc.push(`(${formatted})`);
                    return acc;
                }, []);
            };

            const renderLoraTags = (loraName) => {
                if (!loraTagsWrapper) return;
                loraTagsWrapper.innerHTML = '';
                loraTagsWrapper.style.display = 'none';
                if (!loraName || loraName === 'None') {
                    currentLoraKey = null;
                    currentLoraGroups = [];
                    return;
                }
                const metadata = findLoraMetadata(loraName);
                if (!metadata) {
                    currentLoraKey = null;
                    currentLoraGroups = [];
                    loraTagState.delete(loraName);
                    return;
                }
                const trainedWords = extractTrainedWords(metadata);
                if (!trainedWords.length) {
                    currentLoraKey = null;
                    currentLoraGroups = [];
                    loraTagState.delete(loraName);
                    return;
                }
                currentLoraKey = loraName;
                currentLoraGroups = trainedWords;
                loraTagsWrapper.style.display = 'flex';
                let state = loraTagState.get(loraName);
                if (!state || state.length !== trainedWords.length) {
                    const storedSet = new Set(existingLoraSelections.map(normalizeStoredGroup).filter(Boolean));
                    state = trainedWords.map((group, idx) => {
                        if (storedSet.size > 0) {
                            return storedSet.has(parseWordGroup(group).map(normalizeTag).join(','));
                        }
                        return idx === 0;
                    });
                    if (!state.some(Boolean)) {
                        state[0] = true;
                    }
                    loraTagState.set(loraName, state);
                }
                const stateRef = [...state];
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
                    toggle.classList.toggle('is-active', !!stateRef[idx]);
                    toggle.setAttribute('aria-pressed', stateRef[idx] ? 'true' : 'false');
                    toggle.addEventListener('click', () => {
                        stateRef[idx] = !stateRef[idx];
                        loraTagState.set(loraName, [...stateRef]);
                        toggle.classList.toggle('is-active', stateRef[idx]);
                        toggle.setAttribute('aria-pressed', stateRef[idx] ? 'true' : 'false');
                    });
                    header.append(title, toggle);
                    const body = document.createElement('div');
                    body.className = 'lora-tag-card__body';
                    body.textContent = formatGroupText(group);
                    card.append(header, body);
                    loraTagsWrapper.appendChild(card);
                });
            };

            const characterSearchTokens = buildSearchTokensFromText(last_config?.character);
            const loraCardElements = new Map();
            const loraOptionMeta = new Map();
            const buildLoraSearchIndex = (value, option, metadata, fullDisplayName, fullSubtitle) => {
                const tokens = new Set();
                const addToken = (token) => {
                    if (typeof token !== 'string') return;
                    const trimmed = token.trim();
                    if (!trimmed) return;
                    const lowered = trimmed.toLowerCase();
                    tokens.add(lowered);
                    trimmed.split(/[\s,/_-]+/).forEach(part => {
                        const piece = part.trim().toLowerCase();
                        if (piece) tokens.add(piece);
                    });
                };
                addToken(value);
                if (option?.name) addToken(option.name);
                if (Array.isArray(option?.keywords)) {
                    option.keywords.forEach(addToken);
                }
                if (fullDisplayName) addToken(fullDisplayName);
                if (fullSubtitle) addToken(fullSubtitle);
                if (metadata) {
                    ['name', 'filename', 'alias', 'title'].forEach(key => addToken(metadata[key]));
                    const metadataTags = extractModelTags(metadata);
                    metadataTags.forEach(addToken);
                    const trainedWords = extractTrainedWords(metadata);
                    trainedWords.forEach(addToken);
                }
                return Array.from(tokens).join(' ');
            };
            const reorderLoraCardsForCharacterMatch = () => {
                if (!loraCardGrid || !characterSearchTokens.length) return;
                const entries = Array.from(loraCardElements.entries());
                entries.sort((a, b) => {
                    const metaA = loraOptionMeta.get(a[0]);
                    const metaB = loraOptionMeta.get(b[0]);
                    const rankA = metaA?.matchesCharacter ? 0 : 1;
                    const rankB = metaB?.matchesCharacter ? 0 : 1;
                    if (rankA !== rankB) return rankA - rankB;
                    const orderA = metaA?.originalOrder ?? 0;
                    const orderB = metaB?.originalOrder ?? 0;
                    return orderA - orderB;
                });
                entries.forEach(([, card]) => loraCardGrid.appendChild(card));
            };
            const applyLoraSearchFilter = () => {
                if (!loraCardGrid) return;
                const query = (loraSearchInput?.value || '').trim().toLowerCase();
                loraCardElements.forEach((card, key) => {
                    const meta = loraOptionMeta.get(key);
                    const haystack = meta?.searchIndex || '';
                    const isMatch = !query || haystack.includes(query);
                    card.style.display = isMatch ? '' : 'none';
                });
            };
            const updateToggleSummary = (value) => {
                if (!loraToggle) return;
                const meta = loraOptionMeta.get(value) || {};
                const displayName = meta.displayName || value || 'None';
                const subtitle = (value === 'None')
                    ? 'Không dùng LoRA'
                    : (meta.subtitle || value || '');
                if (loraToggleTitle) {
                    loraToggleTitle.textContent = displayName;
                }
                if (loraToggleSubtitle) {
                    loraToggleSubtitle.textContent = subtitle;
                }
                if (loraToggleThumb) {
                    if (meta.thumbUrl) {
                        loraToggleThumb.innerHTML = `<img src="${escapeAttr(meta.thumbUrl)}" alt="${escapeAttr(displayName)}" loading="lazy">`;
                    } else {
                        loraToggleThumb.innerHTML = `<span class="material-symbols-outlined">${value === 'None' ? 'block' : 'image'}</span>`;
                    }
                }
            };
            const setLoraSelection = (value, { dispatchEvent = false } = {}) => {
                if (!loraInput) return;
                const normalized = value || 'None';
                const previousValue = loraInput.value;
                loraInput.value = normalized;
                loraCardElements.forEach((card, key) => {
                    const isActive = key === normalized;
                    card.classList.toggle('is-selected', isActive);
                    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
                    card.setAttribute('aria-selected', isActive ? 'true' : 'false');
                });
                updateToggleSummary(normalized);
                if (dispatchEvent && previousValue !== normalized) {
                    loraInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                renderLoraTags(normalized);
            };

            const updateSearchButtonState = () => {
                if (!loraSearchButton) return;
                const hasQuery = !!(loraSearchInput && loraSearchInput.value.trim());
                loraSearchButton.disabled = !hasQuery;
            };

            if (loraSearchInput) {
                const handleSearchInput = () => {
                    applyLoraSearchFilter();
                    updateSearchButtonState();
                };
                const handleSearchKeydown = (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        applyLoraSearchFilter();
                        updateSearchButtonState();
                    }
                };
                loraSearchInput.addEventListener('input', handleSearchInput);
                loraSearchInput.addEventListener('keydown', handleSearchKeydown);
                cleanupFns.push(() => {
                    loraSearchInput.removeEventListener('input', handleSearchInput);
                    loraSearchInput.removeEventListener('keydown', handleSearchKeydown);
                });
            }
            if (loraSearchButton) {
                const handleSearchClick = (event) => {
                    event.preventDefault();
                    if (loraSearchInput) {
                        if (!loraSearchInput.value) return;
                        loraSearchInput.value = '';
                    }
                    applyLoraSearchFilter();
                    updateSearchButtonState();
                    if (loraSearchInput) {
                        loraSearchInput.focus();
                    }
                };
                loraSearchButton.addEventListener('click', handleSearchClick);
                cleanupFns.push(() => loraSearchButton.removeEventListener('click', handleSearchClick));
            }

            if (loraCardGrid && loraInput) {
                loraCardGrid.innerHTML = '';
                loraCardElements.clear();
                loraOptionMeta.clear();
                const cardOptions = Array.isArray(loraOptions) && loraOptions.length
                    ? loraOptions
                    : [{ name: 'None', value: 'None' }];
                let cardOrder = 0;
                cardOptions.forEach((option) => {
                    if (!option) return;
                    const value = option.value ?? option.name ?? '';
                    if (typeof value !== 'string') return;
                    const metadata = value === 'None' ? null : findLoraMetadata(value);
                    let displayName = value === 'None'
                        ? (option.name || 'None')
                        : resolveLoraCharacterName(metadata, option.name || value);
                    let subtitle = value === 'None'
                        ? 'Không dùng LoRA'
                        : (metadata?.filename || metadata?.name || option.name || value);
                    const fullDisplayName = displayName;
                    const fullSubtitle = subtitle;
                    displayName = truncateText(displayName, 40);
                    subtitle = truncateText(subtitle, 40);
                    const searchIndex = buildLoraSearchIndex(value, option, metadata, fullDisplayName, fullSubtitle);
                    const matchesCharacter = characterSearchTokens.length > 0
                        ? characterSearchTokens.some(term => searchIndex.includes(term))
                        : false;
                    const thumbUrl = value === 'None' ? null : getLoraThumbnailUrl(metadata);
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = 'lora-card';
                    card.dataset.value = value;
                    card.dataset.isCharacterMatch = matchesCharacter ? 'true' : 'false';
                    card.setAttribute('role', 'option');
                    card.setAttribute('aria-pressed', 'false');
                    card.setAttribute('aria-selected', 'false');
                    card.innerHTML = `
                        <div class="lora-card__thumb">
                            ${thumbUrl
                                ? `<img src="${escapeAttr(thumbUrl)}" alt="${escapeAttr(displayName)}" loading="lazy">`
                                : `<span class="material-symbols-outlined">${value === 'None' ? 'block' : 'image'}</span>`}
                        </div>
                        <div class="lora-card__meta">
                            <span class="lora-card__title">${escapeHtml(displayName)}</span>
                            <span class="lora-card__subtitle">${escapeHtml(subtitle || '')}</span>
                        </div>
                    `;
                    card.title = fullSubtitle || fullDisplayName || displayName;
                    card.dataset.searchIndex = searchIndex;
                    const originalOrder = cardOrder++;
                    loraOptionMeta.set(value, {
                        displayName,
                        subtitle,
                        thumbUrl,
                        metadata,
                        fullDisplayName,
                        fullSubtitle,
                        searchIndex,
                        matchesCharacter,
                        originalOrder
                    });
                    card.addEventListener('click', () => {
                        if (loraInput.value === value) {
                            renderLoraTags(value);
                            setLoraPanelOpen(false);
                            return;
                        }
                        setLoraSelection(value, { dispatchEvent: true });
                        setLoraPanelOpen(false);
                    });
                    const thumbElement = card.querySelector('.lora-card__thumb');
                    if (thumbElement && metadata) {
                        thumbElement.classList.add('is-clickable');
                        thumbElement.addEventListener('click', (event) => {
                            event.stopPropagation();
                            openSimpleViewer(metadata, thumbUrl);
                        });
                    }
                    loraCardGrid.appendChild(card);
                    loraCardElements.set(value, card);
                });
                reorderLoraCardsForCharacterMatch();
                const initialValue = loraInput.value || 'None';
                setLoraSelection(initialValue, { dispatchEvent: false });
                applyLoraSearchFilter();
                updateSearchButtonState();
            } else if (loraInput) {
                loraInput.addEventListener('change', (event) => {
                    renderLoraTags(event.target.value);
                    updateToggleSummary(event.target.value);
                });
                renderLoraTags(loraInput.value);
                updateToggleSummary(loraInput.value);
            } else {
                renderLoraTags('None');
                updateToggleSummary('None');
            }

            if (window.Yuuka?.ui?._initTagAutocomplete) {
                window.Yuuka.ui._initTagAutocomplete(dialog, tagPredictions);
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
                ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative', 'lora_name', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name']
                    .forEach(k => {
                        if (form.elements[k]) {
                            payload[k] = form.elements[k].value;
                        }
                    });
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

                payload.lora_prompt_tags = getSelectedLoraPromptTags();
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
                        existingLoraSelections = Array.isArray(payload.lora_prompt_tags) ? payload.lora_prompt_tags.slice() : [];
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
