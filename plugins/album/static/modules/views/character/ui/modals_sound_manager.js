// Album plugin - Character view (Page: Sound manager)
// Lists Sound FX presets as "sound files" and supports upload/rename/delete.

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

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
            // Don't duplicate
            if (!u.searchParams.get('token')) u.searchParams.set('token', token);
            return u.toString();
        } catch {
            return String(url || '').trim();
        }
    };

    const MAX_UPLOAD_SECONDS = 120;

    const formatDurationSSTT = (seconds) => {
        const s = Number(seconds);
        if (!Number.isFinite(s) || s <= 0) return '--:--';
        const ss = Math.max(0, Math.floor(s));
        const tt = Math.max(0, Math.floor((s - ss) * 100));
        return `${String(ss).padStart(2, '0')}:${String(tt).padStart(2, '0')}`;
    };

    const getAudioDurationFromFile = (file) => new Promise((resolve, reject) => {
        try {
            const f = file;
            if (!f) return resolve(null);

            const url = URL.createObjectURL(f);
            const a = new Audio();
            a.preload = 'metadata';
            a.onloadedmetadata = () => {
                const d = Number(a.duration);
                try { URL.revokeObjectURL(url); } catch { }
                if (Number.isFinite(d) && d > 0) resolve(d);
                else resolve(null);
            };
            a.onerror = () => {
                try { URL.revokeObjectURL(url); } catch { }
                resolve(null);
            };
            a.src = url;
        } catch (err) {
            reject(err);
        }
    });

    const getAudioDurationFromUrl = (url) => new Promise((resolve) => {
        try {
            const u = withAuthTokenQuery(url);
            if (!u) return resolve(null);
            const a = new Audio();
            a.preload = 'metadata';
            a.onloadedmetadata = () => {
                const d = Number(a.duration);
                if (Number.isFinite(d) && d > 0) resolve(d);
                else resolve(null);
            };
            a.onerror = () => resolve(null);
            a.src = u;
        } catch {
            resolve(null);
        }
    });

    const requestUploadPreset = async (file) => {
        const url = `${window.location.origin}/api/plugin/album/sound_fx/presets`;
        const form = new FormData();
        form.append('file', file, file?.name || 'sound');

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

        const ct = String(res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) return await res.json();
        return await res.text();
    };

    Object.assign(proto, {
        async _characterOpenSoundManagerPage() {
            try {
                if (this.state?.viewMode !== 'character') return;

                const getEngine = () => {
                    try {
                        if (typeof this._albumSoundGetEngine === 'function') return this._albumSoundGetEngine();
                        if (window.Yuuka?.AlbumSoundEngine) return new window.Yuuka.AlbumSoundEngine();
                    } catch { }
                    return null;
                };

                // Preserve some UI state to restore later
                try {
                    if (!this.state.character) this.state.character = {};
                    this.state.character._soundManager = {
                        returnActiveMenu: this.state.character.activeMenu ?? null,
                        isOpen: true,
                    };
                } catch { }

                const currentRoot = this.contentArea?.querySelector('.plugin-album__character-view');
                const prevClassName = String(currentRoot?.className || 'plugin-album__character-view');
                const viewClass = prevClassName.includes('plugin-album__character-view')
                    ? prevClassName
                    : 'plugin-album__character-view';

                // Render as a page inside contentArea (not a modal)
                this.contentArea.innerHTML = `
                    <div class="${viewClass} plugin-album__character-view--sound-manager">
                        <div class="plugin-album__soundmgr-overlay" aria-label="Sound manager overlay">
                            <div class="plugin-album__soundmgr-header" aria-label="Sound manager header">
                                <div class="plugin-album__soundmgr-title">Sound manager</div>
                                <div class="plugin-album__soundmgr-spacer"></div>
                                <button type="button" class="plugin-album__soundmgr-close" data-action="close" title="Close">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div class="plugin-album__soundmgr-list" data-role="list" aria-label="Sound list"></div>

                            <div class="plugin-album__soundmgr-upload" data-role="upload" aria-label="Upload sound" title="Upload sound">
                                Upload sound
                            </div>
                            <input type="file" data-role="file" accept=".wav,.mp3,.ogg,audio/*" multiple style="display:none" />
                        </div>
                    </div>
                `;

                const root = this.contentArea.querySelector('.plugin-album__character-view--sound-manager');
                const listEl = root?.querySelector('[data-role="list"]');
                const uploadEl = root?.querySelector('[data-role="upload"]');
                const fileInputEl = root?.querySelector('[data-role="file"]');

                // Notify navibar to update context buttons
                try { this._updateNav?.(); } catch { }

                const close = () => {
                    try {
                        try {
                            const eng = getEngine();
                            eng?.stop?.();
                        } catch { }
                        this._characterRender?.();
                        this._characterRefreshDisplayedImage?.();

                        const prev = this.state.character?._soundManager;
                        const menuName = prev?.returnActiveMenu;
                        if (menuName) {
                            try { this._characterSetActiveMenuButton?.(menuName); } catch { }
                        }
                        try { delete this.state.character._soundManager; } catch { }
                        try { this._updateNav?.(); } catch { }
                    } catch { }
                };

                root?.querySelector('[data-action="close"]')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                });

                const renderList = (presets) => {
                    const safe = Array.isArray(presets) ? presets : [];
                    const sorted = safe
                        .filter(p => p && typeof p === 'object')
                        .slice()
                        .sort((a, b) => {
                            const an = String(a?.name || '').trim();
                            const bn = String(b?.name || '').trim();
                            return an.localeCompare(bn, undefined, { sensitivity: 'base' });
                        });

                    if (!listEl) return;

                    if (!sorted.length) {
                        listEl.innerHTML = `<div class="plugin-album__character-hint" style="padding: var(--spacing-3); color: var(--color-secondary-text);">Chưa có sound nào.</div>`;
                        return;
                    }

                    listEl.innerHTML = sorted.map(p => {
                        const id = String(p?.id || '').trim();
                        const name = String(p?.name || '').trim();
                        const ext = String(p?.ext || '').trim().toLowerCase();
                        const url = String(p?.url || '').trim();
                        const label = ext ? `${name}.${ext}` : name;
                        const safeLabel = escapeText(label || '(Unnamed)');
                        const safeId = escapeText(id);
                        const safeUrl = escapeText(url);
                        return `
                            <div class="plugin-album__soundmgr-item" data-id="${safeId}" data-url="${safeUrl}" style="--fill:0%">
                                <div class="plugin-album__soundmgr-item-main">
                                    <div class="plugin-album__soundmgr-item-name" title="${safeLabel}">${safeLabel}</div>
                                    <div class="plugin-album__soundmgr-item-duration" data-role="duration">--:--</div>
                                </div>
                                <div class="plugin-album__soundmgr-item-actions">
                                    <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="play" title="Play">
                                        <span class="material-symbols-outlined">play_arrow</span>
                                    </button>
                                    <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="edit" title="Edit">
                                        <span class="material-symbols-outlined">edit</span>
                                    </button>
                                    <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="delete" title="Delete">
                                        <span class="material-symbols-outlined">delete</span>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('');
                };

                const loadList = async () => {
                    try {
                        const presets = await this.api.album.get('/sound_fx/presets');
                        renderList(presets);

                        // Async: resolve durations and patch DOM
                        try {
                            const rows = Array.from(listEl?.querySelectorAll?.('.plugin-album__soundmgr-item') || []);
                            rows.forEach(async (row) => {
                                try {
                                    const durEl = row.querySelector('[data-role="duration"]');
                                    if (!durEl) return;
                                    const u = String(row.dataset.url || '').trim();
                                    const d = await getAudioDurationFromUrl(u);
                                    durEl.textContent = formatDurationSSTT(d);
                                } catch { }
                            });
                        } catch { }
                    } catch (err) {
                        try { showError?.(`Lỗi tải sound: ${err.message || err}`); } catch { }
                        if (listEl) {
                            listEl.innerHTML = `<div class="plugin-album__character-hint" style="padding: var(--spacing-3); color: var(--color-secondary-text);">Không thể tải danh sách sound.</div>`;
                        }
                    }
                };

                let playState = null; // { row, audio, raf }

                const stopPlayback = () => {
                    try {
                        if (playState?.raf) cancelAnimationFrame(playState.raf);
                    } catch { }
                    try {
                        const eng = getEngine();
                        eng?.stop?.();
                    } catch { }
                    try {
                        if (playState?.row) {
                            playState.row.classList.remove('is-playing');
                            playState.row.style.setProperty('--fill', '0%');
                            const icon = playState.row.querySelector('button[data-action="play"] .material-symbols-outlined');
                            if (icon) icon.textContent = 'play_arrow';
                        }
                    } catch { }
                    playState = null;
                };

                const tickFill = () => {
                    if (!playState?.audio || !playState?.row) return;
                    const a = playState.audio;
                    const row = playState.row;
                    const dur = Number(a.duration);
                    const cur = Number(a.currentTime);
                    if (!Number.isFinite(dur) || dur <= 0) {
                        row.style.setProperty('--fill', '0%');
                    } else {
                        const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
                        row.style.setProperty('--fill', `${pct}%`);
                    }
                    playState.raf = requestAnimationFrame(tickFill);
                };

                listEl?.addEventListener('click', async (e) => {
                    const btn = e.target?.closest?.('button[data-action]');
                    if (!btn) return;
                    e.preventDefault();
                    e.stopPropagation();

                    const row = btn.closest('.plugin-album__soundmgr-item');
                    const presetId = String(row?.dataset?.id || '').trim();
                    if (!presetId) return;

                    const action = String(btn.dataset.action || '').trim().toLowerCase();

                    if (action === 'play') {
                        const u = String(row?.dataset?.url || '').trim();
                        if (!u) return;

                        const uAuth = withAuthTokenQuery(u);

                        // toggle
                        if (playState?.row === row) {
                            stopPlayback();
                            return;
                        }

                        stopPlayback();

                        try {
                            const eng = getEngine();
                            const audio = eng?.play?.(uAuth);
                            if (!audio) return;

                            playState = { row, audio, raf: 0 };
                            row.classList.add('is-playing');
                            const icon = row.querySelector('button[data-action="play"] .material-symbols-outlined');
                            if (icon) icon.textContent = 'pause';

                            audio.onended = () => {
                                stopPlayback();
                            };
                            audio.onerror = () => {
                                stopPlayback();
                            };

                            // Start fill animation
                            playState.raf = requestAnimationFrame(tickFill);
                        } catch (err) {
                            stopPlayback();
                            try { showError?.(`Không thể play sound: ${err.message || err}`); } catch { }
                        }
                        return;
                    }

                    if (action === 'delete') {
                        stopPlayback();
                        const ok = (typeof Yuuka?.ui?.confirm === 'function')
                            ? await Yuuka.ui.confirm('Bạn có chắc muốn xoá sound này?')
                            : window.confirm('Bạn có chắc muốn xoá sound này?');
                        if (!ok) return;

                        try {
                            await this.api.album.delete(`/sound_fx/presets/${encodeURIComponent(presetId)}`);
                            await loadList();
                        } catch (err) {
                            try { showError?.(`Lỗi xoá sound: ${err.message || err}`); } catch { }
                        }
                        return;
                    }

                    if (action === 'edit') {
                        stopPlayback();
                        let next = '';
                        try {
                            // Try to read current label text
                            const currentLabel = String(row?.querySelector('.plugin-album__soundmgr-item-name')?.textContent || '').trim();
                            next = window.prompt('Đổi tên sound:', currentLabel) || '';
                        } catch {
                            next = window.prompt('Đổi tên sound:', '') || '';
                        }
                        next = String(next || '').trim();
                        if (!next) return;

                        // If user typed "name.ext", strip extension for backend's name field.
                        next = next.replace(/\.(wav|mp3|ogg)$/i, '').trim();
                        if (!next) return;

                        try {
                            await this.api.album.put(`/sound_fx/presets/${encodeURIComponent(presetId)}`, { name: next });
                            await loadList();
                        } catch (err) {
                            try { showError?.(`Lỗi đổi tên: ${err.message || err}`); } catch { }
                        }
                    }
                });

                const uploadFiles = async (files) => {
                    const list = Array.from(files || []).filter(f => f && f.name);
                    if (!list.length) return;

                    // Upload sequentially to keep error reporting simple and avoid request bursts.
                    for (const f of list) {
                        try {
                            // Client-side duration gate (<= 120s)
                            const dur = await getAudioDurationFromFile(f);
                            if (Number.isFinite(dur) && dur > MAX_UPLOAD_SECONDS) {
                                try { showError?.(`Không cho upload sound dài hơn ${MAX_UPLOAD_SECONDS}s: ${f.name}`); } catch { }
                                continue;
                            }
                            await requestUploadPreset(f);
                        } catch (err) {
                            try { showError?.(`Upload thất bại (${f.name}): ${err.message || err}`); } catch { }
                        }
                    }

                    await loadList();
                };

                uploadEl?.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { fileInputEl?.click?.(); } catch { }
                });

                fileInputEl?.addEventListener('change', async () => {
                    try {
                        const files = fileInputEl.files;
                        await uploadFiles(files);
                    } finally {
                        try { fileInputEl.value = ''; } catch { }
                    }
                });

                const setDragOver = (on) => {
                    try { uploadEl?.classList?.toggle?.('is-dragover', !!on); } catch { }
                };

                uploadEl?.addEventListener('dragenter', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(true);
                });

                uploadEl?.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(true);
                });

                uploadEl?.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                });

                uploadEl?.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOver(false);
                    const files = e.dataTransfer?.files;
                    if (!files || !files.length) return;
                    await uploadFiles(files);
                });

                await loadList();
            } catch (err) {
                console.warn('[Album] _characterOpenSoundManagerPage error:', err);
            }
        },
    });
})();
