import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import styles from './Editor.module.css'

interface Props {
  value: string
  onChange: (value: string) => void
}

const latexLang = StreamLanguage.define(stex)

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '14px',
      background: 'var(--color-surface)',
      color: 'var(--color-text)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '12px 0',
      caretColor: 'var(--color-accent)',
    },
    '.cm-line': { padding: '0 20px' },
    '.cm-gutters': {
      background: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      color: 'var(--color-text-muted)',
      paddingRight: '8px',
    },
    '.cm-activeLineGutter': {
      background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
    },
    '.cm-activeLine': {
      background: 'color-mix(in srgb, var(--color-accent) 4%, transparent)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-accent)',
    },
    '.cm-selectionBackground': {
      background: 'color-mix(in srgb, var(--color-accent) 28%, transparent) !important',
    },
    '.cm-foldPlaceholder': {
      background: 'var(--color-border)',
      border: 'none',
      color: 'var(--color-text-muted)',
    },
    '.cm-tooltip': {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
    },
  },
  { dark: true },
)

export function Editor({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const internalValueRef = useRef(value)

  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          latexLang,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const text = update.state.doc.toString()
              internalValueRef.current = text
              onChangeRef.current(text)
            }
          }),
        ],
      }),
      parent: containerRef.current,
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Intentionally empty: view is created once and survives re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes (e.g. new file opened) without re-creating the view
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === internalValueRef.current) return
    internalValueRef.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
  }, [value])

  return <div ref={containerRef} className={styles.editor} />
}
