/** تشخيص EPUB: انتظار البطاقات + النقر + تشخيص iframes */
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const electron = spawn(path.join(REPO, 'node_modules/electron/dist/electron'), ['.', '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, MAKTABA_TEST: '1', DISPLAY: process.env.DISPLAY ?? ':77' }, stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  const rl = readline.createInterface({ input: electron.stdout })
  let ready = false
  rl.on('line', (line) => {
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { ready = true; return }
    if (line.includes('error') || line.includes('failed')) console.log('LOG:', line.slice(0, 200))
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

  const t0 = Date.now()
  while (!ready && Date.now() - t0 < 30000) await sleep(300)
  for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(300) }

  let clicked = null
  for (let i = 0; i < 20; i++) {
    await sleep(600)
    clicked = await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const card = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent.includes('مقدمة في فن')))
      card?.click()
      return { clicked: !!card, total: cards.length }
    })()`)
    if (clicked && clicked.clicked) break
  }
  console.log('CLICK:', JSON.stringify(clicked))

  let flow = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    flow = await evaljs(`(() => {
      const frames = [...document.querySelectorAll('iframe')].map((f) => {
        let access = 'ok'
        let n = -1
        try { n = f.contentDocument?.body?.children.length ?? -1 } catch (e) { access = 'THROW:' + String(e).slice(0, 60) }
        return { src: (f.getAttribute('src') || 'no-src').slice(0, 40), access, n }
      })
      return {
        frames,
        flowInfo: typeof window.__epubFlowInfo === 'function' ? window.__epubFlowInfo() : null,
        failed: document.body.textContent.includes('تعذر فتح')
      }
    })()`).catch((e) => ({ err: String(e).slice(0, 100) }))
    if ((flow.frames && flow.frames.length > 0) || flow.failed) break
  }
  console.log('POLL:', JSON.stringify(flow))
  electron.kill('SIGKILL')
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
