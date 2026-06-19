/// <reference types="vite/client" />

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileEntry[]
}

interface CompileResult {
  ok: boolean
  pdfPath?: string
  log: string
  errors: string[]
}

type IpcOk<T = undefined> = T extends undefined
  ? { ok: true }
  : { ok: true; data: T }
type IpcErr = { ok: false; error: string }
type IpcResult<T = undefined> = IpcOk<T> | IpcErr

interface Window {
  api: {
    project: {
      open: () => Promise<IpcResult<{ filePath: string; content: string }>>
      save: (filePath: string, content: string) => Promise<IpcResult>
    }
    compiler: {
      compile: (filePath: string) => Promise<CompileResult>
    }
    pdf: {
      read: (pdfPath: string) => Promise<{ ok: boolean; data?: Uint8Array; error?: string }>
    }
    fs: {
      readDir:    (dirPath: string)  => Promise<IpcResult<FileEntry[]>>
      readFile:   (filePath: string) => Promise<{ ok: boolean; content?: string; error?: string }>
      createFile: (filePath: string) => Promise<IpcResult>
      createDir:  (dirPath: string)  => Promise<IpcResult>
      rename:     (oldPath: string, newPath: string) => Promise<IpcResult>
      delete:     (entryPath: string) => Promise<IpcResult>
    }
    dialog: {
      confirm: (title: string, message: string) => Promise<boolean>
    }
    config: {
      getProject:  (rootDir: string)                  => Promise<IpcResult<{ mainTexFile: string | null; lastOpenFile: string | null }>>
      setMain:     (rootDir: string, absPath: string) => Promise<IpcResult>
      setLastOpen: (rootDir: string, absPath: string) => Promise<IpcResult>
    }
    app: {
      getStartupState: () => Promise<IpcResult<{ rootDir: string; mainTexFile: string | null; lastOpenFile: string | null } | null>>
    }
  }
}
