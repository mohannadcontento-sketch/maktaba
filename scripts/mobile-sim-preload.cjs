// preload لمحاكي الجوال — يعمل قبل سكربتات الصفحة في عالم مُعزول
// يزيل الواجهات الحديثة ويجعل البيئة تبدو «أندرويد أصلي» لـ Capacitor
try { delete Object.hasOwn } catch {}
try { delete window.structuredClone } catch {}
try {
  if (window.crypto) {
    try { delete window.crypto.randomUUID } catch {}
    try { window.crypto.randomUUID = undefined } catch {}
  }
} catch {}
try { delete Array.prototype.at } catch {}
try { delete Array.prototype.findLast } catch {}
try { delete Array.prototype.findLastIndex } catch {}
try { delete Array.prototype.toSorted } catch {}
try { delete Array.prototype.toReversed } catch {}
try { delete String.prototype.replaceAll } catch {}
try { delete Promise.allSettled } catch {}
try { delete Promise.any } catch {}

// يخلّي @capacitor/core يعتبر هذه البيئة أندرويد أصلي (نفس آلية الجسر الحقيقي)
window.androidBridge = {}
window.Capacitor = {
  nativeBridge: true,
  isNativePlatform: () => true,
  getPlatform: () => 'android'
}
