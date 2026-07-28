#!/bin/bash
# ==========================================
#  企业AI智能工作台 - 一键启动脚本
#  启动后端 (port 8000) + 前端 (port 5173)
# ==========================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "========================================="
echo "  企业AI智能工作台 v1.0.0"
echo "========================================="

# ---- 清理旧进程 ----
echo "🧹 清理旧进程..."
lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# ---- 启动后端 ----
echo "🚀 启动后端服务 (port 8000)..."
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
    echo "   📦 创建虚拟环境..."
    /Users/jiayiren/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi

# 检查数据库是否存在，不存在则初始化
if [ ! -f "storage/app.db" ]; then
    echo "   🗄️  初始化数据库..."
    python seed_data.py 2>/dev/null
fi

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning &
BACKEND_PID=$!
echo "   ✅ 后端 PID: $BACKEND_PID"

# ---- 启动前端 ----
echo "🎨 启动前端服务 (port 5173)..."
cd "$FRONTEND_DIR"
/Users/jiayiren/.workbuddy/binaries/node/versions/22.12.0/bin/npx vite --host --logLevel error &
FRONTEND_PID=$!
echo "   ✅ 前端 PID: $FRONTEND_PID"

sleep 3

echo ""
echo "========================================="
echo "  ✅ 启动完成！"
echo ""
echo "  🌐 前端: http://localhost:5173"
echo "  🔧 API:  http://localhost:8000/docs"
echo ""
echo "  测试账号:"
echo "  admin / admin123 (超级管理员)"
echo "  writer_zhang / writer123 (编剧部成员)"
echo ""
echo "  按 Ctrl+C 停止所有服务"
echo "========================================="

# ---- Trap: 退出时清理 ----
cleanup() {
    echo ""
    echo "🛑 停止服务..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    echo "  已停止"
}
trap cleanup EXIT

# ---- 保持运行 ----
wait
