(function () {
    // Module: Character-view settings + preset-key parsing
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    proto._characterEnsureSettingsDefaults = function () {
        if (!this.state.character.settings || typeof this.state.character.settings !== 'object') {
            this.state.character.settings = { pregen_enabled: true, visual_novel_mode: true, pregen_category_enabled: {}, pregen_group_enabled: {} };
        }
        const s = this.state.character.settings;
        if (typeof s.pregen_enabled === 'undefined') s.pregen_enabled = true;
        if (typeof s.visual_novel_mode === 'undefined') s.visual_novel_mode = true;
        if (!s.pregen_category_enabled || typeof s.pregen_category_enabled !== 'object') s.pregen_category_enabled = {};
        if (!s.pregen_group_enabled || typeof s.pregen_group_enabled !== 'object') s.pregen_group_enabled = {};
        // Ensure current categories have a default entry (enabled)
        try {
            const cats = this._characterGetCategoryNames();
            cats.forEach(c => {
                if (typeof s.pregen_category_enabled[c] === 'undefined') s.pregen_category_enabled[c] = true;
            });
        } catch { }
        return s;
    };

    proto._characterIsCategoryAutoEnabled = function (categoryName) {
        const s = this._characterEnsureSettingsDefaults();
        const k = String(categoryName || '').trim();
        if (!k) return true;
        if (Object.prototype.hasOwnProperty.call(s.pregen_category_enabled, k)) {
            return s.pregen_category_enabled[k] !== false;
        }
        return true;
    };

    proto._characterIsGroupAutoEnabled = function (groupId) {
        const s = this._characterEnsureSettingsDefaults();
        const k = String(groupId || '').trim();
        if (!k) return true;
        if (Object.prototype.hasOwnProperty.call(s.pregen_group_enabled, k)) {
            return s.pregen_group_enabled[k] !== false;
        }
        return true;
    };

    proto._characterGetSelectionsForPresetId = function (presetId) {
        const cats = this._characterGetCategoryNames();
        const out = {};
        cats.forEach(c => { out[c] = null; });
        const pid = String(presetId || '').trim();
        if (!pid) return out;

        if (pid.startsWith('auto:')) {
            const key = pid.slice('auto:'.length);
            const selMap = this._characterParsePresetKeyToSelectionMap(key);
            cats.forEach((c) => {
                const k = String(c || '').trim().toLowerCase();
                out[c] = (k && selMap && Object.prototype.hasOwnProperty.call(selMap, k)) ? (selMap[k] || null) : null;
            });
            return out;
        }

        const preset = (this.state.character.presets || []).find(p => p?.id === pid);
        const sel = (preset?.selection && typeof preset.selection === 'object') ? preset.selection : {};
        cats.forEach(c => { out[c] = sel?.[c] || null; });
        return out;
    };

    // ------------------------------
    // Character preset key (canonical)
    // ------------------------------
    proto._characterParsePresetKeyToSelectionMap = function (key) {
        const raw = String(key || '').trim();
        if (!raw) return {};

        // New canonical format: "g:<id1>|<id2>|..." (URI-encoded ids, sorted). Category-independent.
        if (raw.startsWith('g:')) {
            const body = raw.slice('g:'.length);
            const parts = body.split('|').map(s => String(s || '').trim()).filter(Boolean);
            const flat = this.state?.character?.tagGroups?.flat || {};
            const out = {};
            for (const part of parts) {
                let gid = '';
                try { gid = decodeURIComponent(String(part || '').trim()); } catch { gid = String(part || '').trim(); }
                gid = String(gid || '').trim();
                if (!gid || gid === '__none__') continue;
                const g = flat?.[gid];
                const cat = String(g?.category || '').trim();
                if (!cat) continue;
                out[cat.toLowerCase()] = gid;
            }
            return out;
        }

        const parts = raw.split('|').map(s => String(s || '').trim()).filter(Boolean);
        if (!parts.length) return {};

        const hasKv = parts.some(p => p.includes('='));

        // Canonical format: "<category>=<groupId>|..." (URI-encoded, category is lowercased)
        if (hasKv) {
            const out = {};
            for (const part of parts) {
                const idx = part.indexOf('=');
                if (idx <= 0) continue;
                const kEnc = part.slice(0, idx);
                const vEnc = part.slice(idx + 1);
                let k = '';
                let v = '';
                try { k = decodeURIComponent(String(kEnc || '').trim()); } catch { k = String(kEnc || '').trim(); }
                try { v = decodeURIComponent(String(vEnc || '').trim()); } catch { v = String(vEnc || '').trim(); }
                k = String(k || '').trim().toLowerCase();
                v = String(v || '').trim();
                if (!k || !v) continue;
                out[k] = v;
            }
            return out;
        }

        // Legacy positional format: "<id1>|<id2>|..." mapped onto CURRENT category order.
        // This is best-effort only and exists to avoid hard failures if old score keys remain.
        const cats = this._characterGetCategoryNames();
        const out = {};
        cats.forEach((c, i) => {
            const k = String(c || '').trim().toLowerCase();
            const v = parts[i] ? String(parts[i]).trim() : '';
            if (k && v) out[k] = v;
        });
        return out;
    };

    proto._characterIsAutoAllowedForSelections = function (selections) {
        if (!selections || typeof selections !== 'object') return true;
        const cats = this._characterGetCategoryNames();
        for (const cat of cats) {
            const groupId = selections?.[cat] || null;
            if (!groupId) continue;
            // "None" is a valid selection when there are tag groups available,
            // but it should only respect the category toggle (no group-level toggle).
            if (String(groupId) === '__none__') {
                if (!this._characterIsCategoryAutoEnabled(cat)) return false;
                continue;
            }
            if (!this._characterIsCategoryAutoEnabled(cat)) return false;
            if (!this._characterIsGroupAutoEnabled(groupId)) return false;
        }
        return true;
    };

    proto._characterIsAutoAllowedForPresetId = function (presetId) {
        return this._characterIsAutoAllowedForSelections(this._characterGetSelectionsForPresetId(presetId));
    };

    proto._characterSetCategoryAutoEnabled = async function (categoryName, enabled) {
        const s = this._characterEnsureSettingsDefaults();
        const name = String(categoryName || '').trim();
        if (!name) return;
        const nextMap = { ...(s.pregen_category_enabled || {}) };
        nextMap[name] = !!enabled;
        s.pregen_category_enabled = nextMap;
        try {
            await this.api.album.post('/character/settings', { pregen_category_enabled: nextMap });
        } catch (err) {
            showError(`Lỗi lưu auto category: ${err.message}`);
        }

        // User action affecting auto: cancel running auto immediately when disabling.
        if (!enabled) {
            try { await this._characterCancelRunningAutoTask({ silent: true, suspend: false }); } catch { }
        }
        try {
            this.state.character.pregen.suspended = false;
            this._characterAutoMaybeSchedule(null, { reason: 'category-toggle' });
        } catch { }
    };

    proto._characterSetGroupAutoEnabled = async function (groupId, enabled) {
        const s = this._characterEnsureSettingsDefaults();
        const id = String(groupId || '').trim();
        if (!id) return;
        const nextMap = { ...(s.pregen_group_enabled || {}) };
        nextMap[id] = !!enabled;
        s.pregen_group_enabled = nextMap;
        try {
            await this.api.album.post('/character/settings', { pregen_group_enabled: nextMap });
        } catch (err) {
            showError(`Lỗi lưu auto group: ${err.message}`);
        }

        if (!enabled) {
            try { await this._characterCancelRunningAutoTask({ silent: true, suspend: false }); } catch { }
        }
        try {
            this.state.character.pregen.suspended = false;
            this._characterAutoMaybeSchedule(null, { reason: 'group-toggle' });
        } catch { }
    };
})();
