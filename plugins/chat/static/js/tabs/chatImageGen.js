Object.assign(window.ChatComponent.prototype, {
    // --- Auto Image Generation & Event Handling ---

    /**
     * Resolve a list of item names to booru tags for image generation.
     * Looks up _giftItemsCache by name; falls back to [name] if not found
     * (handles default_outfits raw tags which have no item record).
     * @param {string[]} names
     * @returns {string[]} flat array of tags
     */
    _resolveOutfitTags(names) {
        const cache = this._giftItemsCache || [];
        const tags = [];
        names.forEach(name => {
            const item = cache.find(i => (i.name || i.label) === name);
            if (item && item.tags && item.tags.length > 0) {
                item.tags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
            } else {
                if (!tags.includes(name)) tags.push(name);
            }
        });
        return tags;
    },

    async _autoGenerateImageForMessage(charObj, targetIndex, overrideContext = null, overrideStatus = null) {
        if (!window.Yuuka?.services?.capabilities) return;
        try {
            const caps = window.Yuuka.services.capabilities;
            const charHash = this.state.activeChatCharacterHash;

            // Fetch album config via backend-only capability (no Album UI instance needed)
            let comfyInfo;
            try {
                comfyInfo = await caps.invoke('album.get_comfyui_info', {
                    character_hash: charHash,
                    no_choices: true
                });
            } catch (e) {
                console.warn('[Chat] Cannot fetch album config, skipping auto image generation:', e.message);
                return;
            }

            const baseConfig = { ...(comfyInfo?.last_config || {}) };

            const useQuality = this.container.querySelector('#chat-image-gen-use-quality')?.checked !== false;
            const useNegative = this.container.querySelector('#chat-image-gen-use-negative')?.checked !== false;
            const nonOutfits = this.container.querySelector('#chat-image-gen-non-outfits')?.value || '';

            const session = this.state.activeChatSession;

            // Use overrideStatus for emotion/action/stamina if provided (e.g. pre-stamina-exhaustion state)
            const emotionState = overrideStatus ? overrideStatus.emotion_state : session.emotion_state;
            const actionState = overrideStatus ? overrideStatus.action_state : session.action_state;
            const stamina = overrideStatus ? overrideStatus.stamina : session.stamina;
            const outfits = overrideStatus ? overrideStatus.outfits : session.outfits;
            const location = overrideStatus ? overrideStatus.location : session.location;

            let currentOutfits = this._resolveOutfitTags(outfits).join(', ');

            // Merge appearance into outfits for generation
            if (charObj && charObj.appearance && charObj.appearance.length > 0) {
                const appearanceStr = charObj.appearance.join(', ').trim();
                currentOutfits = currentOutfits ? appearanceStr + ', ' + currentOutfits : appearanceStr;
            }

            if (!currentOutfits) currentOutfits = nonOutfits;

            let dynamicContext = overrideContext !== null ? overrideContext : (location || '');
            let dynamicExpression = '';
            let dynamicAction = '';

            // Inject Emotion Engine booru mapping as expression
            if (this.emotionEngine && emotionState) {
                const eTags = this.emotionEngine.getTags(emotionState);
                if (eTags.length > 0) {
                    dynamicExpression = eTags.join(', ');
                }
            }

            // Inject Action Engine booru tags
            if (this.actionEngine && actionState) {
                const aTags = this.actionEngine.getTags(actionState, stamina);
                if (aTags.length > 0) {
                    dynamicAction = aTags.join(', ');
                }
            }

            const ckptName = this.container.querySelector('#chat-image-gen-ckpt_name')?.value || '';

            // Override config with chat-specific values
            baseConfig.character = charObj.name || '';
            baseConfig.outfits = currentOutfits;
            if (dynamicContext) baseConfig.context = dynamicContext;

            if (dynamicExpression) {
                baseConfig.expression = dynamicExpression;
            } else {
                baseConfig.expression = ' ';
            }

            if (dynamicAction) {
                baseConfig.action = dynamicAction;
            } else {
                baseConfig.action = ' ';
            }

            if (ckptName) baseConfig.ckpt_name = ckptName;
            if (!useQuality) baseConfig.quality = ' ';
            if (!useNegative) baseConfig.negative = ' ';

            // Strip alpha hints — chat generation should never use alpha workflow
            try {
                ['Alpha', 'alpha', 'is_alpha', 'isAlpha', 'use_alpha', 'useAlpha'].forEach(k => {
                    try { delete baseConfig[k]; } catch { }
                });
                const wt = String(baseConfig.workflow_type || baseConfig._workflow_type || '').trim().toLowerCase();
                if (wt && wt.includes('alpha')) {
                    baseConfig.workflow_type = 'standard';
                    try { delete baseConfig._workflow_type; } catch { }
                }
            } catch { }

            // Push to pending queue — supports multiple concurrent requests (e.g. follow-up chains)
            if (!this.state.pendingImageGenerations) this.state.pendingImageGenerations = [];
            this.state.pendingImageGenerations.push({
                sessionId: session.id,
                messageIndex: targetIndex,
                time: Date.now()
            });

            // Call the core generation API directly (no Album UI instance needed)
            await api.generation.start(charHash, baseConfig);
        } catch (e) {
            console.warn('[Chat] Auto image generation failed to start:', e);
        }
    },

    /**
     * Group-mode image generation. Mirrors _autoGenerateImageForMessage but reads
     * state from groupSession.character_states[charHash] instead of activeChatSession.
     *
     * @param {string} charHash - The character hash to generate for
     * @param {number} targetIndex - The message index to attach the image to
     * @param {object|null} overrideStatus - Pre-exhaustion snapshot (from _statusForImageGen[charHash])
     */
    async _autoGenerateGroupImage(charHash, targetIndex, overrideStatus = null) {
        if (!window.Yuuka?.services?.capabilities) return;
        try {
            const caps = window.Yuuka.services.capabilities;
            const groupSession = this.state.activeChatGroupSession;
            if (!groupSession) return;

            const charState = groupSession.character_states?.[charHash];
            if (!charState) {
                console.warn('[Chat] _autoGenerateGroupImage: character_states missing for', charHash);
                return;
            }

            // Fetch album config via backend-only capability
            let comfyInfo;
            try {
                comfyInfo = await caps.invoke('album.get_comfyui_info', {
                    character_hash: charHash,
                    no_choices: true
                });
            } catch (e) {
                console.warn('[Chat] Cannot fetch album config for group image gen, skipping:', e.message);
                return;
            }

            const baseConfig = { ...(comfyInfo?.last_config || {}) };

            const useQuality = this.container.querySelector('#chat-image-gen-use-quality')?.checked !== false;
            const useNegative = this.container.querySelector('#chat-image-gen-use-negative')?.checked !== false;
            const nonOutfits = this.container.querySelector('#chat-image-gen-non-outfits')?.value || '';

            // Use overrideStatus if provided (pre-exhaustion snapshot), otherwise use live character state
            const emotionState = overrideStatus ? overrideStatus.emotion_state : charState.emotion_state;
            const actionState = overrideStatus ? overrideStatus.action_state : charState.action_state;
            const stamina = overrideStatus ? overrideStatus.stamina : charState.stamina;
            const outfits = overrideStatus ? overrideStatus.outfits : charState.outfits;
            const location = groupSession.location || '';

            // Resolve persona for character name and appearance
            const persona = this.state.personas?.characters?.[charHash] || {};

            let currentOutfits = this._resolveOutfitTags(outfits || []).join(', ');

            // Merge appearance into outfits for generation
            if (persona.appearance && persona.appearance.length > 0) {
                const appearanceStr = persona.appearance.join(', ').trim();
                currentOutfits = currentOutfits ? appearanceStr + ', ' + currentOutfits : appearanceStr;
            }

            if (!currentOutfits) currentOutfits = nonOutfits;

            let dynamicContext = location;
            let dynamicExpression = '';
            let dynamicAction = '';

            // Inject Emotion Engine booru mapping as expression
            if (this.emotionEngine && emotionState) {
                const eTags = this.emotionEngine.getTags(emotionState);
                if (eTags.length > 0) {
                    dynamicExpression = eTags.join(', ');
                }
            }

            // Inject Action Engine booru tags
            if (this.actionEngine && actionState) {
                const aTags = this.actionEngine.getTags(actionState, stamina);
                if (aTags.length > 0) {
                    dynamicAction = aTags.join(', ');
                }
            }

            const ckptName = this.container.querySelector('#chat-image-gen-ckpt_name')?.value || '';

            // Override config with group-chat-specific values
            baseConfig.character = persona.name || '';
            baseConfig.outfits = currentOutfits;
            if (dynamicContext) baseConfig.context = dynamicContext;

            if (dynamicExpression) {
                baseConfig.expression = dynamicExpression;
            } else {
                baseConfig.expression = ' ';
            }

            if (dynamicAction) {
                baseConfig.action = dynamicAction;
            } else {
                baseConfig.action = ' ';
            }

            if (ckptName) baseConfig.ckpt_name = ckptName;
            if (!useQuality) baseConfig.quality = ' ';
            if (!useNegative) baseConfig.negative = ' ';

            // Strip alpha hints
            try {
                ['Alpha', 'alpha', 'is_alpha', 'isAlpha', 'use_alpha', 'useAlpha'].forEach(k => {
                    try { delete baseConfig[k]; } catch { }
                });
                const wt = String(baseConfig.workflow_type || baseConfig._workflow_type || '').trim().toLowerCase();
                if (wt && wt.includes('alpha')) {
                    baseConfig.workflow_type = 'standard';
                    try { delete baseConfig._workflow_type; } catch { }
                }
            } catch { }

            // Push to pending queue — supports multiple concurrent requests (e.g. follow-up chains)
            if (!this.state.pendingImageGenerations) this.state.pendingImageGenerations = [];
            this.state.pendingImageGenerations.push({
                sessionId: groupSession.id,
                messageIndex: targetIndex,
                characterHash: charHash,
                time: Date.now()
            });

            await api.generation.start(charHash, baseConfig);
        } catch (e) {
            console.warn('[Chat] Group auto image generation failed to start:', e);
        }
    },

    handleImageGeneratedEvent(data) {
        if (!this.state.pendingImageGenerations || !this.state.pendingImageGenerations.length) return;

        const now = Date.now();
        // Find the oldest matching pending entry (FIFO)
        const queue = this.state.pendingImageGenerations;

        // Remove expired entries (> 5 minutes)
        this.state.pendingImageGenerations = queue.filter(p => now - p.time <= 5 * 60 * 1000);

        if (!this.state.pendingImageGenerations.length) return;

        // Pop the oldest entry
        const pending = this.state.pendingImageGenerations.shift();

        // --- Group mode path ---
        if (this.state.activeChatGroupId) {
            const groupSession = this.state.activeChatGroupSession;
            if (!groupSession || groupSession.id !== pending.sessionId) return;

            const charHash = pending.characterHash;
            if (!charHash || !groupSession.character_states?.[charHash]) return;

            const msgIndex = pending.messageIndex;
            if (msgIndex < 0 || msgIndex >= groupSession.messages.length) return;

            const targetMsg = this.migrateMessage(groupSession.messages[msgIndex]);
            const snap = targetMsg.snapshots[targetMsg.activeIndex];

            if (data.image_data && data.image_data.url) {
                if (!snap[1]) snap[1] = [];
                const existingIdx = snap[1].findIndex(item => (typeof item === 'string' ? item : item.url) === data.image_data.url);
                if (existingIdx === -1) {
                    snap[1].push(data.image_data);
                    groupSession.messages[msgIndex] = targetMsg;
                    this._saveGroupSession();
                    if (this.state.currentTab === 'chat') {
                        if (this.state._groupStreamingActive) {
                            // Another character is streaming — inject image directly to avoid
                            // destroying the active streaming bubble via renderMessages().
                            this._injectImageIntoBubble(msgIndex, data.image_data);
                        } else {
                            this.renderMessages();
                        }
                    }
                }
            }
            return;
        }

        // --- Single-character mode path ---
        const session = this.state.activeChatSession;
        if (!session || session.id !== pending.sessionId) return;

        const msgIndex = pending.messageIndex;
        if (msgIndex < 0 || msgIndex >= session.messages.length) return;

        const targetMsg = this.migrateMessage(session.messages[msgIndex]);
        const snap = targetMsg.snapshots[targetMsg.activeIndex];

        if (data.image_data && data.image_data.url) {
            if (!snap[1]) snap[1] = [];
            const existingIdx = snap[1].findIndex(item => (typeof item === 'string' ? item : item.url) === data.image_data.url);
            if (existingIdx === -1) {
                snap[1].push(data.image_data);
                session.messages[msgIndex] = targetMsg;
                this._saveCurrentSession();
                if (this.state.currentTab === 'chat') this.renderMessages();
            }
        }
    },

    /**
     * Inject an image directly into an existing bubble's media container without
     * calling renderMessages(). Used when another character is actively streaming
     * so we don't destroy the streaming bubble.
     *
     * @param {number} msgIndex - The message index whose bubble to update
     * @param {object} imageData - The image data object with a .url property
     */
    _injectImageIntoBubble(msgIndex, imageData) {
        if (!imageData || !imageData.url) return;
        const url = imageData.url;

        const wrapper = this.container.querySelector(
            `.chat-bubble-wrapper[data-msg-index="${msgIndex}"], .narrator-bubble-wrapper[data-msg-index="${msgIndex}"]`
        );
        if (!wrapper) return;

        // Find or create the media container inside the bubble
        let mediaContainer = wrapper.querySelector('.chat-media-container');
        if (!mediaContainer) {
            mediaContainer = document.createElement('div');
            mediaContainer.className = 'chat-media-container';
            const bubble = wrapper.querySelector('.chat-bubble') || wrapper.querySelector('.narrator-bubble');
            if (bubble) bubble.appendChild(mediaContainer);
            else return;
        }

        // Don't add duplicates
        const existing = mediaContainer.querySelector(`img[src="${CSS.escape(url)}"], video[src="${CSS.escape(url)}"]`);
        if (existing) return;

        const isVideo = url.match(/\.(mp4|webm|mov)$/i);
        const mediaEl = document.createElement(isVideo ? 'video' : 'img');
        mediaEl.className = 'chat-embedded-media';
        mediaEl.src = url;
        if (isVideo) {
            mediaEl.autoplay = true;
            mediaEl.loop = true;
            mediaEl.muted = true;
            mediaEl.setAttribute('playsinline', '');
        }
        mediaContainer.appendChild(mediaEl);
    }
});

