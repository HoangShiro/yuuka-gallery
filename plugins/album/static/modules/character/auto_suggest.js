(function () {
    // Module: Character-view auto-suggest presets (session-only)
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    const nowMs = () => Date.now();

    const safeNum = (v, fallback = 0) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const normalizeTag = (raw) => {
        let s = String(raw || '').trim().toLowerCase();
        if (!s) return '';
        // Remove common prompt wrappers/weights: (tag:1.2) -> tag
        // Keep it conservative: strip outer parens/brackets and trailing weight blocks.
        s = s.replace(/^\(+|\)+$/g, '');
        s = s.replace(/^\[+|\]+$/g, '');
        // (foo:1.2) or foo:1.2 -> foo
        s = s.replace(/^(.+?):\s*[-+]?\d+(?:\.\d+)?$/g, '$1');
        // Drop lora tokens like <lora:xxx:1>
        if (s.startsWith('<lora:')) return '';
        // Collapse whitespace
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    };

    const splitTagsFromText = (text) => {
        const raw = String(text || '');
        if (!raw.trim()) return [];
        return raw
            .split(/[\n,]/g)
            .map(t => normalizeTag(t))
            .filter(Boolean);
    };

    const recencyWeight = (createdAtMs, { halfLifeDays = 14, minWeight = 0.15 } = {}) => {
        const t = safeNum(createdAtMs, 0);
        if (!t) return 1;
        const ageMs = Math.max(0, nowMs() - t);
        const halfLifeMs = Math.max(1, safeNum(halfLifeDays, 14) * 24 * 60 * 60 * 1000);
        // Exponential decay by half-life: w = 0.5^(age/halfLife)
        const w = Math.pow(0.5, ageMs / halfLifeMs);
        return Math.max(safeNum(minWeight, 0.15), Math.min(1, w));
    };

    const _safeCountFromResponse = (resp) => {
        // Best-effort: backend/capability may expose different shapes.
        // Return number when known, otherwise null.
        const candidates = [
            resp?.total,
            resp?.total_images,
            resp?.totalImages,
            resp?.total_items,
            resp?.totalItems,
            resp?.count,
            resp?.image_count,
            resp?.imageCount,
        ];
        for (const v of candidates) {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) return n;
        }
        return null;
    };

    proto._characterAutoSuggestEnsureModel = function () {
        if (!this.state?.character) return null;
        const charHash = String(this.state?.selectedCharacter?.hash || '').trim();
        const existing = this.state.character.autoSuggestModel;

        // Global model: keep the same stats across character albums.
        if (existing && typeof existing === 'object' && String(existing.scope || '') === 'global') {
            existing.lastSeenCharHash = charHash;
            return existing;
        }

        const model = {
            scope: 'global',
            lastSeenCharHash: charHash,
            isBootstrapping: false,
            bootstrapped: false,
            lastBootstrapAt: 0,
            lastUpdatedAt: 0,
            totalImagesSeen: 0,
            groupCounts: {},
            keyCounts: {},
            // Session-stable randomness (used only for categories with no signal)
            randomSeed: (nowMs() >>> 0),
            randomFallbackByCategory: {},
            debugStats: {
                // Session-only; overwritten on each bootstrap.
                userTotalImages: null,
                userSavedPresetCount: 0,
                metadataReadCount: 0,
                sampledTagsCount: 0,
            },
        };
        this.state.character.autoSuggestModel = model;
        if (!Array.isArray(this.state.character.autoSuggestPresets)) {
            this.state.character.autoSuggestPresets = [];
        }
        return model;
    };

    proto._characterAutoSuggestGetGroupIdsFromKey = function (key) {
        try {
            const k = String(key || '').trim();
            if (!k) return [];
            const selMap = this._characterParsePresetKeyToSelectionMap(k);
            const ids = (selMap && typeof selMap === 'object')
                ? Object.values(selMap).map(v => String(v || '').trim()).filter(Boolean)
                : [];
            return Array.from(new Set(ids.filter(v => v !== '__none__')));
        } catch {
            return [];
        }
    };

    proto._characterAutoSuggestGetRequiredCategoryNames = function () {
        // "Required" categories are those that actually have tag groups defined.
        // This keeps behavior stable even if a user has fewer categories/groups.
        try {
            const cats = this._characterGetCategoryNames();
            const grouped = this.state?.character?.tagGroups?.grouped || {};
            let out = (Array.isArray(cats) ? cats : []).filter((cat) => {
                const arr = grouped?.[cat];
                return Array.isArray(arr) && arr.length > 0;
            });

            // VN mode: background category is per-character and should not participate in
            // character-layer preset suggestion keys.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bg) {
                        const bgLower = String(bg).trim().toLowerCase();
                        out = out.filter(c => String(c || '').trim().toLowerCase() !== bgLower);
                    }
                }
            } catch { }

            return out;
        } catch {
            return [];
        }
    };

    proto._characterAutoSuggestHash32 = function (text) {
        // Simple stable 32-bit hash (not cryptographic)
        const s = String(text || '');
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            // FNV-1a 32-bit
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0);
    };

    proto._characterAutoSuggestPickBestGroupIdForCategory = function (categoryName, model) {
        try {
            const cat = String(categoryName || '').trim();
            if (!cat) return null;
            const grouped = this.state?.character?.tagGroups?.grouped || {};
            const flat = this.state?.character?.tagGroups?.flat || {};
            const groups = Array.isArray(grouped?.[cat]) ? grouped[cat] : [];
            if (!groups.length) return null;

            const candidates = groups
                .map(g => String(g?.id || '').trim())
                .filter(Boolean)
                .filter(id => id !== '__none__')
                .filter(id => !!flat[id])
                .map((id, idx) => ({ id, idx, c: safeNum(model?.groupCounts?.[id], 0) }));

            if (!candidates.length) return null;

            // If there's no signal (no image data for this category), pick a random group.
            // Keep it stable within a session by caching per category.
            let maxCount = 0;
            for (const x of candidates) maxCount = Math.max(maxCount, safeNum(x.c, 0));
            if (maxCount <= 0) {
                const cache = (model && typeof model === 'object') ? (model.randomFallbackByCategory || (model.randomFallbackByCategory = {})) : {};
                const cacheKey = cat.toLowerCase();
                const cached = String(cache?.[cacheKey] || '').trim();
                if (cached && candidates.some(x => x.id === cached)) return cached;

                const seed = (model && typeof model === 'object') ? (Number(model.randomSeed) >>> 0) : (nowMs() >>> 0);
                const h = this._characterAutoSuggestHash32(cacheKey);
                const idx = (candidates.length > 0) ? ((seed ^ h) % candidates.length) : 0;
                const picked = candidates[Math.max(0, idx)]?.id || candidates[0]?.id || null;
                if (picked) cache[cacheKey] = picked;
                return picked;
            }

            // Prefer highest count; on ties keep original order.
            candidates.sort((a, b) => {
                if (a.c !== b.c) return b.c - a.c;
                return a.idx - b.idx;
            });

            return candidates[0].id || null;
        } catch {
            return null;
        }
    };

    proto._characterAutoSuggestNormalizeKeyToFullCoverage = function (key, model) {
        // Convert any key into a selection that covers all required categories.
        // Missing categories are filled with the best (most-used) group in that category,
        // falling back to the first group (stable order).
        try {
            const k = String(key || '').trim();
            if (!k) return '';

            const requiredCats = this._characterAutoSuggestGetRequiredCategoryNames();
            if (!requiredCats.length) return k;

            const flat = this.state?.character?.tagGroups?.flat || {};
            const selMapLower = this._characterParsePresetKeyToSelectionMap(k) || {};

            const outSel = {};
            for (const cat of requiredCats) {
                const lower = String(cat || '').trim().toLowerCase();
                let gid = String(selMapLower?.[lower] || '').trim();
                if (!gid || gid === '__none__' || !flat[gid]) gid = '';
                if (!gid) {
                    const best = this._characterAutoSuggestPickBestGroupIdForCategory(cat, model);
                    if (best) gid = String(best).trim();
                }
                outSel[cat] = gid || null;
            }

            const fullKey = this._characterBuildPresetKeyFromSelections(outSel);
            return String(fullKey || '').trim() || k;
        } catch {
            return String(key || '').trim();
        }
    };

    proto._characterAutoSuggestDebugLog = function (phase, extra = {}) {
        try {
            if (this.state?.viewMode !== 'character') return;

            const model = this._characterAutoSuggestEnsureModel();
            if (!model) return;

            const selectedHash = String(this.state?.selectedCharacter?.hash || '').trim();
            const userSavedPresets = Array.isArray(this.state?.character?.presets) ? this.state.character.presets : [];

            const ds = model.debugStats || {};
            const userTotalImages = (ds.userTotalImages != null) ? ds.userTotalImages : null;
            const metadataReadCount = safeNum(ds.metadataReadCount, 0);
            const sampledTagsCount = safeNum(ds.sampledTagsCount, 0);
            const userSavedPresetCount = safeNum(ds.userSavedPresetCount, userSavedPresets.length);

            const inferredTagGroupsCount = Object.keys(model.groupCounts || {}).length;
            const autoPresets = Array.isArray(this.state?.character?.autoSuggestPresets)
                ? this.state.character.autoSuggestPresets
                : [];
            const autoPresetCount = autoPresets.length;

            const header = `[Album][AutoSuggest][${phase}] scope=${String(model.scope || 'unknown')} char=${selectedHash || '(none)'}`;
            if (console.groupCollapsed) console.groupCollapsed(header);
            else console.log(header);

            console.debug('[Album][AutoSuggest] Summary', {
                phase,
                scope: String(model.scope || 'unknown'),
                charHash: selectedHash,
                user_total_images: userTotalImages,
                user_saved_preset_count: userSavedPresetCount,
                metadata_read_count: metadataReadCount,
                sampled_tags_count: sampledTagsCount,
                inferred_tag_group_count: inferredTagGroupsCount,
                auto_suggest_preset_count: autoPresetCount,
                model_total_images_seen: safeNum(model.totalImagesSeen, 0),
                model_distinct_keys_seen: Object.keys(model.keyCounts || {}).length,
                ...extra,
            });

            // Per-auto-preset tag-group count
            const rows = autoPresets.map((p, idx) => {
                const key = String(p?.key || '').trim();
                const ids = this._characterAutoSuggestGetGroupIdsFromKey(key);
                return {
                    rank: idx + 1,
                    score: safeNum(p?.score, 0),
                    key,
                    tag_group_count: ids.length,
                };
            });
            if (rows.length && console.table) console.table(rows);
            else console.debug('[Album][AutoSuggest] Presets', rows);

            if (console.groupEnd) console.groupEnd();
        } catch (err) {
            console.warn('[Album] _characterAutoSuggestDebugLog error:', err);
        }
    };

    proto._characterAutoSuggestRefreshPresetSubmenu = function () {
        try {
            if (this.state?.viewMode !== 'character') return;
            if (String(this.state?.character?.activeMenu || '').trim() !== 'Preset') return;
            const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
            const toolbarHost = submenu?.querySelector('.plugin-album__character-submenu-toolbar');
            const list = submenu?.querySelector('.plugin-album__character-submenu-list');
            if (!submenu || !toolbarHost || !list) return;
            if (submenu.hidden) return;
            toolbarHost.innerHTML = '';
            list.innerHTML = '';
            this._characterRenderPresetList(toolbarHost, list);
        } catch (err) {
            console.warn('[Album] _characterAutoSuggestRefreshPresetSubmenu error:', err);
        }
    };

    proto._characterAutoSuggestExtractObservation = function (imageLike) {
        try {
            const item = imageLike || {};
            const raw = item.raw || item;
            const cfg = raw?.generationConfig || raw?.generation_config || raw?.config || {};

            const imgCharHash = String(item.character_hash || raw?.character_hash || cfg?.character_hash || '').trim();
            if (!imgCharHash) return null;

            let groupIds = [];

            // Prefer explicit group id list
            try {
                const gids = cfg?.album_character_group_ids;
                if (Array.isArray(gids) && gids.length) {
                    groupIds = gids.slice();
                }
            } catch {}

            // Fallback: category selections map
            if (!groupIds.length) {
                try {
                    const sel = cfg?.album_character_category_selections;
                    if (sel && typeof sel === 'object') {
                        groupIds = Object.values(sel);
                    }
                } catch {}
            }

            // Fallback: preset key
            if (!groupIds.length) {
                const keyRaw = String(cfg?.album_character_preset_key || '').trim();
                if (keyRaw) {
                    const selMap = this._characterParsePresetKeyToSelectionMap(keyRaw);
                    if (selMap && typeof selMap === 'object') {
                        groupIds = Object.values(selMap);
                    }
                }
            }

            if (!groupIds.length) return null;

            const flat = this.state?.character?.tagGroups?.flat || {};
            const cleaned = Array.from(new Set(groupIds
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .filter(v => v !== '__none__')
                .filter(v => !!flat[v])));

            if (!cleaned.length) return null;

            const sel = {};
            cleaned.forEach((v, i) => { sel[`_${i}`] = v; });
            const key = this._characterBuildPresetKeyFromSelections(sel);
            if (!key) return null;

            return { key, groupIds: cleaned };
        } catch {
            return null;
        }
    };

    proto._characterAutoSuggestExtractPromptTags = function (imageLike) {
        try {
            const item = imageLike || {};
            const raw = item.raw || item;
            const cfg = raw?.generationConfig || raw?.generation_config || raw?.config || {};

            const parts = [];

            // Common config fields
            parts.push(cfg.prompt);
            parts.push(cfg.positive);
            parts.push(cfg.outfits);
            parts.push(cfg.expression);
            parts.push(cfg.action);
            parts.push(cfg.context);

            // Capability-normalized shape
            const prompts = item.prompts || {};
            parts.push(prompts.positive);
            parts.push(prompts.outfits);
            parts.push(prompts.expression);
            parts.push(prompts.action);
            parts.push(prompts.context);

            const tags = new Set();
            parts.forEach((p) => {
                splitTagsFromText(p).forEach((t) => tags.add(t));
            });

            // Also accept explicit arrays
            try {
                const maybeArr = cfg.tags || cfg.prompt_tags || cfg.promptTags;
                if (Array.isArray(maybeArr)) {
                    maybeArr.map(normalizeTag).filter(Boolean).forEach((t) => tags.add(t));
                }
            } catch {}

            return tags;
        } catch {
            return new Set();
        }
    };

    proto._characterAutoSuggestInferSelectionFromTags = function (promptTags) {
        try {
            const tags = (promptTags instanceof Set) ? promptTags : new Set();
            if (!tags.size) return null;

            const cats = this._characterGetCategoryNames();
            const grouped = this.state?.character?.tagGroups?.grouped || {};

            const selection = {};
            let pickedAny = false;

            for (const cat of cats) {
                const groups = Array.isArray(grouped?.[cat]) ? grouped[cat] : [];
                const candidates = [];

                for (const g of groups) {
                    const gid = String(g?.id || '').trim();
                    if (!gid) continue;

                    const gTags = Array.isArray(g?.tags) ? g.tags : [];
                    const normGroupTags = gTags.map(normalizeTag).filter(Boolean);
                    if (!normGroupTags.length) continue;

                    let hit = 0;
                    for (const t of normGroupTags) {
                        if (tags.has(t)) hit += 1;
                    }

                    if (!hit) continue;
                    const denom = Math.max(1, normGroupTags.length);
                    const ratio = hit / denom;
                    candidates.push({ gid, hit, ratio, denom });
                }

                if (!candidates.length) {
                    selection[cat] = null;
                    continue;
                }

                // Pick the best match; require a minimum ratio to avoid noisy inference.
                candidates.sort((a, b) => {
                    if (a.hit !== b.hit) return b.hit - a.hit;
                    if (a.ratio !== b.ratio) return b.ratio - a.ratio;
                    return a.denom - b.denom;
                });

                const best = candidates[0];
                const minRatio = 0.34;
                const minHits = 2;
                const ok = (best.ratio >= minRatio) || (best.hit >= minHits);
                if (!ok) {
                    selection[cat] = null;
                    continue;
                }

                selection[cat] = best.gid;
                pickedAny = true;
            }

            if (!pickedAny) return null;
            return selection;
        } catch {
            return null;
        }
    };

    proto._characterAutoSuggestExtractObservationWithFallback = function (imageLike) {
        // 1) Prefer explicit album_character_* fields
        const direct = this._characterAutoSuggestExtractObservation(imageLike);
        if (direct) return direct;

        // 2) Fallback: infer from prompt tags (older images)
        try {
            const item = imageLike || {};
            const raw = item.raw || item;
            const cfg = raw?.generationConfig || raw?.generation_config || raw?.config || {};
            const imgCharHash = String(item.character_hash || raw?.character_hash || cfg?.character_hash || '').trim();
            if (!imgCharHash) return null;

            const tags = this._characterAutoSuggestExtractPromptTags(imageLike);
            if (!tags || !tags.size) return null;

            const selection = this._characterAutoSuggestInferSelectionFromTags(tags);
            if (!selection) return null;

            // Build a canonical key from inferred group ids
            const key = this._characterBuildPresetKeyFromSelections(selection);
            if (!key) return null;

            // Collect group ids for scoring
            const groupIds = Array.from(new Set(Object.values(selection)
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .filter(v => v !== '__none__')));

            if (!groupIds.length) return null;
            return { key, groupIds };
        } catch {
            return null;
        }
    };

    proto._characterAutoSuggestKeyAllGroupIdsExist = function (key) {
        try {
            const raw = String(key || '').trim();
            if (!raw) return false;
            const flat = this.state?.character?.tagGroups?.flat || {};

            const decode = (s) => {
                try { return decodeURIComponent(String(s || '').trim()); } catch { return String(s || '').trim(); }
            };

            const ids = [];

            if (raw.startsWith('g:')) {
                const body = raw.slice('g:'.length);
                body.split('|').map(s => decode(s)).forEach((v) => {
                    const gid = String(v || '').trim();
                    if (!gid || gid === '__none__') return;
                    ids.push(gid);
                });
            } else if (raw.includes('=')) {
                raw.split('|').forEach((partRaw) => {
                    const part = String(partRaw || '').trim();
                    const idx = part.indexOf('=');
                    if (idx <= 0) return;
                    const v = decode(part.slice(idx + 1));
                    const gid = String(v || '').trim();
                    if (!gid || gid === '__none__') return;
                    ids.push(gid);
                });
            } else {
                raw.split('|').map(s => decode(s)).forEach((v) => {
                    const gid = String(v || '').trim();
                    if (!gid || gid === '__none__') return;
                    ids.push(gid);
                });
            }

            if (!ids.length) return false;
            for (const gid of ids) {
                if (!flat[gid]) return false;
            }
            return true;
        } catch {
            return false;
        }
    };

    proto._characterAutoSuggestAddObservation = function (obs, { weight = 1 } = {}) {
        const model = this._characterAutoSuggestEnsureModel();
        if (!model) return;
        const w = Math.max(0, safeNum(weight, 1));
        if (!w) return;

        const key = String(obs?.key || '').trim();
        const groupIds = Array.isArray(obs?.groupIds) ? obs.groupIds : [];
        if (!key || !groupIds.length) return;

        model.totalImagesSeen += 1;
        model.keyCounts[key] = safeNum(model.keyCounts[key], 0) + w;
        for (const gid of groupIds) {
            const id = String(gid || '').trim();
            if (!id) continue;
            model.groupCounts[id] = safeNum(model.groupCounts[id], 0) + w;
        }
        model.lastUpdatedAt = nowMs();
    };

    proto._characterAutoSuggestScoreKey = function (key, model) {
        const k = String(key || '').trim();
        if (!k || !model) return 0;
        const keyCount = safeNum(model.keyCounts?.[k], 0);

        // Estimate group ids via selection map (category-aware for g: keys)
        let groupIds = [];
        try {
            const selMap = this._characterParsePresetKeyToSelectionMap(k);
            if (selMap && typeof selMap === 'object') {
                groupIds = Object.values(selMap).map(v => String(v || '').trim()).filter(Boolean);
            }
        } catch {}

        const uniq = Array.from(new Set(groupIds));
        let groupSum = 0;
        for (const gid of uniq) {
            groupSum += safeNum(model.groupCounts?.[gid], 0);
        }
        const groupAvg = uniq.length ? (groupSum / uniq.length) : 0;

        // Coverage bonus: prefer keys that cover more categories.
        // (Canonical g: keys can represent many categories; missing categories are usually noise.)
        let coveredCats = 0;
        let requiredCats = 0;
        try {
            coveredCats = selMap && typeof selMap === 'object' ? Object.keys(selMap).length : 0;
            requiredCats = this._characterAutoSuggestGetRequiredCategoryNames().length;
        } catch {}
        const missingCats = Math.max(0, safeNum(requiredCats, 0) - safeNum(coveredCats, 0));
        const fullBonus = (requiredCats > 0 && coveredCats >= requiredCats) ? 25 : 0;
        const coverageBonus = Math.max(0, safeNum(coveredCats, 0)) * 3;
        const missingPenalty = missingCats * 2;

        // Simple blend: prefer combos seen often, then popular groups.
        return (keyCount * 10) + groupAvg + coverageBonus + fullBonus - missingPenalty;
    };

    proto._characterAutoSuggestRecomputePresets = function () {
        const model = this._characterAutoSuggestEnsureModel();
        if (!model) return;

        const candidateScore = new Map();

        const tryAddKey = (key, bonus = 0) => {
            const raw = String(key || '').trim();
            if (!raw) return;

            // Normalize to full coverage so top-ranked presets are stable and include all categories.
            const k = this._characterAutoSuggestNormalizeKeyToFullCoverage(raw, model);
            if (!k) return;
            if (!this._characterAutoSuggestKeyAllGroupIdsExist(k)) return;
            // Do NOT filter suggestions by auto-generation toggles.
            const score = this._characterAutoSuggestScoreKey(k, model) + safeNum(bonus, 0);
            const prev = candidateScore.get(k);
            if (prev == null || score > prev) candidateScore.set(k, score);
        };

        // 1) Keys observed in recent images
        Object.keys(model.keyCounts || {}).forEach((k) => tryAddKey(k, 0));

        // 2) User-saved presets as candidates (give a small bonus)
        try {
            const presets = Array.isArray(this.state?.character?.presets) ? this.state.character.presets : [];
            presets.forEach((p) => {
                const sel = (p?.selection && typeof p.selection === 'object') ? p.selection : {};
                const key = this._characterBuildPresetKeyFromSelections(sel);
                if (key) tryAddKey(key, 2);
            });
        } catch {}

        // 3) Synthetic combos from most-used groups per category
        try {
            const cats = this._characterGetCategoryNames();
            const grouped = this.state?.character?.tagGroups?.grouped || {};
            const flat = this.state?.character?.tagGroups?.flat || {};

            const topByCat = {};
            const perCat = 3;
            cats.forEach((cat) => {
                const groups = Array.isArray(grouped?.[cat]) ? grouped[cat] : [];
                const candidates = groups
                    .map((g, idx) => ({
                        id: String(g?.id || '').trim(),
                        idx,
                        c: safeNum(model.groupCounts?.[String(g?.id || '').trim()], 0),
                    }))
                    .filter(x => x.id)
                    .filter(x => x.id !== '__none__')
                    .filter(x => !!flat[x.id]);

                if (!candidates.length) return;

                candidates.sort((a, b) => {
                    if (a.c !== b.c) return b.c - a.c;
                    return a.idx - b.idx;
                });

                topByCat[cat] = candidates.slice(0, perCat).map(x => x.id);
            });

            const baseSel = {};
            cats.forEach((cat) => {
                const ids = topByCat[cat];
                // Always fill if the category has groups; fall back to "best" group.
                baseSel[cat] = (ids && ids.length)
                    ? ids[0]
                    : (this._characterAutoSuggestPickBestGroupIdForCategory(cat, model) || null);
            });
            const baseKey = this._characterBuildPresetKeyFromSelections(baseSel);
            if (baseKey) tryAddKey(baseKey, 1);

            cats.forEach((cat) => {
                const ids = topByCat[cat] || [];
                for (let i = 1; i < ids.length; i++) {
                    const sel = { ...baseSel, [cat]: ids[i] };
                    const k = this._characterBuildPresetKeyFromSelections(sel);
                    if (k) tryAddKey(k, 0.5);
                }
            });
        } catch {}

        const ranked = Array.from(candidateScore.entries())
            .map(([key, score]) => ({ key, score }))
            .sort((a, b) => (b.score - a.score));

        // Diversity guard: diversify the first 5 suggestions (avoid near-identical picks).
        const diversifyTopN = (items, { total = 20, display = 5 } = {}) => {
            const pool = items.slice(0, Math.max(total, display));
            const chosen = [];
            const chosenGroupIds = new Set();

            const getIds = (key) => {
                try {
                    const selMap = this._characterParsePresetKeyToSelectionMap(String(key || '').trim());
                    const ids = (selMap && typeof selMap === 'object')
                        ? Object.values(selMap).map(v => String(v || '').trim()).filter(Boolean)
                        : [];
                    return Array.from(new Set(ids));
                } catch {
                    return [];
                }
            };

            const overlapCount = (ids) => {
                let c = 0;
                for (const id of ids) {
                    if (chosenGroupIds.has(id)) c += 1;
                }
                return c;
            };

            // Greedy: pick best adjusted score each slot.
            for (let i = 0; i < Math.min(display, pool.length); i++) {
                let bestIdx = -1;
                let bestAdjusted = -Infinity;
                for (let j = 0; j < pool.length; j++) {
                    const cand = pool[j];
                    const ids = getIds(cand.key);
                    const ov = overlapCount(ids);
                    const adjusted = cand.score / (1 + (ov * 2));
                    if (adjusted > bestAdjusted) {
                        bestAdjusted = adjusted;
                        bestIdx = j;
                    }
                }
                if (bestIdx < 0) break;
                const picked = pool.splice(bestIdx, 1)[0];
                chosen.push(picked);
                getIds(picked.key).forEach((id) => chosenGroupIds.add(id));
            }

            // Append remaining candidates by original score order.
            const remaining = items
                .filter(x => !chosen.some(c => c.key === x.key))
                .slice(0, Math.max(0, total - chosen.length));

            return chosen.concat(remaining).slice(0, total);
        };

        const top20 = diversifyTopN(ranked, { total: 20, display: 5 });
        this.state.character.autoSuggestPresets = top20;

        this._characterAutoSuggestDebugLog('recompute');

        this._characterAutoSuggestRefreshPresetSubmenu();
    };

    proto._characterAutoSuggestBootstrap = async function ({ limit = 1000 } = {}) {
        if (this.state?.viewMode !== 'character') return;
        const model = this._characterAutoSuggestEnsureModel();
        if (!model) return;
        if (model.isBootstrapping) return;

        model.isBootstrapping = true;
        try {
            const caps = window.Yuuka?.services?.capabilities;
            const cap = caps?.get?.('album.get_recent_images');
            if (!cap || typeof cap.invoke !== 'function') return;

            const resp = await cap.invoke({ limit }, {});
            const items = Array.isArray(resp?.items) ? resp.items : [];

            const userSavedPresets = Array.isArray(this.state?.character?.presets) ? this.state.character.presets : [];
            const sampledTags = new Set();
            const userTotalImages = _safeCountFromResponse(resp);

            // Reset counts for a clean bootstrap (session-only)
            model.groupCounts = {};
            model.keyCounts = {};
            model.totalImagesSeen = 0;
            // New sampling session => refresh seed and clear random fallbacks
            model.randomSeed = (nowMs() >>> 0);
            model.randomFallbackByCategory = {};

            for (const it of items) {
                // Sample prompt tags (best-effort) for debugging.
                try {
                    const tags = this._characterAutoSuggestExtractPromptTags(it);
                    if (tags && tags.size) {
                        tags.forEach((t) => sampledTags.add(t));
                    }
                } catch {}

                const obs = this._characterAutoSuggestExtractObservationWithFallback(it);
                if (!obs) continue;
                const createdAt = it?.created_at || it?.createdAt || it?.raw?.createdAt || it?.raw?.created_at;
                const w = recencyWeight(createdAt, { halfLifeDays: 14, minWeight: 0.15 });
                this._characterAutoSuggestAddObservation(obs, { weight: w });
            }

            model.debugStats = {
                userTotalImages,
                userSavedPresetCount: userSavedPresets.length,
                metadataReadCount: items.length,
                sampledTagsCount: sampledTags.size,
            };

            model.bootstrapped = true;
            model.lastBootstrapAt = nowMs();

            this._characterAutoSuggestRecomputePresets();

            // Extra bootstrap-phase summary (includes response info if any)
            this._characterAutoSuggestDebugLog('bootstrap', {
                capability_limit: safeNum(limit, 0),
                response_keys: resp && typeof resp === 'object' ? Object.keys(resp).slice(0, 20) : [],
            });
        } catch (err) {
            console.warn('[Album] _characterAutoSuggestBootstrap failed:', err);
        } finally {
            model.isBootstrapping = false;
        }
    };

    proto._characterAutoSuggestIngestImage = function (imageData) {
        try {
            if (this.state?.viewMode !== 'character') return;
            const model = this._characterAutoSuggestEnsureModel();
            if (!model) return;

            const obs = this._characterAutoSuggestExtractObservationWithFallback(imageData);
            if (!obs) return;

            const raw = imageData?.raw || imageData;
            const createdAt = raw?.createdAt || raw?.created_at || imageData?.createdAt || imageData?.created_at;
            const w = recencyWeight(createdAt, { halfLifeDays: 14, minWeight: 0.15 });
            this._characterAutoSuggestAddObservation(obs, { weight: w });
            this._characterAutoSuggestRecomputePresets();

            // Per-ingest quick debug (doesn't know user total images)
            const tags = this._characterAutoSuggestExtractPromptTags(imageData);
            this._characterAutoSuggestDebugLog('ingest', {
                ingested_image_tags_sampled: tags && tags.size ? tags.size : 0,
            });
        } catch (err) {
            console.warn('[Album] _characterAutoSuggestIngestImage failed:', err);
        }
    };
})();
