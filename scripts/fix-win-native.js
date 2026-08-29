#!/usr/bin/env node
/**
 * استبدال الوحدات الأصلية (native modules) بنسخ ويندوز قبل البناء على لينكس.
 *
 * المشكلة: عند بناء حزمة ويندوز على لينكس، يحزم electron-builder وحدة
 * better-sqlite3 بنسخة لينكس (ELF) → التطبيق ينهار عند الإقلاع على ويندوز
 * قبل فتح أي نافذة ("لا يظهر شيء").
 *
 * الحل: نزّل نسخة ويندوز الرسمية (prebuild) المطابقة لإصدار Electron
 * وضعها مكان نسخة لينكس قبل تشغيل electron-builder.
 *
 * الاستخدام: node scripts/fix-win-native.js
 * (يُشغَّل تلقائيًا من scripts/build-win.sh)
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const repo = path.resolve(__dirname, '..')
const pkg = require(path.join(repo, 'package.json'))
const electronVersion = require(path.join(repo, 'node_modules/electron/package.json')).version

const targets = [
  {
    name: 'better-sqlite3',
    version: pkg.dependencies['better-sqlite3'],
    // الوحدة التي سيحمّلها main عند الإقلاع — يجب أن تكون PE (ويندوز)
    checkFile: path.join(repo, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  }
]

function isWindowsBinary(file) {
  // PE/COFF: يبدأ بـ MZ ثم يحمل توقيع PE
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(2)
  fs.readSync(fd, buf, 0, 2, 0)
  fs.closeSync(fd)
  return buf[0] === 0x4d && buf[1] === 0x5a // "MZ"
}

function isElf(file) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(4)
  fs.readSync(fd, buf, 0, 4, 0)
  fs.closeSync(fd)
  return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46
}

let failed = false
for (const t of targets) {
  const modDir = path.join(repo, 'node_modules', t.name)
  if (!fs.existsSync(modDir)) {
    console.error(`✗ ${t.name} غير موجود في node_modules`)
    failed = true
    continue
  }
  const cur = t.checkFile
  const state = !fs.existsSync(cur) ? 'مفقود' : isWindowsBinary(cur) ? 'ويندوز (MZ)' : isElf(cur) ? 'لينكس (ELF)' : 'غير معروف'
  console.log(`• ${t.name} — الملف الحالي: ${state}`)

  if (state === 'ويندوز (MZ)') {
    console.log(`  ✓ نسخة ويندوز موجودة أصلًا — تخطّي`)
    continue
  }

  console.log(`  ↻ تنزيل prebuild ويندوز (electron ${electronVersion}, x64)…`)
  try {
    execFileSync(
      process.execPath,
      [
        path.join(modDir, 'node_modules', 'prebuild-install', 'bin.js'),
        '--runtime', 'electron',
        '--target', electronVersion,
        '--platform', 'win32',
        '--arch', 'x64',
        '--verbose'
      ],
      { cwd: modDir, stdio: 'inherit' }
    )
  } catch (e1) {
    // prebuild-install غير مثبّت محليًا؟ جرّب npx
    console.log('  (prebuild-install المحلي غير متاح — نجرّب npx)')
    try {
      execFileSync(
        'npx',
        ['--yes', 'prebuild-install', '--runtime', 'electron', '--target', electronVersion,
         '--platform', 'win32', '--arch', 'x64', '--verbose'],
        { cwd: modDir, stdio: 'inherit', shell: true }
      )
    } catch (e2) {
      console.error(`✗ فشل تنزيل prebuild لـ ${t.name}:`, e2.message || e2)
      failed = true
      continue
    }
  }

  if (!fs.existsSync(t.checkFile) || !isWindowsBinary(t.checkFile)) {
    console.error(`✗ بعد التنزيل ما زال ${t.checkFile} ليس ملف ويندوز!`)
    failed = true
    continue
  }
  console.log(`  ✓ ${t.name}: أصبح نسخة ويندوز (${t.version}) — electron ABI ${electronVersion}`)
}

// فحص إضافي: @napi-rs/canvas (تأتي مع pdfjs-dist، تُستخدم فقط في وضع Node وتُهمل في المتصفح)
const canvasDir = path.join(repo, 'node_modules/@napi-rs/canvas')
if (fs.existsSync(canvasDir)) {
  console.log('• @napi-rs/canvas: موجودة (نسخة لينكس) — لا تُحمَّل وقت التشغيل في المتصفح، تُترك كما هي')
}

if (failed) {
  console.error('\n✗ فشل تجهيز الوحدات الأصلية — أوقف البناء. راجع الرسائل أعلاه.')
  process.exit(1)
}
console.log('\n✓ كل الوحدات الأصلية جاهزة لبناء ويندوز')
