// Album plugin - Character view UI: submenu renderers (tag groups, states, presets)
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    const _albumIsCoarsePointerDevice = (() => {
        try {
            if (typeof window !== 'undefined' && window.matchMedia) {
                if (window.matchMedia('(pointer: coarse)').matches) return true;
                if (window.matchMedia('(any-pointer: coarse)').matches) return true;
            }
        } catch { }
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number') {
                return navigator.maxTouchPoints > 0;
            }
        } catch { }
        try {
            return (typeof window !== 'undefined') && ('ontouchstart' in window);
        } catch { }
        return false;
    })();

    Object.assign(proto, {
        _characterRenderTagGroupList(category, toolbarEl, listEl) {
            // Toolbar row: + (create group) + edit (edit category icon / delete category)
            const toolbar = document.createElement('div');
            toolbar.className = 'plugin-album__character-submenu-row plugin-album__character-submenu-row--toolbar';

            const playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'plugin-album__character-submenu-iconbtn';
            playBtn.title = 'Tạo ảnh (manual)';
            playBtn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span>`;
            playBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._characterIsSortingTagGroups) return;

                // Resolve currently selected tag group for this category.
                let selectedId = this.state.character?.selections?.[category] || null;
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(category)) {
                        this._characterEnsureVNState?.();
                        const vn = this.state.character?.vn;
                        if (vn && vn.activeBgGroupIdOverride === true) {
                            const gid = String(vn.activeBgGroupId ?? '').trim();
                            selectedId = gid || null;
                        }
                    }
                } catch { }

                if (!selectedId || String(selectedId) === '__none__') {
                    try { showError('Hãy chọn ít nhất một tags group để bắt đầu.'); } catch { }
                    return;
                }

                // VN mode + BG category: regenerate selected background.
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(category)) {
                        const gid = String(selectedId || '').trim();
                        const resp = await this._characterStartVNBackgroundGeneration?.({ groupId: gid, auto: false, silent: false });
                        if (resp) {
                            try { this._characterMarkActiveCategorySelectionGenerating?.(`vn:bg:${gid}`); } catch { }
                        }
                        return;
                    }
                } catch { }

                await this._characterStartGeneration?.({ forceNew: true, auto: false, silent: false });
            });

            // Exit button (replaces auto-task toggle): closes this submenu.
            const exitBtn = document.createElement('button');
            exitBtn.type = 'button';
            exitBtn.className = 'plugin-album__character-submenu-iconbtn';
            exitBtn.title = 'Đóng';
            exitBtn.innerHTML = `<span class="material-symbols-outlined">close</span>`;
            exitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._characterCloseSubmenu();
            });

            // Edit tags groups (open manager modal)
            const editGroupsBtn = document.createElement('button');
            editGroupsBtn.type = 'button';
            editGroupsBtn.className = 'plugin-album__character-submenu-iconbtn';
            editGroupsBtn.title = `Edit tags group (${category})`;
            editGroupsBtn.innerHTML = `<span class="material-symbols-outlined">edit</span>`;
            editGroupsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._characterOpenTagGroupManagerModal(category);
            });

            const editCatBtn = document.createElement('button');
            editCatBtn.type = 'button';
            editCatBtn.className = 'plugin-album__character-submenu-iconbtn';
            editCatBtn.title = `Edit category (${category})`;
            editCatBtn.innerHTML = `<span class="material-symbols-outlined">settings</span>`;
            editCatBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._characterOpenCategoryIconEditor({ mode: 'edit', categoryName: category });
            });

            let selectedId = this.state.character.selections?.[category] || null;
            // VN mode: BG selection is stored as a per-character override.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                    && this._characterIsVisualNovelModeEnabled()
                    && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                    && this._characterIsVisualNovelBackgroundCategory(category)) {
                    this._characterEnsureVNState?.();
                    const vn = this.state.character?.vn;
                    if (vn && vn.activeBgGroupIdOverride === true) {
                        const gid = String(vn.activeBgGroupId ?? '').trim();
                        selectedId = gid || null;
                    }
                }
            } catch { }

            // "None" option: rendered in the same column position as group titles.
            const noneBtn = document.createElement('button');
            noneBtn.type = 'button';
            noneBtn.className = 'plugin-album__character-submenu-name plugin-album__character-submenu-nonebtn';
            noneBtn.textContent = 'None';
            noneBtn.title = `None (${category})`;
            noneBtn.classList.toggle('is-selected', !selectedId || String(selectedId) === '__none__');
            noneBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._characterIsSortingTagGroups) return;
                if (!this.state.character.selections) this.state.character.selections = {};
                this.state.character.selections[category] = null;
                this._characterSaveSelections();

                // VN mode: clearing BG selection should hide background immediately,
                // and must NOT trigger character-layer generation.
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(category)) {
                        try {
                            this._characterEnsureVNState?.();
                            this.state.character.vn.activeBgGroupId = null;
                            this.state.character.vn.activeBgGroupIdOverride = true;
                            try { this._characterVNSaveBgSelection?.(); } catch { }
                        } catch { }

                        // Update main menu labels/titles AFTER VN override is updated.
                        try { this._characterApplyMenuBarModeUI(); } catch { }

                        // Update selection highlight without closing submenu
                        noneBtn.classList.add('is-selected');
                        listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                            r.classList.remove('is-selected');
                        });

                        try { this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false }); } catch { }
                        try { this._characterRefreshDisplayedImage?.(); } catch { }
                        return;
                    }
                } catch { }

                // Non-VN behavior: update menu bar labels/titles now.
                try { this._characterApplyMenuBarModeUI(); } catch { }

                // Build canonical key for the current selections (including the empty selection case).
                const key = this._characterBuildPresetKeyFromSelections(this.state.character.selections);

                // Switching any tag group should move back to auto mode unless we are already auto.
                // Otherwise, a previously selected saved preset would keep overriding selection changes.
                if (this.state.character.activePresetId) {
                    const current = String(this.state.character.activePresetId || '');
                    if (current.startsWith('auto:')) {
                        this.state.character.activePresetId = key ? `auto:${key}` : null;
                    } else {
                        this.state.character.activePresetId = null;
                    }
                    this._characterSaveActivePresetId();
                }

                // Auto-suggest updates happen on successful non-auto generations (image:added).

                // Update selection highlight without closing submenu
                noneBtn.classList.add('is-selected');
                listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                    r.classList.remove('is-selected');
                });

                const presetId = this._characterResolveActivePresetId();
                const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
                if (presetId && !imgs.length) {
                    // User changed selection and needs a new image => cancel auto and run a manual task
                    await this._characterStartGeneration({ forceNew: true, auto: false });
                } else {
                    this._characterRefreshDisplayedImage();
                }
            });

            // Layout columns to match tag-group rows: [col1][col2][title][right]
            toolbar.appendChild(editGroupsBtn);
            toolbar.appendChild(editCatBtn);
            toolbar.appendChild(noneBtn);
            toolbar.appendChild(playBtn);
            toolbar.appendChild(exitBtn);
            toolbarEl.appendChild(toolbar);

            const groups = this.state.character.tagGroups?.grouped?.[category] || [];

            groups.forEach(group => {
                const row = document.createElement('div');
                row.className = 'plugin-album__character-submenu-row';
                row.dataset.groupId = group.id;
                if (typeof group.id === 'string' && group.id.startsWith('ext:')) {
                    row.classList.add('is-external');
                }
                if (selectedId && group.id === selectedId) row.classList.add('is-selected');

                // Fade group name when the resulting selection has no images yet
                try {
                    const nextSel = { ...(this.state.character.selections || {}) };
                    nextSel[category] = group.id;
                    const key = this._characterBuildPresetKeyFromSelections(nextSel);
                    const presetId = key ? `auto:${key}` : null;
                    if (presetId && this._characterGetImagesForPreset(presetId).length === 0) {
                        row.classList.add('is-empty');
                    }
                } catch { }

                const nameBtn = document.createElement('button');
                nameBtn.type = 'button';
                nameBtn.className = 'plugin-album__character-submenu-name';
                nameBtn.textContent = group.name || 'Untitled';

                // Long-press (0.5s) on a tag group row opens the tag group editor.
                // This must suppress the normal click-to-select behavior when triggered.
                let longPressTimer = null;
                let longPressFired = false;
                const clearLongPress = () => {
                    if (longPressTimer) {
                        try { clearTimeout(longPressTimer); } catch { }
                        longPressTimer = null;
                    }
                };
                const startLongPress = () => {
                    if (this._characterIsSortingTagGroups) return;
                    clearLongPress();
                    longPressFired = false;
                    longPressTimer = setTimeout(() => {
                        longPressFired = true;
                        clearLongPress();
                        try {
                            const gid = String(group?.id || '').trim();
                            if (!gid) return;
                            this._characterOpenTagGroupEditor(gid, category, { returnTo: 'submenu' });
                        } catch { }
                    }, 500);
                };

                // Mouse hold
                row.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    startLongPress();
                });
                row.addEventListener('mouseup', clearLongPress);
                row.addEventListener('mouseleave', clearLongPress);

                // Touch hold: disabled on mobile/coarse-pointer to avoid conflict with drag gestures.
                if (!_albumIsCoarsePointerDevice) {
                    row.addEventListener('touchstart', () => startLongPress(), { passive: true });
                    row.addEventListener('touchend', clearLongPress);
                    row.addEventListener('touchcancel', clearLongPress);
                }
                nameBtn.addEventListener('click', async (e) => {
                    if (longPressFired) {
                        e.preventDefault();
                        e.stopPropagation();
                        longPressFired = false;
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    if (this._characterIsSortingTagGroups) return;
                    await this._characterSelectTagGroup(category, group.id);

                    // Update selection highlight without closing submenu
                    noneBtn.classList.remove('is-selected');
                    listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                        const gid = String(r.dataset.groupId || '');
                        const isSelected = gid && (gid === String(group.id || ''));
                        r.classList.toggle('is-selected', isSelected);
                    });
                });

                // Clicking the row (empty space) should also select.
                row.addEventListener('click', async (e) => {
                    if (longPressFired) {
                        e.preventDefault();
                        e.stopPropagation();
                        longPressFired = false;
                        return;
                    }
                    e.preventDefault();
                    if (this._characterIsSortingTagGroups) return;
                    await this._characterSelectTagGroup(category, group.id);

                    // Update selection highlight without closing submenu
                    noneBtn.classList.remove('is-selected');
                    listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                        const gid = String(r.dataset.groupId || '');
                        const isSelected = gid && (gid === String(group.id || ''));
                        r.classList.toggle('is-selected', isSelected);
                    });
                });

                row.appendChild(nameBtn);
                listEl.appendChild(row);
            });
        },

        _characterRenderStateList(stateGroupId, toolbarEl, listEl) {
            try {
                this._characterEnsureStateModeState?.();
                const gid = String(stateGroupId || '').trim();
                if (!gid) return;

                const groupName = this._characterGetStateGroupNameById?.(gid) || gid;

                // Toolbar row: edit states (manager) + edit state group + None + exit
                const toolbar = document.createElement('div');
                toolbar.className = 'plugin-album__character-submenu-row plugin-album__character-submenu-row--toolbar';

                const playBtn = document.createElement('button');
                playBtn.type = 'button';
                playBtn.className = 'plugin-album__character-submenu-iconbtn';
                playBtn.title = 'Tạo ảnh (manual)';
                playBtn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span>`;
                playBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // VN mode: BG state group => regenerate selected background (vn:bg:<tagGroupId>)
                    try {
                        if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                            && this._characterIsVisualNovelModeEnabled()
                            && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                            && this._characterIsVisualNovelBackgroundStateGroup(gid)) {
                            const sid = String(this.state.character?.state?.selections?.[gid] || '').trim();
                            const bgGid = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                            if (!bgGid) {
                                try { showError('Hãy chọn background trước.'); } catch { }
                                return;
                            }
                            const resp = await this._characterStartVNBackgroundGeneration?.({ groupId: bgGid, auto: false, silent: false });
                            if (resp) {
                                try { this._characterMarkActiveCategorySelectionGenerating?.(`vn:bg:${bgGid}`); } catch { }
                            }
                            return;
                        }
                    } catch { }

                    await this._characterStartGeneration?.({ forceNew: true, auto: false, silent: false });
                });

                const exitBtn = document.createElement('button');
                exitBtn.type = 'button';
                exitBtn.className = 'plugin-album__character-submenu-iconbtn';
                exitBtn.title = 'Đóng';
                exitBtn.innerHTML = `<span class="material-symbols-outlined">close</span>`;
                exitBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterCloseSubmenu();
                });

                const editStatesBtn = document.createElement('button');
                editStatesBtn.type = 'button';
                editStatesBtn.className = 'plugin-album__character-submenu-iconbtn';
                editStatesBtn.title = `Edit states (${groupName})`;
                editStatesBtn.innerHTML = `<span class="material-symbols-outlined">edit</span>`;
                editStatesBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterOpenStateManagerModal?.(gid);
                });

                const editGroupBtn = document.createElement('button');
                editGroupBtn.type = 'button';
                editGroupBtn.className = 'plugin-album__character-submenu-iconbtn';
                editGroupBtn.title = `Edit state group (${groupName})`;
                editGroupBtn.innerHTML = `<span class="material-symbols-outlined">settings</span>`;
                editGroupBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterOpenStateGroupEditModal?.({ mode: 'edit', groupId: gid });
                });

                let selectedStateId = this.state.character?.state?.selections?.[gid] || null;

                const noneBtn = document.createElement('button');
                noneBtn.type = 'button';
                noneBtn.className = 'plugin-album__character-submenu-name plugin-album__character-submenu-nonebtn';
                noneBtn.textContent = 'None';
                noneBtn.title = `None (${groupName})`;
                noneBtn.classList.toggle('is-selected', !selectedStateId || String(selectedStateId) === '__none__');
                noneBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await this._characterSelectState?.(gid, null);

                    // Update selection highlight without closing submenu
                    noneBtn.classList.add('is-selected');
                    listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                        r.classList.remove('is-selected');
                    });
                });

                toolbar.appendChild(editStatesBtn);
                toolbar.appendChild(editGroupBtn);
                toolbar.appendChild(noneBtn);
                toolbar.appendChild(playBtn);
                toolbar.appendChild(exitBtn);
                toolbarEl.appendChild(toolbar);

                const statesAll = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const states = statesAll.filter(s => {
                    const sg = String(s?.group_id || s?.groupId || '').trim();
                    return sg === gid;
                });

                const byId = new Map(statesAll.map(s => [String(s?.id || '').trim(), s]));
                const baseSel = (this.state.character?.state?.selections && typeof this.state.character.state.selections === 'object')
                    ? this.state.character.state.selections
                    : {};
                const computeGroupIdsFromSelection = (sel) => {
                    const out = [];
                    Object.keys(sel || {}).forEach(xgid => {
                        const sid = String(sel[xgid] || '').trim();
                        if (!sid || sid === '__none__') return;
                        const st = byId.get(sid);
                        const tgids = st?.tag_group_ids;
                        if (Array.isArray(tgids)) {
                            tgids.forEach(x => {
                                const v = String(x || '').trim();
                                if (v) out.push(v);
                            });
                        }
                    });
                    return Array.from(new Set(out));
                };

                states.forEach(st => {
                    const sid = String(st?.id || '').trim();
                    if (!sid) return;

                    const row = document.createElement('div');
                    row.className = 'plugin-album__character-submenu-row';
                    row.dataset.groupId = sid;
                    if (selectedStateId && String(selectedStateId) === sid) row.classList.add('is-selected');

                    // Fade when resulting selection has no images yet
                    try {
                        const nextSel = { ...baseSel, [gid]: sid };
                        const ids = computeGroupIdsFromSelection(nextSel);
                        const key = this._characterBuildPresetKeyFromGroupIds?.(ids) || '';
                        const presetId = key ? `auto:${key}` : null;
                        if (presetId && this._characterGetImagesForPreset(presetId).length === 0) {
                            row.classList.add('is-empty');
                        }
                    } catch { }

                    const nameBtn = document.createElement('button');
                    nameBtn.type = 'button';
                    nameBtn.className = 'plugin-album__character-submenu-name';
                    nameBtn.textContent = String(st?.name || 'Untitled');

                    // Long-press 0.5s to open state editor
                    let longPressTimer = null;
                    let longPressFired = false;
                    const clear = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
                    const start = () => {
                        clear();
                        longPressFired = false;
                        longPressTimer = setTimeout(() => {
                            longPressTimer = null;
                            longPressFired = true;
                            this._characterOpenStateEditorModal?.(sid, gid, {
                                afterClose: async ({ changed }) => {
                                    if (changed) {
                                        try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }
                                    }
                                    try { this._characterRefreshSubmenu?.(`state:${gid}`); } catch { }
                                }
                            });
                        }, 500);
                    };

                    // Mouse hold
                    row.addEventListener('mousedown', (e) => { if (e.button !== 0) return; start(); });
                    row.addEventListener('mouseup', clear);
                    row.addEventListener('mouseleave', clear);

                    // Touch hold: disabled on mobile/coarse-pointer to avoid conflict with drag gestures.
                    if (!_albumIsCoarsePointerDevice) {
                        row.addEventListener('touchstart', () => start(), { passive: true });
                        row.addEventListener('touchend', clear);
                        row.addEventListener('touchcancel', clear);
                    }

                    // If long press fired, suppress subsequent click/selection
                    row.addEventListener('click', (e) => {
                        if (!longPressFired) return;
                        e.preventDefault();
                        e.stopPropagation();
                        longPressFired = false;
                    }, true);
                    nameBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (longPressFired) return;
                        await this._characterSelectState?.(gid, sid);

                        // Update selection highlight without closing submenu
                        noneBtn.classList.remove('is-selected');
                        listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                            const rid = String(r.dataset.groupId || '').trim();
                            r.classList.toggle('is-selected', !!rid && rid === sid);
                        });
                    });

                    row.addEventListener('click', async (e) => {
                        e.preventDefault();
                        if (longPressFired) return;
                        await this._characterSelectState?.(gid, sid);

                        noneBtn.classList.remove('is-selected');
                        listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(r => {
                            const rid = String(r.dataset.groupId || '').trim();
                            r.classList.toggle('is-selected', !!rid && rid === sid);
                        });
                    });

                    row.appendChild(nameBtn);
                    listEl.appendChild(row);
                });
            } catch (err) {
                console.warn('[Album] _characterRenderStateList error:', err);
            }
        },

        _characterRenderStatePresetList(toolbarEl, listEl) {
            try {
                this._characterEnsureStateModeState?.();

                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                let groupId = String(this.state.character?.state?.activeGroupId || '').trim();
                if (!groupId && groups.length) {
                    groupId = String(groups[0]?.id || '').trim();
                    this.state.character.state.activeGroupId = groupId;
                }

                if (!groupId) {
                    // Nothing to render yet.
                    listEl.innerHTML = '';
                    const row = document.createElement('div');
                    row.className = 'plugin-album__character-submenu-item';
                    row.textContent = 'Chọn state group trước.';
                    listEl.appendChild(row);
                    return;
                }

                const groupName = this._characterGetStateGroupNameById?.(groupId) || groupId;

                // Ensure presets loaded (lazy)
                const cache = this.state.character.state.presetsByGroup || (this.state.character.state.presetsByGroup = {});
                const cached = cache[groupId];
                if (!Array.isArray(cached)) {
                    listEl.innerHTML = '';
                    const row = document.createElement('div');
                    row.className = 'plugin-album__character-submenu-item';
                    row.textContent = 'Loading...';
                    listEl.appendChild(row);

                    (async () => {
                        try {
                            const res = await this.api.album.get(`/character/state_groups/${encodeURIComponent(groupId)}/presets`);
                            cache[groupId] = Array.isArray(res) ? res : [];
                        } catch (err) {
                            cache[groupId] = [];
                            try { showError(`Lỗi load state presets: ${err.message || err}`); } catch { }
                        }
                        try {
                            if (this.state.viewMode !== 'character') return;
                            if (String(this.state.character?.activeMenu || '').trim() !== 'StatePreset') return;
                            this._characterOpenSubmenu('StatePreset');
                        } catch { }
                    })();
                    return;
                }

                const presets = cached;
                const activePresetId = String(this.state.character?.state?.activePresetByGroup?.[groupId] || '').trim() || null;

                // Toolbar
                const toolbar = document.createElement('div');
                toolbar.className = 'plugin-album__character-submenu-row plugin-album__character-submenu-row--toolbar';

                const playBtn = document.createElement('button');
                playBtn.type = 'button';
                playBtn.className = 'plugin-album__character-submenu-iconbtn';
                playBtn.title = 'Tạo ảnh (manual)';
                playBtn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span>`;
                playBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await this._characterStartGeneration?.({ forceNew: true, auto: false, silent: false });
                });

                const addPresetBtn = document.createElement('button');
                addPresetBtn.type = 'button';
                addPresetBtn.className = 'plugin-album__character-submenu-iconbtn';
                addPresetBtn.title = `Lưu state preset mới (${groupName})`;
                addPresetBtn.innerHTML = `<span class="material-symbols-outlined">add</span>`;
                addPresetBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterOpenStateGroupPresetEditor?.(groupId, null);
                });

                const editPresetBtn = document.createElement('button');
                editPresetBtn.type = 'button';
                editPresetBtn.className = 'plugin-album__character-submenu-iconbtn';
                editPresetBtn.title = `Sửa state preset đang chọn (${groupName})`;
                editPresetBtn.innerHTML = `<span class="material-symbols-outlined">edit</span>`;
                editPresetBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (activePresetId) this._characterOpenStateGroupPresetEditor?.(groupId, activePresetId);
                    else this._characterOpenStateGroupPresetEditor?.(groupId, null);
                });

                const autoBtn = document.createElement('button');
                autoBtn.type = 'button';
                autoBtn.className = 'plugin-album__character-submenu-name plugin-album__character-submenu-nonebtn';
                autoBtn.textContent = 'Auto';
                autoBtn.title = `Auto (theo state đang chọn - ${groupName})`;
                autoBtn.classList.toggle('is-selected', !activePresetId);
                autoBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        if (!this.state.character.state.activePresetByGroup) this.state.character.state.activePresetByGroup = {};
                        this.state.character.state.activePresetByGroup[groupId] = null;
                        this._characterSaveStateGroupActivePresetIds?.();
                        try { this._characterApplyMenuBarModeUI?.(); } catch { }

                        // VN mode: BG group => apply background selection only.
                        try {
                            if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                                && this._characterIsVisualNovelModeEnabled()
                                && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                                && this._characterIsVisualNovelBackgroundStateGroup(groupId)) {
                                this._characterEnsureVNState?.();
                                const sid = String(this.state.character?.state?.selections?.[groupId] || '').trim();
                                const bgGid = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                                this.state.character.vn.activeBgGroupId = bgGid || null;
                                this.state.character.vn.activeBgGroupIdOverride = true;
                                try { this._characterVNSaveBgSelection?.(); } catch { }
                                try { await this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false }); } catch { }
                                try { this._characterRefreshDisplayedImage?.(); } catch { }
                                setSelectedUI(null);
                                return;
                            }
                        } catch { }

                        const presetId = this._characterResolveActivePresetId();
                        const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
                        if (presetId && !imgs.length) {
                            await this._characterStartGeneration({ forceNew: true, auto: false });
                        } else {
                            this._characterRefreshDisplayedImage?.();
                        }
                    } catch { }

                    setSelectedUI(null);
                });

                const exitBtn = document.createElement('button');
                exitBtn.type = 'button';
                exitBtn.className = 'plugin-album__character-submenu-iconbtn';
                exitBtn.title = 'Đóng';
                exitBtn.innerHTML = `<span class="material-symbols-outlined">close</span>`;
                exitBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterCloseSubmenu();
                });

                toolbarEl.innerHTML = '';
                toolbar.appendChild(addPresetBtn);
                toolbar.appendChild(editPresetBtn);
                toolbar.appendChild(autoBtn);
                toolbar.appendChild(playBtn);
                toolbar.appendChild(exitBtn);
                toolbarEl.appendChild(toolbar);

                const setSelectedUI = (presetIdOrNull) => {
                    try {
                        const target = presetIdOrNull ? String(presetIdOrNull) : '';
                        listEl.querySelectorAll('.plugin-album__character-submenu-item[data-preset-id]').forEach(el => {
                            const pid = String(el.dataset.presetId || '').trim();
                            el.classList.toggle('is-selected', !!target && pid === target);
                        });
                        autoBtn.classList.toggle('is-selected', !target);
                    } catch { }
                };

                listEl.innerHTML = '';

                presets.forEach(p => {
                    const pid = String(p?.id || '').trim();
                    const name = String(p?.name || '').trim();
                    const sid = String(p?.state_id || p?.stateId || '').trim();
                    if (!pid || !name) return;

                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'plugin-album__character-submenu-item';
                    item.dataset.presetId = pid;
                    item.textContent = name;

                    // Tooltip: include state name if available
                    try {
                        const stName = (() => {
                            const all = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                            const hit = all.find(s => String(s?.id || '').trim() === sid);
                            return hit ? String(hit.name || '').trim() : '';
                        })();
                        item.title = stName ? `${name}: ${stName}` : name;
                    } catch {
                        item.title = name;
                    }

                    item.classList.toggle('is-selected', !!activePresetId && pid === activePresetId);
                    item.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        try {
                            if (!this.state.character.state.activePresetByGroup) this.state.character.state.activePresetByGroup = {};
                            this.state.character.state.activePresetByGroup[groupId] = pid;
                            this._characterSaveStateGroupActivePresetIds?.();

                            this.state.character.state.selections[groupId] = sid || null;
                            this._characterSaveStateSelections?.();

                            try { this._characterApplyMenuBarModeUI?.(); } catch { }

                            // VN mode: BG group => update VN background selection and avoid character generation.
                            try {
                                if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                                    && this._characterIsVisualNovelModeEnabled()
                                    && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                                    && this._characterIsVisualNovelBackgroundStateGroup(groupId)) {
                                    this._characterEnsureVNState?.();
                                    const bgGid = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                                    this.state.character.vn.activeBgGroupId = bgGid || null;
                                    this.state.character.vn.activeBgGroupIdOverride = true;
                                    try { this._characterVNSaveBgSelection?.(); } catch { }
                                    try { await this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false }); } catch { }
                                    try { this._characterRefreshDisplayedImage?.(); } catch { }
                                    setSelectedUI(pid);
                                    return;
                                }
                            } catch { }

                            const presetId = this._characterResolveActivePresetId();
                            const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
                            if (presetId && !imgs.length) {
                                await this._characterStartGeneration({ forceNew: true, auto: false });
                            } else {
                                this._characterRefreshDisplayedImage?.();
                            }
                        } catch { }

                        setSelectedUI(pid);
                    });

                    listEl.appendChild(item);
                });

                // Ensure highlight reflects activePresetId
                setSelectedUI(activePresetId);
            } catch (err) {
                console.warn('[Album] _characterRenderStatePresetList error:', err);
            }
        },

        _characterRenderPresetList(toolbarEl, listEl) {
            // Backward/defensive: if called with a single arg (list element), resolve proper hosts.
            try {
                if (!listEl && toolbarEl && typeof toolbarEl.closest === 'function') {
                    const maybeList = toolbarEl;
                    const submenu = maybeList.closest('.plugin-album__character-submenu');
                    const resolvedToolbar = submenu?.querySelector('.plugin-album__character-submenu-toolbar');
                    const resolvedList = submenu?.querySelector('.plugin-album__character-submenu-list');
                    if (resolvedToolbar && resolvedList) {
                        toolbarEl = resolvedToolbar;
                        listEl = resolvedList;
                    }
                }
            } catch { }
            if (!toolbarEl || !listEl) return;

            const presets = Array.isArray(this.state.character.presets) ? this.state.character.presets : [];
            const activeId = this.state.character.activePresetId;

            let categories = this._characterGetCategoryNames();
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bg) {
                        const bgLower = String(bg).trim().toLowerCase();
                        categories = (categories || []).filter(c => String(c || '').trim().toLowerCase() !== bgLower);
                    }
                }
            } catch { }

            // Running-task progress per preset (for fill animation in this submenu)
            const progressByPreset = this._characterGetRunningPresetProgressMap(this._lastAllTasksStatus || {});

            // Auto-suggest presets (computed in-session). Show full 20 in UI.
            // Shape: [{ key: 'g:...', score: number }, ...]
            let autoKeys = [];
            try {
                const suggested = this.state.character.autoSuggestPresets;
                if (Array.isArray(suggested) && suggested.length) {
                    autoKeys = suggested
                        .filter(s => s && typeof s.key === 'string' && s.key.trim())
                        .slice(0, 20)
                        .map(s => [String(s.key).trim(), Number(s.score) || 0]);
                }
            } catch { }

            // Toolbar row (match layout/UX of normal category submenu toolbars)
            const toolbar = document.createElement('div');
            toolbar.className = 'plugin-album__character-submenu-row plugin-album__character-submenu-row--toolbar';

            const playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'plugin-album__character-submenu-iconbtn';
            playBtn.title = 'Tạo ảnh (manual)';
            playBtn.innerHTML = `<span class="material-symbols-outlined">play_arrow</span>`;
            playBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this._characterStartGeneration?.({ forceNew: true, auto: false, silent: false });
            });

            // Create preset
            const addPresetBtn = document.createElement('button');
            addPresetBtn.type = 'button';
            addPresetBtn.className = 'plugin-album__character-submenu-iconbtn';
            addPresetBtn.title = 'Lưu preset mới';
            addPresetBtn.innerHTML = `<span class="material-symbols-outlined">add</span>`;
            addPresetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._characterOpenPresetEditor(null);
            });

            // Edit active preset (if any); otherwise open create.
            const editPresetBtn = document.createElement('button');
            editPresetBtn.type = 'button';
            editPresetBtn.className = 'plugin-album__character-submenu-iconbtn';
            editPresetBtn.title = 'Sửa preset đang chọn';
            editPresetBtn.innerHTML = `<span class="material-symbols-outlined">edit</span>`;
            editPresetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pid = String(this.state.character.activePresetId || '').trim();
                if (pid && !pid.startsWith('auto:')) {
                    this._characterOpenPresetEditor(pid);
                } else {
                    this._characterOpenPresetEditor(null);
                }
            });

            // "Auto" option: clear saved preset override (stay on current selections-derived auto key)
            const autoBtn = document.createElement('button');
            autoBtn.type = 'button';
            autoBtn.className = 'plugin-album__character-submenu-name plugin-album__character-submenu-nonebtn';
            autoBtn.textContent = 'Auto';
            autoBtn.title = 'Auto (theo selections hiện tại)';
            // Mirror category "None": selected only when no explicit preset is chosen.
            autoBtn.classList.toggle('is-selected', !activeId);
            autoBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Clear saved preset override; auto id will be derived from current selections.
                this.state.character.activePresetId = null;
                this._characterSaveActivePresetId();
                try { this._characterApplyMenuBarModeUI(); } catch { }

                // If no image for this selection, run a manual task
                const presetId = this._characterResolveActivePresetId();
                const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
                if (presetId && !imgs.length) {
                    await this._characterStartGeneration({ forceNew: true, auto: false });
                } else {
                    this._characterRefreshDisplayedImage();
                }

                // Update highlight without closing submenu
                setSelectedUI(null);
            });

            // Exit button (replaces auto-task toggle): closes this submenu.
            const exitBtn = document.createElement('button');
            exitBtn.type = 'button';
            exitBtn.className = 'plugin-album__character-submenu-iconbtn';
            exitBtn.title = 'Đóng';
            exitBtn.innerHTML = `<span class="material-symbols-outlined">close</span>`;
            exitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._characterCloseSubmenu();
            });

            // Layout columns to match tag-group toolbar rows
            toolbar.appendChild(addPresetBtn);
            toolbar.appendChild(editPresetBtn);
            toolbar.appendChild(autoBtn);
            toolbar.appendChild(playBtn);
            toolbar.appendChild(exitBtn);
            toolbarEl.appendChild(toolbar);

            const setSelectedUI = (presetIdOrNull) => {
                try {
                    const target = presetIdOrNull ? String(presetIdOrNull) : '';
                    listEl.querySelectorAll('.plugin-album__character-submenu-item[data-preset-id]').forEach(el => {
                        const pid = String(el.dataset.presetId || '');
                        el.classList.toggle('is-selected', !!target && pid === target);
                    });
                    autoBtn.classList.toggle('is-selected', !target);
                } catch { }
            };

            const flat = this.state.character.tagGroups?.flat || {};
            const nameForId = (id) => {
                const g = id ? flat[id] : null;
                return (g && g.name) ? String(g.name) : '';
            };

            // 1) User-saved presets first
            presets.forEach(preset => {
                const btn = document.createElement('button');
                btn.className = 'plugin-album__character-submenu-item plugin-album__character-submenu-item--saved';
                btn.textContent = preset.name || 'Preset';
                btn.dataset.presetId = preset.id;
                if (activeId && preset.id === activeId) btn.classList.add('is-selected');

                // If this preset already has images, show a blurred thumbnail as background.
                try { this._characterApplyPresetItemBackground(btn, preset.id); } catch { }

                // Generating fill
                try {
                    const p = progressByPreset.get(String(preset.id));
                    if (typeof p === 'number') {
                        btn.classList.add('is-generating');
                        btn.style.setProperty('--album-preset-progress', String(p));
                    }
                } catch { }

                btn.addEventListener('click', async () => {
                    await this._characterSelectPreset(preset.id);
                    // Keep submenu open + update selection highlight immediately
                    setSelectedUI(preset.id);
                });
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this._characterOpenPresetEditor(preset.id);
                });

                // Touch hold: disabled on mobile/coarse-pointer to avoid conflict with drag gestures.
                if (!_albumIsCoarsePointerDevice) {
                    let longPressTimer = null;
                    const clear = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
                    btn.addEventListener('touchstart', () => {
                        clear();
                        longPressTimer = setTimeout(() => {
                            longPressTimer = null;
                            this._characterOpenPresetEditor(preset.id);
                        }, 500);
                    }, { passive: true });
                    btn.addEventListener('touchend', clear);
                    btn.addEventListener('touchcancel', clear);
                }

                listEl.appendChild(btn);
            });

            // 2) Auto-suggest presets after (full 20)
            autoKeys.forEach(([key, rankValue], idx) => {
                const autoId = `auto:${key}`;
                const selMap = this._characterParsePresetKeyToSelectionMap(key);
                // Render tag group names as separated pills (no "#x:" prefix, no commas).
                const parts = categories
                    .map((cat) => {
                        const k = String(cat || '').trim().toLowerCase();
                        const gid = (k && selMap && Object.prototype.hasOwnProperty.call(selMap, k)) ? (selMap[k] || '') : '';
                        const n = nameForId(gid);
                        return n ? { name: n, category: cat } : null;
                    })
                    .filter(Boolean);

                const btn = document.createElement('button');
                btn.className = 'plugin-album__character-submenu-item plugin-album__character-submenu-item--autosuggest';
                btn.dataset.presetId = autoId;
                if (activeId && autoId === activeId) btn.classList.add('is-selected');

                // If images exist for this auto preset, show blurred thumbnail background.
                try { this._characterApplyPresetItemBackground(btn, autoId); } catch { }

                // Generating fill
                try {
                    const p = progressByPreset.get(String(autoId));
                    if (typeof p === 'number') {
                        btn.classList.add('is-generating');
                        btn.style.setProperty('--album-preset-progress', String(p));
                    }
                } catch { }

                // Inner wrapper: fixes layout/height issues and isolates progress fill background.
                const inner = document.createElement('div');
                inner.className = 'plugin-album__character-preset-item-inner';

                const wrap = document.createElement('div');
                wrap.className = 'plugin-album__character-preset-pillwrap';
                parts.forEach((part) => {
                    const pill = document.createElement('span');
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = String(part?.name || '');

                    // Tint auto-suggest tag pill using the category color (darkened)
                    try {
                        const catColor = this._characterGetCategoryColor(part?.category);
                        const dark = catColor ? (this._characterDarkenHexColor(catColor, 0.45) || catColor) : null;
                        if (dark) {
                            pill.classList.add('is-tinted');
                            pill.style.backgroundColor = dark;
                        }
                    } catch { }
                    wrap.appendChild(pill);
                });
                if (!parts.length) {
                    const pill = document.createElement('span');
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = 'Auto';
                    wrap.appendChild(pill);
                }
                inner.appendChild(wrap);
                btn.appendChild(inner);

                const titleParts = parts.length ? parts.map(p => p.name).join(' • ') : 'Auto';
                btn.title = `Auto ${idx + 1} • ${titleParts}`;

                btn.addEventListener('click', async () => {
                    await this._characterSelectAutoPresetKey(key);
                    // Keep submenu open + update selection highlight immediately
                    setSelectedUI(autoId);
                });

                listEl.appendChild(btn);
            });
        },
    });
})();
