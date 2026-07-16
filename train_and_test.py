"""GPU训练 + 全量测试"""

import sys
from pathlib import Path
import torch
from torch.utils.data import DataLoader
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from backend.training import (
    JarClassifier,
    JarDataset,
    train_model_v2,
    DEVICE,
    classify_single,
)

img_dir = Path("images")
model_path = Path("jar_classifier_test.pth")

print(f"设备: {DEVICE}")
print(f"图片目录: {img_dir.resolve()}")

train_set = JarDataset(img_dir, train=True, augment=True)
val_set = JarDataset(img_dir, train=False, augment=False)
print(f"数据集模式: {train_set.mode}")
print(f"训练集: {len(train_set)}  验证集: {len(val_set)}")

if len(train_set) == 0:
    print("ERROR: 无训练数据!")
    sys.exit(1)

print("开始训练...")
model, history = train_model_v2(
    JarClassifier().to(DEVICE),
    DataLoader(train_set, batch_size=16, shuffle=True, num_workers=0),
    DataLoader(val_set, batch_size=16, num_workers=0),
    save_path=model_path,
    epochs=50,
    status_callback=lambda ep, total, tl, vl, va, msg: print(f"  [{ep}/{total}] {msg}"),
)

print(f"\n最佳轮次: {history['best_epoch']}")
eval_ = history["eval"]
print(
    f"验证集: Acc={eval_['accuracy']:.2%} P={eval_['precision']:.2%} R={eval_['recall']:.2%} F1={eval_['f1']:.2%}"
)

# 逐张测试
print("\n=== 逐张测试 ===")
correct = total = 0
for cls_name in ["正的", "反的"]:
    cls_dir = img_dir / cls_name
    if not cls_dir.is_dir():
        continue
    expected = cls_name[0]  # "正" or "反"
    for p in sorted(cls_dir.glob("*")):
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png", ".bmp"):
            continue
        img = Image.open(p).convert("RGB")
        label, conf = classify_single(model, img)
        ok = "✓" if label == expected else "✗"
        if label == expected:
            correct += 1
        total += 1
        print(f"  {ok} {p.name}: 预测={label} 置信度={conf:.3f}")

print(
    f"\n总准确率: {correct}/{total} = {correct / total:.2%}"
    if total > 0
    else "无测试图片"
)
