import { useEffect, useRef, useState } from 'react'
import {
  Sparkles,
  SlidersHorizontal,
  Hand,
  Check,
  Play,
  Pause,
  X,
  Sun,
  Moon,
  Bookmark,
  Battery,
  BatteryLow,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { READER_FONTS, READER_ALIGNS, type ReaderSettings } from '@/stores/reader'
import { useMobilePrefs } from '@/stores/mobilePrefs'
import { Button, Slider, Select } from '@/components/ui/kit'

/* ------------------------------------------------------------------ */
/* الثيمات الجاهزة على طريقة Moon+ Reader — تتسع لكل الأذواق           */
/* ------------------------------------------------------------------ */
export const MOON_THEMES: { id: ReaderSettings['theme']; label: string; bg: string; fg: string }[] = [
  { id: 'day', label: 'أبيض', bg: '#ffffff', fg: '#1a1a1a' },
  { id: 'sepia', label: 'ورقي', bg: '#f4ecd8', fg: '#5b4636' },
  { id: 'paper', label: 'رمادي', bg: '#e8e6e1', fg: '#3a3a3a' },
  { id: 'green', label: 'أخضر', bg: '#e3ece1', fg: '#2f4432' },
  { id: 'rose', label: 'وردي', bg: '#f5e4e0', fg: '#5c3a34' },
  { id: 'night', label: 'ليلي', bg: '#17191e', fg: '#cfd3da' },
  { id: 'amber', label: 'كهرمان', bg: '#0d0c0a', fg: '#d9a441' },
  { id: 'slate', label: 'أزرق داكن', bg: '#101720', fg: '#a8c0d8' }
]

/* ------------------------------------------------------------------ */
/* لوحة إعدادات الجوال — شيت سفلي بتبويبات (عرض/ثيمات/تحكم)           */
/* ------------------------------------------------------------------ */
type MoonTab = 'look' | 'themes' | 'control'

export function MoonSheet({
  settings,
  onChange,
  perBook,
  onApplyToAll,
  onResetBook,
  onClose,
  autoScrollOn,
  onToggleAutoScroll,
  isPdf
}: {
  settings: ReaderSettings
  onChange(p: Partial<ReaderSettings>): void
  perBook: boolean
  onApplyToAll(): void
  onResetBook(): void
  onClose(): void
  autoScrollOn: boolean
  onToggleAutoScroll(): void
  isPdf: boolean
}): React.ReactNode {
  const { t } = useTranslation()
  const [tab, setTab] = useState<MoonTab>(isPdf ? 'control' : 'look')
  const mp = useMobilePrefs((s) => s.prefs)
  const mpSet = useMobilePrefs((s) => s.set)

  const allTabs: { id: MoonTab; label: string; icon: React.ReactNode }[] = [
    { id: 'look', label: 'العرض', icon: <SlidersHorizontal size={15} /> },
    { id: 'themes', label: 'الثيمات', icon: <Sparkles size={15} /> },
    { id: 'control', label: 'التحكم', icon: <Hand size={15} /> }
  ]
  // PDF: التحكم فقط (الخطوط والثيمات تخص EPUB)
  const tabs = isPdf ? allTabs.filter((x) => x.id === 'control') : allTabs

  return (
    <div
      className="anim-in fixed inset-x-0 bottom-0 z-40 flex max-h-[82vh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl dark:border-dline dark:bg-dsurface2"
      data-testid="moon-sheet"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-line dark:bg-dline" />
      {/* التبويبات */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 pt-2 dark:border-dline">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            data-testid={`moon-tab-${tb.id}`}
            onClick={() => setTab(tb.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-t-lg pb-2.5 pt-1.5 text-[13px] font-semibold transition-colors',
              tab === tb.id
                ? 'border-b-2 border-accent text-accent-strong dark:border-daccent dark:text-daccent'
                : 'border-b-2 border-transparent text-muted'
            )}
          >
            {tb.icon}
            {tb.label}
          </button>
        ))}
        <button onClick={onClose} className="p-2 text-muted" aria-label="إغلاق">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'look' && (
          <>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.fontFamily')}</p>
            <Select className="mb-4 w-full" value={settings.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
              {READER_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>

            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.align')}</p>
            <div className="mb-4 grid grid-cols-4 gap-1.5">
              {READER_ALIGNS.map((al) => (
                <button
                  key={al.id}
                  onClick={() => onChange({ align: al.id as ReaderSettings['align'] })}
                  className={cn(
                    'flex h-10 items-center justify-center rounded-lg border text-xs font-medium',
                    settings.align === al.id
                      ? 'border-accent bg-accent/10 text-accent-strong dark:bg-daccent/15 dark:text-daccent'
                      : 'border-line text-muted dark:border-dline'
                  )}
                >
                  {al.label}
                </button>
              ))}
            </div>

            <LabelledSlider label={`${t('reader.fontSize')} — ${settings.fontSize}%`}>
              <Slider min={70} max={220} step={5} value={settings.fontSize} onChange={(v) => onChange({ fontSize: v })} />
            </LabelledSlider>
            <LabelledSlider label={`${t('reader.lineHeight')} — ${settings.lineHeight}`}>
              <Slider min={120} max={260} step={5} value={settings.lineHeight * 100} onChange={(v) => onChange({ lineHeight: v / 100 })} />
            </LabelledSlider>

            <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('reader.margins')}</p>
            <div className="grid grid-cols-2 gap-x-3">
              <LabelledSlider label={`${t('reader.marginLeft')} ${settings.marginLeft}%`}>
                <Slider min={0} max={25} step={1} value={settings.marginLeft} onChange={(v) => onChange({ marginLeft: v })} />
              </LabelledSlider>
              <LabelledSlider label={`${t('reader.marginRight')} ${settings.marginRight}%`}>
                <Slider min={0} max={25} step={1} value={settings.marginRight} onChange={(v) => onChange({ marginRight: v })} />
              </LabelledSlider>
              <LabelledSlider label={`${t('reader.marginTop')} ${settings.marginTop}%`}>
                <Slider min={0} max={25} step={1} value={settings.marginTop} onChange={(v) => onChange({ marginTop: v })} />
              </LabelledSlider>
              <LabelledSlider label={`${t('reader.marginBottom')} ${settings.marginBottom}%`}>
                <Slider min={0} max={25} step={1} value={settings.marginBottom} onChange={(v) => onChange({ marginBottom: v })} />
              </LabelledSlider>
            </div>

            {!isPdf && (
              <>
                <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">وضع العرض</p>
                <div className="mb-1 grid grid-cols-2 gap-1.5">
                  {(['paginated', 'scrolled'] as const).map((fl) => (
                    <Button key={fl} size="sm" variant={settings.flow === fl ? 'primary' : 'outline'} onClick={() => onChange({ flow: fl })}>
                      {fl === 'paginated' ? t('reader.flowPaginated') : t('reader.flowScrolled')}
                    </Button>
                  ))}
                </div>
              </>
            )}
            <ScopeBox perBook={perBook} onApplyToAll={onApplyToAll} onResetBook={onResetBook} />
          </>
        )}

        {tab === 'themes' && (
          <>
            <div className="mb-4 grid grid-cols-4 gap-2" data-testid="moon-themes">
              {MOON_THEMES.map((th) => (
                <button
                  key={th.id}
                  data-testid={`moon-theme-${th.id}`}
                  onClick={() => onChange({ theme: th.id })}
                  className={cn(
                    'relative flex h-16 flex-col items-center justify-center rounded-xl border text-[11px] font-semibold transition-all',
                    settings.theme === th.id ? 'border-accent ring-2 ring-accent/30' : 'border-line dark:border-dline'
                  )}
                  style={{ background: th.bg, color: th.fg }}
                >
                  {settings.theme === th.id && (
                    <span className="absolute end-1 top-1 rounded-full bg-accent p-0.5 text-white">
                      <Check size={10} />
                    </span>
                  )}
                  {th.label}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5">
              <ScopeBoxInner perBook={perBook} onApplyToAll={onApplyToAll} onResetBook={onResetBook} />
            </div>
          </>
        )}

        {tab === 'control' && (
          <>
            <LabelledSlider label={`السطوع — ${mp.brightness}%`}>
              <Slider
                min={20}
                max={100}
                step={1}
                value={mp.brightness}
                onChange={(v) => mpSet({ brightness: v })}
                data-testid="moon-brightness"
              />
            </LabelledSlider>
            <p className="mb-3 text-[11px] leading-relaxed text-muted">
              اسحب من الحافة اليسرى للشاشة (عموديًا) لتغيير السطوع بسرعة أثناء القراءة.
            </p>

            <ToggleRow
              testid="moon-statusbar"
              label="شريط المعلومات (الفصل، النسبة، الوقت، البطارية)"
              on={mp.statusBar}
              onToggle={() => mpSet({ statusBar: !mp.statusBar })}
            />
            <ToggleRow
              testid="moon-bottombar"
              label="شريط التنقل السفلي"
              on={mp.bottomBar}
              onToggle={() => mpSet({ bottomBar: !mp.bottomBar })}
            />
            <ToggleRow
              testid="moon-volumekeys"
              label="أزرار الصوت لتقليب الصفحات (+ للسابق، − للتالي)"
              on={mp.volumeKeys}
              onToggle={() => mpSet({ volumeKeys: !mp.volumeKeys })}
            />
            <ToggleRow
              testid="moon-keepawake"
              label="إبقاء الشاشة مضاءة أثناء القراءة"
              on={mp.keepAwake}
              onToggle={() => mpSet({ keepAwake: !mp.keepAwake })}
            />

            {/* الجوال v2.7: ملاءمة صفحة PDF — حتى حواف الشاشة افتراضيًا */}
            {isPdf && (
              <>
                <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">ملاءمة صفحة PDF</p>
                <div className="mb-3 grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'width', label: 'حتى حواف الشاشة' },
                      { id: 'page', label: 'صفحة كاملة' }
                    ] as const
                  ).map((o) => (
                    <Button
                      key={o.id}
                      size="sm"
                      variant={mp.pdfFit === o.id ? 'primary' : 'outline'}
                      onClick={() => mpSet({ pdfFit: o.id })}
                      data-testid={`moon-pdffit-${o.id}`}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </>
            )}

            <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">حركة قلب الصفحة</p>
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {(['slide', 'none'] as const).map((a) => (
                <Button key={a} size="sm" variant={mp.flipAnim === a ? 'primary' : 'outline'} onClick={() => mpSet({ flipAnim: a })}>
                  {a === 'slide' ? 'انزلاق' : 'بلا حركة'}
                </Button>
              ))}
            </div>

            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">فعل النقر على المنتصف</p>
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'zen', label: 'وضع صافٍ' },
                  { id: 'settings', label: 'لوحة الإعدادات' }
                ] as const
              ).map((o) => (
                <Button key={o.id} size="sm" variant={mp.centerAction === o.id ? 'primary' : 'outline'} onClick={() => mpSet({ centerAction: o.id })}>
                  {o.label}
                </Button>
              ))}
            </div>

            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">التمرير التلقائي</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant={autoScrollOn ? 'primary' : 'outline'} onClick={onToggleAutoScroll} data-testid="moon-autoscroll-toggle">
                {autoScrollOn ? <Pause size={14} /> : <Play size={14} />}
                {autoScrollOn ? 'إيقاف' : 'تشغيل'}
              </Button>
              <div className="flex-1">
                <Slider min={1} max={10} step={1} value={mp.autoScrollSpeed} onChange={(v) => mpSet({ autoScrollSpeed: v })} />
              </div>
              <span className="w-6 text-center text-xs tabular-nums text-muted">{mp.autoScrollSpeed}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LabelledSlider({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      {children}
    </label>
  )
}

/** صندوق نطاق الإعدادات (لكل كتاب / عام) — يظهر في تبويب العرض والثيمات */
function ScopeBox({
  perBook,
  onApplyToAll,
  onResetBook
}: {
  perBook: boolean
  onApplyToAll(): void
  onResetBook(): void
}): React.ReactNode {
  return (
    <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5" data-testid="moon-scopebox">
      <ScopeBoxInner perBook={perBook} onApplyToAll={onApplyToAll} onResetBook={onResetBook} />
    </div>
  )
}

function ScopeBoxInner({
  perBook,
  onApplyToAll,
  onResetBook
}: {
  perBook: boolean
  onApplyToAll(): void
  onResetBook(): void
}): React.ReactNode {
  return (
    <>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
        <Bookmark size={13} />
        {perBook ? 'هذه الإعدادات خاصة بهذا الكتاب' : 'التعديلات تُحفظ لهذا الكتاب فقط'}
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={onApplyToAll}
          className="flex-1 rounded-lg bg-accent/10 px-2 py-2 text-xs font-medium text-accent-strong dark:bg-daccent/15 dark:text-daccent"
        >
          طبّق على كل الكتب
        </button>
        <button onClick={onResetBook} className="flex-1 rounded-lg px-2 py-2 text-xs font-medium text-muted">
          استعادة الافتراضي
        </button>
      </div>
    </>
  )
}

function ToggleRow({
  label,
  on,
  onToggle,
  testid
}: {
  label: string
  on: boolean
  onToggle(): void
  testid: string
}): React.ReactNode {
  return (
    <button
      data-testid={testid}
      onClick={onToggle}
      className="mb-2 flex w-full items-center justify-between rounded-xl border border-line px-3 py-2.5 text-start dark:border-dline"
    >
      <span className="text-[13px]">{label}</span>
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          on ? 'bg-accent dark:bg-daccent' : 'bg-line dark:bg-dline'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            on ? 'start-[18px]' : 'start-0.5'
          )}
        />
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* شريط المعلومات السفلي — الفصل + النسبة + الساعة + البطارية          */
/* ------------------------------------------------------------------ */
export function MoonStatusBar({
  chapter,
  percent,
  pageOf
}: {
  chapter: string | null
  percent: number
  pageOf: string | null
}): React.ReactNode {
  const [now, setNow] = useState(() => new Date())
  const [battery, setBattery] = useState<number | null>(null)

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 20000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    let bal: { level: number; addEventListener(t: string, cb: () => void): void } | null = null
    const nav = navigator as unknown as {
      getBattery?: () => Promise<{ level: number; addEventListener(t: string, cb: () => void): void }>
    }
    void nav.getBattery?.().then((b) => {
      bal = b
      setBattery(Math.round(b.level * 100))
      b.addEventListener('levelchange', () => setBattery(Math.round(b.level * 100)))
    }).catch(() => {})
    return () => {
      bal = null
    }
  }, [])

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const time = `${hh}:${mm}`

  return (
    <div
      data-testid="moon-statusbar"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-7 items-center justify-between gap-2 bg-surface/80 px-3 text-[10px] tabular-nums text-muted backdrop-blur-sm dark:bg-dsurface/80 dark:text-dmuted"
    >
      <span className="min-w-0 truncate">{chapter ?? pageOf ?? ''}</span>
      <span className="flex shrink-0 items-center gap-2">
        {battery != null && (
          <span className="flex items-center gap-0.5" data-testid="moon-battery">
            {battery > 20 ? <Battery size={11} /> : <BatteryLow size={11} />}
            {battery}%
          </span>
        )}
        <span data-testid="moon-time">{time}</span>
        <span className="font-semibold">{Math.round(percent)}%</span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* شريط السطوع على الحافة — سحب رأسي يغيّر السطوع فورًا                */
/* ------------------------------------------------------------------ */
export function MoonBrightnessEdge(): React.ReactNode {
  const mp = useMobilePrefs((s) => s.prefs)
  const mpSet = useMobilePrefs((s) => s.set)
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const apply = (clientY: number): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const frac = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    mpSet({ brightness: Math.round(20 + frac * 80) })
  }

  return (
    <>
      <div
        ref={ref}
        data-testid="moon-brightness-edge"
        className="absolute left-0 top-0 z-30 h-full w-5 touch-none"
        onTouchStart={(e) => {
          setDragging(true)
          apply(e.touches[0].clientY)
        }}
        onTouchMove={(e) => apply(e.touches[0].clientY)}
        onTouchEnd={() => setDragging(false)}
      />
      {dragging && (
        <div className="pointer-events-none absolute left-6 top-1/2 z-40 flex -translate-y-1/2 items-center gap-1 rounded-full bg-black/75 px-3 py-2 text-xs text-white shadow-lg">
          <Sun size={13} />
          {mp.brightness}%
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* فلاش بصري عند لمس مناطق التنقل — سهم خفيف يظهر لحظة اللمس (v2.7)    */
/* ------------------------------------------------------------------ */
export function MoonTapFlash(): React.ReactNode {
  const [flash, setFlash] = useState<{ side: 'left' | 'right'; acted: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent).detail as { acted: string; rx?: number }
      if (!d || (d.acted !== 'prev' && d.acted !== 'next')) return
      const side = (d.rx ?? 0.5) < 0.5 ? 'left' : 'right'
      setFlash({ side, acted: d.acted })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFlash(null), 420)
    }
    window.addEventListener('mk-tapzone', on)
    return () => {
      window.removeEventListener('mk-tapzone', on)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!flash) return null
  return (
    <div
      data-testid="moon-tapflash"
      className={cn(
        'pointer-events-none absolute top-1/2 z-40 -translate-y-1/2 rounded-full bg-black/20 p-3 text-white/90',
        flash.side === 'left' ? 'left-5' : 'right-5'
      )}
    >
      {flash.side === 'left' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </div>
  )
}
