/**
 * Render thông tin chi tiết của một model vào một container HTML.
 * @param {object} model - Đối tượng model từ API Civitai.
 * @param {string} containerId - ID của element HTML để render kết quả vào.
 */
function _renderModelDetailsInDOM(model, containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Không tìm thấy element với ID: ${containerId}`);
        return;
    }

    // Xóa nội dung cũ trước khi render cái mới
    container.innerHTML = '';

    // Xây dựng chuỗi HTML
    let htmlContent = `
        <div class="model-card">
            <h3>${model.name || 'N/A'} (ID: ${model.id})</h3>
            <p><strong>Loại:</strong> ${model.type || 'N/A'}</p>
            <p><strong>Tác giả:</strong> ${model.creator ? model.creator.username : 'N/A'}</p>
    `;

    const stats = model.stats || {};
    if (Object.keys(stats).length > 0) {
        htmlContent += `
            <p>
                <strong>Stats:</strong> 
                Tải: ${stats.downloadCount || 0} | 
                Thích: ${stats.favoriteCount || 0} | 
                Rating: ${(stats.rating || 0).toFixed(2)} (${stats.ratingCount || 0} lượt)
            </p>
        `;
    }

    // --- Phần quan trọng: Lấy hình ảnh từ phiên bản model đầu tiên (thường là mới nhất) ---
    if (model.modelVersions && model.modelVersions.length > 0) {
        const primaryVersion = model.modelVersions[0]; // Lấy phiên bản đầu tiên trong danh sách
        htmlContent += `<h4>Hình ảnh từ phiên bản: ${primaryVersion.name}</h4>`;

        if (primaryVersion.images && primaryVersion.images.length > 0) {
            htmlContent += '<div class="image-gallery">';
            // Giới hạn chỉ hiển thị tối đa 5 ảnh để tránh làm nặng trang
            primaryVersion.images.slice(0, 5).forEach(image => {
                const promptText = image.meta ? (image.meta.prompt || 'Không có prompt.') : 'Không có prompt.';
                htmlContent += `
                    <div class="image-item">
                        <a href="${image.url}" target="_blank" title="Xem ảnh gốc">
                            <img src="${image.url}" alt="Model image" loading="lazy">
                        </a>
                        <p class="prompt"><strong>Prompt:</strong> ${promptText}</p>
                    </div>
                `;
            });
            htmlContent += '</div>';
        } else {
            htmlContent += '<p>Phiên bản này không có hình ảnh.</p>';
        }
    }

    htmlContent += '</div>'; // Đóng thẻ model-card
    container.innerHTML = htmlContent;
}


// --- CÁC HÀM GỌI API (Đã được cập nhật để gọi hàm render mới) ---

/**
 * Tìm kiếm các model trên Civitai theo tên.
 * @param {string} searchTerm
 * @param {string} modelType
 */
async function searchModelsByName(searchTerm, modelType = 'LORA') {
    console.log(`--- Đang tìm kiếm model loại '${modelType}' với tên '${searchTerm}' ---\n`);
    const resultsContainer = document.getElementById('resultsByName');
    resultsContainer.innerHTML = 'Đang tìm kiếm...'; // Thông báo cho người dùng

    const url = new URL("https://civitai.com/api/v1/models");
    url.searchParams.append('query', searchTerm);
    url.searchParams.append('types', modelType);

    try {
        const response = await fetch(url.toString());
        if (response.ok) {
            const data = await response.json();
            const models = data.items || [];
            resultsContainer.innerHTML = ''; // Xóa thông báo "Đang tìm kiếm"
            if (models.length === 0) {
                resultsContainer.textContent = 'Không tìm thấy model nào khớp.';
                return;
            }
            // Render từng model tìm được
            models.forEach(model => _renderModelDetailsInDOM(model, 'resultsByName'));
        } else {
            const errorText = await response.text();
            resultsContainer.textContent = `Lỗi khi gọi API: ${response.status} - ${errorText}`;
        }
    } catch (error) {
        resultsContainer.textContent = `Đã xảy ra lỗi kết nối: ${error}`;
    }
}

/**
 * Lấy thông tin model từ ID.
 * @param {number} modelId
 */
async function getModelById(modelId) {
    console.log(`--- Đang lấy thông tin model có ID: ${modelId} ---\n`);
    const resultsContainer = document.getElementById('resultsById');
    resultsContainer.innerHTML = 'Đang tải...';

    const url = `https://civitai.com/api/v1/models/${modelId}`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const modelData = await response.json();
            _renderModelDetailsInDOM(modelData, 'resultsById');
        } else if (response.status === 404) {
            resultsContainer.textContent = `Lỗi: Không tìm thấy model với ID ${modelId}.`;
        } else {
            const errorText = await response.text();
            resultsContainer.textContent = `Lỗi khi gọi API: ${response.status} - ${errorText}`;
        }
    } catch (error) {
        resultsContainer.textContent = `Đã xảy ra lỗi kết nối: ${error}`;
    }
}

/**
 * Lấy thông tin model từ URL.
 * @param {string} modelUrl
 */
async function getModelByUrl(modelUrl) {
    console.log(`--- Đang xử lý URL: ${modelUrl} ---\n`);
    const resultsContainer = document.getElementById('resultsByUrl');
    resultsContainer.innerHTML = ''; // Xóa kết quả cũ

    const match = modelUrl.match(/\/models\/(\d+)/);
    if (match && match[1]) {
        const modelId = parseInt(match[1], 10);
        // Tái sử dụng hàm getModelById nhưng render vào đúng container
        const url = `https://civitai.com/api/v1/models/${modelId}`;
        resultsContainer.innerHTML = 'Đang tải...';
         try {
            const response = await fetch(url);
            if (response.ok) {
                const modelData = await response.json();
                _renderModelDetailsInDOM(modelData, 'resultsByUrl');
            } else if (response.status === 404) {
                resultsContainer.textContent = `Lỗi: Không tìm thấy model với ID ${modelId}.`;
            } else {
                const errorText = await response.text();
                resultsContainer.textContent = `Lỗi khi gọi API: ${response.status} - ${errorText}`;
            }
        } catch (error) {
            resultsContainer.textContent = `Đã xảy ra lỗi kết nối: ${error}`;
        }
    } else {
        resultsContainer.textContent = "URL không hợp lệ hoặc không tìm thấy ID model trong URL.";
    }
}

// --- Helper: expose raw search for reuse in other components (e.g., LoraDownloader) ---
(function exposeRawSearch() {
    try {
        const ensureNs = () => {
            window.Yuuka = window.Yuuka || { components: {} };
            window.Yuuka.loraSearch = window.Yuuka.loraSearch || {};
        };
        ensureNs();
        window.Yuuka.loraSearch.searchModelsRaw = async function(query, modelType = 'LORA') {
            const q = (query || '').trim();
            if (!q) return [];
            const url = new URL('https://civitai.com/api/v1/models');
            url.searchParams.append('query', q);
            if (modelType) url.searchParams.append('types', modelType);
            const res = await fetch(url.toString());
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data?.items) ? data.items : [];
        };
    } catch (err) {
        // no-op
    }
})();