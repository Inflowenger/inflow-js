import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { vanillaRenderers } from '@jsonforms/vue-vanilla'
import InflowForm from '../src/InflowForm.vue'
import { isFormEnvelope } from '../src/formEnvelope'
import { buildNotification, notifDefaults, splitNotifications } from '../src/notifications'
import type { InflowNotificationEvent, InflowPluginCall } from '../src/types'

/**
 * The `x-inflow-notif` contract: one vocabulary for what a form has to say,
 * declared in the schema or raised by a meta function, shown at the field it is
 * about — and offered to the host first, so a platform with a toast or a dialog
 * can take it.
 */

const schema = {
  type: 'object',
  properties: {
    apiToken: { type: 'string', title: 'API token' },
    projectKey: { type: 'string', title: 'Project' },
  },
} as const

const uischema = {
  type: 'VerticalLayout',
  elements: [
    {
      type: 'Control',
      scope: '#/properties/apiToken',
      'x-inflow-ui': {
        action: { name: 'pluginFn', fn: 'jira.meta.ping.check' },
        button: { position: 'append', label: 'Test connection' },
      },
      'x-inflow-notif': {
        severity: 'help',
        message: 'Create one at id.atlassian.com → Security.',
      },
    },
    { type: 'Control', scope: '#/properties/projectKey' },
  ],
} as const

function mountForm(call: InflowPluginCall, extra: Record<string, unknown> = {}) {
  return mount(InflowForm, {
    props: {
      schema: schema as any,
      uischema: uischema as any,
      data: { apiToken: 'secret' },
      renderers: vanillaRenderers,
      pluginId: 'jira',
      call,
      ...extra,
    },
  })
}

describe('a field declares what can be said about it', () => {
  it('renders declared help without any action being fired', () => {
    const wrapper = mountForm(async () => null)

    const notif = wrapper.get('.inflow-notif')
    expect(notif.text()).toContain('id.atlassian.com')
    expect(notif.classes()).toContain('inflow-notif-help')
  })

  it('renders a field that declares only messages, with no button', () => {
    const wrapper = mount(InflowForm, {
      props: {
        schema: schema as any,
        uischema: {
          type: 'VerticalLayout',
          elements: [
            {
              type: 'Control',
              scope: '#/properties/projectKey',
              'x-inflow-notif': { severity: 'warning', message: 'Read-only on this site.' },
            },
          ],
        } as any,
        data: {},
        renderers: vanillaRenderers,
      },
    })

    // The tester has to match on the message extension alone — a field with
    // something to say need not also have something to do.
    expect(wrapper.get('.inflow-notif-warning').text()).toContain('Read-only on this site.')
    expect(wrapper.find('button.inflow-action-button').exists()).toBe(false)
  })

  it('lends its display to messages raised later, but never its severity', () => {
    const defaults = notifDefaults({
      type: 'Control',
      'x-inflow-notif': [
        { severity: 'help', message: 'Help text.' },
        { display: 'dialog', timeout: 4000 },
      ],
    } as any)

    expect(defaults).toEqual({ display: 'dialog', timeout: 4000 })
  })
})

describe('a meta function raises one alongside its answer', () => {
  it('patches the fields and shows the message at the field', async () => {
    const wrapper = mountForm(async () => ({
      projectKey: 'OPS',
      'x-inflow-notif': { severity: 'success', message: 'Connected as mehdi@acme.io' },
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:data')!.at(-1)![0]).toMatchObject({ projectKey: 'OPS' })
    expect(wrapper.get('.inflow-notif-success').text()).toContain('Connected as mehdi@acme.io')
    // The message key never reaches the form's data.
    expect(wrapper.emitted('update:data')!.at(-1)![0]).not.toHaveProperty('x-inflow-notif')
  })

  it('leaves the form alone when the answer is nothing but a message', async () => {
    const wrapper = mountForm(async () => ({
      'x-inflow-notif': { severity: 'error', message: '401 — the token was rejected.' },
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    // An empty remainder must not be written to the button's own control, or
    // pressing "Test connection" would blank the token it just tested.
    expect(wrapper.emitted('update:data')).toBeFalsy()
    expect(wrapper.get('.inflow-notif-error').text()).toContain('401')
  })

  it('rides along with a whole new form', async () => {
    const wrapper = mountForm(async () => ({
      schema: {
        type: 'object',
        properties: { issueKey: { type: 'string', title: 'Issue', enum: ['A-1', 'A-2'] } },
      },
      uischema: {
        type: 'VerticalLayout',
        elements: [{ type: 'Control', scope: '#/properties/issueKey' }],
      },
      data: {},
      'x-inflow-notif': { message: '2 issues — pick one.' },
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('Issue')
    // The field it was addressed to is gone with the old schema, so it collects
    // under the form rather than disappearing with it.
    expect(wrapper.text()).toContain('2 issues — pick one.')
  })

  it('replaces the previous answer on the same channel instead of stacking', async () => {
    let n = 0
    const wrapper = mountForm(async () => ({
      'x-inflow-notif': { message: `attempt ${++n}` },
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()
    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    const raised = wrapper.findAll('.inflow-notif').filter((n) => n.text().includes('attempt'))
    expect(raised).toHaveLength(1)
    expect(raised[0].text()).toContain('attempt 2')
  })

  it('clears a channel with an empty message', async () => {
    const answers = [
      { 'x-inflow-notif': { message: 'No such project.' } },
      { 'x-inflow-notif': { message: '' } },
    ]
    const wrapper = mountForm(async () => answers.shift())

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('No such project.')

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('No such project.')
  })

  it('accepts several at once', async () => {
    const wrapper = mountForm(async () => ({
      'x-inflow-notif': [
        { id: 'auth', severity: 'success', message: 'Token accepted.' },
        { id: 'quota', severity: 'warning', message: 'Rate limit at 90%.' },
      ],
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.get('.inflow-notif-success').text()).toContain('Token accepted.')
    expect(wrapper.get('.inflow-notif-warning').text()).toContain('Rate limit at 90%.')
  })

  it('addresses the field the button drives, not the one it sits on', async () => {
    const targeted = JSON.parse(JSON.stringify(uischema))
    targeted.elements[0]['x-inflow-ui'].action.target = 'projectKey'
    targeted.elements[1]['x-inflow-notif'] = { display: 'inline' }

    const wrapper = mount(InflowForm, {
      props: {
        schema: schema as any,
        uischema: targeted,
        data: {},
        renderers: vanillaRenderers,
        pluginId: 'jira',
        call: async () => ({ 'x-inflow-notif': { message: 'Project: Operations' } }),
      },
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    const notified = wrapper.emitted('notification')!.at(-1)![0] as InflowNotificationEvent
    expect(notified.field).toBe('projectKey')
  })
})

describe('the host decides where a message is shown', () => {
  it('offers every message to the listener', async () => {
    const onNotify = vi.fn()
    const wrapper = mountForm(
      async () => ({ 'x-inflow-notif': { display: 'dialog', message: 'Re-authorise.' } }),
      { onNotify },
    )

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(onNotify).toHaveBeenCalledTimes(1)
    const event = onNotify.mock.calls[0][0] as InflowNotificationEvent
    expect(event).toMatchObject({
      message: 'Re-authorise.',
      display: 'dialog',
      severity: 'info',
      field: 'apiToken',
      source: 'action',
    })
  })

  it('renders it inline anyway when the listener does not claim it', async () => {
    const wrapper = mountForm(async () => ({ 'x-inflow-notif': { message: 'Re-authorise.' } }), {
      onNotify: () => undefined,
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    // A host that only logs must not be a host that swallows.
    expect(wrapper.text()).toContain('Re-authorise.')
  })

  it('renders nothing for a message the listener claimed', async () => {
    const wrapper = mountForm(async () => ({ 'x-inflow-notif': { message: 'Re-authorise.' } }), {
      onNotify: () => true,
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Re-authorise.')
    // The declared help is untouched — it was never offered, it is part of the form.
    expect(wrapper.text()).toContain('id.atlassian.com')
  })

  it('falls back to inline when the listener throws', async () => {
    const wrapper = mountForm(async () => ({ 'x-inflow-notif': { message: 'Re-authorise.' } }), {
      onNotify: () => {
        throw new Error('toast library not loaded')
      },
    })

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Re-authorise.')
  })

  it('emits every message for a template-side listener', async () => {
    const wrapper = mountForm(async () => ({ 'x-inflow-notif': { message: 'Done.' } }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('notification')).toHaveLength(1)
  })
})

describe('a message with nowhere to go', () => {
  it('collects under the form when its field has no Inflow renderer', async () => {
    const wrapper = mountForm(async () => ({
      'x-inflow-notif': { field: 'projectKey', message: 'Unknown project.' },
    }))

    await wrapper.get('button.inflow-action-button').trigger('click')
    await flushPromises()

    // projectKey is a plain control — it never reaches the Inflow renderer, so
    // the form-level list is what keeps the message on screen.
    expect(wrapper.get('.inflow-form > .inflow-notifications').text()).toContain('Unknown project.')
  })
})

describe('shape helpers', () => {
  it('splits the message key out of an answer', () => {
    const { notifications, rest } = splitNotifications({
      projectKey: 'OPS',
      'x-inflow-notif': { message: 'Found.' },
    })

    expect(notifications).toEqual([{ message: 'Found.' }])
    expect(rest).toEqual({ projectKey: 'OPS' })
  })

  it('leaves an answer without one untouched', () => {
    expect(splitNotifications({ projectKey: 'OPS' })).toEqual({
      notifications: [],
      rest: { projectKey: 'OPS' },
    })
    expect(splitNotifications('OPS')).toEqual({ notifications: [], rest: 'OPS' })
  })

  it('does not let the message key disqualify an envelope', () => {
    expect(isFormEnvelope({ schema: { type: 'object' }, 'x-inflow-notif': { message: 'Hi' } })).toBe(
      true,
    )
  })

  it('keys a message by field and id, so channels replace independently', () => {
    const a = buildNotification({ message: 'one' }, { field: 'apiToken' })
    const b = buildNotification({ message: 'two' }, { field: 'apiToken' })
    const c = buildNotification({ id: 'quota', message: 'three' }, { field: 'apiToken' })

    expect(a.key).toBe(b.key)
    expect(a.key).not.toBe(c.key)
  })

  it('takes a bare string', () => {
    expect(buildNotification('Saved.')).toMatchObject({
      message: 'Saved.',
      severity: 'info',
      display: 'inline',
    })
  })
})
