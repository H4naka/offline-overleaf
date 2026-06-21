/**
 * Parses pdflatex compile logs into structured diagnostics.
 *
 * Quirks handled:
 *  1. pdflatex wraps every physical line at column 79 – we re-join them before
 *     pattern matching so multi-word error messages are captured whole.
 *  2. File context is tracked via parenthesis nesting through the raw log;
 *     we scan character-by-character with file-path heuristics to exclude
 *     font specs, package option lists, and other false-positive '(' tokens.
 *  3. Error records span multiple lines: "! message" then later "l.NN context".
 *  4. Warning line numbers are embedded as "on input line NN" or "at lines NN--NN".
 */

import { readFile } from 'fs/promises'
import { join, normalize, isAbsolute, dirname } from 'path'

export interface LatexDiagnostic {
  file:     string   // absolute, normalised path
  line:     number   // 1-based; 0 = line number unknown
  severity: 'error' | 'warning'
  message:  string
}

// ── Line joining ───────────────────────────────────────────────────────────────

/**
 * pdflatex physically wraps lines at column 79.  Consecutive raw lines where
 * the first is exactly 79 chars are merged into one logical line.
 * Returns the merged lines and a parallel array of which raw-line index each
 * merged line begins at (used to correlate with the file-stack map).
 */
function joinLines(raw: string): { lines: string[]; startAt: number[] } {
  const rawLines = raw.split('\n')
  const lines:   string[] = []
  const startAt: number[] = []
  let i = 0
  while (i < rawLines.length) {
    const start = i
    let line = rawLines[i].replace(/\r$/, '')
    while (line.length === 79 && i + 1 < rawLines.length) {
      i++
      line += rawLines[i].replace(/\r$/, '')
    }
    lines.push(line)
    startAt.push(start)
    i++
  }
  return { lines, startAt }
}

// ── File-path heuristic ────────────────────────────────────────────────────────

/**
 * Conservative check: return true only if the string looks like a file path
 * that pdflatex would emit.  The goal is to exclude TeX font specs such as
 * "\T1/cmr/m/n/10.95" and package option lists while admitting real paths.
 */
function looksLikeFilePath(s: string): boolean {
  if (s.length < 2)  return false
  if (/\s/.test(s))  return false
  // Must end with a plausible file extension
  if (!/\.[a-zA-Z][a-zA-Z0-9]{0,5}$/.test(s)) return false

  const c0 = s[0]
  if (c0 === '/')                               return true   // Unix absolute
  if (c0 === '~')                               return true   // home-relative
  if (c0 === '.' && (s[1] === '/' || s[1] === '\\'))         return true   // ./
  if (c0 === '.' && s[1] === '.' && s.length > 2
      && (s[2] === '/' || s[2] === '\\'))       return true   // ../
  if (/^[a-zA-Z]:[\\/]/.test(s))               return true   // C:\... / C:/...
  // Relative with a dir separator, but NOT starting with '\' (TeX command)
  if (c0 !== '\\' && (s.includes('/') ||
      (s.includes('\\') && /^[a-zA-Z0-9]/.test(s)))) return true
  // Bare TeX-related filename without dir component: main.tex, article.cls …
  if (/^[a-zA-Z0-9_\-.]+\.(tex|sty|cls|def|cfg|fd|bst|bbl|aux|toc|lof|lot|ind|idx|bib)$/
      .test(s))                                 return true

  return false
}

function resolvePath(f: string, baseDir: string): string {
  return normalize(isAbsolute(f) ? f : join(baseDir, f))
}

// ── File-stack tracking ────────────────────────────────────────────────────────

/**
 * Scan raw (pre-join) lines character-by-character, tracking the current file
 * via parenthesis nesting.  Each element of the returned array holds the file
 * that was current BEFORE that raw line was processed (so errors on a given
 * raw line correctly inherit the file that was active entering that line).
 */
function buildFileAtRaw(rawLines: string[], baseDir: string): string[] {
  const stack:  string[] = []
  const result: string[] = new Array(rawLines.length).fill('')

  for (let ri = 0; ri < rawLines.length; ri++) {
    result[ri] = stack[stack.length - 1] ?? ''

    const line = rawLines[ri].replace(/\r$/, '')
    let j = 0
    while (j < line.length) {
      if (line[j] === '(') {
        // Grab all non-whitespace, non-paren chars immediately after '('
        const rest = line.slice(j + 1)
        const m = rest.match(/^([^\s()]+)/)
        if (m && looksLikeFilePath(m[1])) {
          stack.push(resolvePath(m[1], baseDir))
          j += m[1].length + 1
          continue
        }
      } else if (line[j] === ')') {
        if (stack.length > 0) stack.pop()
      }
      j++
    }
  }

  return result
}

// ── Pattern matching ───────────────────────────────────────────────────────────

// LaTeX / Package / Class warnings
const LATEX_WARN_RE  = /^(?:LaTeX|Package \S+|Class \S+) Warning:\s*(.+)$/
// Overfull / Underfull boxes
const OVERUNDER_RE   = /^(?:Over|Under)full \\[hv]box/
// "at lines NN" or "at lines NN--NN" (Overfull/Underfull)
const AT_LINES_RE    = /at lines? (\d+)/
// "on input line NN." embedded in warning messages
const INPUT_LINE_RE  = /on input line (\d+)/
// Error line indicator written by pdflatex: "l.NN  context"
const LNUM_RE        = /^l\.(\d+)[ \t]/

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse a pdflatex log string into structured diagnostics.
 *
 * @param log      Full text of the .log file (or captured stdout/stderr).
 * @param mainFile Absolute path to the compiled .tex file; used as the
 *                 fallback file when the log's file stack is momentarily empty.
 */
export function parseLatexLog(log: string, mainFile: string): LatexDiagnostic[] {
  const baseDir    = dirname(mainFile)
  const rawLines   = log.split('\n')
  const fileAtRaw  = buildFileAtRaw(rawLines, baseDir)
  const { lines, startAt } = joinLines(log)

  const diagnostics: LatexDiagnostic[] = []
  const seen = new Set<string>()

  function push(d: LatexDiagnostic): void {
    const key = `${d.severity}\0${d.file}\0${d.line}\0${d.message}`
    if (!seen.has(key)) { seen.add(key); diagnostics.push(d) }
  }

  for (let i = 0; i < lines.length; i++) {
    const ln   = lines[i]
    const file = fileAtRaw[startAt[i]] || mainFile

    // ── Error: "! ..." ─────────────────────────────────────────────────────
    if (ln.startsWith('!')) {
      const msg = ln.slice(1).trim()
      let errLine = 0
      // Scan ahead (up to 15 logical lines) for the "l.NN" position marker
      for (let k = i + 1; k < Math.min(i + 15, lines.length); k++) {
        const lm = lines[k].match(LNUM_RE)
        if (lm) { errLine = parseInt(lm[1], 10); i = k; break }
        // After two consecutive blank lines with no 'l.NN', give up
        if (!lines[k] && k > i + 2 && !lines[k - 1]) break
      }
      push({ file, line: errLine, severity: 'error', message: msg })
      continue
    }

    // ── LaTeX / Package / Class warning ───────────────────────────────────
    const wm = ln.match(LATEX_WARN_RE)
    if (wm) {
      const msg  = wm[1].trim()
      const lm   = INPUT_LINE_RE.exec(msg)
      push({ file, line: lm ? parseInt(lm[1], 10) : 0, severity: 'warning', message: msg })
      continue
    }

    // ── Overfull / Underfull ─────────────────────────────────────────────
    if (OVERUNDER_RE.test(ln)) {
      const lm = AT_LINES_RE.exec(ln)
      push({ file, line: lm ? parseInt(lm[1], 10) : 0, severity: 'warning', message: ln.trim() })
      continue
    }
  }

  return diagnostics
}

/**
 * Read the .log file pdflatex writes alongside the PDF and parse it.
 * Falls back to the captured stdout string if the file cannot be read.
 */
export async function parseLogFile(
  logPath:          string,
  stdoutFallback:   string,
  mainTexFile:      string,
): Promise<LatexDiagnostic[]> {
  let text = stdoutFallback
  try { text = await readFile(logPath, 'utf-8') } catch { /* use stdout fallback */ }
  return parseLatexLog(text, mainTexFile)
}
