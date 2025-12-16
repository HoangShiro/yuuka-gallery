// Album plugin - Character view UI: Tools submenu (State mode)
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterRenderToolsList(toolbarEl, listEl) {
            try {
                // Toolbar: close submenu
                const toolbar = document.createElement('div');
                toolbar.className = 'plugin-album__character-submenu-row plugin-album__character-submenu-row--toolbar';

                const exitBtn = document.createElement('button');
                exitBtn.type = 'button';
                exitBtn.className = 'plugin-album__character-submenu-iconbtn';
                exitBtn.title = 'Đóng';
                exitBtn.innerHTML = `<span class="material-symbols-outlined">close</span>`;
                exitBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._characterCloseSubmenu?.();
                });

                // Spacer to align with row layout
                const spacer = document.createElement('div');
                spacer.className = 'plugin-album__character-submenu-toolbar-spacer';

                const title = document.createElement('div');
                title.className = 'plugin-album__character-submenu-name';
                title.textContent = 'Tools';
                title.title = 'Tools';

                toolbar.appendChild(spacer);
                toolbar.appendChild(spacer.cloneNode(true));
                toolbar.appendChild(title);
                toolbar.appendChild(exitBtn);
                toolbarEl.appendChild(toolbar);

                // List: Animation editor
                const row = document.createElement('div');
                row.className = 'plugin-album__character-submenu-row';

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'plugin-album__character-submenu-name';
                btn.textContent = 'Animation editor';
                btn.title = 'Animation editor';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try { this._characterOpenAnimationEditorModal?.(); } catch { }
                });

                row.appendChild(btn);
                listEl.appendChild(row);
            } catch (err) {
                console.warn('[Album] _characterRenderToolsList error:', err);
            }
        },
    });
})();
