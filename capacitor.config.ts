import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.maktaba.reader',
  appName: 'مكتبة',
  webDir: 'dist-mobile',
  android: {
    allowMixedContent: false,
    // السماح بفحص WebView من chrome://inspect — ضروري لتشخيص مشاكل الجهاز
    webContentsDebuggingEnabled: true
  }
}

export default config
