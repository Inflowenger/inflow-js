import { markRaw } from 'vue'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import {
  InflowControlRenderer,
  InflowLayoutRenderer,
  inflowControlTester,
  inflowLayoutTester,
} from '@inflowenger/plugin-form-builder'

/**
 * The renderer set every page in the lab hands to `<JsonForms>`.
 *
 * markRaw is per-component and not optional: JSON Forms keeps the renderers
 * array in a reactive() context, which would otherwise wrap each component in a
 * Proxy — destabilising component identity and breaking value reflection (the
 * classic symptom is an enum <select> that never shows its own data). See the
 * Debug Enum page, which exists to prove this end of it stays fixed.
 */
export const renderers = [
  { tester: inflowControlTester, renderer: markRaw(InflowControlRenderer) },
  { tester: inflowLayoutTester, renderer: markRaw(InflowLayoutRenderer) },
  ...vanillaRenderers.map((r) => ({ tester: r.tester, renderer: markRaw(r.renderer) })),
]
