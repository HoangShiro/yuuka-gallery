(function () {
    // Module: Album settings modal integration
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    proto.openSettings = async function () {
        if (!this.state.isComfyUIAvaidable) {
            try {
                await this.checkComfyUIStatus();
            } catch (err) {
                console.warn('[Album] Failed to refresh ComfyUI status before opening settings:', err);
            }
        }
        if (!this.state.isComfyUIAvaidable) { showError('ComfyUI chưa kết nối.'); return; }
        const modalApi = window.Yuuka?.plugins?.albumModal;
        if (!modalApi || typeof modalApi.openSettingsModal !== 'function') {
            showError('Album settings UI is not ready.');
            return;
        }
        const currentClipboard = this._getPromptClipboard();
        // Ensure settings are preloaded; if not, this will fetch once here
        await this._preloadComfySettings();

        const _safeCharacterName = (value) => {
            const s = String(value || '').trim();
            if (!s) return '';
            if (s.toLowerCase() === 'unknown') return '';
            return s;
        };

        const _getLocalCharacterSettings = () => {
            try {
                const key = this._LS_CHAR_SETTINGS_KEY || 'yuuka.album.character.settings';
                const raw = localStorage.getItem(key);
                const obj = raw ? JSON.parse(raw) : null;
                return (obj && typeof obj === 'object') ? obj : null;
            } catch {
                return null;
            }
        };

        const _saveLocalCharacterSettings = (partial) => {
            try {
                const key = this._LS_CHAR_SETTINGS_KEY || 'yuuka.album.character.settings';
                const prev = _getLocalCharacterSettings() || {};
                const next = { ...prev, ...(partial && typeof partial === 'object' ? partial : {}) };
                localStorage.setItem(key, JSON.stringify(next));
            } catch { }
        };
        await modalApi.openSettingsModal({
            title: `Cấu hình cho ${this.state.selectedCharacter.name}`,
            modalClass: 'plugin-album__settings-modal',
            viewMode: this.state.viewMode || 'album',
            // Yuuka: comfyui fetch optimization v1.0
            fetchInfo: async () => {
                // Prefer fully preloaded settings (no network call)
                if (this.state.cachedComfySettings) {
                    const info = { ...this.state.cachedComfySettings };
                    if (info.last_config && this.state.selectedCharacter) {
                        const selectedName = _safeCharacterName(this.state.selectedCharacter.name);
                        const configName = _safeCharacterName(info.last_config.character);
                        if (selectedName) {
                            info.last_config.character = selectedName;
                        } else if (configName) {
                            info.last_config.character = configName;
                            this.state.selectedCharacter.name = configName;
                        }
                    }
                    // Also include character-view settings
                    try {
                        info.character_settings = await this.api.album.get('/character/settings');
                    } catch {
                        info.character_settings = { pregen_enabled: true, pregen_category_enabled: {}, pregen_group_enabled: {} };
                    }
                    // Local fallback: if backend doesn't yet return some UI settings, keep them stable.
                    try {
                        const local = _getLocalCharacterSettings();
                        if (local && info.character_settings && typeof info.character_settings.blur_background === 'undefined' && typeof local.blur_background !== 'undefined') {
                            info.character_settings.blur_background = !!local.blur_background;
                        }
                    } catch { }
                    return info;
                }
                let finalInfo = {};
                if (this.state.cachedComfyGlobalChoices) {
                    const configData = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}&no_choices=true`);
                    finalInfo = {
                        last_config: configData.last_config,
                        global_choices: this.state.cachedComfyGlobalChoices
                    };
                } else {
                    const fullData = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
                    if (fullData.global_choices) {
                        this.state.cachedComfyGlobalChoices = fullData.global_choices;
                    }
                    finalInfo = fullData;
                }
                // Store to preload cache for subsequent opens
                if (finalInfo && (finalInfo.last_config || finalInfo.global_choices)) {
                    this.state.cachedComfySettings = {
                        last_config: finalInfo.last_config || {},
                        global_choices: finalInfo.global_choices || this.state.cachedComfyGlobalChoices || null
                    };
                }
                if (finalInfo.last_config && this.state.selectedCharacter) {
                    const selectedName = _safeCharacterName(this.state.selectedCharacter.name);
                    const configName = _safeCharacterName(finalInfo.last_config.character);
                    if (selectedName) {
                        finalInfo.last_config.character = selectedName;
                    } else if (configName) {
                        finalInfo.last_config.character = configName;
                        this.state.selectedCharacter.name = configName;
                    }
                }
                // Include character-view settings
                try {
                    finalInfo.character_settings = await this.api.album.get('/character/settings');
                } catch {
                    finalInfo.character_settings = { pregen_enabled: true, pregen_category_enabled: {}, pregen_group_enabled: {} };
                }
                // Local fallback: if backend doesn't yet return some UI settings, keep them stable.
                try {
                    const local = _getLocalCharacterSettings();
                    if (local && finalInfo.character_settings && typeof finalInfo.character_settings.blur_background === 'undefined' && typeof local.blur_background !== 'undefined') {
                        finalInfo.character_settings.blur_background = !!local.blur_background;
                    }
                } catch { }
                return finalInfo;
            },
            onSave: async (updatedConfig) => {
                // Persist character-view settings if present
                const charSettings = updatedConfig?.__character_settings;
                if (charSettings && typeof charSettings === 'object') {
                    try {
                        const prevVnMode = (typeof this.state.character?.settings?.visual_novel_mode === 'undefined')
                            ? true
                            : !!this.state.character.settings.visual_novel_mode;

                        const prevBlurBackground = (typeof this.state.character?.settings?.blur_background === 'undefined')
                            ? false
                            : !!this.state.character.settings.blur_background;

                        const enabled = !!charSettings.pregen_enabled;
                        const vnMode = (typeof charSettings.visual_novel_mode !== 'undefined') ? !!charSettings.visual_novel_mode : undefined;
                        const blurBg = (typeof charSettings.blur_background !== 'undefined') ? !!charSettings.blur_background : undefined;
                        const extraTagsRaw = (typeof charSettings.character_layer_extra_tags === 'string')
                            ? String(charSettings.character_layer_extra_tags || '').trim()
                            : undefined;

                        // Save UI-only settings to localStorage immediately for persistence even if backend ignores fields.
                        if (typeof blurBg !== 'undefined') {
                            _saveLocalCharacterSettings({ blur_background: blurBg });
                        }

                        const payload = { pregen_enabled: enabled };
                        if (typeof vnMode !== 'undefined') payload.visual_novel_mode = vnMode;
                        if (typeof blurBg !== 'undefined') payload.blur_background = blurBg;
                        if (typeof extraTagsRaw !== 'undefined') payload.character_layer_extra_tags = extraTagsRaw;
                        const latest = await this.api.album.post('/character/settings', payload);

                        // Keep local state in sync (fallback to posted values if backend doesn't echo)
                        const nextSettings = { ...(this.state.character.settings || {}), pregen_enabled: enabled };
                        if (typeof vnMode !== 'undefined') {
                            nextSettings.visual_novel_mode = vnMode;
                        } else if (latest && typeof latest.visual_novel_mode !== 'undefined') {
                            nextSettings.visual_novel_mode = !!latest.visual_novel_mode;
                        }

                        if (typeof blurBg !== 'undefined') {
                            nextSettings.blur_background = blurBg;
                        } else if (latest && typeof latest.blur_background !== 'undefined') {
                            nextSettings.blur_background = !!latest.blur_background;
                        }

                        if (typeof extraTagsRaw !== 'undefined') {
                            nextSettings.character_layer_extra_tags = extraTagsRaw;
                        } else if (latest && typeof latest.character_layer_extra_tags === 'string') {
                            nextSettings.character_layer_extra_tags = String(latest.character_layer_extra_tags || '').trim();
                        }
                        this.state.character.settings = nextSettings;

                        // Immediately suspend/resume scheduler (also cancels any in-flight scheduling pass).
                        try {
                            const pregen = this.state.character.pregen || (this.state.character.pregen = {});
                            const sid = Number(pregen.sessionId || 0);
                            pregen.sessionId = Number.isFinite(sid) ? (sid + 1) : 1;
                            pregen.suspended = !enabled;
                            if (!enabled) pregen.isScheduling = false;
                        } catch { }

                        // If user disabled auto tasks, cancel any running auto task immediately.
                        if (this.state.viewMode === 'character' && enabled === false) {
                            try {
                                await this._characterCancelRunningAutoTask({ silent: true, suspend: true });
                            } catch { }
                        }
                        // If user enabled it, resume scheduling.
                        if (this.state.viewMode === 'character' && enabled === true) {
                            try {
                                this.state.character.pregen.suspended = false;
                                this._characterAutoMaybeSchedule(null, { reason: 'settings-enabled' });
                            } catch { }
                        }

                        // If VN mode toggled while in character view, refresh immediately.
                        if (this.state.viewMode === 'character') {
                            const nextVnMode = (typeof this.state.character?.settings?.visual_novel_mode === 'undefined')
                                ? true
                                : !!this.state.character.settings.visual_novel_mode;
                            const vnChanged = (typeof vnMode !== 'undefined') && (prevVnMode !== nextVnMode);

                            const nextBlurBackground = (typeof this.state.character?.settings?.blur_background === 'undefined')
                                ? false
                                : !!this.state.character.settings.blur_background;
                            const blurChanged = (typeof blurBg !== 'undefined') && (prevBlurBackground !== nextBlurBackground);

                            // VN toggle changes how auto preset keys are derived (BG category included/excluded).
                            // Normalize activePresetId now so preset UI highlights and image resolution match the new mode.
                            if (vnChanged) {
                                // Reset submenu state so first click opens fresh after rerender.
                                try { this.state.character.activeMenu = null; } catch { }

                                // When entering VN mode, restore per-character BG override immediately.
                                try {
                                    if (nextVnMode === true) {
                                        const h = String(this.state?.selectedCharacter?.hash || '').trim();
                                        if (h && typeof this._characterVNRestoreSavedBgSelection === 'function') {
                                            this._characterVNRestoreSavedBgSelection(h);
                                        }
                                    }
                                } catch { }

                                try {
                                    const current = String(this.state.character?.activePresetId || '').trim();
                                    const key = (typeof this._characterBuildPresetKeyFromSelections === 'function')
                                        ? this._characterBuildPresetKeyFromSelections(this.state.character?.selections || {})
                                        : '';
                                    if (current) {
                                        if (current.startsWith('auto:')) {
                                            this.state.character.activePresetId = key ? `auto:${key}` : null;
                                        } else {
                                            // Saved presets may encode selections incompatible across mode changes; fall back to auto.
                                            this.state.character.activePresetId = null;
                                        }
                                        try { this._characterSaveActivePresetId?.(); } catch { }
                                    }
                                } catch { }

                                // Auto-suggest preset keys depend on "required categories" which differs in VN mode.
                                // Recompute now so the Preset submenu doesn't show a stale list.
                                try { this._characterAutoSuggestRecomputePresets?.(); } catch { }
                            }

                            if (vnChanged) {
                                try { this._characterRender?.(); } catch { }
                                // Ensure BG layer + derived preset pointers apply immediately after entering VN.
                                try {
                                    if (nextVnMode === true) {
                                        await this._characterVNEnsureBackgroundCacheLoaded?.();
                                        await this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false });
                                    }
                                } catch { }
                            } else if (blurChanged) {
                                // Blur toggle affects only presentation; apply without full rerender.
                                try { this._characterApplyVNBlurUI?.(); } catch { }
                            } else {
                                try { this._characterRefreshDisplayedImage?.(); } catch { }
                            }
                            try { this._characterAutoMaybeSchedule?.(null, { reason: 'vn-mode-changed' }); } catch { }
                        }
                    } catch (err) {
                        console.warn('[Album] Failed to save character settings:', err);
                    }
                }
                // Never send these fields to comfy config endpoint
                try {
                    delete updatedConfig.__character_settings;
                    delete updatedConfig.__character_pregen_enabled;
                } catch { }
                await this.api.album.post(`/${this.state.selectedCharacter.hash}/config`, updatedConfig);
                const trimmedName = (updatedConfig.character || '').trim();
                if (trimmedName) {
                    updatedConfig.character = trimmedName;
                    this.state.selectedCharacter.name = trimmedName;
                } else if (this.state.selectedCharacter && this.state.selectedCharacter.isCustom) {
                    this.state.selectedCharacter.name = 'Album mới';
                    updatedConfig.character = this.state.selectedCharacter.name;
                } else {
                    updatedConfig.character = this.state.selectedCharacter?.name || '';
                }
                // Update preload cache after saving so next open is instant and up to date
                this.state.cachedComfySettings = {
                    last_config: { ...(this.state.cachedComfySettings?.last_config || {}), ...updatedConfig },
                    global_choices: this.state.cachedComfyGlobalChoices || this.state.cachedComfySettings?.global_choices || null
                };
            },
            onGenerate: async (updatedConfig) => {
                await this._startGeneration(updatedConfig);
            },
            promptClipboard: currentClipboard,
            getPromptClipboard: () => this._getPromptClipboard(),
            setPromptClipboard: (value) => this._setPromptClipboard(value),
            // Yuuka: comfyui fetch optimization v1.0
            onConnect: async (address, btn, close) => {
                btn.textContent = '...';
                btn.disabled = true;
                try {
                    await this.api.server.checkComfyUIStatus(address);
                    // Xóa toàn bộ cache để nạp lại từ server mới
                    this.state.cachedComfyGlobalChoices = null;
                    this.state.cachedComfySettings = null;
                    close(); // Đóng modal hiện tại
                    await this.openSettings(); // Mở lại để tải lại dữ liệu mới
                } catch (e) {
                    showError(`Lỗi kết nối hoặc làm mới: ${e.message}`);
                    // Nút sẽ tự reset khi người dùng mở lại modal
                }
            },
            onDelete: async () => {
                const current = this.state.selectedCharacter;
                if (!current?.hash) {
                    throw new Error('Không xác định được album đang mở.');
                }
                await this.api.album.delete(`/${current.hash}`);
                showError('Album đã được xóa.');
                this.state.selectedCharacter = null;
                this.state.allImageData = [];
                this.state.cachedComfyGlobalChoices = null;
                this.state.cachedComfySettings = null;
                this.state.viewMode = 'grid';
                await this.showCharacterSelectionGrid();
                this._updateNav();
            },
            onUpload: async (file) => {
                const current = this.state.selectedCharacter;
                if (!current?.hash) {
                    throw new Error('Không xác định được album đang mở.');
                }
                const formData = new FormData();
                formData.append('image', file);

                const placeholder = { id: 'uploading-placeholder', pv_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
                this.state.allImageData = this.state.allImageData || [];
                this.state.allImageData.unshift(placeholder);
                if (typeof this._renderImageGrid === 'function') this._renderImageGrid();

                try {
                    const authToken = localStorage.getItem('yuuka-auth-token');
                    const headers = {};
                    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                    const res = await fetch(`/api/plugin/album/${current.hash}/i2v/upload`, {
                        method: 'POST',
                        body: formData,
                        headers: headers
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const data = await res.json();

                    const idx = this.state.allImageData.findIndex(img => img.id === 'uploading-placeholder');
                    if (idx !== -1) {
                        this.state.allImageData[idx] = data.image;
                    } else {
                        this.state.allImageData.unshift(data.image);
                    }
                } catch (err) {
                    const idx = this.state.allImageData.findIndex(img => img.id === 'uploading-placeholder');
                    if (idx !== -1) this.state.allImageData.splice(idx, 1);
                    throw err;
                } finally {
                    if (typeof this._renderImageGrid === 'function') this._renderImageGrid();
                }
            },
            onSysPrompts: () => this._openSettingsSysPromptsModal(this.state.selectedCharacter.hash),
            onGeneratePrompt: (dialog, form, btnGen, btnCancel) => this._generateSettingsPrompt(this.state.selectedCharacter.hash, dialog, form, btnGen, btnCancel)
        });
    };
    proto._openSettingsSysPromptsModal = async function (charHash) {
        if (!charHash) return;
        const _save = async (data) => {
            try {
                await fetch(`/api/plugin/album/${charHash}/settings/sys_prompts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('yuuka-auth-token')}`
                    },
                    body: JSON.stringify(data)
                });
            } catch (err) {
                console.warn('[Album Settings] Failed to save sys prompts config:', err);
            }
        };

        try {
            const res = await fetch(`/api/plugin/album/${charHash}/settings/sys_prompts`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('yuuka-auth-token')}` }
            });
            let initialData = {
                sys_prompt: "You are a creative and expert prompt generator. Create highly detailed and cinematic booru tags for the character's outfits, expression, action, and context based on the user's description. Use rich, varied vocabulary and focus on visual aesthetics.",
                sys_prompt_secondary: "",
                sys_prompt_active_tab: "primary",
                enabled_fields: { outfits: true, expression: true, action: true, context: true, use_current_tags: true }
            };
            if (res.ok) {
                const data = await res.json();
                if (data) initialData = { ...initialData, ...data };
            }

            const activeTab = initialData.sys_prompt_active_tab || 'primary';

            const _escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[m]);

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
                    <style>
                        .album-settings-fields-toggles { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
                        .album-settings-toggle-btn { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent; color: var(--text-color); cursor: pointer; opacity: 0.5; transition: all 0.2s; font-size: 0.9em; }
                        .album-settings-toggle-btn.active { opacity: 1; border-color: var(--primary-color); background: rgba(var(--primary-color-rgb), 0.1); }
                    </style>

                    <div class="i2v-field">
                        <div class="i2v-sysprompt-section-header">
                            <span class="i2v-label" style="margin-bottom: 0;">Enabled Fields</span>
                        </div>
                        <div class="album-settings-fields-toggles">
                            <button type="button" class="album-settings-toggle-btn ${initialData.enabled_fields?.outfits !== false ? 'active' : ''}" data-field="outfits">Outfits</button>
                            <button type="button" class="album-settings-toggle-btn ${initialData.enabled_fields?.expression !== false ? 'active' : ''}" data-field="expression">Expression</button>
                            <button type="button" class="album-settings-toggle-btn ${initialData.enabled_fields?.action !== false ? 'active' : ''}" data-field="action">Action</button>
                            <button type="button" class="album-settings-toggle-btn ${initialData.enabled_fields?.context !== false ? 'active' : ''}" data-field="context">Context</button>
                            <button type="button" class="album-settings-toggle-btn ${initialData.enabled_fields?.use_current_tags !== false ? 'active' : ''}" data-field="use_current_tags" title="Gửi kèm các tag hiện tại làm base cho LLM tham khảo (trừ Negative)">Use the current tags</button>
                        </div>
                    </div>

                    <div class="i2v-field">
                        <div class="i2v-sysprompt-section-header">
                            <span class="i2v-label" style="margin-bottom: 0;">Prompt Generator</span>
                            <div class="i2v-sysprompt-tabs" data-section="prompt">
                                <button type="button" class="i2v-sysprompt-tab ${activeTab === 'primary' ? 'is-active' : ''}" data-tab="primary" title="Chính">
                                    <span class="i2v-tab-dot"></span>Chính
                                </button>
                                <button type="button" class="i2v-sysprompt-tab ${activeTab === 'secondary' ? 'is-active' : ''}" data-tab="secondary" title="Phụ">
                                    <span class="i2v-tab-dot"></span>Phụ
                                </button>
                            </div>
                        </div>
                        <textarea id="sys_prompt_primary" class="i2v-prompt i2v-sysprompt-textarea" data-section="prompt" data-tab="primary" rows="12" style="display: ${activeTab === 'primary' ? 'block' : 'none'};">${_escapeHtml(initialData.sys_prompt || '')}</textarea>
                        <textarea id="sys_prompt_secondary" class="i2v-prompt i2v-sysprompt-textarea" data-section="prompt" data-tab="secondary" rows="12" style="display: ${activeTab === 'secondary' ? 'block' : 'none'};">${_escapeHtml(initialData.sys_prompt_secondary || '')}</textarea>
                    </div>
                </div>
                <div class="i2v-modal-footer"></div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Toggles
            const toggles = modal.querySelectorAll('.album-settings-toggle-btn');
            toggles.forEach(btn => {
                btn.addEventListener('click', () => btn.classList.toggle('active'));
            });

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

            const getValues = () => {
                const enabled_fields = {};
                toggles.forEach(btn => {
                    enabled_fields[btn.getAttribute('data-field')] = btn.classList.contains('active');
                });

                const getActiveTab = (section) => {
                    const activeTabBtn = modal.querySelector(`.i2v-sysprompt-tabs[data-section="${section}"] .i2v-sysprompt-tab.is-active`);
                    return activeTabBtn ? activeTabBtn.dataset.tab : 'primary';
                };

                return {
                    sys_prompt: modal.querySelector('#sys_prompt_primary').value,
                    sys_prompt_secondary: modal.querySelector('#sys_prompt_secondary').value,
                    sys_prompt_active_tab: getActiveTab('prompt'),
                    enabled_fields: enabled_fields
                };
            };

            const closeModal = async () => {
                await _save(getValues());
                overlay.remove();
            };

            modal.querySelector('.i2v-modal-close').addEventListener('click', () => closeModal());

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal();
            });

            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    document.removeEventListener('keydown', escHandler, true);
                    closeModal();
                }
            };
            document.addEventListener('keydown', escHandler, true);

        } catch (e) {
            showError(`Gặp lỗi khi lấy cấu hình: ${e.message}`);
        }
    };

    proto._generateSettingsPrompt = async function (charHash, dialog, form, btnGen, btnCancel) {
        if (!charHash) return;
        const charInput = form.elements['character'];
        const userPrompt = charInput.value.trim();

        const targets = {
            outfits: form.elements['outfits'],
            expression: form.elements['expression'],
            action: form.elements['action'],
            context: form.elements['context']
        };

        const inputsToDisable = Array.from(form.querySelectorAll('input, select, textarea, button:not(.btn-cancel):not(.album-btn-cancel)'));

        const currentTags = {
            outfits: form.elements['outfits']?.value || '',
            expression: form.elements['expression']?.value || '',
            action: form.elements['action']?.value || '',
            context: form.elements['context']?.value || '',
            quality: form.elements['quality']?.value || ''
        };

        let abortController = new AbortController();

        btnGen.style.display = 'none';
        btnCancel.style.display = '';
        inputsToDisable.forEach(el => el.disabled = true);

        const onCancel = () => {
            if (abortController) {
                abortController.abort();
            }
        };
        btnCancel.addEventListener('click', onCancel);

        const cleanupUI = () => {
            btnCancel.removeEventListener('click', onCancel);
            btnCancel.style.display = 'none';
            btnGen.style.display = '';
            inputsToDisable.forEach(el => el.disabled = false);
        };

        try {
            const res = await fetch(`/api/plugin/album/${charHash}/settings/prompt_generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('yuuka-auth-token')}`
                },
                body: JSON.stringify({ prompt: userPrompt, current_tags: currentTags }),
                signal: abortController.signal
            });

            if (!res.ok) {
                const raw = await res.text();
                throw new Error(raw);
            }

            // Clear values before streaming
            for (const key in targets) {
                if (targets[key]) targets[key].value = '';
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;

                    if (buffer.includes('<CLEAR>')) {
                        buffer = buffer.replace('<CLEAR>', '');
                        for (const key in targets) {
                            if (targets[key]) targets[key].value = '';
                        }
                    }

                    // Direct matching: regex dynamically extracts values for 4 fields
                    // Value capturing ends at the next double quote
                    for (const key in targets) {
                        if (targets[key]) {
                            const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*)`);
                            const match = buffer.match(regex);
                            if (match) {
                                targets[key].value = match[1];
                            }
                        }
                    }
                }
            }

            showError("Tạo prompt thành công.");
        } catch (e) {
            if (e.name === 'AbortError') {
                showError("Đã hủy tạo prompt.");
            } else {
                showError(`Lỗi tạo prompt: ${e.message}`);
                console.error(e);
            }
        } finally {
            cleanupUI();
        }
    };
})();
