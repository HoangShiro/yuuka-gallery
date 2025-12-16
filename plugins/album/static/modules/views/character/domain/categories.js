// Album plugin - View module: character view (Category helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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
            } catch { }
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
    });
})();
