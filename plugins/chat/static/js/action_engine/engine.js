class ActionEngine {
    constructor(apiUrl = '/api/plugin/chat/action/rules') {
        this.apiUrl = apiUrl;
        this.rules = null;
    }

    async loadRules() {
        try {
            const token = localStorage.getItem('yuuka-auth-token');
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(this.apiUrl, { headers });
            if (!res.ok) throw new Error("Failed to load action rules");
            this.rules = await res.json();
            return true;
        } catch (e) {
            console.error("[ActionEngine] Load rules error:", e);
            return false;
        }
    }

    async reloadRules() {
        return await this.loadRules();
    }

    /** Get all type names (solo + duo combined) */
    getAllTypes() {
        if (!this.rules) return [];
        return [
            ...Object.keys(this.rules.solo_types || {}),
            ...Object.keys(this.rules.duo_types || {})
        ];
    }

    /** Check if a type is a duo type */
    isDuoType(type) {
        return !!(this.rules?.duo_types?.[type]);
    }

    /** Check if a type is a solo type */
    isSoloType(type) {
        return !!(this.rules?.solo_types?.[type]);
    }

    /** Get type config (from either solo or duo) */
    getTypeConfig(type) {
        if (!this.rules) return null;
        return this.rules.solo_types?.[type] || this.rules.duo_types?.[type] || null;
    }

    /**
     * Clear all actions for time-skip scenarios.
     * Actions are transient and don't persist through time skips.
     * @returns {Object} empty state
     */
    applyTimeSkip() {
        console.log("[ActionEngine] Time skip applied. All actions cleared.");
        return {};
    }

    /**
     * Get the max stamina value from rules.
     */
    getMaxStamina() {
        return this.rules?.stamina?.max || 100;
    }

    /**
     * Calculate total stamina cost from all currently active actions.
     * @param {Object} currentState - action state, e.g. { "running": 10 }
     * @returns {number} total cost (negative or zero)
     */
    getStaminaCost(currentState) {
        if (!this.rules || !currentState) return 0;
        let totalCost = 0;
        for (const type of Object.keys(currentState)) {
            const config = this.getTypeConfig(type);
            if (config && config.stamina) {
                totalCost += config.stamina;
            }
        }
        return totalCost;
    }

    /**
     * Apply stamina changes for one turn.
     * - If stamina-consuming actions are active: deduct stamina.
     * - If idle (no consuming actions): regen stamina.
     * @param {number} currentStamina
     * @param {Object} currentState - action state
     * @returns {{ stamina: number, forcedIdle: boolean }}
     */
    applyStamina(currentStamina, currentState) {
        if (!this.rules?.stamina) return { stamina: currentStamina, forcedIdle: false };

        const max = this.rules.stamina.max || 100;
        const regenPerTurn = this.rules.stamina.regen_per_turn || 10;
        const cost = this.getStaminaCost(currentState);

        let stamina = currentStamina;
        let forcedIdle = false;

        if (cost < 0) {
            // Consuming stamina
            stamina = stamina + cost;
            if (stamina <= 0) {
                stamina = 0;
                forcedIdle = true;
            }
        } else {
            // Idle — regen
            stamina = Math.min(max, stamina + regenPerTurn);
        }

        return { stamina, forcedIdle };
    }

    /**
     * Remove all stamina-consuming actions when stamina is exhausted.
     * @param {Object} currentState
     * @returns {Object} cleaned state with only non-consuming actions
     */
    handleStaminaExhaustion(currentState) {
        if (!currentState) return {};
        const newState = { ...currentState };

        for (const type of Object.keys(newState)) {
            const config = this.getTypeConfig(type);
            if (config && config.stamina && config.stamina < 0) {
                delete newState[type];
            }
        }

        console.log("[ActionEngine] Stamina exhausted. Removed consuming actions. Remaining:", newState);
        return newState;
    }

    /**
     * Get booru tags based on current stamina level.
     * Tags are configured in rules.stamina.tags with threshold keys: "0", "25", "50", "75"
     * @param {number} currentStamina
     * @returns {string[]} tags array
     */
    getStaminaTags(currentStamina) {
        if (!this.rules?.stamina?.tags) return [];

        const thresholds = Object.keys(this.rules.stamina.tags)
            .map(Number)
            .sort((a, b) => b - a); // descending

        for (const threshold of thresholds) {
            if (currentStamina >= threshold) {
                return [...(this.rules.stamina.tags[String(threshold)] || [])];
            }
        }
        return [];
    }

    /**
     * Core engine: apply LLM delta to current state.
     * 
     * @param {Object} currentState - e.g. { "sitting": 10, "reading": 10 }
     * @param {Object} delta - LLM output, e.g. { action: ["walking", "drinking"], stop_action: ["hug"] }
     * @returns {Object} newState
     */
    applyDelta(currentState, delta) {
        if (!this.rules) return currentState;
        const newState = { ...currentState };
        const maxActive = this.rules.max_active_types || 2;

        // 1) Handle stop commands first — remove specified types
        if (delta && delta.stop_action && Array.isArray(delta.stop_action)) {
            for (const type of delta.stop_action) {
                delete newState[type];
            }
        }

        // 2) Parse new actions from delta
        const newActions = [];
        if (delta && delta.action && Array.isArray(delta.action)) {
            for (const type of delta.action) {
                const config = this.getTypeConfig(type);
                if (config) {
                    newActions.push(type);
                }
            }
        }

        // 3) Apply decay to existing types NOT in the new delta
        for (const type of Object.keys(newState)) {
            if (newActions.includes(type)) continue; // Skip types being refreshed
            const config = this.getTypeConfig(type);
            if (!config) { delete newState[type]; continue; }

            const decay = config.decay || 0;
            if (decay !== 0) {
                newState[type] = newState[type] + decay;
                if (newState[type] <= 0) {
                    delete newState[type];
                }
            }
        }

        // 4) Apply new actions with group conflict resolution
        for (const type of newActions) {
            const config = this.getTypeConfig(type);
            if (!config) continue;

            const incomingIsDuo = this.isDuoType(type);
            const group = config.group;

            // Check existing types in the same group
            let blocked = false;
            const toRemove = [];

            for (const existingType of Object.keys(newState)) {
                const existingConfig = this.getTypeConfig(existingType);
                if (!existingConfig || existingConfig.group !== group) continue;

                // Same group conflict
                const existingIsDuo = this.isDuoType(existingType);

                if (existingIsDuo && !incomingIsDuo) {
                    // Duo occupies slot — Solo CANNOT replace it
                    blocked = true;
                    break;
                } else {
                    // Either: Solo replaces Solo, Duo replaces Solo, or Duo replaces Duo
                    toRemove.push(existingType);
                }
            }

            if (!blocked) {
                for (const r of toRemove) delete newState[r];
                newState[type] = 10; // Always max value
            }
        }

        // 5) Enforce max_active_types: keep newest, drop oldest
        const activeTypes = Object.keys(newState);
        if (activeTypes.length > maxActive) {
            // Prioritize types that are in the current delta (newest)
            const inDelta = activeTypes.filter(t => newActions.includes(t));
            const notInDelta = activeTypes.filter(t => !newActions.includes(t));

            // Remove from oldest (not in delta) first
            let toKeep = [...inDelta.slice(0, maxActive)];
            const remaining = maxActive - toKeep.length;
            if (remaining > 0) {
                toKeep = [...toKeep, ...notInDelta.slice(0, remaining)];
            }

            for (const type of activeTypes) {
                if (!toKeep.includes(type)) {
                    delete newState[type];
                }
            }
        }

        return newState;
    }

    /**
     * Get booru tags from current action state.
     * Returns flat array of tags from all active types + stamina tags.
     */
    getTags(currentState, currentStamina) {
        if (!this.rules || !currentState) return [];

        const tags = [];
        const maxActive = this.rules.max_active_types || 2;

        // Take up to max_active_types
        const activeTypes = Object.keys(currentState).slice(0, maxActive);

        for (const type of activeTypes) {
            const config = this.getTypeConfig(type);
            if (config && config.tags) {
                tags.push(...config.tags);
            }
        }

        // Add stamina tags if stamina value is provided
        if (currentStamina !== undefined && currentStamina !== null) {
            const staminaTags = this.getStaminaTags(currentStamina);
            tags.push(...staminaTags);
        }

        // Deduplicate
        return [...new Set(tags)];
    }

    /** Get list of currently active duo types */
    getActiveDuoTypes(currentState) {
        if (!currentState) return [];
        return Object.keys(currentState).filter(t => this.isDuoType(t));
    }

    /** Get list of currently active solo types */
    getActiveSoloTypes(currentState) {
        if (!currentState) return [];
        return Object.keys(currentState).filter(t => this.isSoloType(t));
    }
}

// Global Export
window.ActionEngine = ActionEngine;
