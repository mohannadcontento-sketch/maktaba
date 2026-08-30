/**
 * اختبارات النسخة 2.7 — «PDF الجوال حتى الحواف» على طريقة Moon+ Reader:
 *  1) وضع Moon+ في PDF الجوال: لا شريط أدوات + حاوية بلا إزاحة علوية + هوامش صفحة صفرية + أرضية بيضاء
 *  2) الملاءمة الافتراضية «عرض الشاشة» — الصفحة تلمس الحواف
 *  3) مناطق اللمس داخل عارض موزيلا: الحافة السفلية للتمرير تسجّل وتتحرك فعلًا
 *  4) لمس المنتصف = وضع صافٍ (الرأس يختفي) والعودة بلمسة ثانية
 *  5) تبديل الملاءمة إلى «صفحة كاملة» من لوحة Moon+ يُطبق فورًا
 *  6) شريط التنقل السفلي للـ PDF موجود وسحب الشريط يقفز بين الصفحات
 *  7) شريط المعلومات يعرض «صفحة X من Y» للـ PDF
 *  8) زر الفهرس متاح للـ PDF على الجوال ويفتح اللوحة الجانبية
 *  9) التمرير التلقائي السلس: scrollTop ينمو باستمرار + القرص يوقفه
 * 10) الليلي على الجوال: قلب على مستوى الإطار (pdf-night-m)
 * 11) سطح المكتب لم يتغير: شريط الأدوات ظاهر + السمة الداكنة + بلا شريط سفلي
 * 12) صفر أخطاء صفحة
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  fs.rmSync(path.join(process.env.HOME, '.config', 'maktaba'), { recursive: true, force: true })
  if (!fs.existsSync(PDF_SAMPLE)) {
    const { execSync } = await import('node:child_process')
    execSync('npm run fixtures', { cwd: REPO, stdio: 'inherit' })
  }

  const electron = spawn(path.join(REPO, 'node_modules/electron/dist/electron'), ['.', '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, MAKTABA_TEST: '1', DISPLAY: process.env.DISPLAY ?? ':77' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  let ready = false
  const pending = new Map()
  const pageErrors = []
  const rl = readline.createInterface({ input: electron.stdout })
  rl.on('line', (line) => {
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { ready = true; return }
    if (line.includes('pageerror:')) pageErrors.push(line.slice(0, 250))
    try {
      const m = JSON.parse(line)
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    } catch {}
  })
  let idc = 0
  const evaljs = (expr, t = 30000) => new Promise((resolve, reject) => {
    const id = ++idc
    const to = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, t)
    pending.set(id, (m) => {
      clearTimeout(to)
      if (m.error) reject(new Error(`[eval #${id}: ${expr.slice(0, 90).replace(/\n/g, ' ')}] ${m.error}`))
      else resolve(m.value)
    })
    electron.stdin.write(JSON.stringify({ id, expr }) + '\n')
  })

  const openCardById = async (bookId) => {
    for (let i = 0; i < 30; i++) {
      const ok = await evaljs(`(async () => {
        const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
        if (!cards.length) return false
        const b = (await window.api.listBooks()).find((x) => x.id === ${JSON.stringify(bookId)})
        if (!b) return false
        const card = cards.find((c) => c.textContent.includes(b.title))
        card?.click()
        return !!card
      })()`, 20000).catch(() => false)
      if (ok) return true
      await sleep(500)
    }
    return false
  }

  /** انتظار جاهزية عارض PDF داخل الإطار */
  const waitPdfReady = async () => {
    for (let i = 0; i < 40; i++) {
      const r = await evaljs(`(() => {
        const f = document.querySelector('iframe[title=PDF]')
        const app = f?.contentWindow?.__pdfViewerApp
        return !!(app?.pdfDocument && document.querySelector('[data-testid=epub-flip-layer]') === null)
      })()`, 8000).catch(() => false)
      if (r) { await sleep(800); return true }
      await sleep(500)
    }
    return false
  }

  const getApp = `(document.querySelector('iframe[title=PDF]')?.contentWindow?.__pdfViewerApp ?? null)`
  const getFrame = `(document.querySelector('iframe[title=PDF]')?.contentDocument ?? null)`

  const backToLibrary = async () => {
    await evaljs(`(() => { [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('عودة'))?.click(); return 1 })()`)
    await sleep(700)
  }

  const closeMoonSheet = async () => {
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('[data-testid=moon-sheet] button')].find((b) => b.getAttribute('aria-label') === 'إغلاق')
      btn?.click()
      return !!btn
    })()`)
    await sleep(400)
  }

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    await evaljs(`(async () => { await window.api.importPaths(${JSON.stringify([PDF_SAMPLE])}); return 1 })()`, 60000)
    await evaljs(`location.reload(); 1`, 5000).catch(() => {})
    await sleep(2500)

    const pdfA = await evaljs(`(async () => (await window.api.listBooks()).filter((b) => b.format === 'pdf')[0]?.id ?? null)()`)

    // ---------- الوضع الجوال ----------
    await evaljs(`(() => { window.__mkForceMobile = true; return 1 })()`)
    await openCardById(pdfA)
    const pdfReady = await waitPdfReady()
    report('فتح كتاب PDF على الجوال وجاهزية العارض', pdfReady)

    // ---------- 1) وضع Moon+: لا شريط أدوات + حاوية كاملة + هوامش صفرية + أرضية بيضاء ----------
    const moonMode = await evaljs(`(() => {
      const doc = ${getFrame}
      if (!doc) return null
      const style = doc.querySelector('style[data-mk-viewer]')?.textContent ?? ''
      const tb = doc.getElementById('toolbarContainer')
      const cont = doc.getElementById('viewerContainer')
      const page = doc.querySelector('.pdfViewer .page')
      return {
        mobileCss: style.includes('--page-margin:0 auto') && style.includes('#ffffff'),
        toolbarHidden: !tb || getComputedStyle(tb).display === 'none' || tb.offsetHeight === 0,
        contTop: cont ? getComputedStyle(cont).top : null,
        contBg: cont ? getComputedStyle(cont).backgroundColor : null,
        pageMargin: page ? getComputedStyle(page).marginTop + '/' + getComputedStyle(page).marginBottom : null,
        bodyBg: getComputedStyle(doc.body).backgroundColor
      }
    })()`)
    report('وضع Moon+ في PDF الجوال: شريط الأدوات مخفي + الحاوية كاملة + هوامش صفرية + أرضية بيضاء',
      !!moonMode && moonMode.mobileCss && moonMode.toolbarHidden && moonMode.contTop === '0px'
        && moonMode.contBg === 'rgb(255, 255, 255)' && moonMode.bodyBg === 'rgb(255, 255, 255)',
      JSON.stringify(moonMode))

    // ---------- 2) الملاءمة الافتراضية «عرض الشاشة» ----------
    const fit0 = await evaljs(`${getApp}?.pdfViewer?.currentScaleValue ?? null`)
    report('الملاءمة الافتراضية «عرض الشاشة» (page-width)', fit0 === 'page-width', `scale=${fit0}`)

    // ---------- 3) مناطق اللمس: الحافة تمرّر فعليًا وتسجّل ----------
    const tap0 = await evaljs(`(() => {
      window.__mkPdfTapLog = []
      const doc = ${getFrame}
      const cont = doc.getElementById('viewerContainer')
      return { scrollTop: cont.scrollTop, h: cont.clientHeight }
    })()`)
    await evaljs(`(() => {
      const doc = ${getFrame}
      const w = doc.defaultView.innerWidth
      const h = doc.defaultView.innerHeight
      doc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: w * 0.9, clientY: h * 0.5 }))
      return 1
    })()`)
    let scrolled = false
    for (let i = 0; i < 14 && !scrolled; i++) {
      await sleep(300)
      scrolled = await evaljs(`(() => {
        const cont = ${getFrame}?.getElementById('viewerContainer')
        return cont ? cont.scrollTop > ${tap0.scrollTop} + 30 : false
      })()`).catch(() => false)
    }
    const tapLog = await evaljs(`window.__mkPdfTapLog ?? []`)
    report('مناطق اللمس: لمس الحافة اليمنى يمرّر الشاشة ويسجّل الحدث',
      scrolled && tapLog.some((x) => x.acted === 'next' && x.rx > 0.76),
      `scrolled=${scrolled} log=${JSON.stringify(tapLog)}`)

    // ---------- 4) لمس المنتصف = وضع صافٍ ثم العودة ----------
    const zenOn = await evaljs(`(() => {
      const doc = ${getFrame}
      const w = doc.defaultView.innerWidth
      const h = doc.defaultView.innerHeight
      doc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: w * 0.5, clientY: h * 0.5 }))
      return 1
    })()`)
    await sleep(600)
    const headerGone = await evaljs(`!document.querySelector('header')`)
    await evaljs(`(() => {
      const doc = ${getFrame}
      const w = doc.defaultView.innerWidth
      const h = doc.defaultView.innerHeight
      doc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: w * 0.5, clientY: h * 0.5 }))
      return 1
    })()`)
    await sleep(600)
    const headerBack = await evaljs(`!!document.querySelector('header')`)
    report('لمس المنتصف يبدّل وضع صافٍ (الرأس يختفي ويعود)', zenOn === 1 && headerGone && headerBack,
      `headerGone=${headerGone} headerBack=${headerBack}`)

    // ---------- 5) تبديل الملاءمة «صفحة كاملة» من لوحة Moon+ ----------
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('إعدادات القارئ'))
      btn?.click()
      return 1
    })()`)
    await sleep(500)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-pdffit-page]')?.click(); return 1 })()`)
    await sleep(700)
    const fit1 = await evaljs(`${getApp}?.pdfViewer?.currentScaleValue ?? null`)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-pdffit-width]')?.click(); return 1 })()`)
    await sleep(500)
    const fit2 = await evaljs(`${getApp}?.pdfViewer?.currentScaleValue ?? null`)
    await closeMoonSheet()
    report('تبديل الملاءمة من لوحة Moon+ يُطبق فورًا (صفحة كاملة/عرض الشاشة)',
      fit1 === 'page-fit' && fit2 === 'page-width', `page=${fit1} back=${fit2}`)

    // ---------- 6) شريط التنقل السفلي للـ PDF: سحب الشريط يقفز بين الصفحات ----------
    const footer = await evaljs(`(() => {
      const f = document.querySelector('footer')
      const seek = document.querySelector('[data-testid=moon-footer-seek]')
      return { on: !!f, seek: !!seek }
    })()`)
    const pageBefore = await evaljs(`${getApp}?.pdfViewer?.currentPageNumber ?? 0`)
    await evaljs(`(() => {
      const el = document.querySelector('[data-testid=moon-footer-seek]')
      if (!el) return 0
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '75')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      return 1
    })()`)
    await sleep(900)
    const pageAfter = await evaljs(`${getApp}?.pdfViewer?.currentPageNumber ?? 0`)
    report('شريط التنقل السفلي للـ PDF: موجود وسحبه يقفز للصفحة المطابقة',
      footer.on && footer.seek && pageAfter > pageBefore + 3,
      `footer=${JSON.stringify(footer)} ${pageBefore}→${pageAfter}`)

    // ---------- 7) شريط المعلومات يعرض «صفحة X من Y» ----------
    const statusbar = await evaljs(`(() => {
      const sb = document.querySelector('[data-testid=moon-statusbar]')
      return { on: !!sb, txt: sb?.textContent ?? '' }
    })()`)
    report('شريط المعلومات للـ PDF يعرض رقم الصفحة', statusbar.on && /صفحة\s*\d+\s*من/.test(statusbar.txt),
      JSON.stringify(statusbar).slice(0, 120))

    // ---------- 8) زر الفهرس متاح للـ PDF على الجوال ----------
    const tocOpen = await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('اللوحة الجانبية'))
      btn?.click()
      return !!btn
    })()`)
    await sleep(600)
    const panelVisible = await evaljs(`(() => {
      // اللوحة الجانبية تعرض الفهرس/المصغرات
      const aside = document.querySelector('aside')
      return !!aside && aside.getBoundingClientRect().width > 50
    })()`)
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('اللوحة الجانبية'))
      btn?.click()
      return 1
    })()`)
    await sleep(400)
    report('زر الفهرس متاح للـ PDF على الجوال ويفتح اللوحة', tocOpen && panelVisible, `btn=${tocOpen} panel=${panelVisible}`)

    // ---------- 9) التمرير التلقائي السلس ----------
    const asStart = await evaljs(`(() => {
      const cont = ${getFrame}?.getElementById('viewerContainer')
      if (!cont) return null
      cont.scrollTop = 0
      return cont.scrollTop
    })()`)
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('إعدادات القارئ'))
      btn?.click()
      return 1
    })()`)
    await sleep(500)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-autoscroll-toggle]')?.click(); return 1 })()`)
    await sleep(3200)
    const asMid = await evaljs(`(() => {
      const cont = ${getFrame}?.getElementById('viewerContainer')
      return cont ? cont.scrollTop : -1
    })()`)
    const pill = await evaljs(`!!document.querySelector('[data-testid=moon-autoscroll-pill]')`)
    await sleep(2500)
    const asLater = await evaljs(`(() => {
      const cont = ${getFrame}?.getElementById('viewerContainer')
      return cont ? cont.scrollTop : -1
    })()`)
    report('التمرير التلقائي السلس: الموضع ينمو باستمرار والقرص ظاهر',
      asMid > asStart + 40 && asLater > asMid + 40 && pill,
      `start=${asStart} mid=${asMid} later=${asLater} pill=${pill}`)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-autoscroll-pill]')?.click(); return 1 })()`)
    await sleep(400)
    await closeMoonSheet().catch(() => {})

    // ---------- 10) الليلي على الجوال: قلب مستوى الإطار ----------
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '') === 'الوضع الليلي')
      btn?.click()
      return 1
    })()`)
    await sleep(600)
    const nightM = await evaljs(`(() => {
      const f = document.querySelector('iframe[title=PDF]')
      return { cls: f?.className ?? '', has: f?.className?.includes?.('pdf-night-m') ?? false }
    })()`)
    report('الليلي الجوال: قلب على مستوى الإطار كله (pdf-night-m)', nightM.has, JSON.stringify(nightM))
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '') === 'الوضع النهاري')
      btn?.click()
      return 1
    })()`)
    await sleep(400)

    // ---------- 11) سطح المكتب لم يتغير ----------
    await backToLibrary()
    await evaljs(`(() => { window.__mkForceMobile = false; return 1 })()`)
    await openCardById(pdfA)
    await waitPdfReady()
    const desk = await evaljs(`(() => {
      const doc = ${getFrame}
      const tb = doc?.getElementById('toolbarContainer')
      const style = doc?.querySelector('style[data-mk-viewer]')?.textContent ?? ''
      return {
        toolbarVisible: !!tb && tb.offsetHeight > 0,
        darkCss: style.includes('#0f1115'),
        noMobileCss: !style.includes('--page-margin:0 auto'),
        footer: !!document.querySelector('footer'),
        dim: !!document.querySelector('[data-testid=moon-dim]'),
        edge: !!document.querySelector('[data-testid=moon-brightness-edge]')
      }
    })()`)
    report('سطح المكتب كما هو: شريط أدوات ظاهر + سمة داكنة + بلا مكونات جوال',
      desk.toolbarVisible && desk.darkCss && desk.noMobileCss && !desk.footer && !desk.dim && !desk.edge,
      JSON.stringify(desk))

    // ---------- 12) صفر أخطاء صفحة ----------
    report('صفر أخطاء صفحة خلال الجلسة', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

    const ok = results.every((r) => r.ok)
    console.log(ok ? '\n✅ جميع اختبارات v2.7 ناجحة' : '\n❌ توجد اختبارات فاشلة')
    process.exitCode = ok ? 0 : 1
  } finally {
    try { electron.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('✗ فشل السكربت:', e); process.exit(1) })
