import { computed, inject, type ComputedRef } from 'vue'
import { useJsonForms, useDispatch } from '@jsonforms/vue'
import { setSchema, setUISchema, update, type JsonSchema, type UISchemaElement } from '@jsonforms/core'
import type {
  InflowActionConfig,
  InflowActionContext,
  InflowFormEnvelope,
  InflowHostContext,
  InflowNotification,
  InflowNotificationEvent,
} from './types'
import { applyActionResult, normalizeFormEnvelope } from './formEnvelope'
import { buildNotification, notifDefaults, reportToConsole } from './notifications'
import { InflowFormControllerKey, InflowHostContextKey } from './InflowFormController'

export interface InflowScope {
  /** The value at this renderer's path. */
  data: any
  /** The schema for this scope. */
  schema: JsonSchema
  /** The UI schema element carrying `x-inflow-ui`. */
  uischema: UISchemaElement
  /** The absolute data path this renderer sits at. */
  path: string
}

/**
 * Build the context every action is handed.
 *
 * One implementation for both renderers, because a control and a layout differ
 * only in how they read their own scope — everything an action can *do* is the
 * same, and it is all reached through JSON Forms' dispatch and the form
 * controller rather than through either composition's return value.
 *
 * Two levels of state are in play and the difference matters:
 *
 * - **Data** is dispatched straight into JSON Forms' core. That is the correct
 *   place for it: the core is the live document, and a host's `@change` handler
 *   is how the edit gets back out to the application.
 * - **Schema and UI schema** go to the form controller when there is one, and
 *   fall back to dispatch when there isn't. Dispatch alone re-renders correctly
 *   but does not last — `<JsonForms>` rebuilds its core from its props whenever
 *   `data` changes, which in a host that two-way binds data is the next
 *   keystroke. `<InflowForm>` owns those props, so a form sent by a plugin
 *   sticks. See {@link InflowFormController}.
 */
export function useInflowActionContext(
  scope: ComputedRef<InflowScope>,
): ComputedRef<InflowActionContext> {
  const jsonforms = useJsonForms()
  const dispatch = useDispatch()
  const controller = inject(InflowFormControllerKey, undefined)
  const pluginHost = inject(InflowHostContextKey, undefined)

  const host = computed<InflowHostContext>(() => ({
    ...(pluginHost?.value ?? {}),
    ...(controller?.host.value ?? {}),
  }))

  return computed<InflowActionContext>(() => {
    const current = scope.value
    const core = jsonforms.core

    const config: InflowActionConfig =
      (current.uischema as any)?.['x-inflow-ui']?.action ?? { name: '' }

    function updateData(patch: Record<string, any>): void {
      Object.entries(patch).forEach(([path, value]) => {
        dispatch(update(path, () => value))
      })
    }

    function updateSchema(next: JsonSchema): void {
      if (controller) controller.schema.value = next
      else dispatch(setSchema(next))
    }

    function updateUiSchema(next: UISchemaElement): void {
      if (controller) controller.uischema.value = next
      else dispatch(setUISchema(next))
    }

    function updateForm(envelope: InflowFormEnvelope): void {
      if (controller) {
        controller.setForm(envelope)
        return
      }
      // No controller: dispatch into the core directly. Schema first, so the
      // validator that data lands against is the new one.
      const next = normalizeFormEnvelope(envelope)
      if (next.schema) dispatch(setSchema(next.schema))
      if (next.uischema) dispatch(setUISchema(next.uischema))
      if (next.hasData) dispatch(update('', () => next.data))
    }

    /**
     * A message about the field this action drives.
     *
     * The origin is resolved here rather than by the caller because only the
     * renderer knows it: `action.target` when the button fills another field
     * (a search box that writes into the key field), and the control's own
     * `x-inflow-notif` for how that field wants its messages shown.
     *
     * Without a controller — a host on a bare `<JsonForms>` — there is nowhere
     * to render it, so it goes to the host's listener if there is one and to the
     * console if there isn't. Swallowing it is how a plugin's only explanation
     * of a failure disappears.
     */
    function notify(input: InflowNotification | string): InflowNotificationEvent | null {
      const origin = {
        field: config.target ?? current.path,
        defaults: notifDefaults(current.uischema),
        source: 'action' as const,
      }

      if (controller) return controller.notify(input, origin)

      const event = buildNotification(input, origin)
      if (!event.message) return null
      if (host.value.onNotify?.(event) === true) return null
      reportToConsole(event)
      return event
    }

    const ctx: InflowActionContext = {
      data: current.data,
      schema: current.schema,
      uischema: current.uischema,
      path: current.path,
      rootData: core?.data,
      rootSchema: (controller?.schema.value ?? core?.schema) as JsonSchema,
      rootUiSchema: (controller?.uischema.value ?? core?.uischema) as UISchemaElement,
      config,
      host: host.value,
      updateData,
      updateSchema,
      updateUiSchema,
      updateForm,
      applyResult: (result, options) => applyActionResult(ctx, result, options),
      setStatus: (message) => {
        if (controller) controller.status.value = message
      },
      setError: (message) => {
        // With a form there is somewhere to show it. Without one — a host using
        // a bare <JsonForms> — the console is the only channel left, and
        // swallowing it is how a button comes to "do nothing" with no trace.
        if (controller) controller.error.value = message
        else if (message) console.error(`[Inflow UI] ${message}`)
      },
      notify,
      clearNotifications: (field) => controller?.clearNotifications(field),
      refresh: async () => {
        // Vue reactivity handles updates automatically
      },
    }

    return ctx
  })
}
