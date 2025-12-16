// Album plugin - View module: character view (Preset image helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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
                } catch { }
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
                    } catch { }

                    // Fallback: derive from saved category selections
                    if (!imgGroupKey) {
                        try {
                            const sel = this._characterFilterSelectionsForCharacterLayer(cfg?.album_character_category_selections);
                            if (sel && typeof sel === 'object') {
                                imgGroupKey = this._characterBuildPresetKeyFromSelections(sel);
                            }
                        } catch { }
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

        _characterGetBestImageUrlForPresetId(presetId) {
            const imgs = this._characterGetImagesForPreset(presetId);
            if (!imgs.length) return null;
            // Prefer latest (index 0 if sorted desc)
            return imgs[0]?.url || imgs[0]?.src || null;
        },
    });
})();
