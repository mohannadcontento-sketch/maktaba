/**
 * اختبارات ميزات النسخة 2.2 عبر جسر الاختبار:
 *  1) بحث الأغلفة الشبكي (محركات مشتركة — DuckDuckGo يعمل من هنا)
 *  2) استخدام صورة من الويب كغلاف (تنزيل + حفظ + cover://)
 *  3) EPUB: سطح القراءة يملأ الشاشة بلون السمة (بلا حواف رمادية)
 *  4) EPUB: الهوامش تُطبق على منطقة النص (عرض الـ iframe يتبع الهوامش)
 *  5) قراءة النص المحدد فقط: الجسر + شريط القراءة في وضع المحدد ثم تنظيفه
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
    if (line.includes('pageerror:')) pageErrors.push(line.slice(0, 200))
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

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    const imported = await evaljs(`(async () => {
      const added = await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE])})
      return added.map((b) => ({ id: b.id, format: b.format, title: b.title }))
    })()`, 45000)
    report('import samples', imported.length === 2)
    const epubBook = imported.find((b) => b.format === 'epub')

    await evaljs('location.reload()')
    await sleep(2500)
    for (let i = 0; i < 20; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }
    await sleep(700)

    // 1) بحث الأغلفة الشبكي — مهلة واسعة لأن الجلب التلقائي للخلفية يتنافس على الشبكة
    let search = []
    let searchErr = ''
    try {
      search = await evaljs(`(async () => {
        const r = await window.api.searchWebImages('نبوغ أبو العلاء المعري', null)
        return r.slice(0, 6).map((x) => ({ full: x.full, src: x.source }))
      })()`, 90000)
    } catch (e) {
      searchErr = String(e.message).slice(0, 100)
    }
    report('cover web search returns results', search.length > 0, JSON.stringify(search.slice(0, 3)).slice(0, 140) || searchErr)

    // 2) استخدام صورة من النتائج كغلاف (نجرب حتى 3 مرشحين)
    if (search.length) {
      const used = await evaljs(`(async () => {
        const cands = ${JSON.stringify(search)}
        for (const c of cands.slice(0, 3)) {
          const b = await window.api.useWebImage(${JSON.stringify(epubBook.id)}, c.full)
          if (b?.coverPath) return { ok: true, src: c.src }
        }
        return { ok: false }
      })()`, 60000)
      report('useWebImage saves picked cover', used.ok, JSON.stringify(used))
      const book = await evaljs(`(async () => (await window.api.getBook(${JSON.stringify(epubBook.id)}))?.coverPath ?? null)()`)
      if (book) {
        const st = await evaljs(`(async () => {
          const base = ${JSON.stringify(book)}.split(/[\\\\\\/]/).pop()
          try { return (await fetch('cover://img/' + encodeURIComponent(base))).status } catch (e) { return String(e) }
        })()`)
        report('picked cover served via cover://', st === 200, `status=${st}`)
      }
    } else {
      report('useWebImage saves picked cover', false, 'no search results in this network')
    }

    // 3) فتح EPUB عبر النقر على البطاقة
    await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))?.click()
      return 1
    })()`)
    await sleep(3500)

    const fill = await evaljs(`(() => {
      const iframe = document.querySelector('iframe')
      const main = iframe?.closest('main')
      const root = main?.querySelector(':scope > div')
      if (!root) return null
      return { bg: getComputedStyle(root).backgroundColor, style: (root.getAttribute('style') ?? '').slice(0, 60) }
    })()`)
    report('epub reading surface is theme-colored (fills screen)', fill?.bg === 'rgb(255, 255, 255)', JSON.stringify(fill))

    // 4) الهوامش تُطبق على النص: الافتراضي 6% يمين ويسار → منطقة العرض = عرض الحاوية − الهوامش
    const margins = await evaljs(`(() => {
      const iframe = document.querySelector('iframe')
      const main = iframe?.closest('main')
      const root = main?.querySelector(':scope > div')
      const padded = root?.querySelector(':scope > div')
      const viewer = padded?.querySelector(':scope > div')
      if (!padded || !viewer) return null
      const pw = padded.getBoundingClientRect().width
      const st = getComputedStyle(padded)
      const padL = parseFloat(st.paddingLeft)
      const padR = parseFloat(st.paddingRight)
      const vw = viewer.getBoundingClientRect().width
      return { padL, vw, expect: Math.round(pw - padL - padR) }
    })()`)
    report(
      'margins apply to text area (viewer = container − margins)',
      !!margins && margins.padL > 40 && Math.abs(margins.vw - margins.expect) <= 3,
      JSON.stringify(margins)
    )

    // 5) قراءة النص المحدد فقط
    const selBridge = await evaljs(`(() => {
      window.__maktabaSpeakSelection('هذا نص محدد للقراءة الصوتية')
      return { bridge: typeof window.__maktabaSpeakSelection === 'function' }
    })()`)
    report('selection TTS bridge exists', selBridge.bridge === true)
    const barState = await evaljs(`(() => {
      const bar = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-2xl') && d.textContent.includes('القراءة الصوتية'))
      return { barOpen: !!bar, chip: bar?.textContent?.includes('وضع قراءة التحديد') ?? false, txt: bar?.textContent?.slice(0, 120) ?? null }
    })()`)
    report('tts bar opens with selection mode chip', barState.barOpen && barState.chip, JSON.stringify(barState))
    await sleep(3000)
    const cleared = await evaljs(`(() => {
      const bar = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-2xl') && d.textContent.includes('القراءة الصوتية'))
      return { stillOpen: !!bar, chip: bar?.textContent?.includes('وضع قراءة التحديد') ?? false }
    })()`)
    report('selection mode cleared after finish', !cleared.chip, JSON.stringify(cleared))

    report('no pageerrors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  } catch (e) {
    report('flow completed', false, String(e))
  } finally {
    try { electron.kill('SIGKILL') } catch {}
    try { require('node:child_process').execSync('pkill -9 -f electron 2>/dev/null || true') } catch {}
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
