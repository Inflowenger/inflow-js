import type { App, Plugin } from 'vue'
import type { InflowActionRegistry } from './InflowActionRegistry'
import type { InflowThemeConfig } from './InflowThemeConfig'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowActionRegistryKey } from './InflowActionRegistry'

export interface InflowUiPluginOptions {
  /** Action registry mapping names to action functions */
  actions?: InflowActionRegistry
  /** Theme configuration for CSS class overrides */
  theme?: InflowThemeConfig
}

/**
 * Vue plugin for Inflow UI.
 *
 * Registers the action registry and theme config via Vue's provide/inject system.
 *
 * Usage:
 * ```ts
 * import { createApp } from 'vue'
 * import { InflowUiPlugin, createInflowUi } from './inflow-ui/InflowUiPlugin'
 *
 * const app = createApp(App)
 * app.use(InflowUiPlugin, createInflowUi({
 *   actions: { loadMembers, validateAccount }
 * }))
 * ```
 */
export const InflowUiPlugin: Plugin = {
  install(app: App, options: InflowUiPluginOptions = {}) {
    app.provide(InflowThemeConfigKey, options.theme || {})
    app.provide(InflowActionRegistryKey, options.actions || {})
  }
}

/**
 * Helper to create Inflow UI plugin options.
 * Provides type safety and future extensibility.
 */
export function createInflowUi(options: InflowUiPluginOptions = {}): InflowUiPluginOptions {
  return {
    actions: options.actions || {},
    theme: options.theme || {}
  }
}

// Re-export everything for a single import point
export * from './types'
export * from './InflowThemeConfig'
export * from './InflowActionRegistry'
export * from './inflowTester'
export { default as InflowControlRenderer } from './InflowControlRenderer.vue'
export { default as InflowLayoutRenderer } from './InflowLayoutRenderer.vue'
export { default as InflowActionButton } from './InflowActionButton.vue'
