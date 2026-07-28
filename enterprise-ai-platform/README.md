# 智影 · Agent 工作平台

> Enterprise-grade AI Agent collaboration platform powered by Hermes CLI

**智影·Agent工作平台** 是一个企业级 AI Agent 协作管理平台，通过 Web 前端套壳 [Hermes CLI](https://github.com/nicepkg/hermes-agent)（基于 DeepSeek v4-pro 的 AI Agent），为团队提供可视化的多项目并行对话、技能管理、文件产出追踪和部门协作能力。

---

## 核心目标

| 目标 | 说明 |
|------|------|
| **降低 AI Agent 使用门槛** | 将终端 CLI 体验转化为直观的 Web 界面，让非技术人员也能高效使用 AI Agent |
| **多项目并行管理** | 每个项目拥有独立的 Agent 实例、对话历史和技能配置，互不串扰 |
| **技能资产沉淀** | 部门级技能导入/导出/蒸馏，跨项目复用经验 |
| **产出物智能追踪** | 自动检测 Agent 生成的文件（xlsx/docx/py 等），实时展示在侧边栏 |

---

## 功能特性

### 对话系统
- **SSE 流式对话** — 实时显示 Agent 的思考链（Chain of Thought）和输出内容
- **Markdown 完整渲染** — 表格、代码块（语法高亮）、任务列表、删除线等 GFM 语法
- **分区复制** — 代码块、表格、全文各自悬浮复制按钮，一键复制精准内容
- **附件上传** — 支持 40+ 种文件格式（docx/pdf/xlsx/rtf/zip/py 等），拖拽或点击上传
- **暂停/恢复** — 长对话可随时中断 Agent 推理

### 项目管理
- **多项目隔离** — 每个项目独立沙盒目录、独立消息历史、独立技能配置
- **项目重命名** — 修改项目名称不影响内部文件夹路径
- **对话归档** — 完成的项目可归档并自动蒸馏为可复用技能
- **项目文件浏览器** — 树形/图标双视图，Finder 风格导航，双击文件夹进入子层级

### 技能系统
- **Hermes 原生技能** — 78+ 内置技能（computer-use/github/creative 等），Agent 自主调用
- **部门技能** — 部门沉淀/导入的技能，手动激活后带光晕效果
- **项目技能栏** — 输入框上方显示当前项目激活的技能，颜色区分来源（导入/蒸馏/原生）
- **全局搜索** — 搜索名称+描述，支持模糊匹配，一键添加到项目技能
- **技能导入** — 支持粘贴（JSON/YAML/MD）、上传文件、ZIP 技能包三种导入模式
- **右键定位** — 右键技能可直接在访达中打开对应文件夹

### UI/UX
- **明暗主题** — 一键切换暗色（Navy Blue）/ 明亮（白色）主题，偏好自动持久化
- **可调整面板** — 左侧栏、右侧栏、底部输入区均可拖拽调整大小
- **左侧栏收起** — 点击按钮收起/展开左侧项目栏
- **全局拖放** — 拖文件到页面任意位置自动识别为附件
- **跨项目状态隔离** — 切换项目时自动重置技能激活、SSE 流、Hermes 状态等全部 UI 状态

### 产出物追踪
- **对话后沙盒扫描** — 对话完成后自动对比沙盒快照，新文件自动入库为产出物
- **Hermes 标记（Plan A）** — Agent 主动标记产出物，提供更精确的标题/描述
- **文件服务** — 左键在浏览器中打开/下载，右键在访达中定位
- **历史扫描** — `POST /api/artifacts/scan/{id}` 一次性补录已有项目文件

---

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React)                   │
│  Vite + TypeScript + Tailwind CSS + React Router    │
│  SSE streaming · Markdown · Resizable panels       │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP/SSE (Vite proxy)
                       ▼
┌─────────────────────────────────────────────────────┐
│              Backend (FastAPI + Python)              │
│  SQLAlchemy (SQLite) · JWT Auth · CORS              │
│  Session Isolation Engine · Artifact Extractor      │
└──────────────────────┬──────────────────────────────┘
                       │ subprocess (NDJSON stdout)
                       ▼
┌─────────────────────────────────────────────────────┐
│          hermes_stream_bridge.py (Python 3.11)      │
│  PYTHONUNBUFFERED=1 · Proxy bypass                  │
│  Hermes AIAgent module direct call                  │
│  stream_delta_callback → NDJSON line by line        │
└──────────────────────┬──────────────────────────────┘
                       │ DeepSeek v4-pro API
                       ▼
┌─────────────────────────────────────────────────────┐
│              Hermes Agent (DeepSeek v4-pro)         │
│  78+ native skills · Tool use · Self-management     │
└─────────────────────────────────────────────────────┘
```

---

## 快速开始

### 前置要求

- **Node.js** >= 18
- **Python** >= 3.10
- **Hermes CLI** 已安装（`hermes` 命令可用）
- **DeepSeek API Key**（通过 Hermes 配置）

### 1. 克隆仓库

```bash
git clone https://github.com/By4tander/enterprise-ai-platform.git
cd enterprise-ai-platform
```

### 2. 启动后端

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 启动后端服务（默认 8000 端口）
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3. 启动前端

```bash
cd frontend
npm install
npx vite --host 0.0.0.0 --port 5173
```

### 4. 访问

- **本机**：http://localhost:5173
- **局域网**：http://<your-ip>:5173
- **默认账号**：`admin` / `admin123`

---

## 项目结构

```
enterprise-ai-platform/
├── backend/
│   ├── app/
│   │   ├── api/              # REST API 路由
│   │   │   ├── auth.py       # 登录/JWT 认证
│   │   │   ├── chat.py       # SSE 流式对话
│   │   │   ├── projects.py   # 项目 CRUD + 归档
│   │   │   ├── departments.py# 部门管理
│   │   │   ├── skills.py     # 技能导入/搜索/同步
│   │   │   ├── artifacts.py  # 产出物管理 + 沙盒扫描
│   │   │   ├── files.py      # 文件上传 + 项目文件树
│   │   │   └── messages.py   # 消息历史
│   │   ├── models/           # SQLAlchemy ORM 模型
│   │   ├── schemas/          # Pydantic 请求/响应模型
│   │   ├── services/         # 核心业务逻辑
│   │   │   ├── hermes_bridge.py      # Hermes CLI 桥接
│   │   │   ├── session_isolation.py  # 项目沙盒隔离
│   │   │   ├── artifact_extractor.py # 产出物自动提取
│   │   │   ├── context_assembler.py  # 上下文组装
│   │   │   └── distillation.py       # 技能蒸馏
│   │   ├── middleware/       # JWT 认证中间件
│   │   └── core/             # 并发控制
│   ├── hermes_stream_bridge.py  # Hermes 流式桥接脚本
│   ├── requirements.txt
│   └── seed_data.py          # 初始化数据
├── frontend/
│   ├── src/
│   │   ├── pages/            # 页面组件
│   │   │   ├── ProjectView.tsx    # 项目对话主界面
│   │   │   ├── Dashboard.tsx      # 仪表盘
│   │   │   ├── SkillsHub.tsx      # 技能中心
│   │   │   └── Login.tsx          # 登录页
│   │   ├── components/       # 通用组件
│   │   │   ├── chat/         # 对话输入框
│   │   │   ├── layout/       # Header/Sidebar/MainLayout
│   │   │   ├── skills/       # 技能导入弹窗
│   │   │   └── ...
│   │   ├── services/api.ts   # API 客户端 + SSE 解析
│   │   ├── store/            # Zustand 状态管理
│   │   └── hooks/            # 自定义 Hooks
│   ├── tailwind.config.js
│   └── vite.config.ts
└── start.sh                  # 一键启动脚本
```

---

## 关键技术点

### SSE 流式对话
- 后端通过 `hermes_stream_bridge.py` 直接调用 Hermes Python 模块（绕过 `-z` 的 stdout 重定向）
- `PYTHONUNBUFFERED=1` + 移除 HTTP 代理变量确保子进程直连 DeepSeek API
- 小 chunk 读取（64 字节）+ 二进制缓冲区按 `\n` 拆分，避免 UTF-8 多字节字符截断
- SSE 响应添加 `X-Accel-Buffering: no` + `Cache-Control: no-cache` 防止代理缓存

### 项目沙盒隔离
- `SessionIsolationEngine` 为每个项目创建独立沙盒目录
- 文件上传、Agent 产出物均在项目沙盒内
- 对话前后沙盒快照对比（mtime）自动发现新文件

### 明暗主题
- 暗色模式：Tailwind 原生 `bg-gray-900` 等类名
- 明亮模式：`.light` CSS 精确覆盖所有容器/文字/边框/滚动条
- `zustand` store + `localStorage` 持久化主题选择

---

## License

MIT

---

**智影·Agent工作平台** — 让 AI Agent 真正融入团队工作流
