class CivitaiImgSearchService {
    constructor(container, api, activePlugins = []) {
        this.api = api;
        this.activePlugins = Array.isArray(activePlugins) ? activePlugins : [];
        this.isOpen = false;
        this.overlay = null;
        this.form = null;
        this.queryInput = null;
        this.resultsContainer = null;
        this.state = {
            query: '',
            results: [],
            // removed page from state as per new spec
            isLoading: false,
            mode: 'all',
        };
        this._latestSearchToken = 0;
        this._searchDebounceTimer = null;
        this.activitySection = null;
        this.session = null;
        this._isFetchingMore = false;
        this._perLoad = 24; // items per batch when infinite scrolling
    this._hasInitialRender = false;

        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleKeydown = this.handleKeydown.bind(this);
    this.handleResultClick = this.handleResultClick.bind(this);
        this._handleScroll = this._handleScroll.bind(this);
    }

    start() { this.toggle(); }
    toggle() { this.isOpen ? this.close() : this.open(); }

    async open() {
        if (this.isOpen) return; this.isOpen = true;
        this._buildOverlay();
    }
    close() {
        if (!this.isOpen) return; this.isOpen = false;
        if (this._searchDebounceTimer) { clearTimeout(this._searchDebounceTimer); }
        if (this.overlay) { this.overlay.remove(); }
        document.removeEventListener('keydown', this.handleKeydown);
        document.body.classList.remove('lora-downloader-open');
        if (this.activitySection) {
            this.activitySection.removeEventListener('scroll', this._handleScroll);
        }
        this.session = null;
    }

    _buildOverlay() {
        if (this.overlay) return;
        document.body.classList.add('lora-downloader-open');
    const overlay = document.createElement('div');
    overlay.className = 'lora-downloader-overlay civitai-img-overlay';
        overlay.innerHTML = `
            <div class="lora-downloader-backdrop"></div>
            <div class="lora-downloader-panel civitai-img-search-panel">
                <header class="lora-downloader-header">
                    <div>
                        <h2>Civitai Image Search</h2>
                        <p>Tìm kiếm và xem trước hình ảnh từ Civitai (API công khai).</p>
                    </div>
                    <button class="lora-downloader-close" title="Đóng"><span class="material-symbols-outlined">close</span></button>
                </header>
                <div class="lora-downloader-body">
                    <section class="lora-downloader-section lora-downloader-form-section">
                        <form class="civitai-img-search-form lora-downloader-form">
                            <div class="lora-downloader-form-card is-collapsed">
                                <div class="lora-downloader-form-row lora-downloader-form-row--primary">
                                    <label class="lora-form-field lora-form-field--url">
                                        <span>Từ khóa / Prompt / Tag</span>
                                        <input type="text" name="query" placeholder="Nhập từ khóa để tìm ảnh" required>
                                    </label>
                                    <div class="lora-downloader-form-actions">
                                        <button type="button" class="lora-form-action lora-form-action--exit" title="Thoát" aria-label="Thoát">
                                            <span class="material-symbols-outlined">logout</span>
                                        </button>
                                        <button type="button" class="lora-form-action lora-form-action--toggle" title="Thu gọn" aria-label="Thu gọn" aria-expanded="false">
                                            <span class="material-symbols-outlined">unfold_more</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="civitai-tag-filters">
                                    <label class="lora-form-field">
                                        <span>Include</span>
                                        <textarea name="include" placeholder="tag1, tag2, ..." rows="2"></textarea>
                                    </label>
                                    <label class="lora-form-field">
                                        <span>Not included</span>
                                        <textarea name="exclude" placeholder="tagA, tagB, ..." rows="2"></textarea>
                                    </label>
                                </div>
                                <div class="lora-downloader-form-collapsible" hidden>
                                    <div class="lora-downloader-field-grid">
                                        <label><span>Sắp xếp (sort)</span>
                                            <select name="sort">
                                                <option value="Relevancy" selected>Relevancy</option>
                                                <option value="Newest">Newest</option>
                                                <option value="Most Reactions">Most Reactions</option>
                                                <option value="Most Comments">Most Comments</option>
                                                <option value="Most Collected">Most Collected</option>
                                                <option value="Oldest">Oldest</option>
                                                <option value="Random">Random</option>
                                            </select>
                                        </label>
                                        <label><span>Khoảng thời gian</span>
                                            <select name="period">
                                                <option value="AllTime">AllTime</option>
                                                <option value="Year">Year</option>
                                                <option value="Month">Month</option>
                                                <option value="Week">Week</option>
                                                <option value="Day">Day</option>
                                            </select>
                                        </label>
                                        <label>
                                            <span>Mode</span>
                                            <select name="mode">
                                                <option value="all" selected>All</option>
                                                <option value="sfw">SFW only</option>
                                                <option value="nsfw">NSFW only</option>
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </section>
                    <section class="lora-downloader-section lora-downloader-activity-section">
                        <header class="lora-downloader-subheader">
                            <div>
                                <h3 class="lora-list-title">Kết quả tìm kiếm</h3>
                                <p>Xem trước các hình ảnh khớp truy vấn của bạn.</p>
                            </div>
                            <div class="lora-downloader-subheader-actions">
                                <button type="button" class="btn-refresh" title="Làm mới"><span class="material-symbols-outlined">refresh</span></button>
                            </div>
                        </header>
                        <div class="lora-downloader-activity-list civitai-img-results"></div>
                    </section>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.overlay = overlay;
        this.form = overlay.querySelector('.civitai-img-search-form');
        this.resultsContainer = overlay.querySelector('.civitai-img-results');
        this.queryInput = overlay.querySelector('input[name="query"]');
    this.activitySection = overlay.querySelector('.lora-downloader-activity-section');

        const closeBtn = overlay.querySelector('.lora-downloader-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this.close());
        overlay.addEventListener('click', this.handleBackdropClick);
        document.addEventListener('keydown', this.handleKeydown);

        const exitBtn = overlay.querySelector('.lora-form-action--exit');
        if (exitBtn) exitBtn.addEventListener('click', () => this.close());

        const toggleBtn = overlay.querySelector('.lora-form-action--toggle');
        const collapsible = overlay.querySelector('.lora-downloader-form-collapsible');
        const formCard = overlay.querySelector('.lora-downloader-form-card');
        if (toggleBtn && collapsible && formCard) {
            toggleBtn.addEventListener('click', () => {
                const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
                toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                if (expanded) {
                    collapsible.hidden = true;
                    formCard.classList.add('is-collapsed');
                    toggleBtn.querySelector('.material-symbols-outlined').textContent = 'unfold_more';
                } else {
                    collapsible.hidden = false;
                    formCard.classList.remove('is-collapsed');
                    toggleBtn.querySelector('.material-symbols-outlined').textContent = 'unfold_less';
                }
            });
        }

        const refreshBtn = overlay.querySelector('.btn-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this._manualRefresh());

        if (this.form) {
            // Prevent default submit behavior; searches are performed dynamically on input
            this.form.addEventListener('submit', (e) => e.preventDefault());
        }
        if (this.queryInput) {
            this.queryInput.addEventListener('input', () => this._handleQueryInput());
        }

    // Dynamic update for all form inputs within the card
    const sortSelect = overlay.querySelector('select[name="sort"]');
    const periodSelect = overlay.querySelector('select[name="period"]');
    const modeSelect = overlay.querySelector('select[name="mode"]');
    const includeInput = overlay.querySelector('textarea[name="include"]');
    const excludeInput = overlay.querySelector('textarea[name="exclude"]');
    if (sortSelect) sortSelect.addEventListener('change', () => this._scheduleDynamicSearch());
    if (periodSelect) periodSelect.addEventListener('change', () => this._scheduleDynamicSearch());
    if (modeSelect) modeSelect.addEventListener('change', () => this._scheduleDynamicSearch());
    if (includeInput) includeInput.addEventListener('input', () => this._scheduleDynamicSearch());
    if (excludeInput) excludeInput.addEventListener('input', () => this._scheduleDynamicSearch());

        // Infinite scroll listener
        if (this.activitySection) {
            this.activitySection.addEventListener('scroll', this._handleScroll, { passive: true });
        }
    }

    handleBackdropClick(e) {
        if (e.target.classList.contains('lora-downloader-backdrop')) this.close();
    }
    handleKeydown(e) {
        if (e.key === 'Escape') this.close();
    }
    handleResultClick(e) {
        // 1) Open preview ONLY when clicking the thumbnail area
        const openEl = e.target.closest('.js-open-preview');
        if (openEl && this.resultsContainer.contains(openEl)) {
            const card = openEl.closest('.civitai-img-card');
            const imgUrl = openEl.dataset.fullUrl || card?.dataset.fullUrl;
            if (!imgUrl) return;
            const viewer = window?.Yuuka?.plugins?.simpleViewer;
            if (viewer && typeof viewer.open === 'function') {
                const allCards = Array.from(this.resultsContainer.querySelectorAll('.civitai-img-card'));
                const items = allCards.map(c => ({
                    imageUrl: c.dataset.fullUrl,
                    thumbUrl: c.querySelector('img')?.src || c.dataset.fullUrl,
                    id: c.dataset.fullUrl,
                    title: c.querySelector('strong')?.textContent?.trim() || '',
                    prompt: c.querySelector('p')?.textContent?.trim() || ''
                })).filter(it => !!it.imageUrl);
                const startIndex = Math.max(0, items.findIndex(it => it.imageUrl === imgUrl));
                viewer.open({ items, startIndex });
            } else {
                window.open(imgUrl, '_blank');
            }
            return;
        }

        // 2) Copy to clipboard when clicking model name or prompt
        const copyEl = e.target.closest('.js-copy');
        if (copyEl && this.resultsContainer.contains(copyEl)) {
            const text = copyEl.getAttribute('data-copy-text') || copyEl.textContent?.trim() || '';
            if (text) this._copyToClipboard(text, copyEl);
        }
    }

    _handleQueryInput() { this._scheduleDynamicSearch(); }

    _scheduleDynamicSearch(delay = 350) {
        const raw = (this.queryInput?.value || '').trim();
        if (!raw) {
            this.state.query = '';
            this.state.results = [];
            this._renderResults();
            return;
        }
        this.state.query = raw;
        // show loading immediately on new input
        this.state.isLoading = true;
        this._renderResults();
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
        const token = ++this._latestSearchToken;
        // reset session and initial render flag for new query/options
        this.session = null;
        this._hasInitialRender = false;
        this._searchDebounceTimer = setTimeout(async () => {
            const opts = this._collectFormOptions();
            await this._startSessionAndLoadFirst(opts, token);
        }, delay);
    }

    _collectFormOptions() {
        const formData = new FormData(this.form);
        return {
            query: (formData.get('query') || '').toString().trim(),
            // Keep default aligned with UI: Relevancy
            sort: formData.get('sort') || 'Relevancy',
            period: formData.get('period') || 'AllTime',
            mode: (formData.get('mode') || 'all').toString(),
            include: (formData.get('include') || '').toString(),
            exclude: (formData.get('exclude') || '').toString(),
        };
    }

    async _startSessionAndLoadFirst(opts, token) {
        try {
            const createSession = window?.Yuuka?.loraSearch?.createImageSearchSession;
            const normalizedSort = opts.sort === 'Relevancy' ? 'Newest' : opts.sort;
            if (typeof createSession === 'function') {
                this.session = await createSession({
                    query: opts.query,
                    sort: normalizedSort,
                    period: opts.period,
                    mode: opts.mode,
                    modelsPerQuery: 16,
                    perModelLimit: this._perLoad,
                });
            } else {
                this.session = this._createFallbackSession(opts, normalizedSort);
            }
            // Load first batch
            const batch = await this.session.next();
            if (token !== this._latestSearchToken) return;
            let items = (batch?.items) || [];
            // Apply tag include/exclude filters on initial batch
            items = this._applyIncludeExcludeFilter(items, opts.include, opts.exclude);
            this.state.results = items;
            this.state.isLoading = false;
            this._renderResults();
        } catch (err) {
            console.warn('Session start failed:', err);
            if (token !== this._latestSearchToken) return;
            this.state.results = [];
            this.state.isLoading = false;
            this._renderResults();
        }
    }

    _createFallbackSession(opts, sortForImages) {
        // Fallback: username-based cursor session only
        const mode = opts.mode;
        const perLoad = this._perLoad;
        const nsfwParam = mode === 'sfw' ? 'false' : (mode === 'nsfw' ? 'true' : undefined);
        let nextUrl = null;
        let started = false;
        const buildFirstUrl = () => {
            const u = new URL('https://civitai.com/api/v1/images');
            u.searchParams.append('username', opts.query);
            u.searchParams.append('limit', String(perLoad));
            u.searchParams.append('period', opts.period);
            if (sortForImages && sortForImages !== 'Relevancy') u.searchParams.append('sort', sortForImages);
            if (nsfwParam !== undefined) u.searchParams.append('nsfw', nsfwParam);
            return u.toString();
        };
        return {
            next: async () => {
                const url = started ? nextUrl : buildFirstUrl();
                started = true;
                if (!url) return { items: [], done: true };
                try {
                    const res = await fetch(url);
                    if (!res.ok) return { items: [], done: true };
                    const data = await res.json();
                    nextUrl = data?.metadata?.nextPage || null;
                    const items = Array.isArray(data?.items) ? data.items : [];
                    for (const it of items) {
                        if (it && !it.modelName) it.modelName = it.username || 'User Gallery';
                    }
                    // Apply client-side mode filter as safety
                    const filtered = this._filterByMode(items, mode);
                    return { items: filtered, done: !nextUrl };
                } catch {
                    return { items: [], done: true };
                }
            }
        };
    }

    async _loadNextBatch() {
        if (!this.session || this._isFetchingMore) return;
        this._isFetchingMore = true;
        this.state.isLoading = true;
        try {
            const batch = await this.session.next();
            let items = Array.isArray(batch?.items) ? batch.items : [];
            const opts = this._collectFormOptions();
            items = this._applyIncludeExcludeFilter(items, opts.include, opts.exclude);
            if (items.length) {
                this.state.results = this.state.results.concat(items);
                this._appendResultItems(items);
            }
        } catch (err) {
            console.warn('Load more failed:', err);
        } finally {
            this.state.isLoading = false;
            this._isFetchingMore = false;
        }
    }

    _handleScroll() {
        if (!this.activitySection) return;
        const el = this.activitySection;
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
        if (nearBottom && !this._isFetchingMore) {
            this._loadNextBatch();
        }
    }

    async _triggerSearch() {
        const opts = this._collectFormOptions();
        if (!opts.query) return;
        this.state.isLoading = true;
        this._renderResults();
        try {
            this.state.results = await this._searchRemote(opts);
        } catch (err) {
            console.warn('Search error:', err);
            this.state.results = [];
        } finally {
            this.state.isLoading = false;
            this._renderResults();
        }
    }

    async _manualRefresh() {
        if (!this.state.query) return;
        // Recreate session and load first batch using current options
        this.state.isLoading = true;
        this._hasInitialRender = false;
        this.session = null;
        const token = ++this._latestSearchToken;
        const opts = this._collectFormOptions();
        await this._startSessionAndLoadFirst(opts, token);
    }

    async _searchRemote(opts) {
        const searchApi = window?.Yuuka?.loraSearch?.searchImagesByQuery;
        if (typeof searchApi === 'function') {
            // Map mode to API nsfw parameter; api now accepts mode mapped internally
            const apiOpts = {
                query: opts.query,
                limit: opts.limit,
                sort: opts.sort,
                period: opts.period,
                mode: opts.mode,
            };
            const items = await searchApi(apiOpts) || [];
            return this._filterByMode(items, opts.mode);
        }
        // Fallback raw fetch
        const url = new URL('https://civitai.com/api/v1/images');
        url.searchParams.append('query', opts.query);
        // Also send tags/tag as a fallback since the Images API primarily filters by tags
        url.searchParams.append('tags', opts.query);
        url.searchParams.append('tag', opts.query);
        url.searchParams.append('limit', String(opts.limit));
        // page removed per new UI; rely on limit and relevancy
        // Only append sort when it's not Relevancy so the API keeps its relevancy behavior
        if (opts.sort && opts.sort !== 'Relevancy') {
            url.searchParams.append('sort', opts.sort);
        }
        url.searchParams.append('period', opts.period);
        // Tri-state mode handling per docs: nsfw can be boolean or enum (None, Soft, Mature, X)
        // For SFW only: nsfw=false; For NSFW only: nsfw=true (then also filter client-side)
        if (opts.mode === 'sfw') url.searchParams.append('nsfw', 'false');
        else if (opts.mode === 'nsfw') url.searchParams.append('nsfw', 'true');
        const res = await fetch(url.toString());
        if (!res.ok) return [];
        const data = await res.json();
        let items = Array.isArray(data?.items) ? data.items : [];
        items = this._filterByMode(items, opts.mode);
        return this._applyIncludeExcludeFilter(items, opts.include, opts.exclude);
    }

    _filterByMode(items, mode) {
        if (!Array.isArray(items) || !items.length || !mode || mode === 'all') return items || [];
        const isNSFW = (it) => {
            try {
                if (typeof it.nsfw === 'boolean') return it.nsfw;
                if (typeof it.nsfw === 'string') {
                    const v = it.nsfw.toLowerCase();
                    // Civitai enums: None, Soft, Mature, X
                    if (v === 'none' || v === 'false' || v === 'sfw') return false;
                    if (v === 'soft' || v === 'mature' || v === 'x' || v === 'true' || v === 'nsfw' || v === 'explicit') return true;
                }
                if (it.nsfwLevel !== undefined && it.nsfwLevel !== null) return Number(it.nsfwLevel) > 0;
                const rating = it.meta?.rating || it.meta?.Rating || it.rating;
                if (typeof rating === 'string' && /adult|explicit|nsfw/i.test(rating)) return true;
                const mNSFW = it.meta?.NSFW;
                if (typeof mNSFW === 'boolean') return mNSFW;
                if (typeof mNSFW === 'string') return /true|nsfw|explicit/i.test(mNSFW);
                const tags = [].concat(it.tags || [], it.meta?.tags || []);
                if (Array.isArray(tags) && tags.length) {
                    const joined = tags.join(' ').toLowerCase();
                    if (joined.includes('nsfw') || joined.includes('18+') || joined.includes('explicit')) return true;
                }
            } catch {}
            return false;
        };
        if (mode === 'sfw') return items.filter(it => !isNSFW(it));
        if (mode === 'nsfw') return items.filter(it => isNSFW(it));
        return items;
    }

    _renderResults() {
        if (!this.resultsContainer) return;
        const { isLoading, results, query } = this.state;
        if (!query) {
            this.resultsContainer.innerHTML = `<div class="lora-downloader-empty">Nhập từ khóa để bắt đầu tìm kiếm.</div>`;
            this._hasInitialRender = false;
            return;
        }
        // Initial loading state (no results yet)
        if (isLoading && results.length === 0) {
            this.resultsContainer.innerHTML = `<div class="lora-downloader-empty">Đang tải kết quả...</div>`;
            this._hasInitialRender = false;
            return;
        }
        // No results found after loading
        if (!isLoading && results.length === 0) {
            this.resultsContainer.innerHTML = `<div class="lora-downloader-empty">Không tìm thấy hình ảnh phù hợp.</div>`;
            this._hasInitialRender = false;
            return;
        }
        // First render with results: build once
        if (!this._hasInitialRender) {
            this.resultsContainer.classList.add('has-models');
            this.resultsContainer.innerHTML = '';
            this._appendResultItems(results);
            this.resultsContainer.removeEventListener('click', this.handleResultClick);
            this.resultsContainer.addEventListener('click', this.handleResultClick);
            this._hasInitialRender = true;
            return;
        }
        // Subsequent renders (e.g., toggling loading flag) do not touch existing cards
    }

    _appendResultItems(items) {
        if (!Array.isArray(items) || !items.length || !this.resultsContainer) return;
        const frag = document.createDocumentFragment();
        for (const r of items) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = this._createImageEntry(r);
            // The first child is the card root
            const node = wrapper.firstElementChild;
            if (node) frag.appendChild(node);
        }
        this.resultsContainer.appendChild(frag);
    }

    _applyIncludeExcludeFilter(items, includeRaw, excludeRaw) {
        if (!Array.isArray(items) || (!includeRaw && !excludeRaw)) return items;
        const includeTags = this._normalizeTagInput(includeRaw);
        const excludeTags = this._normalizeTagInput(excludeRaw);
        if (!includeTags.length && !excludeTags.length) return items;
        return items.filter(img => {
            const index = this._buildSearchIndex(img);
            // Include: all include tags must match
            for (const tag of includeTags) {
                if (!this._indexHasTag(index, tag)) return false;
            }
            // Exclude: none should match
            for (const tag of excludeTags) {
                if (this._indexHasTag(index, tag)) return false;
            }
            return true;
        });
    }

    _normalizeTagInput(raw) {
        return (raw || '')
            .split(/[,\n]/)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
    }

    _normalizeForJoin(str) {
        const s = (str || '').toLowerCase();
        try { return s.replace(/[^\p{L}\p{N}]+/gu, ''); } catch { return s.replace(/[^a-z0-9]+/gi, ''); }
    }

    _buildSearchIndex(img) {
        const tokens = new Set();
        const chunks = [];
        // tags arrays
        const tagArrays = [];
        if (Array.isArray(img?.tags)) tagArrays.push(img.tags);
        if (Array.isArray(img?.meta?.tags)) tagArrays.push(img.meta.tags);
        if (Array.isArray(img?.model?.tags)) tagArrays.push(img.model.tags);
        for (const arr of tagArrays) {
            for (const t of arr) {
                const tt = (t || '').toString().trim().toLowerCase();
                if (tt) { tokens.add(tt); chunks.push(tt); }
            }
        }
        // prompt
        const prompt = (img?.meta?.prompt || img?.prompt || '') + '';
        if (prompt) {
            const lowered = prompt.toLowerCase();
            // split by commas first
            lowered.split(',').forEach(part => {
                const p = part.trim();
                if (!p) return;
                tokens.add(p);
                chunks.push(p);
                // also split by whitespace into tokens
                p.split(/\s+/).forEach(w => { const ww = w.trim(); if (ww) tokens.add(ww); });
            });
            // if no commas, split by whitespace as tags
            if (!lowered.includes(',')) {
                lowered.split(/\s+/).forEach(w => { const ww = w.trim(); if (ww) tokens.add(ww); });
            }
            chunks.push(lowered);
        }
        const joined = this._normalizeForJoin(chunks.join(' '));
        return { tokens, joined };
    }

    _indexHasTag(index, rawTag) {
        const tag = (rawTag || '').toLowerCase();
        if (!tag) return false;
        // direct token match
        if (index.tokens.has(tag)) return true;
        // joined substring match (handles concatenated words)
        const joinedTag = this._normalizeForJoin(tag);
        if (joinedTag && index.joined.includes(joinedTag)) return true;
        return false;
    }

    _createImageEntry(img) {
        const thumb = img.url || img.image?.url || img.meta?.url || '';
        const fullUrl = img.url || thumb;
        const prompt = (img.meta && img.meta.prompt) || img.prompt || '';
        // Ưu tiên các nguồn tên model có độ tin cậy cao do ta đã enrich ở lora_search
        const modelName = img.modelName || (img.model && img.model.name) || (img.meta && (img.meta.model || img.meta.Model || img.meta.modelName)) || (img.modelId ? `Model ${img.modelId}` : '');
        const user = img.username || (img.user && img.user.username) || '';
        const created = img.createdAt ? this._formatTime(img.createdAt) : '';
        const promptEscapedFull = this._escape(prompt);
        const safePrompt = promptEscapedFull.slice(0, 180);
        return `
            <div class="civitai-img-card" data-full-url="${this._escapeAttr(fullUrl)}">
                <div class="civitai-card-row">
                    <div class="civitai-card-main">
                        <div class="civitai-card-thumb-wrapper js-open-preview" data-full-url="${this._escapeAttr(fullUrl)}" title="Nhấn để xem lớn">
                            ${thumb ? `<img src="${this._escapeAttr(thumb)}" class="civitai-card-thumb" loading="lazy"/>` : `<span class="material-symbols-outlined">image</span>`}
                        </div>
                        <div class="civitai-card-text">
                            <strong class="js-copy" data-copy-text="${this._escapeAttr(modelName || '')}" title="${this._escapeAttr(modelName || 'Không rõ model')}">${this._escape(modelName || 'Không rõ model')}</strong>
                            <p class="js-copy" data-copy-text="${this._escapeAttr(prompt || '')}" title="${this._escapeAttr(prompt || 'Không có prompt.')}">${safePrompt || 'Không có prompt.'}</p>
                            <span class="civitai-card-updated-inline">${user ? 'Người dùng: ' + this._escape(user) + ' · ' : ''}${created}</span>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    _formatTime(ts) {
        try {
            // Support both epoch seconds and ISO strings
            let d;
            if (typeof ts === 'number') {
                d = new Date(ts * 1000);
            } else if (typeof ts === 'string') {
                const asNum = Number(ts);
                if (!Number.isNaN(asNum) && ts.trim() !== '') {
                    d = new Date(asNum * 1000);
                } else {
                    d = new Date(ts);
                }
            } else {
                d = new Date(ts);
            }
            return isNaN(d.getTime()) ? '' : d.toLocaleString();
        } catch { return ''; }
    }
    _escape(value) { return (value || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    _escapeAttr(value) { return this._escape(value).replace(/'/g, '&#39;'); }

    async _copyToClipboard(text, el) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            // feedback
            if (el) {
                const prevTitle = el.getAttribute('title');
                el.classList.add('copied');
                el.setAttribute('title', 'Đã copy vào clipboard');
                setTimeout(() => {
                    el.classList.remove('copied');
                    if (prevTitle) el.setAttribute('title', prevTitle); else el.removeAttribute('title');
                }, 1000);
            }
            // Core error popup notification per requirement
            this._notifyErrorPopup('Đã sao chép!');
        } catch (err) {
            console.warn('Copy failed:', err);
        }
    }

    _notifyErrorPopup(message) {
        try {
            // Preferred: global showError used by core UI
            if (typeof window?.showError === 'function') {
                return window.showError(message);
            }
            const core = window?.Yuuka?.core || window?.Yuuka?.Core;
            // Try common error popup APIs
            if (core) {
                if (typeof core.error === 'function') return core.error(message);
                if (typeof core.showError === 'function') return core.showError(message);
                if (typeof core.showErrorPopup === 'function') return core.showErrorPopup(message);
                if (core.popup && typeof core.popup.error === 'function') return core.popup.error(message);
                if (core.notify && typeof core.notify.error === 'function') return core.notify.error(message);
                if (core.ui?.toast && typeof core.ui.toast.error === 'function') return core.ui.toast.error(message);
            }
            // Other globals some stacks use
            if (typeof window?.toast?.error === 'function') return window.toast.error(message);
            if (typeof window?.toastr?.error === 'function') return window.toastr.error(message);
        } catch {/* ignore */}

        // Fallback: lightweight ephemeral popup (bottom-right)
        const div = document.createElement('div');
        div.textContent = message || '';
        div.setAttribute('role', 'alert');
        div.style.position = 'fixed';
        div.style.zIndex = '3000';
        div.style.right = '16px';
        div.style.bottom = '16px';
        div.style.background = 'rgba(220, 38, 38, 0.95)'; // red-600 like
        div.style.color = '#fff';
        div.style.padding = '10px 14px';
        div.style.borderRadius = '8px';
        div.style.boxShadow = '0 8px 24px rgba(0,0,0,.25)';
        div.style.fontSize = '0.95rem';
        div.style.pointerEvents = 'none';
        document.body.appendChild(div);
        setTimeout(() => { div.style.transition = 'opacity .25s ease, transform .25s ease'; div.style.opacity = '0'; div.style.transform = 'translateY(6px)'; }, 1200);
        setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 1550);
    }
}

window.Yuuka = window.Yuuka || { components: {} };
window.Yuuka.components['CivitaiImgSearchService'] = CivitaiImgSearchService;
