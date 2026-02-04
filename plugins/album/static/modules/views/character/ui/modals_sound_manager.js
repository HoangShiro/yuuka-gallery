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

    const normalizeId = (value) => String(value || '').trim();

    const toLower = (value) => String(value || '').toLowerCase();

    const getPresetDefaultName = (existingGroups) => {
        const groups = Array.isArray(existingGroups) ? existingGroups : [];
        let maxN = 0;
        for (const g of groups) {
            const name = String(g?.name || '').trim();
            const m = name.match(/^Preset\s+(\d+)$/i);
            if (m) {
                const n = Number(m[1]);
                if (Number.isFinite(n) && n > maxN) maxN = n;
            }
        }
        return `Preset ${maxN + 1}`;
    };

    const debounce = (fn, delayMs) => {
        let t = 0;
        return (...args) => {
            try { clearTimeout(t); } catch { }
            t = setTimeout(() => {
                try { fn(...args); } catch { }
            }, Math.max(0, Number(delayMs) || 0));
        };
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
                                <button type="button" class="plugin-album__soundmgr-new-preset" data-action="open-editor" title="Open editor">
                                    Open editor
                                </button>
                                <button type="button" class="plugin-album__soundmgr-new-preset" data-action="new-preset" title="New preset">
                                    New preset
                                </button>
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

                const VIRTUAL_UPLOADED_ID = '__uploaded__';
                const searchState = new Map(); // groupId -> query

                let lastActiveSoundId = '';

                let cachedGroups = []; // [{id,name}]
                let cachedSounds = []; // sound presets: [{id,name,ext,url,group_id,...}]

                const getSoundGroupIds = (p) => {
                    try {
                        const raw = p?.group_ids;
                        if (Array.isArray(raw)) {
                            return raw
                                .map(x => String(x || '').trim())
                                .filter(Boolean);
                        }
                    } catch { }
                    const legacy = String(p?.group_id || '').trim();
                    return legacy ? [legacy] : [];
                };

                const buildSoundLabel = (p) => {
                    const name = String(p?.name || '').trim();
                    const ext = String(p?.ext || '').trim().toLowerCase();
                    return ext ? `${name}.${ext}` : name;
                };

                const getGroupNameById = (id) => {
                    const gid = normalizeId(id);
                    if (!gid) return '';
                    const g = (cachedGroups || []).find(x => normalizeId(x?.id) === gid);
                    return String(g?.name || '').trim();
                };

                const sortGroupsWithUploadedLast = (groups) => {
                    const safe = Array.isArray(groups) ? groups : [];
                    return safe
                        .filter(g => g && typeof g === 'object')
                        .slice()
                        .sort((a, b) => {
                            const an = String(a?.name || '').trim();
                            const bn = String(b?.name || '').trim();
                            return an.localeCompare(bn, undefined, { sensitivity: 'base' });
                        });
                };

                const renderPresets = (groups, sounds) => {
                    if (!listEl) return;
                    const gs = sortGroupsWithUploadedLast(groups);
                    const ss = Array.isArray(sounds) ? sounds : [];

                    const allPresetCards = [
                        ...gs.map(g => ({
                            id: normalizeId(g?.id),
                            name: String(g?.name || '').trim(),
                            isUploaded: false,
                        })),
                        { id: VIRTUAL_UPLOADED_ID, name: 'Uploaded', isUploaded: true },
                    ].filter(x => x.id);

                    if (!ss.length) {
                        listEl.innerHTML = `
                            <div class="plugin-album__soundmgr-empty">
                                <div class="plugin-album__character-hint" style="padding: var(--spacing-3); color: var(--color-secondary-text);">Chưa có sound nào.</div>
                            </div>
                        `;
                        return;
                    }

                    const soundsSorted = ss
                        .filter(p => p && typeof p === 'object')
                        .slice()
                        .sort((a, b) => buildSoundLabel(a).localeCompare(buildSoundLabel(b), undefined, { sensitivity: 'base' }));

                    const makeSoundRow = (p, groupIdForRow, { allowEditDelete = true } = {}) => {
                        const id = normalizeId(p?.id);
                        const url = String(p?.url || '').trim();
                        const label = buildSoundLabel(p);
                        const safeLabel = escapeText(label || '(Unnamed)');
                        const safeId = escapeText(id);
                        const safeUrl = escapeText(url);
                        const safeGroup = escapeText(normalizeId(groupIdForRow));
                        return `
                            <div class="plugin-album__soundmgr-item" data-id="${safeId}" data-url="${safeUrl}" data-group="${safeGroup}" style="--fill:0%">
                                <div class="plugin-album__soundmgr-item-main">
                                    <div class="plugin-album__soundmgr-item-name" title="${safeLabel}">${safeLabel}</div>
                                    <div class="plugin-album__soundmgr-item-duration" data-role="duration">--:--</div>
                                </div>
                                <div class="plugin-album__soundmgr-item-actions">
                                    <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="play" title="Play">
                                        <span class="material-symbols-outlined">play_arrow</span>
                                    </button>
                                    ${allowEditDelete ? `
                                        <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="edit" title="Edit">
                                            <span class="material-symbols-outlined">edit</span>
                                        </button>
                                        <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="delete" title="Delete">
                                            <span class="material-symbols-outlined">delete</span>
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    };

                    const makePresetCard = (card) => {
                        const groupId = normalizeId(card?.id);
                        const isUploaded = !!card?.isUploaded;
                        const name = String(card?.name || '').trim() || 'Preset';
                        const safeGroupId = escapeText(groupId);
                        const safeName = escapeText(name);
                        const q = String(searchState.get(groupId) || '');
                        const safeQ = escapeText(q);

                        const items = isUploaded
                            ? soundsSorted
                            : soundsSorted.filter(p => getSoundGroupIds(p).includes(groupId));

                        const itemsHtml = items.length
                            ? items.map(p => makeSoundRow(p, groupId, { allowEditDelete: isUploaded })).join('')
                            : `<div class="plugin-album__soundmgr-preset-empty">(Empty)</div>`;

                        return `
                            <div class="plugin-album__soundmgr-preset" data-preset-id="${safeGroupId}" data-uploaded="${isUploaded ? '1' : '0'}">
                                <div class="plugin-album__soundmgr-preset-header">
                                    <div class="plugin-album__soundmgr-preset-name" data-role="preset-name" title="${safeName}">${safeName}</div>
                                    <input class="plugin-album__soundmgr-preset-name-input" data-role="preset-name-input" value="${safeName}" aria-label="Preset name" style="display:none" />
                                    <button type="button" class="plugin-album__soundmgr-preset-delete" data-action="delete-preset" title="Delete preset" ${isUploaded ? 'disabled' : ''}>
                                        <span class="material-symbols-outlined">delete</span>
                                    </button>
                                    <div class="plugin-album__soundmgr-preset-spacer"></div>
                                    <input class="plugin-album__soundmgr-preset-search" data-role="preset-search" placeholder="Search sound..." value="${safeQ}" ${isUploaded ? 'disabled' : ''} />
                                </div>

                                <div class="plugin-album__soundmgr-preset-search-results" data-role="preset-search-results" aria-label="Search results"></div>

                                <div class="plugin-album__soundmgr-preset-items" data-role="preset-items">
                                    ${itemsHtml}
                                </div>
                            </div>
                        `;
                    };

                    listEl.innerHTML = allPresetCards.map(makePresetCard).join('');

                    // Render initial search results for each card
                    try {
                        const cards = Array.from(listEl.querySelectorAll('.plugin-album__soundmgr-preset') || []);
                        for (const card of cards) {
                            try {
                                const gid = String(card.dataset.presetId || '').trim();
                                renderSearchResultsForCard(card, gid);
                            } catch { }
                        }
                    } catch { }
                };

                const resolveDurationsInView = async () => {
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
                };

                const loadAll = async () => {
                    try {
                        const [groups, sounds] = await Promise.all([
                            this.api.album.get('/sound_fx/groups'),
                            this.api.album.get('/sound_fx/presets'),
                        ]);
                        cachedGroups = Array.isArray(groups) ? groups : [];
                        cachedSounds = Array.isArray(sounds) ? sounds : [];
                        renderPresets(cachedGroups, cachedSounds);
                        await resolveDurationsInView();
                    } catch (err) {
                        try { showError?.(`Lỗi tải sound: ${err.message || err}`); } catch { }
                        if (listEl) {
                            listEl.innerHTML = `<div class="plugin-album__character-hint" style="padding: var(--spacing-3); color: var(--color-secondary-text);">Không thể tải danh sách sound.</div>`;
                        }
                    }
                };

                const renderSearchResultsForCard = (cardEl, groupId) => {
                    try {
                        const gid = normalizeId(groupId);
                        if (!cardEl || !gid) return;
                        const resultsEl = cardEl.querySelector('[data-role="preset-search-results"]');
                        const inputEl = cardEl.querySelector('[data-role="preset-search"]');
                        if (!resultsEl || !inputEl) return;

                        if (gid === VIRTUAL_UPLOADED_ID) {
                            resultsEl.innerHTML = '';
                            return;
                        }

                        const q = String(searchState.get(gid) || '').trim();
                        if (!q) {
                            resultsEl.innerHTML = '';
                            return;
                        }

                        const qLower = q.toLowerCase();
                        const inThisGroup = new Set(
                            (cachedSounds || [])
                                .filter(s => getSoundGroupIds(s).includes(gid))
                                .map(s => normalizeId(s?.id))
                        );

                        const matches = (cachedSounds || [])
                            .filter(s => s && typeof s === 'object')
                            .filter(s => {
                                const sid = normalizeId(s?.id);
                                if (!sid) return false;
                                if (inThisGroup.has(sid)) return false;
                                const label = buildSoundLabel(s);
                                return toLower(label).includes(qLower);
                            })
                            .slice(0, 30);

                        if (!matches.length) {
                            resultsEl.innerHTML = `<div class="plugin-album__soundmgr-pills-empty">No match</div>`;
                            return;
                        }

                        const items = matches.map(s => {
                            const sid = normalizeId(s?.id);
                            const url = String(s?.url || '').trim();
                            const label = buildSoundLabel(s);
                            const safeSid = escapeText(sid);
                            const safeGid = escapeText(gid);
                            const safeUrl = escapeText(url);
                            const safeLabel = escapeText(label || '(Unnamed)');
                            return `
                                <div class="plugin-album__soundmgr-item plugin-album__soundmgr-item--search" data-search="1" data-id="${safeSid}" data-url="${safeUrl}" data-target-group="${safeGid}" style="--fill:0%">
                                    <div class="plugin-album__soundmgr-item-main">
                                        <div class="plugin-album__soundmgr-item-name" title="${safeLabel}">${safeLabel}</div>
                                        <div class="plugin-album__soundmgr-item-duration" data-role="duration">--:--</div>
                                    </div>
                                    <div class="plugin-album__soundmgr-item-actions">
                                        <button type="button" class="plugin-album__soundmgr-iconbtn" data-action="search-play" title="Play">
                                            <span class="material-symbols-outlined">play_arrow</span>
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('');

                        resultsEl.innerHTML = items;
                    } catch {
                        try { cardEl.querySelector('[data-role="preset-search-results"]').innerHTML = ''; } catch { }
                    }
                };

                root?.querySelector('[data-action="new-preset"]')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    stopPlayback();
                    try {
                        const name = getPresetDefaultName(cachedGroups);
                        await this.api.album.post('/sound_fx/groups', { name });
                        await loadAll();
                    } catch (err) {
                        try { showError?.(`Không thể tạo preset: ${err.message || err}`); } catch { }
                    }
                });

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
                            let icon = null;
                            try { icon = playState.row.querySelector('button[data-action="play"] .material-symbols-outlined'); } catch { }
                            if (!icon) {
                                try { icon = playState.row.querySelector('.material-symbols-outlined'); } catch { }
                            }
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

                const playUrlOnRow = (rowEl, url) => {
                    const u = String(url || '').trim();
                    if (!u || !rowEl) return;
                    const uAuth = withAuthTokenQuery(u);

                    try {
                        const sid = normalizeId(rowEl?.dataset?.id);
                        if (sid) lastActiveSoundId = sid;
                    } catch { }

                    // toggle
                    if (playState?.row === rowEl) {
                        stopPlayback();
                        return;
                    }

                    stopPlayback();

                    try {
                        const eng = getEngine();
                        const audio = eng?.play?.(uAuth);
                        if (!audio) return;

                        playState = { row: rowEl, audio, raf: 0 };
                        rowEl.classList.add('is-playing');

                        const icon = rowEl.querySelector('.material-symbols-outlined');
                        if (icon) icon.textContent = 'pause';

                        audio.onended = () => {
                            stopPlayback();
                        };
                        audio.onerror = () => {
                            stopPlayback();
                        };

                        playState.raf = requestAnimationFrame(tickFill);
                    } catch (err) {
                        stopPlayback();
                        try { showError?.(`Không thể play sound: ${err.message || err}`); } catch { }
                    }
                };

                const savePresetNameDebounced = debounce(async (groupId, nextName) => {
                    const gid = normalizeId(groupId);
                    const name = String(nextName || '').trim();
                    if (!gid || gid === VIRTUAL_UPLOADED_ID) return;
                    if (!name) return;
                    try {
                        await this.api.album.put(`/sound_fx/groups/${encodeURIComponent(gid)}`, { name });
                    } catch (err) {
                        try { showError?.(`Lỗi đổi tên preset: ${err.message || err}`); } catch { }
                    }
                }, 600);

                listEl?.addEventListener('click', async (e) => {
                    const searchPlayBtn = e.target?.closest?.('button[data-action="search-play"]');
                    if (searchPlayBtn) {
                        e.preventDefault();
                        e.stopPropagation();
                        const row = searchPlayBtn.closest('.plugin-album__soundmgr-item--search');
                        const u = String(row?.dataset?.url || '').trim();
                        playUrlOnRow(row, u);
                        return;
                    }

                    const searchRow = e.target?.closest?.('.plugin-album__soundmgr-item--search');
                    if (searchRow && String(searchRow.dataset.search || '') === '1') {
                        // Click search row to add sound to preset (do not reset search)
                        e.preventDefault();
                        e.stopPropagation();
                        stopPlayback();
                        const soundId = normalizeId(searchRow?.dataset?.id);
                        const groupId = normalizeId(searchRow?.dataset?.targetGroup);
                        if (!soundId || !groupId || groupId === VIRTUAL_UPLOADED_ID) return;
                        try {
                            await this.api.album.put(`/sound_fx/presets/${encodeURIComponent(soundId)}`, { add_group_id: groupId });
                            await loadAll();
                        } catch (err) {
                            try { showError?.(`Không thể add sound: ${err.message || err}`); } catch { }
                        }
                        return;
                    }

                    const presetName = e.target?.closest?.('[data-role="preset-name"]');
                    if (presetName) {
                        e.preventDefault();
                        e.stopPropagation();
                        const card = presetName.closest('.plugin-album__soundmgr-preset');
                        const gid = normalizeId(card?.dataset?.presetId);
                        const isUploaded = String(card?.dataset?.uploaded || '') === '1';
                        if (!card || !gid || isUploaded) return;
                        const input = card.querySelector('[data-role="preset-name-input"]');
                        if (!input) return;
                        try {
                            presetName.style.display = 'none';
                            input.style.display = '';
                            input.focus();
                            input.select?.();
                        } catch { }
                        return;
                    }

                    const presetDeleteBtn = e.target?.closest?.('button[data-action="delete-preset"]');
                    if (presetDeleteBtn) {
                        e.preventDefault();
                        e.stopPropagation();
                        stopPlayback();
                        const card = presetDeleteBtn.closest('.plugin-album__soundmgr-preset');
                        const gid = normalizeId(card?.dataset?.presetId);
                        const isUploaded = String(card?.dataset?.uploaded || '') === '1';
                        if (!gid || isUploaded) return;
                        const ok = (typeof Yuuka?.ui?.confirm === 'function')
                            ? await Yuuka.ui.confirm('Bạn có chắc muốn xoá preset này?')
                            : window.confirm('Bạn có chắc muốn xoá preset này?');
                        if (!ok) return;
                        try {
                            await this.api.album.delete(`/sound_fx/groups/${encodeURIComponent(gid)}`);
                            await loadAll();
                        } catch (err) {
                            try { showError?.(`Lỗi xoá preset: ${err.message || err}`); } catch { }
                        }
                        return;
                    }

                    const btn = e.target?.closest?.('button[data-action]');
                    if (btn) {
                        // Sound row buttons (play/edit/delete)
                        e.preventDefault();
                        e.stopPropagation();

                        const row = btn.closest('.plugin-album__soundmgr-item');
                        const soundId = normalizeId(row?.dataset?.id);
                        if (!soundId) return;

                        lastActiveSoundId = soundId;

                        const action = String(btn.dataset.action || '').trim().toLowerCase();

                        if (action === 'play') {
                            const u = String(row?.dataset?.url || '').trim();
                            if (!u) return;
                            playUrlOnRow(row, u);
                            return;
                        }

                        if (action === 'delete') {
                            stopPlayback();
                            const ok = (typeof Yuuka?.ui?.confirm === 'function')
                                ? await Yuuka.ui.confirm('Bạn có chắc muốn xoá sound này?')
                                : window.confirm('Bạn có chắc muốn xoá sound này?');
                            if (!ok) return;

                            try {
                                await this.api.album.delete(`/sound_fx/presets/${encodeURIComponent(soundId)}`);
                                await loadAll();
                            } catch (err) {
                                try { showError?.(`Lỗi xoá sound: ${err.message || err}`); } catch { }
                            }
                            return;
                        }

                        if (action === 'edit') {
                            stopPlayback();
                            try {
                                // Open editor for uploaded sound
                                const found = (cachedSounds || []).find(s => normalizeId(s?.id) === soundId) || null;
                                if (typeof this._characterOpenSoundEditorPage === 'function') {
                                    await this._characterOpenSoundEditorPage(found || soundId);
                                    return;
                                }
                                throw new Error('Sound editor module not loaded.');
                            } catch (err) {
                                try { showError?.(`Không thể mở editor: ${err.message || err}`); } catch { }
                            }
                        }
                        return;
                    }

                    // Click-to-remove: click a sound row body inside non-Uploaded preset
                    const row = e.target?.closest?.('.plugin-album__soundmgr-item');
                    if (row) {
                        if (String(row.dataset.search || '') === '1') return;
                        const soundId = normalizeId(row?.dataset?.id);
                        const groupId = normalizeId(row?.dataset?.group);
                        if (!soundId) return;
                        if (!groupId || groupId === VIRTUAL_UPLOADED_ID) return;
                        // Uploaded preset: do nothing
                        const card = row.closest('.plugin-album__soundmgr-preset');
                        const isUploaded = String(card?.dataset?.uploaded || '') === '1';
                        if (isUploaded) return;
                        stopPlayback();
                        try {
                            await this.api.album.put(`/sound_fx/presets/${encodeURIComponent(soundId)}`, { remove_group_id: groupId });
                            await loadAll();
                        } catch (err) {
                            try { showError?.(`Không thể remove sound: ${err.message || err}`); } catch { }
                        }
                    }
                });

                root?.querySelector('[data-action="open-editor"]')?.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    stopPlayback();
                    try {
                        if (typeof this._characterOpenSoundEditorPage === 'function') {
                            // Open an empty editor. User can drop a file onto the timeline and Save as.
                            await this._characterOpenSoundEditorPage(null);
                            return;
                        }
                        throw new Error('Sound editor module not loaded.');
                    } catch (err) {
                        try { showError?.(`Không thể mở editor: ${err.message || err}`); } catch { }
                    }
                });

                // Preset name input handling (autosave)
                listEl?.addEventListener('input', (e) => {
                    const input = e.target?.closest?.('[data-role="preset-name-input"]');
                    if (!input) return;
                    const card = input.closest('.plugin-album__soundmgr-preset');
                    const gid = normalizeId(card?.dataset?.presetId);
                    const isUploaded = String(card?.dataset?.uploaded || '') === '1';
                    if (!gid || isUploaded) return;
                    const next = String(input.value || '').trim();
                    if (!next) return;
                    savePresetNameDebounced(gid, next);
                    try {
                        const label = card.querySelector('[data-role="preset-name"]');
                        if (label) label.textContent = next;
                    } catch { }
                });

                listEl?.addEventListener('keydown', (e) => {
                    const input = e.target?.closest?.('[data-role="preset-name-input"]');
                    if (input) {
                        const card = input.closest('.plugin-album__soundmgr-preset');
                        const gid = normalizeId(card?.dataset?.presetId);
                        const isUploaded = String(card?.dataset?.uploaded || '') === '1';
                        if (!gid || isUploaded) return;
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            const label = card.querySelector('[data-role="preset-name"]');
                            const currentName = String(label?.textContent || '').trim();
                            input.value = currentName;
                            input.style.display = 'none';
                            if (label) label.style.display = '';
                            return;
                        }
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            input.blur();
                            return;
                        }
                    }
                });

                listEl?.addEventListener('blur', (e) => {
                    const input = e.target?.closest?.('[data-role="preset-name-input"]');
                    if (!input) return;
                    const card = input.closest('.plugin-album__soundmgr-preset');
                    const gid = normalizeId(card?.dataset?.presetId);
                    const isUploaded = String(card?.dataset?.uploaded || '') === '1';
                    if (!gid || isUploaded) return;
                    const label = card.querySelector('[data-role="preset-name"]');
                    try {
                        input.style.display = 'none';
                        if (label) label.style.display = '';
                    } catch { }
                    const next = String(input.value || '').trim();
                    if (!next) return;
                    savePresetNameDebounced(gid, next);
                }, true);

                // Search inputs
                listEl?.addEventListener('input', (e) => {
                    const input = e.target?.closest?.('[data-role="preset-search"]');
                    if (!input) return;
                    const card = input.closest('.plugin-album__soundmgr-preset');
                    const gid = normalizeId(card?.dataset?.presetId);
                    if (!gid) return;
                    const q = String(input.value || '');
                    searchState.set(gid, q);
                    renderSearchResultsForCard(card, gid);
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

                    await loadAll();
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

                await loadAll();
            } catch (err) {
                console.warn('[Album] _characterOpenSoundManagerPage error:', err);
            }
        },
    });
})();
