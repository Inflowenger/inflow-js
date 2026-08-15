/**
 * One readable line per event.
 *
 * Every consumer that shows a stream needs this, and writing it twice means two
 * different vocabularies for the same run. The lines name nodes and edges by
 * **id**, on purpose: pair this with {@link resolveRefs} and the ids become the
 * titles the editor draws, without this module needing to know the graph.
 */

import { refText } from './refs.js'
import type {
  DepReadyFields,
  DepWaitFields,
  EdgeRef,
  EdgeSelectDetail,
  FlowJumpDetail,
  LogDetail,
  NodeEnterDetail,
  NodeExitDetail,
  ProcEvent,
  ProcFinishDetail,
  ProcStartDetail,
  ProgressLogFields,
  ProtocolLogFields,
  ResumeFields,
  ScopeFanoutFields,
} from './types.js'

/** `<target> via <edge>` — both ids, both resolvable. */
function endpoint(edge: EdgeRef, own?: string): string {
  const target = refText(edge, own)
  return edge.edgeId ? `${target} via ${edge.edgeId}` : target
}

function describeEdgeSelect(detail: EdgeSelectDetail, event: ProcEvent): string {
  const own = event.flow
  const taken = detail.taken ?? []
  const pruned = detail.pruned ?? []
  const from = `from ${event.node ?? '?'}`
  const reason = detail.reason?.tags?.length ? ` on [${detail.reason.tags.join(', ')}]` : ''
  // Name the skipped branches too — the branch that was *not* taken is usually
  // the one you opened the log to explain.
  const skipped =
    pruned.length > 0 ? `, skipped ${pruned.map((e) => endpoint(e, own)).join(', ')}` : ''
  if (taken.length === 0) return `${from} → nowhere${reason}${skipped}`
  return `${from} → to ${taken.map((e) => endpoint(e, own)).join(', ')}${reason}${skipped}`
}

function describeLog(detail: LogDetail): string {
  switch (detail.category) {
    case 'progress': {
      const d = detail as unknown as ProgressLogFields
      const label = [d.frame?.title, d.frame?.content].filter(Boolean).join(': ')
      const pct = `${d.percent ?? 0}%`
      return label ? `${pct} — ${label}` : pct
    }
    case 'protocol': {
      const d = detail as unknown as ProtocolLogFields
      const head = [d.proto, d.msg].filter(Boolean).join(' · ')
      return d.subject ? `${head} → ${d.subject}` : head
    }
    case 'dep.wait': {
      const d = detail as unknown as DepWaitFields
      const pending = d.pending ?? []
      // A wait carrying `waitedMs` is the abandoned variant: the process ended
      // with branches that will now never arrive.
      if (d.waitedMs !== undefined) {
        return `⏱ gave up waiting for ${pending.join(', ')} after ${d.waitedMs}ms`
      }
      return `⏸ waiting for ${pending.length} of ${(d.depends ?? []).length}: ${pending.join(', ')}`
    }
    case 'dep.ready': {
      const d = detail as unknown as DepReadyFields
      const depends = d.depends ?? []
      const waited = d.waitedMs !== undefined ? ` after ${d.waitedMs}ms` : ''
      return `▶ all ${depends.length} dependencies arrived${waited}: ${depends.join(', ')}`
    }
    case 'scope.fanout': {
      const d = detail as unknown as ScopeFanoutFields
      const locations = d.locations ?? []
      // `locations` is a capped sample, so say so rather than implying the list
      // is the whole fan-out — `count` is the authority on how many passes ran.
      const shown = locations.join(', ')
      const more = d.count > locations.length ? `, … (+${d.count - locations.length})` : ''
      return `⟳ scope ${d.scope} matched ${d.count} locations, one pass each: ${shown}${more}`
    }
    case 'resume': {
      const d = detail as unknown as ResumeFields
      // The applied variant carries counts; the skipped variant (warn) carries
      // only `msg` — a resume asked for but not applied (no snapshot, or the flow
      // drifted), so the run continued with blank state.
      if (d.seededNodes !== undefined) {
        return `↻ resumed from snapshot: seeded ${d.seededNodes} node(s), ${d.joinWatermarks ?? 0} join watermark(s)`
      }
      return typeof detail.msg === 'string' ? detail.msg : '↻ resume skipped — continuing with blank state'
    }
    default:
      return typeof detail.msg === 'string' ? detail.msg : ''
  }
}

/**
 * A one-line summary of an event, with ids left in for {@link resolveRefs}.
 *
 * An unknown kind — a newer engine — returns its kind rather than nothing, so a
 * view degrades to "something happened" instead of blank rows.
 */
export function describeEvent(event: ProcEvent): string {
  const detail = (event.detail ?? {}) as Record<string, unknown>
  switch (event.kind) {
    case 'proc.start': {
      const d = detail as unknown as ProcStartDetail
      return `Process started at ${refText({ flow: d.flow, node: d.node })}`
    }
    case 'proc.finish': {
      const d = detail as unknown as ProcFinishDetail
      const ms = d.durationMs ?? 0
      if (d.status === 'completed') return `Process completed in ${ms}ms`
      if (d.status === 'stopped') return `Process stopped after ${ms}ms`
      return `Process failed after ${ms}ms${d.error ? `: ${d.error}` : ''}`
    }
    case 'node.enter': {
      const d = detail as unknown as NodeEnterDetail
      const attempt = d.attempt > 1 ? ` (attempt ${d.attempt})` : ''
      return `→ ${event.node ?? d.title} entered${attempt}`
    }
    case 'node.exit': {
      const d = detail as unknown as NodeExitDetail
      if (d.status === 'error') return `✕ exited with error: ${d.error ?? 'unknown'}`
      return `✓ exited ok in ${d.durationMs ?? 0}ms`
    }
    case 'edge.select':
      return describeEdgeSelect(detail as unknown as EdgeSelectDetail, event)
    case 'flow.jump': {
      const d = detail as unknown as FlowJumpDetail
      const ret = d.ret ? `, returns at ${refText(d.ret)}` : ''
      return `Jumped to ${refText(d.to)}${ret}`
    }
    case 'log':
      return describeLog(detail as LogDetail)
    default:
      return String(event.kind)
  }
}
