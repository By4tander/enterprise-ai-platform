import { useState } from 'react'
import { Sparkles, Mic, Scissors, ClipboardCheck, Tags, Wand2, ArrowLeftRight, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

interface SubTool {
  id: string
  name: string
  description: string
  url?: string
  status: 'available' | 'coming-soon'
}

interface ToolCategory {
  id: string
  name: string
  subtitle: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  gradient: string
  status: 'available' | 'coming-soon'
  features: string[]
  subTools: SubTool[]
}

const categories: ToolCategory[] = [
  {
    id: 'tts',
    name: 'TTS',
    subtitle: '文字转语音',
    description: '将文本转化为自然流畅的语音输出，支持多种音色和语速调节，适用于配音、有声书、播客等场景。',
    icon: Mic,
    gradient: 'from-blue-500 to-cyan-500',
    status: 'available',
    features: ['多音色选择', '语速调节', '批量转换', 'MP3/WAV 导出'],
    subTools: [
      { id: 'tts-tencent', name: '腾讯云 TTS', description: '腾讯云语音合成服务，支持多种音色与语速调节', status: 'coming-soon' },
      { id: 'tts-edge', name: 'Edge TTS', description: '微软 Edge 浏览器内置免费 TTS 引擎', status: 'coming-soon' },
    ],
  },
  {
    id: 'ai-review',
    name: 'AI 审核',
    subtitle: '智能内容审核',
    description: 'AI 自动审核文本、图片、视频内容，识别违规信息、敏感词、低质内容，支持自定义审核规则。',
    icon: ClipboardCheck,
    gradient: 'from-green-500 to-emerald-500',
    status: 'available',
    features: ['多维审核', '自定义规则', '批量处理', '审核报告'],
    subTools: [
      { id: 'review-text', name: '文本审核', description: 'AI 智能识别文本中的违规、敏感、低质内容', status: 'coming-soon' },
      { id: 'review-media', name: '图片视频审核', description: '多模态内容安全审核，覆盖涉黄、涉暴、涉政等场景', status: 'coming-soon' },
    ],
  },
  {
    id: 'ai-classify',
    name: 'AI 分类',
    subtitle: '智能内容分类',
    description: '基于深度学习的自动分类引擎，支持文本、图片、视频多模态分类，自定义分类体系。',
    icon: Tags,
    gradient: 'from-violet-500 to-purple-500',
    status: 'available',
    features: ['多模态分类', '自定义标签', '批量标注', '置信度评估'],
    subTools: [
      { id: 'classify-text', name: '文本分类', description: '基于 NLP 的自动文本分类与标签标注', status: 'coming-soon' },
      { id: 'classify-media', name: '媒体分类', description: '图片与视频内容智能归类引擎', status: 'coming-soon' },
    ],
  },
  {
    id: 'ai-smart-image',
    name: 'AI 智图',
    subtitle: '智能图像处理',
    description: 'AI 驱动的智能图像处理工具，支持智能抠图、画质增强、风格迁移、批量处理等功能。',
    icon: Wand2,
    gradient: 'from-orange-500 to-red-500',
    status: 'available',
    features: ['智能抠图', '画质增强', '风格迁移', '批量处理'],
    subTools: [
      { id: 'img-remove-bg', name: '智能抠图', description: '一键移除图片背景，支持人像、商品等多种场景', status: 'coming-soon' },
      { id: 'img-enhance', name: '画质增强', description: 'AI 超分辨率重建，低清图片秒变高清', status: 'coming-soon' },
    ],
  },
  {
    id: 'ai-transcode',
    name: 'AI 转码',
    subtitle: '智能媒体转码',
    description: 'AI 辅助的高效媒体转码工具，智能选择最优编码参数，支持多格式互转、压缩优化和水印添加。',
    icon: ArrowLeftRight,
    gradient: 'from-rose-500 to-pink-500',
    status: 'available',
    features: ['多格式互转', '智能压缩', '水印添加', '批量转码'],
    subTools: [
      { id: 'transcode-video', name: '视频转码', description: 'AI 智能选择编码参数，多格式高效互转', status: 'coming-soon' },
      { id: 'transcode-audio', name: '音频转码', description: '批量音频格式转换，保持最佳音质', status: 'coming-soon' },
    ],
  },
  {
    id: 'ai-clip',
    name: 'AI 剪辑',
    subtitle: '智能视频剪辑',
    description: 'AI 驱动的智能视频剪辑工具，自动识别关键片段、智能裁剪、添加字幕和转场效果。',
    icon: Scissors,
    gradient: 'from-purple-500 to-pink-500',
    status: 'available',
    features: ['智能剪裁', '自动字幕', '转场特效', '多格式导出'],
    subTools: [
      { id: 'clip-auto', name: '智能剪辑', description: 'AI 自动识别关键片段，一键生成精选视频', status: 'coming-soon' },
      { id: 'clip-subtitle', name: '自动字幕', description: '语音识别自动生成字幕，支持多语言', status: 'coming-soon' },
    ],
  },
]

export default function AIToolsPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Sparkles className="w-5 h-5 text-white drop-shadow-sm" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">AI 工具平台</h1>
              <p className="text-sm text-gray-500 mt-0.5">选择工具类别，展开后进入具体平台</p>
            </div>
          </div>
        </div>

        {/* Category List */}
        <div className="space-y-4">
          {categories.map((cat) => {
            const isExpanded = expandedId === cat.id
            return (
              <div key={cat.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden transition-all duration-300">
                {/* Category Header */}
                <div
                  className="flex items-center p-5 cursor-pointer hover:bg-gray-800/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                >
                  {/* Icon */}
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${cat.gradient} flex items-center justify-center shadow-lg shrink-0 mr-4`}>
                    <cat.icon className="w-5 h-5 text-white drop-shadow-sm" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-base font-semibold text-white">{cat.name}</h3>
                      <span className="text-xs text-gray-500">{cat.subtitle}</span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-1">{cat.description}</p>
                  </div>

                  {/* Feature Mini Tags */}
                  <div className="hidden sm:flex items-center gap-1.5 mr-4">
                    {cat.features.slice(0, 3).map((f) => (
                      <span key={f} className="px-2 py-0.5 rounded text-[10px] bg-gray-800 text-gray-500 border border-gray-700/50">
                        {f}
                      </span>
                    ))}
                  </div>

                  {/* Expand Arrow */}
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${isExpanded ? 'bg-gray-700 rotate-180' : 'bg-gray-800/50'}`}>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </div>
                </div>

                {/* Expanded Sub-tools */}
                {isExpanded && (
                  <div className="border-t border-gray-800 bg-gray-900/50">
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="h-px flex-1 bg-gray-800" />
                        <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wider">{cat.subTools.length} 个可用平台</span>
                        <div className="h-px flex-1 bg-gray-800" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cat.subTools.map((st) => (
                          <div
                            key={st.id}
                            className={`group flex items-start gap-3 p-3 rounded-lg border transition-all duration-200 ${
                              st.status === 'available'
                                ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500/30 hover:bg-gray-800 cursor-pointer'
                                : 'bg-gray-800/20 border-gray-800 cursor-not-allowed opacity-60'
                            }`}
                            onClick={() => {
                              if (st.status !== 'available') return
                              // TODO: open sub-tool workspace
                            }}
                          >
                            <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center shrink-0 group-hover:bg-gray-600 transition-colors">
                              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium text-gray-200">{st.name}</span>
                                {st.status === 'coming-soon' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400 font-medium">即将开放</span>
                                )}
                                {st.status === 'available' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-500/10 text-green-400 font-medium">可用</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">{st.description}</p>
                            </div>
                            <div className="shrink-0 flex items-center mt-1">
                              <ChevronRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Future tools placeholder */}
        <div className="mt-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-gray-800" />
            <span className="text-xs text-gray-600 font-medium">更多工具即将上线</span>
            <div className="h-px flex-1 bg-gray-800" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['语音识别', '图片生成', '文档翻译'].map((p) => (
              <div key={p} className="bg-gray-900/50 border border-dashed border-gray-800 rounded-xl p-5 text-center">
                <div className="w-10 h-10 rounded-lg bg-gray-800 mx-auto mb-3 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-gray-600" />
                </div>
                <p className="text-sm text-gray-500 font-medium">{p}</p>
                <p className="text-xs text-gray-600 mt-1">敬请期待</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
