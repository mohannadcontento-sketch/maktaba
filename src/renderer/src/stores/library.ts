import { create } from 'zustand'
import type { Book, Collection, Tag } from '../../../shared/types'

export type SortKey = 'recent' | 'title' | 'author' | 'progress' | 'added'
export type ViewMode = 'grid' | 'list'

interface LibraryState {
  books: Book[]
  tags: Tag[]
  collections: Collection[]
  loaded: boolean
  importing: boolean
  sortKey: SortKey
  view: ViewMode

  load(): Promise<void>
  setImporting(b: boolean): void
  setSortKey(k: SortKey): void
  setView(v: ViewMode): void

  importPaths(paths: string[]): Promise<number>
  updateBook(id: string, patch: Parameters<typeof window.api.updateBook>[1]): Promise<void>
  removeBook(id: string, deleteFile: boolean): Promise<void>
  saveCover(id: string, dataUrl: string): Promise<string>
  reloadOne(id: string): Promise<Book | null>

  createTag(name: string, color: string): Promise<Tag>
  removeTag(id: number): Promise<void>
  setBookTags(bookId: string, tagIds: number[]): Promise<void>

  createCollection(name: string): Promise<Collection>
  renameCollectionById(id: number, name: string): Promise<void>
  deleteCollectionById(id: number): Promise<void>
  addBookToCollection(cid: number, bid: string): Promise<void>
  removeBookFromCollection(cid: number, bid: string): Promise<void>

  getBook(id: string): Book | undefined
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  tags: [],
  collections: [],
  loaded: false,
  importing: false,
  sortKey: 'recent',
  view: 'grid',

  load: async () => {
    const [books, tags, collections] = await Promise.all([
      window.api.listBooks(),
      window.api.listTags(),
      window.api.listCollections()
    ])
    set({ books, tags, collections, loaded: true })
  },

  setImporting: (importing) => set({ importing }),
  setSortKey: (sortKey) => set({ sortKey }),
  setView: (view) => set({ view }),

  importPaths: async (paths) => {
    if (!paths.length) return 0
    set({ importing: true })
    try {
      const added = await window.api.importPaths(paths)
      await get().load()
      return added.length
    } finally {
      set({ importing: false })
    }
  },

  updateBook: async (id, patch) => {
    await window.api.updateBook(id, patch)
    await get().load()
  },

  removeBook: async (id, deleteFile) => {
    await window.api.deleteBook(id, deleteFile)
    await get().load()
  },

  saveCover: async (id, dataUrl) => {
    const p = await window.api.saveCover(id, dataUrl)
    await get().load()
    return p
  },

  reloadOne: async (id) => {
    const b = await window.api.getBook(id)
    if (b) {
      set((s) => ({ books: s.books.map((x) => (x.id === id ? b : x)) }))
    }
    return b
  },

  createTag: async (name, color) => {
    const tag = await window.api.createTag(name, color)
    set((s) => ({ tags: [...s.tags, tag] }))
    return tag
  },
  removeTag: async (id) => {
    await window.api.deleteTag(id)
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
  },
  setBookTags: async (bookId, tagIds) => {
    await window.api.setBookTags(bookId, tagIds)
    await get().load()
  },

  createCollection: async (name) => {
    const c = await window.api.createCollection(name)
    set((s) => ({ collections: [...s.collections, c] }))
    return c
  },
  renameCollectionById: async (id, name) => {
    await window.api.renameCollection(id, name)
    set((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)) }))
  },
  deleteCollectionById: async (id) => {
    await window.api.deleteCollection(id)
    set((s) => ({ collections: s.collections.filter((c) => c.id !== id) }))
  },
  addBookToCollection: async (cid, bid) => {
    await window.api.addBookToCollection(cid, bid)
    set((s) => ({
      collections: s.collections.map((c) => (c.id === cid ? { ...c, bookCount: c.bookCount + 1 } : c))
    }))
  },
  removeBookFromCollection: async (cid, bid) => {
    await window.api.removeBookFromCollection(cid, bid)
    set((s) => ({
      collections: s.collections.map((c) => (c.id === cid ? { ...c, bookCount: Math.max(0, c.bookCount - 1) } : c))
    }))
  },

  getBook: (id) => get().books.find((b) => b.id === id)
}))
