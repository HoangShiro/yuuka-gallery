Object.assign(window.ChatComponent.prototype, {
    // --- Memory Compression & Summarization ---

    async _triggerMemoryCompression() {
        if (!this.state.activeChatSession) return;
        const msgs = this.state.activeChatSession.messages;
        if (!msgs) return;

        let lastIndex = this.state.activeChatSession.last_summarized_index || 0;
        let currentSummary = this.state.activeChatSession.memory_summary || '';

        if (lastIndex >= msgs.length) {
            this.state.activeChatSession.last_summarized_index = msgs.length;
            return;
        }

        // Trigger if there are > 15 unsummarized messages
        const unsummarizedCount = msgs.length - lastIndex;
        if (unsummarizedCount > 15) {
            // Keep the last 4 messages as vivid short-term context, summarize the rest
            const summaryEndIndex = msgs.length - 4;
            if (summaryEndIndex <= lastIndex) return;

            const msgsToSummarize = msgs.slice(lastIndex, summaryEndIndex);
            // Convert to simple [{role, content}] format
            const flatMsgsToSummarize = this.flattenMessages ? this.flattenMessages(msgsToSummarize) : [];

            try {
                const authToken = localStorage.getItem('yuuka-auth-token');
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = `Bearer ${authToken} `;

                const res = await fetch('/api/plugin/chat/generate/summarize_memory', {
                    method: 'POST',
                    body: JSON.stringify({
                        current_summary: currentSummary,
                        new_messages: flatMsgsToSummarize,
                        model: localStorage.getItem('chat-llm-model') || undefined,
                        temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                    }),
                    headers: headers
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success') {
                        this.state.activeChatSession.memory_summary = data.summary;
                        this.state.activeChatSession.last_summarized_index = summaryEndIndex;
                        this._saveCurrentSession();
                        console.log("[Chat Memory] Memory summarization completed asynchronously.", data.summary);
                    }
                }
            } catch (err) {
                console.warn("[Chat Memory] Failed to summarize memory:", err);
            }
        }
    },

    async _triggerGroupMemoryCompression() {
        const groupSession = this.state.activeChatGroupSession;
        if (!groupSession) return;
        const msgs = groupSession.messages;
        if (!msgs) return;

        let lastIndex = groupSession.last_summarized_index || 0;
        let currentSummary = groupSession.memory_summary || '';

        if (lastIndex >= msgs.length) {
            groupSession.last_summarized_index = msgs.length;
            return;
        }

        const unsummarizedCount = msgs.length - lastIndex;
        if (unsummarizedCount > 15) {
            const summaryEndIndex = msgs.length - 4;
            if (summaryEndIndex <= lastIndex) return;

            const msgsToSummarize = msgs.slice(lastIndex, summaryEndIndex);
            const flatMsgsToSummarize = this.flattenMessages ? this.flattenMessages(msgsToSummarize) : [];

            try {
                const authToken = localStorage.getItem('yuuka-auth-token');
                const headers = { 'Content-Type': 'application/json' };
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

                const res = await fetch('/api/plugin/chat/generate/summarize_memory', {
                    method: 'POST',
                    body: JSON.stringify({
                        current_summary: currentSummary,
                        new_messages: flatMsgsToSummarize,
                        model: localStorage.getItem('chat-llm-model') || undefined,
                        temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                    }),
                    headers
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'success') {
                        groupSession.memory_summary = data.summary;
                        groupSession.last_summarized_index = summaryEndIndex;
                        await this._saveGroupSession();
                        console.log('[Group Memory] Memory summarization completed asynchronously.', data.summary);
                    }
                }
            } catch (err) {
                console.warn('[Group Memory] Failed to summarize memory:', err);
            }
        }
    },

    async _saveMemoryAsScene() {
        const session = this.state.activeChatSession;
        if (!session || !session.memory_summary?.trim()) {
            alert('No memory summary to save.');
            return;
        }

        const name = session.memory_name?.trim() || 'Memory Summary';
        const payload = { name, context: session.memory_summary.trim() };

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/scenarios/scenes', {
                method: 'POST',
                body: JSON.stringify(payload),
                headers
            });
            const data = await res.json();
            if (data.status === 'success') {
                // Register in local state so it's immediately available
                if (!this.state.scenarios) this.state.scenarios = { scenes: {}, rules: {} };
                this.state.scenarios.scenes[data.data.id] = data.data;
                alert(`Scene "${name}" saved.`);
            } else {
                alert('Failed to save scene.');
            }
        } catch (e) {
            console.error('[Chat Memory] Save as scene failed:', e);
            alert('Error saving scene: ' + e.message);
        }
    },

    _syncMemoryUI() {
        const session = this.state.activeChatSession;
        const textarea = this.container.querySelector('#memory-summary-textarea');
        const nameInput = this.container.querySelector('#memory-name-input');
        if (!session) return;

        if (textarea) {
            textarea.value = session.memory_summary || '';
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }
        if (nameInput) {
            nameInput.value = session.memory_name || '';
        }
    },

    async _runMemorySummarize() {
        const session = this.state.activeChatSession;
        if (!session) return;

        const textarea = this.container.querySelector('#memory-summary-textarea');
        const btn = this.container.querySelector('#btn-memory-summarize');
        if (!textarea || !btn) return;

        const msgs = session.messages;
        if (!msgs || msgs.length < 2) {
            alert('Need at least 2 messages to summarize.');
            return;
        }

        // For manual summarize: include all messages
        let currentSummary = session.memory_summary || '';
        let lastIndex = session.last_summarized_index || 0;
        const summaryEndIndex = msgs.length;

        // If everything is already summarized, re-summarize from scratch
        if (lastIndex >= summaryEndIndex) {
            lastIndex = 0;
            currentSummary = '';
        }

        const msgsToSummarize = msgs.slice(lastIndex, summaryEndIndex);
        const flatMsgs = this.flattenMessages ? this.flattenMessages(msgsToSummarize) : [];
        if (flatMsgs.length === 0) {
            alert('No messages to summarize.');
            return;
        }

        // Setup AbortController
        const controller = new AbortController();
        this._memorySummarizeAbort = controller;

        // UI: switch to streaming mode
        btn.textContent = 'Cancel';
        textarea.readOnly = true;
        textarea.value = '';
        textarea.style.height = 'auto';

        try {
            const authToken = localStorage.getItem('yuuka-auth-token');
            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

            const res = await fetch('/api/plugin/chat/generate/summarize_memory_stream', {
                method: 'POST',
                body: JSON.stringify({
                    current_summary: currentSummary,
                    new_messages: flatMsgs,
                    model: localStorage.getItem('chat-llm-model') || undefined,
                    temperature: parseFloat(localStorage.getItem('chat-llm-temperature')) || -1
                }),
                headers,
                signal: controller.signal
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                fullText += chunk;
                textarea.value = fullText;
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
                textarea.scrollTop = textarea.scrollHeight;
            }

            // Success — update session, parse NAME: prefix
            let fullResult = fullText.trim();
            let parsedName = '';
            const nameMatch = fullResult.match(/^NAME:\s*(.+)\n([\s\S]*)/);
            if (nameMatch) {
                parsedName = nameMatch[1].trim();
                fullResult = nameMatch[2].trim();
            }

            session.memory_summary = fullResult;
            session.last_summarized_index = summaryEndIndex;
            if (parsedName) {
                session.memory_name = parsedName;
                const nameInput = this.container.querySelector('#memory-name-input');
                if (nameInput) nameInput.value = parsedName;
            }
            // Update textarea to show clean summary without NAME line
            textarea.value = fullResult;
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
            this._saveCurrentSession();
            console.log('[Chat Memory] Streaming summarization completed.');
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[Chat Memory] Summarization cancelled by user.');
                // Keep whatever was streamed so far
                if (textarea.value.trim()) {
                    session.memory_summary = textarea.value.trim();
                    this._saveCurrentSession();
                }
            } else {
                console.warn('[Chat Memory] Streaming summarization failed:', err);
                alert('Summarization failed: ' + err.message);
            }
        } finally {
            this._memorySummarizeAbort = null;
            btn.textContent = 'Summarize';
            textarea.readOnly = false;
        }
    }
});
