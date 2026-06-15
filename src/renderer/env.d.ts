/// <reference types="vite/client" />

interface CompileResult {
  ok: boolean
  pdfPath?: string
  log: string
  errors: string[]
}

interface Window {
  api: {
    project: {
      open: () => Promise<{
        ok: boolean
        data?: { filePath: string; content: string }
        error?: string
      }>
      save: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>
    }
    compiler: {
      compile: (filePath: string) => Promise<CompileResult>
    }
    pdf: {
      read: (pdfPath: string) => Promise<{
        ok: boolean
        data?: Uint8Array
        error?: string
      }>
    }
  }
}
