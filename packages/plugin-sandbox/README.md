# @inflowenger/plugin-sandbox

Run a plugin's own UI code inside a host page — safely, and looking like it belongs there.

This package is the `renderer` half of the Inflow `@form` protocol. It exists because
some dialogs are not forms, and the answer to that should not be "the host grows
another widget".

---

## The evaluation

Three technologies were considered for running plugin-authored UI inside FloMorphic's
node settings drawer. The requirement was specific: **a safe, isolated box inside the
page that inherits everything about the host's CSS and theme.**

### jsdom — not applicable

`jsdom` is a DOM implementation **for Node.js**. It is not a browser sandbox and
cannot be one:

- It does not run in a browser. The published package depends on `fs`, `http`, `vm`
  and `net`.
- It is not an isolation boundary. Its script support runs on Node's `vm` module,
  which Node's own documentation states is not a security mechanism.
- It never lays anything out. There is no rendering, so there is nothing for a user
  to look at.

It was ruled out on the first point and would have been ruled out on the other two.
It does have a legitimate role in this architecture, just not this one: **smoke-testing
a plugin's renderer bundle headlessly during catalog ingestion** — import it, mount it
against a jsdom document, assert it produced nodes and did not throw. That is a CI
check, not a runtime.

### Web-Sandbox (`@jetbrains/websandbox`) — the idea is right, the package is not

It puts the guest in an `iframe` with `sandbox="allow-scripts"` and no
`allow-same-origin`, giving an **opaque origin**, and adds a `postMessage` RPC
connector. The isolation model is sound and it is the same one this package's `iframe`
renderer uses.

The package itself was not adopted: last published in 2019, no TypeScript types, and
its RPC layer does not proxy functions, which is most of what the contract needs. The
mechanism was reimplemented directly — it is about 120 lines over
`@quilted/threads` — so that the two renderers share one guest contract.

### Remote DOM (`@remote-dom/core`, Shopify) — adopted as the default

The guest runs in a **Web Worker** and never touches the DOM. It builds its tree
against a polyfilled document; every mutation is serialised into records; the **host**
builds the real nodes from those records, from an allow-list it controls.

This inverts the usual trade, and the inversion is the whole argument:

> An iframe is safe because the guest is *elsewhere*. A remote guest is safe because
> it never touches anything — it can only ask, and the host decides which asks are
> honoured.

A Worker is also strictly more isolated than an iframe for this purpose: it has no
`document`, no `window`, no cookies, no storage and no DOM to attack from. There is
not a weaker boundary to escape; there is no boundary, because there is nothing on
the other side of it.

And because the nodes the user sees are **host nodes in the host's document**, the
host's CSS reaches them for the same reason it reaches hand-written markup in the
same drawer. There is no bridge to keep in sync, because there is no boundary to
cross.

### Verdict

| | `remote` (Worker + Remote DOM) | `iframe` (null origin) | jsdom |
|---|---|---|---|
| Runs in a browser | ✅ | ✅ | ❌ |
| Isolation | Worker: no DOM, storage, cookies, or host reach | Opaque origin: no storage, cookies, or host reach | None (`vm` is not a boundary) |
| Host CSS / theme | **Inherited. Nothing to do.** | Copied in, re-injected on change | — |
| Popovers, `<select>`, tooltips | Escape normally | Clipped at the frame edge | — |
| Height | Natural | Measured and reported back | — |
| Real layout (`canvas`, measurement) | ❌ | ✅ | ❌ |
| Host design-system components | ✅ via `inflow-*` element names | ❌ | — |
| Maintenance | Active (Shopify, production) | Browser primitive | — |

**`remote` is the default. `iframe` is the escape hatch for guests that need a real
document.** Both are implemented here; a plugin picks one and the host may override
it (a browser without Workers falls back to the frame automatically).

---

## The protocol change

One optional key on the form document a plugin already serves:

```jsonc
{
  "jsonschema": "{...}",   // unchanged — still the data contract, whichever renderer draws
  "jsonui":     "{...}",   // unchanged — only the jsonforms renderer reads it
  "renderer":   "remote"   // NEW. Absent ⇒ "jsonforms". That is the whole compatibility story.
}
```

Or, in full:

```jsonc
"renderer": {
  "type": "remote",                    // "jsonforms" | "remote" | "iframe"
  "module": "https://plugin/ui.js",    // …or "code": "<the module source>"
  "integrity": "sha384-…",             // verified by the host before anything runs
  "framework": "vue",                  // informational, for diagnostics
  "elements": ["div", "button"],       // narrows the allow-list; can only reduce
  "height": "auto",
  "timeout": 8000,
  "exposeSettings": false              // default: credentials never reach the guest
}
```

Anything absent, unknown or malformed resolves to `jsonforms`. A host that predates a
renderer a plugin asks for draws the declarative form instead of nothing.

**A plugin ships both.** The schema is the data contract the guest writes into, and it
is the dialog the host falls back to when the bundle will not load. A renderer without
a schema behind it is a node that becomes unconfigurable the first time a CDN has a
bad day.

---

## Writing a guest

A guest is an ES module with a default export. That is the entire contract:

```js
export default function mount(ctx) {
  const button = ctx.document.createElement('button')
  button.className = 'if-btn'              // the HOST's class. Nothing injected it.
  button.textContent = 'Test connection'
  button.addEventListener('click', async () => {
    const result = await ctx.call('db.ping')          // → the plugin's meta function
    ctx.notify({ severity: 'success', message: `Reachable in ${result.ms}ms` })
  })
  ctx.root.append(button)
  return () => { /* optional cleanup */ }
}
```

Anything that renders to a DOM works the same way — hand `ctx.root` to
`createApp().mount()`, `render()`, or `createRoot()`:

```js
import { createApp } from 'vue'
import App from './App.vue'

export default (ctx) => {
  const app = createApp(App, { ctx })
  app.mount(ctx.root)
  return () => app.unmount()
}
```

`ctx` deliberately mirrors `InflowActionContext` from `@inflowenger/plugin-form-builder`
— `data`, `schema`, `call`, `notify`, `setData` mean the same things in both, so moving
a dialog between renderers is a change of drawing, not of vocabulary.

| | |
|---|---|
| Draw | `ctx.root` · `ctx.document` |
| Read | `ctx.data` · `ctx.schema` · `ctx.uischema` · `ctx.theme` · `ctx.readonly` |
| Write | `ctx.setData(data)` · `ctx.patchData({ 'a.b': 1 })` |
| React | `ctx.onData(fn)` · `ctx.onTheme(fn)` |
| Reach out | `ctx.call(fn, body)` · `ctx.notify(message)` |

### Styling

Under `remote`, **use the host's classes and CSS variables directly.** The nodes end up
in the host's document, so `class="if-btn"`, `class="bg-surface text-fg"` and
`color: var(--accent)` all simply work, in light and dark, with no stylesheet shipped
and nothing injected.

Read a token into JavaScript only when it has to cross into a non-CSS context — a
canvas stroke, a chart series, an SVG gradient stop:

```js
import { token } from '@inflowenger/plugin-sandbox/guest'
const accent = token(ctx.theme, '--accent', '#2f6fe0')
```

### Building the bundle

Bundle everything. A sandbox has no import map and no bare-specifier resolution.

```ts
export default defineConfig({
  build: {
    lib: { entry: 'src/guest.ts', formats: ['es'], fileName: () => 'guest.js' },
    rollupOptions: { external: [] },
  },
  // Required for Vue/React: their bundler builds branch on process.env.NODE_ENV and
  // expect the application's bundler to substitute it. Without this the bundle dies
  // on its first line with `ReferenceError: process is not defined`.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '({})',
  },
})
```

Build **one entry per bundle**. Given two, Rollup hoists shared code into a chunk
imported by relative path, and neither sandbox can resolve such a path.

---

## Serving it from Go

```go
//go:embed ui/dist/query-builder.js
var queryUI embed.FS

form := formkit.New("Run query").
    Add(formkit.TextArea("query", "Query").Required()).
    Renderer(formkit.MustRendererFS(queryUI, "ui/dist/query-builder.js",
        formkit.Framework("vue"),
    )).
    Build()
```

`RendererFS` inlines the bundle, so the dialog ships inside the binary: no asset host,
no CORS, no cache to invalidate, and no way for the UI and the handlers to be different
versions. For a bundle carrying a framework runtime, prefer `RendererURL` plus
`IntegrityOf` so the browser can cache it.

---

## Hosting it

```vue
<InflowSandboxForm
  v-if="renderer.type !== 'jsonforms'"
  :renderer="form.renderer"
  :schema="form.schema"
  :data="value"
  :plugin-id="pluginId"
  :call="callPlugin"
  :components="{ 'inflow-button': Button }"
  @update:data="onData"
  @notification="onNotification"
>
  <template #fallback>
    <!-- the plugin's declarative form -->
  </template>
</InflowSandboxForm>
```

Two properties make it acceptable to run a third party's code in your page:

- **The settings profile never crosses.** A guest reaches its service through `call`,
  where the *host* attaches the credentials. It uses a token it is never handed.
- **A failed renderer is not a failed node.** `#fallback` draws the declarative form.

### What a guest may put on the page

`src/policy.ts` is the whole grant, in one readable file. Structure, text, form
controls and SVG; **no** `script`, `style`, `link`, `meta`, `base`, `iframe`, `object`,
`embed`, `form` or `template`; no `innerHTML` or any sibling; no `on*` attributes; no
`__proto__`; `javascript:` and navigable `data:` URLs dropped; inline `style`
sanitised. A plugin may narrow the list; it can never widen it.

Map `inflow-*` element names to your own components through `:components` and a
plugin's dialog uses your real button and real input without knowing anything about
them.

---

## Things that cost a day each

Recorded because none of them produce an error message, and all of them look like a
sandbox failure when they are not.

1. **`@remote-dom/core` declares `sideEffects: false`.** Its `polyfill/hooks` module
   installs the callbacks that turn DOM mutations into wire records — and a bundler
   that believes the manifest drops it. The guest then mounts, reports ready, and the
   host receives an empty tree. Nothing is wrong; the messages were simply never sent.
   Import `hooks` **by name** and assert on it.
2. **`RemoteReceiver` mutates its nodes in place**, bumping a `version` counter rather
   than replacing the object. A Vue `shallowRef` sees the same reference, `Object.is`
   says nothing changed, and nothing re-renders. `triggerRef` is load-bearing.
3. **Remote DOM does not mirror `addEventListener` on plain elements.** Its design is
   that guests render custom elements declaring their events. Plugin authors arrive
   with Vue, Preact and `createElement`. This package implements the hook.
4. **Listeners must be invoked with `this` bound to the element.** Preact registers one
   `eventProxy` per event and looks the real handler up via `this._listeners`. Called
   bare, every Preact handler throws before it runs.
5. **The polyfill's elements expose no IDL properties**, so `'disabled' in el` is false
   and Vue falls back to `setAttribute('disabled', false)` → `disabled="false"` → a
   permanently disabled button, because a boolean attribute's *presence* is what counts.
   Boolean attributes are normalised host-side.
6. **`ThreadMessagePort` does not call `port.start()`.** A port listened to with
   `addEventListener` is never started implicitly, and an unstarted port queues
   everything in silence.
7. **A null-origin frame fetching the bundle sends `Origin: null`**, which virtually no
   server allows. The host fetches it instead and hands over the source.
8. **Neither sandbox can resolve a relative URL** — a blob worker's base is not
   hierarchical and a frame has no origin. The host makes module URLs absolute.
9. **Vite's library mode rewrites `new Worker(new URL(…, import.meta.url))`** into an
   absolute path marked `@vite-ignore`, resolved against the consumer's origin, where
   nothing was copied. Both bootstraps are compiled to text and inlined.

## Browser requirements

Module Workers (`remote`) or `srcdoc` iframes (`iframe`); `MessageChannel`;
`structuredClone`. A CSP must allow `worker-src blob:` for `remote` and inline script
for `iframe` — or pass `workerUrl` / `frameUrl` and serve the bootstraps yourself.
