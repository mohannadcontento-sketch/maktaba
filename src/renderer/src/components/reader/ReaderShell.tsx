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
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Printer,
  Type,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useUi } from '@/stores/ui'
import { useReader, DEFAULT_READER_SETTINGS, READER_FONTS, READER_ALIGNS, type ReaderSettings } from '@/stores/reader'
import type { Book } from '../../../../shared/types'
import type { PdfHandle } from './PdfReader'
import type { TocItem } from '@/lib/pdfEngine'
import { PdfReader } from './PdfReader'
import type { EpubHandle, TocEntry } from './EpubReader'
import { EpubReader } from './EpubReader'
import { SidePanel, SearchBar } from './SidePanels'
import { SelectionPopover } from './SelectionPopover'
import { PrintDialog } from './PrintDialog'
import { NoteEditor } from './NoteEditor'
import { WindowControls } from '@/components/layout/Chrome'
import { IconButton } from '@/components/ui/IconButton'
import { Button, Slider, Select } from '@/components/ui/kit'
import { cn, isRtlLang } from '@/lib/utils'

type ReaderToc = TocItem[] | TocEntry[]

interface EngineState {
  toc: ReaderToc
  percent: number
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
  const [printOpen, setPrintOpen] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [remainingMin, setRemainingMin] = useState<number | null>(null)

  // اتجاه التنقل حسب لغة الكتاب (عربي/عبري/فارسي... = يمين إلى يسار)
  const epubRtl = isRtlLang(book.language)

  // إعدادات القراءة محفوظة لكل التطبيق
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS)

  // تحميل الإعدادات المحفوظة مرة واحدة
  useEffect(() => {
    void (async () => {
      const raw = await window.api.getSetting('reader.settings')
      if (raw) {
        try {
          setSettings((s) => ({ ...s, ...(JSON.parse(raw) as Partial<ReaderSettings>) }))
        } catch {
          /* ignore */
        }
      }
    })()
  }, [])

  const persistSettings = useCallback((s: ReaderSettings): void => {
    void window.api.setSetting('reader.settings', JSON.stringify(s))
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<ReaderSettings>): void => {
      setSettings((prev) => {
        const next = { ...prev, ...patch }
        persistSettings(next)
        return next
      })
    },
    [persistSettings]
  )

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
    else setPercent(((p - 1) / Math.max(1, engine.pdf?.numPages() ?? 1)) * 100)
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
          if (e.ctrlKey || !isPdf) {
            e.preventDefault()
            if (isPdf) reader.setSearchOpen(true)
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
        case 'Escape':
          if (reader.zenMode) reader.setZen(false)
          else if (reader.searchOpen) {
            reader.setSearchOpen(false)
            engine.pdf?.runSearch('')
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, isPdf, reader.zenMode, reader.searchOpen, currentPage, percent, totalPages, reader.bookmarks])

  const goBack = (): void => {
    reader.close()
    ui.setPage('library')
    void useLibraryRefresh()
  }

  const zen = reader.zenMode

  return (
    <div className="flex h-full flex-col">
      {/* الشريط العلوي */}
      {!zen && (
        <header className="drag-region relative z-30 flex h-[52px] shrink-0 select-none items-center gap-1 border-b border-line bg-surface px-3 dark:border-dline dark:bg-dsurface">
          <IconButton title={t('reader.backToLibrary')} onClick={goBack} className="no-drag">
            <ArrowRight size={18} />
          </IconButton>
          <div className="no-drag mx-1 min-w-0 max-w-[280px]">
            <p className="truncate text-sm font-semibold leading-tight">{book.title}</p>
            <p className="truncate text-[11px] text-muted">{book.author}</p>
          </div>

          <span className="mx-2 h-6 w-px bg-line dark:bg-dline" />

          {!zen && (
            <IconButton title="اللوحة الجانبية" active={!!reader.sidebarPanel} onClick={() => reader.setSidebarPanel(reader.sidebarPanel === 'toc' ? null : 'toc')}>
              <ListTree size={17} />
            </IconButton>
          )}
          {isPdf && (
            <>
              <IconButton title={t('reader.thumbnails')} active={reader.sidebarPanel === 'thumbs'} onClick={() => reader.setSidebarPanel('thumbs')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="8" height="8" rx="1" />
                  <rect x="13" y="3" width="8" height="8" rx="1" />
                  <rect x="3" y="13" width="8" height="8" rx="1" />
                  <rect x="13" y="13" width="8" height="8" rx="1" />
                </svg>
              </IconButton>
              <IconButton title={t('reader.searchDoc')} active={reader.searchOpen} onClick={() => reader.toggleSearch()}>
                <Search size={17} />
              </IconButton>
            </>
          )}
          <IconButton title={t('reader.annotations')} active={reader.sidebarPanel === 'annotations'} onClick={() => reader.setSidebarPanel('annotations')}>
            <Highlighter size={17} />
          </IconButton>
          <IconButton title={t('reader.addBookmark')} active={isBookmarked} onClick={() => void toggleBookmark()}>
            <Bookmark size={17} fill={isBookmarked ? 'currentColor' : 'none'} />
          </IconButton>

          <div className="flex-1" />

          {/* مؤشر الموضع */}
          <div className="no-drag me-2 hidden items-center gap-2 md:flex">
            {isPdf ? (
              <span className="text-xs tabular-nums text-muted">
                {t('reader.pageOf', { page: currentPage, total: totalPages })}
              </span>
            ) : (
              remainingMin != null && (
                <span className="text-xs tabular-nums text-muted">
                  {t('reader.remainingMin', { min: remainingMin })}
                </span>
              )
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
                  if (isPdf) engine.pdf?.scrollToPercent(v, false)
                  // في EPUB نؤجل القفزة حتى نهاية السحب لأن كل قفزة تعيد رسم الصفحة
                }}
                onMouseUp={(e) => {
                  const v = Number((e.target as HTMLInputElement).value)
                  if (isPdf) engine.pdf?.scrollToPercent(v, true)
                  else engine.epub?.displayAtPercent(v)
                }}
                onTouchEnd={(e) => {
                  const v = Number((e.target as HTMLInputElement).value)
                  if (isPdf) engine.pdf?.scrollToPercent(v, true)
                  else engine.epub?.displayAtPercent(v)
                }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-300 dark:bg-dline [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent dark:[&::-webkit-slider-thumb]:bg-daccent"
              />
            </div>
            <span className="text-xs tabular-nums font-medium">{Math.round(percent)}%</span>
          </div>

          {isPdf && (
            <>
              <IconButton title={t('reader.zoomOut')} onClick={() => engine.pdf?.zoomOut()}>
                <ZoomOut size={17} />
              </IconButton>
              <IconButton title={t('reader.zoomIn')} onClick={() => engine.pdf?.zoomIn()}>
                <ZoomIn size={17} />
              </IconButton>
              <IconButton title={t('reader.rotateCw')} onClick={() => engine.pdf?.rotate()}>
                <RotateCw size={16} />
              </IconButton>
              <IconButton title={t('reader.print')} onClick={() => setPrintOpen(true)}>
                <Printer size={16} />
              </IconButton>
            </>
          )}

          <IconButton
            title={reader.nightInvert || settings.theme === 'night' ? t('reader.dayMode') : t('reader.nightMode')}
            onClick={() =>
              isPdf
                ? reader.setNightInvert(!reader.nightInvert)
                : updateSettings({ theme: settings.theme === 'night' ? 'day' : 'night' })
            }
          >
            {reader.nightInvert || settings.theme === 'night' ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>

          {!isPdf && (
            <IconButton title={t('reader.displayOptions')} active={reader.settingsOpen} onClick={() => reader.setSettingsOpen(!reader.settingsOpen)}>
              <Type size={17} />
            </IconButton>
          )}

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
          {isPdf ? (
            <PdfReader book={book} onDocReady={onPdfReady} onPageChange={onEpdfPageChange} />
          ) : (
            <EpubReader
              book={book}
              settings={settings}
              resumeCfi={epubCfiRef.current}
              onDocReady={onEpubReady}
              onRelocate={onEpubRelocate}
            />
          )}

          <SearchBar isPdf={isPdf} />

          {/* لوحة خيارات عرض EPUB */}
          {!isPdf && reader.settingsOpen && (
            <DisplayOptionsDrawer
              settings={settings}
              onChange={updateSettings}
              onClose={() => reader.setSettingsOpen(false)}
            />
          )}

          {/* أزرار تنقل جانبية للـ EPUB — الاتجاه يتبع لغة الكتاب */}
          {!isPdf && !reader.selection && (
            <>
              <button
                className="absolute start-0 top-0 z-10 flex h-full w-10 items-center justify-start ps-1 opacity-30 transition-opacity hover:opacity-90"
                onClick={() => (epubRtl ? engine.epub?.prev() : engine.epub?.next())}
                title={epubRtl ? 'السابق' : 'التالي'}
              >
                {epubRtl ? <ChevronRight size={26} /> : <ChevronLeft size={26} />}
              </button>
              <button
                className="absolute end-0 top-0 z-10 flex h-full w-10 items-center justify-end pe-1 opacity-30 transition-opacity hover:opacity-90"
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
        <PrintDialog open={printOpen} onClose={() => setPrintOpen(false)} numPages={totalPages} currentPage={currentPage} />
      </div>
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
  onClose
}: {
  settings: ReaderSettings
  onChange(p: Partial<ReaderSettings>): void
  onClose(): void
}) {
  const { t } = useTranslation()
  return (
    <div className="absolute end-3 top-3 z-40 anim-in w-72 rounded-2xl border border-line bg-surface p-4 shadow-2xl dark:border-dline dark:bg-dsurface2">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold">{t('reader.displayOptions')}</p>
        <div className="flex items-center gap-2">
          {/* زر إعادة الضبط للإعدادات الافتراضية */}
          <button
            onClick={() => onChange({ ...DEFAULT_READER_SETTINGS })}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted transition-colors hover:bg-black/5 hover:text-ink dark:hover:bg-white/10"
            title={t('reader.resetDefaults')}
          >
            <RotateCcw size={12} />
            {t('reader.resetDefaults')}
          </button>
          <button onClick={onClose} className="text-muted hover:text-ink">
            ✕
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
