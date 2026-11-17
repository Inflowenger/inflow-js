/**
 * Stage two: the built guest bootstraps → TypeScript modules exporting them as
 * text.
 *
 * Inlining is not an optimisation here, it is the only thing that survives being
 * bundled by someone else. Vite's library mode rewrites
 * `new Worker(new URL('./worker.ts', import.meta.url))` into an absolute path
 * marked `@vite-ignore`, which resolves against the *consumer's* origin and
 * points at a file that was never copied there — so the worker 404s in every
 * application that installs the package. A string has no path to be wrong.
 *
 * `</script` is broken up because the frame's bootstrap is embedded in a
 * `<script>` element. Our own bundle is not an attacker, but a regular
 * expression in it containing that sequence would silently truncate the frame's
 * document, which is a very confusing bug to meet.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../src/generated')
mkdirSync(outDir, { recursive: true })

const entries = [
  {
    file: 'frame.js',
    out: 'frameBootstrap.ts',
    name: 'FRAME_BOOTSTRAP',
    note: 'Inlined into the frame’s `srcdoc`; an opaque-origin document cannot fetch a blob URL belonging to the host’s origin.',
    escapeScript: true,
  },
  {
    file: 'worker.js',
    out: 'workerBootstrap.ts',
    name: 'WORKER_BOOTSTRAP',
    note: 'Turned into a blob module at runtime; a worker asset shipped beside the library does not survive a consumer bundling it.',
    escapeScript: false,
  },
]

for (const entry of entries) {
  const name = entry.file.replace('.js', '')
  const source = readFileSync(resolve(here, '../build/guests', name, entry.file), 'utf8')
  const literal = entry.escapeScript
    ? JSON.stringify(source).replace(/<\/script/gi, '<\\/script')
    : JSON.stringify(source)

  writeFileSync(
    resolve(outDir, entry.out),
    `/**
 * The ${name} guest’s bundle, as text. **Generated — do not edit.**
 *
 * Produced by \`scripts/build-guests.mjs\` from \`src/guest/\`. ${entry.note}
 */
export const ${entry.name} = ${literal}
`,
  )

  console.log(`${entry.out} written (${(source.length / 1024).toFixed(1)} kB)`)
}
