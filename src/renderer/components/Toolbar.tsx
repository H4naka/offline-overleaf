import styles from './Toolbar.module.css'

interface Props {
  filePath?: string
  compileStatus: 'idle' | 'compiling' | 'success' | 'error'
  onOpen: () => void
  onCompile: () => void
}

const COMPILE_LABEL: Record<Props['compileStatus'], string> = {
  idle: 'Compile',
  compiling: 'Compiling…',
  success: 'Compile',
  error: 'Compile',
}

export function Toolbar({ filePath, compileStatus, onOpen, onCompile }: Props) {
  const isCompiling = compileStatus === 'compiling'

  return (
    <div className={styles.toolbar}>
      <button className={styles.btn} onClick={onOpen}>
        Open .tex
      </button>

      {filePath && (
        <span className={styles.fileName} title={filePath}>
          {filePath.replace(/.*[\\/]/, '')}
        </span>
      )}

      <div className={styles.spacer} />

      {compileStatus === 'success' && (
        <span className={styles.badge} data-status="success">✓ OK</span>
      )}
      {compileStatus === 'error' && (
        <span className={styles.badge} data-status="error">✗ Error</span>
      )}

      <button
        className={styles.btnPrimary}
        onClick={onCompile}
        disabled={!filePath || isCompiling}
      >
        {COMPILE_LABEL[compileStatus]}
      </button>
    </div>
  )
}
