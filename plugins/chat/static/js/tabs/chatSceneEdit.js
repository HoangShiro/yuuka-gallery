Object.assign(window.ChatComponent.prototype, {
    // --- Scene Edit Page ---

    openSceneEdit(sceneId, fromChat = false) {
        this.state.editingScene = { id: sceneId, fromChat };

        const titleEl = this.container.querySelector('#scene-edit-title');
        const nameInput = this.container.querySelector('#scene-edit-name');
        const contextInput = this.container.querySelector('#scene-edit-context');
        const coverPreview = this.container.querySelector('#scene-edit-cover');
        const coverInput = this.container.querySelector('#scene-edit-cover-input');
        const genBtn = this.container.querySelector('#btn-scene-generate');

        titleEl.textContent = sceneId ? 'Edit Scene' : 'New Scene';

        // Reset
        nameInput.value = '';
        contextInput.value = '';
        coverPreview.style.backgroundImage = '';
        if (coverInput) coverInput.value = '';
        if (this.state.editingScene) this.state.editingScene.coverBase64 = null;

        if (sceneId && this.state.scenarios?.scenes?.[sceneId]) {
            const scene = this.state.scenarios.scenes[sceneId];
            nameInput.value = scene.name || '';
            contextInput.value = scene.context || '';
            if (scene.cover) {
                coverPreview.style.backgroundImage = `url('${scene.cover}')`;
            }
        }

        // If from chat, auto-generate
        if (fromChat && !sceneId) {
            this.switchTab('scene_edit');
            setTimeout(() => this._autoGenerateSceneFromChat(), 100);
            return;
        }

        this.switchTab('scene_edit');

        // Setup @tag autocomplete
        this._setupTagAutocomplete(contextInput);

        setTimeout(() => {
            contextInput.style.height = 'auto';
            contextInput.style.height = contextInput.scrollHeight + 'px';
        }, 10);
    },

    _setupTagAutocomplete(textarea) {
        // Remove old listener if exists
        if (this._tagAutocompleteHandler) {
            textarea.removeEventListener('input', this._tagAutocompleteHandler);
        }

        const dropdown = this.container.querySelector('#tag-autocomplete-dropdown');
        if (!dropdown) return;

        this._tagAutocompleteHandler = (e) => {
            const value = textarea.value;
            const cursorPos = textarea.selectionStart;

            // Find @ before cursor
            const textBeforeCursor = value.substring(0, cursorPos);
            const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

            if (!atMatch) {
                dropdown.classList.add('hidden');
                return;
            }

            const query = atMatch[1].toLowerCase();
            const suggestions = this._getTagSuggestions(query);

            if (suggestions.length === 0) {
                dropdown.classList.add('hidden');
                return;
            }

            dropdown.innerHTML = '';
            suggestions.forEach(item => {
                const row = document.createElement('div');
                row.className = 'tag-suggestion-item';
                row.innerHTML = `
                    <span class="tag-type-icon material-symbols-outlined">${item.icon}</span>
                    <span class="tag-name">${this.escapeHTML(item.name)}</span>
                    <span class="tag-type-label">${item.typeLabel}</span>
                `;
                row.addEventListener('mousedown', (ev) => {
                    ev.preventDefault();
                    this._insertTag(textarea, atMatch.index, cursorPos, item.name);
                    dropdown.classList.add('hidden');
                });
                dropdown.appendChild(row);
            });

            // Position dropdown
            dropdown.classList.remove('hidden');
        };

        textarea.addEventListener('input', this._tagAutocompleteHandler);

        // Hide dropdown on blur
        textarea.addEventListener('blur', () => {
            setTimeout(() => {
                if (dropdown) dropdown.classList.add('hidden');
            }, 200);
        });
    },

    _getTagSuggestions(query) {
        const suggestions = [];

        // Characters
        Object.values(this.state.personas?.characters || {}).forEach(char => {
            if (char.name && char.name.toLowerCase().includes(query)) {
                suggestions.push({
                    name: char.name,
                    type: 'character',
                    typeLabel: 'Character',
                    icon: 'person'
                });
            }
        });

        // User personas
        Object.values(this.state.personas?.users || {}).forEach(user => {
            if (user.name && user.name.toLowerCase().includes(query)) {
                suggestions.push({
                    name: user.name,
                    type: 'user',
                    typeLabel: 'User',
                    icon: 'face'
                });
            }
        });

        // System instructions (rules)
        Object.values(this.state.scenarios?.rules || {}).forEach(rule => {
            if (rule.name && rule.name.toLowerCase().includes(query)) {
                suggestions.push({
                    name: rule.name,
                    type: 'rule',
                    typeLabel: 'Rule',
                    icon: 'description'
                });
            }
        });

        return suggestions.slice(0, 8);
    },

    _insertTag(textarea, atStart, cursorEnd, tagName) {
        const value = textarea.value;
        const before = value.substring(0, atStart);
        const after = value.substring(cursorEnd);
        const tag = `@[${tagName}]`;

        textarea.value = before + tag + after;

        // Place cursor after tag
        const newPos = atStart + tag.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();

        // Trigger input event for auto-grow
        textarea.dispatchEvent(new Event('input'));
    },

    async handleSceneGenerate() {
        if (this.state.isGeneratingScene) return;

        const contextInput = this.container.querySelector('#scene-edit-context');
        const genBtn = this.container.querySelector('#btn-scene-generate');

        this.state.isGeneratingScene = true;
        const originalHtml = genBtn.innerHTML;
        genBtn.innerHTML = '<span class="material-symbols-outlined sync-spin" style="font-size: 1.1rem; vertical-align: middle;">sync</span> Generating...';
        genBtn.classList.add('loading');

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/scripting/generate_scene', {
                method: 'POST',
                body: JSON.stringify({
                    context: contextInput.value,
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                }),
                headers
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let fullText = '';

            contextInput.value = '';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    fullText += decoder.decode(value, { stream: true });
                    contextInput.value = fullText;
                    contextInput.style.height = 'auto';
                    contextInput.style.height = contextInput.scrollHeight + 'px';
                }
            }
        } catch (e) {
            console.error(e);
            alert('Error generating scene: ' + e);
        } finally {
            this.state.isGeneratingScene = false;
            genBtn.innerHTML = originalHtml;
            genBtn.classList.remove('loading');
        }
    },

    async _autoGenerateSceneFromChat() {
        const nameInput = this.container.querySelector('#scene-edit-name');
        const contextInput = this.container.querySelector('#scene-edit-context');
        const genBtn = this.container.querySelector('#btn-scene-generate');

        if (!this.state.activeChatSession) return;

        this.state.isGeneratingScene = true;
        if (genBtn) {
            genBtn.innerHTML = '<span class="material-symbols-outlined sync-spin" style="font-size: 1.1rem; vertical-align: middle;">sync</span> Generating...';
            genBtn.classList.add('loading');
        }

        const charHash = this.state.activeChatCharacterHash;
        const charObj = this.state.personas.characters[charHash] || {};
        const userObj = this.state.personas.users[this.state.activeUserPersonaId] || {};

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/scripting/auto_scene', {
                method: 'POST',
                body: JSON.stringify({
                    character_name: charObj.name || '',
                    character_persona: charObj.persona || '',
                    user_name: userObj.name || '',
                    user_persona: userObj.persona || '',
                    messages: this.state.activeChatSession.messages || [],
                    memory_summary: this.state.activeChatSession.memory_summary || '',
                    session_state: {
                        location: this.state.activeChatSession.character_states?.[charHash]?.location || '',
                        outfits: this.state.activeChatSession.character_states?.[charHash]?.outfits || [],
                        inventory: this.state.activeChatSession.character_states?.[charHash]?.inventory || []
                    },
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                }),
                headers
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let fullText = '';

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    fullText += decoder.decode(value, { stream: true });

                    // Parse NAME: line
                    if (fullText.includes('\n')) {
                        const firstLine = fullText.split('\n')[0];
                        if (firstLine.startsWith('NAME: ')) {
                            nameInput.value = firstLine.replace('NAME: ', '').trim();
                            contextInput.value = fullText.split('\n').slice(1).join('\n').trim();
                        } else {
                            contextInput.value = fullText;
                        }
                    } else {
                        contextInput.value = fullText;
                    }

                    contextInput.style.height = 'auto';
                    contextInput.style.height = contextInput.scrollHeight + 'px';
                }
            }
        } catch (e) {
            console.error(e);
            alert('Error auto-generating scene: ' + e);
        } finally {
            this.state.isGeneratingScene = false;
            if (genBtn) {
                genBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">auto_awesome</span> Generate';
                genBtn.classList.remove('loading');
            }
        }
    },

    async handleSaveScene() {
        const nameInput = this.container.querySelector('#scene-edit-name');
        const contextInput = this.container.querySelector('#scene-edit-context');
        const coverPreview = this.container.querySelector('#scene-edit-cover');

        const name = nameInput.value.trim();
        if (!name) {
            alert('Please enter a scene name.');
            return;
        }

        const payload = {
            name,
            context: contextInput.value
        };

        // Handle cover image
        if (this.state.editingScene?.coverBase64) {
            payload.cover = this.state.editingScene.coverBase64;
        } else {
            const bgImg = coverPreview.style.backgroundImage;
            if (bgImg && bgImg !== "url('')") {
                payload.cover = bgImg.slice(5, -2).replace(/"/g, '');
            }
        }

        const sceneId = this.state.editingScene?.id;
        const endpoint = sceneId
            ? `/scenarios/scenes/${sceneId}`
            : '/scenarios/scenes';

        try {
            const res = await this.api['chat'].post(endpoint, payload);
            if (res.status === 'success') {
                if (!this.state.scenarios) this.state.scenarios = { scenes: {}, rules: {} };
                this.state.scenarios.scenes[res.data.id] = res.data;

                // Return to scenario page or previous tab
                if (this.state.editingScene?.fromChat) {
                    this.switchTab('chat');
                } else {
                    this.switchTab('scenario');
                    this._renderScenarioPage();
                }
            } else {
                alert('Save failed: ' + (res.error || 'Unknown'));
            }
        } catch (e) {
            console.error(e);
            alert('Error saving scene.');
        }
    }
});
