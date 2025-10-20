// --- NEW FILE: static/viewer_helpers.js ---
(function () {
    window.Yuuka = window.Yuuka || {};

    const ensureNamespace = () => {
        window.Yuuka.viewerHelpers = window.Yuuka.viewerHelpers || {};
    };

    const normalizeText = (value) => {
        if (value === undefined || value === null) return '';
        return String(value).trim();
    };

    const buildInfoPanel = (item) => {
        if (!item || !item.generationConfig) return "No information available.";
        const cfg = item.generationConfig;
        const buildRow = (label, value) => {
            if (!value || (typeof value === 'string' && value.trim() === '')) return '';
            const span = document.createElement('span');
            span.textContent = value;
            return `<div class="info-row"><strong>${label}:</strong> <span>${span.innerHTML}</span></div>`;
        };

        const promptRows = ['character', 'outfits', 'expression', 'action', 'context', 'quality', 'negative']
            .map(key => buildRow(key.charAt(0).toUpperCase() + key.slice(1), cfg[key]))
            .filter(Boolean)
            .join('');

        const createdText = item.createdAt ? new Date(item.createdAt * 1000).toLocaleString('vi-VN') : '';
        const renderTime = item.creationTime
            ? `${Number(item.creationTime).toFixed(2)} giay`
            : (item.creationTime === 0 ? '0.00 giay' : '');

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
            buildRow('LoRA', cfg.lora_name)
        }</div>`;

        const loraTags = Array.isArray(cfg.lora_prompt_tags)
            ? cfg.lora_prompt_tags.map(tag => normalizeText(tag)).filter(Boolean).join(', ')
            : normalizeText(cfg.lora_prompt_tags);
        const loraTagsBlock = loraTags ? buildRow('LoRA Tags', loraTags) : '';

        const sections = [];
        if (promptRows) sections.push(promptRows, '<hr>');
        sections.push(infoGrid);
        if (loraTagsBlock) sections.push(loraTagsBlock);
        if (createdText || renderTime) sections.push('<hr>');
        if (createdText) sections.push(buildRow('Created', createdText));
        if (renderTime) sections.push(buildRow('Render time', renderTime));
        return sections.filter(Boolean).join('').trim() || "No information available.";
    };

    const normalizeDisabled = (value) => {
        if (typeof value === 'function') return value;
        if (value === undefined || value === null) return null;
        const fixed = !!value;
        return () => fixed;
    };

    const isImageHires = (item) => {
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

    const createActionButtons = (config = {}) => {
        const buttons = [];

        if (config.regen && typeof config.regen.onClick === 'function') {
            buttons.push({
                id: 'regen',
                icon: 'auto_awesome',
                title: config.regen.title || 'Re-Generate',
                disabled: normalizeDisabled(config.regen.disabled),
                onClick: config.regen.onClick,
            });
        }

        if (config.hires && typeof config.hires.onClick === 'function') {
            buttons.push({
                id: 'hires',
                icon: 'wand_stars',
                title: config.hires.title || 'Hires x2',
                disabled: normalizeDisabled(config.hires.disabled),
                onClick: config.hires.onClick,
            });
        }

        if (config.copy && typeof config.copy.onClick === 'function') {
            buttons.push({
                id: 'copy',
                icon: 'content_copy',
                title: config.copy.title || 'Copy Prompt',
                onClick: config.copy.onClick,
            });
        }

        if (config.delete && typeof config.delete.onClick === 'function') {
            buttons.push({
                id: 'delete',
                icon: 'delete',
                title: config.delete.title || 'Remove Image',
                onClick: config.delete.onClick,
            });
        }

        return buttons;
    };

    ensureNamespace();
    window.Yuuka.viewerHelpers.buildInfoPanel = buildInfoPanel;
    window.Yuuka.viewerHelpers.createActionButtons = createActionButtons;
    window.Yuuka.viewerHelpers.isImageHires = isImageHires;
})();
