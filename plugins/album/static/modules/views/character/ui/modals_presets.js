// Album plugin - View module: character view (Modals: presets)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterPresetUiMountAnimAndSoundPickers(dialogEl, {
            initialAnimPresets = [],
            initialSfx1 = [],
            initialSfx2 = [],
        } = {}) {
            const AUTO_ANIM_SUFFIX = ' - auto save';
            const isAutoSaveAnimPresetKey = (key) => {
                try {
                    const k = String(key || '').trim();
                    if (!k) return false;
                    return k.toLowerCase().endsWith(AUTO_ANIM_SUFFIX.toLowerCase());
                } catch {
                    return false;
                }
            };

            const applyPresetPillStyle = (pillEl) => {
                try {
                    if (!pillEl) return;
                    pillEl.style.background = 'color-mix(in srgb, var(--color-accent) 16%, var(--color-primary-bg))';
                } catch { }
            };

            const applyPillWrapMaxLinesScroll = (wrapEl, maxLines = 3) => {
                try {
                    if (!wrapEl) return;
                    const children = Array.from(wrapEl.children || []);
                    if (!children.length) return;
                    const first = children[0];
                    const rowGap = (() => {
                        try {
                            const cs = window.getComputedStyle(wrapEl);
                            const g = cs.rowGap || cs.gap || '0px';
                            const n = parseFloat(String(g || '0').replace('px', ''));
                            return Number.isFinite(n) ? n : 0;
                        } catch {
                            return 0;
                        }
                    })();
                    const pillH = Math.max(1, Number(first.offsetHeight || 0));
                    const maxH = (pillH * Number(maxLines || 3)) + (rowGap * Math.max(0, Number(maxLines || 3) - 1));
                    wrapEl.style.maxHeight = `${maxH}px`;
                    wrapEl.style.overflowY = 'auto';
                    wrapEl.style.overflowX = 'hidden';
                } catch { }
            };

            const previewAnimPresetKey = async (key) => {
                try {
                    const k = String(key || '').trim();
                    if (!k) return;
                    const layer = document.querySelector('.plugin-album__character-view .plugin-album__character-layer--char');
                    if (!layer) return;
                    if (typeof this._albumAnimGetEngine !== 'function') return;
                    const eng = this._albumAnimGetEngine();
                    if (!eng) return;
                    await eng.playPresetOnElement(layer, k, { loop: false, seamless: false });
                    const dur = (typeof eng.getPresetDurationMsByKey === 'function')
                        ? (await eng.getPresetDurationMsByKey(k))
                        : null;
                    const ms = Math.max(50, Number(dur || 900));
                    setTimeout(() => {
                        try { eng.stop(layer); } catch { }
                    }, ms + 60);
                } catch { }
            };

            const getPreviewSoundEngine = () => {
                try {
                    if (typeof this._albumSoundGetEngine === 'function') return this._albumSoundGetEngine();
                    if (window.Yuuka?.AlbumSoundEngine) return new window.Yuuka.AlbumSoundEngine({ api: this.api?.album });
                } catch { }
                return null;
            };

            const dialog = dialogEl;
            const animPillWrap = dialog?.querySelector?.('[data-role="selected-anim-presets"]');
            const animInput = dialog?.querySelector?.('#anim-preset-search');
            const animSug = dialog?.querySelector?.('[data-role="anim-preset-suggestions"]');

            const sfx1PillWrap = dialog?.querySelector?.('[data-role="selected-sfx1"]');
            const sfx1Input = dialog?.querySelector?.('#sfx1-search');
            const sfx1Sug = dialog?.querySelector?.('[data-role="sfx1-suggestions"]');
            const sfx2PillWrap = dialog?.querySelector?.('[data-role="selected-sfx2"]');
            const sfx2Input = dialog?.querySelector?.('#sfx2-search');
            const sfx2Sug = dialog?.querySelector?.('[data-role="sfx2-suggestions"]');

            let selectedAnimPresets = (Array.isArray(initialAnimPresets) ? initialAnimPresets : []).map(x => String(x || '').trim()).filter(Boolean);
            selectedAnimPresets = selectedAnimPresets.filter(k => !isAutoSaveAnimPresetKey(k));

            let selectedSfx1 = (Array.isArray(initialSfx1) ? initialSfx1 : []).map(x => String(x || '').trim()).filter(Boolean);
            let selectedSfx2 = (Array.isArray(initialSfx2) ? initialSfx2 : []).map(x => String(x || '').trim()).filter(Boolean);
            try {
                const set1 = new Set(selectedSfx1);
                selectedSfx2 = selectedSfx2.filter(x => !set1.has(x));
            } catch { }

            let allAnimPresetKeys = [];
            const fetchAnimPresets = async () => {
                try {
                    const all = await this.api.album.get('/animation/presets');
                    const arr = Array.isArray(all) ? all : [];
                    allAnimPresetKeys = arr
                        .map(p => String(p?.key || '').trim())
                        .filter(Boolean)
                        .filter(k => !isAutoSaveAnimPresetKey(k));
                } catch {
                    allAnimPresetKeys = [];
                }
            };

            let allSoundPresets = [];
            let allSoundGroups = [];
            const fetchSoundPresets = async () => {
                try {
                    const all = await this.api.album.get('/sound_fx/presets');
                    const arr = Array.isArray(all) ? all : [];
                    allSoundPresets = arr
                        .filter(p => p && typeof p === 'object')
                        .map(p => ({
                            id: String(p?.id || '').trim(),
                            name: String(p?.name || '').trim(),
                            ext: String(p?.ext || '').trim().toLowerCase(),
                            url: String(p?.url || '').trim(),
                            group_ids: (() => {
                                try {
                                    const g0 = p?.group_ids;
                                    if (Array.isArray(g0)) return g0.map(x => String(x || '').trim()).filter(Boolean);
                                    const g1 = String(p?.group_id || '').trim();
                                    return g1 ? [g1] : [];
                                } catch {
                                    return [];
                                }
                            })(),
                        }))
                        .filter(p => p.id && p.name);
                    try {
                        if (!this.state.character) this.state.character = {};
                        this.state.character._soundFxPresetsCache = { fetchedAt: Date.now(), presets: allSoundPresets };
                    } catch { }
                } catch {
                    allSoundPresets = [];
                }
            };

            const fetchSoundGroups = async () => {
                try {
                    const all = await this.api.album.get('/sound_fx/groups');
                    const arr = Array.isArray(all) ? all : [];
                    allSoundGroups = arr
                        .filter(g => g && typeof g === 'object')
                        .map(g => ({
                            id: String(g?.id || '').trim(),
                            name: String(g?.name || '').trim(),
                        }))
                        .filter(g => g.id && g.name);
                } catch {
                    allSoundGroups = [];
                }
            };

            const formatSoundLabel = (p) => {
                const n = String(p?.name || '').trim();
                const ext = String(p?.ext || '').trim().toLowerCase();
                return ext ? `${n}.${ext}` : n;
            };
            const formatGroupLabel = (g) => String(g?.name || '').trim();

            const renderSfxSelected = (slot) => {
                const s = Number(slot);
                const wrap = (s === 1) ? sfx1PillWrap : sfx2PillWrap;
                if (!wrap) return;
                const list = (s === 1) ? selectedSfx1 : selectedSfx2;

                wrap.innerHTML = '';
                list.forEach((pid, idx) => {
                    const group = allSoundGroups.find(g => g.id === pid) || null;
                    const presetObj = (!group) ? (allSoundPresets.find(p => p.id === pid) || null) : null;
                    const label = group ? formatGroupLabel(group) : (presetObj ? formatSoundLabel(presetObj) : String(pid));

                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = label;
                    pill.title = `${label} (bấm để xoá)`;
                    if (group) applyPresetPillStyle(pill);
                    pill.dataset.index = String(idx);
                    pill.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const i = Number(pill.dataset.index);
                        if (!Number.isFinite(i) || i < 0 || i >= list.length) return;
                        list.splice(i, 1);
                        if (s === 1) selectedSfx1 = list;
                        else selectedSfx2 = list;
                        renderSfxSelected(1);
                        renderSfxSelected(2);
                        renderSfxSuggestions(1);
                        renderSfxSuggestions(2);
                    });
                    wrap.appendChild(pill);
                });
            };

            const renderSfxSuggestions = (slot) => {
                const s = Number(slot);
                const inputEl = (s === 1) ? sfx1Input : sfx2Input;
                const sugEl = (s === 1) ? sfx1Sug : sfx2Sug;
                if (!sugEl) return;
                const q = String(inputEl?.value || '').trim().toLowerCase();
                sugEl.innerHTML = '';
                try { sugEl.style.maxHeight = ''; sugEl.style.overflow = ''; } catch { }

                const selectedAll = new Set([...(selectedSfx1 || []), ...(selectedSfx2 || [])]);
                const groupMatches = (Array.isArray(allSoundGroups) ? allSoundGroups : [])
                    .filter(g => !selectedAll.has(g.id))
                    .filter(g => {
                        if (!q) return true;
                        return formatGroupLabel(g).toLowerCase().includes(q);
                    })
                    .sort((a, b) => formatGroupLabel(a).localeCompare(formatGroupLabel(b), undefined, { sensitivity: 'base' }));

                const presetMatches = (Array.isArray(allSoundPresets) ? allSoundPresets : [])
                    .filter(p => !selectedAll.has(p.id))
                    .filter(p => {
                        if (!q) return true;
                        return formatSoundLabel(p).toLowerCase().includes(q);
                    })
                    .sort((a, b) => formatSoundLabel(a).localeCompare(formatSoundLabel(b), undefined, { sensitivity: 'base' }));

                const combined = [
                    ...groupMatches.map(g => ({ type: 'group', item: g })),
                    ...presetMatches.map(p => ({ type: 'preset', item: p })),
                ];

                combined.forEach((row) => {
                    const isGroup = row.type === 'group';
                    const g = isGroup ? row.item : null;
                    const p = (!isGroup) ? row.item : null;
                    const id = String((isGroup ? g?.id : p?.id) || '').trim();
                    if (!id) return;

                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'plugin-album__character-preset-pill';
                    btn.title = isGroup ? formatGroupLabel(g) : formatSoundLabel(p);
                    btn.style.gap = '6px';
                    btn.style.maxWidth = '100%';
                    if (isGroup) applyPresetPillStyle(btn);

                    const play = document.createElement('span');
                    play.className = 'material-symbols-outlined';
                    play.textContent = 'play_arrow';
                    play.title = 'Preview';
                    play.style.opacity = '0.9';
                    play.style.cursor = 'pointer';
                    play.style.fontSize = '18px';
                    play.style.lineHeight = '1';
                    play.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const eng = getPreviewSoundEngine();
                            if (isGroup) {
                                if (eng && typeof eng.playGroupRandom === 'function') eng.playGroupRandom(g);
                            } else {
                                if (eng && typeof eng.playPreset === 'function') eng.playPreset(p);
                                else if (eng && typeof eng.play === 'function') eng.play(p.url);
                            }
                        } catch { }
                    });

                    const titleEl = document.createElement('span');
                    titleEl.textContent = isGroup ? formatGroupLabel(g) : formatSoundLabel(p);
                    btn.appendChild(play);
                    btn.appendChild(titleEl);

                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const otherSet = new Set((s === 1) ? (selectedSfx2 || []) : (selectedSfx1 || []));
                        if (otherSet.has(id)) {
                            showError('Sound đã tồn tại ở ô còn lại.');
                            return;
                        }
                        const list = (s === 1) ? (selectedSfx1 || []) : (selectedSfx2 || []);
                        if (!list.includes(id)) list.push(id);
                        if (s === 1) selectedSfx1 = list;
                        else selectedSfx2 = list;
                        renderSfxSelected(1);
                        renderSfxSelected(2);
                        renderSfxSuggestions(1);
                        renderSfxSuggestions(2);
                    });
                    sugEl.appendChild(btn);
                });

                applyPillWrapMaxLinesScroll(sugEl, 3);
            };

            const renderAnimSelected = () => {
                if (!animPillWrap) return;
                animPillWrap.innerHTML = '';
                selectedAnimPresets.forEach((key, idx) => {
                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = String(key);
                    pill.title = `${String(key)} (bấm để xoá)`;
                    try {
                        const isPreset = (Array.isArray(allAnimPresetKeys) ? allAnimPresetKeys : []).includes(String(key));
                        if (isPreset) applyPresetPillStyle(pill);
                    } catch { }
                    pill.dataset.index = String(idx);
                    pill.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const i = Number(pill.dataset.index);
                        if (!Number.isFinite(i) || i < 0 || i >= selectedAnimPresets.length) return;
                        selectedAnimPresets.splice(i, 1);
                        renderAnimSelected();
                        renderAnimSuggestions();
                    });
                    animPillWrap.appendChild(pill);
                });
            };

            const renderAnimSuggestions = () => {
                if (!animSug) return;
                const q = String(animInput?.value || '').trim().toLowerCase();
                animSug.innerHTML = '';
                const matches = (Array.isArray(allAnimPresetKeys) ? allAnimPresetKeys : [])
                    .filter(k => !q || String(k).toLowerCase().includes(q));
                matches.forEach((k) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'plugin-album__character-preset-pill';
                    btn.title = String(k);
                    btn.style.gap = '6px';
                    btn.style.maxWidth = '100%';
                    applyPresetPillStyle(btn);

                    const play = document.createElement('span');
                    play.className = 'material-symbols-outlined';
                    play.textContent = 'play_arrow';
                    play.title = 'Preview';
                    play.style.opacity = '0.9';
                    play.style.cursor = 'pointer';
                    play.style.fontSize = '18px';
                    play.style.lineHeight = '1';
                    play.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        previewAnimPresetKey(k);
                    });

                    const titleEl = document.createElement('span');
                    titleEl.textContent = String(k);
                    btn.appendChild(play);
                    btn.appendChild(titleEl);
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isAutoSaveAnimPresetKey(k)) return;
                        selectedAnimPresets.push(String(k));
                        renderAnimSelected();
                        renderAnimSuggestions();
                    });
                    animSug.appendChild(btn);
                });
                applyPillWrapMaxLinesScroll(animSug, 3);
            };

            animInput?.addEventListener('input', () => renderAnimSuggestions());
            sfx1Input?.addEventListener('input', () => renderSfxSuggestions(1));
            sfx2Input?.addEventListener('input', () => renderSfxSuggestions(2));

            const ready = Promise.all([
                fetchAnimPresets().then(() => { renderAnimSelected(); renderAnimSuggestions(); }),
                Promise.all([fetchSoundPresets(), fetchSoundGroups()]).then(() => {
                    renderSfxSelected(1);
                    renderSfxSelected(2);
                    renderSfxSuggestions(1);
                    renderSfxSuggestions(2);
                }),
            ]);

            return {
                ready,
                getSelectedAnimPresets: () => (Array.isArray(selectedAnimPresets) ? [...selectedAnimPresets] : []),
                getSelectedSfx1: () => (Array.isArray(selectedSfx1) ? [...selectedSfx1] : []),
                getSelectedSfx2: () => (Array.isArray(selectedSfx2) ? [...selectedSfx2] : []),
            };
        },

        async _characterOpenPresetEditor(presetId) {
            const isEditing = !!presetId;
            const preset = isEditing ? (this.state.character.presets || []).find(p => p?.id === presetId) : null;

            const nameVal = isEditing ? (preset?.name || '') : '';

            const AUTO_ANIM_SUFFIX = ' - auto save';
            const isAutoSaveAnimPresetKey = (key) => {
                try {
                    const k = String(key || '').trim();
                    if (!k) return false;
                    return k.toLowerCase().endsWith(AUTO_ANIM_SUFFIX.toLowerCase());
                } catch {
                    return false;
                }
            };

            const readAnimList = (obj) => {
                try {
                    const a = obj?.animation_presets;
                    if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                    const b = obj?.animationPresets;
                    if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
                } catch { }
                return [];
            };

            const readSoundList = (obj, slot) => {
                try {
                    const s = Number(slot);
                    if (s === 1) {
                        const a = obj?.sound_fx_1;
                        if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                        const b = obj?.soundFx1;
                        if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
                        return [];
                    }
                    if (s === 2) {
                        const a = obj?.sound_fx_2;
                        if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                        const b = obj?.soundFx2;
                        if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
                        return [];
                    }
                } catch { }
                return [];
            };

            let selectedAnimPresets = isEditing ? readAnimList(preset) : [];
            try { selectedAnimPresets = selectedAnimPresets.filter(k => !isAutoSaveAnimPresetKey(k)); } catch { }

            let selectedSfx1 = isEditing ? readSoundList(preset, 1) : [];
            let selectedSfx2 = isEditing ? readSoundList(preset, 2) : [];
            try {
                const set1 = new Set(selectedSfx1);
                selectedSfx2 = selectedSfx2.filter(x => !set1.has(x));
            } catch { }

            const modalHtml = `
                <h3>${isEditing ? 'Sửa' : 'Lưu'} Preset</h3>
                <div class="form-group"><label>Tên Preset</label><input type="text" id="preset-name" value="${nameVal}"></div>
                <div class="form-group">
                    <label>Animation</label>
                    <div class="plugin-album__character-preset-pillwrap" data-role="selected-anim-presets"></div>
                    <input type="text" id="anim-preset-search" placeholder="Gõ để tìm animation preset..." autocomplete="off" />
                    <div class="plugin-album__character-preset-pillwrap" data-role="anim-preset-suggestions"></div>
                </div>
                <div class="form-group">
                    <label>Sound Fx 1</label>
                    <div class="plugin-album__character-preset-pillwrap" data-role="selected-sfx1"></div>
                    <input type="text" id="sfx1-search" placeholder="Gõ để tìm sound..." autocomplete="off" />
                    <div class="plugin-album__character-preset-pillwrap" data-role="sfx1-suggestions"></div>
                </div>
                <div class="form-group">
                    <label>Sound Fx 2</label>
                    <div class="plugin-album__character-preset-pillwrap" data-role="selected-sfx2"></div>
                    <input type="text" id="sfx2-search" placeholder="Gõ để tìm sound..." autocomplete="off" />
                    <div class="plugin-album__character-preset-pillwrap" data-role="sfx2-suggestions"></div>
                </div>
                <div class="modal-actions">
                    ${isEditing ? `<button id="btn-duplicate" class="btn-secondary" title="Nhân đôi"><span class="material-symbols-outlined">content_copy</span></button>` : ''}
                    ${isEditing ? `<button id="btn-delete" class="btn-danger" title="Xoá"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
                    <div style="flex-grow:1"></div>
                    <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                    <button id="btn-save" title="${isEditing ? 'Cập nhật' : 'Save'}"><span class="material-symbols-outlined">check</span></button>
                </div>
            `;

            const modal = document.createElement('div');
            modal.className = 'modal-backdrop plugin-album__character-modal';
            modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;
            const close = () => { try { modal.remove(); } catch { } };
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            document.body.appendChild(modal);
            const dialog = modal.querySelector('.modal-dialog');

            dialog.querySelector('#btn-cancel').onclick = close;

            const applyPresetPillStyle = (pillEl) => {
                try {
                    if (!pillEl) return;
                    pillEl.style.background = 'color-mix(in srgb, var(--color-accent) 16%, var(--color-primary-bg))';
                } catch { }
            };

            const applyPillWrapMaxLinesScroll = (wrapEl, maxLines = 3) => {
                try {
                    if (!wrapEl) return;
                    const children = Array.from(wrapEl.children || []);
                    if (!children.length) return;
                    const first = children[0];
                    const rowGap = (() => {
                        try {
                            const cs = window.getComputedStyle(wrapEl);
                            const g = cs.rowGap || cs.gap || '0px';
                            const n = parseFloat(String(g || '0').replace('px', ''));
                            return Number.isFinite(n) ? n : 0;
                        } catch {
                            return 0;
                        }
                    })();
                    const pillH = Math.max(1, Number(first.offsetHeight || 0));
                    const maxH = (pillH * Number(maxLines || 3)) + (rowGap * Math.max(0, Number(maxLines || 3) - 1));
                    wrapEl.style.maxHeight = `${maxH}px`;
                    wrapEl.style.overflowY = 'auto';
                    wrapEl.style.overflowX = 'hidden';
                } catch { }
            };

            const previewAnimPresetKey = async (key) => {
                try {
                    const k = String(key || '').trim();
                    if (!k) return;
                    const layer = document.querySelector('.plugin-album__character-view .plugin-album__character-layer--char');
                    if (!layer) return;
                    if (typeof this._albumAnimGetEngine !== 'function') return;
                    const eng = this._albumAnimGetEngine();
                    if (!eng) return;
                    await eng.playPresetOnElement(layer, k, { loop: false, seamless: false });
                    const dur = (typeof eng.getPresetDurationMsByKey === 'function')
                        ? (await eng.getPresetDurationMsByKey(k))
                        : null;
                    const ms = Math.max(50, Number(dur || 900));
                    setTimeout(() => {
                        try { eng.stop(layer); } catch { }
                    }, ms + 60);
                } catch { }
            };

            const animPillWrap = dialog.querySelector('[data-role="selected-anim-presets"]');
            const animInput = dialog.querySelector('#anim-preset-search');
            const animSug = dialog.querySelector('[data-role="anim-preset-suggestions"]');

            const sfx1PillWrap = dialog.querySelector('[data-role="selected-sfx1"]');
            const sfx1Input = dialog.querySelector('#sfx1-search');
            const sfx1Sug = dialog.querySelector('[data-role="sfx1-suggestions"]');
            const sfx2PillWrap = dialog.querySelector('[data-role="selected-sfx2"]');
            const sfx2Input = dialog.querySelector('#sfx2-search');
            const sfx2Sug = dialog.querySelector('[data-role="sfx2-suggestions"]');

            let allAnimPresetKeys = [];
            const fetchAnimPresets = async () => {
                try {
                    const all = await this.api.album.get('/animation/presets');
                    const arr = Array.isArray(all) ? all : [];
                    allAnimPresetKeys = arr
                        .map(p => String(p?.key || '').trim())
                        .filter(Boolean)
                        .filter(k => !isAutoSaveAnimPresetKey(k));
                } catch {
                    allAnimPresetKeys = [];
                }
            };

            let allSoundPresets = [];
            let allSoundGroups = [];
            const fetchSoundPresets = async () => {
                try {
                    const all = await this.api.album.get('/sound_fx/presets');
                    const arr = Array.isArray(all) ? all : [];
                    allSoundPresets = arr
                        .filter(p => p && typeof p === 'object')
                        .map(p => ({
                            id: String(p?.id || '').trim(),
                            name: String(p?.name || '').trim(),
                            ext: String(p?.ext || '').trim().toLowerCase(),
                            url: String(p?.url || '').trim(),
                            group_ids: (() => {
                                try {
                                    const g0 = p?.group_ids;
                                    if (Array.isArray(g0)) return g0.map(x => String(x || '').trim()).filter(Boolean);
                                    const g1 = String(p?.group_id || '').trim();
                                    return g1 ? [g1] : [];
                                } catch {
                                    return [];
                                }
                            })(),
                        }))
                        .filter(p => p.id && p.name);
                    try {
                        if (!this.state.character) this.state.character = {};
                        this.state.character._soundFxPresetsCache = { fetchedAt: Date.now(), presets: allSoundPresets };
                    } catch { }
                } catch {
                    allSoundPresets = [];
                }
            };

            const fetchSoundGroups = async () => {
                try {
                    const all = await this.api.album.get('/sound_fx/groups');
                    const arr = Array.isArray(all) ? all : [];
                    allSoundGroups = arr
                        .filter(g => g && typeof g === 'object')
                        .map(g => ({
                            id: String(g?.id || '').trim(),
                            name: String(g?.name || '').trim(),
                        }))
                        .filter(g => g.id && g.name);
                } catch {
                    allSoundGroups = [];
                }
            };

            const getPreviewEngine = () => {
                try {
                    if (typeof this._albumSoundGetEngine === 'function') return this._albumSoundGetEngine();
                    if (window.Yuuka?.AlbumSoundEngine) return new window.Yuuka.AlbumSoundEngine({ api: this.api?.album });
                } catch { }
                return null;
            };

            const formatSoundLabel = (p) => {
                const n = String(p?.name || '').trim();
                const ext = String(p?.ext || '').trim().toLowerCase();
                return ext ? `${n}.${ext}` : n;
            };

            const formatGroupLabel = (g) => String(g?.name || '').trim();

            const renderSfxSelected = (slot) => {
                const s = Number(slot);
                const wrap = (s === 1) ? sfx1PillWrap : sfx2PillWrap;
                if (!wrap) return;
                const list = (s === 1) ? selectedSfx1 : selectedSfx2;

                wrap.innerHTML = '';
                list.forEach((pid, idx) => {
                    const group = allSoundGroups.find(g => g.id === pid) || null;
                    const presetObj = (!group) ? (allSoundPresets.find(p => p.id === pid) || null) : null;
                    const label = group ? formatGroupLabel(group) : (presetObj ? formatSoundLabel(presetObj) : String(pid));

                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = label;
                    pill.title = `${label} (bấm để xoá)`;
                    if (group) applyPresetPillStyle(pill);
                    pill.dataset.index = String(idx);
                    pill.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const i = Number(pill.dataset.index);
                        if (!Number.isFinite(i) || i < 0 || i >= list.length) return;
                        list.splice(i, 1);
                        if (s === 1) selectedSfx1 = list;
                        else selectedSfx2 = list;
                        renderSfxSelected(1);
                        renderSfxSelected(2);
                        renderSfxSuggestions(1);
                        renderSfxSuggestions(2);
                    });
                    wrap.appendChild(pill);
                });
            };

            const renderSfxSuggestions = (slot) => {
                const s = Number(slot);
                const inputEl = (s === 1) ? sfx1Input : sfx2Input;
                const sugEl = (s === 1) ? sfx1Sug : sfx2Sug;
                if (!sugEl) return;
                const q = String(inputEl?.value || '').trim().toLowerCase();
                sugEl.innerHTML = '';
                try { sugEl.style.maxHeight = ''; sugEl.style.overflow = ''; } catch { }

                const selectedAll = new Set([...(selectedSfx1 || []), ...(selectedSfx2 || [])]);
                const groupMatches = (Array.isArray(allSoundGroups) ? allSoundGroups : [])
                    .filter(g => !selectedAll.has(g.id))
                    .filter(g => {
                        if (!q) return true;
                        return formatGroupLabel(g).toLowerCase().includes(q);
                    })
                    .sort((a, b) => formatGroupLabel(a).localeCompare(formatGroupLabel(b), undefined, { sensitivity: 'base' }));

                const presetMatches = (Array.isArray(allSoundPresets) ? allSoundPresets : [])
                    .filter(p => !selectedAll.has(p.id))
                    .filter(p => {
                        if (!q) return true;
                        return formatSoundLabel(p).toLowerCase().includes(q);
                    })
                    .sort((a, b) => formatSoundLabel(a).localeCompare(formatSoundLabel(b), undefined, { sensitivity: 'base' }));

                const combined = [
                    ...groupMatches.map(g => ({ type: 'group', item: g })),
                    ...presetMatches.map(p => ({ type: 'preset', item: p })),
                ];

                combined.forEach((row) => {
                    const isGroup = row.type === 'group';
                    const g = isGroup ? row.item : null;
                    const p = (!isGroup) ? row.item : null;
                    const id = String((isGroup ? g?.id : p?.id) || '').trim();
                    if (!id) return;

                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'plugin-album__character-preset-pill';
                    btn.title = isGroup ? formatGroupLabel(g) : formatSoundLabel(p);
                    btn.style.gap = '6px';
                    btn.style.maxWidth = '100%';
                    if (isGroup) applyPresetPillStyle(btn);

                    const play = document.createElement('span');
                    play.className = 'material-symbols-outlined';
                    play.textContent = 'play_arrow';
                    play.title = 'Preview';
                    play.style.opacity = '0.9';
                    play.style.cursor = 'pointer';
                    play.style.fontSize = '18px';
                    play.style.lineHeight = '1';
                    play.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const eng = getPreviewEngine();
                            if (isGroup) {
                                if (eng && typeof eng.playGroupRandom === 'function') eng.playGroupRandom(g);
                            } else {
                                if (eng && typeof eng.playPreset === 'function') eng.playPreset(p);
                                else if (eng && typeof eng.play === 'function') eng.play(p.url);
                            }
                        } catch { }
                    });

                    const titleEl = document.createElement('span');
                    titleEl.textContent = isGroup ? formatGroupLabel(g) : formatSoundLabel(p);
                    btn.appendChild(play);
                    btn.appendChild(titleEl);

                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const otherSet = new Set((s === 1) ? (selectedSfx2 || []) : (selectedSfx1 || []));
                        if (otherSet.has(id)) {
                            showError('Sound đã tồn tại ở ô còn lại.');
                            return;
                        }
                        const list = (s === 1) ? (selectedSfx1 || []) : (selectedSfx2 || []);
                        if (!list.includes(id)) list.push(id);
                        if (s === 1) selectedSfx1 = list;
                        else selectedSfx2 = list;
                        renderSfxSelected(1);
                        renderSfxSelected(2);
                        renderSfxSuggestions(1);
                        renderSfxSuggestions(2);
                    });
                    sugEl.appendChild(btn);
                });

                applyPillWrapMaxLinesScroll(sugEl, 3);
            };

            const renderAnimSelected = () => {
                if (!animPillWrap) return;
                animPillWrap.innerHTML = '';
                selectedAnimPresets.forEach((key, idx) => {
                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = String(key);
                    pill.title = `${String(key)} (bấm để xoá)`;
                    try {
                        const isPreset = (Array.isArray(allAnimPresetKeys) ? allAnimPresetKeys : []).includes(String(key));
                        if (isPreset) applyPresetPillStyle(pill);
                    } catch { }
                    pill.dataset.index = String(idx);
                    pill.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const i = Number(pill.dataset.index);
                        if (!Number.isFinite(i) || i < 0 || i >= selectedAnimPresets.length) return;
                        selectedAnimPresets.splice(i, 1);
                        renderAnimSelected();
                        renderAnimSuggestions();
                    });
                    animPillWrap.appendChild(pill);
                });
            };

            const renderAnimSuggestions = () => {
                if (!animSug) return;
                const q = String(animInput?.value || '').trim().toLowerCase();
                animSug.innerHTML = '';
                const matches = (Array.isArray(allAnimPresetKeys) ? allAnimPresetKeys : [])
                    .filter(k => !q || String(k).toLowerCase().includes(q));
                matches.forEach((k) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'plugin-album__character-preset-pill';
                    btn.title = String(k);
                    btn.style.gap = '6px';
                    btn.style.maxWidth = '100%';
                    applyPresetPillStyle(btn);

                    const play = document.createElement('span');
                    play.className = 'material-symbols-outlined';
                    play.textContent = 'play_arrow';
                    play.title = 'Preview';
                    play.style.opacity = '0.9';
                    play.style.cursor = 'pointer';
                    play.style.fontSize = '18px';
                    play.style.lineHeight = '1';
                    play.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        previewAnimPresetKey(k);
                    });

                    const titleEl = document.createElement('span');
                    titleEl.textContent = String(k);
                    btn.appendChild(play);
                    btn.appendChild(titleEl);
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isAutoSaveAnimPresetKey(k)) return;
                        selectedAnimPresets.push(String(k));
                        renderAnimSelected();
                        renderAnimSuggestions();
                    });
                    animSug.appendChild(btn);
                });
                applyPillWrapMaxLinesScroll(animSug, 3);
            };

            animInput?.addEventListener('input', () => renderAnimSuggestions());
            sfx1Input?.addEventListener('input', () => renderSfxSuggestions(1));
            sfx2Input?.addEventListener('input', () => renderSfxSuggestions(2));

            fetchAnimPresets().then(() => {
                renderAnimSelected();
                renderAnimSuggestions();
            });
            Promise.all([fetchSoundPresets(), fetchSoundGroups()]).then(() => {
                renderSfxSelected(1);
                renderSfxSelected(2);
                renderSfxSuggestions(1);
                renderSfxSuggestions(2);
            });

            if (isEditing) {
                const delBtn = dialog.querySelector('#btn-delete');
                if (delBtn) {
                    delBtn.onclick = async () => {
                        if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ preset '${preset?.name || ''}'?`)) return;
                        try {
                            await this.api.album.delete(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${presetId}`);
                            const refreshed = await this.api.album.get(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`);
                            this.state.character.presets = Array.isArray(refreshed?.presets) ? refreshed.presets : [];
                            this.state.character.favourites = refreshed?.favourites && typeof refreshed.favourites === 'object' ? refreshed.favourites : {};
                            if (this.state.character.activePresetId === presetId) {
                                this.state.character.activePresetId = null;
                                this._characterSaveActivePresetId();
                            }
                            this._characterRender();
                            close();
                        } catch (e) {
                            showError(`Lỗi khi xóa: ${e.message}`);
                        }
                    };
                }

                const dupBtn = dialog.querySelector('#btn-duplicate');
                if (dupBtn) {
                    dupBtn.onclick = async () => {
                        try {
                            await this.api.album.post(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${presetId}/duplicate`, {});
                            const refreshed = await this.api.album.get(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`);
                            this.state.character.presets = Array.isArray(refreshed?.presets) ? refreshed.presets : [];
                            this._characterRender();
                            close();
                        } catch (e) {
                            showError(`Lỗi khi nhân đôi: ${e.message}`);
                        }
                    };
                }
            }

            dialog.querySelector('#btn-save').onclick = async () => {
                const name = dialog.querySelector('#preset-name').value.trim();
                if (!name) {
                    showError('Vui lòng nhập tên preset.');
                    return;
                }
                const selection = { ...this.state.character.selections };
                try {
                    if (isEditing) {
                        await this.api.album.put(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${presetId}`,
                            {
                                name,
                                selection,
                                animation_presets: selectedAnimPresets,
                                sound_fx_1: selectedSfx1,
                                sound_fx_2: selectedSfx2,
                            }
                        );
                    } else {
                        await this.api.album.post(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`,
                            {
                                name,
                                selection,
                                animation_presets: selectedAnimPresets,
                                sound_fx_1: selectedSfx1,
                                sound_fx_2: selectedSfx2,
                            }
                        );
                    }
                    const refreshed = await this.api.album.get(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`);
                    this.state.character.presets = Array.isArray(refreshed?.presets) ? refreshed.presets : [];
                    this.state.character.favourites = refreshed?.favourites && typeof refreshed.favourites === 'object' ? refreshed.favourites : {};
                    try { this._characterSessionMediaCacheWarmFromState?.({ reason: 'preset-save' }); } catch { }
                    this._characterRender();
                    close();
                } catch (e) {
                    showError(`Lỗi: ${e.message}`);
                }
            };
        },

        _characterOpenPresetViewer(presetId) {
            const imgs = this._characterGetImagesForPreset(presetId);
            if (!imgs.length) return;
            const startIndex = 0;
            
            const viewer = window.Yuuka?.plugins?.simpleViewer;
            if (!viewer) {
                showError('Plugin Simple Viewer chưa được cài đặt.');
                return;
            }

            const setFav = async (item) => {
                try {
                    await this.api.album.post(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${encodeURIComponent(presetId)}/favourite`, { image_id: item.id });
                    this.state.character.favourites[presetId] = item.id;
                    this._characterRefreshDisplayedImage();
                    if (typeof window.showSuccess === 'function') window.showSuccess('Đã đặt làm ảnh đại diện.');
                    else if (typeof window.showError === 'function') window.showError('Đã đặt làm ảnh đại diện.');
                } catch (e) {
                    showError(`Lỗi favourite: ${e.message}`);
                }
            };

            const actionButtons = [
                {
                    id: 'set-favourite',
                    icon: 'star',
                    title: 'Set favourite',
                    onClick: (item) => { if (item) setFav(item); }
                },
                {
                    id: 'delete',
                    icon: 'delete',
                    title: 'Remove Image',
                    style: 'margin-left: auto; color: white;',
                    onClick: async (item, close, updateItems) => {
                        if (!item?.id) return;
                        const ok = await Yuuka.ui.confirm('Có chắc chắn muốn xóa ảnh này?');
                        if (!ok) return;
                        try {
                            await this.api.images.delete(item.id);
                            try { Yuuka.events.emit('image:deleted', { imageId: item.id }); } catch {}

                            // Remove from local state
                            this.state.allImageData = (Array.isArray(this.state.allImageData)
                                ? this.state.allImageData.filter(img => img?.id !== item.id)
                                : []);

                            // If it was the favourite for this preset, clear local favourite
                            try {
                                if (this.state.character?.favourites?.[presetId] === item.id) {
                                    delete this.state.character.favourites[presetId];
                                }
                            } catch {}

                            // Update viewer list if supported
                            if (typeof updateItems === 'function') {
                                const refreshed = this._characterGetImagesForPreset(presetId)
                                    .map(d => ({ ...d, imageUrl: d.url }));
                                updateItems(refreshed);
                                if (!refreshed.length && typeof close === 'function') {
                                    close();
                                }
                            }

                            // Refresh current displayed image in character view
                            try { this._characterRefreshDisplayedImage(); } catch {}
                        } catch (err) {
                            showError(`Lỗi xóa: ${err.message}`);
                        }
                    }
                }
            ];

            viewer.open({
                items: imgs.map(d => ({ ...d, imageUrl: d.url })),
                startIndex,
                renderInfoPanel: (item) => {
                    if (typeof this._viewerRenderInfoPanel === 'function') {
                        return this._viewerRenderInfoPanel(item);
                    }
                    const date = new Date((item.createdAt || 0) * 1000).toLocaleString();
                    const params = item.generationConfig || {};
                    return `
                        <div style="padding: 15px; display: flex; flex-direction: column; gap: 8px;">
                            <div style="font-size: 0.9em; opacity: 0.7;">${date}</div>
                            <div><b>Model:</b> ${params.ckpt_name || 'Unknown'}</div>
                            <div><b>Sampler:</b> ${params.sampler_name} (${params.scheduler})</div>
                            <div><b>Steps:</b> ${params.steps} &nbsp;|&nbsp; <b>CFG:</b> ${params.cfg}</div>
                            <div><b>Seed:</b> ${params.seed}</div>
                        </div>
                    `;
                },
                actionButtons,
            });
        },
    });
})();
