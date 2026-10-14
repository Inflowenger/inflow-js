import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import InflowForm from '../src/InflowForm.vue'
import type { InflowPluginCall } from '../src/types'

/**
 * The multi-select's DOM is a layout contract, not an implementation detail:
 * inflow-ui.css promotes this control's rows into the decorated grid so a
 * lookup button sits beside the TRIGGER, and it recognises the control by that
 * structure. Move the panel out of `.inflow-oneof-field`, or let the
 * description slip inside it, and the stylesheet silently stops matching — the
 * button drops a row and the drop-down anchors to the drawer. Nothing else
 * would catch that, so it is pinned here.
 */

const schema = {
  type: 'object',
  properties: {
    tools: {
      type: 'array',
      title: 'Tools',
      description: 'The tools Claude may use.',
      uniqueItems: true,
      items: {
        type: 'string',
        oneOf: [
          { const: 'Read', title: 'Read — open a file' },
          { const: 'Bash', title: 'Bash — run a command' },
        ],
      },
    },
  },
} as const

const decorated = {
  type: 'VerticalLayout',
  elements: [
    {
      type: 'Control',
      scope: '#/properties/tools',
      'x-inflow-ui': {
        action: { name: 'pluginFn', fn: 'claude.meta.tools' },
        button: { position: 'append', label: 'Refresh from host' },
      },
    },
  ],
} as const

const plain = {
  type: 'VerticalLayout',
  elements: [{ type: 'Control', scope: '#/properties/tools' }],
} as const

function mountForm(uischema: unknown, data: Record<string, unknown> = {}, call?: InflowPluginCall) {
  return mount(InflowForm, {
    props: {
      schema: schema as any,
      uischema: uischema as any,
      data,
      renderers: vanillaRenderers,
      pluginId: 'claude',
      call: call ?? (vi.fn(async () => ({})) as InflowPluginCall),
    },
  })
}

describe('the multi-select renders as the stylesheet expects', () => {
  it('keeps the trigger and the panel in the field box, and the description out of it', async () => {
    const wrapper = mountForm(plain)
    const field = wrapper.get('.inflow-oneof-field')

    // The trigger shares a box with the panel it anchors: that box is what
    // carries `position: relative` once the control's own root is promoted away.
    expect(field.find('button.inflow-multienum-trigger').exists()).toBe(true)
    await field.get('button.inflow-multienum-trigger').trigger('click')
    expect(field.find('.inflow-multienum-panel').exists()).toBe(true)

    // The description is a row of its own, not part of the trigger's row —
    // the whole reason the button used to sit against it.
    const root = wrapper.get('.inflow-oneof-control')
    const children = Array.from(root.element.children).map((el) => el.className)
    expect(children).toEqual([
      'inflow-oneof-label',
      'inflow-oneof-field',
      'inflow-multienum-desc',
    ])
  })

  it('puts the lookup button beside the control, not inside it', () => {
    const wrapper = mountForm(decorated)
    const inner = wrapper.get('.inflow-control-inner')

    // Both are direct children of the grid: the stylesheet places the control's
    // promoted rows in column 2 and the button in column 3, on row 2. A button
    // nested inside the control could not be placed at all.
    const kinds = Array.from(inner.element.children).map((el) => el.className)
    expect(kinds.some((c) => c.includes('inflow-oneof-control'))).toBe(true)
    expect(kinds.some((c) => c.includes('inflow-position-append'))).toBe(true)
    expect(inner.get('.inflow-oneof-control').find('.inflow-action').exists()).toBe(false)

    // And the selector the stylesheet promotes with reaches this markup. The
    // rules are pure CSS, so this is the only place the two can be checked
    // against each other at all.
    expect(
      inner.element.matches(':has(> .inflow-oneof-control > .inflow-oneof-field)'),
    ).toBe(true)
  })

  it('still selects, deselects and keeps the declared order', async () => {
    const wrapper = mountForm(decorated, { tools: ['Bash'] })
    await wrapper.get('button.inflow-multienum-trigger').trigger('click')

    const options = wrapper.findAll('.inflow-multienum-option')
    await options[0].trigger('click') // Read, declared before Bash
    await flushPromises()

    const emitted = wrapper.emitted('update:data') as [Record<string, unknown>][]
    expect(emitted.at(-1)![0].tools).toEqual(['Read', 'Bash'])
  })
})
