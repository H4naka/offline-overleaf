import { useState, useEffect, useRef, useCallback } from 'react'
import styles from './FileTree.module.css'

interface Props {
  rootDir: string
  entries: FileEntry[]
  openFilePath: string | null
  mainTexFile: string | null
  onFileOpen: (path: string) => void
  onCreateFile: (path: string) => void
  onCreateDir: (path: string) => void
  onRename: (oldPath: string, newPath: string) => void
  onDelete: (path: string) => void
  onSetMain: (path: string) => void
}

interface MenuState {
  x: number
  y: number
  entry: FileEntry
  isRoot: boolean
}

type EditState =
  | { kind: 'rename'; path: string }
  | { kind: 'create'; parentDir: string; entryType: 'file' | 'dir' }
  | null

// Renderer-side path helpers — no Node `path` module in the renderer process
function pathJoin(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[/\\]+$/, '') + sep + name
}

function pathDirname(p: string): string {
  return p.replace(/[/\\][^/\\]*$/, '')
}

function pathBasename(p: string): string {
  return p.replace(/.*[/\\]/, '')
}

export function FileTree({
  rootDir,
  entries,
  openFilePath,
  mainTexFile,
  onFileOpen,
  onCreateFile,
  onCreateDir,
  onRename,
  onDelete,
  onSetMain,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    new Set(entries.filter(e => e.type === 'dir').map(e => e.path)),
  )
  const [menu, setMenu]       = useState<MenuState | null>(null)
  const [editing, setEditing] = useState<EditState>(null)

  // Ref mirror of `editing` — lets commit/cancel read the latest value without
  // stale-closure issues. Synced on every render before any callback fires.
  const editingRef = useRef<EditState>(null)
  editingRef.current = editing

  const menuRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  // When the project root changes, expand all top-level dirs and reset edit state
  useEffect(() => {
    setExpanded(new Set(entries.filter(e => e.type === 'dir').map(e => e.path)))
    editingRef.current = null
    setEditing(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootDir])

  // Close context menu on outside mousedown
  useEffect(() => {
    if (!menu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menu])

  // Auto-focus the edit input whenever it mounts
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        editRef.current?.focus()
        editRef.current?.select()
      })
    }
  }, [editing])

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }, [])

  const openMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry, isRoot = false) => {
      e.preventDefault()
      e.stopPropagation()
      // Cancel any in-progress edit before the menu opens so its onBlur is a no-op
      editingRef.current = null
      setEditing(null)
      const menuW = 190
      const menuH = 200
      const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX
      const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
      setMenu({ x, y, entry, isRoot })
    },
    [],
  )

  const cancelEdit = useCallback(() => {
    editingRef.current = null
    setEditing(null)
  }, [])

  // Uses editingRef (not the `editing` closure) to prevent double-commit when
  // the input blurs on unmount after Enter or Escape has already resolved.
  const commitRename = useCallback(
    (newName: string) => {
      const current = editingRef.current
      if (!current || current.kind !== 'rename') return
      editingRef.current = null
      setEditing(null)
      const trimmed = newName.trim()
      if (!trimmed) return
      const newPath = pathJoin(pathDirname(current.path), trimmed)
      if (newPath !== current.path) onRename(current.path, newPath)
    },
    [onRename],
  )

  const commitCreate = useCallback(
    (name: string) => {
      const current = editingRef.current
      if (!current || current.kind !== 'create') return
      editingRef.current = null
      setEditing(null)
      const trimmed = name.trim()
      if (!trimmed) return
      const fullPath = pathJoin(current.parentDir, trimmed)
      if (current.entryType === 'file') onCreateFile(fullPath)
      else onCreateDir(fullPath)
    },
    [onCreateFile, onCreateDir],
  )

  const handleMenuAction = useCallback(
    (action: string) => {
      const entry = menu?.entry
      setMenu(null)
      if (!entry) return
      switch (action) {
        case 'open':
          onFileOpen(entry.path)
          break
        case 'rename':
          setEditing({ kind: 'rename', path: entry.path })
          break
        case 'delete':
          onDelete(entry.path)
          break
        case 'setMain':
          onSetMain(entry.path)
          break
        case 'newFile':
          setExpanded(prev => new Set([...prev, entry.path]))
          setEditing({ kind: 'create', parentDir: entry.path, entryType: 'file' })
          break
        case 'newDir':
          setExpanded(prev => new Set([...prev, entry.path]))
          setEditing({ kind: 'create', parentDir: entry.path, entryType: 'dir' })
          break
      }
    },
    [menu, onFileOpen, onDelete, onSetMain],
  )

  // Shared inline edit input — only one is ever mounted at a time
  function makeEditInput(defaultValue: string, onCommit: (v: string) => void) {
    return (
      <input
        ref={editRef}
        className={styles.editInput}
        defaultValue={defaultValue}
        onBlur={e => onCommit(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(e.currentTarget.value)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancelEdit()
          }
        }}
      />
    )
  }

  function renderEntries(list: FileEntry[], depth: number): React.ReactNode {
    return list.map(entry => {
      const isDir        = entry.type === 'dir'
      const isActive     = entry.path === openFilePath
      const isMain       = entry.path === mainTexFile
      const isExpanded   = isDir && expanded.has(entry.path)
      const isRenaming   = editing?.kind === 'rename' && editing.path === entry.path
      const showCreate   = editing?.kind === 'create' && editing.parentDir === entry.path
      const indent       = 8 + depth * 14

      return (
        <li key={entry.path}>
          <div
            className={[styles.row, isActive ? styles.rowActive : ''].filter(Boolean).join(' ')}
            style={{ paddingLeft: `${indent}px` }}
            onClick={() => {
              if (isRenaming) return
              if (isDir) toggleDir(entry.path)
              else onFileOpen(entry.path)
            }}
            onContextMenu={e => openMenu(e, entry)}
          >
            <span className={styles.arrow}>
              {isDir ? (isExpanded ? '▾' : '▸') : null}
            </span>

            {isRenaming
              ? makeEditInput(entry.name, commitRename)
              : <span className={styles.label} title={entry.path}>{entry.name}</span>
            }

            {isMain && !isRenaming && (
              <span className={styles.mainBadge}>main</span>
            )}
          </div>

          {isDir && isExpanded && (
            <ul className={styles.list}>
              {entry.children && renderEntries(entry.children, depth + 1)}
              {showCreate && (
                <li>
                  <div
                    className={styles.row}
                    style={{ paddingLeft: `${indent + 14}px` }}
                  >
                    <span className={styles.arrow} />
                    {makeEditInput('', commitCreate)}
                  </div>
                </li>
              )}
            </ul>
          )}
        </li>
      )
    })
  }

  const rootEntry: FileEntry = { name: pathBasename(rootDir), path: rootDir, type: 'dir' }

  return (
    <div
      className={styles.tree}
      onContextMenu={e => openMenu(e, rootEntry, true)}
    >
      <div
        className={styles.header}
        onContextMenu={e => openMenu(e, rootEntry, true)}
        title={rootDir}
      >
        {pathBasename(rootDir)}
      </div>

      <ul className={styles.list}>
        {renderEntries(entries, 0)}

        {editing?.kind === 'create' && editing.parentDir === rootDir && (
          <li>
            <div className={styles.row} style={{ paddingLeft: '8px' }}>
              <span className={styles.arrow} />
              {makeEditInput('', commitCreate)}
            </div>
          </li>
        )}
      </ul>

      {menu && (
        <div
          ref={menuRef}
          className={styles.contextMenu}
          style={{ top: menu.y, left: menu.x }}
          onContextMenu={e => e.preventDefault()}
        >
          {menu.entry.type === 'file' && (
            <button className={styles.menuItem} onClick={() => handleMenuAction('open')}>
              Open
            </button>
          )}

          {menu.entry.type === 'dir' && (
            <>
              <button className={styles.menuItem} onClick={() => handleMenuAction('newFile')}>
                New File
              </button>
              <button className={styles.menuItem} onClick={() => handleMenuAction('newDir')}>
                New Folder
              </button>
            </>
          )}

          {!menu.isRoot && (
            <>
              <div className={styles.menuSep} />
              <button className={styles.menuItem} onClick={() => handleMenuAction('rename')}>
                Rename
              </button>
              <button
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => handleMenuAction('delete')}
              >
                Delete
              </button>
            </>
          )}

          {menu.entry.type === 'file' &&
            menu.entry.name.toLowerCase().endsWith('.tex') && (
              <>
                <div className={styles.menuSep} />
                <button
                  className={styles.menuItem}
                  onClick={() => handleMenuAction('setMain')}
                >
                  Set as Main Document
                </button>
              </>
            )}
        </div>
      )}
    </div>
  )
}
