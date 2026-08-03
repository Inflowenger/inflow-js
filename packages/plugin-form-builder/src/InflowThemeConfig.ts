import type { InjectionKey } from 'vue'

/**
 * Theme configuration for Inflow UI.
 * Allows consuming applications to override CSS classes
 * without depending on any specific design system.
 */
export interface InflowThemeConfig {
  /** Class applied to the outer container of Inflow renderers */
  containerClass?: string
  /** Class applied to buttons that have a text label */
  buttonClass?: string
  /** Class applied to icon-only buttons */
  iconButtonClass?: string
  /**
   * Class applied to every rendered notification, alongside `.inflow-notif` and
   * its severity modifier. One class for all severities: which of them looks
   * like a warning is your design system's business, and `.inflow-notif-error`
   * &c. are there to hang that off.
   */
  notifClass?: string
}

/**
 * Injection key for InflowThemeConfig.
 * Use with Vue's provide/inject system.
 */
export const InflowThemeConfigKey: InjectionKey<InflowThemeConfig> = Symbol('inflow-theme-config')
