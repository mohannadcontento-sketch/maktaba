import { create } from 'zustand'
import type { Lang } from '@/i18n'

export type PageName = 'library' | 'stats' | 'settings' | 'reader'
export type ThemeMode = 'light' | 'dark' | 'system'
export type ReaderThemeName =
  | 'day'
  | 'sepia'
  | 'night'
  | 'paper'
  | 'green'
  | 'rose'
  | 'amber'
  | 'slate'
export type FlowMode = 'paginated' | 'scrolled'

interface Toast {
  id: string
  message: string
  kind: 'info' | 'success' | 'error'
}

interface UiState {
  page: PageName
  themeMode: ThemeMode
  resolvedDark: boolean
  lang: Lang
  sidebarOpen: boolean
  activeCollectionId: number | null
  activeTagId: number | null
  filterStatus: 'all' | 'reading' | 'unread' | 'finished' | 'favorite'
  searchQuery: string
  toasts: Toast[]
  dropOverlay: boolean
  // نافذة "ما الجديد في النسخة 2"
  whatsNewOpen: boolean

  setPage(p: PageName): void
  setThemeMode(m: ThemeMode): void
  setResolvedDark(dark: boolean): void
  setLang(l: Lang): void
  toggleSidebar(): void
  setFilterStatus(f: UiState['filterStatus']): void
  setSearchQuery(q: string): void
  setActiveCollection(id: number | null): void
  setActiveTag(id: number | null): void
  setDropOverlay(b: boolean): void
  toast(message: string, kind?: Toast['kind']): void
  dismissToast(id: string): void
  setWhatsNewOpen(b: boolean): void
}

function applyTheme(mode: ThemeMode): boolean {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.body.style.backgroundColor = dark ? '#0f1115' : '#f4f5f7'
  return dark
}

let toastSeq = 0

export const useUi = create<UiState>((set, get) => ({
  page: 'library',
  themeMode: 'system',
  resolvedDark: false,
  lang: 'ar',
  sidebarOpen: true,
  activeCollectionId: null,
  activeTagId: null,
  filterStatus: 'all',
  searchQuery: '',
  toasts: [],
  dropOverlay: false,
  whatsNewOpen: false,

  setPage: (page) => set({ page }),
  setThemeMode: (mode) => {
    const dark = applyTheme(mode)
    set({ themeMode: mode, resolvedDark: dark })
  },
  setResolvedDark: (dark) => set({ resolvedDark: dark }),
  setLang: (lang) => set({ lang }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setFilterStatus: (filterStatus) => set({ filterStatus, activeCollectionId: null, activeTagId: null }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setActiveCollection: (activeCollectionId) =>
    set({ activeCollectionId, activeTagId: null, filterStatus: 'all' }),
  setActiveTag: (activeTagId) => set({ activeTagId, activeCollectionId: null, filterStatus: 'all' }),
  setDropOverlay: (dropOverlay) => set({ dropOverlay }),

  toast: (message, kind = 'info') => {
    const id = `t${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => get().dismissToast(id), 3200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setWhatsNewOpen: (whatsNewOpen) => set({ whatsNewOpen })
}))
