#!/usr/bin/env python3
"""连续向模拟实际运行接口发送随机图片，用于观察稳定性和前端实时反馈。"""
from __future__ import annotations

import argparse
import json
import mimetypes
import random
import time
import uuid
from pathlib import Path
from urllib import request

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def multipart_body(image_path: Path, camera_id: int, model_name: str | None):
    boundary = f"----VisionSimulation{uuid.uuid4().hex}"
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    chunks = []
    fields = {"camera_id": str(camera_id)}
    if model_name:
        fields["model_name"] = model_name
    for key, value in fields.items():
        chunks.extend([f"--{boundary}\r\n".encode(), f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()])
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        image_path.read_bytes(),
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def main():
    parser = argparse.ArgumentParser(description="模拟实际运行稳定性测试")
    parser.add_argument("directory", type=Path, help="随机取图的目录，会递归扫描图片")
    parser.add_argument("--url", default="http://127.0.0.1:5000/api/simulate/frame", help="模拟接收图片接口地址")
    parser.add_argument("--camera-id", type=int, default=1, help="模拟相机编号")
    parser.add_argument("--model", default=None, help="可选：指定模型标识")
    parser.add_argument("--count", type=int, default=0, help="发送次数，0 表示持续运行直到 Ctrl+C")
    parser.add_argument("--min-ms", type=int, default=60, help="两次发送之间的最小随机间隔（毫秒）")
    parser.add_argument("--max-ms", type=int, default=120, help="两次发送之间的最大随机间隔（毫秒）")
    parser.add_argument("--timeout", type=float, default=30, help="单张请求超时（秒）")
    parser.add_argument("--stop-on-error", action="store_true", help="遇到第一张失败图片就停止")
    args = parser.parse_args()
    if not args.directory.is_dir():
        raise SystemExit(f"目录不存在：{args.directory}")
    if args.min_ms < 0 or args.max_ms < args.min_ms:
        raise SystemExit("随机间隔参数无效")
    images = [p for p in args.directory.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]
    if not images:
        raise SystemExit("目录中没有支持的图片")

    sent = success = failed = 0
    print(f"开始稳定性测试：图片 {len(images)} 张，间隔 {args.min_ms}-{args.max_ms}ms，Ctrl+C 停止")
    try:
        while args.count <= 0 or sent < args.count:
            image_path = random.choice(images)
            body, content_type = multipart_body(image_path, args.camera_id, args.model)
            req = request.Request(args.url, data=body, headers={"Content-Type": content_type}, method="POST")
            started = time.perf_counter()
            try:
                with request.urlopen(req, timeout=args.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                elapsed_ms = (time.perf_counter() - started) * 1000
                sent += 1
                if payload.get("success"):
                    success += 1
                    result = payload.get("result") or {}
                    print(f"#{sent} OK {image_path.name} -> {result.get('label', '--')} {result.get('confidence', 0):.1%} request={elapsed_ms:.1f}ms pipeline={result.get('time_ms', '--')}ms")
                else:
                    failed += 1
                    print(f"#{sent} FAIL {image_path.name}: {payload.get('error', '未知错误')}")
                    if args.stop_on_error:
                        break
            except Exception as exc:
                sent += 1
                failed += 1
                print(f"#{sent} ERROR {image_path.name}: {exc}")
                if args.stop_on_error:
                    break
            time.sleep(random.uniform(args.min_ms, args.max_ms) / 1000)
    except KeyboardInterrupt:
        print("\n收到 Ctrl+C，测试结束")
    finally:
        print(f"统计：发送 {sent}，成功 {success}，失败 {failed}")


if __name__ == "__main__":
    main()
