#!/bin/bash
# 后端测试脚本

echo "=== 清理旧进程 ==="
pkill -9 -f "python.*backend" 2>/dev/null
sleep 1

echo "=== 启动后端 ==="
cd /home/zzx/Document/shibie
source .venv/bin/activate
python -m backend.server > /tmp/backend_full_test.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

echo "=== 等待后端启动 ==="
sleep 5

echo ""
echo "=== 测试 /api/health ==="
curl -s http://127.0.0.1:5000/api/health | python3 -m json.tool

echo ""
echo "=== 测试 /api/cameras ==="
curl -s http://127.0.0.1:5000/api/cameras | python3 -m json.tool

echo ""
echo "=== 启动系统 ==="
curl -s -X POST http://127.0.0.1:5000/api/start | python3 -m json.tool

echo ""
echo "=== 等待检测运行 ==="
sleep 4

echo ""
echo "=== 获取系统状态 ==="
curl -s http://127.0.0.1:5000/api/status | python3 -m json.tool | head -80

echo ""
echo "=== 测试获取帧图片 ==="
curl -s http://127.0.0.1:5000/api/frame/1 -o /tmp/test_frame.jpg
ls -lh /tmp/test_frame.jpg
file /tmp/test_frame.jpg

echo ""
echo "=== 获取检测结果 ==="
curl -s http://127.0.0.1:5000/api/result/1 | python3 -m json.tool

echo ""
echo "=== 停止系统 ==="
curl -s -X POST http://127.0.0.1:5000/api/stop | python3 -m json.tool

echo ""
echo "=== 后端日志（最后 30 行）==="
tail -30 /tmp/backend_full_test.log

echo ""
echo "=== 清理 ==="
kill $BACKEND_PID 2>/dev/null
sleep 1
echo "测试完成"
