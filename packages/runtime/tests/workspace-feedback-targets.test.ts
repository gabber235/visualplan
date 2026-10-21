import { describe, expect, it } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import {
  captureTarget,
  emptyFeedback,
  exportFeedback,
  reviewAnchor,
  workspaceRevision,
  type FeedbackTarget,
} from '../components/workspace/feedback.js'
import { reconcileFeedback, snapshotTarget } from '../components/workspace/feedback-targets.js'

const model = planWorkspaceSchema.parse({
  vision: { problem: 'Two writers', outcome: 'One writer' },
  decisions: [
    {
      id: 'owner',
      title: 'Choose the owner',
      goal: 'The session owns writes',
      reasoning: { benefits: [{ title: 'Consistency', detail: 'One write boundary' }] },
      code: [
        {
          id: 'write',
          file: 'session.ts',
          symbol: 'write',
          proposed: `${'same prefix\n'.repeat(150)}old ending`,
        },
      ],
    },
  ],
})
const target: FeedbackTarget = {
  path: ['decision:owner', 'changes', 'code:write', 'proposed'],
  labels: ['Owner', 'Changes', 'session.ts: write', 'Proposed code'],
  excerpt: `${model.decisions[0]!.code[0]!.proposed!.slice(0, 799)}…`,
  decisionId: 'owner',
}

function saved() {
  const state = emptyFeedback()
  state.comments.push({
    id: 'comment',
    kind: 'issue',
    body: '  Keep my words.\nSecond line.  ',
    target: { ...snapshotTarget(model, target), revision: workspaceRevision(model) },
  })
  return state
}

describe('Feedback target lifecycle', () => {
  it('keeps ownership comments through reorder and retires only their changed targets', () => {
    const before = structuredClone(model)
    before.decisions[0]!.ownership = [
      {
        id: 'search',
        area: 'Search',
        current: 'SearchRouter',
        proposed: 'Registry',
        removed: ['routeSearch'],
      },
      { id: 'inbox', area: 'Inbox', current: 'InboxRouter', proposed: 'Registry', removed: [] },
    ]
    const state = emptyFeedback()
    state.comments = ['current-owner', 'proposed-owner', 'removed'].map(part => ({
      id: part,
      kind: 'question',
      body: `Explain ${part}`,
      target: snapshotTarget(before, {
        path: ['decision:owner', 'ownership', 'ownership:search', part],
        labels: ['Owner', 'Ownership changes', 'Search', part],
        excerpt: '',
      }),
    }))
    const next = structuredClone(before)
    next.decisions[0]!.ownership.reverse()
    expect(reconcileFeedback(next, state).comments).toHaveLength(3)
    next.decisions[0]!.ownership[1]!.proposed = 'NewRegistry'
    expect(reconcileFeedback(next, state).comments.map(comment => comment.id)).toEqual([
      'current-owner',
      'removed',
    ])
    next.decisions[0]!.ownership.pop()
    expect(reconcileFeedback(next, state).comments).toHaveLength(0)
  })

  it('resolves a stable reasoning ID before matching a repeated title', () => {
    const before = structuredClone(model)
    before.decisions[0]!.reasoning!.benefits = [
      { id: 'owner:one', title: 'Owner', detail: 'First' },
      { id: 'owner:two', title: 'Owner', detail: 'Second' },
    ]
    const state = emptyFeedback()
    state.comments.push({
      id: 'second',
      kind: 'question',
      body: 'Explain second',
      target: snapshotTarget(before, {
        path: ['decision:owner', 'benefit:owner:two'],
        labels: ['Owner', 'Benefit: Owner'],
        excerpt: 'Second',
      }),
    })
    const next = structuredClone(before)
    next.decisions[0]!.reasoning!.benefits[0]!.detail = 'First updated'
    expect(reconcileFeedback(next, state).comments).toHaveLength(1)
    next.decisions[0]!.reasoning!.benefits[1]!.detail = 'Second updated'
    expect(reconcileFeedback(next, state).comments).toHaveLength(0)
  })

  it('rejects reasoning IDs that collide with another card anchor', () => {
    const next = structuredClone(model)
    next.decisions[0]!.reasoning!.benefits = [{ title: 'First' }, { id: '0', title: 'Second' }]
    expect(planWorkspaceSchema.safeParse(next).success).toBe(false)
  })

  it('retires a comment when text beyond its stored excerpt changes', () => {
    const next = structuredClone(model)
    next.decisions[0]!.code[0]!.proposed += '\nnew ending'
    expect(reconcileFeedback(next, saved()).comments).toEqual([])
  })

  it('retires removed targets and keeps unchanged targets across unrelated content and order changes', () => {
    const next = structuredClone(model)
    next.vision!.outcome = 'Another introduction'
    next.decisions.unshift({ ...next.decisions[0]!, id: 'other', title: 'Other' })
    next.decisions[1]!.code.unshift({ ...next.decisions[1]!.code[0]!, id: 'other' })
    expect(reconcileFeedback(next, saved()).comments).toHaveLength(1)
    next.decisions[1]!.code = []
    expect(reconcileFeedback(next, saved()).comments).toEqual([])
    next.decisions = []
    expect(reconcileFeedback(next, saved()).comments).toEqual([])
  })

  it('preserves a stale draft and never replaces its target snapshot or text', () => {
    const state = saved()
    state.draft = {
      target: state.comments[0]!.target,
      kind: 'change',
      body: 'Please keep this unfinished thought',
    }
    const next = structuredClone(model)
    next.decisions[0]!.code = []
    const reconciled = reconcileFeedback(next, state)
    expect(reconciled.draft?.body).toBe(state.draft.body)
    expect(reconciled.draft?.target).toEqual({ ...state.draft.target, stale: true })
  })

  it('handles legacy evidence conservatively and upgrades surviving exact targets', () => {
    const state = saved()
    delete state.comments[0]!.target.fingerprint
    state.comments[0]!.target.quote = 'old ending'
    state.comments[0]!.target.revision = 'old revision'
    expect(reconcileFeedback(model, state).comments[0]?.target.fingerprint).toBeTruthy()
    const next = structuredClone(model)
    next.decisions[0]!.code[0]!.proposed = 'replacement'
    expect(reconcileFeedback(next, state).comments).toEqual([])
    delete state.comments[0]!.target.quote
    expect(reconcileFeedback(next, state).comments).toHaveLength(1)
    state.comments[0]!.target.path = ['decision:owner', 'unknown:old-renderer']
    expect(reconcileFeedback(next, state).comments).toHaveLength(1)
  })

  it('preserves indexed targets across reorder and refreshes their exact current path', () => {
    const before = structuredClone(model)
    before.vision!.principles = ['One owner', 'Explicit cleanup']
    before.decisions[0]!.code[0]!.invariants = ['Single writer', 'Release on close']
    const state = emptyFeedback()
    for (const item of [
      {
        path: ['vision', 'vision:principle:0'],
        labels: ['Vision', 'Principle'],
        excerpt: 'One owner',
      },
      {
        path: ['decision:owner', 'changes', 'code:write', 'invariant:0'],
        labels: ['Owner', 'Changes', 'Write', 'Invariant'],
        excerpt: 'Single writer',
      },
    ])
      state.comments.push({
        id: item.excerpt,
        kind: 'question',
        body: 'Why?',
        target: snapshotTarget(before, item),
      })
    const after = structuredClone(before)
    after.vision!.principles.reverse()
    after.decisions[0]!.code[0]!.invariants.reverse()
    state.draft = {
      target: state.comments[1]!.target,
      kind: 'change',
      body: 'Keep this draft at its invariant',
    }
    const result = reconcileFeedback(after, state)
    expect(result.comments.map(item => item.target.path.at(-1))).toEqual([
      'vision:principle:1',
      'invariant:1',
    ])
    expect(result.draft?.target.path.at(-1)).toBe('invariant:1')
    expect(result.draft?.target.stale).toBe(false)
  })

  it('retires comments on route anchors that are no longer rendered', () => {
    const state = saved()
    state.comments[0]!.target.path = ['decision:owner', 'route:1']
    const next = structuredClone(model)
    next.decisions[0]!.route = [
      {
        order: 1,
        change: 'Hidden route',
        touchpoints: ['old.ts'],
        dependsOn: [],
        proof: 'Existing proof',
      },
    ]
    expect(reconcileFeedback(next, state).comments).toEqual([])
  })

  it('retains original revision for legacy context that cannot be verified', () => {
    const state = saved()
    delete state.comments[0]!.target.fingerprint
    state.comments[0]!.target.revision = 'older'
    const reconciled = reconcileFeedback(model, state)
    expect(reconciled.comments[0]?.target.unverified).toBe(true)
    expect(exportFeedback(model, reconciled, 'Ownership')).toContain('Original revision: older')
  })

  it('keeps comments when a code item moves presentation role or hidden legacy fields change', () => {
    const state = saved()
    state.comments[0]!.target = snapshotTarget(model, { ...target, path: ['decision:owner'] })
    const after = structuredClone(model)
    after.decisions[0]!.code[0]!.role = 'model'
    after.decisions[0]!.assumptions = ['Old hidden data']
    after.decisions[0]!.route = [
      {
        order: 1,
        change: 'Hidden route',
        touchpoints: ['old.ts'],
        dependsOn: [],
        proof: 'Existing proof',
      },
    ]
    expect(reconcileFeedback(after, state).comments).toHaveLength(1)
  })

  it('limits group comments to the corresponding model or edit entries', () => {
    const before = structuredClone(model)
    before.decisions[0]!.code.push({
      ...before.decisions[0]!.code[0]!,
      id: 'model',
      role: 'model',
      current: 'old contract',
    })
    const state = emptyFeedback()
    for (const group of ['model', 'changes'])
      state.comments.push({
        id: group,
        body: group,
        kind: 'issue',
        target: snapshotTarget(before, { ...target, path: ['decision:owner', group] }),
      })
    const after = structuredClone(before)
    after.decisions[0]!.code[0]!.proposed = 'Edited implementation'
    expect(reconcileFeedback(after, state).comments.map(item => item.id)).toEqual(['model'])
  })

  it('does not claim source offsets for composite target selections', () => {
    const selected = snapshotTarget(model, {
      ...target,
      path: ['decision:owner'],
      quote: 'The session',
      range: { start: 20, end: 31 },
    })
    expect(selected.range).toBeUndefined()
  })
})

describe('Compact feedback selection export', () => {
  it('exports verified whole items with only their target and the verbatim comment', () => {
    const state = saved()
    const exported = exportFeedback(model, state, 'Ownership', '/project/docs/plans/owner.mdx')
    expect(exported).toContain('1. decision:owner / changes / code:write / proposed')
    expect(exported).toContain(state.comments[0]!.body)
    expect(exported).not.toContain('Context:')
    expect(exported).not.toContain('Reviewer feedback:')
    expect(exportFeedback(model, state, 'Ownership')).toContain('Context:')
    state.comments[0]!.target.unverified = true
    expect(exportFeedback(model, state, 'Ownership', '/project/docs/plans/owner.mdx')).toContain(
      'Context:',
    )
  })
  it('captures exact long and repeated selections without exporting their full text', () => {
    const root = document.createElement('div')
    const node = document.createElement('p')
    for (const [key, value] of Object.entries(reviewAnchor('goal', 'Goal')))
      node.setAttribute(key, value)
    const repeated = 'repeated '.repeat(100)
    node.textContent = `first ${repeated}middle ${repeated}last`
    root.append(node)
    const start = 6 + repeated.length + 7
    const range = document.createRange()
    range.setStart(node.firstChild!, start)
    range.setEnd(node.firstChild!, start + repeated.length)
    const selected = captureTarget(node, root, range)
    expect(selected.range).toEqual({ start, end: start + repeated.length })
    expect(node.textContent.slice(selected.range!.start, selected.range!.end)).toBe(repeated)
    const state = saved()
    state.comments[0]!.target = selected
    const exported = exportFeedback(model, state, 'Ownership', '/project/docs/plans/owner.mdx')
    expect(exported).not.toContain('Selection: UTF16')
    expect(exported).toContain('Source: /project/docs/plans/owner.mdx')
    expect(exported.match(/Revision:/g)).toHaveLength(1)
    expect(exported).not.toContain('Before selection:')
    expect(exported).not.toContain('Location:')
    expect(exported).not.toContain(repeated)
    expect(exported).toContain(state.comments[0]!.body)
    expect(exported.length).toBeLessThan(650)
  })

  it('counts highlighted newlines and Unicode as exact UTF16 source positions', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<section data-review-id="proposed"><pre><code><div class="ec-line">const first = "😀"</div><div class="ec-line">const second = first</div></code></pre></section>'
    const lines = root.querySelectorAll('.ec-line')
    const range = document.createRange()
    range.setStart(lines[1]!.firstChild!, 0)
    range.setEnd(lines[1]!.firstChild!, 12)
    const selected = captureTarget(lines[1]!, root, range)
    const source = 'const first = "😀"\nconst second = first'
    expect(source.slice(selected.range!.start, selected.range!.end)).toBe('const second')
  })
})
