// --- MODIFIED FILE: plugins/flip-card/static/flip_card.js ---
class FlipCardService {
    constructor(container, api) {
        this.api = api;
        this.container = container;

        this.characterPool = [];
        this.backdrop = null;
        this.grid = null;
        this.statsMoves = null;
        this.statsTime = null;
        this.statsAccuracy = null;
        this.streakNode = null;
        this.bestLabel = null;
        this.hintIndicator = null;
        this.hintButton = null;
        this.hintRemainingNode = null;
        this.winMessage = null;
        this.winStatsNode = null;
        this.winRatingNode = null;
        this.difficultyButtons = [];

        this.isGameActive = false;
        this.isChecking = false;
        this.hasStarted = false;
        this.flippedCards = [];
        this.matchedPairs = 0;
        this.totalPairs = 0;
        this.moves = 0;
        this.misses = 0;

        this.remainingHints = 0;
        this.timerInterval = null;
        this.timerStartedAt = null;
        this.elapsedMs = 0;

        this.currentDifficulty = 'normal';
        this.difficultyConfig = {
            easy: { rows: 3, cols: 4, pairs: 6, label: 'Easy', hintCharges: 3, cardSize: 150 },
            normal: { rows: 4, cols: 4, pairs: 8, label: 'Normal', hintCharges: 2, cardSize: 125 },
            hard: { rows: 4, cols: 5, pairs: 10, label: 'Hard', hintCharges: 1, cardSize: 115 }
        };

        this.bestScores = this._loadFromStorage('fc_best_scores');
        this.winStreaks = this._loadFromStorage('fc_win_streaks');
        this.winStreak = this.winStreaks[this.currentDifficulty] || 0;

        console.log('[Plugin:FlipCard] Service ready.');
    }

    async start() {
        if (this.backdrop) return;

        try {
            if (this.characterPool.length === 0) {
                const [charResponse, listsResponse] = await Promise.all([
                    this.api.getAllCharacters(),
                    this.api['character-list'].get('/lists')
                ]);
                const blacklist = new Set((listsResponse && listsResponse.blacklist) || []);
                this.characterPool = this._dedupeCharacters(charResponse.characters || [], blacklist);
            }

            if (this.characterPool.length < 4) {
                if (typeof showError === 'function') showError('Need at least 4 unique characters to start.');
                return;
            }

            this._initUI();
            this._updateDifficultyAvailability();
            this._setupNewGame();
        } catch (error) {
            if (typeof showError === 'function') showError(`Could not load flip-card data: ${error.message}`);
            console.error('[Plugin:FlipCard] Failed to start', error);
        }
    }

    _dedupeCharacters(characters, blacklist) {
        const unique = [], seenHashes = new Set();
        (characters || []).forEach(char => {
            if (!char || !char.hash || blacklist.has(char.hash) || seenHashes.has(char.hash)) return;
            seenHashes.add(char.hash);
            unique.push(char);
        });
        return unique;
    }

    _initUI() {
        if (this.backdrop) return;

        const difficultyButtonsHtml = Object.entries(this.difficultyConfig).map(([id, config]) => 
            `<button class="fc-difficulty-btn" type="button" data-difficulty="${id}"><span>${config.label}</span></button>`
        ).join('');

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'fc-backdrop';
        this.backdrop.innerHTML = `
            <div class="fc-panel">
                <button class="fc-close-btn" type="button"><span class="material-symbols-outlined">close</span></button>
                <div class="fc-header">
                    <div class="fc-scoreboard">
                        <div class="stat-item" data-stat="moves"><span class="material-symbols-outlined">swap_horiz</span><div class="stat-body"><span class="stat-label">Moves</span><span class="stat-value" id="fc-moves">0</span></div></div>
                        <div class="stat-item" data-stat="time"><span class="material-symbols-outlined">schedule</span><div class="stat-body"><span class="stat-label">Time</span><span class="stat-value" id="fc-time">00:00.0</span></div></div>
                        <div class="stat-item" data-stat="accuracy"><span class="material-symbols-outlined">target</span><div class="stat-body"><span class="stat-label">Accuracy</span><span class="stat-value" id="fc-accuracy">100%</span></div></div>
                    </div>
                    <div class="fc-difficulty-switcher">
                        <span class="fc-header-label">Difficulty</span>
                        <div class="fc-difficulty-group">${difficultyButtonsHtml}</div>
                    </div>
                </div>
                <div class="fc-grid-wrapper">
                    <div class="fc-grid"></div>
                    <div class="fc-win-message">
                        <div class="fc-win-card">
                            <h2>Victory!</h2><p id="fc-win-stats"></p>
                            <div id="fc-win-rating" class="fc-win-rating"></div>
                            <button id="fc-restart-btn" type="button">Play again</button>
                        </div>
                    </div>
                </div>
                <div class="fc-footer">
                    <div class="fc-control-group">
                        <div class="fc-hint-cluster">
                            <div class="fc-hint-indicator" data-state="ready" aria-live="polite" title="Hints left"><span class="material-symbols-outlined">lightbulb</span><span class="fc-hint-remaining">x0</span></div>
                            <button class="fc-action-btn fc-control-btn fc-hint-btn" type="button" disabled><span class="material-symbols-outlined">visibility</span><span>Use Hint</span></button>
                        </div>
                        <button class="fc-action-btn fc-control-btn fc-reset-btn" type="button"><span class="material-symbols-outlined">refresh</span><span>Shuffle</span></button>
                    </div>
                    <div class="fc-metrics">
                        <span id="fc-streak" class="fc-streak">Win streak: 0</span>
                        <span id="fc-best-score" class="fc-best-score">Best: --</span>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.backdrop);

        this.grid = this.backdrop.querySelector('.fc-grid');
        this.statsMoves = this.backdrop.querySelector('#fc-moves');
        this.statsTime = this.backdrop.querySelector('#fc-time');
        this.statsAccuracy = this.backdrop.querySelector('#fc-accuracy');
        this.streakNode = this.backdrop.querySelector('#fc-streak');
        this.bestLabel = this.backdrop.querySelector('#fc-best-score');
        this.hintIndicator = this.backdrop.querySelector('.fc-hint-indicator');
        this.hintButton = this.backdrop.querySelector('.fc-hint-btn');
        this.hintRemainingNode = this.backdrop.querySelector('.fc-hint-remaining');
        this.winMessage = this.backdrop.querySelector('.fc-win-message');
        this.winStatsNode = this.backdrop.querySelector('#fc-win-stats');
        this.winRatingNode = this.backdrop.querySelector('#fc-win-rating');

        this.difficultyButtons = Array.from(this.backdrop.querySelectorAll('.fc-difficulty-btn'));
        this.difficultyButtons.forEach(button => {
            const diff = button.dataset.difficulty;
            if (diff === this.currentDifficulty) button.classList.add('is-active');
            button.addEventListener('click', () => {
                if (diff === this.currentDifficulty) return;
                this.currentDifficulty = diff;
                this.difficultyButtons.forEach(btn => btn.classList.toggle('is-active', btn === button));
                this.winStreak = this.winStreaks[this.currentDifficulty] || 0;
                this._setupNewGame({ resetTimer: true });
            });
        });

        this.backdrop.querySelector('.fc-close-btn').addEventListener('click', () => this.close());
        this.backdrop.querySelector('.fc-reset-btn').addEventListener('click', () => this._setupNewGame({ preserveStreak: true }));
        this.backdrop.querySelector('#fc-restart-btn').addEventListener('click', () => {
            this.winMessage.classList.remove('is-visible');
            this._setupNewGame({ preserveStreak: true });
        });
        if (this.hintButton) this.hintButton.addEventListener('click', () => this._performHint());
    }

    _updateDifficultyAvailability() {
        const available = this.characterPool.length;
        this.difficultyButtons.forEach(button => {
            const config = this.difficultyConfig[button.dataset.difficulty];
            if (!config) return;
            const canPlay = available >= config.pairs;
            button.disabled = !canPlay;
            button.classList.toggle('is-disabled', !canPlay);
            if (!canPlay && button.dataset.difficulty === this.currentDifficulty) {
                this.currentDifficulty = 'easy';
                this.difficultyButtons.forEach(btn => btn.classList.toggle('is-active', btn.dataset.difficulty === this.currentDifficulty));
                this.winStreak = this.winStreaks[this.currentDifficulty] || 0;
            }
        });
    }

    _setupNewGame(options = {}) {
        const config = this.difficultyConfig[this.currentDifficulty] || this.difficultyConfig.normal;
        this.totalPairs = config.pairs;
        this.remainingHints = config.hintCharges;
        this.flippedCards = []; this.matchedPairs = 0; this.moves = 0; this.misses = 0;
        this.elapsedMs = 0; this.hasStarted = false; this.isChecking = false; this.isGameActive = true;
        this._stopTimer(true);
        if (!options.preserveStreak) this.winStreak = this.winStreaks[this.currentDifficulty] || 0;
        if (this.winMessage) this.winMessage.classList.remove('is-visible');
        if (this.grid) {
            this.grid.style.pointerEvents = 'auto';
            this.grid.innerHTML = '';
            this.grid.style.setProperty('--fc-cols', config.cols);
            this.grid.style.setProperty('--fc-rows', config.rows);
            this.grid.style.setProperty('--fc-card-size', `${config.cardSize}px`);
        }
        const selectedChars = this._pickUniqueCharacters(this.totalPairs);
        if (!selectedChars) { this.isGameActive = false; return; }
        const cards = this._buildCardElements(selectedChars);
        cards.forEach(card => this.grid.appendChild(card));
        this._updateStats(); this._updateHintButton(); this._updateStreakDisplay(); this._renderBestScore();
    }

    _pickUniqueCharacters(pairCount) {
        if (this.characterPool.length < pairCount) {
            if (typeof showError === 'function') showError(`Need ${pairCount} unique characters.`);
            return null;
        }
        const pool = [...this.characterPool], chosen = [];
        for (let i = 0; i < pairCount; i++) {
            const index = Math.floor(Math.random() * pool.length);
            chosen.push(pool.splice(index, 1)[0]);
        }
        return chosen;
    }

    _buildCardElements(characters) {
        const seeds = [...characters, ...characters].map((char, index) => ({ hash: char.hash, name: char.name || 'Unknown', uid: `${char.hash}-${index}` }));
        this._shuffle(seeds);
        return seeds.map(seed => this._createCard(seed));
    }

    _createCard(seed) {
        const card = document.createElement('button');
        card.type = 'button'; card.className = 'fc-card'; card.dataset.hash = seed.hash;
        card.setAttribute('aria-label', `Card for ${seed.name}`);
        card.innerHTML = `
            <div class="fc-card-inner">
                <div class="fc-card-front"><img src="/image/${seed.hash}" alt="${seed.name}" loading="lazy"></div>
                <div class="fc-card-back"><span class="material-symbols-outlined">help</span></div>
            </div>`;
        card.addEventListener('click', () => this._handleCardClick(card));
        return card;
    }

    _handleCardClick(cardEl) {
        if (!this.isGameActive || this.isChecking || cardEl.classList.contains('is-flipped') || cardEl.classList.contains('is-matched')) return;
        if (!this.hasStarted) { this.hasStarted = true; this._startTimer(); }
        cardEl.classList.add('is-flipped');
        this.flippedCards.push(cardEl);
        if (this.flippedCards.length === 2) {
            this.isChecking = true; this.moves++; this._updateStats();
            this._checkForMatch();
        }
    }

    _checkForMatch() {
        const [first, second] = this.flippedCards;
        if (first.dataset.hash === second.dataset.hash) {
            this.matchedPairs++;
            first.classList.add('is-matched'); second.classList.add('is-matched');
            first.disabled = true; second.disabled = true;
            this.flippedCards = []; this.isChecking = false; this._updateStats();
            if (this.matchedPairs === this.totalPairs) this._handleWin();
        } else {
            this.misses++;
            first.classList.add('is-mismatch'); second.classList.add('is-mismatch');
            setTimeout(() => {
                first.classList.remove('is-flipped', 'is-mismatch');
                second.classList.remove('is-flipped', 'is-mismatch');
                this.flippedCards = []; this.isChecking = false; this._updateStats();
            }, 700);
        }
        this._updateHintButton();
    }

    _handleWin() {
        this.isGameActive = false; this.grid.style.pointerEvents = 'none'; this._stopTimer();
        this.winStreak++; this.winStreaks[this.currentDifficulty] = this.winStreak;
        this._saveToStorage('fc_win_streaks', this.winStreaks);
        const accuracy = this._getAccuracy();
        const config = this.difficultyConfig[this.currentDifficulty];
        const statsMessage = `${config.label} - ${this.moves} moves - ${this._formatTime(this.elapsedMs)} - ${accuracy}% accuracy`;
        if (this.winStatsNode) this.winStatsNode.textContent = statsMessage;
        const rating = this._calculateRating();
        this._renderRating(rating);
        if (this._updateBestScore()) this._renderBestScore();
        this._updateStreakDisplay();
        if (this.winMessage) this.winMessage.classList.add('is-visible');
    }

    _calculateRating() {
        const config = this.difficultyConfig[this.currentDifficulty];
        if (!config || this.moves === 0) return 1;
        const idealMoves = config.pairs;
        const moveScore = Math.min(idealMoves / Math.max(this.moves, idealMoves), 1);
        const targetTimeMs = config.pairs * 15000;
        const timeScore = Math.min(targetTimeMs / Math.max(this.elapsedMs, targetTimeMs), 1);
        const accuracyScore = this._getAccuracy() / 100;
        const totalScore = (moveScore * 0.4) + (timeScore * 0.3) + (accuracyScore * 0.3);
        return Math.max(1, Math.min(5, Math.round(totalScore * 5)));
    }

    _renderRating(stars) {
        if (!this.winRatingNode) return;
        const starIcons = Array.from({ length: 5 }, (_, i) => `<span class="material-symbols-outlined ${i < stars ? 'is-active' : ''}">${i < stars ? 'grade' : 'star'}</span>`).join('');
        let caption = 'Keep practicing!';
        if (stars >= 5) caption = 'Perfect memory!'; else if (stars === 4) caption = 'Amazing!'; else if (stars === 3) caption = 'Solid run!';
        this.winRatingNode.innerHTML = `<div class="fc-rating-stars">${starIcons}</div><span class="fc-rating-caption">${caption}</span>`;
    }

    _performHint() {
        if (!this.isGameActive || this.isChecking || this.flippedCards.length > 0 || this.remainingHints <= 0) return;
        this.remainingHints--; this.isChecking = true;
        this.grid.classList.add('is-showing-hint');
        const hiddenCards = Array.from(this.grid.querySelectorAll('.fc-card:not(.is-matched)'));
        hiddenCards.forEach(card => card.classList.add('is-temporary'));
        setTimeout(() => {
            hiddenCards.forEach(card => card.classList.remove('is-temporary'));
            this.grid.classList.remove('is-showing-hint');
            this.isChecking = false; this._updateHintButton();
        }, 900);
        this._updateHintButton();
    }

    _updateStats() {
        if (this.statsMoves) this.statsMoves.textContent = this.moves.toString();
        if (this.statsTime) this.statsTime.textContent = this._formatTime(this.elapsedMs);
        if (this.statsAccuracy) this.statsAccuracy.textContent = `${this._getAccuracy()}%`;
    }

    _updateHintButton() {
        const canUse = this.isGameActive && !this.isChecking && this.flippedCards.length === 0 && this.remainingHints > 0;
        if (this.hintButton) { this.hintButton.disabled = !canUse; this.hintButton.classList.toggle('is-ready', canUse); }
        if (this.hintIndicator) { this.hintIndicator.classList.toggle('is-empty', this.remainingHints <= 0); this.hintIndicator.dataset.state = this.remainingHints > 0 ? 'ready' : 'empty'; }
        if (this.hintRemainingNode) this.hintRemainingNode.textContent = `x${this.remainingHints}`;
    }

    _updateBestScore() {
        const difficulty = this.currentDifficulty;
        const current = { moves: this.moves, timeMs: this.elapsedMs };
        const best = this.bestScores[difficulty];
        if (!best || current.moves < best.moves || (current.moves === best.moves && current.timeMs < best.timeMs)) {
            this.bestScores[difficulty] = current; this._saveToStorage('fc_best_scores', this.bestScores);
            return true;
        }
        return false;
    }

    _renderBestScore() {
        if (!this.bestLabel) return;
        const best = this.bestScores[this.currentDifficulty];
        this.bestLabel.textContent = best ? `Best: ${best.moves} moves - ${this._formatTime(best.timeMs)}` : 'Best: --';
    }

    _updateStreakDisplay() {
        if (!this.streakNode) return;
        this.streakNode.textContent = `Win streak: ${this.winStreak || 0}`;
        this.streakNode.classList.toggle('is-hot', this.winStreak >= 3);
    }

    _getAccuracy() { return this.moves === 0 ? 100 : Math.max(0, Math.min(100, Math.round((this.matchedPairs / this.moves) * 100))); }
    _startTimer() { if (this.timerInterval) return; this.timerStartedAt = performance.now() - this.elapsedMs; this.timerInterval = setInterval(() => { this.elapsedMs = performance.now() - this.timerStartedAt; this._updateStats(); }, 100); }
    _stopTimer(reset = false) { clearInterval(this.timerInterval); this.timerInterval = null; if (reset) this.elapsedMs = 0; }
    _formatTime(ms) { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`; }
    _shuffle(list) { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[list[i], list[j]] = [list[j], list[i]]; } }
    _loadFromStorage(key) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : {}; } catch (e) { return {}; } }
    _saveToStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Could not save to storage'); } }
    
    close() {
        this._stopTimer(true);
        if (this.backdrop) this.backdrop.remove();
        this.backdrop = null;
    }
}

window.Yuuka.components['FlipCardService'] = FlipCardService;