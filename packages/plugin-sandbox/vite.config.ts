import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

/**
 * Stage three: the library itself.
 *
 * ES only. Both guest bootstraps were already built in stage one and are
 * carried in as text, so this build has no worker and no asset to emit — which
 * is deliberate: a library that emits a sibling asset breaks the moment a
 * consumer bundles it. A host old enough to need CommonJS has no module workers
 * to spawn into either.
 */
export default defineConfig({
  plugins: [vue(), dts({ entryRoot: resolve(__dirname, 'src'), outDir: resolve(__dirname, 'dist'), include: ['src'] })],
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        guest: resolve(__dirname, 'src/guest/sdk.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]'),
      },
    },
    cssCodeSplit: false,
  },
})
