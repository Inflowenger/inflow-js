// The lab's mock data is the captured engine run the flow-trace tests already
// use — a real process covering a contract branch, a plugin failure, a GoTo
// across flows, and a loop. Hand-written events drift from what the engine
// actually emits; this cannot, because the parser's own tests would fail first.
import fixture from '../../../packages/flow-trace/test/fixtures/real-run.jsonl?raw'

/** One captured run, as the socket would hand it over: raw JSON lines. */
export const runLines: string[] = fixture
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

export const runPid: string = JSON.parse(runLines[0]).pid as string

/** Read a line's seq without committing to it being well-formed. */
function seqOf(line: string): number | undefined {
  try {
    const seq = JSON.parse(line).seq
    return typeof seq === 'number' ? seq : undefined
  } catch {
    return undefined
  }
}

/**
 * Swap adjacent pairs, which is what real reordering looks like: the engine
 * stamps seq synchronously but publishes concurrently, so neighbours trade
 * places and nothing is actually lost. The tracker should absorb this and emit
 * identical state — no gaps.
 */
function reorder(lines: string[]): string[] {
  const out = lines.slice()
  for (let i = 1; i + 1 < out.length; i += 2) {
    ;[out[i], out[i + 1]] = [out[i + 1], out[i]]
  }
  return out
}

/** Lose one event for good. The tracker should report a `gap` and carry on. */
function drop(lines: string[], seq: number): string[] {
  return lines.filter((line) => seqOf(line) !== seq)
}

/**
 * Traffic that isn't a v1 process event. The transport is shared, so this is
 * routine rather than exceptional — each one should surface on `skip` with a
 * reason and never disturb the run.
 */
const JUNK: string[] = [
  'socket connected', // not-json — a banner, not a message
  '[1, 2, 3]', // not-an-object
  '{"pid":"legacy","seq":0,"ts":0,"kind":"proc.start","level":"info","src":"rt"}', // legacy — pre-v1, no `v`
  '{"v":99,"pid":"x","seq":0,"ts":0,"kind":"proc.start","level":"info","src":"rt"}', // unsupported-version
  '{"v":1,"pid":"x","seq":"nope"}', // malformed — right shape, wrong fields
]

function sprinkleJunk(lines: string[]): string[] {
  const out: string[] = []
  // Spread every entry of JUNK across the run — each reason is worth seeing,
  // and leaving off the tail of the list would quietly drop one.
  const every = Math.max(1, Math.floor(lines.length / (JUNK.length + 1)))
  let next = 0
  lines.forEach((line, i) => {
    out.push(line)
    if (i > 0 && i % every === 0 && next < JUNK.length) out.push(JUNK[next++])
  })
  return out
}

export interface StreamOptions {
  /** Swap adjacent events, as a concurrent publisher does. */
  reorder?: boolean
  /** Drop this seq entirely. `undefined` drops nothing. */
  dropSeq?: number
  /** Mix in messages that are not v1 events. */
  junk?: boolean
}

/** Build the message sequence a mock socket will deliver. */
export function buildStream(options: StreamOptions = {}): string[] {
  let lines = runLines
  if (options.dropSeq !== undefined) lines = drop(lines, options.dropSeq)
  if (options.reorder) lines = reorder(lines)
  if (options.junk) lines = sprinkleJunk(lines)
  return lines
}

/** Seqs a run offers to drop, for the page's picker. */
export const droppableSeqs: number[] = runLines
  .map(seqOf)
  .filter((seq): seq is number => seq !== undefined && seq > 0)
