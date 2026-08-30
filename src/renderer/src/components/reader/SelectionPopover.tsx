import { useEffect, useState } from 'react'
import { Highlighter, Underline, StickyNote, Copy, Globe, Volume2 } from 'lucide-react'
import { useReader, HIGHLIGHT_COLORS } from '@/stores/reader'
import { useUi } from '@/stores/ui'
import { useTranslation } from 'react-i18next'

/**
 * لوحة عائمة فوق نص محدد تعرض أدوات التمييز/التسطير/الملاحظة/النسخ
 * تعمل مع القارئين معًا عبر window.__pdfCreateAnnotation أو __epubCreateAnnotation
 * وهي أيضًا «قائمة الكليك يمين» المطلوبة: تمييز + كومنت + نسخ + قراءة + بحث
 */
export function SelectionPopover({ isPdf }: { isPdf: boolean }) {
  const sel = useReader((s) => s.selection)
  const setSelection = useReader((s) => s.setSelection)
  const ui = useUi()
  const { t } = useTranslation()
  const [pos, setPos] = useState({ top: -9999, left: -9999 })
  const [showColors, setShowColors] = useState(false)

  useEffect(() => {
    if (!sel) {
      setShowColors(false)
      return
    }
    // موضع ذكي: فوق التحديد إن اتسع الشاشة، وإلا تحته — مع تثبيت داخل الحدود
    // (على الجوال خصوصًا قد يكون التحديد قرب الحافة العليا فيختفي outside)
    const width = 272
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, sel.rect.x))
    const minTop = 66
    const below = Math.min(window.innerHeight - 96, sel.rect.y + sel.rect.h + 10)
    const top = sel.rect.y >= minTop + 52 ? sel.rect.y - 52 : Math.max(minTop, below)
    setPos({ top, left })
  }, [sel])

  // إغلاق اللوحة عند الضغط/اللمس خارجها — وتنظيف التحديد من الكتاب أيضًا
  // (ملاحظة: نقرات داخل iframe الكتاب لا تصل هنا — EpubReader يعالجها بنفسه)
  useEffect(() => {
    if (!sel) return
    const onDown = (e: MouseEvent | TouchEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-selpop]')) return
      const st = useReader.getState()
      st.selection?.removeEpubSelection?.()
      window.getSelection?.()?.removeAllRanges()
      st.setSelection(null)
    }
    // مهلة قصيرة حتى لا تُغلقها نفس الضغطة التي أنتجت التحديد
    const tm = setTimeout(() => {
      window.addEventListener('mousedown', onDown, true)
      window.addEventListener('touchstart', onDown, true)
    }, 450)
    return () => {
      clearTimeout(tm)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('touchstart', onDown, true)
    }
  }, [sel])

  if (!sel) return null

  // أدوات التمييز تحتاج محرك تُسجّل عنده — PDF (عارض موزيلا) يستخدم أداة التمييز الرسمية بدلها
  const canAnnotate =
    !isPdf || !!(window as unknown as { __pdfCreateAnnotation?: unknown }).__pdfCreateAnnotation

  const create = (type: 'highlight' | 'underline' | 'note', color: string): void => {
    const fn = isPdf
      ? (window as unknown as { __pdfCreateAnnotation?: (t: typeof type, c: string) => void })
          .__pdfCreateAnnotation
      : (window as unknown as { __epubCreateAnnotation?: (t: typeof type, c: string) => Promise<void> })
          .__epubCreateAnnotation
    fn?.(type, color)
    if (!isPdf) setSelection(null)
  }

  // قراءة النص المحدد صوتيًا فقط (النسخة 2.2) — بدل قراءة النص كله
  const speakSelection = (): void => {
    if (!sel?.text) return
    ;(window as unknown as { __maktabaSpeakSelection?: (text: string) => void }).__maktabaSpeakSelection?.(sel.text)
    setSelection(null)
  }

  // أزرار أكبر لمسًا على الجوال — القائمة نفسها تعمل باللمس الطويل والكليك يمين
  const btn = 'rounded-lg hover:bg-black/[0.06] dark:hover:bg-white/10 max-md:h-10 max-md:w-11 max-md:justify-center md:px-2 md:py-1.5'

  return (
    <div
      data-selpop="1"
      className="anim-in fixed z-[70] flex items-center gap-0.5 rounded-xl border border-black/10 bg-white/97 p-1 shadow-xl backdrop-blur max-md:rounded-2xl max-md:p-1.5 dark:border-white/15 dark:bg-dsurface2/97"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* تمييز بألوان — يظهر فقط حيث يوجد محرك تمييز (EPUB دائمًا، PDF بعارضه الرسمي لا) */}
      {canAnnotate && (
        <>
          <div className="relative">
            <button
              className={`flex items-center gap-1 text-xs font-medium ${btn}`}
              onClick={() => setShowColors((s) => !s)}
              title="تمييز"
            >
              <Highlighter size={16} />
            </button>
            {showColors && (
              <div className="absolute start-0 top-full mt-1 flex gap-1 rounded-xl border border-black/10 bg-white p-1.5 shadow-lg max-md:gap-1.5 max-md:p-2 dark:border-white/15 dark:bg-dsurface2">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    className="h-6 w-6 rounded-full ring-offset-1 transition-transform hover:scale-110 max-md:h-8 max-md:w-8"
                    style={{ backgroundColor: c }}
                    onClick={() => {
                      create('highlight', c)
                      setShowColors(false)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            className={btn}
            title="تسطير"
            onClick={() => create('underline', '#3b82f6')}
          >
            <Underline size={16} />
          </button>
          <button
            className={btn}
            title="ملاحظة / كومنت"
            onClick={() => create('note', '#f59e0b')}
          >
            <StickyNote size={16} />
          </button>
        </>
      )}
      <span className="mx-0.5 h-5 w-px bg-black/10 dark:bg-white/15" />
      <button
        className={`text-accent ${btn}`}
        title={t('reader.readSelection')}
        onClick={speakSelection}
      >
        <Volume2 size={16} />
      </button>
      <button
        className={btn}
        title="نسخ"
        onClick={() => {
          void navigator.clipboard.writeText(sel.text).then(() => ui.toast('تم النسخ', 'success'))
          setSelection(null)
        }}
      >
        <Copy size={16} />
      </button>
      <button
        className={btn}
        title="بحث في الويب"
        onClick={() => {
          window.open(`https://www.google.com/search?q=${encodeURIComponent(sel.text.slice(0, 120))}`, '_blank')
          setSelection(null)
        }}
      >
        <Globe size={16} />
      </button>
    </div>
  )
}
