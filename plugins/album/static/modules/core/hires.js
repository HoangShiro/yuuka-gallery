(function () {
    // Module: Hires upscale action (album grid)
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    proto._startHiresUpscale = async function (item) {
        const viewerHelpers = window.Yuuka?.viewerHelpers;
        let isHires;
        if (viewerHelpers?.isImageHires) {
            try {
                isHires = viewerHelpers.isImageHires(item);
            } catch (err) {
                console.warn('[Album] viewerHelpers.isImageHires error:', err);
            }
        }
        if (isHires === undefined) {
            const cfg = item?.generationConfig || {};
            if (!cfg || Object.keys(cfg).length === 0) {
                isHires = true;
            } else {
                let hiresFlag = cfg.hires_enabled;
                if (typeof hiresFlag === 'string') {
                    hiresFlag = hiresFlag.trim().toLowerCase() === 'true';
                }
                if (hiresFlag) {
                    isHires = true;
                } else {
                    const width = Number(cfg.width);
                    const baseWidth = Number(cfg.hires_base_width || cfg.width);
                    const height = Number(cfg.height);
                    const baseHeight = Number(cfg.hires_base_height || cfg.height);
                    isHires = (
                        (Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth) ||
                        (Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight)
                    );
                }
            }
        }

        if (isHires) {
            showError('Đã là ảnh hires rồi.');
            return;
        }
        if (this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length >= 5) {
            showError('Đã đạt giới hạn 5 tác vụ đồng thời.');
            return;
        }
        if (!this.state.isComfyUIAvaidable) {
            showError('ComfyUI chưa kết nối.');
            return;
        }
        if (!item?.id) {
            showError('Không thể xác định ảnh để hires.');
            return;
        }

        const grid = this.contentArea.querySelector('.plugin-album__grid');
        const tempTaskId = `temp_hires_${Date.now()}`;
        let placeholder = null;

        try {
            if (grid) {
                placeholder = this._createPlaceholderCard(tempTaskId);
                grid.prepend(placeholder);
                const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                if (emptyMsg) emptyMsg.style.display = 'none';
            }
            this._updateNav();

            const payload = {
                character_hash: this.state.selectedCharacter?.hash || item.character_hash
            };
            const response = await this.api.album.post(`/images/${item.id}/hires`, payload);
            if (!response || !response.task_id) {
                throw new Error(response?.error || 'Không thể bắt đầu hires.');
            }

            Yuuka.events.emit('generation:task_created_locally', response);

            if (placeholder) {
                placeholder.id = response.task_id;
                const cancelButton = placeholder.querySelector('.plugin-album__cancel-btn');
                if (cancelButton) {
                    cancelButton.dataset.taskId = response.task_id;
                }
            }
        } catch (err) {
            if (placeholder) {
                placeholder.remove();
            }
            const message = err?.message || String(err);
            showError(`Hires thất bại: ${message}`);
        } finally {
            this._updateNav();
        }
    };
})();
