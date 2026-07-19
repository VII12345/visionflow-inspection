"""GPU/CPU训练 + 全量测试（使用 test/ 目录图片）"""

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
    set_training_device,
    _get_device,
    classify_single,
)

# ========== 配置 ==========
IMG_DIR = Path("test")  # 使用 test/ 目录（含 正/ 反/ 子目录）
MODEL_PATH = Path("jar_classifier_test.pth")
EPOCHS = 80  # 训练轮次
BATCH_SIZE = 8  # 较小batch适配小数据集（33张图）

# ========== 设备检测 ==========
device_str = "cuda" if torch.cuda.is_available() else "cpu"
set_training_device(device_str)
device = _get_device()
print(f"设备: {device}")
if device.type == "cuda":
    print(
        f"GPU: {torch.cuda.get_device_name(0)} ({torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB)"
    )

img_dir = Path(IMG_DIR)
print(f"图片目录: {img_dir.resolve()}")

if not img_dir.exists():
    print(f"ERROR: 目录不存在: {img_dir}")
    sys.exit(1)

# ========== 数据集 ==========
train_set = JarDataset(img_dir, train=True, augment=True)
val_set = JarDataset(img_dir, train=False, augment=False)
print(f"数据集模式: {train_set.mode}")
print(f"训练集: {len(train_set)}  验证集: {len(val_set)}")

if len(train_set) == 0:
    print("ERROR: 无训练数据! 请确保 test/ 下存在 正/ 和 反/ 子目录并有图片。")
    sys.exit(1)

# 自适应 batch size
adaptive_batch = min(BATCH_SIZE, max(2, len(train_set) // 2), max(2, len(val_set)))
if adaptive_batch < BATCH_SIZE:
    print(f"⚠ 数据集较小，batch_size 自动调整为 {adaptive_batch} (原 {BATCH_SIZE})")

# 训练集 drop_last=True（丢弃最后不完整 batch），验证集 drop_last=False（评估所有样本）
train_ldr = DataLoader(
    train_set, batch_size=adaptive_batch, shuffle=True, drop_last=True
)
val_ldr = DataLoader(val_set, batch_size=adaptive_batch, drop_last=False)

print(f"训练批次数: {len(train_ldr)}  (每批 {adaptive_batch} 张)")
print(f"验证批次数: {len(val_ldr)}  (每批 {adaptive_batch} 张)")

if len(train_ldr) == 0:
    print("ERROR: 训练 DataLoader 为空！batch_size 可能大于训练集大小。")
    sys.exit(1)

# ========== 训练 ==========
print("\n开始训练...")
print("-" * 60)
model, history = train_model_v2(
    JarClassifier().to(device),
    train_ldr,
    val_ldr,
    save_path=MODEL_PATH,
    epochs=EPOCHS,
    status_callback=lambda ep, total, tl, vl, va, msg: print(f"  [{ep}/{total}] {msg}"),
)
print("-" * 60)

if history.get("total_epochs", 0) == 0:
    print("ERROR: 训练未能执行任何 epoch！")
    sys.exit(1)

print(f"\n最佳轮次: {history['best_epoch']}")
eval_ = history["eval"]
print(
    f"验证集: Acc={eval_['accuracy']:.2%} P={eval_['precision']:.2%} "
    f"R={eval_['recall']:.2%} F1={eval_['f1']:.2%}"
)
cm = eval_["confusion_matrix"]
print(f"混淆矩阵: TP={cm['TP']} TN={cm['TN']} FP={cm['FP']} FN={cm['FN']}")

# ========== 逐张测试 ==========
print("\n=== 逐张测试 ===")
correct = total = 0
for cls_name, expected in [("正", "正"), ("反", "反")]:
    cls_dir = img_dir / cls_name
    if not cls_dir.is_dir():
        print(f"  目录不存在: {cls_dir}，跳过")
        continue
    for p in sorted(cls_dir.glob("*")):
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png", ".bmp"):
            continue
        try:
            img = Image.open(p).convert("RGB")
            label, conf = classify_single(model, img)
            ok = "✓" if label == expected else "✗"
            if label == expected:
                correct += 1
            total += 1
            print(f"  {ok} {p.name}: 预测={label} 置信度={conf:.3f}")
        except Exception as e:
            print(f"  !! {p.name}: 推理失败 - {e}")
            total += 1

print("-" * 60)
if total > 0:
    print(f"总准确率: {correct}/{total} = {correct / total:.2%}")
else:
    print("无测试图片")

print(f"\n模型已保存: {MODEL_PATH.resolve()}")
