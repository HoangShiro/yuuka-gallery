(function () {
    // Module: I2V (Image-to-Video) settings modal integration
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    /**
     * Open the I2V settings modal for the currently open image in the viewer.
     * @param {object} imageItem - The image item from the viewer
     * @param {function} closeViewerFn - Callback to close the viewer
     */
    proto.openI2VSettings = async function (imageItem, closeViewerFn = null) {
        if (!this.state.isComfyUIAvaidable) {
            showError('ComfyUI chưa kết nối.');
            return;
        }
        if (!this.state.selectedCharacter?.hash) {
            showError('Chưa chọn album.');
            return;
        }

        const charHash = this.state.selectedCharacter.hash;

        // Load current I2V config for this album
        let currentConfig;
        try {
            currentConfig = await this.api.album.get(`/${charHash}/i2v/config`);
        } catch {
            currentConfig = { prompt: '', seconds: 5, fps: 16, enable_loop: true, enable_interpolation: true, resolution: '480p' };
        }

        // Build modal DOM
        const overlay = document.createElement('div');
        overlay.className = 'plugin-album__i2v-overlay';

        const modal = document.createElement('div');
        modal.className = 'plugin-album__i2v-modal';
        modal.innerHTML = `
            <div class="i2v-modal-header">
                <span class="i2v-modal-title">I2V Settings</span>
                <button class="i2v-modal-close" title="Đóng">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="i2v-modal-body">
                <div class="i2v-upload-preview" style="display: none; text-align: center; margin-bottom: 12px;">
                    <img style="max-width: 100%; max-height: 200px; border-radius: 8px; object-fit: contain; margin: 0 auto; display: block;">
                </div>
                <div class="i2v-field">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span class="i2v-label" style="margin-bottom: 0;">Prompt</span>
                        <div class="i2v-prompt-actions" style="display: flex; gap: 4px;">
                            <button type="button" class="i2v-action-btn i2v-btn-sysprompts" title="Edit System prompts" style="background: none; border: none; cursor: pointer; color: var(--color-text-secondary); padding: 4px;">
                                <span class="material-symbols-outlined" style="font-size: 20px;">settings_suggest</span>
                            </button>
                            <button type="button" class="i2v-action-btn i2v-btn-genprompt" title="Generate prompt" style="background: none; border: none; cursor: pointer; color: var(--color-text-secondary); padding: 4px;">
                                <span class="material-symbols-outlined" style="font-size: 20px;">psychiatry</span>
                            </button>
                            <button type="button" class="i2v-action-btn i2v-btn-genimage" title="Generate prompt with image" style="background: none; border: none; cursor: pointer; color: var(--color-text-secondary); padding: 4px;">
                                <span class="material-symbols-outlined" style="font-size: 20px;">image_search</span>
                            </button>
                            <button type="button" class="i2v-action-btn i2v-btn-cancel" title="Cancel generation" style="display: none; background: none; border: none; cursor: pointer; color: #ff5252; padding: 4px;">
                                <span class="material-symbols-outlined" style="font-size: 20px;">stop_circle</span>
                            </button>
                        </div>
                    </div>
                    <textarea class="i2v-prompt" rows="12" placeholder="Mô tả chuyển động...">${_escapeHtml(currentConfig.prompt || '')}</textarea>
                </div>
                <div class="i2v-row">
                    <label class="i2v-field">
                        <span class="i2v-label">Seconds</span>
                        <select class="i2v-seconds">
                            ${[2, 3, 4, 5].map(v => `<option value="${v}" ${v === currentConfig.seconds ? 'selected' : ''}>${v}s</option>`).join('')}
                        </select>
                    </label>
                    <label class="i2v-field">
                        <span class="i2v-label">FPS</span>
                        <select class="i2v-fps">
                            ${[16, 24].map(v => `<option value="${v}" ${v === currentConfig.fps ? 'selected' : ''}>${v}</option>`).join('')}
                        </select>
                    </label>
                    <label class="i2v-field">
                        <span class="i2v-label">Resolution</span>
                        <select class="i2v-resolution">
                            <option value="480p" ${currentConfig.resolution === '480p' ? 'selected' : ''}>480p</option>
                            <option value="720p" ${currentConfig.resolution === '720p' ? 'selected' : ''}>720p</option>
                        </select>
                    </label>
                </div>
                <div class="i2v-row i2v-toggles-row">
                    <label class="i2v-toggle">
                        <input type="checkbox" class="i2v-enable-loop" ${currentConfig.enable_loop !== false ? 'checked' : ''}>
                        <span class="i2v-toggle-label">Perfect Loop</span>
                    </label>
                    <label class="i2v-toggle">
                        <input type="checkbox" class="i2v-enable-interpolation" ${currentConfig.enable_interpolation !== false ? 'checked' : ''}>
                        <span class="i2v-toggle-label">Interpolation</span>
                    </label>
                </div>
            </div>
            <div class="i2v-modal-footer">
                <button class="i2v-upload-btn" title="Upload Image" style="margin-right: auto;">
                    <span class="material-symbols-outlined">upload</span>
                </button>
                <button class="i2v-generate-btn" title="Generate Video">
                    <span class="material-symbols-outlined">auto_awesome</span>
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        let uploadedFile = null;
        let previewUrl = null;

        // Upload button behavior
        const uploadBtn = modal.querySelector('.i2v-upload-btn');
        const previewContainer = modal.querySelector('.i2v-upload-preview');
        const previewImage = previewContainer.querySelector('img');

        uploadBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > 20 * 1024 * 1024) {
                    showError("Dung lượng file vượt quá 20MB.");
                    return;
                }
                uploadedFile = file;
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                previewUrl = URL.createObjectURL(file);
                previewImage.src = previewUrl;
                previewContainer.style.display = 'block';
            };
            input.click();
        });

        // Helpers
        const getValues = () => ({
            prompt: modal.querySelector('.i2v-prompt').value,
            seconds: parseInt(modal.querySelector('.i2v-seconds').value, 10),
            fps: parseInt(modal.querySelector('.i2v-fps').value, 10),
            resolution: modal.querySelector('.i2v-resolution').value,
            enable_loop: modal.querySelector('.i2v-enable-loop').checked,
            enable_interpolation: modal.querySelector('.i2v-enable-interpolation').checked,
        });

        const saveConfig = async () => {
            const values = getValues();
            try {
                await this.api.album.post(`/${charHash}/i2v/config`, values);
            } catch (err) {
                console.warn('[Album I2V] Failed to save config:', err);
            }
        };

        const btnSysPrompts = modal.querySelector('.i2v-btn-sysprompts');
        const btnGenPrompt = modal.querySelector('.i2v-btn-genprompt');
        const btnGenImage = modal.querySelector('.i2v-btn-genimage');
        const promptTextarea = modal.querySelector('.i2v-prompt');

        btnSysPrompts.addEventListener('click', () => {
            this._openI2VSysPromptsModal(charHash);
        });

        let currentAbortController = null;

        const setUIState = (isGenerating) => {
            promptTextarea.disabled = isGenerating;
            const uploadBtnLocal = modal.querySelector('.i2v-upload-btn');
            const generateBtnLocal = modal.querySelector('.i2v-generate-btn');
            const closeBtnLocal = modal.querySelector('.i2v-modal-close');
            const btnCancel = modal.querySelector('.i2v-btn-cancel');

            if (btnSysPrompts) btnSysPrompts.style.display = isGenerating ? 'none' : 'block';
            if (btnGenPrompt) btnGenPrompt.style.display = isGenerating ? 'none' : 'block';
            if (btnGenImage) btnGenImage.style.display = isGenerating ? 'none' : 'block';
            if (btnCancel) btnCancel.style.display = isGenerating ? 'block' : 'none';

            [uploadBtnLocal, generateBtnLocal, closeBtnLocal].forEach(btn => {
                if (btn) {
                    btn.disabled = isGenerating;
                    btn.style.pointerEvents = isGenerating ? 'none' : 'auto';
                    btn.style.opacity = isGenerating ? '0.5' : '1';
                }
            });
        };

        const btnCancel = modal.querySelector('.i2v-btn-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                if (currentAbortController) {
                    currentAbortController.abort();
                }
            });
        }

        const animateGenerating = (inputEl) => {
            inputEl.oldValue = inputEl.value;
            inputEl.value = "Đang kết nối...";
            let dots = 0;
            const interval = setInterval(() => {
                dots = (dots + 1) % 4;
                inputEl.value = "Đang kết nối" + ".".repeat(dots);
            }, 500);
            return () => clearInterval(interval);
        };

        const handleStreamResponse = async (res, textarea) => {
            if (!res.ok) throw new Error(await res.text());
            textarea.value = "";
            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    if (chunk.includes('<CLEAR>')) {
                        const parts = chunk.split('<CLEAR>');
                        textarea.value = parts[parts.length - 1];
                    } else {
                        textarea.value += chunk;
                    }
                    textarea.scrollTop = textarea.scrollHeight;
                }
            }
        };

        btnGenPrompt.addEventListener('click', async () => {
            const currentVal = promptTextarea.value;
            setUIState(true);
            const stopAnimation = animateGenerating(promptTextarea);
            currentAbortController = new AbortController();

            try {
                const authToken = localStorage.getItem('yuuka-auth-token');
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                const res = await fetch(`/api/plugin/album/${charHash}/i2v/prompt_generate`, {
                    method: 'POST', body: JSON.stringify({ prompt: currentVal }), headers: headers,
                    signal: currentAbortController.signal
                });

                stopAnimation();
                await handleStreamResponse(res, promptTextarea);
                saveConfig(); // Auto save when stream completed
            } catch (err) {
                stopAnimation();
                promptTextarea.value = currentVal;
                if (err.name !== 'AbortError') {
                    showError("Lỗi tạo prompt: " + (err.message || err));
                }
            } finally {
                setUIState(false);
                currentAbortController = null;
            }
        });

        btnGenImage.addEventListener('click', async () => {
            let activeImageId = imageItem?.id;
            const currentVal = promptTextarea.value;

            if (uploadedFile) {
                setUIState(true);
                promptTextarea.value = "Đang tải ảnh lên...";
                try {
                    const formData = new FormData();
                    formData.append('image', uploadedFile);
                    const authToken = localStorage.getItem('yuuka-auth-token');
                    const headers = {};
                    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
                    const res = await fetch(`/api/plugin/album/${charHash}/i2v/upload`, {
                        method: 'POST', body: formData, headers: headers
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const data = await res.json();
                    activeImageId = data.image.id;
                    imageItem = data.image; // Re-assign so later 'Generate Video' uses it
                    uploadedFile = null;
                } catch (e) {
                    setUIState(false);
                    promptTextarea.value = currentVal;
                    showError("Lỗi upload ảnh tạm thời: " + (e.message || e));
                    return;
                }
                setUIState(false);
            }

            if (!activeImageId) {
                showError("Không có ảnh để xử lý!");
                return;
            }

            setUIState(true);
            const stopAnimation = animateGenerating(promptTextarea);
            currentAbortController = new AbortController();

            try {
                const authToken = localStorage.getItem('yuuka-auth-token');
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                const res = await fetch(`/api/plugin/album/${charHash}/i2v/image_caption`, {
                    method: 'POST',
                    body: JSON.stringify({ image_id: activeImageId, prompt: currentVal }),
                    headers: headers,
                    signal: currentAbortController.signal
                });

                stopAnimation();
                await handleStreamResponse(res, promptTextarea);
                saveConfig(); // Auto save when stream completed
            } catch (err) {
                stopAnimation();
                promptTextarea.value = currentVal;
                if (err.name !== 'AbortError') {
                    showError("Lỗi mô tả ảnh: " + (err.message || err));
                }
            } finally {
                setUIState(false);
                currentAbortController = null;
            }
        });

        const closeModal = async () => {
            await saveConfig();
            overlay.remove();
        };

        // Close button
        modal.querySelector('.i2v-modal-close').addEventListener('click', () => closeModal());

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        // ESC key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                document.removeEventListener('keydown', escHandler, true);
                closeModal();
            }
        };
        document.addEventListener('keydown', escHandler, true);

        // Generate button
        modal.querySelector('.i2v-generate-btn').addEventListener('click', async () => {
            await saveConfig();
            overlay.remove();
            document.removeEventListener('keydown', escHandler, true);

            // Close simple viewer automatically if callback provided
            if (closeViewerFn && typeof closeViewerFn === 'function') {
                closeViewerFn();
            }

            let generationImageId = imageItem?.id;

            if (uploadedFile) {
                try {
                    const formData = new FormData();
                    formData.append('image', uploadedFile);

                    const authToken = localStorage.getItem('yuuka-auth-token');
                    const headers = {};
                    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                    const res = await fetch(`/api/plugin/album/${charHash}/i2v/upload`, {
                        method: 'POST',
                        body: formData,
                        headers: headers
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const data = await res.json();
                    generationImageId = data.image.id;

                    // Add the image to grid seamlessly
                    this.state.allImageData = this.state.allImageData || [];
                    this.state.allImageData.unshift(data.image);
                    if (typeof this._renderImageGrid === 'function') {
                        this._renderImageGrid();
                    }
                } catch (err) {
                    showError(`Lỗi upload: ${err.message || err}`);
                    return;
                }
            }

            // Start I2V generation
            if (!generationImageId) {
                showError('Không tìm thấy ảnh nguồn.');
                return;
            }

            const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
            if (tasksForThisChar >= 5) {
                showError('Đã đạt giới hạn 5 tác vụ đồng thời.');
                return;
            }

            // Create placeholder task in grid
            let tempTaskId = `temp_i2v_${Date.now()}`;
            try {
                const grid = this.contentArea.querySelector('.plugin-album__grid');
                if (grid) {
                    const placeholder = this._createPlaceholderCard(tempTaskId);
                    grid.prepend(placeholder);
                    const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                    if (emptyMsg) emptyMsg.style.display = 'none';
                }
                this._updateNav();

                const response = await this.api.album.post(`/${charHash}/i2v/start`, {
                    image_id: generationImageId,
                });

                const tempPlaceholder = document.getElementById(tempTaskId);
                if (tempPlaceholder) {
                    tempPlaceholder.id = response.task_id;
                    const cancelButton = tempPlaceholder.querySelector('.plugin-album__cancel-btn');
                    if (cancelButton) {
                        cancelButton.dataset.taskId = response.task_id;
                    }
                }

                try { Yuuka.events.emit('generation:task_created_locally', response); } catch { }
            } catch (err) {
                document.getElementById(tempTaskId)?.remove();
                showError(`I2V thất bại: ${err.message}`);
                this._updateNav();
            }
        });
    };

    proto._openI2VSysPromptsModal = async function (charHash) {
        let currentSysPrompts;
        try {
            currentSysPrompts = await this.api.album.get(`/${charHash}/i2v/sys_prompts`);
        } catch {
            currentSysPrompts = {
                I2V_SysPrompt: '', I2V_SysPrompt_secondary: '', I2V_SysPrompt_active_tab: 'primary',
                I2V_SysICap: '', I2V_SysICap_secondary: '', I2V_SysICap_active_tab: 'primary',
            };
        }

        const promptActiveTab = currentSysPrompts.I2V_SysPrompt_active_tab || 'primary';
        const icapActiveTab = currentSysPrompts.I2V_SysICap_active_tab || 'primary';

        const overlay = document.createElement('div');
        overlay.className = 'plugin-album__i2v-overlay';
        overlay.style.zIndex = '100000';
        const modal = document.createElement('div');
        modal.className = 'plugin-album__i2v-modal';
        modal.innerHTML = `
            <div class="i2v-modal-header">
                <span class="i2v-modal-title">Edit System Prompts</span>
                <button class="i2v-modal-close" title="Đóng">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <div class="i2v-modal-body">
                <div class="i2v-field">
                    <div class="i2v-sysprompt-section-header">
                        <span class="i2v-label" style="margin-bottom: 0;">Prompt Generator</span>
                        <div class="i2v-sysprompt-tabs" data-section="prompt">
                            <button type="button" class="i2v-sysprompt-tab ${promptActiveTab === 'primary' ? 'is-active' : ''}" data-tab="primary" title="Chính">
                                <span class="i2v-tab-dot"></span>Chính
                            </button>
                            <button type="button" class="i2v-sysprompt-tab ${promptActiveTab === 'secondary' ? 'is-active' : ''}" data-tab="secondary" title="Phụ">
                                <span class="i2v-tab-dot"></span>Phụ
                            </button>
                        </div>
                    </div>
                    <textarea id="sys_prompt_primary" class="i2v-prompt i2v-sysprompt-textarea" data-section="prompt" data-tab="primary" rows="10" style="display: ${promptActiveTab === 'primary' ? 'block' : 'none'};">${_escapeHtml(currentSysPrompts.I2V_SysPrompt || '')}</textarea>
                    <textarea id="sys_prompt_secondary" class="i2v-prompt i2v-sysprompt-textarea" data-section="prompt" data-tab="secondary" rows="10" style="display: ${promptActiveTab === 'secondary' ? 'block' : 'none'};">${_escapeHtml(currentSysPrompts.I2V_SysPrompt_secondary || '')}</textarea>
                </div>
                <div class="i2v-field">
                    <div class="i2v-sysprompt-section-header">
                        <span class="i2v-label" style="margin-bottom: 0;">Image Captioner</span>
                        <div class="i2v-sysprompt-tabs" data-section="icap">
                            <button type="button" class="i2v-sysprompt-tab ${icapActiveTab === 'primary' ? 'is-active' : ''}" data-tab="primary" title="Chính">
                                <span class="i2v-tab-dot"></span>Chính
                            </button>
                            <button type="button" class="i2v-sysprompt-tab ${icapActiveTab === 'secondary' ? 'is-active' : ''}" data-tab="secondary" title="Phụ">
                                <span class="i2v-tab-dot"></span>Phụ
                            </button>
                        </div>
                    </div>
                    <textarea id="sys_icap_primary" class="i2v-prompt i2v-sysprompt-textarea" data-section="icap" data-tab="primary" rows="6" style="display: ${icapActiveTab === 'primary' ? 'block' : 'none'};">${_escapeHtml(currentSysPrompts.I2V_SysICap || '')}</textarea>
                    <textarea id="sys_icap_secondary" class="i2v-prompt i2v-sysprompt-textarea" data-section="icap" data-tab="secondary" rows="6" style="display: ${icapActiveTab === 'secondary' ? 'block' : 'none'};">${_escapeHtml(currentSysPrompts.I2V_SysICap_secondary || '')}</textarea>
                </div>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Tab switching logic
        modal.querySelectorAll('.i2v-sysprompt-tabs').forEach(tabGroup => {
            const section = tabGroup.dataset.section;
            tabGroup.querySelectorAll('.i2v-sysprompt-tab').forEach(tabBtn => {
                tabBtn.addEventListener('click', () => {
                    const targetTab = tabBtn.dataset.tab;
                    // Update active tab button
                    tabGroup.querySelectorAll('.i2v-sysprompt-tab').forEach(b => b.classList.remove('is-active'));
                    tabBtn.classList.add('is-active');
                    // Show/hide textareas
                    modal.querySelectorAll(`.i2v-sysprompt-textarea[data-section="${section}"]`).forEach(ta => {
                        ta.style.display = ta.dataset.tab === targetTab ? 'block' : 'none';
                    });
                });
            });
        });

        const saveAndClose = async () => {
            // Resolve active tabs from button states
            const promptTab = modal.querySelector('.i2v-sysprompt-tabs[data-section="prompt"] .i2v-sysprompt-tab.is-active')?.dataset.tab || 'primary';
            const icapTab = modal.querySelector('.i2v-sysprompt-tabs[data-section="icap"] .i2v-sysprompt-tab.is-active')?.dataset.tab || 'primary';

            const data = {
                I2V_SysPrompt: overlay.querySelector('#sys_prompt_primary').value,
                I2V_SysPrompt_secondary: overlay.querySelector('#sys_prompt_secondary').value,
                I2V_SysPrompt_active_tab: promptTab,
                I2V_SysICap: overlay.querySelector('#sys_icap_primary').value,
                I2V_SysICap_secondary: overlay.querySelector('#sys_icap_secondary').value,
                I2V_SysICap_active_tab: icapTab,
            };
            try {
                await this.api.album.post(`/${charHash}/i2v/sys_prompts`, data);
            } catch (err) {
                console.error("[Album I2V] Failed to save sys prompts", err);
            }
            overlay.remove();
        };

        modal.querySelector('.i2v-modal-close').addEventListener('click', saveAndClose);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) saveAndClose();
        });
    };

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
})();
