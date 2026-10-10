"""相机配置与 PLC 相关 API。"""

from flask import Blueprint, jsonify, request

from .camera_config_manager import camera_config_manager
from .config import Config
from .logger import logger
from .plc_service import get_plc_config, save_plc_config, PlcNetworkError, PlcWriteError, plc_service
from .runtime_state import runtime

camera_bp = Blueprint("camera", __name__)


@camera_bp.route("/api/cameras", methods=["GET"])
def get_cameras():
    """枚举所有相机"""
    try:
        camera_list = runtime.camera_manager.enumerate_cameras()
        return jsonify({"success": True, "cameras": camera_list})
    except Exception as e:
        logger.error(f"枚举相机失败: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@camera_bp.route("/api/cameras/mapping", methods=["GET"])
def get_camera_mapping():
    """获取相机映射配置"""
    mapping = {}
    for i in range(1, Config.CAMERA_COUNT + 1):
        camera_state = runtime.get_camera_state(i)
        if camera_state and camera_state["serial"]:
            mapping[str(i)] = {"serial": camera_state["serial"], "name": f"Cam{i}"}
        else:
            mapping[str(i)] = None
    return jsonify(mapping)


@camera_bp.route("/api/cameras/config", methods=["GET"])
def get_camera_config():
    """获取所有相机配置"""
    config = camera_config_manager.get_config()
    return jsonify({"success": True, "config": config})


@camera_bp.route("/api/cameras/config/<int:cam_id>", methods=["GET"])
def get_single_camera_config(cam_id):
    """获取单个相机配置"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400

    config = camera_config_manager.get_camera_config(cam_id)
    return jsonify({"success": True, "config": config})


@camera_bp.route("/api/cameras/config/<int:cam_id>", methods=["POST"])
def update_camera_config(cam_id):
    """更新单个相机配置"""
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400

    try:
        data = request.get_json()
        camera_config = {
            "enabled": data.get("enabled", False),
            "ip": data.get("ip", ""),
            "name": data.get("name", f"Cam{cam_id}"),
            "triggerSource": data.get("triggerSource", "Line0"),
            "triggerActivation": data.get("triggerActivation", "RisingEdge"),
            "triggerTimeout": data.get("triggerTimeout", 30000),
            "triggerDelay": data.get("triggerDelay", 0),
            "exposureTime": data.get("exposureTime", 5000),
            "gain": data.get("gain", 0),
            "lineDebouncerTime": data.get("lineDebouncerTime", 50),
            "strobeEnable": data.get("strobeEnable", False),
            "strobeDelay": data.get("strobeDelay", 0),
            "strobeDuration": data.get("strobeDuration", 1000),
            "rejectTime": data.get("rejectTime", 0),
            "rejectDelay": data.get("rejectDelay", 0),
            "plcUrl": data.get("plcUrl", "http://127.0.0.1:8088"),
        }

        plc_config = get_plc_config()
        plc_url = str(plc_config.get("base_url", camera_config["plcUrl"])).strip()
        if not plc_url.startswith(("http://", "https://")):
            return jsonify(
                {"success": False, "error": "PLC地址必须以 http:// 或 https:// 开头"}
            ), 400

        for key in ("rejectTime", "rejectDelay"):
            value = camera_config[key]
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or value < 0
                or value > 4294967295
            ):
                return jsonify(
                    {"success": False, "error": f"{key} 必须是 0 到 4294967295 的整数"}
                ), 400

        camera_config["plcUrl"] = plc_url.rstrip("/")
        success = camera_config_manager.update_camera_config(cam_id, camera_config)
        plc_result = None
        plc_error = None
        try:
            plc_result = None if not plc_config.get("enabled", True) else plc_service.with_base_url(plc_url).write_camera_timing(cam_id)
        except (PlcWriteError, ValueError) as e:
            plc_error = str(e)

        if success:
            logger.info(f"相机 {cam_id} 配置已更新: {camera_config}")
            response = {
                "success": True,
                "message": f"Cam{cam_id} 配置已保存",
                "plcSuccess": plc_error is None,
                "plc": plc_result,
            }
            if plc_error:
                response["plcError"] = plc_error
            return jsonify(response)
        else:
            return jsonify({"success": False, "error": "保存配置失败"}), 500

    except Exception as e:
        logger.error(f"更新相机配置失败: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@camera_bp.route("/api/plc/config", methods=["GET"])
def get_plc_configuration():
    """获取独立 PLC 配置。"""
    return jsonify({"success": True, "config": get_plc_config()})


def _write_all_timing(config):
    """PLC 配置保存后把各相机时序值写入 PLC，尽力而为。

    网络层失败（PlcNetworkError）说明 PLC 不可达，继续逐台写只会拖慢保存，故中断；
    单节点写入被拒则记录错误继续尝试其他相机。返回错误描述，全成功返回 None。
    """
    if not config.get("enabled", True):
        return None
    client = plc_service.with_base_url(config.get("base_url", plc_service.base_url))
    errors = []
    for cam_id in sorted(config.get("cameras", {}), key=int):
        try:
            client.write_camera_timing(int(cam_id))
        except PlcNetworkError as exc:
            errors.append(f"相机{cam_id}: {exc}")
            break
        except (PlcWriteError, ValueError) as exc:
            errors.append(f"相机{cam_id}: {exc}")
    if not errors:
        return None
    if len(errors) > 3:
        return "；".join(errors[:3]) + f"；另有 {len(errors) - 3} 台相机写入失败"
    return "；".join(errors)


@camera_bp.route("/api/plc/config", methods=["POST"])
def save_plc_configuration():
    """保存独立 PLC 配置，并尽力把各相机时序值写入 PLC。"""
    try:
        config = save_plc_config(request.get_json(silent=True) or {})
        logger.info("PLC 独立配置已保存")
        plc_error = _write_all_timing(config)
        response = {"success": True, "config": config, "message": "PLC 配置已保存"}
        if plc_error:
            response["plcError"] = plc_error
        return jsonify(response)
    except (TypeError, ValueError) as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.error(f"保存 PLC 配置失败: {exc}", exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500


@camera_bp.route("/api/plc/test", methods=["POST"])
def test_plc_write():
    """按当前配置执行一次可控的 PLC 节点测试写入。"""
    try:
        config = get_plc_config()
        if not config.get("enabled", True):
            return jsonify({"success": False, "error": "PLC 功能当前已禁用"}), 400
        data = request.get_json(silent=True) or {}
        cam_id = int(data.get("camera_id", 1))
        if cam_id < 1 or cam_id > Config.CAMERA_COUNT:
            return jsonify({"success": False, "error": "无效的相机编号"}), 400
        key = str(data.get("type", "reject_signal"))
        if key not in ("reject_time", "reject_delay", "reject_signal", "pipeline_signal"):
            return jsonify({"success": False, "error": "无效的测试节点类型"}), 400
        mapping = config["cameras"].get(str(cam_id), {})
        address = mapping.get(key)
        if not address:
            return jsonify({"success": False, "error": "该相机尚未配置节点名称"}), 400
        client = plc_service.with_base_url(config["base_url"])
        value = int(data.get("value", 1))
        if key == "pipeline_signal" and value not in (0, 1):
            return jsonify({"success": False, "error": "流水线控制信号测试值只能是 0 或 1"}), 400
        result = client.write_byte(address, value) if key in ("reject_signal", "pipeline_signal") else client.write_dword(address, value)
        return jsonify({"success": True, "camera_id": cam_id, "type": key, "address": address, "value": value, "plc": result})
    except (PlcWriteError, ValueError, TypeError) as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

@camera_bp.route("/api/cameras/<int:cam_id>/plc/test-reject", methods=["POST"])
def test_reject_signal(cam_id):
    """写入对应相机的 MB=1 测试信号"""
    config = get_plc_config()
    if cam_id < 1 or cam_id > Config.CAMERA_COUNT or str(cam_id) not in config.get("cameras", {}):
        return jsonify({"success": False, "error": "Invalid camera ID"}), 400
    try:
        if not config.get("enabled", True):
            return jsonify({"success": False, "error": "PLC 功能当前已禁用"}), 400
        result = plc_service.with_base_url(config.get("base_url", plc_service.base_url)).write_reject_signal(cam_id)
        return jsonify(
            {
                "success": True,
                "camera": cam_id,
                "address": config["cameras"][str(cam_id)]["reject_signal"],
                "value": 1,
                "plc": result,
            }
        )
    except (PlcWriteError, ValueError) as e:
        return jsonify(
            {
                "success": False,
                "camera": cam_id,
                "address": config["cameras"][str(cam_id)]["reject_signal"],
                "error": str(e),
            }
        ), 502



