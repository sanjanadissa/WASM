import { defineConfig } from 'vite';

export default defineConfig({
  // The root of the project (where index.html is)
  root: '.',

  // Dev server configuration
  server: {
    port: 3000,
    open: true,

    // Ensure .wasm files are served with the correct MIME type.
    // This is critical — browsers reject WebAssembly modules if
    // served as anything other than application/wasm.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Build configuration
  build: {
    outDir: 'dist',
    // Don't inline the WASM file — it needs to be fetched separately
    assetsInlineLimit: 0,
  },

  // Ensure the public directory includes our WASM output
  publicDir: 'public',

});
