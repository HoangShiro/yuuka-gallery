// Album plugin - Core module: CSS Animation Engine
// - Apply animation to any element on: position (translate), scale, opacity
// - Each property has its own key track; engine merges tracks into CSS keyframes
// - Supports seamless change + optional seamless loop
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    const toNumber = (v, fallback = NaN) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const readTimeMs = (obj) => {
        if (!obj || typeof obj !== 'object') return NaN;
        return toNumber(obj.t_ms ?? obj.tMs ?? obj.t ?? obj.time_ms ?? obj.timeMs ?? obj.time, NaN);
    };

    const uniqSorted = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);

    const isNonEmptyArray = (v) => Array.isArray(v) && v.length > 0;

    const getOrCreateStyleHost = () => {
        const id = 'plugin-album__animation-engine-style';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('style');
            el.id = id;
            el.type = 'text/css';
            document.head.appendChild(el);
        }
        return el;
    };

    class AlbumCssAnimationEngine {
        constructor({ api } = {}) {
            this.api = api;
            this._elementState = new WeakMap();
            this._rulesByName = new Map();
            this._styleEl = null;

            // Small cache to avoid refetching /animation/presets for tight loops (playlist playback).
            this._allPresetsCache = null;
            this._allPresetsFetchedAt = 0;
        }

        _ensureStyleEl() {
            if (!this._styleEl) this._styleEl = getOrCreateStyleHost();
            return this._styleEl;
        }

        _flushRules() {
            const el = this._ensureStyleEl();
            el.textContent = Array.from(this._rulesByName.values()).join('\n');
        }

        async _fetchAllPresets() {
            if (!this.api || typeof this.api.get !== 'function') return [];
            try {
                const now = Date.now();
                if (Array.isArray(this._allPresetsCache) && (now - (this._allPresetsFetchedAt || 0)) < 5000) {
                    return this._allPresetsCache;
                }
                const all = await this.api.get('/animation/presets');
                const list = Array.isArray(all) ? all : [];
                this._allPresetsCache = list;
                this._allPresetsFetchedAt = now;
                return list;
            } catch {
                return [];
            }
        }

        async loadPresetByKey(key) {
            const k = String(key || '').trim();
            if (!k) return null;

            const all = await this._fetchAllPresets();
            const found = all.find(p => String(p?.key || '').trim() === k) || null;
            if (!found) return null;

            return {
                key: String(found.key || '').trim(),
                graphType: String(found.graph_type || found.graphType || 'linear').trim() || 'linear',
                timeline: (found.timeline && (Array.isArray(found.timeline) || typeof found.timeline === 'object')) ? found.timeline : [],
            };
        }

        getPresetDurationMs(preset) {
            try {
                const parsed = this._parseTimeline(preset?.timeline, { graphType: preset?.graphType });
                const d = Number(parsed?.durationMs ?? 0);
                return Number.isFinite(d) && d > 0 ? Math.round(d) : 1000;
            } catch {
                return 1000;
            }
        }

        async getPresetDurationMsByKey(key) {
            try {
                const preset = await this.loadPresetByKey(key);
                if (!preset) return null;
                return this.getPresetDurationMs(preset);
            } catch {
                return null;
            }
        }

        _readTrackValuesAt({ durationMs, positionKeys, scaleKeys, opacityKeys }, tMs) {
            const duration = Math.max(1, Math.round(Number(durationMs || 1000)));
            const t = clamp(Math.round(Number(tMs || 0)), 0, duration);

            const posKeys = this._ensureEndpoints(positionKeys, duration, { x: 0, y: 0 });
            const scKeys = this._ensureEndpoints(scaleKeys, duration, { s: 1 });
            const opKeys = this._ensureEndpoints(opacityKeys, duration, { o: 1 });

            const pos = posKeys.length ? this._valueAt(posKeys, t, ['x', 'y']) : null;
            const sc = scKeys.length ? this._valueAt(scKeys, t, ['s']) : null;
            const op = opKeys.length ? this._valueAt(opKeys, t, ['o']) : null;

            return {
                tMs: t,
                x: toNumber(pos?.x ?? 0, 0),
                y: toNumber(pos?.y ?? 0, 0),
                s: Math.max(0, toNumber(sc?.s ?? 1, 1)),
                o: clamp(toNumber(op?.o ?? 1, 1), 0, 1),
            };
        }

        getCurrentTrackValues(el) {
            try {
                const st = this._elementState.get(el);
                if (!st) return { tMs: 0, x: 0, y: 0, s: 1, o: 1 };

                const nowPerf = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const phaseMs = this._getExistingPhaseMs(el, nowPerf);
                return this._readTrackValuesAt(st, phaseMs);
            } catch {
                return { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
            }
        }

        getPresetStartValues(preset) {
            try {
                const parsed = this._parseTimeline(preset?.timeline, { graphType: preset?.graphType });
                return this._readTrackValuesAt(parsed, 0);
            } catch {
                return { tMs: 0, x: 0, y: 0, s: 1, o: 1 };
            }
        }

        makeTransitionPreset(fromVals, toVals, durationMs, { graphType = 'linear' } = {}) {
            const dur = Math.max(1, Math.round(Number(durationMs || 100)));
            const from = fromVals && typeof fromVals === 'object' ? fromVals : {};
            const to = toVals && typeof toVals === 'object' ? toVals : {};

            const fx = toNumber(from.x ?? 0, 0);
            const fy = toNumber(from.y ?? 0, 0);
            const fs = Math.max(0, toNumber(from.s ?? 1, 1));
            const fo = clamp(toNumber(from.o ?? 1, 1), 0, 1);

            const tx = toNumber(to.x ?? 0, 0);
            const ty = toNumber(to.y ?? 0, 0);
            const ts = Math.max(0, toNumber(to.s ?? 1, 1));
            const toO = clamp(toNumber(to.o ?? 1, 1), 0, 1);

            return {
                key: '__transition__',
                graphType: String(graphType || 'linear').trim() || 'linear',
                timeline: {
                    duration_ms: dur,
                    loop: false,
                    tracks: {
                        position: [
                            { t_ms: 0, x: fx, y: fy },
                            { t_ms: dur, x: tx, y: ty },
                        ],
                        scale: [
                            { t_ms: 0, s: fs },
                            { t_ms: dur, s: ts },
                        ],
                        opacity: [
                            { t_ms: 0, o: fo },
                            { t_ms: dur, o: toO },
                        ],
                    },
                },
            };
        }

        withSmoothReturnToDefault(preset, smoothMs) {
            try {
                const extra = Math.max(0, Math.round(Number(smoothMs || 0)));
                if (extra <= 0) return preset;

                const parsed = this._parseTimeline(preset?.timeline, { graphType: preset?.graphType });
                const baseDur = Math.max(1, Math.round(Number(parsed?.durationMs || 1000)));
                const dur = baseDur + extra;

                const posEnd = this._readTrackValuesAt(parsed, baseDur);
                const scEnd = posEnd;
                const opEnd = posEnd;

                // Ensure we hold the last value until baseDur, then return to defaults at dur.
                const position = [
                    ...(Array.isArray(parsed.positionKeys) ? parsed.positionKeys : []).map(k => ({ t_ms: k.t, x: toNumber(k.x ?? 0, 0), y: toNumber(k.y ?? 0, 0) })),
                    { t_ms: baseDur, x: toNumber(posEnd.x ?? 0, 0), y: toNumber(posEnd.y ?? 0, 0) },
                    { t_ms: dur, x: 0, y: 0 },
                ];
                const scale = [
                    ...(Array.isArray(parsed.scaleKeys) ? parsed.scaleKeys : []).map(k => ({ t_ms: k.t, s: Math.max(0, toNumber(k.s ?? 1, 1)) })),
                    { t_ms: baseDur, s: Math.max(0, toNumber(scEnd.s ?? 1, 1)) },
                    { t_ms: dur, s: 1 },
                ];
                const opacity = [
                    ...(Array.isArray(parsed.opacityKeys) ? parsed.opacityKeys : []).map(k => ({ t_ms: k.t, o: clamp(toNumber(k.o ?? 1, 1), 0, 1) })),
                    { t_ms: baseDur, o: clamp(toNumber(opEnd.o ?? 1, 1), 0, 1) },
                    { t_ms: dur, o: 1 },
                ];

                return {
                    key: String(preset?.key || '').trim() || '__smoothed__',
                    graphType: String(preset?.graphType || 'linear').trim() || 'linear',
                    timeline: {
                        duration_ms: dur,
                        loop: false,
                        tracks: {
                            position,
                            scale,
                            opacity,
                        },
                    },
                };
            } catch {
                return preset;
            }
        }

        _parseTimeline(timelineRaw, { graphType } = {}) {
            // Supports:
            // - legacy list: [t1, t2, ...]
            // - dict with duration_ms and per-track keys (position/scale/opacity)
            const timeline = timelineRaw && (Array.isArray(timelineRaw) || typeof timelineRaw === 'object') ? timelineRaw : [];

            const durationMs = (() => {
                if (Array.isArray(timeline)) return 1000;
                const d = toNumber(timeline.duration_ms ?? timeline.durationMs ?? timeline.duration ?? 1000, 1000);
                return Math.max(1, Math.round(d));
            })();

            const loop = (() => {
                if (Array.isArray(timeline)) return false;
                const v = timeline.loop ?? timeline.looping ?? timeline.seamless_loop ?? timeline.seamlessLoop;
                if (typeof v === 'boolean') return v;
                if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
                return false;
            })();

            const tracksRoot = (!Array.isArray(timeline) && timeline && typeof timeline === 'object')
                ? (timeline.tracks && typeof timeline.tracks === 'object' ? timeline.tracks : timeline)
                : {};

            const readTrack = (name) => {
                if (Array.isArray(timeline)) {
                    // Legacy: times only; no values -> default constants.
                    return { keys: [] };
                }
                const raw = tracksRoot?.[name]
                    ?? tracksRoot?.[`${name}_track`]
                    ?? tracksRoot?.[`${name}Track`]
                    ?? tracksRoot?.[`${name}_keys`]
                    ?? tracksRoot?.[`${name}Keys`];

                // If raw is { keys: [...] } use it, else accept array directly.
                if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.keys)) return raw;
                if (Array.isArray(raw)) return { keys: raw };
                return { keys: [] };
            };

            const normalizePositionKeys = (rawKeys) => {
                const out = [];
                (Array.isArray(rawKeys) ? rawKeys : []).forEach((it) => {
                    const t = (typeof it === 'number') ? it : readTimeMs(it);
                    if (!Number.isFinite(t)) return;
                    const obj = (it && typeof it === 'object') ? it : {};
                    const x = toNumber(obj.x_px ?? obj.xPx ?? obj.x ?? obj.dx ?? 0, 0);
                    const y = toNumber(obj.y_px ?? obj.yPx ?? obj.y ?? obj.dy ?? 0, 0);
                    out.push({ t: Math.max(0, Math.round(t)), x, y });
                });
                return out;
            };

            const normalizeScaleKeys = (rawKeys) => {
                const out = [];
                (Array.isArray(rawKeys) ? rawKeys : []).forEach((it) => {
                    const t = (typeof it === 'number') ? it : readTimeMs(it);
                    if (!Number.isFinite(t)) return;
                    const obj = (it && typeof it === 'object') ? it : {};
                    const s = toNumber(obj.s ?? obj.scale ?? obj.value ?? 1, 1);
                    out.push({ t: Math.max(0, Math.round(t)), s });
                });
                return out;
            };

            const normalizeOpacityKeys = (rawKeys) => {
                const out = [];
                (Array.isArray(rawKeys) ? rawKeys : []).forEach((it) => {
                    const t = (typeof it === 'number') ? it : readTimeMs(it);
                    if (!Number.isFinite(t)) return;
                    const obj = (it && typeof it === 'object') ? it : {};
                    const o = clamp(toNumber(obj.v ?? obj.opacity ?? obj.value ?? 1, 1), 0, 1);
                    out.push({ t: Math.max(0, Math.round(t)), o });
                });
                return out;
            };

            const positionTrack = readTrack('position');
            const scaleTrack = readTrack('scale');
            const opacityTrack = readTrack('opacity');

            const positionKeys = normalizePositionKeys(positionTrack.keys);
            const scaleKeys = normalizeScaleKeys(scaleTrack.keys);
            const opacityKeys = normalizeOpacityKeys(opacityTrack.keys);

            const graph = String(graphType || (Array.isArray(timeline) ? '' : (timeline.graph_type ?? timeline.graphType)) || 'linear').trim() || 'linear';

            return { durationMs, loop, graphType: graph, positionKeys, scaleKeys, opacityKeys };
        }

        _ensureEndpoints(keys, durationMs, fallbackValue) {
            const dur = Math.max(1, Math.round(Number(durationMs || 1)));
            const list = (Array.isArray(keys) ? keys : [])
                .filter(k => k && Number.isFinite(Number(k.t)))
                .map(k => ({ ...k, t: Math.round(Number(k.t)) }))
                .filter(k => k.t >= 0 && k.t <= dur);
            if (!list.length) return [];

            const sorted = [...list].sort((a, b) => a.t - b.t);
            const first = sorted[0];
            const last = sorted[sorted.length - 1];

            // AE-like behavior: hold the first value before the first key and hold the last value after the last key.
            // Only use fallbackValue for missing components, not to override explicit key values.
            if (first.t !== 0) sorted.unshift({ ...(fallbackValue || {}), ...first, t: 0 });
            if (last.t !== dur) sorted.push({ ...(fallbackValue || {}), ...last, t: dur });

            // Remove duplicates by time (keep last occurrence)
            const byT = new Map();
            sorted.forEach(k => { byT.set(k.t, k); });
            return Array.from(byT.values()).sort((a, b) => a.t - b.t);
        }

        _valueAt(keys, t, valueKeys) {
            // keys: sorted [{t,...}] and t within [0,duration]
            if (!Array.isArray(keys) || keys.length === 0) return null;
            const time = Math.round(t);

            if (time <= keys[0].t) return keys[0];
            if (time >= keys[keys.length - 1].t) return keys[keys.length - 1];

            let i = 0;
            while (i < keys.length - 1 && keys[i + 1].t < time) i += 1;
            const a = keys[i];
            const b = keys[i + 1];
            const span = Math.max(1, b.t - a.t);
            const ratio = clamp((time - a.t) / span, 0, 1);

            const out = { t: time };
            (Array.isArray(valueKeys) ? valueKeys : []).forEach((k) => {
                const av = toNumber(a[k], 0);
                const bv = toNumber(b[k], 0);
                out[k] = av + (bv - av) * ratio;
            });
            return out;
        }

        _buildMergedKeyframes({ durationMs, loop, positionKeys, scaleKeys, opacityKeys }, { baseTransform } = {}) {
            const duration = Math.max(1, Math.round(durationMs || 1000));

            const posKeys = this._ensureEndpoints(positionKeys, duration, { x: 0, y: 0 });
            const scKeys = this._ensureEndpoints(scaleKeys, duration, { s: 1 });
            const opKeys = this._ensureEndpoints(opacityKeys, duration, { o: 1 });

            // Collect union times from each track, plus 0/duration.
            const times = uniqSorted([
                0,
                duration,
                ...posKeys.map(k => k.t),
                ...scKeys.map(k => k.t),
                ...opKeys.map(k => k.t),
            ].filter(n => Number.isFinite(n) && n >= 0));

            const readPos = (t) => {
                if (!posKeys.length) return { x: 0, y: 0 };
                const v = this._valueAt(posKeys, t, ['x', 'y']);
                return { x: toNumber(v?.x ?? 0, 0), y: toNumber(v?.y ?? 0, 0) };
            };
            const readScale = (t) => {
                if (!scKeys.length) return { s: 1 };
                const v = this._valueAt(scKeys, t, ['s']);
                return { s: Math.max(0, toNumber(v?.s ?? 1, 1)) };
            };
            const readOpacity = (t) => {
                if (!opKeys.length) return { o: 1 };
                const v = this._valueAt(opKeys, t, ['o']);
                return { o: clamp(toNumber(v?.o ?? 1, 1), 0, 1) };
            };

            const base = String(baseTransform || '').trim();
            const basePrefix = (base && base !== 'none') ? `${base} ` : '';

            const frames = times.map((t) => {
                const pct = duration > 0 ? (clamp(t, 0, duration) / duration) * 100 : 0;

                let pos = readPos(t);
                let sc = readScale(t);
                let op = readOpacity(t);

                const x = toNumber(pos.x, 0);
                const y = toNumber(pos.y, 0);
                const s = Math.max(0, toNumber(sc.s, 1));
                const o = clamp(toNumber(op.o, 1), 0, 1);

                const transform = `${basePrefix}translate(${x.toFixed(3)}px, ${y.toFixed(3)}px) scale(${s.toFixed(4)})`;

                return {
                    pct,
                    transform,
                    opacity: o,
                };
            });

            return { durationMs: duration, frames };
        }

        _makeAnimationName(prefix = 'album') {
            return `${prefix}_anim_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        }

        _snapshotInlineStyle(el) {
            const style = el?.style;
            if (!style) return {};
            return {
                animation: style.animation,
                animationName: style.animationName,
                animationDuration: style.animationDuration,
                animationTimingFunction: style.animationTimingFunction,
                animationIterationCount: style.animationIterationCount,
                animationFillMode: style.animationFillMode,
                animationDelay: style.animationDelay,
                animationPlayState: style.animationPlayState,
                transform: style.transform,
                opacity: style.opacity,
            };
        }

        _restoreInlineStyle(el, snap) {
            const style = el?.style;
            if (!style || !snap || typeof snap !== 'object') return;
            const keys = Object.keys(snap);
            keys.forEach(k => {
                try { style[k] = snap[k] ?? ''; } catch { }
            });
        }

        _getExistingPhaseMs(el, nowPerf) {
            const st = this._elementState.get(el);
            if (!st) return 0;
            const dur = Math.max(1, Math.round(st.durationMs || 1000));
            const loop = !!st.loop;
            const elapsed = Math.max(0, nowPerf - (st.startPerf || 0));
            if (!loop) return clamp(elapsed, 0, dur);
            return elapsed % dur;
        }

        stop(el) {
            try {
                const st = this._elementState.get(el);
                if (!st) return;

                // Remove CSS rule
                if (st.animName && this._rulesByName.has(st.animName)) {
                    this._rulesByName.delete(st.animName);
                    this._flushRules();
                }

                // Restore inline styles
                this._restoreInlineStyle(el, st.inlineSnapshot);

                this._elementState.delete(el);
            } catch { }
        }

        async playPresetOnElement(el, presetKey, { loop = null, seamless = true } = {}) {
            if (!el) return false;
            const preset = await this.loadPresetByKey(presetKey);
            if (!preset) return false;
            return this.applyPresetOnElement(el, preset, { loop, seamless });
        }

        applyPresetOnElement(el, preset, { loop = null, seamless = true } = {}) {
            if (!el || !preset) return false;

            const sanitizeTiming = (v) => {
                const s = String(v || '').trim();
                if (!s) return 'ease-in-out';
                const allowed = new Set([
                    'linear',
                    'ease',
                    'ease-in',
                    'ease-out',
                    'ease-in-out',
                    'step-start',
                    'step-end',
                ]);
                if (allowed.has(s)) return s;
                return 'ease-in-out';
            };

            const nowPerf = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const phaseMs = seamless ? this._getExistingPhaseMs(el, nowPerf) : 0;

            // Stop existing animation but keep phase value to restart seamlessly.
            this.stop(el);

            // Base transform: use computed transform so we don't break existing layout transforms
            // (e.g. Character layer centering translateX(-50%)).
            let baseTransform = 'none';
            try {
                baseTransform = String(getComputedStyle(el)?.transform || 'none');
            } catch { }

            const parsed = this._parseTimeline(preset.timeline, { graphType: preset.graphType });
            const effectiveLoop = (typeof loop === 'boolean') ? loop : !!parsed.loop;
            const timing = sanitizeTiming(parsed.graphType || preset.graphType);

            const merged = this._buildMergedKeyframes(
                { ...parsed, loop: effectiveLoop },
                { baseTransform }
            );

            const durationMs = merged.durationMs;
            const animName = this._makeAnimationName('album');

            const framesCss = merged.frames
                .map(f => {
                    const pct = clamp(f.pct, 0, 100);
                    return `${pct.toFixed(4)}% { transform: ${f.transform}; opacity: ${clamp(f.opacity, 0, 1).toFixed(4)}; }`;
                })
                .join(' ');

            const rule = `@keyframes ${animName} { ${framesCss} }`;

            this._rulesByName.set(animName, rule);
            this._flushRules();

            const inlineSnapshot = this._snapshotInlineStyle(el);

            // Apply animation (negative delay for seamless phase alignment)
            try {
                const style = el.style;
                const delayMs = -Math.round(clamp(phaseMs, 0, durationMs));
                style.animationName = animName;
                style.animationDuration = `${durationMs}ms`;
                style.animationTimingFunction = timing;
                style.animationDelay = `${delayMs}ms`;
                style.animationIterationCount = effectiveLoop ? 'infinite' : '1';
                style.animationFillMode = 'both';
                style.animationPlayState = 'running';
            } catch { }

            // Record state for seamless updates
            const startPerf = nowPerf - clamp(phaseMs, 0, durationMs);
            this._elementState.set(el, {
                animName,
                durationMs,
                loop: effectiveLoop,
                startPerf,
                inlineSnapshot,
                // Keep parsed tracks so we can sample current pose for smooth transitions.
                positionKeys: parsed.positionKeys,
                scaleKeys: parsed.scaleKeys,
                opacityKeys: parsed.opacityKeys,
            });

            return true;
        }
    }

    // Expose engine for other modules
    try {
        if (!window.Yuuka) window.Yuuka = {};
        window.Yuuka.AlbumCssAnimationEngine = AlbumCssAnimationEngine;
    } catch { }

    // Prototype helpers (optional sugar)
    Object.assign(proto, {
        _albumAnimGetEngine() {
            try {
                if (!this.state) this.state = {};
                if (!this.state._albumAnimEngine) {
                    this.state._albumAnimEngine = new AlbumCssAnimationEngine({ api: this.api?.album });
                }
                return this.state._albumAnimEngine;
            } catch {
                return new AlbumCssAnimationEngine({ api: this.api?.album });
            }
        },

        async _albumAnimPlayPresetOnLayer(layerEl, presetKey, opts) {
            try {
                const engine = this._albumAnimGetEngine();
                return await engine.playPresetOnElement(layerEl, presetKey, opts || {});
            } catch {
                return false;
            }
        },

        _albumAnimStopLayer(layerEl) {
            try {
                const engine = this._albumAnimGetEngine();
                return engine.stop(layerEl);
            } catch { }
        },
    });
})();
