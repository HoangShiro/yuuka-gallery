window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['image-gen-config'] = {
    _savedStatusTimer: null,
    _tagPredictions: null,
    _isDirty: false,
    _isSaving: false,
    _pendingOptionsReload: false,

    _setSaveStatus: function(dashboard, status, text) {
        const statusEl = dashboard?.modulePageBodyEl?.querySelector('[data-role="ig-save-status"]');
        if (!statusEl) {
            return;
        }
        statusEl.textContent = text || '';
        statusEl.style.color = status === 'saved'
            ? '#22c55e'
            : (status === 'saving'
                ? '#94a3b8'
                : (status === 'dirty' ? '#f59e0b' : '#ef4444'));
        statusEl.style.opacity = text ? '1' : '0';
    },

    _showSaved: function(dashboard) {
        this._setSaveStatus(dashboard, 'saved', 'Saved');
        if (this._savedStatusTimer) {
            clearTimeout(this._savedStatusTimer);
        }
        this._savedStatusTimer = setTimeout(() => {
            this._setSaveStatus(dashboard, 'idle', '');
        }, 1500);
    },

    _markDirty: function(dashboard, options = {}) {
        this._isDirty = true;
        if (options.reloadChoices) {
            this._pendingOptionsReload = true;
        }
        if (!this._isSaving) {
            this._setSaveStatus(dashboard, 'dirty', 'Unsaved changes');
        }
    },

    _saveNow: async function(dashboard) {
        if (!this._isDirty || this._isSaving) {
            return false;
        }
        this._isSaving = true;
        this._setSaveStatus(dashboard, 'saving', 'Saving...');
        try {
            const ok = await dashboard._saveBotConfiguration({
                extraProps: this._buildConfigProps(dashboard),
                showSuccessMessage: false,
            });
            if (!ok) {
                this._setSaveStatus(dashboard, 'error', 'Save failed');
                return false;
            }
            this._isDirty = false;
            this._showSaved(dashboard);
            if (this._pendingOptionsReload) {
                this._pendingOptionsReload = false;
                await this._loadOptions(dashboard);
            }
            return true;
        } finally {
            this._isSaving = false;
            if (this._isDirty) {
                this._setSaveStatus(dashboard, 'dirty', 'Unsaved changes');
            }
        }
    },

    render: function(dashboard, module, moduleUi) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Image Generation</h4>
                    <p>Create or connect a bot first to configure.</p>
                </section>
            `;
        }

        setTimeout(() => {
            this._isDirty = false;
            this._isSaving = false;
            this._pendingOptionsReload = false;
            this._loadOptions(dashboard);
            this._ensureTagAutocomplete(dashboard);
        }, 0);

        return `
            <section class="discord-bot-module-page-section">
                <h4>Runtime Defaults <span data-role="ig-save-status" style="margin-left: 8px; color: #22c55e; font-size: 0.85em; opacity: 0; transition: opacity 0.2s;">Saved</span></h4>
                <div class="discord-policy-settings">
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Default character</span>
                        <select class="discord-policy-setting__input" data-role="ig-character">
                            <option value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_character_hash || '')}">${dashboard.Utils.escapeHtml(moduleUi.image_gen_character_name || 'Loading characters...')}</option>
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">ComfyUI server</span>
                        <input type="text" class="discord-policy-setting__input" data-role="ig-server" value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_server_address || '127.0.0.1:8888')}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Checkpoint</span>
                        <select class="discord-policy-setting__input" data-role="ig-ckpt">
                            <option value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_ckpt_name || '')}">${dashboard.Utils.escapeHtml(moduleUi.image_gen_ckpt_name || 'Loading checkpoints...')}</option>
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">LoRA</span>
                        <select class="discord-policy-setting__input" data-role="ig-lora">
                            <option value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_lora_name || 'None')}">${dashboard.Utils.escapeHtml(moduleUi.image_gen_lora_name || 'None')}</option>
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Sampler</span>
                        <select class="discord-policy-setting__input" data-role="ig-sampler">
                            <option value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_sampler_name || '')}">${dashboard.Utils.escapeHtml(moduleUi.image_gen_sampler_name || 'Loading samplers...')}</option>
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Scheduler</span>
                        <select class="discord-policy-setting__input" data-role="ig-scheduler">
                            <option value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_scheduler || '')}">${dashboard.Utils.escapeHtml(moduleUi.image_gen_scheduler || 'Loading schedulers...')}</option>
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Size preset</span>
                        <select class="discord-policy-setting__input" data-role="ig-size">
                            <option value="${dashboard.Utils.escapeHtml(`${moduleUi.image_gen_width || 832}x${moduleUi.image_gen_height || 1216}`)}">${dashboard.Utils.escapeHtml(`${moduleUi.image_gen_width || 832}x${moduleUi.image_gen_height || 1216}`)}</option>
                        </select>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Steps</span>
                        <input type="number" min="1" max="60" class="discord-policy-setting__input" data-role="ig-steps" value="${dashboard.Utils.escapeHtml(String(moduleUi.image_gen_steps || 12))}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">CFG</span>
                        <input type="number" min="0" max="30" step="0.1" class="discord-policy-setting__input" data-role="ig-cfg" value="${dashboard.Utils.escapeHtml(String(moduleUi.image_gen_cfg || 2.2))}" />
                    </label>
                </div>
            </section>
            <section class="discord-bot-module-page-section">
                <h4>Prompt Defaults</h4>
                <div class="discord-policy-settings">
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Quality</span>
                        <textarea class="discord-policy-setting__input" data-role="ig-quality" rows="2">${dashboard.Utils.escapeHtml(moduleUi.image_gen_quality || '')}</textarea>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Negative</span>
                        <textarea class="discord-policy-setting__input" data-role="ig-negative" rows="2">${dashboard.Utils.escapeHtml(moduleUi.image_gen_negative || '')}</textarea>
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Outfits</span>
                        <input type="text" class="discord-policy-setting__input" data-role="ig-outfits" value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_outfits || '')}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Expression</span>
                        <input type="text" class="discord-policy-setting__input" data-role="ig-expression" value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_expression || '')}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Action</span>
                        <input type="text" class="discord-policy-setting__input" data-role="ig-action" value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_action || '')}" />
                    </label>
                    <label class="discord-policy-setting">
                        <span class="discord-policy-setting__label">Context</span>
                        <input type="text" class="discord-policy-setting__input" data-role="ig-context" value="${dashboard.Utils.escapeHtml(moduleUi.image_gen_context || '')}" />
                    </label>
                </div>
            </section>
        `;
    },

    _buildOptionHtml: function(dashboard, items, selectedValue, emptyLabel) {
        const options = Array.isArray(items) ? items : [];
        const selected = String(selectedValue || '');
        const rows = [];
        if (emptyLabel) {
            rows.push(`<option value="">${emptyLabel}</option>`);
        }
        for (const item of options) {
            const value = String((item && (item.value || item.hash || item.id || item.name)) || '').trim();
            const label = String((item && (item.name || item.label || item.value || item.hash || item.id)) || value).trim();
            if (!value && !label) continue;
            rows.push(`<option value="${dashboard.Utils.escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${dashboard.Utils.escapeHtml(label)}</option>`);
        }
        return rows.join('');
    },

    _applyOptions: function(dashboard, payload) {
        const body = dashboard.modulePageBodyEl;
        if (!body || !payload) return;
        const config = payload.config || {};
        const choices = payload.choices || {};
        const characters = Array.isArray(payload.characters) ? payload.characters : [];
        const characterSelect = body.querySelector('[data-role="ig-character"]');
        const ckptSelect = body.querySelector('[data-role="ig-ckpt"]');
        const loraSelect = body.querySelector('[data-role="ig-lora"]');
        const samplerSelect = body.querySelector('[data-role="ig-sampler"]');
        const schedulerSelect = body.querySelector('[data-role="ig-scheduler"]');
        const sizeSelect = body.querySelector('[data-role="ig-size"]');
        if (characterSelect) {
            characterSelect.innerHTML = `<option value="">None</option>` + characters.map((item) => {
                const selected = String(item.hash || '') === String(config.character_hash || '');
                return `<option value="${dashboard.Utils.escapeHtml(item.hash || '')}" data-name="${dashboard.Utils.escapeHtml(item.name || '')}" ${selected ? 'selected' : ''}>${dashboard.Utils.escapeHtml(item.name || item.hash || '')}</option>`;
            }).join('');
        }
        if (ckptSelect) {
            ckptSelect.innerHTML = this._buildOptionHtml(dashboard, (choices.checkpoints || []).map((value) => ({ value, name: value })), config.ckpt_name, 'None');
        }
        if (loraSelect) {
            const loras = [{ value: 'None', name: 'None' }].concat((choices.loras || []).map((value) => ({ value, name: value })));
            loraSelect.innerHTML = this._buildOptionHtml(dashboard, loras, config.lora_name);
        }
        if (samplerSelect) {
            samplerSelect.innerHTML = this._buildOptionHtml(dashboard, (choices.samplers || []).map((value) => ({ value, name: value })), config.sampler_name, 'None');
        }
        if (schedulerSelect) {
            schedulerSelect.innerHTML = this._buildOptionHtml(dashboard, (choices.schedulers || []).map((value) => ({ value, name: value })), config.scheduler, 'None');
        }
        if (sizeSelect) {
            const selectedSize = `${config.width || 832}x${config.height || 1216}`;
            sizeSelect.innerHTML = this._buildOptionHtml(dashboard, (choices.sizes || []).map((item) => ({
                value: item.value,
                name: item.name || item.value,
            })), selectedSize);
        }
    },

    _loadOptions: async function(dashboard) {
        const bot = dashboard.state.activeBot;
        if (!bot || !dashboard.modulePageBodyEl) {
            return;
        }
        try {
            const serverAddress = dashboard.modulePageBodyEl.querySelector('[data-role="ig-server"]')?.value || '';
            const query = new URLSearchParams();
            if (serverAddress) {
                query.set('server_address', serverAddress);
            }
            const suffix = query.toString() ? `?${query.toString()}` : '';
            const payload = await dashboard.pluginApi.get(`/bots/${encodeURIComponent(bot.bot_id)}/image-gen/options${suffix}`);
            this._applyOptions(dashboard, payload);
        } catch (error) {
            console.error('[DiscordBot] Failed to load image-gen options:', error);
        }
    },

    _getTagAutocompleteInputs: function(dashboard) {
        const body = dashboard?.modulePageBodyEl;
        if (!body) {
            return [];
        }
        return Array.from(body.querySelectorAll([
            '[data-role="ig-quality"]',
            '[data-role="ig-negative"]',
            '[data-role="ig-outfits"]',
            '[data-role="ig-expression"]',
            '[data-role="ig-action"]',
            '[data-role="ig-context"]',
        ].join(', ')));
    },

    _fetchTagPredictions: async function(dashboard) {
        if (Array.isArray(this._tagPredictions)) {
            return this._tagPredictions;
        }
        try {
            const payload = await dashboard.api.getTags();
            this._tagPredictions = Array.isArray(payload) ? payload : [];
        } catch (error) {
            console.error('[DiscordBot] Failed to load core tag predictions:', error);
            this._tagPredictions = [];
        }
        return this._tagPredictions;
    },

    _bindTagAutocomplete: function(dashboard, input, tagPredictions) {
        if (!input || input.dataset.tagAutocompleteReady === '1' || !Array.isArray(tagPredictions) || !tagPredictions.length) {
            return;
        }
        const parent = input.parentElement;
        if (!parent) {
            return;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'tag-autocomplete-container';
        parent.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const list = document.createElement('ul');
        list.className = 'tag-autocomplete-list';
        wrapper.appendChild(list);

        let activeIndex = -1;
        const hide = () => {
            list.style.display = 'none';
            list.innerHTML = '';
            activeIndex = -1;
        };

        const applyTag = (tag) => {
            const textValue = input.value || '';
            const cursor = Number(input.selectionStart || 0);
            const before = textValue.slice(0, cursor);
            const lastComma = before.lastIndexOf(',');
            const prefix = textValue.slice(0, lastComma + 1);
            const after = textValue.slice(cursor);
            const nextComma = after.indexOf(',');
            const remaining = nextComma === -1 ? '' : after.slice(nextComma);
            const normalizedTag = String(tag || '').replace(/_/g, ' ').trim();
            const prefixText = prefix.trim() ? `${prefix.trim()} ` : '';
            const result = `${prefixText}${normalizedTag}, ${remaining.trim()}`.trim();
            input.value = result;
            const newCursor = (`${prefixText}${normalizedTag}`).length + 2;
            input.focus();
            input.setSelectionRange(newCursor, newCursor);
            hide();
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };

        input.addEventListener('input', () => {
            const textValue = input.value || '';
            const cursor = Number(input.selectionStart || 0);
            const before = textValue.slice(0, cursor);
            const lastComma = before.lastIndexOf(',');
            const current = before.slice(lastComma + 1).trim();
            if (current.length < 1) {
                hide();
                return;
            }
            const search = current.replace(/\s+/g, '_').toLowerCase();
            const matches = tagPredictions.filter((tag) => String(tag || '').startsWith(search)).slice(0, 7);
            if (!matches.length) {
                hide();
                return;
            }
            list.innerHTML = matches.map((tag) => (
                `<li class="tag-autocomplete-item" data-tag="${dashboard.Utils.escapeHtml(tag)}">${dashboard.Utils.escapeHtml(String(tag).replace(/_/g, ' '))}</li>`
            )).join('');
            list.style.display = 'block';
            activeIndex = -1;
        });

        list.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const item = event.target.closest('.tag-autocomplete-item');
            if (!item) {
                return;
            }
            applyTag(item.getAttribute('data-tag') || '');
        });

        input.addEventListener('keydown', (event) => {
            const items = list.querySelectorAll('.tag-autocomplete-item');
            if (!items.length) {
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
            } else if ((event.key === 'Enter' || event.key === 'Tab') && activeIndex > -1) {
                event.preventDefault();
                applyTag(items[activeIndex].getAttribute('data-tag') || '');
                return;
            } else if (event.key === 'Escape') {
                hide();
                return;
            } else {
                return;
            }
            items.forEach((item, index) => item.classList.toggle('active', index === activeIndex));
        });

        input.addEventListener('blur', () => setTimeout(hide, 150));
        input.dataset.tagAutocompleteReady = '1';
    },

    _ensureTagAutocomplete: async function(dashboard) {
        const inputs = this._getTagAutocompleteInputs(dashboard);
        if (!inputs.length) {
            return;
        }
        const tagPredictions = await this._fetchTagPredictions(dashboard);
        if (!tagPredictions.length) {
            return;
        }
        inputs.forEach((input) => this._bindTagAutocomplete(dashboard, input, tagPredictions));
    },

    _buildConfigProps: function(dashboard) {
        const body = dashboard.modulePageBodyEl;
        const characterSelect = body.querySelector('[data-role="ig-character"]');
        const selectedCharacter = characterSelect?.selectedOptions?.[0] || null;
        const sizeValue = body.querySelector('[data-role="ig-size"]')?.value || '832x1216';
        const parts = String(sizeValue || '').split('x');
        const width = Number(parts[0]) || 832;
        const height = Number(parts[1]) || 1216;
        return {
            image_gen_character_hash: characterSelect?.value || '',
            image_gen_character_name: selectedCharacter?.getAttribute('data-name') || selectedCharacter?.textContent?.trim() || '',
            image_gen_server_address: body.querySelector('[data-role="ig-server"]')?.value || '127.0.0.1:8888',
            image_gen_ckpt_name: body.querySelector('[data-role="ig-ckpt"]')?.value || '',
            image_gen_lora_name: body.querySelector('[data-role="ig-lora"]')?.value || 'None',
            image_gen_sampler_name: body.querySelector('[data-role="ig-sampler"]')?.value || '',
            image_gen_scheduler: body.querySelector('[data-role="ig-scheduler"]')?.value || '',
            image_gen_quality: body.querySelector('[data-role="ig-quality"]')?.value || '',
            image_gen_negative: body.querySelector('[data-role="ig-negative"]')?.value || '',
            image_gen_outfits: body.querySelector('[data-role="ig-outfits"]')?.value || '',
            image_gen_expression: body.querySelector('[data-role="ig-expression"]')?.value || '',
            image_gen_action: body.querySelector('[data-role="ig-action"]')?.value || '',
            image_gen_context: body.querySelector('[data-role="ig-context"]')?.value || '',
            image_gen_width: width,
            image_gen_height: height,
            image_gen_steps: Math.max(1, Math.min(60, Number(body.querySelector('[data-role="ig-steps"]')?.value || 12))),
            image_gen_cfg: Math.max(0, Math.min(30, Number(body.querySelector('[data-role="ig-cfg"]')?.value || 2.2))),
        };
    },

    onChange: async function(dashboard, event) {
        const input = event.target.closest('[data-role^="ig-"]');
        if (!input || !dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }
        if (input.matches('[data-role="ig-server"]')) {
            this._markDirty(dashboard, { reloadChoices: true });
            return true;
        }
        this._markDirty(dashboard);
        return true;
    },

    onInput: async function(dashboard, event) {
        const input = event.target.closest('[data-role="ig-quality"], [data-role="ig-negative"], [data-role="ig-outfits"], [data-role="ig-expression"], [data-role="ig-action"], [data-role="ig-context"], [data-role="ig-steps"], [data-role="ig-cfg"]');
        if (!input || !dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }
        this._markDirty(dashboard, {
            reloadChoices: input.matches('[data-role="ig-server"]'),
        });
        return true;
    },

    onFocusOut: async function(dashboard, event) {
        const input = event.target.closest('[data-role^="ig-"]');
        if (!input || !dashboard.modulePageBodyEl.contains(input)) {
            return false;
        }
        await this._saveNow(dashboard);
        return true;
    },

    flushPendingChanges: async function(dashboard) {
        return await this._saveNow(dashboard);
    },

    onClick: async function() {
        return false;
    }
};
