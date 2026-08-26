import { useEffect } from 'react'
import { useUi } from '@/stores/ui'
import { useLibrary } from '@/stores/library'
import { useReader } from '@/stores/reader'
import { applyDirection, initI18n } from '@/i18n'
import { AppShell, Toaster } from '@/components/layout/Chrome'
import { Sidebar } from '@/components/layout/Sidebar'
import { LibraryPage } from '@/pages/LibraryPage'
import { StatsPage } from '@/pages/StatsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ReaderPage } from '@/pages/ReaderPage'

export default function App() {
  const ui = useUi()
  const lib = useLibrary()

  // تهيئة الإعدادات المحفوظة
  useEffect(() => {
    void (async () => {
      const [themeMode, lang] = await Promise.all([
        window.api.getSetting('app.themeMode'),
        window.api.getSetting('app.lang')
      ])
      initI18n(lang === 'en' ? 'en' : 'ar')
      applyDirection(lang === 'en' ? 'en' : 'ar')
      ui.setLang(lang === 'en' ? 'en' : 'ar')
      ui.setThemeMode((themeMode as 'light' | 'dark' | 'system') || 'system')
      await lib.load()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // استجابة تغير ثيم النظام
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (): void => {
      if (ui.themeMode === 'system') ui.setThemeMode('system')
    }
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.themeMode])

  // سحب وإفلات الملفات على كامل النافذة
  useEffect(() => {
    let depth = 0
    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer?.types.includes('Files')) {
        depth++
        ui.setDropOverlay(true)
      }
    }
    const onDragLeave = (e: DragEvent): void => {
      e.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) ui.setDropOverlay(false)
    }
    const onDragOver = (e: DragEvent): void => e.preventDefault()
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault()
      depth = 0
      ui.setDropOverlay(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      const paths = window.api.pathsForFiles(files).filter(Boolean)
      if (paths.length) {
        const n = await lib.importPaths(paths)
        ui.toast(
          n > 0
            ? useUi.getState().lang === 'ar'
              ? `تم استيراد ${n} كتاب`
              : `Imported ${n} book(s)`
            : useUi.getState().lang === 'ar'
              ? 'لم يُستورد أي كتاب جديد'
              : 'Nothing new imported',
          n > 0 ? 'success' : 'info'
        )
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', (e) => void onDrop(e))
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "فتح باستخدام" من النظام
  useEffect(() => {
    const off = window.api.onOpenFiles((paths) => {
      void lib.importPaths(paths).then((n) => {
        if (n > 0) ui.toast(`+${n}`, 'success')
      })
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const page = ui.page

  return (
    <AppShell>
      {!useReaderHidesSidebar(page) && <Sidebar />}
      <main className="relative flex h-full min-w-0 flex-1 flex-col">
        {page === 'library' && <LibraryPage />}
        {page === 'stats' && <StatsPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'reader' && <ReaderPage />}
      </main>
      <Toaster />
      {ui.dropOverlay && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-teal-900/60 backdrop-blur-sm">
          <div className="anim-in flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-teal-300 bg-white/10 px-16 py-12 text-white">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 3v13m0 0l-4.5-4.5M12 16l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" />
            </svg>
            <p className="text-xl font-bold">أفلِت الملفات للاستيراد</p>
            <p className="text-sm opacity-80">PDF · EPUB</p>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function useReaderHidesSidebar(page: string): boolean {
  return page === 'reader'
}
