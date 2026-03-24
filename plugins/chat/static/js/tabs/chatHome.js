Object.assign(window.ChatComponent.prototype, {
    renderHome() {
        const grid = this.container.querySelector('#grid-home');
        grid.innerHTML = '';

        // Override the existing add button click handler
        this._overrideCreateButton();

        const charsToDisplay = [];
        const addedHashes = new Set();

        const charPersonas = this.state.personas.characters || {};
        for (const [hash, p] of Object.entries(charPersonas)) {
            const info = this.state.charactersInfo[hash];
            charsToDisplay.push({
                hash: hash,
                name: p.name || (info ? info.name : hash),
                avatar: p.avatar || `/image/${hash}`,
                hasPersona: true,
                persona: p.persona || ''
            });
            addedHashes.add(hash);
        }

        for (const hash of this.state.favorites) {
            if (!addedHashes.has(hash)) {
                const info = this.state.charactersInfo[hash];
                charsToDisplay.push({
                    hash: hash,
                    name: info ? info.name : hash,
                    avatar: `/image/${hash}`,
                    hasPersona: false,
                    persona: ''
                });
                addedHashes.add(hash);
            }
        }

        if (charsToDisplay.length === 0) {
            grid.innerHTML = '<div class="empty-state">No favorite characters yet. Go to Browse to favorite some!</div>';
            return;
        }

        charsToDisplay.forEach(c => {
            const el = document.createElement('div');
            el.className = 'yuuka-home-card';

            let personaLine = '';
            if (c.hasPersona && c.persona) {
                personaLine = `<div class="card-persona">${this.escapeHTML(c.persona)}</div>`;
            }

            el.innerHTML = `
                <div class="card-avatar">${c.avatar ? `<img src="${c.avatar}" alt="${c.name}" />` : '<span class="material-symbols-outlined" style="font-size:32px;opacity:0.4;">person</span>'}</div>
                <div class="card-info">
                    <div class="card-name">${c.name}</div>
                    ${personaLine}
                </div>
            `;
            el.addEventListener('click', () => {
                if (c.hasPersona) {
                    this.openChat(c.hash);
                } else {
                    this.openCreation('characters', c.hash);
                }
            });
            grid.appendChild(el);
        });
    },

    _overrideCreateButton() {
        const btn = this.container.querySelector('#btn-create-character');
        if (!btn) return;

        // Only override once — mark the button so we don't re-bind
        if (btn.dataset.groupOverride === '1') return;

        // Replace the button with a clone to strip the original openCreation('characters') listener
        const newBtn = btn.cloneNode(true);
        btn.parentElement.replaceChild(newBtn, btn);
        newBtn.dataset.groupOverride = '1';

        // Build the inline modal (dropdown) anchored to the button
        const modal = document.createElement('div');
        modal.id = 'create-type-modal';
        modal.style.cssText = [
            'display:none',
            'position:absolute',
            'right:0',
            'top:calc(100% + 4px)',
            'background:var(--bg-secondary,#222)',
            'border:1px solid var(--border-color,#444)',
            'border-radius:8px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
            'z-index:200',
            'min-width:160px',
            'overflow:hidden'
        ].join(';');

        modal.innerHTML = `
            <div id="create-type-character" style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;">
                <span class="material-symbols-outlined" style="font-size:18px;">person</span>
                <span>Character</span>
            </div>
            <div id="create-type-group" style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border-color,#444);">
                <span class="material-symbols-outlined" style="font-size:18px;">group</span>
                <span>Group chat</span>
            </div>
        `;

        // Hover highlight for options
        modal.querySelectorAll('div').forEach(opt => {
            opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg-hover,rgba(255,255,255,0.07))');
            opt.addEventListener('mouseleave', () => opt.style.background = '');
        });

        modal.querySelector('#create-type-character').addEventListener('click', () => {
            modal.style.display = 'none';
            this.openCreation('characters');
        });

        modal.querySelector('#create-type-group').addEventListener('click', () => {
            modal.style.display = 'none';
            this.openCreation('group');
        });

        // Position the modal relative to the button's parent
        const btnParent = newBtn.parentElement;
        const originalPosition = btnParent.style.position;
        if (!originalPosition || originalPosition === 'static') {
            btnParent.style.position = 'relative';
        }
        btnParent.appendChild(modal);

        // Bind the new click handler: show/hide the modal
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = modal.style.display !== 'none';
            modal.style.display = isVisible ? 'none' : 'block';
        });

        // Close modal when clicking outside
        document.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }
});
