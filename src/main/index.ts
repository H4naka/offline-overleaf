import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { compile } from './compiler'
import {
  readDir, createFile, createDir,
  renameEntry, deleteEntry, readTextFile,
} from './fsOps'
import { getProjectConfig, setMainTexFile, setLastOpenFile, getStartupState } from './appState'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── project ──────────────────────────────────────────────────────────────────

ipcMain.handle('project:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'LaTeX', extensions: ['tex'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return { ok: false, error: 'Cancelled' }
  try {
    const filePath = filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    return { ok: true, data: { filePath, content } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('project:save', async (_e, filePath: string, content: string) => {
  try {
    await writeFile(filePath, content, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ── compiler ─────────────────────────────────────────────────────────────────

ipcMain.handle('compiler:compile', async (_e, filePath: string) => {
  return compile(filePath)
})

// ── pdf ──────────────────────────────────────────────────────────────────────

ipcMain.handle('pdf:read', async (_e, pdfPath: string) => {
  try {
    const buf = await readFile(pdfPath)
    return { ok: true, data: new Uint8Array(buf) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ── file system ───────────────────────────────────────────────────────────────

ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
  try {
    return { ok: true, data: await readDir(dirPath) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
  try {
    return { ok: true, content: await readTextFile(filePath) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('fs:createFile', async (_e, filePath: string) => {
  try {
    await createFile(filePath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('fs:createDir', async (_e, dirPath: string) => {
  try {
    await createDir(dirPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('fs:rename', async (_e, oldPath: string, newPath: string) => {
  try {
    await renameEntry(oldPath, newPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('fs:delete', async (_e, entryPath: string) => {
  try {
    await deleteEntry(entryPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

// ── dialog ───────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:confirm', async (_e, title: string, message: string) => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
  })
  return response === 0
})

// ── project config + app state ────────────────────────────────────────────────

ipcMain.handle('config:getProject', async (_e, rootDir: string) => {
  try {
    return { ok: true, data: await getProjectConfig(rootDir) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('config:setMain', async (_e, rootDir: string, absPath: string) => {
  try {
    await setMainTexFile(rootDir, absPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('config:setLastOpen', async (_e, rootDir: string, absPath: string) => {
  try {
    await setLastOpenFile(rootDir, absPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('app:getStartupState', async () => {
  try {
    return { ok: true, data: await getStartupState() }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
