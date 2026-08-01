"""登录鉴权与 token 校验。

token 为 HMAC 签名的自包含凭证（uid/name/level/exp），无状态、可跨重启验证。
鉴权中间件 require_auth_middleware 可复用于 Flask before_request。
"""

import base64
import hashlib
import hmac
import json
import time

from flask import Blueprint, jsonify, request

from .logger import logger
from .user_repository import (
    create_user,
    delete_user,
    find_user,
    get_auth_secret,
    load_users,
    update_user_password,
    verify_password,
)


auth_bp = Blueprint("auth", __name__)

TOKEN_TTL_SECONDS = 12 * 3600  # 12 小时


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def create_token(user) -> str:
    """签发 Bearer token（HMAC 签名，含过期时间）。"""
    payload = {
        "uid": user.id,
        "name": user.name,
        "level": user.level,
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(
        get_auth_secret().encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{body}.{signature}"


def verify_token(token):
    """校验 token，返回用户信息或 None。"""
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(
            get_auth_secret().encode("utf-8"),
            body.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_b64decode(body).decode("utf-8"))
        if int(payload.get("exp", 0)) < time.time():
            return None
        return {
            "id": payload.get("uid"),
            "name": payload.get("name"),
            "level": payload.get("level"),
        }
    except Exception:
        return None


def current_user():
    """从请求头读取当前登录用户（无 token 或无效时返回 None）。"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return verify_token(auth[len("Bearer "):].strip())


def _extract_token():
    """从 Authorization 头或照片 URL 的 token 查询参数中提取 Bearer token。

    照片以 <img> 标签加载时无法附带请求头，故 GET /api/photos/* 允许 ?token= 参数。
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):].strip()
    if request.method == "GET" and request.path.startswith("/api/photos/"):
        return request.args.get("token", "").strip()
    return ""


def require_auth_middleware():
    """Flask before_request 鉴权：放行返回 None，否则返回 401 响应。

    白名单：/api/auth/login、/api/health 及非 /api/ 前缀路径（静态资源）。
    """
    if request.method == "OPTIONS":
        return None
    path = request.path
    if not path.startswith("/api/"):
        return None  # 非 API 路径（静态资源等）放行
    if path in ("/api/auth/login", "/api/health"):
        return None
    token = _extract_token()
    if not token or verify_token(token) is None:
        return jsonify({"success": False, "message": "未登录或登录已过期"}), 401
    return None


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    password = str(data.get("password", ""))
    if not name or not password:
        return jsonify({"success": False, "message": "请输入用户名和密码"}), 400
    user = find_user(name)
    if user is None or not verify_password(user, password):
        logger.warning(f"登录失败: 用户名或密码错误 ({name})")
        return jsonify({"success": False, "message": "用户名或密码错误"}), 401
    token = create_token(user)
    logger.info(f"用户 {name} 登录成功")
    return jsonify(
        {
            "success": True,
            "token": token,
            "user": {"id": user.id, "name": user.name, "level": user.level},
        }
    )


@auth_bp.route("/api/auth/change-password", methods=["POST"])
def change_password():
    user = current_user()
    if user is None:
        return jsonify({"success": False, "message": "未登录或登录已过期"}), 401
    data = request.get_json(silent=True) or {}
    old_password = str(data.get("old_password", ""))
    new_password = str(data.get("new_password", ""))
    if len(new_password) < 3:
        return jsonify({"success": False, "message": "新密码至少3位"}), 400
    record = find_user(user["name"])
    if record is None or not verify_password(record, old_password):
        return jsonify({"success": False, "message": "旧密码错误"}), 400
    if update_user_password(user["name"], new_password):
        logger.info(f"用户 {user['name']} 修改密码成功")
        return jsonify({"success": True, "message": "密码修改成功"})
    return jsonify({"success": False, "message": "保存失败"}), 500


@auth_bp.route("/api/auth/me", methods=["GET"])
def me():
    user = current_user()
    if user is None:
        return jsonify({"success": False, "message": "未登录或登录已过期"}), 401
    return jsonify({"success": True, "user": user})


# ========== 用户管理（仅管理员） ==========


def _admin_user():
    """返回当前登录用户；非管理员返回 None。"""
    user = current_user()
    if user is None or user.get("level") != "admin":
        return None
    return user


def _public_user(u):
    return {"id": u.id, "name": u.name, "level": u.level}


@auth_bp.route("/api/auth/users", methods=["GET"])
def list_users():
    if _admin_user() is None:
        return jsonify({"success": False, "message": "需要管理员权限"}), 403
    return jsonify({"success": True, "users": [_public_user(u) for u in load_users()]})


@auth_bp.route("/api/auth/users", methods=["POST"])
def create_user_route():
    if _admin_user() is None:
        return jsonify({"success": False, "message": "需要管理员权限"}), 403
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    password = str(data.get("password", ""))
    level = str(data.get("level", "operator"))
    if not name:
        return jsonify({"success": False, "message": "请输入用户名"}), 400
    if len(password) < 3:
        return jsonify({"success": False, "message": "密码至少3位"}), 400
    user = create_user(name, password, level)
    if user is None:
        return jsonify({"success": False, "message": "用户名已存在"}), 409
    logger.info(f"管理员创建用户: {name} ({level})")
    return jsonify({"success": True, "user": _public_user(user)})


@auth_bp.route("/api/auth/users/<int:user_id>", methods=["DELETE"])
def delete_user_route(user_id):
    admin = _admin_user()
    if admin is None:
        return jsonify({"success": False, "message": "需要管理员权限"}), 403
    if int(user_id) == int(admin.get("id")):
        return jsonify({"success": False, "message": "不能删除当前登录账户"}), 400
    if not delete_user(user_id):
        return jsonify({"success": False, "message": "用户不存在"}), 404
    logger.info(f"管理员删除用户 id={user_id}")
    return jsonify({"success": True, "message": "用户已删除"})
