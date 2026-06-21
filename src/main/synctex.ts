/**
 * Minimal SyncTeX parser for the subset needed by forward/reverse search.
 *
 * The .synctex.gz file is a gzipped text file with three sections:
 *   Header  — Input:tag:filename mappings + metadata
 *   Content — per-page hbox/vbox/point records
 *   Postamble
 *
 * Coordinates are in "scaled points" (sp): 1 pt = 65536 sp, 1 in = 4 736 286 sp.
 * The `v` value of a record is the BASELINE vertical position measured downward
 * from the top of the page; `height` extends above and `depth` below baseline.
 * This maps directly to PDF.js canvas y-coordinates (both have y=0 at top).
 */

import { createGunzip } from 'zlib'
import { createReadStream } from 'fs'
import { join, normalize, isAbsolute, dirname } from 'path'

export interface SyncTeXRecord {
  page: number
  tag: number
  line: number
  h: number       // sp, from left edge of page
  v: number       // sp, baseline from top of page (downward positive)
  width: number   // sp
  height: number  // sp, above baseline
  depth: number   // sp, below baseline
}

interface ParsedSyncTeX {
  unit: number
  inputs: Map<number, string>  // tag → absolute, normalised file path
  records: SyncTeXRecord[]
}

// ── I/O ──────────────────────────────────────────────────────────────────────

function readGzip(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    createReadStream(filePath)
      .pipe(createGunzip())
      .on('data', (c: Buffer) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      .on('error', reject)
  })
}

// ── Parsing ───────────────────────────────────────────────────────────────────

// SyncTeX v1 (pdflatex) format uses colon between field groups and comma
// within each group:  tag,line:h,v:width,height,depth
// parseInt(p) is correct — it stops at the first non-digit, which is fine
// here because we split on commas first.
function parseFields(s: string): number[] {
  return s.split(':').flatMap(grp => grp.split(',').map(p => parseInt(p.trim(), 10)))
}

function makeRecord(page: number, r: number[], unit: number): SyncTeXRecord {
  return {
    page,
    tag:    r[0] ?? 0,
    line:   r[1] ?? 0,
    h:      (r[2] ?? 0) * unit,
    v:      (r[3] ?? 0) * unit,
    width:  (r[4] ?? 0) * unit,
    height: (r[5] ?? 0) * unit,
    depth:  (r[6] ?? 0) * unit,
  }
}

function parseText(text: string, compilationDir: string): ParsedSyncTeX {
  const inputs  = new Map<number, string>()
  const records: SyncTeXRecord[] = []
  let unit   = 1
  let phase: 'header' | 'content' | 'done' = 'header'
  let currentPage = 0

  for (const raw of text.split('\n')) {
    const ln = raw.trim()
    if (!ln) continue

    if (phase === 'header') {
      if (ln.startsWith('Input:')) {
        const rest   = ln.slice(6)
        const colon  = rest.indexOf(':')
        if (colon !== -1) {
          const tag = parseInt(rest.slice(0, colon), 10)
          let   f   = rest.slice(colon + 1)
          if (!isAbsolute(f)) f = join(compilationDir, f)
          if (!isNaN(tag)) inputs.set(tag, normalize(f))
        }
      } else if (ln.startsWith('Unit:')) {
        const u = parseInt(ln.slice(5), 10)
        if (!isNaN(u) && u > 0) unit = u
      } else if (ln === 'Content:') {
        phase = 'content'
      }
      continue
    }

    if (phase === 'content') {
      if (ln.startsWith('Postamble:')) { phase = 'done'; break }

      const ch = ln[0]

      if (ch === '{') {
        // pdflatex SyncTeX only uses { for page starts: {N
        const rest = ln.slice(1)
        if (/^\d+$/.test(rest)) currentPage = parseInt(rest, 10)

      } else if (ch === '[' || ch === '(' || ch === 'h') {
        // hbox ([), vbox ((), horizontal rule (h)
        // Format: tag,line:h,v:width,height,depth  (7 values after parseFields)
        const r = parseFields(ln.slice(1))
        if (r.length >= 7 && !isNaN(r[0]) && !isNaN(r[2])) {
          records.push(makeRecord(currentPage, r, unit))
        }

      } else if (ch === 'x' || ch === 'g') {
        // kern-point (x) and glyph (g): tag,line:h,v  (4 values, no bounding box)
        const r = parseFields(ln.slice(1))
        if (r.length >= 4 && !isNaN(r[0]) && !isNaN(r[2])) {
          records.push({
            page: currentPage,
            tag: r[0], line: r[1] ?? 0,
            h: (r[2] ?? 0) * unit, v: (r[3] ?? 0) * unit,
            width: 0, height: 0, depth: 0,
          })
        }
      }
      // Closing delimiters (}, ], ), k, r, I, !) carry no data we need
    }
  }

  return { unit, inputs, records }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseSyncTeX(synctexPath: string): Promise<ParsedSyncTeX> {
  const text = await readGzip(synctexPath)
  return parseText(text, dirname(synctexPath))
}

/**
 * Forward search: given an absolute .tex file path and a 1-based line number,
 * return the best PDF position, or null if no match.
 */
export async function forwardSearch(
  synctexPath: string,
  absTexFile:  string,
  targetLine:  number,
): Promise<{ page: number; h: number; v: number; width: number; height: number; depth: number } | null> {
  const data = await parseSyncTeX(synctexPath)
  const norm = normalize(absTexFile).toLowerCase()

  let tag: number | null = null
  for (const [t, f] of data.inputs) {
    if (normalize(f).toLowerCase() === norm) { tag = t; break }
  }
  if (tag === null) return null

  // Only use records with non-zero width (text boxes, not invisible points)
  const fileRecs = data.records.filter(r => r.tag === tag && r.width > 0)
  if (fileRecs.length === 0) return null

  // Sort by closest line; break ties by preferring larger width (wider = more specific text span)
  const sorted = fileRecs.slice().sort((a, b) => {
    const da = Math.abs(a.line - targetLine)
    const db = Math.abs(b.line - targetLine)
    return da !== db ? da - db : b.width - a.width
  })

  const best = sorted[0]
  return { page: best.page, h: best.h, v: best.v, width: best.width, height: best.height, depth: best.depth }
}

/**
 * Reverse search: given a PDF page and a click position in scaled points,
 * return the source file and 1-based line number, or null if no match.
 */
export async function reverseSearch(
  synctexPath: string,
  page:        number,
  hClick:      number,  // sp
  vClick:      number,  // sp
): Promise<{ file: string; line: number } | null> {
  const data = await parseSyncTeX(synctexPath)

  // All records on this page (box records with width>0 for containment check;
  // point records for nearest-point fallback).
  const pageRecs = data.records.filter(r => r.page === page)
  if (pageRecs.length === 0) return null

  const boxRecs   = pageRecs.filter(r => r.width > 0)
  const pointRecs = pageRecs.filter(r => r.width === 0)

  // Try boxes first: prefer smallest bounding box that contains the click.
  const containing = boxRecs.filter(r => {
    const top = r.v - r.height
    const bot = r.v + r.depth
    const inH = r.h <= hClick && hClick <= r.h + r.width
    const inV = top <= vClick && vClick <= bot + r.height  // slight downward tolerance
    return inH && inV
  })

  let candidates = containing.length > 0
    // Smallest box area = most specific match
    ? containing.sort((a, b) =>
        a.width * Math.max(a.height + a.depth, 1) -
        b.width * Math.max(b.height + b.depth, 1))
    : []

  if (candidates.length === 0) {
    // Fall back to nearest glyph/kern point (weighted distance, vertical 3×)
    const pool = pointRecs.length > 0 ? pointRecs : boxRecs
    candidates = pool.slice().sort((a, b) => {
      const ch_a = a.width > 0 ? a.h + a.width / 2 : a.h
      const ch_b = b.width > 0 ? b.h + b.width / 2 : b.h
      const dh_a = ch_a - hClick
      const dv_a = (a.v - vClick) * 3
      const dh_b = ch_b - hClick
      const dv_b = (b.v - vClick) * 3
      return (dh_a * dh_a + dv_a * dv_a) - (dh_b * dh_b + dv_b * dv_b)
    })
  }

  const best = candidates[0]
  if (!best) return null
  const file = data.inputs.get(best.tag)
  return file ? { file, line: best.line } : null
}
