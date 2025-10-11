// --- MODIFIED FILE: plugins/navibar/static/navibar.js ---
class NavibarComponent {
    constructor(container, api, allPlugins) { // Yuuka: navibar auto-init v1.0
        this.api = api;
        this.element = document.getElementById('main-nav');
        this.element.innerHTML = `
            <div class="navibar-container">
                <div id="navibar-search-bar" style="display: none;"></div>
                <div id="navibar-categories"></div>
            </div>
            <div id="navibar-main-bar"></div>
        `;

        this._mainBar = this.element.querySelector('#navibar-main-bar');
        this._container = this.element.querySelector('.navibar-container');
        this._searchBarContainer = this.element.querySelector('#navibar-search-bar');
        this._categoriesContainer = this.element.querySelector('#navibar-categories');

        this._allMainButtons = new Map();
        this._allToolButtons = new Map();
        
        this._categoryGrid = []; 
        this._pinnedButtons = { home: null, quick_slot: null };
        this._activePluginId = null;
        this._isContainerOpen = false;
        this._isSearchActive = false;
        this._isGhostRowActive = false; // Yuuka: ghost row fix v2.8 - Cờ trạng thái mới
        
        this._loadState();
        this._registerButtonsFromManifests(allPlugins); // Yuuka: navibar auto-init v1.0
        this._autoPinInitialButtons(allPlugins); // Yuuka: auto-pin v1.0
        this._integrityCheck(); 
        this._render();
        
        this._container.addEventListener('dragover', (e) => this._handleContainerDragOver(e));
        this._container.addEventListener('dragleave', (e) => this._handleContainerDragLeave(e));

        if (!window.Yuuka.services.navibar) {
            window.Yuuka.services.navibar = this;
            console.log("[Plugin:Navibar] Service registered.");
        }
    }

    // --- PUBLIC API ---
    registerButton(config) {
        if (!config || !config.id || !config.type || !config.pluginId) return;

        if (config.type === 'main') {
            this._allMainButtons.set(config.id, config);
        } else if (config.type === 'tools') {
            this._allToolButtons.set(config.id, config);
        }
        
        this._integrityCheck();
        this._render();
    }

    setActivePlugin(pluginId) {
        this._activePluginId = pluginId;
        this._render();
    }
    
    showSearchBar(searchElement) {
        if (searchElement) {
            this._isSearchActive = true;
            this._isContainerOpen = false;
            this._searchBarContainer.innerHTML = '';
            this._searchBarContainer.appendChild(searchElement);
            this._searchBarContainer.style.display = 'block';
            this._categoriesContainer.style.display = 'none';
            this._container.classList.add('is-open');
        } else {
            this._isSearchActive = false;
            this._searchBarContainer.style.display = 'none';
            this._categoriesContainer.style.display = 'block';
            this._container.classList.remove('is-open');
        }
        this._render();
    }
    
    // --- STATE & INTEGRITY ---

    // Yuuka: navibar auto-init v1.0 - Hàm mới để tự động đăng ký nút
    _registerButtonsFromManifests(allPlugins) {
        if (!allPlugins) return;
        allPlugins.forEach(plugin => {
            if (plugin.ui && plugin.ui.tab && plugin.ui.tab.id) {
                const buttonId = `${plugin.id}-main`;
                if (this._allMainButtons.has(buttonId)) return;

                // Yuuka: service launcher v1.0 - Xác định hành động khi click
                let clickHandler;
                if (plugin.ui.tab.is_service_launcher) {
                    clickHandler = () => {
                        const service = window.Yuuka.services[plugin.id];
                        if (service && typeof service.start === 'function') {
                            service.start();
                        } else {
                            console.error(`[Navibar] Service launcher '${plugin.id}' or its 'start' method not found.`);
                            showError(`Không thể khởi động dịch vụ: ${plugin.name}`);
                        }
                    };
                } else {
                    clickHandler = () => Yuuka.ui.switchTab(plugin.ui.tab.id);
                }

                // Yuuka: integrity check fix v3.0 - Thêm trực tiếp vào map, không gọi hàm public
                const buttonConfig = {
                    id: buttonId,
                    type: 'main',
                    pluginId: plugin.id,
                    icon: plugin.ui.tab.icon || 'extension',
                    title: plugin.ui.tab.label || plugin.name,
                    isActive: () => this._activePluginId === plugin.id,
                    onClick: clickHandler
                };
                this._allMainButtons.set(buttonId, buttonConfig);
                
                console.log(`[Navibar] Auto-registered main button for plugin: ${plugin.id}`);
            }
        });
    }

    // Yuuka: auto-pin v1.0 - Logic tự động ghim nút ưu tiên
    _autoPinInitialButtons(allPlugins) {
        if (!allPlugins) return;
        
        const sortedPlugins = allPlugins
            .filter(p => p.ui && p.ui.tab && this._allMainButtons.has(`${p.id}-main`))
            .sort((a, b) => (a.ui.order ?? 99) - (b.ui.order ?? 99));

        if (this._pinnedButtons.home === null && sortedPlugins.length > 0) {
            const homePluginId = `${sortedPlugins[0].id}-main`;
            this._pinnedButtons.home = homePluginId;
            console.log(`[Navibar Auto-Pin] Set Home to: ${homePluginId}`);
        }

        if (this._pinnedButtons.quick_slot === null && sortedPlugins.length > 1) {
            const quickSlotPluginId = `${sortedPlugins[1].id}-main`;
            // Đảm bảo không ghim cùng một nút vào cả hai slot
            if (quickSlotPluginId !== this._pinnedButtons.home) {
                this._pinnedButtons.quick_slot = quickSlotPluginId;
                console.log(`[Navibar Auto-Pin] Set Quick Slot to: ${quickSlotPluginId}`);
            }
        }
    }


    _saveState() {
        localStorage.setItem('yuuka-navibar-pins', JSON.stringify(this._pinnedButtons));
        localStorage.setItem('yuuka-navibar-grid', JSON.stringify(this._categoryGrid));
    }

    _loadState() {
        const savedPins = localStorage.getItem('yuuka-navibar-pins');
        if (savedPins) this._pinnedButtons = JSON.parse(savedPins);
        
        const savedGrid = localStorage.getItem('yuuka-navibar-grid');
        if (savedGrid) this._categoryGrid = JSON.parse(savedGrid);
    }
    
    _integrityCheck() {
        const registeredIds = new Set(this._allMainButtons.keys());
        const displayedIds = new Set();
        const seenOnce = new Set();
        let changesMade = false;

        const checkAndAdd = (id) => {
            if (!id) return null;
            if (!registeredIds.has(id) || seenOnce.has(id)) {
                changesMade = true;
                return null; 
            }
            seenOnce.add(id);
            displayedIds.add(id);
            return id;
        };
        
        this._pinnedButtons.home = checkAndAdd(this._pinnedButtons.home);
        this._pinnedButtons.quick_slot = checkAndAdd(this._pinnedButtons.quick_slot);
        
        for (let r = 0; r < this._categoryGrid.length; r++) {
            for (let c = 0; c < 5; c++) {
                this._categoryGrid[r][c] = checkAndAdd(this._categoryGrid[r][c]);
            }
        }

        registeredIds.forEach(id => {
            if (!displayedIds.has(id)) {
                let placed = false;
                for (let r = 0; r < this._categoryGrid.length; r++) {
                    for (let c = 0; c < 5; c++) {
                        if (this._categoryGrid[r][c] === null) {
                            this._categoryGrid[r][c] = id;
                            placed = true;
                            break;
                        }
                    }
                    if (placed) break;
                }
                if (!placed) {
                    const newRow = Array(5).fill(null);
                    newRow[0] = id;
                    this._categoryGrid.push(newRow);
                }
                changesMade = true;
                 console.warn(`[Navibar Integrity] Rescued lost button: ${id}`);
            }
        });
        
        if(changesMade) {
            console.log("[Navibar Integrity] State was corrected.");
            this._cleanupEmptyRows();
            // Yuuka: auto-save fix v2.0 - Không tự động lưu sau khi kiểm tra
        }
    }
    
    _removeIdFromAllLocations(buttonId) {
        if (!buttonId) return;
        if (this._pinnedButtons.home === buttonId) this._pinnedButtons.home = null;
        if (this._pinnedButtons.quick_slot === buttonId) this._pinnedButtons.quick_slot = null;
        for (let r = 0; r < this._categoryGrid.length; r++) {
            for (let c = 0; c < 5; c++) {
                if (this._categoryGrid[r][c] === buttonId) this._categoryGrid[r][c] = null;
            }
        }
    }

    // --- EVENT HANDLERS ---
    _toggleContainer() {
        if (this._isSearchActive) {
            this._isSearchActive = false;
            this._isContainerOpen = true; 
            this._searchBarContainer.style.display = 'none';
            this._categoriesContainer.style.display = 'block';
            this._container.classList.add('is-open');
        } else {
            this._isContainerOpen = !this._isContainerOpen;
            this._container.classList.toggle('is-open', this._isContainerOpen);
        }
        this._render();
    }
    
    // Yuuka: ghost row fix v2.8 - Khôi phục logic UI cũ
    _handleContainerDragOver(e) {
        if (!this._isContainerOpen || this._isGhostRowActive) return;
        const rect = this._container.getBoundingClientRect();
        if (e.clientY < rect.top + 30) {
            this._categoryGrid.unshift(Array(5).fill(null));
            this._isGhostRowActive = true;
            this._render();
        }
    }
    _handleContainerDragLeave(e) {
        // Dọn dẹp sẽ được xử lý trong `_handleDragEnd` để đảm bảo tính ổn định
    }

    _handleDragStart(e, dragInfo) {
        e.dataTransfer.setData('application/json', JSON.stringify(dragInfo));
        e.target.classList.add('is-dragging');
    }

    _handleDragEnd(e) {
        e.target.classList.remove('is-dragging');
        // Yuuka: ghost row fix v2.8 - Logic dọn dẹp an toàn
        if (this._isGhostRowActive) {
            this._isGhostRowActive = false;
            // Chỉ xóa hàng ma nếu nó còn trống
            if (this._categoryGrid[0] && this._categoryGrid[0].every(cell => cell === null)) {
                 this._categoryGrid.shift();
            }
        }
        this._render();
    }
    
    _handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drop-target-hover'); }
    _handleDragLeave(e) { e.currentTarget.classList.remove('drop-target-hover'); }

    _handleDrop(e, dropTarget) {
        e.preventDefault();
        e.currentTarget.classList.remove('drop-target-hover');

        const dragInfo = JSON.parse(e.dataTransfer.getData('application/json'));
        const draggedButtonId = dragInfo.id;
        
        // Yuuka: ghost row fix v2.8 - HIỆU CHỈNH TỌA ĐỘ
        if (this._isGhostRowActive && dragInfo.type === 'grid') {
            dragInfo.row += 1;
        }

        if (dragInfo.type === dropTarget.type && dragInfo.row === dropTarget.row && dragInfo.col === dropTarget.col && dragInfo.slot === dropTarget.slot) return;
        
        let existingButtonId = null; 
        if(dropTarget.type === 'grid') existingButtonId = this._categoryGrid[dropTarget.row][dropTarget.col];
        else if (dropTarget.type === 'main_bar') existingButtonId = this._pinnedButtons[dropTarget.slot];

        this._removeIdFromAllLocations(draggedButtonId);
        this._removeIdFromAllLocations(existingButtonId);
        
        if(dropTarget.type === 'grid') this._categoryGrid[dropTarget.row][dropTarget.col] = draggedButtonId;
        else if (dropTarget.type === 'main_bar') this._pinnedButtons[dropTarget.slot] = draggedButtonId;
        
        // Dùng tọa độ đã được hiệu chỉnh (nếu có) để đặt lại button cũ
        if(dragInfo.type === 'grid') this._categoryGrid[dragInfo.row][dragInfo.col] = existingButtonId;
        else if (dragInfo.type === 'main_bar') this._pinnedButtons[dragInfo.slot] = existingButtonId;

        this._finishDragOperation();
    }
    
    _finishDragOperation() {
        this._integrityCheck();
        this._cleanupEmptyRows();
        this._saveState(); // Yuuka: auto-save v1.0
        this._render();
    }

    _cleanupEmptyRows() {
        this._categoryGrid = this._categoryGrid.filter(row => row.some(cell => cell !== null));
    }

    // --- RENDERING LOGIC ---
    _createButton(config, dragInfo = {}, dropInfo = {}) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        if(config.classList) btn.classList.add(...config.classList);
        btn.dataset.id = config.id;
        btn.title = config.title || '';
        
        if (!btn.classList.contains('is-placeholder')) {
            btn.innerHTML = `<span class="material-symbols-outlined">${config.icon || 'star'}</span>`;
        }
        if (config.onClick) btn.onclick = () => config.onClick();
        
        // Yuuka: navibar auto-init v1.0 - Cập nhật logic active
        // Nút chính giờ sẽ được tự động kích hoạt bởi navibar
        if (this._activePluginId === config.pluginId && config.type === 'main') {
            btn.classList.add('active');
        }
        // Nút công cụ vẫn dùng logic is_active của riêng nó
        if (config.isActive && config.isActive()) btn.classList.add('active');


        if (dragInfo.isDraggable) {
            btn.draggable = true;
            btn.ondragstart = (e) => this._handleDragStart(e, dragInfo);
            btn.ondragend = (e) => this._handleDragEnd(e);
        }
        if (dropInfo.isDropTarget) {
            btn.ondragover = this._handleDragOver;
            btn.ondragleave = this._handleDragLeave;
            btn.ondrop = (e) => this._handleDrop(e, dropInfo);
        }

        return btn;
    }

    _render() {
        this._renderMainBar();
        this._renderCategories();
    }

    _renderMainBar() {
        this._mainBar.innerHTML = '';
        
        const menuBtn = this._createButton({ id: 'navibar-menu', title: 'Menu', icon: 'menu', onClick: () => this._toggleContainer() });
        if (this._isContainerOpen) menuBtn.classList.add('active');
        this._mainBar.appendChild(menuBtn);

        const quickSlotId = this._pinnedButtons.quick_slot;
        const quickSlotConfig = quickSlotId ? this._allMainButtons.get(quickSlotId) : null;
        const quickSlotBtn = this._createButton(
            quickSlotConfig || {id:'placeholder-qs', classList:['is-placeholder']},
            quickSlotConfig ? { isDraggable: true, id: quickSlotId, type: 'main_bar', slot: 'quick_slot' } : {},
            { isDropTarget: true, type: 'main_bar', slot: 'quick_slot' }
        );
        quickSlotBtn.classList.add('main-bar-slot');
        this._mainBar.appendChild(quickSlotBtn);
        
        const homeId = this._pinnedButtons.home;
        const homeConfig = homeId ? this._allMainButtons.get(homeId) : null;
        const homeBtn = this._createButton(
            homeConfig || {id:'placeholder-h', classList:['is-placeholder']},
            homeConfig ? { isDraggable: true, id: homeId, type: 'main_bar', slot: 'home' } : {},
            { isDropTarget: true, type: 'main_bar', slot: 'home' }
        );
        homeBtn.classList.add('main-bar-slot');
        this._mainBar.appendChild(homeBtn);
        
        const activeTools = [...this._allToolButtons.values()].filter(b => b.pluginId === this._activePluginId).sort((a,b) => (a.order || 99) - (b.order || 99));
        this._mainBar.appendChild(activeTools[0] ? this._createButton(activeTools[0]) : this._createButton({id:'placeholder-t1', classList:['is-placeholder']}));
        this._mainBar.appendChild(activeTools[1] ? this._createButton(activeTools[1]) : this._createButton({id:'placeholder-t2', classList:['is-placeholder']}));
    }
    
    _renderCategories() {
        this._categoriesContainer.innerHTML = '';
        const pinnedIds = new Set(Object.values(this._pinnedButtons));
        
        this._categoryGrid.forEach((row, rowIndex) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'category-row';
            row.forEach((buttonId, colIndex) => {
                const dropInfo = { isDropTarget: true, type: 'grid', row: rowIndex, col: colIndex };
                if (buttonId && this._allMainButtons.has(buttonId) && !pinnedIds.has(buttonId)) {
                    const btnConfig = this._allMainButtons.get(buttonId);
                    const dragInfo = { isDraggable: true, id: buttonId, type: 'grid', row: rowIndex, col: colIndex };
                    rowEl.appendChild(this._createButton(btnConfig, dragInfo, dropInfo));
                } else {
                     const placeholder = this._createButton({id:`placeholder-c-${rowIndex}-${colIndex}`, classList:['is-placeholder']}, {}, dropInfo);
                     rowEl.appendChild(placeholder);
                }
            });
            this._categoriesContainer.appendChild(rowEl);
        });

        // Yuuka: empty placeholder v1.0
        if (this._categoryGrid.length === 0) {
            const rowEl = document.createElement('div');
            rowEl.className = 'category-row is-empty-placeholder';
            // Thêm một ô trống để giữ chiều cao
            rowEl.appendChild(this._createButton({id:'placeholder-empty', classList:['is-placeholder']}, {}, { isDropTarget: true, type: 'grid', row: 0, col: 0 }));
            this._categoriesContainer.appendChild(rowEl);
        }
    }
}

window.Yuuka.components['NavibarComponent'] = NavibarComponent;