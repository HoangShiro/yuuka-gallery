(function () {
    // Module: Capabilities instance binding + DOM selection publishing
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    // Bind the current AlbumComponent instance into the capability's invoke handler
    proto._attachInstanceToCapability = function () {
        const caps = window.Yuuka?.services?.capabilities;
        if (!caps) return;
        try {
            // Attach this AlbumComponent instance to all relevant Album capabilities
            const self = this;
            const NEEDS_INSTANCE = new Set([
                'image.generate',
                'image.hires_upscale',
                'album.open_or_create',
                'album.open_settings',
                'album.open_image',
                'album.apply_lora',
                'album.clear_lora',
                'album.refresh',
                'album.get_context',
                'album.find_context_by_name',
                'album.set_lora_tag_groups',
                'album.save_settings',
            ]);

            NEEDS_INSTANCE.forEach(id => {
                const def = caps.get(id);
                if (!def || typeof def.invoke !== 'function') return;

                const originalInvoke = def.invoke;
                def.invoke = async (args = {}, ctx = {}) => {
                    if (!self) {
                        throw new Error(`Album capability '${id}' requires an active Album tab. Please open the Album plugin first.`);
                    }
                    return originalInvoke.call(self, args, ctx);
                };
            });
        } catch (err) {
            console.warn('[Album] Failed to attach instance to capabilities:', err);
        }
    };

    // Publish current selection to DOM for cross-plugin discovery
    proto._syncDOMSelection = function () {
        try {
            if (!this.container) return;
            if ((this.state.viewMode === 'album' || this.state.viewMode === 'character') && this.state.selectedCharacter?.hash) {
                this.container.setAttribute('data-character-hash', this.state.selectedCharacter.hash);
                this.container.setAttribute('data-character-name', this.state.selectedCharacter.name || '');
            } else {
                this.container.removeAttribute('data-character-hash');
                this.container.removeAttribute('data-character-name');
            }
        } catch (e) {
            console.warn('[Album] _syncDOMSelection failed:', e);
        }
    };
})();
