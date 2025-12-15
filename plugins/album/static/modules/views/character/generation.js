// Album plugin - View module: character view (Generation)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        async _characterStartGeneration({ forceNew = true, presetId = null, auto = false, silent = false } = {}) {
            // Back-compat: older call sites may pass flags via the first argument object
            auto = !!(auto || arguments?.[0]?.auto);
            silent = !!(silent || arguments?.[0]?.silent);
            const characterHash = this.state?.selectedCharacter?.hash;
            if (!characterHash) return;
            const resolvedPresetId = presetId || this._characterResolveActivePresetId();
            if (!resolvedPresetId) {
                showError('Hãy chọn ít nhất một tags group để bắt đầu.');
                return;
            }

            // Enforce per-category / per-group auto toggles
            if (auto && !this._characterIsAutoAllowedForPresetId(resolvedPresetId)) {
                return;
            }

            // If this is user/manual generation, cancel any running auto task immediately.
            if (!auto) {
                try {
                    await this._characterCancelRunningAutoTask({ silent: true, suspend: true });
                } catch {}
            }

            // User intent: switching to a selection that needs a new image should preempt
            // any currently running manual/unknown task for this character.
            if (!auto) {
                try {
                    if (this._characterHasRunningNonAutoTask()) {
                        await this._characterCancelRunningNonAutoTask({ silent: true });
                    }
                } catch {}
            }

            // Manual generation triggered while current preset has no images: set a guard so auto scheduler
            // doesn't immediately start another task on the same preset before image:added updates state.
            if (!auto) {
                try {
                    const pregen = this.state.character.pregen || (this.state.character.pregen = {});
                    if (this._characterGetImagesForPreset(resolvedPresetId).length === 0) {
                        pregen.manualFillPresetId = resolvedPresetId;
                        pregen.manualFillSetAt = Date.now();
                    } else if (String(pregen.manualFillPresetId || '').trim() === String(resolvedPresetId)) {
                        pregen.manualFillPresetId = null;
                    }
                } catch {}
            }

            // For auto requests: defer while a manual/unknown task is running.
            // For manual requests: we already canceled running manual tasks above.
            if (auto && this._characterHasRunningNonAutoTask()) {
                return;
            }

            // Only allow one auto task at a time.
            if (auto && this._characterHasRunningAutoTask()) {
                return;
            }

            // Enforce per-session auto image cap
            if (auto) {
                const pregen = this.state.character.pregen || {};
                const maxImages = this._CHAR_AUTO_MAX_IMAGES_PER_SESSION || 100;
                if ((pregen.sessionAutoImagesStarted || 0) >= maxImages) return;
            }

            // Build prompt parts from selected tag groups.
            // For auto scheduling, we may generate for a preset that is not currently selected.
            // In State mode, selections live in `state.character.state.*` and are encoded into the resolved preset id (auto:g:...).
            const isStateMode = (typeof this._characterIsStateModeEnabled === 'function')
                ? !!this._characterIsStateModeEnabled()
                : (String(this.state.character?.ui?.menuMode || '').trim().toLowerCase() === 'state');
            const rawSelections = (auto || isStateMode)
                ? this._characterGetSelectionsForPresetId(resolvedPresetId)
                : (this.state.character.selections || {});
            // Visual Novel mode: background category selection does not affect character layer.
            const selections = (typeof this._characterFilterSelectionsForCharacterLayer === 'function')
                ? this._characterFilterSelectionsForCharacterLayer(rawSelections)
                : rawSelections;
            const tg = this.state.character.tagGroups?.flat || {};
            const joinTags = (groupId) => {
                const g = tg[groupId];
                if (!g || !Array.isArray(g.tags)) return '';
                return g.tags.map(t => String(t).trim()).filter(Boolean).join(', ');
            };

            const joinNegativeTags = (groupId) => {
                const g = tg[groupId];
                if (!g) return '';
                const arr = Array.isArray(g.negative_tags)
                    ? g.negative_tags
                    : (Array.isArray(g.negativeTags) ? g.negativeTags : []);
                if (!Array.isArray(arr) || !arr.length) return '';
                return arr.map(t => String(t).trim()).filter(Boolean).join(', ');
            };

            const splitTags = (text) => String(text || '')
                .split(',')
                .map(s => String(s || '').trim())
                .filter(Boolean);

            // Visual Novel mode: skip background category in character-layer prompt aggregation.
            let cats = this._characterGetCategoryNames();
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bgCat = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bgCat) {
                        const bgLower = String(bgCat).trim().toLowerCase();
                        cats = (cats || []).filter(c => String(c || '').trim().toLowerCase() !== bgLower);
                    }
                }
            } catch { }
            const extraCats = cats.filter(c => !['Outfits', 'Expression', 'Action', 'Context'].includes(c));
            const extraText = extraCats
                .map(c => joinTags(selections[c]))
                .map(s => String(s || '').trim())
                .filter(Boolean)
                .join(', ');

            const contextBase = joinTags(selections.Context);
            const mergedContext = [contextBase, extraText].filter(Boolean).join(', ');

            const overrides = {
                outfits: joinTags(selections.Outfits),
                expression: joinTags(selections.Expression),
                action: joinTags(selections.Action),
                context: mergedContext,
                album_character_view_mode: 'character',
                album_character_preset_id: resolvedPresetId,
                album_character_preset_key: this._characterBuildPresetKeyFromSelections(selections),
            };

            // Aggregate negative tags from selected tag groups.
            // These are merged into the final `negative` prompt string right before starting the task.
            let negativeExtra = '';
            try {
                negativeExtra = Object.values(selections || {})
                    .map(v => String(v || '').trim())
                    .filter(v => v && v !== '__none__')
                    .map(gid => joinNegativeTags(gid))
                    .map(s => String(s || '').trim())
                    .filter(Boolean)
                    .join(', ');
            } catch {
                negativeExtra = '';
            }

            // Visual Novel mode: character layer uses alpha workflow by default.
            // NOTE: background layer generation is handled separately and does not set Alpha.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    overrides.Alpha = true;

                    // VN Character layer: user-configurable extra tags (default kept in settings).
                    const configured = String(this.state?.character?.settings?.character_layer_extra_tags || '').trim();
                    const bgHint = configured || 'simple background, gray background';
                    const existing = String(overrides.context || '').trim();

                    const splitTags = (text) => String(text || '')
                        .split(',')
                        .map(s => String(s || '').trim())
                        .filter(Boolean);

                    const existingTokens = new Set(splitTags(existing).map(t => t.toLowerCase()));
                    const extraTokens = splitTags(bgHint).filter(t => !existingTokens.has(t.toLowerCase()));
                    overrides.context = [existing, extraTokens.join(', ')].filter(Boolean).join(', ');
                }
            } catch { }

            // Explicit group-id list (canonical, category-independent)
            try {
                const ids = [];
                Object.values(selections || {}).forEach(v => {
                    const gid = String(v || '').trim();
                    if (!gid) return;
                    if (gid === '__none__') return;
                    ids.push(gid);
                });
                overrides.album_character_group_ids = Array.from(new Set(ids)).sort((a, b) => String(a).localeCompare(String(b)));
            } catch {}

            // For non-legacy categories, still record selection keys in config for downstream tooling
            try {
                overrides.album_character_category_selections = { ...selections };
            } catch {}

            // Use same generation endpoint as album
            try {
                const { last_config } = await this.api.album.get(`/comfyui/info?character_hash=${encodeURIComponent(characterHash)}&no_choices=true`);
                const payload = { ...last_config, ...overrides, character: this.state.selectedCharacter.name };
                if (payload.seed === undefined) payload.seed = 0;

                    // Merge negative tags from selected tag groups into the negative prompt.
                    try {
                        if (negativeExtra) {
                            const base = Array.isArray(payload.negative) ? payload.negative.join(', ') : (payload.negative ?? payload.Negative ?? '');
                            const baseTokens = splitTags(base);
                            const extraTokens = splitTags(negativeExtra);
                            const seen = new Set(baseTokens.map(t => t.toLowerCase()));
                            extraTokens.forEach(t => {
                                const k = t.toLowerCase();
                                if (!seen.has(k)) {
                                    baseTokens.push(t);
                                    seen.add(k);
                                }
                            });
                            payload.negative = baseTokens.join(', ');
                        }
                    } catch { }

                // Ensure alpha flag reaches workflow builder + metadata (VN mode)
                try {
                    if (overrides.Alpha === true) {
                        payload.Alpha = true;
                    }
                } catch { }

                // Cap auto tasks per session by image count (batch_size aware)
                if (auto) {
                    const pregen = this.state.character.pregen || (this.state.character.pregen = {});
                    const maxImages = this._CHAR_AUTO_MAX_IMAGES_PER_SESSION || 100;
                    let batchSize = Number(payload.batch_size ?? payload.batchSize ?? 1);
                    if (!Number.isFinite(batchSize) || batchSize <= 0) batchSize = 1;
                    if ((pregen.sessionAutoImagesStarted || 0) + batchSize > maxImages) {
                        return;
                    }
                    // Reserve budget when the task is successfully started (below)
                }

                const context = {
                    source: 'album.character',
                    viewMode: 'character',
                    preset_id: resolvedPresetId,
                    auto: !!auto,
                };

                try {
                    if (payload.Alpha === true) {
                        context.alpha = true;
                        context.Alpha = true;
                    }
                } catch { }

                // VN mode routing: character layer should use alpha route only while VN mode is enabled.
                // When VN is disabled, aggressively strip alpha hints so the worker doesn't get "stuck"
                // on the alpha endpoint due to stale last_config/workflow fields.
                let vnEnabledNow = false;
                try {
                    vnEnabledNow = (typeof this._characterIsVisualNovelModeEnabled === 'function')
                        ? !!this._characterIsVisualNovelModeEnabled()
                        : true;
                } catch {
                    vnEnabledNow = true;
                }

                if (!vnEnabledNow) {
                    try { delete payload.Alpha; } catch { }
                    try { delete payload.alpha; } catch { }
                    try { delete payload.is_alpha; } catch { }
                    try { delete payload.isAlpha; } catch { }
                    try { delete payload.use_alpha; } catch { }
                    try { delete payload.useAlpha; } catch { }

                    try { delete context.Alpha; } catch { }
                    try { delete context.alpha; } catch { }

                    // If the previously used workflow identifiers include "alpha", drop them.
                    // This prevents the heuristic from selecting alpha route based on stale workflow_type/template.
                    try {
                        const wt = String(payload.workflow_type || payload._workflow_type || '').trim().toLowerCase();
                        if (wt && wt.includes('alpha')) {
                            payload.workflow_type = 'standard';
                            try { delete payload._workflow_type; } catch { }
                        }
                    } catch { }
                    try {
                        const wft = String(payload.workflow_template || payload._workflow_template || '').trim().toLowerCase();
                        if (wft && wft.includes('alpha')) {
                            try { delete payload.workflow_template; } catch { }
                            try { delete payload._workflow_template; } catch { }
                        }
                    } catch { }
                }

                // Keep backward-compatible startAlpha hook if host provides it, but do not rely on it.
                const wantsAlpha = !!(vnEnabledNow && this._shouldUseAlphaGenerationRoute && this._shouldUseAlphaGenerationRoute(payload, context));
                const startFn = (wantsAlpha && this.api?.generation?.startAlpha) ? this.api.generation.startAlpha : this.api.generation.start;
                const response = await startFn(characterHash, payload, context);

                // Count auto images per session after successful task start
                if (auto) {
                    try {
                        const pregen = this.state.character.pregen || (this.state.character.pregen = {});
                        let batchSize = Number(payload.batch_size ?? payload.batchSize ?? 1);
                        if (!Number.isFinite(batchSize) || batchSize <= 0) batchSize = 1;
                        pregen.sessionAutoImagesStarted = (pregen.sessionAutoImagesStarted || 0) + batchSize;

                        // Track last auto preset to prevent immediate repeats across scheduling cycles.
                        pregen.lastAutoPresetId = resolvedPresetId;
                        pregen.lastAutoPickedAt = Date.now();
                    } catch {}
                }

                // Track meta locally so we can differentiate manual vs auto tasks later.
                const taskId = response?.task_id || response?.taskId;
                if (taskId) {
                    this._characterTaskMeta.set(String(taskId), {
                        isAuto: !!auto,
                        presetId: resolvedPresetId,
                        characterHash,
                    });
                    try { Yuuka.events.emit('generation:task_created_locally', response); } catch {}

                    // If this was a manual fill triggered from a category submenu, mark the selected item as generating immediately.
                    if (!auto) {
                        try { this._characterMarkActiveCategorySelectionGenerating(resolvedPresetId); } catch {}
                    }
                }

                return response || null;
            } catch (err) {
                if (!silent) showError(`Bắt đầu thất bại: ${err.message}`);
                return null;
            }
        },

        async _characterStartVNBackgroundGeneration({ groupId, auto = true, silent = true } = {}) {
            const characterHash = this.state?.selectedCharacter?.hash;
            if (!characterHash) return null;
            if (typeof this._characterIsVisualNovelModeEnabled === 'function' && !this._characterIsVisualNovelModeEnabled()) return null;

            const gid = String(groupId || '').trim();
            if (!gid) return null;

            const tg = this.state.character?.tagGroups?.flat || {};
            const g = tg[gid];
            const tags = (g && Array.isArray(g.tags)) ? g.tags.map(t => String(t).trim()).filter(Boolean).join(', ') : '';
            if (!tags) return null;

            const mergeTags = (baseText, extraText) => {
                const splitTags = (text) => String(text || '')
                    .split(',')
                    .map(s => String(s || '').trim())
                    .filter(Boolean);
                const baseTokens = splitTags(baseText);
                const extraTokens = splitTags(extraText);
                const seen = new Set(baseTokens.map(t => t.toLowerCase()));
                extraTokens.forEach(t => {
                    const k = t.toLowerCase();
                    if (!seen.has(k)) {
                        baseTokens.push(t);
                        seen.add(k);
                    }
                });
                return baseTokens.join(', ');
            };

            try {
                // Store BG images into a dedicated per-user album named "Background"
                // and also use that album's config as the base (so we don't inherit
                // LoRA/workflow settings from the currently selected character).
                let bgAlbumHash = null;
                try {
                    const resp = await this.api.album.get('/character/vn/background_album');
                    bgAlbumHash = String(resp?.hash || resp?.character_hash || '').trim();
                } catch { }
                const targetHash = bgAlbumHash || '';

                // If targetHash is empty, backend returns global/default config.
                const qs = targetHash
                    ? `character_hash=${encodeURIComponent(targetHash)}&no_choices=true`
                    : 'no_choices=true';

                const { last_config } = await this.api.album.get(`/comfyui/info?${qs}`);

                const toLandscapeSize = (cfg) => {
                    const w = Number(cfg?.width);
                    const h = Number(cfg?.height);
                    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
                    if (w >= h) return { width: Math.round(w), height: Math.round(h) };
                    return { width: Math.round(h), height: Math.round(w) };
                };

                const stripLoraFields = (payload) => {
                    if (!payload || typeof payload !== 'object') return;
                    Object.keys(payload).forEach((k) => {
                        const key = String(k || '').trim();
                        if (!key) return;
                        if (key === 'lora_name' || key.startsWith('lora_')) {
                            try { delete payload[key]; } catch { }
                        }
                    });

                    // Legacy / workflow forcing fields
                    try { delete payload.multi_lora_prompt_tags; } catch { }
                    try { delete payload.multi_lora_prompt_tag; } catch { }
                    try { delete payload.workflow_template; } catch { }
                    try { delete payload._workflow_template; } catch { }
                    try { delete payload._workflow_type; } catch { }
                    // If workflow_type forces LoRA, drop it.
                    try {
                        const wt = String(payload.workflow_type || '').trim().toLowerCase();
                        if (!wt || wt.includes('lora')) delete payload.workflow_type;
                    } catch {
                        try { delete payload.workflow_type; } catch { }
                    }
                };

                const overrides = {
                    character: '',
                    outfits: '',
                    expression: '',
                    action: '',
                    context: mergeTags(tags, String(this.state?.character?.settings?.background_layer_extra_tags || '').trim()),
                    album_vn_layer: 'bg',
                    album_vn_bg_group_id: gid,
                    album_character_view_mode: 'character',
                };
                const payload = { ...last_config, ...overrides };
                if (payload.seed === undefined) payload.seed = 0;

                // VN BG layer: force landscape size (swap width/height if portrait)
                try {
                    const s = toLandscapeSize(payload);
                    if (s) {
                        payload.width = s.width;
                        payload.height = s.height;
                    }
                } catch { }

                // VN BG layer: ignore LoRA (global BG cache should not depend on LoRA)
                try { stripLoraFields(payload); } catch { }

                // Ensure alpha is NOT enabled for backgrounds
                try { delete payload.Alpha; } catch { }
                try { delete payload.alpha; } catch { }

                const context = {
                    source: 'album.character.vn.bg',
                    viewMode: 'character',
                    auto: !!auto,
                    vn_layer: 'bg',
                    album_vn_bg_group_id: gid,
                };

                // Persist BG images under Background album (fallback to current character if missing)
                const finalTargetHash = bgAlbumHash || characterHash;
                context.vn_bg_album_hash = targetHash;

                const response = await this.api.generation.start(finalTargetHash, payload, context);
                const taskId = response?.task_id || response?.taskId;
                if (taskId) {
                    this._characterTaskMeta.set(String(taskId), {
                        isAuto: !!auto,
                        presetId: `vn:bg:${gid}`,
                        characterHash,
                        vnLayer: 'bg',
                        bgGroupId: gid,
                    });
                    try { Yuuka.events.emit('generation:task_created_locally', response); } catch {}
                }
                return response || null;
            } catch (err) {
                if (!silent) showError(`Bắt đầu thất bại: ${err.message}`);
                return null;
            }
        },

        _characterOnImageAdded(taskId, imageData) {
            // Visual Novel mode: background images (album_vn_layer=bg) are stored globally per user.
            try {
                const cfg = imageData?.generationConfig || {};
                const layer = String(cfg?.album_vn_layer || '').trim().toLowerCase();
                const gid = String(cfg?.album_vn_bg_group_id || '').trim();
                if (layer === 'bg' && gid) {
                    try { this._characterVNUpsertBackgroundCache?.(gid, imageData); } catch { }

                    // Also track BG images in-session for availability checks.
                    try {
                        this._characterEnsureVNState?.();
                        const ctx = (cfg && typeof cfg === 'object') ? (cfg.context ?? cfg.Context) : null;
                        const k = this._characterVNNormalizeContextKey?.(ctx);
                        if (k) {
                            const set = this.state.character.vn.bgAvailableContextKeys;
                            if (set && typeof set.add === 'function') {
                                set.add(k);
                            } else {
                                this.state.character.vn.bgAvailableContextKeys = new Set([k]);
                            }
                            this.state.character.vn.bgAvailableKeysLoadedAt = Date.now();
                        }
                    } catch { }

                    try {
                        this.api.album.post('/character/vn/backgrounds', {
                            group_id: gid,
                            url: imageData?.url || imageData?.src,
                            pv_url: imageData?.pv_url || imageData?.pvUrl || imageData?.preview_url || imageData?.previewUrl,
                            image_id: imageData?.id,
                            album_hash: imageData?.character_hash || imageData?.characterHash,
                            createdAt: imageData?.createdAt,
                        });
                    } catch { }
                    try { this._characterRefreshDisplayedImage(); } catch { }
                    return;
                }
            } catch { }

            // If image belongs to current preset, display immediately.
            const presetId = this._characterResolveActivePresetId();
            const cfg = imageData?.generationConfig || {};
            const ref = cfg?.album_character_preset_id;

            // If we were waiting for a manual fill image, clear the guard once the first image arrives.
            try {
                const pregen = this.state.character.pregen || {};
                if (pregen.manualFillPresetId && String(pregen.manualFillPresetId) === String(ref)) {
                    pregen.manualFillPresetId = null;
                }
            } catch {}

            if (presetId && ref && String(ref) === String(presetId)) {
                this._characterRefreshDisplayedImage();
                return;
            }

            // If current preset matches by selection-key fallback (saved preset reusing auto images), refresh.
            if (presetId && !ref) {
                const key = cfg?.album_character_preset_key;
                if (key && presetId === `auto:${key}`) {
                    this._characterRefreshDisplayedImage();
                    return;
                }
            }
        },
    });
})();
