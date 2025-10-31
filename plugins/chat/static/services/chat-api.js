(function registerChatAPI(namespace) {
    class ChatAPI {
        constructor(baseUrl = "/api/plugin/chat") {
            this.baseUrl = baseUrl.replace(/\/$/, "");
        }

        _query(params = {}) {
            const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
            if (!entries.length) return "";
            const esc = encodeURIComponent;
            return `?${entries.map(([k, v]) => `${esc(k)}=${esc(v)}`).join("&")}`;
        }

        async _request(path, options = {}) {
            const authToken = localStorage.getItem("yuuka-auth-token");
            const headers = {
                "Content-Type": "application/json",
                ...(options.headers || {}),
            };
            if (authToken && !headers.Authorization) {
                headers.Authorization = `Bearer ${authToken}`;
            }
            const fetchOptions = {
                credentials: "include",
                ...options,
                headers,
            };
            if (fetchOptions.body && typeof fetchOptions.body !== "string") {
                fetchOptions.body = JSON.stringify(fetchOptions.body);
            }

            const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
            const contentType = response.headers.get("Content-Type") || "";
            const payload = contentType.includes("application/json") ? await response.json() : await response.text();
            if (!response.ok) {
                const error = new Error(payload?.error || response.statusText || "Request failed");
                error.status = response.status;
                error.payload = payload;
                throw error;
            }
            return payload;
        }

        // --- Streaming helpers ---
        streamMessage(characterId, payload, { sessionId, onEvent, signal } = {}) {
            const authToken = localStorage.getItem("yuuka-auth-token");
            const headers = { "Content-Type": "application/json" };
            if (authToken) headers.Authorization = `Bearer ${authToken}`;
            const controller = signal ? null : new AbortController();
            const fetchSignal = signal || controller?.signal;
            const q = this._query({ stream: 1, session_id: sessionId });
            const url = `${this.baseUrl}/sessions/${encodeURIComponent(characterId)}/messages${q}`;
            const fetchPromise = fetch(url, {
                method: "POST",
                credentials: "include",
                headers,
                body: JSON.stringify(payload),
                signal: fetchSignal,
            });
            const done = (async () => {
                const response = await fetchPromise;
                if (!response.ok) {
                    let errorPayload;
                    try { errorPayload = await response.json(); } catch {}
                    const error = new Error(errorPayload?.error || response.statusText || "Streaming request failed");
                    error.status = response.status;
                    error.payload = errorPayload;
                    throw error;
                }
                if (!response.body) throw new Error("Streaming response body is not available in this environment.");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                const emitLines = () => {
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const data = JSON.parse(line);
                            if (onEvent) onEvent(data);
                        } catch (err) {
                            console.error("[ChatAPI] Failed to parse stream chunk", err, line);
                        }
                    }
                };
                while (true) {
                    const { value, done: readerDone } = await reader.read();
                    if (value) { buffer += decoder.decode(value, { stream: !readerDone }); emitLines(); }
                    if (readerDone) { buffer += decoder.decode(); emitLines(); break; }
                }
            })();
            return { done, cancel: () => controller?.abort() };
        }

        streamRegeneration(characterId, payload, { sessionId, onEvent, signal } = {}) {
            const authToken = localStorage.getItem("yuuka-auth-token");
            const headers = { "Content-Type": "application/json" };
            if (authToken) headers.Authorization = `Bearer ${authToken}`;
            const controller = signal ? null : new AbortController();
            const fetchSignal = signal || controller?.signal;
            const q = this._query({ stream: 1, session_id: sessionId });
            const url = `${this.baseUrl}/sessions/${encodeURIComponent(characterId)}/actions/regen${q}`;
            const fetchPromise = fetch(url, {
                method: "POST",
                credentials: "include",
                headers,
                body: JSON.stringify(payload),
                signal: fetchSignal,
            });
            const done = (async () => {
                const response = await fetchPromise;
                if (!response.ok) {
                    let errorPayload; try { errorPayload = await response.json(); } catch {}
                    const error = new Error(errorPayload?.error || response.statusText || "Streaming request failed");
                    error.status = response.status; error.payload = errorPayload; throw error;
                }
                if (!response.body) throw new Error("Streaming response body is not available in this environment.");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                const emitLines = () => {
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try { const data = JSON.parse(line); if (onEvent) onEvent(data); }
                        catch (err) { console.error("[ChatAPI] Failed to parse stream chunk", err, line); }
                    }
                };
                while (true) {
                    const { value, done: readerDone } = await reader.read();
                    if (value) { buffer += decoder.decode(value, { stream: !readerDone }); emitLines(); }
                    if (readerDone) { buffer += decoder.decode(); emitLines(); break; }
                }
            })();
            return { done, cancel: () => controller?.abort() };
        }

        // --- Definitions ---
        getCharacterCards() { return this._request("/definitions", { method: "GET" }); }
        getCharacterDefinition(characterId) { return this._request(`/definitions/${encodeURIComponent(characterId)}`, { method: "GET" }); }
        createCharacterDefinition(payload) { return this._request("/definitions", { method: "POST", body: JSON.stringify(payload) }); }
        saveCharacterDefinition(characterId, payload) { return this._request(`/definitions/${encodeURIComponent(characterId)}`, { method: "PUT", body: JSON.stringify(payload) }); }
        deleteCharacterDefinition(characterId) { return this._request(`/definitions/${encodeURIComponent(characterId)}`, { method: "DELETE" }); }

        // --- Settings ---
        getSettings() { return this._request("/settings", { method: "GET" }); }
        saveSettings(payload) { return this._request("/settings", { method: "PUT", body: JSON.stringify(payload) }); }

        // --- Models ---
        getModels(payload) {
            if (payload && Object.keys(payload).length) { return this._request("/models", { method: "POST", body: JSON.stringify(payload) }); }
            return this._request("/models", { method: "GET" });
        }

        // --- Sessions ---
        listSessions() { return this._request("/sessions", { method: "GET" }); }
        getHistory(characterId, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/history${q}`, { method: "GET" }); }
        createNewSession(characterId) { return this._request(`/sessions/${encodeURIComponent(characterId)}/new`, { method: "POST" }); }
        resetSession(characterId, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/reset${q}`, { method: "POST" }); }
        deleteSession(characterId, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}${q}`, { method: "DELETE" }); }
        createMessage(characterId, payload, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/messages${q}`, { method: "POST", body: JSON.stringify(payload) }); }
        updateMessage(characterId, messageId, payload, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/messages/${encodeURIComponent(messageId)}${q}`, { method: "PUT", body: JSON.stringify(payload) }); }
        deleteMessage(characterId, messageId, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/messages/${encodeURIComponent(messageId)}${q}`, { method: "DELETE" }); }

        // --- Actions ---
        requestRegeneration(characterId, payload, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/actions/regen${q}`, { method: "POST", body: JSON.stringify(payload) }); }
        requestSwipe(characterId, payload, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/actions/swipe${q}`, { method: "POST", body: JSON.stringify(payload) }); }
        requestContinuation(characterId, payload, sessionId) { const q = this._query({ session_id: sessionId }); return this._request(`/sessions/${encodeURIComponent(characterId)}/actions/continue${q}`, { method: "POST", body: JSON.stringify(payload) }); }

        // --- Jobs ---
        getJobStatus(jobId) { return this._request(`/jobs/${encodeURIComponent(jobId)}`, { method: "GET" }); }
    }

    namespace.ChatAPI = ChatAPI;
})(window.Yuuka.plugins.chat.services);
