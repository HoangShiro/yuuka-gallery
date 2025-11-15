function registerAlbumCapabilitiesAtLoad(windowObj = window) {
    (function () {
        try {
            const g = windowObj.Yuuka = windowObj.Yuuka || {};
            g.services = g.services || {};
            const caps = g.services.capabilities;
            if (!caps || typeof caps.register !== 'function') return;

            const safeRegister = (def) => {
                try {
                    return caps.register(def);
                } catch (e) {
                    console.warn('[Album] Failed to register capability', def && def.id, e);
                    return null;
                }
            };

            const resolveAlbumInstance = () => {
                const inst = windowObj.Yuuka?.instances?.AlbumComponent;
                if (inst && typeof inst === 'object') return inst;

                try {
                    const rootState = windowObj.Yuuka?.coreState || windowObj.state || {};
                    const activePlugins = Array.isArray(rootState.activePlugins)
                        ? rootState.activePlugins
                        : (Array.isArray(windowObj.activePlugins) ? windowObj.activePlugins : []);
                    if (!activePlugins.length) return null;

                    const albumMeta = activePlugins.find(p => p && (p.id === 'album' || p.name === 'album'));
                    if (!albumMeta || !albumMeta.id) return null;

                    const container = windowObj.document.querySelector(`.plugin-container[data-plugin-id="${albumMeta.id}"]`);
                    if (!container) return null;

                    const ComponentClass = windowObj.Yuuka?.components?.AlbumComponent;
                    const apiRef = (typeof api !== 'undefined') ? api : windowObj.api;
                    if (!ComponentClass || !apiRef) return null;

                    const instance = new ComponentClass(container, apiRef, activePlugins);
                    if (typeof instance.init === 'function') {
                        instance.init();
                    }
                    windowObj.Yuuka = windowObj.Yuuka || {}; windowObj.Yuuka.instances = windowObj.Yuuka.instances || {};
                    windowObj.Yuuka.instances.AlbumComponent = instance;
                    return instance;
                } catch (err) {
                    console.warn('[Album] Failed to bootstrap headless AlbumComponent instance:', err);
                    return null;
                }
            };

            safeRegister({
                id: 'image.generate',
                pluginId: 'album',
                title: 'Generate character image',
                description: 'Generate an image for the selected character using Album workflow.',
                type: 'action',
                tags: ['image', 'album', 'generate'],
                llmCallable: true,
                llmName: 'generate_character_image',
                example: {
                    variants: [
                        {
                            name: 'simple portrait (album config)',
                            payload: {
                                character_hash: 'demo_hash_123',
                                expression: 'smile',
                                action: 'sitting',
                                outfits: 'school uniform',
                                context: '1girl, classroom',
                                quality: 'masterpiece, best quality, highres, amazing quality',
                                negative: 'bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark',
                            },
                            notes: 'Ví dụ đầy đủ các field prompt-style (expression/action/outfits/context/quality/negative) đúng theo cấu trúc config mà Album backend đang dùng.',
                        },
                        {
                            name: 'dynamic full body (album config)',
                            payload: {
                                character_name: 'Shiina Mahiru',
                                expression: 'excited',
                                action: 'dynamic pose',
                                outfits: 'casual outfit',
                                context: '1girl, full body, detailed background',
                                quality: 'masterpiece, best quality, dynamic lighting',
                                negative: 'lowres, bad hands, extra limbs, watermark',
                            },
                            notes: 'Ví dụ khác với action/background phức tạp hơn, tìm album bằng tên nhân vật thay vì hash.',
                        },
                    ],
                    defaultPayload: {
                        character_hash: 'demo_hash_123',
                        expression: 'smile',
                        action: 'sitting',
                        outfits: 'school uniform',
                        context: '1girl, classroom',
                        quality: 'masterpiece, best quality, highres, amazing quality',
                        negative: 'bad hands, bad quality, worst quality, worst detail, sketch, censor, x-ray, watermark',
                    },
                    notes: 'Các ví dụ này dùng đúng các field cấu hình prompt của Album (outfits/context/expression/action/quality/negative) và cho phép chọn nhân vật bằng cả character_hash hoặc character_name.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        character_hash: {
                            type: 'string',
                            description: 'Character hash in the album.',
                        },
                        character_name: {
                            type: 'string',
                            description: 'Tên nhân vật / album, dùng khi không biết hash chính xác.',
                        },
                        expression: {
                            type: 'string',
                            description: 'Biểu cảm nhân vật, ví dụ: smile, angry.',
                        },
                        action: {
                            type: 'string',
                            description: 'Hành động / pose của nhân vật.',
                        },
                        outfits: {
                            type: 'string',
                            description: 'Trang phục, ví dụ: school uniform, casual outfit.',
                        },
                        context: {
                            type: 'string',
                            description: 'Ngữ cảnh/scene, ví dụ: 1girl, classroom.',
                        },
                        quality: {
                            type: 'string',
                            description: 'Tag chất lượng, ví dụ: masterpiece, best quality.',
                        },
                        negative: {
                            type: 'string',
                            description: 'Negative prompt tags cho ảnh.',
                        },
                    },
                    anyOf: [
                        { required: ['character_hash'] },
                        { required: ['character_name'] },
                    ],
                },
                async invoke(args = {}, ctx = {}) {
                    const {
                        character_hash,
                        character_name,
                        expression,
                        action,
                        outfits,
                        context,
                        quality,
                        negative,
                    } = args;
                    let resolvedHash = null;

                    // Ưu tiên character_hash nếu được truyền trực tiếp
                    if (character_hash && typeof character_hash === 'string') {
                        resolvedHash = character_hash;
                    } else if (character_name && typeof character_name === 'string') {
                        // Thử tìm album theo tên nếu không có hash
                        const inst = (this && this.state && this._startGeneration)
                            ? this
                            : resolveAlbumInstance();
                        if (!inst || !inst.api || !inst.api.album) {
                            throw new Error('Không thể tìm album theo tên: AlbumComponent hoặc API chưa sẵn sàng.');
                        }
                        try {
                            const albums = await inst.api.album.get('/albums');
                            const needle = character_name.toLowerCase().trim();
                            let matched = null;
                            if (Array.isArray(albums)) {
                                matched = albums.find(a => {
                                    const name = (a && a.name) ? String(a.name).toLowerCase() : '';
                                    return name.includes(needle);
                                }) || null;
                            }
                            if (!matched || !matched.hash) {
                                throw new Error(`Không tìm thấy album nào khớp với tên: ${character_name}`);
                            }
                            resolvedHash = matched.hash;
                        } catch (err) {
                            console.warn('[Album] Failed to resolve character by name in image.generate capability:', err);
                            throw err;
                        }
                    }

                    if (!resolvedHash || typeof resolvedHash !== 'string') {
                        throw new Error('Missing or invalid character identifier for image.generate (cần character_hash hoặc character_name).');
                    }

                    const self = (this && this.state && this._startGeneration)
                        ? this
                        : resolveAlbumInstance();
                    if (!self || !self.state || !self._startGeneration) {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }

                    if (!self.state.selectedCharacter || self.state.selectedCharacter.hash !== resolvedHash) {
                        self.state.selectedCharacter = {
                            hash: resolvedHash,
                            name: self.state.selectedCharacter?.name || 'Unknown',
                        };
                        self.state.viewMode = 'album';
                        await self.loadAndDisplayCharacterAlbum();
                    }

                    // Đảm bảo đã có comfy settings/config trước khi override các field
                    if (typeof self._preloadComfySettings === 'function') {
                        try {
                            await self._preloadComfySettings(false);
                        } catch (e) {
                            console.warn('[Album] Failed to preload comfy settings from capability:', e);
                        }
                    }

                    const cached = self.state.cachedComfySettings || { last_config: {}, global_choices: self.state.cachedComfyGlobalChoices || null };
                    const baseConfig = { ...(cached.last_config || {}) };

                    // Map các field capability vào đúng cấu trúc config của Album
                    if (typeof expression === 'string') baseConfig.expression = expression;
                    if (typeof action === 'string') baseConfig.action = action;
                    if (typeof outfits === 'string') baseConfig.outfits = outfits;
                    if (typeof context === 'string') baseConfig.context = context;
                    if (typeof quality === 'string') baseConfig.quality = quality;
                    if (typeof negative === 'string') baseConfig.negative = negative;

                    cached.last_config = baseConfig;
                    self.state.cachedComfySettings = cached;

                    await self._startGeneration(baseConfig);
                    return {
                        status: 'started',
                        character_hash: resolvedHash,
                        used_workflow_type: baseConfig.workflow_type || baseConfig._workflow_type || null,
                    };
                },
            });

            safeRegister({
                id: 'album.open_main_ui',
                pluginId: 'album',
                title: 'Open Album UI',
                description: 'Open the Album plugin main UI (character selection grid).',
                type: 'action',
                tags: ['album', 'ui', 'open'],
                llmCallable: true,
                llmName: 'open_album_ui',
                example: {
                    variants: [
                        {
                            name: 'open grid',
                            payload: {},
                            notes: 'Open the main album character grid.',
                        },
                        {
                            name: 'open by character hash',
                            payload: { character_hash: 'demo_hash_123' },
                            notes: 'Open the album UI directly for the given character hash.',
                        },
                        {
                            name: 'open by character name',
                            payload: { character_name: 'Shiina Mahiru' },
                            notes: 'Open the album UI for the first album matching this character name.',
                        },
                    ],
                    defaultPayload: {},
                    notes: 'Show the main Album character grid UI, or jump directly into a specific character album when character_hash / character_name is provided.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        character_hash: {
                            type: 'string',
                            description: 'Optional character hash to open directly.',
                        },
                        character_name: {
                            type: 'string',
                            description: 'Optional character name to search and open.',
                        },
                    },
                },
                async invoke(args = {}, ctx = {}) {
                    const { character_hash, character_name } = args || {};
                    // Yuuka: always try to open the real Album tab so UI actually changes
                    try {
                        // Prefer the core tab switcher if exposed on window
                        const coreSwitchTab = windowObj.switchTab || (windowObj.Yuuka && windowObj.Yuuka.coreApi && windowObj.Yuuka.coreApi.switchTab);
                        if (typeof coreSwitchTab === 'function') {
                            // Album tab id is usually "album" in the main UI
                            await coreSwitchTab('album');
                        }
                    } catch (e) {
                        console.warn('[Album] Failed to switch main tab to album from capability:', e);
                    }

                    // After switching tab, prefer the active AlbumComponent instance bound by the main UI
                    let self = (this && this.showCharacterSelectionGrid)
                        ? this
                        : (windowObj.Yuuka && windowObj.Yuuka.instances && windowObj.Yuuka.instances.AlbumComponent) || null;

                    if (!self || typeof self.showCharacterSelectionGrid !== 'function') {
                        // Fallback: last attempt to lazily bootstrap if tab switcher didn't create an instance
                        self = resolveAlbumInstance();
                    }

                    if (!self || typeof self.showCharacterSelectionGrid !== 'function') {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance. Try opening the Album tab once.');
                    }

                    // If no character filter is provided, just open the grid as before
                    if (!character_hash && !character_name) {
                        self.state.viewMode = 'grid';
                        self.state.selectedCharacter = null;
                        await self.showCharacterSelectionGrid();
                        return { status: 'opened', viewMode: self.state.viewMode };
                    }

                    // If character_hash is provided, try to open that album directly
                    if (character_hash && typeof character_hash === 'string') {
                        try {
                            if (!self.state.selectedCharacter || self.state.selectedCharacter.hash !== character_hash) {
                                self.state.selectedCharacter = {
                                    hash: character_hash,
                                    name: self.state.selectedCharacter?.name || 'Unknown',
                                };
                            }
                            self.state.viewMode = 'album';
                            await self.loadAndDisplayCharacterAlbum();
                            return { status: 'opened', viewMode: self.state.viewMode, character_hash };
                        } catch (err) {
                            console.warn('[Album] Failed to open album by character_hash in open_main_ui capability:', err);
                            // Fallback to grid if direct open fails
                        }
                    }

                    // If character_name is provided (and hash was missing or failed), try to search via API
                    if (character_name && typeof character_name === 'string') {
                        try {
                            // Use album API to list albums and find best match
                            const albums = await self.api.album.get('/albums');
                            const needle = character_name.toLowerCase().trim();
                            let matched = null;
                            if (Array.isArray(albums)) {
                                matched = albums.find(a => {
                                    const name = (a && a.name) ? String(a.name).toLowerCase() : '';
                                    return name.includes(needle);
                                }) || null;
                            }

                            if (matched && matched.hash) {
                                self.state.selectedCharacter = {
                                    hash: matched.hash,
                                    name: matched.name || character_name,
                                };
                                self.state.viewMode = 'album';
                                await self.loadAndDisplayCharacterAlbum();
                                return {
                                    status: 'opened',
                                    viewMode: self.state.viewMode,
                                    character_hash: matched.hash,
                                    character_name: matched.name || character_name,
                                };
                            }
                        } catch (err) {
                            console.warn('[Album] Failed to open album by character_name in open_main_ui capability:', err);
                            // Fall through to grid
                        }
                    }

                    // Final fallback: open grid
                    self.state.viewMode = 'grid';
                    self.state.selectedCharacter = null;
                    await self.showCharacterSelectionGrid();
                    return { status: 'opened', viewMode: self.state.viewMode };
                },
            });

            safeRegister({
                id: 'image.hires_upscale',
                pluginId: 'album',
                title: 'Hires upscale image',
                description: 'Run high-resolution upscale on an existing album image.',
                type: 'action',
                tags: ['image', 'album', 'hires', 'upscale'],
                llmCallable: true,
                llmName: 'hires_upscale_image',
                example: {
                    variants: [
                        {
                            name: 'upscale image #123',
                            payload: { image_id: '123' },
                            notes: 'Run hires upscale on image id=123 in the current album.',
                        },
                    ],
                    defaultPayload: { image_id: '123' },
                    notes: 'Run high-resolution upscale on an existing album image.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        image_id: {
                            type: 'string',
                            description: 'ID of the image to upscale.',
                        },
                    },
                    required: ['image_id'],
                },
                async invoke(args = {}, ctx = {}) {
                    const { image_id } = args;
                    if (!image_id || typeof image_id !== 'string') {
                        throw new Error('Missing or invalid image_id for image.hires_upscale');
                    }

                    const self = (this && this.state && this._startHiresUpscale)
                        ? this
                        : resolveAlbumInstance();
                    if (!self || !self.state || !Array.isArray(self.state.allImageData) || !self._startHiresUpscale) {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }

                    const item = self.state.allImageData.find(img => String(img.id) === String(image_id));
                    if (!item) {
                        throw new Error(`Image with id ${image_id} not found in current album.`);
                    }

                    await self._startHiresUpscale(item);
                    return { status: 'started', image_id };
                },
            });

            safeRegister({
                id: 'album.open_or_create',
                pluginId: 'album',
                title: 'Open or create album',
                description: 'Open an existing album by hash, or create a new custom album if not found.',
                type: 'action',
                tags: ['album', 'open', 'create'],
                llmCallable: true,
                llmName: 'open_or_create_album',
                example: {
                    variants: [
                        {
                            name: 'open demo album',
                            payload: {
                                character_hash: 'demo_hash_123',
                                name: 'Demo album',
                            },
                            notes: 'Open a demo album (or create it if missing).',
                        },
                        {
                            name: 'create custom album',
                            payload: {
                                character_hash: 'custom_hash_001',
                                name: 'Custom character album',
                            },
                            notes: 'Create a new custom album with a friendly name.',
                        },
                    ],
                    defaultPayload: {
                        character_hash: 'demo_hash_123',
                        name: 'Demo album',
                    },
                    notes: 'Open or create an album with a specific hash.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        character_hash: {
                            type: 'string',
                            description: 'Hash of the album to open or create.',
                        },
                        name: {
                            type: 'string',
                            description: 'Optional display name when creating a new album.',
                        },
                    },
                    required: ['character_hash'],
                },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this.loadAndDisplayCharacterAlbum)
                        ? this
                        : resolveAlbumInstance();
                    const { character_hash, name } = args;
                    if (!self || typeof self.loadAndDisplayCharacterAlbum !== 'function') {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    if (!character_hash || typeof character_hash !== 'string') {
                        throw new Error('Missing or invalid character_hash for album.open_or_create');
                    }

                    self.state.selectedCharacter = {
                        hash: character_hash,
                        name: (typeof name === 'string' && name.trim()) || self.state.selectedCharacter?.name || 'Album mới',
                        isCustom: true,
                    };
                    self.state.viewMode = 'album';
                    self.state.cachedComfyGlobalChoices = null;
                    self.state.cachedComfySettings = null;
                    await self.loadAndDisplayCharacterAlbum();
                    return { status: 'opened', character_hash: character_hash };
                },
            });

            safeRegister({
                id: 'album.open_settings',
                pluginId: 'album',
                title: 'Open album settings',
                description: 'Open the album settings modal for the current character.',
                type: 'action',
                tags: ['album', 'settings', 'ui'],
                llmCallable: true,
                llmName: 'open_album_settings',
                example: {
                    variants: [
                        {
                            name: 'open current album settings',
                            payload: {},
                            notes: 'Open settings for the currently selected album.',
                        },
                    ],
                    defaultPayload: {},
                    notes: 'Open settings for the currently selected album.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {},
                },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this.openSettings)
                        ? this
                        : resolveAlbumInstance();
                    if (!self || typeof self.openSettings !== 'function') {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    await self.openSettings();
                    return { status: 'opened' };
                },
            });

            safeRegister({
                id: 'album.refresh',
                pluginId: 'album',
                title: 'Refresh album view',
                description: 'Refresh the current album images and generation placeholders.',
                type: 'action',
                tags: ['album', 'refresh'],
                llmCallable: false,
                example: {
                    variants: [
                        {
                            name: 'refresh current album',
                            payload: {},
                            notes: 'Refresh album image list and placeholders.',
                        },
                    ],
                    defaultPayload: {},
                    notes: 'Refresh the current album images and generation placeholders.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {},
                },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this._refreshAlbumAndPlaceholders)
                        ? this
                        : resolveAlbumInstance();
                    if (!self || typeof self._refreshAlbumAndPlaceholders !== 'function') {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    await self._refreshAlbumAndPlaceholders();
                    return { status: 'refreshed' };
                },
            });

            safeRegister({
                id: 'album.get_context',
                pluginId: 'album',
                title: 'Get current album context',
                description: 'Retrieve information about the current album selection and images.',
                type: 'query',
                tags: ['album', 'context', 'state'],
                llmCallable: true,
                llmName: 'get_album_context',
                example: {
                    variants: [
                        {
                            name: 'inspect album context',
                            payload: {},
                            notes: 'Inspect current album selection, view mode, and image list.',
                        },
                    ],
                    defaultPayload: {},
                    notes: 'Inspect current album selection, view mode, and image list.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {},
                },
                async invoke(args = {}, ctx = {}) {
                    const albumInstance = windowObj.Yuuka?.instances?.AlbumComponent;
                    const albumState = albumInstance?.state || windowObj.Yuuka?.pluginState?.album;
                    const self = albumInstance && albumState ? albumInstance : { state: albumState };
                    if (!self || !self.state) {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    const selected = self.state.selectedCharacter || null;
                    const images = Array.isArray(self.state.allImageData)
                        ? self.state.allImageData.map(img => {
                            const character_hash = img.character_hash || selected?.hash || null;
                            const character_name = (() => {
                                if (img.character_name) return img.character_name;
                                if (selected && selected.name) return selected.name;
                                return null;
                            })();

                            // Lấy thời gian tạo ảnh từ nhiều nguồn, fallback dần để tránh null
                            const created_at_raw = img.created_at || img.createdAt || img.timestamp || img.created || null;
                            let created_at = null;
                            let created_at_iso = null;
                            if (created_at_raw) {
                                const num = Number(created_at_raw);
                                if (Number.isFinite(num) && num > 0) {
                                    // Nếu là timestamp (giây hoặc mili-giây), chuyển sang ISO8601 để LLM dễ hiểu.
                                    const ms = num < 10_000_000_000 ? num * 1000 : num;
                                    const d = new Date(ms);
                                    if (!Number.isNaN(d.getTime())) {
                                        created_at = d.toISOString();
                                        created_at_iso = created_at;
                                    } else {
                                        created_at = String(created_at_raw);
                                    }
                                } else if (typeof created_at_raw === 'string') {
                                    // Nếu đã là string, trả ra trực tiếp và thử parse để lấy ISO chuẩn nếu được.
                                    created_at = created_at_raw;
                                    const d = new Date(created_at_raw);
                                    if (!Number.isNaN(d.getTime())) {
                                        created_at_iso = d.toISOString();
                                    }
                                } else {
                                    created_at = String(created_at_raw);
                                }
                            }

                            // Thử trích xuất thông tin prompt/config đã dùng để tạo ảnh
                            const genCfg = img.generationConfig || img.generation_config || null;
                            const cfg = genCfg && typeof genCfg === 'object' ? genCfg : {};
                            const prompt_parts = {
                                character: cfg.character || character_name || null,
                                expression: cfg.expression || null,
                                action: cfg.action || null,
                                outfits: cfg.outfits || null,
                                context: cfg.context || null,
                                quality: cfg.quality || null,
                                negative: cfg.negative || cfg.negative_prompt || null,
                            };

                            return {
                                id: img.id,
                                character_hash,
                                character_name,
                                url: img.url || img.pv_url || null,
                                created_at,
                                created_at_iso,
                                created_at_raw,
                                prompt_parts,
                            };
                        })
                        : [];
                    return {
                        viewMode: self.state.viewMode,
                        selectedCharacter: selected,
                        current: selected,
                        imageCount: images.length,
                        images,
                    };
                },
            });

            safeRegister({
                id: 'album.find_context_by_name',
                pluginId: 'album',
                title: 'Find album context by character name',
                description: 'Search albums by character name (flexible matching) and return their context.',
                type: 'query',
                tags: ['album', 'context', 'state', 'search'],
                llmCallable: true,
                llmName: 'find_album_context_by_name',
                example: {
                    variants: [
                        {
                            name: 'search mahiru',
                            payload: { query: 'mahiru' },
                            notes: 'Will match names like "Shiina Mahiru", "shiina_mahiru", etc.',
                        },
                    ],
                    defaultPayload: { query: 'mahiru' },
                    notes: 'Use partial character names to find one or more album contexts.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Character name or partial name, e.g. "Shiina Mahiru", "shiina_mahiru", "mahiru".',
                        },
                        limit: {
                            type: 'number',
                            description: 'Optional maximum number of results to return.',
                        },
                    },
                    required: ['query'],
                },
                async invoke(args = {}, ctx = {}) {
                    const rawQuery = (args.query || '').toString().trim();
                    if (!rawQuery) {
                        throw new Error('Thiếu query để tìm kiếm album.');
                    }

                    const limit = Number.isFinite(args.limit) ? args.limit : 10;

                    // Normalize a name for flexible search: lowercase, remove underscores, collapse spaces
                    const normalizeName = (value) => {
                        const s = (value || '').toString().toLowerCase();
                        return s
                            .replace(/_/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                    };

                    const normQuery = normalizeName(rawQuery);
                    if (!normQuery) {
                        throw new Error('Query sau khi chuẩn hóa bị rỗng.');
                    }

                    // Always fetch full album list so we can search even if UI state is not focused there.
                    const apiRef = (typeof api !== 'undefined') ? api : windowObj.api;
                    if (!apiRef || !apiRef.album || typeof apiRef.album.get !== 'function') {
                        throw new Error('Album API không khả dụng.');
                    }

                    const albums = await apiRef.album.get('/albums').catch(() => []);
                    const candidates = Array.isArray(albums) ? albums : [];

                    const scored = candidates
                        .map((album) => {
                            const name = album?.name || '';
                            const normName = normalizeName(name);
                            const hash = album?.hash || '';
                            const normHash = normalizeName(hash);

                            let score = 0;
                            if (!normName && !normHash) return null;

                            if (normName === normQuery || normHash === normQuery) {
                                score = 100; // Exact normalized match
                            } else if (normName.includes(normQuery) || normHash.includes(normQuery)) {
                                score = 80; // Partial match
                            } else {
                                const parts = normQuery.split(' ');
                                const matchedParts = parts.filter(p => p && (normName.includes(p) || normHash.includes(p)));
                                if (matchedParts.length) {
                                    score = 60 + matchedParts.length * 5;
                                }
                            }

                            if (!score) return null;
                            return { album, score };
                        })
                        .filter(Boolean)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, limit);

                    if (!scored.length) {
                        return { query: rawQuery, results: [], count: 0 };
                    }

                    // Helper to build a context object similar to album.get_context
                    const buildContextForAlbum = async (albumMeta) => {
                        const hash = albumMeta.hash;
                        const name = albumMeta.name;
                        const isCustom = albumMeta.is_custom;

                        let images = [];
                        let viewMode = 'album';

                        try {
                            const albumInstance = windowObj.Yuuka?.instances?.AlbumComponent;
                            const albumState = albumInstance?.state || windowObj.Yuuka?.pluginState?.album;
                            const self = albumInstance && albumState ? albumInstance : null;

                            if (self && self.state && Array.isArray(self.state.allImageData) && self.state.selectedCharacter?.hash === hash) {
                                images = self.state.allImageData;
                                viewMode = self.state.viewMode || 'album';
                            } else {
                                const api2 = (typeof api !== 'undefined') ? api : windowObj.api;
                                if (api2?.images?.getByCharacter) {
                                    images = await api2.images.getByCharacter(hash).catch(() => []);
                                }
                            }
                        } catch (err) {
                            console.warn('[Album] Lỗi khi lấy images cho album:', hash, err);
                        }

                        const selected = {
                            hash,
                            name,
                            isCustom: isCustom,
                        };

                        const safeImages = Array.isArray(images)
                            ? images.map(img => {
                                const character_hash = img.character_hash || hash;
                                const character_name = name;

                                const created_at_raw = img.created_at || img.createdAt || img.timestamp || img.created || null;
                                let created_at = null;
                                let created_at_iso = null;
                                if (created_at_raw) {
                                    const num = Number(created_at_raw);
                                    if (Number.isFinite(num) && num > 0) {
                                        const ms = num < 10_000_000_000 ? num * 1000 : num;
                                        const d = new Date(ms);
                                        if (!Number.isNaN(d.getTime())) {
                                            created_at = d.toISOString();
                                            created_at_iso = created_at;
                                        } else {
                                            created_at = String(created_at_raw);
                                        }
                                    } else if (typeof created_at_raw === 'string') {
                                        created_at = created_at_raw;
                                        const d = new Date(created_at_raw);
                                        if (!Number.isNaN(d.getTime())) {
                                            created_at_iso = d.toISOString();
                                        }
                                    } else {
                                        created_at = String(created_at_raw);
                                    }
                                }

                                const genCfg = img.generationConfig || img.generation_config || null;
                                const cfg = genCfg && typeof genCfg === 'object' ? genCfg : {};
                                const prompt_parts = {
                                    character: cfg.character || character_name || null,
                                    expression: cfg.expression || null,
                                    action: cfg.action || null,
                                    outfits: cfg.outfits || null,
                                    context: cfg.context || null,
                                    quality: cfg.quality || null,
                                    negative: cfg.negative || cfg.negative_prompt || null,
                                };

                                return {
                                    id: img.id,
                                    character_hash,
                                    character_name,
                                    url: img.url || img.pv_url || null,
                                    created_at,
                                    created_at_iso,
                                    created_at_raw,
                                    prompt_parts,
                                };
                            })
                            : [];

                        return {
                            viewMode,
                            selectedCharacter: selected,
                            current: selected,
                            imageCount: safeImages.length,
                            images: safeImages,
                        };
                    };

                    const results = [];
                    for (const item of scored) {
                        const ctxItem = await buildContextForAlbum(item.album);
                        results.push(ctxItem);
                    }

                    return {
                        query: rawQuery,
                        normalizedQuery: normQuery,
                        count: results.length,
                        results,
                    };
                },
            });

            safeRegister({
                id: 'album.open_image',
                pluginId: 'album',
                title: 'Open specific album image',
                description: 'Open a specific album image by id or url in the viewer.',
                type: 'action',
                tags: ['album', 'image', 'viewer', 'open'],
                llmCallable: true,
                llmName: 'open_album_image',
                example: {
                    variants: [
                        {
                            name: 'open by id',
                            payload: { image_id: '123' },
                            notes: 'Open the album image with id=123 in the viewer.',
                        },
                        {
                            name: 'open by url',
                            payload: { image_url: 'http://127.0.0.1:8188/view?image=abc.png' },
                            notes: 'Open an image that matches the given URL in current album.',
                        },
                    ],
                    defaultPayload: { image_id: '123' },
                    notes: 'Open an existing image in the album viewer, looked up by id or url.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        image_id: {
                            type: 'string',
                            description: 'ID of the image to open (preferred).',
                        },
                        image_url: {
                            type: 'string',
                            description: 'Image URL to search for in current album images.',
                        },
                    },
                    anyOf: [
                        { required: ['image_id'] },
                        { required: ['image_url'] },
                    ],
                },
                async invoke(args = {}, ctx = {}) {
                    const { image_id, image_url } = args;
                    // Always prefer the live AlbumComponent instance, or lazily create one
                    let self = windowObj.Yuuka?.instances?.AlbumComponent || null;
                    if (!self || !self.state || typeof self.renderImageViewer !== 'function') {
                        self = resolveAlbumInstance();
                    }

                    if (!self || !self.state || typeof self.renderImageViewer !== 'function') {
                        throw new Error('Album UI is not ready or viewer unavailable.');
                    }

                    // Helper to locate image in a given list
                    const normalize = (v) => String(v || '').trim().replace(/^https?:\/\/[^/]+/, '');
                    const matchInList = (list) => {
                        if (!Array.isArray(list) || !list.length) return null;
                        let target = null;
                        if (image_id) {
                            target = list.find(img => String(img.id) === String(image_id));
                        }
                        if (!target && image_url) {
                            const needleRaw = String(image_url || '').trim();
                            const needle = normalize(needleRaw).replace(/^\//, '');
                            if (!needle) return null;
                            target = list.find(img => {
                                const full = img.url || img.pv_url || img.imageUrl;
                                if (typeof full !== 'string') return false;
                                const norm = normalize(full);
                                if (!norm) return false;
                                if (norm === needle || norm.replace(/^\//, '') === needle) return true;
                                return norm.endsWith(needle);
                            }) || null;
                        }
                        return target || null;
                    };

                    let target = matchInList(self.state.allImageData || []);

                    // If not found in current album, try to search by character via API and open the correct album
                    if (!target) {
                        const apiRef = self.api || (typeof api !== 'undefined' ? api : windowObj.api);
                        if (!apiRef) {
                            throw new Error('Không thể tìm ảnh: API Album/Core chưa sẵn sàng.');
                        }

                        try {
                            // Try core images endpoint to locate the image and its character_hash
                            const token = windowObj.localStorage?.getItem?.('yuuka-auth-token') || '';
                            const res = await windowObj.fetch('/api/core/images', {
                                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                            });
                            if (!res.ok) throw new Error('HTTP ' + res.status);
                            const json = await res.json();
                            const allImages = Array.isArray(json) ? json : [];

                            const found = matchInList(allImages);
                            if (found) {
                                const charHash = found.character_hash || found.generationConfig?.character_hash || found.config?.character_hash || null;
                                if (charHash && typeof self.api?.images?.getByCharacter === 'function') {
                                    self.state.selectedCharacter = self.state.selectedCharacter || { hash: charHash };
                                    self.state.selectedCharacter.hash = charHash;
                                    self.state.viewMode = 'album';
                                    self.state.allImageData = await self.api.images.getByCharacter(charHash);
                                    target = matchInList(self.state.allImageData);
                                } else {
                                    // Nếu không xác định được album, vẫn cho mở trực tiếp từ danh sách allImages
                                    target = found;
                                }
                            }
                        } catch (err) {
                            console.warn('[Album] open_image: failed to search across all images:', err);
                        }
                    }

                    if (!target) {
                        throw new Error('Không tìm thấy ảnh với id/url đã chỉ định trong bất kỳ album nào.');
                    }

                    // Nếu đã sync được album, đảm bảo đang ở viewMode 'album'
                    if (self.state.selectedCharacter?.hash && self.state.viewMode !== 'album') {
                        self.state.viewMode = 'album';
                    }

                    self.renderImageViewer(target);
                    return {
                        status: 'opened',
                        image_id: target.id ?? null,
                        image_url: target.url || target.pv_url || target.imageUrl || null,
                        character_hash: target.character_hash || self.state.selectedCharacter?.hash || null,
                    };
                },
            });

            safeRegister({
                id: 'album.apply_lora',
                pluginId: 'album',
                title: 'Apply LoRA chain',
                description: 'Apply one or more LoRA entries to the current album generation config and optionally start a generation.',
                type: 'action',
                tags: ['album', 'lora', 'settings'],
                llmCallable: true,
                llmName: 'apply_lora_to_album',
                example: {
                    variants: [
                        {
                            name: 'apply style only',
                            payload: {
                                lora_chain: [
                                    { lora_name: 'cute-anime-style', strength_model: 0.8, strength_clip: 0.9 },
                                ],
                                generate: false,
                            },
                            notes: 'Attach a LoRA chain without starting generation.',
                        },
                        {
                            name: 'apply and generate',
                            payload: {
                                lora_chain: [
                                    { lora_name: 'cute-anime-style', strength_model: 0.8, strength_clip: 0.9 },
                                ],
                                generate: true,
                            },
                            notes: 'Apply LoRA chain and immediately start a generation.',
                        },
                    ],
                    defaultPayload: {
                        lora_chain: [
                            { lora_name: 'cute-anime-style', strength_model: 0.8, strength_clip: 0.9 },
                        ],
                        generate: false,
                    },
                    notes: 'Attach a LoRA chain to current album config.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        lora_chain: {
                            type: 'array',
                            description: 'Array of LoRA entries { lora_name, strength_model?, strength_clip? }.',
                            items: {
                                type: 'object',
                                properties: {
                                    lora_name: { type: 'string' },
                                    strength_model: { type: 'number' },
                                    strength_clip: { type: 'number' },
                                },
                                required: ['lora_name'],
                            },
                        },
                        generate: {
                            type: 'boolean',
                            description: 'If true, immediately start a generation with updated config.',
                        },
                    },
                    required: ['lora_chain'],
                },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this._startGeneration)
                        ? this
                        : resolveAlbumInstance();
                    if (!self || typeof self._startGeneration !== 'function') {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    const chain = Array.isArray(args.lora_chain) ? args.lora_chain : [];
                    if (!chain.length) {
                        throw new Error('lora_chain must be a non-empty array.');
                    }
                    const normalized = chain.map(entry => ({
                        lora_name: String(entry.lora_name || '').trim(),
                        strength_model: entry.strength_model,
                        strength_clip: entry.strength_clip,
                    })).filter(e => e.lora_name && e.lora_name.toLowerCase() !== 'none');
                    if (!normalized.length) {
                        throw new Error('No valid LoRA entries after normalization.');
                    }

                    const overrides = { lora_chain: normalized };
                    if (args.generate) {
                        await self._startGeneration(overrides);
                        return { status: 'started', lora_count: normalized.length };
                    }
                    const cached = self.state.cachedComfySettings || { last_config: {}, global_choices: self.state.cachedComfyGlobalChoices || null };
                    cached.last_config = { ...(cached.last_config || {}), ...overrides };
                    self.state.cachedComfySettings = cached;
                    return { status: 'applied', lora_count: normalized.length };
                },
            });

            safeRegister({
                id: 'album.clear_lora',
                pluginId: 'album',
                title: 'Clear LoRA chain',
                description: 'Remove all LoRA from the current album configuration.',
                type: 'action',
                tags: ['album', 'lora', 'clear'],
                llmCallable: true,
                llmName: 'clear_album_lora',
                example: {
                    variants: [
                        {
                            name: 'clear all lora',
                            payload: {},
                            notes: 'Remove all LoRA entries from current album config.',
                        },
                    ],
                    defaultPayload: {},
                    notes: 'Remove all LoRA entries from current album config.',
                },
                paramsSchema: { type: 'object', properties: {} },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this.state)
                        ? this
                        : resolveAlbumInstance();
                    if (!self) {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    const cached = self.state.cachedComfySettings || { last_config: {}, global_choices: self.state.cachedComfyGlobalChoices || null };
                    const cfg = { ...(cached.last_config || {}) };
                    delete cfg.lora_chain;
                    delete cfg.lora_name;
                    delete cfg.lora_names;
                    cached.last_config = cfg;
                    self.state.cachedComfySettings = cached;
                    return { status: 'cleared' };
                },
            });

            safeRegister({
                id: 'album.set_lora_tag_groups',
                pluginId: 'album',
                title: 'Set LoRA tag groups',
                description: 'Replace the multi-LoRA tag groups used for prompts in the current album.',
                type: 'action',
                tags: ['album', 'lora', 'tags'],
                llmCallable: true,
                llmName: 'set_album_lora_tag_groups',
                example: {
                    variants: [
                        {
                            name: 'basic tag groups',
                            payload: {
                                groups: [
                                    ['beautiful lighting', 'masterpiece'],
                                    ['detailed background'],
                                ],
                            },
                            notes: 'Define two simple prompt tag groups.',
                        },
                    ],
                    defaultPayload: {
                        groups: [
                            ['beautiful lighting', 'masterpiece'],
                            ['detailed background'],
                        ],
                    },
                    notes: 'Define prompt tag groups for multi-LoRA workflows.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        groups: {
                            type: 'array',
                            description: 'Array of groups; each group is an array of strings (tokens).',
                            items: {
                                type: 'array',
                                items: { type: 'string' },
                            },
                        },
                    },
                    required: ['groups'],
                },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this.state)
                        ? this
                        : resolveAlbumInstance();
                    if (!self) {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance.');
                    }
                    const groups = Array.isArray(args.groups) ? args.groups.map(g => Array.isArray(g) ? g.map(v => String(v).trim()).filter(Boolean) : []) : [];
                    const filtered = groups.filter(g => g.length > 0);
                    const cached = self.state.cachedComfySettings || { last_config: {}, global_choices: self.state.cachedComfyGlobalChoices || null };
                    const cfg = { ...(cached.last_config || {}) };
                    cfg.multi_lora_prompt_groups = filtered;
                    cfg.multi_lora_prompt_tags = filtered.map(group => `(${group.join(', ')})`).join(', ');
                    cached.last_config = cfg;
                    self.state.cachedComfySettings = cached;
                    return { status: 'updated', group_count: filtered.length };
                },
            });

            safeRegister({
                id: 'album.save_settings',
                pluginId: 'album',
                title: 'Save album settings',
                description: 'Save the current cached album configuration to the backend.',
                type: 'action',
                tags: ['album', 'settings', 'save'],
                llmCallable: true,
                llmName: 'save_album_settings',
                example: {
                    variants: [
                        {
                            name: 'save current config',
                            payload: {},
                            notes: 'Force-save current cached album settings to backend.',
                        },
                    ],
                    defaultPayload: {},
                    notes: 'Force-save current cached album settings to backend.',
                },
                paramsSchema: { type: 'object', properties: {} },
                async invoke(args = {}, ctx = {}) {
                    const self = (this && this.state)
                        ? this
                        : resolveAlbumInstance();
                    if (!self || !self.state || !self.state.selectedCharacter?.hash) {
                        throw new Error('Album capability is not attached to an active AlbumComponent instance or no album is selected.');
                    }
                    const cached = self.state.cachedComfySettings;
                    if (!cached || !cached.last_config) {
                        throw new Error('No cached settings available to save.');
                    }
                    const cfg = { ...(cached.last_config || {}) };
                    const trimmedName = (cfg.character || self.state.selectedCharacter.name || '').trim();
                    if (trimmedName) {
                        cfg.character = trimmedName;
                        self.state.selectedCharacter.name = trimmedName;
                    }
                    await self.api.album.post(`/${self.state.selectedCharacter.hash}/config`, cfg);
                    self.state.cachedComfySettings = {
                        last_config: cfg,
                        global_choices: self.state.cachedComfySettings.global_choices || self.state.cachedComfyGlobalChoices || null,
                    };
                    return { status: 'saved', character_hash: self.state.selectedCharacter.hash };
                },
            });

            // --- Yuuka: Global prompt/statistics helpers ---

            safeRegister({
                id: 'album.get_recent_images',
                pluginId: 'album',
                title: 'Get most recent images',
                description: 'Return the N most recently created images across all albums.',
                type: 'query',
                tags: ['album', 'images', 'recent'],
                llmCallable: true,
                llmName: 'get_recent_images',
                example: {
                    variants: [
                        {
                            name: 'default 10 images',
                            payload: {},
                            notes: 'Get the 10 most recent images.',
                        },
                        {
                            name: 'top 25 images',
                            payload: { limit: 25 },
                            notes: 'Get the 25 most recently generated images.',
                        },
                    ],
                    defaultPayload: { limit: 10 },
                    notes: 'Use this to inspect the most recent images and their metadata (character, prompts, timestamps, etc.).',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        limit: {
                            type: 'number',
                            description: 'Maximum number of recent images to return (default 10).',
                        },
                    },
                },
                async invoke(args = {}, ctx = {}) {
                    const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(100, Math.floor(args.limit))) : 10;

                    // Try to reuse album API if available; otherwise fall back to core images API.
                    const inst = resolveAlbumInstance();
                    const apiRef = inst?.api || (typeof api !== 'undefined' ? api : windowObj.api);
                    if (!apiRef) {
                        throw new Error('Album API is not available to fetch recent images.');
                    }

                    let images = [];
                    try {
                        if (apiRef.images && typeof apiRef.images.getAll === 'function') {
                            images = await apiRef.images.getAll();
                        } else {
                            const token = windowObj.localStorage?.getItem?.('yuuka-auth-token') || '';
                            const res = await windowObj.fetch('/api/core/images', {
                                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                            });
                            if (!res.ok) throw new Error('HTTP ' + res.status);
                            const json = await res.json();
                            images = Array.isArray(json) ? json : [];
                        }
                    } catch (err) {
                        console.warn('[Album] get_recent_images failed to fetch images:', err);
                        throw new Error('Không thể lấy danh sách ảnh gần đây.');
                    }

                    // Normalize and sort by created time descending
                    const normalizeTime = (img) => {
                        const t = img?.created_at || img?.createdAt || img?.timestamp || img?.time;
                        const num = typeof t === 'number' ? t : Date.parse(t || '') || 0;
                        return num;
                    };

                    const normalizeItem = (img) => {
                        const cfg = img?.generationConfig || img?.generation_config || img?.config || {};
                        return {
                            id: img.id,
                            url: img.url || img.imageUrl || img.pv_url || null,
                            preview_url: img.pv_url || img.preview_url || null,
                            character_hash: img.character_hash || cfg.character_hash || cfg.character,
                            character_name: img.character_name || cfg.character_name || cfg.character || null,
                            created_at: normalizeTime(img),
                            prompts: {
                                positive: cfg.prompt || cfg.positive || null,
                                negative: cfg.negative || null,
                                outfits: cfg.outfits || null,
                                expression: cfg.expression || null,
                                action: cfg.action || null,
                                context: cfg.context || null,
                                quality: cfg.quality || null,
                            },
                            raw: img,
                        };
                    };

                    const sorted = images
                        .map((img) => ({ img, t: normalizeTime(img) }))
                        .sort((a, b) => b.t - a.t)
                        .slice(0, limit)
                        .map(({ img }) => normalizeItem(img));

                    return {
                        status: 'ok',
                        limit,
                        count: sorted.length,
                        items: sorted,
                    };
                },
            });

            safeRegister({
                id: 'album.get_most_used_tags',
                pluginId: 'album',
                title: 'Get most used tags',
                description: 'Return the most frequently used tags for outfits, expression, action, and context.',
                type: 'query',
                tags: ['album', 'tags', 'stats'],
                llmCallable: true,
                llmName: 'get_most_used_tags',
                example: {
                    variants: [
                        {
                            name: 'top tags (default)',
                            payload: {},
                            notes: 'Get the top 3 tags per category based on all images.',
                        },
                        {
                            name: 'top 5 tags per category',
                            payload: { per_category: 5 },
                            notes: 'Get the top 5 tags for each of outfits, expression, action, context.',
                        },
                    ],
                    defaultPayload: { per_category: 3 },
                    notes: 'This mirrors the tag analysis used by the Prompt Suggestions feature to build a frequency model.',
                },
                paramsSchema: {
                    type: 'object',
                    properties: {
                        per_category: {
                            type: 'number',
                            description: 'How many top tags to return per category (default 3).',
                        },
                    },
                },
                async invoke(args = {}, ctx = {}) {
                    const perCategory = Number.isFinite(args.per_category)
                        ? Math.max(1, Math.min(20, Math.floor(args.per_category)))
                        : 3;

                    const inst = resolveAlbumInstance();
                    const apiRef = inst?.api || (typeof api !== 'undefined' ? api : windowObj.api);
                    if (!apiRef) {
                        throw new Error('Album API is not available to analyze tags.');
                    }

                    let images = [];
                    try {
                        if (apiRef.images && typeof apiRef.images.getAll === 'function') {
                            images = await apiRef.images.getAll();
                        } else {
                            const token = windowObj.localStorage?.getItem?.('yuuka-auth-token') || '';
                            const res = await windowObj.fetch('/api/core/images', {
                                headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                            });
                            if (!res.ok) throw new Error('HTTP ' + res.status);
                            const json = await res.json();
                            images = Array.isArray(json) ? json : [];
                        }
                    } catch (err) {
                        console.warn('[Album] get_most_used_tags failed to fetch images:', err);
                        throw new Error('Không thể lấy dữ liệu ảnh để phân tích tags.');
                    }

                    const makeMap = () => new Map();
                    const freqs = {
                        outfits: makeMap(),
                        expression: makeMap(),
                        action: makeMap(),
                        context: makeMap(),
                    };

                    const collectText = (value, outMap) => {
                        if (typeof value !== 'string') return;
                        let v = value.replace(/[()]/g, '');
                        v.split(/[\n,]/).map((s) => s.trim()).forEach((tok) => {
                            if (!tok) return;
                            if (tok.length < 2) return;
                            outMap.set(tok, (outMap.get(tok) || 0) + 1);
                        });
                    };

                    images.forEach((img) => {
                        const cfg = img?.generationConfig || img?.generation_config || img?.config;
                        if (!cfg || typeof cfg !== 'object') return;
                        const map = {
                            outfits: cfg.outfits,
                            expression: cfg.expression,
                            action: cfg.action,
                            context: cfg.context,
                        };
                        Object.keys(map).forEach((cat) => {
                            const val = map[cat];
                            const m = freqs[cat];
                            if (!m) return;
                            if (Array.isArray(val)) {
                                val.forEach((vv) => collectText(vv, m));
                            } else {
                                collectText(val, m);
                            }
                        });
                    });

                    const toTopList = (m) => {
                        const items = Array.from(m.entries()).map(([tag, count]) => ({ tag, count }));
                        items.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
                        return items.slice(0, perCategory);
                    };

                    return {
                        status: 'ok',
                        per_category: perCategory,
                        categories: {
                            outfits: toTopList(freqs.outfits),
                            expression: toTopList(freqs.expression),
                            action: toTopList(freqs.action),
                            context: toTopList(freqs.context),
                        },
                    };
                },
            });
        } catch (err) {
            console.warn('[Album] Static capability registration failed:', err);
        }
    })();
}

// Auto-register on script load in non-module environments
if (typeof window !== 'undefined') {
    try {
        registerAlbumCapabilitiesAtLoad(window);
    } catch (e) {
        console.warn('[Album] Failed to auto-register capabilities:', e);
    }
}
