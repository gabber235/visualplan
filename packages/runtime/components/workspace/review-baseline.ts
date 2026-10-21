import type { WorkspaceDecision, WorkspaceModel } from './model.js'
import {
  codeReviewId,
  decisionReviewId,
  exampleReviewId,
  type ReviewRecord,
  type ReviewSnapshot,
} from './review-state.js'

type Example = WorkspaceDecision['examples'][number]
type Code = WorkspaceDecision['code'][number]
type Ownership = WorkspaceDecision['ownership'][number]
type Reasoning = NonNullable<WorkspaceDecision['reasoning']>

/** A recorded field, or the fallback when the snapshot predates that field. Empty means absent. */
function recorded(snapshot: ReviewSnapshot, key: string, fallback?: string): string | undefined {
  return key in snapshot ? snapshot[key]!.text || undefined : fallback
}

function parseJson(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Child fields a decision snapshot stores under `[kind, id, field]` keys, grouped by child id. */
function childSnapshots(
  snapshot: ReviewSnapshot,
  kind: 'example' | 'change' | 'visual' | 'ownership',
) {
  const children = new Map<string, ReviewSnapshot>()
  for (const [key, value] of Object.entries(snapshot)) {
    const path = key.startsWith('[') ? parseJson(key) : undefined
    if (!Array.isArray(path) || path[0] !== kind || typeof path[1] !== 'string') continue
    const child = children.get(path[1]) ?? {}
    child[typeof path[2] === 'string' ? path[2] : 'value'] = value
    children.set(path[1], child)
  }
  return children
}

/**
 * Current children in order, each replaced by its reviewed form, then reviewed children that no
 * longer exist. A child with no review is unchanged unless its decision snapshot proves it is new.
 */
function reviewedList<T extends { id: string }>(
  current: T[],
  reviewed: Map<string, ReviewSnapshot>,
  child: (id: string) => ReviewSnapshot | undefined,
  decisionReviewed: boolean,
  rebuild: (snapshot: ReviewSnapshot, id: string, entry?: T) => T | undefined,
): T[] {
  const list: T[] = []
  for (const entry of current) {
    const snapshot = child(entry.id) ?? reviewed.get(entry.id)
    const previous = snapshot ? rebuild(snapshot, entry.id, entry) : undefined
    if (previous) list.push(previous)
    else if (!snapshot && !decisionReviewed) list.push(entry)
  }
  for (const [id, snapshot] of reviewed) {
    if (current.some(entry => entry.id === id)) continue
    const previous = rebuild(snapshot, id)
    if (previous) list.push(previous)
  }
  return list
}

function reviewedExample(snapshot: ReviewSnapshot, id: string, entry?: Example): Example {
  const result = snapshot.result
  return {
    id,
    title: recorded(snapshot, 'title', entry?.title) ?? id,
    description: recorded(snapshot, 'description', entry?.description),
    language: snapshot.code?.language ?? entry?.language ?? 'text',
    code: recorded(snapshot, 'code', entry?.code) ?? '',
    outcome: recorded(snapshot, 'outcome', entry?.outcome),
    result: result
      ? {
          label: recorded(snapshot, 'resultLabel') ?? '',
          value: result.text,
          language: result.language ?? 'json',
        }
      : 'resultLabel' in snapshot || !entry
        ? undefined
        : entry.result,
  }
}

function reviewedCode(snapshot: ReviewSnapshot, id: string, entry?: Code): Code {
  // Snapshots store only the code parts that existed, so a missing part was absent.
  const parts = ['current', 'proposed', 'diff'].some(part => part in snapshot)
  const part = (key: 'current' | 'proposed' | 'diff') =>
    parts ? recorded(snapshot, key) : entry?.[key]
  return {
    role: 'edit',
    change: 'modify',
    invariants: [],
    callers: [],
    ...entry,
    id,
    file: recorded(snapshot, 'file', entry?.file) ?? '',
    symbol: recorded(snapshot, 'symbol', entry?.symbol) ?? id,
    language: recorded(snapshot, 'language', entry?.language),
    summary: recorded(snapshot, 'summary', entry?.summary),
    current: part('current'),
    proposed: part('proposed'),
    diff: part('diff'),
  }
}

function reviewedReasoning(text: string | undefined, current: WorkspaceDecision['reasoning']) {
  const value = parseJson(text)
  if (!value || typeof value !== 'object' || !('benefits' in value)) return current
  return value as Reasoning
}

function reviewedDecision(
  decision: WorkspaceDecision,
  reviews: Record<string, ReviewRecord>,
): WorkspaceDecision {
  const own = reviews[decisionReviewId(decision.id)]?.snapshot
  const snapshot = own ?? {}
  const reviewed = own !== undefined
  const exampleRecord = (id: string) => reviews[exampleReviewId(decision.id, id, 'code')]?.snapshot
  const codeRecord = (id: string) =>
    (['proposed', 'diff', 'current'] as const)
      .map(part => reviews[codeReviewId(decision.id, id, part)]?.snapshot)
      .find(Boolean)
  return {
    ...decision,
    title: recorded(snapshot, 'title', decision.title) ?? decision.title,
    goal: reviewed ? recorded(snapshot, 'goal') : decision.goal,
    summary: reviewed ? undefined : decision.summary,
    reasoning: reviewed
      ? reviewedReasoning(recorded(snapshot, 'reasoning'), decision.reasoning)
      : decision.reasoning,
    visuals: reviewedList(
      decision.visuals,
      childSnapshots(snapshot, 'visual'),
      () => undefined,
      reviewed,
      ({ value }, id) =>
        value && { id, title: value.label.replace(/^Visual: /, ''), source: value.text },
    ),
    ownership: reviewedList(
      decision.ownership,
      childSnapshots(snapshot, 'ownership'),
      () => undefined,
      reviewed,
      ({ value }, id, entry) => {
        const row = parseJson(value?.text)
        return row && typeof row === 'object' ? { ...(row as Ownership), id } : entry
      },
    ),
    examples: reviewedList(
      decision.examples,
      childSnapshots(snapshot, 'example'),
      exampleRecord,
      reviewed,
      reviewedExample,
    ),
    code: reviewedList(
      decision.code,
      childSnapshots(snapshot, 'change'),
      codeRecord,
      reviewed,
      reviewedCode,
    ),
  }
}

/**
 * What the reader last reviewed, rebuilt from saved review marks. Plans first opened before the
 * browser kept whole revisions have only these marks, so changes since review are still visible.
 * Content the reader never marked counts as unchanged.
 */
export function reviewedRevision(
  model: WorkspaceModel,
  reviews: Record<string, ReviewRecord>,
): WorkspaceModel | undefined {
  if (!Object.keys(reviews).length) return undefined
  return {
    ...model,
    decisions: model.decisions.map(decision => reviewedDecision(decision, reviews)),
  }
}
