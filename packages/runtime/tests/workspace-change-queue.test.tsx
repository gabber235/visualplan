import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import { PlanWorkspace } from '../components/workspace/PlanWorkspace.js'
import { emptyFeedback, feedbackKey } from '../components/workspace/feedback.js'
import {
  codeReviewId,
  decisionReviewId,
  markReview,
  reviewItems,
} from '../components/workspace/review-state.js'

vi.mock('../components/workspace/review-storage.js', () => ({
  readSavedFeedback: async (key: string, legacyKey: string) =>
    localStorage.getItem(key) ?? localStorage.getItem(legacyKey),
  writeSavedFeedback: async (key: string, value: string) => localStorage.setItem(key, value),
}))

const model = planWorkspaceSchema.parse({
  vision: { problem: 'Implicit outcomes', outcome: 'Typed admission' },
  decisions: [
    {
      id: 'D1',
      title: 'Make admission explicit',
      goal: 'Return typed admission results.',
      reasoning: {
        benefits: [{ title: 'Explicit handling', detail: 'Callers handle every outcome.' }],
      },
      code: [
        {
          id: 'policy',
          file: 'policy.ts',
          symbol: 'Policy',
          summary: 'Require retry metadata.',
          current: 'type Policy = boolean',
          proposed: 'type Policy = Allow | Reject',
        },
        {
          id: 'middleware',
          file: 'middleware.ts',
          symbol: 'handle',
          summary: 'Use the decision.',
          proposed: 'return handleDecision(decision)',
        },
        {
          id: 'counter',
          file: 'counter.ts',
          symbol: 'increment',
          summary: 'Use an atomic counter.',
          diff: '-get(key)\n+increment(key)',
        },
        {
          id: 'response',
          file: 'response.ts',
          symbol: 'respond',
          summary: 'Read the retry delay.',
          proposed: 'return retryAfter(decision.retryAfterSeconds)',
        },
      ],
    },
  ],
})
const key = feedbackKey(location.pathname)

describe('Change review queue', () => {
  let container: HTMLDivElement
  let root: Root
  const scroll = vi.fn()
  beforeEach(() => {
    localStorage.removeItem(key)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    scroll.mockClear()
    vi.stubGlobal('scrollIntoView', scroll)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scroll,
      configurable: true,
    })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.removeItem(key)
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    vi.unstubAllGlobals()
  })
  const queue = () => [...container.querySelectorAll<HTMLButtonElement>('[data-change-id]')]
  const order = () => queue().map(button => button.dataset.changeId)
  const active = () =>
    queue().find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.changeId
  const mark = async (part: 'proposed' | 'diff', action: 'accept' | 'deny') => {
    const side = container.querySelector<HTMLElement>(
      `.vp-code-contract [data-review-id="${part}"]`,
    )!
    await act(async () =>
      side.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click(),
    )
  }
  const select = async (id: string) => {
    await act(async () =>
      queue()
        .find(button => button.dataset.changeId === id)!
        .click(),
    )
  }
  const render = async () => act(async () => root.render(<PlanWorkspace model={model} />))

  it('shows the concrete model before reasoning and examples, then ends at the edits', async () => {
    const proposal = planWorkspaceSchema.parse({
      decisions: [
        {
          id: 'D1',
          title: 'Share admission policy',
          reasoning: { benefits: [{ id: 'shared', title: 'Delete service policies' }] },
          code: [
            {
              id: 'owner',
              role: 'model',
              file: 'policy.ts',
              symbol: 'Policy',
              current: 'service.allow()',
              proposed: 'gateway.decide()',
            },
            {
              id: 'handler',
              file: 'handler.ts',
              symbol: 'handle',
              proposed: 'return dispatch(request)',
            },
          ],
          examples: [
            {
              id: 'request',
              title: 'Request at limit',
              language: 'typescript',
              code: 'policy.decide(subject)',
            },
          ],
          route: [
            {
              order: 1,
              change: 'Legacy execution noise',
              touchpoints: ['handler.ts'],
              proof: 'Legacy evidence noise',
            },
          ],
        },
      ],
    })
    await act(async () => root.render(<PlanWorkspace model={proposal} />))
    const text = container.textContent!
    expect(text.indexOf('gateway.decide()')).toBeLessThan(text.indexOf('Delete service policies'))
    expect(text.indexOf('Delete service policies')).toBeLessThan(text.indexOf('Request at limit'))
    expect(text.indexOf('Request at limit')).toBeLessThan(text.indexOf('Change set'))
    expect(text).not.toContain('Legacy execution noise')
    expect(text).not.toContain('Legacy evidence noise')
    expect(text).not.toContain('Illustrative usage')
    expect(text).not.toContain('Expected behavior')
    const modelPane = container.querySelector('[data-review-id="model"]')!
    expect(modelPane.querySelector('[data-review-id="code:owner"]')).not.toBeNull()
    expect(modelPane.querySelector('[data-review-id="current"] button')).toBeNull()
    expect(container.querySelectorAll('[data-review-item]')).toHaveLength(3)
    expect(
      container.querySelector('[data-review-id="changes"] [data-review-id="code:owner"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-review-id="changes"] [data-review-id="code:handler"]'),
    ).not.toBeNull()
  })

  it('keeps existing code read only and advances after the proposal is denied', async () => {
    await render()
    const existing = container.querySelector('[data-review-id="current"]')!
    expect(existing.textContent).toContain('type Policy = boolean')
    expect(existing.querySelector('button')).toBeNull()
    expect(existing.querySelector('[data-review-item]')).toBeNull()
    await mark('proposed', 'deny')
    expect(active()).toBe('middleware')
    expect(order()).toEqual(['middleware', 'counter', 'response', 'policy'])
    expect(queue().at(-1)?.dataset.reviewed).toBe('true')
    expect(queue().at(-1)?.dataset.status).toBe('denied')
    expect(container.querySelector<HTMLElement>('.vp-decision-workbench')?.dataset.status).toBe(
      'denied',
    )
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
    expect(document.activeElement).toBe(container.querySelector('.vp-code-contract'))
  })

  it('opens the first pending change on reload and preserves authored order within each group', async () => {
    const state = emptyFeedback()
    const items = reviewItems(model)
    state.reviews = markReview(
      codeReviewId('D1', 'policy', 'proposed'),
      'accepted',
      items,
      state.reviews,
    )
    state.reviews = markReview(
      codeReviewId('D1', 'counter', 'diff'),
      'denied',
      items,
      state.reviews,
    )
    localStorage.setItem(key, JSON.stringify(state))
    await render()
    expect(active()).toBe('middleware')
    expect(order()).toEqual(['middleware', 'response', 'policy', 'counter'])
  })

  it('allows revisiting a reviewed change without immediately advancing again', async () => {
    await render()
    await mark('proposed', 'accept')
    expect(active()).toBe('middleware')
    await select('policy')
    expect(active()).toBe('policy')
    await select('middleware')
    expect(active()).toBe('middleware')
  })

  it('keeps the final reviewed change visible and reports completion', async () => {
    await render()
    await mark('proposed', 'accept')
    await mark('proposed', 'deny')
    expect(active()).toBe('counter')
    await mark('diff', 'accept')
    expect(active()).toBe('response')
    await mark('proposed', 'accept')
    expect(active()).toBe('response')
    expect(container.querySelector('.vp-change-review__count')?.textContent).toContain(
      'all reviewed',
    )
    expect(container.querySelector('.vp-change-review__next')).toBeNull()
    expect(order()).toEqual(['policy', 'middleware', 'counter', 'response'])
  })

  it('returns an undone reviewed change to the pending front without moving away', async () => {
    await render()
    await mark('proposed', 'accept')
    await select('policy')
    await mark('proposed', 'accept')
    expect(active()).toBe('policy')
    expect(order()).toEqual(['policy', 'middleware', 'counter', 'response'])
    expect(queue()[0]?.dataset.reviewed).toBe('false')
  })

  it('brings changed reviewed content back to the front at the next revision', async () => {
    await render()
    await mark('proposed', 'accept')
    expect(active()).toBe('middleware')
    const nextModel = {
      ...model,
      decisions: [
        {
          ...model.decisions[0],
          code: model.decisions[0]!.code.map(change =>
            change.id === 'policy'
              ? { ...change, summary: 'Rejections now include a reason.' }
              : change,
          ),
        },
      ],
    }
    await act(async () => root.render(<PlanWorkspace model={nextModel} />))
    expect(active()).toBe('policy')
    expect(order()).toEqual(['policy', 'middleware', 'counter', 'response'])
    expect(queue()[0]?.textContent).toContain('Changed')
  })

  it('closes the previous change comparison when another proposal is selected', async () => {
    const state = emptyFeedback()
    state.reviews = markReview(decisionReviewId('D1'), 'accepted', reviewItems(model), {})
    localStorage.setItem(key, JSON.stringify(state))
    const revised = {
      ...model,
      decisions: [
        {
          ...model.decisions[0],
          code: model.decisions[0]!.code.map(change =>
            ['middleware', 'response'].includes(change.id)
              ? { ...change, summary: `${change.summary} Handle failure explicitly.` }
              : change,
          ),
        },
      ],
    }
    await act(async () => root.render(<PlanWorkspace model={revised} />))
    expect(active()).toBe('middleware')
    const changes = container.querySelector<HTMLDetailsElement>(
      '.vp-code-contract .vp-item-review__changes',
    )!
    await act(async () => {
      changes.open = true
      changes.dispatchEvent(new Event('toggle'))
    })
    expect(changes.querySelector('del')?.textContent).toContain('Use the decision.')
    await select('response')
    const next = container.querySelector<HTMLDetailsElement>('.vp-code-contract details')!
    expect(next.open).toBe(false)
    expect(next.querySelector('del')).toBeNull()
  })
})
