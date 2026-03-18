Object.assign(window.ChatComponent.prototype, {
    // --- Scenario Page ---

    async openScenario() {
        // Load scenario data if not yet loaded
        if (!this.state.scenarios) {
            await this._loadScenarios();
        }
        this.state.scenarioTab = this.state.scenarioTab || 'scene';
        this.switchTab('scenario');
        this._renderScenarioPage();
    },

    async _loadScenarios() {
        try {
            const res = await this.api['chat'].get('/scenarios');
            this.state.scenarios = {
                scenes: res.scenes || {},
                rules: res.rules || {}
            };
        } catch (e) {
            console.error('[Chat] Failed to load scenarios:', e);
            this.state.scenarios = { scenes: {}, rules: {} };
        }
    },

    _renderScenarioPage() {
        const container = this.container.querySelector('#scenario-cards-container');
        if (!container) return;
        container.innerHTML = '';

        const tab = this.state.scenarioTab || 'scene';
        const items = tab === 'scene'
            ? Object.values(this.state.scenarios?.scenes || {})
            : Object.values(this.state.scenarios?.rules || {});

        // Update tab buttons
        this.container.querySelectorAll('.scenario-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Toggle grid style: scene uses square-card grid, rule uses wide-card grid
        container.classList.toggle('scenario-cards-rule-grid', tab === 'rule');

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'scenario-empty';
            empty.textContent = tab === 'scene' ? 'No scenes yet. Tap + to create one.' : 'No rules yet.';
            container.appendChild(empty);
            return;
        }

        // Sort by updated_at desc
        items.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));

        // Map default rule IDs to names for apply_to display
        const DEFAULT_RULE_NAMES = {
            chat_system: 'Chat System',
            first_message: 'First message',
            world_builder: 'World builder',
            event: 'Event'
        };

        items.forEach(item => {
            const card = document.createElement('div');
            card.dataset.id = item.id;

            if (tab === 'scene') {
                card.className = 'yuuka-home-card scenario-card';
                const coverUrl = item.cover || '';
                const innerImg = coverUrl ? `<img src="${coverUrl}" alt="Cover">` : '<span class="material-symbols-outlined" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); opacity:0.4; font-size:32px;">landscape</span>';
                
                card.innerHTML = `
                    <div class="card-avatar" style="background-color: var(--chat-border);">
                        ${innerImg}
                    </div>
                    <div class="card-info">
                        <div class="card-name">${this.escapeHTML(item.name || 'Untitled')}</div>
                    </div>
                `;
            } else {
                // Rule cards use horizontal chat-card style
                card.className = 'chat-card scenario-card';
                const isDefault = item.is_default;
                const icon = isDefault ? 'lock' : 'description';
                const applyToName = (!isDefault && item.apply_to) ? DEFAULT_RULE_NAMES[item.apply_to] : null;
                const subtitleHtml = applyToName
                    ? `<div class="card-subtitle">Applied to ${this.escapeHTML(applyToName)}</div>`
                    : (isDefault ? '<div class="card-subtitle">Default</div>' : '');

                card.innerHTML = `
                    <div class="card-avatar" style="background-color: color-mix(in srgb, var(--chat-primary) 10%, var(--chat-border)); border-radius: 10px; width: 44px; height: 44px;">
                        <span class="material-symbols-outlined" style="opacity:0.6; font-size:22px;">${icon}</span>
                    </div>
                    <div class="card-info">
                        <div class="card-name">${this.escapeHTML(item.name || 'Untitled')}</div>
                        ${subtitleHtml}
                    </div>
                `;
            }

            card.addEventListener('click', () => {
                if (tab === 'scene') {
                    this.openSceneEdit(item.id);
                } else {
                    this.openRuleEdit(item.id);
                }
            });

            // Long-press to delete (non-default only)
            if (tab === 'scene' || !item.is_default) {
                let pressTimer = null;
                card.addEventListener('pointerdown', () => {
                    pressTimer = setTimeout(() => {
                        this._confirmDeleteScenarioItem(tab, item);
                    }, 600);
                });
                card.addEventListener('pointerup', () => clearTimeout(pressTimer));
                card.addEventListener('pointerleave', () => clearTimeout(pressTimer));
            }

            container.appendChild(card);
        });
    },

    async _confirmDeleteScenarioItem(tab, item) {
        const typeName = tab === 'scene' ? 'Scene' : 'Rule';
        const confirmFn = typeof window.Yuuka?.ui?.confirm === 'function'
            ? (msg) => window.Yuuka.ui.confirm(msg)
            : (msg) => Promise.resolve(window.confirm(msg));
        if (!await confirmFn(`Delete ${typeName} "${item.name}"?`)) return;

        try {
            const endpoint = tab === 'scene'
                ? `/scenarios/scenes/${item.id}`
                : `/scenarios/rules/${item.id}`;
            const res = await this.api['chat'].delete(endpoint);
            if (res.status === 'success') {
                if (tab === 'scene') {
                    delete this.state.scenarios.scenes[item.id];
                } else {
                    delete this.state.scenarios.rules[item.id];
                }
                this._renderScenarioPage();
            } else {
                alert(res.error || 'Failed to delete');
            }
        } catch (e) {
            console.error(e);
            alert('Error deleting item');
        }
    },

    _handleScenarioTabSwitch(tab) {
        this.state.scenarioTab = tab;
        this._renderScenarioPage();
    },

    _handleScenarioAdd() {
        const tab = this.state.scenarioTab || 'scene';
        if (tab === 'scene') {
            this.openSceneEdit(null); // New scene
        } else {
            this.openRuleEdit(null); // New rule
        }
    }
});
