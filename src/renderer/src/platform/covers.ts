/**
 * خطاف عرض الأغلفة الموحّد بين المنصتين:
 *  - سطح المكتب: بروتوكول cover:// (كما هو)
 *  - الجوال: قراءة الملف عبر Filesystem → data URL مع ذاكرة
 */
import { useEffect, useState } from 'react'
import { coverUrl } from '@/lib/utils'

let isNative: boolean | null = null
function native(): boolean {
  if (isNative == null) {
    isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  }
  return isNative
}

const cache = new Map<string, string>()
const pending = new Set<string>()

function basenameOf(p: string | null | undefined): string {
  return p ? p.split(/[\\/]/).pop() ?? '' : ''
}

/** تحميل رابط عرض الغلاف (يُستدعى داخليًا من الخطاف) */
async function loadNativeCover(coverPath: string): Promise<string | null> {
  const base = basenameOf(coverPath)
  if (!base) return null
  const hit = cache.get(base)
  if (hit) return hit
  if (pending.has(base)) return null
  pending.add(base)
  try {
    // استيراد ديناميكي — طبقة الجوال فقط
    const { coverDataUrl } = await import('./native')
    const url = await coverDataUrl(base)
    if (url) cache.set(base, url)
    return url
  } catch {
    return null
  } finally {
    pending.delete(base)
  }
}

/**
 * رابط عرض الغلاف المناسب للمنصة الحالية
 * على سطح المكتب يعيد cover:// فورًا؛ على الجوال يحمّل الملف ويعيد data URL
 */
export function useCoverSrc(coverPath: string | null | undefined, bust = false): string | null {
  const desktopSrc = coverUrl(coverPath, bust)
  const [nativeSrc, setNativeSrc] = useState<string | null>(() =>
    native() ? cache.get(basenameOf(coverPath)) ?? null : null
  )

  useEffect(() => {
    if (!native()) return
    let on = true
    setNativeSrc(cache.get(basenameOf(coverPath)) ?? null)
    if (coverPath) {
      void loadNativeCover(coverPath).then((u) => {
        if (on) setNativeSrc(u)
      })
    }
    return () => {
      on = false
    }
  }, [coverPath, bust])

  return native() ? nativeSrc : desktopSrc
}
