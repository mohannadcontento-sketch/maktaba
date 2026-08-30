import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Loader2, Globe, Check, RefreshCw, ImageDown, ExternalLink } from 'lucide-react'
import type { Book, WebImage } from '../../../../shared/types'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { Dialog } from '@/components/ui/Dialog'
import { Button, Input } from '@/components/ui/kit'
import { cn } from '@/lib/utils'

const SOURCE_LABELS: Record<WebImage['source'], string> = {
  'google-images': 'صور جوجل',
  duckduckgo: 'DuckDuckGo',
  'google-books': 'Google Books',
  openlibrary: 'Open Library'
}

const SOURCE_COLORS: Record<WebImage['source'], string> = {
  'google-images': '#ea4335',
  duckduckgo: '#de5833',
  'google-books': '#4285f4',
  openlibrary: '#8b5e3c'
}

/**
 * منتقي الأغلفة (النسخة 2.2) — بحث مرئي شبيه بالمتصفح:
 * شبكة نتائج من صور جوجل ومصادر أخرى، والمستخدم ينقر الصورة المناسبة
 * فيسحبها التطبيق ويحفظها غلافًا للكتاب.
 * على سطح المكتب يتوفر أيضًا «المتصفح المدمج» الذي يفتح صور جوجل نفسها.
 */
export function CoverPickerDialog({
  book,
  open,
  onClose,
  onPicked
}: {
  book: Book
  open: boolean
  onClose(): void
  onPicked?(book: Book): void
}) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const ui = useUi()
  const isDesktop = window.api.platform !== 'android'

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WebImage[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<WebImage | null>(null)
  const [applying, setApplying] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const defaultQuery = useMemo(
    () => [book.title, book.author].filter(Boolean).join(' ').trim(),
    [book.title, book.author]
  )

  const runSearch = useCallback(
    async (q: string): Promise<void> => {
      const query = q.trim()
      if (!query) return
      setLoading(true)
      setSelected(null)
      setSearched(true)
      try {
        const res = await window.api.searchWebImages(query, null)
        setResults(res)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
        gridRef.current?.scrollTo({ top: 0 })
      }
    },
    []
  )

  // بحث أولي عند الفتح
  useEffect(() => {
    if (!open) return
    setQuery(defaultQuery)
    setResults([])
    setSelected(null)
    setSearched(false)
    void runSearch(defaultQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultQuery])

  const apply = useCallback(
    async (img: WebImage): Promise<void> => {
      setApplying(true)
      try {
        const updated = await window.api.useWebImage(book.id, img.full)
        if (updated) {
          await lib.reloadOne(book.id)
          onPicked?.(updated)
          ui.toast(t('library.coverPicked'), 'success')
          onClose()
        } else {
          ui.toast(t('library.coverDownloadFailed'), 'error')
        }
      } catch {
        ui.toast(t('library.coverError'), 'error')
      } finally {
        setApplying(false)
      }
    },
    [book.id, lib, onClose, onPicked, t, ui]
  )

  const openBrowser = useCallback(async (): Promise<void> => {
    await window.api.openCoverBrowser(book.id, query.trim() || defaultQuery)
    onClose()
  }, [book.id, defaultQuery, onClose, query])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={
        <span className="flex items-center gap-2">
          <ImageDown size={17} className="text-accent" />
          {t('library.pickerTitle')}
        </span>
      }
      footer={
        <>
          {isDesktop && (
            <Button variant="ghost" onClick={() => void openBrowser()} title={t('library.pickerBrowserHint')}>
              <ExternalLink size={14} />
              {t('library.pickerOpenBrowser')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!selected || applying} onClick={() => selected && void apply(selected)}>
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t('library.pickerUse')}
          </Button>
        </>
      }
    >
      {/* شريط البحث */}
      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch(query)
        }}
      >
        <div className="relative flex-1">
          <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('library.pickerPlaceholder')}
            className="ps-9"
          />
        </div>
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {t('library.pickerSearch')}
        </Button>
        <Button type="button" size="sm" variant="soft" title={t('library.pickerRefresh')} onClick={() => void runSearch(query)}>
          <RefreshCw size={14} />
        </Button>
      </form>

      <p className="mb-3 text-[11.5px] leading-relaxed text-muted">{t('library.pickerHint')}</p>

      {/* شبكة النتائج */}
      <div ref={gridRef} className="max-h-[46vh] min-h-[180px] overflow-y-auto rounded-xl bg-surface2/40 p-2 dark:bg-dsurface2/40">
        {loading && (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/[0.06]" />
            ))}
          </div>
        )}

        {!loading && results.length === 0 && searched && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted">
            <Globe size={26} className="opacity-40" />
            <p className="text-sm">{t('library.pickerNoResults')}</p>
            <p className="text-[11px] opacity-70">{t('library.pickerNoResultsHint')}</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
            {results.map((img, i) => {
              const active = selected?.full === img.full
              return (
                <button
                  key={`${img.full}-${i}`}
                  className={cn(
                    'group relative aspect-[2/3] overflow-hidden rounded-lg bg-black/[0.05] ring-2 transition-all dark:bg-white/[0.05]',
                    active ? 'ring-accent' : 'ring-transparent hover:ring-accent/40'
                  )}
                  onClick={() => setSelected(img)}
                  onDoubleClick={() => void apply(img)}
                  title={img.title || SOURCE_LABELS[img.source]}
                >
                  <img
                    src={img.thumb}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
                    onError={(e) => {
                      // المصغرة فاشلة → جرب الرابط الكامل مباشرة
                      const el = e.currentTarget
                      if (el.src !== img.full && img.full) el.src = img.full
                    }}
                  />
                  <span
                    className="absolute bottom-1 start-1 rounded px-1.5 py-0.5 text-[9px] font-bold text-white shadow"
                    style={{ background: SOURCE_COLORS[img.source] }}
                  >
                    {SOURCE_LABELS[img.source]}
                  </span>
                  {active && (
                    <span className="absolute inset-0 flex items-center justify-center bg-accent/25">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-lg">
                        <Check size={16} />
                      </span>
                    </span>
                  )}
                  {img.w > 0 && (
                    <span className="absolute end-1 top-1 rounded bg-black/55 px-1 py-0.5 text-[9px] font-semibold text-white">
                      {img.w}×{img.h}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {!loading && !searched && (
          <div className="flex h-40 items-center justify-center text-sm text-muted">{t('library.pickerIdle')}</div>
        )}
      </div>

      {selected && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-accent">
          <Check size={13} />
          {t('library.pickerSelected')}
        </p>
      )}
    </Dialog>
  )
}
