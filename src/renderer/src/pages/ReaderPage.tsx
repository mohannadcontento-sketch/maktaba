import { useEffect } from 'react'
import { useReader } from '@/stores/reader'
import { useUi } from '@/stores/ui'
import { ReaderShell } from '@/components/reader/ReaderShell'

export function ReaderPage() {
  const book = useReader((s) => s.book)
  const loading = useReader((s) => s.loadingBook)
  const setPage = useUi((s) => s.setPage)

  // إن لم يكن هناك كتاب نشط، عود للمكتبة
  useEffect(() => {
    if (!book && !loading) setPage('library')
  }, [book, loading, setPage])

  if (!book) return null

  return <ReaderShell book={book} />
}
