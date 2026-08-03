import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      insertTypesEntry: true,
      rollupTypes: true,
    }),
    {
      // vanilla-fixes.css ships as its own file rather than being merged into
      // style.css: importing it is how a host opts into the vanilla renderer
      // repairs (see the file's own header). Nothing imports it from source, so
      // the bundler never sees it — it is copied verbatim.
      name: 'inflow-copy-vanilla-fixes',
      closeBundle() {
        copyFileSync(resolve(__dirname, 'src/vanilla-fixes.css'), resolve(__dirname, 'dist/vanilla-fixes.css'))
      },
    },
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'InflowUI',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['vue', '@jsonforms/core', '@jsonforms/vue'],
      output: {
        globals: {
          vue: 'Vue',
          '@jsonforms/core': 'JsonFormsCore',
          '@jsonforms/vue': 'JsonFormsVue',
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'style.css'
          return assetInfo.name ?? 'assets/[name][extname]'
        },
      },
    },
    cssCodeSplit: false,
  },
})
