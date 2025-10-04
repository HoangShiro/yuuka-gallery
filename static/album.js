// --- MODIFIED FILE: static/album.js ---
class AlbumManager {
    constructor() {
        this.container = document.getElementById('album-container');
        this.selectedCharacter = null;
        this.globalChoices = null;
        this.viewStack = []; // History for back button
        this.allImageData = []; // Cache for all images of a character
        this.promptClipboard = null;
        this.tagPredictions = [];
    }

    // --- Core Methods ---
    async init(character = null) {
        if (character) {
            this.selectedCharacter = character;
        }
        this.viewStack = [];
        this.container.style.display = 'block';

        if (this.selectedCharacter) {
            this.updateUI('loading', `Đang tải album của ${this.selectedCharacter.name}...`);
            await this.loadAndDisplayCharacterAlbum();
        } else {
            await this.showCharacterSelectionGrid();
        }
    }
    
    async loadAndDisplayCharacterAlbum() {
        try {
            if (this.tagPredictions.length === 0) {
                try {
                    this.tagPredictions = await api.getTags();
                } catch (e) {
                    console.warn("Could not load tag predictions.");
                    this.tagPredictions = [];
                }
            }
            this.allImageData = await api.getCharacterAlbum(this.selectedCharacter.hash);
            this.renderCharacterAlbumView();
        } catch (error) {
            this.updateUI('error', `Lỗi tải dữ liệu album: ${error.message}`);
            showError(`Lỗi tải dữ liệu album: ${error.message}`);
        }
    }
    
    async _generateArt(configOverrides = {}) {
        const placeholderId = `placeholder-${Date.now()}`;
        const placeholder = document.createElement('div');
        placeholder.className = 'album-card placeholder-card';
        placeholder.id = placeholderId;
        
        const grid = this.container.querySelector('.album-grid');
        grid.prepend(placeholder);
        
        const emptyMsg = grid.querySelector('.empty-msg');
        if (emptyMsg) emptyMsg.style.display = 'none';

        try {
            const { last_config } = await api.getGenerationInfo(this.selectedCharacter.hash);
            
            const payload = { 
                ...last_config,
                ...configOverrides,
                character: this.selectedCharacter.name,
            };

            const result = await api.generateArt(payload);

            if (result.status === 'success' && result.images_base64?.[0]) {
                const newImageData = await api.addImageToAlbum(this.selectedCharacter.hash, {
                    image_base64: result.images_base64[0],
                    generation_config: result.generation_config,
                });
                
                this.allImageData.unshift(newImageData);
                const newCard = this._createImageCard(newImageData);
                placeholder.replaceWith(newCard);
                this.updateResultCounter();
            } else {
                throw new Error(result.error_message || 'Không nhận được ảnh từ server.');
            }
        } catch (error) {
            console.error("Art generation failed:", error);
            showError(`Tạo ảnh thất bại: ${error.message}`);
            placeholder.remove();
            if (grid.children.length === 0) this.updateResultCounter();
        }
    }
    
    // --- UI Management ---
    updateUI(state, text = '') {
        const backBtn = document.getElementById('back-btn');
        const contextFooter = document.getElementById('context-footer');
        
        backBtn.style.display = this.viewStack.length > 1 ? 'block' : 'none';

        if (state === 'error') {
            this.container.innerHTML = `<div class="error-msg">${text}</div>`;
            contextFooter.style.display = 'none';
        } else if (state === 'loading') {
            this.container.innerHTML = `<div class="loader visible">${text}</div>`;
            contextFooter.style.display = 'none';
        } else {
            contextFooter.textContent = text;
            contextFooter.style.display = text ? 'block' : 'none';
        }
    }
    
    goBack() {
        if (this.viewStack.length <= 1) {
            this.showCharacterSelectionGrid();
            return;
        }
        this.viewStack.pop(); 
        const previousView = this.viewStack[this.viewStack.length - 1];
        previousView.func(...previousView.args);
    }
    
    _pushView(func, ...args) {
        this.viewStack.push({ func: func.bind(this), args: args });
        this.updateUI('content');
    }

    _makeContentScrollable(element) {
        let isDown = false, lastY, velocityY = 0, momentumID;
        const DAMPING = 0.95;
        function beginMomentumTracking() { cancelAnimationFrame(momentumID); momentumID = requestAnimationFrame(momentumLoop); }
        function momentumLoop() { element.scrollTop -= velocityY; velocityY *= DAMPING; if (Math.abs(velocityY) > 0.5) momentumID = requestAnimationFrame(momentumLoop); }
        const handleMouseDown = (e) => {
            const interactiveTags = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION', 'A'];
            if (e.button !== 0 || interactiveTags.includes(e.target.tagName) || e.target.closest('button, a, input, select, textarea') || element.scrollHeight <= element.clientHeight) return;
            e.stopPropagation(); e.preventDefault();
            isDown = true; element.classList.add('is-dragging'); lastY = e.pageY; velocityY = 0; cancelAnimationFrame(momentumID);
            window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
        };
        const handleMouseMove = (e) => {
            if (!isDown) return; e.preventDefault();
            const y = e.pageY; const deltaY = y - lastY;
            element.scrollTop -= deltaY; velocityY = deltaY; lastY = y;
        };
        const handleMouseUp = () => {
            if (!isDown) return; isDown = false; element.classList.remove('is-dragging');
            beginMomentumTracking();
            window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp);
        };
        element.addEventListener('mousedown', handleMouseDown);
    }

    // --- Rendering ---
    async showCharacterSelectionGrid() {
        this.viewStack = [];
        this._pushView(this.showCharacterSelectionGrid);
        this.selectedCharacter = null;

        this.updateUI('loading', 'Đang tải danh sách album...');
        try {
            const charHashes = await api.getAlbumCharacters();
            const characters = await api.getCharactersByHashes(charHashes);
            
            this.container.innerHTML = `<div class="album-grid"></div>`;
            const grid = this.container.querySelector('.album-grid');

            if (!characters || characters.length === 0) {
                grid.innerHTML = `<p class="empty-msg">Chưa có album nào. Mở một nhân vật từ các tab khác và nhấn 🖼️ để bắt đầu.</p>`;
                this.updateUI('content', 'Chọn nhân vật để xem album');
                return;
            }
            
            characters.sort((a,b) => a.name.localeCompare(b.name)).forEach(char => {
                const card = document.createElement('div');
                card.className = 'character-card';
                card.innerHTML = `<div class="image-container"><img src="/image/${char.hash}" alt="${char.name}"></div><div class="name">${char.name}</div>`;
                card.addEventListener('click', () => this.init(char));
                grid.appendChild(card);
            });
            this.updateUI('content', `Bạn có ${characters.length} album. Chọn một nhân vật để xem.`);
        } catch (error) {
            showError(`Lỗi tải album: ${error.message}`);
            this.updateUI('error', `Lỗi tải album: ${error.message}`);
        }
    }
    
    renderCharacterAlbumView() {
        this._pushView(this.renderCharacterAlbumView);
        this.container.innerHTML = `
            <div class="album-grid image-grid"></div>
            <div class="album-result-counter"></div>
            <div class="fab-container">
                <button class="fab" id="fab-settings" title="Cấu hình ComfyUI">⚙️</button>
                <button class="fab" id="fab-add" title="Tạo ảnh mới">➕</button>
            </div>
        `;

        const fabAdd = document.getElementById('fab-add');
        const fabSettings = document.getElementById('fab-settings');

        if (!state.isComfyUIAvailable) {
            fabAdd.disabled = true;
            fabSettings.disabled = true;
            fabAdd.title = "ComfyUI không kết nối";
            fabSettings.title = "ComfyUI không kết nối";
        }

        fabAdd.addEventListener('click', () => this._generateArt());
        fabSettings.addEventListener('click', () => this.renderSettingsModal());
    
        this._renderImageGrid();
    }

    _renderImageGrid() {
        const grid = this.container.querySelector('.album-grid');
        if (!grid) return;
        grid.innerHTML = '';
        this.updateUI('content', `Album: ${this.selectedCharacter.name}`);
        
        if (this.allImageData.length === 0) {
            grid.innerHTML = `<p class="empty-msg">Album này chưa có ảnh nào.</p>`;
        } else {
            this.allImageData.forEach(imgData => grid.appendChild(this._createImageCard(imgData)));
        }
        this.updateResultCounter(this.allImageData.length);
    }
    
    _createImageCard(imgData) {
        const card = document.createElement('div');
        card.className = 'album-card image-card';
        card.innerHTML = `<img src="${imgData.url}" alt="Art" loading="lazy">`;
        card.addEventListener('click', () => this.renderImageViewer(imgData, this.allImageData));
        return card;
    }
    
    updateResultCounter(count) {
        const counter = this.container.querySelector('.album-result-counter');
        if (!counter) return;
        if (count > 0) counter.textContent = `Hiển thị ${count} kết quả.`;
        else counter.textContent = '';
    }

    renderImageViewer(imgData, currentImageList) {
        const viewer = document.createElement('div');
        viewer.className = 'image-viewer';
        viewer.innerHTML = `
            <div class="viewer-content">
                <span class="viewer-close">&times;</span>
                <div class="viewer-nav prev" title="Previous image">‹</div>
                <div class="viewer-image-wrapper"><div class="viewer-image-slider"></div></div>
                <div class="viewer-nav next" title="Next image">›</div>
                <div class="viewer-actions">
                    <button data-action="regen" title="Tạo lại với cùng cấu hình">➕</button>
                    <button data-action="info" title="Xem thông tin">ℹ️</button>
                    <button data-action="copy" title="Copy Prompt">📋</button>
                    <button data-action="delete" title="Xoá ảnh">➖</button>
                </div>
                <div class="viewer-info"></div>
            </div>
        `;
        document.body.appendChild(viewer);

        let currentIndex = currentImageList.findIndex(img => img.id === imgData.id);
        const viewerContent = viewer.querySelector('.viewer-content');
        const slider = viewer.querySelector('.viewer-image-slider');
        const infoPanel = viewer.querySelector('.viewer-info');
        const navPrev = viewer.querySelector('.viewer-nav.prev');
        const navNext = viewer.querySelector('.viewer-nav.next');
        const regenBtn = viewer.querySelector('button[data-action="regen"]');
        if (!state.isComfyUIAvailable) {
            regenBtn.disabled = true;
            regenBtn.title = "ComfyUI không kết nối";
        }

        let navHideTimeout;

        this._makeContentScrollable(infoPanel);

        const updateViewerContent = (index) => {
            const newImgData = currentImageList[index];
            currentIndex = index;
            const oldActiveImages = slider.querySelectorAll('img.active');
            const newImgElement = document.createElement('img');
            newImgElement.src = newImgData.url;
            slider.appendChild(newImgElement);
            newImgElement.addEventListener('transitionend', (e) => {
                if (e.propertyName !== 'opacity') return;
                oldActiveImages.forEach(oldImg => {
                    oldImg.addEventListener('transitionend', (e2) => {
                        if (e2.propertyName === 'opacity') oldImg.remove();
                    }, { once: true });
                    oldImg.classList.remove('active');
                });
            }, { once: true });
            setTimeout(() => newImgElement.classList.add('active'), 10);

            this.initZoomAndPan(newImgElement);

            const createDetailRow = (l, v) => { if (!v || (typeof v === 'string' && v.trim() === '')) return ''; const s = document.createElement('span'); s.textContent = v; return `<div class="info-row"><strong>${l}:</strong> <span>${s.innerHTML}</span></div>`; };
            const config = newImgData.generationConfig;
            const creationDate = new Date(newImgData.createdAt * 1000).toLocaleString('vi-VN');
            const mainInfo = ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative'].map(k => createDetailRow(k.charAt(0).toUpperCase() + k.slice(1), config[k])).filter(Boolean).join('');
            const techInfo = `<div class="info-grid">${createDetailRow('Model', config.ckpt_name.split('.')[0])}${createDetailRow('Sampler', `${config.sampler_name} (${config.scheduler})`)}${createDetailRow('Cỡ ảnh', `${config.width}x${config.height}`)}${createDetailRow('Steps', config.steps)}${createDetailRow('CFG', config.cfg)}${createDetailRow('LoRA', config.lora_name)}</div>`;
            infoPanel.innerHTML = `${mainInfo}${mainInfo ? '<hr>' : ''}${techInfo}<hr>${createDetailRow('Ngày tạo', creationDate)}`.trim();
            infoPanel.classList.remove('visible');
        };
        const showNext = () => updateViewerContent((currentIndex + 1) % currentImageList.length);
        const showPrev = () => updateViewerContent((currentIndex - 1 + currentImageList.length) % currentImageList.length);
        const resetNavTimeout = () => { clearTimeout(navHideTimeout); viewerContent.classList.remove('nav-hidden'); navHideTimeout = setTimeout(() => viewerContent.classList.add('nav-hidden'), 2500); };
        const keydownHandler = (e) => { if (e.key === 'ArrowRight') showNext(); if (e.key === 'ArrowLeft') showPrev(); if (e.key === 'Escape') close(); };
        let isDragging = false, startPos = { x: 0, y: 0 };
        const dragThreshold = 10;
        const handleInteractionStart = (e) => { isDragging = false; const p = e.touches ? e.touches[0] : e; startPos = { x: p.clientX, y: p.clientY }; };
        const handleInteractionMove = (e) => { if (isDragging) return; const p = e.touches ? e.touches[0] : e; const dX = Math.abs(p.clientX - startPos.x); const dY = Math.abs(p.clientY - startPos.y); if (dX > dragThreshold || dY > dragThreshold) isDragging = true; };
        const handleInteractionEnd = (e) => { if (isDragging || e.target.closest('.viewer-actions, .viewer-nav, .viewer-close, .viewer-info')) return; const r = viewer.getBoundingClientRect(); const endP = e.changedTouches ? e.changedTouches[0] : e; if (endP.clientX > r.width * 0.5) showNext(); else showPrev(); };
        const close = () => { viewer.remove(); document.removeEventListener('keydown', keydownHandler); };

        updateViewerContent(currentIndex);
        if (currentImageList.length > 1) {
            navPrev.addEventListener('click', showPrev); navNext.addEventListener('click', showNext);
            viewerContent.addEventListener('mousemove', resetNavTimeout);
            viewerContent.addEventListener('mousedown', handleInteractionStart); viewerContent.addEventListener('mousemove', handleInteractionMove); viewerContent.addEventListener('mouseup', handleInteractionEnd);
            viewerContent.addEventListener('touchstart', handleInteractionStart, { passive: true }); viewerContent.addEventListener('touchmove', handleInteractionMove, { passive: true }); viewerContent.addEventListener('touchend', handleInteractionEnd);
        } else { navPrev.style.display = 'none'; navNext.style.display = 'none'; }
        resetNavTimeout();
        viewer.querySelector('.viewer-close').addEventListener('click', close);
        document.addEventListener('keydown', keydownHandler);

        viewer.querySelector('.viewer-actions').addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            const action = button?.dataset.action;
            if (!action || button.disabled) return;
            const currentImgData = currentImageList[currentIndex];

            if (action === 'info') viewer.querySelector('.viewer-info').classList.toggle('visible');
            else if (action === 'copy') {
                const config = currentImgData.generationConfig, promptKeys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
                const promptMap = new Map(promptKeys.map(k => [k, config[k] ? String(config[k]).trim() : '']));
                this.promptClipboard = promptMap;
                showError("Prompt đã được copy vào bộ nhớ tạm.");
                const clipboardText = promptKeys.map(k => (promptMap.get(k) ? `${k}: ${promptMap.get(k)}` : '')).filter(Boolean).join('\n');
                if (clipboardText) navigator.clipboard.writeText(clipboardText).catch(err => console.warn("Clipboard copy failed: ", err));
                const originalContent = button.innerHTML; button.innerHTML = '✔️'; button.style.pointerEvents = 'none';
                setTimeout(() => { button.innerHTML = originalContent; button.style.pointerEvents = 'auto'; }, 1500);
            } else if (action === 'delete') {
                if (confirm('Bạn có chắc muốn xoá ảnh này khỏi album (xoá vĩnh viễn trên server)?')) {
                    try {
                        await api.deleteImageFromAlbum(currentImgData.id);
                        const deletedId = currentImgData.id;
                        this.allImageData = this.allImageData.filter(img => img.id !== deletedId);
                        currentImageList = currentImageList.filter(img => img.id !== deletedId);
                        if (currentImageList.length === 0) close();
                        else updateViewerContent(Math.min(currentIndex, currentImageList.length - 1));
                        this._renderImageGrid();
                    } catch (err) { showError(`Lỗi xoá ảnh: ${err.message}`); }
                }
            } else if (action === 'regen') { close(); await this._generateArt(currentImgData.generationConfig); }
        });
    }
    
    _initTagAutocomplete(formContainer) {
        if (!this.tagPredictions || this.tagPredictions.length === 0) return;
        formContainer.querySelectorAll('textarea, input[type="text"]').forEach(input => {
            if (input.parentElement.classList.contains('tag-autocomplete-container')) return;
            const wrapper = document.createElement('div'); wrapper.className = 'tag-autocomplete-container';
            input.parentElement.insertBefore(wrapper, input); wrapper.appendChild(input);
            const list = document.createElement('ul'); list.className = 'tag-autocomplete-list'; wrapper.appendChild(list);
            let activeIndex = -1;
            const hideList = () => { list.style.display = 'none'; list.innerHTML = ''; activeIndex = -1; };
            input.addEventListener('input', () => {
                const text = input.value, cursorPos = input.selectionStart;
                const textBefore = text.substring(0, cursorPos), lastComma = textBefore.lastIndexOf(',');
                const currentTag = textBefore.substring(lastComma + 1).trim();
                if (currentTag.length < 1) { hideList(); return; }
                const searchTag = currentTag.replace(/\s+/g, '_').toLowerCase();
                const matches = this.tagPredictions.filter(t => t.startsWith(searchTag)).slice(0, 7);
                if (matches.length > 0) {
                    list.innerHTML = matches.map(m => `<li class="tag-autocomplete-item" data-tag="${m}">${m.replace(/_/g, ' ')}</li>`).join('');
                    list.style.display = 'block'; activeIndex = -1;
                } else { hideList(); }
            });
            const applySuggestion = (suggestion) => {
                const text = input.value, cursorPos = input.selectionStart;
                const textBefore = text.substring(0, cursorPos), lastComma = textBefore.lastIndexOf(',');
                const before = text.substring(0, lastComma + 1);
                const after = text.substring(cursorPos), endOfTag = after.indexOf(',') === -1 ? after.length : after.indexOf(',');
                const finalAfter = text.substring(cursorPos + endOfTag);
                const newText = `${before.trim() ? `${before.trim()} ` : ''}${suggestion.replace(/_/g, ' ')}, ${finalAfter.trim()}`;
                input.value = newText.trim();
                const newCursorPos = `${before.trim() ? `${before.trim()} ` : ''}${suggestion}`.length + 2;
                input.focus(); input.setSelectionRange(newCursorPos, newCursorPos);
                hideList(); input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            list.addEventListener('mousedown', e => { e.preventDefault(); if (e.target.matches('.tag-autocomplete-item')) applySuggestion(e.target.dataset.tag); });
            input.addEventListener('keydown', e => {
                const items = list.querySelectorAll('.tag-autocomplete-item'); if (items.length === 0) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; }
                else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; }
                else if ((e.key === 'Enter' || e.key === 'Tab') && activeIndex > -1) { e.preventDefault(); applySuggestion(items[activeIndex].dataset.tag); }
                else if (e.key === 'Escape') hideList();
                items.forEach((item, index) => item.classList.toggle('active', index === activeIndex));
            });
            input.addEventListener('blur', () => setTimeout(hideList, 150));
        });
    }

    async renderSettingsModal() {
        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.innerHTML = `<div class="settings-form"><h3>Loading...</h3></div>`;
        document.body.appendChild(modal);

        try {
            const { last_config, global_choices } = await api.getGenerationInfo(this.selectedCharacter.hash);
            this.globalChoices = global_choices;
            last_config.character = this.selectedCharacter.name;

            const formContainer = modal.querySelector('.settings-form');
            this._makeContentScrollable(formContainer);

            const createTextarea = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><textarea id="cfg-${k}" name="${k}" rows="1">${v}</textarea></div>`;
            const createSlider = (k, l, v, min, max, step) => `<div class="form-group form-group-slider"><label for="cfg-${k}">${l}: <span id="val-${k}">${v}</span></label><input type="range" id="cfg-${k}" name="${k}" value="${v}" min="${min}" max="${max}" step="${step}" oninput="document.getElementById('val-${k}').textContent = this.value"></div>`;
            const createSelect = (k, l, v, opts) => `<div class="form-group"><label for="cfg-${k}">${l}</label><select id="cfg-${k}" name="${k}">${opts.map(o => `<option value="${o.value}" ${o.value == v ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>`;
            const createTextInput = (k, l, v) => `<div class="form-group"><label for="cfg-${k}">${l}</label><input type="text" id="cfg-${k}" name="${k}" value="${v}"></div>`;
            
            let formHtml = `<h3>Cấu hình ComfyUI</h3>`;
            formHtml += createTextarea('character', 'Character', last_config.character);
            formHtml += createTextarea('outfits', 'Outfits', last_config.outfits);
            formHtml += createTextarea('expression', 'Expression', last_config.expression);
            formHtml += createTextarea('action', 'Action', last_config.action);
            formHtml += createTextarea('context', 'Context', last_config.context);
            formHtml += createTextarea('quality', 'Quality', last_config.quality);
            formHtml += createTextarea('negative', 'Negative', last_config.negative);
            formHtml += createTextInput('lora_name', 'LoRA Name', last_config.lora_name);
            formHtml += createSlider('steps', 'Steps', last_config.steps, 10, 50, 1);
            formHtml += createSlider('cfg', 'CFG', last_config.cfg, 1.0, 7.0, 0.1);
            formHtml += createSelect('size', 'W x H', `${last_config.width}x${last_config.height}`, this.globalChoices.sizes);
            formHtml += createSelect('sampler_name', 'Sampler', last_config.sampler_name, this.globalChoices.samplers);
            formHtml += createSelect('scheduler', 'Scheduler', last_config.scheduler, this.globalChoices.schedulers);
            formHtml += createSelect('ckpt_name', 'Checkpoint', last_config.ckpt_name, this.globalChoices.checkpoints);
            formHtml += createTextInput('server_address', 'Server Address', last_config.server_address);
            formHtml += `<div class="settings-actions"><button type="button" class="btn-paste" title="Dán prompt">📋</button><button type="button" class="btn-copy">Copy</button><button type="submit" class="btn-save">Lưu</button><button type="button" class="btn-cancel">Hủy</button></div>`;

            formContainer.innerHTML = `<form id="channel-config-form">${formHtml}</form>`;
            this._initTagAutocomplete(formContainer);
            
            const form = formContainer.querySelector('#channel-config-form');
            formContainer.querySelectorAll('textarea').forEach(textarea => {
                const autoResize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
                textarea.addEventListener('input', autoResize);
                setTimeout(autoResize, 0);
            });
            
            const close = () => modal.remove();
            
            formContainer.querySelector('.btn-copy').addEventListener('click', () => {
                const promptKeys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
                const promptMap = new Map(promptKeys.map(k => [k, form.elements[k].value.trim()]));
                this.promptClipboard = promptMap;
                showError("Prompt đã được lưu tạm.");
            });

            formContainer.querySelector('.btn-paste').addEventListener('click', () => {
                if (!this.promptClipboard) { showError("Chưa có prompt nào trong bộ nhớ tạm."); return; }
                this.promptClipboard.forEach((value, key) => { if (form.elements[key]) form.elements[key].value = value; });
                formContainer.querySelectorAll('textarea').forEach(ta => ta.dispatchEvent(new Event('input', { bubbles: true })));
                showError("Đã dán prompt.");
            });

            formContainer.querySelector('.btn-cancel').addEventListener('click', close);
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const updates = {};
                ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative', 'lora_name', 'server_address', 'sampler_name', 'scheduler', 'ckpt_name'].forEach(k => updates[k] = form.elements[k].value);
                ['steps', 'cfg'].forEach(k => updates[k] = parseFloat(form.elements[k].value));
                const [width, height] = form.elements['size'].value.split('x').map(Number);
                updates.width = width; updates.height = height;

                try {
                    await api.saveComfyUIConfig(updates);
                    showError('Lưu cấu hình thành công!');
                    close();
                } catch(err) {
                    showError(`Lỗi khi lưu: ${err.message}`);
                }
            });
        } catch (error) {
            showError(`Lỗi: ${error.message}`);
            modal.querySelector('.settings-form').innerHTML = `<h3>Lỗi</h3><p>${error.message}</p>`;
        }
    }
    
    initZoomAndPan(imgElement) {
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
}

const albumManager = new AlbumManager();