import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask, TextLayer as TextLayerInstance } from 'pdfjs-dist'
import styles from './PdfViewer.module.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

interface Props {
  pdfPath?: string
  compileVersion: number
  status: 'idle' | 'compiling' | 'success' | 'error'
  errors: string[]
  log: string
  synctexPath?: string
  forwardTarget?: SyncForwardTarget
  onReverseSearch?: (file: string, line: number) => void
}

// ── Per-page highlight geometry (CSS pixels at current scale) ─────────────────
interface HighlightRect { x: number; y: number; w: number; h: number; key: number }

function toHighlightRect(t: SyncForwardTarget, scale: number): HighlightRect {
  const SP = 65536
  const x = (t.h / SP) * scale
  // v is the baseline; highlight box spans height above + depth below baseline
  const boxTop    = t.height > 0 ? ((t.v - t.height) / SP) * scale : (t.v / SP) * scale - 8
  const boxHeight = t.height > 0 ? ((t.height + t.depth) / SP) * scale : 16
  return {
    x,
    y: boxTop,
    w: Math.max((t.width / SP) * scale, 80),
    h: Math.max(boxHeight, 10),
    key: t.key,
  }
}

// ── Single page component ─────────────────────────────────────────────────────
function PdfPage({ doc, pageNum, scale, highlight, onDblClick }: {
  doc: PDFDocumentProxy
  pageNum: number
  scale: number
  highlight?: HighlightRect
  onDblClick?: (x: number, y: number) => void
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const taskRef      = useRef<RenderTask | null>(null)
  const tlRef        = useRef<TextLayerInstance | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const page = await doc.getPage(pageNum)
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      const canvas   = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      taskRef.current?.cancel()

      const dpr = window.devicePixelRatio ?? 1
      canvas.width  = Math.floor(viewport.width  * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width  = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      const transform: [number, number, number, number, number, number] =
        [dpr, 0, 0, dpr, 0, 0]

      const task = page.render({ canvasContext: ctx, viewport, transform })
      taskRef.current = task
      try { await task.promise } catch { /* cancelled */ }
      if (cancelled) return

      // ── Text layer (enables text selection) ──────────────────────────────────
      const tlDiv = textLayerRef.current
      if (!tlDiv) return

      tlRef.current?.cancel()
      tlDiv.innerHTML = ''

      const tl = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: tlDiv,
        viewport,
      })
      tlRef.current = tl
      try { await tl.render() } catch { /* cancelled */ }
    })()

    return () => {
      cancelled = true
      taskRef.current?.cancel()
      tlRef.current?.cancel()
    }
  }, [doc, pageNum, scale])

  // Coordinate origin is the canvas top-left corner, independent of which
  // layer (canvas or text span) actually received the double-click.
  const handleDblClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onDblClick) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    onDblClick(e.clientX - rect.left, e.clientY - rect.top)
  }, [onDblClick])

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} />
      {/* Text layer: transparent positioned spans from PDF.js that enable
          text selection. Also the dblclick target for reverse search. */}
      <div
        ref={textLayerRef}
        className="textLayer"
        onDoubleClick={handleDblClick}
      />
      {highlight && (
        <div
          key={highlight.key}
          className={styles.syncHighlight}
          style={{
            left:   `${highlight.x}px`,
            top:    `${highlight.y}px`,
            width:  `${highlight.w}px`,
            height: `${highlight.h}px`,
          }}
        />
      )}
    </>
  )
}

// ── Main PdfViewer ────────────────────────────────────────────────────────────
export function PdfViewer({
  pdfPath, compileVersion, status, errors, log,
  synctexPath, forwardTarget, onReverseSearch,
}: Props) {
  const [pdfDoc,   setPdfDoc]   = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale,    setScale]    = useState(1.2)
  const [logOpen,  setLogOpen]  = useState(false)

  const canvasAreaRef = useRef<HTMLDivElement>(null)

  // Reload PDF whenever a new compile succeeds
  useEffect(() => {
    if (!pdfPath) { setPdfDoc(null); setNumPages(0); return }
    let cancelled = false
    ;(async () => {
      const result = await window.api.pdf.read(pdfPath)
      if (cancelled || !result.ok || !result.data) return
      const data        = new Uint8Array(result.data)
      const loadingTask = pdfjsLib.getDocument({ data })
      const doc         = await loadingTask.promise
      if (cancelled) return
      setPdfDoc(doc)
      setNumPages(doc.numPages)
    })()
    return () => { cancelled = true }
  }, [pdfPath, compileVersion])

  // Scroll the canvas area to the forward-search target page
  useEffect(() => {
    if (!forwardTarget || !canvasAreaRef.current) return
    const el = canvasAreaRef.current.querySelector<HTMLElement>(
      `[data-page="${forwardTarget.page}"]`,
    )
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [forwardTarget])

  const zoomIn  = () => setScale(s => Math.min(+(s + 0.15).toFixed(2), 3.0))
  const zoomOut = () => setScale(s => Math.max(+(s - 0.15).toFixed(2), 0.4))

  const handleDblClick = useCallback(async (pageNum: number, xCss: number, yCss: number) => {
    if (!synctexPath || !onReverseSearch) return
    const SP = 65536
    const h  = Math.round((xCss / scale) * SP)
    const v  = Math.round((yCss / scale) * SP)
    const result = await window.api.synctex.reverse(synctexPath, pageNum, h, v)
    if (result.ok && result.data) onReverseSearch(result.data.file, result.data.line)
  }, [synctexPath, scale, onReverseSearch])

  const hasErrors = status === 'error' && errors.length > 0

  return (
    <div className={styles.root}>
      {/* ── top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.zoomBtn} onClick={zoomOut} title="Zoom out">−</button>
        <span className={styles.scaleLabel}>{Math.round(scale * 100)}%</span>
        <button className={styles.zoomBtn} onClick={zoomIn}  title="Zoom in">+</button>
        {numPages > 0 && (
          <span className={styles.pageCount}>
            {numPages} page{numPages !== 1 ? 's' : ''}
          </span>
        )}
        {synctexPath && (
          <span className={styles.synctexBadge} title="SyncTeX active — double-click PDF to jump to source">
            SyncTeX
          </span>
        )}
      </div>

      {/* ── canvas scroll area ── */}
      <div ref={canvasAreaRef} className={styles.canvasArea}>
        {status === 'compiling' && (
          <div className={styles.overlay}>
            <span className={styles.spinner} />
            Compiling…
          </div>
        )}

        {status === 'idle' && !pdfDoc && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>⬡</div>
            <p>Open a <code>.tex</code> file and click <strong>Compile</strong></p>
          </div>
        )}

        {pdfDoc && Array.from({ length: numPages }, (_, i) => {
          const pageNum   = i + 1
          const highlight = forwardTarget?.page === pageNum
            ? toHighlightRect(forwardTarget, scale)
            : undefined
          return (
            <div key={pageNum} className={styles.pageWrapper} data-page={pageNum}>
              <PdfPage
                doc={pdfDoc}
                pageNum={pageNum}
                scale={scale}
                highlight={highlight}
                onDblClick={(x, y) => handleDblClick(pageNum, x, y)}
              />
            </div>
          )
        })}
      </div>

      {/* ── compile log panel ── */}
      {(hasErrors || (log && status !== 'idle')) && (
        <div className={styles.logPanel}>
          <button className={styles.logToggle} onClick={() => setLogOpen(o => !o)}>
            <span className={styles.chevron}>{logOpen ? '▼' : '▶'}</span>
            {hasErrors
              ? <span className={styles.errorLabel}>{errors.length} error{errors.length !== 1 ? 's' : ''}</span>
              : <span>Compile log</span>}
          </button>
          {logOpen && (
            <div className={styles.logContent}>
              {hasErrors && errors.map((err, i) => (
                <div key={i} className={styles.errorLine}>{err}</div>
              ))}
              <pre className={styles.logPre}>{log}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
