# 智影 · Agent 工作平台

> **The Enterprise AI Agent Collaboration Platform**  
> 从个人辅助工具到团队生产级 AI 工作流的范式跃迁

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Enterprise%20Grade-4f46e5?style=for-the-badge&labelColor=1e1b4b" />
  <img src="https://img.shields.io/badge/Architecture-Multi--Agent-7c3aed?style=for-the-badge&labelColor=2e1065" />
  <img src="https://img.shields.io/badge/Status-Active%20Development-10b981?style=for-the-badge&labelColor=064e3b" />
</p>

---

## 为什么需要智影？

当 ChatGPT、Claude、Copilot 这类工具让个人效率提升 10 倍时，一个根本性问题被忽略了：**AI 如何真正进入团队的生产流水线？**

现有的 AI 助手产品有一个共同的局限——它们是为**个人**设计的。一个设计师用 Claude 画图，一个程序员用 Copilot 写代码，一个产品经理用 ChatGPT 写文档。每个人都在自己的窗口里单打独斗，AI 的产出停留在对话框里，无法流转到下一个人的手中。

**智影要解决的不是"让个人更方便"，而是让 AI Agent 成为团队中可协作、可管理、可沉淀的数字员工。**

---

## 核心理念

<table>
<tr>
<td width="50%" valign="top">

### 传统 AI 助手
- 个人对话窗口，单打独斗
- 对话结束即丢失，经验无法复用
- 技能由平台方定义，用户无法定制
- 产出停留在对话框中，无法流转
- 无部门协作，无权限管理
- 一个模型绑定一个产品

</td>
<td width="50%" valign="top">

### 智影 · Agent 工作平台
- **多项目并行**，每个项目独立 Agent 实例
- **技能资产沉淀**，部门经验跨项目复用
- **自定义技能**，导入/蒸馏/创建，团队共建
- **产出物自动追踪**，文件实时归档可管理
- **部门级协作**，角色权限 + 技能隔离
- **模型无关架构**，适配任意 LLM 后端

</td>
</tr>
</table>

---

## 平台能力

### 🔹 多 Agent 并行工作区

每个项目是一个独立的 Agent 工作空间——独立的对话上下文、独立的文件沙盒、独立的技能配置。一个团队可以同时运行数十个项目，Agent 之间互不干扰。

项目完成后，对话归档、产出物沉淀、经验自动蒸馏为可复用技能，流入下一个项目。

### 🔹 三级技能体系

```
┌─────────────────────────────────────────────┐
│            全局原生技能 (Agent Built-in)      │  ← Agent 自主调用
│         终端操作 / 文件系统 / API 调用 / ...   │
├─────────────────────────────────────────────┤
│            部门技能 (Department Skills)       │  ← 部门资产，跨项目共享
│         配音脚本 / 风格分析 / 数据处理 / ...   │
├─────────────────────────────────────────────┤
│            项目技能 (Project Skills)          │  ← 当前项目专用
│         导入的 / 蒸馏的 / 自定义的            │
└─────────────────────────────────────────────┘
```

技能不是黑盒。每个技能本质是一份结构化文档，团队成员可以导入、编辑、导出、分享。AI Agent 按需调用，调用过程透明可追溯。

### 🔹 产出物智能管理

Agent 生成的文件（Excel、代码、文档、图片等）自动归档到项目的产出物面板。不是对话框里的文字片段，而是**真实的文件**——可以下载、可以打开、可以作为下一个任务的输入。

沙盒快照对比 + Agent 主动标记双重机制，确保不遗漏任何有价值的产出。

### 🔹 SSE 实时推理流

Agent 的思考过程不是黑箱。实时流式展示推理链（Chain of Thought）、工具调用、上下文消耗、耗时统计。团队可以观察 Agent 如何思考、如何决策，建立对 AI 工作过程的信任。

### 🔹 企业级协作架构

- **角色权限**：超级管理员 / 管理员 / 成员，部门级别的数据隔离
- **多部门管理**：每个部门独立的技能库、项目空间
- **局域网部署**：数据不出内网，满足企业安全合规要求
- **模型无关**：架构设计支持接入任意 LLM 后端，不绑定单一供应商

---

## 技术架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Web 前端 (React + TypeScript)              │
│   实时流式对话 · Markdown 渲染 · 文件浏览器 · 可调整面板       │
│   明暗主题 · 拖放交互 · 跨项目状态隔离                        │
└────────────────────────┬─────────────────────────────────────┘
                         │  SSE / REST API
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   后端服务 (FastAPI + Python)                  │
│   JWT 认证 · 部门权限 · 项目沙盒隔离 · 产出物自动检测           │
│   技能管理 · 消息持久化 · 文件服务                             │
└────────────────────────┬─────────────────────────────────────┘
                         │  流式子进程桥接
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   Agent 执行引擎 (可插拔)                      │
│   流式推理 · 工具调用 · 技能加载 · 上下文管理                   │
│   ← 支持多种 LLM 后端，模型无关架构                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.10
- AI Agent CLI 已安装并配置

### 安装与启动

```bash
# 1. 克隆仓库
git clone https://github.com/By4tander/enterprise-ai-platform.git
cd enterprise-ai-platform

# 2. 启动后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. 启动前端
cd ../frontend
npm install
npx vite --host 0.0.0.0 --port 5173
```

---

## 项目结构

```
enterprise-ai-platform/
├── backend/
│   ├── app/
│   │   ├── api/                  # REST API 路由层
│   │   │   ├── auth.py           #   认证与权限
│   │   │   ├── chat.py           #   SSE 流式对话
│   │   │   ├── projects.py       #   项目生命周期管理
│   │   │   ├── departments.py    #   部门与组织架构
│   │   │   ├── skills.py         #   技能导入/搜索/同步
│   │   │   ├── artifacts.py      #   产出物追踪与归档
│   │   │   ├── files.py          #   文件服务与项目文件树
│   │   │   └── messages.py       #   对话历史
│   │   ├── models/               # 数据模型 (ORM)
│   │   ├── schemas/              # 请求/响应契约 (Pydantic)
│   │   ├── services/             # 核心业务引擎
│   │   │   ├── hermes_bridge.py          # Agent 桥接层
│   │   │   ├── session_isolation.py      # 项目沙盒隔离
│   │   │   ├── artifact_extractor.py     # 产出物智能检测
│   │   │   ├── context_assembler.py      # 上下文组装器
│   │   │   └── distillation.py           # 技能蒸馏引擎
│   │   ├── middleware/           # 认证中间件
│   │   └── core/                 # 并发控制
│   ├── hermes_stream_bridge.py   # 流式推理桥接
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/                # 页面 (对话/仪表盘/技能中心)
│       ├── components/           # 组件 (输入框/布局/技能导入)
│       ├── services/             # API 客户端 + SSE 解析
│       ├── store/                # 状态管理 (Zustand)
│       └── hooks/                # 自定义 Hooks
└── start.sh
```

---

## Roadmap

- [x] 多项目并行 Agent 工作区
- [x] 三级技能体系（原生 / 部门 / 项目）
- [x] SSE 实时推理流 + 思考链展示
- [x] 产出物自动追踪与管理
- [x] 明暗主题 + 可调整面板
- [ ] 多模型适配层（OpenAI / Claude / 本地模型）
- [ ] Agent 协作编排（多 Agent 串联工作流）
- [ ] 实时多人协作（WebSocket 同步）
- [ ] 插件市场（社区技能共享）
- [ ] 企业 SSO 集成
- [ ] 私有化部署方案（Docker / K8s）

---

## License

Copyright (c) 2026 By4tander. All rights reserved.

本项目为专有软件，未经授权不得使用、修改或分发。详见 [LICENSE](./LICENSE)。

---

<p align="center">
  <strong>智影 · Agent 工作平台</strong><br/>
  <em>让 AI Agent 从个人助手进化为团队的数字员工</em>
</p>
