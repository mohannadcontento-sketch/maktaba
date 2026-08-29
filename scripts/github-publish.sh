#!/usr/bin/env bash
# ============================================================
# نشر مكتبة v2.0.0 على GitHub: دفع الكود + إصدار بالحزم exe
# الاستخدام:  GITHUB_TOKEN=ghp_xxxx bash scripts/github-publish.sh
# ============================================================
set -euo pipefail

REPO_DIR="/home/z/my-project/maktaba_repo"
REPO="mohannadcontento-sketch/maktaba"
VERSION="2.0.0"
TAG="v${VERSION}"

: "${GITHUB_TOKEN:?ضع رمز الوصول: GITHUB_TOKEN=ghp_xxx bash scripts/github-publish.sh}"

cd "$REPO_DIR"

echo "==> 1/5 ضبط المصادقة"
git config credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'
export GH_TOKEN="$GITHUB_TOKEN"

echo "==> 2/5 دفع الكود + الوسم"
git push origin HEAD:main || git push origin HEAD:master
git tag -f "$TAG" 2>/dev/null || true
git push origin "$TAG" --force

echo "==> 3/5 التحقق من الأدوات"
if ! command -v gh >/dev/null 2>&1; then
  # تحميل gh CLI محليًا دون الحاجة لصلاحيات root
  GH_DIR="$REPO_DIR/.ghcli"
  mkdir -p "$GH_DIR"
  if [ ! -x "$GH_DIR/gh" ]; then
    curl -sL "https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_amd64.tar.gz" | tar xz -C "$GH_DIR" --strip-components=1
  fi
  GH="$GH_DIR/bin/gh"
else
  GH="gh"
fi
"$GH" --version

echo "==> 4/5 إنشاء الإصدار v${VERSION}"
if "$GH" release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "    الإصدار موجود — سيُحدَّث"
else
  "$GH" release create "$TAG" -R "$REPO" \
    --title "مكتبة v2.0.0 — بحث EPUB + قراءة صوتية + إصلاح شامل" \
    --notes-file .github/RELEASE_NOTES_v2.0.0.md
fi

echo "==> 5/5 رفع الحزم (~118MB لكل ملف)"
"$GH" release upload "$TAG" -R "$REPO" --clobber \
  "release/Maktaba-Setup-${VERSION}.exe" \
  "release/Maktaba-Portable-${VERSION}.exe"

echo ""
echo "✅ تم النشر: https://github.com/${REPO}/releases/tag/${TAG}"
echo "   صفحة الكود: https://github.com/${REPO}"
