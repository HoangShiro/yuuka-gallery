// Album plugin - Character view UI: main-menu progress bar renderer
// Pattern: prototype augmentation (no bundler / ESM)

(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterEnsureMenuProgressUI() {
            const root = this.contentArea?.querySelector('.plugin-album__character-view');
            if (!root) return;

            // Main menu progress indicator: a thin right-edge bar (like a scrollbar)
            let bar = root.querySelector('.plugin-album__character-progressbar');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'plugin-album__character-progressbar';
                bar.hidden = true;
                bar.setAttribute('aria-hidden', 'true');
                bar.innerHTML = `<div class="plugin-album__character-progressbar-fill" aria-hidden="true"></div>`;
                root.appendChild(bar);
            }
        },

        _characterUpdateMenuProgressBorder(allTasksStatus) {
            try {
                if (this.state?.viewMode !== 'character') return;
                this._characterEnsureMenuProgressUI();

                const root = this.contentArea?.querySelector('.plugin-album__character-view');
                const menu = root?.querySelector('.plugin-album__character-menu');
                const bar = root?.querySelector('.plugin-album__character-progressbar');
                if (!menu || !bar) return;

                const model = (typeof this._characterComputeMainMenuProgressModel === 'function')
                    ? this._characterComputeMainMenuProgressModel(allTasksStatus)
                    : null;

                if (!model) {
                    bar.hidden = true;
                    menu.classList.remove('is-generating');
                    menu.classList.remove('is-auto-generating');
                    bar.classList.remove('is-auto-generating');
                    bar.style.removeProperty('--album-menu-progress');
                    bar.style.removeProperty('--album-mainmenu-top');
                    bar.style.removeProperty('--album-mainmenu-height');
                    return;
                }

                // Anchor the progress bar to the main menu stack height (not the whole view)
                try {
                    const rootRect = root.getBoundingClientRect();
                    const menuRect = menu.getBoundingClientRect();
                    const top = Math.max(0, menuRect.top - rootRect.top);
                    const height = Math.max(0, menuRect.height);
                    bar.style.setProperty('--album-mainmenu-top', `${top}px`);
                    bar.style.setProperty('--album-mainmenu-height', `${height}px`);
                } catch { }

                bar.hidden = false;
                menu.classList.add('is-generating');
                menu.classList.toggle('is-auto-generating', !!model.isAutoOnly);
                bar.classList.toggle('is-auto-generating', !!model.isAutoOnly);
                bar.style.setProperty('--album-menu-progress', String(model.percent));
            } catch (err) {
                console.warn('[Album] _characterUpdateMenuProgressBorder error:', err);
            }
        },
    });
})();
