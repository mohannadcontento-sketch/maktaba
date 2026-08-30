/**
 * اختبارات النسخة 2.3.1 — إصلاح CSP + حارس الإقلاع:
 *  1) CSP يتضمن wasm-unsafe-eval و img-src https: (صور الأغلفة من الإنترنت)
 *  2) التطبيق يقلع وينتهي bootGuard (لا شاشة سوداء/بطاقة عالقة)
 *  3) حجب CSP للصور (img-src) بعد الإقلاع ← لا بطاقة خطأ قاتلة (كانت سبب «الجوال لا يفتح»)
 *  4) خطأ ResizeObserver loop الحميد ← لا بطاقة خطأ (كانت تظهر على ويندوز في منتقي الأغلفة)
 *  5) صورة https حقيقية تُحمَّل دون أي securitypolicyviolation
 *  6) أثناء الإقلاع: حجب script-src يظل قاتلًا (سلوك التشخيص محفوظ لأخطاء الإقلاع الحقيقية)
 *  7) صفر أخطاء صفحة خلال الجلسة
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  fs.rmSync(path.join(process.env.HOME, '.config', 'maktaba'), { recursive: true, force: true })

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
  // حدث CSP اصطناعي — نفس ما يطلقه كروميوم عند حجب مورد
  const fireViolation = (directive, uri) => evaljs(`(() => {
    const ev = new Event('securitypolicyviolation')
    ev.violatedDirective = ${JSON.stringify(directive)}
    ev.effectiveDirective = ${JSON.stringify(directive)}
    ev.blockedURI = ${JSON.stringify(uri)}
    ev.sourceFile = 'test'
    ev.lineNumber = 0
    window.dispatchEvent(ev)
    return 1
  })()`)

  try {
    const t0 = Date.now()
    while (!ready && Date.now() - t0 < 30000) await sleep(400)
    for (let i = 0; i < 25; i++) { try { if (await evaljs('!!window.api?.listBooks', 3000)) break } catch {} await sleep(400) }

    // 1) رأس CSP في الصفحة الفعلية
    const csp = await evaljs(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ''`)
    report('CSP يسمح بـ WASM (wasm-unsafe-eval)', csp.includes('wasm-unsafe-eval'))
    report('CSP img-src يسمح بصور الإنترنت (https:)', /img-src[^;]*https:/.test(csp))
    report('CSP connect-src يسمح https', /connect-src[^;]*https:/.test(csp))

    // 2) الإقلاع اكتمل: bootGuard اختفى والتطبيق يعمل
    await sleep(800)
    const bootGone = await evaljs(`!document.getElementById('bootGuard') && !!document.querySelector('#root *')`)
    report('الإقلاع اكتمل وبطاقة البداية اختفت', !!bootGone)

    // 3) حجب img-src بعد الإقلاع ← لا بطاقة قاتلة (سيناريو الجوال الحقيقي)
    await fireViolation('img-src', 'https://tse1.mm.bing.net/th/id/OIP.test?pid=Api')
    await sleep(400)
    const noCardAfterImg = await evaljs(`!document.getElementById('bootGuard')`)
    report('حجب img-src لا يعرض شاشة خطأ بعد الإقلاع', !!noCardAfterImg)

    // 4) خطأ ResizeObserver الحميد ← لا بطاقة (سيناريو ويندوز في منتقي الأغلفة)
    await evaljs(`window.onerror('ResizeObserver loop completed with undelivered notifications.', 'file:///x/out/renderer/index.html', 0, 0, undefined)`)
    await sleep(300)
    const noCardAfterRO = await evaljs(`!document.getElementById('bootGuard')`)
    report('خطأ ResizeObserver الحميد لا يعرض شاشة خطأ', !!noCardAfterRO)

    // 5) صورة https حقيقية تُحمَّل بلا أي حجب CSP
    const imgProbe = await evaljs(`(async () => {
      let violated = false
      const onV = (e) => { if ((e.violatedDirective || e.effectiveDirective) === 'img-src') violated = true }
      window.addEventListener('securitypolicyviolation', onV)
      const loaded = await new Promise((res) => {
        const img = new Image()
        img.onload = () => res(img.naturalWidth > 0)
        img.onerror = () => res(false)
        img.src = 'https://icons.duckduckgo.com/ip3/wikipedia.org.ico'
        setTimeout(() => res(false), 8000)
      })
      window.removeEventListener('securitypolicyviolation', onV)
      return { loaded, violated }
    })()`, 15000)
    report('صورة https حقيقية بلا حجب CSP', imgProbe && imgProbe.violated === false,
      imgProbe && imgProbe.loaded ? 'حُمّلت فعليًا' : 'الشبكة محجوبة هنا — لا حجب CSP على أي حال')

    // 6) أثناء الإقلاع: حجب script-src يظل قاتلًا — نعيد حقن الحارس (إقلاع جديد)
    await evaljs(`(() => {
      const s = document.createElement('script')
      s.src = './bootGuard.js'
      document.head.appendChild(s)
      return 1
    })()`)
    await sleep(300)
    await fireViolation('script-src', 'https://evil.example/x.js')
    await sleep(300)
    const fatalShown = await evaljs(`(() => {
      const g = document.getElementById('bootGuard')
      return !!g && g.textContent.includes('CSP') && g.textContent.includes('script-src')
    })()`)
    report('حجب script-src أثناء الإقلاع يظل قاتلًا (تشخيص محفوظ)', !!fatalShown)

    // 7) أخطاء صفحة
    report('صفر أخطاء صفحة خلال الجلسة', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

    const ok = results.every((r) => r.ok)
    console.log(ok ? '\n✅ جميع اختبارات v2.3.1 ناجحة' : '\n❌ توجد اختبارات فاشلة')
    process.exitCode = ok ? 0 : 1
  } finally {
    try { electron.kill('SIGKILL') } catch {}
  }
}

main().catch((e) => { console.error('✗ فشل السكربت:', e); process.exit(1) })
