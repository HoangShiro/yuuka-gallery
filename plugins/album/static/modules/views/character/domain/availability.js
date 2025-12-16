// Album plugin - Character view domain: submenu availability / empty-state helpers
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterComputeSubmenuEmptyStateContext(activeMenuName) {
            try {
                if (this.state?.viewMode !== 'character') return null;

                const activeMenu = String(activeMenuName || '').trim();
                if (!activeMenu || activeMenu === 'Preset' || activeMenu === 'StatePreset') return null;

                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(activeMenu) || '';
                const isStateGroupMenu = !!stateGroupId;

                if (isStateGroupMenu) {
                    // Ensure state-mode state is present before computing availability.
                    this._characterEnsureStateModeState?.();
                    return {
                        type: 'state',
                        activeMenu,
                        stateGroupId,
                    };
                }

                const category = activeMenu;

                const isVnBgCategory = !!(
                    typeof this._characterIsVisualNovelModeEnabled === 'function'
                    && this._characterIsVisualNovelModeEnabled()
                    && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                    && this._characterIsVisualNovelBackgroundCategory(category)
                );

                if (isVnBgCategory) {
                    this._characterEnsureVNState?.();
                    const vn = this.state?.character?.vn;
                    const keySet = vn?.bgAvailableContextKeys;
                    const hasKeySet = !!(keySet && typeof keySet.has === 'function');

                    return {
                        type: 'vn-bg',
                        activeMenu,
                        category,
                        hasKeySet,
                        // If we don't have keys yet, UI can kick off a background-album load.
                        needsLoad: !hasKeySet,
                    };
                }

                return {
                    type: 'category',
                    activeMenu,
                    category,
                };
            } catch (err) {
                console.warn('[Album] _characterComputeSubmenuEmptyStateContext error:', err);
                return null;
            }
        },

        _characterComputeSubmenuRowIsEmpty(context, rowId) {
            try {
                if (this.state?.viewMode !== 'character') return null;
                if (!context || typeof context !== 'object') return null;

                const id = String(rowId || '').trim();
                if (!id) return null;

                // State-group menu: `id` is a state id, not a tag group id.
                if (context.type === 'state') {
                    const stateGroupId = String(context.stateGroupId || '').trim();
                    if (!stateGroupId) return null;

                    const states = Array.isArray(this.state?.character?.state?.states)
                        ? this.state.character.state.states
                        : [];
                    const byId = new Map(states.map(s => [String(s?.id || '').trim(), s]));

                    const baseStateSel = (this.state?.character?.state?.selections && typeof this.state.character.state.selections === 'object')
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

                    const nextSel = { ...baseStateSel, [stateGroupId]: id };
                    const groupIds = computeGroupIdsFromSelection(nextSel);
                    const key = this._characterBuildPresetKeyFromGroupIds?.(groupIds) || '';
                    const presetId = key ? `auto:${key}` : null;
                    if (!presetId) return false;

                    const images = this._characterGetImagesForPreset?.(presetId);
                    return !(Array.isArray(images) ? images.length > 0 : false);
                }

                // Visual Novel BG category: availability is based on bg-album scan results.
                if (context.type === 'vn-bg') {
                    const vn = this.state?.character?.vn;
                    const keySet = vn?.bgAvailableContextKeys;
                    const hasKeySet = !!(keySet && typeof keySet.has === 'function');

                    // If we don't have BG keys yet, be pessimistic.
                    if (!hasKeySet) return true;

                    const flat = this.state?.character?.tagGroups?.flat || {};
                    const g = flat?.[id];
                    const tags = (g && Array.isArray(g.tags)) ? g.tags : [];
                    const groupKey = (typeof this._characterVNNormalizeContextKey === 'function')
                        ? this._characterVNNormalizeContextKey(tags)
                        : '';

                    if (!groupKey) return true;
                    return !keySet.has(groupKey);
                }

                // Normal category menu: `id` is a tag group id.
                if (context.type === 'category') {
                    const category = String(context.category || '').trim();
                    if (!category) return null;

                    const baseSel = (this.state?.character?.selections && typeof this.state.character.selections === 'object')
                        ? this.state.character.selections
                        : {};

                    const nextSel = { ...baseSel };
                    nextSel[category] = id;

                    const key = this._characterBuildPresetKeyFromSelections?.(nextSel) || '';
                    const presetId = key ? `auto:${key}` : null;
                    if (!presetId) return false;

                    const images = this._characterGetImagesForPreset?.(presetId);
                    return !(Array.isArray(images) ? images.length > 0 : false);
                }

                return null;
            } catch (err) {
                console.warn('[Album] _characterComputeSubmenuRowIsEmpty error:', err);
                return null;
            }
        },
    });
})();
