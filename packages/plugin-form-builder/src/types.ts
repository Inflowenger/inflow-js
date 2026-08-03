import type { JsonSchema, UISchemaElement } from '@jsonforms/core'

/**
 * A whole form as a document — schema, UI schema, and the data to fill it with.
 *
 * This is what a plugin serves for an action, and it is also what a form action
 * may answer with in order to *replace* the form it was fired from. The Go SDK
 * spells the two schemas `jsonschema` / `jsonui` (`sdkv1.FormBuilder`) and ships
 * them as JSON *text*; JSON Forms spells them `schema` / `uischema` and wants
 * objects. Every spelling is accepted, and strings are parsed, so a plugin can
 * hand its own `FormBuilder` back verbatim and it renders.
 *
 * @see normalizeFormEnvelope
 */
export interface InflowFormEnvelope {
  /** JSON Schema, as an object or as JSON text. */
  schema?: JsonSchema | string
  /** Go SDK spelling of `schema`. */
  jsonschema?: JsonSchema | string
  /** UI Schema, as an object or as JSON text. */
  uischema?: UISchemaElement | string
  /** Alternate casing of `uischema`. */
  uiSchema?: UISchemaElement | string
  /** Go SDK spelling of `uischema`. */
  jsonui?: UISchemaElement | string
  /** The form's data. Replaces the current data wholesale — see updateData for patches. */
  data?: any
  /** Carried by `sdkv1.FormBuilder`; recognised so a verbatim FormBuilder is still an envelope. */
  submit_to?: string
  /** Alternate casing of `submit_to`. */
  submitTo?: string
}

/** An envelope after parsing and alias resolution: what the renderer applies. */
export interface NormalizedFormEnvelope {
  schema?: JsonSchema
  uischema?: UISchemaElement
  data?: any
  hasData: boolean
}

/**
 * Where the form is being rendered, from an action's point of view: which plugin
 * it belongs to, the settings profile bound to it, and how to reach the plugin.
 *
 * Provided by the host — app-wide through the plugin, per-form through
 * `<InflowForm>` — so a built-in action can be written once, inside this package,
 * instead of re-derived by every host that renders a plugin's form.
 */
export interface InflowHostContext {
  /** The inflowv1 plugin the form came from. Absent when a form is previewed standalone. */
  pluginId?: string
  /** The settings profile (credentials, endpoint) sent with every plugin call. */
  settings?: Record<string, unknown>
  /** Transport to the plugin's meta functions. Without it, `pluginFn` reports rather than fails silently. */
  call?: InflowPluginCall
}

/** One call to a plugin meta function, as the built-in `pluginFn` action makes it. */
export interface InflowPluginCallRequest {
  /** The plugin to reach — `InflowHostContext.pluginId`. */
  pluginId: string
  /** The meta method name, exactly as passed to the SDK's `AddMeta`. */
  fn: string
  /**
   * The request body, already flat as the contract requires: every field of the
   * form, plus the action's static `body`, plus `settings` and `value`.
   */
  body: Record<string, unknown>
}

/**
 * How this host reaches a plugin's meta functions. The only thing a host has to
 * supply for dependent fields to work; everything else about the contract —
 * what goes in the body, how the answer is applied — lives in this package.
 *
 * Resolves to whatever the meta function returned, unparsed by shape.
 */
export type InflowPluginCall = (request: InflowPluginCallRequest) => Promise<unknown>

/**
 * Context passed to every Inflow UI action.
 */
export interface InflowActionContext {
  /** Current form data scoped to the renderer's path — the field the button sits on. */
  data: any
  /** JSON Schema for the current scope */
  schema: JsonSchema
  /** UI Schema element being rendered */
  uischema: UISchemaElement
  /** JSON Forms path */
  path: string
  /** The whole form's data, not just this scope. What a plugin call sends as its body. */
  rootData: any
  /** The whole form's JSON Schema. */
  rootSchema: JsonSchema
  /** The whole form's UI Schema. */
  rootUiSchema: UISchemaElement
  /** This button's `x-inflow-ui.action` config, already resolved. */
  config: InflowActionConfig
  /** Which plugin this form belongs to, its settings profile, and how to call it. */
  host: InflowHostContext
  /** Update form data with a patch object keyed by absolute leaf data paths. */
  updateData: (patch: Record<string, any>) => void
  /** Replace the JSON Schema and re-render. */
  updateSchema: (schema: JsonSchema) => void
  /** Replace the UI Schema and re-render. */
  updateUiSchema: (uiSchema: UISchemaElement) => void
  /** Replace the whole form — schema, UI schema and data — and re-render. */
  updateForm: (envelope: InflowFormEnvelope) => void
  /**
   * The default handling of an action's answer, applied by shape: a form
   * envelope re-renders the form, any other object is a data patch, and anything
   * else is written to `target` (defaulting to the control the button sits on).
   *
   * Call it to keep the standard behaviour inside a custom action; skip it and
   * use `updateData` / `updateForm` directly to handle the answer yourself.
   */
  applyResult: (result: unknown, options?: { target?: string }) => void
  /** Report progress or a result to the user. The only channel an action has — the contract is void. */
  setStatus: (message: string | null) => void
  /** Report a failure to the user. */
  setError: (message: string | null) => void
  /** Refresh the form (optional, reactive by default in Vue) */
  refresh?: () => Promise<void>
}

/**
 * An Inflow UI action function.
 */
export type InflowAction = (ctx: InflowActionContext) => void | Promise<void>

/**
 * Configuration for an action inside x-inflow-ui.
 */
export interface InflowActionConfig {
  /** Name of the action to resolve from the registry. `pluginFn` for a plugin call. */
  name: string
  /** For `pluginFn`: the plugin meta method to call, as passed to the SDK's `AddMeta`. */
  fn?: string
  /** Data path a non-object answer is written to. Defaults to the button's own control. */
  target?: string
  /** Static object merged into the request body — tells one shared meta function which caller it serves. */
  body?: Record<string, unknown>
  /** Future: parameters, debounce, etc. */
  [key: string]: any
}

/**
 * Configuration for a button inside x-inflow-ui.
 */
export interface InflowButtonConfig {
  /** Position relative to the original renderer */
  position?: 'append' | 'prepend' | 'above' | 'below'
  /** Button label text */
  label?: string
  /** Icon identifier, rendered as literal text rather than looked up in an icon font */
  icon?: string
  /** Label shown while the action is running. Defaults to the button's own label. */
  busyLabel?: string
  /** Future: variant, size, disabled, etc. */
  [key: string]: any
}

/**
 * The x-inflow-ui extension object.
 */
export interface InflowUiExtension {
  /** Action to execute on trigger */
  action?: InflowActionConfig
  /** Button configuration */
  button?: InflowButtonConfig
  /** Future: badge, chip, tooltip, lookup, help */
  [key: string]: any
}

/**
 * UI Schema element that may contain x-inflow-ui.
 */
export type InflowUiSchemaElement = UISchemaElement & {
  'x-inflow-ui'?: InflowUiExtension
}
