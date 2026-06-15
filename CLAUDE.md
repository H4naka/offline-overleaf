# Offline Overleaf — Claude Code Guide

Offline LaTeX editor with live PDF preview, modelled after Overleaf. Runs entirely offline using a bundled TeX Live installation.

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron (main process + preload) |
| UI framework | React 18 + TypeScript |
| Editor | CodeMirror 6 |
| PDF viewer | PDF.js (iframe-less, canvas renderer) |
| Bundler (renderer) | Vite |
| Bundler (main/preload) | esbuild via electron-builder |
| LaTeX backend | TeX Live (`pdflatex`, `xelatex`, `lualatex`) |
| Testing | Vitest (unit) + Playwright (e2e) |
| Linting | ESLint + Prettier |

---

## Architecture overview

```
offline-overleaf/
├── src/
│   ├── main/               # Electron main process (Node.js, no DOM)
│   │   ├── index.ts        # Entry: creates BrowserWindow, registers IPC handlers
│   │   ├── compiler.ts     # Spawns TeX Live child processes
│   │   ├── fileManager.ts  # Project open/save, temp-dir lifecycle
│   │   └── watcher.ts      # chokidar watcher → triggers recompile
│   ├── preload/
│   │   └── index.ts        # contextBridge: exposes safe IPC surface to renderer
│   └── renderer/           # React app (browser context, no Node APIs)
│       ├── main.tsx        # React entry point
│       ├── App.tsx         # Root layout: EditorPane + PdfPane
│       ├── editor/
│       │   ├── Editor.tsx          # CodeMirror 6 host component
│       │   ├── extensions.ts       # CM6 extension bundle (LaTeX lang, keymaps, theme)
│       │   └── latexLanguage.ts    # CM6 language definition for LaTeX
│       ├── pdf/
│       │   └── PdfViewer.tsx       # PDF.js canvas renderer
│       ├── hooks/
│       │   ├── useCompiler.ts      # Subscribes to compile results via IPC
│       │   └── useProject.ts       # Project state (open files, dirty flag)
│       └── store/
│           └── projectStore.ts     # Zustand store for project/editor state
├── electron.vite.config.ts  # Vite config for renderer; esbuild for main/preload
├── electron-builder.config.ts
└── package.json
```

### Process boundary rules

- **main process**: all file I/O, child-process spawning, native dialogs. Never imports React or DOM APIs.
- **renderer process**: all UI. Never imports `fs`, `child_process`, or `path`. All OS access goes through `window.api` (the contextBridge surface).
- **preload**: thin adapter. Only re-exports IPC calls as typed functions. No business logic.

### IPC channel conventions

Channels are namespaced `domain:verb` and typed end-to-end:

```ts
// preload/index.ts — what the renderer sees
window.api = {
  project: {
    open: ()           => ipcRenderer.invoke('project:open'),
    save: (content)    => ipcRenderer.invoke('project:save', content),
    getFiles: ()       => ipcRenderer.invoke('project:getFiles'),
  },
  compiler: {
    compile: (engine)  => ipcRenderer.invoke('compiler:compile', engine),
    onResult: (cb)     => ipcRenderer.on('compiler:result', (_, r) => cb(r)),
    offResult: (cb)    => ipcRenderer.off('compiler:result', cb),
  },
}
```

Push events from main → renderer use `webContents.send('compiler:result', payload)`.

---

## Key commands

```bash
# Install dependencies
npm install

# Start dev mode (Vite HMR + Electron)
npm run dev

# Type-check without emitting
npm run typecheck

# Lint (ESLint + Prettier check)
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Run unit tests (Vitest)
npm run test

# Run e2e tests (Playwright, requires a build first)
npm run test:e2e

# Build production app
npm run build

# Package distributable (electron-builder)
npm run dist
```

---

## LaTeX compilation

`src/main/compiler.ts` spawns TeX Live as a child process:

```ts
// Simplified
const proc = spawn('pdflatex', [
  '-interaction=nonstopmode',
  '-synctex=1',
  '-output-directory', outputDir,
  mainTexFile,
], { cwd: projectDir })
```

- Output goes to a **temp directory** adjacent to the project; the PDF is copied into the project root only on success.
- `synctex=1` is always enabled — used for forward/inverse search between editor and PDF.
- The compiler emits structured log objects (`{ success, errors, warnings, pdfPath }`) over the `compiler:result` IPC channel.
- Log parsing lives in `compiler.ts` — do not put regex there; import from `src/main/logParser.ts`.
- Supported engines: `pdflatex` (default), `xelatex`, `lualatex`. Engine is stored per-project in `.overleaf/config.json`.

---

## CodeMirror 6 conventions

- All editor state lives in CM6's own `EditorState`; **do not** duplicate it in React state or Zustand.
- Extensions are composed once in `extensions.ts` and passed to `new EditorView(...)`. React re-renders must not recreate the `EditorView`.
- Use `view.dispatch({ changes: ... })` to apply programmatic edits (e.g., inserting a LaTeX snippet).
- Theming: use `EditorView.theme(...)` for custom CSS-in-JS rules; keep them alongside the extension that needs them.
- The LaTeX language support uses `@codemirror/language` with a Lezer grammar (`src/renderer/editor/latex.grammar`).

---

## Coding conventions

### TypeScript
- `strict: true` in `tsconfig.json`. No `any` without a comment explaining why.
- Prefer `type` over `interface` for plain data shapes. Use `interface` only when declaration merging is needed.
- Zod is used to validate all data that crosses the IPC boundary (main-side schemas in `src/main/ipc/schemas.ts`).

### React
- Functional components only. No class components.
- `useCallback`/`useMemo` only when profiling shows a real problem — not preemptively.
- Side effects that touch the file system or IPC belong in `hooks/`, not inline in components.
- Avoid prop drilling beyond two levels — use the Zustand store.

### File naming
- React components: `PascalCase.tsx`
- Everything else: `camelCase.ts`
- Test files co-located: `foo.test.ts` next to `foo.ts`

### Error handling
- IPC `invoke` calls always return `{ ok: true, data } | { ok: false, error: string }` — never throw across the IPC boundary.
- The renderer surfaces errors via a toast store; never `console.error` in production paths.

### CSS
- CSS Modules (`.module.css`) scoped to each component. No global selectors except in `src/renderer/styles/global.css`.
- Design tokens (colors, spacing, font sizes) are CSS custom properties defined in `global.css`.

---

## TeX Live path resolution

On first launch, the app searches for a `texlive` directory in this order:

1. Bundled alongside the app in `resources/texlive/` (production build)
2. System PATH (`which pdflatex`)
3. Common install locations: `C:\texlive\...` (Windows), `/usr/local/texlive/...` (macOS/Linux)

The resolved binary directory is stored in `app.getPath('userData')/settings.json` after first discovery.

---

## Environment variables (dev only)

| Variable | Purpose |
|---|---|
| `ELECTRON_ENABLE_LOGGING=1` | Verbose Electron/Chromium logs |
| `VITE_DEV_SERVER_URL` | Set automatically by `electron-vite`; do not override |
| `TEXLIVE_BIN` | Override the resolved TeX Live binary path |
