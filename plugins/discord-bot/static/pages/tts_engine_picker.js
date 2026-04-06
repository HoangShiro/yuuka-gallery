window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['tts-engine-picker'] = {
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
        const avatar = speaker.avatar_url
            ? `<img src="${dashboard.Utils.escapeHtml(speaker.avatar_url)}" style="width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: var(--rounded-md) var(--rounded-md) 0 0; display: block;" />`
            : `<div style="width:100%; aspect-ratio: 1 / 1; background: rgba(0,0,0,0.08); border-radius: var(--rounded-md) var(--rounded-md) 0 0; display:flex; align-items:center; justify-content:center;"><span class="material-symbols-outlined" style="opacity:0.55;">record_voice_over</span></div>`;
        const styleLabel = speaker.style_name ? `<div style="font-size: 0.78em; color: var(--color-secondary-text); text-align: center;">${dashboard.Utils.escapeHtml(speaker.style_name)}</div>` : '';
        return `
            <div class="discord-cb-card" data-role="tts-speaker-card" data-speaker-id="${dashboard.Utils.escapeHtml(speakerId)}" data-speaker-name="${dashboard.Utils.escapeHtml(speaker.name || '')}" data-speaker-avatar="${dashboard.Utils.escapeHtml(speaker.avatar_url || '')}" style="cursor: pointer; border: 2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}; border-radius: var(--rounded-md); background: var(--color-card-bg); transition: border-color 0.2s;">
                ${avatar}
                <div style="padding: var(--spacing-2);">
                    <div style="font-weight: 500; font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; text-align: center;">${dashboard.Utils.escapeHtml(speaker.name || 'Unknown')}</div>
                    ${styleLabel}
                </div>
            </div>
        `;
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
            const speakers = Array.isArray(response?.speakers) ? response.speakers : [];
            if (!speakers.length) {
                gridEl.innerHTML = '<div class="discord-bot-module-page-placeholder">No speakers found from this engine.</div>';
                return;
            }
            gridEl.innerHTML = speakers.map((speaker) => this._speakerCardHtml(dashboard, speaker, selectedSpeakerId)).join('');
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
        const speakerIdEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-id"]');
        const speakerNameEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-name"]');
        const speakerAvatarEl = dashboard.modulePageBodyEl.querySelector('[data-role="tts-speaker-avatar"]');
        if (speakerIdEl) speakerIdEl.value = card.getAttribute('data-speaker-id') || '';
        if (speakerNameEl) speakerNameEl.value = card.getAttribute('data-speaker-name') || '';
        if (speakerAvatarEl) speakerAvatarEl.value = card.getAttribute('data-speaker-avatar') || '';
        dashboard.modulePageBodyEl.querySelectorAll('[data-role="tts-speaker-card"]').forEach((item) => {
            item.style.borderColor = 'var(--color-border)';
        });
        card.style.borderColor = 'var(--color-accent)';
        await dashboard._saveBotConfiguration({
            extraProps: this._buildConfigProps(dashboard)
        });
        return true;
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
