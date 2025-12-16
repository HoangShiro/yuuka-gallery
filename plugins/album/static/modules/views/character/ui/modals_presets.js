// Album plugin - View module: character view (Modals: presets)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
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
