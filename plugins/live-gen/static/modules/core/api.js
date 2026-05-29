(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    class LiveGenApi {
        constructor(pluginApi, api) {
            this.pluginApi = pluginApi;
            this.api = api;
        }

        async getConfig() {
            return this.pluginApi.get("/config");
        }

        async saveConfig(config) {
            return this.pluginApi.post("/config", config);
        }

        async getComfyInfo() {
            return this.pluginApi.get("/comfy-info");
        }

        async getHistory() {
            return this.pluginApi.get("/history");
        }

        async getFavorites() {
            return this.pluginApi.get("/favorites");
        }

        async addFavorite(imageUrl) {
            return this.pluginApi.post("/favorite", { imageUrl });
        }

        async deleteImage(id) {
            return this.api.images.delete(id);
        }

        async getTags() {
            return this.api.getTags();
        }

        async getAllCharacters() {
            return this.api.getAllCharacters().catch(() => ({ characters: [] }));
        }
    }

    window.Yuuka.liveGen.Api = LiveGenApi;
})();
