/**
 * جسر بلجن مكتبة الأصلي (أندرويد) — أزرار الصوت + إبقاء الشاشة مضاءة + ملء الشاشة.
 * على سطح المكتب يُعيد null وتصبح كل الاستدعاءات no-op آمنة.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface MkReaderPlugin {
  setVolumeKeys(opts: { enabled: boolean }): Promise<void>
  keepAwake(opts: { enabled: boolean }): Promise<void>
  setImmersive(opts: { on: boolean }): Promise<void>
}

export function stub(): MkReaderPlugin {
  return {
    setVolumeKeys: async () => {},
    keepAwake: async () => {},
    setImmersive: async () => {}
  }
}

/** يُعيد البلجن الحقيقي على الأندرويد فقط، وstump في غير ذلك */
export const MkReader: MkReaderPlugin | null = Capacitor.isNativePlatform()
  ? registerPlugin<MkReaderPlugin>('MkReader')
  : stub()

/** أزرار الصوت للتقليب — لا شيء على سطح المكتب */
export async function setVolumeKeys(enabled: boolean): Promise<void> {
  try {
    await MkReader?.setVolumeKeys({ enabled })
  } catch {
    /* ignore */
  }
}

/** ملء الشاشة (إخفاء أشرطة النظام) — لا شيء على سطح المكتب */
export async function setImmersive(on: boolean): Promise<void> {
  try {
    await MkReader?.setImmersive({ on })
  } catch {
    /* ignore */
  }
}

/** إبقاء الشاشة مضاءة مع fallback لعزل Wake Lock على المنصات الويب */
export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    await MkReader?.keepAwake({ enabled: on })
  } catch {
    /* ignore */
  }
  try {
    if (on && 'wakeLock' in navigator) {
      await (navigator as unknown as { wakeLock: { request(t: string): Promise<unknown> } }).wakeLock.request('screen')
    }
  } catch {
    /* ignore */
  }
}
