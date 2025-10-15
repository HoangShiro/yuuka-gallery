// --- MODIFIED FILE: plugins/slot-machine/static/js/result.js ---
// Yuuka: Handles win calculation logic from a 3x3 grid.
import { SCORE_MAP, WIN_TYPE_NAMES } from './constants.js';

export class ResultProcessor {
    constructor(grid, pickedCharacterHash, wasFreeSpin, specialContext) {
        this.grid = grid;
        this.pickedCharacterHash = pickedCharacterHash;
        this.wasFreeSpin = wasFreeSpin;
        this.specialContext = specialContext || { summary: {} };
        if (!this.specialContext.summary) {
            this.specialContext.summary = {};
        }
        const summary = this.specialContext.summary;
        summary.multipliers = summary.multipliers || [];
        summary.penalties = summary.penalties || [];
        summary.freeSpins = summary.freeSpins || [];
        summary.respins = typeof summary.respins === 'number' ? summary.respins : 0;
        summary.bonusPoints = summary.bonusPoints || [];
        summary.swaps = summary.swaps || [];
        summary.clears = summary.clears || [];
        summary.clearReassignments = summary.clearReassignments || [];
        summary.reverseSpins = summary.reverseSpins || [];

        this.baseWins = [];
        // YUUKA: win effect v2.0 - Thay đổi cấu trúc dữ liệu
        this.winningGroups = [];
        this.processedCoords = new Set();
        this.highestWinType = 'none';
        this.allCoords = Array.from({length: 3}, (_, r) => Array.from({length: 3}, (_, c) => [r, c])).flat();
    }
    
    // Main calculation method
    calculate() {
        this._findBaseWins();

        let totalScoreForTurn = 0;
        const eventsToDisplay = [];

        // 1. Process base wins
        this.baseWins.forEach(win => {
            totalScoreForTurn += win.score;
            eventsToDisplay.push({
                text: WIN_TYPE_NAMES[win.type] || '', score: win.score,
                type: this.highestWinType === 'jackpot' ? 'jackpot' : (this.highestWinType === 'nearmiss' ? 'nearmiss' : 'normal')
            });
        });

        // 2. Apply picked character bonus/penalty
        const pickedBonus = this._applyPickedCharacterBonus();
        if (pickedBonus.score !== 0) {
            totalScoreForTurn += pickedBonus.score;
            eventsToDisplay.push({
                text: pickedBonus.text, score: pickedBonus.score,
                type: pickedBonus.score > 0 ? 'normal' : 'penalty'
            });
        }
        
        // 3. Apply special card effects
        const specialEffects = this._applySpecialCardEffects(totalScoreForTurn);
        totalScoreForTurn = specialEffects.finalScore;
        eventsToDisplay.push(...specialEffects.events);

        return {
            totalScore: totalScoreForTurn,
            highestWinType: this.highestWinType,
            // YUUKA: win effect v2.0 - Trả về mảng các group
            winningGroups: this.winningGroups,
            freeSpinsAwarded: specialEffects.freeSpinsAwarded,
            respinCount: this.specialContext.summary.respins || 0,
            reverseSpinCount: this.specialContext.summary.reverseSpins ? this.specialContext.summary.reverseSpins.length : 0,
            eventsToDisplay,
        };
    }

    _findBaseWins() {
        // YUUKA: Jackpot Rework v1.0 - Check middle row AND column first
        const jackpotLines = [
            { coords: [[1, 0], [1, 1], [1, 2]] }, // Middle row
            { coords: [[0, 1], [1, 1], [2, 1]] }  // Middle column
        ];

        for (const { coords } of jackpotLines) {
            const chars = coords.map(([r, c]) => this.grid[r][c]);
            if (chars.every(c => c && c.hash === chars[0].hash)) {
                this._addWin('BIG_JACKPOT', chars[0].hash, SCORE_MAP.NORMAL_WIN_BIG_JACKPOT, coords, 'jackpot');
            }
        }

        // Find 3-in-a-line (excluding jackpot lines)
        const lines = [
            [[0, 0], [0, 1], [0, 2]], // Top row
            [[2, 0], [2, 1], [2, 2]], // Bottom row
            [[0, 0], [1, 0], [2, 0]], // Left col
            [[0, 2], [1, 2], [2, 2]], // Right col
            [[0, 0], [1, 1], [2, 2]], // Diagonal TL-BR
            [[0, 2], [1, 1], [2, 0]]  // Diagonal TR-BL
        ];
        lines.forEach(line => this._checkLine(line));

        // Find 3-of-a-kind (scatter)
        this._findScatters(3, (hash, data) => {
            const score = data.midCols === 2 ? SCORE_MAP.NORMAL_WIN_3_SCATTER_2_MID : SCORE_MAP.NORMAL_WIN_3_SCATTER_1_MID;
            this._addWin('3_SCATTER', hash, score, data.coords, 'normal-win');
        });

        // Find 2-of-a-kind (adjacent pairs)
        this._findPairs();
    }
    
    _applyPickedCharacterBonus() {
        let bonusInfo = { score: 0, type: null, text: '' };
        if (!this.pickedCharacterHash) return bonusInfo;

        const pickedWins = this.baseWins.filter(win => win.hash === this.pickedCharacterHash);
        if (pickedWins.length > 0) {
            const highestPickedWin = pickedWins.sort((a,b) => b.score - a.score)[0];
            let multiplier = 1;
            switch (highestPickedWin.type) {
                case 'BIG_JACKPOT': multiplier = SCORE_MAP.PICKED_MULTIPLIER_BIG_JACKPOT; break;
                case '3_LINE':      multiplier = SCORE_MAP.PICKED_MULTIPLIER_3_LINE; break;
                case '3_SCATTER':   multiplier = SCORE_MAP.PICKED_MULTIPLIER_3_SCATTER; break;
                case '2_KIND':      multiplier = SCORE_MAP.PICKED_MULTIPLIER_2_KIND; break;
            }
            bonusInfo.score = highestPickedWin.score * (multiplier - 1);
            bonusInfo.text = `PICK x${multiplier}`;
        } else {
            const count = this.allCoords.filter(([r,c]) => this.grid[r][c]?.hash === this.pickedCharacterHash).length;
            if (count === 3) bonusInfo = { score: SCORE_MAP.PICKED_BONUS_3_SCATTER, type: 'PICKED_BONUS_3_SCATTER' };
            else if (count === 2) bonusInfo = { score: SCORE_MAP.PICKED_BONUS_2_SCATTER, type: 'PICKED_BONUS_2_SCATTER' };
            else if (count === 1) bonusInfo = { score: SCORE_MAP.PICKED_BONUS_ONE_SHOW, type: 'PICKED_BONUS_ONE_SHOW' };
            else if (count === 0 && !this.wasFreeSpin) bonusInfo = { score: SCORE_MAP.PICKED_PENALTY_NO_SHOW, type: 'PICKED_PENALTY_NO_SHOW' };
            if(bonusInfo.type) bonusInfo.text = WIN_TYPE_NAMES[bonusInfo.type] || '';
        }
        return bonusInfo;
    }

    _applySpecialCardEffects(currentScore) {
        const events = [];
        let finalScore = currentScore;
        let freeSpinsAwarded = 0;

        // Multipliers
        const summary = this.specialContext.summary;
        if (summary.multipliers && summary.multipliers.length > 0) {
            let multiplierFactor = 1;
            const labels = [];
            summary.multipliers.forEach(effect => {
                multiplierFactor *= effect.multiplier || 1;
                labels.push(effect.badgeLabel || `x${effect.multiplier}`);
            });
            const gain = Math.round(finalScore * multiplierFactor) - finalScore;
            finalScore += gain;
            events.push({ text: 'MULTIPLIER', score: gain, type: gain >= 0 ? 'bonus' : 'penalty', displayValue: labels.join(' x ') });
        }
        // Penalties
        if (summary.penalties && summary.penalties.length > 0) {
            summary.penalties.forEach(effect => {
                if (typeof effect.scoreDelta === 'number') {
                    finalScore += effect.scoreDelta;
                    events.push({ text: 'PENALTY', score: effect.scoreDelta, type: 'penalty', displayValue: effect.badgeLabel });
                }
            });
        }
        // Bonus Points
        if (summary.bonusPoints && summary.bonusPoints.length > 0) {
            summary.bonusPoints.forEach(effect => {
                if (typeof effect.scoreDelta === 'number') {
                    finalScore += effect.scoreDelta;
                    events.push({ text: 'BONUS', score: effect.scoreDelta, type: 'bonus', displayValue: `+${effect.scoreDelta}` });
                }
            });
        }
        // Free Spins
        if (summary.freeSpins && summary.freeSpins.length > 0) {
            summary.freeSpins.forEach(effect => {
                if (effect.freeSpins) {
                    freeSpinsAwarded += effect.freeSpins;
                    events.push({ text: 'FREE SPINS', score: 0, type: 'bonus', displayValue: `+${effect.freeSpins}` });
                }
            });
        }
        // Swaps (visual log only)
        if (summary.swaps && summary.swaps.length > 0) {
            summary.swaps.forEach(entry => {
                const label = entry.displayLabel || 'SWAP';
                events.push({ text: 'SWAP', score: 0, type: 'bonus', displayValue: label });
            });
        }
        // Clear (visual log only)
        if (summary.clears && summary.clears.length > 0) {
            const successfulMoves = Array.isArray(summary.clearReassignments)
                ? summary.clearReassignments.filter(item => !item.stuck).length
                : 0;
            const displayValue = summary.clearReassignments && summary.clearReassignments.length > 0
                ? `${successfulMoves}/${summary.clearReassignments.length} MOVED`
                : 'SHIFT';
            events.push({ text: 'CLEAR', score: 0, type: 'bonus', displayValue });
        }
        // Respins (handled separately, just create event)
        if (summary.respins > 0) {
             events.push({ text: 'RESPIN', score: 0, type: 'bonus', displayValue: summary.respins > 1 ? `x${summary.respins}` : 'AUTO' });
        }
        if (summary.reverseSpins && summary.reverseSpins.length > 0) {
            const triggerCount = summary.reverseSpins.length;
            events.push({ text: 'REVERSE', score: 0, type: 'bonus', displayValue: triggerCount > 1 ? `x${triggerCount}` : 'REV' });
        }
        return { finalScore, events, freeSpinsAwarded };
    }

    // --- Helper methods for finding wins ---

    _addWin(type, hash, score, coords, winLevel) {
        if (coords.some(c => this.processedCoords.has(c.join(',')))) return;
        this.baseWins.push({ type, hash, score });
        // YUUKA: win effect v2.0 - Thêm vào winningGroups
        this.winningGroups.push({
            winLevel,
            coords: coords.map(c => c.join(','))
        });
        coords.forEach(c => {
            this.processedCoords.add(c.join(','));
        });
        if (winLevel === 'jackpot') {
            this.highestWinType = 'jackpot';
        } else if (winLevel === 'nearmiss' && this.highestWinType !== 'jackpot') {
            this.highestWinType = 'nearmiss';
        } else if (winLevel === 'normal-win' && this.highestWinType === 'none') {
            this.highestWinType = 'normal-win';
        }
    }
    
    _checkLine(lineCoords) {
        const chars = lineCoords.map(([r, c]) => this.grid[r][c]);
        if (chars.every(c => c && c.hash === chars[0].hash)) {
            this._addWin('3_LINE', chars[0].hash, SCORE_MAP.NORMAL_WIN_3_LINE, lineCoords, 'nearmiss');
        }
    }

    _findScatters(count, callback) {
        const remainingCoords = this.allCoords.filter(([r, c]) => !this.processedCoords.has(`${r},${c}`));
        const charCounts = remainingCoords.reduce((acc, [r, c]) => {
            const char = this.grid[r][c];
            if (char) {
                if (!acc[char.hash]) acc[char.hash] = { count: 0, midCols: 0, coords: [] };
                acc[char.hash].count++;
                acc[char.hash].coords.push([r, c]);
                if (c === 1) acc[char.hash].midCols++;
            }
            return acc;
        }, {});
        for (const hash in charCounts) {
            if (charCounts[hash].count === count) {
                callback(hash, charCounts[hash]);
            }
        }
    }

    _findPairs() {
        let coordsForPairCheck = this.allCoords.filter(([r, c]) => !this.processedCoords.has(`${r},${c}`));
        const adjacencyDeltas = [[0, 1], [1, 0], [1, 1], [1, -1]];
        while (coordsForPairCheck.length > 0) {
            const [r1, c1] = coordsForPairCheck.shift();
            const char1 = this.grid[r1][c1];
            if (!char1) continue;
            for (const [dr, dc] of adjacencyDeltas) {
                const r2 = r1 + dr, c2 = c1 + dc;
                const neighborIndex = coordsForPairCheck.findIndex(([nr, nc]) => nr === r2 && nc === c2);
                if (neighborIndex !== -1) {
                    const char2 = this.grid[r2][c2];
                    if (char2 && char1.hash === char2.hash) {
                        this._addWin('2_KIND', char1.hash, SCORE_MAP.NORMAL_WIN_2_KIND, [[r1, c1], [r2, c2]], 'normal-win');
                        coordsForPairCheck.splice(neighborIndex, 1);
                        break;
                    }
                }
            }
        }
    }
}
