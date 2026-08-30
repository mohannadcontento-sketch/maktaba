import { create } from 'zustand'

/**
 * تفضيلات قارئ الجوال على طريقة Moon+ Reader — عامة لكل الكتب (ليست لكل كتاب،
 * لأنها خصائص جهاز: سطوع/أزرار صوت/إبقاء الشاشة)، بينما إعدادات العرض تبقى مستقلة لكل كتاب.
 */
export interface MobilePrefs {
  /** سطوع الشاشة 20–100 (تراكب أسود فوق الصفحة) */
  brightness: number
  /** شريط معلومات سفلي رفيع: الفصل + النسبة + الساعة + البطارية */
  statusBar: boolean
  /** شريط التنقل السفلي (سابق/تالي/شريط موضع) */
  bottomBar: boolean
  /** أزرار الصوت تقلب الصفحات */
  volumeKeys: boolean
  /** إبقاء الشاشة مضاءة أثناء القراءة */
  keepAwake: boolean
  /** حركة قلب الصفحة */
  flipAnim: 'none' | 'slide'
  /** سرعة التمرير التلقائي 1–10 */
  autoScrollSpeed: number
  /** فعل النقر على منتصف الصفحة */
  centerAction: 'zen' | 'settings'
}

export const DEFAULT_MOBILE_PREFS: MobilePrefs = {
  brightness: 100,
  statusBar: true,
  bottomBar: true,
  volumeKeys: true,
  keepAwake: true,
  flipAnim: 'slide',
  autoScrollSpeed: 3,
  centerAction: 'zen'
}

interface MobilePrefsState {
  prefs: MobilePrefs
  loaded: boolean
  load(): Promise<void>
  set(patch: Partial<MobilePrefs>): void
}

const KEY = 'reader.mobile'

export const useMobilePrefs = create<MobilePrefsState>((set, get) => ({
  prefs: DEFAULT_MOBILE_PREFS,
  loaded: false,
  load: async () => {
    try {
      const raw = await window.api.getSetting(KEY)
      if (raw) set({ prefs: { ...DEFAULT_MOBILE_PREFS, ...(JSON.parse(raw) as Partial<MobilePrefs>) } })
    } catch {
      /* ignore */
    }
    set({ loaded: true })
  },
  set: (patch) => {
    const next = { ...get().prefs, ...patch }
    set({ prefs: next })
    void window.api.setSetting(KEY, JSON.stringify(next))
  }
}))
