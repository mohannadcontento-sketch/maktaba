import {
  BookOpen,
  BarChart3,
  Settings2,
  FolderOpen,
  Tag as TagIcon,
  Plus,
  Trash2,
  Pencil,
  LibraryBig,
  PanelLeftClose
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUi } from '@/stores/ui'
import { useLibrary } from '@/stores/library'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/Dialog'
import { Button, Input } from '@/components/ui/kit'
import { ContextMenu, type MenuItem } from '@/components/ui/Menu'
import { IconButton } from '@/components/ui/IconButton'

const TAG_COLORS = ['#0d9488', '#f59e0b', '#3b82f6', '#ef4444', '#a855f7', '#ec4899', '#84cc16', '#64748b']

function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick(): void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all',
        active
          ? 'bg-accent/12 text-accent-strong dark:bg-daccent/15 dark:text-daccent'
          : 'text-muted hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05] dark:hover:text-dink'
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const ui = useUi()
  const lib = useLibrary()
  const [newColOpen, setNewColOpen] = useState(false)
  const [colName, setColName] = useState('')
  const [editingId, setEditingId] = useState<{ id: number; name: string } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: number; name: string } | null>(null)

  const page = ui.page === 'reader' ? 'library' : ui.page

  const collectionItems = (id: number, name: string): MenuItem[] => [
    {
      label: t('common.rename'),
      icon: <Pencil size={14} />,
      onClick: () => {
        setEditingId({ id, name })
        setColName(name)
        setNewColOpen(true)
      }
    },
    {
      label: t('common.delete'),
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => {
        void lib.deleteCollectionById(id)
        if (ui.activeCollectionId === id) ui.setActiveCollection(null)
      }
    }
  ]

  return (
    <aside
      className={cn(
        'z-30 flex h-full w-60 shrink-0 flex-col border-e border-line bg-surface2 dark:border-dline dark:bg-dsurface',
        !ui.sidebarOpen && 'hidden'
      )}
    >
      {/* شعار */}
      <div className="drag-region flex h-[52px] items-center gap-2.5 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-md shadow-teal-500/25">
          <LibraryBig size={19} />
        </div>
        <div>
          <p className="text-[15px] font-bold leading-none">{t('appName')}</p>
          <p className="mt-1 text-[10px] leading-none text-muted">EPUB · PDF Reader</p>
        </div>
        <div className="ms-auto">
          <IconButton title={t('nav.hideSidebar')} onClick={() => useUi.getState().toggleSidebar()}>
            <PanelLeftClose size={17} />
          </IconButton>
        </div>
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 px-3">
        <NavItem
          icon={<BookOpen size={18} />}
          label={t('nav.library')}
          active={page === 'library'}
          onClick={() => ui.setPage('library')}
        />
        <NavItem
          icon={<BarChart3 size={18} />}
          label={t('nav.stats')}
          active={page === 'stats'}
          onClick={() => ui.setPage('stats')}
        />
        <NavItem
          icon={<Settings2 size={18} />}
          label={t('nav.settings')}
          active={page === 'settings'}
          onClick={() => ui.setPage('settings')}
        />
      </nav>

      <div className="mx-4 my-3 h-px bg-line dark:bg-dline" />

      {/* المجموعات */}
      <div className="flex items-center justify-between px-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t('library.collections')}</p>
        <button
          className="rounded p-1 text-muted hover:bg-black/[0.06] dark:hover:bg-white/10"
          onClick={() => {
            setEditingId(null)
            setColName('')
            setNewColOpen(true)
          }}
          title={t('library.newCollection')}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="mt-1 flex-1 overflow-y-auto px-3 pb-3">
        <NavItem
          icon={<FolderOpen size={17} />}
          label={t('library.collections')}
          active={false}
          onClick={() => ui.setActiveCollection(null)}
        />
        {lib.collections.map((c) => (
          <div key={c.id} onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, id: c.id, name: c.name }) }}>
            <NavItem
              icon={<FolderOpen size={17} />}
              label={`${c.name} (${c.bookCount})`}
              active={ui.activeCollectionId === c.id && page === 'library'}
              onClick={() => {
                ui.setPage('library')
                ui.setActiveCollection(c.id)
              }}
            />
          </div>
        ))}

        <p className="mb-1 mt-4 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t('library.tagsSection')}
        </p>
        {lib.tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => {
              ui.setPage('library')
              ui.setActiveTag(ui.activeTagId === tag.id ? null : tag.id)
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2 text-sm transition-all',
              ui.activeTagId === tag.id && page === 'library'
                ? 'bg-accent/12 font-medium'
                : 'text-muted hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
            )}
          >
            <TagIcon size={15} style={{ color: tag.color }} />
            <span className="truncate">{tag.name}</span>
          </button>
        ))}
        {lib.tags.length === 0 && (
          <p className="px-3.5 py-2 text-xs text-muted/70">—</p>
        )}
      </div>

      <Dialog
        open={newColOpen}
        onClose={() => setNewColOpen(false)}
        title={editingId ? t('common.rename') : t('library.newCollection')}
        width="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewColOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!colName.trim()}
              onClick={async () => {
                if (editingId) await lib.renameCollectionById(editingId.id, colName.trim())
                else await lib.createCollection(colName.trim())
                setNewColOpen(false)
                setEditingId(null)
                setColName('')
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={colName}
          onChange={(e) => setColName(e.target.value)}
          placeholder={t('library.collectionNamePrompt')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && colName.trim()) {
              void (async () => {
                if (editingId) await lib.renameCollectionById(editingId.id, colName.trim())
                else await lib.createCollection(colName.trim())
                setNewColOpen(false)
                setEditingId(null)
                setColName('')
              })()
            }
          }}
        />
        <div className="mt-3 flex gap-2">
          {TAG_COLORS.map((color) => (
            <span key={color} className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
          ))}
        </div>
      </Dialog>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={collectionItems(ctxMenu.id, ctxMenu.name)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </aside>
  )
}
