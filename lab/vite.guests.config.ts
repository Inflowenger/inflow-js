import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * The guest bundles, built the way a plugin would build them.
 *
 * Each entry becomes one self-contained ES module with its framework inlined,
 * written to `public/guests/` so the lab serves them over HTTP at a URL — which
 * is exactly the shape of a real deployment, where the plugin serves its own
 * bundle from its own origin and the form document points at it.
 *
 * Nothing is external. A sandbox has no import map and no bare-specifier
 * resolution; whatever the guest needs has to be in the file.
 */
export default defineConfig({
  plugins: [vue()],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  /**
   * A sandbox has no `process`.
   *
   * Vue's and React's bundler builds branch on `process.env.NODE_ENV` and rely
   * on the application's bundler to replace it. In library mode that
   * replacement does not happen, so the bundle ships a bare `process` reference
   * and dies on its first line inside a Worker with `ReferenceError: process is
   * not defined` — which looks like a sandbox failure and is really a build
   * one. Every plugin shipping a framework guest has to do this.
   */
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '({})',
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    outDir: 'public/guests',
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: {
        vanilla: resolve(__dirname, 'guests/vanilla.ts'),
        vue: resolve(__dirname, 'guests/vue/main.ts'),
        react: resolve(__dirname, 'guests/react.ts'),
        preact: resolve(__dirname, 'guests/preact.tsx'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      // One file per guest, with no shared chunks: a plugin serves a URL, not a
      // module graph, and a chunk the host cannot resolve is a blank dialog.
      output: { entryFileNames: '[name].js', chunkFileNames: '[name].js' },
    },
    minify: false,
  },
})
