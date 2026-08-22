import {
  rankWith,
  and,
  isControl,
  schemaMatches,
  type RankedTester,
  type UISchemaElement,
} from '@jsonforms/core'
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
 * Tester for a multi-select control: an array whose items are a fixed set
 * (`items.enum`, or `items.oneOf` of `{const,title}`).
 *
 * The vanilla set draws this as a column of checkboxes; MultiEnumControlRenderer
 * draws it as a themed combo box instead. Rank 20 clears the vanilla array
 * renderer (~3) but stays well under inflowControlTester (1000), so a field that
 * ALSO carries an `x-inflow-ui` button is still wrapped by InflowControlRenderer
 * and then re-dispatched to this renderer for the inner widget.
 *
 * Unlike the two testers above this one matches on SCHEMA SHAPE, not on an
 * Inflow tag — so it is not part of `inflowTesters` (the set filtered out when
 * InflowControlRenderer re-dispatches to the original renderer); it must survive
 * that filter so a decorated multi-enum keeps its combo box.
 */
export const multiEnumControlTester: RankedTester = rankWith(
  20,
  and(
    isControl,
    schemaMatches(
      (schema) =>
        !!schema &&
        schema.type === 'array' &&
        !!schema.items &&
        !Array.isArray(schema.items) &&
        (Array.isArray((schema.items as any).enum) || Array.isArray((schema.items as any).oneOf)),
    ),
  ),
)

/**
 * All Inflow UI testers.
 * Used to filter out Inflow renderers when delegating to original renderers.
 *
 * Note: this holds only the tag-driven wrappers (control + layout). The
 * schema-driven multiEnumControlTester is deliberately NOT here — it is a real
 * widget the inner DispatchRenderer should still be able to resolve.
 */
export const inflowTesters: RankedTester[] = [inflowControlTester, inflowLayoutTester]

/**
 * Convenience export defaulting to the control tester.
 */
export const inflowTester = inflowControlTester
