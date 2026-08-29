/**
 * محرك القراءة الصوتية (النسخة 2)
 * يعتمد على Web Speech API المدمجة في كروميوم — بلا خدمات خارجية
 * يقسّم النص إلى مقاطع قصيرة لتجاوز حدّ كروميوم في النطق الطويل
 * ويتسلسل تلقائيًا عبر المقاطع مع دعم الإيقاف المؤقت والاستئناف
 */

export interface TtsSegment {
  text: string
  /** معرّف اختياري للفقرة/الصفحة (CFI أو رقم صفحة) — يُمرر عند بدء كل مقطع */
  chunkIndex: number
}

const MAX_PIECE = 160

/** تقسيم نص إلى قطع قصيرة عند حدود الجُمل */
function splitText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const parts = clean.split(/(?<=[.!?؟।:؛…])\s+|(?<=\S{80})\s+/)
  const out: string[] = []
  let buf = ''
  for (const p of parts) {
    if ((buf + ' ' + p).trim().length > MAX_PIECE && buf) {
      out.push(buf.trim())
      buf = p
    } else {
      buf = `${buf} ${p}`.trim()
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

export interface TtsOptions {
  rate: number
  voiceUri: string | null
  /** يُستدعى عند بدء نطق مقطع (فقرة/صفحة) */
  onChunkStart?(chunkIndex: number): void
  /** يُستدعى عند انتهاء كل المقاطع */
  onDone?(): void
  /** يُستدعى عند خطأ في النطق */
  onError?(e: SpeechSynthesisErrorEvent): void
}

export class TtsEngine {
  private queue: TtsSegment[] = []
  private opts: TtsOptions | null = null
  private pieceQueue: Array<{ text: string; chunkIndex: number }> = []
  private stopped = true
  private paused = false
  private current: SpeechSynthesisUtterance | null = null

  get isStopped(): boolean {
    return this.stopped
  }

  get isPaused(): boolean {
    return this.paused
  }

  speak(chunks: Array<{ text: string }>, opts: TtsOptions): void {
    this.stop(false)
    this.queue = chunks.map((c, i) => ({ text: c.text, chunkIndex: i }))
    this.opts = opts
    this.stopped = false
    this.paused = false
    this.drain()
  }

  pause(): void {
    if (this.stopped || this.paused) return
    this.paused = true
    try {
      window.speechSynthesis.pause()
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    try {
      window.speechSynthesis.resume()
    } catch {
      /* ignore */
    }
  }

  stop(fireCleanup = true): void {
    this.stopped = true
    this.paused = false
    this.pieceQueue = []
    this.queue = []
    this.current = null
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
    if (fireCleanup && this.opts) {
      // لا شيء إضافي حاليًا
    }
  }

  private drain(): void {
    if (this.stopped) return
    if (!this.pieceQueue.length) {
      const next = this.queue.shift()
      if (!next) {
        this.stopped = true
        this.opts?.onDone?.()
        return
      }
      this.opts?.onChunkStart?.(next.chunkIndex)
      const pieces = splitText(next.text)
      if (!pieces.length) {
        // فقرة فارغة → التالية فورًا
        setTimeout(() => this.drain(), 30)
        return
      }
      this.pieceQueue = pieces.map((text) => ({ text, chunkIndex: next.chunkIndex }))
    }
    const piece = this.pieceQueue.shift()
    if (!piece) {
      setTimeout(() => this.drain(), 30)
      return
    }
    try {
      const u = new SpeechSynthesisUtterance(piece.text)
      const { rate, voiceUri } = this.opts ?? { rate: 1, voiceUri: null }
      u.rate = Math.min(3, Math.max(0.5, rate))
      u.lang = voiceLang()
      const voice = pickVoice(voiceUri, u.lang)
      if (voice) u.voice = voice
      u.onend = () => {
        if (this.stopped) return
        setTimeout(() => this.drain(), 60)
      }
      u.onerror = (e) => {
        if (this.stopped) return
        // 'interrupted'/'canceled' طبيعية عند الإيقاف — لا نعتبرها خطأ
        if (e.error === 'interrupted' || e.error === 'canceled') return
        this.opts?.onError?.(e)
        setTimeout(() => this.drain(), 60)
      }
      this.current = u
      window.speechSynthesis.speak(u)
    } catch (e) {
      console.warn('tts speak failed', e)
      setTimeout(() => this.drain(), 60)
    }
  }
}

function voiceLang(): string {
  return document.documentElement.lang === 'en' ? 'en-US' : 'ar-SA'
}

/** اختيار صوت مناسب: المحفوظ أولًا ثم أول صوت بلغة الكتاب */
export function pickVoice(savedUri: string | null, lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  if (savedUri) {
    const hit = voices.find((v) => v.voiceURI === savedUri)
    if (hit) return hit
  }
  const prefix = lang.split('-')[0]
  return voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null
}

/** الصوت المتاح بلغة معينة (لعرضه في القوائم) */
export function voicesFor(langPrefix: string): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(langPrefix))
  } catch {
    return []
  }
}

export const tts = new TtsEngine()
