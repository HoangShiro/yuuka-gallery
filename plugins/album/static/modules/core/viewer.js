(function () {
    // Module: Image viewer integration for Album grid
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    proto._viewerRenderInfoPanel = function (item) {
        const viewerHelpers = window.Yuuka?.viewerHelpers;

        const fallbackInfoPanel = (it) => {
            const cfg = it?.generationConfig;
            if (!cfg) return 'Không có thông tin.';

            const buildRow = (label, value) => {
                if (!value || (typeof value === 'string' && value.trim() === '')) return '';
                const span = document.createElement('span');
                span.textContent = value;
                return `<div class="info-row"><strong>${label}:</strong> <span>${span.innerHTML}</span></div>`;
            };

            const resolveWorkflowDisplay = () => {
                const normalize = (value) => String(value || '').trim().toLowerCase();
                const workflowTemplate = String(cfg.workflow_template || '').trim();
                let workflowType = normalize(cfg.workflow_type);
                const hasLoRAName = typeof cfg.lora_name === 'string' && cfg.lora_name.trim() && cfg.lora_name.trim().toLowerCase() !== 'none';
                const hasLoRAChain = Array.isArray(cfg.lora_chain) && cfg.lora_chain.length > 0;
                const hasLoRANames = Array.isArray(cfg.lora_names) && cfg.lora_names.filter(n => String(n).trim().toLowerCase() !== 'none').length > 0;
                const hasAnyLoRA = hasLoRAName || hasLoRAChain || hasLoRANames;
                // If stale *_lora type but no LoRA now, strip suffix
                if (workflowType.endsWith('_lora') && !hasAnyLoRA) {
                    workflowType = workflowType.replace(/_lora$/, '');
                }
                const labelMap = {
                    'hires_lora': 'Hires Fix + LoRA',
                    'hires': 'Hires Fix',
                    'hires_input_image_lora': 'Hires Input Image + LoRA',
                    'hires_input_image': 'Hires Input Image',
                    'sdxl_lora': 'SDXL + LoRA',
                    'lora': 'SDXL + LoRA',
                    'standard': 'Standard'
                };
                let label = labelMap[workflowType];
                if (!label && workflowType.endsWith('_lora')) {
                    const baseType = workflowType.replace(/_lora$/, '');
                    if (labelMap[baseType]) {
                        label = hasAnyLoRA ? `${labelMap[baseType]} + LoRA` : labelMap[baseType];
                    }
                }
                if (!label) {
                    const templateLower = workflowTemplate.toLowerCase();
                    if (templateLower.includes('hiresfix') && templateLower.includes('input_image')) {
                        label = (templateLower.includes('lora') && hasAnyLoRA) ? 'Hires Input Image + LoRA' : 'Hires Input Image';
                    } else if (templateLower.includes('hiresfix')) {
                        label = (templateLower.includes('lora') && hasAnyLoRA) ? 'Hires Fix + LoRA' : 'Hires Fix';
                    } else if (templateLower.includes('lora') && hasAnyLoRA) {
                        label = 'SDXL + LoRA';
                    }
                }
                if (!label) {
                    const width = Number(cfg.width);
                    const height = Number(cfg.height);
                    const baseWidth = Number(cfg.hires_base_width);
                    const baseHeight = Number(cfg.hires_base_height);
                    const widthHires = Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth + 4;
                    const heightHires = Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight + 4;
                    const noBaseData = (!Number.isFinite(baseWidth) || baseWidth <= 0) && (!Number.isFinite(baseHeight) || baseHeight <= 0);
                    const bigDimension = (Number.isFinite(width) && width >= 1536) || (Number.isFinite(height) && height >= 1536);
                    if (widthHires || heightHires || (noBaseData && bigDimension)) {
                        label = hasAnyLoRA ? 'Hires Fix + LoRA' : 'Hires Fix';
                    }
                }
                if (!label) {
                    label = hasAnyLoRA ? 'SDXL + LoRA' : 'Standard';
                }
                if (workflowTemplate && workflowTemplate.toLowerCase() !== 'standard') {
                    return label ? `${label} (${workflowTemplate})` : workflowTemplate;
                }
                return label;
            };

            const promptRows = ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative']
                .map(key => buildRow(key.charAt(0).toUpperCase() + key.slice(1), cfg[key]))
                .filter(Boolean)
                .join('');
            const createdText = it.createdAt ? new Date(it.createdAt * 1000).toLocaleString('vi-VN') : '';
            const renderTime = it.creationTime ? `${Number(it.creationTime).toFixed(2)} giây` : '';
            const infoGrid = `<div class="info-grid">${
                buildRow('Model', cfg.ckpt_name?.split('.')[0])
            }${
                buildRow('Sampler', `${cfg.sampler_name} (${cfg.scheduler})`)
            }${
                buildRow('Image Size', `${cfg.width}x${cfg.height}`)
            }${
                buildRow('Steps', cfg.steps)
            }${
                buildRow('CFG', cfg.cfg)
            }${
                (() => {
                    const displayLoRA = () => {
                        if (Array.isArray(cfg.lora_chain) && cfg.lora_chain.length) {
                            return cfg.lora_chain.map(item => {
                                const n = String(item.lora_name || item.name || '').trim();
                                if (!n) return null;
                                const sm = item.strength_model ?? item.lora_strength_model;
                                const sc = item.strength_clip ?? item.lora_strength_clip;
                                if (sm != null && sc != null && Number.isFinite(Number(sm)) && Number.isFinite(Number(sc))) {
                                    return `${n}(${Number(sm).toFixed(2)}/${Number(sc).toFixed(2)})`;
                                }
                                return n;
                            }).filter(Boolean).join(', ');
                        }
                        if (Array.isArray(cfg.lora_names) && cfg.lora_names.length) {
                            return cfg.lora_names.join(', ');
                        }
                        return cfg.lora_name;
                    };
                    return buildRow('LoRA', displayLoRA());
                })()
            }${
                buildRow('Workflow', resolveWorkflowDisplay())
            }</div>`;
            const loraTags = (() => {
                // Prefer structured multi-LoRA groups if present
                if (Array.isArray(cfg.multi_lora_prompt_groups)) {
                    const parts = cfg.multi_lora_prompt_groups
                        .map(arr => Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [])
                        .map(groupList => groupList.length ? `(${groupList.join(', ')})` : '')
                        .filter(Boolean);
                    if (parts.length) return parts.join(', ');
                }
                // Then accept legacy combined string if available
                if (typeof cfg.multi_lora_prompt_tags === 'string' && cfg.multi_lora_prompt_tags.trim()) {
                    return cfg.multi_lora_prompt_tags.trim();
                }
                // Fallback to legacy single-LoRA array
                if (Array.isArray(cfg.lora_prompt_tags)) {
                    return cfg.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean).join(', ');
                }
                return '';
            })();
            const loraTagsBlock = loraTags ? buildRow('LoRA Tags', loraTags) : '';
            const sections = [];
            if (promptRows) sections.push(promptRows, '<hr>');
            sections.push(infoGrid);
            if (loraTagsBlock) sections.push(loraTagsBlock);
            if (createdText || renderTime) sections.push('<hr>');
            if (createdText) sections.push(buildRow('Created', createdText));
            if (renderTime) sections.push(buildRow('Render time', renderTime));
            return sections.filter(Boolean).join('').trim();
        };

        if (viewerHelpers?.buildInfoPanel) {
            try {
                return viewerHelpers.buildInfoPanel(item);
            } catch (err) {
                console.warn('[Album] viewerHelpers.buildInfoPanel error:', err);
            }
        }

        return fallbackInfoPanel(item);
    };

    proto.renderImageViewer = function (imgData) {
        const startIndex = this.state.allImageData.findIndex(img => img.id === imgData.id);
        const tasksForThisChar = this.contentArea.querySelectorAll('.plugin-album__grid .placeholder-card').length;
        const isGenDisabled = tasksForThisChar >= 5 || !this.state.isComfyUIAvaidable;
        const viewerHelpers = window.Yuuka?.viewerHelpers;
        const renderInfoPanel = (item) => this._viewerRenderInfoPanel(item);

        const isImageHiresFn = (item) => {
            if (viewerHelpers?.isImageHires) {
                try {
                    return viewerHelpers.isImageHires(item);
                } catch (err) {
                    console.warn('[Album] viewerHelpers.isImageHires error:', err);
                }
            }
            const cfg = item?.generationConfig || {};
            if (!cfg || Object.keys(cfg).length === 0) return true;
            let hiresFlag = cfg.hires_enabled;
            if (typeof hiresFlag === 'string') {
                hiresFlag = hiresFlag.trim().toLowerCase() === 'true';
            }
            if (hiresFlag) return true;

            const width = Number(cfg.width);
            const baseWidth = Number(cfg.hires_base_width || cfg.width);
            if (Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth) {
                return true;
            }

            const height = Number(cfg.height);
            const baseHeight = Number(cfg.hires_base_height || cfg.height);
            if (Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight) {
                return true;
            }

            return false;
        };

        const copyPromptHandler = (item) => {
            const cfg = item.generationConfig;
            const keys = ['outfits', 'expression', 'action', 'context', 'quality', 'negative'];
            const clipboardData = keys.map(key => [key, cfg[key] ? String(cfg[key]).trim() : '']);
            this._setPromptClipboard(clipboardData);
            showError('Prompt đã sao chép.');
        };

        const deleteHandler = async (item, close, updateItems) => {
            if (await Yuuka.ui.confirm('Có chắc chắn muốn xóa ảnh này?')) {
                try {
                    await this.api.images.delete(item.id);
                    Yuuka.events.emit('image:deleted', { imageId: item.id });

                    const updatedItems = this.state.allImageData
                        .filter(img => img.id !== item.id)
                        .map(d => ({ ...d, imageUrl: d.url }));
                    updateItems(updatedItems);
                } catch (err) {
                    showError(`Lỗi xóa: ${err.message}`);
                }
            }
        };

        let actionButtons;
        if (viewerHelpers?.createActionButtons) {
            actionButtons = viewerHelpers.createActionButtons({
                regen: {
                    disabled: () => isGenDisabled,
                    onClick: (item, close) => {
                        close();
                        this._startGeneration(item.generationConfig);
                    }
                },
                hires: {
                    disabled: (item) => isGenDisabled || isImageHiresFn(item),
                    onClick: (item) => this._startHiresUpscale(item)
                },
                copy: {
                    onClick: copyPromptHandler
                },
                delete: {
                    onClick: deleteHandler
                }
            });
        } else {
            actionButtons = [
                {
                    id: 'regen',
                    icon: 'auto_awesome',
                    title: 'Re-generate',
                    disabled: () => isGenDisabled,
                    onClick: (item, close) => {
                        close();
                        this._startGeneration(item.generationConfig);
                    }
                },
                {
                    id: 'hires',
                    icon: 'wand_stars',
                    title: 'Hires x2',
                    disabled: (item) => isGenDisabled || isImageHiresFn(item),
                    onClick: (item) => this._startHiresUpscale(item)
                },
                {
                    id: 'copy',
                    icon: 'content_copy',
                    title: 'Copy Prompt',
                    onClick: copyPromptHandler
                },
                {
                    id: 'delete',
                    icon: 'delete',
                    title: 'Remove Image',
                    onClick: deleteHandler
                }
            ];
        }

        this.viewer.open({
            items: this.state.allImageData.map(d => ({ ...d, imageUrl: d.url })),
            startIndex,
            renderInfoPanel,
            actionButtons
        });
    };
})();
