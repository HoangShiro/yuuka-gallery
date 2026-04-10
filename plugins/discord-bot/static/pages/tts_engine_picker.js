window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['tts-engine-picker'] = {
    _speakerAvatarMap: {},
    _speakerGridScrollTop: {},
    _currentAudio: null,
    _currentAudioUrl: null,
    _currentAudioAbort: null,
    _sampleRequestSeq: 0,

    getEngineOptions: function() {
        return [
            { value: 'aivisspeech', label: 'AivisSpeech' }
        ];
    },

    getTextSourceOptions: function(moduleUi) {
        const primaryLanguage = moduleUi.chat_primary_language || 'Primary language';
        const secondaryLanguage = moduleUi.chat_secondary_language || 'Secondary language';
        return [
            { value: 'secondary', label: `Secondary language (${secondaryLanguage})` },
            { value: 'primary', label: `Primary language (${primaryLanguage})` }
        ];
    },

    render: function(dashboard, module, moduleUi) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Text To Speech</h4>
                    <p>Create or connect a bot first to configure.</p>
                </section>
            `;
        }

        const selectedEngine = moduleUi.tts_engine || 'aivisspeech';
        const baseUrl = moduleUi.tts_engine_base_url || 'http://127.0.0.1:10101';
        const selectedSpeakerId = String(moduleUi.tts_speaker_id || '');
        const selectedSpeakerName = moduleUi.tts_speaker_name || '';
        const selectedAvatarUrl = moduleUi.tts_speaker_avatar_url || '';
        const selectedTextSource = moduleUi.tts_text_source || 'secondary';

        setTimeout(() => this._loadAndRenderSpeakers(dashboard, moduleUi), 0);

        return `
            <section class="discord-bot-module-page-section">
                <h4>Engine</h4>
                <div class="discord-policy-settings" style="margin-bottom: var(--spacing-4);">
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Engine</span>
                        <select class="discord-policy-setting__input" data-role="tts-engine">
                            ${this.getEngineOptions().map((engine) => `<option value="${dashboard.Utils.escapeHtml(engine.value)}" ${engine.value === selectedEngine ? 'selected' : ''}>${dashboard.Utils.escapeHtml(engine.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Base URL</span>
                        <input type="text" class="discord-policy-setting__input" data-role="tts-base-url" value="${dashboard.Utils.escapeHtml(baseUrl)}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Text source</span>
                        <select class="discord-policy-setting__input" data-role="tts-text-source">
                            ${this.getTextSourceOptions(moduleUi).map((item) => `<option value="${dashboard.Utils.escapeHtml(item.value)}" ${item.value === selectedTextSource ? 'selected' : ''}>${dashboard.Utils.escapeHtml(item.label)}</option>`).join('')}
                        </select>
                    </label>
                </div>

                <h4>Speaker</h4>
                <div class="discord-bot-character-picker">
                    <div class="discord-bot-character-grid" data-role="tts-speaker-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--spacing-3); max-height: 420px; overflow-y: auto;">
                        <div class="discord-bot-module-page-loading">Loading speakers...</div>
                    </div>
                </div>
                <input type="hidden" data-role="tts-speaker-id" value="${dashboard.Utils.escapeHtml(selectedSpeakerId)}">
                <input type="hidden" data-role="tts-speaker-name" value="${dashboard.Utils.escapeHtml(selectedSpeakerName)}">
                <input type="hidden" data-role="tts-speaker-avatar" value="${dashboard.Utils.escapeHtml(selectedAvatarUrl)}">
            </section>
        `;
    },

    _speakerCardHtml: function(dashboard, speaker, selectedSpeakerId) {
        const speakerId = String(speaker.id || '');
        const isSelected = speakerId === String(selectedSpeakerId || '');
        const avatarUrl = (speaker.avatar_key && this._speakerAvatarMap[speaker.avatar_key]) || speaker.avatar_url || '';
        const avatar = avatarUrl
            ? `<img src="${dashboard.Utils.escapeHtml(avatarUrl)}" style="width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: var(--rounded-md) var(--rounded-md) 0 0; display: block;" />`
            : `<div style="width:100%; aspect-ratio: 1 / 1; background: rgba(0,0,0,0.08); border-radius: var(--rounded-md) var(--rounded-md) 0 0; display:flex; align-items:center; justify-content:center;"><span class="material-symbols-outlined" style="opacity:0.55;">record_voice_over</span></div>`;
        const styleLabel = speaker.style_name ? `<div style="font-size: 0.78em; color: var(--color-secondary-text); text-align: center;">${dashboard.Utils.escapeHtml(speaker.style_name)}</div>` : '';
        return `
            <div class="discord-cb-card" data-role="tts-speaker-card" data-speaker-id="${dashboard.Utils.escapeHtml(speakerId)}" data-speaker-name="${dashboard.Utils.escapeHtml(speaker.name || '')}" data-speaker-avatar="${dashboard.Utils.escapeHtml(speaker.avatar_url || '')}" data-speaker-avatar-key="${dashboard.Utils.escapeHtml(speaker.avatar_key || '')}" style="cursor: pointer; border: 2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}; border-radius: var(--rounded-md); background: var(--color-card-bg); transition: border-color 0.2s;">
                ${avatar}
                <div style="padding: var(--spacing-2);">
                    <div style="font-weight: 500; font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; text-align: center;">${dashboard.Utils.escapeHtml(speaker.name || 'Unknown')}</div>
                    ${styleLabel}
                </div>
            </div>
        `;
    },

    _speakerListStateKey: function(dashboard) {
        const botId = dashboard?.state?.activeBot?.bot_id || 'default';
        const engine = dashboard?.modulePageBodyEl?.querySelector('[data-role="tts-engine"]')?.value || 'aivisspeech';
        const baseUrl = dashboard?.modulePageBodyEl?.querySelector('[data-role="tts-base-url"]')?.value || 'http://127.0.0.1:10101';
        return `${botId}::${engine}::${baseUrl}`;
    },

    _rememberSpeakerGridScroll: function(dashboard) {
        const gridEl = dashboard?.modulePageBodyEl?.querySelector('[data-role="tts-speaker-grid"]');
        if (!gridEl) {
            return;
        }
        this._speakerGridScrollTop[this._speakerListStateKey(dashboard)] = gridEl.scrollTop;
    },

    _restoreSpeakerGridScroll: function(dashboard, gridEl) {
        if (!gridEl) {
            return;
        }
        const savedScrollTop = this._speakerGridScrollTop[this._speakerListStateKey(dashboard)];
        if (Number.isFinite(savedScrollTop) && savedScrollTop > 0) {
            gridEl.scrollTop = savedScrollTop;
        }
    },

    _loadAndRenderSpeakers: async function(dashboard, moduleUi) {
        if (!dashboard.modulePageBodyEl) return;
        const gridEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-grid"]');
        if (!gridEl) return;

        const engine = dashboard.modulePageBodyEl.querySelector('[data-role="tts-engine"]')?.value || moduleUi.tts_engine || 'aivisspeech';
        const baseUrl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-base-url"]')?.value || moduleUi.tts_engine_base_url || 'http://127.0.0.1:10101';
        const selectedSpeakerId = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-id"]')?.value || moduleUi.tts_speaker_id || '';
        try {
            const query = new URLSearchParams({
                bot_id: dashboard.state.activeBot?.bot_id || '',
                engine,
                base_url: baseUrl,
            });
            const response = await dashboard.pluginApi.get(`/tts/speakers?${query.toString()}`);
            this._speakerAvatarMap = response && typeof response.avatars === 'object' && response.avatars ? response.avatars : {};
            const speakers = Array.isArray(response?.speakers) ? response.speakers : [];
            if (!speakers.length) {
                gridEl.innerHTML = '<div class="discord-bot-module-page-placeholder">No speakers found from this engine.</div>';
                return;
            }
            gridEl.innerHTML = speakers.map((speaker) => this._speakerCardHtml(dashboard, speaker, selectedSpeakerId)).join('');
            this._restoreSpeakerGridScroll(dashboard, gridEl);
        } catch (error) {
            gridEl.innerHTML = `<div class="discord-bot-module-page-error">Failed to load speakers: ${dashboard.Utils.escapeHtml(error.message || 'Unknown error')}</div>`;
        }
    },

    _buildConfigProps: function(dashboard) {
        const engine = dashboard.modulePageBodyEl.querySelector('[data-role="tts-engine"]')?.value || 'aivisspeech';
        const baseUrl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-base-url"]')?.value || 'http://127.0.0.1:10101';
        const textSource = dashboard.modulePageBodyEl.querySelector('[data-role="tts-text-source"]')?.value || 'secondary';
        const speakerId = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-id"]')?.value || '';
        const speakerName = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-name"]')?.value || '';
        const speakerAvatar = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-avatar"]')?.value || '';
        return {
            tts_engine: engine,
            tts_engine_base_url: baseUrl,
            tts_text_source: textSource,
            tts_speaker_id: speakerId,
            tts_speaker_name: speakerName,
            tts_speaker_avatar_url: speakerAvatar,
        };
    },

    onClick: async function(dashboard, event) {
        const card = event.target.closest('[data-role="tts-speaker-card"]');
        if (!card || !dashboard.modulePageBodyEl.contains(card)) {
            return false;
        }

        this._rememberSpeakerGridScroll(dashboard);

        const speakerId = card.getAttribute('data-speaker-id') || '';
        const speakerName = card.getAttribute('data-speaker-name') || '';
        const speakerAvatarKey = card.getAttribute('data-speaker-avatar-key') || '';
        const speakerAvatar = (speakerAvatarKey && this._speakerAvatarMap[speakerAvatarKey]) || card.getAttribute('data-speaker-avatar') || '';

        const speakerIdEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-id"]');
        const speakerNameEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-name"]');
        const speakerAvatarEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-avatar"]');
        
        if (speakerIdEl) speakerIdEl.value = speakerId;
        if (speakerNameEl) speakerNameEl.value = speakerName;
        if (speakerAvatarEl) speakerAvatarEl.value = speakerAvatar;

        dashboard.modulePageBodyEl.querySelectorAll('[data-role="tts-speaker-card"]').forEach((item) => {
            item.style.borderColor = 'var(--color-border)';
            item.style.boxShadow = 'none';
        });
        card.style.borderColor = 'var(--color-accent)';
        card.style.boxShadow = '0 0 0 2px var(--color-accent-transparent, rgba(255, 107, 107, 0.2))';

        const saved = await dashboard._saveBotConfiguration({
            extraProps: this._buildConfigProps(dashboard),
            showSuccessMessage: false
        });
        if (!saved) {
            return false;
        }

        // Save first so a running bot receives the hot-reloaded speaker before preview playback.
        this._playSample(dashboard, speakerId);
        return true;
    },

    _stopCurrentSample: function() {
        if (this._currentAudioAbort) {
            this._currentAudioAbort.abort();
            this._currentAudioAbort = null;
        }
        if (this._currentAudio) {
            this._currentAudio.oncanplaythrough = null;
            this._currentAudio.onerror = null;
            this._currentAudio.onended = null;
            this._currentAudio.pause();
            this._currentAudio.src = '';
            this._currentAudio = null;
        }
        if (this._currentAudioUrl) {
            URL.revokeObjectURL(this._currentAudioUrl);
            this._currentAudioUrl = null;
        }
    },

    _playSample: async function(dashboard, speakerId) {
        if (!speakerId) {
            return;
        }

        const requestSeq = ++this._sampleRequestSeq;

        const engine = dashboard.modulePageBodyEl.querySelector('[data-role="tts-engine"]')?.value || 'aivisspeech';
        const baseUrl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-base-url"]')?.value || 'http://127.0.0.1:10101';

        const query = new URLSearchParams({
            speaker_id: speakerId,
            engine: engine,
            base_url: baseUrl
        });

        // Ensure absolute URL for Audio
        let apiBase = dashboard.pluginApi.baseUrl || '/api/plugin/discord-bot';
        if (!apiBase.includes('/api/plugin/discord-bot')) {
            // Fallback if baseUrl is just the root or something else
            apiBase = apiBase.replace(/\/$/, '') + '/api/plugin/discord-bot';
        }
        if (apiBase.startsWith('/')) {
            apiBase = window.location.origin + apiBase;
        }
        const sampleUrl = `${apiBase}/tts/sample?${query.toString()}`;

        this._stopCurrentSample();

        try {
            const authToken = window.localStorage.getItem('yuuka-auth-token');
            const abortController = new AbortController();
            this._currentAudioAbort = abortController;
            const response = await fetch(sampleUrl, {
                method: 'GET',
                headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
                cache: 'no-store',
                signal: abortController.signal
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                const contentType = response.headers.get('content-type') || '';
                try {
                    if (contentType.includes('application/json')) {
                        const payload = await response.json();
                        errorMessage = payload?.description || payload?.error || errorMessage;
                    } else {
                        const text = await response.text();
                        if (text) {
                            errorMessage = text;
                        }
                    }
                } catch (err) {}
                throw new Error(errorMessage);
            }

            const audioBuffer = await response.arrayBuffer();
            if (!audioBuffer.byteLength) {
                throw new Error('Received empty audio data from engine');
            }

            const header = new Uint8Array(audioBuffer.slice(0, 4));
            const riff = String.fromCharCode(...header);
            if (riff !== 'RIFF') {
                throw new Error('TTS engine returned an invalid WAV payload');
            }

            const contentType = (response.headers.get('content-type') || 'audio/wav').split(';')[0].trim() || 'audio/wav';
            const audioBlob = new Blob([audioBuffer], { type: contentType });

            const objectUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio();
            audio.preload = 'auto';
            this._currentAudio = audio;
            this._currentAudioUrl = objectUrl;

            await new Promise((resolve, reject) => {
                audio.oncanplaythrough = () => resolve();
                audio.onerror = (e) => reject(new Error(`Audio element failed to decode preview (${audio.error?.code || 'unknown'})`));
                audio.src = objectUrl;
                audio.load();
            });

            if (requestSeq !== this._sampleRequestSeq) {
                audio.oncanplaythrough = null;
                audio.onerror = null;
                audio.onended = null;
                audio.pause();
                audio.src = '';
                URL.revokeObjectURL(objectUrl);
                if (this._currentAudio === audio) {
                    this._currentAudio = null;
                }
                if (this._currentAudioUrl === objectUrl) {
                    this._currentAudioUrl = null;
                }
                return;
            }

            audio.onended = () => {
                if (this._currentAudio === audio) {
                    this._stopCurrentSample();
                }
            };
            await audio.play();
        } catch (err) {
            if (err?.name === 'AbortError') {
                return;
            }
            this._stopCurrentSample();
        } finally {
            if (requestSeq === this._sampleRequestSeq) {
                this._currentAudioAbort = null;
            }
        }
    },

    onChange: async function(dashboard, event) {
        const input = event.target.closest('[data-role="tts-engine"], [data-role="tts-base-url"], [data-role="tts-text-source"]');
        if (!input || !dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }
        await dashboard._saveBotConfiguration({
            extraProps: this._buildConfigProps(dashboard)
        });
        if (input.matches('[data-role="tts-engine"], [data-role="tts-base-url"]')) {
            setTimeout(() => this._loadAndRenderSpeakers(dashboard, this._buildConfigProps(dashboard)), 0);
        }
        return true;
    }
};
