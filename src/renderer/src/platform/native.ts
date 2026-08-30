/**
 * أدوات منصة الجوال (Capacitor/Android) — تُحمَّل ديناميكيًا فقط على الأجهزة
 * لا يُستورد أي شيء من هنا في بناء سطح المكتب (chunk منفصل عبر import ديناميكي)
 */
import { CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { FetchAdapter } from '../../../shared/coverEngines'

export const LIB_DIR = 'library'
export const COVERS_DIR = 'covers'

export async function ensureDirs(): Promise<void> {
  for (const dir of [LIB_DIR, COVERS_DIR]) {
    await Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true }).catch(() => {})
  }
}

// ---------- base64 ----------
export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** كتابة بايتات إلى ملف داخل مجلد بيانات التطبيق */
export async function writeDataFile(relPath: string, bytes: Uint8Array): Promise<string> {
  await Filesystem.writeFile({
    path: relPath,
    directory: Directory.Data,
    data: bytesToB64(bytes),
    recursive: true
  })
  return `cap://${relPath}`
}

export async function readDataFile(relPath: string): Promise<Uint8Array | null> {
  try {
    const res = await Filesystem.readFile({ path: relPath, directory: Directory.Data })
    // plugin يعيد base64 نصًا عندما لا يُحدد Encoding
    return b64ToBytes(res.data as string)
  } catch {
    return null
  }
}

export async function deleteDataFile(relPath: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: relPath, directory: Directory.Data })
  } catch {
    /* غير موجود */
  }
}

// ---------- الأغلفة ----------
export function basenameOf(p: string | null | undefined): string {
  return p ? p.split(/[\\/]/).pop() ?? '' : ''
}

const coverCache = new Map<string, string>()

/** data URL لغلاف مخزن (مع ذاكرة) — للمصغرات في المكتبة */
export async function coverDataUrl(basename: string): Promise<string | null> {
  if (!basename) return null
  const hit = coverCache.get(basename)
  if (hit) return hit
  const bytes = await readDataFile(`${COVERS_DIR}/${basename}`)
  if (!bytes) return null
  const ext = (basename.split('.').pop() ?? 'jpg').toLowerCase()
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const url = `data:${mime};base64,${bytesToB64(bytes)}`
  coverCache.set(basename, url)
  return url
}

export function coverExtFromBytes(bytes: Uint8Array): 'png' | 'jpg' {
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : 'jpg'
}

// ---------- محوّل الشبكة (يتجاوز CORS عبر طبقة native) ----------
export const capFetchAdapter: FetchAdapter = {
  async fetchText(url: string, headers?: Record<string, string>, timeoutMs: number = 12000) {
    const res = await CapacitorHttp.get({
      url,
      headers: { 'User-Agent': 'Mozilla/5.0 Maktaba/2.2', ...(headers ?? {}) },
      readTimeout: timeoutMs,
      connectTimeout: timeoutMs
    })
    if (res.status >= 400) throw new Error(`status ${res.status}`)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  },
  async fetchBytes(url: string, headers?: Record<string, string>, timeoutMs: number = 15000) {
    const res = await CapacitorHttp.get({
      url,
      headers: { 'User-Agent': 'Mozilla/5.0 Maktaba/2.2', ...(headers ?? {}) },
      responseType: 'arraybuffer',
      readTimeout: timeoutMs,
      connectTimeout: timeoutMs
    })
    if (res.status >= 400) throw new Error(`status ${res.status}`)
    const buf =
      res.data instanceof ArrayBuffer
        ? new Uint8Array(res.data)
        : typeof res.data === 'string'
          ? b64ToBytes(res.data)
          : new Uint8Array()
    return { buf, contentType: String(res.headers?.['Content-Type'] ?? res.headers?.['content-type'] ?? '') }
  }
}

// ---------- تحقق الصور (نسخة مصغرة من imageDims في main) ----------
export function imageDims(bytes: Uint8Array): { w: number; h: number } | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return { w: view.getUint32(16), h: view.getUint32(20) }
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let off = 2
      while (off + 9 < bytes.length) {
        if (bytes[off] !== 0xff) {
          off++
          continue
        }
        const marker = bytes[off + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2
          continue
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: view.getUint16(off + 5), w: view.getUint16(off + 7) }
        }
        const len = view.getUint16(off + 2)
        if (len < 2) return null
        off += 2 + len
      }
    }
  } catch {
    /* تجاهل */
  }
  return null
}
