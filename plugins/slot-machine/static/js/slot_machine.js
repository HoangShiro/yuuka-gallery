// --- MODIFIED FILE: plugins/slot-machine/static/js/slot_machine.js ---
// Yuuka: Slot Machine plugin v2.0 - Main Service
import { GAME_CONFIG } from './constants.js';
import { ResultProcessor } from './result.js';
import { ReelManager } from './reel_manager.js';
import { UIController } from './ui_controller.js';

class SlotMachineService {
    constructor(container, api) {
        this.api = api;
        this.isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || window.matchMedia("(max-width: 800px)").matches;
        this.state = {};
        this._resetSessionState();

        // Persistent stats
        this.state.totalSpins = parseInt(localStorage.getItem('yuuka-slot-total-spins') || '0', 10);
        this.state.highScore = parseInt(localStorage.getItem('yuuka-slot-high-score') || '0', 10);
        this.state.totalJackpots = parseInt(localStorage.getItem('yuuka-slot-total-jackpots') || '0', 10);

        // Sub-controllers
        this.backdrop = null;
        this.ui = null;
        this.reels = null;

        // Promises & Timers
        this.resolvePromise = null;
        this.autoSpinTimer = null;
        this.resizeDebounceTimeout = null;

        this._handleResize = this._handleResize.bind(this);
        this._registerGlobalTriggers();
    }

    async start(options = {}) {
        if (this.backdrop) return;
        
        this._resetSessionState();

        try {
            const [charResponse, listsResponse] = await Promise.all([
                this.api.getAllCharacters(),
                this.api['character-list'].get('/lists')
            ]);
            const allCharacters = charResponse.characters;
            const blacklistedHashes = new Set(listsResponse.blacklist || []);
            this.state.characterPool = allCharacters.filter(c => !blacklistedHashes.has(c.hash));

            if (this.state.characterPool.length < GAME_CONFIG.MIN_CHARS_REQUIRED) {
                showError(`Cần ít nhất ${GAME_CONFIG.MIN_CHARS_REQUIRED} nhân vật để chơi.`);
                return;
            }
        } catch (error) {
            showError(`Lỗi khi tải dữ liệu game: ${error.message}`);
            return;
        }

        return new Promise(resolve => {
            this.resolvePromise = resolve;
            this._initUI();

            const reelConfig = {
                isMobile: this.isMobile,
                reelCount: this.isMobile ? GAME_CONFIG.MOBILE_COLUMN_COUNT : GAME_CONFIG.DESKTOP_ROW_COUNT,
                symbolsPerReel: this.isMobile ? GAME_CONFIG.MOBILE_SYMBOLS_PER_COLUMN : GAME_CONFIG.DESKTOP_SYMBOLS_PER_ROW,
            };
            this.reels = new ReelManager(this.state.characterPool, reelConfig);
            
            const reelCharacters = this.reels.generateAllReels();
            this.state.sessionSpecialMap = this.reels.assignSessionSpecialCards();
            
            this.ui.buildInitialReels(reelCharacters, this.state.pickedCharacterHash);
            this.ui.renderSpecialBadges(this.state.sessionSpecialMap);
            this.ui.animateToInitialPosition(reelCharacters);
            
            this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, this.state.isSpinning, this.state.pickedCharacterHash);
            this.ui.updateStatsDisplay(this.state);
            window.addEventListener('resize', this._handleResize);

            if (options.autoSpin) {
                setTimeout(() => this._handleSpin(options), 1100);
            }
        });
    }

    close() {
        clearTimeout(this.autoSpinTimer);
        clearTimeout(this.resizeDebounceTimeout);
        window.removeEventListener('resize', this._handleResize);
        if(this.ui) this.ui.destroy();
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }
        if (this.resolvePromise) {
            this.resolvePromise();
            this.resolvePromise = null;
        }
    }
    
    // --- Event Handlers ---
    
    _handleSpin(options = {}) {
        if (this.state.isSpinning) return;
        
        const { forceJackpot = false, demoMode = false, autoCredit = false } = options;
        let wasFreeSpin = false;
        let usedAutoCredit = false;

        if (!demoMode) {
            const spinCostResult = this._calculateSpinCost(autoCredit);
            if (!spinCostResult.canSpin) {
                if (!spinCostResult.reason) {
                    showError("Không đủ điểm hoặc lượt quay miễn phí.");
                }
                return;
            }
            wasFreeSpin = spinCostResult.wasFreeSpin;
            usedAutoCredit = spinCostResult.usedAutoCredit;
            this._updateStateForSpinStart(spinCostResult.pointsToUse, spinCostResult.freeSpinsToUse);

            const isOutOfResources = this.state.sessionScore === 0 && this.state.freeSpins === 0 && this.state.autoSpinCredits === 0;
            if (isOutOfResources && (!wasFreeSpin || usedAutoCredit)) {
                const randomSpins = Math.floor(Math.random() * 4) + 2;
                this.state.freeSpins += randomSpins;
                setTimeout(() => showError(`Bạn đã hết điểm! Tặng ${randomSpins} lượt quay miễn phí.`), 500);
            }
        }

        this.state.isSpinning = true;
        this.ui.setSpinningState(true);
        this.ui.setFrameGlow(null);
        
        const finalResults = this.reels.determineFinalResults(forceJackpot);
        const { spinPromises, finalCardIndices } = this.ui.animateSpin(
            finalResults,
            this.reels.reelCharacters,
            this.state.pickedCharacterHash,
            this.state.spinDirection
        );

        Promise.all(spinPromises).then(() => {
            this._processSpinResult(finalCardIndices, demoMode, this.state.pickedCharacterHash, wasFreeSpin);
            this.state.isSpinning = false;
            this.state.pickedCharacterHash = null;
            this.ui.updateHighlights(null);
            this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, false, null);
        });
    }
    
    _handleCardPick(e) {
        if (this.state.isSpinning) return;
        const card = e.target.closest('.character-card');
        if (!card) return;
        const hash = card.dataset.hash;
        this.state.pickedCharacterHash = (this.state.pickedCharacterHash === hash) ? null : hash;
        this.ui.updateHighlights(this.state.pickedCharacterHash);
        this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, this.state.isSpinning, this.state.pickedCharacterHash);
    }

    _handleResize() {
        clearTimeout(this.resizeDebounceTimeout);
        this.resizeDebounceTimeout = setTimeout(() => this.ui && this.ui.recenterReels(), 100);
    }

    // --- Private Logic ---

    _processSpinResult(finalCardIndices, demoMode, pickedHashBeforeSpin, wasFreeSpin) {
        const specialContext = this.reels.processSpecialsForGrid(finalCardIndices, this.state.sessionSpecialMap);
        this._applyClearEffects(finalCardIndices, specialContext);

        const grid = this._buildResultGrid(finalCardIndices);
        this._applySwapEffects(grid, finalCardIndices, specialContext);
        const resultProcessor = new ResultProcessor(grid, pickedHashBeforeSpin, wasFreeSpin, specialContext);
        const outcome = resultProcessor.calculate();
        const scoreBeforeOutcome = this.state.sessionScore;

        outcome.eventsToDisplay.forEach((event, index) => {
            setTimeout(() => this.ui.showScorePopup(event.text, event.score, event.type, event.displayValue), index * GAME_CONFIG.REVEAL_EVENT_DELAY);
        });
        
        this.ui.setFrameGlow(outcome.highestWinType, outcome.highestWinType === 'jackpot' ? null : 2400);
        // YUUKA: win effect v2.0 - Truyền mảng group vào hàm highlight
        this.ui.highlightWinningCards(outcome.winningGroups, finalCardIndices, this.reels.reelCharacters);

        if (outcome.highestWinType === 'jackpot') {
            const jackpotChar = grid[1] && grid[1][1] ? grid[1][1] : this.reels.reelCharacters[1]?.[finalCardIndices[1]];
            if (jackpotChar) {
                this.ui.triggerJackpotAnimation(jackpotChar);
            }
        }

        if (!demoMode) {
            this._updateStateFromOutcome(outcome);
            this._saveStats();
            this.ui.updateStatsDisplay(this.state);
            
            const logData = {
                spin: this.state.sessionSpins, // Already incremented
                scoreBefore: scoreBeforeOutcome,
                scoreAfter: this.state.sessionScore, // The new score
                outcome: outcome
            };
            this.ui.addLogEntry(logData);
        }
        
        if (outcome.respinCount > 0) {
            this.state.autoSpinCredits += outcome.respinCount;
            this._scheduleAutoSpin(demoMode);
        }
        if (outcome.reverseSpinCount > 0) {
            this._applyReverseSpin(outcome.reverseSpinCount);
        }
    }

    _calculateSpinCost(autoCredit) {
        let pointsToUse = 0, freeSpinsToUse = 0, canSpin = false, wasFreeSpin = false, reason = '', usedAutoCredit = false;
    
        if (autoCredit && this.state.autoSpinCredits > 0) {
            canSpin = wasFreeSpin = true;
            usedAutoCredit = true;
            this.state.autoSpinCredits--;
        } else {
            // Priority 1: Use Free Spins if available
            const requiredFreeSpins = this.state.pickedCharacterHash ? 2 : 1;
            if (this.state.freeSpins >= requiredFreeSpins) {
                canSpin = true;
                wasFreeSpin = true;
                freeSpinsToUse = requiredFreeSpins;
            } 
            // Priority 2: Use Points if free spins are not enough
            else if (this.state.sessionScore >= GAME_CONFIG.SPIN_COST) {
                canSpin = true;
                wasFreeSpin = false;
                pointsToUse = GAME_CONFIG.SPIN_COST;
            }
            // Cannot spin
            else {
                canSpin = false;
                if (this.state.sessionScore < GAME_CONFIG.SPIN_COST && this.state.freeSpins < 1) {
                    reason = 'needs_refill';
                }
            }
        }
        
        return { canSpin, pointsToUse, freeSpinsToUse, wasFreeSpin, reason, usedAutoCredit };
    }

    _updateStateForSpinStart(points, freeSpins) {
        this.state.freeSpins -= freeSpins;
        this.state.sessionScore -= points;
        this.state.sessionSpins++;
        this.state.totalSpins++;
        
        this.ui.showStatDelta('spins', '+1');
        if (points > 0) this.ui.showStatDelta('score', `-${points}`);
        this.ui.updateStatsDisplay(this.state);
        this.ui.updateControlsDisplay(this.state.freeSpins, this.state.sessionScore, true, this.state.pickedCharacterHash);
    }
    
    _updateStateFromOutcome(outcome) {
        if (outcome.totalScore !== 0) {
            this.ui.showStatDelta('score', outcome.totalScore > 0 ? `+${outcome.totalScore}` : outcome.totalScore);
        }
        this.state.sessionScore += outcome.totalScore;
        this.state.sessionScore = Math.max(0, this.state.sessionScore);
        this.state.freeSpins += outcome.freeSpinsAwarded;

        if (this.state.sessionScore > this.state.highScore) {
            this.state.highScore = this.state.sessionScore;
        }
        if (outcome.highestWinType === 'jackpot') {
            this.state.sessionJackpots++;
            this.state.totalJackpots++;
            this.ui.showStatDelta('jackpots', '+1');
        }
    }

    _buildResultGrid(finalCardIndices) {
        const grid = Array.from({ length: 3 }, () => Array(3));
        for (let i = 0; i < this.reels.reelCount; i++) {
            const reel = this.reels.reelCharacters[i];
            const centerIdx = finalCardIndices[i];
            const len = reel.length;
            const indices = [(centerIdx - 1 + len) % len, centerIdx, (centerIdx + 1) % len];
            
            for (let j = 0; j < 3; j++) {
                const r = this.isMobile ? j : i;
                const c = this.isMobile ? i : j;
                grid[r][c] = reel[indices[j]];
            }
        }
        return grid;
    }

    _applyClearEffects(finalCardIndices, specialContext) {
        const summary = specialContext?.summary;
        if (!summary || !Array.isArray(summary.clears) || summary.clears.length === 0) return;

        const visibleKeys = this._collectVisibleSessionKeys(finalCardIndices);
        if (visibleKeys.size === 0) return;

        const assignments = specialContext.assignments || {};
        const effectsToMove = [];

        Object.entries(assignments).forEach(([gridKey, assignment]) => {
            if (!assignment) return;
            const sessionKey = assignment.sessionKey || assignment.effect?.__sessionKey;
            if (!sessionKey || !visibleKeys.has(sessionKey)) return;
            if (assignment.effect?.category === 'clear') return;
            const rawEffect = this.state.sessionSpecialMap.get(sessionKey);
            if (!rawEffect) return;
            effectsToMove.push({
                gridKey,
                assignment,
                sessionKey,
                rawEffect
            });
        });

        if (effectsToMove.length === 0) return;

        const movedSessionKeys = new Set();
        effectsToMove.forEach(item => {
            movedSessionKeys.add(item.sessionKey);
            delete assignments[item.gridKey];
            this.state.sessionSpecialMap.delete(item.sessionKey);
        });

        const filterBySessionKey = (collection) => Array.isArray(collection)
            ? collection.filter(effect => !effect?.__sessionKey || !movedSessionKeys.has(effect.__sessionKey))
            : collection;

        summary.multipliers = filterBySessionKey(summary.multipliers);
        summary.penalties = filterBySessionKey(summary.penalties);
        summary.freeSpins = filterBySessionKey(summary.freeSpins);
        summary.bonusPoints = filterBySessionKey(summary.bonusPoints);
        summary.swaps = Array.isArray(summary.swaps)
            ? summary.swaps.filter(entry => !entry?.effect?.__sessionKey || !movedSessionKeys.has(entry.effect.__sessionKey))
            : [];
        summary.clears = Array.isArray(summary.clears) ? summary.clears : [];
        summary.clearReassignments = [];

        if (typeof summary.respins === 'number' && summary.respins > 0) {
            let respinReduction = 0;
            effectsToMove.forEach(item => {
                if (item.assignment.effect?.category === 'respin') {
                    respinReduction += item.assignment.effect.respins || item.rawEffect?.respins || 0;
                }
            });
            if (respinReduction > 0) {
                summary.respins = Math.max(0, summary.respins - respinReduction);
            }
        }

        const availableTargets = this._collectAvailableSessionSlots(visibleKeys);
        const reassignments = [];

        const restoreEffectInSummary = (effectWrapper) => {
            if (!effectWrapper) return;
            const effect = effectWrapper.effect || effectWrapper;
            switch (effect.category) {
                case 'multiplier':
                    summary.multipliers.push(effect);
                    break;
                case 'penalty':
                    summary.penalties.push(effect);
                    break;
                case 'free-spin':
                    summary.freeSpins.push(effect);
                    break;
                case 'bonus-points':
                    summary.bonusPoints.push(effect);
                    break;
                case 'swap':
                    summary.swaps.push(effectWrapper);
                    break;
                case 'clear':
                    summary.clears.push(effectWrapper);
                    break;
                case 'respin':
                    summary.respins += effect.respins || 1;
                    break;
            }
        };

        effectsToMove.forEach(item => {
            let target = null;
            if (availableTargets.length > 0) {
                const idx = Math.floor(Math.random() * availableTargets.length);
                target = availableTargets.splice(idx, 1)[0];
            }

            if (!target) {
                // No available slot outside the frame; restore original assignment.
                this.state.sessionSpecialMap.set(item.sessionKey, item.rawEffect);
                assignments[item.gridKey] = item.assignment;
                restoreEffectInSummary(item.assignment.effect?.category === 'swap' ? item.assignment : item.assignment.effect);
                reassignments.push({
                    from: item.sessionKey,
                    to: item.sessionKey,
                    effectId: item.assignment.effect?.id,
                    stuck: true
                });
                return;
            }

            this.state.sessionSpecialMap.set(target.key, item.rawEffect);
            reassignments.push({
                from: item.sessionKey,
                to: target.key,
                effectId: item.assignment.effect?.id,
                stuck: false
            });
        });

        summary.clearReassignments = reassignments;

        if (this.ui) {
            this.ui.renderSpecialBadges(this.state.sessionSpecialMap);
        }
    }

    _collectVisibleSessionKeys(finalCardIndices) {
        const visibleKeys = new Set();
        if (!this.reels || !Array.isArray(this.reels.reelCharacters)) return visibleKeys;

        for (let i = 0; i < this.reels.reelCharacters.length; i++) {
            const reel = this.reels.reelCharacters[i];
            const centerIdx = finalCardIndices[i];
            if (!Array.isArray(reel) || reel.length === 0 || typeof centerIdx !== 'number') continue;

            const len = reel.length;
            const indices = [(centerIdx - 1 + len) % len, centerIdx, (centerIdx + 1) % len];
            indices.forEach(charIndex => visibleKeys.add(`${i},${charIndex}`));
        }

        return visibleKeys;
    }

    _collectAvailableSessionSlots(visibleKeys) {
        const slots = [];
        if (!this.reels || !Array.isArray(this.reels.reelCharacters)) return slots;

        for (let reelIndex = 0; reelIndex < this.reels.reelCharacters.length; reelIndex++) {
            const reel = this.reels.reelCharacters[reelIndex];
            if (!Array.isArray(reel)) continue;

            for (let charIndex = 0; charIndex < reel.length; charIndex++) {
                const key = `${reelIndex},${charIndex}`;
                if (visibleKeys.has(key)) continue;
                if (this.state.sessionSpecialMap.has(key)) continue;
                slots.push({ key, reelIndex, charIndex });
            }
        }

        return slots;
    }

    _applySwapEffects(grid, finalCardIndices, specialContext) {
        if (!this.ui) return;

        const swaps = specialContext?.summary?.swaps;
        if (!swaps || swaps.length === 0) return;
        let hasAppliedSwap = false;
        const executedSwaps = [];

        swaps.forEach(entry => {
            const { position } = entry;
            if (!position || !grid[position.row]) return;

            const sourceCell = this._resolveGridCell(position.row, position.column, finalCardIndices);
            if (!sourceCell) return;

            const swapMode = entry.effect?.swapMode || 'adjacent';
            const targetCell = (swapMode === 'row-any')
                ? this._getRowSwapTarget(position, sourceCell, finalCardIndices)
                : this._getAdjacentSwapTarget(position, finalCardIndices, grid);
            if (!targetCell) return;

            const sourceReel = this.reels.reelCharacters[sourceCell.reelIndex];
            const targetReel = this.reels.reelCharacters[targetCell.reelIndex];
            if (!sourceReel || !targetReel) return;

            const sourceCharBefore = sourceReel[sourceCell.charIndex];
            const targetCharBefore = targetReel[targetCell.charIndex];
            if (!sourceCharBefore || !targetCharBefore) return;

            this._swapReelCharacters(sourceCell, targetCell);

            const updatedSourceChar = this.reels.reelCharacters[sourceCell.reelIndex]?.[sourceCell.charIndex];
            const updatedTargetChar = this.reels.reelCharacters[targetCell.reelIndex]?.[targetCell.charIndex];

            grid[position.row][position.column] = updatedSourceChar;
            if (targetCell.isVisible && typeof targetCell.row === 'number' && typeof targetCell.column === 'number' && grid[targetCell.row]) {
                grid[targetCell.row][targetCell.column] = updatedTargetChar;
            }

            this.ui.applySwapVisuals(sourceCell, targetCell, finalCardIndices, this.reels.reelCharacters);

            entry.target = targetCell.isVisible
                ? { row: targetCell.row, column: targetCell.column }
                : null;
            const sourceName = sourceCharBefore?.name || 'SWAP';
            const targetName = targetCharBefore?.name || 'RANDOM';
            entry.displayLabel = `${sourceName} <-> ${targetName}`;
            entry.sourceCharacter = sourceCharBefore;
            entry.targetCharacter = targetCharBefore;
            hasAppliedSwap = true;
            executedSwaps.push(entry);
        });

        if (hasAppliedSwap) {
            specialContext.summary.swaps = executedSwaps;
        } else {
            specialContext.summary.swaps = [];
        }

        if (hasAppliedSwap) {
            this.ui.updateHighlights(this.state.pickedCharacterHash);
        }
    }

    _resolveGridCell(row, column, finalCardIndices) {
        const reelIndex = this.isMobile ? column : row;
        const reel = this.reels.reelCharacters[reelIndex];
        const centerIndex = finalCardIndices[reelIndex];

        if (!reel || reel.length === 0 || typeof centerIndex !== 'number') return null;

        const len = reel.length;
        const offset = (this.isMobile ? row : column) - 1;
        const charIndex = (centerIndex + offset + len) % len;

        return { reelIndex, charIndex, row, column };
    }

    _getAdjacentSwapTarget(position, finalCardIndices, grid) {
        const rowEntries = grid[position.row];
        if (!rowEntries) return null;

        const maxColumn = rowEntries.length - 1;
        const candidates = [];

        const addCandidate = (column) => {
            if (column >= 0 && column <= maxColumn && rowEntries[column]) {
                candidates.push(column);
            }
        };

        addCandidate(position.column - 1);
        addCandidate(position.column + 1);

        if (candidates.length === 0) {
            for (let column = 0; column <= maxColumn; column++) {
                if (column !== position.column && rowEntries[column]) {
                    candidates.push(column);
                }
            }
        }
        if (candidates.length === 0) return null;

        const targetColumn = candidates[Math.floor(Math.random() * candidates.length)];
        const cell = this._resolveGridCell(position.row, targetColumn, finalCardIndices);
        if (!cell) return null;
        cell.isVisible = true;
        return cell;
    }

    _getRowSwapTarget(position, sourceCell, finalCardIndices) {
        const reel = this.reels.reelCharacters[sourceCell.reelIndex];
        if (!reel || reel.length <= 1) return null;

        const availableIndices = [];
        for (let idx = 0; idx < reel.length; idx++) {
            if (idx !== sourceCell.charIndex) availableIndices.push(idx);
        }
        if (availableIndices.length === 0) return null;

        const targetCharIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        const targetCell = {
            reelIndex: sourceCell.reelIndex,
            charIndex: targetCharIndex,
            row: position.row,
            column: null,
            isVisible: false
        };

        const placement = this._locateCharInGrid(targetCell.reelIndex, targetCharIndex, finalCardIndices);
        if (placement) {
            targetCell.row = placement.row;
            targetCell.column = placement.column;
            targetCell.isVisible = true;
        }

        return targetCell;
    }

    _locateCharInGrid(reelIndex, charIndex, finalCardIndices) {
        const reel = this.reels.reelCharacters[reelIndex];
        if (!reel || reel.length === 0) return null;

        const centerIndex = finalCardIndices[reelIndex];
        if (typeof centerIndex !== 'number') return null;

        const len = reel.length;
        const offsets = [-1, 0, 1];

        for (let idx = 0; idx < offsets.length; idx++) {
            const candidateIndex = (centerIndex + offsets[idx] + len) % len;
            if (candidateIndex === charIndex) {
                if (this.isMobile) {
                    return { row: idx, column: reelIndex };
                }
                return { row: reelIndex, column: idx };
            }
        }
        return null;
    }

    _swapReelCharacters(cellA, cellB) {
        const reelA = this.reels.reelCharacters[cellA.reelIndex];
        const reelB = this.reels.reelCharacters[cellB.reelIndex];
        if (!reelA || !reelB) return;

        const temp = reelA[cellA.charIndex];
        reelA[cellA.charIndex] = reelB[cellB.charIndex];
        reelB[cellB.charIndex] = temp;
    }

    _saveStats() {
        localStorage.setItem('yuuka-slot-total-spins', this.state.totalSpins);
        localStorage.setItem('yuuka-slot-high-score', this.state.highScore);
        localStorage.setItem('yuuka-slot-total-jackpots', this.state.totalJackpots);
    }

    _scheduleAutoSpin(demoMode) {
        clearTimeout(this.autoSpinTimer);
        this.autoSpinTimer = setTimeout(() => {
            if (!this.backdrop || this.state.isSpinning || this.state.autoSpinCredits <= 0) return;
            this._handleSpin({ demoMode, autoCredit: true });
        }, GAME_CONFIG.AUTO_SPIN_DELAY);
    }

    _applyReverseSpin(triggerCount) {
        if (!triggerCount) return;
        if (triggerCount % 2 === 0) return;
        this.state.spinDirection = this.state.spinDirection === 1 ? -1 : 1;
    }

    _resetSessionState() {
        this.state = {
            ...this.state,
            characterPool: [],
            isSpinning: false,
            pickedCharacterHash: null,
            sessionSpins: 0,
            sessionScore: 0,
            sessionJackpots: 0,
            freeSpins: 5,
            autoSpinCredits: 0,
            sessionSpecialMap: new Map(),
            spinDirection: 1,
        };
    }
    
    // --- Initial Setup ---

    _initUI() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = `slot-machine-backdrop ${this.isMobile ? 'is-mobile' : ''}`;
        
        let reelsHTML = '';
        if (this.isMobile) {
            reelsHTML = Array.from({ length: GAME_CONFIG.MOBILE_COLUMN_COUNT }, (_, i) => 
                `<div class="slot-column" data-col-index="${i}"><div class="slot-strip"></div></div>`
            ).join('');
        } else {
            reelsHTML = Array.from({ length: GAME_CONFIG.DESKTOP_ROW_COUNT }, (_, i) => 
                `<div class="slot-row" data-row-index="${i}"></div>`
            ).join('');
        }

        this.backdrop.innerHTML = `
             <div class="slot-log-container"></div>
             <div class="slot-score-popup-container"></div>
             <div class="slot-jackpot-rain-layer" aria-hidden="true"></div>
             <div class="slot-stats">
                <div id="stat-score" class="stat-item"><span class="material-symbols-outlined">military_tech</span><span class="stat-value"><span id="slot-score-session">0</span>/<span id="slot-score-high">0</span></span><span class="stat-delta"></span></div>
                <div id="stat-jackpots" class="stat-item"><span class="material-symbols-outlined">emoji_events</span><span class="stat-value"><span id="slot-jackpots-session">0</span>/<span id="slot-jackpots-total">0</span></span><span class="stat-delta"></span></div>
                <div id="stat-spins" class="stat-item"><span class="material-symbols-outlined">replay</span><span class="stat-value"><span id="slot-spins-session">0</span>/<span id="slot-spins-total">0</span></span><span class="stat-delta"></span></div>
             </div>
             <div class="slot-machine-reels-container">
                <div class="slot-machine-frame"></div>
                ${reelsHTML}
             </div>
             <div class="slot-controls">
                <div class="slot-cost-indicator">
                    <div data-type="cost"><span class="material-symbols-outlined">military_tech</span><span class="cost-value">${GAME_CONFIG.SPIN_COST}</span></div>
                    <div data-type="free"><span class="material-symbols-outlined">redeem</span><span class="free-spin-value">0</span></div>
                </div>
                <button class="slot-spin-btn"><span class="material-symbols-outlined">casino</span></button>
             </div>
             <button class="slot-close-btn"><span class="material-symbols-outlined">close</span></button>
        `;
        document.body.appendChild(this.backdrop);
        this.ui = new UIController(this.backdrop, this.isMobile);

        this.ui.spinBtn.addEventListener('click', () => this._handleSpin());
        this.backdrop.querySelector('.slot-close-btn').addEventListener('click', () => this.close());
        this.ui.reelsContainer.addEventListener('click', this._handleCardPick.bind(this));
    }
    
    _registerGlobalTriggers() {
        document.getElementById('search-form').addEventListener('submit', (e) => {
            const searchBox = document.getElementById('search-box');
            if (searchBox.value.trim() === '/jackpot') {
                e.preventDefault(); searchBox.value = '';
                this.start({ autoSpin: true, forceJackpot: true, demoMode: true });
            }
        });
        document.querySelector('.container').addEventListener('dblclick', (e) => {
             if (e.target.closest('.plugin-container')) this.start();
        });
    }
}

window.Yuuka.components['SlotMachineService'] = SlotMachineService;


