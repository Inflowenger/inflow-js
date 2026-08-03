import { ref, type InjectionKey, type Ref } from 'vue'
import type { JsonSchema, UISchemaElement } from '@jsonforms/core'
import type { InflowFormEnvelope, InflowHostContext } from './types'
import { normalizeFormEnvelope } from './formEnvelope'

/**
 * The live state of one rendered form: which document it is currently showing,
 * and what the last action had to say about itself.
 *
 * It exists because JSON Forms' own core state is not a durable place to put a
 * new schema. `<JsonForms>` seeds its core from its props and re-seeds it
 * whenever `data`, `schema` or `uischema` change — so in a host that two-way
 * binds data (all of them do), a schema dispatched straight into the core is
 * reverted by the next keystroke, when the data prop round-trips and the core is
 * rebuilt from the *props*. Owning schema and UI schema out here, above
 * `<JsonForms>`, is what makes "the plugin sent a new form" stick.
 *
 * Created and provided by {@link InflowForm}. Actions reach it through the
 * context they are handed, so nothing outside this package needs to know it
 * exists.
 */
export interface InflowFormController {
  /** The schema currently rendered. Bound to `<JsonForms :schema>`. */
  schema: Ref<JsonSchema | undefined>
  /** The UI schema currently rendered. Bound to `<JsonForms :uischema>`. */
  uischema: Ref<UISchemaElement | undefined>
  /** The data currently rendered. Bound to `<JsonForms :data>`. */
  data: Ref<any>
  /** Whether any action is in flight — the form's status line reads this. */
  busy: Ref<boolean>
  /** What the last action reported, shown under the form. */
  status: Ref<string | null>
  /** What the last action failed with, shown under the form. */
  error: Ref<string | null>
  /** Which plugin the form belongs to, its settings, and how to call it. */
  host: Ref<InflowHostContext>
  /**
   * Replace part or all of the rendered document and re-render.
   *
   * Data is replaced, not merged: an envelope says "here is the form", and a new
   * schema is rarely compatible with the old data. Patch fields with the action
   * context's `updateData` instead.
   */
  setForm: (envelope: InflowFormEnvelope) => void
  /**
   * Run something with `busy` raised. Counted rather than a plain flag, so two
   * buttons in flight at once don't have the first to finish clear the second's
   * spinner.
   */
  runBusy: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * Injection key for the form controller.
 *
 * Optional by design: the renderers work without one — a host may use a bare
 * `<JsonForms>` — and fall back to dispatching into JSON Forms' core, which
 * re-renders correctly but does not survive the host re-seeding its props.
 */
export const InflowFormControllerKey: InjectionKey<InflowFormController> =
  Symbol('inflow-form-controller')

/**
 * Injection key for the host context, provided app-wide by the plugin and
 * per-form by {@link InflowForm}.
 */
export const InflowHostContextKey: InjectionKey<Ref<InflowHostContext>> =
  Symbol('inflow-host-context')

export interface InflowFormControllerInit {
  schema?: JsonSchema
  uischema?: UISchemaElement
  data?: any
  host?: InflowHostContext
}

/**
 * Build a controller over one form's live document.
 */
export function createInflowFormController(
  init: InflowFormControllerInit = {},
): InflowFormController {
  const schema = ref<JsonSchema | undefined>(init.schema)
  const uischema = ref<UISchemaElement | undefined>(init.uischema)
  const data = ref<any>(init.data)
  const busy = ref(false)
  const status = ref<string | null>(null)
  const error = ref<string | null>(null)
  const host = ref<InflowHostContext>(init.host ?? {})

  function setForm(envelope: InflowFormEnvelope): void {
    const next = normalizeFormEnvelope(envelope)
    if (next.schema) schema.value = next.schema
    if (next.uischema) uischema.value = next.uischema
    if (next.hasData) data.value = next.data
  }

  let inFlight = 0
  async function runBusy<T>(fn: () => Promise<T>): Promise<T> {
    inFlight += 1
    busy.value = true
    try {
      return await fn()
    } finally {
      inFlight -= 1
      if (inFlight <= 0) busy.value = false
    }
  }

  return { schema, uischema, data, busy, status, error, host, setForm, runBusy }
}
