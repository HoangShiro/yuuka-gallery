// Album plugin - Character view UI: preset submenu (progress + backgrounds)
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterUpdatePresetSubmenuTaskUI(allTasksStatus) {
            try {
                if (this.state.viewMode !== 'character') return;
                if (String(this.state.character?.activeMenu || '').trim() !== 'Preset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                const progressByPreset = this._characterGetRunningPresetProgressMap(allTasksStatus || {});
                listEl.querySelectorAll('.plugin-album__character-submenu-item[data-preset-id]').forEach(el => {
                    const pid = String(el.dataset.presetId || '').trim();
                    const progress = pid ? progressByPreset.get(pid) : null;
                    const isRunning = typeof progress === 'number';
                    el.classList.toggle('is-generating', isRunning);
                    if (isRunning) {
                        el.style.setProperty('--album-preset-progress', String(Math.max(0, Math.min(100, progress))));
                    } else {
                        el.style.removeProperty('--album-preset-progress');
                    }

                    // Also keep the blurred background thumbnail synced.
                    try { this._characterApplyPresetItemBackground(el, pid); } catch { }
                });
            } catch (err) {
                console.warn('[Album] _characterUpdatePresetSubmenuTaskUI error:', err);
            }
        },

        _characterApplyPresetItemBackground(el, presetId) {
            try {
                if (!el) return;
                const pid = String(presetId || '').trim();
                if (!pid) {
                    el.classList.remove('has-bg');
                    el.style.removeProperty('--album-preset-bg');
                    return;
                }
                const url = this._characterGetBestImageUrlForPresetId(pid);
                if (!url) {
                    el.classList.remove('has-bg');
                    el.style.removeProperty('--album-preset-bg');
                    return;
                }
                const safe = String(url).replace(/"/g, '\\"');
                el.classList.add('has-bg');
                el.style.setProperty('--album-preset-bg', `url(\"${safe}\")`);
            } catch { }
        },

        _characterUpdatePresetSubmenuBackgroundUI({ presetIds = null } = {}) {
            try {
                if (this.state.viewMode !== 'character') return;
                if (String(this.state.character?.activeMenu || '').trim() !== 'Preset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                let allow = null;
                if (presetIds) {
                    const arr = Array.isArray(presetIds) ? presetIds : [presetIds];
                    const set = new Set(arr.map(v => String(v || '').trim()).filter(Boolean));
                    allow = set.size ? set : null;
                }

                listEl.querySelectorAll('.plugin-album__character-submenu-item[data-preset-id]').forEach(el => {
                    const pid = String(el.dataset.presetId || '').trim();
                    if (allow && !allow.has(pid)) return;
                    this._characterApplyPresetItemBackground(el, pid);
                });
            } catch (err) {
                console.warn('[Album] _characterUpdatePresetSubmenuBackgroundUI error:', err);
            }
        },
    });
})();
