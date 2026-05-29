(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    class LiveGenWebSocket {
        constructor(component) {
            this.component = component;
            this.state = component.state;
            this.ws = null;
            this.reconnectTimer = null;
        }

        connect() {
            if (this.component.destroyed) return;
            const token = localStorage.getItem("yuuka-auth-token") || "";
            if (!token) {
                this.component._setStatus("Thiếu token đăng nhập.", "error");
                return;
            }

            this.close(false);
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const url = `${protocol}//${window.location.host}/ws/live-gen?token=${encodeURIComponent(token)}`;
            this.ws = new WebSocket(url);

            this.ws.onopen = () => {
                this.state.connected = true;
                this.component._setStatus("Sẵn sàng.", "ready");
                if (this.state.prompt.trim()) {
                    this.component._scheduleGeneration(80);
                }
            };

            this.ws.onmessage = (event) => {
                this.component._handleMessage(event.data);
            };

            this.ws.onerror = () => {
                this.component._setStatus("WebSocket lỗi.", "error");
            };

            this.ws.onclose = () => {
                this.state.connected = false;
                if (this.component.destroyed) return;
                this.component._setStatus("Đang kết nối lại...", "idle");
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => this.connect(), 1500);
            };
        }

        close(sendCancel = true) {
            if (!this.ws) return;
            if (sendCancel) this.send({ type: "cancel" });
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch (_) {}
            this.ws = null;
            clearTimeout(this.reconnectTimer);
        }

        send(payload) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
            this.ws.send(JSON.stringify(payload));
            return true;
        }
    }

    window.Yuuka.liveGen.WebSocket = LiveGenWebSocket;
})();
