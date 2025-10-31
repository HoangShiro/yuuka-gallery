(function registerCharacterDefinitionTab(namespace) {
    class CharacterDefinitionTab {
        constructor(store) {
            this.store = store;
            this._unsubscribers = [];
            this.currentCharacterId = null;
            this.idLabel = null;
            this.deleteButton = null;
            this._textareaListeners = [];
            this.textareas = [];
            this._visibilityObserver = null;
            this._pendingTextareaRefresh = false;
            this._domDisposers = [];
            this.avatarField = null;
            this.avatarDropzone = null;
            this.avatarPreview = null;
            this.avatarPlaceholder = null;
            this.avatarClearButton = null;
            this._avatarFileInput = null;
        }

        mount(container) {
            this.container = container;
            this.container.classList.add("chat-tab", "chat-tab--definition");
            this.headerElement = this.container.querySelector('[data-role="tab-header"]');
            this.contentElement = this.container.querySelector('[data-role="tab-content"]') || this.container;

            if (this.headerElement) {
                this.headerElement.innerHTML = `
                    <div class="chat-form__header">
                        <div class="chat-form__header-main">
                            <h2>Character Definition</h2>
                            <p class="chat-muted">Maintain persona, appearance, and dynamic context for each character.</p>
                        </div>
                        <div class="chat-definition-id" data-role="definition-id-label">ID will be generated on save</div>
                    </div>
                `;
            }

            if (this.contentElement) {
                this.contentElement.innerHTML = `
                    <form class="chat-form" data-role="definition-form">
                        <section class="chat-form__section chat-grid-2">
                            <div>
                                <label>Display name</label>
                                <input type="text" data-field="display-name" placeholder="Name shown on chat page">
                            </div>
                            <div>
                                <label>Name</label>
                                <input type="text" data-field="name" placeholder="Canonical name">
                            </div>
                        </section>
                        <section class="chat-form__section">
                            <label>Avatar</label>
                            <div class="chat-avatar-field" data-role="avatar-field">
                                <div class="chat-avatar-dropzone" data-role="avatar-dropzone" tabindex="0">
                                    <div class="chat-avatar-preview" data-role="avatar-preview"></div>
                                    <div class="chat-avatar-placeholder" data-role="avatar-placeholder">
                                        <span class="material-symbols-outlined">image</span>
                                        <p>Click or drop to upload</p>
                                    </div>
                                </div>
                                <button type="button" class="chat-avatar-clear" data-role="avatar-clear" aria-label="Remove avatar">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                                <input type="hidden" data-field="avatar">
                                <input type="file" accept="image/*" data-role="avatar-file-input" hidden>
                            </div>
                        </section>
                        <section class="chat-form__section">
                            <label>Appearance tags</label>
                            <input type="text" data-field="appearance" placeholder="long hair, blue eyes">
                            <p class="chat-form__hint">Describe hair, face, and body only. Do not include outfits.</p>
                        </section>
                        <section class="chat-form__section">
                            <label>Outfits tags</label>
                            <input type="text" data-field="current-outfits" placeholder="casual, hoodie">
                            <p class="chat-form__hint">Describe clothing and accessories. Separate entries with commas.</p>
                        </section>
                        <section class="chat-form__section">
                            <label>Scenario / Persona</label>
                            <textarea rows="3" data-field="scenario" placeholder="Traits, motivations, background..."></textarea>
                        </section>
                        <section class="chat-form__section">
                            <label>First messages</label>
                            <textarea rows="3" data-field="first-messages" placeholder="One message per line"></textarea>
                        </section>
                        <section class="chat-form__section">
                            <label>Example dialogs</label>
                            <textarea rows="4" data-field="example-dialogs" placeholder="Sample exchanges between character and user, one per line"></textarea>
                        </section>
                        <div class="chat-form__system-fields" aria-hidden="true">
                            <input type="hidden" data-field="current-time">
                            <input type="hidden" data-field="current-action">
                            <input type="hidden" data-field="current-context">
                        </div>
                        <footer class="chat-form__footer">
                            <button type="submit" class="chat-btn chat-btn--primary">
                                <span class="material-symbols-outlined">save</span>
                                Save Definition
                            </button>
                            <button type="button" class="chat-btn chat-btn--danger" data-action="delete-definition">
                                <span class="material-symbols-outlined">delete</span>
                                Delete
                            </button>
                        </footer>
                    </form>
                `;
            }

            this.form = this.contentElement ? this.contentElement.querySelector('[data-role="definition-form"]') : null;
            this.idLabel = this.headerElement ? this.headerElement.querySelector('[data-role="definition-id-label"]') : null;
            if (!this.form) {
                return;
            }
            this.deleteButton = this.form.querySelector('[data-action="delete-definition"]');
            this.avatarField = this.form.querySelector('[data-role="avatar-field"]');
            this.avatarDropzone = this.form.querySelector('[data-role="avatar-dropzone"]');
            this.avatarPreview = this.form.querySelector('[data-role="avatar-preview"]');
            this.avatarPlaceholder = this.form.querySelector('[data-role="avatar-placeholder"]');
            this.avatarClearButton = this.form.querySelector('[data-role="avatar-clear"]');
            this._avatarFileInput = this.form.querySelector('[data-role="avatar-file-input"]');

            this.fieldMap = {
                displayName: this.form.querySelector('[data-field="display-name"]'),
                name: this.form.querySelector('[data-field="name"]'),
                avatar: this.avatarField ? this.avatarField.querySelector('[data-field="avatar"]') : null,
                appearance: this.form.querySelector('[data-field="appearance"]'),
                scenario: this.form.querySelector('[data-field="scenario"]'),
                firstMessages: this.form.querySelector('[data-field="first-messages"]'),
                exampleDialogs: this.form.querySelector('[data-field="example-dialogs"]'),
                currentTime: this.form.querySelector('[data-field="current-time"]'),
                currentOutfits: this.form.querySelector('[data-field="current-outfits"]'),
                currentAction: this.form.querySelector('[data-field="current-action"]'),
                currentContext: this.form.querySelector('[data-field="current-context"]'),
            };

            this._attachAvatarUploader();

            this.textareas = Array.from(this.form.querySelectorAll("textarea"));
            this.textareas.forEach((textarea) => {
                this._ensureTextareaMinHeight(textarea);
                const handler = () => this._scheduleTextareaResize(textarea);
                const events = ["input", "change"];
                events.forEach(eventType => textarea.addEventListener(eventType, handler));
                this._textareaListeners.push({ textarea, handler, events });
                this._scheduleTextareaResize(textarea);
            });

            this._observePanelVisibility();

            this.form.addEventListener("submit", (event) => {
                event.preventDefault();
                this._handleSubmit();
            });

            this.deleteButton.addEventListener("click", () => this._handleDelete());

            this._unsubscribers.push(
                this.store.on("active-character", (event) => {
                    const { characterId, definition } = event.detail || {};
                    this.setDefinition(characterId, definition || {});
                })
            );
        }

        _attachAvatarUploader() {
            if (!this.avatarDropzone || !this._avatarFileInput || !this.fieldMap.avatar) {
                return;
            }

            this.avatarDropzone.setAttribute("role", "button");
            this.avatarDropzone.setAttribute("aria-label", "Upload avatar");

            const openPicker = () => {
                if (this._avatarFileInput) {
                    this._avatarFileInput.click();
                }
            };

            const stopEvent = (event) => {
                event.preventDefault();
                event.stopPropagation();
            };

            const handleClick = () => openPicker();
            const handleKeyDown = (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openPicker();
                }
            };
            const handleChange = (event) => {
                const files = event.target?.files;
                if (files && files.length) {
                    this._handleAvatarFiles(files);
                }
                if (this._avatarFileInput) {
                    this._avatarFileInput.value = "";
                }
            };
            const handleDragOver = (event) => {
                stopEvent(event);
                this.avatarDropzone.classList.add("is-dragover");
            };
            const handleDragLeave = (event) => {
                stopEvent(event);
                this.avatarDropzone.classList.remove("is-dragover");
            };
            const handleDrop = (event) => {
                stopEvent(event);
                this.avatarDropzone.classList.remove("is-dragover");
                const files = event.dataTransfer?.files;
                if (files && files.length) {
                    this._handleAvatarFiles(files);
                    return;
                }
                const url = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain");
                if (url) {
                    this._setAvatarFromUrl(url.trim());
                }
            };
            const handlePaste = (event) => {
                const text = event.clipboardData?.getData("text");
                if (text) {
                    event.preventDefault();
                    this._setAvatarFromUrl(text.trim());
                }
            };
            const handleClear = () => {
                this._setAvatarValue("");
                if (this._avatarFileInput) {
                    this._avatarFileInput.value = "";
                }
            };

            this.avatarDropzone.addEventListener("click", handleClick);
            this.avatarDropzone.addEventListener("keydown", handleKeyDown);
            this.avatarDropzone.addEventListener("dragenter", stopEvent);
            this.avatarDropzone.addEventListener("dragover", handleDragOver);
            this.avatarDropzone.addEventListener("dragleave", handleDragLeave);
            this.avatarDropzone.addEventListener("drop", handleDrop);
            this.avatarDropzone.addEventListener("paste", handlePaste);
            this._domDisposers.push(() => {
                this.avatarDropzone.removeEventListener("click", handleClick);
                this.avatarDropzone.removeEventListener("keydown", handleKeyDown);
                this.avatarDropzone.removeEventListener("dragenter", stopEvent);
                this.avatarDropzone.removeEventListener("dragover", handleDragOver);
                this.avatarDropzone.removeEventListener("dragleave", handleDragLeave);
                this.avatarDropzone.removeEventListener("drop", handleDrop);
                this.avatarDropzone.removeEventListener("paste", handlePaste);
            });

            if (this._avatarFileInput) {
                this._avatarFileInput.addEventListener("change", handleChange);
                this._domDisposers.push(() => this._avatarFileInput.removeEventListener("change", handleChange));
            }

            if (this.avatarClearButton) {
                this.avatarClearButton.addEventListener("click", handleClear);
                this._domDisposers.push(() => this.avatarClearButton.removeEventListener("click", handleClear));
                this.avatarClearButton.hidden = true;
            }
        }

        _handleAvatarFiles(fileList) {
            const files = Array.from(fileList || []).filter(file => file && file.type && file.type.startsWith("image/"));
            if (!files.length) {
                alert("Please select an image file.");
                return;
            }
            const file = files[0];
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === "string") {
                    this._setAvatarValue(reader.result);
                }
                if (this._avatarFileInput) {
                    this._avatarFileInput.value = "";
                }
            };
            reader.onerror = () => {
                if (this._avatarFileInput) {
                    this._avatarFileInput.value = "";
                }
                alert("Failed to read image file.");
            };
            reader.readAsDataURL(file);
        }

        _setAvatarFromUrl(url) {
            if (!url) {
                this._setAvatarValue("");
                return;
            }
            this._setAvatarValue(url);
        }

        _setAvatarValue(value) {
            const input = this.fieldMap.avatar;
            if (!input) {
                return;
            }
            input.value = typeof value === "string" ? value : "";
            this._refreshAvatarUI(input.value);
        }

        _refreshAvatarUI(value) {
            const hasImage = Boolean(value);
            if (this.avatarField) {
                this.avatarField.classList.toggle("has-image", hasImage);
            }
            if (this.avatarDropzone) {
                this.avatarDropzone.classList.toggle("has-image", hasImage);
                this.avatarDropzone.classList.remove("is-dragover");
            }
            if (this.avatarPlaceholder) {
                this.avatarPlaceholder.classList.toggle("is-hidden", hasImage);
            }
            if (this.avatarClearButton) {
                this.avatarClearButton.hidden = !hasImage;
            }
            if (this.avatarPreview) {
                this.avatarPreview.innerHTML = "";
                if (hasImage && typeof document !== "undefined") {
                    const img = document.createElement("img");
                    img.src = value;
                    img.alt = "Avatar preview";
                    this.avatarPreview.appendChild(img);
                }
            }
        }

        destroy() {
            this._unsubscribers.forEach(unsub => unsub());
            this._unsubscribers = [];
            this._textareaListeners.forEach(({ textarea, handler, events }) => {
                (events || ["input"]).forEach(eventType => textarea.removeEventListener(eventType, handler));
                if (textarea._chatAutoResizeRaf) {
                    if (typeof cancelAnimationFrame === "function") {
                        cancelAnimationFrame(textarea._chatAutoResizeRaf);
                    }
                    textarea._chatAutoResizeRaf = null;
                }
                delete textarea.dataset.autoResizeMinHeight;
                delete textarea.dataset.autoResizePending;
            });
            this._textareaListeners = [];
            this.textareas = [];
            if (this._visibilityObserver) {
                this._visibilityObserver.disconnect();
                this._visibilityObserver = null;
            }
            this._pendingTextareaRefresh = false;
            this._domDisposers.forEach(dispose => dispose());
            this._domDisposers = [];
            this.avatarField = null;
            this.avatarDropzone = null;
            this.avatarPreview = null;
            this.avatarPlaceholder = null;
            this.avatarClearButton = null;
            this._avatarFileInput = null;
            if (this.headerElement) {
                this.headerElement.innerHTML = "";
            }
            if (this.contentElement) {
                this.contentElement.innerHTML = "";
            }
            this.form = null;
            this.idLabel = null;
            this.headerElement = null;
            this.contentElement = null;
        }

        prepareNewDefinition() {
            this.setDefinition(null, {});
            this._focusField(this.fieldMap.displayName);
        }

        setDefinition(characterId, definition = {}) {
            this.currentCharacterId = characterId || null;

            const label = characterId ? `ID: ${characterId}` : "ID will be generated on save";
            if (this.idLabel) {
                this.idLabel.textContent = label;
            }
            if (this.deleteButton) {
                this.deleteButton.disabled = !characterId;
            }

            this.fieldMap.displayName.value = definition.display_name || "";
            this.fieldMap.name.value = definition.name || "";
            this._setAvatarValue(definition.avatar || "");
            this.fieldMap.appearance.value = (definition.appearance || []).join(", ");
            this.fieldMap.scenario.value = definition.scenario || "";
            this.fieldMap.firstMessages.value = (definition.first_messages || []).join("\n");
            this.fieldMap.exampleDialogs.value = (definition.example_dialogs || []).join("\n");

            const current = definition.current || {};
            this.fieldMap.currentTime.value = current.time || "";
            this.fieldMap.currentOutfits.value = (current.outfits || []).join(", ");
            this.fieldMap.currentAction.value = (current.action || []).join(", ");
            this.fieldMap.currentContext.value = (current.context || []).join(", ");

            this._refreshTextareaHeights();
        }

        async _handleSubmit() {
            const payload = {
                display_name: this.fieldMap.displayName.value.trim(),
                name: this.fieldMap.name.value.trim(),
                avatar: this.fieldMap.avatar.value.trim() || null,
                appearance: this._parseTags(this.fieldMap.appearance.value),
                scenario: this.fieldMap.scenario.value.trim(),
                first_messages: this._parseLines(this.fieldMap.firstMessages.value),
                example_dialogs: this._parseLines(this.fieldMap.exampleDialogs.value),
                current: {
                    time: this.fieldMap.currentTime.value.trim(),
                    outfits: this._parseTags(this.fieldMap.currentOutfits.value),
                    action: this._parseTags(this.fieldMap.currentAction.value),
                    context: this._parseTags(this.fieldMap.currentContext.value),
                },
            };

            const result = await this.store.saveCharacterDefinition(this.currentCharacterId, payload);
            if (result && result.id) {
                this.setDefinition(result.id, result.definition || payload);
            }
            alert("Character definition saved.");
        }

        async _handleDelete() {
            if (!this.currentCharacterId) {
                return;
            }
            const confirmed = confirm("Delete this character definition?");
            if (!confirmed) return;
            await this.store.deleteCharacter(this.currentCharacterId);
            this.currentCharacterId = null;
            this.setDefinition(null, {});
            alert("Character deleted.");
        }

        _parseTags(value) {
            return value
                .split(",")
                .map(tag => tag.trim())
                .filter(Boolean);
        }

        _parseLines(value) {
            return value
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean);
        }

        _focusField(field) {
            if (field && typeof field.focus === "function") {
                field.focus();
                if (typeof field.select === "function") {
                    field.select();
                }
            }
        }

        _observePanelVisibility() {
            if (!this.container || typeof MutationObserver === "undefined") {
                return;
            }
            if (this._visibilityObserver) {
                this._visibilityObserver.disconnect();
            }
            this._visibilityObserver = new MutationObserver(() => {
                if (this._isPanelVisible()) {
                    const hasPending = Array.isArray(this.textareas)
                        && this.textareas.some(textarea => textarea && textarea.dataset.autoResizePending === "1");
                    if (this._pendingTextareaRefresh || hasPending) {
                        this._pendingTextareaRefresh = false;
                        this._refreshTextareaHeights(true);
                    }
                }
            });
            this._visibilityObserver.observe(this.container, { attributes: true, attributeFilter: ["class"] });
            if (this._isPanelVisible()) {
                this._refreshTextareaHeights(true);
            }
        }

        _refreshTextareaHeights(force = false) {
            if (!this.textareas || !this.textareas.length) {
                return;
            }
            if (!force && !this._isPanelVisible()) {
                this._pendingTextareaRefresh = true;
                this.textareas.forEach(textarea => {
                    if (textarea) {
                        textarea.dataset.autoResizePending = "1";
                    }
                });
                return;
            }
            this.textareas.forEach(textarea => this._scheduleTextareaResize(textarea, force));
        }

        _scheduleTextareaResize(textarea, force = false) {
            if (!textarea) {
                return;
            }
            if (!force && !this._isTextareaVisible(textarea)) {
                textarea.dataset.autoResizePending = "1";
                this._pendingTextareaRefresh = true;
                return;
            }
            delete textarea.dataset.autoResizePending;
            this._ensureTextareaMinHeight(textarea);
            if (textarea._chatAutoResizeRaf && typeof cancelAnimationFrame === "function") {
                cancelAnimationFrame(textarea._chatAutoResizeRaf);
                textarea._chatAutoResizeRaf = null;
            }
            const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
            if (raf) {
                textarea._chatAutoResizeRaf = raf(() => {
                    this._autoResizeTextarea(textarea);
                    textarea._chatAutoResizeRaf = null;
                });
            } else {
                this._autoResizeTextarea(textarea);
            }
        }

        _ensureTextareaMinHeight(textarea) {
            if (!textarea) {
                return 0;
            }
            const cached = Number(textarea.dataset.autoResizeMinHeight);
            if (Number.isFinite(cached) && cached > 0) {
                return cached;
            }
            let minHeight = 0;
            try {
                const style = window.getComputedStyle(textarea);
                const styleMin = parseFloat(style.minHeight);
                const lineHeight = parseFloat(style.lineHeight);
                if (Number.isFinite(styleMin) && styleMin > 0) {
                    minHeight = styleMin;
                } else if (Number.isFinite(lineHeight) && lineHeight > 0) {
                    minHeight = lineHeight * (parseInt(textarea.getAttribute("rows") || "1", 10) || 1);
                }
            } catch (err) {
                // getComputedStyle may fail in some contexts; fall back to scrollHeight
            }
            if (!Number.isFinite(minHeight) || minHeight <= 0) {
                minHeight = textarea.scrollHeight || textarea.offsetHeight || 0;
            }
            textarea.dataset.autoResizeMinHeight = minHeight;
            return minHeight;
        }

        _autoResizeTextarea(textarea) {
            if (!textarea) {
                return;
            }
            const maxHeight = 1900;
            const minHeight = this._ensureTextareaMinHeight(textarea);
            textarea.style.height = "auto";
            const contentHeight = textarea.scrollHeight;
            const desiredHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);
            textarea.style.height = `${desiredHeight}px`;
            textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
        }

        _isTextareaVisible(textarea) {
            if (!textarea) {
                return false;
            }
            if (textarea.offsetParent) {
                return true;
            }
            return this._isPanelVisible();
        }

        _isPanelVisible() {
            if (!this.container) {
                return false;
            }
            if (!this.container.classList.contains("active")) {
                return false;
            }
            if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
                const style = window.getComputedStyle(this.container);
                if (style.display === "none" || style.visibility === "hidden") {
                    return false;
                }
            }
            return this.container.offsetParent !== null || this.container.getClientRects().length > 0;
        }
    }

    namespace.CharacterDefinitionTab = CharacterDefinitionTab;
})(window.Yuuka.plugins.chat.components);
