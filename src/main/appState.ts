import { app } from 'electron'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { join, relative } from 'path'

interface ProjectConfig {
  mainTexFile?: string   // relative to rootDir
  lastOpenFile?: string  // relative to rootDir
  engine?: string
}

interface AppState {
  lastOpenProject?: string                  // absolute path
  projects: Record<string, ProjectConfig>  // keyed by absolute path
}

function stateFilePath(): string {
  return join(app.getPath('userData'), 'app-state.json')
}

async function readState(): Promise<AppState> {
  try {
    const raw = await readFile(stateFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppState>
    return { projects: {}, ...parsed }
  } catch {
    return { projects: {} }
  }
}

async function writeState(state: AppState): Promise<void> {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  await writeFile(stateFilePath(), JSON.stringify(state, null, 2) + '\n', 'utf-8')
}

/**
 * First time a rootDir is seen: read .overleaf/config.json into the new store,
 * then delete the .overleaf directory so the project folder stays clean.
 * Guard: once rootDir is a key in state.projects the function is a no-op.
 * Mutates `state` in place; caller is responsible for writing.
 */
async function migrateOnce(rootDir: string, state: AppState): Promise<void> {
  if (rootDir in state.projects) return
  state.projects[rootDir] = {}
  try {
    const text = await readFile(join(rootDir, '.overleaf', 'config.json'), 'utf-8')
    const legacy = JSON.parse(text) as {
      mainTexFile?: string
      lastOpenFile?: string
      engine?: string
    }
    const proj = state.projects[rootDir]
    if (legacy.mainTexFile)  proj.mainTexFile  = legacy.mainTexFile
    if (legacy.lastOpenFile) proj.lastOpenFile = legacy.lastOpenFile
    if (legacy.engine)       proj.engine       = legacy.engine
    await rm(join(rootDir, '.overleaf'), { recursive: true, force: true })
  } catch {
    // No legacy config — project starts fresh in the new system
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Reads all per-project config in a single atomic call, running migration if
 * needed. Use this instead of calling getMain + getLastOpen separately to
 * avoid a concurrent-migration race in Promise.all.
 */
export async function getProjectConfig(rootDir: string): Promise<{
  mainTexFile: string | null
  lastOpenFile: string | null
}> {
  const state = await readState()
  const isNew = !(rootDir in state.projects)
  await migrateOnce(rootDir, state)
  if (isNew) await writeState(state)  // persist the newly initialised entry
  const proj = state.projects[rootDir]
  return {
    mainTexFile:  proj.mainTexFile  ? join(rootDir, proj.mainTexFile)  : null,
    lastOpenFile: proj.lastOpenFile ? join(rootDir, proj.lastOpenFile) : null,
  }
}

export async function setMainTexFile(rootDir: string, absPath: string): Promise<void> {
  const state = await readState()
  await migrateOnce(rootDir, state)
  state.projects[rootDir].mainTexFile = relative(rootDir, absPath)
  await writeState(state)
}

/**
 * Records the open file and marks the project as the most-recently-used one
 * so it can be auto-restored on the next startup.
 */
export async function setLastOpenFile(rootDir: string, absFilePath: string): Promise<void> {
  const state = await readState()
  await migrateOnce(rootDir, state)
  state.lastOpenProject = rootDir
  state.projects[rootDir].lastOpenFile = relative(rootDir, absFilePath)
  await writeState(state)
}

/**
 * Returns the information needed to auto-restore the last session on startup.
 * Returns null if no project has been opened with the new system yet.
 */
export async function getStartupState(): Promise<{
  rootDir: string
  mainTexFile: string | null
  lastOpenFile: string | null
} | null> {
  const state = await readState()
  const rootDir = state.lastOpenProject
  if (!rootDir) return null
  const proj = state.projects[rootDir] ?? {}
  return {
    rootDir,
    mainTexFile:  proj.mainTexFile  ? join(rootDir, proj.mainTexFile)  : null,
    lastOpenFile: proj.lastOpenFile ? join(rootDir, proj.lastOpenFile) : null,
  }
}
