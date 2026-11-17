import { describe, expect, it } from 'vitest'
import { DEFAULT_RENDERER, isSandboxed, resolveRenderer } from '../src/protocol'

/**
 * `resolveRenderer` is total and biased.
 *
 * It runs on a third party's document, inside a drawer that still has to open,
 * so there is no input for which it throws and no ambiguity it resolves
 * adventurously: anything it cannot make sense of becomes the declarative
 * renderer, which every plugin also ships.
 */
describe('resolveRenderer', () => {
  it('defaults to jsonforms when the field is absent', () => {
    expect(resolveRenderer(undefined)).toEqual(DEFAULT_RENDERER)
    expect(resolveRenderer(null)).toEqual(DEFAULT_RENDERER)
  })

  it('accepts the bare-name form', () => {
    expect(resolveRenderer('jsonforms').type).toBe('jsonforms')
    // A name alone cannot start a sandbox: there is nothing to run in it.
    expect(resolveRenderer('remote').type).toBe('remote')
  })

  it('falls back for a name it does not know', () => {
    expect(resolveRenderer('webassembly-quantum' as never)).toEqual(DEFAULT_RENDERER)
  })

  it('resolves the object form', () => {
    const spec = resolveRenderer({ type: 'remote', module: '/ui.js', framework: 'vue' })
    expect(spec).toMatchObject({ type: 'remote', module: '/ui.js', framework: 'vue', height: 'auto' })
    expect(spec.timeout).toBe(10_000)
  })

  // Asking for a sandbox and then not saying what to run in it is not a request
  // that can be honoured, and an empty sandbox is worse than a form.
  it('falls back when a code renderer names neither module nor code', () => {
    expect(resolveRenderer({ type: 'remote' })).toEqual(DEFAULT_RENDERER)
    expect(resolveRenderer({ type: 'iframe', module: '   ' })).toEqual(DEFAULT_RENDERER)
  })

  it('never throws on malformed input', () => {
    const inputs: unknown[] = [[], 0, true, { type: 42 }, { type: 'remote', module: 7 }, Symbol('x')]
    for (const input of inputs) {
      expect(() => resolveRenderer(input as never)).not.toThrow()
      expect(resolveRenderer(input as never).type).toBe('jsonforms')
    }
  })

  // A plugin may restrain itself. It may not widen its reach — that is the
  // host's decision, enforced in createPolicy.
  it('keeps a narrowed element list', () => {
    expect(resolveRenderer({ type: 'remote', code: 'x', elements: ['div', 7, 'span'] }).elements)
      .toEqual(['div', 'span'])
  })

  // Credentials do not cross unless the plugin asked in so many words.
  it('withholds settings unless explicitly requested', () => {
    expect(resolveRenderer({ type: 'remote', code: 'x' }).exposeSettings).toBe(false)
    expect(resolveRenderer({ type: 'remote', code: 'x', exposeSettings: 'yes' }).exposeSettings).toBe(false)
    expect(resolveRenderer({ type: 'remote', code: 'x', exposeSettings: true }).exposeSettings).toBe(true)
  })

  it('knows which specs need a sandbox', () => {
    expect(isSandboxed(resolveRenderer('jsonforms'))).toBe(false)
    expect(isSandboxed(resolveRenderer({ type: 'remote', code: 'x' }))).toBe(true)
    expect(isSandboxed(resolveRenderer({ type: 'iframe', code: 'x' }))).toBe(true)
  })

  it('treats renderer timeout as milliseconds and rejects unusable values', () => {
    expect(resolveRenderer({ type: 'remote', code: 'x', timeout: 3000 }).timeout).toBe(3000)
    expect(resolveRenderer({ type: 'remote', code: 'x', timeout: 0 }).timeout).toBe(10_000)
    expect(resolveRenderer({ type: 'remote', code: 'x', timeout: -1 }).timeout).toBe(10_000)
    expect(resolveRenderer({ type: 'remote', code: 'x', timeout: Number.NaN }).timeout).toBe(10_000)
    expect(resolveRenderer({ type: 'remote', code: 'x', timeout: Number.POSITIVE_INFINITY }).timeout).toBe(10_000)
  })

  it('accepts only finite non-negative pixel heights', () => {
    expect(resolveRenderer({ type: 'remote', code: 'x', height: 240 }).height).toBe(240)
    expect(resolveRenderer({ type: 'remote', code: 'x', height: 'auto' }).height).toBe('auto')
    expect(resolveRenderer({ type: 'remote', code: 'x', height: -1 }).height).toBe('auto')
    expect(resolveRenderer({ type: 'remote', code: 'x', height: Number.NaN }).height).toBe('auto')
    expect(resolveRenderer({ type: 'remote', code: 'x', height: Number.POSITIVE_INFINITY }).height).toBe('auto')
  })
})
