#!/bin/bash
# 后端启动脚本
# 用法: bash run.sh

echo "========================================="
echo "  企业AI智能工作台 - 后端服务启动"
echo "========================================="

# 进入脚本所在目录
cd "$(dirname "$0")"

# 检查虚拟环境
if [ ! -d "venv" ]; then
    echo "📦 创建虚拟环境..."
    /Users/jiayiren/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m venv venv
fi

# 激活并安装依赖
echo "📥 安装依赖..."
source venv/bin/activate
pip install -r requirements.txt -q

# 初始化数据库
echo "🗄️  初始化数据库..."
python seed_data.py

# 启动服务
echo ""
echo "🚀 启动 FastAPI 服务 (http://localhost:8000)..."
echo "   API 文档: http://localhost:8000/docs"
echo "   健康检查: http://localhost:8000/api/health"
echo ""
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
