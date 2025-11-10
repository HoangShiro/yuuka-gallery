(function registerChatMessageActions(namespace){
    class ChatMessageActions {
        constructor(store, snapshotManager, options = {}) {
            this.store = store;
            this.snapshotManager = snapshotManager;
            this.options = Object.assign({
                notifyError: (msg) => console.error("[ChatActions]", msg),
                confirmAction: async () => true,
                reRender: () => {},
                getActiveHistory: () => this.store?.state?.activeHistory || [],
                getCurrentCharacterId: () => this.store?.state?.activeCharacterId || null,
            }, options);
        }

        setOptions(options = {}) {
            Object.assign(this.options, options);
        }

        async handleSnapshotPrev(messageId) {
            const snapshot = this.snapshotManager._snapshots.get(messageId);
            if (snapshot && snapshot.activeIndex > 0) {
                snapshot.activeIndex -= 1;
                snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;
                const characterId = this.options.getCurrentCharacterId();
                await this.snapshotManager.persistSelection(characterId, messageId, snapshot);
                this.options.reRender();
            }
        }

        async handleSnapshotNext(messageId) {
            const snapshot = this.snapshotManager._snapshots.get(messageId);
            if (!snapshot) return;
            const characterId = this.options.getCurrentCharacterId();
            if (!characterId) return;

            if (snapshot.activeIndex < (snapshot.entries.length - 1)) {
                snapshot.activeIndex += 1;
                snapshot.followLatest = snapshot.activeIndex === snapshot.latestIndex;
                await this.snapshotManager.persistSelection(characterId, messageId, snapshot);
                this.options.reRender();
                return;
            }

            if (this.snapshotManager.isPending(messageId)) {
                return;
            }

            // Trigger regeneration
            this.snapshotManager.setPending(messageId, true);
            snapshot.followLatest = true;
            await this.snapshotManager.persistSelection(characterId, messageId, snapshot);
            this.options.reRender();

            try {
                await this.store.queueAction(characterId, "regen", {
                    message_id: messageId,
                    messages: this.options.getActiveHistory(),
                });
            } catch (error) {
                console.error("[ChatActions] Failed to regenerate message:", error);
                this.options.notifyError("Unable to ask the AI right now. Please try again.");
                this.snapshotManager.setPending(messageId, false);
                this.options.reRender();
            }
        }

        async handleDelete(messageId) {
            const characterId = this.options.getCurrentCharacterId();
            if (!characterId) return;
            const confirmed = await this.options.confirmAction({
                message: "Are you sure you want to delete this message?",
                confirmLabel: "Delete",
                cancelLabel: "Cancel",
            });
            if (!confirmed) return;
            try {
                await this.store.deleteMessage(characterId, messageId);
                this.snapshotManager._snapshots.delete(messageId);
                this.snapshotManager.setPending(messageId, false);
                this.options.reRender();
            } catch (error) {
                console.error("[ChatActions] Failed to delete message:", error);
                this.options.notifyError("Unable to delete the message. Please try again.");
            }
        }
    }

    namespace.ChatMessageActions = ChatMessageActions;
})(window.Yuuka.plugins.chat.controllers);
