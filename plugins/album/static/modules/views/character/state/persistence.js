// Album plugin - View module: character view (Persistence helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterLoadSelections(charHash, categories) {
            const key = (this._LS_CHAR_SELECTION_KEY_PREFIX || 'yuuka.album.character.selection.') + charHash;
            try {
                const raw = localStorage.getItem(key);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    const out = {};
                    categories.forEach(c => {
                        out[c] = parsed[c] || null;
                    });
                    return out;
                }
            } catch { }
            const out = {};
            categories.forEach(c => { out[c] = null; });
            return out;
        },

        _characterLoadStateSelections(charHash, stateGroups) {
            const h = String(charHash || '').trim();
            if (!h) return {};
            const key = (this._LS_CHAR_STATE_SELECTION_KEY_PREFIX || 'yuuka.album.character.state_selection.') + h;
            const out = {};
            try {
                const raw = localStorage.getItem(key);
                const parsed = raw ? JSON.parse(raw) : null;
                (Array.isArray(stateGroups) ? stateGroups : []).forEach(g => {
                    const gid = String(g?.id || '').trim();
                    if (!gid) return;
                    out[gid] = (parsed && typeof parsed === 'object') ? (parsed[gid] || null) : null;
                });
            } catch {
                (Array.isArray(stateGroups) ? stateGroups : []).forEach(g => {
                    const gid = String(g?.id || '').trim();
                    if (!gid) return;
                    out[gid] = null;
                });
            }
            return out;
        },

        _characterSaveStateSelections() {
            const charHash = this.state.selectedCharacter?.hash;
            const h = String(charHash || '').trim();
            if (!h) return;
            const key = (this._LS_CHAR_STATE_SELECTION_KEY_PREFIX || 'yuuka.album.character.state_selection.') + h;
            try {
                this._characterEnsureStateModeState?.();
                localStorage.setItem(key, JSON.stringify(this.state.character.state.selections || {}));
            } catch { }
        },

        _characterLoadStateGroupActivePresetIds(charHash, stateGroups) {
            const h = String(charHash || '').trim();
            if (!h) return {};
            const key = (this._LS_CHAR_STATE_GROUP_ACTIVE_PRESET_KEY_PREFIX || 'yuuka.album.character.state_group.active_preset.') + h;
            const out = {};
            try {
                const raw = localStorage.getItem(key);
                const parsed = raw ? JSON.parse(raw) : null;
                (Array.isArray(stateGroups) ? stateGroups : []).forEach(g => {
                    const gid = String(g?.id || '').trim();
                    if (!gid) return;
                    out[gid] = (parsed && typeof parsed === 'object') ? (parsed[gid] || null) : null;
                });
            } catch {
                (Array.isArray(stateGroups) ? stateGroups : []).forEach(g => {
                    const gid = String(g?.id || '').trim();
                    if (!gid) return;
                    out[gid] = null;
                });
            }
            return out;
        },

        _characterSaveStateGroupActivePresetIds() {
            const charHash = this.state.selectedCharacter?.hash;
            const h = String(charHash || '').trim();
            if (!h) return;
            const key = (this._LS_CHAR_STATE_GROUP_ACTIVE_PRESET_KEY_PREFIX || 'yuuka.album.character.state_group.active_preset.') + h;
            try {
                this._characterEnsureStateModeState?.();
                localStorage.setItem(key, JSON.stringify(this.state.character.state.activePresetByGroup || {}));
            } catch { }
        },

        _characterVNGetBgSelectionStorageKey(charHash) {
            const h = String(charHash || '').trim();
            if (!h) return '';
            return (this._LS_CHAR_VN_BG_SELECTION_KEY_PREFIX || 'yuuka.album.character.vn.bg_selection.') + h;
        },

        _characterVNLoadSavedBgSelection(charHash) {
            const key = this._characterVNGetBgSelectionStorageKey(charHash);
            if (!key) return { hasValue: false, groupId: null };
            try {
                const raw = localStorage.getItem(key);
                if (raw === null || typeof raw === 'undefined') return { hasValue: false, groupId: null };
                const v = String(raw || '').trim();
                if (!v || v === '__none__') return { hasValue: true, groupId: null };
                return { hasValue: true, groupId: v };
            } catch {
                return { hasValue: false, groupId: null };
            }
        },

        _characterVNSaveBgSelection() {
            const charHash = this.state.selectedCharacter?.hash;
            if (!charHash) return;
            const key = this._characterVNGetBgSelectionStorageKey(charHash);
            if (!key) return;
            try {
                this._characterEnsureVNState?.();
                const vn = this.state.character?.vn || {};
                const hasOverride = !!vn.activeBgGroupIdOverride;
                const gid = String(vn.activeBgGroupId ?? '').trim();

                // Only persist after user explicitly interacted (override mode).
                if (!hasOverride) {
                    localStorage.removeItem(key);
                    return;
                }

                if (gid) localStorage.setItem(key, gid);
                else localStorage.setItem(key, '__none__');
            } catch { }
        },

        _characterVNRestoreSavedBgSelection(charHash) {
            try {
                if (!this._characterIsVisualNovelModeEnabled?.()) return false;
                const h = String(charHash || '').trim();
                if (!h) return false;

                const saved = this._characterVNLoadSavedBgSelection(h);
                if (!saved?.hasValue) return false;

                this._characterEnsureVNState?.();
                const vn = this.state.character.vn;
                const flat = this.state.character?.tagGroups?.flat || {};
                const gid = String(saved.groupId || '').trim();

                if (gid && Object.prototype.hasOwnProperty.call(flat, gid)) {
                    vn.activeBgGroupId = gid;
                    vn.activeBgGroupIdOverride = true;
                    return true;
                }

                // Fallback to None only when saved item does not exist (or saved None).
                vn.activeBgGroupId = null;
                vn.activeBgGroupIdOverride = true;
                if (gid) {
                    // Prune stale saved id.
                    try {
                        const key = this._characterVNGetBgSelectionStorageKey(h);
                        if (key) localStorage.setItem(key, '__none__');
                    } catch { }
                }
                return true;
            } catch {
                return false;
            }
        },

        _characterSaveSelections() {
            const charHash = this.state.selectedCharacter?.hash;
            if (!charHash) return;
            const key = (this._LS_CHAR_SELECTION_KEY_PREFIX || 'yuuka.album.character.selection.') + charHash;
            try {
                localStorage.setItem(key, JSON.stringify(this.state.character.selections));
            } catch { }
        },

        _characterLoadActivePresetId(charHash) {
            const key = (this._LS_CHAR_ACTIVE_PRESET_KEY_PREFIX || 'yuuka.album.character.active_preset.') + charHash;
            try {
                return localStorage.getItem(key) || null;
            } catch { }
            return null;
        },

        _characterSaveActivePresetId() {
            const charHash = this.state.selectedCharacter?.hash;
            if (!charHash) return;
            const key = (this._LS_CHAR_ACTIVE_PRESET_KEY_PREFIX || 'yuuka.album.character.active_preset.') + charHash;
            try {
                const val = this.state.character.activePresetId;
                if (val) localStorage.setItem(key, val);
                else localStorage.removeItem(key);
            } catch { }
        },
    });
})();
