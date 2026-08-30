/**
 * محرك القراءة الصوتية (النسخة 2 / 2.2)
 * سطح المكتب: Web Speech API المدمجة في كروميوم — بلا خدمات خارجية
 * الجوال: @capacitor-community/text-to-speech (محرك TTS الأندرويد عبر native)
 * يقسّم النص إلى مقاطع قصيرة لتجاوز حدود النطق الطويل
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
  onError?(e: unknown): void
}

// ---------- خلفيات النطق ----------

interface SpeechBackend {
  /** ينطق نصًا واحدًا — يعالج عند الاكتمال */
  speak(text: string, rate: number, lang: string): Promise<void>
  stop(): void
  pause(): void
  resume(): void
}

/** كشف منصة الجوال دون استيراد ثابت لطبقة الكاباسيتور */
function isNativePlatform(): boolean {
  try {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  } catch {
    return false
  }
}

/** خلفية الويب — SpeechSynthesisUtterance ملفوفة بوعد */
function webBackend(): SpeechBackend {
  return {
    speak(text, rate, lang) {
      return new Promise<void>((resolve) => {
        try {
          const u = new SpeechSynthesisUtterance(text)
          u.rate = Math.min(3, Math.max(0.5, rate))
          u.lang = lang
          const voice = pickVoice(null, lang)
          if (voice) u.voice = voice
          u.onend = () => resolve()
          u.onerror = (e) => {
            if (e.error !== 'interrupted' && e.error !== 'canceled') {
              console.warn('tts web error', e.error)
            }
            resolve()
          }
          window.speechSynthesis.speak(u)
        } catch {
          resolve()
        }
      })
    },
    stop() {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* ignore */
      }
    },
    pause() {
      try {
        window.speechSynthesis.pause()
      } catch {
        /* ignore */
      }
    },
    resume() {
      try {
        window.speechSynthesis.resume()
      } catch {
        /* ignore */
      }
    }
  }
}

/** خلفية الجوال — المكوّن الأصلي (تحميل ديناميكي، يُستدعى على الأجهزة فقط) */
let nativeBackendPromise: Promise<SpeechBackend | null> | null = null
function nativeBackend(): Promise<SpeechBackend | null> {
  if (!nativeBackendPromise) {
    nativeBackendPromise = (async () => {
      try {
        const mod = (await import('@capacitor-community/text-to-speech')) as unknown as {
          TextToSpeech: {
            speak(o: { text: string; lang: string; rate: number; pitch: number; volume: number }): Promise<void>
            stop(): Promise<void>
            pause(): Promise<void>
            resume(): Promise<void>
          }
        }
        const ttsPlugin = mod.TextToSpeech
        return {
          async speak(text, rate, lang) {
            await ttsPlugin.speak({ text, lang, rate, pitch: 1.0, volume: 1.0 })
          },
          async stop() {
            await ttsPlugin.stop().catch(() => {})
          },
          async pause() {
            await ttsPlugin.pause().catch(() => {})
          },
          async resume() {
            await ttsPlugin.resume().catch(() => {})
          }
        }
      } catch (e) {
        console.warn('native tts unavailable', e)
        return null
      }
    })()
  }
  return nativeBackendPromise
}

let activeBackend: SpeechBackend | null = null
async function getBackend(): Promise<SpeechBackend> {
  if (!activeBackend) {
    activeBackend = isNativePlatform() ? (await nativeBackend()) ?? webBackend() : webBackend()
  }
  return activeBackend
}

// ---------- المحرك ----------

export class TtsEngine {
  private queue: TtsSegment[] = []
  private opts: TtsOptions | null = null
  private pieceQueue: Array<{ text: string; chunkIndex: number }> = []
  private stopped = true
  private paused = false

  get isStopped(): boolean {
    return this.stopped
  }

  get isPaused(): boolean {
    return this.paused
  }

  speak(chunks: Array<{ text: string }>, opts: TtsOptions): void {
    void this.stop(false)
    this.queue = chunks.map((c, i) => ({ text: c.text, chunkIndex: i }))
    this.opts = opts
    this.stopped = false
    this.paused = false
    void this.drain()
  }

  pause(): void {
    if (this.stopped || this.paused) return
    this.paused = true
    void getBackend().then((b) => b.pause())
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    void getBackend().then((b) => b.resume())
  }

  async stop(fireCleanup = true): Promise<void> {
    this.stopped = true
    this.paused = false
    this.pieceQueue = []
    this.queue = []
    void fireCleanup
    const b = await getBackend()
    b.stop()
  }

  private async drain(): Promise<void> {
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
        setTimeout(() => void this.drain(), 30)
        return
      }
      this.pieceQueue = pieces.map((text) => ({ text, chunkIndex: next.chunkIndex }))
    }
    const piece = this.pieceQueue.shift()
    if (!piece) {
      setTimeout(() => void this.drain(), 30)
      return
    }
    try {
      const backend = await getBackend()
      if (this.stopped) return
      await backend.speak(piece.text, this.opts?.rate ?? 1, voiceLang())
      if (this.stopped) return
      setTimeout(() => void this.drain(), 40)
    } catch (e) {
      console.warn('tts speak failed', e)
      this.opts?.onError?.(e)
      setTimeout(() => void this.drain(), 60)
    }
  }
}

function voiceLang(): string {
  return document.documentElement.lang === 'en' ? 'en-US' : 'ar-SA'
}

/** اختيار صوت مناسب: المحفوظ أولًا ثم أول صوت بلغة الكتاب (ويب فقط) */
export function pickVoice(savedUri: string | null, lang: string): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices()
    if (!voices.length) return null
    if (savedUri) {
      const hit = voices.find((v) => v.voiceURI === savedUri)
      if (hit) return hit
    }
    const prefix = lang.split('-')[0]
    return voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ?? null
  } catch {
    return null
  }
}

/** الصوت المتاح بلغة معينة (لعرضه في القوائم — ويب فقط) */
export function voicesFor(langPrefix: string): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(langPrefix))
  } catch {
    return []
  }
}

export const tts = new TtsEngine()
