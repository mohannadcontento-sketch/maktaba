import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book } from '../../../../shared/types'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useReader } from '@/stores/reader'
import { useUi } from '@/stores/ui'
import { useMobilePrefs } from '@/stores/mobilePrefs'
import { clamp, cn, isMobilePlatform } from '@/lib/utils'
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

/** سمة داكنة لواجهة العارض لتلائم هوية التطبيق (الصفحات تبقى بيضاء) — سطح المكتب */
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

/**
 * وضع Moon+ على الجوال (v2.7): الصفحة تلمس حواف الشاشة تمامًا —
 * لا شريط أدوات ولا هوامش ولا ظلال ولا أرضية سوداء، وأرضية العرض
 * بيضاء بلون الورقة نفسه فتبدو الصفحة أكبر والنص أوضح.
 * القوائم المنسدلة (بحث/خصائص) تبقى داكنة بهوية التطبيق.
 */
const VIEWER_MOBILE_CSS = `:root{
  --main-color:#e6e9ef !important;
  --doorhanger-bg-color:#1a1d24 !important;
  --doorhanger-border-color:#2c313c !important;
  --field-bg-color:#1a1d24 !important;
  --field-color:#e6e9ef !important;
  --field-border-color:#2c313c !important;
  --body-bg-color:#ffffff !important;
  --page-margin:0 auto !important;
  --page-border:none !important;
}
html,body{background:#ffffff !important}
#toolbarContainer,#secondaryToolbar{display:none !important}
#viewerContainer{inset:0 !important;background:#ffffff !important;overscroll-behavior:contain}
.pdfViewer .page{box-shadow:none !important;background:#fff !important}
#findbar{top:auto !important}`

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
  const mobile = isMobilePlatform()
  const mp = useMobilePrefs((s) => s.prefs)
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // الجوال (v2.7): ملاءمة الصفحة من لوحة التحكم تُطبق فورًا
  // الافتراضي «عرض الشاشة» يجعل الصفحة تلمس حواف التليفون تمامًا
  useEffect(() => {
    if (!mobile) return
    const app = appRef.current
    if (!app?.pdfViewer) return
    try {
      app.pdfViewer.currentScaleValue = mp.pdfFit === 'page' ? 'page-fit' : 'page-width'
    } catch {
      /* ignore */
    }
  }, [mobile, mp.pdfFit, loading])

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

  // ---------- مناطق لمس الجوال داخل عارض موزيلا (v2.7) ----------
  // الأطراف تمرّر شاشة كاملة (سلوك التمرير المتصل في Moon+)، والوسط يبدّل الوضع الغامر/اللوحة
  const wireTapZones = useCallback((frameDoc: Document, frameEl: HTMLIFrameElement): void => {
    const onTap = (e: MouseEvent): void => {
      try {
        const target = e.target as HTMLElement | null
        // روابط الملاحظات/الفهرس الداخلية تعمل طبيعيًا
        if (target?.closest?.('a')) return
        const doc = frameDoc
        const sel = doc.getSelection?.()
        if (sel && !sel.isCollapsed) return
        const width = doc.defaultView?.innerWidth ?? 0
        if (width <= 0) return
        const rx = e.clientX / width
        const log = (acted: string): void => {
          try {
            const w = window as unknown as { __mkPdfTapLog?: { rx: number; acted: string }[] }
            w.__mkPdfTapLog = w.__mkPdfTapLog || []
            w.__mkPdfTapLog.push({ rx: Math.round(rx * 100) / 100, acted })
            window.dispatchEvent(new CustomEvent('mk-tapzone', { detail: { acted, rx } }))
          } catch {
            /* ignore */
          }
        }
        const cont = doc.getElementById('viewerContainer')
        if (rx >= 0.76) {
          if (cont) {
            log('next')
            cont.scrollBy({ top: cont.clientHeight * 0.88, behavior: 'smooth' })
          }
        } else if (rx <= 0.24) {
          if (cont) {
            log('prev')
            cont.scrollBy({ top: -cont.clientHeight * 0.88, behavior: 'smooth' })
          }
        } else {
          const centerAction = useMobilePrefs.getState().prefs.centerAction
          if (centerAction === 'settings') {
            log('settings')
            const st = useReader.getState()
            st.setSettingsOpen(!st.settingsOpen)
          } else {
            log('zen')
            const st = useReader.getState()
            st.setZen(!st.zenMode)
          }
        }
        void frameEl
      } catch {
        /* ignore */
      }
    }
    frameDoc.addEventListener('click', onTap, true)
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

        // سمة الواجهة حسب المنصة + مساحات آمن الجوال
        // سطح المكتب: سمة داكنة كما هي — الجوال: وضع Moon+ حتى الحواف
        try {
          if (frame.contentDocument?.head) {
            const style = frame.contentDocument.createElement('style')
            style.setAttribute('data-mk-viewer', '1')
            style.textContent = isMobilePlatform() ? VIEWER_MOBILE_CSS : VIEWER_DARK_CSS
            frame.contentDocument.head.appendChild(style)
          }
        } catch {
          /* ignore */
        }
        wireSelectionBridge(frame.contentDocument!, frame)
        if (isMobilePlatform()) wireTapZones(frame.contentDocument!, frame)

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

        // الجوال (v2.7): ملاءمة عرض الشاشة افتراضيًا — الصفحة من حافة لحافة
        if (isMobilePlatform()) {
          try {
            const fit = useMobilePrefs.getState().prefs.pdfFit
            app.pdfViewer.currentScaleValue = fit === 'page' ? 'page-fit' : 'page-width'
          } catch {
            /* ignore */
          }
        }

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
          },
          // الجوال (v2.7): تمرير تلقائي سلس داخل عارض موزيلا نفسه — على طريقة Moon+
          setAutoScroll: (on, secs) => {
            try {
              if (autoScrollTimerRef.current) {
                clearInterval(autoScrollTimerRef.current)
                autoScrollTimerRef.current = null
              }
              if (!on) return
              const cont = frameDocRef.current?.getElementById('viewerContainer')
              if (!cont) return
              const pxPerTick = Math.max(1, (cont.clientHeight * 0.88 * 60) / (Math.max(1, secs) * 1000))
              autoScrollTimerRef.current = setInterval(() => {
                if (cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 2) return
                cont.scrollBy(0, pxPerTick)
              }, 60)
            } catch {
              /* ignore */
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
      if (autoScrollTimerRef.current) {
        clearInterval(autoScrollTimerRef.current)
        autoScrollTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const night = reader.nightInvert

  return (
    <div className={cn('relative min-h-0 flex-1 overflow-hidden', mobile ? 'bg-white' : 'bg-[#0f1115]')}>
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
          className={cn('h-full w-full border-0', night && (mobile ? 'pdf-night-m' : 'pdf-night'))}
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
