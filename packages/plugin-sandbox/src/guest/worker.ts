/**
 * The `remote` renderer's guest, running in a Web Worker.
 *
 * A Worker is the strongest isolation a browser offers inside a page. It has no
 * `document`, no `window`, no cookies, no `localStorage`, no access to the
 * opener, and no way to navigate anything. It cannot read a host DOM node for
 * the plain reason that there is no DOM to read.
 *
 * What it *does* have, after the polyfill below, is a convincing imitation of
 * one: `document.createElement`, `appendChild`, `setAttribute`,
 * `addEventListener`, `customElements`, `MutationObserver`. Frameworks that
 * target the DOM — Preact, React, Vue, Svelte — run against it unmodified. Every
 * mutation they make is observed and sent to the host as a list of records, and
 * the host builds the real nodes.
 *
 * So the guest believes it is rendering, and in a sense it is: it is just
 * rendering through a keyhole it cannot widen.
 */

import { hooks } from '@remote-dom/core/polyfill'
import {
  RemoteRootElement,
  BatchingRemoteConnection,
  updateRemoteElementEventListener,
} from '@remote-dom/core/elements'
import { ThreadWebWorker } from '@quilted/threads'
import type { GuestMountOptions, SandboxGuestApi, SandboxHostApi } from '../bridge'
import { createGuestRuntime } from './runtime'

/**
 * `hooks` is imported **by name**, and the import must not be reduced to a bare
 * side-effect one.
 *
 * `@remote-dom/core` declares `"sideEffects": false`, which is true of almost
 * all of it and catastrophically false of `polyfill/hooks`: importing that
 * module is what installs the `insertChild` / `removeChild` / `setText` /
 * `setAttribute` callbacks that turn the polyfilled DOM's mutations into
 * records on the wire. A bundler told there are no side effects drops it, and
 * what is left is a guest that renders perfectly into a DOM nobody is watching
 * — it mounts, it reports ready, and the host receives an empty tree. No error
 * is raised anywhere, because nothing went wrong; the messages were simply never
 * sent.
 *
 * Naming the binding and asserting on it keeps the module in the graph and
 * turns a silent blank dialog into a loud failure if a future bundler outsmarts
 * this too.
 */
if (typeof hooks.insertChild !== 'function') {
  throw new Error(
    'Remote DOM mutation hooks are missing — the polyfill hooks module was tree-shaken out of this bundle',
  )
}

/**
 * Mirror `addEventListener` on ordinary elements.
 *
 * Remote DOM ships hooks for `insertChild`, `removeChild`, `setText` and
 * `setAttribute`, and the polyfill dispatches an `addEventListener` hook too —
 * but `@remote-dom/core` leaves that one unimplemented, because its intended
 * design is that a guest renders *custom* elements (`RemoteElement` subclasses)
 * which declare the events they accept, and the host maps those to components.
 *
 * That is a reasonable design and it is not the one a plugin author shows up
 * with. They arrive with Vue, or Preact, or forty lines of `createElement`, all
 * of which call `addEventListener` on a plain `<button>`. Without this, those
 * listeners are registered against a DOM in a Worker that nothing will ever
 * dispatch an event into: the dialog renders perfectly and does nothing at all
 * when clicked.
 *
 * So plain elements get the same treatment custom ones get. Custom elements are
 * skipped, because `RemoteElement` already manages its own event listeners and
 * writing over them here would fight it.
 */
function isCustomElement(target: unknown): boolean {
  const tagName = (target as Element | null)?.tagName
  return typeof tagName === 'string' && tagName.includes('-')
}

/**
 * Every listener the guest registered, per element and event name.
 *
 * Remote DOM carries **one** listener per (element, event), because its model
 * is a declarative `eventListeners` record rather than the DOM's registration
 * list. Mirroring naively would therefore make a second `addEventListener` for
 * the same event silently replace the first — a bug that only shows up in the
 * guests that need it most, since a component library commonly attaches its own
 * `click` alongside the application's.
 *
 * So one mirrored dispatcher is installed per (element, event) and the real
 * listeners are kept here, on this side, where the DOM's semantics can be
 * honoured properly.
 */
const listeners = new WeakMap<object, Map<string, Set<Function>>>()

hooks.addEventListener = (target, type, listener) => {
  if (isCustomElement(target) || typeof listener !== 'function') return

  let byType = listeners.get(target)
  if (!byType) {
    byType = new Map()
    listeners.set(target, byType)
  }

  let forType = byType.get(type)
  if (!forType) {
    forType = new Set()
    byType.set(type, forType)

    updateRemoteElementEventListener(target as never, type, ((event: unknown) => {
      // A copy, because a listener is allowed to remove itself — or another —
      // while the set is being walked.
      for (const fn of [...forType!]) {
        try {
          /**
           * `call(target, ...)` is not a formality.
           *
           * Preact registers exactly one listener per event — an `eventProxy`
           * that looks the real handler up with `this._listeners[event.type]`.
           * Invoked as a bare function across the boundary, `this` is
           * `undefined` and every Preact event handler throws before it runs.
           * React's delegated listeners and jQuery-era code lean on `this` the
           * same way. Binding it to the element is what makes "any framework"
           * true rather than "any framework that happens to use closures".
           */
          ;(fn as (this: unknown, event: unknown) => void).call(target, event)
        } catch (error) {
          console.error('[inflow-sandbox] listener threw', error)
        }
      }
    }) as never)
  }

  forType.add(listener)
}

hooks.removeEventListener = (target, type, listener) => {
  const byType = listeners.get(target)
  const forType = byType?.get(type)
  if (!byType || !forType) return

  forType.delete(listener as Function)
  if (forType.size > 0) return

  // The last one went: take the mirrored dispatcher off the wire too, so the
  // host stops attaching a handler that would now do nothing.
  byType.delete(type)
  updateRemoteElementEventListener(target as never, type, undefined as never)
}

customElements.define('remote-root', RemoteRootElement)

let root: RemoteRootElement | undefined

const api = createGuestRuntime(
  {
    prepare(options: GuestMountOptions) {
      if (!options.connection) {
        throw new Error('the remote renderer was started without a connection to the host')
      }

      const element = document.createElement('remote-root') as RemoteRootElement

      /**
       * Batched, and that is not an optimisation detail — it is what makes this
       * renderer usable.
       *
       * Every mutation crosses a `postMessage` boundary. A framework's initial
       * render is hundreds of them, and sent one at a time each would be its own
       * serialisation, its own task, and its own paint on the host. Batching
       * collapses a render pass into a single message, so the host applies the
       * tree in one go — which is also why there is no visible tearing when a
       * guest re-renders.
       */
      element.connect(new BatchingRemoteConnection(options.connection as never))
      document.body.append(element)
      root = element

      return { root: element as unknown as Element, document: globalThis.document }
    },

    teardown() {
      root?.remove()
      root = undefined
    },
  },
  () => host,
)

const thread = new ThreadWebWorker<SandboxHostApi, SandboxGuestApi>(self as never, { exports: api })
const host = thread.imports as SandboxHostApi

/**
 * A guest that throws asynchronously — a failed fetch in a `setTimeout`, a
 * rejected promise nobody awaited — would otherwise die silently, because a
 * Worker's uncaught errors go to a console almost nobody has open. Forward them
 * to the host, which has a drawer to show them in.
 */
self.addEventListener('error', (event) => {
  host.log('error', `uncaught error in guest: ${event.message}`)
})
self.addEventListener('unhandledrejection', (event) => {
  host.log('error', `unhandled rejection in guest: ${String((event as PromiseRejectionEvent).reason)}`)
})
