"""用户存储：JSON 文件 + 密码哈希 + 持久化签名密钥。

首次启动自动初始化默认管理员账号，密码随机生成并通过日志提示。
密码使用 werkzeug.security.generate_password_hash 存储，绝不保存明文。
"""

import json
import secrets
from dataclasses import dataclass

from werkzeug.security import check_password_hash, generate_password_hash

from .config import Config
from .logger import logger


USER_LEVELS = {"admin", "tech", "operator"}
DEFAULT_ADMIN_USERNAME = "admin"


@dataclass
class UserRecord:
    id: int
    name: str
    level: str
    password_hash: str


def user_file_path():
    return Config.DATA_DIR / "users.json"


def _default_admin_password():
    """首次启动的随机管理员密码（12 位十六进制）。"""
    return secrets.token_hex(6)


def ensure_users_file():
    """首次启动初始化默认管理员（密码随机生成并提示）。已存在则跳过。"""
    path = user_file_path()
    if path.exists():
        return False
    try:
        Config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        password = _default_admin_password()
        payload = {
            "secret": secrets.token_hex(32),
            "users": [
                {
                    "id": 1,
                    "name": DEFAULT_ADMIN_USERNAME,
                    "level": "admin",
                    "password_hash": generate_password_hash(password),
                }
            ],
        }
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        logger.warning(
            f"已初始化默认管理员账号，初始密码: {password}（请登录后尽快修改）"
        )
        return True
    except OSError as exc:
        logger.error(f"初始化用户文件失败: {exc}")
        return False


def _read_file():
    ensure_users_file()
    try:
        raw = json.loads(user_file_path().read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("用户文件格式无效")
        return raw
    except (OSError, ValueError, TypeError) as exc:
        logger.error(f"读取用户文件失败: {exc}")
        return {}


def get_auth_secret():
    """读取（必要时生成）用于 token 签名的持久化密钥。"""
    raw = _read_file()
    secret = str(raw.get("secret", "")).strip()
    if not secret:
        secret = secrets.token_hex(32)
        raw["secret"] = secret
        try:
            user_file_path().write_text(
                json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            logger.error(f"保存签名密钥失败: {exc}")
    return secret


def load_users():
    raw = _read_file()
    users = []
    for item in raw.get("users", []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        level = str(item.get("level", "operator"))
        if level not in USER_LEVELS:
            level = "operator"
        users.append(
            UserRecord(
                id=int(item.get("id", len(users) + 1)),
                name=name,
                level=level,
                password_hash=str(item.get("password_hash", "")),
            )
        )
    return users


def find_user(name):
    target = name.strip()
    for user in load_users():
        if user.name == target:
            return user
    return None


def verify_password(user, password):
    if not user.password_hash:
        return False
    return check_password_hash(user.password_hash, password)


def update_user_password(name, new_password):
    """更新用户密码哈希并持久化。"""
    raw = _read_file()
    for item in raw.get("users", []):
        if not isinstance(item, dict):
            continue
        if str(item.get("name", "")).strip() == name.strip():
            item["password_hash"] = generate_password_hash(new_password)
            try:
                user_file_path().write_text(
                    json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                return True
            except OSError as exc:
                logger.error(f"保存用户密码失败: {exc}")
                return False
    return False
