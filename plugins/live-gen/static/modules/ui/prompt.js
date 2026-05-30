(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const Autocomplete = window.Yuuka.liveGen.Autocomplete;

    class LiveGenPromptUI {
        constructor(component) {
            this.component = component;
            this.state = component.state;
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
                <div class="live-gen-prompt-field">
                    <textarea class="live-gen-prompt-input" rows="1" placeholder="Nhập prompt..."></textarea>
                </div>
                <div class="live-gen-prompt-actions-wrapper">
                    <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="dice" title="Đổi seed ngẫu nhiên (Reroll Seed)">
                        <span class="material-symbols-outlined">casino</span>
                    </button>
                    <button type="button" class="nav-btn nav-btn--minimal live-gen-prompt-action" data-action="refine" title="Tinh chỉnh ảnh (+10 steps)">
                        <span class="material-symbols-outlined">auto_awesome</span>
                    </button>
                </div>
            `;

            const input = shell.querySelector(".live-gen-prompt-input");
            input.value = this.state.prompt;
            this.attachAutocomplete(input);
            this.autoGrow(input);

            shell.querySelector('[data-action="back"]').addEventListener("click", () => navibar.showSearchBar(null));
            
            const diceBtn = shell.querySelector('[data-action="dice"]');
            diceBtn.addEventListener("click", async () => {
                const newSeed = Math.floor(Math.random() * 1000000000);
                try {
                    const saved = await this.component.apiClient.saveConfig({ seed: newSeed });
                    this.component._applyConfig(saved.config);
                    this.component.wsClient.send({ type: "update_config", config: saved.config });
                    // Sync seed input in settings panel if open
                    const seedInput = document.querySelector('.live-gen-settings-panel [data-role="seed"]');
                    if (seedInput) seedInput.value = String(newSeed);
                    this.component.lastGeneratedPrompt = "";
                    this.component._scheduleGeneration(15);
                    window.showSuccess?.(`Đã đổi ngẫu nhiên seed mới: ${newSeed}`);
                } catch (err) {
                    window.showError?.(`Không thể lưu seed mới: ${err.message}`);
                }
            });
            diceBtn.addEventListener("mousedown", (e) => e.preventDefault());

            const refineBtn = shell.querySelector('[data-action="refine"]');
            refineBtn.addEventListener("click", () => this.component._runRefine());
            refineBtn.addEventListener("mousedown", (e) => e.preventDefault());

            input.addEventListener("input", () => {
                this.state.setPrompt(input.value);
                this.autoGrow(input);
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
            });
            
            setTimeout(() => {
                this.autoGrow(input);
                input.focus({ preventScroll: true });
                input.setSelectionRange(input.value.length, input.value.length);
                this.updateMobileNavButtonsPosition();
            }, 0);
        }

        attachAutocomplete(input) {
            Autocomplete.attachAutocomplete(input, this.component.tags, this.component.characters);
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
