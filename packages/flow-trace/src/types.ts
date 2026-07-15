/**
 * Wire types for the v1 process event stream.
 *
 * These mirror the contract in inflow-fusion `docs/logs.md`. Read that before
 * changing anything here — the producer is fractal-core's engine, and these
 * types are only useful insofar as they match what it actually publishes.
 */

export const EVENT_SCHEMA_VERSION = 1

/** What happened. Orthogonal to {@link Level}, which is severity only. */
export type EventKind =
  | 'proc.start'
  | 'proc.finish'
  | 'node.enter'
  | 'node.exit'
  | 'edge.select'
  | 'flow.jump'
  | 'log'

/** Severity, nothing else. */
export type Level = 'debug' | 'info' | 'warn' | 'error'

/** How a process ended. */
export type FinishStatus = 'completed' | 'failed' | 'stopped'

/** How a single node settled. */
export type ExitStatus = 'ok' | 'error'

/**
 * A node, identified the only way that is unambiguous.
 *
 * Node ids are unique only within a flow, and one process spans several flows
 * via GoTo — so `node` alone is not an identity. See {@link nodeKey}.
 */
export interface NodeRef {
  flow: string
  node: string
}

/** An outgoing edge and where it lands. */
export interface EdgeRef extends NodeRef {
  edgeId: string
  tags: string[]
}

export interface ProcStartDetail {
  flow: string
  node: string
}

export interface ProcFinishDetail {
  status: FinishStatus
  durationMs: number
  error?: string
}

export interface NodeEnterDetail {
  type: string
  title: string
  attempt: number
}

export interface NodeExitDetail {
  status: ExitStatus
  durationMs: number
  error?: string
}

export interface EdgeReason {
  tags: string[]
}

export interface EdgeSelectDetail {
  taken: EdgeRef[]
  pruned: EdgeRef[]
  reason?: EdgeReason
}

export interface FlowJumpDetail {
  to: NodeRef
  ret?: NodeRef
}

/** Free-form diagnostics. `msg` is human-readable; other keys are context. */
export interface LogDetail {
  msg: string
  [field: string]: unknown
}

/** One event off the wire. */
export interface ProcEvent<D = unknown> {
  v: number
  pid: string
  /** Monotonic per pid, gapless at the producer. The only ordering authority. */
  seq: number
  /** Wall clock, ms. Display only — collides within a millisecond, never sort by it. */
  ts: number
  kind: EventKind | (string & {})
  level: Level
  src: string
  /** Set on node-scoped kinds. Scopes {@link ProcEvent.node}. */
  flow?: string
  node?: string
  detail?: D
}

/**
 * Composite node identity: `flow:node`.
 *
 * Always key node state on this. Keying on the bare node id corrupts state the
 * moment a GoTo enters a flow that reuses an id — which is routine.
 */
export function nodeKey(flow: string, node: string): string
export function nodeKey(ref: NodeRef): string
export function nodeKey(flowOrRef: string | NodeRef, node?: string): string {
  return typeof flowOrRef === 'string'
    ? `${flowOrRef}:${node}`
    : `${flowOrRef.flow}:${flowOrRef.node}`
}

/**
 * Stable identity for an edge.
 *
 * Prefers the graph's own `edgeId` so a consumer can light up the edge it is
 * already rendering. Some edges have none — a GoTo's jump target is synthesised
 * by the runtime, not drawn by a user — so fall back to the endpoints.
 */
export function edgeKey(from: NodeRef, to: NodeRef, edgeId?: string): string {
  return edgeId && edgeId.length > 0
    ? edgeId
    : `${nodeKey(from)}->${nodeKey(to)}`
}
