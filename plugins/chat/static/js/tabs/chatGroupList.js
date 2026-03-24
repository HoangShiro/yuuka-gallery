Object.assign(window.ChatComponent.prototype, {
    async _fetchGroupSessions() {
        try {
            const res = await this.api['chat'].get('/group_sessions');
            const sessions = res.sessions || [];
            // Handle both array and dict responses
            if (Array.isArray(sessions)) return sessions;
            return Object.values(sessions);
        } catch (e) {
            console.error('Failed to fetch group sessions:', e);
            return [];
        }
    },

    _renderGroupSessionCard(s) {
        // Determine avatar: use group avatar if set, otherwise try first member's avatar
        let avatarUrl = '';
        if (s.avatar) {
            avatarUrl = s.avatar;
        } else if (s.member_hashes && s.member_hashes.length > 0) {
            const firstCharHash = s.member_hashes[0];
            const firstChar = this.state.personas.characters[firstCharHash];
            avatarUrl = (firstChar && firstChar.avatar) ? firstChar.avatar : `/image/${firstCharHash}`;
        }

        // Clean last message preview
        let cleanMsg = s.last_message || '...';
        if (cleanMsg !== '...') {
            cleanMsg = cleanMsg.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '');
            cleanMsg = cleanMsg.replace(/<call_capability[^>]*>[\s\S]*?(<\/call_capability>|$)/gi, '');
            cleanMsg = cleanMsg.trim();
            if (cleanMsg.length > 60) {
                cleanMsg = cleanMsg.substring(0, 60) + '...';
            }
        }

        const el = document.createElement('div');
        el.className = 'chat-card session-card group-card';
        el.innerHTML = `
            <div class="card-avatar" style="background-image: url('${avatarUrl}')"></div>
            <div class="card-info">
                <div class="card-name">${this.escapeHTML(s.name || 'Group Chat')}</div>
                <div class="card-subtitle">${this.escapeHTML(cleanMsg)}</div>
            </div>
        `;
        el.addEventListener('click', () => {
            this.openGroupChat(s.id);
        });
        return el;
    },

    _mergeGroupSessions(characterSessions, groupSessions) {
        const merged = [...characterSessions, ...groupSessions];
        merged.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
        return merged;
    }
});
