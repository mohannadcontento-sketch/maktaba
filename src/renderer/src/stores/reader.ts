import { create } from 'zustand'
import type { Annotation, Bookmark, Book } from '../../../shared/types'
import type { FlowMode, ReaderThemeName } from './ui'
import type { EpubSearchMatch } from '@/lib/epubSearch'

export interface ReaderSettings {
  theme: ReaderThemeName
  fontFamily: string
  fontSize: number
  lineHeight: number
  margin: number
  align: 'right' | 'left' | 'center' | 'justify'
  marginLeft: number
  marginRight: number
  marginTop: number
  marginBottom: number
  flow: FlowMode
}

/** الإعدادات الافتراضية — مصدر واحد يُستخدم للتهيئة ولزر إعادة الضبط */
export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'day',
  fontFamily: 'arabic-serif',
  fontSize: 100,
  lineHeight: 1.7,
  margin: 6,
  align: 'justify',
  marginLeft: 6,
  marginRight: 6,
  marginTop: 4,
  marginBottom: 4,
  flow: 'paginated'
}

export const READER_FONTS = [
  { id: 'arabic-serif', label: 'أميري (نسخ)' },
  { id: 'arabic-sans', label: 'كايرو' },
  { id: 'tajawal', label: 'تجوّل' },
  { id: 'naskh', label: 'نوتو نسخ' },
  { id: 'alexandria', label: 'الإسكندرية' },
  { id: 'bokra', label: 'ريم كوفي' },
  { id: 'tajawal-bold', label: 'تجوّل عريض' },
  { id: 'el-messiri', label: 'المنشوري' },
  { id: 'serif', label: 'Serif' },
  { id: 'sans', label: 'Sans' }
] as const

export const READER_ALIGNS = [
  { id: 'right', label: 'يمين' },
  { id: 'left', label: 'يسار' },
  { id: 'center', label: 'وسط' },
  { id: 'justify', label: 'تبرير' }
] as const

export const HIGHLIGHT_COLORS = ['#fbbf24', '#4ade80', '#60a5fa', '#f87171', '#c084fc'] as const

export interface SearchBox {
  l: number
  t: number
  w: number
  h: number
}

export interface SearchMatchInfo {
  page: number
  boxIndex: number
}

export interface SearchState {
  query: string
  matches: SearchMatchInfo[]
  boxes: SearchBox[]
  activeIndex: number
}

const emptySearch: SearchState = { query: '', matches: [], boxes: [], activeIndex: 0 }

interface SelectionInfo {
  text: string
  rect: { x: number; y: number; w: number; h: number }
  // PDF
  page?: number
  rects?: { l: number; t: number; w: number; h: number }[]
  // EPUB
  cfiRange?: string
  removeEpubSelection?: () => void
}

interface ReaderState {
  book: Book | null
  loadingBook: boolean
  annotations: Annotation[]
  bookmarks: Bookmark[]
  sessionId: number | null
  sessionSeconds: number
  pagesReadThisSession: number

  sidebarPanel: 'toc' | 'thumbs' | 'annotations' | 'bookmarks' | null
  searchOpen: boolean
  settingsOpen: boolean
  zenMode: boolean
  nightInvert: boolean
  selection: SelectionInfo | null
  noteEditorFor: Annotation | null
  search: SearchState
  // بحث EPUB (النسخة 2)
  epubQuery: string
  epubMatches: EpubSearchMatch[]
  epubMatchIndex: number
  epubSearching: boolean
  ttsPlaying: boolean

  open(book: Book): Promise<void>
  close(): void

  setSidebarPanel(p: ReaderState['sidebarPanel']): void
  toggleSearch(): void
  setSearchOpen(b: boolean): void
  setSettingsOpen(b: boolean): void
  setZen(b: boolean): void
  setNightInvert(b: boolean): void
  setSelection(s: SelectionInfo | null): void
  setNoteEditor(a: Annotation | null): void
  setSearchResults(query: string, matches: SearchMatchInfo[], boxes: SearchBox[]): void
  clearSearch(): void
  setSearchActive(i: number): void
  setEpubMatches(list: EpubSearchMatch[]): void
  setEpubSearching(b: boolean): void
  setTtsPlaying(b: boolean): void
  setEpubQuery(q: string): void
  setEpubMatchIndex(i: number): void
  gotoEpubMatch(i: number): void

  loadAnnotations(bookId: string): Promise<void>
  addAnnotation(a: Omit<Annotation, 'createdAt' | 'updatedAt'>): Promise<Annotation>
  updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void>
  deleteAnnotation(id: string): Promise<void>

  loadBookmarks(bookId: string): Promise<void>
  addBookmarkAt(location: string, page: number | null, excerpt: string | null, label: string): Promise<boolean>
  removeBookmarkById(id: string): Promise<void>

  startSession(): Promise<void>
  heartbeat(seconds: number, pagesRead: number): Promise<void>
  endSession(): Promise<void>

  saveProgress(progress: number, location: string | null, finished?: boolean): Promise<void>
}

export const useReader = create<ReaderState>((set, get) => ({
  book: null,
  loadingBook: false,
  annotations: [],
  bookmarks: [],
  sessionId: null,
  sessionSeconds: 0,
  pagesReadThisSession: 0,

  sidebarPanel: null,
  searchOpen: false,
  settingsOpen: false,
  zenMode: false,
  nightInvert: false,
  selection: null,
  noteEditorFor: null,
  search: emptySearch,
  epubQuery: '',
  epubMatches: [],
  epubMatchIndex: 0,
  epubSearching: false,
  ttsPlaying: false,

  open: async (book) => {
    set({
      loadingBook: true,
      book,
      annotations: [],
      bookmarks: [],
      sidebarPanel: null,
      searchOpen: false,
      settingsOpen: false,
      zenMode: false,
      nightInvert: false,
      selection: null,
      search: emptySearch,
      epubQuery: '',
      epubMatches: [],
      epubMatchIndex: 0,
      epubSearching: false,
      ttsPlaying: false
    })
    await Promise.all([get().loadAnnotations(book.id), get().loadBookmarks(book.id)])
    await get().startSession()
    set({ loadingBook: false })
  },

  close: () => {
    void get().endSession()
    set({
      book: null,
      annotations: [],
      bookmarks: [],
      sessionId: null,
      sessionSeconds: 0,
      pagesReadThisSession: 0,
      selection: null,
      noteEditorFor: null,
      searchOpen: false,
      settingsOpen: false,
      zenMode: false,
      search: emptySearch,
      epubQuery: '',
      epubMatches: [],
      epubMatchIndex: 0,
      epubSearching: false,
      ttsPlaying: false
    })
  },

  setSidebarPanel: (p) => set((s) => ({ sidebarPanel: s.sidebarPanel === p ? null : p })),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setSearchOpen: (b) => set({ searchOpen: b }),
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  setZen: (b) => set({ zenMode: b }),
  setNightInvert: (b) => set({ nightInvert: b }),
  setSelection: (s) => set({ selection: s }),
  setNoteEditor: (a) => set({ noteEditorFor: a }),
  setSearchResults: (query, matches, boxes) =>
    set({ search: { query, matches, boxes, activeIndex: matches.length ? 0 : -1 } }),
  clearSearch: () => set({ search: emptySearch }),
  setSearchActive: (i) => set((s) => ({ search: { ...s.search, activeIndex: i } })),
  setEpubMatches: (epubMatches) => set({ epubMatches, epubMatchIndex: 0 }),
  setEpubSearching: (epubSearching) => set({ epubSearching }),
  setTtsPlaying: (ttsPlaying) => set({ ttsPlaying }),
  setEpubQuery: (epubQuery) => set({ epubQuery, epubMatchIndex: 0 }),
  setEpubMatchIndex: (epubMatchIndex) => set({ epubMatchIndex }),
  gotoEpubMatch: (i) => {
    const list = get().epubMatches
    if (!list.length) return
    const idx = ((i % list.length) + list.length) % list.length
    set({ epubMatchIndex: idx })
    const m = list[idx]
    ;(window as unknown as { __epubSearchJump?: (m: EpubSearchMatch) => void }).__epubSearchJump?.(m)
  },

  loadAnnotations: async (bookId) => {
    const list = await window.api.listAnnotations(bookId)
    set({ annotations: list })
  },
  addAnnotation: async (a) => {
    const created = await window.api.addAnnotation(a)
    set((s) => ({ annotations: [created, ...s.annotations] }))
    return created
  },
  updateAnnotation: async (id, patch) => {
    await window.api.updateAnnotation(id, patch)
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a
      )
    }))
  },
  deleteAnnotation: async (id) => {
    await window.api.deleteAnnotation(id)
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id), noteEditorFor: null }))
  },

  loadBookmarks: async (bookId) => {
    const list = await window.api.listBookmarks(bookId)
    set({ bookmarks: list })
  },
  addBookmarkAt: async (location, page, excerpt, label) => {
    const book = get().book
    if (!book) return false
    const exists = get().bookmarks.find(
      (b) => b.location === location || (page != null && b.page === page && b.location.startsWith('p:'))
    )
    if (exists) return false
    const bm = await window.api.addBookmark({
      id: `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      bookId: book.id,
      label,
      location,
      page,
      excerpt
    })
    set((s) => ({ bookmarks: [bm, ...s.bookmarks] }))
    return true
  },
  removeBookmarkById: async (id) => {
    await window.api.deleteBookmark(id)
    set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }))
  },

  startSession: async () => {
    const book = get().book
    if (!book) return
    const sid = await window.api.startSession(book.id)
    set({ sessionId: sid, sessionSeconds: 0, pagesReadThisSession: 0 })
  },
  heartbeat: async (seconds, pagesRead) => {
    const sid = get().sessionId
    if (!sid) return
    set((s) => ({ sessionSeconds: s.sessionSeconds + seconds, pagesReadThisSession: Math.max(s.pagesReadThisSession, pagesRead) }))
    await window.api.sessionHeartbeat(sid, get().sessionSeconds, get().pagesReadThisSession)
  },
  endSession: async () => {
    const sid = get().sessionId
    if (!sid) return
    try {
      await window.api.endSession(sid, get().sessionSeconds, get().pagesReadThisSession)
    } catch {
      /* تجاهل عند الإغلاق */
    }
    set({ sessionId: null })
  },

  saveProgress: async (progress, location, finished) => {
    const book = get().book
    if (!book) return
    const status =
      finished || progress >= 99.5 ? 'finished' : progress > 0.5 ? 'reading' : book.status
    const patch = {
      progress,
      lastLocation: location ?? book.lastLocation,
      status,
      lastReadAt: Date.now()
    }
    await window.api.updateBook(book.id, patch)
    // مزامنة المخازن: بلا هذه الخطوة تعيد الفتح اللاحق نسخة قديمة من lastLocation/progress
    // فتُستعاد الصفحة 1 وتُكتب فوق موضع القراءة الحقيقي
    const { useLibrary } = await import('@/stores/library')
    useLibrary.setState((s) => ({
      books: s.books.map((x) => (x.id === book.id ? { ...x, ...patch } : x))
    }))
    set((s) => (s.book?.id === book.id ? { book: { ...s.book, ...patch } } : {}))
  }
}))
