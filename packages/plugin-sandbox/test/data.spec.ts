import { describe, expect, it } from 'vitest'
import { applyPatch } from '../src/data'

describe('applyPatch', () => {
  it('writes leaves without replacing their parents', () => {
    const before = { connection: { host: 'a', port: 5432, secure: true } }
    const after = applyPatch(before, { 'connection.host': 'b' })

    expect(after).toEqual({ connection: { host: 'b', port: 5432, secure: true } })
    // The whole reason the convention is leaf paths: a nested object would
    // have dropped port and secure.
    expect(before.connection.host).toBe('a')
  })

  it('creates missing intermediate objects', () => {
    expect(applyPatch({}, { 'a.b.c': 1 })).toEqual({ a: { b: { c: 1 } } })
  })

  it('replaces a non-object standing where a parent is needed', () => {
    expect(applyPatch({ a: 'scalar' }, { 'a.b': 1 })).toEqual({ a: { b: 1 } })
  })

  it('starts from an object when the data is not one', () => {
    expect(applyPatch(undefined, { x: 1 })).toEqual({ x: 1 })
    expect(applyPatch('nonsense', { x: 1 })).toEqual({ x: 1 })
  })

  // The guest is sandboxed. The data it sends is not.
  it('refuses to walk onto Object.prototype', () => {
    const result = applyPatch({}, { '__proto__.polluted': 'yes' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it('ignores an empty path', () => {
    expect(applyPatch({ a: 1 }, { '': 2 })).toEqual({ a: 1 })
  })
})
