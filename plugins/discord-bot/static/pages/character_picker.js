window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['character-picker'] = {
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
        const bUrl = moduleUi.chat_bridge_url || '';
        const bKey = moduleUi.chat_bridge_key || '';
        
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
                </div>
                
                <h4>Character <span style="font-size: 0.8em; color: var(--color-secondary-text); font-weight: normal;">(Only characters with persona are shown)</span></h4>
                <div class="discord-bot-character-picker">
                    <input type="search" class="discord-policy-setting__input" style="width: 100%; margin-bottom: var(--spacing-3);" data-role="cb-search" placeholder="Search characters...">
                    <div class="discord-bot-character-grid" data-role="cb-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: var(--spacing-3); max-height: 400px; overflow-y: auto;">
                        <div class="discord-bot-module-page-loading">Loading characters...</div>
                    </div>
                </div>
                <input type="hidden" data-role="cb-selected" value="${dashboard.Utils.escapeHtml(selectedId)}">
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
            };
            
            renderGrid();
            
            if (searchEl) {
                searchEl.oninput = (e) => renderGrid(e.target.value);
            }
        } catch (e) {
            gridEl.innerHTML = `<div class="discord-bot-module-page-error">Failed to load characters: ${e.message}</div>`;
        }
    },

    onClick: async function(dashboard, event) {
        const cbCard = event.target.closest('[data-role="cb-card"]');
        if (cbCard && dashboard.modulePageBodyEl.contains(cbCard)) {
            const cId = cbCard.getAttribute('data-id');
            const hidden = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected"]');
            if (hidden) hidden.value = cId;
            
            const cards = dashboard.modulePageBodyEl.querySelectorAll('[data-role="cb-card"]');
            cards.forEach(c => c.style.borderColor = 'var(--color-border)');
            cbCard.style.borderColor = 'var(--color-accent)';
            
            const bUrl = dashboard.modulePageBodyEl.querySelector('[data-role="cb-url"]')?.value || '';
            const bKey = dashboard.modulePageBodyEl.querySelector('[data-role="cb-key"]')?.value || '';
            await dashboard._saveBotConfiguration({
                extraProps: {
                    chat_character_id: cId,
                    chat_bridge_url: bUrl,
                    chat_bridge_key: bKey
                }
            });
            return true;
        }
        return false;
    },

    onChange: async function(dashboard, event) {
        const cbInput = event.target.closest('[data-role="cb-url"], [data-role="cb-key"]');
        if (cbInput && dashboard.modulePageBodyEl.contains(cbInput)) {
            const bUrl = dashboard.modulePageBodyEl.querySelector('[data-role="cb-url"]')?.value || '';
            const bKey = dashboard.modulePageBodyEl.querySelector('[data-role="cb-key"]')?.value || '';
            const cId = dashboard.modulePageBodyEl.querySelector('[data-role="cb-selected"]')?.value || '';
            await dashboard._saveBotConfiguration({
                extraProps: {
                    chat_character_id: cId,
                    chat_bridge_url: bUrl,
                    chat_bridge_key: bKey
                }
            });
            return true;
        }
        return false;
    }
};