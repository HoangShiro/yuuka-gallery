// --- NEW FILE: plugins/auth/static/auth_component.js ---
class AuthPluginComponent {
    constructor(_container, api) {
        this.api = api;
        this.authContainer = document.getElementById('auth-container');
        this.tokenKey = 'yuuka-auth-token';
        this.logoutMessageKey = 'yuuka-logout-message';
        this.bound = false;
    }

    init() {
        // No-op for now; service-style singleton
        return Promise.resolve();
    }

    // UI helpers
    _setLoggedInUI() {
        document.body.className = 'is-logged-in';
        if (this.authContainer) this.authContainer.innerHTML = '';
        const tabs = document.getElementById('tabs');
        if (tabs) tabs.style.display = '';
    }

    _setLoggedOutUI(message = '') {
        document.body.className = 'is-logged-out';
        if (!this.authContainer) return;
        const extra = message ? `<p class="error-msg">${message}</p>` : '';
        this.authContainer.innerHTML = `
            <div class="auth-form-wrapper">
                <h3>Xác thực</h3>
                <p>Nhập Token của bạn hoặc tạo một Token mới để tiếp tục.</p>
                ${extra}
                <form id="auth-form">
                    <input type="text" id="auth-token-input" placeholder="Nhập Token tại đây" autocomplete="off">
                    <button type="submit">Đăng nhập</button>
                    <button type="button" id="generate-token-btn">Tạo Token Mới</button>
                </form>
            </div>`;

        if (this.bound) return; // avoid double-binding on re-renders where innerHTML replaced
        this.bound = true;

        this.authContainer.addEventListener('submit', async (e) => {
            const form = e.target.closest('#auth-form');
            if (!form) return;
            e.preventDefault();
            const tokenInput = form.querySelector('#auth-token-input');
            const token = tokenInput.value.trim();
            if (!token) return;
            try {
                await this.api.auth.login(token);
                localStorage.setItem(this.tokenKey, token);
                window.Yuuka.events.emit('auth:login', { token });
            } catch (_) {
                this._setLoggedOutUI('Token không hợp lệ hoặc đã xảy ra lỗi.');
                this.bound = false; // will rebind after re-render
            }
        });

        this.authContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('#generate-token-btn');
            if (!btn) return;
            try {
                const data = await this.api.auth.generateToken();
                localStorage.setItem(this.tokenKey, data.token);
                try {
                    await window.Yuuka.ui.copyToClipboard(data.token);
                    window.showError?.('Token mới đã được tạo và sao chép!');
                } catch (copyErr) {
                    console.error('[Auth] Copy failed:', copyErr);
                    window.showError?.('Đã tạo token mới (không thể tự sao chép).');
                }
                window.Yuuka.events.emit('auth:login', { token: data.token, generated: true });
            } catch (error) {
                this._setLoggedOutUI(`Lỗi tạo token: ${error.message}`);
                this.bound = false;
            }
        });
    }

    // Public API
    getToken() {
        return localStorage.getItem(this.tokenKey);
    }

    async logout(copyToClipboard = true) {
        const token = this.getToken();
        if (token && copyToClipboard) {
            try {
                await window.Yuuka.ui.copyToClipboard(token);
                sessionStorage.setItem(this.logoutMessageKey, 'Đã đăng xuất. Token của bạn đã được sao chép vào clipboard.');
            } catch (err) {
                console.warn('[Auth] Could not copy token to clipboard:', err);
                sessionStorage.setItem(this.logoutMessageKey, 'Đã đăng xuất. (Không thể sao chép token.)');
            }
        } else {
            sessionStorage.setItem(this.logoutMessageKey, 'Đã đăng xuất.');
        }

        try { await this.api.auth.logout(); } catch (_) {}
        localStorage.removeItem(this.tokenKey);
        window.Yuuka.events.emit('auth:logout');
        window.location.reload();
    }

    copyTokenToClipboard() {
        const t = this.getToken();
        if (!t) return Promise.reject(new Error('Không tìm thấy token.'));
        return window.Yuuka.ui.copyToClipboard(t);
    }

    showLogin(message = '') {
        this._setLoggedOutUI(message);
    }

    showApp() {
        this._setLoggedInUI();
    }

    ensureLogoutMessage() {
        const msg = sessionStorage.getItem(this.logoutMessageKey);
        if (msg) {
            sessionStorage.removeItem(this.logoutMessageKey);
            window.showError?.(msg);
        }
    }
}

window.Yuuka = window.Yuuka || { components: {}, services: {}, events: { on(){}, emit(){} }, ui: {} };
window.Yuuka.components['AuthPluginComponent'] = AuthPluginComponent;
