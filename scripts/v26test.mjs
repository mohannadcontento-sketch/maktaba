/**
 * اختبارات النسخة 2.6 — تجربة الجوال على طريقة Moon+ Reader:
 *  1) لوحة Moon+ تُفتح بثلاثة تبويبات (عرض/ثيمات/تحكم) على الجوال
 *  2) ثيمات Moon+ الثمانية: اختيار «كهرمان» يُحفظ لكل كتاب ويعكس زر الليل
 *  3) السطوع من لوحة التحكم: تراكب أسود يظهر بنفسجية صحيحة ويُحفظ في reader.mobile
 *  4) شريط السطوع على الحافة اليسرى: لمس رأسي يغيّر السطوع فورًا
 *  5) شريط المعلومات السفلي: موجود وفيه الوقت (وبطارية إن توفرت)
 *  6) أزرار الصوت: __mkVolumeKey يقلب الصفحات بالاتجاهين
 *  7) حركة الانزلاق لا تعطل طابور التنقل: 8 نقرات سريعة تُطبق كلها
 *  8) التمرير التلقائي: يشغّل ويقلب خلال ثوانٍ + القرص يوقفه
 *  9) فعل مركز الصفحة = لوحة الإعدادات (قابل للاختيار) ثم العودة لوضع صافٍ
 * 10) شريط التنقل السفلي قابل للإخفاء من الإعدادات وإعادته
 * 11) سطح المكتب لم يتغير: لوحة الخيارات العائمة وليست Moon+ وبلا تراكب سطوع
 * 12) صفر أخطاء صفحة
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  fs.rmSync(path.join(process.env.HOME, '.config', 'maktaba'), { recursive: true, force: true })
  if (!fs.existsSync(EPUB_SAMPLE)) {
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

  const locOf = `(() => {
    const r = window.__epubRendition
    const loc = r?.currentLocation?.()
    return (loc?.start?.href ?? '') + ':' + (loc?.start?.displayed?.page ?? 0)
  })()`

  const openSettingsBtn = `(() => {
    const btn = [...document.querySelectorAll('header button')].find((b) =>
      (b.title || '').includes('خيارات العرض') || (b.title || '').includes('إعدادات القارئ'))
    btn?.click()
    return btn?.title ?? null
  })()`

  const waitEpubReady = async () => {
    let r = false
    for (let i = 0; i < 30 && !r; i++) {
      r = await evaljs(`window.__epubFlowInfo?.()?.ready === true`).catch(() => false)
      if (!r) await sleep(400)
    }
    await sleep(500)
    return r
  }

  const backToLibrary = async () => {
    await evaljs(`(() => { [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('عودة'))?.click(); return 1 })()`)
    await sleep(700)
  }

  const closeMoonSheet = async (ev) => {
    await ev(`(() => {
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

    await evaljs(`(async () => {
      await window.api.importPaths(${JSON.stringify([EPUB_SAMPLE])})
      return 1
    })()`, 60000)
    await evaljs(`location.reload(); 1`, 5000).catch(() => {})
    await sleep(2500)

    const epubA = await evaljs(`(async () => (await window.api.listBooks()).filter((b) => b.format === 'epub')[0]?.id ?? null)()`)
    const keyA = `reader.settings.book:${epubA}`

    // ---------- 1) لوحة Moon+ على الجوال بثلاثة تبويبات ----------
    await evaljs(`(() => { window.__mkForceMobile = true; window.__mkForceTapZones = true; return 1 })()`)
    await openCardById(epubA)
    await waitEpubReady()
    const openedTitle = await evaljs(openSettingsBtn)
    await sleep(500)
    const sheet = await evaljs(`(() => {
      const s = document.querySelector('[data-testid=moon-sheet]')
      const tabs = ['look', 'themes', 'control'].map((id) => !!document.querySelector('[data-testid=moon-tab-' + id + ']'))
      return { open: !!s, tabs }
    })()`)
    report('لوحة Moon+ تُفتح على الجوال بثلاثة تبويبات (عرض/ثيمات/تحكم)',
      sheet.open && sheet.tabs.every(Boolean) && openedTitle?.includes('إعدادات القارئ'),
      `title=${openedTitle} sheet=${JSON.stringify(sheet)}`)

    // ---------- 2) ثيمات Moon+ الثمانية ----------
    await evaljs(`(() => { document.querySelector('[data-testid=moon-tab-themes]')?.click(); return 1 })()`)
    await sleep(300)
    const themesCount = await evaljs(`document.querySelectorAll('[data-testid^=moon-theme-]').length`)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-theme-amber]')?.click(); return 1 })()`)
    await sleep(700)
    const savedTheme = await evaljs(`(async () => { try { return JSON.parse(await window.api.getSetting(${JSON.stringify(keyA)}) || '{}').theme } catch { return null } })()`)
    const nightBtnSun = await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '') === 'الوضع النهاري')
      return !!btn
    })()`)
    report('ثيمات Moon+ الثمانية: اختيار «كهرمان» يُحفظ لكل كتاب ويعكس زر الليل',
      themesCount === 8 && savedTheme === 'amber' && nightBtnSun,
      `themes=${themesCount} saved=${savedTheme} sunBtn=${nightBtnSun}`)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-theme-day]')?.click(); return 1 })()`)
    await sleep(300)
    await closeMoonSheet(evaljs)

    // ---------- 3) السطوع من لوحة التحكم ----------
    await evaljs(openSettingsBtn.replace('btn?.click()', 'btn?.click()'))
    await sleep(400)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-tab-control]')?.click(); return 1 })()`)
    await sleep(300)
    await evaljs(`(() => {
      const el = document.querySelector('[data-testid=moon-brightness]')
      if (!el) return 0
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '70')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 1
    })()`)
    await sleep(500)
    const dim = await evaljs(`(() => {
      const d = document.querySelector('[data-testid=moon-dim]')
      return d ? { opacity: d.style.opacity } : null
    })()`)
    const savedMobile = await evaljs(`(async () => { try { return JSON.parse(await window.api.getSetting('reader.mobile') || '{}').brightness } catch { return null } })()`)
    report('السطوع: تراكب أسود بنسبة صحيحة ومحفوظ في reader.mobile',
      dim && Math.abs(parseFloat(dim.opacity) - 0.3) < 0.01 && savedMobile === 70,
      `dim=${JSON.stringify(dim)} saved=${savedMobile}`)

    // ---------- 4) شريط السطوع على الحافة اليسرى ----------
    const edgeResult = await evaljs(`(() => {
      const edge = document.querySelector('[data-testid=moon-brightness-edge]')
      if (!edge) return null
      const r = edge.getBoundingClientRect()
      const y = r.top + r.height * 0.1 // قرب الأعلى جدًا = سطوع عالٍ (≈92)
      const mk = (cy) => new Touch({ identifier: 1, target: edge, clientX: r.left + 5, clientY: cy })
      edge.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(y)], bubbles: true, cancelable: true }))
      edge.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }))
      return { left: r.left, w: r.width }
    })()`)
    await sleep(400)
    const brightAfterEdge = await evaljs(`(async () => { try { return JSON.parse(await window.api.getSetting('reader.mobile') || '{}').brightness } catch { return null } })()`)
    report('شريط السطوع على الحافة: لمس قرب الأعلى يرفع السطوع فورًا',
      !!edgeResult && brightAfterEdge >= 85 && brightAfterEdge <= 100 && edgeResult.left < 30,
      `edge=${JSON.stringify(edgeResult)} brightness=${brightAfterEdge}`)
    // إعادة السطوع لقيمة ملحوظة للاختبارات اللاحقة ثم إزالته
    await evaljs(`(() => {
      const el = document.querySelector('[data-testid=moon-brightness]')
      if (!el) return 0
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '100')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 1
    })()`)
    await sleep(300)
    const dimGone = await evaljs(`!document.querySelector('[data-testid=moon-dim]')`)
    report('عند سطوع 100% يختفي التراكب', dimGone, `dimGone=${dimGone}`)
    await closeMoonSheet(evaljs)

    // ---------- 5) شريط المعلومات السفلي ----------
    const statusbar = await evaljs(`(() => {
      const sb = document.querySelector('[data-testid=moon-statusbar]')
      const time = sb?.querySelector('[data-testid=moon-time]')?.textContent ?? null
      return { on: !!sb, time, pct: sb?.textContent?.includes('%') ?? false }
    })()`)
    report('شريط المعلومات السفلي موجود ويعرض الوقت والنسبة',
      statusbar.on && /^\d{2}:\d{2}$/.test(statusbar.time ?? '') && statusbar.pct,
      JSON.stringify(statusbar))

    // ---------- 6) أزرار الصوت تقلب الصفحات ----------
    const vloc0 = await evaljs(locOf)
    await evaljs(`(() => { window.__mkVolumeKey?.('down'); return 1 })()`)
    let vloc1 = vloc0
    for (let i = 0; i < 10 && vloc1 === vloc0; i++) { await sleep(400); vloc1 = await evaljs(locOf) }
    await evaljs(`(() => { window.__mkVolumeKey?.('up'); return 1 })()`)
    let vloc2 = vloc1
    for (let i = 0; i < 10 && vloc2 === vloc1; i++) { await sleep(400); vloc2 = await evaljs(locOf) }
    report('أزرار الصوت: − يقلّل للأمام و+ يعود للخلف',
      vloc1 !== vloc0 && vloc2 === vloc0,
      `${vloc0} → ${vloc1} → ${vloc2}`)

    // ---------- 7) حركة الانزلاق لا تعطل طابور التنقل ----------
    const aloc0 = await evaljs(locOf)
    await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      const d = vis.contentDocument
      for (let i = 0; i < 8; i++) d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 120 + i }))
      return 1
    })()`)
    let drained = { busy: true, pending: 9 }
    for (let i = 0; i < 25; i++) {
      drained = await evaljs(`window.__mkNavInfo?.() ?? { busy: false, pending: 0 }`)
      if (!drained.busy && drained.pending === 0) break
      await sleep(400)
    }
    const aloc1 = await evaljs(locOf)
    report('حركة الانزلاق لا تعطل الطابور: 8 نقرات سريعة تُطبق كلها',
      aloc1 !== aloc0 && !drained.busy && drained.pending === 0,
      `${aloc0} → ${aloc1} queue=${JSON.stringify(drained)}`)

    // ---------- 8) التمرير التلقائي ----------
    await evaljs(openSettingsBtn)
    await sleep(400)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-tab-control]')?.click(); return 1 })()`)
    await sleep(300)
    await evaljs(`(() => {
      const el = document.querySelector('[data-testid=moon-autoscroll-toggle]')
      el?.click()
      return !!el
    })()`)
    await sleep(300)
    const sloc0 = await evaljs(locOf)
    // سرعة 3 ≈ كل 6.5 ثوانٍ — ننتظر حتى 12 ثانية حتى يحدث أول قلب
    let sloc1 = sloc0
    for (let i = 0; i < 24 && sloc1 === sloc0; i++) { await sleep(500); sloc1 = await evaljs(locOf) }
    const pillStop = await evaljs(`!!document.querySelector('[data-testid=moon-autoscroll-pill]')`)
    await evaljs(`(() => { document.querySelector('[data-testid=moon-autoscroll-pill]')?.click(); return 1 })()`)
    await sleep(400)
    const sloc2 = await evaljs(locOf)
    const pillGone = await evaljs(`!document.querySelector('[data-testid=moon-autoscroll-pill]')`)
    report('التمرير التلقائي يقلب الصفحات وقرص الإيقاف يوقفه',
      sloc1 !== sloc0 && pillStop && pillGone && sloc2 === sloc1,
      `${sloc0} → ${sloc1} → ${sloc2} pill=${pillStop}→gone=${pillGone}`)
    await evaljs(`(() => { [...document.querySelectorAll('[data-testid=moon-sheet] button')].find((b) => b.getAttribute('aria-label') === 'إغلاق')?.click(); return 1 })()`)
    await sleep(300)

    // ---------- 9) فعل مركز الصفحة = لوحة الإعدادات ----------
    // نضبط التفضيل أولًا عبر قاعدة البيانات ثم نعيد فتح القارئ ليُحمّلها
    await evaljs(`(async () => {
      const cur = JSON.parse(await window.api.getSetting('reader.mobile') || '{}')
      cur.centerAction = 'settings'
      await window.api.setSetting('reader.mobile', JSON.stringify(cur))
      return 1
    })()`)
    await backToLibrary()
    await openCardById(epubA)
    await waitEpubReady()
    await evaljs(`(() => {
      const fr = [...document.querySelectorAll('iframe')].filter((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
      const vis = fr.find((x) => { const r = x.getBoundingClientRect(); return r.width > 100 })
      const d = vis.contentDocument
      const w = d.defaultView.innerWidth || 600
      d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: w / 2, clientY: 200 }))
      return 1
    })()`)
    await sleep(600)
    const sheetByCenter = await evaljs(`!!document.querySelector('[data-testid=moon-sheet]')`)
    // إعادة الضبط إلى «وضع صافٍ» وإعادة الفتح لاستعادة القيم الافتراضية
    await evaljs(`(async () => {
      const cur = JSON.parse(await window.api.getSetting('reader.mobile') || '{}')
      cur.centerAction = 'zen'
      await window.api.setSetting('reader.mobile', JSON.stringify(cur))
      return 1
    })()`)
    report('فعل مركز الصفحة = فتح لوحة الإعدادات (الاختيار يعمل)',
      sheetByCenter, `sheet=${sheetByCenter}`)

    // ---------- 10) شريط التنقل السفلي قابل للإخفاء ----------
    const footerOn = await evaljs(`!!document.querySelector('footer')`)
    await evaljs(`(async () => {
      const cur = JSON.parse(await window.api.getSetting('reader.mobile') || '{}')
      cur.bottomBar = false
      await window.api.setSetting('reader.mobile', JSON.stringify(cur))
      return 1
    })()`)
    // التفضيلات تُقرأ عند فتح القارئ — نعيد الفتح
    await backToLibrary()
    await openCardById(epubA)
    await waitEpubReady()
    const footerOff = await evaljs(`!document.querySelector('footer')`)
    await evaljs(`(async () => {
      const cur = JSON.parse(await window.api.getSetting('reader.mobile') || '{}')
      cur.bottomBar = true
      await window.api.setSetting('reader.mobile', JSON.stringify(cur))
      return 1
    })()`)
    report('شريط التنقل السفلي: يُخفى ويُعاد من إعدادات التحكم',
      footerOn && footerOff, `on=${footerOn} off=${footerOff}`)
    await backToLibrary()

    // ---------- 11) سطح المكتب لم يتغير ----------
    await evaljs(`(() => { window.__mkForceMobile = false; window.__mkForceTapZones = false; return 1 })()`)
    await openCardById(epubA)
    await waitEpubReady()
    const deskTitle = await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => (b.title || '').includes('خيارات العرض'))
      btn?.click()
      return btn?.title ?? null
    })()`)
    await sleep(500)
    const deskDrawer = await evaljs(`(() => ({
      moon: !!document.querySelector('[data-testid=moon-sheet]'),
      drawer: [...document.querySelectorAll('div')].some((d) => d.className?.includes?.('md:absolute md:inset-x-auto')),
      dim: !!document.querySelector('[data-testid=moon-dim]'),
      edge: !!document.querySelector('[data-testid=moon-brightness-edge]'),
      status: !!document.querySelector('[data-testid=moon-statusbar]')
    }))()`)
    report('سطح المكتب كما هو: لوحة عائمة قديمة وبلا مكونات الجوال',
      deskTitle?.includes('خيارات العرض') && deskDrawer.drawer && !deskDrawer.moon && !deskDrawer.dim && !deskDrawer.edge && !deskDrawer.status,
      `title=${deskTitle} ${JSON.stringify(deskDrawer)}`)

    // ---------- 12) صفر أخطاء صفحة ----------
    report('صفر أخطاء صفحة خلال الجلسة', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

    const ok = results.every((r) => r.ok)
    console.log(ok ? '\n✅ جميع اختبارات v2.6 ناجحة' : '\n❌ توجد اختبارات فاشلة')
    process.exitCode = ok ? 0 : 1
  } finally {
    try { electron.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('✗ فشل السكربت:', e); process.exit(1) })
