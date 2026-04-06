window.Yuuka = window.Yuuka || {};
window.Yuuka.plugins = window.Yuuka.plugins || {};
window.Yuuka.plugins.discordBotRenderers = window.Yuuka.plugins.discordBotRenderers || {};

window.Yuuka.plugins.discordBotRenderers['brain-abilities'] = {
    render: function(dashboard, module, moduleUi) {
        const bot = dashboard.state.activeBot;
        if (!bot) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Module abilities</h4>
                    <p>Create or connect a bot first to manage tool toggles for Brain.</p>
                </section>
            `;
        }
        const activeModules = new Set(bot.modules || []);
        const groups = (Array.isArray(moduleUi.ability_groups) ? moduleUi.ability_groups : [])
            .filter((group) => activeModules.has(group.module_id))
            .filter((group) => Array.isArray(group.tools) && group.tools.length);
        if (!groups.length) {
            return `
                <section class="discord-bot-module-page-section">
                    <h4>Module abilities</h4>
                    <p>No tools were registered by the currently enabled modules.</p>
                </section>
            `;
        }
        const groupsHtml = groups.map((group) => {
            const moduleName = dashboard.Utils.escapeHtml(group.module_name || group.module_id || 'Unknown module');
            const moduleId = dashboard.Utils.escapeHtml(group.module_id || '');
            const instructions = Array.isArray(group.instructions) ? group.instructions : [];
            const instructionsHtml = instructions.length
                ? `<div class="discord-brain-abilities__instructions">${instructions.map((item) => `<div class="discord-brain-abilities__instruction">${dashboard.Utils.escapeHtml(item)}</div>`).join('')}</div>`
                : '';
            const detailsInstructionsHtml = instructions.length
                ? `<ul class="discord-brain-tool-card__instruction-list">${instructions.map((item) => `<li>${dashboard.Utils.escapeHtml(item)}</li>`).join('')}</ul>`
                : `<p class="discord-brain-tool-card__instruction-empty">No context instruction registered by this module.</p>`;
            const tools = Array.isArray(group.tools) ? group.tools : [];
            const toolRows = tools.map((tool) => {
                const title = dashboard.Utils.escapeHtml(tool.title || tool.tool_id || 'Tool');
                const description = dashboard.Utils.escapeHtml(tool.description || '');
                const key = dashboard.Utils.escapeHtml(tool.key || '');
                const toolId = dashboard.Utils.escapeHtml(tool.tool_id || '');
                const enabled = tool.enabled ? 'checked' : '';
                return `
                    <article class="discord-brain-tool-card" data-role="brain-tool-card">
                        <div class="discord-brain-tool-card__header">
                            <div class="discord-brain-tool-card__meta">
                                <h5>${title}</h5>
                                <p>${description}</p>
                            </div>
                            <label class="yuuka-switch discord-brain-tool-card__toggle">
                                <input type="checkbox" data-role="brain-tool-toggle" data-tool-key="${key}" ${enabled} />
                                <span class="yuuka-switch__slider"></span>
                            </label>
                        </div>
                        <div class="discord-brain-tool-card__details" data-role="brain-tool-details" hidden>
                            <div class="discord-brain-tool-card__detail-block">
                                <span class="discord-brain-tool-card__detail-label">Tool</span>
                                <div class="discord-brain-tool-card__detail-value">${title}</div>
                                <div class="discord-brain-tool-card__detail-id">${toolId}</div>
                            </div>
                            <div class="discord-brain-tool-card__detail-block">
                                <span class="discord-brain-tool-card__detail-label">Registered context instructions</span>
                                ${detailsInstructionsHtml}
                            </div>
                        </div>
                    </article>
                `;
            }).join('');
            return `
                <section class="discord-bot-module-page-section discord-brain-abilities__group">
                    <div class="discord-brain-abilities__header">
                        <h4>${moduleName}</h4>
                        <span class="discord-brain-abilities__module-id">${moduleId}</span>
                    </div>
                    ${instructionsHtml}
                    <div class="discord-brain-tool-list">${toolRows}</div>
                </section>
            `;
        }).join('');
        return `
            <section class="discord-bot-module-page-section">
                <h4>Module abilities</h4>
                <p>Brain collects instructions and tools from enabled modules. Tool toggles are ON by default and can be changed per bot.</p>
            </section>
            ${groupsHtml}
        `;
    },

    onClick: function(dashboard, event) {
        const card = event.target.closest('[data-role="brain-tool-card"]');
        if (!card || !dashboard.modulePageBodyEl?.contains(card)) {
            return false;
        }
        if (event.target.closest('[data-role="brain-tool-toggle"], .yuuka-switch')) {
            return false;
        }
        const details = card.querySelector('[data-role="brain-tool-details"]');
        if (!details) {
            return false;
        }
        const isExpanded = card.classList.contains('discord-brain-tool-card--expanded');
        card.classList.toggle('discord-brain-tool-card--expanded', !isExpanded);
        details.hidden = isExpanded;
        return true;
    }
};
