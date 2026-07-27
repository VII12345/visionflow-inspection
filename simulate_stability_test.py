from __future__ import annotations

import argparse
import json
import mimetypes
import random
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib import error, request

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def collect_category_images(root: Path) -> list[tuple[Path, Path]]:
    """将一级子目录视为类别，目录名就是期望模型输出。"""
    samples: list[tuple[Path, Path]] = []
    for category_dir in sorted(item for item in root.iterdir() if item.is_dir()):
        images = [
            item
            for item in category_dir.rglob("*")
            if item.is_file() and item.suffix.lower() in IMAGE_EXTENSIONS
        ]
        samples.extend((category_dir, image) for image in images)
    return samples


def multipart_body(image_path: Path, camera_id: int, model_name: str | None):
    boundary = f"----VisionSimulation{uuid.uuid4().hex}"
    mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    chunks: list[bytes] = []
    fields = {"camera_id": str(camera_id)}
    if model_name:
        fields["model_name"] = model_name
    for key, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode(),
        ])
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        image_path.read_bytes(),
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def read_json_response(response) -> dict:
    raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def write_log(log_file: Path, record: dict) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description="模拟实际运行稳定性测试：按类别子目录随机发送图片并记录结果")
    parser.add_argument("directory", type=Path, help="图片根目录；一级子目录名称作为期望类别")
    parser.add_argument("--url", default="http://127.0.0.1:5000/api/simulate/frame", help="独立模拟接收图片接口地址")
    parser.add_argument("--camera-id", type=int, default=1, help="模拟相机编号")
    parser.add_argument("--model", default=None, help="可选：指定模型标识")
    parser.add_argument("--count", type=int, default=0, help="发送次数，0 表示持续运行直到 Ctrl+C")
    parser.add_argument("--min-ms", type=int, default=60, help="两次发送之间的最小随机间隔（毫秒）")
    parser.add_argument("--max-ms", type=int, default=120, help="两次发送之间的最大随机间隔（毫秒）")
    parser.add_argument("--timeout", type=float, default=30, help="单张请求超时（秒）")
    parser.add_argument("--log", type=Path, default=None, help="日志文件路径，默认写入项目根目录 simulate_stability_test.log")
    parser.add_argument("--stop-on-error", action="store_true", help="遇到第一张请求失败就停止")
    args = parser.parse_args()

    root = args.directory.resolve()
    if not root.is_dir():
        raise SystemExit(f"目录不存在：{root}")
    if args.min_ms < 0 or args.max_ms < args.min_ms:
        raise SystemExit("随机间隔参数无效")
    samples = collect_category_images(root)
    if not samples:
        raise SystemExit("目录下没有包含图片的类别子文件夹")

    log_file = (args.log if args.log is not None else Path(__file__).resolve().parent / "simulate_stability_test.log").resolve()
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    write_log(log_file, {
        "type": "run_start",
        "run_id": run_id,
        "started_at": datetime.now().isoformat(timespec="milliseconds"),
        "directory": str(root),
        "url": args.url,
        "sample_count": len(samples),
        "interval_ms": [args.min_ms, args.max_ms],
    })

    sent = success = failed = correct = 0
    elapsed_values: list[float] = []
    print(f"开始稳定性测试：类别 {len({category for category, _ in samples})} 个，图片 {len(samples)} 张，间隔 {args.min_ms}-{args.max_ms}ms")
    print(f"日志文件：{log_file}")
    try:
        while args.count <= 0 or sent < args.count:
            category_dir, image_path = random.choice(samples)
            expected = category_dir.name
            body, content_type = multipart_body(image_path, args.camera_id, args.model)
            req = request.Request(args.url, data=body, headers={"Content-Type": content_type}, method="POST")
            started = time.perf_counter()
            payload: dict = {}
            predicted = None
            confidence = None
            error_message = None
            try:
                with request.urlopen(req, timeout=args.timeout) as response:
                    payload = read_json_response(response)
                elapsed_ms = (time.perf_counter() - started) * 1000
                output = payload.get("simulation_output") or payload.get("result") or {}
                predicted = str(output.get("label") or "未分类")
                confidence = float(output.get("confidence") or 0)
                is_correct = predicted == expected
                sent += 1
                success += 1
                correct += int(is_correct)
                elapsed_values.append(elapsed_ms)
                print(f"#{sent} {'正确' if is_correct else '错误'} 期望={expected} 输出={predicted} 置信度={confidence:.1%} 端到端={elapsed_ms:.1f}ms 图片={image_path.name}")
            except error.HTTPError as exc:
                elapsed_ms = (time.perf_counter() - started) * 1000
                try:
                    payload = read_json_response(exc)
                    error_message = payload.get("error") or payload.get("message") or str(exc)
                except Exception:
                    error_message = str(exc)
                sent += 1
                failed += 1
                print(f"#{sent} 请求失败：{error_message}")
            except Exception as exc:
                elapsed_ms = (time.perf_counter() - started) * 1000
                error_message = str(exc)
                sent += 1
                failed += 1
                print(f"#{sent} 请求异常：{error_message}")

            write_log(log_file, {
                "type": "result",
                "run_id": run_id,
                "index": sent,
                "time": datetime.now().isoformat(timespec="milliseconds"),
                "image": str(image_path),
                "expected": expected,
                "predicted": predicted if payload else None,
                "correct": (predicted == expected) if payload and not error_message else None,
                "confidence": confidence if payload and not error_message else None,
                "elapsed_ms": round(elapsed_ms, 3),
                "error": error_message,
            })
            if error_message and args.stop_on_error:
                break
            time.sleep(random.uniform(args.min_ms, args.max_ms) / 1000)
    except KeyboardInterrupt:
        print("\n收到 Ctrl+C，测试结束")
    finally:
        accuracy = (correct / success) if success else 0
        summary = {
            "type": "run_end",
            "run_id": run_id,
            "ended_at": datetime.now().isoformat(timespec="milliseconds"),
            "sent": sent,
            "success": success,
            "failed": failed,
            "correct": correct,
            "accuracy": round(accuracy, 6),
            "avg_elapsed_ms": round(sum(elapsed_values) / len(elapsed_values), 3) if elapsed_values else None,
            "min_elapsed_ms": round(min(elapsed_values), 3) if elapsed_values else None,
            "max_elapsed_ms": round(max(elapsed_values), 3) if elapsed_values else None,
        }
        write_log(log_file, summary)
        print(f"统计：发送 {sent}，请求成功 {success}，失败 {failed}，识别正确 {correct}，正确率 {accuracy:.2%}")
        print(f"端到端耗时：平均 {summary['avg_elapsed_ms']}ms，最短 {summary['min_elapsed_ms']}ms，最长 {summary['max_elapsed_ms']}ms")


if __name__ == "__main__":
    main()
