import { app, BrowserWindow, Menu, net, protocol, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { initDb } from './db'
import { registerIpc } from './ipc'
import { bookFilePath, coversDir } from './library'

// يجب التسجيل قبل جاهزية التطبيق
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'book',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  },
  {
    // بروتوكول الأغلفة — بديل file:// الذي تحظره CSP وقواعد الأصل المختلط
    scheme: 'cover',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // epub.js يعتمد على requestAnimationFrame في طابوره الداخلي —
      // بدونه يتعطل عرض الكتاب حين تكون النافذة مخفية أو مصغّرة
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // منع فتح نوافذ/روابط خارجية داخل التطبيق
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // أدوات المطور في وضع التطوير (F12)
  if (isDev) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow?.webContents.toggleDevTools()
      }
    })
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerBookProtocol(): void {
  protocol.handle('book', async (request) => {
    try {
      const url = new URL(request.url)
      const host = url.host // معرّف الكتاب
      const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''))
      // تحقق أن الملف يخص الكتاب فعلاً عبر مطابقة الاسم المخزّن
      const full = bookFilePath(fileName)
      if (!fs.existsSync(full)) {
        return new Response('not found', { status: 404 })
      }
      const ext = path.extname(full).toLowerCase()
      const mime = MIME[ext] ?? 'application/octet-stream'
      const res = await netFetchFile(full)
      return new Response(res.body, {
        status: 200,
        headers: { 'content-type': mime, 'access-control-allow-origin': '*' }
      })
    } catch (err) {
      console.error('book protocol error:', request.url, err)
      return new Response('error', { status: 500 })
    }
  })
}

async function netFetchFile(p: string): Promise<Response> {
  const res = await net.fetch(pathToFileURL(p).toString())
  return res
}

/**
 * بروتوكول cover://img/<اسم الملف> — يخدم صور الأغلفة من مجلد الأغلفة داخل userData
 * الاسم محصور بغير مسارات لمنع أي تجاوز
 */
function registerCoverProtocol(): void {
  protocol.handle('cover', async (request) => {
    try {
      const url = new URL(request.url)
      // الصيغة: cover://img/<basename> — المضيف ثابت img والاسم في المسار
      const rawName = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const host = url.host
      if (host !== 'img' || !rawName) {
        return new Response('not found', { status: 404 })
      }
      const name = path.basename(rawName)
      if (!/^[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(name)) {
        return new Response('bad request', { status: 400 })
      }
      const full = path.join(coversDir(), name)
      if (!fs.existsSync(full)) {
        return new Response('not found', { status: 404 })
      }
      const ext = path.extname(full).toLowerCase()
      const mime = MIME[ext] ?? 'application/octet-stream'
      // نعيد بايتات مخزّنة وليست stream — تحميل <img> من استجابة متدفقة يفشل في فك التشفير أحيانًا
      const bytes = new Uint8Array(fs.readFileSync(full))
      return new Response(bytes, {
        status: 200,
        headers: { 'content-type': mime, 'access-control-allow-origin': '*' }
      })
    } catch (err) {
      console.error('cover protocol error:', request.url, err)
      return new Response('error', { status: 500 })
    }
  })
}

// منع تعدد النوافذ + استقبال ملفات "فتح باستخدام"
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.slice(1).filter((a) => /\.(pdf|epub)$/i.test(a))
    if (files.length) {
      mainWindow?.webContents.send('open-files', files)
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    initDb()
    registerIpc()
    registerBookProtocol()
    registerCoverProtocol()

    // منع التنقل بالسحب والإفلات على مستوى الويب
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: details.responseHeaders })
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  // فتح ملفات ممررة عند الإقلاع (فتح باستخدام)
  app.on('open-file', (e, p) => {
    e.preventDefault()
    mainWindow?.webContents.send('open-files', [p])
  })
}
