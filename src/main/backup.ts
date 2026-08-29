/**
 * النسخ الاحتياطي والاستعادة (النسخة 2)
 * ملف واحد بصيغة .maktaba.zip يحوي:
 *  - backup.json   : كل بيانات قاعدة البيانات (كتب/وسوم/رفوف/تعليقات/علامات/إعدادات)
 *  - covers/<ملف>  : صور الأغلفة
 *  - files/<ملف>   : ملفات الكتب (اختياري — قد تكون كبيرة)
 */
import { dialog, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import AdmZip from 'adm-zip'
import { exportAllData, importAllData, type BackupData } from './db'
import { coversDir, libraryDir } from './library'
import type { BackupResult } from '../shared/types'

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i
const BOOK_RE = /\.(pdf|epub)$/i

function win(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function safeList(dir: string, re: RegExp): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => re.test(n) && fs.statSync(path.join(dir, n)).isFile())
  } catch {
    return []
  }
}

function dateStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** يعرض حوار الحفظ ويعيد المسار المختار أو null */
export async function pickExportTarget(): Promise<string | null> {
  const res = await dialog.showSaveDialog(win()!, {
    title: 'تصدير نسخة احتياطية من المكتبة',
    defaultPath: `maktaba-backup-${dateStamp()}.maktaba.zip`,
    filters: [
      { name: 'نسخة مكتبة احتياطية', extensions: ['zip'] },
      { name: 'كل الملفات', extensions: ['*'] }
    ]
  })
  if (res.canceled || !res.filePath) return null
  return res.filePath.endsWith('.zip') ? res.filePath : `${res.filePath}.zip`
}

export async function exportBackup(
  target: string,
  includeFiles: boolean
): Promise<{ covers: number; files: number }> {
  const zip = new AdmZip()
  zip.addFile('backup.json', Buffer.from(JSON.stringify(exportAllData()), 'utf8'))

  let covers = 0
  const cdir = coversDir()
  for (const name of safeList(cdir, IMAGE_RE)) {
    zip.addLocalFile(path.join(cdir, name), 'covers')
    covers++
  }

  let files = 0
  if (includeFiles) {
    const ldir = libraryDir()
    for (const name of safeList(ldir, BOOK_RE)) {
      zip.addLocalFile(path.join(ldir, name), 'files')
      files++
    }
  }

  zip.writeZip(target)
  return { covers, files }
}

/** يعرض حوار الفتح ويعيد المسار المختار أو null */
export async function pickImportSource(): Promise<string | null> {
  const res = await dialog.showOpenDialog(win()!, {
    title: 'استعادة نسخة احتياطية',
    filters: [
      { name: 'نسخة مكتبة احتياطية', extensions: ['zip'] },
      { name: 'كل الملفات', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
}

export async function importBackup(zipPath: string): Promise<BackupResult> {
  const zip = new AdmZip(zipPath)
  const manifest = zip.getEntry('backup.json')
  if (!manifest) throw new Error('ملف النسخة الاحتياطية غير صالح (لا يحتوي backup.json)')
  const data = JSON.parse(manifest.getData().toString('utf8')) as BackupData
  if (data?.app !== 'maktaba') throw new Error('ملف النسخة الاحتياطية لا يخص تطبيق مكتبة')

  // استخراج الأغلفة (أسماء آمنة فقط)
  let coversRestored = 0
  const cdir = coversDir()
  for (const e of zip.getEntries()) {
    const m = /^covers\/([^/\\]+)$/.exec(e.entryName)
    if (!m || e.isDirectory || !IMAGE_RE.test(m[1])) continue
    const base = path.basename(m[1])
    if (!/^[A-Za-z0-9._-]+$/.test(base)) continue
    fs.writeFileSync(path.join(cdir, base), e.getData())
    coversRestored++
  }

  // استخراج ملفات الكتب (لا نستبدل الموجود)
  let filesRestored = 0
  const ldir = libraryDir()
  for (const e of zip.getEntries()) {
    const m = /^files\/([^/\\]+)$/.exec(e.entryName)
    if (!m || e.isDirectory || !BOOK_RE.test(m[1])) continue
    const base = path.basename(m[1])
    if (!/^[A-Za-z0-9._-]+$/.test(base)) continue
    const dest = path.join(ldir, base)
    if (fs.existsSync(dest)) continue
    fs.writeFileSync(dest, e.getData())
    filesRestored++
  }

  const res = importAllData(data)
  return { ...res, coversRestored, filesRestored }
}
