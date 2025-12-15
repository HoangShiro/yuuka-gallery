// Album plugin entry file: defines AlbumComponent base + event wiring.
// UI/view logic is split into modules under static/modules/**.

class AlbumComponent {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;

        // LocalStorage keys
        this._LS_GRID_OPEN_MODE_KEY = 'yuuka.album.grid_open_view_mode';
        this._LS_CHAR_SELECTION_KEY_PREFIX = 'yuuka.album.character.selection.'; // + character_hash
        this._LS_CHAR_ACTIVE_PRESET_KEY_PREFIX = 'yuuka.album.character.active_preset.'; // + character_hash
        this._LS_CHAR_MENU_BAR_MODE_KEY = 'yuuka.album.character.menu_bar_mode'; // 0..3
        this._LS_CHAR_MAIN_MENU_MODE_KEY = 'yuuka.album.character.main_menu_mode'; // 'category' | 'state'
        // Character view settings persisted locally as a fallback for UI-only options.
        // Backend remains the source of truth when it supports a setting.
        this._LS_CHAR_SETTINGS_KEY = 'yuuka.album.character.settings';

        this.state = {
            selectedCharacter: null,
            viewMode: 'grid',
            gridOpenMode: 'album',
            allImageData: [],
            promptClipboard: null,
            isComfyUIAvaidable: false,
            cachedComfyGlobalChoices: null,
            cachedComfySettings: null,

            // Character view state (viewMode = 'character')
            character: {
                tagGroups: { grouped: {}, flat: {} },
                categories: [],
                selections: { Outfits: null, Expression: null, Action: null, Context: null },
                presets: [],
                favourites: {},
                autoSuggestPresets: [],
                autoSuggestModel: null,
                activePresetId: null,
                activeMenu: null,
                settings: { pregen_enabled: true, pregen_category_enabled: {}, pregen_group_enabled: {} },
                pregen: {
                    timer: null,
                    lastRanAt: 0,
                    isRunning: false,
                    isScheduling: false,
                    lastScheduleAt: 0,
                    suspended: false,
                    sessionId: 0,
                    sessionAutoImagesStarted: 0,
                },
                ui: { backgroundUrl: null, characterUrl: null, menuBarMode: 0, menuMode: 'category' },
            },
        };

        // Auto task limits (character view)
        this._CHAR_AUTO_MAX_IMAGES_PER_SESSION = 100;
        this._CHAR_AUTO_SCHEDULE_THROTTLE_MS = 500;

        // Character categories limit
        this._CHAR_MAX_TOTAL_CATEGORIES = 10;

        // Icon pool for category picker (Material Symbols names)
        this._CHAR_CATEGORY_ICON_CHOICES = [
            'apparel', 'mood', 'directions_run', 'landscape',

            'face', 'tag_faces', 'face_right',
            'visibility',
            'hearing', 'earbuds',
            'gesture', 'pan_tool', 'fingerprint',
            'footprint',
            'sentiment_satisfied', 'sentiment_neutral', 'sentiment_dissatisfied',
            'mood', 'mood_bad',
            'psychology', 'self_improvement',
            'record_voice_over', 'campaign',

            'person', 'people', 'groups', 'emoji_people',
            'accessibility', 'accessibility_new',
            'front_hand', 'back_hand', 'waving_hand',
            'thumb_up', 'thumb_down', 'volunteer_activism',

            'lips', 'girl', 'person_heart',

            'face_retouching_natural', 'face_retouching_off',
            'brush', 'spa', 'content_cut', 'dry_cleaning',
            'checkroom',

            'directions_walk', 'directions_run',
            'sports', 'fitness_center',

            'portrait', 'photo_camera', 'camera_alt', 'camera_front',
            'visibility_off',

            'partner_heart', 'cardiology', 'cardio_load', 'water_drop',

            'favorite', 'favorite_border', 'stars', 'bookmark',
            'palette', 'emoji_objects', 'auto_awesome', 'bolt',
            'music_note', 'theaters', 'sports_esports',
            'local_florist', 'forest', 'nightlight', 'travel_explore',
        ];

        // Bright color pool for category icon/preset tinting (stored per category as "#RRGGBB")
        this._CHAR_CATEGORY_COLOR_CHOICES = [
            '#FFFFFF',
            '#FF1744', '#FF5252', '#FF4081', '#F50057',
            '#D500F9', '#E040FB', '#651FFF', '#7C4DFF',
            '#3D5AFE', '#536DFE', '#2979FF', '#448AFF',
            '#00B0FF', '#40C4FF', '#00E5FF', '#18FFFF',
            '#1DE9B6', '#64FFDA', '#00E676', '#69F0AE',
            '#76FF03', '#B2FF59', '#C6FF00', '#EEFF41',
            '#FFEA00', '#FFD740', '#FFC400', '#FFAB40',
            '#FF9100',
        ];

        // Restore global Character menu-bar mode (not per-character)
        try {
            if (typeof this._characterLoadMenuBarMode === 'function') {
                this.state.character.ui.menuBarMode = this._characterLoadMenuBarMode();
            }
        } catch { }

        // Restore global Character menu mode (Category/State)
        try {
            if (typeof this._characterLoadMainMenuMode === 'function') {
                this.state.character.ui.menuMode = this._characterLoadMainMenuMode();
            }
        } catch { }

        // Load persisted grid open mode (if module is available)
        try {
            if (typeof this._getGridPreferredViewMode === 'function') {
                this.state.gridOpenMode = this._getGridPreferredViewMode();
            }
        } catch { }

        // Shared services
        this.viewer = window.Yuuka?.plugins?.simpleViewer;
        this.clipboardService = this._ensureClipboardService();
        this.state.promptClipboard = this._getPromptClipboard();

        // Bind event handlers (always present in this file)
        this.handleImageAdded = this.handleImageAdded.bind(this);
        this.handleTaskEnded = this.handleTaskEnded.bind(this);
        this.handleGenerationUpdate = this.handleGenerationUpdate.bind(this);
        this.handleImageDeleted = this.handleImageDeleted.bind(this);
        this.handleTaskCreatedLocally = this.handleTaskCreatedLocally.bind(this);
        this.handleExternalRefresh = this.handleExternalRefresh.bind(this);

        // Bind helpers if present (defined in modules)
        this._syncDOMSelection = (typeof this._syncDOMSelection === 'function')
            ? this._syncDOMSelection.bind(this)
            : (() => { });
        this._attachInstanceToCapability = (typeof this._attachInstanceToCapability === 'function')
            ? this._attachInstanceToCapability.bind(this)
            : (() => { });

        this._handleCharacterMenuClick = (typeof this._handleCharacterMenuClick === 'function')
            ? this._handleCharacterMenuClick.bind(this)
            : (() => { });
        this._handleCharacterGlobalPointerDown = (typeof this._handleCharacterGlobalPointerDown === 'function')
            ? this._handleCharacterGlobalPointerDown.bind(this)
            : (() => { });

        // SortableJS (tag group ordering)
        this._sortablePromise = null;
        this._characterTagGroupSortable = null;
        this._characterIsSortingTagGroups = false;

        // Track generation tasks in character mode (auto vs manual)
        this._characterTaskMeta = new Map(); // task_id -> { isAuto, presetId, characterHash }
        this._characterAutoSuggestIngestedTaskIds = new Set();
        this._lastAllTasksStatus = null;
    }

    async init() {
        console.log('[Plugin:Album] Initializing...');
        this.container.classList.add('plugin-album');

        try { await this.checkComfyUIStatus?.(); } catch { }

        this.container.innerHTML = `<div class="plugin-album__content-area"></div>`;
        this.contentArea = this.container.querySelector('.plugin-album__content-area');

        // Global events
        Yuuka.events.on('image:added', this.handleImageAdded);
        Yuuka.events.on('generation:task_ended', this.handleTaskEnded);
        Yuuka.events.on('generation:update', this.handleGenerationUpdate);
        Yuuka.events.on('image:deleted', this.handleImageDeleted);
        Yuuka.events.on('generation:task_created_locally', this.handleTaskCreatedLocally);
        Yuuka.events.on('album:request_refresh', this.handleExternalRefresh);

        // Navibar integration
        try { this._registerNavibarButtons?.(); } catch { }

        // Prefetch global tag dataset (non-blocking)
        try { this._prefetchTags?.(); } catch { }

        // Expose global instance for cross-plugin discovery
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.instances = window.Yuuka.instances || {};
        window.Yuuka.instances.AlbumComponent = this;

        // Attach this instance to the previously registered capability (if any)
        try { this._attachInstanceToCapability(); } catch { }

        const initialState = window.Yuuka?.initialPluginState?.album;
        if (initialState) {
            const initialCharacter = initialState.character;
            const shouldOpenSettings = Boolean(initialState.openSettings);
            const regenConfig = initialState.regenConfig;

            const requestedViewMode = (() => {
                if (regenConfig) return 'album';
                const raw = String(initialState.viewMode || '').trim().toLowerCase();
                if (raw === 'character') return 'character';
                if (raw === 'album') return 'album';
                try {
                    if (typeof this._getGridPreferredViewMode === 'function') {
                        return this._getGridPreferredViewMode();
                    }
                } catch { }
                return 'album';
            })();

            delete window.Yuuka.initialPluginState.album;

            if (requestedViewMode === 'character') {
                await this.openCharacterView?.(initialCharacter);
            } else {
                this.state.selectedCharacter = initialCharacter;
                this.state.viewMode = 'album';
                await this.loadAndDisplayCharacterAlbum?.();
                this._syncDOMSelection();
            }

            if (regenConfig) {
                try { await this._startGeneration?.(regenConfig); } catch { }
            }

            if (shouldOpenSettings) {
                try {
                    await this.openSettings?.();
                } catch (err) {
                    console.error('[Album] Failed to open settings modal:', err);
                    showError('Không thể mở cài đặt Album.');
                }
            }
        } else {
            this.state.viewMode = 'grid';
            await this.showCharacterSelectionGrid?.();
        }

        try { this._updateNav?.(); } catch { }
    }

    destroy() {
        console.log('[Plugin:Album] Destroying...');

        try { this._characterTeardown?.(); } catch { }

        Yuuka.events.off('image:added', this.handleImageAdded);
        Yuuka.events.off('generation:task_ended', this.handleTaskEnded);
        Yuuka.events.off('generation:update', this.handleGenerationUpdate);
        Yuuka.events.off('image:deleted', this.handleImageDeleted);
        Yuuka.events.off('generation:task_created_locally', this.handleTaskCreatedLocally);
        Yuuka.events.off('album:request_refresh', this.handleExternalRefresh);

        const navibar = window.Yuuka?.services?.navibar;
        if (navibar) navibar.setActivePlugin(null);

        if (this.contentArea) this.contentArea.innerHTML = '';
        this.container.classList.remove('plugin-album');
    }

    // --- EVENT HANDLERS ---

    handleImageAdded(eventData) {
        const taskId = eventData?.task_id ?? eventData?.taskId;
        const imageData = eventData?.image_data ?? eventData?.imageData;

        // Auto-suggest: incorporate tags from new non-auto images immediately.
        try {
            const tid = String(taskId || '').trim();
            const meta = tid ? this._characterTaskMeta.get(tid) : null;
            if (tid && meta && meta.isAuto === false) {
                if (!this._characterAutoSuggestIngestedTaskIds.has(tid)) {
                    this._characterAutoSuggestIngestedTaskIds.add(tid);
                    if (typeof this._characterAutoSuggestIngestImage === 'function') {
                        this._characterAutoSuggestIngestImage(imageData);
                    }
                }
            }
        } catch { }

        try {
            // Always update local cache for the currently selected character.
            // Character view relies on state.allImageData for preset filtering.
            if (this.state.selectedCharacter?.hash && this.state.selectedCharacter.hash === imageData?.character_hash) {
                const existingIndex = this.state.allImageData.findIndex(img => img.id === imageData.id);
                if (existingIndex === -1) {
                    this.state.allImageData.unshift(imageData);
                }
            }

            if (this.state.viewMode === 'album' && this.state.selectedCharacter?.hash === imageData?.character_hash) {
                const placeholder = document.getElementById(taskId);
                if (placeholder) {
                    const newCard = this._createImageCard?.(imageData);
                    if (newCard) placeholder.replaceWith(newCard);
                }
            }

            if (this.state.viewMode === 'character') {
                // VN mode: background images are stored into a dedicated per-user album
                // ("Background"), so character_hash will NOT match selectedCharacter.hash.
                // Still route these images through the character-view handler.
                const cfg = imageData?.generationConfig || {};
                const layer = String(cfg?.album_vn_layer || '').trim().toLowerCase();
                const gid = String(cfg?.album_vn_bg_group_id || '').trim();
                const isVnBg = (layer === 'bg' && !!gid);

                if (isVnBg || (this.state.selectedCharacter?.hash === imageData?.character_hash)) {
                    this._characterOnImageAdded?.(taskId, imageData);
                    try { this._characterRefreshOpenSubmenuEmptyStates?.(); } catch { }
                    try { this._characterUpdatePresetSubmenuBackgroundUI?.(); } catch { }
                }
            }
        } catch { }

        try { this._updateNav?.(); } catch { }
    }

    handleImageDeleted(eventData) {
        const imageId = eventData?.imageId;
        if (!imageId) return;

        const index = this.state.allImageData.findIndex(img => img.id === imageId);
        if (index > -1) {
            this.state.allImageData.splice(index, 1);

            if (this.state.viewMode === 'album') {
                this.contentArea?.querySelector(`.plugin-album__image-card[data-id="${imageId}"]`)?.remove();
            }

            if (this.state.viewMode === 'character') {
                try { this._characterRefreshDisplayedImage?.(); } catch { }
                try { this._characterRefreshOpenSubmenuEmptyStates?.(); } catch { }
                try { this._characterUpdatePresetSubmenuBackgroundUI?.(); } catch { }
            }
        }
    }

    handleTaskEnded(payload) {
        const taskId = payload?.taskId || payload?.task_id;
        if (!taskId) return;

        if (this.state.viewMode === 'album' && this.state.selectedCharacter) {
            this._refreshAlbumAndPlaceholders?.();
        } else if (this.state.viewMode === 'character' && this.state.selectedCharacter) {
            try {
                this.state.character.pregen.lastRanAt = Date.now();
            } catch { }

            try {
                const meta = this._characterTaskMeta.get(String(taskId));

                if (meta && meta.isAuto === false && !this._characterAutoSuggestIngestedTaskIds.has(String(taskId))) {
                    try { setTimeout(() => { try { this._characterTaskMeta.delete(String(taskId)); } catch { } }, 30000); } catch { }
                } else {
                    this._characterTaskMeta.delete(taskId);
                }

                if (meta && String(meta.characterHash || '') === String(this.state.selectedCharacter.hash)) {
                    if (meta.isAuto === false) {
                        try { this.state.character.pregen.suspended = false; } catch { }
                    }
                }

                this._characterAutoMaybeSchedule?.(null, { reason: meta?.isAuto ? 'auto-ended' : 'task-ended' });
            } catch { }

            try { this._characterUpdatePresetSubmenuTaskUI?.(this._lastAllTasksStatus || {}); } catch { }
            try { this._characterUpdateTagGroupSubmenuTaskUI?.(this._lastAllTasksStatus || {}); } catch { }
        } else {
            document.getElementById(taskId)?.remove();
        }

        try { this._updateNav?.(); } catch { }
    }

    handleGenerationUpdate(allTasksStatus) {
        this._lastAllTasksStatus = allTasksStatus || {};

        try { this._gridUpdateTaskOverlays?.(this._lastAllTasksStatus); } catch { }

        if (this.state.viewMode === 'album' && this.state.selectedCharacter) {
            const grid = this.contentArea?.querySelector('.plugin-album__grid');
            Object.values(this._lastAllTasksStatus).forEach(task => {
                if (!task) return;
                if (task.character_hash !== this.state.selectedCharacter.hash) return;

                const placeholder = document.getElementById(task.task_id);
                if (placeholder) {
                    placeholder.querySelector('.plugin-album__progress-bar').style.width = `${task.progress_percent || 0}%`;
                    placeholder.querySelector('.plugin-album__progress-text').textContent = task.progress_message || '...';
                } else if (grid) {
                    const newPlaceholder = this._createPlaceholderCard?.(task.task_id);
                    if (newPlaceholder) {
                        grid.prepend(newPlaceholder);
                        const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                        if (emptyMsg) emptyMsg.style.display = 'none';
                    }
                }
            });
        }

        if (this.state.viewMode === 'character' && this.state.selectedCharacter) {
            try { this._characterMaybeStartPreGen?.(this._lastAllTasksStatus); } catch { }
            try { this._characterUpdateMenuProgressBorder?.(this._lastAllTasksStatus); } catch { }
            try { this._characterUpdatePresetSubmenuTaskUI?.(this._lastAllTasksStatus); } catch { }
            try { this._characterUpdateTagGroupSubmenuTaskUI?.(this._lastAllTasksStatus); } catch { }
        }
    }

    handleTaskCreatedLocally(payload) {
        try {
            const taskId = payload?.task_id;
            const charHash = payload?.character_hash;
            if (!taskId || !charHash) return;

            if (this.state.viewMode === 'album' && this.state.selectedCharacter?.hash === charHash) {
                const grid = this.contentArea?.querySelector('.plugin-album__grid');
                if (grid && !document.getElementById(taskId)) {
                    const placeholder = this._createPlaceholderCard?.(taskId);
                    if (placeholder) {
                        grid.prepend(placeholder);
                        const emptyMsg = grid.querySelector('.plugin-album__empty-msg');
                        if (emptyMsg) emptyMsg.style.display = 'none';
                    }
                }
                this._updateNav?.();
            }
        } catch (err) {
            console.warn('[Album] handleTaskCreatedLocally error:', err);
        }
    }

    async handleExternalRefresh() {
        try {
            if (this.state.viewMode === 'album' && this.state.selectedCharacter) {
                await this._refreshAlbumAndPlaceholders?.();
            }
        } catch (err) {
            console.warn('[Album] handleExternalRefresh error:', err);
        }
    }

    // --- CLIPBOARD SERVICE ---

    _ensureClipboardService() {
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.services = window.Yuuka.services || {};

        if (!window.Yuuka.services.albumPromptClipboard) {
            const store = { data: null };
            window.Yuuka.services.albumPromptClipboard = {
                get() {
                    return store.data ? new Map(store.data) : null;
                },
                set(map) {
                    if (map instanceof Map) {
                        store.data = new Map(map);
                    } else if (Array.isArray(map)) {
                        store.data = new Map(map);
                    } else if (map && typeof map === 'object') {
                        store.data = new Map(Object.entries(map));
                    } else {
                        store.data = null;
                    }
                    return store.data ? new Map(store.data) : null;
                },
                clear() {
                    store.data = null;
                }
            };
        }

        return window.Yuuka.services.albumPromptClipboard;
    }

    _getPromptClipboard() {
        const stored = this.clipboardService?.get?.();
        this.state.promptClipboard = stored ? new Map(stored) : null;
        return this.state.promptClipboard;
    }

    _setPromptClipboard(value) {
        let map = null;
        if (value instanceof Map) {
            map = value;
        } else if (Array.isArray(value)) {
            map = new Map(value);
        } else if (value && typeof value === 'object') {
            map = new Map(Object.entries(value));
        }

        if (map) {
            const normalized = new Map();
            map.forEach((rawValue, rawKey) => {
                const key = String(rawKey || '').trim();
                if (!key) return;
                const cleaned = rawValue == null ? '' : String(rawValue).trim();
                normalized.set(key, cleaned);
            });
            map = normalized;
        }

        const stored = this.clipboardService?.set?.(map) || null;
        this.state.promptClipboard = stored ? new Map(stored) : null;
        return this.state.promptClipboard;
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.components = window.Yuuka.components || {};
window.Yuuka.components['AlbumComponent'] = AlbumComponent;

