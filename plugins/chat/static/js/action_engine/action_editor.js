class ActionEditor {
    constructor(engineInstance) {
        this.engine = engineInstance;
        this.rules = null;
        this.modalEl = null;
        this._saveTimer = null;
    }

    _scheduleAutoSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._autoSave(), 800);
    }

    async _autoSave() {
        const indicator = this.modalEl?.querySelector('#ae-save-indicator');
        if (indicator) { indicator.textContent = 'Saving…'; indicator.style.opacity = '1'; }
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
            if (!res.ok) throw new Error("Failed to load action rules");
            this.rules = await res.json();
            this._renderModal();
        } catch (e) {
            alert("Error loading Action Engine rules: " + e.message);
        }
    }

    /* ═══════════════════════════════════════════════════
       MOBILE LAYOUT
       ═══════════════════════════════════════════════════ */
    _renderModal() {
        if (this.modalEl) this.modalEl.remove();

        this.modalEl = document.createElement('div');
        this.modalEl.className = 'action-editor-modal';
        this.modalEl.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: var(--chat-bg); z-index: 10000;
            display: flex; flex-direction: column;
            font-family: sans-serif; color: var(--chat-text);
        `;

        /* ---- Header ---- */
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px; background: var(--chat-panel-bg);
            border-bottom: 1px solid var(--chat-border);
            flex-shrink: 0;
        `;
        header.innerHTML = `
            <div style="font-size: 1.05rem; font-weight: 700;">Action Rules</div>
            <div style="display: flex; align-items: center; gap: 10px;">
                <span id="ae-save-indicator" style="font-size: 12px; color: var(--chat-primary); opacity: 0; transition: opacity 0.3s;"></span>
                <button id="ae-m-close" style="padding: 7px 14px; background: transparent; color: var(--chat-text); border: 1px solid var(--chat-border); border-radius: 8px; font-size: 13px; cursor: pointer;">✕</button>
            </div>
        `;

        /* ---- Tab bar ---- */
        const tabBar = document.createElement('div');
        tabBar.style.cssText = `
            display: flex; gap: 6px; padding: 10px 16px;
            background: var(--chat-panel-bg); border-bottom: 1px solid var(--chat-border);
            overflow-x: auto; flex-shrink: 0;
            -webkit-overflow-scrolling: touch;
        `;
        const tabs = [
            { key: 'solo', label: 'Solo' },
            { key: 'duo', label: 'Duo' },
            { key: 'mapping', label: 'Tags' },
            { key: 'stamina', label: 'Stamina' }
        ];
        tabs.forEach((tab, i) => {
            const btn = document.createElement('button');
            btn.className = 'ae-m-tab';
            btn.dataset.tab = tab.key;
            btn.textContent = tab.label;
            btn.style.cssText = `
                padding: 8px 18px; border-radius: 20px; border: none; font-size: 13px;
                font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.2s;
                ${i === 0
                    ? 'background: var(--chat-primary); color: var(--chat-panel-bg);'
                    : 'background: var(--chat-bg); color: var(--chat-text-secondary);'}
            `;
            tabBar.appendChild(btn);
        });

        /* ---- Content area ---- */
        const mainArea = document.createElement('div');
        mainArea.id = 'ae-main-area';
        mainArea.style.cssText = 'flex: 1; overflow-y: auto; padding: 16px; padding-bottom: 80px; -webkit-overflow-scrolling: touch;';

        this.modalEl.appendChild(header);
        this.modalEl.appendChild(tabBar);
        this.modalEl.appendChild(mainArea);

        const container = document.getElementById('chat-app') || document.body;
        container.appendChild(this.modalEl);

        /* ---- Events ---- */
        header.querySelector('#ae-m-close').addEventListener('click', () => this.close());

        tabBar.querySelectorAll('.ae-m-tab').forEach(t => {
            t.addEventListener('click', () => {
                tabBar.querySelectorAll('.ae-m-tab').forEach(b => {
                    b.style.background = 'var(--chat-bg)';
                    b.style.color = 'var(--chat-text-secondary)';
                });
                t.style.background = 'var(--chat-primary)';
                t.style.color = 'var(--chat-panel-bg)';
                this._renderTab(t.dataset.tab);
            });
        });

        this._renderTab('solo');
    }

    _renderTab(tabName) {
        const area = document.getElementById('ae-main-area');
        area.innerHTML = '';

        if (tabName === 'solo') {
            this._renderTypeList(area, 'solo_types', 'Solo Types', 'Character-only actions.');
        } else if (tabName === 'duo') {
            this._renderTypeList(area, 'duo_types', 'Duo Types', 'Actions with the POV user.');
        } else if (tabName === 'mapping') {
            this._renderTagMapping(area);
        } else if (tabName === 'stamina') {
            this._renderStaminaTab(area);
        }
    }

    _renderTypeList(area, typeKey, title, description) {
        if (!this.rules[typeKey]) this.rules[typeKey] = {};

        const maxTypesHtml = typeKey === 'solo_types' ? `
            <div style="margin-bottom: 14px; padding: 12px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);">
                <label style="display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--chat-text); font-size: 13px;">
                    <span>Max active types</span>
                    <input id="ae-max-active" type="number" min="1" max="5" value="${this.rules.max_active_types || 2}" style="width: 52px; padding: 8px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                </label>
            </div>
        ` : '';

        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">${title}</div>
            <div style="color: var(--chat-text-secondary); font-size: 12px; margin-bottom: 14px;">${description}</div>
            ${maxTypesHtml}
            <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
                <input id="ae-new-type" type="text" placeholder="snake_case" style="flex: 1; min-width: 120px; padding: 10px 12px; border-radius: 10px; outline: none; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;" />
                <input id="ae-new-group" type="number" min="0" max="10" value="0" placeholder="Grp" style="width: 52px; padding: 10px 6px; border-radius: 10px; outline: none; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                <button id="ae-add-type" style="padding: 10px 16px; cursor: pointer; background: var(--chat-primary); color: var(--chat-panel-bg); border: none; border-radius: 10px; font-weight: 700; font-size: 14px;">+</button>
            </div>
            <div id="ae-types-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(max(240px, calc(33.333% - 8px)), 1fr)); gap: 12px;"></div>
        `;

        const renderList = () => {
            const list = area.querySelector('#ae-types-list');
            list.innerHTML = '';
            const types = this.rules[typeKey];

            for (const [name, config] of Object.entries(types)) {
                const card = document.createElement('div');
                card.style.cssText = `
                    box-sizing: border-box; padding: 12px;
                    background: var(--chat-panel-bg); border-radius: 10px;
                    border: 1px solid var(--chat-border);
                `;
                card.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <input type="text" data-rename="${name}" value="${name}" title="Tap to rename" style="font-weight: 600; font-size: 14px; cursor: text; color: var(--chat-primary); background: transparent; border: 1px solid transparent; outline: none; padding: 2px 4px; border-radius: 4px; width: calc(100% - 30px); transition: border-color 0.2s, background 0.2s; box-sizing: border-box;" />
                        <button style="background: transparent; border: none; color: red; cursor: pointer; font-size: 18px; padding: 4px 8px; line-height: 1;" data-del="${name}">✕</button>
                    </div>
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--chat-text-secondary);">
                            Group
                            <input type="number" data-cfg="group" data-name="${name}" value="${config.group ?? 0}" min="0" max="10" style="width: 48px; padding: 7px 6px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 13px;" />
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--chat-text-secondary);">
                            Decay
                            <input type="number" data-cfg="decay" data-name="${name}" value="${config.decay ?? 0}" style="width: 52px; padding: 7px 6px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 13px;" />
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--chat-text-secondary);">
                            Stamina
                            <input type="number" data-cfg="stamina" data-name="${name}" value="${config.stamina ?? 0}" style="width: 52px; padding: 7px 6px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 13px;" />
                        </label>
                    </div>
                `;
                list.appendChild(card);
            }

            list.querySelectorAll('input[data-cfg]').forEach(inp => {
                inp.addEventListener('change', () => {
                    const n = inp.dataset.name;
                    const field = inp.dataset.cfg;
                    const val = parseInt(inp.value);
                    if (!isNaN(val) && this.rules[typeKey][n]) {
                        this.rules[typeKey][n][field] = val;
                        this._scheduleAutoSave();
                    }
                });
            });

            list.querySelectorAll('button[data-del]').forEach(btn => {
                btn.addEventListener('click', () => {
                    delete this.rules[typeKey][btn.dataset.del];
                    renderList();
                    this._scheduleAutoSave();
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
                    if (this.rules.solo_types?.[newName] || this.rules.duo_types?.[newName]) {
                        alert('Type already exists');
                        inp.value = oldName;
                        return;
                    }

                    this.rules[typeKey][newName] = this.rules[typeKey][oldName];
                    delete this.rules[typeKey][oldName];
                    renderList();
                    this._scheduleAutoSave();
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

        area.querySelector('#ae-add-type').addEventListener('click', () => {
            const nameInput = area.querySelector('#ae-new-type');
            const groupInput = area.querySelector('#ae-new-group');
            const tv = nameInput.value.trim().toLowerCase();
            if (!tv || !/^[a-z_]+$/.test(tv)) return alert('Must be lowercase snake_case');
            if (this.rules.solo_types?.[tv] || this.rules.duo_types?.[tv]) return alert('Type already exists');

            const group = parseInt(groupInput.value) || 0;
            this.rules[typeKey][tv] = { group, decay: 0, stamina: 0, tags: [] };
            nameInput.value = '';
            renderList();
            this._scheduleAutoSave();
        });

        const maxInput = area.querySelector('#ae-max-active');
        if (maxInput) {
            maxInput.addEventListener('change', () => {
                const val = parseInt(maxInput.value);
                if (val >= 1 && val <= 5) { this.rules.max_active_types = val; this._scheduleAutoSave(); }
            });
        }

        renderList();
    }

    _renderTagMapping(area) {
        const allTypes = { ...this.rules.solo_types || {}, ...this.rules.duo_types || {} };
        const typeNames = Object.keys(allTypes);

        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">Tags Mapping</div>
            <div style="color: var(--chat-text-secondary); font-size: 12px; margin-bottom: 14px;">Booru tags for image generation per action type.</div>
            <select id="ae-m-type-select" style="width: 100%; padding: 10px 12px; border-radius: 10px; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px; margin-bottom: 14px; outline: none;">
                <option value="">— Select type —</option>
                ${typeNames.map(n => {
            const isDuo = !!this.rules.duo_types?.[n];
            return `<option value="${n}">${n}${isDuo ? ' (duo)' : ''}</option>`;
        }).join('')}
            </select>
            <div id="ae-m-map-editor"></div>
        `;

        const mapEditor = area.querySelector('#ae-m-map-editor');
        const select = area.querySelector('#ae-m-type-select');

        const renderEditor = (typeName) => {
            const config = allTypes[typeName];
            if (!config) { mapEditor.innerHTML = ''; return; }

            const isDuo = !!this.rules.duo_types?.[typeName];

            mapEditor.innerHTML = `
                <div style="padding: 14px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);">
                    <div style="font-weight: 600; margin-bottom: 4px;">${typeName}${isDuo ? ' <span style="font-size:11px; color:var(--chat-primary);">(duo)</span>' : ''}</div>
                    <div style="font-size: 12px; color: var(--chat-text-secondary); margin-bottom: 10px;">Comma-separated tags. Max 10.</div>
                    <input type="text" id="ae-m-tag-input" value="${(config.tags || []).join(', ')}" style="width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 14px;" />
                </div>
            `;

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
                        this.promise = apiObj.getTags().then(arr => {
                            this.data = Array.isArray(arr) ? arr : [];
                            this.lastFetched = Date.now();
                            return this.data;
                        }).catch(() => []).finally(() => this.promise = null);
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

            const tagInput = mapEditor.querySelector('#ae-m-tag-input');
            const commitTags = () => {
                const tagsStr = tagInput.value.trim();
                let parsedTags = tagsStr ? tagsStr.split(',').map(x => x.trim()).filter(x => x) : [];
                if (parsedTags.length > 10) parsedTags = parsedTags.slice(0, 10);
                const targetDict = isDuo ? 'duo_types' : 'solo_types';
                this.rules[targetDict][typeName].tags = [...new Set(parsedTags)];
                tagInput.value = this.rules[targetDict][typeName].tags.join(', ');
                this._scheduleAutoSave();
            };
            tagInput.addEventListener('change', commitTags);
            tagInput.addEventListener('blur', commitTags);
        };

        select.addEventListener('change', () => {
            renderEditor(select.value);
        });
    }

    /* ═══════════════════════════════════════════════════
       STAMINA TAB (Desktop)
       ═══════════════════════════════════════════════════ */
    _renderStaminaTab(area) {
        if (!this.rules.stamina) {
            this.rules.stamina = { max: 100, regen_per_turn: 10, tags: { "0": [], "25": [], "50": [], "75": [] } };
        }
        const stam = this.rules.stamina;
        const allTypes = { ...this.rules.solo_types || {}, ...this.rules.duo_types || {} };

        area.innerHTML = `
            <h3>Stamina Settings</h3>
            <p style="color: var(--chat-text-secondary); font-size: 14px; margin-bottom: 16px;">Configure stamina consumption and regen. Stamina depletes when actions with negative stamina cost are active, and regenerates when idle. Stamina cost per type can be configured in the Solo/Duo tabs.</p>

            <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
                <div style="padding: 12px; background: var(--chat-panel-bg); border-radius: 8px; border: 1px solid var(--chat-border); flex: 1; min-width: 140px;">
                    <label style="display: flex; align-items: center; gap: 8px; color: var(--chat-text);">
                        <span>Max Stamina:</span>
                        <input id="ae-stamina-max" type="number" min="1" max="999" value="${stam.max || 100}" style="width: 70px; padding: 6px; border-radius: 6px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center;" />
                    </label>
                </div>
                <div style="padding: 12px; background: var(--chat-panel-bg); border-radius: 8px; border: 1px solid var(--chat-border); flex: 1; min-width: 140px;">
                    <label style="display: flex; align-items: center; gap: 8px; color: var(--chat-text);">
                        <span>Regen per turn (idle):</span>
                        <input id="ae-stamina-regen" type="number" min="0" max="100" value="${stam.regen_per_turn || 10}" style="width: 70px; padding: 6px; border-radius: 6px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center;" />
                    </label>
                </div>
            </div>

            <h4>Stamina Tags (Booru)</h4>
            <p style="color: var(--chat-text-secondary); font-size: 13px; margin-bottom: 12px;">Tags added to image gen based on stamina level. Each range is <em>threshold ≤ stamina < next_threshold</em>.</p>
            <div id="ae-stamina-tags"></div>
        `;

        // Bind max / regen
        area.querySelector('#ae-stamina-max').addEventListener('change', (e) => {
            const v = parseInt(e.target.value);
            if (v >= 1) { this.rules.stamina.max = v; this._scheduleAutoSave(); }
        });
        area.querySelector('#ae-stamina-regen').addEventListener('change', (e) => {
            const v = parseInt(e.target.value);
            if (v >= 0) { this.rules.stamina.regen_per_turn = v; this._scheduleAutoSave(); }
        });

        // Render stamina tag ranges
        const tagsArea = area.querySelector('#ae-stamina-tags');
        if (!stam.tags) stam.tags = {};
        const ranges = [
            { key: '75', label: '75 ~ 100 (Energetic)' },
            { key: '50', label: '50 ~ 74 (Normal)' },
            { key: '25', label: '25 ~ 49 (Tired)' },
            { key: '0', label: '0 ~ 24 (Exhausted)' }
        ];
        for (const range of ranges) {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; margin-bottom: 8px; gap: 12px;';
            row.innerHTML = `
                <div style="width: 160px; text-align: right; font-size: 13px; color: var(--chat-text-secondary); flex-shrink: 0;">${range.label}</div>
                <input type="text" data-stamina-range="${range.key}" value="${(stam.tags[range.key] || []).join(', ')}" style="flex: 1; padding: 6px 12px; border-radius: 6px; outline: none; background: var(--chat-panel-bg); color: var(--chat-text); border: 1px solid var(--chat-border);" placeholder="e.g. exhausted, sweating" />
            `;
            tagsArea.appendChild(row);
        }
        tagsArea.querySelectorAll('input[data-stamina-range]').forEach(inp => {
            inp.addEventListener('change', () => {
                const key = inp.dataset.staminaRange;
                const tags = inp.value.trim() ? inp.value.split(',').map(t => t.trim()).filter(Boolean) : [];
                this.rules.stamina.tags[key] = tags;
                this._scheduleAutoSave();
            });
        });

        // Tag autocomplete
        let tagService = window.Yuuka?.services?.tagDataset;
        if (tagService && window.Yuuka?.ui?._initTagAutocomplete) {
            const predictions = tagService.get();
            if (predictions && predictions.length > 0) {
                try { window.Yuuka.ui._initTagAutocomplete(tagsArea, predictions); } catch (e) { }
            }
        }
    }

    /* ═══════════════════════════════════════════════════
       STAMINA TAB (Mobile)
       ═══════════════════════════════════════════════════ */
    _renderStaminaTab(area) {
        if (!this.rules.stamina) {
            this.rules.stamina = { max: 100, regen_per_turn: 10, tags: { "0": [], "25": [], "50": [], "75": [] } };
        }
        const stam = this.rules.stamina;
        const allTypes = { ...this.rules.solo_types || {}, ...this.rules.duo_types || {} };

        area.innerHTML = `
            <div style="margin-bottom: 8px; font-size: 15px; font-weight: 700;">Stamina Settings</div>
            <div style="color: var(--chat-text-secondary); font-size: 12px; margin-bottom: 14px;">Stamina depletes from active actions and regens when idle. Cost per type is in Solo/Duo tabs.</div>

            <div style="display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap;">
                <div style="padding: 12px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border); flex: 1; min-width: 120px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--chat-text); font-size: 13px;">
                        <span>Max</span>
                        <input id="ae-stamina-max" type="number" min="1" max="999" value="${stam.max || 100}" style="width: 60px; padding: 8px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                    </label>
                </div>
                <div style="padding: 12px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border); flex: 1; min-width: 120px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--chat-text); font-size: 13px;">
                        <span>Regen/turn</span>
                        <input id="ae-stamina-regen" type="number" min="0" max="100" value="${stam.regen_per_turn || 10}" style="width: 60px; padding: 8px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); text-align: center; font-size: 14px;" />
                    </label>
                </div>
            </div>

            <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Stamina Tags</div>
            <div style="color: var(--chat-text-secondary); font-size: 11px; margin-bottom: 10px;">Tags for image gen based on stamina level.</div>
            <div id="ae-stamina-tags"></div>
        `;

        // Bind max / regen
        area.querySelector('#ae-stamina-max').addEventListener('change', (e) => {
            const v = parseInt(e.target.value);
            if (v >= 1) { this.rules.stamina.max = v; this._scheduleAutoSave(); }
        });
        area.querySelector('#ae-stamina-regen').addEventListener('change', (e) => {
            const v = parseInt(e.target.value);
            if (v >= 0) { this.rules.stamina.regen_per_turn = v; this._scheduleAutoSave(); }
        });

        // Stamina tag ranges
        const tagsArea = area.querySelector('#ae-stamina-tags');
        if (!stam.tags) stam.tags = {};
        const ranges = [
            { key: '75', label: '75~100' },
            { key: '50', label: '50~74' },
            { key: '25', label: '25~49' },
            { key: '0', label: '0~24' }
        ];
        for (const range of ranges) {
            const row = document.createElement('div');
            row.style.cssText = 'padding: 10px 12px; margin-bottom: 6px; background: var(--chat-panel-bg); border-radius: 10px; border: 1px solid var(--chat-border);';
            row.innerHTML = `
                <div style="font-size: 12px; color: var(--chat-text-secondary); margin-bottom: 6px;">${range.label}</div>
                <input type="text" data-stamina-range="${range.key}" value="${(stam.tags[range.key] || []).join(', ')}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; outline: none; background: var(--chat-bg); color: var(--chat-text); border: 1px solid var(--chat-border); font-size: 13px;" placeholder="comma-separated tags" />
            `;
            tagsArea.appendChild(row);
        }
        tagsArea.querySelectorAll('input[data-stamina-range]').forEach(inp => {
            inp.addEventListener('change', () => {
                const key = inp.dataset.staminaRange;
                const tags = inp.value.trim() ? inp.value.split(',').map(t => t.trim()).filter(Boolean) : [];
                this.rules.stamina.tags[key] = tags;
                this._scheduleAutoSave();
            });
        });

        // Tag autocomplete
        let tagService = window.Yuuka?.services?.tagDataset;
        if (tagService && window.Yuuka?.ui?._initTagAutocomplete) {
            const predictions = tagService.get();
            if (predictions && predictions.length > 0) {
                try { window.Yuuka.ui._initTagAutocomplete(tagsArea, predictions); } catch (e) { }
            }
        }
    }

    /* ═══════════════════════════════════════════════════
       SHARED (Close)
       ═══════════════════════════════════════════════════ */
    close() {
        clearTimeout(this._saveTimer);
        if (this.modalEl) {
            this.modalEl.remove();
            this.modalEl = null;
        }
    }
}

window.ActionEditor = ActionEditor;
