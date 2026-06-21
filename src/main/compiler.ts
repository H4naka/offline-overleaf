import { spawn } from 'child_process'
import { dirname, basename, join } from 'path'
import { type LatexDiagnostic, parseLogFile } from './logParser'

export type { LatexDiagnostic }

export interface CompileResult {
  ok: boolean
  pdfPath?: string
  synctexPath?: string
  log: string
  errors: string[]              // error messages only (subset of diagnostics)
  diagnostics: LatexDiagnostic[]
}

export function compile(texFilePath: string): Promise<CompileResult> {
  const dir  = dirname(texFilePath)
  const file = basename(texFilePath)
  const stem = file.replace(/\.tex$/, '')

  return new Promise((resolve) => {
    const args = [
      '-interaction=nonstopmode',
      '-synctex=1',
      '-output-directory', dir,
      file,
    ]

    const proc = spawn('pdflatex', args, { cwd: dir })

    let stdout = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stdout += chunk.toString() })

    proc.on('close', async (code) => {
      const logPath     = join(dir, stem + '.log')
      const pdfPath     = join(dir, stem + '.pdf')
      const synctexPath = join(dir, stem + '.synctex.gz')

      // Prefer the .log file pdflatex writes to disk: it is the complete,
      // untruncated log free of any stdout-buffering artifacts.
      const diagnostics = await parseLogFile(logPath, stdout, texFilePath)
      const errors      = diagnostics
        .filter(d => d.severity === 'error')
        .map(d => d.message)

      resolve({
        ok: code === 0,
        pdfPath:      code === 0 ? pdfPath      : undefined,
        synctexPath:  code === 0 ? synctexPath  : undefined,
        log: stdout,
        errors,
        diagnostics,
      })
    })

    proc.on('error', (err) => {
      const msg = err.message.includes('ENOENT')
        ? 'pdflatex not found — install TeX Live and add it to PATH.'
        : err.message
      resolve({
        ok: false,
        log: err.message,
        errors: [msg],
        diagnostics: [{ file: texFilePath, line: 0, severity: 'error', message: msg }],
      })
    })
  })
}
