# @inflowenger/plugin-form-builder

Renders Inflow's `x-inflow-ui` schema extension as real form widgets, on top of [JSON Forms](https://jsonforms.io) + Vue 3.

JSON Forms renders a form from a schema. Inflow's schemas carry an extra key, `x-inflow-ui`, describing behaviour a plain form has no vocabulary for — *put a button on this field, and run this action when it's clicked*. This package is the renderer that understands that key.

It is strictly opt-in. Fields without `x-inflow-ui` fall through untouched to whatever renderer set you already use, so installing this changes nothing about your existing forms. It ships no design system: three class names are the whole styling contract.

## Install

```sh
pnpm add @inflowenger/plugin-form-builder
pnpm add vue @jsonforms/core @jsonforms/vue   # peers, if you don't have them
```

## Quick start

Every plugin's UI schema names the same action — the literal string `pluginFn` — and that action ships built in. Give the package a way to reach a plugin and a plugin's form works, buttons and all:

```vue
<script setup lang="ts">
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import { InflowForm } from '@inflowenger/plugin-form-builder'
import '@inflowenger/plugin-form-builder/style.css'
</script>

<template>
  <InflowForm
    :schema="form.schema"
    :uischema="form.uischema"
    v-model:data="body"
    :renderers="vanillaRenderers"
    :plugin-id="pluginId"
    :settings="settingsProfile"
    :call="({ pluginId, fn, body }) => api.pluginFn(pluginId, fn, body)"
  />
</template>
```

That is the whole integration. `call` is the only thing that is yours — the transport. What goes over it, and what happens to the answer, is this package's job.

## What `pluginFn` does

`pluginFn` is [the platform's one action](https://github.com/Inflowenger/plugin-catalog/blob/main/docs/dependent-fields.md): a control's button calls one of the plugin's own **meta functions**, so a form can consult the live service while it is being filled in — turn a typed name into the `accountId` an API needs, load the labels a project has, check a token before 3am does.

It **sends** the form flat: every field at the top level, plus the action's static `body`, plus `settings` and `value` (the control the button sits on). Deliberately *not* the `{_registry, body}` envelope an action execution uses.

It **applies the answer by shape**:

| The plugin returns | The form does |
|---|---|
| An object carrying `schema` and/or `uischema` | **Re-renders as that form**, data included |
| Any other object | Patches it in — every key an absolute leaf data path |
| Anything else (array, string, number) | Writes it to `action.target`, defaulting to the button's own control |
| `null` / nothing | Nothing — a meta function that already wrote a status field doesn't clear the field it was fired from |

Row one is the interesting one, and it is new. A plugin can answer a call with *the next form*, and the dialog becomes it — which is also the only way to change a `<select>`'s options at runtime, since options live in the schema, not the data. The Go SDK's `jsonschema` / `jsonui` spelling is accepted alongside `schema` / `uischema`, and schemas arriving as JSON text are parsed, so a handler can return its own `FormBuilder` verbatim.

Telling a re-render from a patch is deliberately conservative: an object counts as a form only when *every* key it has is one of `schema`, `jsonschema`, `uischema`, `uiSchema`, `jsonui`, `data`, `submit_to`, `submitTo`. A patch that happens to include a field called `schema` also includes `projectKey`, and stays a patch — mistaking one for the other would discard the user's work.

## Register the plugin

App-wide defaults go through Vue's provide/inject: the **transport**, your extra **actions**, and a **theme** (class names).

```ts
// main.ts
import { createApp } from 'vue'
import { InflowUiPlugin, createInflowUi } from '@inflowenger/plugin-form-builder'
import '@inflowenger/plugin-form-builder/style.css'

const app = createApp(App)

app.use(InflowUiPlugin, createInflowUi({
  // Configure it once here and every <InflowForm> inherits it; each form still
  // supplies the pluginId and settings profile it is bound to.
  call: ({ pluginId, fn, body }) => api.pluginFn(pluginId, fn, body),
  theme: {
    containerClass: 'my-field',
    buttonClass: 'my-btn',
    iconButtonClass: 'my-btn-icon',
  },
  actions: {
    async loadLabels(ctx) {
      const labels = await api.labelsFor(ctx.data)
      ctx.updateData({ labels })
    },
  },
}))
```

Point the theme classes at your own tokens and the package inherits your app's look, dark mode included.

**Your actions layer over the built-ins, and a name collision replaces one.** Registering your own `pluginFn` — app-wide or on one `<InflowForm>` — is how you take the whole thing over. Defaults are a floor, not a lock.

## Customising one action

Every action is handed a context that includes the default handling, so overriding a step doesn't mean rewriting the rest:

```ts
actions: {
  async pluginFn(ctx) {
    const result = await myTransport(ctx.config.fn, {
      ...ctx.rootData,            // the whole form, not just this field
      settings: ctx.host.settings,
    })

    if (result.needsConfirmation && !confirm(result.prompt)) return

    ctx.applyResult(result)       // ← the default: patch, or re-render
    ctx.setStatus('Loaded.')      // ← the only channel back to the user
  },
}
```

| `ctx` | |
|---|---|
| `data` | The value at the renderer's scope — the field the button sits on. |
| `rootData`, `rootSchema`, `rootUiSchema` | The whole form. |
| `schema`, `uischema`, `path` | Where the action was fired from. |
| `config` | This button's `x-inflow-ui.action` — `fn`, `target`, `body`. |
| `host` | `pluginId`, `settings`, `call`. |
| `updateData(patch)` | Apply changes. Keys are absolute leaf data paths. |
| `updateSchema`, `updateUiSchema`, `updateForm(envelope)` | Replace the document and re-render. |
| `applyResult(result, { target? })` | The default handling, as its own step. |
| `setStatus`, `setError` | Report to the user. |

**Effects go through the context, not the return value.** The signature is `void` on purpose; an action that computes a value and returns it silently does nothing.

**Patch leaf paths, not objects.**

```ts
ctx.updateData({ 'connection.host': 'api.example.com' })   // sets host
ctx.updateData({ connection: { host: 'api.example.com' } }) // REPLACES connection,
                                                            // dropping port, secure, ...
```

Actions resolve by name from the registry, so a schema can never invoke anything the app didn't provide. An unregistered name is inert rather than fatal — the button reports itself and does nothing.

## Mark up a field

```jsonc
{
  "type": "Control",
  "scope": "#/properties/projectKey",
  "x-inflow-ui": {
    "action": { "name": "pluginFn", "fn": "jira.meta.projects.resolve" },
    "button": { "position": "append", "label": "Find", "icon": "↻" }
  }
}
```

- `action.name` — `pluginFn` for a plugin call, or any name you registered.
- `action.fn` — the meta method, exactly as passed to the SDK's `AddMeta`.
- `action.target` — where a non-object answer lands. Defaults to this control.
- `action.body` — a static object merged into the request, for telling one shared meta function which caller it serves.
- `button.position` — `append` | `prepend` | `above` | `below`, relative to the control that would have rendered anyway.
- `button.icon` is rendered as **literal text**, not looked up in an icon font. Use a character (`↻`), not `mdi-refresh`.
- `button.label` should say what the button will do (`Find user`), because nothing fires automatically — there is no on-change hook and no type-ahead.

## Using your own `<JsonForms>`

`<InflowForm>` is a wrapper, not a requirement. The renderers work under a bare `<JsonForms>`:

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

**One thing does not work this way: a replaced schema does not last.** `<JsonForms>` seeds its core from its props and re-seeds it whenever `data` changes — so in a host that two-way binds data, a schema an action pushed in is reverted by the next keystroke. `<InflowForm>` exists because it owns those props; if you need forms that re-render themselves, use it. Everything else — buttons, patches, status — behaves identically.

## Styling

`style.css` is geometry, not a design system. It carries what a decorated field needs to hold together at all — the parts every host was otherwise re-deriving:

- **The button sits on its input's row.** A decorated control is a flex row of `[prepend] [control] [append]`, but the control is itself a column of label / input / error / description whose height changes as validation comes and goes — so a centred button drifts down the moment an error appears, and a bottom-aligned one lines up with the description. The row is a grid, the control's rows are promoted into it, and the button takes the input's row and stays there.
- **A checkbox stays a checkbox.** Vanilla gives every wrapped input `flex: 1`, which stretches a checkbox across the whole field. Inside a decorated control it is reset to its natural size (the host still decides what that is). Checkbox and radio controls keep the plain flex row — "box then label" is already right for them.
- **`above` / `below` buttons don't stretch** to the field's full width and read as banners.

Everything visible is still yours. Three class names are the whole contract:

```ts
theme: { containerClass: 'my-field', buttonClass: 'my-btn', iconButtonClass: 'my-btn-icon' }
```

Those land alongside the package's own classes, so any rule of yours out-specifies the defaults above — all of which are scoped inside `.inflow-*` elements this package renders, and none of which touch markup it doesn't own.

The one default worth knowing about: promoting the control's rows uses `display: contents`, which drops the control element's own box. If you style that box (a border, a background) and want it kept, set `display: block` back on it — the button then aligns to the box's centre, as it did before.

### On the vanilla renderer set

`@jsonforms/vue-vanilla` has a few layout bugs of its own that every host of this package ends up re-deriving. They ship as a second, optional stylesheet:

```ts
import '@jsonforms/vue-vanilla/vanilla.css'
import '@inflowenger/plugin-form-builder/style.css'
import '@inflowenger/plugin-form-builder/vanilla-fixes.css'
```

| | |
|---|---|
| Empty error / description rows | Rendered whether or not they have anything to say, with a `min-height` — ~3em of dead space per control. Collapsed until they have text. |
| Checkboxes | `.control > .wrapper` gives every input `flex: 1`, which zeroes a checkbox's basis and smears it across the field. Reset to its natural size (still yours to size), and re-placed as "box then label" on one line. |
| Arrays | Rendered as `<fieldset>` styled `display: flex`, which takes the `<legend>` out of legend flow and straddles it across the border. Put back as a block, legend on its own row, reading "Labels ….. +" rather than leading with the button. |

Geometry only, again — no colour, spacing or type. It is opt-in rather than part of `style.css` because it targets vanilla's class names (`.control`, `.wrapper`, `.array-list`), which are generic enough that an app may have its own; importing it is how you say you use that renderer set. Every rule is element-qualified or carries a `:has()`, so it corrects vanilla whichever order the two stylesheets load in.

**One note if you write these yourself instead:** if your stylesheet is loaded *before* `vanilla.css`, it loses every equal-specificity tie to it. Scope your form rules under one wrapper class (`.my-form .my-input`) and they win regardless of order.

## Telling the user something

An action's signature is `void`, so the line under the form is the only channel it has. `<InflowForm>` renders it, and the `status` slot is how you render it in your own design system:

```vue
<InflowForm ...>
  <template #status="{ busy, status, error }">
    <Spinner v-if="busy" />
    <Alert v-else-if="error" tone="danger">{{ error }}</Alert>
    <p v-else-if="status">{{ status }}</p>
  </template>
</InflowForm>
```

A transport failure lands in `error` on its own. A plugin's *own* failure does not: a meta function that answers `{"error": "..."}` is patching a field called `error` into the form, not raising one. So give every dependent-field group a readonly status property and write failures into it — it is the difference between "the button does nothing" and "no assignable user matches 'mehdi' — is the project key right?".

Buttons disable themselves while their own action runs, and `busy` is counted, so two in flight at once don't have the first to finish clear the second's spinner.

## Exports

Component `InflowForm`; renderers `InflowControlRenderer`, `InflowLayoutRenderer`, `InflowActionButton`; testers `inflowControlTester`, `inflowLayoutTester`, `inflowTesters`; plugin `InflowUiPlugin`, `createInflowUi`; the built-in `pluginFn` with its name as `PLUGIN_FN`, plus `builtinActions`, `builtinActionNames` and `withBuiltinActions`; the shape helpers `isFormEnvelope`, `normalizeFormEnvelope`, `patchFor`, `applyActionResult`; registry helpers `createInflowActionRegistry`, `resolveAction`; `createInflowFormController` and `useInflowActionContext` for building on top — plus the injection keys and all types.

Enum and `oneOf` controls are deliberately left to the host's renderer set, so the package stays loosely coupled and compatible across JSON Forms versions.

## Tests

```sh
pnpm test
```

Covers the contract that matters across hosts: the flat request body, each answer shape, a re-render surviving the next keystroke, the Go SDK's `jsonschema`/`jsonui` spelling, envelope detection staying conservative, and a host overriding `pluginFn` by name.

## License

MIT
