(function () {
    const ensureNamespace = () => {
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.plugins = window.Yuuka.plugins || {};
    };

    const ct = (key, label, value) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><textarea id="cfg-${key}" name="${key}" rows="1">${value || ''}</textarea></div>`;
    const cs = (key, label, value, min, max, step) =>
        `<div class="form-group form-group-slider"><label for="cfg-${key}">${label}: <span id="val-${key}">${value}</span></label><input type="range" id="cfg-${key}" name="${key}" value="${value}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${key}').textContent = this.value"></div>`;
    const cse = (key, label, value, options) =>
        `<div class="form-group"><label for="cfg-${key}">${label}</label><select id="cfg-${key}" name="${key}">${options.map(opt => `<option value="${opt.value}" ${opt.value == value ? 'selected' : ''}>${opt.name}</option>`).join('')}</select></div>`;
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

            const columnsHTML = `
                <div class="album-settings-columns">
                    <div class="album-settings-column" data-column="prompts">
                        <h4>Prompts</h4>
                        ${ct('character', 'Character', last_config.character)}
                        ${ct('outfits', 'Outfits', last_config.outfits)}
                        ${ct('expression', 'Expression', last_config.expression)}
                        ${ct('action', 'Action', last_config.action)}
                        ${ct('context', 'Context', last_config.context)}
                        ${ct('quality', 'Quality', last_config.quality)}
                        ${ct('negative', 'Negative', last_config.negative)}
                    </div>
                    <div class="album-settings-column" data-column="lora">
                        <h4>LoRA</h4>
                        ${cse('lora_name', 'LoRA Name', selectedLora, loraOptions)}
                        <div class="lora-tags-wrapper"></div>
                    </div>
                    <div class="album-settings-column" data-column="configs">
                        <h4>Configs</h4>
                        ${cs('steps', 'Steps', last_config.steps, 10, 50, 1)}
                        ${cs('cfg', 'CFG', last_config.cfg, 1.0, 7.0, 0.1)}
                        ${cse('size', 'W x H', `${last_config.width}x${last_config.height}`, global_choices.sizes)}
                        ${cse('sampler_name', 'Sampler', last_config.sampler_name, global_choices.samplers)}
                        ${cse('scheduler', 'Scheduler', last_config.scheduler, global_choices.schedulers)}
                        ${cse('ckpt_name', 'Checkpoint', last_config.ckpt_name, global_choices.checkpoints)}
                        ${ciwb('server_address', 'Server Address', last_config.server_address)}
                    </div>
                </div>
            `;

            dialog.innerHTML = `
                <h3>${options.title}</h3>
                <div class="settings-form-container album-settings-container">
                    <form id="album-settings-form">${columnsHTML}</form>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-paste" title="Dán"><span class="material-symbols-outlined">content_paste</span></button>
                    <button type="button" class="btn-copy" title="Copy"><span class="material-symbols-outlined">content_copy</span></button>
                    <button type="button" class="btn-cancel" title="Hủy"><span class="material-symbols-outlined">close</span></button>
                    <button type="submit" class="btn-save" title="Lưu" form="album-settings-form"><span class="material-symbols-outlined">save</span></button>
                    <button type="button" class="btn-generate" title="Generate" style="display:none"><span class="material-symbols-outlined">auto_awesome</span></button>
                </div>
            `;

            const form = dialog.querySelector('#album-settings-form');
            const saveBtn = dialog.querySelector('.btn-save');
            const generateBtn = dialog.querySelector('.btn-generate');
            const loraSelect = form?.elements?.['lora_name'];
            const loraFieldGroup = loraSelect ? loraSelect.closest('.form-group') : null;
            let loraTagsWrapper = null;
            if (loraFieldGroup) {
                loraTagsWrapper = loraFieldGroup.querySelector('.lora-tags-wrapper');
                if (!loraTagsWrapper) {
                    const column = loraFieldGroup.parentElement;
                    loraTagsWrapper = column ? column.querySelector('.lora-tags-wrapper') : null;
                }
            } else {
                const column = dialog.querySelector('[data-column="lora"]');
                loraTagsWrapper = column ? column.querySelector('.lora-tags-wrapper') : null;
            }
            if (!loraTagsWrapper) {
                const column = dialog.querySelector('[data-column="lora"]');
                if (column) {
                    loraTagsWrapper = document.createElement('div');
                    loraTagsWrapper.className = 'lora-tags-wrapper';
                    column.appendChild(loraTagsWrapper);
                }
            }
            const connectBtn = dialog.querySelector('.connect-btn');

            const columnsContainer = dialog.querySelector('.album-settings-columns');
            const columns = Array.from(columnsContainer.querySelectorAll('.album-settings-column'));
            columns.forEach(col => col.classList.add('is-active'));

            const tabsNav = document.createElement('div');
            tabsNav.className = 'album-settings-tabs';
            const tabButtons = [];
            let activeTab = columns[0]?.dataset.column || 'prompts';
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

            if (loraSelect && loraTagsWrapper) {
                loraSelect.addEventListener('change', (event) => {
                    renderLoraTags(event.target.value);
                });
                renderLoraTags(loraSelect.value);
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

            dialog.querySelector('.btn-cancel').addEventListener('click', close);
            dialog.querySelector('.btn-copy').addEventListener('click', () => {
                const keys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
                options.promptClipboard = new Map(keys.map(k => [k, form.elements[k] ? form.elements[k].value.trim() : '']));
                showError("Prompt đã sao chép.");
            });
            dialog.querySelector('.btn-paste').addEventListener('click', () => {
                if (!options.promptClipboard) { showError("Chưa có prompt."); return; }
                options.promptClipboard.forEach((v, k) => {
                    if (form.elements[k]) form.elements[k].value = v;
                });
                dialog.querySelectorAll('textarea').forEach(t => t.dispatchEvent(new Event('input', { bubbles: true })));
                showError("Đã dán prompt.");
            });

            const collectFormValues = () => {
                const payload = {};
                ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative', 'lora_name', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name']
                    .forEach(k => payload[k] = form.elements[k].value);
                ['steps', 'cfg'].forEach(k => payload[k] = parseFloat(form.elements[k].value));
                const [w, h] = form.elements['size'].value.split('x').map(Number);
                payload.width = w;
                payload.height = h;
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
                            showError(`Lỗi khi tạo: ${err.message}`);
                            return;
                        }
                    }
                        existingLoraSelections = Array.isArray(payload.lora_prompt_tags) ? payload.lora_prompt_tags.slice() : [];
                    const successMessage = shouldGenerate && typeof options.onGenerate === 'function'
                        ? 'Đã lưu và bắt đầu tạo ảnh.'
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
                    showError("Vui lòng nhập địa chỉ ComfyUI.");
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
            let friendlyMessage = "Lỗi: Không thể tải cấu hình.";
            if (e?.message && (e.message.includes("10061") || e.message.toLowerCase().includes("connection refused"))) {
                friendlyMessage = "Lỗi: Không thể kết nối tới ComfyUI để lấy cấu hình.";
            } else if (e?.message) {
                friendlyMessage = `Lỗi tải cấu hình: ${e.message}`;
            }
            showError(friendlyMessage);
        }
    }

    window.Yuuka.plugins.albumModal = { openSettingsModal };
})();
