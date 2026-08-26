import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  Annotation,
  Book,
  BookUpdate,
  Bookmark,
  Collection,
  ReadStatus,
  StatsSummary,
  Tag
} from '../shared/types'

let db: Database.Database

export function dbPath(): string {
  return path.join(app.getPath('userData'), 'maktaba.db')
}

export function initDb(): void {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
}

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

// ---------- كتب ----------

interface BookRow {
  id: string
  title: string
  author: string | null
  format: 'pdf' | 'epub'
  file_name: string
  original_path: string | null
  cover_path: string | null
  size: number
  page_count: number | null
  language: string | null
  publisher: string | null
  pub_date: string | null
  description: string | null
  rating: number
  status: ReadStatus
  progress: number
  last_location: string | null
  last_read_at: number | null
  added_at: number
  favorite: number
}

function rowToBook(row: BookRow, tags: Tag[]): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format,
    fileName: row.file_name,
    originalPath: row.original_path,
    coverPath: row.cover_path,
    size: row.size,
    pageCount: row.page_count,
    language: row.language,
    publisher: row.publisher,
    pubDate: row.pub_date,
    description: row.description,
    rating: row.rating,
    status: row.status,
    progress: row.progress,
    lastLocation: row.last_location,
    lastReadAt: row.last_read_at,
    addedAt: row.added_at,
    favorite: row.favorite,
    tags
  }
}

function tagsForBooks(ids: string[]): Map<string, Tag[]> {
  const map = new Map<string, Tag[]>()
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT bt.book_id, t.id, t.name, t.color
       FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
       WHERE bt.book_id IN (${placeholders})`
    )
    .all(...ids) as { book_id: string; id: number; name: string; color: string }[]
  for (const r of rows) {
    const list = map.get(r.book_id) ?? []
    list.push({ id: r.id, name: r.name, color: r.color })
    map.set(r.book_id, list)
  }
  return map
}

export function listBooks(): Book[] {
  const rows = db.prepare('SELECT * FROM books ORDER BY added_at DESC').all() as BookRow[]
  const tagMap = tagsForBooks(rows.map((r) => r.id))
  return rows.map((r) => rowToBook(r, tagMap.get(r.id) ?? []))
}

export function getBook(id: string): Book | null {
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined
  if (!row) return null
  const tagMap = tagsForBooks([id])
  return rowToBook(row, tagMap.get(id) ?? [])
}

export function findDuplicate(size: number, originalPath: string): string | null {
  const row = db
    .prepare('SELECT id FROM books WHERE size = ? AND (original_path = ? OR file_name LIKE ?)')
    .get(size, originalPath, `%${path.basename(originalPath)}`) as { id: string } | undefined
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
  const id = randomUUID()
  db.prepare(
    `INSERT INTO books (id, title, format, file_name, original_path, size, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.title, input.format, input.fileName, input.originalPath, input.size, Date.now())
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
  if (sets.length === 0) return
  vals.push(id)
  db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteBookRow(id: string): void {
  db.prepare('DELETE FROM books WHERE id = ?').run(id)
}

// ---------- وسوم ----------

export function listTags(): Tag[] {
  return db.prepare('SELECT id, name, color FROM tags ORDER BY name').all() as Tag[]
}

export function createTag(name: string, color: string): Tag {
  const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color)
  return { id: Number(info.lastInsertRowid), name, color }
}

export function deleteTag(id: number): void {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function setBookTags(bookId: string, tagIds: number[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId)
    const ins = db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)')
    for (const tid of tagIds) ins.run(bookId, tid)
  })
  tx()
}

// ---------- مجموعات ----------

export function listCollections(): Collection[] {
  return db
    .prepare(
      `SELECT c.id, c.name, COUNT(cb.book_id) AS bookCount
       FROM collections c LEFT JOIN collection_books cb ON cb.collection_id = c.id
       GROUP BY c.id ORDER BY c.created_at`
    )
    .all() as Collection[]
}

export function createCollection(name: string): Collection {
  const info = db.prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)').run(name, Date.now())
  return { id: Number(info.lastInsertRowid), name, bookCount: 0 }
}

export function renameCollection(id: number, name: string): void {
  db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id)
}

export function deleteCollection(id: number): void {
  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
}

export function addBookToCollection(collectionId: number, bookId: string): void {
  db.prepare('INSERT OR IGNORE INTO collection_books (collection_id, book_id) VALUES (?, ?)').run(collectionId, bookId)
}

export function removeBookFromCollection(collectionId: number, bookId: string): void {
  db.prepare('DELETE FROM collection_books WHERE collection_id = ? AND book_id = ?').run(collectionId, bookId)
}

export function getCollectionBookIds(collectionId: number): string[] {
  const rows = db
    .prepare('SELECT book_id FROM collection_books WHERE collection_id = ?')
    .all(collectionId) as { book_id: string }[]
  return rows.map((r) => r.book_id)
}

// ---------- تعليقات ----------

interface AnnRow {
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
  const rows = db
    .prepare('SELECT * FROM annotations WHERE book_id = ? ORDER BY created_at DESC')
    .all(bookId) as AnnRow[]
  return rows.map(annRow)
}

export function addAnnotation(a: Omit<Annotation, 'createdAt' | 'updatedAt'> & Partial<Pick<Annotation, 'createdAt'>>): Annotation {
  const now = Date.now()
  db.prepare(
    `INSERT INTO annotations (id, book_id, type, color, page, cfi, rects, text, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(a.id, a.bookId, a.type, a.color, a.page, a.cfi, a.rects, a.text, a.note, now, now)
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
  db.prepare(`UPDATE annotations SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteAnnotation(id: string): void {
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id)
}

// ---------- علامات مرجعية ----------

interface BmRow {
  id: string
  book_id: string
  label: string
  location: string
  page: number | null
  excerpt: string | null
  created_at: number
}

export function listBookmarks(bookId: string): Bookmark[] {
  const rows = db
    .prepare('SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC')
    .all(bookId) as BmRow[]
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    label: r.label,
    location: r.location,
    page: r.page,
    excerpt: r.excerpt,
    createdAt: r.created_at
  }))
}

export function addBookmark(b: Omit<Bookmark, 'createdAt'>): Bookmark {
  const now = Date.now()
  db.prepare(
    `INSERT INTO bookmarks (id, book_id, label, location, page, excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(b.id, b.bookId, b.label, b.location, b.page, b.excerpt, now)
  return { ...b, createdAt: now }
}

export function deleteBookmark(id: string): void {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
}

// ---------- جلسات القراءة ----------

export function startSession(bookId: string): number {
  const info = db
    .prepare('INSERT INTO sessions (book_id, started_at, seconds, pages_read) VALUES (?, ?, 0, 0)')
    .run(bookId, Date.now())
  return Number(info.lastInsertRowid)
}

export function sessionProgress(sessionId: number, seconds: number, pagesRead: number, ended: boolean): void {
  if (ended) {
    db.prepare('UPDATE sessions SET seconds = ?, pages_read = ?, ended_at = ? WHERE id = ?').run(
      seconds,
      pagesRead,
      Date.now(),
      sessionId
    )
  } else {
    db.prepare('UPDATE sessions SET seconds = ?, pages_read = ? WHERE id = ?').run(seconds, pagesRead, sessionId)
  }
}

// ---------- إحصائيات ----------

export function statsSummary(): StatsSummary {
  const totalBooks = (db.prepare('SELECT COUNT(*) c FROM books').get() as { c: number }).c
  const finishedBooks = (db.prepare("SELECT COUNT(*) c FROM books WHERE status = 'finished'").get() as { c: number }).c
  const readingBooks = (db.prepare("SELECT COUNT(*) c FROM books WHERE status = 'reading'").get() as { c: number }).c
  const agg = db.prepare('SELECT COALESCE(SUM(seconds),0) s, COALESCE(SUM(pages_read),0) p FROM sessions').get() as {
    s: number
    p: number
  }
  const annotationCount = (db.prepare('SELECT COUNT(*) c FROM annotations').get() as { c: number }).c
  const bookmarkCount = (db.prepare('SELECT COUNT(*) c FROM bookmarks').get() as { c: number }).c

  // سلسلة الأيام المتتالية
  const dayRows = db
    .prepare(
      `SELECT DISTINCT date(started_at/1000,'unixepoch','localtime') d FROM sessions
       WHERE d IS NOT NULL ORDER BY d DESC`
    )
    .all() as { d: string }[]
  let streakDays = 0
  const fmt = (dt: Date): string =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  const today = new Date()
  const cursor = new Date(today)
  const has = new Set(dayRows.map((r) => r.d))
  if (!has.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (has.has(fmt(cursor))) {
    streakDays++
    cursor.setDate(cursor.getDate() - 1)
  }

  // آخر 14 يومًا
  const last14: StatsSummary['last14'] = []
  const from = new Date(today)
  from.setDate(from.getDate() - 13)
  from.setHours(0, 0, 0, 0)
  const minutesByDay = new Map<string, number>()
  const mRows = db
    .prepare(
      `SELECT date(started_at/1000,'unixepoch','localtime') d, SUM(seconds)/60.0 m
       FROM sessions WHERE started_at >= ? GROUP BY d`
    )
    .all(from.getTime()) as { d: string; m: number }[]
  for (const r of mRows) minutesByDay.set(r.d, Math.round(r.m))
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(today)
    dt.setDate(dt.getDate() - i)
    const key = fmt(dt)
    last14.push({ date: key, minutes: minutesByDay.get(key) ?? 0 })
  }

  const topBooks = (
    db
      .prepare(
        `SELECT b.id, b.title, SUM(s.seconds) sec
         FROM sessions s JOIN books b ON b.id = s.book_id
         GROUP BY s.book_id ORDER BY sec DESC LIMIT 5`
      )
      .all() as { id: string; title: string; sec: number }[]
  ).map((r) => ({ id: r.id, title: r.title, seconds: r.sec }))

  return {
    totalBooks,
    finishedBooks,
    readingBooks,
    totalSeconds: agg.s,
    totalPagesRead: agg.p,
    annotationCount,
    bookmarkCount,
    streakDays,
    last14,
    topBooks
  }
}

// ---------- إعدادات ----------

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  )
}
