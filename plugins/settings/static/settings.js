class SettingsComponent {
    constructor(container, api, allPlugins) {
        this.container = container;
        this.api = api;
        this.allPlugins = allPlugins;
        
        // Singleton registry
        if (!SettingsComponent._registry) {
            SettingsComponent._registry = [];
        }

        // 1. Initialize DOM elements first if container exists
        if (this.container) {
            this.activeSectionId = localStorage.getItem('yuuka-settings-active-section') || null;
            this.container.innerHTML = `
                <div class="settings-layout">
                    <div class="settings-sidebar" id="settings-sidebar"></div>
                    <div class="settings-content" id="settings-content"></div>
                </div>
            `;
            
            this.sidebar = this.container.querySelector('#settings-sidebar');
            this.content = this.container.querySelector('#settings-content');
        }

        // 2. Consume buffer ONLY after elements are ready
        if (window.Yuuka.services.settings && window.Yuuka.services.settings._buffer) {
            const buffer = window.Yuuka.services.settings._buffer;
            // Clear buffer immediately to prevent double processing
            window.Yuuka.services.settings._buffer = [];
            buffer.forEach(s => this.registerSection(s));
        }

        // 3. Register this instance as the active service
        window.Yuuka.services.settings = this;
    }

    async init() {
        if (this.container) {
            this.render();
        }
    }

    registerSection(section) {
        let s = SettingsComponent._registry.find(x => x.id === section.id);
        if (!s) {
            s = {
                id: section.id,
                label: section.label,
                icon: section.icon || 'settings',
                order: section.order || 100,
                renderers: []
            };
            SettingsComponent._registry.push(s);
            SettingsComponent._registry.sort((a, b) => (a.order || 100) - (b.order || 100));
        } else {
            if (section.label) s.label = section.label;
            if (section.icon) s.icon = section.icon;
            if (section.order) {
                s.order = section.order;
                SettingsComponent._registry.sort((a, b) => (a.order || 100) - (b.order || 100));
            }
        }
        
        if (typeof section.render === 'function') {
            s.renderers.push(section.render);
        }
        
        // Only render if we have a UI container and it's visible
        if (this.container && this.container.style.display !== 'none') {
            this.render();
        }
    }

    render() {
        if (!this.container || !this.sidebar || !this.content) return;
        
        const sections = SettingsComponent._registry;
        if (sections.length === 0) {
            this.sidebar.innerHTML = '';
            this.content.innerHTML = '<div class="settings-empty">Không có cài đặt nào được đăng ký.</div>';
            return;
        }

        if (!this.activeSectionId || !sections.find(s => s.id === this.activeSectionId)) {
            this.activeSectionId = sections[0].id;
        }

        this.renderSidebar();
        this.renderContent();
    }

    renderSidebar() {
        if (!this.sidebar) return;
        const sections = SettingsComponent._registry;
        this.sidebar.innerHTML = '';
        sections.forEach(section => {
            const item = document.createElement('div');
            item.className = `settings-sidebar-item ${this.activeSectionId === section.id ? 'active' : ''}`;
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined';
            iconSpan.textContent = section.icon || 'settings';
            
            const labelSpan = document.createElement('span');
            labelSpan.className = 'settings-sidebar-label';
            labelSpan.textContent = section.label;
            
            item.appendChild(iconSpan);
            item.appendChild(labelSpan);
            item.title = section.label;
            
            item.onclick = () => {
                this.activeSectionId = section.id;
                localStorage.setItem('yuuka-settings-active-section', section.id);
                this.render();
            };
            this.sidebar.appendChild(item);
        });
    }

    renderContent() {
        if (!this.content) return;
        const sections = SettingsComponent._registry;
        const section = sections.find(s => s.id === this.activeSectionId);
        if (!section) return;

        this.content.innerHTML = '';
        
        const header = document.createElement('div');
        header.className = 'settings-content-header';
        header.innerHTML = `<h2>${section.label}</h2>`;
        this.content.appendChild(header);

        const body = document.createElement('div');
        body.className = 'settings-content-body';
        this.content.appendChild(body);

        if (section.renderers && section.renderers.length > 0) {
            section.renderers.forEach((renderer, index) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'settings-section-module';
                if (index > 0) {
                    wrapper.style.marginTop = 'var(--spacing-6)';
                    wrapper.style.paddingTop = 'var(--spacing-6)';
                    wrapper.style.borderTop = '1px dashed var(--color-border)';
                }
                body.appendChild(wrapper);
                try {
                    renderer(wrapper);
                } catch (e) {
                    console.error(`[Settings] Renderer error in ${section.id}:`, e);
                    wrapper.innerHTML = `<div class="error">Lỗi khi hiển thị một phần của mục này: ${e.message}</div>`;
                }
            });
        } else {
            body.innerHTML = '<div class="settings-empty">Mục này chưa có nội dung.</div>';
        }
    }
}

window.Yuuka.components['SettingsComponent'] = SettingsComponent;

// Register global core settings
(function registerGlobalSettings() {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.services = window.Yuuka.services || {};
    
    // Bootstrap buffer if settings service not yet loaded
    if (!window.Yuuka.services.settings) {
        window.Yuuka.services.settings = {
            registerSection: (s) => {
                window.Yuuka.services.settings._buffer = window.Yuuka.services.settings._buffer || [];
                window.Yuuka.services.settings._buffer.push(s);
            },
            _buffer: []
        };
    }

    const settings = window.Yuuka.services.settings;
    settings.registerSection({
        id: 'core',
        label: 'Core',
        icon: 'settings_applications',
        order: 10,
        render: (container) => {
            const isDark = document.documentElement.classList.contains('dark-mode');
            
            container.innerHTML = `
                <div class="settings-section-group">
                    <h3 class="settings-section-title">Giao diện</h3>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <span class="settings-item-label">Chế độ tối (Dark Mode)</span>
                            <span class="settings-item-description">Chuyển đổi giữa giao diện sáng và tối cho toàn bộ ứng dụng.</span>
                        </div>
                        <div class="settings-item-control">
                            <label class="yuuka-switch">
                                <input type="checkbox" id="setting-theme-toggle" ${isDark ? 'checked' : ''}>
                                <span class="yuuka-switch__slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            `;
            
            const toggle = container.querySelector('#setting-theme-toggle');
            toggle.onchange = () => {
                if (toggle.checked) {
                    document.documentElement.classList.add('dark-mode');
                    localStorage.setItem('yuuka-theme', 'dark');
                } else {
                    document.documentElement.classList.remove('dark-mode');
                    localStorage.setItem('yuuka-theme', 'light');
                }
            };
        }
    });
})();

// Bootstrap service early
(function bootstrapSettings() {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.services = window.Yuuka.services || {};
    
    if (!window.Yuuka.services.settings) {
        const buffer = [];
        window.Yuuka.services.settings = {
            registerSection: (s) => {
                buffer.push(s);
            },
            _buffer: buffer
        };
        console.log('[Settings] Early bootstrap service initialized.');
    }
})();
