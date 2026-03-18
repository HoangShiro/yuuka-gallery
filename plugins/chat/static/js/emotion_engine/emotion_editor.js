class EmotionEditor {
    constructor(engineInstance) {
        this.engine = engineInstance;
        this.previewEngine = new window.EmotionEngine(this.engine.apiUrl);
        this.rules = null;
        this.modalEl = null;
        this.previewStateStr = '{ "happy": 5, "embarrassed": 10 }';
        this._saveTimer = null;
    }

    _scheduleAutoSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._autoSave(), 800);
    }

    async _autoSave() {
        const indicator = this.modalEl?.querySelector('#ee-save-indicator');
        if (indicator) { indicator.textContent = 'Saving…'; indicator.style.opacity = '1'; indicator.style.color = 'var(--chat-primary)'; }
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(this.engine.apiUrl, {
                method: 'POST', headers,
                body: JSON.stringify(this.rules)
            });
            if (!res.ok) throw new Error(await res.text());
            await this.engine.reloadRules();
            if (indicator) { indicator.textContent = 'Saved'; setTimeout(() => { indicator.style.opacity = '0'; }, 1200); }
        } catch (e) {
            if (indicator) { indicator.textContent = 'Save failed'; indicator.style.color = 'red'; }
        }
    }

    async open() {
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(this.engine.apiUrl, { headers });
            if (!res.ok) throw new Error("Failed to load rules");
            this.rules = await res.json();
            // Migrate v1 format
            if (this.rules.types && !Array.isArray(this.rules.types)) {
                const legacy = this.rules.types;
                this.rules.types = [...(legacy.emotion || []), ...(legacy.condition || [])];
            }
            this.previewEngine.rules = JSON.parse(JSON.stringify(this.rules));

            const defaultPreview = {};
            const types = this.rules.types || [];
            if (types.length > 0) {
                defaultPreview[types[0]] = 5;
                if (types.length > 1) {
                    defaultPreview[types[1]] = 10;
                }
            }
            this.previewStateStr = JSON.stringify(defaultPreview, null, 2);

            this._renderModal();
        } catch (e) {
            alert("Error loading Emotion Engine rules: " + e.message);
        }
    }

    /* ═══════════════════════════════════════════════════
       MOBILE LAYOUT
       ═══════════════════════════════════════════════════ */
    _renderModal() {
        if (this.modalEl) this.modalEl.remove();

        this.modalEl = document.createElement('div');
        this.modalEl.className = 'emotion-editor-modal';
        this.modalEl.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: var(--chat-bg); z-index: 10000;
            display: flex; flex-direction: column;
            font-family: sans-serif; color: var(--chat-text);
        `;

        /* Header */
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px; background: var(--chat-panel-bg);
            border-bottom: 1px solid var(--chat-border); flex-shrink: 0;
        `;
        header.innerHTML = `
            <div style="font-size: 1.05rem; font-weight: 700;">Emotion Rules</div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span id="ee-save-indicator" style="font-size: 12px; color: var(--chat-primary); opacity: 0; transition: opacity 0.3s;"></span>
                <button id="ee-m-close" style="padding: 7px 14px; background: transparent; color: var(--chat-text); border: 1px solid var(--chat-border); border-radius: 8px; font-size: 13px; cursor: pointer;">✕</button>
            </div>
        `;

        /* Tab bar */
        const tabBar = document.createElement('div');
        tabBar.style.cssText = `
            display: flex; gap: 6px; padding: 10px 16px;
            background: var(--chat-panel-bg); border-bottom: 1px solid var(--chat-border);
            overflow-x: auto; flex-shrink: 0; -webkit-overflow-scrolling: touch;
        `;
        const tabs = [
            { key: 'types', label: 'Types' },
            { key: 'steps', label: 'Steps' },
            { key: 'mapping', label: 'Tags' },
            { key: 'conflicts', label: 'Conflicts' }
        ];
        tabs.forEach((tab, i) => {
            const btn = document.createElement('button');
            btn.className = 'ee-m-tab';
            btn.dataset.tab = tab.key;
            btn.textContent = tab.label;
            btn.style.cssText = `
                padding: 8px 18px; border-radius: 20px; border: none; font-size: 13px;
                font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s;
                ${i === 0 ? 'background: var(--chat-primary); color: var(--chat-panel-bg);' : 'background: var(--chat-bg); color: var(--chat-text-secondary);'}
            `;
            tabBar.appendChild(btn);
        });

        /* Content */
        const mainArea = document.createElement('div');
        mainArea.id = 'ee-main-area';
        mainArea.style.cssText = 'flex: 1; overflow-y: auto; padding: 16px; padding-bottom: 80px; -webkit-overflow-scrolling: touch;';

        /* Preview toggle */
        const previewPanel = document.createElement('div');
        previewPanel.style.cssText = `
            border-top: 1px solid var(--chat-border); background: var(--chat-panel-bg);
            flex-shrink: 0; overflow: hidden; transition: max-height 0.3s ease;
            max-height: 0;
        `;
        previewPanel.innerHTML = `
            <div style="padding: 12px 16px;">
                <div style="font-size: 12px; font-weight: 600; margin-bottom: 6px;">Preview Simulator</div>
                <textarea id="ee-m-sim-state" style="width: 100%; height: 60px; background: var(--chat-bg); color: var(--chat-primary); border: 1px solid var(--chat-border); resize: none; font-family: monospace; font-size: 11px; box-sizing: border-box; border-radius: 8px; padding: 8px;">${this.previewStateStr}</textarea>
                <div id="ee-m-sim-eval" style="margin-top: 6px; font-size: 11px; background: var(--chat-bg); color: var(--chat-text); padding: 8px; border-radius: 8px; border: 1px solid var(--chat-border);">Waiting...</div>
            </div>
        `;

        const previewToggle = document.createElement('button');
        previewToggle.textContent = '▲ Preview';
        previewToggle.style.cssText = `
            width: 100%; padding: 8px; background: var(--chat-panel-bg); color: var(--chat-text-secondary);
            border: none; border-top: 1px solid var(--chat-border); font-size: 12px; font-weight: 600;
            cursor: pointer; flex-shrink: 0;
        `;
        let previewOpen = false;
        previewToggle.addEventListener('click', () => {
            previewOpen = !previewOpen;
            previewPanel.style.maxHeight = previewOpen ? '220px' : '0';
            previewToggle.textContent = previewOpen ? '▼ Preview' : '▲ Preview';
        });

        this.modalEl.appendChild(header);
        this.modalEl.appendChild(tabBar);
        this.modalEl.appendChild(mainArea);
        this.modalEl.appendChild(previewPanel);
        this.modalEl.appendChild(previewToggle);

        const container = document.getElementById('chat-app') || document.body;
        container.appendChild(this.modalEl);

        /* Events */
        header.querySelector('#ee-m-close').addEventListener('click', () => this.close());

        const simBox = previewPanel.querySelector('#ee-m-sim-state');
        simBox.addEventListener('input', () => {
            this.previewStateStr = simBox.value;
            this.updatePreview();
        });

        tabBar.querySelectorAll('.ee-m-tab').forEach(t => {
            t.addEventListener('click', () => {
                tabBar.querySelectorAll('.ee-m-tab').forEach(b => {
                    b.style.background = 'var(--chat-bg)';
                    b.style.color = 'var(--chat-text-secondary)';
                });
                t.style.background = 'var(--chat-primary)';
                t.style.color = 'var(--chat-panel-bg)';
                this.renderTab(t.dataset.tab);
            });
        });

        this.renderTab('types');
    }

    renderTab(tabName) {
        const area = document.getElementById('ee-main-area');
        area.innerHTML = '';
        this.updatePreviewEngine();

        if (tabName === 'types') this._renderTypes(area);
        else if (tabName === 'steps') this._renderSteps(area);
        else if (tabName === 'mapping') this._renderMapping(area);
        else if (tabName === 'conflicts') this._renderConflicts(area);
    }

    _renderTypes(area) {
        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">Managed Types</div>
            <div style="padding: 12px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border); margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px;">
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--chat-text);">
                    <span>Max types/msg</span>
                    <input id="ee-m-max-types" type="number" min="1" max="10" value="${this.rules.max_types || 3}" style="width: 52px; padding: 8px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                </label>
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--chat-text);">
                    <span>Max tag types</span>
                    <input id="ee-m-max-tag" type="number" min="1" max="10" value="${this.rules.max_tag_types || 2}" style="width: 52px; padding: 8px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                </label>
                <label style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--chat-text);">
                    <span>Time skip turns</span>
                    <input id="ee-m-time-skip" type="number" min="1" max="50" value="${this.rules.time_skip_turns || 9}" style="width: 52px; padding: 8px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                </label>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <input id="ee-m-new-type" type="text" placeholder="snake_case" style="flex: 1; padding: 10px 12px; border-radius: 10px; outline: none; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;" />
                <button id="ee-m-add-type" style="padding: 10px 16px; cursor: pointer; background: var(--chat-primary); color: var(--chat-panel-bg); border: none; border-radius: 10px; font-weight: 700; font-size: 14px;">+</button>
            </div>
            <div id="ee-m-types-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(max(240px, calc(33.333% - 8px)), 1fr)); gap: 12px;"></div>
        `;

        const renderList = () => {
            const list = area.querySelector('#ee-m-types-list');
            list.innerHTML = '';
            const types = this.rules.types || [];
            if (!this.rules.reduce_value) this.rules.reduce_value = {};
            if (!this.rules.cap_per_turn) this.rules.cap_per_turn = {};
            if (!this.rules.reduce_type) this.rules.reduce_type = {};
            types.forEach(t => {
                const reduceVal = this.rules.reduce_value[t] !== undefined ? this.rules.reduce_value[t] : -5;
                const capVal = this.rules.cap_per_turn[t] !== undefined ? this.rules.cap_per_turn[t] : 10;
                const rType = this.rules.reduce_type[t] !== undefined ? this.rules.reduce_type[t] : 'on_idle';
                const card = document.createElement('div');
                card.style.cssText = 'box-sizing: border-box; padding: 12px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);';
                card.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <input type="text" data-rename="${t}" value="${t}" title="Tap to rename" style="font-weight: 600; font-size: 14px; cursor: text; color: var(--chat-primary); background: transparent; border: 1px solid transparent; outline: none; padding: 2px 4px; border-radius: 4px; width: calc(100% - 30px); transition: border-color 0.2s, background 0.2s; box-sizing: border-box;" />
                        <button style="background: transparent; border: none; color: red; cursor: pointer; font-size: 18px; padding: 4px 8px; line-height: 1;" data-del="${t}">✕</button>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--chat-text-secondary);">Cap
                            <input type="number" data-cap-type="${t}" value="${capVal}" style="width: 48px; padding: 7px 6px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 13px;" />
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--chat-text-secondary);">Reduce
                            <select data-reduce-mode="${t}" style="padding: 6px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 12px;">
                                <option value="on_idle" ${rType === 'on_idle' ? 'selected' : ''}>Idle</option>
                                <option value="always" ${rType === 'always' ? 'selected' : ''}>All</option>
                            </select>
                            <input type="number" data-reduce-type="${t}" value="${reduceVal}" style="width: 48px; padding: 7px 6px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 13px;" />
                        </label>
                    </div>
                `;
                list.appendChild(card);
            });

            list.querySelectorAll('input[data-reduce-type]').forEach(inp => {
                inp.addEventListener('change', () => {
                    const val = parseInt(inp.value);
                    if (!isNaN(val)) { this.rules.reduce_value[inp.dataset.reduceType] = val; this.updatePreviewEngine(); this._scheduleAutoSave(); }
                });
            });
            list.querySelectorAll('input[data-cap-type]').forEach(inp => {
                inp.addEventListener('change', () => {
                    const val = parseInt(inp.value);
                    if (!isNaN(val)) { this.rules.cap_per_turn[inp.dataset.capType] = val; this.updatePreviewEngine(); this._scheduleAutoSave(); }
                });
            });
            list.querySelectorAll('select[data-reduce-mode]').forEach(sel => {
                sel.addEventListener('change', () => {
                    this.rules.reduce_type[sel.dataset.reduceMode] = sel.value; this.updatePreviewEngine(); this._scheduleAutoSave();
                });
            });
            list.querySelectorAll('button[data-del]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tg = btn.dataset.del;
                    this.rules.types = this.rules.types.filter(x => x !== tg);
                    delete this.rules.mapping[tg]; delete this.rules.reduce_value[tg];
                    if (this.rules.cap_per_turn) delete this.rules.cap_per_turn[tg];
                    if (this.rules.reduce_type) delete this.rules.reduce_type[tg];
                    renderList(); this.updatePreviewEngine(); this._scheduleAutoSave();
                });
            });

            list.querySelectorAll('input[data-rename]').forEach(inp => {
                inp.addEventListener('focus', () => {
                    inp.style.borderColor = 'var(--chat-border)';
                    inp.style.background = 'var(--chat-bg)';
                });
                const saveRename = () => {
                    inp.style.borderColor = 'transparent';
                    inp.style.background = 'transparent';
                    const oldName = inp.dataset.rename;
                    const newName = inp.value.trim().toLowerCase();
                    if (!newName || newName === oldName) {
                        inp.value = oldName;
                        return;
                    }
                    if (!/^[a-z_]+$/.test(newName)) {
                        alert('Must be lowercase snake_case');
                        inp.value = oldName;
                        return;
                    }
                    if (this.rules.types.includes(newName)) {
                        alert('Type already exists');
                        inp.value = oldName;
                        return;
                    }

                    const idx = this.rules.types.indexOf(oldName);
                    if (idx !== -1) this.rules.types[idx] = newName;

                    if (this.rules.mapping[oldName]) {
                        this.rules.mapping[newName] = this.rules.mapping[oldName];
                        delete this.rules.mapping[oldName];
                    }
                    if (this.rules.reduce_value[oldName] !== undefined) {
                        this.rules.reduce_value[newName] = this.rules.reduce_value[oldName];
                        delete this.rules.reduce_value[oldName];
                    }
                    if (this.rules.cap_per_turn && this.rules.cap_per_turn[oldName] !== undefined) {
                        this.rules.cap_per_turn[newName] = this.rules.cap_per_turn[oldName];
                        delete this.rules.cap_per_turn[oldName];
                    }
                    if (this.rules.reduce_type && this.rules.reduce_type[oldName] !== undefined) {
                        this.rules.reduce_type[newName] = this.rules.reduce_type[oldName];
                        delete this.rules.reduce_type[oldName];
                    }
                    if (this.rules.conflict_rules) {
                        this.rules.conflict_rules.forEach(cr => {
                            if (cr.typeA === oldName) cr.typeA = newName;
                            if (cr.typeB === oldName) cr.typeB = newName;
                        });
                    }
                    renderList(); this.updatePreviewEngine(); this._scheduleAutoSave();
                };
                inp.addEventListener('blur', saveRename);
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        inp.blur();
                    }
                });
            });
        };

        area.querySelector('#ee-m-add-type').addEventListener('click', () => {
            const tv = area.querySelector('#ee-m-new-type').value.trim().toLowerCase();
            if (!tv || !/^[a-z_]+$/.test(tv)) return alert('Must be lowercase snake_case');
            if (this.rules.types.includes(tv)) return alert('Type already exists');
            this.rules.types.push(tv);
            if (!this.rules.mapping[tv]) Object.assign(this.rules.mapping, { [tv]: {} });
            if (this.rules.reduce_value[tv] === undefined) this.rules.reduce_value[tv] = -5;
            if (this.rules.cap_per_turn[tv] === undefined) this.rules.cap_per_turn[tv] = 10;
            if (this.rules.reduce_type[tv] === undefined) this.rules.reduce_type[tv] = 'on_idle';
            area.querySelector('#ee-m-new-type').value = '';
            renderList(); this.updatePreviewEngine(); this._scheduleAutoSave();
        });

        ['ee-m-max-types', 'ee-m-max-tag', 'ee-m-time-skip'].forEach(id => {
            const el = area.querySelector('#' + id);
            if (el) el.addEventListener('change', () => {
                const val = parseInt(el.value);
                if (id === 'ee-m-max-types' && val >= 1 && val <= 10) this.rules.max_types = val;
                if (id === 'ee-m-max-tag' && val >= 1 && val <= 10) this.rules.max_tag_types = val;
                if (id === 'ee-m-time-skip' && val >= 1 && val <= 50) this.rules.time_skip_turns = val;
                this._scheduleAutoSave();
            });
        });

        renderList();
    }

    _renderSteps(area) {
        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">Value Steps</div>
            <div style="color: var(--chat-text-secondary); font-size: 12px; margin-bottom: 12px;">Must contain 0. Auto-sorted.</div>
            <input id="ee-m-steps-input" style="width: 100%; padding: 10px 12px; border-radius: 10px; outline: none; box-sizing: border-box; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;" value="${this.rules.value_steps.join(', ')}" />
        `;
        const commitSteps = () => {
            try {
                const raw = area.querySelector('#ee-m-steps-input').value;
                let parsed = raw.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
                if (!parsed.includes(0)) parsed.push(0);
                parsed.sort((a, b) => a - b);
                this.rules.value_steps = [...new Set(parsed)];
                area.querySelector('#ee-m-steps-input').value = this.rules.value_steps.join(', ');
                this.updatePreviewEngine();
                this._scheduleAutoSave();
            } catch (e) { }
        };
        area.querySelector('#ee-m-steps-input').addEventListener('change', commitSteps);
        area.querySelector('#ee-m-steps-input').addEventListener('blur', commitSteps);
    }

    _renderMapping(area) {
        const allTypes = this.rules.types || [];
        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">Tags Mapping</div>
            <div style="color: var(--chat-text-secondary); font-size: 12px; margin-bottom: 14px;">Booru tags per type & value step.</div>
            <select id="ee-m-map-select" style="width: 100%; padding: 10px 12px; border-radius: 10px; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px; margin-bottom: 14px; outline: none;">
                <option value="">— Select type —</option>
                ${allTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
            <div id="ee-m-map-editor"></div>
        `;

        const mapEditor = area.querySelector('#ee-m-map-editor');
        const select = area.querySelector('#ee-m-map-select');

        const renderEditor = (t) => {
            if (!t) { mapEditor.innerHTML = ''; return; }
            if (!this.rules.mapping[t]) this.rules.mapping[t] = {};
            let html = `<div style="padding: 14px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);">
                <div style="font-weight: 600; margin-bottom: 10px; font-size: 14px;">${t}</div>`;
            this.rules.value_steps.forEach(step => {
                const tags = this.rules.mapping[t][String(step)] || [];
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--chat-text-secondary); margin-bottom: 4px;">Step ${step}:</div>
                    <input type="text" data-step="${step}" value="${tags.join(', ')}" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;" />
                </div>`;
            });
            html += `</div>`;
            mapEditor.innerHTML = html;

            // Tag autocomplete
            let tagService = window.Yuuka?.services?.tagDataset;
            if (!tagService) {
                window.Yuuka = window.Yuuka || {};
                window.Yuuka.services = window.Yuuka.services || {};
                tagService = window.Yuuka.services.tagDataset = {
                    data: null, promise: null, lastFetched: 0, ttl: 1000 * 60 * 60 * 6,
                    prefetch(apiObj) {
                        if (this.data && (Date.now() - this.lastFetched) < this.ttl) return Promise.resolve(this.data);
                        if (this.promise) return this.promise;
                        if (!apiObj || typeof apiObj.getTags !== 'function') return Promise.resolve([]);
                        this.promise = apiObj.getTags().then(arr => { this.data = Array.isArray(arr) ? arr : []; this.lastFetched = Date.now(); return this.data; }).catch(() => []).finally(() => this.promise = null);
                        return this.promise;
                    },
                    get() { return Array.isArray(this.data) ? this.data : []; },
                    clear() { this.data = null; this.lastFetched = 0; }
                };
            }
            if (window.Yuuka?.ui?._initTagAutocomplete) {
                const predictions = tagService.get();
                if (predictions && predictions.length > 0) {
                    try { window.Yuuka.ui._initTagAutocomplete(mapEditor, predictions); } catch (e) { }
                } else if (typeof api !== 'undefined') {
                    tagService.prefetch(api).then(fresh => {
                        if (fresh && fresh.length > 0 && mapEditor.isConnected) {
                            try { window.Yuuka.ui._initTagAutocomplete(mapEditor, fresh); } catch (e) { }
                        }
                    }).catch(console.warn);
                }
            }

            const commitMapping = (inp) => {
                const step = inp.dataset.step;
                const tagsStr = inp.value.trim();
                if (tagsStr) {
                    let parsedTags = tagsStr.split(',').map(x => x.trim()).filter(x => x);
                    if (parsedTags.length > 10) parsedTags = parsedTags.slice(0, 10);
                    this.rules.mapping[t][step] = [...new Set(parsedTags)];
                    inp.value = this.rules.mapping[t][step].join(', ');
                } else { delete this.rules.mapping[t][step]; }
                this.updatePreviewEngine();
                this._scheduleAutoSave();
            };
            mapEditor.querySelectorAll('input[data-step]').forEach(inp => {
                inp.addEventListener('change', () => commitMapping(inp));
                inp.addEventListener('blur', () => commitMapping(inp));
            });
        };

        select.addEventListener('change', () => renderEditor(select.value));
    }

    _renderConflicts(area) {
        const allTypes = this.rules.types || [];
        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">Conflict Rules</div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; padding: 12px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);">
                <select id="ee-m-cr-a" style="width: 100%; padding: 10px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;">
                    ${allTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <select id="ee-m-cr-b" style="width: 100%; padding: 10px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;">
                    ${allTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <select id="ee-m-cr-res" style="width: 100%; padding: 10px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;">
                    <option value="keep_higher">keep_higher</option>
                    <option value="keep_newest">keep_newest</option>
                    <option value="reduce_A">reduce_A</option>
                    <option value="reduce_B">reduce_B</option>
                    <option value="cap_at_5">cap_at_5</option>
                </select>
                <button id="ee-m-cr-add" style="width: 100%; padding: 10px; cursor: pointer; background: var(--chat-primary); color: var(--chat-panel-bg); border: none; border-radius: 10px; font-weight: 700; font-size: 14px;">Add Rule</button>
            </div>
            <div id="ee-m-cr-list"></div>
        `;

        const renderCRList = () => {
            const list = area.querySelector('#ee-m-cr-list');
            list.innerHTML = '';
            this.rules.conflict_rules.forEach((cr, i) => {
                const card = document.createElement('div');
                card.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);';
                card.innerHTML = `
                    <span style="font-size: 13px;">${cr.typeA} vs ${cr.typeB} → <strong style="color:var(--chat-primary)">${cr.resolution}</strong></span>
                    <button style="background: transparent; border: none; color: red; cursor: pointer; font-size: 18px; padding: 4px 8px; line-height: 1;" data-idx="${i}">✕</button>
                `;
                list.appendChild(card);
            });
            list.querySelectorAll('button[data-idx]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.rules.conflict_rules.splice(parseInt(btn.dataset.idx), 1);
                    renderCRList(); this.updatePreviewEngine(); this._scheduleAutoSave();
                });
            });
        };

        area.querySelector('#ee-m-cr-add').addEventListener('click', () => {
            const tA = area.querySelector('#ee-m-cr-a').value;
            const tB = area.querySelector('#ee-m-cr-b').value;
            const res = area.querySelector('#ee-m-cr-res').value;
            if (tA === tB) return alert('Cannot conflict with itself');
            if (this.rules.conflict_rules.find(c => (c.typeA === tA && c.typeB === tB) || (c.typeA === tB && c.typeB === tA))) return alert('Rule already exists');
            this.rules.conflict_rules.push({ typeA: tA, typeB: tB, resolution: res });
            renderCRList(); this.updatePreviewEngine(); this._scheduleAutoSave();
        });

        renderCRList();
    }

    updatePreviewEngine() {
        this.previewEngine.rules = JSON.parse(JSON.stringify(this.rules));
        this.updatePreview();
    }

    updatePreview() {
        if (!this.modalEl) return;
        const out = this.modalEl.querySelector('#ee-sim-eval') || this.modalEl.querySelector('#ee-m-sim-eval');
        try {
            const rawMock = JSON.parse(this.previewStateStr);
            // Run through applyDelta with decay=1.0 (no decay) to apply conflict + behavior rules
            const resolvedState = this.previewEngine.applyDelta({}, { value: rawMock }, 1.0);
            const dom = this.previewEngine.getDominantType(resolvedState);
            const tags = this.previewEngine.getTags(resolvedState);
            const stateStr = Object.entries(resolvedState).map(([k, v]) => `${k}:${v} `).join(', ') || 'empty';
            out.innerHTML = `
                <div style="color: var(--chat-text-secondary); margin-bottom: 4px;">Resolved: <span style="color: var(--chat-text)">${stateStr}</span></div>
                <div style="color: var(--chat-text-secondary); margin-bottom: 4px;">Dominant: <span style="color: var(--chat-text)">${dom || 'None'}</span></div>
                <div>Tags: <span style="color: var(--chat-primary)">${tags.join(', ') || '[]'}</span></div>
            `;
            out.style.borderColor = 'var(--chat-border)';
        } catch (e) {
            out.textContent = 'Invalid JSON state format';
            out.style.borderColor = 'red';
        }
    }

    close() {
        clearTimeout(this._saveTimer);
        if (this.modalEl) {
            this.modalEl.remove();
            this.modalEl = null;
        }
    }
}
window.EmotionEditor = EmotionEditor;
