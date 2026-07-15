# @inflowenger/flow-trace

Turns the Inflow **process event stream** into flow movement and completion.

The engine publishes an event per meaningful thing that happens while a flow runs. This is the consumer half of that contract — it answers *where is the process, which edges did it take, and did it finish?* Zero dependencies, no framework: drive it from a socket, a stored run, or a test.

The wire format is specified in inflow-fusion [`docs/logs.md`](../../../inflow-fusion/docs/logs.md). Read that first if you're changing this.

## Install

```jsonc
// package.json
{ "dependencies": { "@inflowenger/flow-trace": "workspace:*" } }
```

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
| `move` | Control crosses an edge — **the one to use for movement** | `from`, `to`, `edgeId`, `tags`, `reason` |
| `node:enter` / `node:exit` | A node starts / settles | `node`, `status`, `error` |
| `jump` | A GoTo transfers into another flow | `to`, `ret` |
| `log` | Diagnostics from user code, a plugin, or the runtime | `level`, `src`, `msg`, `fields` |
| `finish` | The process ends | `status`, `durationMs`, `error` |
| `gap` | Events were lost | `from`, `count` |
| `skip` | A message wasn't a usable v1 event | `reason` |
| `event` | Any accepted event, after it's applied | the raw `ProcEvent` |

`state(pid)` returns the accumulated `ProcessState`: `nodes`, `edges`, `status`, `entry`, timings. Plain objects — make it reactive or serialise it as-is.

## Four things worth knowing

**A node is `flow:node`, never just `node`.** Node ids are unique only *within* a flow, and one process spans several via GoTo — in a real run, `flow:22`'s node `9` is a code node while `flow:33`'s node `9` is a contract, both live under the same pid. Use the exported `nodeKey(flow, node)`; keying on the bare id silently merges unrelated nodes.

**Order comes from `seq`, never `ts`.** The engine emits many events per millisecond, so timestamps collide constantly and cannot order anything. The tracker reorders by `seq` internally, holding out-of-order events until the sequence is contiguous.

**Loops are normal, and state is bounded by the graph.** A node can be processed thousands of times. `nodes`/`edges` hold one entry per identity; the history lives in counters — `NodeState.attempts` and `EdgeState.takenCount`. Nothing accumulates per pass, so a long-running flow doesn't leak. Events still fire on *every* pass, which is what animation needs.

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
