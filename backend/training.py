#!/usr/bin/env python3
"""罐子正反识别 — 深度学习 v8 (GPU + 高精度)

预处理:
  1. PIL 加载 → LANCZOS resize 短边=320
  2. 按比例裁剪罐身
  3. square pad + resize 到 224
  4. CHW float32 [-1,1]

模型: MobileNetV3-Large (预训练) + 自定义分类头

v8 改进:
  - GPU 自动检测 + 混合精度训练 (AMP)
  - MobileNetV3-Large 替换 Small（更高精度）
  - 标签平滑 (Label Smoothing)
  - 加强数据增强 (AutoAugment 风格)
  - 梯度裁剪 + 权重衰减
  - 更多训练轮次 + 更好 LR 调度
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
from torchvision.models import mobilenet_v3_large, MobileNet_V3_Large_Weights
from torchvision import transforms
from torch.amp import autocast

IMG_SIZE = 224
# 默认设备（运行时可通过 set_training_device() 覆盖）
_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def set_training_device(device_str: str):
    """运行时切换训练设备，如 'cuda' 或 'cpu'"""
    global _device
    _device = torch.device(device_str)
    import logging

    logging.getLogger("vision").info(f"训练设备已切换至: {_device}")


def _get_device():
    return _device


def _use_amp():
    return _device.type == "cuda"


# ─── 数据增强（加强版）─────────────────────────────────────

TRAIN_AUGMENT = transforms.Compose(
    [
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomVerticalFlip(p=0.1),  # 新增：罐子方向可能翻转
        transforms.RandomRotation(degrees=15),  # 增大旋转角度
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
        transforms.RandomAffine(degrees=0, translate=(0.08, 0.08), scale=(0.9, 1.1)),
        transforms.RandomPerspective(distortion_scale=0.1, p=0.3),  # 新增：透视变换
    ]
)

VAL_TRANSFORM = transforms.Compose([])

# ── 张量增强：在预计算好的 tensor 上快速做几何增强，避免每轮重复 PIL 解码 ──
# 注意: ColorJitter 需要 [0,1] 范围输入，几何变换对任意范围都正确
TENSOR_GEOMETRIC_AUGMENT = transforms.Compose(
    [
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomVerticalFlip(p=0.1),
        transforms.RandomRotation(
            degrees=15, interpolation=transforms.InterpolationMode.BILINEAR
        ),
        transforms.RandomAffine(degrees=0, translate=(0.08, 0.08), scale=(0.9, 1.1)),
        transforms.RandomPerspective(distortion_scale=0.1, p=0.3),
    ]
)


def _tensor_color_jitter(x: torch.Tensor) -> torch.Tensor:
    """对 [-1,1] 范围的 tensor 做颜色抖动（先转 [0,1] 再做，再转回）"""
    # [-1, 1] → [0, 1]
    x01 = (x + 1.0) / 2.0
    # ColorJitter on [0,1]
    jitter = transforms.ColorJitter(
        brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05
    )
    x01 = jitter(x01)
    # [0, 1] → [-1, 1]
    return x01 * 2.0 - 1.0


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
    """从标注目录加载：正(的)/ 和 反(的)/ 子目录"""
    for up_name in ("正", "正的"):
        upright_dir = folder / up_name
        if upright_dir.is_dir():
            break
    else:
        upright_dir = None
    for inv_name in ("反", "反的"):
        inverted_dir = folder / inv_name
        if inverted_dir.is_dir():
            break
    else:
        inverted_dir = None
    samples = []
    if upright_dir and upright_dir.is_dir():
        for p in upright_dir.glob("*"):
            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                samples.append((p, 0))
    if inverted_dir and inverted_dir.is_dir():
        for p in inverted_dir.glob("*"):
            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                samples.append((p, 1))
    return samples


def _find_auto_images(image_dir: Path):
    """自动模式：所有图片作为正样本，旋转180°生成负样本"""
    paths = sorted(
        [
            p
            for p in image_dir.glob("*")
            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp")
        ]
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

    __init__ 中预计算基础 tensor（无增强），__getitem__ 中快速做张量增强。
    大幅减少 PIL 开销，让 GPU 不再等待 CPU 预处理。
    """

    def __init__(
        self,
        folder: Path,
        train: bool = True,
        split: float = 0.8,
        augment: bool = True,
        upright_dir: Path | None = None,
        inverted_dir: Path | None = None,
    ):
        self.train = train
        self.do_augment = augment and train

        # 收集样本
        samples = []
        if upright_dir and inverted_dir:
            self.mode = "labeled_split"
            for p in upright_dir.glob("*"):
                if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                    samples.append((p, 0, False))
            for p in inverted_dir.glob("*"):
                if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".bmp"):
                    samples.append((p, 1, False))
        else:
            labeled = _find_labeled_images(folder)
            if labeled:
                self.mode = "labeled"
                samples = [(p, lbl, False) for p, lbl in labeled]
            else:
                self.mode = "auto"
                auto_samples, _ = _find_auto_images(folder)
                for img_path, _ in auto_samples:
                    samples.append((img_path, 0, False))
                    samples.append((img_path, 1, True))

        # 划分训练/验证集
        rng = np.random.RandomState(42)
        idxs = list(range(len(samples)))
        rng.shuffle(idxs)
        cutoff = int(len(idxs) * split)
        picked = idxs[:cutoff] if train else idxs[cutoff:]
        self.samples = [samples[i] for i in picked]

        # ── 预计算基础 tensor（无增强），只做一次 PIL 预处理 ──
        self.base_tensors: list[torch.Tensor] = []
        self.labels: list[int] = []
        failed = 0
        import logging

        _log = logging.getLogger("vision")

        for item in self.samples:
            try:
                img = Image.open(item[0]).convert("RGB")
                if self.mode == "auto" and item[2]:
                    img = img.transpose(Image.ROTATE_180)
                # 基础预处理（无增强），结果存入 CPU tensor
                t = torch.from_numpy(preprocess(img, augment=False))
                self.base_tensors.append(t)
                self.labels.append(item[1])
            except Exception:
                failed += 1
        if failed > 0:
            _log.warning(
                f"数据集预加载: {len(self.samples)} 张图片中 {failed} 张加载失败（已跳过），成功 {len(self.base_tensors)} 张"
            )

        if len(self.base_tensors) == 0:
            _log.warning(
                f"数据集为空！请检查路径: folder={folder}, upright={upright_dir}, inverted={inverted_dir}"
            )

    def __len__(self):
        return len(self.base_tensors)

    def __getitem__(self, idx):
        """对预计算 tensor 快速做张量增强（避免每轮 PIL 解码）"""
        x = self.base_tensors[idx].clone()  # clone 防止修改缓存
        if self.do_augment:
            # 几何增强（直接作用于 [-1,1] tensor，非常快）
            x = TENSOR_GEOMETRIC_AUGMENT(x)
            # 颜色增强（需要在 [0,1] 范围）
            x = _tensor_color_jitter(x)
        return x, self.labels[idx]


# ─── 模型 ──────────────────────────────────────────────────


class JarClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone = mobilenet_v3_large(weights=MobileNet_V3_Large_Weights.DEFAULT)
        self._freeze_backbone()
        in_dim = self.backbone.classifier[-1].in_features
        self.backbone.classifier[-1] = nn.Identity()
        self.head = nn.Sequential(
            nn.Linear(in_dim, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
            nn.Dropout(0.4),
            nn.Linear(128, 2),
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
        self.best_loss = float("inf")
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
            x = x.to(_get_device())
            preds = model(x).argmax(1).cpu().numpy()
            all_preds.extend(preds.tolist())
            all_labels.extend(y.numpy().tolist())

    if len(all_labels) == 0:
        return {
            "accuracy": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "confusion_matrix": {"TP": 0, "TN": 0, "FP": 0, "FN": 0},
            "total": 0,
        }

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
        "accuracy": round(acc, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "confusion_matrix": {"TP": tp, "TN": tn, "FP": fp, "FN": fn},
        "total": int(tp + tn + fp + fn),
    }


def _eval_acc(model, loader):
    model.eval()
    corr = tot = 0
    with torch.no_grad():
        for x, y in loader:
            x, y = x.to(_get_device()), y.to(_get_device())
            corr += (model(x).argmax(1) == y).sum().item()
            tot += y.size(0)
    if tot == 0:
        return 0.0  # 空 loader，返回 0（上层已有 warning）
    return corr / tot


# ─── 训练 V2 ───────────────────────────────────────────────


def train_model_v2(
    model,
    train_ldr,
    val_ldr,
    save_path,
    epochs=100,
    lr=0.001,
    finetune_lr=0.0001,
    freeze_epochs=10,
    early_stop_patience=15,
    status_callback=None,
    stop_flag_fn=None,
):
    """GPU 增强训练 + 标签平滑 + 混合精度

    Args:
        status_callback: fn(epoch, total_epochs, train_loss, val_loss, val_acc, message)
        stop_flag_fn: callable() -> bool, 返回 True 时立即停止训练
    """
    import logging

    _log = logging.getLogger("vision")

    # 检查数据加载器是否为空
    if len(train_ldr) == 0:
        msg = "❌ 训练集为空（batch_size 可能大于数据集大小，且 drop_last=True），无法训练"
        _log.error(msg)
        if status_callback:
            status_callback(-1, epochs, 0, 0, 0, msg)
        return model, {
            "train_loss": [],
            "val_loss": [],
            "val_acc": [],
            "lr": [],
            "best_epoch": 0,
            "eval": {
                "accuracy": 0,
                "precision": 0,
                "recall": 0,
                "f1": 0,
                "confusion_matrix": {"TP": 0, "TN": 0, "FP": 0, "FN": 0},
                "total": 0,
            },
            "total_epochs": 0,
        }

    if len(val_ldr) == 0:
        _log.warning(
            "⚠️ 验证集为空（batch_size 可能大于验证集大小，且 drop_last=True），验证指标将不准确"
        )
        _log.warning("   建议减小 batch_size 或设置 drop_last=False")

    msg = f"设备: {_get_device()}" + (" (GPU 混合精度)" if _use_amp() else " (CPU)")
    if status_callback:
        status_callback(0, epochs, 0, 0, 0, msg)
    print(msg)

    model.to(_get_device())
    crit = nn.CrossEntropyLoss(label_smoothing=0.1)  # 标签平滑
    optimizer = torch.optim.AdamW(model.head.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(
        optimizer, T_0=20, T_mult=2
    )
    scaler = torch.amp.GradScaler("cuda", enabled=_use_amp())
    early_stop = EarlyStopping(patience=early_stop_patience)
    checkpoint = ModelCheckpoint(save_path)

    history = {"train_loss": [], "val_loss": [], "val_acc": [], "lr": []}
    best_epoch = 0
    backbone_unfrozen = False

    for ep in range(epochs):
        # 检查外部停止标志
        if stop_flag_fn and stop_flag_fn():
            if status_callback:
                status_callback(ep + 1, epochs, 0, 0, 0, "训练已被用户停止")
            _log.info("训练被停止标志中断")
            break

        if ep == freeze_epochs and not backbone_unfrozen:
            model.unfreeze_backbone()
            optimizer = torch.optim.AdamW(
                [
                    {
                        "params": model.backbone.parameters(),
                        "lr": finetune_lr,
                        "weight_decay": 1e-5,
                    },
                    {"params": model.head.parameters(), "lr": lr, "weight_decay": 1e-4},
                ]
            )
            scheduler = torch.optim.lr_scheduler.CosineAnnealingWarmRestarts(
                optimizer, T_0=20, T_mult=2
            )
            backbone_unfrozen = True
            if status_callback:
                status_callback(ep + 1, epochs, 0, 0, 0, "解冻 backbone，开始微调...")

        # 训练
        model.train()
        loss_sum = 0
        for x, y in train_ldr:
            x, y = x.to(_get_device()), y.to(_get_device())
            optimizer.zero_grad()
            with autocast("cuda", enabled=_use_amp()):
                loss = crit(model(x), y)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)  # 梯度裁剪
            scaler.step(optimizer)
            scaler.update()
            loss_sum += loss.item()

        train_loss = loss_sum / len(train_ldr)
        scheduler.step()
        current_lr = optimizer.param_groups[0]["lr"]

        # 验证
        val_loss_sum = 0
        model.eval()
        with torch.no_grad():
            for x, y in val_ldr:
                x, y = x.to(_get_device()), y.to(_get_device())
                val_loss_sum += crit(model(x), y).item()
        val_loss = val_loss_sum / max(len(val_ldr), 1)
        val_acc = _eval_acc(model, val_ldr)

        # 记录
        history["train_loss"].append(round(train_loss, 4))
        history["val_loss"].append(round(val_loss, 4))
        history["val_acc"].append(round(val_acc, 4))
        history["lr"].append(current_lr)

        # 检查点
        is_best = checkpoint(model, val_acc)
        if is_best:
            best_epoch = ep + 1

        # 回调
        phase = "微调" if backbone_unfrozen else "冻结"
        msg = (
            f"Epoch {ep + 1}/{epochs} [{phase}] Loss {train_loss:.4f} Val {val_acc:.2%}"
        )
        if is_best:
            msg += " ★"
        if status_callback:
            status_callback(ep + 1, epochs, train_loss, val_loss, val_acc, msg)

        # 早停
        if early_stop(val_loss):
            if status_callback:
                status_callback(
                    ep + 1,
                    epochs,
                    train_loss,
                    val_loss,
                    val_acc,
                    f"早停触发 (patience={early_stop_patience})，训练结束",
                )
            break

    # 加载最佳模型
    if save_path.exists():
        model.load_state_dict(
            torch.load(save_path, map_location=_get_device(), weights_only=True)
        )

    # 最终评估
    if status_callback:
        status_callback(-1, epochs, 0, 0, 0, "最终评估中...")

    eval_result = evaluate_model(model, val_ldr)

    history["best_epoch"] = best_epoch
    history["eval"] = eval_result
    history["total_epochs"] = len(history["train_loss"])

    # 保存训练历史
    history_path = save_path.parent / "training_history.json"
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)

    return model, history


# ─── 推理 ──────────────────────────────────────────────────


def classify_single(model, pil_image: Image.Image, timing: dict | None = None) -> tuple[str, float]:
    """单帧推理：返回 (label, confidence)，可选记录实际推理 Worker 内部耗时。"""
    import time as _time

    model_device = next(model.parameters()).device
    t0 = _time.perf_counter()
    arr = preprocess(pil_image, augment=False)
    tensor = torch.from_numpy(arr).unsqueeze(0).to(model_device)
    if timing is not None:
        timing["preprocess_ms"] = (_time.perf_counter() - t0) * 1000

    # CUDA kernel 是异步提交的，前后同步才能得到真实模型执行耗时。
    if model_device.type == "cuda" and torch.cuda.is_available():
        torch.cuda.synchronize(model_device)
    t0 = _time.perf_counter()
    with torch.no_grad():
        logits = model(tensor)
    if model_device.type == "cuda" and torch.cuda.is_available():
        torch.cuda.synchronize(model_device)
    if timing is not None:
        timing["model_call_ms"] = (_time.perf_counter() - t0) * 1000

    t0 = _time.perf_counter()
    probs = torch.softmax(logits, dim=1)[0]
    pred = int(probs.argmax())
    label = "正" if pred == 0 else "反"
    confidence = float(probs[pred])
    if timing is not None:
        timing["recognition_ms"] = (_time.perf_counter() - t0) * 1000
    return label, confidence

def classify_frames_batch(model, frames: list[Image.Image]) -> list[tuple[str, float]]:
    """批量推理：多张 PIL Image 合并为一个 batch，一次 GPU 前向传播。

    比逐帧 classify_single 快很多（减少 GPU kernel launch 次数，利用 GPU 并行）。
    """
    if not frames:
        return []
    if len(frames) == 1:
        result = classify_single(model, frames[0])
        return [result]

    model_device = next(model.parameters()).device

    # 并行预处理所有帧
    tensors = []
    for img in frames:
        arr = preprocess(img, augment=False)
        tensors.append(torch.from_numpy(arr))
    batch = torch.stack(tensors).to(model_device)

    with torch.no_grad():
        logits = model(batch)
        probs = torch.softmax(logits, dim=1)

    results = []
    for i in range(len(frames)):
        pred = int(probs[i].argmax())
        label = "正" if pred == 0 else "反"
        confidence = float(probs[i][pred])
        results.append((label, confidence))
    return results
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
        model = JarClassifier().to(_get_device())
        model.load_state_dict(
            torch.load(model_path, map_location=_get_device(), weights_only=True)
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
        print(
            f"评估结果: Acc={history['eval']['accuracy']:.2%} "
            f"P={history['eval']['precision']:.2%} "
            f"R={history['eval']['recall']:.2%} "
            f"F1={history['eval']['f1']:.2%}"
        )
        print(f"已保存: {model_path}")

    paths = (
        sorted(img_dir.glob("*.jpg"))
        + sorted(img_dir.glob("*.jpeg"))
        + sorted(img_dir.glob("*.png"))
    )
    if not paths:
        print("无图片")
        return

    str_paths = [str(p) for p in paths]
    results, ms = classify_batch(model, str_paths)
    ms_per = ms / len(paths)

    print(f"\n{'文件名':<52} {'结果':>4} {'置信度':>6}")
    print("-" * 66)
    total = upright = inverted = 0
    for _, label, conf in results:
        total += 1
        if label == "正":
            upright += 1
        elif label == "反":
            inverted += 1
        c = f"{conf:.0%}" if conf > 0 else "-"
        pname = paths[total - 1].name if total <= len(paths) else ""
        print(f"{pname:<52} {label:>4} {c:>6}")
    print("-" * 66)
    print(
        f"共 {total} 张 | 正 {upright} | 反 {inverted} | 耗时 {ms:.1f}ms ({ms_per:.1f}ms/张)"
    )


if __name__ == "__main__":
    main()

