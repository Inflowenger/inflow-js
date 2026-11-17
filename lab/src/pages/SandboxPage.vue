<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import { InflowForm } from '@inflowenger/plugin-form-builder'
import {
  InflowSandboxForm,
  resolveRenderer,
  type GuestNotification,
  type RendererField,
} from '@inflowenger/plugin-sandbox'

/**
 * The evaluation, as something you can click.
 *
 * One form document, served three ways. The schema, the data and the transport
 * are identical across all three — only the `renderer` field changes — so what
 * you are comparing is the renderers themselves and nothing else.
 *
 * The questions it was built to answer:
 *
 * 1. Does the host's theme reach the guest? Toggle the theme while a guest is
 *    running. `remote` follows instantly because its nodes *are* host nodes;
 *    `iframe` follows because the theme was serialised and re-injected, which
 *    you can see as a frame's worth of lag.
 * 2. Can a guest built from a real framework run under `remote`? The Vue and
 *    Preact guests are ordinary compiled bundles with their framework inlined.
 * 3. What does a guest cost? The sizes are printed below, and they are not
 *    close.
 * 4. What happens when a guest is broken? The last option serves one that
 *    throws, to show the fallback the host is obliged to render.
 */

type GuestKey = 'vanilla' | 'inline' | 'vue' | 'react' | 'preact' | 'broken'

const INLINE_GUEST = `export default function mount(ctx) {
  const text = ctx.document.createElement('p')
  text.className = 'if-desc'
  text.textContent = 'Inline code renderer works.'
  ctx.root.append(text)
}`

const GUESTS: Record<GuestKey, { label: string; module?: string; code?: string; note: string }> = {
  vanilla: {
    label: 'Plain JS',
    module: '/guests/vanilla.js',
    note: '3 kB — no framework, just DOM calls',
  },
  inline: {
    label: 'Inline code',
    code: INLINE_GUEST,
    note: 'carried inside the form document, as the smoke-test plugin serves it',
  },
  vue: {
    label: 'Vue 3 SFC',
    module: '/guests/vue.js',
    note: '132 kB — a compiled single-file component, Vue inlined',
  },
  react: {
    label: 'React',
    module: '/guests/react.js',
    note: 'hooks and createElement, React and ReactDOM inlined',
  },
  preact: {
    label: 'Preact',
    module: '/guests/preact.js',
    note: '20 kB — hooks and JSX, compiled',
  },
  broken: {
    label: 'Broken guest',
    module: '/guests/does-not-exist.js',
    note: 'deliberately missing — shows the fallback',
  },
}

const renderer = ref<'jsonforms' | 'remote' | 'iframe'>('remote')
const guest = ref<GuestKey>('vanilla')
const theme = ref<'light' | 'dark'>(
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
)

watch(
  theme,
  (value) => document.documentElement.setAttribute('data-theme', value),
  { immediate: true },
)

/** The data contract, shared by every renderer. */
const schema = {
  type: 'object',
  properties: {
    collection: { type: 'string', title: 'Collection' },
    issueKey: { type: 'string', title: 'Issue' },
    query: { type: 'string', title: 'Query' },
  },
}

const uischema = {
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/collection' },
    { type: 'Control', scope: '#/properties/issueKey' },
    { type: 'Control', scope: '#/properties/query' },
  ],
}

const data = ref<Record<string, unknown>>({ collection: 'invoices' })

/** The `renderer` field exactly as a plugin would put it on the wire. */
const rendererField = computed<RendererField>(() =>
  renderer.value === 'jsonforms'
    ? 'jsonforms'
    : {
        type: renderer.value,
        ...(GUESTS[guest.value].module ? { module: GUESTS[guest.value].module } : {}),
        ...(GUESTS[guest.value].code ? { code: GUESTS[guest.value].code } : {}),
        framework: guest.value,
        height: 'auto',
        timeout: 8000,
      },
)

const resolved = computed(() => resolveRenderer(rendererField.value))

// ---- the transport ----------------------------------------------------------

const log = ref<{ at: string; line: string }[]>([])

function record(line: string) {
  log.value = [{ at: new Date().toLocaleTimeString(), line }, ...log.value].slice(0, 20)
}

/**
 * The host's transport, faked.
 *
 * A real host routes this over NATS to the plugin and attaches the settings
 * profile on the way. What matters for the evaluation is that the guest's only
 * route outward is this function, in the host's realm, under the host's control
 * — a guest cannot reach the plugin, or anything else, except by asking here.
 */
async function call(fn: string, body?: Record<string, unknown>): Promise<unknown> {
  record(`call ${fn}(${JSON.stringify(body ?? {})})`)
  await new Promise((resolve) => setTimeout(resolve, 350))

  switch (fn) {
    case 'db.ping':
      return { ms: 12 + Math.floor(Math.random() * 30) }
    case 'issue.search':
      return [
        { id: 'OPS-42', title: 'Nightly sync times out' },
        { id: 'OPS-55', title: 'Retry backoff is linear' },
        { id: 'PLAT-7', title: 'Settings drawer scrolls behind header' },
      ]
    case 'query.explain':
      return { plan: `Seq Scan on ${body?.query || '(empty)'}\n  rows=1024 cost=0.00..18.10` }
    case 'renderer.meta.describe.vue':
      return { message: `Vue received ${String(body?.message ?? '').length} characters` }
    case 'renderer.meta.describe.react':
      return { message: `React received ${String(body?.message ?? '').length} characters` }
    default:
      throw new Error(`no such meta function: ${fn}`)
  }
}

const notifications = ref<GuestNotification[]>([])

function onNotification(notification: GuestNotification | string) {
  const value = typeof notification === 'string' ? { message: notification } : notification
  record(`notify ${value.severity ?? 'info'}: ${value.message}`)
  notifications.value = [value, ...notifications.value].slice(0, 5)
}

function onData(next: unknown) {
  data.value = (next ?? {}) as Record<string, unknown>
}

const sandboxKey = computed(() => `${renderer.value}:${guest.value}`)
const guestMethod = computed(() =>
  guest.value === 'vue' ? 'renderer.vue.echo' : 'demo.action',
)
</script>

<template>
  <section>
    <header class="page-head">
      <h1>Sandboxed renderers</h1>
      <p>
        One form document, three renderers. Only the <code>renderer</code> field differs — the
        schema, the data and the transport below are the same in every case.
      </p>
    </header>

    <div class="sandbox-controls">
      <label>
        <span>Renderer</span>
        <select v-model="renderer" class="if-input">
          <option value="jsonforms">jsonforms — declarative (the default)</option>
          <option value="remote">remote — Worker + Remote DOM</option>
          <option value="iframe">iframe — null-origin frame</option>
        </select>
      </label>

      <label v-if="renderer !== 'jsonforms'">
        <span>Guest bundle</span>
        <select v-model="guest" class="if-input">
          <option v-for="(entry, key) in GUESTS" :key="key" :value="key">
            {{ entry.label }} — {{ entry.note }}
          </option>
        </select>
      </label>

      <label>
        <span>Host theme</span>
        <select v-model="theme" class="if-input">
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </label>
    </div>

    <div class="sandbox-grid">
      <div class="sandbox-panel">
        <h2>The drawer</h2>
        <p class="if-desc">
          Styled by the lab's own stylesheet. Nothing below was given a stylesheet of its own.
        </p>

        <div class="sandbox-drawer">
          <InflowForm
            v-if="resolved.type === 'jsonforms'"
            :schema="schema as any"
            :uischema="uischema as any"
            :data="data"
            :renderers="vanillaRenderers"
            @update:data="onData"
          />

          <InflowSandboxForm
            v-else
            :key="sandboxKey"
            :renderer="rendererField"
            :schema="schema"
            :uischema="uischema"
            :data="data"
            plugin-id="lab-demo"
            :method="guestMethod"
            :call="call"
            @update:data="onData"
            @notification="onNotification"
            @error="(message) => record(`guest failed: ${message}`)"
            @ready="record('guest ready')"
          >
            <!--
              The contract a host owes a plugin: when the code renderer cannot
              run, the declarative form the plugin also shipped is drawn instead.
              A broken renderer must never make a node unconfigurable.
            -->
            <template #fallback="{ error }">
              <p class="sandbox-fallback">
                The plugin's own renderer failed, so its declarative form is shown instead.
                <br /><code>{{ error }}</code>
              </p>
              <InflowForm
                :schema="schema as any"
                :uischema="uischema as any"
                :data="data"
                :renderers="vanillaRenderers"
                @update:data="onData"
              />
            </template>
          </InflowSandboxForm>
        </div>
      </div>

      <div class="sandbox-panel">
        <h2>What the host sees</h2>

        <p class="if-desc">The node's data — written by the guest, owned by the host.</p>
        <pre class="if-code" data-testid="host-data">{{ JSON.stringify(data, null, 2) }}</pre>

        <p class="if-desc">Notifications the guest raised.</p>
        <ul v-if="notifications.length" class="sandbox-notifs">
          <li v-for="(n, i) in notifications" :key="i" :data-severity="n.severity ?? 'info'">
            <strong>{{ n.severity ?? 'info' }}</strong>
            {{ n.message }}
            <em v-if="n.field">on {{ n.field }}</em>
          </li>
        </ul>
        <p v-else class="if-desc"><em>none yet</em></p>

        <p class="if-desc">Everything that crossed the boundary.</p>
        <pre class="if-code sandbox-log">{{ log.map((l) => `${l.at}  ${l.line}`).join('\n') || 'idle' }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sandbox-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.sandbox-controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.sandbox-controls span {
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 10px;
}

.sandbox-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

@media (max-width: 1000px) {
  .sandbox-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sandbox-panel h2 {
  margin: 0 0 4px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text);
}

.sandbox-drawer {
  margin-top: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  box-shadow: var(--shadow);
}

.sandbox-fallback {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--err-bg);
  color: var(--err);
  font-size: 12px;
  line-height: 1.5;
}

.sandbox-notifs {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.sandbox-notifs li[data-severity='success'] strong { color: var(--ok); }
.sandbox-notifs li[data-severity='error'] strong { color: var(--err); }
.sandbox-notifs li[data-severity='warning'] strong { color: var(--warn); }

.sandbox-notifs em {
  color: var(--text);
  font-style: normal;
  opacity: 0.7;
}

.sandbox-log {
  max-height: 220px;
  overflow: auto;
}
</style>
