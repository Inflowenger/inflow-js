<script setup lang="ts">
import { computed, inject } from 'vue'
import { rendererProps, useJsonFormsLayout, DispatchRenderer, useDispatch } from '@jsonforms/vue'
import type { Layout } from '@jsonforms/core'
import type { InflowUiExtension, InflowActionContext } from './types'
import { inflowControlTester, inflowLayoutTester } from './inflowTester'
import InflowActionButton from './InflowActionButton.vue'
import { InflowThemeConfigKey } from './InflowThemeConfig'

const props = defineProps(rendererProps<Layout>())

const { layout } = useJsonFormsLayout(props)
const dispatch = useDispatch()
const theme = inject(InflowThemeConfigKey, {})

const inflowUi = computed<InflowUiExtension | undefined>(() => {
  return (layout.value.uischema as any)['x-inflow-ui']
})

const filteredRenderers = computed(() => {
  return (layout.value.renderers || []).filter(
    (r) => r.tester !== inflowControlTester && r.tester !== inflowLayoutTester
  )
})

const actionContext = computed<InflowActionContext>(() => {
  const handleChange = (path: string, value: any) => {
    dispatch({
      type: 'UPDATE_DATA',
      path,
      updater: () => value
    } as any)
  }

  return {
    data: layout.value.data,
    schema: layout.value.schema,
    uischema: layout.value.uischema,
    path: layout.value.path,
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
    'inflow-layout'
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

    <div class="inflow-layout-inner">
      <!-- Prepend decorations -->
      <template v-if="inflowUi?.button?.position === 'prepend'">
        <InflowActionButton
          :button="inflowUi.button"
          :action="inflowUi.action"
          :context="actionContext"
        />
      </template>

      <!-- Original JSON Forms layout -->
      <DispatchRenderer
        :schema="layout.schema"
        :uischema="layout.uischema"
        :path="layout.path"
        :enabled="layout.enabled"
        :readonly="layout.readonly"
        :renderers="filteredRenderers"
        :cells="layout.cells"
        :config="layout.config"
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
