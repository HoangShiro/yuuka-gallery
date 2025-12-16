// Album plugin - View module: character view (Preset key helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterBuildPresetKeyFromSelections(selections) {
            if (!selections || typeof selections !== 'object') return '';

            // Visual Novel mode: background-category selection should NOT affect character-layer presets.
            let filtered = selections;
            try {
                if (this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName();
                    if (bg) {
                        filtered = { ...selections };
                        // Remove exact key
                        if (Object.prototype.hasOwnProperty.call(filtered, bg)) filtered[bg] = null;
                        // Also remove case-insensitive match (in case category was renamed/cased differently)
                        const bgLower = String(bg).trim().toLowerCase();
                        Object.keys(filtered).forEach(k => {
                            if (String(k).trim().toLowerCase() === bgLower) filtered[k] = null;
                        });
                    }
                }
            } catch { }

            const ids = Object.values(filtered)
                .map(v => String(v || '').trim())
                .filter(v => v && v !== '__none__')
                .sort();
            if (!ids.length) return '';
            const encoded = ids.map(id => encodeURIComponent(id));
            return `g:${encoded.join('|')}`;
        },

        _characterVNFilterOutBgIds(ids) {
            try {
                const arr = Array.isArray(ids) ? ids : [];
                if (!(typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled())) {
                    return arr;
                }
                const bgCat = this._characterGetVisualNovelBackgroundCategoryName?.();
                if (!bgCat) return arr;
                const grouped = this.state?.character?.tagGroups?.grouped || {};
                const bgGroups = Array.isArray(grouped?.[bgCat]) ? grouped[bgCat] : [];
                if (!bgGroups.length) return arr;
                const bgIds = new Set(bgGroups.map(g => String(g?.id || '').trim()).filter(Boolean));
                if (!bgIds.size) return arr;
                return arr.filter(v => {
                    const s = String(v || '').trim();
                    if (!s) return false;
                    return !bgIds.has(s);
                });
            } catch {
                return Array.isArray(ids) ? ids : [];
            }
        },

        _characterBuildPresetKeyFromGroupIds(groupIds) {
            try {
                const ids = (Array.isArray(groupIds) ? groupIds : [])
                    .map(v => String(v || '').trim())
                    .filter(Boolean);
                const filtered = this._characterVNFilterOutBgIds(ids);
                const unique = Array.from(new Set(filtered)).sort((a, b) => String(a).localeCompare(String(b)));
                if (!unique.length) return '';
                const encoded = unique.map(id => encodeURIComponent(id));
                return `g:${encoded.join('|')}`;
            } catch {
                return '';
            }
        },

        _characterGetEffectiveGroupIdsFromStateSelections() {
            try {
                this._characterEnsureStateModeState?.();
                const sel = this.state.character.state.selections || {};
                const states = Array.isArray(this.state.character.state.states) ? this.state.character.state.states : [];
                const byId = new Map(states.map(s => [String(s?.id || '').trim(), s]));
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
            } catch {
                return [];
            }
        },

        _characterFilterSelectionsForCharacterLayer(selections) {
            const base = (selections && typeof selections === 'object') ? selections : {};
            if (!this._characterIsVisualNovelModeEnabled()) return base;
            const bg = this._characterGetVisualNovelBackgroundCategoryName();
            if (!bg) return base;
            const out = { ...base };
            const bgLower = String(bg).trim().toLowerCase();
            Object.keys(out).forEach(k => {
                if (String(k).trim().toLowerCase() === bgLower) out[k] = null;
            });
            return out;
        },

        _characterResolveActivePresetId() {
            // State mode: presets are derived from the union of tag groups referenced by selected States.
            try {
                if (this._characterIsStateModeEnabled?.()) {
                    const ids = this._characterGetEffectiveGroupIdsFromStateSelections?.() || [];
                    const key = this._characterBuildPresetKeyFromGroupIds?.(ids) || '';
                    return key ? `auto:${key}` : null;
                }
            } catch { }

            const explicit = this.state.character.activePresetId;
            if (explicit) return explicit;
            const selections = this.state.character.selections || {};
            const key = this._characterBuildPresetKeyFromSelections(selections);
            return key ? `auto:${key}` : null;
        },
    });
})();
