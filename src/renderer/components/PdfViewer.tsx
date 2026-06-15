import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import styles from './PdfViewer.module.css'

// Vite resolves this at build time and copies the worker to the output
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
}

// One canvas per PDF page — mounts/unmounts when page count changes
function PdfPage({ doc, pageNum, scale }: {
  doc: PDFDocumentProxy
  pageNum: number
  scale: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const taskRef = useRef<RenderTask | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const page = await doc.getPage(pageNum)
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      taskRef.current?.cancel()

      const dpr = window.devicePixelRatio ?? 1

      // Physical pixels — what the canvas bitmap is actually sized to
      canvas.width  = Math.floor(viewport.width  * dpr)
      canvas.height = Math.floor(viewport.height * dpr)

      // CSS pixels — keeps the element the right layout size
      canvas.style.width  = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      // Scale the 2D context so PDF.js draws at full resolution
      const transform: [number, number, number, number, number, number] =
        [dpr, 0, 0, dpr, 0, 0]

      const task = page.render({ canvasContext: ctx, viewport, transform })
      taskRef.current = task

      try {
        await task.promise
      } catch {
        // silently ignore cancellation errors when scale changes
      }
    })()

    return () => {
      cancelled = true
      taskRef.current?.cancel()
    }
  }, [doc, pageNum, scale])

  return <canvas ref={canvasRef} className={styles.canvas} />
}

export function PdfViewer({ pdfPath, compileVersion, status, errors, log }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [logOpen, setLogOpen] = useState(false)

  // Reload PDF whenever a new compile succeeds
  useEffect(() => {
    if (!pdfPath) {
      setPdfDoc(null)
      setNumPages(0)
      return
    }

    let cancelled = false

    ;(async () => {
      const result = await window.api.pdf.read(pdfPath)
      if (cancelled || !result.ok || !result.data) return

      // Defensive copy: structured clone may return a non-subclassed ArrayBuffer
      const data = new Uint8Array(result.data)
      const loadingTask = pdfjsLib.getDocument({ data })
      const doc = await loadingTask.promise
      if (cancelled) return

      setPdfDoc(doc)
      setNumPages(doc.numPages)
    })()

    return () => { cancelled = true }
  }, [pdfPath, compileVersion])

  const zoomIn  = () => setScale((s) => Math.min(+(s + 0.15).toFixed(2), 3.0))
  const zoomOut = () => setScale((s) => Math.max(+(s - 0.15).toFixed(2), 0.4))

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
      </div>

      {/* ── canvas scroll area ── */}
      <div className={styles.canvasArea}>
        {status === 'compiling' && (
          <div className={styles.overlay}>
            <span className={styles.spinner} />
            Compiling…
          </div>
        )}

        {status === 'idle' && !pdfDoc && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>⬡</div>
            <p>
              Open a <code>.tex</code> file and click <strong>Compile</strong>
            </p>
          </div>
        )}

        {pdfDoc && Array.from({ length: numPages }, (_, i) => (
          <div key={i + 1} className={styles.pageWrapper}>
            <PdfPage doc={pdfDoc} pageNum={i + 1} scale={scale} />
          </div>
        ))}
      </div>

      {/* ── compile log panel ── */}
      {(hasErrors || (log && status !== 'idle')) && (
        <div className={styles.logPanel}>
          <button
            className={styles.logToggle}
            onClick={() => setLogOpen((o) => !o)}
          >
            <span className={styles.chevron}>{logOpen ? '▼' : '▶'}</span>
            {hasErrors ? (
              <span className={styles.errorLabel}>
                {errors.length} error{errors.length !== 1 ? 's' : ''}
              </span>
            ) : (
              <span>Compile log</span>
            )}
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
