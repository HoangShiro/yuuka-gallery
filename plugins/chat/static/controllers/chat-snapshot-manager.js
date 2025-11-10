(function registerChatSnapshotManager(namespace) {
    class ChatSnapshotManager {
        constructor(store) {
            this.store = store;
            this._snapshots = new Map(); // messageId -> { entries, activeIndex, latestIndex, followLatest, lastSyncedText }
            this._pendingRegenerations = new Set(); // messageIds being regenerated
        }

        reset() {
            this._snapshots.clear();
            this._pendingRegenerations.clear();
        }

        isPending(messageId) {
            return this._pendingRegenerations.has(messageId);
        }

        setPending(messageId, pending) {
            if (pending) this._pendingRegenerations.add(messageId); else this._pendingRegenerations.delete(messageId);
        }

        getState(message) {
            if (!message || message.role !== "assistant" || message.type === "image" || message.type === "audio") {
                return null;
            }
            return this._snapshots.get(message.id) || null;
        }

        isValidIndex(value) {
            if (typeof value !== "number" || value < 0) return false;
            return (typeof Number.isInteger === "function") ? Number.isInteger(value) : Math.floor(value) === value;
        }

        getSelectedSnapshotIndexFromMessage(message) {
            const value = message?.metadata?.selected_snapshot_index;
            return this.isValidIndex(value) ? value : null;
        }

        async persistSelection(characterId, messageId, snapshotState) {
            if (!characterId || !messageId || !snapshotState) return;
            const activeIndex = snapshotState.activeIndex;
            if (!this.isValidIndex(activeIndex)) return;
            const history = this.store.state.activeHistory || [];
            const message = history.find(item => item.id === messageId);
            if (!message) return;
            const currentIndex = this.getSelectedSnapshotIndexFromMessage(message);
            if (currentIndex === activeIndex) return;
            try {
                await this.store.setSelectedSnapshotIndex(characterId, messageId, activeIndex);
            } catch (err) {
                // Fallback when setSelectedSnapshotIndex is not available
                await this.store.updateMessage(characterId, messageId, {
                    metadata: { selected_snapshot_index: activeIndex },
                });
            }
        }

        syncFromMessages(messages) {
            const list = Array.isArray(messages) ? messages : [];
            const activeIds = new Set(list.map(m => m.id));
            // prune missing
            for (const id of Array.from(this._snapshots.keys())) {
                if (!activeIds.has(id)) {
                    this._snapshots.delete(id);
                    this._pendingRegenerations.delete(id);
                }
            }

            list.forEach(message => {
                const messageId = message?.id;
                if (!messageId || message.role !== "assistant" || message.type === "image" || message.type === "audio") return;
                const text = message?.content?.text ?? "";
                let snapshot = this._snapshots.get(messageId);
                if (!snapshot) {
                    const entries = Array.isArray(message.snapshots) && message.snapshots.length > 0 ? [...message.snapshots] : [text];
                    const latestIndex = entries.length - 1;
                    snapshot = {
                        entries,
                        activeIndex: latestIndex,
                        latestIndex,
                        followLatest: true,
                        lastSyncedText: entries[latestIndex] ?? "",
                    };
                    this._snapshots.set(messageId, snapshot);
                }

                if (Array.isArray(message.snapshots) && message.snapshots.length > 0) {
                    snapshot.entries = [...message.snapshots];
                    snapshot.latestIndex = snapshot.entries.length - 1;
                    snapshot.lastSyncedText = snapshot.entries[snapshot.latestIndex] ?? "";
                }

                if (message?.metadata?.streaming) {
                    if (snapshot.entries.length === 0 || snapshot.entries[snapshot.entries.length - 1] !== text) {
                        snapshot.entries.push(text);
                        snapshot.latestIndex = snapshot.entries.length - 1;
                        snapshot.activeIndex = snapshot.latestIndex;
                        snapshot.followLatest = true;
                        snapshot.lastSyncedText = text;
                    }
                    return;
                }

                const previousLatestText = snapshot.entries[snapshot.latestIndex] ?? "";
                let updatedLatest = false;
                if (snapshot.entries[snapshot.latestIndex] !== text) {
                    const existingIndex = snapshot.entries.findIndex(entry => entry === text);
                    if (existingIndex >= 0) {
                        snapshot.latestIndex = existingIndex;
                        snapshot.entries[existingIndex] = text;
                    } else {
                        snapshot.entries.push(text);
                        snapshot.latestIndex = snapshot.entries.length - 1;
                    }
                    updatedLatest = true;
                } else {
                    snapshot.entries[snapshot.latestIndex] = text;
                }

                if (snapshot.followLatest || snapshot.entries.length === 1) {
                    snapshot.activeIndex = snapshot.latestIndex;
                } else if (typeof snapshot.activeIndex !== "number") {
                    snapshot.activeIndex = snapshot.latestIndex;
                }

                snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;

                const selectedIndex = this.getSelectedSnapshotIndexFromMessage(message);
                if (!message?.metadata?.streaming && this.isValidIndex(selectedIndex) && selectedIndex < snapshot.entries.length) {
                    snapshot.activeIndex = selectedIndex;
                    snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;
                }

                if (updatedLatest && this._pendingRegenerations.has(messageId) && text !== snapshot.lastSyncedText) {
                    this._pendingRegenerations.delete(messageId);
                }

                snapshot.lastSyncedText = text;
                if (!message?.metadata?.streaming && this._pendingRegenerations.has(messageId)) {
                    this._pendingRegenerations.delete(messageId);
                }
            });
        }
    }

    namespace.ChatSnapshotManager = ChatSnapshotManager;
})(window.Yuuka.plugins.chat.controllers);
