import { readdir, readFile, writeFile, mkdir, rename, rm, stat } from 'fs/promises'
import { join, extname } from 'path'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileEntry[]
}

// Hidden dirs and build artifacts are excluded from the tree
const IGNORED_NAMES = new Set([
  '.git', 'node_modules', '.DS_Store', 'Thumbs.db', '.overleaf',
])
const IGNORED_EXTS = new Set([
  '.aux', '.log', '.out', '.toc', '.lof', '.lot', '.fls',
  '.fdb_latexmk', '.blg', '.bbl', '.bcf', '.run.xml',
  '.synctex.gz', '.synctex',
])

export async function readDir(dirPath: string, depth = 0): Promise<FileEntry[]> {
  if (depth > 5) return []
  const raw = await readdir(dirPath, { withFileTypes: true })
  const result: FileEntry[] = []

  for (const e of raw) {
    if (e.name.startsWith('.') || IGNORED_NAMES.has(e.name)) continue
    if (!e.isDirectory() && IGNORED_EXTS.has(extname(e.name).toLowerCase())) continue

    const fullPath = join(dirPath, e.name)
    if (e.isDirectory()) {
      result.push({
        name: e.name,
        path: fullPath,
        type: 'dir',
        children: await readDir(fullPath, depth + 1),
      })
    } else {
      result.push({ name: e.name, path: fullPath, type: 'file' })
    }
  }

  // Dirs before files, both alphabetical
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function createFile(filePath: string): Promise<void> {
  await writeFile(filePath, '', 'utf-8')
}

export async function createDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
}

export async function deleteEntry(entryPath: string): Promise<void> {
  const s = await stat(entryPath)
  if (s.isDirectory()) {
    await rm(entryPath, { recursive: true, force: true })
  } else {
    await rm(entryPath)
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
}
