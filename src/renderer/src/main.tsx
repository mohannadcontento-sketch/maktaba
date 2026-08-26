import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { applyDirection, initI18n } from './i18n'

// تهيئة متزامنة قبل رندر الشجرة — استدعاؤها بعد أول رندر يسبب انهيار هوكس
initI18n('ar')
applyDirection('ar')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
