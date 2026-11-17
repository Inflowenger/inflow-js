/**
 * Applying a patch to a form's data.
 *
 * Shared between the host and the guest, and it has to be, because both apply
 * the same patch to their own copy: the host because it owns the value the node
 * is saved with, the guest because `ctx.data` would otherwise go stale the
 * moment it wrote to it.
 *
 * That second half is easy to miss. The host suppresses the echo of a guest's
 * own write — otherwise a guest that patches on every keystroke is told about
 * each keystroke it just made, which for anything that re-renders from `ctx.data`
 * is a loop. But suppressing the echo means the guest never hears about its own
 * change either, so it has to make it locally. One function, applied on both
 * sides, is what keeps the two copies the same.
 */

/**
 * A patch keyed by absolute leaf path → the new data object.
 *
 * Leaf paths, not nested objects: `{'connection.host': 'x'}` writes one field,
 * where `{connection: {host: 'x'}}` would replace the whole `connection` object
 * and silently drop its siblings. This is the same convention `x-inflow-ui`
 * actions already use, so a plugin author meets it once.
 */
export function applyPatch(data: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> =
    data && typeof data === 'object' && !Array.isArray(data)
      ? cloneData(data as Record<string, unknown>)
      : {}

  for (const [path, value] of Object.entries(patch)) {
    // `__proto__` anywhere in a path would walk onto `Object.prototype` and
    // write there. The guest is sandboxed; the data it sends is not.
    const segments = path.split('.').filter((segment) => segment && segment !== '__proto__')
    if (!segments.length) continue

    let cursor = next
    for (const segment of segments.slice(0, -1)) {
      const existing = cursor[segment]
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) cursor[segment] = {}
      cursor = cursor[segment] as Record<string, unknown>
    }
    cursor[segments[segments.length - 1]] = value
  }

  return next
}

/**
 * A defensive copy.
 *
 * `structuredClone` first because it handles dates, maps and typed arrays that
 * a JSON round trip would quietly mangle; JSON as the fallback because the data
 * may contain something `structuredClone` refuses (a framework's proxy, a
 * function a host put there) and losing those is better than throwing inside a
 * keystroke handler.
 */
export function cloneData(value: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return { ...value }
    }
  }
}
