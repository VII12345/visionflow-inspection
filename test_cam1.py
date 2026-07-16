"""测试 releases/data/cam1 目录下的图片"""

import sys
from pathlib import Path
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from backend.training import JarClassifier, classify_single, DEVICE

model_path = Path("jar_classifier_test.pth")
test_dir = Path("releases/data/cam1")

print(f"设备: {DEVICE}")
print(f"测试目录: {test_dir.resolve()}")

model = JarClassifier().to(DEVICE)
model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
model.eval()
print("模型加载完成\n")

correct = total = 0
for cls_name in ["正的", "正", "反的", "反"]:
    cls_dir = test_dir / cls_name
    if not cls_dir.is_dir():
        continue
    expected = cls_name[0]
    cls_correct = 0
    cls_total = 0
    print(f"--- {cls_dir.name}/ ---")
    for p in sorted(cls_dir.glob("*")):
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png", ".bmp"):
            continue
        img = Image.open(p).convert("RGB")
        label, conf = classify_single(model, img)
        ok = "✓" if label == expected else "✗"
        if label == expected:
            correct += 1
            cls_correct += 1
        total += 1
        cls_total += 1
        if ok == "✗":
            print(f"  {ok} {p.name}: 预测={label} 期望={expected} 置信度={conf:.3f}")
    print(f"  正确: {cls_correct}/{cls_total}\n")

print(f"总准确率: {correct}/{total} = {correct / total:.2%}")
