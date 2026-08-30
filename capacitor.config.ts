import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.maktaba.reader',
  appName: 'مكتبة',
  webDir: 'dist-mobile',
  android: {
    allowMixedContent: false
  }
}

export default config
