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
            }
        });
    };
})();
