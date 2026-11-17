import { describe, expect, it } from 'vitest'
import {
  allowsElement,
  allowsProperty,
  createPolicy,
  isSafeValue,
  sanitizeStyle,
  sanitizeUrl,
} from '../src/policy'

const policy = createPolicy()

describe('element policy', () => {
  it('allows the structural and form vocabulary', () => {
    for (const name of ['div', 'button', 'input', 'table', 'svg', 'inflow-button']) {
      expect(allowsElement(policy, name), name).toBe(true)
    }
  })

  // Everything that loads or executes something, plus the one that can
  // navigate the host page.
  it('refuses anything that loads, executes or navigates', () => {
    for (const name of ['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'form', 'template']) {
      expect(allowsElement(policy, name), name).toBe(false)
    }
  })

  it('lets a plugin narrow its own list but never widen it', () => {
    const narrowed = createPolicy(['div', 'span', 'script', 'iframe'])
    expect(allowsElement(narrowed, 'div')).toBe(true)
    expect(allowsElement(narrowed, 'button')).toBe(false)
    // Named by the plugin, still refused: the host's list is the ceiling.
    expect(allowsElement(narrowed, 'script')).toBe(false)
    expect(allowsElement(narrowed, 'iframe')).toBe(false)
  })
})

describe('property policy', () => {
  it('allows ordinary attributes', () => {
    for (const name of ['class', 'id', 'value', 'placeholder', 'aria-label', 'data-x']) {
      expect(allowsProperty(policy, name), name).toBe(true)
    }
  })

  it('refuses the markup-injection surface', () => {
    for (const name of ['innerHTML', 'outerHTML', 'dangerouslySetInnerHTML', 'srcdoc', 'insertAdjacentHTML']) {
      expect(allowsProperty(policy, name), name).toBe(false)
    }
  })

  it('refuses the prototype-pollution surface', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(allowsProperty(policy, name), name).toBe(false)
    }
  })

  // An `onclick` *string* is compiled by the browser into a handler running in
  // the host's realm. Real listeners travel on their own channel.
  it('refuses inline event handlers', () => {
    for (const name of ['onclick', 'onerror', 'onLoad', 'onmouseover']) {
      expect(allowsProperty(policy, name), name).toBe(false)
    }
  })

  it('refuses navigation attributes', () => {
    for (const name of ['action', 'formaction', 'target', 'ping']) {
      expect(allowsProperty(policy, name), name).toBe(false)
    }
  })
})

describe('sanitizeUrl', () => {
  it('passes ordinary schemes', () => {
    expect(sanitizeUrl('href', 'https://example.com/x')).toBe('https://example.com/x')
    expect(sanitizeUrl('href', 'mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(sanitizeUrl('src', '/local/thing.png')).toBe('/local/thing.png')
  })

  it('drops javascript: however it is spelled', () => {
    for (const value of ['javascript:alert(1)', '  JavaScript:alert(1)', 'JaVaScRiPt:alert(1)']) {
      expect(sanitizeUrl('href', value), value).toBeUndefined()
    }
  })

  it('drops data: on a navigable element but keeps inline images', () => {
    expect(sanitizeUrl('href', 'data:text/html;base64,PHNjcmlwdD4=')).toBeUndefined()
    expect(sanitizeUrl('src', 'data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('leaves non-URL attributes alone', () => {
    expect(sanitizeUrl('class', 'javascript:whatever')).toBe('javascript:whatever')
  })
})

describe('sanitizeStyle', () => {
  it('strips the constructs that turn CSS back into script', () => {
    const cleaned = sanitizeStyle('width: expression(alert(1)); background: url(javascript:alert(2))')
    expect(cleaned).not.toMatch(/expression\s*\(/i)
    expect(cleaned).not.toMatch(/javascript:/i)
  })

  it('leaves ordinary declarations intact', () => {
    expect(sanitizeStyle('color: var(--accent); margin: 4px')).toBe('color: var(--accent); margin: 4px')
  })
})

describe('isSafeValue', () => {
  it('accepts plain data', () => {
    expect(isSafeValue({ a: 1, b: [1, 'two', { c: null }] })).toBe(true)
    expect(isSafeValue('text')).toBe(true)
    expect(isSafeValue(null)).toBe(true)
  })

  // Preact treats an object whose constructor resolves to undefined as a
  // virtual node — a shape that survives postMessage and no real data has.
  it('refuses a null-prototype object anywhere in the value', () => {
    expect(isSafeValue(Object.create(null))).toBe(false)
    expect(isSafeValue({ nested: { deeper: Object.create(null) } })).toBe(false)
    expect(isSafeValue([Object.create(null)])).toBe(false)
  })

  it('refuses a value that is too deep to vet', () => {
    let deep: Record<string, unknown> = {}
    const root = deep
    for (let i = 0; i < 30; i += 1) {
      const next = {}
      deep.next = next
      deep = next as Record<string, unknown>
    }
    expect(isSafeValue(root)).toBe(false)
  })
})
