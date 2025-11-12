/**
 * lora_search.js (embedded for civitai-img-search)
 * Module chứa logic để tương tác với Civitai REST API.
 * Các hàm trả về Promise chứa dữ liệu hoặc throw Error khi thất bại.
 */

const CIVITAI_API_BASE = "https://civitai.com/api/v1";

async function searchModelsByName(searchTerm, modelType = 'LORA') {
    if (!searchTerm) {
        throw new Error("Tên tìm kiếm không được để trống.");
    }
    const url = new URL(`${CIVITAI_API_BASE}/models`);
    url.searchParams.append('query', searchTerm);
    url.searchParams.append('types', modelType);
    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Lỗi API [${response.status}]: ${errorText}`);
        }
        const data = await response.json();
        return data.items || [];
    } catch (error) {
        throw error;
    }
}

async function getModelById(modelId) {
    if (!modelId) {
        throw new Error("Model ID không được để trống.");
    }
    const url = `${CIVITAI_API_BASE}/models/${modelId}`;
    try {
        const response = await fetch(url);
        if (response.status === 404) {
            throw new Error(`Không tìm thấy model với ID ${modelId}.`);
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Lỗi API [${response.status}]: ${errorText}`);
        }
        return await response.json();
    } catch (error) {
        throw error;
    }
}

async function getModelByUrl(modelUrl) {
    if (!modelUrl) {
        throw new Error("URL không được để trống.");
    }
    const match = modelUrl.match(/\/models\/(\d+)/);
    if (match && match[1]) {
        const modelId = parseInt(match[1], 10);
        return await getModelById(modelId);
    } else {
        throw new Error("URL không hợp lệ hoặc không tìm thấy ID model trong URL.");
    }
}

// --- HÀM TÌM ẢNH (ĐÚNG THEO TÀI LIỆU API) ---
// /api/v1/images KHÔNG hỗ trợ tham số 'query'. Để tìm theo từ khóa, cần:
// 1) Tìm models qua /api/v1/models?query=...
// 2) Lấy ảnh bằng /api/v1/images?modelId=...
// Hợp nhất kết quả rồi trả về.
async function searchImagesByQuery({
    query,
    limit = 20,
    page = 1, // Không dùng khi gộp nhiều model; chỉ giữ cho chữ ký ổn định
    sort = 'Newest',
    period = 'AllTime',
    nsfw = undefined,
    mode = undefined,
    modelsPerQuery = 5, // Số model tối đa dùng để gom ảnh
}) {
    if (!query) {
        throw new Error("Từ khóa tìm kiếm (query) không được để trống.");
    }

    // Ánh xạ sort hợp lệ cho Images endpoint
    const validImageSorts = new Set(['Newest', 'Most Reactions', 'Most Comments']);
    const imageSort = validImageSorts.has(sort) ? sort : 'Newest';

    // Map tri-state mode to nsfw if provided by caller
    if (mode === 'sfw') nsfw = false;
    else if (mode === 'nsfw') nsfw = true;

    // Xử lý tham số nsfw: nếu false -> nsfw=false; nếu true -> nsfw=true; nếu là cấp độ -> truyền thẳng; nếu undefined -> bỏ qua để lấy tất cả
    const appendNsfwParam = (u) => {
        if (typeof nsfw === 'string') {
            const lv = nsfw.trim();
            if (['None', 'Soft', 'Mature', 'X'].includes(lv)) u.searchParams.append('nsfw', lv);
        } else if (nsfw === false) {
            u.searchParams.append('nsfw', 'false');
        } else if (nsfw === true) {
            u.searchParams.append('nsfw', 'true');
        }
    };

    // 1) Tìm models theo query
    let models = [];
    try {
        models = await searchModelsByName(query);
    } catch (_) {
        models = [];
    }

    // Giới hạn số model để gọi ảnh
    const selectedModels = models.slice(0, Math.max(1, modelsPerQuery));

    // Tính số ảnh mỗi model để gần đạt 'limit'
    const perModelLimit = Math.max(1, Math.ceil(limit / Math.max(1, selectedModels.length)));

    const results = [];
    // 2) Gọi ảnh theo từng modelId
    await Promise.all(selectedModels.map(async (m) => {
        const u = new URL(`${CIVITAI_API_BASE}/images`);
        u.searchParams.append('modelId', String(m.id));
        u.searchParams.append('limit', String(perModelLimit));
        u.searchParams.append('period', period);
        u.searchParams.append('sort', imageSort);
        appendNsfwParam(u);
        try {
            const resp = await fetch(u.toString());
            if (!resp.ok) return;
            const data = await resp.json();
            if (Array.isArray(data?.items)) {
                // Gắn tên model vào từng ảnh để UI hiển thị đúng
                for (const it of data.items) {
                    if (it && !it.modelName) {
                        it.modelName = m.name || m?.creator?.username || `Model ${m.id}`;
                    }
                    if (it && !it.modelId) {
                        it.modelId = m.id;
                    }
                }
                results.push(...data.items);
            }
        } catch (_) { /* ignore single model failure */ }
    }));

    // 3) Nếu vẫn thiếu và có thể là username, thử thêm ảnh theo username
    if (results.length < limit && query && query.length <= 32) {
        const u = new URL(`${CIVITAI_API_BASE}/images`);
        u.searchParams.append('username', query);
        u.searchParams.append('limit', String(Math.max(1, limit - results.length)));
        u.searchParams.append('period', period);
        u.searchParams.append('sort', imageSort);
        appendNsfwParam(u);
        try {
            const resp = await fetch(u.toString());
            if (resp.ok) {
                const data = await resp.json();
                if (Array.isArray(data?.items)) {
                    for (const it of data.items) {
                        if (it && !it.modelName) {
                            // Không có model tham chiếu rõ -> dùng username hoặc 'User Gallery'
                            it.modelName = it.username || 'User Gallery';
                        }
                    }
                    results.push(...data.items);
                }
            }
        } catch (_) { /* ignore */ }
    }

    // Loại trùng theo url/id
    const seen = new Set();
    const deduped = [];
    for (const it of results) {
        const k = it?.id ?? it?.url;
        if (!k || seen.has(k)) continue;
        seen.add(k);
        deduped.push(it);
        if (deduped.length >= limit) break;
    }
    return deduped;
}

// --- ĐÃ LOẠI BỎ ---
// Hàm rankByRelevancy đã được xóa vì nó không cần thiết và gây ra lỗi.


// --- Phiên tìm kiếm dạng phiên (session) cho infinite scroll ---
function mapModeToNsfw(mode) {
    if (mode === 'sfw') return false;
    if (mode === 'nsfw') return true;
    return undefined;
}

async function createImageSearchSession({
    query,
    sort = 'Newest',
    period = 'AllTime',
    mode = undefined,
    modelsPerQuery = 12,
    perModelLimit = 24,
}) {
    if (!query) throw new Error('query is required');
    const nsfw = mapModeToNsfw(mode);

    // Prepare model list first
    let models = [];
    try { models = await searchModelsByName(query); } catch { models = []; }
    const modelList = models
        .slice(0, Math.max(1, modelsPerQuery))
        .map(m => ({ id: m.id, name: m.name || m?.creator?.username || `Model ${m.id}` }));

    const seen = new Set();
    let modelIdx = 0;
    let usernameTried = false;
    let nextPageUrl = null;

    const appendNsfwParam = (u) => {
        if (typeof nsfw === 'string') {
            const lv = nsfw.trim();
            if (['None', 'Soft', 'Mature', 'X'].includes(lv)) u.searchParams.append('nsfw', lv);
        } else if (nsfw === false) {
            u.searchParams.append('nsfw', 'false');
        } else if (nsfw === true) {
            u.searchParams.append('nsfw', 'true');
        }
    };

    async function fetchModelImages(model) {
        const u = new URL(`${CIVITAI_API_BASE}/images`);
        u.searchParams.append('modelId', String(model.id));
        u.searchParams.append('limit', String(perModelLimit));
        u.searchParams.append('period', period);
        // Valid sorts for images endpoint
        const validImageSorts = new Set(['Newest', 'Most Reactions', 'Most Comments']);
        u.searchParams.append('sort', validImageSorts.has(sort) ? sort : 'Newest');
        appendNsfwParam(u);
        const resp = await fetch(u.toString());
        if (!resp.ok) return [];
        const data = await resp.json();
        const arr = Array.isArray(data?.items) ? data.items : [];
        for (const it of arr) {
            if (it && !it.modelName) it.modelName = model.name;
            if (it && !it.modelId) it.modelId = model.id;
        }
        return arr;
    }

    async function fetchUsernameBatch(url) {
        const resp = await fetch(url);
        if (!resp.ok) return { items: [], nextPage: null };
        const data = await resp.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const nextPage = data?.metadata?.nextPage || null;
        return { items, nextPage };
    }

    async function next() {
        // First consume model galleries
        while (modelIdx < modelList.length) {
            const model = modelList[modelIdx++];
            try {
                const items = await fetchModelImages(model);
                const out = [];
                for (const it of items) {
                    const key = it?.id ?? it?.url;
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    out.push(it);
                }
                if (out.length) return { items: out, done: false };
            } catch { /* skip this model */ }
        }

        // Then try username flow with cursor
        if (!usernameTried) {
            usernameTried = true;
            const u = new URL(`${CIVITAI_API_BASE}/images`);
            u.searchParams.append('username', query);
            u.searchParams.append('limit', String(perModelLimit));
            u.searchParams.append('period', period);
            const validImageSorts = new Set(['Newest', 'Most Reactions', 'Most Comments']);
            u.searchParams.append('sort', validImageSorts.has(sort) ? sort : 'Newest');
            appendNsfwParam(u);
            const { items, nextPage } = await fetchUsernameBatch(u.toString());
            nextPageUrl = nextPage;
            const out = [];
            for (const it of items) {
                const key = it?.id ?? it?.url;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                if (it && !it.modelName) it.modelName = it.username || 'User Gallery';
                out.push(it);
            }
            if (out.length) return { items: out, done: false };
        } else if (nextPageUrl) {
            const { items, nextPage } = await fetchUsernameBatch(nextPageUrl);
            nextPageUrl = nextPage;
            const out = [];
            for (const it of items) {
                const key = it?.id ?? it?.url;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                if (it && !it.modelName) it.modelName = it.username || 'User Gallery';
                out.push(it);
            }
            if (out.length) return { items: out, done: false };
        }

        return { items: [], done: true };
    }

    return { next };
}


// --- Phần code expose ra global không thay đổi ---
(function exposeToGlobal() {
    try {
        const ensureNs = () => {
            window.Yuuka = window.Yuuka || { components: {} };
            window.Yuuka.loraSearch = window.Yuuka.loraSearch || {};
        };
        ensureNs();

        window.Yuuka.loraSearch.searchModelsRaw = async function(query, modelType = 'LORA') {
            const q = (query || '').trim();
            if (!q) return [];
            try {
                return await searchModelsByName(q, modelType);
            } catch (_) {
                return [];
            }
        };

        window.Yuuka.loraSearch.searchModelsByName = searchModelsByName;
        window.Yuuka.loraSearch.getModelById = getModelById;
        window.Yuuka.loraSearch.getModelByUrl = getModelByUrl;
        window.Yuuka.loraSearch.searchImagesByQuery = searchImagesByQuery;
        window.Yuuka.loraSearch.createImageSearchSession = createImageSearchSession;
    } catch (err) { /* no-op */ }
})();