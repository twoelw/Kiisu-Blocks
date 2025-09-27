import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Electron-only renderer build configuration.
// We always use a relative base so packaged app (file://) resolves assets.
// No need for conditional browser deployment logic.
export default defineConfig(() => ({
  base: './',
  // Dev server only used by Electron via VITE_DEV_SERVER_URL; keep it local-only.
  server: {
    port: 8080,
    host: '127.0.0.1',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Target the Chrome version bundled with the Electron version in use (Electron 33 ~ Chrome 126).
    target: 'chrome126',
    sourcemap: true, // Helpful for debugging in Electron DevTools.
    // Library / SSR options not required; this is a single-page renderer bundle.
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'chrome126',
    },
  },
}));
