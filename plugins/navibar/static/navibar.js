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
        this._allSpecialButtons = new Map();

        this._categoryGrid = [];
        this._mainBarLayout = [];
        this._pinnedButtons = { home: null, quick_slot: null };
        this._activePluginId = null;
        this._isContainerOpen = false;
        this._isSearchActive = false;
        this._isGhostRowActive = false;
        
        this._dropPlaceholder = document.createElement('button');
        this._dropPlaceholder.className = 'nav-btn nav-drop-placeholder';
        this._dropPlaceholder.innerHTML = `<span class="material-symbols-outlined">fiber_manual_record</span>`;
        this._dropPlaceholder.disabled = true;

        // Yuuka: anti-crash state v3.0
        this._currentPlaceholderIndex = null;

        this._boundHandleClickOutside = this._handleClickOutside.bind(this);
        document.addEventListener('mousedown', this._boundHandleClickOutside);
        
        this._allSpecialButtons.set('navibar-menu', { id: 'navibar-menu', title: 'Menu', icon: 'menu', type: 'special', onClick: () => this._toggleContainer() });
        this._allSpecialButtons.set('tool-slot-1', { id: 'tool-slot-1', title: 'Tool Slot 1', icon: 'fiber_manual_record', type: 'tool_slot' });
        this._allSpecialButtons.set('tool-slot-2', { id: 'tool-slot-2', title: 'Tool Slot 2', icon: 'fiber_manual_record', type: 'tool_slot' });

        this._loadState();
        this._registerButtonsFromManifests(allPlugins);
        
        if (this._mainBarLayout.length === 0) {
            console.log("[Navibar Migration] Creating new main bar layout from old pinned buttons.");
            this._autoPinInitialButtons(allPlugins);
            this._mainBarLayout = ['navibar-menu', this._pinnedButtons.quick_slot, this._pinnedButtons.home, 'tool-slot-1', 'tool-slot-2'].filter(Boolean);
        }
        
        this._integrityCheck(); 
        this._render();
        
        this._container.addEventListener('dragover', (e) => this._handleContainerDragOver(e));
        this._container.addEventListener('dragleave', (e) => this._handleContainerDragLeave(e));

        this._mainBar.addEventListener('dragover', (e) => this._handleMainBarDragOver(e));
        this._mainBar.addEventListener('dragleave', (e) => this._handleMainBarDragLeave(e));
        this._mainBar.addEventListener('drop', (e) => this._handleMainBarDrop(e));


        if (!window.Yuuka.services.navibar) {
            window.Yuuka.services.navibar = this;
            console.log("[Plugin:Navibar] Service registered.");
        }
    }
    
    destroy() {
        document.removeEventListener('mousedown', this._boundHandleClickOutside);
        console.log("[Plugin:Navibar] Service destroyed and event listeners removed.");
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
        } else {
            this._isSearchActive = false;
        }
        this._updateViewState();
    }
    
    // --- STATE & INTEGRITY ---

    _registerButtonsFromManifests(allPlugins) {
        if (!allPlugins) return;
        allPlugins.forEach(plugin => {
            if (plugin.ui && plugin.ui.tab && plugin.ui.tab.id) {
                const buttonId = `${plugin.id}-main`;
                if (this._allMainButtons.has(buttonId)) return;

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

    _autoPinInitialButtons(allPlugins) {
        if (!allPlugins) return;
        
        const sortedPlugins = allPlugins
            .filter(p => p.ui && p.ui.tab && this._allMainButtons.has(`${p.id}-main`))
            .sort((a, b) => (a.ui.order ?? 99) - (b.ui.order ?? 99));

        if (this._pinnedButtons.home === null && sortedPlugins.length > 0) {
            this._pinnedButtons.home = `${sortedPlugins[0].id}-main`;
        }

        if (this._pinnedButtons.quick_slot === null && sortedPlugins.length > 1) {
            const quickSlotPluginId = `${sortedPlugins[1].id}-main`;
            if (quickSlotPluginId !== this._pinnedButtons.home) {
                this._pinnedButtons.quick_slot = quickSlotPluginId;
            }
        }
    }


    _saveState() {
        localStorage.setItem('yuuka-navibar-grid', JSON.stringify(this._categoryGrid));
        localStorage.setItem('yuuka-navibar-mainbar', JSON.stringify(this._mainBarLayout));
    }

    _loadState() {
        const savedPins = localStorage.getItem('yuuka-navibar-pins');
        if (savedPins) this._pinnedButtons = JSON.parse(savedPins);
        
        const savedGrid = localStorage.getItem('yuuka-navibar-grid');
        if (savedGrid) this._categoryGrid = JSON.parse(savedGrid);

        const savedMainBar = localStorage.getItem('yuuka-navibar-mainbar');
        if (savedMainBar) this._mainBarLayout = JSON.parse(savedMainBar);
    }
    
    _integrityCheck() {
        const registeredMainIds = new Set(this._allMainButtons.keys());
        const allSpecialIds = new Set(this._allSpecialButtons.keys());
        const displayedIds = new Set();
        let changesMade = false;

        const newMainBarLayout = [];
        this._mainBarLayout.forEach(id => {
            if ((registeredMainIds.has(id) || allSpecialIds.has(id)) && !displayedIds.has(id)) {
                newMainBarLayout.push(id);
                displayedIds.add(id);
            } else {
                changesMade = true;
            }
        });
        this._mainBarLayout = newMainBarLayout;

        allSpecialIds.forEach(id => {
            if (!displayedIds.has(id)) {
                this._mainBarLayout.push(id);
                displayedIds.add(id);
                changesMade = true;
            }
        });

        const newCategoryGrid = [];
        this._categoryGrid.forEach(row => {
            const newRow = row.map(id => {
                if (id && registeredMainIds.has(id) && !displayedIds.has(id)) {
                    displayedIds.add(id);
                    return id;
                }
                if (id) changesMade = true;
                return null;
            });
            if (newRow.some(id => id !== null)) {
                newCategoryGrid.push(newRow);
            }
        });
        this._categoryGrid = newCategoryGrid;

        registeredMainIds.forEach(id => {
            if (!displayedIds.has(id)) {
                changesMade = true;
                let placed = false;
                for (let r = 0; r < this._categoryGrid.length; r++) {
                    for (let c = 0; c < 5; c++) {
                        if (this._categoryGrid[r] && this._categoryGrid[r][c] === null) {
                            this._categoryGrid[r][c] = id; placed = true; break;
                        }
                    }
                    if (placed) break;
                }
                if (!placed) {
                    const newRow = Array(5).fill(null); newRow[0] = id; this._categoryGrid.push(newRow);
                }
            }
        });
        
        if (changesMade) {
            console.log("[Navibar Integrity] State was corrected.");
        }
    }
    
    _removeFromGrid(buttonId) {
        for (let r = 0; r < this._categoryGrid.length; r++) {
            for (let c = 0; c < 5; c++) {
                if (this._categoryGrid[r][c] === buttonId) {
                    this._categoryGrid[r][c] = null;
                    return;
                }
            }
        }
    }
    
    // --- EVENT HANDLERS ---

    _handleClickOutside(event) {
        if ((this._isContainerOpen || this._isSearchActive) && !this.element.contains(event.target)) {
            this._isContainerOpen = false;
            this._isSearchActive = false;
            this._updateViewState();
        }
    }

    _toggleContainer() {
        if (this._isContainerOpen) {
            this._isContainerOpen = false;
        } else {
            this._isContainerOpen = true;
            this._isSearchActive = false;
        }
        this._updateViewState();
    }
    
    _handleContainerDragOver(e) {
        if (!this._isContainerOpen || this._isGhostRowActive) return;
        const rect = this._container.getBoundingClientRect();
        if (e.clientY < rect.top + 30) {
            this._categoryGrid.unshift(Array(5).fill(null));
            this._isGhostRowActive = true;
            this._render();
        }
    }
    _handleContainerDragLeave(e) { }

    _handleDragStart(e, dragInfo) {
        this._currentPlaceholderIndex = null;
        e.dataTransfer.setData('application/json', JSON.stringify(dragInfo));
        e.target.classList.add('is-dragging');
    }

    _handleDragEnd(e) {
        this._currentPlaceholderIndex = null;
        this._removePlaceholder();
        e.target.classList.remove('is-dragging');

        if (this._isGhostRowActive) {
            this._isGhostRowActive = false;
            if (this._categoryGrid[0] && this._categoryGrid[0].every(cell => cell === null)) {
                 this._categoryGrid.shift();
            }
        }
        // Re-render to ensure clean state
        this._render();
    }
    
    _handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drop-target-hover'); }
    _handleDragLeave(e) { e.currentTarget.classList.remove('drop-target-hover'); }

    _removePlaceholder() {
        if (this._dropPlaceholder.parentElement) {
            this._dropPlaceholder.remove();
        }
    }

    _handleMainBarDragOver(e) {
        e.preventDefault();
        
        let newPlaceholderIndex = null;
        const children = [...this._mainBar.querySelectorAll('.main-bar-slot:not(.is-dragging)')];
        let isInSwapZone = false;

        for (const child of children) {
            const rect = child.getBoundingClientRect();
            if (e.clientX >= rect.left + rect.width * 0.25 && e.clientX <= rect.right - rect.width * 0.25) {
                isInSwapZone = true;
                break;
            }
        }

        if (!isInSwapZone) {
            newPlaceholderIndex = children.length;
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                const rect = child.getBoundingClientRect();
                if (e.clientX < rect.left + rect.width / 2) {
                    newPlaceholderIndex = i;
                    break;
                }
            }
        }

        // --- NEW LOGIC: HIDE/SHOW INSTEAD OF ADD/REMOVE ---
        // Ensure placeholder is in the DOM during drag, but start it off as inactive.
        if (!this._dropPlaceholder.parentElement) {
            this._mainBar.appendChild(this._dropPlaceholder);
            this._dropPlaceholder.classList.add('is-inactive');
        }

        if (newPlaceholderIndex !== this._currentPlaceholderIndex) {
            this._currentPlaceholderIndex = newPlaceholderIndex;
            
            if (newPlaceholderIndex !== null) {
                const nextElement = children[newPlaceholderIndex] || null;
                this._mainBar.insertBefore(this._dropPlaceholder, nextElement);
                this._dropPlaceholder.classList.remove('is-inactive');
            } else {
                // Instead of removing, we just hide it. It still occupies space.
                this._dropPlaceholder.classList.add('is-inactive');
            }
        }
    }
    
    _handleMainBarDragLeave(e) {
        if (!e.relatedTarget || !this._mainBar.contains(e.relatedTarget)) {
            this._currentPlaceholderIndex = null;
            this._removePlaceholder(); // Actually remove it when leaving the bar
        }
    }

    _handleMainBarDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (this._currentPlaceholderIndex !== null) {
            const newIndex = this._currentPlaceholderIndex;
            
            const dragInfo = JSON.parse(e.dataTransfer.getData('application/json'));
            const draggedButtonId = dragInfo.id;
            
            // Remove from old position
            if (dragInfo.type === 'main_bar') {
                this._mainBarLayout.splice(dragInfo.index, 1);
            } else if (dragInfo.type === 'grid') {
                this._removeFromGrid(draggedButtonId);
            }
            
            // Insert at new position
            this._mainBarLayout.splice(newIndex, 0, draggedButtonId);
            this._finishDragOperation();
        }
    }


    _handleDrop(e, dropTarget) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drop-target-hover');

        const dragInfo = JSON.parse(e.dataTransfer.getData('application/json'));
        const draggedButtonId = dragInfo.id;
        
        if (dropTarget.type === 'grid' && !this._allMainButtons.has(draggedButtonId)) {
            return;
        }

        if (this._isGhostRowActive && dragInfo.type === 'grid') dragInfo.row += 1;
        
        const targetId = dropTarget.type === 'grid'
            ? this._categoryGrid[dropTarget.row][dropTarget.col]
            : this._mainBarLayout[dropTarget.index];
        
        if (dragInfo.type === 'main_bar' && dropTarget.type === 'main_bar') {
            [this._mainBarLayout[dragInfo.index], this._mainBarLayout[dropTarget.index]] = 
            [this._mainBarLayout[dropTarget.index], this._mainBarLayout[dragInfo.index]];
        }
        else if (dragInfo.type === 'grid' && dropTarget.type === 'grid') {
            [this._categoryGrid[dragInfo.row][dragInfo.col], this._categoryGrid[dropTarget.row][dropTarget.col]] =
            [this._categoryGrid[dropTarget.row][dropTarget.col], this._categoryGrid[dragInfo.row][dragInfo.col]];
        }
        else if (dragInfo.type === 'grid' && dropTarget.type === 'main_bar') {
            if (this._allMainButtons.has(targetId)) {
                this._mainBarLayout[dropTarget.index] = draggedButtonId;
                this._categoryGrid[dragInfo.row][dragInfo.col] = targetId;
            } else { return; }
        }
        else if (dragInfo.type === 'main_bar' && dropTarget.type === 'grid') {
            this._categoryGrid[dropTarget.row][dropTarget.col] = draggedButtonId;
            this._mainBarLayout[dragInfo.index] = targetId;
        }

        this._finishDragOperation();
    }
    
    _finishDragOperation() {
        this._currentPlaceholderIndex = null;
        this._removePlaceholder();

        this._cleanupEmptyRows();
        this._integrityCheck();
        this._saveState();
        this._render();
    }

    _cleanupEmptyRows() {
        this._categoryGrid = this._categoryGrid.filter(row => row.some(cell => cell !== null));
    }

    // --- RENDERING LOGIC ---

    _updateViewState() {
        const shouldBeOpen = this._isContainerOpen || this._isSearchActive;
        this._container.classList.toggle('is-open', shouldBeOpen);
        
        this._searchBarContainer.style.display = this._isSearchActive ? 'block' : 'none';
        this._categoriesContainer.style.display = this._isContainerOpen ? 'block' : 'none';
        
        const menuBtn = this._mainBar.querySelector('[data-id="navibar-menu"]');
        if (menuBtn) {
            menuBtn.classList.toggle('active', shouldBeOpen);
        }
    }

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
        
        if (this._activePluginId === config.pluginId && config.type === 'main') {
            btn.classList.add('active');
        }
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
        const activeTools = [...this._allToolButtons.values()]
            .filter(b => b.pluginId === this._activePluginId)
            .sort((a,b) => (a.order || 99) - (b.order || 99));

        this._mainBarLayout.forEach((buttonId, index) => {
            let config = null;
            let isToolPlaceholder = false;

            if (this._allMainButtons.has(buttonId)) {
                config = this._allMainButtons.get(buttonId);
            } else if (this._allSpecialButtons.has(buttonId)) {
                const specialBtnConfig = this._allSpecialButtons.get(buttonId);
                config = { ...specialBtnConfig };
                
                if (config.type === 'tool_slot') {
                    const toolIndex = (config.id === 'tool-slot-1') ? 0 : 1;
                    if (activeTools[toolIndex]) {
                        config = activeTools[toolIndex];
                    } else {
                        isToolPlaceholder = true;
                    }
                }
            }

            if (!config) return;

            const btn = this._createButton(
                { ...config, classList: isToolPlaceholder ? ['is-tool-placeholder'] : [] },
                { isDraggable: true, id: buttonId, type: 'main_bar', index: index },
                { isDropTarget: true, type: 'main_bar', index: index }
            );
            btn.classList.add('main-bar-slot');
            this._mainBar.appendChild(btn);
        });
        
        this._updateViewState();
    }
    
    _renderCategories() {
        this._categoriesContainer.innerHTML = '';
        const mainBarIds = new Set(this._mainBarLayout);
        
        this._categoryGrid.forEach((row, rowIndex) => {
            const rowEl = document.createElement('div');
            rowEl.className = 'category-row';
            row.forEach((buttonId, colIndex) => {
                const dropInfo = { isDropTarget: true, type: 'grid', row: rowIndex, col: colIndex };
                if (buttonId && this._allMainButtons.has(buttonId) && !mainBarIds.has(buttonId)) {
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

        if (this._categoryGrid.length === 0) {
            const rowEl = document.createElement('div');
            rowEl.className = 'category-row is-empty-placeholder';
            rowEl.appendChild(this._createButton({id:'placeholder-empty', classList:['is-placeholder']}, {}, { isDropTarget: true, type: 'grid', row: 0, col: 0 }));
            this._categoriesContainer.appendChild(rowEl);
        }
    }
}

window.Yuuka.components['NavibarComponent'] = NavibarComponent;