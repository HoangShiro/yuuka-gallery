/**
 * Formatting utilities for Discord Bot plugin
 */

(function() {
    'use strict';

    window.Yuuka = window.Yuuka || {};
    window.Yuuka.utils = window.Yuuka.utils || {};
    window.Yuuka.utils.discordBot = window.Yuuka.utils.discordBot || {};

    const utils = window.Yuuka.utils.discordBot;

    /**
     * Escape HTML entities để tránh XSS
     * @param {*} value - Giá trị cần escape
     * @returns {string} - Chuỗi đã escape
     */
    utils.escapeHtml = function(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    /**
     * Format timestamp thành chuỗi hiển thị YYYY-MM-DD HH:MM:SS
     * @param {string|Date} value - Timestamp cần format
     * @returns {string} - Chuỗi đã format hoặc '---' nếu invalid
     */
    utils.formatDisplayTimestamp = function(value) {
        if (!value) {
            return '---';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        const pad = (num) => String(num).padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    /**
     * Format duration từ milliseconds thành HH:MM:SS
     * @param {number} ms - Milliseconds
     * @returns {string} - Chuỗi HH:MM:SS hoặc '--' nếu invalid
     */
    utils.formatDuration = function(ms) {
        if (!Number.isFinite(ms) || ms < 0) {
            return '--';
        }
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const parts = [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            seconds.toString().padStart(2, '0'),
        ];
        return parts.join(':');
    };

    /**
     * Tính uptime text từ bot object
     * @param {Object} bot - Bot object với started_at và state
     * @returns {string} - Uptime text hoặc '--'
     */
    utils.computeUptimeText = function(bot) {
        if (!bot || bot.state !== 'running' || !bot.started_at) {
            return '--';
        }
        const started = new Date(bot.started_at);
        if (Number.isNaN(started.getTime())) {
            return '--';
        }
        const diffMs = Date.now() - started.getTime();
        if (!Number.isFinite(diffMs) || diffMs <= 0) {
            return '--';
        }
        return utils.formatDuration(diffMs);
    };

    /**
     * Lấy display name từ bot object
     * @param {Object} bot - Bot object
     * @returns {string} - Display name (actual_name hoặc name)
     */
    utils.getBotDisplayName = function(bot) {
        if (!bot) return '';
        return bot.actual_name || bot.name || '';
    };
})();
