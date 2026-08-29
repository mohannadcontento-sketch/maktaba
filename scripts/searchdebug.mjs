/** تشخيص بحث EPUB عبر مسار الواجهة الكامل */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import http from 'node:http'

const REPO = '/home/z/my-project/maktaba_repo'
const EPUB_SAMPLE = path.join(REPO, 'samples', 'عينة-كتاب-عربي.epub')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}
async function waitDebugger(t = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < t) {
    try { return (await getJson('http://127.0.0.1:9222/json/version'))['webSocketDebuggerUrl'] } catch { await sleep(500) }
  }
  throw new Error('no debugger')
}

async function main() {
  const electron = spawn('npx', ['electron', '.', '--no-sandbox', '--remote-debugging-port=9222'], {
    cwd: REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe']
  })
  let logs = ''
  electron.stderr.on('data', (d) => (logs += d))
  let browser
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: await waitDebugger(), defaultViewport: null })
    const pages = await browser.pages()
    const page = pages[0] ?? (await browser.waitForTarget((t) => t.type() === 'page')).page()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))

    await page.waitForFunction('typeof window.api !== "undefined"', { timeout: 30000 })
    await page.evaluate(async (p) => { await window.api.importPaths([p]) }, EPUB_SAMPLE)
    await page.reload()
    await page.waitForSelector('.cursor-pointer.rounded-2xl', { timeout: 15000 })
    await sleep(700)
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const c = cards.find((x) => [...x.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))
      c?.click()
    })
    await sleep(2500)

    // عدّ أزرار lucide-search الظاهرة
    const btnInfo = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.querySelector('svg.lucide-search'))
      return btns.map((b) => ({
        visible: b.offsetParent !== null,
        inHeader: !!b.closest('header'),
        cls: b.className.slice(0, 60),
        active: b.className.includes('bg-accent')
      }))
    })
    console.log('lucide-search buttons:', JSON.stringify(btnInfo))

    // انقر أول زر مرئي
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.querySelector('svg.lucide-search') && b.offsetParent !== null)
      btns[0]?.click()
    })
    await sleep(600)
    const afterClick = await page.evaluate(() => {
      const si = [...document.querySelectorAll('input')].find((i) => i.className.includes('w-52'))
      return { barOpen: !!si }
    })
    console.log('after click barOpen:', JSON.stringify(afterClick))

    if (afterClick.barOpen) {
      // نعترض القفزات لتسجيل سلاسل CFI
      await page.evaluate(() => {
        const orig = window.__epubSearchJump
        window.__jumpLog = []
        window.__epubSearchJump = (m) => {
          window.__jumpLog.push({ cfi: m.cfi, point: m.pointCfi })
          return orig?.(m)
        }
      })
      // اكتب الكلمة
      await page.evaluate(() => {
        const si = [...document.querySelectorAll('input')].find((i) => i.className.includes('w-52'))
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(si, 'تجريبي')
        si.dispatchEvent(new Event('input', { bubbles: true }))
        si.focus()
      })
      // انتظر الشارة حتى 20 ثانية
      let badge = null
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        const st = await page.evaluate(() => {
          const si = [...document.querySelectorAll('input')].find((i) => i.className.includes('w-52'))
          const span = si?.parentElement?.querySelector('span.min-w-16, span[class*="min-w-16"]')
          const t = (document.body.textContent ?? '')
          const m = t.match(/\d+\s*\/\s*\d+/)
          return { val: si?.value ?? '?', spanTxt: span?.textContent ?? null, count: m?.[0] ?? null }
        })
        badge = st.count ?? st.spanTxt
        if (st.count) break
      }
      console.log('badge after typing:', badge)
      const matches = await page.evaluate(() => window.__lastMatches ?? null)
      console.log('firstMatches:', JSON.stringify(matches, null, 1))
      const dbgInfo = await page.evaluate(() => window.__searchDebug ?? null)
      console.log('searchDebug:', JSON.stringify(dbgInfo, null, 1))
    }

    console.log('pageErrors:', errs.length ? errs.slice(0, 5) : 'none')
  } catch (e) {
    console.log('DEBUG FAILURE:', e)
    console.log('logs tail:', logs.slice(-800))
  } finally {
    try { await browser?.close() } catch { /* */ }
    try { electron.kill('SIGTERM') } catch { /* */ }
  }
}
main()
