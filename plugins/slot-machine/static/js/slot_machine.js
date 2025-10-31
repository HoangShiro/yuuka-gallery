// --- MODIFIED FILE: plugins/slot-machine/static/js/slot_machine.js ---
// Lucky Card front-end controller (Single mode & PvP lobby)
import { UIController } from './ui_controller.js';

const GAME_ID = 'slot-machine';
const PVP_SLOT_IDS = ['room-1', 'room-2', 'room-3'];
const LOBBY_REFRESH_MS = 6000;

class SlotMachineService {
    constructor(container, api) {
        this.api = api;
        this.container = container;
        this.isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia('(max-width: 800px)').matches;

        this.ws = null;
        this.isAuthenticated = false;
        this.userHash = null;
        this.messageQueue = [];
        this._forcePlainWs = false;

        this.state = {};
        this.gameConfig = {};
        this.specialCardConfigs = [];
        this.spinDirection = 1;
        this.pendingVisualEffects = {
            blindDirectives: [],
            rowSwapIntents: [],
            replacementCharacters: [],
            fakeCardOverlays: [],
            specialMutationSummary: [],
            spinPower: null
        };

        this.currentMode = 'menu'; // menu | single | pvp
        this.pendingMode = null;
        this.pendingStartOptions = {};
        this.pendingRoomChange = null;
        this.autoStartTriggered = false;

        this.roomId = null;
        this.slotId = null;
        this.matchSummary = null;
        this.canSpin = false;
        this.remainingSpins = 0;

        this.backdrop = null;
        this.menuLayer = null;
        this.gameLayer = null;
        this.menuSingleBtn = null;
        this.roomCards = new Map();
        this.scoreboards = { left: null, right: null };
        this.turnIndicator = null;
        this.pvpBanner = null;
        this.pvpBannerTitle = null;
        this.pvpResetBtn = null;
        this.ui = null;

        this.resizeDebounceTimeout = null;
        this.autoSpinTimer = null;
        this.lobbyTimer = null;
        this.lobbyRooms = [];

        this._handleResize = this._handleResize.bind(this);
        this._handleBackdropClick = this._handleBackdropClick.bind(this);
        this._registerGlobalTriggers();
    }

    start(options = {}) {
        if (this.backdrop) return;

        this.pendingStartOptions = { ...options };
        this.pendingMode = (options.autoSpin || options.forceJackpot) ? 'single' : null;
        this.autoStartTriggered = false;

        this._initUI();
        this._connectWebSocket(options);
    }

    close() {
        this._stopLobbyPolling();
        this._clearTimers();

        if (this.ws) {
            const socket = this.ws;
            this.ws = null;
            socket.onclose = null;
            try { socket.close(); } catch (err) { console.warn('[SlotMachine] Failed to close WS', err); }
        }

        if (this.ui) {
            this.ui.destroy();
            this.ui = null;
        }

        window.removeEventListener('resize', this._handleResize);

        if (this.backdrop) {
            this.backdrop.removeEventListener('click', this._handleBackdropClick);
            this.backdrop.remove();
            this.backdrop = null;
        }

        this.isAuthenticated = false;
        this.userHash = null;
        this.roomId = null;
        this.slotId = null;
        this.matchSummary = null;
        this.currentMode = 'menu';
        this._forcePlainWs = false;
    }

    _connectWebSocket(startOptions, allowFallback = true) {
        const prefersSecure = window.location.protocol === 'https:' && !this._forcePlainWs;
        const protocol = prefersSecure ? 'wss' : 'ws';
        const wsUrl = `${protocol}://${window.location.host}/ws/game`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            const token = localStorage.getItem('yuuka-auth-token');
            this._sendRaw({ type: 'auth', token }, { bypassAuthGuard: true });
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this._handleWsMessage(message, startOptions);
        };

        this.ws.onclose = () => {
            console.log('[SlotMachine] WebSocket disconnected.');
            this.isAuthenticated = false;
            this.ws = null;
            if (this.backdrop) {
                showError('Lost connection to Lucky Card server.');
                this.close();
            }
        };

        this.ws.onerror = (error) => {
            console.error('[SlotMachine] WebSocket error:', error);
            const shouldFallback = prefersSecure && allowFallback;
            if (shouldFallback) {
                console.warn('[SlotMachine] Secure WebSocket failed, retrying with ws://');
                this._forcePlainWs = true;
                this._teardownWebSocket();
                this._connectWebSocket(startOptions, false);
                return;
            }
            showError('Game server connection failed.');
            this.close();
        };
    }

    _teardownWebSocket() {
        if (!this.ws) return;
        const socket = this.ws;
        this.ws = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
            socket.close();
        } catch (err) {
            console.warn('[SlotMachine] Failed to tear down WebSocket during retry', err);
        }
    }

    _sendRaw(payload, options = {}) {
        const { bypassAuthGuard = false } = options;
        const canSend = this.ws
            && this.ws.readyState === WebSocket.OPEN
            && (this.isAuthenticated || bypassAuthGuard);

        if (canSend) {
            this.ws.send(JSON.stringify(payload));
            return;
        }

        this.messageQueue.push(payload);
    }

    _flushQueuedMessages() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated) return;
        while (this.messageQueue.length) {
            const payload = this.messageQueue.shift();
            if (payload?.type === 'auth') continue;
            this.ws.send(JSON.stringify(payload));
        }
    }

    _sendGameAction(type, data = {}) {
        this._sendRaw({ type: 'game_action', data: { type, ...data } });
    }

    _handleWsMessage(message, startOptions) {
        switch (message.type) {
            case 'auth_success':
                this._handleAuthSuccess(message, startOptions);
                break;
            case 'auth_fail':
                showError('Game authentication failed.');
                this.close();
                break;
            case 'room_created':
                this._handleRoomCreated(message.room);
                break;
            case 'room_joined':
                this._handleRoomJoined(message.room);
                break;
            case 'room_left':
                this._handleRoomLeft(message.room_id);
                break;
            case 'player_joined':
            case 'player_left':
                if (this.menuLayer && !this.menuLayer.classList.contains('is-hidden')) {
                    this._requestLobby();
                }
                break;
            case 'initial_state':
                this._handleInitialState(message, startOptions);
                break;
            case 'spin_result':
                this._handleSpinResult(message.data);
                break;
            case 'pick_update':
                this._handlePickUpdate(message.data);
                break;
            case 'lobby_state':
                this._renderLobby(message.rooms);
                break;
            case 'pvp_entry':
                this._handlePvpEntry(message);
                break;
            case 'match_state':
                this._handleMatchState(message.matchSummary);
                break;
            case 'match_reset':
                this._handleMatchReset(message);
                break;
            case 'error':
                showError(`Lucky Card error: ${message.message}`);
                break;
            default:
                console.debug('[SlotMachine] Unhandled message type:', message);
        }
    }

    _handleAuthSuccess(message, startOptions) {
        this.isAuthenticated = true;
        this.userHash = message.user_hash;
        this._flushQueuedMessages();

        if (this.pendingMode === 'single') {
            this._showGameLayer('single');
            this._createSingleRoom(startOptions);
        } else {
            this._showMenu();
            this._requestLobby();
            this._startLobbyPolling();
        }
    }

    // ---------------------------------------------------------------------
    // Lobby & layout
    // ---------------------------------------------------------------------

    _initUI() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = `slot-machine-backdrop ${this.isMobile ? 'is-mobile' : ''}`;
        this.backdrop.classList.add('is-menu-open');

        const lobbyMarkup = PVP_SLOT_IDS.map((slotId, index) => `
            <button class="slot-room-card" data-slot-id="${slotId}">
                <div class="slot-room-card__title">Room ${index + 1}</div>
                <div class="slot-room-card__status">Empty</div>
                <div class="slot-room-card__meta">Players: 0/2</div>
                <div class="slot-room-card__extra">No spins yet</div>
            </button>
        `).join('');

        const reelsMarkup = this.isMobile
            ? Array.from({ length: 3 }, (_, i) => `<div class="slot-column" data-col-index="${i}"><div class="slot-strip"></div></div>`).join('')
            : Array.from({ length: 3 }, (_, i) => `<div class="slot-row" data-row-index="${i}"></div>`).join('');

        this.backdrop.innerHTML = `
            <div class="slot-overlay" data-view="menu">
                <div class="slot-menu">
                    <h1 class="slot-menu__title">Lucky Card</h1>
                    <p class="slot-menu__subtitle">Choose a mode to begin</p>
                    <button class="slot-menu__single">Single mode</button>
                    <div class="slot-menu__rooms">
                        ${lobbyMarkup}
                    </div>
                    <p class="slot-menu__hint">PvP rooms update in real time. Join any room to battle another player.</p>
                </div>
            </div>

            <div class="slot-game-layer is-hidden" data-view="game">
                <div class="slot-log-container"></div>
                <div class="slot-score-popup-container"></div>
                <div class="slot-jackpot-banner" aria-hidden="true">
                    <span class="slot-jackpot-banner__text">JACKPOT</span>
                </div>
                <div class="slot-jackpot-rain-layer" aria-hidden="true"></div>

                <div class="pvp-scoreboard pvp-scoreboard--left is-hidden">
                    <div class="pvp-scoreboard__name">Player 1</div>
                    <div class="pvp-scoreboard__score">Score: 0</div>
                    <div class="pvp-scoreboard__spins">Spins: 0/10</div>
                    <div class="pvp-scoreboard__meta">Free spins: 0 | Jackpots: 0</div>
                </div>
                <div class="pvp-scoreboard pvp-scoreboard--right is-hidden">
                    <div class="pvp-scoreboard__name">Player 2</div>
                    <div class="pvp-scoreboard__score">Score: 0</div>
                    <div class="pvp-scoreboard__spins">Spins: 0/10</div>
                    <div class="pvp-scoreboard__meta">Free spins: 0 | Jackpots: 0</div>
                </div>

                <div class="pvp-turn-indicator is-hidden">Your turn</div>

                <div class="slot-stats">
                    <div id="stat-score" class="stat-item">
                        <span class="material-symbols-outlined">military_tech</span>
                        <span class="stat-value"><span id="slot-score-session">0</span>/<span id="slot-score-high">0</span></span>
                        <span class="stat-delta"></span>
                    </div>
                    <div id="stat-jackpots" class="stat-item">
                        <span class="material-symbols-outlined">emoji_events</span>
                        <span class="stat-value"><span id="slot-jackpots-session">0</span>/<span id="slot-jackpots-total">0</span></span>
                        <span class="stat-delta"></span>
                    </div>
                    <div id="stat-spins" class="stat-item">
                        <span class="material-symbols-outlined">replay</span>
                        <span class="stat-value"><span id="slot-spins-session">0</span>/<span id="slot-spins-total">0</span></span>
                        <span class="stat-delta"></span>
                    </div>
                </div>

                <div class="slot-machine-reels-container">
                    <div class="slot-machine-frame"></div>
                    ${reelsMarkup}
                </div>

                <div class="slot-controls">
                    <div class="slot-cost-indicator">
                        <div data-type="cost"><span class="material-symbols-outlined">military_tech</span><span class="cost-value">10</span></div>
                        <div data-type="free"><span class="material-symbols-outlined">redeem</span><span class="free-spin-value">0</span></div>
                    </div>
                    <button class="slot-spin-btn"><span class="material-symbols-outlined">casino</span></button>
                </div>

                <button class="slot-close-btn"><span class="material-symbols-outlined">close</span></button>

                <div class="pvp-banner is-hidden">
                    <div class="pvp-banner__title">WIN</div>
                    <button class="pvp-reset-btn">Reset game</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.backdrop);
        this.backdrop.addEventListener('click', this._handleBackdropClick);

        this.menuLayer = this.backdrop.querySelector('[data-view="menu"]');
        this.gameLayer = this.backdrop.querySelector('[data-view="game"]');
        this.menuSingleBtn = this.backdrop.querySelector('.slot-menu__single');
        this.scoreboards.left = this.backdrop.querySelector('.pvp-scoreboard--left');
        this.scoreboards.right = this.backdrop.querySelector('.pvp-scoreboard--right');
        this.turnIndicator = this.backdrop.querySelector('.pvp-turn-indicator');
        this.pvpBanner = this.backdrop.querySelector('.pvp-banner');
        this.pvpBannerTitle = this.backdrop.querySelector('.pvp-banner__title');
        this.pvpResetBtn = this.backdrop.querySelector('.pvp-reset-btn');

        PVP_SLOT_IDS.forEach((slotId) => {
            const card = this.backdrop.querySelector(`[data-slot-id="${slotId}"]`);
            if (card) {
                this.roomCards.set(slotId, card);
                card.addEventListener('click', () => this._enterPvpSlot(slotId));
            }
        });

        this.menuSingleBtn?.addEventListener('click', () => {
            if (!this.isAuthenticated) return;
            this.pendingMode = 'single';
            this._stopLobbyPolling();
            this._showGameLayer('single');
            this._createSingleRoom(this.pendingStartOptions);
        });

        this.pvpResetBtn?.addEventListener('click', () => {
            if (this.currentMode === 'pvp') {
                this._sendGameAction('reset_match', this._buildActionPayload());
            }
        });

        this.backdrop.querySelector('.slot-close-btn')?.addEventListener('click', () => this.close());

        this.ui = new UIController(this.backdrop, this.isMobile);
        this.ui.spinBtn.addEventListener('click', () => this._handleSpin());
        this.backdrop.querySelector('.slot-machine-reels-container')?.addEventListener('click', this._handleCardPick.bind(this));
    }

    _showMenu() {
        if (!this.menuLayer) return;
        this.currentMode = 'menu';
        this.menuLayer.classList.remove('is-hidden');
        this.gameLayer?.classList.add('is-hidden');
        this.backdrop?.classList.remove('is-pvp');
        this.backdrop?.classList.add('is-menu-open');
        this._updatePvpUI(null);
    }

    _handleBackdropClick(event) {
        if (this.currentMode !== 'menu') return;
        if (event.target.closest('.slot-overlay')) return;
        this.close();
    }

    _showGameLayer(mode) {
        if (!this.gameLayer) return;
        this.currentMode = mode;
        this.menuLayer?.classList.add('is-hidden');
        this.gameLayer.classList.remove('is-hidden');
        this.backdrop?.classList.toggle('is-pvp', mode === 'pvp');
        this.backdrop?.classList.remove('is-menu-open');
        this.canSpin = mode === 'single';
        this._updatePvpUI(mode === 'pvp' ? this.matchSummary : null);
    }

    _startLobbyPolling() {
        this._stopLobbyPolling();
        this.lobbyTimer = setInterval(() => this._requestLobby(), LOBBY_REFRESH_MS);
    }

    _stopLobbyPolling() {
        if (this.lobbyTimer) {
            clearInterval(this.lobbyTimer);
            this.lobbyTimer = null;
        }
    }

    _requestLobby() {
        if (!this.isAuthenticated) return;
        this._sendGameAction('get_lobby', { game_id: GAME_ID });
    }

    _renderLobby(rooms = []) {
        this.lobbyRooms = rooms;
        rooms.forEach((room) => {
            const card = this.roomCards.get(room.slotId);
            if (!card) return;
            card.classList.remove('is-loading');

            const summary = room.summary || {};
            const statusEl = card.querySelector('.slot-room-card__status');
            const metaEl = card.querySelector('.slot-room-card__meta');
            const extraEl = card.querySelector('.slot-room-card__extra');

            const players = summary.players || [];
            const playerCount = players.length;
            const maxSpins = summary.maxSpins || 10;

            statusEl.textContent = this._formatRoomStatus(summary.status, summary.winner, summary.activePlayer);
            metaEl.textContent = `Players: ${playerCount}/2`;
            extraEl.textContent = players.length
                ? players.map(p => `${this._shortHash(p.hash)} ${p.spinsUsed}/${maxSpins}`).join(' • ')
                : 'No spins yet';

            card.classList.toggle('is-active', room.roomId === this.roomId);
            card.classList.toggle('is-full', playerCount >= 2);
        });
    }

    _formatRoomStatus(status, winnerHash, activePlayer) {
        switch (status) {
            case 'in_progress':
                return `In progress • Turn: ${this._formatPlayerLabel(activePlayer)}`;
            case 'finished':
                return winnerHash ? `Finished • Winner: ${this._shortHash(winnerHash)}` : 'Finished • Draw';
            case 'waiting':
            default:
                return 'Waiting for opponent';
        }
    }

    _formatPlayerLabel(hash) {
        if (!hash) return '—';
        return hash === this.userHash ? 'You' : this._shortHash(hash);
    }

    _shortHash(hash) {
        return hash ? hash.slice(0, 6).toUpperCase() : '------';
    }

    _enterPvpSlot(slotId) {
        if (!this.isAuthenticated || this.pendingRoomChange) return;
        const card = this.roomCards.get(slotId);
        card?.classList.add('is-loading');

        this.pendingMode = 'pvp';
        this.pendingRoomChange = { mode: 'pvp', slotId };
        this.slotId = slotId;
        this._stopLobbyPolling();
        this._sendGameAction('request_pvp_slot', { slot_id: slotId, game_id: GAME_ID });
    }

    _handlePvpEntry(message) {
        if (this.pendingRoomChange?.mode !== 'pvp' || this.pendingRoomChange.slotId !== message.slotId) {
            return;
        }

        this.roomId = message.roomId;
        this.matchSummary = message.matchSummary || null;

        if (message.shouldCreate) {
            this._sendRaw({ type: 'create_room', data: { game_id: GAME_ID, room_id: message.roomId } });
        } else {
            this._sendRaw({ type: 'join_room', data: { room_id: message.roomId } });
        }
    }

    _handleRoomCreated(room) {
        this.roomId = room.id;
        this.pendingRoomChange = null;

        if (this.pendingMode === 'pvp') {
            this._showGameLayer('pvp');
            this._sendGameAction('start_game', {
                mode: 'pvp',
                room_id: this.roomId,
                slot_id: this.slotId,
                is_mobile: this.isMobile
            });
        } else {
            this.pendingMode = 'single';
            this._sendGameAction('start_game', {
                mode: 'single',
                is_mobile: this.isMobile,
                ...this.pendingStartOptions
            });
        }
    }

    _handleRoomJoined(room) {
        this.roomId = room.id;
        this.pendingRoomChange = null;

        if (this.pendingMode === 'pvp') {
            this._showGameLayer('pvp');
            this._sendGameAction('start_game', {
                mode: 'pvp',
                room_id: this.roomId,
                slot_id: this.slotId,
                is_mobile: this.isMobile
            });
        }
    }

    _handleRoomLeft(roomId) {
        if (this.roomId !== roomId) return;
        this.matchSummary = null;
        this.roomId = null;
        this.slotId = null;
        if (this.currentMode === 'pvp') {
            showError('You have left the PvP room.');
            this.close();
        }
    }

    // ---------------------------------------------------------------------
    // Game state handling
    // ---------------------------------------------------------------------

    _handleInitialState(message, startOptions) {
        const data = message.data || message;
        if (!data) return;

        this.state = data;
        this.pendingVisualEffects = {
            blindDirectives: [],
            rowSwapIntents: [],
            replacementCharacters: [],
            fakeCardOverlays: [],
            specialMutationSummary: [],
            spinPower: null
        };
        this.state.sessionSpecialMap = data.sessionSpecialMap || {};
        this.gameConfig = data.gameConfig || this.gameConfig;
        this.specialCardConfigs = data.specialCardConfigs || this.specialCardConfigs;
        this.spinDirection = typeof data.spinDirection === 'number' ? data.spinDirection : 1;
        this.state.reverseSpinCredits = data.reverseSpinCredits || 0;
        this.currentMode = message.mode || this.currentMode || 'single';

        this.ui.initialize(this.gameConfig, this.specialCardConfigs);
        this.ui.buildInitialReels(data.reelCharacters, data.pickedCharacterHash);
        this.ui.renderSpecialBadges(new Map(Object.entries(data.sessionSpecialMap || {})));
        this.ui.animateToInitialPosition(data.reelCharacters);
        this.ui.updateControlsDisplay(data.freeSpins, data.sessionScore, false, data.pickedCharacterHash);
        this.ui.updateStatsDisplay(data.stats);
        this._updateSpinAvailability();

        window.addEventListener('resize', this._handleResize);

        if (this.currentMode === 'pvp') {
            this._updatePvpUI(message.matchSummary || this.matchSummary);
        } else {
            this._updatePvpUI(null);
        }

        if (startOptions.autoSpin && !this.autoStartTriggered) {
            this.autoStartTriggered = true;
            setTimeout(() => this._handleSpin(startOptions), 1100);
        }
    }

    _handleSpinResult(data) {
        const {
            finalResults,
            finalCardIndices,
            outcome,
            newState,
            freeSpins,
            sessionScore,
            scoreBefore,
            reelCharacters,
            matchSummary,
            demoMode,
            playerHash,
            pendingRespin,
            pendingReverseSpin,
            sessionSpecialMap,
            spinDirection: resultSpinDirection,
            nextSpinDirection,
            reverseSpinCredits
        } = data;

        const {
            blindDirectives = [],
            rowSwapIntents = [],
            replacementCharacters = [],
            fakeCardOverlays = [],
            specialMutationSummary = [],
            spinPower = null
        } = outcome || {};

        const isDemo = !!demoMode;
        const isMySpin = !playerHash || playerHash === this.userHash;
        const hasPendingRespin = Boolean(pendingRespin);
        const hasPendingReverseSpin = Boolean(pendingReverseSpin) || (typeof reverseSpinCredits === 'number' && reverseSpinCredits > 0);
        const spinDirectionForResult = typeof resultSpinDirection === 'number' ? resultSpinDirection : this.spinDirection;
        const spinDirectionForNext = typeof nextSpinDirection === 'number' ? nextSpinDirection : spinDirectionForResult;
        this.pendingVisualEffects = {
            blindDirectives,
            rowSwapIntents,
            replacementCharacters,
            fakeCardOverlays,
            specialMutationSummary,
            spinPower
        };

        if (!isDemo && isMySpin && newState) {
            this.state.stats = newState;
            this.state.freeSpins = freeSpins;
            this.state.sessionScore = sessionScore;
            this.state.sessionSpins = newState.sessionSpins;
        } else if (!this.state.stats && newState) {
            this.state.stats = newState;
        }
        if (typeof reverseSpinCredits === 'number') {
            this.state.reverseSpinCredits = reverseSpinCredits;
        }
        if (reelCharacters) {
            this.state.reelCharacters = reelCharacters;
        }
        if (sessionSpecialMap) {
            this.state.sessionSpecialMap = sessionSpecialMap;
        } else if (!this.state.sessionSpecialMap) {
            this.state.sessionSpecialMap = {};
        }
        this.spinDirection = spinDirectionForResult;
        const { spinPromises } = this.ui.animateSpin(
            finalResults,
            this.state.reelCharacters,
            this.state.pickedCharacterHash,
            this.spinDirection
        );

        const waitForSpin = Array.isArray(spinPromises) ? Promise.all(spinPromises) : Promise.resolve();
        const shouldQueueAutoSpin = !isDemo && isMySpin && (
            outcome.respinCount > 0 ||
            outcome.reverseSpinCount > 0 ||
            hasPendingRespin ||
            hasPendingReverseSpin
        );

        waitForSpin
            .then(() => {
                this.ui.renderSpecialBadges(new Map(Object.entries(this.state.sessionSpecialMap || {})));
                this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, false, this.state.pickedCharacterHash);
                if (!isDemo && isMySpin && this.state.stats) {
                    this.ui.updateStatsDisplay(this.state.stats);
                }

                if (outcome.executedSwaps && outcome.executedSwaps.length > 0) {
                    outcome.executedSwaps.forEach(swap => {
                        this.ui.applySwapVisuals(swap.sourceCell, swap.targetCell, finalCardIndices, this.state.reelCharacters);
                    });
                }

                outcome.eventsToDisplay.forEach((event, index) => {
                    setTimeout(() => this.ui.showScorePopup(event.text, event.score, event.type, event.displayValue), index * (this.gameConfig.REVEAL_EVENT_DELAY || 400));
                });

                this.ui.setFrameGlow(outcome.highestWinType, outcome.highestWinType === 'jackpot' ? null : 2400);
                this.ui.highlightWinningCards(outcome.winningGroups, finalCardIndices, this.state.reelCharacters);

                let jackpotCharacter = outcome.jackpotCharacter;
                if (!jackpotCharacter && outcome.highestWinType === 'jackpot') {
                    const middleReelIndex = Math.floor((this.state.reel_characters?.length || 1) / 2);
                    const middleReel = this.state.reel_characters?.[middleReelIndex] || [];
                    const middleCardIndex = finalCardIndices?.[middleReelIndex];
                    if (middleCardIndex !== undefined) {
                        jackpotCharacter = middleReel[middleCardIndex] || null;
                    }
                }
                if (jackpotCharacter) {
                    this.ui.triggerJackpotAnimation(jackpotCharacter);
                }

                if (!isDemo && isMySpin) {
                    this.ui.addLogEntry({
                        spin: this.state.sessionSpins,
                        scoreBefore,
                        scoreAfter: this.state.sessionScore,
                        outcome
                    });
                }

                this.state.isSpinning = false;
                this.state.pickedCharacterHash = null;
                this.ui.updateHighlights(null);
                this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, false, this.state.pickedCharacterHash);
                this.ui.setSpinningState(false);
                this._updateSpinAvailability();
            })
            .catch((err) => {
                console.error('[SlotMachine] Spin animation error', err);
                this.state.isSpinning = false;
                this.state.pickedCharacterHash = null;
                this.ui.updateHighlights(null);
                this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, false, null);
                this.ui.setSpinningState(false);
                this._updateSpinAvailability();
            })
            .finally(() => {
                this.spinDirection = spinDirectionForNext;
                if (matchSummary) {
                    this._updatePvpUI(matchSummary);
                }
                if (shouldQueueAutoSpin) {
                    this._scheduleAutoSpin();
                }
            });
    }

    _handlePickUpdate(data) {
        this.state.pickedCharacterHash = data.pickedCharacterHash;
        this.ui.updateHighlights(this.state.pickedCharacterHash);
        this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, false, this.state.pickedCharacterHash);
        this._updateSpinAvailability();
        if (data.matchSummary) {
            this._updatePvpUI(data.matchSummary);
        }
    }

    _handleMatchState(summary) {
        if (this.currentMode === 'pvp') {
            this._updatePvpUI(summary);
        }
        if (this.menuLayer && !this.menuLayer.classList.contains('is-hidden')) {
            this._requestLobby();
        }
    }

    _handleMatchReset(message) {
        if (message.matchSummary) {
            this._updatePvpUI(message.matchSummary);
        }

        const initialStates = message.initialStates || {};
        if (this.userHash && initialStates[this.userHash]) {
            this._handleInitialState({ mode: 'pvp', data: initialStates[this.userHash], matchSummary: message.matchSummary }, {});
        }
    }
    _updatePvpUI(summary) {
        this.matchSummary = summary || null;
        const scoreboardEls = [this.scoreboards.left, this.scoreboards.right];

        if (!summary || this.currentMode !== 'pvp') {
            scoreboardEls.forEach(el => el && el.classList.add('is-hidden'));
            this._hidePvpBanner();
            if (this.turnIndicator) {
                this.turnIndicator.classList.add('is-hidden');
            }
            this.canSpin = this.currentMode === 'single';
            this._updateSpinAvailability();
            return;
        }

        const players = summary.players || [];
        const maxSpins = summary.maxSpins || 10;
        const activeHash = summary.activePlayer;
        const finished = summary.status === 'finished';
        const hasTwoPlayers = players.filter(Boolean).length >= 2;

        scoreboardEls.forEach((el, index) => {
            if (!el) return;
            const player = players[index];
            el.classList.remove('is-hidden', 'is-empty', 'is-active');

            if (!player) {
                el.classList.add('is-empty');
                el.querySelector('.pvp-scoreboard__name').textContent = `Waiting for Player ${index + 1}`;
                el.querySelector('.pvp-scoreboard__score').textContent = 'Score: 0';
                el.querySelector('.pvp-scoreboard__spins').textContent = `Spins: 0/${maxSpins}`;
                el.querySelector('.pvp-scoreboard__meta').textContent = 'Free spins: 0 | Jackpots: 0';
                return;
            }

            const label = player.hash === this.userHash ? 'You' : this._shortHash(player.hash);
            el.dataset.playerHash = player.hash;
            el.querySelector('.pvp-scoreboard__name').textContent = label;
            el.querySelector('.pvp-scoreboard__score').textContent = `Score: ${player.score ?? 0}`;
            el.querySelector('.pvp-scoreboard__spins').textContent = `Spins: ${player.spinsUsed}/${maxSpins} • Remaining: ${Math.max(0, player.spinsLeft ?? 0)}`;
            el.querySelector('.pvp-scoreboard__meta').textContent = `Free spins: ${player.freeSpins ?? 0} | Jackpots: ${player.jackpots ?? 0}`;
            if (!finished && player.hash === activeHash) {
                el.classList.add('is-active');
            }
        });

        const isMyTurn = !finished && hasTwoPlayers && activeHash === this.userHash;
        if (this.turnIndicator) {
            this.turnIndicator.classList.toggle('is-hidden', !isMyTurn);
        }

        const myEntry = players.find(p => p && p.hash === this.userHash);
        if (myEntry) {
            if (typeof myEntry.freeSpins === 'number') {
                this.state.freeSpins = myEntry.freeSpins;
            }
            if (typeof myEntry.score === 'number') {
                this.state.sessionScore = myEntry.score;
            }
            if (typeof myEntry.spinsUsed === 'number') {
                this.state.sessionSpins = myEntry.spinsUsed;
            }
            if (this.state.stats) {
                if (typeof myEntry.score === 'number') {
                    this.state.stats.sessionScore = myEntry.score;
                }
                if (typeof myEntry.spinsUsed === 'number') {
                    this.state.stats.sessionSpins = myEntry.spinsUsed;
                }
                if (typeof myEntry.jackpots === 'number') {
                    this.state.stats.sessionJackpots = myEntry.jackpots;
                }
            }
            if (this.ui) {
                this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, this.state.isSpinning, this.state.pickedCharacterHash);
            }
        }

        this.remainingSpins = myEntry ? myEntry.spinsLeft : 0;
        const canSpinNow = !finished && hasTwoPlayers && myEntry && myEntry.spinsLeft > 0 && activeHash === this.userHash;
        this.canSpin = canSpinNow;
        this._updateSpinAvailability();

        if (finished) {
            this._showPvpBanner(summary.winner);
        } else if (!hasTwoPlayers) {
            this._showPvpBanner(null, 'waiting');
        } else {
            this._hidePvpBanner();
        }
    }

    _showPvpBanner(winnerHash, mode = 'result') {
        if (!this.pvpBanner || !this.pvpBannerTitle) return;

        let title = '';
        let bannerClass = 'pvp-banner--neutral';

        if (mode === 'waiting') {
            title = 'Waiting for opponent...';
            bannerClass = 'pvp-banner--waiting';
            this.pvpResetBtn?.classList.add('is-hidden');
        } else {
            if (!winnerHash) {
                title = 'DRAW';
                bannerClass = 'pvp-banner--draw';
            } else if (winnerHash === this.userHash) {
                title = 'WIN';
                bannerClass = 'pvp-banner--win';
            } else {
                title = 'LOSS';
                bannerClass = 'pvp-banner--loss';
            }
            this.pvpResetBtn?.classList.remove('is-hidden');
        }

        this.pvpBanner.classList.remove('pvp-banner--win', 'pvp-banner--loss', 'pvp-banner--draw', 'pvp-banner--waiting');
        this.pvpBanner.classList.add(bannerClass);
        this.pvpBannerTitle.textContent = title;
        this.pvpBanner.classList.remove('is-hidden');
        if (this.pvpResetBtn) {
            this.pvpResetBtn.disabled = !this.userHash || mode === 'waiting';
        }
    }

    _hidePvpBanner() {
        if (!this.pvpBanner) return;
        this.pvpBanner.classList.add('is-hidden');
    }

    _buildActionPayload(extra = {}) {
        if (this.currentMode === 'pvp') {
            return {
                mode: 'pvp',
                room_id: this.roomId,
                slot_id: this.slotId,
                ...extra
            };
        }
        return {
            mode: 'single',
            ...extra
        };
    }

    // ---------------------------------------------------------------------
    // Controls & events
    // ---------------------------------------------------------------------

    _handleSpin(options = {}) {
        if (this.state.isSpinning) return;
        if (this.currentMode === 'pvp' && !this.canSpin) return;

        const isDemo = !!options.demoMode;
        this.state.isSpinning = true;
        this.ui.setSpinningState(true);
        this.ui.setFrameGlow(null);

        this._sendGameAction('spin', this._buildActionPayload({
            force_jackpot: options.forceJackpot || false,
            auto_credit: options.autoCredit || false,
            demo_mode: isDemo
        }));
    }

    _handleCardPick(e) {
        if (this.state.isSpinning) return;
        if (this.currentMode === 'pvp' && !this.canSpin) return;
        const card = e.target.closest('.character-card');
        if (!card) return;
        const hash = card.dataset.hash;
        this._sendGameAction('pick_card', this._buildActionPayload({ hash }));
    }

    _handleResize() {
        clearTimeout(this.resizeDebounceTimeout);
        this.resizeDebounceTimeout = setTimeout(() => this.ui && this.ui.recenterReels(), 100);
    }

    _scheduleAutoSpin() {
        clearTimeout(this.autoSpinTimer);
        if (this.currentMode === 'pvp' && !this.canSpin) return;
        this.autoSpinTimer = setTimeout(() => {
            if (!this.backdrop || this.state.isSpinning) return;
            if (this.currentMode === 'pvp' && !this.canSpin) return;
            this._handleSpin({ autoCredit: true });
        }, this.gameConfig.AUTO_SPIN_DELAY || 600);
    }

    _updateSpinAvailability() {
        if (!this.ui || !this.ui.spinBtn) return;
        const isSpinning = this.state.isSpinning;
        const canAfford = this.ui.spinBtn.dataset.canAfford !== '0';
        const shouldEnable = !isSpinning && (this.currentMode === 'single' ? canAfford : (this.canSpin && canAfford));

        this.ui.spinBtn.disabled = !shouldEnable;
        this.ui.spinBtn.classList.toggle('is-turn-blocked', this.currentMode === 'pvp' && !this.canSpin);
        this.backdrop?.querySelector('.slot-cost-indicator')?.classList.toggle('is-turn-locked', this.currentMode === 'pvp' && !this.canSpin);
    }

    _createSingleRoom(startOptions) {
        this.pendingStartOptions = startOptions || {};
        this.pendingMode = 'single';
        this._sendRaw({ type: 'create_room', data: { game_id: GAME_ID } });
    }

    _clearTimers() {
        clearTimeout(this.resizeDebounceTimeout);
        clearTimeout(this.autoSpinTimer);
        this.resizeDebounceTimeout = null;
        this.autoSpinTimer = null;
    }

    _registerGlobalTriggers() {
        document.getElementById('search-form')?.addEventListener('submit', (e) => {
            const searchBox = document.getElementById('search-box');
            if (searchBox && searchBox.value.trim() === '/jackpot') {
                e.preventDefault();
                searchBox.value = '';
                this.start({ autoSpin: true, forceJackpot: true });
            }
        });
    }
}

window.Yuuka.components['SlotMachineService'] = SlotMachineService;