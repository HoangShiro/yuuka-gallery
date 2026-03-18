Object.assign(window.ChatComponent.prototype, {
    // --- Creation Methods ---

    openCreation(type, id = null) {
        this.state.editingPersona = { type, id };

        const isEditing = id != null;
        if (type === 'characters') {
            this.container.querySelector('#creation-title').textContent = isEditing ? 'Edit Character' : 'New Character';
        } else {
            this.container.querySelector('#creation-title').textContent = isEditing ? 'Edit Persona' : 'New Persona';
        }

        // Show Delete button only when editing an existing persona
        const deleteBtn = this.container.querySelector('#btn-delete-persona');
        if (deleteBtn) deleteBtn.style.display = isEditing ? 'inline-flex' : 'none';

        // Remove group-creation delete button if it was left over from a previous group edit
        const groupDeleteBtn = this.container.querySelector('#btn-delete-group-creation');
        if (groupDeleteBtn) groupDeleteBtn.remove();

        const chatSampleGroup = this.container.querySelector('#group-chat-sample');
        const appearanceGroup = this.container.querySelector('#group-appearance');
        const outfitsGroup = this.container.querySelector('#group-outfits');

        chatSampleGroup.style.display = type === 'characters' ? 'flex' : 'none';
        
        if (appearanceGroup) {
            appearanceGroup.style.display = type === 'characters' ? 'flex' : 'none';
            appearanceGroup.style.flexDirection = 'column';
            appearanceGroup.style.alignItems = 'stretch';
        }

        if (outfitsGroup) {
            outfitsGroup.style.display = type === 'characters' ? 'flex' : 'none';
            outfitsGroup.style.flexDirection = 'column';
            outfitsGroup.style.alignItems = 'stretch';

            // YUUKA: Init Autocomplete cho booru tags
            if (type === 'characters') {
                let tagService = window.Yuuka?.services?.tagDataset;
                if (!tagService) {
                    window.Yuuka = window.Yuuka || {};
                    window.Yuuka.services = window.Yuuka.services || {};
                    tagService = window.Yuuka.services.tagDataset = {
                        data: null, promise: null, lastFetched: 0, ttl: 1000 * 60 * 60 * 6,
                        prefetch(apiObj) {
                            if (this.data && (Date.now() - this.lastFetched) < this.ttl) return Promise.resolve(this.data);
                            if (this.promise) return this.promise;
                            if (!apiObj || typeof apiObj.getTags !== 'function') return Promise.resolve([]);
                            this.promise = apiObj.getTags().then(arr => {
                                this.data = Array.isArray(arr) ? arr : [];
                                this.lastFetched = Date.now();
                                return this.data;
                            }).catch(() => []).finally(() => this.promise = null);
                            return this.promise;
                        },
                        get() { return Array.isArray(this.data) ? this.data : []; },
                        clear() { this.data = null; this.lastFetched = 0; }
                    };
                }

                if (tagService) {
                    let tagPredictions = tagService.get();
                    if (!tagPredictions.length) {
                        tagService.prefetch(this.api).then(fresh => {
                            if (window.Yuuka?.ui?._initTagAutocomplete && appearanceGroup) {
                                try { window.Yuuka.ui._initTagAutocomplete(appearanceGroup, fresh); } catch (_) { }
                            }
                            if (window.Yuuka?.ui?._initTagAutocomplete && outfitsGroup) {
                                try { window.Yuuka.ui._initTagAutocomplete(outfitsGroup, fresh); } catch (_) { }
                            }
                        });
                    } else {
                        if (window.Yuuka?.ui?._initTagAutocomplete && appearanceGroup) {
                            try { window.Yuuka.ui._initTagAutocomplete(appearanceGroup, tagPredictions); } catch (_) { }
                        }
                        if (window.Yuuka?.ui?._initTagAutocomplete && outfitsGroup) {
                            try { window.Yuuka.ui._initTagAutocomplete(outfitsGroup, tagPredictions); } catch (_) { }
                        }
                    }
                }
            }
        }

        const nameInput = this.container.querySelector('#creation-name');
        const appearanceInput = this.container.querySelector('#creation-appearance');
        const outfitsInput = this.container.querySelector('#creation-outfits');
        const personaInput = this.container.querySelector('#creation-persona');
        const chatSampleInput = this.container.querySelector('#creation-chat-sample');
        const avatarPreview = this.container.querySelector('#creation-avatar');
        const avatarInput = this.container.querySelector('#creation-avatar-input');

        nameInput.value = '';
        if (appearanceInput) appearanceInput.value = '';
        if (outfitsInput) outfitsInput.value = '';
        personaInput.value = '';
        chatSampleInput.value = '';
        avatarPreview.style.backgroundImage = '';
        if (avatarInput) avatarInput.value = '';

        if (isEditing) {
            let data = null;
            if (type === 'characters') {
                data = this.state.personas.characters[id];
                if (!data && this.state.charactersInfo[id]) {
                    nameInput.value = this.state.charactersInfo[id].name;
                    avatarPreview.style.backgroundImage = `url('/image/${id}')`;
                }
            } else {
                data = this.state.personas.users[id];
            }

            if (data) {
                nameInput.value = data.name || '';
                personaInput.value = data.persona || '';
                if (type === 'characters') {
                    chatSampleInput.value = data.chat_sample || '';
                    if (appearanceInput) appearanceInput.value = (data.appearance || []).join(', ');
                    if (outfitsInput) outfitsInput.value = (data.default_outfits || []).join(', ');
                }
                if (data.avatar) {
                    avatarPreview.style.backgroundImage = `url('${data.avatar}')`;
                } else if (type === 'characters' && id) {
                    avatarPreview.style.backgroundImage = `url('/image/${id}')`;
                }
            }
        } else if (type === 'characters' && id) {
            const info = this.state.charactersInfo[id];
            if (info) {
                nameInput.value = info.name;
            }
            avatarPreview.style.backgroundImage = `url('/image/${id}')`;
        }

        this.switchTab('creation');

        setTimeout(() => {
            personaInput.style.height = 'auto';
            personaInput.style.height = personaInput.scrollHeight + 'px';
            chatSampleInput.style.height = 'auto';
            chatSampleInput.style.height = chatSampleInput.scrollHeight + 'px';
        }, 10);
    },

    async handleAIGeneratePersona() {
        if (this.state.isGeneratingPersonaStreaming) return;

        const nameInput = this.container.querySelector('#creation-name').value;
        const genBtn = this.container.querySelector('#btn-ai-gen-persona');
        const personaInput = this.container.querySelector('#creation-persona');
        const chatSampleInput = this.container.querySelector('#creation-chat-sample');

        if (!nameInput) {
            alert('Vui lòng nhập Name trước khi Generate.');
            return;
        }

        this.state.isGeneratingPersonaStreaming = true;
        genBtn.classList.add('loading');
        const originalHtml = genBtn.innerHTML;
        genBtn.innerHTML = '<span class="material-symbols-outlined sync-spin" style="font-size: 1.1rem; vertical-align: middle;">sync</span> Generating...';

        const traitsVal = personaInput.value;
        personaInput.value = '';
        if (chatSampleInput) chatSampleInput.value = '';

        try {
            const isCharacter = this.state.editingPersona.type === 'characters';
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/generate/persona_stream', {
                method: 'POST',
                body: JSON.stringify({
                    name: nameInput,
                    traits: traitsVal,
                    generate_sample: isCharacter,
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                }),
                headers: headers
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let done = false;
            let fullText = '';

            const SPLIT_TOKEN = "---CHAT_SAMPLE---";
            let foundSplit = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    fullText += chunk;

                    if (isCharacter) {
                        if (!foundSplit) {
                            if (fullText.includes(SPLIT_TOKEN)) {
                                foundSplit = true;
                                const parts = fullText.split(SPLIT_TOKEN);
                                personaInput.value = parts[0].trim();
                                if (chatSampleInput) chatSampleInput.value = parts[1] ? parts[1].trim() : '';
                            } else {
                                personaInput.value = fullText;
                            }
                        } else {
                            const parts = fullText.split(SPLIT_TOKEN);
                            personaInput.value = parts[0].trim();
                            if (chatSampleInput) chatSampleInput.value = parts[1] ? parts[1].trim() : '';
                        }
                    } else {
                        personaInput.value = fullText;
                    }

                    personaInput.style.height = 'auto';
                    personaInput.style.height = personaInput.scrollHeight + 'px';
                    if (chatSampleInput && foundSplit) {
                        chatSampleInput.style.height = 'auto';
                        chatSampleInput.style.height = chatSampleInput.scrollHeight + 'px';
                    }
                }
            }
        } catch (e) {
            console.error(e);
            alert('Lỗi kết nối hoặc generate: ' + e);
        } finally {
            this.state.isGeneratingPersonaStreaming = false;
            genBtn.classList.remove('loading');
            genBtn.innerHTML = originalHtml;
        }
    },

    async handleSaveCreation() {
        const { type, id } = this.state.editingPersona;
        const nameInput = this.container.querySelector('#creation-name').value;
        const appearanceInputArea = this.container.querySelector('#creation-appearance');
        const outfitsInputArea = this.container.querySelector('#creation-outfits');
        const personaInput = this.container.querySelector('#creation-persona').value;
        const chatSampleInput = this.container.querySelector('#creation-chat-sample').value;
        const avatarStyle = this.container.querySelector('#creation-avatar').style.backgroundImage;
        let avatarUrl = '';
        if (avatarStyle) {
            avatarUrl = avatarStyle.slice(5, -2).replace(/"/g, "");
            if (avatarUrl.startsWith('/image/')) avatarUrl = '';
        }

        const avatarBase64 = this.state.editingPersona?.avatarBase64;

        const payload = {
            name: nameInput,
            persona: personaInput,
            avatar: avatarUrl
        };

        if (avatarBase64) {
            payload.avatar_base64 = avatarBase64;
        }

        if (type === 'characters') {
            payload.chat_sample = chatSampleInput;
            let appearanceList = [];
            if (appearanceInputArea && appearanceInputArea.value.trim()) {
                appearanceList = appearanceInputArea.value.split(',').map(s => s.trim()).filter(s => s);
            }
            payload.appearance = appearanceList;

            let outfitsList = [];
            if (outfitsInputArea && outfitsInputArea.value.trim()) {
                outfitsList = outfitsInputArea.value.split(',').map(s => s.trim()).filter(s => s);
            }
            payload.default_outfits = outfitsList;
        }

        const endpointId = id ? `/${id}` : '';
        try {
            const res = await this.api['chat'].post(`/personas/${type}${endpointId}`, payload);
            if (res.status === 'success') {
                if (!this.state.personas[type]) this.state.personas[type] = {};
                this.state.personas[type][res.data.id] = res.data;
                this.switchTab(this.state.previousTab || 'home');
            } else {
                alert('Lưu thất bại: ' + res.error);
            }
        } catch (e) {
            console.error(e);
            alert('Lỗi khi lưu.');
        }
    },

    async handleDeletePersona() {
        const { type, id } = this.state.editingPersona;
        if (!id) return;

        const name = this.container.querySelector('#creation-name').value || 'this character';
        const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
            ? (msg) => window.Yuuka.ui.confirm(msg)
            : (msg) => Promise.resolve(window.confirm(msg));
        if (!await confirmFn(`Delete "${name}"? This cannot be undone.`)) return;

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = {};
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch(`/api/plugin/chat/personas/${type}/${id}`, {
                method: 'DELETE',
                headers
            });

            if (!res.ok) throw new Error(await res.text());

            // Remove from local state
            if (this.state.personas[type]) {
                delete this.state.personas[type][id];
            }

            this.switchTab(this.state.previousTab || 'home');
        } catch (e) {
            console.error(e);
            alert('Lỗi khi xóa.');
        }
    }
});
