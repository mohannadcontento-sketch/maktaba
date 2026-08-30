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
      // آلية الأغلفة المحسّنة: إن لم يوجد غلاف مدمج نجلبه تلقائيًا من الويب بالخلفية
      if (!patch.coverPath) {
        const finalTitle = (patch.title as string) ?? cleanTitleFromFileName(filePath)
        const finalAuthor = (patch.author as string) ?? undefined
        queueAutoCover(id, finalTitle, finalAuthor)
      }
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

// ============================================================
// آلية البحث عن الأغلفة من الويب — النسخة المحسّنة (2.1)
// ============================================================
// تحسينات على الآلية القديمة:
//  1) استعلامات متعددة مرتبة: (عنوان + مؤلف) ثم (عنوان) ثم (أول 5 كلمات) —
//     مع تنظيف التشكيل والرموز والسنوات والامتدادات القادمة من أسماء الملفات
//  2) المصادر تعمل بالتوازي (Google Books + Open Library) بدل التسلسل البطيء
//  3) ترشيح النتائج بتسجيل نقاط: تطابق العنوان + تطابق المؤلف — لا نأخذ «أول نتيجة» أعمى
//  4) التحقق من الصورة الفعلية: قراءة الأبعاد من ترويسة JPEG/PNG ورفض الفارغة 1×1
//     والصغيرة جدًا وغير النسبية — إن فشل مرشح جُرّب التالي تلقائيًا
//  5) احتياطيات التنزيل: zoom=3→2→1 لجوجل، L→M لمكتبة مفتوحة (مع default=false
//     لإرجاع 404 بدل صورة 1×1 الفارغة عند غياب الغلاف)
//  6) ذاكرة سلبية 10 دقائق: الكتاب الذي فشل جلب غلافه لا يُعاد البحث عنه فورًا مجددًا
//  7) جلب تلقائي متسلسل بعد استيراد EPUB بلا غلاف مدمج (طابور لا يغرق الشبكة)

interface CoverCandidate {
  urls: string[] // بالترتيب: الأفضل أولًا ثم الاحتياطيات
  score: number
  source: 'google' | 'openlibrary'
}

/** تنظيف جزء من الاستعلام (عنوان/مؤلف) من مخلفات أسماء الملفات والتشكيل */
function cleanQueryPart(s: string): string {
  return s
    .replace(/\.(pdf|epub|mobi|azw3?|cbz?|docx?)$/i, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // تشكيل + تطويل
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ') // ما بين الأقواس (نسخة/جودة/سنة…)
    .replace(/[_\-–—|,.:;!?'"«»/\\]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ') // سنوات مستقلة
    .replace(/\s+/g, ' ')
    .trim()
}

/** تطبيع عربي/لاتيني أساسي للمقارنة (إزالة التشكيل وتوحيد الهمزات) */
function norm(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .trim()
}

/** كلمات مطبعة للمقارنة (تجاهل كلمة الحرف الواحدة) */
function tokens(s: string): Set<string> {
  return new Set(norm(s).split(/\s+/).filter((w) => w.length > 1))
}

/** درجة تغطية عنوان النتيجة لعنوان الكتاب المطلوب (0..1) */
function titleSimilarity(want: string, got: string | undefined): number {
  if (!got) return 0
  const A = tokens(want)
  const B = tokens(got)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

/** نقاط النتيجة: تطابق العنوان 0.7 + تطابق المؤلف 0.3 */
function scoreResult(
  wantTitle: string,
  wantAuthor: string | null | undefined,
  gotTitle?: string,
  gotAuthors?: string[]
): number {
  let s = titleSimilarity(wantTitle, gotTitle) * 0.7
  if (wantAuthor && gotAuthors?.length) {
    const wa = tokens(wantAuthor)
    let hit = false
    for (const ra of gotAuthors) {
      const rb = tokens(ra)
      for (const t of wa) if (rb.has(t)) hit = true
    }
    if (hit) s += 0.3
  }
  return s
}

/** استعلامات مرشحة بالترتيب (بدون تكرار) */
function buildQueries(title: string, author?: string | null): string[] {
  const t = cleanQueryPart(title)
  const a = author ? cleanQueryPart(author) : ''
  const list: string[] = []
  if (t && a) list.push(`${t} ${a}`)
  if (t) list.push(t)
  const shortT = t.split(/\s+/).slice(0, 5).join(' ')
  if (shortT && shortT !== t) list.push(shortT)
  return [...new Set(list)].filter((q) => q.length >= 2).slice(0, 3)
}

/** رفع دقة صورة Google Books إلى أكبر مقاس متاح + توليد الاحتياطيات */
function googleUrlVariants(link: string): string[] {
  const base = link.replace('http://', 'https://').replace('&edge=curl', '')
  const out: string[] = []
  for (const zoom of ['3', '2', '1']) {
    let u = base
    if (/zoom=\d/.test(u)) u = u.replace(/zoom=\d/, `zoom=${zoom}`)
    else u += `&zoom=${zoom}`
    if (!out.includes(u)) out.push(u)
  }
  return out
}

/** جمع مرشحين من Google Books عبر الاستعلامات (نتوقف مبكرًا عند الوفرة) */
async function collectGoogle(
  queries: string[],
  wantTitle: string,
  wantAuthor: string | null | undefined
): Promise<CoverCandidate[]> {
  const out: CoverCandidate[] = []
  for (const q of queries) {
    try {
      const gb = await fetchJson(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books`,
        8000
      )
      const items: unknown[] = (gb as { items?: unknown[] })?.items ?? []
      for (const it of items) {
        const vi = (it as { volumeInfo?: { imageLinks?: Record<string, string>; title?: string; authors?: string[] } })
          .volumeInfo
        if (!vi) continue
        const link =
          vi.imageLinks?.extraLarge ||
          vi.imageLinks?.large ||
          vi.imageLinks?.medium ||
          vi.imageLinks?.thumbnail ||
          vi.imageLinks?.smallThumbnail
        if (!link) continue
        const score = scoreResult(wantTitle, wantAuthor, vi.title, vi.authors) + 0.05 // أفضلية مصدر بسيطة
        out.push({ urls: googleUrlVariants(link), score, source: 'google' })
      }
      if (out.length >= 6) break
    } catch {
      /* المصدر تعذر على هذا الاستعلام — ننتقل للتالي */
    }
  }
  return out
}

/** جمع مرشحين من Open Library (default=false يمنع الصور الفارغة) */
async function collectOpenLibrary(
  queries: string[],
  wantTitle: string,
  wantAuthor: string | null | undefined
): Promise<CoverCandidate[]> {
  const out: CoverCandidate[] = []
  for (const q of queries) {
    // openlibrary يفصل البحث: العنوان في حقل title والباقي (المؤلف) في author
    const t = cleanQueryPart(q)
    if (!t) continue
    try {
      const ol = await fetchJson(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(t)}&limit=8&fields=cover_i,title,author_name`,
        8000
      )
      const docs: Array<{ cover_i?: number; title?: string; author_name?: string[] }> =
        (ol as { docs?: Array<{ cover_i?: number; title?: string; author_name?: string[] }> })?.docs ?? []
      for (const d of docs) {
        if (!d.cover_i || typeof d.cover_i !== 'number') continue
        const score = scoreResult(wantTitle, wantAuthor, d.title, d.author_name)
        out.push({
          urls: [
            `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`,
            `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg?default=false`
          ],
          score,
          source: 'openlibrary'
        })
      }
      if (out.length >= 6) break
    } catch {
      /* المصدر تعذر — ننتقل للتالي */
    }
  }
  return out
}

/**
 * جمع أفضل مرشحي الأغلفة: تشغيل المصدرين بالتوازي ثم ترتيب تنازلي بالنقاط.
 * نحتفظ بالمرشحين الجيدين (score ≥ 0.35) وإن لم يوجد أيٌّها نأخذ أعلى نتيجتين على أي حال.
 * ميزانية زمنية إجمالية (18 ثانية) حتى لا يعلق البحث على شبكة بطيئة أو مصدر عالق.
 */
const COVER_SEARCH_BUDGET_MS = 18000

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('cover search budget exceeded')), ms))
  ])
}

async function collectCoverCandidates(title: string, author?: string | null): Promise<CoverCandidate[]> {
  const queries = buildQueries(title, author)
  if (!queries.length) return []
  const wantTitle = cleanQueryPart(title)
  const [gRes, oRes] = await Promise.allSettled([
    withDeadline(collectGoogle(queries, wantTitle, author), COVER_SEARCH_BUDGET_MS),
    withDeadline(collectOpenLibrary(queries, wantTitle, author), COVER_SEARCH_BUDGET_MS)
  ])
  const all = [...(gRes.status === 'fulfilled' ? gRes.value : []), ...(oRes.status === 'fulfilled' ? oRes.value : [])]
  // إزالة التكرار حسب أول رابط مع الاحتفاظ بأعلى نقاط
  const byUrl = new Map<string, CoverCandidate>()
  for (const c of all) {
    const key = c.urls[0]
    const prev = byUrl.get(key)
    if (!prev || c.score > prev.score) byUrl.set(key, c)
  }
  const sorted = [...byUrl.values()].sort((a, b) => b.score - a.score)
  const good = sorted.filter((c) => c.score >= 0.35)
  return good.length ? good : sorted.slice(0, 2)
}

/**
 * قراءة أبعاد الصورة من الترويسة (PNG: IHDR، JPEG: علامات SOF) — دون فك ترميز كامل
 */
export function imageDims(buf: Buffer): { w: number; h: number } | null {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++
          continue
        }
        const marker = buf[off + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2
          continue
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) }
        }
        const len = buf.readUInt16BE(off + 2)
        if (len < 2) return null
        off += 2 + len
      }
    }
  } catch {
    /* ترويسة غير مفهومة */
  }
  return null
}

/** هل Buffer صورة غلاف مقبولة؟ (حجم + أبعاد + نسبة أبعاد معقولة) */
export function validCoverImage(buf: Buffer): boolean {
  if (buf.length < 2000) return false
  const d = imageDims(buf)
  if (!d) return buf.length > 8000 // صيغة غير معروفة: نقبلها فقط إن كان حجمها معقولًا
  if (d.w < 120 || d.h < 160) return false // أصغر من غلاف كتاب معقول
  const r = d.w / d.h
  return r > 0.25 && r < 3 // أغلفة الكتب قريبة من الطولي
}

/** تنزيل صورة من رابط إلى Buffer مع فحص نوع المحتوى */
export async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Maktaba/2.1' },
      signal: AbortSignal.timeout(9000)
    })
    if (!res.ok) return null
    const ctype = res.headers.get('content-type') ?? ''
    if (ctype && !ctype.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!validCoverImage(buf)) return null
    return buf
  } catch {
    return null
  }
}

/**
 * تنزيل صورة مختارة يدويًا من منتقي الأغلفة — تحقق مخفف:
 * نحترم اختيار المستخدم فلا نرفض بالنسبة أو الأبعاد، فقط نتأكد أنها صورة حقيقية غير فارغة
 */
export async function downloadImageRelaxed(url: string): Promise<Buffer | null> {
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const ctype = res.headers.get('content-type') ?? ''
    if (ctype && !ctype.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) return null
    const d = imageDims(buf)
    if (d && (d.w < 32 || d.h < 32)) return null // أبعاد وهمية/عنصر زخرفي
    return buf
  } catch {
    return null
  }
}

/**
 * تنزيل صورة مختارة يدويًا وحفظها غلافًا للكتاب — يعيد الكتاب بعد التحديث
 */
export async function useWebImageForBook(bookId: string, url: string): Promise<ReturnType<typeof getBook>> {
  const buf = await downloadImageRelaxed(url)
  if (!buf) return null
  const ext = buf[0] === 0x89 ? 'png' : 'jpg'
  const file = path.join(coversDir(), `${bookId}.${ext}`)
  fs.writeFileSync(file, buf)
  updateBook(bookId, { coverPath: file })
  const { getBook } = await import('./db')
  return getBook(bookId)
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await net.fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 Maktaba/2.1' },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`status ${res.status}`)
  return res.json()
}

/**
 * البحث عن غلاف للكتاب من مصادر الويب — يُرجع رابط الصورة الأفضل أو null
 */
export async function searchCoverUrl(title: string, author?: string | null): Promise<string | null> {
  const candidates = await collectCoverCandidates(title, author)
  const deadline = Date.now() + 15000
  for (const c of candidates) {
    for (const url of c.urls) {
      if (Date.now() > deadline) return null
      // تحقق سريع من قابلية التنزيل — أول رابط ناجح يُعاد
      const buf = await downloadImage(url)
      if (buf) return url
    }
  }
  return null
}

/**
 * جلب أفضل غلاف للكتاب من الويب وحفظه في مجلد الأغلفة
 * يُرجع مسار الملف المحفوظ أو null — مع سلسلة مرشحين واحتياطيات وذاكرة سلبية
 */
const coverNegativeCache = new Map<string, number>()

export async function fetchAndSaveCover(
  bookId: string,
  title: string,
  author?: string | null
): Promise<string | null> {
  const key = `${norm(title)}|${norm(author ?? '')}`
  const blockedUntil = coverNegativeCache.get(key) ?? 0
  if (Date.now() < blockedUntil) return null

  const candidates = await collectCoverCandidates(title, author)
  const dlDeadline = Date.now() + 15000 // ميزانية التنزيل كاملة
  for (const c of candidates.slice(0, 4)) {
    for (const url of c.urls) {
      if (Date.now() > dlDeadline) return null
      const buf = await downloadImage(url)
      if (!buf) continue
      const ext = buf[0] === 0x89 ? 'png' : 'jpg'
      const file = path.join(coversDir(), `${bookId}.${ext}`)
      try {
        fs.writeFileSync(file, buf)
      } catch {
        continue
      }
      coverNegativeCache.delete(key)
      updateBook(bookId, { coverPath: file })
      return file
    }
  }

  // فشل: لا نكرر البحث لنفس الكتاب خلال 10 دقائق
  coverNegativeCache.set(key, Date.now() + 10 * 60 * 1000)
  return null
}

// ---------- الجلب التلقائي للأغلفة بعد الاستيراد (طابور متسلسل) ----------

interface AutoCoverJob {
  bookId: string
  title: string
  author?: string | null
}

const autoCoverQueue: AutoCoverJob[] = []
let autoCoverRunning = false

/** هل العنوان صالح للبحث؟ (نرفض أسماء ملفات عشوائية بلا كلمات حقيقية) */
function searchableTitle(title: string): boolean {
  const t = cleanQueryPart(title)
  if (t.length < 3) return false
  return /[A-Za-z\u0600-\u06FF]{2,}/.test(t)
}

/** إضافة كتاب لطابور الجلب التلقائي (يعمل في الخلفية ولا يعطّل الاستيراد) */
export function queueAutoCover(bookId: string, title: string, author?: string | null): void {
  if (!searchableTitle(title)) return
  autoCoverQueue.push({ bookId, title, author })
  void pumpAutoCover()
}

async function pumpAutoCover(): Promise<void> {
  if (autoCoverRunning) return
  autoCoverRunning = true
  try {
    while (autoCoverQueue.length) {
      const job = autoCoverQueue.shift()
      if (!job) break
      try {
        await fetchAndSaveCover(job.bookId, job.title, job.author)
      } catch {
        /* فشل غير حرج — نكمل البقية */
      }
      // مهلة قصيرة بين الطلبات أدبًا مع المصادر
      await new Promise((r) => setTimeout(r, 500))
    }
  } finally {
    autoCoverRunning = false
  }
}
