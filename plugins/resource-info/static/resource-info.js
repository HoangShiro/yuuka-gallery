// --- MODIFIED FILE: plugins/resource-info/static/resource-info.js ---
// Yuuka: resource-info v1.0
class ResourceInfoComponent {
    constructor(container, api) {
        this.api = api;
        this.overlay = null;
        this.widget = null; // Yuuka: widget UI v1.0
        this.interval = null;
        this.wattageHistory = [];
        this.maxHistoryPoints = 120; // Hiển thị 2 phút cuối (120 giây)
        this.isFetching = false; // Yuuka: fast mode fix v1.0 - Cờ chống request chồng chéo

        // Yuuka: widget UI v1.0 - Thêm state mới
        this.state = {
            isOpen: false,
            uiMode: 'overlay', // 'overlay' or 'widget'
            isFastMode: false,
            widgetPos: { x: 20, y: 20 }
        };

        this.dragInfo = {};

        this._loadState();
        this._init();
        
        // Yuuka: persistent state v1.1
        if (this.state.isOpen) {
            this._ensureWidgetOnScreen();
            this.show();
        }
    }

    // Yuuka: service launcher fix v1.0 - Thêm phương thức start()
    start() {
        this.toggle();
    }
    
    _saveState() {
        localStorage.setItem('yuuka-resource-info-state', JSON.stringify(this.state));
    }

    _loadState() {
        const savedState = localStorage.getItem('yuuka-resource-info-state');
        if (savedState) {
            try {
                const parsedState = JSON.parse(savedState);
                // Chỉ cập nhật các thuộc tính đã lưu, giữ nguyên các giá trị mặc định khác
                Object.assign(this.state, parsedState);
            } catch (e) {
                console.error("Lỗi khi tải trạng thái ResourceInfo, sử dụng mặc định.", e);
            }
        }
    }

    // Yuuka: persistent state v1.1
    _ensureWidgetOnScreen() {
        let { x, y } = this.state.widgetPos;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const approxWidth = 300; // Ước tính chiều rộng widget
        const approxHeight = 60; // Ước tính chiều cao widget

        x = Math.max(10, Math.min(x, winW - approxWidth - 10));
        y = Math.max(10, Math.min(y, winH - approxHeight - 10));

        this.state.widgetPos.x = x;
        this.state.widgetPos.y = y;
    }

    _init() {
        // 1. Tạo Overlay UI
        this.overlay = document.createElement('div');
        this.overlay.id = 'resource-info-overlay';
        this.overlay.innerHTML = `
            <div class="resource-header-actions">
                <span class="material-symbols-outlined header-btn" id="res-fast-mode-btn" title="Chế độ nhanh">bolt</span>
                <span class="material-symbols-outlined header-btn" id="res-toggle-ui-btn" title="Chuyển đổi UI">view_day</span>
                <span class="material-symbols-outlined header-btn close-btn" title="Đóng">close</span>
            </div>
            <div class="resource-main-display">
                <span class="value" id="res-total-w-overlay">--</span>
                <span class="unit">Watts</span>
            </div>
            <div class="resource-sub-display">
                <div class="stat-group">
                    <div class="stat-value" id="res-cpu-stat-overlay">--%</div>
                    <div>CPU Power</div>
                </div>
                <div class="stat-group">
                    <div class="stat-value" id="res-gpu-stat-overlay">--%</div>
                    <div>GPU Power</div>
                </div>
                <div class="stat-group">
                    <div class="stat-value" id="res-other-w-overlay">-- W</div>
                    <div>Other</div>
                </div>
                <div class="stat-group">
                    <div class="stat-value" id="res-ram-total-overlay">-- GB</div>
                    <div>RAM</div>
                </div>
            </div>
            <div class="resource-chart-container">
                <svg id="res-chart-svg" preserveAspectRatio="none" viewBox="0 0 ${this.maxHistoryPoints} 100"></svg>
            </div>
            <div class="resource-info-error" style="display: none;"></div>
        `;
        document.body.appendChild(this.overlay);
        
        // 2. Tạo Widget UI
        this.widget = document.createElement('div');
        this.widget.id = 'resource-info-widget';
        // Yuuka: widget UI v1.3 - Cập nhật cấu trúc HTML
        this.widget.innerHTML = `
            <div class="widget-component-group">
                <span class="label">CPU</span>
                <span class="value" id="res-cpu-stat-widget">--</span><span class="unit">%</span>
                <span class="value" id="res-cpu-w-widget">--</span><span class="unit">W</span>
            </div>
            <div class="widget-component-group">
                <span class="label">GPU</span>
                <span class="value" id="res-gpu-stat-widget">--</span><span class="unit">%</span>
                <span class="value" id="res-gpu-w-widget">--</span><span class="unit">W</span>
            </div>
            <div class="widget-component-group">
                <span class="label">Total</span>
                <span class="value" id="res-total-w-widget">--</span><span class="unit">W</span>
            </div>
            <span class="material-symbols-outlined widget-toggle-btn" title="Chuyển đổi UI">view_day</span>
        `;
        document.body.appendChild(this.widget);

        this.ui = {
            // Overlay elements
            totalWOverlay: this.overlay.querySelector('#res-total-w-overlay'),
            cpuStatOverlay: this.overlay.querySelector('#res-cpu-stat-overlay'),
            gpuStatOverlay: this.overlay.querySelector('#res-gpu-stat-overlay'),
            otherWOverlay: this.overlay.querySelector('#res-other-w-overlay'),
            ramTotalOverlay: this.overlay.querySelector('#res-ram-total-overlay'),
            chartSvg: this.overlay.querySelector('#res-chart-svg'),
            errorMsg: this.overlay.querySelector('.resource-info-error'),
            fastModeBtn: this.overlay.querySelector('#res-fast-mode-btn'),

            // Widget elements
            cpuStatWidget: this.widget.querySelector('#res-cpu-stat-widget'),
            cpuWWidget: this.widget.querySelector('#res-cpu-w-widget'),
            gpuStatWidget: this.widget.querySelector('#res-gpu-stat-widget'),
            gpuWWidget: this.widget.querySelector('#res-gpu-w-widget'),
            totalWWidget: this.widget.querySelector('#res-total-w-widget'),
        };
        
        // 3. Gán sự kiện
        this.overlay.querySelector('.close-btn').addEventListener('click', () => this.hide());
        this.overlay.querySelector('#res-toggle-ui-btn').addEventListener('click', () => this._toggleUIMode());
        this.ui.fastModeBtn.addEventListener('click', () => this._toggleFastMode());
        
        this.widget.querySelector('.widget-toggle-btn').addEventListener('click', (e) => {
             e.stopPropagation();
             if (!this.dragInfo.moved) this._toggleUIMode();
        });

        // Widget drag events
        this.widget.addEventListener('mousedown', this._onDragStart.bind(this));
    }

    _fetchData() {
        // Yuuka: fast mode fix v1.0 - Thêm lock để tránh request chồng chéo
        if (this.isFetching) {
            return;
        }
        this.isFetching = true;

        this.api['resource-info'].get('/stats')
            .then(data => {
                if(data.error) throw new Error(data.error);
                this.ui.errorMsg.style.display = 'none';
                
                // Cập nhật cả 2 UI để dữ liệu luôn đồng bộ
                this.ui.totalWOverlay.textContent = Math.round(data.total_power);
                this.ui.cpuStatOverlay.textContent = `${data.cpu_usage}%`;
                this.ui.gpuStatOverlay.textContent = `${data.gpu_usage}%`;
                this.ui.otherWOverlay.textContent = `${data.other_power} W`;
                this.ui.ramTotalOverlay.textContent = `${data.total_ram_gb} GB`;

                this.ui.cpuStatWidget.textContent = data.cpu_usage;
                this.ui.cpuWWidget.textContent = Math.round(data.cpu_power);
                this.ui.gpuStatWidget.textContent = data.gpu_usage;
                this.ui.gpuWWidget.textContent = Math.round(data.gpu_power);
                this.ui.totalWWidget.textContent = Math.round(data.total_power);

                // Chỉ render chart nếu ở chế độ overlay
                if (this.state.uiMode === 'overlay') {
                    this.wattageHistory.push(data.total_power);
                    if (this.wattageHistory.length > this.maxHistoryPoints) {
                        this.wattageHistory.shift();
                    }
                    this._renderChart();
                }
            })
            .catch(error => {
                console.error("Resource Info Error:", error);
                const userMessage = `Lỗi: Không thể tải dữ liệu. Hãy chắc chắn rằng bạn đã cài đặt các thư viện Python cần thiết (psutil, py-cpuinfo, gputil) và khởi động lại ứng dụng. (${error.message})`;
                this.ui.errorMsg.textContent = userMessage;
                this.ui.errorMsg.style.display = 'block';
                this.hide();
                showError(userMessage);
            })
            .finally(() => {
                // Yuuka: fast mode fix v1.0 - Luôn mở khóa sau khi request hoàn tất
                this.isFetching = false;
            });
    }

    _renderChart() {
        if (this.wattageHistory.length < 2) {
            this.ui.chartSvg.innerHTML = '';
            return;
        }

        const maxWatt = Math.max(...this.wattageHistory, 100);
        const points = this.wattageHistory.map((watt, index) => {
            const x = index;
            const y = 100 - (watt / maxWatt * 95);
            return `${x},${y}`;
        }).join(' ');
        
        let polyline = this.ui.chartSvg.querySelector('.resource-chart-line');
        if (!polyline) {
            polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.classList.add('resource-chart-line');
            this.ui.chartSvg.appendChild(polyline);
        }
        polyline.setAttribute('points', points);
    }
    
    _updateInterval() {
        if (this.interval) clearInterval(this.interval);
        if (!this.state.isOpen) return;

        const refreshRate = this.state.isFastMode ? 100 : 1500;
        this.interval = setInterval(() => this._fetchData(), refreshRate);
    }

    _toggleFastMode() {
        this.state.isFastMode = !this.state.isFastMode;
        this.ui.fastModeBtn.classList.toggle('active', this.state.isFastMode);
        this._updateInterval();
        this._saveState();
    }

    _toggleUIMode() {
        this.state.uiMode = this.state.uiMode === 'overlay' ? 'widget' : 'overlay';
        this.show(); // Gọi lại show để áp dụng UI mới
        this._saveState();
    }

    show() {
        this.state.isOpen = true;
        this._saveState(); // Yuuka: persistent state v1.1
        
        this.overlay.classList.remove('visible');
        this.widget.classList.remove('visible');

        if (this.state.uiMode === 'overlay') {
            this.overlay.classList.add('visible');
            this.wattageHistory = []; // Reset chart khi mở lại
        } else {
            this.widget.classList.add('visible');
            this._updateWidgetPosition();
        }

        this.ui.fastModeBtn.classList.toggle('active', this.state.isFastMode);
        this._fetchData(); // Lấy dữ liệu ngay lập tức
        this._updateInterval();
    }
    
    hide() {
        this.state.isOpen = false;
        this.overlay.classList.remove('visible');
        this.widget.classList.remove('visible');
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this._saveState();
    }
    
    toggle() {
        if (this.state.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    // --- Widget Drag Logic ---
    _updateWidgetPosition() {
        this.widget.style.left = `${this.state.widgetPos.x}px`;
        this.widget.style.top = `${this.state.widgetPos.y}px`;
    }

    _onDragStart(e) {
        if (e.target.classList.contains('widget-toggle-btn')) return;
        e.preventDefault();

        this.dragInfo = {
            active: true,
            moved: false,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - this.state.widgetPos.x,
            offsetY: e.clientY - this.state.widgetPos.y,
        };
        this.widget.classList.add('is-dragging');
        
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);
        
        document.addEventListener('mousemove', this._onDragMove);
        document.addEventListener('mouseup', this._onDragEnd, { once: true });
    }

    _onDragMove(e) {
        if (!this.dragInfo.active) return;
        e.preventDefault();
        
        if (!this.dragInfo.moved) {
            const dx = Math.abs(e.clientX - this.dragInfo.startX);
            const dy = Math.abs(e.clientY - this.dragInfo.startY);
            if (dx > 5 || dy > 5) { // Threshold
                this.dragInfo.moved = true;
            }
        }

        let newX = e.clientX - this.dragInfo.offsetX;
        let newY = e.clientY - this.dragInfo.offsetY;
        
        // Clamp to screen bounds
        const rect = this.widget.getBoundingClientRect();
        newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
        newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));

        this.state.widgetPos = { x: newX, y: newY };
        this._updateWidgetPosition();
    }

    _onDragEnd() {
        if (!this.dragInfo.active) return;
        this.dragInfo.active = false;
        this.widget.classList.remove('is-dragging');
        
        document.removeEventListener('mousemove', this._onDragMove);
        
        if (this.dragInfo.moved) {
            this._saveState();
        }

        // Reset moved flag after a short delay to prevent clicks right after drag
        setTimeout(() => { this.dragInfo.moved = false; }, 50);
    }
}

window.Yuuka.components.ResourceInfoComponent = ResourceInfoComponent;