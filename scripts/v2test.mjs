/**
 * اختبار ميزات النسخة 2: بحث EPUB + شريط القراءة الصوتية + نافذة "ما الجديد"
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import path from 'node:path'

const REPO = '/home/z/my-project/maktaba_repo'
const EPUB_SAMPLE = path.join(REPO, 'samples', 'عينة-كتاب-عربي.epub')

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}
import http from 'node:http'

async function waitDebugger(timeoutMs = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await getJson('http://127.0.0.1:9222/json/version')
      return v['webSocketDebuggerUrl']
    } catch {
      await sleep(500)
    }
  }
  throw new Error('remote debugging port never came up')
}

async function main() {
  console.log('launching electron…')
  const electron = spawn('npx', ['electron', '.', '--no-sandbox', '--remote-debugging-port=9222'], {
    cwd: REPO,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let mainLogs = ''
  electron.stdout.on('data', (d) => (mainLogs += d))
  electron.stderr.on('data', (d) => (mainLogs += d))

  let browser
  try {
    const ws = await waitDebugger()
    browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.waitForTarget((t) => t.type() === 'page')).page()

    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.waitForFunction('typeof window.api !== "undefined" && !!window.api.listBooks', { timeout: 30000 })

    // ---------- 1) نافذة "ما الجديد" تظهر عند أول تشغيل ----------
    await page.evaluate(() => window.api.setSetting('app.whatsNewV2', null))
    await page.reload()
    await page.waitForFunction('typeof window.api !== "undefined"', { timeout: 30000 })
    await sleep(1200)
    const whatsNewShown = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], .fixed.inset-0')
      return !!dlg
    })
    report('whats-new dialog appears on first run', whatsNewShown)
    // نغلقها (زر الحوار) ونكمل
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="dialog"] button, .fixed.inset-0 button')]
      const last = btns[btns.length - 1]
      last?.click()
    })
    await sleep(600)
    const seenAfter = await page.evaluate(() => window.api.getSetting('app.whatsNewV2'))
    report('whats-new close persists flag', !!seenAfter, String(seenAfter))

    // ---------- 2) استيراد وفتح EPUB ----------
    await page.evaluate(async (p) => {
      await window.api.importPaths([p])
    }, EPUB_SAMPLE)
    await page.reload()
    await page.waitForSelector('.cursor-pointer.rounded-2xl', { timeout: 15000 })
    await sleep(800)
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const epubCard = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))
      ;(epubCard ?? cards[0])?.click()
    })
    await sleep(2500)
    const iframeOpen = await page.evaluate(() => document.querySelectorAll('iframe').length > 0)
    report('epub reader opened for search test', iframeOpen)

    // ---------- 3) بحث EPUB: Ctrl+F ثم كلمة من نص الكتاب ----------
    // نأخذ كلمة من نص الكتاب داخل iframe نفسه
    const word = await page.evaluate(() => {
      const f = document.querySelector('iframe')
      const txt = f?.contentDocument?.body?.textContent ?? ''
      const words = (txt || '').split(/\s+/).filter((w) => w.length >= 5)
      return words[Math.floor(words.length / 2)] ?? ''
    })
    report('picked search word from book', word.length >= 3, word)

    // نفتح البحث عبر زر العدسة في شريط القارئ (بدل تركيبة Ctrl+F)
    const searchBtnClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const s = btns.find((b) => b.querySelector('svg.lucide-search'))
      s?.click()
      return !!s
    })
    report('search button clicked', searchBtnClicked)
    await sleep(500)
    // حقل البحث الموحد
    const typed = await page.evaluate((w) => {
      const inputs = [...document.querySelectorAll('input')]
      const si = inputs.find((i) => i.placeholder && i.type !== 'range')
      if (!si) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(si, w)
      si.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }, word)
    report('search bar accepts input', typed)
    // ننتظر ظهور النتائج (شارة العدد) أو قائمة النتائج
    let resultsCount = 0
    for (let i = 0; i < 30; i++) {
      await sleep(400)
      resultsCount = await page.evaluate(() => {
        // قائمة نتائج EPUB أو شارة عدد المطابقات في شريط البحث
        const list = document.querySelectorAll('mark').length
        const badge = [...document.querySelectorAll('span,div')].map((e) => e.textContent ?? '').find((t) => /\/\s*\d+/.test(t) && t.length < 24)
        const m = badge?.match(/\/\s*(\d+)/)
        return Math.max(list, m ? Number(m[1]) : 0)
      })
      if (resultsCount > 0) break
    }
    report('epub search found matches', resultsCount > 0, `count≈${resultsCount}`)

    // ننتقل بين النتائج (زر التالي) ثم نتأكد من عدم الانهيار
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const next = btns.find((b) => (b.textContent ?? '').includes('↓') || (b.title ?? '') === 'التالي')
      next?.click()
    })
    await sleep(900)
    report('no renderer crash after search navigation', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

    // ---------- 4) القراءة الصوتية: زر Volume2 يفتح الشريط ----------
    await page.keyboard.press('Escape')
    await sleep(300)
    const ttsBarShown = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const vol = btns.find((b) => b.querySelector('svg') && (b.innerHTML.includes('lucide-volume') || b.innerHTML.includes('volume')))
      vol?.click()
      return !!vol
    })
    await sleep(900)
    const ttsBarVisible = await page.evaluate(() => {
      // شريط TTS: يحوي أزرار تشغيل — نبحث عن نص "قراءة صوتية" أو زر تشغيل
      const t = document.body.textContent ?? ''
      return t.includes('قراءة') || t.includes('تشغيل')
    })
    report('tts bar toggles open', ttsBarShown && ttsBarVisible)

    report('no pageerrors overall', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  } catch (e) {
    console.log('TEST FAILURE:', e)
    console.log('main logs (tail):', mainLogs.slice(-1500))
    process.exitCode = 1
  } finally {
    try { await browser?.close() } catch { /* ignore */ }
    try { electron.kill('SIGTERM') } catch { /* ignore */ }
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`--- ${passed}/${results.length} passed`)
  if (passed < results.length) process.exitCode = 1
}

main()
