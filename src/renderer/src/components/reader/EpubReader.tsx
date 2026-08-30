import { useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book as EpubBook, type Rendition, type Contents, type NavItem } from 'epubjs'
import type { Book } from '../../../../shared/types'
import { useReader, type ReaderSettings } from '@/stores/reader'
import { clamp, isMobilePlatform, isRtlLang } from '@/lib/utils'
import { useMobilePrefs } from '@/stores/mobilePrefs'
import { searchEpub, collectSectionChunks, type EpubSearchMatch, type TtsChunk } from '@/lib/epubSearch'

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
  /** href للقسم الحالي — يُستخدم لإظهار اسم الفصل في شريط المعلومات */
  currentHref(): string | null
  // بحث داخل الكتاب (النسخة 2)
  search(q: string, onProgress?: (done: number, total: number) => void): Promise<EpubSearchMatch[]>
  clearSearch(): void
  goToSearchMatch(m: EpubSearchMatch): void
  // فقرات القسم الحالي للقراءة الصوتية (النسخة 2)
  getTtsChunks(): Promise<TtsChunk[]>
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
          img, svg, video { filter: brightness(0.85); }`,
  paper: `body { background: #e8e6e1 !important; color: #3a3a3a !important; }
         a { color: #0d7a72 !important; }`,
  green: `body { background: #e3ece1 !important; color: #2f4432 !important; }
         a { color: #2d6a4f !important; }`,
  rose: `body { background: #f5e4e0 !important; color: #5c3a34 !important; }
         a { color: #b05f52 !important; }`,
  amber: `body { background: #0d0c0a !important; color: #d9a441 !important; }
          a { color: #f0c060 !important; }
          img, svg, video { filter: brightness(0.8) sepia(0.25); }`,
  slate: `body { background: #101720 !important; color: #a8c0d8 !important; }
          a { color: #7cc4f8 !important; }
          img, svg, video { filter: brightness(0.85); }`
}

/** خلفية صفحة القراءة نفسها — تجعل سطح القراءة يملأ الشاشة كلها بلا حواف رمادية */
const THEME_BG: Record<string, string> = {
  day: '#ffffff',
  sepia: '#f4ecd8',
  paper: '#e8e6e1',
  green: '#e3ece1',
  rose: '#f5e4e0',
  night: '#17191e',
  amber: '#0d0c0a',
  slate: '#101720'
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
  const isContinuousRef = useRef(false)
  const rtlRef = useRef(isRtlLang(book.language))
  const flipCooldownRef = useRef(0)
  const lastHrefRef = useRef<string | null>(null)
  // حاوية الحركة — تُحرّك عند قلب الصفحة على الجوال (انزلاق خفيف)
  const flipAnimElRef = useRef<HTMLDivElement | null>(null)
  // كبت نقرة قلب الصفحة بعد فتح محرر الملاحظة بالنقر على تعليم
  const annTapSupRef = useRef(0)

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
      @font-face { font-family: 'Amiri'; src: url('${f('Amiri-Regular.ttf')}') format('truetype'); font-weight: 400; font-display: swap; }
      @font-face { font-family: 'Amiri'; src: url('${f('Amiri-Bold.ttf')}') format('truetype'); font-weight: 700; font-display: swap; }
      @font-face { font-family: 'Cairo'; src: url('${f('Cairo-Variable.ttf')}') format('truetype'); font-display: swap; }
      @font-face { font-family: 'Tajawal'; src: url('${f('Tajawal-Regular.ttf')}') format('truetype'); font-weight: 400; font-display: swap; }
      @font-face { font-family: 'Tajawal'; src: url('${f('Tajawal-Bold.ttf')}') format('truetype'); font-weight: 700; font-display: swap; }
      @font-face { font-family: 'Noto Naskh Arabic'; src: url('${f('NotoNaskhArabic-Variable.ttf')}') format('truetype'); font-display: swap; }
      @font-face { font-family: 'Alexandria'; src: url('${f('Alexandria.ttf')}') format('truetype'); font-display: swap; }
      @font-face { font-family: 'Bokra'; src: url('${f('Bokra.ttf')}') format('truetype'); font-display: swap; }
      @font-face { font-family: 'El Messiri'; src: url('${f('ElMessiri.ttf')}') format('truetype'); font-display: swap; }
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
    // المحاذاة تُفرض على كل العناصر الكتلية + الجذر — كثير من الكتب تستخدم div بدل p
    // وتحمل أنماطها الخاصة فكانت الإعدادات تبدو «لا تعمل»
    return `\n      ${fontFaces}\n      body { font-family: ${family} !important; font-weight: ${weight} !important; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }\n      p, li, div { line-height: ${s.lineHeight} !important; }\n      body, p, div, li, blockquote, figcaption, dd, dt, td, th, h1, h2, h3, h4, h5, h6 { text-align: ${align} !important; }\n      img { max-width: 100%; height: auto; display: block; margin: 0 auto; }\n    `
  }, [])

  const attachedIdsRef = useRef(new Set<string>())
  const cssRef = useRef('')
  const styleElsRef = useRef<Set<HTMLStyleElement>>(new Set())
  // مؤثرات نتائج البحث المرسومة حاليًا (النسخة 2)
  const searchHighlightsRef = useRef<string[]>([])

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

  // حساب النسبة في وضع التمرير:
  // - المدير continuous: التمرير يشمل الكتاب كله → النسبة = جزء التمرير مباشرة
  // - scrolled-doc داخل مدير افتراضي: (مؤشر القسم + نسبة التمرير داخله) / الأقسام
  const reportScrollProgress = useCallback((immediate = false): void => {
    const el = scrollerEl()
    const b = bookRef.current
    if (!el || !b) return
    const max = el.scrollHeight - el.clientHeight
    const frac = max > 0 ? clamp(el.scrollTop / max, 0, 1) : 0
    const total = spineCount()
    const idx = lastSpineIndexRef.current
    const pct = isContinuousRef.current
      ? clamp(frac * 100, 0, 100)
      : total
        ? clamp(((idx + frac) / total) * 100, 0, 100)
        : lastPctRef.current
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

  // ---------- طابور تنقل موثوق — يمنع «وقوف» قلب الصفحات ----------
  // epub.js يتجاهل next/prev أحيانًا أثناء إعادة رسم الفصل ووعدُه لا يُحل أبدًا،
  // فتتساقط النقرات ويبدو القارئ عالقًا. الحل: طابور يتراكم عليه الطلب مع
  // تحرير إجباري بالمهلة، فكل نقرة تُطبق بالترتيب مهما كان التوقيت.
  const navBusyRef = useRef(false)
  const pendingNavRef = useRef(0) // موجب = للأمام، سالب = للخلف (تراكم حتى ±4)

  const drainNav = useCallback(async (): Promise<void> => {
    if (navBusyRef.current) return
    navBusyRef.current = true
    try {
      while (pendingNavRef.current !== 0) {
        const rel = renditionRef.current
        if (!rel) break
        const dir = pendingNavRef.current > 0 ? 1 : -1
        pendingNavRef.current -= dir
        await Promise.race([
          dir > 0 ? rel.next() : rel.prev(),
          new Promise<void>((r) => setTimeout(r, 5000))
        ])
      }
    } catch {
      /* ignore */
    } finally {
      navBusyRef.current = false
    }
  }, [])

  const queueFlip = useCallback(
    (dir: 1 | -1): void => {
      pendingNavRef.current = Math.max(-4, Math.min(4, pendingNavRef.current + dir))
      void drainNav()
    },
    [drainNav]
  )

  // حركة انزلاق خفيفة عند القلب (جوال فقط، قابلة للتعطيل من إعدادات التحكم)
  const animateFlip = useCallback((dir: 1 | -1): void => {
    try {
      if (!isMobilePlatform()) return
      if (useMobilePrefs.getState().prefs.flipAnim === 'none') return
      const el = flipAnimElRef.current
      if (!el || typeof el.animate !== 'function') return
      const dirX = (rtlRef.current ? -1 : 1) * dir * -20
      const anim = el.animate(
        [
          { transform: 'translateX(0)', opacity: 1 },
          { transform: `translateX(${dirX}px)`, opacity: 0.4 }
        ],
        { duration: 110, easing: 'ease-in' }
      )
      anim.finished
        .then(() => {
          el.animate(
            [
              { transform: `translateX(${dirX * 0.5}px)`, opacity: 0.55 },
              { transform: 'translateX(0)', opacity: 1 }
            ],
            { duration: 160, easing: 'ease-out' }
          )
        })
        .catch(() => {})
    } catch {
      /* ignore */
    }
  }, [])
  const animateFlipRef = useRef(animateFlip)
  useEffect(() => {
    animateFlipRef.current = animateFlip
  }, [animateFlip])

  // خطاف تشخيصي للاختبارات — حالة طابور التنقل
  const navInfoRef = useRef<() => { busy: boolean; pending: number }>(() => ({ busy: false, pending: 0 }))
  useEffect(() => {
    navInfoRef.current = () => ({ busy: navBusyRef.current, pending: pendingNavRef.current })
  })

  // فتح محرر الملاحظة عند النقر على تعليم — يُستخدم من ردود فعل epub.js
  const openNoteFor = useCallback((id: string): void => {
    // كبت نقرة قلب الصفحة — النقر على التعليم لا يجب أن يقلب أيضًا
    annTapSupRef.current = Date.now()
    const st = useReader.getState()
    const cur = st.annotations.find((x) => x.id === id)
    if (cur) st.setNoteEditor(cur)
  }, [])

  // ---------- التنقل (متوافق مع الوضعين) ----------
  const next = useCallback((): void => {
    if (flowRef.current === 'paginated') animateFlipRef.current(1)
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
    queueFlip(1)
  }, [scrollerEl, queueFlip])

  const prev = useCallback((): void => {
    if (flowRef.current === 'paginated') animateFlipRef.current(-1)
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
    queueFlip(-1)
  }, [scrollerEl, queueFlip])

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

        // وضع التمرير = مدير continuous (الكتاب كله تحت بعضه في تمرير واحد عمودي)
        // وضع الصفحات = المدير الافتراضي paginated
        const useContinuous = settings.flow === 'scrolled'
        isContinuousRef.current = useContinuous
        flowRef.current = settings.flow
        rel = epubBook.renderTo(viewerRef.current!, {
          width: '100%',
          height: '100%',
          manager: useContinuous ? 'continuous' : 'default',
          flow: useContinuous ? 'scrolled-continuous' : 'paginated',
          spread: 'none',
          // لا فجوات داخلية بين الأعمدة — النص يملأ العرض المتاح
          // والهوامش يتحكم فيها المستخدم من الإعدادات وتُطبق على منطقة النص نفسها
          gap: 0,
          allowScriptedContent: false
        } as Parameters<EpubBook['renderTo']>[1])
        renditionRef.current = rel
        // خطاف تشخيصي (يستخدمه الاختبار أيضًا)
        ;(window as unknown as { __epubRendition?: Rendition }).__epubRendition = rel
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
            doc.addEventListener('click', (e) => onTapZoneInFrame(e as MouseEvent, doc))

            // سحب أفقي داخل الكتاب لقلب الصفحات — الجوال يلمس iframe دائمًا
            // وليس الحاوية الأم، لذا كان التقليب بالسحب لا يعمل على التليفون
            let sw: { x: number; y: number; id: number } | null = null
            doc.addEventListener('touchstart', (e) => {
              if (e.touches.length !== 1) {
                sw = null
                return
              }
              const t = e.touches[0]
              sw = { x: t.clientX, y: t.clientY, id: t.identifier }
            }, { passive: true })
            doc.addEventListener(
              'touchend',
              (e) => {
                const start = sw
                sw = null
                if (!start || flowRef.current !== 'paginated') return
                const t = e.changedTouches[0]
                const dx = t.clientX - start.x
                const dy = t.clientY - start.y
                // سحب أفقي واضح فقط — لا نعترض التمرير العمودي
                if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return
                const ds = doc.getSelection?.()
                if (ds && !ds.isCollapsed) return
                const toNext = rtlRef.current ? dx > 0 : dx < 0
                if (toNext) nextRef.current()
                else prevRef.current()
              },
              { passive: true }
            )

            // كليك يمين: نمنع قائمة النظام دائمًا — مع تحديد نصّ تبقى لوحة
            // أدواتنا (تعليم/كومنت/نسخ/قراءة) ظاهرة فوق التحديد
            doc.addEventListener('contextmenu', (e) => {
              e.preventDefault()
              e.stopPropagation()
            })
          } catch {
            /* ignore */
          }
        })

        // تحميل الخطوط المدمجة مسبقًا حتى لا يُرسم الكتاب بخط بديل ثم يقفز
        try {
          const fams = ['Amiri', 'Cairo', 'Tajawal', 'Noto Naskh Arabic', 'Alexandria', 'Bokra', 'El Messiri']
          await Promise.all(fams.map((f) => document.fonts.load(`16px "${f}"`, 'أبجد هوز')))
        } catch {
          /* ignore */
        }

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
          currentCfi: () => lastCfiRef.current,
          currentHref: () => lastHrefRef.current,
          // ---------- بحث داخل الكتاب ----------
          search: async (q, onProgress) => {
            const b = bookRef.current
            if (!b || !rel) return []
            clearSearchHighlights()
            const res = await searchEpub(b, q, onProgress)
            for (const m of res) {
              try {
                rel.annotations.add(
                  'highlight',
                  m.cfi,
                  {},
                  () => {},
                  `sr-${Math.random().toString(36).slice(2)}`,
                  {
                    fill: '#38bdf8',
                    'fill-opacity': '0.3',
                    stroke: '#38bdf8',
                    'stroke-opacity': '0.55',
                    'mix-blend-mode': 'multiply'
                  }
                )
                searchHighlightsRef.current.push(m.cfi)
              } catch {
                /* تجاهل مطابقة لا يمكن رسمها */
              }
            }
            return res
          },
          clearSearch: clearSearchHighlights,
          goToSearchMatch: (m) => {
            void rel?.display(m.pointCfi || m.cfi)
          },
          // ---------- فقرات القسم الحالي للقراءة الصوتية ----------
          getTtsChunks: async () => {
            const b = bookRef.current
            if (!b) return []
            try {
              return await collectSectionChunks(b, lastCfiRef.current)
            } catch {
              return []
            }
          }
        }

        function clearSearchHighlights(): void {
          const r = renditionRef.current
          if (!r) return
          for (const c of searchHighlightsRef.current) {
            try {
              r.annotations.remove(c, 'highlight')
            } catch {
              /* ignore */
            }
          }
          searchHighlightsRef.current = []
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
            // إخفاء لوحة التحديد عند القلب — لا نتركها عائمة فوق موضع قديم
            const rst = useReader.getState()
            if (rst.selection) rst.setSelection(null)
            lastCfiRef.current = start.cfi
            if (typeof start.href === 'string') lastHrefRef.current = start.href
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

        // إعادة رسم التعليقات المحفوظة (وأيضًا بعد إعادة بناء القارئ عند تبديل وضع العرض)
        for (const a of useReader.getState().annotations) {
          if (!a.cfi || attachedIdsRef.current.has(a.id)) continue
          attachEpubAnnotation(rel, a.type, a.cfi, a.color, () => openNoteFor(a.id))
          attachedIdsRef.current.add(a.id)
        }
        // إعادة رسم نتائج البحث بعد إعادة البناء
        const st = useReader.getState()
        if (st.epubMatches.length) {
          for (const m of st.epubMatches) {
            try {
              rel.annotations.add(
                'highlight',
                m.cfi,
                {},
                () => {},
                `sr-${Math.random().toString(36).slice(2)}`,
                {
                  fill: '#38bdf8',
                  'fill-opacity': '0.3',
                  stroke: '#38bdf8',
                  'stroke-opacity': '0.55',
                  'mix-blend-mode': 'multiply'
                }
              )
              searchHighlightsRef.current.push(m.cfi)
            } catch {
              /* تجاهل */
            }
          }
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
      // القارئ الجديد يبدأ من الصفر — التعليقات/نتائج البحث تُعاد رسمها في التهيئة
      attachedIdsRef.current.clear()
      searchHighlightsRef.current = []
      setReady(false)
    }
    // يعاد البناء عند تبديل وضع العرض (paginated ↔ scrolled-continuous)
    // لأن مدير العرض (default/continuous) لا يمكن تبديله أثناء التشغيل
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.flow])

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
      attachEpubAnnotation(rel, type, sel.cfiRange, color, () => openNoteFor(useReader.getState().annotations[0]?.id ?? ''))
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
        attachEpubAnnotation(rel, a.type, a.cfi, a.color, () => openNoteFor(a.id))
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
  // الهوامش/الخط/تباعد الأسطر = إعادة تخطيط كاملة للأعمدة (rel.resize)
  // حتى يتحرك النص ويلتف مثل «الورد» — بدل بقاء الأعمدة بعرض قديم
  // فتختفي أجزاء من الكلام تحت الهوامش (مشكلة الإزاحة التي يغطي على الكلام)
  const geomKey = `${settings.marginLeft}:${settings.marginRight}:${settings.marginTop}:${settings.marginBottom}:${settings.fontSize}:${settings.lineHeight}:${settings.fontFamily}`
  const prevGeomKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const rel = renditionRef.current
    if (!rel || !ready) {
      prevGeomKeyRef.current = geomKey
      return
    }
    flowRef.current = settings.flow
    applyAllThemes(rel, settings)
    rel.themes.fontSize(`${settings.fontSize}%`)
    if (prevGeomKeyRef.current !== geomKey) {
      const first = prevGeomKeyRef.current === null
      prevGeomKeyRef.current = geomKey
      if (!first) {
        // إعادة تخطيط ثم العودة لنفس الموضع القرائي
        // ('100%' نصيًا — epub.js يقبلها داخليًا رغم التوقيع الرقمي في التعريفات)
        try {
          ;(rel as unknown as { resize(w: unknown, h: unknown): void }).resize('100%', '100%')
        } catch (e) {
          console.warn('epub resize failed', e)
        }
        setTimeout(() => {
          try {
            void renditionRef.current?.display(lastCfiRef.current ?? undefined)
          } catch {
            /* ignore */
          }
        }, 60)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, ready, geomKey])

  const isScrolled = settings.flow === 'scrolled'

  // خطاف تشخيصي للاختبارات — وضع العرض الحالي ونوع المدير + طابور التنقل
  useEffect(() => {
    ;(window as unknown as { __epubFlowInfo?: () => { flow: string; continuous: boolean; ready: boolean } }).__epubFlowInfo = () => ({
      flow: flowRef.current,
      continuous: isContinuousRef.current,
      ready
    })
    ;(window as unknown as { __mkNavInfo?: () => { busy: boolean; pending: number } }).__mkNavInfo = navInfoRef.current
    return () => {
      delete (window as unknown as { __epubFlowInfo?: unknown }).__epubFlowInfo
      delete (window as unknown as { __mkNavInfo?: unknown }).__mkNavInfo
    }
  }, [ready])

  // ---------- سحب باللمس لقلب الصفحات (وضع الصفحات فقط) ----------
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  // ---------- مناطق لمس الجوال (تعمل داخل iframe الكتاب): الأطراف تقلب، الوسط يبدل الوضع الغامر ----------
  const onTapZoneInFrame = useCallback((e: MouseEvent, doc: Document): void => {
    try {
      // نقرة إنهاء لوحة التحديد: إذا كانت اللوحة ظاهرة والنقر بعدها → نظّف وأغلق فقط
      const rs = useReader.getState()
      const dsel = doc.getSelection?.()
      if (rs.selection && (!dsel || dsel.isCollapsed)) {
        rs.selection.removeEpubSelection?.()
        rs.setSelection(null)
        return
      }
      // النقر على تعليمٍ يفتح الملاحظة — لا نقلب الصفحة في نفس النقرة
      if (Date.now() - annTapSupRef.current < 450) return
      const w = window as unknown as { __mkForceTapZones?: boolean; __mkTapLog?: unknown[] }
      if (!isMobilePlatform() && !w.__mkForceTapZones) return
      const sel = doc.getSelection?.()
      if (sel && !sel.isCollapsed) return
      const width = doc.defaultView?.innerWidth ?? 0
      if (width <= 0) return
      const rx = e.clientX / width
      const rtl = rtlRef.current
      const log = (acted: string): void => {
        try {
          w.__mkTapLog = w.__mkTapLog || []
          w.__mkTapLog.push({ rx: Math.round(rx * 100) / 100, rtl, acted })
        } catch { /* ignore */ }
      }
      if (rx >= 0.76) {
        // الحافة اليمنى: كتب عربية = السابق، أخرى = التالي
        if (rtl) {
          log('prev')
          prevRef.current()
        } else {
          log('next')
          nextRef.current()
        }
      } else if (rx <= 0.24) {
        if (rtl) {
          log('next')
          nextRef.current()
        } else {
          log('prev')
          prevRef.current()
        }
      } else {
        // الوسط: فعل قابل للاختيار من إعدادات التحكم (وضع صافٍ أو لوحة الإعدادات)
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
    } catch {
      /* ignore */
    }
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent): void => {
    if (flowRef.current !== 'paginated') return
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent): void => {
    if (flowRef.current !== 'paginated') return
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // سحب أفقي واضح فقط — لا نعترض التمرير العمودي
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    // LTR: السحب لليسار = التالي. RTL (كتب عربية): السحب لليمين = التالي
    const toNext = rtlRef.current ? dx > 0 : dx < 0
    if (toNext) nextRef.current()
    else prevRef.current()
  }, [])

  return (
    <div
      className="relative flex-1 overflow-hidden"
      style={{ background: THEME_BG[settings.theme] ?? '#ffffff' }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <p className="text-lg font-semibold">تعذر فتح هذا الكتاب</p>
          <p className="text-sm opacity-60">قد يكون الملف تالفًا</p>
        </div>
      ) : (
        /* الهوامش تُطبق هنا — تعمل بشكل صحيح في الوضعين معًا، وخلفية الحاوية
           بلون السمة نفسه فتبدو الهوامش جزءًا من صفحة الكتاب (تطبيق مباشر على النص) */
        <div
          ref={flipAnimElRef}
          data-testid="epub-flip-layer"
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
  color: string,
  onClick?: () => void
): void {
  try {
    const kind = type === 'underline' ? 'underline' : 'highlight'
    rendition.annotations.add(kind, cfiRange, {}, () => onClick?.(), `ann-${Math.random().toString(36).slice(2)}`, {
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
