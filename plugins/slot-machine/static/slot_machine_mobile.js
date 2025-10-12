// --- MODIFIED FILE: plugins/slot-machine/static/slot_machine_mobile.js ---
class SlotMachineServiceMobile {
    constructor(container, api) {
        // Yuuka: mobile fix v1.0 - Sao chép toàn bộ thuộc tính, không kế thừa động nữa
        this.api = api;
        this.characterPool = [];
        this.backdrop = null;
        this.spinBtn = null;
        this.reelsContainer = null;
        this.resolvePromise = null;
        this.isSpinning = false;
        this.frame = null;
        this.glowTimeout = null;
        this.costIndicator = null;
        this.freeSpins = 0;
        this.spinCost = 10;
        this.freeSpinsOnEmpty = 3;
        // Bố cục mobile: 3 cột, mỗi cột 21 biểu tượng
        this.columnCount = 3;
        this.symbolsPerColumn = 21;
        this.spinDurationBase = 4000;
        this.cardHeight = 200 * 0.4; // Yuuka: mobile layout v2.1 - Cập nhật chiều cao card
        this.cardMargin = 8; // Yuuka: mobile layout v2.1 - Cập nhật margin card (var(--spacing-2))
        this.currentColTargetIndices = [];
        this.resizeDebounceTimeout = null;
        this._handleResize = this._handleResize.bind(this);
        this.reelCharacters = [];
        this.pickedCharacterHash = null;
        this.sessionSpins = 0;
        this.sessionScore = 0;
        this.sessionJackpots = 0;
        this.totalSpins = parseInt(localStorage.getItem('yuuka-slot-total-spins') || '0', 10);
        this.highScore = parseInt(localStorage.getItem('yuuka-slot-high-score') || '0', 10);
        this.totalJackpots = parseInt(localStorage.getItem('yuuka-slot-total-jackpots') || '0', 10);

        // Yuuka: mobile fix v1.0 - Sao chép map điểm và tên để class hoàn toàn độc lập
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

        console.log("[Plugin:SlotMachine] Mobile instance created.");
    }

    async start(options = {}) {
        if (this.backdrop) return;

        this.sessionSpins = 0;
        this.sessionScore = 0;
        this.sessionJackpots = 0;

        try {
            const [charResponse, listsResponse] = await Promise.all([
                this.api.getAllCharacters(),
                this.api['character-list'].get('/lists')
            ]);
            
            const allCharacters = charResponse.characters;
            const blacklist = listsResponse.blacklist || [];
            const blacklistedHashes = new Set(blacklist);
            this.characterPool = allCharacters.filter(c => !blacklistedHashes.has(c.hash));

            if (this.characterPool.length < 20) {
                showError(`Cần ít nhất 20 nhân vật để chơi.`);
                return;
            }
        } catch (error) {
            showError(`Lỗi khi tải dữ liệu game: ${error.message}`);
            return;
        }

        return new Promise(resolve => {
            this.resolvePromise = resolve;
            this.freeSpins = 5;
            this._initUI();
            this.spinBtn.disabled = true;
            this._prepareInitialReels();
            this._updateControlsDisplay();
            window.addEventListener('resize', this._handleResize);
            setTimeout(() => {
                this.spinBtn.disabled = false;
                this._updateControlsDisplay();
            }, 1000);
        });
    }

    _initUI() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'slot-machine-backdrop is-mobile'; // Thêm class is-mobile

        let columnsHTML = Array.from({ length: this.columnCount }, (_, i) => 
            `<div class="slot-column" data-col-index="${i}"><div class="slot-strip"></div></div>`
        ).join('');

        // Yuuka: mobile fix v1.0 - Cập nhật lại HTML để bao gồm tất cả các thành phần stats
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
                <div class="slot-machine-frame"></div>
                ${columnsHTML}
             </div>
             <div class="slot-controls">
                <div class="slot-cost-indicator">
                    <div data-type="cost" class="is-visible">
                        <span class="material-symbols-outlined">military_tech</span>
                        <span class="cost-value">${this.spinCost}</span>
                    </div>
                    <div data-type="free">
                        <span class="material-symbols-outlined">redeem</span>
                        <span class="free-spin-value">0</span>
                    </div>
                </div>
                <button class="slot-spin-btn" title="Spin"><span class="material-symbols-outlined">casino</span></button>
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
        this.reelsContainer.addEventListener('click', this._handleCardPick.bind(this));
        
        this._updateStatsDisplay();
    }
    
    // Yuuka: mobile fix v1.0 - Viết lại hàm spin cho layout cột
    _spin(charactersForSpin, finalResults, demoMode = false, wasFreeSpin = false) {
        const pickedBeforeSpin = this.pickedCharacterHash;
        this._updateHighlights();

        const columns = this.backdrop.querySelectorAll('.slot-column');
        const totalCardHeight = this.cardHeight + this.cardMargin;
        const finalCardIndices = [];

        const spinPromises = Array.from(columns).map((column, i) => {
            return new Promise(resolve => {
                const strip = column.querySelector('.slot-strip');
                const colChars = charactersForSpin[i];
                const finalChar = finalResults[i];
                
                let finalCardIndex = colChars.findIndex(c => c.hash === finalChar.hash);
                if (finalCardIndex === -1) finalCardIndex = 0;
                finalCardIndices[i] = finalCardIndex;
                
                const targetIndexInStrip = finalCardIndex + this.symbolsPerColumn;
                this.currentColTargetIndices[i] = targetIndexInStrip;

                strip.innerHTML = [...colChars, ...colChars, ...colChars].map(c => this._createCardHTML(c, pickedBeforeSpin)).join('');
                
                const targetCardCenter = (targetIndexInStrip * totalCardHeight) + (totalCardHeight / 2);
                const finalPosition = (column.offsetHeight / 2) - targetCardCenter;

                requestAnimationFrame(() => {
                    const spinDuration = this.spinDurationBase + i * 500;
                    strip.style.transition = `transform ${spinDuration}ms cubic-bezier(0.25, 1, 0.5, 1)`;
                    strip.style.transform = `translateY(${finalPosition}px)`;
                    setTimeout(resolve, spinDuration);
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
                    showError(`Hết điểm! Tặng ${this.freeSpinsOnEmpty} lượt quay miễn phí.`);
                    this._updateStatsDisplay();
                }
                this.spinBtn.querySelector('.material-symbols-outlined').textContent = 'casino';
                this._updateControlsDisplay();
            }
        });
    }

    // Yuuka: mobile fix v1.0 - Viết lại hàm prepare cho layout cột
    _prepareInitialReels() {
        const columns = this.backdrop.querySelectorAll('.slot-column');
        this.reelCharacters = this._selectCharacters();
        const totalCardHeight = this.cardHeight + this.cardMargin;
        
        columns.forEach((column, i) => {
            const strip = column.querySelector('.slot-strip');
            const colChars = this.reelCharacters[i];
            strip.innerHTML = [...colChars, ...colChars, ...colChars].map(c => this._createCardHTML(c, this.pickedCharacterHash)).join('');
            
            const middleIndex = Math.floor(Math.random() * this.symbolsPerColumn) + this.symbolsPerColumn;
            this.currentColTargetIndices[i] = middleIndex;
            
            const targetCardCenter = (middleIndex * totalCardHeight) + (totalCardHeight / 2);
            const targetPos = (column.offsetHeight / 2) - targetCardCenter;
            
            strip.style.transition = 'none';
            strip.style.transform = `translateY(${targetPos}px)`;
        });
    }

    // Yuuka: mobile fix v1.0 - Viết lại hàm recenter cho layout cột
    _recenterReels() {
        if (!this.backdrop) return;
        const columns = this.backdrop.querySelectorAll('.slot-column');
        const totalCardHeight = this.cardHeight + this.cardMargin;

        columns.forEach((column, i) => {
            const strip = column.querySelector('.slot-strip');
            const targetIndex = this.currentColTargetIndices[i];
            if (targetIndex === undefined) return;

            const targetCardCenter = (targetIndex * totalCardHeight) + (totalCardHeight / 2);
            const newPosition = (column.offsetHeight / 2) - targetCardCenter;
            
            strip.style.transition = 'none'; 
            strip.style.transform = `translateY(${newPosition}px)`;
        });
    }
    
    _handleResize() {
        clearTimeout(this.resizeDebounceTimeout);
        this.resizeDebounceTimeout = setTimeout(() => this._recenterReels(), 100);
    }

    close() {
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

    // Yuuka: mobile fix v1.0 - Viết lại hàm select characters cho cột
    _selectCharacters() {
        const availableChars = [...this.characterPool];
        const selectedChars = new Set();
        
        const targetSize = Math.min(this.symbolsPerColumn, availableChars.length);
        while(selectedChars.size < targetSize && availableChars.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableChars.length);
            selectedChars.add(availableChars.splice(randomIndex, 1)[0]);
        }
        const baseColSet = Array.from(selectedChars);

        const colCharacters = [];
        for (let i = 0; i < this.columnCount; i++) {
            const shuffledCol = [...baseColSet].sort(() => Math.random() - 0.5);
            colCharacters.push(shuffledCol);
        }
        return colCharacters;
    }
    
    // Yuuka: mobile fix v1.0 - Bổ sung đầy đủ các hàm logic đã được sao chép và sửa lỗi
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
            let freeSpinsToUse = 0, pointsToUse = 0, canSpin = false;
            if (this.freeSpins > 0) {
                const required = this.pickedCharacterHash ? 2 : 1;
                if (this.freeSpins >= required) { canSpin = true; freeSpinsToUse = required; wasFreeSpin = true; }
            } else {
                if (this.sessionScore >= this.spinCost) { canSpin = true; pointsToUse = this.spinCost; }
            }
            if (!canSpin && this.sessionScore < this.spinCost && this.freeSpins === 0) {
                this.freeSpins += this.freeSpinsOnEmpty;
                showError(`Hết điểm! Tặng ${this.freeSpinsOnEmpty} lượt quay miễn phí.`);
                this._updateControlsDisplay(); this._updateStatsDisplay(); return;
            }
            if (!canSpin) { this._updateControlsDisplay(); return; }
            this.isSpinning = true; this.spinBtn.disabled = true; this.spinBtn.querySelector('.material-symbols-outlined').textContent = 'sync';
            this._setFrameGlow(null);
            if (this.reelsContainer) this.reelsContainer.querySelectorAll('.character-card').forEach(c => c.className = c.className.replace(/\bis-winning-card-\w+\b/g, ''));
            this.freeSpins -= freeSpinsToUse; this.sessionScore -= pointsToUse; this.sessionSpins++; this.totalSpins++;
            this._showStatDelta('spins', '+1');
            if (pointsToUse > 0) this._showStatDelta('score', `-${pointsToUse}`);
            this._updateStatsDisplay(); this._updateControlsDisplay();
        } else {
            this.isSpinning = true; this.spinBtn.disabled = true; this.spinBtn.querySelector('.material-symbols-outlined').textContent = 'sync';
            this._setFrameGlow(null);
        }
        this._spin(this.reelCharacters, this._determineFinalResults(this.reelCharacters, forceJackpot), demoMode, wasFreeSpin);
    }
    
    _determineFinalResults(charactersForSpin, forceJackpot) {
        if (forceJackpot) {
            const jackpotChar = this.characterPool[Math.floor(Math.random() * this.characterPool.length)];
            return [jackpotChar, jackpotChar, jackpotChar];
        }
        return charactersForSpin.map(colChars => colChars.length > 0 ? colChars[Math.floor(Math.random() * colChars.length)] : null);
    }

    // Yuuka: mobile fix v1.0 - Viết lại hàm tính điểm để xây dựng grid từ cột
    _calculateAndShowScore(finalCardIndices, reelCharacters, demoMode = false, pickedCharacterHash, wasFreeSpin = false) {
        const grid = [[], [], []]; // 3 hàng, sẽ được điền theo từng cột
        for (let c = 0; c < this.columnCount; c++) {
            const colChars = reelCharacters[c];
            const centerIndex = finalCardIndices[c];
            grid[0][c] = colChars[(centerIndex - 1 + colChars.length) % colChars.length];
            grid[1][c] = colChars[centerIndex];
            grid[2][c] = colChars[(centerIndex + 1) % colChars.length];
        }
        
        // Logic tính điểm còn lại (giữ nguyên vì nó hoạt động trên `grid` trừu tượng)
        let highestWinType = 'none'; const processedCoords = new Set(); const baseWins = []; const winningCoords = new Set();
        const allCoords = []; for (let r=0; r<3; r++) for (let c=0; c<3; c++) allCoords.push([r,c]);

        const midRowChars = [grid[1][0], grid[1][1], grid[1][2]]; // Yuuka: mobile jackpot fix v1.0
        if (midRowChars.every(ch => ch && ch.hash === midRowChars[0].hash)) { // Yuuka: mobile jackpot fix v1.0
            baseWins.push({ type: 'BIG_JACKPOT', hash: midRowChars[0].hash, score: this.scoreMap.NORMAL_WIN_BIG_JACKPOT }); // Yuuka: mobile jackpot fix v1.0
            ['1,0', '1,1', '1,2'].forEach(c => { processedCoords.add(c); winningCoords.add(c); }); // Yuuka: mobile jackpot fix v1.0
            highestWinType = 'jackpot';
        }
        
        const lines = [[[0,0],[0,1],[0,2]],[[1,0],[1,1],[1,2]],[[2,0],[2,1],[2,2]],[[0,0],[1,0],[2,0]],[[0,2],[1,2],[2,2]],[[0,0],[1,1],[2,2]],[[0,2],[1,1],[2,0]]];
        lines.forEach(line => {
            const lcs = line.map(c => c.join(','));
            if (lcs.some(c => processedCoords.has(c))) return;
            const chars = line.map(([r,c]) => grid[r][c]);
            if (chars.every(ch => ch && ch.hash === chars[0].hash)) {
                baseWins.push({ type: '3_LINE', hash: chars[0].hash, score: this.scoreMap.NORMAL_WIN_3_LINE });
                lcs.forEach(c => { processedCoords.add(c); winningCoords.add(c); });
                if (highestWinType !== 'jackpot') highestWinType = 'nearmiss';
            }
        });
        
        //... logic scatter, 2_KIND, ... (giữ nguyên)
        const remainingCoordsForScatter = allCoords.filter(([r,c])=>!processedCoords.has(`${r},${c}`));
        const charCounts = remainingCoordsForScatter.reduce((acc, [r,c])=>{const char=grid[r][c];if(char){if(!acc[char.hash])acc[char.hash]={count:0,midCols:0,coords:[]};acc[char.hash].count++;acc[char.hash].coords.push(`${r},${c}`);if(c===1)acc[char.hash].midCols++;}return acc;},{});
        for(const hash in charCounts){if(charCounts[hash].count===3){const score=charCounts[hash].midCols===2?this.scoreMap.NORMAL_WIN_3_SCATTER_2_MID:this.scoreMap.NORMAL_WIN_3_SCATTER_1_MID;baseWins.push({type:'3_SCATTER',hash,score});charCounts[hash].coords.forEach(c=>{processedCoords.add(c);winningCoords.add(c);});if(highestWinType==='none')highestWinType='normal-win';}}
        let coordsForPairCheck=allCoords.filter(([r,c])=>!processedCoords.has(`${r},${c}`));
        const adjacencyDeltas=[[0,1],[1,0],[1,1],[1,-1]];
        while(coordsForPairCheck.length>0){const[r1,c1]=coordsForPairCheck.shift();const char1=grid[r1][c1];if(!char1)continue;for(const[dr,dc]of adjacencyDeltas){const r2=r1+dr,c2=c1+dc;const neighborIndex=coordsForPairCheck.findIndex(([nr,nc])=>nr===r2&&nc===c2);if(neighborIndex!==-1){const char2=grid[r2][c2];if(char2&&char1.hash===char2.hash){baseWins.push({type:'2_KIND',hash:char1.hash,score:this.scoreMap.NORMAL_WIN_2_KIND});if(highestWinType==='none')highestWinType='normal-win';const coord1Str=`${r1},${c1}`,coord2Str=`${r2},${c2}`;processedCoords.add(coord1Str).add(coord2Str);winningCoords.add(coord1Str).add(coord2Str);coordsForPairCheck.splice(neighborIndex,1);break;}}}}
        
        let totalScoreForTurn = 0; const eventsToDisplay = [];
        baseWins.forEach(win => { totalScoreForTurn += win.score; eventsToDisplay.push({ text: this.winTypeNames[win.type]||'', score: win.score, type: highestWinType==='jackpot'?'jackpot':(highestWinType==='nearmiss'?'nearmiss':'normal') }); });

        if (pickedCharacterHash && !demoMode) {
            let bonusInfo = { score: 0, type: null, text: '' };
            const pickedWins = baseWins.filter(win => win.hash === pickedCharacterHash);
            if (pickedWins.length > 0) {
                const highestPickedWin = pickedWins.sort((a,b) => b.score - a.score)[0]; let multiplier = 1;
                switch(highestPickedWin.type){case'BIG_JACKPOT':multiplier=this.scoreMap.PICKED_MULTIPLIER_BIG_JACKPOT;break;case'3_LINE':multiplier=this.scoreMap.PICKED_MULTIPLIER_3_LINE;break;case'3_SCATTER':multiplier=this.scoreMap.PICKED_MULTIPLIER_3_SCATTER;break;case'2_KIND':multiplier=this.scoreMap.PICKED_MULTIPLIER_2_KIND;break;}
                bonusInfo.score = highestPickedWin.score * (multiplier - 1); bonusInfo.type = `PICKED_MULTIPLIER_${highestPickedWin.type}`; bonusInfo.text = `PICK x${multiplier}`;
            } else {
                const pickedCount = allCoords.filter(([r,c]) => grid[r][c]?.hash === pickedCharacterHash).length;
                if(pickedCount===3)bonusInfo={score:this.scoreMap.PICKED_BONUS_3_SCATTER,type:'PICKED_BONUS_3_SCATTER'};else if(pickedCount===2)bonusInfo={score:this.scoreMap.PICKED_BONUS_2_SCATTER,type:'PICKED_BONUS_2_SCATTER'};else if(pickedCount===1)bonusInfo={score:this.scoreMap.PICKED_BONUS_ONE_SHOW,type:'PICKED_BONUS_ONE_SHOW'};else if(pickedCount===0&&!wasFreeSpin)bonusInfo={score:this.scoreMap.PICKED_PENALTY_NO_SHOW,type:'PICKED_PENALTY_NO_SHOW'};
                if(bonusInfo.type)bonusInfo.text=this.winTypeNames[bonusInfo.type]||'';
            }
            if(bonusInfo.score !== 0) { totalScoreForTurn += bonusInfo.score; eventsToDisplay.push({ text: bonusInfo.text, score: bonusInfo.score, type: bonusInfo.score > 0 ? 'normal':'penalty' }); }
        }

        if (eventsToDisplay.length > 0) { eventsToDisplay.forEach((e, i) => setTimeout(() => this._showScorePopup(e.text, e.score, e.type), i * 400)); if(!demoMode) this._showStatDelta('score', totalScoreForTurn > 0 ? `+${totalScoreForTurn}` : totalScoreForTurn); }
        if (highestWinType !== 'none') { this._setFrameGlow(highestWinType, highestWinType === 'jackpot' ? null : 2400); }

        if (highestWinType !== 'none' && winningCoords.size > 0) {
            const columns = this.backdrop.querySelectorAll('.slot-column');
            const winningClass = `is-winning-card-${highestWinType}`;
            winningCoords.forEach(coordStr => {
                const [r, c] = coordStr.split(',').map(Number);
                const strip = columns[c]?.querySelector('.slot-strip');
                const centerIndexInStrip = finalCardIndices[c] + reelCharacters[c].length;
                const cardDomIndex = centerIndexInStrip + (r - 1);
                const winningCard = strip?.children[cardDomIndex];
                if (winningCard) winningCard.classList.add(winningClass);
            });
        }
        
        if (!demoMode) {
            this.sessionScore += totalScoreForTurn; this.sessionScore = Math.max(0, this.sessionScore);
            if (this.sessionScore > this.highScore) { this.highScore = this.sessionScore; localStorage.setItem('yuuka-slot-high-score', this.highScore); }
            if (highestWinType === 'jackpot') { this.sessionJackpots++; this.totalJackpots++; this._showStatDelta('jackpots', '+1'); this._triggerJackpotAnimation(grid[1][1], demoMode); }
            localStorage.setItem('yuuka-slot-total-spins', this.totalSpins);
            localStorage.setItem('yuuka-slot-total-jackpots', this.totalJackpots);
            this._updateStatsDisplay();
        }
    }

    _showScorePopup(t, s, y) { if(!this.backdrop||!t)return; const c=this.backdrop.querySelector('.slot-score-popup-container'); if(!c)return; const p=document.createElement('div'); p.className='slot-score-popup'; const i=document.createElement('div'); i.className=`popup-inner score-popup--${y}`; const st=s>0?`+${s}`:`${s}`; i.innerHTML=`<div class="popup-text">${t}</div><div class="popup-score">${st}</div>`; p.appendChild(i); c.appendChild(p); const oX=(Math.random()-.5)*100; const oY=(Math.random()-.5)*50; p.style.transform=`translate(${oX}px,${oY}px)`; const se=i.querySelector('.popup-score'); if(se){const soX=(Math.random()-.5)*40;const soY=(Math.random()-.5)*30;se.style.transform=`translate(calc(-50% + ${soX}px),calc(-50% + ${soY}px))`;} const d=y==='jackpot'?10000:2000; setTimeout(()=>p.remove(),d); }
    _updateStatsDisplay() { if(!this.backdrop)return; this.backdrop.querySelector('#slot-score-session').textContent=this.sessionScore; this.backdrop.querySelector('#slot-score-high').textContent=this.highScore; this.backdrop.querySelector('#slot-jackpots-session').textContent=this.sessionJackpots; this.backdrop.querySelector('#slot-jackpots-total').textContent=this.totalJackpots; this.backdrop.querySelector('#slot-spins-session').textContent=this.sessionSpins; this.backdrop.querySelector('#slot-spins-total').textContent=this.totalSpins; }
    _showStatDelta(s,v) { if(!this.backdrop)return; const si=this.backdrop.querySelector(`#stat-${s}`); if(!si)return; const d=si.querySelector('.stat-delta'); d.textContent=v; const ip=parseFloat(v)>0; d.classList.toggle('is-positive',ip); d.classList.toggle('is-negative',!ip); d.classList.remove('animate'); void d.offsetWidth; d.classList.add('animate'); }
    _setFrameGlow(t,d) { if(!this.frame)return; clearTimeout(this.glowTimeout); this.frame.className='slot-machine-frame'; if(t){requestAnimationFrame(()=>{this.frame.classList.add(`is-${t}`); if(d)this.glowTimeout=setTimeout(()=>this.frame&&this.frame.classList.remove(`is-${t}`),d);});} }
    _triggerJackpotAnimation(c, d) { if (this.backdrop) { this.backdrop.classList.add('is-jackpot'); setTimeout(() => this.backdrop && this.backdrop.classList.remove('is-jackpot'), 10000); } }
}

// Logic tự động ghi đè component
(function() {
    const isMobile = () => ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia("(max-width: 800px)").matches;
    if (isMobile()) {
        console.log("[Plugin:SlotMachine] Mobile device detected. Overwriting with mobile version.");
        // Ghi đè component mặc định bằng phiên bản mobile
        window.Yuuka.components['SlotMachineService'] = SlotMachineServiceMobile;
    }
})();