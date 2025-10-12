// --- MODIFIED FILE: static/api.js ---
const api = (() => {
    const LOCAL_API_HOST = window.location.origin;

    // Hàm request nội bộ, không thay đổi
    async function _request(endpoint, options = {}) {
        const url = `${LOCAL_API_HOST}${endpoint}`;
        const authToken = localStorage.getItem('yuuka-auth-token');
        const config = {
            method: 'GET', ...options,
            headers: { 'Content-Type': 'application/json', ...options.headers },
        };
        if (authToken) config.headers['Authorization'] = `Bearer ${authToken}`;
        if (config.body && typeof config.body !== 'string') config.body = JSON.stringify(config.body);

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ description: `Request to ${url} failed with status ${response.status}` }));
                const error = new Error(errorData.description || `HTTP error ${response.status}`);
                error.status = response.status;
                throw error;
            }
            const contentType = response.headers.get("content-type");
            return contentType?.includes("application/json") ? response.json() : response.text();
        } catch (error) {
            console.error(`[API Error] Endpoint: ${endpoint}`, error);
            throw error;
        }
    }

    // --- Yuuka: Khởi tạo đối tượng API với các hàm của Lõi ---
    const coreApi = {
        _request: _request, // Expose hàm nội bộ nếu cần
        auth: {
            // Yuuka: auth rework v1.0 - Đổi tên hàm cho rõ ràng và xóa hàm không cần thiết
            generateToken: () => _request('/api/auth/token', { method: 'POST' }),
            login: (token) => _request('/api/auth/login', { method: 'POST', body: { token } }),
            logout: () => _request('/api/auth/logout', { method: 'POST' }),
        },
        server: {
            shutdown: () => _request('/api/server/shutdown', { method: 'POST' }),
            checkComfyUIStatus: (address) => _request(`/api/comfyui/status?server_address=${encodeURIComponent(address)}`),
        },
        // YUUKA: API LÕI MỚI CHO SERVICES
        generation: {
            start: (character_hash, generation_config, context = {}) => { // Yuuka: polling trigger v1.0
                const promise = _request('/api/core/generate', { method: 'POST', body: { character_hash, generation_config, context } });
                promise.then(response => {
                    // Yuuka: Khi request thành công, phát tín hiệu để script lõi bắt đầu polling
                    Yuuka.events.emit('generation:task_created_locally', response);
                });
                return promise;
            },
            getStatus: () => _request('/api/core/generate/status'),
            cancel: (task_id) => _request('/api/core/generate/cancel', { method: 'POST', body: { task_id } }),
        },
        images: {
            getAll: () => _request('/api/core/images'),
            getByCharacter: (character_hash) => _request(`/api/core/images/by_character/${character_hash}`),
            delete: (image_id) => _request(`/api/core/images/${image_id}`, { method: 'DELETE' }),
        },
        // --- API LÕI CŨ HƠN ---
        getActivePluginsUI: () => _request('/api/plugins/active'),
        getAllCharacters: () => _request('/api/characters'),
        getCharactersByHashes: (hashes) => _request('/api/characters/by_hashes', { method: 'POST', body: { hashes } }),
        getTags: () => _request('/api/tags'),
    };

    /**
     * YUUKA: Đây là hàm cốt lõi mới.
     * Nó nhận ID của một plugin và tạo ra một bộ API client hoàn chỉnh cho nó.
     * @param {string} pluginId - ID của plugin (ví dụ: 'album', 'scene')
     */
    function createPluginApiClient(pluginId) {
        if (coreApi[pluginId]) return; // Tránh tạo lại

        const baseUrl = `/api/plugin/${pluginId}`;

        coreApi[pluginId] = {
            /**
             * Gửi yêu cầu GET tới một endpoint của plugin.
             * @param {string} endpoint - (Tùy chọn) Endpoint cụ thể, ví dụ: '/characters'
             */
            get: (endpoint = '') => _request(`${baseUrl}${endpoint}`),
            
            /**
             * Gửi yêu cầu POST tới một endpoint của plugin.
             * @param {string} endpoint - Endpoint cụ thể.
             * @param {object} body - Dữ liệu cần gửi.
             */
            post: (endpoint = '', body) => _request(`${baseUrl}${endpoint}`, { method: 'POST', body }),
            
            /**
             * Gửi yêu cầu PUT tới một endpoint của plugin.
             * @param {string} endpoint - Endpoint cụ thể.
             * @param {object} body - Dữ liệu cần gửi.
             */
            put: (endpoint = '', body) => _request(`${baseUrl}${endpoint}`, { method: 'PUT', body }),
            
            /**
             * Gửi yêu cầu DELETE tới một endpoint của plugin.
             * @param {string} endpoint - Endpoint cụ thể.
             */
            delete: (endpoint = '') => _request(`${baseUrl}${endpoint}`, { method: 'DELETE' }),
        };
    }

    // Gắn hàm tạo API vào đối tượng chính để script.js có thể gọi
    coreApi.createPluginApiClient = createPluginApiClient;

    return coreApi;
})();