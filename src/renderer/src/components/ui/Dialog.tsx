import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose(): void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
}

export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg' }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={cn(
          'anim-in w-full rounded-2xl border border-line dark:border-dline bg-surface dark:bg-dsurface shadow-2xl',
          width
        )}
      >
        <div className="flex items-center justify-between border-b border-line/70 px-5 py-3.5 dark:border-dline/70">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/10">
            <X size={17} />
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line/70 px-5 py-3 dark:border-dline/70">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
