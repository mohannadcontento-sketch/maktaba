import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Square, Copy, X, BookOpen, BarChart3, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUi, type PageName } from '@/stores/ui'
import { cn } from '@/lib/utils'

/** أزرار التحكم بالنافذة (تصميم Windows) — تخفى على الجوال حيث تدير النظام النافذة */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  const isMobile =
    typeof window !== 'undefined' &&
    !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

  useEffect(() => {
    if (isMobile) return
    void window.api.isMaximized().then(setMaximized)
    const onResize = (): void => {
      void window.api.isMaximized().then(setMaximized)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isMobile])

  if (isMobile) return null

  const btn =
    'no-drag flex h-full w-11 items-center justify-center text-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/10 active:scale-95'

  return (
    <div className="flex h-9 shrink-0" dir="ltr">
      <button className={btn} onClick={() => window.api.minimizeWindow()} title="تصغير">
        <Minus size={15} />
      </button>
      <button
        className={btn}
        onClick={() => window.api.toggleMaximizeWindow()}
        title={maximized ? 'استعادة' : 'تكبير'}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        className={cn(btn, 'hover:!bg-red-500 hover:!text-white')}
        onClick={() => window.api.closeWindow()}
        title="إغلاق"
      >
        <X size={16} />
      </button>
    </div>
  )
}

/** شريط علوي عام مع منطقة سحب ومساحة للأدوات */
export function TitleBar({
  center,
  left,
  right,
  transparent
}: {
  center?: ReactNode
  left?: ReactNode
  right?: ReactNode
  transparent?: boolean
}) {
  const dark = useUi((s) => s.resolvedDark)
  return (
    <header
      className={cn(
        'drag-region relative z-40 flex h-[52px] shrink-0 select-none items-center gap-2 px-3',
        transparent ? 'bg-transparent' : 'bg-surface2 dark:bg-dsurface border-b border-line dark:border-dline'
      )}
      style={{ backgroundColor: transparent ? undefined : undefined }}
      data-dark={dark ? '1' : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">{center}</div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {right}
        <div className="ms-1 h-full">
          <WindowControls />
        </div>
      </div>
    </header>
  )
}

/** تنقل سفلي للجوال (مكتبة/إحصاءات/إعدادات) — بديل الشريط الجانبي الذي يستهلك عرض الشاشة */
export function BottomTabs() {
  const { t } = useTranslation()
  const page = useUi((s) => s.page)
  const shown: PageName = page === 'reader' ? 'library' : page
  const tabs: { id: PageName; label: string; icon: ReactNode }[] = [
    { id: 'library', label: t('nav.library'), icon: <BookOpen size={21} /> },
    { id: 'stats', label: t('nav.stats'), icon: <BarChart3 size={21} /> },
    { id: 'settings', label: t('nav.settings'), icon: <Settings2 size={21} /> }
  ]
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 backdrop-blur dark:border-dline dark:bg-dsurface/95"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => useUi.getState().setPage(tab.id)}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium transition-colors active:scale-95',
            shown === tab.id
              ? 'text-accent-strong dark:text-daccent'
              : 'text-muted dark:text-dmuted'
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

/** حاوية التطبيق العامة */
export function AppShell({ children }: { children: ReactNode }) {
  return <div className="flex h-full w-full overflow-hidden">{children}</div>
}

/** تنبيهات منبثقة */
export function Toaster() {
  const toasts = useUi((s) => s.toasts)
  if (!toasts.length) return null
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'anim-in pointer-events-auto rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur',
            t.kind === 'success' &&
              'border-emerald-500/30 bg-emerald-50/95 text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200',
            t.kind === 'error' && 'border-red-500/30 bg-red-50/95 text-red-700 dark:bg-red-900/80 dark:text-red-200',
            t.kind === 'info' && 'border-line bg-white/95 dark:border-dline dark:bg-dsurface/95'
          )}
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  )
}
