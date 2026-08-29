export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function formatBytes(n: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatRelativeTime(ts: number | null, t: (k: string) => string): string {
  if (!ts) return t('library.neverOpened')
  const diff = Date.now() - ts
  const day = 86400000
  if (diff < day) {
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    if (h > 0) return `${t('library.todayAt')} · ${h} ${h === 1 ? 'hr' : 'hrs'}`
    if (m > 1) return `${t('library.todayAt')} · ${m} ${t('common.minutes')}`
    return t('library.todayAt')
  }
  if (diff < 2 * day) return t('library.yesterday')
  return new Date(ts).toLocaleDateString()
}

export function formatDuration(seconds: number, t: (k: string) => string): string {
  if (seconds < 60) return `${Math.round(seconds)} ${t('common.minutes')}`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h} ${t('common.hours')}${m ? ` ${m} ${t('common.minutes')}` : ''}`
  return `${m} ${t('common.minutes')}`
}

/** تطبيع النص العربي للبحث: إزالة التشكيل وتوحيد الألف والياء */
export function normalizeText(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670]/g, '') // تشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/**
 * تحويل مسار الغلاف المحلي إلى رابط بروتوكول cover:// الذي تسمح به CSP
 * (روابط file:// محظورة داخل الواجهة فلا تظهر الأغلفة أصلًا)
 */
export function coverUrl(coverPath: string | null | undefined, bust = false): string | null {
  if (!coverPath) return null
  const base = coverPath.split(/[\\/]/).pop()
  if (!base) return null
  return `cover://img/${encodeURIComponent(base)}${bust ? `?t=${Date.now()}` : ''}`
}

/** هل لغة الكتاب تُقرأ من اليمين لليسار (يحدد اتجاه التنقل بالأسهم والأزرار) */
export function isRtlLang(lang: string | null | undefined): boolean {
  const l = (lang || 'ar').toLowerCase().trim()
  return ['ar', 'he', 'fa', 'ur', 'ps', 'sd'].some((p) => l === p || l.startsWith(`${p}-`) || l.startsWith(`${p}_`))
}
