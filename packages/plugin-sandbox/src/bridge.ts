/**
 * The contract between the host and a sandboxed guest.
 *
 * Both renderers speak it. That is deliberate and it is the reason the protocol
 * carries a `renderer` *type* rather than two unrelated mechanisms: a plugin
 * author writes one guest module, and whether it ends up in a Worker or in a
 * frame is a deployment decision the host can revisit — or override, when a
 * browser lacks one of them — without the plugin being rewritten.
 *
 * Everything crossing this boundary is data. The one exception is functions,
 * which `@quilted/threads` proxies by reference in both directions; a function
 * the guest hands over is never *transferred*, it is a handle the host may call,
 * and it remains executing in the guest's realm with the guest's privileges.
 */

import type { ThemeSnapshot } from './theme'

/**
 * Every method on both sides resolves rather than returning.
 *
 * Not a style choice — it is what crossing a thread *is*. A call here is a
 * message, and the answer, if there is one, arrives in a later task. Typing
 * these as synchronous would be a lie the first `await` would expose, and the
 * transport refuses to proxy a method that does not return a promise, which is
 * the type system enforcing the same truth.
 */

/** A message a guest raises about a field, matching the `x-inflow-notif` vocabulary
 *  the declarative renderer already uses — one notification type across both. */
export interface GuestNotification {
  id?: string
  severity?: 'help' | 'info' | 'success' | 'warning' | 'error'
  display?: 'inline' | 'banner' | 'toast' | 'dialog'
  title?: string
  message?: string
  field?: string
  timeout?: number
  dismissible?: boolean
  [key: string]: unknown
}

/**
 * What the host exposes to the guest.
 *
 * Note what is *not* here: no DOM, no storage, no navigation, no direct network
 * to the host's origin, and above all no credentials. `call` is the guest's only
 * route to its own service, and the host attaches the settings profile on the
 * way out — so a guest can use a token it is never given.
 */
export interface SandboxHostApi {
  /** The guest has mounted and the host may stop showing its loading state. */
  ready(): Promise<void>
  /** The guest failed irrecoverably. The host shows this, and the fallback form. */
  failed(message: string): Promise<void>
  /** Replace the form's data wholesale. */
  setData(data: unknown): Promise<void>
  /** Patch leaves of the form's data, keyed by absolute data path. */
  patchData(patch: Record<string, unknown>): Promise<void>
  /** Say something about a field, or about the form. */
  notify(notification: GuestNotification | string): Promise<void>
  /**
   * Call one of the plugin's own meta functions.
   *
   * The same transport `x-inflow-ui`'s `pluginFn` action uses, so a plugin's
   * meta functions serve both renderers unchanged. The host adds `settings` to
   * the body; the guest neither supplies nor sees it.
   */
  call(fn: string, body?: Record<string, unknown>): Promise<unknown>
  /** Report content height. Honoured by the `iframe` renderer, ignored by `remote`,
   *  which has no box to size. */
  setHeight(height: number): Promise<void>
  /** Write to the host's console, tagged with the plugin. A guest's own console
   *  in a Worker is visible in devtools but easy to miss. */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): Promise<void>
}

/** What the host hands the guest at mount. */
export interface GuestMountOptions {
  /**
   * The plugin's module, as the spec named it.
   *
   * The *host* resolved and integrity-checked it; the guest only imports. That
   * split matters: integrity has to be verified by the party that is not under
   * the attacker's control, and inside the sandbox nothing is.
   */
  source: { module?: string; code?: string }
  /** The plugin this form belongs to. */
  pluginId?: string
  /** The action the form configures, or `@settings` for an onboarding form. */
  method?: string
  /** The JSON Schema — the data contract the guest must produce, whatever it draws. */
  schema?: Record<string, unknown>
  /** The UI schema, if the plugin shipped one. A code renderer is free to ignore it. */
  uischema?: Record<string, unknown>
  /** The form's current data. */
  data: unknown
  /** The settings profile — **only** when the spec set `exposeSettings`. */
  settings?: Record<string, unknown>
  /** The host's theme at mount. */
  theme: ThemeSnapshot
  /**
   * The host's stylesheets, for a guest that has none of its own.
   *
   * Sent only to the `iframe` renderer, and the asymmetry is the whole point of
   * the comparison: a `remote` guest's nodes live in the host's document and are
   * styled by these sheets automatically, so it is never sent them. A frame is a
   * separate document where nothing cascades in, so they have to be copied —
   * and kept copied, which is the maintenance cost the other renderer does not
   * have.
   */
  styles?: { inline: string[]; links: string[] }
  /** Whether the form is being shown read-only. */
  readonly: boolean
  /** The `remote` renderer's wire to the host's receiver. Absent in a frame,
   *  where the guest has a real DOM instead. */
  connection?: { mutate(records: readonly unknown[]): void; call(id: string, method: string, ...args: unknown[]): unknown }
}

/** What the guest exposes to the host. */
export interface SandboxGuestApi {
  /** Load the plugin's module and draw. Resolves when the module's `mount` returns. */
  mount(options: GuestMountOptions): Promise<void>
  /** The host's data changed underneath the guest (another field, a reset). */
  updateData(data: unknown): Promise<void>
  /** The host's theme changed. */
  updateTheme(theme: ThemeSnapshot): Promise<void>
  /** The form is going away. The guest should run its cleanup. */
  destroy(): Promise<void>
}

/**
 * What a plugin's module is handed.
 *
 * This is the surface a plugin author writes against, and it is intentionally
 * shaped like `InflowActionContext` from `@inflowenger/plugin-form-builder`:
 * `data`, `schema`, `call`, `notify`, `setData` mean the same things in both, so
 * moving a dialog from the declarative renderer to a code one is a change of
 * drawing, not a change of vocabulary.
 */
export interface GuestContext {
  /** Where to draw. A real `Element` in a frame; a Remote DOM element, which
   *  behaves like one, in a Worker. */
  root: Element
  /** The `document` to create nodes from — likewise real or polyfilled. */
  document: Document
  pluginId?: string
  method?: string
  schema?: Record<string, unknown>
  uischema?: Record<string, unknown>
  /** The form's data, as of the last change. Read it; write through `setData`. */
  data: unknown
  settings?: Record<string, unknown>
  readonly: boolean
  /** The host's theme, kept current. */
  theme: ThemeSnapshot
  /** Replace the form's data. */
  setData(data: unknown): void
  /** Patch leaves of the form's data. */
  patchData(patch: Record<string, unknown>): void
  /** Observe host-side data changes. Returns the unsubscribe. */
  onData(listener: (data: unknown) => void): () => void
  /** Observe host theme changes. Returns the unsubscribe. */
  onTheme(listener: (theme: ThemeSnapshot) => void): () => void
  /** Call one of this plugin's meta functions. */
  call(fn: string, body?: Record<string, unknown>): Promise<unknown>
  /** Say something about a field, or about the form. */
  notify(notification: GuestNotification | string): void
}

/** What a plugin's module exports: a default function, or a named `mount`. */
export type GuestModule =
  | ((context: GuestContext) => void | (() => void) | Promise<void | (() => void)>)
  | { default?: (context: GuestContext) => void | (() => void) | Promise<void | (() => void)>
      mount?: (context: GuestContext) => void | (() => void) | Promise<void | (() => void)> }
