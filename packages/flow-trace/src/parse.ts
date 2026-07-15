import { EVENT_SCHEMA_VERSION, type ProcEvent } from './types.js'

/** Why a message was not a usable v1 event. */
export type RejectReason =
  | 'not-json' // a string that wasn't JSON
  | 'not-an-object' // null, array, number, ...
  | 'legacy' // pre-v1: no `v` field
  | 'unsupported-version' // a `v` this build doesn't know
  | 'malformed' // right shape, wrong/missing required fields

export type ParseResult =
  | { ok: true; event: ProcEvent }
  | { ok: false; reason: RejectReason; input: unknown }

function reject(reason: RejectReason, input: unknown): ParseResult {
  return { ok: false, reason, input }
}

/**
 * Validate one message off the wire.
 *
 * Rejection is normal, not exceptional: the transport is shared and carries
 * things that aren't process events (connection banners, other traffic), so
 * this never throws — callers skip what they can't use.
 *
 * Accepts a JSON string as well as an object: a socket may hand over either,
 * depending on how it was configured.
 */
export function parseEvent(raw: unknown): ParseResult {
  let value = raw

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return reject('not-json', raw)
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject('not-an-object', raw)
  }

  const o = value as Record<string, unknown>

  // Pre-v1 events have no `v` at all. Distinguish them from corruption so a
  // caller can report "your engine predates this parser" rather than "garbage".
  if (o.v === undefined) return reject('legacy', raw)
  if (o.v !== EVENT_SCHEMA_VERSION) return reject('unsupported-version', raw)

  if (
    typeof o.pid !== 'string' ||
    typeof o.seq !== 'number' ||
    typeof o.ts !== 'number' ||
    typeof o.kind !== 'string' ||
    typeof o.level !== 'string' ||
    typeof o.src !== 'string'
  ) {
    return reject('malformed', raw)
  }

  // `flow`/`node` are absent on process-scoped kinds, but must be strings when
  // present — a non-string here would silently corrupt every state key.
  if (o.flow !== undefined && typeof o.flow !== 'string') return reject('malformed', raw)
  if (o.node !== undefined && typeof o.node !== 'string') return reject('malformed', raw)

  // `kind` is intentionally not checked against the known set: unknown kinds are
  // forward compatibility, and it's the reducer's job to ignore them.
  return { ok: true, event: o as unknown as ProcEvent }
}

/** True if the message is a usable v1 event. */
export function isProcEvent(raw: unknown): raw is ProcEvent {
  return parseEvent(raw).ok
}
