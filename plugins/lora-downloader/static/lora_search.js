/**
 * lora_search.js
 * Module chứa logic để tương tác với Civitai REST API.
 * Các hàm trả về Promise chứa dữ liệu hoặc throw Error khi thất bại.
 */

const CIVITAI_API_BASE = "https://civitai.com/api/v1";

/**
 * Tìm kiếm các model trên Civitai theo tên và loại.
 * @param {string} searchTerm - Tên model bạn muốn tìm.
 * @param {string} modelType - Loại model ('LORA', 'Checkpoint', etc.). Mặc định là 'LORA'.
 * @returns {Promise<Array<object>>} - Một Promise sẽ resolve với một mảng các đối tượng model.
 * @throws {Error} - Ném ra lỗi nếu request thất bại.
 */
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

/**
 * Lấy thông tin một model cụ thể từ ID của nó.
 * @param {number|string} modelId - ID của model trên Civitai.
 * @returns {Promise<object>} - Một Promise sẽ resolve với đối tượng model chi tiết.
 * @throws {Error} - Ném ra lỗi nếu không tìm thấy model hoặc request thất bại.
 */
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

/**
 * Lấy thông tin model từ URL đầy đủ trên Civitai.
 * @param {string} modelUrl - URL của model (ví dụ: https://civitai.com/models/12345/...).
 * @returns {Promise<object>} - Một Promise sẽ resolve với đối tượng model chi tiết.
 * @throws {Error} - Ném ra lỗi nếu URL không hợp lệ hoặc không tìm thấy model.
 */
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

// --- HÀM MỚI ---

/**
 * Tìm kiếm hình ảnh trên Civitai dựa trên một truy vấn (tên, prompt, tag...).
 * @param {object} options - Đối tượng chứa các tùy chọn tìm kiếm.
 * @param {string} options.query - Từ khóa tìm kiếm.
 * @param {number} [options.limit=20] - Số lượng hình ảnh tối đa trên mỗi trang (tối đa 200).
 * @param {number} [options.page=1] - Số trang kết quả muốn lấy.
 * @param {'Newest' | 'Most Reactions' | 'Most Comments' | 'Most Buzz' | 'Most Likes'} [options.sort='Newest'] - Tiêu chí sắp xếp.
 * @param {'AllTime' | 'Year' | 'Month' | 'Week' | 'Day'} [options.period='AllTime'] - Khoảng thời gian áp dụng cho sắp xếp.
 * @param {boolean} [options.nsfw=true] - `true` để bao gồm kết quả NSFW.
 * @returns {Promise<Array<object>>} - Một Promise sẽ resolve với một mảng các đối tượng hình ảnh.
 * @throws {Error} - Ném ra lỗi nếu request thất bại.
 */
async function searchImagesByQuery({
    query,
    limit = 20,
    page = 1,
    sort = 'Newest',
    period = 'AllTime',
    nsfw = true
}) {
    if (!query) {
        throw new Error("Từ khóa tìm kiếm (query) không được để trống.");
    }

    const url = new URL(`${CIVITAI_API_BASE}/images`);
    url.searchParams.append('query', query);
    url.searchParams.append('limit', String(limit));
    url.searchParams.append('page', String(page));
    url.searchParams.append('sort', sort);
    url.searchParams.append('period', period);
    url.searchParams.append('nsfw', String(nsfw));

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

// --- Helper: expose functions to global namespace for backward compatibility and raw search reuse ---
(function exposeToGlobal() {
    try {
        const ensureNs = () => {
            window.Yuuka = window.Yuuka || { components: {} };
            window.Yuuka.loraSearch = window.Yuuka.loraSearch || {};
        };
        ensureNs();

        // Preserve existing helper used by other components (returns raw API items)
        window.Yuuka.loraSearch.searchModelsRaw = async function(query, modelType = 'LORA') {
            const q = (query || '').trim();
            if (!q) return [];
            try {
                return await searchModelsByName(q, modelType);
            } catch (_) {
                return [];
            }
        };

        // Also expose main APIs under namespace (non-breaking add)
        window.Yuuka.loraSearch.searchModelsByName = searchModelsByName;
        window.Yuuka.loraSearch.getModelById = getModelById;
        window.Yuuka.loraSearch.getModelByUrl = getModelByUrl;
        window.Yuuka.loraSearch.searchImagesByQuery = searchImagesByQuery;
    } catch (err) {
        // no-op
    }
})();