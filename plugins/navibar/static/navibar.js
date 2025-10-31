class NavibarComponent {
    constructor(container, api, allPlugins) {
        this.api = api;
        this.element = document.getElementById('main-nav');
        // Yuuka: navibar refactor v4.1 - ThÃªm tray container
        this.element.innerHTML = `
            <div id="navibar-tray">
                <div id="navibar-main-view">
                    <div id="navibar-sub-grid"></div>
                    <div id="navibar-main-bar"></div>
                </div>
                <div id="navibar-search-bar"></div>
                <div id="navibar-dock" class="navibar-dock"></div>
            </div>
        `;

        this._tray = this.element.querySelector('#navibar-tray');
        this._mainView = this.element.querySelector('#navibar-main-view');
        this._mainBar = this.element.querySelector('#navibar-main-bar');
        this._subGrid = this.element.querySelector('#navibar-sub-grid');
        this._searchBarContainer = this.element.querySelector('#navibar-search-bar');
        this._dockContainer = this.element.querySelector('#navibar-dock');

        this._allMainButtons = new Map();
        this._allToolButtons = new Map();
        this._allSpecialButtons = new Map();
        this._toggleStates = new Map();

        this._mainBarLayout = [];
        this._subGridLayout = []; 
        this._activePluginId = null;
        this._isSearchActive = false;
        this._isSubGridOpen = false;
        this._isDragActive = false;
        this._searchBarCleanup = null;
        this._searchBarTeardownTimer = null;
        this._dockCleanup = null;
        this._dockOwnerId = null;
        this._isDockActive = false;
        this._isDockPeekOpen = false;
        this._prefersReducedMotion = false;
        this._hasRenderedOnce = false;
        this._boundHandleMotionPreferenceChange = this._handleMotionPreferenceChange.bind(this);
        this._motionMediaQuery = null;
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            this._prefersReducedMotion = mediaQuery.matches;
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', this._boundHandleMotionPreferenceChange);
            } else if (mediaQuery.addListener) {
                mediaQuery.addListener(this._boundHandleMotionPreferenceChange);
            }
            this._motionMediaQuery = mediaQuery;
        }
        
        this._boundHandleClickOutside = this._handleClickOutside.bind(this);
        document.addEventListener('mousedown', this._boundHandleClickOutside);
        
        this._allSpecialButtons.set('navibar-menu', { id: 'navibar-menu', title: 'Menu', icon: 'menu', type: 'special', onClick: () => this._toggleSubGrid() });
        this._allSpecialButtons.set('tool-slot-1', { id: 'tool-slot-1', title: 'Tool Slot 1', icon: 'fiber_manual_record', type: 'tool_slot' });
        this._allSpecialButtons.set('tool-slot-2', { id: 'tool-slot-2', title: 'Tool Slot 2', icon: 'fiber_manual_record', type: 'tool_slot' });

        this._registerButtonsFromManifests(allPlugins);
        this._loadState();
        
        if (this._mainBarLayout.length === 0 && this._subGridLayout.length === 0) {
            console.log("[Navibar] No saved layout found. Creating default layout.");
            const mainButtons = [...this._allMainButtons.values()];
            const sortedMainButtonIds = mainButtons
                .map(btn => ({ id: btn.id, pluginId: btn.pluginId }))
                .sort((a, b) => {
                    const pluginA = allPlugins.find(p => p.id === a.pluginId);
                    const pluginB = allPlugins.find(p => p.id === b.pluginId);
                    const orderA = pluginA?.ui?.order ?? 99;
                    const orderB = pluginB?.ui?.order ?? 99;
                    return orderA - orderB;
                })
                .map(item => item.id);

            this._mainBarLayout = [
                ...sortedMainButtonIds,
                'tool-slot-1', 
                'tool-slot-2',
                'navibar-menu'
            ];
        }
        
        this._integrityCheck(); 
        this._render();
        this._initDragAndDrop();

        if (!window.Yuuka.services.navibar) {
            window.Yuuka.services.navibar = this;
            console.log("[Plugin:Navibar] Service registered.");
        }
    }
    
    destroy() {
        document.removeEventListener('mousedown', this._boundHandleClickOutside);
        if (this._motionMediaQuery) {
            if (this._motionMediaQuery.removeEventListener) {
                this._motionMediaQuery.removeEventListener('change', this._boundHandleMotionPreferenceChange);
            } else if (this._motionMediaQuery.removeListener) {
                this._motionMediaQuery.removeListener(this._boundHandleMotionPreferenceChange);
            }
            this._motionMediaQuery = null;
        }
        if (this._searchBarCleanup) {
            this._searchBarCleanup();
        }
        if (this._searchBarTeardownTimer) {
            clearTimeout(this._searchBarTeardownTimer);
            this._searchBarTeardownTimer = null;
        }
        this.closeDock();
        console.log("[Plugin:Navibar] Service destroyed and event listeners removed.");
    }

    // --- PUBLIC API ---
    registerButton(config) {
        if (!config || !config.id || !config.type || !config.pluginId) return;

        if (config.type === 'main') {
            const normalized = this._normalizeMainButtonConfig(config);
            this._allMainButtons.set(normalized.id, normalized);
        } else if (config.type === 'tools') {
            this._allToolButtons.set(config.id, config);
        }
        
        this._integrityCheck();
        this._render();
        this._initDragAndDrop();
    }

    _normalizeMainButtonConfig(config) {
        const normalized = { ...config };

        if (normalized.mode !== 'toggle') {
            normalized.mode = 'default';
            this._toggleStates.delete(normalized.id);
            return normalized;
        }

        const states = Array.isArray(normalized.toggleStates)
            ? normalized.toggleStates
                .filter(state => state && typeof state === 'object')
                .map(state => ({ ...state }))
            : [];

        if (states.length === 0) {
            console.warn(`[Navibar] Toggle button '${normalized.id}' missing 'toggleStates'. Falling back to default mode.`);
            normalized.mode = 'default';
            delete normalized.toggleStates;
            this._toggleStates.delete(normalized.id);
            return normalized;
        }

        normalized.toggleStates = states;
        const existing = this._toggleStates.get(normalized.id);
        const declaredInitial = Number.isInteger(normalized.initialToggleIndex) ? normalized.initialToggleIndex : 0;
        const safeInitial = ((declaredInitial % states.length) + states.length) % states.length;
        const indexToUse = existing ? existing.index % states.length : safeInitial;

        this._toggleStates.set(normalized.id, {
            index: indexToUse,
            previousIndex: existing?.previousIndex ?? null,
            cycle: existing?.cycle ?? 0
        });

        return normalized;
    }

    _handleMainButtonClick(config, element, event) {
        if (config.mode === 'toggle' && this._toggleStates.has(config.id)) {
            this._handleToggleClick(config, element, event);
            return;
        }

        if (typeof config.onClick === 'function') {
            config.onClick(event);
        }
    }

    _handleToggleClick(config, element, event) {
        const toggleInfo = this._getCurrentToggleState(config);
        const record = this._toggleStates.get(config.id);

        if (!toggleInfo || !record) {
            if (typeof config.onClick === 'function') {
                config.onClick(event);
            }
            return;
        }

        const { state, index } = toggleInfo;
        const handler = typeof state.onClick === 'function'
            ? state.onClick
            : (typeof config.onClick === 'function' ? config.onClick : null);
        const context = this._buildToggleContext(config, index, record.previousIndex, element, event, record.cycle ?? 0, state);

        if (handler) {
            try {
                handler(context);
            } catch (err) {
                console.error(`[Navibar] Error executing toggle handler for '${config.id}'.`, err);
            }
        }

        if (typeof config.onToggle === 'function') {
            try {
                config.onToggle(context);
            } catch (err) {
                console.error(`[Navibar] Error in 'onToggle' callback for '${config.id}'.`, err);
            }
        }

        this._advanceToggleState(config, element, event, index, state);
        this._render();
    }

    _advanceToggleState(config, element, event, previousIndex, previousState) {
        const record = this._toggleStates.get(config.id);
        const states = Array.isArray(config.toggleStates) ? config.toggleStates : [];
        if (!record || states.length === 0) return;

        const shouldLoop = config.toggleLoop !== false;
        let nextIndex = record.index + 1;
        let cycle = record.cycle ?? 0;

        if (nextIndex >= states.length) {
            if (shouldLoop) {
                nextIndex = 0;
                cycle += 1;
            } else {
                nextIndex = states.length - 1;
            }
        }

        const updatedRecord = {
            index: nextIndex,
            previousIndex: previousIndex,
            cycle
        };

        this._toggleStates.set(config.id, updatedRecord);

        if (typeof config.onToggleStateChange === 'function') {
            const nextState = states[updatedRecord.index] || null;
            const context = this._buildToggleContext(config, updatedRecord.index, previousIndex, element, event, cycle, nextState);
            context.previousState = previousState || null;

            try {
                config.onToggleStateChange(context);
            } catch (err) {
                console.error(`[Navibar] Error in 'onToggleStateChange' for '${config.id}'.`, err);
            }
        }
    }

    _getCurrentToggleState(config) {
        if (config.mode !== 'toggle') return null;
        const states = Array.isArray(config.toggleStates) ? config.toggleStates : null;
        if (!states || states.length === 0) return null;

        const record = this._toggleStates.get(config.id);
        const rawIndex = record ? record.index : 0;
        const normalisedIndex = ((rawIndex % states.length) + states.length) % states.length;

        return {
            index: normalisedIndex,
            state: states[normalisedIndex]
        };
    }

    _resolveButtonPresentation(config) {
        if (config.mode === 'toggle') {
            const toggleInfo = this._getCurrentToggleState(config);
            if (toggleInfo) {
                const record = this._toggleStates.get(config.id);
                const state = toggleInfo.state || {};
                const context = this._buildToggleContext(config, toggleInfo.index, record?.previousIndex ?? null, null, null, record?.cycle ?? 0, state);
                const icon = typeof state.icon === 'function' ? state.icon(context) : state.icon;
                const title = typeof state.title === 'function' ? state.title(context) : state.title;
                const isActiveValue = typeof state.isActive === 'function' ? state.isActive(context) : state.isActive;

                return {
                    icon: icon ?? config.icon,
                    title: title ?? config.title,
                    isActive: Boolean(isActiveValue)
                };
            }
        }

        return {
            icon: config.icon,
            title: config.title,
            isActive: false
        };
    }

    _buildToggleContext(config, stateIndex, previousIndex, element, event, cycle = null, state = null) {
        return {
            buttonId: config.id,
            pluginId: config.pluginId,
            stateIndex,
            previousIndex,
            element,
            event,
            cycle,
            state,
            navibar: this
        };
    }

    setActivePlugin(pluginId) {
        this._activePluginId = pluginId;
        this._render();
    }
    
    showSearchBar(searchElement) {
        if (!searchElement && this._searchBarCleanup) {
            this._isSearchActive = false;
            this._updateViewState();
            return;
        }
        if (searchElement) {
            if (this._searchBarCleanup) {
                this._searchBarCleanup();
            }
            if (this._searchBarTeardownTimer) {
                clearTimeout(this._searchBarTeardownTimer);
                this._searchBarTeardownTimer = null;
            }

            this._isSearchActive = true;
            this._isSubGridOpen = false;
            if (this._isDockPeekOpen) {
                this._isDockPeekOpen = false;
                this._emitDockPeekChange();
            }
            this._searchBarContainer.innerHTML = '';

            if (searchElement.id === 'search-form') {
                const wrapper = document.createElement('div');
                wrapper.className = 'navibar-search-wrapper';

                searchElement.classList.add('navibar-search-form');
                wrapper.appendChild(searchElement);

                const returnBtn = document.createElement('button');
                returnBtn.type = 'button';
                returnBtn.className = 'nav-btn navibar-search-return';
                returnBtn.title = 'Trở về';
                returnBtn.innerHTML = '<span class="material-symbols-outlined">chevron_forward</span>';
                returnBtn.addEventListener('click', () => this.showSearchBar(null));
                wrapper.appendChild(returnBtn);

                this._searchBarContainer.appendChild(wrapper);
            } else {
                this._searchBarContainer.appendChild(searchElement);
            }
        } else {
            this._isSearchActive = false;

            const formInTray = this._searchBarContainer.querySelector('#search-form');
            const wrapper = formInTray ? formInTray.closest('.navibar-search-wrapper') : this._searchBarContainer.querySelector('.navibar-search-wrapper');
            const floatingContainer = document.getElementById('floating-search-bar');

            if (wrapper && formInTray && floatingContainer) {
                const doCleanup = () => {
                    if (this._searchBarCleanup !== doCleanup) return;
                    this._searchBarCleanup = null;
                    this._searchBarContainer.removeEventListener('transitionend', handleTransitionEnd);
                    if (this._searchBarTeardownTimer) {
                        clearTimeout(this._searchBarTeardownTimer);
                        this._searchBarTeardownTimer = null;
                    }
                    if (formInTray.parentElement === wrapper) {
                        formInTray.classList.remove('navibar-search-form');
                        floatingContainer.appendChild(formInTray);
                    }
                    if (wrapper.parentElement === this._searchBarContainer) {
                        this._searchBarContainer.innerHTML = '';
                    }
                };

                const handleTransitionEnd = (evt) => {
                    if (evt.target !== this._searchBarContainer || evt.propertyName !== 'max-height') return;
                    doCleanup();
                };

                this._searchBarCleanup = doCleanup;
                this._searchBarContainer.addEventListener('transitionend', handleTransitionEnd);
                this._searchBarTeardownTimer = setTimeout(() => doCleanup(), 380);
            } else {
                if (formInTray && floatingContainer) {
                    formInTray.classList.remove('navibar-search-form');
                    floatingContainer.appendChild(formInTray);
                }
                if (this._searchBarCleanup) {
                    this._searchBarCleanup = null;
                }
                if (this._searchBarTeardownTimer) {
                    clearTimeout(this._searchBarTeardownTimer);
                    this._searchBarTeardownTimer = null;
                }
                this._searchBarContainer.innerHTML = '';
            }
        }
        this._updateViewState();
    }

    openDock(ownerId, options = {}) {
        if (!this._dockContainer) {
            console.warn("[Navibar] Dock container is not initialized.");
            return null;
        }
        if (!ownerId) {
            console.warn("[Navibar] Dock ownerId is required.");
            return null;
        }

        if (this._isSearchActive) {
            this.showSearchBar(null);
        }
        this._isSubGridOpen = false;

        const allowReplace = options.allowReplace !== false;
        if (this._dockOwnerId && this._dockOwnerId !== ownerId && !allowReplace) {
            console.warn(`[Navibar] Dock is already claimed by '${this._dockOwnerId}'. '${ownerId}' cannot replace it without allowReplace.`);
            return null;
        }
        if (this._dockOwnerId && this._dockOwnerId !== ownerId && allowReplace) {
            this.closeDock(this._dockOwnerId);
        }
        if (this._dockOwnerId === ownerId) {
            this.closeDock(ownerId);
        }

        let contentElement = options.element || null;
        let renderCleanup = null;
        if (!contentElement && typeof options.render === "function") {
            try {
                const renderResult = options.render(this._dockContainer);
                if (renderResult instanceof HTMLElement) {
                    contentElement = renderResult;
                } else if (renderResult && renderResult.element instanceof HTMLElement) {
                    contentElement = renderResult.element;
                    if (typeof renderResult.cleanup === "function") {
                        renderCleanup = renderResult.cleanup;
                    }
                }
            } catch (err) {
                console.error("[Navibar] Dock render function error.", err);
            }
        }

        if (!contentElement) {
            console.warn(`[Navibar] Dock '${ownerId}' did not provide a valid element.`);
            return null;
        }

        this._dockContainer.innerHTML = "";
        this._dockContainer.className = "navibar-dock";
        this._dockContainer.dataset.owner = ownerId;

        const extraClasses = Array.isArray(options.classes)
            ? options.classes
            : (typeof options.className === "string" ? options.className.split(/\s+/) : []);
        extraClasses.filter(Boolean).forEach(cls => this._dockContainer.classList.add(cls));

        if (!contentElement.parentElement || contentElement.parentElement !== this._dockContainer) {
            this._dockContainer.appendChild(contentElement);
        }

        const providedCleanup = typeof options.onClose === "function" ? options.onClose : null;
        if (renderCleanup || providedCleanup) {
            this._dockCleanup = () => {
                try {
                    if (typeof renderCleanup === "function") {
                        renderCleanup();
                    }
                } finally {
                    if (typeof providedCleanup === "function") {
                        providedCleanup();
                    }
                }
            };
        } else {
            this._dockCleanup = null;
        }

        this._dockOwnerId = ownerId;
        this._isDockPeekOpen = false;
        this._isDockActive = true;
        this._updateViewState();
        this._emitDockPeekChange();

        if (options.autoFocus !== false) {
            const selector = options.focusSelector || options.autoFocusSelector;
            const focusTarget = selector
                ? this._dockContainer.querySelector(selector)
                : this._dockContainer.querySelector("textarea, input, [contenteditable='true']");
            if (focusTarget && typeof focusTarget.focus === "function") {
                const preventScroll = options.preventScroll !== false;
                setTimeout(() => {
                    try {
                        focusTarget.focus({ preventScroll });
                    } catch {
                        focusTarget.focus();
                    }
                }, 0);
            }
        }

        return {
            ownerId,
            element: contentElement,
            close: () => this.closeDock(ownerId),
        };
    }

    closeDock(ownerId) {
        if (!this._dockContainer || !this._dockOwnerId) {
            return;
        }
        if (ownerId && this._dockOwnerId !== ownerId) {
            return;
        }

        const cleanup = this._dockCleanup;
        this._dockCleanup = null;
        this._dockOwnerId = null;

        this._dockContainer.innerHTML = "";
        this._dockContainer.removeAttribute("data-owner");
        this._dockContainer.className = "navibar-dock";

        if (this._isDockPeekOpen) {
            this._isDockPeekOpen = false;
        }
        this._isDockActive = false;
        this._updateViewState();
        this._emitDockPeekChange();

        if (typeof cleanup === "function") {
            try {
                cleanup();
            } catch (err) {
                console.error("[Navibar] Dock cleanup failed.", err);
            }
        }
    }

    toggleDockPeek(shouldOpen = null) {
        if (!this._isDockActive) {
            if (this._isDockPeekOpen) {
                this._isDockPeekOpen = false;
                this._updateViewState();
                this._emitDockPeekChange();
            }
            return false;
        }

        const next = typeof shouldOpen === 'boolean' ? shouldOpen : !this._isDockPeekOpen;
        if (next === this._isDockPeekOpen) {
            return this._isDockPeekOpen;
        }

        if (next && this._isSearchActive) {
            this.showSearchBar(null);
        }

        if (next) {
            this._isSubGridOpen = false;
        }

        this._isDockPeekOpen = next;
        this._updateViewState();
        this._emitDockPeekChange();
        return this._isDockPeekOpen;
    }

    setDockPeekOpen(shouldOpen) {
        return this.toggleDockPeek(Boolean(shouldOpen));
    }

    isDockPeekOpen() {
        return this._isDockActive && this._isDockPeekOpen;
    }

    _emitDockPeekChange() {
        if (!this._tray || typeof CustomEvent !== 'function') {
            return;
        }
        const detail = {
            isOpen: this._isDockPeekOpen,
            isDockActive: this._isDockActive,
            ownerId: this._dockOwnerId || null,
        };
        const event = new CustomEvent('navibar:dockPeekChange', {
            detail,
            bubbles: true,
            composed: true,
        });
        this._tray.dispatchEvent(event);
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

    _saveState() {
        localStorage.setItem('yuuka-navibar-mainbar', JSON.stringify(this._mainBarLayout));
        localStorage.setItem('yuuka-navibar-subgrid', JSON.stringify(this._subGridLayout));
    }

    _loadState() {
        const savedMainBar = localStorage.getItem('yuuka-navibar-mainbar');
        const savedSubGrid = localStorage.getItem('yuuka-navibar-subgrid');
        if (savedMainBar) {
            try { this._mainBarLayout = JSON.parse(savedMainBar); } 
            catch (e) { this._mainBarLayout = []; }
        }
        if (savedSubGrid) {
            try { this._subGridLayout = JSON.parse(savedSubGrid); }
            catch (e) { this._subGridLayout = []; }
        }
    }
    
    _integrityCheck() {
        const allKnownIds = new Set([
            ...this._allMainButtons.keys(),
            ...this._allSpecialButtons.keys()
        ]);
        let changesMade = false;
        const currentLayoutIds = new Set([...this._mainBarLayout, ...this._subGridLayout]);

        this._mainBarLayout = this._mainBarLayout.filter(id => allKnownIds.has(id));
        this._subGridLayout = this._subGridLayout.filter(id => allKnownIds.has(id));

        allKnownIds.forEach(id => {
            if (!currentLayoutIds.has(id)) {
                this._subGridLayout.push(id); 
                changesMade = true;
            }
        });
        
        if (changesMade) {
            console.log("[Navibar Integrity] State was corrected.");
            this._saveState();
        }
    }
    
    // --- EVENT HANDLERS ---

    _handleClickOutside(event) {
        if (!this.element.contains(event.target)) {
            const wasSubGridOpen = this._isSubGridOpen;
            const wasDockPeekOpen = this._isDockPeekOpen;
            if (this._isSearchActive) {
                this.showSearchBar(null);
            }
            if (wasSubGridOpen) {
                this._isSubGridOpen = false;
            }
            if (wasDockPeekOpen) {
                this._isDockPeekOpen = false;
            }
            if (wasSubGridOpen || wasDockPeekOpen) {
                this._updateViewState();
                if (wasDockPeekOpen) {
                    this._emitDockPeekChange();
                }
            }
        }
    }

    _handleMotionPreferenceChange(event) {
        this._prefersReducedMotion = !!event.matches;
    }

    _toggleSubGrid() {
        this._isSubGridOpen = !this._isSubGridOpen;
        if(this._isSubGridOpen) this._isSearchActive = false;
        this._updateViewState();
    }
    
    _finishDragOperation() {
        this._isDragActive = false;
        this._saveState();
        this._updateViewState();
        console.log("[Navibar] Drag operation finished and state saved.");
    }

    // --- DRAG & DROP ---
    _initDragAndDrop() {
        const baseOptions = {
            animation: 150,
            ghostClass: 'navibar-dragging-ghost',
            dragClass: 'navibar-dragging',
            filter: '.is-not-draggable',
            emptyInsertThreshold: 32,
            onStart: this._handleSortableStart.bind(this),
            onEnd: this._handleSortableEnd.bind(this)
        };

        if (this._mainBarSortable) this._mainBarSortable.destroy();
        this._mainBarSortable = Sortable.create(this._mainBar, {
            ...baseOptions,
            group: { name: 'navibar-buttons', pull: true, put: true }
        });

        if (this._subGridSortable) this._subGridSortable.destroy();
        this._subGridSortable = Sortable.create(this._subGrid, {
            ...baseOptions,
            group: {
                name: 'navibar-buttons',
                pull: true,
                put: (to, from, dragEl) => {
                    return !(dragEl && dragEl.dataset && dragEl.dataset.id === 'navibar-menu');
                }
            }
        });
    }

    _handleSortableStart() {
        this._isDragActive = true;
        this._updateViewState();
    }

    _handleSortableEnd(evt) {
        const trayGapDropMeta = this._detectTrayGapDrop(evt);
        if (trayGapDropMeta) {
            const draggedId = evt?.item?.dataset?.id;
            if (draggedId) {
                this._applyTrayGapDrop(draggedId, trayGapDropMeta);
            }
            this._finishDragOperation();
            return;
        }

        const newMainBarLayout = [];
        this._mainBar.querySelectorAll('.nav-btn, .main-bar-slot').forEach(btn => {
            if (btn.dataset.id) newMainBarLayout.push(btn.dataset.id);
        });
        this._mainBarLayout = newMainBarLayout;
        
        const newSubGridLayout = [];
        this._subGrid.querySelectorAll('.nav-btn, .main-bar-slot').forEach(btn => {
            if (btn.dataset.id) newSubGridLayout.push(btn.dataset.id);
        });
        this._subGridLayout = newSubGridLayout;

        // Safety: keep 'navibar-menu' in the main bar only
        const menuIdxInSub = this._subGridLayout.indexOf('navibar-menu');
        if (menuIdxInSub !== -1) {
            this._subGridLayout.splice(menuIdxInSub, 1);
            if (!this._mainBarLayout.includes('navibar-menu')) {
                this._mainBarLayout.push('navibar-menu');
            }
        }

        this._finishDragOperation();
    }

    _detectTrayGapDrop(evt) {
        const originalEvt = evt?.originalEvent;
        if (!originalEvt || typeof originalEvt.clientX !== 'number' || typeof originalEvt.clientY !== 'number') {
            return null;
        }

        const point = { x: originalEvt.clientX, y: originalEvt.clientY };
        const trayRect = this._tray?.getBoundingClientRect();
        const mainRect = this._mainBar?.getBoundingClientRect();
        const subRect = this._subGrid?.getBoundingClientRect();

        if (!trayRect || !mainRect) return null;
        if (!this._isPointInsideRect(point, trayRect)) return null;

        const isInMain = this._isPointInsideRect(point, mainRect);
        const canUseSubGrid = !!(subRect && (this._isSubGridOpen || this._isDragActive)); // Treat tray as open while dragging
        const isInSub = canUseSubGrid && subRect ? this._isPointInsideRect(point, subRect) : false;

        if (isInMain || isInSub) {
            return null;
        }

        const target = this._resolveGapDropTarget(point, mainRect, subRect, canUseSubGrid);
        const container = target === 'main' ? this._mainBar : this._subGrid;
        const index = this._calculateDropIndex(container, point.x);

        return { target, index };
    }

    _resolveGapDropTarget(point, mainRect, subRect, isSubVisible) {
        if (!isSubVisible || !subRect) {
            return 'main';
        }
        const distanceToMain = this._distanceToRect(point, mainRect);
        const distanceToSub = this._distanceToRect(point, subRect);
        return distanceToMain <= distanceToSub ? 'main' : 'sub';
    }

    _calculateDropIndex(container, clientX) {
        if (!container) return 0;
        const items = Array.from(container.querySelectorAll('.nav-btn, .main-bar-slot'));
        if (items.length === 0) return 0;

        for (let i = 0; i < items.length; i++) {
            const rect = items[i].getBoundingClientRect();
            const threshold = rect.left + rect.width / 2;
            if (clientX <= threshold) {
                return i;
            }
        }
        return items.length;
    }

    _applyTrayGapDrop(buttonId, meta) {
        if (!meta) return;

        const safeMeta = { ...meta };
        if (safeMeta.target === 'sub' && buttonId === 'navibar-menu') {
            safeMeta.target = 'main';
        }

        this._mainBarLayout = this._mainBarLayout.filter(id => id !== buttonId);
        this._subGridLayout = this._subGridLayout.filter(id => id !== buttonId);

        const targetLayout = safeMeta.target === 'sub' ? this._subGridLayout : this._mainBarLayout;
        const insertIndex = Math.min(Math.max(safeMeta.index ?? targetLayout.length, 0), targetLayout.length);
        targetLayout.splice(insertIndex, 0, buttonId);

        this._render();
    }

    _distanceToRect(point, rect) {
        if (!rect) return Number.POSITIVE_INFINITY;
        const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
        const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
        return Math.hypot(dx, dy);
    }

    _isPointInsideRect(point, rect) {
        if (!rect) return false;
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    }


    // --- RENDERING LOGIC ---

    _updateViewState() {
        const isSubGridVisible = this._isSubGridOpen || this._isDragActive;
        const isDockPeekVisible = this._isDockActive && this._isDockPeekOpen;
        
        this._tray.classList.toggle('is-subgrid-open', isSubGridVisible);
        this._tray.classList.toggle('is-search-active', this._isSearchActive);
        this._tray.classList.toggle('is-dock-active', this._isDockActive);
        this._tray.classList.toggle('is-dock-peek-open', isDockPeekVisible);
        if (this._mainView) {
            const hideMainView = this._isSearchActive || (this._isDockActive && !this._isDockPeekOpen);
            this._mainView.classList.toggle('is-hidden', hideMainView);
        }
        
        const menuBtn = this.element.querySelector('[data-id="navibar-menu"]');
        if (menuBtn) {
            menuBtn.classList.toggle('active', this._isSubGridOpen);
        }
    }

    _createButton(config) {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        if(config.classList) btn.classList.add(...config.classList);
        btn.dataset.id = config.id;

        const presentation = this._resolveButtonPresentation(config);
        btn.title = presentation.title || config.title || '';
        
        // Allow 'navibar-menu' to be draggable within the main bar
        
        btn.innerHTML = `<span class="material-symbols-outlined">${presentation.icon || config.icon || 'star'}</span>`;
        btn.addEventListener('click', (event) => this._handleMainButtonClick(config, btn, event));
        
        if (this._activePluginId === config.pluginId && config.type === 'main') {
            btn.classList.add('active');
        }
        if (presentation.isActive || (config.isActive && config.isActive())) btn.classList.add('active');
        if (config.mode === 'toggle') btn.dataset.toggleMode = 'true';

        return btn;
    }

    _render() {
        this._mainBar.innerHTML = '';
        this._subGrid.innerHTML = '';

        // Ensure 'navibar-menu' never persists in sub-grid from saved state
        const _menuIdxPersist = this._subGridLayout.indexOf('navibar-menu');
        if (_menuIdxPersist !== -1) {
            this._subGridLayout.splice(_menuIdxPersist, 1);
            if (!this._mainBarLayout.includes('navibar-menu')) {
                this._mainBarLayout.push('navibar-menu');
            }
            this._saveState();
        }

        const activeTools = [...this._allToolButtons.values()]
            .filter(b => b.pluginId === this._activePluginId)
            .sort((a,b) => (a.order || 99) - (b.order || 99));

        const renderButtonInLayout = (buttonId, container) => {
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
                        const activeToolConf = activeTools[toolIndex];
                        config = { ...activeToolConf, id: config.id };
                    } else {
                        isToolPlaceholder = true;
                    }
                }
            }

            if (!config) return;

            const btn = this._createButton({ ...config, classList: isToolPlaceholder ? ['is-tool-placeholder'] : [] });
            btn.classList.add('main-bar-slot');
            const shouldAnimateMount = !this._prefersReducedMotion && !this._hasRenderedOnce;
            if (shouldAnimateMount) {
                btn.classList.add('navibar-btn-enter');
            }
            container.appendChild(btn);

            if (shouldAnimateMount) {
                requestAnimationFrame(() => {
                    if (!btn.isConnected) return;
                    btn.classList.add('navibar-btn-enter-active');
                });

                const handleMountEnd = (evt) => {
                    if (evt.propertyName !== 'transform') return;
                    btn.classList.remove('navibar-btn-enter');
                    btn.classList.remove('navibar-btn-enter-active');
                    btn.removeEventListener('transitionend', handleMountEnd);
                };

                btn.addEventListener('transitionend', handleMountEnd);
            }
        };

        this._mainBarLayout.forEach(id => renderButtonInLayout(id, this._mainBar));
        this._subGridLayout.forEach(id => renderButtonInLayout(id, this._subGrid));
        
        this._hasRenderedOnce = true;
        this._updateViewState();
    }
}

window.Yuuka.components['NavibarComponent'] = NavibarComponent;


