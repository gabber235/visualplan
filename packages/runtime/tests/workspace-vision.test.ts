import { describe, expect, it } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import { revisionSummaryText } from '../components/workspace/RevisionChanges.js'
import { fingerprint, workspaceRevision } from '../components/workspace/feedback.js'
import type { FeedbackTarget } from '../components/workspace/feedback.js'
import { snapshotTarget, targetChanged } from '../components/workspace/feedback-targets.js'
import type { WorkspaceModel } from '../components/workspace/model.js'
import { reviewedRevision } from '../components/workspace/review-baseline.js'
import {
  decisionReviewId,
  markReview,
  planReviewId,
  reconcileReviews,
  reviewItems,
  seedPlanBaseline,
  summarizeReview,
} from '../components/workspace/review-state.js'
import {
  changeKey,
  diffRevisions,
  removedDecisionsOwner,
  visionOwner,
} from '../components/workspace/revision-diff.js'

const decision = (id: string, title = `Decision ${id}`) => ({
  id,
  title,
  code: [{ id: 'c', file: 'a.ts', symbol: 'a', language: 'ts', proposed: `const ${id} = 1` }],
})

const legacyJson = {
  vision: { problem: 'Two writers', outcome: 'One writer', principles: ['Small'] },
  decisions: [decision('D1'), decision('D2')],
}
const legacy = planWorkspaceSchema.parse(legacyJson)

const scoped = planWorkspaceSchema.parse({
  vision: {
    problem: 'Two writers',
    outcome: 'One writer',
    scope: [
      { id: 'editor', text: 'Editor writes', status: 'in' },
      { id: 'api', text: 'API writes', status: 'in' },
      { id: 'sync', text: 'Offline sync', status: 'out' },
    ],
  },
  decisions: [decision('D1')],
})

const withVision = (model: WorkspaceModel, vision: Partial<WorkspaceModel['vision'] & object>) =>
  planWorkspaceSchema.parse({ ...model, vision: { ...model.vision, ...vision } })

describe('Compatibility of plans written before scope', () => {
  // What older runtimes hashed: the parsed model, whose vision had no scope. A different revision
  // would retire sent comments and orphan the legacy storage key.
  const { scope: _scope, ...oldVision } = legacy.vision!
  const pinnedRevision = fingerprint(JSON.stringify({ ...legacy, vision: oldVision }))

  it('keeps the revision hash and the whole vision fingerprint', () => {
    expect(workspaceRevision(legacy)).toBe(pinnedRevision)
    expect(fingerprint(JSON.stringify(legacy))).not.toBe(pinnedRevision)
    const target: FeedbackTarget = {
      path: ['vision'],
      labels: ['Plan vision'],
      excerpt: 'Two writers',
    }
    // The fingerprint an older runtime stored for this vision.
    const stored = fingerprint(
      JSON.stringify({ outcome: 'One writer', principles: ['Small'], problem: 'Two writers' }),
    )
    expect(snapshotTarget(legacy, target).fingerprint).toBe(stored)
    expect(targetChanged(legacy, { ...target, fingerprint: stored })).toBe(false)
  })

  it('keeps the plan approval of an accepted plan', () => {
    const items = reviewItems(legacy)
    expect(Object.keys(items.get(planReviewId)!.snapshot).sort()).toEqual([
      'outcome',
      'principles',
      'problem',
    ])
    let reviews = markReview(decisionReviewId('D1'), 'accepted', items, {})
    reviews = markReview(decisionReviewId('D2'), 'accepted', items, reviews)
    expect(summarizeReview(planReviewId, items, reviews).status).toBe('accepted')
    // Reparsing the same plan, now with an empty scope default, changes nothing.
    const reloaded = reconcileReviews(reviewItems(planWorkspaceSchema.parse(legacyJson)), reviews)
    expect(reloaded[planReviewId]?.invalidated).toBe(false)
    expect(summarizeReview(planReviewId, reviewItems(legacy), reloaded).status).toBe('accepted')
  })
})

describe('Compatibility of plans written while visions had facts', () => {
  // Runtimes with vision facts left empty facts out of the hash, so a plan without facts keeps it.
  it('keeps the revision hash and plan snapshot of a scoped plan', () => {
    const { problem, outcome, principles, scope } = scoped.vision!
    const pinned = fingerprint(
      JSON.stringify({ ...scoped, vision: { problem, outcome, principles, scope } }),
    )
    expect(workspaceRevision(scoped)).toBe(pinned)
    expect(Object.keys(reviewItems(scoped).get(planReviewId)!.snapshot)).toEqual([
      'problem',
      'outcome',
      '["scope","editor"]',
      '["scope","api"]',
      '["scope","sync"]',
    ])
  })
})

describe('Plan approval saved by runtimes without a plan mark', () => {
  // Older runtimes threw on marking the plan group, so saved state holds decision and code marks.
  const legacyMarks = (model: WorkspaceModel) => {
    const saved: Record<string, ReturnType<typeof markReview>[string]> = {}
    for (const [id, item] of reviewItems(model))
      if (item.kind === 'decision' || item.kind === 'code')
        saved[id] = { status: 'accepted', snapshot: item.snapshot, invalidated: false }
    return saved
  }

  it('reopens a legacy approved plan whose vision was edited, keeping decision marks', () => {
    const saved = legacyMarks(legacy)
    const edited = withVision(legacy, {
      problem: 'Three writers',
      scope: [{ id: 'x', text: 'New scope', status: 'in' }],
    })
    const items = reviewItems(edited)
    const next = reconcileReviews(items, seedPlanBaseline(saved, legacy))
    const plan = summarizeReview(planReviewId, items, next)
    expect(plan.status).toBe('unreviewed')
    expect(plan.ownInvalidated).toBe(true)
    for (const id of ['D1', 'D2'])
      expect(summarizeReview(decisionReviewId(id), items, next).status).toBe('accepted')
  })

  it('keeps a legacy approval when the vision is unchanged', () => {
    const saved = legacyMarks(legacy)
    const items = reviewItems(legacy)
    const next = reconcileReviews(items, seedPlanBaseline(saved, legacy))
    expect(summarizeReview(planReviewId, items, next).status).toBe('accepted')
  })

  it('seeds nothing when the plan was not accepted or a plan mark exists', () => {
    expect(seedPlanBaseline({}, legacy)).toEqual({})
    const saved = legacyMarks(legacy)
    expect(seedPlanBaseline(saved, undefined)).toBe(saved)
    const marked = markReview(planReviewId, 'accepted', reviewItems(legacy), saved)
    expect(seedPlanBaseline(marked, legacy)).toBe(marked)
  })
})

describe('Plan approval follows the confirmed vision', () => {
  const accept = (model: WorkspaceModel) => {
    const items = reviewItems(model)
    return model.decisions.reduce(
      (reviews, item) => markReview(decisionReviewId(item.id), 'accepted', items, reviews),
      {} as ReturnType<typeof markReview>,
    )
  }

  it('reopens plan approval when the vision changes and keeps decision marks', () => {
    const reviews = accept(scoped)
    expect(summarizeReview(planReviewId, reviewItems(scoped), reviews).status).toBe('accepted')
    for (const changed of [
      withVision(scoped, { problem: 'Three writers' }),
      withVision(scoped, { scope: scoped.vision!.scope.slice(0, 2) }),
      withVision(scoped, {
        scope: scoped.vision!.scope.map(item => ({ ...item, status: 'out' as const })),
      }),
    ]) {
      const items = reviewItems(changed)
      const next = reconcileReviews(items, reviews)
      const plan = summarizeReview(planReviewId, items, next)
      expect(plan.status).toBe('unreviewed')
      expect(plan.ownInvalidated).toBe(true)
      expect(summarizeReview(decisionReviewId('D1'), items, next).status).toBe('accepted')
      const confirmed = markReview(planReviewId, 'accepted', items, next)
      expect(summarizeReview(planReviewId, items, confirmed).status).toBe('accepted')
    }
  })

  it('ignores reordered scope', () => {
    const reviews = accept(scoped)
    const reordered = withVision(scoped, {
      scope: [...scoped.vision!.scope].reverse(),
    })
    const items = reviewItems(reordered)
    expect(summarizeReview(planReviewId, items, reconcileReviews(items, reviews)).status).toBe(
      'accepted',
    )
  })

  it('confirms the vision without marking decisions or being blocked by a denial', () => {
    const items = reviewItems(scoped)
    const denied = markReview(decisionReviewId('D1'), 'denied', items, {})
    const confirmed = markReview(planReviewId, 'accepted', items, denied)
    expect(confirmed[planReviewId]?.status).toBe('accepted')
    expect(confirmed[decisionReviewId('D1')]?.status).toBe('denied')
    expect(summarizeReview(planReviewId, items, confirmed).status).toBe('denied')
  })

  it('rebuilds the reviewed vision so revision highlights compare against it', () => {
    const reviews = accept(scoped)
    const changed = withVision(scoped, {
      scope: [{ id: 'editor', text: 'Editor and CLI writes', status: 'in' }],
    })
    const baseline = reviewedRevision(changed, reviews)!
    expect(baseline.vision?.scope).toEqual(scoped.vision?.scope)
    const changes = diffRevisions(baseline, changed)
    expect(changes.fields.get(changeKey('vision', 'scope', 'editor'))?.kind).toBe('modified')
    expect(changes.removed.get(visionOwner)?.map(item => item.label)).toEqual([
      'In scope: API writes',
      'Out of scope: Offline sync',
    ])
  })
})

describe('Vision revision diff', () => {
  it('diffs scope by id: add, edit, remove, and reorder', () => {
    const next = withVision(scoped, {
      scope: [
        { id: 'api', text: 'API writes', status: 'out' },
        { id: 'editor', text: 'Editor and CLI writes', status: 'in' },
        { id: 'cli', text: 'CLI writes', status: 'in' },
      ],
    })
    const changes = diffRevisions(scoped, next)
    expect(changes.fields.get(changeKey('vision', 'scope', 'api'))).toEqual({
      kind: 'modified',
      previous: 'In scope: API writes',
    })
    expect(changes.fields.get(changeKey('vision', 'scope', 'editor'))).toEqual({
      kind: 'modified',
      previous: 'In scope: Editor writes',
    })
    expect(changes.fields.get(changeKey('vision', 'scope', 'cli'))).toEqual({ kind: 'added' })
    expect(changes.removed.get(visionOwner)).toEqual([
      {
        key: changeKey('vision', 'scope', 'sync'),
        label: 'Out of scope: Offline sync',
        previous: 'Out of scope: Offline sync',
      },
    ])
    expect(changes.counts.get(visionOwner)).toBe(4)
    expect(changes.counts.get('D1')).toBe(0)
  })

  it('reports nothing when scope is only reordered', () => {
    const next = withVision(scoped, {
      scope: [...scoped.vision!.scope].reverse(),
    })
    const changes = diffRevisions(scoped, next)
    expect(changes.fields.size).toBe(0)
    expect(revisionSummaryText(changes)).toBe('')
  })
})

describe('Revision summary counts', () => {
  it('names the vision instead of counting it as a decision', () => {
    const changes = diffRevisions(scoped, withVision(scoped, { problem: 'Three writers' }))
    expect(revisionSummaryText(changes)).toBe('1 place changed in the vision')
  })

  it('reports removed decisions once without inflating changed places or decisions', () => {
    const changes = diffRevisions(
      planWorkspaceSchema.parse({
        ...legacyJson,
        decisions: [...legacyJson.decisions, decision('D3')],
      }),
      planWorkspaceSchema.parse({ ...legacyJson, decisions: [decision('D1')] }),
    )
    expect(changes.removed.get(removedDecisionsOwner)?.map(item => item.label)).toEqual([
      'Decision D2',
      'Decision D3',
    ])
    expect(revisionSummaryText(changes)).toBe('2 decisions removed')
  })

  it('combines vision, decision, and removal counts', () => {
    const next = planWorkspaceSchema.parse({
      ...legacyJson,
      vision: { ...legacyJson.vision, outcome: 'Exactly one writer' },
      decisions: [decision('D1', 'Renamed')],
    })
    expect(revisionSummaryText(diffRevisions(legacy, next))).toBe(
      '2 places changed in the vision and 1 decision, 1 decision removed',
    )
  })
})

describe('Feedback targets for vision items', () => {
  const target = (leaf: string, model: WorkspaceModel = scoped): FeedbackTarget =>
    snapshotTarget(model, { path: ['vision', leaf], labels: ['Plan vision', leaf], excerpt: '' })

  it('keeps comments on unchanged items across unrelated edits and reordering', () => {
    const next = withVision(scoped, {
      problem: 'Three writers',
      scope: [...scoped.vision!.scope].reverse(),
    })
    for (const leaf of ['vision:scope:editor', 'vision:scope:sync'])
      expect(targetChanged(next, target(leaf))).toBe(false)
  })

  it('retires comments on changed, removed, or moved items', () => {
    const next = withVision(scoped, {
      scope: [{ id: 'editor', text: 'Editor and CLI writes', status: 'in' }],
    })
    expect(targetChanged(next, target('vision:scope:editor'))).toBe(true)
    expect(targetChanged(next, target('vision:scope:api'))).toBe(true)
    expect(targetChanged(next, target('vision:scope:sync'))).toBe(true)
  })

  it('keeps comments on a scope item moved between in and out', () => {
    const moved = withVision(scoped, {
      scope: scoped.vision!.scope.map(item =>
        item.id === 'api' ? { ...item, status: 'out' as const } : item,
      ),
    })
    expect(targetChanged(moved, target('vision:scope:api'))).toBe(false)
  })

  it('relocates a comment when an item id is renamed with the same content', () => {
    const next = withVision(scoped, {
      scope: scoped.vision!.scope.map(item =>
        item.id === 'editor' ? { ...item, id: 'editor-writes' } : item,
      ),
    })
    const saved = target('vision:scope:editor')
    expect(targetChanged(next, saved)).toBe(false)
    expect(snapshotTarget(next, saved).path).toEqual(['vision', 'vision:scope:editor-writes'])
  })

  it('ties the whole vision comment to scope once it exists', () => {
    const whole = snapshotTarget(scoped, { path: ['vision'], labels: ['Plan vision'], excerpt: '' })
    expect(targetChanged(withVision(scoped, { scope: [] }), whole)).toBe(true)
    expect(targetChanged(scoped, whole)).toBe(false)
  })

  it('treats a comment saved on a removed vision fact as an unknown anchor (edge)', () => {
    const saved: FeedbackTarget = {
      path: ['vision', 'vision:fact:lock'],
      labels: ['Plan vision', 'Relies on: Pages lock per tab'],
      excerpt: 'Pages lock per tab',
      fingerprint: 'stored',
    }
    expect(snapshotTarget(scoped, saved).path).toEqual(saved.path)
    expect(() => targetChanged(scoped, saved)).not.toThrow()
  })
})
