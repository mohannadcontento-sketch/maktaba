/**
 * البحث النصي داخل كتب EPUB
 * يجتاز أقسام الكتاب (spine) ويبحث في كل فقرة مع تطبيع عربي،
 * ثم يولّد CFI نطاقي دقيق لكل مطابقة عبر EpubCFI.fromRange
 */
import { Book as EpubBook, EpubCFI } from 'epubjs'
import { normalizeText } from './utils'

export interface EpubSearchMatch {
  cfi: string // CFI نطاقي epubcfi(..., ..., ...)
  pointCfi: string // CFI نقطي للعرض السريع
  excerpt: string // نص مقتطف حول المطابقة
  section: string // عنوان القسم إن توفر
  spineIndex: number
}

interface TextPos {
  node: Text
  start: number // موضع البداية داخل النص المجمع للفقرة
  end: number
}

const MAX_MATCHES = 300
const EXCERPT_PAD = 45

/** بناء خريطة مواضع عقد النص داخل عنصر فقرة */
function collectTextPositions(el: Element): { full: string; positions: TextPos[] } {
  const walker = el.ownerDocument!.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const positions: TextPos[] = []
  let full = ''
  let cur: Node | null = walker.nextNode()
  while (cur) {
    const t = cur as Text
    const v = t.nodeValue ?? ''
    if (v.length) {
      positions.push({ node: t, start: full.length, end: full.length + v.length })
      full += v
    }
    cur = walker.nextNode()
  }
  return { full, positions }
}

/** تحويل موضعين في النص المجمع إلى Range حقيقي */
function rangeFromOffsets(
  doc: Document,
  positions: TextPos[],
  startOff: number,
  endOff: number
): Range | null {
  try {
    let startNode: Text | null = null
    let startNodeOff = 0
    let endNode: Text | null = null
    let endNodeOff = 0
    for (const p of positions) {
      if (!startNode && startOff < p.end) {
        startNode = p.node
        startNodeOff = Math.max(0, startOff - p.start)
      }
      if (startNode && endOff <= p.end) {
        endNode = p.node
        endNodeOff = Math.max(0, endOff - p.start)
        break
      }
    }
    if (!startNode || !endNode) return null
    const r = doc.createRange()
    r.setStart(startNode, Math.min(startNodeOff, startNode.length))
    r.setEnd(endNode, Math.min(endNodeOff, endNode.length))
    return r
  } catch {
    return null
  }
}

/** عناصر الكتل التي تحمل نصًا قابلًا للقراءة */
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, div, pre, dd, dt'

function iteratableBlocks(doc: Document): Element[] {
  const out: Element[] = []
  const all = doc.body?.querySelectorAll(BLOCK_SELECTOR) ?? []
  for (const el of Array.from(all)) {
    // نستبعد الحاويات التي تحوي فقرات داخلية (نبحث في الفقرات الدقيقة فقط)
    if (el.querySelector('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6')) continue
    if ((el.textContent ?? '').trim()) out.push(el)
  }
  // أقسام بلا أي عناصر كتل (نص مباشر في body)
  if (!out.length && (doc.body?.textContent ?? '').trim() && doc.body) out.push(doc.body)
  return out
}

function sectionTitleFor(book: EpubBook, index: number): string {
  try {
    const item = (book.spine as unknown as { spineItems?: Array<{ index: number; href?: string }> }).spineItems?.[index]
    if (!item) return ''
    const href = item.href ?? ''
    const nav = (book as unknown as { nav?: { toc?: NavLike[] } }).nav?.toc ?? []
    const flat = flattenToc(nav)
    const hit = flat.find((n) => (n.href || '').split('#')[0] === href.split('#')[0])
    return hit?.label?.trim() ?? ''
  } catch {
    return ''
  }
}

interface NavLike {
  label?: string
  title?: string
  href?: string
  subitems?: NavLike[]
  items?: NavLike[]
}

function flattenToc(nodes: NavLike[]): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = []
  for (const n of nodes) {
    const label = n.label ?? n.title ?? ''
    if (label || n.href) out.push({ label, href: n.href ?? '' })
    for (const key of ['subitems', 'items'] as const) {
      const kids = n[key]
      if (Array.isArray(kids) && kids.length) out.push(...flattenToc(kids))
    }
  }
  return out
}

/**
 * تحويل ناتج Section.load إلى Document
 * ملاحظة: epub.js يُرجع من Section.load عنصر <html> (documentElement) وليس Document،
 * لذا نستخرج ownerDocument ليعمل doc.body و doc.querySelectorAll بشكل صحيح
 */
function asDocument(loaded: unknown): Document | null {
  if (!loaded) return null
  if (loaded instanceof Document) return loaded
  const el = loaded as Element
  if (el.ownerDocument) return el.ownerDocument
  return null
}

/**
 * البحث في كل الكتاب
 * يُحمّل كل قسم مؤقتًا ويفرّغه بعد انتهائه للحفاظ على الذاكرة
 */
export async function searchEpub(
  book: EpubBook,
  query: string,
  onProgress?: (done: number, total: number) => void
): Promise<EpubSearchMatch[]> {
  const q = normalizeText(query)
  if (!q || q.length < 2) return []
  const matches: EpubSearchMatch[] = []

  const spine = (book.spine as unknown as {
    spineItems?: SpineItemLike[]
  }).spineItems ?? []
  const total = spine.length

  for (let i = 0; i < spine.length; i++) {
    if (matches.length >= MAX_MATCHES) break
    const item = spine[i]
    let doc: Document | null = null
    try {
      doc = asDocument(await item.load(book.load.bind(book)))
    } catch {
      try {
        item.unload()
      } catch {
        /* ignore */
      }
      continue
    }
    if (!doc) {
      try {
        item.unload()
      } catch {
        /* ignore */
      }
      continue
    }

    const title = sectionTitleFor(book, i)
    try {
      for (const el of iteratableBlocks(doc)) {
        const { full, positions } = collectTextPositions(el)
        const hay = normalizeText(full)
        if (!hay.includes(q)) continue
        // كل مواضع المطابقة في هذه الفقرة (بالتطبيع قد يختلف الطول؟ التطبيع يحافظ على الطول تقريبًا)
        let idx = hay.indexOf(q)
        while (idx !== -1 && matches.length < MAX_MATCHES) {
          // نمدّ نهاية المطابقة بنفس طول الاستعلام الأصلي في النص المطبّع
          const startOff = idx
          const endOff = idx + q.length
          const excerpt =
            full.slice(Math.max(0, startOff - EXCERPT_PAD), startOff) +
            '⟪' +
            full.slice(startOff, Math.min(full.length, endOff)) +
            '⟫' +
            full.slice(Math.min(full.length, endOff), Math.min(full.length, endOff + EXCERPT_PAD))
          let cfi = ''
          let pointCfi = ''
          const range = rangeFromOffsets(doc, positions, startOff, endOff)
          if (range) {
            try {
              const gen = new EpubCFI(range, item.cfiBase)
              cfi = gen.toString()
              pointCfi = pointFromRange(cfi)
            } catch {
              /* ignore */
            }
          }
          if (cfi) {
            matches.push({ cfi, pointCfi, excerpt: excerpt.replace(/\s+/g, ' ').trim(), section: title, spineIndex: i })
          }
          idx = hay.indexOf(q, idx + Math.max(1, q.length))
        }
        if (matches.length >= MAX_MATCHES) break
      }
    } finally {
      try {
        item.unload()
      } catch {
        /* ignore */
      }
    }
    onProgress?.(i + 1, total)
    // نمنح حلقة الأحداث فرصة للتنفس حتى لا تتجمد الواجهة في الكتب الضخمة
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0))
  }
  return matches
}

/** تحويل CFI نطاقي إلى CFI نقطي: ندمج المسار الأساسي مع مسار البداية بلا فاصلة */
export function pointFromRange(rangeCfi: string): string {
  try {
    const m = /^epubcfi\((.+)\)$/.exec(rangeCfi)
    if (!m) return rangeCfi
    const inner = m[1]
    const firstComma = inner.indexOf(',')
    // لا فاصلة — CFI نقطي بالفعل
    if (firstComma === -1) return rangeCfi
    const base = inner.slice(0, firstComma)
    const secondComma = inner.indexOf(',', firstComma + 1)
    const start = secondComma === -1 ? '' : inner.slice(firstComma + 1, secondComma)
    // نقطة صحيحة: epubcfi(/6/4!/4/2/1:0) — دمج لا فصل بفاصلة (فاصلة تعني نطاقًا)
    return `epubcfi(${base}${start})`
  } catch {
    return rangeCfi
  }
}

/** فقرات القسم الحالي للقراءة الصوتية — مع CFI لكل فقرة */
export interface TtsChunk {
  text: string
  cfi: string
}

export async function collectSectionChunks(
  book: EpubBook,
  cfi: string | null
): Promise<TtsChunk[]> {
  const spine = (book.spine as unknown as { spineItems?: SpineItemLike[] }).spineItems ?? []
  if (!spine.length) return []

  let item: SpineItemLike | null = null
  if (cfi) {
    try {
      item = (book.spine.get(cfi) as unknown as SpineItemLike) ?? null
    } catch {
      item = null
    }
  }
  if (!item) item = spine[0]

  let doc: Document | null = null
  try {
    doc = asDocument(await item.load(book.load.bind(book)))
  } catch {
    try {
      item.unload()
    } catch {
      /* ignore */
    }
    return []
  }
  if (!doc) {
    try {
      item.unload()
    } catch {
      /* ignore */
    }
    return []
  }

  const chunks: TtsChunk[] = []
  try {
    for (const el of iteratableBlocks(doc)) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text || text.length < 2) continue
      try {
        const range = el.ownerDocument!.createRange()
        range.selectNodeContents(el)
        const gen = new EpubCFI(range, item!.cfiBase)
        chunks.push({ text, cfi: pointFromRange(gen.toString()) })
      } catch {
        /* فقرة بلا CFI — نتجاهلها */
      }
    }
  } finally {
    try {
      item.unload()
    } catch {
      /* ignore */
    }
  }
  return chunks
}

interface SpineItemLike {
  index: number
  href?: string
  cfiBase: string
  load(requestor?: unknown): Promise<unknown>
  unload(): void
}
