import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { applyDirection, initI18n } from './i18n'

// تهيئة متزامنة قبل رندر الشجرة — استدعاؤها بعد أول رندر يسبب انهيار هوكس
initI18n('ar')
applyDirection('ar')

async function boot(): Promise<void> {
  // على أجهزة الجوال (Capacitor/Android) نركّب جسر window.api البديل قبل رندر التطبيق
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) {
    try {
      const { installShim } = await import('./platform/shim')
      await installShim()
    } catch (e) {
      console.error('mobile shim failed', e)
    }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
