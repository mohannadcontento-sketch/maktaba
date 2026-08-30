import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  PanelLeft,
  ListTree,
  Highlighter,
  Bookmark,
  Search,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  BookMarked,
  Printer,
  Type,
  Volume2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useUi } from '@/stores/ui'
import { useReader, DEFAULT_READER_SETTINGS, READER_FONTS, READER_ALIGNS, type ReaderSettings } from '@/stores/reader'
import type { Book } from '../../../../shared/types'
import type { PdfHandle, TocItem } from '@/lib/pdfEngine'
import { PdfViewer } from './PdfViewer'
import type { EpubHandle, TocEntry } from './EpubReader'
import type { EpubSearchMatch } from '@/lib/epubSearch'
import { EpubReader } from './EpubReader'
import { SidePanel, SearchBar } from './SidePanels'
import { MoonSheet, MoonStatusBar, MoonBrightnessEdge, MoonTapFlash } from './MoonMobile'
import { useMobilePrefs } from '@/stores/mobilePrefs'
import { setVolumeKeys, setImmersive, setKeepAwake } from '@/platform/mkNative'
import { SelectionPopover } from './SelectionPopover'
import { NoteEditor } from './NoteEditor'
import { TtsBar } from './TtsBar'
import { WindowControls } from '@/components/layout/Chrome'
import { IconButton } from '@/components/ui/IconButton'
import { Button, Slider, Select } from '@/components/ui/kit'
import { cn, isMobilePlatform, isRtlLang } from '@/lib/utils'

type ReaderToc = TocItem[] | TocEntry[]

interface EngineState {
  toc: ReaderToc
  percent: number
}

/** البحث في شجرة الفهرس عن href يطابق القسم الحالي — لإ اسم الفصل في شريط المعلومات */
function findTocLabel(toc: ReaderToc, href: string | null | undefined): string | null {
  if (!href || !toc.length) return null
  const clean = (u: string): string =>
    u.split('?')[0].split('#')[0].replace(/^\.?\//, '')
  const target = clean(href)
  if (!target) return null
  const walk = (items: ReaderToc): string | null => {
    for (const it of items) {
      const e = it as TocEntry & TocItem
      const h = e.href ? clean(e.href) : ''
      if (h && (h === target || target.endsWith(h) || h.endsWith(target))) return e.label
      const kids = (e.children ?? (e as unknown as { items?: ReaderToc }).items) as ReaderToc | undefined
      if (kids?.length) {
        const r = walk(kids)
        if (r) return r
      }
    }
    return null
  }
  return walk(toc)
}

export function ReaderShell({ book }: { book: Book }) {
  const reader = useReader()
  const ui = useUi()
  const { t } = useTranslation()
  const isPdf = book.format === 'pdf'

  const [engine, setEngine] = useState<{
    pdf?: PdfHandle
    epub?: EpubHandle
  }>({})
  const [toc, setToc] = useState<ReaderToc>([])
  const [percent, setPercent] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [remainingMin, setRemainingMin] = useState<number | null>(null)
  // القراءة الصوتية (النسخة 2)
  const [ttsOpen, setTtsOpen] = useState(false)
  // قراءة النص المحدد فقط (النسخة 2.2)
  const [ttsSelection, setTtsSelection] = useState<string | null>(null)

  // ---------- تجربة الجوال على طريقة Moon+ Reader (v2.6) ----------
  const isMobile = isMobilePlatform()
  const mp = useMobilePrefs((s) => s.prefs)
  const [autoScrollOn, setAutoScrollOn] = useState(false)
  const [chapter, setChapter] = useState<string | null>(null)

  // تحميل تفضيلات الجوال مرة واحدة
  useEffect(() => {
    if (!isMobile) return
    void useMobilePrefs.getState().load()
  }, [isMobile])

  // أزرار الصوت للتقليب — مستمع JS يتصل به بلجن أندرويد الأصلي
  useEffect(() => {
    if (!isMobile) return
    const w = window as unknown as { __mkVolumeKey?: (d: 'up' | 'down') => void }
    w.__mkVolumeKey = (dir) => {
      // + للسابق، − للتالي (اصطلاح قارئ Moon+)
      if (isPdf) dir === 'up' ? engine.pdf?.prevPage() : engine.pdf?.nextPage()
      else dir === 'up' ? engine.epub?.prev() : engine.epub?.next()
    }
    return () => {
      delete w.__mkVolumeKey
    }
  }, [isMobile, isPdf, engine])

  // مزامنة راية أزرار الصوت مع الأصل (تُعطّل خروجًا من القارئ حتى لا تعطل الصوت)
  useEffect(() => {
    if (!isMobile) return
    void setVolumeKeys(mp.volumeKeys)
    return () => {
      void setVolumeKeys(false)
    }
  }, [isMobile, mp.volumeKeys])

  // إبقاء الشاشة مضاءة أثناء القراءة
  useEffect(() => {
    if (!isMobile) return
    void setKeepAwake(mp.keepAwake)
    return () => {
      void setKeepAwake(false)
    }
  }, [isMobile, mp.keepAwake])

  // ملء الشاشة (إخفاء أشرطة النظام) في الوضع الصافي على الجوال
  useEffect(() => {
    if (!isMobile) return
    void setImmersive(reader.zenMode)
  }, [isMobile, reader.zenMode])

  // التمرير التلقائي — EPUB: يقلب الصفحات على مهل / PDF: تمرير سلس داخل العارض نفسه (v2.7)
  useEffect(() => {
    if (!autoScrollOn) return
    const secs = [10, 8, 6.5, 5, 4, 3, 2.5, 2, 1.5, 1][Math.max(1, Math.min(10, mp.autoScrollSpeed)) - 1]
    if (isPdf) {
      engine.pdf?.setAutoScroll?.(true, secs)
      return () => {
        engine.pdf?.setAutoScroll?.(false, secs)
      }
    }
    const iv = setInterval(() => {
      engine.epub?.next()
    }, secs * 1000)
    return () => clearInterval(iv)
  }, [autoScrollOn, mp.autoScrollSpeed, isPdf, engine])

  // اسم الفصل الحالي لشريط المعلومات (EPUB)
  useEffect(() => {
    if (isPdf) return
    const href = engine.epub?.currentHref()
    if (href) setChapter(findTocLabel(toc, href))
  }, [percent, toc, engine, isPdf])

  // جسر: زر «قراءة المحدد» في لوحة التحديد → شريط القراءة الصوتية في وضع المحدد
  useEffect(() => {
    ;(window as unknown as { __maktabaSpeakSelection?: (text: string) => void }).__maktabaSpeakSelection = (
      text: string
    ) => {
      setTtsSelection(text)
      setTtsOpen(true)
    }
    return () => {
      delete (window as unknown as { __maktabaSpeakSelection?: unknown }).__maktabaSpeakSelection
    }
  }, [])

  // اتجاه التنقل حسب لغة الكتاب (عربي/عبري/فارسي... = يمين إلى يسار)
  const epubRtl = isRtlLang(book.language)

  // إعدادات القراءة: افتراضية عامة لكل التطبيق + طبقة خاصة بكل كتاب
  // (طلب المستخدم: «خلي كل كتاب مستقل في الإعدادات»)
  const bookSettingsKey = `reader.settings.book:${book.id}`
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [hasBookOverride, setHasBookOverride] = useState(false)
  const globalSettingsRef = useRef<ReaderSettings>(DEFAULT_READER_SETTINGS)

  // تحميل الافتراضي العام ثم فوقه إعدادات هذا الكتاب
  useEffect(() => {
    setSettingsLoaded(false)
    void (async () => {
      let g: ReaderSettings = DEFAULT_READER_SETTINGS
      try {
        const raw = await window.api.getSetting('reader.settings')
        if (raw) g = { ...g, ...(JSON.parse(raw) as Partial<ReaderSettings>) }
      } catch {
        /* ignore */
      }
      globalSettingsRef.current = g
      let merged = g
      let hasOverride = false
      try {
        const rawB = await window.api.getSetting(bookSettingsKey)
        if (rawB) {
          merged = { ...g, ...(JSON.parse(rawB) as Partial<ReaderSettings>) }
          hasOverride = true
        }
      } catch {
        /* ignore */
      }
      setHasBookOverride(hasOverride)
      setSettings(merged)
      setSettingsLoaded(true)
    })()
    // يعاد التحميل عند تبديل الكتاب
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // أي تعديل داخل القارئ يُحفظ لهذا الكتاب تحديدًا (لا يمس بقية الكتب)
  const updateSettings = useCallback(
    (patch: Partial<ReaderSettings>): void => {
      setSettings((prev) => {
        const next = { ...prev, ...patch }
        void window.api.setSetting(bookSettingsKey, JSON.stringify(next))
        setHasBookOverride(true)
        return next
      })
    },
    [bookSettingsKey]
  )

  // «طبّق على كل الكتب»: نسخ إعدادات الكتاب الحالي كافتراضي عام
  const applyToAllBooks = useCallback((): void => {
    void window.api.setSetting('reader.settings', JSON.stringify(settings))
    globalSettingsRef.current = settings
    ui.toast('صارت هذه الإعدادات الافتراضية لكل الكتب الجديدة', 'success')
  }, [settings, ui])

  // «استعادة الافتراضي»: حذف طبقة هذا الكتاب والعودة للعام
  const resetBookSettings = useCallback((): void => {
    void window.api.setSetting(bookSettingsKey, '')
    setHasBookOverride(false)
    setSettings(globalSettingsRef.current)
  }, [bookSettingsKey])

  // ---------- جاهزية المحرك ----------
  const epubHandleRef = useRef<EpubHandle | null>(null)
  // آخر موقع معروف في EPUB — يُمرر للقارئ عند إعادة الفتح
  const epubCfiRef = useRef<string | null>(book.lastLocation ?? null)

  const onPdfReady = useCallback(({ toc: tocItems, handle }: { toc: TocItem[]; handle: PdfHandle }): void => {
    setToc(tocItems)
    setEngine((prev) => ({ ...prev, pdf: handle }))
    setTotalPages(handle.numPages())
    setCurrentPage(handle.currentPage())
    // استعادة شريط التقدم من المحفوظ بدلًا من الظهور عند صفر
    setPercent(Math.min(99.9, book.progress || 0))
  }, [book.progress])

  const onEpubReady = useCallback(({ toc: tocItems, handle }: { toc: TocEntry[]; handle: EpubHandle; percent: number }): void => {
    epubHandleRef.current = handle
    setToc(tocItems)
    setEngine((prev) => ({ ...prev, epub: handle }))
    if (percent > 0) setPercent(percent)
  }, [])

  const onEpdfPageChange = useCallback((p: number): void => {
    setCurrentPage(p)
    const real = engine.pdf?.percent()
    if (real != null) setPercent(real)
    // الاحتياطي بنفس مقياس الصفحات (لا مقياس التمرير) حتى لا يقفز الشريط
    else setPercent(Math.min(100, (p / Math.max(1, engine.pdf?.numPages() ?? 1)) * 100))
  }, [engine])

  const onEpubRelocate = useCallback((pct: number, cfi: string): void => {
    epubCfiRef.current = cfi
    setPercent(pct)
    void reader.saveProgress(pct, cfi)
    // وقت متبقٍ تقريبي
    if (pct > 0 && pct < 100) {
      const totalWords = 60000 // تقدير عام يُحدَّث مع المواقع إن توفرت
      setRemainingMin(Math.max(1, Math.round(((100 - pct) / 100) * (totalWords / 200))))
    }
  }, [reader])

  // حالة العلامة المرجعية للصفحة/الموقع الحالي
  useEffect(() => {
    const loc = isPdf ? `p:${currentPage}` : lastCfiForBookmark
    setIsBookmarked(reader.bookmarks.some((b) => b.location === loc))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.bookmarks, currentPage, isPdf, percent])

  const [lastCfiForBookmark, setLastCfiForBookmark] = useState('')
  useEffect(() => {
    if (!isPdf) setLastCfiForBookmark(engine.epub?.currentCfi() ?? '')
  }, [percent, isPdf, engine])

  const toggleBookmark = async (): Promise<void> => {
    if (isPdf) {
      const loc = `p:${currentPage}`
      const existing = reader.bookmarks.find((b) => b.location === loc)
      if (existing) {
        await reader.removeBookmarkById(existing.id)
      } else {
        const ok = await reader.addBookmarkAt(loc, currentPage, null, `${t('reader.pageOf', { page: currentPage, total: totalPages }).replace(` ${t('common.of')} `, '/')}`)
        if (ok) ui.toast(t('reader.bookmarkAdded'), 'success')
      }
    } else {
      const cfi = engine.epub?.currentCfi()
      if (!cfi) return
      const existing = reader.bookmarks.find((b) => b.location === cfi)
      if (existing) await reader.removeBookmarkById(existing.id)
      else {
        const ok = await reader.addBookmarkAt(cfi, null, null, `${Math.round(percent)}%`)
        if (ok) ui.toast(t('reader.bookmarkAdded'), 'success')
      }
    }
  }

  // خطافات بحث EPUB للشريط الموحد (النسخة 2)
  useEffect(() => {
    const w = window as unknown as {
      __epubSearchRunner?: (q: string) => Promise<void>
      __epubSearchJump?: (m: EpubSearchMatch) => void
      __epubSearchClear?: () => void
    }
    w.__epubSearchRunner = async (q: string) => {
      const h = engine.epub
      if (!h) return
      useReader.getState().setEpubSearching(true)
      try {
        const res = await h.search(q)
        useReader.getState().setEpubMatches(res)
        if (res.length) h.goToSearchMatch(res[0])
      } finally {
        useReader.getState().setEpubSearching(false)
      }
    }
    w.__epubSearchJump = (m) => engine.epub?.goToSearchMatch(m)
    w.__epubSearchClear = () => engine.epub?.clearSearch()
    return () => {
      delete w.__epubSearchRunner
      delete w.__epubSearchJump
      delete w.__epubSearchClear
    }
  }, [engine.epub])

  // ---------- اختصارات لوحة المفاتيح ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          // في الكتب العربية (RTL) السهم اليمين يعود للخلف، وفي PDF يتقدم للأمام
          if (isPdf) engine.pdf?.nextPage()
          else if (epubRtl) engine.epub?.prev()
          else engine.epub?.next()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (isPdf) engine.pdf?.prevPage()
          else if (epubRtl) engine.epub?.next()
          else engine.epub?.prev()
          break
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault()
          isPdf ? engine.pdf?.nextPage() : engine.epub?.next()
          break
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault()
          isPdf ? engine.pdf?.prevPage() : engine.epub?.prev()
          break
        case '+':
          engine.pdf?.zoomIn()
          break
        case '-':
          engine.pdf?.zoomOut()
          break
        case 'f':
        case 'F':
          if (isPdf) {
            // البحث الرسمي داخل عارض موزيلا (شريطه الخاص)
            e.preventDefault()
            void engine.pdf?.runSearch('')
          } else {
            e.preventDefault()
            reader.setSearchOpen(true)
          }
          break
        case 'b':
        case 'B':
          void toggleBookmark()
          break
        case 'F11':
          e.preventDefault()
          reader.setZen(!reader.zenMode)
          break
        case 'p':
        case 'P':
          e.preventDefault()
          // القراءة الصوتية: تشغيل/إيقاف مؤقت (النسخة 2)
          if (ttsOpen) (window as unknown as { __ttsToggle?: () => void }).__ttsToggle?.()
          else setTtsOpen(true)
          break
        case 'Escape':
          if (reader.zenMode) reader.setZen(false)
          else if (reader.searchOpen && !isPdf) {
            reader.setSearchOpen(false)
            useReader.getState().setEpubQuery('')
            useReader.getState().setEpubMatches([])
            engine.epub?.clearSearch()
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, isPdf, reader.zenMode, reader.searchOpen, currentPage, percent, totalPages, reader.bookmarks, ttsOpen])

  const goBack = (): void => {
    reader.close()
    ui.setPage('library')
    void useLibraryRefresh()
  }

  const zen = reader.zenMode

  return (
    <div
      className="flex h-full flex-col"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* الشريط العلوي — مع مساحة أمان الشاشات النافذة على الجوال */}
      {!zen && (
        <header className="drag-region relative z-30 flex h-[calc(52px+env(safe-area-inset-top,0px))] shrink-0 select-none items-center gap-1 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top,0px)] dark:border-dline dark:bg-dsurface">
          <IconButton title={t('reader.backToLibrary')} onClick={goBack} className="no-drag">
            <ArrowRight size={18} />
          </IconButton>
          <div className="no-drag mx-1 min-w-0 max-w-[280px]">
            <p className="truncate text-sm font-semibold leading-tight">{book.title}</p>
            <p className="truncate text-[11px] text-muted">{book.author}</p>
          </div>

          <span className="mx-2 h-6 w-px bg-line dark:bg-dline" />

          {/* الفهرس: EPUB دائمًا — PDF على الجوال فقط (شريط موزيلا مخفي في وضع Moon+) */}
          {!zen && (!isPdf || isMobile) && (
            <IconButton title="اللوحة الجانبية" active={!!reader.sidebarPanel} onClick={() => reader.setSidebarPanel(reader.sidebarPanel === 'toc' ? null : 'toc')}>
              <ListTree size={17} />
            </IconButton>
          )}
          {!isPdf && (
            <IconButton title={t('reader.searchDoc')} active={reader.searchOpen} onClick={() => reader.toggleSearch()}>
              <Search size={17} />
            </IconButton>
          )}
          {/* البحث في PDF على الجوال: شريط البحث الرسمي داخل العارض */}
          {isPdf && isMobile && (
            <IconButton title="بحث في الكتاب" onClick={() => void engine.pdf?.runSearch('')}>
              <Search size={17} />
            </IconButton>
          )}
          <IconButton title={t('reader.annotations')} active={reader.sidebarPanel === 'annotations'} onClick={() => reader.setSidebarPanel('annotations')}>
            <Highlighter size={17} />
          </IconButton>
          <IconButton title={t('reader.addBookmark')} active={isBookmarked} onClick={() => void toggleBookmark()}>
            <Bookmark size={17} fill={isBookmarked ? 'currentColor' : 'none'} />
          </IconButton>

          <div className="flex-1" />

          {/* مؤشر الموضع — EPUB فقط لـ PDF (شريط أكروبات السفلي فيه شريط التقدم) */}
          <div className="no-drag me-2 hidden items-center gap-2 md:flex">
            {isPdf ? (
              <span className="text-xs tabular-nums text-muted">
                {t('reader.pageOf', { page: currentPage, total: totalPages })}
              </span>
            ) : (
              <>
                {remainingMin != null && (
                  <span className="text-xs tabular-nums text-muted">
                    {t('reader.remainingMin', { min: remainingMin })}
                  </span>
                )}
                <div className="w-36">
                  <input
                    type="range"
                    dir="ltr"
                    min={0}
                    max={100}
                    step={0.5}
                    value={percent}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setPercent(v)
                    }}
                    onMouseUp={(e) => {
                      const v = Number((e.target as HTMLInputElement).value)
                      engine.epub?.displayAtPercent(v)
                    }}
                    onTouchEnd={(e) => {
                      const v = Number((e.target as HTMLInputElement).value)
                      engine.epub?.displayAtPercent(v)
                    }}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-300 dark:bg-dline [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent dark:[&::-webkit-slider-thumb]:bg-daccent"
                  />
                </div>
                <span className="text-xs tabular-nums font-medium">{Math.round(percent)}%</span>
              </>
            )}
          </div>

          <IconButton
            title={reader.nightInvert || ['night', 'amber', 'slate'].includes(settings.theme) ? t('reader.dayMode') : t('reader.nightMode')}
            onClick={() =>
              isPdf
                ? reader.setNightInvert(!reader.nightInvert)
                : updateSettings({ theme: ['night', 'amber', 'slate'].includes(settings.theme) ? 'day' : 'night' })
            }
          >
            {reader.nightInvert || ['night', 'amber', 'slate'].includes(settings.theme) ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>

          {/* الجوال: لوحة Moon+ متاحة أيضًا لـ PDF (التحكم والسطوع) */}
          {(settingsLoaded || (isPdf && isMobile)) && (
            <IconButton title={isMobile ? 'إعدادات القارئ' : t('reader.displayOptions')} active={reader.settingsOpen} onClick={() => reader.setSettingsOpen(!reader.settingsOpen)}>
              <Type size={17} />
            </IconButton>
          )}

          <IconButton
            title={t('reader.tts')}
            active={ttsOpen}
            onClick={() => setTtsOpen(!ttsOpen)}
          >
            <Volume2 size={17} />
          </IconButton>

          <IconButton title={t('reader.zenMode')} onClick={() => reader.setZen(true)}>
            {zen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconButton>

          {/* أزرار النافذة */}
          <WinBtns />
        </header>
      )}

      {zen && <ZenExitBar onExit={() => reader.setZen(false)} />}

      {/* الجسم */}
      <div className="relative flex min-h-0 flex-1">
        {!zen && (
          <SidePanel
            toc={toc}
            isPdf={isPdf}
            onGoToPage={(n) => engine.pdf?.goToPage(n)}
            onGoToCfi={(c) => engine.epub?.goToCfi(c)}
            onGoToHref={(h) => engine.epub?.goToHref(h)}
          />
        )}

        <main className="relative flex min-w-0 flex-1">
          {/* تراكب السطوع — على طريقة Moon+ (مستوى أسود فوق كل الشاشة) */}
          {isMobile && mp.brightness < 100 && (
            <div
              data-testid="moon-dim"
              className="pointer-events-none fixed inset-0 z-[70]"
              style={{ background: '#000', opacity: (100 - mp.brightness) / 100 }}
            />
          )}

          {/* شريط السطوع على الحافة اليسرى — سحب رأسي */}
          {isMobile && !reader.zenMode && <MoonBrightnessEdge />}

          {/* شريط المعلومات السفلي (الفصل/النسبة/الوقت/البطارية) */}
          {isMobile && mp.statusBar && !reader.zenMode && (
            <MoonStatusBar
              chapter={isPdf ? null : chapter}
              percent={percent}
              pageOf={isPdf ? t('reader.pageOf', { page: currentPage, total: totalPages }) : null}
            />
          )}

          {isPdf ? (
            <PdfViewer book={book} onDocReady={onPdfReady} onPageChange={onEpdfPageChange} />
          ) : settingsLoaded ? (
            <EpubReader
              book={book}
              settings={settings}
              resumeCfi={epubCfiRef.current}
              onDocReady={onEpubReady}
              onRelocate={onEpubRelocate}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent/25 border-t-accent" />
            </div>
          )}

          {!isPdf && reader.searchOpen && <SearchBar isPdf={false} />}

          {/* شريط القراءة الصوتية (النسخة 2) — مع وضع قراءة المحدد (2.2) */}
          {ttsOpen && (
            <TtsBar
              isPdf={isPdf}
              engine={engine}
              autoStart
              selectionText={ttsSelection}
              onSelectionDone={() => setTtsSelection(null)}
              onClose={() => {
                setTtsSelection(null)
                setTtsOpen(false)
              }}
            />
          )}

          {/* لوحة خيارات عرض EPUB — الجوال: لوحة Moon+ بتبويبات */}
          {reader.settingsOpen &&
            (isPdf ? (
              isMobile && (
                <MoonSheet
                  settings={settings}
                  onChange={() => {}}
                  perBook={false}
                  onApplyToAll={() => {}}
                  onResetBook={() => {}}
                  onClose={() => reader.setSettingsOpen(false)}
                  autoScrollOn={autoScrollOn}
                  onToggleAutoScroll={() => setAutoScrollOn((v) => !v)}
                  isPdf
                />
              )
            ) : settingsLoaded && (
              isMobile ? (
                <MoonSheet
                  settings={settings}
                  onChange={updateSettings}
                  perBook={hasBookOverride}
                  onApplyToAll={applyToAllBooks}
                  onResetBook={resetBookSettings}
                  onClose={() => reader.setSettingsOpen(false)}
                  autoScrollOn={autoScrollOn}
                  onToggleAutoScroll={() => setAutoScrollOn((v) => !v)}
                  isPdf={false}
                />
              ) : (
                <DisplayOptionsDrawer
                  settings={settings}
                  onChange={updateSettings}
                  perBook={hasBookOverride}
                  onApplyToAll={applyToAllBooks}
                  onResetBook={resetBookSettings}
                  onClose={() => reader.setSettingsOpen(false)}
                />
              )
            ))}

          {/* فلاش بصري عند لمس مناطق التنقل — على طريقة Moon+ (جوال فقط) */}
          {isMobile && <MoonTapFlash />}

          {/* قرص إيقاف التمرير التلقائي */}
          {isMobile && autoScrollOn && (
            <button
              data-testid="moon-autoscroll-pill"
              onClick={() => setAutoScrollOn(false)}
              className="absolute bottom-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg backdrop-blur"
            >
              ⏸ إيقاف التمرير التلقائي
            </button>
          )}

          {/* أزرار تنقل جانبية للـ EPUB — الاتجاه يتبع لغة الكتاب */}
          {!isPdf && !reader.selection && (
            <>
              <button
                className="absolute start-0 top-0 z-10 hidden h-full w-10 items-center justify-start ps-1 opacity-30 transition-opacity hover:opacity-90 md:flex"
                onClick={() => (epubRtl ? engine.epub?.prev() : engine.epub?.next())}
                title={epubRtl ? 'السابق' : 'التالي'}
              >
                {epubRtl ? <ChevronRight size={26} /> : <ChevronLeft size={26} />}
              </button>
              <button
                className="absolute end-0 top-0 z-10 hidden h-full w-10 items-center justify-end pe-1 opacity-30 transition-opacity hover:opacity-90 md:flex"
                onClick={() => (epubRtl ? engine.epub?.next() : engine.epub?.prev())}
                title={epubRtl ? 'التالي' : 'السابق'}
              >
                {epubRtl ? <ChevronLeft size={26} /> : <ChevronRight size={26} />}
              </button>
            </>
          )}
        </main>

        <SelectionPopover isPdf={isPdf} />
        <NoteEditor />
      </div>

      {/* شريط تحكم سفلي للجوال — EPUB و PDF معًا (v2.7) — قابل للإخفاء من إعدادات التحكم */}
      {!zen && isMobile && mp.bottomBar && (isPdf || settingsLoaded) && (
        <footer className="flex h-[54px] shrink-0 items-center gap-1.5 border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom,0px)] dark:border-dline dark:bg-dsurface">
          <IconButton title="السابق" onClick={() => (isPdf ? engine.pdf?.prevPage() : engine.epub?.prev())}>
            {isPdf ? <ChevronLeft size={21} /> : epubRtl ? <ChevronRight size={21} /> : <ChevronLeft size={21} />}
          </IconButton>
          <input
            type="range"
            dir="ltr"
            min={0}
            max={100}
            step={0.5}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value)
              if (isPdf) engine.pdf?.scrollToPercent(v)
              else engine.epub?.displayAtPercent(v)
            }}
            onTouchEnd={(e) => {
              const v = Number((e.target as HTMLInputElement).value)
              if (isPdf) engine.pdf?.scrollToPercent(v)
              else engine.epub?.displayAtPercent(v)
            }}
            data-testid="moon-footer-seek"
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-gray-300 dark:bg-dline [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent dark:[&::-webkit-slider-thumb]:bg-daccent"
          />
          <span className="w-9 shrink-0 text-center text-[11px] tabular-nums font-semibold">{Math.round(percent)}%</span>
          <IconButton title="التالي" onClick={() => (isPdf ? engine.pdf?.nextPage() : engine.epub?.next())}>
            {isPdf ? <ChevronRight size={21} /> : epubRtl ? <ChevronLeft size={21} /> : <ChevronRight size={21} />}
          </IconButton>
        </footer>
      )}
    </div>
  )
}

function WinBtns(): React.ReactNode {
  return <WindowControls />
}

function ZenExitBar({ onExit }: { onExit(): void }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onExit}
      className="absolute end-4 top-3 z-50 rounded-full border border-white/20 bg-black/60 px-4 py-1.5 text-xs text-white/80 backdrop-blur transition-colors hover:bg-black/80"
    >
      {t('reader.exitZen')}
    </button>
  )
}

function DisplayOptionsDrawer({
  settings,
  onChange,
  perBook,
  onApplyToAll,
  onResetBook,
  onClose
}: {
  settings: ReaderSettings
  onChange(p: Partial<ReaderSettings>): void
  perBook: boolean
  onApplyToAll(): void
  onResetBook(): void
  onClose(): void
}) {
  const { t } = useTranslation()
  return (
    /* الجوال: شيت سفلي بعرض كامل — الكمبيوتر: لوحة عائمة كما كانت */
    <div className="anim-in fixed inset-x-0 bottom-0 z-40 max-h-[76vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl dark:border-dline dark:bg-dsurface2 md:absolute md:inset-x-auto md:bottom-auto md:end-3 md:top-3 md:max-h-none md:w-72 md:rounded-2xl md:border md:pb-4">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line dark:bg-dline md:hidden" />
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold">{t('reader.displayOptions')}</p>
        <button onClick={onClose} className="text-muted hover:text-ink">
          ✕
        </button>
      </div>

      {/* إعدادات مستقلة لكل كتاب: شارة + أزرار النطاق */}
      <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
          <BookMarked size={13} />
          {perBook ? 'هذه الإعدادات خاصة بهذا الكتاب' : 'التعديلات تُحفظ لهذا الكتاب فقط'}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={onApplyToAll}
            className="flex-1 rounded-lg bg-accent/10 px-2 py-1.5 text-[11px] font-medium text-accent-strong transition-colors hover:bg-accent/20 dark:bg-daccent/15 dark:text-daccent"
          >
            طبّق على كل الكتب
          </button>
          <button
            onClick={onResetBook}
            className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
          >
            استعادة الافتراضي
          </button>
        </div>
      </div>

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.themeLabel')}</p>
      <div className="mb-4 grid grid-cols-3 gap-1.5">
        {(['day', 'sepia', 'night'] as const).map((th) => (
          <button
            key={th}
            onClick={() => onChange({ theme: th })}
            className={cn(
              'flex h-14 flex-col items-center justify-end rounded-xl border pb-1.5 pt-3 text-[11px] font-medium transition-all',
              settings.theme === th ? 'border-accent ring-2 ring-accent/25' : 'border-line dark:border-dline'
            )}
            style={{
              background: th === 'day' ? '#fff' : th === 'sepia' ? '#f4ecd8' : '#17191e',
              color: th === 'day' ? '#1a1a1a' : th === 'sepia' ? '#5b4636' : '#cfd3da'
            }}
          >
            {th === 'day' ? t('reader.themeDay') : th === 'sepia' ? t('reader.themeSepia') : t('reader.themeNight')}
          </button>
        ))}
      </div>

      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.fontFamily')}</p>
      <Select
        className="mb-4 w-full"
        value={settings.fontFamily}
        onChange={(e) => onChange({ fontFamily: e.target.value })}
      >
        {READER_FONTS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </Select>

      {/* المحاذاة */}
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.align')}</p>
      <div className="mb-4 grid grid-cols-4 gap-1.5">
        {READER_ALIGNS.map((al) => (
          <button
            key={al.id}
            onClick={() => onChange({ align: al.id as ReaderSettings['align'] })}
            className={cn(
              'flex h-9 items-center justify-center rounded-lg border text-[11px] font-medium transition-all',
              settings.align === al.id
                ? 'border-accent bg-accent/10 text-accent-strong dark:bg-daccent/15 dark:text-daccent'
                : 'border-line text-muted hover:bg-black/[0.04] dark:border-dline dark:hover:bg-white/[0.05]'
            )}
          >
            {al.label}
          </button>
        ))}
      </div>

      <Labelled slider label={`${t('reader.fontSize')} — ${settings.fontSize}%`}>
        <Slider min={70} max={220} step={5} value={settings.fontSize} onChange={(v) => onChange({ fontSize: v })} />
      </Labelled>
      <Labelled slider label={`${t('reader.lineHeight')} — ${settings.lineHeight}`}>
        <Slider min={120} max={260} step={5} value={settings.lineHeight * 100} onChange={(v) => onChange({ lineHeight: v / 100 })} />
      </Labelled>

      {/* الهوامش الأربعة */}
      <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.margins')}</p>
      <Labelled slider label={`${t('reader.marginRight')} — ${settings.marginRight}%`}>
        <Slider min={0} max={25} step={1} value={settings.marginRight} onChange={(v) => onChange({ marginRight: v, margin: Math.max(v, settings.marginLeft) })} />
      </Labelled>
      <Labelled slider label={`${t('reader.marginLeft')} — ${settings.marginLeft}%`}>
        <Slider min={0} max={25} step={1} value={settings.marginLeft} onChange={(v) => onChange({ marginLeft: v, margin: Math.max(v, settings.marginRight) })} />
      </Labelled>
      <Labelled slider label={`${t('reader.marginTop')} — ${settings.marginTop}%`}>
        <Slider min={0} max={25} step={1} value={settings.marginTop} onChange={(v) => onChange({ marginTop: v })} />
      </Labelled>
      <Labelled slider label={`${t('reader.marginBottom')} — ${settings.marginBottom}%`}>
        <Slider min={0} max={25} step={1} value={settings.marginBottom} onChange={(v) => onChange({ marginBottom: v })} />
      </Labelled>

      <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">وضع العرض</p>
      <div className="grid grid-cols-2 gap-1.5">
        {(['paginated', 'scrolled'] as const).map((fl) => (
          <Button key={fl} size="sm" variant={settings.flow === fl ? 'primary' : 'outline'} onClick={() => onChange({ flow: fl })}>
            {fl === 'paginated' ? t('reader.flowPaginated') : t('reader.flowScrolled')}
          </Button>
        ))}
      </div>
      {settings.flow === 'scrolled' && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('reader.flowScrollHint')}</p>
      )}
    </div>
  )
}

function Labelled({
  label,
  children,
  slider
}: {
  label: string
  children: React.ReactNode
  slider?: boolean
}): React.ReactNode {
  void slider
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      {children}
    </label>
  )
}

async function useLibraryRefresh(): Promise<void> {
  const { useLibrary } = await import('@/stores/library')
  await useLibrary.getState().load()
}
