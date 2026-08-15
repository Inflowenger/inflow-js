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

/**
 * An outgoing edge and where it lands.
 *
 * Ids only — deliberately. The engine has no business shipping the editor's
 * labels, and an event that embedded them would be wrong the moment someone
 * renamed a node. A consumer that wants titles resolves these ids against the
 * graph it already has; see {@link parseRefs} for doing that inside log text.
 */
export interface EdgeRef extends NodeRef {
  /** The graph's edge id. Empty for edges the runtime synthesised (a GoTo jump). */
  edgeId: string
  /** The tags the runtime matched to reach this decision. */
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

/**
 * Free-form diagnostics. `msg` is human-readable; other keys are context.
 *
 * A plugin sub-classifies some log events with {@link LogCategory} in the
 * `category` field so a consumer can render them specially (a progress pie
 * chart, a protocol trace) without a new event kind — see {@link ProgressLogFields}
 * and {@link ProtocolLogFields}. Plain diagnostics carry no `category`.
 */
export interface LogDetail {
  msg?: string
  category?: LogCategory
  [field: string]: unknown
}

/** Sub-class of a `log` event, carried in {@link LogDetail.category}. */
export type LogCategory =
  | 'protocol'
  | 'progress'
  | 'dep.wait'
  | 'dep.ready'
  | 'scope.fanout'
  | 'resume'

/** The human-readable content of a progress frame. */
export interface Frame {
  title: string
  content: string
  /** Reserved open bag for frontend-effective extras (e.g. an `items` list). */
  meta?: Record<string, unknown>
}

/**
 * Fields on a `log` event with `category: 'progress'` — a sub-100% frame emitted
 * while a plugin job runs. `percent` is [1,99] (100% is node completion, not a
 * frame); render it as the node's pie chart and show `frame` beside it. `details`
 * is an optional partial payload some jobs surface as they go.
 */
export interface ProgressLogFields {
  category: 'progress'
  percent: number
  frame: Frame
  details?: Record<string, unknown>
}

/**
 * Fields on a `log` event with `category: 'protocol'` — an inflowV1 transport
 * trace (init/request subjects, job-id assignment, subscriptions). Diagnostics
 * about the plugin↔core NATS handshake, not task output.
 */
export interface ProtocolLogFields {
  category: 'protocol'
  proto: string
  msg: string
  subject?: string
  jobId?: string
}

/**
 * Fields on a `log` event with `category: 'dep.wait'` — a join node parking
 * until the branches it depends on arrive.
 *
 * `depends` is the whole join, `pending` the part still outstanding, both as
 * node ids in the event's own flow. A `dep.wait` with no matching `dep.ready`
 * for the same node is a join that never completed; the variant that carries
 * `waitedMs` is the runtime giving up, because the process ended with branches
 * that will now never arrive (it is emitted at `warn`).
 */
export interface DepWaitFields {
  category: 'dep.wait'
  depends: string[]
  pending: string[]
  waitedMs?: number
}

/**
 * Fields on a `log` event with `category: 'dep.ready'` — every dependency of a
 * join has arrived and the node is about to run. Closes a {@link DepWaitFields}
 * for the same node. A join whose dependencies were already in when it was
 * dequeued emits neither event.
 */
export interface DepReadyFields {
  category: 'dep.ready'
  depends: string[]
  waitedMs: number
}

/**
 * Fields on a `log` event with `category: 'scope.fanout'` — a node whose `scope`
 * matched more than one location. The engine runs the node once per location,
 * sequentially, but still emits a single `node.enter` / `node.exit` pair around
 * the whole set, so this line is the only thing that makes that loop visible.
 *
 * `count` is the true number of passes; `locations` is the resolved json path of
 * each one and is capped by the producer, so a large fan-out lists a sample
 * rather than every element — trust `count`, not `locations.length`.
 */
export interface ScopeFanoutFields {
  category: 'scope.fanout'
  /** The node's `scope` as written, e.g. `$.orders[*]`. */
  scope: string
  count: number
  locations: string[]
}

/**
 * Fields on a `log` event with `category: 'resume'` — a run continuing an
 * earlier one over the same context. The traversal snapshot the previous run
 * left in the context header has been reloaded, so a join downstream of the
 * resume point sees its already-completed dependencies instead of locking.
 *
 * The applied variant (emitted at `info`) carries `seededNodes` and
 * `joinWatermarks`. The skipped variant (emitted at `warn`) carries neither —
 * only `msg` — meaning a resume was requested but the snapshot was absent or the
 * flow drifted since it was taken, so the run continues with blank state.
 */
export interface ResumeFields {
  category: 'resume'
  seededNodes?: number
  joinWatermarks?: number
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
