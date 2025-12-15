// Album plugin - View module: character view (Modals)
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

        async _characterOpenTagGroupManagerModal(category) {
            try {
                if (this.state.viewMode !== 'character') return;
                const cat = String(category || '').trim();
                if (!cat) return;

                const escapeText = (value) => {
                    if (value === null || value === undefined) return '';
                    return String(value).replace(/[&<>"']/g, (ch) => {
                        switch (ch) {
                            case '&': return '&amp;';
                            case '<': return '&lt;';
                            case '>': return '&gt;';
                            case '"': return '&quot;';
                            case "'": return '&#39;';
                            default: return ch;
                        }
                    });
                };

                const modal = document.createElement('div');
                modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__character-taggroup-manager-modal';
                const close = () => {
                    try {
                        if (sortable && typeof sortable.destroy === 'function') sortable.destroy();
                    } catch { }
                    // If submenu for this category is currently open behind the modal,
                    // refresh it so edited group names are reflected immediately.
                    try {
                        if (this.state?.character?.activeMenu === cat) {
                            this._characterRefreshSubmenu(cat);
                        }
                    } catch { }
                    try { modal.remove(); } catch { }
                };
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
                document.body.appendChild(modal);

                const dialog = document.createElement('div');
                dialog.className = 'modal-dialog';
                modal.appendChild(dialog);

                dialog.innerHTML = `
                    <h3>Tag groups: ${escapeText(cat)}</h3>
                    <div class="plugin-album__character-hint" style="margin-bottom: 10px; color: var(--color-secondary-text);">
                        Kéo để sắp xếp, bấm vào group để sửa, và bật/tắt auto theo từng group.
                    </div>
                    <div class="plugin-album__character-submenu-list" data-role="taggroup-manager-list"></div>
                    <div class="modal-actions">
                        <button type="button" id="btn-add" title="Tạo tags group mới"><span class="material-symbols-outlined">add</span></button>
                        <button type="button" id="btn-convert" title="Chuyển toàn bộ external tags group (category này) thành user-owned">
                            <span class="material-symbols-outlined">table_convert</span>
                        </button>
                        <div style="flex-grow:1"></div>
                        <button type="button" id="btn-close" title="Close"><span class="material-symbols-outlined">close</span></button>
                    </div>
                `;

                dialog.querySelector('#btn-close')?.addEventListener('click', close);
                dialog.querySelector('#btn-add')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterOpenTagGroupEditor(null, cat, {
                        afterClose: ({ changed }) => {
                            // Re-render (always) so it reflects server updates
                            try { render(); } catch { }
                        }
                    });
                });

                dialog.querySelector('#btn-convert')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const btn = dialog.querySelector('#btn-convert');
                    const btnAdd = dialog.querySelector('#btn-add');
                    const btnClose = dialog.querySelector('#btn-close');
                    try {
                        if (btn) btn.disabled = true;
                        if (btnAdd) btnAdd.disabled = true;
                        if (btnClose) btnClose.disabled = true;

                        // Convert only external groups in this category.
                        const groups = this.state.character.tagGroups?.grouped?.[cat] || [];
                        const flat = this.state.character.tagGroups?.flat || {};

                        const normName = (v) => String(v || '').trim();
                        const userOwnedNames = new Set(
                            groups
                                .filter(g => g && typeof g.id === 'string' && !g.id.startsWith('ext:'))
                                .map(g => normName(g.name))
                                .filter(Boolean)
                        );

                        const externals = groups
                            .filter(g => g && typeof g.id === 'string' && g.id.startsWith('ext:'))
                            .map(g => flat?.[g.id] || g)
                            .filter(g => g && typeof g === 'object');

                        let converted = 0;
                        for (const g of externals) {
                            const name = normName(g.name);
                            const tags = Array.isArray(g.tags) ? g.tags : [];
                            if (!name || !tags.length) continue;
                            if (userOwnedNames.has(name)) continue;
                            try {
                                await this.api.album.post('/character/tag_groups', {
                                    name,
                                    category: cat,
                                    tags,
                                });
                                converted += 1;
                                userOwnedNames.add(name);
                            } catch (err) {
                                // Ignore duplicate conflicts; continue best-effort.
                                const msg = String(err?.message || err || '');
                                if (!msg.includes('409')) {
                                    console.warn('[Album][character] convert external tag group failed:', err);
                                }
                            }
                        }

                        // Reload tag groups so overridden externals disappear on next load.
                        try {
                            const refreshed = await this.api.album.get('/character/tag_groups');
                            this.state.character.tagGroups = refreshed || { grouped: {}, flat: {} };
                        } catch { }

                        // Re-render modal list
                        try { await render(); } catch { }

                        // Refresh submenu behind the modal if needed
                        try {
                            if (this.state?.character?.activeMenu === cat) {
                                this._characterRefreshSubmenu(cat);
                                this._characterRefreshOpenSubmenuEmptyStates();
                            }
                        } catch { }

                        if (converted === 0) {
                            // No-op
                        }
                    } catch (err) {
                        showError(`Lỗi chuyển external tags group: ${err.message || err}`);
                    } finally {
                        try {
                            if (btn) btn.disabled = false;
                            if (btnAdd) btnAdd.disabled = false;
                            if (btnClose) btnClose.disabled = false;
                        } catch { }
                    }
                });

                const listEl = dialog.querySelector('[data-role="taggroup-manager-list"]');
                let sortable = null;

                const render = async () => {
                    // Use latest state
                    const groups = this.state.character.tagGroups?.grouped?.[cat] || [];
                    const flat = this.state.character.tagGroups?.flat || {};
                    listEl.innerHTML = '';

                    groups.forEach(group => {
                        const row = document.createElement('div');
                        row.className = 'plugin-album__character-submenu-row';
                        row.dataset.groupId = group.id;
                        if (typeof group.id === 'string' && group.id.startsWith('ext:')) {
                            row.classList.add('is-external');
                        }

                        // Click anywhere on the row (except drag/toggle) to edit.
                        row.addEventListener('click', (e) => {
                            e.preventDefault();
                            // Ignore sorting state
                            if (this._characterIsSortingTagGroups) return;
                            // Ignore interactions on drag handle / toggle
                            if (e.target?.closest?.('.plugin-album__character-submenu-drag')) return;
                            this._characterOpenTagGroupEditor(group.id, cat, {
                                afterClose: ({ changed }) => {
                                    try { render(); } catch { }
                                }
                            });
                        });

                        const dragBtn = document.createElement('button');
                        dragBtn.type = 'button';
                        dragBtn.className = 'plugin-album__character-submenu-iconbtn plugin-album__character-submenu-drag';
                        dragBtn.title = 'Kéo để sắp xếp';
                        dragBtn.innerHTML = `<span class="material-symbols-outlined">drag_indicator</span>`;
                        dragBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

                        const nameSpan = document.createElement('div');
                        nameSpan.className = 'plugin-album__character-submenu-name';
                        nameSpan.textContent = group.name || flat?.[group.id]?.name || 'Untitled';
                        nameSpan.title = nameSpan.textContent;

                        row.appendChild(dragBtn);
                        row.appendChild(nameSpan);
                        listEl.appendChild(row);
                    });

                    // Enable Sortable in this modal list
                    try {
                        const Sortable = await this._ensureSortable();
                        if (sortable && typeof sortable.destroy === 'function') {
                            try { sortable.destroy(); } catch { }
                            sortable = null;
                        }
                        sortable = new Sortable(listEl, {
                            animation: 150,
                            delay: 0,
                            delayOnTouchOnly: false,
                            touchStartThreshold: 3,
                            // Only user-owned tag groups are reorderable.
                            // External groups (id starts with 'ext:') are read-only and are not persisted by the backend.
                            draggable: '.plugin-album__character-submenu-row[data-group-id]:not(.is-external)',
                            handle: '.plugin-album__character-submenu-drag',
                            ghostClass: 'sortable-ghost',
                            chosenClass: 'sortable-chosen',
                            dragClass: 'sortable-drag',
                            onStart: () => { this._characterIsSortingTagGroups = true; },
                            onEnd: async () => {
                                try {
                                    const orderedIds = Array.from(listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]:not(.is-external)'))
                                        .map(el => String(el.dataset.groupId || '').trim())
                                        .filter(Boolean);

                                    const currentGroups = this.state.character.tagGroups?.grouped?.[cat] || [];
                                    const byId = new Map(currentGroups.map(g => [g.id, g]));
                                    const ordered = [];
                                    orderedIds.forEach(id => {
                                        const g = byId.get(id);
                                        if (g) ordered.push(g);
                                    });
                                    currentGroups.forEach(g => {
                                        if (!orderedIds.includes(g.id)) ordered.push(g);
                                    });

                                    if (!this.state.character.tagGroups) this.state.character.tagGroups = { grouped: {}, flat: {} };
                                    if (!this.state.character.tagGroups.grouped) this.state.character.tagGroups.grouped = {};
                                    this.state.character.tagGroups.grouped[cat] = ordered;

                                    await this.api.album.post('/character/tag_groups/reorder', {
                                        category: cat,
                                        ordered_ids: orderedIds,
                                    });

                                    // Refresh the submenu list order immediately if it's open for this category
                                    try { this._characterRefreshSubmenu(cat); } catch { }

                                    // Keep submenu empty-state markers up to date if submenu is open
                                    try { this._characterRefreshOpenSubmenuEmptyStates(); } catch { }
                                } catch (err) {
                                    showError(`Lỗi lưu thứ tự nhóm tag: ${err.message}`);
                                } finally {
                                    this._characterIsSortingTagGroups = false;
                                }
                            }
                        });
                    } catch (err) {
                        console.error('[Album][character] Sortable init failed (manager modal):', err);
                    }
                };

                await render();
            } catch (err) {
                console.warn('[Album] _characterOpenTagGroupManagerModal error:', err);
            }
        },

        async _characterOpenTagGroupEditor(groupId, category) {
            const editorOptions = (arguments.length >= 3 && arguments[2] && typeof arguments[2] === 'object') ? arguments[2] : {};
            const afterClose = (typeof editorOptions.afterClose === 'function') ? editorOptions.afterClose : null;
            const returnToRaw = editorOptions.returnTo ?? editorOptions.return_to ?? editorOptions.returnTarget ?? editorOptions.return_target;
            const returnTo = String(returnToRaw || '').trim().toLowerCase(); // legacy: 'manager' | 'submenu'

            const isEditing = !!groupId;
            const isExternal = isEditing && String(groupId).startsWith('ext:');
            const group = isEditing ? this.state.character.tagGroups?.flat?.[groupId] : null;

            const getGroupNegTagsText = () => {
                try {
                    const arr = Array.isArray(group?.negative_tags)
                        ? group.negative_tags
                        : (Array.isArray(group?.negativeTags) ? group.negativeTags : []);
                    return Array.isArray(arr) ? arr.join(', ') : '';
                } catch {
                    return '';
                }
            };

            const modalHtml = `
                <h3>${isEditing ? 'Sửa' : 'Tạo mới'} Group: ${category}</h3>
                ${isExternal ? `<div class="plugin-album__character-hint" style="margin-bottom: 10px; color: var(--color-secondary-text);">Group này đến từ <code>data_cache/album_preset/*.txt</code> nên là <b>read-only</b>. Hãy nhân đôi để chỉnh sửa.</div>` : ''}
                <div class="form-group"><label>Tên Group</label><input type="text" id="group-name" value="${isEditing ? (group?.name || '') : ''}"></div>
                <div class="form-group"><label>Tags (cách nhau bởi dấu phẩy)</label><textarea id="group-tags" rows="3">${isEditing ? (Array.isArray(group?.tags) ? group.tags.join(', ') : '') : ''}</textarea></div>
                <div class="form-group"><label>Negative tags (cách nhau bởi dấu phẩy)</label><textarea id="group-negative-tags" rows="2">${isEditing ? getGroupNegTagsText() : ''}</textarea></div>
                <div class="modal-actions">
                    ${isEditing ? `<button id="btn-duplicate" class="btn-secondary" title="${isExternal ? 'Nhân đôi để chỉnh sửa' : 'Nhân đôi'}"><span class="material-symbols-outlined">content_copy</span></button>` : ''}
                    ${(isEditing && !isExternal) ? `<button id="btn-delete" class="btn-danger" title="Xoá"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
                    <div style="flex-grow:1"></div>
                    <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                    <button id="btn-save" title="${isEditing ? 'Cập nhật' : 'Save'}"><span class="material-symbols-outlined">check</span></button>
                </div>
            `;

            const modal = document.createElement('div');
            modal.className = 'modal-backdrop plugin-album__character-modal';
            modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;

            const legacyReturn = ({ changed } = {}) => {
                // Best-effort compatibility for older call sites.
                try {
                    if (!changed) return;
                    if (returnTo === 'submenu') {
                        this._characterRefreshSubmenu(category);
                    } else if (returnTo === 'manager') {
                        // Old behavior: reopen manager. New preferred behavior is to keep manager open.
                        this._characterOpenTagGroupManagerModal(category);
                    }
                } catch { }
            };

            const close = ({ changed = false } = {}) => {
                try { modal.remove(); } catch { }
                if (afterClose) {
                    try { afterClose({ changed: !!changed }); } catch { }
                } else {
                    legacyReturn({ changed: !!changed });
                }
            };

            // After tag-group mutations, refresh image list + open submenu availability.
            // This prevents stale “available” UI that can lead to 404s when the server no longer
            // considers old images matching the edited tag group.
            const refreshAfterTagGroupMutation = async () => {
                try {
                    const characterHash = String(this.state?.selectedCharacter?.hash || '').trim();
                    if (characterHash && this.api?.images?.getByCharacter) {
                        const images = await this.api.images.getByCharacter(characterHash);
                        this.state.allImageData = Array.isArray(images) ? images : [];
                    }
                } catch { }

                try { this._characterRefreshDisplayedImage?.(); } catch { }

                try {
                    const open = String(this.state?.character?.activeMenu || '').trim();
                    if (open && typeof this._characterRefreshSubmenu === 'function') {
                        this._characterRefreshSubmenu(open);
                    }
                } catch { }

                try { this._characterRefreshOpenSubmenuEmptyStates?.(); } catch { }
            };
            modal.addEventListener('click', (e) => { if (e.target === modal) close({ changed: false }); });
            document.body.appendChild(modal);
            const dialog = modal.querySelector('.modal-dialog');

            const tagsTextarea = dialog.querySelector('#group-tags');
            const negTagsTextarea = dialog.querySelector('#group-negative-tags');
            if (tagsTextarea && window.Yuuka?.ui?._initTagAutocomplete) {
                const tagSvc = (() => {
                    try {
                        window.Yuuka = window.Yuuka || {}; window.Yuuka.services = window.Yuuka.services || {};
                        return window.Yuuka.services.tagDataset || null;
                    } catch { return null; }
                })();

                const initAuto = (predictions) => {
                    try { window.Yuuka.ui._initTagAutocomplete(tagsTextarea.parentElement, Array.isArray(predictions) ? predictions : []); } catch { }
                };

                const initialPredictions = (() => {
                    try { return tagSvc?.get?.() || []; } catch { return []; }
                })();
                initAuto(initialPredictions);

                // If tags weren't fetched yet (e.g., user never opened settings modal), prefetch in background.
                if ((!initialPredictions || !initialPredictions.length) && tagSvc && typeof tagSvc.prefetch === 'function') {
                    try {
                        tagSvc.prefetch(this.api).then(fresh => {
                            // Re-init only if modal still exists
                            try {
                                if (!document.body.contains(modal)) return;
                                initAuto(fresh);
                            } catch { }
                        });
                    } catch { }
                }
                const autoGrow = () => { tagsTextarea.style.height = 'auto'; tagsTextarea.style.height = `${tagsTextarea.scrollHeight}px`; };
                tagsTextarea.addEventListener('input', autoGrow);
                setTimeout(autoGrow, 0);
            }

            if (negTagsTextarea && window.Yuuka?.ui?._initTagAutocomplete) {
                try {
                    const tagSvc = (() => {
                        try {
                            window.Yuuka = window.Yuuka || {}; window.Yuuka.services = window.Yuuka.services || {};
                            return window.Yuuka.services.tagDataset || null;
                        } catch { return null; }
                    })();
                    const predictions = (() => {
                        try { return tagSvc?.get?.() || []; } catch { return []; }
                    })();
                    try { window.Yuuka.ui._initTagAutocomplete(negTagsTextarea.parentElement, Array.isArray(predictions) ? predictions : []); } catch { }
                    const autoGrowNeg = () => { negTagsTextarea.style.height = 'auto'; negTagsTextarea.style.height = `${negTagsTextarea.scrollHeight}px`; };
                    negTagsTextarea.addEventListener('input', autoGrowNeg);
                    setTimeout(autoGrowNeg, 0);
                } catch { }
            }

            dialog.querySelector('#btn-cancel').onclick = () => close({ changed: false });

            if (isEditing) {
                if (!isExternal) {
                    const delBtn = dialog.querySelector('#btn-delete');
                    if (delBtn) {
                        delBtn.onclick = async () => {
                            if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ group '${group?.name || ''}'?`)) return;
                            try {
                                await this.api.album.delete(`/character/tag_groups/${groupId}`);
                                // refresh
                                this.state.character.tagGroups = await this.api.album.get('/character/tag_groups');
                                // clear selection if it was selected
                                Object.keys(this.state.character.selections).forEach(cat => {
                                    if (this.state.character.selections[cat] === groupId) this.state.character.selections[cat] = null;
                                });
                                this._characterSaveSelections();
                                await refreshAfterTagGroupMutation();
                                close({ changed: true });
                            } catch (e) {
                                showError(`Lỗi khi xóa: ${e.message}`);
                            }
                        };
                    }
                }

                const dupBtn = dialog.querySelector('#btn-duplicate');
                if (dupBtn) {
                    dupBtn.onclick = async () => {
                        try {
                            const created = await this.api.album.post(`/character/tag_groups/${groupId}/duplicate`, {});
                            this.state.character.tagGroups = await this.api.album.get('/character/tag_groups');
                            await refreshAfterTagGroupMutation();
                            close({ changed: true });
                            // If external, open the duplicated user-owned group for editing immediately
                            const newId = created?.id;
                            if (isExternal && newId) {
                                this._characterOpenTagGroupEditor(newId, category, editorOptions);
                            }
                        } catch (e) {
                            showError(`Lỗi khi nhân đôi: ${e.message}`);
                        }
                    };
                }
            }

            dialog.querySelector('#btn-save').onclick = async () => {
                if (isExternal) {
                    showError('Group external là read-only. Hãy dùng Nhân đôi để chỉnh sửa.');
                    return;
                }
                const name = dialog.querySelector('#group-name').value.trim();
                const tagsRaw = dialog.querySelector('#group-tags').value;
                const negRaw = (dialog.querySelector('#group-negative-tags')?.value ?? '');
                const cleaned = tagsRaw.replace(/^[\s,]+|[\s,]+$/g, '').trim();
                const tags = cleaned ? cleaned.split(',').map(t => t.trim()).filter(Boolean) : [];
                const cleanedNeg = String(negRaw || '').replace(/^[\s,]+|[\s,]+$/g, '').trim();
                const negative_tags = cleanedNeg ? cleanedNeg.split(',').map(t => t.trim()).filter(Boolean) : [];
                if (!name || !tags.length) {
                    showError('Vui lòng điền đủ thông tin.');
                    return;
                }
                try {
                    if (isEditing) {
                        await this.api.album.put(`/character/tag_groups/${groupId}`, { name, tags, negative_tags });
                    } else {
                        await this.api.album.post('/character/tag_groups', { name, category, tags, negative_tags });
                    }
                    this.state.character.tagGroups = await this.api.album.get('/character/tag_groups');
                    await refreshAfterTagGroupMutation();
                    close({ changed: true });
                } catch (e) {
                    showError(`Lỗi: ${e.message}`);
                }
            };
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

        async _characterOpenStateGroupEditModal({ mode = 'create', groupId = null } = {}) {
            try {
                if (this.state.viewMode !== 'character') return;
                this._characterEnsureStateModeState?.();

                const isEdit = String(mode || '').trim().toLowerCase() === 'edit';
                const gid = String(groupId || '').trim();
                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                const existing = isEdit ? groups.find(g => String(g?.id || '').trim() === gid) : null;
                if (isEdit && !existing) {
                    showError('Không tìm thấy state group để edit.');
                    return;
                }

                const isProtected = !!(existing?.protected === true);
                let selectedIcon = String(existing?.icon || '').trim() || 'label';
                let selectedColor = String(existing?.color || '').trim();
                if (!this._characterIsValidHexColor(selectedColor)) {
                    selectedColor = (Array.isArray(this._CHAR_CATEGORY_COLOR_CHOICES) && this._CHAR_CATEGORY_COLOR_CHOICES.length)
                        ? String(this._CHAR_CATEGORY_COLOR_CHOICES[0])
                        : '#FFFFFF';
                }
                const nameValue = isEdit ? String(existing?.name || '').trim() : '';

                const iconChoices = Array.isArray(this._CHAR_CATEGORY_ICON_CHOICES) ? this._CHAR_CATEGORY_ICON_CHOICES : ['label'];
                const iconButtons = iconChoices.map(icon => {
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
                    <h3>${isEdit ? 'Edit state group' : 'Tạo state group mới'}</h3>
                    <div class="form-group">
                        <label>Tên state group</label>
                        <input type="text" id="state-group-name" value="${nameValue}" placeholder="VD: Mood / Outfit / Action" />
                    </div>
                    <div class="form-group">
                        <label>Chọn icon</label>
                        <div class="plugin-album__icon-grid" role="listbox" aria-label="State group icons">
                            ${iconButtons}
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Chọn màu icon</label>
                        <div class="plugin-album__color-grid" role="listbox" aria-label="State group colors">
                            ${colorButtons}
                        </div>
                    </div>
                    <div class="modal-actions">
                        ${(isEdit && !isProtected) ? `<button id="btn-delete" class="btn-danger" title="Xoá state group"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
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
                const nameInput = dialog.querySelector('#state-group-name');
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

                const deleteBtn = dialog.querySelector('#btn-delete');
                if (deleteBtn) {
                    deleteBtn.onclick = async () => {
                        if (!isEdit || !gid) return;
                        if (isProtected) {
                            showError('State group mặc định không thể xoá.');
                            return;
                        }
                        if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ state group '${String(existing?.name || '')}'?\nTất cả state/preset thuộc group này sẽ bị xoá.`)) return;
                        try {
                            await this.api.album.delete(`/character/state_groups/${encodeURIComponent(gid)}`);
                            // Refresh groups + states
                            try { this.state.character.state.groups = await this.api.album.get('/character/state_groups'); } catch { }
                            try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }

                            // Clear local selections/overrides for this group
                            try {
                                if (this.state.character.state.selections) {
                                    delete this.state.character.state.selections[gid];
                                    this._characterSaveStateSelections?.();
                                }
                                if (this.state.character.state.activePresetByGroup) {
                                    delete this.state.character.state.activePresetByGroup[gid];
                                    this._characterSaveStateGroupActivePresetIds?.();
                                }
                                if (this.state.character.state.presetsByGroup) {
                                    delete this.state.character.state.presetsByGroup[gid];
                                }
                                if (String(this.state.character.state.activeGroupId || '').trim() === gid) {
                                    this.state.character.state.activeGroupId = null;
                                }
                            } catch { }

                            // If submenu for this group is open, close it.
                            try {
                                const m = String(this.state.character?.activeMenu || '').trim();
                                if (m === `state:${gid}`) this._characterCloseSubmenu();
                            } catch { }

                            this._characterRender();
                            close();
                        } catch (err) {
                            showError(`Lỗi xoá state group: ${err.message || err}`);
                        }
                    };
                }

                dialog.querySelector('#btn-save').onclick = async () => {
                    try {
                        const nextName = String(nameInput?.value || '').trim();
                        if (!nextName) {
                            showError('Tên state group không được để trống.');
                            return;
                        }

                        if (isEdit) {
                            await this.api.album.put(`/character/state_groups/${encodeURIComponent(gid)}`, {
                                name: nextName,
                                icon: selectedIcon,
                                color: selectedColor,
                            });
                        } else {
                            await this.api.album.post('/character/state_groups', {
                                name: nextName,
                                icon: selectedIcon,
                                color: selectedColor,
                            });
                        }

                        try { this.state.character.state.groups = await this.api.album.get('/character/state_groups'); } catch { }
                        this._characterRender();
                        close();
                    } catch (err) {
                        showError(`Lỗi lưu state group: ${err.message || err}`);
                    }
                };
            } catch (err) {
                console.warn('[Album] _characterOpenStateGroupEditModal error:', err);
            }
        },

        async _characterOpenStateManagerModal(stateGroupId) {
            try {
                if (this.state.viewMode !== 'character') return;
                this._characterEnsureStateModeState?.();

                const gid = String(stateGroupId || '').trim();
                if (!gid) return;
                const groupName = (typeof this._characterGetStateGroupNameById === 'function')
                    ? (this._characterGetStateGroupNameById(gid) || gid)
                    : gid;

                const escapeText = (value) => {
                    if (value === null || value === undefined) return '';
                    return String(value).replace(/[&<>"']/g, (ch) => {
                        switch (ch) {
                            case '&': return '&amp;';
                            case '<': return '&lt;';
                            case '>': return '&gt;';
                            case '"': return '&quot;';
                            case "'": return '&#39;';
                            default: return ch;
                        }
                    });
                };

                const modal = document.createElement('div');
                modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__character-taggroup-manager-modal';
                const close = () => {
                    try {
                        if (sortable && typeof sortable.destroy === 'function') sortable.destroy();
                    } catch { }
                    try {
                        const open = String(this.state?.character?.activeMenu || '').trim();
                        if (open === `state:${gid}`) {
                            this._characterRefreshSubmenu(open);
                        }
                    } catch { }
                    try { modal.remove(); } catch { }
                };
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
                document.body.appendChild(modal);

                const dialog = document.createElement('div');
                dialog.className = 'modal-dialog';
                modal.appendChild(dialog);

                dialog.innerHTML = `
                    <h3>States: ${escapeText(groupName)}</h3>
                    <div class="plugin-album__character-hint" style="margin-bottom: 10px; color: var(--color-secondary-text);">
                        Kéo để sắp xếp, bấm vào state để sửa. Mỗi tag group chỉ được thuộc về 1 state.
                    </div>
                    <div class="plugin-album__character-submenu-list" data-role="state-manager-list"></div>
                    <div class="modal-actions">
                        <button type="button" id="btn-add" title="Tạo state mới"><span class="material-symbols-outlined">add</span></button>
                        <button type="button" id="btn-copy-from-category" title="Copy toàn bộ tag groups từ 1 category sang states của state group này"><span class="material-symbols-outlined">move_group</span></button>
                        <div style="flex-grow:1"></div>
                        <button type="button" id="btn-close" title="Close"><span class="material-symbols-outlined">close</span></button>
                    </div>
                `;

                const listEl = dialog.querySelector('[data-role="state-manager-list"]');
                let sortable = null;

                const render = async () => {
                    const all = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                    const states = all.filter(s => String(s?.group_id || s?.groupId || '').trim() === gid);
                    listEl.innerHTML = '';
                    states.forEach(st => {
                        const sid = String(st?.id || '').trim();
                        if (!sid) return;
                        const row = document.createElement('div');
                        row.className = 'plugin-album__character-submenu-row';
                        row.dataset.groupId = sid;
                        row.addEventListener('click', (e) => {
                            e.preventDefault();
                            if (this._characterIsSortingStates) return;
                            if (e.target?.closest?.('.plugin-album__character-submenu-drag')) return;
                            this._characterOpenStateEditorModal?.(sid, gid, {
                                afterClose: async ({ changed }) => {
                                    if (changed) {
                                        try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }
                                    }
                                    try { render(); } catch { }
                                }
                            });
                        });

                        const dragBtn = document.createElement('button');
                        dragBtn.type = 'button';
                        dragBtn.className = 'plugin-album__character-submenu-iconbtn plugin-album__character-submenu-drag';
                        dragBtn.title = 'Kéo để sắp xếp';
                        dragBtn.innerHTML = `<span class="material-symbols-outlined">drag_indicator</span>`;
                        dragBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

                        const nameSpan = document.createElement('div');
                        nameSpan.className = 'plugin-album__character-submenu-name';
                        nameSpan.textContent = String(st?.name || 'Untitled');
                        nameSpan.title = nameSpan.textContent;

                        row.appendChild(dragBtn);
                        row.appendChild(nameSpan);
                        listEl.appendChild(row);
                    });

                    // Enable Sortable in this modal list
                    try {
                        const Sortable = await this._ensureSortable();
                        if (sortable && typeof sortable.destroy === 'function') {
                            try { sortable.destroy(); } catch { }
                            sortable = null;
                        }
                        sortable = new Sortable(listEl, {
                            animation: 150,
                            delay: 0,
                            delayOnTouchOnly: false,
                            touchStartThreshold: 3,
                            draggable: '.plugin-album__character-submenu-row[data-group-id]',
                            handle: '.plugin-album__character-submenu-drag',
                            ghostClass: 'sortable-ghost',
                            chosenClass: 'sortable-chosen',
                            dragClass: 'sortable-drag',
                            onStart: () => { this._characterIsSortingStates = true; },
                            onEnd: async () => {
                                try {
                                    const orderedIds = Array.from(listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]'))
                                        .map(el => String(el.dataset.groupId || '').trim())
                                        .filter(Boolean);

                                    const currentAll = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                                    const currentGroupStates = currentAll.filter(s => String(s?.group_id || s?.groupId || '').trim() === gid);
                                    const byId = new Map(currentGroupStates.map(s => [String(s?.id || '').trim(), s]));
                                    const newGroupOrder = [];
                                    const seen = new Set();
                                    orderedIds.forEach(id => {
                                        const st = byId.get(id);
                                        if (st && !seen.has(id)) {
                                            newGroupOrder.push(st);
                                            seen.add(id);
                                        }
                                    });
                                    currentGroupStates.forEach(st => {
                                        const id = String(st?.id || '').trim();
                                        if (!id || seen.has(id)) return;
                                        newGroupOrder.push(st);
                                        seen.add(id);
                                    });

                                    const out = [];
                                    let inserted = false;
                                    currentAll.forEach(st => {
                                        if (String(st?.group_id || st?.groupId || '').trim() === gid) {
                                            if (!inserted) {
                                                out.push(...newGroupOrder);
                                                inserted = true;
                                            }
                                            return;
                                        }
                                        out.push(st);
                                    });
                                    if (!inserted) out.push(...newGroupOrder);
                                    this.state.character.state.states = out;

                                    await this.api.album.post('/character/states/reorder', { group_id: gid, ordered_ids: orderedIds });

                                    // Refresh submenu behind modal if open
                                    try {
                                        const open = String(this.state?.character?.activeMenu || '').trim();
                                        if (open === `state:${gid}`) this._characterRefreshSubmenu(open);
                                    } catch { }
                                } catch (err) {
                                    showError(`Lỗi lưu thứ tự state: ${err.message || err}`);
                                } finally {
                                    this._characterIsSortingStates = false;
                                }
                            }
                        });
                    } catch (err) {
                        console.error('[Album][character] Sortable init failed (state manager modal):', err);
                    }
                };

                dialog.querySelector('#btn-close')?.addEventListener('click', close);
                dialog.querySelector('#btn-add')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterOpenStateEditorModal?.(null, gid, {
                        afterClose: async ({ changed }) => {
                            if (changed) {
                                try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }
                            }
                            try { render(); } catch { }
                        }
                    });
                });

                dialog.querySelector('#btn-copy-from-category')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const btnCopy = dialog.querySelector('#btn-copy-from-category');
                    const btnAdd = dialog.querySelector('#btn-add');
                    const btnClose = dialog.querySelector('#btn-close');
                    const setBusy = (busy) => {
                        try {
                            if (btnCopy) btnCopy.disabled = !!busy;
                            if (btnAdd) btnAdd.disabled = !!busy;
                            if (btnClose) btnClose.disabled = !!busy;
                        } catch { }
                    };

                    const ensureTagGroupsLoaded = async () => {
                        const tg = this.state.character?.tagGroups;
                        const grouped = tg?.grouped;
                        const flat = tg?.flat;
                        const ok = grouped && typeof grouped === 'object' && Object.keys(grouped).length && flat && typeof flat === 'object';
                        if (ok) return;
                        try {
                            const refreshed = await this.api.album.get('/character/tag_groups');
                            this.state.character.tagGroups = refreshed || { grouped: {}, flat: {} };
                        } catch { }
                    };

                    const openCategoryPicker = async () => {
                        try {
                            await ensureTagGroupsLoaded();
                            const grouped = this.state.character?.tagGroups?.grouped || {};
                            const categories = Object.keys(grouped || {})
                                .map(x => String(x || '').trim())
                                .filter(Boolean)
                                .sort((a, b) => a.localeCompare(b));

                            if (!categories.length) {
                                showError('Không có category nào để copy.');
                                return null;
                            }

                            const norm = (v) => String(v || '').trim().toLowerCase();
                            const preferredCategory = categories.find(c => norm(c) === norm(groupName)) || null;

                            const opts = categories.map(c => {
                                const safe = String(c).replace(/[&<>"']/g, (ch) => {
                                    switch (ch) {
                                        case '&': return '&amp;';
                                        case '<': return '&lt;';
                                        case '>': return '&gt;';
                                        case '"': return '&quot;';
                                        case "'": return '&#39;';
                                        default: return ch;
                                    }
                                });
                                const isSel = preferredCategory && norm(c) === norm(preferredCategory);
                                return `<option value="${safe}"${isSel ? ' selected' : ''}>${safe}</option>`;
                            }).join('');

                            const modal = document.createElement('div');
                            modal.className = 'modal-backdrop plugin-album__character-modal';
                            modal.innerHTML = `
                                <div class="modal-dialog">
                                    <h3>Copy tag groups → States (${escapeText(groupName)})</h3>
                                    <div class="form-group">
                                        <label>Chọn category</label>
                                        <select id="copy-category" style="width: 100%;">
                                            ${opts}
                                        </select>
                                    </div>
                                    <div class="plugin-album__character-hint" style="margin-top: 6px; color: var(--color-secondary-text);">
                                        Sẽ tạo 1 state cho mỗi tag group trong category, với tag_group_ids = [groupId].
                                    </div>
                                    <div class="modal-actions">
                                        <div style="flex-grow:1"></div>
                                        <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                                        <button id="btn-ok" title="OK"><span class="material-symbols-outlined">check</span></button>
                                    </div>
                                </div>
                            `;

                            const closePicker = () => { try { modal.remove(); } catch { } };
                            modal.addEventListener('click', (ev) => { if (ev.target === modal) closePicker(); });
                            document.body.appendChild(modal);
                            const dlg = modal.querySelector('.modal-dialog');

                            return await new Promise((resolve) => {
                                const cancel = () => { closePicker(); resolve(null); };
                                dlg?.querySelector('#btn-cancel')?.addEventListener('click', cancel);
                                dlg?.querySelector('#btn-ok')?.addEventListener('click', () => {
                                    const v = String(dlg?.querySelector('#copy-category')?.value || '').trim();
                                    closePicker();
                                    resolve(v || null);
                                });
                            });
                        } catch {
                            return null;
                        }
                    };

                    const category = await openCategoryPicker();
                    if (!category) return;

                    const grouped = this.state.character?.tagGroups?.grouped || {};
                    const flat = this.state.character?.tagGroups?.flat || {};
                    const groups = Array.isArray(grouped?.[category]) ? grouped[category] : [];
                    if (!groups.length) {
                        showError('Category này không có tag group nào.');
                        return;
                    }

                    const allStates = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                    const existingNames = new Set(
                        allStates
                            .filter(s => String(s?.group_id || s?.groupId || '').trim() === gid)
                            .map(s => String(s?.name || '').trim().casefold?.() ?? String(s?.name || '').trim().toLowerCase())
                            .filter(Boolean)
                    );

                    const normKey = (v) => (String(v || '').trim().toLowerCase());
                    const makeUniqueName = (base) => {
                        const b = String(base || '').trim();
                        if (!b) return null;
                        let candidate = b;
                        let i = 2;
                        while (existingNames.has(normKey(candidate)) && i < 200) {
                            candidate = `${b} (${i})`;
                            i += 1;
                        }
                        existingNames.add(normKey(candidate));
                        return candidate;
                    };

                    if (!await Yuuka.ui.confirm(`Copy ${groups.length} tag group từ category '${category}' sang state group '${groupName}'?`)) return;

                    setBusy(true);
                    try {
                        let created = 0;
                        let skipped = 0;

                        for (const g of groups) {
                            const tgId = String(g?.id || '').trim();
                            const rawName = String(g?.name || flat?.[tgId]?.name || '').trim();
                            if (!tgId || !rawName) { skipped += 1; continue; }
                            const name = makeUniqueName(rawName);
                            if (!name) { skipped += 1; continue; }
                            try {
                                await this.api.album.post('/character/states', {
                                    name,
                                    group_id: gid,
                                    tag_group_ids: [tgId],
                                });
                                created += 1;
                            } catch (err) {
                                // If name conflict somehow still happens, skip best-effort.
                                const msg = String(err?.message || err || '');
                                if (msg.includes('409')) {
                                    skipped += 1;
                                    continue;
                                }
                                throw err;
                            }
                        }

                        try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }
                        try { await render(); } catch { }

                        try {
                            if (typeof window.showSuccess === 'function') {
                                window.showSuccess(`Đã tạo ${created} state (bỏ qua ${skipped}).`);
                            }
                        } catch { }
                    } catch (err) {
                        showError(`Lỗi copy tag groups: ${err.message || err}`);
                    } finally {
                        setBusy(false);
                    }
                });

                await render();
            } catch (err) {
                console.warn('[Album] _characterOpenStateManagerModal error:', err);
            }
        },

        async _characterOpenStateEditorModal(stateId, stateGroupId, editorOptions) {
            const opts = (editorOptions && typeof editorOptions === 'object') ? editorOptions : {};
            const afterClose = (typeof opts.afterClose === 'function') ? opts.afterClose : null;

            try {
                if (this.state.viewMode !== 'character') return;
                this._characterEnsureStateModeState?.();

                const gid = String(stateGroupId || '').trim();
                if (!gid) return;
                const groupName = (typeof this._characterGetStateGroupNameById === 'function')
                    ? (this._characterGetStateGroupNameById(gid) || gid)
                    : gid;

                const isEditing = !!stateId;
                const sid = String(stateId || '').trim();
                const allStates = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const existing = isEditing ? allStates.find(s => String(s?.id || '').trim() === sid) : null;
                if (isEditing && !existing) {
                    showError('Không tìm thấy state để edit.');
                    return;
                }

                const nameVal = isEditing ? String(existing?.name || '').trim() : '';
                let selectedIds = isEditing && Array.isArray(existing?.tag_group_ids)
                    ? existing.tag_group_ids.map(x => String(x || '').trim()).filter(Boolean)
                    : [];

                const tagFlat = this.state.character?.tagGroups?.flat || {};
                const allTagGroups = Object.values(tagFlat)
                    .filter(g => g && typeof g === 'object')
                    .map(g => ({
                        id: String(g.id || '').trim(),
                        name: String(g.name || '').trim(),
                        category: String(g.category || '').trim(),
                    }))
                    .filter(g => g.id && g.name);

                const modalHtml = `
                    <h3>${isEditing ? 'Sửa' : 'Tạo mới'} State: ${groupName}</h3>
                    <div class="form-group"><label>Tên State</label><input type="text" id="state-name" value="${nameVal}"></div>
                    <div class="form-group">
                        <label>Tag groups</label>
                        <div class="plugin-album__character-preset-pillwrap" data-role="selected-tag-groups"></div>
                        <input type="text" id="taggroup-search" placeholder="Gõ để tìm tag groups..." autocomplete="off" />
                        <div class="plugin-album__character-submenu-list" data-role="taggroup-suggestions" style="max-height: 220px; overflow: auto;"></div>
                        <div class="plugin-album__character-hint" style="margin-top: 8px; color: var(--color-secondary-text);">
                            Tag group có thể để trống.
                        </div>
                    </div>
                    <div class="modal-actions">
                        ${(isEditing) ? `<button id="btn-delete" class="btn-danger" title="Xoá"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
                        <div style="flex-grow:1"></div>
                        <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                        <button id="btn-save" title="${isEditing ? 'Cập nhật' : 'Save'}"><span class="material-symbols-outlined">check</span></button>
                    </div>
                `;

                const modal = document.createElement('div');
                modal.className = 'modal-backdrop plugin-album__character-modal';
                modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;

                const close = ({ changed = false } = {}) => {
                    try { modal.remove(); } catch { }
                    if (afterClose) {
                        try { afterClose({ changed: !!changed }); } catch { }
                    }
                };
                modal.addEventListener('click', (e) => { if (e.target === modal) close({ changed: false }); });
                document.body.appendChild(modal);

                const dialog = modal.querySelector('.modal-dialog');
                const pillWrap = dialog.querySelector('[data-role="selected-tag-groups"]');
                const input = dialog.querySelector('#taggroup-search');
                const sug = dialog.querySelector('[data-role="taggroup-suggestions"]');

                const renderSelected = () => {
                    pillWrap.innerHTML = '';
                    selectedIds.forEach(tgid => {
                        const g = tagFlat?.[tgid];
                        const name = String(g?.name || tgid).trim();
                        const cat = String(g?.category || '').trim();

                        const pill = document.createElement('button');
                        pill.type = 'button';
                        pill.className = 'plugin-album__character-preset-pill';
                        pill.textContent = name;
                        pill.title = cat ? `${cat}: ${name} (bấm để bỏ)` : `${name} (bấm để bỏ)`;

                        try {
                            const tint = (typeof this._characterGetCategoryColor === 'function') ? this._characterGetCategoryColor(cat) : null;
                            if (tint) {
                                pill.classList.add('is-tinted');
                                pill.style.background = `color-mix(in srgb, ${tint} 45%, var(--color-primary-bg))`;
                            }
                        } catch { }

                        pill.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            selectedIds = selectedIds.filter(x => x !== tgid);
                            renderSelected();
                            renderSuggestions();
                        });

                        pillWrap.appendChild(pill);
                    });
                };

                const renderSuggestions = () => {
                    const q = String(input?.value || '').trim().toLowerCase();
                    sug.innerHTML = '';
                    const selectedSet = new Set(selectedIds);

                    const matches = allTagGroups
                        .filter(g => !selectedSet.has(g.id))
                        .filter(g => {
                            if (!q) return true;
                            return g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q);
                        })
                        .slice(0, 30);

                    matches.forEach(g => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'plugin-album__character-submenu-item';
                        const labelText = g.category ? `${g.category}: ${g.name}` : g.name;
                        const titleEl = document.createElement('div');
                        titleEl.textContent = labelText;
                        btn.appendChild(titleEl);

                        btn.title = labelText;
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!selectedSet.has(g.id)) selectedIds = [...selectedIds, g.id];
                            try { input.value = ''; } catch { }
                            renderSelected();
                            renderSuggestions();
                        });
                        sug.appendChild(btn);
                    });
                };

                renderSelected();
                renderSuggestions();

                input?.addEventListener('input', () => renderSuggestions());

                dialog.querySelector('#btn-cancel').onclick = () => close({ changed: false });

                const delBtn = dialog.querySelector('#btn-delete');
                if (delBtn) {
                    delBtn.onclick = async () => {
                        if (!isEditing) return;
                        if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ state '${String(existing?.name || '')}'?`)) return;
                        try {
                            await this.api.album.delete(`/character/states/${encodeURIComponent(sid)}`);
                            try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }

                            // Clear selection references to this state
                            try {
                                const sel = (this.state.character.state.selections && typeof this.state.character.state.selections === 'object')
                                    ? { ...this.state.character.state.selections }
                                    : {};
                                Object.keys(sel).forEach(k => {
                                    if (String(sel[k] || '').trim() === sid) sel[k] = null;
                                });
                                this.state.character.state.selections = sel;
                                this._characterSaveStateSelections?.();
                            } catch { }

                            // Invalidate preset caches (backend may have removed presets referencing this state)
                            try { this.state.character.state.presetsByGroup = {}; } catch { }

                            close({ changed: true });
                        } catch (err) {
                            showError(`Lỗi khi xóa: ${err.message || err}`);
                        }
                    };
                }

                dialog.querySelector('#btn-save').onclick = async () => {
                    const name = String(dialog.querySelector('#state-name')?.value || '').trim();
                    const cleaned = selectedIds.map(x => String(x || '').trim()).filter(Boolean);
                    const unique = Array.from(new Set(cleaned));

                    if (!name) {
                        showError('Vui lòng nhập tên state.');
                        return;
                    }

                    try {
                        const payload = { name, group_id: gid, tag_group_ids: unique };
                        if (isEditing) {
                            await this.api.album.put(`/character/states/${encodeURIComponent(sid)}`, payload);
                        } else {
                            await this.api.album.post('/character/states', payload);
                        }
                        try { this.state.character.state.states = await this.api.album.get('/character/states'); } catch { }
                        close({ changed: true });
                    } catch (err) {
                        const msg = String(err?.message || err || '');
                        showError(`Lỗi: ${msg}`);
                    }
                };
            } catch (err) {
                console.warn('[Album] _characterOpenStateEditorModal error:', err);
                try { showError(`Lỗi mở state editor: ${err.message || err}`); } catch { }
            }
        },

        async _characterOpenStateGroupPresetEditor(stateGroupId, presetId) {
            try {
                if (this.state.viewMode !== 'character') return;
                this._characterEnsureStateModeState?.();

                const gid = String(stateGroupId || '').trim();
                if (!gid) return;
                const groupName = (typeof this._characterGetStateGroupNameById === 'function')
                    ? (this._characterGetStateGroupNameById(gid) || gid)
                    : gid;

                const isEditing = !!presetId;
                const pid = String(presetId || '').trim();

                // Ensure presets are loaded for this group
                try {
                    const cache = this.state.character.state.presetsByGroup || (this.state.character.state.presetsByGroup = {});
                    if (!Array.isArray(cache[gid])) {
                        const res = await this.api.album.get(`/character/state_groups/${encodeURIComponent(gid)}/presets`);
                        cache[gid] = Array.isArray(res) ? res : [];
                    }
                } catch { }

                const presets = Array.isArray(this.state.character.state.presetsByGroup?.[gid]) ? this.state.character.state.presetsByGroup[gid] : [];
                const existing = isEditing ? presets.find(p => String(p?.id || '').trim() === pid) : null;
                if (isEditing && !existing) {
                    showError('Không tìm thấy state preset để edit.');
                    return;
                }

                const statesAll = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                const states = statesAll.filter(s => String(s?.group_id || s?.groupId || '').trim() === gid);

                const nameVal = isEditing ? String(existing?.name || '').trim() : '';
                const stateVal = isEditing ? String(existing?.state_id || existing?.stateId || '').trim() : '';

                const optionsHtml = states.map(s => {
                    const sid = String(s?.id || '').trim();
                    const n = String(s?.name || sid).trim();
                    const sel = (sid && sid === stateVal) ? 'selected' : '';
                    return `<option value="${sid}" ${sel}>${n}</option>`;
                }).join('');

                const modalHtml = `
                    <h3>${isEditing ? 'Sửa' : 'Tạo mới'} State preset: ${groupName}</h3>
                    <div class="form-group"><label>Tên preset</label><input type="text" id="sp-name" value="${nameVal}"></div>
                    <div class="form-group"><label>Chọn state</label>
                        <select id="sp-state" style="width: 100%;">
                            <option value="">-- Chọn state --</option>
                            ${optionsHtml}
                        </select>
                    </div>
                    <div class="modal-actions">
                        ${isEditing ? `<button id="btn-delete" class="btn-danger" title="Xoá"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
                        <div style="flex-grow:1"></div>
                        <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                        <button id="btn-save" title="${isEditing ? 'Cập nhật' : 'Save'}"><span class="material-symbols-outlined">check</span></button>
                    </div>
                `;

                const modal = document.createElement('div');
                modal.className = 'modal-backdrop plugin-album__character-modal';
                modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;
                const close = () => { try { modal.remove(); } catch { } };
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
                document.body.appendChild(modal);

                const dialog = modal.querySelector('.modal-dialog');
                dialog.querySelector('#btn-cancel').onclick = close;

                const refreshPresets = async () => {
                    const res = await this.api.album.get(`/character/state_groups/${encodeURIComponent(gid)}/presets`);
                    if (!this.state.character.state.presetsByGroup) this.state.character.state.presetsByGroup = {};
                    this.state.character.state.presetsByGroup[gid] = Array.isArray(res) ? res : [];
                };

                const delBtn = dialog.querySelector('#btn-delete');
                if (delBtn) {
                    delBtn.onclick = async () => {
                        if (!isEditing) return;
                        if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ preset '${String(existing?.name || '')}'?`)) return;
                        try {
                            await this.api.album.delete(`/character/state_groups/${encodeURIComponent(gid)}/presets/${encodeURIComponent(pid)}`);
                            await refreshPresets();

                            // Clear active preset override if it was this one
                            try {
                                if (this.state.character.state.activePresetByGroup?.[gid] === pid) {
                                    this.state.character.state.activePresetByGroup[gid] = null;
                                    this._characterSaveStateGroupActivePresetIds?.();
                                }
                            } catch { }

                            // Refresh submenu behind modal if open
                            try {
                                if (String(this.state.character?.activeMenu || '').trim() === 'StatePreset') {
                                    this._characterOpenSubmenu('StatePreset');
                                }
                            } catch { }

                            close();
                        } catch (err) {
                            showError(`Lỗi khi xóa: ${err.message || err}`);
                        }
                    };
                }

                dialog.querySelector('#btn-save').onclick = async () => {
                    const name = String(dialog.querySelector('#sp-name')?.value || '').trim();
                    const sid = String(dialog.querySelector('#sp-state')?.value || '').trim();
                    if (!name) {
                        showError('Vui lòng nhập tên preset.');
                        return;
                    }
                    if (!sid) {
                        showError('Vui lòng chọn state.');
                        return;
                    }
                    try {
                        if (isEditing) {
                            await this.api.album.put(`/character/state_groups/${encodeURIComponent(gid)}/presets/${encodeURIComponent(pid)}`, { name, state_id: sid });
                        } else {
                            await this.api.album.post(`/character/state_groups/${encodeURIComponent(gid)}/presets`, { name, state_id: sid });
                        }
                        await refreshPresets();

                        try {
                            if (String(this.state.character?.activeMenu || '').trim() === 'StatePreset') {
                                this._characterOpenSubmenu('StatePreset');
                            }
                        } catch { }

                        close();
                    } catch (err) {
                        showError(`Lỗi: ${err.message || err}`);
                    }
                };
            } catch (err) {
                console.warn('[Album] _characterOpenStateGroupPresetEditor error:', err);
                try { showError(`Lỗi mở preset editor: ${err.message || err}`); } catch { }
            }
        },

        async _characterOpenPresetEditor(presetId) {
            const isEditing = !!presetId;
            const preset = isEditing ? (this.state.character.presets || []).find(p => p?.id === presetId) : null;

            const nameVal = isEditing ? (preset?.name || '') : '';
            const modalHtml = `
                <h3>${isEditing ? 'Sửa' : 'Lưu'} Preset</h3>
                <div class="form-group"><label>Tên Preset</label><input type="text" id="preset-name" value="${nameVal}"></div>
                <div class="modal-actions">
                    ${isEditing ? `<button id="btn-duplicate" class="btn-secondary" title="Nhân đôi"><span class="material-symbols-outlined">content_copy</span></button>` : ''}
                    ${isEditing ? `<button id="btn-delete" class="btn-danger" title="Xoá"><span class="material-symbols-outlined">delete_forever</span></button>` : ''}
                    <div style="flex-grow:1"></div>
                    <button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button>
                    <button id="btn-save" title="${isEditing ? 'Cập nhật' : 'Save'}"><span class="material-symbols-outlined">check</span></button>
                </div>
            `;

            const modal = document.createElement('div');
            modal.className = 'modal-backdrop plugin-album__character-modal';
            modal.innerHTML = `<div class="modal-dialog">${modalHtml}</div>`;
            const close = () => { try { modal.remove(); } catch { } };
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            document.body.appendChild(modal);
            const dialog = modal.querySelector('.modal-dialog');

            dialog.querySelector('#btn-cancel').onclick = close;

            if (isEditing) {
                const delBtn = dialog.querySelector('#btn-delete');
                if (delBtn) {
                    delBtn.onclick = async () => {
                        if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ preset '${preset?.name || ''}'?`)) return;
                        try {
                            await this.api.album.delete(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${presetId}`);
                            const refreshed = await this.api.album.get(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`);
                            this.state.character.presets = Array.isArray(refreshed?.presets) ? refreshed.presets : [];
                            this.state.character.favourites = refreshed?.favourites && typeof refreshed.favourites === 'object' ? refreshed.favourites : {};
                            if (this.state.character.activePresetId === presetId) {
                                this.state.character.activePresetId = null;
                                this._characterSaveActivePresetId();
                            }
                            this._characterRender();
                            close();
                        } catch (e) {
                            showError(`Lỗi khi xóa: ${e.message}`);
                        }
                    };
                }

                const dupBtn = dialog.querySelector('#btn-duplicate');
                if (dupBtn) {
                    dupBtn.onclick = async () => {
                        try {
                            await this.api.album.post(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${presetId}/duplicate`, {});
                            const refreshed = await this.api.album.get(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`);
                            this.state.character.presets = Array.isArray(refreshed?.presets) ? refreshed.presets : [];
                            this._characterRender();
                            close();
                        } catch (e) {
                            showError(`Lỗi khi nhân đôi: ${e.message}`);
                        }
                    };
                }
            }

            dialog.querySelector('#btn-save').onclick = async () => {
                const name = dialog.querySelector('#preset-name').value.trim();
                if (!name) {
                    showError('Vui lòng nhập tên preset.');
                    return;
                }
                const selection = { ...this.state.character.selections };
                try {
                    if (isEditing) {
                        await this.api.album.put(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${presetId}`, { name, selection });
                    } else {
                        await this.api.album.post(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`, { name, selection });
                    }
                    const refreshed = await this.api.album.get(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets`);
                    this.state.character.presets = Array.isArray(refreshed?.presets) ? refreshed.presets : [];
                    this.state.character.favourites = refreshed?.favourites && typeof refreshed.favourites === 'object' ? refreshed.favourites : {};
                    this._characterRender();
                    close();
                } catch (e) {
                    showError(`Lỗi: ${e.message}`);
                }
            };
        },

        _characterOpenPresetViewer(presetId) {
            const imgs = this._characterGetImagesForPreset(presetId);
            if (!imgs.length) return;
            const startIndex = 0;
            
            const viewer = window.Yuuka?.plugins?.simpleViewer;
            if (!viewer) {
                showError('Plugin Simple Viewer chưa được cài đặt.');
                return;
            }

            const setFav = async (item) => {
                try {
                    await this.api.album.post(`/character/${encodeURIComponent(this.state.selectedCharacter.hash)}/presets/${encodeURIComponent(presetId)}/favourite`, { image_id: item.id });
                    this.state.character.favourites[presetId] = item.id;
                    this._characterRefreshDisplayedImage();
                    if (typeof window.showSuccess === 'function') window.showSuccess('Đã đặt làm ảnh đại diện.');
                    else if (typeof window.showError === 'function') window.showError('Đã đặt làm ảnh đại diện.');
                } catch (e) {
                    showError(`Lỗi favourite: ${e.message}`);
                }
            };

            const actionButtons = [
                {
                    id: 'set-favourite',
                    icon: 'star',
                    title: 'Set favourite',
                    onClick: (item) => { if (item) setFav(item); }
                },
                {
                    id: 'delete',
                    icon: 'delete',
                    title: 'Remove Image',
                    style: 'margin-left: auto; color: white;',
                    onClick: async (item, close, updateItems) => {
                        if (!item?.id) return;
                        const ok = await Yuuka.ui.confirm('Có chắc chắn muốn xóa ảnh này?');
                        if (!ok) return;
                        try {
                            await this.api.images.delete(item.id);
                            try { Yuuka.events.emit('image:deleted', { imageId: item.id }); } catch {}

                            // Remove from local state
                            this.state.allImageData = (Array.isArray(this.state.allImageData)
                                ? this.state.allImageData.filter(img => img?.id !== item.id)
                                : []);

                            // If it was the favourite for this preset, clear local favourite
                            try {
                                if (this.state.character?.favourites?.[presetId] === item.id) {
                                    delete this.state.character.favourites[presetId];
                                }
                            } catch {}

                            // Update viewer list if supported
                            if (typeof updateItems === 'function') {
                                const refreshed = this._characterGetImagesForPreset(presetId)
                                    .map(d => ({ ...d, imageUrl: d.url }));
                                updateItems(refreshed);
                                if (!refreshed.length && typeof close === 'function') {
                                    close();
                                }
                            }

                            // Refresh current displayed image in character view
                            try { this._characterRefreshDisplayedImage(); } catch {}
                        } catch (err) {
                            showError(`Lỗi xóa: ${err.message}`);
                        }
                    }
                }
            ];

            viewer.open({
                items: imgs.map(d => ({ ...d, imageUrl: d.url })),
                startIndex,
                renderInfoPanel: (item) => {
                    if (typeof this._viewerRenderInfoPanel === 'function') {
                        return this._viewerRenderInfoPanel(item);
                    }
                    const date = new Date((item.createdAt || 0) * 1000).toLocaleString();
                    const params = item.generationConfig || {};
                    return `
                        <div style="padding: 15px; display: flex; flex-direction: column; gap: 8px;">
                            <div style="font-size: 0.9em; opacity: 0.7;">${date}</div>
                            <div><b>Model:</b> ${params.ckpt_name || 'Unknown'}</div>
                            <div><b>Sampler:</b> ${params.sampler_name} (${params.scheduler})</div>
                            <div><b>Steps:</b> ${params.steps} &nbsp;|&nbsp; <b>CFG:</b> ${params.cfg}</div>
                            <div><b>Seed:</b> ${params.seed}</div>
                        </div>
                    `;
                },
                actionButtons,
            });
        },
    });
})();
