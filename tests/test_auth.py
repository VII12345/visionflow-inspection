import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask, jsonify
from werkzeug.security import generate_password_hash

from backend.auth_routes import (
    auth_bp,
    require_auth_middleware,
    verify_token,
)
from backend.config import Config


class AuthRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_patch = patch.object(Config, "DATA_DIR", self.data_dir)
        self.data_patch.start()
        self._write_users(
            [
                {
                    "id": 1,
                    "name": "admin",
                    "level": "admin",
                    "password_hash": generate_password_hash("admin123"),
                }
            ]
        )
        app = Flask(__name__)
        app.register_blueprint(auth_bp)

        @app.route("/api/health")
        def health():
            return jsonify({"status": "ok"})

        @app.route("/api/protected")
        def protected():
            return jsonify({"success": True})

        app.before_request(require_auth_middleware)
        self.client = app.test_client()

    def _write_users(self, users):
        (self.data_dir / "users.json").write_text(
            json.dumps({"secret": "test-secret", "users": users}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _login_token(self):
        response = self.client.post(
            "/api/auth/login", json={"name": "admin", "password": "admin123"}
        )
        self.assertEqual(response.status_code, 200)
        return response.get_json()["token"]

    def tearDown(self):
        self.data_patch.stop()
        self.temp_dir.cleanup()

    def test_login_success_returns_valid_token(self):
        response = self.client.post(
            "/api/auth/login", json={"name": "admin", "password": "admin123"}
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["user"]["name"], "admin")
        self.assertEqual(payload["user"]["level"], "admin")
        self.assertIsNotNone(verify_token(payload["token"]))

    def test_login_failure_rejected(self):
        response = self.client.post(
            "/api/auth/login", json={"name": "admin", "password": "wrong"}
        )

        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.get_json()["success"])

    def test_protected_without_token_returns_401(self):
        response = self.client.get("/api/protected")

        self.assertEqual(response.status_code, 401)

    def test_protected_with_valid_token_allowed(self):
        token = self._login_token()
        response = self.client.get(
            "/api/protected", headers={"Authorization": f"Bearer {token}"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])

    def test_health_is_public(self):
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)

    def test_expired_token_rejected(self):
        with patch("backend.auth_routes.TOKEN_TTL_SECONDS", -100):
            expired = self._login_token()
        response = self.client.get(
            "/api/protected", headers={"Authorization": f"Bearer {expired}"}
        )

        self.assertEqual(response.status_code, 401)

    def test_tampered_token_rejected(self):
        token = self._login_token()
        tampered = token[:-2] + ("a" if token[-2] != "a" else "b")
        response = self.client.get(
            "/api/protected", headers={"Authorization": f"Bearer {tampered}"}
        )

        self.assertEqual(response.status_code, 401)

    def test_auth_disabled_allows_all(self):
        # 模拟 AUTH_ENABLED=False：清空 before_request 中间件后受保护接口放行
        self.client.application.before_request_funcs = {None: []}
        response = self.client.get("/api/protected")

        self.assertEqual(response.status_code, 200)

    def test_change_password_updates_hash(self):
        token = self._login_token()
        response = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"old_password": "admin123", "new_password": "newpass123"},
        )

        self.assertEqual(response.status_code, 200)
        # 旧密码失效、新密码可登录
        old = self.client.post(
            "/api/auth/login", json={"name": "admin", "password": "admin123"}
        )
        self.assertEqual(old.status_code, 401)
        fresh = self.client.post(
            "/api/auth/login", json={"name": "admin", "password": "newpass123"}
        )
        self.assertEqual(fresh.status_code, 200)


if __name__ == "__main__":
    unittest.main()
