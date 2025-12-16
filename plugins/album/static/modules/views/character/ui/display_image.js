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

        _characterGetCharacterLayerEl() {
            try {
                const root = this.contentArea?.querySelector('.plugin-album__character-view');
                return root?.querySelector?.('.plugin-album__character-layer--char') || null;
            } catch {
                return null;
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

        async _characterPlayAnimationPresetSequenceOnElement(el, presetKeys, { restart = true, bridgeFrom = null } = {}) {
            if (!el) return false;
            const keys = (Array.isArray(presetKeys) ? presetKeys : [])
                .map(k => String(k || '').trim())
                .filter(Boolean);
            if (!keys.length) return false;

            if (!this.state.character) this.state.character = {};
            const pb = this.state.character._animPlayback || (this.state.character._animPlayback = {});
            if (restart) {
                pb.token = (pb.token || 0) + 1;
            }
            const token = pb.token || 0;
            pb.isPlaying = true;

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

            // Always start from a clean baseline.
            try { engine.stop(el); } catch { }

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
                            await sleep(smoothResetMs);
                            if (isCancelled()) return false;
                            engine.stop(el);
                        } catch { }
                    }
                    didBridge = true;

                    // IMPORTANT: do NOT apply end-smoothing on every preset in a playlist.
                    // We'll only smooth-return to default once, at the end of the whole list.
                    const dur = engine.getPresetDurationMs(preset) || 1000;

                    // Non-looped + non-seamless: each clip starts from baseline.
                    engine.applyPresetOnElement(el, preset, { loop: false, seamless: false });
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
                                await sleep(smoothResetMs);
                                if (isCancelled()) return false;
                            }
                        } catch { }
                    }
                } catch {
                    // Only stop if this run still owns the element.
                    if (!isCancelled()) {
                        try { engine.stop(el); } catch { }
                    }
                }
            }

            // After the final preset: smooth-return to defaults ONCE (optional).
            if (!isCancelled() && smoothEnabled && smoothEndMs > 0 && typeof engine.makeTransitionPreset === 'function') {
                try {
                    const endPose = (typeof engine.getCurrentTrackValues === 'function')
                        ? engine.getCurrentTrackValues(el)
                        : null;
                    const def = { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
                    if (endPose && !posesEqual(endPose, def)) {
                        const back = engine.makeTransitionPreset(endPose, def, smoothEndMs, { graphType: 'linear' });
                        engine.applyPresetOnElement(el, back, { loop: false, seamless: false });
                        await sleep(smoothEndMs);
                        if (isCancelled()) return false;
                    }
                } catch { }
            }

            // Restore defaults after playlist ends.
            if (!isCancelled()) {
                try { engine.stop(el); } catch { }
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
