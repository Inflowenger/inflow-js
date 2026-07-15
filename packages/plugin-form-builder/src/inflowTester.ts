import { rankWith, and, isControl, type RankedTester, type UISchemaElement } from '@jsonforms/core'

/**
 * Check whether a UI schema element has x-inflow-ui defined.
 */
function hasInflowUi(uischema: UISchemaElement): boolean {
  return (
    !!uischema &&
    typeof uischema === 'object' &&
    'x-inflow-ui' in uischema &&
    !!uischema['x-inflow-ui']
  )
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
 * Tester for control elements with x-inflow-ui.
 * Rank 1000 ensures it takes precedence over default renderers.
 */
export const inflowControlTester: RankedTester = rankWith(
  1000,
  and(isControl, hasInflowUi)
)

/**
 * Tester for layout elements with x-inflow-ui.
 * Rank 1000 ensures it takes precedence over default renderers.
 */
export const inflowLayoutTester: RankedTester = rankWith(
  1000,
  and(isLayoutType, hasInflowUi)
)

/**
 * All Inflow UI testers.
 * Used to filter out Inflow renderers when delegating to original renderers.
 *
 * Note: Inflow only registers renderers that are strictly opt-in via the
 * `x-inflow-ui` tag. Enum and oneOf controls are intentionally left to the
 * host's renderer set (e.g. vanilla) so the package stays loosely coupled and
 * compatible across JSON Forms versions.
 */
export const inflowTesters: RankedTester[] = [inflowControlTester, inflowLayoutTester]

/**
 * Convenience export defaulting to the control tester.
 */
export const inflowTester = inflowControlTester
