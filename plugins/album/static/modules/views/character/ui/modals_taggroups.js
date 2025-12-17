// Album plugin - View module: character view (Modals: tag groups)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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
                <div class="form-group">
                    <label>Animation</label>
                    <div class="plugin-album__character-preset-pillwrap" data-role="selected-anim-presets"></div>
                    <input type="text" id="anim-preset-search" placeholder="Gõ để tìm animation preset..." autocomplete="off" />
                    <div class="plugin-album__character-submenu-list" data-role="anim-preset-suggestions" style="max-height: 220px; overflow: auto;"></div>
                    <div class="plugin-album__character-hint" data-role="anim-lock-hint" style="margin-top: 8px; color: var(--color-secondary-text);"></div>
                </div>
                <div class="form-group">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; width: 100%; min-width: 0;">
                        <label style="margin:0; flex: 1 1 auto; min-width: 0;">Sound Fx 1</label>
                        <label class="plugin-album__android-toggle plugin-album__android-toggle--compact" style="margin:0; flex: 0 0 auto; max-width: 100%;">
                            <span class="plugin-album__android-toggle__text">Play parallel</span>
                            <input type="checkbox" data-role="sfx1-parallel" />
                            <span class="plugin-album__android-toggle__track"></span>
                        </label>
                    </div>
                    <div class="plugin-album__character-preset-pillwrap" data-role="selected-sfx1"></div>
                    <input type="text" id="sfx1-search" placeholder="Gõ để tìm sound..." autocomplete="off" />
                    <div class="plugin-album__character-preset-pillwrap" data-role="sfx1-suggestions"></div>
                </div>
                <div class="form-group">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap: 10px; width: 100%; min-width: 0;">
                        <label style="margin:0; flex: 1 1 auto; min-width: 0;">Sound Fx 2</label>
                        <label class="plugin-album__android-toggle plugin-album__android-toggle--compact" style="margin:0; flex: 0 0 auto; max-width: 100%;">
                            <span class="plugin-album__android-toggle__text">Play parallel</span>
                            <input type="checkbox" data-role="sfx2-parallel" />
                            <span class="plugin-album__android-toggle__track"></span>
                        </label>
                    </div>
                    <div class="plugin-album__character-preset-pillwrap" data-role="selected-sfx2"></div>
                    <input type="text" id="sfx2-search" placeholder="Gõ để tìm sound..." autocomplete="off" />
                    <div class="plugin-album__character-preset-pillwrap" data-role="sfx2-suggestions"></div>
                    <div class="plugin-album__character-hint" data-role="sfx-lock-hint" style="margin-top: 8px; color: var(--color-secondary-text);"></div>
                </div>
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

            let selectedAnimPresets = isEditing ? readAnimList(group) : [];

            // --- Sound FX playlist editor (duplicates allowed, order preserved; no-duplicate across slot 1/2) ---
            const readSoundList = (obj, slot) => {
                try {
                    const s = Number(slot);
                    if (s === 1) {
                        const a = obj?.sound_fx_1;
                        if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                        const b = obj?.soundFx1;
                        if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
                        return [];
                    }
                    if (s === 2) {
                        const a = obj?.sound_fx_2;
                        if (Array.isArray(a)) return a.map(x => String(x || '').trim()).filter(Boolean);
                        const b = obj?.soundFx2;
                        if (Array.isArray(b)) return b.map(x => String(x || '').trim()).filter(Boolean);
                        return [];
                    }
                } catch { }
                return [];
            };

            let selectedSfx1 = isEditing ? readSoundList(group, 1) : [];
            let selectedSfx2 = isEditing ? readSoundList(group, 2) : [];
            try {
                const set1 = new Set(selectedSfx1);
                selectedSfx2 = selectedSfx2.filter(x => !set1.has(x));
            } catch { }

            const animPillWrap = dialog.querySelector('[data-role="selected-anim-presets"]');
            const animInput = dialog.querySelector('#anim-preset-search');
            const animSug = dialog.querySelector('[data-role="anim-preset-suggestions"]');
            const animHint = dialog.querySelector('[data-role="anim-lock-hint"]');

            const sfx1PillWrap = dialog.querySelector('[data-role="selected-sfx1"]');
            const sfx1Input = dialog.querySelector('#sfx1-search');
            const sfx1Sug = dialog.querySelector('[data-role="sfx1-suggestions"]');
            const sfx2PillWrap = dialog.querySelector('[data-role="selected-sfx2"]');
            const sfx2Input = dialog.querySelector('#sfx2-search');
            const sfx2Sug = dialog.querySelector('[data-role="sfx2-suggestions"]');
            const sfxHint = dialog.querySelector('[data-role="sfx-lock-hint"]');

            const readSoundParallel = (obj, slot) => {
                try {
                    const s = Number(slot);
                    if (s === 1) {
                        const v = obj?.sound_fx_1_parallel;
                        if (typeof v === 'boolean') return v;
                        const v2 = obj?.soundFx1Parallel;
                        if (typeof v2 === 'boolean') return v2;
                        return false;
                    }
                    if (s === 2) {
                        const v = obj?.sound_fx_2_parallel;
                        if (typeof v === 'boolean') return v;
                        const v2 = obj?.soundFx2Parallel;
                        if (typeof v2 === 'boolean') return v2;
                        return true;
                    }
                } catch { }
                return (Number(slot) === 2);
            };

            let sfx1Parallel = isEditing ? readSoundParallel(group, 1) : false;
            let sfx2Parallel = isEditing ? readSoundParallel(group, 2) : true;

            const sfx1ParallelToggle = dialog.querySelector('[data-role="sfx1-parallel"]');
            const sfx2ParallelToggle = dialog.querySelector('[data-role="sfx2-parallel"]');
            try { if (sfx1ParallelToggle) sfx1ParallelToggle.checked = !!sfx1Parallel; } catch { }
            try { if (sfx2ParallelToggle) sfx2ParallelToggle.checked = !!sfx2Parallel; } catch { }
            sfx1ParallelToggle?.addEventListener('change', () => {
                try { sfx1Parallel = !!sfx1ParallelToggle.checked; } catch { sfx1Parallel = false; }
            });
            sfx2ParallelToggle?.addEventListener('change', () => {
                try { sfx2Parallel = !!sfx2ParallelToggle.checked; } catch { sfx2Parallel = true; }
            });

            const findActiveAnimCategory = () => {
                try {
                    const flat = this.state.character?.tagGroups?.flat || {};
                    const catsWithAnim = new Set();
                    Object.values(flat).forEach((g) => {
                        if (!g || typeof g !== 'object') return;
                        const catName = String(g.category || '').trim();
                        if (!catName) return;
                        if (readAnimList(g).length > 0) catsWithAnim.add(catName);
                    });
                    if (catsWithAnim.has(String(category || '').trim())) return String(category || '').trim();
                    const it = catsWithAnim.values().next();
                    return it && !it.done ? it.value : null;
                } catch {
                    return null;
                }
            };

            const activeAnimCategory = findActiveAnimCategory();
            const animLocked = !!(activeAnimCategory && String(activeAnimCategory) !== String(category));
            const applyAnimLockUi = () => {
                const msg = animLocked ? `Animation đã có sẵn ở ${String(activeAnimCategory)}.` : '';
                try { if (animHint) animHint.textContent = msg; } catch { }
                try {
                    if (animInput) animInput.disabled = animLocked || isExternal;
                    if (animSug) {
                        animSug.style.opacity = (animLocked || isExternal) ? '0.55' : '';
                        animSug.style.pointerEvents = (animLocked || isExternal) ? 'none' : '';
                    }
                    if (animPillWrap) {
                        animPillWrap.style.opacity = (animLocked || isExternal) ? '0.55' : '';
                        animPillWrap.style.pointerEvents = (animLocked || isExternal) ? 'none' : '';
                    }
                } catch { }
            };

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

            const findActiveSoundCategory = () => {
                try {
                    const flat = this.state.character?.tagGroups?.flat || {};
                    const catsWithSound = new Set();
                    Object.values(flat).forEach((g) => {
                        if (!g || typeof g !== 'object') return;
                        const catName = String(g.category || '').trim();
                        if (!catName) return;
                        const s1 = readSoundList(g, 1);
                        const s2 = readSoundList(g, 2);
                        if ((s1 && s1.length) || (s2 && s2.length)) catsWithSound.add(catName);
                    });
                    if (catsWithSound.has(String(category || '').trim())) return String(category || '').trim();
                    const it = catsWithSound.values().next();
                    return it && !it.done ? it.value : null;
                } catch {
                    return null;
                }
            };

            const activeSoundCategory = findActiveSoundCategory();
            const sfxLocked = !!(activeSoundCategory && String(activeSoundCategory) !== String(category));

            const applySfxLockUi = () => {
                const msg = sfxLocked ? `Sound Fx đã có sẵn ở ${String(activeSoundCategory)}.` : '';
                try { if (sfxHint) sfxHint.textContent = msg; } catch { }
                try {
                    const locked = sfxLocked || isExternal;
                    if (sfx1Input) sfx1Input.disabled = locked;
                    if (sfx2Input) sfx2Input.disabled = locked;
                    if (sfx1ParallelToggle) sfx1ParallelToggle.disabled = locked;
                    if (sfx2ParallelToggle) sfx2ParallelToggle.disabled = locked;
                    const blocks = [sfx1Sug, sfx2Sug, sfx1PillWrap, sfx2PillWrap];
                    blocks.forEach((el) => {
                        if (!el) return;
                        el.style.opacity = locked ? '0.55' : '';
                        el.style.pointerEvents = locked ? 'none' : '';
                    });
                } catch { }
            };

            const limitPillsToMaxLines = (wrapEl, maxLines = 3) => {
                try {
                    if (!wrapEl) return;
                    const children = Array.from(wrapEl.children || []);
                    if (!children.length) return;
                    const first = children[0];
                    const rowGap = (() => {
                        try {
                            const cs = window.getComputedStyle(wrapEl);
                            const g = cs.rowGap || cs.gap || '0px';
                            const n = parseFloat(String(g || '0').replace('px', ''));
                            return Number.isFinite(n) ? n : 0;
                        } catch {
                            return 0;
                        }
                    })();
                    const pillH = Math.max(1, Number(first.offsetHeight || 0));
                    const maxH = (pillH * Number(maxLines || 3)) + (rowGap * Math.max(0, Number(maxLines || 3) - 1));

                    wrapEl.style.maxHeight = `${maxH}px`;
                    wrapEl.style.overflow = 'hidden';

                    const mkDots = () => {
                        const dots = document.createElement('button');
                        dots.type = 'button';
                        dots.className = 'plugin-album__character-preset-pill';
                        dots.textContent = '...';
                        dots.disabled = true;
                        dots.title = '...';
                        return dots;
                    };

                    let removed = false;
                    while (wrapEl.scrollHeight > maxH && wrapEl.children.length > 0) {
                        wrapEl.removeChild(wrapEl.lastChild);
                        removed = true;
                    }
                    if (!removed) return;

                    const dots = mkDots();
                    wrapEl.appendChild(dots);
                    while (wrapEl.scrollHeight > maxH && wrapEl.children.length > 1) {
                        wrapEl.removeChild(wrapEl.children[wrapEl.children.length - 2]);
                    }
                } catch { }
            };

            let allSoundPresets = [];
            const fetchSoundPresets = async () => {
                try {
                    const all = await this.api.album.get('/sound_fx/presets');
                    const arr = Array.isArray(all) ? all : [];
                    allSoundPresets = arr
                        .filter(p => p && typeof p === 'object')
                        .map(p => ({
                            id: String(p?.id || '').trim(),
                            name: String(p?.name || '').trim(),
                            ext: String(p?.ext || '').trim().toLowerCase(),
                            url: String(p?.url || '').trim(),
                        }))
                        .filter(p => p.id && p.name);
                    try {
                        if (!this.state.character) this.state.character = {};
                        this.state.character._soundFxPresetsCache = { fetchedAt: Date.now(), presets: allSoundPresets };
                    } catch { }
                } catch {
                    allSoundPresets = [];
                }
            };

            const getPreviewEngine = () => {
                try {
                    if (typeof this._albumSoundGetEngine === 'function') return this._albumSoundGetEngine();
                    if (window.Yuuka?.AlbumSoundEngine) return new window.Yuuka.AlbumSoundEngine();
                } catch { }
                return null;
            };

            const formatSoundLabel = (p) => {
                const n = String(p?.name || '').trim();
                const ext = String(p?.ext || '').trim().toLowerCase();
                return ext ? `${n}.${ext}` : n;
            };

            const renderSfxSelected = (slot) => {
                const s = Number(slot);
                const wrap = (s === 1) ? sfx1PillWrap : sfx2PillWrap;
                if (!wrap) return;
                const list = (s === 1) ? selectedSfx1 : selectedSfx2;

                wrap.innerHTML = '';
                list.forEach((pid, idx) => {
                    const preset = allSoundPresets.find(p => p.id === pid) || null;
                    const label = preset ? formatSoundLabel(preset) : String(pid);

                    const pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'plugin-album__character-preset-pill';
                    pill.textContent = label;
                    pill.title = `${label} (bấm để xoá)`;
                    pill.dataset.index = String(idx);
                    pill.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const i = Number(pill.dataset.index);
                        if (!Number.isFinite(i) || i < 0 || i >= list.length) return;
                        list.splice(i, 1);
                        if (s === 1) selectedSfx1 = list;
                        else selectedSfx2 = list;
                        renderSfxSelected(1);
                        renderSfxSelected(2);
                        renderSfxSuggestions(1);
                        renderSfxSuggestions(2);
                    });
                    wrap.appendChild(pill);
                });
            };

            const renderSfxSuggestions = (slot) => {
                const s = Number(slot);
                const inputEl = (s === 1) ? sfx1Input : sfx2Input;
                const sugEl = (s === 1) ? sfx1Sug : sfx2Sug;
                if (!sugEl) return;
                const q = String(inputEl?.value || '').trim().toLowerCase();
                sugEl.innerHTML = '';
                try { sugEl.style.maxHeight = ''; sugEl.style.overflow = ''; } catch { }
                if (sfxLocked || isExternal) return;

                const selectedAll = new Set([...(selectedSfx1 || []), ...(selectedSfx2 || [])]);
                const matches = (Array.isArray(allSoundPresets) ? allSoundPresets : [])
                    .filter(p => !selectedAll.has(p.id))
                    .filter(p => {
                        if (!q) return true;
                        return formatSoundLabel(p).toLowerCase().includes(q);
                    })
                    .slice(0, 30);

                matches.forEach((p) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'plugin-album__character-preset-pill';
                    btn.title = formatSoundLabel(p);
                    btn.style.gap = '6px';
                    btn.style.maxWidth = '100%';

                    const play = document.createElement('span');
                    play.className = 'material-symbols-outlined';
                    play.textContent = 'play_arrow';
                    play.title = 'Preview';
                    play.style.opacity = '0.9';
                    play.style.cursor = 'pointer';
                    play.style.fontSize = '18px';
                    play.style.lineHeight = '1';
                    play.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const eng = getPreviewEngine();
                            if (eng && typeof eng.play === 'function') eng.play(p.url);
                        } catch { }
                    });

                    const titleEl = document.createElement('span');
                    titleEl.textContent = formatSoundLabel(p);
                    btn.appendChild(play);
                    btn.appendChild(titleEl);

                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const otherSet = new Set((s === 1) ? (selectedSfx2 || []) : (selectedSfx1 || []));
                        if (otherSet.has(p.id)) {
                            showError('Sound đã tồn tại ở ô còn lại.');
                            return;
                        }
                        const list = (s === 1) ? (selectedSfx1 || []) : (selectedSfx2 || []);
                        if (!list.includes(p.id)) list.push(p.id);
                        if (s === 1) selectedSfx1 = list;
                        else selectedSfx2 = list;
                        try { if (inputEl) inputEl.value = ''; } catch { }
                        renderSfxSelected(1);
                        renderSfxSelected(2);
                        renderSfxSuggestions(1);
                        renderSfxSuggestions(2);
                    });
                    sugEl.appendChild(btn);
                });

                // Limit suggestion pills to 3 lines; show "..." if overflow.
                limitPillsToMaxLines(sugEl, 3);
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
                if (animLocked || isExternal) return;
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

            applyAnimLockUi();
            fetchAnimPresets().then(() => {
                renderAnimSelected();
                renderAnimSuggestions();
            });
            animInput?.addEventListener('input', () => renderAnimSuggestions());

            applySfxLockUi();
            fetchSoundPresets().then(() => {
                renderSfxSelected(1);
                renderSfxSelected(2);
                renderSfxSuggestions(1);
                renderSfxSuggestions(2);
            });
            sfx1Input?.addEventListener('input', () => renderSfxSuggestions(1));
            sfx2Input?.addEventListener('input', () => renderSfxSuggestions(2));

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
                        await this.api.album.put(`/character/tag_groups/${groupId}`, {
                            name,
                            tags,
                            negative_tags,
                            animation_presets: selectedAnimPresets,
                            sound_fx_1: selectedSfx1,
                            sound_fx_2: selectedSfx2,
                            sound_fx_1_parallel: !!sfx1Parallel,
                            sound_fx_2_parallel: !!sfx2Parallel,
                        });
                    } else {
                        await this.api.album.post('/character/tag_groups', {
                            name,
                            category,
                            tags,
                            negative_tags,
                            animation_presets: selectedAnimPresets,
                            sound_fx_1: selectedSfx1,
                            sound_fx_2: selectedSfx2,
                            sound_fx_1_parallel: !!sfx1Parallel,
                            sound_fx_2_parallel: !!sfx2Parallel,
                        });
                    }
                    this.state.character.tagGroups = await this.api.album.get('/character/tag_groups');
                    await refreshAfterTagGroupMutation();
                    close({ changed: true });
                } catch (e) {
                    showError(`Lỗi: ${e.message}`);
                }
            };
        },
    });
})();
