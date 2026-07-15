import { parseEvent, type RejectReason } from './parse.js'
import {
  edgeKey,
  nodeKey,
  type EdgeRef,
  type EdgeSelectDetail,
  type ExitStatus,
  type FinishStatus,
  type FlowJumpDetail,
  type Level,
  type LogDetail,
  type NodeEnterDetail,
  type NodeExitDetail,
  type NodeRef,
  type ProcEvent,
  type ProcFinishDetail,
  type ProcStartDetail,
} from './types.js'

export type ProcessStatus = 'running' | FinishStatus

/** How a node stands right now. */
export type NodeStatus =
  /** An inbound edge was taken toward it; it hasn't reported entering yet. */
  | 'pending'
  | 'running'
  | 'ok'
  | 'error'

export interface NodeState extends NodeRef {
  /** `flow:node` — the key this is stored under. */
  key: string
  type?: string
  title?: string
  status: NodeStatus
  /** How many times this node has run. >1 means a loop or GoTo re-entry. */
  attempts: number
  enteredAt?: number
  exitedAt?: number
  durationMs?: number
  error?: string
}

export interface EdgeState {
  key: string
  /** The graph's edge id. Empty for edges the runtime synthesised (e.g. a GoTo jump). */
  edgeId: string
  from: NodeRef
  to: NodeRef
  tags: string[]
  /**
   * Whether control has *ever* crossed this edge.
   *
   * Sticky once true. A loop can take an edge on one pass and prune it on the
   * next — letting the later decision clear this would erase the fact that the
   * flow actually went that way, which is the one thing a path view must show.
   * Use {@link EdgeState.takenCount} for how often, and `takenCount === 0` for
   * "evaluated but never followed", e.g. to grey out a rejected branch.
   */
  taken: boolean
  /** How many times control crossed this edge. >1 means a loop. */
  takenCount: number
  /** When the most recent decision about this edge was reported. */
  at: number
}

export interface ProcessState {
  pid: string
  status: ProcessStatus
  /** Where the process began. */
  entry?: NodeRef
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  error?: string
  nodes: Record<string, NodeState>
  edges: Record<string, EdgeState>
  /** Highest seq applied. */
  lastSeq: number
  /** Events held back waiting for an earlier seq to arrive. */
  pending: number
}

/** A traversal: control left `from` along `edge` and is heading to `to`. */
export interface MoveEvent {
  pid: string
  from: NodeRef
  to: NodeRef
  edgeId: string
  edgeKey: string
  tags: string[]
  /** The tags a contract returned to make this choice, when it was a branch. */
  reason?: string[]
  at: number
  seq: number
}

export interface StartEvent {
  pid: string
  entry: NodeRef
  at: number
}

export interface FinishEvent {
  pid: string
  status: FinishStatus
  durationMs: number
  error?: string
  at: number
}

export interface NodeEnterEvent {
  pid: string
  node: NodeState
  at: number
}

export interface NodeExitEvent {
  pid: string
  node: NodeState
  status: ExitStatus
  error?: string
  at: number
}

export interface JumpEvent {
  pid: string
  from: NodeRef
  to: NodeRef
  ret?: NodeRef
  at: number
}

export interface LogEvent {
  pid: string
  level: Level
  src: string
  msg: string
  node?: NodeRef
  fields: Record<string, unknown>
  at: number
  seq: number
}

/** Events were lost: `count` seq numbers from `from` never arrived. */
export interface GapEvent {
  pid: string
  from: number
  count: number
}

/** A message that wasn't a usable v1 event. */
export interface SkipEvent {
  reason: RejectReason
  input: unknown
}

export interface FlowTraceEvents {
  start: StartEvent
  move: MoveEvent
  finish: FinishEvent
  'node:enter': NodeEnterEvent
  'node:exit': NodeExitEvent
  jump: JumpEvent
  log: LogEvent
  gap: GapEvent
  skip: SkipEvent
  /** Any accepted event, after it has been applied. Useful for raw log views. */
  event: ProcEvent
}

export type FlowTraceEventName = keyof FlowTraceEvents

export interface FlowTrackerOptions {
  /**
   * Only track these pids. The stream carries every process on the engine, so
   * without this a tracker accumulates state for other people's runs too.
   */
  pid?: string | string[]
  /**
   * How many out-of-order events to hold before concluding the hole is a real
   * drop and moving on without it. The engine stamps seq synchronously but
   * publishes concurrently, so small reorderings are normal; a lasting hole is
   * not.
   *
   * This also bounds how long a tracker that attached mid-run waits before
   * giving up on history it never saw: it reports a `gap` and resumes at the
   * earliest event it has. Raise it to tolerate more reordering at the cost of
   * latency; `Infinity` (as {@link replay} uses) waits for {@link FlowTracker.flush}.
   */
  reorderWindow?: number
}

interface PidBuffer {
  /** The seq we are waiting for. Never guessed — see the note in `ingest`. */
  next: number
  held: Map<number, ProcEvent>
}

/**
 * Enough to absorb real reordering — which is small, since the engine's window
 * between stamping seq and publishing is microseconds — while still resolving a
 * genuinely lost event, or history missed by attaching mid-run, promptly.
 */
const DEFAULT_REORDER_WINDOW = 16

function emptyState(pid: string): ProcessState {
  return {
    pid,
    status: 'running',
    nodes: {},
    edges: {},
    lastSeq: -1,
    pending: 0,
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

/**
 * Turns the process event stream into flow movement and completion.
 *
 * Implements the consumer side of the contract in inflow-fusion `docs/logs.md`:
 * demultiplexes by pid, orders by seq rather than timestamp, keys node state on
 * `flow:node`, and tolerates anything it doesn't recognise.
 *
 * Framework-agnostic and dependency-free: feed it from a socket, a file, or a
 * test. State is plain objects so it can be made reactive or serialised as-is.
 */
export class FlowTracker {
  private readonly states = new Map<string, ProcessState>()
  private readonly buffers = new Map<string, PidBuffer>()
  private readonly handlers = new Map<string, Set<(payload: never) => void>>()
  private readonly watched: Set<string> | null
  private readonly reorderWindow: number

  constructor(options: FlowTrackerOptions = {}) {
    const { pid, reorderWindow = DEFAULT_REORDER_WINDOW } = options
    this.watched =
      pid === undefined ? null : new Set(Array.isArray(pid) ? pid : [pid])
    this.reorderWindow = Math.max(1, reorderWindow)
  }

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends FlowTraceEventName>(
    type: K,
    handler: (payload: FlowTraceEvents[K]) => void,
  ): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as (payload: never) => void)
    return () => {
      set!.delete(handler as (payload: never) => void)
    }
  }

  off<K extends FlowTraceEventName>(
    type: K,
    handler: (payload: FlowTraceEvents[K]) => void,
  ): void {
    this.handlers.get(type)?.delete(handler as (payload: never) => void)
  }

  private emit<K extends FlowTraceEventName>(type: K, payload: FlowTraceEvents[K]): void {
    const set = this.handlers.get(type)
    if (!set) return
    for (const handler of set) {
      // One bad subscriber must not stop the others, or halt ingestion.
      try {
        ;(handler as (p: FlowTraceEvents[K]) => void)(payload)
      } catch {
        /* subscriber's problem */
      }
    }
  }

  /** Feed one message. Anything unusable is reported via `skip`. */
  ingest(raw: unknown): void {
    const parsed = parseEvent(raw)
    if (!parsed.ok) {
      this.emit('skip', { reason: parsed.reason, input: parsed.input })
      return
    }
    const event = parsed.event
    if (this.watched && !this.watched.has(event.pid)) return

    const buffer = this.bufferFor(event.pid)

    // Deliberately no "the first event I see is the baseline" shortcut. The
    // first arrival is not necessarily the earliest — that's the whole reason
    // seq exists — and treating it as one silently discards every event behind
    // it. Start at 0 and let the reorder window (or flush) resolve any hole,
    // which reports what was missed instead of hiding it.
    if (event.seq < buffer.next) return // already applied, or a duplicate
    if (event.seq > buffer.next) {
      buffer.held.set(event.seq, event)
      this.syncPending(event.pid)
      if (buffer.held.size > this.reorderWindow) this.skipGap(event.pid)
      return
    }

    this.applyAndDrain(event, buffer)
  }

  ingestMany(raws: Iterable<unknown>): void {
    for (const raw of raws) this.ingest(raw)
  }

  /**
   * Apply everything held back, accepting that missing events are gone for good.
   *
   * Call when a stream has ended and a hole is never going to be filled —
   * otherwise state stays stuck behind it.
   */
  flush(pid?: string): void {
    const pids = pid ? [pid] : [...this.buffers.keys()]
    for (const p of pids) {
      const buffer = this.buffers.get(p)
      while (buffer && buffer.held.size > 0) this.skipGap(p)
    }
  }

  state(pid: string): ProcessState | undefined {
    return this.states.get(pid)
  }

  processes(): string[] {
    return [...this.states.keys()]
  }

  reset(pid?: string): void {
    if (pid === undefined) {
      this.states.clear()
      this.buffers.clear()
      return
    }
    this.states.delete(pid)
    this.buffers.delete(pid)
  }

  private bufferFor(pid: string): PidBuffer {
    let buffer = this.buffers.get(pid)
    if (!buffer) {
      buffer = { next: 0, held: new Map() }
      this.buffers.set(pid, buffer)
    }
    return buffer
  }

  private stateFor(pid: string): ProcessState {
    let state = this.states.get(pid)
    if (!state) {
      state = emptyState(pid)
      this.states.set(pid, state)
    }
    return state
  }

  private syncPending(pid: string): void {
    const state = this.states.get(pid)
    if (state) state.pending = this.buffers.get(pid)?.held.size ?? 0
  }

  private applyAndDrain(event: ProcEvent, buffer: PidBuffer): void {
    this.apply(event)
    buffer.next = event.seq + 1
    // Whatever was waiting on this event can now go too.
    for (;;) {
      const next = buffer.held.get(buffer.next)
      if (!next) break
      buffer.held.delete(buffer.next)
      this.apply(next)
      buffer.next++
    }
    this.syncPending(event.pid)
  }

  /** Give up on the current hole and resume at the earliest held event. */
  private skipGap(pid: string): void {
    const buffer = this.buffers.get(pid)
    if (!buffer || buffer.held.size === 0) return

    const resumeAt = Math.min(...buffer.held.keys())
    this.emit('gap', { pid, from: buffer.next, count: resumeAt - buffer.next })
    buffer.next = resumeAt

    const event = buffer.held.get(resumeAt)!
    buffer.held.delete(resumeAt)
    this.applyAndDrain(event, buffer)
  }

  private apply(event: ProcEvent): void {
    const state = this.stateFor(event.pid)
    state.lastSeq = event.seq

    switch (event.kind) {
      case 'proc.start':
        this.applyProcStart(state, event)
        break
      case 'proc.finish':
        this.applyProcFinish(state, event)
        break
      case 'node.enter':
        this.applyNodeEnter(state, event)
        break
      case 'node.exit':
        this.applyNodeExit(state, event)
        break
      case 'edge.select':
        this.applyEdgeSelect(state, event)
        break
      case 'flow.jump':
        this.applyFlowJump(state, event)
        break
      case 'log':
        this.applyLog(event)
        break
      default:
        // Unknown kind from a newer engine — forward compatibility.
        break
    }

    this.emit('event', event)
  }

  /** Get or create node state. Always keyed on `flow:node`, never the bare id. */
  private node(state: ProcessState, ref: NodeRef): NodeState {
    const key = nodeKey(ref)
    let node = state.nodes[key]
    if (!node) {
      node = { key, flow: ref.flow, node: ref.node, status: 'pending', attempts: 0 }
      state.nodes[key] = node
    }
    return node
  }

  private refOf(event: ProcEvent): NodeRef | undefined {
    return event.flow !== undefined && event.node !== undefined
      ? { flow: event.flow, node: event.node }
      : undefined
  }

  private applyProcStart(state: ProcessState, event: ProcEvent): void {
    const detail = event.detail as ProcStartDetail | undefined
    if (!detail?.flow || !detail?.node) return
    const entry: NodeRef = { flow: detail.flow, node: detail.node }
    state.entry = entry
    state.startedAt = event.ts
    state.status = 'running'
    this.node(state, entry)
    this.emit('start', { pid: event.pid, entry, at: event.ts })
  }

  /**
   * Fold one routing decision into edge state, returning the edge's key.
   *
   * Decisions accumulate rather than replace: the same edge is decided afresh
   * on every pass through a loop, and only the union of those passes describes
   * the path the flow actually walked.
   */
  private recordEdge(
    state: ProcessState,
    from: NodeRef,
    edge: EdgeRef,
    taken: boolean,
    at: number,
  ): string {
    const to: NodeRef = { flow: edge.flow, node: edge.node }
    const key = edgeKey(from, to, edge.edgeId)
    const existing = state.edges[key]

    if (existing) {
      existing.at = at
      existing.tags = edge.tags ?? existing.tags
      if (taken) {
        existing.taken = true
        existing.takenCount++
      }
      return key
    }

    state.edges[key] = {
      key,
      edgeId: edge.edgeId ?? '',
      from,
      to,
      tags: edge.tags ?? [],
      taken,
      takenCount: taken ? 1 : 0,
      at,
    }
    return key
  }

  private applyProcFinish(state: ProcessState, event: ProcEvent): void {
    const detail = event.detail as ProcFinishDetail | undefined
    const status = detail?.status ?? 'completed'
    state.status = status
    state.finishedAt = event.ts
    state.durationMs = detail?.durationMs
    state.error = detail?.error
    this.emit('finish', {
      pid: event.pid,
      status,
      durationMs: detail?.durationMs ?? 0,
      error: detail?.error,
      at: event.ts,
    })
  }

  private applyNodeEnter(state: ProcessState, event: ProcEvent): void {
    const ref = this.refOf(event)
    if (!ref) return
    const detail = event.detail as NodeEnterDetail | undefined
    const node = this.node(state, ref)
    node.status = 'running'
    node.type = detail?.type ?? node.type
    node.title = detail?.title ?? node.title
    node.attempts = detail?.attempt ?? node.attempts + 1
    node.enteredAt = event.ts
    node.exitedAt = undefined
    node.durationMs = undefined
    node.error = undefined
    this.emit('node:enter', { pid: event.pid, node, at: event.ts })
  }

  private applyNodeExit(state: ProcessState, event: ProcEvent): void {
    const ref = this.refOf(event)
    if (!ref) return
    const detail = event.detail as NodeExitDetail | undefined
    const status: ExitStatus = detail?.status === 'error' ? 'error' : 'ok'
    const node = this.node(state, ref)
    node.status = status
    node.exitedAt = event.ts
    node.durationMs = detail?.durationMs
    node.error = detail?.error
    this.emit('node:exit', {
      pid: event.pid,
      node,
      status,
      error: detail?.error,
      at: event.ts,
    })
  }

  private applyEdgeSelect(state: ProcessState, event: ProcEvent): void {
    const from = this.refOf(event)
    if (!from) return
    const detail = event.detail as EdgeSelectDetail | undefined
    if (!detail) return

    for (const edge of detail.pruned ?? []) {
      this.recordEdge(state, from, edge, false, event.ts)
    }

    for (const edge of detail.taken ?? []) {
      const to: NodeRef = { flow: edge.flow, node: edge.node }
      const key = this.recordEdge(state, from, edge, true, event.ts)
      // Register the target so it exists in state before it reports entering.
      this.node(state, to)
      this.emit('move', {
        pid: event.pid,
        from,
        to,
        edgeId: edge.edgeId ?? '',
        edgeKey: key,
        tags: edge.tags ?? [],
        reason: detail.reason?.tags,
        at: event.ts,
        seq: event.seq,
      })
    }
  }

  private applyFlowJump(state: ProcessState, event: ProcEvent): void {
    const from = this.refOf(event)
    const detail = event.detail as FlowJumpDetail | undefined
    if (!from || !detail?.to) return
    this.node(state, detail.to)
    this.emit('jump', {
      pid: event.pid,
      from,
      to: detail.to,
      ret: detail.ret,
      at: event.ts,
    })
  }

  private applyLog(event: ProcEvent): void {
    const detail = asRecord(event.detail) as LogDetail
    const { msg, ...fields } = detail
    this.emit('log', {
      pid: event.pid,
      level: event.level,
      src: event.src,
      msg: typeof msg === 'string' ? msg : '',
      node: this.refOf(event),
      fields,
      at: event.ts,
      seq: event.seq,
    })
  }
}

export function createFlowTracker(options?: FlowTrackerOptions): FlowTracker {
  return new FlowTracker(options)
}

/**
 * Fold a finished batch of events into final state.
 *
 * For replaying a stored run or asserting in a test. A batch is by definition
 * every event there will ever be, so this holds out-of-order events
 * indefinitely and flushes at the end — ordering the batch perfectly however it
 * arrives, rather than giving up on a hole the way a live tracker must.
 */
export function replay(
  events: Iterable<unknown>,
  options?: FlowTrackerOptions,
): Map<string, ProcessState> {
  const tracker = createFlowTracker({ reorderWindow: Infinity, ...options })
  tracker.ingestMany(events)
  tracker.flush()
  const out = new Map<string, ProcessState>()
  for (const pid of tracker.processes()) out.set(pid, tracker.state(pid)!)
  return out
}
