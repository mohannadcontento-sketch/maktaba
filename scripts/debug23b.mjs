import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.rmSync(path.join(process.env.HOME, '.config', 'maktaba'), { recursive: true, force: true })
  const electron = spawn(path.join(REPO, 'node_modules/electron/dist/electron'), ['.', '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, MAKTABA_TEST: '1', DISPLAY: process.env.DISPLAY ?? ':77' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  let idc = 0
  let ready = false
  const rl = readline.createInterface({ input: electron.stdout })
  rl.on('line', (line) => {
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { ready = true; return }
    if (line.includes('RENDERER-LOG:') || line.includes('RENDERER:')) console.log('>>', line.slice(0, 300))
    try {
      const m = JSON.parse(line)
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    } catch {}
  })
  const evaljs = (expr, t = 30000) => new Promise((resolve, reject) => {
    const id = ++idc
    const to = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, t)
    pending.set(id, (m) => { clearTimeout(to); m.error ? reject(new Error(m.error)) : resolve(m.value) })
    electron.stdin.write(JSON.stringify({ id, expr }) + '\n')
  })
  const t0 = Date.now()
  while (!ready && Date.now() - t0 < 30000) await sleep(300)
  for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

  await evaljs(`(async () => (await window.api.importPaths([${JSON.stringify(EPUB_SAMPLE)}])).length)()`, 45000)
  await evaljs('location.reload()')
  await sleep(2500)
  await evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'EPUB'))?.click()
    return 1
  })()`)
  await sleep(4500)

  console.log('--- flow before:', await evaljs(`(() => JSON.stringify(window.__epubFlowInfo?.() ?? null))()`))
  // switch to scrolled
  await evaljs(`(() => {
    [...document.querySelectorAll('header button')].find((b) => b.title === 'خيارات العرض')?.click()
    return 1
  })()`)
  await sleep(400)
  const clicked = await evaljs(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'تمرير متصل')
    btn?.click()
    return !!btn
  })()`)
  console.log('clicked scrolled btn:', clicked)
  await sleep(5000)
  console.log('--- flow after:', await evaljs(`(() => JSON.stringify({
    info: window.__epubFlowInfo?.() ?? null,
    failedText: [...document.querySelectorAll('p')].some((p) => p.textContent === 'تعذر فتح هذا الكتاب'),
    iframes: document.querySelectorAll('iframe').length,
    container: !!document.querySelector('.epub-container')
  }))()`))
  electron.kill('SIGKILL')
  process.exit(0)
}
main()
