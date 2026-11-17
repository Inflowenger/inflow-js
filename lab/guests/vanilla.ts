/**
 * A guest with no framework at all.
 *
 * The smallest honest demonstration of the contract: build nodes, listen for
 * events, write back to the form, call the plugin. Everything a plugin author
 * has to know fits on this page.
 *
 * Note what is *not* here — no stylesheet, no theme variables read into
 * JavaScript, no class names invented for this dialog. It uses the host's own
 * utility classes and token names directly, because under the `remote` renderer
 * these nodes end up in the host's document and the host's CSS applies to them.
 * That is the claim this file exists to test.
 */
import type { GuestContext } from '@inflowenger/plugin-sandbox/guest'

export default function mount(ctx: GuestContext) {
  const d = ctx.document
  const data = () => (ctx.data ?? {}) as Record<string, unknown>

  const wrap = d.createElement('div')
  wrap.className = 'if-vstack'

  const title = d.createElement('p')
  title.className = 'if-desc'
  title.textContent = 'Rendered by the plugin, in a sandbox. No host code knows what this dialog contains.'
  wrap.append(title)

  // ---- a field that writes into the form -----------------------------------
  const field = d.createElement('label')
  field.className = 'if-control'

  const label = d.createElement('span')
  label.className = 'if-label'
  label.textContent = 'Collection'
  field.append(label)

  const input = d.createElement('input')
  input.className = 'if-input'
  input.setAttribute('type', 'text')
  input.setAttribute('placeholder', 'e.g. invoices')
  input.setAttribute('value', String(data().collection ?? ''))
  input.addEventListener('input', (event: any) => {
    // The event is a described copy, not a live DOM event — see describeEvent
    // in the host's remoteTree. The one field that matters survives the trip.
    ctx.patchData({ collection: event?.target?.value ?? '' })
  })
  field.append(input)
  wrap.append(field)

  // ---- a button that calls the plugin --------------------------------------
  const row = d.createElement('div')
  row.className = 'if-hstack'

  const button = d.createElement('button')
  button.className = 'if-btn'
  button.setAttribute('type', 'button')
  button.textContent = 'Test connection'
  button.addEventListener('click', async () => {
    button.setAttribute('disabled', 'true')
    button.textContent = 'Testing…'
    try {
      const result: any = await ctx.call('db.ping', { collection: data().collection })
      ctx.notify({ severity: 'success', message: `Reachable in ${result?.ms ?? '?'}ms`, field: 'collection' })
    } catch (error) {
      ctx.notify({ severity: 'error', message: String(error), field: 'collection' })
    } finally {
      button.removeAttribute('disabled')
      button.textContent = 'Test connection'
    }
  })
  row.append(button)
  wrap.append(row)

  // ---- proof that host-side data changes arrive ----------------------------
  const echo = d.createElement('pre')
  echo.className = 'if-code'
  echo.textContent = JSON.stringify(ctx.data, null, 2)
  wrap.append(echo)

  const offData = ctx.onData((next) => {
    echo.textContent = JSON.stringify(next, null, 2)
    const value = String((next as any)?.collection ?? '')
    if (input.getAttribute('value') !== value) input.setAttribute('value', value)
  })

  // ---- proof that the theme is live ---------------------------------------
  const themeLine = d.createElement('p')
  themeLine.className = 'if-desc'
  const describeTheme = (t: typeof ctx.theme) =>
    `host theme: ${t.dark ? 'dark' : 'light'} · --accent is ${t.tokens['--accent'] ?? 'unset'}`
  themeLine.textContent = describeTheme(ctx.theme)
  const offTheme = ctx.onTheme((theme) => {
    themeLine.textContent = describeTheme(theme)
  })
  wrap.append(themeLine)

  ctx.root.append(wrap)

  return () => {
    offData()
    offTheme()
  }
}
