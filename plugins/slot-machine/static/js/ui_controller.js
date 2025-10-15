// --- MODIFIED FILE: plugins/slot-machine/static/js/ui_controller.js ---
// Yuuka: Handles all DOM manipulation, rendering, and animations.
import { GAME_CONFIG, SPECIAL_CARD_CONFIGS } from './constants.js';

const SPECIAL_CARD_CLASSNAMES = SPECIAL_CARD_CONFIGS.map(cfg => `special-card-${cfg.id}`);

export class UIController {
    constructor(backdrop, isMobile) {
        this.backdrop = backdrop;
        this.isMobile = isMobile;
        this.reelsContainer = backdrop.querySelector('.slot-machine-reels-container');
        this.frame = backdrop.querySelector('.slot-machine-frame');
        this.spinBtn = backdrop.querySelector('.slot-spin-btn');
        this.costIndicator = backdrop.querySelector('.slot-cost-indicator');
        this.popupContainer = backdrop.querySelector('.slot-score-popup-container');
        this.jackpotRainLayer = backdrop.querySelector('.slot-jackpot-rain-layer');
        this.logContainer = backdrop.querySelector('.slot-log-container');
        this.glowTimeout = null;
        this.jackpotInterval = null;
        this.jackpotCleanupTimeout = null;
        this.jackpotFinalCleanupTimeout = null;
        this.currentReelTargetIndices = [];
        // YUUKA: win effect v2.0 - Thêm timer cho animation
        this.highlightTimer = null;
        this.swapAnimationTimers = [];
    }

    // --- Card Rendering ---

    createCardHTML(char, pickedHash) {
        const isPickedClass = (pickedHash && char.hash === pickedHash) ? 'is-picked' : '';
        return `
            <div class="character-card ${isPickedClass}" data-hash="${char.hash}">
                <div class="card-special-layer"></div>
                <div class="image-container">
                    <img src="/image/${char.hash}" alt="${char.name}" loading="lazy">
                </div>
                <div class="name">${char.name}</div>
            </div>`;
    }

    buildInitialReels(reelCharacters, pickedHash) {
        if (this.isMobile) {
            const columns = this.reelsContainer.querySelectorAll('.slot-column');
            columns.forEach((column, i) => {
                const strip = column.querySelector('.slot-strip');
                const reel = reelCharacters[i];
                strip.innerHTML = [...reel, ...reel, ...reel].map(c => this.createCardHTML(c, pickedHash)).join('');
            });
        } else {
            const rows = this.reelsContainer.querySelectorAll('.slot-row');
            rows.forEach((row, i) => {
                const reel = reelCharacters[i];
                row.innerHTML = [...reel, ...reel, ...reel].map(c => this.createCardHTML(c, pickedHash)).join('');
            });
        }
    }

    renderSpecialBadges(sessionSpecialMap) {
        this.reelsContainer.querySelectorAll('.character-card[data-special-id]').forEach(card => {
            card.classList.remove('has-special-card', ...SPECIAL_CARD_CLASSNAMES);
            card.removeAttribute('data-special-id');
            const layer = card.querySelector('.card-special-layer');
            if (layer) layer.innerHTML = '';
        });
        if (!sessionSpecialMap || sessionSpecialMap.size === 0) return;

        const reels = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row');

        sessionSpecialMap.forEach((effect, key) => {
            const [reelIndex, charIndex] = key.split(',').map(Number);
            
            const reel = reels[reelIndex];
            if (!reel) return;

            const reelLen = reel.children.length / 3;
            
            [0, 1, 2].forEach(offset => {
                const cardIndex = charIndex + (offset * reelLen);
                const card = reel.children[cardIndex];
                if (!card) return;
                
                let layer = card.querySelector('.card-special-layer');
                if (!layer) {
                    layer = document.createElement('div');
                    layer.className = 'card-special-layer';
                    card.prepend(layer);
                }
                const category = effect.category || 'default';
                const icon = effect.icon ? `<span class="material-symbols-outlined">${effect.icon}</span>` : '';
                const label = effect.badgeLabel ? `<span class="slot-card-badge__label">${effect.badgeLabel}</span>` : '';
                layer.innerHTML = `<div class="slot-card-badge slot-card-badge--${category}">${icon}${label}</div>`;
                card.classList.add('has-special-card', `special-card-${effect.id}`);
                card.setAttribute('data-special-id', effect.id);
            });
        });
    }

    _applyCharacterToCard(card, character) {
        if (!card) return;
        if (!character) {
            card.dataset.hash = '';
            const img = card.querySelector('img');
            if (img) {
                img.removeAttribute('src');
                img.alt = '';
            }
            const nameEl = card.querySelector('.name');
            if (nameEl) nameEl.textContent = '';
            return;
        }

        card.dataset.hash = character.hash;
        const img = card.querySelector('img');
        if (img) {
            img.src = `/image/${character.hash}`;
            img.alt = character.name;
        }
        const nameEl = card.querySelector('.name');
        if (nameEl) nameEl.textContent = character.name;
    }

    _refreshCardCopies(cell, reelCharacters) {
        const reels = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row');
        const reel = reels[cell.reelIndex];
        if (!reel) return;

        const reelChars = reelCharacters[cell.reelIndex];
        if (!reelChars) return;

        const symbolsPerReel = reelChars.length;
        const character = reelChars[cell.charIndex];

        for (let copy = 0; copy < 3; copy++) {
            const domIndex = cell.charIndex + (copy * symbolsPerReel);
            const card = reel.children[domIndex];
            if (!card) continue;
            this._applyCharacterToCard(card, character);
        }
    }

    _animateSwapForCell(cell, finalCardIndices, reelCharacters) {
        const reels = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row');
        const reel = reels[cell.reelIndex];
        if (!reel) return;

        const reelChars = reelCharacters[cell.reelIndex];
        if (!reelChars) return;

        const symbolsPerReel = reelChars.length;
        const centerIndex = finalCardIndices[cell.reelIndex];
        if (typeof centerIndex !== 'number') return;

        const baseOffset = this.isMobile ? cell.row : cell.column;
        if (typeof baseOffset !== 'number') return;
        const offset = baseOffset - 1;
        const targetIndex = centerIndex + symbolsPerReel + offset;
        const targetCard = reel.children[targetIndex];
        if (!targetCard) return;

        targetCard.classList.add('is-swapping');
        const timer = window.setTimeout(() => {
            targetCard.classList.remove('is-swapping');
            this.swapAnimationTimers = this.swapAnimationTimers.filter(id => id !== timer);
        }, 600);
        this.swapAnimationTimers.push(timer);
    }

    applySwapVisuals(sourceCell, targetCell, finalCardIndices, reelCharacters) {
        if (!sourceCell) return;
        this._refreshCardCopies(sourceCell, reelCharacters);
        this._animateSwapForCell(sourceCell, finalCardIndices, reelCharacters);

        if (targetCell) {
            this._refreshCardCopies(targetCell, reelCharacters);
            if (this._isCellVisible(targetCell)) {
                this._animateSwapForCell(targetCell, finalCardIndices, reelCharacters);
            }
        }
    }

    _isCellVisible(cell) {
        if (this.isMobile) {
            return typeof cell.row === 'number' && typeof cell.reelIndex === 'number';
        }
        return typeof cell.row === 'number' && typeof cell.column === 'number';
    }

    // --- Animation ---

    animateToInitialPosition(reelCharacters) {
        const totalSize = this.isMobile 
            ? (GAME_CONFIG.CARD_HEIGHT * GAME_CONFIG.MOBILE_CARD_SCALE) + 8 // 8 is margin
            : GAME_CONFIG.CARD_WIDTH + GAME_CONFIG.CARD_MARGIN;
        
        const reels = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row');
        this.currentReelTargetIndices = [];

        reels.forEach((reel, i) => {
            const symbolsPerReel = this.isMobile ? GAME_CONFIG.MOBILE_SYMBOLS_PER_COLUMN : GAME_CONFIG.DESKTOP_SYMBOLS_PER_ROW;
            const middleIndex = Math.floor(symbolsPerReel / 2);
            this.currentReelTargetIndices[i] = middleIndex;

            const targetCenter = (middleIndex * totalSize) + (totalSize / 2);
            const viewportCenter = (this.isMobile ? reel.parentElement.offsetHeight : window.innerWidth) / 2;
            const targetPos = viewportCenter - targetCenter;
            
            reel.style.transition = 'none';
            if (this.isMobile) {
                reel.style.transform = `translateY(${targetPos}px)`;
            } else {
                 const startPos = i % 2 === 0 ? -window.innerWidth - 200 : window.innerWidth + 200;
                 reel.style.transform = `translateX(${startPos}px)`;
                 setTimeout(() => {
                     reel.style.transition = 'transform 1000ms cubic-bezier(0.25, 1, 0.5, 1)';
                     reel.style.transform = `translateX(${targetPos}px)`;
                 }, 50);
            }
        });
    }

    animateSpin(finalResults, reelCharacters, pickedHash, direction = 1) {
        if (typeof pickedHash !== 'undefined') {
            this.updateHighlights(pickedHash);
        }
        const reels = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row');
        const totalSize = this.isMobile 
            ? (GAME_CONFIG.CARD_HEIGHT * GAME_CONFIG.MOBILE_CARD_SCALE) + 8 
            : GAME_CONFIG.CARD_WIDTH + GAME_CONFIG.CARD_MARGIN;
        const directionSign = direction >= 0 ? 1 : -1;
        const finalCardIndices = [];

        const spinPromises = Array.from(reels).map((reel, i) => {
            return new Promise(resolve => {
                const reelChars = reelCharacters[i];
                if (!reelChars || reelChars.length === 0) {
                    finalCardIndices[i] = 0;
                    resolve();
                    return;
                }

                const finalChar = finalResults[i];
                let finalCardIndex = reelChars.findIndex(c => c.hash === finalChar.hash);
                if (finalCardIndex === -1) finalCardIndex = 0;
                finalCardIndices[i] = finalCardIndex;

                const symbolsPerReel = this.isMobile ? GAME_CONFIG.MOBILE_SYMBOLS_PER_COLUMN : GAME_CONFIG.DESKTOP_SYMBOLS_PER_ROW;
                const duplicateSpan = symbolsPerReel;
                const baseIndex = Math.floor(symbolsPerReel / 2);
                const startIndexInStrip = directionSign >= 0
                    ? baseIndex
                    : baseIndex + (duplicateSpan * 2);
                const targetIndexInStrip = finalCardIndex + duplicateSpan;
                this.currentReelTargetIndices[i] = targetIndexInStrip;

                const targetCenter = (targetIndexInStrip * totalSize) + (totalSize / 2);
                const startCenter = (startIndexInStrip * totalSize) + (totalSize / 2);
                const viewportCenter = (this.isMobile ? reel.parentElement.offsetHeight : window.innerWidth) / 2;
                const finalPosition = viewportCenter - targetCenter;
                const transformProp = this.isMobile ? 'translateY' : 'translateX';
                const startPosition = viewportCenter - startCenter;

                requestAnimationFrame(() => {
                    reel.style.transition = 'none';
                    reel.style.transform = `${transformProp}(${startPosition}px)`;
                    requestAnimationFrame(() => {
                        const duration = GAME_CONFIG.SPIN_DURATION_BASE + i * GAME_CONFIG.SPIN_DURATION_STAGGER;
                        reel.style.transition = `transform ${duration}ms cubic-bezier(0.25, 1, 0.5, 1)`;
                        reel.style.transform = `${transformProp}(${finalPosition}px)`;
                        setTimeout(resolve, duration);
                    });
                });
            });
        });
        return { spinPromises, finalCardIndices };
    }

    recenterReels() {
        if (!this.reelsContainer) return;
        const reels = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row');
        const totalSize = this.isMobile 
            ? (GAME_CONFIG.CARD_HEIGHT * GAME_CONFIG.MOBILE_CARD_SCALE) + 8 
            : GAME_CONFIG.CARD_WIDTH + GAME_CONFIG.CARD_MARGIN;
        const transformProp = this.isMobile ? 'translateY' : 'translateX';

        reels.forEach((reel, i) => {
            const targetIndex = this.currentReelTargetIndices[i];
            if (targetIndex === undefined) return;
            const targetCenter = (targetIndex * totalSize) + (totalSize / 2);
            const viewportCenter = (this.isMobile ? reel.parentElement.offsetHeight : window.innerWidth) / 2;
            const newPosition = viewportCenter - targetCenter;
            
            reel.style.transition = 'none'; 
            reel.style.transform = `${transformProp}(${newPosition}px)`;
        });
    }

    triggerJackpotAnimation(primaryCharacter) {
        if (!this.backdrop || !primaryCharacter || !primaryCharacter.hash) return;
        this._stopJackpotRain();
        this.backdrop.classList.add('is-jackpot');
        if (this.jackpotRainLayer) {
            this.jackpotRainLayer.innerHTML = '';
        }

        const endTime = Date.now() + GAME_CONFIG.JACKPOT_ANIMATION_DURATION;
        const spawnRainCard = () => {
            if (!this.jackpotRainLayer) return;
            if (Date.now() > endTime) {
                if (this.jackpotInterval) {
                    clearInterval(this.jackpotInterval);
                    this.jackpotInterval = null;
                }
                return;
            }
            const card = this._createJackpotRainCard(primaryCharacter);
            if (!card) return;
            this.jackpotRainLayer.appendChild(card);
        };

        spawnRainCard();
        this.jackpotInterval = window.setInterval(spawnRainCard, 100);
        this.jackpotCleanupTimeout = window.setTimeout(() => {
            this._stopJackpotRain(true, false);
            this.jackpotFinalCleanupTimeout = window.setTimeout(() => this._stopJackpotRain(false), 7000);
        }, GAME_CONFIG.JACKPOT_ANIMATION_DURATION);
    }

    _createJackpotRainCard(character) {
        if (!character || !character.hash) return null;
        const card = document.createElement('div');
        card.className = 'character-card jackpot-rain-card';
        card.innerHTML = `<div class="image-container"><img src="/image/${character.hash}" alt="${character.name}"></div><div class="name">${character.name}</div>`;

        const scale = Math.random() * 0.6 + 0.6;
        const rotation = Math.random() * 120 - 60;
        const fallDuration = (Math.random() * 3 + 4) / Math.max(scale, 0.55);

        card.style.left = `${Math.random() * 100}vw`;
        card.style.setProperty('--card-scale', scale.toFixed(2));
        card.style.setProperty('--card-rotation', `${rotation.toFixed(2)}deg`);
        card.style.animationDuration = `${fallDuration.toFixed(2)}s, 2s`;
        card.style.animationDelay = `${(Math.random() * 0.5).toFixed(2)}s`;
        card.style.zIndex = `${Math.floor(Math.random() * 6) + 8}`;

        window.setTimeout(() => card.remove(), fallDuration * 1000 + 1200);
        return card;
    }

    _stopJackpotRain(removeBackdropClass = true, clearLayer = true) {
        if (this.jackpotInterval) {
            clearInterval(this.jackpotInterval);
            this.jackpotInterval = null;
        }
        if (this.jackpotCleanupTimeout) {
            clearTimeout(this.jackpotCleanupTimeout);
            this.jackpotCleanupTimeout = null;
        }
        if (this.jackpotFinalCleanupTimeout) {
            clearTimeout(this.jackpotFinalCleanupTimeout);
            this.jackpotFinalCleanupTimeout = null;
        }
        if (clearLayer && this.jackpotRainLayer) {
            this.jackpotRainLayer.innerHTML = '';
        }
        if (removeBackdropClass && this.backdrop) {
            this.backdrop.classList.remove('is-jackpot');
        }
    }
    
    // --- UI State Updates ---
    
    addLogEntry(logData) {
        if (!this.logContainer) return;

        let detailsHTML = `<span class="log-detail score-neutral">Điểm: ${logData.scoreBefore} -> ${logData.scoreAfter}</span>`;
        
        logData.outcome.eventsToDisplay.forEach(event => {
            let scorePart = '';
            if (event.score > 0) {
                scorePart = `<span class="score-positive">+${event.score}</span>`;
            } else if (event.score < 0) {
                scorePart = `<span class="score-negative">${event.score}</span>`;
            }

            const text = event.displayValue ? `${event.text} (${event.displayValue})` : event.text;
            detailsHTML += `<span class="log-detail">${text} ${scorePart}</span>`;
        });
        
        if (logData.outcome.freeSpinsAwarded > 0) {
            detailsHTML += `<span class="log-detail score-positive">+${logData.outcome.freeSpinsAwarded} Lượt miễn phí</span>`;
        }
        if (logData.outcome.respinCount > 0) {
            detailsHTML += `<span class="log-detail score-positive">+${logData.outcome.respinCount} Respin</span>`;
        }

        const entryHTML = `
            <div class="log-header">Lượt #${logData.spin}</div>
            ${detailsHTML}
        `;
        
        const entry = document.createElement('div');
        entry.className = 'slot-log-entry';
        entry.innerHTML = entryHTML;
        this.logContainer.prepend(entry);

        if (this.logContainer.children.length > 30) {
            this.logContainer.lastElementChild.remove();
        }
    }

    updateControlsDisplay(freeSpins, sessionScore, isSpinning, pickedHash) {
        if (!this.costIndicator) return;
        this.backdrop.querySelector('.slot-controls').classList.toggle('has-picked-card', !!pickedHash);
    
        const costEl = this.costIndicator.querySelector('[data-type="cost"]');
        const freeEl = this.costIndicator.querySelector('[data-type="free"]');
    
        const requiredFreeSpins = pickedHash ? 2 : 1;
        const hasEnoughFreeSpins = freeSpins >= requiredFreeSpins;
        const hasEnoughPoints = sessionScore >= GAME_CONFIG.SPIN_COST;
    
        // Logic hiển thị
        if (hasEnoughFreeSpins) {
            costEl.classList.remove('is-visible');
            freeEl.classList.add('is-visible');
            freeEl.querySelector('.free-spin-value').textContent = freeSpins;
        } else {
            costEl.classList.add('is-visible');
            freeEl.classList.remove('is-visible');
        }
    
        // Logic vô hiệu hóa nút
        this.spinBtn.disabled = isSpinning || (!hasEnoughFreeSpins && !hasEnoughPoints);
    }

    updateHighlights(pickedHash) {
        this.reelsContainer.classList.toggle('has-picked-card', !!pickedHash);
        this.reelsContainer.querySelectorAll('.character-card').forEach(card => {
            card.classList.toggle('is-picked', pickedHash && card.dataset.hash === pickedHash);
        });
    }

    setSpinningState(spinning) {
        this.spinBtn.disabled = spinning;
        this.spinBtn.querySelector('.material-symbols-outlined').textContent = spinning ? 'sync' : 'casino';
        // YUUKA: win effect v2.0 - Dọn dẹp highlight khi bắt đầu spin
        if (spinning) {
            this.clearHighlights();
        }
    }

    showScorePopup(text, score, type, displayValue = null) {
        const popup = document.createElement('div');
        popup.className = 'slot-score-popup';
        const inner = document.createElement('div');
        inner.className = `popup-inner score-popup--${type}`;
        const scoreText = displayValue !== null ? displayValue : (score > 0 ? `+${score}` : `${score}`);
        inner.innerHTML = `<div class="popup-text">${text}</div><div class="popup-score">${scoreText}</div>`;
        popup.appendChild(inner);
        this.popupContainer.appendChild(popup);
        
        const offsetX = (Math.random() - 0.5) * (this.isMobile ? 100 : 200);
        const offsetY = (Math.random() - 0.5) * (this.isMobile ? 50 : 80);
        popup.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        
        setTimeout(() => popup.remove(), type === 'jackpot' ? 10000 : 2000);
    }

    setFrameGlow(type, duration) {
        clearTimeout(this.glowTimeout);
        this.frame.className = 'slot-machine-frame';
        if (type) {
            requestAnimationFrame(() => {
                this.frame.classList.add(`is-${type}`);
                if (duration) {
                    this.glowTimeout = setTimeout(() => this.frame && this.frame.classList.remove(`is-${type}`), duration);
                }
            });
        }
    }
    
    // YUUKA: win effect v2.0 - Hàm mới để xóa tất cả các highlight
    clearHighlights() {
        clearTimeout(this.highlightTimer);
        this.reelsContainer.querySelectorAll('.character-card').forEach(c => {
            c.classList.remove('is-highlighted');
            c.className = c.className.replace(/\bis-winning-card-\w+\b/g, '');
        });
    }


    highlightWinningCards(winningGroups, finalCardIndices, reelCharacters) {
        this.clearHighlights();
        if (!winningGroups || winningGroups.length === 0) return;

        let currentGroupIndex = 0;

        const cycleHighlight = () => {
            // Xóa highlight của group cũ
            this.reelsContainer.querySelectorAll('.character-card.is-highlighted').forEach(card => {
                card.classList.remove('is-highlighted');
            });
            
            // Lấy group hiện tại
            const group = winningGroups[currentGroupIndex];
            const winningClass = `is-winning-card-${group.winLevel}`;
            
            // Áp dụng class cho các thẻ trong group
            group.coords.forEach(coordStr => {
                const [r, c] = coordStr.split(',').map(Number);
                const reelIndex = this.isMobile ? c : r;
                const inReelOffset = (this.isMobile ? r : c) - 1;

                const reel = this.reelsContainer.querySelectorAll(this.isMobile ? '.slot-strip' : '.slot-row')[reelIndex];
                if (!reel) return;
                
                const symbolsPerReel = reelCharacters[reelIndex].length;
                const centerIndexInStrip = finalCardIndices[reelIndex] + symbolsPerReel;
                const cardDomIndex = centerIndexInStrip + inReelOffset;
                const winningCard = reel.children[cardDomIndex];
                if (winningCard) {
                    winningCard.classList.add(winningClass, 'is-highlighted');
                }
            });

            // Chuyển sang group tiếp theo
            currentGroupIndex = (currentGroupIndex + 1) % winningGroups.length;
            this.highlightTimer = setTimeout(cycleHighlight, 800); // Thời gian nhấp nháy
        };
        
        cycleHighlight(); // Bắt đầu chu kỳ
    }
    
    updateStatsDisplay(stats) {
        this.backdrop.querySelector('#slot-score-session').textContent = stats.sessionScore;
        this.backdrop.querySelector('#slot-score-high').textContent = stats.highScore;
        this.backdrop.querySelector('#slot-jackpots-session').textContent = stats.sessionJackpots;
        this.backdrop.querySelector('#slot-jackpots-total').textContent = stats.totalJackpots;
        this.backdrop.querySelector('#slot-spins-session').textContent = stats.sessionSpins;
        this.backdrop.querySelector('#slot-spins-total').textContent = stats.totalSpins;
    }

    showStatDelta(statId, value) {
        const deltaEl = this.backdrop.querySelector(`#stat-${statId} .stat-delta`);
        if (!deltaEl) return;
        deltaEl.textContent = value;
        const isPositive = parseFloat(value) > 0;
        deltaEl.classList.toggle('is-positive', isPositive);
        deltaEl.classList.toggle('is-negative', !isPositive);
        deltaEl.classList.remove('animate');
        void deltaEl.offsetWidth; 
        deltaEl.classList.add('animate');
    }

    destroy() {
        this._stopJackpotRain();
        clearTimeout(this.glowTimeout);
        clearTimeout(this.highlightTimer);
        this.swapAnimationTimers.forEach(timer => clearTimeout(timer));
        this.swapAnimationTimers = [];
    }
}

