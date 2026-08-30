import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './platform/polyfills'
import './styles/index.css'
import { applyDirection, initI18n } from './i18n'
import { ErrorBoundary } from './components/layout/ErrorBoundary'

// تهيئة متزامنة قبل رندر الشجرة — استدعاؤها بعد أول رندر يسبب انهيار هوكس
initI18n('ar')
applyDirection('ar')

interface BootGuard {
  stage(name: string): void
  done(): void
  fail(e: unknown): void
  isVisible(): boolean
}

function bootGuard(): BootGuard | null {
  return (window as unknown as { __mkBoot?: BootGuard }).__mkBoot ?? null
}

/** مهلة قصوى لانتظار جسر الجوال — لا هوًى بلا نهاية يعطي شاشة سوداء */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

async function boot(): Promise<void> {
  const guard = bootGuard()
  // على أجهزة الجوال (Capacitor/Android) نركّب جسر window.api البديل قبل رندر التطبيق
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) {
    guard?.stage('تهيئة التخزين المحلي…')
    try {
      const { installShim } = await import('./platform/shim')
      // مهلة 20 ثانية: فشل واضح على الشاشة بدل تجمّد صامت
      await withTimeout(installShim(), 20000, 'mobile bridge')
    } catch (e) {
      console.error('mobile shim failed', e)
      // عرض الخطأ بدل شاشة سوداء صامتة — ثم نكمل الرندر بجسر ناقص إن أمكن
      guard?.fail(e)
    }
  }
  guard?.stage('تشغيل الواجهة…')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
  // أخفِ شاشة البداية بعد أول طلعة حقيقية
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      guard?.done()
    })
    setTimeout(() => guard?.done(), 800)
  })
}

void boot().catch((e) => {
  console.error('boot failed', e)
  bootGuard()?.fail(e)
})
