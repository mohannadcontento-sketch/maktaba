#!/usr/bin/env bash
# ============================================================
# استعادة وحدة better-sqlite3 لبيئة لينكس بعد بناء ويندوز
# ⚠️ يجب أن تستهدف إلكترون (ABI 130) وليس Node الخاص بالنظام —
#    npm rebuild المعتاد يبنيها لـ Node 24 (ABI 137) فينهار
#    إقلاع التطبيق صامتًا أثناء التطوير والاختبار.
# الاستخدام: bash scripts/restore-linux-native.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ELECTRON_VER="$(node -p "require('./node_modules/electron/package.json').version")"
echo "==> استعادة better-sqlite3 لاستهداف إلكترون ${ELECTRON_VER} (linux-x64)"
cd node_modules/better-sqlite3
npx prebuild-install --runtime electron --target "${ELECTRON_VER}" --platform linux --arch x64
cd ../..

file node_modules/better-sqlite3/build/Release/better_sqlite3.node
echo "✓ تم — الوحدة الآن prebuild إلكترون (مناسبة للتطوير والاختبار على لينكس)"
