import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import {
  changeKey,
  changedWithin,
  diffRevisions,
  lineHunks,
} from '../components/workspace/revision-diff.js'
import { reviewedRevision } from '../components/workspace/review-baseline.js'
import { decisionReviewId, markReview, reviewItems } from '../components/workspace/review-state.js'

vi.mock('../components/workspace/review-storage.js', () => ({
  readSavedFeedback: async (key: string) => localStorage.getItem(key),
  writeSavedFeedback: async (key: string, value: string) => localStorage.setItem(key, value),
}))

const { loadPreviousRevision } = await import('../components/workspace/RevisionChanges.js')

const base = planWorkspaceSchema.parse({
  vision: { problem: 'Two writers', outcome: 'One writer' },
  decisions: [
    {
      id: 'D1',
      title: 'One writer',
      goal: 'Route writes through the editor.',
      reasoning: { benefits: [{ title: 'One owner' }], costs: [] },
      examples: [
        { id: 'rename', title: 'Rename', language: 'ts', code: "editor.rename('Dune')" },
        { id: 'gone', title: 'Old example', language: 'ts', code: 'legacy()' },
      ],
      code: [
        {
          id: 'apply',
          file: 'editor.ts',
          symbol: 'apply',
          language: 'ts',
          proposed: 'const a = 1\nconst b = 2\nconst c = 3',
        },
      ],
    },
    { id: 'D2', title: 'History', goal: 'Record history.' },
  ],
})

function revise(change: (model: typeof base) => void) {
  const next = structuredClone(base)
  change(next)
  return next
}

describe('Changes since the previously opened revision', () => {
  it('reports nothing for an identical revision', () => {
    const changes = diffRevisions(base, base)
    expect(changes.fields.size).toBe(0)
    expect([...changes.counts.values()].every(count => count === 0)).toBe(true)
  })

  it('marks edited text with its previous value and counts it on its decision', () => {
    const changes = diffRevisions(
      base,
      revise(next => {
        next.decisions[0]!.goal = 'Route every write through the editor.'
        next.vision!.outcome = 'Exactly one writer'
      }),
    )
    expect(changes.fields.get(changeKey('decision', 'D1', 'goal'))).toEqual({
      kind: 'modified',
      previous: 'Route writes through the editor.',
    })
    expect(changes.fields.get(changeKey('vision', 'outcome'))?.previous).toBe('One writer')
    expect(changes.counts.get('D1')).toBe(1)
    expect(changes.counts.get('D2')).toBe(0)
  })

  it('separates new, changed, and removed children by their stable ids', () => {
    const changes = diffRevisions(
      base,
      revise(next => {
        const decision = next.decisions[0]!
        decision.examples = [
          decision.examples[0]!,
          { id: 'subscribe', title: 'Subscribe', language: 'ts', code: 'editor.on(render)' },
        ]
        decision.code[0]!.proposed = 'const a = 1\nconst b = 20\nconst c = 3'
      }),
    )
    expect(changes.fields.get(changeKey('decision', 'D1', 'example', 'subscribe'))?.kind).toBe(
      'added',
    )
    expect(changes.removed.get('D1')?.map(item => item.label)).toEqual(['Example: Old example'])
    expect(changedWithin(changes, 'decision', 'D1', 'code', 'apply')).toBe(true)
    expect(changedWithin(changes, 'decision', 'D1', 'example', 'rename')).toBe(false)
  })

  it('reports new and removed decisions', () => {
    const changes = diffRevisions(
      base,
      revise(next => {
        next.decisions[1] = { ...next.decisions[1]!, id: 'D3', title: 'Audit' }
      }),
    )
    expect(changes.fields.get(changeKey('decision', 'D3'))?.kind).toBe('added')
    expect(changes.removed.get('')?.map(item => item.label)).toEqual(['History'])
  })

  it('does not treat reordered reasoning cards without ids as changes', () => {
    const reordered = revise(next => {
      next.decisions[0]!.reasoning = {
        benefits: [{ title: 'Fewer paths' }, { title: 'One owner' }],
        costs: [],
      }
    })
    const withBoth = revise(next => {
      next.decisions[0]!.reasoning = {
        benefits: [{ title: 'One owner' }, { title: 'Fewer paths' }],
        costs: [],
      }
    })
    const changes = diffRevisions(withBoth, reordered)
    expect(changes.fields.size).toBe(0)
    expect(changes.removed.size).toBe(0)
  })

  it('groups a line diff into hoverable hunks with the lines they replaced', () => {
    expect(lineHunks('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'modified', lines: [1], removed: ['b'], added: ['B'], anchor: 1, after: false },
      { kind: 'added', lines: [3], removed: [], added: ['d'], anchor: 3, after: false },
    ])
    expect(lineHunks('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'modified', lines: [], removed: ['b'], added: [], anchor: 1, after: false },
    ])
    expect(lineHunks('a\nb', 'a')).toMatchObject([{ lines: [], removed: ['b'], after: true }])
  })
})

describe('Revision baseline in the browser', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the previously opened revision across reloads until a newer one opens', async () => {
    const second = revise(next => {
      next.decisions[0]!.title = 'A single writer'
    })
    const third = revise(next => {
      next.decisions[0]!.title = 'Exactly one writer'
    })
    expect(await loadPreviousRevision('plan', base)).toBeUndefined()
    expect((await loadPreviousRevision('plan', second))?.decisions[0]?.title).toBe('One writer')
    expect((await loadPreviousRevision('plan', second))?.decisions[0]?.title).toBe('One writer')
    expect((await loadPreviousRevision('plan', third))?.decisions[0]?.title).toBe('A single writer')
  })
})

describe('Changes since the last review, for plans without an opened revision', () => {
  it('rebuilds reviewed content from review marks and leaves unmarked decisions unchanged', () => {
    const reviews = markReview(decisionReviewId('D1'), 'accepted', reviewItems(base), {})
    const next = revise(next => {
      const decision = next.decisions[0]!
      decision.title = 'A single writer'
      decision.examples = [decision.examples[0]!]
      decision.code[0]!.proposed = 'const a = 1\nconst b = 20\nconst c = 3'
      decision.reasoning!.benefits.push({ title: 'Fewer paths' })
      next.decisions[1]!.goal = 'Record every change.'
    })
    const previous = reviewedRevision(next, reviews)
    expect(previous).toBeDefined()
    const changes = diffRevisions(previous!, next)
    expect(changes.fields.get(changeKey('decision', 'D1', 'title'))?.previous).toBe('One writer')
    expect(changes.fields.get(changeKey('decision', 'D1', 'code', 'apply', 'proposed'))?.kind).toBe(
      'modified',
    )
    expect(changes.fields.get(changeKey('decision', 'D1', 'benefit', '1'))?.kind).toBe('added')
    expect(changes.removed.get('D1')?.map(item => item.label)).toEqual(['Example: Old example'])
    expect(changes.counts.get('D1')).toBe(4)
    expect(changes.counts.get('D2')).toBe(0)
  })

  it('reports nothing for reviewed content that did not change', () => {
    const reviews = markReview(decisionReviewId('D1'), 'accepted', reviewItems(base), {})
    const changes = diffRevisions(reviewedRevision(base, reviews)!, base)
    expect(changes.fields.size).toBe(0)
    expect(changes.removed.size).toBe(0)
    expect(reviewedRevision(base, {})).toBeUndefined()
  })
})
