import './inflow-ui.css'

export * from './types'
export * from './InflowThemeConfig'
export * from './InflowActionRegistry'
export * from './inflowTester'
export * from './InflowUiPlugin'
export { default as InflowControlRenderer } from './InflowControlRenderer.vue'
export { default as InflowLayoutRenderer } from './InflowLayoutRenderer.vue'
export { default as InflowActionButton } from './InflowActionButton.vue'
export { default as InflowOneOfRenderer } from './InflowOneOfRenderer.vue'
export { default as InflowEnumRenderer } from './InflowEnumRenderer.vue'

import { rankWith, isOneOfControl } from '@jsonforms/core'

export const inflowOneOfTester = rankWith(4, isOneOfControl)
