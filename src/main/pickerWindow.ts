import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { useWebImageForBook } from './library'

/**
 * نافذة متصفح مدمج لاختيار الغلاف من صور جوجل يدويًا
 * — تفتح صفحة بحث الصور، ويُحقن فيها شريط تعليمات + التقاط النقر على أي صورة.
 * عند نقر صورة نستخرج رابطها الكامل ونسأل المستخدم تأكيدًا داخل الصفحة نفسها،
 * ثم ننزّلها ونحفظها غلافًا للكتاب ونخبر النافذة الرئيسية.
 */

const activePickers = new Map<number, string>() // webContents.id → bookId

const INJECT_JS = `
(function () {
  if (window.__maktabaInjected) return
  window.__maktabaInjected = true
  window.__pickedUrl = null
  window.__pickedCount = 0

  const bar = document.createElement('div')
  bar.setAttribute('dir', 'rtl')
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:10px 16px;background:linear-gradient(90deg,#0f766e,#0d9488);color:#fff;font-family:system-ui,Segoe UI,Tahoma,sans-serif;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.35);'
  bar.innerHTML = \`
    <span style="font-weight:800">📚 مكتبة — اختيار غلاف</span>
    <span style="opacity:.92;font-size:12.5px">انقر على الصورة المناسبة وسيتم التقاطها تلقائيًا كبغلاف للكتاب</span>
    <span id="mk-status" style="margin-inline-start:auto;font-size:12px;background:rgba(255,255,255,.18);padding:3px 10px;border-radius:999px">جاهز</span>
  \`
  document.documentElement.appendChild(bar)
  document.documentElement.style.paddingTop = '46px'

  const status = (t, ok) => {
    const el = document.getElementById('mk-status')
    if (el) { el.textContent = t; el.style.background = ok ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.18)' }
  }

  function resolveFull(img) {
    // 1) رابط imgres القريب يحمل الصورة الأصلية
    let a = img.closest('a[href*="imgurl="]')
    if (a) {
      try {
        const u = new URL(a.href, location.origin)
        const iu = u.searchParams.get('imgurl')
        if (iu) return iu
      } catch (e) {}
    }
    // 2) إن لم تكن المصغرة gstatic فربما هي الأصلية نفسها
    const src = img.currentSrc || img.src || ''
    if (src && !/encrypted-tbn|gstatic|googlelogo| favicon/i.test(src) && /^https?:/.test(src)) return src
    // 3) البحث في صفة العنصر عن رابط كبير
    const big = img.closest('[data-lpage],[data-thumb-url]')
    if (big) {
      const du = big.getAttribute('data-thumb-url')
      if (du) return du
    }
    return null
  }

  document.addEventListener('click', function (e) {
    const img = e.target && e.target.closest ? e.target.closest('img') : null
    if (!img) return
    const full = resolveFull(img)
    if (!full) { status('تعذر استخراج الرابط — جرّب صورة أخرى'); return }
    e.preventDefault()
    e.stopPropagation()
    window.__pickedUrl = full
    window.__pickedCount++
    status('تم التقاط الصورة ✓ — جارٍ الحفظ…', true)
    img.style.outline = '4px solid #0d9488'
    img.style.outlineOffset = '-4px'
    setTimeout(function(){ status('اختُبرت صورة — يمكنك التقاط أخرى أو الإغلاق') }, 2500)
  }, true)

  status('جاهز — انقر أي صورة')
})()
`

/** حلقة استقصاء لالتقاط الرابط المحدد من داخل الصفحة */
function startPolling(win: BrowserWindow, bookId: string): void {
  const timer = setInterval(async () => {
    if (win.isDestroyed()) {
      clearInterval(timer)
      return
    }
    try {
      const picked = (await win.webContents.executeJavaScript('window.__pickedUrl', true)) as
        | string
        | null
      if (!picked) return
      await win.webContents.executeJavaScript('window.__pickedUrl = null', true)
      const book = await useWebImageForBook(bookId, picked)
      const mainWin = BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed())
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('covers:updated', book)
      }
    } catch {
      /* الصفحة تتنقل — نكمل الاستقصاء */
    }
  }, 400)
  win.on('closed', () => clearInterval(timer))
}

/**
 * فتح نافذة المنتقي على بحث صور جوجل لاستعلام معين
 */
export function openCoverBrowser(bookId: string, query: string): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'اختيار غلاف من جوجل — مكتبة',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=2&hl=ar`
  void win.loadURL(url)
  activePickers.set(win.webContents.id, bookId)

  win.webContents.on('did-finish-load', () => {
    void win.webContents.executeJavaScript(INJECT_JS, true).catch(() => {})
  })
  // إعادة الحقن بعد كل تنقل (بحث جديد، ترقيم صفحات…)
  win.webContents.on('did-navigate', () => {
    void win.webContents.executeJavaScript(INJECT_JS, true).catch(() => {})
  })

  startPolling(win, bookId)
}

export function registerPickerIpc(): void {
  ipcMain.handle('covers:openBrowser', (_e, bookId: string, query: string) => {
    openCoverBrowser(bookId, query)
  })
}
