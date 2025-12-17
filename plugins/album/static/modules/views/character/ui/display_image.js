// Album plugin - View module: character view (Display image)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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

                        // Even if the URL didn't change, submenu selection may have requested a replay.
                        try {
                            if (imgEl.classList?.contains?.('plugin-album__character-layer--char')) {
                                this._characterMaybeAutoPlayAfterCharacterImageSwap?.({ imageUrl: url, reason: 'image-same' });
                            }
                        } catch { }
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

                            // If user changed selection from submenu, we may need to auto-play
                            // the current animation/sound FX once the new character image is actually shown.
                            try {
                                if (imgEl.classList?.contains?.('plugin-album__character-layer--char')) {
                                    this._characterMaybeAutoPlayAfterCharacterImageSwap?.({ imageUrl: url, reason: 'image-swap' });
                                }
                            } catch { }
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

        _characterGetCharacterLayerEl() {
            try {
                const root = this.contentArea?.querySelector('.plugin-album__character-view');
                return root?.querySelector?.('.plugin-album__character-layer--char') || null;
            } catch {
                return null;
            }
        },

        _characterGetBackgroundLayerEl() {
            try {
                const root = this.contentArea?.querySelector('.plugin-album__character-view');
                return root?.querySelector?.('.plugin-album__character-layer--bg') || null;
            } catch {
                return null;
            }
        },

        _characterGetBgAnimConfig() {
            try {
                if (!this.state.character) this.state.character = {};
                const cfg = this.state.character.animBg;
                // Default ON. Only disable when explicitly set to false.
                const enabled = (cfg && typeof cfg === 'object') ? (cfg.enabled !== false) : true;

                const intensityRaw = (cfg && typeof cfg === 'object') ? Number(cfg.intensity) : NaN;
                const delayRaw = (cfg && typeof cfg === 'object') ? Number(cfg.delayMs) : NaN;

                const intensity = Number.isFinite(intensityRaw) ? Math.max(0, intensityRaw) : 0.1;
                const delayMs = Number.isFinite(delayRaw) ? Math.max(0, Math.round(delayRaw)) : 50;

                return { enabled, intensity, delayMs };
            } catch {
                return { enabled: true, intensity: 0.1, delayMs: 50 };
            }
        },

        _characterReadAnimationPresetList(obj) {
            try {
                const a = obj?.animation_presets;
                if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                const b = obj?.animationPresets;
                if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
            } catch { }
            return [];
        },

        _characterReadSoundFxList(obj, slot) {
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
        },

        _characterGetCurrentAnimationSoundContext() {
            try {
                // State mode
                if (typeof this._characterIsStateModeEnabled === 'function' && this._characterIsStateModeEnabled()) {
                    this._characterEnsureStateModeState?.();
                    const activeAnimGroupId = this._characterFindActiveAnimationStateGroupId({ preferGroupId: null });
                    if (!activeAnimGroupId) return null;

                    const sel = this.state.character.state.selections || {};
                    const sid = String(sel?.[activeAnimGroupId] || '').trim();
                    if (!sid || sid === '__none__') return null;

                    const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                    const st = states.find(s => String(s?.id || '').trim() === sid) || null;
                    if (!st) return null;
                    return { type: 'state', id: sid, object: st };
                }

                // Category mode
                const activeCat = this._characterFindActiveAnimationCategoryName({ preferCategory: null });
                if (!activeCat) return null;
                const gid = String(this.state.character?.selections?.[activeCat] || '').trim();
                if (!gid || gid === '__none__') return null;
                const g = this.state.character?.tagGroups?.flat?.[gid] || null;
                if (!g) return null;
                return { type: 'tag', id: gid, object: g };
            } catch {
                return null;
            }
        },

        _characterSoundEnsurePresetsCache({ maxAgeMs = 30000 } = {}) {
            try {
                if (!this.state.character) this.state.character = {};
                const cache = this.state.character._soundFxPresetsCache;
                const now = Date.now();
                if (cache && typeof cache === 'object' && Array.isArray(cache.presets)) {
                    const age = now - Number(cache.fetchedAt || 0);
                    if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) return;
                }
                if (this.state.character._soundFxPresetsFetching) return;
                if (!this.api?.album?.get) return;

                this.state.character._soundFxPresetsFetching = true;
                Promise.resolve(this.api.album.get('/sound_fx/presets'))
                    .then((all) => {
                        const arr = Array.isArray(all) ? all : [];
                        const presets = arr
                            .filter(p => p && typeof p === 'object')
                            .map(p => ({
                                id: String(p?.id || '').trim(),
                                name: String(p?.name || '').trim(),
                                ext: String(p?.ext || '').trim().toLowerCase(),
                                url: String(p?.url || '').trim(),
                            }))
                            .filter(p => p.id && p.url);
                        this.state.character._soundFxPresetsCache = { fetchedAt: Date.now(), presets };
                    })
                    .catch(() => { })
                    .finally(() => {
                        try { this.state.character._soundFxPresetsFetching = false; } catch { }
                    });
            } catch { }
        },

        _characterSoundGetPresetUrlById(presetId) {
            try {
                const pid = String(presetId || '').trim();
                if (!pid) return '';
                const cache = this.state.character?._soundFxPresetsCache;
                const presets = Array.isArray(cache?.presets) ? cache.presets : [];
                const found = presets.find(p => String(p?.id || '').trim() === pid) || null;
                if (found && String(found.url || '').trim()) return String(found.url).trim();
                return `/api/plugin/album/sound_fx/file/${encodeURIComponent(pid)}`;
            } catch {
                return '';
            }
        },

        _characterReadSoundParallelFlag(obj, slot) {
            try {
                const s = Number(slot);
                if (s === 1) {
                    const v = obj?.sound_fx_1_parallel;
                    if (typeof v === 'boolean') return v;
                    const v2 = obj?.soundFx1Parallel;
                    if (typeof v2 === 'boolean') return v2;
                    return false;
                }
                if (s === 2) {
                    const v = obj?.sound_fx_2_parallel;
                    if (typeof v === 'boolean') return v;
                    const v2 = obj?.soundFx2Parallel;
                    if (typeof v2 === 'boolean') return v2;
                    return true;
                }
            } catch { }
            return (Number(slot) === 2);
        },

        _characterSoundGetActivePlayers(slotKey) {
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character._soundFxActivePlayers) this.state.character._soundFxActivePlayers = {};
                const key = String(slotKey || '').trim() || 'fx1';
                const map = this.state.character._soundFxActivePlayers;
                if (!Array.isArray(map[key])) map[key] = [];
                return map[key];
            } catch {
                return [];
            }
        },

        _characterSoundFadeOutAudio(audio, fadeOutMs = 50) {
            try {
                const a = audio;
                const ms = Math.max(0, Number(fadeOutMs || 0));
                if (!a) return;
                if (!Number.isFinite(ms) || ms <= 0) {
                    try { a.pause(); } catch { }
                    return;
                }

                const v0 = Math.max(0, Math.min(1, Number(a.volume ?? 1)));
                const t0 = performance.now();
                const tick = (t) => {
                    try {
                        const dt = Math.max(0, t - t0);
                        const p = Math.min(1, dt / ms);
                        const v = v0 * (1 - p);
                        try { a.volume = Math.max(0, Math.min(1, v)); } catch { }
                        if (p >= 1 || a.paused || a.ended) {
                            try { a.pause(); } catch { }
                            return;
                        }
                        requestAnimationFrame(tick);
                    } catch {
                        try { a.pause(); } catch { }
                    }
                };
                requestAnimationFrame(tick);
            } catch { }
        },

        _characterSoundPlayUrl(slotKey, url, { parallel = false, fadeOutMs = 50 } = {}) {
            try {
                const key = String(slotKey || '').trim() || 'fx1';
                const u = String(url || '').trim();
                if (!u) return null;

                const players = this._characterSoundGetActivePlayers(key);
                // Prune dead players first.
                try {
                    for (let i = players.length - 1; i >= 0; i--) {
                        const p = players[i];
                        const a = p?.audio;
                        const pausedAfterStart = !!(a && a.paused && Number(a.currentTime || 0) > 0);
                        if (!a || a.ended || pausedAfterStart) players.splice(i, 1);
                    }
                } catch { }

                // Non-parallel: fade out existing audios (new one will start immediately).
                if (!parallel) {
                    try {
                        players.forEach((p) => {
                            const a = p?.audio;
                            if (!a) return;
                            this._characterSoundFadeOutAudio(a, fadeOutMs);
                        });
                    } catch { }
                }

                if (!window.Yuuka?.AlbumSoundEngine) return null;
                const engine = new window.Yuuka.AlbumSoundEngine();
                const audio = engine.play(u);
                try { if (audio) audio.volume = 1; } catch { }

                const entry = { engine, audio };
                players.push(entry);

                // Cleanup on end; keep list bounded to avoid leaks if user spams.
                try {
                    audio?.addEventListener?.('ended', () => {
                        try {
                            const arr = this._characterSoundGetActivePlayers(key);
                            const idx = arr.indexOf(entry);
                            if (idx >= 0) arr.splice(idx, 1);
                        } catch { }
                    }, { once: true });
                } catch { }
                try {
                    while (players.length > 10) players.shift();
                } catch { }
                return audio;
            } catch {
                return null;
            }
        },

        _characterSoundPickRandomNonRepeating(list, last) {
            try {
                const arr = (Array.isArray(list) ? list : []).map(x => String(x || '').trim()).filter(Boolean);
                if (!arr.length) return null;
                const lastId = String(last || '').trim();
                const choices = (lastId && arr.length > 1) ? arr.filter(x => x !== lastId) : arr;
                if (!choices.length) return arr[0];
                const idx = Math.floor(Math.random() * choices.length);
                return choices[Math.max(0, Math.min(choices.length - 1, idx))];
            } catch {
                return null;
            }
        },

        _characterSoundOnAnimationPresetActivated(soundCtx) {
            try {
                const ctx = soundCtx && typeof soundCtx === 'object' ? soundCtx : this._characterGetCurrentAnimationSoundContext?.();
                if (!ctx || !ctx.object) return;

                // Ensure preset url map is warm (non-blocking).
                this._characterSoundEnsurePresetsCache?.({});

                if (!this.state.character) this.state.character = {};
                const lastMap = this.state.character._soundFxLastByContext || (this.state.character._soundFxLastByContext = {});

                const ctxKey = `${String(ctx.type || 'ctx')}:${String(ctx.id || '')}`;

                const sfx1List = this._characterReadSoundFxList(ctx.object, 1);
                const sfx2List = this._characterReadSoundFxList(ctx.object, 2);

                const sfx1Parallel = this._characterReadSoundParallelFlag(ctx.object, 1);
                const sfx2Parallel = this._characterReadSoundParallelFlag(ctx.object, 2);

                const playSlot = (slotKey, list, { parallel } = {}) => {
                    const lastKey = `${ctxKey}:${slotKey}`;
                    const last = String(lastMap[lastKey] || '').trim();
                    const nextId = this._characterSoundPickRandomNonRepeating(list, last);
                    if (!nextId) return;
                    const url = this._characterSoundGetPresetUrlById(nextId);
                    if (!url) return;

                    try {
                        this._characterSoundPlayUrl(slotKey, url, { parallel: !!parallel, fadeOutMs: 50 });
                    } catch { }
                    lastMap[lastKey] = nextId;
                };

                playSlot('fx1', sfx1List, { parallel: !!sfx1Parallel });
                playSlot('fx2', sfx2List, { parallel: !!sfx2Parallel });
            } catch { }
        },

        _characterFindActiveAnimationCategoryName({ preferCategory = null } = {}) {
            try {
                const prefer = String(preferCategory || '').trim();
                const flat = this.state.character?.tagGroups?.flat || {};
                const catsWithAnim = [];
                Object.values(flat).forEach((g) => {
                    if (!g || typeof g !== 'object') return;
                    const cat = String(g.category || '').trim();
                    if (!cat) return;
                    if (this._characterReadAnimationPresetList(g).length > 0) {
                        if (!catsWithAnim.includes(cat)) catsWithAnim.push(cat);
                    }
                });
                if (prefer && catsWithAnim.includes(prefer)) return prefer;
                return catsWithAnim.length ? catsWithAnim[0] : null;
            } catch {
                return null;
            }
        },

        _characterFindActiveAnimationStateGroupId({ preferGroupId = null } = {}) {
            try {
                this._characterEnsureStateModeState?.();
                const prefer = String(preferGroupId || '').trim();
                const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const groupsWithAnim = [];
                states.forEach((s) => {
                    if (!s || typeof s !== 'object') return;
                    const gid = String(s.group_id || s.groupId || '').trim();
                    if (!gid) return;
                    if (this._characterReadAnimationPresetList(s).length > 0) {
                        if (!groupsWithAnim.includes(gid)) groupsWithAnim.push(gid);
                    }
                });
                if (prefer && groupsWithAnim.includes(prefer)) return prefer;
                return groupsWithAnim.length ? groupsWithAnim[0] : null;
            } catch {
                return null;
            }
        },

        _characterGetCurrentAnimationPlaylist() {
            try {
                // State mode: playlist comes from selected State(s)
                if (typeof this._characterIsStateModeEnabled === 'function' && this._characterIsStateModeEnabled()) {
                    this._characterEnsureStateModeState?.();
                    const activeAnimGroupId = this._characterFindActiveAnimationStateGroupId({ preferGroupId: null });
                    if (!activeAnimGroupId) return [];

                    const sel = this.state.character.state.selections || {};
                    const sid = String(sel?.[activeAnimGroupId] || '').trim();
                    if (!sid || sid === '__none__') return [];

                    const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                    const st = states.find(s => String(s?.id || '').trim() === sid) || null;
                    return this._characterReadAnimationPresetList(st);
                }

                // Category mode: playlist comes from the selected tag group in the (single) active animation category
                const activeCat = this._characterFindActiveAnimationCategoryName({ preferCategory: null });
                if (!activeCat) return [];
                const gid = String(this.state.character?.selections?.[activeCat] || '').trim();
                if (!gid || gid === '__none__') return [];
                const g = this.state.character?.tagGroups?.flat?.[gid] || null;
                return this._characterReadAnimationPresetList(g);
            } catch {
                return [];
            }
        },

        _characterStopCharacterLayerAnimations({ stopEngine = true } = {}) {
            try {
                if (!this.state.character) this.state.character = {};
                const pb = this.state.character._animPlayback || (this.state.character._animPlayback = {});
                pb.token = (pb.token || 0) + 1;
            } catch { }

            try {
                const el = this._characterGetCharacterLayerEl?.();
                if (stopEngine && el && typeof this._albumAnimStopLayer === 'function') {
                    this._albumAnimStopLayer(el);
                }
            } catch { }

            try {
                const bgCfg = this._characterGetBgAnimConfig?.() || { enabled: false };
                const bgEl = (bgCfg.enabled && typeof this._characterGetBackgroundLayerEl === 'function') ? this._characterGetBackgroundLayerEl() : null;
                if (stopEngine && bgEl && typeof this._albumAnimStopLayer === 'function') {
                    this._albumAnimStopLayer(bgEl);
                }
            } catch { }

            try {
                if (this.state.character?._animPlayback) {
                    this.state.character._animPlayback.isPlaying = false;
                }
            } catch { }
        },

        _characterGetAnimSmoothConfig() {
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character.animSmooth || typeof this.state.character.animSmooth !== 'object') {
                    this.state.character.animSmooth = { enabled: true, endMs: 100, resetMs: 50 };
                }
                const enabled = this.state.character.animSmooth.enabled;
                const endMs = Number(this.state.character.animSmooth.endMs);
                const resetMs = Number(this.state.character.animSmooth.resetMs);
                return {
                    enabled: (enabled !== false),
                    endMs: Number.isFinite(endMs) ? endMs : 100,
                    resetMs: Number.isFinite(resetMs) ? resetMs : 50,
                };
            } catch {
                return { enabled: true, endMs: 100, resetMs: 50 };
            }
        },

        _characterRequestAutoPlayOnNextCharacterImage({ reason = 'submenu', maxAgeMs = 5000 } = {}) {
            try {
                if (!this.state.character) this.state.character = {};
                this.state.character._animAutoPlayNext = {
                    requestedAt: Date.now(),
                    reason: String(reason || '').trim() || 'submenu',
                    maxAgeMs: Math.max(0, Number(maxAgeMs || 0)) || 5000,
                };
            } catch { }
        },

        _characterMaybeAutoPlayAfterCharacterImageSwap({ imageUrl = '', reason = 'image-swap' } = {}) {
            try {
                if (this.state.viewMode !== 'character') return;
                const req = this.state.character?._animAutoPlayNext;
                if (!req || typeof req !== 'object') return;

                const age = Date.now() - Number(req.requestedAt || 0);
                const maxAge = Math.max(0, Number(req.maxAgeMs || 0)) || 5000;
                if (!Number.isFinite(age) || age < 0 || age > maxAge) {
                    try { delete this.state.character._animAutoPlayNext; } catch { }
                    return;
                }

                // Consume the request (one-shot).
                try { delete this.state.character._animAutoPlayNext; } catch { }

                // If loop is enabled, do not interrupt it.
                if (this._characterIsCharacterLayerLoopEnabled?.()) return;

                // Defer to ensure DOM/img state is stable.
                queueMicrotask(() => {
                    try {
                        this._characterPlayCurrentCharacterLayerAnimations?.({ restart: true, reason: String(req.reason || reason || 'submenu') });
                    } catch { }
                });
            } catch { }
        },

        _characterEnsureAnimLoopState() {
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character._animLoop || typeof this.state.character._animLoop !== 'object') {
                    this.state.character._animLoop = { enabled: false, token: 0, pendingUpdate: false, pendingReason: '' };
                }
            } catch { }
        },

        _characterLoopRequestPlaylistUpdate({ reason = 'submenu' } = {}) {
            try {
                this._characterEnsureAnimLoopState?.();
                const lp = this.state.character._animLoop;
                if (!lp || typeof lp !== 'object') return;
                lp.pendingUpdate = true;
                lp.pendingReason = String(reason || '').trim();
            } catch { }
        },

        _characterIsCharacterLayerLoopEnabled() {
            try {
                return !!this.state.character?._animLoop?.enabled;
            } catch {
                return false;
            }
        },

        _characterStopCharacterLayerLoop({ stopEngine = false } = {}) {
            try {
                this._characterEnsureAnimLoopState?.();
                const lp = this.state.character._animLoop;
                lp.enabled = false;
                lp.token = (lp.token || 0) + 1;
            } catch { }

            // Cancel any in-flight animation runner too.
            try { this._characterStopCharacterLayerAnimations?.({ stopEngine: !!stopEngine }); } catch { }
        },

        async _characterStartCharacterLayerLoop({ reason = 'hold' } = {}) {
            try {
                if (this.state.viewMode !== 'character') return false;
                const el = this._characterGetCharacterLayerEl?.();
                if (!el || el.hidden) return false;

                this._characterEnsureAnimLoopState?.();
                const lp = this.state.character._animLoop;
                lp.enabled = true;
                lp.token = (lp.token || 0) + 1;
                const token = lp.token || 0;

                // Cancel any non-loop run without forcing a snap.
                try { this._characterStopCharacterLayerAnimations?.({ stopEngine: false }); } catch { }

                const engine = (typeof this._albumAnimGetEngine === 'function') ? this._albumAnimGetEngine() : null;
                let bridgeFrom = null;

                const isCancelled = () => {
                    try {
                        if (this.state.viewMode !== 'character') return true;
                        const cur = this.state.character?._animLoop;
                        return !(cur && cur.enabled && (cur.token || 0) === token);
                    } catch {
                        return true;
                    }
                };

                while (!isCancelled()) {
                    // Resolve playlist once per loop pass. If a submenu selection happens mid-pass,
                    // we will switch ONLY after the current list finishes.
                    let playlist = this._characterGetCurrentAnimationPlaylist?.() || [];
                    if (!Array.isArray(playlist) || !playlist.length) {
                        // Nothing to loop anymore => stop loop.
                        try { this._characterStopCharacterLayerLoop?.({ stopEngine: true }); } catch { }
                        return false;
                    }

                    // Bridge from the current pose into the next loop iteration (best-effort).
                    if (engine && typeof engine.getCurrentTrackValues === 'function') {
                        try { bridgeFrom = engine.getCurrentTrackValues(el); } catch { bridgeFrom = null; }
                    }

                    await this._characterPlayAnimationPresetSequenceOnElement(
                        el,
                        playlist,
                        {
                            restart: false,
                            bridgeFrom,
                            stopAtEnd: false,
                            finalReturnToDefault: false,
                        },
                    );

                    if (isCancelled()) break;

                    // If playlist changed during playback, consume the flag now; next while-pass will
                    // pick up the new playlist.
                    try {
                        const cur = this.state.character?._animLoop;
                        if (cur && cur.enabled && (cur.token || 0) === token && cur.pendingUpdate) {
                            cur.pendingUpdate = false;
                        }
                    } catch { }
                }

                return true;
            } catch {
                return false;
            }
        },

        async _characterPlayAnimationPresetSequenceOnElement(
            el,
            presetKeys,
            {
                restart = true,
                bridgeFrom = null,
                stopAtEnd = true,
                finalReturnToDefault = true,
            } = {},
        ) {
            if (!el) return false;
            const keys = (Array.isArray(presetKeys) ? presetKeys : [])
                .map(k => String(k || '').trim())
                .filter(Boolean);
            if (!keys.length) return false;

            const soundCtx = this._characterGetCurrentAnimationSoundContext?.() || null;

            if (!this.state.character) this.state.character = {};
            const pb = this.state.character._animPlayback || (this.state.character._animPlayback = {});
            if (restart) {
                pb.token = (pb.token || 0) + 1;
            }
            const token = pb.token || 0;
            pb.isPlaying = true;

            const bgCfg = (typeof this._characterGetBgAnimConfig === 'function')
                ? (this._characterGetBgAnimConfig() || { enabled: false, intensity: 0.1, delayMs: 50 })
                : { enabled: false, intensity: 0.1, delayMs: 50 };
            const bgEl = (bgCfg.enabled && typeof this._characterGetBackgroundLayerEl === 'function')
                ? this._characterGetBackgroundLayerEl()
                : null;

            const bgEnabled = !!(bgCfg.enabled && bgEl && !bgEl.hidden);

            const isCancelled = () => (this.state.character?._animPlayback?.token || 0) !== token;

            const smoothCfg = this._characterGetAnimSmoothConfig?.() || { enabled: true, endMs: 100, resetMs: 50 };
            const smoothEnabled = !!smoothCfg.enabled;
            const smoothEndMs = Math.max(0, Math.round(Number(smoothCfg.endMs || 0)));
            const smoothResetMs = Math.max(0, Math.round(Number(smoothCfg.resetMs || 0)));

            const posesEqual = (a, b) => {
                try {
                    if (!a || !b) return false;
                    const ax = Number(a.x ?? 0), ay = Number(a.y ?? 0), as = Number(a.s ?? 1), ao = Number(a.o ?? 1);
                    const bx = Number(b.x ?? 0), by = Number(b.y ?? 0), bs = Number(b.s ?? 1), bo = Number(b.o ?? 1);
                    const eq = (x, y, eps) => Math.abs((Number(x) || 0) - (Number(y) || 0)) <= eps;
                    return eq(ax, bx, 0.01) && eq(ay, by, 0.01) && eq(as, bs, 0.0005) && eq(ao, bo, 0.0005);
                } catch {
                    return false;
                }
            };

            const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));

            const engine = (typeof this._albumAnimGetEngine === 'function') ? this._albumAnimGetEngine() : null;
            if (!engine) {
                pb.isPlaying = false;
                return false;
            }

            // For restart interactions, capture BG's current pose once so we can bridge to the new start pose
            // during the delay window (prevents visible snap/jitter).
            let bgInitialPose = null;
            if (restart && bgEnabled && typeof engine.getCurrentTrackValues === 'function') {
                try { bgInitialPose = engine.getCurrentTrackValues(bgEl); } catch { bgInitialPose = null; }
            }

            const makeBgMainPreset = (preset) => {
                try {
                    if (!bgEnabled) return null;
                    if (!preset) return null;
                    let out = preset;
                    if (typeof engine.withIntensity === 'function') {
                        // BG: reduce intensity and do NOT affect opacity.
                        out = engine.withIntensity(out, bgCfg.intensity, { affectOpacity: false });
                    }
                    if (typeof engine.withLag === 'function') {
                        // Bake lag into the timeline (prevents drift/glitches in loops).
                        out = engine.withLag(out, bgCfg.delayMs);
                    }
                    return out;
                } catch {
                    return preset;
                }
            };

            const bgPoseNoOpacity = (pose) => {
                try {
                    const p = (pose && typeof pose === 'object') ? pose : {};
                    return { ...p, o: 1 };
                } catch {
                    return { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
                }
            };

            // Start from a clean baseline for explicit restarts.
            if (restart) {
                try { engine.stop(el); } catch { }
                // Do NOT hard-stop BG here: it can snap to default. We'll transition it into the new start pose
                // and then start the new preset after the delay.
            }

            let didBridge = false;
            let prefetchedPreset = null;
            let prefetchedKey = null;

            for (let i = 0; i < keys.length; i += 1) {
                const k = keys[i];
                try {
                    if (isCancelled()) return false;

                    let preset = (prefetchedPreset && prefetchedKey === k) ? prefetchedPreset : null;
                    if (!preset) preset = await engine.loadPresetByKey(k);
                    if (isCancelled()) return false;
                    if (!preset) continue;

                    // If this run was started by a restart, bridge from previous pose to the new preset's start.
                    if (!didBridge && bridgeFrom && smoothEnabled && smoothResetMs > 0 && typeof engine.makeTransitionPreset === 'function') {
                        try {
                            const toVals = (typeof engine.getPresetStartValues === 'function')
                                ? engine.getPresetStartValues(preset)
                                : { tMs: 0, x: 0, y: 0, s: 1, o: 1 };

                            const bridgePreset = engine.makeTransitionPreset(bridgeFrom, toVals, smoothResetMs, { graphType: preset.graphType || 'linear' });
                            engine.applyPresetOnElement(el, bridgePreset, { loop: false, seamless: false });

                            if (bgEnabled) {
                                try {
                                    const bgFrom = (typeof engine.getCurrentTrackValues === 'function')
                                        ? engine.getCurrentTrackValues(bgEl)
                                        : null;
                                    const bgMain = makeBgMainPreset(preset);
                                    const bgTo = (bgMain && typeof engine.getPresetStartValues === 'function')
                                        ? engine.getPresetStartValues(bgMain)
                                        : { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
                                    if (bgFrom && bgTo) {
                                        const bgBridgePreset = engine.makeTransitionPreset(
                                            bgPoseNoOpacity(bgFrom),
                                            bgPoseNoOpacity(bgTo),
                                            smoothResetMs,
                                            { graphType: preset.graphType || 'linear' },
                                        );
                                        engine.applyPresetOnElement(bgEl, bgBridgePreset, { loop: false, seamless: false, phaseShiftMs: 0 });
                                    }
                                } catch { }
                            }

                            await sleep(smoothResetMs);
                            if (isCancelled()) return false;
                            engine.stop(el);
                            if (bgEnabled) {
                                try { engine.stop(bgEl); } catch { }
                            }
                        } catch { }
                    }
                    didBridge = true;

                    // IMPORTANT: do NOT apply end-smoothing on every preset in a playlist.
                    // We'll only smooth-return to default once, at the end of the whole list.
                    const dur = engine.getPresetDurationMs(preset) || 1000;

                    // Non-looped + non-seamless: each clip starts from baseline.
                    engine.applyPresetOnElement(el, preset, { loop: false, seamless: false });

                    if (bgEnabled) {
                        const bgPreset = makeBgMainPreset(preset);

                        // Reset case: during the delay window, bridge BG from its current pose to the next
                        // preset's start pose so the eventual start doesn't look like a jump.
                        if (restart && i === 0 && bgInitialPose && bgCfg.delayMs > 0
                            && typeof engine.makeTransitionPreset === 'function'
                            && typeof engine.getPresetStartValues === 'function') {
                            try {
                                const bgStart = engine.getPresetStartValues(bgPreset);
                                if (bgStart && !posesEqual(bgInitialPose, bgStart)) {
                                    const bridgeMs = Math.max(1, Math.round(Number(bgCfg.delayMs || 0)));
                                    const bgBridge = engine.makeTransitionPreset(
                                        bgPoseNoOpacity(bgInitialPose),
                                        bgPoseNoOpacity(bgStart),
                                        bridgeMs,
                                        { graphType: preset.graphType || 'linear' },
                                    );
                                    engine.applyPresetOnElement(bgEl, bgBridge, { loop: false, seamless: false, phaseShiftMs: 0 });
                                }
                            } catch { }
                        }

                        try { engine.applyPresetOnElement(bgEl, bgPreset, { loop: false, seamless: false, phaseShiftMs: 0 }); } catch { }
                    }

                    try { this._characterSoundOnAnimationPresetActivated?.(soundCtx); } catch { }
                    await sleep(dur);
                    if (isCancelled()) return false;

                    // Between presets: optionally smooth-reset from end pose -> next start pose.
                    if (i < keys.length - 1 && smoothEnabled && smoothResetMs > 0 && typeof engine.makeTransitionPreset === 'function') {
                        const nextKey = keys[i + 1];
                        try {
                            const endPose = (typeof engine.getCurrentTrackValues === 'function')
                                ? engine.getCurrentTrackValues(el)
                                : null;

                            // Look-ahead next preset once so we can skip smoothing if poses match.
                            const nextPreset = await engine.loadPresetByKey(nextKey);
                            prefetchedPreset = nextPreset;
                            prefetchedKey = nextKey;

                            const nextStart = (nextPreset && typeof engine.getPresetStartValues === 'function')
                                ? engine.getPresetStartValues(nextPreset)
                                : null;

                            if (endPose && nextStart && !posesEqual(endPose, nextStart)) {
                                const bridge = engine.makeTransitionPreset(endPose, nextStart, smoothResetMs, { graphType: nextPreset?.graphType || preset?.graphType || 'linear' });
                                engine.applyPresetOnElement(el, bridge, { loop: false, seamless: false });

                                if (bgEnabled) {
                                    try {
                                        const bgEndPose = (typeof engine.getCurrentTrackValues === 'function')
                                            ? engine.getCurrentTrackValues(bgEl)
                                            : null;
                                        const bgNextPreset = makeBgMainPreset(nextPreset);
                                        const bgNextStart = (bgNextPreset && typeof engine.getPresetStartValues === 'function')
                                            ? engine.getPresetStartValues(bgNextPreset)
                                            : null;
                                        if (bgEndPose && bgNextStart && !posesEqual(bgEndPose, bgNextStart)) {
                                            const bgBridgePreset = engine.makeTransitionPreset(
                                                bgPoseNoOpacity(bgEndPose),
                                                bgPoseNoOpacity(bgNextStart),
                                                smoothResetMs,
                                                { graphType: nextPreset?.graphType || preset?.graphType || 'linear' },
                                            );
                                            engine.applyPresetOnElement(bgEl, bgBridgePreset, { loop: false, seamless: false, phaseShiftMs: 0 });
                                        }
                                    } catch { }
                                }

                                await sleep(smoothResetMs);
                                if (isCancelled()) return false;
                            }
                        } catch { }
                    }
                } catch {
                    // Only stop if this run still owns the element.
                    if (!isCancelled()) {
                        try { engine.stop(el); } catch { }
                        if (bgEnabled) {
                            try { engine.stop(bgEl); } catch { }
                        }
                    }
                }
            }

            // After the final preset: smooth-return to defaults ONCE (optional).
            if (!isCancelled() && !!finalReturnToDefault && smoothEnabled && smoothEndMs > 0 && typeof engine.makeTransitionPreset === 'function') {
                try {
                    const endPose = (typeof engine.getCurrentTrackValues === 'function')
                        ? engine.getCurrentTrackValues(el)
                        : null;
                    const def = { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
                    if (endPose && !posesEqual(endPose, def)) {
                        const back = engine.makeTransitionPreset(endPose, def, smoothEndMs, { graphType: 'linear' });
                        engine.applyPresetOnElement(el, back, { loop: false, seamless: false });

                        if (bgEnabled) {
                            try {
                                const bgEndPose = (typeof engine.getCurrentTrackValues === 'function')
                                    ? engine.getCurrentTrackValues(bgEl)
                                    : null;
                                const bgDef = { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
                                if (bgEndPose && !posesEqual(bgEndPose, bgDef)) {
                                    const bgBackPreset = engine.makeTransitionPreset(
                                        bgPoseNoOpacity(bgEndPose),
                                        bgDef,
                                        smoothEndMs,
                                        { graphType: 'linear' },
                                    );
                                    engine.applyPresetOnElement(bgEl, bgBackPreset, { loop: false, seamless: false, phaseShiftMs: 0 });
                                }
                            } catch { }
                        }

                        await sleep(smoothEndMs);
                        if (isCancelled()) return false;
                    }
                } catch { }
            }

            // Restore defaults after playlist ends.
            if (!isCancelled() && !!stopAtEnd) {
                try { engine.stop(el); } catch { }
                if (bgEnabled) {
                    try { engine.stop(bgEl); } catch { }
                }
            }
            try {
                if ((this.state.character?._animPlayback?.token || 0) === token) {
                    this.state.character._animPlayback.isPlaying = false;
                }
            } catch { }
            return true;
        },

        async _characterPlayCurrentCharacterLayerAnimations({ restart = true, reason = '' } = {}) {
            try {
                if (this.state.viewMode !== 'character') return false;
                const el = this._characterGetCharacterLayerEl?.();
                if (!el || el.hidden) return false;

                // Normal play should stop any active loop.
                try { this._characterStopCharacterLayerLoop?.({ stopEngine: false }); } catch { }

                const engine = (typeof this._albumAnimGetEngine === 'function') ? this._albumAnimGetEngine() : null;
                let bridgeFrom = null;
                // Only bridge on reset when something was already playing.
                const wasPlaying = !!(this.state.character?._animPlayback?.isPlaying);
                const smoothCfg = this._characterGetAnimSmoothConfig?.() || { enabled: true, endMs: 100, resetMs: 50 };
                const smoothEnabled = !!smoothCfg.enabled;
                const smoothResetMs = Math.max(0, Math.round(Number(smoothCfg.resetMs || 0)));

                let currentPose = null;
                if (restart && wasPlaying && engine && typeof engine.getCurrentTrackValues === 'function') {
                    try { currentPose = engine.getCurrentTrackValues(el); } catch { currentPose = null; }
                }

                // Click while playing should reset & play from start.
                if (restart) {
                    // Cancel runner immediately, but avoid stopping the engine here to prevent a snap-to-default
                    // while we await preset fetch; we'll replace it with a deterministic "hold" pose first.
                    try { this._characterStopCharacterLayerAnimations?.({ stopEngine: false }); } catch { }

                    // If something was playing, immediately replace it with a 1ms hold-at-current-pose animation
                    // so the layer doesn't flicker while presets are loading.
                    if (wasPlaying && currentPose && engine && typeof engine.makeTransitionPreset === 'function') {
                        try {
                            const hold = engine.makeTransitionPreset(currentPose, currentPose, 1, { graphType: 'linear' });
                            engine.applyPresetOnElement(el, hold, { loop: false, seamless: false });
                        } catch { }
                    } else if (engine && typeof engine.stop === 'function') {
                        // No pose available: fall back to a hard stop.
                        try { engine.stop(el); } catch { }
                    }
                }

                // Enable bridge only for true reset smoothing.
                if (restart && wasPlaying && smoothEnabled && smoothResetMs > 0) {
                    bridgeFrom = currentPose;
                }

                const playlist = this._characterGetCurrentAnimationPlaylist?.() || [];
                if (!playlist.length) {
                    // If user clicked while playing but playlist is empty, just stop.
                    try { this._characterStopCharacterLayerAnimations?.({ stopEngine: true }); } catch { }
                    return false;
                }
                return await this._characterPlayAnimationPresetSequenceOnElement(el, playlist, { restart: true, bridgeFrom });
            } catch {
                return false;
            }
        },

        async _characterAutoPlayAfterTaskIfNeeded({ taskId = null, imageData = null } = {}) {
            try {
                if (this.state.viewMode !== 'character') return;
                const el = this._characterGetCharacterLayerEl?.();
                if (!el || el.hidden) return;

                // Deduplicate per displayed image id (best-effort).
                const imgId = String(imageData?.id || '').trim();
                if (!this.state.character) this.state.character = {};
                if (imgId) {
                    const last = String(this.state.character._animLastAutoPlayImageId || '').trim();
                    if (last && last === imgId) return;
                    this.state.character._animLastAutoPlayImageId = imgId;
                }

                const playlist = this._characterGetCurrentAnimationPlaylist?.() || [];
                if (!playlist.length) return;

                // Task completion should restart from the beginning.
                await this._characterPlayCurrentCharacterLayerAnimations({ restart: true, reason: taskId ? `task:${taskId}` : 'task' });
            } catch { }
        },
    });
})();
