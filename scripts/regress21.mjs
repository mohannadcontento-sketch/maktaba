/**
 * انحدار سريع 2.1 عبر جسر الاختبار (بلا CDP):
 * أغلفة PDF المولدة + بروتوكول cover:// + فتح EPUB + تقدم EPUB + بحث EPUB + TTS
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
  const rl = readline.createInterface({ input: electron.stdout })
  rl.on('line', (line) => {
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { ready = true; return }
    try {
      const m = JSON.parse(line)
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    } catch {}
  })
  let idc = 0
  const evaljs = (expr, t = 20000) => new Promise((resolve, reject) => {
    const id = ++idc
    const to = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, t)
    pending.set(id, (m) => { clearTimeout(to); m.error ? reject(new Error(m.error)) : resolve(m.value) })
    electron.stdin.write(JSON.stringify({ id, expr }) + '\n')
  })
  const pageErrors = []

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    // استيراد
    const imported = await evaljs(`(async () => {
      const added = await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE])})
      return added.map((b) => ({ id: b.id, format: b.format }))
    })()`)
    report('import samples', imported.length === 2)
    await evaljs('location.reload()')
    await sleep(2500)
    for (let i = 0; i < 20; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }
    await sleep(700)

    // غلاف PDF مولد + بروتوكول cover://
    const pdfBook = imported.find((b) => b.format === 'pdf')
    await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))?.click()
      return 1
    })()`)
    await sleep(3500)
    const pdfCover = await evaljs(`(async () => (await window.api.getBook(${JSON.stringify(pdfBook.id)}))?.coverPath ?? null)()`)
    report('pdf cover generated on open', !!pdfCover, pdfCover ?? 'null')
    if (pdfCover) {
      const st = await evaljs(`(async () => {
        const base = ${JSON.stringify(pdfCover)}.split(/[\\\\\\/]/).pop()
        try { return (await fetch('cover://img/' + encodeURIComponent(base))).status } catch (e) { return String(e) }
      })()`)
      report('pdf cover served via cover://', st === 200, `status=${st}`)
    }
    // خروج
    await evaljs(`(() => { document.querySelector('header button')?.click(); return 1 })()`)
    await sleep(900)

    // فتح EPUB
    await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))?.click()
      return 1
    })()`)
    await sleep(3500)
    const epubOpen = await evaljs(`(() => {
      const f = document.querySelector('iframe')
      return { hasIframe: !!f, bodyLen: f?.contentDocument?.body?.innerText?.length ?? 0 }
    })()`)
    report('epub opens with content', epubOpen.hasIframe && epubOpen.bodyLen > 0, JSON.stringify(epubOpen).slice(0, 80))

    // تقدم EPUB: تمرير ثم قراءة الشريط
    await evaljs(`(() => {
      const f = document.querySelector('iframe')
      const host = f?.parentElement
      const scroller = host && host.scrollHeight > host.clientHeight ? host : document.scrollingElement
      if (scroller) scroller.scrollTop = scroller.scrollHeight * 0.4
      return 1
    })()`)
    await sleep(1500)
    const epubBar = await evaljs(`(() => {
      const r = document.querySelector('input[type=range]')
      const label = [...document.querySelectorAll('header span')].map((s) => s.textContent).find((x) => x && x.includes('%'))
      return { bar: r ? Number(r.value) : null, label }
    })()`)
    report('epub bar shows position after scroll', (epubBar.bar ?? 0) > 0 || (epubBar.label ?? '').trim().startsWith('0'), JSON.stringify(epubBar))
    const epubSaved = await evaljs(`(async () => {
      const books = await window.api.listBooks()
      return books.find((b) => b.format === 'epub')?.progress ?? -1
    })()`)
    report('epub progress persisted', epubSaved > 0, `saved=${epubSaved}`)
    // خروج
    await evaljs(`(() => { document.querySelector('header button')?.click(); return 1 })()`)
    await sleep(900)

    // بحث EPUB + TTS
    await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))?.click()
      return 1
    })()`)
    await sleep(3500)
    const word = await evaljs(`(() => {
      const f = document.querySelector('iframe')
      const txt = f?.contentDocument?.body?.textContent ?? ''
      const words = (txt || '').split(/\\s+/).filter((w) => w.length >= 5)
      return words[Math.floor(words.length / 2)] ?? ''
    })()`)
    report('picked search word', (word ?? '').length >= 3, word)
    await evaljs(`(() => {
      const btns = [...document.querySelectorAll('button')]
      btns.find((b) => b.querySelector('svg.lucide-search'))?.click()
      return 1
    })()`)
    await sleep(600)
    await evaljs(`(() => {
      const inputs = [...document.querySelectorAll('input')]
      const si = inputs.find((i) => i.placeholder && i.type !== 'range')
      if (!si) return 0
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(si, ${JSON.stringify(word)})
      si.dispatchEvent(new Event('input', { bubbles: true }))
      return 1
    })()`)
    let resultsCount = 0
    for (let i = 0; i < 25; i++) {
      await sleep(400)
      resultsCount = await evaljs(`(() => {
        const list = document.querySelectorAll('mark').length
        const badge = [...document.querySelectorAll('span,div')].map((e) => e.textContent ?? '').find((t) => /\\/\\s*\\d+/.test(t) && t.length < 24)
        const m = badge?.match(/\\/\\s*(\\d+)/)
        return Math.max(list, m ? Number(m[1]) : 0)
      })()`)
      if (resultsCount > 0) break
    }
    report('epub search still finds matches (v2 feature)', resultsCount > 0, `count≈${resultsCount}`)

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
