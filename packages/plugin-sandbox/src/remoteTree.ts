/**
 * The host's renderer for a remote guest's tree.
 *
 * A `RemoteReceiver` keeps a plain-JavaScript mirror of whatever the guest built
 * and lets you subscribe to any node in it. This turns that mirror into real
 * Vue vnodes — which is the step that gives the whole approach its defining
 * property: the output is *host DOM*, in the host's document, inside the drawer.
 * Not a frame, not a shadow root, not a styled approximation. A `<button>` a
 * guest asked for is the same kind of node as a `<button>` in `NodeConfig.vue`,
 * so `.dark`, `--accent`, the inherited font and every Tailwind utility reach it
 * without anything being bridged, copied or re-injected.
 *
 * Subscription is per node rather than per tree. A guest that updates one cell
 * of a table re-renders that cell's component and nothing else, because
 * `receiver.subscribe` fires only for the node that changed and Vue's reactivity
 * stops at the `shallowRef` holding it.
 */

import {
  defineComponent,
  h,
  markRaw,
  onUnmounted,
  shallowRef,
  triggerRef,
  type Component,
  type PropType,
  type VNode,
} from 'vue'
import type {
  RemoteReceiver,
  RemoteReceiverNode,
  RemoteReceiverParent,
  RemoteReceiverRoot,
} from '@remote-dom/core/receivers'
import {
  allowsElement,
  allowsProperty,
  isSafeValue,
  sanitizeStyle,
  sanitizeUrl,
  type SandboxPolicy,
} from './policy'

/** Host components a guest's element names resolve to. */
export type RemoteComponents = Record<string, Component>

const NODE_TYPE_ELEMENT = 1
const NODE_TYPE_TEXT = 3

/**
 * A DOM event → the plain object a guest's listener is called with.
 *
 * A native `Event` cannot cross a thread boundary: it is host-realm, it holds
 * live node references, and `structuredClone` refuses it. So the guest is handed
 * a described event instead — the fields a dialog actually reads, and the form
 * value of whatever was interacted with, which is the single most common thing a
 * listener wants.
 *
 * What is deliberately *not* reproduced is `preventDefault`. Calling it would
 * have to happen back on the host after an async round trip, by which time the
 * browser has long since acted. Rather than offer an API that silently does
 * nothing, there is none: a guest cannot cancel a default action. That is also
 * the safer answer — a guest able to asynchronously veto host interactions could
 * wedge the drawer.
 */
function describeEvent(event: Event): Record<string, unknown> {
  const described: Record<string, unknown> = { type: event.type }

  const target = event.target as HTMLInputElement | null
  if (target) {
    described.target = {
      tagName: target.tagName?.toLowerCase(),
      id: target.id || undefined,
      name: target.name || undefined,
      value: target.value,
      checked: typeof target.checked === 'boolean' ? target.checked : undefined,
      dataset: target.dataset ? { ...target.dataset } : undefined,
    }
  }

  if (event instanceof KeyboardEvent) {
    Object.assign(described, {
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
  }

  if (event instanceof MouseEvent) {
    Object.assign(described, {
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
  }

  // A CustomEvent's detail is the guest's own data coming back to it, but it may
  // have been built by host code in between, so it goes through the same value
  // check as every other property.
  if (event instanceof CustomEvent && isSafeValue(event.detail)) described.detail = event.detail

  return described
}

/** `click` → `onClick`, `pointerdown` → `onPointerdown`. */
function listenerName(event: string): string {
  return `on${event.charAt(0).toUpperCase()}${event.slice(1)}`
}

/**
 * HTML attributes whose mere *presence* means true.
 *
 * They need special handling because a guest's framework cannot know it is not
 * talking to a real DOM, and the difference shows up exactly here.
 *
 * Vue decides between setting a DOM property and setting an attribute with
 * `key in el`. On a real `<button>`, `'disabled' in el` is true and Vue assigns
 * `el.disabled = false`, which does nothing visible. Remote DOM's polyfilled
 * elements implement no IDL properties at all — they are generic nodes — so the
 * test fails, Vue falls back to `setAttribute('disabled', false)`, and what
 * arrives on the wire is the string `"false"`.
 *
 * `<button disabled="false">` is a disabled button. The value of a boolean
 * attribute is ignored; only its presence counts. So the guest renders an
 * enabled button, the host builds a permanently disabled one, and nothing
 * anywhere reports an error. React and Svelte route these the same way and hit
 * the same wall.
 *
 * Normalising here rather than patching the guest's framework is deliberate:
 * the host is the side that knows it is dealing with real HTML, and this way
 * every framework is fixed at once, including ones nobody has tried yet.
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
  'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap',
  'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
  'readonly', 'required', 'reversed', 'selected',
])

/**
 * A boolean attribute's value as it arrived → what to set, or `undefined` to
 * leave it off entirely.
 */
function normalizeBooleanAttribute(value: unknown): string | undefined {
  if (value === false || value === 'false' || value === null || value === undefined) return undefined
  return ''
}

/**
 * One remote node's attributes, properties and listeners → the props Vue applies.
 *
 * Every name goes through the policy and every value through the shape check.
 * The order matters: attributes first, then properties, so a guest that sets
 * both (as frameworks routinely do for `value`) gets the property, which is the
 * one browsers treat as authoritative.
 */
function buildProps(
  node: RemoteReceiverParent,
  policy: SandboxPolicy,
  isIntrinsic: boolean,
): Record<string, unknown> {
  const props: Record<string, unknown> = {}

  for (const [name, raw] of Object.entries(node.attributes ?? {})) {
    if (!allowsProperty(policy, name)) continue
    if (typeof raw !== 'string') continue

    if (name === 'style') {
      props.style = sanitizeStyle(raw)
      continue
    }

    if (BOOLEAN_ATTRIBUTES.has(name)) {
      const normalized = normalizeBooleanAttribute(raw)
      if (normalized !== undefined) props[name] = normalized
      continue
    }

    const value = sanitizeUrl(name, raw)
    if (value !== undefined) props[name] = value
  }

  for (const [name, value] of Object.entries(node.properties ?? {})) {
    if (!allowsProperty(policy, name)) continue
    if (!isSafeValue(value)) continue

    // A guest that *did* route a boolean through properties gets the same
    // treatment, so the two paths cannot disagree about what `false` means.
    if (BOOLEAN_ATTRIBUTES.has(name)) {
      const normalized = normalizeBooleanAttribute(value)
      if (normalized === undefined) delete props[name]
      else props[name] = normalized
      continue
    }

    if (name === 'style' && typeof value === 'string') {
      props.style = sanitizeStyle(value)
      continue
    }

    if (typeof value === 'string') {
      const safe = sanitizeUrl(name, value)
      if (safe === undefined) continue
      props[name] = safe
      continue
    }

    props[name] = value
  }

  for (const [event, listener] of Object.entries(node.eventListeners ?? {})) {
    if (typeof listener !== 'function') continue
    props[listenerName(event)] = (payload: Event) => {
      // The listener lives in the guest and resolves asynchronously; nothing
      // here awaits it. A guest that throws must not surface as an unhandled
      // rejection in the host's console, so it is swallowed at the boundary —
      // the guest's own handlers already forward it through `log`.
      try {
        const result = listener(
          isIntrinsic && payload instanceof Event ? describeEvent(payload) : payload,
        ) as unknown
        if (result instanceof Promise) result.catch(() => {})
      } catch {
        /* reported guest-side */
      }
    }
  }

  return props
}

/**
 * One node of the guest's tree.
 *
 * Recursive by construction: each element renders its children as further
 * instances of this component, each with its own subscription. That is what
 * keeps an update local — and what makes an unmounted subtree unsubscribe
 * itself, since the `AbortController` is tied to the component's lifetime.
 */
export const RemoteNode = defineComponent({
  name: 'InflowRemoteNode',
  props: {
    receiver: { type: Object as PropType<RemoteReceiver>, required: true },
    id: { type: String, required: true },
    policy: { type: Object as PropType<SandboxPolicy>, required: true },
    components: { type: Object as PropType<RemoteComponents>, required: true },
  },
  setup(props) {
    const node = shallowRef<RemoteReceiverNode | undefined>(
      props.receiver.get<RemoteReceiverNode>({ id: props.id }),
    )

    const abort = new AbortController()
    props.receiver.subscribe<RemoteReceiverNode>(
      { id: props.id },
      (next) => {
        node.value = next
        // `triggerRef` is load-bearing, not defensive.
        //
        // A `RemoteReceiver` keeps one object per node and *mutates it in
        // place*, bumping a `version` counter instead of replacing it. So the
        // value handed to this subscriber is almost always the identical object
        // already in the ref, `Object.is` says nothing changed, and a
        // `shallowRef` assignment schedules no re-render at all. The symptom is
        // the worst kind: everything works — the guest mounts, the mutations
        // arrive, the receiver's tree is correct — and the drawer stays empty.
        triggerRef(node)
      },
      { signal: abort.signal },
    )
    onUnmounted(() => abort.abort())

    return () => renderNode(node.value, props.receiver, props.policy, props.components)
  },
})

/** The children of a parent node, each as its own subscribed component. */
export function renderChildren(
  parent: RemoteReceiverParent | undefined,
  receiver: RemoteReceiver,
  policy: SandboxPolicy,
  components: RemoteComponents,
): VNode[] {
  if (!parent) return []
  return parent.children.map((child) =>
    h(RemoteNode, { key: child.id, receiver, id: child.id, policy, components }),
  )
}

function renderNode(
  node: RemoteReceiverNode | undefined,
  receiver: RemoteReceiver,
  policy: SandboxPolicy,
  components: RemoteComponents,
): VNode | string | null {
  if (!node) return null

  if (node.type === NODE_TYPE_TEXT) return node.data

  // Comments carry nothing a user sees, and rendering them would let a guest
  // place arbitrary text into the host's markup stream. Dropped.
  if (node.type !== NODE_TYPE_ELEMENT) return null

  const element = node as unknown as RemoteReceiverParent & { element: string }
  const name = element.element

  // The quiet half of the policy: an element the host does not offer renders as
  // nothing at all, rather than as an unknown tag the browser would happily
  // create. A guest cannot introduce a tag by naming one.
  if (!allowsElement(policy, name)) return null

  const component = components[name]
  const isCustom = name.includes('-')
  // A custom name with no host component is still *something* — a guest built
  // for a newer host degrades to a styled box carrying its own name, which is
  // debuggable, rather than disappearing.
  const tag = component ?? (isCustom ? 'div' : name)

  const vnodeProps = buildProps(element, policy, !component)
  if (!component && isCustom) vnodeProps['data-inflow-element'] = name

  const children = renderChildren(element, receiver, policy, components)

  // Void elements must not be given children, or Vue warns and the browser
  // silently reparents them.
  if (!component && VOID_ELEMENTS.has(name)) return h(tag as never, vnodeProps)

  return h(tag as never, vnodeProps, component ? { default: () => children } : children)
}

const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'col', 'wbr'])

/** The root of a guest's tree — the receiver's `root`, rendered as a fragment. */
export const RemoteRoot = defineComponent({
  name: 'InflowRemoteRoot',
  props: {
    receiver: { type: Object as PropType<RemoteReceiver>, required: true },
    policy: { type: Object as PropType<SandboxPolicy>, required: true },
    components: { type: Object as PropType<RemoteComponents>, default: () => ({}) },
  },
  setup(props) {
    const root = shallowRef(props.receiver.root)

    const abort = new AbortController()
    props.receiver.subscribe<RemoteReceiverRoot>(
      props.receiver.root,
      (next) => {
        root.value = next
        // See the note in `RemoteNode`: the receiver mutates its nodes in
        // place, so the ref has to be told that the value it already holds is
        // no longer the value it was.
        triggerRef(root)
      },
      { signal: abort.signal },
    )
    onUnmounted(() => abort.abort())

    const components = markRaw(props.components)

    return () => renderChildren(root.value, props.receiver, props.policy, components)
  },
})
