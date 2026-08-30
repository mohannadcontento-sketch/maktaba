/**
 * جسر واجهة الجوال — يركّب window.api (نفس سطح ApiBridge) فوق Capacitor
 * يُستورد ديناميكيًا من main.tsx فقط عند العمل داخل تطبيق أندرويد
 */
import { Directory, Filesystem } from '@capacitor/filesystem'
import { FilePicker } from '@capawesome/capacitor-file-picker'
import { Share } from '@capacitor/share'
import JSZip from 'jszip'
import type { ApiBridge, Book, BackupResult, WebImage } from '../../../shared/types'
import { searchWebImages } from '../../../shared/coverEngines'
import {
  COVERS_DIR,
  LIB_DIR,
  b64ToBytes,
  capFetchAdapter,
  coverDataUrl,
  coverExtFromBytes,
  deleteDataFile,
  ensureDirs,
  imageDims,
  readDataFile,
  writeDataFile
} from './native'
import * as db from './dbSql'

let installed = false

export async function installShim(): Promise<void> {
  if (installed) return
  installed = true

  const guard = (window as unknown as { __mkBoot?: { stage(name: string): void } }).__mkBoot

  guard?.stage('تهيئة مجلدات التطبيق…')
  await ensureDirs()

  // فتح قاعدة البيانات — فشلها لا يمنع الإقلاع (وضع متدهور: مكتبة فارغة) لكن يُسجَّل دائمًا
  guard?.stage('فتح قاعدة البيانات…')
  try {
    await db.openDb()
  } catch (e) {
    console.error('mobile db open failed', e)
    guard?.stage(`تنبيه: تعذر فتح قاعدة البيانات (${(e as Error)?.message ?? 'خطأ'})`)
    await new Promise((r) => setTimeout(r, 1200))
  }

  // ---------- أدوات داخلية ----------
  const extOf = (name: string): 'pdf' | 'epub' | null => {
    const m = /\.([a-z0-9]+)$/i.exec(name)
    const e = m?.[1]?.toLowerCase()
    return e === 'pdf' ? 'pdf' : e === 'epub' ? 'epub' : null
  }

  const genFileName = (ext: string): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`

  function cleanTitleFromFileName(name: string): string {
    return name
      .replace(/\.(pdf|epub)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /** استخراج بيانات EPUB (DOMParser + JSZip) — نفس منطق main/library.ts */
  async function extractEpubMeta(bytes: Uint8Array): Promise<{
    title?: string
    author?: string
    language?: string
    publisher?: string
    pubDate?: string
    description?: string
    coverBytes?: Uint8Array
  }> {
    try {
      const zip = await JSZip.loadAsync(bytes)
      const containerFile = zip.file('META-INF/container.xml')
      if (!containerFile) return {}
      const container = new DOMParser().parseFromString(await containerFile.async('text'), 'application/xml')
      const opfPath = container.querySelector('rootfile')?.getAttribute('full-path') ?? ''
      const opfFile = zip.file(opfPath)
      if (!opfFile) return {}
      const opf = new DOMParser().parseFromString(await opfFile.async('text'), 'application/xml')
      const meta = opf.querySelector('metadata')
      if (!meta) return {}
      const text = (el: Element | null | undefined): string | undefined => el?.textContent?.trim() || undefined
      const title = text(meta.querySelector('dc\\:title')) ?? text(meta.querySelector('title'))
      const author = text(meta.querySelector('dc\\:creator')) ?? text(meta.querySelector('creator'))
      const language = text(meta.querySelector('dc\\:language')) ?? text(meta.querySelector('language'))
      const publisher = text(meta.querySelector('dc\\:publisher')) ?? text(meta.querySelector('publisher'))
      const pubDate =
        text(meta.querySelector('dc\\:date')) ?? text(meta.querySelector('date')) ?? text(meta.querySelector('dc\\:issued'))
      let description = (text(meta.querySelector('dc\\:description')) ?? text(meta.querySelector('description')))?.replace(
        /<[^>]+>/g,
        ' '
      )
      if (description) description = description.replace(/\s+/g, ' ').trim()

      // الغلاف: item properties="cover-image" أو meta name="cover"
      let coverHref: string | null = null
      const items = Array.from(opf.querySelectorAll('manifest > item'))
      for (const it of items) {
        if ((it.getAttribute('properties') ?? '').includes('cover-image')) {
          coverHref = it.getAttribute('href')
          break
        }
      }
      if (!coverHref) {
        const coverId = meta.querySelector('meta[name="cover"]')?.getAttribute('content')
        if (coverId) coverHref = items.find((i) => i.getAttribute('id') === coverId)?.getAttribute('href') ?? null
      }
      let coverBytes: Uint8Array | undefined
      if (coverHref) {
        const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
        const full = decodeURIComponent(base + coverHref)
        const entry = zip.file(full) ?? zip.file(coverHref)
        if (entry) coverBytes = new Uint8Array(await entry.async('arraybuffer'))
      }
      return { title, author, language, publisher, pubDate, description, coverBytes }
    } catch {
      return {}
    }
  }

  async function importOneBytes(fileName: string, bytes: Uint8Array, size: number): Promise<Book | null> {
    const format = extOf(fileName)
    if (!format) return null
    const stored = genFileName(`.${format}`)
    await writeDataFile(`${LIB_DIR}/${stored}`, bytes)
    const dup = db.findDuplicate(size, stored)
    if (dup) {
      // مكرر → نحذف النسخة المخزنة للتو
      await deleteDataFile(`${LIB_DIR}/${stored}`)
      return null
    }
    const id = db.insertBook({
      title: cleanTitleFromFileName(fileName) || fileName,
      format,
      fileName: stored,
      originalPath: fileName,
      size
    })
    if (format === 'epub') {
      try {
        const meta = await extractEpubMeta(bytes)
        const patch: Record<string, unknown> = {}
        if (meta.title) patch.title = meta.title
        if (meta.author) patch.author = meta.author
        if (meta.language) patch.language = meta.language
        if (meta.publisher) patch.publisher = meta.publisher
        if (meta.pubDate) patch.pubDate = meta.pubDate
        if (meta.description) patch.description = meta.description
        if (meta.coverBytes?.length) {
          const ext = coverExtFromBytes(meta.coverBytes)
          const coverRel = `${COVERS_DIR}/${id}.${ext}`
          await writeDataFile(coverRel, meta.coverBytes)
          patch.coverPath = `cap://${coverRel}`
        } else if ((patch.title as string) ?? '') {
          // جلب تلقائي لاحق — لا نعطل الاستيراد
          void autoCover(id, (patch.title as string) ?? '', meta.author ?? null)
        }
        if (Object.keys(patch).length) db.updateBook(id, patch)
      } catch {
        /* بيانات غير حرجة */
      }
    }
    return db.getBook(id)
  }

  /** جلب تلقائي للغلاف (أفضل مرشح) بعد استيراد EPUB بلا غلاف */
  const autoCoverQueue: Array<{ id: string; title: string; author: string | null }> = []
  let autoRunning = false
  function autoCover(id: string, title: string, author: string | null): void {
    if (title.trim().length < 3) return
    autoCoverQueue.push({ id, title, author })
    void pumpAuto()
  }
  async function pumpAuto(): Promise<void> {
    if (autoRunning) return
    autoRunning = true
    try {
      while (autoCoverQueue.length) {
        const job = autoCoverQueue.shift()!
        try {
          const candidates = await searchWebImages(capFetchAdapter, job.title, job.author)
          for (const c of candidates.slice(0, 4)) {
            const bytes = await tryDownload(c.full)
            if (!bytes) continue
            const ext = coverExtFromBytes(bytes)
            const rel = `${COVERS_DIR}/${job.id}.${ext}`
            await writeDataFile(rel, bytes)
            db.updateBook(job.id, { coverPath: `cap://${rel}` })
            break
          }
        } catch {
          /* غير حرج */
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    } finally {
      autoRunning = false
    }
  }

  async function tryDownload(url: string): Promise<Uint8Array | null> {
    try {
      const { buf } = await capFetchAdapter.fetchBytes(url)
      if (buf.length < 500) return null
      const d = imageDims(buf)
      if (d && (d.w < 32 || d.h < 32)) return null
      return buf
    } catch {
      return null
    }
  }

  // ---------- التركيب ----------
  const api: ApiBridge = {
    // استيراد
    pickAndImportBooks: async () => {
      const res = await FilePicker.pickFiles({
        readData: true,
        limit: 0,
        types: ['application/pdf', 'application/epub+zip']
      })
      const out: Book[] = []
      for (const f of res.files) {
        if (!f.data || !f.name) continue
        if (!extOf(f.name)) continue
        const bytes = b64ToBytes(f.data)
        const book = await importOneBytes(f.name, bytes, bytes.length)
        if (book) out.push(book)
      }
      return out
    },
    pickFolderAndScan: async () => [],
    pathsForFiles: () => [],
    importPaths: async () => [],
    onOpenFiles: () => () => {},

    // كتب
    listBooks: async () => db.listBooks(),
    getBook: async (id) => db.getBook(id),
    updateBook: async (id, patch) => {
      db.updateBook(id, patch)
    },
    deleteBook: async (id, deleteFile) => {
      const book = db.getBook(id)
      if (deleteFile && book) {
        await deleteDataFile(`${LIB_DIR}/${book.fileName}`)
        if (book.coverPath) await deleteDataFile(`${COVERS_DIR}/${book.coverPath.split(/[\\/]/).pop() ?? ''}`)
      }
      db.deleteBookRow(id)
    },
    saveCover: async (bookId, dataUrl) => {
      const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl)
      if (!m) throw new Error('bad data url')
      const ext = m[1] === 'png' ? 'png' : 'jpg'
      const rel = `${COVERS_DIR}/${bookId}.${ext}`
      await writeDataFile(rel, b64ToBytes(m[2]))
      db.updateBook(bookId, { coverPath: `cap://${rel}` })
      return rel
    },
    fetchWebCover: async (bookId, title, author) => {
      try {
        const candidates = await searchWebImages(capFetchAdapter, title, author)
        for (const c of candidates.slice(0, 6)) {
          const bytes = await tryDownload(c.full)
          if (!bytes) continue
          const ext = coverExtFromBytes(bytes)
          const rel = `${COVERS_DIR}/${bookId}.${ext}`
          await writeDataFile(rel, bytes)
          db.updateBook(bookId, { coverPath: `cap://${rel}` })
          return db.getBook(bookId)
        }
      } catch {
        /* تجاهل */
      }
      return null
    },
    // منتقي الأغلفة 2.2 — نفس المحركات المشتركة عبر طبقة native HTTP
    searchWebImages: async (title, author) => searchWebImages(capFetchAdapter, title, author),
    useWebImage: async (bookId, url) => {
      const bytes = await tryDownload(url)
      if (!bytes) return null
      const ext = coverExtFromBytes(bytes)
      const rel = `${COVERS_DIR}/${bookId}.${ext}`
      await writeDataFile(rel, bytes)
      db.updateBook(bookId, { coverPath: `cap://${rel}` })
      return db.getBook(bookId)
    },
    openCoverBrowser: async () => {
      /* نافذة المتصفح المدمج غير متاحة على الجوال — الشبكة التفاعلية تكفي */
    },
    onCoversUpdated: () => () => {},
    fileUrl: async (id) => {
      const book = db.getBook(id)
      if (!book) throw new Error('book not found')
      const bytes = await readDataFile(`${LIB_DIR}/${book.fileName}`)
      if (!bytes) throw new Error('file missing')
      const mime = book.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
      return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
    },
    revealBookFile: async () => {},

    // وسوم
    listTags: async () => db.listTags(),
    createTag: async (name, color) => db.createTag(name, color),
    deleteTag: async (id) => {
      db.deleteTag(id)
    },
    setBookTags: async (bookId, tagIds) => {
      db.setBookTags(bookId, tagIds)
    },

    // مجموعات
    listCollections: async () => db.listCollections(),
    createCollection: async (name) => db.createCollection(name),
    renameCollection: async (id, name) => {
      db.renameCollection(id, name)
    },
    deleteCollection: async (id) => {
      db.deleteCollection(id)
    },
    addBookToCollection: async (cid, bid) => {
      db.addBookToCollection(cid, bid)
    },
    removeBookFromCollection: async (cid, bid) => {
      db.removeBookFromCollection(cid, bid)
    },
    getCollectionBookIds: async (cid) => db.getCollectionBookIds(cid),

    // تعليقات
    listAnnotations: async (bookId) => db.listAnnotations(bookId),
    addAnnotation: async (a) => db.addAnnotation(a),
    updateAnnotation: async (id, patch) => {
      db.updateAnnotation(id, patch)
    },
    deleteAnnotation: async (id) => {
      db.deleteAnnotation(id)
    },

    // علامات مرجعية
    listBookmarks: async (bookId) => db.listBookmarks(bookId),
    addBookmark: async (b) => db.addBookmark(b),
    deleteBookmark: async (id) => {
      db.deleteBookmark(id)
    },

    // جلسات قراءة
    startSession: async (bookId) => db.startSession(bookId),
    sessionHeartbeat: async (sid, seconds, pagesRead) => {
      db.sessionProgress(sid, seconds, pagesRead, false)
    },
    endSession: async (sid, seconds, pagesRead) => {
      db.sessionProgress(sid, seconds, pagesRead, true)
    },
    stats: async () => db.statsSummary(),

    // إعدادات
    getSetting: async (key) => db.getSetting(key),
    setSetting: async (key, value) => {
      db.setSetting(key, value)
    },

    // نظام
    minimizeWindow: () => {},
    toggleMaximizeWindow: () => {},
    closeWindow: () => {
      /* على أندرويد يتحكم النظام في الخروج */
    },
    isMaximized: async () => true,
    onMaximizeChange: () => () => {},
    setTitleBarOverlay: async () => {},
    printPage: () => {},
    openDataFolder: async () => {},
    exportAnnotations: async (bookId) => {
      const book = db.getBook(bookId)
      if (!book) return null
      const payload = JSON.stringify(
        { book: { title: book.title, author: book.author }, annotations: db.listAnnotations(bookId), bookmarks: db.listBookmarks(bookId) },
        null,
        2
      )
      const rel = `cache/annotations-${bookId}.json`
      await writeDataFile(rel, new TextEncoder().encode(payload))
      try {
        const uri = await Filesystem.getUri({ path: rel, directory: Directory.Data })
        await Share.share({ title: 'تصدير التعليقات', url: uri.uri })
      } catch {
        /* ألغى المستخدم المشاركة */
      }
      return null
    },
    // النسخ الاحتياطي — نفس صيغة سطح المكتب (backup.json + covers/ + files/)
    exportBackup: async (includeFiles: boolean) => {
      const zip = new JSZip()
      zip.file('backup.json', JSON.stringify(db.exportAllData()))
      let covers = 0
      const dir = await Filesystem.readdir({ path: COVERS_DIR, directory: Directory.Data })
      for (const f of dir.files) {
        if (!/\.(png|jpe?g|webp|gif)$/i.test(f.name)) continue
        const bytes = await readDataFile(`${COVERS_DIR}/${f.name}`)
        if (!bytes) continue
        zip.file(`covers/${f.name}`, bytes)
        covers++
      }
      let files = 0
      if (includeFiles) {
        const ldir = await Filesystem.readdir({ path: LIB_DIR, directory: Directory.Data })
        for (const f of ldir.files) {
          if (!/\.(pdf|epub)$/i.test(f.name)) continue
          const bytes = await readDataFile(`${LIB_DIR}/${f.name}`)
          if (!bytes) continue
          zip.file(`files/${f.name}`, bytes)
          files++
        }
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const rel = `cache/maktaba-backup-${stamp}.maktaba.zip`
      await writeDataFile(rel, bytes)
      const uri = await Filesystem.getUri({ path: rel, directory: Directory.Data })
      await Share.share({ title: 'نسخة مكتبة احتياطية', url: uri.uri })
      return { covers, files }
    },
    importBackup: async (): Promise<BackupResult> => {
      const res = await FilePicker.pickFiles({ readData: true, limit: 1, types: ['application/zip', 'application/x-zip-compressed'] })
      const f = res.files[0]
      if (!f?.data) throw new Error('لم يُختر ملف')
      const zip = await JSZip.loadAsync(b64ToBytes(f.data))
      const manifest = zip.file('backup.json')
      if (!manifest) throw new Error('ملف النسخة الاحتياطية غير صالح (لا يحتوي backup.json)')
      const data = JSON.parse(await manifest.async('text')) as Parameters<typeof db.importAllData>[0]
      if (data?.app !== 'maktaba') throw new Error('ملف النسخة الاحتياطية لا يخص تطبيق مكتبة')

      let coversRestored = 0
      const coverMap = new Map<string, string>()
      for (const e of Object.values(zip.files)) {
        const m = /^covers\/([^/\\]+)$/.exec(e.name)
        if (!m || e.dir || !/\.(png|jpe?g|webp|gif)$/i.test(m[1])) continue
        const base = m[1]
        if (!/^[A-Za-z0-9._-]+$/.test(base)) continue
        const bytes = new Uint8Array(await e.async('arraybuffer'))
        await writeDataFile(`${COVERS_DIR}/${base}`, bytes)
        coverMap.set(base, `cap://${COVERS_DIR}/${base}`)
        coversRestored++
      }
      let filesRestored = 0
      for (const e of Object.values(zip.files)) {
        const m = /^files\/([^/\\]+)$/.exec(e.name)
        if (!m || e.dir || !/\.(pdf|epub)$/i.test(m[1])) continue
        const base = m[1]
        if (!/^[A-Za-z0-9._-]+$/.test(base)) continue
        if (await readDataFile(`${LIB_DIR}/${base}`)) continue // موجود فعلًا
        const bytes = new Uint8Array(await e.async('arraybuffer'))
        await writeDataFile(`${LIB_DIR}/${base}`, bytes)
        filesRestored++
      }
      const r = db.importAllData(data, coverMap)
      void coversRestored
      return { ...r, coversRestored, filesRestored }
    },
    platform: 'android' as NodeJS.Platform
  }

  ;(window as unknown as { api: ApiBridge }).api = api
  // تحذير: coverDataUrl مستوردة لضمان تهيئة ذاكرة الأغلفة — استعمال رمزي
  void coverDataUrl
  void db.persistNow
}
