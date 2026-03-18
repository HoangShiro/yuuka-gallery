Object.assign(window.ChatComponent.prototype, {
    // --- Message Rendering & Media Viewer ---

    renderMessages() {
        if (!this.state.activeChatSession) return;
        // If a group stream is actively writing to a bubble, skip full re-render to avoid
        // destroying the streaming bubble. The stream loop updates the DOM directly.
        if (this.state._groupStreamingActive) {
            this._syncStatusToUI();
            return;
        }

        // Sync character_states from the active snapshot of the last assistant message.
        // This ensures live state UI (header mood, inventory) always reflects the currently
        // active snapshot, not just the last streamed state.
        this._syncLiveStateFromHistory();

        this._syncStatusToUI();
        const container = this.container.querySelector('#chat-messages-container');

        // Track how many messages were rendered last time so we can suppress
        // animation on elements that already existed (re-renders due to BG change, etc.)
        const messages = this.state.activeChatSession.messages || [];
        const prevCount = this._lastRenderedMessageCount ?? -1;
        // If message count decreased (delete/rewind), treat all remaining as existing
        this._lastRenderedMessageCount = messages.length;

        container.innerHTML = '';
        container.onclick = (e) => {
            const inBubble = e.target.closest('.chat-bubble') || e.target.closest('.narrator-bubble');
            const inActions = e.target.closest('.msg-actions');

            if (!inBubble && !inActions) {
                this.state.activeActionIndex = null;
                const activeWrappers = container.querySelectorAll('.show-actions');
                activeWrappers.forEach(w => w.classList.remove('show-actions'));

                const viewMode = localStorage.getItem('chat-image-gen-view-mode') || 'bubble';
                if (viewMode !== 'bubble') {
                    const bgImg = this.container.querySelector('.chat-view-bg-image.active-bg');
                    if (bgImg) bgImg.click();
                }
            }
        };

        const charPersona = this.state.personas.characters[this.state.activeChatCharacterHash] || {};
        const charAvatar = charPersona.avatar || '';
        const isGroupMode = !!this.state.activeChatGroupId;

        // Meet button — show if no first message and no user messages (only in single-character mode)
        if (!isGroupMode && !this._hasFirstMessage() && !this._hasAnyUserMessages()) {
            const meetBtn = document.createElement('div');
            meetBtn.className = 'meet-character-btn';
            meetBtn.innerHTML = `
                <span class="material-symbols-outlined">waving_hand</span>
                <span>Meet ${this.escapeHTML(charPersona.name || 'Character')}</span>
            `;
            meetBtn.addEventListener('click', () => this._generateFirstMessage());
            container.appendChild(meetBtn);
        }

        // Group meet button — show when group chat has no messages yet
        if (isGroupMode && this._isGroupEmpty && this._isGroupEmpty()) {
            const groupSession = this.state.activeChatGroupSession;
            const memberNames = (groupSession?.member_hashes || [])
                .map(h => this.state.personas?.characters?.[h]?.name)
                .filter(Boolean);
            const label = memberNames.length > 0
                ? memberNames.join(', ')
                : 'the group';
            const meetBtn = document.createElement('div');
            meetBtn.className = 'meet-character-btn';
            meetBtn.innerHTML = `
                <span class="material-symbols-outlined">waving_hand</span>
                <span>Meet ${this.escapeHTML(label)}</span>
            `;
            meetBtn.addEventListener('click', () => this._generateGroupFirstMessage && this._generateGroupFirstMessage());
            container.appendChild(meetBtn);
        }

        messages.forEach((rawMsg, index) => {
            const msg = this.migrateMessage(rawMsg);
            if (!rawMsg.snapshots) {
                this.state.activeChatSession.messages[index] = msg;
            }

            if (msg.role === 'system' && msg.type !== 'system_action' && msg.type !== 'narrator') return;

            // Messages that existed in the previous render should not re-animate
            const isExistingMessage = index < prevCount;

            // Render system action cards (legacy backward compat — new data uses snapshot[3])
            if (msg.type === 'system_action') {
                // Skip: action context is now embedded in snapshot[3] of the adjacent message
                // Old system_action messages are silently skipped for clean rendering
                return;
            }

            const mediaUrls = this.getMessageImages(msg) || [];
            let mediaHtml = '';
            const allMediaItems = [];
            const viewMode = localStorage.getItem('chat-image-gen-view-mode') || 'bubble';
            if (mediaUrls.length > 0 && viewMode !== 'bg') {
                mediaHtml = '<div class="chat-media-container">';
                mediaUrls.forEach((urlObj) => {
                    const url = typeof urlObj === 'string' ? urlObj : urlObj.url;
                    if (!url) return;
                    const isVideo = url.match(/\.(mp4|webm|mov)$/i);

                    let fullItem = typeof urlObj === 'object' ? urlObj : {};
                    if ((!fullItem || !fullItem.generationConfig) && window.Yuuka?.instances?.AlbumComponent) {
                        const albumItems = window.Yuuka.instances.AlbumComponent.state.allImageData || [];
                        const found = albumItems.find(i => i.url === url || i.imageUrl === url);
                        if (found) {
                            fullItem = { ...fullItem, ...found };
                        }
                    }

                    allMediaItems.push({ ...fullItem, imageUrl: url, is_video: !!isVideo, originalUrl: url });

                    if (isVideo) {
                        mediaHtml += `<video class="chat-embedded-media" src="${url}" data-media-index="${allMediaItems.length - 1}" autoplay loop muted playsinline></video>`;
                    } else {
                        mediaHtml += `<img class="chat-embedded-media" src="${url}" data-media-index="${allMediaItems.length - 1}" />`;
                    }
                });
                mediaHtml += '</div>';
            }

            // Render narrator bubbles (first message, random events)
            if (msg.type === 'narrator') {
                const content = this.getMessageContent(msg);
                const card = document.createElement('div');
                card.className = 'narrator-bubble-wrapper' + (isExistingMessage ? ' no-anim' : '');
                card.dataset.msgIndex = index;

                card.innerHTML = `
                    <div class="narrator-bubble">
                        <div class="narrator-icon">
                            <span class="material-symbols-outlined">auto_stories</span>
                        </div>
                        <div class="narrator-content">${this.formatMessageContent(content)}</div>
                        ${mediaHtml}
                        <div class="narrator-actions msg-actions">
                            <button class="narrator-action-btn msg-action-btn" data-action="regen" title="Regenerate">
                                <span class="material-symbols-outlined">refresh</span>
                            </button>
                            <button class="narrator-action-btn msg-action-btn" data-action="edit" title="Edit">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                            <button class="narrator-action-btn msg-action-btn" data-action="remove" title="Remove">
                                <span class="material-symbols-outlined">delete</span>
                            </button>
                        </div>
                    </div>
                `;

                // Action handlers
                card.querySelector('[data-action="remove"]').addEventListener('click', () => {
                    if (msg.narrator_type === 'first_message') {
                        this._removeFirstMessage();
                    } else if (msg.narrator_type === 'group_random_event') {
                        // Restore member_hashes_before if a character was added by this event
                        const groupSession = this.state.activeChatGroupSession;
                        if (groupSession && msg.member_hashes_before) {
                            const removedHashes = (groupSession.member_hashes || []).filter(
                                h => !msg.member_hashes_before.includes(h)
                            );
                            groupSession.member_hashes = [...msg.member_hashes_before];
                            removedHashes.forEach(h => {
                                if (groupSession.character_states) delete groupSession.character_states[h];
                            });
                            this._renderCharacterBar && this._renderCharacterBar(groupSession);
                        }
                        this.state.activeChatSession.messages.splice(index, 1);
                        this._saveGroupSession ? this._saveGroupSession().then(() => this.renderMessages()) : (this._saveCurrentSession(), this.renderMessages());
                    } else {
                        this.state.activeChatSession.messages.splice(index, 1);
                        this._saveCurrentSession();
                        this.renderMessages();
                    }
                });

                card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.state.activeActionIndex = index;
                    this._startInlineEdit(card, index, msg);
                });

                card.querySelector('[data-action="regen"]').addEventListener('click', async () => {
                    if (msg.narrator_type === 'first_message') {
                        // Regen first message
                        const newIdx = msg.snapshots.length;
                        msg.snapshots.push('');
                        msg.activeIndex = newIdx;
                        this._saveCurrentSession();
                        this.renderMessages();

                        const charHash = this.state.activeChatCharacterHash;
                        const charObj = this.state.personas.characters[charHash] || {};
                        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};
                        const session = this.state.activeChatSession;

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
                                    inventory: session.character_states?.[charHash]?.inventory || []
                                },
                                scene_ids: session.scenes || [],
                                model: localStorage.getItem('chat-llm-model') || undefined
                            },
                            index
                        );
                    } else if (msg.narrator_type === 'random_event') {
                        // Regen random event
                        const newIdx = msg.snapshots.length;
                        msg.snapshots.push('');
                        msg.activeIndex = newIdx;
                        this._saveCurrentSession();
                        this.renderMessages();
                        await this._executeRandomEventAtIndex(index);
                    } else if (msg.narrator_type === 'group_random_event') {
                        // Regen group random event — restore member_hashes_before first
                        const groupSession = this.state.activeChatGroupSession;
                        if (groupSession && msg.member_hashes_before) {
                            const removedHashes = (groupSession.member_hashes || []).filter(
                                h => !msg.member_hashes_before.includes(h)
                            );
                            groupSession.member_hashes = [...msg.member_hashes_before];
                            removedHashes.forEach(h => {
                                if (groupSession.character_states) delete groupSession.character_states[h];
                            });
                            // Clear the snapshot so it gets re-set after new stream
                            delete msg.member_hashes_before;
                        }
                        const newIdx = msg.snapshots.length;
                        msg.snapshots.push('');
                        msg.activeIndex = newIdx;
                        await this._saveGroupSession();
                        this.renderMessages();
                        await this._streamGroupNarratorResponse(index);
                    }
                });

                this._bindMediaListeners(card, index, allMediaItems);

                container.appendChild(card);
                return;
            }

            const isUser = msg.role === 'user';
            const isAssistant = msg.role === 'assistant';
            const content = this.getMessageContent(msg);

            const wrapper = document.createElement('div');
            wrapper.className = `chat-bubble-wrapper ${isUser ? 'user' : 'character'}`;
            wrapper.dataset.msgIndex = index;

            let avatarHtml = `<div class="chat-avatar" style="background-image: url('${charAvatar}')"></div>`;
            let charNameLabel = '';
            if (isUser) {
                const userPersona = this.state.personas.users[this.state.activeUserPersonaId] || {};
                const userAvatar = userPersona.avatar || '';
                avatarHtml = userAvatar ? `<div class="chat-avatar" style="background-image: url('${userAvatar}')"></div>` : `<div class="chat-avatar" style="background-color: var(--chat-bubble-user)"></div>`;
            } else if (isAssistant) {
                if (isGroupMode) {
                    // Group mode: resolve avatar and name from message's character_hash
                    const msgPersona = this._getAssistantPersonaForMessage ? this._getAssistantPersonaForMessage(msg) : { avatar: charAvatar, name: '' };
                    avatarHtml = `<div class="chat-avatar" style="background-image: url('${msgPersona.avatar}')"></div>`;
                    if (msgPersona.name) {
                        charNameLabel = `<div class="chat-bubble-char-name">${this.escapeHTML(msgPersona.name)}</div>`;
                    }
                } else {
                    // Single mode: show character name
                    const charPersona = this.state.personas.characters[this.state.activeChatCharacterHash] || {};
                    if (charPersona.name) {
                        charNameLabel = `<div class="chat-bubble-char-name">${this.escapeHTML(charPersona.name)}</div>`;
                    }
                }
                const statusLine = this._buildBubbleStatusLine(msg);
                if (statusLine) charNameLabel += statusLine;
            }

            let snapshotNavHtml = '';
            if (isAssistant && msg.snapshots.length > 0) {
                const isLatest = msg.activeIndex >= msg.snapshots.length - 1;
                snapshotNavHtml = `
                    <div class="snapshot-nav">
                        <button class="snapshot-btn snapshot-prev" ${msg.activeIndex <= 0 ? 'disabled' : ''} title="Previous">
                            <span class="material-symbols-outlined">chevron_left</span>
                        </button>
                        <span class="snapshot-counter">${msg.activeIndex + 1}/${msg.snapshots.length}</span>
                        ${isLatest ? `
                            <button class="snapshot-btn msg-regen-btn" title="Re-generate">
                                <span class="material-symbols-outlined">refresh</span>
                            </button>
                        ` : `
                            <button class="snapshot-btn snapshot-next" title="Next">
                                <span class="material-symbols-outlined">chevron_right</span>
                            </button>
                        `}
                    </div>
                `;
            }

            let actionsHtml = `<div class="msg-actions"><div class="msg-actions-inner">`;
            if (isAssistant) {
                actionsHtml += `
                    <button class="msg-action-btn msg-edit-btn" title="Edit"><span class="material-symbols-outlined">edit</span></button>
                    <button class="msg-action-btn msg-delete-btn" title="Delete"><span class="material-symbols-outlined">delete</span></button>
                    ${snapshotNavHtml}
                `;
            } else if (isUser) {
                actionsHtml += `
                    <button class="msg-action-btn msg-regen-btn" title="Re-generate Reply"><span class="material-symbols-outlined">refresh</span></button>
                    <button class="msg-action-btn msg-edit-btn" title="Edit"><span class="material-symbols-outlined">edit</span></button>
                    <button class="msg-action-btn msg-delete-btn" title="Delete"><span class="material-symbols-outlined">delete</span></button>
                `;
            }
            actionsHtml += `</div></div>`;

            wrapper.innerHTML = `
                <div class="chat-avatar-container" style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; flex-shrink: 0;">
                    ${avatarHtml}
                </div>
                <div class="chat-bubble-content">
                    ${charNameLabel}
                    <div class="bubble-row">
                        ${actionsHtml}
                        <div class="chat-bubble">
                            <div class="bubble-text-block">
                                <div class="text">${this.formatMessageContent(content)}</div>
                                ${this._renderBubbleActionCards(msg, isUser ? 'user' : 'assistant')}
                            </div>
                            ${mediaHtml}
                        </div>
                    </div>
                </div>
            `;

            this._bindMediaListeners(wrapper, index, allMediaItems);

            if (this.state.activeActionIndex === index) {
                wrapper.classList.add('show-actions');
            }

            wrapper.addEventListener('click', (e) => {
                if (e.target.closest('.msg-actions')) return;
                if (!e.target.closest('.chat-bubble')) return; // Ignore clicks outside the actual bubble

                this.state.activeActionIndex = index;
                const activeWrappers = container.querySelectorAll('.show-actions');
                activeWrappers.forEach(w => w.classList.remove('show-actions'));
                wrapper.classList.add('show-actions');
            });

            this._bindMessageActions(wrapper, index, msg);
            container.appendChild(wrapper);
        });

        this._updateChatBackground();

        const allChildren = Array.from(container.children);
        const visibleChildren = allChildren.filter(el =>
            el.classList.contains('chat-bubble-wrapper') || 
            el.classList.contains('chat-system-action-card') ||
            el.classList.contains('narrator-bubble-wrapper')
        );

        visibleChildren.slice(-2).forEach(w => w.classList.add('is-latest-message'));

        // Inject stamina badge on assistant bubble avatars
        if (this.actionEngine?.rules?.stamina) {
            const maxStamina = this.actionEngine.getMaxStamina();

            // Both single and group: show stamina badge only when exact snapshot data exists
            allChildren.forEach(w => {
                if (!w.classList.contains('chat-bubble-wrapper') || !w.classList.contains('character')) return;
                const msgIndex = parseInt(w.dataset.msgIndex);
                const bubbleMsg = messages[msgIndex];
                if (!bubbleMsg) return;
                const migratedMsg = this.migrateMessage(bubbleMsg);
                const snap = window.HistoryStateEngine.readStatus(migratedMsg, migratedMsg.activeIndex);
                if (!snap || snap.stamina === undefined) return;

                const currentStamina = snap.stamina;
                const avatarContainer = w.querySelector('.chat-avatar-container');
                if (!avatarContainer) return;

                const ratio = currentStamina / maxStamina;
                let badgeColor = 'var(--chat-primary)';
                if (ratio <= 0.25) badgeColor = '#f44336';
                else if (ratio <= 0.5) badgeColor = '#ff9800';

                const badge = document.createElement('div');
                badge.className = 'stamina-badge';
                badge.textContent = `⚡ ${Math.round(currentStamina)}`;
                badge.style.cssText = `font-size:10px;font-weight:600;color:${badgeColor};text-align:center;margin-top:4px;white-space:nowrap;line-height:1;`;
                avatarContainer.appendChild(badge);
            });
        }

        // Insert scroll-up hint arrow above the 2nd newest message (if bg image mode and enough messages)
        const viewMode = localStorage.getItem('chat-image-gen-view-mode') || 'bubble';
        if (viewMode !== 'bubble' && visibleChildren.length > 2) {
            const secondNewest = visibleChildren.slice(-2)[0];
            if (secondNewest) {
                const hint = document.createElement('div');
                hint.className = 'chat-scroll-up-hint';
                hint.innerHTML = `<button class="chat-scroll-up-hint-btn" title="View older messages"><span class="material-symbols-outlined">keyboard_arrow_up</span></button>`;
                container.insertBefore(hint, secondNewest);

                hint.querySelector('.chat-scroll-up-hint-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Scroll up to reveal older messages
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                    // Hide the hint (will be re-shown if user scrolls back down)
                    hint.classList.remove('visible');
                });
            }
        }

        container.scrollTop = container.scrollHeight;

        // Ensure scrolling state is tracked correctly immediately after render
        const chatView = this.container.querySelector('#view-chat');
        if (chatView) {
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
            if (isNearBottom || container.scrollHeight <= container.clientHeight) {
                chatView.classList.remove('viewing-history');
                chatView.classList.add('viewing-latest');
            } else {
                chatView.classList.remove('viewing-latest');
                chatView.classList.add('viewing-history');
            }

            // Show scroll-up hint after a brief delay (let layout settle)
            if (chatView.classList.contains('viewing-latest') && chatView.classList.contains('has-bg-image')) {
                const hintEl = container.querySelector('.chat-scroll-up-hint');
                if (hintEl) {
                    requestAnimationFrame(() => hintEl.classList.add('visible'));
                }
            }
        }
    },

    _renderBubbleActionCards(msg, role) {
        const m = this.migrateMessage(msg);
        const actionContext = (m.snapshots[m.activeIndex] && m.snapshots[m.activeIndex][3]) || null;

        if (role === 'user') {
            if (!actionContext || actionContext.length === 0) return '';

            const parts = actionContext.map(a => {
                const icon = a.type === 'gift' ? '🎁' : '⚡';
                return `${icon} ${this.formatActionLabel(a.label)}`;
            });
            const merged = parts.length === 1
                ? parts[0]
                : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
            return `<div class="bubble-action-card user-action">${merged}</div>`;
        }

        if (role === 'assistant') {
            // Collect outfit changes and stamina events from action_context
            if (!actionContext || actionContext.length === 0) return '';

            const putOnItems = [];
            const tookOffItems = [];
            const staminaLabels = [];

            actionContext.forEach(a => {
                if (a.type === 'outfit_change') {
                    // Parse verb from label: "*actor put on **item**...*" or "*actor took off **item**...*"
                    if (a.label && a.label.includes('put on')) {
                        // Extract items from bold markers
                        const matches = a.label.match(/\*\*([^*]+)\*\*/g) || [];
                        matches.forEach(m => putOnItems.push(m.replace(/\*\*/g, '')));
                    } else if (a.label && (a.label.includes('took off') || a.label.includes('take off'))) {
                        const matches = a.label.match(/\*\*([^*]+)\*\*/g) || [];
                        matches.forEach(m => tookOffItems.push(m.replace(/\*\*/g, '')));
                    }
                } else if (a.type === 'stamina_exhausted') {
                    staminaLabels.push(a.label);
                }
            });

            const parts = [];
            if (putOnItems.length > 0) parts.push(`👗 Wore: ${putOnItems.map(i => this.escapeHTML(i)).join(', ')}`);
            if (tookOffItems.length > 0) parts.push(`👕 Took off: ${tookOffItems.map(i => this.escapeHTML(i)).join(', ')}`);
            staminaLabels.forEach(l => parts.push(`⚡ ${this.formatActionLabel(l)}`));

            // Gift received — prepend so it appears first
            actionContext.forEach(a => {
                if (a.type === 'gift_received') {
                    const raw = a.sender
                        ? `Received **${a.item}** from ${a.sender}`
                        : `Received **${a.item}**`;
                    parts.unshift(`🎁 ${this.formatActionLabel(raw)}`);
                }
            });

            if (parts.length === 0) return '';
            return `<div class="bubble-action-card char-action">${parts.join(' · ')}</div>`;
        }

        return '';
    },

    _buildBubbleStatusLine(msg) {
        // Read status from snapshot[2] (new format) or legacy status_snapshots
        const m = this.migrateMessage(msg);
        const state = window.HistoryStateEngine.readStatus(m, m.activeIndex);
        if (!state) return null;

        // Top-1 emotion: highest absolute value
        let topEmotion = null;
        if (state.emotion_state && Object.keys(state.emotion_state).length > 0) {
            const sorted = Object.entries(state.emotion_state)
                .filter(([, v]) => Math.abs(v) > 0)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
            if (sorted.length > 0) topEmotion = sorted[0][0];
        }

        // Top-1 action: first key (duo types first, same as _syncStatusToUI)
        let topAction = null;
        if (state.action_state && Object.keys(state.action_state).length > 0) {
            const actions = Object.keys(state.action_state).filter(k => state.action_state[k] > 0);
            if (actions.length > 0) {
                if (this.actionEngine) {
                    actions.sort((a, b) => {
                        const isDuoA = this.actionEngine.isDuoType(a) ? 1 : 0;
                        const isDuoB = this.actionEngine.isDuoType(b) ? 1 : 0;
                        return isDuoB - isDuoA;
                    });
                }
                topAction = actions[0];
            }
        }

        if (!topEmotion && !topAction) return null;

        const MAX_LEN = 18;
        const fmt = (name) => {
            const s = this._formatTypeName(name);
            return s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1) + '…' : s;
        };

        let text = '';
        if (topEmotion && topAction) {
            text = `${fmt(topEmotion)} · ${fmt(topAction)}`;
        } else if (topEmotion) {
            text = fmt(topEmotion);
        } else {
            text = fmt(topAction);
        }

        return `<div class="bubble-status-line">${this.escapeHTML(text)}</div>`;
    },

    _updateChatBackground() {
        const bgContainer = this.container.querySelector('#chat-view-bg');
        if (!bgContainer) return;

        const viewMode = localStorage.getItem('chat-image-gen-view-mode') || 'bubble';
        const chatView = this.container.querySelector('#view-chat');

        if (viewMode === 'bubble') {
            bgContainer.innerHTML = '';
            if (chatView) chatView.classList.remove('has-bg-image');
            return;
        }

        const session = this.state.activeChatSession;
        if (!session || !session.messages) return;

        let latestImageUrl = null;
        let latestImageItem = null;
        let latestMsgIndex = -1;

        // Find the latest generated image
        for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            if (msg.role === 'system') continue;
            const images = this.getMessageImages(msg) || [];
            if (images.length > 0) {
                const urlObj = images[images.length - 1];
                latestImageUrl = typeof urlObj === 'string' ? urlObj : urlObj.url;
                if (!latestImageUrl) continue;
                if (latestImageUrl.match(/\.(mp4|webm|mov)$/i)) continue;

                latestImageItem = typeof urlObj === 'object' ? urlObj : {};
                latestMsgIndex = i;
                break;
            }
        }

        if (!latestImageUrl) {
            bgContainer.innerHTML = '';
            if (chatView) chatView.classList.remove('has-bg-image');
            return;
        }

        const currentImg = bgContainer.querySelector('.chat-view-bg-image.active-bg');
        if (currentImg && currentImg.src.includes(latestImageUrl)) return;

        const newImg = document.createElement('img');
        newImg.className = 'chat-view-bg-image';
        newImg.src = latestImageUrl;
        newImg.loading = 'lazy';

        newImg.addEventListener('click', () => {
            if (!window.Yuuka?.plugins?.simpleViewer) return;

            let fullItem = { ...latestImageItem };
            if ((!fullItem || !fullItem.generationConfig) && window.Yuuka?.instances?.AlbumComponent) {
                const albumItems = window.Yuuka.instances.AlbumComponent.state.allImageData || [];
                const found = albumItems.find(i => i.url === latestImageUrl || i.imageUrl === latestImageUrl);
                if (found) fullItem = { ...fullItem, ...found };
            }

            const globalMediaItems = [];
            let globalIndex = 0;

            if (session && session.messages) {
                session.messages.forEach((hMsg, hIndex) => {
                    if (hMsg.role === 'system') return;
                    const hMediaUrls = this.getMessageImages(hMsg) || [];
                    hMediaUrls.forEach((urlObj) => {
                        const u = typeof urlObj === 'string' ? urlObj : urlObj.url;
                        if (!u) return;
                        const isV = u.match(/\.(mp4|webm|mov)$/i);

                        let fItem = typeof urlObj === 'object' ? urlObj : {};
                        if ((!fItem || !fItem.generationConfig) && window.Yuuka?.instances?.AlbumComponent) {
                            const albumItems = window.Yuuka.instances.AlbumComponent.state.allImageData || [];
                            const fnd = albumItems.find(i => i.url === u || i.imageUrl === u);
                            if (fnd) fItem = { ...fItem, ...fnd };
                        }

                        const finalItem = { ...fItem, imageUrl: u, is_video: !!isV, originalUrl: u, msgIndex: hIndex };

                        if (hIndex === latestMsgIndex && u === latestImageUrl) {
                            globalIndex = globalMediaItems.length;
                        }
                        globalMediaItems.push(finalItem);
                    });
                });
            }

            if (globalMediaItems.length === 0) {
                const finalItem = { ...fullItem, imageUrl: latestImageUrl, originalUrl: latestImageUrl, msgIndex: latestMsgIndex };
                globalMediaItems.push(finalItem);
                globalIndex = 0;
            }

            window.Yuuka.plugins.simpleViewer.open({
                items: globalMediaItems,
                startIndex: globalIndex,
                renderInfoPanel: (item) => {
                    if (window.Yuuka?.viewerHelpers?.buildInfoPanel) {
                        try { return window.Yuuka.viewerHelpers.buildInfoPanel(item); } catch (e) { }
                    }
                    if (window.Yuuka?.instances?.AlbumComponent && typeof window.Yuuka.instances.AlbumComponent._viewerRenderInfoPanel === 'function') {
                        return window.Yuuka.instances.AlbumComponent._viewerRenderInfoPanel(item);
                    }

                    // Fallback using the same logic as bubbling click
                    const cfg = item?.generationConfig || item?.generation_config;
                    if (!cfg || Object.keys(cfg).length === 0) {
                        const filename = item.originalUrl.split('/').pop() || 'Unknown';
                        return `
                            <div class="info-row"><strong>Tên file:</strong> <span>${filename}</span></div>
                            <div class="info-row"><strong>Đường dẫn (URL):</strong> <span><a href="${item.originalUrl}" target="_blank" style="color:var(--text-color, #fff);">${item.originalUrl}</a></span></div>
                        `;
                    }
                    // Info panel UI logic (assuming album takes over mostly)
                    return `<div class="info-row"><strong>Prompt:</strong> <span>${cfg.prompt || '...'}</span></div>`;
                },
                actionButtons: [
                    {
                        icon: 'photo_album',
                        title: 'Open Album',
                        onClick: async (item, closeFn, updateFn) => {
                            const charHash = this.state.activeChatCharacterHash;
                            if (!charHash) return;
                            closeFn();
                            this._closeChatDock();
                            const charPersona = this.state.personas.characters[charHash];
                            window.Yuuka.initialPluginState = window.Yuuka.initialPluginState || {};
                            window.Yuuka.initialPluginState.album = {
                                character: { hash: charHash, name: charPersona?.name || 'Unknown' },
                                viewMode: 'album',
                            };
                            if (window.Yuuka?.ui?.switchTab) {
                                window.Yuuka.ui.switchTab('album');
                            }
                        }
                    }
                ]
            });
        });

        bgContainer.appendChild(newImg);
        if (chatView) chatView.classList.add('has-bg-image');

        requestAnimationFrame(() => {
            newImg.classList.add('active-bg');
            newImg.style.opacity = '1';

            setTimeout(() => {
                const allImgs = bgContainer.querySelectorAll('.chat-view-bg-image');
                allImgs.forEach(img => {
                    if (img !== newImg) img.remove();
                });
            }, 850);
        });
    },

    _bindMediaListeners(wrapper, index, allMediaItems) {
        const mediaEls = wrapper.querySelectorAll('.chat-embedded-media');
        mediaEls.forEach(el => {
            el.addEventListener('error', () => {
                const url = el.getAttribute('src');
                console.warn(`[Chat] Xoá media 404 khỏi snapshot history: ${url}`);
                this.removeImageFromMessage(index, url);
            });

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!window.Yuuka?.plugins?.simpleViewer) return;

                const mIdx = parseInt(el.getAttribute('data-media-index')) || 0;
                const clickedItem = allMediaItems[mIdx];

                const globalMediaItems = [];
                let globalIndex = 0;

                if (this.state.activeChatSession && this.state.activeChatSession.messages) {
                    this.state.activeChatSession.messages.forEach((hMsg, hIndex) => {
                        if (hMsg.role === 'system') return;
                        const hMediaUrls = this.getMessageImages(hMsg) || [];
                        hMediaUrls.forEach((urlObj) => {
                            const u = typeof urlObj === 'string' ? urlObj : urlObj.url;
                            if (!u) return;
                            const isV = u.match(/\.(mp4|webm|mov)$/i);

                            let fItem = typeof urlObj === 'object' ? urlObj : {};
                            if ((!fItem || !fItem.generationConfig) && window.Yuuka?.instances?.AlbumComponent) {
                                const albumItems = window.Yuuka.instances.AlbumComponent.state.allImageData || [];
                                const fnd = albumItems.find(i => i.url === u || i.imageUrl === u);
                                if (fnd) fItem = { ...fItem, ...fnd };
                            }

                            const finalItem = { ...fItem, imageUrl: u, is_video: !!isV, originalUrl: u, msgIndex: hIndex };

                            if (hIndex === index && u === clickedItem?.originalUrl) {
                                globalIndex = globalMediaItems.length;
                            }
                            globalMediaItems.push(finalItem);
                        });
                    });
                }

                if (globalMediaItems.length === 0) {
                    globalMediaItems.push(...allMediaItems.map(i => ({ ...i, msgIndex: index })));
                    globalIndex = mIdx;
                }

                window.Yuuka.plugins.simpleViewer.open({
                    items: globalMediaItems,
                    startIndex: globalIndex,
                    renderInfoPanel: (item) => {
                        if (window.Yuuka?.viewerHelpers?.buildInfoPanel) {
                            try { return window.Yuuka.viewerHelpers.buildInfoPanel(item); } catch (e) { }
                        }
                        if (window.Yuuka?.instances?.AlbumComponent && typeof window.Yuuka.instances.AlbumComponent._viewerRenderInfoPanel === 'function') {
                            return window.Yuuka.instances.AlbumComponent._viewerRenderInfoPanel(item);
                        }

                        // Re-implement Album's fallbackInfoPanel exact logic
                        const cfg = item?.generationConfig || item?.generation_config;
                        if (!cfg || Object.keys(cfg).length === 0) {
                            const filename = item.originalUrl.split('/').pop() || 'Unknown';
                            return `
                                <div class="info-row"><strong>Tên file:</strong> <span>${filename}</span></div>
                                <div class="info-row"><strong>Đường dẫn (URL):</strong> <span><a href="${item.originalUrl}" target="_blank" style="color:var(--text-color, #fff);">${item.originalUrl}</a></span></div>
                            `;
                        }

                        const buildRow = (label, value) => {
                            if (!value || (typeof value === 'string' && value.trim() === '')) return '';
                            const span = document.createElement('span');
                            span.textContent = value;
                            return `<div class="info-row"><strong>${label}:</strong> <span>${span.innerHTML}</span></div>`;
                        };

                        const createdText = item.createdAt ? new Date(item.createdAt * 1000).toLocaleString('vi-VN') : '';
                        const renderTime = item.creationTime ? `${Number(item.creationTime).toFixed(2)} giây` : '';

                        if (item.is_video || (item.url && (item.url.endsWith('.webm') || item.url.endsWith('.mp4')))) {
                            const promptRows = buildRow('Prompt', cfg.prompt) + buildRow('Positive Prompt', cfg.positive_prompt);
                            const infoGrid = `<div class="info-grid">${buildRow('Video Length', cfg.seconds ? cfg.seconds + ' seconds' : '')
                                }${buildRow('FPS', cfg.fps)
                                }${buildRow('Dimension', (cfg.width || '?') + 'x' + (cfg.height || '?'))
                                }${buildRow('Workflow', cfg.workflow_type || cfg._workflow_type)
                                }</div>`;
                            const sections = [];
                            if (promptRows) sections.push(promptRows, '<hr>');
                            sections.push(infoGrid);
                            if (createdText || renderTime) sections.push('<hr>');
                            if (createdText) sections.push(buildRow('Created', createdText));
                            if (renderTime) sections.push(buildRow('Render time', renderTime));
                            return sections.filter(Boolean).join('').trim();
                        }

                        const resolveWorkflowDisplay = () => {
                            const normalize = (value) => String(value || '').trim().toLowerCase();
                            const workflowTemplate = String(cfg.workflow_template || '').trim();
                            let workflowType = normalize(cfg.workflow_type);
                            const hasLoRAName = typeof cfg.lora_name === 'string' && cfg.lora_name.trim() && cfg.lora_name.trim().toLowerCase() !== 'none';
                            const hasLoRAChain = Array.isArray(cfg.lora_chain) && cfg.lora_chain.length > 0;
                            const hasLoRANames = Array.isArray(cfg.lora_names) && cfg.lora_names.filter(n => String(n).trim().toLowerCase() !== 'none').length > 0;
                            const hasAnyLoRA = hasLoRAName || hasLoRAChain || hasLoRANames;
                            if (workflowType.endsWith('_lora') && !hasAnyLoRA) {
                                workflowType = workflowType.replace(/_lora$/, '');
                            }
                            const labelMap = {
                                'hires_lora': 'Hires Fix + LoRA',
                                'hires': 'Hires Fix',
                                'hires_input_image_lora': 'Hires Input Image + LoRA',
                                'hires_input_image': 'Hires Input Image',
                                'sdxl_lora': 'SDXL + LoRA',
                                'lora': 'SDXL + LoRA',
                                'standard': 'Standard'
                            };
                            let label = labelMap[workflowType];
                            if (!label && workflowType.endsWith('_lora')) {
                                const baseType = workflowType.replace(/_lora$/, '');
                                if (labelMap[baseType]) {
                                    label = hasAnyLoRA ? labelMap[baseType] + ' + LoRA' : labelMap[baseType];
                                }
                            }
                            if (!label) {
                                const templateLower = workflowTemplate.toLowerCase();
                                if (templateLower.includes('hiresfix') && templateLower.includes('input_image')) {
                                    label = (templateLower.includes('lora') && hasAnyLoRA) ? 'Hires Input Image + LoRA' : 'Hires Input Image';
                                } else if (templateLower.includes('hiresfix')) {
                                    label = (templateLower.includes('lora') && hasAnyLoRA) ? 'Hires Fix + LoRA' : 'Hires Fix';
                                } else if (templateLower.includes('lora') && hasAnyLoRA) {
                                    label = 'SDXL + LoRA';
                                }
                            }
                            if (!label) {
                                const width = Number(cfg.width);
                                const height = Number(cfg.height);
                                const baseWidth = Number(cfg.hires_base_width);
                                const baseHeight = Number(cfg.hires_base_height);
                                const widthHires = Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth + 4;
                                const heightHires = Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight + 4;
                                const noBaseData = (!Number.isFinite(baseWidth) || baseWidth <= 0) && (!Number.isFinite(baseHeight) || baseHeight <= 0);
                                const bigDimension = (Number.isFinite(width) && width >= 1536) || (Number.isFinite(height) && height >= 1536);
                                if (widthHires || heightHires || (noBaseData && bigDimension)) {
                                    label = hasAnyLoRA ? 'Hires Fix + LoRA' : 'Hires Fix';
                                }
                            }
                            if (!label) {
                                label = hasAnyLoRA ? 'SDXL + LoRA' : 'Standard';
                            }
                            if (workflowTemplate && workflowTemplate.toLowerCase() !== 'standard') {
                                return label ? label + ' (' + workflowTemplate + ')' : workflowTemplate;
                            }
                            return label;
                        };

                        const promptRows = ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative']
                            .map(key => buildRow(key.charAt(0).toUpperCase() + key.slice(1), cfg[key]))
                            .filter(Boolean)
                            .join('');
                        const infoGrid = `<div class="info-grid">${buildRow('Model', cfg.ckpt_name?.split('.')[0])
                            }${buildRow('Sampler', cfg.sampler_name + ' (' + cfg.scheduler + ')')
                            }${buildRow('Image Size', cfg.width + 'x' + cfg.height)
                            }${buildRow('Steps', cfg.steps)
                            }${buildRow('CFG', cfg.cfg)
                            }${(() => {
                                const displayLoRA = () => {
                                    if (Array.isArray(cfg.lora_chain) && cfg.lora_chain.length) {
                                        return cfg.lora_chain.map(item => {
                                            const n = String(item.lora_name || item.name || '').trim();
                                            if (!n) return null;
                                            const sm = item.strength_model ?? item.lora_strength_model;
                                            const sc = item.strength_clip ?? item.lora_strength_clip;
                                            if (sm != null && sc != null && Number.isFinite(Number(sm)) && Number.isFinite(Number(sc))) {
                                                return n + '(' + Number(sm).toFixed(2) + '/' + Number(sc).toFixed(2) + ')';
                                            }
                                            return n;
                                        }).filter(Boolean).join(', ');
                                    }
                                    if (Array.isArray(cfg.lora_names) && cfg.lora_names.length) {
                                        return cfg.lora_names.join(', ');
                                    }
                                    return cfg.lora_name;
                                };
                                return buildRow('LoRA', displayLoRA());
                            })()
                            }${buildRow('Workflow', resolveWorkflowDisplay())
                            }</div>`;
                        const loraTags = (() => {
                            if (Array.isArray(cfg.multi_lora_prompt_groups)) {
                                const parts = cfg.multi_lora_prompt_groups
                                    .map(arr => Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [])
                                    .map(groupList => groupList.length ? '(' + groupList.join(', ') + ')' : '')
                                    .filter(Boolean);
                                if (parts.length) return parts.join(', ');
                            }
                            if (typeof cfg.multi_lora_prompt_tags === 'string' && cfg.multi_lora_prompt_tags.trim()) {
                                return cfg.multi_lora_prompt_tags.trim();
                            }
                            if (Array.isArray(cfg.lora_prompt_tags)) {
                                return cfg.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean).join(', ');
                            }
                            return '';
                        })();
                        const loraTagsBlock = loraTags ? buildRow('LoRA Tags', loraTags) : '';
                        const sections = [];
                        if (promptRows) sections.push(promptRows, '<hr>');
                        sections.push(infoGrid);
                        if (loraTagsBlock) sections.push(loraTagsBlock);
                        if (createdText || renderTime) sections.push('<hr>');
                        if (createdText) sections.push(buildRow('Created', createdText));
                        if (renderTime) sections.push(buildRow('Render time', renderTime));
                        return sections.filter(Boolean).join('').trim();
                    },
                    actionButtons: [
                        {
                            icon: 'photo_album',
                            title: 'Open Album',
                            onClick: async (item, closeFn, updateFn) => {
                                const charHash = this.state.activeChatCharacterHash;
                                if (!charHash) return;
                                closeFn();
                                this._closeChatDock();
                                const charPersona = this.state.personas.characters[charHash];
                                window.Yuuka.initialPluginState = window.Yuuka.initialPluginState || {};
                                window.Yuuka.initialPluginState.album = {
                                    character: { hash: charHash, name: charPersona?.name || 'Unknown' },
                                    viewMode: 'album',
                                };
                                if (window.Yuuka?.ui?.switchTab) {
                                    window.Yuuka.ui.switchTab('album');
                                }
                            }
                        }
                    ]
                });
            });
        });
    }
});
