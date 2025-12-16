// Album plugin - Character view domain: progress aggregation (pure-ish helpers)
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterComputeMainMenuProgressModel(allTasksStatus) {
            try {
                if (this.state?.viewMode !== 'character') return null;

                const currentCharHash = String(this.state?.selectedCharacter?.hash || '').trim();
                if (!currentCharHash) return null;

                let bestTask = null;
                let hasAuto = false;
                let hasNonAutoOrUnknown = false;

                Object.values(allTasksStatus || {}).forEach(task => {
                    if (!task) return;
                    if (task.is_running === false) return;

                    // VN BG tasks run under a different character_hash (Background album).
                    // Include them if their local meta binds them to the currently selected character.
                    if (currentCharHash && String(task.character_hash || '') !== currentCharHash) {
                        try {
                            const tid = String(task.task_id || task.taskId || '').trim();
                            const meta = tid ? this._characterTaskMeta?.get?.(tid) : null;
                            if (!(meta && meta.vnLayer === 'bg' && String(meta.characterHash || '') === currentCharHash)) return;
                        } catch {
                            return;
                        }
                    }

                    // Determine whether this running task is auto or non-auto.
                    // If unknown, treat as non-auto so we don't mislabel manual tasks.
                    try {
                        const tid = String(task.task_id || task.taskId || '').trim();
                        const meta = tid ? this._characterTaskMeta?.get?.(tid) : null;
                        if (meta && meta.isAuto === true) hasAuto = true;
                        else hasNonAutoOrUnknown = true;
                    } catch {
                        hasNonAutoOrUnknown = true;
                    }

                    const p = Number(task.progress_percent ?? 0);
                    if (!Number.isFinite(p)) return;
                    if (!bestTask || p > (bestTask.progress_percent ?? 0)) bestTask = task;
                });

                if (!bestTask) return null;

                const percent = Math.max(0, Math.min(100, Number(bestTask.progress_percent ?? 0)));
                const isAutoOnly = hasAuto && !hasNonAutoOrUnknown;

                return {
                    percent,
                    isAutoOnly,
                };
            } catch (err) {
                console.warn('[Album] _characterComputeMainMenuProgressModel error:', err);
                return null;
            }
        },
    });
})();
