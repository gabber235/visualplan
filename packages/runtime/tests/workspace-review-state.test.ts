import { describe, expect, it } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import {
  decisionReviewId,
  exampleReviewId,
  codeReviewId,
  itemReviewStatus,
  reconcileReviews,
  reviewItems,
  reviewLineDiff,
  changedReviewFields,
  type ReviewRecord,
  markReview,
  summarizeReview,
  reviewGroupId,
  planReviewId,
} from '../components/workspace/review-state.js'

const source = {
  vision: { problem: 'Many writers', outcome: 'One writer' },
  decisions: [
    {
      id: 'D1',
      title: 'Typed edits',
      goal: 'Return an explicit edit result.',
      reasoning: { benefits: [{ title: 'One owner', detail: 'The owner preserves invariants.' }] },
      examples: [
        {
          id: 'edit',
          title: 'Edit a title',
          description: 'A caller uses the proposed API.',
          language: 'typescript',
          code: "const page = await editor.rename('Dune')",
          outcome: 'The caller receives the updated page.',
          result: { label: 'Title', language: 'text', value: 'Dune' },
        },
        {
          id: 'subscribe',
          title: 'Observe edits',
          description: 'A subscriber observes changes.',
          language: 'typescript',
          code: 'editor.changes.subscribe(render)',
          outcome: 'Updates reach the subscriber.',
        },
      ],
      code: [
        {
          id: 'rename',
          file: 'editor.ts',
          symbol: 'rename',
          language: 'typescript',
          summary: 'Return the updated page.',
          current: 'return null',
          proposed: 'return page',
          invariants: ['One writer'],
        },
      ],
    },
    {
      id: 'D2',
      title: 'Keep history',
      goal: 'Record one history entry.',
      reasoning: { benefits: [{ title: 'Traceability', detail: 'Every edit has an owner.' }] },
    },
  ],
}

const model = planWorkspaceSchema.parse(source)
const items = reviewItems(model)
const editId = exampleReviewId('D1', 'edit', 'code')
const subscribeId = exampleReviewId('D1', 'subscribe', 'code')
const decisionId = decisionReviewId('D1')
const secondDecisionId = decisionReviewId('D2')
const approved: Record<string, ReviewRecord> = Object.fromEntries(
  [...items]
    .filter(([, item]) => item.kind !== 'group')
    .map(([id, item]) => [id, { status: 'accepted', snapshot: item.snapshot, invalidated: false }]),
)

function changedExample(change: Record<string, unknown>) {
  return reviewItems(
    planWorkspaceSchema.parse({
      ...source,
      decisions: [
        {
          ...source.decisions[0],
          examples: [
            { ...source.decisions[0]!.examples![0], ...change },
            source.decisions[0]!.examples![1],
          ],
        },
        source.decisions[1],
      ],
    }),
  )
}

describe('Content bound browser review marks', () => {
  it.each([
    'accepted',
    'denied',
  ] as const)('keeps %s block marks when only the decision description changes', status => {
    const records = Object.fromEntries(
      Object.entries(approved).map(([id, record]) => [id, { ...record, status }]),
    )
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          { ...source.decisions[0], goal: 'Explain the ownership boundary more clearly.' },
          source.decisions[1],
        ],
      }),
    )
    const next = reconcileReviews(nextItems, records)
    for (const item of nextItems.values()) {
      if (item.kind !== 'code') continue
      expect(itemReviewStatus(item, next[item.id]), item.label).toBe(status)
      expect(next[item.id]?.invalidated, item.label).toBe(false)
      expect(changedReviewFields(item, next[item.id]!)).toEqual([])
    }
    expect(next[decisionId]?.status).toBe('unreviewed')
    expect(
      changedReviewFields(nextItems.get(decisionId)!, next[decisionId]!).map(f => f.key),
    ).toEqual(['goal'])
  })

  it('preserves saved block approvals that used to include the decision description', () => {
    const record = {
      ...approved[editId]!,
      snapshot: {
        ...approved[editId]!.snapshot,
        goal: { label: 'Decision goal', text: 'An older decision description.' },
      },
    }
    const next = reconcileReviews(items, { [editId]: record })
    expect(itemReviewStatus(items.get(editId)!, record)).toBe('accepted')
    expect(itemReviewStatus(items.get(editId)!, next[editId])).toBe('accepted')
    expect(changedReviewFields(items.get(editId)!, record)).toEqual([])
  })

  it('ignores removed implementation routes when restoring older decision marks', () => {
    const record = {
      ...approved[decisionId]!,
      snapshot: {
        ...approved[decisionId]!.snapshot,
        route: { label: 'Implementation route', text: 'Legacy route' },
      },
    }
    expect(itemReviewStatus(items.get(decisionId)!, record)).toBe('accepted')
    expect(changedReviewFields(items.get(decisionId)!, record)).toEqual([])
  })

  it('does not show repeated inherited descriptions from older decision snapshots', () => {
    const goal = { label: 'Decision goal', text: source.decisions[0]!.goal }
    const record = {
      ...approved[decisionId]!,
      snapshot: {
        ...approved[decisionId]!.snapshot,
        [JSON.stringify(['example', 'edit', 'goal'])]: goal,
        [JSON.stringify(['change', 'rename', 'goal'])]: goal,
      },
    }
    expect(itemReviewStatus(items.get(decisionId)!, record)).toBe('accepted')
    expect(changedReviewFields(items.get(decisionId)!, record)).toEqual([])
  })

  it('shows only local meaning changes when the decision description also changes', () => {
    const record = {
      ...approved[editId]!,
      snapshot: {
        ...approved[editId]!.snapshot,
        goal: { label: 'Decision goal', text: 'An older decision description.' },
      },
    }
    const nextItems = changedExample({ outcome: 'The caller receives a typed rejection.' })
    expect(changedReviewFields(nextItems.get(editId)!, record).map(f => f.key)).toEqual(['outcome'])
  })

  it('reviews each example once and proposals while keeping existing code as context', () => {
    const blockIds = [...items.values()].filter(item => item.kind === 'code').map(item => item.id)
    expect(blockIds).toHaveLength(3)
    expect(blockIds).not.toContain(exampleReviewId('D1', 'edit', 'result'))
    expect(blockIds).not.toContain(codeReviewId('D1', 'rename', 'current'))
    expect(blockIds).toContain(codeReviewId('D1', 'rename', 'proposed'))
    expect(items.get(codeReviewId('D1', 'rename', 'proposed'))?.snapshot.current?.text).toBe(
      'return null',
    )
    expect(itemReviewStatus(items.get(editId)!, approved[subscribeId])).toBe('unreviewed')
  })

  it('discards saved existing code denials without affecting proposal approval', () => {
    const currentId = codeReviewId('D1', 'rename', 'current')
    const proposedId = codeReviewId('D1', 'rename', 'proposed')
    const restored = reconcileReviews(items, {
      ...approved,
      [currentId]: { ...approved[proposedId]!, status: 'denied' },
    })
    expect(restored[currentId]).toBeUndefined()
    expect(restored[proposedId]).toBe(approved[proposedId])
    expect(summarizeReview(decisionId, items, restored).status).toBe('accepted')
  })

  it('invalidates proposal approval when the existing comparison changes', () => {
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          {
            ...source.decisions[0],
            code: [{ ...source.decisions[0]!.code![0], current: 'return undefined' }],
          },
          source.decisions[1],
        ],
      }),
    )
    const next = reconcileReviews(nextItems, approved)
    expect(next[codeReviewId('D1', 'rename', 'proposed')]?.status).toBe('unreviewed')
    expect(next[editId]).toBe(approved[editId])
  })

  it('retains unchanged marks after reload and unrelated edits', () => {
    const nextItems = changedExample({ code: "const page = await editor.rename('New title')" })
    const next = reconcileReviews(nextItems, JSON.parse(JSON.stringify(approved)))
    expect(next[editId]?.status).toBe('unreviewed')
    expect(next[decisionId]?.status).toBe('accepted')
    expect(summarizeReview(decisionId, nextItems, next).status).toBe('unreviewed')
    expect(next[secondDecisionId]?.status).toBe('accepted')
    expect(next[subscribeId]?.status).toBe('accepted')
    expect(next[codeReviewId('D1', 'rename', 'proposed')]?.status).toBe('accepted')
    expect(next[editId]?.invalidated).toBe(true)
  })

  it.each([
    { description: 'The caller must hold an edit lease.' },
    { outcome: 'The operation may throw on a stale draft.' },
    { language: 'javascript' },
    { result: { label: 'Result', language: 'json', value: '{"status":"rejected"}' } },
  ])('resets a mark when usage meaning changes: %j', change => {
    const next = reconcileReviews(changedExample(change), approved)
    expect(next[editId]?.status).toBe('unreviewed')
    expect(next[subscribeId]?.status).toBe('accepted')
  })

  it('resets contract marks when its explanation or invariants change', () => {
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          {
            ...source.decisions[0],
            code: [{ ...source.decisions[0]!.code![0], invariants: ['May write more than once'] }],
          },
          source.decisions[1],
        ],
      }),
    )
    expect(
      reconcileReviews(nextItems, approved)[codeReviewId('D1', 'rename', 'proposed')]?.status,
    ).toBe('unreviewed')
    expect(reconcileReviews(nextItems, approved)[subscribeId]?.status).toBe('accepted')
  })

  it('counts only displayed code and tracks the language even for unified diffs', () => {
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          { ...source.decisions[0], code: [{ ...source.decisions[0]!.code![0], current: '' }] },
          source.decisions[1],
        ],
      }),
    )
    expect(nextItems.has(codeReviewId('D1', 'rename', 'current'))).toBe(false)
    const diffItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          {
            ...source.decisions[0],
            code: [
              {
                ...source.decisions[0]!.code![0],
                diff: '-return null\n+return page',
                language: 'kotlin',
              },
            ],
          },
          source.decisions[1],
        ],
      }),
    )
    expect(diffItems.get(codeReviewId('D1', 'rename', 'diff'))?.snapshot.language?.text).toBe(
      'kotlin',
    )
  })

  it('ignores authored acceptance and presentation order when validating marks', () => {
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          {
            ...source.decisions[0],
            status: 'accepted',
            examples: [...source.decisions[0]!.examples!].reverse(),
          },
          source.decisions[1],
        ],
      }),
    )
    expect(reconcileReviews(nextItems, approved)[decisionId]?.status).toBe('accepted')
    expect(itemReviewStatus(nextItems.get(decisionId)!)).toBe('unreviewed')
  })

  it('invalidates denial as well as acceptance', () => {
    const denied = { ...approved, [editId]: { ...approved[editId]!, status: 'denied' as const } }
    const nextItems = changedExample({ code: 'await editor.rename(title)' })
    expect(reconcileReviews(nextItems, denied)[editId]?.status).toBe('unreviewed')
    expect(denied[editId]?.status).toBe('denied')
  })

  it('does not resurrect a review after a code change is reverted', () => {
    const nextItems = changedExample({ code: 'await editor.rename(title)' })
    const invalidated = reconcileReviews(nextItems, approved)
    const reverted = reconcileReviews(items, JSON.parse(JSON.stringify(invalidated)))
    expect(reverted[editId]?.status).toBe('unreviewed')
    expect(reverted[editId]?.invalidated).toBe(true)
  })

  it('does not attach removed marks to reintroduced IDs', () => {
    const without = reviewItems(
      planWorkspaceSchema.parse({ ...source, decisions: [source.decisions[1]] }),
    )
    const remaining = reconcileReviews(without, approved)
    expect(remaining[decisionId]).toBeUndefined()
    expect(reconcileReviews(items, remaining)[editId]).toBeUndefined()
  })

  it('shows precisely the changed field against the last reviewed snapshot', () => {
    const nextItems = changedExample({ outcome: 'The caller receives a typed rejection.' })
    expect(changedReviewFields(nextItems.get(editId)!, approved[editId]!)).toMatchObject([
      {
        key: 'outcome',
        previous: { text: 'The caller receives the updated page.' },
        current: { text: 'The caller receives a typed rejection.' },
      },
    ])
  })
})

describe('Hierarchical browser review marks', () => {
  const proposedId = codeReviewId('D1', 'rename', 'proposed')
  const contractId = reviewGroupId('D1', 'contract', 'rename')
  const changesId = reviewGroupId('D1', 'changes')
  const status = (id: string, reviews: Record<string, ReviewRecord>, tree = items) =>
    summarizeReview(id, tree, reviews).status

  it('includes model proposals in decision review while keeping edit group independent', () => {
    const tree = reviewItems(
      planWorkspaceSchema.parse({
        decisions: [
          {
            id: 'D1',
            title: 'Share ownership',
            code: [
              {
                id: 'model',
                role: 'model',
                file: 'policy.ts',
                symbol: 'Policy',
                current: 'service.allow()',
                proposed: 'gateway.decide()',
              },
              { id: 'edit', file: 'handler.ts', symbol: 'handle', proposed: 'dispatch(request)' },
            ],
          },
        ],
      }),
    )
    const modelId = codeReviewId('D1', 'model', 'proposed')
    const editId = codeReviewId('D1', 'edit', 'proposed')
    const records = markReview(modelId, 'denied', tree, markReview(editId, 'accepted', tree, {}))
    expect(summarizeReview(changesId, tree, records).status).toBe('accepted')
    expect(summarizeReview(decisionId, tree, records).status).toBe('denied')
    expect(summarizeReview(planReviewId, tree, records).status).toBe('denied')
    expect(summarizeReview(decisionId, tree, {}).unreviewedItems).toBe(2)
    expect(markReview(decisionId, 'accepted', tree, records)).toBe(records)
  })

  it('propagates a nested denial through its contract, change set, decision, and plan', () => {
    const reviews = markReview(proposedId, 'denied', items, approved)
    for (const id of [proposedId, contractId, changesId, decisionId, planReviewId])
      expect(status(id, reviews)).toBe('denied')
    expect(status(secondDecisionId, reviews)).toBe('accepted')
    expect(reviews[changesId]).toBeUndefined()
  })

  it('accepts unreviewed descendants without replacing their explicit marks', () => {
    const partial = markReview(editId, 'accepted', items, {})
    const reviews = markReview(decisionId, 'accepted', items, partial)
    expect(reviews[editId]).toBe(partial[editId])
    for (const item of items.values()) {
      if (item.kind === 'code') expect(status(item.id, reviews)).toBe('accepted')
    }
    expect(status(decisionId, reviews)).toBe('accepted')
    expect(status(secondDecisionId, reviews)).toBe('unreviewed')
    expect(status(planReviewId, reviews)).toBe('unreviewed')
  })

  it('denies only unreviewed descendants and preserves accepted children', () => {
    const partial = markReview(editId, 'accepted', items, {})
    const reviews = markReview(decisionId, 'denied', items, partial)
    expect(reviews[editId]).toBe(partial[editId])
    expect(status(proposedId, reviews)).toBe('denied')
    expect(status(secondDecisionId, reviews)).toBe('unreviewed')
    expect(status(decisionId, reviews)).toBe('denied')
  })

  it('blocks decision acceptance when a child is denied, including after reload', () => {
    const reviews = markReview(proposedId, 'denied', items, {})
    expect(markReview(decisionId, 'accepted', items, reviews)).toBe(reviews)
    const saved = reconcileReviews(items, JSON.parse(JSON.stringify(reviews)))
    expect(status(planReviewId, saved)).toBe('denied')
    expect(markReview(decisionId, 'accepted', items, saved)).toBe(saved)
    const resolved = markReview(proposedId, 'accepted', items, saved)
    expect(status(decisionId, markReview(decisionId, 'accepted', items, resolved))).toBe('accepted')
  })

  it.each(['accepted', 'denied'] as const)('undoes only the explicit %s decision mark', mark => {
    const reviews = markReview(decisionId, mark, items, {})
    const next = markReview(decisionId, 'unreviewed', items, reviews)
    expect(next[decisionId]?.status).toBe('unreviewed')
    for (const item of items.values()) {
      if (item.kind === 'code') expect(next[item.id]).toBe(reviews[item.id])
    }
    expect(status(decisionId, next)).toBe(mark)
  })

  it('resets derived denial when the denied contract changes without clearing unrelated marks', () => {
    const reviews = markReview(proposedId, 'denied', items, approved)
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          {
            ...source.decisions[0],
            code: [
              {
                ...source.decisions[0]!.code![0],
                summary: 'Return an explicit rejection on failure.',
              },
            ],
          },
          source.decisions[1],
        ],
      }),
    )
    const next = reconcileReviews(nextItems, reviews)
    for (const id of [proposedId, contractId, changesId, decisionId, planReviewId])
      expect(status(id, next, nextItems)).toBe('unreviewed')
    expect(status(editId, next, nextItems)).toBe('accepted')
    expect(status(secondDecisionId, next, nextItems)).toBe('accepted')
    expect(summarizeReview(changesId, nextItems, next).invalidated).toBe(true)
  })

  it('automatically accepts a decision when all children are accepted', () => {
    const reviews = { ...approved }
    delete reviews[decisionId]
    expect(status(changesId, reviews)).toBe('accepted')
    expect(status(decisionId, reviews)).toBe('accepted')
    expect(summarizeReview(decisionId, items, reviews).unreviewedItems).toBe(0)
    expect(status(secondDecisionId, reviews)).toBe('accepted')
  })

  it('requires review of changed decision meaning while keeping unchanged code accepted', () => {
    const nextItems = reviewItems(
      planWorkspaceSchema.parse({
        ...source,
        decisions: [
          { ...source.decisions[0], goal: 'Clarify the decision description.' },
          source.decisions[1],
        ],
      }),
    )
    const next = reconcileReviews(nextItems, approved)
    expect(next[decisionId]?.status).toBe('unreviewed')
    expect(status(decisionId, next, nextItems)).toBe('unreviewed')
    expect(status(planReviewId, next, nextItems)).toBe('unreviewed')
    expect(summarizeReview(decisionId, nextItems, next).invalidated).toBe(true)
    expect(status(proposedId, next, nextItems)).toBe('accepted')
    const accepted = markReview(decisionId, 'accepted', nextItems, next)
    expect(status(decisionId, accepted, nextItems)).toBe('accepted')
    expect(summarizeReview(decisionId, nextItems, accepted).invalidated).toBe(false)
  })

  it('accepts a changed decision once the user accepts every child it contains', () => {
    const revised = structuredClone(model)
    revised.decisions[0]!.goal = 'Clarify the decision description.'
    revised.decisions[0]!.examples[0]!.code = "const page = await editor.rename('Emma')"
    const nextItems = reviewItems(revised)
    const next = reconcileReviews(nextItems, approved)
    expect(status(decisionId, next, nextItems)).toBe('unreviewed')
    const accepted = markReview(editId, 'accepted', nextItems, next)
    expect(summarizeReview(decisionId, nextItems, accepted)).toMatchObject({
      status: 'accepted',
      invalidated: false,
    })
    expect(status(planReviewId, accepted, nextItems)).toBe('accepted')
  })

  it('keeps a changed decision open when only its own meaning changed', () => {
    const revised = structuredClone(model)
    revised.decisions[0]!.goal = 'Clarify the decision description.'
    const nextItems = reviewItems(revised)
    const next = reconcileReviews(nextItems, approved)
    expect(status(decisionId, next, nextItems)).toBe('unreviewed')
    expect(status(decisionId, markReview(editId, 'accepted', nextItems, next), nextItems)).toBe(
      'unreviewed',
    )
  })

  it('keeps a reverted decision changed until the user reviews it again', () => {
    const revised = structuredClone(model)
    revised.decisions[0]!.goal = 'Another ownership rule'
    const changed = reconcileReviews(reviewItems(revised), approved)
    const reverted = reconcileReviews(items, JSON.parse(JSON.stringify(changed)))
    expect(summarizeReview(decisionId, items, reverted)).toMatchObject({
      status: 'unreviewed',
      ownInvalidated: true,
    })
    expect(changedReviewFields(items.get(decisionId)!, reverted[decisionId]!)).toEqual([])
  })

  it('shows removed decision contents while preserving the remaining code approvals', () => {
    const revised = structuredClone(model)
    revised.decisions[0]!.examples.pop()
    const nextItems = reviewItems(revised)
    const next = reconcileReviews(nextItems, approved)
    expect(summarizeReview(decisionId, nextItems, next)).toMatchObject({
      status: 'unreviewed',
      invalidated: true,
    })
    expect(itemReviewStatus(nextItems.get(proposedId)!, next[proposedId])).toBe('accepted')
    const changes = changedReviewFields(nextItems.get(decisionId)!, next[decisionId]!)
    expect(changes.map(change => change.key)).toEqual(['contents'])
    expect(changes[0]?.previous?.text).toContain('Example: subscribe')
    expect(changes[0]?.current?.text).not.toContain('Example: subscribe')
  })

  it('preserves an explicit decision denial even when every child is accepted', () => {
    const reviews = {
      ...approved,
      [decisionId]: { ...approved[decisionId]!, status: 'denied' as const },
    }
    expect(status(decisionId, reviews)).toBe('denied')
    expect(status(decisionId, markReview(decisionId, 'unreviewed', items, reviews))).toBe(
      'accepted',
    )
  })

  it('returns accepted parents to unreviewed when a code mark is cleared', () => {
    const reviews = markReview(proposedId, 'unreviewed', items, approved)
    for (const id of [contractId, changesId, decisionId, planReviewId])
      expect(status(id, reviews)).toBe('unreviewed')
    expect(reviews[decisionId]?.status).toBe('accepted')
    expect(status(secondDecisionId, reviews)).toBe('accepted')
  })

  it('accepts a decision without code or examples without an empty group blocking it', () => {
    const reviews = markReview(secondDecisionId, 'accepted', items, {})
    expect(status(secondDecisionId, reviews)).toBe('accepted')
  })
})

describe('Exact review change display', () => {
  it('preserves unaffected lines, punctuation, case, and whitespace', () => {
    const diff = reviewLineDiff(
      'const limit = 1;\nreturn value\n',
      'const limit = 1\nreturn Value\n',
    )
    expect(diff.filter(line => line.kind === 'removed').map(line => line.text)).toEqual([
      'const limit = 1;',
      'return value',
    ])
    expect(diff.filter(line => line.kind === 'added').map(line => line.text)).toEqual([
      'const limit = 1',
      'return Value',
    ])
    expect(diff.at(-1)).toMatchObject({ kind: 'same', text: '' })
    expect(new Set(diff.map(line => line.id)).size).toBe(diff.length)
  })

  it('keeps repeated lines distinct and displays both versions for large blocks', () => {
    const lines = Array.from({ length: 1001 }, () => 'repeat').join('\n')
    const diff = reviewLineDiff(lines, `${lines}\nchanged`)
    expect(diff.filter(line => line.kind === 'removed')).toHaveLength(1001)
    expect(diff.filter(line => line.kind === 'added')).toHaveLength(1002)
    expect(new Set(diff.map(line => line.id)).size).toBe(diff.length)
  })
})
