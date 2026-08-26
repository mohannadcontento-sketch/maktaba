// CDP eval helper: node cdp-eval.mjs "<js expression>"
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('NO PAGE TARGET')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const send = (method, params) =>
  new Promise((res, rej) => {
    const i = ++id
    const h = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === i) {
        ws.removeEventListener('message', h)
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
      }
    }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
ws.addEventListener('open', async () => {
  try {
    const r = await send('Runtime.evaluate', {
      expression: process.argv[2],
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) {
      console.error('PAGE-EXC:', JSON.stringify(r.exceptionDetails).slice(0, 400))
    } else {
      console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value))
    }
  } catch (e) {
    console.error('ERR:', e.message)
  } finally {
    ws.close()
    setTimeout(() => process.exit(0), 100)
  }
})
