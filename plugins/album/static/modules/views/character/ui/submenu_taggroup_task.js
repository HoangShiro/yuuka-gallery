// Album plugin - Character view UI: tag-group submenu task/progress UI
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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
    });
})();
