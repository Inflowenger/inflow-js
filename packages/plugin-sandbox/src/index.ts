import './sandbox.css'

/**
 * `@inflowenger/plugin-sandbox` — the `renderer` half of the Inflow `@form`
 * protocol.
 *
 * A plugin describes its dialogs as JSON Schema + JSON Forms UI schema, and
 * `@inflowenger/plugin-form-builder` draws them. That remains the default and
 * the recommendation. This package is what happens when a dialog is not a form:
 * it lets a plugin ship *code*, and then makes shipping code safe enough to
 * accept from a third party.
 *
 * Two renderers, one contract:
 *
 * - `remote` — a Web Worker plus Remote DOM. The guest has no DOM to attack
 *   from, and the nodes the user sees are built by the host from an allow-list,
 *   in the host's document. The theme applies because there is nothing between
 *   the guest's output and the drawer around it.
 * - `iframe` — a null-origin sandboxed frame. A real document, for guests that
 *   need one, at the price of a theme that must be injected and a height that
 *   must be measured.
 *
 * @see protocol.ts for the wire format
 * @see policy.ts for what a guest is allowed to put on the page
 */

export * from './protocol'
export * from './bridge'
export * from './theme'
export * from './policy'
export * from './data'
export * from './host'
export { RemoteNode, RemoteRoot, renderChildren, type RemoteComponents } from './remoteTree'
export { default as InflowSandboxForm } from './InflowSandboxForm.vue'
