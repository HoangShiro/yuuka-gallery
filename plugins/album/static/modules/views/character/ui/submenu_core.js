// Album plugin - Character view UI: submenu open/close/toggle
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterToggleSubmenu(menuName) {
            if (this.state.character.activeMenu === menuName) {
                this._characterCloseSubmenu();
                return;
            }
            this.state.character.activeMenu = menuName;
            this._characterOpenSubmenu(menuName);
        },

        _characterOpenSubmenu(menuName) {
            const submenu = this.contentArea.querySelector('.plugin-album__character-submenu');
            const toolbarHost = submenu?.querySelector('.plugin-album__character-submenu-toolbar');
            const list = submenu?.querySelector('.plugin-album__character-submenu-list');
            if (!submenu || !toolbarHost || !list) return;
            toolbarHost.innerHTML = '';
            list.innerHTML = '';

            // Mark current menu for styling (e.g., Preset border rules)
            try { submenu.dataset.menu = String(menuName || '').trim(); } catch { }

            submenu.hidden = false;

            if (menuName === 'Preset') {
                this._characterRenderPresetList(toolbarHost, list);
            } else if (menuName === 'StatePreset') {
                this._characterRenderStatePresetList(toolbarHost, list);
            } else {
                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(menuName) || '';
                if (stateGroupId) {
                    try {
                        this._characterEnsureStateModeState?.();
                        this.state.character.state.activeGroupId = stateGroupId;
                    } catch { }
                    this._characterRenderStateList(stateGroupId, toolbarHost, list);
                } else {
                    this._characterRenderTagGroupList(menuName, toolbarHost, list);
                }

                // Recompute empty-state immediately after rendering.
                // Must run after submenu is visible, because the refresh function
                // intentionally bails out while submenu.hidden === true.
                try { this._characterRefreshOpenSubmenuEmptyStates(); } catch { }
            }

            this._characterSetActiveMenuButton(menuName);
            document.addEventListener('mousedown', this._handleCharacterGlobalPointerDown);
            document.addEventListener('touchstart', this._handleCharacterGlobalPointerDown, { passive: true });
        },

        _characterRefreshSubmenu(menuName) {
            try {
                if (this.state.viewMode !== 'character') return;
                const target = String(menuName || '').trim();
                if (!target || target === 'Preset' || target === 'StatePreset') return;
                const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
                const toolbarHost = submenu?.querySelector('.plugin-album__character-submenu-toolbar');
                const list = submenu?.querySelector('.plugin-album__character-submenu-list');
                if (!submenu || !toolbarHost || !list) return;
                if (submenu.hidden) return;
                if (String(this.state.character?.activeMenu || '').trim() !== target) return;

                toolbarHost.innerHTML = '';
                list.innerHTML = '';
                try { submenu.dataset.menu = target; } catch { }
                const stateGroupId = this._characterParseStateGroupIdFromMenuName?.(target) || '';
                if (stateGroupId) {
                    this._characterRenderStateList(stateGroupId, toolbarHost, list);
                } else {
                    this._characterRenderTagGroupList(target, toolbarHost, list);
                }
                try { this._characterRefreshOpenSubmenuEmptyStates(); } catch { }
            } catch (err) {
                console.warn('[Album] _characterRefreshSubmenu error:', err);
            }
        },

        _characterCloseSubmenu() {
            const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
            if (submenu) submenu.hidden = true;
            this.state.character.activeMenu = null;
            this._characterSetActiveMenuButton(null);
            try {
                document.removeEventListener('mousedown', this._handleCharacterGlobalPointerDown);
                document.removeEventListener('touchstart', this._handleCharacterGlobalPointerDown);
            } catch { }
        },

        _characterSetActiveMenuButton(menuName) {
            const menu = this.contentArea?.querySelector('.plugin-album__character-menu');
            if (!menu) return;
            menu.querySelectorAll('.plugin-album__character-menu-btn').forEach(btn => {
                const m = String(btn.dataset.menu || '').trim();
                btn.classList.toggle('is-active', Boolean(menuName) && m === menuName);
            });
        },
    });
})();
