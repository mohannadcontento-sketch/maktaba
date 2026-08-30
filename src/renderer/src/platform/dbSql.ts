/**
 * قاعدة البيانات على الجوال — sql.js (SQLite WASM) بنفس مخطط قاعدة سطح المكتب
 * تُحفظ كملف maktaba.db داخل مجلد بيانات التطبيق بعد كل تعديل
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { raceTimeout, readDataFile, writeDataFile } from './native'
import type {
  Annotation,
  Book,
  BookUpdate,
  Bookmark,
  Collection,
  ReadStatus,
  StatsSummary,
  Tag
} from '../../../shared/types'

const DB_FILE = 'maktaba.db'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  format TEXT NOT NULL CHECK(format IN ('pdf','epub')),
  file_name TEXT NOT NULL,
  original_path TEXT,
  cover_path TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  language TEXT,
  publisher TEXT,
  pub_date TEXT,
  description TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reading','finished')),
  progress REAL NOT NULL DEFAULT 0,
  last_location TEXT,
  last_read_at INTEGER,
  added_at INTEGER NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_books_last_read ON books(last_read_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_added ON books(added_at DESC);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#0d9488'
);
CREATE TABLE IF NOT EXISTS book_tags (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_books (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, book_id)
);
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('highlight','underline','note')),
  color TEXT NOT NULL DEFAULT '#f59e0b',
  page INTEGER,
  cfi TEXT,
  rects TEXT,
  text TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_book ON annotations(book_id);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  page INTEGER,
  excerpt TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bm_book ON bookmarks(book_id);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  seconds INTEGER NOT NULL DEFAULT 0,
  pages_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sess_book ON sessions(book_id, started_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

let db: SqlJsDatabase | null = null

// غلاف بسيط لواجهة sql.js بأسلوب better-sqlite3
export function run(sql: string, params: unknown[] = []): void {
  db?.run(sql, params as never[])
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  if (!db) return []
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params as never[])
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as T)
    return rows
  } finally {
    stmt.free()
  }
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return all<T>(sql, params)[0]
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** حفظ مؤجل للقاعدة إلى القرص (يجمع عدة تعديلات متتالية في كتابة واحدة) */
export function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => void persistNow(), 400)
}

export async function persistNow(): Promise<void> {
  if (!db) return
  try {
    const data = db.export()
    await writeDataFile(DB_FILE, data)
  } catch (e) {
    console.warn('db persist failed', e)
  }
}

export async function openDb(): Promise<void> {
  if (db) return
  // مهلة صريحة لتهيئة WASM — فشل مرئي بدل تجمّد صامت على أجهزة بطيئة
  const SQL = await raceTimeout(initSqlJs({ locateFile: () => wasmUrl }), 15000, 'sql.js wasm init')
  const existing = await raceTimeout(readDataFile(DB_FILE), 6000, 'read db file').catch(() => null)
  db = existing && existing.length ? new SQL.Database(existing) : new SQL.Database()
  db.run('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
}

function rowToBook(row: Record<string, unknown>, tags: Tag[]): Book {
  return {
    id: String(row.id),
    title: String(row.title),
    author: (row.author as string) ?? null,
    format: row.format as 'pdf' | 'epub',
    fileName: String(row.file_name),
    originalPath: (row.original_path as string) ?? null,
    coverPath: (row.cover_path as string) ?? null,
    size: Number(row.size ?? 0),
    pageCount: (row.page_count as number) ?? null,
    language: (row.language as string) ?? null,
    publisher: (row.publisher as string) ?? null,
    pubDate: (row.pub_date as string) ?? null,
    description: (row.description as string) ?? null,
    rating: Number(row.rating ?? 0),
    status: row.status as ReadStatus,
    progress: Number(row.progress ?? 0),
    lastLocation: (row.last_location as string) ?? null,
    lastReadAt: (row.last_read_at as number) ?? null,
    addedAt: Number(row.added_at ?? 0),
    favorite: Number(row.favorite ?? 0),
    tags
  }
}

function tagsForBooks(ids: string[]): Map<string, Tag[]> {
  const map = new Map<string, Tag[]>()
  if (!ids.length) return map
  const ph = ids.map(() => '?').join(',')
  const rows = all<{ book_id: string; id: number; name: string; color: string }>(
    `SELECT bt.book_id, t.id, t.name, t.color
     FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
     WHERE bt.book_id IN (${ph})`,
    ids
  )
  for (const r of rows) {
    const list = map.get(r.book_id) ?? []
    list.push({ id: r.id, name: r.name, color: r.color })
    map.set(r.book_id, list)
  }
  return map
}

export function listBooks(): Book[] {
  const rows = all('SELECT * FROM books ORDER BY added_at DESC')
  const tagMap = tagsForBooks(rows.map((r) => String(r.id)))
  return rows.map((r) => rowToBook(r, tagMap.get(String(r.id)) ?? []))
}

export function getBook(id: string): Book | null {
  const row = get('SELECT * FROM books WHERE id = ?', [id])
  if (!row) return null
  const tagMap = tagsForBooks([id])
  return rowToBook(row, tagMap.get(id) ?? [])
}

export function findDuplicate(size: number, fileName: string): string | null {
  const row = get<{ id: string }>('SELECT id FROM books WHERE size = ? AND file_name = ?', [size, fileName])
  return row?.id ?? null
}

export interface NewBookInput {
  title: string
  format: 'pdf' | 'epub'
  fileName: string
  originalPath: string
  size: number
}

export function insertBook(input: NewBookInput): string {
  const id = crypto.randomUUID()
  run('INSERT INTO books (id, title, format, file_name, original_path, size, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id,
    input.title,
    input.format,
    input.fileName,
    input.originalPath,
    input.size,
    Date.now()
  ])
  schedulePersist()
  return id
}

const BOOK_COLUMNS: Record<string, string> = {
  title: 'title',
  author: 'author',
  language: 'language',
  publisher: 'publisher',
  pubDate: 'pub_date',
  description: 'description',
  rating: 'rating',
  status: 'status',
  progress: 'progress',
  lastLocation: 'last_location',
  lastReadAt: 'last_read_at',
  favorite: 'favorite',
  pageCount: 'page_count',
  coverPath: 'cover_path'
}

export function updateBook(id: string, patch: BookUpdate): void {
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [key, col] of Object.entries(BOOK_COLUMNS)) {
    if (key in patch) {
      sets.push(`${col} = ?`)
      vals.push(patch[key as keyof BookUpdate])
    }
  }
  if (!sets.length) return
  vals.push(id)
  run(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, vals)
  schedulePersist()
}

export function deleteBookRow(id: string): void {
  run('DELETE FROM books WHERE id = ?', [id])
  schedulePersist()
}

// ---------- وسوم ----------
export function listTags(): Tag[] {
  return all<{ id: number; name: string; color: string }>('SELECT id, name, color FROM tags ORDER BY name') as Tag[]
}

export function createTag(name: string, color: string): Tag {
  run('INSERT INTO tags (name, color) VALUES (?, ?)', [name, color])
  const row = get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [name])
  schedulePersist()
  return { id: row!.id, name, color }
}

export function deleteTag(id: number): void {
  run('DELETE FROM tags WHERE id = ?', [id])
  schedulePersist()
}

export function setBookTags(bookId: string, tagIds: number[]): void {
  run('BEGIN')
  try {
    run('DELETE FROM book_tags WHERE book_id = ?', [bookId])
    for (const tid of tagIds) run('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)', [bookId, tid])
    run('COMMIT')
  } catch (e) {
    run('ROLLBACK')
    throw e
  }
  schedulePersist()
}

// ---------- مجموعات ----------
export function listCollections(): Collection[] {
  return all<{ id: number; name: string; bookCount: number }>(
    `SELECT c.id, c.name, COUNT(cb.book_id) AS bookCount
     FROM collections c LEFT JOIN collection_books cb ON cb.collection_id = c.id
     GROUP BY c.id ORDER BY c.created_at`
  ) as Collection[]
}

export function createCollection(name: string): Collection {
  run('INSERT INTO collections (name, created_at) VALUES (?, ?)', [name, Date.now()])
  const row = get<{ id: number }>('SELECT id FROM collections WHERE name = ?', [name])
  schedulePersist()
  return { id: row!.id, name, bookCount: 0 }
}

export function renameCollection(id: number, name: string): void {
  run('UPDATE collections SET name = ? WHERE id = ?', [name, id])
  schedulePersist()
}

export function deleteCollection(id: number): void {
  run('DELETE FROM collections WHERE id = ?', [id])
  schedulePersist()
}

export function addBookToCollection(collectionId: number, bookId: string): void {
  run('INSERT OR IGNORE INTO collection_books (collection_id, book_id) VALUES (?, ?)', [collectionId, bookId])
  schedulePersist()
}

export function removeBookFromCollection(collectionId: number, bookId: string): void {
  run('DELETE FROM collection_books WHERE collection_id = ? AND book_id = ?', [collectionId, bookId])
  schedulePersist()
}

export function getCollectionBookIds(collectionId: number): string[] {
  return all<{ book_id: string }>('SELECT book_id FROM collection_books WHERE collection_id = ?', [collectionId]).map(
    (r) => r.book_id
  )
}

// ---------- تعليقات ----------
interface AnnRow extends Record<string, unknown> {
  id: string
  book_id: string
  type: Annotation['type']
  color: string
  page: number | null
  cfi: string | null
  rects: string | null
  text: string | null
  note: string
  created_at: number
  updated_at: number
}

function annRow(r: AnnRow): Annotation {
  return {
    id: r.id,
    bookId: r.book_id,
    type: r.type,
    color: r.color,
    page: r.page,
    cfi: r.cfi,
    rects: r.rects,
    text: r.text,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listAnnotations(bookId: string): Annotation[] {
  return all<AnnRow>('SELECT * FROM annotations WHERE book_id = ? ORDER BY created_at DESC', [bookId]).map(annRow)
}

export function addAnnotation(
  a: Omit<Annotation, 'createdAt' | 'updatedAt'> & Partial<Pick<Annotation, 'createdAt'>>
): Annotation {
  const now = Date.now()
  run(
    `INSERT INTO annotations (id, book_id, type, color, page, cfi, rects, text, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.id, a.bookId, a.type, a.color, a.page, a.cfi, a.rects, a.text, a.note, now, now]
  )
  schedulePersist()
  return { ...a, createdAt: now, updatedAt: now } as Annotation
}

export function updateAnnotation(id: string, patch: Partial<Annotation>): void {
  const allowed: [string, string][] = [
    ['color', 'color'],
    ['note', 'note'],
    ['type', 'type']
  ]
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, col] of allowed) {
    if (k in patch) {
      sets.push(`${col} = ?`)
      vals.push(patch[k as keyof Annotation])
    }
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  vals.push(Date.now(), id)
  run(`UPDATE annotations SET ${sets.join(', ')} WHERE id = ?`, vals)
  schedulePersist()
}

export function deleteAnnotation(id: string): void {
  run('DELETE FROM annotations WHERE id = ?', [id])
  schedulePersist()
}

// ---------- علامات مرجعية ----------
export function listBookmarks(bookId: string): Bookmark[] {
  return all<Record<string, unknown>>('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC', [bookId]).map(
    (r) => ({
      id: String(r.id),
      bookId: String(r.book_id),
      label: String(r.label ?? ''),
      location: String(r.location),
      page: (r.page as number) ?? null,
      excerpt: (r.excerpt as string) ?? null,
      createdAt: Number(r.created_at)
    })
  )
}

export function addBookmark(b: Omit<Bookmark, 'createdAt'>): Bookmark {
  const now = Date.now()
  run('INSERT INTO bookmarks (id, book_id, label, location, page, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    b.id,
    b.bookId,
    b.label,
    b.location,
    b.page,
    b.excerpt,
    now
  ])
  schedulePersist()
  return { ...b, createdAt: now }
}

export function deleteBookmark(id: string): void {
  run('DELETE FROM bookmarks WHERE id = ?', [id])
  schedulePersist()
}

// ---------- جلسات القراءة ----------
export function startSession(bookId: string): number {
  run('INSERT INTO sessions (book_id, started_at, seconds, pages_read) VALUES (?, ?, 0, 0)', [bookId, Date.now()])
  const row = get<{ id: number }>('SELECT id FROM sessions WHERE book_id = ? ORDER BY started_at DESC LIMIT 1', [bookId])
  schedulePersist()
  return row!.id
}

export function sessionProgress(sessionId: number, seconds: number, pagesRead: number, ended: boolean): void {
  if (ended) {
    run('UPDATE sessions SET seconds = ?, pages_read = ?, ended_at = ? WHERE id = ?', [seconds, pagesRead, Date.now(), sessionId])
  } else {
    run('UPDATE sessions SET seconds = ?, pages_read = ? WHERE id = ?', [seconds, pagesRead, sessionId])
  }
  schedulePersist()
}

// ---------- إحصائيات ----------
export function statsSummary(): StatsSummary {
  const c = (sql: string, params: unknown[] = []): number => {
    const row = get<{ c: number }>(sql, params)
    return Number(row?.c ?? 0)
  }
  const totalBooks = c('SELECT COUNT(*) c FROM books')
  const finishedBooks = c("SELECT COUNT(*) c FROM books WHERE status = 'finished'")
  const readingBooks = c("SELECT COUNT(*) c FROM books WHERE status = 'reading'")
  const agg = get<{ s: number; p: number }>('SELECT COALESCE(SUM(seconds),0) s, COALESCE(SUM(pages_read),0) p FROM sessions')
  const annotationCount = c('SELECT COUNT(*) c FROM annotations')
  const bookmarkCount = c('SELECT COUNT(*) c FROM bookmarks')

  // سلسلة الأيام المتتالية
  const dayRows = all<{ d: string }>(
    `SELECT DISTINCT date(started_at/1000,'unixepoch','localtime') d FROM sessions WHERE d IS NOT NULL ORDER BY d DESC`
  )
  let streakDays = 0
  const fmt = (dt: Date): string =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  const has = new Set(dayRows.map((r) => r.d))
  const cursor = new Date()
  if (!has.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (has.has(fmt(cursor))) {
    streakDays++
    cursor.setDate(cursor.getDate() - 1)
  }

  // آخر 14 يومًا
  const last14: StatsSummary['last14'] = []
  const from = new Date()
  from.setDate(from.getDate() - 13)
  from.setHours(0, 0, 0, 0)
  const mRows = all<{ d: string; m: number }>(
    `SELECT date(started_at/1000,'unixepoch','localtime') d, SUM(seconds)/60.0 m
     FROM sessions WHERE started_at >= ? GROUP BY d`,
    [from.getTime()]
  )
  const minutesByDay = new Map<string, number>()
  for (const r of mRows) minutesByDay.set(r.d, Math.round(r.m))
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(today)
    dt.setDate(dt.getDate() - i)
    const key = fmt(dt)
    last14.push({ date: key, minutes: minutesByDay.get(key) ?? 0 })
  }

  const topBooks = all<{ id: string; title: string; sec: number }>(
    `SELECT b.id, b.title, SUM(s.seconds) sec
     FROM sessions s JOIN books b ON b.id = s.book_id
     GROUP BY s.book_id ORDER BY sec DESC LIMIT 5`
  ).map((r) => ({ id: r.id, title: r.title, seconds: r.sec }))

  return {
    totalBooks,
    finishedBooks,
    readingBooks,
    totalSeconds: Number(agg?.s ?? 0),
    totalPagesRead: Number(agg?.p ?? 0),
    annotationCount,
    bookmarkCount,
    streakDays,
    last14,
    topBooks
  }
}

// ---------- إعدادات ----------
export function getSetting(key: string): string | null {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value])
  schedulePersist()
}

// ---------- النسخ الاحتياطي ----------
export interface BackupData {
  app: 'maktaba'
  schemaVersion: number
  exportedAt: number
  books: Record<string, unknown>[]
  tags: { id: number; name: string; color: string }[]
  book_tags: { book_id: string; tag_id: number }[]
  collections: { id: number; name: string; created_at: number }[]
  collection_books: { collection_id: number; book_id: string }[]
  annotations: Record<string, unknown>[]
  bookmarks: Record<string, unknown>[]
  settings: { key: string; value: string }[]
}

export function exportAllData(): BackupData {
  return {
    app: 'maktaba',
    schemaVersion: 1,
    exportedAt: Date.now(),
    books: all('SELECT * FROM books'),
    tags: all('SELECT * FROM tags') as BackupData['tags'],
    book_tags: all('SELECT * FROM book_tags') as BackupData['book_tags'],
    collections: all('SELECT * FROM collections') as BackupData['collections'],
    collection_books: all('SELECT * FROM collection_books') as BackupData['collection_books'],
    annotations: all('SELECT * FROM annotations'),
    bookmarks: all('SELECT * FROM bookmarks'),
    settings: all('SELECT * FROM settings') as BackupData['settings']
  }
}

const BOOK_COLS = [
  'id',
  'title',
  'author',
  'format',
  'file_name',
  'original_path',
  'cover_path',
  'size',
  'page_count',
  'language',
  'publisher',
  'pub_date',
  'description',
  'rating',
  'status',
  'progress',
  'last_location',
  'last_read_at',
  'added_at',
  'favorite'
] as const

export interface ImportBackupResult {
  booksAdded: number
  booksSkipped: number
  tagsAdded: number
  collectionsAdded: number
  annotationsAdded: number
  bookmarksAdded: number
}

export function importAllData(
  data: BackupData,
  coverMap: Map<string, string> // اسم ملف الغلاف داخل النسخة → المسار المحلي المراد له
): ImportBackupResult {
  const result: ImportBackupResult = {
    booksAdded: 0,
    booksSkipped: 0,
    tagsAdded: 0,
    collectionsAdded: 0,
    annotationsAdded: 0,
    bookmarksAdded: 0
  }
  run('BEGIN')
  try {
    const existing = (id: string): boolean => !!get('SELECT id FROM books WHERE id = ?', [id])
    for (const row of data.books ?? []) {
      const id = String(row['id'] ?? '')
      if (!id) continue
      if (existing(id)) {
        result.booksSkipped++
        continue
      }
      const coverRaw = row['cover_path']
      const coverBase = typeof coverRaw === 'string' ? coverRaw.split(/[\\/]/).pop() ?? '' : ''
      const coverLocal = coverBase ? coverMap.get(coverBase) ?? null : null
      run(
        `INSERT OR IGNORE INTO books (${BOOK_COLS.join(', ')}) VALUES (${BOOK_COLS.map(() => '?').join(', ')})`,
        BOOK_COLS.map((c) => (c === 'cover_path' ? coverLocal : row[c] ?? null))
      )
      result.booksAdded++
    }

    const tagMap = new Map<number, number>()
    for (const t of data.tags ?? []) {
      if (!t?.name) continue
      const found = get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [t.name])
      if (found) {
        tagMap.set(t.id, found.id)
      } else {
        run('INSERT INTO tags (name, color) VALUES (?, ?)', [t.name, t.color ?? '#0d9488'])
        const ins = get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [t.name])
        tagMap.set(t.id, ins!.id)
        result.tagsAdded++
      }
    }
    for (const bt of data.book_tags ?? []) {
      const newId = tagMap.get(bt?.tag_id)
      if (newId && bt.book_id) run('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)', [bt.book_id, newId])
    }

    const colMap = new Map<number, number>()
    for (const col of data.collections ?? []) {
      if (!col?.name) continue
      const found = get<{ id: number }>('SELECT id FROM collections WHERE name = ?', [col.name])
      if (found) {
        colMap.set(col.id, found.id)
      } else {
        run('INSERT INTO collections (name, created_at) VALUES (?, ?)', [col.name, col.created_at ?? Date.now()])
        const ins = get<{ id: number }>('SELECT id FROM collections WHERE name = ?', [col.name])
        colMap.set(col.id, ins!.id)
        result.collectionsAdded++
      }
    }
    for (const cb of data.collection_books ?? []) {
      const newId = colMap.get(cb?.collection_id)
      if (newId && cb.book_id) run('INSERT OR IGNORE INTO collection_books (collection_id, book_id) VALUES (?, ?)', [newId, cb.book_id])
    }

    for (const a of data.annotations ?? []) {
      if (!a['id'] || !a['book_id']) continue
      if (!existing(String(a['book_id']))) continue
      run(
        `INSERT OR IGNORE INTO annotations (id, book_id, type, color, page, cfi, rects, text, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a['id'], a['book_id'], a['type'] ?? 'highlight', a['color'] ?? '#f59e0b',
          a['page'] ?? null, a['cfi'] ?? null, a['rects'] ?? null, a['text'] ?? null,
          a['note'] ?? '', a['created_at'] ?? Date.now(), a['updated_at'] ?? Date.now()
        ]
      )
      result.annotationsAdded++
    }
    for (const b of data.bookmarks ?? []) {
      if (!b['id'] || !b['book_id']) continue
      if (!existing(String(b['book_id']))) continue
      run(
        `INSERT OR IGNORE INTO bookmarks (id, book_id, label, location, page, excerpt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [b['id'], b['book_id'], b['label'] ?? '', b['location'] ?? '', b['page'] ?? null, b['excerpt'] ?? null, b['created_at'] ?? Date.now()]
      )
      result.bookmarksAdded++
    }
    for (const s of data.settings ?? []) {
      if (!s?.key) continue
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [s.key, s.value ?? ''])
    }
    run('COMMIT')
  } catch (e) {
    run('ROLLBACK')
    throw e
  }
  schedulePersist()
  return result
}
