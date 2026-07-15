import type { JsonSchema, UISchemaElement } from '@jsonforms/core'

/**
 * Context passed to every Inflow UI action.
 */
export interface InflowActionContext {
  /** Current form data scoped to the renderer's path */
  data: any
  /** JSON Schema for the current scope */
  schema: JsonSchema
  /** UI Schema element being rendered */
  uischema: UISchemaElement
  /** JSON Forms path */
  path: string
  /** Update form data with a patch object keyed by JSON Paths */
  updateData: (patch: Record<string, any>) => void
  /** Update the JSON Schema (optional, not yet fully implemented) */
  updateSchema?: (schema: JsonSchema) => void
  /** Update the UI Schema (optional, not yet fully implemented) */
  updateUiSchema?: (uiSchema: UISchemaElement) => void
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
  /** Name of the action to resolve from the registry */
  name: string
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
  /** Icon identifier (theme-specific rendering) */
  icon?: string
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
