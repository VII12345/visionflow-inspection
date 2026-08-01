"""模型训练任务的状态管理和 HTTP API。"""

import json
import threading
from pathlib import Path

from flask import Blueprint, jsonify, request

from .config import Config
from .logger import logger
from .runtime_state import runtime


training_bp = Blueprint("training", __name__)


# ========== 训练状态 ==========

runtime.training_state = {
    "running": False,
    "progress": 0,
    "epoch": 0,
    "total_epochs": Config.TRAINING_EPOCHS,
    "train_loss": 0,
    "val_loss": 0,
    "val_acc": 0,
    "message": "",
    "history": None,
    "folderPath": "",
    "modelName": "",
    "modelPath": None,
    "evalResult": None,
    "trainCount": 0,
    "valCount": 0,
}
runtime._training_thread = None
runtime._training_stop_flag = False


# ========== 训练 API ==========


def _training_status_callback(
    epoch, total_epochs, train_loss, val_loss, val_acc, message
):
    """训练进度回调，更新全局状态供前端轮询"""
    if epoch > 0:
        runtime.training_state["epoch"] = epoch
    runtime.training_state["total_epochs"] = total_epochs
    runtime.training_state["train_loss"] = round(train_loss, 4)
    runtime.training_state["val_loss"] = round(val_loss, 4)
    runtime.training_state["val_acc"] = round(val_acc, 4)
    runtime.training_state["message"] = message
    if total_epochs > 0:
        runtime.training_state["progress"] = round(
            min(epoch, total_epochs) / total_epochs * 100, 1
        )


def _run_training(folder_path, model_name, class_a_path=None, class_b_path=None):
    """后台训练线程"""
    try:
        from .training import (
            ProductDataset,
            ProductClassifier,
            train_model_v2,
            set_training_device,
        )

        # 应用用户配置的训练设备
        training_device = getattr(Config, "TRAINING_DEVICE", Config.DEVICE)
        set_training_device(training_device)
        logger.info(f"训练设备: {training_device}")

        logger.info(
            f"开始训练: model={model_name}, classA={class_a_path}, classB={class_b_path}, folder={folder_path}"
        )
        runtime.training_state["message"] = "正在加载数据..."

        train_set = ProductDataset(
            Path(folder_path) if folder_path else Path.cwd(),
            train=True,
            augment=True,
            class_a_dir=Path(class_a_path) if class_a_path else None,
            class_b_dir=Path(class_b_path) if class_b_path else None,
        )
        val_set = ProductDataset(
            Path(folder_path) if folder_path else Path.cwd(),
            train=False,
            augment=False,
            class_a_dir=Path(class_a_path) if class_a_path else None,
            class_b_dir=Path(class_b_path) if class_b_path else None,
        )

        logger.info(
            f"数据集模式: {train_set.mode}, 训练集={len(train_set)}, 验证集={len(val_set)}"
        )

        runtime.training_state["trainCount"] = len(train_set)
        runtime.training_state["valCount"] = len(val_set)

        from torch.utils.data import DataLoader

        # 自适应 batch size：不超过训练集大小的 1/2，也不超过验证集大小
        adaptive_batch = min(
            Config.TRAINING_BATCH_SIZE,
            max(2, len(train_set) // 2),
            max(2, len(val_set)),
        )
        if adaptive_batch < Config.TRAINING_BATCH_SIZE:
            logger.info(
                f"数据集较小，batch_size 自动调整为 {adaptive_batch} "
                f"(原 {Config.TRAINING_BATCH_SIZE}, 训练集={len(train_set)}, 验证集={len(val_set)})"
            )

        train_ldr = DataLoader(
            train_set,
            batch_size=adaptive_batch,
            shuffle=True,
            drop_last=True,
            num_workers=0,  # Windows 多进程在 daemon 线程中有问题，用 0
            pin_memory=True,  # 加速 CPU→GPU 传输
        )
        val_ldr = DataLoader(
            val_set,
            batch_size=adaptive_batch,
            drop_last=False,
            num_workers=0,
            pin_memory=True,
        )

        model_path = Config.DATA_DIR / f"model_classifier_{model_name}.pth"

        # 传递停止标志检查函数
        def _check_stop():
            return runtime._training_stop_flag

        model, history = train_model_v2(
            ProductClassifier(num_classes=train_set.num_classes),
            train_ldr,
            val_ldr,
            save_path=model_path,
            epochs=Config.TRAINING_EPOCHS,
            lr=Config.TRAINING_LR,
            finetune_lr=Config.TRAINING_FINETUNE_LR,
            freeze_epochs=Config.TRAINING_FREEZE_EPOCHS,
            early_stop_patience=Config.TRAINING_EARLY_STOP,
            status_callback=_training_status_callback,
            stop_flag_fn=_check_stop,
        )

        metadata_path = model_path.with_suffix(".json")
        metadata_path.write_text(json.dumps({"categories": train_set.categories, "num_classes": train_set.num_classes}, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(f"模型已保存: {model_path}，类别: {train_set.categories}")

        # 清除模型缓存，下次推理自动加载新模型
        from .model_loader import models, model_categories, load_model

        models.clear()
        model_categories.clear()
        load_model(model_name)
        logger.info("推理模型已更新")

        runtime.training_state["history"] = history
        runtime.training_state["modelPath"] = str(model_path)
        runtime.training_state["evalResult"] = history.get("eval", {})
        runtime.training_state["message"] = (
            f"训练完成！最佳轮次: {history['best_epoch']}, "
            f"验证准确率: {history['eval']['accuracy']:.2%}"
        )
        runtime.training_state["progress"] = 100
        logger.info(f"训练完成: {runtime.training_state['message']}")

    except Exception as e:
        logger.error(f"训练失败: {e}", exc_info=True)
        runtime.training_state["message"] = f"训练失败: {str(e)}"
        runtime.training_state["evalResult"] = None
        runtime.training_state["modelPath"] = None
    finally:
        runtime.training_state["running"] = False


@training_bp.route("/api/training/start", methods=["POST"])
def start_training():
    """启动训练"""

    if runtime.training_state["running"]:
        return jsonify({"success": False, "message": "训练已在运行中"})

    try:
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "训练参数格式无效"}), 400

        def clean_path(field_name):
            value = data.get(field_name, "")
            if value is None:
                return ""
            if not isinstance(value, str):
                raise ValueError(f"{field_name} 必须是文本路径")
            return value.strip()

        folder_path = clean_path("folderPath")
        category_root_path = clean_path("categoryRootPath") or folder_path
        class_a_path = clean_path("classAPath")
        class_b_path = clean_path("classBPath")
        model_name = clean_path("modelName") or "default"

        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}

        def validate_image_directory(path_value, label, recursive=False):
            directory = Path(path_value)
            if not directory.is_dir():
                return f"{label}不存在或不是文件夹: {path_value}"
            try:
                candidates = directory.rglob("*") if recursive else directory.iterdir()
                image_count = sum(
                    1
                    for item in candidates
                    if item.is_file() and item.suffix.lower() in image_extensions
                )
            except OSError as exc:
                return f"无法读取{label}: {exc}"
            if image_count == 0:
                return f"{label}中没有可识别的图片文件: {path_value}"
            return None

        if class_a_path and class_b_path:
            # 双目录模式
            error = validate_image_directory(class_a_path, "第一类别目录")
            if error:
                return jsonify({"success": False, "message": error}), 400
            error = validate_image_directory(class_b_path, "第二类别目录")
            if error:
                return jsonify({"success": False, "message": error}), 400
        elif category_root_path:
            root = Path(category_root_path)
            error = validate_image_directory(category_root_path, "类别根目录", recursive=True)
            if error:
                return jsonify({"success": False, "message": error}), 400
            category_dirs = [directory for directory in sorted(root.iterdir(), key=lambda item: item.name) if directory.is_dir() and any(item.is_file() for item in directory.iterdir())]
            if len(category_dirs) < 2:
                return jsonify({"success": False, "message": "类别根目录至少需要包含两个带图片的子目录"}), 400
            folder_path = category_root_path
        else:
            return jsonify({"success": False, "message": "请选择图片文件夹"}), 400

        # 重置状态
        runtime.training_state.update(
            {
                "running": True,
                "progress": 0,
                "epoch": 0,
                "total_epochs": Config.TRAINING_EPOCHS,
                "train_loss": 0,
                "val_loss": 0,
                "val_acc": 0,
                "message": "正在初始化...",
                "history": None,
                "folderPath": folder_path,
                "categoryRootPath": category_root_path,
                "classAPath": class_a_path,
                "classBPath": class_b_path,
                "modelName": model_name,
                "modelPath": None,
                "evalResult": None,
                "trainCount": 0,
                "valCount": 0,
            }
        )
        runtime._training_stop_flag = False

        runtime._training_thread = threading.Thread(
            target=_run_training,
            args=(folder_path, model_name, class_a_path, class_b_path),
            daemon=True,
        )
        runtime._training_thread.start()

        logger.info(f"训练线程已启动: {folder_path}")
        return jsonify({"success": True, "message": "训练已启动"})

    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        logger.error(f"启动训练失败: {e}")
        runtime.training_state["running"] = False
        return jsonify({"success": False, "message": str(e)}), 500


@training_bp.route("/api/training/status", methods=["GET"])
def get_training_status():
    """获取训练进度"""
    return jsonify(runtime.training_state)


@training_bp.route("/api/training/stop", methods=["POST"])
def stop_training():
    """停止训练"""
    runtime._training_stop_flag = True
    runtime.training_state["running"] = False
    runtime.training_state["message"] = "训练已手动停止"
    logger.info("训练已手动停止")
    return jsonify({"success": True, "message": "训练已停止"})


@training_bp.route("/api/training/history", methods=["GET"])
def get_training_history():
    """获取最近训练历史"""
    history_path = Config.DATA_DIR / "training_history.json"
    if history_path.exists():
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                return jsonify({"success": True, "history": json.load(f)})
        except Exception:
            pass
    return jsonify({"success": True, "history": runtime.training_state.get("history")})
