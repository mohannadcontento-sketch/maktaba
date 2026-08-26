import { useTranslation } from 'react-i18next'
import { Sun, Moon, Monitor, FolderOpen, Languages, BookOpen, Keyboard, Info } from 'lucide-react'
import { useUi, type ThemeMode } from '@/stores/ui'
import { READER_FONTS } from '@/stores/reader'
import { TitleBar } from '@/components/layout/Chrome'
import { Select } from '@/components/ui/kit'
import type { FlowMode } from '@/stores/ui'
import { cn } from '@/lib/utils'

export function SettingsPage() {
  const { t } = useTranslation()
  const ui = useUi()

  return (
    <>
      <TitleBar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <h1 className="mb-6 text-2xl font-bold">⚙️ {t('settings.title')}</h1>

          {/* المظهر */}
          <Section icon={<Sun size={16} />} title={t('settings.appearance')}>
            <Row label={t('settings.appTheme')}>
              <div className="flex gap-1.5">
                {(
                  [
                    { id: 'light', label: t('settings.themeLight'), icon: <Sun size={14} /> },
                    { id: 'dark', label: t('settings.themeDark'), icon: <Moon size={14} /> },
                    { id: 'system', label: t('settings.themeSystem'), icon: <Monitor size={14} /> }
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      ui.setThemeMode(m.id as ThemeMode)
                      void window.api.setSetting('app.themeMode', m.id)
                    }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                      ui.themeMode === m.id
                        ? 'border-accent bg-accent/10 text-accent-strong dark:text-daccent'
                        : 'border-line text-muted hover:border-muted dark:border-dline'
                    )}
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label={t('settings.language')}>
              <div className="flex gap-1.5">
                {(['ar', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      ui.setLang(l)
                      void import('@/i18n').then((m) => {
                        void m.initI18n(l)
                        m.applyDirection(l)
                        void window.api.setSetting('app.lang', l)
                      })
                    }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                      ui.lang === l
                        ? 'border-accent bg-accent/10 text-accent-strong dark:text-daccent'
                        : 'border-line text-muted hover:border-muted dark:border-dline'
                    )}
                  >
                    <Languages size={13} />
                    {l === 'ar' ? t('settings.langAr') : t('settings.langEn')}
                  </button>
                ))}
              </div>
            </Row>
          </Section>

          {/* افتراضيات القراءة */}
          <Section icon={<BookOpen size={16} />} title={t('settings.readingDefaults')}>
            <ReaderDefault
              k="reader.defaultTheme"
              label={t('settings.defaultTheme')}
              options={[
                { v: 'day', l: t('reader.themeDay') },
                { v: 'sepia', l: t('reader.themeSepia') },
                { v: 'night', l: t('reader.themeNight') }
              ]}
            />
            <ReaderDefault
              k="reader.defaultAlign"
              label={t('reader.align')}
              options={[
                { v: 'right', l: t('reader.marginRight') },
                { v: 'left', l: t('reader.marginLeft') },
                { v: 'center', l: 'وسط' },
                { v: 'justify', l: t('reader.alignJustify') }
              ]}
            />
            <ReaderDefault
              k="reader.defaultFont"
              label={t('settings.defaultFont')}
              options={READER_FONTS.map((f) => ({ v: f.id, l: f.label }))}
            />
            <ReaderDefault
              k="reader.defaultFlow"
              label={t('settings.defaultFlow')}
              options={[
                { v: 'paginated', l: t('reader.flowPaginated') },
                { v: 'scrolled', l: t('reader.flowScrolled') }
              ]}
            />
          </Section>

          {/* التخزين */}
          <Section icon={<FolderOpen size={16} />} title={t('settings.storage')}>
            <p className="mb-3 text-[13px] leading-relaxed text-muted">{t('settings.dataFolderHint')}</p>
            <button
              onClick={() => void window.api.openDataFolder()}
              className="flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm transition-colors hover:bg-black/[0.04] dark:border-dline dark:hover:bg-white/[0.05]"
            >
              <FolderOpen size={15} />
              {t('settings.openDataFolder')}
            </button>
          </Section>

          {/* الاختصارات */}
          <Section icon={<Keyboard size={16} />} title={t('settings.shortcutsTitle')}>
            <Shortcut k="Ctrl + O" desc={t('settings.shortcutOpenImport')} />
            <Shortcut k="Ctrl / F" desc={t('settings.shortcutFindDoc')} />
            <Shortcut k="B" desc={t('settings.shortcutBookmark')} />
            <Shortcut k="F11" desc={t('settings.shortcutZen')} />
            <Shortcut k="← → PgUp PgDn" desc="التنقل بين الصفحات" />
            <Shortcut k="+ / -" desc={`${t('reader.zoomIn')} / ${t('reader.zoomOut')}`} />
            <Shortcut k="Esc" desc="إغلاق اللوحات" />
          </Section>

          {/* حول */}
          <Section icon={<Info size={16} />} title={t('settings.about')}>
            <p className="text-[13px] leading-relaxed text-muted">{t('settings.aboutText')}</p>
            <p className="mt-2 text-xs text-muted/70">
              {t('settings.version')}: 1.0.0 · Electron + React · pdf.js + epub.js
            </p>
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-line bg-surface p-5 dark:border-dline dark:bg-dsurface">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-bold">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-[13px]">{label}</span>
      {children}
    </div>
  )
}

/** قيمة افتراضية للقارئ تُقرأ عند فتح الكتب */
function ReaderDefault({
  k,
  label,
  options
}: {
  k: string
  label: string
  options: Array<{ v: string; l: string }>
}) {
  const current =
    (k === 'reader.defaultTheme' ? 'day' : k === 'reader.defaultFont' ? 'arabic-serif' : 'paginated') as string
  return (
    <Row label={label}>
      <Select defaultValue={current} onChange={(e) => void window.api.setSetting(k, e.target.value)}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </Select>
    </Row>
  )
}

function Shortcut({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted">{desc}</span>
      <kbd className="rounded-md border border-line bg-surface2 px-2 py-0.5 font-mono text-[11px] shadow-sm dark:border-dline dark:bg-dsurface2">
        {k}
      </kbd>
    </div>
  )
}

void (null as unknown as FlowMode)
