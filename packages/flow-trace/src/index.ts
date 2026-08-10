/**
 * @inflowenger/flow-trace
 *
 * Turns the Inflow process event stream into flow movement and completion.
 *
 * The wire contract is documented in inflow-fusion `docs/logs.md`; this is its
 * consumer half. Dependency-free and framework-agnostic — drive it from a
 * socket, a stored run, or a test.
 *
 * ```ts
 * const tracker = createFlowTracker({ pid })
 * tracker.on('move', ({ from, to, edgeId }) => highlightEdge(edgeId))
 * tracker.on('finish', ({ status }) => done(status))
 * socket.on('message', (raw) => tracker.ingest(raw))
 * ```
 */

export {
  EVENT_SCHEMA_VERSION,
  edgeKey,
  nodeKey,
  type DepReadyFields,
  type DepWaitFields,
  type EdgeRef,
  type EdgeReason,
  type EdgeSelectDetail,
  type EventKind,
  type ExitStatus,
  type FinishStatus,
  type FlowJumpDetail,
  type Frame,
  type Level,
  type LogCategory,
  type LogDetail,
  type NodeEnterDetail,
  type NodeExitDetail,
  type NodeRef,
  type ProcEvent,
  type ProcFinishDetail,
  type ProcStartDetail,
  type ProgressLogFields,
  type ProtocolLogFields,
  type ScopeFanoutFields,
} from './types.js'

export { isProcEvent, parseEvent, type ParseResult, type RejectReason } from './parse.js'

export { describeEvent } from './describe.js'

export {
  REF_PATTERN,
  parseRefs,
  refText,
  resolveRefs,
  type GraphIndex,
  type LabelledToken,
  type NamedEdge,
  type NamedNode,
  type RefToken,
  type ResolveOptions,
  type TextToken,
  type Token,
} from './refs.js'

export {
  FlowTracker,
  createFlowTracker,
  replay,
  type EdgeState,
  type FinishEvent,
  type FlowTraceEventName,
  type FlowTraceEvents,
  type FlowTrackerOptions,
  type GapEvent,
  type JumpEvent,
  type LogEvent,
  type MoveEvent,
  type NodeEnterEvent,
  type NodeExitEvent,
  type NodeState,
  type NodeStatus,
  type ProcessState,
  type ProcessStatus,
  type SkipEvent,
  type StartEvent,
} from './tracker.js'
