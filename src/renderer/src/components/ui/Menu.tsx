import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  divider?: boolean
  checked?: boolean
  onClick?(): void
}

/** قائمة منسدلة تُفتح من زر مرجعي */
export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  width = 'w-52'
}: {
  trigger: ReactNode
  items: MenuItem[]
  align?: 'start' | 'end'
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const menuH = Math.min(items.length * 36 + 12, 420)
      const below = r.bottom + menuH < window.innerHeight - 8 || r.top - menuH < 8
      setPos({
        top: below ? r.bottom + 6 : r.top - menuH - 6,
        left:
          align === 'end' ? Math.max(8, r.right - 208 + (width.includes('64') ? 56 : 0)) : r.left
      })
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button ref={btnRef} onClick={toggle} className="contents">
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left }}
            className={cn(
              'fixed z-[90] anim-in overflow-hidden rounded-xl border border-line dark:border-dline',
              'bg-surface dark:bg-dsurface2 py-1.5 shadow-xl min-w-40 max-h-[60vh] overflow-y-auto',
              width
            )}
          >
            {items.map((it, i) =>
              it.divider ? (
                <div key={i} className="my-1 h-px bg-line dark:bg-dline" />
              ) : (
                <button
                  key={i}
                  onClick={() => {
                    setOpen(false)
                    it.onClick?.()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3.5 py-2 text-start text-[13px] transition-colors',
                    it.danger
                      ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
                      : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
                  )}
                >
                  {it.icon && <span className="shrink-0 opacity-70">{it.icon}</span>}
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.checked && <span className="text-accent">✓</span>}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/** قائمة سياق تظهر عند نقطة معينة */
export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: y, left: x })

  useEffect(() => {
    const el = ref.current
    if (el) {
      const rect = el.getBoundingClientRect()
      setPos({
        top: Math.min(y, window.innerHeight - rect.height - 8),
        left: Math.min(x, window.innerWidth - rect.width - 8)
      })
    }
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // تأخير بسيط لتفادي إغلاق فوري بسبب نفس حدث النقر
    const t = setTimeout(() => document.addEventListener('mousedown', close), 10)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[90] anim-in w-56 overflow-hidden rounded-xl border border-line dark:border-dline bg-surface dark:bg-dsurface2 py-1.5 shadow-xl"
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="my-1 h-px bg-line dark:bg-dline" />
        ) : (
          <button
            key={i}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
            className={cn(
              'flex w-full items-center gap-2.5 px-3.5 py-2 text-start text-[13px] transition-colors',
              it.danger
                ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
                : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.07]'
            )}
          >
            {it.icon && <span className="shrink-0 opacity-70">{it.icon}</span>}
            <span className="flex-1 truncate">{it.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  )
}
