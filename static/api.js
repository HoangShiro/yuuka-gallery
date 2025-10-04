// --- MODIFIED FILE: static/api.js ---
const api = (() => {
    const LOCAL_API_HOST = window.location.origin;
    const BOT_API_HOST = `http://${window.location.hostname}:5500`;
    
    let currentApiMode = 'comfyui'; // Yuuka: Mặc định là ComfyUI

    async function _request(endpoint, options = {}, apiType = 'local') {
        let host;
        switch (apiType) {
            case 'bot':
                host = BOT_API_HOST;
                break;
            case 'comfyui_proxy':
            case 'local':
            default:
                host = LOCAL_API_HOST;
                break;
        }
        const url = `${host}${endpoint}`;

        const config = {
            method: 'GET',
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        };

        if (config.apiKey) {
            config.headers['Authorization'] = `Bearer ${config.apiKey}`;
            delete config.apiKey;
        }
        
        if (config.body && typeof config.body !== 'string') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ 
                    error: "Unknown server error", 
                    description: `Request to ${url} failed with status ${response.status}` 
                }));
                const error = new Error(errorData.error || errorData.description || `HTTP error ${response.status}`);
                error.status = response.status;
                throw error;
            }
            
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return response.json();
            }
            return response.text();
        } catch (error) {
            throw error;
        }
    }

    return {
        initializeApiMode: async (apiKey) => {
            console.log("Initializing API mode with new priority...");

            // Yuuka: Bước 1 - Luôn kiểm tra ComfyUI trước tiên.
            let comfyInfo, comfyError;
            try {
                comfyInfo = await _request('/api/comfyui/info', { apiKey }, 'comfyui_proxy');
                console.log("✅ ComfyUI proxy is responsive.");
            } catch (e) {
                console.warn("ComfyUI proxy failed:", e.message);
                comfyError = e;
            }

            // Yuuka: Bước 2 - Kiểm tra Bot API, vì nó được ưu tiên hơn nếu có sẵn.
            try {
                const botInfo = await _request('/info', { apiKey }, 'bot');
                currentApiMode = 'bot';
                console.log("✅ Bot API is responsive. Mode set to 'bot' (highest priority).");
                return { mode: 'bot', data: botInfo, message: 'Kết nối tới Bot API thành công.' };
            } catch (botError) {
                console.log("Bot API not available. Checking ComfyUI fallback...");
                // Yuuka: Bước 3 - Bot API thất bại, quay lại kết quả của ComfyUI.
                if (comfyInfo) {
                    currentApiMode = 'comfyui';
                    console.log("✅ Using ComfyUI as fallback. Mode set to 'comfyui'.");
                    return { mode: 'comfyui', data: comfyInfo, message: 'Bot API không phản hồi. Đã chuyển sang chế độ ComfyUI trực tiếp.' };
                } else {
                    // Yuuka: Bước 4 - Cả hai đều thất bại.
                    console.error("ComfyUI also failed:", comfyError.message);
                    throw new Error("Không thể kết nối tới cả Bot API và ComfyUI. Vui lòng kiểm tra lại cả hai dịch vụ.");
                }
            }
        },
        getCurrentApiMode: () => currentApiMode,

        // --- API của Gallery ---
        getLocalLists: () => _request('/api/lists', {}, 'local'),
        updateLocalLists: (data) => _request('/api/lists', { method: 'POST', body: data }, 'local'),
        getAllCharacters: () => _request('/api/characters?limit=100000', {}, 'local'),
        getAlbumCharacters: (apiKey) => _request('/api/album/characters', { apiKey }, 'local'),
        getCharactersByHashes: (hashes) => _request('/api/characters/by_hashes', { method: 'POST', body: { hashes } }, 'local'),
        getCharacterAlbum: (apiKey, characterHash) => _request(`/api/album/${characterHash}`, { apiKey }, 'local'),
        addImageToAlbum: (apiKey, characterHash, imageData) => _request(`/api/album/${characterHash}`, { method: 'POST', body: imageData, apiKey }, 'local'),
        deleteImageFromAlbum: (apiKey, imageId) => _request(`/api/album/image/${imageId}`, { method: 'DELETE', apiKey }, 'local'),
        getTags: () => _request('/api/tags', {}, 'local'),
        
        // --- API của Scene Tab ---
        getScenes: (apiKey) => _request('/api/scenes', { apiKey }, 'local'),
        saveScenes: (apiKey, scenes) => _request('/api/scenes', { method: 'POST', body: scenes, apiKey }, 'local'),
        getTagGroups: () => _request('/api/tag_groups', {}, 'local'),
        createTagGroup: (apiKey, groupData) => _request('/api/tag_groups', { method: 'POST', body: groupData, apiKey }, 'local'),
        updateTagGroup: (apiKey, groupId, groupData) => _request(`/api/tag_groups/${groupId}`, { method: 'PUT', body: groupData, apiKey }, 'local'),
        deleteTagGroup: (apiKey, groupId) => _request(`/api/tag_groups/${groupId}`, { method: 'DELETE', apiKey }, 'local'),
        startSceneGeneration: (apiKey, job) => _request('/api/scenes/generate', { method: 'POST', body: job, apiKey }, 'local'),
        cancelSceneGeneration: (apiKey) => _request('/api/scenes/cancel', { method: 'POST', apiKey }, 'local'),
        getSceneGenerationStatus: (apiKey) => _request('/api/scenes/status', { apiKey }, 'local'),
        
        // --- API của Bot/ComfyUI ---
        getBotInfo: (apiKey, contextData = {}) => {
            let endpoint;
            if (currentApiMode === 'bot') {
                endpoint = contextData.channelId ? `/info?channel_id=${contextData.channelId}` : '/info';
                return _request(endpoint, { apiKey }, 'bot');
            } else {
                endpoint = contextData.characterHash ? `/api/comfyui/info?character_hash=${contextData.characterHash}` : '/api/comfyui/info';
                return _request(endpoint, { apiKey }, 'comfyui_proxy');
            }
        },
        generateArt: (apiKey, payload) => {
            if (currentApiMode === 'bot') {
                return _request('/genart_sync', { method: 'POST', body: payload, apiKey }, 'bot');
            } else {
                return _request('/api/comfyui/genart_sync', { method: 'POST', body: payload, apiKey }, 'comfyui_proxy');
            }
        },
        saveComfyUIConfig: (apiKey, configData) => {
             if (currentApiMode !== 'comfyui') return Promise.reject(new Error("Chỉ có thể lưu config ở chế độ ComfyUI."));
             return _request('/api/comfyui/config', { method: 'POST', body: configData, apiKey }, 'comfyui_proxy');
        },
        createChannel: (apiKey, serverId, channelData) => {
            if (currentApiMode !== 'bot') return Promise.reject(new Error("Tạo channel không được hỗ trợ trong chế độ ComfyUI trực tiếp."));
            return _request(`/guilds/${serverId}/channels`, { method: 'POST', body: channelData, apiKey }, 'bot');
        },
        updateChannelConfig: (apiKey, channelId, configUpdates) => {
            if (currentApiMode !== 'bot') return Promise.reject(new Error("Cập nhật config không được hỗ trợ trong chế độ ComfyUI trực tiếp."));
            return _request(`/config/${channelId}`, { method: 'PATCH', body: configUpdates, apiKey }, 'bot');
        },
    };
})();