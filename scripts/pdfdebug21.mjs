/** تشخيص إعادة الفتح: تتبع scrollTop بعد استعادة الموضع */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const PDF_SAMPLE = path.join(REPO, 'samples', 'sample-book.pdf')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.rmSync(path.join(process.env.HOME, '.config', 'maktaba'), { recursive: true, force: true })
  const electron = spawn(path.join(REPO, 'node_modules/electron/dist/electron'), ['.', '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, MAKTABA_TEST: '1', DISPLAY: process.env.DISPLAY ?? ':77' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  let ready = false
  const pending = new Map()
  const rl = readline.createInterface({ input: electron.stdout })
  rl.on('line', (line) => {
    if (line.includes('RENDERER:')) console.log(line.trim())
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { ready = true; return }
    try {
      const m = JSON.parse(line)
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    } catch {}
  })
  let idc = 0
  const evaljs = (expr, t = 15000) => new Promise((resolve, reject) => {
    const id = ++idc
    const to = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, t)
    pending.set(id, (m) => { clearTimeout(to); m.error ? reject(new Error(m.error)) : resolve(m.value) })
    electron.stdin.write(JSON.stringify({ id, expr }) + '\n')
  })
  const openPdf = () => evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    const card = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))
    card?.click(); return !!card
  })()`)

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }
    await evaljs(`(async()=>{ await window.api.importPaths([${JSON.stringify(PDF_SAMPLE)}]); return 1 })()`)
    await evaljs('location.reload()')
    await sleep(2500)
    for (let i = 0; i < 20; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }
    await sleep(600)

    // افتح وامسح للصفحة 4
    await openPdf()
    await sleep(3500)
    await evaljs(`(() => {
      const els = [...document.querySelectorAll('[data-pdf-page]')]
      const el = els[3]
      const container = els[0]?.parentElement?.parentElement
      if (el && container) container.scrollTop = el.offsetTop - (container.clientHeight - el.clientHeight) / 2
      return true
    })()`)
    await sleep(1800)
    const saved1 = await evaljs(`(async()=> (await window.api.listBooks())[0].progress)()`)
    console.log('saved after scroll to p4:', saved1)

    // أغلق ثم أعد الفتح
    await evaljs(`(() => { document.querySelector('header button')?.click(); return 1 })()`)
    await sleep(1200)
    const cardText = await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const card = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))
      return card ? card.textContent.slice(0, 120) : 'no card'
    })()`)
    console.log('CARD TEXT (progress shown?):', cardText)
    await openPdf()

    // تتبع لحظي
    for (let i = 0; i < 20; i++) {
      const s = await evaljs(`(() => {
        const els = [...document.querySelectorAll('[data-pdf-page]')]
        if (!els.length) return { pages: 0 }
        const container = els[0]?.parentElement?.parentElement
        const center = container.scrollTop + container.clientHeight / 2
        let p = 1
        els.forEach((el, j) => { if (el.offsetTop <= center) p = j + 1 })
        return { pages: els.length, scrollTop: Math.round(container.scrollTop), domPage: p }
      })()`, 4000).catch((e) => ({ err: String(e) }))
      console.log(`t=${i * 300}ms`, JSON.stringify(s))
      await sleep(300)
    }
    const saved2 = await evaljs(`(async()=> (await window.api.listBooks())[0].progress)()`)
    console.log('final saved progress:', saved2)
  } catch (e) {
    console.log('DEBUG ERR:', String(e))
  } finally {
    try { electron.kill('SIGKILL') } catch {}
    try { require('node:child_process').execSync('pkill -9 -f electron 2>/dev/null || true') } catch {}
  }
  process.exit(0)
}
main()
