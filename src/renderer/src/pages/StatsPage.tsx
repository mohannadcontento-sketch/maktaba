import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  Flame,
  BookCheck,
  FileStack,
  Highlighter,
  Bookmark,
  Library
} from 'lucide-react'
import type { StatsSummary } from '../../../shared/types'
import { TitleBar } from '@/components/layout/Chrome'
import { Spinner } from '@/components/ui/kit'
import { cn, formatDuration } from '@/lib/utils'

export function StatsPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<StatsSummary | null>(null)

  useEffect(() => {
    void window.api.stats().then(setStats)
  }, [])

  return (
    <>
      <TitleBar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="mb-6 text-2xl font-bold">📈 {t('stats.title')}</h1>

          {!stats ? (
            <div className="flex justify-center py-24 text-muted">
              <Spinner size={30} />
            </div>
          ) : (
            <>
              {/* البطاقات */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  icon={<Clock3 size={20} />}
                  value={formatDuration(stats.totalSeconds, t)}
                  label={t('stats.totalTime')}
                  tone="teal"
                />
                <StatCard
                  icon={<Flame size={20} />}
                  value={`${stats.streakDays}`}
                  label={t('stats.streakDays')}
                  tone="amber"
                />
                <StatCard
                  icon={<BookCheck size={20} />}
                  value={`${stats.finishedBooks}`}
                  label={t('stats.finishedBooks')}
                  tone="emerald"
                />
                <StatCard
                  icon={<FileStack size={20} />}
                  value={`${stats.totalPagesRead}`}
                  label={t('stats.totalPagesRead')}
                  tone="sky"
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard icon={<Library size={18} />} value={`${stats.totalBooks}`} label={t('stats.inLibrary')} tone="slate" small />
                <StatCard icon={<Highlighter size={18} />} value={`${stats.annotationCount}`} label={t('stats.annotationsMade')} tone="violet" small />
                <StatCard icon={<Bookmark size={18} />} value={`${stats.bookmarkCount}`} label={t('stats.bookmarksMade')} tone="rose" small />
                <div />
              </div>

              {/* نشاط ١٤ يومًا */}
              <section className="mt-8 rounded-2xl border border-line bg-surface p-5 dark:border-dline dark:bg-dsurface">
                <h2 className="mb-4 text-sm font-bold text-muted">{t('stats.last14')}</h2>
                {Math.max(...stats.last14.map((d) => d.minutes), 0) === 0 && stats.totalSeconds === 0 ? (
                  <p className="py-8 text-center text-sm text-muted">{t('stats.noActivity')}</p>
                ) : (
                  <div className="flex h-36 items-end gap-1.5" dir="ltr">
                    {stats.last14.map((d) => {
                      const max = Math.max(...stats.last14.map((x) => x.minutes), 30)
                      const h = Math.max(4, (d.minutes / max) * 100)
                      const day = new Date(d.date + 'T00:00:00')
                      return (
                        <div key={d.date} className="group flex flex-1 flex-col items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-accent opacity-0 transition-opacity group-hover:opacity-100">
                            {d.minutes}
                          </span>
                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-teal-600 to-emerald-400 transition-all group-hover:brightness-110"
                            style={{ height: `${h}%`, minHeight: 4 }}
                            title={`${d.date}: ${d.minutes} د`}
                          />
                          <span className="text-[9.5px] text-muted">{day.getDate()}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* أكثر الكتب قراءة */}
              {stats.topBooks.length > 0 && (
                <section className="mt-4 rounded-2xl border border-line bg-surface p-5 dark:border-dline dark:bg-dsurface">
                  <h2 className="mb-4 text-sm font-bold text-muted">🏆 {t('stats.topBooks')}</h2>
                  <div className="space-y-2.5">
                    {stats.topBooks.map((b, i) => {
                      const max = Math.max(...stats.topBooks.map((x) => x.seconds))
                      return (
                        <div key={b.id} className="flex items-center gap-3">
                          <span className="w-5 text-center text-xs font-bold text-muted">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium">{b.title}</p>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400"
                                style={{ width: `${(b.seconds / max) * 100}%` }}
                              />
                            </div>
                          </div>
                          <span className="shrink-0 text-xs tabular-nums text-muted">
                            {formatDuration(b.seconds, t)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

const TONES: Record<string, string> = {
  teal: 'bg-teal-500/12 text-teal-600 dark:text-daccent',
  amber: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  sky: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  slate: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  rose: 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
}

function StatCard({
  icon,
  value,
  label,
  tone,
  small
}: {
  icon: React.ReactNode
  value: string
  label: string
  tone: keyof typeof TONES | string
  small?: boolean
}) {
  void small
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 dark:border-dline dark:bg-dsurface">
      <span className={cn('mb-2 inline-flex rounded-xl p-2', TONES[tone] ?? TONES.teal)}>{icon}</span>
      <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted">{label}</p>
    </div>
  )
}
