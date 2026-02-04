(function () {
    // Module: Navibar integration (tool registration + syncing)
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    // Yuuka: navibar v2.0 integration
    proto._registerNavibarButtons = function () {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;

        // Yuuka: navibar auto-init v1.0 - Gỡ bỏ việc đăng ký nút chính 'album-main'
        // Navibar sẽ tự động đăng ký nút này từ manifest.

        // 2. Tool buttons (only visible when active)
        // Tools: Album settings
        navibar.registerButton({
            id: 'album-settings',
            type: 'tools',
            pluginId: 'album',
            order: 1,
            icon: 'tune',
            title: 'Cấu hình',
            onClick: () => this.openSettings()
        });

        // Tools: Generate (works for album + character)
        navibar.registerButton({
            id: 'album-generate',
            type: 'tools',
            pluginId: 'album',
            order: 2,
            icon: 'auto_awesome',
            title: 'Tạo ảnh mới',
            onClick: () => this._handleGenerateToolClick()
        });

        // Tools: Animation editor history (Undo / Redo)
        // Note: ordering will be managed by _syncNavibarToolButtons().
        navibar.registerButton({
            id: 'album-anim-undo',
            type: 'tools',
            pluginId: 'album',
            order: 200,
            icon: 'undo',
            title: 'Undo',
            isActive: () => {
                try { return !!this._albumAnimEditorCanUndo?.(); } catch { return false; }
            },
            onClick: () => {
                try {
                    if (typeof this._albumAnimEditorUndo === 'function') this._albumAnimEditorUndo();
                } catch { }
            }
        });
        navibar.registerButton({
            id: 'album-anim-redo',
            type: 'tools',
            pluginId: 'album',
            order: 201,
            icon: 'redo',
            title: 'Redo',
            isActive: () => {
                try { return !!this._albumAnimEditorCanRedo?.(); } catch { return false; }
            },
            onClick: () => {
                try {
                    if (typeof this._albumAnimEditorRedo === 'function') this._albumAnimEditorRedo();
                } catch { }
            }
        });

        // Tools: choose open view mode (only shown in grid via dynamic ordering)
        navibar.registerButton({
            id: 'album-open-mode-album',
            type: 'tools',
            pluginId: 'album',
            order: 99,
            icon: 'photo_album',
            title: 'Mở album theo chế độ: Album',
            isActive: () => this.state.viewMode === 'grid' && this.state.gridOpenMode === 'album',
            onClick: () => {
                if (this.state.viewMode !== 'grid') return;
                this._setGridPreferredViewMode('album');
                this._updateNav();
            }
        });

        navibar.registerButton({
            id: 'album-open-mode-character',
            type: 'tools',
            pluginId: 'album',
            order: 100,
            icon: 'person',
            title: 'Mở album theo chế độ: Character',
            isActive: () => this.state.viewMode === 'grid' && this.state.gridOpenMode === 'character',
            onClick: () => {
                if (this.state.viewMode !== 'grid') return;
                this._setGridPreferredViewMode('character');
                this._updateNav();
            }
        });

        // Apply correct tool ordering initially
        this._syncNavibarToolButtons();
    };

    proto._syncNavibarToolButtons = function () {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;

        const inGrid = this.state.viewMode === 'grid';
        const inAnimEditor = this.state.viewMode === 'character' && !!(this.state.character?._animEditor?.isOpen);
        const inSoundEditor = this.state.viewMode === 'character' && !!(this.state.character?._soundEditor?.isOpen);
        const inEditor = inAnimEditor || inSoundEditor;

        // In grid: show mode selector tools; in album/character: show settings+generate
        navibar.registerButton({
            id: 'album-settings',
            type: 'tools',
            pluginId: 'album',
            order: inGrid ? 99 : (inEditor ? 99 : 1),
            icon: 'tune',
            title: 'Cấu hình',
            onClick: () => this.openSettings()
        });
        navibar.registerButton({
            id: 'album-generate',
            type: 'tools',
            pluginId: 'album',
            order: inGrid ? 100 : (inEditor ? 100 : 2),
            icon: 'auto_awesome',
            title: 'Tạo ảnh mới',
            onClick: () => this._handleGenerateToolClick()
        });

        // Animation editor: prioritize Undo/Redo into the 2 tool slots
        navibar.registerButton({
            id: 'album-anim-undo',
            type: 'tools',
            pluginId: 'album',
            order: inEditor ? 1 : 200,
            icon: 'undo',
            title: 'Undo',
            isActive: () => {
                try { return !!this._albumAnimEditorCanUndo?.(); } catch { return false; }
            },
            onClick: () => {
                try {
                    if (typeof this._albumAnimEditorUndo === 'function') this._albumAnimEditorUndo();
                } catch { }
            }
        });
        navibar.registerButton({
            id: 'album-anim-redo',
            type: 'tools',
            pluginId: 'album',
            order: inEditor ? 2 : 201,
            icon: 'redo',
            title: 'Redo',
            isActive: () => {
                try { return !!this._albumAnimEditorCanRedo?.(); } catch { return false; }
            },
            onClick: () => {
                try {
                    if (typeof this._albumAnimEditorRedo === 'function') this._albumAnimEditorRedo();
                } catch { }
            }
        });
        navibar.registerButton({
            id: 'album-open-mode-album',
            type: 'tools',
            pluginId: 'album',
            order: inGrid ? 1 : 99,
            icon: 'photo_album',
            title: 'Mở album theo chế độ: Album',
            isActive: () => this.state.viewMode === 'grid' && this.state.gridOpenMode === 'album',
            onClick: () => {
                if (this.state.viewMode !== 'grid') return;
                this._setGridPreferredViewMode('album');
                this._updateNav();
            }
        });
        navibar.registerButton({
            id: 'album-open-mode-character',
            type: 'tools',
            pluginId: 'album',
            order: inGrid ? 2 : 100,
            icon: 'person',
            title: 'Mở album theo chế độ: Character',
            isActive: () => this.state.viewMode === 'grid' && this.state.gridOpenMode === 'character',
            onClick: () => {
                if (this.state.viewMode !== 'grid') return;
                this._setGridPreferredViewMode('character');
                this._updateNav();
            }
        });
    };

    proto._updateNav = function () {
        const navibar = window.Yuuka.services.navibar;
        if (!navibar) return;
        // Keep Album tools available across grid/album/character
        navibar.setActivePlugin('album');
        this._syncNavibarToolButtons();
        // Sync DOM data attributes for external detection
        this._syncDOMSelection();
    };

    proto._handleGenerateToolClick = function () {
        if (this.state.viewMode === 'album') {
            const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
            if (tasksForThisChar >= 5) {
                showError('Đã đạt giới hạn 5 tác vụ đồng thời.');
                return;
            }
            if (!this.state.isComfyUIAvaidable) {
                showError('ComfyUI chưa kết nối.');
                return;
            }
            this._startGeneration();
            return;
        }

        if (this.state.viewMode === 'character') {
            if (!this.state.isComfyUIAvaidable) {
                showError('ComfyUI chưa kết nối.');
                return;
            }
            // User explicitly requested generation => cancel any running auto task immediately
            this._characterStartGeneration({ forceNew: true, auto: false });
        }
    };
})();
