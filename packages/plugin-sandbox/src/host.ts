/**
 * The host half: starting a sandbox, feeding it, and taking it down.
 *
 * Both renderers are driven through the same {@link SandboxSession}, so the
 * component that renders a plugin's dialog does not branch on which one it got
 * beyond choosing where the output goes. That symmetry is what makes the
 * `renderer` field in the protocol a *preference* rather than a fork: a host may
 * honour `remote` with an iframe (no `Worker`, a policy that forbids blob
 * workers) or refuse a code renderer entirely and fall back to the declarative
 * form, and the plugin is unchanged.
 */

import { RemoteReceiver } from '@remote-dom/core/receivers'
import { ThreadMessagePort, ThreadWebWorker, retain, release } from '@quilted/threads'
import type { GuestNotification, SandboxGuestApi, SandboxHostApi } from './bridge'
import type { RendererSpec } from './protocol'
import { collectStyles, readTheme, type ThemeSnapshot } from './theme'

/** What the host must answer while a guest is running. */
export interface SandboxCallbacks {
  /** The guest replaced the form's data. */
  onData(data: unknown): void
  /** The guest patched leaves of the form's data. */
  onPatch(patch: Record<string, unknown>): void
  /** The guest said something about a field or the form. */
  onNotify(notification: GuestNotification | string): void
  /**
   * The guest called one of its plugin's meta functions. The host attaches the
   * settings profile and performs the call — which is the whole reason a guest
   * can use credentials it is never handed.
   */
  onCall(fn: string, body?: Record<string, unknown>): Promise<unknown>
  /** The guest mounted successfully. */
  onReady(): void
  /** The guest failed. The host shows this and falls back. */
  onError(message: string): void
  /** The guest reported its content height. Only the `iframe` renderer calls this. */
  onHeight?(height: number): void
}

/** What a started sandbox offers its host. */
export interface SandboxSession {
  /** Push host-side data changes into the guest. */
  updateData(data: unknown): void
  /** Push a theme change into the guest. */
  updateTheme(theme: ThemeSnapshot): void
  /** Tear the guest down. Idempotent. */
  destroy(): void
}

/** Everything a sandbox needs to start. */
export interface SandboxOptions {
  spec: RendererSpec
  pluginId?: string
  method?: string
  schema?: Record<string, unknown>
  uischema?: Record<string, unknown>
  data: unknown
  settings?: Record<string, unknown>
  readonly?: boolean
  /** The element the theme is read from — the drawer, not the page. */
  themeRoot: Element
  callbacks: SandboxCallbacks
}

// ------------------------------------------------------------- integrity ----

/** Base64 of a digest, for comparison with an `integrity` value. */
async function digest(algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512', bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest(algorithm, bytes)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

/**
 * The module the guest will import, with `integrity` enforced if it was given.
 *
 * Enforcement is done by *fetching the bytes here and handing them over as
 * source*, not by asking the guest to check itself. That is the only ordering
 * that means anything: a check performed inside the sandbox is a check
 * performed by the code under suspicion.
 *
 * Without an `integrity` the URL is passed through and the guest imports it
 * directly, which is faster and cacheable. A catalog plugin should always ship
 * the hash — the sandbox bounds what a guest can *do*, but only this says the
 * bytes are the ones that were reviewed.
 */
async function resolveSource(spec: RendererSpec): Promise<{ module?: string; code?: string }> {
  if (spec.code) return { code: spec.code }
  if (!spec.module) throw new Error('renderer named neither `module` nor `code`')

  /**
   * Made absolute **here**, before it crosses into the sandbox.
   *
   * Neither sandbox can do this for itself. A blob worker's base URL is
   * `blob:https://host/<uuid>`, which is not hierarchical, so `/guests/x.js`
   * resolves against nothing and `import()` fails with a module-specifier
   * error that points at the blob and explains none of this. A null-origin
   * frame has no origin to resolve against at all. The host is the only party
   * that knows where a relative URL was relative *to*.
   */
  const module = new URL(spec.module, document.baseURI).href

  /**
   * A frame guest is always fetched here, never by itself.
   *
   * This is the single most practical difference between the two renderers, and
   * it is not obvious until you hit it. A `sandbox="allow-scripts"` frame has an
   * **opaque** origin, so every request it makes carries `Origin: null` — and a
   * server that is perfectly happy to serve the host's origin will reject that,
   * because almost nobody configures CORS for `null` and `Access-Control-Allow-Origin: *`
   * is a decision most API gateways will not make on a plugin's behalf.
   *
   * The Worker guest has no such problem: a blob worker inherits the *host's*
   * origin, so a plugin need only allow the host, which is an ordinary thing to
   * ask for.
   *
   * Fetching here levels them. The request goes out from the host's origin, the
   * bytes are handed to the frame as source, and the frame imports a blob of
   * its own making — which it is allowed to do, because the blob is its own.
   */
  const needsBytes = spec.type === 'iframe' || !!spec.integrity

  if (!needsBytes) return { module }

  const response = await fetch(module, { credentials: 'omit', mode: 'cors' })
  if (!response.ok) throw new Error(`fetching renderer module failed: ${response.status} ${response.statusText}`)
  const bytes = await response.arrayBuffer()

  if (!spec.integrity) return { code: new TextDecoder().decode(bytes) }

  const match = /^(sha256|sha384|sha512)-(.+)$/.exec(spec.integrity.trim())
  if (!match) throw new Error(`unsupported integrity format: ${spec.integrity}`)

  const algorithm = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[match[1]] as
    | 'SHA-256' | 'SHA-384' | 'SHA-512'

  const actual = await digest(algorithm, bytes)
  if (actual !== match[2]) {
    throw new Error(`renderer module failed its integrity check (expected ${match[1]}-${match[2]}, got ${match[1]}-${actual})`)
  }

  return { code: new TextDecoder().decode(bytes) }
}

// ---------------------------------------------------------------- shared ----

/**
 * The host API handed to a guest.
 *
 * Every entry is a narrow, named capability. There is no general-purpose
 * message channel and no object the guest can walk to find more — the surface
 * is exactly this and it is auditable at a glance.
 */
function createHostApi(
  options: SandboxOptions,
  state: { alive: boolean },
): SandboxHostApi {
  const { callbacks, pluginId } = options
  const tag = pluginId ? `[sandbox ${pluginId}]` : '[sandbox]'

  const guard = <T extends unknown[]>(fn: (...args: T) => void) => async (...args: T) => {
    // A guest that keeps posting after it was torn down — a pending timer, an
    // in-flight fetch resolving late — must not write into a form that has
    // moved on, or into one belonging to a different node entirely.
    if (!state.alive) return
    fn(...args)
  }

  return {
    ready: guard(() => callbacks.onReady()),
    failed: guard((message: string) => {
      const framework = options.spec.framework ? ` [${options.spec.framework}]` : ''
      callbacks.onError(`${String(message)}${framework}`)
    }),
    setData: guard((data: unknown) => callbacks.onData(data)),
    patchData: guard((patch: Record<string, unknown>) => {
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) callbacks.onPatch(patch)
    }),
    notify: guard((notification: GuestNotification | string) => callbacks.onNotify(notification)),
    setHeight: guard((height: number) => {
      if (Number.isFinite(height) && height >= 0) callbacks.onHeight?.(height)
    }),
    log: guard((level: 'debug' | 'info' | 'warn' | 'error', message: string) => {
      const channel = level === 'debug' ? 'log' : level
      console[channel as 'log' | 'info' | 'warn' | 'error'](`${tag} ${message}`)
    }),
    async call(fn: string, body?: Record<string, unknown>) {
      if (!state.alive) return undefined
      if (typeof fn !== 'string' || !fn) throw new Error('call() needs a meta function name')
      return callbacks.onCall(fn, body)
    },
  }
}

/** The mount payload, assembled once and used by both renderers. */
async function mountOptions(options: SandboxOptions) {
  return {
    source: await resolveSource(options.spec),
    pluginId: options.pluginId,
    method: options.method,
    schema: options.schema,
    uischema: options.uischema,
    data: options.data,
    // Withheld unless the plugin explicitly asked and the host agreed. A
    // settings profile is credentials, and the guest is the party being
    // isolated — it reaches its service through `call`, where the host attaches
    // them and the guest never sees them.
    settings: options.spec.exposeSettings ? options.settings : undefined,
    theme: readTheme(options.themeRoot),
    // Only the frame gets them — see the field's note. Collecting them for a
    // remote guest would be pure waste: its nodes are already inside the
    // document these sheets style.
    styles: options.spec.type === 'iframe' ? collectStyles() : undefined,
    readonly: options.readonly ?? false,
  }
}

/**
 * Give up on a guest that never reports in.
 *
 * A module that hangs on import — a dependency fetched from a host that is down,
 * a top-level `await` on a promise nobody resolves — would otherwise leave the
 * drawer showing a spinner forever. The timeout turns that into a message and a
 * fallback to the declarative form.
 */
function withTimeout(spec: RendererSpec, onTimeout: () => void): () => void {
  const timer = setTimeout(onTimeout, spec.timeout ?? 10_000)
  return () => clearTimeout(timer)
}

// ---------------------------------------------------------------- remote ----

/** A started `remote` sandbox, plus the receiver its tree is rendered from. */
export interface RemoteSandbox extends SandboxSession {
  receiver: RemoteReceiver
}

/**
 * Start a guest in a Web Worker and mirror its tree into a `RemoteReceiver`.
 *
 * `retain` / `release` are `@quilted/threads`' memory management, wired into the
 * receiver's own hooks. They matter because the guest's event listeners cross
 * the boundary as proxied functions: without retaining them the thread would
 * collect a listener the host still holds, and a button would stop responding
 * some unpredictable time after it was rendered.
 */
export function startRemoteSandbox(
  options: SandboxOptions,
  bootstrap: { source?: string; url?: string },
): RemoteSandbox {
  const state = { alive: true }
  const host = createHostApi(options, state)

  const receiver = new RemoteReceiver({ retain, release })

  /**
   * The worker is started from a blob, not from a file beside the library.
   *
   * `new Worker(new URL('./guest/worker.ts', import.meta.url))` is the
   * idiomatic spelling and it does not survive being bundled by a consumer:
   * library mode rewrites it to an absolute path marked `@vite-ignore`, which
   * then resolves against the *application's* origin and points at a file
   * nobody copied there. A blob has no path to be wrong about.
   *
   * It is same-origin with the host, which is what lets it `import()` the
   * plugin's module over CORS — and it costs a CSP that must allow
   * `worker-src blob:`. A host that cannot allow it passes `bootstrap.url` and
   * serves the file itself.
   */
  const blobUrl = bootstrap.url
    ? undefined
    : URL.createObjectURL(new Blob([bootstrap.source ?? ''], { type: 'text/javascript' }))

  const worker = new Worker(bootstrap.url ?? blobUrl!, {
    type: 'module',
    name: options.pluginId ? `inflow-sandbox:${options.pluginId}` : 'inflow-sandbox',
  })

  const thread = new ThreadWebWorker<SandboxGuestApi, SandboxHostApi>(worker, { exports: host })
  const guest = thread.imports
  let session: RemoteSandbox

  function fail(message: string) {
    if (!state.alive) return
    void host.failed(message)
    session.destroy()
  }

  const cancelTimeout = withTimeout(options.spec, () => {
    fail(`the renderer did not start within ${options.spec.timeout ?? 10_000}ms`)
  })

  // A worker that fails to *load* (a 404 on the chunk, a CSP that forbids it)
  // fires `error` on the worker itself and never reaches the guest's own
  // handlers, so it has to be caught here or it is invisible.
  worker.addEventListener('error', (event) => {
    fail(`the renderer failed to load: ${event.message || 'unknown error'}`)
  })

  void (async () => {
    try {
      await guest.mount({ ...(await mountOptions(options)), connection: receiver.connection as never })
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    } finally {
      cancelTimeout()
    }
  })()

  session = {
    receiver,
    updateData: (data) => { if (state.alive) void guest.updateData(data) },
    updateTheme: (theme) => { if (state.alive) void guest.updateTheme(theme) },
    destroy() {
      if (!state.alive) return
      state.alive = false
      cancelTimeout()
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      // Ask politely, then terminate regardless. A guest spinning in a loop
      // would never process the `destroy` message, and a drawer that has been
      // closed must not leave a thread burning a core.
      void Promise.resolve(guest.destroy()).catch(() => {})
      setTimeout(() => worker.terminate(), 50)
    },
  }
  return session
}

// ---------------------------------------------------------------- iframe ----

/**
 * The frame's document.
 *
 * `srcdoc` rather than a URL: it needs no route to serve, no asset to ship
 * beside the library, and with `sandbox="allow-scripts"` and no
 * `allow-same-origin` the result is an opaque origin that can neither read the
 * host's storage nor be read by it.
 *
 * The bootstrap is written **inline**, which looks wasteful and is in fact the
 * only thing that reliably works. A `blob:` URL belongs to the creating origin's
 * blob store, and an opaque-origin document is not allowed to fetch one; a
 * same-origin URL would have to be shipped and served next to the library,
 * which breaks the moment a consumer bundles it. Inline text is carried in by
 * the parent and has no origin to be wrong about.
 *
 * The cost is that `srcdoc` inherits the embedding page's CSP, so a host with a
 * strict `script-src` must pass `bootstrap.url` and serve the bootstrap itself.
 */
function frameDocument(bootstrap: { source?: string; url?: string }): string {
  const script = bootstrap.url
    ? `<script type="module" src="${bootstrap.url}"><\/script>`
    : `<script type="module">${bootstrap.source ?? ''}<\/script>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>
</head>
<body>
${script}
</body>
</html>`
}


export interface IframeSandbox extends SandboxSession {
  iframe: HTMLIFrameElement
}

/**
 * Start a guest in a null-origin sandboxed frame.
 *
 * The handshake is the interesting part. A null-origin frame cannot be
 * addressed by origin, so the only `postMessage` either side can make is to
 * `'*'`, which authenticates nobody. That channel is therefore used for exactly
 * one message — the frame announcing itself — after which the host sends a
 * `MessagePort` and everything else goes down it. A port is a capability: no
 * other document can obtain it by guessing an origin or racing a listener.
 */
export function startIframeSandbox(
  options: SandboxOptions,
  bootstrap: { source?: string; url?: string },
): IframeSandbox {
  const state = { alive: true }
  const host = createHostApi(options, state)

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('title', options.method ? `${options.method} settings` : 'Plugin settings')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.style.cssText = 'display:block;width:100%;border:0;background:transparent;'
  iframe.srcdoc = frameDocument(bootstrap)

  let guest: SandboxGuestApi | undefined
  let session: IframeSandbox
  const channel = new MessageChannel()

  function fail(message: string) {
    if (!state.alive) return
    void host.failed(message)
    session.destroy()
  }

  const cancelTimeout = withTimeout(options.spec, () => {
    fail(`the renderer did not start within ${options.spec.timeout ?? 10_000}ms`)
  })

  function onHello(event: MessageEvent) {
    if (!state.alive || event.source !== iframe.contentWindow) return
    if (event.data?.inflowSandbox !== 'hello') return
    window.removeEventListener('message', onHello)

    const thread = new ThreadMessagePort<SandboxGuestApi, SandboxHostApi>(channel.port1, { exports: host })
    guest = thread.imports as SandboxGuestApi

    /**
     * `start()` is required, and its absence is silent.
     *
     * A `MessagePort` only begins delivering messages once it is started, and
     * it is started implicitly *only* by assigning `onmessage`. `@quilted/threads`
     * listens with `addEventListener`, which does not, so without this call the
     * port queues every message forever: no error, no rejection, no timeout
     * from the transport — just a guest that is connected and never hears
     * anything. Both ends have to do it; the other is in `guest/frame.ts`.
     */
    channel.port1.start()

    iframe.contentWindow?.postMessage({ inflowSandbox: 'port' }, '*', [channel.port2])

    void (async () => {
      try {
        await guest!.mount(await mountOptions(options))
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      } finally {
        cancelTimeout()
      }
    })()
  }

  window.addEventListener('message', onHello)

  session = {
    iframe,
    updateData: (data) => { if (state.alive) void guest?.updateData(data) },
    updateTheme: (theme) => { if (state.alive) void guest?.updateTheme(theme) },
    destroy() {
      if (!state.alive) return
      state.alive = false
      cancelTimeout()
      window.removeEventListener('message', onHello)
      void Promise.resolve(guest?.destroy()).catch(() => {})
      channel.port1.close()
      // Removing the frame is what actually stops the guest; a frame's script
      // has no `terminate`, so detaching the document is the only kill switch.
      iframe.remove()
    },
  }
  return session
}
