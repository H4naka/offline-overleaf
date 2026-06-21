import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorSelection, EditorState, StateField, StateEffect } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'
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
  getCursorLine(): number
  goToLine(line: number): void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onForwardSearch?: () => void
}

const latexLang = StreamLanguage.define(stex)

// ── SyncTeX reverse-search line highlight ─────────────────────────────────────
const setLineHighlight   = StateEffect.define<number>()  // 1-based line
const clearLineHighlight = StateEffect.define<null>()

const lineHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setLineHighlight)) {
        try {
          const lineObj = tr.state.doc.line(e.value)
          deco = Decoration.set([
            Decoration.mark({ class: 'cm-synctex-line' })
              .range(lineObj.from, lineObj.to || lineObj.from + 1),
          ])
        } catch { deco = Decoration.none }
      } else if (e.is(clearLineHighlight)) {
        deco = Decoration.none
      }
    }
    return deco
  },
  provide: f => EditorView.decorations.from(f),
})

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
    '.cm-synctex-line': {
      background: 'color-mix(in srgb, #f9e2af 30%, transparent)',
      borderRadius: '2px',
    },
  },
  { dark: true },
)

export const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, onChange, onForwardSearch },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef      = useRef<EditorView | null>(null)
  const onChangeRef  = useRef(onChange)
  onChangeRef.current = onChange
  const onForwardSearchRef = useRef(onForwardSearch)
  onForwardSearchRef.current = onForwardSearch

  const internalValueRef = useRef(value)

  // Double-click on editor → forward search. Created once; uses ref so it
  // always sees the latest callback without being recreated.
  // Return false so CM6 still performs its own word-selection on double-click.
  const dblClickExtension = useMemo(() =>
    EditorView.domEventHandlers({
      dblclick: () => { onForwardSearchRef.current?.(); return false },
    }),
  [])

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
      // Double-rAF: runs after CM6's own rAF-scheduled scroll-into-view
      const { scrollTop } = vs
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (viewRef.current) viewRef.current.scrollDOM.scrollTop = scrollTop
        })
      })
    },

    getCursorLine() {
      const view = viewRef.current
      if (!view) return 1
      const pos = view.state.selection.main.head
      return view.state.doc.lineAt(pos).number
    },

    goToLine(line: number) {
      const view = viewRef.current
      if (!view) return
      const doc     = view.state.doc
      const lineObj = doc.line(Math.max(1, Math.min(line, doc.lines)))
      view.dispatch({
        selection: { anchor: lineObj.from },
        effects: [
          EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
          setLineHighlight.of(line),
        ],
      })
      view.focus()
      setTimeout(() => {
        viewRef.current?.dispatch({ effects: clearLineHighlight.of(null) })
      }, 1500)
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
          lineHighlightField,
          dblClickExtension,
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

  // Sync externally-driven content changes (new file opened)
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
