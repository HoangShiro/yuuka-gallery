// Album plugin - View module: character view (Menu & UI)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterRefreshOpenSubmenuEmptyStates() {
            try {
                if (this.state.viewMode !== 'character') return;
                const activeMenu = String(this.state.character?.activeMenu || '').trim();
                if (!activeMenu || activeMenu === 'Preset' || activeMenu === 'StatePreset') return;

                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(activeMenu) || '';
                const isStateGroupMenu = !!stateGroupId;
                const category = activeMenu;
                const baseSel = (this.state.character.selections && typeof this.state.character.selections === 'object')
                    ? this.state.character.selections
                    : {};

                if (isStateGroupMenu) {
                    this._characterEnsureStateModeState?.();
                    const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                    const byId = new Map(states.map(s => [String(s?.id || '').trim(), s]));
                    const baseStateSel = (this.state.character?.state?.selections && typeof this.state.character.state.selections === 'object')
                        ? this.state.character.state.selections
                        : {};

                    const computeGroupIdsFromSelection = (sel) => {
                        const out = [];
                        Object.keys(sel || {}).forEach(gid => {
                            const sid = String(sel[gid] || '').trim();
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

                    // For each state row, recompute whether selecting it would yield any images.
                    listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(row => {
                        const sid = String(row.dataset.groupId || '').trim();
                        if (!sid) return;

                        const nextSel = { ...baseStateSel, [stateGroupId]: sid };
                        const ids = computeGroupIdsFromSelection(nextSel);
                        const key = this._characterBuildPresetKeyFromGroupIds?.(ids) || '';
                        const presetId = key ? `auto:${key}` : null;
                        if (!presetId) {
                            row.classList.remove('is-empty');
                            return;
                        }
                        const hasImages = this._characterGetImagesForPreset(presetId).length > 0;
                        row.classList.toggle('is-empty', !hasImages);
                    });
                    return;
                }

                // Visual Novel mode: background category uses a dedicated availability check.
                // IMPORTANT: Never fall back to the normal category logic for BG category.
                // Normal logic uses preset keys that intentionally ignore BG selection, which
                // makes all rows look "available" and causes UI conflicts.
                const isVnBgCategory = !!(
                    typeof this._characterIsVisualNovelModeEnabled === 'function'
                    && this._characterIsVisualNovelModeEnabled()
                    && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                    && this._characterIsVisualNovelBackgroundCategory(category)
                );

                if (isVnBgCategory) {
                    try {
                        this._characterEnsureVNState?.();
                        const vn = this.state.character?.vn;
                        const keySet = vn?.bgAvailableContextKeys;
                        const hasKeySet = !!(keySet && typeof keySet.has === 'function');

                        // Kick off a single in-flight load if we don't have keys yet.
                        if (!hasKeySet && typeof this._characterVNEnsureBackgroundAlbumLoaded === 'function') {
                            try {
                                // Avoid starting multiple concurrent loads.
                                if (!vn?._bgAlbumLoadPromise) {
                                    const p = this._characterVNEnsureBackgroundAlbumLoaded({ force: true });
                                    if (p && typeof p.then === 'function') {
                                        // Refresh once after load completes, if submenu is still open.
                                        p.then(() => {
                                            try {
                                                if (this.state.viewMode !== 'character') return;
                                                if (String(this.state.character?.activeMenu || '').trim() !== category) return;
                                                const sm = this.contentArea?.querySelector('.plugin-album__character-submenu');
                                                if (!sm || sm.hidden) return;
                                                this._characterRefreshOpenSubmenuEmptyStates();
                                            } catch { }
                                        }).catch(() => { });
                                    }
                                }
                            } catch { }
                        }

                        const flat = this.state.character?.tagGroups?.flat || {};
                        // If we don't have the BG album scan result yet, be pessimistic: mark empty.
                        listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(row => {
                            const gid = String(row.dataset.groupId || '').trim();
                            if (!gid) return;

                            if (!hasKeySet) {
                                row.classList.add('is-empty');
                                return;
                            }

                            const g = flat?.[gid];
                            const tags = (g && Array.isArray(g.tags)) ? g.tags : [];
                            const groupKey = (typeof this._characterVNNormalizeContextKey === 'function')
                                ? this._characterVNNormalizeContextKey(tags)
                                : '';
                            const ok = !!(groupKey && keySet.has(groupKey));
                            row.classList.toggle('is-empty', !ok);
                        });
                    } catch (err) {
                        console.warn('[Album] VN BG availability check error:', err);
                    }
                    return;
                }

                // For each group row, recompute whether selecting it would yield any images.
                listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(row => {
                    const gid = String(row.dataset.groupId || '').trim();
                    if (!gid) return;

                    const nextSel = { ...baseSel };
                    nextSel[category] = gid;
                    const key = this._characterBuildPresetKeyFromSelections(nextSel);
                    const presetId = key ? `auto:${key}` : null;
                    if (!presetId) {
                        row.classList.remove('is-empty');
                        return;
                    }
                    const hasImages = this._characterGetImagesForPreset(presetId).length > 0;
                    row.classList.toggle('is-empty', !hasImages);
                });
            } catch (err) {
                console.warn('[Album] _characterRefreshOpenSubmenuEmptyStates error:', err);
            }
        },

        _characterEnsureMenuProgressUI() {
            const root = this.contentArea?.querySelector('.plugin-album__character-view');
            if (!root) return;

            // Main menu progress indicator: a thin right-edge bar (like a scrollbar)
            let bar = root.querySelector('.plugin-album__character-progressbar');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'plugin-album__character-progressbar';
                bar.hidden = true;
                bar.setAttribute('aria-hidden', 'true');
                bar.innerHTML = `<div class="plugin-album__character-progressbar-fill" aria-hidden="true"></div>`;
                root.appendChild(bar);
            }
        },

        _characterUpdateMenuProgressBorder(allTasksStatus) {
            try {
                if (this.state.viewMode !== 'character') return;
                this._characterEnsureMenuProgressUI();

                const root = this.contentArea?.querySelector('.plugin-album__character-view');
                const menu = root?.querySelector('.plugin-album__character-menu');
                const bar = root?.querySelector('.plugin-album__character-progressbar');
                if (!menu || !bar) return;

                const currentCharHash = String(this.state?.selectedCharacter?.hash || '').trim();

                // Any running generation task => show progress border.
                // If multiple tasks: use the highest progress_percent.
                let best = null;
                let hasAuto = false;
                let hasNonAutoOrUnknown = false;

                Object.values(allTasksStatus || {}).forEach(task => {
                    if (!task) return;
                    if (task.is_running === false) return;

                    // VN BG tasks run under a different character_hash (Background album).
                    // Include them if their local meta binds them to the currently selected character.
                    if (currentCharHash && String(task.character_hash || '') !== currentCharHash) {
                        try {
                            const tid = String(task.task_id || task.taskId || '').trim();
                            const meta = tid ? this._characterTaskMeta.get(tid) : null;
                            if (!(meta && meta.vnLayer === 'bg' && String(meta.characterHash || '') === currentCharHash)) return;
                        } catch {
                            return;
                        }
                    }

                    // Determine whether this running task is auto or non-auto.
                    // If unknown, treat as non-auto so we don't mislabel manual tasks.
                    try {
                        const tid = String(task.task_id || task.taskId || '').trim();
                        const meta = tid ? this._characterTaskMeta.get(tid) : null;
                        if (meta && meta.isAuto === true) {
                            hasAuto = true;
                        } else {
                            hasNonAutoOrUnknown = true;
                        }
                    } catch {
                        hasNonAutoOrUnknown = true;
                    }

                    const p = Number(task.progress_percent ?? 0);
                    if (!Number.isFinite(p)) return;
                    if (!best || p > (best.progress_percent ?? 0)) best = task;
                });

                if (!best) {
                    bar.hidden = true;
                    menu.classList.remove('is-generating');
                    menu.classList.remove('is-auto-generating');
                    bar.classList.remove('is-auto-generating');
                    bar.style.removeProperty('--album-menu-progress');
                    bar.style.removeProperty('--album-mainmenu-top');
                    bar.style.removeProperty('--album-mainmenu-height');
                    return;
                }

                const percent = Math.max(0, Math.min(100, Number(best.progress_percent ?? 0)));

                // Anchor the progress bar to the main menu stack height (not the whole view)
                try {
                    const rootRect = root.getBoundingClientRect();
                    const menuRect = menu.getBoundingClientRect();
                    const top = Math.max(0, menuRect.top - rootRect.top);
                    const height = Math.max(0, menuRect.height);
                    bar.style.setProperty('--album-mainmenu-top', `${top}px`);
                    bar.style.setProperty('--album-mainmenu-height', `${height}px`);
                } catch { }

                bar.hidden = false;
                menu.classList.add('is-generating');
                // Auto styling only when we are confident all running tasks are auto.
                menu.classList.toggle('is-auto-generating', hasAuto && !hasNonAutoOrUnknown);
                bar.classList.toggle('is-auto-generating', hasAuto && !hasNonAutoOrUnknown);
                bar.style.setProperty('--album-menu-progress', String(percent));
            } catch (err) {
                console.warn('[Album] _characterUpdateMenuProgressBorder error:', err);
            }
        },

        _characterUpdatePresetSubmenuTaskUI(allTasksStatus) {
            try {
                if (this.state.viewMode !== 'character') return;
                if (String(this.state.character?.activeMenu || '').trim() !== 'Preset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                const progressByPreset = this._characterGetRunningPresetProgressMap(allTasksStatus || {});
                listEl.querySelectorAll('.plugin-album__character-submenu-item[data-preset-id]').forEach(el => {
                    const pid = String(el.dataset.presetId || '').trim();
                    const progress = pid ? progressByPreset.get(pid) : null;
                    const isRunning = typeof progress === 'number';
                    el.classList.toggle('is-generating', isRunning);
                    if (isRunning) {
                        el.style.setProperty('--album-preset-progress', String(Math.max(0, Math.min(100, progress))));
                    } else {
                        el.style.removeProperty('--album-preset-progress');
                    }

                    // Also keep the blurred background thumbnail synced.
                    try { this._characterApplyPresetItemBackground(el, pid); } catch { }
                });
            } catch (err) {
                console.warn('[Album] _characterUpdatePresetSubmenuTaskUI error:', err);
            }
        },

        _characterApplyPresetItemBackground(el, presetId) {
            try {
                if (!el) return;
                const pid = String(presetId || '').trim();
                if (!pid) {
                    el.classList.remove('has-bg');
                    el.style.removeProperty('--album-preset-bg');
                    return;
                }
                const url = this._characterGetBestImageUrlForPresetId(pid);
                if (!url) {
                    el.classList.remove('has-bg');
                    el.style.removeProperty('--album-preset-bg');
                    return;
                }
                const safe = String(url).replace(/"/g, '\\"');
                el.classList.add('has-bg');
                el.style.setProperty('--album-preset-bg', `url(\"${safe}\")`);
            } catch { }
        },

        _characterUpdatePresetSubmenuBackgroundUI({ presetIds = null } = {}) {
            try {
                if (this.state.viewMode !== 'character') return;
                if (String(this.state.character?.activeMenu || '').trim() !== 'Preset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                let allow = null;
                if (presetIds) {
                    const arr = Array.isArray(presetIds) ? presetIds : [presetIds];
                    const set = new Set(arr.map(v => String(v || '').trim()).filter(Boolean));
                    allow = set.size ? set : null;
                }

                listEl.querySelectorAll('.plugin-album__character-submenu-item[data-preset-id]').forEach(el => {
                    const pid = String(el.dataset.presetId || '').trim();
                    if (allow && !allow.has(pid)) return;
                    this._characterApplyPresetItemBackground(el, pid);
                });
            } catch (err) {
                console.warn('[Album] _characterUpdatePresetSubmenuBackgroundUI error:', err);
            }
        },

        _characterUpdateTagGroupSubmenuTaskUI(allTasksStatus) {
            try {
                if (this.state.viewMode !== 'character') return;
                const activeMenu = String(this.state.character?.activeMenu || '').trim();
                if (!activeMenu || activeMenu === 'Preset' || activeMenu === 'StatePreset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(activeMenu) || '';
                const isStateGroupMenu = !!stateGroupId;
                const selectedGroupId = isStateGroupMenu
                    ? (this.state.character?.state?.selections?.[stateGroupId] || null)
                    : (this.state.character?.selections?.[activeMenu] || null);

                // Visual Novel mode: BG category progress is tracked as vn:bg:<groupId>.
                let progress = null;
                try {
                    // VN mode: BG state group submenu uses vn:bg:<tagGroupId> progress.
                    if (isStateGroupMenu
                        && typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                        && this._characterIsVisualNovelBackgroundStateGroup(stateGroupId)) {
                        const sid = String(selectedGroupId || '').trim();
                        const bgGid = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                        if (bgGid) {
                            progress = this._characterGetRunningPresetProgressForPresetId(
                                allTasksStatus || {},
                                `vn:bg:${bgGid}`,
                                { nonAutoOnly: false }
                            );
                        }
                    }

                    if (!isStateGroupMenu
                        && typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(activeMenu)) {
                        const gid = String(selectedGroupId || '').trim();
                        if (gid && gid !== '__none__') {
                            progress = this._characterGetRunningPresetProgressForPresetId(
                                allTasksStatus || {},
                                `vn:bg:${gid}`,
                                { nonAutoOnly: false }
                            );
                        }
                    }
                } catch { }

                if (progress === null) {
                    const presetId = this._characterResolveActivePresetId();
                    progress = presetId
                        ? this._characterGetRunningPresetProgressForPresetId(allTasksStatus || {}, presetId, { nonAutoOnly: true })
                        : null;
                }
                const isRunning = typeof progress === 'number';

                // Clear previous generating state
                listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(row => {
                    row.classList.remove('is-generating');
                    row.style.removeProperty('--album-preset-progress');
                });

                if (!selectedGroupId || String(selectedGroupId) === '__none__') return;
                if (!isRunning) return;

                // Apply generating state only to currently selected row
                const target = String(selectedGroupId);
                const rows = Array.from(listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]'));
                const row = rows.find(r => String(r.dataset.groupId || '') === target);
                if (!row) return;
                row.classList.add('is-generating');
                row.style.setProperty('--album-preset-progress', String(Math.max(0, Math.min(100, progress))));
            } catch (err) {
                console.warn('[Album] _characterUpdateTagGroupSubmenuTaskUI error:', err);
            }
        },

        _characterMarkActiveCategorySelectionGenerating(presetId) {
            try {
                if (this.state.viewMode !== 'character') return;
                const activeMenu = String(this.state.character?.activeMenu || '').trim();
                if (!activeMenu || activeMenu === 'Preset' || activeMenu === 'StatePreset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(activeMenu) || '';
                const isStateGroupMenu = !!stateGroupId;
                const selectedGroupId = isStateGroupMenu
                    ? (this.state.character?.state?.selections?.[stateGroupId] || null)
                    : (this.state.character?.selections?.[activeMenu] || null);
                if (!selectedGroupId || String(selectedGroupId) === '__none__') return;

                // VN mode: for BG category, use vn:bg:<groupId> as the identity.
                try {
                    if (isStateGroupMenu
                        && typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                        && this._characterIsVisualNovelBackgroundStateGroup(stateGroupId)) {
                        const sid = String(selectedGroupId || '').trim();
                        const bgGid = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                        const expected = bgGid ? `vn:bg:${bgGid}` : '';
                        if (!expected || String(expected) !== String(presetId || '')) return;
                    } else if (!isStateGroupMenu
                        && typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(activeMenu)) {
                        const expected = `vn:bg:${String(selectedGroupId || '').trim()}`;
                        if (String(expected) !== String(presetId || '')) return;
                    } else {
                        // Only mark when this generation is for the currently resolved preset
                        const resolved = this._characterResolveActivePresetId();
                        if (!resolved || String(resolved) !== String(presetId || '')) return;
                    }
                } catch {
                    const resolved = this._characterResolveActivePresetId();
                    if (!resolved || String(resolved) !== String(presetId || '')) return;
                }

                // Clear others
                listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(row => {
                    row.classList.remove('is-generating');
                    row.style.removeProperty('--album-preset-progress');
                });

                const target = String(selectedGroupId);
                const rows = Array.from(listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]'));
                const row = rows.find(r => String(r.dataset.groupId || '') === target);
                if (!row) return;

                row.classList.add('is-generating');
                row.style.setProperty('--album-preset-progress', '0');
            } catch { }
        },

        _characterLoadMenuBarMode() {
            try {
                const raw = localStorage.getItem(this._LS_CHAR_MENU_BAR_MODE_KEY);
                const v = Number.parseInt(String(raw || ''), 10);
                if ([0, 1, 2, 3].includes(v)) return v;
            } catch { }
            return 0;
        },

        _characterLoadMainMenuMode() {
            try {
                const raw = localStorage.getItem(this._LS_CHAR_MAIN_MENU_MODE_KEY);
                const v = String(raw || '').trim().toLowerCase();
                if (v === 'category' || v === 'state') return v;
            } catch { }
            return 'category';
        },

        _characterSaveMenuBarMode() {
            try {
                const v = Number(this.state.character?.ui?.menuBarMode ?? 0);
                if ([0, 1, 2, 3].includes(v)) localStorage.setItem(this._LS_CHAR_MENU_BAR_MODE_KEY, String(v));
                else localStorage.removeItem(this._LS_CHAR_MENU_BAR_MODE_KEY);
            } catch { }
        },

        _characterSaveMainMenuMode() {
            try {
                const v = String(this.state.character?.ui?.menuMode ?? 'category').trim().toLowerCase();
                if (v === 'category' || v === 'state') {
                    localStorage.setItem(this._LS_CHAR_MAIN_MENU_MODE_KEY, v);
                } else {
                    localStorage.removeItem(this._LS_CHAR_MAIN_MENU_MODE_KEY);
                }
            } catch { }
        },

        _characterCycleMenuBarMode() {
            try {
                const current = Number(this.state.character?.ui?.menuBarMode ?? 0);
                const next = (Number.isFinite(current) ? current : 0) + 1;
                this.state.character.ui.menuBarMode = next % 4;
                this._characterSaveMenuBarMode();
                this._characterApplyMenuBarModeUI();
            } catch (err) {
                console.warn('[Album] _characterCycleMenuBarMode error:', err);
            }
        },

        _characterGetSelectedGroupNameForCategory(categoryName) {
            try {
                if (this.state?.viewMode !== 'character') return '';

                const category = String(categoryName || '').trim();
                if (!category) return '';

                let selectedId = this.state?.character?.selections?.[category] ?? null;

                // VN mode: BG selection can be stored as per-character override.
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(category)) {
                        this._characterEnsureVNState?.();
                        const vn = this.state?.character?.vn;
                        if (vn && vn.activeBgGroupIdOverride === true) {
                            const gid = String(vn.activeBgGroupId ?? '').trim();
                            selectedId = gid || null;
                        }
                    }
                } catch { }

                if (!selectedId || String(selectedId) === '__none__') return '';
                const sid = String(selectedId);

                const flat = this.state?.character?.tagGroups?.flat || {};
                const g = flat?.[sid];
                if (g && typeof g.name === 'string' && g.name.trim()) return String(g.name);

                // Fallback: scan grouped list for this category.
                const grouped = this.state?.character?.tagGroups?.grouped?.[category] || null;
                if (Array.isArray(grouped)) {
                    const hit = grouped.find(x => x && String(x.id || '') === sid);
                    if (hit && typeof hit.name === 'string' && hit.name.trim()) return String(hit.name);
                }

                return '';
            } catch {
                return '';
            }
        },

        _characterParseStateGroupIdFromMenuName(menuName) {
            const raw = String(menuName || '').trim();
            if (!raw.startsWith('state:')) return '';
            return String(raw.slice('state:'.length) || '').trim();
        },

        _characterGetStateGroupNameById(stateGroupId) {
            try {
                const gid = String(stateGroupId || '').trim();
                if (!gid) return '';
                this._characterEnsureStateModeState?.();
                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                const hit = groups.find(g => String(g?.id || '').trim() === gid);
                return hit ? String(hit.name || '').trim() : '';
            } catch {
                return '';
            }
        },

        _characterGetSelectedStateNameForGroup(stateGroupId) {
            try {
                const gid = String(stateGroupId || '').trim();
                if (!gid) return '';
                this._characterEnsureStateModeState?.();
                const selectedId = this.state.character?.state?.selections?.[gid] ?? null;
                if (!selectedId || String(selectedId) === '__none__') return '';
                const sid = String(selectedId || '').trim();
                const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const hit = states.find(s => String(s?.id || '').trim() === sid);
                return hit ? String(hit.name || '').trim() : '';
            } catch {
                return '';
            }
        },

        _characterApplyMenuBarModeUI() {
            if (this.state.viewMode !== 'character') return;
            const mode = Number(this.state.character?.ui?.menuBarMode ?? 0);
            const menuMode = String(this.state.character?.ui?.menuMode || 'category').trim().toLowerCase();
            const isStateMode = menuMode === 'state';
            const menu = this.contentArea?.querySelector('.plugin-album__character-menu');
            if (!menu) return;

            const isHideCategoriesMode = (mode === 3);
            try {
                menu.classList.toggle('is-menubar-mode-3', isHideCategoriesMode);
            } catch { }

            // Category button host (contains + and all categories)
            const categoryHost = menu.querySelector('.plugin-album__character-menu-buttons');

            const allBtns = menu.querySelectorAll('.plugin-album__character-menu-btn');
            allBtns.forEach(btn => {
                const action = String(btn.dataset.action || '').trim();
                const menuName = String(btn.dataset.menu || '').trim();
                const isModeToggle = action === 'toggle-menubar-mode';
                const isCategoryBtn = !!btn.closest('.plugin-album__character-menu-buttons');

                if (isModeToggle) {
                    try {
                        const iconEl = btn.querySelector('.material-symbols-outlined');
                        if (iconEl) {
                            iconEl.textContent = ['counter_1', 'counter_2', 'counter_3', 'counter_4'][Math.max(0, Math.min(3, mode))] || 'counter_1';
                        }
                    } catch { }
                }

                // Mode 3 (UI label: counter_4) a.k.a. user "mode 4": keep layout stable.
                // Do NOT hide category buttons/host (which changes menu height and recenters on wide screens).
                // Instead, make them visually transparent via CSS and disable interactions.
                if (isHideCategoriesMode) {
                    btn.hidden = false;

                    if (isCategoryBtn) {
                        try {
                            // Remove label so width stays compact and predictable.
                            const labelEl = btn.querySelector('.plugin-album__character-menu-btn-label');
                            if (labelEl) labelEl.textContent = '';
                            btn.classList.remove('plugin-album__character-menu-btn--labeled');
                        } catch { }

                        try {
                            btn.disabled = true;
                            btn.setAttribute('aria-hidden', 'true');
                        } catch { }
                        return;
                    }

                    // Non-category buttons (Preset + mode toggle) stay usable.
                    try {
                        btn.disabled = false;
                        btn.removeAttribute('aria-hidden');
                    } catch { }
                } else {
                    btn.hidden = false;

                    // Ensure category buttons are interactive again.
                    if (isCategoryBtn) {
                        try {
                            btn.disabled = false;
                            btn.removeAttribute('aria-hidden');
                        } catch { }
                    }
                }

                // Category buttons: update label based on mode.
                if (menuName && menuName !== 'Preset' && menuName !== 'StatePreset') {
                    const labelEl = btn.querySelector('.plugin-album__character-menu-btn-label');
                    let labelText = '';
                    const stateGroupId = isStateMode ? (this._characterParseStateGroupIdFromMenuName?.(menuName) || '') : '';
                    const isStateGroupBtn = isStateMode && !!stateGroupId;

                    if (mode === 1) {
                        if (isStateGroupBtn) {
                            labelText = this._characterGetStateGroupNameById(stateGroupId) || '';
                        } else {
                            labelText = menuName;
                        }
                    } else if (mode === 2) {
                        if (isStateGroupBtn) {
                            labelText = this._characterGetSelectedStateNameForGroup(stateGroupId) || '';
                        } else {
                            labelText = this._characterGetSelectedGroupNameForCategory(menuName);
                        }
                    }

                    if (labelEl) labelEl.textContent = labelText || '';
                    btn.classList.toggle('plugin-album__character-menu-btn--labeled', !!labelText);

                    // Keep tooltip informative in label modes
                    if (isStateGroupBtn) {
                        const gName = this._characterGetStateGroupNameById(stateGroupId) || '';
                        if (mode === 2 && labelText) {
                            btn.title = gName ? `${gName}: ${labelText}` : labelText;
                        } else {
                            btn.title = gName || btn.title || '';
                        }
                    } else {
                        if (mode === 2 && labelText) {
                            btn.title = `${menuName}: ${labelText}`;
                        } else {
                            btn.title = menuName;
                        }
                    }
                }
            });

            // Never hide the category host; use CSS + disabled buttons to preserve layout.
            try {
                if (categoryHost) categoryHost.hidden = false;
            } catch { }

            // Update submenu offset so it doesn't overlap the main menu on wide screens.
            try {
                const visibleWidths = Array.from(menu.querySelectorAll('.plugin-album__character-menu-btn'))
                    .filter(el => {
                        try {
                            if (el.hidden) return false;
                            // Exclude buttons hidden by an ancestor (e.g., host[hidden])
                            return (el.getClientRects?.().length || 0) > 0;
                        } catch {
                            return false;
                        }
                    })
                    .map(el => {
                        try { return el.getBoundingClientRect().width || 0; } catch { return 0; }
                    });
                const maxWidth = Math.max(44, ...visibleWidths);
                menu.style.setProperty('--album-char-menu-offset', `${Math.ceil(maxWidth)}px`);
            } catch { }
        },

        _characterToggleSubmenu(menuName) {
            if (this.state.character.activeMenu === menuName) {
                this._characterCloseSubmenu();
                return;
            }
            this.state.character.activeMenu = menuName;
            this._characterOpenSubmenu(menuName);
        },

        _characterOpenSubmenu(menuName) {
            const submenu = this.contentArea.querySelector('.plugin-album__character-submenu');
            const toolbarHost = submenu?.querySelector('.plugin-album__character-submenu-toolbar');
            const list = submenu?.querySelector('.plugin-album__character-submenu-list');
            if (!submenu || !toolbarHost || !list) return;
            toolbarHost.innerHTML = '';
            list.innerHTML = '';

            // Mark current menu for styling (e.g., Preset border rules)
            try { submenu.dataset.menu = String(menuName || '').trim(); } catch { }

            submenu.hidden = false;

            if (menuName === 'Preset') {
                this._characterRenderPresetList(toolbarHost, list);
            } else if (menuName === 'StatePreset') {
                this._characterRenderStatePresetList(toolbarHost, list);
            } else {
                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(menuName) || '';
                if (stateGroupId) {
                    try {
                        this._characterEnsureStateModeState?.();
                        this.state.character.state.activeGroupId = stateGroupId;
                    } catch { }
                    this._characterRenderStateList(stateGroupId, toolbarHost, list);
                } else {
                    this._characterRenderTagGroupList(menuName, toolbarHost, list);
                }

                // Recompute empty-state immediately after rendering.
                // Must run after submenu is visible, because the refresh function
                // intentionally bails out while submenu.hidden === true.
                try { this._characterRefreshOpenSubmenuEmptyStates(); } catch { }
            }

            this._characterSetActiveMenuButton(menuName);
            document.addEventListener('mousedown', this._handleCharacterGlobalPointerDown);
            document.addEventListener('touchstart', this._handleCharacterGlobalPointerDown, { passive: true });
        },

        _characterRefreshSubmenu(menuName) {
            try {
                if (this.state.viewMode !== 'character') return;
                const target = String(menuName || '').trim();
                if (!target || target === 'Preset' || target === 'StatePreset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                const toolbarHost = submenu?.querySelector('.plugin-album__character-submenu-toolbar');
                const list = submenu?.querySelector('.plugin-album__character-submenu-list');
                if (!submenu || !toolbarHost || !list) return;
                if (submenu.hidden) return;
                if (String(this.state.character?.activeMenu || '').trim() !== target) return;

                toolbarHost.innerHTML = '';
                list.innerHTML = '';
                try { submenu.dataset.menu = target; } catch { }
                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(target) || '';
                if (stateGroupId) {
                    this._characterRenderStateList(stateGroupId, toolbarHost, list);
                } else {
                    this._characterRenderTagGroupList(target, toolbarHost, list);
                }
                try { this._characterRefreshOpenSubmenuEmptyStates(); } catch { }
            } catch (err) {
                console.warn('[Album] _characterRefreshSubmenu error:', err);
            }
        },

        _characterCloseSubmenu() {
            const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
            if (submenu) submenu.hidden = true;
            this.state.character.activeMenu = null;
            this._characterSetActiveMenuButton(null);
            try {
                document.removeEventListener('mousedown', this._handleCharacterGlobalPointerDown);
                document.removeEventListener('touchstart', this._handleCharacterGlobalPointerDown);
            } catch { }
        },

        _characterSetActiveMenuButton(menuName) {
            const menu = this.contentArea?.querySelector('.plugin-album__character-menu');
            if (!menu) return;
            menu.querySelectorAll('.plugin-album__character-menu-btn').forEach(btn => {
                const m = String(btn.dataset.menu || '').trim();
                btn.classList.toggle('is-active', Boolean(menuName) && m === menuName);
            });
        },

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

                // Touch hold
                row.addEventListener('touchstart', () => startLongPress(), { passive: true });
                row.addEventListener('touchend', clearLongPress);
                row.addEventListener('touchcancel', clearLongPress);
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

                    // Touch hold
                    row.addEventListener('touchstart', () => start(), { passive: true });
                    row.addEventListener('touchend', clear);
                    row.addEventListener('touchcancel', clear);

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
