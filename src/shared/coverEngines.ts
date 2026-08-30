/**
 * محركات البحث عن صور الأغلفة من الويب — كود مشترك بين سطح المكتب (Electron main)
 * ونسخة الجوال (Capacitor shim) لتفادي الازدواجية.
 *
 * المحركات بالترتيب:
 *  1) Google Images (HTML) — يعمل من شبكات المستخدمين المنزلية؛ قد يُحجب من مراكز البيانات
 *  2) DuckDuckGo Images (i.js) — JSON نظيف بروابط الحجم الكامل، يعمل من معظم الشبكات
 *  3) Google Books API  (نفس آلية الجلب التلقائي)
 *  4) Open Library Search
 *
 * كل محرك يعمل باستقلالية — فشل أحدها لا يؤثر على البقية.
 */

export interface WebImage {
  /** رابط مصغّرة للعرض السريع في الشبكة */
  thumb: string
  /** رابط الحجم الكامل (ما سيُنزَّل فعلًا) */
  full: string
  w: number
  h: number
  source: 'google-images' | 'duckduckgo' | 'google-books' | 'openlibrary'
  title?: string
}

/** محوّل جلب محايد: نص / بايتات — تمرَّر من البيئة المستدعية */
export interface FetchAdapter {
  fetchText(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string>
  fetchBytes(
    url: string,
    headers?: Record<string, string>,
    timeoutMs?: number
  ): Promise<{ buf: Uint8Array; contentType: string }>
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function clampQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim().slice(0, 120)
}

// ============================================================
// 1) Google Images — تحليل HTML نتائج udm=2
// ============================================================

/** استخراج روابط الصور الأصلية + المصغرات من صفحة Google Images */
export function parseGoogleImagesHtml(html: string, limit = 40): WebImage[] {
  const out: WebImage[] = []
  const seen = new Set<string>()

  // المسار الموثوق: روابط imgres تحمل imgurl= (الرابط الأصلي بالحجم الكامل)
  const imgres = /\/imgres\?[^"'\s]*?imgurl=([^&"'\s]+)/g
  let m: RegExpExecArray | null
  while ((m = imgres.exec(html)) && out.length < limit) {
    const full = decodeURIComponent(m[1])
    if (!/^https?:\/\//i.test(full) || seen.has(full)) continue
    seen.add(full)
    out.push({ thumb: full, full, w: 0, h: 0, source: 'google-images' })
  }

  // بديل: أزواج [url, w, h] داخل بيانات الصفحة المضمّنة + المصغرات gstatic
  if (out.length < 8) {
    const urls: string[] = []
    const urlRe = /(?:^|[,\[])"(https?:\/\/(?!encrypted-tbn|www\.google|gstatic|googleusercontent)[^"\\]+\.(?:jpg|jpeg|png|webp)(?:\?[^"\\]*)?)"/gi
    while ((m = urlRe.exec(html)) && urls.length < 60) {
      const u = m[1]
      if (!seen.has(u)) {
        seen.add(u)
        urls.push(u)
      }
    }
    const thumbs: string[] = []
    const tbnRe = /https:\/\/encrypted-tbn\d\.gstatic\.com\/images\?[^"'\\\s]+/g
    while ((m = tbnRe.exec(html)) && thumbs.length < 60) thumbs.push(m[0])
    for (let i = 0; i < urls.length && out.length < limit; i++) {
      out.push({
        thumb: thumbs[i] ?? urls[i],
        full: urls[i],
        w: 0,
        h: 0,
        source: 'google-images'
      })
    }
  }
  return out
}

async function googleImages(adapter: FetchAdapter, q: string): Promise<WebImage[]> {
  try {
    const html = await adapter.fetchText(
      `https://www.google.com/search?q=${encodeURIComponent(q)}&udm=2&hl=ar&tbs=isz:l`,
      { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8' },
      12000
    )
    return parseGoogleImagesHtml(html)
  } catch {
    return []
  }
}

// ============================================================
// 2) DuckDuckGo Images — vqd token ثم i.js
// ============================================================

async function duckduckgo(adapter: FetchAdapter, q: string): Promise<WebImage[]> {
  try {
    const home = await adapter.fetchText(
      `https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`,
      { 'User-Agent': UA },
      12000
    )
    const vqd = /vqd="([\d-]+)"/.exec(home)?.[1] ?? /vqd=([\d-]+)&/.exec(home)?.[1]
    if (!vqd) return []
    const data = (await adapter.fetchText(
      `https://duckduckgo.com/i.js?l=ar-eg&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,&p=1`,
      { 'User-Agent': UA, Referer: 'https://duckduckgo.com/' },
      12000
    )) as unknown as string
    let json: { results?: Array<{ image?: string; thumbnail?: string; width?: number; height?: number; title?: string }> }
    try {
      json = JSON.parse(data)
    } catch {
      return []
    }
    const out: WebImage[] = []
    for (const r of json.results ?? []) {
      if (!r.image) continue
      out.push({
        thumb: r.thumbnail || r.image,
        full: r.image,
        w: r.width ?? 0,
        h: r.height ?? 0,
        source: 'duckduckgo',
        title: r.title
      })
      if (out.length >= 40) break
    }
    return out
  } catch {
    return []
  }
}

// ============================================================
// 3) Google Books API
// ============================================================

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

interface GBookItem {
  volumeInfo?: {
    imageLinks?: Record<string, string>
    title?: string
    authors?: string[]
  }
}

async function googleBooks(adapter: FetchAdapter, q: string): Promise<WebImage[]> {
  try {
    const raw = await adapter.fetchText(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books`,
      { 'User-Agent': UA },
      10000
    )
    const gb = JSON.parse(raw) as { items?: GBookItem[] }
    const out: WebImage[] = []
    for (const it of gb.items ?? []) {
      const vi = it.volumeInfo
      if (!vi?.imageLinks) continue
      const link =
        vi.imageLinks.extraLarge ||
        vi.imageLinks.large ||
        vi.imageLinks.medium ||
        vi.imageLinks.thumbnail ||
        vi.imageLinks.smallThumbnail
      if (!link) continue
      const variants = googleUrlVariants(link)
      out.push({
        thumb: variants[0],
        full: variants[0],
        w: 0,
        h: 0,
        source: 'google-books',
        title: vi.title
      })
      if (out.length >= 12) break
    }
    return out
  } catch {
    return []
  }
}

// ============================================================
// 4) Open Library
// ============================================================

interface OLDoc {
  cover_i?: number
  title?: string
}

async function openLibrary(adapter: FetchAdapter, q: string): Promise<WebImage[]> {
  try {
    const raw = await adapter.fetchText(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(q)}&limit=8&fields=cover_i,title`,
      { 'User-Agent': UA },
      10000
    )
    const ol = JSON.parse(raw) as { docs?: OLDoc[] }
    const out: WebImage[] = []
    for (const d of ol.docs ?? []) {
      if (!d.cover_i) continue
      out.push({
        thumb: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg?default=false`,
        full: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`,
        w: 0,
        h: 0,
        source: 'openlibrary',
        title: d.title
      })
      if (out.length >= 8) break
    }
    return out
  } catch {
    return []
  }
}

/** تنظيف الاستعلام من مخلفات أسماء الملفات (نسخة مبسطة من cleanQueryPart في main) */
export function buildCoverQuery(title: string, author?: string | null): string {
  const clean = (s: string): string =>
    s
      .replace(/\.(pdf|epub|mobi|azw3?|cbz?|docx?)$/i, '')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      .replace(/[_\-–—|,.:;!?'"«»/\\]+/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const t = clean(title)
  const a = author ? clean(author) : ''
  return clampQuery(a ? `${t} ${a}` : t)
}

/**
 * البحث الموحّد: المحركات الأربعة بالتوازي، ثم الدمج بالتناوب
 * (كل مصدر يظهر مبكرًا في الشبكة بدل حصر النتائج بمحرك واحد)
 */
export async function searchWebImages(
  adapter: FetchAdapter,
  rawTitle: string,
  author?: string | null
): Promise<WebImage[]> {
  const q = buildCoverQuery(rawTitle, author)
  if (q.length < 2) return []
  const [gi, dd, gbooks, ol] = await Promise.all([
    googleImages(adapter, q),
    duckduckgo(adapter, q),
    googleBooks(adapter, q),
    openLibrary(adapter, q)
  ])
  const buckets = [gi, dd, gbooks, ol]
  const out: WebImage[] = []
  const seen = new Set<string>()
  const keyOf = (r: WebImage): string => r.full.replace(/[?#].*$/, '').slice(0, 140)
  // دمج بالتناوب حتى 48 نتيجة
  for (let i = 0; out.length < 48 && i < 24; i++) {
    for (const b of buckets) {
      const item = b[i]
      if (!item) continue
      const k = keyOf(item)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(item)
      if (out.length >= 48) break
    }
  }
  return out
}
