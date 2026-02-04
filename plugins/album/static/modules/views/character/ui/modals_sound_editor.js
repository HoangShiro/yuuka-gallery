// Album plugin - Character view (Page: Sound editor)
// - Edit an uploaded sound: trim via selection, seek with needle, preview, then save (overwrite) or save_as (new).

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

    const getAuthHeader = () => {
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            if (token) return { Authorization: `Bearer ${token}` };
        } catch { }
        return {};
    };

    const withAuthTokenQuery = (url) => {
        try {
            const u0 = String(url || '').trim();
            if (!u0) return '';
            const token = String(localStorage.getItem('yuuka-auth-token') || '').trim();
            if (!token) return u0;

            const u = new URL(u0, window.location.origin);
            if (!u.searchParams.get('token')) u.searchParams.set('token', token);
            return u.toString();
        } catch {
            return String(url || '').trim();
        }
    };

    const normalizeId = (value) => String(value || '').trim();

    const guessNameNoExt = (label) => {
        const s = String(label || '').trim();
        if (!s) return '';
        return s.replace(/\.(wav|mp3|ogg)$/i, '').trim();
    };

    const requestCreatePresetFromBlob = async ({ blob, name }) => {
        const url = `${window.location.origin}/api/plugin/album/sound_fx/presets`;
        const form = new FormData();
        const safeName = String(name || '').trim();
        const filename = `${safeName || 'Sound'}.wav`;
        form.append('file', new File([blob], filename, { type: 'audio/wav' }));
        if (safeName) form.append('name', safeName);

        const res = await fetch(url, {
            method: 'POST',
            headers: { ...getAuthHeader() },
            body: form,
        });

        if (!res.ok) {
            let msg = `HTTP error ${res.status}`;
            try {
                const data = await res.json();
                msg = data?.description || data?.message || msg;
            } catch { }
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }

        return await res.json();
    };

    const requestOverwritePresetFromBlob = async ({ presetId, blob, name }) => {
        const pid = normalizeId(presetId);
        if (!pid) throw new Error('Missing presetId');

        const url = `${window.location.origin}/api/plugin/album/sound_fx/presets/${encodeURIComponent(pid)}`;
        const form = new FormData();
        const safeName = String(name || '').trim();
        const filename = `${safeName || 'Sound'}.wav`;
        form.append('file', new File([blob], filename, { type: 'audio/wav' }));
        if (safeName) form.append('name', safeName);

        const res = await fetch(url, {
            method: 'PUT',
            headers: { ...getAuthHeader() },
            body: form,
        });

        if (!res.ok) {
            let msg = `HTTP error ${res.status}`;
            try {
                const data = await res.json();
                msg = data?.description || data?.message || msg;
            } catch { }
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }

        return await res.json();
    };

    const fetchAudioAsArrayBuffer = async (url) => {
        const u = withAuthTokenQuery(url);
        if (!u) throw new Error('Missing sound url');
        const res = await fetch(u);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return await res.arrayBuffer();
    };

    const createAudioContext = () => {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        return new Ctx();
    };

    const sliceAudioBuffer = (buffer, startS, endS) => {
        const b = buffer;
        const sr = b.sampleRate;
        const start = clamp(Math.floor(startS * sr), 0, b.length);
        const end = clamp(Math.floor(endS * sr), 0, b.length);
        const len = Math.max(0, end - start);

        // Create a new AudioBuffer
        const ctx = createAudioContext();
        if (!ctx) throw new Error('AudioContext is not supported');
        const out = ctx.createBuffer(b.numberOfChannels, Math.max(1, len), sr);
        for (let ch = 0; ch < b.numberOfChannels; ch += 1) {
            const src = b.getChannelData(ch);
            const dst = out.getChannelData(ch);
            dst.set(src.subarray(start, end));
        }
        try { ctx.close(); } catch { }
        return out;
    };

    const applyEdgeFade = (buffer, fadeMs, { fadeIn = false, fadeOut = false } = {}) => {
        const b = buffer;
        const sr = b.sampleRate;
        const fadeSamples = Math.max(0, Math.round((Number(fadeMs || 0) / 1000) * sr));
        if (fadeSamples <= 0) return;

        const n = b.length;
        const fin = fadeIn ? Math.min(fadeSamples, n) : 0;
        const fout = fadeOut ? Math.min(fadeSamples, n) : 0;

        for (let ch = 0; ch < b.numberOfChannels; ch += 1) {
            const data = b.getChannelData(ch);

            if (fin > 0) {
                for (let i = 0; i < fin; i += 1) {
                    const g = i / Math.max(1, fin - 1);
                    data[i] *= g;
                }
            }

            if (fout > 0) {
                for (let i = 0; i < fout; i += 1) {
                    const idx = (n - 1) - i;
                    if (idx < 0) break;
                    const g = i / Math.max(1, fout - 1);
                    // Ramp down towards the end: last sample reaches 0.
                    data[idx] *= g;
                }
            }
        }
    };

    const encodeWav16 = (audioBuffer) => {
        // PCM 16-bit little endian WAV
        const b = audioBuffer;
        const numCh = b.numberOfChannels;
        const sr = b.sampleRate;
        const numFrames = b.length;

        const bytesPerSample = 2;
        const blockAlign = numCh * bytesPerSample;
        const byteRate = sr * blockAlign;
        const dataSize = numFrames * blockAlign;

        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        const writeStr = (offset, s) => {
            for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
        };

        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');

        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true); // PCM
        view.setUint16(20, 1, true); // format
        view.setUint16(22, numCh, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true); // bits

        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);

        // interleave
        const channels = [];
        for (let ch = 0; ch < numCh; ch += 1) channels.push(b.getChannelData(ch));

        let o = 44;
        for (let i = 0; i < numFrames; i += 1) {
            for (let ch = 0; ch < numCh; ch += 1) {
                const s = clamp(channels[ch][i], -1, 1);
                const v = s < 0 ? (s * 0x8000) : (s * 0x7FFF);
                view.setInt16(o, Math.round(v), true);
                o += 2;
            }
        }

        return new Blob([buffer], { type: 'audio/wav' });
    };

    const serializeAudioBuffer = (audioBuffer) => {
        const b = audioBuffer;
        if (!b) return null;
        const numCh = b.numberOfChannels;
        const channels = [];
        for (let ch = 0; ch < numCh; ch += 1) {
            const src = b.getChannelData(ch);
            channels.push(new Float32Array(src));
        }
        return {
            sampleRate: Number(b.sampleRate) || 44100,
            numberOfChannels: Number(numCh) || 1,
            length: Number(b.length) || 0,
            channels,
        };
    };

    const deserializeAudioBuffer = (ctx, serialized) => {
        if (!ctx) throw new Error('AudioContext is not supported');
        const s = serialized;
        if (!s || typeof s !== 'object') return null;
        const sr = Math.max(1, Math.round(Number(s.sampleRate) || 44100));
        const numCh = Math.max(1, Math.round(Number(s.numberOfChannels) || 1));
        const len = Math.max(1, Math.round(Number(s.length) || 1));
        const out = ctx.createBuffer(numCh, len, sr);
        for (let ch = 0; ch < numCh; ch += 1) {
            const dst = out.getChannelData(ch);
            const src = (Array.isArray(s.channels) ? s.channels[ch] : null);
            if (src && src.length) dst.set(src.subarray(0, Math.min(dst.length, src.length)));
        }
        return out;
    };

    const _getCssVar = (varName, fallback) => {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
            const s = String(v || '').trim();
            return s || fallback;
        } catch {
            return fallback;
        }
    };

    const drawWaveform = (canvas, audioBuffer, { startS = 0, endS = null } = {}) => {
        const c = canvas;
        const ctx = c.getContext('2d');
        if (!ctx) return;

        // We draw in CSS pixels; canvas is scaled by DPR.
        const dpr = Number(c.dataset?.dpr || 1) || 1;
        const w = Math.max(1, Math.floor(c.width / dpr));
        const h = Math.max(1, Math.floor(c.height / dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const colorCardBg = _getCssVar('--color-card-bg', '#000');
        const colorText = _getCssVar('--color-text', '#fff');
        const colorSecondary = _getCssVar('--color-secondary-text', '#999');

        // background
        ctx.globalAlpha = 1;
        ctx.fillStyle = colorCardBg;
        ctx.fillRect(0, 0, w, h);

        if (!audioBuffer) return;

        const b = audioBuffer;
        const sr = b.sampleRate;
        const dur = b.duration || (b.length / sr);
        const s0 = clamp(Number(startS || 0), 0, dur);
        const s1 = (endS === null || endS === undefined) ? dur : clamp(Number(endS || 0), 0, dur);
        const a0 = Math.floor(s0 * sr);
        const a1 = Math.max(a0 + 1, Math.floor(s1 * sr));

        const data = b.getChannelData(0);
        const span = Math.max(1, a1 - a0);
        const step = Math.max(1, Math.floor(span / w));

        // waveform color
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = colorText;
        ctx.lineWidth = 1;
        ctx.beginPath();

        const mid = Math.floor(h / 2);
        for (let x = 0; x < w; x += 1) {
            const idx0 = a0 + (x * step);
            const idx1 = Math.min(a1, idx0 + step);
            let min = 1;
            let max = -1;
            for (let i = idx0; i < idx1; i += 1) {
                const v = data[i] || 0;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const y1 = mid - (max * (h * 0.45));
            const y2 = mid - (min * (h * 0.45));
            ctx.moveTo(x + 0.5, y1);
            ctx.lineTo(x + 0.5, y2);
        }

        ctx.stroke();

        // center line
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = colorSecondary;
        ctx.beginPath();
        ctx.moveTo(0, mid + 0.5);
        ctx.lineTo(w, mid + 0.5);
        ctx.stroke();

        ctx.globalAlpha = 1;
    };

    Object.assign(proto, {
        async _characterOpenSoundEditorPage(presetOrId) {
            try {
                if (this.state?.viewMode !== 'character') return;

                const pid = normalizeId((presetOrId && typeof presetOrId === 'object') ? presetOrId.id : presetOrId);
                const isEmptyEditor = !pid;

                // Resolve preset (skip when opening empty editor)
                let preset = null;
                if (!isEmptyEditor) {
                    try {
                        if (presetOrId && typeof presetOrId === 'object') {
                            preset = presetOrId;
                        } else {
                            const all = await this.api.album.get('/sound_fx/presets');
                            const arr = Array.isArray(all) ? all : [];
                            preset = arr.find(p => normalizeId(p?.id) === pid) || null;
                        }
                    } catch { }
                }

                const name = String(preset?.name || '').trim() || (isEmptyEditor ? '' : 'Sound');
                const urlRaw = isEmptyEditor
                    ? ''
                    : String(preset?.url || '').trim();
                const url = urlRaw ? withAuthTokenQuery(urlRaw) : '';

                // Preserve a small UI state
                try {
                    if (!this.state.character) this.state.character = {};
                    this.state.character._soundEditor = {
                        isOpen: true,
                        presetId: pid,
                        returnTo: 'sound-manager',
                    };
                } catch { }

                const currentRoot = this.contentArea?.querySelector('.plugin-album__character-view');
                const prevClassName = String(currentRoot?.className || 'plugin-album__character-view');
                const viewClass = prevClassName.includes('plugin-album__character-view')
                    ? prevClassName
                    : 'plugin-album__character-view';

                this.contentArea.innerHTML = `
                    <div class="${viewClass} plugin-album__character-view--sound-editor">
                        <div class="plugin-album__soundedit-overlay" aria-label="Sound editor overlay">
                            <div class="plugin-album__soundedit-header" aria-label="Sound editor header">
                                <div class="plugin-album__soundedit-title">Sound editor</div>

                                <button type="button" class="plugin-album__soundedit-iconbtn" data-action="save" title="Save (overwrite)">
                                    <span class="material-symbols-outlined">save</span>
                                </button>
                                <button type="button" class="plugin-album__soundedit-iconbtn" data-action="save-as" title="Save as (new)">
                                    <span class="material-symbols-outlined">save_as</span>
                                </button>

                                <input class="plugin-album__soundedit-name" data-role="name" value="${escapeText(name)}" aria-label="Sound name" />

                                <div class="plugin-album__soundedit-spacer"></div>

                                <button type="button" class="plugin-album__soundedit-close" data-action="close" title="Back to Sound manager">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div class="plugin-album__soundedit-toolbar" aria-label="Editor toolbar">
                                <button type="button" class="plugin-album__soundedit-iconbtn" data-action="play" title="Play">
                                    <span class="material-symbols-outlined">play_arrow</span>
                                </button>

                                <div class="plugin-album__soundedit-field">
                                    <div class="plugin-album__soundedit-field-label">Fade in (ms)</div>
                                    <input class="plugin-album__soundedit-field-input" data-role="fade-in" type="number" min="0" step="1" value="50" />
                                </div>

                                <div class="plugin-album__soundedit-field">
                                    <div class="plugin-album__soundedit-field-label">Fade out (ms)</div>
                                    <input class="plugin-album__soundedit-field-input" data-role="fade-out" type="number" min="0" step="1" value="100" />
                                </div>
                            </div>

                            <div class="plugin-album__soundedit-zoom" aria-label="Timeline zoom">
                                <div class="plugin-album__soundedit-zoom-track" data-role="zoom-track" aria-label="Zoom range">
                                    <div class="plugin-album__soundedit-zoom-selection" data-role="zoom-selection" aria-hidden="true"></div>
                                    <div class="plugin-album__soundedit-zoom-needle" data-role="zoom-needle" aria-hidden="true"></div>
                                    <input class="plugin-album__soundedit-zoom-range" data-role="zoom-start" type="range" min="0" max="1000" step="1" value="0" aria-label="Zoom start" />
                                    <input class="plugin-album__soundedit-zoom-range" data-role="zoom-end" type="range" min="0" max="1000" step="1" value="1000" aria-label="Zoom end" />
                                </div>
                            </div>

                            <div class="plugin-album__soundedit-timeline" data-role="timeline" aria-label="Timeline">
                                <canvas class="plugin-album__soundedit-wave" data-role="wave"></canvas>
                                <div class="plugin-album__soundedit-selection" data-role="selection">
                                    <div class="plugin-album__soundedit-selmeta" aria-hidden="true">
                                        <span class="plugin-album__soundedit-selmeta-start" data-role="ms-start"></span>
                                        <span class="plugin-album__soundedit-selmeta-total" data-role="ms-total"></span>
                                        <span class="plugin-album__soundedit-selmeta-end" data-role="ms-end"></span>
                                    </div>
                                    <div class="plugin-album__soundedit-handle plugin-album__soundedit-handle--left" data-role="handle-left" aria-label="Trim start"></div>
                                    <div class="plugin-album__soundedit-handle plugin-album__soundedit-handle--right" data-role="handle-right" aria-label="Trim end"></div>
                                </div>
                                <div class="plugin-album__soundedit-needle" data-role="needle" aria-label="Needle"></div>
                            </div>

                            <div class="plugin-album__soundedit-hint" aria-label="Hint">
                                Drag the handles to trim. Drag the needle to seek.
                            </div>
                        </div>
                    </div>
                `;

                const root = this.contentArea.querySelector('.plugin-album__character-view--sound-editor');
                if (!root) return;

                // Notify navibar to update context buttons
                try { this._updateNav?.(); } catch { }

                const timelineEl = root.querySelector('[data-role="timeline"]');
                const canvas = root.querySelector('[data-role="wave"]');
                const zoomTrackEl = root.querySelector('[data-role="zoom-track"]');
                const zoomStartEl = root.querySelector('[data-role="zoom-start"]');
                const zoomEndEl = root.querySelector('[data-role="zoom-end"]');
                const selectionEl = root.querySelector('[data-role="selection"]');
                const msStartEl = root.querySelector('[data-role="ms-start"]');
                const msTotalEl = root.querySelector('[data-role="ms-total"]');
                const msEndEl = root.querySelector('[data-role="ms-end"]');
                const handleL = root.querySelector('[data-role="handle-left"]');
                const handleR = root.querySelector('[data-role="handle-right"]');
                const needleEl = root.querySelector('[data-role="needle"]');
                const fadeInEl = root.querySelector('[data-role="fade-in"]');
                const fadeOutEl = root.querySelector('[data-role="fade-out"]');
                const nameEl = root.querySelector('[data-role="name"]');

                const state = {
                    presetId: pid,
                    url,
                    name,
                    audioCtx: null,
                    audioBuffer: null,
                    audioRev: 0,
                    // seconds
                    selStart: 0,
                    selEnd: 0,
                    needle: 0,
                    // viewport (seconds)
                    viewStart: 0,
                    viewEnd: 0,
                    dragging: null, // 'left' | 'right' | 'needle'
                    zoomDrag: null,
                    play: {
                        src: null,
                        gain: null,
                        startedAt: 0,
                        offset: 0,
                        endAt: 0,
                        timer: 0,
                        raf: 0,
                        playing: false,
                    },
                };

                // --- History (Undo/Redo) ---
                const history = {
                    undo: [],
                    redo: [],
                    limit: 100,
                    lock: true, // locked until initial state is seeded
                };
                const audioPool = new Map(); // audioRev => serialized buffer

                const storeAudioRev = () => {
                    try {
                        if (!state.audioBuffer) return;
                        const rev = Number(state.audioRev) || 0;
                        if (audioPool.has(rev)) return;
                        audioPool.set(rev, serializeAudioBuffer(state.audioBuffer));
                    } catch { }
                };

                const pruneAudioPool = () => {
                    try {
                        const keep = new Set();
                        (Array.isArray(history.undo) ? history.undo : []).forEach(s => keep.add(Number(s?.audioRev) || 0));
                        (Array.isArray(history.redo) ? history.redo : []).forEach(s => keep.add(Number(s?.audioRev) || 0));
                        [...audioPool.keys()].forEach((k) => { if (!keep.has(Number(k))) audioPool.delete(k); });
                    } catch { }
                };

                const snapshotEditorState = () => {
                    const toMs = (sec) => Math.max(0, Math.round(Number(sec || 0) * 1000));
                    const name = String(nameEl?.value || state.name || '').trim();
                    const fadeInMs = Math.max(0, Math.round(Number(fadeInEl?.value || 0)));
                    const fadeOutMs = Math.max(0, Math.round(Number(fadeOutEl?.value || 0)));
                    const snap = {
                        audioRev: Number(state.audioRev) || 0,
                        name,
                        fadeInMs,
                        fadeOutMs,
                        selStartMs: toMs(state.selStart),
                        selEndMs: toMs(state.selEnd),
                        needleMs: toMs(state.needle),
                        viewStartMs: toMs(state.viewStart),
                        viewEndMs: toMs(state.viewEnd),
                    };
                    // Do not include seek/zoom in history identity.
                    // Needle + viewport are kept for restoration, but should not create a new history step.
                    snap._k = `${snap.audioRev}:${snap.selStartMs}:${snap.selEndMs}:${snap.fadeInMs}:${snap.fadeOutMs}:${snap.name}`;
                    return snap;
                };

                const canUndo = () => (Array.isArray(history.undo) ? history.undo.length : 0) > 1;
                const canRedo = () => (Array.isArray(history.redo) ? history.redo.length : 0) > 0;

                let historyDebounceTimer = 0;
                const scheduleHistory = (ms = 220) => {
                    try {
                        if (history.lock) return;
                        if (historyDebounceTimer) clearTimeout(historyDebounceTimer);
                        historyDebounceTimer = setTimeout(() => {
                            historyDebounceTimer = 0;
                            try { pushHistory(); } catch { }
                        }, Math.max(0, Math.round(Number(ms) || 0)));
                    } catch { }
                };

                const pushHistory = () => {
                    try {
                        if (history.lock) return;
                        const snap = snapshotEditorState();
                        const u = Array.isArray(history.undo) ? history.undo : [];
                        const last = u.length ? u[u.length - 1] : null;
                        if (last && String(last._k || '') === String(snap._k || '')) return;

                        u.push(snap);
                        while (u.length > (Number(history.limit) || 100)) u.shift();
                        history.undo = u;
                        history.redo = [];
                        pruneAudioPool();
                        try { this._updateNav?.(); } catch { }
                    } catch { }
                };

                const restoreEditorState = (snap) => {
                    try {
                        if (!snap || typeof snap !== 'object') return;
                        history.lock = true;
                        stopPlayback({ manual: true });

                        const ctx = state.audioCtx || createAudioContext();
                        if (!ctx) throw new Error('AudioContext is not supported');
                        state.audioCtx = ctx;

                        const rev = Number(snap.audioRev) || 0;
                        if (Number(state.audioRev) !== rev) {
                            const ser = audioPool.get(rev) || null;
                            const decoded = ser ? deserializeAudioBuffer(ctx, ser) : null;
                            if (decoded) {
                                state.audioBuffer = decoded;
                                state.audioRev = rev;
                            }
                        }

                        const dur = Math.max(0, state.audioBuffer?.duration || 0);
                        const fromMs = (ms) => clamp((Number(ms) || 0) / 1000, 0, dur);
                        state.selStart = fromMs(snap.selStartMs);
                        state.selEnd = fromMs(snap.selEndMs);
                        state.needle = fromMs(snap.needleMs);
                        state.viewStart = fromMs(snap.viewStartMs);
                        state.viewEnd = fromMs(snap.viewEndMs);

                        const nextName = String(snap.name || '').trim();
                        if (nameEl && nextName) nameEl.value = nextName;
                        state.name = nextName || state.name;

                        try { if (fadeInEl) fadeInEl.value = String(Math.max(0, Math.round(Number(snap.fadeInMs || 0)))); } catch { }
                        try { if (fadeOutEl) fadeOutEl.value = String(Math.max(0, Math.round(Number(snap.fadeOutMs || 0)))); } catch { }

                        redraw();
                        try { this._updateNav?.(); } catch { }
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

                // Expose for navibar tool buttons (reuse animation editor hook names)
                try {
                    this._albumAnimEditorUndo = doUndo;
                    this._albumAnimEditorRedo = doRedo;
                    this._albumAnimEditorCanUndo = canUndo;
                    this._albumAnimEditorCanRedo = canRedo;
                } catch { }

                const cleanup = {
                    keydown: null,
                    keyUndo: null,
                    wheel: null,
                    closeMenu: null,
                };

                const showError = (msg) => {
                    try {
                        if (typeof Yuuka?.ui?.toast === 'function') return Yuuka.ui.toast(msg);
                    } catch { }
                    try { console.warn('[Album][SoundEditor]', msg); } catch { }
                };

                const closeToManager = () => {
                    try {
                        stopPlayback();
                    } catch { }

                    try {
                        if (cleanup.keydown) window.removeEventListener('keydown', cleanup.keydown, true);
                    } catch { }
                    try {
                        if (cleanup.keyUndo) document.removeEventListener('keydown', cleanup.keyUndo, true);
                    } catch { }
                    try {
                        if (cleanup.wheel && timelineEl) timelineEl.removeEventListener('wheel', cleanup.wheel, { capture: true });
                    } catch { }
                    try {
                        cleanup.closeMenu?.();
                    } catch { }

                    // Cleanup navibar hooks
                    try {
                        this._albumAnimEditorUndo = null;
                        this._albumAnimEditorRedo = null;
                        this._albumAnimEditorCanUndo = null;
                        this._albumAnimEditorCanRedo = null;
                    } catch { }
                    try { this._updateNav?.(); } catch { }

                    try {
                        this._characterOpenSoundManagerPage?.();
                    } catch {
                        try { this._characterRender?.(); } catch { }
                    }
                };

                root.querySelector('[data-action="close"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeToManager();
                });

                const ensureCanvasSize = () => {
                    if (!timelineEl || !canvas) return;
                    const rect = timelineEl.getBoundingClientRect();
                    const cssW = Math.max(1, Math.floor(rect.width));
                    const cssH = Math.max(1, Math.floor(rect.height));
                    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.max(1, window.devicePixelRatio) : 1;
                    const pxW = Math.max(1, Math.floor(cssW * dpr));
                    const pxH = Math.max(1, Math.floor(cssH * dpr));
                    canvas.dataset.dpr = String(dpr);
                    if (canvas.width !== pxW || canvas.height !== pxH) {
                        canvas.width = pxW;
                        canvas.height = pxH;
                    }
                };

                const getViewBounds = () => {
                    if (!state.audioBuffer) return { v0: 0, v1: 0, span: 0, total: 0 };
                    const total = Math.max(0, state.audioBuffer.duration || 0);
                    const eps = 0.001;
                    let v0 = clamp(Number(state.viewStart || 0), 0, total);
                    let v1 = clamp(Number(state.viewEnd || 0), 0, total);
                    if ((v1 - v0) < eps) {
                        v0 = 0;
                        v1 = total;
                    }
                    if (v1 < v0) {
                        const t = v0;
                        v0 = v1;
                        v1 = t;
                    }
                    const span = Math.max(eps, v1 - v0);
                    return { v0, v1, span, total };
                };

                const updateZoomUI = () => {
                    try {
                        if (!zoomStartEl || !zoomEndEl || !zoomTrackEl || !state.audioBuffer) return;
                        const { v0, v1, total } = getViewBounds();
                        if (total <= 0.001) return;

                        const p0 = clamp(Math.round((v0 / total) * 1000), 0, 1000);
                        const p1 = clamp(Math.round((v1 / total) * 1000), 0, 1000);
                        zoomStartEl.value = String(Math.min(p0, p1));
                        zoomEndEl.value = String(Math.max(p0, p1));

                        const a = clamp((Math.min(p0, p1) / 1000) * 100, 0, 100);
                        const b = clamp((Math.max(p0, p1) / 1000) * 100, 0, 100);
                        zoomTrackEl.style.setProperty('--zoom-start', `${a}%`);
                        zoomTrackEl.style.setProperty('--zoom-end', `${b}%`);

                        // Show trim bounds and needle on zoom slider (absolute vs full duration)
                        const dur = total;
                        const s0 = clamp(Math.min(state.selStart, state.selEnd), 0, dur);
                        const s1 = clamp(Math.max(state.selStart, state.selEnd), 0, dur);
                        zoomTrackEl.style.setProperty('--sel-start', `${clamp((s0 / dur) * 100, 0, 100)}%`);
                        zoomTrackEl.style.setProperty('--sel-end', `${clamp((s1 / dur) * 100, 0, 100)}%`);

                        const nt = clamp(Number(state.needle || 0), 0, dur);
                        zoomTrackEl.style.setProperty('--needle-x', `${clamp((nt / dur) * 100, 0, 100)}%`);
                    } catch { }
                };

                const ensureTimeInView = (t, { paddingRatio = 0.1 } = {}) => {
                    if (!state.audioBuffer) return false;
                    const total = Math.max(0, state.audioBuffer.duration || 0);
                    if (total <= 0.001) return false;

                    const { v0, v1, span } = getViewBounds();
                    const tt = clamp(Number(t || 0), 0, total);
                    const pad = clamp(span * Number(paddingRatio || 0), 0, Math.max(0, span - 0.001));

                    let next0 = v0;
                    let next1 = v1;

                    if (tt < (v0 + pad)) {
                        next0 = tt - pad;
                        next1 = next0 + span;
                    } else if (tt > (v1 - pad)) {
                        next1 = tt + pad;
                        next0 = next1 - span;
                    } else {
                        return false;
                    }

                    if (next0 < 0) {
                        next1 -= next0;
                        next0 = 0;
                    }
                    if (next1 > total) {
                        const overflow = next1 - total;
                        next0 = Math.max(0, next0 - overflow);
                        next1 = total;
                    }

                    const changed = (Math.abs(next0 - state.viewStart) > 0.0005) || (Math.abs(next1 - state.viewEnd) > 0.0005);
                    if (!changed) return false;
                    state.viewStart = clamp(next0, 0, total);
                    state.viewEnd = clamp(next1, 0, total);
                    redraw();
                    return true;
                };

                const timeToX = (t) => {
                    if (!timelineEl || !state.audioBuffer) return 0;
                    const { v0, span } = getViewBounds();
                    const rect = timelineEl.getBoundingClientRect();
                    const r = clamp((t - v0) / Math.max(0.001, span), 0, 1);
                    return r * rect.width;
                };

                const xToTime = (x) => {
                    if (!timelineEl || !state.audioBuffer) return 0;
                    const { v0, span } = getViewBounds();
                    const rect = timelineEl.getBoundingClientRect();
                    const r = clamp(x / Math.max(1, rect.width), 0, 1);
                    return v0 + (r * span);
                };

                const syncOverlay = () => {
                    if (!timelineEl || !selectionEl || !needleEl || !state.audioBuffer) return;
                    const rect = timelineEl.getBoundingClientRect();
                    const { v0, span, total } = getViewBounds();
                    const dur = Math.max(0.001, total || 0.001);

                    const s0 = clamp(state.selStart, 0, dur);
                    const s1 = clamp(state.selEnd, 0, dur);
                    const a0 = Math.min(s0, s1);
                    const a1 = Math.max(s0, s1);
                    const left = clamp(((a0 - v0) / span) * rect.width, 0, rect.width);
                    const right = clamp(((a1 - v0) / span) * rect.width, 0, rect.width);

                    selectionEl.style.left = `${left}px`;
                    selectionEl.style.width = `${Math.max(0, right - left)}px`;

                    // Selection labels (ms)
                    try {
                        const ms0 = Math.max(0, Math.round(a0 * 1000));
                        const ms1 = Math.max(0, Math.round(a1 * 1000));
                        const msTotal = Math.max(0, ms1 - ms0);
                        if (msStartEl) msStartEl.textContent = `${ms0}ms`;
                        if (msTotalEl) msTotalEl.textContent = `${msTotal}ms`;
                        if (msEndEl) msEndEl.textContent = `${ms1}ms`;
                    } catch { }

                    const nx = clamp(((clamp(state.needle, 0, dur) - v0) / span) * rect.width, 0, rect.width);
                    needleEl.style.left = `${nx}px`;

                    // Keep zoom slider overlays in sync without forcing waveform redraw
                    updateZoomUI();
                };

                const redraw = () => {
                    try {
                        ensureCanvasSize();
                        const { v0, v1 } = getViewBounds();
                        drawWaveform(canvas, state.audioBuffer, { startS: v0, endS: v1 });
                        syncOverlay();
                        updateZoomUI();
                    } catch { }
                };

                const decodeArrayBufferToAudioBuffer = async (ctx, arr) => {
                    const ab = arr instanceof ArrayBuffer ? arr : null;
                    if (!ab) throw new Error('Invalid audio data');
                    return await new Promise((resolve, reject) => {
                        try {
                            ctx.decodeAudioData(ab.slice(0), resolve, reject);
                        } catch (e) {
                            reject(e);
                        }
                    });
                };

                const loadDecodedAudioBuffer = (decoded, { autoName = '' } = {}) => {
                    if (!decoded) return;
                    stopPlayback();
                    state.audioBuffer = decoded;
                    state.audioRev = (Number(state.audioRev) || 0) + 1;
                    try { storeAudioRev(); } catch { }
                    const dur = decoded.duration || 0;
                    state.selStart = 0;
                    state.selEnd = dur;
                    state.needle = 0;
                    state.viewStart = 0;
                    state.viewEnd = dur;

                    // Optional: prefill name from file if current name is empty.
                    try {
                        const cur = String(nameEl?.value || '').trim();
                        const next = String(autoName || '').trim();
                        if (nameEl && !cur && next) nameEl.value = next;
                    } catch { }

                    redraw();
                };

                const applyZoomPercent = ({ startP, endP } = {}) => {
                    if (!state.audioBuffer) return;
                    const total = Math.max(0, state.audioBuffer.duration || 0);
                    if (total <= 0.001) return;

                    const minSpanS = Math.min(total, Math.max(0.05, total * 0.01));
                    const minSpanP = Math.max(1, Math.round((minSpanS / total) * 1000));

                    let p0 = clamp(Math.round(Number(startP)), 0, 1000);
                    let p1 = clamp(Math.round(Number(endP)), 0, 1000);
                    if (p1 < p0) {
                        const t = p0;
                        p0 = p1;
                        p1 = t;
                    }
                    if ((p1 - p0) < minSpanP) {
                        p1 = clamp(p0 + minSpanP, 0, 1000);
                        p0 = clamp(p1 - minSpanP, 0, 1000);
                    }

                    state.viewStart = (p0 / 1000) * total;
                    state.viewEnd = (p1 / 1000) * total;
                    redraw();
                };

                const bindZoomSlider = () => {
                    if (!zoomStartEl || !zoomEndEl) return;

                    const onZoomInput = () => {
                        const p0 = Number(zoomStartEl.value || 0);
                        const p1 = Number(zoomEndEl.value || 1000);
                        applyZoomPercent({ startP: p0, endP: p1 });
                    };

                    zoomStartEl.addEventListener('input', onZoomInput);
                    zoomEndEl.addEventListener('input', onZoomInput);
                };

                const bindZoomTrackPan = () => {
                    if (!zoomTrackEl || !zoomStartEl || !zoomEndEl) return;

                    const pointerToP = (evt) => {
                        const rect = zoomTrackEl.getBoundingClientRect();
                        const x = clamp(evt.clientX - rect.left, 0, rect.width);
                        return clamp(Math.round((x / Math.max(1, rect.width)) * 1000), 0, 1000);
                    };

                    const onPanMove = (evt) => {
                        try {
                            if (!state.zoomDrag || state.zoomDrag.kind !== 'pan') return;
                            evt.preventDefault();
                            const p = pointerToP(evt);
                            const delta = p - state.zoomDrag.startPointerP;
                            const spanP = state.zoomDrag.spanP;

                            let next0 = state.zoomDrag.startP0 + delta;
                            let next1 = next0 + spanP;

                            if (next0 < 0) {
                                next0 = 0;
                                next1 = spanP;
                            }
                            if (next1 > 1000) {
                                next1 = 1000;
                                next0 = 1000 - spanP;
                            }

                            applyZoomPercent({ startP: next0, endP: next1 });
                        } catch { }
                    };

                    const onPanUp = () => {
                        if (!state.zoomDrag) return;
                        state.zoomDrag = null;
                        try { window.removeEventListener('pointermove', onPanMove, true); } catch { }
                        try { window.removeEventListener('pointerup', onPanUp, true); } catch { }
                    };

                    zoomTrackEl.addEventListener('pointerdown', (evt) => {
                        try {
                            if (!state.audioBuffer) return;
                            // Allow native thumb dragging when starting on an input.
                            const onThumb = evt.target?.closest?.('[data-role="zoom-start"], [data-role="zoom-end"]');
                            if (onThumb) return;

                            evt.preventDefault();
                            evt.stopPropagation();

                            const p0 = Number(zoomStartEl.value || 0);
                            const p1 = Number(zoomEndEl.value || 1000);
                            const a = Math.min(p0, p1);
                            const b = Math.max(p0, p1);
                            const spanP = Math.max(1, b - a);

                            state.zoomDrag = {
                                kind: 'pan',
                                startPointerP: pointerToP(evt),
                                startP0: a,
                                spanP,
                            };

                            try { window.addEventListener('pointermove', onPanMove, true); } catch { }
                            try { window.addEventListener('pointerup', onPanUp, true); } catch { }
                        } catch { }
                    });
                };

                const stopPlayback = ({ manual = false } = {}) => {
                    try {
                        if (state.play.raf) {
                            cancelAnimationFrame(state.play.raf);
                            state.play.raf = 0;
                        }
                    } catch { }
                    try {
                        if (state.play.timer) {
                            clearTimeout(state.play.timer);
                            state.play.timer = 0;
                        }
                    } catch { }

                    try {
                        if (state.play.src) {
                            // If user manually stops (seek/trim), don't run onended logic that may move the needle.
                            if (manual) {
                                try { state.play.src.onended = null; } catch { }
                            }
                            try { state.play.src.stop(0); } catch { }
                            try { state.play.src.disconnect(); } catch { }
                        }
                    } catch { }

                    try {
                        if (state.play.gain) {
                            try { state.play.gain.disconnect(); } catch { }
                        }
                    } catch { }

                    state.play.src = null;
                    state.play.gain = null;
                    state.play.startedAt = 0;
                    state.play.offset = 0;
                    state.play.endAt = 0;
                    state.play.playing = false;

                    // Reset play icon
                    try {
                        const icon = root.querySelector('[data-action="play"] .material-symbols-outlined');
                        if (icon) icon.textContent = 'play_arrow';
                    } catch { }
                };

                const tickNeedleWhilePlaying = () => {
                    try {
                        if (!state.play.playing || !state.audioCtx || !state.audioBuffer) return;
                        const ctx = state.audioCtx;
                        const now = ctx.currentTime;
                        const t = state.play.offset + Math.max(0, now - state.play.startedAt);
                        state.needle = clamp(t, 0, Math.max(0, state.play.endAt || 0));
                        // Follow the needle: if it exits viewport, pan viewport.
                        if (!ensureTimeInView(state.needle, { paddingRatio: 0.14 })) {
                            syncOverlay();
                        }
                        state.play.raf = requestAnimationFrame(tickNeedleWhilePlaying);
                    } catch {
                        try { stopPlayback(); } catch { }
                    }
                };

                const getPlaybackSegment = () => {
                    if (!state.audioBuffer) return null;
                    const total = Math.max(0, state.audioBuffer.duration || 0);
                    if (total <= 0.001) return null;

                    const eps = 0.0008;
                    const s0 = clamp(Math.min(state.selStart, state.selEnd), 0, total);
                    const s1 = clamp(Math.max(state.selStart, state.selEnd), 0, total);
                    const needle = clamp(state.needle, 0, total);

                    const atTimelineEnd = (needle >= (total - eps));
                    const atSelectionEnd = (needle >= (s1 - eps) && needle <= (s1 + eps));

                    let startAt = needle;
                    let endAt = s1;

                    // Rule 1: Replay at end of selection or end of timeline.
                    if (atTimelineEnd) {
                        startAt = 0;
                        endAt = total;
                    } else if (atSelectionEnd) {
                        startAt = s0;
                        endAt = s1;
                    } else {
                        // Rule 2: If needle outside selection, decide end bound.
                        if (needle < (s0 - eps)) endAt = s1;
                        else if (needle > (s1 + eps)) endAt = total;
                        else endAt = s1;
                    }

                    startAt = clamp(startAt, 0, total);
                    endAt = clamp(endAt, 0, total);
                    if ((endAt - startAt) <= 0.001) return null;

                    return { startAt, endAt, s0, s1, total, eps };
                };

                const startPlayback = () => {
                    if (!state.audioBuffer) return;
                    const seg = getPlaybackSegment();
                    if (!seg) return;

                    const fadeInMs = Math.max(0, Math.round(Number(fadeInEl?.value || 0)));
                    const fadeOutMs = Math.max(0, Math.round(Number(fadeOutEl?.value || 0)));

                    const { startAt, endAt, s0, s1, total, eps } = seg;
                    const dur = Math.max(0, endAt - startAt);
                    if (dur <= 0.001) return;

                    stopPlayback({ manual: true });

                    const ctx = state.audioCtx || createAudioContext();
                    if (!ctx) return;
                    state.audioCtx = ctx;

                    try { ctx.resume?.(); } catch { }

                    const src = ctx.createBufferSource();
                    src.buffer = state.audioBuffer;
                    const gain = ctx.createGain();
                    gain.gain.value = 1;
                    src.connect(gain);
                    gain.connect(ctx.destination);

                    const now = ctx.currentTime;
                    const fadeInS = fadeInMs / 1000;
                    const fadeOutS = fadeOutMs / 1000;

                    // Preview fades only when trimming (avoid always fading full-length playback).
                    const shouldFadeIn = (s0 > 0.0005) && (Math.abs(startAt - s0) <= (eps * 2));
                    const shouldFadeOut = (s1 < (total - 0.0005)) && (Math.abs(endAt - s1) <= (eps * 2));

                    if (shouldFadeIn && fadeInS > 0.0005) {
                        gain.gain.setValueAtTime(0, now);
                        gain.gain.linearRampToValueAtTime(1, now + Math.min(fadeInS, dur));
                    }
                    if (shouldFadeOut && fadeOutS > 0.0005) {
                        const endTime = now + dur;
                        const fadeStart = Math.max(now, endTime - Math.min(fadeOutS, dur));
                        gain.gain.setValueAtTime(1, fadeStart);
                        gain.gain.linearRampToValueAtTime(0, endTime);
                    }

                    state.play.src = src;
                    state.play.gain = gain;
                    state.play.startedAt = now;
                    state.play.offset = startAt;
                    state.play.endAt = endAt;
                    state.play.playing = true;

                    try {
                        const icon = root.querySelector('[data-action="play"] .material-symbols-outlined');
                        if (icon) icon.textContent = 'stop';
                    } catch { }

                    try {
                        src.start(0, startAt, dur);
                    } catch {
                        stopPlayback();
                        return;
                    }

                    try {
                        state.play.raf = requestAnimationFrame(tickNeedleWhilePlaying);
                    } catch { }

                    src.onended = () => {
                        try {
                            // Natural end: move needle to end of played segment so replay rules work.
                            state.needle = endAt;
                            syncOverlay();
                        } catch { }
                        stopPlayback({ manual: false });
                    };

                    // safety stop timer
                    try {
                        state.play.timer = setTimeout(() => {
                            try {
                                // Only act if still playing; treat as natural end.
                                if (state.play.playing) {
                                    try { state.needle = endAt; syncOverlay(); } catch { }
                                    stopPlayback({ manual: false });
                                }
                            } catch { }
                        }, Math.max(50, Math.round(dur * 1000) + 150));
                    } catch { }
                };

                root.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (state.play.playing) stopPlayback({ manual: true });
                    else startPlayback();
                });

                const setNeedle = (t, { stop = true } = {}) => {
                    if (!state.audioBuffer) return;
                    const dur = state.audioBuffer.duration || 0;
                    state.needle = clamp(t, 0, dur);
                    if (stop) stopPlayback({ manual: true });
                    // Follow seek: if needle exits viewport, pan viewport.
                    if (!ensureTimeInView(state.needle, { paddingRatio: 0.1 })) {
                        syncOverlay();
                    }
                };

                const setSelectionLeft = (t) => {
                    if (!state.audioBuffer) return;
                    const dur = state.audioBuffer.duration || 0;
                    const next = clamp(t, 0, dur);
                    state.selStart = next;
                    // keep inside
                    state.needle = clamp(state.needle, Math.min(state.selStart, state.selEnd), Math.max(state.selStart, state.selEnd));
                    stopPlayback({ manual: true });
                    syncOverlay();
                    try { scheduleHistory(160); } catch { }
                };

                const setSelectionRight = (t) => {
                    if (!state.audioBuffer) return;
                    const dur = state.audioBuffer.duration || 0;
                    const next = clamp(t, 0, dur);
                    state.selEnd = next;
                    state.needle = clamp(state.needle, Math.min(state.selStart, state.selEnd), Math.max(state.selStart, state.selEnd));
                    stopPlayback({ manual: true });
                    syncOverlay();
                    try { scheduleHistory(160); } catch { }
                };

                // --- Context menu (Remove) ---
                let menuEl = null;
                let menuPointerDownHandler = null;
                const closeMenu = () => {
                    try {
                        if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
                    } catch { }
                    menuEl = null;
                    try {
                        if (menuPointerDownHandler) window.removeEventListener('pointerdown', menuPointerDownHandler, true);
                    } catch { }
                    menuPointerDownHandler = null;
                    try { window.removeEventListener('keydown', onMenuKeyDown, true); } catch { }
                };

                const onMenuKeyDown = (e) => {
                    try {
                        if (e?.key === 'Escape') {
                            e.preventDefault();
                            closeMenu();
                        }
                    } catch { }
                };

                const openMenuAt = ({ clientX, clientY } = {}) => {
                    try {
                        closeMenu();
                        menuEl = document.createElement('div');
                        menuEl.className = 'plugin-album__soundedit-menu';
                        menuEl.setAttribute('role', 'menu');

                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'plugin-album__soundedit-menuitem';
                        btn.textContent = 'Remove';
                        btn.addEventListener('click', async (ev) => {
                            try {
                                ev.preventDefault();
                                ev.stopPropagation();
                                closeMenu();
                                await doRemoveSelection();
                            } catch { }
                        });
                        menuEl.appendChild(btn);

                        menuEl.style.left = `${Math.max(0, Math.round(Number(clientX) || 0))}px`;
                        menuEl.style.top = `${Math.max(0, Math.round(Number(clientY) || 0))}px`;
                        document.body.appendChild(menuEl);

                        // clamp in viewport after paint
                        requestAnimationFrame(() => {
                            try {
                                if (!menuEl) return;
                                const r = menuEl.getBoundingClientRect();
                                let x = r.left;
                                let y = r.top;
                                const pad = 6;
                                if (r.right > (window.innerWidth - pad)) x = Math.max(pad, window.innerWidth - pad - r.width);
                                if (r.bottom > (window.innerHeight - pad)) y = Math.max(pad, window.innerHeight - pad - r.height);
                                menuEl.style.left = `${Math.round(x)}px`;
                                menuEl.style.top = `${Math.round(y)}px`;
                            } catch { }
                        });

                        // Close on outside click only (keep clicks inside menu working)
                        menuPointerDownHandler = (e) => {
                            try {
                                if (!menuEl) return;
                                if (e?.target && menuEl.contains(e.target)) return;
                            } catch { }
                            closeMenu();
                        };
                        try { window.addEventListener('pointerdown', menuPointerDownHandler, true); } catch { }
                        try { window.addEventListener('keydown', onMenuKeyDown, true); } catch { }
                    } catch { }
                };

                cleanup.closeMenu = closeMenu;

                const isPointerInsideSelection = (evt) => {
                    try {
                        if (!state.audioBuffer || !timelineEl) return false;
                        const rect = timelineEl.getBoundingClientRect();
                        const x = clamp((Number(evt.clientX) || 0) - rect.left, 0, rect.width);
                        const t = xToTime(x);
                        const s0 = Math.min(state.selStart, state.selEnd);
                        const s1 = Math.max(state.selStart, state.selEnd);
                        const eps = 0.0005;
                        return t >= (s0 + eps) && t <= (s1 - eps);
                    } catch {
                        return false;
                    }
                };

                const doRemoveSelection = async () => {
                    try {
                        if (!state.audioBuffer) {
                            showError('No audio loaded.');
                            return;
                        }
                        stopPlayback({ manual: true });

                        const b = state.audioBuffer;
                        const sr = b.sampleRate;
                        const dur = b.duration || 0;
                        const s0 = clamp(Math.min(state.selStart, state.selEnd), 0, dur);
                        const s1 = clamp(Math.max(state.selStart, state.selEnd), 0, dur);
                        if ((s1 - s0) <= 0.001) {
                            showError('Trim range too small.');
                            return;
                        }

                        const start = clamp(Math.floor(s0 * sr), 0, b.length);
                        const end = clamp(Math.floor(s1 * sr), 0, b.length);
                        const leftLen = Math.max(0, start);
                        const rightLen = Math.max(0, b.length - end);
                        if (leftLen + rightLen <= 1) {
                            showError('Remove would make empty audio.');
                            return;
                        }

                        const fadeInMs = Math.max(0, Math.round(Number(fadeInEl?.value || 0)));
                        const fadeOutMs = Math.max(0, Math.round(Number(fadeOutEl?.value || 0)));
                        const fadeInSamples = Math.max(0, Math.round((fadeInMs / 1000) * sr));
                        const fadeOutSamples = Math.max(0, Math.round((fadeOutMs / 1000) * sr));
                        const overlap = Math.min(leftLen, rightLen, Math.max(fadeInSamples, fadeOutSamples));

                        const outLen = Math.max(1, (leftLen + rightLen - overlap));
                        const ctx = state.audioCtx || createAudioContext();
                        if (!ctx) throw new Error('AudioContext is not supported');
                        state.audioCtx = ctx;
                        try { ctx.resume?.(); } catch { }

                        const out = ctx.createBuffer(b.numberOfChannels, outLen, sr);
                        const leftKeep = Math.max(0, leftLen - overlap);
                        const rightStart = end;

                        for (let ch = 0; ch < b.numberOfChannels; ch += 1) {
                            const src = b.getChannelData(ch);
                            const dst = out.getChannelData(ch);

                            // left part (excluding overlapped tail)
                            if (leftKeep > 0) {
                                dst.set(src.subarray(0, leftKeep), 0);
                            }

                            // crossfade overlap
                            for (let i = 0; i < overlap; i += 1) {
                                const a = src[leftKeep + i] || 0;
                                const b2 = src[rightStart + i] || 0;
                                const gl = (fadeOutSamples <= 1) ? 0 : clamp(1 - (i / Math.max(1, fadeOutSamples - 1)), 0, 1);
                                const gr = (fadeInSamples <= 1) ? 1 : clamp(i / Math.max(1, fadeInSamples - 1), 0, 1);
                                dst[leftKeep + i] = clamp((a * gl) + (b2 * gr), -1, 1);
                            }

                            // remaining right part after overlap
                            const rightRemain = Math.max(0, rightLen - overlap);
                            if (rightRemain > 0) {
                                const srcStart = rightStart + overlap;
                                const dstStart = leftKeep + overlap;
                                dst.set(src.subarray(srcStart, srcStart + rightRemain), dstStart);
                            }
                        }

                        state.audioBuffer = out;
                        state.audioRev = (Number(state.audioRev) || 0) + 1;
                        try { storeAudioRev(); } catch { }

                        const newDur = out.duration || (out.length / sr);
                        state.selStart = 0;
                        state.selEnd = newDur;
                        const joinTime = leftKeep / sr;
                        state.needle = clamp(joinTime, 0, newDur);
                        state.viewStart = 0;
                        state.viewEnd = newDur;

                        redraw();
                        try { pushHistory(); } catch { }
                        showError('Removed.');
                    } catch (err) {
                        showError(`Remove failed: ${err?.message || err}`);
                    }
                };

                const pointerToLocalX = (evt) => {
                    const rect = timelineEl.getBoundingClientRect();
                    return clamp(evt.clientX - rect.left, 0, rect.width);
                };

                const onPointerMove = (evt) => {
                    if (!state.dragging) return;
                    evt.preventDefault();
                    const x = pointerToLocalX(evt);
                    const t = xToTime(x);
                    if (state.dragging === 'left') setSelectionLeft(t);
                    else if (state.dragging === 'right') setSelectionRight(t);
                    else if (state.dragging === 'needle') setNeedle(t);
                };

                const onPointerUp = () => {
                    if (!state.dragging) return;
                    state.dragging = null;
                    try { window.removeEventListener('pointermove', onPointerMove, true); } catch { }
                    try { window.removeEventListener('pointerup', onPointerUp, true); } catch { }
                    try {
                        history.lock = false;
                        pushHistory();
                    } catch { }
                };

                const bindDrag = (el, kind) => {
                    el?.addEventListener('pointerdown', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        try { history.lock = true; } catch { }
                        state.dragging = kind;
                        try { el.setPointerCapture?.(evt.pointerId); } catch { }
                        try { window.addEventListener('pointermove', onPointerMove, true); } catch { }
                        try { window.addEventListener('pointerup', onPointerUp, true); } catch { }
                    });
                };

                bindDrag(handleL, 'left');
                bindDrag(handleR, 'right');
                bindDrag(needleEl, 'needle');

                // Click/drag on timeline background to move needle
                // Long-press (0.5s) inside selection opens the action menu.
                (() => {
                    let press = null; // { timer, startX, startY, moved, pointerId }
                    const clearPress = () => {
                        if (!press) return;
                        try { if (press.timer) clearTimeout(press.timer); } catch { }
                        press = null;
                    };

                    const cancelNeedleDrag = () => {
                        try {
                            if (state.dragging === 'needle') state.dragging = null;
                            try { window.removeEventListener('pointermove', onPointerMove, true); } catch { }
                            try { window.removeEventListener('pointerup', onPointerUp, true); } catch { }
                            try {
                                history.lock = false;
                            } catch { }
                        } catch { }
                    };

                    timelineEl?.addEventListener('pointerdown', (evt) => {
                        const isHandle = evt.target?.closest?.('[data-role="handle-left"], [data-role="handle-right"], [data-role="needle"]');
                        if (isHandle) return;

                        const insideSel = isPointerInsideSelection(evt);
                        evt.preventDefault();
                        evt.stopPropagation();
                        const x = pointerToLocalX(evt);
                        // While playing, stop immediately and move needle to clicked position (do not jump to segment start).
                        if (state.play.playing) {
                            try { stopPlayback({ manual: true }); } catch { }
                            setNeedle(xToTime(x), { stop: false });
                        } else {
                            setNeedle(xToTime(x));
                        }

                        try { history.lock = true; } catch { }
                        state.dragging = 'needle';
                        try { window.addEventListener('pointermove', onPointerMove, true); } catch { }
                        try { window.addEventListener('pointerup', onPointerUp, true); } catch { }

                        // Long-press menu: only arm it when pointer starts inside selection.
                        if (insideSel) {
                            clearPress();
                            press = {
                                timer: 0,
                                startX: Number(evt.clientX) || 0,
                                startY: Number(evt.clientY) || 0,
                                moved: false,
                                pointerId: evt.pointerId,
                            };
                            try {
                                press.timer = setTimeout(() => {
                                    try {
                                        if (!press || press.moved) return;
                                        // Stop dragging, show menu at initial pointer position.
                                        cancelNeedleDrag();
                                        openMenuAt({ clientX: press.startX, clientY: press.startY });
                                    } catch { }
                                    finally {
                                        clearPress();
                                    }
                                }, 500);
                            } catch { }

                            const onMove = (e2) => {
                                try {
                                    if (!press) return;
                                    const dx = Math.abs((Number(e2.clientX) || 0) - (Number(press.startX) || 0));
                                    const dy = Math.abs((Number(e2.clientY) || 0) - (Number(press.startY) || 0));
                                    if (dx > 6 || dy > 6) {
                                        press.moved = true;
                                        clearPress();
                                    }
                                } catch { }
                            };
                            const onUp = () => {
                                try { clearPress(); } catch { }
                                try { window.removeEventListener('pointermove', onMove, true); } catch { }
                                try { window.removeEventListener('pointerup', onUp, true); } catch { }
                            };
                            try { window.addEventListener('pointermove', onMove, true); } catch { }
                            try { window.addEventListener('pointerup', onUp, true); } catch { }
                        }
                    });
                })();

                // Right-click inside selection opens menu
                timelineEl?.addEventListener('contextmenu', (evt) => {
                    try {
                        if (!isPointerInsideSelection(evt)) return;
                        evt.preventDefault();
                        evt.stopPropagation();
                        openMenuAt({ clientX: evt.clientX, clientY: evt.clientY });
                    } catch { }
                });

                // Mouse wheel zoom at pointer position
                cleanup.wheel = (evt) => {
                    try {
                        if (!state.audioBuffer || !timelineEl) return;
                        evt.preventDefault();
                        evt.stopPropagation();

                        const total = Math.max(0, state.audioBuffer.duration || 0);
                        if (total <= 0.001) return;

                        const rect = timelineEl.getBoundingClientRect();
                        const x = clamp(evt.clientX - rect.left, 0, rect.width);
                        const pointerTime = xToTime(x);

                        const { v0, v1, span } = getViewBounds();
                        const curSpan = Math.max(0.001, span);
                        const ratio = clamp((pointerTime - v0) / curSpan, 0, 1);

                        const minSpanS = Math.min(total, Math.max(0.05, total * 0.01));
                        const zoomIntensity = 0.0018;
                        const k = Math.exp(Number(evt.deltaY || 0) * zoomIntensity);
                        const nextSpan = clamp(curSpan * k, minSpanS, total);

                        let nextStart = pointerTime - (ratio * nextSpan);
                        let nextEnd = nextStart + nextSpan;

                        if (nextStart < 0) {
                            nextEnd -= nextStart;
                            nextStart = 0;
                        }
                        if (nextEnd > total) {
                            const overflow = nextEnd - total;
                            nextStart = Math.max(0, nextStart - overflow);
                            nextEnd = total;
                        }

                        state.viewStart = clamp(nextStart, 0, total);
                        state.viewEnd = clamp(nextEnd, 0, total);
                        redraw();
                    } catch { }
                };

                try {
                    if (timelineEl) timelineEl.addEventListener('wheel', cleanup.wheel, { passive: false, capture: true });
                } catch { }

                // Space key always toggles play/stop (and no longer triggers focused button)
                cleanup.keydown = (evt) => {
                    try {
                        if (!root?.isConnected) return;
                        if (evt.code !== 'Space') return;

                        // Allow typing spaces inside inputs/textareas/contenteditable fields.
                        const target = evt.target;
                        const tag = String(target?.tagName || '').toLowerCase();
                        const isFormField = (tag === 'input' || tag === 'textarea' || tag === 'select');
                        const isEditable = Boolean(target?.isContentEditable);
                        if (isFormField || isEditable) return;

                        evt.preventDefault();
                        evt.stopPropagation();
                        if (state.play.playing) stopPlayback({ manual: true });
                        else startPlayback();
                    } catch { }
                };

                try {
                    window.addEventListener('keydown', cleanup.keydown, true);
                } catch { }

                // Ctrl+Z / Ctrl+Y like animation editor
                try {
                    const keyHandler = (e) => {
                        try {
                            if (!e) return;
                            if (!root?.isConnected) return;
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
                    cleanup.keyUndo = keyHandler;
                } catch { }

                // History: toolbar field changes (name/fade)
                try {
                    const onFieldChange = () => {
                        try { scheduleHistory(260); } catch { }
                    };
                    nameEl?.addEventListener('change', onFieldChange);
                    fadeInEl?.addEventListener('change', onFieldChange);
                    fadeOutEl?.addEventListener('change', onFieldChange);
                } catch { }

                // Drag & drop a sound file onto the timeline to load it temporarily.
                const getDroppedAudioFile = (dt) => {
                    try {
                        const files = dt?.files;
                        if (!files || !files.length) return null;
                        const f = files[0];
                        const type = String(f?.type || '');
                        const name = String(f?.name || '');
                        const okByType = type.startsWith('audio/');
                        const okByExt = /\.(wav|mp3|ogg|m4a|flac)$/i.test(name);
                        return (okByType || okByExt) ? f : null;
                    } catch {
                        return null;
                    }
                };

                const preventDragDefaults = (e) => {
                    try { e.preventDefault(); } catch { }
                    try { e.stopPropagation(); } catch { }
                };

                timelineEl?.addEventListener('dragenter', (e) => {
                    preventDragDefaults(e);
                });

                timelineEl?.addEventListener('dragover', (e) => {
                    preventDragDefaults(e);
                    try {
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    } catch { }
                });

                timelineEl?.addEventListener('drop', async (e) => {
                    preventDragDefaults(e);
                    try {
                        const f = getDroppedAudioFile(e.dataTransfer);
                        if (!f) {
                            showError('Unsupported file. Please drop an audio file.');
                            return;
                        }

                        const ctx = state.audioCtx || createAudioContext();
                        if (!ctx) throw new Error('AudioContext is not supported');
                        state.audioCtx = ctx;
                        try { ctx.resume?.(); } catch { }

                        const arr = await f.arrayBuffer();
                        const decoded = await decodeArrayBufferToAudioBuffer(ctx, arr);
                        const autoName = guessNameNoExt(f.name);
                        loadDecodedAudioBuffer(decoded, { autoName });
                        showError('Loaded (temporary). Press Save/Save as to persist.');
                    } catch (err) {
                        showError(`Load failed: ${err?.message || err}`);
                    }
                });

                const buildEditedBlob = async () => {
                    if (!state.audioBuffer) throw new Error('No audio loaded');
                    const b = state.audioBuffer;
                    const dur = b.duration || 0;
                    const s0 = clamp(Math.min(state.selStart, state.selEnd), 0, dur);
                    const s1 = clamp(Math.max(state.selStart, state.selEnd), 0, dur);
                    if (s1 - s0 <= 0.001) throw new Error('Trim range too small');

                    const fadeInMs = Math.max(0, Math.round(Number(fadeInEl?.value || 0)));
                    const fadeOutMs = Math.max(0, Math.round(Number(fadeOutEl?.value || 0)));

                    const out = sliceAudioBuffer(b, s0, s1);
                    const cutLeft = (s0 > 0.0005);
                    const cutRight = (s1 < (dur - 0.0005));
                    if (cutLeft) applyEdgeFade(out, fadeInMs, { fadeIn: true, fadeOut: false });
                    if (cutRight) applyEdgeFade(out, fadeOutMs, { fadeIn: false, fadeOut: true });
                    return encodeWav16(out);
                };

                const doSaveOverwrite = async () => {
                    try {
                        stopPlayback();
                        if (!normalizeId(state.presetId)) {
                            showError('No preset to overwrite. Use Save as.');
                            return;
                        }
                        const blob = await buildEditedBlob();
                        // Keep current name for overwrite.
                        const safeName = String(nameEl?.value || state.name || 'Sound').trim() || 'Sound';
                        const updated = await requestOverwritePresetFromBlob({ presetId: state.presetId, blob, name: safeName });
                        state.name = String(updated?.name || safeName).trim() || safeName;
                        if (nameEl) nameEl.value = state.name;
                        showError('Saved.');
                    } catch (err) {
                        showError(`Save failed: ${err?.message || err}`);
                    }
                };

                const doSaveAsNew = async () => {
                    try {
                        stopPlayback();
                        const nextName = String(nameEl?.value || '').trim();
                        if (!nextName) {
                            showError('Name cannot be empty.');
                            return;
                        }
                        const blob = await buildEditedBlob();
                        const created = await requestCreatePresetFromBlob({ blob, name: nextName });
                        // Switch editor to the new preset
                        state.presetId = normalizeId(created?.id);
                        state.name = String(created?.name || nextName).trim() || nextName;
                        if (nameEl) nameEl.value = state.name;
                        showError('Saved as new.');
                    } catch (err) {
                        showError(`Save as failed: ${err?.message || err}`);
                    }
                };

                root.querySelector('[data-action="save"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    doSaveOverwrite();
                });

                root.querySelector('[data-action="save-as"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    doSaveAsNew();
                });

                // Load and decode
                try {
                    // Ensure layout is ready before sizing the canvas.
                    await new Promise((r) => requestAnimationFrame(() => r()));
                    ensureCanvasSize();
                    bindZoomSlider();
                    bindZoomTrackPan();
                    if (!isEmptyEditor && url) {
                        const arr = await fetchAudioAsArrayBuffer(url);
                        const ctx = createAudioContext();
                        if (!ctx) throw new Error('AudioContext is not supported');
                        state.audioCtx = ctx;

                        const decoded = await new Promise((resolve, reject) => {
                            try {
                                // decodeAudioData callback form for wider support
                                ctx.decodeAudioData(arr.slice(0), resolve, reject);
                            } catch (e) {
                                reject(e);
                            }
                        });

                        loadDecodedAudioBuffer(decoded);
                    } else {
                        // Empty editor: draw background and wait for drag/drop.
                        redraw();
                    }

                    // Seed history AFTER initial render
                    try {
                        storeAudioRev();
                        history.undo = [snapshotEditorState()];
                        history.redo = [];
                        history.lock = false;
                        this._updateNav?.();
                    } catch { }

                    // Resize observer to redraw waveform
                    try {
                        const ro = new ResizeObserver(() => {
                            try { redraw(); } catch { }
                        });
                        ro.observe(timelineEl);
                    } catch {
                        // fallback
                        try {
                            window.addEventListener('resize', () => { try { redraw(); } catch { } });
                        } catch { }
                    }
                } catch (err) {
                    showError(`Load failed: ${err?.message || err}`);
                }
            } catch (err) {
                console.warn('[Album] _characterOpenSoundEditorPage error:', err);
            }
        },
    });
})();
