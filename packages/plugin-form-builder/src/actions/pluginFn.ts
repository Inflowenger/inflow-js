import type { InflowAction, InflowActionContext } from '../types'

/**
 * The name every plugin writes in its UI schema.
 *
 * `x-inflow-ui.action.name` is the literal string `pluginFn` in every form the
 * Go SDK's documentation and skill teach an author to write, and the plugin
 * catalog's contract states it outright: "It is the only action the host
 * registers." Exported so a host, a test, or a schema generator can agree with
 * that by reference instead of by retyping the string.
 */
export const PLUGIN_FN = 'pluginFn'

/**
 * `pluginFn` — call one of the plugin's own meta functions and apply the answer
 * to the form.
 *
 * This is the bridge behind dependent fields: a plugin's form can consult the
 * live service while it is being filled in (turn a typed name into the id an API
 * needs, load the labels a project has, check a token) without the host shipping
 * a bespoke action per plugin. The plugin names the function; the host only
 * knows how to reach it.
 *
 * It ships built in because the alternative was every host re-deriving it —
 * and a host that hasn't renders a real plugin's form with buttons that are
 * silently inert, since an unregistered name resolves to nothing. The host now
 * supplies only the transport (`host.call`); the contract on both sides of it —
 * what the body looks like, how the answer is applied — lives here.
 *
 * **The request is flat.** Every field of the form at the top level, plus the
 * action's static `body`, plus `settings` and `value`. Not the `{_registry,
 * body}` envelope an action execution uses; the SDK docs are emphatic about this
 * because `CastRequestTo` silently yields a zero struct against the wrong one.
 *
 * **The answer is applied by shape** — see `applyActionResult`. Notably, a
 * plugin that answers with a whole form (schema + UI schema, optionally data)
 * gets the form re-rendered as that document, which is how a call can change a
 * field's options rather than only its value.
 *
 * A host that wants different behaviour registers its own `pluginFn`; a name in
 * the registry always wins over the built-in.
 */
export const pluginFn: InflowAction = async (ctx: InflowActionContext) => {
  const fn = typeof ctx.config.fn === 'string' ? ctx.config.fn.trim() : ''

  ctx.setError(null)
  ctx.setStatus(null)

  if (!fn) {
    ctx.setError('This form asked for a plugin call but named no function.')
    return
  }
  if (!ctx.host.call) {
    ctx.setError(
      `Cannot run "${fn}" — this app has not configured how to reach a plugin. ` +
        'Pass `call` to createInflowUi() or to <InflowForm>.',
    )
    return
  }
  if (!ctx.host.pluginId) {
    ctx.setError(`Cannot run "${fn}" — this form is not bound to a running plugin.`)
    return
  }

  const body: Record<string, unknown> = {
    // The form as it currently stands. A meta function is told everything the
    // user has filled in, because what it can answer usually depends on a field
    // above the one the button sits on (assignable users are per-project).
    ...(ctx.rootData && typeof ctx.rootData === 'object' ? ctx.rootData : {}),
    ...(ctx.config.body ?? {}),
    // Credentials and endpoint. A meta function is as stateless as an action and
    // reads its connection from here, and only from here.
    settings: ctx.host.settings ?? {},
    // The value of the control the button sits on, so a lookup can key off the
    // current selection without re-deriving it from the path.
    value: ctx.data,
  }

  try {
    const result = await ctx.host.call({ pluginId: ctx.host.pluginId, fn, body })
    ctx.applyResult(result)
  } catch (err) {
    ctx.setError(`${fn}: ${(err as Error).message}`)
  }
}
