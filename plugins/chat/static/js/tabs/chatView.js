Object.assign(window.ChatComponent.prototype, {
    // --- Chat Session Init ---

    async openChat(charHash) {
        this.state.activeChatCharacterHash = charHash;

        // Clear group mode state and destroy character bar if switching from group chat
        this.state.activeChatGroupId = null;
        this.state.activeChatGroupSession = null;
        this._destroyCharacterBar && this._destroyCharacterBar();

        // Clear any pending actions from previous session
        this.state.pendingActions = [];

        // Restore _handleDockSend to original if it was overridden for group mode
        if (this._originalHandleDockSend) {
            this._handleDockSend = this._originalHandleDockSend;
            this._originalHandleDockSend = null;
        }

        // Restore mood indicator hidden in group mode
        const moodEl = this.container.querySelector('#chat-header-mood');
        if (moodEl) moodEl.style.display = '';

        // Reset inventory tab panels to default state
        const statusTabEl = this.container.querySelector('#status-tab-status');
        const memoryTabEl = this.container.querySelector('#status-tab-memory');
        const scenesTabEl = this.container.querySelector('#status-tab-scenes');
        const albumTabEl = this.container.querySelector('#status-tab-album');
        const inventoryPanel = this.container.querySelector('#modal-inventory');
        if (statusTabEl) statusTabEl.style.display = '';
        if (memoryTabEl) memoryTabEl.style.display = 'none';
        if (scenesTabEl) scenesTabEl.style.display = 'none';
        if (albumTabEl) albumTabEl.style.display = 'none';
        inventoryPanel?.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
        const defaultStatusBtn = inventoryPanel?.querySelector('.status-tab-btn[data-tab="status"]');
        if (defaultStatusBtn) defaultStatusBtn.classList.add('active');

        // Clear stale content from Scenes and Album tabs (will re-render on tab click)
        const scenesList = this.container.querySelector('#active-scenes-list');
        if (scenesList) scenesList.innerHTML = '';
        const albumGrid = this.container.querySelector('#inventory-album-grid');
        if (albumGrid) albumGrid.innerHTML = '';

        const charPersona = this.state.personas.characters[charHash];
        if (!charPersona) {
            alert("Vui lòng tạo persona cho character này trước.");
            return;
        }

        const nameEl = this.container.querySelector('#chat-header-name');
        nameEl.textContent = charPersona.name;
        nameEl.title = charPersona.name;
        this.container.querySelector('#chat-header-avatar').src = charPersona.avatar || `/image/${charHash}`;

        // Restore edit character button visibility (may have been hidden in group mode)
        const editCharBtn = this.container.querySelector('#btn-edit-active-character');
        if (editCharBtn) editCharBtn.style.display = '';
        if (editCharBtn) editCharBtn.onclick = () => {
            this.openCreation('characters', charHash);
        };

        // Hide group edit button when in character chat mode
        const editGroupBtn = this.container.querySelector('#btn-edit-group-chat');
        if (editGroupBtn) editGroupBtn.style.display = 'none';

        // Render single-character member section (avatar + name)
        this._renderSingleCharMemberSection(charHash);

        this.container.querySelector('#btn-chat-inventory').onclick = () => {
            this._syncStatusToUI();
            this._syncMemoryUI();
            const panel = this.container.querySelector('#modal-inventory');
            const chatView = this.container.querySelector('#view-chat');
            if (panel) {
                panel.classList.remove('hidden');
                if (chatView) chatView.classList.add('inventory-open');
            }
        };
        const closeModalBtn = this.container.querySelector('.close-modal-btn[data-modal="modal-inventory"]');
        if (closeModalBtn) {
            closeModalBtn.onclick = () => {
                this.container.querySelector('#modal-inventory').classList.add('hidden');
                const chatView = this.container.querySelector('#view-chat');
                if (chatView) chatView.classList.remove('inventory-open');
            };
        }

        this._initInventoryResize();

        // Tab switching for Status/Memory/Scenes/Album
        inventoryPanel?.querySelectorAll('.status-tab-btn').forEach(btn => {
            // Clone to remove any previous listeners (e.g. from group mode)
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
        });
        inventoryPanel?.querySelectorAll('.status-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                inventoryPanel.querySelectorAll('.status-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                const statusTab = this.container.querySelector('#status-tab-status');
                const memoryTab = this.container.querySelector('#status-tab-memory');
                const scenesTab = this.container.querySelector('#status-tab-scenes');
                const albumTab = this.container.querySelector('#status-tab-album');
                if (statusTab) statusTab.style.display = tab === 'status' ? '' : 'none';
                if (memoryTab) memoryTab.style.display = tab === 'memory' ? '' : 'none';
                if (scenesTab) scenesTab.style.display = tab === 'scenes' ? '' : 'none';
                if (albumTab) albumTab.style.display = tab === 'album' ? '' : 'none';
                // Auto-scale textarea after Memory tab becomes visible
                if (tab === 'memory' && this._autoScaleMemory) {
                    requestAnimationFrame(() => this._autoScaleMemory());
                }
                // Render scenes list when Scenes tab is opened
                if (tab === 'scenes') {
                    this._renderActiveScenesList();
                }
                // Render album grid when Album tab is opened
                if (tab === 'album') {
                    this._renderInventoryAlbumTab();
                }
            });
        });

        // Memory name input — auto-save on edit
        const memNameInput = this.container.querySelector('#memory-name-input');
        if (memNameInput) {
            memNameInput.addEventListener('input', () => {
                if (this.state.activeChatSession) {
                    this.state.activeChatSession.memory_name = memNameInput.value;
                    clearTimeout(this._memoryNameSaveTimeout);
                    this._memoryNameSaveTimeout = setTimeout(() => this._saveCurrentSession(), 800);
                }
            });
        }

        // Memory textarea auto-scale + auto-save
        const memTextarea = this.container.querySelector('#memory-summary-textarea');
        if (memTextarea) {
            this._autoScaleMemory = () => {
                memTextarea.style.height = 'auto';
                memTextarea.style.height = memTextarea.scrollHeight + 'px';
            };
            memTextarea.addEventListener('input', () => {
                this._autoScaleMemory();
                // Auto-save
                if (this.state.activeChatSession) {
                    this.state.activeChatSession.memory_summary = memTextarea.value;
                    clearTimeout(this._memorySaveTimeout);
                    this._memorySaveTimeout = setTimeout(() => this._saveCurrentSession(), 800);
                }
            });
        }

        // Summarize button
        const summarizeBtn = this.container.querySelector('#btn-memory-summarize');
        if (summarizeBtn) {
            summarizeBtn.onclick = () => {
                if (this._memorySummarizeAbort) {
                    // Cancel
                    this._memorySummarizeAbort.abort();
                    this._memorySummarizeAbort = null;
                    summarizeBtn.textContent = 'Summarize';
                    if (memTextarea) memTextarea.readOnly = false;
                } else {
                    this._runMemorySummarize();
                }
            };
        }

        // Save as Scene button
        const saveSceneBtn = this.container.querySelector('#btn-memory-save-scene');
        if (saveSceneBtn) {
            saveSceneBtn.onclick = () => this._saveMemoryAsScene();
        }

        // Clear memory button
        const clearMemBtn = this.container.querySelector('#btn-memory-clear');
        if (clearMemBtn) {
            clearMemBtn.onclick = () => {
                const session = this.state.activeChatSession;
                if (!session) return;
                session.memory_summary = '';
                session.memory_name = '';
                session.last_summarized_index = 0;
                const memTextarea = this.container.querySelector('#memory-summary-textarea');
                const memNameInput = this.container.querySelector('#memory-name-input');
                if (memTextarea) { memTextarea.value = ''; memTextarea.style.height = 'auto'; }
                if (memNameInput) memNameInput.value = '';
                this._saveCurrentSession();
            };
        }

        // Bind scene add button
        const btnAddScene = this.container.querySelector('#btn-add-scene-to-chat');
        if (btnAddScene) {
            btnAddScene.onclick = () => this._showScenePickerForChat();
        }

        try {
            const res = await this.api['chat'].get(`/sessions/${charHash}`);
            const sessions = res.sessions || {};
            const sessionIds = Object.keys(sessions);

            this.switchTab('chat');

            if (sessionIds.length > 0) {
                this.state.activeChatSession = sessions[sessionIds[0]];
                this.state.activeChatSession.scenes = this.state.activeChatSession.scenes || [];
                window.HistoryStateEngine.ensureCharState(this.state.activeChatSession, charHash);
                this._lastRenderedMessageCount = this.state.activeChatSession.messages?.length ?? 0;
                this._syncStatusToUI();
                this.renderMessages();
            } else {
                const newRes = await this.api['chat'].post(`/sessions/${charHash}`, { messages: [] });
                this.state.activeChatSession = newRes.data;
                // Initialize state in character_states[charHash] — source of truth
                const cs = window.HistoryStateEngine.ensureCharState(this.state.activeChatSession, charHash);
                cs.location  = '';
                cs.outfits   = [...(charPersona.default_outfits || [])];
                cs.inventory = [];
                cs.stamina   = this.actionEngine?.getMaxStamina?.() || 100;
                cs.emotion_state = {};
                cs.action_state  = {};
                this.state.activeChatSession.scenes = [];
                this.state.activeChatSession._initial_status = this._captureStatusSnapshot();
                this._saveCurrentSession();
                this._syncStatusToUI();
                this.renderMessages();
            }

            // Force scroll to bottom on initial load
            setTimeout(() => {
                const container = this.container.querySelector('#chat-messages-container');
                if (container) container.scrollTop = container.scrollHeight;
            }, 50);

        } catch (e) {
            console.error(e);
            alert("Lỗi khi tải chat session");
        }
    },

    // --- Scene Management in Chat ---

    async _renderActiveScenesList() {
        const list = this.container.querySelector('#active-scenes-list');
        if (!list) return;
        list.innerHTML = '';

        // Load scenarios if needed
        if (!this.state.scenarios) {
            await this._loadScenarios();
        }

        const session = this.state.activeChatSession;
        if (!session) return;
        const activeIds = session.scenes || [];

        if (activeIds.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding: 12px; color: var(--chat-text-secondary); text-align: center; font-size: 0.9em;';
            empty.textContent = 'No scenes attached to this chat.';
            list.appendChild(empty);
            return;
        }

        activeIds.forEach(sceneId => {
            const scene = this.state.scenarios?.scenes?.[sceneId];
            if (!scene) return;

            const item = document.createElement('div');
            item.className = 'active-scene-item';
            item.innerHTML = `
                <span class="active-scene-name">${this.escapeHTML(scene.name || 'Untitled')}</span>
                <button class="active-scene-remove" title="Remove">
                    <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
                </button>
            `;
            item.querySelector('.active-scene-remove').addEventListener('click', () => {
                const idx = session.scenes.indexOf(sceneId);
                if (idx > -1) {
                    session.scenes.splice(idx, 1);
                    this._saveCurrentSession();
                    this._renderActiveScenesList();
                }
            });
            list.appendChild(item);
        });
    },

    async _showScenePickerForChat() {
        const session = this.state.activeChatSession;
        if (!session) return;
        if ((session.scenes || []).length >= 3) {
            alert('Maximum 3 scenes per chat.');
            return;
        }

        if (!this.state.scenarios) {
            await this._loadScenarios();
        }

        const allScenes = Object.values(this.state.scenarios?.scenes || {});
        const activeIds = session.scenes || [];
        const available = allScenes.filter(s => !activeIds.includes(s.id));

        if (available.length === 0) {
            alert('No scenes available. Create scenes in the Scenario page first.');
            return;
        }

        const modal = this.container.querySelector('#modal-scene-picker');
        const listEl = modal.querySelector('#scene-picker-list');
        const searchInput = modal.querySelector('#scene-picker-search');
        
        listEl.innerHTML = '';
        searchInput.value = '';

        const renderList = (filter = '') => {
            listEl.innerHTML = '';
            const filtered = available.filter(s => (s.name || '').toLowerCase().includes(filter.toLowerCase()));
            
            if (filtered.length === 0) {
                listEl.innerHTML = '<div style="padding: 12px; color: var(--chat-text-secondary); text-align: center;">No matches.</div>';
                return;
            }

            filtered.forEach(s => {
                const item = document.createElement('div');
                item.className = 'active-scene-item';
                item.style.cursor = 'pointer';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.gap = '8px';
                
                // create a mini preview
                const coverStyle = s.cover ? `background-image: url('${s.cover}');` : 'background-color: var(--chat-border);';
                item.innerHTML = `
                    <div style="width: 32px; height: 32px; border-radius: 4px; background-size: cover; background-position: center; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); ${coverStyle}"></div>
                    <span class="active-scene-name" style="flex: 1; font-weight: 500;">${this.escapeHTML(s.name || 'Untitled')}</span>
                `;
                item.addEventListener('hover', () => {
                    item.style.backgroundColor = 'var(--chat-hover-bg)';
                });
                
                item.addEventListener('click', () => {
                    if (!session.scenes) session.scenes = [];
                    session.scenes.push(s.id);
                    this._saveCurrentSession();
                    this._renderActiveScenesList();
                    modal.classList.add('hidden');
                });
                listEl.appendChild(item);
            });
        };

        const closeBtn = modal.querySelector('.close-modal-btn');
        if (closeBtn) {
            closeBtn.onclick = () => modal.classList.add('hidden');
        }

        searchInput.oninput = (e) => renderList(e.target.value);
        renderList();
        
        modal.classList.remove('hidden');
    },

    // --- First Message (Meet Button) ---

    _hasFirstMessage() {
        const session = this.state.activeChatSession;
        if (!session || !session.messages) return false;
        return session.messages.some(m => m.type === 'narrator' && m.narrator_type === 'first_message');
    },

    _hasAnyUserMessages() {
        const session = this.state.activeChatSession;
        if (!session || !session.messages) return false;
        return session.messages.some(m => m.role === 'user' && m.type !== 'narrator');
    },

    async _generateFirstMessage() {
        const session = this.state.activeChatSession;
        if (!session) return;

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};

        // Push empty narrator message (first message belongs to assistant visually)
        session.messages.unshift({
            role: 'assistant',
            type: 'narrator',
            narrator_type: 'first_message',
            snapshots: [''],
            activeIndex: 0
        });

        this._saveCurrentSession();
        this.renderMessages();

        // Stream the first message
        await this._streamNarratorResponse(
            '/scripting/first_message',
            {
                character_name: charObj.name || '',
                character_persona: charObj.persona || '',
                user_name: userObj.name || '',
                user_persona: userObj.persona || '',
                messages: [],
                memory_summary: session.memory_summary || '',
                session_state: {
                    location: session.character_states?.[charHash]?.location || '',
                    outfits: session.character_states?.[charHash]?.outfits || [],
                    inventory: session.character_states?.[charHash]?.inventory || [],
                    action: this._getActiveActionString ? this._getActiveActionString(session.character_states?.[charHash]) : 'Idle'
                },
                scene_ids: session.scenes || [],
                emotion_rules: (this.emotionEngine && this.emotionEngine.rules) ? this.emotionEngine.rules : null,
                action_rules: (this.actionEngine && this.actionEngine.rules) ? this.actionEngine.rules : null,
                model: localStorage.getItem('chat-llm-model') || undefined,
                temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
            },
            0 // target index (first message)
        );

    },

    _removeFirstMessage() {
        const session = this.state.activeChatSession;
        if (!session) return;
        const idx = session.messages.findIndex(m => m.type === 'narrator' && m.narrator_type === 'first_message');
        if (idx > -1) {
            session.messages.splice(idx, 1);
            this._saveCurrentSession();
            this.renderMessages();
        }
    },

    _initInventoryResize() {
        const STORAGE_KEY = 'chat-inventory-panel-width';
        const MIN_W = 240;
        const MAX_W = 560;

        const panel = this.container.querySelector('#modal-inventory');
        const handle = this.container.querySelector('#inventory-resize-handle');
        if (!panel || !handle || this._inventoryResizeInited) return;
        this._inventoryResizeInited = true;

        // Restore saved width
        const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        if (saved && saved >= MIN_W && saved <= MAX_W) {
            this._setInventoryWidth(saved);
        }

        let startX, startW;

        const onMove = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const delta = startX - clientX;
            const newW = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
            this._setInventoryWidth(newW);
        };

        const onUp = (e) => {
            handle.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            // Save
            const w = parseInt(panel.style.getPropertyValue('--inventory-panel-width') ||
                getComputedStyle(panel).width, 10);
            if (w) localStorage.setItem(STORAGE_KEY, w);
        };

        handle.addEventListener('mousedown', (e) => {
            if (window.innerWidth <= 540) return;
            e.preventDefault();
            startX = e.clientX;
            startW = panel.getBoundingClientRect().width;
            handle.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'ew-resize';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        handle.addEventListener('touchstart', (e) => {
            if (window.innerWidth <= 540) return;
            startX = e.touches[0].clientX;
            startW = panel.getBoundingClientRect().width;
            handle.classList.add('dragging');
            document.addEventListener('touchmove', onMove, { passive: true });
            document.addEventListener('touchend', onUp);
        }, { passive: true });
    },

    _setInventoryWidth(w) {
        const panel = this.container.querySelector('#modal-inventory');
        const chatApp = this.container.querySelector('#chat-app');
        if (!panel || !chatApp) return;
        panel.style.width = w + 'px';
        // Keep margin-right in sync via CSS variable on the app container
        chatApp.style.setProperty('--inventory-panel-width', w + 'px');
    },

    /**
     * Renders #inventory-member-section for single-character mode.
     * Shows a single avatar button (always active) with the character's name.
     * Clicking it is a no-op since there's only one character.
     */
    _renderSingleCharMemberSection(charHash) {
        const memberSection = this.container.querySelector('#inventory-member-section');
        if (!memberSection) return;

        memberSection.innerHTML = '';

        const persona = this.state.personas?.characters?.[charHash];
        if (!persona) return;

        const btn = document.createElement('button');
        btn.title = persona.name || charHash;
        btn.style.cssText = [
            'width:40px',
            'height:40px',
            'border-radius:50%',
            'border:2px solid var(--accent,#7c6af7)',
            'cursor:default',
            'background-color:var(--chat-bg-secondary,#2a2a2a)',
            'background-size:cover',
            'background-position:center',
            'overflow:hidden',
            'flex-shrink:0',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:0',
            'box-shadow:0 0 0 2px var(--accent,#7c6af7)',
        ].join(';');

        const avatarSrc = persona.avatar || `/image/${charHash}`;
        btn.style.backgroundImage = `url('${avatarSrc}')`;
        btn.innerHTML = '';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = persona.name || '';
        nameSpan.style.cssText = 'font-size:0.9em;font-weight:600;color:var(--chat-text);';

        memberSection.appendChild(btn);
        memberSection.appendChild(nameSpan);
    },

    _renderInventoryAlbumTab() {
        const session = this.state.activeChatSession;
        const grid = this.container.querySelector('#inventory-album-grid');
        if (!grid) return;
        grid.innerHTML = '';

        if (!session || !session.messages) {
            grid.innerHTML = '<p class="inventory-hint" style="padding: 0.5rem;">No images yet.</p>';
            return;
        }

        // Collect all images from active snapshots, newest message first
        const allItems = [];
        for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            if (msg.role === 'system') continue;
            const images = this.getMessageImages(msg) || [];
            images.forEach(urlObj => {
                const url = typeof urlObj === 'string' ? urlObj : urlObj.url;
                if (!url) return;
                const isVideo = /\.(mp4|webm|mov)$/i.test(url);
                let item = typeof urlObj === 'object' ? { ...urlObj } : {};
                // Enrich from Album if available
                if (!item.generationConfig && window.Yuuka?.instances?.AlbumComponent) {
                    const albumData = window.Yuuka.instances.AlbumComponent.state.allImageData || [];
                    const found = albumData.find(a => a.url === url || a.imageUrl === url);
                    if (found) item = { ...item, ...found };
                }
                allItems.push({ ...item, imageUrl: url, originalUrl: url, is_video: isVideo, msgIndex: i });
            });
        }

        if (allItems.length === 0) {
            grid.innerHTML = '<p class="inventory-hint" style="padding: 0.5rem;">No images in this chat yet.</p>';
            return;
        }

        allItems.forEach((item, idx) => {
            const cell = document.createElement('div');
            cell.className = 'inventory-album-cell';

            if (item.is_video) {
                const posterSrc = item.pv_url || '';
                const videoSrc = item.imageUrl;
                cell.innerHTML = `<video src="${videoSrc}#t=0.001" poster="${posterSrc}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>
                    <span class="inventory-album-video-badge material-symbols-outlined">play_circle</span>`;
            } else {
                const pvUrl = item.pv_url || item.imageUrl;
                cell.innerHTML = `<img src="${pvUrl}" loading="lazy" alt="">`;
            }

            cell.addEventListener('click', () => {
                if (!window.Yuuka?.plugins?.simpleViewer) return;
                window.Yuuka.plugins.simpleViewer.open({
                    items: allItems,
                    startIndex: idx,
                    renderInfoPanel: (it) => {
                        if (window.Yuuka?.viewerHelpers?.buildInfoPanel) {
                            try { return window.Yuuka.viewerHelpers.buildInfoPanel(it); } catch (e) {}
                        }
                        if (window.Yuuka?.instances?.AlbumComponent?._viewerRenderInfoPanel) {
                            return window.Yuuka.instances.AlbumComponent._viewerRenderInfoPanel(it);
                        }
                        const filename = (it.originalUrl || '').split('/').pop() || 'image';
                        return `<div class="info-row"><strong>File:</strong> <span>${filename}</span></div>`;
                    },
                    actionButtons: [
                        {
                            icon: 'photo_album',
                            title: 'Open in Album',
                            onClick: (it, closeFn) => {
                                const charHash = this.state.activeChatCharacterHash;
                                if (!charHash) return;
                                closeFn();
                                this._closeChatDock();
                                const charPersona = this.state.personas.characters[charHash];
                                window.Yuuka.initialPluginState = window.Yuuka.initialPluginState || {};
                                window.Yuuka.initialPluginState.album = {
                                    character: { hash: charHash, name: charPersona?.name || '' },
                                    viewMode: 'album',
                                };
                                if (window.Yuuka?.ui?.switchTab) window.Yuuka.ui.switchTab('album');
                            }
                        }
                    ]
                });
            });

            grid.appendChild(cell);
        });
    },
});
