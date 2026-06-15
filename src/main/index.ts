import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { compile } from './compiler'

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

ipcMain.handle('project:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'LaTeX', extensions: ['tex'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return { ok: false, error: 'Cancelled' }
  const filePath = filePaths[0]
  try {
    const content = await readFile(filePath, 'utf-8')
    return { ok: true, data: { filePath, content } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('project:save', async (_event, filePath: string, content: string) => {
  try {
    await writeFile(filePath, content, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('compiler:compile', async (_event, filePath: string) => {
  return compile(filePath)
})

ipcMain.handle('pdf:read', async (_event, pdfPath: string) => {
  try {
    const buf = await readFile(pdfPath)
    return { ok: true, data: new Uint8Array(buf) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})
