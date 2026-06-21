import { spawn } from 'child_process'
import { dirname, basename, join } from 'path'

export interface CompileResult {
  ok: boolean
  pdfPath?: string
  synctexPath?: string
  log: string
  errors: string[]
}

export function compile(texFilePath: string): Promise<CompileResult> {
  const dir = dirname(texFilePath)
  const file = basename(texFilePath)

  return new Promise((resolve) => {
    const args = [
      '-interaction=nonstopmode',
      '-synctex=1',
      '-output-directory', dir,
      file,
    ]

    const proc = spawn('pdflatex', args, { cwd: dir })

    let log = ''
    proc.stdout.on('data', (chunk: Buffer) => { log += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { log += chunk.toString() })

    proc.on('close', (code) => {
      const errors = extractErrors(log)
      const stem       = file.replace(/\.tex$/, '')
      const pdfPath    = join(dir, stem + '.pdf')
      const synctexPath = join(dir, stem + '.synctex.gz')
      resolve({
        ok: code === 0,
        pdfPath:     code === 0 ? pdfPath     : undefined,
        synctexPath: code === 0 ? synctexPath : undefined,
        log,
        errors,
      })
    })

    proc.on('error', (err) => {
      const msg = err.message
      resolve({
        ok: false,
        log: msg,
        errors: [
          msg.includes('ENOENT')
            ? 'pdflatex not found — install TeX Live and add it to PATH.'
            : msg,
        ],
      })
    })
  })
}

function extractErrors(log: string): string[] {
  return log
    .split('\n')
    .filter((line) => /^!/.test(line) || /^l\.\d+/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
}
