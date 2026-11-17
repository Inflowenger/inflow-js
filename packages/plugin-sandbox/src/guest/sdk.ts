/**
 * What a plugin author imports.
 *
 * `@inflowenger/plugin-sandbox/guest` is types and two helpers — nothing that
 * has to be bundled, nothing that pins a framework. A guest module is just an
 * ES module with a default export, so the smallest possible one is:
 *
 * ```js
 * export default function mount(ctx) {
 *   const button = ctx.document.createElement('button')
 *   button.textContent = 'Test connection'
 *   button.addEventListener('click', async () => {
 *     const result = await ctx.call('db.ping')
 *     ctx.notify({ severity: 'success', message: `Reachable in ${result.ms}ms` })
 *   })
 *   ctx.root.append(button)
 * }
 * ```
 *
 * Anything that renders to a DOM works the same way: hand `ctx.root` to Vue's
 * `createApp().mount()`, to Preact's `render()`, to React's `createRoot()`, or
 * build the nodes by hand as above.
 */

export type {
  GuestContext,
  GuestModule,
  GuestNotification,
  GuestMountOptions,
  SandboxGuestApi,
  SandboxHostApi,
} from '../bridge'
export type { ThemeSnapshot } from '../theme'

import type { GuestContext } from '../bridge'
import type { ThemeSnapshot } from '../theme'

/**
 * Identity, but typed.
 *
 * Writing `export default defineGuest((ctx) => ...)` gets a plugin author
 * completions on `ctx` without an import type annotation, which is the only
 * reason it exists. It adds nothing at runtime.
 */
export function defineGuest(
  mount: (context: GuestContext) => void | (() => void) | Promise<void | (() => void)>,
) {
  return mount
}

/**
 * A theme token, with a fallback.
 *
 * A `remote` guest rarely needs this: its nodes are in the host's document, so
 * `class="text-fg-subtle"` or `color: var(--fg-subtle)` simply works, and
 * reading a token into JavaScript is usually a sign the markup should have
 * carried the class instead. Where it genuinely helps is a value that has to
 * cross into a non-CSS context — a canvas stroke, a chart series, an SVG
 * gradient stop — which cannot resolve a `var()`.
 */
export function token(theme: ThemeSnapshot, name: string, fallback = ''): string {
  return theme.tokens[name.startsWith('--') ? name : `--${name}`] ?? fallback
}
