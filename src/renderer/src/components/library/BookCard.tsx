import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreVertical, BookOpen, Star, Heart, FolderPlus, FolderMinus, ExternalLink, Trash2, Pencil, CheckCheck, RotateCcw, FileText } from 'lucide-react'
import type { Book } from '../../../../shared/types'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { cn, formatBytes, formatRelativeTime, coverUrl } from '@/lib/utils'
import { ProgressBar, Badge } from '@/components/ui/kit'
import { DropdownMenu, ContextMenu, type MenuItem } from '@/components/ui/Menu'
import { MetadataDialog } from './MetadataDialog'
import { AddToShelfDialog } from './AddToShelfDialog'

interface CardProps {
  book: Book
  onOpen(book: Book): void
  collectionId?: number | null
}

export function CoverImage({ book, className }: { book: Book; className?: string }) {
  // نتعقب المسار الذي فشل تحميله حتى تتم إعادة المحاولة تلقائيًا عند جلب غلاف جديد
  const [brokenPath, setBrokenPath] = useState<string | null>(null)

  const initials = useMemo(() => {
    const words = (book.title || '?').trim().split(/\s+/)
    return (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')
  }, [book.title])

  const hue = useMemo(
    () => [...book.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360,
    [book.id]
  )

  const src = useMemo(() => coverUrl(book.coverPath), [book.coverPath])
  const showImg = !!src && brokenPath !== book.coverPath

  if (showImg && src) {
    return (
      <img
        src={src}
        alt={book.title}
        draggable={false}
        onError={() => setBrokenPath(book.coverPath)}
        className={cn('h-full w-full object-cover', className)}
        loading="lazy"
      />
    )
  }
  return (
    <div
      className={cn('flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-white', className)}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 45% 38%), hsl(${(hue + 40) % 360} 50% 26%))`
      }}
    >
      {book.format === 'epub' ? (
        <BookOpen size={22} className="opacity-80" />
      ) : (
        <FileText size={22} className="opacity-80" />
      )}
      <span className="line-clamp-3 text-center text-[13px] font-bold leading-snug drop-shadow">{book.title}</span>
      <span dir="ltr" className="mt-auto text-[10px] font-semibold tracking-widest opacity-70">
        {initials.toUpperCase()}
      </span>
    </div>
  )
}

export const BookCard = memo(function BookCard({ book, onOpen, collectionId }: CardProps) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const ui = useUi()
  const [editOpen, setEditOpen] = useState(false)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)

  const items = (): MenuItem[] => [
    { label: t('library.openBook'), icon: <BookOpen size={14} />, onClick: () => onOpen(book) },
    ...(book.status !== 'finished'
      ? [{ label: t('library.markFinished'), icon: <CheckCheck size={14} />, onClick: () => void lib.updateBook(book.id, { status: 'finished', progress: 100 }) }]
      : [{ label: t('library.markReading'), icon: <RotateCcw size={14} />, onClick: () => void lib.updateBook(book.id, { status: 'reading', progress: Math.min(book.progress, 95) }) }]),
    {
      label: book.favorite ? t('library.removeFavorite') : t('library.addFavorite'),
      icon: <Heart size={14} />,
      onClick: () => void lib.updateBook(book.id, { favorite: book.favorite ? 0 : 1 })
    },
    { divider: true, label: '' },
    { label: t('library.editMetadata'), icon: <Pencil size={14} />, onClick: () => setEditOpen(true) },
    {
      label: t('library.addToCollection'),
      icon: <FolderPlus size={14} />,
      onClick: () => setShelfOpen(true)
    },
    ...(collectionId
      ? [
          {
            label: t('library.removeFromCollection'),
            icon: <FolderMinus size={14} />,
            onClick: () => void lib.removeBookFromCollection(collectionId, book.id)
          }
        ]
      : []),
    {
      label: t('library.revealInFolder'),
      icon: <ExternalLink size={14} />,
      onClick: () => void window.api.revealBookFile(book.id)
    },
    { divider: true, label: '' },
    {
      label: t('library.deleteBook'),
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => void ui.toast(t('library.deleteBookConfirm', { title: book.title }), 'error')
    }
  ]

  // الحذف يتم عبر نافذة تأكيد في الصفحة الأم عبر حدث مخصص
  const openDelete = (): void => {
    window.dispatchEvent(new CustomEvent('maktaba:delete-book', { detail: book }))
  }

  const menuItems = items().map((it) =>
    it.label === t('library.deleteBook') ? { ...it, onClick: openDelete } : it
  )

  return (
    <>
      <div
        className="group relative cursor-pointer rounded-2xl p-2 transition-all hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
        onDoubleClick={() => onOpen(book)}
        onClick={() => onOpen(book)}
        onContextMenu={(e) => {
          e.preventDefault()
          setCtx({ x: e.clientX, y: e.clientY })
        }}
      >
        {/* الغلاف */}
        <div className="relative mx-auto aspect-[2/3] w-full max-w-[190px] overflow-hidden rounded-xl shadow-md shadow-black/15 ring-1 ring-black/5 dark:ring-white/10 transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-lg">
          <CoverImage book={book} />
          {/* شريط تقدم */}
          {book.progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6">
              <ProgressBar percent={book.progress} className="h-1" />
              <p className="mt-1 text-end text-[10px] font-semibold text-white/90">{Math.round(book.progress)}%</p>
            </div>
          )}
          {book.favorite === 1 && (
            <div className="absolute end-2 top-2 rounded-full bg-black/45 p-1.5 text-amber-300 backdrop-blur">
              <Heart size={12} fill="currentColor" />
            </div>
          )}
          <div className="absolute start-2 top-2">
            <Badge color={book.format === 'pdf' ? '#ef4444' : '#3b82f6'}>{book.format.toUpperCase()}</Badge>
          </div>
          {/* زر التراكب — يفتح قائمة الخيارات */}
          <button
            className={cn(
              'absolute bottom-2 end-2 z-10 rounded-lg bg-black/55 p-1.5 text-white opacity-0 backdrop-blur transition-opacity',
              'group-hover:opacity-100 hover:!bg-black/75'
            )}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setCtx({ x: r.left, y: r.bottom + 4 })
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setCtx({ x: r.left, y: r.bottom + 4 })
            }}
            title={t('library.moreOptions')}
          >
            <MoreVertical size={15} />
          </button>
        </div>

        {/* المعلومات */}
        <div className="mt-2.5 px-1">
          <p className="truncate text-[13px] font-semibold leading-snug" title={book.title}>
            {book.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{book.author || '—'}</p>
        </div>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={[...menuItems]} onClose={() => setCtx(null)} />}

      <MetadataDialog book={book} open={editOpen} onClose={() => setEditOpen(false)} />
      <AddToShelfDialog book={book} open={shelfOpen} onClose={() => setShelfOpen(false)} />
    </>
  )
})

/** صف القائمة التفصيلية */
export function BookRow({ book, onOpen, collectionId }: CardProps) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const [editOpen, setEditOpen] = useState(false)
  const [shelfOpen, setShelfOpen] = useState(false)

  const menuItems: MenuItem[] = [
    { label: t('library.openBook'), icon: <BookOpen size={14} />, onClick: () => onOpen(book) },
    { label: t('library.editMetadata'), icon: <Pencil size={14} />, onClick: () => setEditOpen(true) },
    {
      label: t('library.addToCollection'),
      icon: <FolderPlus size={14} />,
      onClick: () => setShelfOpen(true)
    },
    ...(collectionId
      ? [
          {
            label: t('library.removeFromCollection'),
            icon: <FolderMinus size={14} />,
            onClick: () => void lib.removeBookFromCollection(collectionId, book.id)
          }
        ]
      : []),
    { divider: true, label: '' },
    {
      label: t('library.deleteBook'),
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => window.dispatchEvent(new CustomEvent('maktaba:delete-book', { detail: book }))
    }
  ]

  return (
    <div
      className="group flex cursor-pointer items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.05]"
      onClick={() => onOpen(book)}
    >
      <div className="h-16 w-11 shrink-0 overflow-hidden rounded-md shadow ring-1 ring-black/10">
        <CoverImage book={book} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge color={book.format === 'pdf' ? '#ef4444' : '#3b82f6'}>{book.format.toUpperCase()}</Badge>
          <p className="truncate text-sm font-semibold">{book.title}</p>
          {book.favorite === 1 && <Heart size={12} className="shrink-0 text-amber-400" fill="currentColor" />}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{book.author || '—'}</p>
        {book.progress > 0 && <ProgressBar percent={book.progress} className="mt-1.5 max-w-56 h-1" />}
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-xs text-muted md:flex">
        <StarRatingMini value={book.rating} />
        <span className="w-20 text-end">{formatBytes(book.size)}</span>
        <span className="w-24 text-end">{formatRelativeTime(book.lastReadAt, t)}</span>
      </div>
      <DropdownMenu trigger={<MoreVertical size={16} className="mx-1 opacity-60 hover:opacity-100" />} items={menuItems} />
      <MetadataDialog book={book} open={editOpen} onClose={() => setEditOpen(false)} />
      <AddToShelfDialog book={book} open={shelfOpen} onClose={() => setShelfOpen(false)} />
    </div>
  )
}

function StarRatingMini({ value }: { value: number }) {
  if (!value) return null
  return (
    <span className="inline-flex w-20 items-center justify-end gap-0.5 text-amber-400">
      <Star size={12} fill="currentColor" />
      <span className="text-[11px] font-medium">{value}</span>
    </span>
  )
}
