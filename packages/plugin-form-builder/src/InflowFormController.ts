import { ref, type InjectionKey, type Ref } from 'vue'
import type { JsonSchema, UISchemaElement } from '@jsonforms/core'
import type {
  InflowFormEnvelope,
  InflowHostContext,
  InflowNotification,
  InflowNotificationEvent,
  InflowNotificationOrigin,
} from './types'
import { normalizeFormEnvelope } from './formEnvelope'
import { buildNotification } from './notifications'

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
  /**
   * The messages currently live on this form — everything raised by a schema's
   * `x-inflow-notif`, by an action, or by the host, that the host's own listener
   * did not claim. Keyed by field and id, so a channel replaces rather than
   * accumulates.
   */
  notifications: Ref<InflowNotificationEvent[]>
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
  /**
   * Raise a message, offer it to the host, and keep it if the host did not take
   * it. Returns the normalised event, or `null` when the message was empty (a
   * clear) or the host claimed it.
   */
  notify: (
    notification: InflowNotification | string,
    origin?: InflowNotificationOrigin,
  ) => InflowNotificationEvent | null
  /** Drop one message by its key. */
  dismiss: (key: string) => void
  /** Drop one field's messages, or every message when given no field. */
  clearNotifications: (field?: string) => void
  /**
   * Declare that a rendered control is showing this path's messages, so the
   * form-level list can leave them to it. Released on unmount — a field that
   * stops being rendered (a re-rendered schema dropped it) must not take its
   * messages off screen with it.
   */
  claimField: (path: string) => void
  releaseField: (path: string) => void
  isFieldClaimed: (path: string) => boolean
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
  /**
   * Called for every message raised, before the host is offered it and whatever
   * the host decides. Purely an observer — `<InflowForm>` uses it to emit
   * `@notify`, so a template-side host can watch the traffic without taking
   * responsibility for showing any of it.
   */
  observe?: (event: InflowNotificationEvent) => void
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
  const notifications = ref<InflowNotificationEvent[]>([])
  const host = ref<InflowHostContext>(init.host ?? {})

  function setForm(envelope: InflowFormEnvelope): void {
    const next = normalizeFormEnvelope(envelope)
    if (next.schema) schema.value = next.schema
    if (next.uischema) uischema.value = next.uischema
    if (next.hasData) data.value = next.data
  }

  // ---- Messages -------------------------------------------------------------

  function dismiss(key: string): void {
    notifications.value = notifications.value.filter((entry) => entry.key !== key)
  }

  function clearNotifications(field?: string): void {
    if (field === undefined) {
      notifications.value = []
      return
    }
    notifications.value = notifications.value.filter((entry) => entry.field !== field)
  }

  function notify(
    input: InflowNotification | string,
    origin: InflowNotificationOrigin = {},
  ): InflowNotificationEvent | null {
    const event = buildNotification(input, origin)

    // An empty message is a clear, not a blank line on the form. It is how a
    // plugin retracts a verification result whose field has since changed.
    if (!event.message) {
      dismiss(event.key)
      return null
    }

    try {
      init.observe?.(event)
    } catch {
      // An observer is a bystander. Its failure must not stop the message from
      // reaching the host or the field.
    }

    // The host is offered every message, whatever its `display` asked for —
    // deciding what this platform can actually show is exactly the listener's
    // job, and a host that raises errors as toasts but leaves help inline can
    // only do that if it sees both.
    let claimed = false
    const listener = host.value.onNotify
    if (listener) {
      try {
        claimed = listener(event) === true
      } catch {
        // A listener that throws has not shown anything. Fall through and render
        // it inline rather than lose the message to the host's own bug.
        claimed = false
      }
    }

    if (claimed) {
      // The host owns it now. Drop any inline copy left by an earlier message on
      // the same channel, or the field would show a stale answer beside a fresh
      // toast.
      dismiss(event.key)
      return null
    }

    notifications.value = [...notifications.value.filter((entry) => entry.key !== event.key), event]

    if (typeof event.timeout === 'number' && event.timeout > 0) {
      setTimeout(() => {
        // By identity, not by key: a message that replaced this one on the same
        // channel must outlive its predecessor's timer.
        notifications.value = notifications.value.filter((entry) => entry !== event)
      }, event.timeout)
    }

    return event
  }

  // ---- Which fields are showing their own messages ---------------------------

  const claimedFields = ref(new Set<string>())

  function claimField(path: string): void {
    if (path) claimedFields.value.add(path)
  }

  function releaseField(path: string): void {
    if (path) claimedFields.value.delete(path)
  }

  function isFieldClaimed(path: string): boolean {
    return claimedFields.value.has(path)
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

  return {
    schema,
    uischema,
    data,
    busy,
    status,
    error,
    notifications,
    host,
    setForm,
    runBusy,
    notify,
    dismiss,
    clearNotifications,
    claimField,
    releaseField,
    isFieldClaimed,
  }
}
