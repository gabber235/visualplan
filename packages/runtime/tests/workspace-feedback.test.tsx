import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { planWorkspaceSchema } from '@visualplan/core'
import { PlanWorkspace } from '../components/workspace/PlanWorkspace.js'
import {
  decisionReviewId,
  exampleReviewId,
  codeReviewId,
  reviewItems,
} from '../components/workspace/review-state.js'
import { collectCodeSlots } from '../components/workspace/code-slots.js'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  captureTarget,
  emptyFeedback,
  exportFeedback,
  feedbackKey,
  legacyFeedbackKey,
  feedbackSchema,
  reviewAnchor,
  workspaceRevision,
} from '../components/workspace/feedback.js'

vi.mock('../components/workspace/review-storage.js', () => ({
  readSavedFeedback: async (key: string, legacyKey: string) =>
    localStorage.getItem(key) ?? localStorage.getItem(legacyKey),
  writeSavedFeedback: async (key: string, value: string) => localStorage.setItem(key, value),
}))

const model = planWorkspaceSchema.parse({
  vision: {
    problem: 'Policy ownership is duplicated',
    outcome: 'One policy owner',
  },
  decisions: [
    {
      id: 'D1',
      title: 'Central policy',
      goal: 'Put the complete admission policy in the gateway.',
      reasoning: {
        benefits: [{ title: 'Prevent drift', detail: 'One owner applies every public limit.' }],
        costs: [],
      },
      examples: [
        {
          id: 'allowed-request',
          title: 'Check an authenticated request',
          description: 'A gateway developer calls the proposed admission API.',
          language: 'typescript',
          code: 'const decision = await limiter.decide(subject, clock.now())',
          outcome: 'The caller receives a typed admission result.',
          result: { label: 'Decision', value: '{ "kind": "allow" }' },
        },
      ],
      code: [
        {
          id: 'decision',
          file: 'gateway.ts',
          symbol: 'decide',
          language: 'typescript',
          summary: 'Return a typed decision.',
          proposed: "type Decision = { kind: 'allow' } | { kind: 'reject' }",
        },
      ],
    },
  ],
})

describe('Portable feedback anchors and export', () => {
  it('keeps shared highlight styles independent of whichever snippet is selected', () => {
    const slots = collectCodeSlots([
      <div key='one' data-workspace-code='one'>
        <div className='expressive-code'>
          <style>{'.ec-line span { color: var(--0) }'}</style>
          <pre>first snippet</pre>
        </div>
      </div>,
      <div key='two' data-workspace-code='two'>
        <div className='expressive-code'>
          <pre>second snippet</pre>
        </div>
      </div>,
    ])
    expect(slots.styles).toHaveLength(1)
    expect(
      renderToStaticMarkup(
        <>
          {slots.styles}
          {slots.blocks.get('two')}
        </>,
      ),
    ).toContain('<style>.ec-line span { color: var(--0) }</style>')
    expect(renderToStaticMarkup(slots.blocks.get('one'))).not.toContain('<style>')
    expect(renderToStaticMarkup(slots.blocks.get('two'))).toContain('second snippet')
  })
  it('captures semantic ancestry and an exact quote with surrounding text', () => {
    const root = document.createElement('div')
    const parent = document.createElement('section')
    for (const [key, value] of Object.entries(reviewAnchor('decision:D1', 'D1: Central policy')))
      parent.setAttribute(key, value)
    const leaf = document.createElement('p')
    for (const [key, value] of Object.entries(reviewAnchor('contract:retry', 'gateway.ts: retry')))
      leaf.setAttribute(key, value)
    leaf.textContent = 'Return a retry delay before dispatch.'
    parent.append(leaf)
    root.append(parent)
    const range = document.createRange()
    range.setStart(leaf.firstChild!, 9)
    range.setEnd(leaf.firstChild!, 20)
    expect(captureTarget(leaf, root, range)).toMatchObject({
      path: ['decision:D1', 'contract:retry'],
      decisionId: 'D1',
      quote: 'retry delay',
      prefix: 'Return a ',
      suffix: ' before dispatch.',
    })
  })

  it('bounds selected text context for compact feedback packets', () => {
    const root = document.createElement('div')
    const leaf = document.createElement('p')
    for (const [key, value] of Object.entries(reviewAnchor('goal', 'Decision goal')))
      leaf.setAttribute(key, value)
    leaf.textContent = `${'a'.repeat(200)}${'b'.repeat(1000)}${'c'.repeat(200)}`
    root.append(leaf)
    const range = document.createRange()
    range.setStart(leaf.firstChild!, 200)
    range.setEnd(leaf.firstChild!, 1200)

    const target = captureTarget(leaf, root, range)
    expect(target.excerpt.length).toBe(800)
    expect(target.quote?.length).toBe(400)
    expect(target.prefix?.length).toBe(48)
    expect(target.suffix?.length).toBe(48)
    expect(target.excerpt.endsWith('…')).toBe(true)
    expect(target.quote?.endsWith('…')).toBe(true)
  })

  it('excludes generated stylesheet content from code context', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<section data-review-id="code" data-review-label="Code"><style>.x{color:red}</style><pre>const limit = 5</pre></section>'
    expect(captureTarget(root.querySelector('pre')!, root).excerpt).toBe('const limit = 5')
  })

  it('preserves highlighted code line breaks without mixing in display labels', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<section data-review-id="proposed" data-review-label="Proposed code"><span>Proposed</span><pre><code><div class="ec-line">type Decision =</div><div class="ec-line">  | Allow</div></code></pre></section>'
    expect(captureTarget(root.querySelector('code')!, root).excerpt).toBe(
      'type Decision =\n  | Allow',
    )
  })

  it('exports comments with locations and quotes without review records or item inventories', () => {
    const state = emptyFeedback()
    const item = reviewItems(model).get(decisionReviewId('D1'))!
    state.reviews[item.id] = { status: 'denied', snapshot: item.snapshot, invalidated: false }
    state.preferences.D1 = 'Services'
    state.comments.push({
      id: 'comment1',
      kind: 'question',
      body: 'What owns retries?',
      target: {
        path: ['decision:D1', 'call:check'],
        labels: ['D1: Central policy', 'Allowed request / check token'],
        excerpt: 'check token',
        quote: 'token',
        prefix: 'check ',
        decisionId: 'D1',
      },
    })
    const text = exportFeedback(model, state, 'Policy plan')
    for (const value of [
      'Policy plan',
      workspaceRevision(model),
      'call:check',
      'Selected text: "token"',
      'What owns retries?',
    ])
      expect(text).toContain(value)
    expect(text).not.toContain('Content at review time: "check token"')
    for (const value of [
      'Review status:',
      'Decision review',
      'Code block review',
      'Item ID:',
      'Preferred alternative:',
      'Proposed code',
      model.vision!.outcome,
    ])
      expect(text).not.toContain(value)
    const withoutMarks = { ...state, reviews: {}, preferences: {} }
    expect(text).toBe(exportFeedback(model, withoutMarks, 'Policy plan'))
  })

  it('keeps an export with no comments constant in size for a thousand reviewed code blocks', () => {
    const large = {
      ...model,
      decisions: [
        {
          ...model.decisions[0]!,
          code: Array.from({ length: 1000 }, (_, i) => ({
            ...model.decisions[0]!.code[0]!,
            id: `change:${i}`,
            symbol: `operation${i}`,
            proposed: Array.from({ length: 20 }, (_, line) => `const value${line} = ${i}`).join(
              '\n',
            ),
          })),
        },
      ],
    }
    const state = emptyFeedback()
    for (const item of reviewItems(large).values()) {
      if (item.kind === 'group') continue
      state.reviews[item.id] = {
        status: item.kind === 'decision' ? 'denied' : 'accepted',
        snapshot: item.snapshot,
        invalidated: false,
      }
    }
    const text = exportFeedback(large, state, 'Policy plan')
    expect(text).toBe(
      `# Plan feedback: Policy plan\nRevision: ${workspaceRevision(large)}\n\nNo comments recorded.`,
    )
    expect(text.length).toBe(exportFeedback(model, emptyFeedback(), 'Policy plan').length)
  })

  it('keeps compact item context when no text selection identifies the target', () => {
    const state = emptyFeedback()
    state.comments.push({
      id: 'comment1',
      kind: 'change',
      body: 'Use the typed boundary here.',
      target: {
        path: ['decision:D1', 'goal'],
        labels: ['D1: Central policy', 'Decision goal'],
        excerpt: 'Put the complete admission policy in the gateway.',
        decisionId: 'D1',
      },
    })
    expect(exportFeedback(model, state, 'Policy plan')).toContain(
      'Context: "Put the complete admission policy in the gateway."',
    )
  })

  it('identifies revisions without changing the storage slot and rejects corrupt feedback', () => {
    expect(workspaceRevision(model)).not.toBe(
      workspaceRevision({
        ...model,
        vision: { ...model.vision, outcome: 'Different policy' },
      }),
    )
    expect(feedbackKey('/one.html')).not.toBe(feedbackKey('/two.html'))
    expect(feedbackKey('/one.html')).toBe('vp-feedback:/one.html')
    expect(
      feedbackSchema.safeParse({ version: 1, comments: [{ body: 'missing anchor' }] }).success,
    ).toBe(false)
  })
})

describe('Portable feedback workflow', () => {
  let container: HTMLDivElement
  let root: Root
  const key = feedbackKey(location.pathname)
  beforeEach(() => {
    localStorage.removeItem(key)
    localStorage.removeItem(legacyFeedbackKey(model, location.pathname))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    localStorage.removeItem(key)
    localStorage.removeItem(legacyFeedbackKey(model, location.pathname))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      item => item.textContent?.trim() === name || item.getAttribute('aria-label') === name,
    )!
  const fill = async (value: string) => {
    const field = container.querySelector<HTMLTextAreaElement>('form textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        value,
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const block = (id: string) =>
    [...container.querySelectorAll<HTMLElement>('[data-review-item]')].find(
      element => element.dataset.reviewItem === id,
    )!
  const markBlock = async (id: string, action: 'accept' | 'deny') => {
    await act(async () =>
      block(id).querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click(),
    )
  }

  it('renders ownership beside the model and reviews a deletion without replacement code', async () => {
    const removal = planWorkspaceSchema.parse({
      decisions: [
        {
          id: 'cleanup',
          title: 'Central policy',
          ownership: [
            {
              id: 'search',
              area: 'Search',
              current: 'SearchRateGate',
              proposed: 'AdmissionPolicy',
              removed: ['SearchRateGate'],
            },
          ],
          code: [
            {
              id: 'old',
              file: 'search.ts',
              symbol: 'SearchRateGate',
              change: 'delete',
              current: 'function allow() { return count < limit }',
            },
          ],
        },
      ],
    })
    await act(async () => root.render(<PlanWorkspace model={removal} />))
    const row = container.querySelector('[data-review-id="ownership:search"]')!
    expect(row.textContent).toContain('AdmissionPolicy')
    expect(row.textContent).toContain('SearchRateGate')
    const itemId = codeReviewId('cleanup', 'old', 'current')
    const details = block(itemId).querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('View code to delete')
    await act(async () => {
      details.open = true
    })
    expect(details.querySelector('code')?.textContent).toBe(
      'function allow() { return count < limit }',
    )
    expect(container.querySelector('[data-review-id="proposed"]')).toBeNull()
    await markBlock(itemId, 'accept')
    await act(async () => root.render(<PlanWorkspace key='reload' model={removal} />))
    expect(block(itemId).dataset.status).toBe('accepted')
    const changed = structuredClone(removal)
    changed.decisions[0]!.code[0]!.current += '\nallow()'
    await act(async () => root.render(<PlanWorkspace model={changed} />))
    expect(block(itemId).dataset.status).toBe('unreviewed')
  })

  it('reviews separate decisions one at a time without losing their marks', async () => {
    const second = {
      ...model.decisions[0]!,
      id: 'D2',
      title: 'Share policy with search',
      examples: [],
      code: [{ ...model.decisions[0]!.code[0]!, proposed: 'return searchPolicy.decide(query)' }],
    }
    await act(async () =>
      root.render(<PlanWorkspace model={{ ...model, decisions: [...model.decisions, second] }} />),
    )
    const navigation = container.querySelector('nav[aria-label="Technical decisions"]')!
    const decisions = [...navigation.querySelectorAll('button')]
    expect(decisions).toHaveLength(2)
    const firstCode = codeReviewId('D1', 'decision', 'proposed')
    const secondCode = codeReviewId('D2', 'decision', 'proposed')
    await markBlock(firstCode, 'accept')
    await act(async () => decisions[1]!.click())
    expect(container.querySelector('.vp-decision-workbench h2')?.textContent).toBe(second.title)
    expect(container.querySelector('.vp-developer-experience')).toBeNull()
    expect(block(firstCode)).toBeUndefined()
    expect(block(secondCode).textContent).toContain('searchPolicy.decide(query)')
    await markBlock(secondCode, 'deny')
    await act(async () => decisions[0]!.click())
    expect(block(firstCode).dataset.status).toBe('accepted')
    expect(block(secondCode)).toBeUndefined()
    expect(container.querySelector('.vp-developer-experience')).not.toBeNull()
    await act(async () => decisions[1]!.click())
    expect(block(secondCode).dataset.status).toBe('denied')
  })

  it('saves independent code marks and restores them after reload', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    const usage = exampleReviewId('D1', 'allowed-request', 'code')
    const proposed = codeReviewId('D1', 'decision', 'proposed')
    await markBlock(usage, 'accept')
    await markBlock(proposed, 'deny')
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    expect(block(usage).dataset.status).toBe('accepted')
    expect(block(proposed).dataset.status).toBe('denied')
    expect(container.querySelector('.vp-item-review__controls .vp-review-status')).toBeNull()
    expect(
      [...block(usage).querySelectorAll<HTMLButtonElement>('[data-action]')].map(
        button => button.dataset.action,
      ),
    ).toEqual(['deny', 'accept'])
    expect(container.querySelector('.vp-review-progress p')?.textContent).toContain(
      '2 of 2 blocks reviewed',
    )
    await markBlock(proposed, 'deny')
    expect(block(proposed).dataset.status).toBe('unreviewed')
  })

  it('recovers accepted snapshots saved before optional reasoning serialized correctly', async () => {
    const withoutReasoning = planWorkspaceSchema.parse({
      decisions: [
        {
          ...model.decisions[0]!,
          reasoning: undefined,
        },
      ],
    })
    const saved = emptyFeedback()
    for (const item of reviewItems(withoutReasoning).values()) {
      if (item.kind !== 'group')
        saved.reviews[item.id] = { status: 'accepted', snapshot: item.snapshot, invalidated: false }
    }
    const older = JSON.parse(JSON.stringify(saved))
    delete older.reviews[decisionReviewId('D1')].snapshot.reasoning.text
    localStorage.setItem(key, JSON.stringify(older))
    await act(async () => root.render(<PlanWorkspace model={withoutReasoning} />))
    expect(container.querySelector('.vp-decision-workbench__identity')?.textContent).toBe(
      'Accepted',
    )
    expect(container.textContent).not.toContain('Saved feedback is unavailable')
    const revised = structuredClone(withoutReasoning)
    revised.decisions[0]!.code[0]!.proposed = "type Decision = { kind: 'retry' }"
    await act(async () => root.render(<PlanWorkspace key='revised' model={revised} />))
    expect(container.querySelector('.vp-code-contract .vp-review-status')?.textContent).toBe(
      'Changed',
    )
    expect(
      block(codeReviewId('D1', 'decision', 'proposed')).querySelector('details'),
    ).not.toBeNull()
  })

  it('retains unaffected code marks and shows the actual edit after a revised render', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    const usage = exampleReviewId('D1', 'allowed-request', 'code')
    const proposed = codeReviewId('D1', 'decision', 'proposed')
    await markBlock(usage, 'accept')
    await markBlock(proposed, 'accept')
    const next = {
      ...model,
      decisions: [
        {
          ...model.decisions[0],
          examples: [
            {
              ...model.decisions[0]!.examples[0],
              code: 'const decision = await limiter.decide(subject, now)',
            },
          ],
        },
      ],
    }
    await act(async () => root.render(<PlanWorkspace model={next} />))
    expect(block(usage).dataset.status).toBe('unreviewed')
    expect(
      container.querySelector('.vp-developer-experience__heading .vp-review-status')?.textContent,
    ).toBe('Changed')
    expect(block(proposed).dataset.status).toBe('accepted')
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    const changes = block(usage).querySelector<HTMLDetailsElement>('details')!
    await act(async () => {
      changes.open = true
      changes.dispatchEvent(new Event('toggle'))
    })
    expect(changes.querySelector('del')?.textContent).toContain('clock.now()')
    expect(changes.querySelector('ins')?.textContent).toContain('subject, now')
    await act(async () => button('Export feedback').click())
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Feedback packet"]')?.value,
    ).not.toContain('changed since review')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close feedback"]')!.click(),
    )
    await markBlock(usage, 'accept')
    expect(block(usage).querySelector('details')).toBeNull()
    expect(container.querySelector('.vp-decision-workbench__identity')?.textContent).toBe(
      'Accepted',
    )
    expect(container.querySelector('.vp-decision-workbench > header details')).toBeNull()
  })

  it('saves a comparison baseline when the final child makes a decision accepted', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    const ids = [
      exampleReviewId('D1', 'allowed-request', 'code'),
      codeReviewId('D1', 'decision', 'proposed'),
    ]
    await markBlock(ids[0]!, 'accept')
    expect(container.querySelector<HTMLElement>('.vp-decision-workbench')?.dataset.status).toBe(
      'unreviewed',
    )
    await markBlock(ids[1]!, 'accept')
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    expect(container.querySelector<HTMLElement>('.vp-decision-workbench')?.dataset.status).toBe(
      'accepted',
    )
    expect(
      container.querySelector<HTMLButtonElement>('.vp-decision-workbench [data-action="accept"]')
        ?.textContent,
    ).toBe('Accepted')
    expect(
      feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).reviews[decisionReviewId('D1')],
    ).toMatchObject({ status: 'unreviewed', invalidated: false })
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1')
    const updated = structuredClone(model)
    updated.decisions[0]!.goal = 'The gateway also owns retries.'
    await act(async () => root.render(<PlanWorkspace key='changed' model={updated} />))
    expect(container.querySelector('.vp-decision-workbench__identity')?.textContent).toBe('Changed')
    const details = container.querySelector<HTMLDetailsElement>(
      '.vp-decision-workbench > header details',
    )!
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(details.querySelector('del')?.textContent).toContain(model.decisions[0]!.goal)
    expect(details.querySelector('ins')?.textContent).toContain('The gateway also owns retries.')
    await act(async () => root.render(<PlanWorkspace key='reload-changed' model={updated} />))
    expect(container.querySelector('.vp-decision-workbench__identity')?.textContent).toBe('Changed')
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.vp-decision-workbench > header [data-action="accept"]')!
        .click(),
    )
    expect(container.querySelector('.vp-decision-workbench__identity')?.textContent).toBe(
      'Accepted',
    )
    await markBlock(ids[1]!, 'accept')
    expect(container.querySelector<HTMLElement>('.vp-decision-workbench')?.dataset.status).toBe(
      'unreviewed',
    )
  })

  it('keeps nested approvals when the decision description changes', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Accept').click())
    const next = {
      ...model,
      decisions: [{ ...model.decisions[0], goal: 'Make admission outcomes explicit.' }],
    }
    await act(async () => root.render(<PlanWorkspace key='revision' model={next} />))
    for (const id of [
      exampleReviewId('D1', 'allowed-request', 'code'),
      codeReviewId('D1', 'decision', 'proposed'),
    ]) {
      expect(block(id).dataset.status).toBe('accepted')
      expect(block(id).querySelector('details')).toBeNull()
    }
    expect(container.querySelector('.vp-decision-workbench__identity')?.textContent).toContain(
      'Changed',
    )
    expect(container.querySelector('.vp-review-progress p')?.textContent).toContain(
      '2 of 2 blocks reviewed',
    )
    const changes = container.querySelector<HTMLDetailsElement>(
      '.vp-decision-workbench .vp-item-review__changes',
    )!
    await act(async () => {
      changes.open = true
      changes.dispatchEvent(new Event('toggle'))
    })
    expect([...changes.querySelectorAll('section > strong')].map(item => item.textContent)).toEqual(
      ['Decision goal'],
    )
    expect(changes.querySelector('del')?.textContent).toContain(model.decisions[0]!.goal)
    expect(changes.querySelector('ins')?.textContent).toContain('Make admission outcomes explicit.')
  })

  it('retains comment provenance and drafts across unrelated revisions', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('Keep the typed boundary')
    await act(async () => button('Save comment').click())
    const next = { ...model, vision: { ...model.vision, problem: 'Updated introduction' } }
    await act(async () => root.render(<PlanWorkspace model={next} />))
    await act(async () => button('Export feedback').click())
    const packet = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Feedback packet"]',
    )?.value
    expect(packet).toContain('Keep the typed boundary')
    expect(packet).not.toContain('Comment revision:')
    expect(packet).toContain(`Revision: ${workspaceRevision(planWorkspaceSchema.parse(next))}`)
  })

  it('persists retirement of changed comments so reverting source cannot resurrect them', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('  This comment is tied to this goal.\nKeep these words.  ')
    await act(async () => button('Save comment').click())
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments[0]?.body).toBe(
      '  This comment is tied to this goal.\nKeep these words.  ',
    )
    const next = {
      ...model,
      decisions: [{ ...model.decisions[0]!, goal: 'A different ownership rule' }],
    }
    await act(async () => root.render(<PlanWorkspace key='edited' model={next} />))
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments).toEqual([])
    await act(async () => root.render(<PlanWorkspace key='reverted' model={model} />))
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments).toEqual([])
  })

  it('removes comments on deleted offscreen targets while retaining unchanged comments', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () =>
      container.querySelector<HTMLElement>('[data-review-id="result"]')!.click(),
    )
    await fill('Check this returned value')
    await act(async () => button('Save comment').click())
    const next = {
      ...model,
      decisions: [
        { ...model.decisions[0]!, id: 'D2', title: 'Another decision' },
        { ...model.decisions[0]!, examples: [] },
      ],
    }
    await act(async () => root.render(<PlanWorkspace key='removed' model={next} />))
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments).toEqual([])
  })

  it('keeps stale draft input visible and blocks saving against the changed target', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('Do not lose my unfinished comment')
    const next = { ...model, decisions: [{ ...model.decisions[0]!, goal: 'Different goal' }] }
    await act(async () => root.render(<PlanWorkspace key='changed' model={next} />))
    expect(container.querySelector<HTMLTextAreaElement>('form textarea')?.value).toBe(
      'Do not lose my unfinished comment',
    )
    expect(button('Save comment').disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'changed or was removed',
    )
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments).toEqual([])
  })

  it('preserves an exact existing browser approval without trusting authored status', async () => {
    localStorage.setItem(
      legacyFeedbackKey(model, location.pathname),
      JSON.stringify({ version: 1, comments: [], statuses: { D1: 'accepted' }, preferences: {} }),
    )
    await act(async () => root.render(<PlanWorkspace model={model} />))
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    expect(
      feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).reviews[decisionReviewId('D1')]
        ?.status,
    ).toBe('accepted')
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).version).toBe(2)
    expect(block(exampleReviewId('D1', 'allowed-request', 'code')).dataset.status).toBe(
      'unreviewed',
    )
  })

  it('shows nested denial on every parent and prevents accepting it after reload', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Accept').click())
    const proposed = codeReviewId('D1', 'decision', 'proposed')
    await markBlock(proposed, 'deny')
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    for (const selector of [
      '.vp-code-contract',
      '[aria-label="Code changes"]',
      '.vp-decision-workbench',
      '.vp-workspace__mast',
    ])
      expect(container.querySelector<HTMLElement>(selector)?.dataset.status).toBe('denied')
    expect(container.querySelector('.vp-workspace__decisions')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    await act(async () => button('Undo accept').click())
    expect(
      container.querySelector<HTMLButtonElement>('.vp-decision-workbench [data-action="accept"]')
        ?.disabled,
    ).toBe(true)
    await act(async () => button('Export feedback').click())
    const packet = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Feedback packet"]',
    )!.value
    expect(packet).toContain('No comments recorded.')
    expect(packet).not.toContain('Review status:')
  })

  it('decision actions preserve existing child marks and undo clears only the decision', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    const usage = exampleReviewId('D1', 'allowed-request', 'code')
    const proposed = codeReviewId('D1', 'decision', 'proposed')
    await markBlock(usage, 'accept')
    await act(async () => button('Deny').click())
    expect(block(usage).dataset.status).toBe('accepted')
    expect(block(proposed).dataset.status).toBe('denied')
    await act(async () => button('Undo deny').click())
    expect(block(proposed).dataset.status).toBe('denied')
    expect(
      feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).reviews[decisionReviewId('D1')]
        ?.status,
    ).toBe('unreviewed')
    await markBlock(proposed, 'deny')
    await act(async () => button('Accept').click())
    expect(block(proposed).dataset.status).toBe('accepted')
    await act(async () => button('Undo accept').click())
    expect(block(usage).dataset.status).toBe('accepted')
    expect(block(proposed).dataset.status).toBe('accepted')
    expect(container.querySelector<HTMLElement>('.vp-decision-workbench')?.dataset.status).toBe(
      'accepted',
    )
  })

  it('removes inherited denial when a revised contract needs review again', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    const proposed = codeReviewId('D1', 'decision', 'proposed')
    await markBlock(proposed, 'deny')
    const next = {
      ...model,
      decisions: [
        {
          ...model.decisions[0],
          code: [
            { ...model.decisions[0]!.code[0], summary: 'Return a rejection on store failure.' },
          ],
        },
      ],
    }
    await act(async () => root.render(<PlanWorkspace model={next} />))
    expect(block(proposed).dataset.status).toBe('unreviewed')
    expect(
      container.querySelector<HTMLElement>('[aria-label="Code changes"]')?.dataset.status,
    ).toBe('unreviewed')
    expect(container.querySelector<HTMLElement>('.vp-decision-workbench')?.dataset.status).toBe(
      'unreviewed',
    )
    expect(container.querySelector<HTMLElement>('.vp-workspace__mast')?.dataset.status).toBe(
      'unreviewed',
    )
    expect(
      container.querySelector<HTMLButtonElement>('.vp-decision-workbench [data-action="accept"]')
        ?.disabled,
    ).toBe(false)
    expect(container.querySelector('.vp-code-contract')?.textContent).toContain('Changed')
  })

  it('does not overwrite corrupt saved review evidence', async () => {
    localStorage.setItem(key, '{broken')
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Accept').click())
    expect(localStorage.getItem(key)).toBe('{broken')
    expect(container.textContent).toContain('Saved feedback is unavailable')
    await act(async () => button('Export feedback').click())
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Feedback packet"]')?.value,
    ).toContain('No comments recorded.')
  })

  it('comments on a concrete data output and restores it after reload', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () =>
      container.querySelector<HTMLElement>('[data-review-id="result"]')!.click(),
    )
    expect(button('Save comment').disabled).toBe(true)
    await fill('Show the tenant identifier in this decision example.')
    await act(async () => button('Save comment').click())
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    await act(async () => button('Export feedback').click())
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Feedback packet"]')?.value,
    ).toContain('Show the tenant identifier in this decision example.')
  })

  it('preserves an unfinished draft and does not change decision status when dismissed', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('Consider ownership here')
    await act(async () => button('Keep draft').click())
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    expect(container.querySelector<HTMLTextAreaElement>('form textarea')?.value).toBe(
      'Consider ownership here',
    )
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
  })

  it('anchors developer example feedback to the exact result', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () =>
      container.querySelector<HTMLElement>('[data-review-id="result"]')!.click(),
    )
    await fill('This example needs the applied policy version.')
    await act(async () => button('Save comment').click())
    const saved = feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!))
    expect(saved.comments[0]?.target.path).toEqual([
      'decision:D1',
      'developer-experience',
      'example:allowed-request',
      'outcome',
      'result',
    ])
  })

  it('keeps acceptance and removes challenge and alternative controls', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    expect(button('Challenge')).toBeUndefined()
    expect(container.querySelector('.vp-alternative-choice')).toBeNull()
    await act(async () => button('Accept').click())
    expect(
      feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).reviews[decisionReviewId('D1')]
        ?.status,
    ).toBe('accepted')
  })

  it('retains export access when storage cannot be written', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await act(async () => button('Accept').click())
    expect(container.textContent).toContain('Reviews are not saved')
    await act(async () => button('Export feedback').click())
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Feedback packet"]')?.value,
    ).toContain('No comments recorded.')
  })

  it('edits a saved comment without duplicating it and supports removal with undo', async () => {
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('First concern')
    await act(async () => button('Save comment').click())
    await act(async () => button('Feedback 1').click())
    await act(async () => button('Edit').click())
    await fill('Refined concern')
    await act(async () => button('Save changes').click())
    let saved = feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!))
    expect(saved.comments).toHaveLength(1)
    expect(saved.comments[0]?.body).toBe('Refined concern')
    await act(async () => button('Feedback 1').click())
    await act(async () => button('Remove').click())
    saved = feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!))
    expect(saved.comments).toHaveLength(0)
    await act(async () => button('Undo removal').click())
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments[0]?.body).toBe(
      'Refined concern',
    )
  })

  it('copies comment feedback and offers manual copying on failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('Keep retry ownership explicit.')
    await act(async () => button('Save comment').click())
    await act(async () => button('Export feedback').click())
    await act(async () => button('Copy feedback').click())
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`Revision: ${workspaceRevision(model)}`),
    )
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Keep retry ownership explicit.'),
    )
    expect(container.textContent).toContain('Copied.')
    writeText.mockRejectedValue(new Error('Denied'))
    await act(async () => button('Copy feedback').click())
    expect(container.textContent).toContain('Clipboard unavailable')
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Feedback packet"]')?.value,
    ).toContain('Keep retry ownership explicit.')
  })

  it('retires sent comments once a revised plan loads', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await act(async () => root.render(<PlanWorkspace model={model} />))
    await act(async () => button('Comment on an item').click())
    await act(async () => container.querySelector<HTMLElement>('[data-review-id="goal"]')!.click())
    await fill('Keep retry ownership explicit.')
    await act(async () => button('Save comment').click())
    await act(async () => button('Export feedback').click())
    await act(async () => button('Copy feedback').click())
    await act(async () => root.render(<PlanWorkspace key='reload' model={model} />))
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments).toHaveLength(1)
    const revised = structuredClone(model)
    revised.decisions[0]!.title = 'Central admission policy'
    await act(async () => root.render(<PlanWorkspace model={revised} />))
    expect(button('Feedback 0')).toBeDefined()
    expect(feedbackSchema.parse(JSON.parse(localStorage.getItem(key)!)).comments).toHaveLength(0)
  })
})
