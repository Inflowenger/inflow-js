<script setup lang="ts">
import { computed, inject } from 'vue'
import { rendererProps, useJsonFormsControl, DispatchRenderer } from '@jsonforms/vue'
import type { ControlElement } from '@jsonforms/core'
import type { InflowUiExtension, InflowActionContext } from './types'
import { inflowControlTester, inflowLayoutTester } from './inflowTester'
import InflowActionButton from './InflowActionButton.vue'
import { InflowThemeConfigKey } from './InflowThemeConfig'

const props = defineProps(rendererProps<ControlElement>())

const { control, handleChange } = useJsonFormsControl(props)
const theme = inject(InflowThemeConfigKey, {})

const inflowUi = computed<InflowUiExtension | undefined>(() => {
  return (control.value.uischema as any)['x-inflow-ui']
})

const filteredRenderers = computed(() => {
  return (control.value.renderers || []).filter(
    (r) => r.tester !== inflowControlTester && r.tester !== inflowLayoutTester
  )
})

const actionContext = computed<InflowActionContext>(() => {
  return {
    data: control.value.data,
    schema: control.value.schema,
    uischema: control.value.uischema,
    path: control.value.path,
    updateData: (patch: Record<string, any>) => {
      Object.entries(patch).forEach(([path, value]) => {
        handleChange(path, value)
      })
    },
    updateSchema: () => {
      console.warn('[Inflow UI] updateSchema is not yet fully implemented')
    },
    updateUiSchema: () => {
      console.warn('[Inflow UI] updateUiSchema is not yet fully implemented')
    },
    refresh: async () => {
      // Vue reactivity handles updates automatically
    }
  }
})

const containerClasses = computed(() => {
  const classes = ['inflow-ui',
    'inflow-control'
  ]
  if (theme.containerClass) {
    classes.push(theme.containerClass)
  }
  return classes
})
</script>

<template>
  <div :class="containerClasses">
    <!-- Above decorations -->
    <template v-if="inflowUi?.button?.position === 'above'">
      <InflowActionButton
        :button="inflowUi.button"
        :action="inflowUi.action"
        :context="actionContext"
      />
    </template>

    <div class="inflow-control-inner">
      <!-- Prepend decorations -->
      <template v-if="inflowUi?.button?.position === 'prepend'">
        <InflowActionButton
          :button="inflowUi.button"
          :action="inflowUi.action"
          :context="actionContext"
        />
      </template>

      <!-- Original JSON Forms control -->
      <DispatchRenderer
        :schema="control.rootSchema"
        :uischema="control.uischema"
        :path="control.path"
        :enabled="control.enabled"
        :readonly="control.readonly"
        :renderers="filteredRenderers"
        :cells="control.cells"
        :config="control.config"
      />

      <!-- Append decorations -->
      <template v-if="inflowUi?.button?.position === 'append'">
        <InflowActionButton
          :button="inflowUi.button"
          :action="inflowUi.action"
          :context="actionContext"
        />
      </template>
    </div>

    <!-- Below decorations -->
    <template v-if="inflowUi?.button?.position === 'below'">
      <InflowActionButton
        :button="inflowUi.button"
        :action="inflowUi.action"
        :context="actionContext"
      />
    </template>
  </div>
</template>
