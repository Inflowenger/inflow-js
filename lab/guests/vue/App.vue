<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { GuestContext } from '@inflowenger/plugin-sandbox/guest'

/**
 * A real Vue single-file component, compiled by `@vitejs/plugin-vue`, running
 * inside the sandbox.
 *
 * This is the case the evaluation had to settle: whether a framework that
 * drives the DOM directly survives having that DOM replaced by Remote DOM's
 * polyfill. Vue's reactivity is pure JavaScript and runs anywhere; what was in
 * question is `runtime-dom`, which calls `document.createElement`,
 * `insertBefore`, `setAttribute` and `textContent` — all of which the polyfill
 * provides, and all of which become mutation records on their way to the host.
 *
 * The component carries both lab demos. With `demo.action` it renders the
 * issue-picker used by the sandbox page; with `renderer.vue.echo` it renders
 * the message field served by the renderer-smoke plugin.
 */
const props = defineProps<{ ctx: GuestContext }>()

const isSmokeAction = computed(() => props.ctx.method === 'renderer.vue.echo')

const message = ref(String((props.ctx.data as any)?.message ?? ''))
const metaResult = ref('')
const busy = ref(false)

const rows = ref<{ id: string; title: string }[]>([])
const picked = ref<string>(String((props.ctx.data as any)?.issueKey ?? ''))
const dark = ref(props.ctx.theme.dark)

const offTheme = props.ctx.onTheme((theme) => {
  dark.value = theme.dark
})
const offData = props.ctx.onData((next) => {
  message.value = String((next as any)?.message ?? '')
  picked.value = String((next as any)?.issueKey ?? '')
})
onUnmounted(() => {
  offTheme()
  offData()
})

const summary = computed(() =>
  picked.value ? `selected ${picked.value}` : 'nothing selected yet',
)

function updateMessage(event: Event) {
  const value = (event.target as HTMLInputElement).value
  message.value = value
  props.ctx.patchData({ message: value })
}

async function describe() {
  busy.value = true
  try {
    const response: any = await props.ctx.call('renderer.meta.describe.vue', {
      message: message.value,
    })
    metaResult.value = String(response?.message ?? '')
    props.ctx.notify({ severity: 'success', message: metaResult.value })
  } catch (error) {
    metaResult.value = String(error)
    props.ctx.notify({ severity: 'error', message: metaResult.value })
  } finally {
    busy.value = false
  }
}

async function load() {
  busy.value = true
  try {
    rows.value = (await props.ctx.call('issue.search', { q: '' })) as typeof rows.value
  } catch (error) {
    props.ctx.notify({ severity: 'error', message: String(error) })
  } finally {
    busy.value = false
  }
}

function pick(id: string) {
  picked.value = id
  props.ctx.patchData({ issueKey: id })
  props.ctx.notify({ severity: 'success', message: `Issue ${id} selected`, field: 'issueKey' })
}
</script>

<template>
  <div class="if-vstack">
    <p class="if-desc">
      {{
        isSmokeAction
          ? 'A Vue 3 SFC running in the renderer-smoke plugin.'
          : 'A Vue 3 SFC, compiled to JavaScript and running in a Web Worker. It has no DOM — every node below was described to the host, which built it.'
      }}
    </p>

    <template v-if="isSmokeAction">
      <div class="if-control">
        <label class="if-label" for="renderer-vue-message">Message from Vue</label>
        <input
          id="renderer-vue-message"
          class="if-input"
          type="text"
          :value="message"
          :disabled="ctx.readonly"
          data-renderer-smoke-input="message"
          @input="updateMessage"
        />
      </div>

      <div class="if-hstack">
        <button
          class="if-btn"
          type="button"
          :disabled="busy || ctx.readonly"
          data-renderer-smoke-call="describe-vue"
          @click="describe"
        >
          {{ busy ? 'Calling plugin…' : 'Call Vue plugin meta method' }}
        </button>
      </div>

      <p data-renderer-smoke-result="meta-vue">{{ metaResult }}</p>
    </template>

    <template v-else>
      <div class="if-hstack">
        <button class="if-btn" type="button" :disabled="busy" @click="load">
          {{ busy ? 'Loading…' : 'Load issues' }}
        </button>
        <span class="if-desc">{{ summary }}</span>
      </div>

      <table v-if="rows.length" class="guest-table">
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td class="guest-key">{{ row.id }}</td>
            <td>{{ row.title }}</td>
            <td>
              <button
                class="if-btn-icon"
                type="button"
                :aria-label="`Pick ${row.id}`"
                @click="pick(row.id)"
              >
                {{ picked === row.id ? '●' : '○' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <p class="if-desc">host is in {{ dark ? 'dark' : 'light' }} mode — this text follows it with no code</p>
  </div>
</template>
