/**
 * ReactDOM expects a browser-style CSSStyleDeclaration on every element and
 * probes it while the module is being imported. Remote DOM's polyfill does not
 * implement CSSOM; it carries a `style` *attribute*, which is the safe host
 * boundary this sandbox wants. This shim bridges the two without weakening the
 * host: style writes are recorded here and mirrored to the ordinary `style`
 * attribute, where they pass through the existing sanitizer.
 */

type RemoteElement = {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

function createStyleDeclaration(element: RemoteElement) {
  const values = new Map<string, string>()

  const sync = () => {
    const cssText = serialize()
    if (cssText) element.setAttribute('style', cssText)
    else element.removeAttribute('style')
  }

  const parse = (cssText: string) => {
    values.clear()
    for (const declaration of cssText.split(';')) {
      const separator = declaration.indexOf(':')
      if (separator < 0) continue
      const name = declaration.slice(0, separator).trim()
      const value = declaration.slice(separator + 1).trim()
      if (name && value) values.set(name, value)
    }
  }

  const serialize = () =>
    [...values].map(([name, value]) => `${name}: ${value}`).join('; ')

  const target = {
    setProperty(name: string, value: string) {
      values.set(String(name), String(value))
      sync()
    },
    removeProperty(name: string) {
      values.delete(String(name))
      sync()
    },
    getPropertyValue(name: string) {
      return values.get(String(name)) ?? ''
    },
  }

  return new Proxy(target, {
    get(current, property) {
      if (property === 'cssText') return serialize()
      if (property in current) return current[property as keyof typeof current]
      return undefined
    },
    set(current, property, value) {
      if (property === 'cssText') parse(String(value))
      else values.set(String(property), String(value))
      sync()
      return true
    },
    // ReactDOM uses `in` only to detect vendor-prefixed animation events. The
    // neutral answer is true: an unstyled remote element supports no special
    // vendor prefix, and React then uses the standard event name.
    has: () => true,
  })
}

// ReactDOM walks active-element ownership with `element instanceof
// view.HTMLIFrameElement`. Remote DOM intentionally provides no iframe class;
// an inert constructor gives `instanceof` a valid right-hand side while every
// real iframe element remains outside the host policy.
const inertIFrameElement = function HTMLIFrameElement() {}
const windowObject = (globalThis as any).window ?? globalThis
windowObject.HTMLIFrameElement ??= inertIFrameElement
;(globalThis as any).HTMLIFrameElement ??= inertIFrameElement

const elementPrototype = (globalThis as any).Element?.prototype
  ?? (globalThis as any).HTMLElement?.prototype

if (elementPrototype && !('style' in elementPrototype)) {
  Object.defineProperty(elementPrototype, 'style', {
    configurable: true,
    get(this: RemoteElement) {
      const store = this as RemoteElement & { __inflowStyle?: ReturnType<typeof createStyleDeclaration> }
      store.__inflowStyle ??= createStyleDeclaration(this)
      return store.__inflowStyle
    },
  })
}
