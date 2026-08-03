# @inflowenger/plugin-form-builder

Renders Inflow's schema extensions as real form widgets, on top of [JSON Forms](https://jsonforms.io) + Vue 3.

JSON Forms renders a form from a schema. Inflow's schemas carry two extra keys describing what a plain form has no vocabulary for:

| | |
|---|---|
| `x-inflow-ui` | What this field can **do** — *put a button here, and run this action when it's clicked.* |
| `x-inflow-notif` | What can be **said** about it — help, a verification result, a warning, a failure — and how this platform should show it. |

This package is the renderer that understands both.

It is strictly opt-in. Fields carrying neither key fall through untouched to whatever renderer set you already use, so installing this changes nothing about your existing forms. It ships no design system: four class names are the whole styling contract.

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

A reserved key, `x-inflow-notif`, is lifted out of any of these first and [raised as a message](#saying-something-x-inflow-notif). It rides *alongside* the answer rather than instead of it — a lookup that resolved a key patches the key **and** says what it found.

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
  // Where this platform shows a message. Return true to claim one; anything
  // else and it still appears inline at its field. Optional.
  onNotify: (event) => {
    if (event.display === 'dialog') return myDialog.show(event), true
    if (event.display === 'toast') return myToasts.push(event), true
  },
  theme: {
    containerClass: 'my-field',
    buttonClass: 'my-btn',
    iconButtonClass: 'my-btn-icon',
    notifClass: 'my-alert',
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
| `setStatus`, `setError` | Report on the form's own line, about nothing in particular. |
| `notify(message)`, `clearNotifications(field?)` | Say something **about a field** — routed to the host, shown at the field. |

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
  },
  "x-inflow-notif": { "severity": "help", "message": "The key, not the name — OPS, not Operations." }
}
```

The two keys are siblings, and either works alone: a field may have something to say without having anything to do.

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

Both testers rank at 1000, above the defaults, but only match elements that actually carry `x-inflow-ui` or `x-inflow-notif` — so array order doesn't matter and unmarked fields never reach them. `markRaw` matters: without it Vue makes the component definitions reactive and JSON Forms gets slower for nothing.

The layout tester covers `VerticalLayout`, `HorizontalLayout`, `Group`, `Category`, and `Categorization`.

**Two things do not work this way**, both because they need state that outlives a re-seeded core, which is exactly what `<InflowForm>` owns:

- **A replaced schema does not last.** `<JsonForms>` seeds its core from its props and re-seeds it whenever `data` changes — so in a host that two-way binds data, a schema an action pushed in is reverted by the next keystroke.
- **Raised messages have nowhere to live.** Declared `x-inflow-notif` help still renders (it comes from the UI schema), but a message an action raises goes to your `onNotify` if you configured one and to the console if you didn't, rather than appearing at its field.

Everything else — buttons, patches, status — behaves identically.

## Styling

`style.css` is geometry, not a design system. It carries what a decorated field needs to hold together at all — the parts every host was otherwise re-deriving:

- **The button sits on its input's row.** A decorated control is a flex row of `[prepend] [control] [append]`, but the control is itself a column of label / input / error / description whose height changes as validation comes and goes — so a centred button drifts down the moment an error appears, and a bottom-aligned one lines up with the description. The row is a grid, the control's rows are promoted into it, and the button takes the input's row and stays there.
- **A checkbox stays a checkbox.** Vanilla gives every wrapped input `flex: 1`, which stretches a checkbox across the whole field. Inside a decorated control it is reset to its natural size (the host still decides what that is). Checkbox and radio controls keep the plain flex row — "box then label" is already right for them.
- **`above` / `below` buttons don't stretch** to the field's full width and read as banners.

- **Notifications are laid out, not decorated.** A row under the field, wrapping, with a dismiss control out of the flow. The one exception in the whole stylesheet is severity colour: telling an error from a help line is the entire point of a notification, so `.inflow-notif-error` &c. take theirs from `--inflow-danger` / `--inflow-warning` / `--inflow-success` / `--inflow-fg-muted`, falling back to `currentColor` wherever a hue would be a guess about your surface. Set the variables, override the classes, or claim the message in `onNotify` and none of it renders.

Everything visible is still yours. Four class names are the whole contract:

```ts
theme: {
  containerClass: 'my-field',
  buttonClass: 'my-btn',
  iconButtonClass: 'my-btn-icon',
  notifClass: 'my-alert',
}
```

Those land alongside the package's own classes, and every rule is scoped inside the `.inflow-*` elements this package renders — none of them reach markup it doesn't own.

Two defaults are worth knowing about:

- Promoting the control's rows uses `display: contents`, which drops the control element's own box. If you style that box (a border, a background) and want it kept, set `display: block` back on it — the button then aligns to the box's centre, as it did before. This rule is deliberately heavy: it has to outrank the `display: flex` a host puts on its own control class, or the promotion silently doesn't happen and the button drops to a row of its own below the field.
- Because of that, the grid rules are not all single-class selectors: `:not()` and `:has()` carry the specificity of what they hold, so a rule guarded by `:not(:has(input:is([type='checkbox'], [type='radio'])))` weighs a class and an element more than it reads as. Overriding one takes a little more than one theme class. Everything outside that block — the buttons, the status line, the action chrome — is as light as it looks.

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
| Arrays of plain values | Every item is an accordion whose header is the item's label — for `items: { type: 'string' }` that label is the index, so the form reads as a list of bare numbers and each field costs a click. Collapsed onto one row: badge, field, buttons. Arrays of objects keep the accordion. |

Geometry only, again — no colour, spacing or type. It is opt-in rather than part of `style.css` because it targets vanilla's class names (`.control`, `.wrapper`, `.array-list`), which are generic enough that an app may have its own; importing it is how you say you use that renderer set. Every rule is element-qualified or carries a `:has()`, so it corrects vanilla whichever order the two stylesheets load in.

**One note if you write these yourself instead:** if your stylesheet is loaded *before* `vanilla.css`, it loses every equal-specificity tie to it. Scope your form rules under one wrapper class (`.my-form .my-input`) and they win regardless of order.

## Saying something (`x-inflow-notif`)

A form has things to say that are not field values: *this is what the token is for*, *the site accepted it*, *no assignable user matches "mehdi"*, *re-authorise before this runs at 3am*. Before this key existed, a plugin author's only way to say any of them was to add a readonly `lookupStatus` string property to the schema and patch text into it — the form pretending to have a field it does not have, and the host with no way to know that this one is a message and the others are data.

`x-inflow-notif` is that vocabulary, declared **per field**:

```jsonc
{
  "type": "Control",
  "scope": "#/properties/apiToken",
  "x-inflow-notif": [
    { "severity": "help", "message": "Create one at id.atlassian.com → Security → API tokens." },
    { "display": "dialog" }
  ]
}
```

An entry with a `message` **is** a message — declared help, a standing warning — and renders as soon as the field does. An entry without one declares the **channel**: how messages that arrive at this field later want to be shown.

### The same key raises one at runtime

A meta function returns it beside the rest of its answer, and it is lifted out before the patch is applied:

```json
{
  "issueKey": "OPS-42",
  "x-inflow-notif": { "severity": "success", "message": "Issue: OPS-42 — Rotate the staging certs" }
}
```

```ts
// or, from an action
ctx.notify({ severity: 'error', display: 'dialog', message: '401 — the token was rejected.' })
ctx.notify('Connected as mehdi@acme.io')   // a bare string is the common case
```

| Field | |
|---|---|
| `message` | The text. **Empty or absent clears the channel** rather than raising a blank one. |
| `severity` | `help` · `info` · `success` · `warning` · `error`. Defaults to `info`. |
| `display` | `inline` · `banner` · `toast` · `dialog`. A *request* — see below. Defaults to the field's declared channel, else `inline`. |
| `field` | Which field it is about. Defaults to the one the action drives (`action.target`, else its own control). |
| `id` | Which channel on that field it occupies. |
| `title`, `timeout`, `dismissible` | Optional. `timeout` is ms until it clears itself. |

**Messages replace by `(field, id)`.** Press a lookup twice and the second answer supersedes the first instead of stacking under it — the behaviour every plugin author hand-rolls with a status property today. Give a field two ids when it genuinely has two live messages (a validity line *and* a quota warning).

### The host decides where it appears

```ts
onNotify(event) {
  if (event.severity === 'error') { myToasts.danger(event.message); return true }
  if (event.display === 'dialog') { myDialog.alert(event); return true }
  // returning nothing = "seen, not handled"
}
```

**Return `true` to claim a message.** That is the whole protocol. A claimed message is yours to show — as a toast, a modal, a desktop notification, a log line, whatever this platform has — and the package renders nothing for it. Return anything else and you have merely observed it: the message still appears inline at its field.

That asymmetry is deliberate. `display` is a request, not an instruction, because only the host knows what its platform can do — and a message that no host got round to wiring must not vanish. **Nothing is ever lost for want of a toast**, so implementing `onNotify` for errors only, or not at all, is a safe place to stop. A listener that *throws* is treated as one that did not claim.

Configure it app-wide in `createInflowUi`, per form with `:on-notify`, or observe the traffic without taking responsibility for it via `@notification` (an event handler cannot return a value, so it cannot claim).

### Where an unclaimed message renders

| | |
|---|---|
| At its field | When that field's control carries either Inflow key — so it has a renderer to put it under. |
| Under the form | Everything else: messages addressed to no field, and ones whose field is a plain control or was dropped by a re-rendered schema. |

Both are slottable, and both are plain by design:

```vue
<InflowForm ... :on-notify="onNotify" @notification="log">
  <template #notifications="{ notifications, dismiss }">
    <Alert v-for="n in notifications" :key="n.key" :tone="n.severity" @close="dismiss(n.key)">
      {{ n.message }}
    </Alert>
  </template>

  <template #status="{ busy, status, error }">
    <Spinner v-if="busy" />
    <Alert v-else-if="error" tone="danger">{{ error }}</Alert>
    <p v-else-if="status">{{ status }}</p>
  </template>
</InflowForm>
```

### `notify` vs `setStatus` / `setError`

They are different channels and both stay.

- `setStatus` / `setError` are the **form's own line** — "working…", and the transport failures this package raises itself (`fn` unnamed, no plugin bound, a 502). Not about any field, not routed to the host.
- `notify` is **about a field**, addressable, replaceable, and offered to the host first.

A plugin's *own* failure is still not an error in the first sense — a meta function that answers `{"error": "..."}` is patching a field called `error` into the form. Answer with `x-inflow-notif` instead; it is the difference between "the button does nothing" and "no assignable user matches 'mehdi' — is the project key right?".

Buttons disable themselves while their own action runs, and `busy` is counted, so two in flight at once don't have the first to finish clear the second's spinner.

## Exports

Component `InflowForm`; renderers `InflowControlRenderer`, `InflowLayoutRenderer`, `InflowActionButton`, `InflowNotifications`; testers `inflowControlTester`, `inflowLayoutTester`, `inflowTesters`; plugin `InflowUiPlugin`, `createInflowUi`; the built-in `pluginFn` with its name as `PLUGIN_FN`, plus `builtinActions`, `builtinActionNames` and `withBuiltinActions`; the shape helpers `isFormEnvelope`, `normalizeFormEnvelope`, `patchFor`, `applyActionResult`; the message helpers `NOTIF_KEY`, `buildNotification`, `splitNotifications`, `readNotifExtension`, `hasNotifExtension`, `notifDefaults`, `notificationKey`, `reportToConsole`; registry helpers `createInflowActionRegistry`, `resolveAction`; `createInflowFormController` and `useInflowActionContext` for building on top — plus the injection keys and all types.

Enum and `oneOf` controls are deliberately left to the host's renderer set, so the package stays loosely coupled and compatible across JSON Forms versions.

## Tests

```sh
pnpm test
```

Covers the contract that matters across hosts: the flat request body, each answer shape, a re-render surviving the next keystroke, the Go SDK's `jsonschema`/`jsonui` spelling, envelope detection staying conservative, and a host overriding `pluginFn` by name.

For messages: declared help rendering with no action fired, a field that carries only `x-inflow-notif` still reaching the renderer, the key being lifted out of a patch and out of a form envelope, an answer that is *nothing but* a message leaving the form's data alone, channels replacing rather than stacking, an empty message clearing one, and the claim protocol — including a listener that returns nothing or throws still leaving the message on screen.

## License

MIT
