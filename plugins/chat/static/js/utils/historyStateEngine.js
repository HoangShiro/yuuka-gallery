/**
 * HistoryStateEngine
 *
 * Unified state snapshot manager for both Single and Group chat modes.
 * Both modes store state under:
 *   session.character_states[charHash] = { emotion_state, action_state, stamina, location, outfits, inventory, ...extensions }
 *
 * Single mode: charHash = activeChatCharacterHash
 * Group mode:  charHash = the responding character's hash
 *
 * Snapshot format (per message snapshot slot):
 *   snapshot = [text, urls[], status, action_context]
 *     [0] text: string
 *     [1] urls: string[]
 *     [2] status: StateSnapshot | null  — state AFTER this message was applied
 *     [3] action_context: ActionItem[] | null  — gift/outfit_change/stamina labels
 *
 * Public API:
 *   ensureCharState(session, charHash)                  → CharState
 *   ensureGroupCharState(session, charHash, defaultOutfits?) → CharState
 *   capture(session, charHash)                          → StateSnapshot
 *   restore(session, charHash, snapshot, onRestored?)   → void
 *   writeStatus(msg, snapshotIndex, status)             → void
 *   readStatus(msg, snapshotIndex)                      → StateSnapshot | null
 *   writeActionContext(msg, snapshotIndex, actions)     → void
 *   readActionContext(msg, snapshotIndex)               → ActionItem[] | null
 *   beginTurn()                                         → void
 *   addPendingCard(card)                                → void
 *   flushPendingCards()                                 → ActionItem[]
 *   findStatusBefore(messages, index)                   → StateSnapshot | null
 */
window.HistoryStateEngine = (function () {

    const DEFAULT_STATE = () => ({
        emotion_state: {},
        action_state: {},
        stamina: 100,
        location: '',
        outfits: [],
        inventory: []
    });

    function clone(obj) {
        if (obj === null || obj === undefined) return obj;
        return JSON.parse(JSON.stringify(obj));
    }

    // -------------------------------------------------------------------------
    // ensureCharState(session, charHash) → CharState
    // Idempotent init — creates character_states[charHash] with defaults if absent.
    // -------------------------------------------------------------------------
    function ensureCharState(session, charHash) {
        if (!session.character_states) session.character_states = {};
        if (!session.character_states[charHash]) {
            session.character_states[charHash] = DEFAULT_STATE();
        }
        const s = session.character_states[charHash];
        const d = DEFAULT_STATE();
        for (const key of Object.keys(d)) {
            if (s[key] === undefined || s[key] === null) s[key] = d[key];
        }
        return s;
    }

    // -------------------------------------------------------------------------
    // ensureGroupCharState(session, charHash, defaultOutfits?)
    // Same as ensureCharState but accepts defaultOutfits for new group members.
    // -------------------------------------------------------------------------
    function ensureGroupCharState(session, charHash, defaultOutfits = []) {
        if (!charHash) return null;
        if (!session.character_states) session.character_states = {};
        if (!session.character_states[charHash]) {
            session.character_states[charHash] = {
                ...DEFAULT_STATE(),
                outfits: clone(defaultOutfits)
            };
        }
        const s = session.character_states[charHash];
        const d = DEFAULT_STATE();
        for (const key of Object.keys(d)) {
            if (s[key] === undefined || s[key] === null) s[key] = d[key];
        }
        return s;
    }

    // -------------------------------------------------------------------------
    // capture(session, charHash) → StateSnapshot
    // -------------------------------------------------------------------------
    function capture(session, charHash) {
        const s = ensureCharState(session, charHash);
        const snap = {};
        snap.emotion_state = clone(s.emotion_state) || {};
        snap.action_state  = clone(s.action_state)  || {};
        snap.stamina       = s.stamina !== undefined && s.stamina !== null ? s.stamina : 100;
        snap.location      = s.location !== undefined ? s.location : '';
        snap.outfits       = clone(s.outfits)   || [];
        snap.inventory     = clone(s.inventory) || [];
        // Extension fields
        const coreKeys = new Set(['emotion_state', 'action_state', 'stamina', 'location', 'outfits', 'inventory']);
        for (const key of Object.keys(s)) {
            if (!coreKeys.has(key)) snap[key] = clone(s[key]);
        }
        return snap;
    }

    // -------------------------------------------------------------------------
    // restore(session, charHash, snapshot, onRestored?)
    // -------------------------------------------------------------------------
    function restore(session, charHash, snapshot, onRestored) {
        if (!snapshot) {
            console.warn('[HistoryStateEngine] restore() called with null/undefined snapshot — skipping.');
            return;
        }
        const s = ensureCharState(session, charHash);
        for (const key of Object.keys(snapshot)) {
            const val = snapshot[key];
            s[key] = (val !== null && typeof val === 'object') ? clone(val) : val;
        }
        if (typeof onRestored === 'function') onRestored();
    }

    // -------------------------------------------------------------------------
    // writeStatus / readStatus — snapshot[2]
    // -------------------------------------------------------------------------
    function _ensureSnapshotArray(msg, snapshotIndex) {
        if (!msg.snapshots) msg.snapshots = [];
        while (msg.snapshots.length <= snapshotIndex) msg.snapshots.push(['', [], null, null]);
        let s = msg.snapshots[snapshotIndex];
        if (typeof s === 'string') s = [s, [], null, null];
        else if (!Array.isArray(s)) s = ['', [], null, null];
        else if (s.length < 4) {
            while (s.length < 4) s.push(null);
        }
        msg.snapshots[snapshotIndex] = s;
        return s;
    }

    function writeStatus(msg, snapshotIndex, status) {
        const s = _ensureSnapshotArray(msg, snapshotIndex);
        s[2] = status || null;
    }

    function readStatus(msg, snapshotIndex) {
        if (!msg || !msg.snapshots) return null;
        const s = msg.snapshots[snapshotIndex];
        if (!s) return null;
        if (typeof s === 'string') return null;
        if (Array.isArray(s)) return s[2] || null;
        return null;
    }

    // -------------------------------------------------------------------------
    // writeActionContext / readActionContext — snapshot[3]
    // -------------------------------------------------------------------------
    function writeActionContext(msg, snapshotIndex, actions) {
        const s = _ensureSnapshotArray(msg, snapshotIndex);
        s[3] = (actions && actions.length > 0) ? actions : null;
    }

    function readActionContext(msg, snapshotIndex) {
        if (!msg || !msg.snapshots) return null;
        const s = msg.snapshots[snapshotIndex];
        if (!s) return null;
        if (typeof s === 'string') return null;
        if (Array.isArray(s)) return s[3] || null;
        return null;
    }

    // -------------------------------------------------------------------------
    // Pending card buffer (repurposed as ActionItem buffer)
    // -------------------------------------------------------------------------
    let _pendingCards = [];

    function beginTurn() { _pendingCards = []; }
    function addPendingCard(card) { _pendingCards.push(card); }
    function flushPendingCards() {
        const cards = [..._pendingCards];
        _pendingCards = [];
        return cards;
    }

    // -------------------------------------------------------------------------
    // findStatusBefore(messages, index) → StateSnapshot | null
    // Walk backwards from index-1, return status (snapshot[2]) of nearest assistant msg.
    // -------------------------------------------------------------------------
    function findStatusBefore(messages, index) {
        for (let i = index - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role !== 'assistant') continue;
            // Skip narrator messages EXCEPT first_message which stores initial state
            if (m.type === 'narrator' && m.narrator_type !== 'first_message') continue;
            // New format: read from snapshot[2]
            const status = readStatus(m, m.activeIndex != null ? m.activeIndex : 0);
            if (status) return status;
            // Legacy compat: status_snapshots
            if (m.status_snapshots) {
                const rec = m.status_snapshots[m.activeIndex != null ? m.activeIndex : 0];
                if (rec && rec.status_after) return rec.status_after;
            }
        }
        return null;
    }

    return {
        ensureCharState,
        ensureGroupCharState,
        capture,
        restore,
        writeStatus,
        readStatus,
        writeActionContext,
        readActionContext,
        beginTurn,
        addPendingCard,
        flushPendingCards,
        findStatusBefore
    };
})();
