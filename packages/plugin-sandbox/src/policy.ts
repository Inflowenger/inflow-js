/**
 * What a guest is allowed to put on the page.
 *
 * The `remote` renderer's whole safety argument rests here, and it is worth
 * stating plainly, because it is the opposite of how an iframe works.
 *
 * An iframe is safe because the guest is *elsewhere*: it has its own document
 * and cannot reach ours. A remote guest has no document at all — it runs in a
 * Worker and only ever emits a list of mutation records saying "make an element
 * called X with property Y". The nodes are built **here**, by us, from those
 * records. So the guest is safe not because it is walled off from the host DOM
 * but because it never touches it: it can only ask, and this module is what
 * decides which asks are honoured.
 *
 * That inverts the usual trade. An iframe grants everything inside its walls and
 * nothing outside; a remote guest grants exactly this list and nothing else. It
 * is a smaller grant, it is auditable in one file, and — the reason it matters
 * for a settings drawer — the nodes it produces are ordinary host nodes, so the
 * theme applies to them without a bridge.
 */

/**
 * The intrinsic HTML a guest may create.
 *
 * Structure, text and the form controls a settings dialog actually needs.
 * Everything that loads or executes something is absent and stays absent:
 * `script`, `style`, `link`, `meta`, `base`, `iframe`, `object`, `embed`,
 * `applet`, `frame`, `frameset`, `template`, `slot`, `portal`. `form` is absent
 * too — a guest that could submit a form could navigate the host page, which is
 * the one thing a sandboxed guest must never do.
 */
export const DEFAULT_ELEMENTS: readonly string[] = [
  // Structure
  'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'figure', 'figcaption', 'details', 'summary', 'fieldset', 'legend',
  // Text
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'sub', 'sup',
  'code', 'pre', 'kbd', 'samp', 'var', 'blockquote', 'q', 'cite', 'abbr', 'time',
  'hr', 'br', 'wbr', 'a', 'img',
  // Controls
  'button', 'input', 'textarea', 'select', 'option', 'optgroup', 'label',
  'progress', 'meter', 'output', 'datalist',
  // Vector
  'svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'text', 'tspan', 'defs', 'use', 'symbol', 'linearGradient', 'radialGradient', 'stop', 'title',
]

/**
 * The element names a host maps to its own components.
 *
 * A guest that renders `<inflow-button>` gets the host's real button — the same
 * component `NodeConfig.vue` uses, with the host's focus ring, its disabled
 * state and its dark-mode treatment — without knowing anything about it. This is
 * the seam that lets a plugin's dialog look native rather than merely themed,
 * and it costs the plugin author nothing: the names are just elements.
 *
 * Unmapped names render as a `<div>` carrying the name as a `data-inflow-element`
 * attribute, so a guest built against a newer host degrades to a styled box
 * rather than vanishing.
 */
export const INFLOW_ELEMENTS: readonly string[] = [
  'inflow-stack', 'inflow-row', 'inflow-field', 'inflow-label', 'inflow-note',
  'inflow-button', 'inflow-input', 'inflow-textarea', 'inflow-select', 'inflow-option',
  'inflow-checkbox', 'inflow-switch', 'inflow-badge', 'inflow-divider',
  'inflow-table', 'inflow-empty', 'inflow-spinner', 'inflow-code',
]

/**
 * Property and attribute names refused on every element.
 *
 * The first group is the prototype-pollution surface — a guest that can set
 * `__proto__` on a record the host spreads into a component's props owns the
 * host. The second is the markup-injection surface: every documented way to get
 * a string parsed as HTML. The third is navigation.
 *
 * Event listeners are *not* blocked here because they never arrive as
 * properties — Remote DOM carries them on their own channel, where they are
 * already constrained to be functions.
 */
export const BLOCKED_PROPERTIES: readonly string[] = [
  '__proto__', 'constructor', 'prototype',
  'innerHTML', 'outerHTML', 'innerText', 'insertAdjacentHTML',
  'dangerouslySetInnerHTML', 'srcdoc', 'srcset',
  'action', 'formaction', 'formAction', 'target', 'ping',
  'nonce', 'integrity', 'is',
]

/** URL schemes an `href` / `src` may use. Everything else is dropped. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** Attributes whose value is a URL and therefore scheme-checked. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'poster', 'cite', 'data'])

export interface SandboxPolicy {
  /** Element names the guest may create. */
  elements: ReadonlySet<string>
  /** Property / attribute names refused everywhere. */
  blocked: ReadonlySet<string>
}

/**
 * Build the policy for one form.
 *
 * `narrow` is a plugin's own request to be trusted with less; it can only
 * intersect, never extend. A plugin asking for an element the host does not
 * offer gets the host's answer, which is no.
 */
export function createPolicy(narrow?: readonly string[]): SandboxPolicy {
  const full = new Set<string>([...DEFAULT_ELEMENTS, ...INFLOW_ELEMENTS])
  const elements = narrow?.length ? new Set([...narrow].filter((name) => full.has(name))) : full
  return { elements, blocked: new Set(BLOCKED_PROPERTIES) }
}

/** Whether the guest may create this element at all. */
export function allowsElement(policy: SandboxPolicy, name: unknown): name is string {
  return typeof name === 'string' && policy.elements.has(name)
}

/**
 * Whether a property or attribute may be set.
 *
 * `on*` is refused in addition to the blocklist: an `onclick` *string* would be
 * compiled by the browser into a handler running in the host's realm with the
 * host's privileges, which is precisely the escape this sandbox exists to deny.
 * Real listeners come through the event-listener channel instead.
 */
export function allowsProperty(policy: SandboxPolicy, name: unknown): name is string {
  if (typeof name !== 'string' || !name) return false
  if (policy.blocked.has(name)) return false
  if (/^on[a-z]/i.test(name)) return false
  return true
}

/**
 * A URL-valued attribute → the value to actually set, or `undefined` to drop it.
 *
 * Relative URLs are resolved against the host document only to *test* them; the
 * original string is what gets set, so a relative link keeps behaving like a
 * relative link. `javascript:` and `data:` are the two that matter —
 * `javascript:` executes in the host realm, and `data:` on a navigable element
 * creates a document that inherits nothing but is still a navigation.
 *
 * `data:image/*` is the one exception, because an inline image is how a guest
 * ships an icon without a network round trip and it cannot execute.
 */
export function sanitizeUrl(name: string, value: string): string | undefined {
  if (!URL_ATTRIBUTES.has(name)) return value

  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,/i.test(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed, document.baseURI)
  } catch {
    return undefined
  }
  return SAFE_SCHEMES.has(url.protocol) ? trimmed : undefined
}

/**
 * An inline `style` string → the one that may be applied.
 *
 * A guest already has network access inside its Worker, so a `url()` that
 * fetches is not a new capability and is left alone. What is removed is the
 * handful of legacy constructs that turn CSS back into script in the host's
 * realm.
 */
export function sanitizeStyle(value: string): string {
  return value.replace(/(javascript|vbscript)\s*:/gi, '').replace(/(expression|behavior|-moz-binding)\s*\(/gi, '')
}

/**
 * Whether a property *value* is safe to hand to a UI framework.
 *
 * Mirrors Remote DOM's own `assertSafeRemoteProperty` reasoning: frameworks
 * identify their virtual nodes by shape, so an object whose prototype is `null`
 * can be mistaken for one and smuggle markup past every name-based check above.
 * No legitimate data has that shape. Checked recursively, with a depth bound so
 * a cyclic or deeply nested value cannot stall the drawer.
 */
export function isSafeValue(value: unknown, depth = 0): boolean {
  if (depth > 10) return false
  if (value === null || typeof value !== 'object') return true
  if (Object.getPrototypeOf(value) === null) return false
  if (Array.isArray(value)) return value.every((entry) => isSafeValue(entry, depth + 1))
  if (Object.getPrototypeOf(value) !== Object.prototype) return false
  return Object.entries(value).every(
    ([key, entry]) => key !== '__proto__' && isSafeValue(entry, depth + 1),
  )
}
