/**
 * bootGuard — حارس الإقلاع (سكربت عادي قبل وحدات ES)
 * يعمل في كل المنصات:
 *  - يرسم شاشة بداية فورية بدل الشاشة السوداء
 *  - أثناء الإقلاع فقط: يلتقط أي خطأ JS/CSP قاتل ويعرضه على الشاشة بدل صمت تام
 *  - بعد نجاح الإقلاع: الأخطاء تُسجَّل في الكونسول فقط — التطبيق يعمل والبطاقات
 *    القاتلة لا تفرض نفسها على المستخدم (أخطاء ResizeObserver الحميدة تُتجاهل دائمًا)
 *  - حجب CSP للصور/الأنماط/الخطوط تجميلي ولا يُعتبر فشلًا أبدًا
 *  - يوفر window.__mkBoot (stage/done/fail) لتتبع مراحل الإقلاع
 */
;(function () {
  'use strict'
  try {
    var stages = []
    var failed = false
    var bootDone = false
    var root = null
    var stageEl = null
    var spinEl = null
    var seenViolations = {}
    var runtimeErrors = []

    function ensureDom() {
      if (root && root.isConnected) return root
      root = document.createElement('div')
      root.id = 'bootGuard'
      root.setAttribute(
        'style',
        'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'background:#0f1115;color:#e6e9ef;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;' +
          'transition:opacity .35s ease;'
      )
      var logo = document.createElement('div')
      logo.textContent = 'مكتبة'
      logo.setAttribute('style', 'font-size:34px;font-weight:800;letter-spacing:.5px;color:#14b8a6;margin-bottom:6px;')
      var sub = document.createElement('div')
      sub.textContent = 'قارئ الكتب — EPUB و PDF'
      sub.setAttribute('style', 'font-size:13px;opacity:.55;margin-bottom:26px;')
      spinEl = document.createElement('div')
      spinEl.setAttribute(
        'style',
        'width:30px;height:30px;border:3px solid rgba(20,184,166,.25);border-top-color:#14b8a6;border-radius:50%;' +
          'animation:mkBootSpin 0.9s linear infinite;'
      )
      stageEl = document.createElement('div')
      stageEl.setAttribute('style', 'font-size:12px;opacity:.65;margin-top:14px;min-height:16px;')
      var style = document.createElement('style')
      style.textContent = '@keyframes mkBootSpin{to{transform:rotate(360deg)}}'
      root.appendChild(style)
      root.appendChild(logo)
      root.appendChild(sub)
      root.appendChild(spinEl)
      root.appendChild(stageEl)
      ;(document.body || document.documentElement).appendChild(root)
      return root
    }

    function showFatal(title, detail) {
      failed = true
      var r = ensureDom()
      if (spinEl) spinEl.style.display = 'none'
      var card = document.createElement('div')
      card.setAttribute(
        'style',
        'max-width:min(92vw,560px);background:#1a1d24;border:1px solid #2c313c;border-radius:14px;padding:18px 20px;margin:0 12px;'
      )
      var h = document.createElement('p')
      h.textContent = title
      h.setAttribute('style', 'font-size:16px;font-weight:700;color:#f87171;margin:0 0 8px;')
      var body = document.createElement('pre')
      body.textContent = String(detail || '').slice(0, 2000) || '—'
      body.setAttribute(
        'style',
        'white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.55;color:#c9ced8;margin:0;' +
          'max-height:52vh;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;'
      )
      var btn = document.createElement('button')
      btn.textContent = 'إعادة المحاولة'
      btn.setAttribute(
        'style',
        'margin-top:14px;background:#14b8a6;color:#04211e;font-weight:700;border:0;border-radius:10px;padding:9px 22px;font-size:13px;cursor:pointer;'
      )
      btn.onclick = function () {
        location.reload()
      }
      card.appendChild(h)
      card.appendChild(body)
      card.appendChild(btn)
      r.appendChild(card)
    }

    function fmtErr(e) {
      try {
        if (!e) return ''
        if (e.stack) return e.stack
        if (e.reason) return fmtErr(e.reason)
        if (e.message) return e.message
        return typeof e === 'object' ? JSON.stringify(e) : String(e)
      } catch (_) {
        return String(e)
      }
    }

    // أخطاء حميدة معروفة من كروميوم — لا تستحق إيقاف التطبيق إطلاقًا
    function isBenignErr(msg) {
      return typeof msg === 'string' && /ResizeObserver loop/i.test(msg)
    }

    // بعد نجاح الإقلاع: الأخطاء تُسجَّل للفحص عن بُعد (chrome://inspect) دون مقاطعة المستخدم
    function recordRuntimeError(text) {
      try {
        runtimeErrors.push(String(text || '').slice(0, 500))
        if (runtimeErrors.length > 12) runtimeErrors.shift()
        window.__mkRuntimeErrors = runtimeErrors
        console.error('[maktaba]', text)
      } catch (_) {}
    }

    window.onerror = function (msg, src, line, col, err) {
      if (isBenignErr(msg)) return
      if (bootDone) {
        recordRuntimeError(fmtErr(err) || msg + ' @ ' + (src || '') + ':' + line + ':' + col)
        return
      }
      if (failed) return
      showFatal('حدث خطأ أثناء تشغيل التطبيق', fmtErr(err) || msg + ' @ ' + (src || '') + ':' + line + ':' + col)
    }
    window.addEventListener('unhandledrejection', function (ev) {
      var text = fmtErr(ev && ev.reason)
      if (isBenignErr(text)) return
      if (bootDone) {
        recordRuntimeError(text)
        return
      }
      if (failed) return
      showFatal('حدث خطأ أثناء تشغيل التطبيق', text)
    })
    window.addEventListener('securitypolicyviolation', function (ev) {
      var d = (ev && (ev.violatedDirective || ev.effectiveDirective)) || '?'
      var u = (ev && ev.blockedURI) || ''
      var key = d + '|' + u
      if (seenViolations[key]) return
      seenViolations[key] = 1
      var detail = d + ' → ' + u + '\n' + ((ev && ev.sourceFile) || '') + ':' + ((ev && ev.lineNumber) || 0)
      try {
        console.warn('[maktaba][CSP]', detail)
      } catch (_) {}
      // حجب الصور/الأنماط/الخطوط/الاتصالات تجميلي — لا يعطّل التطبيق،
      // وبعد نجاح الإقلاع لا شيء من CSP يرسم بطاقة قاتلة أصلًا
      var fatal = d === 'script-src' || d === 'script-src-elem' || d === 'worker-src' || d === 'default-src'
      if (bootDone || failed || !fatal) return
      showFatal('حجب سياسة الأمان (CSP) لمورد', detail)
    })

    window.__mkBoot = {
      stage: function (name) {
        if (failed) return
        stages.push(name)
        ensureDom()
        if (stageEl) stageEl.textContent = name
      },
      done: function () {
        bootDone = true
        if (failed || !root) return
        var r = root
        r.style.opacity = '0'
        r.style.pointerEvents = 'none'
        setTimeout(function () {
          try {
            if (r && r.parentNode) r.parentNode.removeChild(r)
          } catch (_) {}
        }, 420)
      },
      fail: function (e) {
        if (!failed) showFatal('تعذّر إكمال تهيئة التطبيق', fmtErr(e))
      },
      isVisible: function () {
        return !!root && !failed
      }
    }

    // شاشة البداية تظهر فورًا — في نفس إطار تحليل الصفحة قبل أي وحدة
    function paint() {
      if (window.__mkBoot.isVisible()) return
      ensureDom()
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', paint)
    } else {
      paint()
    }
  } catch (_) {
    /* آخر ما نريده هو تعطل الحارس نفسه */
  }
})()
