// Save the original openCreation from chatCreation.js before overriding
const _originalOpenCreation = window.ChatComponent.prototype.openCreation;

Object.assign(window.ChatComponent.prototype, {

    // Override openCreation to intercept 'group' type
    openCreation(type, id = null) {
        if (type === 'group') {
            this.openGroupCreation();
            return;
        }
        // Hide group member section when switching to character/user creation
        const memberSection = this.container.querySelector('#group-member-section');
        if (memberSection) memberSection.style.display = 'none';

        // Restore "Persona" label if it was changed to "Description"
        const personaInput = this.container.querySelector('#creation-persona');
        const personaGroup = personaInput ? personaInput.closest('.form-group') : null;
        if (personaGroup) {
            const personaLabel = personaGroup.querySelector('label');
            if (personaLabel && personaLabel.textContent === 'Description') {
                personaLabel.textContent = 'Persona';
            }
        }

        // Restore save button to original handler.
        // If the button was cloned for group mode, re-attach the original handleSaveCreation.
        const saveBtn = this.container.querySelector('#btn-save-creation');
        if (saveBtn) {
            if (saveBtn._groupSaveHandler) {
                saveBtn.removeEventListener('click', saveBtn._groupSaveHandler);
                delete saveBtn._groupSaveHandler;
            }
            // If the button was cloned (stripped of original listener), re-bind handleSaveCreation
            if (saveBtn._isGroupSaveBtn) {
                saveBtn.addEventListener('click', this.handleSaveCreation.bind(this));
                delete saveBtn._isGroupSaveBtn;
            }
        }

        // Restore AI generate button
        const aiGenBtn = this.container.querySelector('#btn-ai-gen-persona');
        if (aiGenBtn) aiGenBtn.style.display = '';

        // Call original implementation
        if (_originalOpenCreation) {
            _originalOpenCreation.call(this, type, id);
        }
    },

    openGroupCreation() {
        this.state.editingGroupSession = { memberHashes: [], memberSummaries: {}, avatarBase64: null, editingGroupId: null };
        this._renderGroupCreationView({ isEdit: false });
    },

    openGroupEdit(groupId) {
        const session = this.state.activeChatGroupSession;
        if (!session) return;

        // Parse existing all_character_info_summary back into per-char summaries
        // Format: "[Name]\nsummary\n\n[Name2]\nsummary2"
        const memberSummaries = {};
        const existingSummary = (session.all_character_info_summary || '').trim();
        if (existingSummary) {
            const chars = (this.state.personas && this.state.personas.characters) || {};
            // Build name→hash lookup
            const nameToHash = {};
            Object.entries(chars).forEach(([hash, p]) => {
                if (p.name) nameToHash[p.name.toLowerCase()] = hash;
            });
            // Split blocks by "[Name]\n..."
            const blocks = existingSummary.split(/\n\n(?=\[)/);
            blocks.forEach(block => {
                const match = block.match(/^\[([^\]]+)\]\n([\s\S]*)/);
                if (match) {
                    const name = match[1].trim();
                    const summary = match[2].trim();
                    const hash = nameToHash[name.toLowerCase()];
                    if (hash) memberSummaries[hash] = summary;
                }
            });
        }

        this.state.editingGroupSession = {
            memberHashes: [...(session.member_hashes || [])],
            memberSummaries,
            avatarBase64: null,
            editingGroupId: groupId,
        };
        this._renderGroupCreationView({ isEdit: true, session });
    },

    _renderGroupCreationView({ isEdit = false, session = null } = {}) {

        // Reuse view-creation but adapt for group mode
        const titleEl = this.container.querySelector('#creation-title');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit Group Chat' : 'New Group Chat';

        // Always hide the character/persona delete button in group mode
        const personaDeleteBtn = this.container.querySelector('#btn-delete-persona');
        if (personaDeleteBtn) personaDeleteBtn.style.display = 'none';

        // --- Delete button (Bug 5: left of X/close button in view-creation header) ---
        const creationHeader = this.container.querySelector('#view-creation .chat-header');
        let deleteGroupBtn = this.container.querySelector('#btn-delete-group-creation');
        if (isEdit) {
            if (!deleteGroupBtn && creationHeader) {
                deleteGroupBtn = document.createElement('button');
                deleteGroupBtn.id = 'btn-delete-group-creation';
                deleteGroupBtn.className = 'icon-btn';
                deleteGroupBtn.title = 'Delete group';
                deleteGroupBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
                // Insert before the save button (or at end of creation-actions)
                const creationActions = creationHeader.querySelector('.creation-actions');
                if (creationActions) {
                    creationActions.insertBefore(deleteGroupBtn, creationActions.firstChild);
                }
            }
            if (deleteGroupBtn) {
                deleteGroupBtn.style.display = '';
                deleteGroupBtn.onclick = async () => {
                    const groupId = this.state.editingGroupSession && this.state.editingGroupSession.editingGroupId;
                    if (!groupId) return;
                    const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
                        ? (msg) => window.Yuuka.ui.confirm(msg)
                        : (msg) => Promise.resolve(window.confirm(msg));
                    const confirmed = await confirmFn(`Delete group "${session && session.name || 'this group'}"? This cannot be undone.`);
                    if (!confirmed) return;
                    try {
                        await this.api['chat'].delete(`/group_sessions/${groupId}`);
                        this.state.activeChatGroupId = null;
                        this.state.activeChatGroupSession = null;
                        this.state.activeChatSession = null;
                        this._destroyCharacterBar && this._destroyCharacterBar();
                        this.switchTab('chat_list');
                        this.renderChatList && this.renderChatList();
                    } catch (e) {
                        console.error('Failed to delete group:', e);
                        alert('Failed to delete group. Please try again.');
                    }
                };
            }
        } else {
            if (deleteGroupBtn) deleteGroupBtn.style.display = 'none';
        }

        // Hide character-specific fields
        const chatSampleGroup = this.container.querySelector('#group-chat-sample');
        const appearanceGroup = this.container.querySelector('#group-appearance');
        const outfitsGroup = this.container.querySelector('#group-outfits');
        if (chatSampleGroup) chatSampleGroup.style.display = 'none';
        if (appearanceGroup) appearanceGroup.style.display = 'none';
        if (outfitsGroup) outfitsGroup.style.display = 'none';

        // Rename "Persona" label to "Description" for group mode
        const personaInput = this.container.querySelector('#creation-persona');
        const personaGroup = personaInput ? personaInput.closest('.form-group') : null;
        if (personaGroup) {
            const personaLabel = personaGroup.querySelector('label');
            if (personaLabel) personaLabel.textContent = 'Description';
        }

        // Populate fields
        const nameInput = this.container.querySelector('#creation-name');
        const avatarPreview = this.container.querySelector('#creation-avatar');
        const avatarInput = this.container.querySelector('#creation-avatar-input');
        if (isEdit && session) {
            if (nameInput) nameInput.value = session.name || '';
            if (personaInput) personaInput.value = session.description || '';
            if (avatarPreview) avatarPreview.style.backgroundImage = session.avatar ? `url('${session.avatar}')` : '';
        } else {
            if (nameInput) nameInput.value = '';
            if (personaInput) personaInput.value = '';
            if (avatarPreview) avatarPreview.style.backgroundImage = '';
            if (avatarInput) avatarInput.value = '';
        }

        // Redirect save button to group save handler.
        // Clone the button to strip ALL previously registered listeners (including the
        // original handleSaveCreation bound in chat.js), then attach only the group handler.
        const saveBtnOld = this.container.querySelector('#btn-save-creation');
        if (saveBtnOld) {
            const saveBtn = saveBtnOld.cloneNode(true);
            saveBtnOld.parentNode.replaceChild(saveBtn, saveBtnOld);
            saveBtn._isGroupSaveBtn = true;
            saveBtn._groupSaveHandler = (e) => {
                e.stopImmediatePropagation();
                this.handleSaveGroupCreation();
            };
            saveBtn.addEventListener('click', saveBtn._groupSaveHandler);
        }

        // Hide AI generate button (not applicable for groups)
        const aiGenBtn = this.container.querySelector('#btn-ai-gen-persona');
        if (aiGenBtn) aiGenBtn.style.display = 'none';

        // Inject group member section if not already present
        let memberSection = this.container.querySelector('#group-member-section');
        if (!memberSection) {
            memberSection = document.createElement('div');
            memberSection.id = 'group-member-section';
            memberSection.className = 'form-group';
            memberSection.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <label style="margin:0;">Members <span style="opacity:0.5;font-size:0.85em;">(2–5)</span></label>
                    <button id="btn-group-summary-info" class="text-btn" style="font-size:0.82em;padding:3px 10px;opacity:0.85;" title="Summarize personas for all members">
                        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:3px;">auto_awesome</span>Summary Info
                    </button>
                </div>
                <div style="position:relative;">
                    <input id="group-member-input" type="text" placeholder="Search character..." autocomplete="off"
                        style="width:100%;box-sizing:border-box;" />
                    <div id="group-member-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--bg-secondary,#222);border:1px solid var(--border-color,#444);border-radius:6px;max-height:180px;overflow-y:auto;"></div>
                </div>
                <div id="group-member-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>
                <div id="group-member-limit-msg" style="display:none;color:var(--accent,#f90);font-size:0.85em;margin-top:4px;">Maximum 5 members reached.</div>
            `;

            // Insert before the persona/description group
            if (personaGroup && personaGroup.parentNode) {
                personaGroup.parentNode.insertBefore(memberSection, personaGroup);
            } else {
                const formMain = this.container.querySelector('#view-creation .chat-main');
                if (formMain) formMain.appendChild(memberSection);
            }

            // Bind autocomplete
            this._bindGroupMemberAutocomplete();
            // Bind Summary Info button
            this._bindGroupSummaryInfoBtn();
        } else {
            // Reset existing section
            memberSection.style.display = '';
            const limitMsg = memberSection.querySelector('#group-member-limit-msg');
            if (limitMsg) limitMsg.style.display = 'none';
            const memberInput = memberSection.querySelector('#group-member-input');
            if (memberInput) { memberInput.value = ''; memberInput.disabled = false; }
            const dropdown = memberSection.querySelector('#group-member-dropdown');
            if (dropdown) dropdown.style.display = 'none';
            // Re-bind Summary Info button (session changed)
            this._bindGroupSummaryInfoBtn();
        }

        // Render member list (pre-populated for edit mode)
        this._renderGroupMemberList();

        // Switch to creation tab
        this.switchTab('creation');
    },

    _bindGroupSummaryInfoBtn() {
        const btn = this.container.querySelector('#btn-group-summary-info');
        if (!btn) return;

        // Remove old listener by cloning
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async () => {
            const session = this.state.editingGroupSession;
            if (!session || session.memberHashes.length === 0) return;

            // Find hashes missing a summary
            const missingHashes = session.memberHashes.filter(h => !session.memberSummaries[h]);
            if (missingHashes.length === 0) {
                // All already summarized — re-render to show them
                this._renderGroupMemberList();
                return;
            }

            // Loading state
            newBtn.disabled = true;
            const originalHtml = newBtn.innerHTML;
            newBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:3px;animation:spin 1s linear infinite;">progress_activity</span>Summarizing...';

            try {
                const model = localStorage.getItem('chat-llm-model') || undefined;
                const res = await this.api['chat'].post('/generate/group_character_summary_per_char', {
                    char_hashes: missingHashes,
                    model
                });
                if (res && res.summaries) {
                    Object.assign(session.memberSummaries, res.summaries);
                    this._renderGroupMemberList();
                }
            } catch (e) {
                console.error('[GroupCreation] Per-char summary failed:', e);
                alert('Failed to generate summaries. Please try again.');
            } finally {
                newBtn.disabled = false;
                newBtn.innerHTML = originalHtml;
            }
        });
    },

    _bindGroupMemberAutocomplete() {
        const memberInput = this.container.querySelector('#group-member-input');
        const dropdown = this.container.querySelector('#group-member-dropdown');
        if (!memberInput || !dropdown) return;

        memberInput.addEventListener('input', () => {
            const query = memberInput.value.trim().toLowerCase();
            dropdown.innerHTML = '';
            if (!query) { dropdown.style.display = 'none'; return; }

            const chars = this.state.personas.characters || {};
            const results = Object.entries(chars).filter(([, p]) => {
                const name = (p.name || '').toLowerCase();
                return name.includes(query);
            });

            if (results.length === 0) { dropdown.style.display = 'none'; return; }

            results.slice(0, 10).forEach(([hash, p]) => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.style.cssText = 'padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;';
                const avatarSrc = p.avatar || `/image/${hash}`;
                const avatarHtml = `<img src="${avatarSrc}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" onerror="this.outerHTML='<span class=\\'material-symbols-outlined\\' style=\\'font-size:20px;opacity:0.4;\\'>person</span>'" />`;
                item.innerHTML = `${avatarHtml}<span>${this.escapeHTML(p.name || hash)}</span>`;
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this._addGroupMember(hash);
                    memberInput.value = '';
                    dropdown.style.display = 'none';
                });
                dropdown.appendChild(item);
            });

            dropdown.style.display = 'block';
        });

        memberInput.addEventListener('blur', () => {
            setTimeout(() => { dropdown.style.display = 'none'; }, 150);
        });
    },

    _renderGroupMemberCard(charHash, persona) {
        const card = document.createElement('div');
        card.className = 'chat-card session-card group-member-card';
        card.dataset.hash = charHash;
        // Override .chat-card fixed height/overflow so expanded content shows fully
        card.style.cssText = 'display:flex;flex-direction:column;gap:0;padding:8px 10px;cursor:pointer;height:auto;overflow:visible;align-items:stretch;';

        const avatarUrl = (persona && persona.avatar) ? persona.avatar : `/image/${charHash}`;
        const name = (persona && persona.name) ? this.escapeHTML(persona.name) : charHash;

        const session = this.state.editingGroupSession;
        const summary = (session && session.memberSummaries && session.memberSummaries[charHash]) || '';

        const subtitleCollapsed = summary
            ? `<div class="card-subtitle card-subtitle-collapsed" style="font-size:0.8em;opacity:0.7;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHTML(summary)}</div>`
            : `<div class="card-subtitle card-subtitle-collapsed" style="font-size:0.8em;opacity:0.4;margin-top:2px;font-style:italic;">No summary yet</div>`;

        const subtitleExpanded = summary
            ? `<div class="card-subtitle card-subtitle-expanded" style="display:none;font-size:0.8em;opacity:0.7;margin-top:4px;white-space:pre-wrap;word-break:break-word;">${this.escapeHTML(summary)}</div>`
            : '';

        card.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;width:100%;">
                <div class="card-avatar" style="width:36px;height:36px;flex-shrink:0;border-radius:50%;background-image:url('${avatarUrl}');background-size:cover;background-position:center;background-color:var(--bg-secondary,#2a2a2a);"></div>
                <div class="card-info" style="flex:1;min-width:0;">
                    <div class="card-name" style="font-size:0.9em;font-weight:600;">${name}</div>
                    ${subtitleCollapsed}
                </div>
                <button class="group-member-remove icon-btn" data-hash="${charHash}" title="Remove" style="flex-shrink:0;opacity:0.5;">
                    <span class="material-symbols-outlined" style="font-size:18px;">close</span>
                </button>
            </div>
            ${subtitleExpanded}
        `;

        // Toggle expand/collapse on card click (but not on remove button)
        card.addEventListener('click', (e) => {
            if (e.target.closest('.group-member-remove')) return;
            const collapsed = card.querySelector('.card-subtitle-collapsed');
            const expanded = card.querySelector('.card-subtitle-expanded');
            if (!expanded) return;
            const isExpanded = expanded.style.display !== 'none';
            if (isExpanded) {
                expanded.style.display = 'none';
                if (collapsed) collapsed.style.display = '';
            } else {
                expanded.style.display = '';
                if (collapsed) collapsed.style.display = 'none';
            }
        });

        card.querySelector('.group-member-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            this._removeGroupMember(charHash);
        });

        return card;
    },

    _addGroupMember(charHash) {
        const session = this.state.editingGroupSession;
        if (!session) return;

        if (session.memberHashes.includes(charHash)) return;

        if (session.memberHashes.length >= 5) {
            alert('Maximum 5 members allowed.');
            return;
        }

        session.memberHashes.push(charHash);
        this._renderGroupMemberList();

        // Add character_states entry for the new member in the active group session
        const groupSession = this.state.activeChatGroupSession;
        if (groupSession) {
            if (!groupSession.character_states) groupSession.character_states = {};
            if (!groupSession.character_states[charHash]) {
                const chars = (this.state.personas && this.state.personas.characters) || {};
                const persona = chars[charHash] || {};
                const maxStamina = (this.actionEngine && this.actionEngine.getMaxStamina) ? this.actionEngine.getMaxStamina() : 100;
                groupSession.character_states[charHash] = {
                    emotion_state: {},
                    action_state: {},
                    stamina: maxStamina,
                    outfits: [...(persona.default_outfits || [])],
                    inventory: []
                };
                this._saveGroupSession && this._saveGroupSession();
            }
        }

        if (session.memberHashes.length >= 5) {
            const memberInput = this.container.querySelector('#group-member-input');
            if (memberInput) memberInput.disabled = true;
            const limitMsg = this.container.querySelector('#group-member-limit-msg');
            if (limitMsg) limitMsg.style.display = 'block';
        }
    },

    _removeGroupMember(charHash) {
        const session = this.state.editingGroupSession;
        if (!session) return;

        session.memberHashes = session.memberHashes.filter(h => h !== charHash);
        this._renderGroupMemberList();

        // Remove character_states entry for the removed member in the active group session
        const groupSession = this.state.activeChatGroupSession;
        if (groupSession && groupSession.character_states && groupSession.character_states[charHash]) {
            delete groupSession.character_states[charHash];
            this._saveGroupSession && this._saveGroupSession();
        }

        if (session.memberHashes.length < 5) {
            const memberInput = this.container.querySelector('#group-member-input');
            if (memberInput) memberInput.disabled = false;
            const limitMsg = this.container.querySelector('#group-member-limit-msg');
            if (limitMsg) limitMsg.style.display = 'none';
        }
    },

    _renderGroupMemberList() {
        const memberList = this.container.querySelector('#group-member-list');
        if (!memberList) return;

        memberList.innerHTML = '';
        const session = this.state.editingGroupSession;
        if (!session) return;

        const chars = this.state.personas.characters || {};
        session.memberHashes.forEach(hash => {
            const persona = chars[hash] || null;
            const card = this._renderGroupMemberCard(hash, persona);
            memberList.appendChild(card);
        });
    },

    async handleSaveGroupCreation() {
        const session = this.state.editingGroupSession;
        if (!session) return;

        const nameInput = this.container.querySelector('#creation-name');
        const personaInput = this.container.querySelector('#creation-persona');
        const name = nameInput ? nameInput.value.trim() : '';
        const description = personaInput ? personaInput.value.trim() : '';

        // Validate name
        if (!name) {
            alert('Please enter a group name.');
            if (nameInput) nameInput.focus();
            return;
        }

        // Validate member count
        if (session.memberHashes.length < 2) {
            alert('Please add at least 2 members to the group.');
            return;
        }

        // Get avatar
        const avatarPreview = this.container.querySelector('#creation-avatar');
        let avatarUrl = '';
        if (avatarPreview && avatarPreview.style.backgroundImage) {
            avatarUrl = avatarPreview.style.backgroundImage.slice(5, -2).replace(/"/g, '');
            if (avatarUrl.startsWith('/image/')) avatarUrl = '';
        }

        const model = localStorage.getItem('chat-llm-model') || undefined;
        const isEdit = !!(session.editingGroupId);

        // Save button loading state
        const saveBtn = this.container.querySelector('#btn-save-creation');
        const saveBtnOriginalHtml = saveBtn ? saveBtn.innerHTML : null;
        const setSavingState = (saving) => {
            if (!saveBtn) return;
            saveBtn.disabled = saving;
            saveBtn.innerHTML = saving ? '<span class="material-symbols-outlined" style="font-size:18px;vertical-align:middle;">hourglass_top</span> Saving...' : saveBtnOriginalHtml;
        };

        try {
            setSavingState(true);
            let groupId;

            if (isEdit) {
                // PUT /group_sessions/{id}
                groupId = session.editingGroupId;
                const updatePayload = {
                    name,
                    description,
                    member_hashes: session.memberHashes,
                };
                if (session.avatarBase64) updatePayload.avatar = session.avatarBase64;
                else if (avatarUrl) updatePayload.avatar = avatarUrl;

                await this.api['chat'].put(`/group_sessions/${groupId}`, updatePayload);

                // Update local state
                if (this.state.activeChatGroupSession) {
                    Object.assign(this.state.activeChatGroupSession, updatePayload);
                    this.state.activeChatSession = this.state.activeChatGroupSession;
                }

                // Update header
                const chatHeaderName = this.container.querySelector('#chat-header-name');
                if (chatHeaderName) chatHeaderName.textContent = name;

            } else {
                // POST /group_sessions
                const chars = (this.state.personas && this.state.personas.characters) || {};
                const maxStamina = (this.actionEngine && this.actionEngine.getMaxStamina) ? this.actionEngine.getMaxStamina() : 100;
                const character_states = {};
                session.memberHashes.forEach(memberHash => {
                    const persona = chars[memberHash] || {};
                    character_states[memberHash] = {
                        emotion_state: {},
                        action_state: {},
                        stamina: maxStamina,
                        outfits: [...(persona.default_outfits || [])],
                        inventory: []
                    };
                });

                const createRes = await this.api['chat'].post('/group_sessions', {
                    name,
                    description,
                    member_hashes: session.memberHashes,
                    avatar: session.avatarBase64 || avatarUrl || '',
                    character_states
                });

                if (!createRes || createRes.status === 'error') {
                    alert('Failed to create group: ' + (createRes ? createRes.error : 'Unknown error'));
                    return;
                }

                groupId = createRes.id || (createRes.data && createRes.data.id);
                if (!groupId) {
                    alert('Failed to create group: no ID returned.');
                    return;
                }
            }

            // Build all_character_info_summary from per-char summaries
            // Fetch summaries for any members still missing one
            const missingHashes = session.memberHashes.filter(h => !session.memberSummaries[h]);
            if (missingHashes.length > 0) {
                try {
                    const summaryRes = await this.api['chat'].post('/generate/group_character_summary_per_char', {
                        char_hashes: missingHashes,
                        model
                    });
                    if (summaryRes && summaryRes.summaries) {
                        Object.assign(session.memberSummaries, summaryRes.summaries);
                    }
                } catch (e) {
                    console.warn('[GroupCreation] Per-char summary fetch failed, continuing without:', e);
                }
            }

            // Assemble combined summary: [Name]\nsummary for each member that has one
            const chars = this.state.personas.characters || {};
            const summaryParts = session.memberHashes
                .filter(h => session.memberSummaries[h])
                .map(h => {
                    const name = (chars[h] && chars[h].name) ? chars[h].name : h;
                    return `[${name}]\n${session.memberSummaries[h]}`;
                });
            const combinedSummary = summaryParts.join('\n\n');

            if (combinedSummary) {
                try {
                    await this.api['chat'].put(`/group_sessions/${groupId}`, {
                        all_character_info_summary: combinedSummary
                    });
                    // Always update activeChatGroupSession so next openGroupEdit sees the latest summary
                    if (this.state.activeChatGroupSession) {
                        this.state.activeChatGroupSession.all_character_info_summary = combinedSummary;
                    }
                } catch (e) {
                    console.warn('[GroupCreation] Failed to update group with summary:', e);
                }
            }

            if (isEdit) {
                // Go back to chat view and re-render messages.
                // switchTab('chat') → _openChatDock() clears and re-populates #navibar-dock synchronously.
                // We call _renderCharacterBar immediately after so it prepends before any other paint.
                setSavingState(false);
                this.switchTab('chat');
                this.renderMessages && this.renderMessages();
                this._syncStatusToUI && this._syncStatusToUI();
                if (this.state.activeChatGroupSession) {
                    this._renderCharacterBar && this._renderCharacterBar(this.state.activeChatGroupSession);
                }
            } else {
                // Navigate into the newly created group chat
                setSavingState(false);
                this.openGroupChat && this.openGroupChat(groupId);
            }

        } catch (e) {
            setSavingState(false);
            console.error(e);
            alert('Error saving group: ' + e);
        }
    }
});
