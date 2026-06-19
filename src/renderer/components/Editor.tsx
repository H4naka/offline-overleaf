import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorSelection, EditorState } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import styles from './Editor.module.css'

export interface ViewState {
  anchor: number
  head: number
  scrollTop: number
}

export interface EditorHandle {
  getViewState(): ViewState | null
  applyViewState(vs: ViewState): void
}

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

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, onChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef      = useRef<EditorView | null>(null)
  const onChangeRef  = useRef(onChange)
  onChangeRef.current = onChange

  const internalValueRef = useRef(value)

  useImperativeHandle(ref, () => ({
    getViewState() {
      const view = viewRef.current
      if (!view) return null
      const { main } = view.state.selection
      return { anchor: main.anchor, head: main.head, scrollTop: view.scrollDOM.scrollTop }
    },

    applyViewState(vs: ViewState) {
      const view = viewRef.current
      if (!view) return
      const docLen = view.state.doc.length
      view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(
            Math.min(vs.anchor, docLen),
            Math.min(vs.head,   docLen),
          ),
        ]),
      })
      // Double-rAF: runs after CM6's own rAF-scheduled scroll-into-view so our
      // saved scroll position wins.
      const { scrollTop } = vs
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (viewRef.current) viewRef.current.scrollDOM.scrollTop = scrollTop
        })
      })
    },
  }), [])

  // Create the view once; it survives all re-renders
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync externally-driven content changes (new file opened) without rebuilding the view
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === internalValueRef.current) return
    internalValueRef.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
  }, [value])

  return <div ref={containerRef} className={styles.editor} />
})
