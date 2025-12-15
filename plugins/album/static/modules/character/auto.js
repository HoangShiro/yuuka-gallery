// Character-view auto-generation + sortable tag-group ordering
// Extracted from album.js to separate responsibilities.

(function (windowObj = window) {
    const AlbumComponent = windowObj?.Yuuka?.components?.AlbumComponent;
    if (!AlbumComponent || !AlbumComponent.prototype) return;

    Object.assign(AlbumComponent.prototype, {
        _characterGetAutoCooldownUntil(presetId) {
            const pid = String(presetId || '').trim();
            if (!pid) return 0;
            const pregen = this.state?.character?.pregen || {};
            const map = (pregen.autoCooldownUntilByPresetId && typeof pregen.autoCooldownUntilByPresetId === 'object')
                ? pregen.autoCooldownUntilByPresetId
                : {};
            const until = Number(map[pid] || 0);
            return Number.isFinite(until) ? until : 0;
        },

        _characterIsAutoPresetInCooldown(presetId, now = Date.now()) {
            const until = this._characterGetAutoCooldownUntil(presetId);
            return until > now;
        },

        _characterGetRunningTasksForCurrentCharacter(allTasksStatus) {
            const charHash = this.state?.selectedCharacter?.hash;
            if (!charHash) return [];
            const status = allTasksStatus || this._lastAllTasksStatus || {};
            return Object.values(status)
                .filter(t => t && t.is_running !== false)
                .filter(t => String(t.character_hash || '') === String(charHash));
        },

        _characterHasRunningNonAutoTask(allTasksStatus) {
            const running = this._characterGetRunningTasksForCurrentCharacter(allTasksStatus);
            for (const task of running) {
                const taskId = String(task?.task_id || task?.taskId || '').trim();
                if (!taskId) return true; // unknown => treat as non-auto
                const meta = this._characterTaskMeta.get(taskId);
                if (!meta) return true; // unknown => treat as non-auto
                if (meta.isAuto) continue;
                return true;
            }
            return false;
        },

        _characterGetRunningAutoTaskIds(allTasksStatus) {
            const running = this._characterGetRunningTasksForCurrentCharacter(allTasksStatus);
            const ids = [];
            for (const task of running) {
                const taskId = String(task?.task_id || task?.taskId || '').trim();
                if (!taskId) continue;
                const meta = this._characterTaskMeta.get(taskId);
                if (meta && meta.isAuto === true) {
                    ids.push(taskId);
                    continue;
                }

                // Best-effort fallback: if meta is missing (reload / lost state),
                // try to infer "auto" from task payload/context if present.
                try {
                    const ctx = task?.context || task?.ctx || task?.meta || null;
                    const ctxAuto = (ctx && typeof ctx === 'object') ? ctx.auto : undefined;
                    const taskAuto = task?.auto;
                    const taskIsAuto = task?.is_auto;
                    if (ctxAuto === true || taskAuto === true || taskIsAuto === true) {
                        ids.push(taskId);
                        continue;
                    }
                } catch { }
            }
            return ids;
        },

        _characterGetRunningNonAutoTaskIds(allTasksStatus) {
            const running = this._characterGetRunningTasksForCurrentCharacter(allTasksStatus);
            const ids = [];
            for (const task of running) {
                const taskId = String(task?.task_id || task?.taskId || '').trim();
                if (!taskId) continue;
                const meta = this._characterTaskMeta.get(taskId);
                // If unknown, treat as non-auto (user intent: replace current task).
                if (!meta || meta.isAuto !== true) ids.push(taskId);
            }
            return ids;
        },

        _characterHasRunningAutoTask(allTasksStatus) {
            return this._characterGetRunningAutoTaskIds(allTasksStatus).length > 0;
        },

        async _characterCancelRunningAutoTask({ silent = true, suspend = true } = {}) {
            if (this.state.viewMode !== 'character') return;
            const ids = this._characterGetRunningAutoTaskIds();
            if (!ids.length) return;
            if (suspend) {
                try { this.state.character.pregen.suspended = true; } catch { }
            }
            await Promise.all(ids.map(async (taskId) => {
                try {
                    await this.api.generation.cancel(taskId);
                } catch (err) {
                    if (!silent) showError(`Lỗi hủy auto task: ${err.message}`);
                }
            }));
        },

        async _characterCancelRunningNonAutoTask({ silent = true } = {}) {
            if (this.state.viewMode !== 'character') return;
            const ids = this._characterGetRunningNonAutoTaskIds();
            if (!ids.length) return;
            await Promise.all(ids.map(async (taskId) => {
                try {
                    await this.api.generation.cancel(taskId);
                } catch (err) {
                    if (!silent) showError(`Lỗi hủy task: ${err.message}`);
                }
            }));
        },

        _characterPickNextAutoPresetId() {
            if (this.state.viewMode !== 'character') return null;
            const pregen = (this.state.character && this.state.character.pregen && typeof this.state.character.pregen === 'object')
                ? this.state.character.pregen
                : {};
            const lastAutoPresetId = String(pregen.lastAutoPresetId || '').trim();
            const presets = Array.isArray(this.state.character.presets) ? this.state.character.presets : [];

            const suggested = Array.isArray(this.state.character.autoSuggestPresets)
                ? this.state.character.autoSuggestPresets
                : [];

            const candidates = [];
            let idx = 0;

            // 1) Auto-suggest presets (auto:<key>)
            for (const item of suggested) {
                const key = String(item?.key || '').trim();
                if (!key) continue;
                const presetId = `auto:${key}`;
                if (this._characterIsAutoPresetInCooldown(presetId)) continue;
                if (this._characterGetImagesForPreset(presetId).length > 0) continue;
                if (!this._characterIsAutoAllowedForPresetId(presetId)) continue;
                candidates.push({ presetId, hasScore: true, score: Number(item?.score) || 0, idx: idx++ });
            }

            // 2) Saved presets
            for (const p of presets) {
                const pid = p?.id;
                if (!pid) continue;
                if (this._characterIsAutoPresetInCooldown(pid)) continue;
                if (this._characterGetImagesForPreset(pid).length > 0) continue;
                if (!this._characterIsAutoAllowedForPresetId(pid)) continue;
                candidates.push({ presetId: pid, hasScore: false, score: 0, idx: idx++ });
            }

            if (!candidates.length) {
                // 1) Fallback: auto-generate for current resolved preset (selection-based) if it has no images.
                const current = this._characterResolveActivePresetId();
                if (
                    current
                    && !this._characterIsAutoPresetInCooldown(current)
                    && this._characterGetImagesForPreset(current).length === 0
                    && this._characterIsAutoAllowedForPresetId(current)
                ) return current;

                // No enumeration fallback in the new model.
                return null;
            }
            candidates.sort((a, b) => {
                if (a.hasScore !== b.hasScore) return a.hasScore ? -1 : 1;
                if (a.hasScore && b.hasScore && a.score !== b.score) return b.score - a.score;
                return a.idx - b.idx;
            });

            // IMPORTANT (character auto): avoid repeatedly picking the same preset when
            // images haven't been inserted into allImageData yet (event ordering).
            // If the previously auto-started preset is still a candidate, rotate to the next.
            if (lastAutoPresetId && candidates.length > 1) {
                const pos = candidates.findIndex(c => String(c?.presetId || '') === lastAutoPresetId);
                if (pos >= 0) {
                    return candidates[(pos + 1) % candidates.length]?.presetId || candidates[0]?.presetId || null;
                }
            }

            return candidates[0]?.presetId || null;
        },

        _characterBuildAutoEnumOptions() {
            const cats = this._characterGetCategoryNames();
            const grouped = (this.state.character.tagGroups && this.state.character.tagGroups.grouped) ? this.state.character.tagGroups.grouped : {};
            const optionsByCat = cats.map(cat => {
                const enabledCat = this._characterIsCategoryAutoEnabled(cat);
                if (!enabledCat) return [''];
                const groups = Array.isArray(grouped?.[cat]) ? grouped[cat] : [];
                const ids = groups
                    .map(g => String(g?.id || '').trim())
                    .filter(Boolean)
                    .filter(id => this._characterIsGroupAutoEnabled(id));
                // Include empty selection as an option (represents "None").
                return [''].concat(ids);
            });
            return { cats, optionsByCat };
        },

        _characterPickNextEnumeratedPresetId() {
            if (this.state.viewMode !== 'character') return null;
            const pregen = this.state.character.pregen || (this.state.character.pregen = {});

            const { cats, optionsByCat } = this._characterBuildAutoEnumOptions();
            if (!cats.length) return null;
            if (optionsByCat.some(o => !Array.isArray(o) || o.length === 0)) return null;

            // Signature for resetting enumeration state when tag groups / toggles / categories change.
            let signature = '';
            try {
                signature = cats.map((c, idx) => `${c}:${(optionsByCat[idx] || []).join(',')}`).join('||');
            } catch {
                signature = String(Date.now());
            }

            if (pregen.enumSignature !== signature) {
                pregen.enumSignature = signature;
                pregen.enumIndices = new Array(cats.length).fill(0);
                pregen.enumAttempted = {};
                pregen.enumResetAt = Date.now();
            }

            const indices = Array.isArray(pregen.enumIndices) ? pregen.enumIndices : (pregen.enumIndices = new Array(cats.length).fill(0));
            const attempted = (pregen.enumAttempted && typeof pregen.enumAttempted === 'object') ? pregen.enumAttempted : (pregen.enumAttempted = {});

            const advance = () => {
                for (let i = 0; i < indices.length; i++) {
                    indices[i] = (indices[i] || 0) + 1;
                    if (indices[i] < optionsByCat[i].length) return;
                    indices[i] = 0;
                }
            };

            // Bound search to avoid blocking UI if option space is huge.
            const maxSteps = 2000;
            for (let step = 0; step < maxSteps; step++) {
                advance();

                const selections = {};
                for (let i = 0; i < cats.length; i++) {
                    const id = optionsByCat[i][indices[i]];
                    selections[cats[i]] = id ? id : null;
                }

                const key = this._characterBuildPresetKeyFromSelections(selections);
                if (!key) continue;
                const presetId = `auto:${key}`;
                if (attempted[presetId]) continue;
                attempted[presetId] = 1;

                if (this._characterIsAutoPresetInCooldown(presetId)) continue;

                if (!this._characterIsAutoAllowedForPresetId(presetId)) continue;
                if (this._characterGetImagesForPreset(presetId).length > 0) continue;
                return presetId;
            }

            return null;
        },

        async _characterAutoMaybeSchedule(allTasksStatus, { reason = '' } = {}) {
            if (this.state.viewMode !== 'character') return;
            if (!this.state.selectedCharacter) return;
            // Allow user to disable auto tasks in settings; default is enabled.
            if (this.state.character.settings?.pregen_enabled === false) return;
            if (!this.state.isComfyUIAvaidable) return;

            const pregen = this.state.character.pregen || (this.state.character.pregen = {});
            // Session token: allows immediate cancellation of in-flight scheduling when user disables auto
            // or leaves character view.
            const schedulerSessionId = (() => {
                const sid = Number(pregen.sessionId || 0);
                if (!Number.isFinite(sid)) {
                    pregen.sessionId = 0;
                    return 0;
                }
                return sid;
            })();

            const stillAllowed = () => {
                if (this.state.viewMode !== 'character') return false;
                if (!this.state.selectedCharacter) return false;
                if (this.state.character.settings?.pregen_enabled === false) return false;
                if (!this.state.isComfyUIAvaidable) return false;
                const current = Number(pregen.sessionId || 0);
                if (!Number.isFinite(current)) return false;
                if (current !== schedulerSessionId) return false;
                if (pregen.suspended) return false;
                return true;
            };

            if (pregen.isScheduling) return;

            // If we just did a manual (non-auto) generation to "fill" a preset that had no images,
            // wait until we actually observe at least one image for that preset.
            // This avoids double-requests due to event ordering (task_ended may arrive before image:added).
            try {
                const fillId = String(pregen.manualFillPresetId || '').trim();
                if (fillId) {
                    const hasAny = this._characterGetImagesForPreset(fillId).length > 0;
                    if (hasAny) {
                        pregen.manualFillPresetId = null;
                    } else {
                        const setAt = Number(pregen.manualFillSetAt || 0);
                        const maxWaitMs = 60_000;
                        const now = Date.now();
                        // Prevent deadlock: if manual fill produced no images for too long,
                        // clear the guard so auto scheduling can resume.
                        if (setAt && Number.isFinite(setAt) && (now - setAt) >= maxWaitMs) {
                            pregen.manualFillPresetId = null;
                            pregen.manualFillTimedOutAt = now;
                        } else {
                            return;
                        }
                    }
                }
            } catch { }

            const now = Date.now();
            const throttleMs = this._CHAR_AUTO_SCHEDULE_THROTTLE_MS || 500;
            if (pregen.lastScheduleAt && (now - pregen.lastScheduleAt) < throttleMs) return;
            pregen.lastScheduleAt = now;

            if (!stillAllowed()) return;
            if ((pregen.sessionAutoImagesStarted || 0) >= (this._CHAR_AUTO_MAX_IMAGES_PER_SESSION || 100)) return;

            // Decide running state from provided status or cache; fallback to fetch once.
            let tasksStatus = allTasksStatus || this._lastAllTasksStatus;
            if (!tasksStatus || (typeof tasksStatus === 'object' && Object.keys(tasksStatus).length === 0)) {
                try {
                    const statusResp = await this.api.generation.getStatus();
                    tasksStatus = statusResp?.tasks || statusResp || {};
                } catch {
                    tasksStatus = this._lastAllTasksStatus || {};
                }
            }

            if (!stillAllowed()) return;

            // Do not start auto while any non-auto task is running.
            if (this._characterHasRunningNonAutoTask(tasksStatus)) return;

            // Only one auto task at a time.
            if (this._characterHasRunningAutoTask(tasksStatus)) return;

            // ------------------------------
            // Visual Novel mode: auto-generate global backgrounds first
            // ------------------------------
            try {
                if (typeof this._characterIsVisualNovelModeEnabled === 'function' && this._characterIsVisualNovelModeEnabled()) {
                    // Load cache if needed
                    try { await this._characterVNEnsureBackgroundCacheLoaded?.(); } catch { }

                    const bgCat = this._characterGetVisualNovelBackgroundCategoryName?.();
                    const grouped = (this.state.character.tagGroups && this.state.character.tagGroups.grouped) ? this.state.character.tagGroups.grouped : {};
                    const groups = bgCat && Array.isArray(grouped?.[bgCat]) ? grouped[bgCat] : [];
                    const bgMap = (this.state.character?.vn?.backgrounds && typeof this.state.character.vn.backgrounds === 'object')
                        ? this.state.character.vn.backgrounds
                        : {};

                    const nextMissing = (groups || [])
                        .map(g => String(g?.id || '').trim())
                        .filter(Boolean)
                        .filter(id => {
                            // Respect existing per-category/per-group auto toggles
                            try {
                                if (!this._characterIsCategoryAutoEnabled?.(bgCat)) return false;
                                if (!this._characterIsGroupAutoEnabled?.(id)) return false;
                            } catch { }
                            const entry = bgMap[id];
                            const url = entry && typeof entry === 'object' ? (entry.url || '') : String(entry || '');
                            return !String(url || '').trim();
                        })
                        [0] || null;

                    if (nextMissing) {
                        pregen.isScheduling = true;
                        try {
                            await this._characterStartVNBackgroundGeneration?.({ groupId: nextMissing, auto: true, silent: true });
                            pregen.lastRanAt = Date.now();
                        } finally {
                            pregen.isScheduling = false;
                        }
                        return;
                    }
                }
            } catch { }

            const nextPresetId = this._characterPickNextAutoPresetId();
            if (!nextPresetId) return;
            if (this._characterIsAutoPresetInCooldown(nextPresetId, now)) return;

            if (!stillAllowed()) return;

            pregen.isScheduling = true;
            try {
                const resp = await this._characterStartGeneration({ forceNew: true, presetId: nextPresetId, auto: true, silent: true });
                const taskId = resp?.task_id || resp?.taskId;

                // Backoff on immediate start failures (network/Comfy errors).
                if (!taskId) {
                    const pid = String(nextPresetId || '').trim();
                    if (pid) {
                        if (!pregen.autoFailCountByPresetId || typeof pregen.autoFailCountByPresetId !== 'object') {
                            pregen.autoFailCountByPresetId = {};
                        }
                        if (!pregen.autoCooldownUntilByPresetId || typeof pregen.autoCooldownUntilByPresetId !== 'object') {
                            pregen.autoCooldownUntilByPresetId = {};
                        }
                        const prev = Number(pregen.autoFailCountByPresetId[pid] || 0);
                        const nextCount = Number.isFinite(prev) ? (prev + 1) : 1;
                        pregen.autoFailCountByPresetId[pid] = nextCount;

                        const baseMs = 10_000;
                        const maxMs = 5 * 60_000;
                        const delayMs = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, nextCount - 1)));
                        pregen.autoCooldownUntilByPresetId[pid] = Date.now() + delayMs;
                        pregen.lastAutoFailAt = Date.now();
                    }
                } else {
                    // Success: clear failure state for this preset.
                    const pid = String(nextPresetId || '').trim();
                    try {
                        if (pregen.autoFailCountByPresetId && typeof pregen.autoFailCountByPresetId === 'object') {
                            delete pregen.autoFailCountByPresetId[pid];
                        }
                        if (pregen.autoCooldownUntilByPresetId && typeof pregen.autoCooldownUntilByPresetId === 'object') {
                            delete pregen.autoCooldownUntilByPresetId[pid];
                        }
                    } catch { }
                }
                pregen.lastRanAt = Date.now();
            } finally {
                pregen.isScheduling = false;
            }
        },

        async _characterAfterManualTaskEndedMaybeStartNewPreset() {
            // Legacy hook name (kept for compatibility): after non-auto task ends, resume auto scheduling.
            try { this.state.character.pregen.suspended = false; } catch { }
            await this._characterAutoMaybeSchedule(null, { reason: 'manual-ended' });
        },

        async _ensureSortable() {
            if (windowObj.Sortable) return windowObj.Sortable;
            if (this._sortablePromise) return this._sortablePromise;

            this._sortablePromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/static/sortable.min.js';
                script.async = true;
                script.onload = () => resolve(windowObj.Sortable);
                script.onerror = () => reject(new Error('Failed to load SortableJS (/static/sortable.min.js).'));
                document.head.appendChild(script);
            });

            return this._sortablePromise;
        },

        async _characterEnableTagGroupSorting(category, listEl) {
            if (!category || !listEl) return;
            try {
                const Sortable = await this._ensureSortable();

                // Destroy previous instance when switching categories / reopening submenu
                if (this._characterTagGroupSortable && typeof this._characterTagGroupSortable.destroy === 'function') {
                    try { this._characterTagGroupSortable.destroy(); } catch { }
                }

                this._characterTagGroupSortable = new Sortable(listEl, {
                    animation: 150,
                    // Use a dedicated drag handle so interactions are consistent across PC + phone.
                    delay: 0,
                    delayOnTouchOnly: false,
                    touchStartThreshold: 3,
                    // Only actual group rows are draggable (exclude toolbar rows)
                    draggable: '.plugin-album__character-submenu-row[data-group-id]',
                    handle: '.plugin-album__character-submenu-drag',
                    filter: '.plugin-album__character-submenu-row--toolbar',
                    preventOnFilter: true,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',
                    onStart: () => { this._characterIsSortingTagGroups = true; },
                    onEnd: async () => {
                        try {
                            const orderedIds = Array.from(listEl.querySelectorAll('.plugin-album__character-submenu-row[data-group-id]'))
                                .map(el => String(el.dataset.groupId || '').trim())
                                .filter(Boolean);

                            // Update local state order
                            const groups = this.state.character.tagGroups?.grouped?.[category] || [];
                            const byId = new Map(groups.map(g => [g.id, g]));

                            const ordered = [];
                            orderedIds.forEach(id => {
                                const g = byId.get(id);
                                if (g) ordered.push(g);
                            });
                            // Append any missing
                            groups.forEach(g => {
                                if (!orderedIds.includes(g.id)) ordered.push(g);
                            });

                            if (!this.state.character.tagGroups) this.state.character.tagGroups = { grouped: {}, flat: {} };
                            if (!this.state.character.tagGroups.grouped) this.state.character.tagGroups.grouped = {};
                            this.state.character.tagGroups.grouped[category] = ordered;

                            // Persist order to backend
                            await this.api.album.post('/character/tag_groups/reorder', {
                                category,
                                ordered_ids: orderedIds,
                            });

                            // Refresh submenu UI now that order is saved
                            this._characterRefreshSubmenu(category);
                        } catch (err) {
                            showError(`Lỗi lưu thứ tự nhóm tag: ${err.message}`);
                        } finally {
                            this._characterIsSortingTagGroups = false;
                        }
                    }
                });
            } catch (err) {
                console.error('[Album][character] Sortable init failed:', err);
                showError('Không thể bật kéo-thả sắp xếp nhóm tag.');
            }
        },
    });
})(window);
