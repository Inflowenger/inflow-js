import type { InflowActionRegistry } from '../InflowActionRegistry'
import { PLUGIN_FN, pluginFn } from './pluginFn'

export { PLUGIN_FN, pluginFn }

/**
 * The actions `x-inflow-ui` may name without the host registering anything.
 *
 * There is one, and one is the point: the platform contract says
 * `action.name` is always the literal `pluginFn`, so shipping it here is what
 * makes a plugin's form work in *any* host that renders it, rather than only in
 * the one host that happened to hand-write the bridge. Anything beyond it stays
 * the application's to define — a schema can still never reach a function the
 * app didn't provide.
 */
export const builtinActions: InflowActionRegistry = Object.freeze({
  [PLUGIN_FN]: pluginFn,
}) as InflowActionRegistry

/** The names above, for a host that wants to report or validate against them. */
export const builtinActionNames: readonly string[] = Object.freeze(Object.keys(builtinActions))

/**
 * Merge a host's actions over the built-ins.
 *
 * Host wins on a name collision, on purpose: the defaults are a floor, not a
 * lock. An app that needs `pluginFn` to authenticate differently, batch calls,
 * or apply answers its own way registers its own and this stops applying.
 */
export function withBuiltinActions(
  actions: InflowActionRegistry = {},
  includeBuiltins = true,
): InflowActionRegistry {
  return includeBuiltins ? { ...builtinActions, ...actions } : { ...actions }
}
