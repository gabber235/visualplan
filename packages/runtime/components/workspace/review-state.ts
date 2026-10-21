import { z } from 'zod'
import type { WorkspaceModel } from './model.js'
import { codeRemovalPart } from './model.js'

export const reviewStatusValues = ['unreviewed', 'accepted', 'denied'] as const
export type ReviewStatus = (typeof reviewStatusValues)[number]
const fieldSchema = z.preprocess(
  value => {
    // Older decisions without reasoning serialized this one field without its text property.
    if (
      value &&
      typeof value === 'object' &&
      'label' in value &&
      value.label === 'Decision reasoning' &&
      !('text' in value)
    )
      return { ...value, text: '' }
    return value
  },
  z.object({
    label: z.string(),
    text: z.string(),
    language: z.string().optional(),
  }),
)
export const reviewRecordSchema = z.object({
  status: z.enum(reviewStatusValues),
  snapshot: z.record(z.string(), fieldSchema),
  invalidated: z.boolean().default(false),
})
export type ReviewSnapshot = z.infer<typeof reviewRecordSchema>['snapshot']
export type ReviewRecord = z.infer<typeof reviewRecordSchema>
export interface ReviewItem {
  id: string
  label: string
  kind: 'decision' | 'code' | 'group'
  children: string[]
  snapshot: ReviewSnapshot
}

export function decisionReviewId(id: string): string {
  return JSON.stringify(['decision', id])
}

export function codeReviewId(decisionId: string, codeId: string, part: string): string {
  return JSON.stringify(['code', decisionId, codeId, part])
}

export function exampleReviewId(decisionId: string, exampleId: string, part: string): string {
  return JSON.stringify(['example', decisionId, exampleId, part])
}

export const planReviewId = JSON.stringify(['plan'])

export function reviewGroupId(
  decisionId: string,
  kind: 'changes' | 'example' | 'contract',
  id?: string,
) {
  return JSON.stringify(['group', decisionId, kind, ...(id ? [id] : [])])
}

function field(label: string, text: string | undefined, language?: string) {
  return { label, text: text ?? '', ...(language ? { language } : {}) }
}

/** Review identity follows authored IDs; validity follows the displayed content and its meaning. */
export function reviewItems(model: WorkspaceModel): Map<string, ReviewItem> {
  const items = new Map<string, ReviewItem>()
  items.set(planReviewId, {
    id: planReviewId,
    label: 'Plan',
    kind: 'group',
    snapshot: {},
    children: model.decisions.map(decision => decisionReviewId(decision.id)),
  })
  for (const decision of model.decisions) {
    const children: string[] = []
    const changesId = reviewGroupId(decision.id, 'changes')
    const changes: ReviewItem = {
      id: changesId,
      label: 'Change set',
      kind: 'group',
      snapshot: {},
      children: [],
    }
    items.set(changesId, changes)
    if (decision.code.some(code => code.role === 'edit')) children.push(changesId)
    const reasoning = decision.reasoning
      ? {
          benefits: [...decision.reasoning.benefits].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
          costs: [...decision.reasoning.costs].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
        }
      : decision.rationale
    const snapshot: ReviewSnapshot = {
      title: field('Decision title', decision.title),
      goal: field('Decision goal', decision.goal ?? decision.summary ?? ''),
      reasoning: field('Decision reasoning', JSON.stringify(reasoning, null, 2)),
    }
    for (const visual of decision.visuals)
      snapshot[JSON.stringify(['visual', visual.id])] = field(
        `Visual: ${visual.title}`,
        visual.source,
        'mdx',
      )
    for (const row of decision.ownership) {
      snapshot[JSON.stringify(['ownership', row.id])] = field(
        `Ownership: ${row.area}`,
        JSON.stringify({ ...row, removed: [...row.removed].sort() }, null, 2),
      )
    }
    for (const example of decision.examples) {
      const groupId = reviewGroupId(decision.id, 'example', example.id)
      const group: ReviewItem = {
        id: groupId,
        label: example.title,
        kind: 'group',
        snapshot: {},
        children: [exampleReviewId(decision.id, example.id, 'code')],
      }
      items.set(groupId, group)
      children.push(groupId)
      const context: ReviewSnapshot = {
        title: field('Example title', example.title),
        description: field('Usage context', example.description ?? ''),
        code: field('Illustrative usage', example.code, example.language),
        outcome: field('Expected behavior', example.outcome ?? ''),
        ...(example.result
          ? {
              resultLabel: field('Result label', example.result.label),
              result: field('Example result', example.result.value, example.result.language),
            }
          : {}),
      }
      items.set(exampleReviewId(decision.id, example.id, 'code'), {
        id: exampleReviewId(decision.id, example.id, 'code'),
        label: `${decision.id}: ${example.title}`,
        kind: 'code',
        children: [],
        snapshot: context,
      })
      for (const [key, value] of Object.entries(context))
        snapshot[JSON.stringify(['example', example.id, key])] = {
          ...value,
          label: `${example.title}: ${value.label}`,
        }
    }
    for (const code of decision.code) {
      const groupId = reviewGroupId(decision.id, 'contract', code.id)
      const group: ReviewItem = {
        id: groupId,
        label: `${code.file}: ${code.symbol}`,
        kind: 'group',
        snapshot: {},
        children: [],
      }
      items.set(groupId, group)
      if (code.role === 'model') children.push(groupId)
      else changes.children.push(groupId)
      const context: ReviewSnapshot = {
        file: field('File', code.file),
        symbol: field('Symbol', code.symbol),
        change: field('Change kind', code.change),
        language: field('Contract language', code.language ?? 'text'),
        summary: field('Contract explanation', code.summary ?? ''),
        invariants: field('Invariants', [...code.invariants].sort().join('\n')),
        callers: field('Callers', [...code.callers].sort().join('\n')),
      }
      const parts = code.diff ? (['diff'] as const) : (['current', 'proposed'] as const)
      for (const part of parts) {
        if (!code[part]) continue
        context[part] = field(
          part === 'diff'
            ? 'Proposed diff'
            : part === 'current'
              ? 'Existing code'
              : 'Proposed code',
          code[part],
          part === 'diff' ? 'diff' : code.language,
        )
      }
      for (const part of parts) {
        if ((part === 'current' && codeRemovalPart(code) !== 'current') || !code[part]) continue
        const id = codeReviewId(decision.id, code.id, part)
        group.children.push(id)
        items.set(id, {
          id,
          label: `${decision.id}: ${code.file}, ${code.symbol}, ${part}`,
          kind: 'code',
          children: [],
          snapshot: context,
        })
      }
      for (const [key, value] of Object.entries(context))
        snapshot[JSON.stringify(['change', code.id, key])] = {
          ...value,
          label: `${code.file}, ${code.symbol}: ${value.label}`,
        }
    }
    const id = decisionReviewId(decision.id)
    items.set(id, {
      id,
      label: `${decision.id}: ${decision.title}`,
      kind: 'decision',
      children,
      snapshot,
    })
  }
  return items
}

function snapshotText(snapshot: ReviewSnapshot): string {
  return JSON.stringify(
    Object.entries(snapshot)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => [key, value.text, value.language]),
  )
}

export function sameSnapshot(a: ReviewSnapshot, b: ReviewSnapshot): boolean {
  return snapshotText(a) === snapshotText(b)
}

/** Older snapshots copied the decision goal into blocks and repeated it in the decision. */
function reviewedSnapshot(item: ReviewItem, snapshot: ReviewSnapshot): ReviewSnapshot {
  const entries = Object.entries(snapshot)
  const local = entries.filter(([key]) => {
    if (item.kind === 'code') return key !== 'goal'
    if (item.kind === 'decision' && key === 'route') return false
    if (item.kind !== 'decision' || !key.startsWith('[')) return true
    try {
      const path: unknown = JSON.parse(key)
      return !(
        Array.isArray(path) &&
        path.length === 3 &&
        (path[0] === 'example' || path[0] === 'change') &&
        path[2] === 'goal'
      )
    } catch {
      return true
    }
  })
  return local.length === entries.length ? snapshot : Object.fromEntries(local)
}

/** Child content has its own review. Decisions retain their meaning and membership baseline. */
function comparisonSnapshot(item: ReviewItem, snapshot: ReviewSnapshot): ReviewSnapshot {
  const previous = reviewedSnapshot(item, snapshot)
  if (item.kind !== 'decision') return previous
  const local: ReviewSnapshot = {}
  const members = new Set<string>()
  for (const [key, value] of Object.entries(previous)) {
    if (key.startsWith('[')) {
      try {
        const path: unknown = JSON.parse(key)
        if (
          Array.isArray(path) &&
          path.length === 3 &&
          (path[0] === 'example' || path[0] === 'change')
        ) {
          members.add(`${path[0] === 'example' ? 'Example' : 'Code'}: ${path[1]}`)
          continue
        }
      } catch {
        // Unknown older keys remain part of the decision's meaning.
      }
    }
    local[key] = value
  }
  local.contents = field('Decision contents', [...members].sort().join('\n'))
  return local
}

function matchesReview(item: ReviewItem, record: ReviewRecord): boolean {
  return sameSnapshot(
    comparisonSnapshot(item, item.snapshot),
    comparisonSnapshot(item, record.snapshot),
  )
}

export function itemReviewStatus(item: ReviewItem, record?: ReviewRecord): ReviewStatus {
  return record && !record.invalidated && matchesReview(item, record) ? record.status : 'unreviewed'
}

export interface ReviewSummary {
  status: ReviewStatus
  ownStatus: ReviewStatus
  deniedChildren: number
  unreviewedItems: number
  invalidated: boolean
  ownInvalidated: boolean
}

/** Parent status is derived from current marks, never stored as a second source of truth. */
export function summarizeReview(
  id: string,
  items: Map<string, ReviewItem>,
  reviews: Record<string, ReviewRecord>,
): ReviewSummary {
  const item = items.get(id)
  if (!item) throw new Error(`Unknown review item: ${id}`)
  const children = item.children.map(child => summarizeReview(child, items, reviews))
  const deniedChildren = children.reduce(
    (count, child) => count + child.deniedChildren + (child.ownStatus === 'denied' ? 1 : 0),
    0,
  )
  const ownStatus = item.kind === 'group' ? 'unreviewed' : itemReviewStatus(item, reviews[id])
  const record = reviews[id]
  const ownInvalidated =
    item.kind !== 'group' && Boolean(record && (record.invalidated || !matchesReview(item, record)))
  const statuses = children.map(child => child.status)
  const requiresOwnMark =
    item.kind === 'code' || (item.kind === 'decision' && (!children.length || ownInvalidated))
  if (requiresOwnMark || ownStatus === 'denied') statuses.push(ownStatus)
  return {
    ownStatus,
    deniedChildren,
    unreviewedItems:
      children.reduce((count, child) => count + child.unreviewedItems, 0) +
      (requiresOwnMark && ownStatus === 'unreviewed' ? 1 : 0),
    ownInvalidated,
    invalidated: ownInvalidated || children.some(child => child.invalidated),
    status: statuses.includes('denied')
      ? 'denied'
      : statuses.length > 0 && statuses.every(status => status === 'accepted')
        ? 'accepted'
        : 'unreviewed',
  }
}

/** Decision actions fill only unreviewed descendants and cannot override a nested denial. */
export function markReview(
  id: string,
  status: ReviewStatus,
  items: Map<string, ReviewItem>,
  reviews: Record<string, ReviewRecord>,
): Record<string, ReviewRecord> {
  const item = items.get(id)
  if (!item || item.kind === 'group') throw new Error(`Unknown reviewable item: ${id}`)
  if (status === 'accepted' && summarizeReview(id, items, reviews).deniedChildren > 0)
    return reviews
  const next = { ...reviews, [id]: { status, snapshot: item.snapshot, invalidated: false } }
  if (item.kind === 'decision' && status !== 'unreviewed') {
    const visit = (childId: string) => {
      const child = items.get(childId)!
      if (child.kind !== 'group' && itemReviewStatus(child, reviews[childId]) === 'unreviewed')
        next[childId] = { status, snapshot: child.snapshot, invalidated: false }
      child.children.forEach(visit)
    }
    item.children.forEach(visit)
  }
  if (
    item.kind === 'code' &&
    status === 'accepted' &&
    itemReviewStatus(item, reviews[id]) !== 'accepted'
  )
    reviewChangedDecisions(id, items, next)
  return captureDecisionBaselines(items, next)
}

/** Accepting the last open child of a changed decision reviews the decision's new contents. */
function reviewChangedDecisions(
  codeId: string,
  items: Map<string, ReviewItem>,
  reviews: Record<string, ReviewRecord>,
) {
  const contains = (id: string): boolean =>
    id === codeId || (items.get(id)?.children.some(contains) ?? false)
  for (const item of items.values()) {
    if (item.kind !== 'decision' || !item.children.some(contains)) continue
    if (!summarizeReview(item.id, items, reviews).ownInvalidated) continue
    const children = item.children.map(child => summarizeReview(child, items, reviews))
    if (children.every(child => child.status === 'accepted'))
      reviews[item.id] = { status: 'unreviewed', snapshot: item.snapshot, invalidated: false }
  }
}

/** Derived acceptance still needs a baseline to identify later changes to the decision itself. */
function captureDecisionBaselines(
  items: Map<string, ReviewItem>,
  reviews: Record<string, ReviewRecord>,
) {
  for (const item of items.values()) {
    if (item.kind !== 'decision' || !item.children.length || reviews[item.id]) continue
    if (summarizeReview(item.id, items, reviews).status === 'accepted') {
      reviews[item.id] = { status: 'unreviewed', snapshot: item.snapshot, invalidated: false }
    }
  }
  return reviews
}

/** Invalidation is persisted so reverting content cannot silently revive a dismissed approval. */
export function reconcileReviews(
  items: Map<string, ReviewItem>,
  reviews: Record<string, ReviewRecord>,
) {
  const next: Record<string, ReviewRecord> = {}
  for (const [id, item] of items) {
    if (item.kind === 'group') continue
    const saved = reviews[id]
    if (!saved) continue
    const snapshot = reviewedSnapshot(item, saved.snapshot)
    const record = snapshot === saved.snapshot ? saved : { ...saved, snapshot }
    next[id] = matchesReview(item, record)
      ? record
      : { ...record, status: 'unreviewed', invalidated: true }
  }
  return captureDecisionBaselines(items, next)
}

export function changedReviewFields(item: ReviewItem, record: ReviewRecord) {
  const previous = comparisonSnapshot(item, record.snapshot)
  const current = comparisonSnapshot(item, item.snapshot)
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter(
      key =>
        JSON.stringify([previous[key]?.text, previous[key]?.language]) !==
        JSON.stringify([current[key]?.text, current[key]?.language]),
    )
    .map(key => ({ key, previous: previous[key], current: current[key] }))
}

/** Exact line comparison preserves case, punctuation, whitespace, and empty lines in code. */
export function reviewLineDiff(previous: string, current: string) {
  const before = previous.split('\n')
  const after = current.split('\n')
  type Line = { kind: 'same' | 'removed' | 'added'; text: string; id: string }
  if (before.length * after.length > 1_000_000)
    return [
      ...before.map((text, line) => ({ kind: 'removed' as const, text, id: `before:${line}` })),
      ...after.map((text, line) => ({ kind: 'added' as const, text, id: `after:${line}` })),
    ]
  const matrix = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1))
  for (let a = before.length - 1; a >= 0; a--)
    for (let b = after.length - 1; b >= 0; b--)
      matrix[a]![b] =
        before[a] === after[b]
          ? matrix[a + 1]![b + 1]! + 1
          : Math.max(matrix[a + 1]![b]!, matrix[a]![b + 1]!)
  const lines: Line[] = []
  let a = 0
  let b = 0
  while (a < before.length || b < after.length) {
    if (a < before.length && b < after.length && before[a] === after[b]) {
      lines.push({ kind: 'same', text: before[a]!, id: `same:${a}:${b}` })
      a++
      b++
    } else if (
      a < before.length &&
      (b === after.length || matrix[a + 1]![b]! >= matrix[a]![b + 1]!)
    ) {
      lines.push({ kind: 'removed', text: before[a]!, id: `before:${a}` })
      a++
    } else {
      lines.push({ kind: 'added', text: after[b]!, id: `after:${b}` })
      b++
    }
  }
  return lines
}
