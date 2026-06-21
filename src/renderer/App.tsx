import { useState, useCallback, useEffect, useRef } from 'react'
import { Toolbar } from './components/Toolbar'
import { FileTree } from './components/FileTree'
import { Editor, type EditorHandle, type ViewState } from './components/Editor'
import { PdfViewer } from './components/PdfViewer'
import styles from './App.module.css'

interface CompileState {
  status: 'idle' | 'compiling' | 'success' | 'error'
  pdfPath?: string
  log: string
  errors: string[]
  version: number
}

// Derive dirname in the renderer (no Node path module available)
function dirOf(p: string): string {
  return p.replace(/[/\\][^/\\]*$/, '')
}

export function App() {
  // Project-level state — kept separate so editor keystrokes don't invalidate handlers
  const [rootDir,         setRootDir]         = useState<string | null>(null)
  const [entries,         setEntries]         = useState<FileEntry[]>([])
  const [openFilePath,    setOpenFilePath]    = useState<string | null>(null)
  const [openFileContent, setOpenFileContent] = useState('')
  const [mainTexFile,     setMainTexFile]     = useState<string | null>(null)
  const [compile,         setCompile]         = useState<CompileState>({
    status: 'idle', log: '', errors: [], version: 0,
  })

  // Always-current refs so stable callbacks read the latest values without deps
  const rootDirRef         = useRef(rootDir);         rootDirRef.current         = rootDir
  const openFilePathRef    = useRef(openFilePath);    openFilePathRef.current    = openFilePath
  const openFileContentRef = useRef(openFileContent); openFileContentRef.current = openFileContent
  const mainTexFileRef     = useRef(mainTexFile);     mainTexFileRef.current     = mainTexFile

  // Per-file in-memory content cache — unsaved edits survive file switches.
  // Disk writes happen only on explicit save or before compile.
  const fileContentsRef = useRef<Record<string, string>>({})

  // Per-file CM6 cursor + scroll state, captured on every file switch so the
  // editor returns to the exact position when the user comes back.
  const viewStatesRef = useRef<Record<string, ViewState>>({})

  // Ref to the CM6 editor instance; used to read and restore view state.
  const editorRef = useRef<EditorHandle>(null)

  // ── SyncTeX state ──────────────────────────────────────────────────────────
  const [forwardTarget, setForwardTarget] = useState<SyncForwardTarget | null>(null)
  // Updated after every successful compile; not reactive state because
  // handleForwardSearch is a stable callback that reads it via ref.
  const synctexPathRef    = useRef<string | null>(null)
  const forwardKeyCounter = useRef(0)
  // When reverse search navigates to a different file, we set this so the
  // cursor-restore effect can call goToLine after the Editor re-renders.
  const pendingGoToLineRef = useRef<{ file: string; line: number } | null>(null)

  // ── directory refresh ──────────────────────────────────────────────────────
  const refreshEntries = useCallback(async () => {
    const dir = rootDirRef.current
    if (!dir) return
    const result = await window.api.fs.readDir(dir)
    if (result.ok) setEntries(result.data)
  }, [])

  // ── startup auto-restore ──────────────────────────────────────────────────
  // Runs once on mount. Reads app-state.json from userData and reopens the last
  // project + file without any user interaction.
  useEffect(() => {
    async function restore() {
      const stateResult = await window.api.app.getStartupState()
      if (!stateResult.ok || !stateResult.data) return
      const {
        rootDir: startupDir,
        mainTexFile: startupMain,
        lastOpenFile: startupLastOpen,
      } = stateResult.data

      const entriesResult = await window.api.fs.readDir(startupDir)
      if (!entriesResult.ok) return  // project directory no longer exists

      // Try candidates in priority order: lastOpenFile → mainTexFile
      const candidates = [startupLastOpen, startupMain].filter(
        (p): p is string => p !== null,
      )
      let fileToOpen: string | null = null
      let contentToShow = ''
      for (const candidate of candidates) {
        const r = await window.api.fs.readFile(candidate)
        if (r.ok && r.content !== undefined) {
          fileToOpen    = candidate
          contentToShow = r.content
          break
        }
      }

      fileContentsRef.current = fileToOpen ? { [fileToOpen]: contentToShow } : {}
      viewStatesRef.current   = {}

      setRootDir(startupDir)
      setEntries(entriesResult.data)
      setMainTexFile(startupMain)
      if (fileToOpen) {
        setOpenFilePath(fileToOpen)
        setOpenFileContent(contentToShow)
      }
    }
    void restore()
  }, [])

  // ── open .tex file via dialog ─────────────────────────────────────────────
  const handleOpen = useCallback(async () => {
    const result = await window.api.project.open()
    if (!result.ok || !result.data) return
    const { filePath: clickedPath, content: clickedContent } = result.data
    const dir = dirOf(clickedPath)

    // Fresh project — reset both in-memory caches
    fileContentsRef.current = { [clickedPath]: clickedContent }
    viewStatesRef.current   = {}

    // Single call for all per-project config; also handles .overleaf migration
    const [entriesResult, projectResult] = await Promise.all([
      window.api.fs.readDir(dir),
      window.api.config.getProject(dir),
    ])

    const projectData    = projectResult.ok ? projectResult.data : null
    const storedMain     = projectData?.mainTexFile     ?? null
    const storedLastOpen = projectData?.lastOpenFile    ?? null

    // Resolve which file to actually open:
    // 1. last-open file from config (if it still exists on disk)
    // 2. fallback: the file the user clicked in the dialog
    let fileToOpen    = clickedPath
    let contentToShow = clickedContent

    if (storedLastOpen) {
      if (storedLastOpen === clickedPath) {
        fileContentsRef.current[clickedPath] = clickedContent
      } else {
        const probe = await window.api.fs.readFile(storedLastOpen)
        if (probe.ok && probe.content !== undefined) {
          fileContentsRef.current[storedLastOpen] = probe.content
          fileToOpen    = storedLastOpen
          contentToShow = probe.content
        }
        // probe failed → storedLastOpen no longer exists; fall through to clickedPath
      }
    }

    // Persist the file we're about to open; also records lastOpenProject so the
    // next startup can auto-restore this session.
    try {
      await window.api.config.setLastOpen(dir, fileToOpen)
    } catch (e) {
      console.error('[lastOpen] failed to persist:', e)
    }

    setRootDir(dir)
    setOpenFilePath(fileToOpen)
    setOpenFileContent(contentToShow)
    setCompile({ status: 'idle', log: '', errors: [], version: 0 })
    if (entriesResult.ok) setEntries(entriesResult.data)
    setMainTexFile(storedMain)
  }, [])

  // ── editor content change ─────────────────────────────────────────────────
  const handleContentChange = useCallback((content: string) => {
    setOpenFileContent(content)
    const path = openFilePathRef.current
    if (path) fileContentsRef.current[path] = content
  }, [])

  // ── open a file from the tree ─────────────────────────────────────────────
  const handleFileOpen = useCallback(async (filePath: string) => {
    const current = openFilePathRef.current

    // Capture cursor + scroll state of the file we're leaving
    if (current) {
      const vs = editorRef.current?.getViewState()
      if (vs) viewStatesRef.current[current] = vs
      // Belt-and-suspenders flush: handleContentChange keeps this current on
      // every keystroke, but cover the gap between last keystroke and click.
      fileContentsRef.current[current] = openFileContentRef.current
    }

    // Use cached (unsaved) content when available; only read disk for files
    // opened for the first time this session.
    const cached = fileContentsRef.current[filePath]
    if (cached !== undefined) {
      setOpenFilePath(filePath)
      setOpenFileContent(cached)
    } else {
      const result = await window.api.fs.readFile(filePath)
      if (result.ok && result.content !== undefined) {
        fileContentsRef.current[filePath] = result.content
        setOpenFilePath(filePath)
        setOpenFileContent(result.content)
      }
    }

    // Persist last-open file (fire and forget — non-critical)
    const dir = rootDirRef.current
    if (dir) void window.api.config.setLastOpen(dir, filePath)
  }, [])

  // ── create file (auto-opens) ──────────────────────────────────────────────
  const handleCreateFile = useCallback(async (filePath: string) => {
    const r = await window.api.fs.createFile(filePath)
    if (!r.ok) return
    fileContentsRef.current[filePath] = ''
    await refreshEntries()
    setOpenFilePath(filePath)
    setOpenFileContent('')
    const dir = rootDirRef.current
    if (dir) void window.api.config.setLastOpen(dir, filePath)
  }, [refreshEntries])

  // ── create directory ──────────────────────────────────────────────────────
  const handleCreateDir = useCallback(async (dirPath: string) => {
    await window.api.fs.createDir(dirPath)
    await refreshEntries()
  }, [refreshEntries])

  // ── rename ────────────────────────────────────────────────────────────────
  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    const r = await window.api.fs.rename(oldPath, newPath)
    if (!r.ok) return
    // Re-key content and view-state caches so they follow the rename
    if (fileContentsRef.current[oldPath] !== undefined) {
      fileContentsRef.current[newPath] = fileContentsRef.current[oldPath]
      delete fileContentsRef.current[oldPath]
    }
    // For the currently-open file, capture a fresh view state under the new path
    // so returning to it later restores the current cursor position.
    if (oldPath === openFilePathRef.current) {
      const vs = editorRef.current?.getViewState()
      if (vs) viewStatesRef.current[newPath] = vs
      delete viewStatesRef.current[oldPath]
    } else if (viewStatesRef.current[oldPath] !== undefined) {
      viewStatesRef.current[newPath] = viewStatesRef.current[oldPath]
      delete viewStatesRef.current[oldPath]
    }
    await refreshEntries()
    if (openFilePathRef.current === oldPath)  setOpenFilePath(newPath)
    if (mainTexFileRef.current  === oldPath) {
      setMainTexFile(newPath)
      const dir = rootDirRef.current
      if (dir) await window.api.config.setMain(dir, newPath)
    }
  }, [refreshEntries])

  // ── delete (with native confirmation) ────────────────────────────────────
  const handleDelete = useCallback(async (filePath: string) => {
    const name = filePath.replace(/.*[/\\]/, '')
    const confirmed = await window.api.dialog.confirm(
      'Confirm Delete',
      `Delete "${name}"? This cannot be undone.`,
    )
    if (!confirmed) return
    const r = await window.api.fs.delete(filePath)
    if (!r.ok) return
    delete fileContentsRef.current[filePath]
    delete viewStatesRef.current[filePath]
    await refreshEntries()
    if (openFilePathRef.current === filePath) {
      setOpenFilePath(null)
      setOpenFileContent('')
    }
    if (mainTexFileRef.current === filePath) setMainTexFile(null)
  }, [refreshEntries])

  // ── set main document ─────────────────────────────────────────────────────
  const handleSetMain = useCallback(async (filePath: string) => {
    const dir = rootDirRef.current
    if (!dir) return
    await window.api.config.setMain(dir, filePath)
    setMainTexFile(filePath)
  }, [])

  // ── SyncTeX forward search (double-click in editor) ─────────────────────
  const handleForwardSearch = useCallback(async () => {
    const stx     = synctexPathRef.current
    const texFile = openFilePathRef.current
    if (!stx || !texFile) return
    const line   = editorRef.current?.getCursorLine() ?? 1
    const result = await window.api.synctex.forward(stx, texFile, line)
    if (result.ok && result.data) {
      setForwardTarget({
        ...result.data,
        key: ++forwardKeyCounter.current,
      })
    }
  }, [])

  // ── SyncTeX reverse search (double-click in PDF) ──────────────────────────
  const handleReverseSearch = useCallback(async (file: string, line: number) => {
    if (file === openFilePathRef.current) {
      editorRef.current?.goToLine(line)
    } else {
      const r = await window.api.fs.readFile(file)
      if (!r.ok || r.content === undefined) return
      fileContentsRef.current[file] = r.content
      pendingGoToLineRef.current = { file, line }
      setOpenFilePath(file)
      setOpenFileContent(r.content)
      const dir = rootDirRef.current
      if (dir) void window.api.config.setLastOpen(dir, file)
    }
  }, [])

  // ── cursor / scroll restoration ───────────────────────────────────────────
  // Runs after openFilePath changes. Because Editor is a child component, its
  // own useEffect (which sets the new content) runs first, so applyViewState
  // dispatches on the correct (already-replaced) document.
  useEffect(() => {
    if (!openFilePath) return
    // Pending goToLine from a cross-file reverse search takes priority
    const pending = pendingGoToLineRef.current
    if (pending?.file === openFilePath) {
      pendingGoToLineRef.current = null
      editorRef.current?.goToLine(pending.line)
      return
    }
    const vs = viewStatesRef.current[openFilePath]
    if (vs) editorRef.current?.applyViewState(vs)
  }, [openFilePath])

  // ── compile ───────────────────────────────────────────────────────────────
  // Target: main doc if set, otherwise whatever file is open in the editor.
  const handleCompile = useCallback(async () => {
    const target = mainTexFileRef.current ?? openFilePathRef.current
    if (!target) return

    // Write the currently open file to disk (source of truth is the editor).
    const openPath = openFilePathRef.current
    if (openPath) {
      await window.api.project.save(openPath, openFileContentRef.current)
    }

    // If the compile target differs from the open file, it may have unsaved
    // cached edits (the user switched away from it without compiling). Flush
    // those to disk so pdflatex reads the latest content.
    if (target !== openPath) {
      const cached = fileContentsRef.current[target]
      if (cached !== undefined) {
        await window.api.project.save(target, cached)
      }
    }

    setCompile(prev => ({ ...prev, status: 'compiling' }))
    const result = await window.api.compiler.compile(target)
    synctexPathRef.current = result.synctexPath ?? null
    setCompile(prev => ({
      status: result.ok ? 'success' : 'error',
      pdfPath: result.pdfPath,
      log: result.log,
      errors: result.errors,
      version: prev.version + 1,
    }))
  }, [])

  const compileTarget = mainTexFile ?? openFilePath

  return (
    <div className={styles.root}>
      <Toolbar
        openFilePath={openFilePath ?? undefined}
        mainTexFile={mainTexFile ?? undefined}
        compileStatus={compile.status}
        onOpen={handleOpen}
        onCompile={handleCompile}
      />
      <div className={styles.workspace}>
        {rootDir && (
          <>
            <div className={styles.sidebar}>
              <FileTree
                rootDir={rootDir}
                entries={entries}
                openFilePath={openFilePath}
                mainTexFile={mainTexFile}
                onFileOpen={handleFileOpen}
                onCreateFile={handleCreateFile}
                onCreateDir={handleCreateDir}
                onRename={handleRename}
                onDelete={handleDelete}
                onSetMain={handleSetMain}
              />
            </div>
            <div className={styles.sidebarDivider} />
          </>
        )}

        <div className={styles.editorPane}>
          {openFilePath ? (
            <Editor
              ref={editorRef}
              value={openFileContent}
              onChange={handleContentChange}
              onForwardSearch={handleForwardSearch}
            />
          ) : (
            <div className={styles.editorEmpty}>
              <p>
                {rootDir
                  ? 'Click a file in the sidebar to open it'
                  : <>Click <strong>Open .tex</strong> to open a LaTeX document</>}
              </p>
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
            synctexPath={synctexPathRef.current ?? undefined}
            forwardTarget={forwardTarget ?? undefined}
            onReverseSearch={handleReverseSearch}
          />
        </div>
      </div>

      {/* Disabled compile target indicator for when no file will be compiled */}
      {rootDir && !compileTarget && compile.status === 'idle' && (
        <div className={styles.noTargetBanner}>
          No compile target — open a .tex file or right-click one in the sidebar and
          choose <em>Set as Main Document</em>.
        </div>
      )}
    </div>
  )
}
