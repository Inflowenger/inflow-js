<script setup lang="ts">
import { computed, inject } from 'vue'
import type { InflowButtonConfig, InflowActionConfig, InflowActionContext } from './types'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowActionRegistryKey, resolveAction } from './InflowActionRegistry'

const props = defineProps<{
  button: InflowButtonConfig
  action?: InflowActionConfig
  context: InflowActionContext
}>()

const theme = inject(InflowThemeConfigKey, {})
const registry = inject(InflowActionRegistryKey, {})

const buttonClasses = computed(() => {
  const classes = [
    'inflow-action',
    'inflow-action-button',
    `inflow-position-${props.button.position || 'append'}`
  ]

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

async function handleClick() {
  if (!props.action) return

  const actionFn = resolveAction(registry, props.action.name)
  if (!actionFn) {
    console.warn(`[Inflow UI] Action "${props.action.name}" not found in registry`)
    return
  }

  try {
    await actionFn(props.context)
  } catch (error) {
    console.error(`[Inflow UI] Action "${props.action.name}" failed:`, error)
  }
}
</script>

<template>
  <button
    type="button"
    :class="buttonClasses"
    @click="handleClick"
  >
    <span v-if="button.icon" :class="iconClasses" aria-hidden="true">
      {{ button.icon }}
    </span>
    <span v-if="button.label">{{ button.label }}</span>
  </button>
</template>
