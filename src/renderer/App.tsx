import { useState, useCallback } from 'react'
import { Toolbar } from './components/Toolbar'
import { Editor } from './components/Editor'
import { PdfViewer } from './components/PdfViewer'
import styles from './App.module.css'

interface Project {
  filePath: string
  content: string
}

interface CompileState {
  status: 'idle' | 'compiling' | 'success' | 'error'
  pdfPath?: string
  log: string
  errors: string[]
  version: number
}

export function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [compile, setCompile] = useState<CompileState>({
    status: 'idle',
    log: '',
    errors: [],
    version: 0,
  })

  const handleOpen = useCallback(async () => {
    const result = await window.api.project.open()
    if (result.ok && result.data) {
      setProject({ filePath: result.data.filePath, content: result.data.content })
      setCompile({ status: 'idle', log: '', errors: [], version: 0 })
    }
  }, [])

  const handleContentChange = useCallback((content: string) => {
    setProject((prev) => (prev ? { ...prev, content } : null))
  }, [])

  const handleCompile = useCallback(async () => {
    if (!project) return
    await window.api.project.save(project.filePath, project.content)
    setCompile((prev) => ({ ...prev, status: 'compiling' }))
    const result = await window.api.compiler.compile(project.filePath)
    setCompile((prev) => ({
      status: result.ok ? 'success' : 'error',
      pdfPath: result.pdfPath,
      log: result.log,
      errors: result.errors,
      version: prev.version + 1,
    }))
  }, [project])

  return (
    <div className={styles.root}>
      <Toolbar
        filePath={project?.filePath}
        compileStatus={compile.status}
        onOpen={handleOpen}
        onCompile={handleCompile}
      />
      <div className={styles.workspace}>
        <div className={styles.editorPane}>
          {project ? (
            <Editor value={project.content} onChange={handleContentChange} />
          ) : (
            <div className={styles.editorEmpty}>
              <p>Click <strong>Open .tex</strong> to open a LaTeX document</p>
            </div>
          )}
        </div>
        <div className={styles.divider} />
        <div className={styles.pdfPane}>
          <PdfViewer
            pdfPath={compile.pdfPath}
            compileVersion={compile.version}
            status={compile.status}
            errors={compile.errors}
            log={compile.log}
          />
        </div>
      </div>
    </div>
  )
}
