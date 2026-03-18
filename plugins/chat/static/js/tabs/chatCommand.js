Object.assign(window.ChatComponent.prototype, {
    _initCommandSystem(composer, textarea) {
        this._cmdState = {
            active: false,
            query: '',
            startIndex: -1,
            items: [],
            selectedIndex: 0,
            menuEl: null,
            inlineFormEl: null,
            submitForm: null
        };

        // Hook _handleDockSend
        if (!this._originalHandleDockSend) {
            this._originalHandleDockSend = this._handleDockSend;
            this._handleDockSend = async function (textareaEl) {
                if (this._cmdState && this._cmdState.inlineFormEl && typeof this._cmdState.submitForm === 'function') {
                    const intercepted = await this._cmdState.submitForm();
                    if (intercepted) return; // The command handled the send completely
                }
                this._originalHandleDockSend.call(this, textareaEl);
            };
        }

        const updateMenuPosition = () => {
            if (!this._cmdState.menuEl) return;
            const rect = textarea.getBoundingClientRect();
            this._cmdState.menuEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
            this._cmdState.menuEl.style.left = `${rect.left}px`;
            this._cmdState.menuEl.style.width = `${rect.width}px`;
        };

        const closeMenu = () => {
            this._cmdState.active = false;
            if (this._cmdState.menuEl) {
                this._cmdState.menuEl.remove();
                this._cmdState.menuEl = null;
            }
        };

        const renderMenu = () => {
            if (!this._cmdState.menuEl) {
                this._cmdState.menuEl = document.createElement('div');
                this._cmdState.menuEl.className = 'chat-command-menu';
                this._cmdState.menuEl.style.cssText = `
                    position: fixed;
                    background: var(--chat-panel-bg, #1e1e1e);
                    border: 1px solid var(--chat-border, #333);
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    z-index: 999999;
                    max-height: 200px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                `;
                document.body.appendChild(this._cmdState.menuEl);

                // Sync theme
                const chatApp = this.container.querySelector('.chat-app-container');
                if (chatApp) {
                    ['theme-yuuka', 'theme-modern'].forEach(cls => {
                        if (chatApp.classList.contains(cls)) this._cmdState.menuEl.classList.add(cls);
                    });
                }
            }
            updateMenuPosition();

            this._cmdState.menuEl.innerHTML = '';

            if (this._cmdState.items.length === 0) {
                closeMenu();
                return;
            }

            this._cmdState.items.forEach((item, idx) => {
                const el = document.createElement('div');
                el.style.cssText = `
                    padding: 8px 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--chat-text, #fff);
                    ${idx === this._cmdState.selectedIndex ? 'background: var(--chat-primary-alpha, rgba(102, 255, 170, 0.2));' : ''}
                `;
                el.innerHTML = `
                    <span class="material-symbols-outlined" style="font-size: 1.2em; color: var(--chat-primary, #6fa);">${item.icon}</span>
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 500;">${item.label}</span>
                        <span style="font-size: 0.8em; color: var(--chat-text-secondary, #999);">${item.desc}</span>
                    </div>
                `;
                el.addEventListener('mouseenter', () => {
                    this._cmdState.selectedIndex = idx;
                    renderMenu();
                });

                el.addEventListener('mousedown', (e) => { // Use mousedown to fire before blur
                    e.preventDefault();
                    executeCompletion(item);
                });
                this._cmdState.menuEl.appendChild(el);
            });
        };

        const executeCompletion = (item) => {
            const val = textarea.value;
            const before = val.substring(0, this._cmdState.startIndex);
            const after = val.substring(textarea.selectionEnd);

            if (item.type === 'character') {
                textarea.value = before + item.value + (after.startsWith(' ') ? '' : ' ') + after;
                closeMenu();
                textarea.focus();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (item.type === 'command') {
                textarea.value = before + '@' + item.value + (after.startsWith(' ') ? '' : ' ') + after;
                closeMenu();
                textarea.focus();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));

                if (item.value === 'gift') {
                    this._showGiftCommandInline(composer, textarea);
                }
            }
        };

        textarea.addEventListener('input', () => {
            const val = textarea.value;

            if (this._cmdState.inlineFormEl && !val.includes('@gift')) {
                this._cmdState.inlineFormEl.remove();
                this._cmdState.inlineFormEl = null;
                this._cmdState.submitForm = null;
            }

            const cursorPos = textarea.selectionEnd;
            let foundIndex = -1;

            for (let i = cursorPos - 1; i >= 0; i--) {
                if (val[i] === '@') {
                    if (i === 0 || val[i - 1] === ' ' || val[i - 1] === '\n') {
                        foundIndex = i;
                        break;
                    }
                } else if (val[i] === ' ' || val[i] === '\n') {
                    break;
                }
            }

            if (foundIndex !== -1) {
                this._cmdState.active = true;
                this._cmdState.startIndex = foundIndex;
                this._cmdState.query = val.substring(foundIndex + 1, cursorPos).toLowerCase();

                const allItems = [];
                allItems.push({ type: 'command', value: 'gift', label: 'gift', desc: 'Gift an item to the character', icon: 'redeem' });

                Object.values(this.state.personas.characters || {}).forEach(c => {
                    allItems.push({ type: 'character', value: c.name, label: c.name, desc: 'Character', icon: 'person' });
                });

                this._cmdState.items = allItems.filter(i => i.label.toLowerCase().includes(this._cmdState.query));
                this._cmdState.selectedIndex = 0;
                renderMenu();
            } else {
                closeMenu();
            }
        });

        composer.addEventListener('keydown', (e) => {
            if (e.target !== textarea || !this._cmdState.active) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this._cmdState.selectedIndex = (this._cmdState.selectedIndex + 1) % this._cmdState.items.length;
                renderMenu();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this._cmdState.selectedIndex = (this._cmdState.selectedIndex - 1 + this._cmdState.items.length) % this._cmdState.items.length;
                renderMenu();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (this._cmdState.items[this._cmdState.selectedIndex]) {
                    executeCompletion(this._cmdState.items[this._cmdState.selectedIndex]);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                closeMenu();
            }
        }, true);

        document.addEventListener('click', (e) => {
            if (this._cmdState.active && this._cmdState.menuEl && !this._cmdState.menuEl.contains(e.target) && e.target !== textarea) {
                closeMenu();
            }
        });

        this._loadGiftItems();
    },

    async _loadGiftItems() {
        this._giftItemsCache = [];
        try {
            const res = await this.api['chat'].get('/items');
            this._giftItemsCache = res.items || [];
        } catch (e) {
            console.warn("Failed to load chat items:", e);
        }
    },

    _showGiftCommandInline(composer, textarea) {
        if (this._cmdState.inlineFormEl) {
            this._cmdState.inlineFormEl.remove();
        }

        const updateInlineFormPosition = () => {
            if (!this._cmdState.inlineFormEl) return;
            const rect = textarea.getBoundingClientRect();
            this._cmdState.inlineFormEl.style.bottom = `${window.innerHeight - rect.top + 8}px`;
            this._cmdState.inlineFormEl.style.left = `${rect.left}px`;
            this._cmdState.inlineFormEl.style.width = `${rect.width}px`;
        };

        const form = document.createElement('div');
        this._cmdState.inlineFormEl = form;
        form.className = 'chat-command-inline-form';
        form.style.cssText = `
            position: fixed;
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--chat-panel-bg, #1e1e1e);
            border: 1px solid var(--chat-border, #333);
            border-radius: 8px;
            padding: 8px;
            box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
            flex-wrap: wrap;
            z-index: 999999;
        `;

        const nameLabel = document.createElement('span');
        nameLabel.textContent = '@gift';
        nameLabel.style.color = 'var(--chat-primary, #6fa)';
        nameLabel.style.fontWeight = 'bold';

        const createInput = (placeholder, id) => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.placeholder = placeholder;
            inp.id = id;
            inp.style.cssText = `
                background: transparent;
                border: none;
                color: var(--chat-text);
                outline: none;
                min-width: 80px;
                flex: 1;
                font-family: inherit;
            `;
            return inp;
        };

        const wrapperName = document.createElement('div');
        wrapperName.style.cssText = 'position: relative; flex: 1; min-width: 150px; display:flex; align-items:center; border: 1px solid var(--chat-border); border-radius: 4px; padding: 4px;';
        const inpName = createInput('Item Name', 'gift-name');
        wrapperName.appendChild(inpName);

        const autocompleteName = document.createElement('div');
        autocompleteName.style.cssText = 'position: absolute; bottom: calc(100% + 4px); left: 0; background: var(--chat-panel-bg, #1e1e1e); border: 1px solid var(--chat-border, #333); border-radius: 8px; z-index: 1000000; box-shadow: 0 -4px 12px rgba(0,0,0,0.5); max-height: 200px; overflow-y: auto; width: 100%; display: none; flex-direction: column; overflow-x: hidden;';
        wrapperName.appendChild(autocompleteName);

        const wrapperType = document.createElement('div');
        wrapperType.style.cssText = 'position: relative; flex: 0.5; min-width: 100px; display:flex; align-items:center; border: 1px solid var(--chat-border); border-radius: 4px; padding: 4px;';
        const typeSelect = document.createElement('select');
        typeSelect.style.cssText = 'background: transparent; color: var(--chat-text); border: none; outline: none; width: 100%; font-family: inherit; cursor: pointer; appearance: none;';
        typeSelect.innerHTML = `<option style="background:var(--chat-panel-bg)" value="inventory">Inventory</option><option style="background:var(--chat-panel-bg)" value="outfits">Outfits</option>`;
        wrapperType.appendChild(typeSelect);

        const typeIcon = document.createElement('span');
        typeIcon.className = 'material-symbols-outlined';
        typeIcon.textContent = 'expand_more';
        typeIcon.style.cssText = 'position: absolute; right: 4px; pointer-events: none; color: var(--chat-text-secondary); font-size: 1.2em;';
        wrapperType.appendChild(typeIcon);

        const wrapperTags = document.createElement('div');
        wrapperTags.style.cssText = 'position: relative; flex: 2; min-width: 150px; display:flex; align-items:center; border: 1px solid var(--chat-border); border-radius: 4px; padding: 4px;';
        const inpTags = createInput('Tags (comma separated)', 'gift-tags');
        wrapperTags.appendChild(inpTags);

        const btnCancel = document.createElement('button');
        btnCancel.innerHTML = '<span class="material-symbols-outlined">close</span>';
        btnCancel.className = 'icon-btn';
        btnCancel.style.padding = '4px';
        btnCancel.onclick = () => {
            form.remove();
            this._cmdState.inlineFormEl = null;
            this._cmdState.submitForm = null;
            textarea.value = textarea.value.replace(/@gift\s*/g, '');
            textarea.focus();
        };

        form.appendChild(nameLabel);
        form.appendChild(wrapperName);
        form.appendChild(wrapperType);
        form.appendChild(wrapperTags);
        form.appendChild(btnCancel);

        document.body.appendChild(form);

        // Sync theme
        const chatApp = this.container.querySelector('.chat-app-container');
        if (chatApp) {
            ['theme-yuuka', 'theme-modern'].forEach(cls => {
                if (chatApp.classList.contains(cls)) form.classList.add(cls);
            });
        }
        updateInlineFormPosition();
        inpName.focus();

        let selectedItemConfig = null;

        const checkExactMatch = () => {
            const query = inpName.value.toLowerCase().trim();
            const exact = this._giftItemsCache.find(i => i.name.toLowerCase() === query);
            if (exact) {
                selectedItemConfig = exact;
                wrapperType.style.display = 'none';
                wrapperTags.style.display = 'none';
            } else {
                selectedItemConfig = null;
                wrapperType.style.display = 'flex';
                wrapperTags.style.display = 'flex';
            }
        };

        inpName.addEventListener('input', () => {
            const query = inpName.value.toLowerCase().trim();
            autocompleteName.innerHTML = '';

            const matches = this._giftItemsCache.filter(i => i.name.toLowerCase().includes(query));

            if (matches.length > 0 && query.length > 0) {
                autocompleteName.style.display = 'flex';
                matches.forEach(m => {
                    const row = document.createElement('div');
                    row.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1.2em; color: var(--chat-primary, #6fa); vertical-align: middle; margin-right: 8px;">redeem</span><span style="font-weight: 500;">${m.name}</span>`;
                    row.style.cssText = 'padding: 8px 12px; cursor: pointer; color: var(--chat-text); display: flex; align-items: center;';
                    row.onmouseenter = () => row.style.background = 'var(--chat-primary-alpha, rgba(102, 255, 170, 0.2))';
                    row.onmouseleave = () => row.style.background = 'transparent';
                    row.onmousedown = (e) => { // mousedown fires before blur
                        e.preventDefault();
                        inpName.value = m.name;
                        selectedItemConfig = m;
                        autocompleteName.style.display = 'none';
                        wrapperType.style.display = 'none';
                        wrapperTags.style.display = 'none';
                        textarea.focus();
                    };
                    autocompleteName.appendChild(row);
                });
            } else {
                autocompleteName.style.display = 'none';
            }
            checkExactMatch();
        });

        inpName.addEventListener('blur', () => {
            autocompleteName.style.display = 'none';
        });

        inpName.addEventListener('focus', () => {
            if (inpName.value.trim().length > 0) {
                inpName.dispatchEvent(new Event('input'));
            }
        });

        // Initialize autocompletion for Booru tags via Yuuka SDK
        if (window.Yuuka?.ui?._initTagAutocomplete) {
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
                        try { window.Yuuka.ui._initTagAutocomplete(wrapperTags, fresh); } catch (_) { }
                    });
                } else {
                    try { window.Yuuka.ui._initTagAutocomplete(wrapperTags, tagPredictions); } catch (_) { }
                }
            }
        }

        const submitForm = async () => {
            const name = inpName.value.trim();
            if (!name) {
                alert('Please enter a gift name.');
                return true; // block sending
            }

            let itemDef = selectedItemConfig;

            if (!itemDef) {
                const type = typeSelect.value;
                const tagsRaw = inpTags.value;
                const tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t);

                if (tags.length === 0) {
                    alert('Please enter at least 1 tag for the new item!');
                    return true; // block sending
                }

                itemDef = {
                    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                    name: name,
                    type: type,
                    tags: tags
                };

                try {
                    await this.api['chat'].post('/items', itemDef);
                    this._loadGiftItems();
                } catch (e) {
                    console.error("Failed to save new chat item", e);
                }
            }

            // Cleanup UI
            form.remove();
            this._cmdState.inlineFormEl = null;

            // Route to group handler if in group mode
            if (this.state.activeChatGroupId) {
                const currentText = textarea.value.trim();
                const isGiftOnly = currentText === '@gift';

                if (isGiftOnly) {
                    // Pure gift command: delegate fully to group gift handler
                    textarea.value = '';
                    const addBtn = textarea.parentElement?.querySelector('.nav-btn--system-action');
                    if (addBtn) addBtn.classList.remove('is-hidden');
                    this._executeGroupGiftAction(itemDef);
                    return true;
                } else {
                    // Mixed: add as pending action (handles inventory), strip @gift from text
                    // _executeGroupGiftAction handles inventory changes + pending action
                    this._executeGroupGiftAction(itemDef);

                    // Strip @gift from textarea, keep the rest of the text
                    textarea.value = textarea.value.replace(/@gift\s*/g, '').trim();
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    return false; // Let _handleDockSend send the remaining text
                }
            }

            const session = this.state.activeChatSession;
            if (!session) return true;

            // Delegate to _executeGiftAction which handles inventory + pending action
            this._executeGiftAction(itemDef);

            const currentText = textarea.value.trim();
            if (currentText === '@gift') {
                // Pure @gift with no other text — clear textarea, pending action will be sent on next Send
                textarea.value = '';
                textarea.style.height = '24px';
                const addBtn = textarea.parentElement?.querySelector('.nav-btn--system-action');
                if (addBtn) addBtn.classList.remove('is-hidden');
                return true; // Intercepted
            } else {
                // Mixed: strip @gift from text, keep the rest, let _handleDockSend flush pending + send
                textarea.value = textarea.value.replace(/@gift\s*/g, '').trim();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                return false; // Proceed with normal _handleDockSend
            }
        };

        this._cmdState.submitForm = submitForm;
    }
});
