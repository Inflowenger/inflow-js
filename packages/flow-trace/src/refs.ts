/**
 * Finding the node and edge ids inside a line of log text.
 *
 * Every readable name in a flow lives in the editor, never on the wire: the
 * stream says `n_mrv19bz0aownno`, and only the saved graph knows that is
 * "upsert". So a line of log text — whether {@link describeEvent} wrote it, or
 * a plugin, or user code in a JS node — is a mix of prose and ids, and a view
 * that wants to show titles has to find those ids first.
 *
 * That is all this does: split text into prose and references. Resolving a
 * reference to a title is the consumer's job, because only the consumer has the
 * graph — implement {@link GraphIndex} over whatever you already load and hand
 * it to {@link resolveRefs}.
 */

import type { NodeRef } from './types.js'

/**
 * Ids as the FloMorphic editor mints them: `n_…` for a node, `e_…` for an edge,
 * `flow_…` for a flow. A reference may carry its own `flow_…/` scope, because a
 * GoTo routes into another flow and ids are only unique within one.
 */
export const REF_PATTERN = /(?:(flow_[A-Za-z0-9]+)\/)?([ne]_[A-Za-z0-9]+)/g

/** A stretch of text that names nothing. */
export interface TextToken {
  kind: 'text'
  text: string
}

/** A reference to a node or an edge, scoped to the flow it belongs to. */
export interface RefToken {
  kind: 'node' | 'edge'
  /** The matched source text, scope prefix included. */
  text: string
  id: string
  /** The token's own `flow_…` scope, else the flow passed to {@link parseRefs}. */
  flow?: string
}

export type Token = TextToken | RefToken

/**
 * Split log text into prose and the ids it mentions.
 *
 * `flow` is the flow unscoped ids belong to — the event's own `flow`. Text with
 * no ids comes back as a single text token, so a caller can render every line
 * through the same path.
 */
export function parseRefs(text: string, flow?: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const match of text.matchAll(REF_PATTERN)) {
    const at = match.index ?? 0
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) })
    out.push({
      kind: match[2]!.startsWith('n_') ? 'node' : 'edge',
      text: match[0],
      id: match[2]!,
      flow: match[1] || flow,
    })
    last = at + match[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** What a consumer's graph knows about a node: the title it draws, and its type. */
export interface NamedNode {
  id: string
  title: string
  type?: string
}

/**
 * What a consumer's graph knows about an edge.
 *
 * `tags` is an edge's identity to a reader — it is the label drawn on it and
 * the reason a branch was taken. Endpoints are ids, resolvable in turn.
 */
export interface NamedEdge {
  id: string
  source: string
  target: string
  tags: string[]
}

/**
 * The graph, as this package needs to see it: two lookups, both allowed to
 * return nothing.
 *
 * Implement it over whatever the consumer already has (a store, a fetch cache,
 * a plain object). Returning `undefined` is normal and never an error — the
 * flow may still be loading, or may have been deleted since the run.
 */
export interface GraphIndex {
  node(flow: string | undefined, id: string): NamedNode | undefined
  edge(flow: string | undefined, id: string): NamedEdge | undefined
}

/** A token with a display label worked out. */
export type LabelledToken = (TextToken | RefToken) & {
  /** What to render. Falls back to the id when the graph can't name it. */
  label: string
  /** Whether the graph actually named this — style unresolved ids differently. */
  known: boolean
}

export interface ResolveOptions {
  /** The flow unscoped ids belong to. */
  flow?: string
  /**
   * Title for a node the graph can't name — e.g. the title a `node.enter`
   * carried, which is the one name that does arrive on the wire.
   */
  fallback?: string
  /** Cap on how much of an unresolved id to show. 0 keeps it whole. */
  shorten?: number
}

/** Trim an id for display; the full one belongs in a tooltip. */
function short(id: string, to: number): string {
  return to > 0 && id.length > to ? `${id.slice(0, to)}…` : id
}

/**
 * Split text and name every reference in it — the whole job in one call.
 *
 * ```ts
 * for (const t of resolveRefs(line, graph, { flow: event.flow })) {
 *   render(t.label, { faded: !t.known, title: t.kind !== 'text' ? t.id : undefined })
 * }
 * ```
 */
export function resolveRefs(
  text: string,
  graph: GraphIndex,
  options: ResolveOptions = {},
): LabelledToken[] {
  const { fallback, shorten = 10 } = options
  return parseRefs(text, options.flow).map((token) => {
    if (token.kind === 'text') return { ...token, label: token.text, known: false }
    if (token.kind === 'node') {
      const node = graph.node(token.flow, token.id)
      return {
        ...token,
        label: node?.title || fallback || short(token.id, shorten),
        known: !!node,
      }
    }
    const edge = graph.edge(token.flow, token.id)
    return {
      ...token,
      label: edge && edge.tags.length > 0 ? edge.tags.join(', ') : short(token.id, shorten),
      known: !!edge?.tags.length,
    }
  })
}

/**
 * Write a node reference the way {@link parseRefs} reads it back: bare inside
 * its own flow, `flow_…/n_…` when it leaves it (a GoTo). Use it when composing
 * text that a view will later resolve.
 */
export function refText(ref: Partial<NodeRef> | undefined, own?: string): string {
  if (!ref?.node) return ''
  return ref.flow && ref.flow !== own ? `${ref.flow}/${ref.node}` : ref.node
}
