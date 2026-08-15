# @inflowenger/flow-trace

Turns the Inflow **process event stream** into flow movement and completion.

The engine publishes an event per meaningful thing that happens while a flow runs. This is the consumer half of that contract — it answers *where is the process, which edges did it take, and did it finish?* Zero dependencies, no framework: drive it from a socket, a stored run, or a test.

The wire format is specified in the `inflow-fusion` repo, `docs/logs.md`. Read that first if you're changing this — the producer is fractal-core's engine, and these types are only useful insofar as they match what it actually publishes.

## Install

```sh
pnpm add @inflowenger/flow-trace
```

No dependencies, no framework. Browser, Node, or a test.

## Use

```ts
import { createFlowTracker } from '@inflowenger/flow-trace'

const tracker = createFlowTracker({ pid })

tracker.on('move', ({ from, to, edgeId, tags }) => highlightEdge(edgeId))
tracker.on('node:enter', ({ node }) => markRunning(node.key))
tracker.on('node:exit', ({ node, status }) => markSettled(node.key, status))
tracker.on('finish', ({ status, durationMs }) => showResult(status, durationMs))

socket.on('message', (raw) => tracker.ingest(raw))
```

`ingest` accepts an object or a JSON string, and never throws — anything unusable is reported via `skip`.

For a run you already have in full:

```ts
import { replay } from '@inflowenger/flow-trace'

const state = replay(lines).get(pid)
// state.status === 'completed' | 'failed' | 'stopped' | 'running'
```

## Events

| Event | Fires when | Carries |
|---|---|---|
| `start` | The process begins | `entry` |
| `move` | Control crosses an edge — **the one to use for movement** | `from`, `to`, `edgeId`, `edgeKey`, `tags`, `reason` |
| `node:enter` / `node:exit` | A node starts / settles | `node`, `status`, `error` |
| `jump` | A GoTo transfers into another flow | `to`, `ret` |
| `log` | Diagnostics from user code, a plugin, or the runtime | `level`, `src`, `msg`, `fields` |
| ↳ | A log may be tagged with `fields.category` — `progress` (a sub-100% frame: `percent`, `frame`, optional `details`), `protocol` (an inflowV1 transport trace), `dep.wait` / `dep.ready` (a join node parking on its inbound branches, then released), `scope.fanout` (a node whose `scope` matched several locations), or `resume` (a run continuing an earlier one: the traversal snapshot was reloaded, or — at `warn`, with no counts — the resume was skipped) — so you can render it specially or hide it | see `ProgressLogFields`, `ProtocolLogFields`, `DepWaitFields`, `DepReadyFields`, `ScopeFanoutFields`, `ResumeFields` |
| `finish` | The process ends | `status`, `durationMs`, `error` |
| `gap` | Events were lost | `from`, `count` |
| `skip` | A message wasn't a usable v1 event | `reason` |
| `event` | Any accepted event, after it's applied | the raw `ProcEvent` |

`state(pid)` returns the accumulated `ProcessState`: `nodes`, `edges`, `status`, `entry`, timings. Plain objects — make it reactive or serialise it as-is.

## Naming what the stream refers to

The engine says `n_mrv19bz0aownno`; only the saved graph knows that is *upsert*. Embedding titles in events would ship the editor's vocabulary through the runtime and go stale on the next rename — so events carry ids, and naming happens where the graph is.

`describeEvent` turns an event into a line (ids intact), and `resolveRefs` swaps those ids for what your graph draws. Implement `GraphIndex` over whatever you already load:

```ts
import { describeEvent, resolveRefs } from '@inflowenger/flow-trace'

const graph: GraphIndex = {
  node: (flow, id) => store.flows[flow!]?.nodes[id],   // { id, title, type? }
  edge: (flow, id) => store.flows[flow!]?.edges[id],   // { id, source, target, tags }
}

for (const part of resolveRefs(describeEvent(event), graph, { flow: event.flow })) {
  // part.label — the title, the edge's tags, or the id when nothing named it
  // part.known — false for text and unresolved ids, so you can fade them
}
```

It works on any text, not just `describeEvent`'s: a message a plugin or a JS node wrote resolves the same way. `parseRefs` is the split on its own, and `refText` writes a reference back — bare inside its flow, `flow_…/n_…` when it leaves one, which is how a GoTo target stays resolvable. A lookup returning `undefined` is normal (flow still loading, node since deleted); the id is then shown as-is.

## Five things worth knowing

**A node is `flow:node`, never just `node`.** Node ids are unique only *within* a flow, and one process spans several via GoTo — in a real run, `flow:22`'s node `9` is a code node while `flow:33`'s node `9` is a contract, both live under the same pid. Use the exported `nodeKey(flow, node)`; keying on the bare id silently merges unrelated nodes.

**Order comes from `seq`, never `ts`.** The engine emits many events per millisecond, so timestamps collide constantly and cannot order anything. The tracker reorders by `seq` internally, holding out-of-order events until the sequence is contiguous.

**Loops are normal, and state is bounded by the graph.** A node can be processed thousands of times. `nodes`/`edges` hold one entry per identity; the history lives in counters — `NodeState.attempts` and `EdgeState.takenCount`. Nothing accumulates per pass, so a long-running flow doesn't leak. Events still fire on *every* pass, which is what animation needs.

**The stream carries ids, not names.** Titles live in the editor; the only one on the wire is `node.enter`'s, and a pruned branch never enters. So resolve ids against the graph you already have — see [Naming what the stream refers to](#naming-what-the-stream-refers-to).

**`EdgeState.taken` is sticky.** A loop can take an edge on one pass and prune it on the next. Once control has crossed an edge, `taken` stays `true` — the flow really did go that way, and a path view must keep showing it. `takenCount === 0` means "evaluated but never followed", e.g. the rejected side of a branch.

## Gaps

The stream is gapless at the producer, so a hole means a message was genuinely lost — or that you attached mid-run and missed the history. Either way the tracker holds out-of-order events up to `reorderWindow` (default 16), then reports a `gap` and moves on rather than stalling forever. Call `flush()` to drain a hole immediately — e.g. when a stream has ended. `replay()` holds indefinitely and flushes at the end, so a batch is ordered perfectly however it arrives.

## Develop

```sh
pnpm build      # dist/
pnpm test       # node:test, driven by a real captured run
pnpm typecheck
```

`test/fixtures/real-run.jsonl` is an actual engine run — contract branch, plugin failure, GoTo across flows, and a loop. Prefer extending it over hand-writing events.
