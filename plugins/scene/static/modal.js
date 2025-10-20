(function () {
    const ensureNamespace = () => {
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.plugins = window.Yuuka.plugins || {};
    };

    const ct = (key, label, value) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><textarea id="cfg-${key}" name="${key}" rows="2">${value || ''}</textarea></div>`;
    const cs = (key, label, value, min, max, step) =>
        `<div class="form-group form-group-slider"><label for="cfg-${key}">${label}: <span id="val-${key}">${value}</span></label><input type="range" id="cfg-${key}" name="${key}" value="${value}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${key}').textContent = this.value"></div>`;
    const cse = (key, label, value, options) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><select id="cfg-${key}" name="${key}">${options.map(opt => `<option value="${opt.value}" ${opt.value == value ? 'selected' : ''}>${opt.name}</option>`).join('')}</select></div>`;
    const cnum = (key, label, value, min, max, step) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><input type="number" id="cfg-${key}" name="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></div>`;
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

    ensureNamespace();

    async function openSettingsModal(options = {}) {
        const modal = document.createElement('div');
        modal.className = 'modal-backdrop settings-modal-backdrop';
        if (options.modalClass) {
            modal.classList.add(options.modalClass);
        }
        document.body.appendChild(modal);
        modal.innerHTML = `<div class="modal-dialog"><h3>${options.title || '�?ang tải...'}</h3></div>`;
        const cleanupFns = [];
        const close = () => {
            cleanupFns.forEach(fn => {
                try { fn(); } catch (_) { /* noop */ }
            });
            modal.remove();
        };

        try {
            const defaults = {
                quantity_per_stage: 1,
                quality: '',
                negative: '',
                lora_name: 'None',
                lora_prompt_tags: [],
                steps: 25,
                cfg: 3.0,
                seed: 0,
                sampler_name: 'euler_ancestral',
                scheduler: 'karras',
                ckpt_name: 'waiNSFWIllustrious_v150.safetensors',
                server_address: '127.0.0.1:8888',
                width: 832,
                height: 1216
            };

            const info = typeof options.fetchInfo === 'function'
                ? await options.fetchInfo()
                : {};

            const rawConfig = info?.config || info?.last_config || options.config || {};
            const config = { ...defaults, ...rawConfig };
            if (!Array.isArray(config.lora_prompt_tags)) {
                config.lora_prompt_tags = [];
            }

            const currentSizeValue = `${config.width}x${config.height}`;
            const stepsValue = Number.isFinite(Number(config.steps)) ? Number(config.steps) : defaults.steps;
            const cfgValue = Number.isFinite(Number(config.cfg)) ? Number(config.cfg) : defaults.cfg;
            const globalChoices = info?.global_choices || {};

            const tagPredictions = typeof api?.getTags === 'function'
                ? await api.getTags().catch(() => [])
                : [];

            let loraMetadataMap = {};
            try {
                if (api?.['lora-downloader'] && typeof api['lora-downloader'].get === 'function') {
                    const loraResponse = await api['lora-downloader'].get('/lora-data');
                    if (loraResponse && typeof loraResponse.models === 'object') {
                        loraMetadataMap = loraResponse.models;
                    }
                }
            } catch (err) {
                console.warn('[SceneModal] Unable to fetch LoRA metadata:', err);
            }

            const ensureChoiceOptions = (choices, fallbackValue, fallbackLabel) => {
                if (Array.isArray(choices) && choices.length > 0) {
                    return choices.map(entry => {
                        if (typeof entry === 'string') {
                            return { name: entry, value: entry };
                        }
                        if (typeof entry === 'object' && entry !== null) {
                            const name = entry.name ?? entry.label ?? entry.value ?? '';
                            const value = entry.value ?? entry.name ?? '';
                            return { name, value };
                        }
                        return null;
                    }).filter(Boolean);
                }
                if (!fallbackValue) return [];
                return [{ name: fallbackLabel || fallbackValue, value: fallbackValue }];
            };

            let loraOptions = ensureChoiceOptions(globalChoices.loras, config.lora_name || 'None', config.lora_name || 'None');
            if (!loraOptions.some(opt => opt.value === 'None')) {
                loraOptions.unshift({ name: 'None', value: 'None' });
            }
            const sizeOptions = ensureChoiceOptions(globalChoices.sizes, currentSizeValue, currentSizeValue);
            const samplerOptions = ensureChoiceOptions(globalChoices.samplers, config.sampler_name, config.sampler_name);
            const schedulerOptions = ensureChoiceOptions(globalChoices.schedulers, config.scheduler, config.scheduler);
            const checkpointOptions = ensureChoiceOptions(globalChoices.checkpoints, config.ckpt_name, config.ckpt_name);

            const dialog = modal.querySelector('.modal-dialog');
            const title = options.title || 'Cấu hình Scene';
            const columnsHTML = `
                <div class="album-settings-columns">
                    <div class="album-settings-column" data-column="prompt-lora">
                        <h4>Prompts &amp; LoRA</h4>
                        <div class="album-settings-subsection">
                            <h5>Prompts</h5>
                            ${ct('quality', 'Quality', config.quality)}
                            ${ct('negative', 'Negative', config.negative)}
                        </div>
                        <div class="album-settings-subsection">
                            <h5>LoRA</h5>
                            ${cse('lora_name', 'LoRA Name', config.lora_name || 'None', loraOptions)}
                            <div class="lora-tags-wrapper"></div>
                        </div>
                    </div>
                    <div class="album-settings-column" data-column="configs">
                        <h4>Cài đặt</h4>
                        ${cnum('quantity_per_stage', 'Images per Stage', config.quantity_per_stage, 1, 10, 1)}
                        ${cs('steps', 'Steps', stepsValue, 1, 100, 1)}
                        ${cs('cfg', 'CFG', cfgValue.toFixed(1), 1.0, 15.0, 0.1)}
                        ${cnum('seed', 'Seed (0 = random)', config.seed, 0, Number.MAX_SAFE_INTEGER, 1)}
                        ${cse('size', 'W x H', currentSizeValue, sizeOptions)}
                        ${cse('sampler_name', 'Sampler', config.sampler_name, samplerOptions)}
                        ${cse('scheduler', 'Scheduler', config.scheduler, schedulerOptions)}
                        ${cse('ckpt_name', 'Checkpoint', config.ckpt_name, checkpointOptions)}
                        ${ciwb('server_address', 'Server Address', config.server_address)}
                    </div>
                </div>
            `;

            dialog.innerHTML = `
                <h3>${title}</h3>
                <div class="settings-form-container album-settings-container">
                    <form id="scene-settings-form">${columnsHTML}</form>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-cancel" title="�?óng"><span class="material-symbols-outlined">close</span></button>
                    <button type="submit" class="btn-save" title="Lưu" form="scene-settings-form"><span class="material-symbols-outlined">save</span></button>
                </div>
            `;

            const form = dialog.querySelector('#scene-settings-form');
            const saveBtn = dialog.querySelector('.btn-save');
            const cancelBtn = dialog.querySelector('.btn-cancel');
            const loraSelect = form?.elements?.['lora_name'];
            const loraFieldGroup = loraSelect ? loraSelect.closest('.form-group') : null;
            let loraTagsWrapper = null;
            if (loraFieldGroup) {
                loraTagsWrapper = loraFieldGroup.querySelector('.lora-tags-wrapper');
                if (!loraTagsWrapper) {
                    loraTagsWrapper = document.createElement('div');
                    loraTagsWrapper.className = 'lora-tags-wrapper';
                    loraFieldGroup.appendChild(loraTagsWrapper);
                }
            }

            const columnsContainer = dialog.querySelector('.album-settings-columns');
            const columns = Array.from(dialog.querySelectorAll('.album-settings-column'));
            const tabsNav = document.createElement('div');
            tabsNav.className = 'album-settings-tabs';
            const tabButtons = [];
            let activeTab = columns[0]?.dataset.column || 'prompt-lora';
            columns.forEach(col => {
                const columnId = col.dataset.column;
                const label = col.querySelector('h4')?.textContent?.trim() || columnId;
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.target = columnId;
                button.textContent = label;
                tabsNav.appendChild(button);
                tabButtons.push(button);
            });

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
                    if (!tabsNav.parentElement && columnsContainer.parentElement) {
                        columnsContainer.parentElement.insertBefore(tabsNav, columnsContainer);
                    }
                    setActiveTab(activeTab);
                } else {
                    if (tabsNav.parentElement) {
                        tabsNav.parentElement.removeChild(tabsNav);
                    }
                    columns.forEach(col => col.classList.add('is-active'));
                    tabButtons.forEach(btn => btn.classList.remove('is-active'));
                }
            };
            mobileQuery.addEventListener('change', applyLayout);
            cleanupFns.push(() => mobileQuery.removeEventListener('change', applyLayout));
            applyLayout();

            dialog.querySelectorAll('textarea').forEach(t => {
                const autoResize = () => {
                    t.style.height = 'auto';
                    t.style.height = `${t.scrollHeight}px`;
                };
                t.addEventListener('input', autoResize);
                setTimeout(autoResize, 0);
            });

            const connectBtn = form?.querySelector('.connect-btn');
            const serverAddressInput = form?.elements?.['server_address'];

            const loraMetadataList = Object.values(loraMetadataMap || {});
            let existingLoraSelections = Array.isArray(config.lora_prompt_tags) ? config.lora_prompt_tags.slice() : [];
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
                    const titleSpan = document.createElement('span');
                    titleSpan.textContent = `LoRA tags ${idx + 1}`;
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
                    header.append(titleSpan, toggle);
                    const body = document.createElement('div');
                    body.className = 'lora-tag-card__body';
                    body.textContent = formatGroupText(group);
                    card.append(header, body);
                    loraTagsWrapper.appendChild(card);
                });
            };

            if (loraSelect && loraTagsWrapper) {
                loraSelect.addEventListener('change', (event) => {
                    renderLoraTags(event.target.value);
                });
                renderLoraTags(loraSelect.value);
            }

            if (typeof window.Yuuka?.ui?._initTagAutocomplete === 'function') {
                window.Yuuka.ui._initTagAutocomplete(dialog, tagPredictions);
            }

            const populateSelect = (name, optionsList, fallbackValue) => {
                const select = form?.elements?.[name];
                if (!select || !Array.isArray(optionsList) || optionsList.length === 0) {
                    return;
                }
                const previousValue = select.value;
                select.innerHTML = optionsList.map(opt => `<option value="${opt.value}" ${opt.value == previousValue ? 'selected' : ''}>${opt.name}</option>`).join('');
                if (!optionsList.some(opt => opt.value == select.value)) {
                    if (optionsList.some(opt => opt.value == previousValue)) {
                        select.value = previousValue;
                    } else if (optionsList.some(opt => opt.value == fallbackValue)) {
                        select.value = fallbackValue;
                    } else {
                        select.selectedIndex = 0;
                    }
                }
            };

            const loadChoices = async (address, { silent } = { silent: false }) => {
                if (!address || typeof options.fetchGlobalChoices !== 'function') return null;
                try {
                    const choices = await options.fetchGlobalChoices(address);
                    if (choices && typeof choices === 'object') {
                        const updatedLoraOpts = ensureChoiceOptions(choices.loras, 'None', 'None');
                        if (!updatedLoraOpts.some(opt => opt.value === 'None')) {
                            updatedLoraOpts.unshift({ name: 'None', value: 'None' });
                        }
                        populateSelect('lora_name', updatedLoraOpts, loraSelect?.value || 'None');
                        populateSelect('size', ensureChoiceOptions(choices.sizes, currentSizeValue, currentSizeValue), form.elements['size']?.value || currentSizeValue);
                        populateSelect('sampler_name', ensureChoiceOptions(choices.samplers, config.sampler_name, config.sampler_name), form.elements['sampler_name']?.value || config.sampler_name);
                        populateSelect('scheduler', ensureChoiceOptions(choices.schedulers, config.scheduler, config.scheduler), form.elements['scheduler']?.value || config.scheduler);
                        populateSelect('ckpt_name', ensureChoiceOptions(choices.checkpoints, config.ckpt_name, config.ckpt_name), form.elements['ckpt_name']?.value || config.ckpt_name);
                        if (loraSelect) {
                            renderLoraTags(loraSelect.value);
                        }
                    }
                    if (!silent) {
                        showError('�?ã cập nhật lựa chọn từ ComfyUI.');
                    }
                    return choices;
                } catch (err) {
                    if (!silent) {
                        showError(`Không thể tải lựa chọn từ ComfyUI: ${err.message || err}`);
                    }
                    return null;
                }
            };

            if (connectBtn && serverAddressInput) {
                connectBtn.addEventListener('click', async () => {
                    const address = serverAddressInput.value.trim();
                    if (!address) {
                        showError('Vui lòng nhập địa chỉ ComfyUI.');
                        return;
                    }
                    const originalText = connectBtn.textContent;
                    connectBtn.textContent = '...';
                    connectBtn.disabled = true;
                    try {
                        if (typeof options.checkServerStatus === 'function') {
                            await options.checkServerStatus(address);
                        } else if (api?.server?.checkComfyUIStatus) {
                            await api.server.checkComfyUIStatus(address);
                        }
                        showError('Kết nối thành công!');
                        await loadChoices(address, { silent: true });
                    } catch (err) {
                        showError(`Kết nối thất bại: ${err.message || err}`);
                    } finally {
                        connectBtn.textContent = originalText;
                        connectBtn.disabled = false;
                    }
                });
            }

            if (serverAddressInput?.value) {
                loadChoices(serverAddressInput.value.trim(), { silent: true });
            }

            if (cancelBtn) {
                cancelBtn.addEventListener('click', close);
            }

            const setActionButtonsDisabled = (disabled) => {
                if (saveBtn) saveBtn.disabled = disabled;
                if (connectBtn) connectBtn.disabled = disabled && !connectBtn.disabled;
            };

            const collectFormValues = () => {
                const payload = {};
                payload.quality = form.elements['quality']?.value || '';
                payload.negative = form.elements['negative']?.value || '';
                payload.lora_name = form.elements['lora_name']?.value || 'None';
                payload.steps = parseFloat(form.elements['steps']?.value || stepsValue) || stepsValue;
                payload.cfg = parseFloat(form.elements['cfg']?.value || cfgValue) || cfgValue;
                payload.quantity_per_stage = parseInt(form.elements['quantity_per_stage']?.value || defaults.quantity_per_stage, 10) || defaults.quantity_per_stage;
                payload.seed = parseInt(form.elements['seed']?.value || 0, 10) || 0;
                payload.server_address = (form.elements['server_address']?.value || '').trim() || defaults.server_address;
                payload.sampler_name = form.elements['sampler_name']?.value || defaults.sampler_name;
                payload.scheduler = form.elements['scheduler']?.value || defaults.scheduler;
                payload.ckpt_name = form.elements['ckpt_name']?.value || defaults.ckpt_name;
                const sizeValue = form.elements['size']?.value || currentSizeValue;
                const [w, h] = sizeValue.split('x').map(Number);
                payload.width = Number.isFinite(w) ? w : config.width;
                payload.height = Number.isFinite(h) ? h : config.height;
                payload.lora_prompt_tags = payload.lora_name === 'None' ? [] : getSelectedLoraPromptTags();
                return payload;
            };

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const payload = collectFormValues();
                setActionButtonsDisabled(true);
                try {
                    if (typeof options.onSave === 'function') {
                        await options.onSave(payload);
                    }
                    existingLoraSelections = Array.isArray(payload.lora_prompt_tags) ? payload.lora_prompt_tags.slice() : [];
                    showError(options.successMessage || '�?ã lưu cài đặt Scene.');
                    close();
                } catch (err) {
                    showError(`Lỗi khi lưu: ${err.message || err}`);
                } finally {
                    setActionButtonsDisabled(false);
                }
            });
        } catch (e) {
            close();
            const fallback = e?.message ? `Lỗi: ${e.message}` : 'Lỗi: Không thể mở cấu hình Scene.';
            showError(fallback);
        }
    }

    window.Yuuka.plugins.sceneModal = { openSettingsModal };
})();
