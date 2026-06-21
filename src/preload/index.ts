import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  project: {
    open: () =>
      ipcRenderer.invoke('project:open'),
    save: (filePath: string, content: string) =>
      ipcRenderer.invoke('project:save', filePath, content),
  },
  compiler: {
    compile: (filePath: string) =>
      ipcRenderer.invoke('compiler:compile', filePath),
  },
  pdf: {
    read: (pdfPath: string) =>
      ipcRenderer.invoke('pdf:read', pdfPath),
  },
  fs: {
    readDir:    (dirPath: string) =>
      ipcRenderer.invoke('fs:readDir', dirPath),
    readFile:   (filePath: string) =>
      ipcRenderer.invoke('fs:readFile', filePath),
    createFile: (filePath: string) =>
      ipcRenderer.invoke('fs:createFile', filePath),
    createDir:  (dirPath: string) =>
      ipcRenderer.invoke('fs:createDir', dirPath),
    rename:     (oldPath: string, newPath: string) =>
      ipcRenderer.invoke('fs:rename', oldPath, newPath),
    delete:     (entryPath: string) =>
      ipcRenderer.invoke('fs:delete', entryPath),
  },
  dialog: {
    confirm: (title: string, message: string) =>
      ipcRenderer.invoke('dialog:confirm', title, message) as Promise<boolean>,
  },
  config: {
    getProject:  (rootDir: string) =>
      ipcRenderer.invoke('config:getProject', rootDir),
    setMain:     (rootDir: string, absPath: string) =>
      ipcRenderer.invoke('config:setMain', rootDir, absPath),
    setLastOpen: (rootDir: string, absPath: string) =>
      ipcRenderer.invoke('config:setLastOpen', rootDir, absPath),
  },
  app: {
    getStartupState: () =>
      ipcRenderer.invoke('app:getStartupState'),
  },
  synctex: {
    forward: (synctexPath: string, texFile: string, line: number) =>
      ipcRenderer.invoke('synctex:forward', synctexPath, texFile, line),
    reverse: (synctexPath: string, page: number, h: number, v: number) =>
      ipcRenderer.invoke('synctex:reverse', synctexPath, page, h, v),
  },
})
