# AI工具平台页面实现计划

## 设计概述

在侧边栏新增"AI工具平台"导航项，点击后进入独立页面 `/ai-tools`，展示 TTS 和 AI剪辑 两个工具卡片。未来可扩展更多 AI 工具。

## UI 设计方案

### 页面布局
```
┌─────────────────────────────────────────────┐
│  🤖 AI 工具平台                              │
│  探索强大的 AI 工具，提升创作效率               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────┐  ┌─────────────┐          │
│  │  🔊 TTS     │  │  ✂️ AI剪辑   │          │
│  │             │  │             │          │
│  │  文字转语音  │  │  智能视频    │          │
│  │  工具       │  │  剪辑工具    │          │
│  │             │  │             │          │
│  │  [即将上线]  │  │  [即将上线]  │          │
│  └─────────────┘  └─────────────┘          │
│                                             │
└─────────────────────────────────────────────┘
```

### 卡片设计规范
- 背景: `bg-gray-900` + `border border-gray-800`
- 悬停: `hover:border-gray-700` + `hover:shadow-lg`
- 圆角: `rounded-xl`
- 图标: 彩色渐变背景圆 + lucide-react 图标
- 标题: `text-lg font-semibold text-white`
- 描述: `text-sm text-gray-400`
- 状态徽章: `bg-amber-500/10 text-amber-400` (即将上线)
- 卡片高度: 固定最小高度，保持对齐

### 颜色方案
- TTS 卡片图标: 蓝色渐变 (`from-blue-500 to-cyan-500`)
- AI剪辑卡片图标: 紫色渐变 (`from-purple-500 to-pink-500`)

## 实现任务

### Task 1: 创建 AIToolsPage 组件
- 文件: `frontend/src/pages/AIToolsPage.tsx`
- 包含页面头部、工具卡片网格
- 使用 Dashboard 相同的设计语言

### Task 2: 更新路由配置
- 文件: `frontend/src/App.tsx`
- 导入 AIToolsPage
- 添加路由: `<Route path="ai-tools" element={<AIToolsPage />} />`

### Task 3: 更新侧边栏导航
- 文件: `frontend/src/components/layout/Sidebar.tsx`
- 在 navItems 数组中添加: `{ icon: Bot, label: 'AI工具平台', path: '/ai-tools' }`
- 使用 lucide-react 的 Bot 图标

## 验证标准
1. 侧边栏显示"AI工具平台"导航项
2. 点击后页面正确渲染
3. TTS 和 AI剪辑卡片正确显示
4. 卡片悬停效果正常
5. 与现有 UI 风格一致
