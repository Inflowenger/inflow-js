import { ref, type App, type Plugin } from 'vue'
import type { InflowActionRegistry } from './InflowActionRegistry'
import type { InflowThemeConfig } from './InflowThemeConfig'
import type { InflowHostContext, InflowNotifyListener, InflowPluginCall } from './types'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowActionRegistryKey } from './InflowActionRegistry'
import { InflowHostContextKey } from './InflowFormController'
import { withBuiltinActions } from './actions'

export interface InflowUiPluginOptions {
  /**
   * Actions this app adds, on top of the built-ins. A name that collides with a
   * built-in replaces it — the defaults are a floor, not a lock.
   */
  actions?: InflowActionRegistry
  /** Theme configuration for CSS class overrides */
  theme?: InflowThemeConfig
  /**
   * How this app reaches a plugin's meta functions. Supplying it is all it takes
   * for `x-inflow-ui` buttons in any plugin's form to work, because the action
   * that uses it (`pluginFn`) ships built in.
   */
  call?: InflowPluginCall
  /**
   * How this app shows a message — a toast, a dialog, a desktop notification.
   *
   * Configured once here and every form's messages route through it. Return
   * `true` to claim one; anything else and it still appears inline at its field,
   * so a partial implementation (toasts for errors, nothing for the rest) is a
   * safe place to stop.
   */
  onNotify?: InflowNotifyListener
  /** Default plugin id, when an app renders forms for one plugin only. */
  pluginId?: string
  /** Default settings profile sent with plugin calls. */
  settings?: Record<string, unknown>
  /**
   * Set false to register nothing but `actions` — for a host that implements the
   * whole contract itself.
   */
  builtinActions?: boolean
}

/**
 * Vue plugin for Inflow UI.
 *
 * Registers the action registry, theme config and host context via Vue's
 * provide/inject system.
 *
 * Usage:
 * ```ts
 * import { createApp } from 'vue'
 * import { InflowUiPlugin, createInflowUi } from '@inflowenger/plugin-form-builder'
 *
 * const app = createApp(App)
 * app.use(InflowUiPlugin, createInflowUi({
 *   // The one thing a host has to supply: how to reach a plugin. `pluginFn` —
 *   // the action every plugin's UI schema names — is registered for you.
 *   call: ({ pluginId, fn, body }) => api.pluginFn(pluginId, fn, body),
 * }))
 * ```
 */
export const InflowUiPlugin: Plugin = {
  install(app: App, options: InflowUiPluginOptions = {}) {
    app.provide(InflowThemeConfigKey, options.theme || {})
    app.provide(
      InflowActionRegistryKey,
      withBuiltinActions(options.actions, options.builtinActions !== false),
    )
    app.provide(
      InflowHostContextKey,
      ref<InflowHostContext>({
        call: options.call,
        onNotify: options.onNotify,
        pluginId: options.pluginId,
        settings: options.settings,
      }),
    )
  }
}

/**
 * Helper to create Inflow UI plugin options.
 * Provides type safety and future extensibility.
 */
export function createInflowUi(options: InflowUiPluginOptions = {}): InflowUiPluginOptions {
  return {
    actions: options.actions || {},
    theme: options.theme || {},
    call: options.call,
    onNotify: options.onNotify,
    pluginId: options.pluginId,
    settings: options.settings,
    builtinActions: options.builtinActions,
  }
}
