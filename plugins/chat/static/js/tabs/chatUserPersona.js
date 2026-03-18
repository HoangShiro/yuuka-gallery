Object.assign(window.ChatComponent.prototype, {
    renderUserPersona() {
        const grid = this.container.querySelector('#grid-user_persona');
        grid.innerHTML = '';

        const userPersonas = Object.values(this.state.personas.users || {});

        if (userPersonas.length === 0) {
            grid.innerHTML = '<div class="empty-state">No user personas exist. Create one below!</div>';
        }

        userPersonas.forEach(p => {
            const isActive = this.state.activeUserPersonaId === p.id;
            const el = document.createElement('div');
            el.className = `chat-card user-persona-card ${isActive ? 'active' : ''}`;
            el.innerHTML = `
                <div class="card-avatar" style="background-image: url('${p.avatar || ''}')">
                    ${!p.avatar ? '<span class="material-symbols-outlined">person</span>' : ''}
                </div>
                <div class="card-info">
                    <div class="card-name">${p.name}</div>
                </div>
                <div class="card-actions">
                    <button class="icon-btn edit-btn" title="Edit"><span class="material-symbols-outlined">edit</span></button>
                    ${isActive ? '<span class="material-symbols-outlined text-success">check_circle</span>' : ''}
                </div>
            `;

            el.addEventListener('click', (e) => {
                if (!e.target.closest('.edit-btn')) {
                    this.state.activeUserPersonaId = p.id;
                    this.renderUserPersona();
                }
            });

            el.querySelector('.edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openCreation('users', p.id);
            });

            grid.appendChild(el);
        });
    }
});
