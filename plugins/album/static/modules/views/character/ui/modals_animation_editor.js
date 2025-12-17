// Album plugin - Character view (Modal: Animation editor)
// Minimal timeline editor (single layer) backed by /animation/* APIs.

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

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

    Object.assign(proto, {
        async _characterOpenAnimationEditorPage() {
            try {
                if (this.state?.viewMode !== 'character') return;

                // Treat opening editor as leaving Character View playback mode.
                try { this._characterStopCharacterLayerLoop?.({ stopEngine: true }); } catch { }

                // Must have a rendered character image in the current Character View
                const currentRoot = this.contentArea?.querySelector('.plugin-album__character-view');
                const currentChar = currentRoot?.querySelector('.plugin-album__character-layer--char');
                const currentBg = currentRoot?.querySelector('.plugin-album__character-layer--bg');
                const charSrc = String(currentChar?.getAttribute('src') || '').trim();
                const charHasImage = !!(currentChar && !currentChar.hidden && charSrc);
                if (!charHasImage) {
                    try { showError?.('Không thể mở Animation editor: Character layer chưa có ảnh.'); } catch { }
                    return;
                }

                const bgSrc = String(currentBg?.getAttribute('src') || '').trim();
                const bgHasImage = !!(currentBg && !currentBg.hidden && bgSrc);

                // Preserve some UI state to restore later
                try {
                    if (!this.state.character) this.state.character = {};
                    this.state.character._animEditor = {
                        returnActiveMenu: this.state.character.activeMenu ?? null,
                        isOpen: true,
                    };
                } catch { }

                const characterHash = String(this.state?.selectedCharacter?.hash || '').trim();
                const prevClassName = String(currentRoot?.className || 'plugin-album__character-view');
                const viewClass = prevClassName.includes('plugin-album__character-view')
                    ? prevClassName
                    : 'plugin-album__character-view';

                // Render as a page inside contentArea (not a modal)
                this.contentArea.innerHTML = `
                    <div class="${viewClass} plugin-album__character-view--anim-editor" data-character-hash="${characterHash}">
                        <img class="plugin-album__character-layer plugin-album__character-layer--bg" alt="" />
                        <img class="plugin-album__character-layer plugin-album__character-layer--char" alt="" />

                        <div class="plugin-album__anim-editor-overlay" aria-label="Animation editor overlay">
                            <div class="plugin-album__anim-editor-header" aria-label="Animation editor header">
                                <div class="plugin-album__anim-editor-header-left">
                                    <button type="button" data-action="new" title="New">
                                        <span class="material-symbols-outlined" aria-hidden="true">add</span>
                                        <span class="plugin-album__anim-editor-btn-label">New</span>
                                    </button>
                                    <button type="button" data-action="load" title="Load">
                                        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
                                        <span class="plugin-album__anim-editor-btn-label">Load</span>
                                    </button>
                                    <button type="button" data-action="save" title="Save">
                                        <span class="material-symbols-outlined" aria-hidden="true">save</span>
                                        <span class="plugin-album__anim-editor-btn-label">Save</span>
                                    </button>
                                    <button type="button" data-action="clone" title="Clone">
                                        <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                                        <span class="plugin-album__anim-editor-btn-label">Clone</span>
                                    </button>
                                </div>
                                <input class="plugin-album__anim-editor-name" type="text" data-role="name" placeholder="Preset key" />
                                <button type="button" class="plugin-album__anim-editor-close" data-action="close" title="Close">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div class="plugin-album__anim-editor-main" aria-label="Animation editor main">
                                <div class="plugin-album__anim-editor-anchor" data-role="anchor" aria-label="Layer anchor">
                                    <div class="plugin-album__anim-editor-anchor-dot" aria-hidden="true"></div>

                                    <div class="plugin-album__anim-editor-anchor-opacity" data-role="anchor-opacity" aria-label="Opacity slider">
                                        <input type="range" min="0" max="1" step="0.01" value="1" data-role="opacity-slider" aria-label="Opacity" />
                                    </div>
                                </div>
                            </div>

                            <div class="plugin-album__anim-editor-timeline" aria-label="Animation editor timeline">
                                <div class="plugin-album__anim-editor-timeline-grid" aria-label="Timeline grid">
                                    <div class="plugin-album__anim-editor-timeline-col plugin-album__anim-editor-timeline-col--title" aria-label="Timeline titles">
                                        <div class="plugin-album__anim-editor-track-title plugin-album__anim-editor-track-title--spacer" aria-label="Playback controls">
                                            <button type="button" class="plugin-album__anim-editor-playbtn" data-action="play" title="Play">
                                                <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span>
                                            </button>
                                            <div class="plugin-album__anim-editor-current-time" data-role="current-time" title="Current time">0ms</div>
                                        </div>
                                        <div class="plugin-album__anim-editor-track-title" data-track="position">Position</div>
                                        <div class="plugin-album__anim-editor-track-title" data-track="scale">Scale</div>
                                        <div class="plugin-album__anim-editor-track-title" data-track="opacity">Opacity</div>
                                    </div>

                                    <div class="plugin-album__anim-editor-timeline-col plugin-album__anim-editor-timeline-col--timeline" aria-label="Timeline">
                                        <div class="plugin-album__anim-editor-timeline-area" data-role="timeline-area">
                                            <div class="plugin-album__anim-editor-ruler-wrap" aria-label="Timeline ruler">
                                                <div class="plugin-album__anim-editor-mini-config" aria-label="Animation configs">
                                                    <label>
                                                        <span>Duration(ms)</span>
                                                        <input type="number" min="1" step="1" data-role="duration2" />
                                                    </label>
                                                    <label>
                                                        <span>Graph</span>
                                                        <select data-role="graph2">
                                                            <option value="ease-in-out">Smooth</option>
                                                            <option value="ease">ease</option>
                                                            <option value="linear">linear</option>
                                                            <option value="ease-in">ease-in</option>
                                                            <option value="ease-out">ease-out</option>
                                                            <option value="step-start">step-start</option>
                                                            <option value="step-end">step-end</option>
                                                        </select>
                                                    </label>
                                                </div>
                                                <div class="plugin-album__anim-editor-ruler-labels" data-role="ruler-labels" aria-hidden="true"></div>
                                                <div class="plugin-album__anim-editor-ruler" data-role="ruler" title="Drag or click to move playhead">
                                                    <div class="plugin-album__anim-editor-ruler-ticks" data-role="ruler-ticks" aria-hidden="true"></div>
                                                </div>
                                            </div>

                                            <div class="plugin-album__anim-editor-needle" data-role="needle" aria-hidden="true"></div>

                                            <div class="plugin-album__anim-editor-track-stack" data-role="track-stack" aria-label="Timeline tracks">
                                                <div class="plugin-album__anim-editor-gridlines" data-role="gridlines" aria-hidden="true"></div>

                                                <div class="plugin-album__anim-editor-track" data-role="track" data-track="position" title="Position keys"></div>
                                                <div class="plugin-album__anim-editor-track" data-role="track" data-track="scale" title="Scale keys"></div>
                                                <div class="plugin-album__anim-editor-track" data-role="track" data-track="opacity" title="Opacity keys"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                const root = this.contentArea.querySelector('.plugin-album__character-view--anim-editor');
                const layerBg = root?.querySelector('.plugin-album__character-layer--bg');
                const layerChar = root?.querySelector('.plugin-album__character-layer--char');
                if (layerChar) {
                    layerChar.hidden = false;
                    layerChar.src = charSrc;
                }
                if (layerBg) {
                    if (bgHasImage) {
                        layerBg.hidden = false;
                        layerBg.src = bgSrc;
                    } else {
                        layerBg.hidden = true;
                        layerBg.removeAttribute('src');
                    }
                }

                const dialog = root;

                // Notify navibar to show context tools (undo/redo)
                try { this._updateNav?.(); } catch { }

                const getEngine = () => {
                    try {
                        if (typeof this._albumAnimGetEngine === 'function') return this._albumAnimGetEngine();
                        if (window.Yuuka?.AlbumCssAnimationEngine) return new window.Yuuka.AlbumCssAnimationEngine({ api: this.api?.album });
                    } catch { }
                    return null;
                };

                const close = () => {
                    try {
                        try {
                            if (layerChar && typeof this._albumAnimStopLayer === 'function') {
                                this._albumAnimStopLayer(layerChar);
                            }
                        } catch { }

                        // Cleanup key handler + navibar hooks
                        try {
                            if (state?._keyHandler) document.removeEventListener('keydown', state._keyHandler, true);
                        } catch { }
                        try {
                            this._albumAnimEditorUndo = null;
                            this._albumAnimEditorRedo = null;
                            this._albumAnimEditorCanUndo = null;
                            this._albumAnimEditorCanRedo = null;
                        } catch { }

                        // Restore Character View page
                        this._characterRender?.();
                        this._characterRefreshDisplayedImage?.();
                        const prev = this.state.character?._animEditor;
                        const menuName = prev?.returnActiveMenu;
                        if (menuName) {
                            try { this._characterSetActiveMenuButton?.(menuName); } catch { }
                        }
                        delete this.state.character._animEditor;
                        try { this._updateNav?.(); } catch { }
                    } catch { }
                };

                const state = {
                    // key == preset key in backend
                    name: '',
                    durationMs: 500,
                    graphType: 'ease-in-out',
                    loop: true,
                    playheadMs: 0,
                    tracks: {
                        position: [], // { t, x, y }
                        scale: [], // { t, s }
                        opacity: [], // { t, o }
                    },
                    selected: null, // { track, i }
                    // cache of presets for load/clone
                    presets: [],

                    // playback
                    isPlaying: false,
                    _playRaf: 0,
                    _playStartPerf: 0,
                    _playStartMs: 0,

                    // selection (timeline keys)
                    selectedKeyIds: new Set(), // Set<string> of "track:t"

                    // autosave
                    _autoSaveTimer: 0,
                    _autoSaveInFlight: false,
                    _autoSavePending: false,

                    // preset existence cache (avoid calling APIs that will 404/409 and get logged)
                    _presetExists: new Map(),
                };

                const AUTO_SUFFIX = ' - auto save';
                const isAutoSavePresetKey = (key) => {
                    try {
                        const k = String(key || '').trim();
                        if (!k) return false;
                        return k.toLowerCase().endsWith(AUTO_SUFFIX.toLowerCase());
                    } catch {
                        return false;
                    }
                };
                const normalizeBasePresetKey = (key) => {
                    const k = String(key || '').trim();
                    if (!k) return '';
                    if (k.toLowerCase().endsWith(AUTO_SUFFIX.toLowerCase())) {
                        return k.slice(0, k.length - AUTO_SUFFIX.length).trim();
                    }
                    return k;
                };
                const getBasePresetKey = () => normalizeBasePresetKey(state.name) || 'Default';
                const getAutoPresetKey = () => `${getBasePresetKey()}${AUTO_SUFFIX}`;

                const loadLocalBasePresetKey = () => {
                    try {
                        const fromState = String(this.state?.character?._animEditor?.lastUserPresetKey || '').trim();
                        if (fromState) return normalizeBasePresetKey(fromState);
                    } catch { }
                    try {
                        const v = String(localStorage.getItem('album.animEditor.lastUserPresetKey') || '').trim();
                        if (v) return normalizeBasePresetKey(v);
                    } catch { }
                    return '';
                };

                const saveLocalBasePresetKey = (baseKey) => {
                    const k = normalizeBasePresetKey(baseKey);
                    if (!k) return;
                    try {
                        if (!this.state.character) this.state.character = {};
                        if (!this.state.character._animEditor) this.state.character._animEditor = {};
                        this.state.character._animEditor.lastUserPresetKey = k;
                    } catch { }
                    try {
                        localStorage.setItem('album.animEditor.lastUserPresetKey', k);
                    } catch { }
                };

                const fetchAllPresets = async () => {
                    try {
                        const all = await this.api.album.get('/animation/presets');
                        state.presets = Array.isArray(all) ? all : [];
                        try {
                            if (!state._presetExists || typeof state._presetExists.set !== 'function') {
                                state._presetExists = new Map();
                            }
                            state._presetExists.clear();
                            state.presets.forEach((p) => {
                                const k = String(p?.key || '').trim();
                                if (k) state._presetExists.set(k, true);
                            });
                        } catch { }
                        return state.presets;
                    } catch {
                        state.presets = [];
                        return [];
                    }
                };

                const findPresetByKey = (key) => {
                    const k = String(key || '').trim();
                    if (!k) return null;
                    const list = Array.isArray(state.presets) ? state.presets : [];
                    return list.find(p => String(p?.key || '').trim() === k) || null;
                };

                const upsertPresetCache = (key, { timeline, graph_type } = {}) => {
                    const k = String(key || '').trim();
                    if (!k) return;
                    const list = Array.isArray(state.presets) ? state.presets : [];
                    const idx = list.findIndex(p => String(p?.key || '').trim() === k);
                    const next = {
                        ...(idx >= 0 ? list[idx] : {}),
                        key: k,
                        timeline: (timeline && (Array.isArray(timeline) || typeof timeline === 'object')) ? timeline : (idx >= 0 ? list[idx]?.timeline : []),
                        graph_type: String(graph_type || (idx >= 0 ? list[idx]?.graph_type : '') || 'linear').trim() || 'linear',
                    };
                    if (idx >= 0) {
                        list[idx] = next;
                    } else {
                        list.push(next);
                    }
                    state.presets = list;
                };

                const applyPresetToEditorState = (presetObj) => {
                    try {
                        if (!presetObj) return false;
                        const graph = String(presetObj.graph_type || presetObj.graphType || 'linear').trim() || 'linear';
                        const parsed = parseTimeline(presetObj.timeline);
                        state.graphType = graph;
                        state.durationMs = parsed.durationMs;
                        // Loop is always enabled (UI removed).
                        state.loop = true;
                        state.tracks = parsed.tracks || { position: [], scale: [], opacity: [] };
                        state.selected = null;
                        state.playheadMs = clampMs(state.playheadMs);
                        try { pushHistory(); } catch { }
                        return true;
                    } catch {
                        return false;
                    }
                };

                const doAutoSave = async () => {
                    try {
                        if (state._autoSaveInFlight) {
                            state._autoSavePending = true;
                            return;
                        }
                        state._autoSaveInFlight = true;
                        state._autoSavePending = false;

                        const key = String(getAutoPresetKey() || '').trim();
                        if (!key) return;
                        const payload = {
                            key,
                            timeline: buildTimelinePayload(),
                            graph_type: String(state.graphType || 'linear').trim() || 'linear',
                        };

                        // Decide POST vs PUT without triggering noisy 404/409 logs.
                        const ensureExistsKnown = async (k) => {
                            try {
                                if (!state._presetExists || typeof state._presetExists.get !== 'function') {
                                    state._presetExists = new Map();
                                }
                                const cached = state._presetExists.get(k);
                                if (cached === true) return true;
                                if (cached === false) return false;

                                // Try in-memory list first.
                                if (findPresetByKey(k)) {
                                    state._presetExists.set(k, true);
                                    return true;
                                }

                                // Refresh list once to avoid stale cache.
                                await fetchAllPresets();
                                const exists = !!findPresetByKey(k);
                                state._presetExists.set(k, exists);
                                return exists;
                            } catch {
                                return false;
                            }
                        };

                        const exists = await ensureExistsKnown(key);
                        if (exists) {
                            await this.api.album.put(`/animation/presets/${encodeURIComponent(key)}`, {
                                timeline: payload.timeline,
                                graph_type: payload.graph_type,
                            });
                            try {
                                upsertPresetCache(key, payload);
                                state._presetExists.set(key, true);
                            } catch { }
                            return;
                        }

                        await this.api.album.post('/animation/presets', payload);
                        try {
                            upsertPresetCache(key, payload);
                            state._presetExists.set(key, true);
                        } catch { }
                    } catch {
                    } finally {
                        try {
                            state._autoSaveInFlight = false;
                            const again = !!state._autoSavePending;
                            state._autoSavePending = false;
                            if (again) {
                                // Run one more time to capture the latest changes.
                                setTimeout(() => { try { doAutoSave(); } catch { } }, 0);
                            }
                        } catch { }
                    }
                };

                const queueAutoSave = () => {
                    try {
                        if (state._autoSaveTimer) clearTimeout(state._autoSaveTimer);
                        state._autoSaveTimer = setTimeout(async () => {
                            state._autoSaveTimer = 0;
                            try { await doAutoSave(); } catch { }
                        }, 450);
                    } catch { }
                };

                const getDurationMs = () => Math.max(1, Math.round(Number(state.durationMs || 1000)));
                const clampMs = (ms) => clamp(Math.round(Number(ms) || 0), 0, getDurationMs());

                const keyId = (trackName, t) => `${String(trackName || '').trim()}:${Math.round(Number(t) || 0)}`;
                const parseKeyId = (id) => {
                    const s = String(id || '');
                    const i = s.indexOf(':');
                    if (i < 0) return null;
                    const tr = s.slice(0, i);
                    const t = Math.round(Number(s.slice(i + 1)) || 0);
                    if (!tr) return null;
                    return { tr, t };
                };
                const getSelectedKeyIds = () => {
                    if (!state.selectedKeyIds || typeof state.selectedKeyIds.has !== 'function') {
                        state.selectedKeyIds = new Set();
                    }
                    return state.selectedKeyIds;
                };
                const clearSelection = () => {
                    try {
                        getSelectedKeyIds().clear();
                        state.selected = null;
                    } catch { }
                };

                const syncKeySelectionClasses = () => {
                    try {
                        const sel = getSelectedKeyIds();
                        dialog.querySelectorAll('.plugin-album__anim-editor-key')?.forEach((kb) => {
                            const tr = String(kb.dataset.track || '').trim();
                            const t = Math.round(Number(kb.dataset.t) || 0);
                            kb.classList.toggle('is-selected', sel.has(keyId(tr, t)));
                        });
                    } catch { }
                };

                const readCssPxVar = (name, fallbackPx = 0) => {
                    try {
                        const raw = String(getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
                        if (!raw) return Number(fallbackPx) || 0;
                        const n = Number(String(raw).replace('px', '').trim());
                        return Number.isFinite(n) ? n : (Number(fallbackPx) || 0);
                    } catch {
                        return Number(fallbackPx) || 0;
                    }
                };

                const anchorEl = dialog.querySelector('[data-role="anchor"]');
                const opacitySliderEl = dialog.querySelector('[data-role="opacity-slider"]');

                const sortUniqByT = (arr) => {
                    const map = new Map();
                    (Array.isArray(arr) ? arr : []).forEach((k) => {
                        const t = Number(k?.t);
                        if (!Number.isFinite(t)) return;
                        map.set(Math.round(t), { ...k, t: Math.round(t) });
                    });
                    return Array.from(map.values()).sort((a, b) => (Number(a?.t) || 0) - (Number(b?.t) || 0));
                };

                // --- History (Undo/Redo) ---
                const history = {
                    undo: [],
                    redo: [],
                    limit: 100,
                    lock: true, // locked until initial state is seeded
                };

                const cloneTrack = (arr) => (Array.isArray(arr) ? arr : []).map(k => ({ ...(k || {}) }));
                const snapshotEditorState = () => {
                    const pos = Array.isArray(state.tracks?.position) ? state.tracks.position : [];
                    const sc = Array.isArray(state.tracks?.scale) ? state.tracks.scale : [];
                    const op = Array.isArray(state.tracks?.opacity) ? state.tracks.opacity : [];
                    return {
                        durationMs: Math.max(1, Math.round(Number(state.durationMs || 1))),
                        graphType: String(state.graphType || 'ease-in-out').trim() || 'ease-in-out',
                        playheadMs: Math.round(Number(state.playheadMs) || 0),
                        tracks: {
                            position: cloneTrack(pos),
                            scale: cloneTrack(sc),
                            opacity: cloneTrack(op),
                        },
                    };
                };

                const canUndo = () => (Array.isArray(history.undo) ? history.undo.length : 0) > 1;
                const canRedo = () => (Array.isArray(history.redo) ? history.redo.length : 0) > 0;

                const pushHistory = () => {
                    try {
                        if (history.lock) return;
                        const snap = snapshotEditorState();

                        const u = Array.isArray(history.undo) ? history.undo : [];
                        const last = u.length ? u[u.length - 1] : null;

                        const isSame = (() => {
                            try {
                                if (!last) return false;
                                if (Number(last.durationMs) !== Number(snap.durationMs)) return false;
                                if (String(last.graphType) !== String(snap.graphType)) return false;
                                const a = last.tracks || {};
                                const b = snap.tracks || {};
                                const toKey = (tr, k) => {
                                    const t = Math.round(Number(k?.t) || 0);
                                    if (tr === 'position') return `${t}:${Number(k?.x ?? 0)}:${Number(k?.y ?? 0)}`;
                                    if (tr === 'scale') return `${t}:${Number(k?.s ?? 1)}`;
                                    if (tr === 'opacity') return `${t}:${Number(k?.o ?? 1)}`;
                                    return `${t}`;
                                };
                                const listEq = (tr) => {
                                    const aa = Array.isArray(a?.[tr]) ? a[tr] : [];
                                    const bb = Array.isArray(b?.[tr]) ? b[tr] : [];
                                    if (aa.length !== bb.length) return false;
                                    for (let i = 0; i < aa.length; i += 1) {
                                        if (toKey(tr, aa[i]) !== toKey(tr, bb[i])) return false;
                                    }
                                    return true;
                                };
                                if (!listEq('position')) return false;
                                if (!listEq('scale')) return false;
                                if (!listEq('opacity')) return false;
                                return true;
                            } catch {
                                return false;
                            }
                        })();
                        if (isSame) return;

                        u.push(snap);
                        while (u.length > (Number(history.limit) || 100)) u.shift();
                        history.undo = u;
                        history.redo = [];
                        try { this._updateNav?.(); } catch { }
                    } catch { }
                };

                const restoreEditorState = (snap) => {
                    try {
                        if (!snap || typeof snap !== 'object') return;
                        history.lock = true;

                        try {
                            if (state.isPlaying) {
                                state.isPlaying = false;
                                try { cancelAnimationFrame(state._playRaf); } catch { }
                                state._playRaf = 0;
                                try { if (layerChar) layerChar.style.animationPlayState = 'paused'; } catch { }
                                try { setPlayingUi(); } catch { }
                            }
                        } catch { }

                        state.durationMs = Math.max(1, Math.round(Number(snap.durationMs || 1)));
                        state.graphType = String(snap.graphType || 'ease-in-out').trim() || 'ease-in-out';
                        state.loop = true;
                        state.tracks = {
                            position: sortUniqByT(cloneTrack(snap.tracks?.position || [])),
                            scale: sortUniqByT(cloneTrack(snap.tracks?.scale || [])),
                            opacity: sortUniqByT(cloneTrack(snap.tracks?.opacity || [])),
                        };
                        state.selected = null;
                        clearSelection();

                        state.playheadMs = clampMs(Number(snap.playheadMs) || 0);

                        rerenderTimeline();
                        applyPreview();
                        setPlayheadMs(state.playheadMs, { seek: true });
                        try { queueAutoSave(); } catch { }
                    } catch { }
                    finally {
                        history.lock = false;
                        try { this._updateNav?.(); } catch { }
                    }
                };

                const doUndo = () => {
                    try {
                        if (!canUndo()) return;
                        const cur = history.undo.pop();
                        history.redo.push(cur);
                        const prev = history.undo[history.undo.length - 1];
                        restoreEditorState(prev);
                    } catch { }
                };

                const doRedo = () => {
                    try {
                        if (!canRedo()) return;
                        const next = history.redo.pop();
                        history.undo.push(next);
                        while (history.undo.length > (Number(history.limit) || 100)) history.undo.shift();
                        restoreEditorState(next);
                    } catch { }
                };

                // Expose for navibar tool buttons
                try {
                    this._albumAnimEditorUndo = doUndo;
                    this._albumAnimEditorRedo = doRedo;
                    this._albumAnimEditorCanUndo = canUndo;
                    this._albumAnimEditorCanRedo = canRedo;
                } catch { }

                const upsertKey = (trackName, keyObj) => {
                    const tr = String(trackName || '').trim();
                    if (!tr) return;
                    const t = clampMs(keyObj?.t);
                    const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                    state.tracks[tr] = arr;

                    const idx = arr.findIndex(k => Number(k?.t) === Number(t));
                    const next = { ...(keyObj || {}), t };
                    if (idx >= 0) {
                        arr[idx] = { ...arr[idx], ...next };
                    } else {
                        arr.push(next);
                    }
                    state.tracks[tr] = sortUniqByT(arr);
                    const newIdx = state.tracks[tr].findIndex(k => Number(k?.t) === Number(t));
                    state.selected = { track: tr, i: Math.max(0, newIdx) };

                    // If nothing is selected yet, select the key we just edited/created.
                    try {
                        const sel = getSelectedKeyIds();
                        if (sel.size === 0) {
                            sel.add(keyId(tr, t));
                        }
                    } catch { }

                    // Always auto-save edits into the auto-preset.
                    try { queueAutoSave(); } catch { }

                    // History (avoid spamming when locked, e.g. during drag)
                    try { pushHistory(); } catch { }
                };

                const evalAt = (trackName, t) => {
                    const tr = String(trackName || '').trim();
                    const time = clampMs(t);
                    const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                    const keys = [...arr].filter(k => k && Number.isFinite(Number(k.t))).map(k => ({ ...k, t: Math.round(Number(k.t)) }))
                        .sort((a, b) => a.t - b.t);

                    const defaults = (() => {
                        if (tr === 'position') return { x: 0, y: 0 };
                        if (tr === 'scale') return { s: 1 };
                        if (tr === 'opacity') return { o: 1 };
                        return {};
                    })();

                    if (!keys.length) return { t: time, ...defaults };
                    if (time <= keys[0].t) return { t: time, ...defaults, ...keys[0] };
                    if (time >= keys[keys.length - 1].t) return { t: time, ...defaults, ...keys[keys.length - 1] };

                    let i = 0;
                    while (i < keys.length - 1 && keys[i + 1].t < time) i += 1;
                    const a = keys[i];
                    const b = keys[i + 1];
                    const span = Math.max(1, (Number(b.t) || 0) - (Number(a.t) || 0));
                    const ratio = clamp((time - a.t) / span, 0, 1);

                    if (tr === 'position') {
                        const ax = Number(a.x ?? 0);
                        const ay = Number(a.y ?? 0);
                        const bx = Number(b.x ?? 0);
                        const by = Number(b.y ?? 0);
                        return {
                            t: time,
                            x: (Number.isFinite(ax) ? ax : 0) + ((Number.isFinite(bx) ? bx : 0) - (Number.isFinite(ax) ? ax : 0)) * ratio,
                            y: (Number.isFinite(ay) ? ay : 0) + ((Number.isFinite(by) ? by : 0) - (Number.isFinite(ay) ? ay : 0)) * ratio,
                        };
                    }
                    if (tr === 'scale') {
                        const as = Number(a.s ?? 1);
                        const bs = Number(b.s ?? 1);
                        const s = (Number.isFinite(as) ? as : 1) + ((Number.isFinite(bs) ? bs : 1) - (Number.isFinite(as) ? as : 1)) * ratio;
                        return { t: time, s: Math.max(0, s) };
                    }
                    if (tr === 'opacity') {
                        const ao = Number(a.o ?? 1);
                        const bo = Number(b.o ?? 1);
                        const o = (Number.isFinite(ao) ? ao : 1) + ((Number.isFinite(bo) ? bo : 1) - (Number.isFinite(ao) ? ao : 1)) * ratio;
                        return { t: time, o: clamp(Number.isFinite(o) ? o : 1, 0, 1) };
                    }
                    return { t: time, ...defaults };
                };

                let _rafPending = false;
                const scheduleUiUpdate = ({ preview = true, timeline = true } = {}) => {
                    if (_rafPending) return;
                    _rafPending = true;
                    requestAnimationFrame(() => {
                        _rafPending = false;
                        try {
                            if (timeline) rerenderTimeline();
                            if (preview) applyPreview();
                        } catch { }
                    });
                };

                const seekPreviewToMs = (ms) => {
                    try {
                        if (!layerChar) return;
                        const t = clampMs(ms);

                        // Pause and seek by setting a negative delay.
                        // This gives a scrub-like behavior similar to video editors.
                        const style = layerChar.style;
                        style.animationDelay = `${-t}ms`;
                        style.animationPlayState = 'paused';
                        try { void layerChar.getBoundingClientRect(); } catch { }
                    } catch { }
                };

                const setPlayheadMs = (ms, { seek = true } = {}) => {
                    state.playheadMs = clampMs(ms);
                    try {
                        const needle = dialog.querySelector('[data-role="needle"]');
                        const durationMs = getDurationMs();
                        const pct = durationMs > 0 ? (clamp(state.playheadMs, 0, durationMs) / durationMs) * 100 : 0;
                        if (needle) needle.style.left = `${pct}%`;
                    } catch { }
                    if (state.isPlaying && seek) {
                        // manual seek cancels playback
                        state.isPlaying = false;
                        try { cancelAnimationFrame(state._playRaf); } catch { }
                        state._playRaf = 0;
                    }
                    if (seek) seekPreviewToMs(state.playheadMs);
                    try { updateTrackTitles(); } catch { }
                    try {
                        const el = dialog.querySelector('[data-role="current-time"]');
                        if (el) el.textContent = `${Math.round(Number(state.playheadMs) || 0)}ms`;
                    } catch { }
                };

                const updateTrackTitles = () => {
                    try {
                        const pos = evalAt('position', state.playheadMs);
                        const sc = evalAt('scale', state.playheadMs);
                        const op = evalAt('opacity', state.playheadMs);

                        // Keep anchor stuck to the same animated transform as the character layer.
                        try {
                            if (anchorEl) {
                                const x = Number(pos.x || 0);
                                const y = Number(pos.y || 0);
                                const s = Math.max(0.01, Number(sc.s ?? 1));
                                anchorEl.style.transform = `translate(-50%, -50%) translate(${x.toFixed(3)}px, ${y.toFixed(3)}px) scale(${s.toFixed(4)})`;
                            }
                        } catch { }

                        const posTitle = dialog.querySelector('.plugin-album__anim-editor-track-title[data-track="position"]');
                        const scTitle = dialog.querySelector('.plugin-album__anim-editor-track-title[data-track="scale"]');
                        const opTitle = dialog.querySelector('.plugin-album__anim-editor-track-title[data-track="opacity"]');

                        if (posTitle) posTitle.textContent = `Position X${Math.round(Number(pos.x || 0))} Y${Math.round(Number(pos.y || 0))}`;
                        if (scTitle) scTitle.textContent = `Scale ${Number(sc.s ?? 1).toFixed(2)}`;
                        if (opTitle) opTitle.textContent = `Opacity ${Number(op.o ?? 1).toFixed(2)}`;

                        // Sync opacity slider with evaluated value (avoid fighting while dragging).
                        try {
                            if (opacitySliderEl && !opacitySliderEl.__albumDragging) {
                                const v = clamp(Number(op.o ?? 1), 0, 1);
                                opacitySliderEl.value = String(v);
                            }
                        } catch { }
                    } catch { }
                };

                const setPlayingUi = () => {
                    try {
                        const icon = dialog.querySelector('[data-action="play"] .material-symbols-outlined');
                        if (icon) icon.textContent = state.isPlaying ? 'pause' : 'play_arrow';
                    } catch { }
                };

                const playFromPlayhead = () => {
                    try {
                        if (!layerChar) return;
                        state.isPlaying = true;
                        setPlayingUi();

                        const nowPerf = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        state._playStartPerf = nowPerf;
                        state._playStartMs = clampMs(state.playheadMs);

                        try {
                            layerChar.style.animationDelay = `${-state._playStartMs}ms`;
                            layerChar.style.animationPlayState = 'running';
                        } catch { }

                        const tick = () => {
                            if (!state.isPlaying) return;
                            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                            const elapsed = Math.max(0, now - state._playStartPerf);
                            const dur = getDurationMs();
                            let t = state._playStartMs + elapsed;
                            if (state.loop) {
                                t = dur > 0 ? (t % dur) : 0;
                            } else {
                                if (t >= dur) {
                                    t = dur;
                                    state.isPlaying = false;
                                }
                            }
                            setPlayheadMs(t, { seek: false });
                            seekPreviewToMs(t);
                            if (state.isPlaying) state._playRaf = requestAnimationFrame(tick);
                            setPlayingUi();
                        };
                        state._playRaf = requestAnimationFrame(tick);
                    } catch { }
                };

                const chooseRulerStepMs = (durationMs, rulerWidthPx) => {
                    const dur = Math.max(1, Math.round(durationMs || 1));
                    const candidates = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 15000, 30000, 60000];

                    // Scale tick density with UI width.
                    // We aim for ~55px per major tick to be reasonably dense.
                    const width = Math.max(0, Number(rulerWidthPx) || 0);
                    const minPxPerMajor = 55;
                    const idealTicks = (() => {
                        if (width <= 0) return 10;
                        const approx = Math.floor(width / minPxPerMajor);
                        return clamp(approx, 6, 24);
                    })();

                    let best = 100;
                    let bestScore = Infinity;
                    candidates.forEach((s) => {
                        const tickCount = dur / s;
                        const score = Math.abs(tickCount - idealTicks) + (tickCount > (idealTicks * 2) ? 10 : 0);
                        if (score < bestScore) {
                            bestScore = score;
                            best = s;
                        }
                    });
                    return Math.max(1, best);
                };

                const rerenderRuler = () => {
                    try {
                        const durationMs = getDurationMs();
                        state.playheadMs = clampMs(state.playheadMs);

                        const rulerTicks = dialog.querySelector('[data-role="ruler-ticks"]');
                        const gridlines = dialog.querySelector('[data-role="gridlines"]');
                        const ruler = dialog.querySelector('[data-role="ruler"]');
                        const rulerLabels = dialog.querySelector('[data-role="ruler-labels"]');
                        const rulerWrap = dialog.querySelector('.plugin-album__anim-editor-ruler-wrap');
                        const miniConfig = dialog.querySelector('.plugin-album__anim-editor-mini-config');
                        if (!rulerTicks || !gridlines) return;

                        // Pin configs overlay to the left edge of the viewport.
                        try {
                            if (miniConfig && rulerWrap) {
                                miniConfig.style.position = 'fixed';
                                miniConfig.style.left = '0px';
                                miniConfig.style.transform = 'none';
                                const wrapRect = rulerWrap.getBoundingClientRect();
                                const h = miniConfig.getBoundingClientRect().height || 0;
                                const pad = readCssPxVar('--spacing-2', 8);
                                const top = Math.max(0, Math.round(wrapRect.top - h - pad));
                                miniConfig.style.top = `${top}px`;
                                miniConfig.style.zIndex = '60';
                            }
                        } catch { }

                        const rulerWidth = (() => {
                            try { return ruler ? ruler.getBoundingClientRect().width : 0; } catch { }
                            return 0;
                        })();

                        const stepMs = chooseRulerStepMs(durationMs, rulerWidth);
                        const majors = [];
                        for (let t = 0; t <= durationMs; t += stepMs) majors.push(t);
                        if (majors[majors.length - 1] !== durationMs) majors.push(durationMs);

                        // Midpoint minor ticks (between each major tick) when there's enough room.
                        const pxPerMajor = (rulerWidth > 0 && majors.length >= 2) ? rulerWidth / (majors.length - 1) : 0;
                        const showMinor = pxPerMajor >= 110;
                        // Labels should be relatively dense; only thin out when extremely tight.
                        const labelStride = (pxPerMajor > 0 && pxPerMajor < 34) ? 2 : 1;

                        const tickHtml = [];
                        const gridHtml = [];
                        const labelHtml = [];

                        majors.forEach((t, idx) => {
                            const pct = durationMs > 0 ? (clamp(t, 0, durationMs) / durationMs) * 100 : 0;
                            tickHtml.push(`<div class="plugin-album__anim-editor-ruler-tick" style="left:${pct}%"></div>`);
                            gridHtml.push(`<div class="plugin-album__anim-editor-gridline" style="left:${pct}%"></div>`);

                            const shouldLabel = (idx % labelStride === 0) || t === 0 || t === durationMs;
                            if (rulerLabels && shouldLabel) {
                                const label = String(Math.max(0, Math.round(Number(t) || 0)));
                                const edgeClass = idx === 0 ? 'is-edge-start' : (idx === majors.length - 1 ? 'is-edge-end' : '');
                                labelHtml.push(`<div class="plugin-album__anim-editor-ruler-label ${edgeClass}" style="left:${pct}%">${escapeText(label)}</div>`);
                            }

                            if (showMinor && idx < majors.length - 1) {
                                const next = majors[idx + 1];
                                const mid = Math.round((t + next) / 2);
                                const mpct = durationMs > 0 ? (clamp(mid, 0, durationMs) / durationMs) * 100 : 0;
                                tickHtml.push(`<div class="plugin-album__anim-editor-ruler-tick is-minor" style="left:${mpct}%"></div>`);
                                gridHtml.push(`<div class="plugin-album__anim-editor-gridline is-minor" style="left:${mpct}%"></div>`);
                            }
                        });

                        rulerTicks.innerHTML = tickHtml.join('');
                        gridlines.innerHTML = gridHtml.join('');
                        if (rulerLabels) rulerLabels.innerHTML = labelHtml.join('');

                        setPlayheadMs(state.playheadMs, { seek: false });
                    } catch { }
                };

                const parseTimeline = (timelineRaw) => {
                    // Accept:
                    // - legacy list: [t1, t2, ...]
                    // - dict: { duration_ms, loop, tracks: { position/scale/opacity } }
                    const out = {
                        durationMs: 500,
                        loop: true,
                        tracks: { position: [], scale: [], opacity: [] },
                    };

                    const toMs = (v) => {
                        const n = Number(v);
                        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : NaN;
                    };
                    const readT = (it) => {
                        if (typeof it === 'number') return toMs(it);
                        if (it && typeof it === 'object') return toMs(it.t_ms ?? it.tMs ?? it.t ?? it.time_ms ?? it.timeMs ?? it.time);
                        return NaN;
                    };

                    if (Array.isArray(timelineRaw)) {
                        const times = timelineRaw
                            .map(x => Number(x))
                            .filter(n => Number.isFinite(n) && n >= 0)
                            .map(n => Math.round(n));
                        const uniq = Array.from(new Set(times)).sort((a, b) => a - b);
                        out.tracks.position = uniq.map(t => ({ t, x: 0, y: 0 }));
                        out.tracks.scale = uniq.map(t => ({ t, s: 1 }));
                        out.tracks.opacity = uniq.map(t => ({ t, o: 1 }));
                        return out;
                    }

                    if (!timelineRaw || typeof timelineRaw !== 'object') return out;

                    const d = Number(timelineRaw.duration_ms ?? timelineRaw.durationMs ?? timelineRaw.duration ?? 500);
                    if (Number.isFinite(d) && d > 0) out.durationMs = Math.round(d);

                    // Loop UI is removed; always treat timelines as looping.

                    const root = (timelineRaw.tracks && typeof timelineRaw.tracks === 'object') ? timelineRaw.tracks : timelineRaw;

                    const readTrackKeys = (name) => {
                        const track = root?.[name] ?? root?.[`${name}_track`] ?? root?.[`${name}Track`];
                        if (track && typeof track === 'object' && !Array.isArray(track) && Array.isArray(track.keys)) return track.keys;
                        if (Array.isArray(track)) return track;
                        return [];
                    };

                    const posKeys = readTrackKeys('position').map(it => {
                        const t = readT(it);
                        if (!Number.isFinite(t)) return null;
                        const obj = (it && typeof it === 'object') ? it : {};
                        const x = Number(obj.x_px ?? obj.xPx ?? obj.x ?? obj.dx ?? 0);
                        const y = Number(obj.y_px ?? obj.yPx ?? obj.y ?? obj.dy ?? 0);
                        return { t, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
                    }).filter(Boolean);

                    const scaleKeys = readTrackKeys('scale').map(it => {
                        const t = readT(it);
                        if (!Number.isFinite(t)) return null;
                        const obj = (it && typeof it === 'object') ? it : {};
                        const s = Number(obj.s ?? obj.scale ?? obj.value ?? 1);
                        return { t, s: Number.isFinite(s) ? s : 1 };
                    }).filter(Boolean);

                    const opacityKeys = readTrackKeys('opacity').map(it => {
                        const t = readT(it);
                        if (!Number.isFinite(t)) return null;
                        const obj = (it && typeof it === 'object') ? it : {};
                        const o = Number(obj.v ?? obj.opacity ?? obj.value ?? 1);
                        const ov = Number.isFinite(o) ? clamp(o, 0, 1) : 1;
                        return { t, o: ov };
                    }).filter(Boolean);

                    const sortUniqByT = (arr, pick) => {
                        const map = new Map();
                        (Array.isArray(arr) ? arr : []).forEach(k => {
                            if (!k || !Number.isFinite(Number(k.t))) return;
                            map.set(Number(k.t), k);
                        });
                        return Array.from(map.values()).sort((a, b) => a.t - b.t);
                    };

                    out.tracks.position = sortUniqByT(posKeys);
                    out.tracks.scale = sortUniqByT(scaleKeys);
                    out.tracks.opacity = sortUniqByT(opacityKeys);

                    // Backward compat: if only generic keys exist, hydrate them into all tracks.
                    const legacyKeys = timelineRaw.keys ?? timelineRaw.keys_ms ?? timelineRaw.keysMs;
                    if ((!out.tracks.position.length && !out.tracks.scale.length && !out.tracks.opacity.length) && Array.isArray(legacyKeys)) {
                        const uniq = Array.from(new Set(legacyKeys.map(readT).filter(n => Number.isFinite(n)))).sort((a, b) => a - b);
                        out.tracks.position = uniq.map(t => ({ t, x: 0, y: 0 }));
                        out.tracks.scale = uniq.map(t => ({ t, s: 1 }));
                        out.tracks.opacity = uniq.map(t => ({ t, o: 1 }));
                    }

                    return out;
                };

                const buildTimelinePayload = () => {
                    const durationMs = Math.max(1, Math.round(state.durationMs || 1000));
                    const pos = Array.isArray(state.tracks?.position) ? state.tracks.position : [];
                    const sc = Array.isArray(state.tracks?.scale) ? state.tracks.scale : [];
                    const op = Array.isArray(state.tracks?.opacity) ? state.tracks.opacity : [];

                    const cleanT = (t) => Math.max(0, Math.round(Number(t) || 0));
                    const cleanN = (v, fallback) => {
                        const n = Number(v);
                        return Number.isFinite(n) ? n : fallback;
                    };

                    return {
                        duration_ms: durationMs,
                        loop: true,
                        tracks: {
                            position: {
                                keys: pos.map(k => ({
                                    t_ms: cleanT(k?.t),
                                    x_px: cleanN(k?.x, 0),
                                    y_px: cleanN(k?.y, 0),
                                })),
                            },
                            scale: {
                                keys: sc.map(k => ({
                                    t_ms: cleanT(k?.t),
                                    s: Math.max(0, cleanN(k?.s, 1)),
                                })),
                            },
                            opacity: {
                                keys: op.map(k => ({
                                    t_ms: cleanT(k?.t),
                                    v: clamp(cleanN(k?.o, 1), 0, 1),
                                })),
                            },
                        },
                    };
                };

                const applyPreview = () => {
                    try {
                        if (!layerChar) return;
                        const engine = getEngine();
                        if (!engine || typeof engine.applyPresetOnElement !== 'function') return;
                        engine.applyPresetOnElement(layerChar, {
                            timeline: buildTimelinePayload(),
                            graphType: String(state.graphType || 'linear').trim() || 'linear',
                        }, {
                            loop: !!state.loop,
                            seamless: false,
                        });
                        seekPreviewToMs(state.playheadMs);
                        try { updateTrackTitles(); } catch { }
                    } catch { }
                };

                const rerenderTimeline = () => {
                    const nameInput = dialog.querySelector('[data-role="name"]');
                    const durInput2 = dialog.querySelector('[data-role="duration2"]');
                    const graphInput2 = dialog.querySelector('[data-role="graph2"]');
                    const tracks = dialog.querySelectorAll('[data-role="track"]');

                    const durationMs = getDurationMs();
                    if (nameInput) nameInput.value = state.name || '';
                    if (durInput2) durInput2.value = String(durationMs);
                    if (graphInput2) graphInput2.value = state.graphType || 'ease-in-out';

                    setPlayingUi();
                    updateTrackTitles();

                    try {
                        const el = dialog.querySelector('[data-role="current-time"]');
                        if (el) el.textContent = `${Math.round(Number(state.playheadMs) || 0)}ms`;
                    } catch { }

                    // Keep playhead valid if duration changes
                    state.playheadMs = clampMs(state.playheadMs);
                    rerenderRuler();

                    const renderTrack = (trackEl, trackName) => {
                        if (!trackEl) return;
                        const keys = Array.isArray(state.tracks?.[trackName]) ? state.tracks[trackName] : [];
                        trackEl.innerHTML = keys.map((k, i) => {
                            const t = Number(k?.t);
                            const left = durationMs > 0 ? (clamp(Number.isFinite(t) ? t : 0, 0, durationMs) / durationMs) * 100 : 0;
                            const kid = keyId(trackName, t);
                            const isSel = getSelectedKeyIds().has(kid) || !!(state.selected && state.selected.track === trackName && state.selected.i === i);
                            const title = (() => {
                                const tt = `${Math.max(0, Math.round(Number.isFinite(t) ? t : 0))}ms`;
                                if (trackName === 'position') return `${tt} (x=${Number(k?.x ?? 0)}, y=${Number(k?.y ?? 0)})`;
                                if (trackName === 'scale') return `${tt} (s=${Number(k?.s ?? 1)})`;
                                if (trackName === 'opacity') return `${tt} (o=${Number(k?.o ?? 1)})`;
                                return tt;
                            })();
                            return `<button type="button" class="plugin-album__anim-editor-key ${isSel ? 'is-selected' : ''}" data-track="${escapeText(trackName)}" data-i="${i}" data-t="${Math.round(Number.isFinite(t) ? t : 0)}" style="left:${left}%" title="${escapeText(title)}"></button>`;
                        }).join('');
                    };

                    tracks?.forEach(trackEl => {
                        const tr = String(trackEl.dataset.track || '').trim();
                        if (!tr) return;
                        renderTrack(trackEl, tr);
                    });

                    // Wire key events after DOM update (drag + menu)
                    try {
                        bindKeyInteractions();
                    } catch { }
                };

                // Key menu (context)
                const keyMenu = (() => {
                    const el = document.createElement('div');
                    el.className = 'plugin-album__anim-editor-keymenu';
                    el.hidden = true;
                    el.innerHTML = `
                        <button type="button" data-action="seek">Seek</button>
                        <button type="button" data-action="cloneToNeedle">Clone to needle</button>
                        <button type="button" data-action="deleteKey">Delete</button>
                    `;
                    return el;
                })();

                let keyMenuState = null; // { track, keyRef }
                const closeKeyMenu = () => {
                    try {
                        keyMenu.hidden = true;
                        keyMenuState = null;
                    } catch { }
                };
                const openKeyMenu = (btn, trackName, keyRef) => {
                    try {
                        if (!btn || typeof btn.getBoundingClientRect !== 'function') return;

                        // Use position:fixed so the menu won't be clipped by containers (opacity track is at the bottom).
                        if (keyMenu.parentElement !== document.body) {
                            try { document.body.appendChild(keyMenu); } catch { }
                        }

                        keyMenu.style.position = 'fixed';
                        keyMenu.style.left = '-9999px';
                        keyMenu.style.top = '-9999px';
                        keyMenu.hidden = false;

                        const b = btn.getBoundingClientRect();
                        const menuRect = keyMenu.getBoundingClientRect();
                        const vw = Math.max(0, window.innerWidth || 0);
                        const vh = Math.max(0, window.innerHeight || 0);
                        const margin = 8;

                        let left = Math.round(b.left + 12);
                        let top = Math.round(b.top + 4);

                        // Flip above if it would go off-screen.
                        if ((top + menuRect.height) > (vh - margin)) {
                            top = Math.round(b.top - menuRect.height - 6);
                        }
                        // Clamp inside viewport.
                        if ((left + menuRect.width) > (vw - margin)) left = Math.round(vw - menuRect.width - margin);
                        if (left < margin) left = margin;
                        if (top < margin) top = margin;

                        keyMenu.style.left = `${left}px`;
                        keyMenu.style.top = `${top}px`;
                        keyMenu.style.zIndex = '80';
                        keyMenu.hidden = false;
                        keyMenuState = {
                            track: String(trackName || '').trim(),
                            keyRef,
                            selectionIds: Array.from(getSelectedKeyIds().values()),
                        };
                    } catch { }
                };

                // Close key menu on outside click
                try {
                    document.addEventListener('pointerdown', (e) => {
                        try {
                            if (keyMenu.hidden) return;
                            const target = e.target;
                            if (target && (keyMenu.contains(target))) return;
                            if (target && target.classList && target.classList.contains('plugin-album__anim-editor-key')) return;
                            closeKeyMenu();
                        } catch { }
                    }, { capture: true });
                } catch { }

                keyMenu.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const btn = e.target?.closest ? e.target.closest('button[data-action]') : null;
                    const action = String(btn?.dataset?.action || '').trim();
                    if (!action || !keyMenuState) return;

                    if (action === 'seek') {
                        try {
                            const t = Number(keyMenuState.keyRef?.t);
                            if (Number.isFinite(t)) setPlayheadMs(t, { seek: true });
                        } catch { }
                        closeKeyMenu();
                        return;
                    }

                    const selection = (() => {
                        const ids = Array.isArray(keyMenuState.selectionIds) ? keyMenuState.selectionIds : [];
                        if (ids.length) return ids;
                        // Fallback: only the clicked key
                        const fallbackT = Number(keyMenuState.keyRef?.t);
                        if (Number.isFinite(fallbackT)) return [keyId(keyMenuState.track, fallbackT)];
                        return [];
                    })();

                    const getKeyData = (tr, t) => {
                        const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                        return arr.find(k => Number(k?.t) === Number(t)) || null;
                    };

                    if (action === 'deleteKey') {
                        // Delete all selected keys
                        const byTrack = new Map();
                        selection.forEach((id) => {
                            const parsed = parseKeyId(id);
                            if (!parsed) return;
                            if (!byTrack.has(parsed.tr)) byTrack.set(parsed.tr, new Set());
                            byTrack.get(parsed.tr).add(parsed.t);
                        });

                        byTrack.forEach((times, tr) => {
                            const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                            state.tracks[tr] = sortUniqByT(arr.filter(k => !times.has(Math.round(Number(k?.t) || 0))));
                        });

                        try { pushHistory(); } catch { }

                        clearSelection();
                        closeKeyMenu();
                        rerenderTimeline();
                        applyPreview();
                        try { queueAutoSave(); } catch { }
                        return;
                    }

                    if (action === 'cloneToNeedle') {
                        // Clone the whole selection, preserving relative offsets.
                        const items = selection.map((id) => {
                            const parsed = parseKeyId(id);
                            if (!parsed) return null;
                            const data = getKeyData(parsed.tr, parsed.t);
                            if (!data) return null;
                            return { tr: parsed.tr, t: parsed.t, data: { ...data } };
                        }).filter(Boolean);

                        if (!items.length) {
                            closeKeyMenu();
                            return;
                        }

                        const minT = Math.min(...items.map(it => Math.round(Number(it.t) || 0)));
                        const needle = clampMs(state.playheadMs);
                        const newSel = new Set();
                        // Batch clone => single history step
                        try { history.lock = true; } catch { }
                        try {
                            items
                                .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0))
                                .forEach((it) => {
                                    const offset = Math.round(Number(it.t) || 0) - minT;
                                    const t2 = clampMs(needle + offset);
                                    if (it.tr === 'position') upsertKey('position', { t: t2, x: Number(it.data.x ?? 0), y: Number(it.data.y ?? 0) });
                                    if (it.tr === 'scale') upsertKey('scale', { t: t2, s: Math.max(0, Number(it.data.s ?? 1)) });
                                    if (it.tr === 'opacity') upsertKey('opacity', { t: t2, o: clamp(Number(it.data.o ?? 1), 0, 1) });
                                    newSel.add(keyId(it.tr, t2));
                                });
                        } catch { }
                        try { history.lock = false; } catch { }
                        try { pushHistory(); } catch { }

                        try {
                            clearSelection();
                            newSel.forEach(id => getSelectedKeyIds().add(id));
                        } catch { }
                        closeKeyMenu();
                        rerenderTimeline();
                        applyPreview();
                        return;
                    }

                    // Always close menu after a handled action.
                    closeKeyMenu();
                });

                // Key dragging
                let keyDrag = null; // { btn, track, keyRef, startX, startT, moved }
                const bindKeyInteractions = () => {
                    dialog.querySelectorAll('.plugin-album__anim-editor-key')?.forEach((btn) => {
                        if (btn.__albumKeyBound) return;
                        btn.__albumKeyBound = true;

                        // Disable native browser context menu on keyframes.
                        btn.addEventListener('contextmenu', (e) => {
                            try { e.preventDefault(); } catch { }
                        });

                        btn.addEventListener('pointerdown', (e) => {
                            try {
                                e.preventDefault();
                                e.stopPropagation();
                                const tr = String(btn.dataset.track || '').trim();
                                const i = Number(btn.dataset.i);
                                const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                                if (!tr || !Number.isInteger(i) || i < 0 || i >= arr.length) return;
                                const keyRef = arr[i];

                                const sel = getSelectedKeyIds();
                                const clickedId = keyId(tr, keyRef?.t);
                                if (sel.size > 0 && !sel.has(clickedId)) {
                                    // Clicking/dragging a non-selected key replaces selection.
                                    clearSelection();
                                    sel.add(clickedId);
                                }
                                if (sel.size === 0) {
                                    sel.add(clickedId);
                                }

                                // Snapshot selected keys for potential group move.
                                const selectedItems = [];
                                try {
                                    sel.forEach((id) => {
                                        const parsed = parseKeyId(id);
                                        if (!parsed) return;
                                        const a = Array.isArray(state.tracks?.[parsed.tr]) ? state.tracks[parsed.tr] : [];
                                        const k = a.find(x => Number(x?.t) === Number(parsed.t)) || null;
                                        if (!k) return;
                                        selectedItems.push({ tr: parsed.tr, t0: Math.round(Number(parsed.t) || 0), data: { ...k } });
                                    });
                                } catch { }

                                keyDrag = {
                                    btn,
                                    track: tr,
                                    keyRef,
                                    startX: Number(e.clientX) || 0,
                                    startT: Number(keyRef?.t) || 0,
                                    moved: false,
                                    pointerId: e.pointerId,
                                    group: (sel.size > 1 || (sel.size === 1 && sel.has(clickedId))) ? selectedItems : null,
                                    groupStartT: Math.round(Number(keyRef?.t) || 0),
                                };
                                try { btn.setPointerCapture(e.pointerId); } catch { }

                                // Important: do NOT rerender here; it would replace the pressed button,
                                // breaking pointerup and making key menu impossible to open.
                                closeKeyMenu();
                                syncKeySelectionClasses();
                            } catch { }
                        });

                        btn.addEventListener('pointermove', (e) => {
                            try {
                                if (!keyDrag || keyDrag.btn !== btn) return;
                                const trackEl = btn.closest('[data-role="track"]');
                                if (!trackEl) return;
                                const rect = trackEl.getBoundingClientRect();
                                const x = Number(e.clientX) - rect.left;
                                const ratio = rect.width > 0 ? clamp(x / rect.width, 0, 1) : 0;
                                const t = clampMs(Math.round(ratio * getDurationMs()));

                                // Group move: move all selected keys together (visual only)
                                if (Array.isArray(keyDrag.group) && keyDrag.group.length > 0) {
                                    const dt = Math.round(Number(t) || 0) - Math.round(Number(keyDrag.groupStartT) || 0);
                                    const dur = getDurationMs();
                                    const selSet = getSelectedKeyIds();
                                    dialog.querySelectorAll('.plugin-album__anim-editor-key')?.forEach((kb) => {
                                        const ktr = String(kb.dataset.track || '').trim();
                                        const kt = Math.round(Number(kb.dataset.t) || 0);
                                        const id = keyId(ktr, kt);
                                        if (!selSet.has(id)) return;

                                        const item = keyDrag.group.find(it => it.tr === ktr && Number(it.t0) === Number(kt));
                                        if (!item) return;
                                        const nt = clampMs(Number(item.t0) + dt);
                                        const pct = dur > 0 ? (clamp(nt, 0, dur) / dur) * 100 : 0;
                                        kb.style.left = `${pct}%`;
                                    });
                                } else {
                                    const pct = getDurationMs() > 0 ? (clamp(Number(t) || 0, 0, getDurationMs()) / getDurationMs()) * 100 : 0;
                                    btn.style.left = `${pct}%`;
                                }

                                if (Math.abs((Number(e.clientX) || 0) - keyDrag.startX) > 3) keyDrag.moved = true;
                            } catch { }
                        });

                        const finish = (e) => {
                            try {
                                if (!keyDrag || keyDrag.btn !== btn) return;
                                try { btn.releasePointerCapture(keyDrag.pointerId); } catch { }

                                const tr = keyDrag.track;
                                const ref = keyDrag.keyRef;
                                const moved = !!keyDrag.moved;
                                const prevT = Number(keyDrag.startT) || 0;
                                const group = Array.isArray(keyDrag.group) ? keyDrag.group : null;
                                const startT = Math.round(Number(keyDrag.groupStartT) || 0);
                                keyDrag = null;

                                if (moved && group && group.length) {
                                    // Compute dt from where the dragged key ended up visually.
                                    const trackEl = btn.closest('[data-role="track"]');
                                    const dur = getDurationMs();
                                    let finalT = startT;
                                    try {
                                        if (trackEl) {
                                            const rect = trackEl.getBoundingClientRect();
                                            const x = (Number(e.clientX) || 0) - rect.left;
                                            const ratio = rect.width > 0 ? clamp(x / rect.width, 0, 1) : 0;
                                            finalT = clampMs(Math.round(ratio * dur));
                                        }
                                    } catch { }
                                    const dt = Math.round(Number(finalT) || 0) - startT;

                                    // Apply dt to all selected keys.
                                    const newSel = new Set();
                                    const byTrack = new Map();
                                    group.forEach(it => {
                                        const trn = String(it.tr || '').trim();
                                        if (!trn) return;
                                        if (!byTrack.has(trn)) byTrack.set(trn, []);
                                        byTrack.get(trn).push(it);
                                    });

                                    byTrack.forEach((items, trn) => {
                                        const arr = Array.isArray(state.tracks?.[trn]) ? state.tracks[trn] : [];
                                        const selectedTimes = new Set(items.map(it => Math.round(Number(it.t0) || 0)));
                                        let out = arr.filter(k => !selectedTimes.has(Math.round(Number(k?.t) || 0)));

                                        // Add moved keys (moved should win on collisions)
                                        items
                                            .slice()
                                            .sort((a, b) => (Number(a.t0) || 0) - (Number(b.t0) || 0))
                                            .forEach((it) => {
                                                const nt = clampMs(Math.round(Number(it.t0) || 0) + dt);
                                                out.push({ ...it.data, t: nt });
                                                newSel.add(keyId(trn, nt));
                                            });

                                        state.tracks[trn] = sortUniqByT(out);
                                    });

                                    try { pushHistory(); } catch { }

                                    clearSelection();
                                    newSel.forEach(id => getSelectedKeyIds().add(id));
                                    closeKeyMenu();
                                    rerenderTimeline();
                                    applyPreview();
                                    try { queueAutoSave(); } catch { }
                                    return;
                                }

                                if (moved && ref) {
                                    // Single key move
                                    const t = clampMs(prevT);
                                    const trackEl = btn.closest('[data-role="track"]');
                                    try {
                                        if (trackEl) {
                                            const rect = trackEl.getBoundingClientRect();
                                            const x = (Number(e.clientX) || 0) - rect.left;
                                            const ratio = rect.width > 0 ? clamp(x / rect.width, 0, 1) : 0;
                                            const tt = clampMs(Math.round(ratio * getDurationMs()));
                                            // overwrite by time
                                            const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                                            const filtered = arr.filter(k => Number(k?.t) !== Number(tt));
                                            filtered.push({ ...ref, t: tt });
                                            state.tracks[tr] = sortUniqByT(filtered);
                                            clearSelection();
                                            getSelectedKeyIds().add(keyId(tr, tt));

                                            try { pushHistory(); } catch { }
                                            closeKeyMenu();
                                            rerenderTimeline();
                                            applyPreview();
                                            try { queueAutoSave(); } catch { }
                                            return;
                                        }
                                    } catch { }
                                }

                                // Treat as a tap/click: select and open key menu.
                                if (!moved && ref) {
                                    const arr = Array.isArray(state.tracks?.[tr]) ? state.tracks[tr] : [];
                                    // Restore t if pointermove mutated it slightly without crossing move threshold.
                                    try { ref.t = clampMs(prevT); } catch { }
                                    const idx = Math.max(0, arr.indexOf(ref));
                                    state.selected = { track: tr, i: idx };

                                    // Ensure selection contains clicked key (and keep existing multi-selection if clicked is part of it).
                                    const sel = getSelectedKeyIds();
                                    const clicked = keyId(tr, ref?.t);
                                    if (sel.size === 0) sel.add(clicked);
                                    else if (!sel.has(clicked)) {
                                        clearSelection();
                                        sel.add(clicked);
                                    }

                                    rerenderTimeline();
                                    const freshBtn = dialog.querySelector(`.plugin-album__anim-editor-key[data-track="${tr}"][data-i="${idx}"]`);
                                    openKeyMenu(freshBtn || btn, tr, ref);
                                }
                            } catch {
                                keyDrag = null;
                            }
                        };
                        btn.addEventListener('pointerup', finish);
                        btn.addEventListener('pointercancel', finish);
                    });
                };

                // Ruler interactions: move needle + scrub preview
                (() => {
                    const ruler = dialog.querySelector('[data-role="ruler"]');
                    if (!ruler) return;
                    if (ruler.__albumNeedleBound) return;
                    ruler.__albumNeedleBound = true;

                    let dragging = false;

                    const setFromClientX = (clientX) => {
                        const rect = ruler.getBoundingClientRect();
                        const x = Number(clientX) - rect.left;
                        const ratio = rect.width > 0 ? clamp(x / rect.width, 0, 1) : 0;
                        const t = Math.round(ratio * getDurationMs());
                        setPlayheadMs(t, { seek: true });
                    };

                    ruler.addEventListener('pointerdown', (e) => {
                        try {
                            dragging = true;
                            try { ruler.setPointerCapture(e.pointerId); } catch { }
                            setFromClientX(e.clientX);
                        } catch { }
                    });
                    ruler.addEventListener('pointermove', (e) => {
                        try {
                            if (!dragging) return;
                            setFromClientX(e.clientX);
                        } catch { }
                    });
                    const stopDrag = (e) => {
                        try {
                            if (!dragging) return;
                            dragging = false;
                            try { ruler.releasePointerCapture(e.pointerId); } catch { }
                        } catch { }
                    };
                    ruler.addEventListener('pointerup', stopDrag);
                    ruler.addEventListener('pointercancel', stopDrag);
                })();

                // Wire controls
                dialog.querySelector('[data-action="close"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    close();
                });

                dialog.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    try {
                        if (state.isPlaying) {
                            state.isPlaying = false;
                            try { cancelAnimationFrame(state._playRaf); } catch { }
                            state._playRaf = 0;
                            try { if (layerChar) layerChar.style.animationPlayState = 'paused'; } catch { }
                            setPlayingUi();
                            return;
                        }

                        // If we're at the end and playback stopped, restart from the beginning.
                        try {
                            const dur = getDurationMs();
                            if ((Number(state.playheadMs) || 0) >= (dur - 1)) {
                                setPlayheadMs(0, { seek: true });
                            }
                        } catch { }
                        playFromPlayhead();
                    } catch { }
                });

                const nameInput = dialog.querySelector('[data-role="name"]');
                nameInput?.addEventListener('input', () => {
                    try {
                        state.name = String(nameInput.value || '').trim();
                        try {
                            const base = normalizeBasePresetKey(state.name);
                            if (base) saveLocalBasePresetKey(base);
                        } catch { }
                    } catch { }
                });
                const durInput2 = dialog.querySelector('[data-role="duration2"]');
                durInput2?.addEventListener('input', () => {
                    const v = Number(durInput2.value);
                    if (Number.isFinite(v) && v > 0) {
                        const next = Math.round(v);
                        if (next !== Math.round(Number(state.durationMs || 0))) {
                            state.durationMs = next;
                            state.playheadMs = clampMs(state.playheadMs);
                            try { rerenderRuler(); } catch { }
                            rerenderTimeline();
                            applyPreview();
                            try { queueAutoSave(); } catch { }
                            try { pushHistory(); } catch { }
                        }
                    }
                });

                const graphInput2 = dialog.querySelector('[data-role="graph2"]');
                graphInput2?.addEventListener('change', () => {
                    try {
                        const next = String(graphInput2.value || 'ease-in-out').trim() || 'ease-in-out';
                        if (next !== String(state.graphType || '')) {
                            state.graphType = next;
                            applyPreview();
                            try { queueAutoSave(); } catch { }
                            try { pushHistory(); } catch { }
                        }
                    } catch { }
                });

                dialog.querySelector('[data-action="new"]')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    state.name = '';
                    state.durationMs = 500;
                    state.graphType = 'ease-in-out';
                    state.loop = true;
                    state.playheadMs = 0;
                    state.tracks = { position: [], scale: [], opacity: [] };
                    state.selected = null;
                    rerenderTimeline();
                    applyPreview();

                    // New state should also be captured by auto-save.
                    try { queueAutoSave(); } catch { }

                    // History
                    try { pushHistory(); } catch { }
                });

                dialog.querySelector('[data-action="load"]')?.addEventListener('click', async (e) => {
                    e.preventDefault();

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

                    const openManager = async () => {
                        const modal = document.createElement('div');
                        modal.className = 'modal-backdrop plugin-album__character-modal plugin-album__character-anim-preset-manager-modal';
                        const closeModal = () => { try { modal.remove(); } catch { } };
                        modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(); });
                        document.body.appendChild(modal);

                        const dialog2 = document.createElement('div');
                        dialog2.className = 'modal-dialog';
                        modal.appendChild(dialog2);

                        dialog2.innerHTML = `
                            <h3>Animation presets</h3>
                            <div class="plugin-album__character-hint" style="margin-bottom: 10px; color: var(--color-secondary-text);">
                                Tạo mới, đổi tên, clone, xoá, hoặc load preset.
                            </div>
                            <div class="plugin-album__character-submenu-list" data-role="anim-preset-list"></div>
                            <div class="modal-actions">
                                <button type="button" id="btn-add" title="Tạo preset mới"><span class="material-symbols-outlined">add</span></button>
                                <div style="flex-grow:1"></div>
                                <button type="button" id="btn-close" title="Close"><span class="material-symbols-outlined">close</span></button>
                            </div>
                        `;

                        dialog2.querySelector('#btn-close')?.addEventListener('click', closeModal);
                        const listEl = dialog2.querySelector('[data-role="anim-preset-list"]');

                        const refreshList = async () => {
                            await fetchAllPresets();
                            const presets = (Array.isArray(state.presets) ? state.presets : [])
                                .filter(p => !isAutoSavePresetKey(p?.key));
                            if (!listEl) return;
                            listEl.innerHTML = '';

                            presets
                                .slice()
                                .sort((a, b) => String(a?.key || '').localeCompare(String(b?.key || '')))
                                .forEach((p) => {
                                    const key = String(p?.key || '').trim();
                                    if (!key) return;

                                    const row = document.createElement('div');
                                    row.className = 'plugin-album__character-submenu-row plugin-album__anim-preset-row';
                                    row.dataset.key = key;

                                    const nameSpan = document.createElement('div');
                                    nameSpan.className = 'plugin-album__character-submenu-name';
                                    nameSpan.textContent = key;
                                    nameSpan.title = key;

                                    const actions = document.createElement('div');
                                    actions.className = 'plugin-album__anim-preset-actions';

                                    const mkBtn = (icon, title, action) => {
                                        const b = document.createElement('button');
                                        b.type = 'button';
                                        b.className = 'plugin-album__character-submenu-iconbtn';
                                        b.title = title;
                                        b.dataset.action = action;
                                        b.innerHTML = `<span class="material-symbols-outlined">${escapeText(icon)}</span>`;
                                        return b;
                                    };

                                    const btnLoad = mkBtn('play_arrow', 'Load', 'load');
                                    const btnRename = mkBtn('edit', 'Rename', 'rename');
                                    const btnClone = mkBtn('content_copy', 'Clone', 'clone');
                                    const btnDelete = mkBtn('delete_forever', 'Delete', 'delete');

                                    actions.appendChild(btnLoad);
                                    actions.appendChild(btnRename);
                                    actions.appendChild(btnClone);
                                    actions.appendChild(btnDelete);

                                    row.appendChild(nameSpan);
                                    row.appendChild(actions);
                                    listEl.appendChild(row);
                                });
                        };

                        const createPreset = async (key, presetTemplate = null) => {
                            const k = String(key || '').trim();
                            if (!k) return false;
                            const tpl = presetTemplate || {
                                key: k,
                                graph_type: 'linear',
                                timeline: { duration_ms: 500, loop: true, tracks: { position: { keys: [] }, scale: { keys: [] }, opacity: { keys: [] } } },
                            };
                            await this.api.album.post('/animation/presets', {
                                key: k,
                                graph_type: String(tpl.graph_type || tpl.graphType || 'linear').trim() || 'linear',
                                timeline: tpl.timeline || [],
                            });
                            return true;
                        };

                        dialog2.querySelector('#btn-add')?.addEventListener('click', async (ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            const k = String(prompt('Preset key:', '') || '').trim();
                            if (!k) return;
                            try {
                                await createPreset(k);
                                await refreshList();
                            } catch (err) {
                                showError?.(`Lỗi tạo preset: ${err.message || err}`);
                            }
                        });

                        listEl?.addEventListener('click', async (ev) => {
                            const btn = ev.target?.closest?.('button[data-action]');
                            const row = ev.target?.closest?.('.plugin-album__anim-preset-row');
                            const key = String(row?.dataset?.key || '').trim();
                            const action = String(btn?.dataset?.action || '').trim();
                            if (!key || !action) return;
                            ev.preventDefault();
                            ev.stopPropagation();

                            if (action === 'load') {
                                try {
                                    // Load chosen preset into editor
                                    const all = Array.isArray(state.presets) ? state.presets : [];
                                    const found = all.find(pp => String(pp?.key || '').trim() === key) || null;
                                    if (!found) {
                                        showError?.(`Không tìm thấy preset: ${key}`);
                                        return;
                                    }

                                    // Base name drives auto-save destination.
                                    state.name = normalizeBasePresetKey(found.key);
                                    saveLocalBasePresetKey(state.name);

                                    applyPresetToEditorState(found);
                                    rerenderTimeline();
                                    applyPreview();
                                    closeModal();
                                    return;
                                } catch (err) {
                                    showError?.(`Lỗi load preset: ${err.message || err}`);
                                    return;
                                }
                            }

                            if (action === 'rename') {
                                try {
                                    const next = String(prompt('New preset key:', key) || '').trim();
                                    if (!next || next === key) return;

                                    const all = Array.isArray(state.presets) ? state.presets : [];
                                    const found = all.find(pp => String(pp?.key || '').trim() === key) || null;
                                    if (!found) {
                                        showError?.(`Không tìm thấy preset: ${key}`);
                                        return;
                                    }

                                    // Rename by clone + delete (backend keys are immutable).
                                    await createPreset(next, found);
                                    await this.api.album.delete(`/animation/presets/${encodeURIComponent(key)}`);

                                    // If renaming current base preset, update base key.
                                    try {
                                        const base = normalizeBasePresetKey(key);
                                        if (normalizeBasePresetKey(state.name) === base) {
                                            state.name = normalizeBasePresetKey(next);
                                            saveLocalBasePresetKey(state.name);
                                        }
                                    } catch { }

                                    await refreshList();
                                } catch (err) {
                                    showError?.(`Lỗi rename preset: ${err.message || err}`);
                                }
                                return;
                            }

                            if (action === 'clone') {
                                try {
                                    const suggested = `${key}_copy`;
                                    const next = String(prompt('Clone to key:', suggested) || '').trim();
                                    if (!next) return;

                                    const all = Array.isArray(state.presets) ? state.presets : [];
                                    const found = all.find(pp => String(pp?.key || '').trim() === key) || null;
                                    if (!found) {
                                        showError?.(`Không tìm thấy preset: ${key}`);
                                        return;
                                    }
                                    await createPreset(next, found);
                                    await refreshList();
                                } catch (err) {
                                    showError?.(`Lỗi clone preset: ${err.message || err}`);
                                }
                                return;
                            }

                            if (action === 'delete') {
                                try {
                                    const ok = await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ preset '${key}'?`);
                                    if (!ok) return;
                                    await this.api.album.delete(`/animation/presets/${encodeURIComponent(key)}`);
                                    await refreshList();
                                } catch (err) {
                                    showError?.(`Lỗi xoá preset: ${err.message || err}`);
                                }
                                return;
                            }
                        });

                        await refreshList();
                    };

                    try { await openManager(); } catch (err) {
                        showError?.(`Lỗi mở preset manager: ${err.message || err}`);
                    }
                });

                dialog.querySelector('[data-action="save"]')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        const key = String(normalizeBasePresetKey(state.name) || '').trim();
                        if (!key) {
                            showError?.('Hãy nhập preset key.');
                            return;
                        }
                        const payload = {
                            key,
                            timeline: buildTimelinePayload(),
                            graph_type: String(state.graphType || 'linear').trim() || 'linear',
                        };

                        let existing = null;
                        try {
                            const all = await this.api.album.get('/animation/presets');
                            state.presets = Array.isArray(all) ? all : [];
                            existing = state.presets.find(p => String(p?.key || '').trim() === key) || null;
                        } catch { }

                        if (existing) {
                            await this.api.album.put(`/animation/presets/${encodeURIComponent(key)}`, {
                                timeline: payload.timeline,
                                graph_type: payload.graph_type,
                            });
                        } else {
                            await this.api.album.post('/animation/presets', payload);
                        }
                        // Remember last user preset name; editor continues auto-saving into "<name> - auto save".
                        try { saveLocalBasePresetKey(key); } catch { }
                        try { this.updateUI?.('success', 'Saved'); } catch { }
                        try { applyPreview(); } catch { }
                    } catch (err) {
                        showError?.(`Lỗi save preset: ${err.message || err}`);
                    }
                });

                dialog.querySelector('[data-action="clone"]')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        const base = String(normalizeBasePresetKey(state.name) || 'preset').trim() || 'preset';
                        let all = [];
                        try {
                            all = await this.api.album.get('/animation/presets');
                        } catch { }
                        const existingKeys = new Set((Array.isArray(all) ? all : []).map(p => String(p?.key || '').trim()).filter(Boolean));

                        let candidate = `${base}_copy`;
                        if (existingKeys.has(candidate)) {
                            let i = 2;
                            while (existingKeys.has(`${base}_copy${i}`)) i += 1;
                            candidate = `${base}_copy${i}`;
                        }

                        await this.api.album.post('/animation/presets', {
                            key: candidate,
                            timeline: buildTimelinePayload(),
                            graph_type: String(state.graphType || 'linear').trim() || 'linear',
                        });
                        state.name = candidate;
                        try { saveLocalBasePresetKey(candidate); } catch { }
                        try { this.updateUI?.('success', 'Cloned'); } catch { }
                        rerenderTimeline();
                        applyPreview();
                    } catch (err) {
                        showError?.(`Lỗi clone preset: ${err.message || err}`);
                    }
                });

                // Timeline interactions
                // NOTE: clicking empty timeline no longer creates keyframes.

                // Multi-select: hold + drag on empty area to box-select keyframes.
                (() => {
                    const stack = dialog.querySelector('[data-role="track-stack"]');
                    if (!stack) return;
                    if (stack.__albumSelectBound) return;
                    stack.__albumSelectBound = true;

                    // Disable native browser context menu on timeline area.
                    stack.addEventListener('contextmenu', (e) => {
                        try { e.preventDefault(); } catch { }
                    });

                    const box = document.createElement('div');
                    box.className = 'plugin-album__anim-editor-selectbox';
                    box.hidden = true;
                    try { stack.appendChild(box); } catch { }

                    let selDrag = null; // { startX, startY, lastX, lastY, pointerId, moved }

                    const intersects = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);

                    const updateBox = (clientX, clientY) => {
                        const rect = stack.getBoundingClientRect();
                        const x1 = clamp(Math.round((Number(selDrag.startX) || 0) - rect.left), 0, rect.width);
                        const y1 = clamp(Math.round((Number(selDrag.startY) || 0) - rect.top), 0, rect.height);
                        const x2 = clamp(Math.round((Number(clientX) || 0) - rect.left), 0, rect.width);
                        const y2 = clamp(Math.round((Number(clientY) || 0) - rect.top), 0, rect.height);

                        const left = Math.min(x1, x2);
                        const top = Math.min(y1, y2);
                        const w = Math.abs(x2 - x1);
                        const h = Math.abs(y2 - y1);

                        box.style.left = `${left}px`;
                        box.style.top = `${top}px`;
                        box.style.width = `${w}px`;
                        box.style.height = `${h}px`;
                    };

                    const recomputeSelection = () => {
                        const sel = getSelectedKeyIds();
                        sel.clear();

                        const boxRect = box.getBoundingClientRect();
                        dialog.querySelectorAll('.plugin-album__anim-editor-key')?.forEach((kb) => {
                            try {
                                const r = kb.getBoundingClientRect();
                                if (!intersects(boxRect, r)) return;
                                const tr = String(kb.dataset.track || '').trim();
                                const t = Math.round(Number(kb.dataset.t) || 0);
                                if (!tr) return;
                                sel.add(keyId(tr, t));
                            } catch { }
                        });

                        // Visual highlight while dragging without full rerender.
                        const selNow = new Set(sel);
                        dialog.querySelectorAll('.plugin-album__anim-editor-key')?.forEach((kb) => {
                            try {
                                const tr = String(kb.dataset.track || '').trim();
                                const t = Math.round(Number(kb.dataset.t) || 0);
                                kb.classList.toggle('is-selected', selNow.has(keyId(tr, t)));
                            } catch { }
                        });
                    };

                    stack.addEventListener('pointerdown', (e) => {
                        try {
                            // Only start selection on empty area (not on a key)
                            if (e.target?.closest?.('.plugin-album__anim-editor-key')) return;
                            if (e.target?.closest?.('.plugin-album__anim-editor-keymenu')) return;
                            if (e.button !== 0) return;

                            // Prevent browser text selection / drag behavior.
                            try { e.preventDefault(); } catch { }
                            try { e.stopPropagation(); } catch { }

                            selDrag = {
                                startX: Number(e.clientX) || 0,
                                startY: Number(e.clientY) || 0,
                                lastX: Number(e.clientX) || 0,
                                lastY: Number(e.clientY) || 0,
                                pointerId: e.pointerId,
                                moved: false,
                            };

                            try { stack.setPointerCapture(e.pointerId); } catch { }

                            // Start with box hidden; only show after we detect a drag.
                            box.hidden = true;
                            closeKeyMenu();
                        } catch { }
                    });

                    stack.addEventListener('pointermove', (e) => {
                        try {
                            if (!selDrag) return;
                            selDrag.lastX = Number(e.clientX) || 0;
                            selDrag.lastY = Number(e.clientY) || 0;
                            const dx = Math.abs((Number(e.clientX) || 0) - selDrag.startX);
                            const dy = Math.abs((Number(e.clientY) || 0) - selDrag.startY);
                            if (dx > 3 || dy > 3) selDrag.moved = true;

                            // Prevent browser selection while dragging.
                            try { e.preventDefault(); } catch { }
                            try { e.stopPropagation(); } catch { }

                            if (!selDrag.moved) return;

                            if (box.hidden) {
                                // First time we actually drag: clear selection and show box.
                                clearSelection();
                                box.hidden = false;
                                box.style.left = '0px';
                                box.style.top = '0px';
                                box.style.width = '0px';
                                box.style.height = '0px';
                                updateBox(selDrag.startX, selDrag.startY);
                            }

                            updateBox(e.clientX, e.clientY);
                            recomputeSelection();
                        } catch { }
                    });

                    const end = (e) => {
                        try {
                            if (!selDrag) return;
                            try { stack.releasePointerCapture(selDrag.pointerId); } catch { }
                            const wasMoved = !!selDrag.moved;
                            selDrag = null;
                            box.hidden = true;

                            if (!wasMoved) {
                                // Click on empty timeline clears selection (when selecting multiple)
                                if (getSelectedKeyIds().size > 1) {
                                    clearSelection();
                                    closeKeyMenu();
                                    rerenderTimeline();
                                } else {
                                    closeKeyMenu();
                                }
                                return;
                            }

                            // Keep selection after box-select
                            rerenderTimeline();
                        } catch {
                            selDrag = null;
                            try { box.hidden = true; } catch { }
                        }
                    };
                    stack.addEventListener('pointerup', end);
                    stack.addEventListener('pointercancel', end);
                })();

                // Anchor point interactions (direct position/scale editing)
                (() => {
                    const anchor = dialog.querySelector('[data-role="anchor"]');
                    if (!anchor) return;
                    if (anchor.__albumAnchorBound) return;
                    anchor.__albumAnchorBound = true;

                    const resetAllAtPlayhead = () => {
                        const t = clampMs(state.playheadMs);
                        try { history.lock = true; } catch { }
                        upsertKey('position', { t, x: 0, y: 0 });
                        upsertKey('scale', { t, s: 1 });
                        upsertKey('opacity', { t, o: 1 });
                        try { history.lock = false; } catch { }
                        try { pushHistory(); } catch { }
                        closeKeyMenu();
                        rerenderTimeline();
                        applyPreview();
                    };

                    const edgePad = 12;
                    let drag = null; // { mode, startX, startY, basePos, baseScale, pointerId }
                    let lastTap = { t: 0, x: 0, y: 0 };

                    const hitTest = (clientX, clientY) => {
                        const r = anchor.getBoundingClientRect();
                        const x = clientX - r.left;
                        const y = clientY - r.top;
                        const left = x < edgePad;
                        const right = x > (r.width - edgePad);
                        const top = y < edgePad;
                        const bottom = y > (r.height - edgePad);
                        const onEdge = left || right || top || bottom;

                        // sx/sy indicate which direction is considered "outward".
                        // - right edge: dragging right increases scale (+dx)
                        // - left edge: dragging left increases scale (-dx)
                        // - bottom edge: dragging down increases scale (+dy)
                        // - top edge: dragging up increases scale (-dy)
                        const sx = right ? 1 : (left ? -1 : 0);
                        const sy = bottom ? 1 : (top ? -1 : 0);
                        return { mode: onEdge ? 'scale' : 'move', sx, sy };
                    };

                    anchor.addEventListener('pointerdown', (e) => {
                        try {
                            e.preventDefault();
                            e.stopPropagation();

                            // Double-tap support for touch devices
                            try {
                                if (String(e.pointerType || '') === 'touch') {
                                    const now = Date.now();
                                    const dxTap = Math.abs((Number(e.clientX) || 0) - (Number(lastTap.x) || 0));
                                    const dyTap = Math.abs((Number(e.clientY) || 0) - (Number(lastTap.y) || 0));
                                    if ((now - (Number(lastTap.t) || 0)) <= 320 && dxTap <= 24 && dyTap <= 24) {
                                        const ht = hitTest(e.clientX, e.clientY);
                                        const t = clampMs(state.playheadMs);
                                        if (ht.mode === 'scale') {
                                            upsertKey('scale', { t, s: 1 });
                                        } else {
                                            upsertKey('position', { t, x: 0, y: 0 });
                                        }
                                        closeKeyMenu();
                                        rerenderTimeline();
                                        applyPreview();
                                        lastTap = { t: 0, x: 0, y: 0 };
                                        return;
                                    }
                                    lastTap = { t: now, x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 };
                                }
                            } catch { }

                            if (state.isPlaying) {
                                state.isPlaying = false;
                                try { cancelAnimationFrame(state._playRaf); } catch { }
                                state._playRaf = 0;
                                try { if (layerChar) layerChar.style.animationPlayState = 'paused'; } catch { }
                                setPlayingUi();
                            }
                            const mode = hitTest(e.clientX, e.clientY);
                            drag = {
                                mode: mode.mode,
                                sx: mode.sx,
                                sy: mode.sy,
                                startX: Number(e.clientX) || 0,
                                startY: Number(e.clientY) || 0,
                                basePos: evalAt('position', state.playheadMs),
                                baseScale: evalAt('scale', state.playheadMs),
                                pointerId: e.pointerId,
                            };
                            // Avoid pushing history on every pointermove; commit once on pointerup.
                            try { history.lock = true; } catch { }
                            try { anchor.setPointerCapture(e.pointerId); } catch { }
                        } catch { }
                    });

                    anchor.addEventListener('pointermove', (e) => {
                        try {
                            if (!drag) return;
                            const dx = (Number(e.clientX) || 0) - drag.startX;
                            const dy = (Number(e.clientY) || 0) - drag.startY;
                            const t = clampMs(state.playheadMs);

                            if (drag.mode === 'move') {
                                const nx = Number(drag.basePos.x || 0) + dx;
                                const ny = Number(drag.basePos.y || 0) + dy;
                                upsertKey('position', { t, x: nx, y: ny });
                            } else {
                                const r = anchor.getBoundingClientRect();
                                const base = Math.max(80, Math.max(r.width, r.height));
                                let d = 0;
                                if (Number(drag.sx) !== 0) d += (Number(drag.sx) * dx);
                                if (Number(drag.sy) !== 0) d += (Number(drag.sy) * dy);
                                if (Number(drag.sx) !== 0 && Number(drag.sy) !== 0) d = d / 2;
                                const delta = d / base;
                                const factor = clamp(1 + delta, 0.05, 20);
                                const ns = Math.max(0.01, Number(drag.baseScale.s ?? 1) * factor);
                                upsertKey('scale', { t, s: ns });
                            }

                            closeKeyMenu();
                            scheduleUiUpdate({ preview: true, timeline: true });
                        } catch { }
                    });

                    const end = (e) => {
                        try {
                            if (!drag) return;
                            try { anchor.releasePointerCapture(drag.pointerId); } catch { }
                            drag = null;
                            try { history.lock = false; } catch { }
                            try { pushHistory(); } catch { }
                        } catch { drag = null; }
                    };
                    anchor.addEventListener('pointerup', end);
                    anchor.addEventListener('pointercancel', end);

                    anchor.addEventListener('dblclick', (e) => {
                        try {
                            e.preventDefault();
                            e.stopPropagation();
                            const ht = hitTest(e.clientX, e.clientY);
                            const t = clampMs(state.playheadMs);
                            if (ht.mode === 'scale') {
                                upsertKey('scale', { t, s: 1 });
                            } else {
                                upsertKey('position', { t, x: 0, y: 0 });
                            }
                            closeKeyMenu();
                            rerenderTimeline();
                            applyPreview();
                        } catch { }
                    });

                    // Opacity slider (vertical) sits on the right of anchor overlay.
                    (() => {
                        const slider = dialog.querySelector('[data-role="opacity-slider"]');
                        if (!slider) return;
                        if (slider.__albumOpacityBound) return;
                        slider.__albumOpacityBound = true;

                        const stopPlayback = () => {
                            try {
                                if (!state.isPlaying) return;
                                state.isPlaying = false;
                                try { cancelAnimationFrame(state._playRaf); } catch { }
                                state._playRaf = 0;
                                try { if (layerChar) layerChar.style.animationPlayState = 'paused'; } catch { }
                                setPlayingUi();
                            } catch { }
                        };

                        slider.addEventListener('pointerdown', (e) => {
                            try {
                                e.stopPropagation();
                                slider.__albumDragging = true;
                                try { history.lock = true; } catch { }
                                stopPlayback();
                            } catch { }
                        });
                        slider.addEventListener('pointerup', () => {
                            try { slider.__albumDragging = false; } catch { }
                            try { history.lock = false; } catch { }
                            try { pushHistory(); } catch { }
                        });
                        slider.addEventListener('pointercancel', () => {
                            try { slider.__albumDragging = false; } catch { }
                            try { history.lock = false; } catch { }
                            try { pushHistory(); } catch { }
                        });

                        slider.addEventListener('input', (e) => {
                            try {
                                e.stopPropagation();
                                stopPlayback();
                                const t = clampMs(state.playheadMs);
                                const v = clamp(Number(slider.value), 0, 1);
                                upsertKey('opacity', { t, o: v });
                                closeKeyMenu();
                                scheduleUiUpdate({ preview: true, timeline: true });
                            } catch { }
                        });
                    })();

                    // Double tap/click outside anchor overlay => reset Position/Scale/Opacity and set keys.
                    (() => {
                        const main = dialog.querySelector('.plugin-album__anim-editor-main');
                        if (!main) return;
                        if (main.__albumOutsideResetBound) return;
                        main.__albumOutsideResetBound = true;

                        let lastOutsideTap = { t: 0, x: 0, y: 0 };
                        const isInsideAnchorUi = (target) => {
                            try {
                                if (!target) return false;
                                if (anchor.contains(target)) return true;
                                return false;
                            } catch {
                                return false;
                            }
                        };

                        main.addEventListener('dblclick', (e) => {
                            try {
                                if (isInsideAnchorUi(e.target)) return;
                                e.preventDefault();
                                e.stopPropagation();
                                resetAllAtPlayhead();
                            } catch { }
                        });

                        main.addEventListener('pointerdown', (e) => {
                            try {
                                if (String(e.pointerType || '') !== 'touch') return;
                                if (isInsideAnchorUi(e.target)) return;
                                const now = Date.now();
                                const dxTap = Math.abs((Number(e.clientX) || 0) - (Number(lastOutsideTap.x) || 0));
                                const dyTap = Math.abs((Number(e.clientY) || 0) - (Number(lastOutsideTap.y) || 0));
                                if ((now - (Number(lastOutsideTap.t) || 0)) <= 320 && dxTap <= 24 && dyTap <= 24) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    resetAllAtPlayhead();
                                    lastOutsideTap = { t: 0, x: 0, y: 0 };
                                    return;
                                }
                                lastOutsideTap = { t: now, x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 };
                            } catch { }
                        });
                    })();
                })();

                // Initial load: always load the auto-preset when entering the editor.
                // If missing, start fresh and create it best-effort.
                try {
                    await fetchAllPresets();
                    const base = normalizeBasePresetKey(loadLocalBasePresetKey()) || 'Default';
                    state.name = base;

                    const autoKey = getAutoPresetKey();
                    const foundAuto = findPresetByKey(autoKey);
                    if (foundAuto) {
                        applyPresetToEditorState(foundAuto);
                    } else {
                        state.durationMs = 500;
                        state.graphType = 'ease-in-out';
                        state.loop = true;
                        state.playheadMs = 0;
                        state.tracks = { position: [], scale: [], opacity: [] };
                        state.selected = null;
                        try { doAutoSave(); } catch { }
                    }
                } catch { }

                rerenderTimeline();
                applyPreview();
                setPlayheadMs(state.playheadMs, { seek: true });

                // Seed history AFTER initial render (session-only)
                try {
                    history.undo = [snapshotEditorState()];
                    history.redo = [];
                    history.lock = false;
                    this._updateNav?.();
                } catch { }

                // Ctrl+Z / Ctrl+Y
                try {
                    const keyHandler = (e) => {
                        try {
                            if (!e) return;
                            const target = e.target;
                            const tag = String(target?.tagName || '').toLowerCase();
                            if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

                            const isMac = /Mac|iPhone|iPad|iPod/.test(String(navigator?.platform || ''));
                            const mod = isMac ? !!e.metaKey : !!e.ctrlKey;
                            if (!mod) return;
                            const key = String(e.key || '').toLowerCase();

                            if (key === 'z' && !e.shiftKey) {
                                e.preventDefault();
                                doUndo();
                                return;
                            }
                            if (key === 'y' || (key === 'z' && !!e.shiftKey)) {
                                e.preventDefault();
                                doRedo();
                                return;
                            }
                        } catch { }
                    };
                    document.addEventListener('keydown', keyHandler, { capture: true });
                    state._keyHandler = keyHandler;
                } catch { }

                // Keep ruler/gridlines aligned on resize
                try {
                    const onResize = () => { try { rerenderRuler(); } catch { } };
                    window.addEventListener('resize', onResize);
                } catch { }
            } catch (err) {
                console.warn('[Album] _characterOpenAnimationEditorPage error:', err);
            }
        },

        // Backward compat: keep the old method name but open as page.
        async _characterOpenAnimationEditorModal() {
            try { return await this._characterOpenAnimationEditorPage(); } catch { }
        },
    });
})();
