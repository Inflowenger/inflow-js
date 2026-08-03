import { rankWith, and, isControl, type RankedTester, type UISchemaElement } from '@jsonforms/core'
import { hasNotifExtension } from './notifications'

/**
 * Whether an element carries either Inflow extension — something to *do*
 * (`x-inflow-ui`) or something to *say* (`x-inflow-notif`).
 *
 * Both, because they are independent: a field may declare a help line and a
 * verification channel without ever growing a button, and one that has a button
 * usually has somewhere for its answers to land. Matching either is what keeps
 * either one usable on its own.
 */
function hasInflowExtension(uischema: UISchemaElement): boolean {
  if (!uischema || typeof uischema !== 'object') return false
  if ('x-inflow-ui' in uischema && !!uischema['x-inflow-ui']) return true
  return hasNotifExtension(uischema)
}

/**
 * Custom layout type check.
 * Covers VerticalLayout, HorizontalLayout, Group, Category, and Categorization.
 */
function isLayoutType(uischema: UISchemaElement): boolean {
  const layoutTypes = ['VerticalLayout', 'HorizontalLayout', 'Group', 'Category', 'Categorization']
  return layoutTypes.includes(uischema.type)
}

/**
 * Tester for control elements carrying an Inflow extension.
 * Rank 1000 ensures it takes precedence over default renderers.
 */
export const inflowControlTester: RankedTester = rankWith(
  1000,
  and(isControl, hasInflowExtension)
)

/**
 * Tester for layout elements carrying an Inflow extension.
 * Rank 1000 ensures it takes precedence over default renderers.
 */
export const inflowLayoutTester: RankedTester = rankWith(
  1000,
  and(isLayoutType, hasInflowExtension)
)

/**
 * All Inflow UI testers.
 * Used to filter out Inflow renderers when delegating to original renderers.
 *
 * Note: Inflow only registers renderers that are strictly opt-in via the
 * `x-inflow-ui` / `x-inflow-notif` tags. Enum and oneOf controls are
 * intentionally left to the host's renderer set (e.g. vanilla) so the package
 * stays loosely coupled and compatible across JSON Forms versions.
 */
export const inflowTesters: RankedTester[] = [inflowControlTester, inflowLayoutTester]

/**
 * Convenience export defaulting to the control tester.
 */
export const inflowTester = inflowControlTester
