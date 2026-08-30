/** تشخيص: لمس الحافة في EPUB — هل next() يعمل؟ */
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

  // فتح EPUB (بانتظار البطاقات)
  let opened = false
  for (let i = 0; i < 25 && !opened; i++) {
    await sleep(600)
    opened = await evaljs(`(async () => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      if (!cards.length) return false
      const books = await window.api.listBooks()
      const b = books.find((x) => x.format === 'epub')
      if (!b) return false
      const card = cards.find((c) => c.textContent.includes(b.title))
      card?.click()
      return !!card
    })()`).catch(() => false)
  }
  await sleep(2500)

  await evaljs(`(() => { window.__mkForceTapZones = true; window.__mkForceMobile = true; return 1 })()`)
  const label = `(() => {
    const h = document.querySelector('header')
    const span = h ? [...h.querySelectorAll('span')].find((s) => /^\\d+%$/.test(s.textContent.trim())) : null
    return span ? span.textContent.trim() : null
  })()`
  console.log('before label:', await evaljs(label))
  console.log('flowInfo:', JSON.stringify(await evaljs(`window.__epubFlowInfo?.() ?? null`)))

  // لمس الحافة اليسرى (RTL = التالي)
  const r1 = await evaljs(`(() => {
    const f = [...document.querySelectorAll('iframe')].find((x) => { try { return !!(x.contentDocument?.body?.children.length) } catch { return false } })
    if (!f) return 'no-frame'
    const d = f.contentDocument
    d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 120 }))
    return 'dispatched'
  })()`)
  console.log('edge tap:', r1)
  for (let i = 0; i < 6; i++) {
    await sleep(400)
    console.log('after', i, await evaljs(label))
  }
  electron.kill('SIGKILL')
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
