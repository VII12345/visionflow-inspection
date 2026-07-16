#!/usr/bin/env python3
"""测试脚本：对 test/正 和 test/反 两个目录分别测试并统计准确率"""

import sys
from pathlib import Path

from classify_jar import JarClassifier, preprocess, DEVICE
import torch
import numpy as np
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

MODEL_PATH = Path(__file__).parent / "jar_classifier.pth"


def load_one(p: Path) -> np.ndarray | None:
    try:
        img = Image.open(p).convert("RGB")
        return preprocess(img)
    except Exception:
        return None


def test_directory(model, dir_path: Path, expected_label: str) -> dict:
    """测试一个目录，返回统计结果"""
    paths = (
        sorted(dir_path.glob("*.jpg"))
        + sorted(dir_path.glob("*.jpeg"))
        + sorted(dir_path.glob("*.png"))
        + sorted(dir_path.glob("*.webp"))
    )

    if not paths:
        return {"total": 0, "correct": 0, "results": []}

    with ThreadPoolExecutor(max_workers=4) as pool:
        tensors = list(pool.map(load_one, paths))

    valid = [(i, t) for i, t in enumerate(tensors) if t is not None]
    if not valid:
        return {"total": len(paths), "correct": 0, "results": [(p.name, "读取失败") for p in paths]}

    batch = torch.from_numpy(np.stack([t for _, t in valid])).to(DEVICE)
    with torch.no_grad():
        logits = model(batch)
        probs = torch.softmax(logits, dim=1)

    results = []
    correct = 0
    for j, (pi, _) in enumerate(valid):
        p = probs[j]
        pred = "正" if int(p.argmax()) == 0 else "反"
        confidence = float(p[p.argmax()])
        is_correct = pred == expected_label
        if is_correct:
            correct += 1
        results.append((paths[pi].name, pred, confidence, is_correct))

    return {"total": len(paths), "correct": correct, "results": results}


def main():
    if not MODEL_PATH.exists():
        print(f"错误：找不到模型文件 {MODEL_PATH}")
        print("请先运行 python classify_jar.py 训练生成模型")
        sys.exit(1)

    base_dir = Path(__file__).parent / "test"
    if not base_dir.exists():
        print(f"错误：找不到 test/ 目录 ({base_dir})")
        sys.exit(1)

    # 加载模型
    model = JarClassifier().to(DEVICE)
    model.load_state_dict(
        torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
    )
    model.eval()

    # 测试"正"目录
    upright_dir = base_dir / "正"
    if not upright_dir.exists():
        print(f"警告：找不到 test/正/ 目录，跳过")
        upright_result = {"total": 0, "correct": 0, "results": []}
    else:
        print(f"\n=== test/正/ ({upright_dir}) ===\n")
        upright_result = test_directory(model, upright_dir, "正")
        for name, pred, conf, ok in upright_result["results"]:
            marker = "✓" if ok else "✗"
            print(f"{marker} {name} → {pred} ({conf:.0%})")
        print(f"\n正: {upright_result['correct']}/{upright_result['total']} "
              f"({upright_result['correct']/max(upright_result['total'],1):.0%})")

    # 测试"反"目录
    inverted_dir = base_dir / "反"
    if not inverted_dir.exists():
        print(f"警告：找不到 test/反/ 目录，跳过")
        inverted_result = {"total": 0, "correct": 0, "results": []}
    else:
        print(f"\n=== test/反/ ({inverted_dir}) ===\n")
        inverted_result = test_directory(model, inverted_dir, "反")
        for name, pred, conf, ok in inverted_result["results"]:
            marker = "✓" if ok else "✗"
            print(f"{marker} {name} → {pred} ({conf:.0%})")
        print(f"\n反: {inverted_result['correct']}/{inverted_result['total']} "
              f"({inverted_result['correct']/max(inverted_result['total'],1):.0%})")

    # 总正确率
    total = upright_result["total"] + inverted_result["total"]
    correct = upright_result["correct"] + inverted_result["correct"]
    print(f"\n{'='*40}")
    print(f"总计: {correct}/{total} ({correct/max(total,1):.0%})")


if __name__ == "__main__":
    main()