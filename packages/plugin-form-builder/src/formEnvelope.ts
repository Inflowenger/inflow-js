import type { JsonSchema, UISchemaElement } from '@jsonforms/core'
import type {
  InflowActionContext,
  InflowFormEnvelope,
  NormalizedFormEnvelope,
} from './types'

/**
 * The keys a form envelope is allowed to consist of.
 *
 * An action's answer is applied by shape, and the two shapes an object can have
 * are "a patch of fields" and "a whole new form". Telling them apart has to be
 * conservative in one direction: a form that genuinely has a field called
 * `schema` must not be mistaken for a re-render, because that would silently
 * discard the user's data. So an object counts as an envelope only when *every*
 * key it has is one of these — a patch that happens to mention `schema` also
 * mentions `projectKey`, and falls back to being a patch.
 */
const ENVELOPE_KEYS = new Set([
  'schema',
  'jsonschema',
  'uischema',
  'uiSchema',
  'jsonui',
  'data',
  'submit_to',
  'submitTo',
])

/** The keys that actually carry a schema. An envelope needs at least one. */
const SCHEMA_KEYS = ['schema', 'jsonschema', 'uischema', 'uiSchema', 'jsonui']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The Go SDK's `FormBuilder` carries its schemas as JSON *text*, so a plugin
 * that answers with its own form hands back strings where JSON Forms wants
 * objects. Parse tolerantly: anything that does not parse is left alone and
 * simply won't be applied, rather than throwing inside a button handler.
 */
function parseMaybeJson<T>(value: T | string | undefined): T | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether an action's answer is a whole form rather than a patch of fields.
 *
 * True only for an object that carries at least one schema and *nothing but*
 * envelope keys — see the note on ENVELOPE_KEYS for why the test is that strict.
 */
export function isFormEnvelope(value: unknown): value is InflowFormEnvelope {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  if (!keys.every((key) => ENVELOPE_KEYS.has(key))) return false
  return SCHEMA_KEYS.some((key) => value[key] !== undefined && value[key] !== null)
}

/**
 * Resolve an envelope's aliases and parse any JSON text into the one shape the
 * renderer applies.
 *
 * `hasData` is carried separately because `data: null` and a missing `data` mean
 * different things — the first clears the form, the second leaves it alone.
 */
export function normalizeFormEnvelope(envelope: InflowFormEnvelope): NormalizedFormEnvelope {
  const schema = parseMaybeJson<JsonSchema>(envelope.schema ?? envelope.jsonschema)
  const uischema = parseMaybeJson<UISchemaElement>(
    envelope.uischema ?? envelope.uiSchema ?? envelope.jsonui,
  )
  const hasData = Object.prototype.hasOwnProperty.call(envelope, 'data')

  return { schema, uischema, data: envelope.data, hasData }
}

/**
 * A meta function's answer → the data patch that applies it.
 *
 * Objects are patches keyed by absolute data path; anything else (an array, a
 * string, a number) is a single value for one field.
 */
export function patchFor(result: unknown, target: string): Record<string, unknown> {
  if (isPlainObject(result)) return result
  return target ? { [target]: result } : {}
}

/**
 * The default handling of an action's answer — the behaviour every action gets
 * unless it opts out by not calling this.
 *
 * Three shapes, in order:
 *
 * 1. A **form envelope** (schema and/or UI schema, optionally with data) replaces
 *    the form and re-renders it. This is how a plugin drives the form forward:
 *    answer a call with the next form and the user sees it, no host code
 *    involved. It is also the only way to change a `<select>`'s options at
 *    runtime, since options live in the schema, not the data.
 * 2. Any other **object** is a data patch: every key is an absolute leaf data
 *    path, every value is written there.
 * 3. **Anything else** is written whole to `target`, defaulting to the path of
 *    the control the button sits on.
 *
 * `null` and `undefined` are no-ops: a meta function with nothing to say (having
 * already written a status field, say) should not clear the field it was fired
 * from.
 */
export function applyActionResult(
  ctx: InflowActionContext,
  result: unknown,
  options: { target?: string } = {},
): void {
  if (result === null || result === undefined) return

  if (isFormEnvelope(result)) {
    ctx.updateForm(result)
    return
  }

  const target = options.target ?? ctx.config.target ?? ctx.path
  ctx.updateData(patchFor(result, target))
}
