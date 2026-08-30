import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      // هدف متوافق مع Android System WebView الحديث/شبه القديم:
      // esbuild يحوّل الصياغة الحديثة (??=، ?.، حقول الأصناف…) لصياغة أوسع دعمًا
      target: ['chrome89', 'firefox90', 'safari14'],
      rollupOptions: {
        output: {
          manualChunks: {
            pdf: ['pdfjs-dist'],
            epub: ['epubjs']
          }
        }
      }
    }
  }
})
