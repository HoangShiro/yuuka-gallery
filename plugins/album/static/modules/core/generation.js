(function () {
    // Module: Generation payload normalization + workflow analysis
    // Pattern: prototype augmentation (no bundler / ESM)
    if (typeof AlbumComponent === 'undefined') return;

    const proto = AlbumComponent.prototype;

    proto._analyzeWorkflowConfig = function (cfg = {}) {
        const normalizeStr = (value) => typeof value === 'string' ? value.trim() : '';
        const toBool = (value) => {
            if (typeof value === 'boolean') return value;
            if (typeof value === 'number') return value !== 0;
            if (typeof value === 'string') {
                const lowered = value.trim().toLowerCase();
                return ['1', 'true', 'yes', 'on'].includes(lowered);
            }
            return false;
        };
        const toNumber = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };

        const workflowTemplate = normalizeStr(cfg.workflow_template || cfg._workflow_template || '');
        const workflowTypeRaw = normalizeStr(cfg.workflow_type || cfg._workflow_type || '');
        let workflowType = workflowTypeRaw.toLowerCase();
        const templateLower = workflowTemplate.toLowerCase();

        const loraName = normalizeStr(cfg.lora_name);
        const hasLoRA = Boolean(loraName) && loraName.toLowerCase() !== 'none';

        let hiresEnabled = toBool(cfg.hires_enabled);

        const width = toNumber(cfg.width);
        const height = toNumber(cfg.height);
        let baseWidth = toNumber(cfg.hires_base_width);
        let baseHeight = toNumber(cfg.hires_base_height);

        const widthExceedsBase = Number.isFinite(width) && Number.isFinite(baseWidth) && baseWidth > 0 && width > baseWidth + 4;
        const heightExceedsBase = Number.isFinite(height) && Number.isFinite(baseHeight) && baseHeight > 0 && height > baseHeight + 4;

        if (!hiresEnabled) {
            if (workflowType.includes('hires') || templateLower.includes('hiresfix')) {
                hiresEnabled = true;
            } else if (widthExceedsBase || heightExceedsBase) {
                hiresEnabled = true;
            }
        }

        const bigDimensionDetected = (
            (Number.isFinite(width) && width >= 1536) ||
            (Number.isFinite(height) && height >= 1536)
        );
        if (!hiresEnabled && bigDimensionDetected && (!Number.isFinite(baseWidth) || baseWidth === null || baseWidth <= 0)) {
            hiresEnabled = true;
        }

        if (hiresEnabled) {
            if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
                if (Number.isFinite(width) && width > 0) {
                    baseWidth = Math.max(64, Math.round(width / 2));
                }
            }
            if (!Number.isFinite(baseHeight) || baseHeight <= 0) {
                if (Number.isFinite(height) && height > 0) {
                    baseHeight = Math.max(64, Math.round(height / 2));
                }
            }
        }

        if (!workflowType) {
            if (hiresEnabled) {
                workflowType = hasLoRA ? 'hires_lora' : 'hires';
            } else if (hasLoRA) {
                workflowType = 'sdxl_lora';
            } else {
                workflowType = 'standard';
            }
        }

        return {
            isHires: Boolean(hiresEnabled),
            hasLoRA,
            workflowTemplate,
            workflowType,
            baseWidth: Number.isFinite(baseWidth) && baseWidth > 0 ? Math.round(baseWidth) : null,
            baseHeight: Number.isFinite(baseHeight) && baseHeight > 0 ? Math.round(baseHeight) : null
        };
    };

    // Mutates payload in place to preserve existing behavior.
    proto._normalizeGenerationPayload = function (payload, configOverrides = {}) {
        // --- Multi-LoRA payload normalization v1.0 ---
        // Prefer lora_chain if present, otherwise accept lora_names; keep single lora_name for backward-compat.
        const incomingChain = Array.isArray(configOverrides?.lora_chain)
            ? configOverrides.lora_chain
            : (Array.isArray(payload.lora_chain) ? payload.lora_chain : null);
        if (incomingChain && incomingChain.length) {
            const cleanedChain = incomingChain
                .map(entry => {
                    if (!entry) return null;
                    const name = String(entry.lora_name || entry.name || '').trim();
                    if (!name || name.toLowerCase() === 'none') return null;
                    const toNum = (v, d) => {
                        const n = Number(v);
                        return Number.isFinite(n) ? n : d;
                    };
                    const sm = toNum(entry.strength_model ?? entry.lora_strength_model ?? payload.lora_strength_model, 1.0);
                    const sc = toNum(entry.strength_clip ?? entry.lora_strength_clip ?? payload.lora_strength_clip, 1.0);
                    return { lora_name: name, strength_model: sm, strength_clip: sc };
                })
                .filter(Boolean);
            if (cleanedChain.length) {
                payload.lora_chain = cleanedChain;
                payload.lora_names = cleanedChain.map(c => c.lora_name);
                if (cleanedChain.length === 1) {
                    payload.lora_name = cleanedChain[0].lora_name;
                    payload.lora_strength_model = cleanedChain[0].strength_model;
                    payload.lora_strength_clip = cleanedChain[0].strength_clip;
                } else {
                    payload.lora_name = 'None';
                }
            }
        } else if (Array.isArray(configOverrides?.lora_names) && configOverrides.lora_names.length) {
            const names = configOverrides.lora_names.map(n => String(n).trim()).filter(n => n && n.toLowerCase() !== 'none');
            if (names.length) {
                payload.lora_names = names;
                payload.lora_name = names.length === 1 ? names[0] : 'None';
            }
        }
        // --- End Multi-LoRA normalization ---

        if (configOverrides.seed === undefined) payload.seed = 0;
        if (Array.isArray(payload.lora_prompt_tags)) {
            payload.lora_prompt_tags = payload.lora_prompt_tags.map(tag => String(tag).trim()).filter(Boolean);
        } else if (payload.lora_prompt_tags) {
            const tagText = String(payload.lora_prompt_tags).trim();
            payload.lora_prompt_tags = tagText ? [tagText] : [];
        } else {
            payload.lora_prompt_tags = [];
        }

        const analysis = this._analyzeWorkflowConfig(payload);
        payload.hires_enabled = analysis.isHires;
        if (analysis.baseWidth) {
            const currentBaseWidth = Number(payload.hires_base_width);
            if (!Number.isFinite(currentBaseWidth) || currentBaseWidth <= 0) {
                payload.hires_base_width = analysis.baseWidth;
            }
        }
        if (analysis.baseHeight) {
            const currentBaseHeight = Number(payload.hires_base_height);
            if (!Number.isFinite(currentBaseHeight) || currentBaseHeight <= 0) {
                payload.hires_base_height = analysis.baseHeight;
            }
        }
        // Always (re)compute workflow_type to avoid stale *_lora after removing LoRA
        if (analysis.workflowType) {
            payload.workflow_type = analysis.workflowType;
        }
        if (analysis.workflowTemplate && !payload.workflow_template) {
            payload.workflow_template = analysis.workflowTemplate;
        }

        if (payload.hires_enabled) {
            delete payload._workflow_type;
        } else if (analysis.hasLoRA) {
            payload._workflow_type = 'sdxl_lora';
        } else {
            delete payload._workflow_type;
            if (typeof payload.workflow_type === 'string' && /_lora$/.test(payload.workflow_type) && !analysis.hasLoRA) {
                payload.workflow_type = 'standard';
            }
        }

        return analysis;
    };

    // Decide whether this generation should go through the alpha route.
    // We keep the heuristic conservative: only switch when an explicit flag is present,
    // or when workflow identifiers clearly mention alpha.
    proto._shouldUseAlphaGenerationRoute = function (generationConfig = {}, context = {}) {
        try {
            const cfg = (generationConfig && typeof generationConfig === 'object') ? generationConfig : {};
            const ctx = (context && typeof context === 'object') ? context : {};

            const flag = (v) => (v === true || v === 1 || v === '1' || String(v || '').trim().toLowerCase() === 'true');

            // Explicit flags (preferred)
            if (flag(ctx.Alpha) || flag(ctx.alpha)) return true;
            if (flag(cfg.Alpha) || flag(cfg.alpha) || flag(cfg.is_alpha) || flag(cfg.isAlpha) || flag(cfg.use_alpha) || flag(cfg.useAlpha)) return true;

            // Workflow naming heuristic
            const wfTemplate = String(cfg.workflow_template || cfg._workflow_template || '').trim().toLowerCase();
            const wfType = String(cfg.workflow_type || cfg._workflow_type || '').trim().toLowerCase();
            if (wfTemplate.includes('alpha') || wfType.includes('alpha')) return true;
        } catch (e) {
            // Fall back to non-alpha route
        }
        return false;
    };
})();
