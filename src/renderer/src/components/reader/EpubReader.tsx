import { useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book as EpubBook, type Rendition, type Contents, type NavItem } from 'epubjs'
import type { Book } from '../../../../shared/types'
import { useReader, READER_FONTS, type ReaderSettings } from '@/stores/reader'
import { clamp } from '@/lib/utils'

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

export function EpubReader({ book, settings, onDocReady, onRelocate }: Props) {
  const reader = useReader()
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

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
    return `\n      ${fontFaces}\n      body { font-family: ${family} !important; font-weight: ${weight} !important; }\n      p, li, div { line-height: ${s.lineHeight} !important; }\n      p { text-align: ${align} !important; }\n      body {\n        padding-left: ${Math.max(0, s.marginLeft)}% !important;\n        padding-right: ${Math.max(0, s.marginRight)}% !important;\n        padding-top: ${Math.max(0, s.marginTop)}% !important;\n        padding-bottom: ${Math.max(0, s.marginBottom)}% !important;\n        box-sizing: border-box;\n      }\n      img { max-width: 100%; height: auto; display: block; margin: 0 auto; }\n    `
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

  // ---------- التهيئة ----------
  const lastCfiRef = useRef<string | null>(book.lastLocation ?? null)
  const [, setProgress] = useState(0)

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

        // استئناف آخر موضع
        const target = book.lastLocation && book.lastLocation.startsWith('epubcfi') ? book.lastLocation : undefined
        await rel.display(target ?? undefined)

        // الفهرس
        const nav = (await epubBook.loaded.navigation) as { toc: NavItem[] }
        const toc = flattenNav(nav.toc ?? [])

        const handle: EpubHandle = {
          next: () => void rel?.next(),
          prev: () => void rel?.prev(),
          goToCfi: (cfi) => void rel?.display(cfi),
          goToHref: (href) => void rel?.display(href),
          displayAtPercent: (p) => {
            const b = bookRef.current
            if (!b || !b.locations || b.locations.length() === 0) return
            const total = b.locations.length()
            const idx = Math.round((clamp(p, 0, 100) / 100) * total)
            const cfi = (b.locations as unknown as { [i: number]: string })[idx === 0 ? 0 : Math.min(idx - 1, total - 1)]
            if (cfi) void rel?.display(cfi)
          },
          applySettings: (s) => {
            if (!rel) return
            applyAllThemes(rel, s)
            rel.themes.fontSize(`${s.fontSize}%`)
          },
          currentCfi: () => lastCfiRef.current
        }

        // الأحداث
        rel.on('relocated', (location: { start: { cfi: string; percentage?: number; href?: string }; end: unknown }) => {
          const pct = Math.round((location.start.percentage ?? 0) * 10000) / 100
          lastCfiRef.current = location.start.cfi
          setProgress(pct)
          onRelocateDebounced(pct, location.start.cfi)
        })

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
        onDocReady({ toc, handle, percent: 0 })

        // حساب المواقع للتقدم الدقيق (في الخلفية)
        void epubBook.ready
          .then(() => epubBook.locations.generate(1200))
          .catch(() => undefined)
      } catch (e) {
        console.error('epub load failed:', e, (e as Error)?.stack)
        if (!destroyed) setFailed(true)
      }
    })()

    const onRelocateDebounced = debounceCb((pct: number, cfi: string) => {
      onRelocate(pct, cfi)
    }, 600)

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

  // تطبيق تغييرات الإعدادات فورًا
  const flowRef = useRef(settings.flow)
  useEffect(() => {
    const rel = renditionRef.current
    if (!rel || !ready) return
    applyAllThemes(rel, settings)
    rel.themes.fontSize(`${settings.fontSize}%`)
    if (settings.flow !== flowRef.current) {
      flowRef.current = settings.flow
      try {
        ;(rel.book.settings as unknown as { flow: string }).flow =
          settings.flow === 'scrolled' ? 'scrolled-doc' : 'paginated'
        void rel.display(lastCfiRef.current ?? undefined)
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, ready])

  return (
    <div className="relative flex-1 overflow-hidden bg-[#e9e7e2] dark:bg-[#101216]">
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <p className="text-lg font-semibold">تعذر فتح هذا الكتاب</p>
          <p className="text-sm opacity-60">قد يكون الملف تالفًا</p>
        </div>
      ) : (
        <div ref={viewerRef} className="h-full w-full" />
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

void READER_FONTS
