// Album plugin - View module: character view (Task progress helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterGetRunningPresetProgressMap(allTasksStatus) {
            const map = new Map();
            try {
                const currentCharHash = String(this.state?.selectedCharacter?.hash || '').trim();
                Object.values(allTasksStatus || {}).forEach(task => {
                    if (!task) return;
                    if (task.is_running === false) return;
                    const tid = String(task.task_id || task.taskId || '').trim();
                    if (!tid) return;
                    const meta = this._characterTaskMeta.get(tid);
                    // VN BG tasks are stored under a different character_hash (Background album),
                    // but they still belong to the currently selected character session.
                    if (currentCharHash && String(task.character_hash || '') !== currentCharHash) {
                        if (!(meta && meta.vnLayer === 'bg' && String(meta.characterHash || '') === currentCharHash)) return;
                    }
                    const presetId = String(meta?.presetId || '').trim();
                    if (!presetId) return;
                    const p = Number(task.progress_percent ?? 0);
                    const percent = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
                    const prev = map.get(presetId);
                    if (typeof prev !== 'number' || percent > prev) map.set(presetId, percent);
                });
            } catch { }
            return map;
        },

        _characterGetRunningPresetProgressForPresetId(allTasksStatus, presetId, { nonAutoOnly = false } = {}) {
            try {
                const targetPresetId = String(presetId || '').trim();
                if (!targetPresetId) return null;
                const currentCharHash = String(this.state?.selectedCharacter?.hash || '').trim();
                let best = null;
                Object.values(allTasksStatus || {}).forEach(task => {
                    if (!task) return;
                    if (task.is_running === false) return;
                    const tid = String(task.task_id || task.taskId || '').trim();
                    if (!tid) return;
                    const meta = this._characterTaskMeta.get(tid);
                    if (!meta) return;
                    // VN BG tasks are stored under a different character_hash (Background album).
                    if (currentCharHash && String(task.character_hash || '') !== currentCharHash) {
                        if (!(meta.vnLayer === 'bg' && String(meta.characterHash || '') === currentCharHash)) return;
                    }
                    if (nonAutoOnly && meta.isAuto !== false) return;
                    const pid = String(meta?.presetId || '').trim();
                    if (!pid || pid !== targetPresetId) return;
                    const p = Number(task.progress_percent ?? 0);
                    const percent = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
                    if (best === null || percent > best) best = percent;
                });
                return (typeof best === 'number') ? best : null;
            } catch {
                return null;
            }
        },
    });
})();
