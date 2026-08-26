import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search,
  Import,
  FolderSearch,
  LayoutGrid,
  List as ListIcon,
  ArrowUpDown,
  BookOpen,
  PlayCircle,
  X
} from 'lucide-react'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { useReader } from '@/stores/reader'
import type { Book } from '../../../shared/types'
import { normalizeText } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Button, Input, EmptyState, ProgressBar } from '@/components/ui/kit'
import { DropdownMenu } from '@/components/ui/Menu'
import { TitleBar } from '@/components/layout/Chrome'
import { BookCard, BookRow, CoverImage } from '@/components/library/BookCard'
import { DeleteBookDialog } from '@/components/library/MetadataDialog'

type Filter = 'all' | 'reading' | 'unread' | 'finished' | 'favorite'

export function LibraryPage() {
  const { t } = useTranslation()
  const lib = useLibrary()
  const ui = useUi()
  const reader = useReader()
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null)

  // فتح كتاب في القارئ
  const openBook = (book: Book): void => {
    void reader.open(book).then(() => ui.setPage('reader'))
  }

  // حدث الحذف من قائمة السياق
  useEffect(() => {
    const fn = (e: Event): void => setDeleteTarget((e as CustomEvent).detail as Book)
    window.addEventListener('maktaba:delete-book', fn)
    return () => window.removeEventListener('maktaba:delete-book', fn)
  }, [])

  // اختصار Ctrl+O للاستيراد
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void doImportRef()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doImport = async (): Promise<void> => {
    const added = await window.api.pickAndImportBooks()
    await lib.load()
    if (added.length > 0) ui.toast(t('library.importedCount', { count: added.length }), 'success')
    else ui.toast(t('library.importedNone'), 'info')
  }
  const doImportRef = doImport

  const doScan = async (): Promise<void> => {
    const added = await window.api.pickFolderAndScan()
    await lib.load()
    if (added.length > 0) ui.toast(t('library.importedCount', { count: added.length }), 'success')
    else ui.toast(t('library.importedNone'), 'info')
  }

  // تصفية وترتيب
  const [collectionIds, setCollectionIds] = useState<string[] | null>(null)

  useEffect(() => {
    if (ui.activeCollectionId) {
      void window.api.getCollectionBookIds(ui.activeCollectionId).then(setCollectionIds)
    } else {
      setCollectionIds(null)
    }
  }, [ui.activeCollectionId])

  const visible = useMemo(() => {
    let list = [...lib.books]
    if (ui.activeCollectionId && collectionIds) list = list.filter((b) => collectionIds.includes(b.id))
    if (ui.activeTagId) list = list.filter((b) => b.tags.some((tg) => tg.id === ui.activeTagId))
    switch (ui.filterStatus) {
      case 'reading':
        list = list.filter((b) => b.status === 'reading')
        break
      case 'unread':
        list = list.filter((b) => b.status === 'new')
        break
      case 'finished':
        list = list.filter((b) => b.status === 'finished')
        break
      case 'favorite':
        list = list.filter((b) => b.favorite === 1)
        break
    }
    const q = normalizeText(ui.searchQuery.trim())
    if (q) {
      list = list.filter(
        (b) =>
          normalizeText(b.title).includes(q) ||
          normalizeText(b.author ?? '').includes(q) ||
          b.tags.some((tg) => normalizeText(tg.name).includes(q))
      )
    }
    switch (lib.sortKey) {
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title, 'ar'))
        break
      case 'author':
        list.sort((a, b) => (a.author ?? '').localeCompare(b.author ?? '', 'ar'))
        break
      case 'progress':
        list.sort((a, b) => b.progress - a.progress)
        break
      case 'added':
        list.sort((a, b) => b.addedAt - a.addedAt)
        break
      default:
        list.sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
    }
    return list
  }, [lib.books, lib.sortKey, ui.activeCollectionId, ui.activeTagId, ui.filterStatus, ui.searchQuery, collectionIds])

  // صف أكمل القراءة: كتب قيد القراءة غير ظاهرة في نتائج البحث النشط
  const readingNow = useMemo(() => {
    if (ui.searchQuery.trim() || ui.activeCollectionId || ui.activeTagId || ui.filterStatus !== 'all') return []
    return lib.books
      .filter((b) => b.status === 'reading' && b.progress > 0 && b.progress < 99)
      .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
      .slice(0, 6)
  }, [lib.books, ui.searchQuery, ui.activeCollectionId, ui.activeTagId, ui.filterStatus])

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('library.allBooks') },
    { id: 'reading', label: t('library.reading') },
    { id: 'unread', label: t('library.unread') },
    { id: 'finished', label: t('library.finished') },
    { id: 'favorite', label: t('library.favorite') }
  ]

  const sortOptions = [
    { id: 'recent', label: t('library.sortRecent') },
    { id: 'added', label: t('library.sortAdded') },
    { id: 'title', label: t('library.sortTitle') },
    { id: 'author', label: t('library.sortAuthor') },
    { id: 'progress', label: t('library.sortProgress') }
  ] as const

  return (
    <>
      <TitleBar
        left={
          !ui.sidebarOpen ? (
            <Button variant="ghost" size="sm" className="no-drag" onClick={() => useUi.getState().toggleSidebar()}>
              ☰
            </Button>
          ) : null
        }
        right={null}
      />

      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface2/60 px-4 py-2.5 dark:border-dline dark:bg-dsurface/40">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={ui.searchQuery}
            onChange={(e) => ui.setSearchQuery(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            className="w-64 ps-9"
          />
          {ui.searchQuery && (
            <button
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              onClick={() => ui.setSearchQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex rounded-lg border border-line dark:border-dline p-0.5">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => ui.setFilterStatus(f.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-all',
                ui.filterStatus === f.id
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-muted hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ms-auto flex items-center gap-1.5">
          <DropdownMenu
            trigger={
              <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-black/[0.05] dark:hover:bg-white/10">
                <ArrowUpDown size={14} />
                {sortOptions.find((s) => s.id === lib.sortKey)?.label}
              </span>
            }
            items={sortOptions.map((s) => ({
              label: s.label,
              checked: lib.sortKey === s.id,
              onClick: () => lib.setSortKey(s.id)
            }))}
          />
          <div className="flex rounded-lg border border-line p-0.5 dark:border-dline">
            <button
              title={t('library.viewGrid')}
              onClick={() => lib.setView('grid')}
              className={cn(
                'rounded-md p-1.5',
                lib.view === 'grid' ? 'bg-accent/12 text-accent-strong' : 'text-muted'
              )}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              title={t('library.viewList')}
              onClick={() => lib.setView('list')}
              className={cn(
                'rounded-md p-1.5',
                lib.view === 'list' ? 'bg-accent/12 text-accent-strong' : 'text-muted'
              )}
            >
              <ListIcon size={15} />
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={() => void doScan()}>
            <FolderSearch size={15} />
            <span className="hidden xl:inline">{t('library.scanFolder')}</span>
          </Button>
          <Button size="sm" onClick={() => void doImport()}>
            <Import size={15} />
            {t('library.importBooks')}
          </Button>
        </div>
      </div>

      {/* المحتوى */}
      <div className="flex-1 overflow-y-auto">
        {!lib.loaded ? (
          <div className="flex h-full items-center justify-center text-muted">{t('common.loading')}</div>
        ) : lib.books.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={64} strokeWidth={1.1} />}
            title={t('library.noBooks')}
            hint={t('library.noBooksHint')}
            action={
              <Button className="mt-2" onClick={() => void doImport()}>
                <Import size={16} />
                {t('library.importBooks')}
              </Button>
            }
          />
        ) : (
          <div className="px-5 py-4">
            {/* أكمل القراءة */}
            {readingNow.length > 0 && visible.length > 0 && (
              <section className="mb-6 anim-in">
                <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold">
                  <PlayCircle size={18} className="text-accent" />
                  {t('library.continueReading')}
                </h2>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {readingNow.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => openBook(b)}
                      className="group flex w-72 shrink-0 items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md dark:border-dline dark:bg-dsurface"
                    >
                      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg shadow ring-1 ring-black/10">
                        <CoverImage book={b} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{b.title}</p>
                        <p className="truncate text-xs text-muted">{b.author}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <ProgressBar percent={b.progress} className="h-1" />
                          <span className="shrink-0 text-[11px] font-semibold text-accent-strong dark:text-daccent">
                            {Math.round(b.progress)}%
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted">
                {ui.activeCollectionId
                  ? `${lib.collections.find((c) => c.id === ui.activeCollectionId)?.name} · `
                  : ''}
                {visible.length} / {lib.books.length}
              </h2>
              {(ui.searchQuery || ui.filterStatus !== 'all' || ui.activeTagId) && (
                <button
                  className="text-xs text-muted underline-offset-2 hover:underline"
                  onClick={() => {
                    ui.setSearchQuery('')
                    ui.setFilterStatus('all')
                    ui.setActiveTag(null)
                    ui.setActiveCollection(null)
                  }}
                >
                  ✕ مسح عوامل التصفية
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <EmptyState icon={<Search size={48} strokeWidth={1.2} />} title={t('library.noResults')} />
            ) : lib.view === 'grid' ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {visible.map((b) => (
                  <BookCard
                    key={b.id}
                    book={b}
                    onOpen={openBook}
                    collectionId={ui.activeCollectionId}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {visible.map((b) => (
                  <BookRow
                    key={b.id}
                    book={b}
                    onOpen={openBook}
                    collectionId={ui.activeCollectionId}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <DeleteBookDialog book={deleteTarget} onClose={() => setDeleteTarget(null)} />

      {lib.importing && (
        <div className="fixed bottom-4 end-4 z-50 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-lg dark:border-dline dark:bg-dsurface">
          ⏳ جارٍ الاستيراد…
        </div>
      )}
    </>
  )
}
