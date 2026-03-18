class EmotionEngine {
    constructor(apiUrl = '/api/plugin/chat/emotion/rules', debug = true) {
        this.apiUrl = apiUrl;
        this.rules = null;
        this.debug = debug;
    }

    async loadRules() {
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(this.apiUrl, { headers });
            if (!res.ok) throw new Error("Failed to load rules");
            const data = await res.json();
            // Migrate v1 format (types as {emotion:[], condition:[]}) to v2 flat array
            if (data.types && !Array.isArray(data.types)) {
                const legacy = data.types;
                data.types = [...(legacy.emotion || []), ...(legacy.condition || [])];
            }
            if (this.validateRules(data)) {
                this.rules = data;
                return true;
            }
            return false;
        } catch (e) {
            console.error("[EmotionEngine] Load rules error:", e);
            return false;
        }
    }

    async reloadRules() {
        return await this.loadRules();
    }

    validateRules(rules) {
        if (!rules || !rules.types || !rules.value_steps || !rules.mapping) return false;
        return true;
    }

    /** Returns all known type names as a flat array */
    getAllTypes() {
        if (!this.rules) return [];
        return Array.isArray(this.rules.types) ? this.rules.types : [];
    }

    /** Check if a type name is registered */
    isValidType(type) {
        return this.getAllTypes().includes(type);
    }

    snapToStep(value) {
        if (!this.rules) return value;
        const steps = this.rules.value_steps;
        let closest = steps[0];
        let minDiff = Math.abs(value - closest);
        for (let i = 1; i < steps.length; i++) {
            const diff = Math.abs(value - steps[i]);
            if (diff < minDiff) {
                minDiff = diff;
                closest = steps[i];
            }
        }
        return closest;
    }

    reduceStep(value) {
        if (!this.rules) return value;
        const steps = this.rules.value_steps;
        const snapped = this.snapToStep(value);
        const idx = steps.indexOf(snapped);
        if (idx === -1) return snapped;

        let newIdx = idx;
        if (snapped > 0 && idx > 0) {
            newIdx = idx - 1;
            if (steps[newIdx] < 0) newIdx = steps.indexOf(0) !== -1 ? steps.indexOf(0) : idx;
        } else if (snapped < 0 && idx < steps.length - 1) {
            newIdx = idx + 1;
            if (steps[newIdx] > 0) newIdx = steps.indexOf(0) !== -1 ? steps.indexOf(0) : idx;
        }
        return steps[newIdx];
    }

    /**
     * Simulate multiple turns of decay for time-skip scenarios (e.g. "next morning...").
     * Applies reduce_value N times to each active type, removing types that fall below threshold.
     * @param {Object} currentState - current emotion state
     * @param {number} [turns] - number of decay turns to simulate (defaults to rules.time_skip_turns or 9)
     * @returns {Object} decayed state
     */
    applyTimeSkip(currentState, turns) {
        if (!this.rules) return currentState;
        const n = turns || this.rules.time_skip_turns || 9;
        const newState = { ...currentState };
        const minThreshold = this.rules.min_threshold || 1;

        for (const key of Object.keys(newState)) {
            let val = newState[key];

            for (let i = 0; i < n; i++) {
                if (this.rules.reduce_value && this.rules.reduce_value[key] !== undefined) {
                    const decayAmt = Math.abs(this.rules.reduce_value[key]);
                    if (val > 0) {
                        val = Math.max(0, val - decayAmt);
                    } else if (val < 0) {
                        val = Math.min(0, val + decayAmt);
                    }
                } else {
                    val = val * 0.8; // fallback multiplicative
                }
                if (Math.abs(val) < minThreshold) {
                    val = 0;
                    break;
                }
            }

            if (Math.abs(val) < minThreshold) {
                delete newState[key];
            } else {
                newState[key] = val;
            }
        }

        if (this.debug) {
            console.log(`[EmotionEngine] Time skip applied (${n} turns). State:`, newState);
        }
        return newState;
    }

    applyDelta(currentState, delta, decayRate = 0.8) {
        if (!this.rules) return currentState;
        const newState = { ...currentState };

        if (this.debug) {
            console.log("[EmotionEngine] Raw LLM Delta:", delta);
        }

        // 1) Parse LLM delta (raw values, clamped to valid range)
        const parsedDelta = {};
        if (delta && delta.value) {
            const minStep = Math.min(...this.rules.value_steps);
            const maxStep = Math.max(...this.rules.value_steps);
            for (const key of Object.keys(delta.value)) {
                if (this.isValidType(key)) {
                    const raw = delta.value[key] || 0;
                    parsedDelta[key] = Math.max(minStep, Math.min(maxStep, raw));
                }
            }
        }

        const allKeys = new Set([...Object.keys(newState), ...Object.keys(parsedDelta)]);

        for (const key of allKeys) {
            let val = newState[key] || 0;
            let d = parsedDelta[key] || 0;

            // 1) Apply per-type reduce (decay toward 0 each turn) BEFORE adding the new delta
            let rType = 'on_idle';
            if (this.rules.reduce_type && this.rules.reduce_type[key] !== undefined) {
                rType = this.rules.reduce_type[key];
            }
            const isIdle = parsedDelta[key] === undefined || parsedDelta[key] === 0;
            const shouldReduce = rType === 'always' || (rType === 'on_idle' && isIdle);

            if (shouldReduce) {
                if (this.rules.reduce_value && this.rules.reduce_value[key] !== undefined) {
                    // Ensure we read reduceAmt as an absolute magnitude for decay
                    const decayAmt = Math.abs(this.rules.reduce_value[key]);
                    if (val > 0) {
                        val = Math.max(0, val - decayAmt);
                    } else if (val < 0) {
                        val = Math.min(0, val + decayAmt);
                    }
                } else {
                    // Fallback: multiplicative decay for types without reduce_value
                    val = val * Math.abs(decayRate);
                }
            }

            // 2) Apply delta from LLM
            let cap = 10;
            if (this.rules.cap_per_turn && this.rules.cap_per_turn[key] !== undefined) {
                cap = Math.abs(this.rules.cap_per_turn[key]);
            }
            d = Math.max(-cap, Math.min(cap, d));
            val = val + d;

            // 3) Clamp
            const minStep = Math.min(...this.rules.value_steps);
            const maxStep = Math.max(...this.rules.value_steps);
            val = Math.max(minStep, Math.min(maxStep, val));


            // 4) Remove types below minimum threshold
            const minThreshold = this.rules.min_threshold || 1;
            if (Math.abs(val) < minThreshold) {
                delete newState[key];
            } else {
                newState[key] = val;
            }
        }

        // Conflict resolver
        if (this.rules.conflict_rules) {
            for (const rule of this.rules.conflict_rules) {
                if (newState[rule.typeA] !== undefined && newState[rule.typeB] !== undefined) {
                    const valA = newState[rule.typeA];
                    const valB = newState[rule.typeB];
                    if (rule.resolution === 'keep_higher') {
                        if (Math.abs(valA) >= Math.abs(valB)) {
                            delete newState[rule.typeB];
                        } else {
                            delete newState[rule.typeA];
                        }
                    } else if (rule.resolution === 'keep_newest') {
                        if (parsedDelta[rule.typeA] !== undefined && parsedDelta[rule.typeB] === undefined) {
                            delete newState[rule.typeB];
                        } else if (parsedDelta[rule.typeB] !== undefined && parsedDelta[rule.typeA] === undefined) {
                            delete newState[rule.typeA];
                        } else {
                            if (Math.abs(valA) >= Math.abs(valB)) {
                                delete newState[rule.typeB];
                            } else {
                                delete newState[rule.typeA];
                            }
                        }
                    } else if (rule.resolution === 'reduce_A') {
                        newState[rule.typeA] = this.reduceStep(newState[rule.typeA]);
                    } else if (rule.resolution === 'reduce_B') {
                        newState[rule.typeB] = this.reduceStep(newState[rule.typeB]);
                    } else if (rule.resolution === 'cap_at_5') {
                        newState[rule.typeA] = Math.max(-5, Math.min(5, newState[rule.typeA]));
                        newState[rule.typeB] = Math.max(-5, Math.min(5, newState[rule.typeB]));
                    }
                }
            }
        }

        // Behavior rules
        if (this.rules.behavior_rules) {
            for (const br of this.rules.behavior_rules) {
                if (newState[br.type]) {
                    if (br.action === 'reduce_others' || br.action === 'reduce_emotions') {
                        // Reduce all OTHER active types
                        for (const key of Object.keys(newState)) {
                            if (key !== br.type) {
                                newState[key] = this.reduceStep(newState[key]);
                            }
                        }
                    } else if (br.action === 'cap_at_5') {
                        // Cap all OTHER active types at 5
                        for (const key of Object.keys(newState)) {
                            if (key !== br.type) {
                                newState[key] = Math.max(-5, Math.min(5, newState[key]));
                            }
                        }
                    }
                }
            }
        }

        // Final cleanup for types below minimum threshold after reductions
        const finalMinThreshold = this.rules.min_threshold || 1;
        for (const key of Object.keys(newState)) {
            if (Math.abs(newState[key]) < finalMinThreshold) {
                delete newState[key];
            }
        }

        return newState;
    }

    getDominantType(currentState) {
        let dominant = null;
        let maxVal = -1;

        for (const key of Object.keys(currentState)) {
            const val = Math.abs(currentState[key]);
            if (val > maxVal) {
                maxVal = val;
                dominant = key;
            }
        }
        return dominant;
    }

    getTags(currentState) {
        // Returns an array of booru tags from the top N active types (sorted by |value|)
        if (!this.rules || Object.keys(currentState).length === 0) return [];

        const maxTagTypes = this.rules.max_tag_types || 2;

        // Sort all active types by |value| descending, take top N
        const sorted = Object.entries(currentState)
            .filter(([k, v]) => Math.abs(v) > 0)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            .slice(0, maxTagTypes);

        let tags = [];
        for (const [type, value] of sorted) {
            if (this.rules.mapping[type]) {
                // Snap to nearest step for mapping lookup (steps are the mapping keys)
                const snappedVal = this.snapToStep(Math.abs(value));
                const valString = String(Math.abs(snappedVal));
                if (this.rules.mapping[type][valString]) {
                    tags.push(...this.rules.mapping[type][valString]);
                }
            }
        }

        // Deduplicate
        return [...new Set(tags)];
    }
}

// Global Export
window.EmotionEngine = EmotionEngine;
