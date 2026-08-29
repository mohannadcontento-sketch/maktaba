/** اختبار التنقل: عجلة الفأرة في وضع الصفحات + الأسهم + اتجاه RTL + جلب غلاف من الويب */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import http from 'node:http'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function main() {
  const electron = spawn('npx', ['electron', '.', '--no-sandbox', '--remote-debugging-port=9222'], { cwd: REPO, env: process.env })
  try {
    let ws = null
    for (let i = 0; i < 40 && !ws; i++) {
      try { ws = (await getJson('http://127.0.0.1:9222/json/version'))['webSocketDebuggerUrl'] } catch { await sleep(600) }
    }
    const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
    const page = (await browser.pages())[0]
    await page.waitForFunction('typeof window.api !== "undefined"', { timeout: 30000 })

    await page.evaluate(async (paths) => { await window.api.importPaths(paths) }, [path.join(SAMPLES, 'عينة-كتاب-عربي.epub'), path.join(SAMPLES, 'sample-book.pdf')])
    await page.reload()
    await page.waitForFunction('typeof window.api !== "undefined"', { timeout: 30000 })
    await page.waitForSelector('.cursor-pointer.rounded-2xl', { timeout: 15000 })
    await sleep(800)

    // افتح EPUB
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const epubCard = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))
      epubCard?.click()
    })
    await sleep(3500)

    // حجم الخط الافتراضي، ثم غيّره ليتغير المحتوى لاحقًا؟ لا — نكفي على الافتراضي
    // ===== 1) عجلة الفأرة في وضع الصفحات (paginated) =====
    const pos0 = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')
      const win = iframe?.contentWindow
      return { scrollX: win?.scrollX ?? 0 }
    })
    // إرسال عجلة حقيقية عبر CDP فوق مركز القارئ
    const readerBox = await page.evaluate(() => {
      const el = document.querySelector('iframe')
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await page.mouse.move(readerBox.x, readerBox.y)
    for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(450) }
    await sleep(800)
    const pos1 = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')
      const win = iframe?.contentWindow
      // في paginated لا يوجد scroll — نستخدم percent الشريط
      const range = document.querySelector('input[type="range"]')
      return { scrollX: win?.scrollX ?? 0, percent: range ? Number(range.value) : -1 }
    })
    report('mouse wheel flips page (paginated)', pos1.percent > pos0.scrollX || pos1.percent > 0, `percent=${pos1.percent}`)

    // ===== 2) الأسهم داخل iframe — ArrowLeft (كتاب عربي) = التالي =====
    const percentBefore = pos1.percent
    await page.evaluate(() => {
      const iframe = document.querySelector('iframe')
      const doc = iframe?.contentDocument
      doc?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    })
    await sleep(1200)
    const percentAfterLeft = await page.evaluate(() => {
      const range = document.querySelector('input[type="range"]')
      return range ? Number(range.value) : -1
    })
    report('ArrowLeft inside iframe = next page (RTL book)', percentAfterLeft > percentBefore, `before=${percentBefore} after=${percentAfterLeft}`)

    // ArrowRight = السابق
    await page.evaluate(() => {
      const iframe = document.querySelector('iframe')
      const doc = iframe?.contentDocument
      doc?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    })
    await sleep(1200)
    const percentAfterRight = await page.evaluate(() => {
      const range = document.querySelector('input[type="range"]')
      return range ? Number(range.value) : -1
    })
    report('ArrowRight inside iframe = prev page (RTL book)', percentAfterRight < percentAfterLeft, `before=${percentAfterLeft} after=${percentAfterRight}`)

    // ===== 3) الهوامش تُطبق فورًا =====
    await page.evaluate(() => document.querySelector('[title="خيارات العرض"]')?.click())
    await sleep(500)
    // نغيّر هامش يمين عبر input range الثاني (marginLeft/Right sliders)
    const changed = await page.evaluate(() => {
      const sliders = [...document.querySelectorAll('label input[type="range"]')]
      // ترتيب: حجم الخط، تباعد الأسطر، هامش يمين، هامش يسار، هامش أعلى، هامش أسفل
      const mr = sliders[2]
      if (!mr) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(mr, 18)
      mr.dispatchEvent(new Event('input', { bubbles: true }))
      mr.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })
    await sleep(700)
    const marginNow = await page.evaluate(() => {
      const divs = [...document.querySelectorAll('div[style*="padding"]')]
      const padded = divs.find((d) => d.style.paddingRight && d.querySelector('iframe, [class*="epub"]') || d.style.paddingRight.includes('18%'))
      return padded ? padded.style.paddingRight : null
    })
    report('right margin slider applies instantly', changed && marginNow === '18%', `paddingRight=${marginNow}`)

    // أغلق اللوحة
    await page.keyboard.press('Escape')
    await sleep(300)

    // ===== 4) جلب غلاف من الويب عبر IPC (قد يفشل في بيئة معزولة) =====
    const webCover = await page.evaluate(async () => {
      const books = await window.api.listBooks()
      const pdfBook = books.find((b) => b.format === 'pdf')
      if (!pdfBook) return { skip: true }
      // عنوان إنجليزي لضمان فرصة تطابق
      const fresh = await window.api.fetchWebCover(pdfBook.id, 'The Adventures of Sherlock Holmes', 'Arthur Conan Doyle')
      return { gotCover: !!fresh?.coverPath, path: fresh?.coverPath ?? null }
    })
    if (webCover.skip) report('web cover fetch (skipped — no pdf)', false)
    else report('web cover fetch via IPC', webCover.gotCover, JSON.stringify(webCover))

    const passed = results.filter((r) => r.ok).length
    console.log(`\n===== NAV TESTS: ${passed}/${results.length} passed =====`)
    await browser.disconnect()
  } catch (e) {
    console.error('TEST FAILURE:', e)
    process.exitCode = 1
  } finally {
    electron.kill('SIGTERM')
    setTimeout(() => process.exit(process.exitCode || 0), 400)
  }
}

main()
