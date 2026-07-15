import type { InjectionKey } from 'vue'
import type { InflowAction } from './types'

/**
 * Registry of named Inflow UI actions.
 * Provided by the consuming application via the plugin.
 */
export type InflowActionRegistry = Record<string, InflowAction>

/**
 * Injection key for the action registry.
 * Use with Vue's provide/inject system.
 */
export const InflowActionRegistryKey: InjectionKey<InflowActionRegistry> = Symbol('inflow-action-registry')

/**
 * Create a typed action registry from a plain object.
 * @param actions - Map of action names to action functions
 */
export function createInflowActionRegistry(
  actions: Record<string, InflowAction>
): InflowActionRegistry {
  return { ...actions }
}

/**
 * Resolve an action by name from the registry.
 * @param registry - The action registry
 * @param name - Name of the action
 * @returns The action function, or undefined if not found
 */
export function resolveAction(
  registry: InflowActionRegistry,
  name: string
): InflowAction | undefined {
  return registry[name]
}
