import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import {
  addAnnotation,
  addBookmark,
  addBookToCollection,
  createCollection,
  createTag,
  deleteAnnotation,
  deleteBookmark,
  deleteBookRow,
  deleteCollection,
  deleteTag,
  getBook,
  getCollectionBookIds,
  getSetting,
  listAnnotations,
  listBooks,
  listBookmarks,
  listCollections,
  listTags,
  removeBookFromCollection,
  renameCollection,
  sessionProgress,
  setBookTags,
  setSetting,
  startSession,
  statsSummary,
  updateAnnotation,
  updateBook
} from './db'
import { bookFilePath, coversDir, importPaths, removeBookFiles, scanFolderForBooks, fetchAndSaveCover } from './library'
import { exportBackup, importBackup, pickExportTarget, pickImportSource } from './backup'

function win(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

export function registerIpc(): void {
  // ---------- استيراد ----------
  ipcMain.handle('books:pickAndImport', async () => {
    const res = await dialog.showOpenDialog(win()!, {
      title: 'استيراد كتب',
      filters: [{ name: 'الكتب الإلكترونية', extensions: ['pdf', 'epub'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || !res.filePaths.length) return []
    return importPaths(res.filePaths)
  })

  ipcMain.handle('books:pickFolderAndScan', async () => {
    const res = await dialog.showOpenDialog(win()!, {
      title: 'اختيار مجلد للمسح',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths.length) return []
    const found = scanFolderForBooks(res.filePaths[0])
    if (!found.length) return []
    return importPaths(found)
  })

  ipcMain.handle('books:importPaths', (_e, paths: string[]) => importPaths(paths))

  // ---------- كتب ----------
  ipcMain.handle('books:list', () => listBooks())
  ipcMain.handle('books:get', (_e, id: string) => getBook(id))

  ipcMain.handle('books:update', (_e, id: string, patch: Parameters<typeof updateBook>[1]) => {
    updateBook(id, patch)
  })

  ipcMain.handle('books:delete', (_e, id: string, deleteFile: boolean) => {
    const book = getBook(id)
    if (!book) return
    if (deleteFile) removeBookFiles(book.fileName, book.coverPath)
    deleteBookRow(id)
  })

  ipcMain.handle('covers:save', (_e, bookId: string, dataUrl: string) => {
    const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl)
    if (!m) throw new Error('bad data url')
    const ext = m[1] === 'png' ? 'png' : 'jpg'
    const file = path.join(coversDir(), `${bookId}.${ext}`)
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
    updateBook(bookId, { coverPath: file })
    return file
  })

  // جلب غلاف من الويب (مثل Moon Reader) وحفظه
  ipcMain.handle('covers:fetchWeb', async (_e, bookId: string, title: string, author?: string | null) => {
    const saved = await fetchAndSaveCover(bookId, title, author)
    if (saved) {
      const b = getBook(bookId)
      if (b) return b
    }
    return null
  })

  ipcMain.handle('files:url', async (_e, id: string) => {
    const book = getBook(id)
    if (!book) throw new Error('book not found')
    return `book://${id}/${encodeURIComponent(book.fileName)}`
  })

  ipcMain.handle('files:reveal', (_e, id: string) => {
    const book = getBook(id)
    if (!book) return
    shell.showItemInFolder(bookFilePath(book.fileName))
  })

  // ---------- وسوم ----------
  ipcMain.handle('tags:list', () => listTags())
  ipcMain.handle('tags:create', (_e, name: string, color: string) => createTag(name, color))
  ipcMain.handle('tags:delete', (_e, id: number) => deleteTag(id))
  ipcMain.handle('tags:setForBook', (_e, bookId: string, tagIds: number[]) => setBookTags(bookId, tagIds))

  // ---------- مجموعات ----------
  ipcMain.handle('collections:list', () => listCollections())
  ipcMain.handle('collections:create', (_e, name: string) => createCollection(name))
  ipcMain.handle('collections:rename', (_e, id: number, name: string) => renameCollection(id, name))
  ipcMain.handle('collections:delete', (_e, id: number) => deleteCollection(id))
  ipcMain.handle('collections:addBook', (_e, cid: number, bid: string) => addBookToCollection(cid, bid))
  ipcMain.handle('collections:removeBook', (_e, cid: number, bid: string) => removeBookFromCollection(cid, bid))
  ipcMain.handle('collections:bookIds', (_e, cid: number) => getCollectionBookIds(cid))

  // ---------- تعليقات ----------
  ipcMain.handle('annotations:list', (_e, bookId: string) => listAnnotations(bookId))
  ipcMain.handle('annotations:add', (_e, a) => addAnnotation(a))
  ipcMain.handle('annotations:update', (_e, id: string, patch) => updateAnnotation(id, patch))
  ipcMain.handle('annotations:delete', (_e, id: string) => deleteAnnotation(id))

  // ---------- علامات مرجعية ----------
  ipcMain.handle('bookmarks:list', (_e, bookId: string) => listBookmarks(bookId))
  ipcMain.handle('bookmarks:add', (_e, b) => addBookmark(b))
  ipcMain.handle('bookmarks:delete', (_e, id: string) => deleteBookmark(id))

  // ---------- جلسات وإحصائيات ----------
  ipcMain.handle('sessions:start', (_e, bookId: string) => startSession(bookId))
  ipcMain.handle('sessions:heartbeat', (_e, sid: number, seconds: number, pages: number) =>
    sessionProgress(sid, seconds, pages, false)
  )
  ipcMain.handle('sessions:end', (_e, sid: number, seconds: number, pages: number) =>
    sessionProgress(sid, seconds, pages, true)
  )
  ipcMain.handle('stats:summary', () => statsSummary())

  // ---------- إعدادات ----------
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: string) => setSetting(key, value))

  // ---------- نظام ----------
  ipcMain.on('win:minimize', () => win()?.minimize())
  ipcMain.on('win:toggleMaximize', () => {
    const w = win()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('win:close', () => win()?.close())
  ipcMain.handle('win:isMaximized', () => !!win()?.isMaximized())
  ipcMain.handle('win:titleBarOverlay', (_e, opts: { color?: string; symbolColor?: string }) => {
    try {
      win()?.setTitleBarOverlay(opts)
    } catch {
      /* غير مدعوم قبل جاهزية النافذة */
    }
  })

  ipcMain.on('print:current', () => {
    const w = win()
    w?.webContents.print({ printBackground: true }, (ok, err) => {
      if (!ok && err) console.error('print failed:', err)
    })
  })

  ipcMain.handle('app:dataFolder', () => app.getPath('userData'))
  ipcMain.handle('app:openDataFolder', async () => {
    await shell.openPath(app.getPath('userData'))
  })

  // ---------- النسخ الاحتياطي (النسخة 2) ----------
  ipcMain.handle('backup:export', async (_e, includeFiles: boolean) => {
    const target = await pickExportTarget()
    if (!target) return null
    return await exportBackup(target, !!includeFiles)
  })
  ipcMain.handle('backup:import', async () => {
    const src = await pickImportSource()
    if (!src) return null
    return await importBackup(src)
  })

  ipcMain.handle(
    'annotations:export',
    async (_e, bookId: string): Promise<string | null> => {
      const book = getBook(bookId)
      if (!book) return null
      const anns = listAnnotations(bookId)
      const bms = listBookmarks(bookId)
      const res = await dialog.showSaveDialog(win()!, {
        title: 'تصدير التعليقات',
        defaultPath: `${book.title} - تعليقات.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return null
      fs.writeFileSync(
        res.filePath,
        JSON.stringify({ book: { title: book.title, author: book.author }, annotations: anns, bookmarks: bms }, null, 2),
        'utf8'
      )
      return res.filePath
    }
  )
}
