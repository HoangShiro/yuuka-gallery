// Album plugin - Character view UI: menu bar mode + labels
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterLoadMenuBarMode() {
            try {
                const raw = localStorage.getItem(this._LS_CHAR_MENU_BAR_MODE_KEY);
                const v = Number.parseInt(String(raw || ''), 10);
                if ([0, 1, 2, 3].includes(v)) return v;
            } catch { }
            return 0;
        },

        _characterLoadMainMenuMode() {
            try {
                const raw = localStorage.getItem(this._LS_CHAR_MAIN_MENU_MODE_KEY);
                const v = String(raw || '').trim().toLowerCase();
                if (v === 'category' || v === 'state') return v;
            } catch { }
            return 'category';
        },

        _characterSaveMenuBarMode() {
            try {
                const v = Number(this.state.character?.ui?.menuBarMode ?? 0);
                if ([0, 1, 2, 3].includes(v)) localStorage.setItem(this._LS_CHAR_MENU_BAR_MODE_KEY, String(v));
                else localStorage.removeItem(this._LS_CHAR_MENU_BAR_MODE_KEY);
            } catch { }
        },

        _characterSaveMainMenuMode() {
            try {
                const v = String(this.state.character?.ui?.menuMode ?? 'category').trim().toLowerCase();
                if (v === 'category' || v === 'state') {
                    localStorage.setItem(this._LS_CHAR_MAIN_MENU_MODE_KEY, v);
                } else {
                    localStorage.removeItem(this._LS_CHAR_MAIN_MENU_MODE_KEY);
                }
            } catch { }
        },

        _characterCycleMenuBarMode() {
            try {
                const current = Number(this.state.character?.ui?.menuBarMode ?? 0);
                const next = (Number.isFinite(current) ? current : 0) + 1;
                this.state.character.ui.menuBarMode = next % 4;
                this._characterSaveMenuBarMode();
                this._characterApplyMenuBarModeUI();
            } catch (err) {
                console.warn('[Album] _characterCycleMenuBarMode error:', err);
            }
        },

        _characterGetSelectedGroupNameForCategory(categoryName) {
            try {
                if (this.state?.viewMode !== 'character') return '';

                const category = String(categoryName || '').trim();
                if (!category) return '';

                let selectedId = this.state?.character?.selections?.[category] ?? null;

                // VN mode: BG selection can be stored as per-character override.
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundCategory === 'function'
                        && this._characterIsVisualNovelBackgroundCategory(category)) {
                        this._characterEnsureVNState?.();
                        const vn = this.state?.character?.vn;
                        if (vn && vn.activeBgGroupIdOverride === true) {
                            const gid = String(vn.activeBgGroupId ?? '').trim();
                            selectedId = gid || null;
                        }
                    }
                } catch { }

                if (!selectedId || String(selectedId) === '__none__') return '';
                const sid = String(selectedId);

                const flat = this.state?.character?.tagGroups?.flat || {};
                const g = flat?.[sid];
                if (g && typeof g.name === 'string' && g.name.trim()) return String(g.name);

                // Fallback: scan grouped list for this category.
                const grouped = this.state?.character?.tagGroups?.grouped?.[category] || null;
                if (Array.isArray(grouped)) {
                    const hit = grouped.find(x => x && String(x.id || '') === sid);
                    if (hit && typeof hit.name === 'string' && hit.name.trim()) return String(hit.name);
                }

                return '';
            } catch {
                return '';
            }
        },

        _characterParseStateGroupIdFromMenuName(menuName) {
            const raw = String(menuName || '').trim();
            if (!raw.startsWith('state:')) return '';
            return String(raw.slice('state:'.length) || '').trim();
        },

        _characterGetStateGroupNameById(stateGroupId) {
            try {
                const gid = String(stateGroupId || '').trim();
                if (!gid) return '';
                this._characterEnsureStateModeState?.();
                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                const hit = groups.find(g => String(g?.id || '').trim() === gid);
                return hit ? String(hit.name || '').trim() : '';
            } catch {
                return '';
            }
        },

        _characterGetSelectedStateNameForGroup(stateGroupId) {
            try {
                const gid = String(stateGroupId || '').trim();
                if (!gid) return '';
                this._characterEnsureStateModeState?.();
                const selectedId = this.state.character?.state?.selections?.[gid] ?? null;
                if (!selectedId || String(selectedId) === '__none__') return '';
                const sid = String(selectedId || '').trim();
                const states = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const hit = states.find(s => String(s?.id || '').trim() === sid);
                return hit ? String(hit.name || '').trim() : '';
            } catch {
                return '';
            }
        },

        _characterApplyMenuBarModeUI() {
            if (this.state.viewMode !== 'character') return;
            const mode = Number(this.state.character?.ui?.menuBarMode ?? 0);
            const menuMode = String(this.state.character?.ui?.menuMode || 'category').trim().toLowerCase();
            const isStateMode = menuMode === 'state';
            const menu = this.contentArea?.querySelector('.plugin-album__character-menu');
            if (!menu) return;

            const isHideCategoriesMode = (mode === 3);
            try {
                menu.classList.toggle('is-menubar-mode-3', isHideCategoriesMode);
            } catch { }

            // Category button host (contains + and all categories)
            const categoryHost = menu.querySelector('.plugin-album__character-menu-buttons');

            const allBtns = menu.querySelectorAll('.plugin-album__character-menu-btn');
            allBtns.forEach(btn => {
                const action = String(btn.dataset.action || '').trim();
                const menuName = String(btn.dataset.menu || '').trim();
                const isModeToggle = action === 'toggle-menubar-mode';
                const isCategoryBtn = !!btn.closest('.plugin-album__character-menu-buttons');

                if (isModeToggle) {
                    try {
                        const iconEl = btn.querySelector('.material-symbols-outlined');
                        if (iconEl) {
                            iconEl.textContent = ['counter_1', 'counter_2', 'counter_3', 'counter_4'][Math.max(0, Math.min(3, mode))] || 'counter_1';
                        }
                    } catch { }
                }

                // Mode 3 (UI label: counter_4) a.k.a. user "mode 4": keep layout stable.
                // Do NOT hide category buttons/host (which changes menu height and recenters on wide screens).
                // Instead, make them visually transparent via CSS and disable interactions.
                if (isHideCategoriesMode) {
                    btn.hidden = false;

                    if (isCategoryBtn) {
                        try {
                            // Remove label so width stays compact and predictable.
                            const labelEl = btn.querySelector('.plugin-album__character-menu-btn-label');
                            if (labelEl) labelEl.textContent = '';
                            btn.classList.remove('plugin-album__character-menu-btn--labeled');
                        } catch { }

                        try {
                            btn.disabled = true;
                            btn.setAttribute('aria-hidden', 'true');
                        } catch { }
                        return;
                    }

                    // Non-category buttons (Preset + mode toggle) stay usable.
                    try {
                        btn.disabled = false;
                        btn.removeAttribute('aria-hidden');
                    } catch { }
                } else {
                    btn.hidden = false;

                    // Ensure category buttons are interactive again.
                    if (isCategoryBtn) {
                        try {
                            btn.disabled = false;
                            btn.removeAttribute('aria-hidden');
                        } catch { }
                    }
                }

                // Category buttons: update label based on mode.
                if (menuName && menuName !== 'Preset' && menuName !== 'StatePreset') {
                    const labelEl = btn.querySelector('.plugin-album__character-menu-btn-label');
                    let labelText = '';
                    const stateGroupId = isStateMode ? (this._characterParseStateGroupIdFromMenuName?.(menuName) || '') : '';
                    const isStateGroupBtn = isStateMode && !!stateGroupId;

                    if (mode === 1) {
                        if (isStateGroupBtn) {
                            labelText = this._characterGetStateGroupNameById(stateGroupId) || '';
                        } else {
                            labelText = menuName;
                        }
                    } else if (mode === 2) {
                        if (isStateGroupBtn) {
                            labelText = this._characterGetSelectedStateNameForGroup(stateGroupId) || '';
                        } else {
                            labelText = this._characterGetSelectedGroupNameForCategory(menuName);
                        }
                    }

                    if (labelEl) labelEl.textContent = labelText || '';
                    btn.classList.toggle('plugin-album__character-menu-btn--labeled', !!labelText);

                    // Keep tooltip informative in label modes
                    if (isStateGroupBtn) {
                        const gName = this._characterGetStateGroupNameById(stateGroupId) || '';
                        if (mode === 2 && labelText) {
                            btn.title = gName ? `${gName}: ${labelText}` : labelText;
                        } else {
                            btn.title = gName || btn.title || '';
                        }
                    } else {
                        if (mode === 2 && labelText) {
                            btn.title = `${menuName}: ${labelText}`;
                        } else {
                            btn.title = menuName;
                        }
                    }
                }
            });

            // Never hide the category host; use CSS + disabled buttons to preserve layout.
            try {
                if (categoryHost) categoryHost.hidden = false;
            } catch { }

            // Update submenu offset so it doesn't overlap the main menu on wide screens.
            try {
                const visibleWidths = Array.from(menu.querySelectorAll('.plugin-album__character-menu-btn'))
                    .filter(el => {
                        try {
                            if (el.hidden) return false;
                            // Exclude buttons hidden by an ancestor (e.g., host[hidden])
                            return (el.getClientRects?.().length || 0) > 0;
                        } catch {
                            return false;
                        }
                    })
                    .map(el => {
                        try { return el.getBoundingClientRect().width || 0; } catch { return 0; }
                    });
                const maxWidth = Math.max(44, ...visibleWidths);
                menu.style.setProperty('--album-char-menu-offset', `${Math.ceil(maxWidth)}px`);
            } catch { }
        },
    });
})();
