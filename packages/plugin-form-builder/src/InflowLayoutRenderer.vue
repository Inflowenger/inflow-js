<script setup lang="ts">
import { computed, inject, onUnmounted, watch } from 'vue'
import { rendererProps, useJsonFormsLayout, DispatchRenderer } from '@jsonforms/vue'
import type { Layout } from '@jsonforms/core'
import type { InflowNotificationEvent, InflowUiExtension } from './types'
import { inflowControlTester, inflowLayoutTester } from './inflowTester'
import InflowActionButton from './InflowActionButton.vue'
import InflowNotifications from './InflowNotifications.vue'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowFormControllerKey } from './InflowFormController'
import { buildNotification, readNotifExtension } from './notifications'
import { useInflowActionContext, type InflowScope } from './useInflowActionContext'

const props = defineProps(rendererProps<Layout>())

const { layout } = useJsonFormsLayout(props)
const theme = inject(InflowThemeConfigKey, {})
const controller = inject(InflowFormControllerKey, undefined)

const inflowUi = computed<InflowUiExtension | undefined>(() => {
  return (layout.value.uischema as any)['x-inflow-ui']
})

const filteredRenderers = computed(() => {
  return (layout.value.renderers || []).filter(
    (r) => r.tester !== inflowControlTester && r.tester !== inflowLayoutTester
  )
})

const scope = computed<InflowScope>(() => ({
  data: layout.value.data,
  schema: layout.value.schema,
  uischema: layout.value.uischema,
  path: layout.value.path,
}))

const actionContext = useInflowActionContext(scope)

// ---- Messages ---------------------------------------------------------------

/**
 * A layout's own path is the empty string at the root, which belongs to no
 * field — so only a nested layout (a Group over an object property) claims one.
 * The root's messages are the form's, and `<InflowForm>` renders those.
 */
watch(
  () => layout.value.path,
  (path, previous) => {
    if (previous) controller?.releaseField(previous)
    if (path) controller?.claimField(path)
  },
  { immediate: true },
)

onUnmounted(() => controller?.releaseField(layout.value.path))

/** A banner declared over a whole group — "these fields need Cloud credentials". */
const declared = computed<InflowNotificationEvent[]>(() =>
  readNotifExtension(layout.value.uischema)
    .map((entry) => buildNotification(entry, { field: layout.value.path, source: 'schema' }))
    .filter((event) => !!event.message),
)

const raised = computed<InflowNotificationEvent[]>(() => {
  const path = layout.value.path
  if (!path) return []
  return controller?.notifications.value.filter((event) => event.field === path) ?? []
})

const notifications = computed(() => [...declared.value, ...raised.value])

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
    <!-- What there is to say about this group, above the fields it is about. -->
    <InflowNotifications :items="notifications" />

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
