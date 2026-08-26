import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'
import { net } from 'electron'
import {
  findDuplicate,
  insertBook,
  deleteBookRow,
  updateBook
} from './db'
import type { Book } from '../shared/types'

export function libraryDir(): string {
  const dir = path.join(app.getPath('userData'), 'library')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function coversDir(): string {
  const dir = path.join(app.getPath('userData'), 'covers')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function bookFilePath(fileName: string): string {
  return path.join(libraryDir(), fileName)
}

function cleanTitleFromFileName(name: string): string {
  return path
    .basename(name)
    .replace(/\.(pdf|epub)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** استخراج البيانات الوصفية والغلاف من ملف EPUB */
export function extractEpubMeta(absPath: string): {
  title?: string
  author?: string
  language?: string
  publisher?: string
  pubDate?: string
  description?: string
  coverData?: Buffer
} {
  try {
    const zip = new AdmZip(absPath)
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

    // META-INF/container.xml → مسار OPF
    const containerEntry = zip.getEntry('META-INF/container.xml')
    if (!containerEntry) return {}
    const container = parser.parse(containerEntry.getData().toString('utf8'))
    const rootfiles = container?.container?.rootfiles?.rootfile
    const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles
    const opfPath: string | undefined = rootfile?.['@_full-path']
    if (!opfPath) return {}

    const opfEntry = zip.getEntry(opfPath)
    if (!opfEntry) return {}
    const opf = parser.parse(opfEntry.getData().toString('utf8'))
    const pkg = opf?.package
    if (!pkg) return {}

    // عناصر XML قد تحمل خصائص فتصبح كائنات ({'#text': ...}) — نستخرج النص دائمًا
    const first = (v: unknown): string | undefined => {
      if (v == null) return undefined
      const item: unknown = Array.isArray(v) ? v[0] : v
      if (item != null && typeof item === 'object') {
        return first((item as Record<string, unknown>)['#text'])
      }
      const s = String(item).trim()
      return s || undefined
    }

    const metadata = pkg.metadata
    const title = first(metadata?.['dc:title'])
    const author = first(metadata?.['dc:creator'])
    const language = first(metadata?.['dc:language'])
    const publisher = first(metadata?.['dc:publisher'])
    const pubDate = first(metadata?.['dc:date']) ?? first(metadata?.['dc:issued'])
    let description = first(metadata?.['dc:description'])
    if (description) description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    // الغلاف: من meta name="cover" أو item properties="cover-image"
    let coverHref: string | undefined
    const manifestItems = pkg.manifest?.item
    const items = Array.isArray(manifestItems) ? manifestItems : manifestItems ? [manifestItems] : []
    for (const it of items) {
      const props: string = it?.['@_properties'] ?? ''
      if (props.includes('cover-image')) {
        coverHref = it['@_href']
        break
      }
    }
    if (!coverHref) {
      const metas = pkg.metadata?.meta
      const metaList = Array.isArray(metas) ? metas : metas ? [metas] : []
      const coverMeta = metaList.find((m: Record<string, unknown>) => m?.['@_name'] === 'cover')
      if (coverMeta) {
        const coverId = coverMeta['@_content'] as string
        const it = items.find((i: Record<string, unknown>) => i['@_id'] === coverId)
        if (it) coverHref = it['@_href'] as string
      }
    }

    let coverData: Buffer | undefined
    if (coverHref) {
      const base = path.posix.dirname(opfPath)
      const fullCoverPath = path.posix.normalize(path.posix.join(base === '.' ? '' : base, decodeURIComponent(coverHref)))
      const entry = zip.getEntry(fullCoverPath) ?? zip.getEntry(coverHref)
      if (entry && !entry.isDirectory) coverData = entry.getData()
    }

    return { title, author, language, publisher, pubDate, description, coverData }
  } catch {
    return {}
  }
}

export interface ImportResult {
  book: Book | null
  duplicateOf?: string
}

async function importOne(filePath: string): Promise<ImportResult> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.pdf' && ext !== '.epub') return { book: null }
  const stat = fs.statSync(filePath)
  const dup = findDuplicate(stat.size, filePath)
  if (dup) return { book: null, duplicateOf: dup }

  const format = ext === '.pdf' ? 'pdf' : 'epub'
  const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`
  fs.copyFileSync(filePath, bookFilePath(fileName))
  const id = insertBook({
    title: cleanTitleFromFileName(filePath),
    format,
    fileName,
    originalPath: filePath,
    size: stat.size
  })

  if (format === 'epub') {
    try {
      const meta = extractEpubMeta(filePath)
      const patch: Record<string, unknown> = {}
      if (meta.title) patch.title = meta.title
      if (meta.author) patch.author = meta.author
      if (meta.language) patch.language = meta.language
      if (meta.publisher) patch.publisher = meta.publisher
      if (meta.pubDate) patch.pubDate = meta.pubDate
      if (meta.description) patch.description = meta.description
      if (meta.coverData) {
        const ext2 = meta.coverData[0] === 0x89 ? 'png' : 'jpg'
        const coverFile = path.join(coversDir(), `${id}.${ext2}`)
        fs.writeFileSync(coverFile, meta.coverData)
        patch.coverPath = coverFile
      }
      if (Object.keys(patch).length) updateBook(id, patch)
    } catch {
      // بيانات وصفية غير حرجة
    }
  }
  // PDF: تُستخرج بياناته وغلافه في الواجهة عبر pdf.js ثم تُحفظ عبر IPC

  const { getBook } = await import('./db')
  return { book: getBook(id) }
}

export async function importPaths(paths: string[]): Promise<Book[]> {
  const imported: Book[] = []
  for (const p of paths) {
    try {
      const res = await importOne(p)
      if (res.book) imported.push(res.book)
    } catch (e) {
      console.error('import failed:', p, e)
    }
  }
  return imported
}

/** مسح مجلد بشكل تكراري بحثًا عن pdf/epub */
export function scanFolderForBooks(dir: string, depth = 0): string[] {
  if (depth > 6) return []
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) out.push(...scanFolderForBooks(full, depth + 1))
    } else if (/\.(pdf|epub)$/i.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

export function removeBookFiles(fileName: string, coverPath: string | null): void {
  try {
    const f = bookFilePath(fileName)
    if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch {
    /* ignore */
  }
  if (coverPath && coverPath.startsWith(coversDir())) {
    try {
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath)
    } catch {
      /* ignore */
    }
  }
  void deleteBookRow
}

/**
 * البحث عن غلاف للكتاب من مصادر الويب (Google Books ثم Open Library)
 * يُرجع رابط صورة الغلاف الأفضل أو null
 */
export async function searchCoverUrl(title: string, author?: string | null): Promise<string | null> {
  const q = [title, author].filter(Boolean).join(' ').trim()
  if (!q) return null
  try {
    // 1) Google Books
    const gb = await fetchJson(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&country=EG`
    )
    const items: unknown[] = (gb as { items?: unknown[] })?.items ?? []
    for (const it of items) {
      const vi = (it as { volumeInfo?: { imageLinks?: Record<string, string>; title?: string; authors?: string[] } }).volumeInfo
      if (!vi) continue
      const link =
        vi.imageLinks?.thumbnail ||
        vi.imageLinks?.smallThumbnail ||
        vi.imageLinks?.medium ||
        vi.imageLinks?.large
      if (link) return link.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=3')
    }
  } catch {
    /* تجاهل والانتقال لـ Open Library */
  }
  try {
    // 2) Open Library (حسب العنوان)
    const ol = await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=5`)
    const docs: Array<{ cover_i?: number; title?: string; author_name?: string[] }> =
      (ol as { docs?: Array<{ cover_i?: number }> })?.docs ?? []
    let best: number | null = null
    for (const d of docs) {
      if (d.cover_i && typeof d.cover_i === 'number') {
        // تفضيل التطابق في المؤلف إن وُجد
        if (author && d.author_name?.some((a) => a.toLowerCase().includes(String(author).toLowerCase().split(' ')[0]))) {
          best = d.cover_i
          break
        }
        if (best == null) best = d.cover_i
      }
    }
    if (best != null) return `https://covers.openlibrary.org/b/id/${best}-L.jpg`
  } catch {
    /* تجاهل */
  }
  return null
}

/** تنزيل صورة من رابط إلى Buffer */
export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'Maktaba/1.0' } })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) return null // صورة تالفة/فارغة
    return buf
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Maktaba/1.0' } })
  if (!res.ok) throw new Error(`status ${res.status}`)
  return res.json()
}

/**
 * جلب أفضل غلاف للكتاب من الويب وحفظه في مجلد الأغلفة
 * يُرجع مسار الملف المحفوظ أو null
 */
export async function fetchAndSaveCover(bookId: string, title: string, author?: string | null): Promise<string | null> {
  const url = await searchCoverUrl(title, author)
  if (!url) return null
  const buf = await downloadImage(url)
  if (!buf) return null
  const ext = buf[0] === 0x89 ? 'png' : 'jpg'
  const file = path.join(coversDir(), `${bookId}.${ext}`)
  fs.writeFileSync(file, buf)
  updateBook(bookId, { coverPath: file })
  return file
}

