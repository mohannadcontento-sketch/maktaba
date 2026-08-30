/**
 * اختبارات النسخة 2.3 عبر جسر الاختبار:
 *  1) حارس الإقلاع: شاشة البداية تختفي بعد الرندر (لا شاشة سوداء) + لا أخطاء صفحة
 *  2) شريط أدوات PDF السفلي (أكروبات): تنقل صفحات + قفزة لرقم صفحة + تكبير بنسبة فعلية
 *  3) مصغرات PDF: زر المصغرات يرسم شبكة صفحات قابلة للنقر
 *  4) EPUB: المحاذاة تُطبق فعلًا على فقرات الكتاب (يمين/وسط)
 *  5) EPUB: الهوامش تعيد تخطيط النص (عرض منطقة النص يتقلص — النص يلتف مثل الورد)
 *  6) EPUB: وضع التمرير المتصل = مدير continuous — الكتاب كله تحت بعضه
 *  7) العودة لوضع الصفحات تعمل بعد التمرير المتصل (إعادة بناء القارئ)
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
    pending.set(id, (m) => { clearTimeout(to); m.error ? reject(new Error(m.error)) : resolve(m.value) })
    electron.stdin.write(JSON.stringify({ id, expr }) + '\n')
  })

  const openCard = (label) => evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === ${JSON.stringify(label)}))?.click()
    return 1
  })()`)

  const goBack = () => evaljs(`(() => {
    const btn = document.querySelector('header button')
    btn?.click()
    return 1
  })()`)

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    const imported = await evaljs(`(async () => {
      const added = await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE])})
      return added.map((b) => ({ id: b.id, format: b.format, title: b.title }))
    })()`, 45000)
    report('import samples', imported.length === 2)
    // إعادة تحميل كي يقرأ المتجر الكتب المستوردة من قاعدة البيانات
    await evaljs('location.reload()')
    await sleep(2500)
    for (let i = 0; i < 20; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }
    await sleep(700)

    // 1) حارس الإقلاع: يجب أن تكون شاشة البداية قد اختفت بعد الرندر
    const bootState = await evaljs(`(() => ({
      guardGone: !document.getElementById('bootGuard'),
      guardApi: typeof window.__mkBoot === 'function' || !!window.__mkBoot,
      hasHasOwn: typeof Object.hasOwn === 'function' && Object.hasOwn({ a: 1 }, 'a')
    }))()`)
    report('boot splash removed after render (no black screen)', bootState.guardGone === true, JSON.stringify(bootState))
    report('polyfills active (Object.hasOwn)', bootState.hasHasOwn === true)

    // 2) شريط أدوات PDF السفلي — افتح الكتاب
    await openCard('PDF')
    await sleep(4000)
    const bar1 = await evaljs(`(() => {
      const pageInput = document.querySelector('input[title*="رقم الصفحة"]')
      const slider = [...document.querySelectorAll('input[type="range"]')].pop()
      return {
        hasInput: !!pageInput,
        page: pageInput?.placeholder ?? null,
        slider: !!slider,
        total: pageInput?.parentElement?.textContent?.match(/\\/(\\s*)(\\d+)/)?.[2] ?? null,
        zoom: [...document.querySelectorAll('button')].find((b) => b.title === 'إرجاع التكبير إلى 100%')?.textContent ?? null
      }
    })()`)
    report('pdf acrobat toolbar exists (page input + progress + zoom)', bar1.hasInput && bar1.slider && bar1.zoom !== null, JSON.stringify(bar1))

    // التالي → الصفحة 2
    await evaljs(`(() => { document.querySelector('button[title="الصفحة التالية"]')?.click(); return 1 })()`)
    await sleep(1100)
    const afterNext = await evaljs(`(() => document.querySelector('input[title*="رقم الصفحة"]')?.placeholder ?? null)()`)
    report('pdf next-page button advances to page 2', afterNext === '2', `placeholder=${afterNext}`)

    // قفزة إلى الصفحة 1 عبر الإدخال
    await evaljs(`(() => {
      const inp = document.querySelector('input[title*="رقم الصفحة"]')
      if (!inp) return 0
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      inp.focus()
      setter.call(inp, '1')
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.blur()
      return 1
    })()`)
    await sleep(1100)
    const afterJump = await evaljs(`(() => document.querySelector('input[title*="رقم الصفحة"]')?.placeholder ?? null)()`)
    report('pdf page-number jump works', afterJump === '1', `placeholder=${afterJump}`)

    // التكبير: نسبة مطلقة من الحجم الأصلي — +10% على الفعلي
    const zoomBefore = await evaljs(`(() => [...document.querySelectorAll('button')].find((b) => b.title === 'إرجاع التكبير إلى 100%')?.textContent ?? null)()`)
    await evaljs(`(() => { document.querySelector('button[title="تكبير القراءة"]')?.click(); return 1 })()`)
    await sleep(700)
    const zoomAfter = await evaljs(`(() => [...document.querySelectorAll('button')].find((b) => b.title === 'إرجاع التكبير إلى 100%')?.textContent ?? null)()`)
    report('pdf zoom +10% from effective scale', !!zoomBefore && !!zoomAfter && zoomBefore !== zoomAfter, `${zoomBefore} → ${zoomAfter}`)

    // 3) المصغرات
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) => b.title === 'المصغرات')
      btn?.click()
      return 1
    })()`)
    let thumbs = 0
    for (let i = 0; i < 12; i++) {
      await sleep(700)
      thumbs = await evaljs(`(() => document.querySelectorAll('aside img').length)()`)
      if (thumbs > 0) break
    }
    report('pdf thumbnails grid renders', thumbs > 0, `imgs=${thumbs}`)
    await evaljs(`(() => { [...document.querySelectorAll('header button')].find((b) => b.title === 'المصغرات')?.click(); return 1 })()`)
    await sleep(300)
    await goBack()
    await sleep(1200)

    // 4) EPUB: المحاذاة
    await openCard('EPUB')
    await sleep(4000)
    await evaljs(`(() => {
      [...document.querySelectorAll('header button')].find((b) => b.title === 'خيارات العرض')?.click()
      return 1
    })()`)
    await sleep(500)
    const setAlign = async (label) => {
      await evaljs(`(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === ${JSON.stringify(label)})
        btn?.click()
        return 1
      })()`)
      await sleep(900)
    }
    const alignOf = () => evaljs(`(() => {
      const iframe = document.querySelector('iframe')
      const p = iframe?.contentDocument?.querySelector('p, div, li')
      return p ? getComputedStyle(p).textAlign : null
    })()`)
    await setAlign('يمين')
    const a1 = await alignOf()
    await setAlign('وسط')
    const a2 = await alignOf()
    report('epub alignment applies to book text (right)', a1 === 'right', `got=${a1}`)
    report('epub alignment applies to book text (center)', a2 === 'center', `got=${a2}`)

    // 5) الهوامش تعيد تخطيط النص — تقليل الهوامش يزيد عرض منطقة النص (وإعادة التخطيط تحدث)
    const viewerWidth = () => evaljs(`(() => {
      const iframe = document.querySelector('iframe')
      return iframe ? Math.round(iframe.parentElement.getBoundingClientRect().width) : null
    })()`)
    // الإعداد الافتراضي: يمين/يسار 6% — سنخفض اليسار إلى 0
    const before = await viewerWidth()
    await evaljs(`(() => {
      const sliders = [...document.querySelectorAll('input[type="range"]')]
      const ml = sliders[3] // 0 حجم الخط، 1 تباعد، 2 يمين، 3 يسار
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(ml, '0')
      ml.dispatchEvent(new Event('input', { bubbles: true }))
      ml.dispatchEvent(new Event('change', { bubbles: true }))
      return 1
    })()`)
    await sleep(2200)
    const after = await viewerWidth()
    report('epub margin change reflows text area (viewer widens)', !!before && !!after && after > before + 10, `before=${before} after=${after}`)
    await evaljs(`(() => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('إعادة الضبط'))?.click()
      return 1
    })()`)
    await sleep(800)

    // 6) وضع التمرير المتصل = مدير continuous
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'تمرير متصل')
      btn?.click()
      return 1
    })()`)
    let cont = null
    for (let i = 0; i < 30; i++) {
      await sleep(700)
      cont = await evaljs(`(() => {
        const info = window.__epubFlowInfo?.() ?? null
        const c = document.querySelector('.epub-container')
        return { info, scrollable: !!c && c.scrollHeight > c.clientHeight * 1.5 }
      })()`)
      if (cont.info?.ready && cont.info?.continuous === true) break
    }
    report('epub scroll mode switches to continuous manager', cont?.info?.flow === 'scrolled' && cont?.info?.continuous === true && cont?.info?.ready === true, JSON.stringify(cont))

    // 7) العودة لوضع الصفحات (إعادة بناء القارئ) — افتح الدرج إن كان مغلقًا
    await evaljs(`(() => {
      let btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'صفحات')
      if (!btn) {
        ;[...document.querySelectorAll('header button')].find((b) => b.title === 'خيارات العرض')?.click()
      }
      return 1
    })()`)
    await sleep(600)
    await evaljs(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'صفحات')
      btn?.click()
      return !!btn
    })()`)
    let back = null
    for (let i = 0; i < 30; i++) {
      await sleep(700)
      back = await evaljs(`(() => window.__epubFlowInfo?.() ?? null)()`)
      if (back?.ready && back?.continuous === false && back?.flow === 'paginated') break
    }
    report('epub back to paginated rebuild works', back?.flow === 'paginated' && back?.continuous === false && back?.ready === true, JSON.stringify(back))

    report('no pageerrors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  } catch (e) {
    report('flow completed', false, String(e))
  } finally {
    try { electron.kill('SIGKILL') } catch {}
    try { require('node:child_process').execSync('pkill -9 -f "electron ." 2>/dev/null || true') } catch {}
    try {
      const d = path.join(process.env.HOME, '.config', 'maktaba')
      for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) fs.rmSync(path.join(d, f), { force: true })
    } catch {}
  }

  const pass = results.filter((r) => r.ok).length
  console.log(`\n=== ${pass}/${results.length} passed ===`)
  process.exit(pass === results.length ? 0 : 1)
}

main()
