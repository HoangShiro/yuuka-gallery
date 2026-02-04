// Album plugin - Core module: sound engine (preview playback)
// Provides a tiny, dependency-free helper to preview audio from URLs.

(function () {
    window.Yuuka = window.Yuuka || {};

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

    const getAuthHeader = () => {
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            if (token) return { Authorization: `Bearer ${token}` };
        } catch { }
        return {};
    };

    class AlbumSoundEngine {
        constructor({ api } = {}) {
            this._audio = null;
            this._currentUrl = null;
            // Optional: API wrapper (AlbumComponent.api.album) to resolve presets by id.
            this.api = api || null;

            this._presetsCache = { fetchedAt: 0, presets: [] };
        }

        async _fetchPresets({ maxAgeMs = 30000 } = {}) {
            try {
                const cache = this._presetsCache;
                const now = Date.now();
                const age = now - Number(cache?.fetchedAt || 0);
                if (Array.isArray(cache?.presets) && Number.isFinite(age) && age >= 0 && age < maxAgeMs) {
                    return cache.presets;
                }

                // Resolve via injected api wrapper (preferred)
                if (this.api && typeof this.api.get === 'function') {
                    const all = await this.api.get('/sound_fx/presets');
                    const arr = Array.isArray(all) ? all : [];
                    const presets = arr
                        .filter(p => p && typeof p === 'object')
                        .map(p => ({
                            id: String(p?.id || '').trim(),
                            url: String(p?.url || '').trim(),
                            group_ids: (() => {
                                try {
                                    const g0 = p?.group_ids;
                                    if (Array.isArray(g0)) return g0.map(x => String(x || '').trim()).filter(Boolean);
                                    const g1 = String(p?.group_id || '').trim();
                                    return g1 ? [g1] : [];
                                } catch {
                                    return [];
                                }
                            })(),
                        }))
                        .filter(p => p.id && p.url);
                    this._presetsCache = { fetchedAt: now, presets };
                    return presets;
                }

                // Fallback: direct fetch
                const url = `${window.location.origin}/api/plugin/album/sound_fx/presets`;
                const res = await fetch(url, { headers: { ...getAuthHeader() } });
                if (!res.ok) return Array.isArray(cache?.presets) ? cache.presets : [];
                const data = await res.json();
                const arr = Array.isArray(data) ? data : [];
                const presets = arr
                    .filter(p => p && typeof p === 'object')
                    .map(p => ({
                        id: String(p?.id || '').trim(),
                        url: String(p?.url || '').trim(),
                        group_ids: (() => {
                            try {
                                const g0 = p?.group_ids;
                                if (Array.isArray(g0)) return g0.map(x => String(x || '').trim()).filter(Boolean);
                                const g1 = String(p?.group_id || '').trim();
                                return g1 ? [g1] : [];
                            } catch {
                                return [];
                            }
                        })(),
                    }))
                    .filter(p => p.id && p.url);
                this._presetsCache = { fetchedAt: now, presets };
                return presets;
            } catch {
                return Array.isArray(this._presetsCache?.presets) ? this._presetsCache.presets : [];
            }
        }

        stop() {
            try {
                const a = this._audio;
                if (a) {
                    try { a.pause(); } catch { }
                    try { a.currentTime = 0; } catch { }
                }
            } finally {
                this._audio = null;
                this._currentUrl = null;
            }
        }

        /**
         * Play a URL for preview.
         * @param {string} url
         * @returns {HTMLAudioElement|null}
         */
        play(url) {
            const u = withAuthTokenQuery(String(url || '').trim());
            if (!u) return null;

            // Reuse existing audio when same URL.
            if (this._audio && this._currentUrl === u) {
                try {
                    this._audio.currentTime = 0;
                } catch { }
                try {
                    const p = this._audio.play();
                    if (p && typeof p.catch === 'function') p.catch(() => { });
                } catch { }
                return this._audio;
            }

            this.stop();

            const a = new Audio();
            a.preload = 'auto';
            a.src = u;
            this._audio = a;
            this._currentUrl = u;

            // If the URL 404s or the browser can't decode it, don't throw unhandled rejections.
            // Also clear the current URL so future calls can retry after the user fixes presets.
            try {
                a.addEventListener('error', () => {
                    try { a.pause(); } catch { }
                    try { a.currentTime = 0; } catch { }
                    try {
                        if (this._audio === a) {
                            this._audio = null;
                            this._currentUrl = null;
                        }
                    } catch { }
                }, { once: true });
            } catch { }

            try {
                const p = a.play();
                if (p && typeof p.catch === 'function') p.catch(() => { });
            } catch { }
            return a;
        }

        /**
         * Play a Sound FX preset.
         * Accepts: preset object {url}, url string, or preset id string.
         * Best-effort: if only id is given, tries to resolve via api.get('/sound_fx/presets')
         * or fetch("/api/plugin/album/sound_fx/presets").
         * @param {any} presetOrId
         * @returns {Promise<HTMLAudioElement|null>}
         */
        async playPreset(presetOrId) {
            try {
                // url string
                if (typeof presetOrId === 'string' && /^https?:\/\//i.test(presetOrId.trim())) {
                    return this.play(presetOrId);
                }

                // preset object
                if (presetOrId && typeof presetOrId === 'object') {
                    const url = String(presetOrId?.url || '').trim();
                    if (url) return this.play(url);
                    const id = String(presetOrId?.id || '').trim();
                    if (id) return await this.playPreset(id);
                }

                // id string
                const id = String(presetOrId || '').trim();
                if (!id) return null;

                // Resolve via injected api wrapper
                try {
                    if (this.api && typeof this.api.get === 'function') {
                        const all = await this.api.get('/sound_fx/presets');
                        const arr = Array.isArray(all) ? all : [];
                        const found = arr.find(p => String(p?.id || '').trim() === id) || null;
                        const url = String(found?.url || '').trim();
                        if (url) return this.play(url);
                    }
                } catch { }

                // Fallback: direct fetch
                try {
                    const url = `${window.location.origin}/api/plugin/album/sound_fx/presets`;
                    const res = await fetch(url, { headers: { ...getAuthHeader() } });
                    if (!res.ok) return null;
                    const data = await res.json();
                    const arr = Array.isArray(data) ? data : [];
                    const found = arr.find(p => String(p?.id || '').trim() === id) || null;
                    const u = String(found?.url || '').trim();
                    if (u) return this.play(u);
                } catch { }
            } catch { }
            return null;
        }

        /**
         * Preview a Sound FX group ("preset package").
         * Picks a random member sound (based on preset.group_ids) and plays it.
         * @param {any} groupOrId
         * @returns {Promise<HTMLAudioElement|null>}
         */
        async playGroupRandom(groupOrId) {
            try {
                const gid = String((groupOrId && typeof groupOrId === 'object') ? (groupOrId.id || '') : (groupOrId || '')).trim();
                if (!gid) return null;

                const presets = await this._fetchPresets({ maxAgeMs: 30000 });
                const members = (Array.isArray(presets) ? presets : []).filter(p => {
                    try {
                        const gids = Array.isArray(p?.group_ids) ? p.group_ids : [];
                        return gids.includes(gid);
                    } catch {
                        return false;
                    }
                });
                if (!members.length) return null;

                const idx = Math.floor(Math.random() * members.length);
                const picked = members[Math.max(0, Math.min(members.length - 1, idx))];
                const url = String(picked?.url || '').trim();
                if (!url) return null;
                return this.play(url);
            } catch {
                return null;
            }
        }

        getCurrent() {
            return this._audio;
        }

        getCurrentUrl() {
            return this._currentUrl;
        }
    }

    window.Yuuka.AlbumSoundEngine = AlbumSoundEngine;
})();
