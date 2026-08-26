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
        {!props.isPdf && (
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

/** شريط بحث داخل المستند */
export function SearchBar({ isPdf }: { isPdf: boolean }) {
  const reader = useReader()
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const runnerRef = useRef<(q: string) => void>(undefined!)

  useEffect(() => {
    if (!isPdf) return
    runnerRef.current = (window as unknown as { __pdfSearchRunner?: (q: string) => void }).__pdfSearchRunner!
  }, [isPdf])

  useEffect(() => {
    if (reader.searchOpen) inputRef.current?.focus()
  }, [reader.searchOpen])

  if (!reader.searchOpen || !isPdf) return null
  const total = reader.search.matches.length
  const active = reader.search.activeIndex + 1

  const run = (q: string): void => {
    ;(window as unknown as { __pdfSearchRunner?: (q: string) => void }).__pdfSearchRunner?.(q)
  }

  return (
    <div className="absolute end-4 top-3 z-40 anim-in flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-1.5 shadow-xl dark:border-dline dark:bg-dsurface2">
      <input
        ref={inputRef}
        value={reader.search.query}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const next = e.shiftKey ? active - 2 : active
            reader.setSearchActive((next + total) % Math.max(1, total))
          } else if (e.key === 'Escape') {
            reader.setSearchOpen(false)
            run('')
          }
        }}
        placeholder={t('reader.findPlaceholder')}
        className="w-52 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      {reader.search.query && (
        <span className={cn('min-w-16 text-center text-xs tabular-nums', total ? 'text-muted' : 'text-red-500')}>
          {total ? `${active}/${total}` : t('reader.noMatches')}
        </span>
      )}
      <button
        className="rounded-md p-1 text-muted hover:bg-black/[0.06] disabled:opacity-40 dark:hover:bg-white/10"
        disabled={!total}
        onClick={() => reader.setSearchActive((reader.search.activeIndex - 1 + total) % Math.max(1, total))}
        title="السابق"
      >
        ↑
      </button>
      <button
        className="rounded-md p-1 text-muted hover:bg-black/[0.06] disabled:opacity-40 dark:hover:bg-white/10"
        disabled={!total}
        onClick={() => reader.setSearchActive((reader.search.activeIndex + 1) % Math.max(1, total))}
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
  )
}
