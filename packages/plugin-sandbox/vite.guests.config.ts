import { defineConfig } from 'vite'
import { resolve } from 'path'

/**
 * Stage one of the build: one guest bootstrap, as one self-contained file.
 *
 * Built **once per entry**, selected by `GUEST`, and that is not fussiness.
 * Given two entries in a single build, Rollup does what it is supposed to do —
 * it notices they share `guest/runtime.ts` and hoists it into a chunk both
 * import by relative path. Neither sandbox can resolve such a path: a blob
 * worker has no directory, and a null-origin `srcdoc` document has no origin to
 * resolve against. The result is a silent 404 and a dialog that never appears.
 *
 * Nothing is external either, for the same reason: a sandbox has no package
 * resolution, so whatever the guest needs has to already be in the file.
 */
const entry = process.env.GUEST === 'worker' ? 'worker' : 'frame'

export default defineConfig({
  build: {
    outDir: `build/guests/${entry}`,
    emptyOutDir: true,
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, `src/guest/${entry}.ts`),
      formats: ['es'],
      fileName: () => `${entry}.js`,
    },
    rollupOptions: {
      external: [],
      // Belt and braces: with a single entry there is nothing to share, and
      // inlining any dynamic import keeps it that way.
      output: { inlineDynamicImports: true },
    },
    minify: 'esbuild',
  },
})
