/**
 * The guest side of the sandbox: what runs *inside* the Worker or the frame.
 *
 * It is the same code in both, which is the point — a plugin writes one module
 * and the host decides where it runs. The only thing that differs is the
 * surface it is handed: in a Worker, a polyfilled document whose mutations are
 * mirrored to the host; in a frame, the frame's own real document.
 *
 * Nothing here is a security boundary. Everything in this file runs with the
 * guest's privileges, in the guest's realm, and a hostile plugin can replace all
 * of it. The boundary is the Worker (or the null origin) plus the host's
 * element policy — see `../policy.ts`. This module's job is ergonomics: give an
 * honest plugin a pleasant `ctx`, and make a broken one fail loudly rather than
 * leaving an empty drawer.
 */

import type {
  GuestContext,
  GuestModule,
  GuestMountOptions,
  SandboxGuestApi,
  SandboxHostApi,
} from '../bridge'
import type { ThemeSnapshot } from '../theme'
import { applyPatch } from '../data'

/** Where the guest draws, and what it draws with. */
export interface GuestSurface {
  /** Prepare the drawing surface for this mount. */
  prepare(options: GuestMountOptions): { root: Element; document: Document }
  /** Called after the plugin's `mount` resolves — a frame reports its height here. */
  settled?(): void
  /** Called on destroy, after the plugin's own cleanup. */
  teardown?(): void
}

/**
 * Import the plugin's module.
 *
 * A URL is imported directly. Inline code becomes a blob module, which is a
 * genuine ES module — it can have top-level `await`, and its own static imports
 * resolve against the blob's origin, so a plugin shipping inline code should
 * inline its dependencies too.
 *
 * `import()` on a cross-origin URL requires the serving origin to allow it; a
 * plugin serving its own bundle from its own host is the expected case and the
 * failure is reported rather than swallowed, because "the dialog is blank" is
 * the single least actionable bug report a plugin author can receive.
 */
async function importGuestModule(source: { module?: string; code?: string }): Promise<GuestModule> {
  if (source.module) return (await import(/* @vite-ignore */ source.module)) as GuestModule

  if (!source.code) throw new Error('renderer named neither `module` nor `code`')

  const blob = new Blob([source.code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    return (await import(/* @vite-ignore */ url)) as GuestModule
  } finally {
    // Revoking immediately is safe: the module graph is already resolved, and
    // leaving the URL alive would pin the blob for the life of the document.
    URL.revokeObjectURL(url)
  }
}

/** A module's export shape → the function to call. */
function entryPointOf(module: GuestModule): (context: GuestContext) => unknown {
  if (typeof module === 'function') return module
  if (module && typeof module.default === 'function') return module.default
  if (module && typeof module.mount === 'function') return module.mount
  throw new Error('guest module exports neither a default function nor `mount`')
}

/**
 * Build the guest API the host drives.
 *
 * `host` is a getter rather than a value because the thread's imports and its
 * exports are created in the same breath — the API has to exist before there is
 * anything to call back into.
 */
export function createGuestRuntime(surface: GuestSurface, host: () => SandboxHostApi): SandboxGuestApi {
  const dataListeners = new Set<(data: unknown) => void>()
  const themeListeners = new Set<(theme: ThemeSnapshot) => void>()

  let context: GuestContext | undefined
  let cleanup: (() => void) | undefined
  let destroyed = false

  /**
   * Run a listener without letting it take the others down with it.
   *
   * A plugin's `onData` handler throwing is a plugin bug, but if it propagated
   * it would reject the host's `updateData` call and the host would treat the
   * whole guest as dead. Each listener is isolated and its failure reported.
   */
  function dispatch<T>(listeners: Set<(value: T) => void>, value: T, label: string) {
    for (const listener of listeners) {
      try {
        listener(value)
      } catch (error) {
        host().log('error', `${label} listener failed: ${describe(error)}`)
      }
    }
  }

  return {
    async mount(options: GuestMountOptions) {
      if (destroyed) return

      try {
        const { root, document } = surface.prepare(options)

        const ctx: GuestContext = {
          root,
          document,
          pluginId: options.pluginId,
          method: options.method,
          schema: options.schema,
          uischema: options.uischema,
          data: options.data,
          settings: options.settings,
          readonly: options.readonly,
          theme: options.theme,
          /**
           * Written locally *and* sent.
           *
           * The host suppresses the echo of a guest's own write — without that,
           * a guest patching on every keystroke is told about each keystroke it
           * just made, and anything that re-renders from `ctx.data` loops. The
           * cost of that suppression is that the guest does not hear its own
           * change either, so it makes it here. `ctx.data` stays true, and
           * `onData` fires once, immediately, rather than after a round trip.
           */
          setData: (data) => {
            ctx.data = data
            dispatch(dataListeners, data, 'onData')
            void host().setData(data)
          },
          patchData: (patch) => {
            ctx.data = applyPatch(ctx.data, patch)
            dispatch(dataListeners, ctx.data, 'onData')
            void host().patchData(patch)
          },
          onData: (listener) => {
            dataListeners.add(listener)
            return () => dataListeners.delete(listener)
          },
          onTheme: (listener) => {
            themeListeners.add(listener)
            return () => themeListeners.delete(listener)
          },
          call: (fn, body) => host().call(fn, body),
          notify: (notification) => host().notify(notification),
        }
        context = ctx

        const module = await importGuestModule(options.source)
        const result = await entryPointOf(module)(ctx)
        if (typeof result === 'function') cleanup = result as () => void

        surface.settled?.()
        host().ready()
      } catch (error) {
        // The host needs the message, not a rejected promise it has to unwrap
        // across a thread boundary where stacks do not survive.
        host().failed(describe(error))
      }
    },

    async updateData(data: unknown) {
      if (!context) return
      context.data = data
      dispatch(dataListeners, data, 'onData')
    },

    async updateTheme(theme: ThemeSnapshot) {
      if (!context) return
      context.theme = theme
      dispatch(themeListeners, theme, 'onTheme')
    },

    async destroy() {
      if (destroyed) return
      destroyed = true
      try {
        cleanup?.()
      } catch (error) {
        host().log('warn', `guest cleanup failed: ${describe(error)}`)
      }
      dataListeners.clear()
      themeListeners.clear()
      surface.teardown?.()
      context = undefined
    },
  }
}

/** Anything thrown → a line worth showing a plugin author. */
export function describe(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`
  return String(error)
}
