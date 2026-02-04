// Album plugin - View module: character view (Legacy utils shim)
// NOTE: This file contains small cross-cutting helpers that don't belong to a
// single UI/domain module.
// Extracted modules:
// - modules/views/character/domain/categories.js
// - modules/views/character/ui/vn.js
// - modules/views/character/domain/preset_keys.js
// - modules/views/character/domain/images_for_preset.js
// - modules/views/character/ui/display_image.js
// - modules/views/character/domain/task_progress.js
// - modules/views/character/ui/selection_actions.js
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterGetSelectionsStorageKey(charHash) {
            const h = String(charHash || '').trim();
            // Per-character persistence.
            return `yuuka.album.character.selections:${h || 'unknown'}`;
        },

        _characterGetActivePresetIdStorageKey(charHash) {
            const h = String(charHash || '').trim();
            // Per-character persistence.
            return `yuuka.album.character.active_preset_id:${h || 'unknown'}`;
        },

        _characterLoadSelections(charHash, categories) {
            try {
                const cats = Array.isArray(categories) ? categories : [];
                const key = this._characterGetSelectionsStorageKey(charHash);
                const raw = localStorage.getItem(key);
                const obj = raw ? JSON.parse(raw) : null;
                const saved = (obj && typeof obj === 'object') ? obj : {};

                const out = {};
                cats.forEach((c) => {
                    const name = String(c || '').trim();
                    if (!name) return;
                    const v = Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : null;
                    const s = (v == null) ? null : String(v || '').trim();
                    out[name] = (!s || s === '__none__') ? null : s;
                });

                // Back-compat: preserve any extra keys (best-effort) but normalize __none__.
                Object.keys(saved).forEach((k) => {
                    const name = String(k || '').trim();
                    if (!name) return;
                    if (Object.prototype.hasOwnProperty.call(out, name)) return;
                    const v = saved[k];
                    const s = (v == null) ? null : String(v || '').trim();
                    out[name] = (!s || s === '__none__') ? null : s;
                });

                return out;
            } catch {
                // Fallback: return empty selections for requested categories
                const out = {};
                (Array.isArray(categories) ? categories : []).forEach((c) => {
                    const name = String(c || '').trim();
                    if (name) out[name] = null;
                });
                return out;
            }
        },

        _characterSaveSelections() {
            try {
                if (this.state?.viewMode !== 'character') return;
                const charHash = String(this.state?.selectedCharacter?.hash || '').trim();
                if (!charHash) return;
                const key = this._characterGetSelectionsStorageKey(charHash);
                const sel = (this.state.character?.selections && typeof this.state.character.selections === 'object')
                    ? this.state.character.selections
                    : {};
                localStorage.setItem(key, JSON.stringify(sel));
            } catch { }
        },

        _characterLoadActivePresetId(charHash) {
            try {
                const key = this._characterGetActivePresetIdStorageKey(charHash);
                const raw = String(localStorage.getItem(key) || '').trim();
                if (!raw) return null;
                // Allow 'auto:...' or saved preset id.
                return raw;
            } catch {
                return null;
            }
        },

        _characterSaveActivePresetId() {
            try {
                if (this.state?.viewMode !== 'character') return;
                const charHash = String(this.state?.selectedCharacter?.hash || '').trim();
                if (!charHash) return;
                const key = this._characterGetActivePresetIdStorageKey(charHash);
                const v = String(this.state?.character?.activePresetId || '').trim();
                if (v) localStorage.setItem(key, v);
                else localStorage.removeItem(key);
            } catch { }
        },
    });
})();
