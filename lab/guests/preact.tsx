/**
 * A Preact guest — the React-shaped case.
 *
 * Preact rather than React only because it is a tenth the size; the mechanism is
 * identical and `preact/compat` makes React itself work the same way. What is
 * worth noticing is that the framework needed no adapter: Preact's renderer
 * calls `document.createElement`, `appendChild` and `addEventListener`, and the
 * polyfill answers all three. Shopify's own `@remote-dom/preact` package exists
 * to do better than this — it maps components to remote elements directly,
 * skipping the DOM imitation — but the plain path works, which is the point for
 * a plugin author who just wants to ship what they already have.
 */
import { render } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { GuestContext } from '@inflowenger/plugin-sandbox/guest'

function Dialog({ ctx }: { ctx: GuestContext }) {
  const [query, setQuery] = useState(String((ctx.data as any)?.query ?? ''))
  const [status, setStatus] = useState('')
  const [dark, setDark] = useState(ctx.theme.dark)

  useEffect(() => ctx.onTheme((theme) => setDark(theme.dark)), [ctx])
  useEffect(() => ctx.onData((next) => setQuery(String((next as any)?.query ?? ''))), [ctx])

  const run = useCallback(async () => {
    setStatus('running…')
    try {
      const result: any = await ctx.call('query.explain', { query })
      setStatus(result?.plan ?? 'no plan returned')
    } catch (error) {
      setStatus(String(error))
      ctx.notify({ severity: 'error', message: String(error), field: 'query' })
    }
  }, [ctx, query])

  return (
    <div class="if-vstack">
      <p class="if-desc">
        Preact, compiled to JavaScript, rendering through a Worker. The classes below are the
        host's — the guest never saw a stylesheet.
      </p>

      <label class="if-control">
        <span class="if-label">Query</span>
        <textarea
          class="if-input"
          rows={3}
          value={query}
          onInput={(event: any) => {
            const next = event?.target?.value ?? ''
            setQuery(next)
            ctx.patchData({ query: next })
          }}
        />
      </label>

      <div class="if-hstack">
        <button class="if-btn" type="button" onClick={run}>
          Explain
        </button>
        <span class="if-desc">{dark ? 'dark' : 'light'} theme, inherited</span>
      </div>

      {status ? <pre class="if-code">{status}</pre> : null}
    </div>
  )
}

export default function mount(ctx: GuestContext) {
  render(<Dialog ctx={ctx} />, ctx.root as unknown as Element)
  return () => render(null, ctx.root as unknown as Element)
}
