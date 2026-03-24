Object.assign(window.ChatComponent.prototype, {
    async renderChatList() {
        const grid = this.container.querySelector('#grid-chat_list');
        grid.innerHTML = '<div class="loader-text">Loading sessions...</div>';

        try {
            // /sessions already includes group sessions merged in
            const charRes = await this.api['chat'].get('/sessions');
            const sessions = charRes.sessions || [];

            grid.innerHTML = '';
            if (sessions.length === 0) {
                grid.innerHTML = '<div class="empty-state">No active chats. Start one from Home!</div>';
                return;
            }

            sessions.forEach(s => {
                if (s.is_group) {
                    grid.appendChild(this._renderGroupSessionCard(s));
                    return;
                }

                const charPersona = this.state.personas.characters[s.char_hash];
                const info = this.state.charactersInfo[s.char_hash];
                const charName = charPersona ? charPersona.name : (info ? info.name : s.char_hash);
                const charAvatar = (charPersona && charPersona.avatar) ? charPersona.avatar : `/image/${s.char_hash}`;

                let cleanMsg = s.last_message || "...";
                if (cleanMsg !== "...") {
                    cleanMsg = cleanMsg.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '');
                    cleanMsg = cleanMsg.replace(/<call_capability[^>]*>[\s\S]*?(<\/call_capability>|$)/gi, '');
                    cleanMsg = cleanMsg.trim();
                    if (cleanMsg.length > 60) {
                        cleanMsg = cleanMsg.substring(0, 60) + "...";
                    }
                }

                const el = document.createElement('div');
                el.className = 'chat-card session-card';
                el.innerHTML = `
                    <div class="card-avatar" style="background-image: url('${charAvatar}')"></div>
                    <div class="card-info">
                        <div class="card-name">${charName}</div>
                        <div class="card-subtitle">${this.escapeHTML(cleanMsg)}</div>
                    </div>
                `;
                el.addEventListener('click', () => {
                    this.openChat(s.char_hash);
                });
                grid.appendChild(el);
            });
        } catch (e) {
            console.error(e);
            grid.innerHTML = '<div class="empty-state">Error loading sessions.</div>';
        }
    }
});
