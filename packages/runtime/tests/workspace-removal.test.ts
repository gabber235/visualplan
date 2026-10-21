import { describe, expect, it } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import { codeRemovalPart } from '../components/workspace/model.js'
import {
  decisionReviewId,
  codeReviewId,
  reviewItems,
  markReview,
  reconcileReviews,
} from '../components/workspace/review-state.js'

const model = planWorkspaceSchema.parse({
  decisions: [
    {
      id: 'owner',
      title: 'Share the owner',
      ownership: [{ id: 'search', area: 'Search', current: 'SearchRouter', proposed: 'Registry' }],
      code: [
        {
          id: 'old',
          file: 'router.ts',
          symbol: 'SearchRouter',
          change: 'delete',
          current: 'class SearchRouter {}',
        },
      ],
    },
  ],
})

describe('Deletion review and ownership meaning', () => {
  it('collapses whole file removals but keeps partial and mixed edits visible', () => {
    const code = model.decisions[0]!.code[0]!
    expect(codeRemovalPart(code)).toBe('current')
    expect(
      codeRemovalPart({
        ...code,
        diff: '--- a/router.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-class SearchRouter {}',
      }),
    ).toBe('diff')
    expect(
      codeRemovalPart({
        ...code,
        diff: '--- a/router.ts\n+++ b/router.ts\n@@ -1 +0,0 @@\n-class SearchRouter {}',
      }),
    ).toBeUndefined()
    expect(codeRemovalPart({ ...code, proposed: 'class Registry {}' })).toBeUndefined()
    expect(
      codeRemovalPart({
        ...code,
        diff: '--- a/router.ts\n+++ /dev/null\n@@ -1 +1 @@\n-old\n+replacement',
      }),
    ).toBeUndefined()
  })

  it('invalidates a decision when ownership changes without discarding unrelated code review', () => {
    const id = decisionReviewId('owner')
    const reviews = markReview(id, 'accepted', reviewItems(model), {})
    const next = structuredClone(model)
    next.decisions[0]!.ownership[0]!.proposed = 'AnotherRegistry'
    const reconciled = reconcileReviews(reviewItems(next), reviews)
    expect(reconciled[id]?.invalidated).toBe(true)
    expect(reconciled[codeReviewId('owner', 'old', 'current')]?.status).toBe('accepted')
  })
})
