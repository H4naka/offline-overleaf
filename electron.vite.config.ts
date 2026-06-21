import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    // Force all renderer deps to pre-bundle synchronously during server startup.
    // Without this, Vite 5's non-blocking optimizer races with Electron's first
    // page load: the window opens before pdfjs-dist (928 KB) is ready, the
    // module graph fails silently, and the window stays blank. The warm cache
    // that a second concurrent `npm run dev` instance finds is built by this
    // first optimizer run — which is why the second instance always works.
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'codemirror',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/lint',
        '@codemirror/legacy-modes/mode/stex',
        'pdfjs-dist',
      ],
    },
  },
})
