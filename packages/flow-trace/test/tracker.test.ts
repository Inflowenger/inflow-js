import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createFlowTracker, nodeKey, replay } from '../src/index.js'
import type { MoveEvent, ProcEvent } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))

/** A real run captured off a live engine: contract branch, plugin failure, GoTo, loop. */
function realRun(): ProcEvent[] {
  const raw = readFileSync(join(here, '..', '..', 'test', 'fixtures', 'real-run.jsonl'), 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ProcEvent)
}

const PID = 'cf31ecb0-0979-401e-b2e3-c9c6bfd5b713'

test('replays a real run to a completed process', () => {
  const states = replay(realRun())
  const state = states.get(PID)

  assert.ok(state, 'the run should produce state for its pid')
  assert.equal(state.status, 'completed')
  assert.equal(state.durationMs, 74)
  assert.equal(state.lastSeq, 58)
  assert.equal(state.pending, 0)
  assert.deepEqual(state.entry, { flow: 'flow:22', node: '6' })
})

test('a node id reused across flows stays two distinct nodes', () => {
  // flow:22's node 9 is a code node; flow:33's node 9 is a contract. Same id,
  // same pid, both real — this is what breaks a parser keyed on the bare id.
  const state = replay(realRun()).get(PID)!

  const inFlow22 = state.nodes[nodeKey('flow:22', '9')]
  const inFlow33 = state.nodes[nodeKey('flow:33', '9')]

  assert.ok(inFlow22, 'flow:22 node 9 should exist')
  assert.ok(inFlow33, 'flow:33 node 9 should exist')
  assert.equal(inFlow22.title, 'Fullname')
  assert.equal(inFlow22.type, 'codeNodeType')
  assert.equal(inFlow33.title, 'Contract')
  assert.equal(inFlow33.type, 'ruleNodeType')
})

test('counts a loop re-entry as a second attempt', () => {
  // flow:33 node 11 routes back to node 9, so 9 runs twice.
  const state = replay(realRun()).get(PID)!
  assert.equal(state.nodes[nodeKey('flow:33', '9')]!.attempts, 2)
})

test('records the failed plugin node without failing the process', () => {
  const state = replay(realRun()).get(PID)!

  const plugin = state.nodes[nodeKey('flow:22', '20')]!
  assert.equal(plugin.status, 'error')
  assert.match(plugin.error!, /no responders available/)

  // A node failing is not the process failing.
  assert.equal(state.status, 'completed')
})

test('emits a move per taken edge, and none for pruned', () => {
  const tracker = createFlowTracker()
  const moves: MoveEvent[] = []
  tracker.on('move', (m) => moves.push(m))
  tracker.ingestMany(realRun())

  // The contract at flow:22 node 10 took T and pruned F.
  const fromContract = moves.filter((m) => m.from.flow === 'flow:22' && m.from.node === '10')
  assert.equal(fromContract.length, 1, 'only the taken branch should move')
  assert.equal(fromContract[0]!.to.node, '11')
  assert.equal(fromContract[0]!.edgeId, 'e-10-11-1783103865000')
  assert.deepEqual(fromContract[0]!.tags, ['T'])
  assert.deepEqual(fromContract[0]!.reason, ['T'])

  // The pruned edge is still recorded, so a renderer can grey it out.
  const state = tracker.state(PID)!
  const pruned = state.edges['e-10-12-1783103869460']
  assert.ok(pruned, 'the pruned edge should be recorded')
  assert.equal(pruned.taken, false)
})

test('connects the entry node to the nodes it fans out to', () => {
  // The entry node never runs as a task, so its edges are reported separately.
  // Without them the first nodes appear with nothing explaining how control
  // reached them — the graph starts disconnected.
  const tracker = createFlowTracker()
  const moves: MoveEvent[] = []
  tracker.on('move', (m) => moves.push(m))
  tracker.ingestMany(realRun())

  const fromEntry = moves.filter((m) => m.from.node === '6')
  assert.equal(fromEntry.length, 3, 'all three edges out of the start node')
  assert.deepEqual(
    fromEntry.map((m) => m.to.node).sort(),
    ['10', '7', '9'],
  )

  // Every node that ran, except the entry itself, has an inbound taken edge.
  const state = tracker.state(PID)!
  const arrivedAt = new Set(
    Object.values(state.edges)
      .filter((e) => e.taken)
      .map((e) => nodeKey(e.to)),
  )
  const ran = Object.values(state.nodes).filter((n) => n.attempts > 0)
  for (const node of ran) {
    if (node.key === nodeKey(state.entry!)) continue
    assert.ok(arrivedAt.has(node.key), `${node.key} should be reachable by a taken edge`)
  }
})

test('an edge taken then later pruned stays marked as travelled', () => {
  // flow:33 node 9 runs twice: the first pass takes e-9-11, the second prunes
  // it. The flow really did go that way, so the later rejection must not erase
  // it — otherwise the path view loses the loop it just drew.
  const state = replay(realRun()).get(PID)!

  const looped = state.edges['e-9-11-1783115303441']!
  assert.equal(looped.taken, true, 'control crossed this edge on the first pass')
  assert.equal(looped.takenCount, 1)

  // The back-edge that closes the loop.
  const back = state.edges['e-11-9-1783115278113']!
  assert.equal(back.taken, true)

  // Pruned on pass one, taken on pass two — the union is "travelled once".
  const exists = state.edges['e-9-10-1783115295687']!
  assert.equal(exists.taken, true)
  assert.equal(exists.takenCount, 1)

  // Never taken on any pass: evaluated and always rejected.
  const neverTaken = state.edges['e-10-12-1783103869460']!
  assert.equal(neverTaken.taken, false)
  assert.equal(neverTaken.takenCount, 0)
})

/** A node cycling A -> B -> A for `iterations` passes, as a hot loop does. */
function hotLoop(iterations: number): ProcEvent[] {
  const events: ProcEvent[] = []
  let seq = 0
  const push = (e: Omit<ProcEvent, 'v' | 'pid' | 'seq' | 'ts' | 'level' | 'src'>) =>
    events.push({ v: 1, pid: 'loop', seq: seq++, ts: 1_000 + seq, level: 'info', src: 'rt', ...e })

  push({ kind: 'proc.start', detail: { flow: 'f', node: 'A' } })
  for (let i = 1; i <= iterations; i++) {
    push({ kind: 'node.enter', flow: 'f', node: 'A', detail: { type: 'code', title: 'A', attempt: i } })
    push({
      kind: 'edge.select',
      flow: 'f',
      node: 'A',
      detail: { taken: [{ flow: 'f', node: 'B', edgeId: 'e-A-B', tags: [] }], pruned: [] },
    })
    // Every pass logs, as user code in a loop body would.
    push({ kind: 'log', flow: 'f', node: 'A', detail: { msg: `pass ${i}` } })
    push({ kind: 'node.exit', flow: 'f', node: 'A', detail: { status: 'ok', durationMs: 1 } })
    push({ kind: 'node.enter', flow: 'f', node: 'B', detail: { type: 'code', title: 'B', attempt: i } })
    push({
      kind: 'edge.select',
      flow: 'f',
      node: 'B',
      detail: { taken: [{ flow: 'f', node: 'A', edgeId: 'e-B-A', tags: [] }], pruned: [] },
    })
    push({ kind: 'node.exit', flow: 'f', node: 'B', detail: { status: 'ok', durationMs: 1 } })
  }
  push({ kind: 'proc.finish', detail: { status: 'completed', durationMs: 99 } })
  return events
}

test('a hot loop grows state with the graph, not the iteration count', () => {
  // A node can be processed over and over. State must stay proportional to the
  // graph — anything that accumulates per pass is a leak in a long-running flow.
  const small = replay(hotLoop(10)).get('loop')!
  const large = replay(hotLoop(5_000)).get('loop')!

  assert.equal(Object.keys(large.nodes).length, Object.keys(small.nodes).length)
  assert.equal(Object.keys(large.edges).length, Object.keys(small.edges).length)
  assert.equal(Object.keys(large.nodes).length, 2, 'two nodes, however many passes')
  assert.equal(Object.keys(large.edges).length, 2, 'two edges, however many passes')

  // The counters are what carry the loop's history.
  assert.equal(large.nodes[nodeKey('f', 'A')]!.attempts, 5_000)
  assert.equal(large.edges['e-A-B']!.takenCount, 5_000)
  assert.equal(large.status, 'completed')
})

test('reports every pass of a loop as its own move', () => {
  const tracker = createFlowTracker()
  let moves = 0
  let logs = 0
  tracker.on('move', () => moves++)
  tracker.on('log', () => logs++)
  tracker.ingestMany(hotLoop(100))

  // Each pass crosses both edges and logs once — a consumer animating the flow
  // needs all of them, even though state only keeps the totals.
  assert.equal(moves, 200)
  assert.equal(logs, 100)
})

test('follows a GoTo into another flow and back', () => {
  const tracker = createFlowTracker()
  const jumps: Array<{ to: { flow: string }; ret?: { flow: string; node: string } }> = []
  tracker.on('jump', (j) => jumps.push(j))
  tracker.ingestMany(realRun())

  assert.equal(jumps.length, 1)
  assert.equal(jumps[0]!.to.flow, 'flow:33')
  assert.deepEqual(jumps[0]!.ret, { flow: 'flow:33', node: '10' })

  // The return edge: flow:33's end node routes back into flow:22.
  const state = tracker.state(PID)!
  const back = state.edges['e-14-23-1783377170304']!
  assert.equal(back.from.flow, 'flow:33')
  assert.equal(back.to.flow, 'flow:22')
  assert.equal(back.taken, true)
})

test('reports finish exactly once, with its status', () => {
  const tracker = createFlowTracker()
  const finishes: Array<{ status: string; durationMs: number }> = []
  tracker.on('finish', (f) => finishes.push(f))
  tracker.ingestMany(realRun())

  assert.equal(finishes.length, 1)
  assert.equal(finishes[0]!.status, 'completed')
  assert.equal(finishes[0]!.durationMs, 74)
})

test('orders by seq, not arrival', () => {
  // The engine stamps seq synchronously but publishes concurrently, so events
  // can land out of order. Shuffle hard and the outcome must not change.
  const shuffled = [...realRun()].reverse()
  const state = replay(shuffled).get(PID)!

  assert.equal(state.status, 'completed')
  assert.equal(state.lastSeq, 58)
  assert.equal(state.nodes[nodeKey('flow:33', '9')]!.attempts, 2)
})

test('nothing after a missing event is applied until it arrives', () => {
  const tracker = createFlowTracker({ reorderWindow: 1000 })
  const seen: number[] = []
  tracker.on('move', (m) => seen.push(m.seq))

  const events = realRun()
  const HOLE = 6 // the contract's edge.select
  for (const e of events) if (e.seq !== HOLE) tracker.ingest(e)

  // Moves from before the hole are applied; nothing from after it may be.
  assert.ok(seen.length > 0, 'the start node\'s edges precede the hole')
  assert.ok(
    seen.every((s) => s < HOLE),
    `nothing at or after seq ${HOLE} may be applied while it is missing`,
  )
  assert.ok(tracker.state(PID)!.pending > 0, 'later events should be held back')
  assert.equal(tracker.state(PID)!.status, 'running')

  const before = seen.length
  tracker.ingest(events.find((e) => e.seq === HOLE))

  assert.ok(seen.length > before, 'the backlog should drain once the hole is filled')
  assert.equal(seen[before], HOLE, 'and drain in seq order')
  assert.equal(tracker.state(PID)!.status, 'completed')
})

test('gives up on a hole once the reorder window is exceeded', () => {
  const tracker = createFlowTracker({ reorderWindow: 4 })
  const gaps: Array<{ pid: string; from: number; count: number }> = []
  tracker.on('gap', (g) => gaps.push(g))

  const events = realRun()
  for (const e of events) if (e.seq !== 6) tracker.ingest(e)

  assert.equal(gaps.length, 1, 'the lost event should be reported once')
  assert.deepEqual(gaps[0], { pid: PID, from: 6, count: 1 })
  assert.equal(tracker.state(PID)!.status, 'completed', 'and the stream carries on')
})

test('flush drains a hole that is never filled', () => {
  const tracker = createFlowTracker({ reorderWindow: 1000 })
  const events = realRun()
  for (const e of events) if (e.seq !== 6) tracker.ingest(e)

  assert.equal(tracker.state(PID)!.status, 'running', 'stuck behind the hole')

  tracker.flush()
  assert.equal(tracker.state(PID)!.status, 'completed')
  assert.equal(tracker.state(PID)!.pending, 0)
})

test('demultiplexes concurrent processes', () => {
  // The stream carries every process on the engine, interleaved.
  const a = realRun()
  const b = realRun().map((e) => ({ ...e, pid: 'other-pid' }))
  const interleaved: ProcEvent[] = []
  for (let i = 0; i < a.length; i++) {
    interleaved.push(a[i]!, b[i]!)
  }

  const states = replay(interleaved)
  assert.equal(states.size, 2)
  assert.equal(states.get(PID)!.status, 'completed')
  assert.equal(states.get('other-pid')!.status, 'completed')
})

test('tracks only the requested pid', () => {
  const mixed = [...realRun(), ...realRun().map((e) => ({ ...e, pid: 'someone-else' }))]
  const tracker = createFlowTracker({ pid: PID })
  tracker.ingestMany(mixed)

  assert.deepEqual(tracker.processes(), [PID])
  assert.equal(tracker.state('someone-else'), undefined)
})

test('attaches to a process already underway', () => {
  // Opening the drawer mid-run: history is gone, but the rest must still work.
  const tracker = createFlowTracker()
  tracker.ingestMany(realRun().filter((e) => e.seq >= 30))

  const state = tracker.state(PID)!
  assert.equal(state.status, 'completed')
  assert.equal(state.lastSeq, 58)
})

test('skips what it cannot use instead of throwing', () => {
  const tracker = createFlowTracker()
  const skipped: string[] = []
  tracker.on('skip', (s) => skipped.push(s.reason))

  tracker.ingest('Hello user: dev-panel with UUID: bc4abc63') // the socket banner
  tracker.ingest(null)
  tracker.ingest(42)
  tracker.ingest({ pid: 'x', node: {}, by: 'inflow-rt', type: 'info' }) // pre-v1
  tracker.ingest({ v: 99, pid: 'x', seq: 0, ts: 0, kind: 'log', level: 'info', src: 'rt' })
  tracker.ingest({ v: 1, pid: 'x' }) // right version, wrong shape

  assert.deepEqual(skipped, [
    'not-json',
    'not-an-object',
    'not-an-object',
    'legacy',
    'unsupported-version',
    'malformed',
  ])
  assert.deepEqual(tracker.processes(), [], 'nothing unusable should reach state')
})

test('accepts events as JSON strings', () => {
  // socket.io may hand over either, depending on configuration.
  const tracker = createFlowTracker()
  tracker.ingestMany(realRun().map((e) => JSON.stringify(e)))
  assert.equal(tracker.state(PID)!.status, 'completed')
})

test('passes through an unknown kind from a newer engine', () => {
  const tracker = createFlowTracker()
  const skipped: string[] = []
  tracker.on('skip', (s) => skipped.push(s.reason))
  tracker.ingest({
    v: 1,
    pid: 'x',
    seq: 0,
    ts: 1,
    kind: 'node.retry',
    level: 'info',
    src: 'rt',
  })
  assert.deepEqual(skipped, [], 'an unknown kind is forward compatibility, not garbage')
  assert.equal(tracker.state('x')!.lastSeq, 0)
})

test('a throwing subscriber does not break ingestion', () => {
  const tracker = createFlowTracker()
  tracker.on('move', () => {
    throw new Error('subscriber blew up')
  })
  let finished = false
  tracker.on('finish', () => {
    finished = true
  })

  tracker.ingestMany(realRun())
  assert.equal(finished, true)
})

test('unsubscribe stops delivery', () => {
  const tracker = createFlowTracker()
  let count = 0
  const off = tracker.on('move', () => count++)
  tracker.ingestMany(realRun().slice(0, 10))
  const afterFirst = count
  assert.ok(afterFirst > 0)

  off()
  tracker.ingestMany(realRun().slice(10))
  assert.equal(count, afterFirst, 'no further moves after unsubscribing')
})
