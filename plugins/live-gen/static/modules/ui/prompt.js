(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const Autocomplete = window.Yuuka.liveGen.Autocomplete;

    class LiveGenPromptUI {
        constructor(component) {
            self = this;
            this.component = component;
            this.state = component.state;
            this.activeSuggestion = "";
            this.suggestionTimer = null;
            this.autocompleteMatches = null;
            this.currentWordBeingTyped = "";
        }

        _restoreTabBadge(shell) {
            if (!shell) return;
            const ghostSug = shell.querySelector(".ghost-suggestion");
            const tabBadge = shell.querySelector(".live-gen-suggestion-tab-badge");
            if (tabBadge && ghostSug && ghostSug.contains(tabBadge)) {
                const wrapper = shell.querySelector(".ghost-suggestion-wrapper");
                if (wrapper) {
                    wrapper.appendChild(tabBadge);
                }
            }
        }

        openPromptMode() {
            const navibar = window.Yuuka?.services?.navibar;
            if (!navibar) return;

            const shell = document.createElement("div");
            shell.className = "live-gen-prompt-shell";
            shell.innerHTML = `
                <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="back" title="Trở lại">
                    <span class="material-symbols-outlined">keyboard_arrow_down</span>
                </button>
                <div class="live-gen-prompt-ghost" style="display: none; cursor: pointer;">
                    <span class="ghost-suggestion-label">
                        <span class="material-symbols-outlined">auto_awesome</span>Gợi ý:
                    </span>
                    <div class="ghost-suggestion-wrapper" style="flex: 1; min-width: 0;">
                        <span class="ghost-suggestion"></span>
                        <span class="live-gen-suggestion-tab-badge" style="display: none;">Tab</span>
                    </div>
                </div>
                <div class="live-gen-prompt-field" style="position: relative;">
                    <textarea class="live-gen-prompt-input" rows="1" placeholder="Nhập prompt..."></textarea>
                </div>
                <div class="live-gen-prompt-actions-wrapper">
                    <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="dice" title="Đổi seed ngẫu nhiên (Reroll Seed)">
                        <span class="material-symbols-outlined">casino</span>
                    </button>
                    <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="auto-prompt" title="Auto prompt">
                        <span class="material-symbols-outlined">auto_awesome</span>
                    </button>
                </div>
            `;

            const input = shell.querySelector(".live-gen-prompt-input");
            input.value = this.state.prompt;
            this.attachAutocomplete(input);
            this.autoGrow(input);

            const backBtn = shell.querySelector('[data-action="back"]');
            const handleBack = (e) => {
                e.preventDefault();
                e.stopPropagation();
                navibar.showSearchBar(null);
            };
            backBtn.addEventListener("click", handleBack);
            backBtn.addEventListener("touchend", handleBack);
            backBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            backBtn.addEventListener("touchstart", (e) => {
                e.stopPropagation();
            });
            
            const diceBtn = shell.querySelector('[data-action="dice"]');
            const handleDice = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.component._rerollSeed();
            };
            diceBtn.addEventListener("click", handleDice);
            diceBtn.addEventListener("touchend", handleDice);
            diceBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            diceBtn.addEventListener("touchstart", (e) => {
                e.stopPropagation();
            });

            const autoPromptBtn = shell.querySelector('[data-action="auto-prompt"]');
            const handleAutoPrompt = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.triggerAutoPrompt(input, shell);
            };
            autoPromptBtn.addEventListener("click", handleAutoPrompt);
            autoPromptBtn.addEventListener("touchend", handleAutoPrompt);
            autoPromptBtn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            autoPromptBtn.addEventListener("touchstart", (e) => {
                e.stopPropagation();
            });

            input.addEventListener("input", () => {
                this.state.setPrompt(input.value);
                this.autoGrow(input);

                // Xóa gợi ý hiện tại lập tức khi có ký tự mới gõ vào
                this.clearSuggestion(shell);

                // Hẹn giờ gợi ý động nếu được bật
                if (this.state.config && this.state.config.llm_suggestions_enabled !== false) {
                    this.scheduleDynamicSuggestion(input, shell);
                }

                const trimmed = this.state.prompt.trim();
                if (!trimmed) {
                    this.component.lastGeneratedPrompt = "";
                    clearTimeout(this.component.debounceTimer);
                    this.component.wsClient.send({ type: "cancel" });
                    this.component._setProgress(0);
                    this.component._setStatus("Sẵn sàng.", "ready");
                    return;
                }
                const immediate = /[\r\n,]\s*$/.test(trimmed);
                this.component._scheduleGeneration(immediate ? 200 : 600);
            });

            // Ẩn/xóa gợi ý khi di chuyển con trỏ trực tiếp (click chuột/tap hoặc dùng phím di chuyển)
            const handleCursorMove = (e) => {
                if (e.type === "keyup") {
                    const navigationKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
                    if (!navigationKeys.includes(e.key)) {
                        return;
                    }
                }
                this.clearSuggestion(shell);
            };
            input.addEventListener("click", handleCursorMove);
            input.addEventListener("keyup", handleCursorMove);

            // Lắng nghe phím Tab để hoàn thành gợi ý nhanh hoặc chọn tiên đoán đầu tiên
            input.addEventListener("keydown", (e) => {
                if (e.key === "Tab") {
                    if (this.autocompleteMatches && this.autocompleteMatches.length > 0) {
                        e.preventDefault();
                        this.applyAutocompleteTag(this.autocompleteMatches[0], this.currentWordBeingTyped, input, shell);
                    } else if (this.activeSuggestion) {
                        e.preventDefault();
                        this.acceptSuggestion(input, shell);
                    }
                }
            });

            // Ấn vào nơi bất kỳ trên thanh gợi ý cũng sẽ tự truyền vào input
            const ghost = shell.querySelector(".live-gen-prompt-ghost");
            if (ghost) {
                ghost.addEventListener("click", () => {
                    this.acceptSuggestion(input, shell);
                    input.focus();
                });
                ghost.addEventListener("mousedown", (e) => e.preventDefault());
            }

            navibar.showSearchBar(shell);
            this.autoGrow(input);
            
            // Tạo mobile nav buttons
            this.setupMobileNavButtons();
            
            // Xử lý focus/blur để hiển thị mobile nav buttons
            input.addEventListener("focus", () => {
                document.body.classList.add("live-gen-prompt-focused");
                this.updateMobileNavButtonsPosition();
            });
            input.addEventListener("blur", () => {
                document.body.classList.remove("live-gen-prompt-focused");
                setTimeout(() => {
                    if (document.activeElement !== input) {
                        this.clearSuggestion(shell);
                    }
                }, 150);
            });
            
            setTimeout(() => {
                this.autoGrow(input);
                input.focus({ preventScroll: true });
                input.setSelectionRange(input.value.length, input.value.length);
                this.updateMobileNavButtonsPosition();
            }, 0);
        }

        async triggerAutoPrompt(input, shell) {
            clearTimeout(this.suggestionTimer);
            this.fetchSuggestion(input, shell, input.value);
        }

        scheduleDynamicSuggestion(input, shell) {
            clearTimeout(this.suggestionTimer);
            const val = input.value;
            const trimmed = val.trim();

            const isLlmEnabled = this.state.config && this.state.config.llm_enabled === true;

            if (trimmed === "") {
                const delay = isLlmEnabled ? 1000 : 0;
                if (delay === 0) {
                    this.fetchSuggestion(input, shell, "");
                } else {
                    this.suggestionTimer = setTimeout(() => {
                        this.fetchSuggestion(input, shell, "");
                    }, delay);
                }
            } else if (val.endsWith(",")) {
                const delay = isLlmEnabled ? 500 : 0;
                if (delay === 0) {
                    this.fetchSuggestion(input, shell, val);
                } else {
                    this.suggestionTimer = setTimeout(() => {
                        this.fetchSuggestion(input, shell, val);
                    }, delay);
                }
            } else {
                this.fetchAutocompleteSuggestions(input, shell, val);
            }
        }

        fetchAutocompleteSuggestions(input, shell, val) {
            const cursor = input.selectionStart;
            const before = val.substring(0, cursor);
            const lastComma = before.lastIndexOf(',');
            const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
            const lastSep = Math.max(lastComma, lastNewline);
            const currentWord = before.substring(lastSep + 1).trim();

            if (currentWord.length < 1) {
                this.clearSuggestion(shell);
                return;
            }

            const search = currentWord.replace(/\s+/g, '_').toLowerCase();
            const tagPredictions = Array.isArray(this.component.tags) ? this.component.tags : [];
            
            const matches = tagPredictions
                .map(t => {
                    const tLower = t.toLowerCase();
                    let score = 0;
                    if (tLower === search) {
                        score = 4;
                    } else if (tLower.startsWith(search)) {
                        score = 3;
                    } else if (tLower.includes('_' + search) || tLower.includes('(' + search)) {
                        score = 2;
                    } else if (tLower.includes(search)) {
                        score = 1;
                    }
                    return { tag: t, score };
                })
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 12);

            if (matches.length > 0) {
                this.renderAutocompleteSuggestions(matches.map(m => m.tag), currentWord, input, shell);
            } else {
                this.clearSuggestion(shell);
            }
        }

        renderAutocompleteSuggestions(tags, currentWord, input, shell) {
            this._restoreTabBadge(shell);
            const ghost = shell.querySelector(".live-gen-prompt-ghost");
            const ghostSug = shell.querySelector(".ghost-suggestion");
            const tabBadge = shell.querySelector(".live-gen-suggestion-tab-badge");
            const characters = Array.isArray(this.component.characters) ? this.component.characters : [];

            this.activeSuggestion = "";
            this.autocompleteMatches = tags;
            this.currentWordBeingTyped = currentWord;

            if (ghostSug) {
                ghostSug.innerHTML = "";
                tags.forEach((tag, idx) => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "ghost-tag-btn";
                    
                    if (idx === 0) {
                        btn.classList.add("is-first-prediction");
                    }

                    const foundChar = characters.find(c => {
                        if (!c || !c.name) return false;
                        const cName = c.name.replace(/\s+/g, '_').toLowerCase();
                        const tagLower = tag.toLowerCase();
                        return cName === tagLower || cName.startsWith(tagLower) || tagLower.startsWith(cName);
                    });

                    if (foundChar) {
                        const imgUrl = `/image/${foundChar.hash}`;
                        btn.innerHTML = `
                            <span class="ghost-tag-avatar" style="width: 16px; height: 16px; border-radius: 50%; overflow: hidden; display: inline-flex; margin-right: 6px; border: 1px solid var(--color-border); vertical-align: middle;">
                                <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;">
                            </span>
                            <span style="vertical-align: middle;">${tag.replace(/_/g, ' ')}</span>
                        `;
                    } else {
                        btn.textContent = tag.replace(/_/g, ' ');
                    }

                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        this.applyAutocompleteTag(tag, currentWord, input, shell);
                    });
                    btn.addEventListener("mousedown", (e) => e.preventDefault());
                    ghostSug.appendChild(btn);
                });
            }
            if (tabBadge) tabBadge.style.display = "none";
            if (ghost) ghost.style.display = "flex";
        }

        applyAutocompleteTag(tag, currentWord, input, shell) {
            const textValue = input.value;
            const cursor = input.selectionStart;
            const before = textValue.substring(0, cursor);
            const after = textValue.substring(cursor);
            
            const lastComma = before.lastIndexOf(',');
            const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
            const lastSep = Math.max(lastComma, lastNewline);
            
            const nextComma = after.indexOf(',');
            const nextNewline = after.indexOf('\n');
            const nextCarriageReturn = after.indexOf('\r');
            const afterSepIndices = [nextComma, nextNewline, nextCarriageReturn].filter(idx => idx !== -1);
            const nextSep = afterSepIndices.length > 0 ? Math.min(...afterSepIndices) : -1;
            
            let prefix = textValue.substring(0, lastSep + 1);
            let suffix = nextSep !== -1 ? after.substring(nextSep) : "";
            
            if (prefix.endsWith(',')) {
                prefix += ' ';
            } else if (prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n') && !prefix.endsWith('\r')) {
                prefix += ' ';
            }
            
            if (suffix.startsWith(',')) {
                suffix = suffix.substring(1).replace(/^\s+/, '');
            }
            
            const insertedTag = tag.replace(/_/g, ' ');
            const result = `${prefix}${insertedTag}, ${suffix}`;
            
            input.value = result;
            const newCursor = prefix.length + insertedTag.length + 2;
            input.focus();
            input.setSelectionRange(newCursor, newCursor);
            
            this.clearSuggestion(shell);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async fetchSuggestion(input, shell, val) {
            if (input.value !== val) return;
            this._restoreTabBadge(shell);
            
            const ghost = shell.querySelector(".live-gen-prompt-ghost");
            const ghostSug = shell.querySelector(".ghost-suggestion");
            const tabBadge = shell.querySelector(".live-gen-suggestion-tab-badge");

            if (ghost) {
                ghost.style.display = "flex";
                document.body.classList.add("has-active-suggestion");
            }
            if (ghostSug) {
                ghostSug.innerHTML = `
                    <div class="live-gen-suggestion-dots">
                        <span></span><span></span><span></span>
                    </div>
                `;
            }
            if (tabBadge) tabBadge.style.display = "none";

            if (this.state.config && this.state.config.llm_enabled === true) {
                try {
                    const resp = await this.component.apiClient.pluginApi.post("/llm/generate", { prompt: val });
                    if (resp && resp.status === "success" && resp.text && input.value === val) {
                        this.renderSuggestions(resp.text, input, shell);
                    } else {
                        this.fetchOfflineSuggestion(input, shell, val);
                    }
                } catch (err) {
                    console.warn("[LiveGen Sug] Bỏ qua lỗi fetch gợi ý ngầm, dùng fallback offline:", err);
                    this.fetchOfflineSuggestion(input, shell, val);
                }
            } else {
                this.fetchOfflineSuggestion(input, shell, val);
            }
        }

        renderSuggestions(text, input, shell) {
            const ghost = shell.querySelector(".live-gen-prompt-ghost");
            const ghostSug = shell.querySelector(".ghost-suggestion");
            const tabBadge = shell.querySelector(".live-gen-suggestion-tab-badge");

            this.activeSuggestion = text;
            this.autocompleteMatches = null;
            this.currentWordBeingTyped = "";
            
            if (ghostSug) {
                ghostSug.innerHTML = "";
                const tags = text.split(",").map(t => t.trim()).filter(Boolean);
                tags.forEach(tag => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "ghost-tag-btn";
                    btn.textContent = tag;
                    btn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        this.acceptSingleTagSuggestion(tag, input, shell);
                        btn.remove();
                        
                        const updatedTags = this.activeSuggestion.split(",").map(t => t.trim()).filter(t => t !== tag && t !== "");
                        this.activeSuggestion = updatedTags.join(", ");
                        if (updatedTags.length === 0) {
                            this.clearSuggestion(shell);
                        }
                        
                        input.focus();
                    });
                    btn.addEventListener("mousedown", (e) => e.preventDefault());
                    ghostSug.appendChild(btn);
                });
                if (tabBadge) {
                    ghostSug.appendChild(tabBadge);
                    tabBadge.style.display = "inline-block";
                }
            }
            if (ghost) ghost.style.display = "flex";
        }

        fetchOfflineSuggestion(input, shell, val) {
            const trimmedVal = val.trim();
            const inputTags = trimmedVal
                .split(",")
                .map(t => t.trim().toLowerCase().replace(/\s+/g, "_"))
                .filter(Boolean);

            const databaseTags = Array.isArray(this.component.tags) ? this.component.tags : [];
            const themeAssociations = {
                "1girl": ["solo", "looking_at_viewer", "smile", "long_hair", "blush", "sitting", "standing"],
                "1boy": ["solo", "looking_at_viewer", "short_hair", "standing", "smile"],
                "solo": ["looking_at_viewer", "smile", "sitting", "standing"],
                "school_uniform": ["pleated_skirt", "necktie", "ribbon", "sailor_collar", "blazer", "high_socks"],
                "outdoors": ["sky", "clouds", "sunlight", "day", "blue_sky", "scenic", "trees", "grass"],
                "indoors": ["classroom", "room", "window", "curtains", "chair", "table"],
                "swimsuit": ["bikini", "beach", "water", "sea", "waves", "sunlight", "wet"],
                "night": ["night_sky", "stars", "moon", "dark", "cityscape", "street_lights"],
                "sitting": ["on_chair", "on_bed", "on_ground", "kneeling", "crossed_legs"],
                "holding": ["holding_phone", "holding_cup", "holding_book", "holding_bag"],
                "blush": ["embarrassed", "shy", "smile", "shy_smile", "blushing"],
                "masterpiece": ["best_quality", "highres", "highly_detailed", "amazing_quality"],
                "best_quality": ["masterpiece", "highres", "highly_detailed", "amazing_quality"],
                "scenery": ["landscape", "outdoors", "sky", "scenic", "nature", "trees"]
            };

            const suggestedSet = new Set();

            if (inputTags.length === 0) {
                const baseDefaults = ["1girl", "solo", "masterpiece", "best_quality", "highres", "highly_detailed", "looking_at_viewer"];
                baseDefaults.forEach(t => suggestedSet.add(t));
            } else {
                inputTags.forEach(inTag => {
                    const normalized = inTag.toLowerCase();
                    if (themeAssociations[normalized]) {
                        themeAssociations[normalized].forEach(assoc => suggestedSet.add(assoc));
                    }
                    Object.keys(themeAssociations).forEach(key => {
                        if (key !== normalized && (key.includes(normalized) || normalized.includes(key))) {
                            themeAssociations[key].forEach(assoc => suggestedSet.add(assoc));
                        }
                    });
                });

                const tokens = [];
                inputTags.forEach(t => {
                    t.split("_").forEach(token => {
                        if (token.length > 2) tokens.push(token);
                    });
                });

                if (tokens.length > 0) {
                    const prefixMatches = databaseTags
                        .filter(dbTag => {
                            const dbTagLower = dbTag.toLowerCase();
                            if (inputTags.includes(dbTagLower)) return false;
                            return tokens.some(token => dbTagLower.includes(token));
                        })
                        .slice(0, 100);

                    const scoredMatches = prefixMatches.map(dbTag => {
                        const dbTagLower = dbTag.toLowerCase();
                        let score = 0;
                        tokens.forEach(token => {
                            if (dbTagLower === token) score += 10;
                            else if (dbTagLower.startsWith(token)) score += 5;
                            else if (dbTagLower.includes(token)) score += 2;
                        });
                        score -= dbTagLower.length * 0.05;
                        return { tag: dbTag, score };
                    });

                    scoredMatches.sort((a, b) => b.score - a.score);
                    scoredMatches.slice(0, 10).forEach(item => {
                        suggestedSet.add(item.tag);
                    });
                }
            }

            if (suggestedSet.size < 8 && databaseTags.length > 0) {
                for (let i = 0; i < Math.min(databaseTags.length, 50); i++) {
                    if (suggestedSet.size >= 12) break;
                    const dbTag = databaseTags[i];
                    if (dbTag) suggestedSet.add(dbTag);
                }
            }

            const finalSuggestions = Array.from(suggestedSet)
                .map(t => t.replace(/_/g, " "))
                .filter(t => {
                    const normalized = t.toLowerCase().replace(/\s+/g, "_");
                    return !inputTags.includes(normalized);
                })
                .slice(0, 12);

            if (finalSuggestions.length > 0) {
                const textResult = finalSuggestions.join(", ");
                this.renderSuggestions(textResult, input, shell);
            } else {
                this.clearSuggestion(shell);
            }
        }

        clearSuggestion(shell) {
            this._restoreTabBadge(shell);
            this.activeSuggestion = "";
            this.autocompleteMatches = null;
            this.currentWordBeingTyped = "";
            clearTimeout(this.suggestionTimer);
            
            document.body.classList.remove("has-active-suggestion");

            const ghost = shell.querySelector(".live-gen-prompt-ghost");
            const ghostSug = shell.querySelector(".ghost-suggestion");
            const tabBadge = shell.querySelector(".live-gen-suggestion-tab-badge");

            if (ghost) ghost.style.display = "none";
            if (ghostSug) {
                ghostSug.innerHTML = "";
            }
            if (tabBadge) tabBadge.style.display = "none";
        }

        acceptSuggestion(input, shell) {
            if (!this.activeSuggestion) return;
            
            let currentText = input.value;
            let sugText = this.activeSuggestion;
            
            // Xử lý loại bỏ dấu phẩy trùng lặp tại vị trí nối
            if (currentText.trim().endsWith(",") && sugText.trim().startsWith(",")) {
                sugText = sugText.trim().substring(1).trim();
                // Đảm bảo có đúng một khoảng trắng sau dấu phẩy của prompt hiện tại
                if (!currentText.endsWith(", ")) {
                    currentText = currentText.trim() + " ";
                }
            } else if (currentText.trim() && !currentText.trim().endsWith(",") && !sugText.trim().startsWith(",")) {
                sugText = ", " + sugText;
            }
            
            const fullText = currentText + sugText;
            input.value = fullText;
            this.state.setPrompt(fullText);
            this.autoGrow(input);

            // Suggestion accepted, clear suggestion panel
            this.clearSuggestion(shell);

            this.component.lastGeneratedPrompt = "";
            this.component._scheduleGeneration(15);
        }

        acceptSingleTagSuggestion(tag, input, shell) {
            let currentText = input.value;
            let sugText = tag.trim();
            
            if (currentText.trim().endsWith(",")) {
                if (!currentText.endsWith(", ")) {
                    currentText = currentText.trim() + " ";
                }
            } else if (currentText.trim() !== "") {
                sugText = ", " + sugText;
            }
            
            const fullText = currentText + sugText;
            input.value = fullText;
            this.state.setPrompt(fullText);
            this.autoGrow(input);

            this.component.lastGeneratedPrompt = "";
            this.component._scheduleGeneration(15);
        }

        attachAutocomplete(input) {
            // Tiên đoán đã được tích hợp hoàn hảo trực tiếp vào Ghost Suggestions bar
        }

        autoGrow(input) {
            if (!input) return;
            input.style.height = "auto";
            const currentHeight = input.scrollHeight;
            const spill = currentHeight > 150;
            input.style.height = `${Math.min(currentHeight, 150)}px`;
            input.style.overflowY = spill ? "auto" : "hidden";

            const shell = input.closest(".live-gen-prompt-shell");
            if (shell) {
                shell.classList.toggle("is-multiline", currentHeight > 40);
                
                // Suggestion is a separate floating panel, no inline height sync needed
            }
            
            // Cập nhật vị trí mobile nav buttons theo chiều cao của prompt shell
            this.updateMobileNavButtonsPosition();
        }

        updateMobileNavButtonsPosition() {
            // Nút hành động di động hiện được định vị chính xác bằng CSS (bottom: 100%)
            // để tự động điều chỉnh theo chiều cao co giãn của `#navibar-tray`
        }

        setupMobileNavButtons() {
            this.removeMobileNavButtons();
            
            const container = document.createElement("div");
            container.className = "live-gen-mobile-nav-buttons";
            container.id = "live-gen-mobile-nav-buttons";
            
            const keepBtn = document.createElement("button");
            keepBtn.className = "live-gen-mobile-nav-btn";
            keepBtn.dataset.action = "keep";
            keepBtn.innerHTML = `
                <span class="material-symbols-outlined">keep</span>
                <span>Keep</span>
            `;
            keepBtn.addEventListener("mousedown", (e) => e.preventDefault());
            keepBtn.addEventListener("click", () => this.component._toggleKeep());
            
            const hiresBtn = document.createElement("button");
            hiresBtn.className = "live-gen-mobile-nav-btn";
            hiresBtn.dataset.action = "hires";
            hiresBtn.innerHTML = `
                <span class="material-symbols-outlined">hd</span>
                <span>Hires</span>
            `;
            hiresBtn.addEventListener("mousedown", (e) => e.preventDefault());
            hiresBtn.addEventListener("click", () => this.component._toggleHires());
            
            const settingsBtn = document.createElement("button");
            settingsBtn.className = "live-gen-mobile-nav-btn";
            settingsBtn.dataset.action = "settings";
            settingsBtn.innerHTML = `
                <span class="material-symbols-outlined">settings</span>
                <span>Settings</span>
            `;
            settingsBtn.addEventListener("mousedown", (e) => e.preventDefault());
            settingsBtn.addEventListener("click", () => this.component._openSettings());
            
            const timelineBtn = document.createElement("button");
            timelineBtn.className = "live-gen-mobile-nav-btn";
            timelineBtn.dataset.action = "timeline";
            timelineBtn.innerHTML = `
                <span class="material-symbols-outlined">history</span>
                <span>History</span>
            `;
            timelineBtn.addEventListener("mousedown", (e) => e.preventDefault());
            timelineBtn.addEventListener("click", () => this.component._openTimeline());
            
            container.appendChild(keepBtn);
            container.appendChild(hiresBtn);
            container.appendChild(settingsBtn);
            container.appendChild(timelineBtn);
            
            const tray = document.getElementById("navibar-tray");
            if (tray) {
                tray.appendChild(container);
            } else {
                document.body.appendChild(container);
            }
            this.component._syncMobileNavButtonStates();
        }

        removeMobileNavButtons() {
            const existing = document.getElementById("live-gen-mobile-nav-buttons");
            if (existing) {
                existing.remove();
            }
        }
    }

    window.Yuuka.liveGen.PromptUI = LiveGenPromptUI;
})();
