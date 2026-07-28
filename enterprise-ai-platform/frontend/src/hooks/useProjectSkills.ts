import { useState, useEffect } from 'react'
import { api } from '../services/api'

interface Skill {
  id: string
  skill_name: string
  category?: string
  source?: string
  description?: string
}

export function useProjectSkills(projectId?: string) {
  const [projectSkills, setProjectSkills] = useState<Skill[]>([])
  const [showSkillSearch, setShowSkillSearch] = useState(false)
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
  const [skillSearchResults, setSkillSearchResults] = useState<any[]>([])

  // Load skills from localStorage on project switch
  useEffect(() => {
    if (!projectId) return
    try {
      const saved = localStorage.getItem(`project-skills-${projectId}`)
      if (saved) setProjectSkills(JSON.parse(saved))
      else setProjectSkills([])
    } catch { setProjectSkills([]) }
  }, [projectId])

  // Save skills to localStorage
  useEffect(() => {
    if (!projectId) return
    localStorage.setItem(`project-skills-${projectId}`, JSON.stringify(projectSkills))
  }, [projectSkills, projectId])

  const handleSkillSearch = async (q: string) => {
    setSkillSearchQuery(q)
    if (q.length < 1) { setSkillSearchResults([]); return }
    try { setSkillSearchResults(await api.searchSkills(q)) }
    catch { setSkillSearchResults([]) }
  }

  const addSkillToProject = (skill: any) => {
    const exists = projectSkills.find(
      (s: Skill) => s.id === skill.id || s.skill_name === skill.skill_name
    )
    if (!exists) {
      const newSkill: Skill = {
        id: skill.id,
        skill_name: skill.skill_name,
        category: skill.category || 'custom',
        source: skill.source || 'manual',
        description: skill.description || '',
      }
      setProjectSkills((prev: Skill[]) => [...prev, newSkill])
    }
    setShowSkillSearch(false)
    setSkillSearchQuery('')
  }

  const removeSkillFromProject = (skillId: string) => {
    setProjectSkills((prev: Skill[]) => prev.filter((s: Skill) => s.id !== skillId))
  }

  return {
    projectSkills,
    showSkillSearch,
    setShowSkillSearch,
    skillSearchQuery,
    skillSearchResults,
    handleSkillSearch,
    addSkillToProject,
    removeSkillFromProject,
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
      return 'border-indigo-500/60 bg-indigo-950/30 text-indigo-300'
    default:
      return 'border-blue-500/60 bg-blue-950/30 text-blue-300'
  }
}
