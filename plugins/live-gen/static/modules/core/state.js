(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const STORAGE_PROMPT = "yuuka.liveGen.prompt";
    const STORAGE_BLUR = "yuuka.liveGen.previewBlur";

    class LiveGenState {
        constructor() {
            this.prompt = localStorage.getItem(STORAGE_PROMPT) || "";
            this.seed = 123456789;
            this.connected = false;
            this.running = false;
            this.latestSeq = 0;
            this.keepActive = false;
            this.config = null;
            this.lastFinalImageBase64 = "";
            this.generationStartTime = 0;
            this.currentStep = 0;
        }

        setPrompt(val) {
            this.prompt = val;
            localStorage.setItem(STORAGE_PROMPT, val);
        }

        getPreviewBlur() {
            return parseFloat(localStorage.getItem(STORAGE_BLUR)) || 0;
        }

        setPreviewBlur(val) {
            localStorage.setItem(STORAGE_BLUR, val);
        }
    }

    window.Yuuka.liveGen.State = LiveGenState;
})();
