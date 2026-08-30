/**
 * اختبارات النسخة 2.5 — إعدادات مستقلة لكل كتاب + تحكم موبايل كامل + تعليم وكومنتات:
 *  1) إعدادات مستقلة لكل كتاب: التعديل يُحفظ لمفتاح الكتاب فقط — الافتراضي العام لا يمس
 *  2) استقلالية كاملة: كتاب ثانٍ يفتح بإعداداته هو — و«طبّق على كل الكتب» يحدّث العام
 *  3) طابور تنقل موثوق: 8 نقرات متتالية سريعة → الصفحة تتقدم والطابور يفرغ (لا وقوف)
 *  4) سحب أفقي داخل iframe الكتاب يقلب الصفحات (كان معطلًا على الجوال)
 *  5) تحديد نص → لوحة الأدوات → تعليم بلون → يُحفظ في قاعدة البيانات
 *  6) الكليك يمين لا يقلب الصفحة ولا يبدّل الغامر + قائمة النظام ممنوعة
 *  7) كومنت: زر ملاحظة على بطاقة التعليق → محرر → حفظ → يُخزن
 *  8) خطوط مدمجة محملة فعلًا داخل iframe (أميري عادي وعريض)
 *  9) شريط تحكم سفلي للموبايل: موجود وزر «التالي» يقلب
 * 10) PDF: زر التمييز الرسمي ظاهر + الكليك يمين بلا أخطاء
 * 11) صفر أخطاء صفحة
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')
const EPUB_SAMPLE2 = path.join(SAMPLES, 'عينة-كتاب-عربي-2.epub')
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
  // نسخة ثانية من الكتاب لاختبار الاستقلالية
  fs.copyFileSync(EPUB_SAMPLE, EPUB_SAMPLE2)

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

  /** فتح بطاقة كتاب بالمعرف — بانتظار ظهور البطاقات */
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

  const visibleEpubIframe = `(() => {
    const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
    return fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 && r.right > 0 && r.left < window.innerWidth }) ?? null
  })()`

  const locOf = `(() => {
    const r = window.__epubRendition
    const loc = r?.currentLocation?.()
    return (loc?.start?.href ?? '') + ':' + (loc?.start?.displayed?.page ?? 0)
  })()`

  const backToLibrary = async () => {
    await evaljs(`(() => { [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('عودة'))?.click(); return 1 })()`)
    await sleep(700)
  }

  /** فتح لوحة خيارات العرض وإرجاع قيمة أول شريط تمرير (حجم الخط) */
  const openDrawerAndReadFontSlider = async () => {
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('خيارات العرض') || (b.title || '').includes('إعدادات القارئ'))
      btn?.click()
      return 1
    })()`)
    await sleep(500)
    return evaljs(`(() => {
      const sliders = [...document.querySelectorAll('input[type=range]')].filter((s) => !s.closest('header') && !s.closest('footer'))
      return sliders.length ? sliders[0].value : null
    })()`)
  }

  /** تغيير حجم الخط من لوحة الخيارات (شريط التمرير الأول خارج الترويسة) */
  const setFontSizeSlider = async (val) => {
    await evaljs(`(() => {
      const sliders = [...document.querySelectorAll('input[type=range]')].filter((s) => !s.closest('header') && !s.closest('footer'))
      const el = sliders[0]
      if (!el) return 0
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(String(val))})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 1
    })()`)
    await sleep(400)
  }

  /** انتظار جاهزية قارئ EPUB */
  const waitEpubReady = async () => {
    let r = false
    for (let i = 0; i < 30 && !r; i++) {
      r = await evaljs(`window.__epubFlowInfo?.()?.ready === true`).catch(() => false)
      if (!r) await sleep(400)
    }
    await sleep(500)
    return r
  }

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    await evaljs(`(async () => {
      await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE, EPUB_SAMPLE2])})
      return 1
    })()`, 60000)
    // تمييز الكتاب الثاني بعنوان مختلف
    await evaljs(`(async () => {
      const books = await window.api.listBooks()
      const second = books.filter((b) => b.format === 'epub')[1]
      if (second) await window.api.updateBook(second.id, { title: 'كتاب ب التجريبي' })
      return 1
    })()`)
    await evaljs(`location.reload(); 1`, 5000).catch(() => {})
    await sleep(2500)

    const epubA = await evaljs(`(async () => (await window.api.listBooks()).filter((b) => b.format === 'epub')[0]?.id ?? null)()`)
    const epubB = await evaljs(`(async () => (await window.api.listBooks()).filter((b) => b.format === 'epub')[1]?.id ?? null)()`)
    const keyA = `reader.settings.book:${epubA}`
    const keyB = `reader.settings.book:${epubB}`

    // ---------- 1) إعدادات مستقلة لكل كتاب ----------
    await evaljs(`(() => { window.__mkForceMobile = true; window.__mkForceTapZones = true; return 1 })()`)
    await openCardById(epubA)
    await waitEpubReady()
    await openDrawerAndReadFontSlider() // فتح اللوحة أولًا
    await setFontSizeSlider(130)
    const savedA = await evaljs(`window.api.getSetting(${JSON.stringify(keyA)})`)
    const globalRaw = await evaljs(`window.api.getSetting('reader.settings')`)
    let aJson = null
    try { aJson = JSON.parse(savedA) } catch {}
    report('إعدادات مستقلة: التعديل حفظ لمفتاح الكتاب فقط',
      aJson?.fontSize === 130 && !(globalRaw && JSON.parse(globalRaw)?.fontSize === 130),
      `book=${savedA?.slice(0, 60)} global=${String(globalRaw).slice(0, 60)}`)

    // ---------- 2) استمرار الإعداد بعد إعادة الفتح + استقلالية كتاب ثانٍ ----------
    await backToLibrary()
    await openCardById(epubA)
    await waitEpubReady()
    const sliderAfterReopen = await openDrawerAndReadFontSlider()
    report('الإعداد المستقل يُستعاد عند إعادة الفتح', sliderAfterReopen === '130', `slider=${sliderAfterReopen}`)
    await evaljs(`(() => { [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('خيارات العرض') || (b.title || '').includes('إعدادات القارئ'))?.click(); return 1 })()`)
    await sleep(300)
    await backToLibrary()

    await openCardById(epubB)
    await waitEpubReady()
    const sliderB = await openDrawerAndReadFontSlider()
    report('كتاب ثانٍ يفتح بإعداداته هو (لا يتأثر بالأول)', sliderB === '100', `slider=${sliderB}`)

    // «طبّق على كل الكتب» + «استعادة الافتراضي»
    await setFontSizeSlider(150)
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'طبّق على كل الكتب')
      btn?.click()
      return 1
    })()`)
    await sleep(400)
    const globalAfterApply = await evaljs(`(async () => { try { return JSON.parse(await window.api.getSetting('reader.settings') || '{}') } catch { return {} } })()`)
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'استعادة الافتراضي')
      btn?.click()
      return 1
    })()`)
    await sleep(400)
    const keyBCleared = await evaljs(`window.api.getSetting(${JSON.stringify(keyB)})`)
    report('«طبّق على الكل» يحدّث الافتراضي و«استعادة» تمسح طبقة الكتاب',
      globalAfterApply?.fontSize === 150 && !keyBCleared,
      `global=${globalAfterApply?.fontSize} keyB=${JSON.stringify(keyBCleared)}`)
    await backToLibrary()

    // ---------- 3) طابور التنقل الموثوق ----------
    await openCardById(epubA)
    await waitEpubReady()
    const loc0 = await evaljs(locOf)
    await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      const d = vis.contentDocument
      const w = d.defaultView.innerWidth || 600
      // الحافة اليسرى في كتاب عربي = التالي — 8 نقرات متتالية دون انتظار
      for (let i = 0; i < 8; i++) d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 120 + i }))
      return 1
    })()`)
    let drained = { busy: true, pending: 9 }
    for (let i = 0; i < 25; i++) {
      drained = await evaljs(`window.__mkNavInfo?.() ?? { busy: false, pending: 0 }`)
      if (!drained.busy && drained.pending === 0) break
      await sleep(400)
    }
    const loc1 = await evaljs(locOf)
    const pageMoved = loc1 !== loc0
    report('طابور التنقل: 8 نقرات متتابعة تُطبق ولا يقف القارئ',
      pageMoved && !drained.busy && drained.pending === 0,
      `${loc0} → ${loc1} queue=${JSON.stringify(drained)}`)

    // ---------- 4) سحب أفقي داخل iframe يقلب الصفحات ----------
    const loc2 = await evaljs(locOf)
    await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      if (!vis) return 0
      const d = vis.contentDocument
      const w = d.defaultView
      const mk = (x, y) => new w.Touch({ identifier: 1, target: d.body, clientX: x, clientY: y })
      const t1 = mk(340, 220), t2 = mk(255, 224)
      d.dispatchEvent(new w.TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], bubbles: true, cancelable: true }))
      d.dispatchEvent(new w.TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }))
      return 1
    })()`)
    let loc3 = loc2
    for (let i = 0; i < 10 && loc3 === loc2; i++) { await sleep(400); loc3 = await evaljs(locOf) }
    report('السحب الأفقي داخل الكتاب يقلب الصفحة', loc3 !== loc2, `${loc2} → ${loc3}`)
    await backToLibrary()

    // ---------- 5) تحديد نص → تعليم بلون → يُحفظ ----------
    await openCardById(epubA)
    await waitEpubReady()
    const selMade = await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      if (!vis) return 0
      const d = vis.contentDocument
      const p = d.querySelector('p') || d.body
      const range = d.createRange()
      range.selectNodeContents(p)
      const s = d.getSelection()
      s.removeAllRanges()
      s.addRange(range)
      return s.toString().trim().length
    })()`)
    // selectionchange يُطلق selected بعد 250ms — ننتظر اللوحة
    let popoverOpen = false
    for (let i = 0; i < 12 && !popoverOpen; i++) {
      popoverOpen = await evaljs(`!!document.querySelector('[data-selpop]')`).catch(() => false)
      if (!popoverOpen) await sleep(400)
    }
    report('تحديد النص يفتح لوحة الأدوات (تعليم/كومنت/نسخ/قراءة)', selMade > 0 && popoverOpen, `selChars=${selMade}`)

    // تعليم بالأول لون
    let highlightSaved = false
    if (popoverOpen) {
      await evaljs(`(() => {
        const pop = document.querySelector('[data-selpop]')
        pop.querySelector('button[title="تمييز"]')?.click()
        return 1
      })()`)
      await sleep(300)
      await evaljs(`(() => {
        const pop = document.querySelector('[data-selpop]')
        const color = pop?.querySelector('.absolute button')
        color?.click()
        return 1
      })()`)
      await sleep(800)
      const anns = await evaljs(`(async () => await window.api.listAnnotations(${JSON.stringify(epubA)}))()`)
      highlightSaved = anns.length === 1 && anns[0].type === 'highlight' && !!anns[0].text
      const popGone = await evaljs(`!document.querySelector('[data-selpop]')`)
      report('التعليم بلون يُنشئ تعليقًا محفوظًا ويغلق اللوحة', highlightSaved && popGone, `anns=${JSON.stringify(anns).slice(0, 120)}`)
    } else {
      report('التعليم بلون يُنشئ تعليقًا محفوظًا ويغلق اللوحة', false, 'popover never opened')
    }

    // ---------- 6) الكليك يمين: لا قلب صفحة ولا غامر ----------
    const zenBefore = await evaljs(`!!document.querySelector('header')`)
    const loc4 = await evaljs(locOf)
    await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      if (!vis) return 0
      const d = vis.contentDocument
      d.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (d.defaultView.innerWidth || 600) / 2, clientY: 200 }))
      return 1
    })()`)
    await sleep(500)
    const loc5 = await evaljs(locOf)
    const zenAfter = await evaljs(`!!document.querySelector('header')`)
    report('الكليك يمين لا يقلب الصفحة ولا يبدّل الوضع الغامر', loc4 === loc5 && zenBefore === zenAfter, `${loc4} → ${loc5}`)

    // ---------- 7) كومنت من اللوحة الجانبية ----------
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '') === 'التعليقات')
      btn?.click()
      return 1
    })()`)
    await sleep(500)
    await evaljs(`(() => {
      const noteBtn = document.querySelector('button[title="إضافة ملاحظة"]')
      noteBtn?.click()
      return !!noteBtn
    })()`)
    await sleep(500)
    const editorOpen = await evaljs(`!!document.querySelector('textarea')`)
    await evaljs(`(() => {
      const ta = document.querySelector('textarea')
      if (!ta) return 0
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      set.call(ta, 'كومنت تجريبي من الاختبار')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 1
    })()`)
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حفظ')
      btn?.click()
      return 1
    })()`)
    await sleep(700)
    const annWithNote = await evaljs(`(async () => (await window.api.listAnnotations(${JSON.stringify(epubA)})).find((a) => a.note)?.note ?? null)()`)
    report('الكومنت: محرر الملاحظة يفتح ويحفظ النص', editorOpen && annWithNote === 'كومنت تجريبي من الاختبار', `note=${JSON.stringify(annWithNote)}`)

    // ---------- 8) الخطوط المدمجة داخل iframe ----------
    const fontsOk = await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      if (!vis) return null
      const f = vis.contentDocument.fonts
      return { reg: f.check('16px Amiri'), bold: f.check('bold 16px Amiri') }
    })()`)
    report('الخطوط العربية المدمجة محمّلة داخل الكتاب (أميري عادي + عريض)', !!fontsOk && fontsOk.reg && fontsOk.bold, JSON.stringify(fontsOk))

    // ---------- 9) شريط التحكم السفلي للموبايل ----------
    const footer = await evaljs(`(() => {
      const f = document.querySelector('footer')
      const next = [...(f?.querySelectorAll('button') ?? [])].find((b) => b.title === 'التالي')
      const prev = [...(f?.querySelectorAll('button') ?? [])].find((b) => b.title === 'السابق')
      const slider = f?.querySelector('input[type=range]')
      return { footer: !!f, next: !!next, prev: !!prev, slider: !!slider }
    })()`)
    const loc6 = await evaljs(locOf)
    await evaljs(`(() => {
      const f = document.querySelector('footer')
      const next = [...f.querySelectorAll('button')].find((b) => b.title === 'التالي')
      next?.click()
      return 1
    })()`)
    let loc7 = loc6
    for (let i = 0; i < 10 && loc7 === loc6; i++) { await sleep(400); loc7 = await evaljs(locOf) }
    report('شريط التحكم السفلي للموبايل موجود وزر «التالي» يقلب',
      footer.footer && footer.next && footer.prev && footer.slider && loc7 !== loc6,
      `${JSON.stringify(footer)} ${loc6} → ${loc7}`)
    await backToLibrary()

    // ---------- 10) PDF: زر التمييز الرسمي + الكليك يمين ----------
    const pdfId = await evaljs(`(async () => (await window.api.listBooks()).find((b) => b.format === 'pdf')?.id ?? null)()`)
    await openCardById(pdfId)
    let viewerReady = false
    for (let i = 0; i < 50 && !viewerReady; i++) {
      viewerReady = await evaljs(`(() => {
        const f = document.querySelector('iframe[src*="pdfjs"]')
        return !!(f && f.contentWindow && f.contentWindow.__pdfViewerApp && f.contentWindow.__pdfViewerApp.pdfDocument)
      })()`).catch(() => false)
      if (!viewerReady) await sleep(300)
    }
    const pdfEditor = await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      const d = f?.contentDocument
      const btn = d?.getElementById('editorHighlightButton')
      return { ready: ${viewerReady}, btn: !!btn, visible: !!btn && btn.offsetParent !== null }
    })()`)
    report('PDF: زر التمييز الرسمي من موزيلا ظاهر في الشريط', pdfEditor.ready && pdfEditor.visible, JSON.stringify(pdfEditor))
    await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      const d = f.contentDocument
      d.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))
      return 1
    })()`)
    await sleep(400)

    // ---------- 11) صفر أخطاء صفحة ----------
    report('صفر أخطاء صفحة خلال الجلسة', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

    const ok = results.every((r) => r.ok)
    console.log(ok ? '\n✅ جميع اختبارات v2.5 ناجحة' : '\n❌ توجد اختبارات فاشلة')
    process.exitCode = ok ? 0 : 1
  } finally {
    try { electron.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('✗ فشل السكربت:', e); process.exit(1) })
