/**
 * DOM manipulation utilities for Discord Bot plugin
 */

(function() {
    'use strict';

    window.Yuuka = window.Yuuka || {};
    window.Yuuka.utils = window.Yuuka.utils || {};
    window.Yuuka.utils.discordBot = window.Yuuka.utils.discordBot || {};

    const utils = window.Yuuka.utils.discordBot;

    /**
     * Auto-scroll element xuống bottom nếu checkbox được check
     * @param {HTMLElement} element - Element cần scroll
     * @param {HTMLInputElement} autoScrollCheckbox - Checkbox điều khiển auto-scroll
     */
    utils.scrollToBottom = function(element, autoScrollCheckbox) {
        if (!element || !autoScrollCheckbox || !autoScrollCheckbox.checked) {
            return;
        }
        requestAnimationFrame(() => {
            element.scrollTop = element.scrollHeight;
        });
    };

    /**
     * Kiểm tra xem element có đang ở gần bottom không
     * @param {HTMLElement} element - Element cần kiểm tra
     * @param {number} threshold - Ngưỡng pixel (default: 32)
     * @returns {boolean} - True nếu gần bottom
     */
    utils.isNearBottom = function(element, threshold = 32) {
        if (!element || element.clientHeight === 0) {
            return false;
        }
        return (element.scrollTop + element.clientHeight) >= (element.scrollHeight - threshold);
    };

    /**
     * Collect các module đã được check từ module grid
     * @param {HTMLElement} moduleGridEl - Module grid element
     * @param {Array} modules - Danh sách tất cả modules
     * @returns {Array<string>} - Array các module IDs đã chọn (bao gồm core modules)
     */
    utils.collectSelectedModules = function(moduleGridEl, modules) {
        if (!moduleGridEl || !Array.isArray(modules)) {
            return [];
        }
        
        const selectedModules = Array
            .from(moduleGridEl.querySelectorAll('input.discord-bot-module-checkbox:checked'))
            .map((input) => input.value);
        
        const coreModules = modules
            .filter((module) => module?.type === 'core')
            .map((module) => module.id);
        
        return [...new Set([...selectedModules, ...coreModules])];
    };

    /**
     * Tạo debounced function với timeout
     * @param {Function} callback - Function cần gọi
     * @param {number} delay - Delay milliseconds
     * @returns {Object} - Object với schedule() và cancel() methods
     */
    utils.createDebouncedScheduler = function(callback, delay = 2000) {
        let timeoutId = null;
        
        return {
            schedule() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(() => {
                    timeoutId = null;
                    callback();
                }, delay);
            },
            cancel() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            }
        };
    };
})();
