import styles from './Toolbar.module.css'

interface Props {
  openFilePath?: string   // file currently open in the editor
  mainTexFile?: string    // root document for compilation (may differ)
  compileStatus: 'idle' | 'compiling' | 'success' | 'error'
  onOpen: () => void
  onCompile: () => void
}

const COMPILE_LABEL: Record<Props['compileStatus'], string> = {
  idle:      'Compile',
  compiling: 'Compiling…',
  success:   'Compile',
  error:     'Compile',
}

function basename(p: string): string {
  return p.replace(/.*[/\\]/, '')
}

export function Toolbar({ openFilePath, mainTexFile, compileStatus, onOpen, onCompile }: Props) {
  const isCompiling   = compileStatus === 'compiling'
  const compileTarget = mainTexFile ?? openFilePath
  // Only show the main-doc chip when it differs from the open file
  const showMainChip  = mainTexFile && mainTexFile !== openFilePath

  return (
    <div className={styles.toolbar}>
      <button className={styles.btn} onClick={onOpen}>
        Open .tex
      </button>

      {openFilePath && (
        <span className={styles.fileName} title={openFilePath}>
          {basename(openFilePath)}
        </span>
      )}

      <div className={styles.spacer} />

      {/* Main document chip — only visible when it differs from the open file */}
      {showMainChip && (
        <span className={styles.mainChip} title={mainTexFile}>
          ⬡ {basename(mainTexFile!)}
        </span>
      )}

      {compileStatus === 'success' && (
        <span className={styles.badge} data-status="success">✓ OK</span>
      )}
      {compileStatus === 'error' && (
        <span className={styles.badge} data-status="error">✗ Error</span>
      )}

      <button
        className={styles.btnPrimary}
        onClick={onCompile}
        disabled={!compileTarget || isCompiling}
        title={compileTarget ? `Compile ${basename(compileTarget)}` : 'No compile target'}
      >
        {COMPILE_LABEL[compileStatus]}
      </button>
    </div>
  )
}
