from flask import Blueprint, jsonify, request

# Import WorldStateEngine từ services (được tạo ở task 5)
try:
    from .services.world_state_engine import WorldStateEngine
except ImportError:
    WorldStateEngine = None


class WorldPlugin:
    """
    Backend cho plugin World.
    Đăng ký Flask Blueprint tại /api/plugin/world.
    Khởi tạo và quản lý WorldStateEngine cho tick loop mô phỏng.
    """

    def __init__(self, core_api):
        self.core_api = core_api
        self.blueprint = Blueprint('world', __name__)

        # Khởi tạo engine mô phỏng world
        if WorldStateEngine is not None:
            self.engine = WorldStateEngine(core_api)
            self.engine.load_or_init()
            self.engine.start()
        else:
            self.engine = None

        self.register_routes()
        print("[Plugin:World] Backend initialized.")

    def register_routes(self):
        bp = self.blueprint

        def _engine_required():
            """Kiểm tra engine có sẵn không, trả về response lỗi nếu không."""
            if self.engine is None:
                return jsonify({'error': 'World engine not available'}), 503
            return None

        # --- POST /generate: nhận config, sinh world mới, trả về world object ---
        @bp.route('/generate', methods=['POST'])
        def generate():
            err = _engine_required()
            if err:
                return err
            try:
                body = request.get_json(silent=True) or {}
                if body:
                    self.engine.save_config(body)
                self.engine.reset()
                state = self.engine.get_state()
                return jsonify({'ok': True, 'world': state.get('map')}), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- GET /state: trả về world state hiện tại ---
        @bp.route('/state', methods=['GET'])
        def get_state():
            err = _engine_required()
            if err:
                return err
            try:
                return jsonify(self.engine.get_state()), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        @bp.route('/live_state', methods=['GET'])
        def get_live_state():
            err = _engine_required()
            if err:
                return err
            try:
                return jsonify(self.engine.get_live_state()), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- POST /pause: tạm dừng tick loop ---
        @bp.route('/pause', methods=['POST'])
        def pause():
            err = _engine_required()
            if err:
                return err
            try:
                self.engine.pause()
                return jsonify({'ok': True}), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- POST /resume: tiếp tục tick loop ---
        @bp.route('/resume', methods=['POST'])
        def resume():
            err = _engine_required()
            if err:
                return err
            try:
                self.engine.resume()
                return jsonify({'ok': True}), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- POST /reset: xóa state, sinh world mới (frontend đã confirm trước) ---
        @bp.route('/reset', methods=['POST'])
        def reset():
            err = _engine_required()
            if err:
                return err
            try:
                self.engine.reset()
                return jsonify({'ok': True}), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- GET /config: lấy world config hiện tại ---
        @bp.route('/config', methods=['GET'])
        def get_config():
            err = _engine_required()
            if err:
                return err
            try:
                return jsonify(self.engine.get_config()), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- POST /config: lưu world config mới ---
        @bp.route('/config', methods=['POST'])
        def save_config():
            err = _engine_required()
            if err:
                return err
            try:
                body = request.get_json(silent=True) or {}
                self.engine.save_config(body)
                return jsonify({'ok': True}), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

        # --- POST /speed: cập nhật tick_interval_ms ---
        @bp.route('/speed', methods=['POST'])
        def set_speed():
            err = _engine_required()
            if err:
                return err
            try:
                body = request.get_json(silent=True) or {}
                speed_multiplier = body.get('speed_multiplier')
                tick_interval_ms = body.get('tick_interval_ms')
                if speed_multiplier is None and tick_interval_ms is None:
                    return jsonify({'error': 'speed_multiplier or tick_interval_ms required'}), 400
                self.engine.set_speed(
                    speed_multiplier=float(speed_multiplier) if speed_multiplier is not None else None,
                    tick_interval_ms=int(tick_interval_ms) if tick_interval_ms is not None else None,
                )
                return jsonify({'ok': True}), 200
            except Exception as e:
                return jsonify({'error': str(e)}), 500

    def get_blueprint(self):
        return self.blueprint, "/api/plugin/world"
