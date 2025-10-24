class DiscordBotComponent {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;
        this.pluginApi = this.api['discord-bot'];

        this._currentPage = null;
        this._currentPageName = null;
    }

    async init() {
        await this.switchPage('DashboardPage');
    }

    destroy() {
        this._teardownCurrentPage();
        this.container.innerHTML = '';
        this.container.classList.remove('plugin-discord-bot');
    }

    async switchPage(pageName) {
        const PageClass = this._resolvePage(pageName);
        this._teardownCurrentPage();

        const pageInstance = new PageClass(this.container, this.api, this.activePlugins);
        if (this.pluginApi && !pageInstance.pluginApi) {
            pageInstance.pluginApi = this.pluginApi;
        }

        this._currentPage = pageInstance;
        this._currentPageName = pageName;

        if (typeof pageInstance.init === 'function') {
            await pageInstance.init();
        }

        return pageInstance;
    }

    _teardownCurrentPage() {
        if (this._currentPage && typeof this._currentPage.destroy === 'function') {
            this._currentPage.destroy();
        }
        this._currentPage = null;
        this._currentPageName = null;
    }

    _resolvePage(pageName) {
        const root = (((window.Yuuka || {}).pages || {}).discordBot) || {};
        const PageClass = root[pageName];
        if (!PageClass) {
            throw new Error(`[DiscordBotComponent] Page '${pageName}' is not registered.`);
        }
        return PageClass;
    }
}

window.Yuuka = window.Yuuka || {};
window.Yuuka.components = window.Yuuka.components || {};
window.Yuuka.components['DiscordBotComponent'] = DiscordBotComponent;
