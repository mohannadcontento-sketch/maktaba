import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Pause, Square, Volume2, X } from 'lucide-react'
import { useReader } from '@/stores/reader'
import { tts } from '@/lib/tts'
import type { PdfHandle } from './PdfReader'
import type { EpubHandle } from './EpubReader'
import { cn } from '@/lib/utils'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Props {
  isPdf: boolean
  engine: { pdf?: PdfHandle; epub?: EpubHandle }
  autoStart: boolean
  /** نص محدد من المستخدم — عند توفره يُنطق هذا النص فقط بدل الكتاب كله (2.2) */
  selectionText?: string | null
  onSelectionDone?(): void
  onClose(): void
}

/**
 * شريط القراءة الصوتية (النسخة 2)
 * EPUB: يقرأ فقرةً فقرة مع متابعة العرض تلقائيًا والانتقال بين الأقسام
 * PDF: يقرأ نص الصفحة الحالية ثم ينتقل للصفحة التالية
 * 2.2: وضع قراءة النص المحدد — ينطق النص الذي اختاره المستخدم فقط ثم يتوقف
 */
export function TtsBar({ isPdf, engine, autoStart, selectionText, onSelectionDone, onClose }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [rate, setRate] = useState(1)
  const stopRef = useRef(false)
  const rateRef = useRef(1)
  const pendingResolveRef = useRef<(() => void) | null>(null)
  const startedRef = useRef(false)
  const selTextRef = useRef<string | null>(selectionText ?? null)

  useEffect(() => {
    selTextRef.current = selectionText ?? null
  }, [selectionText])

  useEffect(() => {
    void window.api.getSetting('tts.rate').then((v) => {
      const n = Number(v)
      if (n >= 0.5 && n <= 3) {
        setRate(n)
        rateRef.current = n
      }
    })
  }, [])

  useEffect(() => {
    return () => {
      // تنظيف عند إغلاق الكتاب أو الشريط
      stopRef.current = true
      tts.stop()
      pendingResolveRef.current?.()
      pendingResolveRef.current = null
      useReader.getState().setTtsPlaying(false)
    }
  }, [])

  const speakChunks = useCallback((chunks: Array<{ text: string; cfi?: string }>): Promise<void> => {
    return new Promise<void>((resolve) => {
      pendingResolveRef.current = resolve
      tts.speak(chunks, {
        rate: rateRef.current,
        voiceUri: null,
        onChunkStart: (i) => {
          if (!isPdf) {
            const cfi = chunks[i]?.cfi
            if (cfi) engine.epub?.goToCfi(cfi)
          }
        },
        onDone: () => {
          pendingResolveRef.current = null
          resolve()
        }
      })
    })
  }, [engine, isPdf])

  const runEpub = useCallback(async (): Promise<void> => {
    const h = engine.epub
    if (!h) return
    let guard = 0
    while (!stopRef.current && guard++ < 2000) {
      const chunks = await h.getTtsChunks()
      if (!chunks.length) break
      await speakChunks(chunks)
      if (stopRef.current) break
      h.next()
      await wait(700)
    }
  }, [engine, speakChunks])

  const runPdf = useCallback(async (): Promise<void> => {
    const h = engine.pdf
    if (!h) return
    let guard = 0
    while (!stopRef.current && guard++ < 10000) {
      const p = h.currentPage()
      const text = await h.pageText(p)
      if (text.trim()) await speakChunks([{ text }])
      if (stopRef.current) break
      if (p >= h.numPages()) break
      h.nextPage()
      await wait(600)
    }
  }, [engine, speakChunks])

  // قراءة النص المحدد فقط ثم التوقف (2.2)
  const runSelection = useCallback(async (): Promise<void> => {
    const text = selTextRef.current?.trim()
    if (!text) return
    await speakChunks([{ text }])
  }, [speakChunks])

  const runLoop = useCallback((): Promise<void> => {
    if (selTextRef.current?.trim()) return runSelection()
    return isPdf ? runPdf() : runEpub()
  }, [isPdf, runEpub, runPdf, runSelection])

  const start = useCallback((): void => {
    if (state === 'playing') return
    if (state === 'paused') {
      tts.resume()
      setState('playing')
      return
    }
    stopRef.current = false
    setState('playing')
    useReader.getState().setTtsPlaying(true)
    void runLoop().finally(() => {
      tts.stop()
      setState('idle')
      useReader.getState().setTtsPlaying(false)
      // انتهى نطق المحدد — نبليح الأب لإزالة الحالة
      if (selTextRef.current) {
        selTextRef.current = null
        onSelectionDone?.()
      }
    })
  }, [onSelectionDone, runLoop, state])

  const pause = useCallback((): void => {
    if (state !== 'playing') return
    tts.pause()
    setState('paused')
  }, [state])

  const stopAll = useCallback((): void => {
    stopRef.current = true
    tts.stop()
    pendingResolveRef.current?.()
    pendingResolveRef.current = null
    setState('idle')
    useReader.getState().setTtsPlaying(false)
  }, [])

  // بدء تلقائي عند الفتح عبر زر الشريط أو اختصار P
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // تحكم خارجي عبر اختصار P
  useEffect(() => {
    ;(window as unknown as { __ttsToggle?: () => void }).__ttsToggle = () => {
      if (state === 'playing') pause()
      else start()
    }
    ;(window as unknown as { __ttsStop?: () => void }).__ttsStop = stopAll
    return () => {
      delete (window as unknown as { __ttsToggle?: unknown }).__ttsToggle
      delete (window as unknown as { __ttsStop?: unknown }).__ttsStop
    }
  }, [pause, start, state, stopAll])

  const changeRate = (r: number): void => {
    setRate(r)
    rateRef.current = r
    void window.api.setSetting('tts.rate', String(r))
    // نعيد النطق الحالي بالسرعة الجديدة إن كان يعمل
    if (state !== 'idle') {
      stopRef.current = true
      tts.stop()
      pendingResolveRef.current?.()
      pendingResolveRef.current = null
      setState('idle')
      setTimeout(() => {
        stopRef.current = false
        setState('playing')
        void runLoop().finally(() => {
          tts.stop()
          setState('idle')
        })
      }, 120)
    }
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-2xl dark:border-dline dark:bg-dsurface2">
      <Volume2 size={16} className="text-accent" />
      <span className="text-xs font-semibold">{t('reader.tts')}</span>
      {selTextRef.current && (
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">{t('reader.ttsSelectionMode')}</span>
      )}

      <span className="mx-1 h-5 w-px bg-line dark:bg-dline" />

      <button
        onClick={() => (state === 'playing' ? pause() : start())}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          state === 'playing' ? 'bg-accent/15 text-accent' : 'hover:bg-black/[0.06] dark:hover:bg-white/10'
        )}
        title={state === 'playing' ? t('reader.ttsPause') : t('reader.ttsPlay')}
      >
        {state === 'playing' ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <button
        onClick={stopAll}
        disabled={state === 'idle'}
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-black/[0.06] disabled:opacity-40 dark:hover:bg-white/10"
        title={t('reader.ttsStop')}
      >
        <Square size={13} />
      </button>

      <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5 dark:border-dline">
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => changeRate(r)}
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums transition-colors',
              rate === r ? 'bg-accent text-white' : 'text-muted hover:bg-black/[0.05] dark:hover:bg-white/10'
            )}
          >
            {r}×
          </button>
        ))}
      </div>

      <span className="ms-1 hidden text-[11px] text-muted sm:inline">
        {state === 'playing' ? t('reader.ttsPlaying') : state === 'paused' ? t('reader.ttsPaused') : t('reader.ttsIdle')}
      </span>

      <button
        onClick={() => {
          stopAll()
          onClose()
        }}
        className="ms-1 rounded-md p-1 text-muted hover:bg-black/[0.06] dark:hover:bg-white/10"
        title={t('common.close')}
      >
        <X size={14} />
      </button>
    </div>
  )
}
