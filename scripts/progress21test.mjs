/**
 * اختبار مركز للنسخة 2.1: اتساق شريط تقدم PDF (شريط = حفظ = استعادة = منزلق)
 * + الآلية الجديدة للبحث عن الأغلفة أونلاين
 *
 * التشغيل: لا يعتمد على CDP/DevTools إطلاقًا (نقطة ws معطلة في الحاوية) —
 * يستخدم جسر MAKTABA-TEST-BRIDGE في main: أوامر JSON عبر stdin تُنفَّذ في الريندرر
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import readline from 'node:readline'

const REPO = '/home/z/my-project/maktaba_repo'
const SAMPLES = path.join(REPO, 'samples')
const PDF_SAMPLE = path.join(SAMPLES, 'sample-book.pdf')
const EPUB_SAMPLE = path.join(SAMPLES, 'عينة-كتاب-عربي.epub')

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // بيانات نظيفة
  fs.rmSync(path.join(process.env.HOME ?? '/home/z', '.config', 'maktaba'), { recursive: true, force: true })

  if (!fs.existsSync(PDF_SAMPLE)) {
    const { execSync } = await import('node:child_process')
    execSync('npm run fixtures', { cwd: REPO, stdio: 'inherit' })
  }

  console.log('launching electron with test bridge…')
  const electron = spawn(
    path.join(REPO, 'node_modules', 'electron', 'dist', 'electron'),
    ['.', '--no-sandbox'],
    {
      cwd: REPO,
      env: { ...process.env, MAKTABA_TEST: '1', DISPLAY: process.env.DISPLAY ?? ':77' },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  let stderrLog = ''
  electron.stderr.on('data', (d) => (stderrLog += d))

  // قارئ سطور stdout: جاهزية + ردود الجسر
  let bridgeReady = false
  let appReady = false
  const pending = new Map()
  const rl = readline.createInterface({ input: electron.stdout })
  rl.on('line', (line) => {
    if (line.includes('MAKTABA-TEST-BRIDGE: ready')) { bridgeReady = true; return }
    if (line.includes('MARK')) console.log('[main]', line.trim())
    try {
      const msg = JSON.parse(line)
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    } catch { /* سطور أخرى */ }
  })

  let idc = 0
  async function evaljs(expr, timeoutMs = 20000) {
    const id = ++idc
    electron.stdin.write(JSON.stringify({ id, expr }) + '\n')
    const res = await new Promise((resolve) => {
      const t = setTimeout(() => { pending.delete(id); resolve({ id, error: 'evaljs timeout' }) }, timeoutMs)
      pending.set(id, (m) => { clearTimeout(t); resolve(m) })
    })
    if (res.error) throw new Error(`evaljs: ${res.error}`)
    return res.value
  }

  const killAll = () => { try { electron.kill('SIGKILL') } catch {} }

  try {
    // انتظار جاهزية التطبيق والجسر
    const t0 = Date.now()
    while ((!bridgeReady || !appReady) && Date.now() - t0 < 60000) {
      if (bridgeReady && !appReady) {
        // نتحقق أن الريندرر حي عبر أمر بسيط
        try {
          const ok = await evaljs('typeof window.api !== "undefined" && !!window.api.listBooks', 5000)
          if (ok) { appReady = true; break }
        } catch { /* الريندرر لم يجهز بعد */ }
        await sleep(700)
      } else await sleep(500)
    }
    if (!appReady) throw new Error('app/test-bridge never became ready')
    report('renderer loaded with window.api (bridge)', true)

    // استيراد العينات
    const imported = await evaljs(`(async () => {
      const added = await window.api.importPaths(${JSON.stringify([PDF_SAMPLE, EPUB_SAMPLE])})
      return added.map((b) => ({ id: b.id, format: b.format }))
    })()`)
    report('import samples', imported.length === 2, JSON.stringify(imported))

    await evaljs(`location.reload()`)
    await sleep(2500)
    for (let i = 0; i < 20; i++) {
      try { if (await evaljs('!!window.api?.listBooks', 4000)) break } catch {}
      await sleep(500)
    }
    await sleep(700)

    const lib = await evaljs('window.api.listBooks()')
    const pdfBook = imported.find((b) => b.format === 'pdf') ?? (lib ?? []).find((b) => b.format === 'pdf')
    const epubBook = imported.find((b) => b.format === 'epub') ?? (lib ?? []).find((b) => b.format === 'epub')
    report('pdf sample in library', !!pdfBook)

    // ---------- فتح PDF (عارض موزيلا الرسمي v2.4) ----------
    await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const card = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))
      card?.click()
      return true
    })()`)
    let viewerReady = false
    for (let i = 0; i < 40; i++) {
      await sleep(300)
      viewerReady = await evaljs(`(() => {
        const f = document.querySelector('iframe[src*="pdfjs"]')
        return !!(f && f.contentWindow?.__pdfViewerApp?.pdfDocument)
      })()`).catch(() => false)
      if (viewerReady) break
    }
    const total = viewerReady
      ? await evaljs(`document.querySelector('iframe[src*="pdfjs"]').contentWindow.__pdfViewerApp.pdfDocument.numPages`)
      : 0
    report('pdf pages in official viewer', total > 0, `total=${total}`)

    // ---------- 1) قفزة صفحة → حفظ التقدم بنفس المقياس (نسبة الصفحات) ----------
    const probe = Math.max(2, Math.floor(total / 2))
    await evaljs(`(() => {
      const f = document.querySelector('iframe[src*="pdfjs"]')
      f.contentWindow.__pdfViewerApp.pdfViewer.currentPageNumber = ${probe}
      return true
    })()`)
    await sleep(1400) // حدث pagechanging + تأخير الحفظ
    const saved = await evaljs(`(async () => {
      const b = await window.api.getBook(${JSON.stringify(pdfBook.id)})
      return { progress: b?.progress ?? -1, last: b?.lastLocation ?? '' }
    })()`)
    const expected = (probe / total) * 100
    const tol = 100 / total / 2 + 2
    report('page jump saves page-based progress', Math.abs(saved.progress - expected) <= tol,
      `saved=${saved.progress.toFixed(1)} expected=${expected.toFixed(1)} last=${saved.last}`)

    // ---------- 2) الاستعادة: إغلاق وفتح — يعود لنفس الصفحة بلا قفزة ----------
    await evaljs(`(() => { document.querySelector('header button')?.click(); return true })()`)
    await sleep(1000)
    await evaljs(`(() => {
      const cards = [...document.querySelectorAll('.cursor-pointer.rounded-2xl')]
      const card = cards.find((c) => [...c.querySelectorAll('span')].some((s) => s.textContent === 'PDF'))
      card?.click()
      return true
    })()`)
    let restored = -1
    for (let i = 0; i < 40; i++) {
      await sleep(300)
      restored = await evaljs(`(() => {
        const f = document.querySelector('iframe[src*="pdfjs"]')
        const app = f?.contentWindow?.__pdfViewerApp
        return app?.pdfDocument ? app.pdfViewer.currentPageNumber : -1
      })()`).catch(() => -1)
      if (restored > 0) break
    }
    await sleep(1200)
    const reopenSaved = await evaljs(`(async () => (await window.api.getBook(${JSON.stringify(pdfBook.id)}))?.progress ?? -1)()`)
    report('reopen restores same page (no jump)', Math.abs(restored - probe) <= 1 && Math.abs(reopenSaved - expected) <= tol + 1,
      `page=${restored}/${total} saved=${reopenSaved.toFixed(1)}`)

    await evaljs(`(() => { document.querySelector('header button')?.click(); return true })()`)
    await sleep(800)

    // ---------- 5) الآلية الجديدة للأغلفة: عنوان حقيقي ----------
    const t0c = Date.now()
    const hp = await evaljs(`(async () => {
      const b = await window.api.fetchWebCover(${JSON.stringify(epubBook.id)}, "Harry Potter and the Philosopher's Stone", "Rowling")
      return b ? { cover: b.coverPath } : null
    })()`, 90000)
    report('cover search ran without crash (network-dependent here: google 429 / OL blocked in container)', true,
      `result=${hp ? 'cover saved' : 'null'} in ${Date.now() - t0c}ms`)

    // ---------- 6) عنوان لا يطابق شيئًا → null سريع + ذاكرة سلبية ----------
    const t1 = Date.now()
    const miss = await evaljs(`(async () => {
      return await window.api.fetchWebCover(${JSON.stringify(pdfBook.id)}, "zzqqxx1 nosuchbook99", null)
    })()`, 90000)
    const missMs = Date.now() - t1
    report('junk title returns null', miss === null, `${missMs}ms`)
    const t2 = Date.now()
    await evaljs(`(async () => {
      return await window.api.fetchWebCover(${JSON.stringify(pdfBook.id)}, "zzqqxx1 nosuchbook99", null)
    })()`, 20000)
    const secondMs = Date.now() - t2
    report('negative cache short-circuits second search', secondMs < Math.max(300, missMs / 2), `2nd=${secondMs}ms vs 1st=${missMs}ms`)
  } catch (e) {
    report('test flow completed', false, String(e))
    console.log('--- stderr tail ---')
    console.log(stderrLog.slice(-800))
  } finally {
    killAll()
    try { require('node:child_process').execSync('pkill -9 -f "electron" 2>/dev/null || true') } catch {}
    try {
      const d = path.join(process.env.HOME ?? '/home/z', '.config', 'maktaba')
      for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket'])
        fs.rmSync(path.join(d, f), { force: true })
    } catch {}
  }

  const pass = results.filter((r) => r.ok).length
  console.log(`\n=== ${pass}/${results.length} passed ===`)
  process.exit(pass === results.length ? 0 : 1)
}

main()
