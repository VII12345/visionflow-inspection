"""
Flask HTTP 服务器
提供 REST API 给 React/Tauri 前端
"""

import io
import os
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

from .config import Config
from .logger import logger
from .camera_config_manager import camera_config_manager
from .camera_run_service import start_camera, stop_camera
from .model_loader import set_camera_product
from . import model_loader
from .runtime_state import runtime
from .auth_routes import auth_bp, require_auth_middleware
from .camera_routes import camera_bp
from .catalog_routes import catalog_bp
from .model_routes import model_bp
from .model_test_routes import model_test_bp
from .photo_routes import photo_bp
from .system_routes import apply_line_count as _apply_line_count, system_bp
from .training_routes import training_bp
from .log_routes import log_bp


# 初始化 Flask
app = Flask(__name__)
CORS(app)  # 允许跨域
app.register_blueprint(auth_bp)
app.register_blueprint(catalog_bp)
app.register_blueprint(system_bp)
app.register_blueprint(camera_bp)
app.register_blueprint(model_bp)
app.register_blueprint(model_test_bp)
app.register_blueprint(photo_bp)
app.register_blueprint(training_bp)
app.register_blueprint(log_bp)

# 登录鉴权：默认关闭（AUTH_ENABLED=False），兼容现有局域网无鉴权部署。
if Config.AUTH_ENABLED:
    app.before_request(require_auth_middleware)


# ========== 网页静态服务（浏览器访问打包应用） ==========


def _frontend_dist_dir():
    """定位前端构建产物目录；找不到返回 None（仅 API 模式）。"""
    candidates = []
    env_dist = os.environ.get("VISION_WEB_DIST")
    if env_dist:
        candidates.append(Path(env_dist))
    if getattr(sys, "frozen", False):
        # 打包：dist 随后端放在同一目录下（resources/backend/dist）
        candidates.append(Path(sys.executable).parent / "dist")
    else:
        # 开发：项目根目录下的 view/dist
        candidates.append(Path(__file__).resolve().parent.parent / "view" / "dist")
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "index.html").exists():
            return candidate
    return None


def register_web_static(app):
    """让后端同时服务前端静态页面，浏览器直接访问 http://<host>:5000/ 使用整站。"""
    web_dist = _frontend_dist_dir()
    if web_dist is None:
        logger.info("未找到前端构建产物，网页静态服务未启用（仅提供 API）")
        return

    @app.route("/")
    def _web_index():
        return send_from_directory(web_dist, "index.html")

    @app.route("/<path:filename>")
    def _web_static(filename):
        if filename.startswith("api/"):
            return jsonify({"error": "接口不存在"}), 404
        target = (web_dist / filename).resolve()
        try:
            if target.is_relative_to(web_dist.resolve()) and target.is_file():
                return send_from_directory(web_dist, filename)
        except (OSError, ValueError):
            pass
        # SPA 回退：hash 路由下未知路径一律返回入口页
        return send_from_directory(web_dist, "index.html")


register_web_static(app)
logger.info(f"网页入口: http://{Config.FLASK_HOST}:{Config.FLASK_PORT}/")


# ========== API 端点 ==========


@app.route("/api/start", methods=["POST"])
def start_system():
    """启动选中的相机；未传 camera_ids 时启动所有已启用相机。"""

    if runtime.system_running:
        return jsonify({"success": False, "message": "系统已在运行中"}), 409

    try:
        logger.info("启动系统...")
        data = request.get_json(silent=True) or {}
        requested_count = data.get("line_count")
        if requested_count is not None:
            try:
                _apply_line_count(requested_count)
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "线体数量无效"}), 400

        cam_products = data.get("camProducts", {})
        for cam_id_str, model_name in cam_products.items():
            set_camera_product(int(cam_id_str), model_name if model_name else None)
        logger.info(f"摄像头-产品映射: {cam_products}")

        if runtime.camera_manager is None:
            return jsonify({
                "success": False,
                "message": "相机管理器未初始化，请检查 MVS SDK 安装或查看环境检测结果",
            }), 500

        enabled_cameras = camera_config_manager.get_enabled_cameras()
        requested_ids = data.get("camera_ids")
        if requested_ids is not None:
            try:
                requested_ids = {int(cam_id) for cam_id in requested_ids}
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "线路选择无效"}), 400
            invalid_ids = requested_ids - set(range(1, Config.CAMERA_COUNT + 1))
            if invalid_ids:
                return jsonify({"success": False, "message": "线路选择超出范围"}), 400
            runtime.line_enabled = {i: i in requested_ids for i in range(1, Config.CAMERA_COUNT + 1)}
            enabled_cameras = {
                cam_id: cam_config
                for cam_id, cam_config in enabled_cameras.items()
                if cam_id in requested_ids
            }
        else:
            requested_ids = {i for i in range(1, Config.CAMERA_COUNT + 1) if runtime.line_enabled.get(i, True)}
            enabled_cameras = {
                cam_id: cam_config
                for cam_id, cam_config in enabled_cameras.items()
                if cam_id in requested_ids
            }

        if not enabled_cameras:
            logger.warning("没有选中的已启用相机配置")
            return jsonify({
                "success": False,
                "message": "没有选中的相机，请先启用线路并配置相机IP地址",
            }), 400

        runtime.system_running = True
        available_cameras = runtime.camera_manager.enumerate_cameras()
        logger.info(f"检测到 {len(available_cameras)} 台物理相机")
        started_cameras = []
        errors = []

        for cam_id, cam_config in enabled_cameras.items():
            ok, error_msg = start_camera(cam_id, cam_config, available_cameras)
            if ok:
                started_cameras.append(cam_id)
            elif error_msg:
                errors.append(error_msg)

        if not started_cameras:
            runtime.system_running = False
            return jsonify({"success": False, "message": "所有选中的相机启动失败", "errors": errors}), 500

        message = f"系统启动成功，启动了 {len(started_cameras)}/{len(enabled_cameras)} 个相机"
        if errors:
            message += f"，{len(errors)} 个相机启动失败"
        logger.info(message)
        return jsonify({
            "success": True,
            "message": message,
            "started": len(started_cameras),
            "started_cameras": started_cameras,
            "total": len(enabled_cameras),
            "errors": errors if errors else None,
            "running": runtime.system_running,
        })
    except Exception as e:
        logger.error(f"启动失败: {e}")
        runtime.system_running = False
        return jsonify({"success": False, "message": f"启动失败: {str(e)}"}), 500


@app.route("/api/lines/<int:cam_id>", methods=["POST"])
def set_line_enabled(cam_id):
    """运行中实时启停单条线路；系统停止时也会保存线路选择。"""

    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "message": "线路编号无效"}), 400

    data = request.get_json(silent=True) or {}
    if not isinstance(data.get("enabled"), bool):
        return jsonify({"success": False, "message": "enabled 必须是布尔值"}), 400

    enabled = data["enabled"]
    runtime.line_enabled[cam_id] = enabled
    if not enabled:
        stop_camera(cam_id)
        if not runtime.cameras:
            runtime.system_running = False
        return jsonify({
            "success": True,
            "enabled": False,
            "running": runtime.system_running,
            "message": f"线路 {cam_id} 已关闭",
        })

    if runtime.camera_manager is None:
        runtime.line_enabled[cam_id] = False
        return jsonify({"success": False, "message": "相机管理器未初始化"}), 500

    cam_config = camera_config_manager.get_camera_config(cam_id)
    if not cam_config or not cam_config.get("enabled") or not cam_config.get("ip"):
        runtime.line_enabled[cam_id] = False
        return jsonify({"success": False, "message": f"线路 {cam_id} 尚未配置可用相机"}), 400

    try:
        if not runtime.system_running:
            runtime.system_running = True
        available_cameras = runtime.camera_manager.enumerate_cameras()
        ok, error_msg = start_camera(cam_id, cam_config, available_cameras)
        if not ok:
            runtime.line_enabled[cam_id] = False
            if not runtime.cameras:
                runtime.system_running = False
            return jsonify({"success": False, "message": error_msg or f"线路 {cam_id} 启动失败", "running": runtime.system_running}), 500
        return jsonify({
            "success": True,
            "enabled": True,
            "running": runtime.system_running,
            "message": f"线路 {cam_id} 已启动",
        })
    except Exception as e:
        runtime.line_enabled[cam_id] = False
        if not runtime.cameras:
            runtime.system_running = False
        logger.error(f"线路 {cam_id} 启动失败: {e}")
        return jsonify({"success": False, "message": str(e), "running": runtime.system_running}), 500


@app.route("/api/stop", methods=["POST"])
def stop_system():
    """停止所有相机。"""

    if not runtime.system_running:
        return jsonify({"success": False, "message": "系统未运行"}), 409

    try:
        logger.info("停止系统...")
        runtime.system_running = False
        for cam_id in list(runtime.cameras.keys()):
            stop_camera(cam_id)
        logger.info("系统停止成功")
        return jsonify({"success": True, "message": "系统停止成功", "running": False})
    except Exception as e:
        logger.error(f"停止失败: {e}")
        return jsonify({"success": False, "message": f"停止失败: {str(e)}"}), 500


@app.route("/api/status", methods=["GET"])
def get_status():
    """获取系统状态（主要轮询端点）"""
    camera_status = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        state, camera_stats, result = runtime.get_camera_snapshot(i)
        camera_status[str(i)] = {
            "state": state["state"],
            "lineEnabled": runtime.line_enabled.get(i, True),
            "serial": state["serial"],
            "model": state["model"],
            "triggerMode": state["triggerMode"],
            "fps": state["fps"],
            "totalTriggers": state["totalTriggers"],
            "lastFrameTime": state["lastFrameTime"],
            "stats": camera_stats,
            "error": state["error"],
        }

        if result is not None:
            camera_status[str(i)]["result"] = result

    return jsonify(
        {
            "cameras": camera_status,
            "system": {
                "running": runtime.system_running,
                "modelLoaded": model_loader.model_loaded,
            },
        }
    )


@app.route("/api/frame/<int:cam_id>", methods=["GET"])
def get_frame(cam_id):
    """获取最新帧（JPEG）"""
    img = runtime.get_latest_frame(cam_id)
    if img is None:
        # 相机已配置但尚未产生第一帧时，不视为接口不存在；用 204 告知前端暂时无图像，避免轮询日志持续刷 404。
        return "", 204

    try:
        # 转为 JPEG bytes
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        return send_file(buf, mimetype="image/jpeg")
    except Exception as e:
        logger.error(f"获取帧失败: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/result/<int:cam_id>", methods=["GET"])
def get_result(cam_id):
    """获取最新检测结果"""
    result = runtime.get_latest_result(cam_id)
    if result is None:
        return jsonify({"error": "No result available"}), 404

    return jsonify(result)


@app.route("/api/stats", methods=["GET"])
def get_stats():
    """获取统计数据"""
    return jsonify(runtime.get_stats_snapshot())


@app.route("/api/stats/reset/<int:cam_id>", methods=["POST"])
def reset_stats(cam_id):
    """重置统计"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"error": "Invalid camera ID"}), 400

    stats = runtime.reset_camera_stats(cam_id)
    logger.info(f"重置 Camera {cam_id} 统计")
    return jsonify({"success": True, "stats": stats})


def run_server():
    """兼容入口：委托给拆分后的启动编排模块。"""
    from .server_bootstrap import run_server as _run_server

    _run_server()


if __name__ == "__main__":
    run_server()
