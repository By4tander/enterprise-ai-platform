import { useState, useMemo } from 'react'
import { api } from '../services/api'

interface Skill {
  id: string
  skill_name: string
  category?: string
  source?: string
  description?: string
}

/**
 * 从历史消息中提取项目使用过的技能名
 * 匹配用户消息中的 @skill_name 标签
 */
export function extractHistorySkills(messages: { sender_type: string; content: string }[]): Skill[] {
  const skillSet = new Map<string, Skill>()
  const tagRegex = /@([\w\-]+)/g

  for (const msg of messages) {
    if (msg.sender_type !== 'user') continue
    let match
    while ((match = tagRegex.exec(msg.content)) !== null) {
      const name = match[1]
      // Skip common non-skill mentions like @all, @here etc.
      if (['all', 'here', 'channel'].includes(name)) continue
      if (!skillSet.has(name)) {
        skillSet.set(name, {
          id: `history-${name}`,
          skill_name: name,
          source: 'history',
        })
      }
    }
  }
  return Array.from(skillSet.values())
}

export function useProjectSkills() {
  const [showSkillSearch, setShowSkillSearch] = useState(false)
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
  const [skillSearchResults, setSkillSearchResults] = useState<any[]>([])

  const handleSkillSearch = async (q: string) => {
    setSkillSearchQuery(q)
    if (q.length < 1) { setSkillSearchResults([]); return }
    try { setSkillSearchResults(await api.searchSkills(q)) }
    catch { setSkillSearchResults([]) }
  }

  return {
    showSkillSearch,
    setShowSkillSearch,
    skillSearchQuery,
    setSkillSearchQuery,
    skillSearchResults,
    handleSkillSearch,
  }
}

export function skillSourceColor(source: string) {
  switch (source) {
    case 'import_zip':
    case 'import':
      return 'border-emerald-500/60 bg-emerald-950/30 text-emerald-300'
    case 'distillation':
      return 'border-purple-500/60 bg-purple-950/30 text-purple-300'
    case 'hermes':
    case 'native':
    case 'hermes_native':
      return 'border-indigo-500/60 bg-indigo-950/30 text-indigo-300'
    case 'global':
      return 'border-amber-500/60 bg-amber-950/30 text-amber-300'
    case 'department':
      return 'border-blue-500/60 bg-blue-950/30 text-blue-300'
    case 'history':
      return 'border-gray-500/60 bg-gray-800/30 text-gray-300'
    default:
      return 'border-blue-500/60 bg-blue-950/30 text-blue-300'
  }
}
