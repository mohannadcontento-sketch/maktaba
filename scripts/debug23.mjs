import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  fs.rmSync(path.join(process.env.HOME, '.config', 'maktaba'), { recursive: true, force: true })
  const electron = spawn(path.join(REPO, 'node_modules/electron/dist/electron'), ['.', '--no-sandbox', '--enable-logging'], {
    cwd: REPO, env: { ...process.env, MAKTABA_TEST: '1', DISPLAY: process.env.DISPLAY ?? ':77' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  let idc = 0
  let ready = false
  const rl = readline.createInterface({ input: electron.stdout })
  rl.on('line', (line) => {
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { ready = true; return }
    if (line.includes('console') || line.toLowerCase().includes('error') || line.includes('RENDERER')) console.log('OUT:', line.slice(0, 400))
    try {
      const m = JSON.parse(line)
      if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    } catch {}
  })
  electron.stderr.on('data', (d) => {
    const s = d.toString()
    if (s.includes('ERROR') || s.includes('CONSOLE')) console.log('ERR:', s.slice(0, 400))
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

  const imported = await evaljs(`(async () => {
    const added = await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE])})
    return added.length
  })()`, 45000)
  console.log('imported:', imported)
  await sleep(500)

  const probe = await evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    return { n: cards.length, labels: cards.slice(0,4).map((c) => [...c.querySelectorAll('span')].map((s) => s.textContent).join('|')).slice(0, 3) }
  })()`)
  console.log('cards:', JSON.stringify(probe))

  await evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))?.click()
    return 1
  })()`)
  await sleep(4500)

  const state = await evaljs(`(() => {
    const header = document.querySelector('header')
    return {
      headerText: header?.textContent?.slice(0, 120) ?? null,
      hasIframe: !!document.querySelector('iframe'),
      pageInput: !!document.querySelector('input[title*="رقم الصفحة"]'),
      toolbars: [...document.querySelectorAll('div')].filter((d) => d.textContent?.includes('الصفحة التالية')).length,
      rootChildren: document.getElementById('root')?.children.length ?? 0
    }
  })()`)
  console.log('state:', JSON.stringify(state))
  electron.kill('SIGKILL')
  process.exit(0)
}
main()
