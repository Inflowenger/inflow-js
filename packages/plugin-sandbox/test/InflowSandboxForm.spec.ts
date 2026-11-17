import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import InflowSandboxForm from '../src/InflowSandboxForm.vue'
import { startIframeSandbox, startRemoteSandbox } from '../src/host'

vi.mock('../src/host', () => ({
  startRemoteSandbox: vi.fn(),
  startIframeSandbox: vi.fn(),
}))

const remoteSandbox = vi.fn(() => ({
  receiver: { connection: {} },
  updateData: vi.fn(),
  updateTheme: vi.fn(),
  destroy: vi.fn(),
}))

const iframeSandbox = vi.fn(() => ({
  iframe: document.createElement('iframe'),
  updateData: vi.fn(),
  updateTheme: vi.fn(),
  destroy: vi.fn(),
}))

function callbacksForStart(index: number) {
  return vi.mocked(startIframeSandbox).mock.calls[index]![0].callbacks
}

function mountSandbox(renderer: unknown) {
  return mount(InflowSandboxForm, {
    props: {
      renderer,
      schema: { type: 'object', properties: { message: { type: 'string' } } },
      data: { message: 'hello' },
    },
  })
}

describe('InflowSandboxForm lifecycle', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.mocked(startRemoteSandbox).mockImplementation(remoteSandbox)
    vi.mocked(startIframeSandbox).mockImplementation(iframeSandbox)
  })

  it('leaves starting when the current guest reports ready', async () => {
    const wrapper = mountSandbox({ type: 'remote', module: '/guest.js' })
    await flushPromises()

    callbacksForStart(0).onReady()
    await nextTick()

    expect(wrapper.get('.inflow-sandbox').attributes('data-status')).toBe('ready')
    expect(wrapper.find('.inflow-sandbox-status').exists()).toBe(false)
    expect(wrapper.emitted('ready')).toHaveLength(1)
  })

  it('ignores callbacks from a sandbox that has been replaced', async () => {
    const wrapper = mountSandbox({ type: 'remote', module: '/first.js' })
    await flushPromises()

    await wrapper.setProps({ renderer: { type: 'remote', module: '/second.js' } })
    await flushPromises()

    callbacksForStart(0).onReady()
    callbacksForStart(0).onHeight(500)
    await nextTick()
    expect(wrapper.get('.inflow-sandbox').attributes('data-status')).toBe('starting')
    expect(wrapper.find('.inflow-sandbox-frame').attributes('style')).toBeUndefined()

    callbacksForStart(1).onReady()
    await nextTick()
    expect(wrapper.get('.inflow-sandbox').attributes('data-status')).toBe('ready')
  })

  it('treats a guest failure as terminal and renders the fallback', async () => {
    const wrapper = mountSandbox({ type: 'remote', module: '/guest.js' })
    const withFallback = mount(InflowSandboxForm, {
      props: { renderer: { type: 'remote', module: '/guest.js' } },
      slots: { fallback: '<p class="fallback-stub">fallback</p>' },
    })
    await flushPromises()

    callbacksForStart(0).onError('broken guest')
    callbacksForStart(1).onError('broken guest')
    await nextTick()

    expect(wrapper.emitted('error')).toEqual([['broken guest']])
    expect(wrapper.get('.inflow-sandbox').attributes('data-status')).toBe('failed')
    expect(withFallback.find('.fallback-stub').exists()).toBe(true)
    expect(withFallback.find('.inflow-sandbox-status').exists()).toBe(false)

    callbacksForStart(1).onReady()
    await nextTick()
    expect(withFallback.get('.inflow-sandbox').attributes('data-status')).toBe('failed')
  })

  it('falls back to a frame when a Worker cannot be constructed and applies a fixed height', async () => {
    vi.stubGlobal('Worker', class Worker {
      constructor() {
        throw new Error('worker-src blocked')
      }
    })
    vi.mocked(startRemoteSandbox).mockImplementation(() => {
      throw new Error('worker-src blocked')
    })

    const wrapper = mountSandbox({ type: 'remote', module: '/guest.js', height: 240 })
    await flushPromises()

    expect(vi.mocked(startIframeSandbox)).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.inflow-sandbox-frame').attributes('style')).toContain('height: 240px')
    expect(wrapper.find('.inflow-sandbox-frame iframe').exists()).toBe(true)
  })
})
