// Album plugin - View module: character view (State-mode helpers)
(function () {
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    Object.assign(proto, {
        _characterEnsureStateModeState() {
            try {
                if (!this.state.character) this.state.character = {};
                if (!this.state.character.state || typeof this.state.character.state !== 'object') {
                    this.state.character.state = {
                        groups: [],
                        states: [],
                        selections: {},
                        presetsByGroup: {},
                        activePresetByGroup: {},
                        activeGroupId: null,
                    };
                }
                const st = this.state.character.state;
                if (!Array.isArray(st.groups)) st.groups = [];
                if (!Array.isArray(st.states)) st.states = [];
                if (!st.selections || typeof st.selections !== 'object') st.selections = {};
                if (!st.presetsByGroup || typeof st.presetsByGroup !== 'object') st.presetsByGroup = {};
                if (!st.activePresetByGroup || typeof st.activePresetByGroup !== 'object') st.activePresetByGroup = {};
                if (typeof st.activeGroupId === 'undefined') st.activeGroupId = null;
            } catch { }
        },

        _characterIsStateModeEnabled() {
            try {
                const v = String(this.state.character?.ui?.menuMode || 'category').trim().toLowerCase();
                return v === 'state';
            } catch {
                return false;
            }
        },
    });
})();
