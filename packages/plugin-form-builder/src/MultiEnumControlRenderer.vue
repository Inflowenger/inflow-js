<script setup lang="ts">
/**
 * A multi-select combo box for an array whose items are a fixed set — `type:
 * "array"` with `items.enum` (or `items.oneOf` of `{const,title}`).
 *
 * The vanilla renderer set draws that schema as a column of checkboxes, which
 * reads as a wall of controls and inherits none of the form's input styling. A
 * plugin cannot change that from the wire — it only ships JSON Schema — so the
 * widget has to live here, in the renderer set, where it is reused by every
 * host and every plugin field of this shape.
 *
 * It is a combo box, not a native `<select multiple>`: a trigger showing the
 * chosen values as chips, a drop-down of toggleable options, click-outside to
 * close. Colours come entirely from the `--inflow-*` variables the host sets
 * (see inflow-ui.css), so it matches the themed `<select>` beside it.
 */
import { computed, ref, onBeforeUnmount } from 'vue'
import { rendererProps, useJsonFormsControl } from '@jsonforms/vue'
import type { ControlElement } from '@jsonforms/core'

const props = defineProps(rendererProps<ControlElement>())
const { control, handleChange } = useJsonFormsControl(props)

type Option = { value: string; label: string }

// Options from items.enum (value == label) or items.oneOf ({const,title}).
const options = computed<Option[]>(() => {
  const items = (control.value.schema as any)?.items
  if (!items || Array.isArray(items)) return []
  if (Array.isArray(items.enum)) {
    return items.enum.map((v: unknown) => ({ value: String(v), label: String(v) }))
  }
  if (Array.isArray(items.oneOf)) {
    return items.oneOf.map((o: any) => ({
      value: String(o?.const ?? ''),
      label: String(o?.title ?? o?.const ?? ''),
    }))
  }
  return []
})

const selected = computed<string[]>(() =>
  Array.isArray(control.value.data) ? control.value.data.map(String) : [],
)

const enabled = computed(() => control.value.enabled !== false)

const label = computed(() => {
  const l = control.value.label
  return typeof l === 'string' ? l : ''
})
const required = computed(() => control.value.required === true)
const description = computed(() => (control.value.schema as any)?.description ?? '')

const labelFor = (value: string) => options.value.find((o) => o.value === value)?.label ?? value

function commit(next: string[]) {
  // Keep the declared order of the enum so the stored value is stable.
  const order = options.value.map((o) => o.value)
  const sorted = [...next].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  handleChange(control.value.path, sorted)
}

function toggle(value: string) {
  if (!enabled.value) return
  const set = new Set(selected.value)
  set.has(value) ? set.delete(value) : set.add(value)
  commit([...set])
}

function remove(value: string) {
  if (!enabled.value) return
  commit(selected.value.filter((v) => v !== value))
}

// ---- open / close -----------------------------------------------------------

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
function toggleOpen() {
  if (!enabled.value) return
  open.value = !open.value
  if (open.value) document.addEventListener('click', onDocClick, true)
}
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true))
</script>

<template>
  <div ref="rootEl" class="inflow-oneof-control inflow-multienum" :class="{ 'inflow-multienum-disabled': !enabled }">
    <label v-if="label" class="inflow-oneof-label">
      {{ label }}<span v-if="required" class="inflow-required">*</span>
    </label>

    <!-- Trigger: chips of what is chosen, or a placeholder -->
    <button
      type="button"
      class="inflow-oneof-select inflow-multienum-trigger"
      :aria-expanded="open"
      :disabled="!enabled"
      @click.stop="toggleOpen"
    >
      <span v-if="selected.length === 0" class="inflow-multienum-placeholder">Select…</span>
      <span v-else class="inflow-multienum-chips">
        <span v-for="v in selected" :key="v" class="inflow-multienum-chip">
          {{ labelFor(v) }}
          <span
            v-if="enabled"
            class="inflow-multienum-chip-x"
            role="button"
            :aria-label="`Remove ${labelFor(v)}`"
            @click.stop="remove(v)"
            >×</span
          >
        </span>
      </span>
      <span class="inflow-multienum-caret" aria-hidden="true">▾</span>
    </button>

    <!-- Panel: the toggleable options -->
    <div v-if="open" class="inflow-multienum-panel" role="listbox" aria-multiselectable="true">
      <div
        v-for="o in options"
        :key="o.value"
        class="inflow-multienum-option"
        role="option"
        :aria-selected="selected.includes(o.value)"
        @click.stop="toggle(o.value)"
      >
        <span class="inflow-multienum-mark">{{ selected.includes(o.value) ? '✓' : '' }}</span>
        <span class="inflow-multienum-optlabel">{{ o.label }}</span>
      </div>
      <div v-if="options.length === 0" class="inflow-multienum-empty">No options</div>
    </div>

    <p v-if="description" class="inflow-multienum-desc">{{ description }}</p>
  </div>
</template>
