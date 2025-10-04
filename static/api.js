// --- MODIFIED FILE: static/api.js ---
const api = (() => {
    const LOCAL_API_HOST = window.location.origin;

    async function _request(endpoint, options = {}) {
        const url = `${LOCAL_API_HOST}${endpoint}`;
        const authToken = localStorage.getItem('yuuka-auth-token');

        const config = {
            method: 'GET',
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        };

        if (authToken) {
            config.headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        if (config.body && typeof config.body !== 'string') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ 
                    description: `Request to ${url} failed with status ${response.status}` 
                }));
                const error = new Error(errorData.description || `HTTP error ${response.status}`);
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
        // --- API xác thực ---
        checkTokenForIP: () => _request('/api/auth/token'),
        generateTokenForIP: () => _request('/api/auth/token', { method: 'POST' }),

        // --- API của Gallery ---
        getLocalLists: () => _request('/api/lists'),
        updateLocalLists: (data) => _request('/api/lists', { method: 'POST', body: data }),
        getAllCharacters: () => _request('/api/characters?limit=100000'),
        getAlbumCharacters: () => _request('/api/album/characters'),
        getCharactersByHashes: (hashes) => _request('/api/characters/by_hashes', { method: 'POST', body: { hashes } }),
        getCharacterAlbum: (characterHash) => _request(`/api/album/${characterHash}`),
        addImageToAlbum: (characterHash, imageData) => _request(`/api/album/${characterHash}`, { method: 'POST', body: imageData }),
        deleteImageFromAlbum: (imageId) => _request(`/api/album/image/${imageId}`, { method: 'DELETE' }),
        getTags: () => _request('/api/tags'),
        
        // --- API của Scene Tab ---
        getScenes: () => _request('/api/scenes'),
        saveScenes: (scenes) => _request('/api/scenes', { method: 'POST', body: scenes }),
        getTagGroups: () => _request('/api/tag_groups'),
        createTagGroup: (groupData) => _request('/api/tag_groups', { method: 'POST', body: groupData }),
        updateTagGroup: (groupId, groupData) => _request(`/api/tag_groups/${groupId}`, { method: 'PUT', body: groupData }),
        deleteTagGroup: (groupId) => _request(`/api/tag_groups/${groupId}`, { method: 'DELETE' }),
        startSceneGeneration: (job) => _request('/api/scenes/generate', { method: 'POST', body: job }),
        cancelSceneGeneration: () => _request('/api/scenes/cancel', { method: 'POST' }),
        getSceneGenerationStatus: () => _request('/api/scenes/status'),
        
        // --- API của ComfyUI ---
        checkComfyUIStatus: (serverAddress) => _request(`/api/comfyui/status?server_address=${encodeURIComponent(serverAddress)}`),
        getGenerationInfo: (characterHash = null, serverAddress = null) => {
            let endpoint = '/api/comfyui/info';
            const params = new URLSearchParams();
            if (characterHash) params.append('character_hash', characterHash);
            if (serverAddress) params.append('server_address', serverAddress);
            const queryString = params.toString();
            if (queryString) endpoint += `?${queryString}`;
            return _request(endpoint);
        },
        generateArt: (payload) => _request('/api/comfyui/genart_sync', { method: 'POST', body: payload }),
        saveComfyUIConfig: (configData) => _request('/api/comfyui/config', { method: 'POST', body: configData }),
    };
})();