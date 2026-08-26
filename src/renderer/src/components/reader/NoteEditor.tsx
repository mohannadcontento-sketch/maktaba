import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReader } from '@/stores/reader'
import { Button, Textarea } from '@/components/ui/kit'

/** محرر ملاحظة تعليق قائم */
export function NoteEditor() {
  const noteFor = useReader((s) => s.noteEditorFor)
  const setNoteEditor = useReader((s) => s.setNoteEditor)
  const updateAnnotation = useReader((s) => s.updateAnnotation)
  const [text, setText] = useState('')

  useEffect(() => {
    setText(noteFor?.note ?? '')
    if (noteFor && window.getSelection()) {
      window.getSelection()?.removeAllRanges()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteFor])

  if (!noteFor) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setNoteEditor(null)
      }}
    >
      <div className="anim-in w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-2xl dark:border-dline dark:bg-dsurface">
        <p className="mb-1 text-sm font-bold">📝 تحرير الملاحظة</p>
        {noteFor.text && (
          <p className="mb-3 line-clamp-3 rounded-xl bg-black/[0.04] p-2.5 text-xs leading-relaxed text-muted dark:bg-white/[0.05]">
            “{noteFor.text}”
          </p>
        )}
        <Textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب ملاحظتك…"
        />
        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="ghost"
            className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
            onClick={() => {
              void useReader.getState().deleteAnnotation(noteFor.id)
            }}
          >
            حذف التعليق
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setNoteEditor(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                void updateAnnotation(noteFor.id, { note: text.trim() })
                setNoteEditor(null)
              }}
            >
              حفظ
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
