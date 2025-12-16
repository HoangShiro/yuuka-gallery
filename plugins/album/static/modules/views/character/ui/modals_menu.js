// Album plugin - View module: character view (Modals: menu & categories)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterOpenMainMenuModeEditModal() {
            try {
                if (this.state?.viewMode !== 'character') return;

                const modal = document.createElement('div');
                modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__character-mainmenu-mode-modal';
                const close = () => { try { modal.remove(); } catch { } };
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
                document.body.appendChild(modal);

                const dialog = document.createElement('div');
                dialog.className = 'modal-dialog';
                modal.appendChild(dialog);

                dialog.innerHTML = `
                    <h3>Main menu</h3>

                    <div class="plugin-album__character-hint" style="margin-bottom: 10px; color: var(--color-secondary-text);">
                        Mọi thay đổi sẽ được auto-save.
                    </div>

                    <div class="plugin-album__mainmenu-settings">
                        <div class="plugin-album__mainmenu-settings-row" data-block="display">
                            <div class="plugin-album__mainmenu-settings-row-title" data-role="display-title">Display</div>
                            <div class="plugin-album__mainmenu-settings-row-buttons" role="group" aria-label="Display mode">
                                <button type="button" class="plugin-album__mainmenu-settings-iconbtn" data-display="0" aria-label="Icon" title="Icon">
                                    <span class="material-symbols-outlined">counter_1</span>
                                </button>
                                <button type="button" class="plugin-album__mainmenu-settings-iconbtn" data-display="1" aria-label="Title + Icon" title="Title + Icon">
                                    <span class="material-symbols-outlined">counter_2</span>
                                </button>
                                <button type="button" class="plugin-album__mainmenu-settings-iconbtn" data-display="2" aria-label="Selected + Icon" title="Selected + Icon">
                                    <span class="material-symbols-outlined">counter_3</span>
                                </button>
                                <button type="button" class="plugin-album__mainmenu-settings-iconbtn" data-display="3" aria-label="Hide" title="Hide">
                                    <span class="material-symbols-outlined">counter_4</span>
                                </button>
                            </div>
                        </div>

                        <div class="plugin-album__mainmenu-settings-row" data-block="menumode">
                            <div class="plugin-album__mainmenu-settings-row-title" data-role="menumode-title">Menu mode</div>
                            <div class="plugin-album__mainmenu-settings-row-buttons" role="group" aria-label="Menu mode">
                                <button type="button" class="plugin-album__mainmenu-settings-iconbtn" data-menu-mode="category" aria-label="Category" title="Category">
                                    <span class="material-symbols-outlined">filter_1</span>
                                </button>
                                <button type="button" class="plugin-album__mainmenu-settings-iconbtn" data-menu-mode="state" aria-label="State" title="State">
                                    <span class="material-symbols-outlined">filter_2</span>
                                </button>
                            </div>
                        </div>

                        <div class="plugin-album__mainmenu-settings-row" data-block="tools">
                            <div class="plugin-album__mainmenu-settings-row-title">Tools</div>
                            <div class="plugin-album__mainmenu-settings-row-buttons" role="group" aria-label="Tools">
                                <button type="button" class="plugin-album__mainmenu-settings-actionbtn" data-action="open-animation-editor" aria-label="Animation editor" title="Animation editor">
                                    Animation editor
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="modal-actions">
                        <div style="flex-grow:1"></div>
                        <button type="button" id="btn-close" title="Close"><span class="material-symbols-outlined">close</span></button>
                    </div>
                `;

                dialog.querySelector('#btn-close')?.addEventListener('click', close);

                const DISPLAY_LABELS = {
                    0: 'Icon',
                    1: 'Title + Icon',
                    2: 'Selected + Icon',
                    3: 'Hide',
                };
                const MENU_MODE_LABELS = {
                    category: 'Category',
                    state: 'State',
                };

                const applySelected = () => {
                    const displayMode = Number(this.state.character?.ui?.menuBarMode ?? 0);
                    const menuMode = String(this.state.character?.ui?.menuMode ?? 'category').trim().toLowerCase();

                    const displayTitleEl = dialog.querySelector('[data-role="display-title"]');
                    if (displayTitleEl) {
                        displayTitleEl.textContent = DISPLAY_LABELS?.[displayMode] || 'Display';
                    }

                    const menuModeTitleEl = dialog.querySelector('[data-role="menumode-title"]');
                    if (menuModeTitleEl) {
                        menuModeTitleEl.textContent = MENU_MODE_LABELS?.[menuMode] || 'Menu mode';
                    }

                    dialog.querySelectorAll('[data-display]')?.forEach(btn => {
                        const v = Number(btn.dataset.display ?? -1);
                        btn.classList.toggle('is-selected', Number.isFinite(v) && v === displayMode);
                    });
                    dialog.querySelectorAll('[data-menu-mode]')?.forEach(btn => {
                        const v = String(btn.dataset.menuMode || '').trim().toLowerCase();
                        btn.classList.toggle('is-selected', v && v === menuMode);
                    });
                };

                // Wire tools actions
                dialog.querySelector('[data-action="open-animation-editor"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { close(); } catch { }
                    try {
                        if (typeof this._characterOpenAnimationEditorPage === 'function') {
                            this._characterOpenAnimationEditorPage();
                        } else {
                            this._characterOpenAnimationEditorModal?.();
                        }
                    } catch { }
                });

                // Wire display mode clicks (auto-save)
                dialog.querySelectorAll('[data-display]')?.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const v = Number(btn.dataset.display ?? 0);
                        if (![0, 1, 2, 3].includes(v)) return;
                        try {
                            if (!this.state.character.ui) this.state.character.ui = {};
                            this.state.character.ui.menuBarMode = v;
                            this._characterSaveMenuBarMode?.();
                            this._characterApplyMenuBarModeUI?.();
                        } catch { }
                        applySelected();
                    });
                });

                // Wire menu mode clicks (auto-save)
                dialog.querySelectorAll('[data-menu-mode]')?.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const v = String(btn.dataset.menuMode || '').trim().toLowerCase();
                        if (!['category', 'state'].includes(v)) return;
                        try {
                            if (!this.state.character.ui) this.state.character.ui = {};
                            this.state.character.ui.menuMode = v;
                            this._characterSaveMainMenuMode?.();

                            // Apply immediately: close submenu, ensure state-mode data exists, then rerender.
                            try { this._characterCloseSubmenu?.(); } catch { }

                            if (v === 'state') {
                                try { this._characterEnsureStateModeState?.(); } catch { }
                                // Lazy-load state groups/states if missing (e.g., modal opened early / after partial init)
                                try {
                                    const s = this.state.character?.state;
                                    const needsGroups = !(Array.isArray(s?.groups) && s.groups.length);
                                    const needsStates = !(Array.isArray(s?.states) && s.states.length);
                                    if ((needsGroups || needsStates) && this.api?.album) {
                                        Promise.all([
                                            needsGroups ? this.api.album.get('/character/state_groups') : Promise.resolve(s.groups),
                                            needsStates ? this.api.album.get('/character/states') : Promise.resolve(s.states),
                                        ]).then(([groups, states]) => {
                                            try {
                                                this._characterEnsureStateModeState?.();
                                                if (Array.isArray(groups)) this.state.character.state.groups = groups;
                                                if (Array.isArray(states)) this.state.character.state.states = states;

                                                // Restore persisted state selections/active presets (per character)
                                                const ch = String(this.state?.selectedCharacter?.hash || '').trim();
                                                if (ch) {
                                                    try { this.state.character.state.selections = this._characterLoadStateSelections?.(ch, this.state.character.state.groups) || {}; } catch { }
                                                    try { this.state.character.state.activePresetByGroup = this._characterLoadStateGroupActivePresetIds?.(ch, this.state.character.state.groups) || {}; } catch { }
                                                }
                                            } catch { }

                                            try { this._characterRender?.(); } catch { }
                                            try { this._characterRefreshDisplayedImage?.(); } catch { }
                                        }).catch(() => {
                                            try { this._characterRender?.(); } catch { }
                                            try { this._characterRefreshDisplayedImage?.(); } catch { }
                                        });
                                        // Avoid double-render below; the async render will run.
                                        applySelected();
                                        return;
                                    }
                                } catch { }
                            }

                            try { this._characterRender?.(); } catch { }
                            try { this._characterRefreshDisplayedImage?.(); } catch { }
                        } catch { }
                        applySelected();
                    });
                });

                applySelected();
            } catch (err) {
                console.warn('[Album] _characterOpenMainMenuModeEditModal error:', err);
            }
        },

        async _characterOpenCategoryReorderModal() {
            const categories = this._characterNormalizeCategories(this.state.character.categories);
            const resolvedCategories = categories.length ? categories : this._characterDefaultCategories();

            if (!resolvedCategories.length) return;

            const rows = resolvedCategories.map(c => {
                const name = String(c?.name || '').trim();
                const icon = String(c?.icon || 'label').trim() || 'label';
                const safeName = name.replace(/"/g, '&quot;');
                return `
                    <div class="plugin-album__category-reorder-row" data-name="${safeName}">
                        <button type="button" class="plugin-album__category-reorder-handle" title="Kéo để sắp xếp">
                            <span class="material-symbols-outlined">drag_indicator</span>
                        </button>
                        <span class="plugin-album__category-reorder-icon material-symbols-outlined">${icon}</span>
                        <span class="plugin-album__category-reorder-name">${safeName}</span>
                    </div>
                `;
            }).join('');

            const modalHtml = `
                <h3>Sắp xếp category</h3>
                <div class="plugin-album__category-reorder-list">${rows}</div>
                <div class="modal-actions">
                    <div style="flex-grow:1"></div>
                    <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                    <button id="btn-save" title="Save"><span class="material-symbols-outlined">check</span></button>
                </div>
            `;

            const modal = document.createElement('div');
            modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__category-reorder-modal';
            modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;
            const close = () => { try { modal.remove(); } catch { } };
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            document.body.appendChild(modal);

            const dialog = modal.querySelector('.modal-dialog');
            const listEl = dialog.querySelector('.plugin-album__category-reorder-list');
            if (!listEl) return;

            // Enable drag ordering
            try {
                const Sortable = await this._ensureSortable();
                new Sortable(listEl, {
                    animation: 150,
                    handle: '.plugin-album__category-reorder-handle',
                    draggable: '.plugin-album__category-reorder-row',
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                });
            } catch (err) {
                console.warn('[Album] Failed to enable category reordering:', err);
            }

            dialog.querySelector('#btn-cancel').onclick = close;

            dialog.querySelector('#btn-save').onclick = async () => {
                try {
                    const orderedNames = Array.from(listEl.querySelectorAll('.plugin-album__category-reorder-row'))
                        .map(el => String(el.dataset.name || '').trim())
                        .filter(Boolean);

                    const byNameLower = new Map(resolvedCategories.map(c => [String(c.name || '').trim().toLowerCase(), c]));
                    const ordered = [];
                    const seen = new Set();
                    orderedNames.forEach(n => {
                        const k = n.toLowerCase();
                        const item = byNameLower.get(k);
                        if (!item || seen.has(k)) return;
                        ordered.push(item);
                        seen.add(k);
                    });
                    // Keep any missing at end
                    resolvedCategories.forEach(c => {
                        const k = String(c.name || '').trim().toLowerCase();
                        if (!k || seen.has(k)) return;
                        ordered.push(c);
                        seen.add(k);
                    });

                    await this.api.album.post('/character/settings', {
                        pregen_enabled: !!this.state.character.settings?.pregen_enabled,
                        categories: ordered,
                    });

                    this.state.character.categories = ordered;
                    this._characterRender();
                    close();
                } catch (err) {
                    showError(`Lỗi lưu sắp xếp: ${err.message}`);
                }
            };
        },

        async _characterOpenStateGroupReorderModal() {
            try {
                if (this.state.viewMode !== 'character') return;
                this._characterEnsureStateModeState?.();

                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                if (!groups.length) return;

                const rows = groups.map(g => {
                    const gid = String(g?.id || '').trim();
                    const name = String(g?.name || '').trim();
                    const icon = String(g?.icon || 'label').trim() || 'label';
                    const safeName = name.replace(/"/g, '&quot;');
                    const safeId = gid.replace(/"/g, '&quot;');
                    if (!gid || !name) return '';
                    return `
                        <div class="plugin-album__category-reorder-row" data-id="${safeId}">
                            <button type="button" class="plugin-album__category-reorder-handle" title="Kéo để sắp xếp">
                                <span class="material-symbols-outlined">drag_indicator</span>
                            </button>
                            <span class="plugin-album__category-reorder-icon material-symbols-outlined">${icon}</span>
                            <span class="plugin-album__category-reorder-name">${safeName}</span>
                        </div>
                    `;
                }).join('');

                const modalHtml = `
                    <h3>Sắp xếp state group</h3>
                    <div class="plugin-album__category-reorder-list">${rows}</div>
                    <div class="modal-actions">
                        <div style="flex-grow:1"></div>
                        <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                        <button id="btn-save" title="Save"><span class="material-symbols-outlined">check</span></button>
                    </div>
                `;

                const modal = document.createElement('div');
                modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__category-reorder-modal';
                modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;
                const close = () => { try { modal.remove(); } catch { } };
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
                document.body.appendChild(modal);

                const dialog = modal.querySelector('.modal-dialog');
                const listEl = dialog?.querySelector('.plugin-album__category-reorder-list');
                if (!dialog || !listEl) return;

                try {
                    const Sortable = await this._ensureSortable();
                    new Sortable(listEl, {
                        animation: 150,
                        handle: '.plugin-album__category-reorder-handle',
                        draggable: '.plugin-album__category-reorder-row',
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                    });
                } catch (err) {
                    console.warn('[Album] Failed to enable state-group reordering:', err);
                }

                dialog.querySelector('#btn-cancel').onclick = close;
                dialog.querySelector('#btn-save').onclick = async () => {
                    try {
                        const orderedIds = Array.from(listEl.querySelectorAll('.plugin-album__category-reorder-row'))
                            .map(el => String(el.dataset.id || '').trim())
                            .filter(Boolean);

                        await this.api.album.post('/character/state_groups/reorder', { ordered_ids: orderedIds });
                        try { this.state.character.state.groups = await this.api.album.get('/character/state_groups'); } catch { }
                        try { this._characterRender?.(); } catch { }
                        close();
                    } catch (err) {
                        showError(`Lỗi lưu sắp xếp: ${err.message || err}`);
                    }
                };
            } catch (err) {
                console.warn('[Album] _characterOpenStateGroupReorderModal error:', err);
            }
        },

        async _characterOpenCategoryIconEditor({ mode = 'create', categoryName = null } = {}) {
            const isEdit = mode === 'edit';
            const categories = this._characterNormalizeCategories(this.state.character.categories);
            const resolvedCategories = categories.length ? categories : this._characterDefaultCategories();
            const existing = isEdit
                ? resolvedCategories.find(c => String(c?.name || '').trim() === String(categoryName || '').trim())
                : null;

            if (isEdit && !existing) {
                showError('Không tìm thấy category để edit.');
                return;
            }

            const isDefaultCategory = isEdit && this._characterIsDefaultCategoryName(existing?.name);

            let selectedIcon = (existing?.icon || '').trim() || 'label';
            let selectedColor = String(existing?.color || '').trim();
            if (!this._characterIsValidHexColor(selectedColor)) {
                selectedColor = (Array.isArray(this._CHAR_CATEGORY_COLOR_CHOICES) && this._CHAR_CATEGORY_COLOR_CHOICES.length)
                    ? String(this._CHAR_CATEGORY_COLOR_CHOICES[0])
                    : '#FFD740';
            }
            let nameValue = isEdit ? String(existing?.name || '').trim() : '';

            const iconButtons = this._CHAR_CATEGORY_ICON_CHOICES.map(icon => {
                const safe = String(icon);
                return `<button type="button" class="plugin-album__icon-choice" data-icon="${safe}" title="${safe}"><span class="material-symbols-outlined">${safe}</span></button>`;
            }).join('');

            const colorChoices = (Array.isArray(this._CHAR_CATEGORY_COLOR_CHOICES) ? this._CHAR_CATEGORY_COLOR_CHOICES : []).slice(0, 30);
            const colorButtons = colorChoices.map(c => {
                const safe = String(c);
                const iconSafe = String(selectedIcon || 'label');
                return `<button type="button" class="plugin-album__color-choice" data-color="${safe}" title="${safe}"><span class="material-symbols-outlined plugin-album__color-icon-preview" style="color:${safe}">${iconSafe}</span></button>`;
            }).join('');

            const modalHtml = `
                <h3>${isEdit ? 'Edit category icon' : 'Tạo category mới'}</h3>
                <div class="form-group">
                    <label>Tên category</label>
                    <input type="text" id="category-name" value="${isEdit ? nameValue : ''}" placeholder="VD: Hair / Pose / Lighting" ${isEdit ? '' : ''}>
                </div>
                <div class="form-group">
                    <label>Chọn icon</label>
                    <div class="plugin-album__icon-grid" role="listbox" aria-label="Category icons">
                        ${iconButtons}
                    </div>
                </div>
                <div class="form-group">
                    <label>Chọn màu icon</label>
                    <div class="plugin-album__color-grid" role="listbox" aria-label="Category colors">
                        ${colorButtons}
                    </div>
                </div>
                <div class="modal-actions">
                    ${(isEdit && !isDefaultCategory) ? `<button id="btn-delete" class="btn-danger" title="Xoá category"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
                    <div style="flex-grow:1"></div>
                    <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                    <button id="btn-save" title="Save"><span class="material-symbols-outlined">check</span></button>
                </div>
            `;

            const modal = document.createElement('div');
            modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__character-icon-modal';
            modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;
            const close = () => { try { modal.remove(); } catch { } };
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            document.body.appendChild(modal);

            const dialog = modal.querySelector('.modal-dialog');
            const nameInput = dialog.querySelector('#category-name');
            const grid = dialog.querySelector('.plugin-album__icon-grid');
            const colorGrid = dialog.querySelector('.plugin-album__color-grid');

            const syncSelected = () => {
                grid?.querySelectorAll('.plugin-album__icon-choice').forEach(btn => {
                    const ic = String(btn.dataset.icon || '');
                    btn.classList.toggle('is-selected', ic === selectedIcon);
                });

                colorGrid?.querySelectorAll('.plugin-album__color-choice').forEach(btn => {
                    const c = String(btn.dataset.color || '').toUpperCase();
                    btn.classList.toggle('is-selected', c === String(selectedColor || '').toUpperCase());
                });
            };

            syncSelected();

            grid?.addEventListener('click', (e) => {
                const btn = e.target.closest('.plugin-album__icon-choice');
                if (!btn) return;
                selectedIcon = String(btn.dataset.icon || '').trim() || 'label';
                // Update color previews to reflect the newly selected icon.
                colorGrid?.querySelectorAll('.plugin-album__color-icon-preview').forEach(el => {
                    try { el.textContent = selectedIcon; } catch { }
                });
                syncSelected();
            });

            colorGrid?.addEventListener('click', (e) => {
                const btn = e.target.closest('.plugin-album__color-choice');
                if (!btn) return;
                const c = String(btn.dataset.color || '').trim();
                if (!this._characterIsValidHexColor(c)) return;
                selectedColor = c.toUpperCase();
                syncSelected();
            });

            dialog.querySelector('#btn-cancel').onclick = close;

            const persistCategories = async (nextCategories) => {
                const payload = {
                    pregen_enabled: !!this.state.character.settings?.pregen_enabled,
                    categories: nextCategories,
                };
                await this.api.album.post('/character/settings', payload);
                this.state.character.categories = nextCategories;
            };

            const deleteBtn = dialog.querySelector('#btn-delete');
            if (deleteBtn) {
                deleteBtn.onclick = async () => {
                    const catName = String(existing?.name || '').trim();
                    if (!catName) return;
                    if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ category '${catName}'?\nTất cả tag group trong category này sẽ bị xoá.`)) return;
                    try {
                        await this.api.album.delete(`/character/categories/${encodeURIComponent(catName)}`);
                        // Refresh tag groups and local selections
                        this.state.character.tagGroups = await this.api.album.get('/character/tag_groups');
                        try {
                            const sel = { ...(this.state.character.selections || {}) };
                            delete sel[catName];
                            this.state.character.selections = sel;
                            this._characterSaveSelections();
                        } catch { }
                        this.state.character.activePresetId = null;
                        this._characterSaveActivePresetId();
                        // Remove from categories locally too
                        const after = resolvedCategories.filter(c => String(c.name || '').trim().toLowerCase() !== catName.toLowerCase());
                        await persistCategories(after);

                        // Cleanup local toggle maps
                        try {
                            this._characterEnsureSettingsDefaults();
                            const m = { ...(this.state.character.settings.pregen_category_enabled || {}) };
                            Object.keys(m).forEach(k => {
                                if (String(k).trim().toLowerCase() === catName.toLowerCase()) delete m[k];
                            });
                            this.state.character.settings.pregen_category_enabled = m;
                        } catch { }
                        this._characterRender();
                        close();
                    } catch (err) {
                        showError(`Lỗi xoá category: ${err.message}`);
                    }
                };
            }

            dialog.querySelector('#btn-save').onclick = async () => {
                try {
                    const nextName = String(nameInput?.value || '').trim();
                    if (!isEdit && !nextName) {
                        showError('Vui lòng nhập tên category.');
                        return;
                    }

                    if (isEdit && !nextName) {
                        showError('Tên category không được để trống.');
                        return;
                    }

                    if (isEdit) {
                        const oldName = String(existing?.name || '').trim();
                        // Rename + icon update via backend to keep tag groups & presets consistent
                        await this.api.album.put(`/character/categories/${encodeURIComponent(oldName)}`, {
                            name: nextName,
                            icon: selectedIcon,
                            color: selectedColor,
                        });

                        // Refresh categories from server response
                        try {
                            const latest = await this.api.album.get('/character/settings');
                            const cats = this._characterNormalizeCategories(latest?.categories);
                            // Best-effort: if backend omits `color`, keep existing local colors by name.
                            try {
                                const prevByName = new Map((resolvedCategories || []).map(c => [String(c?.name || '').trim().toLowerCase(), c]));
                                cats.forEach(c => {
                                    if (c && !this._characterIsValidHexColor(c.color)) {
                                        const prev = prevByName.get(String(c.name || '').trim().toLowerCase());
                                        if (prev && this._characterIsValidHexColor(prev.color)) c.color = prev.color;
                                    }
                                });
                            } catch { }

                            // Always apply the freshly selected color for the edited category (even if backend doesn't store/return it).
                            try {
                                const targetNames = [String(nextName || '').trim().toLowerCase(), String(oldName || '').trim().toLowerCase()].filter(Boolean);
                                if (targetNames.length && this._characterIsValidHexColor(selectedColor)) {
                                    const match = cats.find(c => targetNames.includes(String(c?.name || '').trim().toLowerCase()));
                                    if (match) match.color = String(selectedColor).toUpperCase();
                                }
                            } catch { }
                            this.state.character.categories = cats.length ? cats : this._characterDefaultCategories();

                            // Also refresh auto toggle maps (rename handled server-side)
                            try {
                                this._characterEnsureSettingsDefaults();
                                const pregenEnabled = (latest && typeof latest.pregen_enabled !== 'undefined')
                                    ? !!latest.pregen_enabled
                                    : !!this.state.character.settings.pregen_enabled;
                                const catMap = (latest?.pregen_category_enabled && typeof latest.pregen_category_enabled === 'object') ? { ...latest.pregen_category_enabled } : {};
                                const groupMap = (latest?.pregen_group_enabled && typeof latest.pregen_group_enabled === 'object') ? { ...latest.pregen_group_enabled } : {};
                                this.state.character.settings = { ...(this.state.character.settings || {}), pregen_enabled: pregenEnabled, pregen_category_enabled: catMap, pregen_group_enabled: groupMap };
                            } catch { }
                        } catch {
                            // fallback: update locally
                            const updated = resolvedCategories.map(c => {
                                if (String(c.name || '').trim() !== oldName) return c;
                                return { name: nextName, icon: selectedIcon, color: selectedColor };
                            });
                            this.state.character.categories = updated;

                            // Remap local category toggle key (best-effort)
                            try {
                                this._characterEnsureSettingsDefaults();
                                const m = { ...(this.state.character.settings.pregen_category_enabled || {}) };
                                const oldKey = Object.keys(m).find(k => String(k).trim().toLowerCase() === oldName.toLowerCase());
                                if (oldKey && oldKey !== nextName) {
                                    if (!(nextName in m)) m[nextName] = !!m[oldKey];
                                    delete m[oldKey];
                                }
                                this.state.character.settings.pregen_category_enabled = m;
                            } catch { }
                        }

                        // Remap selections (local state + localStorage)
                        try {
                            const sel = { ...(this.state.character.selections || {}) };
                            // Find old key case-insensitive
                            const oldKey = Object.keys(sel).find(k => String(k).trim().toLowerCase() === oldName.toLowerCase());
                            if (oldKey && oldKey !== nextName) {
                                if (!(nextName in sel)) sel[nextName] = sel[oldKey];
                                delete sel[oldKey];
                            }
                            this.state.character.selections = sel;
                            this._characterSaveSelections();
                        } catch { }

                        if (this.state.character.activeMenu && String(this.state.character.activeMenu).toLowerCase() === oldName.toLowerCase()) {
                            this.state.character.activeMenu = nextName;
                        }

                        // Refresh tag groups because category name changed
                        try {
                            this.state.character.tagGroups = await this.api.album.get('/character/tag_groups');
                        } catch { }
                    } else {
                        const exists = resolvedCategories.some(c => String(c.name || '').trim().toLowerCase() === nextName.toLowerCase());
                        if (exists) {
                            showError('Category này đã tồn tại.');
                            return;
                        }
                        const created = [...resolvedCategories, { name: nextName, icon: selectedIcon, color: selectedColor }];
                        await persistCategories(created);
                        // Ensure selections include new category
                        try {
                            this.state.character.selections = { ...(this.state.character.selections || {}), [nextName]: null };
                            this._characterSaveSelections();
                        } catch { }
                    }
                    this._characterRender();
                    close();
                } catch (err) {
                    showError(`Lỗi lưu category: ${err.message}`);
                }
            };
        },
    });
})();
