// --- MODIFIED FILE: static/scene.js ---
class SceneManager {
    constructor() {
        this.container = document.getElementById('scene-container');
        this.controls = document.getElementById('scene-controls');
        this.tagGroupModal = document.getElementById('tag-group-modal');
        this.isMobile = window.innerWidth <= 768;

        this.scenes = [];
        this.tagGroups = {}; // { grouped: {...}, flat: {...} }
        this.tagPredictions = [];
        this.selected = { type: null, sceneId: null, stageId: null };
        this.dragged = { element: null, type: null, sceneId: null, stageId: null, groupId: null, category: null, width: 0, height: 0 };
        this.placeholder = null;

        this.touchStartTimeout = null;
        this.isTouchDragging = false;
        this.preventClick = false;
        this.touchStartCoords = { x: 0, y: 0 };
        this.TOUCH_MOVE_THRESHOLD = 10;

        this.generationState = {
            isRunning: false,
            statusInterval: null,
            generatingIds: { sceneId: null, stageId: null },
            activeStageElement: null
        };
        this.initEventListeners();
    }

    async init() {
        this.container.innerHTML = `<div class="loader visible">Đang tải dữ liệu Scene...</div>`;
        try {
            if (this.tagPredictions.length === 0) {
                 this.tagPredictions = await api.getTags();
            }
            const [scenes, tagGroupsData] = await Promise.all([
                api.getScenes(),
                api.getTagGroups()
            ]);
            this.scenes = scenes;
            this.tagGroups = tagGroupsData;
            
            if (this.isMobile) {
                this.scenes.forEach(scene => scene.stages.forEach(stage => {
                    if (stage.isCollapsed === undefined) stage.isCollapsed = true;
                }));
            }
            this.render();
            this.checkGenerationStatus(true);
        } catch (error) {
            console.error("Failed to initialize Scene Manager:", error);
            this.container.innerHTML = `<div class="error-msg">Lỗi tải dữ liệu: ${error.message}</div>`;
        }
    }

    async saveState() {
        const scenesToSave = JSON.parse(JSON.stringify(this.scenes));
        scenesToSave.forEach(s => s.stages.forEach(st => delete st.isCollapsed));
        try {
            await api.saveScenes(scenesToSave);
        } catch (error) {
            showError(`Lỗi lưu trạng thái: ${error.message}`);
        }
    }
    
    render() {
        this.container.innerHTML = '';
        if (this.scenes.length === 0) {
            this.container.appendChild(this.createAddSceneButton());
        } else {
            this.scenes.forEach(scene => this.container.appendChild(this.createSceneRow(scene)));
            this.container.appendChild(this.createAddSceneButton());
        }
        this.updateControls();
        this.updateGeneratingFX();
    }

    createSceneRow(scene) {
        const row = document.createElement('div');
        row.className = 'scene-row scene-block';
        row.dataset.sceneId = scene.id;
        row.draggable = true;
        if (scene.id === this.selected.sceneId && this.selected.type === 'scene') row.classList.add('selected');
        if (scene.bypassed) row.classList.add('bypassed');
        const stagesWrapper = document.createElement('div');
        stagesWrapper.className = 'stages-wrapper';
        scene.stages.forEach((stage, index) => stagesWrapper.appendChild(this.createStageBlock(stage, scene.id, index)));
        stagesWrapper.appendChild(this.createAddStageButton(scene.id));
        row.appendChild(stagesWrapper);
        return row;
    }

    createStageBlock(stage, sceneId, index) {
        const block = document.createElement('div');
        block.className = 'stage-block scene-block';
        block.dataset.stageId = stage.id;
        block.dataset.sceneId = sceneId;
        block.draggable = true;
        if (this.isMobile && stage.isCollapsed) block.classList.add('collapsed');
        if (stage.id === this.selected.stageId) block.classList.add('selected');
        if (stage.bypassed) block.classList.add('bypassed');

        const title = document.createElement('div');
        title.className = 'stage-block-title';
        title.textContent = `Stage ${index + 1}`;
        if (this.isMobile) block.appendChild(document.createElement('div')).className = 'stage-collapse-toggle';
        
        const categoriesWrapper = document.createElement('div');
        categoriesWrapper.className = 'stage-categories-wrapper';
        ['Character', 'Pose', 'Outfits', 'View', 'Context'].forEach(cat => {
            const catDiv = document.createElement('div');
            catDiv.className = 'stage-category';
            catDiv.innerHTML = `<label class="stage-category-label">${cat.toUpperCase()}</label>`;
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'stage-category-tags';
            tagsContainer.dataset.category = cat;
            (stage.tags[cat] || []).forEach(groupId => {
                const group = this.findTagGroup(groupId);
                if (group) tagsContainer.appendChild(this.createTagGroupBlock(group, cat));
            });
            tagsContainer.appendChild(this.createAddTagGroupButton(cat, sceneId, stage.id));
            catDiv.appendChild(tagsContainer);
            categoriesWrapper.appendChild(catDiv);
        });
        block.appendChild(title);
        block.appendChild(categoriesWrapper);
        return block;
    }

    createTagGroupBlock(group, category) {
        const block = document.createElement('div');
        block.className = 'tag-group-block scene-block';
        block.textContent = group.name;
        block.draggable = true;
        block.dataset.groupId = group.id;
        block.dataset.category = category;
        return block;
    }
    
    createAddTagGroupButton(cat, sceneId, stageId) {
        const btn = document.createElement('button');
        btn.className = 'add-tag-group-btn';
        btn.textContent = '+';
        btn.dataset.category = cat; btn.dataset.sceneId = sceneId; btn.dataset.stageId = stageId;
        return btn;
    }

    createAddSceneButton() { const btn = document.createElement('div'); btn.className = 'add-scene-btn'; btn.textContent = '+'; btn.title = 'Thêm Scene mới'; return btn; }
    createAddStageButton(sceneId) { const btn = document.createElement('div'); btn.className = 'add-stage-btn'; btn.dataset.sceneId = sceneId; btn.textContent = '+'; btn.title = 'Thêm Stage mới'; return btn; }
    
    updateControls() {
        const hasSelection = this.selected.type !== null;
        this.controls.querySelectorAll('button').forEach(btn => {
            const action = btn.dataset.action;
            const isGenDisabled = !state.isComfyUIAvailable;

            if (this.generationState.isRunning) {
                if (action === 'play' || action === 'settings') btn.disabled = true;
                else if (action === 'stop') btn.disabled = false;
                else btn.disabled = !hasSelection;
            } else {
                if (action === 'play') btn.disabled = isGenDisabled || !hasSelection;
                else if (action === 'stop') btn.disabled = true;
                else if (action === 'settings') btn.disabled = isGenDisabled || this.selected.type !== 'scene';
                else btn.disabled = !hasSelection;
            }
        });
    }

    initEventListeners() {
        this.container.addEventListener('click', this.handleClick.bind(this));
        this.controls.addEventListener('click', this.handleControls.bind(this));
        this.container.addEventListener('dragstart', this.handleDragStart.bind(this));
        this.container.addEventListener('dragover', this.handleDragOver.bind(this));
        this.container.addEventListener('drop', this.handleDrop.bind(this));
        this.container.addEventListener('dragend', this.handleDragEnd.bind(this));
        this.container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        this.container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.container.addEventListener('touchend', this.handleTouchEnd.bind(this));
        
        // Yuuka: Sửa logic này. Chỉ đóng modal nếu nó không có thuộc tính 'data-persistent'
        this.tagGroupModal.addEventListener('click', (e) => {
            if (e.target === this.tagGroupModal && !this.tagGroupModal.dataset.persistent) {
                this.closeTagGroupModal();
            }
        });
    }

    handleClick(e) {
        if (this.preventClick) { e.stopPropagation(); e.preventDefault(); return; }
        const addSceneBtn = e.target.closest('.add-scene-btn'), addStageBtn = e.target.closest('.add-stage-btn');
        const addTagBtn = e.target.closest('.add-tag-group-btn'), tagBlock = e.target.closest('.tag-group-block');
        const collapse = e.target.closest('.stage-collapse-toggle'), selectable = e.target.closest('.scene-block');

        if (this.isMobile && collapse) {
            const stageBlock = collapse.parentElement;
            const scene = this.scenes.find(s => s.id === stageBlock.dataset.sceneId);
            const stage = scene?.stages.find(st => st.id === stageBlock.dataset.stageId);
            if (stage) { stage.isCollapsed = !stage.isCollapsed; stageBlock.classList.toggle('collapsed'); }
            e.stopPropagation(); return;
        }
        if (addSceneBtn) this.addScene();
        else if (addStageBtn) this.addStage(addStageBtn.dataset.sceneId);
        else if (addTagBtn) this.openTagGroupSelector(addTagBtn.dataset.category, addTagBtn.dataset.sceneId, addTagBtn.dataset.stageId);
        else if (tagBlock) { e.stopPropagation(); this.openTagGroupEditor(tagBlock); }
        else if (selectable) this.select(selectable);
        else this.select(null);
    }

    handleControls(e) { const btn = e.target.closest('button'); if (!btn || btn.disabled) return; const action = btn.dataset.action; switch(action) { case 'play': this.startGeneration(); break; case 'stop': this.cancelGeneration(); break; case 'bypass': this.toggleBypass(); break; case 'settings': this.openSettings(); break; case 'delete': this.deleteSelected(); break; } }
    addScene() { const last = this.scenes.at(-1); const newScene = { id: `scene_${Date.now()}`, stages: [], bypassed: false, generationConfig: last ? JSON.parse(JSON.stringify(last.generationConfig || {})) : {} }; this.scenes.push(newScene); this.saveState(); this.render(); }
    addStage(sceneId) { const scene = this.scenes.find(s => s.id === sceneId); if (!scene) return; const newStage = { id: `stage_${Date.now()}`, tags: {}, bypassed: false, isCollapsed: false }; if (scene.stages.length > 0) newStage.tags = JSON.parse(JSON.stringify(scene.stages.at(-1).tags)); scene.stages.push(newStage); this.saveState(); this.render(); }
    select(el) { if (!el) this.selected = { type: null, sceneId: null, stageId: null }; else if (el.classList.contains('stage-block')) this.selected = { type: 'stage', sceneId: el.dataset.sceneId, stageId: el.dataset.stageId }; else if (el.classList.contains('scene-row')) this.selected = { type: 'scene', sceneId: el.dataset.sceneId, stageId: null }; else return; this.render(); }

    deleteSelected() {
        if (!this.selected.type) return;
        let confirmNeeded = true, msg = '';
        if (this.selected.type === 'scene') { const s = this.scenes.find(sc => sc.id === this.selected.sceneId); if (s) { const empty = s.stages.length === 0 || s.stages.every(st => Object.values(st.tags).every(arr => arr.length === 0)); if (empty) confirmNeeded = false; else msg = 'Bạn có chắc muốn xoá toàn bộ Scene này?'; }}
        else if (this.selected.type === 'stage') { const s = this.scenes.find(sc => sc.id === this.selected.sceneId); const st = s?.stages.find(stg => stg.id === this.selected.stageId); if (st) { const empty = Object.values(st.tags).every(arr => arr.length === 0); if (empty) confirmNeeded = false; else msg = 'Bạn có chắc muốn xoá Stage này?'; }}
        if (confirmNeeded && !confirm(msg)) return;
        if (this.selected.type === 'scene') this.scenes = this.scenes.filter(s => s.id !== this.selected.sceneId);
        else if (this.selected.type === 'stage') { const s = this.scenes.find(sc => sc.id === this.selected.sceneId); if (s) s.stages = s.stages.filter(st => st.id !== this.selected.stageId); }
        this.select(null); this.saveState(); this.render();
    }
    
    toggleBypass() { if (!this.selected.type) return; if (this.selected.type === 'scene') { const s = this.scenes.find(sc => sc.id === this.selected.sceneId); if (s) s.bypassed = !s.bypassed; } else if (this.selected.type === 'stage') { const s = this.scenes.find(sc => sc.id === this.selected.sceneId); const st = s?.stages.find(stg => stg.id === this.selected.stageId); if (st) st.bypassed = !st.bypassed; } this.saveState(); this.render(); }
    
    async openSettings() { if (this.selected.type !== 'scene') { showError("Vui lòng chọn một Scene để cấu hình."); return; } const scene = this.scenes.find(s => s.id === this.selected.sceneId); if (!scene) return; this.renderSceneSettingsModal(scene); }
    
    async startGeneration() {
        if (this.generationState.isRunning || !this.selected.type) return;
        const startSceneIdx = this.scenes.findIndex(s => s.id === this.selected.sceneId); if (startSceneIdx === -1) return;
        let startStageIdx = this.selected.type === 'stage' ? this.scenes[startSceneIdx].stages.findIndex(st => st.id === this.selected.stageId) : 0;
        const scenesRaw = this.scenes.slice(startSceneIdx); if (scenesRaw.length === 0) { showError("Không có scene nào hợp lệ để gen."); return; }
        const firstSceneRaw = JSON.parse(JSON.stringify(scenesRaw[0])); firstSceneRaw.stages = firstSceneRaw.stages.slice(startStageIdx);
        const job = { scenes: [firstSceneRaw, ...JSON.parse(JSON.stringify(scenesRaw.slice(1)))] };
        try { await api.startSceneGeneration(job); this.generationState.isRunning = true; this.updateControls(); this.startStatusPolling(); } catch (error) { showError(`Lỗi bắt đầu: ${error.message}`); }
    }
    async cancelGeneration() { if (!this.generationState.isRunning) return; try { await api.cancelSceneGeneration(); showError("Đã gửi yêu cầu huỷ."); } catch(error) { showError(`Lỗi khi huỷ: ${error.message}`); } }
    startStatusPolling() { if (this.generationState.statusInterval) clearInterval(this.generationState.statusInterval); this.generationState.statusInterval = setInterval(() => this.checkGenerationStatus(), 1500); }
    stopStatusPolling() { clearInterval(this.generationState.statusInterval); this.generationState.statusInterval = null; this.generationState.isRunning = false; this.generationState.generatingIds = { sceneId: null, stageId: null }; this.updateGeneratingFX(); this.updateControls(); showError("Quá trình sinh ảnh đã kết thúc."); }
    async checkGenerationStatus(isInitial = false) { try { const status = await api.getSceneGenerationStatus(); if (status.is_running) { this.generationState.isRunning = true; const p = status.progress; showError(`${p.message} (${p.current}${p.total > 0 ? `/${p.total}` : ''})`); this.generationState.generatingIds = { sceneId: status.current_scene_id, stageId: status.current_stage_id }; this.updateGeneratingFX(); if (isInitial) this.startStatusPolling(); } else if (this.generationState.isRunning) { this.stopStatusPolling(); } this.updateControls(); } catch (error) { this.stopStatusPolling(); } }
    updateGeneratingFX() { const { sceneId, stageId } = this.generationState.generatingIds; if (this.generationState.activeStageElement) { this.generationState.activeStageElement.removeEventListener('mouseenter', this.onEnterGeneratingStage); this.generationState.activeStageElement.removeEventListener('mouseleave', this.onLeaveGeneratingStage); this.generationState.activeStageElement = null; } this.container.querySelectorAll('.is-generating, .is-generating-scene').forEach(el => el.classList.remove('is-generating', 'is-generating-scene')); if (sceneId) this.container.querySelector(`.scene-row[data-scene-id="${sceneId}"]`)?.classList.add('is-generating-scene'); if (stageId) { const stageEl = this.container.querySelector(`.stage-block[data-stage-id="${stageId}"]`); if (stageEl) { stageEl.classList.add('is-generating'); this.generationState.activeStageElement = stageEl; stageEl.addEventListener('mouseenter', this.onEnterGeneratingStage.bind(this)); stageEl.addEventListener('mouseleave', this.onLeaveGeneratingStage.bind(this)); } } }
    onEnterGeneratingStage() { this.controls.querySelector('button[data-action="delete"]').disabled = true; }
    onLeaveGeneratingStage() { this.updateControls(); }

    _startDrag(target) { if (!target) return false; this.dragged.element = target; const rect = target.getBoundingClientRect(); this.dragged.width = rect.width; this.dragged.height = rect.height; if (target.classList.contains('scene-row')) { this.dragged.type = 'scene'; this.dragged.sceneId = target.dataset.sceneId; } else if (target.classList.contains('stage-block')) { this.dragged.type = 'stage'; this.dragged.sceneId = target.dataset.sceneId; this.dragged.stageId = target.dataset.stageId; } else if (target.classList.contains('tag-group-block')) { this.dragged.type = 'tag_group'; const stage = target.closest('.stage-block'); this.dragged.sceneId = stage.dataset.sceneId; this.dragged.stageId = stage.dataset.stageId; this.dragged.groupId = target.dataset.groupId; this.dragged.category = target.dataset.category; } setTimeout(() => target.classList.add('dragging'), 0); return true; }
    _endDrag() { if (this.placeholder?.parentElement) this.saveState(); this.dragged.element?.classList.remove('dragging'); this.placeholder?.remove(); this.placeholder = null; this.dragged = { element: null, type: null, sceneId: null, stageId: null, groupId: null, category: null, width: 0, height: 0 }; this.render(); }
    _updateDropZones(coords) { if (!this.dragged.element) return; if (!this.placeholder) { this.placeholder = document.createElement('div'); this.placeholder.className = 'drag-placeholder'; this.placeholder.style.width = `${this.dragged.width}px`; this.placeholder.style.height = `${this.dragged.height}px`; } this.placeholder.style.display = 'none'; const elUnder = document.elementFromPoint(coords.clientX, coords.clientY); this.placeholder.style.display = ''; if (!elUnder) return; let dropTarget = null, container = null; if (this.dragged.type === 'scene') { dropTarget = elUnder.closest('.scene-row'); container = this.container; } else if (this.dragged.type === 'stage') { dropTarget = elUnder.closest('.stage-block, .add-stage-btn'); container = elUnder.closest('.stages-wrapper'); if (this.placeholder) this.placeholder.className = 'drag-placeholder stage-placeholder'; } else if (this.dragged.type === 'tag_group') { container = elUnder.closest('.stage-category-tags'); if (container?.dataset.category === this.dragged.category) { dropTarget = elUnder.closest('.tag-group-block, .add-tag-group-btn'); if (this.placeholder) this.placeholder.className = 'drag-placeholder tag-group-placeholder'; } else container = null; } if (container) { if (dropTarget) this.insertPlaceholder(coords, dropTarget, container, this.dragged.type !== 'scene' && !this.isMobile); else if (this.dragged.type === 'tag_group') container.appendChild(this.placeholder); } else if (this.placeholder.parentElement) this.placeholder.remove(); }
    insertPlaceholder(coords, target, container, isHorizontal) { if (this.placeholder.parentElement !== container) container.appendChild(this.placeholder); const rect = target.getBoundingClientRect(); const offset = isHorizontal ? coords.clientX - rect.left : coords.clientY - rect.top; const threshold = isHorizontal ? rect.width / 2 : rect.height / 2; if (offset < threshold) container.insertBefore(this.placeholder, target); else container.insertBefore(this.placeholder, target.nextElementSibling); }
    _performDrop() { if (!this.placeholder?.parentElement) return; const parent = this.placeholder.parentElement, targetIndex = Array.from(parent.children).indexOf(this.placeholder); if (this.dragged.type === 'scene') this.moveScene(this.dragged.sceneId, targetIndex); else if (this.dragged.type === 'stage') { const toSceneId = parent.closest('.scene-row').dataset.sceneId; this.moveStage(this.dragged.sceneId, this.dragged.stageId, toSceneId, targetIndex); } else if (this.dragged.type === 'tag_group') { const toStageBlock = parent.closest('.stage-block'); const toSceneId = toStageBlock.dataset.sceneId, toStageId = toStageBlock.dataset.stageId, toCategory = parent.dataset.category; this.moveTagGroup({ sceneId: this.dragged.sceneId, stageId: this.dragged.stageId, category: this.dragged.category, groupId: this.dragged.groupId }, { sceneId: toSceneId, stageId: toStageId, category: toCategory, index: targetIndex }); } }
    handleDragStart(e) { const target = e.target.closest('.scene-row, .stage-block, .tag-group-block'); if (!this._startDrag(target)) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'move'; }
    handleDragOver(e) { e.preventDefault(); this._updateDropZones({ clientX: e.clientX, clientY: e.clientY }); }
    handleDrop(e) { e.preventDefault(); e.stopPropagation(); this._performDrop(); }
    handleDragEnd() { this._endDrag(); }
    handleTouchStart(e) { const target = e.target.closest('.scene-row, .stage-block, .tag-group-block'); if (!target) return; const touch = e.touches[0]; this.touchStartCoords = { x: touch.clientX, y: touch.clientY }; this.isTouchDragging = false; clearTimeout(this.touchStartTimeout); this.touchStartTimeout = setTimeout(() => { if (this._startDrag(target)) { this.isTouchDragging = true; this.preventClick = true; if (navigator.vibrate) navigator.vibrate(50); } }, 500); }
    handleTouchMove(e) { if (!this.dragged.element && this.touchStartTimeout) { const touch = e.touches[0]; if (Math.abs(touch.clientX - this.touchStartCoords.x) > 10 || Math.abs(touch.clientY - this.touchStartCoords.y) > 10) { clearTimeout(this.touchStartTimeout); this.touchStartTimeout = null; } return; } if (!this.isTouchDragging) return; e.preventDefault(); this._updateDropZones({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }); }
    handleTouchEnd() { clearTimeout(this.touchStartTimeout); this.touchStartTimeout = null; if (!this.isTouchDragging) return; this._performDrop(); this._endDrag(); this.isTouchDragging = false; setTimeout(() => { this.preventClick = false; }, 100); }
    moveScene(draggedId, targetIndex) { const idx = this.scenes.findIndex(s => s.id === draggedId); if (idx === -1) return; const [item] = this.scenes.splice(idx, 1); this.scenes.splice(targetIndex, 0, item); }
    moveStage(fromSceneId, stageId, toSceneId, targetIndex) { const fromScene = this.scenes.find(s => s.id === fromSceneId), toScene = this.scenes.find(s => s.id === toSceneId); if (!fromScene || !toScene) return; const idx = fromScene.stages.findIndex(st => st.id === stageId); if (idx === -1) return; const [item] = fromScene.stages.splice(idx, 1); toScene.stages.splice(targetIndex, 0, item); }
    moveTagGroup(from, to) { const fromScene = this.scenes.find(s => s.id === from.sceneId), fromStage = fromScene?.stages.find(st => st.id === from.stageId); const toScene = this.scenes.find(s => s.id === to.sceneId), toStage = toScene?.stages.find(st => st.id === to.stageId); if (!fromStage || !toStage || from.category !== to.category) return; const idx = fromStage.tags[from.category]?.indexOf(from.groupId); if (idx === undefined || idx === -1) return; const [movedId] = fromStage.tags[from.category].splice(idx, 1); if (!toStage.tags[to.category]) toStage.tags[to.category] = []; if (from.stageId !== to.stageId && toStage.tags[to.category].includes(movedId)) { fromStage.tags[from.category].splice(idx, 0, movedId); showError("Tag group này đã tồn tại trong category đích."); return; } toStage.tags[to.category].splice(to.index, 0, movedId); }

    findTagGroup(groupId) { return this.tagGroups.flat[groupId] || null; }
    openTagGroupEditor(tagBlock) { const group = this.findTagGroup(tagBlock.dataset.groupId); if (group) this.renderNewTagGroupForm(group.category, tagBlock, group); }
    openTagGroupSelector(category, sceneId, stageId) {
        const modalContent = this.tagGroupModal.querySelector('#tag-group-modal-content');
        const scene = this.scenes.find(s => s.id === sceneId), stage = scene?.stages.find(st => st.id === stageId); if (!stage) return;
        const stageBlock = this.container.querySelector(`.stage-block[data-scene-id="${sceneId}"][data-stage-id="${stageId}"]`);
        const assignedIds = new Set(stage.tags[category] || []);
        const buttonsHTML = (this.tagGroups.grouped[category] || []).map(g => `<button class="tag-group-select-btn ${assignedIds.has(g.id) ? 'selected' : ''}" data-group-id="${g.id}">${g.name}</button>`).join('');
        modalContent.innerHTML = `<h3>Select Groups for ${category}</h3><div class="tag-group-selector-grid">${buttonsHTML}</div><div class="modal-actions"><button id="tag-group-new-btn">New</button><div style="flex-grow: 1;"></div><button id="tag-group-cancel-btn">Cancel</button><button id="tag-group-done-btn">Done</button></div>`;
        
        // Yuuka: Xóa thuộc tính persistent khi mở modal selector
        delete this.tagGroupModal.dataset.persistent;
        
        this.tagGroupModal.style.display = 'flex';
        modalContent.querySelector('.tag-group-selector-grid').addEventListener('click', e => e.target.matches('.tag-group-select-btn') && e.target.classList.toggle('selected'));
        modalContent.querySelector('#tag-group-new-btn').onclick = () => this.renderNewTagGroupForm(category, stageBlock);
        modalContent.querySelector('#tag-group-cancel-btn').onclick = () => this.closeTagGroupModal();
        modalContent.querySelector('#tag-group-done-btn').onclick = () => { stage.tags[category] = Array.from(modalContent.querySelectorAll('.tag-group-select-btn.selected')).map(btn => btn.dataset.groupId); this.saveState(); this.render(); this.closeTagGroupModal(); };
    }
    renderNewTagGroupForm(category, contextElement, group = null) {
        const modalContent = this.tagGroupModal.querySelector('#tag-group-modal-content'), isEditing = group !== null;
        let actions = isEditing ? `<button id="tag-group-remove-btn" class="btn-secondary" title="Gỡ khỏi Stage">➖</button><button id="tag-group-delete-btn" class="btn-danger" title="Xoá vĩnh viễn">🗑️</button>` : '';
        actions += `<div style="flex-grow: 1;"></div><button id="tag-group-cancel-btn">Cancel</button><button id="tag-group-save-btn">${isEditing ? 'Update' : 'Save'}</button>`;
        modalContent.innerHTML = `<h3>${isEditing ? 'Edit' : 'New'} Tag Group in ${category}</h3><div class="form-group"><label for="tag-group-name-input">Group Name</label><input type="text" id="tag-group-name-input" value="${isEditing ? group.name : ''}"></div><div class="form-group"><label for="tag-group-tags-input">Tags (comma separated)</label><textarea id="tag-group-tags-input" rows="3">${isEditing ? group.tags.join(', ') : ''}</textarea></div><div class="modal-actions">${actions}</div>`;
        this._initTagAutocomplete(modalContent);
        
        // Yuuka: Thêm thuộc tính persistent để ngăn modal đóng khi click ra ngoài
        this.tagGroupModal.dataset.persistent = 'true';
        
        this.tagGroupModal.style.display = 'flex';
        modalContent.querySelector('#tag-group-cancel-btn').onclick = () => this.closeTagGroupModal();
        if (isEditing) {
            modalContent.querySelector('#tag-group-remove-btn').onclick = () => { const stageBlock = contextElement.closest('.stage-block'); const scene = this.scenes.find(s => s.id === stageBlock.dataset.sceneId); const stage = scene?.stages.find(st => st.id === stageBlock.dataset.stageId); if (stage?.tags[category]) { stage.tags[category] = stage.tags[category].filter(id => id !== group.id); this.saveState(); this.render(); this.closeTagGroupModal(); }};
            modalContent.querySelector('#tag-group-delete-btn').onclick = async () => { if (!confirm(`Bạn có chắc muốn XOÁ VĨNH VIỄN tag group '${group.name}'?`)) return; try { await api.deleteTagGroup(group.id); if (this.tagGroups.grouped[category]) this.tagGroups.grouped[category] = this.tagGroups.grouped[category].filter(g => g.id !== group.id); delete this.tagGroups.flat[group.id]; this.scenes.forEach(s => s.stages.forEach(st => { if (st.tags?.[category]) st.tags[category] = st.tags[category].filter(id => id !== group.id); })); showError(`Đã xoá group '${group.name}'.`); this.render(); this.closeTagGroupModal(); } catch (error) { showError(`Lỗi xoá group: ${error.message}`); } };
        }
        modalContent.querySelector('#tag-group-save-btn').onclick = async () => { const name = modalContent.querySelector('#tag-group-name-input').value.trim(), tagsText = modalContent.querySelector('#tag-group-tags-input').value.trim(); if (!name || !tagsText) { showError("Vui lòng điền đủ tên và tags."); return; } const payload = { name, tags: tagsText.split(',').map(t => t.trim()).filter(Boolean) }; try { if (isEditing) { const updated = await api.updateTagGroup(group.id, payload); const idx = this.tagGroups.grouped[category].findIndex(g => g.id === group.id); if (idx > -1) this.tagGroups.grouped[category][idx] = { ...this.tagGroups.grouped[category][idx], ...updated }; this.tagGroups.flat[group.id] = { ...this.tagGroups.flat[group.id], ...updated }; } else { payload.category = category; const newGroup = await api.createTagGroup(payload); if (!this.tagGroups.grouped[category]) this.tagGroups.grouped[category] = []; this.tagGroups.grouped[category].push(newGroup); this.tagGroups.flat[newGroup.id] = newGroup; const stageBlock = contextElement.closest('.stage-block'); const scene = this.scenes.find(s => s.id === stageBlock.dataset.sceneId), stage = scene?.stages.find(st => st.id === stageBlock.dataset.stageId); if (stage) { 
    // Yuuka: Sửa lỗi - Đối với category 'Character', thay thế ID cũ thay vì thêm mới.
    if (category === 'Character') {
        stage.tags[category] = [newGroup.id];
    } else {
        if (!stage.tags[category]) stage.tags[category] = [];
        stage.tags[category].push(newGroup.id);
    }
} } this.saveState(); this.render(); this.closeTagGroupModal(); } catch (error) { showError(`Lỗi: ${error.message}`); } };
    }
    closeTagGroupModal() {
        this.tagGroupModal.style.display = 'none';
        this.tagGroupModal.querySelector('#tag-group-modal-content').innerHTML = '';
        // Yuuka: Dọn dẹp thuộc tính persistent khi đóng modal
        delete this.tagGroupModal.dataset.persistent;
    }
    _initTagAutocomplete(formContainer) { if (!this.tagPredictions?.length) return; formContainer.querySelectorAll('textarea').forEach(input => { if (input.closest('.tag-autocomplete-container')) return; const wrapper = document.createElement('div'); wrapper.className = 'tag-autocomplete-container'; input.parentElement.insertBefore(wrapper, input); wrapper.appendChild(input); const list = document.createElement('ul'); list.className = 'tag-autocomplete-list'; wrapper.appendChild(list); let activeIndex = -1; const hideList = () => { list.style.display = 'none'; list.innerHTML = ''; activeIndex = -1; }; input.addEventListener('input', () => { const text = input.value, cursorPos = input.selectionStart; const textBefore = text.substring(0, cursorPos), lastComma = textBefore.lastIndexOf(','); const currentTag = textBefore.substring(lastComma + 1).trim(); if (currentTag.length < 1) { hideList(); return; } const searchTag = currentTag.replace(/\s+/g, '_').toLowerCase(); const matches = this.tagPredictions.filter(t => t.startsWith(searchTag)).slice(0, 7); if (matches.length > 0) { list.innerHTML = matches.map(m => `<li class="tag-autocomplete-item" data-tag="${m}">${m.replace(/_/g, ' ')}</li>`).join(''); list.style.display = 'block'; activeIndex = -1; } else { hideList(); } }); const applySuggestion = (suggestion) => { const text = input.value, cursorPos = input.selectionStart; const textBefore = text.substring(0, cursorPos), lastComma = textBefore.lastIndexOf(','); const before = text.substring(0, lastComma + 1); const after = text.substring(cursorPos), endOfTag = after.indexOf(',') === -1 ? after.length : after.indexOf(','); const finalAfter = text.substring(cursorPos + endOfTag); const newText = `${before.trim() ? `${before.trim()} ` : ''}${suggestion.replace(/_/g, ' ')}, ${finalAfter.trim()}`; input.value = newText.trim(); const newCursorPos = `${before.trim() ? `${before.trim()} ` : ''}${suggestion}`.length + 2; input.focus(); input.setSelectionRange(newCursorPos, newCursorPos); hideList(); input.dispatchEvent(new Event('input', { bubbles: true })); }; list.addEventListener('mousedown', e => { e.preventDefault(); if (e.target.matches('.tag-autocomplete-item')) applySuggestion(e.target.dataset.tag); }); input.addEventListener('keydown', e => { const items = list.querySelectorAll('.tag-autocomplete-item'); if (items.length === 0) return; if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; } else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; } else if ((e.key === 'Enter' || e.key === 'Tab') && activeIndex > -1) { e.preventDefault(); applySuggestion(items[activeIndex].dataset.tag); return; } else if (e.key === 'Escape') { hideList(); return; } items.forEach((item, i) => item.classList.toggle('active', i === activeIndex)); }); input.addEventListener('blur', () => setTimeout(hideList, 150)); }); }

    renderSceneSettingsModal(scene) {
        const modal = document.createElement('div');
        modal.id = 'scene-settings-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `<div class="modal-dialog"><h3>Cấu hình cho Scene</h3><div class="settings-form" id="scene-settings-form-container"></div><div class="modal-actions"><button id="scene-cfg-cancel-btn">Hủy</button><button id="scene-cfg-save-btn">Lưu</button></div></div>`;
        document.body.appendChild(modal);
        
        const formContainer = modal.querySelector('#scene-settings-form-container');
        const config = scene.generationConfig || {};
    
        const createNum = (k, l, v, min, max, step) => `<div class="form-group"><label for="cfg-${k}">${l}</label><input type="number" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></div>`;
        const createTxt = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><textarea id="cfg-${k}" name="${k}" rows="2">${v}</textarea></div>`;
        const createSlider = (k, l, v, min, max, step) => `<div class="form-group form-group-slider"><label for="cfg-${k}">${l}: <span id="val-${k}">${v}</span></label><input type="range" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${k}').textContent = this.value"></div>`;
        const createSelect = (k, l, opts, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><select id="cfg-${k}" name="${k}">${opts.map(o => `<option value="${o.value}" ${o.value == v ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>`;
        const createInput = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><input type="text" id="cfg-${k}" name="${k}" value="${v}"></div>`;
        const createInputWithButton = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><div class="input-with-button"><input type="text" id="cfg-${k}" name="${k}" value="${v}"><button type="button" id="scene-cfg-connect-btn">Connect</button></div></div>`;
        
        const currentSize = config.width && config.height ? `${config.width}x${config.height}` : '832x1216';
        const formHtml = `
            <form id="scene-config-form">
                ${createNum('quantity_per_stage', 'Số lượng ảnh mỗi Stage', config.quantity_per_stage || 1, 1, 10, 1)}
                ${createTxt('quality', 'Quality', config.quality || '')}
                ${createTxt('negative', 'Negative', config.negative || '')}
                ${createInput('lora_name', 'LoRA Name', config.lora_name || '')}
                ${createSlider('steps', 'Steps', config.steps || 25, 10, 50, 1)}
                ${createSlider('cfg', 'CFG', config.cfg || 4.5, 1.0, 7.0, 0.1)}
                ${createNum('seed', 'Seed (0 = random)', config.seed || 0, 0, Number.MAX_SAFE_INTEGER, 1)}
                ${createSelect('size', 'W x H', [{ name: 'Loading...', value: currentSize }], currentSize)}
                ${createSelect('sampler_name', 'Sampler', [{ name: 'Loading...', value: config.sampler_name || 'dpmpp_2m' }], config.sampler_name)}
                ${createSelect('scheduler', 'Scheduler', [{ name: 'Loading...', value: config.scheduler || 'karras' }], config.scheduler)}
                ${createSelect('ckpt_name', 'Checkpoint', [{ name: 'Loading...', value: config.ckpt_name || '' }], config.ckpt_name)}
                ${createInputWithButton('server_address', 'Server Address', config.server_address || '')}
            </form>
        `;
        formContainer.innerHTML = formHtml;
    
        const close = () => modal.remove();
        modal.addEventListener('click', e => e.target === modal && close());
        modal.querySelector('#scene-cfg-cancel-btn').addEventListener('click', close);
    
        const form = formContainer.querySelector('#scene-config-form');
        const connectBtn = modal.querySelector('#scene-cfg-connect-btn');
        const serverAddressInput = modal.querySelector('#cfg-server_address');
        const dynamicSelects = ['size', 'sampler_name', 'scheduler', 'ckpt_name'];

        const loadAndRebuildFormOptions = async (address) => {
            dynamicSelects.forEach(key => { form.elements[key].disabled = true; });
            try {
                const { global_choices } = await api.getGenerationInfo(null, address);
                const populate = (key, choices, currentValue) => {
                    const select = form.elements[key];
                    select.innerHTML = '';
                    choices.forEach(c => {
                        const option = document.createElement('option');
                        option.value = c.value;
                        option.textContent = c.name;
                        if (c.value == currentValue) option.selected = true;
                        select.appendChild(option);
                    });
                };
                populate('size', global_choices.sizes, form.elements['size'].value);
                populate('sampler_name', global_choices.samplers, form.elements['sampler_name'].value);
                populate('scheduler', global_choices.schedulers, form.elements['scheduler'].value);
                populate('ckpt_name', global_choices.checkpoints, form.elements['ckpt_name'].value);
            } catch (err) {
                showError(`Không thể tải dữ liệu từ ComfyUI: ${err.message}`);
            } finally {
                dynamicSelects.forEach(key => { form.elements[key].disabled = false; });
            }
        };

        connectBtn.addEventListener('click', async () => {
            const address = serverAddressInput.value.trim();
            if (!address) { showError("Vui lòng nhập địa chỉ server."); return; }
            const originalText = connectBtn.textContent;
            connectBtn.textContent = '...';
            connectBtn.disabled = true;
            try {
                await api.checkComfyUIStatus(address);
                showError("Kết nối thành công!");
                await loadAndRebuildFormOptions(address);
            } catch (e) {
                showError("Kết nối thất bại. Vui lòng kiểm tra lại địa chỉ và đảm bảo ComfyUI đang chạy.");
            } finally {
                connectBtn.textContent = originalText;
                connectBtn.disabled = false;
            }
        });

        // Initial load
        loadAndRebuildFormOptions(serverAddressInput.value.trim() || '127.0.0.1:8888');

        modal.querySelector('#scene-cfg-save-btn').addEventListener('click', () => {
            const updates = {};
            ['quality', 'negative', 'lora_name', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name'].forEach(k => updates[k] = form.elements[k].value);
            ['steps', 'cfg'].forEach(k => updates[k] = parseFloat(form.elements[k].value));
            ['quantity_per_stage', 'seed'].forEach(k => updates[k] = parseInt(form.elements[k].value, 10));
            const [w, h] = form.elements['size'].value.split('x').map(Number);
            updates.width = w;
            updates.height = h;
            scene.generationConfig = updates;
            this.saveState();
            showError("Lưu cấu hình Scene thành công.");
            close();
        });
    }
}
const sceneManager = new SceneManager();