/**
 * Frontend entry point for the World plugin.
 */

class WorldComponent {
    constructor(container, api, plugins) {
        this._container = container;
        this._api = api;
        this._plugins = plugins || [];
        this._renderer = null;
        this._currentWorld = null;
        this._pollingInterval = null;
        this._lastState = null;
        this._resizeObserver = null;
        this._speedOptions = [1, 2, 3, 4, 5, 10, 20, 50, 100];
        this._lastNpcListRenderMs = 0;
    }

    async init() {
        this._buildUI();
        await this._initWorld();
    }

    destroy() {
        if (this._pollingInterval) {
            clearInterval(this._pollingInterval);
            this._pollingInterval = null;
        }
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._renderer) {
            this._renderer.destroy();
        }
        this._renderer = null;
    }

    _buildUI() {
        this._container.innerHTML = `
<div id="world-root">
  <div id="world-map-area">
    <canvas id="world-canvas"></canvas>
    <div id="world-time-display">Day 1, 00:00 | Tick: 0</div>
    <div id="world-controls">
      <button id="world-btn-pause">Pause</button>
      <button id="world-btn-resume">Resume</button>
      <button id="world-btn-reset">Reset</button>
      <select id="world-speed-select">${this._speedOptions
          .map((speed) => `<option value="${speed}">x${speed}</option>`)
          .join("")}</select>
      <button id="world-btn-config-toggle">Config</button>
    </div>
  </div>
  <div id="world-sidebar">
    <div id="world-npc-list"></div>
  </div>
  <div id="world-config-panel" style="display:none">
    <h3>World Config</h3>
    <div class="world-config-field">
      <label>NPC Count (1-500)</label>
      <input type="number" id="wcfg-npcCount" min="1" max="500" value="50">
    </div>
    <div class="world-config-field">
      <label>Main Roads (1.0-5.0)</label>
      <input type="number" id="wcfg-mainRoadCount" min="1" max="5" step="0.1" value="2">
    </div>
    <div class="world-config-field">
      <label>Sub Roads (0-50)</label>
      <input type="number" id="wcfg-subRoadCount" min="0" max="50" step="1" value="8">
    </div>
    <div class="world-config-field">
      <label>Personality</label>
      <select id="wcfg-personality">
        <option value="Balanced">Balanced</option>
        <option value="Introverted">Introverted</option>
        <option value="Extroverted">Extroverted</option>
      </select>
    </div>
    <div class="world-config-field">
      <label>Building Density</label>
      <select id="wcfg-buildingDensity">
        <option value="Scattered">Scattered</option>
        <option value="Uniform">Uniform</option>
        <option value="Concentrated">Concentrated</option>
      </select>
    </div>
    <div class="world-config-field">
      <label>Road Skew: <span id="wcfg-roadSkew-val">0.00</span></label>
      <input type="range" id="wcfg-roadSkew" min="0" max="1" step="0.01" value="0">
    </div>
    <div class="world-config-field">
      <label>Road Curve: <span id="wcfg-roadCurve-val">0</span></label>
      <input type="range" id="wcfg-roadCurve" min="0" max="5" step="1" value="0">
    </div>
    <div class="world-config-field">
      <label>Seed (optional)</label>
      <input type="number" id="wcfg-seed" step="1" placeholder="Leave blank for random">
    </div>
    <div class="world-config-field">
      <label>Tick Interval ms (100-60000)</label>
      <input type="number" id="wcfg-tickInterval" min="100" max="60000" value="250">
    </div>
    <div class="world-config-actions">
      <button id="world-btn-config-save">Save</button>
      <button id="world-btn-config-generate">Generate New World</button>
    </div>
  </div>
  <div id="world-popup" style="display:none"></div>
</div>`;

        this._bindControls();
        this._bindConfigPanel();
        this._sizeCanvas();
        this._watchCanvasResize();
    }

    _sizeCanvas() {
        const canvas = document.getElementById("world-canvas");
        const area = document.getElementById("world-map-area");
        if (!canvas || !area) return;
        const rect = area.getBoundingClientRect();
        const width = Math.floor(rect.width) || 800;
        const height = Math.floor(rect.height) || 600;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";

        if (this._renderer) {
            this._renderer.resize(width, height);
        } else {
            canvas.width = width;
            canvas.height = height;
        }
    }

    _watchCanvasResize() {
        const area = document.getElementById("world-map-area");
        if (!area || !window.ResizeObserver) return;
        this._resizeObserver = new ResizeObserver(() => this._sizeCanvas());
        this._resizeObserver.observe(area);
    }

    async _initWorld() {
        try {
            const config = await fetch("/api/plugin/world/config").then((res) => res.json());
            this._applyConfigToForm(config);

            const state = await fetch("/api/plugin/world/state").then((res) => res.json());
            this._lastState = state;
            if (state.map) {
                this._currentWorld = state.map;
                this._initRenderer(state);
            }
        } catch (error) {
            // Keep the UI usable even if the backend has not initialized yet.
        }

        this._startPolling();
    }

    _initRenderer(state) {
        const canvas = document.getElementById("world-canvas");
        if (!canvas) return;
        this._sizeCanvas();

        if (this._renderer) this._renderer.destroy();

        this._renderer = new MapRenderer(canvas, state.map);
        this._renderer.onNpcClick((id) => this._showNpcPopup(id));
        this._renderer.onLocationClick((id) => this._showLocationPopup(id));

        const npcList = Object.values(state.npcs || {});
        this._renderer.render(npcList, {
            simulationSpeed: state.simulation_speed,
            serverTimeMs: state.server_time_ms,
            worldTimeSeconds: state.world_time_seconds,
        });
        this._updateNpcList(npcList, state.map.locations);
        this._updateTimeDisplay(state);
        this._applySpeedToControl(state.simulation_speed);
    }

    _startPolling() {
        if (this._pollingInterval) clearInterval(this._pollingInterval);
        this._pollingInterval = setInterval(async () => {
            try {
                if (!this._renderer) {
                    const state = await fetch("/api/plugin/world/state").then((res) => res.json());
                    if (!state.map) return;
                    this._lastState = state;
                    this._currentWorld = state.map;
                    this._initRenderer(state);
                    return;
                }

                const live = await fetch("/api/plugin/world/live_state").then((res) => res.json());
                this._lastState = {
                    ...(this._lastState || {}),
                    ...live,
                    map: this._currentWorld,
                };

                const npcList = Object.values(live.npcs || {});
                this._renderer.render(npcList, {
                    simulationSpeed: live.simulation_speed,
                    serverTimeMs: live.server_time_ms,
                    worldTimeSeconds: live.world_time_seconds,
                });
                const now = performance.now();
                if (now - this._lastNpcListRenderMs >= 1000) {
                    this._updateNpcList(npcList, this._currentWorld?.locations);
                    this._lastNpcListRenderMs = now;
                }
                this._updateTimeDisplay(live);
                this._applySpeedToControl(live.simulation_speed);

                // Live-update the open status popup
                if (this._openPopupNpcIds && this._openPopupNpcIds.length > 0) {
                    this._renderStatusPopup();
                }
            } catch (error) {
                // Ignore transient polling errors.
            }
        }, 500);
    }

    _updateTimeDisplay(state) {
        const el = document.getElementById("world-time-display");
        if (el) {
            const speed = Number(state.simulation_speed || 1);
            el.textContent = `${state.world_time} | Tick: ${state.tick_count} | x${speed}`;
        }
    }

    _updateNpcList(npcs, locations) {
        const el = document.getElementById("world-npc-list");
        if (!el) return;

        const locMap = {};
        (locations || []).forEach((loc) => {
            locMap[loc.id] = loc;
        });

        el.innerHTML = npcs
            .map((npc) => {
                const movement = npc.movement || {};
                const moving = !!movement.active;
                const loc = locMap[moving ? movement.target_location : npc.current_location] || {};
                const status = moving ? movement.mode : npc.activity;
                const thumb = npc.character_hash
                    ? `<img class="npc-thumb" src="/image/${npc.character_hash}" alt="" loading="lazy">`
                    : `<span class="npc-thumb npc-thumb-placeholder"></span>`;
                return `<div class="world-npc-item" data-npc-id="${npc.id}">
                ${thumb}
                <span class="npc-name">${npc.name}</span>
                <span class="npc-activity">${status}</span>
                <span class="npc-location">${loc.type || "?"}</span>
            </div>`;
            })
            .join("");

        el.querySelectorAll(".world-npc-item").forEach((item) => {
            item.addEventListener("click", () => {
                this._showNpcPopup(parseInt(item.dataset.npcId, 10));
            });
        });
    }

    _showNpcPopup(npcId) {
        if (!this._lastState) return;

        const npc = (this._lastState.npcs || {})[String(npcId)];
        if (!npc) return;

        // Check if NPC is in a social pair
        const partnerId = npc.social_pair?.partner_id;
        const partner = partnerId != null
            ? (this._lastState.npcs || {})[String(partnerId)]
            : null;

        if (partner) {
            this._openPopupNpcIds = [npcId, partnerId];
        } else {
            this._openPopupNpcIds = [npcId];
        }
        this._statusActiveTab = 0;
        this._renderStatusPopup();
    }

    _renderStatusPopup() {
        if (!this._openPopupNpcIds || this._openPopupNpcIds.length === 0) return;
        if (!this._lastState) return;

        const popup = document.getElementById("world-popup");
        if (!popup) return;

        const allNpcs = this._lastState.npcs || {};
        const npcs = this._openPopupNpcIds
            .map((id) => allNpcs[String(id)])
            .filter(Boolean);

        if (npcs.length === 0) {
            this._closePopup();
            return;
        }

        const isPair = npcs.length === 2;
        const activeTab = this._statusActiveTab || 0;

        // Build tab bar for pairs
        let tabsHtml = "";
        if (isPair) {
            const tabThumb = (n) => n.character_hash
                ? `<img class="status-tab-thumb" src="/image/${n.character_hash}" alt="">`
                : `<span class="status-tab-thumb status-tab-thumb-ph"></span>`;

            tabsHtml = `<div class="status-tabs">
                <button class="status-tab ${activeTab === 0 ? "active" : ""}" data-idx="0">
                    ${tabThumb(npcs[0])} ${npcs[0].name}
                </button>
                <button class="status-tab ${activeTab === 1 ? "active" : ""}" data-idx="1">
                    ${tabThumb(npcs[1])} ${npcs[1].name}
                </button>
            </div>`;
        }

        // Build panels
        const panelsHtml = npcs.map((npc, idx) =>
            `<div class="status-panel ${isPair && idx === activeTab ? "active" : ""}" data-tab-idx="${idx}">
                ${this._buildNpcStatusHtml(npc)}
            </div>`
        ).join("");

        const isFirstOpen = popup.style.display !== "block";

        popup.innerHTML = `
            <div class="status-container ${isPair ? "status-pair" : ""} ${isFirstOpen ? "status-animate" : ""}">
                <button class="world-popup-close" id="world-popup-close">✕</button>
                ${tabsHtml}
                <div class="status-panels">
                    ${panelsHtml}
                </div>
            </div>`;

        popup.style.display = "block";

        // Bind close
        document.getElementById("world-popup-close")
            ?.addEventListener("click", () => this._closePopup());

        // Bind tabs
        popup.querySelectorAll(".status-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                this._statusActiveTab = parseInt(tab.dataset.idx, 10);
                this._renderStatusPopup();
            });
        });

        // Bind chat buttons
        popup.querySelectorAll(".world-btn-chat").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = parseInt(btn.dataset.npcId, 10);
                const npc = allNpcs[String(id)];
                if (npc) this._openChatWithNpc(npc);
            });
        });
    }

    _buildNpcStatusHtml(npc) {
        const locMap = {};
        ((this._lastState.map && this._lastState.map.locations) || []).forEach((loc) => {
            locMap[loc.id] = loc;
        });
        const movement = npc.movement || {};
        const moving = !!movement.active;
        const loc = locMap[moving ? movement.target_location : npc.current_location] || {};
        const homeLoc = locMap[npc.home_location] || {};

        const needs = npc.needs || {};
        const hunger = ((needs.hunger || 0) * 100).toFixed(0);
        const social = ((needs.social || 0) * 100).toFixed(0);
        const rest   = ((needs.rest   || 0) * 100).toFixed(0);
        const work   = ((needs.work   || 0) * 100).toFixed(0);

        const energy = ((npc.energy || 0) * 100).toFixed(0);
        const money  = (npc.money || 0).toFixed(1);

        const prefs = npc.preferences || {};
        const quietPct  = ((prefs.quiet   || 0) * 100).toFixed(0);
        const crowdPct  = ((prefs.crowded || 0) * 100).toFixed(0);

        const zodiacSigns = [
            {name: "Aries", emoji: "♈"}, {name: "Taurus", emoji: "♉"}, {name: "Gemini", emoji: "♊"},
            {name: "Cancer", emoji: "♋"}, {name: "Leo", emoji: "♌"}, {name: "Virgo", emoji: "♍"},
            {name: "Libra", emoji: "♎"}, {name: "Scorpio", emoji: "♏"}, {name: "Sagittarius", emoji: "♐"},
            {name: "Capricorn", emoji: "♑"}, {name: "Aquarius", emoji: "♒"}, {name: "Pisces", emoji: "♓"}
        ];

        const zodiacObj = zodiacSigns[npc.zodiac_index || 0];
        const zodiacStr = `${zodiacObj.emoji} ${zodiacObj.name}`;
        const bdayStr = npc.birthday || "1/1";

        // ─── Relationships: only show Kẻ thù, Bạn thân nhất, Người yêu ───
        const allNpcs = this._lastState.npcs || {};
        const relationships = Object.entries(npc.relationships || {});

        const enemies = relationships
            .filter(([, score]) => score <= 0.1)
            .sort((a, b) => a[1] - b[1]);

        const bestFriendCandidates = relationships
            .filter(([, score]) => score > 0.65 && score <= 0.85)
            .sort((a, b) => b[1] - a[1]);
        const bestFriend = bestFriendCandidates.length > 0 ? bestFriendCandidates[0] : null;

        const loverCandidates = relationships
            .filter(([, score]) => score > 0.85)
            .sort((a, b) => b[1] - a[1]);
        const lover = loverCandidates.length > 0 ? loverCandidates[0] : null;

        const _relName = (id) => allNpcs[id]?.name || `NPC ${id}`;
        const _relThumb = (id) => {
            const hash = allNpcs[id]?.character_hash;
            return hash
                ? `<img class="status-rel-thumb" src="/image/${hash}" alt="">`
                : `<span class="status-rel-thumb status-rel-thumb-placeholder"></span>`;
        };

        let relHtml = "";
        if (enemies.length > 0) {
            relHtml += `<div class="status-rel-group">
                <div class="status-rel-label" style="color:#ff4444">⚔️ Kẻ thù</div>`;
            for (const [eid, escore] of enemies) {
                relHtml += `<div class="status-rel-entry">
                    ${_relThumb(eid)}
                    <span class="status-rel-name">${_relName(eid)}</span>
                    <span class="status-rel-score" style="color:#ff4444">${Math.round(escore * 100)}%</span>
                </div>`;
            }
            relHtml += `</div>`;
        }
        if (bestFriend) {
            relHtml += `<div class="status-rel-group">
                <div class="status-rel-label" style="color:#44cc88">⭐ Bạn thân nhất</div>
                <div class="status-rel-entry">
                    ${_relThumb(bestFriend[0])}
                    <span class="status-rel-name">${_relName(bestFriend[0])}</span>
                    <span class="status-rel-score" style="color:#44cc88">${Math.round(bestFriend[1] * 100)}%</span>
                </div>
            </div>`;
        }
        if (lover) {
            relHtml += `<div class="status-rel-group">
                <div class="status-rel-label" style="color:#ff88ff">💕 Người yêu</div>
                <div class="status-rel-entry">
                    ${_relThumb(lover[0])}
                    <span class="status-rel-name">${_relName(lover[0])}</span>
                    <span class="status-rel-score" style="color:#ff88ff">${Math.round(lover[1] * 100)}%</span>
                </div>
            </div>`;
        }
        if (!relHtml) {
            relHtml = `<p class="status-rel-empty">Chưa có mối quan hệ đặc biệt</p>`;
        }

        const locationStr = moving
            ? `🚶 Đang di chuyển → ${loc.type || "?"}`
            : `📍 ${loc.type || "?"} (id: ${npc.current_location})`;

        const activityIcons = {
            eat: "🍽️", sleep: "💤", socialize: "💬", relax: "☕",
            study: "📖", work: "💼", walk: "🚶", run: "🏃",
            idle: "⏸️", wander: "🔄"
        };
        const activityName = moving ? movement.mode : npc.activity;
        const activityIcon = activityIcons[activityName] || "❓";

        const thumbHtml = npc.character_hash
            ? `<img class="status-avatar" src="/image/${npc.character_hash}" alt="${npc.name}">`
            : `<div class="status-avatar status-avatar-placeholder"></div>`;

        return `
            <!-- Header -->
            <div class="status-header">
                ${thumbHtml}
                <div class="status-header-info">
                    <h4 class="status-name">${npc.name}</h4>
                    <div class="status-zodiac">${zodiacStr} · ${bdayStr}</div>
                    <div class="status-activity">${activityIcon} ${activityName}</div>
                </div>
            </div>

            <!-- Location & Money row -->
            <div class="status-info-row">
                <div class="status-info-chip">
                    <span class="status-chip-label">Vị trí</span>
                    <span class="status-chip-value">${locationStr}</span>
                </div>
                <div class="status-info-chip">
                    <span class="status-chip-label">Nhà</span>
                    <span class="status-chip-value">🏠 ${homeLoc.type || "?"}</span>
                </div>
            </div>
            <div class="status-info-row">
                <div class="status-info-chip">
                    <span class="status-chip-label">Tiền</span>
                    <span class="status-chip-value">💰 ${money}</span>
                </div>
                <div class="status-info-chip">
                    <span class="status-chip-label">Năng lượng</span>
                    <span class="status-chip-value">⚡ ${energy}%</span>
                </div>
            </div>

            <!-- Needs section -->
            <div class="status-section">
                <div class="status-section-title">📊 Nhu cầu</div>
                <div class="status-needs">
                    <div class="status-need-bar">
                        <span class="status-need-icon">🍖</span>
                        <span class="status-need-label">Đói</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-hunger" style="width:${hunger}%"></div></div>
                        <span class="status-need-pct">${hunger}%</span>
                    </div>
                    <div class="status-need-bar">
                        <span class="status-need-icon">💬</span>
                        <span class="status-need-label">Xã hội</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-social" style="width:${social}%"></div></div>
                        <span class="status-need-pct">${social}%</span>
                    </div>
                    <div class="status-need-bar">
                        <span class="status-need-icon">😴</span>
                        <span class="status-need-label">Nghỉ</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-rest" style="width:${rest}%"></div></div>
                        <span class="status-need-pct">${rest}%</span>
                    </div>
                    <div class="status-need-bar">
                        <span class="status-need-icon">💼</span>
                        <span class="status-need-label">Việc</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-work" style="width:${work}%"></div></div>
                        <span class="status-need-pct">${work}%</span>
                    </div>
                </div>
            </div>

            <!-- Preferences section -->
            <div class="status-section">
                <div class="status-section-title">🎭 Tính cách</div>
                <div class="status-prefs">
                    <div class="status-pref">
                        <span>🤫 Yên tĩnh</span>
                        <div class="status-pref-bar"><div class="status-pref-fill" style="width:${quietPct}%"></div></div>
                        <span>${quietPct}%</span>
                    </div>
                    <div class="status-pref">
                        <span>🎉 Đông đúc</span>
                        <div class="status-pref-bar"><div class="status-pref-fill" style="width:${crowdPct}%"></div></div>
                        <span>${crowdPct}%</span>
                    </div>
                </div>
            </div>

            <!-- Relationships section -->
            <div class="status-section">
                <div class="status-section-title">❤️ Mối quan hệ</div>
                <div class="status-relationships">
                    ${relHtml}
                </div>
            </div>

            <button class="world-btn-chat" data-npc-id="${npc.id}">💬 Trò chuyện</button>`;
    }

    _openChatWithNpc() {
        const chatPlugin = this._plugins.find((plugin) => plugin.id === "chat");
        if (!chatPlugin) {
            showError("Chat plugin is not available.");
            return;
        }
        Yuuka.ui.switchTab("chat");
    }

    _showLocationPopup(locationId) {
        this._openPopupNpcIds = null;
        if (!this._lastState || !this._lastState.map) return;

        const loc = (this._lastState.map.locations || []).find((item) => item.id === locationId);
        if (!loc) return;

        const popup = document.getElementById("world-popup");
        if (!popup) return;

        popup.innerHTML = `
            <div class="world-popup-inner">
                <button class="world-popup-close" id="world-popup-close">x</button>
                <h4>${loc.type}</h4>
                <p><strong>Type:</strong> ${loc.type}</p>
                <p><strong>Capacity:</strong> ${loc.capacity}</p>
                <p><strong>Occupants:</strong> ${loc.occupants}</p>
            </div>`;

        popup.style.display = "block";
        document.getElementById("world-popup-close").addEventListener("click", () => this._closePopup());
    }

    _closePopup() {
        const popup = document.getElementById("world-popup");
        if (popup) popup.style.display = "none";
        this._openPopupNpcIds = null;
    }

    _bindConfigPanel() {
        const skewInput = document.getElementById("wcfg-roadSkew");
        const skewLabel = document.getElementById("wcfg-roadSkew-val");
        if (skewInput && skewLabel) {
            skewInput.addEventListener("input", () => {
                skewLabel.textContent = parseFloat(skewInput.value).toFixed(2);
            });
        }

        const curveInput = document.getElementById("wcfg-roadCurve");
        const curveLabel = document.getElementById("wcfg-roadCurve-val");
        if (curveInput && curveLabel) {
            curveInput.addEventListener("input", () => {
                curveLabel.textContent = parseInt(curveInput.value, 10);
            });
        }

        const btnSave = document.getElementById("world-btn-config-save");
        if (btnSave) btnSave.addEventListener("click", () => this._saveConfig());

        const btnGen = document.getElementById("world-btn-config-generate");
        if (btnGen) btnGen.addEventListener("click", () => this._generateWorld());
    }

    _readConfigForm() {
        const npcCount = parseInt(document.getElementById("wcfg-npcCount").value, 10);
        const mainRoadCount = parseFloat(document.getElementById("wcfg-mainRoadCount").value);
        const subRoadCount = parseInt(document.getElementById("wcfg-subRoadCount").value, 10);
        const personality = document.getElementById("wcfg-personality").value;
        const buildingDensity = document.getElementById("wcfg-buildingDensity").value;
        const roadSkew = parseFloat(document.getElementById("wcfg-roadSkew").value);
        const roadCurve = parseInt(document.getElementById("wcfg-roadCurve").value, 10);
        const seedRaw = document.getElementById("wcfg-seed").value.trim();
        const tickInterval = parseInt(document.getElementById("wcfg-tickInterval").value, 10);

        if (!Number.isInteger(npcCount) || npcCount < 1 || npcCount > 500) {
            throw new Error("NPC Count must be an integer between 1 and 500.");
        }
        if (!Number.isFinite(mainRoadCount) || mainRoadCount < 1 || mainRoadCount > 5) {
            throw new Error("Main Roads must be a number between 1.0 and 5.0.");
        }
        if (!Number.isInteger(subRoadCount) || subRoadCount < 0 || subRoadCount > 50) {
            throw new Error("Sub Roads must be an integer between 0 and 50.");
        }
        if (!Number.isInteger(tickInterval) || tickInterval < 100 || tickInterval > 60000) {
            throw new Error("Tick Interval must be an integer between 100 and 60000.");
        }

        const config = {
            npcCount,
            mainRoadCount,
            subRoadCount,
            personality,
            buildingDensity,
            roadSkew,
            roadCurve,
            tick_interval_ms: tickInterval,
        };

        if (seedRaw !== "") {
            const seed = Number(seedRaw);
            if (!Number.isInteger(seed)) {
                throw new Error("Seed must be an integer or left blank.");
            }
            config.seed = seed;
        } else {
            config.seed = null;
        }

        return config;
    }

    async _saveConfig() {
        try {
            const config = this._readConfigForm();
            await fetch("/api/plugin/world/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
        } catch (error) {
            showError(error.message || "Could not save config.");
        }
    }

    async _generateWorld() {
        try {
            const config = this._readConfigForm();
            const res = await fetch("/api/plugin/world/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            const data = await res.json();
            if (data.ok) {
                if (this._renderer) this._renderer.destroy();
                this._renderer = null;
                this._currentWorld = null;
            }
        } catch (error) {
            showError(error.message || "Could not generate a new world.");
        }
    }

    _applyConfigToForm(config) {
        if (!config) return;
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el && val !== undefined && val !== null) el.value = val;
        };
        const setLabel = (id, val, formatter) => {
            const el = document.getElementById(id);
            if (el && val !== undefined && val !== null) {
                el.textContent = formatter(val);
            }
        };

        set("wcfg-npcCount", config.npcCount);
        set("wcfg-mainRoadCount", config.mainRoadCount);
        set("wcfg-subRoadCount", config.subRoadCount);
        set("wcfg-personality", config.personality);
        set("wcfg-buildingDensity", config.buildingDensity);
        set("wcfg-roadSkew", config.roadSkew);
        setLabel("wcfg-roadSkew-val", config.roadSkew, (val) => parseFloat(val).toFixed(2));
        set("wcfg-roadCurve", config.roadCurve);
        setLabel("wcfg-roadCurve-val", config.roadCurve, (val) => parseInt(val, 10));
        if (config.seed !== undefined && config.seed !== null) {
            set("wcfg-seed", config.seed);
        } else {
            set("wcfg-seed", "");
        }
        set("wcfg-tickInterval", config.tick_interval_ms);
    }

    _bindControls() {
        document.getElementById("world-btn-pause")?.addEventListener("click", () => {
            fetch("/api/plugin/world/pause", { method: "POST" });
        });

        document.getElementById("world-btn-resume")?.addEventListener("click", () => {
            fetch("/api/plugin/world/resume", { method: "POST" });
        });

        document.getElementById("world-btn-reset")?.addEventListener("click", async () => {
            const confirmed = await Yuuka.ui.confirm("Reset world? All progress will be lost.");
            if (!confirmed) return;
            try {
                await fetch("/api/plugin/world/reset", { method: "POST" });
                if (this._renderer) this._renderer.destroy();
                this._renderer = null;
                this._currentWorld = null;
                this._lastState = null;
                this._updateTimeDisplay({ world_time: "Day 1, 00:00", tick_count: 0, simulation_speed: 1 });
                const npcListEl = document.getElementById("world-npc-list");
                if (npcListEl) npcListEl.innerHTML = "";
            } catch (error) {
                showError("Could not reset world.");
            }
        });

        document.getElementById("world-speed-select")?.addEventListener("change", async (event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value) || value < 1 || value > 100) return;
            try {
                await fetch("/api/plugin/world/speed", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ speed_multiplier: value }),
                });
            } catch (error) {
                showError("Could not change world speed.");
            }
        });

        document.getElementById("world-btn-config-toggle")?.addEventListener("click", () => {
            const panel = document.getElementById("world-config-panel");
            if (!panel) return;
            panel.style.display = panel.style.display === "none" ? "block" : "none";
        });

        // Close popup when clicking the backdrop (not its content)
        document.getElementById("world-popup")?.addEventListener("click", (event) => {
            if (event.target === event.currentTarget) this._closePopup();
        });
    }

    _applySpeedToControl(speed) {
        const select = document.getElementById("world-speed-select");
        if (!select || speed === undefined || speed === null) return;
        const rounded = String(Math.round(Number(speed)));
        if ([...select.options].some((opt) => opt.value === rounded)) {
            select.value = rounded;
        }
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.components = window.Yuuka.components || {};
window.Yuuka.components["WorldComponent"] = WorldComponent;
