import { useEffect, useRef, useState } from 'react'
import {
  ListTree,
  Images,
  Highlighter,
  Bookmark as BmIcon,
  Trash2,
  StickyNote,
  ChevronDown,
  FileQuestion
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useReader } from '@/stores/reader'
import type { TocItem } from '@/lib/pdfEngine'
import type { TocEntry } from './EpubReader'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/kit'

interface PanelProps {
  toc: TocItem[] | TocEntry[]
  isPdf: boolean
  onGoToPage(n: number): void
  onGoToCfi(cfi: string): void
  onGoToHref(href: string): void
}

/** لوحة جانبية بتبويبات: فهرس / مصغرات / تعليقات / علامات */
export function SidePanel(props: PanelProps) {
  const reader = useReader()
  const panel = reader.sidebarPanel
  if (!panel) return null

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-e border-line bg-surface2 dark:border-dline dark:bg-dsurface">
      <div className="flex items-center gap-1 border-b border-line px-2 py-2 dark:border-dline">
        <TabBtn active={panel === 'toc'} onClick={() => reader.setSidebarPanel('toc')} icon={<ListTree size={15} />} label="الفهرس" />
        {props.isPdf && (
          <TabBtn
            active={panel === 'thumbs'}
            onClick={() => reader.setSidebarPanel('thumbs')}
            icon={<Images size={15} />}
            label="المصغرات"
          />
        )}
        <TabBtn
          active={panel === 'annotations'}
          onClick={() => reader.setSidebarPanel('annotations')}
          icon={<Highlighter size={15} />}
          label="التعليقات"
          count={reader.annotations.length}
        />
        <TabBtn
          active={panel === 'bookmarks'}
          onClick={() => reader.setSidebarPanel('bookmarks')}
          icon={<BmIcon size={15} />}
          label="العلامات"
          count={reader.bookmarks.length}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {panel === 'toc' && <TocList {...props} />}
        {panel === 'thumbs' && props.isPdf && <PdfThumbs onGoToPage={props.onGoToPage} />}
        {panel === 'annotations' && (
          <AnnotationsList
            onJump={(loc) => {
              if (props.isPdf) props.onGoToPage(Number(loc))
              else if (typeof loc === 'string') props.onGoToCfi(loc)
            }}
          />
        )}
        {panel === 'bookmarks' && (
          <BookmarksList
            onJump={(bm) => {
              if (props.isPdf) props.onGoToPage(Number(bm.location.replace('p:', '')) || 1)
              else props.onGoToCfi(bm.location)
            }}
          />
        )}
      </div>
    </aside>
  )
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
  count
}: {
  active: boolean
  onClick(): void
  icon: React.ReactNode
  label: string
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10.5px] transition-colors',
        active ? 'bg-accent/12 text-accent-strong dark:bg-daccent/15 dark:text-daccent' : 'text-muted hover:bg-black/[0.05]'
      )}
    >
      {icon}
      <span>{label}</span>
      {count != null && count > 0 && (
        <span className="absolute end-1 top-0.5 rounded-full bg-accent px-1 text-[9px] font-bold text-white">{count}</span>
      )}
    </button>
  )
}

// ---------- الفهرس ----------
function TocList({ toc, isPdf, onGoToPage, onGoToHref }: PanelProps) {
  if (!toc.length) {
    return <EmptyMini icon={<FileQuestion size={28} />} text="لا يوجد فهرس لهذا المستند" />
  }
  return (
    <div className="space-y-0.5">
      {toc.map((item, i) => (
        <TocNode key={i} item={item} depth={0} isPdf={isPdf} onGoToPage={onGoToPage} onGoToHref={onGoToHref} />
      ))}
    </div>
  )
}

function TocNode({
  item,
  depth,
  isPdf,
  onGoToPage,
  onGoToHref
}: {
  item: TocItem | TocEntry
  depth: number
  isPdf: boolean
  onGoToPage(n: number): void
  onGoToHref(href: string): void
}) {
  const [open, setOpen] = useState(depth < 1)
  const children: Array<TocItem | TocEntry> =
    'children' in item ? ((item.children ?? []) as Array<TocItem | TocEntry>) : []
  const page = 'page' in item ? (item.page as number | null) : null
  const href = 'href' in item ? (item.href as string) : ''
  const label = String(('title' in item ? item.title : ('label' in item ? item.label : '')) ?? '') || '—'

  return (
    <>
      <div className="flex items-center" style={{ paddingInlineStart: depth * 14 }}>
        {children.length > 0 && (
          <button className="shrink-0 rounded p-0.5 text-muted hover:text-ink" onClick={() => setOpen(!open)}>
            <ChevronDown size={13} className={cn('transition-transform', !open && '-rotate-90 rtl:rotate-90')} />
          </button>
        )}
        <button
          className="flex-1 truncate rounded-md px-2 py-1.5 text-start text-[12.5px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
          onClick={() => {
            if (isPdf) {
              if (page) onGoToPage(page)
            } else if (href) onGoToHref(href)
          }}
          title={label}
        >
          {label.trim() || '—'}
          {isPdf && page != null && <span className="ms-2 text-[10px] text-muted">{page}</span>}
        </button>
      </div>
      {open &&
        children.map((c, i) => (
          <TocNode key={i} item={c} depth={depth + 1} isPdf={isPdf} onGoToPage={onGoToPage} onGoToHref={onGoToHref} />
        ))}
    </>
  )
}

// ---------- التعليقات ----------
function AnnotationsList({ onJump }: { onJump(location: string | number): void }) {
  const reader = useReader()
  const bookFormat = useReader((s) => s.book?.format)

  if (!reader.annotations.length) {
    return <EmptyMini icon={<Highlighter size={26} />} text="لا تعليقات في هذا الكتاب بعد" />
  }
  return (
    <div className="space-y-1.5">
      {reader.annotations.map((a) => (
        <div
          key={a.id}
          className="group cursor-pointer rounded-xl border border-line bg-surface p-2.5 text-start transition-shadow hover:shadow-sm dark:border-dline dark:bg-dsurface2"
          onClick={() =>
            bookFormat === 'pdf' && a.page != null ? onJump(a.page) : a.cfi && onJump(a.cfi)
          }
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/20" style={{ backgroundColor: a.color }} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {a.type === 'highlight' ? 'تمييز' : a.type === 'underline' ? 'تسطير' : 'ملاحظة'}
              {a.page != null && ` · ص ${a.page}`}
            </span>
            <button
              className="ms-auto hidden rounded p-1 text-red-500 opacity-70 hover:bg-red-50 group-hover:block dark:hover:bg-red-950"
              onClick={(e) => {
                e.stopPropagation()
                void reader.deleteAnnotation(a.id)
              }}
              title="حذف"
            >
              <Trash2 size={12} />
            </button>
          </div>
          {a.text && <p className="line-clamp-3 text-xs leading-relaxed opacity-85">“{a.text}”</p>}
          {a.note && (
            <p className="mt-1 flex items-start gap-1 rounded-lg bg-amber-500/10 p-1.5 text-xs leading-relaxed">
              <StickyNote size={12} className="mt-0.5 shrink-0 text-amber-500" />
              {a.note}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted/70">
            {new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        </div>
      ))}
    </div>
  )
}

// ---------- العلامات المرجعية ----------
function BookmarksList({ onJump }: { onJump(bm: { id: string; location: string; page: number | null; excerpt: string | null; label: string }): void }) {
  const reader = useReader()
  if (!reader.bookmarks.length) {
    return <EmptyMini icon={<BmIcon size={26} />} text="لا علامات مرجعية بعد" />
  }
  return (
    <div className="space-y-1.5">
      {reader.bookmarks.map((bm) => (
        <div
          key={bm.id}
          className="group flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface p-2.5 transition-shadow hover:shadow-sm dark:border-dline dark:bg-dsurface2"
          onClick={() => onJump(bm)}
        >
          <BmIcon size={14} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{bm.label}</p>
            {bm.excerpt && <p className="truncate text-[11px] text-muted">{bm.excerpt}</p>}
          </div>
          <button
            className="hidden rounded p-1 text-red-500 hover:bg-red-50 group-hover:block dark:hover:bg-red-950"
            onClick={(e) => {
              e.stopPropagation()
              void reader.removeBookmarkById(bm.id)
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function EmptyMini({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <span className="text-muted/50">{icon}</span>
      <p className="px-6 text-xs leading-relaxed text-muted">{text}</p>
    </div>
  )
}

// ---------- المصغرات (PDF فقط) ----------
export function ThumbnailsPanel({
  docGetter,
  numPages,
  currentPage,
  onGoToPage
}: {
  docGetter(): unknown
  numPages: number
  currentPage: number
  onGoToPage(n: number): void
}) {
  void docGetter
  void numPages
  void currentPage
  void onGoToPage
  // تُعرض داخل PdfReader مباشرة عبر SidebarThumbs
  return null
}

/** شريط بحث داخل المستند — موحّد لـ PDF و EPUB (النسخة 2) */
export function SearchBar({ isPdf }: { isPdf: boolean }) {
  const reader = useReader()
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [listOpen, setListOpen] = useState(false)

  useEffect(() => {
    if (reader.searchOpen) inputRef.current?.focus()
  }, [reader.searchOpen])

  // بحث EPUB مع تهيئة (debounce)
  useEffect(() => {
    if (isPdf || !reader.searchOpen) return
    const q = reader.epubQuery
    if (!q || q.trim().length < 2) {
      reader.setEpubMatches([])
      return
    }
    const timer = setTimeout(() => {
      void (window as unknown as { __epubSearchRunner?: (q: string) => Promise<void> }).__epubSearchRunner?.(q.trim())
    }, 450)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.epubQuery, isPdf, reader.searchOpen])

  if (!reader.searchOpen) return null
  const total = isPdf ? reader.search.matches.length : reader.epubMatches.length
  const active = isPdf ? reader.search.activeIndex + 1 : (reader.epubMatchIndex ?? 0) + 1

  const run = (q: string): void => {
    if (isPdf) {
      ;(window as unknown as { __pdfSearchRunner?: (q: string) => void }).__pdfSearchRunner?.(q)
    } else {
      reader.setEpubQuery(q)
    }
  }

  const jump = (dir: 1 | -1): void => {
    if (isPdf) {
      reader.setSearchActive((reader.search.activeIndex + dir + total) % Math.max(1, total))
    } else {
      reader.gotoEpubMatch((reader.epubMatchIndex ?? 0) + dir)
    }
  }

  return (
    <div className="absolute end-4 top-3 z-40 anim-in flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 shadow-xl dark:border-dline dark:bg-dsurface2">
        <input
          ref={inputRef}
          value={isPdf ? reader.search.query : reader.epubQuery}
          onChange={(e) => run(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              jump(e.shiftKey ? -1 : 1)
            } else if (e.key === 'Escape') {
              reader.setSearchOpen(false)
              run('')
            }
          }}
          placeholder={t('reader.findPlaceholder')}
          className="w-52 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {reader.epubSearching && !isPdf && <Spinner size={13} />}
        {(isPdf ? reader.search.query : reader.epubQuery) && (
          <span className={cn('min-w-16 text-center text-xs tabular-nums', total ? 'text-muted' : 'text-red-500')}>
            {total ? `${active}/${total}` : t('reader.noMatches')}
          </span>
        )}
        {!isPdf && total > 0 && (
          <button
            className="rounded-md p-1 text-muted hover:bg-black/[0.06] dark:hover:bg-white/10"
            title={t('reader.resultsList')}
            onClick={() => setListOpen((v) => !v)}
          >
            <ChevronDown size={13} className={cn('transition-transform', listOpen && 'rotate-180')} />
          </button>
        )}
        <button
          className="rounded-md p-1 text-muted hover:bg-black/[0.06] disabled:opacity-40 dark:hover:bg-white/10"
          disabled={!total}
          onClick={() => jump(-1)}
          title="السابق"
        >
          ↑
        </button>
        <button
          className="rounded-md p-1 text-muted hover:bg-black/[0.06] disabled:opacity-40 dark:hover:bg-white/10"
          disabled={!total}
          onClick={() => jump(1)}
          title="التالي"
        >
          ↓
        </button>
        <button
          className="rounded-md px-1.5 py-1 text-muted hover:bg-black/[0.06] dark:hover:bg-white/10"
          onClick={() => {
            reader.setSearchOpen(false)
            run('')
          }}
        >
          ✕
        </button>
      </div>

      {/* قائمة نتائج EPUB */}
      {!isPdf && listOpen && total > 0 && (
        <div className="max-h-80 w-[22rem] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl dark:border-dline dark:bg-dsurface2">
          {reader.epubMatches.map((m, i) => (
            <button
              key={i}
              className={cn(
                'block w-full rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06]',
                i === (reader.epubMatchIndex ?? 0) && 'bg-accent/10'
              )}
              onClick={() => reader.gotoEpubMatch(i)}
            >
              {m.section && <p className="mb-0.5 truncate text-[10.5px] font-semibold text-accent">{m.section}</p>}
              <p
                className="line-clamp-2 text-xs leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: m.excerpt
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/⟪([^⟫]*)⟫/g, '<mark class="rounded bg-sky-400/30 px-0.5">$1</mark>')
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- مصغرات صفحات PDF (بنمط أكروبات) ----------
interface PdfDocLike {
  numPages: number
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number }
    render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> }
  }>
}

function PdfThumbs({ onGoToPage }: { onGoToPage(n: number): void }) {
  const [pages, setPages] = useState<Array<{ n: number; url: string }>>([])
  const [total, setTotal] = useState(0)
  const [waitingDoc, setWaitingDoc] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // انتظار جاهزية المستند — يوفره PdfReader عبر window.__pdfGetDoc
      let doc: PdfDocLike | null = null
      for (let i = 0; i < 60 && !cancelled; i++) {
        doc = ((window as unknown as { __pdfGetDoc?: () => PdfDocLike | null }).__pdfGetDoc?.() ?? null) as PdfDocLike | null
        if (doc) break
        await new Promise((r) => setTimeout(r, 100))
      }
      if (cancelled) return
      if (!doc) {
        setWaitingDoc(false)
        return
      }
      setWaitingDoc(false)
      setTotal(doc.numPages)
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return
        try {
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min(0.35, 140 / Math.max(base.width, 1))
          const vp = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.floor(vp.width))
          canvas.height = Math.max(1, Math.floor(vp.height))
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvasContext: ctx, viewport: vp }).promise
          if (cancelled) return
          const url = canvas.toDataURL('image/jpeg', 0.72)
          setPages((prev) => [...prev, { n, url }])
        } catch {
          /* صفحة لا ترسم — تخطَّها */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      {waitingDoc && (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {pages.map(({ n, url }) => (
          <button
            key={n}
            onClick={() => onGoToPage(n)}
            className="group flex flex-col items-center gap-1 rounded-lg border border-line bg-white p-1 transition-all hover:ring-2 hover:ring-accent dark:border-dline"
            title={`صفحة ${n}`}
          >
            <img src={url} alt={`ص${n}`} className="w-full" loading="lazy" />
            <span className="text-[10px] tabular-nums text-muted group-hover:text-accent">{n}</span>
          </button>
        ))}
      </div>
      {!waitingDoc && !pages.length && total === 0 && (
        <EmptyMini icon={<Images size={26} />} text="لا توجد معاينة متاحة الآن" />
      )}
    </div>
  )
}
