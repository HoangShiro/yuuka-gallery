// --- MODIFIED FILE: plugins/slot-machine/static/js/reel_manager.js ---
// Yuuka: Manages reel data, character selection, and special card assignment.
import { SPECIAL_CARD_CONFIGS } from './constants.js';

export class ReelManager {
    constructor(characterPool, config) {
        this.characterPool = characterPool;
        this.isMobile = config.isMobile;
        this.reelCount = config.reelCount;
        this.symbolsPerReel = config.symbolsPerReel;
        this.reelCharacters = [];
    }

    generateAllReels() {
        const availableChars = [...this.characterPool];
        const selectedChars = new Set();
        
        const targetSize = Math.min(this.symbolsPerReel, availableChars.length);
        while(selectedChars.size < targetSize && availableChars.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableChars.length);
            selectedChars.add(availableChars.splice(randomIndex, 1)[0]);
        }
        const baseReelSet = Array.from(selectedChars);

        this.reelCharacters = [];
        for (let i = 0; i < this.reelCount; i++) {
            const shuffledReel = [...baseReelSet].sort(() => Math.random() - 0.5);
            this.reelCharacters.push(shuffledReel);
        }
        return this.reelCharacters;
    }

    determineFinalResults(forceJackpot = false) {
        if (forceJackpot) {
            const sourceReel = this.reelCharacters.find(reel => Array.isArray(reel) && reel.length > 0);
            const jackpotChar = sourceReel
                ? sourceReel[Math.floor(Math.random() * sourceReel.length)]
                : this.characterPool[Math.floor(Math.random() * this.characterPool.length)];
            return Array.from({ length: this.reelCount }, () => jackpotChar);
        }
        return this.reelCharacters.map(reel => reel.length > 0 ? reel[Math.floor(Math.random() * reel.length)] : null);
    }

    /**
     * Yuuka: Gán các special card một lần duy nhất cho toàn bộ guồng quay khi bắt đầu game.
     * Mỗi loại special card chỉ xuất hiện một lần.
     * @returns {Map<string, object>} - Map với key là 'reelIndex,charIndex' và value là effect.
     */
    assignSessionSpecialCards() {
        const sessionAssignment = new Map();
        const allPossiblePositions = [];

        // Lấy tất cả các vị trí có thể có trên tất cả các guồng
        for (let reelIndex = 0; reelIndex < this.reelCharacters.length; reelIndex++) {
            for (let charIndex = 0; charIndex < this.reelCharacters[reelIndex].length; charIndex++) {
                allPossiblePositions.push({ reelIndex, charIndex });
            }
        }

        this._shuffleArray(allPossiblePositions);

        // Yuuka: Sửa logic để tôn trọng giá trị maxPerSpin
        SPECIAL_CARD_CONFIGS.forEach(effectConfig => {
            const max = effectConfig.maxPerSpin || 1; // Fallback về 1 nếu không được định nghĩa
            for (let i = 0; i < max; i++) {
                // Điều kiện để đặt thẻ: còn vị trí trống VÀ tỉ lệ may mắn cho phép
                if (allPossiblePositions.length > 0 && Math.random() < effectConfig.chance) {
                    const position = allPossiblePositions.pop();
                    const key = `${position.reelIndex},${position.charIndex}`;
                    sessionAssignment.set(key, effectConfig);
                }
            }
        });

        return sessionAssignment;
    }

    /**
     * Yuuka: Xử lý các hiệu ứng đặc biệt cho lưới 3x3 hiện tại dựa trên bản đồ của toàn session.
     * @param {number[]} finalCardIndices - Mảng các index trung tâm của mỗi guồng.
     * @param {Map<string, object>} sessionSpecialMap - Bản đồ hiệu ứng của toàn session.
     * @returns {object} - Context chứa assignments và summary cho lưới 3x3.
     */
    processSpecialsForGrid(finalCardIndices, sessionSpecialMap) {
        const assignments = {};
        const summary = { multipliers: [], penalties: [], freeSpins: [], respins: 0, bonusPoints: [], swaps: [], clears: [], clearReassignments: [], reverseSpins: [] };

        for (let i = 0; i < this.reelCount; i++) {
            const reelChars = this.reelCharacters[i];
            if (!reelChars || reelChars.length === 0) continue;
            
            const len = reelChars.length;
            const centerIndex = finalCardIndices[i];
            const indicesInReel = [(centerIndex - 1 + len) % len, centerIndex, (centerIndex + 1) % len];
            
            indicesInReel.forEach((charIndex, j) => {
                const key = `${i},${charIndex}`;
                if (sessionSpecialMap.has(key)) {
                    const effectConfig = sessionSpecialMap.get(key);
                    const assignmentEffect = { ...effectConfig, __sessionKey: key };
                    const row = this.isMobile ? j : i;
                    const col = this.isMobile ? i : j;
                    const gridKey = `${row},${col}`;
                    
                    const position = { key: gridKey, row, column: col, charIndex, reelIndex: i };
                    assignments[gridKey] = { 
                        effect: assignmentEffect, 
                        position,
                        sessionKey: key
                    };

                    switch (assignmentEffect.category) {
                        case 'multiplier':
                            summary.multipliers.push(assignmentEffect);
                            break;
                        case 'penalty':
                            summary.penalties.push(assignmentEffect);
                            break;
                        case 'free-spin':
                            summary.freeSpins.push(assignmentEffect);
                            break;
                        case 'respin':
                            summary.respins += assignmentEffect.respins || 1;
                            break;
                        case 'reverse-spin':
                            summary.reverseSpins.push(assignmentEffect);
                            break;
                        case 'bonus-points':
                            summary.bonusPoints.push(assignmentEffect);
                            break;
                        case 'swap':
                            summary.swaps.push({
                                effect: assignmentEffect,
                                position
                            });
                            break;
                        case 'clear':
                            summary.clears.push({
                                effect: assignmentEffect,
                                position
                            });
                            break;
                    }
                }
            });
        }
        return { assignments, summary };
    }

    _shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
