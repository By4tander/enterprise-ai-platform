import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const getStored = (): Theme => {
  try {
    const stored = localStorage.getItem('app-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  return 'dark'
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: getStored(),
  toggle: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('app-theme', next)
      return { theme: next }
    }),
  setTheme: (t) => {
    localStorage.setItem('app-theme', t)
    set({ theme: t })
  },
}))
