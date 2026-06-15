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
})
