#!/usr/bin/env bash
# ============================================================
# بناء حزم ويندوز (Setup + Portable) على لينكس — النسخة المصحّحة
#
# يتضمن:
#   1. رقعة NSIS بدون wine (قابلة لإعادة التطبيق)
#   2. typecheck
#   3. بناء electron-vite (main/preload/renderer)
#   4. استبدال الوحدات الأصلية بنسخ ويندوز الرسمية ← إصلاح
#      "التطبيق لا يفتح بعد التثبيت" (كانت تُحزم بنسخة لينكس ELF)
#   5. electron-builder --win
#   6. تحقق نهائي: better_sqlite3.node داخل الحزمة = PE (ويندوز)
#
# الاستخدام: bash scripts/build-win.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/6 رقعة NSIS (بدون wine)"
node scripts/patch-nsis-nowine.js

echo "==> 2/6 typecheck"
npm run typecheck

echo "==> 3/6 بناء electron-vite"
npm run build

echo "==> 4/6 تجهيز الوحدات الأصلية بنسخ ويندوز"
node scripts/fix-win-native.js

echo "==> 5/6 electron-builder --win"
export MAKTABA_NO_WINE=1
npx electron-builder --win

echo "==> 6/6 تحقق نهائي من الوحدات الأصلية داخل win-unpacked"
FAIL=0
while IFS= read -r -d '' f; do
  if file "$f" | grep -q "ELF"; then
    echo "✗ ما زال ELF (لينكس): $f"
    FAIL=1
  elif file "$f" | grep -q "PE32"; then
    echo "✓ PE (ويندوز): ${f#release/win-unpacked/}"
  else
    echo "? غير معروف: $f"
  fi
done < <(find release/win-unpacked -name "*.node" -print0)

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "✗ فشل التحقق — توجد وحدات لينكس داخل حزمة ويندوز. أوقف التسليم."
  exit 1
fi

echo ""
ls -lh release/*.exe
echo ""
echo "✓ اكتمل البناء بنجاح — كل الوحدات الأصلية نسخ ويندوز"
