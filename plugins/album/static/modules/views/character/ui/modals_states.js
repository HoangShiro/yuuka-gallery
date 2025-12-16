// Album plugin - View module: character view (Modals: states)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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
                    <div class="form-group">
                        <label>Animation</label>
                        <div class="plugin-album__character-preset-pillwrap" data-role="selected-anim-presets"></div>
                        <input type="text" id="anim-preset-search" placeholder="Gõ để tìm animation preset..." autocomplete="off" />
                        <div class="plugin-album__character-submenu-list" data-role="anim-preset-suggestions" style="max-height: 220px; overflow: auto;"></div>
                        <div class="plugin-album__character-hint" data-role="anim-lock-hint" style="margin-top: 8px; color: var(--color-secondary-text);"></div>
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

                // --- Animation preset playlist editor (duplicates allowed, order preserved) ---
                const readAnimList = (obj) => {
                    try {
                        const a = obj?.animation_presets;
                        if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                        const b = obj?.animationPresets;
                        if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
                    } catch { }
                    return [];
                };

                let selectedAnimPresets = isEditing ? readAnimList(existing) : [];
                const animPillWrap = dialog.querySelector('[data-role="selected-anim-presets"]');
                const animInput = dialog.querySelector('#anim-preset-search');
                const animSug = dialog.querySelector('[data-role="anim-preset-suggestions"]');
                const animHint = dialog.querySelector('[data-role="anim-lock-hint"]');

                const findActiveAnimStateGroupId = () => {
                    try {
                        const all = Array.isArray(this.state.character?.state?.states) ? this.state.character.state.states : [];
                        const groupsWithAnim = new Set();
                        all.forEach((s) => {
                            if (!s || typeof s !== 'object') return;
                            const sgid = String(s?.group_id || s?.groupId || '').trim();
                            if (!sgid) return;
                            if (readAnimList(s).length > 0) groupsWithAnim.add(sgid);
                        });
                        if (groupsWithAnim.has(gid)) return gid;
                        const it = groupsWithAnim.values().next();
                        return it && !it.done ? it.value : null;
                    } catch {
                        return null;
                    }
                };

                const activeAnimStateGroupId = findActiveAnimStateGroupId();
                const animLocked = !!(activeAnimStateGroupId && String(activeAnimStateGroupId) !== String(gid));
                const activeAnimStateGroupName = (() => {
                    try {
                        if (!activeAnimStateGroupId) return '';
                        if (typeof this._characterGetStateGroupNameById === 'function') {
                            return this._characterGetStateGroupNameById(activeAnimStateGroupId) || activeAnimStateGroupId;
                        }
                        return activeAnimStateGroupId;
                    } catch {
                        return activeAnimStateGroupId || '';
                    }
                })();

                let allAnimPresetKeys = [];
                const fetchAnimPresets = async () => {
                    try {
                        const all = await this.api.album.get('/animation/presets');
                        const arr = Array.isArray(all) ? all : [];
                        allAnimPresetKeys = arr
                            .map(p => String(p?.key || '').trim())
                            .filter(Boolean);
                    } catch {
                        allAnimPresetKeys = [];
                    }
                };

                const applyAnimLockUi = () => {
                    const msg = animLocked ? `Animation đã có sẵn ở ${String(activeAnimStateGroupName)}.` : '';
                    try { if (animHint) animHint.textContent = msg; } catch { }
                    try {
                        if (animInput) animInput.disabled = animLocked;
                        if (animSug) {
                            animSug.style.opacity = animLocked ? '0.55' : '';
                            animSug.style.pointerEvents = animLocked ? 'none' : '';
                        }
                        if (animPillWrap) {
                            animPillWrap.style.opacity = animLocked ? '0.55' : '';
                            animPillWrap.style.pointerEvents = animLocked ? 'none' : '';
                        }
                    } catch { }
                };

                const renderAnimSelected = () => {
                    if (!animPillWrap) return;
                    animPillWrap.innerHTML = '';
                    selectedAnimPresets.forEach((key, idx) => {
                        const pill = document.createElement('button');
                        pill.type = 'button';
                        pill.className = 'plugin-album__character-preset-pill';
                        pill.textContent = String(key);
                        pill.title = `${String(key)} (bấm để xoá)`;
                        pill.dataset.index = String(idx);
                        pill.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const i = Number(pill.dataset.index);
                            if (!Number.isFinite(i) || i < 0 || i >= selectedAnimPresets.length) return;
                            selectedAnimPresets.splice(i, 1);
                            renderAnimSelected();
                            renderAnimSuggestions();
                        });
                        animPillWrap.appendChild(pill);
                    });
                };

                const renderAnimSuggestions = () => {
                    if (!animSug) return;
                    const q = String(animInput?.value || '').trim().toLowerCase();
                    animSug.innerHTML = '';
                    if (animLocked) return;
                    const matches = (Array.isArray(allAnimPresetKeys) ? allAnimPresetKeys : [])
                        .filter(k => !q || String(k).toLowerCase().includes(q))
                        .slice(0, 30);
                    matches.forEach((k) => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'plugin-album__character-submenu-item';
                        const titleEl = document.createElement('div');
                        titleEl.textContent = String(k);
                        btn.appendChild(titleEl);
                        btn.title = String(k);
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            selectedAnimPresets.push(String(k));
                            try { if (animInput) animInput.value = ''; } catch { }
                            renderAnimSelected();
                            renderAnimSuggestions();
                        });
                        animSug.appendChild(btn);
                    });
                };

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

                applyAnimLockUi();
                fetchAnimPresets().then(() => {
                    renderAnimSelected();
                    renderAnimSuggestions();
                });
                animInput?.addEventListener('input', () => renderAnimSuggestions());

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

                    const animClean = selectedAnimPresets.map(x => String(x || '').trim()).filter(Boolean);

                    if (!name) {
                        showError('Vui lòng nhập tên state.');
                        return;
                    }

                    try {
                        const payload = { name, group_id: gid, tag_group_ids: unique, animation_presets: animClean };
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
    });
})();
