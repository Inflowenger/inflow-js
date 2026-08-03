import type { UISchemaElement } from '@jsonforms/core'
import type {
  InflowNotification,
  InflowNotificationEvent,
  InflowNotificationOrigin,
} from './types'

/**
 * The UI schema key a field declares its message channel under, and the key a
 * meta function's answer raises one with.
 *
 * Deliberately one name for both. `x-inflow-ui` describes what a field can *do*;
 * this describes what can be *said* about it, and a plugin author who has learnt
 * the vocabulary once — severity, display, target field — writes it the same way
 * whether the message is baked into the schema (help) or arrives from a call
 * (a verification result, a failure). It sits beside `x-inflow-ui` rather than
 * inside it because a field that only ever has something to say never needs a
 * button, and requiring the behaviour extension to carry the message one would
 * make every help string pretend to be an action.
 *
 * As an answer key it is safe to reserve: JSON Schema property names in a form
 * are the plugin's own field names, and `x-inflow-notif` is not one — the same
 * reasoning that lets `settings` and `value` ride in the request body.
 */
export const NOTIF_KEY = 'x-inflow-notif'

/** Severity → the console channel used when there is nowhere else to report. */
const CONSOLE_CHANNEL = {
  error: 'error',
  warning: 'warn',
  success: 'info',
  info: 'info',
  help: 'info',
} as const

/**
 * What a field's channel declaration lends to the messages that arrive at it
 * later. Only presentation, never content or severity: a field that declares
 * itself a help line must not turn a later failure into help, but a field that
 * says "messages about me belong in a dialog" should have that honoured whoever
 * sends the next one.
 */
const INHERITED_KEYS = ['display', 'timeout', 'dismissible'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Read a UI schema element's `x-inflow-notif`, as a list.
 *
 * One object and an array of them are both accepted, because a field commonly
 * has exactly one thing to say and should not have to be written as a list to
 * say it — while a field that carries both a help line and a warning has
 * nowhere else to put the second.
 */
export function readNotifExtension(uischema: UISchemaElement | undefined): InflowNotification[] {
  const raw = (uischema as any)?.[NOTIF_KEY]
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.filter(isPlainObject) as InflowNotification[]
}

/**
 * Whether an element declares a channel at all. The renderers key off this the
 * same way they key off `x-inflow-ui`, so a field can opt into messages without
 * also opting into a button.
 */
export function hasNotifExtension(uischema: UISchemaElement | undefined): boolean {
  return readNotifExtension(uischema).length > 0
}

/**
 * The presentation a field's declaration lends to messages that arrive at it.
 *
 * Taken only from entries that carry no message — those are pure channel
 * declarations (`{"display": "dialog"}`), as opposed to the ones that *are* a
 * message (help text) and describe nothing but themselves.
 */
export function notifDefaults(uischema: UISchemaElement | undefined): InflowNotification {
  const defaults: InflowNotification = {}
  for (const entry of readNotifExtension(uischema)) {
    if (text(entry.message)) continue
    for (const key of INHERITED_KEYS) {
      if (entry[key] !== undefined) (defaults as any)[key] = entry[key]
    }
  }
  return defaults
}

/**
 * A notification's identity within one form: its field and its id.
 *
 * Identity is what makes a status channel a channel rather than a log. Press a
 * lookup button twice and the second answer replaces the first at that field
 * instead of stacking under it — which is the behaviour every plugin author
 * hand-rolls with a readonly `lookupStatus` property today. An explicit `id` is
 * for a field that needs more than one live message at once (a validity line and
 * a quota warning); without one every message about a field shares the channel.
 */
export function notificationKey(field: string | undefined, id: unknown): string {
  const name = text(id).trim()
  return `${field ?? ''}::${name || 'default'}`
}

/**
 * Normalise anything a plugin, an action or a schema offered into the one shape
 * that is stored, rendered and handed to a host listener.
 *
 * A bare string is accepted because `ctx.notify('Saved.')` is the call an action
 * author reaches for, and making them write `{ message: 'Saved.' }` buys
 * nothing.
 *
 * An empty message is not an error and not dropped here: it is how a channel is
 * *cleared* ("the value changed, the last verification no longer applies"), and
 * the caller needs the key to clear it by. See `InflowFormController.notify`.
 */
export function buildNotification(
  input: InflowNotification | string | null | undefined,
  origin: InflowNotificationOrigin = {},
): InflowNotificationEvent {
  const raw: InflowNotification =
    typeof input === 'string' ? { message: input } : isPlainObject(input) ? (input as InflowNotification) : {}

  const merged = { ...(origin.defaults ?? {}), ...raw }
  const field = text(merged.field).trim() || origin.field || undefined
  const severity = (merged.severity ?? 'info') as InflowNotificationEvent['severity']

  return {
    ...merged,
    key: notificationKey(field, merged.id),
    id: merged.id,
    field,
    severity,
    display: (merged.display ?? 'inline') as InflowNotificationEvent['display'],
    message: text(merged.message),
    title: text(merged.title) || undefined,
    source: origin.source ?? 'action',
    at: Date.now(),
  }
}

/**
 * Separate the notifications a meta function raised from the rest of its answer.
 *
 * Notifications ride *alongside* the answer rather than replacing it, because
 * the two are almost always sent together: a lookup that resolved a key patches
 * the key **and** says what it found. Stripping the key here is what lets the
 * remaining object stay a plain patch — otherwise every form would grow a field
 * called `x-inflow-notif`.
 */
export function splitNotifications(result: unknown): {
  notifications: InflowNotification[]
  rest: unknown
} {
  if (!isPlainObject(result) || !(NOTIF_KEY in result)) {
    return { notifications: [], rest: result }
  }

  const raw = result[NOTIF_KEY]
  const list = (Array.isArray(raw) ? raw : [raw]).filter(isPlainObject) as InflowNotification[]

  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result)) {
    if (key !== NOTIF_KEY) rest[key] = value
  }

  return { notifications: list, rest }
}

/**
 * The last resort, for a host with no form controller and no listener: say it on
 * the console rather than swallow it. A message nobody rendered is the same bug
 * as a button that does nothing, and this is the only channel left.
 */
export function reportToConsole(event: InflowNotificationEvent): void {
  if (!event.message) return
  const channel = CONSOLE_CHANNEL[event.severity] ?? 'info'
  const prefix = event.field ? `[Inflow UI] ${event.field}: ` : '[Inflow UI] '
  ;(console as any)[channel](`${prefix}${event.title ? `${event.title} — ` : ''}${event.message}`)
}
