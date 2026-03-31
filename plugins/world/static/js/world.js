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
        this._speedOptions = [1, 2, 3, 4, 5, 10, 20, 50, 100, 1000];
        this._lastNpcListRenderMs = 0;
        this._lastStatusPopupRenderMs = 0;
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
    <div id="world-time-display">Day 1, 00:00 | Tick: 0 | NPCs: 0</div>
    <div id="world-controls">
      <button id="world-btn-play-pause">Pause</button>
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
      <label>Socialize</label>
      <select id="wcfg-socializeMode">
        <option value="None">None</option>
        <option value="Half">Half</option>
        <option value="Full">Full</option>
      </select>
    </div>
    <div class="world-config-field">
      <label class="world-config-checkbox">
        <input type="checkbox" id="wcfg-assignHome" checked>
        <span>Assign home</span>
      </label>
    </div>
    <div class="world-config-field">
      <label>Birth rate per successful sleep pair: <span id="wcfg-birthRate-val">100%</span></label>
      <input type="range" id="wcfg-birthRate" min="0" max="100" step="1" value="100">
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
            paused: state.paused,
        });
        this._updateNpcList(npcList, state.map.locations);
        this._updateTimeDisplay(state);
        this._applySpeedToControl(state.simulation_speed);
        this._updatePlayPauseButton(state.paused);
    }

    _startPolling() {
        if (this._pollingInterval) clearInterval(this._pollingInterval);
        
        const interval = this._currentPollInterval || 500;
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
                const isTimeSkip = live.simulation_speed >= 1000 || live.time_skip_mode;

                if (live.map) {
                    const shouldResetWorld = !this._hasSameWorldTopology(this._currentWorld, live.map);
                    this._currentWorld = live.map;
                    if (shouldResetWorld) {
                        this._renderer.setWorld(this._currentWorld);
                    } else {
                        this._renderer.world = this._currentWorld;
                    }
                }
                this._lastState = {
                    ...(this._lastState || {}),
                    ...live,
                    map: this._currentWorld,
                };

                const npcList = Object.values(live.npcs || {});
                
                // Update renderer so NPCs move on map
                this._renderer.render(npcList, {
                    simulationSpeed: live.simulation_speed,
                    serverTimeMs: live.server_time_ms,
                    worldTimeSeconds: live.world_time_seconds,
                    paused: live.paused,
                    time_skip_mode: live.time_skip_mode
                });

                const now = performance.now();
                const npcListInterval = isTimeSkip ? 2000 : 1000;
                if (now - this._lastNpcListRenderMs >= npcListInterval) {
                    this._updateNpcList(npcList, this._currentWorld?.locations);
                    this._lastNpcListRenderMs = now;
                }
                
                this._updateTimeDisplay(live);
                this._applySpeedToControl(live.simulation_speed);
                this._updatePlayPauseButton(live.paused);

                // Live-update the open status popup
                const popupInterval = isTimeSkip ? 1000 : 0;
                if (
                    this._openPopupNpcIds &&
                    this._openPopupNpcIds.length > 0 &&
                    (popupInterval === 0 || now - this._lastStatusPopupRenderMs >= popupInterval)
                ) {
                    this._renderStatusPopup();
                    this._lastStatusPopupRenderMs = now;
                }

                // Check if polling speed needs to change
                const targetInterval = isTimeSkip ? 400 : 500;
                if (this._currentPollInterval !== targetInterval) {
                    this._currentPollInterval = targetInterval;
                    this._startPolling();
                }
            } catch (error) {
                // Ignore transient polling errors.
            }
        }, interval);
    }

    _hasSameWorldTopology(left, right) {
        if (!left || !right) return false;
        if (left.mapSize !== right.mapSize) return false;

        const leftLocs = left.locations || [];
        const rightLocs = right.locations || [];
        if (leftLocs.length !== rightLocs.length) return false;

        for (let i = 0; i < leftLocs.length; i++) {
            const a = leftLocs[i];
            const b = rightLocs[i];
            if (!a || !b) return false;
            if (a.id !== b.id) return false;
            if (a.bx !== b.bx || a.by !== b.by || a.bw !== b.bw || a.bh !== b.bh) return false;
        }
        return true;
    }

    _updateTimeDisplay(state) {
        const el = document.getElementById("world-time-display");
        if (el) {
            const speed = Number(state.simulation_speed || 1);
            const npcCount = state && state.npcs && typeof state.npcs === "object"
                ? Object.keys(state.npcs).length
                : Number(state?.npc_count || 0);
            el.textContent = `${state.world_time} | Tick: ${state.tick_count} | NPCs: ${npcCount} | x${speed}`;
            
            // Enhanced visual feedback for time skip mode
            if (state.time_skip_mode) {
                el.style.background = "#ff6b6b";
                el.style.color = "white";
                el.style.padding = "2px 8px";
                el.style.borderRadius = "4px";
                el.style.fontWeight = "bold";
                el.title = "Time Skip Mode: NPCs teleported to final positions";
            } else if (speed >= 1000) {
                el.style.background = "#ff6b6b";
                el.style.color = "white";
                el.style.padding = "2px 8px";
                el.style.borderRadius = "4px";
                el.title = "Time Skip Mode: Calculating final states directly";
            } else {
                el.style.background = "";
                el.style.color = "";
                el.style.padding = "";
                el.style.borderRadius = "";
                el.style.fontWeight = "";
                el.title = "";
            }
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
                <span class="npc-location">${this._getLocName(loc)}</span>
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
        const currentIds = this._openPopupNpcIds.join(",");

        const container = popup.querySelector(".status-container");
        // Reuse existing container if it renders the same NPCs
        if (container && container.dataset.npcIds === currentIds) {
            this._updateStatusDynamic(npcs);
            return;
        }

        const isFirstOpen = popup.style.display === "none" || !popup.style.display;

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

        popup.innerHTML = `
            <div class="status-container ${isPair ? "status-pair" : ""} ${isFirstOpen ? "status-animate" : ""}" data-npc-ids="${currentIds}">
                <button class="world-popup-close" id="world-popup-close">✕</button>
                ${tabsHtml}
                <div class="status-panels">
                    ${panelsHtml}
                </div>
            </div>`;

        popup.style.display = "flex";
        popup.querySelectorAll(".status-header-info").forEach((header) => {
            const legacyMeta = header.querySelector('.status-zodiac:not(.val-meta)');
            if (legacyMeta) legacyMeta.remove();
        });

        // Bind events
        document.getElementById("world-popup-close")
            ?.addEventListener("click", () => this._closePopup());

        popup.querySelectorAll(".status-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                this._statusActiveTab = parseInt(tab.dataset.idx, 10);
                this._renderStatusPopup();
            });
        });

        popup.querySelectorAll(".world-btn-chat").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = parseInt(btn.dataset.npcId, 10);
                const npc = allNpcs[String(id)];
                if (npc) this._openChatWithNpc(npc);
            });
        });
    }

    _getNpcStatusData(npc) {
        if (!npc || !this._lastState) return null;

        const locMap = {};
        ((this._lastState.map && this._lastState.map.locations) || []).forEach((loc) => {
            locMap[loc.id] = loc;
        });

        const movement = npc.movement || {};
        const moving = !!movement.active;
        const loc = locMap[moving ? movement.target_location : npc.current_location] || {};
        const homeLoc = npc.home_location != null ? locMap[npc.home_location] : null;
        const jobLoc = npc.job_location != null ? locMap[npc.job_location] : null;

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
        const jobStr = jobLoc
            ? `💼 ${this._getLocName(jobLoc)}`
            : (npc.job_type ? `💼 ${String(npc.job_type).replace(/_/g, " ")}` : "💼 Chưa có việc");
        const metaLine = `${zodiacStr} · ${bdayStr} · ${jobStr}`;

        const allNpcs = this._lastState.npcs || {};
        const relationships = Object.entries(npc.relationships || {});
        
        const getTrust = (r) => typeof r === 'object' ? (r.trust ?? 0.0) : (r ?? 0.3);
        const getAttraction = (r) => typeof r === 'object' ? (r.attraction ?? 0.0) : 0.0;
        const getType = (r) => typeof r === 'object' ? (r.type ?? "stranger") : "stranger";

        // Sort to find the "best" representatives
        const sortedRels = [...relationships].sort((a, b) => getTrust(b[1]) - getTrust(a[1]));
        const sortedByAttraction = [...relationships].sort((a, b) => getAttraction(b[1]) - getAttraction(a[1]));

        const loverEntry = sortedByAttraction.find(([, r]) => ["dating", "partner", "crush"].includes(getType(r)));
        const bestFriendEntry = sortedRels.find(([, r]) => getType(r) === "close_friend");
        const friendEntry = sortedRels.find(([, r]) => getType(r) === "friend");
        const acquaintanceEntry = sortedRels.find(([, r]) => getType(r) === "acquaintance");
        const enemyEntry = [...sortedRels].reverse().find(([, r]) => ["enemy", "rival"].includes(getType(r)) || getTrust(r) < -0.3);

        const _relName = (id) => allNpcs[id]?.name || `NPC ${id}`;
        const _relThumb = (id) => {
            const hash = allNpcs[id]?.character_hash;
            return hash
                ? `<img class="status-rel-thumb" src="/image/${hash}" alt="">`
                : `<span class="status-rel-thumb status-rel-thumb-placeholder"></span>`;
        };
        const familyLinks = npc.family_links || {};
        const familyEntries = [
            ...(familyLinks.parents || []).map((id) => ({ id, label: "👪 Cha mẹ", color: "#c96b5c" })),
            ...(familyLinks.children || []).map((id) => ({ id, label: "🍼 Con", color: "#d28f2d" })),
            ...(familyLinks.siblings || []).map((id) => ({ id, label: "🧑‍🤝‍🧑 Anh chị em", color: "#6c8ed9" })),
        ].filter((entry) => allNpcs[String(entry.id)] || allNpcs[entry.id]);

        let relHtml = "";
        let familyHtml = "";
        
        const addRel = (entry, label, color) => {
            if (!entry) return;
            const [rid, rdata] = entry;
            const trust = Math.round(getTrust(rdata) * 100);
            relHtml += `
                <div class="status-rel-group">
                    <div class="status-rel-label" style="color:${color}">${label}</div>
                    <div class="status-rel-entry">
                        ${_relThumb(rid)}
                        <span class="status-rel-name">${_relName(rid)}</span>
                        <span class="status-rel-score" style="color:${color}">${trust}%</span>
                    </div>
                </div>`;
        };

        for (const entry of familyEntries) {
            familyHtml += `
                <div class="status-rel-group">
                    <div class="status-rel-label" style="color:${entry.color}">${entry.label}</div>
                    <div class="status-rel-entry">
                        ${_relThumb(entry.id)}
                        <span class="status-rel-name">${_relName(entry.id)}</span>
                    </div>
                </div>`;
        }

        addRel(loverEntry, "💕 Người yêu", "#ff88ff");
        addRel(bestFriendEntry, "⭐ Bạn thân nhất", "#44cc88");
        addRel(friendEntry, "🤝 Bạn bè", "#66bbff");
        addRel(acquaintanceEntry, "👥 Quen biết", "#aaaaaa");
        addRel(enemyEntry, "⚔️ Kẻ thù", "#ff4444");

        if (!relHtml) {
            relHtml = `<p class="status-rel-empty">Chưa có mối quan hệ đặc biệt</p>`;
        }

        const locationStr = moving
            ? `🚶 Đang di chuyển → ${this._getLocName(loc)}`
            : `📍 ${this._getLocName(loc)}`;

        if (!familyHtml) {
            familyHtml = `<p class="status-rel-empty">No recorded family</p>`;
        }

        const activityIcons = {
            eat: "🍽️", sleep: "💤", socialize: "💬", relax: "☕",
            study: "📖", work: "💼", birth_prep: "🏥", walk: "🚶", run: "🏃",
            idle: "⏸️", wander: "🔄"
        };
        const rawActivityName = moving ? movement.mode : npc.activity;
        const activityName = rawActivityName === "birth_prep" ? "Chuẩn bị sinh" : rawActivityName;
        const activityIcon = activityIcons[rawActivityName] || "❓";
        const specialStatus = rawActivityName === "birth_prep" ? "🏥 Đang tới bệnh viện chuẩn bị sinh" : "";

        return {
            zodiacStr, bdayStr, metaLine, jobStr, activityIcon, activityName, locationStr, specialStatus,
            homeName: homeLoc ? this._getLocName(homeLoc) : "Vô gia cư", money, energy,
            hunger, social, rest, work, quietPct, crowdPct, relHtml, familyHtml
        };
    }

    _buildNpcStatusHtml(npc) {
        const d = this._getNpcStatusData(npc);
        if (!d) return "";

        const thumbHtml = npc.character_hash
            ? `<img class="status-avatar" src="/image/${npc.character_hash}" alt="${npc.name}">`
            : `<div class="status-avatar status-avatar-placeholder"></div>`;

        return `
            <!-- Header -->
            <div class="status-header">
                ${thumbHtml}
                <div class="status-header-info">
                    <h4 class="status-name">${npc.name}</h4>
                    <div class="status-zodiac">${d.zodiacStr} · ${d.bdayStr}</div>
                    <div class="status-zodiac val-meta">${d.metaLine}</div>
                    <div class="status-activity val-activity">${d.activityIcon} ${d.activityName}</div>
                    ${d.specialStatus ? `<div class="status-zodiac">${d.specialStatus}</div>` : ""}
                </div>
            </div>

            <!-- Location & Money row -->
            <div class="status-info-row">
                <div class="status-info-chip">
                    <span class="status-chip-label">Vị trí</span>
                    <span class="status-chip-value val-location">${d.locationStr}</span>
                </div>
                <div class="status-info-chip">
                    <span class="status-chip-label">Nhà</span>
                    <span class="status-chip-value">🏠 ${d.homeName}</span>
                </div>
            </div>
            <div class="status-info-row">
                <div class="status-info-chip">
                    <span class="status-chip-label">Tiền</span>
                    <span class="status-chip-value val-money">💰 ${d.money}</span>
                </div>
                <div class="status-info-chip">
                    <span class="status-chip-label">Năng lượng</span>
                    <span class="status-chip-value val-energy">⚡ ${d.energy}%</span>
                </div>
            </div>

            <!-- Needs section -->
            <div class="status-section">
                <div class="status-section-title">📊 Nhu cầu</div>
                <div class="status-needs">
                    <div class="status-need-bar">
                        <span class="status-need-icon">🍖</span>
                        <span class="status-need-label">Đói</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-hunger val-hunger-bar" style="width:${d.hunger}%"></div></div>
                        <span class="status-need-pct val-hunger-pct">${d.hunger}%</span>
                    </div>
                    <div class="status-need-bar">
                        <span class="status-need-icon">💬</span>
                        <span class="status-need-label">Xã hội</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-social val-social-bar" style="width:${d.social}%"></div></div>
                        <span class="status-need-pct val-social-pct">${d.social}%</span>
                    </div>
                    <div class="status-need-bar">
                        <span class="status-need-icon">😴</span>
                        <span class="status-need-label">Nghỉ</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-rest val-rest-bar" style="width:${d.rest}%"></div></div>
                        <span class="status-need-pct val-rest-pct">${d.rest}%</span>
                    </div>
                    <div class="status-need-bar">
                        <span class="status-need-icon">💼</span>
                        <span class="status-need-label">Việc</span>
                        <div class="need-bar-track"><div class="need-bar-fill need-fill-work val-work-bar" style="width:${d.work}%"></div></div>
                        <span class="status-need-pct val-work-pct">${d.work}%</span>
                    </div>
                </div>
            </div>

            <!-- Preferences section -->
            <div class="status-section">
                <div class="status-section-title">🎭 Tính cách</div>
                <div class="status-prefs">
                    <div class="status-pref">
                        <span>🤫 Yên tĩnh</span>
                        <div class="status-pref-bar"><div class="status-pref-fill val-quiet-bar" style="width:${d.quietPct}%"></div></div>
                        <span class="val-quiet-pct">${d.quietPct}%</span>
                    </div>
                    <div class="status-pref">
                        <span>🎉 Đông đúc</span>
                        <div class="status-pref-bar"><div class="status-pref-fill val-crowd-bar" style="width:${d.crowdPct}%"></div></div>
                        <span class="val-crowd-pct">${d.crowdPct}%</span>
                    </div>
                </div>
            </div>

            <!-- Family section -->
            <div class="status-section">
                <div class="status-section-title">👨‍👩‍👧 Gia đình</div>
                <div class="status-relationships val-family">
                    ${d.familyHtml}
                </div>
            </div>

            <!-- Relationships section -->
            <div class="status-section">
                <div class="status-section-title">❤️ Mối quan hệ</div>
                <div class="status-relationships val-relationships">
                    ${d.relHtml}
                </div>
            </div>

            <button class="world-btn-chat" data-npc-id="${npc.id}">💬 Trò chuyện</button>`;
    }

    _updateStatusDynamic(npcs) {
        const popup = document.getElementById("world-popup");
        if (!popup) return;

        const activeTab = this._statusActiveTab || 0;
        const isPair = npcs.length === 2;

        // Sync tabs and panels active state
        popup.querySelectorAll(".status-tab").forEach((tab, idx) => {
            tab.classList.toggle("active", idx === activeTab);
        });
        popup.querySelectorAll(".status-panel").forEach((panel, idx) => {
            panel.classList.toggle("active", isPair && idx === activeTab);
        });

        npcs.forEach((npc, idx) => {
            const panel = popup.querySelector(`.status-panel[data-tab-idx="${idx}"]`);
            if (!panel) return;

            const d = this._getNpcStatusData(npc);
            if (!d) return;

            const updateText = (sel, txt) => {
                const el = panel.querySelector(sel);
                if (el && el.textContent !== txt) el.textContent = txt;
            };
            const updateWidth = (sel, pct) => {
                const el = panel.querySelector(sel);
                if (el) {
                    const w = pct + "%";
                    if (el.style.width !== w) el.style.width = w;
                }
            };
            const updateHtml = (sel, html) => {
                const el = panel.querySelector(sel);
                if (el && el.innerHTML !== html) el.innerHTML = html;
            };

            updateText(".val-meta", d.metaLine);
            updateText(".val-activity", `${d.activityIcon} ${d.activityName}`);
            updateText(".val-location", d.locationStr);
            updateText(".val-money", `💰 ${d.money}`);
            updateText(".val-energy", `⚡ ${d.energy}%`);

            updateWidth(".val-hunger-bar", d.hunger);
            updateText(".val-hunger-pct", `${d.hunger}%`);
            updateWidth(".val-social-bar", d.social);
            updateText(".val-social-pct", `${d.social}%`);
            updateWidth(".val-rest-bar", d.rest);
            updateText(".val-rest-pct", `${d.rest}%`);
            updateWidth(".val-work-bar", d.work);
            updateText(".val-work-pct", `${d.work}%`);

            updateWidth(".val-quiet-bar", d.quietPct);
            updateText(".val-quiet-pct", `${d.quietPct}%`);
            updateWidth(".val-crowd-bar", d.crowdPct);
            updateText(".val-crowd-pct", `${d.crowdPct}%`);

            updateHtml(".val-family", d.familyHtml);
            updateHtml(".val-relationships", d.relHtml);
        });
    }

    _openChatWithNpc(npc) {
        if (!npc) return;
        const chatPlugin = this._plugins.find((plugin) => plugin.id === "chat");
        if (!chatPlugin) {
            showError("Chat plugin is not available.");
            return;
        }
        
        // Prepare initial state for chat plugin
        window.Yuuka.initialPluginState = window.Yuuka.initialPluginState || {};
        window.Yuuka.initialPluginState.chat = {
            character: { hash: npc.character_hash, name: npc.name }
        };
        
        Yuuka.ui.switchTab("chat");
    }

    _getLocName(l) {
        if (!l) return "Không xác định";
        if (l.name) return l.name;
        if (!l.type) return "Vô gia cư"; // If it's a house but name is missing, but here it's more likely "Vô gia cư" context
        
        const typeNames = {
            house: "Nhà",
            cafe: "Cafe",
            shop: "Cửa hàng",
            school: "Trường học",
            park: "Công viên",
            shrine: "Đền thờ",
            library: "Thư viện",
            gym: "Phòng gym",
            arcade: "Khu trò chơi",
            hospital: "Bệnh viện",
            office: "Văn phòng",
            factory: "Nhà máy",
            studio: "Studio",
            builder_hq: "Trạm xây dựng",
            construction_site: "Công trường",
            museum: "Bảo tàng",
            cinema: "Rạp phim",
        };
        const typeBase = typeNames[l.type] || l.type.charAt(0).toUpperCase() + l.type.slice(1);
        return `${typeBase} #${l.id ?? "?"}`;
    }

    _showLocationPopup(locationId) {
        this._openPopupNpcIds = null;
        if (!this._lastState || !this._lastState.map) return;

        const loc = (this._lastState.map.locations || []).find((item) => item.id === locationId);
        if (!loc) return;

        const popup = document.getElementById("world-popup");
        if (!popup) return;

        const constructionPct = loc.type === "construction_site" && Number(loc.construction_required_hours) > 0
            ? Math.max(0, Math.min(100, Math.round((Number(loc.construction_progress_hours) || 0) / Number(loc.construction_required_hours) * 100)))
            : null;
        const constructionHtml = constructionPct === null
            ? ""
            : `
                <p><strong>Planned:</strong> ${loc.planned_type || "unknown"}</p>
                <p><strong>Progress:</strong> 🏗️ ${constructionPct}%</p>
                <p><strong>Work Required:</strong> ${loc.construction_required_hours || 0}h</p>
            `;

        popup.innerHTML = `
            <div class="world-popup-inner">
                <button class="world-popup-close" id="world-popup-close">x</button>
                <h4>${this._getLocName(loc)}</h4>
                <p><strong>Type:</strong> ${loc.type}</p>
                <p><strong>Capacity:</strong> ${loc.capacity}</p>
                <p><strong>Occupants:</strong> ${loc.occupants}</p>
                ${constructionHtml}
            </div>`;

        popup.style.display = "flex";
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

        const birthRateInput = document.getElementById("wcfg-birthRate");
        const birthRateLabel = document.getElementById("wcfg-birthRate-val");
        if (birthRateInput && birthRateLabel) {
            birthRateInput.addEventListener("input", () => {
                birthRateLabel.textContent = `${parseInt(birthRateInput.value, 10)}%`;
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
        const socializeMode = document.getElementById("wcfg-socializeMode").value;
        const assignHome = !!document.getElementById("wcfg-assignHome").checked;
        const birthRate = parseInt(document.getElementById("wcfg-birthRate").value, 10);
        const seedRaw = document.getElementById("wcfg-seed").value.trim();

        if (!Number.isInteger(npcCount) || npcCount < 1 || npcCount > 500) {
            throw new Error("NPC Count must be an integer between 1 and 500.");
        }
        if (!Number.isFinite(mainRoadCount) || mainRoadCount < 1 || mainRoadCount > 5) {
            throw new Error("Main Roads must be a number between 1.0 and 5.0.");
        }
        if (!Number.isInteger(subRoadCount) || subRoadCount < 0 || subRoadCount > 50) {
            throw new Error("Sub Roads must be an integer between 0 and 50.");
        }
        if (!["None", "Half", "Full"].includes(socializeMode)) {
            throw new Error("Socialize must be None, Half, or Full.");
        }
        if (!Number.isInteger(birthRate) || birthRate < 0 || birthRate > 100) {
            throw new Error("Birth rate must be between 0% and 100%.");
        }

        const config = {
            npcCount,
            mainRoadCount,
            subRoadCount,
            personality,
            buildingDensity,
            roadSkew,
            roadCurve,
            socializeMode,
            assignHome,
            birthRate,
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
        set("wcfg-socializeMode", config.socializeMode || "None");
        const assignHomeEl = document.getElementById("wcfg-assignHome");
        if (assignHomeEl) assignHomeEl.checked = config.assignHome !== false;
        set("wcfg-birthRate", config.birthRate ?? 100);
        setLabel("wcfg-birthRate-val", config.birthRate ?? 100, (val) => `${parseInt(val, 10)}%`);
        if (config.seed !== undefined && config.seed !== null) {
            set("wcfg-seed", config.seed);
        } else {
            set("wcfg-seed", "");
        }
    }

    _bindControls() {
        document.getElementById("world-btn-play-pause")?.addEventListener("click", () => {
            const paused = this._lastState?.paused;
            fetch(`/api/plugin/world/${paused ? "resume" : "pause"}`, { method: "POST" });
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
            console.log("Speed change requested:", value);
            if (!Number.isFinite(value) || value < 1 || value > 1000) return;
            try {
                const response = await fetch("/api/plugin/world/speed", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ speed_multiplier: value }),
                });
                const result = await response.json();
                console.log("Speed change response:", result);
                if (!result.ok) {
                    throw new Error(result.error || "Failed to change speed");
                }
            } catch (error) {
                console.error("Speed change error:", error);
                showError("Could not change world speed.");
                // Revert the select to current known speed
                this._applySpeedToControl(this._lastState?.simulation_speed || 1);
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
        
        // Special handling for x1000 time skip mode
        if (speed >= 1000) {
            const timeDisplay = document.getElementById("world-time-display");
            if (timeDisplay) {
                timeDisplay.style.background = "#ff6b6b";
                timeDisplay.style.color = "white";
                timeDisplay.style.padding = "2px 8px";
                timeDisplay.style.borderRadius = "4px";
                timeDisplay.title = "Time Skip Mode: Calculating final states directly";
            }
        } else {
            const timeDisplay = document.getElementById("world-time-display");
            if (timeDisplay) {
                timeDisplay.style.background = "";
                timeDisplay.style.color = "";
                timeDisplay.style.padding = "";
                timeDisplay.style.borderRadius = "";
                timeDisplay.title = "";
            }
        }
    }

    _updatePlayPauseButton(paused) {
        const btn = document.getElementById("world-btn-play-pause");
        if (!btn) return;
        btn.textContent = paused ? "Resume" : "Pause";
        btn.classList.toggle("paused", !!paused);
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.components = window.Yuuka.components || {};
window.Yuuka.components["WorldComponent"] = WorldComponent;
