Object.assign(window.ChatComponent.prototype, {
    // --- Theme Settings ---
    renderThemeSettings() {
        const container = this.container.querySelector('#theme-cards');
        if (!container) return;

        const themes = [
            { id: 'yuuka', name: 'Yuuka', desc: 'Core app synced theme', colors: ['var(--color-accent)', 'var(--color-card-bg)', 'var(--color-primary-bg)'] },
            { id: 'modern', name: 'Modern', desc: 'Purple theme', colors: ['#8a2be2', '#e9ecef', '#f8f9fa'] },
        ];

        container.innerHTML = '';
        themes.forEach(t => {
            const card = document.createElement('div');
            card.className = `theme-card ${this.state.currentTheme === t.id ? 'active' : ''}`;
            card.innerHTML = `
                <div class="theme-preview">
                    ${t.colors.map(c => `<span class="theme-swatch" style="background:${c}"></span>`).join('')}
                </div>
                <div class="theme-name">${t.name}</div>
                <div class="theme-desc">${t.desc}</div>
            `;
            card.addEventListener('click', () => {
                this.state.currentTheme = t.id;
                this.applyTheme(t.id);
                localStorage.setItem('chat-theme', t.id);
                this.renderThemeSettings();
            });
            container.appendChild(card);
        });
    },

    applyTheme(themeId) {
        const app = this.container.querySelector('.chat-app-container');
        app.classList.remove('theme-modern', 'theme-yuuka');
        app.classList.add(`theme-${themeId}`);
    },

    applyThemeCustomizations() {
        const app = this.container.querySelector('.chat-app-container');
        if (!app) return;

        // Font
        const font = localStorage.getItem('chat-theme-font') || '';
        if (font) {
            app.style.setProperty('--chat-custom-font', font);
        } else {
            app.style.removeProperty('--chat-custom-font');
        }

        // Font size
        const fontSize = localStorage.getItem('chat-theme-font-size');
        if (fontSize) {
            app.style.setProperty('--chat-custom-font-size', fontSize + 'px');
        } else {
            app.style.removeProperty('--chat-custom-font-size');
        }

        // Line space
        const lineSpace = localStorage.getItem('chat-theme-line-space');
        if (lineSpace) {
            app.style.setProperty('--chat-custom-line-space', lineSpace);
        } else {
            app.style.removeProperty('--chat-custom-line-space');
        }

        // Text color
        const textColor = localStorage.getItem('chat-theme-text-color');
        if (textColor) {
            app.style.setProperty('--chat-custom-text-color', textColor);
        } else {
            app.style.removeProperty('--chat-custom-text-color');
        }

        // Bubble opacity
        const bubbleOpacity = localStorage.getItem('chat-theme-bubble-opacity');
        if (bubbleOpacity) {
            app.style.setProperty('--chat-custom-bubble-opacity', bubbleOpacity + '%');
        } else {
            app.style.removeProperty('--chat-custom-bubble-opacity');
        }

        // Bubble blur
        const blurEnabled = localStorage.getItem('chat-theme-bubble-blur');
        if (blurEnabled === 'false') {
            app.classList.add('no-bubble-blur');
        } else {
            app.classList.remove('no-bubble-blur');
        }
    },

    renderChatFormatRules() {
        const tbody = this.container.querySelector('#chat-rules-tbody');
        if (!tbody) return;

        let rules = JSON.parse(localStorage.getItem('chat-format-rules'));
        if (!rules) {
            rules = [
                { rule: '**', type: 'Italic', linebreak: true, keep: false },
                { rule: '****', type: 'Bold', linebreak: false, keep: false },
                { rule: '""', type: 'Dialogue', linebreak: true, keep: true },
            ];
            localStorage.setItem('chat-format-rules', JSON.stringify(rules));
        }

        tbody.innerHTML = '';
        rules.forEach((r, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" class="rule-input" placeholder="e.g. **" style="width: 100%; box-sizing: border-box; padding: 6px 8px; background: transparent; border: 1px solid var(--chat-border); color: var(--chat-text); border-radius: 4px; font-family: monospace; font-size: 0.9rem;"></td>
                <td>
                    <div style="position: relative;">
                        <select class="type-select" style="width: 100%; padding: 6px 28px 6px 8px; background: var(--chat-panel-bg); border: 1px solid var(--chat-border); color: var(--chat-text); border-radius: 4px; cursor: pointer; appearance: none; font-size: 0.9rem;">
                            <option value="Normal" ${r.type === 'Normal' ? 'selected' : ''}>Normal</option>
                            <option value="Italic" ${r.type === 'Italic' ? 'selected' : ''}>Italic</option>
                            <option value="Bold" ${r.type === 'Bold' ? 'selected' : ''}>Bold</option>
                            <option value="Dialogue" ${r.type === 'Dialogue' ? 'selected' : ''}>Dialogue</option>
                            <option value="Codemark" ${r.type === 'Codemark' ? 'selected' : ''}>Codemark</option>
                            <option value="Title" ${r.type === 'Title' ? 'selected' : ''}>Title</option>
                            <option value="Subtitle" ${r.type === 'Subtitle' ? 'selected' : ''}>Subtitle</option>
                        </select>
                        <span class="material-symbols-outlined" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--chat-text-secondary); font-size: 18px;">expand_more</span>
                    </div>
                </td>
                <td style="text-align: center;">
                    <label class="switch" style="transform: scale(0.85);">
                        <input type="checkbox" class="keep-checkbox" ${r.keep ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </td>
                <td style="text-align: center;">
                    <label class="switch" style="transform: scale(0.85);">
                        <input type="checkbox" class="linebreak-checkbox" ${r.linebreak ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </td>
                <td style="text-align: right;">
                    <button class="icon-btn btn-delete-rule" title="Remove rule" style="padding: 4px; margin-left: auto;">
                        <span class="material-symbols-outlined" style="font-size: 20px;">delete</span>
                    </button>
                </td>
            `;

            const ruleInput = tr.querySelector('.rule-input');
            ruleInput.value = r.rule || '';

            const saveRow = () => {
                const updatedRules = JSON.parse(localStorage.getItem('chat-format-rules'));
                updatedRules[idx] = {
                    rule: ruleInput.value,
                    type: tr.querySelector('.type-select').value,
                    keep: tr.querySelector('.keep-checkbox').checked,
                    linebreak: tr.querySelector('.linebreak-checkbox').checked
                };
                localStorage.setItem('chat-format-rules', JSON.stringify(updatedRules));
            };

            ruleInput.addEventListener('input', saveRow);
            tr.querySelector('.type-select').addEventListener('change', saveRow);
            tr.querySelector('.keep-checkbox').addEventListener('change', saveRow);
            tr.querySelector('.linebreak-checkbox').addEventListener('change', saveRow);

            tr.querySelector('.btn-delete-rule').addEventListener('click', () => {
                const updatedRules = JSON.parse(localStorage.getItem('chat-format-rules'));
                updatedRules.splice(idx, 1);
                localStorage.setItem('chat-format-rules', JSON.stringify(updatedRules));
                this.renderChatFormatRules();
            });

            tbody.appendChild(tr);
        });
    },

    initSettings() {
        // Tab switching for settings
        this.container.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.container.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                const groups = this.container.querySelectorAll('#view-settings .settings-group');
                groups.forEach(g => {
                    if (g.id === `settings-group-${tab}`) {
                        g.style.display = '';
                    } else {
                        g.style.display = 'none';
                    }
                });
            });
        });

        const autoLineBreakToggle = this.container.querySelector('#chat-auto-line-break');
        if (autoLineBreakToggle) {
            const savedSetting = localStorage.getItem('chat-auto-line-break');
            if (savedSetting !== null) {
                autoLineBreakToggle.checked = savedSetting === 'true';
            }
            autoLineBreakToggle.addEventListener('change', (e) => {
                localStorage.setItem('chat-auto-line-break', e.target.checked);
            });
        }

        const btnAddRule = this.container.querySelector('#btn-chat-add-rule');
        if (btnAddRule) {
            btnAddRule.addEventListener('click', () => {
                const rules = JSON.parse(localStorage.getItem('chat-format-rules')) || [];
                rules.push({ rule: '', type: 'Dialogue', linebreak: true });
                localStorage.setItem('chat-format-rules', JSON.stringify(rules));
                this.renderChatFormatRules();
            });
        }
        this.renderChatFormatRules();

        const systemPromptTextarea = this.container.querySelector('#chat-system-prompt');
        if (systemPromptTextarea) {
            const savedPrompt = localStorage.getItem('chat-system-prompt');
            if (savedPrompt !== null) {
                systemPromptTextarea.value = savedPrompt;
            } else {
                systemPromptTextarea.value = "Stay in character. Keep responses concise and natural for a chat application. Do not break character.";
            }

            systemPromptTextarea.addEventListener('input', (e) => {
                localStorage.setItem('chat-system-prompt', e.target.value);
                // Auto grow
                e.target.style.height = 'auto';
                e.target.style.height = (e.target.scrollHeight) + 'px';
            });

            // Initial auto-grow
            setTimeout(() => {
                systemPromptTextarea.style.height = 'auto';
                systemPromptTextarea.style.height = (systemPromptTextarea.scrollHeight) + 'px';
            }, 0);
        }

        // --- LLM Settings ---
        const loadLLMModels = async () => {
            const select = this.container.querySelector('#chat-llm-model');
            if (!select) return;
            try {
                const res = await fetch('/api/plugin/chat/generate/models', {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('yuuka-auth-token')}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.models) {
                        const savedVal = localStorage.getItem('chat-llm-model') || '';
                        let html = '<option value="">Default</option>';
                        data.models.forEach(c => {
                            html += `<option value="${c.id}" ${c.id === savedVal ? 'selected' : ''}>${c.name || c.id}</option>`;
                        });
                        select.innerHTML = html;
                    }
                }
            } catch (err) {
                console.warn("[Chat Settings] Failed to load LLM models:", err);
            }
            select.addEventListener('change', (e) => {
                localStorage.setItem('chat-llm-model', e.target.value);
            });
        };
        loadLLMModels();

        const llmTempInput = this.container.querySelector('#chat-llm-temperature');
        const llmTempVal = this.container.querySelector('#chat-llm-temperature-val');
        if (llmTempInput) {
            const tempValues = [-1, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5];
            const valToIndex = (val) => {
                const num = parseFloat(val);
                if (isNaN(num) || num < 0.5) return 0;
                let idx = Math.round((num - 0.5) * 10) + 1;
                return Math.max(0, Math.min(11, idx));
            };

            const savedTemp = localStorage.getItem('chat-llm-temperature');
            if (savedTemp !== null) {
                llmTempInput.value = valToIndex(savedTemp);
            }

            const updateDisplay = () => {
                const idx = parseInt(llmTempInput.value);
                const actualVal = tempValues[idx];
                if (llmTempVal) {
                    llmTempVal.textContent = actualVal === -1 ? 'Default' : actualVal.toFixed(1);
                }
                return actualVal;
            };

            updateDisplay();

            llmTempInput.addEventListener('input', (e) => {
                const actualVal = updateDisplay();
                localStorage.setItem('chat-llm-temperature', actualVal);
            });
        }

        // --- Image Generation Settings ---
        const initToggle = (id, defaultVal) => {
            const toggle = this.container.querySelector(`#${id}`);
            if (toggle) {
                const saved = localStorage.getItem(id);
                if (saved !== null) {
                    toggle.checked = saved === 'true';
                } else {
                    toggle.checked = defaultVal;
                }
                toggle.addEventListener('change', (e) => {
                    localStorage.setItem(id, e.target.checked);
                });
            }
        };

        const initText = (id, defaultVal) => {
            const input = this.container.querySelector(`#${id}`);
            if (input) {
                const saved = localStorage.getItem(id);
                if (saved !== null) {
                    input.value = saved;
                } else {
                    input.value = defaultVal;
                }
                input.addEventListener('input', (e) => {
                    localStorage.setItem(id, e.target.value);
                });
            }
        };

        initToggle('chat-image-gen-every-message', false);
        initToggle('chat-image-gen-use-quality', true);
        initToggle('chat-image-gen-use-negative', true);
        initText('chat-image-gen-non-outfits', '');
        initText('chat-image-gen-additional-tags', '');

        const viewModeSelect = this.container.querySelector('#chat-image-gen-view-mode');
        if (viewModeSelect) {
            const savedViewMode = localStorage.getItem('chat-image-gen-view-mode');
            if (savedViewMode) {
                viewModeSelect.value = savedViewMode;
            } else {
                viewModeSelect.value = 'bubble';
            }
            viewModeSelect.addEventListener('change', (e) => {
                localStorage.setItem('chat-image-gen-view-mode', e.target.value);
                // Also trigger background update if currently in chat view
                if (this.state.currentTab === 'chat' && typeof this.renderMessages === 'function') {
                    this.renderMessages();
                }
            });
        }

        const loadCheckpoints = async () => {
            const select = this.container.querySelector('#chat-image-gen-ckpt_name');
            if (!select) return;
            try {
                const res = await fetch('/api/plugin/album/comfyui/info?character_hash=default', {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('yuuka-auth-token')}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.global_choices && data.global_choices.checkpoints) {
                        const ckpts = data.global_choices.checkpoints;
                        const savedVal = localStorage.getItem('chat-image-gen-ckpt_name') || '';
                        let html = '<option value="">Default (From album config)</option>';
                        ckpts.forEach(c => {
                            html += `<option value="${c.value}" ${c.value === savedVal ? 'selected' : ''}>${c.name}</option>`;
                        });
                        select.innerHTML = html;
                    }
                }
            } catch (err) {
                console.warn("[Chat Settings] Failed to load checkpoints:", err);
            }
            select.addEventListener('change', (e) => {
                localStorage.setItem('chat-image-gen-ckpt_name', e.target.value);
            });
        };
        loadCheckpoints();

        // --- Theme Customization ---
        const fontSelect = this.container.querySelector('#chat-theme-font');
        if (fontSelect) {
            const savedFont = localStorage.getItem('chat-theme-font') || '';
            fontSelect.value = savedFont;
            fontSelect.addEventListener('change', (e) => {
                localStorage.setItem('chat-theme-font', e.target.value);
                this.applyThemeCustomizations();
            });
        }

        const fontSizeValues = [12, 13, 14, 15, 16, 17, 18, 19, 20];
        const fontSizeInput = this.container.querySelector('#chat-theme-font-size');
        const fontSizeVal = this.container.querySelector('#chat-theme-font-size-val');
        if (fontSizeInput) {
            const savedSize = localStorage.getItem('chat-theme-font-size');
            if (savedSize !== null) {
                const idx = fontSizeValues.indexOf(parseInt(savedSize));
                fontSizeInput.value = idx >= 0 ? idx : 3;
            }
            const updateFontSizeDisplay = () => {
                const idx = parseInt(fontSizeInput.value);
                const val = fontSizeValues[idx];
                if (fontSizeVal) fontSizeVal.textContent = val + 'px';
                return val;
            };
            updateFontSizeDisplay();
            fontSizeInput.addEventListener('input', () => {
                const val = updateFontSizeDisplay();
                localStorage.setItem('chat-theme-font-size', val);
                this.applyThemeCustomizations();
            });
        }

        const lineSpaceValues = [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4];
        const lineSpaceInput = this.container.querySelector('#chat-theme-line-space');
        const lineSpaceVal = this.container.querySelector('#chat-theme-line-space-val');
        if (lineSpaceInput) {
            const savedLS = localStorage.getItem('chat-theme-line-space');
            if (savedLS !== null) {
                const idx = lineSpaceValues.indexOf(parseFloat(savedLS));
                lineSpaceInput.value = idx >= 0 ? idx : 2;
            }
            const updateLineSpaceDisplay = () => {
                const idx = parseInt(lineSpaceInput.value);
                const val = lineSpaceValues[idx];
                if (lineSpaceVal) lineSpaceVal.textContent = val.toFixed(1);
                return val;
            };
            updateLineSpaceDisplay();
            lineSpaceInput.addEventListener('input', () => {
                const val = updateLineSpaceDisplay();
                localStorage.setItem('chat-theme-line-space', val);
                this.applyThemeCustomizations();
            });
        }

        const textColorInput = this.container.querySelector('#chat-theme-text-color');
        const textColorReset = this.container.querySelector('#chat-theme-text-color-reset');
        if (textColorInput) {
            const savedColor = localStorage.getItem('chat-theme-text-color') || '';
            if (savedColor) textColorInput.value = savedColor;
            textColorInput.addEventListener('input', (e) => {
                localStorage.setItem('chat-theme-text-color', e.target.value);
                this.applyThemeCustomizations();
            });
        }
        if (textColorReset) {
            textColorReset.addEventListener('click', () => {
                localStorage.removeItem('chat-theme-text-color');
                if (textColorInput) textColorInput.value = '#ffffff';
                this.applyThemeCustomizations();
            });
        }

        const bubbleOpacityValues = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
        const bubbleOpacityInput = this.container.querySelector('#chat-theme-bubble-opacity');
        const bubbleOpacityVal = this.container.querySelector('#chat-theme-bubble-opacity-val');
        if (bubbleOpacityInput) {
            const savedOpacity = localStorage.getItem('chat-theme-bubble-opacity');
            if (savedOpacity !== null) {
                const idx = bubbleOpacityValues.indexOf(parseInt(savedOpacity));
                bubbleOpacityInput.value = idx >= 0 ? idx : 4;
            }
            const updateBubbleOpacityDisplay = () => {
                const idx = parseInt(bubbleOpacityInput.value);
                const val = bubbleOpacityValues[idx];
                if (bubbleOpacityVal) bubbleOpacityVal.textContent = val + '%';
                return val;
            };
            updateBubbleOpacityDisplay();
            bubbleOpacityInput.addEventListener('input', () => {
                const val = updateBubbleOpacityDisplay();
                localStorage.setItem('chat-theme-bubble-opacity', val);
                this.applyThemeCustomizations();
            });
        }

        initToggle('chat-theme-bubble-blur', true);
        const blurToggle = this.container.querySelector('#chat-theme-bubble-blur');
        if (blurToggle) {
            blurToggle.addEventListener('change', () => {
                this.applyThemeCustomizations();
            });
        }

        // Apply theme customizations on init
        this.applyThemeCustomizations();
    }
});

