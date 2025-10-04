// --- MODIFIED FILE: static/scene.js ---
class SceneManager {
    constructor() {
        this.container = document.getElementById('scene-container');
        this.controls = document.getElementById('scene-controls');
        this.tagGroupModal = document.getElementById('tag-group-modal');
        this.apiKey = localStorage.getItem('yuuka-api-key') || '';
        this.isMobile = window.innerWidth <= 768;

        this.scenes = [];
        this.tagGroups = {}; // { grouped: {...}, flat: {...} }
        this.tagPredictions = [];
        this.selected = { type: null, sceneId: null, stageId: null };
        this.dragged = { element: null, type: null, sceneId: null, stageId: null, groupId: null, category: null, width: 0, height: 0 };
        this.placeholder = null;

        // Yuuka: State cho touch drag & drop
        this.touchStartTimeout = null;
        this.isTouchDragging = false;
        this.preventClick = false;
        this.touchStartCoords = { x: 0, y: 0 };
        this.TOUCH_MOVE_THRESHOLD = 10; // px

        // Yuuka: Dữ liệu cho các selector
        this.accessibleChannels = [];
        this.globalChoices = null;

        // Yuuka: State cho việc sinh ảnh
        this.generationState = {
            isRunning: false,
            statusInterval: null,
            generatingIds: { sceneId: null, stageId: null }, // Yuuka: Lưu ID đang chạy
            activeStageElement: null // Yuuka: Lưu element của stage đang chạy
        };

        this.initEventListeners();
    }

    async init() {
        this.container.innerHTML = `<div class="loader visible">Đang tải dữ liệu Scene...</div>`;
        if (!this.apiKey) {
            this.renderApiKeyForm();
            return;
        }

        try {
            // YUUKA: Tự động chuyển mode API giống Album
            const { mode, message, data } = await api.initializeApiMode(this.apiKey);
            if (mode === 'comfyui') {
                showError(message);
            }
            this.accessibleChannels = data.accessible_channels;
            this.globalChoices = data.global_choices;
            
            if (this.tagPredictions.length === 0) {
                 this.tagPredictions = await api.getTags();
            }

            const [scenes, tagGroupsData] = await Promise.all([
                api.getScenes(this.apiKey),
                api.getTagGroups()
            ]);
            this.scenes = scenes;
            this.tagGroups = tagGroupsData; // Contains .grouped and .flat
            
            if (this.isMobile) {
                this.scenes.forEach(scene => {
                    scene.stages.forEach(stage => {
                        if (stage.isCollapsed === undefined) {
                            stage.isCollapsed = true;
                        }
                    });
                });
            }

            this.render();
            this.checkGenerationStatus(true);
        } catch (error) {
            console.error("Failed to initialize Scene Manager:", error);
            this.container.innerHTML = `<div class="error-msg">Lỗi tải dữ liệu: ${error.message}</div>`;
        }
    }

    // --- State & Data Management ---
    async saveState() {
        if (!this.apiKey) return;
        // Create a deep copy to remove transient state before saving
        const scenesToSave = JSON.parse(JSON.stringify(this.scenes));
        scenesToSave.forEach(scene => {
            scene.stages.forEach(stage => {
                delete stage.isCollapsed;
            });
        });

        try {
            await api.saveScenes(this.apiKey, scenesToSave);
            console.log("Scene state saved.");
        } catch (error) {
            showError(`Lỗi lưu trạng thái: ${error.message}`);
        }
    }
    
    // --- Rendering ---
    render() {
        this.container.innerHTML = '';
        if (this.scenes.length === 0) {
            this.container.appendChild(this.createAddSceneButton());
        } else {
            this.scenes.forEach(scene => {
                this.container.appendChild(this.createSceneRow(scene));
            });
            this.container.appendChild(this.createAddSceneButton());
        }
        this.updateControls();
        this.updateGeneratingFX(); // Yuuka: Apply lại hiệu ứng sau khi render
    }

    createSceneRow(scene) {
        const row = document.createElement('div');
        row.className = 'scene-row scene-block';
        row.dataset.sceneId = scene.id;
        row.draggable = true;

        if (scene.id === this.selected.sceneId && this.selected.type === 'scene') {
            row.classList.add('selected');
        }
        if (scene.bypassed) row.classList.add('bypassed');

        const stagesWrapper = document.createElement('div');
        stagesWrapper.className = 'stages-wrapper';

        scene.stages.forEach((stage, index) => {
            stagesWrapper.appendChild(this.createStageBlock(stage, scene.id, index));
        });

        stagesWrapper.appendChild(this.createAddStageButton(scene.id));
        row.appendChild(stagesWrapper);
        
        const footer = document.createElement('div');
        footer.className = 'scene-footer';
        
        // YUUKA: Chỉ hiển thị selectors và mode switch khi ở chế độ Bot
        if (api.getCurrentApiMode() === 'bot') {
            const botSelectors = document.createElement('div');
            botSelectors.className = 'scene-bot-selectors';
            this._renderBotApiSelectors(botSelectors, scene);
            
            footer.appendChild(botSelectors);
            footer.appendChild(this.createModeBlock(scene));
        } else {
            // Hiển thị một spacer để giữ layout
            const spacer = document.createElement('div');
            spacer.style.flexGrow = '1';
            footer.appendChild(spacer);
        }

        row.appendChild(footer);

        return row;
    }

    createStageBlock(stage, sceneId, index) {
        const block = document.createElement('div');
        block.className = 'stage-block scene-block';
        block.dataset.stageId = stage.id;
        block.dataset.sceneId = sceneId;
        block.draggable = true;
        
        if (this.isMobile && stage.isCollapsed) {
            block.classList.add('collapsed');
        }

        if (stage.id === this.selected.stageId) block.classList.add('selected');
        if (stage.bypassed) block.classList.add('bypassed');

        const title = document.createElement('div');
        title.className = 'stage-block-title';
        title.textContent = `Stage ${index + 1}`;

        if (this.isMobile) {
            const toggle = document.createElement('div');
            toggle.className = 'stage-collapse-toggle';
            block.appendChild(toggle);
        }

        const categoriesWrapper = document.createElement('div');
        categoriesWrapper.className = 'stage-categories-wrapper';

        const categories = ['Character', 'Pose', 'Outfits', 'View', 'Context'];
        categories.forEach(cat => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'stage-category';
            
            const label = document.createElement('label');
            label.className = 'stage-category-label';
            label.textContent = cat.toUpperCase();
            
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'stage-category-tags';
            tagsContainer.dataset.category = cat;

            const assignedGroupIds = stage.tags[cat] || [];
            assignedGroupIds.forEach(groupId => {
                const group = this.findTagGroup(groupId);
                if (group) {
                    tagsContainer.appendChild(this.createTagGroupBlock(group, cat));
                }
            });
            
            tagsContainer.appendChild(this.createAddTagGroupButton(cat, sceneId, stage.id));
            
            categoryDiv.appendChild(label);
            categoryDiv.appendChild(tagsContainer);
            categoriesWrapper.appendChild(categoryDiv);
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
    
    createAddTagGroupButton(category, sceneId, stageId) {
        const btn = document.createElement('button');
        btn.className = 'add-tag-group-btn';
        btn.textContent = '+';
        btn.dataset.category = category;
        btn.dataset.sceneId = sceneId;
        btn.dataset.stageId = stageId;
        return btn;
    }
    
    createModeBlock(scene) {
        const block = document.createElement('div');
        block.className = 'mode-block';
        block.innerHTML = `<span>${scene.mode}</span>`;
        block.addEventListener('click', () => {
            scene.mode = scene.mode === 'ComfyUI' ? 'Bot API' : 'ComfyUI';
            this.saveState();
            this.render();
        });
        return block;
    }

    createAddSceneButton() {
        const btn = document.createElement('div');
        btn.className = 'add-scene-btn';
        btn.textContent = '+';
        btn.title = 'Thêm Scene mới';
        return btn;
    }
    
    createAddStageButton(sceneId) {
        const btn = document.createElement('div');
        btn.className = 'add-stage-btn';
        btn.dataset.sceneId = sceneId;
        btn.textContent = '+';
        btn.title = 'Thêm Stage mới';
        return btn;
    }
    
    renderApiKeyForm() {
        this.container.innerHTML = `
            <div class="api-key-form">
                <h3>Kết nối tới Scene Builder</h3>
                <p>Vui lòng nhập API Key của bạn để sử dụng tính năng này.</p>
                <form id="scene-api-key-submit-form">
                    <input type="text" id="scene-api-key-input" placeholder="Nhập API Key tại đây" required>
                    <button type="submit">Lưu và Tiếp tục</button>
                </form>
            </div>
        `;
        document.getElementById('scene-api-key-submit-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.apiKey = document.getElementById('scene-api-key-input').value.trim();
            if (this.apiKey) {
                localStorage.setItem('yuuka-api-key', this.apiKey);
                this.init();
            }
        });
    }

    updateControls() {
        const hasSelection = this.selected.type !== null;
        this.controls.querySelectorAll('button').forEach(btn => {
            const action = btn.dataset.action;
            if (this.generationState.isRunning) {
                if (action === 'play' || action === 'settings') {
                    btn.disabled = true;
                } else if (action === 'stop') {
                    btn.disabled = false;
                } else { // bypass, delete
                    btn.disabled = !hasSelection;
                }
            } else {
                btn.disabled = (action === 'stop') || (action !== 'settings' && !hasSelection) || (action === 'settings' && this.selected.type !== 'scene');
            }
        });
    }

    // --- Event Listeners ---
    initEventListeners() {
        this.container.addEventListener('click', this.handleClick.bind(this));
        this.controls.addEventListener('click', this.handleControls.bind(this));

        // PC Drag & Drop
        this.container.addEventListener('dragstart', this.handleDragStart.bind(this));
        this.container.addEventListener('dragover', this.handleDragOver.bind(this));
        this.container.addEventListener('dragleave', this.handleDragLeave.bind(this));
        this.container.addEventListener('drop', this.handleDrop.bind(this));
        this.container.addEventListener('dragend', this.handleDragEnd.bind(this));

        // Mobile Touch Drag & Drop
        this.container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        this.container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.container.addEventListener('touchend', this.handleTouchEnd.bind(this));
        this.container.addEventListener('touchcancel', this.handleTouchEnd.bind(this));


        this.tagGroupModal.addEventListener('click', (e) => {
            if (e.target === this.tagGroupModal) this.closeTagGroupModal();
        });
    }

    handleClick(e) {
        if (this.preventClick) {
            e.stopPropagation();
            e.preventDefault();
            return;
        }

        const addSceneBtn = e.target.closest('.add-scene-btn');
        const addStageBtn = e.target.closest('.add-stage-btn');
        const addTagGroupBtn = e.target.closest('.add-tag-group-btn');
        const tagGroupBlock = e.target.closest('.tag-group-block');
        const collapseToggle = e.target.closest('.stage-collapse-toggle');
        const selectable = e.target.closest('.scene-block');
        const selectorTrigger = e.target.closest('.custom-select-trigger');

        if (selectorTrigger) { // Handle selector dropdowns
             e.stopPropagation();
             const container = selectorTrigger.parentElement;
             this.container.querySelectorAll('.custom-select-container.open').forEach(other => {
                if (other !== container) other.classList.remove('open');
             });
             container.classList.toggle('open');
             return; // Prevent selecting the whole scene
        }
        
        if (this.isMobile && collapseToggle) {
            const stageBlock = collapseToggle.parentElement;
            const scene = this.scenes.find(s => s.id === stageBlock.dataset.sceneId);
            const stage = scene?.stages.find(st => st.id === stageBlock.dataset.stageId);
            if (stage) {
                stage.isCollapsed = !stage.isCollapsed; // Update data model
                stageBlock.classList.toggle('collapsed'); // Update view
            }
            e.stopPropagation();
            return;
        }

        if (addSceneBtn) this.addScene();
        else if (addStageBtn) this.addStage(addStageBtn.dataset.sceneId);
        else if (addTagGroupBtn) this.openTagGroupSelector(addTagGroupBtn.dataset.category, addTagGroupBtn.dataset.sceneId, addTagGroupBtn.dataset.stageId);
        else if (tagGroupBlock) { e.stopPropagation(); this.openTagGroupEditor(tagGroupBlock); }
        else if (selectable) this.select(selectable);
        else this.select(null);
    }

    handleControls(e) {
        const button = e.target.closest('button');
        if (!button || button.disabled) return;
        const action = button.dataset.action;
        switch(action) {
            case 'play': this.startGeneration(); break;
            case 'stop': this.cancelGeneration(); break;
            case 'bypass': this.toggleBypass(); break;
            case 'settings': this.openSettings(); break;
            case 'delete': this.deleteSelected(); break;
        }
    }

    // --- Actions ---
    addScene() {
        const lastScene = this.scenes.length > 0 ? this.scenes[this.scenes.length - 1] : null;
        const newScene = { 
            id: `scene_${Date.now()}`, 
            stages: [], 
            mode: lastScene ? lastScene.mode : 'ComfyUI', 
            bypassed: false,
            serverId: lastScene ? lastScene.serverId : 'all',
            channelId: lastScene ? lastScene.channelId : 'all',
            generationConfig: lastScene ? JSON.parse(JSON.stringify(lastScene.generationConfig || {})) : {}
        };
        this.scenes.push(newScene);
        this.saveState(); this.render();
    }
    
    addStage(sceneId) {
        const scene = this.scenes.find(s => s.id === sceneId);
        if (!scene) return;
        
        const newStage = { 
            id: `stage_${Date.now()}`, 
            tags: {}, 
            bypassed: false,
            isCollapsed: false // --- ADDED ---: New stages are expanded by default
        };
        
        if (scene.stages.length > 0) {
            const previousStage = scene.stages[scene.stages.length - 1];
            newStage.tags = JSON.parse(JSON.stringify(previousStage.tags));
        }

        scene.stages.push(newStage);
        this.saveState(); this.render();
    }

    select(element) {
        if (!element) {
            this.selected = { type: null, sceneId: null, stageId: null };
        } else if (element.classList.contains('stage-block')) {
            this.selected = { type: 'stage', sceneId: element.dataset.sceneId, stageId: element.dataset.stageId };
        } else if (element.classList.contains('scene-row')) {
            this.selected = { type: 'scene', sceneId: element.dataset.sceneId, stageId: null };
        } else {
            return;
        }
        this.render();
    }

    deleteSelected() {
        if (!this.selected.type) return;

        let needsConfirmation = true;
        let message = '';

        if (this.selected.type === 'scene') {
            const scene = this.scenes.find(s => s.id === this.selected.sceneId);
            if (scene) {
                const isEmpty = scene.stages.length === 0 || scene.stages.every(
                    stage => Object.keys(stage.tags).length === 0 || Object.values(stage.tags).every(arr => arr.length === 0)
                );
                if (isEmpty) needsConfirmation = false;
                else message = 'Bạn có chắc muốn xoá toàn bộ Scene này?';
            }
        } else if (this.selected.type === 'stage') {
            const scene = this.scenes.find(s => s.id === this.selected.sceneId);
            const stage = scene?.stages.find(st => st.id === this.selected.stageId);
            if (stage) {
                const isEmpty = Object.keys(stage.tags).length === 0 || Object.values(stage.tags).every(arr => arr.length === 0);
                if (isEmpty) needsConfirmation = false;
                else message = 'Bạn có chắc muốn xoá Stage này?';
            }
        }

        if (needsConfirmation && !confirm(message)) return;
        
        if (this.selected.type === 'scene') {
            this.scenes = this.scenes.filter(s => s.id !== this.selected.sceneId);
        } else if (this.selected.type === 'stage') {
            const scene = this.scenes.find(s => s.id === this.selected.sceneId);
            if (scene) {
                scene.stages = scene.stages.filter(st => st.id !== this.selected.stageId);
            }
        }

        this.select(null); 
        this.saveState(); 
        this.render();
    }
    
    toggleBypass() {
        if (!this.selected.type) return;
        if (this.selected.type === 'scene') {
            const scene = this.scenes.find(s => s.id === this.selected.sceneId);
            if(scene) scene.bypassed = !scene.bypassed;
        } else if (this.selected.type === 'stage') {
            const scene = this.scenes.find(s => s.id === this.selected.sceneId);
            const stage = scene?.stages.find(st => st.id === this.selected.stageId);
            if(stage) stage.bypassed = !stage.bypassed;
        }
        this.saveState(); this.render();
    }
    
    openSettings() {
        if (this.selected.type !== 'scene') {
            showError("Vui lòng chọn một Scene để cấu hình.");
            return;
        }
        const scene = this.scenes.find(s => s.id === this.selected.sceneId);
        if (!scene) return;
        
        this.renderSceneSettingsModal(scene);
    }
    
    // --- Generation Logic ---
    async startGeneration() {
        if (this.generationState.isRunning || !this.selected.type) return;

        const startSceneIndex = this.scenes.findIndex(s => s.id === this.selected.sceneId);
        if (startSceneIndex === -1) return;
        
        let startStageIndex = 0;
        if (this.selected.type === 'stage') {
            startStageIndex = this.scenes[startSceneIndex].stages.findIndex(st => st.id === this.selected.stageId);
        }

        const scenesToProcessRaw = this.scenes.slice(startSceneIndex);
        if (scenesToProcessRaw.length === 0) {
            showError("Không có scene nào hợp lệ để gen.");
            return;
        }
        
        // YUUKA: Xử lý scene đầu tiên để bắt đầu từ đúng stage
        const firstSceneRaw = JSON.parse(JSON.stringify(scenesToProcessRaw[0]));
        firstSceneRaw.stages = firstSceneRaw.stages.slice(startStageIndex);
        const scenesForJobRaw = [firstSceneRaw, ...JSON.parse(JSON.stringify(scenesToProcessRaw.slice(1)))];

        // YUUKA: Ghi đè mode nếu đang ở chế độ ComfyUI
        const currentApiMode = api.getCurrentApiMode();
        const scenesForJob = scenesForJobRaw.map(s => {
            if (currentApiMode === 'comfyui') {
                s.mode = 'ComfyUI';
            }
            return s;
        });

        const job = { scenes: scenesForJob };

        try {
            await api.startSceneGeneration(this.apiKey, job);
            this.generationState.isRunning = true;
            this.updateControls();
            this.startStatusPolling();
        } catch (error) {
            showError(`Lỗi bắt đầu: ${error.message}`);
        }
    }

    async cancelGeneration() {
        if (!this.generationState.isRunning) return;
        try {
            await api.cancelSceneGeneration(this.apiKey);
            showError("Đã gửi yêu cầu huỷ.");
        } catch(error) {
            showError(`Lỗi khi huỷ: ${error.message}`);
        }
    }

    startStatusPolling() {
        if (this.generationState.statusInterval) clearInterval(this.generationState.statusInterval);
        this.generationState.statusInterval = setInterval(() => this.checkGenerationStatus(), 1500);
    }

    stopStatusPolling() {
        clearInterval(this.generationState.statusInterval);
        this.generationState.statusInterval = null;
        this.generationState.isRunning = false;
        this.generationState.generatingIds = { sceneId: null, stageId: null };
        this.updateGeneratingFX();
        this.updateControls();
        showError("Quá trình sinh ảnh đã kết thúc.");
    }

    async checkGenerationStatus(isInitialCheck = false) {
        try {
            const status = await api.getSceneGenerationStatus(this.apiKey);
            if (status.is_running) {
                this.generationState.isRunning = true;
                const progress = status.progress;
                const total = progress.total > 0 ? `/${progress.total}` : '';
                showError(`${progress.message} (${progress.current}${total})`);

                this.generationState.generatingIds = {
                    sceneId: status.current_scene_id,
                    stageId: status.current_stage_id
                };
                this.updateGeneratingFX();

                if (isInitialCheck) {
                    this.startStatusPolling();
                }
            } else if (this.generationState.isRunning) {
                this.stopStatusPolling();
            }
            this.updateControls();
        } catch (error) {
            console.error("Error checking status:", error);
            this.stopStatusPolling();
        }
    }

    updateGeneratingFX() {
        // Yuuka: Quản lý hiệu ứng animation khi gen ảnh
        const { sceneId, stageId } = this.generationState.generatingIds;

        // Xóa event listener cũ
        if (this.generationState.activeStageElement) {
            this.generationState.activeStageElement.removeEventListener('mouseenter', this.onEnterGeneratingStage);
            this.generationState.activeStageElement.removeEventListener('mouseleave', this.onLeaveGeneratingStage);
            this.generationState.activeStageElement = null;
        }

        // Xóa tất cả các class cũ
        this.container.querySelectorAll('.is-generating, .is-generating-scene').forEach(el => {
            el.classList.remove('is-generating', 'is-generating-scene');
        });
        
        // Thêm class mới
        if (sceneId) {
            this.container.querySelector(`.scene-row[data-scene-id="${sceneId}"]`)?.classList.add('is-generating-scene');
        }
        if (stageId) {
            const stageElement = this.container.querySelector(`.stage-block[data-stage-id="${stageId}"]`);
            if (stageElement) {
                stageElement.classList.add('is-generating');
                // Thêm event listener mới
                this.generationState.activeStageElement = stageElement;
                stageElement.addEventListener('mouseenter', this.onEnterGeneratingStage.bind(this));
                stageElement.addEventListener('mouseleave', this.onLeaveGeneratingStage.bind(this));
            }
        }
    }

    onEnterGeneratingStage() {
        this.controls.querySelector('button[data-action="delete"]').disabled = true;
    }
    
    onLeaveGeneratingStage() {
        this.updateControls();
    }

    // --- Drag & Drop Logic (Unified) ---

    _startDrag(target) {
        if (!target) return false;
        
        this.dragged.element = target;
        const rect = target.getBoundingClientRect();
        this.dragged.width = rect.width;
        this.dragged.height = rect.height;

        if (target.classList.contains('scene-row')) {
            this.dragged.type = 'scene';
            this.dragged.sceneId = target.dataset.sceneId;
        } else if (target.classList.contains('stage-block')) {
            this.dragged.type = 'stage';
            this.dragged.sceneId = target.dataset.sceneId;
            this.dragged.stageId = target.dataset.stageId;
        } else if (target.classList.contains('tag-group-block')) {
            this.dragged.type = 'tag_group';
            const stage = target.closest('.stage-block');
            this.dragged.sceneId = stage.dataset.sceneId;
            this.dragged.stageId = stage.dataset.stageId;
            this.dragged.groupId = target.dataset.groupId;
            this.dragged.category = target.dataset.category;
        }
        setTimeout(() => target.classList.add('dragging'), 0);
        return true;
    }

    _endDrag() {
        if (this.placeholder && this.placeholder.parentElement) {
            this.saveState();
        }
        this.dragged.element?.classList.remove('dragging');
        this.placeholder?.remove();
        this.placeholder = null;
        this.dragged = { element: null, type: null, sceneId: null, stageId: null, groupId: null, category: null, width: 0, height: 0 };
        this.render();
    }

    _updateDropZones(coords) {
        if (!this.dragged.element) return;
    
        if (!this.placeholder) {
            this.placeholder = document.createElement('div');
            this.placeholder.className = 'drag-placeholder';
            this.placeholder.style.width = `${this.dragged.width}px`;
            this.placeholder.style.height = `${this.dragged.height}px`;
        }

        this.placeholder.style.display = 'none';
        const elementUnder = document.elementFromPoint(coords.clientX, coords.clientY);
        this.placeholder.style.display = '';
        if (!elementUnder) return;

        let dropTarget = null;
        let container = null;
    
        if (this.dragged.type === 'scene') {
            dropTarget = elementUnder.closest('.scene-row');
            container = this.container;
        } else if (this.dragged.type === 'stage') {
            dropTarget = elementUnder.closest('.stage-block, .add-stage-btn');
            container = elementUnder.closest('.stages-wrapper');
            if (this.placeholder) this.placeholder.className = 'drag-placeholder stage-placeholder';
        } else if (this.dragged.type === 'tag_group') {
            container = elementUnder.closest('.stage-category-tags');
            if (container && container.dataset.category === this.dragged.category) {
                dropTarget = elementUnder.closest('.tag-group-block, .add-tag-group-btn');
                if (this.placeholder) this.placeholder.className = 'drag-placeholder tag-group-placeholder';
            } else {
                container = null; 
            }
        }

        if (container) {
            if (dropTarget) {
                this.insertPlaceholder(coords, dropTarget, container, this.dragged.type !== 'scene' && !this.isMobile);
            } else if (this.dragged.type === 'tag_group') {
                container.appendChild(this.placeholder);
            }
        } else if (this.placeholder.parentElement) {
            this.placeholder.remove();
        }
    }

    insertPlaceholder(coords, target, container, isHorizontal) {
        if (this.placeholder.parentElement !== container) {
             container.appendChild(this.placeholder);
        }

        const rect = target.getBoundingClientRect();
        const offset = isHorizontal ? coords.clientX - rect.left : coords.clientY - rect.top;
        const threshold = isHorizontal ? rect.width / 2 : rect.height / 2;

        if (offset < threshold) {
            container.insertBefore(this.placeholder, target);
        } else {
            container.insertBefore(this.placeholder, target.nextElementSibling);
        }
    }
    
    _performDrop() {
        if (!this.placeholder || !this.placeholder.parentElement) return;

        const parent = this.placeholder.parentElement;
        const targetIndex = Array.from(parent.children).indexOf(this.placeholder);

        if (this.dragged.type === 'scene') {
            this.moveScene(this.dragged.sceneId, targetIndex);
        } else if (this.dragged.type === 'stage') {
            const toSceneId = parent.closest('.scene-row').dataset.sceneId;
            this.moveStage(this.dragged.sceneId, this.dragged.stageId, toSceneId, targetIndex);
        } else if (this.dragged.type === 'tag_group') {
            const toStageBlock = parent.closest('.stage-block');
            const toSceneId = toStageBlock.dataset.sceneId;
            const toStageId = toStageBlock.dataset.stageId;
            const toCategory = parent.dataset.category;
            this.moveTagGroup(
                { sceneId: this.dragged.sceneId, stageId: this.dragged.stageId, category: this.dragged.category, groupId: this.dragged.groupId },
                { sceneId: toSceneId, stageId: toStageId, category: toCategory, index: targetIndex }
            );
        }
    }

    // --- PC Mouse Handlers ---
    handleDragStart(e) {
        const target = e.target.closest('.scene-row, .stage-block, .tag-group-block');
        if (!this._startDrag(target)) {
            e.preventDefault(); return;
        }
        e.dataTransfer.effectAllowed = 'move';
    }
    
    handleDragOver(e) {
        e.preventDefault();
        this._updateDropZones({ clientX: e.clientX, clientY: e.clientY });
    }
    
    handleDragLeave(e) { /* Placeholder removed on dragend for stability */ }

    handleDrop(e) {
        e.preventDefault(); e.stopPropagation();
        this._performDrop();
    }

    handleDragEnd(e) {
        this._endDrag();
    }
    
    // --- Mobile Touch Handlers ---
    handleTouchStart(e) {
        const target = e.target.closest('.scene-row, .stage-block, .tag-group-block');
        if (!target) return;

        const touch = e.touches[0];
        this.touchStartCoords = { x: touch.clientX, y: touch.clientY };
        this.isTouchDragging = false;
        
        clearTimeout(this.touchStartTimeout);

        this.touchStartTimeout = setTimeout(() => {
            if (this._startDrag(target)) {
                this.isTouchDragging = true;
                this.preventClick = true;
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }, 500);
    }

    handleTouchMove(e) {
        if (!this.dragged.element && this.touchStartTimeout) {
            const touch = e.touches[0];
            const dx = Math.abs(touch.clientX - this.touchStartCoords.x);
            const dy = Math.abs(touch.clientY - this.touchStartCoords.y);

            if (dx > this.TOUCH_MOVE_THRESHOLD || dy > this.TOUCH_MOVE_THRESHOLD) {
                clearTimeout(this.touchStartTimeout);
                this.touchStartTimeout = null;
            }
            return;
        }

        if (!this.isTouchDragging) return;

        e.preventDefault();
        const touch = e.touches[0];
        this._updateDropZones({ clientX: touch.clientX, clientY: touch.clientY });
    }

    handleTouchEnd(e) {
        clearTimeout(this.touchStartTimeout);
        this.touchStartTimeout = null;

        if (!this.isTouchDragging) return;
        
        this._performDrop();
        this._endDrag();
        this.isTouchDragging = false;

        setTimeout(() => { this.preventClick = false; }, 100);
    }

    // --- Data Manipulation ---
    moveScene(draggedId, targetIndex) {
        const draggedIndex = this.scenes.findIndex(s => s.id === draggedId);
        if (draggedIndex === -1) return;
        const [draggedItem] = this.scenes.splice(draggedIndex, 1);
        this.scenes.splice(targetIndex, 0, draggedItem);
    }

    moveStage(fromSceneId, stageId, toSceneId, targetIndex) {
        const fromScene = this.scenes.find(s => s.id === fromSceneId);
        const toScene = this.scenes.find(s => s.id === toSceneId);
        if (!fromScene || !toScene) return;
        const stageIndex = fromScene.stages.findIndex(st => st.id === stageId);
        if (stageIndex === -1) return;

        const [draggedStage] = fromScene.stages.splice(stageIndex, 1);
        toScene.stages.splice(targetIndex, 0, draggedStage);
    }
    
    moveTagGroup(from, to) {
        const fromScene = this.scenes.find(s => s.id === from.sceneId);
        const fromStage = fromScene?.stages.find(st => st.id === from.stageId);
        const toScene = this.scenes.find(s => s.id === to.sceneId);
        const toStage = toScene?.stages.find(st => st.id === to.stageId);
        if (!fromStage || !toStage || from.category !== to.category) return;

        const groupIndex = fromStage.tags[from.category]?.indexOf(from.groupId);
        if (groupIndex === undefined || groupIndex === -1) return;

        const [movedGroupId] = fromStage.tags[from.category].splice(groupIndex, 1);
        
        if (!toStage.tags[to.category]) toStage.tags[to.category] = [];

        if (from.stageId !== to.stageId && toStage.tags[to.category].includes(movedGroupId)) {
            fromStage.tags[from.category].splice(groupIndex, 0, movedGroupId);
            showError("Tag group này đã tồn tại trong category đích.");
            return;
        }

        toStage.tags[to.category].splice(to.index, 0, movedGroupId);
    }

    // --- Tag Group Modal Logic ---
    findTagGroup(groupId) {
        return this.tagGroups.flat[groupId] || null;
    }

    openTagGroupEditor(tagGroupBlock) {
        const groupId = tagGroupBlock.dataset.groupId;
        const group = this.findTagGroup(groupId);
        if (group) {
            this.renderNewTagGroupForm(group.category, tagGroupBlock, group);
        }
    }
    
    openTagGroupSelector(category, sceneId, stageId) {
        const modalContent = this.tagGroupModal.querySelector('#tag-group-modal-content');
        const scene = this.scenes.find(s => s.id === sceneId);
        const stage = scene?.stages.find(st => st.id === stageId);
        if (!stage) return;

        const stageBlock = this.container.querySelector(`.stage-block[data-scene-id="${sceneId}"][data-stage-id="${stageId}"]`);

        const allGroupsForCategory = this.tagGroups.grouped[category] || [];
        const assignedGroupIds = new Set(stage.tags[category] || []);

        let buttonsHTML = allGroupsForCategory.map(group => {
            const isSelected = assignedGroupIds.has(group.id);
            return `<button class="tag-group-select-btn ${isSelected ? 'selected' : ''}" data-group-id="${group.id}">${group.name}</button>`;
        }).join('');

        modalContent.innerHTML = `
            <h3>Select Groups for ${category}</h3>
            <div class="tag-group-selector-grid">${buttonsHTML}</div>
            <div class="modal-actions">
                <button id="tag-group-new-btn">New</button>
                <div style="flex-grow: 1;"></div>
                <button id="tag-group-cancel-btn">Cancel</button>
                <button id="tag-group-done-btn">Done</button>
            </div>
        `;
        
        this.tagGroupModal.style.display = 'flex';

        modalContent.querySelector('.tag-group-selector-grid').addEventListener('click', e => {
            if(e.target.matches('.tag-group-select-btn')) {
                e.target.classList.toggle('selected');
            }
        });
        
        modalContent.querySelector('#tag-group-new-btn').onclick = () => this.renderNewTagGroupForm(category, stageBlock);
        
        modalContent.querySelector('#tag-group-cancel-btn').onclick = () => this.closeTagGroupModal();
        
        modalContent.querySelector('#tag-group-done-btn').onclick = () => {
            const selectedButtons = modalContent.querySelectorAll('.tag-group-select-btn.selected');
            const selectedIds = Array.from(selectedButtons).map(btn => btn.dataset.groupId);
            stage.tags[category] = selectedIds;
            this.saveState();
            this.render();
            this.closeTagGroupModal();
        };
    }
    
    renderNewTagGroupForm(category, contextElement, existingGroup = null) {
        const modalContent = this.tagGroupModal.querySelector('#tag-group-modal-content');
        const isEditing = existingGroup !== null;
        
        let actionsHTML = '';
        if (isEditing) {
            actionsHTML += `<button id="tag-group-remove-btn" class="btn-secondary" title="Gỡ khỏi Stage này">➖</button>`;
            actionsHTML += `<button id="tag-group-delete-btn" class="btn-danger" title="Xoá vĩnh viễn Tag Group">🗑️</button>`;
        }
        actionsHTML += `<div style="flex-grow: 1;"></div><button id="tag-group-cancel-btn">Cancel</button><button id="tag-group-save-btn">${isEditing ? 'Update' : 'Save'}</button>`;
        
        modalContent.innerHTML = `
            <h3>${isEditing ? 'Edit' : 'New'} Tag Group in ${category}</h3>
            <div class="form-group">
                <label for="tag-group-name-input">Group Name</label>
                <input type="text" id="tag-group-name-input" placeholder="e.g., Cute Smile" value="${isEditing ? existingGroup.name : ''}">
            </div>
            <div class="form-group">
                <label for="tag-group-tags-input">Tags (comma separated)</label>
                <textarea id="tag-group-tags-input" rows="3" placeholder="smile, open mouth, :d">${isEditing ? existingGroup.tags.join(', ') : ''}</textarea>
            </div>
            <div class="modal-actions">
                ${actionsHTML}
            </div>
        `;

        this._initTagAutocomplete(modalContent);
        this.tagGroupModal.style.display = 'flex';
        
        modalContent.querySelector('#tag-group-cancel-btn').onclick = () => this.closeTagGroupModal();
        
        if (isEditing) {
            modalContent.querySelector('#tag-group-remove-btn').onclick = () => {
                const stageBlock = contextElement.closest('.stage-block');
                const scene = this.scenes.find(s => s.id === stageBlock.dataset.sceneId);
                const stage = scene?.stages.find(st => st.id === stageBlock.dataset.stageId);
                
                if (stage && stage.tags[category]) {
                    stage.tags[category] = stage.tags[category].filter(id => id !== existingGroup.id);
                    this.saveState();
                    this.render();
                    this.closeTagGroupModal();
                }
            };
            
            modalContent.querySelector('#tag-group-delete-btn').onclick = async () => {
                if (!confirm(`Bạn có chắc muốn XOÁ VĨNH VIỄN tag group '${existingGroup.name}'?\nHành động này không thể hoàn tác và sẽ gỡ group này khỏi TẤT CẢ các stage.`)) {
                    return;
                }
                try {
                    await api.deleteTagGroup(this.apiKey, existingGroup.id);
                    
                    if (this.tagGroups.grouped[category]) {
                        this.tagGroups.grouped[category] = this.tagGroups.grouped[category].filter(g => g.id !== existingGroup.id);
                    }
                    delete this.tagGroups.flat[existingGroup.id];

                    this.scenes.forEach(scene => {
                        scene.stages.forEach(stage => {
                            if (stage.tags && stage.tags[category]) {
                                stage.tags[category] = stage.tags[category].filter(id => id !== existingGroup.id);
                            }
                        });
                    });

                    showError(`Đã xoá vĩnh viễn group '${existingGroup.name}'.`);
                    this.render();
                    this.closeTagGroupModal();
                } catch (error) {
                    showError(`Lỗi xoá group: ${error.message}`);
                }
            };
        }
        
        modalContent.querySelector('#tag-group-save-btn').onclick = async () => {
            const name = document.getElementById('tag-group-name-input').value.trim();
            const tagsText = document.getElementById('tag-group-tags-input').value.trim();
            if (!name || !tagsText) {
                showError("Vui lòng điền đủ tên và tags.");
                return;
            }

            const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean);
            const payload = { name, tags };

            try {
                if (isEditing) {
                    const updatedGroup = await api.updateTagGroup(this.apiKey, existingGroup.id, payload);
                    const groupIndex = this.tagGroups.grouped[category].findIndex(g => g.id === existingGroup.id);
                    if (groupIndex > -1) {
                        this.tagGroups.grouped[category][groupIndex] = { ...this.tagGroups.grouped[category][groupIndex], ...updatedGroup };
                    }
                    this.tagGroups.flat[existingGroup.id] = { ...this.tagGroups.flat[existingGroup.id], ...updatedGroup };
                } else {
                    payload.category = category;
                    const newGroup = await api.createTagGroup(this.apiKey, payload);
                    if (!this.tagGroups.grouped[category]) this.tagGroups.grouped[category] = [];
                    this.tagGroups.grouped[category].push(newGroup);
                    this.tagGroups.flat[newGroup.id] = newGroup;
                    
                    const stageBlock = contextElement.closest('.stage-block');
                    const scene = this.scenes.find(s => s.id === stageBlock.dataset.sceneId);
                    const stage = scene?.stages.find(st => st.id === stageBlock.dataset.stageId);
                    if (stage) {
                        if (!stage.tags[category]) stage.tags[category] = [];
                        stage.tags[category].push(newGroup.id);
                    }
                }
                
                this.saveState();
                this.render();
                this.closeTagGroupModal();

            } catch (error) {
                showError(`Lỗi: ${error.message}`);
            }
        };
    }

    closeTagGroupModal() {
        this.tagGroupModal.style.display = 'none';
        this.tagGroupModal.querySelector('#tag-group-modal-content').innerHTML = '';
    }

    _initTagAutocomplete(formContainer) {
        if (!this.tagPredictions || this.tagPredictions.length === 0) return;
        const inputs = formContainer.querySelectorAll('textarea');
        inputs.forEach(input => {
            if (input.closest('.tag-autocomplete-container')) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'tag-autocomplete-container';
            input.parentElement.insertBefore(wrapper, input);
            wrapper.appendChild(input);
            const list = document.createElement('ul');
            list.className = 'tag-autocomplete-list';
            wrapper.appendChild(list);
            let activeIndex = -1;
            const hideList = () => { list.style.display = 'none'; list.innerHTML = ''; activeIndex = -1; };
            input.addEventListener('input', () => {
                const text = input.value; const cursorPos = input.selectionStart;
                const textBeforeCursor = text.substring(0, cursorPos);
                const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
                const currentTag = textBeforeCursor.substring(lastCommaIndex + 1).trim();
                if (currentTag.length < 1) { hideList(); return; }
                const searchTag = currentTag.replace(/\s+/g, '_').toLowerCase();
                const matches = this.tagPredictions.filter(tag => tag.startsWith(searchTag)).slice(0, 7);
                if (matches.length > 0) {
                    list.innerHTML = matches.map(match => `<li class="tag-autocomplete-item" data-tag="${match}">${match.replace(/_/g, ' ')}</li>`).join('');
                    list.style.display = 'block'; activeIndex = -1;
                } else { hideList(); }
            });
            const applySuggestion = (suggestion) => {
                const text = input.value; const cursorPos = input.selectionStart;
                const textBeforeCursor = text.substring(0, cursorPos);
                const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
                const before = text.substring(0, lastCommaIndex + 1);
                const after = text.substring(cursorPos);
                let endOfTagIndex = after.indexOf(',');
                if (endOfTagIndex === -1) endOfTagIndex = after.length;
                const finalAfter = text.substring(cursorPos + endOfTagIndex);
                const newText = (before.trim() ? before.trim() + ' ' : '') + suggestion.replace(/_/g, ' ') + ', ' + finalAfter.trim();
                input.value = newText.trim();
                const newCursorPos = (before.trim() ? before.trim() + ' ' : '').length + suggestion.length + 2;
                input.focus(); input.setSelectionRange(newCursorPos, newCursorPos);
                hideList();
                input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            list.addEventListener('mousedown', e => { e.preventDefault(); if (e.target.matches('.tag-autocomplete-item')) applySuggestion(e.target.dataset.tag); });
            input.addEventListener('keydown', e => {
                const items = list.querySelectorAll('.tag-autocomplete-item'); if (items.length === 0) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; }
                else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; }
                else if (e.key === 'Enter' || e.key === 'Tab') { if (activeIndex > -1) { e.preventDefault(); applySuggestion(items[activeIndex].dataset.tag); } return; }
                else if (e.key === 'Escape') { hideList(); return; }
                items.forEach((item, index) => item.classList.toggle('active', index === activeIndex));
            });
            input.addEventListener('blur', () => setTimeout(hideList, 150));
        });
    }

    // --- Bot API Selectors for Scene ---
    _getServersData() {
        return Object.values(this.accessibleChannels.reduce((acc, channel) => {
            if (!acc[channel.server_id]) {
                acc[channel.server_id] = { id: channel.server_id, name: channel.server_name, channels: [] };
            }
            acc[channel.server_id].channels.push({id: channel.channel_id, name: channel.channel_name, serverId: channel.server_id});
            return acc;
        }, {}));
    }

    _renderBotApiSelectors(container, scene) {
        const servers = this._getServersData();
        if (servers.length === 0) return;

        const serverOptions = [{id: 'all', name: 'All Servers'}, ...servers];
        const serverSelectorHTML = this._createSelector('server', serverOptions, scene.serverId || 'all', scene.id);
        
        let channelOptions = [{id: 'all', name: 'All Channels'}];
        if (scene.serverId && scene.serverId !== 'all') {
            const activeServer = servers.find(s => s.id === scene.serverId);
            if(activeServer) {
                channelOptions.push(...activeServer.channels);
            }
        }
        const channelSelectorHTML = this._createSelector('channel', channelOptions, scene.channelId || 'all', scene.id);

        container.innerHTML = serverSelectorHTML + channelSelectorHTML;
        this._attachSelectorListeners(container, scene);
    }

     _createSelector(id, items, selectedId, sceneId) {
        const selectedItem = items.find(item => item.id === selectedId) || items[0];
        const triggerText = id === 'channel' && selectedItem.id !== 'all' ? `#${selectedItem.name}` : selectedItem.name;
        
        const optionsHtml = items.map(item => 
            `<div class="custom-select-option" data-value="${item.id}">${item.id !== 'all' && id === 'channel' ? '#' : ''}${item.name}</div>`
        ).join('');

        return `
            <div class="custom-select-container album-selector" id="scene-${sceneId}-${id}-selector">
                <button class="custom-select-trigger">${triggerText}</button>
                <div class="custom-select-options">${optionsHtml}</div>
            </div>
        `;
    }

    _attachSelectorListeners(container, scene) {
        container.querySelectorAll('.custom-select-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const selectorContainer = e.target.closest('.custom-select-container');
                const id = selectorContainer.id.split('-')[2]; // server or channel
                const value = e.target.dataset.value;

                if (id === 'server') {
                    scene.serverId = value;
                    scene.channelId = 'all'; 
                } else if (id === 'channel') {
                    scene.channelId = value;
                }
                
                this.saveState();
                this.render();
            });
        });
    }
    
    // --- Scene Settings Modal ---
    renderSceneSettingsModal(scene) {
        const modal = document.createElement('div');
        modal.id = 'scene-settings-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-dialog">
                <h3>Cấu hình cho Scene</h3>
                <div class="settings-form" id="scene-settings-form-container"></div>
                 <div class="modal-actions">
                    <button id="scene-cfg-cancel-btn">Hủy</button>
                    <button id="scene-cfg-save-btn">Lưu</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const formContainer = modal.querySelector('#scene-settings-form-container');
        const config = scene.generationConfig || {};
        
        const createNumberInput = (k, l, v, min, max, step) => `<div class="form-group"><label for="cfg-${k}">${l}</label><input type="number" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></div>`;
        const createTextarea = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><textarea id="cfg-${k}" name="${k}" rows="2">${v}</textarea></div>`;
        const createSlider = (k, l, v, min, max, step) => `<div class="form-group form-group-slider"><label for="cfg-${k}">${l}: <span id="val-${k}">${v}</span></label><input type="range" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${k}').textContent = this.value"></div>`;
        const createSelect = (k, l, v, opts) => `<div class="form-group"><label for="cfg-${k}">${l}</label><select id="cfg-${k}" name="${k}">${opts.map(o => `<option value="${o.value}" ${o.value == v ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>`;
        const createTextInput = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><input type="text" id="cfg-${k}" name="${k}" value="${v}"></div>`;
        
        let formHtml = createNumberInput('quantity_per_stage', 'Số lượng ảnh mỗi Stage', config.quantity_per_stage || 1, 1, 10, 1);
        formHtml += createTextarea('quality', 'Quality', config.quality || '');
        formHtml += createTextarea('negative', 'Negative', config.negative || '');
        formHtml += createTextInput('lora_name', 'LoRA Name', config.lora_name || '');
        formHtml += createSlider('steps', 'Steps', config.steps || 25, 10, 50, 1);
        formHtml += createSlider('cfg', 'CFG', config.cfg || 4.5, 1.0, 7.0, 0.1);
        formHtml += createNumberInput('seed', 'Seed (0 = random)', config.seed || 0, 0, Number.MAX_SAFE_INTEGER, 1);
        const currentSize = config.width && config.height ? `${config.width}x${config.height}` : '832x1216';
        formHtml += createSelect('size', 'W x H', currentSize, this.globalChoices.sizes);
        formHtml += createSelect('sampler_name', 'Sampler', config.sampler_name || 'dpmpp_2m', this.globalChoices.samplers);
        formHtml += createSelect('scheduler', 'Scheduler', config.scheduler || 'karras', this.globalChoices.schedulers);
        formHtml += createSelect('ckpt_name', 'Checkpoint', config.ckpt_name || '', this.globalChoices.checkpoints);
        formHtml += createTextInput('server_address', 'Server Address', config.server_address || '');
        
        formContainer.innerHTML = `<form id="scene-config-form">${formHtml}</form>`;
        
        const close = () => modal.remove();
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        modal.querySelector('#scene-cfg-cancel-btn').addEventListener('click', close);
        
        modal.querySelector('#scene-cfg-save-btn').addEventListener('click', () => {
            const form = formContainer.querySelector('#scene-config-form');
            const updates = {};
            ['quality', 'negative', 'lora_name', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name'].forEach(k => updates[k] = form.elements[k].value);
            ['steps', 'cfg'].forEach(k => updates[k] = parseFloat(form.elements[k].value));
            ['quantity_per_stage', 'seed'].forEach(k => updates[k] = parseInt(form.elements[k].value, 10));
            const [width, height] = form.elements['size'].value.split('x').map(Number);
            updates['width'] = width; updates['height'] = height;

            scene.generationConfig = updates;
            this.saveState();
            showError("Lưu cấu hình Scene thành công.");
            close();
        });
    }
}

const sceneManager = new SceneManager();