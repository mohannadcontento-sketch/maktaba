import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, ImageDown, Loader2, Trash2, Search } from 'lucide-react'
import type { Book } from '../../../../shared/types'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { Dialog } from '@/components/ui/Dialog'
import { Button, Input, Textarea, StarRating } from '@/components/ui/kit'
import { cn } from '@/lib/utils'
import { CoverPickerDialog } from './CoverPickerDialog'
import { useCoverSrc } from '@/platform/covers'

const TAG_COLORS = ['#0d9488', '#f59e0b', '#3b82f6', '#ef4444', '#a855f7', '#ec4899']

export function MetadataDialog({ book, open, onClose }: { book: Book; open: boolean; onClose(): void }) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const ui = useUi()
  const [form, setForm] = useState({
    title: '',
    author: '',
    language: '',
    publisher: '',
    pubDate: '',
    description: '',
    rating: 0
  })
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [newTag, setNewTag] = useState('')
  const [coverFetching, setCoverFetching] = useState(false)
  const [coverPreview, setCoverPreview] = useState<string | null>(book.coverPath)
  const [coverBust, setCoverBust] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const previewSrc = useCoverSrc(coverPreview, coverBust > 0)

  useEffect(() => {
    if (open && book) {
      setForm({
        title: book.title,
        author: book.author ?? '',
        language: book.language ?? '',
        publisher: book.publisher ?? '',
        pubDate: book.pubDate ?? '',
        description: book.description ?? '',
        rating: book.rating
      })
      setSelectedTags(book.tags.map((tg) => tg.id))
      setCoverPreview(book.coverPath)
      setCoverBust(0)
    }
  }, [open, book])

  const save = async (): Promise<void> => {
    await lib.updateBook(book.id, {
      title: form.title.trim() || book.title,
      author: form.author.trim() || null,
      language: form.language.trim() || null,
      publisher: form.publisher.trim() || null,
      pubDate: form.pubDate.trim() || null,
      description: form.description.trim() || null,
      rating: form.rating
    })
    await lib.setBookTags(book.id, selectedTags)
    onClose()
  }

  const toggleTag = (id: number): void => {
    setSelectedTags((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  const addTag = async (): Promise<void> => {
    const name = newTag.trim()
    if (!name) return
    const existing = lib.tags.find((x) => x.name.toLowerCase() === name.toLowerCase())
    const tag = existing ?? (await lib.createTag(name, TAG_COLORS[lib.tags.length % TAG_COLORS.length]))
    if (!selectedTags.includes(tag.id)) setSelectedTags((s) => [...s, tag.id])
    setNewTag('')
  }

  const fetchWebCover = async (): Promise<void> => {
    setCoverFetching(true)
    try {
      const fresh = await window.api.fetchWebCover(
        book.id,
        form.title.trim() || book.title,
        form.author.trim() || book.author
      )
      if (fresh?.coverPath) {
        setCoverPreview(fresh.coverPath)
        setCoverBust((b) => b + 1)
        ui.toast(t('library.coverFetched'), 'success')
        await lib.reloadOne(book.id)
      } else {
        ui.toast(t('library.coverNotFound'), 'info')
      }
    } catch {
      ui.toast(t('library.coverError'), 'error')
    } finally {
      setCoverFetching(false)
    }
  }

  const clearCover = async (): Promise<void> => {
    await lib.updateBook(book.id, { coverPath: null })
    setCoverPreview(null)
    await lib.reloadOne(book.id)
  }

  // عند اختيار صورة من المنتقي — تحديث المعاينة فورًا
  const onPickerPicked = (updated: Book): void => {
    setCoverPreview(updated.coverPath)
    setCoverBust((b) => b + 1)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('library.metadataTitle')}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()}>{t('common.save')}</Button>
        </>
      }
    >
      {/* معاينة الغلاف */}
      <div className="mb-4 flex items-center gap-4 rounded-2xl border border-line bg-surface2/50 p-3 dark:border-dline dark:bg-dsurface2/40">
        <div className="relative h-32 w-22 shrink-0 overflow-hidden rounded-xl shadow-md ring-1 ring-black/10">
          {previewSrc ? (
            <img src={previewSrc} alt={book.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-teal-600/20 to-emerald-600/20 text-muted">
              <ImageDown size={26} />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs font-medium text-muted">{t('library.coverLabel')}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => setPickerOpen(true)}>
              <Search size={14} />
              {t('library.pickFromWeb')}
            </Button>
            <Button size="sm" variant="soft" onClick={() => void fetchWebCover()} disabled={coverFetching}>
              {coverFetching ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />}
              {t('library.fetchCover')}
            </Button>
            {coverPreview && (
              <Button size="sm" variant="ghost" onClick={() => void clearCover()}>
                <Trash2 size={14} />
                {t('library.removeCover')}
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted/70">{t('library.coverHint')}</p>
        </div>
      </div>

      {/* منتقي الأغلفة من الويب (2.2) */}
      <CoverPickerDialog
        book={{ ...book, title: form.title.trim() || book.title, author: form.author.trim() || book.author }}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPicked={onPickerPicked}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('library.titleField')} className="col-span-2">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label={t('library.authorField')}>
          <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
        </Field>
        <Field label={t('library.languageField')}>
          <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
        </Field>
        <Field label={t('library.publisherField')}>
          <Input value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
        </Field>
        <Field label={t('library.pubDateField')}>
          <Input value={form.pubDate} onChange={(e) => setForm({ ...form, pubDate: e.target.value })} />
        </Field>
        <Field label={t('library.descriptionField')} className="col-span-2">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div className="col-span-2">
          <p className="mb-1.5 text-xs font-medium text-muted">{t('library.ratingField')}</p>
          <StarRating value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} size={20} />
        </div>

        <div className="col-span-2">
          <p className="mb-1.5 text-xs font-medium text-muted">{t('library.tagsField')}</p>
          <div className="flex flex-wrap gap-1.5">
            {lib.tags.map((tag) => {
              const on = selectedTags.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-all',
                    on ? 'text-white shadow-sm' : 'border-line text-muted hover:border-muted dark:border-dline'
                  )}
                  style={on ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                >
                  {tag.name}
                </button>
              )
            })}
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 dark:border-dline">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addTag()}
                placeholder={t('library.newTagPlaceholder')}
                className="w-24 bg-transparent py-1 text-xs outline-none placeholder:text-muted"
              />
              <button onClick={() => void addTag()} className="text-muted hover:text-accent">
                <Plus size={12} />
              </button>
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function Field({
  label,
  children,
  className
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

/** نافذة تأكيد الحذف العامة */
export function DeleteBookDialog({
  book,
  onClose
}: {
  book: Book | null
  onClose(deleted: boolean): void
}) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const ui = useUi()
  const [alsoFile, setAlsoFile] = useState(false)

  useEffect(() => {
    setAlsoFile(false)
  }, [book])

  if (!book) return null

  return (
    <Dialog
      open={!!book}
      onClose={() => onClose(false)}
      title={t('library.deleteBook')}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await lib.removeBook(book.id, alsoFile)
              ui.toast(t('library.bookDeleted'), 'success')
              onClose(true)
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed">{t('library.deleteBookConfirm', { title: book.title })}</p>
      <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-xl border border-line p-3 text-sm dark:border-dline">
        <input
          type="checkbox"
          checked={alsoFile}
          onChange={(e) => setAlsoFile(e.target.checked)}
          className="h-4 w-4 accent-red-600"
        />
        {t('library.deleteFileAlso')}
      </label>
    </Dialog>
  )
}

