/** تشخيص: فتح كتاب PDF وعرض حالة iframes وPdfViewer */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
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
    if (line.includes('error') || line.includes('failed')) console.log('LOG:', line.slice(0, 220))
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

  // استيراد مباشر عبر المكتبة ثم فتح من المتجر
  const books = await evaljs(`(async () => {
    let bs = await window.api.listBooks()
    if (!bs.length) {
      await window.api.importPaths(['${REPO}/samples/sample-book.pdf'])
      bs = await window.api.listBooks()
    }
    return bs.map((b) => ({ id: b.id, title: b.title, format: b.format }))
  })()`, 60000)
  console.log('BOOKS:', JSON.stringify(books))

  // فتح عبر استدعاء المتجر مباشرة (بديل نقرة البطاقة)
  const opened = await evaljs(`(async () => {
    const { useReader } = await import('/assets/index-' + 'X') // غير ممكن — نستخدم نقرة البطاقة بدلًا
    return 0
  })()`).catch(() => 0)

  // نقرة بطاقة PDF تحديدًا
  await evaljs(`(() => {
    const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
    const card = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'sample book'))
    card?.click()
    return !!card
  })()`)
  await sleep(6000)
  const state = await evaljs(`(() => {
    const frames = [...document.querySelectorAll('iframe')].map((f) => f.getAttribute('src'))
    const bodyText = document.body.textContent.slice(0, 400)
    return { frames, failed: bodyText.includes('تعذر فتح هذا الكتاب'), header: !!document.querySelector('header'), bodyText }
  })()`)
  console.log('STATE:', JSON.stringify(state))
  electron.kill('SIGKILL')
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
