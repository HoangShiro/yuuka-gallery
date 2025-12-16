// Album plugin - Character view UI: submenu empty-state toggling
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterRefreshOpenSubmenuEmptyStates() {
            try {
                if (this.state.viewMode !== 'character') return;
                const activeMenu = String(this.state.character?.activeMenu || '').trim();
                if (!activeMenu || activeMenu === 'Preset' || activeMenu === 'StatePreset') return;

                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                if (!submenu || submenu.hidden) return;
                const listEl = submenu.querySelector('.plugin-album__character-submenu-list');
                if (!listEl) return;

                const ctx = (typeof this._characterComputeSubmenuEmptyStateContext === 'function')
                    ? this._characterComputeSubmenuEmptyStateContext(activeMenu)
                    : null;
                if (!ctx) return;

                // VN BG category: kick off a single in-flight load if we don't have keys yet.
                if (ctx.type === 'vn-bg' && ctx.needsLoad && typeof this._characterVNEnsureBackgroundAlbumLoaded === 'function') {
                    try {
                        this._characterEnsureVNState?.();
                        const vn = this.state.character?.vn;
                        if (!vn?._bgAlbumLoadPromise) {
                            const p = this._characterVNEnsureBackgroundAlbumLoaded({ force: true });
                            if (p && typeof p.then === 'function') {
                                p.then(() => {
                                    try {
                                        if (this.state.viewMode !== 'character') return;
                                        if (String(this.state.character?.activeMenu || '').trim() !== String(ctx.category || '').trim()) return;
                                        const sm = this.contentArea?.querySelector('.plugin-album__character-submenu');
                                        if (!sm || sm.hidden) return;
                                        this._characterRefreshOpenSubmenuEmptyStates();
                                    } catch { }
                                }).catch(() => { });
                            }
                        }
                    } catch { }
                }

                listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]').forEach(row => {
                    const rowId = String(row.dataset.groupId || '').trim();
                    if (!rowId) return;

                    const isEmpty = (typeof this._characterComputeSubmenuRowIsEmpty === 'function')
                        ? this._characterComputeSubmenuRowIsEmpty(ctx, rowId)
                        : null;

                    if (typeof isEmpty !== 'boolean') {
                        row.classList.remove('is-empty');
                        return;
                    }
                    row.classList.toggle('is-empty', isEmpty);
                });
            } catch (err) {
                console.warn('[Album] _characterRefreshOpenSubmenuEmptyStates error:', err);
            }
        },
    });
})();
