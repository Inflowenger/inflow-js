/**
 * Getting the host's look into the sandbox.
 *
 * The two renderers need completely different things here, and the difference
 * is the single strongest argument in the whole evaluation:
 *
 * - **`remote`** needs *nothing*. The nodes the guest describes are built by the
 *   host, in the host's document, inside the drawer — so `.dark`, every
 *   `--accent`, every Tailwind utility and every inherited `font-family` already
 *   apply, for the same reason they apply to a `<button>` written by hand in
 *   `NodeConfig.vue`. There is no bridge to keep in sync because there is no
 *   boundary to cross. The token snapshot below is still taken for it, but only
 *   so a guest that wants to *read* a colour (to draw a chart, to pick a series
 *   palette) can, not because rendering depends on it.
 *
 * - **`iframe`** needs all of it. A null-origin frame is a separate document
 *   with its own cascade: nothing inherits, no stylesheet applies, and the
 *   theme has to be serialised, injected, and re-injected whenever the host's
 *   theme changes. That is the recurring maintenance cost of the iframe
 *   approach, and it is why it is the fallback rather than the default.
 */

/** A snapshot of the host's theme, as handed to a guest. */
export interface ThemeSnapshot {
  /** Every CSS custom property in effect on the host root, resolved to its value. */
  tokens: Record<string, string>
  /** Whether the host is currently in dark mode, by `color-scheme`. */
  dark: boolean
  /** `color-scheme` verbatim, for a guest that wants to set its own. */
  colorScheme: string
  /** Resolved `font-family` / `font-size` of the mount point, so an iframe guest
   *  can reproduce the inherited typography a remote guest simply gets. */
  font: { family: string; size: string; lineHeight: string }
  /** The host's text and background at the mount point — the two values an
   *  iframe guest needs before it can draw anything that does not look pasted on. */
  color: string
  background: string
}

/**
 * Collect the custom properties that are actually in effect.
 *
 * Two sources, unioned, because neither alone is complete:
 *
 * 1. Iterating `getComputedStyle` yields custom properties in current Chrome,
 *    Firefox and Safari, and is the only way to see a variable set at runtime by
 *    script or by an inline `style` attribute.
 * 2. Scanning the document's own stylesheets finds the names a browser that does
 *    not enumerate them still resolves, and catches variables declared on
 *    `:root` but shadowed further down.
 *
 * Cross-origin stylesheets throw on `.cssRules` access; they are skipped rather
 * than fataled, which only costs us the names declared there (their *values*
 * still resolve through `getPropertyValue`, we just never learn to ask).
 */
function collectTokens(element: Element): Record<string, string> {
  const computed = getComputedStyle(element)
  const names = new Set<string>()

  // Source 1 — enumerable computed custom properties.
  for (let i = 0; i < computed.length; i += 1) {
    const name = computed.item(i)
    if (name.startsWith('--')) names.add(name)
  }

  // Source 2 — names declared anywhere in the document's own stylesheets.
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin; nothing readable here.
    }
    collectNamesFromRules(rules, names)
  }

  const tokens: Record<string, string> = {}
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim()
    if (value) tokens[name] = value
  }
  return tokens
}

function collectNamesFromRules(rules: CSSRuleList, into: Set<string>, depth = 0): void {
  // Nested at-rules (@media, @supports, @layer) hold the dark-theme block in
  // most design systems, so the walk has to recurse — but not without bound: a
  // pathological stylesheet should not be able to stall the drawer.
  if (depth > 6) return
  for (const rule of Array.from(rules)) {
    const style = (rule as CSSStyleRule).style
    if (style) {
      for (let i = 0; i < style.length; i += 1) {
        const name = style.item(i)
        if (name.startsWith('--')) into.add(name)
      }
    }
    const nested = (rule as CSSGroupingRule).cssRules
    if (nested) collectNamesFromRules(nested, into, depth + 1)
  }
}

/**
 * The host's theme as the guest sees it, read at `element` so that anything
 * scoped to the drawer (a panel that overrides `--surface`) is reflected rather
 * than the page-level value.
 */
export function readTheme(element: Element): ThemeSnapshot {
  const computed = getComputedStyle(element)
  const colorScheme = computed.colorScheme || getComputedStyle(document.documentElement).colorScheme || 'normal'
  return {
    tokens: collectTokens(element),
    dark: colorScheme.includes('dark'),
    colorScheme,
    font: {
      family: computed.fontFamily,
      size: computed.fontSize,
      lineHeight: computed.lineHeight,
    },
    color: computed.color,
    background: computed.backgroundColor,
  }
}

/**
 * Watch for anything that could change the theme and re-read it.
 *
 * Deliberately coarse: a class toggled on `<html>` (how nearly every design
 * system, FloMorphic's included, switches dark mode), a changed `style`
 * attribute (runtime token overrides), and the OS preference flipping under a
 * host that follows it. Re-reading is cheap next to being wrong, and being
 * wrong here means a guest rendering black on black.
 *
 * Returns the unsubscribe.
 */
export function watchTheme(element: Element, onChange: (theme: ThemeSnapshot) => void): () => void {
  let last = JSON.stringify(readTheme(element))

  const emit = () => {
    const next = readTheme(element)
    const serialized = JSON.stringify(next)
    if (serialized === last) return
    last = serialized
    onChange(next)
  }

  const observer = new MutationObserver(emit)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', emit)

  return () => {
    observer.disconnect()
    media.removeEventListener('change', emit)
  }
}

// ---------------------------------------------------------------- iframe ----

/**
 * The host's stylesheets, serialised for injection into a frame.
 *
 * Same-origin sheets are inlined as text. Cross-origin ones cannot be read, so
 * their URL is passed through for the frame to fetch itself — which works
 * because a `sandbox="allow-scripts"` frame may still load subresources, it just
 * cannot reach back into us.
 *
 * This is the part that has no equivalent in the `remote` renderer, and the part
 * that quietly rots: a stylesheet added after the frame was built, a sheet
 * behind a CDN that starts refusing CORS, a `@font-face` whose relative URL no
 * longer resolves from a null origin. It works, and it is a maintenance tax.
 */
export function collectStyles(): { inline: string[]; links: string[] } {
  const inline: string[] = []
  const links: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      if (sheet.href) links.push(sheet.href)
      continue
    }
    const text = Array.from(rules)
      .map((rule) => rule.cssText)
      .join('\n')
    if (text) inline.push(text)
  }

  return { inline, links }
}

/** A theme snapshot → the CSS that reproduces it on a frame's `:root`. */
export function themeToCss(theme: ThemeSnapshot): string {
  const declarations = Object.entries(theme.tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')

  return [
    ':root {',
    declarations,
    `  color-scheme: ${theme.colorScheme};`,
    '}',
    'html, body {',
    `  margin: 0; padding: 0;`,
    `  color: ${theme.color};`,
    `  background: transparent;`,
    `  font-family: ${theme.font.family};`,
    `  font-size: ${theme.font.size};`,
    `  line-height: ${theme.font.lineHeight};`,
    '}',
  ].join('\n')
}
