// Album plugin - View module: character view (Utils & Helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterApplyVNBlurUI() {
            try {
                if (this.state?.viewMode !== 'character') return;
                const root = this.contentArea?.querySelector('.plugin-album__character-view');
                if (!root) return;

                const vnMode = (typeof this._characterIsVisualNovelModeEnabled === 'function')
                    ? !!this._characterIsVisualNovelModeEnabled()
                    : true;
                const blur = !!(vnMode && this.state?.character?.settings && this.state.character.settings.blur_background);
                root.classList.toggle('plugin-album__character-view--vn-blur-bg', blur);
            } catch { }
        },

        _characterIsVisualNovelModeEnabled() {
            try {
                const v = this.state?.character?.settings?.visual_novel_mode;
                // Default ON if missing
                return (typeof v === 'undefined') ? true : !!v;
            } catch {
                return true;
            }
        },

        _characterEnsureVNState() {
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character.vn || typeof this.state.character.vn !== 'object') {
                    this.state.character.vn = {
                        backgrounds: {},
                        loadedAt: 0,
                        bgCategoryName: null,
                        activeBgGroupId: null,
                        activeBgGroupIdOverride: false,
                        bgAlbumHash: null,
                        bgAlbumLoadedAt: 0,
                        bgAlbumImagesLoadedAt: 0,
                        bgAvailableContextKeys: null,
                        bgAvailableKeysLoadedAt: 0,
                        _bgAlbumLoadPromise: null,
                    };
                }
                if (!this.state.character.vn.backgrounds || typeof this.state.character.vn.backgrounds !== 'object') {
                    this.state.character.vn.backgrounds = {};
                }
                if (typeof this.state.character.vn.activeBgGroupIdOverride === 'undefined') {
                    this.state.character.vn.activeBgGroupIdOverride = false;
                }
            } catch { }
        },

        _characterEnsureStateModeState() {
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character.state || typeof this.state.character.state !== 'object') {
                    this.state.character.state = {
                        groups: [],
                        states: [],
                        selections: {},
                        presetsByGroup: {},
                        activePresetByGroup: {},
                        activeGroupId: null,
                    };
                }
                const st = this.state.character.state;
                if (!Array.isArray(st.groups)) st.groups = [];
                if (!Array.isArray(st.states)) st.states = [];
                if (!st.selections || typeof st.selections !== 'object') st.selections = {};
                if (!st.presetsByGroup || typeof st.presetsByGroup !== 'object') st.presetsByGroup = {};
                if (!st.activePresetByGroup || typeof st.activePresetByGroup !== 'object') st.activePresetByGroup = {};
                if (typeof st.activeGroupId === 'undefined') st.activeGroupId = null;
            } catch { }
        },

        _characterIsStateModeEnabled() {
            try {
                const v = String(this.state.character?.ui?.menuMode || 'category').trim().toLowerCase();
                return v === 'state';
            } catch {
                return false;
            }
        },

        _characterVNNormalizeContextKey(value) {
            // Normalize a context string/list into a stable key for exact-match comparisons.
            // We treat tokens as comma-separated tags; order and whitespace differences are ignored.
            try {
                let text = '';
                if (Array.isArray(value)) {
                    text = value.map(v => String(v || '').trim()).filter(Boolean).join(', ');
                } else {
                    text = String(value || '');
                }
                const tokens = String(text)
                    .split(',')
                    .map(t => String(t || '').trim().toLowerCase())
                    .filter(Boolean);
                if (!tokens.length) return '';
                tokens.sort();
                return tokens.join(',');
            } catch {
                return '';
            }
        },

        async _characterVNEnsureBackgroundAlbumLoaded({ force = false } = {}) {
            if (typeof this._characterIsVisualNovelModeEnabled === 'function' && !this._characterIsVisualNovelModeEnabled()) return false;
            this._characterEnsureVNState();

            const vn = this.state.character.vn;
            const now = Date.now();
            const ttl = 30_000;

            // If a load is already in-flight, reuse it.
            if (vn._bgAlbumLoadPromise && typeof vn._bgAlbumLoadPromise.then === 'function') {
                return vn._bgAlbumLoadPromise;
            }

            // If we already have computed keys recently, don't refetch/scan.
            if (!force) {
                const lastKeysAt = Number(vn.bgAvailableKeysLoadedAt || 0);
                const hasKeys = !!(vn.bgAvailableContextKeys && typeof vn.bgAvailableContextKeys.has === 'function');
                if (hasKeys && lastKeysAt && Number.isFinite(lastKeysAt) && (now - lastKeysAt) < ttl) {
                    return true;
                }
            }

            vn._bgAlbumLoadPromise = (async () => {
                // 1) Ensure album exists / get hash
                let bgHash = null;
                try {
                    const resp = await this.api.album.get('/character/vn/background_album');
                    bgHash = String(resp?.hash || resp?.character_hash || '').trim() || null;
                } catch {
                    bgHash = null;
                }

                vn.bgAlbumHash = bgHash;
                vn.bgAlbumLoadedAt = now;

                if (!bgHash) {
                    vn.bgAlbumImagesLoadedAt = now;
                    vn.bgAvailableContextKeys = new Set();
                    vn.bgAvailableKeysLoadedAt = now;
                    return false;
                }

                // 2) Load images from Background album (do NOT store the list; only derive keys)
                let imgs = [];
                try {
                    const respImgs = await this.api.images.getByCharacter(bgHash);
                    imgs = Array.isArray(respImgs) ? respImgs : [];
                } catch {
                    imgs = [];
                }
                vn.bgAlbumImagesLoadedAt = now;

                // Precompute availability keys for fast UI checks
                const keys = new Set();
                try {
                    imgs.forEach(img => {
                        const cfg = img?.generationConfig || {};
                        // Prefer VN BG layer images, but allow legacy BG images without explicit flags.
                        const layer = String(cfg?.album_vn_layer || '').trim().toLowerCase();
                        if (layer && layer !== 'bg') return;
                        const ctx = (cfg && typeof cfg === 'object') ? (cfg.context ?? cfg.Context) : null;
                        const k = this._characterVNNormalizeContextKey(ctx);
                        if (k) keys.add(k);
                    });
                } catch { }

                vn.bgAvailableContextKeys = keys;
                vn.bgAvailableKeysLoadedAt = now;
                return true;
            })().finally(() => {
                try { vn._bgAlbumLoadPromise = null; } catch { }
            });

            return vn._bgAlbumLoadPromise;
        },

        _characterGetVisualNovelBackgroundCategoryName() {
            try {
                this._characterEnsureVNState();
                const cached = this.state.character.vn.bgCategoryName;
                if (cached) return cached;

                // Prefer an explicit BG-marked category if present.
                try {
                    const normalized = this._characterNormalizeCategories(this.state.character.categories);
                    const marked = (normalized || []).find(c => c && (c.is_bg === true || c.isBg === true));
                    if (marked && marked.name) {
                        this.state.character.vn.bgCategoryName = String(marked.name);
                        return this.state.character.vn.bgCategoryName;
                    }
                } catch { }

                const cats = this._characterGetCategoryNames();
                if (!cats.length) return null;

                const findBy = (needle) => {
                    const n = String(needle || '').trim().toLowerCase();
                    if (!n) return null;
                    return cats.find(c => String(c || '').trim().toLowerCase().includes(n)) || null;
                };

                // Prefer explicit 'background', fallback to 'context'
                const picked = findBy('background') || findBy('bg') || findBy('context');
                this.state.character.vn.bgCategoryName = picked;
                return picked;
            } catch {
                return null;
            }
        },

        _characterIsVisualNovelBackgroundCategory(categoryName) {
            try {
                const bg = this._characterGetVisualNovelBackgroundCategoryName();
                if (!bg) return false;
                return String(bg).trim().toLowerCase() === String(categoryName || '').trim().toLowerCase();
            } catch {
                return false;
            }
        },

        _characterIsVisualNovelBackgroundStateGroup(stateGroupIdOrName) {
            try {
                const gidOrName = String(stateGroupIdOrName || '').trim();
                if (!gidOrName) return false;
                this._characterEnsureStateModeState?.();
                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                const hit = groups.find(g => {
                    const gid = String(g?.id || '').trim();
                    const name = String(g?.name || '').trim();
                    return gid === gidOrName || name.toLowerCase() === gidOrName.toLowerCase();
                });

                const name = String(hit?.name || gidOrName).trim();
                const flagged = !!(hit && (hit.is_bg === true || hit.isBg === true || hit.bg === true));
                if (flagged) return true;

                // Heuristics: match VN BG category name, or common BG tokens.
                const bgCat = this._characterGetVisualNovelBackgroundCategoryName?.();
                if (bgCat && String(bgCat).trim() && String(bgCat).trim().toLowerCase() === name.toLowerCase()) return true;

                const lower = name.toLowerCase();
                if (lower === 'bg') return true;
                if (lower.includes('background')) return true;
                if (lower.startsWith('bg ')) return true;
                if (lower.startsWith('bg:')) return true;
                return false;
            } catch {
                return false;
            }
        },

        _characterVNResolveBgGroupIdFromStateId(stateId) {
            try {
                const sid = String(stateId || '').trim();
                if (!sid || sid === '__none__') return '';
                this._characterEnsureStateModeState?.();
                const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const st = states.find(s => String(s?.id || '').trim() === sid);
                const tgids = Array.isArray(st?.tag_group_ids) ? st.tag_group_ids : (Array.isArray(st?.tagGroupIds) ? st.tagGroupIds : []);
                const gid = tgids.map(x => String(x || '').trim()).filter(Boolean)[0] || '';
                return gid;
            } catch {
                return '';
            }
        },

        _characterDefaultCategories() {
            return [
                { name: 'Outfits', icon: 'checkroom', color: '#FFFFFF' },
                { name: 'Expression', icon: 'face', color: '#FFFFFF' },
                { name: 'Action', icon: 'directions_run', color: '#FFFFFF' },
                { name: 'Context', icon: 'landscape', color: '#FFFFFF' },
            ];
        },

        _characterNormalizeCategories(cats) {
            if (!Array.isArray(cats)) return [];
            return cats.map(c => {
                if (!c || typeof c !== 'object') return null;
                const name = String(c.name || '').trim();
                if (!name) return null;
                // Optional: mark category as VN background category.
                const isBg = !!(c.is_bg ?? c.isBg ?? c.bg);
                return {
                    name,
                    icon: String(c.icon || 'label').trim(),
                    color: String(c.color || '').trim().toUpperCase(),
                    is_bg: isBg,
                };
            }).filter(Boolean);
        },

        _characterGetCategoryNames() {
            const cats = this.state.character.categories || [];
            return cats.map(c => String(c?.name || '').trim()).filter(Boolean);
        },

        _characterIsDefaultCategoryName(name) {
            const defs = this._characterDefaultCategories().map(c => c.name.toLowerCase());
            return defs.includes(String(name || '').trim().toLowerCase());
        },

        _characterIsValidHexColor(hex) {
            return /^#[0-9A-F]{6}$/i.test(String(hex || '').trim());
        },

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

        async _characterSelectState(stateGroupId, stateId) {
            try {
                this._characterEnsureStateModeState?.();
                const gid = String(stateGroupId || '').trim();
                if (!gid) return;

                const sid = String(stateId || '').trim();
                this.state.character.state.selections[gid] = sid || null;
                this._characterSaveStateSelections?.();

                // VN mode: if this state group represents BG, treat selection as background choice.
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                        && this._characterIsVisualNovelBackgroundStateGroup(gid)) {
                        this._characterEnsureVNState?.();
                        const vn = this.state.character.vn;

                        const bgGroupId = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                        vn.activeBgGroupId = bgGroupId || null;
                        vn.activeBgGroupIdOverride = true;
                        try { this._characterVNSaveBgSelection?.(); } catch { }

                        try { this._characterApplyMenuBarModeUI?.(); } catch { }
                        try { await this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false }); } catch { }
                        try { this._characterRefreshDisplayedImage?.(); } catch { }
                        return;
                    }
                } catch { }

                // Manual selection should clear any preset override for this group
                try {
                    if (this.state.character.state.activePresetByGroup) {
                        this.state.character.state.activePresetByGroup[gid] = null;
                        this._characterSaveStateGroupActivePresetIds?.();
                    }
                } catch { }

                try { this._characterApplyMenuBarModeUI?.(); } catch { }

                const presetId = this._characterResolveActivePresetId();
                const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
                if (presetId && !imgs.length) {
                    await this._characterStartGeneration({ forceNew: true, auto: false, presetId: null });
                } else {
                    this._characterRefreshDisplayedImage?.();
                }
            } catch { }
        },

        _characterGetImagesForPreset(presetId) {
            const images = Array.isArray(this.state.allImageData) ? this.state.allImageData : [];
            const pid = String(presetId || '').trim();
            const isAuto = pid.startsWith('auto:');

            const _vnFilterOutBgIds = (ids) => {
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
            };

            const canonicalizeKeyToGroupKey = (rawKey) => {
                const raw = String(rawKey || '').trim();
                if (!raw) return '';
                if (raw.startsWith('g:')) return raw;

                // Legacy canonical: "<category>=<groupId>|..."
                if (raw.includes('=')) {
                    const ids = [];
                    const parts = raw.split('|').map(s => String(s || '').trim()).filter(Boolean);
                    for (const part of parts) {
                        const idx = part.indexOf('=');
                        if (idx <= 0) continue;
                        const vEnc = part.slice(idx + 1);
                        let v = '';
                        try { v = decodeURIComponent(String(vEnc || '').trim()); } catch { v = String(vEnc || '').trim(); }
                        v = String(v || '').trim();
                        if (v) ids.push(v);
                    }
                    const filteredIds = _vnFilterOutBgIds(ids);
                    const sel = {};
                    filteredIds.forEach((v, i) => { sel[`_${i}`] = v; });
                    return this._characterBuildPresetKeyFromSelections(sel);
                }

                // Positional list: treat as IDs (best-effort)
                const ids = raw.split('|').map(s => {
                    let v = '';
                    try { v = decodeURIComponent(String(s || '').trim()); } catch { v = String(s || '').trim(); }
                    return String(v || '').trim();
                }).filter(Boolean);

                const filteredIds = _vnFilterOutBgIds(ids);
                const sel = {};
                filteredIds.forEach((v, i) => { sel[`_${i}`] = v; });
                return this._characterBuildPresetKeyFromSelections(sel);
            };

            // Desired group-key for matching images by selection, even when presetId is a saved preset.
            let wantedGroupKey = '';
            if (isAuto) {
                const wantedKeyRaw = pid.slice('auto:'.length);
                wantedGroupKey = canonicalizeKeyToGroupKey(wantedKeyRaw);
            } else {
                // Saved preset: match by its selection so existing auto images are reused.
                try {
                    const preset = (this.state.character.presets || []).find(p => p?.id === pid);
                    const sel = this._characterFilterSelectionsForCharacterLayer(preset?.selection);
                    if (sel && typeof sel === 'object') {
                        wantedGroupKey = this._characterBuildPresetKeyFromSelections(sel);
                    }
                } catch {}
            }

            return images.filter(img => {
                const cfg = img?.generationConfig || {};
                const ref = cfg?.album_character_preset_id;
                if (ref && String(ref) === pid) return true;

                // For auto presets AND saved presets, match by canonical group-id key so renames/reorders
                // don't hide images and saved presets can reuse existing images.
                if (wantedGroupKey) {
                    let imgGroupKey = '';

                    // Prefer explicit group id list (new format)
                    try {
                        const gids = cfg?.album_character_group_ids;
                        if (Array.isArray(gids) && gids.length) {
                            const filteredIds = _vnFilterOutBgIds(gids);
                            const sel = {};
                            filteredIds.forEach((v, i) => { sel[`_${i}`] = v; });
                            imgGroupKey = this._characterBuildPresetKeyFromSelections(sel);
                        }
                    } catch {}

                    // Fallback: derive from saved category selections
                    if (!imgGroupKey) {
                        try {
                            const sel = this._characterFilterSelectionsForCharacterLayer(cfg?.album_character_category_selections);
                            if (sel && typeof sel === 'object') {
                                imgGroupKey = this._characterBuildPresetKeyFromSelections(sel);
                            }
                        } catch {}
                    }

                    // Fallback: canonicalize stored preset key
                    if (!imgGroupKey) {
                        imgGroupKey = canonicalizeKeyToGroupKey(String(cfg?.album_character_preset_key || '').trim());
                    }

                    return imgGroupKey && String(imgGroupKey) === String(wantedGroupKey);
                }

                return false;
            }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        },

        async _characterSelectAutoPresetKey(key) {
            const selMap = this._characterParsePresetKeyToSelectionMap(key);
            this.state.character.activePresetId = `auto:${key}`;
            this._characterSaveActivePresetId();
            const cats = this._characterGetCategoryNames();
            const nextSel = {};
            cats.forEach((c) => {
                const k = String(c || '').trim().toLowerCase();
                nextSel[c] = (k && selMap && Object.prototype.hasOwnProperty.call(selMap, k)) ? (selMap[k] || null) : null;
            });

            // VN mode: auto preset keys intentionally exclude BG category; do not clear BG selection.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bg) {
                        const bgLower = String(bg).trim().toLowerCase();
                        const currentSel = this.state.character?.selections || {};
                        Object.keys(currentSel).forEach(k => {
                            if (String(k).trim().toLowerCase() === bgLower) {
                                nextSel[k] = currentSel[k];
                            }
                        });
                    }
                }
            } catch { }
            this.state.character.selections = nextSel;
            this._characterSaveSelections();
            try { this._characterApplyMenuBarModeUI(); } catch {}

            const presetId = this._characterResolveActivePresetId();
            const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
            if (!imgs.length) {
                // User switched to a preset that needs images => cancel auto and run a manual task
                await this._characterStartGeneration({ forceNew: true, auto: false });
            } else {
                this._characterRefreshDisplayedImage();
            }
        },

        async _characterSelectTagGroup(category, groupId) {
            if (!this.state.character.selections) return;
            this.state.character.selections[category] = groupId;
            this._characterSaveSelections();

            // Visual Novel mode: selecting background-category items only affects Background layer.
            // It must NOT affect character presets / character-layer generation.
            try {
                if (this._characterIsVisualNovelModeEnabled() && this._characterIsVisualNovelBackgroundCategory(category)) {
                    this._characterEnsureVNState();
                    const gid = String(groupId || '').trim();
                    this.state.character.vn.activeBgGroupId = gid || null;
                    this.state.character.vn.activeBgGroupIdOverride = true;
                    try { this._characterVNSaveBgSelection?.(); } catch { }

                    // Update main menu labels/titles AFTER VN override is updated.
                    try { this._characterApplyMenuBarModeUI(); } catch {}

                    // Try to apply background immediately (or generate if missing)
                    try {
                        await this._characterVNEnsureBackgroundCacheLoaded();
                        await this._characterVNApplyBackgroundFromSelection({ generateIfMissing: true });
                    } catch { }
                    return;
                }
            } catch { }

            // Update main menu labels/titles for non-BG categories.
            try { this._characterApplyMenuBarModeUI(); } catch {}

            // If user previously picked a saved preset, switching any tag group should
            // move back to auto mode (derived from the current selections).
            // Otherwise, the active preset would keep overriding the selection changes.
            if (this.state.character.activePresetId) {
                const key = this._characterBuildPresetKeyFromSelections(this.state.character.selections);
                const current = String(this.state.character.activePresetId || '');
                if (current.startsWith('auto:')) {
                    this.state.character.activePresetId = key ? `auto:${key}` : null;
                } else {
                    this.state.character.activePresetId = null;
                }
                this._characterSaveActivePresetId();
            }

            // Auto-suggest updates happen on successful non-auto generations (image:added).

            // Auto-generate if the resolved preset has no images
            const presetId = this._characterResolveActivePresetId();
            if (presetId) {
                const imgs = this._characterGetImagesForPreset(presetId);
                if (!imgs.length) {
                    // User changed selection and needs a new image => cancel auto and run a manual task
                    await this._characterStartGeneration({ forceNew: true, auto: false });
                } else {
                    this._characterRefreshDisplayedImage();
                }
            }
        },

        async _characterSelectPreset(presetId) {
            const preset = (this.state.character.presets || []).find(p => p?.id === presetId);
            if (!preset) return;
            this.state.character.activePresetId = presetId;
            this._characterSaveActivePresetId();
            // Apply selection
            const sel = preset.selection || {};
            const cats = this._characterGetCategoryNames();
            const nextSel = {};
            cats.forEach(c => { nextSel[c] = sel?.[c] || null; });

            // VN mode: do not let presets override BG selection; BG is per-character.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bg) {
                        const bgLower = String(bg).trim().toLowerCase();
                        const currentSel = this.state.character?.selections || {};
                        Object.keys(currentSel).forEach(k => {
                            if (String(k).trim().toLowerCase() === bgLower) {
                                nextSel[k] = currentSel[k];
                            }
                        });
                    }
                }
            } catch { }
            this.state.character.selections = nextSel;
            this._characterSaveSelections();
            try { this._characterApplyMenuBarModeUI(); } catch {}

            const imgs = this._characterGetImagesForPreset(presetId);
            if (!imgs.length) {
                // User switched to a preset that needs images => cancel auto and run a manual task
                await this._characterStartGeneration({ forceNew: true, presetId, auto: false });
            } else {
                this._characterRefreshDisplayedImage();
            }
        },

        _characterGetBestImageUrlForPresetId(presetId) {
            const imgs = this._characterGetImagesForPreset(presetId);
            if (!imgs.length) return null;
            // Prefer latest (index 0 if sorted desc)
            return imgs[0]?.url || imgs[0]?.src || null;
        },

        _characterRefreshDisplayedImage() {
            if (this.state.viewMode !== 'character') return;
            const root = this.contentArea?.querySelector('.plugin-album__character-view');
            if (!root) return;
            
            const charLayer = root.querySelector('.plugin-album__character-layer--char');
            const bgLayer = root.querySelector('.plugin-album__character-layer--bg');
            
            const vnMode = this._characterIsVisualNovelModeEnabled();
            try {
                root.classList.toggle('plugin-album__character-view--vn', !!vnMode);
            } catch { }

            // VN mode: background should fill canvas; character should remain contained.
            try {
                if (bgLayer && bgLayer.style) {
                    bgLayer.style.objectFit = vnMode ? 'cover' : 'contain';
                    bgLayer.style.objectPosition = 'center';
                }
                if (charLayer && charLayer.style) {
                    charLayer.style.objectFit = 'contain';
                    charLayer.style.objectPosition = 'center';
                }
            } catch { }

            const presetId = this._characterResolveActivePresetId();
            const charUrl = presetId ? this._characterGetBestImageUrlForPresetId(presetId) : null;

            // Background URL (VN mode only)
            let bgUrl = null;
            let bgPvUrl = null;
            let bgGid = '';
            if (vnMode) {
                try {
                    this._characterEnsureVNState();
                    const bgCat = this._characterGetVisualNovelBackgroundCategoryName();
                    const vn = this.state.character.vn;
                    const useOverride = !!vn?.activeBgGroupIdOverride;
                    const gid = useOverride
                        ? String(vn?.activeBgGroupId ?? '').trim()
                        : (bgCat ? String(this.state.character?.selections?.[bgCat] || '').trim() : '');
                    bgGid = String(gid || '').trim();
                    if (bgGid) {
                        // If BG availability scan says this group has no matching image,
                        // do NOT attempt to load any cached URL for it (avoids 404 spam).
                        let bgIsAvailable = true;
                        try {
                            const keySet = this.state.character?.vn?.bgAvailableContextKeys;
                            const hasKeySet = !!(keySet && typeof keySet.has === 'function');
                            if (hasKeySet) {
                                const flat = this.state.character?.tagGroups?.flat || {};
                                const g = flat?.[bgGid];
                                const tags = (g && Array.isArray(g.tags)) ? g.tags : [];
                                const groupKey = this._characterVNNormalizeContextKey?.(tags) || '';
                                if (groupKey && !keySet.has(groupKey)) {
                                    bgIsAvailable = false;
                                }
                            }
                        } catch { }

                        if (bgIsAvailable) {
                            const entry = this.state.character.vn.backgrounds?.[bgGid];
                            if (entry && typeof entry === 'object') {
                                bgUrl = String(entry.url || '').trim() || null;
                                bgPvUrl = String(entry.pv_url || entry.pvUrl || '').trim() || null;
                            } else {
                                bgUrl = String(entry || '').trim() || null;
                            }
                        } else {
                            bgUrl = null;
                            bgPvUrl = null;
                        }
                    }
                } catch { }
            }

            // Swap images without flicker: preload in memory, then update the real <img> once loaded.
            // This avoids showing a blank layer when only one of the two layers changes.
            const _swapImgWhenReady = (imgEl, nextUrl, { onFinalError } = {}) => {
                try {
                    if (!imgEl) return;
                    const url = String(nextUrl || '').trim();
                    if (!url) return;

                    const current = String(imgEl.dataset.currentSrc || '').trim();
                    if (current && current === url) {
                        imgEl.hidden = false;
                        return;
                    }

                    const token = `${Date.now()}-${Math.random()}`;
                    imgEl.dataset.loadToken = token;

                    const pre = new Image();
                    pre.onload = () => {
                        try {
                            if (String(imgEl.dataset.loadToken || '') !== token) return;
                            imgEl.onerror = null;
                            imgEl.onload = null;
                            imgEl.src = url;
                            imgEl.dataset.currentSrc = url;
                            imgEl.hidden = false;
                        } catch { }
                    };
                    pre.onerror = () => {
                        try {
                            if (String(imgEl.dataset.loadToken || '') !== token) return;
                            if (typeof onFinalError === 'function') {
                                onFinalError();
                                return;
                            }
                            // If nothing displayed yet, ensure it stays hidden.
                            if (!String(imgEl.dataset.currentSrc || '').trim()) {
                                try { imgEl.src = ''; } catch { }
                                imgEl.hidden = true;
                            }
                        } catch { }
                    };
                    pre.decoding = 'async';
                    pre.src = url;
                } catch { }
            };

            // Apply Character layer
            if (charUrl) {
                if (charLayer) {
                    // Keep previous image visible until the new one is ready.
                    _swapImgWhenReady(charLayer, charUrl);
                }
            } else {
                if (charLayer) {
                    try { charLayer.onerror = null; } catch { }
                    try { charLayer.onload = null; } catch { }
                    try { charLayer.src = ''; } catch { }
                    try { delete charLayer.dataset.currentSrc; } catch { }
                    try { delete charLayer.dataset.loadToken; } catch { }
                    charLayer.hidden = true;
                }
            }

            // Apply Background layer
            if (vnMode) {
                if (bgUrl) {
                    if (bgLayer) {
                        // Handle stale URLs by preloading, trying fallback, then regenerating if needed.
                        try {
                            bgLayer.dataset.vnBgGid = bgGid || '';
                            bgLayer.dataset.vnBgFallback = bgPvUrl || '';
                        } catch { }

                        const gidForBg = String(bgGid || '').trim();
                        const fallbackUrl = String(bgPvUrl || '').trim();

                        const regenerate = async () => {
                            try {
                                if (!this._characterIsVisualNovelModeEnabled()) return;
                                const gid = gidForBg;
                                if (!gid) return;

                                // Clear stale cache entry (local + server), then regenerate.
                                try {
                                    this._characterEnsureVNState();
                                    if (this.state.character.vn?.backgrounds) {
                                        delete this.state.character.vn.backgrounds[gid];
                                    }
                                } catch { }
                                try {
                                    await this.api.album.delete(`/character/vn/backgrounds/${encodeURIComponent(gid)}`);
                                } catch { }
                                try {
                                    await this._characterStartVNBackgroundGeneration?.({ groupId: gid, auto: false, silent: true });
                                } catch { }
                                try { this._characterRefreshDisplayedImage(); } catch { }
                            } catch { }
                        };

                        // Try main url; if it fails, try fallback; if that fails, regenerate.
                        _swapImgWhenReady(bgLayer, bgUrl, {
                            onFinalError: () => {
                                if (fallbackUrl) {
                                    _swapImgWhenReady(bgLayer, fallbackUrl, {
                                        onFinalError: () => { regenerate(); },
                                    });
                                } else {
                                    regenerate();
                                }
                            },
                        });
                    }
                } else {
                    if (bgLayer) {
                        try { bgLayer.onerror = null; } catch { }
                        try { bgLayer.onload = null; } catch { }
                        try { bgLayer.src = ''; } catch { }
                        try { delete bgLayer.dataset.currentSrc; } catch { }
                        try { delete bgLayer.dataset.loadToken; } catch { }
                        bgLayer.hidden = true;
                    }
                }
            } else {
                // Legacy: background mirrors character image
                if (charUrl) {
                    if (bgLayer) {
                        bgLayer.src = charUrl;
                        bgLayer.hidden = false;
                    }
                } else {
                    if (bgLayer) bgLayer.hidden = true;
                }
            }

            const hasAny = !!(charUrl || bgUrl);
            root.classList.toggle('is-empty', !hasAny);
            
            const emptyMsg = root.querySelector('.plugin-album__character-empty');
            if (emptyMsg) {
                emptyMsg.hidden = !!(charUrl || bgUrl);
            }
        },

        async _characterVNEnsureBackgroundCacheLoaded() {
            try {
                if (!this._characterIsVisualNovelModeEnabled()) return false;
                this._characterEnsureVNState();
                const now = Date.now();
                const last = Number(this.state.character.vn.loadedAt || 0);
                // Avoid refetching too often
                if (last && Number.isFinite(last) && (now - last) < 30_000) return true;
                const resp = await this.api.album.get('/character/vn/backgrounds');
                const bg = (resp && typeof resp === 'object') ? resp.backgrounds : null;
                if (bg && typeof bg === 'object') {
                    this.state.character.vn.backgrounds = { ...bg };
                }
                this.state.character.vn.loadedAt = now;
                return true;
            } catch {
                return false;
            }
        },

        _characterVNUpsertBackgroundCache(groupId, imageData) {
            try {
                this._characterEnsureVNState();
                const gid = String(groupId || '').trim();
                if (!gid) return;
                const url = String(imageData?.url || imageData?.src || '').trim();
                const pvUrl = String(imageData?.pv_url || imageData?.pvUrl || imageData?.preview_url || '').trim();
                if (!url && !pvUrl) return;
                this.state.character.vn.backgrounds[gid] = {
                    url,
                    pv_url: pvUrl,
                    album_hash: String(imageData?.album_hash || imageData?.albumHash || imageData?.character_hash || imageData?.characterHash || '').trim(),
                    image_id: String(imageData?.id || '').trim(),
                    createdAt: imageData?.createdAt,
                };
            } catch { }
        },

        async _characterVNApplyBackgroundFromSelection({ generateIfMissing = false } = {}) {
            if (this.state.viewMode !== 'character') return;
            if (!this._characterIsVisualNovelModeEnabled()) return;
            this._characterEnsureVNState();

            const bgCat = this._characterGetVisualNovelBackgroundCategoryName();
            if (!bgCat) return;
            const vn = this.state.character.vn;
            const useOverride = !!vn?.activeBgGroupIdOverride;
            // If user has explicitly interacted with VN BG selection (including "None"),
            // do NOT fall back to bgCat selections.
            const gid = useOverride
                ? String(vn?.activeBgGroupId ?? '').trim()
                : String(this.state.character?.selections?.[bgCat] ?? '').trim();
            vn.activeBgGroupId = gid || null;
            if (!gid) {
                this._characterRefreshDisplayedImage();
                return;
            }

            const entry = this.state.character.vn.backgrounds?.[gid];
            const url = entry && typeof entry === 'object'
                ? String(entry.url || entry.pv_url || entry.pvUrl || '')
                : String(entry || '');

            // If availability scan says this group has no matching image in Background album,
            // treat it as missing even if we have a cached url (stale/out-of-sync cache).
            let available = true;
            try {
                const keySet = this.state.character?.vn?.bgAvailableContextKeys;
                const hasKeySet = !!(keySet && typeof keySet.has === 'function');
                if (hasKeySet) {
                    const flat = this.state.character?.tagGroups?.flat || {};
                    const g = flat?.[gid];
                    const tags = (g && Array.isArray(g.tags)) ? g.tags : [];
                    const groupKey = this._characterVNNormalizeContextKey?.(tags) || '';
                    if (groupKey && !keySet.has(groupKey)) {
                        available = false;
                    }
                }
            } catch { }

            if (url && available) {
                this._characterRefreshDisplayedImage();
                return;
            }

            // If cached entry exists but scan says unavailable, clear the stale cache (best-effort).
            if (!available) {
                try {
                    if (this.state.character?.vn?.backgrounds) {
                        delete this.state.character.vn.backgrounds[gid];
                    }
                } catch { }
                try {
                    await this.api.album.delete(`/character/vn/backgrounds/${encodeURIComponent(gid)}`);
                } catch { }
            }

            if (!generateIfMissing) {
                this._characterRefreshDisplayedImage();
                return;
            }

            // No cached background for this group => generate one.
            try {
                // Mark UI as generating immediately (mirrors non-auto task UX).
                try { this._characterMarkActiveCategorySelectionGenerating?.(`vn:bg:${gid}`); } catch { }
                await this._characterStartVNBackgroundGeneration?.({ groupId: gid, auto: false, silent: true });
            } catch { }
            this._characterRefreshDisplayedImage();
        },

        _characterGetRunningPresetProgressMap(allTasksStatus) {
            const map = new Map();
            try {
                const currentCharHash = String(this.state?.selectedCharacter?.hash || '').trim();
                Object.values(allTasksStatus || {}).forEach(task => {
                    if (!task) return;
                    if (task.is_running === false) return;
                    const tid = String(task.task_id || task.taskId || '').trim();
                    if (!tid) return;
                    const meta = this._characterTaskMeta.get(tid);
                    // VN BG tasks are stored under a different character_hash (Background album),
                    // but they still belong to the currently selected character session.
                    if (currentCharHash && String(task.character_hash || '') !== currentCharHash) {
                        if (!(meta && meta.vnLayer === 'bg' && String(meta.characterHash || '') === currentCharHash)) return;
                    }
                    const presetId = String(meta?.presetId || '').trim();
                    if (!presetId) return;
                    const p = Number(task.progress_percent ?? 0);
                    const percent = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
                    const prev = map.get(presetId);
                    if (typeof prev !== 'number' || percent > prev) map.set(presetId, percent);
                });
            } catch {}
            return map;
        },

        _characterGetRunningPresetProgressForPresetId(allTasksStatus, presetId, { nonAutoOnly = false } = {}) {
            try {
                const targetPresetId = String(presetId || '').trim();
                if (!targetPresetId) return null;
                const currentCharHash = String(this.state?.selectedCharacter?.hash || '').trim();
                let best = null;
                Object.values(allTasksStatus || {}).forEach(task => {
                    if (!task) return;
                    if (task.is_running === false) return;
                    const tid = String(task.task_id || task.taskId || '').trim();
                    if (!tid) return;
                    const meta = this._characterTaskMeta.get(tid);
                    if (!meta) return;
                    // VN BG tasks are stored under a different character_hash (Background album).
                    if (currentCharHash && String(task.character_hash || '') !== currentCharHash) {
                        if (!(meta.vnLayer === 'bg' && String(meta.characterHash || '') === currentCharHash)) return;
                    }
                    if (nonAutoOnly && meta.isAuto !== false) return;
                    const pid = String(meta?.presetId || '').trim();
                    if (!pid || pid !== targetPresetId) return;
                    const p = Number(task.progress_percent ?? 0);
                    const percent = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
                    if (best === null || percent > best) best = percent;
                });
                return (typeof best === 'number') ? best : null;
            } catch {
                return null;
            }
        },

        _characterGetCategoryMeta(categoryName) {
            try {
                const name = String(categoryName || '').trim();
                if (!name) return null;
                const categories = this._characterNormalizeCategories(this.state.character.categories);
                const resolved = categories.length ? categories : this._characterDefaultCategories();
                return resolved.find(c => String(c?.name || '').trim().toLowerCase() === name.toLowerCase()) || null;
            } catch {
                return null;
            }
        },

        _characterGetCategoryColor(categoryName) {
            try {
                const meta = this._characterGetCategoryMeta(categoryName);
                if (meta && this._characterIsValidHexColor(meta.color)) return meta.color;
            } catch {}
            return null;
        },

        _characterDarkenHexColor(hex, amount = 0.45) {
            // amount: 0..1, higher => darker
            try {
                if (!this._characterIsValidHexColor(hex)) return null;
                const a = Math.max(0, Math.min(1, Number(amount)));
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                const nr = Math.max(0, Math.min(255, Math.round(r * (1 - a))));
                const ng = Math.max(0, Math.min(255, Math.round(g * (1 - a))));
                const nb = Math.max(0, Math.min(255, Math.round(b * (1 - a))));
                const toHex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
                return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
            } catch {
                return null;
            }
        },

        _characterTickPreGen() {
             if (typeof this._characterAutoMaybeSchedule === 'function') {
                 this._characterAutoMaybeSchedule(null, { reason: 'tick' });
             }
        },
    });
})();
