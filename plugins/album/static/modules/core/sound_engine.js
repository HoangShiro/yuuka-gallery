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

    class AlbumSoundEngine {
        constructor() {
            this._audio = null;
            this._currentUrl = null;
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
                    this._audio.play();
                } catch { }
                return this._audio;
            }

            this.stop();

            const a = new Audio();
            a.preload = 'auto';
            a.src = u;
            this._audio = a;
            this._currentUrl = u;

            try { a.play(); } catch { }
            return a;
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
