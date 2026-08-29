#!/usr/bin/env node
/**
 * رقعة electron-builder للبناء على لينكس دون wine.
 *
 * المشكلة: أثناء بناء NSIS، يستدعي NsisTarget.js `execWine(installerPath)`
 * لتوليد أداة الإزالة (uninstaller) — وهذا يفشل على لينكس بلا wine.
 *
 * الحل: استخدام `UninstallerReader.exec()` الموجودة في app-builder-lib نفسها —
 * قارئ JS خالص يستخرج كتلة الـ uninstaller من المثبّت المبني مباشرة (PE + zlib)
 * دون تشغيل أي ملف تنفيذي.
 *
 * الرقعة idempotent: يمكن تشغيلها عدة مرات. تعمل على node_modules الحالي —
 * يجب إعادة تشغيلها بعد أي `npm install/ci` جديد.
 *
 * الاستخدام: node scripts/patch-nsis-nowine.js
 */
const fs = require('node:fs')
const path = require('node:path')

const target = path.resolve(
  __dirname,
  '..',
  'node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js'
)

if (!fs.existsSync(target)) {
  console.error(`✗ الملف غير موجود: ${target} — هل نُفّذ npm install؟`)
  process.exit(1)
}

let code = fs.readFileSync(target, 'utf8')

const original = `        else {
            await (0, wine_1.execWine)(installerPath, null, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }`

const patched = `        else {
            // MAKTABA PATCH (scripts/patch-nsis-nowine.js): بلا wine على لينكس —
            // نستخرج الـ uninstaller بطريقة JS الخالصة بدل تشغيل المثبّت تحت wine
            await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
        }`

if (code.includes(patched)) {
  console.log('• الرقعة مطبقة مسبقًا — لا تغيير')
  process.exit(0)
}

if (!code.includes(original)) {
  console.error('✗ لم أجد الكود المتوقع — ربما تغيّر إصدار app-builder-lib. راجع NsisTarget.js يدويًا.')
  process.exit(1)
}

code = code.replace(original, patched)
fs.writeFileSync(target, code)
console.log('✓ طُبّقت رقعة no-wine على NsisTarget.js (استخراج uninstaller عبر UninstallerReader)')
