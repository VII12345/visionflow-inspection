#!/usr/bin/env python3
"""罐子正反（上下方向）识别 - 深度学习版 v7

预处理（训练/推理共用）:
  1. PIL 加载 → 直接 LANCZOS resize 到短边=320
  2. 按比例裁剪罐身
  3. square pad + resize 到 224
  4. → CHW float32 [-1,1]

模型: MobileNetV3-Small 二分类

v7 改进:
  - 丰富数据增强（随机旋转、颜色抖动、平移）
  - 支持真实标注数据（正/ 反/ 子目录）
  - CosineAnnealing 学习率调度
  - EarlyStopping 早停机制
  - ModelCheckpoint 保存最佳模型
  - 可选 backbone 微调
  - 混淆矩阵 + precision/recall/f1 评估
  - 训练历史保存
  - 训练状态回调（供 API 实时轮询）
"""

import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
from torchvision import transforms

IMG_SIZE = 224
DEVICE = "cpu"  # MobileNetV3 太轻量，CPU 推理比 GPU 快


# ─── 数据增强 ──────────────────────────────────────────────

TRAIN_AUGMENT = transforms.Compose([
    transforms.RandomHorizontalFlip(p=0.5),
    transforms.RandomRotation(degrees=10),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1, hue=0.05),
    transforms.RandomAffine(degrees=0, translate=(0.05, 0.05)),
])

# 验证/推理不做增强
VAL_TRANSFORM = transforms.Compose([])


def preprocess(img: Image.Image, augment: bool = False) -> np.ndarray:
    """PIL Image → crop + square → resize 224 → float32[-1,1] CHW"""
    w, h = img.size
    # 先缩到短边 320，大幅减少计算量
    short = min(w, h)
    if short > 320:
        ratio = 320 / short
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    w, h = img.size
    # crop: 左右去15%，上下各去8%
    x0, x1 = int(w * 0.15), int(w * 0.85)
    y0, y1 = int(h * 0.08), int(h * 0.92)
    img = img.crop((x0, y0, x1, y1))
    cw, ch = img.size
    s = max(cw, ch)
    sq = Image.new("RGB", (s, s))
    sq.paste(img, (0, 0))
    sq = sq.resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)

    # 数据增强（仅训练时）
    if augment:
        sq = TRAIN_AUGMENT(sq)

    arr = np.array(sq, dtype=np.float32).transpose(2, 0, 1)
    arr = arr / 127.5 - 1.0
    return arr


def load_and_prepare(img_path: str) -> np.ndarray | None:
    try:
        img = Image.open(img_path).convert("RGB")
        return preprocess(img, augment=False)
    except Exception:
        return None


# ─── 训练数据集 ────────────────────────────────────────────

def _find_labeled_images(folder: Path):
    """从标注目录加载：正/ 和 反/ 子目录"""
    upright_dir = folder / "正"
    inverted_dir = folder / "反"
    samples = []
    if upright_dir.is_dir():
        for p in upright_dir.glob("*"):
            if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp'):
                samples.append((p, 0))
    if inverted_dir.is_dir():
        for p in inverted_dir.glob("*"):
            if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp'):
                samples.append((p, 1))
    return samples


def _find_auto_images(image_dir: Path):
    """自动模式：所有图片作为正样本，旋转180°生成负样本"""
    paths = sorted(
        [p for p in image_dir.glob("*")
         if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp')]
    )
    samples = []
    for p in paths:
        samples.append((p, 0))  # 正
    return samples, paths


class JarDataset(Dataset):
    """罐子分类数据集

    支持三种模式：
    - 标注模式（单目录）：folder/正/*.jpg (label=0), folder/反/*.jpg (label=1)
    - 标注模式（双目录）：upright_dir + inverted_dir 分别指定
    - 自动模式：所有图片 → label=0, 旋转180° → label=1
    """

    def __init__(self, folder: Path, train: bool = True, split: float = 0.8,
                 augment: bool = True,
                 upright_dir: Path | None = None,
                 inverted_dir: Path | None = None):
        self.augment = augment and train

        # 收集样本
        samples = []
        if upright_dir and inverted_dir:
            # 模式：分别指定正/反目录
            self.mode = "labeled_split"
            for p in upright_dir.glob("*"):
                if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp'):
                    samples.append((p, 0))
            for p in inverted_dir.glob("*"):
                if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.bmp'):
                    samples.append((p, 1))
        else:
            # 尝试标注模式（正/ 反/ 子目录）
            labeled = _find_labeled_images(folder)
            if labeled:
                self.mode = "labeled"
                samples = labeled
            else:
                # 自动模式降级
                self.mode = "auto"
                auto_samples, _ = _find_auto_images(folder)
                for img_path, _ in auto_samples:
                    samples.append((img_path, 0, False))
                    samples.append((img_path, 1, True))

        # 划分训练/验证集
        np.random.seed(42)
        idxs = list(range(len(samples)))
        np.random.shuffle(idxs)
        cutoff = int(len(idxs) * split)
        picked = idxs[:cutoff] if train else idxs[cutoff:]
        self.samples = [samples[i] for i in picked]

        # 预加载
        self.x, self.y = [], []
        for item in self.samples:
            try:
                img = Image.open(item[0]).convert("RGB")
                if self.mode == "auto" and len(item) > 2 and item[2]:
                    img = img.transpose(Image.ROTATE_180)
                self.x.append(torch.from_numpy(preprocess(img, augment=self.augment)))
                self.y.append(item[1])
            except Exception:
                pass

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):
        return self.x[idx], self.y[idx]


# ─── 模型 ──────────────────────────────────────────────────

class JarClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
        self._freeze_backbone()
        in_dim = self.backbone.classifier[-1].in_features
        self.backbone.classifier[-1] = nn.Identity()
        self.head = nn.Sequential(
            nn.Linear(in_dim, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 2),
        )

    def forward(self, x):
        return self.head(self.backbone(x))

    def _freeze_backbone(self):
        for p in self.backbone.parameters():
            p.requires_grad = False

    def unfreeze_backbone(self):
        for p in self.backbone.parameters():
            p.requires_grad = True


# ─── 早停 & 检查点 ────────────────────────────────────────

class EarlyStopping:
    def __init__(self, patience=10, min_delta=0.001):
        self.patience = patience
        self.min_delta = min_delta
        self.best_loss = float('inf')
        self.counter = 0

    def __call__(self, val_loss):
        if val_loss < self.best_loss - self.min_delta:
            self.best_loss = val_loss
            self.counter = 0
            return False
        self.counter += 1
        return self.counter >= self.patience


class ModelCheckpoint:
    def __init__(self, save_path):
        self.save_path = Path(save_path)
        self.best_acc = 0.0

    def __call__(self, model, val_acc):
        if val_acc > self.best_acc:
            self.best_acc = val_acc
            torch.save(model.state_dict(), self.save_path)
            return True
        return False


# ─── 评估 ──────────────────────────────────────────────────

def evaluate_model(model, loader):
    """详细评估：返回混淆矩阵 + precision/recall/f1"""
    model.eval()
    all_preds, all_labels = [], []
    with torch.no_grad():
        for x, y in loader:
            x = x.to(DEVICE)
            preds = model(x).argmax(1).cpu().numpy()
            all_preds.extend(preds.tolist())
            all_labels.extend(y.numpy().tolist())

    all_preds = np.array(all_preds)
    all_labels = np.array(all_labels)

    # 混淆矩阵
    tp = int(((all_preds == 1) & (all_labels == 1)).sum())
    tn = int(((all_preds == 0) & (all_labels == 0)).sum())
    fp = int(((all_preds == 1) & (all_labels == 0)).sum())
    fn = int(((all_preds == 0) & (all_labels == 1)).sum())

    acc = (tp + tn) / max(tp + tn + fp + fn, 1)
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-8)

    return {
        'accuracy': round(acc, 4),
        'precision': round(precision, 4),
        'recall': round(recall, 4),
        'f1': round(f1, 4),
        'confusion_matrix': {'TP': tp, 'TN': tn, 'FP': fp, 'FN': fn},
        'total': int(tp + tn + fp + fn),
    }


def _eval_acc(model, loader):
    model.eval()
    corr = tot = 0
    with torch.no_grad():
        for x, y in loader:
            x, y = x.to(DEVICE), y.to(DEVICE)
            corr += (model(x).argmax(1) == y).sum().item()
            tot += y.size(0)
    return corr / max(tot, 1)


# ─── 训练 V2 ───────────────────────────────────────────────

def train_model_v2(
    model,
    train_ldr,
    val_ldr,
    save_path,
    epochs=50,
    lr=0.001,
    finetune_lr=0.0001,
    freeze_epochs=10,
    early_stop_patience=10,
    status_callback=None,  # fn(epoch, total_epochs, train_loss, val_loss, val_acc, message)
):
    """增强版训练

    Args:
        status_callback: 每轮结束后的回调，用于 API 实时推送进度
            签名: callback(epoch, total_epochs, train_loss, val_loss, val_acc, message)
    """
    model.to(DEVICE)
    crit = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.head.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    early_stop = EarlyStopping(patience=early_stop_patience)
    checkpoint = ModelCheckpoint(save_path)

    history = {'train_loss': [], 'val_loss': [], 'val_acc': [], 'lr': []}
    best_epoch = 0
    backbone_unfrozen = False

    for ep in range(epochs):
        # 解冻 backbone（达到 freeze_epochs 后）
        if ep == freeze_epochs and not backbone_unfrozen:
            model.unfreeze_backbone()
            # 重建 optimizer 包含 backbone 参数，使用更低 LR
            optimizer = torch.optim.AdamW([
                {'params': model.backbone.parameters(), 'lr': finetune_lr},
                {'params': model.head.parameters(), 'lr': lr},
            ])
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
                optimizer, T_max=epochs - freeze_epochs
            )
            backbone_unfrozen = True
            if status_callback:
                status_callback(ep + 1, epochs, 0, 0, 0, "解冻 backbone，开始微调...")

        # 训练阶段
        model.train()
        loss_sum = 0
        for x, y in train_ldr:
            x, y = x.to(DEVICE), y.to(DEVICE)
            optimizer.zero_grad()
            loss = crit(model(x), y)
            loss.backward()
            optimizer.step()
            loss_sum += loss.item()

        train_loss = loss_sum / len(train_ldr)
        scheduler.step()
        current_lr = optimizer.param_groups[0]['lr']

        # 验证
        val_loss_sum = 0
        model.eval()
        with torch.no_grad():
            for x, y in val_ldr:
                x, y = x.to(DEVICE), y.to(DEVICE)
                val_loss_sum += crit(model(x), y).item()
        val_loss = val_loss_sum / max(len(val_ldr), 1)
        val_acc = _eval_acc(model, val_ldr)

        # 记录
        history['train_loss'].append(round(train_loss, 4))
        history['val_loss'].append(round(val_loss, 4))
        history['val_acc'].append(round(val_acc, 4))
        history['lr'].append(current_lr)

        # 检查点
        is_best = checkpoint(model, val_acc)
        if is_best:
            best_epoch = ep + 1

        # 回调
        phase = "微调" if backbone_unfrozen else "冻结"
        msg = f"Epoch {ep+1}/{epochs} [{phase}] Loss {train_loss:.4f} Val {val_acc:.2%}"
        if is_best:
            msg += " ★"
        if status_callback:
            status_callback(ep + 1, epochs, train_loss, val_loss, val_acc, msg)

        # 早停
        if early_stop(val_loss):
            if status_callback:
                status_callback(ep + 1, epochs, train_loss, val_loss, val_acc,
                                f"早停触发 (patience={early_stop_patience})，训练结束")
            break

    # 加载最佳模型
    if save_path.exists():
        model.load_state_dict(torch.load(save_path, map_location=DEVICE, weights_only=True))

    # 最终评估
    if status_callback:
        status_callback(-1, epochs, 0, 0, 0, "最终评估中...")

    eval_result = evaluate_model(model, val_ldr)

    history['best_epoch'] = best_epoch
    history['eval'] = eval_result
    history['total_epochs'] = len(history['train_loss'])

    # 保存训练历史
    history_path = save_path.parent / "training_history.json"
    with open(history_path, 'w', encoding='utf-8') as f:
        json.dump(history, f, indent=2, ensure_ascii=False)

    return model, history


# ─── 推理 ──────────────────────────────────────────────────

def classify_single(model, pil_image: Image.Image) -> tuple[str, float]:
    """单帧推理：返回 (label, confidence)"""
    arr = preprocess(pil_image, augment=False)
    tensor = torch.from_numpy(arr).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0]
    pred = int(probs.argmax())
    label = "正" if pred == 0 else "反"
    confidence = float(probs[pred])
    return label, confidence


def classify_batch(model, paths):
    """并行加载 → 一次 batch 推理"""
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=4) as pool:
        tensors = list(pool.map(load_and_prepare, paths))

    valid = [(i, t) for i, t in enumerate(tensors) if t is not None]
    if not valid:
        elapsed = (time.perf_counter() - t0) * 1000
        return [(p, "读取失败", 0.0) for p in paths], elapsed

    batch = torch.from_numpy(np.stack([t for _, t in valid])).to(DEVICE)
    with torch.no_grad():
        logits = model(batch)
        probs = torch.softmax(logits, dim=1)

    results = [("读取失败", 0.0) for _ in range(len(paths))]
    for j, (pi, _) in enumerate(valid):
        p = probs[j]
        pred = int(p.argmax())
        results[pi] = ("正" if pred == 0 else "反", float(p[pred]))

    elapsed = (time.perf_counter() - t0) * 1000
    return [(paths[i], *results[i]) for i in range(len(paths))], elapsed


# ─── 主函数 ────────────────────────────────────────────────

def main():
    img_dir = Path(__file__).parent / "images"
    model_path = Path(__file__).parent / "jar_classifier.pth"

    if model_path.exists():
        print(f"加载模型: {model_path}")
        model = JarClassifier().to(DEVICE)
        model.load_state_dict(
            torch.load(model_path, map_location=DEVICE, weights_only=True)
        )
        model.eval()
    else:
        print("训练新模型...")
        train_set = JarDataset(img_dir, train=True, augment=True)
        val_set = JarDataset(img_dir, train=False, augment=False)
        print(f"数据集模式: {train_set.mode}")
        print(f"训练 {len(train_set)}  验证 {len(val_set)}")
        model, history = train_model_v2(
            JarClassifier(),
            DataLoader(train_set, batch_size=8, shuffle=True),
            DataLoader(val_set, batch_size=8),
            save_path=model_path,
            epochs=50,
            status_callback=lambda ep, total, tl, vl, va, msg: print(f"  {msg}"),
        )
        print(f"最佳轮次: {history['best_epoch']}")
        print(f"评估结果: Acc={history['eval']['accuracy']:.2%} "
              f"P={history['eval']['precision']:.2%} "
              f"R={history['eval']['recall']:.2%} "
              f"F1={history['eval']['f1']:.2%}")
        print(f"已保存: {model_path}")

    paths = (
        sorted(img_dir.glob("*.jpg"))
        + sorted(img_dir.glob("*.jpeg"))
        + sorted(img_dir.glob("*.png"))
    )
    if not paths:
        print("无图片"); return

    str_paths = [str(p) for p in paths]
    results, ms = classify_batch(model, str_paths)
    ms_per = ms / len(paths)

    print(f"\n{'文件名':<52} {'结果':>4} {'置信度':>6}")
    print("-" * 66)
    total = upright = inverted = 0
    for _, label, conf in results:
        total += 1
        if label == "正": upright += 1
        elif label == "反": inverted += 1
        c = f"{conf:.0%}" if conf > 0 else "-"
        pname = paths[total - 1].name if total <= len(paths) else ""
        print(f"{pname:<52} {label:>4} {c:>6}")
    print("-" * 66)
    print(f"共 {total} 张 | 正 {upright} | 反 {inverted} | 耗时 {ms:.1f}ms ({ms_per:.1f}ms/张)")


if __name__ == "__main__":
    main()
