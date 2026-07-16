#!/bin/bash
# WSL 环境准备脚本
# 注意：此脚本只能完成准备工作，无法生成 Windows EXE

echo "========== WSL 环境准备 =========="

# 1. 检查环境
echo ""
echo "[1/4] 检查环境..."
python3 --version || { echo "错误: 未找到 Python3"; exit 1; }
node --version || { echo "错误: 未找到 Node.js"; exit 1; }

# 2. 安装 Python 依赖
echo ""
echo "[2/4] 安装 Python 依赖..."
source .venv/bin/activate
pip install -q flask flask-cors pillow torch torchvision

# 3. 测试后端代码
echo ""
echo "[3/4] 测试后端代码..."
python -c "
from backend.server import app, initialize_camera_manager
initialize_camera_manager()
print('✓ 后端代码测试通过')
"

# 4. 准备打包资源
echo ""
echo "[4/4] 准备打包资源..."

# 创建资源目录
mkdir -p view/resources/backend

# 复制模型文件
cp jar_classifier.pth view/resources/ 2>/dev/null || echo "警告: 模型文件不存在"

# 复制测试图片
cp -r images view/resources/ 2>/dev/null || echo "警告: images 目录不存在"

echo ""
echo "========== WSL 准备完成 =========="
echo ""
echo "⚠️  重要提示："
echo "   WSL 中无法生成 Windows EXE"
echo "   请将项目复制到 Windows 环境后执行："
echo ""
echo "   1. 复制整个项目到 Windows (如 C:\\shibie)"
echo "   2. 在 Windows PowerShell 中执行："
echo "      cd C:\\shibie"
echo "      .\\build.ps1"
echo ""
echo "或者使用 WSL 访问 Windows 文件系统："
echo "   cp -r . /mnt/c/Users/<用户名>/Desktop/shibie"
