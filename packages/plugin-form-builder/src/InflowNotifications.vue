<script setup lang="ts">
import { computed, inject } from 'vue'
import type { InflowNotificationEvent } from './types'
import { InflowThemeConfigKey } from './InflowThemeConfig'
import { InflowFormControllerKey } from './InflowFormController'

/**
 * The messages this package renders itself: everything the host's listener did
 * not claim.
 *
 * Deliberately plain. It exists so that a message is never lost — a plugin's
 * only explanation of why a lookup failed has to reach the user whether or not
 * the host got round to wiring a toast — not to be a notification system. A host
 * with one of those claims its messages in `onNotify` and none of this renders.
 *
 * Styling is the two class hooks the rest of the package uses: `.inflow-notif`
 * plus a severity modifier, and the theme's `notifClass`.
 */
const props = defineProps<{
  items: InflowNotificationEvent[]
}>()

const theme = inject(InflowThemeConfigKey, {})
const controller = inject(InflowFormControllerKey, undefined)

function classesFor(item: InflowNotificationEvent): string[] {
  const classes = ['inflow-notif', `inflow-notif-${item.severity}`, `inflow-notif-${item.display}`]
  if (theme.notifClass) classes.push(theme.notifClass)
  return classes
}

/**
 * `alert` interrupts a screen reader, `status` waits for a pause. A failure the
 * user has to act on earns the interruption; a help line that was on screen
 * before they arrived never does.
 */
function roleFor(item: InflowNotificationEvent): 'alert' | 'status' {
  return item.severity === 'error' || item.severity === 'warning' ? 'alert' : 'status'
}

/** Declared help is part of the form; a message an action raised is transient. */
function isDismissible(item: InflowNotificationEvent): boolean {
  if (typeof item.dismissible === 'boolean') return item.dismissible
  return item.source !== 'schema'
}

const visible = computed(() => props.items ?? [])
</script>

<template>
  <div v-if="visible.length" class="inflow-notifications">
    <div
      v-for="item in visible"
      :key="item.key"
      :class="classesFor(item)"
      :role="roleFor(item)"
      :data-severity="item.severity"
    >
      <div class="inflow-notif-body">
        <strong v-if="item.title" class="inflow-notif-title">{{ item.title }}</strong>
        <span class="inflow-notif-message">{{ item.message }}</span>
      </div>
      <button
        v-if="controller && isDismissible(item)"
        type="button"
        class="inflow-notif-dismiss"
        :aria-label="`Dismiss: ${item.message}`"
        @click="controller.dismiss(item.key)"
      >
        ×
      </button>
    </div>
  </div>
</template>
