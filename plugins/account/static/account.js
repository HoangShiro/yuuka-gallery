(function () {
    const COMPONENT_NAME = "AccountComponent";

    class AccountComponent {
        constructor(container, api, activePlugins) {
            this.container = container;
            this.api = api;
            this.activePlugins = activePlugins;
            this.pluginApi = api.account;
            this.users = [];
            this.isAdmin = false;
            this.searchQuery = "";
        }

        async init() {
            document.body.classList.add("account-plugin-active");
            this.renderLoading();
            await this.refreshStatus();
            
            if (!this.isAdmin) {
                this.renderAccessDenied();
                return;
            }

            await this.loadUsers();
            this.render();
        }

        async refreshStatus() {
            try {
                const res = await this.pluginApi.get("/status");
                this.isAdmin = res.is_admin;
            } catch (e) {
                this.isAdmin = false;
            }
        }

        async loadUsers() {
            try {
                const res = await this.pluginApi.get("/users");
                this.users = res.users;
                this.isAdmin = res.current_is_admin;
            } catch (e) {
                window.showError("Không thể tải danh sách người dùng.");
            }
        }

        renderLoading() {
            this.container.innerHTML = `<div class="loader visible">Đang kiểm tra quyền hạn...</div>`;
        }

        renderAccessDenied() {
            this.container.innerHTML = `
                <div class="admin-only-alert">
                    <span class="material-symbols-outlined" style="font-size: 4rem; color: var(--color-accent); margin-bottom: 20px;">lock</span>
                    <h2 class="account-title">Truy cập bị từ chối</h2>
                    <p>Bạn không có quyền quản trị viên (Admin) để xem trang này.</p>
                    <p style="font-size: 0.9rem; color: var(--color-secondary-text); margin-top: 20px;">
                        Mẹo: Account truy cập đầu tiên sẽ tự động được cấp quyền Admin.
                    </p>
                </div>`;
        }

        render() {
            const filteredUsers = this._getFilteredUsers();
            
            this.container.innerHTML = `
                <div class="account-container">
                    <div class="account-header">
                        <h2 class="account-title">Người dùng</h2>
                        
                        <div class="account-search-wrapper">
                            <input type="text" class="account-search-input" id="user-search-input" 
                                   placeholder="Tìm theo Token hoặc Hash..." value="${this.searchQuery}">
                            <button class="btn-clear-search ${this.searchQuery ? 'visible' : ''}" id="btn-clear-search" title="Clear">
                                <span class="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <button class="action-btn" id="btn-refresh-users" title="Làm mới">
                            <span class="material-symbols-outlined">refresh</span>
                        </button>
                    </div>
                    
                    <div class="user-table-wrapper">
                        <table class="user-table">
                            <thead>
                                <tr>
                                    <th>Token (8 ký tự đầu)</th>
                                    <th>Hash Key</th>
                                    <th>Vai trò</th>
                                    <th>Trạng thái</th>
                                    <th>Ngày đăng ký</th>
                                    <th style="text-align: right;">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody id="user-list-body">
                                ${filteredUsers.map(user => this.renderUserRow(user)).join('')}
                                ${filteredUsers.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--color-secondary-text);">Không tìm thấy người dùng phù hợp.</td></tr>` : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            this._attachUIEvents();
        }

        _getFilteredUsers() {
            if (!this.searchQuery) return this.users;
            const q = this.searchQuery.toLowerCase();
            return this.users.filter(u => 
                u.token.toLowerCase().includes(q) || 
                u.hash.toLowerCase().includes(q)
            );
        }

        _attachUIEvents() {
            const refreshBtn = this.container.querySelector("#btn-refresh-users");
            if (refreshBtn) {
                refreshBtn.onclick = async () => {
                    await this.loadUsers();
                    this.render();
                };
            }

            const searchInput = this.container.querySelector("#user-search-input");
            const clearBtn = this.container.querySelector("#btn-clear-search");

            if (searchInput) {
                searchInput.oninput = (e) => {
                    this.searchQuery = e.target.value;
                    if (this.searchQuery) clearBtn.classList.add('visible');
                    else clearBtn.classList.remove('visible');
                    this._updateUserTable();
                };
            }

            if (clearBtn) {
                clearBtn.onclick = () => {
                    this.searchQuery = "";
                    searchInput.value = "";
                    clearBtn.classList.remove('visible');
                    this._updateUserTable();
                    searchInput.focus();
                };
            }
        }

        _updateUserTable() {
            const filteredUsers = this._getFilteredUsers();
            const body = this.container.querySelector("#user-list-body");
            if (body) {
                body.innerHTML = filteredUsers.map(user => this.renderUserRow(user)).join('') + 
                    (filteredUsers.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--color-secondary-text);">Không tìm thấy người dùng phù hợp.</td></tr>` : '');
            }
        }

        renderUserRow(user) {
            const roleBadge = user.role === 'admin' ? 'badge-admin' : 'badge-user';
            const statusBadge = user.status === 'waiting' ? 'badge-waiting' : '';
            
            let regDateStr = "N/A";
            if (user.reg_time) {
                const d = new Date(user.reg_time * 1000);
                regDateStr = d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            }
            
            return `
                <tr class="user-row" data-token="${user.token}">
                    <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <code>${user.token.substring(0, 8)}...</code>
                            <span class="material-symbols-outlined" style="font-size: 14px; cursor: pointer;" 
                                  onclick="Yuuka.ui.copyToClipboard('${user.token}').then(() => showSuccess('Đã copy token!'))">content_copy</span>
                        </div>
                    </td>
                    <td class="hash-cell">${user.hash.substring(0, 12)}...</td>
                    <td><span class="badge ${roleBadge}">${user.role}</span></td>
                    <td><span class="badge ${statusBadge}">${user.status}</span></td>
                    <td style="font-size: 0.85rem; color: var(--color-secondary-text);">${regDateStr}</td>
                    <td class="user-actions">
                        ${user.status === 'waiting' ? `
                            <button class="action-btn btn-approve" title="Duyệt làm User" onclick="Yuuka.components.AccountComponent._handleAction('${user.token}', 'approve')">
                                <span class="material-symbols-outlined">how_to_reg</span>
                            </button>
                            <button class="action-btn btn-promote" title="Duyệt làm Admin" onclick="Yuuka.components.AccountComponent._handleAction('${user.token}', 'promote', 'waiting')">
                                <span class="material-symbols-outlined">shield_person</span>
                            </button>
                        ` : `
                            ${user.role !== 'admin' ? `
                                <button class="action-btn btn-promote" title="Cấp quyền Admin" onclick="Yuuka.components.AccountComponent._handleAction('${user.token}', 'promote')">
                                    <span class="material-symbols-outlined">shield_person</span>
                                </button>
                            ` : `
                                <button class="action-btn btn-revoke" title="Hạ quyền Admin" ${user.is_self ? 'disabled' : ''} 
                                        onclick="Yuuka.components.AccountComponent._handleAction('${user.token}', 'revoke')">
                                    <span class="material-symbols-outlined">person_remove</span>
                                </button>
                            `}
                        `}
                        <button class="action-btn btn-delete" title="Xóa tài khoản" ${user.is_self ? 'disabled' : ''}
                                onclick="Yuuka.components.AccountComponent._handleAction('${user.token}', 'delete')">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </td>
                </tr>
            `;
        }

        // Static handler for inline onclicks
        static async _handleAction(token, action, currentStatus = '') {
            const instance = window.Yuuka.coreState.currentPluginInstance;
            if (!instance || !instance.pluginApi) return;

            let confirmMsg = "";
            let apiPath = "";
            let method = "POST";

            if (action === 'approve') {
                confirmMsg = "Duyệt người dùng này truy cập ứng dụng (User)?";
                apiPath = "/approve";
            } else if (action === 'promote') {
                confirmMsg = currentStatus === 'waiting' 
                    ? "Duyệt và cấp quyền Admin cho người dùng này?" 
                    : "Cấp quyền Admin cho người dùng này?";
                apiPath = "/promote";
            } else if (action === 'revoke') {
                confirmMsg = "Gỡ quyền Admin của người dùng này?";
                apiPath = "/revoke";
            } else if (action === 'delete') {
                confirmMsg = "XÓA TOÀN BỘ dữ liệu và tài khoản này? Thao tác không thể hoàn tác.";
                apiPath = "/delete";
                method = "DELETE";
            }

            const ok = await Yuuka.ui.confirm(confirmMsg);
            if (!ok) return;

            try {
                let res;
                if (method === "DELETE") {
                    res = await instance.pluginApi.delete(apiPath, { token });
                } else {
                    res = await instance.pluginApi.post(apiPath, { token });
                }

                if (res.status === "ok" || res.status === "success") {
                    window.showSuccess("Thao tác thành công!");
                    await instance.loadUsers();
                    instance.render();
                } else {
                    window.showError(res.error || res.message || "Lỗi không xác định.");
                }
            } catch (e) {
                window.showError("Yêu cầu thất bại: " + e.message);
            }
        }

        destroy() {
            document.body.classList.remove("account-plugin-active");
        }
    }

    // Register component
    window.Yuuka.components[COMPONENT_NAME] = AccountComponent;
})();
