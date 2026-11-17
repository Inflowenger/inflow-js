/**
 * The Vue guest's entry point.
 *
 * `createApp(...).mount(ctx.root)` — the ordinary Vue bootstrap, pointed at the
 * sandbox's root instead of a `#app` element. Nothing about the application
 * knows it is in a sandbox; `ctx` is passed as a prop like any other dependency.
 */
import { createApp } from 'vue'
import type { GuestContext } from '@inflowenger/plugin-sandbox/guest'
import App from './App.vue'

export default function mount(ctx: GuestContext) {
  const app = createApp(App, { ctx })
  app.mount(ctx.root as unknown as Element)
  return () => app.unmount()
}
