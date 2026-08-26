import * as pdfjsLib from 'pdfjs-dist'
// عامل الويب مدمج داخل الحزمة ليعمل في التطوير والإنتاج معًا
import PdfWorkerBuilder from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'

let workerReady = false
function ensureWorker(): void {
  if (workerReady) return
  try {
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorkerBuilder()
  } catch (e) {
    console.error('worker init failed', e)
  }
  workerReady = true
}

export interface TocItem {
  title: string
  page: number | null
  children: TocItem[]
}

export interface PageTextItem {
  str: string
  rect: { l: number; t: number; w: number; h: number } // نسب من أبعاد الصفحة 0..1
}

export interface LoadedDoc {
  doc: pdfjsLib.PDFDocumentProxy
  meta: { title?: string; author?: string }
}

export async function loadPdf(url: string): Promise<LoadedDoc> {
  ensureWorker()
  const task = pdfjsLib.getDocument({ url, cMapUrl: undefined, enableXfa: true })
  const doc = await task.promise
  let title: string | undefined
  let author: string | undefined
  try {
    const m = await doc.getMetadata()
    const info = m.info as { Title?: string; Author?: string } | undefined
    title = info?.Title?.trim() || undefined
    author = info?.Author?.trim() || undefined
  } catch {
    /* ignore */
  }
  return { doc, meta: { title, author } }
}

/** تحويل وجهة الفهرس إلى رقم صفحة */
export async function outlineDestToPage(
  doc: pdfjsLib.PDFDocumentProxy,
  dest: unknown
): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || !explicit.length) return null
    const ref = explicit[0]
    if (ref && typeof ref === 'object') {
      return (await doc.getPageIndex(ref as never)) + 1
    }
    if (typeof ref === 'number') return ref + 1
  } catch {
    /* ignore */
  }
  return null
}

export interface RawOutlineNode {
  title: string
  dest: unknown
  items: unknown[]
}

/** بناء شجرة الفهرس كاملة */
export async function buildToc(doc: pdfjsLib.PDFDocumentProxy): Promise<TocItem[]> {
  const raw = (await doc.getOutline()) as RawOutlineNode[] | null
  if (!raw) return []

  const convert = async (nodes: RawOutlineNode[]): Promise<TocItem[]> => {
    const out: TocItem[] = []
    for (const n of nodes) {
      out.push({
        title: n.title || '—',
        page: await outlineDestToPage(doc, n.dest),
        children: Array.isArray(n.items) && n.items.length ? await convert(n.items as RawOutlineNode[]) : []
      })
    }
    return out
  }
  return convert(raw)
}

/** توليد غلاف من الصفحة الأولى بصيغة DataURL */
export async function generateCover(doc: pdfjsLib.PDFDocumentProxy): Promise<string | null> {
  try {
    const page = await doc.getPage(1)
    const vp = page.getViewport({ scale: 300 / page.getViewport({ scale: 1 }).width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

/** بحث نصي عبر كل المستند مع تطبيع عربي */
export function normalizeForSearch(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
}

export interface SearchMatch {
  page: number
  itemIndex: number
  normIndex: number
}

export interface MatchBox {
  l: number
  t: number
  w: number
  h: number
}

/** إيجاد مطابقات نص صفحة وإرجاع صناديقها النسبية */
export function findMatchesInItems(
  items: PageTextItem[],
  query: string,
  page: number,
  startIndex = 0
): { matches: SearchMatch[]; boxes: MatchBox[] } {
  const q = normalizeForSearch(query)
  const matches: SearchMatch[] = []
  const boxes: MatchBox[] = []
  if (!q) return { matches, boxes }

  items.forEach((item, idx) => {
    const hay = normalizeForSearch(item.str)
    let pos = hay.indexOf(q)
    while (pos !== -1) {
      matches.push({ page, itemIndex: idx, normIndex: pos + startIndex })
      boxes.push(item.rect)
      pos = hay.indexOf(q, pos + q.length)
    }
  })
  return { matches, boxes }
}

/** استخراج عناصر نص صفحة مع مستطيلات نسبية */
export async function extractPageText(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<PageTextItem[]> {
  const page = await doc.getPage(pageNum)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const out: PageTextItem[] = []
  for (const item of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
    if (!item.str || !item.transform) continue
    const tx = pdfjsLib.Util.transform(vp.transform, item.transform)
    const fontHeight = Math.hypot(tx[2], tx[3])
    const x = tx[4]
    const y = tx[5] - fontHeight
    const w = item.width ?? 0
    out.push({
      str: item.str,
      rect: {
        l: x / vp.width,
        t: y / vp.height,
        w: w / vp.width,
        h: (fontHeight * 1.15) / vp.height
      }
    })
  }
  return out
}
