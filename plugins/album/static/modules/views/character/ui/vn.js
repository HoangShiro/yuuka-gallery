// Album plugin - View module: character view (Visual Novel helpers)
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
    });
})();
