<script setup lang="ts">
import { ref, reactive, computed, onBeforeUnmount, watch } from 'vue'
import {
  createFlowTracker,
  replay,
  type FlowTracker,
  type NodeState,
  type ProcessState,
} from '@inflowenger/flow-trace'
import { buildStream, droppableSeqs, runLines, runPid } from '../mock/feed'

/**
 * A mock socket over a captured run.
 *
 * The tracker is fed one message at a time through `ingest`, exactly as a
 * socket handler would, so what you see is the live path — not the batch one.
 * `replay()` is here too for contrast: same events, no timeline.
 */
interface Emitted {
  id: number
  event: string
  text: string
  tone: 'plain' | 'ok' | 'warn' | 'err' | 'accent'
}

const options = reactive({
  reorder: false,
  junk: false,
  dropSeq: undefined as number | undefined,
  reorderWindow: 16,
})

const speed = ref(120)
const playing = ref(false)
const cursor = ref(0)
const stream = ref<string[]>([])
const snapshot = ref<ProcessState | null>(null)
const emitted = ref<Emitted[]>([])

let tracker: FlowTracker | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let nextId = 0

function log(event: string, text: string, tone: Emitted['tone'] = 'plain') {
  emitted.value.push({ id: nextId++, event, text, tone })
}

function wire(t: FlowTracker) {
  t.on('start', (e) => log('start', `entry ${e.entry.flow}:${e.entry.node}`, 'accent'))
  t.on('node:enter', (e) => log('node:enter', `${e.node.key} — ${e.node.title ?? e.node.type}`))
  t.on('node:exit', (e) =>
    log(
      'node:exit',
      `${e.node.key} ${e.status}${e.error ? ` — ${e.error}` : ''}`,
      e.status === 'ok' ? 'ok' : 'err',
    ),
  )
  t.on('move', (e) =>
    log(
      'move',
      `${e.from.node} → ${e.to.node} via ${e.edgeId || e.edgeKey}` +
        (e.reason?.length ? ` (contract said ${e.reason.join(', ')})` : ''),
      'accent',
    ),
  )
  t.on('jump', (e) =>
    log('jump', `${e.from.flow}:${e.from.node} → ${e.to.flow}:${e.to.node} (GoTo)`, 'warn'),
  )
  t.on('log', (e) => log('log', `[${e.level}] ${e.msg}`, e.level === 'error' ? 'err' : 'plain'))
  // A gap means events are gone for good — the run continues without them.
  t.on('gap', (e) => log('gap', `${e.count} event(s) lost from seq ${e.from}`, 'err'))
  // Not an error: the transport is shared and carries things that aren't events.
  t.on('skip', (e) => log('skip', `rejected (${e.reason}): ${JSON.stringify(e.input)}`, 'warn'))
}

function sync() {
  const state = tracker?.state(runPid)
  snapshot.value = state ? structuredClone(state) : null
}

function rebuild() {
  pause()
  tracker = createFlowTracker({ pid: runPid, reorderWindow: options.reorderWindow })
  wire(tracker)
  stream.value = buildStream(options)
  cursor.value = 0
  emitted.value = []
  snapshot.value = null
}

function step(): boolean {
  if (!tracker || cursor.value >= stream.value.length) return false
  tracker.ingest(stream.value[cursor.value++])
  sync()
  return true
}

function tick() {
  if (!step()) {
    pause()
    return
  }
  timer = setTimeout(tick, speed.value)
}

function play() {
  if (playing.value || cursor.value >= stream.value.length) return
  playing.value = true
  tick()
}

function pause() {
  playing.value = false
  clearTimeout(timer)
  timer = undefined
}

function runToEnd() {
  pause()
  while (step()) {
    /* drain */
  }
}

/** Apply what's held behind a hole that is never going to be filled. */
function flush() {
  tracker?.flush(runPid)
  sync()
}

/** The batch path: same events, ordered perfectly, no timeline. */
const replayed = computed(() => replay(runLines).get(runPid))

watch(options, rebuild, { immediate: true, deep: true })
onBeforeUnmount(pause)

const nodes = computed<NodeState[]>(() =>
  snapshot.value ? Object.values(snapshot.value.nodes) : [],
)
const edges = computed(() => (snapshot.value ? Object.values(snapshot.value.edges) : []))
const progress = computed(() =>
  stream.value.length ? Math.round((cursor.value / stream.value.length) * 100) : 0,
)

function statusTone(status: string) {
  if (status === 'ok' || status === 'completed') return 'ok'
  if (status === 'error' || status === 'failed') return 'err'
  if (status === 'running' || status === 'pending') return 'warn'
  return 'plain'
}
</script>

<template>
  <div class="page-head">
    <h1>Run Replay</h1>
    <p>
      A captured engine run — the same fixture the package's tests use — delivered to a
      <code>FlowTracker</code> one message at a time, the way a socket would. The run covers a
      contract branch, a plugin failure, a GoTo across flows, and a loop. Break the stream with the
      toggles below and watch what the tracker does about it.
    </p>
  </div>

  <div class="card">
    <div class="row">
      <button class="btn primary" :disabled="playing || cursor >= stream.length" @click="play">
        ▶ Play
      </button>
      <button class="btn" :disabled="!playing" @click="pause">❚❚ Pause</button>
      <button class="btn" :disabled="playing || cursor >= stream.length" @click="step">
        Step
      </button>
      <button class="btn" :disabled="playing || cursor >= stream.length" @click="runToEnd">
        Run to end
      </button>
      <button class="btn" @click="rebuild">Reset</button>
      <button class="btn" :disabled="!snapshot?.pending" @click="flush">
        Flush ({{ snapshot?.pending ?? 0 }} held)
      </button>

      <span class="spacer"></span>

      <label class="check">
        Speed
        <select v-model.number="speed" class="lab-select">
          <option :value="400">slow</option>
          <option :value="120">normal</option>
          <option :value="30">fast</option>
        </select>
      </label>
      <span class="badge">{{ cursor }} / {{ stream.length }} — {{ progress }}%</span>
    </div>

    <div class="row" style="margin-top: 12px">
      <label class="check">
        <input v-model="options.reorder" type="checkbox" />
        Reorder events
      </label>
      <label class="check">
        <input v-model="options.junk" type="checkbox" />
        Mix in non-events
      </label>
      <label class="check">
        Drop seq
        <select v-model.number="options.dropSeq" class="lab-select">
          <option :value="undefined">none</option>
          <option v-for="seq in droppableSeqs" :key="seq" :value="seq">{{ seq }}</option>
        </select>
      </label>
      <label class="check">
        Reorder window
        <select v-model.number="options.reorderWindow" class="lab-select">
          <option :value="1">1</option>
          <option :value="16">16 (default)</option>
          <option :value="Infinity">Infinity</option>
        </select>
      </label>
    </div>

    <p class="hint" style="margin: 12px 0 0">
      <strong>Reorder</strong> swaps neighbours the way a concurrent publisher does — nothing is
      lost, so the tracker absorbs it and the final state is unchanged. <strong>Drop</strong> takes
      an event away for good: the window fills, a <code>gap</code> is reported, and the run
      continues without it. <strong>Non-events</strong> are ordinary shared-transport traffic and
      land on <code>skip</code>. With the window at <code>Infinity</code> nothing resolves on its
      own — that is what <em>Flush</em> is for, and what <code>replay()</code> does at the end of a
      batch.
    </p>
  </div>

  <div class="card">
    <div class="card-title">
      Process
      <span class="badge" :class="statusTone(snapshot?.status ?? '')">
        {{ snapshot?.status ?? 'not started' }}
      </span>
    </div>
    <table class="lab-table">
      <tbody>
        <tr>
          <th>pid</th>
          <td class="mono">{{ runPid }}</td>
        </tr>
        <tr>
          <th>entry</th>
          <td class="mono">
            {{ snapshot?.entry ? `${snapshot.entry.flow}:${snapshot.entry.node}` : '—' }}
          </td>
        </tr>
        <tr>
          <th>duration</th>
          <td class="mono">{{ snapshot?.durationMs != null ? `${snapshot.durationMs} ms` : '—' }}</td>
        </tr>
        <tr>
          <th>error</th>
          <td class="mono">{{ snapshot?.error ?? '—' }}</td>
        </tr>
        <tr>
          <th>last seq / held</th>
          <td class="mono">{{ snapshot?.lastSeq ?? -1 }} / {{ snapshot?.pending ?? 0 }}</td>
        </tr>
        <tr>
          <th>replay() says</th>
          <td class="mono">
            {{ replayed?.status }} in {{ replayed?.durationMs }} ms —
            {{ Object.keys(replayed?.nodes ?? {}).length }} nodes,
            {{ Object.keys(replayed?.edges ?? {}).length }} edges
          </td>
        </tr>
      </tbody>
    </table>
    <p class="hint" style="margin-top: 10px">
      The last row folds the whole batch with <code>replay()</code> — the unbroken run's final
      answer, for comparison with whatever the live stream above ends up at.
    </p>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">
        Nodes
        <span class="badge">{{ nodes.length }}</span>
      </div>
      <p class="hint" style="margin-bottom: 10px">
        Keyed on <code>flow:node</code>, never the bare id — ids are unique only within a flow, and
        this run spans two. <code>attempts &gt; 1</code> is the loop: state stays bounded by the
        graph however many passes happen.
      </p>
      <div v-if="!nodes.length" class="empty">Nothing yet — press Play.</div>
      <div v-else class="scroll-y">
        <table class="lab-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Title</th>
              <th>Status</th>
              <th>Tries</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="node in nodes" :key="node.key">
              <td class="mono">{{ node.key }}</td>
              <td>
                {{ node.title ?? '—' }}
                <div class="hint">{{ node.type }}</div>
              </td>
              <td>
                <span class="badge" :class="statusTone(node.status)">{{ node.status }}</span>
                <div v-if="node.error" class="hint">{{ node.error }}</div>
              </td>
              <td class="mono">{{ node.attempts }}</td>
              <td class="mono">{{ node.durationMs ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        Edges
        <span class="badge">{{ edges.length }}</span>
      </div>
      <p class="hint" style="margin-bottom: 10px">
        Every edge the engine decided about. <code>taken: no</code> means evaluated and rejected —
        the branch to grey out. <code>taken</code> is sticky once true, so a loop that prunes an
        edge on a later pass cannot erase the fact that control went that way.
      </p>
      <div v-if="!edges.length" class="empty">Nothing yet — press Play.</div>
      <div v-else class="scroll-y">
        <table class="lab-table">
          <thead>
            <tr>
              <th>From → To</th>
              <th>Edge</th>
              <th>Tags</th>
              <th>Taken</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="edge in edges" :key="edge.key">
              <td class="mono">{{ edge.from.node }} → {{ edge.to.node }}</td>
              <td class="mono">{{ edge.edgeId || '(synthesised)' }}</td>
              <td class="mono">{{ edge.tags.length ? edge.tags.join(', ') : '—' }}</td>
              <td>
                <span class="badge" :class="edge.taken ? 'ok' : 'plain'">
                  {{ edge.taken ? `yes ×${edge.takenCount}` : 'no' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">
      Emitted
      <span class="badge">{{ emitted.length }}</span>
    </div>
    <p class="hint" style="margin-bottom: 10px">
      What the tracker told the subscriber, in order. This is the animation feed: events fire on
      every pass even where state does not change.
    </p>
    <div v-if="!emitted.length" class="empty">Nothing yet — press Play.</div>
    <div v-else class="scroll-y">
      <table class="lab-table">
        <tbody>
          <tr v-for="entry in emitted" :key="entry.id">
            <td style="width: 1%">
              <span class="badge" :class="entry.tone">{{ entry.event }}</span>
            </td>
            <td class="mono">{{ entry.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
