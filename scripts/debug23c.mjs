import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
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

  await evaljs(`(async () => (await window.api.importPaths([${JSON.stringify(PDF_SAMPLE)}])).length)()`, 45000)
  await evaljs('location.reload()')
  await sleep(2500)
  await evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))?.click()
    return 1
  })()`)
  await sleep(4000)

  const probe = await evaljs(`(() => {
    const zin = [...document.querySelectorAll('button[title="تكبير"]')]
    const label = [...document.querySelectorAll('button')].find((b) => b.title === 'إرجاع التكبير إلى 100%')
    const fitW = [...document.querySelectorAll('button[title="ملاءمة العرض"]')]
    return {
      zoomInCount: zin.length,
      inToolbar: zin[0]?.closest('div')?.className?.includes('shrink-0') ?? null,
      labelText: label?.textContent ?? null,
      fitWCount: fitW.length,
      fitWActive: fitW[0]?.className?.includes('accent') ?? null
    }
  })()`)
  console.log('probe:', JSON.stringify(probe))

  await evaljs(`(() => { document.querySelector('button[title="تكبير"]')?.click(); return 1 })()`)
  await sleep(600)
  const after1 = await evaljs(`(() => {
    const label = [...document.querySelectorAll('button')].find((b) => b.title === 'إرجاع التكبير إلى 100%')
    const fitW = [...document.querySelectorAll('button[title="ملاءمة العرض"]')]
    return { labelText: label?.textContent ?? null, fitWActive: fitW[0]?.className?.includes('accent') ?? null }
  })()`)
  console.log('after zoom-in:', JSON.stringify(after1))
  electron.kill('SIGKILL')
  process.exit(0)
}
main()
