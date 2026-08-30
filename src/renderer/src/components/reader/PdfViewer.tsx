import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book } from '../../../../shared/types'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useReader } from '@/stores/reader'
import { useUi } from '@/stores/ui'
import { clamp, cn } from '@/lib/utils'
import { buildToc, generateCover, type PdfHandle, type TocItem } from '@/lib/pdfEngine'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * عارض PDF الرسمي من موزيلا (pdf.js viewer — نفس عارض فايرفوكس) داخل iframe.
 * مورّد محليًا في public/pdfjs (Apache-2.0) ويمنحنا مجانًا:
 *   تكبير بالقرص/العجلة، تمرير متصل، بحث كامل، فهرس ومصغرات، طباعة،
 *   طبقة نص للتحديد، شريط أدوات متجاوب مع شاشات الجوال.
 * نحن نضيف: حفظ/استرجاع التقدم، الأغلفة والبيانات الوصفية، الوضع الليلي،
 * وجسر التحديد إلى لوحة الأدوات الموجودة (نسخ/قراءة/بحث).
 */

interface Props {
  book: Book
  onDocReady(info: { toc: TocItem[]; handle: PdfHandle }): void
  onPageChange(page: number): void
}

interface ViewerApp {
  open(args: { data: Uint8Array } | { url: string }): Promise<void>
  pdfDocument?: any
  pdfViewer: {
    currentPageNumber: number
    currentScaleValue?: string
    nextPage(): void
    previousPage(): void
  }
  eventBus: { on(type: string, fn: (e: any) => void): void; dispatch(type: string, data?: any): void }
  findBar?: { open(): void } | null
  zoomIn(): void
  zoomOut(): void
}

/** سمة داكنة لواجهة العارض لتلائم هوية التطبيق (الصفحات تبقى بيضاء) */
const VIEWER_DARK_CSS = `:root{
  --main-color:#e6e9ef !important;
  --body-bg-color:#0f1115 !important;
  --sidebar-bg-color:#14161c !important;
  --toolbar-bg-color:#17191f !important;
  --toolbar-border-color:#262b34 !important;
  --field-bg-color:#1a1d24 !important;
  --field-color:#e6e9ef !important;
  --field-border-color:#2c313c !important;
  --doorhanger-bg-color:#1a1d24 !important;
  --doorhanger-border-color:#2c313c !important;
  --toolbar-icon-bg-color:#2a2f3a !important;
  --dropdown-btn-bg-color:#1a1d24 !important;
}
#toolbarContainer{padding-top:env(safe-area-inset-top,0px)}
body{background:#0f1115}`

export function PdfViewer({ book, onDocReady, onPageChange }: Props) {
  const reader = useReader()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const appRef = useRef<ViewerApp | null>(null)
  const frameDocRef = useRef<Document | null>(null)
  const restoreDoneRef = useRef(true)
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const bookRef = useRef(book)
  bookRef.current = book
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  // ---------- حفظ التقدم عند تغير الصفحة ----------
  const savePage = useCallback(
    (p: number): void => {
      if (!restoreDoneRef.current) return
      const total = Math.max(1, appRef.current?.pdfDocument?.numPages ?? 1)
      const progress = clamp((p / total) * 100, 0, 100)
      void reader.saveProgress(progress, String(p), p >= total)
    },
    [reader]
  )

  // ---------- جسر التحديد من داخل الـ iframe إلى لوحة الأدوات ----------
  const wireSelectionBridge = useCallback((frameDoc: Document, frameEl: HTMLIFrameElement): void => {
    const report = (): void => {
      try {
        const sel = frameDoc.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
        const text = sel.toString().trim()
        if (text.length < 2) return
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        if (!rect || (rect.width === 0 && rect.height === 0)) return
        const frameRect = frameEl.getBoundingClientRect()
        useReader.getState().setSelection({
          text,
          rect: { x: rect.left + frameRect.left, y: rect.top + frameRect.top, w: rect.width, h: rect.height }
        })
      } catch {
        /* ignore */
      }
    }
    frameDoc.addEventListener('pointerup', report)
    frameDoc.addEventListener('keyup', report)
    // كليك يمين في PDF: منع قائمة النظام — ومع تحديد نصّ تُظهر لوحة أدواتنا
    // (التمييز الرسمي نفسه متاح من شريط عارض موزيلا: قلم التمييز)
    frameDoc.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      report()
    })
  }, [])

  // ---------- تشغيل العارض ----------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const url = await window.api.fileUrl(book.id)
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`fileUrl fetch: ${resp.status}`)
        const buf = await resp.arrayBuffer()

        // انتظار جاهزية العارض داخل الإطار
        const frame = iframeRef.current
        if (!frame) throw new Error('no iframe')
        await new Promise<void>((resolve, reject) => {
          const check = (): boolean =>
            !!(frame.contentWindow as unknown as { PDFViewerApplication?: ViewerApp } | null)?.PDFViewerApplication
          if (check()) return resolve()
          const onLoad = (): void => {
            if (check()) return resolve()
            setTimeout(() => (check() ? resolve() : reject(new Error('viewer app missing'))), 150)
          }
          frame.addEventListener('load', onLoad, { once: true })
          setTimeout(() => reject(new Error('viewer load timeout')), 25000)
        })
        if (cancelled) return

        const frameWin = frame.contentWindow as unknown as { PDFViewerApplication: ViewerApp } & Window
        const app = frameWin.PDFViewerApplication
        appRef.current = app
        frameDocRef.current = frame.contentDocument
        ;(frameWin as unknown as { __pdfViewerApp?: ViewerApp }).__pdfViewerApp = app

        // سمة داكنة للواجهة + مساحات آمنة الجوال
        try {
          if (frame.contentDocument?.head) {
            const style = frame.contentDocument.createElement('style')
            style.setAttribute('data-mk-viewer', '1')
            style.textContent = VIEWER_DARK_CSS
            frame.contentDocument.head.appendChild(style)
          }
        } catch {
          /* ignore */
        }
        wireSelectionBridge(frame.contentDocument!, frame)

        // فتح المستند من البيانات (بلا قيود أصل file=) — open يتوقع {url|data}
        await app.open({ data: new Uint8Array(buf) })
        // بعض الإصدارات تُرجع قبل اكتمال pdfDocument — انتظار دفاعي
        for (let i = 0; i < 100 && !app.pdfDocument; i++) {
          await new Promise((r) => setTimeout(r, 100))
        }
        if (cancelled) return
        const doc = app.pdfDocument
        if (!doc) throw new Error('document did not open')
        const total = doc.numPages as number

        // تتبع الصفحة: رد واجهة + حفظ التقدم
        app.eventBus.on('pagechanging', (e: { pageNumber: number }) => {
          onPageChangeRef.current(e.pageNumber)
          savePage(e.pageNumber)
        })

        // بيانات وصفية/غلاف إن كانت ناقصة — نفس سلوك النسخ السابقة
        const cur = bookRef.current
        if (!cur.coverPath || !cur.title || !cur.pageCount || !cur.author) {
          try {
            const patch: Record<string, unknown> = {}
            let metaTitle: string | undefined
            let metaAuthor: string | undefined
            try {
              const m = await doc.getMetadata()
              const info = (m?.info ?? {}) as { Title?: string; Author?: string }
              metaTitle = info.Title?.trim() || undefined
              metaAuthor = info.Author?.trim() || undefined
            } catch {
              /* ignore */
            }
            if (!cur.title && metaTitle) patch.title = metaTitle
            if (!cur.author && metaAuthor) patch.author = metaAuthor
            if (!cur.pageCount) patch.pageCount = total
            if (Object.keys(patch).length) await window.api.updateBook(cur.id, patch)
            if (!cur.coverPath) {
              const cover = await generateCover(doc as unknown as PDFDocumentProxy)
              if (cover) await window.api.saveCover(cur.id, cover)
              const fresh = await window.api.getBook(cur.id)
              if (fresh) {
                const { useLibrary } = await import('@/stores/library')
                useLibrary.setState((s) => ({ books: s.books.map((x) => (x.id === cur.id ? fresh : x)) }))
              }
            }
          } catch (e) {
            console.error('pdf meta/cover patch failed', e)
          }
        }

        const toc = (await buildToc(doc as unknown as PDFDocumentProxy)) as TocItem[]

        const handle: PdfHandle = {
          goToPage: (n) => {
            app.pdfViewer.currentPageNumber = clamp(Math.round(n), 1, total)
          },
          nextPage: () => app.pdfViewer.nextPage(),
          prevPage: () => app.pdfViewer.previousPage(),
          zoomIn: () => app.zoomIn(),
          zoomOut: () => app.zoomOut(),
          setFitWidth: () => {
            app.pdfViewer.currentScaleValue = 'page-width'
          },
          setFitPage: () => {
            app.pdfViewer.currentScaleValue = 'page-fit'
          },
          rotate: () => app.eventBus.dispatch('rotatecw'),
          runSearch: async (q) => {
            // فتح شريط البحث الرسمي داخل العارض — البحث نفسه يديره العارض
            try {
              app.findBar?.open()
              if (q) {
                app.eventBus.dispatch('find', {
                  source: null,
                  type: '',
                  query: q,
                  caseSensitive: false,
                  entireWord: false,
                  highlightAll: true,
                  findPrevious: false,
                  matchDiacritics: true
                })
              }
            } catch {
              /* ignore */
            }
          },
          currentPage: () => app.pdfViewer.currentPageNumber ?? 1,
          numPages: () => total,
          scrollToPercent: (p) => {
            const target = clamp(Math.round((clamp(p, 0, 100) / 100) * total), 1, total)
            app.pdfViewer.currentPageNumber = target
          },
          percent: () => clamp(((app.pdfViewer.currentPageNumber ?? 1) / total) * 100, 0, 100),
          pageText: async (page) => {
            try {
              if (page < 1 || page > total) return ''
              const pg = await doc.getPage(page)
              const tc = await pg.getTextContent()
              return (tc.items as Array<{ str?: string }>)
                .map((i) => i.str ?? '')
                .join(' ')
                .trim()
            } catch {
              return ''
            }
          }
        }
        if (cancelled) return
        onDocReady({ toc, handle })
        setLoading(false)

        // استرجاع آخر موضع
        const resume = book.lastLocation && /^\d+$/.test(book.lastLocation) ? parseInt(book.lastLocation) : 1
        if (resume > 1 && resume <= total) {
          restoreDoneRef.current = false
          app.pdfViewer.currentPageNumber = resume
          // pagechanging أثناء الاسترجاع لن يحفظ — نفعّل الحفظ بعد استقرار العرض
          setTimeout(() => {
            restoreDoneRef.current = true
          }, 600)
          useUi.getState().toast('استؤنفت القراءة من آخر موضع', 'info')
        }
      } catch (e) {
        console.error('pdf viewer failed:', e, (e as Error)?.stack)
        if (!cancelled) {
          setFailed(true)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      appRef.current = null
      frameDocRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const night = reader.nightInvert

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0f1115]">
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-ink dark:text-dink">
          <p className="text-lg font-semibold">تعذر فتح هذا الكتاب</p>
          <p className="text-sm opacity-60">قد يكون الملف تالفًا أو محميًا بكلمة مرور</p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src="./pdfjs/web/viewer.html"
          title="PDF"
          className={cn('h-full w-full border-0', night && 'pdf-night')}
          allow="fullscreen"
        />
      )}
      {loading && !failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent/25 border-t-accent" />
        </div>
      )}
    </div>
  )
}
