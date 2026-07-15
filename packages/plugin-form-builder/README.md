# @inflowenger/plugin-form-builder

Renders Inflow's `x-inflow-ui` schema extension as real form widgets, on top of [JSON Forms](https://jsonforms.io) + Vue 3.

JSON Forms renders a form from a schema. Inflow's schemas carry an extra key, `x-inflow-ui`, describing behaviour a plain form has no vocabulary for — *put a button on this field, and run this action when it's clicked*. This package is the renderer that understands that key.

It is strictly opt-in. Fields without `x-inflow-ui` fall through untouched to whatever renderer set you already use, so installing this changes nothing about your existing forms. It ships no design system: three class names are the whole styling contract.

## Install

```sh
pnpm add @inflowenger/plugin-form-builder
pnpm add vue @jsonforms/core @jsonforms/vue   # peers, if you don't have them
```

## Register the plugin

The plugin supplies two things through Vue's provide/inject: your **actions** (the functions `x-inflow-ui` is allowed to call by name) and a **theme** (class names).

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

Point the theme classes at your own tokens and the package inherits your app's look, dark mode included.

## Register the renderers

```ts
import { markRaw } from 'vue'
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

Both testers rank at 1000, above the defaults, but only match elements that actually carry `x-inflow-ui` — so array order doesn't matter and unmarked fields never reach them. `markRaw` matters: without it Vue makes the component definitions reactive and JSON Forms gets slower for nothing.

The layout tester covers `VerticalLayout`, `HorizontalLayout`, `Group`, `Category`, and `Categorization`.

## Mark up a field

```jsonc
{
  "type": "Control",
  "scope": "#/properties/project",
  "x-inflow-ui": {
    "action": { "name": "loadLabels" },
    "button": { "position": "append", "label": "Load", "icon": "refresh" }
  }
}
```

`position` is `append` | `prepend` | `above` | `below`, relative to the control that would have rendered anyway.

## The action contract

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

**Patch leaf paths, not objects.**

```ts
ctx.updateData({ 'connection.host': 'api.example.com' })   // sets host
ctx.updateData({ connection: { host: 'api.example.com' } }) // REPLACES connection,
                                                            // dropping port, secure, ...
```

Actions resolve by name from the registry, so a schema can never invoke anything you didn't hand the plugin. A missing name is inert rather than fatal.

## Exports

Renderers `InflowControlRenderer`, `InflowLayoutRenderer`, `InflowActionButton`; testers `inflowControlTester`, `inflowLayoutTester`, `inflowTesters`; plugin `InflowUiPlugin`, `createInflowUi`; registry helpers `createInflowActionRegistry`, `resolveAction`, plus the injection keys and all types.

Enum and `oneOf` controls are deliberately left to the host's renderer set, so the package stays loosely coupled and compatible across JSON Forms versions.

## License

MIT
