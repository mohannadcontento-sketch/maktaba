import { useTranslation } from 'react-i18next'
import { Search, Volume2, DatabaseBackup, Target, Sparkles } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/kit'

/** نافذة "ما الجديد في النسخة 2" — تظهر عند أول تشغيل بعد التحديث */
export function WhatsNewDialog() {
  const { t } = useTranslation()
  const open = useUi((s) => s.whatsNewOpen)

  const close = (): void => {
    void window.api.setSetting('app.whatsNewV2', '1')
    useUi.getState().setWhatsNewOpen(false)
  }

  const items = [
    { icon: <Search size={16} />, text: t('whatsNew.search') },
    { icon: <Volume2 size={16} />, text: t('whatsNew.tts') },
    { icon: <DatabaseBackup size={16} />, text: t('whatsNew.backup') },
    { icon: <Target size={16} />, text: t('whatsNew.goal') }
  ]

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('whatsNew.title')}
      width="max-w-md"
      footer={
        <Button onClick={close}>
          <Sparkles size={15} />
          {t('whatsNew.cta')}
        </Button>
      }
    >
      <div className="space-y-2.5">
        <p className="text-[13px] leading-relaxed text-muted">{t('whatsNew.intro')}</p>
        {items.map((it, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 rounded-xl border border-line bg-surface2 p-3 dark:border-dline dark:bg-dsurface2"
          >
            <span className="mt-0.5 shrink-0 text-accent">{it.icon}</span>
            <p className="text-[13px] leading-relaxed">{it.text}</p>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
