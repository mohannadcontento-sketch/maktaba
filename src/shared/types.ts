// أنواع مشتركة بين العملية الرئيسية والواجهة

export type BookFormat = 'pdf' | 'epub'
export type ReadStatus = 'new' | 'reading' | 'finished'
export type AnnotationType = 'highlight' | 'underline' | 'note'

export interface Tag {
  id: number
  name: string
  color: string
}

export interface Book {
  id: string
  title: string
  author: string | null
  format: BookFormat
  fileName: string
  originalPath: string | null
  coverPath: string | null
  size: number
  pageCount: number | null
  language: string | null
  publisher: string | null
  pubDate: string | null
  description: string | null
  rating: number
  status: ReadStatus
  progress: number
  lastLocation: string | null
  lastReadAt: number | null
  addedAt: number
  favorite: number
  tags: Tag[]
}

export interface Collection {
  id: number
  name: string
  bookCount: number
}

export interface Annotation {
  id: string
  bookId: string
  type: AnnotationType
  color: string
  page: number | null
  cfi: string | null
  rects: string | null // JSON: [{l,t,w,h}] بإحداثيات صفحة غير مقيّسة
  text: string | null
  note: string
  createdAt: number
  updatedAt: number
}

export interface Bookmark {
  id: string
  bookId: string
  label: string
  location: string
  page: number | null
  excerpt: string | null
  createdAt: number
}

export interface DayMinutes {
  date: string // YYYY-MM-DD
  minutes: number
}

export interface StatsSummary {
  totalBooks: number
  finishedBooks: number
  readingBooks: number
  totalSeconds: number
  totalPagesRead: number
  annotationCount: number
  bookmarkCount: number
  streakDays: number
  last14: DayMinutes[]
  topBooks: { id: string; title: string; seconds: number }[]
}

export interface BookUpdate {
  title?: string
  author?: string | null
  language?: string | null
  publisher?: string | null
  pubDate?: string | null
  description?: string | null
  rating?: number
  status?: ReadStatus
  progress?: number
  lastLocation?: string | null
  lastReadAt?: number | null
  favorite?: number
  pageCount?: number | null
  coverPath?: string | null
}

export interface AppSettings {
  [key: string]: string | number | boolean | null
}

// جسر API المكشوف للواجهة عبر preload
export interface ApiBridge {
  // استيراد
  pickAndImportBooks(): Promise<Book[]>
  pickFolderAndScan(): Promise<Book[]>
  pathsForFiles(files: File[]): string[]
  importPaths(paths: string[]): Promise<Book[]>
  onOpenFiles(cb: (paths: string[]) => void): () => void

  // كتب
  listBooks(): Promise<Book[]>
  getBook(id: string): Promise<Book | null>
  updateBook(id: string, patch: BookUpdate): Promise<void>
  deleteBook(id: string, deleteFile: boolean): Promise<void>
  saveCover(bookId: string, dataUrl: string): Promise<string>
  fetchWebCover(bookId: string, title: string, author?: string | null): Promise<Book | null>
  fileUrl(id: string): Promise<string>
  revealBookFile(id: string): Promise<void>

  // وسوم
  listTags(): Promise<Tag[]>
  createTag(name: string, color: string): Promise<Tag>
  deleteTag(id: number): Promise<void>
  setBookTags(bookId: string, tagIds: number[]): Promise<void>

  // مجموعات
  listCollections(): Promise<Collection[]>
  createCollection(name: string): Promise<Collection>
  renameCollection(id: number, name: string): Promise<void>
  deleteCollection(id: number): Promise<void>
  addBookToCollection(collectionId: number, bookId: string): Promise<void>
  removeBookFromCollection(collectionId: number, bookId: string): Promise<void>
  getCollectionBookIds(collectionId: number): Promise<string[]>

  // تعليقات
  listAnnotations(bookId: string): Promise<Annotation[]>
  addAnnotation(a: Omit<Annotation, 'createdAt' | 'updatedAt'>): Promise<Annotation>
  updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void>
  deleteAnnotation(id: string): Promise<void>

  // علامات مرجعية
  listBookmarks(bookId: string): Promise<Bookmark[]>
  addBookmark(b: Omit<Bookmark, 'createdAt'>): Promise<Bookmark>
  deleteBookmark(id: string): Promise<void>

  // جلسات قراءة
  startSession(bookId: string): Promise<number>
  sessionHeartbeat(sessionId: number, seconds: number, pagesRead: number): Promise<void>
  endSession(sessionId: number, seconds: number, pagesRead: number): Promise<void>
  stats(): Promise<StatsSummary>

  // إعدادات
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>

  // نظام
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(cb: (max: boolean) => void): () => void
  setTitleBarOverlay(opts: { color?: string; symbolColor?: string }): Promise<void>
  printPage(): void
  openDataFolder(): Promise<void>
  exportAnnotations(bookId: string): Promise<string | null>
  platform: NodeJS.Platform
}
