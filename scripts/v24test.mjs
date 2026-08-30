/**
 * اختبارات النسخة 2.4 — قارئ الجوال الاحترافي:
 *  1) الجوال: تبويبات سفلية بدل الشريط الجانبي + التنقل بين الصفحات
 *  2) PDF = عارض موزيلا الرسمي: iframe مورّد يفتح المستند + شريط أدوات كامل + سمة داكنة
 *  3) حفظ التقدم من العارض (قفزة صفحة → نسبة محفوظة ≈ 50%)
 *  4) تكبير بأزرار العارض الرسمية
 *  5) مصغرات العارض الرسمية
 *  6) EPUB: مناطق لمس — الحافة تقلب الصفحة والوسط يبدّل الوضع الغامر
 *  7) صفر أخطاء صفحة
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')
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

  const openCard = (label) => evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === ${JSON.stringify(label)}))?.click()
    return 1
  })()`)

  /** فتح بطاقة كتاب حسب الصيغة — بانتظار ظهور البطاقات أولًا */
  const openCardByFormat = async (format) => {
    let found = false
    for (let i = 0; i < 30 && !found; i++) {
      found = await evaljs(`(async () => {
        const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
        if (!cards.length) return false
        const books = await window.api.listBooks()
        const b = books.find((x) => x.format === ${JSON.stringify(format)})
        if (!b) return false
        const card = cards.find((c) => c.textContent.includes(b.title))
        card?.click()
        return !!card
      })()`, 20000).catch(() => false)
      if (!found) await sleep(500)
    }
    return found
  }

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    await evaljs(`(async () => {
      await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE])})
      return 1
    })()`, 45000)
    // إعادة تحميل لقراءة المتجر الكتب المستوردة — الـ reload يقطع تقييم السطر فنلتقط خطأه
    await evaljs(`location.reload(); 1`, 5000).catch(() => {})
    await sleep(2500)

    // 1) وضع الجوال: تبويبات سفلية + بلا شريط جانبي
    await evaljs(`(() => { window.__mkForceMobile = true; return 1 })()`)
    // أي تغيير حالة يعيد رندر App — نضغط زر إخفاء الشريط الجانبي إن وُجد
    await evaljs(`(() => {
      const hide = [...document.querySelectorAll('button')].find((b) => (b.title || '').includes('إخفاء'))
      hide?.click()
      return !!hide
    })()`)
    await sleep(500)
    const tabsState = await evaljs(`(() => {
      const aside = document.querySelector('aside')
      const nav = [...document.querySelectorAll('nav')].find((n) => n.querySelectorAll('button').length === 3)
      return { aside: !!aside, tabs: !!nav, labels: nav ? [...nav.querySelectorAll('button')].map((b) => b.textContent.trim()) : [] }
    })()`)
    report('الجوال: تبويبات سفلية بديلة عن الشريط الجانبي', tabsState.tabs && !tabsState.aside, JSON.stringify(tabsState))

    // التنقل بالتبويبات
    await evaljs(`(() => {
      const nav = [...document.querySelectorAll('nav')].find((n) => n.querySelectorAll('button').length === 3)
      const btn = [...nav.querySelectorAll('button')].find((b) => b.textContent.includes('إحصائ'))
    btn?.click()
    return 1
  })()`)
    await sleep(400)
    const statsActive = await evaljs(`(() => {
      const nav = [...document.querySelectorAll('nav')].find((n) => n.querySelectorAll('button').length === 3)
      const btn = [...nav.querySelectorAll('button')].find((b) => b.textContent.includes('إحصائ'))
      return !!btn && btn.className.includes('accent')
    })()`)
    report('التنقل بالتبويبات السفلية يعمل', !!statsActive)
    await evaljs(`(() => {
      const nav = [...document.querySelectorAll('nav')].find((n) => n.querySelectorAll('button').length === 3)
      const btn = [...nav.querySelectorAll('button')].find((b) => b.textContent.includes('المكتبة') || b.textContent.toLowerCase().includes('librar'))
      btn?.click()
      return 1
    })()`)
    await sleep(400)

    // 2) فتح PDF: عارض موزيلا الرسمي
    const pdfBook = await evaljs(`(async () => (await window.api.listBooks()).find((b) => b.format === 'pdf')?.id ?? null)()`)
    await evaljs(`(async () => { const b = await window.api.getBook(${JSON.stringify(null)}) ; return 1 })()`).catch(() => {})
    await openCardByFormat('pdf')
    await sleep(300)
    let viewerReady = false
    for (let i = 0; i < 50; i++) {
      viewerReady = await evaljs(`(() => {
        const f = document.querySelector('iframe[src*="pdfjs"]')
        return !!(f && f.contentWindow && f.contentWindow.__pdfViewerApp && f.contentWindow.__pdfViewerApp.pdfDocument)
      })()`).catch(() => false)
      if (viewerReady) break
      await sleep(300)
    }
    report('PDF: عارض موزيلا الرسمي يفتح المستند', !!viewerReady)
    const pdfInfo = await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      const app = f.contentWindow.__pdfViewerApp
      const d = f.contentDocument
      return {
        numPages: app.pdfDocument.numPages,
        toolbar: !!d.getElementById('toolbarContainer'),
        pageInput: !!d.getElementById('pageNumber'),
        darkStyle: !!d.querySelector('style[data-mk-viewer]')
      }
    })()`)
    report('PDF: شريط أدوات العارض + إدخال الصفحة + السمة الداكنة',
      pdfInfo.numPages === 8 && pdfInfo.toolbar && pdfInfo.pageInput && pdfInfo.darkStyle, JSON.stringify(pdfInfo))

    // 3) قفزة صفحة → حفظ التقدم
    await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      f.contentWindow.__pdfViewerApp.pdfViewer.currentPageNumber = 4
      return 1
    })()`)
    await sleep(1200)
    const prog = await evaljs(`(async () => (await window.api.listBooks()).find((b) => b.format === 'pdf')?.progress ?? -1)()`)
    report('PDF: حفظ التقدم من العارض الرسمي', Math.abs(prog - 50) <= 7, `progress=${prog}`)

    // 4) تكبير
    const zoom = await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      const app = f.contentWindow.__pdfViewerApp
      const before = app.pdfViewer.currentScale
      d = f.contentDocument
      d.getElementById('zoomInButton')?.click()
      return { before, after: app.pdfViewer.currentScale }
    })()`)
    report('PDF: زر التكبير الرسمي يعمل', zoom.after > zoom.before, `before=${zoom.before} after=${zoom.after}`)

    // 5) المصغرات
    const thumbs = await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      const d = f.contentDocument
      d.getElementById('sidebarToggleButton')?.click()
      return !!d.getElementById('thumbnailView')
    })()`)
    report('PDF: مصغرات العارض الرسمية', !!thumbs)

    // رجوع للمكتبة
    await evaljs(`(() => { document.querySelector('header button')?.click(); return 1 })()`)
    await sleep(500)

    // 6) EPUB: مناطق اللمس
    await evaljs(`(() => { window.__mkForceTapZones = true; return 1 })()`)
    await openCardByFormat('epub')
    await sleep(1500)
    let epubIframe = false
    for (let i = 0; i < 40; i++) {
      epubIframe = await evaljs(`(() => {
        const f = [...document.querySelectorAll('iframe')].find((x) => x.contentDocument?.body?.children.length)
        return !!f
      })()`).catch(() => false)
      if (epubIframe) break
      await sleep(300)
    }
    report('EPUB: فتح الكتاب', !!epubIframe)

    // انتظار اكتمال تهيئة العرض قبل اختبار اللمس
    let flowReady = false
    for (let i = 0; i < 20 && !flowReady; i++) {
      flowReady = await evaljs(`window.__epubFlowInfo?.()?.ready === true`).catch(() => false)
      if (!flowReady) await sleep(400)
    }
    await sleep(600)

    const cfiOf = `(() => {
      const r = window.__epubRendition
      const loc = r?.currentLocation?.()
      const p = loc?.start?.displayed?.page ?? 0
      return (loc?.start?.href ?? '') + ':' + p
    })()`
    const before = await evaljs(cfiOf)
    // الحافة اليسرى في كتاب عربي (RTL) = التالي — نختار الـ iframe المرئي فقط
    // (مدير epub.js يبقي أقسامًا مجاورة مخفية في DOM) — ونتحقق من موضع العارض نفسه
    // لأن شريط النسبة يحسب تقدير المواقع وقد يتأخر
    await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 && r.right > 0 && r.left < window.innerWidth })
      if (!vis) return 0
      const d = vis.contentDocument
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 12, clientY: 120 })
      d.dispatchEvent(ev)
      return 1
    })()`)
    let after = before
    for (let i = 0; i < 10 && after === before; i++) {
      await sleep(400)
      after = await evaljs(cfiOf)
    }
    report('EPUB: لمس الحافة يقلب الصفحة', !!before && !!after && before !== after, `cfi ${String(before).slice(-18)} → ${String(after).slice(-18)}`)

    // الوسط = وضع غامر (اختفاء الترويسة ثم عودتها) — الـ iframe المرئي فقط
    const centerTap = `(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 && r.right > 0 && r.left < window.innerWidth })
      if (!vis) return 0
      const d = vis.contentDocument
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: (d.defaultView.innerWidth || 600) / 2, clientY: 120 })
      d.dispatchEvent(ev)
      return 1
    })()`
    await evaljs(centerTap)
    await sleep(500)
    const zenOn = await evaljs(`!document.querySelector('header')`)
    await evaljs(centerTap)
    await sleep(500)
    const zenOff = await evaljs(`!!document.querySelector('header')`)
    report('EPUB: لمس الوسط يبدّل الوضع الغامر', !!zenOn && !!zenOff, `on=${zenOn} off=${zenOff}`)

    report('صفر أخطاء صفحة خلال الجلسة', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

    const ok = results.every((r) => r.ok)
    console.log(ok ? '\n✅ جميع اختبارات v2.4 ناجحة' : '\n❌ توجد اختبارات فاشلة')
    process.exitCode = ok ? 0 : 1
  } finally {
    try { electron.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('✗ فشل السكربت:', e); process.exit(1) })
