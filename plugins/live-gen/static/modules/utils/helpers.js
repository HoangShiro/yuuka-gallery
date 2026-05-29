(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    window.Yuuka.liveGen.helpers = {
        normalizePrompt(rawPrompt) {
            if (!rawPrompt) return "";
            let normalized = rawPrompt.replace(/[\r\n]+/g, ", ");
            normalized = normalized.replace(/,\s*,/g, ",");
            normalized = normalized.replace(/\s*,\s*/g, ", ");
            return normalized.trim().replace(/^,|,$/g, "").trim();
        },

        escapeHtml(str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        },

        escapeAttr(value) {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/[&<>"']/g, (char) => {
                    switch (char) {
                        case '&': return '&amp;';
                        case '<': return '&lt;';
                        case '>': return '&gt;';
                        case '"': return '&quot;';
                        case "'": return '&#39;';
                        default: return char;
                    }
                })
                .replace(/`/g, '&#96;');
        },

        truncateText(value, maxLength = 40) {
            if (value === null || value === undefined) return '';
            const text = String(value);
            if (text.length <= maxLength) return text;
            const suffix = '...';
            const sliceLength = Math.max(0, maxLength - suffix.length);
            return `${text.slice(0, sliceLength).trimEnd()}${suffix}`;
        },

        prettifyLabel(value) {
            if (typeof value !== 'string') return '';
            return value
                .replace(/[_-]+/g, ' ')
                .split(/\s+/)
                .filter(Boolean)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
    };
})();
