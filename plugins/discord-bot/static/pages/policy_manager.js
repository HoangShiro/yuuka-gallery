window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['policy-manager'] = {
    render: function(dashboard, module, moduleUi) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Policy groups</h4>
                    <p>Create or connect a bot first to manage policy groups.</p>
                </section>
            `;
        }
        const activeModules = new Set(bot.modules || []);
        const groups = Array.isArray(moduleUi.groups) ? moduleUi.groups : [];
        const filteredGroups = groups
            .map((group) => ({
                ...group,
                policies: Array.isArray(group.policies)
                    ? group.policies.filter((policy) => activeModules.has(policy.module_id) && policy.module_id !== module.id)
                    : [],
            }))
            .filter((group) => group.policies.length > 0);
        if (!filteredGroups.length) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Policy groups</h4>
                    <p>No registered policies are available for the currently enabled modules.</p>
                </section>
            `;
        }
        const groupsHtml = filteredGroups.map((group) => `
            <section class="discord-bot-module-page-section discord-policy-group">
                <div class="discord-policy-group__header">
                    <h4>${dashboard.Utils.escapeHtml(group.group_name || group.group_id || 'Group')}</h4>
                    <span class="discord-policy-group__count">${group.policies.length} policies</span>
                </div>
                <div class="discord-policy-list">
                    ${group.policies.map((policy) => this._renderPolicyCard(dashboard, policy)).join('')}
                </div>
            </section>
        `).join('');
        return `
            <section class="discord-bot-module-page-section">
                <h4>Policy groups</h4>
                <p>Each policy is registered by a module, shown in its group, and starts from the default toggle defined by that module.</p>
            </section>
            ${groupsHtml}
        `;
    },

    _renderPolicyCard: function(dashboard, policy) {
        const policyId = dashboard.Utils.escapeHtml(policy.policy_id || '');
        const title = dashboard.Utils.escapeHtml(policy.title || policy.policy_id || 'Policy');
        const description = dashboard.Utils.escapeHtml(policy.description || '');
        const moduleName = dashboard.Utils.escapeHtml(policy.module_name || policy.module_id || 'Unknown module');
        const moduleId = dashboard.Utils.escapeHtml(policy.module_id || '');
        const enabled = policy.enabled ? 'checked' : '';
        const defaultLabel = policy.default_enabled ? 'ON' : 'OFF';
        const settingSchema = policy.setting_schema && typeof policy.setting_schema === 'object' ? policy.setting_schema : {};
        const settings = policy.settings && typeof policy.settings === 'object' ? policy.settings : {};
        const settingFields = Object.entries(settingSchema).map(([key, defaultValue]) => {
            const currentValue = settings[key] == null ? defaultValue : settings[key];
            if (key === 'allowed_channel_ids') {
                return this._renderAllowedChannelIdsSetting(dashboard, {
                    policyId,
                    key,
                    currentValue,
                });
            }
            if (key.endsWith('_volume')) {
                return `
                    <label class="discord-policy-setting discord-policy-setting--range">
                        <span class="discord-policy-setting__label">${dashboard.Utils.escapeHtml(key)} (<span data-role="range-value">${dashboard.Utils.escapeHtml(String(currentValue ?? defaultValue))}</span>%)</span>
                        <div class="discord-policy-range-wrapper" style="display: flex; align-items: center; gap: 8px;">
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                class="discord-policy-setting__input"
                                data-role="policy-setting"
                                data-policy-id="${policyId}"
                                data-setting-key="${dashboard.Utils.escapeHtml(key)}"
                                value="${dashboard.Utils.escapeHtml(String(currentValue ?? defaultValue))}"
                                style="flex: 1;"
                                oninput="this.parentElement.previousElementSibling.querySelector('[data-role=range-value]').textContent = this.value"
                            />
                        </div>
                    </label>
                `;
            }
            return `
                <label class="discord-policy-setting">
                    <span class="discord-policy-setting__label">${dashboard.Utils.escapeHtml(key)}</span>
                    <input
                        type="text"
                        class="discord-policy-setting__input"
                        data-role="policy-setting"
                        data-policy-id="${policyId}"
                        data-setting-key="${dashboard.Utils.escapeHtml(key)}"
                        value="${dashboard.Utils.escapeHtml(String(currentValue ?? ''))}"
                        placeholder="${dashboard.Utils.escapeHtml(String(defaultValue ?? ''))}"
                    />
                </label>
            `;
        }).join('');
        return `
            <article class="discord-policy-card" data-policy-id="${policyId}">
                <div class="discord-policy-card__header">
                    <div class="discord-policy-card__meta">
                        <div class="discord-policy-card__title-row">
                            <h5>${title}</h5>
                            <span class="discord-policy-card__default">Default ${defaultLabel}</span>
                        </div>
                        <div class="discord-policy-card__owner">Registered by ${moduleName} <span class="discord-policy-card__owner-id">${moduleId}</span></div>
                    </div>
                    <label class="yuuka-switch discord-policy-card__toggle" title="Toggle policy">
                        <input type="checkbox" data-role="policy-toggle" data-policy-id="${policyId}" ${enabled} />
                        <span class="yuuka-switch__slider"></span>
                    </label>
                </div>
                <p class="discord-policy-card__description">${description}</p>
                ${settingFields ? `<div class="discord-policy-settings">${settingFields}</div>` : ''}
            </article>
        `;
    },

    _renderAllowedChannelIdsSetting: function(dashboard, { policyId, key, currentValue }) {
        const values = this._parseChannelIdList(currentValue);
        const itemsHtml = values.map((value) => `
            <span class="discord-policy-list-item" data-role="channel-id-item" data-value="${dashboard.Utils.escapeHtml(value)}">
                <span class="discord-policy-list-item__text">${dashboard.Utils.escapeHtml(value)}</span>
                <button
                    type="button"
                    class="discord-policy-list-item__remove"
                    data-action="remove-channel-id"
                    data-policy-id="${policyId}"
                    data-setting-key="${dashboard.Utils.escapeHtml(key)}"
                    data-value="${dashboard.Utils.escapeHtml(value)}"
                >-</button>
            </span>
        `).join('');
        return `
            <div class="discord-policy-setting discord-policy-setting--channel-list" data-role="channel-id-setting" data-policy-id="${policyId}" data-setting-key="${dashboard.Utils.escapeHtml(key)}">
                <span class="discord-policy-setting__label">${dashboard.Utils.escapeHtml(key)}</span>
                <div class="discord-policy-list-editor">
                    <div class="discord-policy-list-editor__controls">
                        <input
                            type="text"
                            class="discord-policy-setting__input discord-policy-list-editor__input"
                            data-role="channel-id-input"
                            data-policy-id="${policyId}"
                            data-setting-key="${dashboard.Utils.escapeHtml(key)}"
                            placeholder="Add channel ID"
                        />
                        <button
                            type="button"
                            class="discord-bot-btn discord-bot-btn--accent discord-policy-list-editor__add"
                            data-action="add-channel-id"
                            data-policy-id="${policyId}"
                            data-setting-key="${dashboard.Utils.escapeHtml(key)}"
                        >Add</button>
                    </div>
                    <div class="discord-policy-list-items" data-role="channel-id-items">${itemsHtml}</div>
                    <input type="hidden" data-role="policy-setting" data-policy-id="${policyId}" data-setting-key="${dashboard.Utils.escapeHtml(key)}" value="${dashboard.Utils.escapeHtml(values.join(','))}" />
                </div>
            </div>
        `;
    },

    _parseChannelIdList: function(value) {
        return String(value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    },

    onClick: async function(dashboard, event) {
        const addButton = event.target.closest('[data-action="add-channel-id"]');
        if (addButton && dashboard.modulePageBodyEl.contains(addButton)) {
            const policyId = addButton.getAttribute('data-policy-id');
            const settingKey = addButton.getAttribute('data-setting-key');
            if (policyId && settingKey) {
                await this._addChannelIdFromModulePage(dashboard, policyId, settingKey);
            }
            return true;
        }
        const removeButton = event.target.closest('[data-action="remove-channel-id"]');
        if (removeButton && dashboard.modulePageBodyEl.contains(removeButton)) {
            const policyId = removeButton.getAttribute('data-policy-id');
            const settingKey = removeButton.getAttribute('data-setting-key');
            const value = removeButton.getAttribute('data-value');
            if (policyId && settingKey && value) {
                await this._removeChannelIdFromModulePage(dashboard, policyId, settingKey, value);
            }
            return true;
        }
        return false;
    },

    onChange: async function(dashboard, event) {
        const input = event.target;
        if (!dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }

        const toggle = input.closest('[data-role="policy-toggle"]');
        if (toggle) {
            const policyId = toggle.getAttribute('data-policy-id');
            if (policyId) {
                await this._savePolicyFromModulePage(dashboard, policyId);
            }
            return true;
        }

        if (input.type === 'range' && input.getAttribute('data-role') === 'policy-setting') {
            const policyId = input.getAttribute('data-policy-id');
            if (policyId) {
                await this._savePolicyFromModulePage(dashboard, policyId);
            }
            return true;
        }
        
        return false;
    },

    _addChannelIdFromModulePage: async function(dashboard, policyId, settingKey) {
        const policyCard = dashboard.modulePageBodyEl?.querySelector(`.discord-policy-card[data-policy-id="${policyId}"]`);
        if (!policyCard) {
            return;
        }
        const container = policyCard.querySelector(`[data-role="channel-id-setting"][data-setting-key="${settingKey}"]`);
        const input = container?.querySelector('[data-role="channel-id-input"]');
        const hiddenInput = policyCard.querySelector(`[data-role="policy-setting"][data-setting-key="${settingKey}"]`);
        if (!container || !input || !hiddenInput) {
            return;
        }
        const candidate = input.value.trim();
        if (!candidate) {
            return;
        }
        const currentValues = this._parseChannelIdList(hiddenInput.value);
        if (!currentValues.includes(candidate)) {
            currentValues.push(candidate);
        }
        hiddenInput.value = currentValues.join(',');
        input.value = '';
        await this._savePolicyFromModulePage(dashboard, policyId);
    },

    _removeChannelIdFromModulePage: async function(dashboard, policyId, settingKey, valueToRemove) {
        const policyCard = dashboard.modulePageBodyEl?.querySelector(`.discord-policy-card[data-policy-id="${policyId}"]`);
        const hiddenInput = policyCard?.querySelector(`[data-role="policy-setting"][data-setting-key="${settingKey}"]`);
        if (!policyCard || !hiddenInput) {
            return;
        }
        const currentValues = this._parseChannelIdList(hiddenInput.value);
        hiddenInput.value = currentValues.filter((value) => value !== valueToRemove).join(',');
        await this._savePolicyFromModulePage(dashboard, policyId);
    },

    _savePolicyFromModulePage: async function(dashboard, policyId) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            showError('No active bot selected.');
            return;
        }
        const policyCard = dashboard.modulePageBodyEl?.querySelector(`.discord-policy-card[data-policy-id="${policyId}"]`);
        if (!policyCard) {
            return;
        }
        const toggleEl = policyCard.querySelector('[data-role="policy-toggle"]');
        const settingEls = Array.from(policyCard.querySelectorAll('[data-role="policy-setting"]'));
        const settings = {};
        settingEls.forEach((input) => {
            const key = input.getAttribute('data-setting-key');
            if (key) {
                settings[key] = key === 'allowed_channel_ids'
                    ? this._parseChannelIdList(input.value).join(',')
                    : input.value;
            }
        });
        const payload = {
            toggles: {
                [policyId]: Boolean(toggleEl?.checked),
            },
            settings: Object.keys(settings).length ? { [policyId]: settings } : {},
        };
        try {
            this._setPolicyCardSaving(policyCard, true);
            const response = await dashboard.pluginApi.post(`/bots/${encodeURIComponent(bot.bot_id)}/policies`, payload);
            const cacheKey = dashboard.Utils.createModuleUiCacheKey(dashboard.state.activeModulePage, bot.bot_id);
            const existingUi = dashboard.state.moduleUiCache[cacheKey] || {};
            dashboard.state.moduleUiCache[cacheKey] = {
                ...existingUi,
                groups: Array.isArray(response?.groups) ? response.groups : [],
                bot_id: bot.bot_id,
            };
            dashboard._renderModulePage();
            showError(`Saved policy: ${policyId}`);
        } catch (error) {
            console.error('[DiscordBot] Failed to save policy:', error);
            showError(`Unable to save policy: ${error.message}`);
        } finally {
            this._setPolicyCardSaving(policyCard, false);
        }
    },

    _setPolicyCardSaving: function(policyCard, isSaving) {
        if (!policyCard) {
            return;
        }
        policyCard.classList.toggle('discord-policy-card--saving', Boolean(isSaving));
        const inputs = policyCard.querySelectorAll('input');
        inputs.forEach((input) => {
            input.disabled = Boolean(isSaving);
        });
    }
};