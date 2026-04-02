/**
 * Module-related utilities for Discord Bot plugin
 */

(function() {
    'use strict';

    window.Yuuka = window.Yuuka || {};
    window.Yuuka.utils = window.Yuuka.utils || {};
    window.Yuuka.utils.discordBot = window.Yuuka.utils.discordBot || {};

    const utils = window.Yuuka.utils.discordBot;

    /**
     * Tạo cache key cho module UI
     * @param {string} moduleId - Module ID
     * @param {string} botId - Bot ID (optional)
     * @returns {string} - Cache key dạng "botId::moduleId"
     */
    utils.createModuleUiCacheKey = function(moduleId, botId = null) {
        const safeBotId = botId || '_no_bot';
        return `${safeBotId}::${moduleId}`;
    };

    /**
     * Resolve status metadata từ bot state
     * @param {string} state - Bot state (running, starting, stopping, error, idle, stopped)
     * @returns {Object} - Object với icon, label, tone
     */
    utils.resolveStatusMeta = function(state) {
        const map = {
            running:  { icon: 'play_circle', label: 'Running', tone: 'success' },
            starting: { icon: 'pending', label: 'Starting', tone: 'info' },
            stopping: { icon: 'hourglass_bottom', label: 'Stopping', tone: 'warning' },
            error:    { icon: 'error', label: 'Error', tone: 'danger' },
            idle:     { icon: 'pause_circle', label: 'Idle', tone: 'muted' },
            stopped:  { icon: 'stop_circle', label: 'Stopped', tone: 'muted' },
        };
        return map[state] || map.stopped;
    };

    /**
     * Normalize token để so sánh module names
     * @param {string} value - Giá trị cần normalize
     * @returns {string} - Token đã normalize
     */
    utils.normalizeToken = function(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[._-]+/g, ' ')
            .replace(/\s+/g, ' ');
    };

    /**
     * Phân loại modules thành groups (core, normal, admin)
     * @param {Array} modules - Danh sách modules
     * @returns {Object} - Object với keys: core, normal, admin (mỗi key là array)
     */
    utils.groupModulesByType = function(modules) {
        const groups = {
            core: [],
            normal: [],
            admin: [],
        };

        for (const module of modules) {
            const moduleType = module?.type === 'core'
                ? 'core'
                : (module?.type === 'admin' || module?.admin ? 'admin' : 'normal');
            groups[moduleType].push(module);
        }

        return groups;
    };

    /**
     * Xác định module type từ module object
     * @param {Object} module - Module object
     * @returns {string} - 'core', 'admin', hoặc 'normal'
     */
    utils.getModuleType = function(module) {
        if (!module) return 'normal';
        if (module.type === 'core') return 'core';
        if (module.type === 'admin' || module.admin) return 'admin';
        return 'normal';
    };
})();
