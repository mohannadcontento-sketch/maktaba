import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, Check, X } from 'lucide-react'
import type { Book } from '../../../../shared/types'
import { useLibrary } from '@/stores/library'
import { useUi } from '@/stores/ui'
import { Dialog } from '@/components/ui/Dialog'
import { Button, Input } from '@/components/ui/kit'

/** نافذة اختيار الرفوف (المجموعات) لإضافة/إزالة كتاب */
export function AddToShelfDialog({ book, open, onClose }: { book: Book; open: boolean; onClose(): void }) {
  const { t } = useTranslation()
  const lib = useLibrary()
  const ui = useUi()
  const [newName, setNewName] = useState('')
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set())

  // تحميل الرفوف التي ينتمي إليها الكتاب
  useEffect(() => {
    if (!open) return
    void (async () => {
      const ids = new Set<number>()
      for (const c of lib.collections) {
        const bookIds = await window.api.getCollectionBookIds(c.id)
        if (bookIds.includes(book.id)) ids.add(c.id)
      }
      setMemberIds(ids)
    })()
  }, [open, book.id, lib.collections])

  const toggle = async (cid: number): Promise<void> => {
    const isMember = memberIds.has(cid)
    if (isMember) {
      await lib.removeBookFromCollection(cid, book.id)
      setMemberIds((s) => {
        const n = new Set(s)
        n.delete(cid)
        return n
      })
    } else {
      await lib.addBookToCollection(cid, book.id)
      setMemberIds((s) => new Set(s).add(cid))
    }
  }

  const createAndAdd = async (): Promise<void> => {
    const name = newName.trim()
    if (!name) return
    const c = await lib.createCollection(name)
    await lib.addBookToCollection(c.id, book.id)
    setMemberIds((s) => new Set(s).add(c.id))
    setNewName('')
    ui.toast(t('library.addedToShelf', { name }), 'success')
  }

  const sorted = useMemo(() => [...lib.collections].sort((a, b) => a.name.localeCompare(b.name, 'ar')), [lib.collections])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('library.addToCollection')}
      width="max-w-sm"
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <p className="mb-3 text-sm text-muted">{t('library.noShelvesYet')}</p>
      ) : (
        <div className="mb-3 max-h-64 space-y-1 overflow-y-auto">
          {sorted.map((c) => {
            const on = memberIds.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => void toggle(c.id)}
                className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-start text-sm transition-colors hover:bg-black/[0.04] dark:border-dline dark:hover:bg-white/[0.05]"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    on ? 'border-accent bg-accent text-white dark:border-daccent dark:bg-daccent' : 'border-line dark:border-dline'
                  }`}
                >
                  {on && <Check size={13} />}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-[11px] text-muted">{c.bookCount}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-1.5 rounded-xl border border-dashed border-line p-1.5 dark:border-dline">
        <FolderPlus size={15} className="ms-1 shrink-0 text-muted" />
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void createAndAdd()}
          placeholder={t('library.newCollectionPlaceholder')}
          className="border-0 bg-transparent focus:ring-0"
        />
        <Button size="sm" variant="soft" disabled={!newName.trim()} onClick={() => void createAndAdd()}>
          {t('common.add')}
        </Button>
      </div>
    </Dialog>
  )
}
