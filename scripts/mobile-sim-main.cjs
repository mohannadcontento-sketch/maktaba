// محاكي إقلاع نسخة الجوال — يحمّل dist-mobile في نافذة إلكترون مع:
//  1) window.androidBridge = {}  ← يخلّي @capacitor/core يعتبر البيئة «أندرويد أصلي»
//  2) حذف الواجهات الحديثة (Object.hasOwn, structuredClone, crypto.randomUUID,
//     Array.at/findLast/toSorted/toReversed) ← محاكاة Android System WebView قديم
// يجب أن يُقلع التطبيق ويُرندر المكتبة (فارغة) بلا شاشة سوداء وبلا بطاقة خطأ قاتلة.
const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const DIST = path.join(__dirname, '..', 'dist-mobile')
const PORT = 41873

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json'
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '')
  let file = path.join(DIST, rel)
  if (!fs.existsSync(file)) {
    // assets under /assets already relative — fallback to index for unknown
    file = path.join(DIST, rel)
    if (!fs.existsSync(file)) {
      res.writeHead(404)
      res.end('nf')
      return
    }
  }
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

// حذف الواجهات الحديثة قبل تحميل الصفحة — محاكاة WebView قديم
function stripModernApis() {
  try { delete Object.hasOwn } catch {}
  try { delete window.structuredClone } catch {}
  try { if (window.crypto) { try { delete window.crypto.randomUUID } catch {} ; window.crypto.randomUUID = undefined } } catch {}
  try { delete Array.prototype.at } catch {}
  try { delete Array.prototype.findLast } catch {}
  try { delete Array.prototype.findLastIndex } catch {}
  try { delete Array.prototype.toSorted } catch {}
  try { delete Array.prototype.toReversed } catch {}
  try { delete String.prototype.replaceAll } catch {}
  try { delete Promise.allSettled } catch {}
  try { delete Promise.any } catch {}
  // البيئة الوهمية للأندرويد — قبل أي سكربت صفحة
  window.androidBridge = {}
  window.Capacitor = window.Capacitor || {}
  window.Capacitor.nativeBridge = true
}

async function createWin() {
  await server.listen(PORT)
  const win = new BrowserWindow({
    width: 420,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'mobile-sim-preload.cjs'),
      // عالم مشترك كي تصل تعديلات preload (androidBridge/حذف الواجهات) لسكربتات الصفحة
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false
    }
  })
  win.webContents.on('console-message', (_e, _l, m) => {
    if (process.env.SIM_VERBOSE) console.log('SIM-CONSOLE:', String(m).slice(0, 300))
  })
  await win.loadURL(`http://127.0.0.1:${PORT}/index.html`)
  console.log('SIM-LOADED')
  // فحوصات داخل الصفحة بعد مهلة إقلاع واقعية
  await new Promise((r) => setTimeout(r, 5000))
  const checks = await win.webContents.executeJavaScript(`(async () => {
    const fatal = !!document.querySelector('#bootGuard pre')
    return {
      guardGone: !document.getElementById('bootGuard'),
      fatalCard: fatal,
      apiInstalled: typeof window.api === 'object' && window.api !== null,
      platform: window.api?.platform ?? null,
      listBooksOk: Array.isArray(await window.api.listBooks()),
      hasOwnRestored: typeof Object.hasOwn === 'function' && Object.hasOwn({ a: 1 }, 'a'),
      atRestored: Array.prototype.at.call([1, 2, 3], -1) === 3,
      replaceAllRestored: typeof String.prototype.replaceAll === 'function',
      uuidOk: typeof window.crypto?.randomUUID === 'function' ? window.crypto.randomUUID().length === 36 : false,
      rootChildren: document.getElementById('root')?.children.length ?? 0,
      bodySnippet: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 90)
    }
  })()`, true)
  console.log('SIM-RESULT:', JSON.stringify(checks))
  process.exit(0)
}

app.whenReady().then(() => {
  createWin().catch((e) => {
    console.error('SIM-FAIL', e)
    app.exit(1)
  })
})
