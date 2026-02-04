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

        _sanitizeGraphType(v) {
            const s = String(v || '').trim();
            if (!s) return 'linear';
            const allowed = new Set([
                'linear',
                'ease',
                'ease-in',
                'ease-out',
                'ease-in-out',
                'step-start',
                'step-end',
            ]);
            return allowed.has(s) ? s : 'linear';
        }

        _cubicBezierYForX(x, p1x, p1y, p2x, p2y) {
            // Solve cubic-bezier for a given x in [0..1], return y.
            // Uses binary search; good enough for animation sampling.
            const cx = clamp(Number(x), 0, 1);

            const sampleX = (t) => {
                const u = 1 - t;
                // 3*u*u*t*p1x + 3*u*t*t*p2x + t*t*t
                return (3 * u * u * t * p1x) + (3 * u * t * t * p2x) + (t * t * t);
            };

            const sampleY = (t) => {
                const u = 1 - t;
                return (3 * u * u * t * p1y) + (3 * u * t * t * p2y) + (t * t * t);
            };

            let lo = 0;
            let hi = 1;
            let t = cx;
            for (let i = 0; i < 14; i += 1) {
                const sx = sampleX(t);
                if (sx > cx) hi = t;
                else lo = t;
                t = (lo + hi) / 2;
            }
            return clamp(sampleY(t), 0, 1);
        }

        _easeRatio(ratio, graphType) {
            const r = clamp(Number(ratio), 0, 1);
            const g = this._sanitizeGraphType(graphType);
            if (g === 'linear') return r;

            // Note: CSS step timing can't be represented per-track in a single transform animation.
            // We keep it best-effort here (global), but recommend linear/ease curves for multi-track offsets.
            if (g === 'step-start') return (r <= 0 ? 0 : 1);
            if (g === 'step-end') return (r < 1 ? 0 : 1);

            // CSS default cubic-beziers
            if (g === 'ease') return this._cubicBezierYForX(r, 0.25, 0.1, 0.25, 1.0);
            if (g === 'ease-in') return this._cubicBezierYForX(r, 0.42, 0.0, 1.0, 1.0);
            if (g === 'ease-out') return this._cubicBezierYForX(r, 0.0, 0.0, 0.58, 1.0);
            if (g === 'ease-in-out') return this._cubicBezierYForX(r, 0.42, 0.0, 0.58, 1.0);

            return r;
        }

        _valueAtEased(keys, t, valueKeys, graphType) {
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
            const raw = clamp((time - a.t) / span, 0, 1);
            const ratio = this._easeRatio(raw, graphType);

            const out = { t: time };
            (Array.isArray(valueKeys) ? valueKeys : []).forEach((k) => {
                const av = toNumber(a[k], 0);
                const bv = toNumber(b[k], 0);
                out[k] = av + (bv - av) * ratio;
            });
            return out;
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

        _readTrackValuesAt({ durationMs, positionKeys, scaleKeys, rotationKeys, opacityKeys, graphType }, tMs) {
            const duration = Math.max(1, Math.round(Number(durationMs || 1000)));
            const t = clamp(Math.round(Number(tMs || 0)), 0, duration);

            const g = this._sanitizeGraphType(graphType);

            const posKeys = this._ensureEndpoints(positionKeys, duration, { x: 0, y: 0 });
            const scKeys = this._ensureEndpoints(scaleKeys, duration, { s: 1 });
            const rotKeys = this._ensureEndpoints(rotationKeys, duration, { r: 0 });
            const opKeys = this._ensureEndpoints(opacityKeys, duration, { o: 1 });

            const pos = posKeys.length ? this._valueAtEased(posKeys, t, ['x', 'y'], g) : null;
            const sc = scKeys.length ? this._valueAtEased(scKeys, t, ['s'], g) : null;
            const rot = rotKeys.length ? this._valueAtEased(rotKeys, t, ['r'], g) : null;
            const op = opKeys.length ? this._valueAtEased(opKeys, t, ['o'], g) : null;

            return {
                tMs: t,
                x: toNumber(pos?.x ?? 0, 0),
                y: toNumber(pos?.y ?? 0, 0),
                s: Math.max(0, toNumber(sc?.s ?? 1, 1)),
                r: toNumber(rot?.r ?? 0, 0),
                o: clamp(toNumber(op?.o ?? 1, 1), 0, 1),
            };
        }

        getCurrentTrackValues(el) {
            try {
                const st = this._elementState.get(el);
                if (!st) return { tMs: 0, x: 0, y: 0, s: 1, r: 0, o: 1 };

                const nowPerf = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const phaseMs = this._getExistingPhaseMs(el, nowPerf);

                // If playback speed is applied (via scaled CSS duration), map the real phase time
                // back into the preset's raw timeline time so sampling matches what the user sees.
                const speed = (() => {
                    const s = Number(st?.speed ?? 1);
                    return (Number.isFinite(s) && s > 0) ? s : 1;
                })();
                const rawDur = (() => {
                    const d = Number(st?.rawDurationMs ?? st?.durationMs ?? 1000);
                    return (Number.isFinite(d) && d > 0) ? Math.round(d) : 1000;
                })();
                const sampleMs = clamp(Math.round(Number(phaseMs || 0) * speed), 0, rawDur);

                return this._readTrackValuesAt({
                    ...st,
                    durationMs: rawDur,
                }, sampleMs);
            } catch {
                return { tMs: 0, x: 0, y: 0, s: 1, r: 0, o: 1 };
            }
        }

        getPresetStartValues(preset) {
            try {
                const parsed = this._parseTimeline(preset?.timeline, { graphType: preset?.graphType });
                return this._readTrackValuesAt(parsed, 0);
            } catch {
                return { tMs: 0, x: 0, y: 0, s: 1, r: 0, o: 1 };
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
            const fr = toNumber(from.r ?? 0, 0);

            const tx = toNumber(to.x ?? 0, 0);
            const ty = toNumber(to.y ?? 0, 0);
            const ts = Math.max(0, toNumber(to.s ?? 1, 1));
            const toO = clamp(toNumber(to.o ?? 1, 1), 0, 1);
            const tr = toNumber(to.r ?? 0, 0);

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
                        rotation: [
                            { t_ms: 0, r_deg: fr },
                            { t_ms: dur, r_deg: tr },
                        ],
                        opacity: [
                            { t_ms: 0, o: fo },
                            { t_ms: dur, o: toO },
                        ],
                    },
                },
            };
        }

        _springEaseCriticallyDamped01(r, omega = 12) {
            // Critically damped step response in [0..1].
            // y(t) = 1 - (1 + w*t) * e^(-w*t)
            const t = clamp(Number(r), 0, 1);
            const w = Math.max(0.1, Number(omega) || 12);
            const e = Math.exp(-w * t);
            return clamp(1 - (1 + w * t) * e, 0, 1);
        }

        makeSpringTransitionPreset(fromVals, toVals, durationMs, { omega = 12, frames = null } = {}) {
            // Creates a transition preset that *bakes* spring smoothing into keyframes.
            // Intended to reduce visible jitter/jerk at extreme playback speeds.
            const dur = Math.max(1, Math.round(Number(durationMs || 120)));
            const from = fromVals && typeof fromVals === 'object' ? fromVals : {};
            const to = toVals && typeof toVals === 'object' ? toVals : {};

            const fx = toNumber(from.x ?? 0, 0);
            const fy = toNumber(from.y ?? 0, 0);
            const fs = Math.max(0, toNumber(from.s ?? 1, 1));
            const fo = clamp(toNumber(from.o ?? 1, 1), 0, 1);
            const fr = toNumber(from.r ?? 0, 0);

            const tx = toNumber(to.x ?? 0, 0);
            const ty = toNumber(to.y ?? 0, 0);
            const ts = Math.max(0, toNumber(to.s ?? 1, 1));
            const toO = clamp(toNumber(to.o ?? 1, 1), 0, 1);
            const tr = toNumber(to.r ?? 0, 0);

            const count = (() => {
                const n = Number(frames);
                if (Number.isFinite(n)) return Math.max(6, Math.min(90, Math.round(n)));
                // ~60fps-ish sampling with a cap.
                const byTime = Math.round(dur / 16);
                return Math.max(8, Math.min(60, byTime));
            })();

            const pos = [];
            const sc = [];
            const rot = [];
            const op = [];

            for (let i = 0; i <= count; i += 1) {
                const r = count ? (i / count) : 1;
                const eased = this._springEaseCriticallyDamped01(r, omega);
                const tMs = Math.round(r * dur);

                pos.push({ t_ms: tMs, x: fx + (tx - fx) * eased, y: fy + (ty - fy) * eased });
                sc.push({ t_ms: tMs, s: fs + (ts - fs) * eased });
                rot.push({ t_ms: tMs, r: fr + (tr - fr) * eased });
                op.push({ t_ms: tMs, o: fo + (toO - fo) * eased });
            }

            return {
                key: '__spring_transition__',
                graphType: 'linear',
                timeline: {
                    duration_ms: dur,
                    loop: false,
                    tracks: {
                        position: pos,
                        scale: sc,
                        rotation: rot,
                        opacity: op,
                    },
                },
            };
        }

        _springSimStep(x, v, target, dt, omega, zeta) {
            // Second-order spring toward target:
            // x'' + 2*zeta*omega*x' + omega^2*x = omega^2*target
            // Semi-implicit Euler integration.
            const w = Math.max(0.1, Number(omega) || 16);
            const z = Math.max(0, Number(zeta));
            const dx = (Number(target) || 0) - (Number(x) || 0);
            const a = (w * w) * dx - (2 * z * w) * (Number(v) || 0);
            const v1 = (Number(v) || 0) + a * dt;
            const x1 = (Number(x) || 0) + v1 * dt;
            return { x: x1, v: v1 };
        }

        _unwrapDeg(prev, next) {
            try {
                const a = Number(prev) || 0;
                const b = Number(next) || 0;
                // Shortest-path unwrap (avoid 360-jumps)
                let d = b - a;
                d = ((d + 180) % 360) - 180;
                return a + d;
            } catch {
                return Number(next) || 0;
            }
        }

        withSpringSmoothing(preset, { omega = 16, zeta = 1, dtMs = 16 } = {}) {
            // Bake spring/damping smoothing into the preset timeline itself.
            // Applies to: position/scale/rotation (vector spring); opacity is sampled as-is.
            // Output is linear because values are already baked.
            try {
                const k = String(preset?.key || '').trim();
                const graphType = String(preset?.graphType || 'linear').trim() || 'linear';

                // Never spring-smooth synthetic/internal presets.
                if (k.startsWith('__')) return preset;

                const parsed = this._parseTimeline(preset?.timeline, { graphType });
                const dur = Math.max(1, Math.round(Number(parsed?.durationMs || 1000)));

                const stepMs = (() => {
                    const ms = Number(dtMs);
                    if (!Number.isFinite(ms)) return 16;
                    return Math.max(8, Math.min(33, Math.round(ms)));
                })();

                // Cap total frames to keep CSS reasonable.
                const maxFrames = 180;
                const count = Math.max(2, Math.min(maxFrames, Math.ceil(dur / stepMs)));
                const dt = stepMs / 1000;

                const pos = [];
                const sc = [];
                const rot = [];
                const op = [];

                // Initialize from exact t=0 values.
                const t0 = this._readTrackValuesAt(parsed, 0);
                let px = Number(t0?.x ?? 0) || 0;
                let py = Number(t0?.y ?? 0) || 0;
                let ps = Math.max(0, Number(t0?.s ?? 1) || 1);
                let pr = Number(t0?.r ?? 0) || 0;

                let vx = 0, vy = 0, vs = 0, vr = 0;

                let prevTargetR = pr;

                for (let i = 0; i <= count; i += 1) {
                    const tMs = (i >= count) ? dur : Math.min(dur, i * stepMs);
                    const target = this._readTrackValuesAt(parsed, tMs);

                    const tx = Number(target?.x ?? 0) || 0;
                    const ty = Number(target?.y ?? 0) || 0;
                    const ts = Math.max(0, Number(target?.s ?? 1) || 1);
                    const tr0 = Number(target?.r ?? 0) || 0;
                    const tr = this._unwrapDeg(prevTargetR, tr0);
                    prevTargetR = tr;

                    // Advance spring state except for the very first sample.
                    if (i > 0) {
                        const sx = this._springSimStep(px, vx, tx, dt, omega, zeta);
                        px = sx.x; vx = sx.v;

                        const sy = this._springSimStep(py, vy, ty, dt, omega, zeta);
                        py = sy.x; vy = sy.v;

                        const ss = this._springSimStep(ps, vs, ts, dt, omega, zeta);
                        ps = Math.max(0, ss.x); vs = ss.v;

                        const sr = this._springSimStep(pr, vr, tr, dt, omega, zeta);
                        pr = sr.x; vr = sr.v;
                    }

                    pos.push({ t_ms: tMs, x: px, y: py });
                    sc.push({ t_ms: tMs, s: ps });
                    rot.push({ t_ms: tMs, r_deg: pr });
                    op.push({ t_ms: tMs, o: clamp(Number(target?.o ?? 1) || 1, 0, 1) });
                }

                return {
                    key: k,
                    graphType: 'linear',
                    timeline: {
                        duration_ms: dur,
                        loop: !!parsed.loop,
                        tracks: {
                            position: pos,
                            scale: sc,
                            rotation: rot,
                            opacity: op,
                        },
                    },
                };
            } catch {
                return preset;
            }
        }

        withIntensity(preset, intensity = 1, { affectOpacity = true } = {}) {
            try {
                const k = String(preset?.key || '').trim();
                const graphType = String(preset?.graphType || 'linear').trim() || 'linear';
                const amt = Math.max(0, Number(intensity));
                if (!Number.isFinite(amt)) return preset;
                if (Math.abs(amt - 1) < 1e-9) return preset;

            const doOpacity = (affectOpacity !== false);

                const parsed = this._parseTimeline(preset?.timeline, { graphType });
                const dur = Math.max(1, Math.round(Number(parsed?.durationMs || 1000)));

                const position = (Array.isArray(parsed.positionKeys) ? parsed.positionKeys : []).map((it) => {
                    const x0 = toNumber(it?.x ?? 0, 0);
                    const y0 = toNumber(it?.y ?? 0, 0);
                    return { t_ms: Math.max(0, Math.round(Number(it?.t || 0))), x: x0 * amt, y: y0 * amt };
                });

                const scale = (Array.isArray(parsed.scaleKeys) ? parsed.scaleKeys : []).map((it) => {
                    const s0 = Math.max(0, toNumber(it?.s ?? 1, 1));
                    const s = 1 + (s0 - 1) * amt;
                    return { t_ms: Math.max(0, Math.round(Number(it?.t || 0))), s: Math.max(0, s) };
                });

                const opacity = doOpacity
                    ? (Array.isArray(parsed.opacityKeys) ? parsed.opacityKeys : []).map((it) => {
                        const o0 = clamp(toNumber(it?.o ?? 1, 1), 0, 1);
                        const o = 1 + (o0 - 1) * amt;
                        return { t_ms: Math.max(0, Math.round(Number(it?.t || 0))), o: clamp(o, 0, 1) };
                    })
                    : [{ t_ms: 0, o: 1 }, { t_ms: dur, o: 1 }];

                const rotation = (Array.isArray(parsed.rotationKeys) ? parsed.rotationKeys : []).map((it) => {
                    const r0 = toNumber(it?.r ?? 0, 0);
                    return { t_ms: Math.max(0, Math.round(Number(it?.t || 0))), r_deg: r0 };
                });

                return {
                    key: k || '__intensity__',
                    graphType,
                    timeline: {
                        duration_ms: dur,
                        loop: !!parsed.loop,
                        tracks: { position, scale, rotation, opacity },
                    },
                };
            } catch {
                return preset;
            }
        }

        withLag(preset, lagMs = 0) {
            try {
                const graphType = String(preset?.graphType || 'linear').trim() || 'linear';
                const parsed = this._parseTimeline(preset?.timeline, { graphType });
                const dur = Math.max(1, Math.round(Number(parsed?.durationMs || 1000)));

                const lagRaw = Number(lagMs || 0);
                if (!Number.isFinite(lagRaw)) return preset;
                const lag = Math.max(0, Math.min(dur - 1, Math.round(lagRaw)));
                if (lag <= 0) return preset;

                const remapT = (t) => {
                    const tt = Math.max(0, Math.min(dur, Math.round(Number(t || 0))));
                    // Map [0..dur] -> [lag..dur] (compressed), so the animation ends on time.
                    const mapped = lag + (tt * (dur - lag)) / dur;
                    return Math.max(0, Math.min(dur, Math.round(mapped)));
                };

                const posKeys = this._ensureEndpoints(parsed.positionKeys, dur, { x: 0, y: 0 });
                const scKeys = this._ensureEndpoints(parsed.scaleKeys, dur, { s: 1 });
                const rotKeys = this._ensureEndpoints(parsed.rotationKeys, dur, { r: 0 });
                const opKeys = this._ensureEndpoints(parsed.opacityKeys, dur, { o: 1 });

                const posStart = posKeys.length ? this._valueAt(posKeys, 0, ['x', 'y']) : { x: 0, y: 0 };
                const scStart = scKeys.length ? this._valueAt(scKeys, 0, ['s']) : { s: 1 };
                const rotStart = rotKeys.length ? this._valueAt(rotKeys, 0, ['r']) : { r: 0 };
                const opStart = opKeys.length ? this._valueAt(opKeys, 0, ['o']) : { o: 1 };

                const position = [];
                if (posKeys.length) {
                    position.push({ t_ms: 0, x: toNumber(posStart?.x ?? 0, 0), y: toNumber(posStart?.y ?? 0, 0) });
                    position.push({ t_ms: lag, x: toNumber(posStart?.x ?? 0, 0), y: toNumber(posStart?.y ?? 0, 0) });
                    posKeys.forEach((it) => {
                        position.push({
                            t_ms: remapT(it.t),
                            x: toNumber(it?.x ?? 0, 0),
                            y: toNumber(it?.y ?? 0, 0),
                        });
                    });
                }

                const scale = [];
                if (scKeys.length) {
                    scale.push({ t_ms: 0, s: Math.max(0, toNumber(scStart?.s ?? 1, 1)) });
                    scale.push({ t_ms: lag, s: Math.max(0, toNumber(scStart?.s ?? 1, 1)) });
                    scKeys.forEach((it) => {
                        scale.push({
                            t_ms: remapT(it.t),
                            s: Math.max(0, toNumber(it?.s ?? 1, 1)),
                        });
                    });
                }

                const opacity = [];
                if (opKeys.length) {
                    opacity.push({ t_ms: 0, o: clamp(toNumber(opStart?.o ?? 1, 1), 0, 1) });
                    opacity.push({ t_ms: lag, o: clamp(toNumber(opStart?.o ?? 1, 1), 0, 1) });
                    opKeys.forEach((it) => {
                        opacity.push({
                            t_ms: remapT(it.t),
                            o: clamp(toNumber(it?.o ?? 1, 1), 0, 1),
                        });
                    });
                }

                const rotation = [];
                if (rotKeys.length) {
                    rotation.push({ t_ms: 0, r_deg: toNumber(rotStart?.r ?? 0, 0) });
                    rotation.push({ t_ms: lag, r_deg: toNumber(rotStart?.r ?? 0, 0) });
                    rotKeys.forEach((it) => {
                        rotation.push({
                            t_ms: remapT(it.t),
                            r_deg: toNumber(it?.r ?? 0, 0),
                        });
                    });
                }

                const uniqByT = (arr) => {
                    const map = new Map();
                    (Array.isArray(arr) ? arr : []).forEach((k) => {
                        const t = Math.max(0, Math.min(dur, Math.round(Number(k?.t_ms ?? 0))));
                        map.set(t, { ...k, t_ms: t });
                    });
                    return Array.from(map.values()).sort((a, b) => a.t_ms - b.t_ms);
                };

                return {
                    key: String(preset?.key || '').trim() || '__lag__',
                    graphType,
                    timeline: {
                        duration_ms: dur,
                        loop: !!parsed.loop,
                        tracks: {
                            position: uniqByT(position),
                            scale: uniqByT(scale),
                            rotation: uniqByT(rotation),
                            opacity: uniqByT(opacity),
                        },
                    },
                };
            } catch {
                return preset;
            }
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
                const rotEnd = posEnd;

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

                const rotation = [
                    ...(Array.isArray(parsed.rotationKeys) ? parsed.rotationKeys : []).map(k => ({ t_ms: k.t, r_deg: toNumber(k.r ?? 0, 0) })),
                    { t_ms: baseDur, r_deg: toNumber(rotEnd.r ?? 0, 0) },
                    { t_ms: dur, r_deg: 0 },
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
                            rotation,
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
            // - dict with duration_ms and per-track keys (position/scale/rotation/opacity)
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

            const normalizeRotationKeys = (rawKeys) => {
                const out = [];
                (Array.isArray(rawKeys) ? rawKeys : []).forEach((it) => {
                    const t = (typeof it === 'number') ? it : readTimeMs(it);
                    if (!Number.isFinite(t)) return;
                    const obj = (it && typeof it === 'object') ? it : {};
                    const r = toNumber(
                        obj.r_deg ?? obj.rDeg ?? obj.r ?? obj.rotation_deg ?? obj.rotationDeg ?? obj.rotation ?? obj.deg ?? obj.value ?? 0,
                        0
                    );
                    out.push({ t: Math.max(0, Math.round(t)), r });
                });
                return out;
            };

            const positionTrack = readTrack('position');
            const scaleTrack = readTrack('scale');
            const rotationTrack = readTrack('rotation');
            const opacityTrack = readTrack('opacity');

            const positionKeys = normalizePositionKeys(positionTrack.keys);
            const scaleKeys = normalizeScaleKeys(scaleTrack.keys);
            const rotationKeys = normalizeRotationKeys(rotationTrack.keys);
            const opacityKeys = normalizeOpacityKeys(opacityTrack.keys);

            const graph = String(graphType || (Array.isArray(timeline) ? '' : (timeline.graph_type ?? timeline.graphType)) || 'linear').trim() || 'linear';

            return { durationMs, loop, graphType: graph, positionKeys, scaleKeys, rotationKeys, opacityKeys };
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

        _buildMergedKeyframes({ durationMs, loop, positionKeys, scaleKeys, rotationKeys, opacityKeys, graphType }, { baseTransform } = {}) {
            const duration = Math.max(1, Math.round(durationMs || 1000));

            const g = this._sanitizeGraphType(graphType);

            const posKeys = this._ensureEndpoints(positionKeys, duration, { x: 0, y: 0 });
            const scKeys = this._ensureEndpoints(scaleKeys, duration, { s: 1 });
            const rotKeys = this._ensureEndpoints(rotationKeys, duration, { r: 0 });
            const opKeys = this._ensureEndpoints(opacityKeys, duration, { o: 1 });

            // Collect union times from each track, plus 0/duration.
            // IMPORTANT: If we rely on CSS easing (ease-in-out, etc.), every union time becomes a segment boundary
            // which causes *all* properties to ease-to-zero velocity at that boundary.
            // To avoid cross-track "linked stops", we bake easing into sampled values and keep CSS timing linear.
            const unionTimes = uniqSorted([
                0,
                duration,
                ...posKeys.map(k => k.t),
                ...scKeys.map(k => k.t),
                ...rotKeys.map(k => k.t),
                ...opKeys.map(k => k.t),
            ].filter(n => Number.isFinite(n) && n >= 0));

            const times = (() => {
                if (g === 'linear') return unionTimes;

                const maxFrames = 320;
                const idealStep = 16;
                const idealCount = Math.ceil(duration / idealStep) + 1;
                const step = (idealCount > maxFrames)
                    ? Math.max(1, Math.ceil(duration / Math.max(2, (maxFrames - 1))))
                    : idealStep;

                const sampled = [];
                for (let t = 0; t <= duration; t += step) sampled.push(Math.round(t));
                sampled.push(duration);

                return uniqSorted([...unionTimes, ...sampled]);
            })();

            const readPos = (t) => {
                if (!posKeys.length) return { x: 0, y: 0 };
                const v = this._valueAtEased(posKeys, t, ['x', 'y'], g);
                return { x: toNumber(v?.x ?? 0, 0), y: toNumber(v?.y ?? 0, 0) };
            };
            const readScale = (t) => {
                if (!scKeys.length) return { s: 1 };
                const v = this._valueAtEased(scKeys, t, ['s'], g);
                return { s: Math.max(0, toNumber(v?.s ?? 1, 1)) };
            };
            const readOpacity = (t) => {
                if (!opKeys.length) return { o: 1 };
                const v = this._valueAtEased(opKeys, t, ['o'], g);
                return { o: clamp(toNumber(v?.o ?? 1, 1), 0, 1) };
            };

            const readRotation = (t) => {
                if (!rotKeys.length) return { r: 0 };
                const v = this._valueAtEased(rotKeys, t, ['r'], g);
                return { r: toNumber(v?.r ?? 0, 0) };
            };

            const base = String(baseTransform || '').trim();
            const basePrefix = (base && base !== 'none') ? `${base} ` : '';

            const frames = times.map((t) => {
                const pct = duration > 0 ? (clamp(t, 0, duration) / duration) * 100 : 0;

                let pos = readPos(t);
                let sc = readScale(t);
                let rot = readRotation(t);
                let op = readOpacity(t);

                const x = toNumber(pos.x, 0);
                const y = toNumber(pos.y, 0);
                const s = Math.max(0, toNumber(sc.s, 1));
                const r = toNumber(rot.r, 0);
                const o = clamp(toNumber(op.o, 1), 0, 1);

                const transform = `${basePrefix}translate(${x.toFixed(3)}px, ${y.toFixed(3)}px) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;

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

        applyPresetOnElement(el, preset, { loop = null, seamless = true, phaseShiftMs = 0, speed = 1 } = {}) {
            if (!el || !preset) return false;

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
            const graphType = this._sanitizeGraphType(parsed.graphType || preset.graphType);

            const merged = this._buildMergedKeyframes(
                { ...parsed, loop: effectiveLoop, graphType },
                { baseTransform }
            );

            const rawDurationMs = Math.max(1, Math.round(Number(merged.durationMs || 1000)));
            const sp = (() => {
                const s = Number(speed);
                return (Number.isFinite(s) && s > 0) ? s : 1;
            })();
            // Applied duration is scaled inversely by speed.
            // Example: speed=2 => duration halves => plays 2x faster.
            const durationMs = Math.max(1, Math.round(rawDurationMs / sp));
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
                const shift = Number(phaseShiftMs || 0);
                const shiftedPhase = clamp(phaseMs + (Number.isFinite(shift) ? shift : 0), 0, durationMs);
                const delayMs = -Math.round(shiftedPhase);
                style.animationName = animName;
                style.animationDuration = `${durationMs}ms`;
                // Keep timing linear to avoid cross-track "linked stops" at union keyframe boundaries.
                // Easing (ease/ease-in-out/etc.) is baked into the sampled keyframe values.
                style.animationTimingFunction = 'linear';
                style.animationDelay = `${delayMs}ms`;
                style.animationIterationCount = effectiveLoop ? 'infinite' : '1';
                style.animationFillMode = 'both';
                style.animationPlayState = 'running';
            } catch { }

            // Record state for seamless updates
            const shift = Number(phaseShiftMs || 0);
            const shiftedPhase = clamp(phaseMs + (Number.isFinite(shift) ? shift : 0), 0, durationMs);
            const startPerf = nowPerf - shiftedPhase;
            this._elementState.set(el, {
                animName,
                durationMs,
                rawDurationMs,
                speed: sp,
                loop: effectiveLoop,
                startPerf,
                inlineSnapshot,
                graphType,
                // Keep parsed tracks so we can sample current pose for smooth transitions.
                positionKeys: parsed.positionKeys,
                scaleKeys: parsed.scaleKeys,
                rotationKeys: parsed.rotationKeys,
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
