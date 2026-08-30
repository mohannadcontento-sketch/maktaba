import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ApiBridge, Book, BookUpdate } from '../shared/types'

const api: ApiBridge = {
  // استيراد
  pickAndImportBooks: () => ipcRenderer.invoke('books:pickAndImport'),
  pickFolderAndScan: () => ipcRenderer.invoke('books:pickFolderAndScan'),
  pathsForFiles: (files) =>
    Array.from(files).map((f) => {
      try {
        return webUtils.getPathForFile(f)
      } catch {
        return ''
      }
    }),
  importPaths: (paths) => ipcRenderer.invoke('books:importPaths', paths),
  onOpenFiles: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, paths: string[]): void => cb(paths)
    ipcRenderer.on('open-files', listener)
    return () => ipcRenderer.removeListener('open-files', listener)
  },

  // كتب
  listBooks: () => ipcRenderer.invoke('books:list'),
  getBook: (id) => ipcRenderer.invoke('books:get', id),
  updateBook: (id, patch: BookUpdate) => ipcRenderer.invoke('books:update', id, patch),
  deleteBook: (id, deleteFile) => ipcRenderer.invoke('books:delete', id, deleteFile),
  saveCover: (bookId, dataUrl) => ipcRenderer.invoke('covers:save', bookId, dataUrl),
  fetchWebCover: (bookId, title, author) => ipcRenderer.invoke('covers:fetchWeb', bookId, title, author),
  // منتقي الأغلفة 2.2
  searchWebImages: (title, author) => ipcRenderer.invoke('covers:searchWeb', title, author),
  useWebImage: (bookId, url) => ipcRenderer.invoke('covers:useUrl', bookId, url),
  openCoverBrowser: (bookId, query) => ipcRenderer.invoke('covers:openBrowser', bookId, query),
  onCoversUpdated: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, book: Book | null): void => cb(book)
    ipcRenderer.on('covers:updated', listener)
    return () => ipcRenderer.removeListener('covers:updated', listener)
  },
  fileUrl: (id) => ipcRenderer.invoke('files:url', id),
  revealBookFile: (id) => ipcRenderer.invoke('files:reveal', id),

  // وسوم
  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: (name, color) => ipcRenderer.invoke('tags:create', name, color),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', id),
  setBookTags: (bookId, tagIds) => ipcRenderer.invoke('tags:setForBook', bookId, tagIds),

  // مجموعات
  listCollections: () => ipcRenderer.invoke('collections:list'),
  createCollection: (name) => ipcRenderer.invoke('collections:create', name),
  renameCollection: (id, name) => ipcRenderer.invoke('collections:rename', id, name),
  deleteCollection: (id) => ipcRenderer.invoke('collections:delete', id),
  addBookToCollection: (cid, bid) => ipcRenderer.invoke('collections:addBook', cid, bid),
  removeBookFromCollection: (cid, bid) => ipcRenderer.invoke('collections:removeBook', cid, bid),
  getCollectionBookIds: (cid) => ipcRenderer.invoke('collections:bookIds', cid),

  // تعليقات
  listAnnotations: (bookId) => ipcRenderer.invoke('annotations:list', bookId),
  addAnnotation: (a) => ipcRenderer.invoke('annotations:add', a),
  updateAnnotation: (id, patch) => ipcRenderer.invoke('annotations:update', id, patch),
  deleteAnnotation: (id) => ipcRenderer.invoke('annotations:delete', id),

  // علامات مرجعية
  listBookmarks: (bookId) => ipcRenderer.invoke('bookmarks:list', bookId),
  addBookmark: (b) => ipcRenderer.invoke('bookmarks:add', b),
  deleteBookmark: (id) => ipcRenderer.invoke('bookmarks:delete', id),

  // جلسات قراءة
  startSession: (bookId) => ipcRenderer.invoke('sessions:start', bookId),
  sessionHeartbeat: (sid, seconds, pagesRead) => ipcRenderer.invoke('sessions:heartbeat', sid, seconds, pagesRead),
  endSession: (sid, seconds, pagesRead) => ipcRenderer.invoke('sessions:end', sid, seconds, pagesRead),
  stats: () => ipcRenderer.invoke('stats:summary'),

  // إعدادات
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // نظام
  minimizeWindow: () => ipcRenderer.send('win:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('win:toggleMaximize'),
  closeWindow: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onMaximizeChange: (cb) => {
    const listener = (): void => void cb(true)
    // أحداث التكبير تُرصد عبر الاستقصاء البسيط في الواجهة
    window.addEventListener('resize', listener)
    return () => window.removeEventListener('resize', listener)
  },
  setTitleBarOverlay: (opts) => ipcRenderer.invoke('win:titleBarOverlay', opts),
  printPage: () => ipcRenderer.send('print:current'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  exportAnnotations: (bookId) => ipcRenderer.invoke('annotations:export', bookId),
  // النسخ الاحتياطي (النسخة 2)
  exportBackup: (includeFiles) => ipcRenderer.invoke('backup:export', includeFiles),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type { ApiBridge }
