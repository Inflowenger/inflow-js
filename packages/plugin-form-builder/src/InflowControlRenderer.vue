<script setup lang="ts">
import { computed, inject, onUnmounted, watch } from 'vue'
import { rendererProps, useJsonFormsControl, DispatchRenderer } from '@jsonforms/vue'
import type { ControlElement } from '@jsonforms/core'
import type { InflowNotificationEvent, InflowUiExtension } from './types'
import { inflowControlTester, inflowLayoutTester } from './inflowTester'
import InflowActionButton from './InflowActionButton.vue'
import InflowNotifications from './InflowNotifications.vue'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowFormControllerKey } from './InflowFormController'
import { buildNotification, readNotifExtension } from './notifications'
import { useInflowActionContext, type InflowScope } from './useInflowActionContext'

const props = defineProps(rendererProps<ControlElement>())

const { control } = useJsonFormsControl(props)
const theme = inject(InflowThemeConfigKey, {})
const controller = inject(InflowFormControllerKey, undefined)

const inflowUi = computed<InflowUiExtension | undefined>(() => {
  return (control.value.uischema as any)['x-inflow-ui']
})

// Drop Inflow's own testers so the inner DispatchRenderer resolves the original
// (vanilla) renderer for this control instead of recursing back into us.
const filteredRenderers = computed(() => {
  return (control.value.renderers || []).filter(
    (r) => r.tester !== inflowControlTester && r.tester !== inflowLayoutTester
  )
})

const scope = computed<InflowScope>(() => ({
  data: control.value.data,
  schema: control.value.schema,
  uischema: control.value.uischema,
  path: control.value.path,
}))

const actionContext = useInflowActionContext(scope)

// ---- Messages ---------------------------------------------------------------

/**
 * Tell the form that this field is showing its own messages, so the list under
 * the form leaves them here. Watched rather than done once on mount because a
 * plugin's answer can replace the whole document, and a control that comes back
 * at a different path would otherwise claim the old one for ever.
 */
watch(
  () => control.value.path,
  (path, previous) => {
    if (previous) controller?.releaseField(previous)
    controller?.claimField(path)
  },
  { immediate: true },
)

onUnmounted(() => controller?.releaseField(control.value.path))

/**
 * What the schema itself says about this field — help, a standing warning.
 * Rendered straight from the UI schema rather than pushed into the controller on
 * mount: it is a property of the form, not an event, and putting it in the live
 * list would have it survive the form that declared it.
 */
const declared = computed<InflowNotificationEvent[]>(() =>
  readNotifExtension(control.value.uischema)
    .map((entry) =>
      buildNotification(entry, { field: control.value.path, source: 'schema' }),
    )
    .filter((event) => !!event.message),
)

/** What has since been said about it — a lookup's answer, a failure. */
const raised = computed<InflowNotificationEvent[]>(
  () => controller?.notifications.value.filter((event) => event.field === control.value.path) ?? [],
)

const notifications = computed(() => [...declared.value, ...raised.value])

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

      <!--
        Re-dispatch the ORIGINAL control by forwarding the props we received
        (props.path / props.schema / props.uischema …), NOT the computed
        control.* values. A control composes its data path as
        composeWithUi(uischema, path) = path + its own scope. control.path is
        already the fully-composed path, so passing it here would compose the
        scope a second time (e.g. connection.protocol -> connection.protocol.
        connection.protocol), making the inner control read undefined and, for
        an enum, render a blank <select>. Forwarding props.path keeps the inner
        control identical to how JSON Forms would render it un-wrapped.
      -->
      <DispatchRenderer
        :schema="props.schema"
        :uischema="props.uischema"
        :path="props.path"
        :enabled="props.enabled"
        :renderers="filteredRenderers"
        :cells="props.cells"
        :config="props.config"
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

    <!--
      What there is to say about this field, under it. Sits after the control in
      the DOM and before the `below` button, which orders itself last anyway —
      a message about a value belongs against the value, not under the button.
    -->
    <InflowNotifications :items="notifications" />

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
