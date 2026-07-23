import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeEvent, parseRefs, refText, resolveRefs } from '../src/index.js'
import type { GraphIndex, ProcEvent } from '../src/index.js'

/** A two-node graph, as a consumer's editor would know it. */
const graph: GraphIndex = {
  node(flow, id) {
    if (flow !== 'flow_1') return undefined
    const titles: Record<string, string> = { n_a: 'upsert', n_b: 'Retrieve' }
    return titles[id] ? { id, title: titles[id]!, type: 'code' } : undefined
  },
  edge(flow, id) {
    if (flow !== 'flow_1' || id !== 'e_ab') return undefined
    return { id, source: 'n_a', target: 'n_b', tags: ['approved'] }
  },
}

test('splits prose from the ids it mentions', () => {
  const tokens = parseRefs('from n_a → to n_b via e_ab', 'flow_1')
  assert.deepEqual(
    tokens.map((t) => [t.kind, 'id' in t ? t.id : t.text]),
    [
      ['text', 'from '],
      ['node', 'n_a'],
      ['text', ' → to '],
      ['node', 'n_b'],
      ['text', ' via '],
      ['edge', 'e_ab'],
    ],
  )
  assert.equal(tokens.every((t) => t.kind === 'text' || t.flow === 'flow_1'), true)
})

test('a scoped reference keeps its own flow — ids are only unique within one', () => {
  const [, jumped] = parseRefs('Jumped to flow_2/n_a', 'flow_1')
  assert.equal(jumped!.kind, 'node')
  assert.equal((jumped as { flow?: string }).flow, 'flow_2')
})

test('text with no ids comes back whole', () => {
  assert.deepEqual(parseRefs('nothing to see', 'flow_1'), [{ kind: 'text', text: 'nothing to see' }])
})

test('resolves ids to what the graph draws, and marks what it could not name', () => {
  const parts = resolveRefs('from n_a → to n_b via e_ab, skipped n_z', graph, { flow: 'flow_1' })
  const named = parts.filter((p) => p.kind !== 'text').map((p) => [p.label, p.known])
  assert.deepEqual(named, [
    ['upsert', true],
    ['Retrieve', true],
    // An edge reads as its tags: that is its label on the canvas and the reason
    // the branch was taken.
    ['approved', true],
    // Not in the graph (deleted, or a flow that never loaded) — the id stands.
    ['n_z', false],
  ])
})

test('an unresolvable node falls back to the title the wire did carry', () => {
  const [, node] = resolveRefs('→ n_z entered', graph, { flow: 'flow_1', fallback: 'Cleanup' })
  assert.equal(node!.label, 'Cleanup')
  assert.equal(node!.known, false)
})

test('refText scopes a reference only when it leaves its flow', () => {
  assert.equal(refText({ flow: 'flow_1', node: 'n_a' }, 'flow_1'), 'n_a')
  assert.equal(refText({ flow: 'flow_2', node: 'n_a' }, 'flow_1'), 'flow_2/n_a')
  assert.equal(refText(undefined), '')
})

function event(kind: string, detail: unknown, extra: Partial<ProcEvent> = {}): ProcEvent {
  return { v: 1, pid: 'p', seq: 1, ts: 1, kind, level: 'info', src: 'rt', detail, ...extra }
}

test('describes a routing decision as ids a view can resolve', () => {
  const line = describeEvent(
    event(
      'edge.select',
      {
        taken: [{ flow: 'flow_1', node: 'n_b', edgeId: 'e_ab', tags: [] }],
        pruned: [{ flow: 'flow_2', node: 'n_c', edgeId: 'e_ac', tags: [] }],
        reason: { tags: ['approved'] },
      },
      { flow: 'flow_1', node: 'n_a' },
    ),
  )
  assert.equal(line, 'from n_a → to n_b via e_ab on [approved], skipped flow_2/n_c via e_ac')

  // Round trip: every id in the description is resolvable, and the pruned
  // branch keeps the scope that says it lives in another flow.
  const ids = parseRefs(line, 'flow_1').filter((t) => t.kind !== 'text')
  assert.deepEqual(
    ids.map((t) => [(t as { id: string }).id, (t as { flow?: string }).flow]),
    [
      ['n_a', 'flow_1'],
      ['n_b', 'flow_1'],
      ['e_ab', 'flow_1'],
      ['n_c', 'flow_2'],
      ['e_ac', 'flow_1'],
    ],
  )
})

test('describes a join waiting, giving up, and being released', () => {
  assert.equal(
    describeEvent(event('log', { category: 'dep.wait', depends: ['n_a', 'n_b'], pending: ['n_b'] })),
    '⏸ waiting for 1 of 2: n_b',
  )
  assert.equal(
    describeEvent(
      event('log', { category: 'dep.wait', depends: ['n_a', 'n_b'], pending: ['n_b'], waitedMs: 4200 }),
    ),
    '⏱ gave up waiting for n_b after 4200ms',
  )
  assert.equal(
    describeEvent(event('log', { category: 'dep.ready', depends: ['n_a', 'n_b'], waitedMs: 120 })),
    '▶ all 2 dependencies arrived after 120ms: n_a, n_b',
  )
})

test('an unknown kind still describes itself', () => {
  assert.equal(describeEvent(event('node.warp', {})), 'node.warp')
})
