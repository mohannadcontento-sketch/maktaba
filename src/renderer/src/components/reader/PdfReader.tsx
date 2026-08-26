import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { Book } from '../../../../shared/types'
import { useReader, type SearchBox } from '@/stores/reader'
import { useUi } from '@/stores/ui'
import { clamp, cn } from '@/lib/utils'
import {
  buildToc,
  extractPageText,
  findMatchesInItems,
  generateCover,
  loadPdf,
  type LoadedDoc,
  type TocItem
} from '@/lib/pdfEngine'

interface Rect {
  l: number
  t: number
  w: number
  h: number
}

interface PageDims {
  w: number
  h: number
}

const PAGE_GAP = 16
const SIDE_PAD = 20

export interface PdfHandle {
  goToPage(n: number): void
  nextPage(): void
  prevPage(): void
  zoomIn(): void
  zoomOut(): void
  setFitWidth(): void
  setFitPage(): void
  rotate(): void
  runSearch(q: string): Promise<void>
  currentPage(): number
  numPages(): number
  scrollToPercent(p: number): void
  percent(): number
}

interface Props {
  book: Book
  onDocReady(info: { toc: TocItem[]; handle: PdfHandle }): void
  onPageChange(page: number): void
}

export function PdfReader({ book, onDocReady, onPageChange }: Props) {
  const reader = useReader()
  const ui = useUi()

  const containerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<LoadedDoc | null>(null)
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const textRefs = useRef(new Map<number, HTMLDivElement>())
  const renderTasks = useRef(new Map<number, { cancel(): void; promise: Promise<void> }>())
  const renderedPages = useRef(new Set<number>())
  const dims = useRef<PageDims[]>([])
  const offsets = useRef<number[]>([])
  const textCache = useRef(new Map<number, ReturnType<typeof extractPageText>>())
  const pageEls = useRef(new Map<number, HTMLDivElement>())

  const [numPages, setNumPages] = useState(0)
  const numPagesRef = useRef(0)
  useEffect(() => {
    numPagesRef.current = numPages
  }, [numPages])

  const [fitMode, setFitMode] = useState<'width' | 'page' | 'custom'>('width')
  const [zoomPct, setZoomPct] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [failed, setFailed] = useState(false)

  const scaleRef = useRef(1)
  const curPageRef = useRef(1)
  const maxReachedRef = useRef(1)

  // ---------- المقياس ----------
  const computeScale = useCallback((): number => {
    const el = containerRef.current
    const base = dims.current[0]
    if (!el || !base) return 1
    const availW = el.clientWidth - SIDE_PAD * 2 - 4
    const availH = el.clientHeight - SIDE_PAD * 2 - PAGE_GAP
    const rotated = rotation % 180 !== 0
    const w = rotated ? base.h : base.w
    const h = rotated ? base.w : base.h
    if (fitMode === 'width') return clamp(availW / w, 0.1, 8)
    if (fitMode === 'page') return clamp(Math.min(availW / w, availH / h), 0.1, 8)
    return clamp((zoomPct / 100) * Math.min(availW / w, availH / h), 0.1, 8)
  }, [fitMode, rotation, zoomPct])

  const relayout = useCallback(() => {
    const s = computeScale()
    scaleRef.current = s
    let y = SIDE_PAD
    for (let i = 0; i < dims.current.length; i++) {
      offsets.current[i] = y
      y += dims.current[i].h * s + PAGE_GAP
    }
    const wrap = wrapRef.current
    if (wrap) wrap.style.height = `${Math.max(0, y - PAGE_GAP + SIDE_PAD)}px`
    for (const [n, el] of pageEls.current) {
      const d = dims.current[n - 1]
      const off = offsets.current[n - 1]
      if (!d || off == null) continue
      el.style.top = `${off}px`
      el.style.left = `calc(50% - ${(d.w * s) / 2}px)`
      el.style.width = `${Math.floor(d.w * s)}px`
      el.style.height = `${Math.floor(d.h * s)}px`
    }
  }, [computeScale])

  const scrollToPageInternal = useCallback(
    (n: number): void => {
      const el = containerRef.current
      if (!el || !offsets.current.length) return
      const idx = clamp(n, 1, Math.max(1, numPages)) - 1
      el.scrollTo({ top: Math.max(0, offsets.current[idx] - 14), behavior: 'smooth' })
    },
    [numPages]
  )

  // ---------- رسم صفحة ----------
  const renderPage = useCallback(async (n: number) => {
    const loaded = docRef.current
    const el = pageEls.current.get(n)
    if (!loaded || !el || renderedPages.current.has(n)) return
    renderedPages.current.add(n)
    try {
      const page = await loaded.doc.getPage(n)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const scale = scaleRef.current * dpr
      const vp = page.getViewport({ scale })

      renderTasks.current.get(n)?.cancel()

      let canvas = canvasRefs.current.get(n)
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.style.position = 'absolute'
        canvas.style.inset = '0'
        el.insertBefore(canvas, el.firstChild)
        canvasRefs.current.set(n, canvas)
      }
      canvas.width = Math.max(1, Math.floor(vp.width))
      canvas.height = Math.max(1, Math.floor(vp.height))
      canvas.style.width = `${vp.width / dpr}px`
      canvas.style.height = `${vp.height / dpr}px`
      const ctx = canvas.getContext('2d', { alpha: false })!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const task = page.render({ canvasContext: ctx, viewport: vp })
      renderTasks.current.set(n, task as unknown as { cancel(): void; promise: Promise<void> })
      await task.promise

      // طبقة النص القابلة للتحديد
      const tc = await page.getTextContent()
      let textDiv = textRefs.current.get(n)
      if (!textDiv) {
        textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        el.appendChild(textDiv)
        textRefs.current.set(n, textDiv)
      }
      textDiv.replaceChildren()
      textDiv.style.setProperty('--scale-factor', String(scale))
      try {
        const TL = (
          pdfjsLib as unknown as {
            TextLayer?: new (o: object) => { render(): Promise<void> }
          }
        ).TextLayer
        if (TL) {
          await new TL({ textContentSource: tc, container: textDiv, viewport: vp }).render()
        } else {
          const rtl = (
            pdfjsLib as unknown as {
              renderTextLayer(o: object): { promise: Promise<void> }
            }
          ).renderTextLayer({ textContentSource: tc, container: textDiv, viewport: vp })
          await rtl.promise
        }
      } catch (te) {
        console.warn('text layer', n, te)
      }
    } catch (e) {
      renderedPages.current.delete(n)
      const name = (e as { name?: string })?.name
      if (name === 'RenderingCancelledException') return
      console.error('render', n, e)
    } finally {
      renderTasks.current.delete(n)
    }
  }, [])

  const visibleRange = useRef<[number, number]>([0, 0])

  const requestRenderAround = useCallback(
    (page: number) => {
      if (!numPagesRef.current) return
      const from = clamp(page - 2, 1, numPagesRef.current)
      const to = clamp(page + 2, 1, numPagesRef.current)
      visibleRange.current = [from, to]
      for (let i = from; i <= to; i++) void renderPage(i)
      for (const n of [...renderedPages.current]) {
        if (n < from - 3 || n > to + 3) {
          canvasRefs.current.get(n)?.remove()
          canvasRefs.current.delete(n)
          textRefs.current.get(n)?.replaceChildren()
          renderedPages.current.delete(n)
        }
      }
    },
    [renderPage]
  )

  // ---------- التحميل الأولي ----------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const url = await window.api.fileUrl(book.id)
        const loaded = await loadPdf(url)
        if (cancelled) return
        docRef.current = loaded
        const first = await loaded.doc.getPage(1)
        const vp1 = first.getViewport({ scale: 1 })
        dims.current = Array.from({ length: loaded.doc.numPages }, () => ({ w: vp1.width, h: vp1.height }))
        setNumPages(loaded.doc.numPages)
        relayout()

        // استخراج بيانات وصفية/غلاف إن كانت ناقصة
        if (!book.coverPath || !book.title || !book.pageCount || !book.author) {
          const patch: Record<string, unknown> = {}
          if (!book.title && loaded.meta.title) patch.title = loaded.meta.title
          if (!book.author && loaded.meta.author) patch.author = loaded.meta.author
          if (!book.pageCount) patch.pageCount = loaded.doc.numPages
          if (Object.keys(patch).length) await window.api.updateBook(book.id, patch)
          if (!book.coverPath) {
            const cover = await generateCover(loaded.doc)
            if (cover) await window.api.saveCover(book.id, cover)
            const fresh = await window.api.getBook(book.id)
            if (fresh) {
              const { useLibrary } = await import('@/stores/library')
              useLibrary.setState((s) => ({ books: s.books.map((x) => (x.id === book.id ? fresh : x)) }))
            }
          }
        }

        const toc = await buildToc(loaded.doc)

        const handle: PdfHandle = {
          goToPage: (n) => scrollToPageInternal(n),
          nextPage: () => scrollToPageInternal(curPageRef.current + 1),
          prevPage: () => scrollToPageInternal(curPageRef.current - 1),
          zoomIn: () => {
            setFitMode('custom')
            setZoomPct((z) => clamp(z + 15, 30, 400))
          },
          zoomOut: () => {
            setFitMode('custom')
            setZoomPct((z) => clamp(z - 15, 30, 400))
          },
          setFitWidth: () => setFitMode('width'),
          setFitPage: () => setFitMode('page'),
          rotate: () => setRotation((r) => (r + 90) % 360),
          runSearch: (q) => runSearch(q),
          currentPage: () => curPageRef.current,
          numPages: () => numPagesRef.current,
          scrollToPercent: (p) => {
            const el = containerRef.current
            if (!el) return
            const max = el.scrollHeight - el.clientHeight
            el.scrollTo({ top: Math.max(0, (clamp(p, 0, 100) / 100) * max), behavior: 'smooth' })
          },
          percent: () => {
            const el = containerRef.current
            if (!el || el.scrollHeight <= el.clientHeight) return 0
            return clamp(((el.scrollTop + el.clientHeight / 2) / el.scrollHeight) * 100, 0, 100)
          }
        }
        onDocReady({ toc, handle })

        const resume =
          book.lastLocation && /^\d+$/.test(book.lastLocation) ? parseInt(book.lastLocation) : 1
        setTimeout(() => requestRenderAround(resume), 50)
        if (resume > 1) {
          setTimeout(() => {
            scrollToPageInternal(resume)
            ui.toast('استؤنفت القراءة من آخر موضع', 'info')
          }, 300)
        }
      } catch (e) {
        console.error('pdf load failed:', e, (e as Error)?.stack)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      cancelAllRenders()
      void docRef.current?.doc.destroy()
      docRef.current = null
      canvasRefs.current.clear()
      textRefs.current.clear()
      renderedPages.current.clear()
      textCache.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cancelAllRenders(): void {
    for (const t of renderTasks.current.values()) {
      try {
        t.cancel()
      } catch {
        /* ignore */
      }
    }
    renderTasks.current.clear()
  }

  // ---------- إعادة التخطيط مع الحفاظ على موضع القراءة ----------
  const relayoutKey = `${fitMode}:${zoomPct}:${rotation}:${numPages}`
  useEffect(() => {
    if (!dims.current.length || !numPages) return
    const anchor = currentScrollCenterPage() ?? curPageRef.current
    const within = topWithinPage(anchor)
    relayout()
    requestAnimationFrame(() => {
      const off = offsets.current[anchor - 1]
      if (off != null && containerRef.current) {
        containerRef.current.scrollTop = Math.max(0, off + within * scaleRef.current - 40)
      }
    })
    cancelAllRenders()
    renderedPages.current.clear()
    requestRenderAround(anchor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayoutKey])

  function currentScrollCenterPage(): number | null {
    const el = containerRef.current
    if (!el || !offsets.current.length) return null
    const center = el.scrollTop + el.clientHeight / 2
    let page = 1
    for (let i = 0; i < offsets.current.length; i++) {
      if (offsets.current[i] <= center) page = i + 1
      else break
    }
    return page
  }

  function topWithinPage(page: number): number {
    const el = containerRef.current
    if (!el) return 0
    const off = offsets.current[page - 1] ?? 0
    return Math.max(0, el.scrollTop - off)
  }

  // ---------- مراقبة التمرير ----------
  useEffect(() => {
    const el = containerRef.current
    if (!el || !numPages) return
    let ticking = false
    const onScroll = (): void => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const p = currentScrollCenterPage()
        if (p == null) return
        if (p !== curPageRef.current) {
          curPageRef.current = p
          maxReachedRef.current = Math.max(maxReachedRef.current, p)
          onPageChange(p)
          requestRenderAround(p)
        }
        scheduleProgressSave(p)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, requestRenderAround])

  const progressTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  function scheduleProgressSave(p: number): void {
    clearTimeout(progressTimer.current)
    progressTimer.current = setTimeout(() => {
      const progress = ((p - 1) / Math.max(1, numPages)) * 100
      void reader.saveProgress(progress, String(p), p >= numPages)
    }, 800)
  }

  // نبض جلسة القراءة كل 30 ثانية
  useEffect(() => {
    const iv = setInterval(() => void reader.heartbeat(30, maxReachedRef.current), 30000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // تكبير بعجلة الفأرة + Ctrl
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setFitMode('custom')
        setZoomPct((z) => clamp(z - e.deltaY * 0.25, 30, 400))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // تصحيح أبعاد الصفحات غير الموحدة تدريجيًا
  useEffect(() => {
    if (!numPages) return
    let stop = false
    void (async () => {
      const doc = docRef.current?.doc
      if (!doc) return
      for (let n = 2; n <= Math.min(numPages, 80); n++) {
        if (stop) return
        try {
          const page = await doc.getPage(n)
          const vp = page.getViewport({ scale: 1 })
          const cur = dims.current[n - 1]
          if (cur && (Math.abs(cur.w - vp.width) > 1 || Math.abs(cur.h - vp.height) > 1)) {
            dims.current[n - 1] = { w: vp.width, h: vp.height }
            relayout()
          }
        } catch {
          /* ignore */
        }
      }
    })()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages])

  // ---------- التقاط تحديد النص ----------
  const onMouseUp = (): void => {
    const sel = window.getSelection()
    const cont = containerRef.current
    if (!sel || sel.isCollapsed || !cont || !sel.rangeCount) return
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (!text) return

    let pageEl: HTMLElement | null = null
    let node: Node | null = sel.anchorNode
    while (node) {
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
      if (el?.dataset?.pdfPage) {
        pageEl = el
        break
      }
      node = node.parentNode
    }
    if (!pageEl) return

    const pageNum = Number(pageEl.dataset.pdfPage)
    const pr = pageEl.getBoundingClientRect()
    const range = sel.getRangeAt(0)
    const rects: DOMRect[] = []
    const list = range.getClientRects()
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      if (r.width > 1 && r.height > 1) rects.push(r)
    }
    if (!rects.length) rects.push(range.getBoundingClientRect())

    const relRects = rects.map((r) => ({
      l: (r.left - pr.left) / pr.width,
      t: (r.top - pr.top) / pr.height,
      w: r.width / pr.width,
      h: r.height / pr.height
    }))
    let minL = Infinity
    let minT = Infinity
    let maxR = 0
    let maxB = 0
    for (const rr of relRects) {
      minL = Math.min(minL, rr.l)
      minT = Math.min(minT, rr.t)
      maxR = Math.max(maxR, rr.l + rr.w)
      maxB = Math.max(maxB, rr.t + rr.h)
    }
    reader.setSelection({
      text,
      page: pageNum,
      rects: relRects,
      rect: {
        x: pr.left + minL * pr.width,
        y: pr.top + minT * pr.height,
        w: (maxR - minL) * pr.width,
        h: (maxB - minT) * pr.height
      }
    })
  }

  // إنشاء تعليق من التحديد الحالي (تستدعيه لوحة التحديد المشتركة)
  useEffect(() => {
    // كشف المستند وصفحته الحالية لميزات مثل الطباعة
    ;(window as unknown as { __pdfGetDoc?: unknown }).__pdfGetDoc = () => docRef.current?.doc ?? null
    ;(window as unknown as { __pdfCurrentPage?: unknown }).__pdfCurrentPage = () => curPageRef.current
    // مشغل البحث لشريط البحث
    ;(window as unknown as { __pdfSearchRunner?: unknown }).__pdfSearchRunner = (q: string) => void runSearch(q)
    ;(
      window as unknown as {
        __pdfCreateAnnotation?: (
          type: 'highlight' | 'underline' | 'note',
          color: string
        ) => void
      }
    ).__pdfCreateAnnotation = (type, color) => {
      const sel = reader.selection
      if (!sel || sel.page == null || !sel.rects) return
      void reader
        .addAnnotation({
          id: `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          bookId: book.id,
          type,
          color,
          page: sel.page,
          cfi: null,
          rects: JSON.stringify(sel.rects),
          text: sel.text,
          note: ''
        })
        .then(() => {
          window.getSelection()?.removeAllRanges()
          reader.setSelection(null)
          if (type === 'note') reader.setSidebarPanel('annotations')
        })
    }
    return () => {
      delete (window as unknown as { __pdfCreateAnnotation?: unknown }).__pdfCreateAnnotation
      delete (window as unknown as { __pdfGetDoc?: unknown }).__pdfGetDoc
      delete (window as unknown as { __pdfCurrentPage?: unknown }).__pdfCurrentPage
      delete (window as unknown as { __pdfSearchRunner?: unknown }).__pdfSearchRunner
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, book.id])

  // ---------- التعليقات حسب الصفحة ----------
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, typeof reader.annotations>()
    for (const a of reader.annotations) {
      if (a.page == null) continue
      const list = map.get(a.page) ?? []
      list.push(a)
      map.set(a.page, list)
    }
    return map
  }, [reader.annotations])

  // ---------- البحث داخل المستند ----------
  const runSearch = useCallback(async (q: string): Promise<void> => {
    const loaded = docRef.current
    if (!loaded || !q.trim()) {
      useReader.getState().setSearchResults('', [], [])
      return
    }
    const matches: Array<{ page: number; boxIndex: number }> = []
    const boxes: SearchBox[] = []
    for (let p = 1; p <= loaded.doc.numPages; p++) {
      let itemsPromise = textCache.current.get(p)
      if (!itemsPromise) {
        itemsPromise = extractPageText(loaded.doc, p)
        textCache.current.set(p, itemsPromise)
      }
      try {
        const items = await itemsPromise
        const found = findMatchesInItems(items, q, p)
        found.matches.forEach(() => {})
        for (const b of found.boxes) {
          matches.push({ page: p, boxIndex: boxes.length })
          boxes.push(b)
        }
      } catch {
        /* ignore */
      }
      if (matches.length > 1000) break
    }
    useReader.getState().setSearchResults(q, matches, boxes)
  }, [])

  // الانتقال إلى النتيجة النشطة
  const searchActive = reader.search.activeIndex
  const lastJump = useRef(-2)
  useEffect(() => {
    const m = reader.search.matches[searchActive]
    if (m && lastJump.current !== searchActive) {
      lastJump.current = searchActive
      scrollToPageInternal(m.page)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchActive])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex-1 overflow-auto bg-[#454a52] outline-none dark:bg-[#101216]',
        reader.nightInvert && 'pdf-night'
      )}
      onMouseUp={onMouseUp}
      tabIndex={-1}
    >
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/85">
          <p className="text-lg font-semibold">تعذر فتح هذا الملف</p>
          <p className="text-sm opacity-70">قد يكون تالفًا أو محميًا بكلمة مرور</p>
        </div>
      ) : (
        <div ref={wrapRef} className="relative" style={{ width: '100%' }}>
          {Array.from({ length: numPages }, (_, i) => {
            const n = i + 1
            return (
              <div
                key={n}
                data-pdf-page={n}
                ref={(el) => {
                  if (el) pageEls.current.set(n, el)
                  else pageEls.current.delete(n)
                }}
                className="absolute shadow-[0_2px_16px_rgba(0,0,0,0.35)]"
                style={{ backgroundColor: '#fff', top: offsets.current[i], left: 'calc(50% - 200px)' }}
              >
                <AnnotationOverlay
                  annotations={annotationsByPage.get(n)}
                  night={reader.nightInvert}
                  boxes={reader.search.boxes}
                  matchIndexes={reader.search.matches
                    .map((m, idx) => ({ m, idx }))
                    .filter(({ m }) => m.page === n)
                    .map(({ m, idx }) => ({ boxIndex: m.boxIndex, globalIdx: idx }))}
                  activeGlobalIdx={searchActive}
                  onDelete={(id) => void reader.deleteAnnotation(id)}
                  onEditNote={(a) =>
                    reader.setNoteEditor(reader.annotations.find((x) => x.id === a.id) ?? null)
                  }
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AnnotationOverlay({
  annotations,
  night,
  boxes,
  matchIndexes,
  activeGlobalIdx,
  onDelete,
  onEditNote
}: {
  annotations?: Array<{
    id: string
    type: string
    color: string
    rects: string | null
    note: string
    text: string | null
  }>
  night: boolean
  boxes: SearchBox[]
  matchIndexes: Array<{ boxIndex: number; globalIdx: number }>
  activeGlobalIdx: number
  onDelete(id: string): void
  onEditNote(a: { id: string }): void
}) {
  if (!annotations?.length && !matchIndexes.length) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]" style={{ opacity: night ? 0.9 : 1 }}>
      {/* نتائج البحث */}
      {matchIndexes.map(({ boxIndex, globalIdx }) => {
        const b = boxes[boxIndex]
        if (!b) return null
        const isActive = globalIdx === activeGlobalIdx
        return (
          <div
            key={`s${globalIdx}`}
            className={cn('absolute rounded-sm', isActive ? 'bg-orange-400/50 ring-2 ring-orange-500' : 'bg-yellow-300/40')}
            style={{ left: `${b.l * 100}%`, top: `${b.t * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
          />
        )
      })}

      {/* التعليقات المحفوظة */}
      {annotations?.map((a) => {
        let rects: Rect[] = []
        try {
          rects = a.rects ? (JSON.parse(a.rects) as Rect[]) : []
        } catch {
          /* ignore */
        }
        return (
          <div key={a.id} className="group/ann">
            {rects.map((r, i) =>
              a.type === 'highlight' ? (
                <div
                  key={i}
                  className={cn(
                    'absolute pointer-events-auto cursor-pointer rounded-sm',
                    night ? 'mix-blend-screen opacity-80' : 'mix-blend-multiply opacity-90'
                  )}
                  style={{
                    left: `${r.l * 100}%`,
                    top: `${r.t * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    backgroundColor: a.color
                  }}
                  title={a.text ?? ''}
                >
                  <span className="absolute -top-7 end-0 z-10 hidden gap-1 rounded-lg border border-black/10 bg-white p-0.5 shadow-md group-hover/ann:flex dark:border-white/10 dark:bg-dsurface2">
                    {a.note !== '' && (
                      <button
                        className="rounded px-1 text-xs hover:bg-black/10"
                        onClick={() => onEditNote(a)}
                        title="تحرير الملاحظة"
                      >
                        📝
                      </button>
                    )}
                    <button
                      className="rounded px-1 text-xs text-red-500 hover:bg-red-50"
                      onClick={() => onDelete(a.id)}
                      title="حذف"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : a.type === 'underline' ? (
                <div
                  key={i}
                  className="pointer-events-auto absolute cursor-pointer rounded-sm border-b-[3px]"
                  style={{
                    left: `${r.l * 100}%`,
                    width: `${r.w * 100}%`,
                    top: `calc(${(r.t + r.h) * 100}% - 3px)`,
                    borderColor: a.color
                  }}
                  title={a.text ?? ''}
                >
                  <span className="absolute -top-7 end-0 z-10 hidden gap-1 rounded-lg border border-black/10 bg-white p-0.5 shadow-md group-hover/ann:flex dark:border-white/10 dark:bg-dsurface2">
                    {a.note !== '' && (
                      <button className="rounded px-1 text-xs hover:bg-black/10" onClick={() => onEditNote(a)}>
                        📝
                      </button>
                    )}
                    <button
                      className="rounded px-1 text-xs text-red-500 hover:bg-red-50"
                      onClick={() => onDelete(a.id)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ) : (
                <div
                  key={i}
                  className="pointer-events-auto absolute cursor-pointer text-lg leading-none drop-shadow"
                  style={{ left: `${r.l * 100}%`, top: `calc(${r.t * 100}% - 4px)` }}
                  title={a.note}
                >
                  💬
                </div>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
