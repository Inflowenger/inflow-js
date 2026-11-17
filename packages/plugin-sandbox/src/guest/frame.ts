/**
 * The `iframe` renderer's guest, running in a null-origin sandboxed frame.
 *
 * This is the escape hatch, and it earns its place honestly: the guest gets a
 * *real* document. Canvas, WebGL, `getBoundingClientRect`, a third-party widget
 * that reaches for `window.top` and copes when it cannot, a charting library
 * that measures text — all of it works here and none of it works in a Worker,
 * whose DOM is an imitation that never lays anything out.
 *
 * The cost is everything this file does by hand that the Worker renderer gets
 * for nothing: the host's theme is injected as CSS and re-injected on every
 * change, and the content's height is measured and reported back so the host can
 * size a box that has no idea what is in it. None of it is hard. All of it is a
 * seam that drifts.
 *
 * The isolation is real but differently shaped. `sandbox="allow-scripts"`
 * without `allow-same-origin` puts the frame on an opaque origin: no cookies, no
 * storage, no same-origin fetch to the host, no reaching into `parent`. What it
 * *can* still do is lay out pixels, which is why its popovers stop at the frame
 * edge and a `<select>` opened near the bottom of a drawer is clipped.
 */

import { ThreadMessagePort } from '@quilted/threads'
import type { GuestMountOptions, SandboxGuestApi, SandboxHostApi } from '../bridge'
import type { ThemeSnapshot } from '../theme'
import { createGuestRuntime } from './runtime'

/**
 * The handshake.
 *
 * A null-origin frame cannot be addressed by origin and cannot address its
 * parent by one either — `postMessage` to or from it must use `'*'`, which
 * authenticates nobody. So the `'*'` window channel is used for exactly one
 * message, carrying a `MessagePort`; everything afterwards goes down that port,
 * which is a private capability no third party can obtain by guessing an origin.
 *
 * The guest announces itself rather than waiting to be addressed, because the
 * host cannot otherwise know when this script has run.
 */
let host!: SandboxHostApi

const themeStyle = document.createElement('style')
themeStyle.id = 'inflow-theme'
document.head.append(themeStyle)

const mount = document.createElement('div')
mount.className = 'inflow-sandbox-root'

let observer: ResizeObserver | undefined

function reportHeight() {
  // Measured on the body rather than the mount so a guest that positions
  // something absolutely is still counted.
  const height = Math.ceil(Math.max(document.body.scrollHeight, mount.scrollHeight))
  if (height > 0) host?.setHeight(height)
}

/** Re-injection on theme change is this renderer's recurring tax. The remote
 *  renderer has no equivalent of this function because it needs none. */
function applyTheme(theme: ThemeSnapshot) {
  const declarations = Object.entries(theme.tokens)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n  ')

  themeStyle.textContent = [
    `:root {\n  ${declarations}\n  color-scheme: ${theme.colorScheme};\n}`,
    `html, body { margin: 0; padding: 0; background: transparent; color: ${theme.color};`,
    `  font-family: ${theme.font.family}; font-size: ${theme.font.size}; line-height: ${theme.font.lineHeight}; }`,
    `.inflow-sandbox-root { color: inherit; font: inherit; }`,
  ].join('\n')
}

/**
 * Copy the host's stylesheets in.
 *
 * Everything the `remote` renderer gets for free has to be done by hand here,
 * and this is the bulk of it. Same-origin sheets arrive as text and are written
 * into a `<style>`; cross-origin ones could not be read by the host, so their
 * URLs are passed through for the frame to fetch itself — which works because a
 * sandboxed frame may still load subresources, it just cannot reach back into
 * the page.
 *
 * The seams are real and worth naming: a stylesheet added to the host after
 * this ran is not here, a `@font-face` with a relative URL no longer resolves
 * from an opaque origin, and a sheet behind a CDN that stops sending CORS
 * headers silently stops arriving.
 */
function applyStyles(styles: GuestMountOptions['styles']) {
  if (!styles) return

  for (const href of styles.links) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.append(link)
  }

  if (styles.inline.length) {
    const style = document.createElement('style')
    style.id = 'inflow-host-styles'
    style.textContent = styles.inline.join('\n')
    // Before the theme tag, so the host's own `:root` block cannot win over the
    // tokens resolved from where the sandbox actually sits.
    document.head.insertBefore(style, themeStyle)
  }
}

const api = createGuestRuntime(
  {
    prepare(options: GuestMountOptions) {
      applyStyles(options.styles)
      applyTheme(options.theme)
      document.body.append(mount)
      return { root: mount, document }
    },

    settled() {
      // One immediate measurement so the frame is the right size on first paint,
      // then continuous ones for everything the guest does afterwards.
      reportHeight()
      observer = new ResizeObserver(reportHeight)
      observer.observe(document.body)
    },

    teardown() {
      observer?.disconnect()
      observer = undefined
      mount.remove()
    },
  },
  () => host,
)

const exported: SandboxGuestApi = {
  ...api,
  async updateTheme(theme) {
    applyTheme(theme)
    await api.updateTheme(theme)
  },
}

self.addEventListener('message', function onPort(event: MessageEvent) {
  const port = event.data?.inflowSandbox === 'port' ? event.ports[0] : undefined
  if (!port) return
  self.removeEventListener('message', onPort)

  const thread = new ThreadMessagePort<SandboxHostApi, SandboxGuestApi>(port, { exports: exported })
  host = thread.imports as SandboxHostApi

  // See the note beside the host's `port1.start()`: a port that is listened to
  // with `addEventListener` rather than `onmessage` is never started by itself,
  // and an unstarted port swallows everything in silence.
  port.start()

  self.addEventListener('error', (event) => {
    host.log('error', `uncaught error in guest: ${event.message}`)
  })
  self.addEventListener('unhandledrejection', (event) => {
    host.log('error', `unhandled rejection in guest: ${String(event.reason)}`)
  })
})

// Announce. The host is listening for exactly this and answers with the port.
;(self.parent as Window).postMessage({ inflowSandbox: 'hello' }, '*')
