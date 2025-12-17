// Album plugin - View module: character view (Main)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        async openCharacterView(selected) {
            this._characterTeardown();
            this.state.selectedCharacter = selected;
            this.state.cachedComfyGlobalChoices = null;
            this.state.cachedComfySettings = null;
            this.state.allImageData = [];
            this.state.viewMode = 'character';
            this._syncDOMSelection();

            // Ensure UI settings are loaded (menu bar mode + main menu mode)
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character.ui) this.state.character.ui = {};
                if (typeof this.state.character.ui.menuBarMode === 'undefined' && typeof this._characterLoadMenuBarMode === 'function') {
                    this.state.character.ui.menuBarMode = this._characterLoadMenuBarMode();
                }
                if (typeof this.state.character.ui.menuMode === 'undefined' && typeof this._characterLoadMainMenuMode === 'function') {
                    this.state.character.ui.menuMode = this._characterLoadMainMenuMode();
                }
            } catch { }

            // Ensure state-mode state container exists
            try { this._characterEnsureStateModeState?.(); } catch { }

            // New session for character auto tasks
            try {
                const pregen = this.state.character.pregen;
                pregen.sessionId = (pregen.sessionId || 0) + 1;
                pregen.sessionAutoImagesStarted = 0;
                pregen.suspended = false;
                pregen.isScheduling = false;
                pregen.lastScheduleAt = 0;
            } catch { }

            await this._characterLoadInitialData();
            this._characterRender();

            // Auto-suggest presets: bootstrap a recent-image tag model (non-blocking).
            try {
                if (typeof this._characterAutoSuggestBootstrap === 'function') {
                    this._characterAutoSuggestBootstrap({ limit: 1000 });
                }
            } catch { }

            // Auto scheduling starts immediately (no idle delay)
            try { this._characterAutoMaybeSchedule(null, { reason: 'open' }); } catch { }

            this._updateNav();
        },

        async _characterLoadInitialData() {
            const characterHash = this.state?.selectedCharacter?.hash;
            if (!characterHash) return;

            this.updateUI('loading', `Đang tải Character view...`);

            // Load images (for display + preset filtering)
            try {
                const images = await this.api.images.getByCharacter(characterHash);
                this.state.allImageData = Array.isArray(images) ? images : [];
            } catch {
                this.state.allImageData = [];
            }

            // Load tag groups + presets + settings
            try {
                const [tagGroups, presetsPayload, stateGroupsPayload, statesPayload] = await Promise.all([
                    this.api.album.get('/character/tag_groups'),
                    this.api.album.get(`/character/${encodeURIComponent(characterHash)}/presets`),
                    this.api.album.get('/character/state_groups'),
                    this.api.album.get('/character/states'),
                ]);
                this.state.character.tagGroups = tagGroups || { grouped: {}, flat: {} };
                this.state.character.presets = Array.isArray(presetsPayload?.presets) ? presetsPayload.presets : [];
                this.state.character.favourites = presetsPayload?.favourites && typeof presetsPayload.favourites === 'object' ? presetsPayload.favourites : {};

                // State mode: state groups + states (global per-user)
                try {
                    this._characterEnsureStateModeState?.();
                    this.state.character.state.groups = Array.isArray(stateGroupsPayload) ? stateGroupsPayload : [];
                    this.state.character.state.states = Array.isArray(statesPayload) ? statesPayload : [];
                    if (!this.state.character.state.presetsByGroup) this.state.character.state.presetsByGroup = {};
                    if (!this.state.character.state.activePresetByGroup) this.state.character.state.activePresetByGroup = {};
                } catch { }
                const settingsPayload = presetsPayload?.settings && typeof presetsPayload.settings === 'object' ? presetsPayload.settings : null;
                const categories = this._characterNormalizeCategories(settingsPayload?.categories);
                this.state.character.categories = categories.length ? categories : this._characterDefaultCategories();
                // Default ON if backend omits the flag.
                const pregenEnabled = (settingsPayload && typeof settingsPayload.pregen_enabled !== 'undefined')
                    ? !!settingsPayload.pregen_enabled
                    : true;

                const visualNovelMode = (settingsPayload && typeof settingsPayload.visual_novel_mode !== 'undefined')
                    ? !!settingsPayload.visual_novel_mode
                    : true;

                const blurBackground = (settingsPayload && typeof settingsPayload.blur_background !== 'undefined')
                    ? !!settingsPayload.blur_background
                    : (() => {
                        try {
                            const key = this._LS_CHAR_SETTINGS_KEY || 'yuuka.album.character.settings';
                            const raw = localStorage.getItem(key);
                            const obj = raw ? JSON.parse(raw) : null;
                            if (obj && typeof obj.blur_background !== 'undefined') return !!obj.blur_background;
                        } catch { }
                        return false;
                    })();

                const characterLayerExtraTags = (settingsPayload && typeof settingsPayload.character_layer_extra_tags === 'string')
                    ? String(settingsPayload.character_layer_extra_tags || '').trim()
                    : 'simple background, gray background';

                const backgroundLayerExtraTags = (settingsPayload && typeof settingsPayload.background_layer_extra_tags === 'string')
                    ? String(settingsPayload.background_layer_extra_tags || '').trim()
                    : '';

                const catEnabledRaw = settingsPayload?.pregen_category_enabled;
                const groupEnabledRaw = settingsPayload?.pregen_group_enabled;
                const catEnabled = (catEnabledRaw && typeof catEnabledRaw === 'object') ? { ...catEnabledRaw } : {};
                const groupEnabled = (groupEnabledRaw && typeof groupEnabledRaw === 'object') ? { ...groupEnabledRaw } : {};
                // Ensure current categories exist in the map (default true)
                try {
                    this.state.character.categories.forEach(c => {
                        const n = String(c?.name || '').trim();
                        if (!n) return;
                        if (typeof catEnabled[n] === 'undefined') catEnabled[n] = true;
                    });
                } catch { }
                this.state.character.settings = { pregen_enabled: pregenEnabled, visual_novel_mode: visualNovelMode, blur_background: blurBackground, character_layer_extra_tags: characterLayerExtraTags, background_layer_extra_tags: backgroundLayerExtraTags, pregen_category_enabled: catEnabled, pregen_group_enabled: groupEnabled };
            } catch (err) {
                console.warn('[Album] Failed to load character view data:', err);
                this.state.character.tagGroups = { grouped: {}, flat: {} };
                this.state.character.presets = [];
                this.state.character.favourites = {};
                this.state.character.categories = this._characterDefaultCategories();
                this.state.character.settings = { pregen_enabled: true, visual_novel_mode: true, blur_background: false, character_layer_extra_tags: 'simple background, gray background', background_layer_extra_tags: '', pregen_category_enabled: {}, pregen_group_enabled: {} };

                // State mode fallback
                try {
                    this._characterEnsureStateModeState?.();
                    this.state.character.state.groups = [];
                    this.state.character.state.states = [];
                    this.state.character.state.presetsByGroup = {};
                    this.state.character.state.activePresetByGroup = {};
                } catch { }
            }

            // Restore last selections from localStorage (per character)
            this.state.character.selections = this._characterLoadSelections(characterHash, this._characterGetCategoryNames());
            this.state.character.activePresetId = this._characterLoadActivePresetId(characterHash);

            // State mode: restore per-character state selections (per state group)
            try {
                this._characterEnsureStateModeState?.();
                const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                this.state.character.state.selections = this._characterLoadStateSelections?.(characterHash, groups) || {};
                this.state.character.state.activePresetByGroup = this._characterLoadStateGroupActivePresetIds?.(characterHash, groups) || {};

                // Hygiene: prune missing state ids + presets
                const states = Array.isArray(this.state.character.state.states) ? this.state.character.state.states : [];
                const stateById = new Set(states.map(s => String(s?.id || '').trim()).filter(Boolean));
                const sel = (this.state.character.state.selections && typeof this.state.character.state.selections === 'object')
                    ? { ...this.state.character.state.selections }
                    : {};
                let selChanged = false;
                Object.keys(sel).forEach(gid => {
                    const sid = String(sel[gid] || '').trim();
                    if (!sid) return;
                    if (sid === '__none__') {
                        sel[gid] = null;
                        selChanged = true;
                        return;
                    }
                    if (!stateById.has(sid)) {
                        sel[gid] = null;
                        selChanged = true;
                    }
                });
                if (selChanged) {
                    this.state.character.state.selections = sel;
                    this._characterSaveStateSelections?.();
                }
            } catch { }

            // VN mode: restore per-character background selection override (if previously set).
            // If the saved BG group no longer exists, fall back to None.
            try {
                if (typeof this._characterVNRestoreSavedBgSelection === 'function') {
                    const restored = this._characterVNRestoreSavedBgSelection(characterHash);
                    if (restored) {
                        try { await this._characterVNEnsureBackgroundCacheLoaded?.(); } catch { }
                        try { await this._characterVNApplyBackgroundFromSelection?.({ generateIfMissing: false }); } catch { }
                    }
                }
            } catch { }

            // Auto-save hygiene: prune selections that reference tag groups that no longer exist.
            // This prevents stale localStorage ids from keeping the UI in a broken/empty state.
            try {
                const flat = this.state.character.tagGroups?.flat || {};
                const sel = (this.state.character.selections && typeof this.state.character.selections === 'object')
                    ? { ...this.state.character.selections }
                    : {};
                let changed = false;
                Object.keys(sel).forEach((cat) => {
                    const gid = String(sel[cat] || '').trim();
                    if (!gid) return;
                    // UI uses null for "None"; keep localStorage consistent.
                    if (gid === '__none__') {
                        sel[cat] = null;
                        changed = true;
                        return;
                    }
                    if (!flat || !Object.prototype.hasOwnProperty.call(flat, gid)) {
                        sel[cat] = null;
                        changed = true;
                    }
                });

                if (changed) {
                    this.state.character.selections = sel;
                    this._characterSaveSelections();

                    // If a saved preset was previously forced, selection changes should drop back to auto.
                    const current = String(this.state.character.activePresetId || '').trim();
                    if (current && !current.startsWith('auto:')) {
                        this.state.character.activePresetId = null;
                        this._characterSaveActivePresetId();
                    } else if (current && current.startsWith('auto:')) {
                        const key = this._characterBuildPresetKeyFromSelections(sel);
                        this.state.character.activePresetId = key ? `auto:${key}` : null;
                        this._characterSaveActivePresetId();
                    }
                }
            } catch { }

            // If active preset missing, clear
            if (this.state.character.activePresetId && !this.state.character.presets.some(p => p?.id === this.state.character.activePresetId)) {
                this.state.character.activePresetId = null;
            }
        },

        _characterTeardown() {
            // remove global outside-click listener if any
            try {
                document.removeEventListener('mousedown', this._handleCharacterGlobalPointerDown);
                document.removeEventListener('touchstart', this._handleCharacterGlobalPointerDown);
            } catch { }

            // Stop any hold-loop playback when leaving Character View.
            try { this._characterStopCharacterLayerLoop?.({ stopEngine: true }); } catch { }
            try {
                this.container?.classList?.remove('plugin-album--character');
            } catch { }
            if (this.state?.character?.pregen?.timer) {
                try { clearInterval(this.state.character.pregen.timer); } catch { }
                this.state.character.pregen.timer = null;
            }
            // Stop auto scheduling when leaving character view.
            // Do NOT cancel currently running task; just prevent new tasks from being scheduled.
            try {
                const pregen = this.state.character.pregen || (this.state.character.pregen = {});
                pregen.suspended = true;
                pregen.isScheduling = false;
                // Invalidate any in-flight scheduler pass.
                const sid = Number(pregen.sessionId || 0);
                pregen.sessionId = Number.isFinite(sid) ? (sid + 1) : 1;
            } catch { }
            this.state.character.activeMenu = null;
        },

        _characterRender() {
            try {
                this.container?.classList?.add('plugin-album--character');
            } catch { }
            const characterHash = this.state?.selectedCharacter?.hash;
            const displayName = this.state?.selectedCharacter?.name || '';

            const vnMode = (typeof this._characterIsVisualNovelModeEnabled === 'function')
                ? !!this._characterIsVisualNovelModeEnabled()
                : true;
            const vnBlur = !!(vnMode && this.state?.character?.settings && this.state.character.settings.blur_background);

            const categories = this._characterNormalizeCategories(this.state.character.categories);
            const resolvedCategories = categories.length ? categories : this._characterDefaultCategories();

            const menuMode = String(this.state.character?.ui?.menuMode || 'category').trim().toLowerCase();
            const isStateMode = menuMode === 'state';
            const presetMenuName = isStateMode ? 'StatePreset' : 'Preset';
            const presetTitle = isStateMode ? 'State preset' : 'Preset';

            this.contentArea.innerHTML = `
                <div class="plugin-album__character-view${vnMode ? ' plugin-album__character-view--vn' : ''}${vnBlur ? ' plugin-album__character-view--vn-blur-bg' : ''}" data-character-hash="${characterHash}">
                    <img class="plugin-album__character-layer plugin-album__character-layer--bg" alt="" />
                    <img class="plugin-album__character-layer plugin-album__character-layer--char" alt="" />
                    <div class="plugin-album__character-empty">Chọn bất kỳ button nào để bắt đầu</div>
                    <div class="plugin-album__character-menu" aria-label="Character menu">
                        <div class="plugin-album__character-menu-buttons" aria-label="Character menu groups"></div>
                        <button class="plugin-album__character-menu-btn" data-menu="${presetMenuName}" title="${presetTitle}"><span class="material-symbols-outlined">bookmarks</span></button>

                        <div class="plugin-album__character-submenu" hidden>
                            <div class="plugin-album__character-submenu-toolbar"></div>
                            <div class="plugin-album__character-submenu-scroll">
                                <div class="plugin-album__character-submenu-list"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Build category/state-group buttons dynamically (including the top '+' for add)
            const menuButtonsHost = this.contentArea.querySelector('.plugin-album__character-menu-buttons');
            if (menuButtonsHost) {
                if (!isStateMode) {
                    const maxTotalCategories = this._CHAR_MAX_TOTAL_CATEGORIES || 10;
                    const totalCategoryCount = Array.isArray(resolvedCategories) ? resolvedCategories.length : 0;
                    if (totalCategoryCount < maxTotalCategories) {
                        const addCatBtn = document.createElement('button');
                        addCatBtn.className = 'plugin-album__character-menu-btn plugin-album__character-menu-btn--category-add';
                        addCatBtn.type = 'button';
                        addCatBtn.dataset.action = 'add-category';
                        addCatBtn.title = 'Thêm category';
                        addCatBtn.innerHTML = `<span class="material-symbols-outlined">add</span>`;
                        menuButtonsHost.appendChild(addCatBtn);
                    }

                    resolvedCategories.forEach(cat => {
                        const btn = document.createElement('button');
                        btn.className = 'plugin-album__character-menu-btn';
                        btn.type = 'button';
                        btn.dataset.menu = cat.name;
                        btn.title = cat.name;
                        btn.innerHTML = `
                            <span class="plugin-album__character-menu-btn-label"></span>
                            <span class="material-symbols-outlined">${cat.icon || 'label'}</span>
                        `;

                        // Apply per-category icon color (if configured)
                        try {
                            const iconEl = btn.querySelector('.material-symbols-outlined');
                            const color = this._characterIsValidHexColor(cat?.color) ? cat.color : null;
                            if (iconEl && color) iconEl.style.color = color;
                        } catch { }

                        // Long-press 0.5s to reorder categories
                        let longPressTimer = null;
                        let longPressFired = false;
                        const clear = () => {
                            if (longPressTimer) {
                                clearTimeout(longPressTimer);
                                longPressTimer = null;
                            }
                        };

                        const start = () => {
                            clear();
                            longPressFired = false;
                            longPressTimer = setTimeout(() => {
                                longPressTimer = null;
                                longPressFired = true;
                                this._characterOpenCategoryReorderModal();
                            }, 500);
                        };

                        // Mouse hold
                        btn.addEventListener('mousedown', (e) => {
                            // Only left button
                            if (e.button !== 0) return;
                            start();
                        });
                        btn.addEventListener('mouseup', clear);
                        btn.addEventListener('mouseleave', clear);

                        // Touch hold
                        btn.addEventListener('touchstart', () => start(), { passive: true });
                        btn.addEventListener('touchend', clear);
                        btn.addEventListener('touchcancel', clear);

                        // If long press fired, suppress the subsequent click
                        btn.addEventListener('click', (e) => {
                            if (!longPressFired) return;
                            e.preventDefault();
                            e.stopPropagation();
                            longPressFired = false;
                        }, true);

                        menuButtonsHost.appendChild(btn);
                    });
                } else {
                    const maxTotalGroups = this._CHAR_MAX_TOTAL_STATE_GROUPS || 6;
                    const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                    const totalCount = groups.length;
                    if (totalCount < maxTotalGroups) {
                        const addBtn = document.createElement('button');
                        addBtn.className = 'plugin-album__character-menu-btn plugin-album__character-menu-btn--category-add';
                        addBtn.type = 'button';
                        addBtn.dataset.action = 'add-state-group';
                        addBtn.title = 'Thêm state group';
                        addBtn.innerHTML = `<span class="material-symbols-outlined">add</span>`;
                        menuButtonsHost.appendChild(addBtn);
                    }

                    groups.forEach(g => {
                        const gid = String(g?.id || '').trim();
                        const name = String(g?.name || '').trim();
                        if (!gid || !name) return;
                        const icon = String(g?.icon || 'label').trim() || 'label';
                        const color = this._characterIsValidHexColor(g?.color) ? String(g.color).toUpperCase() : null;

                        const btn = document.createElement('button');
                        btn.className = 'plugin-album__character-menu-btn';
                        btn.type = 'button';
                        btn.dataset.menu = `state:${gid}`;
                        btn.title = name;
                        btn.innerHTML = `
                            <span class="plugin-album__character-menu-btn-label"></span>
                            <span class="material-symbols-outlined">${icon}</span>
                        `;

                        try {
                            const iconEl = btn.querySelector('.material-symbols-outlined');
                            if (iconEl && color) iconEl.style.color = color;

                            // Long-press 0.5s on icon to reorder state groups
                            let longPressTimer = null;
                            let longPressFired = false;
                            const clear = () => {
                                if (longPressTimer) {
                                    clearTimeout(longPressTimer);
                                    longPressTimer = null;
                                }
                            };
                            const start = () => {
                                clear();
                                longPressFired = false;
                                longPressTimer = setTimeout(() => {
                                    longPressTimer = null;
                                    longPressFired = true;
                                    this._characterOpenStateGroupReorderModal?.();
                                }, 500);
                            };

                            // Mouse hold
                            iconEl.addEventListener('mousedown', (e) => {
                                if (e.button !== 0) return;
                                start();
                            });
                            iconEl.addEventListener('mouseup', clear);
                            iconEl.addEventListener('mouseleave', clear);

                            // Touch hold
                            iconEl.addEventListener('touchstart', () => start(), { passive: true });
                            iconEl.addEventListener('touchend', clear);
                            iconEl.addEventListener('touchcancel', clear);

                            // Suppress subsequent click if long press fired
                            iconEl.addEventListener('click', (e) => {
                                if (!longPressFired) return;
                                e.preventDefault();
                                e.stopPropagation();
                                longPressFired = false;
                            }, true);
                        } catch { }

                        menuButtonsHost.appendChild(btn);
                    });
                }
            }

            // Menu-bar mode toggle button (must be below Preset button)
            try {
                const presetBtn = this.contentArea?.querySelector('.plugin-album__character-menu-btn[data-menu="Preset"], .plugin-album__character-menu-btn[data-menu="StatePreset"]');
                if (presetBtn) {
                    const mm = String(this.state.character?.ui?.menuMode || 'category').trim().toLowerCase();
                    const iconName = (mm === 'state') ? 'filter_2' : 'filter_1';
                    const modeBtn = document.createElement('button');
                    modeBtn.className = 'plugin-album__character-menu-btn plugin-album__character-menu-btn--menumode';
                    modeBtn.type = 'button';
                    modeBtn.dataset.action = 'open-mainmenu-mode-modal';
                    modeBtn.title = 'Main menu settings';
                    modeBtn.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>`;
                    presetBtn.insertAdjacentElement('afterend', modeBtn);
                }
            } catch { }

            // Apply current menu-bar mode (labels + visibility)
            try { this._characterApplyMenuBarModeUI(); } catch { }

            // Apply VN blur class immediately (for non-rerender updates too)
            try { this._characterApplyVNBlurUI?.(); } catch { }

            // Bind interactions
            const root = this.contentArea.querySelector('.plugin-album__character-view');
            const menu = this.contentArea.querySelector('.plugin-album__character-menu');
            menu?.addEventListener('click', this._handleCharacterMenuClick);

            // Click on character layer replays current animation playlist.
            const charLayer = root?.querySelector('.plugin-album__character-layer--char');
            if (charLayer) {
                // Mobile: prevent the browser's default long-press menu on the character layer.
                try {
                    const isCoarsePointerDevice = (() => {
                        try {
                            if (typeof window !== 'undefined' && window.matchMedia) {
                                if (window.matchMedia('(pointer: coarse)').matches) return true;
                                if (window.matchMedia('(any-pointer: coarse)').matches) return true;
                            }
                        } catch { }
                        try {
                            if (typeof navigator !== 'undefined' && typeof navigator.maxTouchPoints === 'number') {
                                return navigator.maxTouchPoints > 0;
                            }
                        } catch { }
                        try { return (typeof window !== 'undefined') && ('ontouchstart' in window); } catch { }
                        return false;
                    })();

                    charLayer.addEventListener('contextmenu', (e) => {
                        if (!isCoarsePointerDevice) return;
                        e.preventDefault();
                        e.stopPropagation();
                    }, true);
                } catch { }

                // Hold (0.5s) => enable loop; click => normal play (and stops loop).
                try {
                    let holdTimer = null;
                    let holdFired = false;

                    const clearHold = () => {
                        try { if (holdTimer) clearTimeout(holdTimer); } catch { }
                        holdTimer = null;
                    };

                    const startHold = () => {
                        clearHold();
                        holdFired = false;
                        holdTimer = setTimeout(() => {
                            holdFired = true;
                            try { charLayer.dataset.suppressNextClick = '1'; } catch { }
                            try { this._characterStartCharacterLayerLoop?.({ reason: 'hold' }); } catch { }
                        }, 500);
                    };

                    // Pointer events (mouse + touch + pen)
                    charLayer.addEventListener('pointerdown', (e) => {
                        try {
                            // Left click only for mouse; allow touch/pen.
                            if (typeof e.pointerType === 'string' && e.pointerType === 'mouse') {
                                if (e.button !== 0) return;
                            }
                        } catch { }
                        startHold();
                    });
                    charLayer.addEventListener('pointerup', clearHold);
                    charLayer.addEventListener('pointercancel', clearHold);
                    charLayer.addEventListener('pointerleave', clearHold);

                    // Fallback touch events (some embedded browsers)
                    charLayer.addEventListener('touchstart', () => startHold(), { passive: true });
                    charLayer.addEventListener('touchend', clearHold);
                    charLayer.addEventListener('touchcancel', clearHold);
                } catch { }

                // Capture click to suppress the release-click after a hold.
                charLayer.addEventListener('click', (e) => {
                    try {
                        const sup = String(charLayer.dataset.suppressNextClick || '').trim();
                        if (sup) {
                            try { delete charLayer.dataset.suppressNextClick; } catch { }
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                    } catch { }

                    // Normal click play.
                    try { this._characterPlayCurrentCharacterLayerAnimations?.({ restart: true, reason: 'click' }); } catch { }
                }, true);
            }

            // Initial image
            this._characterRefreshDisplayedImage();

            // Ensure menu progress UI exists (border shown when tasks are running)
            this._characterEnsureMenuProgressUI();

            // Start auto scheduler tick timer (lightweight; will no-op unless eligible)
            if (!this.state.character.pregen.timer) {
                this.state.character.pregen.timer = setInterval(() => {
                    this._characterTickPreGen();
                }, 10_000);
            }

            // Immediate auto scheduling when entering character view
            try { this._characterAutoMaybeSchedule(null, { reason: 'render' }); } catch { }

            this.updateUI('success', displayName);
        },

        _handleCharacterMenuClick(event) {
            const btn = event.target.closest('.plugin-album__character-menu-btn');
            if (!btn) {
                // Menu-bar mode 4 (counter_4 / menuBarMode === 3): the category column is visually hidden.
                // Allow click-through so users can click the image layer behind (especially on narrow screens).
                try {
                    const mode = Number(this.state.character?.ui?.menuBarMode ?? 0);
                    if (mode === 3) {
                        const host = this.contentArea?.querySelector('.plugin-album__character-menu-buttons');
                        const menu = this.contentArea?.querySelector('.plugin-album__character-menu');
                        if (host && menu) {
                            const x = Number(event?.clientX);
                            const y = Number(event?.clientY);
                            if (Number.isFinite(x) && Number.isFinite(y)) {
                                const r = host.getBoundingClientRect();
                                const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
                                if (inside) {
                                    // Find element underneath by temporarily disabling hit testing for menu.
                                    const prev = menu.style.pointerEvents;
                                    menu.style.pointerEvents = 'none';
                                    const below = document.elementFromPoint(x, y);
                                    menu.style.pointerEvents = prev;

                                    if (below && typeof below.click === 'function') {
                                        below.click();
                                    }
                                    event.preventDefault();
                                    event.stopPropagation();
                                    return;
                                }
                            }
                        }
                    }
                } catch { }
                return;
            }
            const action = String(btn.dataset.action || '').trim();
            if (action === 'open-mainmenu-mode-modal') {
                try { this._characterOpenMainMenuModeEditModal?.(); } catch { }
                return;
            }
            if (action === 'add-category') {
                try {
                    const categories = this._characterNormalizeCategories(this.state.character.categories);
                    const resolvedCategories = categories.length ? categories : this._characterDefaultCategories();
                    const maxTotalCategories = this._CHAR_MAX_TOTAL_CATEGORIES || 10;
                    const totalCategoryCount = Array.isArray(resolvedCategories) ? resolvedCategories.length : 0;
                    if (totalCategoryCount >= maxTotalCategories) {
                        showError(`Tối đa ${maxTotalCategories} category.`);
                        return;
                    }
                } catch { }
                this._characterOpenCategoryIconEditor({ mode: 'create' });
                return;
            }

            if (action === 'add-state-group') {
                try {
                    const maxTotalGroups = this._CHAR_MAX_TOTAL_STATE_GROUPS || 6;
                    const groups = Array.isArray(this.state.character?.state?.groups) ? this.state.character.state.groups : [];
                    if (groups.length >= maxTotalGroups) {
                        showError(`Tối đa ${maxTotalGroups} state group.`);
                        return;
                    }
                } catch { }
                try { this._characterOpenStateGroupEditModal?.({ mode: 'create' }); } catch { }
                return;
            }
            const menu = String(btn.dataset.menu || '').trim();
            if (!menu) return;
            this._characterToggleSubmenu(menu);
        },

        _handleCharacterGlobalPointerDown(event) {
            const submenu = this.contentArea?.querySelector('.plugin-album__character-submenu');
            const menu = this.contentArea?.querySelector('.plugin-album__character-menu');
            if (!submenu || !menu) return;
            if (submenu.hidden) return;
            const target = event.target;
            // Ignore clicks inside any modal overlay so the submenu doesn't close while using dialogs.
            try {
                if (target && typeof target.closest === 'function' && target.closest('.modal-backdrop')) return;
            } catch { }
            if (submenu.contains(target)) return;
            if (menu.contains(target) && target.closest('.plugin-album__character-menu-btn')) return;
            this._characterCloseSubmenu();
        },
    });
})();
