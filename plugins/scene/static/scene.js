// --- MODIFIED FILE: plugins/scene/static/scene.js ---
class SceneComponent {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.floatViewer = window.Yuuka.services['float-viewer'];
        this.state = {
            scenes: [],
            tagGroups: { grouped: {}, flat: {} },
            tagPredictions: [],
            selected: { type: null, id: null, parentId: null },
            dragged: { element: null, type: null, id: null, parentId: null, category: null, width: 0, height: 0 },
            // Yuuka: touch drag v1.0 - Thêm state quản lý kéo thả cảm ứng
            touchDrag: {
                active: false,
                target: null,
                longPressTimeout: null,
                initialX: 0,
                initialY: 0,
                offsetX: 0,
                offsetY: 0,
                hasMoved: false,
            },
            placeholder: null,
            generation: { 
                isSceneRunning: false,
                sceneRunInterval: null,
                activeSceneTasks: new Map(),
            }
        };
        this.handleClick = this.handleClick.bind(this);
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        this.handleGenerationUpdate = this.handleGenerationUpdate.bind(this);
        // Yuuka: touch drag v1.0 - Bind các hàm xử lý cảm ứng
        this.handleTouchStart = this.handleTouchStart.bind(this);
        this.handleTouchMove = this.handleTouchMove.bind(this);
        this.handleTouchEnd = this.handleTouchEnd.bind(this);
    }

    async init() {
        console.log("[Plugin:Scene] Initializing...");
        this.container.classList.add('plugin-scene');
        this.container.innerHTML = `<div class="loader visible">Đang tải Scene...</div>`;

        // Yuuka: independent float viewer v1.0 - Gỡ bỏ việc tự động mở float-viewer

        try {
            const [scenes, tagGroups, tagPredictions] = await Promise.all([
                this.api.scene.get(), this.api.scene.get('/tag_groups'), this.api.getTags()
            ]);
            this.state.scenes = scenes;
            this.state.tagGroups = tagGroups;
            this.state.tagPredictions = tagPredictions;
            
            this.attachEventListeners();
            Yuuka.events.on('generation:update', this.handleGenerationUpdate);

            this.render();
            this._updateNav(); // Yuuka: Thêm để báo cho navibar biết tab đang active
            const sceneStatus = await this.api.scene.get('/status');
            if(sceneStatus.is_running) {
                this.state.generation.isSceneRunning = true;
                this.startSceneStatusPolling();
            }
        } catch (error) {
            this.container.innerHTML = `<div class="error-msg">Lỗi tải dữ liệu Scene: ${error.message}</div>`;
        }
    }

    destroy() {
        console.log("[Plugin:Scene] Destroying...");
        // Yuuka: independent float viewer v1.0 - Gỡ bỏ việc tự động đóng float-viewer
        const navibar = window.Yuuka.services.navibar;
        if (navibar) {
            navibar.setActivePlugin(null);
        }
        this.detachEventListeners();
        Yuuka.events.off('generation:update', this.handleGenerationUpdate);
        clearInterval(this.state.generation.sceneRunInterval);
        this.container.innerHTML = '';
        this.container.classList.remove('plugin-scene');
    }
    
    attachEventListeners() { this.container.addEventListener('click', this.handleClick); this.container.addEventListener('dragstart', this.handleDragStart); this.container.addEventListener('dragover', this.handleDragOver); this.container.addEventListener('drop', this.handleDrop); this.container.addEventListener('dragend', this.handleDragEnd); this.container.addEventListener('touchstart', this.handleTouchStart, { passive: false }); } // Yuuka: reload lag fix v1.0 - Cần passive: false để có thể preventDefault trong touchmove
    detachEventListeners() { this.container.removeEventListener('click', this.handleClick); this.container.removeEventListener('dragstart', this.handleDragStart); this.container.removeEventListener('dragover', this.handleDragOver); this.container.removeEventListener('drop', this.handleDrop); this.container.removeEventListener('dragend', this.handleDragEnd); this.container.removeEventListener('touchstart', this.handleTouchStart); window.removeEventListener('touchmove', this.handleTouchMove); window.removeEventListener('touchend', this.handleTouchEnd); window.removeEventListener('touchcancel', this.handleTouchEnd); } // Yuuka: touch drag v1.0
    
    async saveScenes() { try { await this.api.scene.post('', this.state.scenes); } catch (e) { showError("Lỗi lưu scene."); } }

    render() {
        this.container.innerHTML = '';
        this.state.scenes.forEach((scene, index) => this.container.appendChild(this.createSceneRow(scene, index)));
        this.container.appendChild(this._createUIElement('div', { className: 'add-scene-btn', textContent: '+' }));
        this._updateGeneratingFX();
    }
    
    // Yuuka: Hàm mới để cập nhật navibar
    _updateNav() {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;
        navibar.setActivePlugin('scene');
    }

    _createHeader(item, type, index) {
        const header = this._createUIElement('div', { className: `${type}-header` });

        // Yuuka: Stage name v1.0 - Stage giờ có tên cố định, không thể chỉnh sửa.
        let nameContent;
        if (type === 'stage') {
            nameContent = String(index + 1).padStart(2, '0');
        } else {
            nameContent = item.name || `Scene ${index + 1}`;
        }
        const name = this._createUIElement('div', { 
            className: 'header-name', 
            textContent: nameContent,
        });

        const buttons = this._createUIElement('div', { className: 'header-buttons' });
        const isRunning = this.state.generation.isSceneRunning;
        
        // Yuuka: generate button consistency v1.0
        buttons.innerHTML = `
            <button class="header-btn" data-action="generate" title="${isRunning ? 'Cancel & chạy lại từ đây' : 'Chạy từ đây'}"><span class="material-symbols-outlined">play_arrow</span></button>
            <button class="header-btn" data-action="toggle-collapse" title="${item.isCollapsed ? 'Mở rộng' : 'Thu gọn'}"><span class="material-symbols-outlined">${item.isCollapsed ? 'unfold_more' : 'unfold_less'}</span></button>
            <button class="header-btn" data-action="toggle-bypass" title="${item.bypassed ? 'Kích hoạt' : 'Bỏ qua'}"><span class="material-symbols-outlined">${item.bypassed ? 'visibility' : 'visibility_off'}</span></button>
            ${type === 'scene' ? `<button class="header-btn" data-action="settings" title="Cấu hình"><span class="material-symbols-outlined">tune</span></button>` : ''}
            <button class="header-btn btn-danger" data-action="delete" title="Xóa"><span class="material-symbols-outlined">delete</span></button>
        `;

        header.appendChild(name);
        header.appendChild(buttons);
        return header;
    }
    
    createSceneRow(scene, index) {
        const r=this._createUIElement('div',{className:'scene-row',dataset:{sceneId:scene.id},draggable:true}); 
        if(this.state.selected.type==='scene'&&this.state.selected.id===scene.id)r.classList.add('selected'); 
        if(scene.bypassed)r.classList.add('bypassed'); 
        if(scene.isCollapsed) r.classList.add('is-collapsed');
        
        r.appendChild(this._createHeader(scene, 'scene', index));

        const w=this._createUIElement('div',{className:'stages-wrapper'}); 
        scene.stages.forEach((s, stageIndex) => w.appendChild(this.createStageBlock(s, scene.id, stageIndex)));
        w.appendChild(this._createUIElement('div',{className:'add-stage-btn',textContent:'+'})); 
        r.appendChild(w); 
        return r; 
    }

    createStageBlock(stage, sceneId, index) {
        const b=this._createUIElement('div',{className:'stage-block',dataset:{stageId:stage.id,sceneId:sceneId},draggable:true}); 
        if(this.state.selected.type==='stage'&&this.state.selected.id===stage.id)b.classList.add('selected'); 
        if(stage.bypassed)b.classList.add('bypassed'); 
        if(stage.isCollapsed) b.classList.add('is-collapsed');

        b.appendChild(this._createHeader(stage, 'stage', index));

        const c=this._createUIElement('div',{className:'stage-categories-wrapper'}); 
        ['Character','Pose','Outfits','View','Context'].forEach(cat=>{
            const d=this._createUIElement('div',{className:'stage-category'});
            d.innerHTML=`<label class="stage-category-label">${cat.toUpperCase()}</label>`;
            const t=this._createUIElement('div',{className:'stage-category-tags',dataset:{category:cat}});
            (stage.tags[cat]||[]).forEach(gId=>{const g=this.state.tagGroups.flat[gId];if(g)t.appendChild(this._createUIElement('div',{className:'tag-group-block',textContent:g.name,draggable:true,dataset:{groupId:g.id,category:cat}}));});
            t.appendChild(this._createUIElement('button',{className:'add-tag-group-btn',textContent:'+'}));
            d.appendChild(t);c.appendChild(d);
        });
        b.appendChild(c);return b; 
    }

    _createUIElement(tag, {className, textContent, dataset, draggable}={}) { const el=document.createElement(tag); if(className)el.className=className; if(textContent)el.textContent=textContent; if(draggable)el.draggable=draggable; if(dataset)Object.entries(dataset).forEach(([k,v])=>el.dataset[k]=v); return el; }
    
    handleClick(e) { 
        // Yuuka: touch click fix v1.0 - Bỏ qua click nếu một thao tác kéo vừa kết thúc
        if (this.state.touchDrag.active) return;

        // Yuuka: stage stop button v1.0
        const stageCancelBtn = e.target.closest('.stage-cancel-btn');
        if (stageCancelBtn) {
            e.stopPropagation();
            this.cancelGeneration();
            return;
        }

        const addScene=e.target.closest('.add-scene-btn');
        const addStage=e.target.closest('.add-stage-btn');
        const addTag=e.target.closest('.add-tag-group-btn');
        const editTag=e.target.closest('.tag-group-block');
        const sel=e.target.closest('.scene-row, .stage-block');
        const headerBtn = e.target.closest('.header-btn');
        const nameEl = e.target.closest('.header-name');

        if (headerBtn) {
            e.stopPropagation();
            const action = headerBtn.dataset.action;
            const itemEl = headerBtn.closest('.scene-row, .stage-block');
            const isScene = itemEl.classList.contains('scene-row');
            const id = isScene ? itemEl.dataset.sceneId : itemEl.dataset.stageId;
            const parentId = isScene ? null : itemEl.dataset.sceneId;

            switch (action) {
                case 'generate': // Yuuka: generate button consistency v1.0
                    this.handleGenerateClick(isScene ? 'scene' : 'stage', id, parentId);
                    break;
                case 'toggle-collapse':
                    this.toggleCollapse(isScene ? 'scene' : 'stage', id, parentId);
                    break;
                case 'toggle-bypass':
                    this.toggleBypass(isScene ? 'scene' : 'stage', id, parentId);
                    break;
                case 'settings':
                    if (isScene) this.openSettings(id);
                    break;
                case 'delete':
                    this.deleteSelected(isScene ? 'scene' : 'stage', id, parentId);
                    break;
            }
            return;
        }

        // Yuuka: Stage name v1.0 - Chặn việc chỉnh sửa tên của Stage.
        if (nameEl && !nameEl.querySelector('input')) {
            if (nameEl.closest('.stage-block')) return; // Không làm gì nếu là tên của Stage
            this.handleNameEdit(nameEl);
            return;
        }

        if(addScene)this.addScene(); 
        else if(addStage)this.addStage(addStage.parentElement.closest('.scene-row').dataset.sceneId); 
        else if(addTag)this.openTagSelector(addTag.parentElement.dataset.category,addTag.closest('.stage-block').dataset.sceneId,addTag.closest('.stage-block').dataset.stageId); 
        else if(editTag)this.openTagEditor(editTag.dataset.groupId,editTag.dataset.category,editTag); 
        else if(sel)this.select(sel); 
        else this.select(null); 
    }

    handleNameEdit(nameEl) {
        const originalText = nameEl.textContent;
        const itemEl = nameEl.closest('.scene-row, .stage-block');
        const isScene = itemEl.classList.contains('scene-row');
        const id = isScene ? itemEl.dataset.sceneId : itemEl.dataset.stageId;
        
        const input = this._createUIElement('input', { className: 'header-name-edit' });
        input.type = 'text';
        input.value = originalText;
        nameEl.innerHTML = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();

        const save = () => {
            const newName = input.value.trim();
            const item = isScene 
                ? this.state.scenes.find(s => s.id === id)
                : this.state.scenes.find(s => s.stages.some(st => st.id === id))?.stages.find(st => st.id === id);
            
            if (item) {
                item.name = newName || originalText; // Revert if empty
                this.saveScenes();
            }
            nameEl.textContent = item.name;
            input.removeEventListener('blur', save);
            input.removeEventListener('keydown', keydownHandler);
        };

        const keydownHandler = (ev) => {
            if (ev.key === 'Enter') input.blur();
            if (ev.key === 'Escape') {
                input.removeEventListener('blur', save);
                nameEl.textContent = originalText;
            }
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', keydownHandler);
    }

    select(el) { if(!el){this.state.selected={type:null,id:null,parentId:null};}else if(el.classList.contains('stage-block')){this.state.selected={type:'stage',id:el.dataset.stageId,parentId:el.dataset.sceneId};}else if(el.classList.contains('scene-row')){this.state.selected={type:'scene',id:el.dataset.sceneId,parentId:null};} this.render(); }
    
    addScene() { const lastScene = this.state.scenes.at(-1); const newScene = { id: `s_${Date.now()}`, stages: [], bypassed: false, isCollapsed: false, generationConfig: lastScene ? JSON.parse(JSON.stringify(lastScene.generationConfig || {})) : {} }; this.state.scenes.push(newScene); this.saveScenes(); this.render(); }
    addStage(sceneId) { const scene = this.state.scenes.find(sc => sc.id === sceneId); if (!scene) return; const lastStage = scene.stages.at(-1); const newStage = { id: `st_${Date.now()}`, tags: lastStage ? JSON.parse(JSON.stringify(lastStage.tags || {})) : {}, bypassed: false, isCollapsed: false }; if (lastStage?.tagWeights) newStage.tagWeights = JSON.parse(JSON.stringify(lastStage.tagWeights)); scene.stages.push(newStage); this.saveScenes(); this.render(); }
    
    // Yuuka: generate button consistency v1.0
    async handleGenerateClick(type, id, parentId) {
        if (this.state.generation.isSceneRunning) {
            await this.cancelGeneration();
            showError("Đang hủy tiến trình cũ, vui lòng chờ giây lát...");
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        this.startGeneration(type, id, parentId);
    }

    async startGeneration(type, id, parentId) { // Yuuka: generate logic fix v1.0
        if (!type || !id) return;

        const startSceneIndex = this.state.scenes.findIndex(s => s.id === (type === 'scene' ? id : parentId));
        if (startSceneIndex === -1) return;

        // Create a deep copy of all scenes from the starting one onwards.
        const scenesForJob = JSON.parse(JSON.stringify(this.state.scenes.slice(startSceneIndex)));

        // If starting from a specific stage, we need to modify the first scene in our job list.
        if (type === 'stage') {
            const startStageIndex = scenesForJob[0].stages.findIndex(st => st.id === id);
            if (startStageIndex > -1) {
                // Keep only the stages from the starting one onwards FOR THAT SCENE.
                scenesForJob[0].stages = scenesForJob[0].stages.slice(startStageIndex);
            } else {
                // This case shouldn't happen if the UI is correct, but as a safeguard:
                console.error("Could not find start stage in the job scene. Aborting.");
                return;
            }
        }
        
        const job = { scenes: scenesForJob };

        try {
            await this.api.scene.post('/generate', job);
            Yuuka.events.emit('generation:task_created_locally');
            this.state.generation.isSceneRunning = true;
            this.startSceneStatusPolling();
            this.render(); // Re-render to show running state
        } catch (e) {
            showError(`Lỗi bắt đầu Scene: ${e.message}`);
        }
    }

    async cancelGeneration() { try { await this.api.scene.post('/cancel'); showError("Đã yêu cầu hủy Scene."); } catch (e) { showError("Lỗi hủy Scene."); } }
    
    startSceneStatusPolling() {
        if (this.state.generation.sceneRunInterval) clearInterval(this.state.generation.sceneRunInterval);
        this.state.generation.sceneRunInterval = setInterval(async () => {
            if (typeof startGlobalPolling === 'function') {
                startGlobalPolling();
            }
    
            try {
                const s = await this.api.scene.get('/status');
                if (!s.is_running) {
                    clearInterval(this.state.generation.sceneRunInterval);
                    this.state.generation.isSceneRunning = false;
                    this.render();
                }
            } catch (e) {
                clearInterval(this.state.generation.sceneRunInterval);
            }
        }, 2000);
    }

    handleGenerationUpdate(allTasksStatus) {
        this.state.generation.activeSceneTasks.clear();
        let hasSceneTask = false;
        for (const taskId in allTasksStatus) {
            const task = allTasksStatus[taskId];
            if (task.context?.source === 'scene') {
                this.state.generation.activeSceneTasks.set(taskId, task);
                hasSceneTask = true;
            }
        }
        if (!hasSceneTask && this.state.generation.isSceneRunning) {
             setTimeout(async () => {
                 const sceneStatus = await this.api.scene.get('/status').catch(() => ({is_running: true}));
                 if (!sceneStatus.is_running) {
                    this.state.generation.isSceneRunning = false;
                    clearInterval(this.state.generation.sceneRunInterval);
                    this.render();
                 }
             }, 2500);
        }
        this._updateGeneratingFX();
    }

    _updateGeneratingFX() {
        const runningTasksByStageId = new Map();
        this.state.generation.activeSceneTasks.forEach(task => {
            const stageId = task.context?.stage_id;
            if (stageId) {
                runningTasksByStageId.set(stageId, task);
            }
        });

        this.container.querySelectorAll('.stage-block').forEach(stageEl => {
            const stageId = stageEl.dataset.stageId;
            const task = runningTasksByStageId.get(stageId);

            if (task) {
                stageEl.classList.add('is-generating');
                stageEl.querySelector('.stage-categories-wrapper')?.classList.add('is-dimmed');
                let bar = stageEl.querySelector('.scene-generation-progress-bar');
                if (!bar) {
                    bar = this._createUIElement('div', { className: 'scene-generation-progress-bar' });
                    // Yuuka: stage stop button v1.0
                    bar.innerHTML = `
                        <div class="plugin-scene__progress-text"></div>
                        <div class="plugin-scene__progress-bar-container"><div class="plugin-scene__progress-bar"></div></div>
                        <button class="stage-cancel-btn"><span class="material-symbols-outlined">stop</span> Cancel</button>
                    `;
                    stageEl.appendChild(bar);
                }
                const textEl = bar.querySelector('.plugin-scene__progress-text');
                const barEl = bar.querySelector('.plugin-scene__progress-bar');
                if (textEl) textEl.textContent = task.progress_message;
                if (barEl) barEl.style.width = `${task.progress_percent || 0}%`;
            } else {
                stageEl.classList.remove('is-generating');
                stageEl.querySelector('.stage-categories-wrapper')?.classList.remove('is-dimmed');
                stageEl.querySelector('.scene-generation-progress-bar')?.remove();
            }
        });
    }

    async openSettings(sceneId) {
        const scene = this.state.scenes.find(s => s.id === sceneId);
        if (!scene) return;
        this._openSceneSettingsModal(scene);
    }

    toggleCollapse(type, id, parentId) {
        if(!type || !id) return;
        let item;
        if(type ==='scene'){
            item = this.state.scenes.find(sc => sc.id === id);
        } else if(type === 'stage'){
            const scene = this.state.scenes.find(sc => sc.id === parentId);
            item = scene?.stages.find(stg => stg.id === id);
        }
        if(item) item.isCollapsed = !item.isCollapsed;
        this.saveScenes();
        this.render();
    }

    toggleBypass(type, id, parentId) {
        if(!type || !id)return;
        let item;
        if(type === 'scene'){
            item = this.state.scenes.find(sc=>sc.id===id);
        }else if(type === 'stage'){
            const scene = this.state.scenes.find(sc => sc.id === parentId);
            item = scene?.stages.find(stg => stg.id === id);
        }
        if(item) item.bypassed = !item.bypassed;
        this.saveScenes();
        this.render();
    }
    
    async deleteSelected(type, id, parentId) {
        if (!type || !id) return;
        let confirmNeeded = true; let message = 'Bạn có chắc muốn xoá?'; const isStageEmpty = (stage) => !Object.values(stage.tags).some(arr => arr.length > 0);
        if (type === 'scene') {
            const scene = this.state.scenes.find(sc => sc.id === id);
            if (scene) { if (scene.stages.length === 0 || scene.stages.every(isStageEmpty)) { confirmNeeded = false; } else { message = 'Bạn có chắc muốn xoá toàn bộ Scene này?'; } }
        } else if (type === 'stage') {
            const scene = this.state.scenes.find(sc => sc.id === parentId);
            const stage = scene?.stages.find(stg => stg.id === id);
            if (stage && isStageEmpty(stage)) { confirmNeeded = false; } else { message = 'Bạn có chắc muốn xoá Stage này?'; }
        }
        const confirmed = confirmNeeded ? await Yuuka.ui.confirm(message) : true;
        if (!confirmed) return;
        if (type === 'scene') {
            this.state.scenes = this.state.scenes.filter(s => s.id !== id);
        } else if (type === 'stage') {
            const scene = this.state.scenes.find(sc => sc.id === parentId);
            if (scene) scene.stages = scene.stages.filter(st => st.id !== id);
        }
        if (this.state.selected.id === id) this.select(null);
        this.saveScenes();
        this.render();
    }
    
    handleDragStart(e) {
        const target = e.target.closest('.scene-row, .stage-block, .tag-group-block');
        if (!target) {
            e.preventDefault();
            return;
        }
        
        // Yuuka: Drag fix v1.0 - Thêm class vào container chính và các nút add
        this.container.classList.add('plugin-scene--is-dragging');
        this.container.querySelectorAll('.add-scene-btn, .add-stage-btn').forEach(btn => btn.classList.add('is-hidden-during-drag'));

        this.state.dragged.element = target;
        const rect = target.getBoundingClientRect();
        this.state.dragged.width = rect.width;
        this.state.dragged.height = rect.height;

        // Yuuka: Drag placeholder fix v1.0 - Tạo và cấu hình placeholder một lần duy nhất
        this.state.placeholder = document.createElement('div');
        this.state.placeholder.style.width = `${rect.width}px`;
        this.state.placeholder.style.height = `${rect.height}px`;

        if (target.classList.contains('scene-row')) {
            this.state.dragged.type = 'scene';
            this.state.dragged.id = target.dataset.sceneId;
            this.state.placeholder.className = 'drag-placeholder';
        } else if (target.classList.contains('stage-block')) {
            this.state.dragged.type = 'stage';
            this.state.dragged.id = target.dataset.stageId;
            this.state.dragged.parentId = target.dataset.sceneId;
            this.state.placeholder.className = 'drag-placeholder stage-placeholder';
        } else if (target.classList.contains('tag-group-block')) {
            this.state.dragged.type = 'tag_group';
            this.state.dragged.id = target.dataset.groupId;
            this.state.dragged.parentId = target.closest('.stage-block').dataset.stageId;
            this.state.dragged.category = target.dataset.category;
            this.state.placeholder.className = 'drag-placeholder tag-group-placeholder';
        }
        setTimeout(() => target.classList.add('dragging'), 0);
    }

    handleDragEnd() {
        // Yuuka: Drag fix v1.0 - Dọn dẹp tất cả các class và trạng thái
        this.container.classList.remove('plugin-scene--is-dragging');
        this.container.querySelectorAll('.add-scene-btn, .add-stage-btn').forEach(btn => btn.classList.remove('is-hidden-during-drag'));
        
        this.state.dragged.element?.classList.remove('dragging');
        this.state.placeholder?.remove();
        this.state.placeholder = null;
        this.state.dragged = { element: null, type: null, id: null, parentId: null, category: null, width: 0, height: 0 };
    }

    handleDragOver(e) {
        e.preventDefault();
        if (!this.state.dragged.element || !this.state.placeholder) return;

        // Tạm ẩn placeholder để xác định phần tử bên dưới con trỏ
        this.state.placeholder.style.display = 'none';
        const elUnder = document.elementFromPoint(e.clientX, e.clientY);
        this.state.placeholder.style.display = ''; // Hiện lại ngay
        if (!elUnder) return;

        let dropTarget = null;
        let container = null;
        const { type: draggedType, category: draggedCategory } = this.state.dragged;

        if (draggedType === 'scene') {
            dropTarget = elUnder.closest('.scene-row, .add-scene-btn');
            container = this.container;
        } else if (draggedType === 'stage') {
            dropTarget = elUnder.closest('.stage-block, .add-stage-btn');
            container = elUnder.closest('.stages-wrapper');
        } else if (draggedType === 'tag_group') {
            container = elUnder.closest('.stage-category-tags');
            // Chỉ cho phép thả vào đúng category
            if (container?.dataset.category === draggedCategory) {
                dropTarget = elUnder.closest('.tag-group-block, .add-tag-group-btn');
            } else {
                container = null; // Vô hiệu hóa việc thả
            }
        }

        if (container) {
            if (dropTarget && dropTarget !== this.state.placeholder) {
                const rect = dropTarget.getBoundingClientRect();
                const isHorizontal = draggedType !== 'scene';
                const offset = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;
                const threshold = (isHorizontal ? rect.width : rect.height) / 2;
                if (offset < threshold) {
                    container.insertBefore(this.state.placeholder, dropTarget);
                } else {
                    container.insertBefore(this.state.placeholder, dropTarget.nextElementSibling);
                }
            } else if (!dropTarget && draggedType !== 'scene' && container.contains(elUnder)) {
                // Cho phép thả vào cuối container (ví dụ: khu vực trống của stages-wrapper)
                container.appendChild(this.state.placeholder);
            }
        } else if (this.state.placeholder.parentElement) {
            // Nếu con trỏ ra ngoài khu vực hợp lệ, gỡ placeholder
            this.state.placeholder.remove();
        }
    }
    
    // Yuuka: touch drag v1.0 - Tách logic drop để tái sử dụng
    _finalizeDrop(placeholder) {
        if (!placeholder?.parentElement) return;
        const parent = placeholder.parentElement;
        const targetIndex = Array.from(parent.children).indexOf(placeholder);

        const { type, id, parentId, category } = this.state.dragged;

        if (type === 'scene') {
            const idx = this.state.scenes.findIndex(s => s.id === id);
            if (idx > -1) {
                const [item] = this.state.scenes.splice(idx, 1);
                this.state.scenes.splice(targetIndex, 0, item);
            }
        } else if (type === 'stage') {
            const fromScene = this.state.scenes.find(s => s.id === parentId);
            const toSceneId = parent.closest('.scene-row').dataset.sceneId;
            const toScene = this.state.scenes.find(s => s.id === toSceneId);
            if (fromScene && toScene) {
                const idx = fromScene.stages.findIndex(st => st.id === id);
                if (idx > -1) {
                    const [item] = fromScene.stages.splice(idx, 1);
                    toScene.stages.splice(targetIndex, 0, item);
                }
            }
        } else if (type === 'tag_group') {
            const toStageBlock = parent.closest('.stage-block');
            const fromScene = this.state.scenes.find(s => s.stages.some(st => st.id === parentId));
            const fromStage = fromScene?.stages.find(st => st.id === parentId);
            const toScene = this.state.scenes.find(s => s.id === toStageBlock.dataset.sceneId);
            const toStage = toScene?.stages.find(st => st.id === toStageBlock.dataset.stageId);
            if (fromStage && toStage) {
                const fromTags = fromStage.tags[category] || [];
                const idx = fromTags.indexOf(id);
                if (idx > -1) {
                    const [movedId] = fromTags.splice(idx, 1);
                    if (!toStage.tags[category]) toStage.tags[category] = [];
                    toStage.tags[category].splice(targetIndex, 0, movedId);
                    if (fromStage !== toStage) {
                        const weightToTransfer = this._getStageTagWeight(fromStage, movedId);
                        if (weightToTransfer !== 1) {
                            this._setStageTagWeight(toStage, movedId, weightToTransfer);
                        }
                        this._setStageTagWeight(fromStage, movedId, 1);
                    }
                    this._sweepUnusedStageTagWeights(fromStage);
                }
            }
        }
        this.saveScenes();
        this.render();
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this._finalizeDrop(this.state.placeholder);
    }
    
    // Yuuka: reload lag fix v1.0 - Logic xử lý chạm mới
    handleTouchStart(e) {
        const target = e.target.closest('.scene-header, .stage-header, .tag-group-block');
        if (!target) return;

        const { touchDrag } = this.state;
        touchDrag.target = target;
        touchDrag.hasMoved = false;
        const touch = e.touches[0];
        touchDrag.initialX = touch.clientX;
        touchDrag.initialY = touch.clientY;

        touchDrag.longPressTimeout = setTimeout(() => {
            if (touchDrag.target && !touchDrag.hasMoved) {
                this._startTouchDrag(e);
            }
        }, 500);

        window.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        window.addEventListener('touchend', this.handleTouchEnd);
        window.addEventListener('touchcancel', this.handleTouchEnd);
    }
    
    _startTouchDrag(e) {
        const { touchDrag } = this.state;
        if (!touchDrag.target) return;

        touchDrag.active = true;
        this.container.classList.add('plugin-scene--is-dragging');
        this.container.querySelectorAll('.add-scene-btn, .add-stage-btn').forEach(btn => btn.classList.add('is-hidden-during-drag'));

        const target = touchDrag.target.closest('.scene-row, .stage-block, .tag-group-block');
        this.state.dragged.element = target;
        const rect = target.getBoundingClientRect();
        const touch = e.touches[0];
        
        touchDrag.offsetX = touch.clientX - rect.left;
        touchDrag.offsetY = touch.clientY - rect.top;

        target.classList.add('touch-dragging');
        target.style.width = `${rect.width}px`;
        target.style.left = `${touch.clientX - touchDrag.offsetX}px`;
        target.style.top = `${touch.clientY - touchDrag.offsetY}px`;
        
        this.state.placeholder = document.createElement('div');
        this.state.placeholder.style.width = `${rect.width}px`;
        this.state.placeholder.style.height = `${rect.height}px`;

        if (target.classList.contains('scene-row')) {
            this.state.dragged.type = 'scene';
            this.state.dragged.id = target.dataset.sceneId;
            this.state.placeholder.className = 'drag-placeholder';
        } else if (target.classList.contains('stage-block')) {
            this.state.dragged.type = 'stage';
            this.state.dragged.id = target.dataset.stageId;
            this.state.dragged.parentId = target.dataset.sceneId;
            this.state.placeholder.className = 'drag-placeholder stage-placeholder';
        } else if (target.classList.contains('tag-group-block')) {
            this.state.dragged.type = 'tag_group';
            this.state.dragged.id = target.dataset.groupId;
            this.state.dragged.parentId = target.closest('.stage-block').dataset.stageId;
            this.state.dragged.category = target.dataset.category;
            this.state.placeholder.className = 'drag-placeholder tag-group-placeholder';
        }
        
        target.parentElement.insertBefore(this.state.placeholder, target);
    }

    handleTouchMove(e) {
        const { touchDrag } = this.state;
        if (!touchDrag.target) return;
        
        const touch = e.touches[0];
        const dx = touch.clientX - touchDrag.initialX;
        const dy = touch.clientY - touchDrag.initialY;

        if (!touchDrag.hasMoved && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
            touchDrag.hasMoved = true;
            clearTimeout(touchDrag.longPressTimeout); 
        }

        if (!touchDrag.active) return;
        
        // Chỉ preventDefault nếu đang kéo-thả thực sự
        e.preventDefault();

        const draggedEl = this.state.dragged.element;
        draggedEl.style.left = `${touch.clientX - touchDrag.offsetX}px`;
        draggedEl.style.top = `${touch.clientY - touchDrag.offsetY}px`;

        draggedEl.style.display = 'none';
        const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
        draggedEl.style.display = '';
        if (!elUnder) return;

        let dropTarget = null;
        let container = null;
        const { type: draggedType, category: draggedCategory } = this.state.dragged;

        if (draggedType === 'scene') {
            dropTarget = elUnder.closest('.scene-row, .add-scene-btn, .drag-placeholder');
            container = this.container;
        } else if (draggedType === 'stage') {
            dropTarget = elUnder.closest('.stage-block, .add-stage-btn, .drag-placeholder');
            container = elUnder.closest('.stages-wrapper');
        } else if (draggedType === 'tag_group') {
            container = elUnder.closest('.stage-category-tags');
            if (container?.dataset.category === draggedCategory) {
                dropTarget = elUnder.closest('.tag-group-block, .add-tag-group-btn, .drag-placeholder');
            } else {
                container = null;
            }
        }

        if (container && dropTarget && dropTarget !== this.state.placeholder) {
            const rect = dropTarget.getBoundingClientRect();
            const isHorizontal = window.innerWidth > 768 && draggedType !== 'scene';
            const offset = isHorizontal ? touch.clientX - rect.left : touch.clientY - rect.top;
            const threshold = (isHorizontal ? rect.width : rect.height) / 2;
            if (offset < threshold) {
                container.insertBefore(this.state.placeholder, dropTarget);
            } else {
                container.insertBefore(this.state.placeholder, dropTarget.nextElementSibling);
            }
        }
    }
    
    handleTouchEnd(e) {
        const { touchDrag } = this.state;
        clearTimeout(touchDrag.longPressTimeout);

        if (touchDrag.active) {
            this._finalizeDrop(this.state.placeholder);
        }

        this.container.classList.remove('plugin-scene--is-dragging');
        this.container.querySelectorAll('.add-scene-btn, .add-stage-btn').forEach(btn => btn.classList.remove('is-hidden-during-drag'));
        
        this.state.dragged.element?.classList.remove('touch-dragging');
        if (this.state.dragged.element) {
            this.state.dragged.element.style.width = '';
            this.state.dragged.element.style.left = '';
            this.state.dragged.element.style.top = '';
        }

        this.state.placeholder?.remove();
        this.state.placeholder = null;
        this.state.dragged = { element: null, type: null, id: null, parentId: null, category: null, width: 0, height: 0 };
        // Reset state hoàn toàn
        this.state.touchDrag = { active: false, target: null, longPressTimeout: null, initialX: 0, initialY: 0, offsetX: 0, offsetY: 0, hasMoved: false };

        window.removeEventListener('touchmove', this.handleTouchMove);
        window.removeEventListener('touchend', this.handleTouchEnd);
        window.removeEventListener('touchcancel', this.handleTouchEnd);
    }
    
    _createModal(contentHtml, isPersistent = false) { const modal = this._createUIElement('div', { className: 'modal-backdrop plugin-scene__modal' }); modal.innerHTML = `<div class="modal-dialog">${contentHtml}</div>`; const close = () => modal.remove(); if (!isPersistent) modal.addEventListener('click', (e) => e.target === modal && close()); document.body.appendChild(modal); return { modal, dialog: modal.querySelector('.modal-dialog'), close }; }
    async _openSceneSettingsModal(scene) {
        const defaults = {
            quantity_per_stage: 1,
            quality: '',
            negative: '',
            lora_name: 'None',
            steps: 25,
            cfg: 3.0,
            seed: 0,
            sampler_name: 'euler_ancestral',
            scheduler: 'karras',
            ckpt_name: 'waiNSFWIllustrious_v150.safetensors',
            server_address: '127.0.0.1:8888',
            width: 832,
            height: 1216
        };
        const config = { ...defaults, ...(scene.generationConfig || {}) };
        if (!config.ckpt_name) config.ckpt_name = defaults.ckpt_name;
        if (!config.server_address) config.server_address = defaults.server_address;
        if (!config.lora_name) config.lora_name = defaults.lora_name;
        const currentSize = `${config.width}x${config.height}`;
        const currentLora = config.lora_name || 'None';

        const cNum = (k, l, v, min, max, step) => `<div class="form-group"><label>${l}</label><input type="number" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></div>`;
        const cTxt = (k, l, v) => `<div class="form-group"><label>${l}</label><textarea name="${k}" rows="2">${v}</textarea></div>`;
        const cSli = (k, l, v, min, max, step) => `<div class="form-group form-group-slider"><label>${l}: <span id="val-${k}">${v}</span></label><input type="range" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}" oninput="this.previousElementSibling.textContent = this.value"></div>`;
        const cSel = (k, l, opts, v) => `<div class="form-group"><label>${l}</label><select name="${k}">${opts.map(o => `<option value="${o.value}" ${o.value == v ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>`;
        const cInpBtn = (k, l, v) => `<div class="form-group"><label>${l}</label><div class="input-with-button"><input type="text" name="${k}" value="${v}"><button type="button" class="connect-btn">Connect</button></div></div>`;

        const modalHtml = `<h3>Configure Scene</h3><div class="settings-form-container"><form id="scene-cfg-form">${cNum('quantity_per_stage', 'Images per Stage', config.quantity_per_stage, 1, 10, 1)}${cTxt('quality', 'Quality', config.quality)}${cTxt('negative', 'Negative', config.negative)}${cSel('lora_name', 'LoRA Name', [{ name: 'Loading...', value: currentLora }], currentLora)}${cSli('steps', 'Steps', config.steps, 10, 50, 1)}${cSli('cfg', 'CFG', config.cfg, 1.0, 7.0, 0.1)}${cNum('seed', 'Seed (0 = random)', config.seed, 0, Number.MAX_SAFE_INTEGER, 1)}${cSel('size', 'W x H', [{ name: 'Loading...', value: currentSize }], currentSize)}${cSel('sampler_name', 'Sampler', [{ name: 'Loading...', value: config.sampler_name }], config.sampler_name)}${cSel('scheduler', 'Scheduler', [{ name: 'Loading...', value: config.scheduler }], config.scheduler)}${cSel('ckpt_name', 'Checkpoint', [{ name: 'Loading...', value: config.ckpt_name }], config.ckpt_name)}${cInpBtn('server_address', 'Server Address', config.server_address)}</form></div><div class="modal-actions"><button id="btn-cancel" class="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button><button id="btn-save" class="btn-save" title="Save"><span class="material-symbols-outlined">save</span></button></div>`;

        const { dialog, close } = this._createModal(modalHtml, true);
        const form = dialog.querySelector('form');
        dialog.querySelectorAll('textarea').forEach(textarea => {
            const autoGrow = () => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
            };
            textarea.addEventListener('input', autoGrow);
            setTimeout(autoGrow, 0);
        });
        const connectBtn = dialog.querySelector('.connect-btn');
        const serverAddressInput = form.elements['server_address'];

        const loadAndPopulateOptions = async (address) => {
            try {
                const { global_choices } = await this.api.scene.get(`/comfyui/info?server_address=${encodeURIComponent(address)}`);
                const populate = (key, choices, currentValue) => {
                    const select = form.elements[key];
                    select.innerHTML = choices.map(c => `<option value="${c.value}" ${c.value == currentValue ? 'selected' : ''}>${c.name}</option>`).join('');
                };
                populate('lora_name', global_choices.loras || [{ name: 'None', value: 'None' }], form.elements['lora_name'].value);
                populate('size', global_choices.sizes, form.elements['size'].value);
                populate('sampler_name', global_choices.samplers, form.elements['sampler_name'].value);
                populate('scheduler', global_choices.schedulers, form.elements['scheduler'].value);
                populate('ckpt_name', global_choices.checkpoints, form.elements['ckpt_name'].value);
            } catch (err) {
                showError(`Cannot load data from ComfyUI: ${err.message}`);
            }
        };

        connectBtn.addEventListener('click', async () => {
            const address = serverAddressInput.value.trim();
            if (!address) {
                showError('Please enter a server address.');
                return;
            }
            connectBtn.textContent = '...';
            connectBtn.disabled = true;
            try {
                await this.api.server.checkComfyUIStatus(address);
                showError('Connection successful!');
                await loadAndPopulateOptions(address);
            } catch (e) {
                showError('Connection failed.');
            } finally {
                connectBtn.textContent = 'Connect';
                connectBtn.disabled = false;
            }
        });

        dialog.querySelector('#btn-cancel').onclick = close;
        dialog.querySelector('#btn-save').onclick = () => {
            const updates = {};
            ['quality', 'negative', 'lora_name', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name'].forEach(k => updates[k] = form.elements[k].value);
            ['steps', 'cfg'].forEach(k => updates[k] = parseFloat(form.elements[k].value));
            ['quantity_per_stage', 'seed'].forEach(k => updates[k] = parseInt(form.elements[k].value, 10));
            const [w, h] = form.elements['size'].value.split('x').map(Number);
            updates.width = w;
            updates.height = h;
            scene.generationConfig = updates;
            this.saveScenes();
            showError('Scene settings saved.');
            close();
        };

        loadAndPopulateOptions(serverAddressInput.value.trim());
    }



    openTagSelector(category, sceneId, stageId) {
        const scene = this.state.scenes.find(s => s.id === sceneId);
        const stage = scene?.stages.find(st => st.id === stageId);
        if (!stage) return;

        const assignedIds = new Set(stage.tags[category] || []);
        const buttonsHTML = (this.state.tagGroups.grouped[category] || [])
            .map(g => `<button class="tag-group-select-btn ${assignedIds.has(g.id) ? 'selected' : ''}" data-group-id="${g.id}">${g.name}</button>`)
            .join('');

        const modalHtml = `<h3>Chọn Group cho ${category}</h3><div class="tag-group-selector-grid">${buttonsHTML}</div><div class="modal-actions"><button id="btn-new" title="Tạo mới"><span class="material-symbols-outlined">add</span></button><div style="flex-grow:1"></div><button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button><button id="btn-done" title="Xong"><span class="material-symbols-outlined">check</span></button></div>`;
        const { dialog, close } = this._createModal(modalHtml);

        dialog.querySelector('.tag-group-selector-grid').addEventListener('click', e => {
            if (e.target.matches('.tag-group-select-btn')) {
                e.target.classList.toggle('selected');
            }
        });

        dialog.querySelector('#btn-new').onclick = () => {
            close();
            this.openTagEditor(null, category, { sceneId, stageId });
        };
        dialog.querySelector('#btn-cancel').onclick = close;
        dialog.querySelector('#btn-done').onclick = () => {
            const selectedIds = Array.from(dialog.querySelectorAll('.tag-group-select-btn.selected')).map(btn => btn.dataset.groupId);
            if (category === 'Character') {
                stage.tags[category] = selectedIds.slice(-1);
            } else {
                stage.tags[category] = selectedIds;
            }
            this._sweepUnusedStageTagWeights(stage);
            this.saveScenes();
            this.render();
            close();
        };
    }




    async openTagEditor(groupId, category, context) {
        const isEditing = !!groupId;
        const group = isEditing ? this.state.tagGroups.flat[groupId] : null;
        const stageContext = this._resolveStageContext(context);
        const currentWeight = stageContext && isEditing ? this._getStageTagWeight(stageContext.stage, groupId) : 1;
        const sliderHtml = stageContext
            ? `<div class="form-group"><label>Tags Weight: <span id="tags-weight-display">${this._formatWeightLabel(currentWeight)}</span></label><input type="range" id="tags-weight" min="0.1" max="2" step="0.1" value="${currentWeight}"></div>`
            : '';

        let actions = '';
        if (isEditing) {
            actions += `<button id="btn-remove-from-stage" class="btn-secondary" title="Gỡ khỏi Stage"><span class="material-symbols-outlined">remove</span></button>`;
            actions += `<button id="btn-delete" class="btn-danger" title="Xoá vĩnh viễn"><span class="material-symbols-outlined">delete_forever</span></button>`;
        }
        actions += `<div style="flex-grow:1"></div><button id="btn-cancel" title="Cancel"><span class="material-symbols-outlined">close</span></button><button id="btn-save" title="${isEditing ? 'Cập nhật' : 'Save'}"><span class="material-symbols-outlined">check</span></button>`;

        const modalHtml = `<h3>${isEditing ? 'Sửa' : 'Tạo mới'} Group: ${category}</h3><div class="form-group"><label>Tên Group</label><input type="text" id="group-name" value="${isEditing ? group.name : ''}"></div><div class="form-group"><label>Tags (cách nhau bởi dấu phẩy)</label><textarea id="group-tags" rows="3">${isEditing ? group.tags.join(', ') : ''}</textarea></div>${sliderHtml}<div class="modal-actions">${actions}</div>`;
        const { dialog, close } = this._createModal(modalHtml, true);

        const tagsTextarea = dialog.querySelector('#group-tags');
        if (tagsTextarea) {
            Yuuka.ui._initTagAutocomplete(tagsTextarea.parentElement, this.state.tagPredictions);
            const autoGrowTags = () => {
                tagsTextarea.style.height = 'auto';
                tagsTextarea.style.height = `${tagsTextarea.scrollHeight}px`;
            };
            tagsTextarea.addEventListener('input', autoGrowTags);
            setTimeout(autoGrowTags, 0);
        }

        const weightInput = dialog.querySelector('#tags-weight');
        const weightDisplay = dialog.querySelector('#tags-weight-display');
        if (weightInput && weightDisplay) {
            weightInput.addEventListener('input', () => {
                weightDisplay.textContent = this._formatWeightLabel(weightInput.value);
            });
        }

        dialog.querySelector('#btn-cancel').onclick = close;

        if (isEditing && stageContext?.stage) {
            const removeBtn = dialog.querySelector('#btn-remove-from-stage');
            if (removeBtn) {
                removeBtn.onclick = () => {
                    const stage = stageContext.stage;
                    if (stage?.tags[category]) {
                        stage.tags[category] = stage.tags[category].filter(id => id !== groupId);
                        this._sweepUnusedStageTagWeights(stage);
                        this.saveScenes();
                        this.render();
                        close();
                    }
                };
            }
        }

        if (isEditing) {
            const deleteBtn = dialog.querySelector('#btn-delete');
            if (deleteBtn) {
                deleteBtn.onclick = async () => {
                    if (!await Yuuka.ui.confirm(`Bạn có chắc muốn XOÁ VĨNH VIỄN group '${group.name}'?`)) return;
                    try {
                        await this.api.scene.delete(`/tag_groups/${groupId}`);
                        delete this.state.tagGroups.flat[groupId];
                        if (this.state.tagGroups.grouped[category]) {
                            this.state.tagGroups.grouped[category] = this.state.tagGroups.grouped[category].filter(g => g.id !== groupId);
                        }
                        this.state.scenes.forEach(s => s.stages.forEach(st => {
                            if (st.tags) {
                                Object.keys(st.tags).forEach(cat => {
                                    if (Array.isArray(st.tags[cat])) {
                                        st.tags[cat] = st.tags[cat].filter(id => id !== groupId);
                                    }
                                });
                            }
                            this._sweepUnusedStageTagWeights(st);
                        }));
                        this.saveScenes();
                        this.render();
                        close();
                    } catch (e) {
                        showError(`Lỗi khi xóa: ${e.message}`);
                    }
                };
            }
        }

        dialog.querySelector('#btn-save').onclick = async () => {
            const name = dialog.querySelector('#group-name').value.trim();
            const tagsRaw = dialog.querySelector('#group-tags').value;
            const cleanedTags = tagsRaw.replace(/^[\s,]+|[\s,]+$/g, '').trim();
            const tags = cleanedTags ? cleanedTags.split(',').map(t => t.trim()).filter(Boolean) : [];
            if (!name || tags.length === 0) {
                showError('Vui lòng điền đủ thông tin.');
                return;
            }

            const desiredWeight = stageContext && weightInput ? this._clampWeight(weightInput.value) : 1;

            try {
                if (isEditing) {
                    const updatedGroup = await this.api.scene.put(`/tag_groups/${groupId}`, { name, tags });
                    this.state.tagGroups.flat[groupId] = updatedGroup;
                    const groupList = this.state.tagGroups.grouped[category] || [];
                    const idx = groupList.findIndex(g => g.id === groupId);
                    if (idx > -1) groupList[idx] = updatedGroup;
                    if (stageContext?.stage) {
                        this._setStageTagWeight(stageContext.stage, groupId, desiredWeight);
                        this._sweepUnusedStageTagWeights(stageContext.stage);
                    }
                } else {
                    const newGroup = await this.api.scene.post('/tag_groups', { name, category, tags });
                    this.state.tagGroups.flat[newGroup.id] = newGroup;
                    if (!this.state.tagGroups.grouped[category]) this.state.tagGroups.grouped[category] = [];
                    this.state.tagGroups.grouped[category].push(newGroup);
                    if (stageContext?.stage) {
                        const stage = stageContext.stage;
                        if (!stage.tags[category]) stage.tags[category] = [];
                        if (category === 'Character') stage.tags[category] = [newGroup.id];
                        else stage.tags[category].push(newGroup.id);
                        this._setStageTagWeight(stage, newGroup.id, desiredWeight);
                        this._sweepUnusedStageTagWeights(stage);
                    }
                }
                this.saveScenes();
                this.render();
                close();
            } catch (e) {
                showError(`Lỗi: ${e.message}`);
            }
        };
    }



    _resolveStageContext(context) {
        if (!context) return null;
        if (context.sceneId && context.stageId) {
            const scene = this.state.scenes.find(s => s.id === context.sceneId);
            const stage = scene?.stages.find(st => st.id === context.stageId);
            return stage ? { sceneId: context.sceneId, stageId: context.stageId, stage } : null;
        }
        if (typeof context?.closest === 'function') {
            const stageBlock = context.closest('.stage-block');
            if (!stageBlock) return null;
            const sceneId = stageBlock.dataset.sceneId;
            const stageId = stageBlock.dataset.stageId;
            const scene = this.state.scenes.find(s => s.id === sceneId);
            const stage = scene?.stages.find(st => st.id === stageId);
            return stage ? { sceneId, stageId, stage } : null;
        }
        return null;
    }

    _clampWeight(value) {
        const num = Number(value);
        if (Number.isNaN(num)) return 1;
        const clamped = Math.min(2, Math.max(0.1, num));
        return Math.round(clamped * 10) / 10;
    }

    _formatWeightLabel(value) {
        return this._clampWeight(value).toFixed(1);
    }

    _getStageTagWeight(stage, groupId) {
        if (!stage?.tagWeights) return 1;
        const weight = stage.tagWeights[groupId];
        return typeof weight === 'number' ? this._clampWeight(weight) : 1;
    }

    _setStageTagWeight(stage, groupId, value) {
        if (!stage || !groupId) return;
        const weight = this._clampWeight(value);
        if (Math.abs(weight - 1) < 1e-6) {
            if (stage.tagWeights && Object.prototype.hasOwnProperty.call(stage.tagWeights, groupId)) {
                delete stage.tagWeights[groupId];
                if (Object.keys(stage.tagWeights).length === 0) delete stage.tagWeights;
            }
            return;
        }
        if (!stage.tagWeights) stage.tagWeights = {};
        stage.tagWeights[groupId] = weight;
    }

    _sweepUnusedStageTagWeights(stage) {
        if (!stage?.tagWeights) return;
        const activeIds = new Set();
        Object.values(stage.tags || {}).forEach(ids => {
            if (Array.isArray(ids)) ids.forEach(id => activeIds.add(id));
        });
        Object.keys(stage.tagWeights).forEach(id => {
            if (!activeIds.has(id)) delete stage.tagWeights[id];
        });
        if (Object.keys(stage.tagWeights).length === 0) delete stage.tagWeights;
    }


}
window.Yuuka.components['SceneComponent'] = SceneComponent;
