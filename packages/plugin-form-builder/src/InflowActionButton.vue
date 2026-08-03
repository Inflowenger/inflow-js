<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import type { InflowButtonConfig, InflowActionConfig, InflowActionContext } from './types'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowActionRegistryKey, resolveAction } from './InflowActionRegistry'
import { InflowFormControllerKey } from './InflowFormController'

const props = defineProps<{
  button: InflowButtonConfig
  action?: InflowActionConfig
  context: InflowActionContext
}>()

const theme = inject(InflowThemeConfigKey, {})
const registry = inject(InflowActionRegistryKey, {})
const controller = inject(InflowFormControllerKey, undefined)

/** This button's own in-flight state, so it disables itself without disabling the others. */
const busy = ref(false)

const buttonClasses = computed(() => {
  const classes = [
    'inflow-action',
    'inflow-action-button',
    `inflow-position-${props.button.position || 'append'}`
  ]

  if (busy.value) {
    classes.push('inflow-action-busy')
  }

  if (props.button.icon && !props.button.label) {
    classes.push(theme.iconButtonClass || 'inflow-icon-button')
  } else {
    classes.push(theme.buttonClass || 'inflow-button')
  }

  return classes
})

const iconClasses = computed(() => {
  return ['inflow-action-icon']
})

const label = computed(() => {
  if (busy.value && props.button.busyLabel) return props.button.busyLabel
  return props.button.label
})

async function handleClick() {
  if (!props.action || busy.value) return

  const actionFn = resolveAction(registry, props.action.name)
  if (!actionFn) {
    // Inert rather than fatal: a schema can only ever reach a function the app
    // handed the plugin, so an unknown name has to be survivable. It is still
    // worth reporting — an unregistered name is the single most common reason a
    // plugin author's button "does nothing". setError routes it to the form's
    // status line, or to the console when there is nowhere to show it.
    props.context.setError(
      `Action "${props.action.name}" is not registered — the button does nothing.`,
    )
    return
  }

  busy.value = true
  try {
    // Counted at the form level too, so the form's own status line knows
    // something is in flight without every button re-deriving it.
    await (controller ? controller.runBusy(async () => actionFn(props.context)) : actionFn(props.context))
  } catch (error) {
    props.context.setError(`${props.action.name}: ${(error as Error).message}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    type="button"
    :class="buttonClasses"
    :disabled="busy"
    :aria-busy="busy || undefined"
    @click="handleClick"
  >
    <span v-if="button.icon" :class="iconClasses" aria-hidden="true">
      {{ button.icon }}
    </span>
    <span v-if="label">{{ label }}</span>
  </button>
</template>
