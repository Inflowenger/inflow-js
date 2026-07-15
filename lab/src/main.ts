import { createApp } from 'vue'
import './style.css'
import '@jsonforms/vue-vanilla/vanilla.css'
import '@inflowenger/plugin-form-builder/style.css'
import { mergeStyles, defaultStyles } from '@jsonforms/vue-vanilla'
import { InflowUiPlugin, createInflowUi } from '@inflowenger/plugin-form-builder'
import App from './App.vue'
import router from './router'
import { logAction } from './lab/actionLog'

const app = createApp(App)
app.use(router)

// Token-based theme for the vanilla JSON Forms widgets. Only class names live
// here; the look lives in style.css and uses the lab's design tokens, so forms
// follow the theme (dark mode included) and plugin-form-builder keeps shipping
// no opinions about anyone's design system. mergeStyles keeps the structural
// vanilla classes and appends ours.
app.provide(
  'styles',
  mergeStyles(defaultStyles, {
    control: {
      root: 'if-control',
      label: 'if-label',
      input: 'if-input',
      select: 'if-input',
      textarea: 'if-input',
      error: 'if-error',
      description: 'if-desc',
    },
    verticalLayout: { root: 'if-vstack' },
    horizontalLayout: { root: 'if-hstack', item: 'if-hstack-item' },
    group: { root: 'if-group', label: 'if-group-label' },
    arrayList: { root: 'if-array', addButton: 'if-btn', label: 'if-group-label' },
    // The "clear data?" confirm shown when switching a oneOf with existing data
    // is a native <dialog> baked into vanilla's OneOfRenderer. It cannot be
    // disabled through config, only styled.
    dialog: {
      root: 'if-dialog',
      title: 'if-dialog-title',
      body: 'if-dialog-body',
      actions: 'if-dialog-actions',
      buttonPrimary: 'if-btn',
      buttonSecondary: 'if-btn-secondary',
    },
  }),
)

// The whole action registry the lab's schemas are allowed to call by name. A
// schema naming anything outside this object is inert, which is the security
// property worth seeing: `x-inflow-ui` can never reach a function you didn't
// hand the plugin. Every action reports to the on-screen action log so the
// contract is observable without opening devtools.
app.use(
  InflowUiPlugin,
  createInflowUi({
    theme: {
      containerClass: 'if-inflow-field',
      buttonClass: 'if-btn',
      iconButtonClass: 'if-btn-icon',
    },
    actions: {
      /** Does nothing on purpose — proves the button/wrapper renders alone. */
      noop(ctx) {
        logAction({ action: 'noop', path: ctx.path, saw: ctx.data, note: 'no effect by design' })
      },

      /**
       * Writes leaf paths, not objects. `{ connection: { host } }` would
       * *replace* connection and discard port and secure — patch leaves.
       */
      async refreshForm(ctx) {
        const patch = {
          'connection.protocol': 'wss',
          'connection.host': 'api22.example.com',
        }
        ctx.updateData(patch)
        logAction({ action: 'refreshForm', path: ctx.path, saw: ctx.data, wrote: patch })
        await ctx.refresh?.()
      },

      /**
       * The shape of a cascade: read the control the button sits on, call a
       * service, write the result somewhere else in the form. Effects go
       * through updateData — the action contract returns void, so an action
       * that computes a value and returns it silently does nothing.
       */
      async loadLabels(ctx) {
        const labels = await new Promise<string[]>((resolve) =>
          setTimeout(() => resolve(['bug', 'feature', 'urgent']), 300),
        )
        ctx.updateData({ labels })
        logAction({
          action: 'loadLabels',
          path: ctx.path,
          saw: ctx.data,
          wrote: { labels },
          note: 'service call faked with a 300ms delay',
        })
      },
    },
  }),
)

app.mount('#app')
