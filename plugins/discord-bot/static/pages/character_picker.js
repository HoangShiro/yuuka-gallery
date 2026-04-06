window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['character-picker'] = {
    getLanguageOptions: function() {
        return [
            'English',
            'Japanese',
            'Vietnamese',
            'Chinese',
            'Korean',
            'Spanish',
            'French',
            'German'
        ];
    },

    buildLanguageOptionsHtml: function(selectedValue) {
        return this.getLanguageOptions().map((language) => (
            `<option value="${language}" ${language === selectedValue ? 'selected' : ''}>${language}</option>`
        )).join('');
    },

    render: function(dashboard, module, moduleUi) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Character</h4>
                    <p>Create or connect a bot first to configure.</p>
                </section>
            `;
        }
        const selectedId = moduleUi.chat_character_id || '';
        const selectedName = moduleUi.chat_character_name || '';
        const bUrl = moduleUi.chat_bridge_url || '';
        const bKey = moduleUi.chat_bridge_key || '';
        const primaryLanguage = moduleUi.chat_primary_language || 'English';
        const secondaryLanguage = moduleUi.chat_secondary_language || 'Japanese';
        const secondaryToChannel = !!moduleUi.chat_secondary_to_channel;
        
        setTimeout(() => this._loadAndRenderCharacterGrid(dashboard, selectedId), 0);

        return `
            <section class="discord-bot-module-page-section">
                <h4>Bridge Network</h4>
                <div class="discord-policy-settings" style="margin-bottom: var(--spacing-4);">
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Bridge URL (Optional)</span>
                        <input type="text" class="discord-policy-setting__input" data-role="cb-url" value="${dashboard.Utils.escapeHtml(bUrl)}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Bridge Key</span>
                        <input type="password" class="discord-policy-setting__input" data-role="cb-key" value="${dashboard.Utils.escapeHtml(bKey)}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Primary language</span>
                        <select class="discord-policy-setting__input" data-role="cb-primary-language">${this.buildLanguageOptionsHtml(primaryLanguage)}</select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Secondary language</span>
                        <select class="discord-policy-setting__input" data-role="cb-secondary-language">${this.buildLanguageOptionsHtml(secondaryLanguage)}</select>
                    </label>
                    <div class="discord-policy-setting" style="display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-3);">
                        <span class="discord-policy-setting__label" style="margin: 0;">Send secondary language to channel</span>
                        <label class="yuuka-switch" title="Send secondary language to channel">
                            <input type="checkbox" data-role="cb-secondary-to-channel" ${secondaryToChannel ? 'checked' : ''} />
                            <span class="yuuka-switch__slider"></span>
                        </label>
                    </div>
                </div>
                
                <h4>Character <span style="font-size: 0.8em; color: var(--color-secondary-text); font-weight: normal;">(Only characters with persona are shown)</span></h4>
                <div class="discord-bot-character-picker">
                    <input type="search" class="discord-policy-setting__input" style="width: 100%; margin-bottom: var(--spacing-3);" data-role="cb-search" placeholder="Search characters...">
                    <div class="discord-bot-character-grid" data-role="cb-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: var(--spacing-3); max-height: 400px; overflow-y: auto;">
                        <div class="discord-bot-module-page-loading">Loading characters...</div>
                    </div>
                </div>
                <input type="hidden" data-role="cb-selected" value="${dashboard.Utils.escapeHtml(selectedId)}">
                <input type="hidden" data-role="cb-selected-name" value="${dashboard.Utils.escapeHtml(selectedName)}">
            </section>
        `;
    },

    _loadAndRenderCharacterGrid: async function(dashboard, selectedId) {
        if (!dashboard.modulePageBodyEl) return;
        const gridEl = dashboard.modulePageBodyEl.querySelector('[data-role="cb-grid"]');
        const searchEl = dashboard.modulePageBodyEl.querySelector('[data-role="cb-search"]');
        if (!gridEl) return;
        
        try {
            if (!dashboard.api['chat']) throw new Error('Chat plugin is not active/available.');
            const res = await dashboard.api['chat'].get('/personas');
            let chars = Object.values(res.characters || {}).filter(c => c && c.persona && c.persona.trim().length > 0);
            
            const renderGrid = (query = '') => {
                const q = query.toLowerCase().trim();
                const filtered = chars.filter(c => c.name.toLowerCase().includes(q) || (c.persona && c.persona.toLowerCase().includes(q)));
                
                if (filtered.length === 0) {
                    gridEl.innerHTML = '<div class="discord-bot-module-page-placeholder">No characters found.</div>';
                    return;
                }
                
                const cardsHtml = filtered.map(c => {
                    const isSelected = c.id === selectedId;
                    const avatar = c.avatar ? `<img src="${c.avatar}" style="width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: var(--rounded-md) var(--rounded-md) 0 0; display: block;" />` : `<div style="width:100%; aspect-ratio: 3/4; background: rgba(0,0,0,0.1); border-radius: var(--rounded-md) var(--rounded-md) 0 0; display:flex; align-items:center; justify-content:center;"><span class="material-symbols-outlined" style="opacity:0.5;">person</span></div>`;
                    return `
                        <div class="discord-cb-card" data-role="cb-card" data-id="${dashboard.Utils.escapeHtml(c.id)}" style="cursor: pointer; border: 2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}; border-radius: var(--rounded-md); background: var(--color-card-bg); transition: border-color 0.2s;">
                            ${avatar}
                            <div style="padding: var(--spacing-2);">
                                <div style="font-weight: 500; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;">${dashboard.Utils.escapeHtml(c.name || 'Unnamed')}</div>
                            </div>
                        </div>
                    `;
                }).join('');
                
                const isNoneSelected = !selectedId;
                const noneCardHtml = `
                    <div class="discord-cb-card" data-role="cb-card" data-id="" style="cursor: pointer; border: 2px solid ${isNoneSelected ? 'var(--color-accent)' : 'var(--color-border)'}; border-radius: var(--rounded-md); background: var(--color-card-bg); transition: border-color 0.2s;">
                        <div style="width:100%; aspect-ratio: 3/4; background: rgba(0,0,0,0.05); border-radius: var(--rounded-md) var(--rounded-md) 0 0; display:flex; align-items:center; justify-content:center;">
                            <span class="material-symbols-outlined" style="opacity: 0.5; font-size: 32px;">person_off</span>
                        </div>
                        <div style="padding: var(--spacing-2);">
                            <div style="font-weight: 500; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; color: var(--color-secondary-text);">None</div>
                        </div>
                    </div>
                `;
                
                gridEl.innerHTML = noneCardHtml + cardsHtml;
                
                // Update hidden name if found natively
                if (selectedId) {
                    const sel = chars.find(c => c.id === selectedId);
                    if (sel) {
                        const hName = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected-name"]');
                        if (hName) hName.value = sel.name || '';
                    }
                }
            };
            
            renderGrid();
            
            if (searchEl) {
                searchEl.oninput = (e) => renderGrid(e.target.value);
            }
        } catch (e) {
            gridEl.innerHTML = `<div class="discord-bot-module-page-error">Failed to load characters: ${e.message}</div>`;
        }
    },

    _buildConfigProps: function(dashboard) {
        const bUrl = dashboard.modulePageBodyEl.querySelector('[data-role="cb-url"]')?.value || '';
        const bKey = dashboard.modulePageBodyEl.querySelector('[data-role="cb-key"]')?.value || '';
        const cId = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected"]')?.value || '';
        const cName = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected-name"]')?.value || '';
        const primaryLanguage = dashboard.modulePageBodyEl.querySelector('[data-role="cb-primary-language"]')?.value || 'English';
        const secondaryLanguage = dashboard.modulePageBodyEl.querySelector('[data-role="cb-secondary-language"]')?.value || 'Japanese';
        const secondaryToChannel = !!dashboard.modulePageBodyEl.querySelector('[data-role="cb-secondary-to-channel"]')?.checked;
        return {
            chat_character_id: cId,
            chat_character_name: cName,
            chat_bridge_url: bUrl,
            chat_bridge_key: bKey,
            chat_primary_language: primaryLanguage,
            chat_secondary_language: secondaryLanguage,
            chat_secondary_to_channel: secondaryToChannel
        };
    },

    onClick: async function(dashboard, event) {
        const cbCard = event.target.closest('[data-role="cb-card"]');
        if (cbCard && dashboard.modulePageBodyEl.contains(cbCard)) {
            const cId = cbCard.getAttribute('data-id');
            const hidden = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected"]');
            if (hidden) hidden.value = cId;
            const hiddenName = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected-name"]');
            const nameEl = cbCard.querySelector('div[style*="font-weight"]');
            if (hiddenName) hiddenName.value = (nameEl ? nameEl.textContent.trim() : '');
            
            const cards = dashboard.modulePageBodyEl.querySelectorAll('[data-role="cb-card"]');
            cards.forEach(c => c.style.borderColor = 'var(--color-border)');
            cbCard.style.borderColor = 'var(--color-accent)';
            await dashboard._saveBotConfiguration({
                extraProps: this._buildConfigProps(dashboard)
            });
            return true;
        }
        return false;
    },

    onChange: async function(dashboard, event) {
        const cbInput = event.target.closest('[data-role="cb-url"], [data-role="cb-key"], [data-role="cb-primary-language"], [data-role="cb-secondary-language"], [data-role="cb-secondary-to-channel"]');
        if (cbInput && dashboard.modulePageBodyEl.contains(cbInput)) {
            await dashboard._saveBotConfiguration({
                extraProps: this._buildConfigProps(dashboard)
            });
            return true;
        }
        return false;
    }
};