import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ar } from './ar'
import { en } from './en'

export type Lang = 'ar' | 'en'

export const resources = {
  ar: { translation: ar },
  en: { translation: en }
}

let initialized = false

// يجب أن تكتمل قبل أول رندر وإلا انهارت مكونات useTranslation
export function initI18n(lang: Lang): typeof i18n {
  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: lang,
      fallbackLng: 'ar',
      interpolation: { escapeValue: false }
    })
    initialized = true
  } else {
    void i18n.changeLanguage(lang)
  }
  return i18n
}

export function applyDirection(lang: Lang): void {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}
