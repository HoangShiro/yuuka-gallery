(function () {
    // Module: ComfyUI status + tag prefetch + settings preload
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    function ensureTagDatasetService() {
        window.Yuuka = window.Yuuka || {};
        window.Yuuka.services = window.Yuuka.services || {};

        if (!window.Yuuka.services.tagDataset) {
            window.Yuuka.services.tagDataset = {
                data: null,
                promise: null,
                lastFetched: 0,
                ttl: 1000 * 60 * 60 * 6, // 6h
                prefetch(apiObj) {
                    if (this.data && (Date.now() - this.lastFetched) < this.ttl) return Promise.resolve(this.data);
                    if (this.promise) return this.promise;
                    if (!apiObj || typeof apiObj.getTags !== 'function') {
                        this.promise = Promise.resolve([]);
                        return this.promise;
                    }
                    this.promise = apiObj.getTags()
                        .then(arr => {
                            if (Array.isArray(arr)) {
                                this.data = arr;
                                this.lastFetched = Date.now();
                            } else {
                                this.data = [];
                            }
                            return this.data;
                        })
                        .catch(err => {
                            console.warn('[Album] tag prefetch failed:', err);
                            return this.data || [];
                        })
                        .finally(() => { this.promise = null; });
                    return this.promise;
                },
                get() { return Array.isArray(this.data) ? this.data : []; },
                clear() { this.data = null; this.lastFetched = 0; },
            };
        }

        return window.Yuuka.services.tagDataset;
    }

    proto.checkComfyUIStatus = async function () {
        try {
            const s = await this.api.album.get('/comfyui/info').catch(() => ({}));
            const t = s?.last_config?.server_address || '127.0.0.1:8888';
            await this.api.server.checkComfyUIStatus(t);
            this.state.isComfyUIAvaidable = true;
        } catch (e) {
            this.state.isComfyUIAvaidable = false;
            showError('Album: Không thể kết nối ComfyUI.');
        }
    };

    // --- Global tag dataset prefetch (runs once per app load) ---
    proto._prefetchTags = function () {
        try {
            const svc = ensureTagDatasetService();
            if (!svc || typeof svc.prefetch !== 'function') return;
            const apiObj = (typeof api !== 'undefined') ? api : this.api; // prefer global api if defined
            if (apiObj && typeof apiObj.getTags === 'function') {
                svc.prefetch(apiObj); // fire & forget
            }
        } catch (err) {
            console.warn('[Album] Tag prefetch skipped:', err);
        }
    };

    // --- Yuuka: Preload comfy settings (last_config + global_choices) so modal opens instantly ---
    proto._preloadComfySettings = async function (force = false) {
        if (!this.state?.selectedCharacter?.hash) return;
        if (!force && this.state.cachedComfySettings) return; // Already loaded
        try {
            const data = await this.api.album.get(`/comfyui/info?character_hash=${this.state.selectedCharacter.hash}`);
            if (data && (data.last_config || data.global_choices)) {
                this.state.cachedComfySettings = {
                    last_config: data.last_config || {},
                    global_choices: data.global_choices || null
                };
                if (data.global_choices) {
                    this.state.cachedComfyGlobalChoices = data.global_choices;
                }
            }
        } catch (err) {
            console.warn('[Album] Preload comfy settings failed:', err);
        }
    };
})();
