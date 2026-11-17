<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component } from 'vue'
import { RemoteRoot, type RemoteComponents } from './remoteTree'
import { createPolicy } from './policy'
import { resolveRenderer, type RendererField, type RendererSpec } from './protocol'
import { readTheme, watchTheme, type ThemeSnapshot } from './theme'
import {
  startIframeSandbox,
  startRemoteSandbox,
  type IframeSandbox,
  type RemoteSandbox,
  type SandboxSession,
} from './host'
import type { GuestNotification } from './bridge'
import { applyPatch } from './data'
import { FRAME_BOOTSTRAP } from './generated/frameBootstrap'
import { WORKER_BOOTSTRAP } from './generated/workerBootstrap'

/**
 * A plugin's dialog, drawn by the plugin's own code, inside the host's page.
 *
 * The counterpart of `<InflowForm>` from `@inflowenger/plugin-form-builder`: the
 * same inputs — a schema, some data, a way to reach the plugin — and the same
 * outputs — changed data and notifications — for a form the host cannot render
 * declaratively. A host switches between them on one field of the protocol and
 * nothing else changes around them.
 *
 * Which sandbox is used is this component's decision, not the plugin's. `remote`
 * is honoured with a Worker when the browser has one, and falls back to the
 * frame when it does not; `iframe` is honoured as asked. Either way a guest that
 * fails to start surfaces its reason and the host shows the declarative form it
 * also shipped, because a plugin whose renderer is broken must still be
 * configurable.
 */
const props = withDefaults(
  defineProps<{
    /** The `renderer` field exactly as it came off the wire. */
    renderer?: RendererField
    /** The data contract, for a guest that wants to validate what it produces. */
    schema?: Record<string, unknown>
    /** The UI schema, if any. A code renderer is free to ignore it. */
    uischema?: Record<string, unknown>
    /** The form's data. Supports `v-model:data`. */
    data?: unknown
    /** The plugin this form belongs to. */
    pluginId?: string
    /** The action being configured, or `@settings`. */
    method?: string
    /** The settings profile. Never reaches the guest unless the spec asked and
     *  this host agreed — see `exposeSettings`. */
    settings?: Record<string, unknown>
    readonly?: boolean
    /**
     * How to reach the plugin's meta functions. The same transport the
     * declarative renderer's `pluginFn` action uses, so one plugin serves both.
     */
    call?: (fn: string, body?: Record<string, unknown>) => Promise<unknown>
    /**
     * The host components a guest's `inflow-*` element names resolve to. This is
     * how a plugin's dialog ends up using the host's real button and real input
     * rather than an approximation of them.
     */
    components?: Record<string, Component>
    /**
     * Serve the guest bootstraps yourself, for a host whose CSP forbids
     * `worker-src blob:` or inline script in a frame. Each falls back to the
     * copy compiled into this package.
     */
    workerUrl?: string
    frameUrl?: string
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  (e: 'update:data', value: unknown): void
  (e: 'notification', value: GuestNotification | string): void
  (e: 'ready'): void
  (e: 'error', message: string): void
}>()

const spec = computed<RendererSpec>(() => resolveRenderer(props.renderer))

/** The element the theme is read from, so a drawer that overrides a token is
 *  what the guest sees — not the page's value for it. */
const container = ref<HTMLElement>()

const status = ref<'idle' | 'starting' | 'ready' | 'failed'>('idle')
const failure = ref('')
const height = ref<number>()
const fixedHeight = computed(() => {
  const value = spec.value.height
  return typeof value === 'number' ? value : undefined
})
const frameHeight = computed(() => fixedHeight.value ?? height.value)

const session = shallowRef<SandboxSession>()
const remote = shallowRef<RemoteSandbox>()
const frame = shallowRef<IframeSandbox>()
const frameHost = ref<HTMLElement>()

let stopThemeWatch: (() => void) | undefined
let generation = 0

/**
 * Data the guest wrote, remembered.
 *
 * Without it the `data` watcher below would echo the guest's own write straight
 * back at it: the guest patches a field, the host emits, the host's prop comes
 * back changed, and `updateData` tells the guest about a change it made itself.
 * Harmless for an idempotent guest and an infinite loop for any other.
 */
let lastFromGuest: string | undefined

const policy = computed(() => createPolicy(spec.value.elements))
const components = computed<RemoteComponents>(() => props.components ?? {})

function teardown() {
  generation += 1
  stopThemeWatch?.()
  stopThemeWatch = undefined
  session.value?.destroy()
  session.value = undefined
  remote.value = undefined
  frame.value = undefined
  height.value = undefined
}

function callbacks(ticket: number) {
  const current = () => ticket === generation

  return {
    onData(data: unknown) {
      if (!current()) return
      lastFromGuest = JSON.stringify(data)
      emit('update:data', data)
    },
    onPatch(patch: Record<string, unknown>) {
      if (!current()) return
      const next = applyPatch(props.data, patch)
      lastFromGuest = JSON.stringify(next)
      emit('update:data', next)
    },
    onNotify(notification: GuestNotification | string) {
      if (!current()) return
      emit('notification', notification)
    },
    async onCall(fn: string, body?: Record<string, unknown>) {
      if (!current()) throw new Error('this sandbox has been replaced')
      if (!props.call) throw new Error('this host has no transport to the plugin')
      return props.call(fn, body)
    },
    onReady() {
      if (!current()) return
      status.value = 'ready'
      emit('ready')
    },
    onError(message: string) {
      if (!current()) return
      teardown()
      status.value = 'failed'
      failure.value = message
      emit('error', message)
    },
    onHeight(value: number) {
      if (current()) height.value = value
    },
  }
}

async function start() {
  teardown()

  const root = container.value
  if (!root) return

  const ticket = generation
  const cb = callbacks(ticket)
  const current = spec.value
  if (current.type === 'jsonforms') {
    // Nothing to start. The host renders the declarative form instead; this
    // component should not have been mounted, and saying so is more useful than
    // rendering an empty box.
    status.value = 'failed'
    failure.value = 'this form asks for the declarative renderer'
    return
  }

  status.value = 'starting'
  failure.value = ''

  const options = {
    spec: current,
    pluginId: props.pluginId,
    method: props.method,
    schema: props.schema,
    uischema: props.uischema,
    data: props.data,
    settings: props.settings,
    readonly: props.readonly,
    themeRoot: root,
    callbacks: cb,
  }

  // `remote` needs a Worker. Where there is none — an ancient browser, a CSP
  // that forbids `worker-src blob:` — the frame is used instead rather than the
  // dialog failing: a plugin asked for isolation, and the frame is isolation.
  const useWorker = current.type === 'remote' && typeof Worker !== 'undefined'

  if (useWorker) {
    try {
      const started = startRemoteSandbox(
        options,
        props.workerUrl ? { url: props.workerUrl } : { source: WORKER_BOOTSTRAP },
      )
      remote.value = started
      session.value = started
    } catch {
      // Constructing a Worker can fail synchronously under CSP, before the
      // host's error listener can report it. The frame is the same guest API.
    }
  }

  if (!session.value) {
    let started: IframeSandbox
    try {
      started = startIframeSandbox(
        options,
        props.frameUrl ? { url: props.frameUrl } : { source: FRAME_BOOTSTRAP },
      )
    } catch (error) {
      cb.onError(error instanceof Error ? error.message : String(error))
      return
    }
    frame.value = started
    session.value = started

    /**
     * The frame is appended after a tick, and only then.
     *
     * Two orderings have to hold at once. The session must exist before the
     * frame is in the document, because a `srcdoc` frame starts loading the
     * moment it is attached and its `hello` would otherwise arrive before the
     * host was listening. And the element it is appended *to* only exists after
     * Vue has rendered it — `start()` runs from a watcher, so on the render
     * that first selects this renderer the `ref` is still empty. Appending
     * synchronously there silently does nothing, and the drawer sits on
     * "Loading…" forever with no error anywhere.
     */
    await nextTick()
    if (ticket !== generation) {
      started.destroy()
      return
    }
    if (!frameHost.value) {
      cb.onError('the sandbox has nowhere to put its frame')
      return
    }
    frameHost.value.replaceChildren(started.iframe)
  }

  if (ticket === generation) {
    stopThemeWatch = watchTheme(root, (theme: ThemeSnapshot) => {
      if (ticket === generation) session.value?.updateTheme(theme)
    })
  }
}

watch(
  () => [spec.value, props.pluginId, props.method] as const,
  () => void start(),
  { immediate: false },
)

let containerStartHandled = false
function startFromContainer() {
  if (!container.value || containerStartHandled) return
  containerStartHandled = true
  void start()
}

watch(container, startFromContainer)
onMounted(startFromContainer)

watch(
  () => props.data,
  (value) => {
    if (JSON.stringify(value) === lastFromGuest) return
    session.value?.updateData(value)
  },
  { deep: true },
)

onBeforeUnmount(teardown)

defineExpose({
  /** The current theme as the guest sees it — useful in tests and devtools. */
  theme: () => (container.value ? readTheme(container.value) : undefined),
  restart: start,
})
</script>

<template>
  <div
    ref="container"
    class="inflow-sandbox"
    :data-renderer="spec.type"
    :data-framework="spec.framework"
    :data-status="status"
  >
    <!--
      The remote renderer's output goes *here*, as ordinary children of this
      element in this document. That is the whole reason it inherits the theme:
      there is no boundary between these nodes and the drawer around it.
      A replaced session means a replaced receiver; remount so every tree
      subscription belongs to the receiver currently being rendered.
    -->
    <RemoteRoot
      v-if="remote"
      :key="generation"
      :receiver="remote.receiver"
      :policy="policy"
      :components="components"
    />

    <!-- The frame renderer's output goes into a document of its own, which is
         why it needs a box, a height, and a theme shipped in by hand. -->
    <div
      v-if="spec.type === 'iframe' || (spec.type === 'remote' && frame)"
      ref="frameHost"
      class="inflow-sandbox-frame"
      :style="frameHeight !== undefined ? { height: `${frameHeight}px` } : undefined"
    />

    <slot v-if="status === 'starting'" name="loading">
      <p class="inflow-sandbox-status">Loading the plugin's interface…</p>
    </slot>

    <!--
      A guest that failed. The host is expected to render the plugin's
      declarative form in this slot — every plugin ships one, and a dialog that
      cannot be drawn must not become a node that cannot be configured.
    -->
    <slot v-if="status === 'failed'" name="fallback" :error="failure">
      <p class="inflow-sandbox-error">{{ failure }}</p>
    </slot>
  </div>
</template>
