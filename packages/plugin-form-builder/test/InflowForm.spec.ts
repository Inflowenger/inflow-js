import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import InflowForm from '../src/InflowForm.vue'
import { isFormEnvelope, normalizeFormEnvelope } from '../src/formEnvelope'
import type { InflowPluginCall } from '../src/types'

/**
 * The contract these cover is the one the platform docs describe: a plugin's UI
 * schema names `pluginFn`, the host supplies only a transport, and the answer is
 * applied by shape — including the shape that replaces the form.
 */

const schema = {
  type: 'object',
  properties: {
    projectKey: { type: 'string', title: 'Project' },
    projectName: { type: 'string', title: 'Project name' },
    status: { type: 'string', title: 'Status' },
  },
} as const

const uischema = {
  type: 'VerticalLayout',
  elements: [
    {
      type: 'Control',
      scope: '#/properties/projectKey',
      'x-inflow-ui': {
        action: { name: 'pluginFn', fn: 'jira.meta.projects.resolve' },
        button: { position: 'append', label: 'Find' },
      },
    },
    { type: 'Control', scope: '#/properties/projectName' },
    { type: 'Control', scope: '#/properties/status' },
  ],
} as const

function mountForm(call: InflowPluginCall, data: Record<string, unknown> = { projectKey: 'OP' }) {
  return mount(InflowForm, {
    props: {
      schema: schema as any,
      uischema: uischema as any,
      data,
      renderers: vanillaRenderers,
      pluginId: 'jira',
      settings: { baseUrl: 'https://acme.atlassian.net' },
      call,
    },
  })
}

describe('pluginFn ships built in', () => {
  it('calls the plugin with a flat body and patches an object answer', async () => {
    const call = vi.fn(async () => ({ projectKey: 'OPS', projectName: 'Operations' }))
    const wrapper = mountForm(call)

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(call).toHaveBeenCalledTimes(1)
    const request = call.mock.calls[0][0] as any
    expect(request.pluginId).toBe('jira')
    expect(request.fn).toBe('jira.meta.projects.resolve')
    // Flat: the form's own fields at the top level, plus settings and value.
    expect(request.body).toMatchObject({
      projectKey: 'OP',
      settings: { baseUrl: 'https://acme.atlassian.net' },
      value: 'OP',
    })
    expect(request.body._registry).toBeUndefined()
    expect(request.body.body).toBeUndefined()

    const emitted = wrapper.emitted('update:data')
    expect(emitted).toBeTruthy()
    expect(emitted!.at(-1)![0]).toMatchObject({ projectKey: 'OPS', projectName: 'Operations' })
  })

  it('writes a non-object answer to the button\'s own control', async () => {
    const wrapper = mountForm(async () => 'OPS')

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:data')!.at(-1)![0]).toMatchObject({ projectKey: 'OPS' })
  })

  it('honours action.target for a non-object answer', async () => {
    const targeted = JSON.parse(JSON.stringify(uischema))
    targeted.elements[0]['x-inflow-ui'].action.target = 'projectName'

    const wrapper = mount(InflowForm, {
      props: {
        schema: schema as any,
        uischema: targeted,
        data: { projectKey: 'OP' },
        renderers: vanillaRenderers,
        pluginId: 'jira',
        call: async () => 'Operations',
      },
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:data')!.at(-1)![0]).toMatchObject({
      projectKey: 'OP',
      projectName: 'Operations',
    })
  })

  it('reports rather than fails silently when nothing can be reached', async () => {
    const wrapper = mount(InflowForm, {
      props: {
        schema: schema as any,
        uischema: uischema as any,
        data: {},
        renderers: vanillaRenderers,
        call: async () => ({}),
      },
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.get('.inflow-form-error').text()).toContain('not bound to a running plugin')
  })

  it('surfaces a transport failure', async () => {
    const wrapper = mountForm(async () => {
      throw new Error('502 Bad Gateway')
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.get('.inflow-form-error').text()).toContain('502 Bad Gateway')
  })

  it('lets a host override the built-in by name', async () => {
    const call = vi.fn(async () => ({}))
    const mine = vi.fn()
    const wrapper = mount(InflowForm, {
      props: {
        schema: schema as any,
        uischema: uischema as any,
        data: {},
        renderers: vanillaRenderers,
        pluginId: 'jira',
        call,
        actions: { pluginFn: mine },
      },
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(mine).toHaveBeenCalledTimes(1)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('an answer carrying a form re-renders it', () => {
  const nextForm = {
    schema: {
      type: 'object',
      properties: {
        issueType: { type: 'string', title: 'Issue type', enum: ['Bug', 'Task'] },
      },
    },
    uischema: {
      type: 'VerticalLayout',
      elements: [{ type: 'Control', scope: '#/properties/issueType' }],
    },
    data: { issueType: 'Task' },
  }

  it('replaces schema, uischema and data', async () => {
    const wrapper = mountForm(async () => nextForm)

    expect(wrapper.html()).toContain('Project')
    expect(wrapper.html()).not.toContain('Issue type')

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    // The field the new schema describes is on screen; the old one is gone.
    expect(wrapper.html()).toContain('Issue type')
    expect(wrapper.html()).not.toContain('Project name')
    // Including the enum the old schema could not express — the case the
    // platform docs listed as impossible. Vanilla renders an option's text as a
    // `label` attribute rather than a child node, so read the value.
    expect(wrapper.findAll('option').map((o) => o.attributes('value'))).toContain('Bug')
    expect(wrapper.emitted('update:form')).toBeTruthy()
  })

  it('survives the next edit, rather than reverting to the host\'s props', async () => {
    const wrapper = mountForm(async () => nextForm)

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    // Editing round-trips data back through the host, which is what used to
    // rebuild JSON Forms' core from the original props and lose the new schema.
    const select = wrapper.get('select')
    await select.setValue('Bug')
    await flushPromises()

    expect(wrapper.html()).toContain('Issue type')
    expect(wrapper.html()).not.toContain('Project name')
  })

  it('accepts the Go SDK spelling, with schemas as JSON text', async () => {
    const wrapper = mountForm(async () => ({
      jsonschema: JSON.stringify(nextForm.schema),
      jsonui: JSON.stringify(nextForm.uischema),
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('Issue type')
  })
})

describe('envelope detection stays conservative', () => {
  it('treats a patch that merely mentions schema as a patch', () => {
    expect(isFormEnvelope({ projectKey: 'OPS', schema: 'public' })).toBe(false)
  })

  it('needs at least one schema to be an envelope', () => {
    expect(isFormEnvelope({ data: { a: 1 } })).toBe(false)
    expect(isFormEnvelope({ schema: { type: 'object' } })).toBe(true)
    expect(isFormEnvelope({ uischema: { type: 'VerticalLayout' } })).toBe(true)
  })

  it('is not fooled by arrays or empty objects', () => {
    expect(isFormEnvelope([{ schema: {} }])).toBe(false)
    expect(isFormEnvelope({})).toBe(false)
  })

  it('distinguishes an absent data key from an explicit null', () => {
    expect(normalizeFormEnvelope({ schema: { type: 'object' } }).hasData).toBe(false)
    expect(normalizeFormEnvelope({ schema: { type: 'object' }, data: null }).hasData).toBe(true)
  })

  it('leaves unparseable JSON text alone rather than throwing', () => {
    expect(normalizeFormEnvelope({ jsonschema: 'not json' }).schema).toBeUndefined()
  })
})

describe('a patch that would have been silently dropped', () => {
  it('never mistakes an array answer for a patch', async () => {
    const withLabels = JSON.parse(JSON.stringify(uischema))
    withLabels.elements[0]['x-inflow-ui'].action.target = 'labels'

    const wrapper = mount(InflowForm, {
      props: {
        schema: {
          type: 'object',
          properties: {
            projectKey: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
          },
        } as any,
        uischema: withLabels,
        data: { projectKey: 'OP' },
        renderers: vanillaRenderers,
        pluginId: 'jira',
        call: async () => ['bug', 'regression'],
      },
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:data')!.at(-1)![0]).toMatchObject({
      labels: ['bug', 'regression'],
    })
  })

  it('leaves the form alone when a meta function answers nothing', async () => {
    const wrapper = mountForm(async () => null)

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:data')).toBeFalsy()
  })
})
