import { useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { useTranslation } from 'react-i18next'
import type { Book } from '../../../../shared/types'
import { Dialog } from '@/components/ui/Dialog'
import { Button, Input, Select } from '@/components/ui/kit'

interface Props {
  open: boolean
  onClose(): void
  numPages: number
  currentPage: number
}

/** حوار طباعة PDF مع تحديد النطاق وتوليد صفحات صور للطباعة */
export function PrintDialog({ open, onClose }: Props) {
  const { t } = useTranslation()
  const [range, setRange] = useState<'all' | 'current' | 'custom'>('all')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)

  void t

  if (!open) return null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="طباعة المستند"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void doPrint().finally(() => {
                setBusy(false)
                onClose()
              })
            }}
          >
            {busy ? 'جارٍ التحضير…' : 'طباعة'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2.5">
          <input type="radio" checked={range === 'all'} onChange={() => setRange('all')} className="accent-teal-600" />
          كل الصفحات
        </label>
        <label className="flex items-center gap-2.5">
          <input
            type="radio"
            checked={range === 'current'}
            onChange={() => setRange('current')}
            className="accent-teal-600"
          />
          الصفحة الحالية
        </label>
        <label className="flex items-center gap-2.5">
          <input
            type="radio"
            checked={range === 'custom'}
            onChange={() => setRange('custom')}
            className="accent-teal-600"
          />
          نطاق مخصص:
        </label>
        {range === 'custom' && (
          <div className="flex items-center gap-2 ps-7">
            <Input type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} className="w-20" />
            <span>إلى</span>
            <Input type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} className="w-20" />
          </div>
        )}
        <p className="rounded-xl bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          ملاحظة: تُطبع الصفحات كصور عالية الدقة. للمستندات الضخمة قد يستغرق التحضير لحظات.
        </p>
      </div>
    </Dialog>
  )

  async function doPrint(): Promise<void> {
    setBusy(true)
    try {
      // استرجاع المستند عبر محرك العرض العام (يُسجل عند فتح PDF)
      const getDoc = (window as unknown as { __pdfGetDoc?: () => pdfjsLib.PDFDocumentProxy | null }).__pdfGetDoc
      const doc = getDoc?.()
      if (!doc) return
      const cur = (window as unknown as { __pdfCurrentPage?: () => number }).__pdfCurrentPage?.() ?? 1
      let f = 1
      let l = doc.numPages
      if (range === 'current') {
        f = cur
        l = cur
      } else if (range === 'custom') {
        f = Math.max(1, parseInt(from) || 1)
        l = Math.min(doc.numPages, parseInt(to) || f)
      }
      const imgs: string[] = []
      for (let n = f; n <= l; n++) {
        const page = await doc.getPage(n)
        const vp = page.getViewport({ scale: 2 })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width
        canvas.height = vp.height
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
        imgs.push(canvas.toDataURL('image/jpeg', 0.92))
        canvas.width = 0
      }
      const html = `<!doctype html><html dir="rtl"><head><style>
        @page { margin: 0; size: auto; }
        body { margin:0; padding:0; }
        img { display:block; width:100vw; page-break-after: always; }
      </style></head><body>${imgs.map((s) => `<img src="${s}">`).join('')}</body></html>`
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '-10000px'
      document.body.appendChild(iframe)
      iframe.contentDocument!.write(html)
      iframe.contentDocument!.close()
      iframe.onload = () => {
        setTimeout(() => {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
          setTimeout(() => iframe.remove(), 60000)
        }, 300)
      }
    } catch (e) {
      console.error('print failed', e)
    } finally {
      setBusy(false)
    }
  }
}
