import { useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book as EpubBook, type Rendition, type Contents, type NavItem } from 'epubjs'
import type { Book } from '../../../../shared/types'
import { useReader, type ReaderSettings } from '@/stores/reader'
import { clamp, isRtlLang } from '@/lib/utils'

export interface TocEntry {
  label: string
  href: string
  children: TocEntry[]
}

export interface EpubHandle {
  next(): void
  prev(): void
  goToCfi(cfi: string): void
  goToHref(href: string): void
  displayAtPercent(p: number): void
  applySettings(s: ReaderSettings): void
  currentCfi(): string | null
}

interface Props {
  book: Book
  settings: ReaderSettings
  /** آخر موقع معروف — يُستخدم عند إعادة الفتح أو تبديل وضع العرض */
  resumeCfi?: string | null
  onDocReady(info: { toc: TocEntry[]; handle: EpubHandle; percent: number }): void
  onRelocate(percent: number, cfi: string): void
}

const THEME_RULES: Record<string, string> = {
  day: `body { background: #ffffff !important; color: #1a1a1a !important; }
        a { color: #0d9488 !important; }`,
  sepia: `body { background: #f4ecd8 !important; color: #5b4636 !important; }
         a { color: #a1662f !important; }`,
  night: `body { background: #17191e !important; color: #cfd3da !important; }
          a { color: #5eead4 !important; }
          img, svg, video { filter: brightness(0.85); }`
}

export function EpubReader({ book, settings, resumeCfi, onDocReady, onRelocate }: Props) {
  const reader = useReader()
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [, setProgress] = useState(0)

  // ---------- مواضع وحالة داخلية ----------
  const lastCfiRef = useRef<string | null>(
    resumeCfi?.startsWith('epubcfi')
      ? resumeCfi
      : book.lastLocation && book.lastLocation.startsWith('epubcfi')
        ? book.lastLocation
        : null
  )
  const lastSpineIndexRef = useRef(0)
  const lastPctRef = useRef(0)
  const pendingPercentRef = useRef<number | null>(null)
  const flowRef = useRef(settings.flow)
  const rtlRef = useRef(isRtlLang(book.language))
  const flipCooldownRef = useRef(0)

  const onRelocateRef = useRef(onRelocate)
  useEffect(() => {
    onRelocateRef.current = onRelocate
  }, [onRelocate])

  // إرسال تقدم القراءة مؤجلًا (يعمل دائمًا بأحدث نسخة من onRelocate)
  const onRelocateDebouncedRef = useRef<(pct: number, cfi: string) => void>(() => {})

  // ---------- بناء قواعد السمة ----------
  const buildThemeCss = useCallback((s: ReaderSettings): string => {
    const family = fontFamilyStack(s.fontFamily)
    // حقن الخطوط المدمجة بعناوين مطلقة ليعمل داخل iframe الكتاب
    const f = (name: string): string => new URL(`fonts/${name}`, window.location.href).href
    const fontFaces = `
      @font-face { font-family: 'Amiri'; src: url('${f('Amiri-Regular.ttf')}') format('truetype'); }
      @font-face { font-family: 'Cairo'; src: url('${f('Cairo-Variable.ttf')}') format('truetype'); }
      @font-face { font-family: 'Tajawal'; src: url('${f('Tajawal-Regular.ttf')}') format('truetype'); font-weight: 400; }
      @font-face { font-family: 'Tajawal'; src: url('${f('Tajawal-Bold.ttf')}') format('truetype'); font-weight: 700; }
      @font-face { font-family: 'Noto Naskh Arabic'; src: url('${f('NotoNaskhArabic-Variable.ttf')}') format('truetype'); }
      @font-face { font-family: 'Alexandria'; src: url('${f('Alexandria.ttf')}') format('truetype'); }
      @font-face { font-family: 'Bokra'; src: url('${f('Bokra.ttf')}') format('truetype'); }
      @font-face { font-family: 'El Messiri'; src: url('${f('ElMessiri.ttf')}') format('truetype'); }
    `
    const alignMap: Record<string, string> = {
      right: 'right',
      left: 'left',
      center: 'center',
      justify: 'justify'
    }
    const align = alignMap[s.align] ?? 'justify'
    const weight = s.fontFamily === 'tajawal-bold' ? '700' : '400'
    // ملاحظة: الهوامش تُطبق على حاوية التطبيق نفسها (wrapper) وليس على body الكتاب
    // لأن padding بالنسب المئوية لا يعمل بشكل صحيح في تخطيط الأعمدة (paginated) الخاص بـ epub.js
    return `\n      ${fontFaces}\n      body { font-family: ${family} !important; font-weight: ${weight} !important; }\n      p, li, div { line-height: ${s.lineHeight} !important; }\n      p { text-align: ${align} !important; }\n      img { max-width: 100%; height: auto; display: block; margin: 0 auto; }\n    `
  }, [])

  const attachedIdsRef = useRef(new Set<string>())
  const cssRef = useRef('')
  const styleElsRef = useRef<Set<HTMLStyleElement>>(new Set())

  // حقن CSS كعنصر <style> مضمّن — تسجيله كرابط (حتى blob:) يعلّق جاهزية الفصل داخل iframe
  const registerThemeHook = useCallback(
    (r: Rendition): void => {
      r.hooks.content.register((contents: { document: Document }) => {
        try {
          const el = contents.document.createElement('style')
          el.textContent = cssRef.current
          contents.document.head.appendChild(el)
          styleElsRef.current.add(el)
        } catch {
          /* فصل خارج عن السياق */
        }
      })
    },
    []
  )

  const applyAllThemes = useCallback(
    (r: Rendition, s: ReaderSettings) => {
      cssRef.current = THEME_RULES[s.theme] + buildThemeCss(s)
      const set = styleElsRef.current
      for (const el of set) {
        if (!el.isConnected) {
          set.delete(el)
          continue
        }
        el.textContent = cssRef.current
      }
      void r.themes.select('default')
      r.themes.fontSize(`${s.fontSize}%`)
    },
    [buildThemeCss]
  )

  // ---------- حاوية التمرير في وضع scrolled ----------
  const scrollerEl = useCallback((): HTMLElement | null => {
    const v = viewerRef.current
    if (!v) return null
    // epub.js ينشئ حاوية .epub-container هي نفسها القابلة للتمرير في وضع scrolled
    return (v.querySelector('.epub-container') as HTMLElement | null) ?? v
  }, [])

  // حساب النسبة في وضع التمرير: (مؤشر القسم الحالي + نسبة التمرير داخله) / عدد الأقسام
  const reportScrollProgress = useCallback((immediate = false): void => {
    const el = scrollerEl()
    const b = bookRef.current
    if (!el || !b) return
    const max = el.scrollHeight - el.clientHeight
    const frac = max > 0 ? clamp(el.scrollTop / max, 0, 1) : 0
    const total = spineCount()
    const idx = lastSpineIndexRef.current
    const pct = total ? clamp(((idx + frac) / total) * 100, 0, 100) : lastPctRef.current
    lastPctRef.current = pct
    const cfi = lastCfiRef.current
    if (!cfi) return
    if (immediate) onRelocateRef.current(pct, cfi)
    else onRelocateDebouncedRef.current(pct, cfi)
  }, [scrollerEl])

  const reportScrollRef = useRef(reportScrollProgress)
  useEffect(() => {
    reportScrollRef.current = reportScrollProgress
  }, [reportScrollProgress])

  // ---------- التنقل (متوافق مع الوضعين) ----------
  const next = useCallback((): void => {
    if (flowRef.current === 'scrolled') {
      const el = scrollerEl()
      if (el) {
        const max = el.scrollHeight - el.clientHeight
        if (max > 0 && el.scrollTop < max - 4) {
          el.scrollTo({ top: Math.min(max, el.scrollTop + el.clientHeight * 0.88), behavior: 'smooth' })
          return
        }
      }
      // نهاية القسم → القسم التالي
    }
    void renditionRef.current?.next()
  }, [scrollerEl])

  const prev = useCallback((): void => {
    if (flowRef.current === 'scrolled') {
      const el = scrollerEl()
      if (el) {
        if (el.scrollTop > 4) {
          el.scrollTo({ top: Math.max(0, el.scrollTop - el.clientHeight * 0.88), behavior: 'smooth' })
          return
        }
      }
      // بداية القسم → القسم السابق
    }
    void renditionRef.current?.prev()
  }, [scrollerEl])

  const nextRef = useRef(next)
  const prevRef = useRef(prev)
  useEffect(() => {
    nextRef.current = next
    prevRef.current = prev
  }, [next, prev])

  // قلب الصفحة بعجلة الفأرة في وضع الصفحات (مع مانع تكرار للأجهزة اللمسية)
  const flip = useCallback((dir: 1 | -1): void => {
    const now = Date.now()
    if (now - flipCooldownRef.current < 350) return
    flipCooldownRef.current = now
    if (dir > 0) nextRef.current()
    else prevRef.current()
  }, [])

  const wheelFlip = useCallback(
    (e: { deltaY: number; preventDefault(): void }): void => {
      if (flowRef.current !== 'paginated') return // وضع التمرير يتكفل به المتصفح طبيعيًا
      if (Math.abs(e.deltaY) < 4) return
      e.preventDefault()
      flip(e.deltaY > 0 ? 1 : -1)
    },
    [flip]
  )

  // ---------- مفاتيح الأسهم داخل iframe الكتاب ----------
  const keyNav = useCallback((key: string): void => {
    const fwd =
      key === 'ArrowDown' ||
      key === 'PageDown' ||
      key === ' ' ||
      (key === 'ArrowLeft' && rtlRef.current) ||
      (key === 'ArrowRight' && !rtlRef.current)
    const back =
      key === 'ArrowUp' ||
      key === 'PageUp' ||
      (key === 'ArrowRight' && rtlRef.current) ||
      (key === 'ArrowLeft' && !rtlRef.current)
    if (fwd) nextRef.current()
    else if (back) prevRef.current()
  }, [])

  // ---------- مؤشر الفهرس من CFI ----------
  const spineIndexOf = useCallback((cfi: string): number | null => {
    const b = bookRef.current
    if (!b) return null
    try {
      const sec = b.spine.get(cfi)
      return sec ? (sec as { index?: number }).index ?? null : null
    } catch {
      return null
    }
  }, [])

  // عدد أقسام الكتاب (spineItems موجودة وقت التشغيل لكنها ناقصة في التعريفات)
  const spineCount = useCallback((): number => {
    const b = bookRef.current
    if (!b) return 0
    return (b.spine as unknown as { spineItems?: unknown[] }).spineItems?.length ?? 0
  }, [])

  // ---------- التهيئة ----------
  function debounceCb<T extends unknown[]>(fn: (...args: T) => void, ms: number): ((...args: T) => void) & { cancel?(): void } {
    let t: ReturnType<typeof setTimeout> | undefined
    const wrapped = (...args: T): void => {
      clearTimeout(t)
      t = setTimeout(() => fn(...args), ms)
    }
    wrapped.cancel = () => clearTimeout(t)
    return wrapped
  }

  useEffect(() => {
    let destroyed = false
    let rel: Rendition | null = null
    const onRelocateDebounced = debounceCb((pct: number, cfi: string) => {
      onRelocateRef.current(pct, cfi)
    }, 600)
    onRelocateDebouncedRef.current = onRelocateDebounced

    void (async () => {
      try {
        const url = await window.api.fileUrl(book.id)
        if (destroyed) return
        // جلب البايتات بأنفسنا ثم فتحها من الذاكرة — مسار XHR الداخلي في epub.js يعاني سباقًا متقطعًا مع book://
        const res = await fetch(url)
        if (!res.ok) throw new Error(`book fetch ${res.status}`)
        const buf = await res.arrayBuffer()
        const epubBook = ePub(buf)
        bookRef.current = epubBook

        rel = epubBook.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          flow: settings.flow === 'scrolled' ? 'scrolled-doc' : 'paginated',
          spread: 'none'
        })
        renditionRef.current = rel
        registerThemeHook(rel)
        applyAllThemes(rel, settings)

        // أحداث داخل iframe: مفاتيح الأسهم + عجلة الفأرة (لا تصل للنافذة الأم أصلًا)
        rel.hooks.content.register((contents: { document: Document }) => {
          try {
            const doc = contents.document
            doc.addEventListener(
              'wheel',
              (e) => wheelFlip(e as WheelEvent),
              { passive: false }
            )
            doc.addEventListener('keydown', (e) => {
              const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ']
              if (keys.includes(e.key)) {
                e.preventDefault()
                keyNav(e.key)
              }
            })
          } catch {
            /* ignore */
          }
        })

        // استئناف آخر موضع
        const target = lastCfiRef.current ?? undefined
        await rel.display(target)

        // الفهرس
        const nav = (await epubBook.loaded.navigation) as { toc: NavItem[] }
        const toc = flattenNav(nav.toc ?? [])

        const handle: EpubHandle = {
          next: () => nextRef.current(),
          prev: () => prevRef.current(),
          goToCfi: (cfi) => void rel?.display(cfi),
          goToHref: (href) => void rel?.display(href),
          displayAtPercent: (p) => {
            const b = bookRef.current
            const target = clamp(p, 0, 100)
            if (!b || !rel) return
            if (flowRef.current === 'scrolled') {
              const el = scrollerEl()
              if (el) {
                const max = el.scrollHeight - el.clientHeight
                if (max > 0) el.scrollTo({ top: (target / 100) * max, behavior: 'auto' })
              }
              return
            }
            try {
              if (b.locations && b.locations.length() > 0) {
                const cfi = b.locations.cfiFromPercentage(target / 100)
                if (cfi) void rel.display(cfi)
              } else {
                // المواقع لم تُحسب بعد — نؤجل القفزة حتى يكتمل الحساب
                pendingPercentRef.current = target
              }
            } catch {
              /* ignore */
            }
          },
          applySettings: (s) => {
            if (!rel) return
            applyAllThemes(rel, s)
            rel.themes.fontSize(`${s.fontSize}%`)
          },
          currentCfi: () => lastCfiRef.current
        }

        // الأحداث
        rel.on(
          'relocated',
          (location: {
            start: { cfi: string; percentage?: number; index?: number; href?: string }
            end: unknown
          }) => {
            const start = location?.start
            if (!start?.cfi) return
            lastCfiRef.current = start.cfi
            if (typeof start.index === 'number') {
              lastSpineIndexRef.current = start.index
            } else {
              const idx = spineIndexOf(start.cfi)
              if (idx != null) lastSpineIndexRef.current = idx
            }

            // في وضع التمرير: النسبة تُحسب من موضع التمرير الحالي
            if (flowRef.current === 'scrolled') {
              reportScrollRef.current(false)
              return
            }

            // وضع الصفحات: نسبة دقيقة من المواقع إن توفرت، وإلا تقدير من موضع القسم
            let pct: number | null = null
            const b = bookRef.current
            if (typeof start.percentage === 'number' && start.percentage > 0) {
              pct = start.percentage * 100
            } else if (b) {
              try {
                if (b.locations && b.locations.length() > 0) {
                  const p = b.locations.percentageFromCfi(start.cfi)
                  if (typeof p === 'number' && p > 0) pct = p * 100
                }
              } catch {
                /* ignore */
              }
            }
            if (pct == null) {
              const total = spineCount()
              if (total > 1) {
                const idx = typeof start.index === 'number' ? start.index : lastSpineIndexRef.current
                pct = clamp(((idx + 0.5) / total) * 100, 0, 100)
              } else {
                // كتاب بقسم واحد — لا نتراجع عن آخر نسبة معروفة
                pct = lastPctRef.current
              }
            }
            lastPctRef.current = pct
            setProgress(pct)
            onRelocateDebounced(pct, start.cfi)
          }
        )

        rel.on('selected', (cfiRange: string, contents: Contents) => {
          handleEpubSelection(cfiRange, contents)
        })

        // إعادة رسم التعليقات المحفوظة
        for (const a of useReader.getState().annotations) {
          if (!a.cfi || attachedIdsRef.current.has(a.id)) continue
          attachEpubAnnotation(rel, a.type, a.cfi, a.color)
          attachedIdsRef.current.add(a.id)
        }

        setReady(true)
        onDocReady({ toc, handle, percent: lastPctRef.current })

        // حساب المواقع للتقدم الدقيق (في الخلفية)
        void epubBook.ready
          .then(() => epubBook.locations.generate(1200))
          .then(() => {
            if (destroyed) return
            // تنفيذ أي قفزة نسبة مؤجلة بانتظار حساب المواقع
            const pending = pendingPercentRef.current
            if (pending != null) {
              pendingPercentRef.current = null
              handle.displayAtPercent(pending)
            }
            // تحديث النسبة الحالية بدقة بعد اكتمال المواقع
            if (flowRef.current !== 'scrolled') {
              const cfi = lastCfiRef.current
              if (cfi) {
                try {
                  const p = epubBook.locations.percentageFromCfi(cfi)
                  if (typeof p === 'number' && p > 0) {
                    lastPctRef.current = p * 100
                    setProgress(p * 100)
                    onRelocateDebounced(p * 100, cfi)
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          })
          .catch(() => undefined)
      } catch (e) {
        console.error('epub load failed:', e, (e as Error)?.stack)
        if (!destroyed) setFailed(true)
      }
    })()

    return () => {
      destroyed = true
      onRelocateDebounced.cancel?.()
      try {
        renditionRef.current?.destroy()
      } catch {
        /* ignore */
      }
      try {
        bookRef.current?.destroy()
      } catch {
        /* ignore */
      }
      renditionRef.current = null
      bookRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // مستمع التمرير لوضع scrolled — تحديث النسبة أثناء التمرير
  useEffect(() => {
    if (!ready) return
    const el = scrollerEl()
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (flowRef.current === 'scrolled') reportScrollRef.current(false)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ready, scrollerEl])

  // عجلة الفأرة على حاوية التطبيق (المنطقة حول iframe) في وضع الصفحات
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const handler = wheelFlip as unknown as EventListener
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [wheelFlip])

  // ---------- التحديد داخل iframe ----------
  const handleEpubSelection = useCallback(
    (cfiRange: string, contents: Contents) => {
      try {
        const win = contents.window
        const sel = win.getSelection()
        if (!sel || sel.isCollapsed) return
        const text = sel.toString().replace(/\s+/g, ' ').trim()
        if (!text) return
        const range = sel.getRangeAt(0).cloneRange()
        const rect = range.getBoundingClientRect()
        const frameEl = (
          contents.document.defaultView as unknown as { frameElement: HTMLIFrameElement | null }
        ).frameElement
        if (!frameEl) return
        const frameRect = frameEl.getBoundingClientRect()
        reader.setSelection({
          text,
          cfiRange,
          rect: {
            x: frameRect.left + rect.left,
            y: frameRect.top + rect.top,
            w: rect.width,
            h: rect.height
          },
          removeEpubSelection: () => {
            win.getSelection()?.removeAllRanges()
          }
        })
      } catch (e) {
        console.warn('selection', e)
      }
    },
    [reader]
  )

  // إنشاء تعليق EPUB (تستدعيه لوحة التحديد المشتركة)
  useEffect(() => {
    ;(
      window as unknown as {
        __epubCreateAnnotation?: (
          type: 'highlight' | 'underline' | 'note',
          color: string
        ) => Promise<void>
      }
    ).__epubCreateAnnotation = async (type, color) => {
      const sel = reader.selection
      const rel = renditionRef.current
      if (!sel?.cfiRange || !rel) return
      await reader.addAnnotation({
        id: `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        bookId: book.id,
        type,
        color,
        page: null,
        cfi: sel.cfiRange,
        rects: null,
        text: sel.text,
        note: ''
      })
      attachEpubAnnotation(rel, type, sel.cfiRange, color)
      sel.removeEpubSelection?.()
      window.getSelection()?.removeAllRanges()
      reader.setSelection(null)
      if (type === 'note') reader.setSidebarPanel('annotations')
    }
    return () => {
      delete (window as unknown as { __epubCreateAnnotation?: unknown }).__epubCreateAnnotation
    }
  }, [reader, book.id])

  // مزامنة الرسم عند إضافة/حذف تعليقات
  const prevAnnsRef = useRef<Array<{ id: string; cfi: string | null; type: string }>>([])
  useEffect(() => {
    const rel = renditionRef.current
    if (!rel || !ready) {
      prevAnnsRef.current = reader.annotations.map((a) => ({ id: a.id, cfi: a.cfi, type: a.type }))
      return
    }
    const prevIds = new Set(prevAnnsRef.current.map((a) => a.id))
    for (const a of reader.annotations) {
      if (!prevIds.has(a.id) && a.cfi && !attachedIdsRef.current.has(a.id)) {
        attachEpubAnnotation(rel, a.type, a.cfi, a.color)
        attachedIdsRef.current.add(a.id)
      }
    }
    const curIds = new Set(reader.annotations.map((a) => a.id))
    for (const prev of prevAnnsRef.current) {
      if (!curIds.has(prev.id) && prev.cfi) {
        try {
          rel.annotations.remove(prev.cfi, prev.type === 'underline' ? 'underline' : 'highlight')
        } catch {
          /* ignore */
        }
        attachedIdsRef.current.delete(prev.id)
      }
    }
    prevAnnsRef.current = reader.annotations.map((a) => ({ id: a.id, cfi: a.cfi, type: a.type }))
  }, [reader.annotations, ready])

  // تطبيق تغييرات الإعدادات فورًا + تبديل وضع العرض عبر rel.flow() الرسمي
  useEffect(() => {
    const rel = renditionRef.current
    if (!rel || !ready) return
    applyAllThemes(rel, settings)
    rel.themes.fontSize(`${settings.fontSize}%`)
    if (settings.flow !== flowRef.current) {
      flowRef.current = settings.flow
      try {
        // epub.js يوفر تبديلًا رسميًا للوضع: يعدّل المحور و overflow الحاوية
        rel.flow(settings.flow === 'scrolled' ? 'scrolled-doc' : 'paginated')
        void rel.display(lastCfiRef.current ?? undefined)
      } catch (e) {
        console.warn('flow switch failed', e)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, ready])

  const isScrolled = settings.flow === 'scrolled'

  return (
    <div className="relative flex-1 overflow-hidden bg-[#e9e7e2] dark:bg-[#101216]">
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <p className="text-lg font-semibold">تعذر فتح هذا الكتاب</p>
          <p className="text-sm opacity-60">قد يكون الملف تالفًا</p>
        </div>
      ) : (
        /* الهوامش تُطبق هنا — تعمل بشكل صحيح في الوضعين معًا */
        <div
          className="h-full w-full"
          style={{
            paddingTop: `${Math.max(0, settings.marginTop)}%`,
            paddingBottom: `${Math.max(0, settings.marginBottom)}%`,
            paddingLeft: `${Math.max(0, settings.marginLeft)}%`,
            paddingRight: `${Math.max(0, settings.marginRight)}%`
          }}
        >
          <div
            ref={viewerRef}
            className={isScrolled ? 'h-full w-full overflow-y-auto' : 'h-full w-full overflow-hidden'}
          />
        </div>
      )}
    </div>
  )
}

export function attachEpubAnnotation(
  rendition: Rendition,
  type: 'highlight' | 'underline' | 'note',
  cfiRange: string,
  color: string
): void {
  try {
    const kind = type === 'underline' ? 'underline' : 'highlight'
    rendition.annotations.add(kind, cfiRange, {}, () => {}, `ann-${Math.random().toString(36).slice(2)}`, {
      fill: color,
      'fill-opacity': type === 'highlight' ? '0.35' : '0',
      'stroke': color,
      'stroke-opacity': type === 'highlight' ? '0.25' : '1',
      'mix-blend-mode': 'multiply'
    })
  } catch (e) {
    console.warn('attach annotation', e)
  }
}

function flattenNav(items: NavItem[]): TocEntry[] {
  const out: TocEntry[] = []
  for (const it of items) {
    out.push({
      label: it.label?.trim() || '—',
      href: it.href,
      children: it.subitems ? flattenNav(it.subitems) : []
    })
  }
  return out
}

export function fontFamilyStack(id: string): string {
  switch (id) {
    case 'arabic-serif':
      return "'Amiri', 'Traditional Arabic', 'Sakkal Majalla', 'Times New Roman', serif"
    case 'arabic-sans':
      return "'Cairo', 'Segoe UI', 'Tajawal', sans-serif"
    case 'tajawal':
      return "'Tajawal', 'Segoe UI', sans-serif"
    case 'tajawal-bold':
      return "'Tajawal', 'Segoe UI', sans-serif"
    case 'naskh':
      return "'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', serif"
    case 'alexandria':
      return "'Alexandria', 'Cairo', 'Segoe UI', sans-serif"
    case 'bokra':
      return "'Bokra', 'Cairo', sans-serif"
    case 'el-messiri':
      return "'El Messiri', 'Amiri', serif"
    case 'serif':
      return "Georgia, 'Times New Roman', serif"
    default:
      return "'Segoe UI', Arial, sans-serif"
  }
}
