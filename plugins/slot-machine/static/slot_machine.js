// --- MODIFIED FILE: plugins/slot-machine/static/slot_machine.js ---
// Yuuka: Slot Machine plugin refactor v1.0

class SlotMachineService {
    constructor(container, api) {
        this.api = api;
        this.characterPool = [];
        this.backdrop = null;
        this.spinBtn = null;
        this.reelsContainer = null;
        this.resolvePromise = null;
        this.isSpinning = false;
        this.jackpotInterval = null;
        this.frame = null;
        this.glowTimeout = null;
        this.costIndicator = null;
        this.freeSpins = 0;
        this.freeSpinsOnEmpty = 3;
        this.scoreMap = {
            NORMAL_WIN_2_KIND: 10, NORMAL_WIN_3_SCATTER_1_MID: 30,
            NORMAL_WIN_3_SCATTER_2_MID: 50, NORMAL_WIN_3_LINE: 120,
            NORMAL_WIN_BIG_JACKPOT: 500, PICKED_PENALTY_NO_SHOW: -20,
            PICKED_BONUS_ONE_SHOW: 40, PICKED_BONUS_2_SCATTER: 60,
            PICKED_BONUS_3_SCATTER: 100, PICKED_MULTIPLIER_2_KIND: 10,
            PICKED_MULTIPLIER_3_SCATTER: 10, PICKED_MULTIPLIER_3_LINE: 10,
            PICKED_MULTIPLIER_BIG_JACKPOT: 20,
        };
        this.winTypeNames = {
            '2_KIND': 'DOUBLE', '3_SCATTER': 'TRIPLE', '3_LINE': 'LINE',
            'BIG_JACKPOT': 'JACKPOT!', 'PICKED_BONUS_ONE_SHOW': 'LUCKY PICK',
            'PICKED_BONUS_2_SCATTER': 'DOUBLE PICK', 'PICKED_BONUS_3_SCATTER': 'TRIPLE PICK',
            'PICKED_PENALTY_NO_SHOW': 'MISS'
        };
        this.spinCost = 10;
        this.rowCount = 3; this.symbolsPerRow = 21;
        this.spinDurationBase = 4000; this.cardWidth = 150; this.cardMargin = 16;
        this.currentRowTargetIndices = []; this.resizeDebounceTimeout = null;
        this._handleResize = this._handleResize.bind(this);
        this.reelCharacters = []; this.pickedCharacterHash = null;
        this.sessionSpins = 0; this.sessionScore = 0; this.sessionJackpots = 0;
        this.totalSpins = parseInt(localStorage.getItem('yuuka-slot-total-spins') || '0', 10);
        this.highScore = parseInt(localStorage.getItem('yuuka-slot-high-score') || '0', 10);
        this.totalJackpots = parseInt(localStorage.getItem('yuuka-slot-total-jackpots') || '0', 10);

        // Yuuka: Logic initialization moved to constructor v1.0
        console.log("[Plugin:SlotMachine] Service initialized, registering global triggers.");
        
        // Trigger 1: Lệnh /jackpot
        document.getElementById('search-form').addEventListener('submit', (e) => {
            const searchBox = document.getElementById('search-box');
            if (searchBox.value.trim() === '/jackpot') {
                e.preventDefault();
                searchBox.value = '';
                this.start({ autoSpin: true, forceJackpot: true, demoMode: true });
            }
        });
        
        // Trigger 2: Double click vào container chính
        document.querySelector('.container').addEventListener('dblclick', async (e) => {
             if (e.target.closest('.plugin-container')) {
                 this.start();
             }
        });

        // Yuuka: navibar auto-init v1.0 - Gỡ bỏ việc đăng ký nút thủ công
    }

    // Yuuka: plugin refactor v1.0 - async start()
    async start(options = {}) {
        if (this.backdrop) return; // Đang chạy rồi thì thôi

        // Yuuka: session state reset v1.0
        this.sessionSpins = 0;
        this.sessionScore = 0;
        this.sessionJackpots = 0;

        try {
            const [charResponse, listsResponse] = await Promise.all([
                this.api.getAllCharacters(),
                this.api['character-list'].get('/lists') // Yuuka: api fix v1.1 - Sửa lại lời gọi API
            ]);
            
            const allCharacters = charResponse.characters;
            const blacklist = listsResponse.blacklist || [];
            const blacklistedHashes = new Set(blacklist);
            
            // Hiện tại chỉ dùng 1 pool nhân vật mặc định
            this.characterPool = allCharacters.filter(c => !blacklistedHashes.has(c.hash));

            const MIN_CHARS = 20;
            if (this.characterPool.length < MIN_CHARS) {
                showError(`Cần ít nhất ${MIN_CHARS} nhân vật để chơi.`);
                return;
            }

        } catch (error) {
            showError(`Lỗi khi tải dữ liệu game: ${error.message}`);
            console.error(error);
            return;
        }


        return new Promise(resolve => {
            const { autoSpin = false, forceJackpot = false, demoMode = false } = options;
            
            this.resolvePromise = resolve;
            this.freeSpins = 5;
            this._initUI();
            this.spinBtn.disabled = true;
            
            this._prepareInitialRows();
            this._updateControlsDisplay();
            
            window.addEventListener('resize', this._handleResize);

            if (autoSpin) {
                setTimeout(() => {
                    this._handleSpin({ forceJackpot, demoMode });
                }, 1100); 
            } else {
                 setTimeout(() => {
                    this.spinBtn.disabled = false;
                    this._updateControlsDisplay();
                }, 1000);
            }
        });
    }
    
    _initUI() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'slot-machine-backdrop';
        
        let rowsHTML = '';
        for (let i = 0; i < this.rowCount; i++) {
            rowsHTML += `<div class="slot-row" data-row-index="${i}"></div>`;
        }
        
        this.backdrop.innerHTML = `
             <div class="slot-score-popup-container"></div>
             <div class="slot-stats">
                <div id="stat-score" class="stat-item" title="Điểm (Hiện tại/Cao nhất)">
                    <span class="material-symbols-outlined">military_tech</span>
                    <span class="stat-value"><span id="slot-score-session">0</span>/<span id="slot-score-high">0</span></span>
                    <span class="stat-delta"></span>
                </div>
                <div id="stat-jackpots" class="stat-item" title="Jackpot (Phiên này/Tổng)">
                    <span class="material-symbols-outlined">emoji_events</span>
                    <span class="stat-value"><span id="slot-jackpots-session">0</span>/<span id="slot-jackpots-total">0</span></span>
                    <span class="stat-delta"></span>
                </div>
                <div id="stat-spins" class="stat-item" title="Lượt quay (Phiên này/Tổng)">
                    <span class="material-symbols-outlined">replay</span>
                    <span class="stat-value"><span id="slot-spins-session">0</span>/<span id="slot-spins-total">0</span></span>
                    <span class="stat-delta"></span>
                </div>
             </div>
             <div class="slot-machine-reels-container">
                ${rowsHTML}
                <div class="slot-machine-frame"></div>
             </div>
             <div class="slot-controls">
                <div class="slot-cost-indicator">
                    <div data-type="cost">
                        <span class="material-symbols-outlined">military_tech</span>
                        <span class="cost-value">${this.spinCost}</span>
                    </div>
                    <div data-type="free">
                        <span class="material-symbols-outlined">redeem</span>
                        <span class="free-spin-value">0</span>
                    </div>
                </div>
                <button class="slot-spin-btn" title="Spin">
                    <span class="material-symbols-outlined">casino</span>
                </button>
             </div>
             <button class="slot-close-btn"><span class="material-symbols-outlined">close</span></button>
        `;

        document.body.appendChild(this.backdrop);
        
        this.spinBtn = this.backdrop.querySelector('.slot-spin-btn');
        this.frame = this.backdrop.querySelector('.slot-machine-frame');
        this.reelsContainer = this.backdrop.querySelector('.slot-machine-reels-container'); 
        this.costIndicator = this.backdrop.querySelector('.slot-cost-indicator');
        
        this.spinBtn.addEventListener('click', () => this._handleSpin());
        this.backdrop.querySelector('.slot-close-btn').addEventListener('click', () => this.close());
        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) this.close();
        });
        this.reelsContainer.addEventListener('click', this._handleCardPick.bind(this));
        
        this._updateStatsDisplay();
    }

    _updateControlsDisplay() {
        if (!this.costIndicator) return;
        const costEl = this.costIndicator.querySelector('[data-type="cost"]');
        const freeEl = this.costIndicator.querySelector('[data-type="free"]');
        const freeSpinValueEl = freeEl.querySelector('.free-spin-value');

        this.backdrop.querySelector('.slot-controls').classList.toggle('has-picked-card', !!this.pickedCharacterHash);

        if (this.freeSpins > 0) {
            costEl.classList.remove('is-visible');
            freeEl.classList.add('is-visible');
            freeSpinValueEl.textContent = this.freeSpins;

            const requiredFreeSpins = this.pickedCharacterHash ? 2 : 1;
            this.spinBtn.disabled = this.isSpinning || (this.freeSpins < requiredFreeSpins);
        } else {
            costEl.classList.add('is-visible');
            freeEl.classList.remove('is-visible');
            
            this.spinBtn.disabled = this.isSpinning || (this.sessionScore < this.spinCost);
        }
    }
    
    _handleCardPick(e) {
        if (this.isSpinning) return;
        const card = e.target.closest('.character-card');
        if (!card) return;

        const hash = card.dataset.hash;
        this.pickedCharacterHash = (this.pickedCharacterHash === hash) ? null : hash;
        this._updateHighlights();
        this._updateControlsDisplay();
    }
    
    _updateHighlights() {
        if (!this.reelsContainer) return;
        const allCards = this.reelsContainer.querySelectorAll('.character-card');
        
        this.reelsContainer.classList.toggle('has-picked-card', !!this.pickedCharacterHash);

        allCards.forEach(card => {
            const isPicked = this.pickedCharacterHash && card.dataset.hash === this.pickedCharacterHash;
            card.classList.toggle('is-picked', isPicked);
        });
    }

    _handleSpin(options = {}) {
        if (this.isSpinning) return;
        
        const { forceJackpot = false, demoMode = false } = options;
        let wasFreeSpin = false;

        if (!demoMode) {
            let freeSpinsToUse = 0;
            let pointsToUse = 0;
            let canSpin = false;
    
            if (this.freeSpins > 0) {
                const requiredFreeSpins = this.pickedCharacterHash ? 2 : 1;
                if (this.freeSpins >= requiredFreeSpins) {
                    canSpin = true;
                    freeSpinsToUse = requiredFreeSpins;
                    wasFreeSpin = true;
                }
            } else {
                if (this.sessionScore >= this.spinCost) {
                    canSpin = true;
                    pointsToUse = this.spinCost;
                }
            }
    
            if (!canSpin && this.sessionScore < this.spinCost && this.freeSpins === 0) {
                 this.freeSpins += this.freeSpinsOnEmpty;
                 showError(`Bạn đã hết điểm! Tặng ${this.freeSpinsOnEmpty} lượt quay miễn phí.`);
                 this._updateControlsDisplay();
                 this._updateStatsDisplay();
                 return;
            }

            if (!canSpin) {
                 this._updateControlsDisplay();
                 return;
            }
            
            this.isSpinning = true;
            this.spinBtn.disabled = true;
            this.spinBtn.querySelector('.material-symbols-outlined').textContent = 'sync';
            this._setFrameGlow(null);
            if (this.reelsContainer) {
                this.reelsContainer.querySelectorAll('.character-card').forEach(card => {
                    card.className = card.className.replace(/\bis-winning-card-\w+\b/g, '');
                });
            }

            this.freeSpins -= freeSpinsToUse;
            this.sessionScore -= pointsToUse;
            this.sessionSpins++;
            this.totalSpins++;
            
            this._showStatDelta('spins', '+1');
            if (pointsToUse > 0) this._showStatDelta('score', `-${pointsToUse}`);
            
            this._updateStatsDisplay();
            this._updateControlsDisplay();

        } else {
             this.isSpinning = true;
             this.spinBtn.disabled = true;
             this.spinBtn.querySelector('.material-symbols-outlined').textContent = 'sync';
             this._setFrameGlow(null);
        }

        const charactersForSpin = this.reelCharacters;
        const finalResults = this._determineFinalResults(charactersForSpin, forceJackpot);
        
        this._spin(charactersForSpin, finalResults, demoMode, wasFreeSpin);
    }
    
    _spin(charactersForSpin, finalResults, demoMode = false, wasFreeSpin = false) {
        const pickedBeforeSpin = this.pickedCharacterHash;
        this._updateHighlights();

        const rows = this.backdrop.querySelectorAll('.slot-row');
        const totalCardWidth = this.cardWidth + this.cardMargin;
        const finalCardIndices = []; 

        const spinPromises = Array.from(rows).map((row, i) => {
            return new Promise(resolve => {
                const rowChars = charactersForSpin[i];
                const finalChar = finalResults[i];
                const fullStripChars = [...rowChars, ...rowChars, ...rowChars];
                
                let finalCardIndex = rowChars.findIndex(c => c.hash === finalChar.hash);
                if (finalCardIndex === -1) finalCardIndex = 0;
                finalCardIndices[i] = finalCardIndex; 
                
                const targetIndexInStrip = finalCardIndex + this.symbolsPerRow;
                this.currentRowTargetIndices[i] = targetIndexInStrip;

                row.innerHTML = fullStripChars.map(c => this._createCardHTML(c, pickedBeforeSpin)).join('');
                
                const targetCardCenter = (targetIndexInStrip * totalCardWidth) + (totalCardWidth / 2);
                const finalPosition = (window.innerWidth / 2) - targetCardCenter;

                requestAnimationFrame(() => {
                    row.style.transition = 'none';
                    const middleIndex = Math.floor(this.symbolsPerRow / 2);
                    const startCardCenter = (middleIndex * totalCardWidth) + (totalCardWidth / 2);
                    const startPosition = (window.innerWidth / 2) - startCardCenter;
                    row.style.transform = `translateX(${startPosition}px)`;

                    requestAnimationFrame(() => {
                        const spinDuration = this.spinDurationBase + i * 500;
                        row.style.transition = `transform ${spinDuration}ms cubic-bezier(0.25, 1, 0.5, 1)`;
                        row.style.transform = `translateX(${finalPosition}px)`;
                        setTimeout(resolve, spinDuration);
                    });
                });
            });
        });

        Promise.all(spinPromises).then(() => {
            this._calculateAndShowScore(finalCardIndices, charactersForSpin, demoMode, pickedBeforeSpin, wasFreeSpin);

            this.isSpinning = false;
            this.pickedCharacterHash = null;
            this._updateHighlights();
            
            if (!demoMode) {
                if (this.sessionScore <= 0 && this.freeSpins === 0) {
                    this.freeSpins += this.freeSpinsOnEmpty;
                    showError(`Bạn đã hết điểm! Tặng ${this.freeSpinsOnEmpty} lượt quay miễn phí.`);
                    this._updateStatsDisplay();
                }

                this.spinBtn.querySelector('.material-symbols-outlined').textContent = 'casino';
                this._updateControlsDisplay();
            }
        });
    }

    _selectCharacters() {
        const availableChars = [...this.characterPool];
        const selectedChars = new Set();
        
        const targetSize = Math.min(this.symbolsPerRow, availableChars.length);
        while(selectedChars.size < targetSize && availableChars.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableChars.length);
            selectedChars.add(availableChars.splice(randomIndex, 1)[0]);
        }
        const baseRowSet = Array.from(selectedChars);

        const rowCharacters = [];
        for (let i = 0; i < this.rowCount; i++) {
            const shuffledRow = [...baseRowSet].sort(() => Math.random() - 0.5);
            rowCharacters.push(shuffledRow);
        }
        return rowCharacters;
    }

    _determineFinalResults(charactersForSpin, forceJackpot) {
        if (forceJackpot) {
            const jackpotChar = this.characterPool[Math.floor(Math.random() * this.characterPool.length)];
            return [jackpotChar, jackpotChar, jackpotChar];
        } else {
            return charactersForSpin.map(rowChars => rowChars.length > 0 ? rowChars[Math.floor(Math.random() * rowChars.length)] : null);
        }
    }
    
    _calculateAndShowScore(finalCardIndices, reelCharacters, demoMode = false, pickedCharacterHash, wasFreeSpin = false) {
        const grid = [];
        const allCoords = [];
        for (let r = 0; r < 3; r++) {
            const rowChars = reelCharacters[r];
            const centerIndex = finalCardIndices[r];
            const prevIndex = (centerIndex - 1 + rowChars.length) % rowChars.length;
            const nextIndex = (centerIndex + 1) % rowChars.length;
            grid[r] = [rowChars[prevIndex], rowChars[centerIndex], rowChars[nextIndex]];
            for (let c = 0; c < 3; c++) allCoords.push([r, c]);
        }
        
        let highestWinType = 'none';
        const processedCoords = new Set();
        const baseWins = [];
        const winningCoords = new Set();

        const midColChars = [grid[0][1], grid[1][1], grid[2][1]];
        if (midColChars.every(c => c && c.hash === midColChars[0].hash)) {
            baseWins.push({ type: 'BIG_JACKPOT', hash: midColChars[0].hash, score: this.scoreMap.NORMAL_WIN_BIG_JACKPOT });
            ['0,1', '1,1', '2,1'].forEach(c => { processedCoords.add(c); winningCoords.add(c); });
            highestWinType = 'jackpot';
        }

        const lines = [[[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]], [[0, 0], [1, 0], [2, 0]], [[0, 2], [1, 2], [2, 2]], [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]]];
        for (const line of lines) {
            const lineCoordsStr = line.map(c => c.join(','));
            if (lineCoordsStr.some(c => processedCoords.has(c))) continue;
            const chars = line.map(([r, c]) => grid[r][c]);
            if (chars.every(c => c && c.hash === chars[0].hash)) {
                baseWins.push({ type: '3_LINE', hash: chars[0].hash, score: this.scoreMap.NORMAL_WIN_3_LINE });
                lineCoordsStr.forEach(c => { processedCoords.add(c); winningCoords.add(c); });
                if (highestWinType !== 'jackpot') highestWinType = 'nearmiss';
            }
        }

        const remainingCoordsForScatter = allCoords.filter(([r, c]) => !processedCoords.has(`${r},${c}`));
        const charCounts = remainingCoordsForScatter.reduce((acc, [r, c]) => { const char = grid[r][c]; if (char) { if (!acc[char.hash]) acc[char.hash] = { count: 0, midCols: 0, coords: [] }; acc[char.hash].count++; acc[char.hash].coords.push(`${r},${c}`); if (c === 1) acc[char.hash].midCols++; } return acc; }, {});
        for (const hash in charCounts) {
            if (charCounts[hash].count === 3) {
                const score = charCounts[hash].midCols === 2 ? this.scoreMap.NORMAL_WIN_3_SCATTER_2_MID : this.scoreMap.NORMAL_WIN_3_SCATTER_1_MID;
                baseWins.push({ type: '3_SCATTER', hash, score });
                charCounts[hash].coords.forEach(c => { processedCoords.add(c); winningCoords.add(c); });
                if (highestWinType === 'none') highestWinType = 'normal-win';
            }
        }
        
        let coordsForPairCheck = allCoords.filter(([r, c]) => !processedCoords.has(`${r},${c}`));
        const adjacencyDeltas = [[0, 1], [1, 0], [1, 1], [1, -1]];
        while (coordsForPairCheck.length > 0) {
            const [r1, c1] = coordsForPairCheck.shift();
            const char1 = grid[r1][c1];
            if (!char1) continue;
            for (const [dr, dc] of adjacencyDeltas) {
                const r2 = r1 + dr, c2 = c1 + dc;
                const neighborIndex = coordsForPairCheck.findIndex(([nr, nc]) => nr === r2 && nc === c2);
                if (neighborIndex !== -1) {
                    const char2 = grid[r2][c2];
                    if (char2 && char1.hash === char2.hash) {
                        baseWins.push({ type: '2_KIND', hash: char1.hash, score: this.scoreMap.NORMAL_WIN_2_KIND });
                        if (highestWinType === 'none') highestWinType = 'normal-win';
                        const coord1Str = `${r1},${c1}`, coord2Str = `${r2},${c2}`;
                        processedCoords.add(coord1Str).add(coord2Str); winningCoords.add(coord1Str).add(coord2Str);
                        coordsForPairCheck.splice(neighborIndex, 1);
                        break;
                    }
                }
            }
        }
        
        let totalScoreForTurn = 0;
        const eventsToDisplay = [];

        baseWins.forEach(win => {
            totalScoreForTurn += win.score;
            eventsToDisplay.push({
                text: this.winTypeNames[win.type] || '',
                score: win.score,
                type: highestWinType === 'jackpot' ? 'jackpot' : (highestWinType === 'nearmiss' ? 'nearmiss' : 'normal')
            });
        });

        if (pickedCharacterHash && !demoMode) {
            let bonusInfo = { score: 0, type: null, text: '' };
            const pickedWins = baseWins.filter(win => win.hash === pickedCharacterHash);
            
            if (pickedWins.length > 0) { 
                const highestPickedWin = pickedWins.sort((a,b) => b.score - a.score)[0];
                let multiplier = 1;
                switch (highestPickedWin.type) {
                    case 'BIG_JACKPOT': multiplier = this.scoreMap.PICKED_MULTIPLIER_BIG_JACKPOT; break;
                    case '3_LINE':      multiplier = this.scoreMap.PICKED_MULTIPLIER_3_LINE; break;
                    case '3_SCATTER':   multiplier = this.scoreMap.PICKED_MULTIPLIER_3_SCATTER; break;
                    case '2_KIND':      multiplier = this.scoreMap.PICKED_MULTIPLIER_2_KIND; break;
                }
                bonusInfo.score = highestPickedWin.score * (multiplier - 1);
                bonusInfo.type = `PICKED_MULTIPLIER_${highestPickedWin.type}`;
                bonusInfo.text = `PICK x${multiplier}`;
            } else { 
                const pickedCountInGrid = allCoords.filter(([r, c]) => grid[r][c]?.hash === pickedCharacterHash).length;
                if (pickedCountInGrid === 3) { bonusInfo = { score: this.scoreMap.PICKED_BONUS_3_SCATTER, type: 'PICKED_BONUS_3_SCATTER' }; }
                else if (pickedCountInGrid === 2) { bonusInfo = { score: this.scoreMap.PICKED_BONUS_2_SCATTER, type: 'PICKED_BONUS_2_SCATTER' }; }
                else if (pickedCountInGrid === 1) { bonusInfo = { score: this.scoreMap.PICKED_BONUS_ONE_SHOW, type: 'PICKED_BONUS_ONE_SHOW' }; }
                else if (pickedCountInGrid === 0 && !wasFreeSpin) { bonusInfo = { score: this.scoreMap.PICKED_PENALTY_NO_SHOW, type: 'PICKED_PENALTY_NO_SHOW' }; }
                
                if(bonusInfo.type) bonusInfo.text = this.winTypeNames[bonusInfo.type] || '';
            }

            if(bonusInfo.score !== 0) {
                totalScoreForTurn += bonusInfo.score;
                eventsToDisplay.push({
                    text: bonusInfo.text,
                    score: bonusInfo.score,
                    type: bonusInfo.score > 0 ? 'normal' : 'penalty'
                });
            }
        }

        if (eventsToDisplay.length > 0) {
            eventsToDisplay.forEach((event, index) => {
                setTimeout(() => {
                    this._showScorePopup(event.text, event.score, event.type);
                }, index * 400);
            });
             if (!demoMode) this._showStatDelta('score', totalScoreForTurn > 0 ? `+${totalScoreForTurn}` : totalScoreForTurn);
        }

        if (highestWinType !== 'none') {
             this._setFrameGlow(highestWinType, highestWinType === 'jackpot' ? null : 2400);
        }

        if (highestWinType !== 'none' && winningCoords.size > 0) {
            const rows = this.backdrop.querySelectorAll('.slot-row');
            const winningClass = `is-winning-card-${highestWinType}`;
            winningCoords.forEach(coordStr => {
                const [r, c] = coordStr.split(',').map(Number);
                const centerIndexInStrip = finalCardIndices[r] + reelCharacters[r].length;
                const cardDomIndex = centerIndexInStrip + (c - 1);
                const winningCard = rows[r]?.children[cardDomIndex];
                if (winningCard) winningCard.classList.add(winningClass);
            });
        }

        if (!demoMode) {
            this.sessionScore += totalScoreForTurn;
            this.sessionScore = Math.max(0, this.sessionScore);

            if (this.sessionScore > this.highScore) {
                this.highScore = this.sessionScore;
                localStorage.setItem('yuuka-slot-high-score', this.highScore);
            }

            if (highestWinType === 'jackpot') {
                this.sessionJackpots++;
                this.totalJackpots++;
                this._showStatDelta('jackpots', '+1');
                this._triggerJackpotAnimation(grid[1][1], demoMode);
            }
            localStorage.setItem('yuuka-slot-total-spins', this.totalSpins);
            localStorage.setItem('yuuka-slot-total-jackpots', this.totalJackpots);
            this._updateStatsDisplay();
        }
    }


    _showScorePopup(text, score, type) {
        if (!this.backdrop || !text) return;
        const container = this.backdrop.querySelector('.slot-score-popup-container');
        if (!container) return;

        const popup = document.createElement('div');
        popup.className = 'slot-score-popup';

        const inner = document.createElement('div');
        inner.className = `popup-inner score-popup--${type}`;
        
        const scoreText = score > 0 ? `+${score}` : `${score}`;
        
        inner.innerHTML = `
            <div class="popup-text">${text}</div>
            <div class="popup-score">${scoreText}</div>
        `;
        
        popup.appendChild(inner);
        container.appendChild(popup);
        
        const offsetX = (Math.random() - 0.5) * 200;
        const offsetY = (Math.random() - 0.5) * 80;
        popup.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        
        const scoreEl = inner.querySelector('.popup-score');
        if (scoreEl) {
            const scoreOffsetX = (Math.random() - 0.5) * 80;
            const scoreOffsetY = (Math.random() - 0.5) * 60;
            scoreEl.style.transform = `translate(calc(-50% + ${scoreOffsetX}px), calc(-50% + ${scoreOffsetY}px))`;
        }
        
        const duration = type === 'jackpot' ? 10000 : 2000;
        
        setTimeout(() => {
            popup.remove();
        }, duration);
    }

    _createCardHTML(char, pickedHash) {
        const isPickedClass = (pickedHash && char.hash === pickedHash) ? 'is-picked' : '';
        return `
            <div class="character-card ${isPickedClass}" data-hash="${char.hash}">
                <div class="image-container">
                    <img src="/image/${char.hash}" alt="${char.name}" loading="lazy">
                </div>
                <div class="name">${char.name}</div>
            </div>`;
    }

    _prepareInitialRows() {
        const rows = this.backdrop.querySelectorAll('.slot-row');
        this.reelCharacters = this._selectCharacters();
        const totalCardWidth = this.cardWidth + this.cardMargin;
        
        rows.forEach((row, i) => {
            const rowChars = this.reelCharacters[i];
            row.innerHTML = [...rowChars, ...rowChars].map(c => this._createCardHTML(c, this.pickedCharacterHash)).join('');
            
            const middleIndex = Math.floor(this.symbolsPerRow / 2);
            this.currentRowTargetIndices[i] = middleIndex;
            
            const targetCardCenter = (middleIndex * totalCardWidth) + (totalCardWidth / 2);
            const targetPos = (window.innerWidth / 2) - targetCardCenter;
            
            const startPos = i % 2 === 0 ? -window.innerWidth - 200 : window.innerWidth + 200;
            
            row.style.transition = 'none';
            row.style.transform = `translateX(${startPos}px)`;

            setTimeout(() => {
                row.style.transition = 'transform 1000ms cubic-bezier(0.25, 1, 0.5, 1)';
                row.style.transform = `translateX(${targetPos}px)`;
            }, 50);
        });
    }
    
    _recenterRows() {
        if (!this.backdrop) return;
        const rows = this.backdrop.querySelectorAll('.slot-row');
        const totalCardWidth = this.cardWidth + this.cardMargin;

        rows.forEach((row, i) => {
            const targetIndex = this.currentRowTargetIndices[i];
            if (targetIndex === undefined) return;

            const targetCardCenter = (targetIndex * totalCardWidth) + (totalCardWidth / 2);
            const newPosition = (window.innerWidth / 2) - targetCardCenter;
            
            row.style.transition = 'none'; 
            row.style.transform = `translateX(${newPosition}px)`;
        });
    }
    
    _handleResize() {
        clearTimeout(this.resizeDebounceTimeout);
        this.resizeDebounceTimeout = setTimeout(() => this._recenterRows(), 100);
    }
    
    _updateStatsDisplay() {
        if (!this.backdrop) return;
        this.backdrop.querySelector('#slot-score-session').textContent = this.sessionScore;
        this.backdrop.querySelector('#slot-score-high').textContent = this.highScore;
        this.backdrop.querySelector('#slot-jackpots-session').textContent = this.sessionJackpots;
        this.backdrop.querySelector('#slot-jackpots-total').textContent = this.totalJackpots;
        this.backdrop.querySelector('#slot-spins-session').textContent = this.sessionSpins;
        this.backdrop.querySelector('#slot-spins-total').textContent = this.totalSpins;
    }
    
    _showStatDelta(statId, value) {
        if (!this.backdrop) return;
        const statItem = this.backdrop.querySelector(`#stat-${statId}`);
        if (!statItem) return;

        const deltaEl = statItem.querySelector('.stat-delta');
        deltaEl.textContent = value;
        
        const isPositive = parseFloat(value) > 0;
        deltaEl.classList.toggle('is-positive', isPositive);
        deltaEl.classList.toggle('is-negative', !isPositive);

        deltaEl.classList.remove('animate');
        void deltaEl.offsetWidth; 
        deltaEl.classList.add('animate');
    }

    _setFrameGlow(type, duration) {
        if (!this.frame) return;
        
        clearTimeout(this.glowTimeout);
        this.frame.classList.remove('is-jackpot', 'is-nearmiss', 'is-normal-win');
    
        if (type) {
            requestAnimationFrame(() => {
                this.frame.classList.add(`is-${type}`);
                if (duration) {
                    this.glowTimeout = setTimeout(() => {
                        if (this.frame) {
                            this.frame.classList.remove(`is-${type}`);
                        }
                    }, duration);
                }
            });
        }
    }

    _triggerJackpotAnimation(character, demoMode = false) {
        const duration = 10000;
        const endTime = Date.now() + duration;

        if (this.backdrop) this.backdrop.classList.add('is-jackpot');

        const createRainCard = () => {
            if (Date.now() > endTime) {
                clearInterval(this.jackpotInterval);
                this.jackpotInterval = null;
                return;
            }

            const card = document.createElement('div');
            card.className = 'character-card jackpot-rain-card';
            card.innerHTML = `
                <div class="image-container">
                    <img src="/image/${character.hash}" alt="${character.name}" loading="lazy">
                </div>
                <div class="name">${character.name}</div>
            `;

            const scale = Math.random() * 0.7 + 0.5;
            const rotation = (Math.random() * 120 - 60);
            const fallDuration = (Math.random() * 3 + 4) / (scale * 1.1); 

            card.style.left = `${Math.random() * 100}vw`;
            card.style.setProperty('--card-scale', scale);
            card.style.setProperty('--card-rotation', `${rotation}deg`);
            card.style.animationDuration = `${fallDuration}s, 2s`;
            card.style.animationDelay = `${Math.random() * 0.5}s`;

            this.backdrop.appendChild(card);
            setTimeout(() => card.remove(), fallDuration * 1000 + 500);
        };
        
        this.jackpotInterval = setInterval(createRainCard, 100);

        setTimeout(() => {
            if (this.backdrop) this.backdrop.classList.remove('is-jackpot');
        }, duration);
    }

    close() {
        clearInterval(this.jackpotInterval);
        window.removeEventListener('resize', this._handleResize);
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }
        if (this.resolvePromise) {
            this.resolvePromise();
            this.resolvePromise = null;
        }
    }
}

// Yuuka: plugin refactor v1.0 - Đăng ký component với tên mới
window.Yuuka.components['SlotMachineService'] = SlotMachineService;