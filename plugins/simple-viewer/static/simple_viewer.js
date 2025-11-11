// --- MODIFIED FILE: plugins/simple-viewer/static/simple_viewer.js ---

// Yuuka: Đăng ký plugin vào namespace chung
window.Yuuka.plugins = window.Yuuka.plugins || {};

window.Yuuka.plugins.simpleViewer = (() => {
    // --- Private State ---
    let viewerElement = null;
    let items = [];
    let currentIndex = -1;
    let options = {};
    let navHideTimeout;
    const imageCache = new Map();
    const MAX_PRELOAD_FORWARD = 5;
    const MAX_PRELOAD_BACKWARD = 3;

    /**
     * Preload an image and keep its state cached.
     * @param {string} url
     * @returns {Promise<void>|undefined}
     */
    function preloadImage(url) {
        if (!url) return;
        const existing = imageCache.get(url);
        if (existing) {
            return existing.promise;
        }

        const entry = {
            status: 'loading',
            promise: null,
        };

        entry.promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                entry.status = 'loaded';
                entry.image = img;
                resolve();
            };
            img.onerror = (err) => {
                entry.status = 'error';
                entry.error = err;
                imageCache.delete(url);
                reject(err);
            };
            img.src = url;
        });

        imageCache.set(url, entry);
        return entry.promise;
    }

    /**
     * Queue preload for images around the current index to keep navigation smooth.
     * @param {number} index
     */
    function preloadAroundIndex(index) {
        if (!Array.isArray(items) || items.length === 0) return;
        const allowedUrls = new Set();
        const currentItem = items[index];
        if (currentItem?.imageUrl) {
            allowedUrls.add(currentItem.imageUrl);
        }
        for (let offset = 1; offset <= MAX_PRELOAD_FORWARD && offset < items.length; offset++) {
            const nextIndex = (index + offset) % items.length;
            const nextItem = items[nextIndex];
            if (nextItem?.imageUrl) {
                allowedUrls.add(nextItem.imageUrl);
                const preloadPromise = preloadImage(nextItem.imageUrl);
                if (preloadPromise) {
                    preloadPromise.catch(() => {});
                }
            }
        }
        for (let offset = 1; offset <= MAX_PRELOAD_BACKWARD && offset < items.length; offset++) {
            const prevIndex = (index - offset + items.length) % items.length;
            const prevItem = items[prevIndex];
            if (prevItem?.imageUrl) {
                allowedUrls.add(prevItem.imageUrl);
                const preloadPromise = preloadImage(prevItem.imageUrl);
                if (preloadPromise) {
                    preloadPromise.catch(() => {});
                }
            }
        }
        imageCache.forEach((_, url) => {
            if (!allowedUrls.has(url)) {
                imageCache.delete(url);
            }
        });
    }

    /**
     * Create a loading placeholder element.
     * @returns {HTMLDivElement}
     */
    function createPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'sv-viewer-placeholder';
        placeholder.innerHTML = '<span class="sv-placeholder-spinner"></span>';
        return placeholder;
    }

    /**
     * Wait for an image element to finish loading.
     * @param {HTMLImageElement} imgElement
     * @returns {Promise<void>}
     */
    function waitForImageElement(imgElement) {
        // If image has already finished loading successfully
        if (imgElement.complete && imgElement.naturalWidth !== 0) {
            return Promise.resolve();
        }
        // If image has already finished with an error (race condition)
        if (imgElement.complete && imgElement.naturalWidth === 0) {
            return Promise.reject(new Error('Image failed to load'));
        }

        return new Promise((resolve, reject) => {
            const onLoad = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error('Image failed to load'));
            };
            const cleanup = () => {
                imgElement.removeEventListener('load', onLoad);
                imgElement.removeEventListener('error', onError);
            };

            imgElement.addEventListener('load', onLoad, { once: true });
            imgElement.addEventListener('error', onError, { once: true });

            // Handle the case where the image finishes loading/errored
            // between the initial checks above and the listeners attaching.
            if (imgElement.complete) {
                // Microtask to allow layout to update the intrinsic size
                Promise.resolve().then(() => {
                    if (imgElement.naturalWidth !== 0) {
                        onLoad();
                    } else {
                        onError();
                    }
                });
            }
        });
    }

    // --- Private Methods ---

    /**
     * Tự động ẩn các nút điều khiển sau một khoảng thời gian
     */
    function resetNavTimeout() {
        if (!viewerElement) return;
        clearTimeout(navHideTimeout);
        viewerElement.querySelector('.sv-viewer-content').classList.remove('nav-hidden');
        navHideTimeout = setTimeout(() => {
            viewerElement.querySelector('.sv-viewer-content').classList.add('nav-hidden');
        }, 2500);
    }

    /**
     * Hiển thị ảnh tiếp theo
     */
    function showNext() {
        if (items.length > 1) {
            updateViewerContent((currentIndex + 1) % items.length);
        }
    }

    /**
     * Hiển thị ảnh trước đó
     */
    function showPrev() {
        if (items.length > 1) {
            updateViewerContent((currentIndex - 1 + items.length) % items.length);
        }
    }

    /**
     * Xử lý sự kiện bàn phím
     * @param {KeyboardEvent} e 
     */
    function keydownHandler(e) {
        if (e.key === 'ArrowRight') showNext();
        if (e.key === 'ArrowLeft') showPrev();
        if (e.key === 'Escape') close();
    }
    
    /**
     * Cập nhật nội dung của viewer khi chuyển ảnh
     * @param {number} index - Index của ảnh mới
     */
    function updateViewerContent(index) {
        const newItem = items[index];
        if (!newItem) return;
        currentIndex = index;

        const slider = viewerElement.querySelector('.sv-viewer-image-slider');
        const infoPanel = viewerElement.querySelector('.sv-viewer-info');
        
        const oldActiveImages = Array.from(slider.querySelectorAll('img.active'));

        slider.querySelectorAll('.sv-viewer-placeholder').forEach(el => el.remove());
        const placeholder = createPlaceholder();
        slider.appendChild(placeholder);

        const newImgElement = document.createElement('img');
        slider.appendChild(newImgElement);
        initZoomAndPan(newImgElement);

        let cleanupExecuted = false;
        let cleanupTimeout = null;

        function fadeOutImage(img) {
            if (!img || img === newImgElement || img.dataset.svRemoving === 'true') return;
            img.dataset.svRemoving = 'true';

            let fallbackRemoval = null;

            const finalizeRemoval = () => {
                img.removeEventListener('transitionend', handleImageTransition);
                if (fallbackRemoval !== null) {
                    clearTimeout(fallbackRemoval);
                }
                delete img.dataset.svRemoving;
                if (img !== newImgElement && img.isConnected) {
                    img.remove();
                }
            };

            const handleImageTransition = (event) => {
                if (event.propertyName !== 'opacity') return;
                finalizeRemoval();
            };

            img.addEventListener('transitionend', handleImageTransition);

            requestAnimationFrame(() => {
                img.classList.remove('active');
            });

            fallbackRemoval = setTimeout(finalizeRemoval, 500);
        }

        function cleanupOldImages() {
            if (cleanupExecuted) return;
            cleanupExecuted = true;
            if (cleanupTimeout !== null) {
                clearTimeout(cleanupTimeout);
            }

            oldActiveImages.forEach(img => {
                if (!img || img === newImgElement) return;
                if (!img.isConnected) return;
                fadeOutImage(img);
            });

            newImgElement.removeEventListener('transitionend', handleNewImageTransition);
        }

        function handleNewImageTransition(event) {
            if (event.propertyName !== 'opacity') return;
            cleanupOldImages();
        }

        newImgElement.addEventListener('transitionend', handleNewImageTransition);

        const activateImage = () => {
            requestAnimationFrame(() => {
                // Force layout before toggling the active state to make sure mobile browsers register the transition.
                newImgElement.getBoundingClientRect();
                requestAnimationFrame(() => {
                    newImgElement.classList.add('active');
                });
            });
            placeholder.classList.add('hidden');
            const removePlaceholder = () => {
                if (placeholder.isConnected) {
                    placeholder.remove();
                }
            };
            placeholder.addEventListener('transitionend', removePlaceholder, { once: true });
            setTimeout(removePlaceholder, 400);
            // Fallback in case the new image never fires its opacity transition (mobile race condition).
            cleanupTimeout = setTimeout(cleanupOldImages, 700);
            const resolvedPromise = Promise.resolve();
            const cacheEntry = imageCache.get(newItem.imageUrl);
            if (cacheEntry) {
                cacheEntry.status = 'loaded';
                cacheEntry.image = newImgElement;
                cacheEntry.promise = resolvedPromise;
            } else {
                imageCache.set(newItem.imageUrl, {
                    status: 'loaded',
                    promise: resolvedPromise,
                    image: newImgElement,
                });
            }
        };

        const handleImageError = () => {
            placeholder.classList.add('error');
            placeholder.textContent = 'Failed to load image';
            imageCache.delete(newItem.imageUrl);
        };

        newImgElement.src = newItem.imageUrl;

        waitForImageElement(newImgElement)
            .then(activateImage)
            .catch(handleImageError);
        
        preloadAroundIndex(currentIndex);
        
        renderActionButtons(newItem);

        if (typeof options.renderInfoPanel === 'function') {
            infoPanel.innerHTML = options.renderInfoPanel(newItem);
        }
        infoPanel.classList.remove('visible');
    }

    /**
     * Render các nút hành động do plugin khác cung cấp
     * @param {object} item - Dữ liệu của ảnh hiện tại
     */
    function renderActionButtons(item) {
        const actionsContainer = viewerElement.querySelector('.sv-viewer-actions');
        actionsContainer.innerHTML = '';
        if (!options.actionButtons || options.actionButtons.length === 0) return;

        options.actionButtons.forEach(buttonDef => {
            const button = document.createElement('button');
            button.title = buttonDef.title;
            if (buttonDef.disabled && buttonDef.disabled(item)) {
                button.disabled = true;
            }
            button.innerHTML = `<span class="material-symbols-outlined">${buttonDef.icon}</span>`;
            
            button.addEventListener('click', () => {
                if (typeof buttonDef.onClick === 'function') {
                    buttonDef.onClick(item, close, updateItemsAndRefresh);
                }
            });
            actionsContainer.appendChild(button);
        });
        
        const infoButton = document.createElement('button');
        infoButton.title = "Xem thông tin";
        infoButton.innerHTML = `<span class="material-symbols-outlined">info</span>`;
        infoButton.addEventListener('click', () => {
             viewerElement.querySelector('.sv-viewer-info').classList.toggle('visible');
        });
        actionsContainer.appendChild(infoButton);
    }
    
    /**
     * Khởi tạo logic Zoom và Pan cho một element ảnh
     * @param {HTMLImageElement} imgElement 
     */
    function initZoomAndPan(imgElement) {
        let scale = 1, panning = false, pointX = 0, pointY = 0, targetX = 0, targetY = 0, start = { x: 0, y: 0 }, animFrame, lastPinchDist = 0;
        const easing = 0.2, container = imgElement.parentElement.parentElement;
        function update() { pointX += (targetX - pointX) * easing; pointY += (targetY - pointY) * easing; imgElement.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`; if (Math.abs(targetX - pointX) > 0.1 || Math.abs(targetY - pointY) > 0.1) animFrame = requestAnimationFrame(update); else cancelAnimationFrame(animFrame); }
        function setTransform() { cancelAnimationFrame(animFrame); animFrame = requestAnimationFrame(update); }
        function getPinchDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
        function handleZoom(delta, clientX, clientY) { const rect = imgElement.getBoundingClientRect(); const xs = (clientX - rect.left) / scale, ys = (clientY - rect.top) / scale; const newScale = Math.min(Math.max(0.5, scale * delta), 5); targetX += xs * scale - xs * newScale; targetY += ys * scale - ys * newScale; scale = newScale; pointX = targetX; pointY = targetY; setTransform(); }
        imgElement.addEventListener('mousedown', (e) => { e.preventDefault(); panning = true; start = { x: e.clientX - targetX, y: e.clientY - targetY }; imgElement.style.cursor = 'grabbing'; });
        imgElement.addEventListener('mouseup', () => { panning = false; imgElement.style.cursor = 'grab'; });
        imgElement.addEventListener('mouseleave', () => { panning = false; imgElement.style.cursor = 'grab'; });
        imgElement.addEventListener('mousemove', (e) => { if (!panning) return; targetX = e.clientX - start.x; targetY = e.clientY - start.y; setTransform(); });
        container.addEventListener('wheel', (e) => { e.preventDefault(); handleZoom(e.deltaY > 0 ? 0.9 : 1.1, e.clientX, e.clientY); });
        container.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { e.preventDefault(); panning = true; start = { x: e.touches[0].clientX - targetX, y: e.touches[0].clientY - targetY }; } else if (e.touches.length === 2) { panning = false; e.preventDefault(); lastPinchDist = getPinchDist(e.touches); } }, { passive: false });
        container.addEventListener('touchend', () => { panning = false; lastPinchDist = 0; });
        container.addEventListener('touchmove', (e) => { if (e.touches.length === 1 && panning) { e.preventDefault(); targetX = e.touches[0].clientX - start.x; targetY = e.touches[0].clientY - start.y; setTransform(); } else if (e.touches.length === 2) { e.preventDefault(); const newDist = getPinchDist(e.touches); if (lastPinchDist > 0) handleZoom(newDist / lastPinchDist, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2); lastPinchDist = newDist; } }, { passive: false });
        imgElement.style.cursor = 'grab'; setTransform();
    }

    /**
     * Yuuka: image placeholder v1.0
     * Hàm được gọi từ event bus để thêm ảnh mới vào danh sách.
     * @param {object} eventData Dữ liệu từ event 'image:added'.
     */
    function handleImageAdded(eventData) {
        if (!viewerElement) return; // Không làm gì nếu viewer không mở
        const { image_data } = eventData;
        const newItem = { ...image_data, imageUrl: image_data.url };

        // Thêm vào đầu danh sách và tăng chỉ số hiện tại để giữ nguyên ảnh đang xem
        items.unshift(newItem);
        currentIndex++;
    }

    /**
     * Yuuka: image placeholder v1.0
     * Hàm được gọi từ event bus để xóa ảnh khỏi danh sách.
     * @param {object} eventData Dữ liệu từ event 'image:deleted'.
     */
    function handleImageDeleted({ imageId }) {
        if (!viewerElement) return;
        const deletedIndex = items.findIndex(item => item.id === imageId);
        if (deletedIndex === -1) return;

        const wasCurrentlyViewing = (currentIndex === deletedIndex);
        items.splice(deletedIndex, 1);

        if (items.length === 0) {
            close();
            return;
        }

        if (deletedIndex < currentIndex) {
            currentIndex--; // Giảm chỉ số nếu ảnh bị xóa nằm trước ảnh đang xem
        }

        if (wasCurrentlyViewing) {
            // Nếu ảnh đang xem bị xóa, hiển thị ảnh tiếp theo
            currentIndex = Math.min(currentIndex, items.length - 1);
            updateViewerContent(currentIndex);
        }
    }


    /**
     * Yuuka: hot-reload-fix v1.0
     * Sửa lại hàm cập nhật để theo dõi ID của ảnh, đảm bảo không bị nhảy ảnh lung tung.
     * @param {Array} newItems Danh sách ảnh mới
     */
    function updateItemsAndRefresh(newItems) {
        const currentId = items[currentIndex]?.id;
        items = newItems;

        if (items.length === 0) {
            close();
            return;
        }
        
        let newIndex = items.findIndex(item => item.id === currentId);
        if (newIndex === -1) { // Ảnh đang xem đã bị xóa
            newIndex = Math.min(currentIndex, items.length - 1);
        }
        
        updateViewerContent(newIndex);
    }


    /**
     * Dọn dẹp và đóng viewer
     */
    function close() {
        if (viewerElement) {
            viewerElement.remove();
            viewerElement = null;
        }
        document.removeEventListener('keydown', keydownHandler);
        Yuuka.events.off('image:added', handleImageAdded); // Yuuka: image placeholder v1.0
        Yuuka.events.off('image:deleted', handleImageDeleted); // Yuuka: image placeholder v1.0
        clearTimeout(navHideTimeout);
        items = [];
        currentIndex = -1;
    }

    /**
     * Trigger a download for the currently visible image.
     */
    function downloadCurrentImage() {
        if (!viewerElement) return;
        if (currentIndex < 0 || currentIndex >= items.length) return;
        const currentItem = items[currentIndex];
        if (!currentItem) return;

        const imageUrl = currentItem.imageUrl || currentItem.url;
        if (!imageUrl) return;

        const sanitizeFilename = (name) => name.replace(/[\\/:*?"<>|]/g, '_').trim();

        let filename = currentItem.filename || currentItem.name || '';
        let fallbackFromUrl = '';
        try {
            const urlObj = new URL(imageUrl, window.location.href);
            fallbackFromUrl = urlObj.pathname.split('/').pop() || '';
        } catch (_) {
            const parts = imageUrl.split('/');
            fallbackFromUrl = parts[parts.length - 1] || '';
        }

        filename = sanitizeFilename(filename || fallbackFromUrl || `image-${Date.now()}`);

        if (!/\.[a-z0-9]{2,5}$/i.test(filename)) {
            const extensionMatch = (fallbackFromUrl || imageUrl).match(/\.(jpe?g|png|gif|webp|bmp|tiff?|avif)(?:$|\?)/i);
            const inferredExtension = extensionMatch ? extensionMatch[1] : 'jpg';
            filename = `${filename}.${inferredExtension}`;
        }

        const anchor = document.createElement('a');
        anchor.href = imageUrl;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        requestAnimationFrame(() => anchor.remove());
    }


    // --- Public API ---
    return {
        /**
         * Mở trình xem ảnh.
         * @param {object} opts - Các tùy chọn
         * @param {Array<object>} opts.items - Danh sách các object cần hiển thị.
         * @param {number} opts.startIndex - Index của ảnh cần hiển thị đầu tiên.
         * @param {Function} [opts.renderInfoPanel] - Callback function (item) => "<html>".
         * @param {Array<object>} [opts.actionButtons] - Danh sách các nút hành động.
         */
        open: (opts) => {
            if (viewerElement) close();

            options = opts;
            items = options.items || [];
            if (items.length === 0) return;
            
            viewerElement = document.createElement('div');
            viewerElement.className = 'sv-viewer';
            viewerElement.innerHTML = `
                <div class="sv-viewer-content">
                    <div class="sv-viewer-toolbar">
                        <button class="sv-viewer-download" title="Download image">
                            <span class="material-symbols-outlined">download</span>
                        </button>
                        <span class="sv-viewer-close" title="Close viewer">&times;</span>
                    </div>
                    <div class="sv-viewer-nav prev" title="Previous image">‹</div>
                    <div class="sv-viewer-image-wrapper"><div class="sv-viewer-image-slider"></div></div>
                    <div class="sv-viewer-nav next" title="Next image">›</div>
                    <div class="sv-viewer-actions"></div>
                    <div class="sv-viewer-info"></div>
                </div>
            `;
            document.body.appendChild(viewerElement);

            const viewerContent = viewerElement.querySelector('.sv-viewer-content');
            const navPrev = viewerElement.querySelector('.sv-viewer-nav.prev');
            const navNext = viewerElement.querySelector('.sv-viewer-nav.next');
            const downloadButton = viewerElement.querySelector('.sv-viewer-download');

            let isDragging = false, startPos = { x: 0, y: 0 };
            const dragThreshold = 10;
            const handleInteractionStart = (e) => { isDragging = false; const p = e.touches ? e.touches[0] : e; startPos = { x: p.clientX, y: p.clientY }; };
            const handleInteractionMove = (e) => { if (isDragging) return; const p = e.touches ? e.touches[0] : e; const dX = Math.abs(p.clientX - startPos.x); const dY = Math.abs(p.clientY - startPos.y); if (dX > dragThreshold || dY > dragThreshold) isDragging = true; };
            const handleInteractionEnd = (e) => { if (isDragging || e.target.closest('.sv-viewer-actions, .sv-viewer-nav, .sv-viewer-close, .sv-viewer-info, .sv-viewer-download, .sv-viewer-toolbar')) return; const r = viewerElement.getBoundingClientRect(); const endP = e.changedTouches ? e.changedTouches[0] : e; if (endP.clientX > r.width * 0.5) showNext(); else showPrev(); };

            updateViewerContent(options.startIndex || 0);

            if (items.length > 1) {
                navPrev.addEventListener('click', showPrev);
                navNext.addEventListener('click', showNext);
                viewerContent.addEventListener('mousemove', resetNavTimeout);
                viewerContent.addEventListener('mousedown', handleInteractionStart);
                viewerContent.addEventListener('mousemove', handleInteractionMove);
                viewerContent.addEventListener('mouseup', handleInteractionEnd);
                viewerContent.addEventListener('touchstart', handleInteractionStart, { passive: true });
                viewerContent.addEventListener('touchmove', handleInteractionMove, { passive: true });
                viewerContent.addEventListener('touchend', handleInteractionEnd);
                resetNavTimeout();
            } else {
                navPrev.style.display = 'none';
                navNext.style.display = 'none';
            }

            if (downloadButton) {
                downloadButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    downloadCurrentImage();
                });
            }
            viewerElement.querySelector('.sv-viewer-close').addEventListener('click', close);
            document.addEventListener('keydown', keydownHandler);
            Yuuka.events.on('image:added', handleImageAdded); // Yuuka: image placeholder v1.0
            Yuuka.events.on('image:deleted', handleImageDeleted); // Yuuka: image placeholder v1.0
        }
    };
})();
