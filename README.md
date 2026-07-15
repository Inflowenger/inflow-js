# inflow-js

The JavaScript/TypeScript packages a frontend uses to talk to the Inflow ecosystem.

| Package | What it does | Depends on |
|---|---|---|
| [`@inflowenger/plugin-form-builder`](packages/plugin-form-builder) | Renders Inflow's `x-inflow-ui` schema extension as real form widgets — buttons wired to your own actions — on top of JSON Forms. | Vue 3, JSON Forms |
| [`@inflowenger/flow-trace`](packages/flow-trace) | Turns the Inflow process event stream into flow movement and completion: where the process is, which edges it took, whether it finished. | nothing |

They are independent. Take one, take both.

`flow-trace` has no dependencies and no framework — it runs in a browser, in Node, or in a test. `plugin-form-builder` is Vue-only. If you are on React today, `flow-trace` is still yours to use.

## Install

```sh
pnpm add @inflowenger/plugin-form-builder @inflowenger/flow-trace
```

Public packages on the npm registry — no token, no `.npmrc`, nothing to configure.

`plugin-form-builder` declares Vue and JSON Forms as peer dependencies, so bring your own:

```sh
pnpm add vue @jsonforms/core @jsonforms/vue
```

## The lab

Before reading any of the below, you can just run it. [`lab/`](lab) is a small Vue app in this repo that drives both packages by hand — no backend, no engine, no inspector.

```sh
pnpm install
pnpm -r build                      # the lab consumes dist, so build first
pnpm --filter @inflowenger/lab dev
```

| Page | Package | What it shows |
|---|---|---|
| **Form Preview** | plugin-form-builder | A schema / UI-schema pair edited live, rendered through the Inflow renderers, with every action call listed alongside what it saw and the patch it wrote. |
| **Debug Enum** | plugin-form-builder | A field carrying `x-inflow-ui` side by side with the same field without it. They must behave identically. |
| **Run Replay** | flow-trace | A captured engine run fed to a tracker one message at a time, with controls to reorder, drop from, and pollute the stream. |

The lab consumes the packages through `workspace:*` — their built entrypoints, exactly as an installed app does — so it exercises the exports map, the types, and `style.css` rather than the source behind them. A packaging mistake shows up there instead of in your app.

The `x-inflow-ui` contract has two edges that bite people, and both are easier to see than to read about: Form Preview's action log shows effects travelling through `updateData` and nothing coming back from the return value, and its Reload button patches leaf paths while leaving the rest of `connection` alone. Run Replay's toggles cover the parts of the event contract a clean run never reaches — reordering, a real gap, and traffic that isn't an event at all.

Details, and how to add a page: [`lab/README.md`](lab/README.md).

## @inflowenger/plugin-form-builder

JSON Forms renders a form from a schema. Inflow's schemas carry an extra key, `x-inflow-ui`, describing behaviour a plain form has no vocabulary for — *put a button on this field, and run this action when it's clicked*. This package is the renderer that understands that key.

The design is strictly opt-in: fields without `x-inflow-ui` fall through untouched to whatever renderer set you already use (vanilla, Vuetify, your own). Nothing about your existing form changes by installing this.

### Register the plugin

The plugin supplies two things through Vue's provide/inject: your **actions** (the functions `x-inflow-ui` is allowed to call by name) and a **theme** (class names, so the package never ships opinions about your design system).

```ts
// main.ts
import { createApp } from 'vue'
import { InflowUiPlugin, createInflowUi } from '@inflowenger/plugin-form-builder'
import '@inflowenger/plugin-form-builder/style.css'

const app = createApp(App)

app.use(InflowUiPlugin, createInflowUi({
  theme: {
    containerClass: 'my-field',
    buttonClass: 'my-btn',
    iconButtonClass: 'my-btn-icon',
  },
  actions: {
    async loadLabels(ctx) {
      const labels = await api.labelsFor(ctx.data)
      ctx.updateData({ labels })
      await ctx.refresh?.()
    },
  },
}))
```

The three theme classes are the entire styling contract. Point them at your own tokens and the package inherits your app's look, dark mode included.

### Register the renderers

```ts
import { JsonForms } from '@jsonforms/vue'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import {
  InflowControlRenderer,
  InflowLayoutRenderer,
  inflowControlTester,
  inflowLayoutTester,
} from '@inflowenger/plugin-form-builder'

const renderers = [
  { tester: inflowControlTester, renderer: markRaw(InflowControlRenderer) },
  { tester: inflowLayoutTester, renderer: markRaw(InflowLayoutRenderer) },
  ...vanillaRenderers.map((r) => ({ tester: r.tester, renderer: markRaw(r.renderer) })),
]
```

```vue
<JsonForms :schema="schema" :uischema="uischema" :data="data" :renderers="renderers" />
```

Both testers rank at 1000, above the defaults, but only match elements that actually carry `x-inflow-ui` — so ordering within the array doesn't matter, and unmarked fields never reach them. `markRaw` matters: without it Vue makes the component definitions reactive and JSON Forms gets slower for no reason.

### Mark up a field

```jsonc
{
  "type": "Control",
  "scope": "#/properties/project",
  "x-inflow-ui": {
    "action": { "name": "loadLabels" },
    "button": { "position": "append", "label": "Load" }
  }
}
```

`position` is `append` | `prepend` | `above` | `below`, relative to the control that would have rendered anyway.

### The action contract

An action receives a context and returns nothing:

```ts
type InflowAction = (ctx: InflowActionContext) => void | Promise<void>
```

| `ctx` | |
|---|---|
| `data` | The value at the renderer's scope — the field the button sits on, not the whole form. |
| `schema`, `uischema`, `path` | Where the action was fired from. |
| `updateData(patch)` | Apply changes. Keys are absolute data paths. |
| `refresh?()` | Force a re-render. Rarely needed — Vue is reactive by default. |

Two things bite people here:

**Effects go through `updateData`, not the return value.** The signature is `void` on purpose; there is no return channel back into the form. An action that computes a value and returns it silently does nothing.

**Patch leaf paths, not objects.** `updateData({ 'connection.host': 'api.example.com' })` sets the host. `updateData({ connection: { host: 'api.example.com' } })` *replaces* `connection`, discarding the port and every other key that lived there.

Actions are resolved by name from the registry, so a schema can never invoke anything you didn't explicitly hand the plugin. A missing name is inert rather than fatal.

All three are live on the lab's Form Preview page — the action log prints each call's `ctx.data` and its patch, the Jira sample's Reload button patches leaves under `connection` while port and TLS survive, and the "Unknown action" sample names something the host never registered.

## @inflowenger/flow-trace

The Inflow engine publishes an event per meaningful thing that happens while a flow runs. This is the consumer half: feed it the stream, get movement and completion.

```ts
import { createFlowTracker } from '@inflowenger/flow-trace'

const tracker = createFlowTracker({ pid })

tracker.on('move', ({ edgeId }) => highlightEdge(edgeId))
tracker.on('node:enter', ({ node }) => markRunning(node.key))
tracker.on('node:exit', ({ node, status }) => markSettled(node.key, status))
tracker.on('finish', ({ status, durationMs }) => showResult(status, durationMs))

socket.on('message', (raw) => tracker.ingest(raw))
```

`ingest` takes an object or a JSON string and never throws — anything unusable arrives on the `skip` event instead of breaking your socket handler. For a run you already hold in full, `replay(lines).get(pid)` gives you the final state directly.

`state(pid)` returns plain objects (`nodes`, `edges`, `status`, `entry`, timings) — wrap them in `reactive()`, diff them, or serialise them as-is.

Full event table, ordering rules, and the gap/reorder semantics: [`packages/flow-trace/README.md`](packages/flow-trace/README.md). The three things most worth knowing before you build on it:

- **A node is `flow:node`, never a bare id.** Node ids are unique only within a flow, and one process spans several via GoTo. Use the exported `nodeKey()`; keying on the raw id silently merges unrelated nodes.
- **Order comes from `seq`, never `ts`.** The engine emits many events per millisecond, so timestamps collide and cannot sort anything.
- **State is bounded by the graph, not the run.** A loop can hit a node thousands of times; `nodes`/`edges` keep one entry per identity with counters, so nothing accumulates per pass. Events still fire every pass, which is what animation needs.

The lab's Run Replay page is this section with a play button: the same captured run, stepped one `ingest` at a time, with node keys, edge counters, and the emitted feed side by side. Its toggles reorder the stream, drop an event, and mix in traffic that isn't an event — the cases you would otherwise only meet in production.

## Working on this repo

pnpm workspace: `packages/*`, plus [`lab/`](lab) — a playground app that consumes both packages and is never published.

```sh
pnpm install
pnpm -r build          # both packages, then the lab
pnpm --filter @inflowenger/flow-trace test
pnpm --filter @inflowenger/lab dev
```

`flow-trace` builds with `tsc`; its tests run on `node:test` against `test/fixtures/real-run.jsonl` — an actual captured engine run covering a contract branch, a plugin failure, a GoTo across flows, and a loop. Extend the fixture rather than hand-writing events; hand-written events drift from what the engine really emits.

`plugin-form-builder` builds with Vite in library mode. Vue and JSON Forms are `peerDependencies` and stay external — the consuming app owns those, and bundling a second copy of Vue breaks reactivity in ways that are miserable to debug.

The lab is the first place to try a change: leave `pnpm --filter <pkg> dev` running to rebuild on save, and the lab picks the new `dist` up. It renders both packages against data that ships with the repo, so a regression is visible without wiring anything up. `pnpm -r build` builds it too, which means CI typechecks the packages against a real consumer on every push.

To try a change against a real app before publishing, link it:

```sh
pnpm --filter @inflowenger/plugin-form-builder build
cd ../your-app && pnpm link ../inflow-js/packages/plugin-form-builder
```

## Releasing

Publishing is done by CI on tag push, so the registry only ever contains a commit that exists here.

```sh
# bump the version in the package's package.json, commit, then:
git tag plugin-form-builder-v0.2.0
git push origin plugin-form-builder-v0.2.0
```

Tags are per-package (`plugin-form-builder-v*`, `flow-trace-v*`) — the two version independently, and there is no reason to drag one forward because the other moved. CI refuses to publish if the tag and the `package.json` version disagree.

One-time setup: the `@inflowenger` org on npmjs.com, and an `NPM_TOKEN` (automation type) in the repo's Actions secrets.

## License

MIT
