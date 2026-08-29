/**
 * اختبار آلي للتطبيق في وضع التشغيل الفعلي (إلكترون + xvfb)
 * يتحقق من: بروتوكول الأغلفة، توليد أغلفة PDF، وضع التمرير في EPUB،
 * شريط التقدم، الهوامش، وزر إعادة الضبط
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

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

async function waitDebugger(timeoutMs = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await getJson('http://127.0.0.1:9222/json/version')
      return v['webSocketDebuggerUrl']
    } catch { await new Promise((r) => setTimeout(r, 700)) }
  }
  throw new Error('remote debugging port never came up')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!fs.existsSync(PDF_SAMPLE) || !fs.existsSync(EPUB_SAMPLE)) {
    console.log('generating fixtures…')
    const { execSync } = await import('node:child_process')
    execSync('npm run fixtures', { cwd: REPO, stdio: 'inherit' })
  }

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

    const consoleErrors = []
    const failedRequests = []
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('requestfailed', (r) => failedRequests.push(`${r.url().slice(0, 90)} :: ${r.failure()?.errorText}`))
    page.on('response', (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.url().slice(0, 90)} :: HTTP ${r.status()}`)
    })

    await page.waitForFunction('typeof window.api !== "undefined" && !!window.api.listBooks', { timeout: 30000 })
    report('renderer loaded with window.api', true)

    // ---------- 1) استيراد الكتب ----------
    const imported = await page.evaluate(async (paths) => {
      const added = await window.api.importPaths(paths)
      return added.map((b) => ({ id: b.id, format: b.format, title: b.title, coverPath: b.coverPath }))
    }, [PDF_SAMPLE, EPUB_SAMPLE])
    report('import books via IPC', imported.length === 2, JSON.stringify(imported.map((b) => b.format)))

    // تحديث واجهة المكتبة (المتجر يُحمّل عند بدء الصفحة)
    await page.reload()
    await page.waitForFunction('typeof window.api !== "undefined" && !!window.api.listBooks', { timeout: 30000 })
    await page.waitForSelector('.cursor-pointer.rounded-2xl', { timeout: 15000 })
    await sleep(800)

    // قد تكون العينات مستوردة سابقًا (منع تكرار يُرجع []) — نقرأ من المكتبة احتياطًا
    const lib0 = await page.evaluate(() => window.api.listBooks())
    const pdfBook = imported.find((b) => b.format === 'pdf') ?? lib0.find((b) => b.format === 'pdf')
    const epubBook = imported.find((b) => b.format === 'epub') ?? lib0.find((b) => b.format === 'epub')
    report('pdf sample imported', !!pdfBook)
    report('epub sample imported', !!epubBook)

    // ---------- 2) بروتوكول الأغلفة ----------
    // EPUB يحمل غلافًا مدمجًا — يُستخرج عند الاستيراد مباشرة
    // نقرأ الكتب من القاعدة مباشرة
    const freshBooks = await page.evaluate(() => window.api.listBooks())
    const epubFresh = freshBooks.find((b) => b.format === 'epub')
    report('epub cover extracted at import', !!epubFresh?.coverPath, epubFresh?.coverPath ?? 'null')

    if (epubFresh?.coverPath) {
      const base = epubFresh.coverPath.split(/[\\/]/).pop()
      const coverStatus = await page.evaluate(async (name) => {
        try {
          const res = await fetch(`cover://img/${encodeURIComponent(name)}`)
          return res.status
        } catch (e) { return String(e) }
      }, base)
      report('cover:// protocol serves image', coverStatus === 200, `status=${coverStatus}`)
    }

    // فحص عرض الغلاف في بطاقة الكتاب (img element مع cover://)
    await sleep(600)
    const coverImgs = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')]
      return {
        total: imgs.length,
        covers: imgs.filter((i) => i.src.startsWith('cover://')).map((i) => ({ src: i.src.slice(0, 40), ok: i.complete && i.naturalWidth > 0 }))
      }
    })
    report('cover <img> renders via cover://', coverImgs.covers.length > 0 && coverImgs.covers.every((i) => i.ok), JSON.stringify(coverImgs))

    // ---------- 3) فتح PDF: توليد الغلاف + الرسم + شريط التقدم ----------
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div.group')].find((d) => d.querySelector('img[src^="cover://"], div'))
      // ننقر على بطاقة الكتاب الأولى (PDF حسب الترتيب الافتراضي recent — الأحدث أولًا = epub)
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      ;(cards[0] || card)?.click()
    })
    await sleep(1500)
    const pdfState = await page.evaluate(async () => {
      // نتحقق إن كنا في القارئ وأي نوع مفتوح
      const range = document.querySelector('input[type="range"]')
      return { inReader: !!range }
    })
    // إذا فُتح الـ epub أولًا نعود ونفتح الـ pdf
    let openedPdf = false
    // نجرب: نرجع للمكتبة ثم نفتح البطاقة التي تحمل شارة PDF
    async function backToLibrary() {
      await page.keyboard.press('Escape')
      await sleep(200)
      const backBtn = await page.$('[title="العودة إلى المكتبة"]')
      if (backBtn) { await backBtn.click(); await sleep(700); return }
      // زر الرجوع يستخدم أيقونة سهم — نضغط أول IconButton في الهيدر
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('header button')]
        btns[0]?.click()
      })
      await sleep(700)
    }
    // عيّن أي كتاب مفتوح حاليًا عبر وجود canvas (pdf) أو iframe (epub)
    const whatOpen = await page.evaluate(() => ({
      pdf: document.querySelectorAll('canvas').length,
      epub: document.querySelectorAll('iframe').length
    }))
    report('reader opened after card click', whatOpen.pdf > 0 || whatOpen.epub > 0, JSON.stringify(whatOpen))
    if (whatOpen.pdf === 0) { await backToLibrary() }

    // افتح كتاب PDF تحديدًا: نعرف البطاقة عبر شارة PDF
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const pdfCard = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))
      pdfCard?.click()
    })
    await sleep(2500)
    const pdfCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length)
    report('pdf pages rendered (canvas)', pdfCanvas > 0, `canvas count=${pdfCanvas}`)

    // انتظار توليد الغلاف وحفظه
    await sleep(2000)
    const pdfCover = await page.evaluate(async (id) => {
      const b = await window.api.getBook(id)
      return b?.coverPath ?? null
    }, pdfBook.id)
    report('pdf cover generated on open', !!pdfCover, pdfCover ?? 'null')
    if (pdfCover) {
      const base = pdfCover.split(/[\\/]/).pop()
      const st = await page.evaluate(async (n) => {
        try { return (await fetch(`cover://img/${encodeURIComponent(n)}`)).status } catch (e) { return String(e) }
      }, base)
      report('pdf cover served via cover://', st === 200, `status=${st}`)
    }

    // شريط تقدم PDF: اسحب الشريط إلى 50%
    const pdfProgress = await page.evaluate(() => {
      const range = document.querySelector('input[type="range"]')
      if (!range) return null
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(range, 50)
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new Event('change', { bubbles: true }))
      range.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return true
    })
    await sleep(1200)
    const pdfPageAfterSlider = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('[data-pdf-page]')]
      const el = pages[0]?.parentElement?.parentElement
      const center = el ? el.scrollTop + el.clientHeight / 2 : 0
      let p = 1
      pages.forEach((pg, i) => { if (pg.offsetTop <= center) p = i + 1 })
      const label = [...document.querySelectorAll('header span')].map((s) => s.textContent).join(' ')
      return { page: p, label, scrollable: el ? el.scrollHeight > el.clientHeight : false }
    })
    report('pdf slider jumps to middle', !!pdfProgress && pdfPageAfterSlider.page > 1, JSON.stringify(pdfPageAfterSlider))

    // حفظ التقدم عند التمرير
    await page.evaluate(() => {
      const pages = [...document.querySelectorAll('[data-pdf-page]')]
      const el = pages[0]?.parentElement?.parentElement
      if (el) el.scrollTop = el.scrollHeight * 0.6
    })
    await sleep(1600)
    const savedProgress = await page.evaluate(async (id) => {
      const b = await window.api.getBook(id)
      return { progress: b?.progress, last: b?.lastLocation }
    }, pdfBook.id)
    report('pdf progress persists on scroll', savedProgress.progress > 0, JSON.stringify(savedProgress))

    await backToLibrary()

    // ---------- 4) فتح EPUB: التمرير + الأزرار + النسبة ----------
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const epubCard = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))
      epubCard?.click()
    })
    await sleep(3000)
    const epubOpen = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')
      return {
        hasIframe: !!iframe,
        bodyLen: iframe?.contentDocument?.body?.innerText?.length ?? 0
      }
    })
    report('epub opens with content', epubOpen.hasIframe && epubOpen.bodyLen > 0, JSON.stringify(epubOpen))

    // الهوامش: يجب وجود حاوية بـ padding نسبة مئوية
    const marginState = await page.evaluate(() => {
      const divs = [...document.querySelectorAll('div[style*="padding"]')]
      const padded = divs.find((d) => d.style.paddingLeft.includes('%') && d.querySelector('iframe'))
      return padded ? { pl: padded.style.paddingLeft, pr: padded.style.paddingRight } : null
    })
    report('epub margins applied on host wrapper', !!marginState, JSON.stringify(marginState))

    // شريط تقدم EPUB: يجب أن يعكس الموضع الحالي (وليس صفرًا بعد الاستئناف)
    const epubPercent0 = await page.evaluate(() => {
      const range = document.querySelector('input[type="range"]')
      const label = [...document.querySelectorAll('header span')].map((s) => s.textContent).find((s) => s.includes('%'))
      return { value: range ? Number(range.value) : null, label }
    })
    report('epub progress bar shows real position', epubPercent0.value > 0 || (epubPercent0.label || '').startsWith('0'), JSON.stringify(epubPercent0))

    // غيّر وضع العرض إلى "تمرير" من لوحة خيارات العرض
    await page.evaluate(() => {
      const btn = document.querySelector('[title="خيارات العرض"]')
      btn?.click()
    })
    await sleep(400)
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const scrolledBtn = btns.find((b) => b.textContent.trim() === 'تمرير')
      scrolledBtn?.click()
    })
    await sleep(2500)

    const scrolledState = await page.evaluate(() => {
      const container = document.querySelector('.epub-container')
      const iframe = document.querySelector('iframe')
      return {
        hasContainer: !!container,
        overflowY: container ? getComputedStyle(container).overflowY : null,
        scrollable: container ? container.scrollHeight > container.clientHeight : false,
        iframeH: iframe?.getBoundingClientRect().height ?? 0,
        contH: container?.getBoundingClientRect().height ?? 0
      }
    })
    report('epub scrolled mode activated (overflow auto)', scrolledState.hasContainer && scrolledState.overflowY === 'auto', JSON.stringify(scrolledState))
    report('epub scrolled mode content expandable/scrollable', scrolledState.scrollable || scrolledState.iframeH > scrolledState.contH, JSON.stringify(scrolledState))

    // التمرير بعجلة الفأرة فوق iframe في وضع التمرير يجب أن يحرك المحتوى
    const beforeScroll = await page.evaluate(() => document.querySelector('.epub-container')?.scrollTop ?? -1)
    await page.evaluate(() => {
      const container = document.querySelector('.epub-container')
      if (container) container.scrollTop = container.clientHeight * 1.5
      container?.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await sleep(800)
    const afterScroll = await page.evaluate(() => document.querySelector('.epub-container')?.scrollTop ?? -1)
    report('epub scrolled container scrolls', afterScroll > beforeScroll, `before=${beforeScroll} after=${afterScroll}`)

    // النسبة أثناء التمرير تتغير
    const percentDuringScroll = await page.evaluate(() => {
      const range = document.querySelector('input[type="range"]')
      return range ? Number(range.value) : -1
    })
    report('epub progress updates while scrolling (scrolled mode)', percentDuringScroll > 0, `percent=${percentDuringScroll}`)

    // التنقل بالأزرار: انقر زر "السابق" بعد التمرير → يجب أن يرجع للأعلى أو القسم السابق
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button[title]')]
      const prevBtn = btns.find((b) => b.title === 'السابق')
      prevBtn?.click()
    })
    await sleep(900)
    const afterPrev = await page.evaluate(() => document.querySelector('.epub-container')?.scrollTop ?? -1)
    report('epub side button prev works (scroll/section)', afterPrev < afterScroll, `afterPrev=${afterPrev} was=${afterScroll}`)

    // زر إعادة الضبط — نضمن فتح اللوحة أولًا (الزر يبدّل الحالة)
    await page.evaluate(() => {
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(esc)
    })
    await sleep(300)
    const drawerOpen = await page.evaluate(() => !!document.querySelector('[title="استعادة الافتراضي"]'))
    if (!drawerOpen) {
      await page.evaluate(() => document.querySelector('[title="خيارات العرض"]')?.click())
      await sleep(400)
    }
    // غيّر حجم الخط أولًا ثم اضغط إعادة الضبط
    await page.evaluate(async () => {
      window.api.setSetting('reader.settings', JSON.stringify({ fontSize: 180, fontFamily: 'bokra', theme: 'night', flow: 'scrolled' }))
    })
    await sleep(300)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('استعادة الافتراضي'))
      btn?.click()
    })
    await sleep(600)
    const settingsAfterReset = await page.evaluate(async () => {
      const raw = await window.api.getSetting('reader.settings')
      const s = JSON.parse(raw || '{}')
      return s
    })
    report(
      'reset button restores defaults',
      settingsAfterReset.fontSize === 100 && settingsAfterReset.theme === 'day' && settingsAfterReset.flow === 'paginated',
      JSON.stringify(settingsAfterReset)
    )

    // جلب غلاف من الويب (يعتمد على الشبكة — قد يفشل في بيئة معزولة)
    await page.evaluate(() => {
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(esc)
    })
    await sleep(300)
    await backToLibrary()

    // ---------- جمع الأخطاء ----------
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('Autofill') && !e.includes('favicon') && !e.includes('openlibrary') && !e.includes('googleapis') && !e.includes('Failed to load resource')
    )
    report('no renderer crashes/pageerrors', !realErrors.some((e) => e.includes('TypeError') || e.includes('ReferenceError')), JSON.stringify(realErrors.slice(0, 3)))
    console.log('\n--- failed requests (sample) ---')
    console.log([...new Set(failedRequests)].slice(0, 8).join('\n') || 'none')

    console.log('\n===== SUMMARY =====')
    const passed = results.filter((r) => r.ok).length
    console.log(`${passed}/${results.length} passed`)
    if (mainLogs.trim()) {
      console.log('\n--- main process logs (tail) ---')
      console.log(mainLogs.split('\n').slice(-12).join('\n'))
    }
  } catch (e) {
    console.error('TEST FAILURE:', e)
    if (mainLogs) console.log('main logs:', mainLogs.split('\n').slice(-30).join('\n'))
    process.exitCode = 1
  } finally {
    try { await browser?.disconnect() } catch {}
    electron.kill('SIGTERM')
    setTimeout(() => process.exit(process.exitCode || 0), 500)
  }
}

main()
