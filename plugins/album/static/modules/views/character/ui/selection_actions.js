// Album plugin - View module: character view (Selection actions)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        async _characterSelectState(stateGroupId, stateId) {
            try {
                this._characterEnsureStateModeState?.();
                const gid = String(stateGroupId || '').trim();
                if (!gid) return;

                const sid = String(stateId || '').trim();
                this.state.character.state.selections[gid] = sid || null;
                this._characterSaveStateSelections?.();

                // VN mode: if this state group represents BG, treat selection as background choice.
                try {
                    if (typeof this._characterIsVisualNovelModeEnabled === 'function'
                        && this._characterIsVisualNovelModeEnabled()
                        && typeof this._characterIsVisualNovelBackgroundStateGroup === 'function'
                        && this._characterIsVisualNovelBackgroundStateGroup(gid)) {
                        this._characterEnsureVNState?.();
                        const vn = this.state.character.vn;

                        const bgGroupId = sid ? (this._characterVNResolveBgGroupIdFromStateId?.(sid) || '') : '';
                        vn.activeBgGroupId = bgGroupId || null;
                        vn.activeBgGroupIdOverride = true;
                        try { this._characterVNSaveBgSelection?.(); } catch { }

                        try { this._characterApplyMenuBarModeUI?.(); } catch { }
                        try { await this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false }); } catch { }
                        try { this._characterRefreshDisplayedImage?.(); } catch { }
                        return;
                    }
                } catch { }

                // Manual selection should clear any preset override for this group
                try {
                    if (this.state.character.state.activePresetByGroup) {
                        this.state.character.state.activePresetByGroup[gid] = null;
                        this._characterSaveStateGroupActivePresetIds?.();
                    }
                } catch { }

                try { this._characterApplyMenuBarModeUI?.(); } catch { }

                const presetId = this._characterResolveActivePresetId();
                const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
                if (presetId && !imgs.length) {
                    await this._characterStartGeneration({ forceNew: true, auto: false, presetId: null });
                } else {
                    try { this._characterLoopRequestPlaylistUpdate?.({ reason: 'submenu' }); } catch { }
                    try { this._characterRequestAutoPlayOnNextCharacterImage?.({ reason: 'submenu' }); } catch { }
                    this._characterRefreshDisplayedImage?.();
                }
            } catch { }
        },

        async _characterSelectAutoPresetKey(key) {
            const selMap = this._characterParsePresetKeyToSelectionMap(key);
            this.state.character.activePresetId = `auto:${key}`;
            this._characterSaveActivePresetId();
            const cats = this._characterGetCategoryNames();
            const nextSel = {};
            cats.forEach((c) => {
                const k = String(c || '').trim().toLowerCase();
                nextSel[c] = (k && selMap && Object.prototype.hasOwnProperty.call(selMap, k)) ? (selMap[k] || null) : null;
            });

            // VN mode: auto preset keys intentionally exclude BG category; do not clear BG selection.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bg) {
                        const bgLower = String(bg).trim().toLowerCase();
                        const currentSel = this.state.character?.selections || {};
                        Object.keys(currentSel).forEach(k => {
                            if (String(k).trim().toLowerCase() === bgLower) {
                                nextSel[k] = currentSel[k];
                            }
                        });
                    }
                }
            } catch { }
            this.state.character.selections = nextSel;
            this._characterSaveSelections();
            try { this._characterApplyMenuBarModeUI(); } catch { }

            const presetId = this._characterResolveActivePresetId();
            const imgs = presetId ? this._characterGetImagesForPreset(presetId) : [];
            if (!imgs.length) {
                // User switched to a preset that needs images => cancel auto and run a manual task
                await this._characterStartGeneration({ forceNew: true, auto: false });
            } else {
                try { this._characterLoopRequestPlaylistUpdate?.({ reason: 'submenu' }); } catch { }
                try { this._characterRequestAutoPlayOnNextCharacterImage?.({ reason: 'submenu' }); } catch { }
                this._characterRefreshDisplayedImage();
            }
        },

        async _characterSelectTagGroup(category, groupId) {
            if (!this.state.character.selections) return;
            this.state.character.selections[category] = groupId;
            this._characterSaveSelections();

            // Visual Novel mode: selecting background-category items only affects Background layer.
            // It must NOT affect character presets / character-layer generation.
            try {
                if (this._characterIsVisualNovelModeEnabled() && this._characterIsVisualNovelBackgroundCategory(category)) {
                    this._characterEnsureVNState();
                    const gid = String(groupId || '').trim();
                    this.state.character.vn.activeBgGroupId = gid || null;
                    this.state.character.vn.activeBgGroupIdOverride = true;
                    try { this._characterVNSaveBgSelection?.(); } catch { }

                    // Update main menu labels/titles AFTER VN override is updated.
                    try { this._characterApplyMenuBarModeUI(); } catch { }

                    // Try to apply background immediately (or generate if missing)
                    try {
                        await this._characterVNEnsureBackgroundCacheLoaded();
                        await this._characterVNApplyBackgroundFromSelection({ generateIfMissing: true });
                    } catch { }
                    return;
                }
            } catch { }

            // Update main menu labels/titles for non-BG categories.
            try { this._characterApplyMenuBarModeUI(); } catch { }

            // If user previously picked a saved preset, switching any tag group should
            // move back to auto mode (derived from the current selections).
            // Otherwise, the active preset would keep overriding the selection changes.
            if (this.state.character.activePresetId) {
                const key = this._characterBuildPresetKeyFromSelections(this.state.character.selections);
                const current = String(this.state.character.activePresetId || '');
                if (current.startsWith('auto:')) {
                    this.state.character.activePresetId = key ? `auto:${key}` : null;
                } else {
                    this.state.character.activePresetId = null;
                }
                this._characterSaveActivePresetId();
            }

            // Auto-suggest updates happen on successful non-auto generations (image:added).

            // Auto-generate if the resolved preset has no images
            const presetId = this._characterResolveActivePresetId();
            if (presetId) {
                const imgs = this._characterGetImagesForPreset(presetId);
                if (!imgs.length) {
                    // User changed selection and needs a new image => cancel auto and run a manual task
                    await this._characterStartGeneration({ forceNew: true, auto: false });
                } else {
                    try { this._characterLoopRequestPlaylistUpdate?.({ reason: 'submenu' }); } catch { }
                    try { this._characterRequestAutoPlayOnNextCharacterImage?.({ reason: 'submenu' }); } catch { }
                    this._characterRefreshDisplayedImage();
                }
            }
        },

        async _characterSelectPreset(presetId) {
            const preset = (this.state.character.presets || []).find(p => p?.id === presetId);
            if (!preset) return;
            this.state.character.activePresetId = presetId;
            this._characterSaveActivePresetId();
            // Apply selection
            const sel = preset.selection || {};
            const cats = this._characterGetCategoryNames();
            const nextSel = {};
            cats.forEach(c => { nextSel[c] = sel?.[c] || null; });

            // VN mode: do not let presets override BG selection; BG is per-character.
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    const bg = this._characterGetVisualNovelBackgroundCategoryName?.();
                    if (bg) {
                        const bgLower = String(bg).trim().toLowerCase();
                        const currentSel = this.state.character?.selections || {};
                        Object.keys(currentSel).forEach(k => {
                            if (String(k).trim().toLowerCase() === bgLower) {
                                nextSel[k] = currentSel[k];
                            }
                        });
                    }
                }
            } catch { }
            this.state.character.selections = nextSel;
            this._characterSaveSelections();
            try { this._characterApplyMenuBarModeUI(); } catch { }

            const imgs = this._characterGetImagesForPreset(presetId);
            if (!imgs.length) {
                // User switched to a preset that needs images => cancel auto and run a manual task
                await this._characterStartGeneration({ forceNew: true, presetId, auto: false });
            } else {
                try { this._characterLoopRequestPlaylistUpdate?.({ reason: 'submenu' }); } catch { }
                try { this._characterRequestAutoPlayOnNextCharacterImage?.({ reason: 'submenu' }); } catch { }
                this._characterRefreshDisplayedImage();
            }
        },

        _characterTickPreGen() {
            if (typeof this._characterAutoMaybeSchedule === 'function') {
                this._characterAutoMaybeSchedule(null, { reason: 'tick' });
            }
        },
    });
})();
