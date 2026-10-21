import { describe, expect, it } from 'vitest'
import {
  CATALOG,
  chartSchema,
  matrixSchema,
  planWorkspaceSchema,
  questionItemSchema,
  questionsSchema,
  statSchema,
} from '../src/index.js'

describe('chartSchema', () => {
  it('accepts a valid bar spec (golden)', () => {
    const result = chartSchema.safeParse({
      type: 'bar',
      series: ['value'],
      data: [{ label: 'x', values: [1] }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid area spec (golden)', () => {
    const result = chartSchema.safeParse({
      type: 'area',
      series: ['value'],
      data: [{ label: 'x', values: [1] }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts each new chart type (golden)', () => {
    for (const type of ['scatter', 'radar', 'gauge', 'funnel', 'treemap']) {
      const result = chartSchema.safeParse({
        type,
        series: ['value'],
        data: [{ label: 'x', values: [1] }],
      })
      expect(result.success).toBe(true)
    }
  })

  it('accepts the stacked attribute and keeps it on the parsed object (golden)', () => {
    const result = chartSchema.safeParse({
      type: 'bar',
      stacked: true,
      series: ['a', 'b'],
      data: [{ label: 'x', values: [1, 2] }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.stacked).toBe(true)
  })

  it('rejects an unknown chart type (error)', () => {
    const result = chartSchema.safeParse({
      type: 'donut',
      series: ['value'],
      data: [{ label: 'x', values: [1] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty data (edge)', () => {
    const result = chartSchema.safeParse({ type: 'pie', series: ['value'], data: [] })
    expect(result.success).toBe(false)
  })
})

describe('planWorkspaceSchema', () => {
  const model = {
    thesis: 'Move mutations behind one owner',
    system: {
      nodes: [
        { id: 'ui', label: 'Editor', kind: 'client', owner: 'Panel', summary: 'Edits pages' },
        { id: 'api', label: 'API', kind: 'service', owner: 'Realm', summary: 'Applies commands' },
      ],
      edges: [{ id: 'command', from: 'ui', to: 'api', label: 'command', decisionIds: ['D1'] }],
    },
    decisions: [
      {
        id: 'D1',
        title: 'One mutation owner',
        summary: 'The coordinator applies every page mutation',
        rationale: 'One writer owns page invariants',
        systemNodeIds: ['api'],
        scenarios: [{ id: 'happy', label: 'Successful edit' }],
      },
    ],
  }

  it('accepts a minimal interactive plan and fills compact defaults (golden)', () => {
    const result = planWorkspaceSchema.safeParse(model)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.decisions[0]?.status).toBe('proposed')
      expect(result.data.decisions[0]?.route).toEqual([])
      expect(result.data.decisions[0]?.scenarios[0]?.sequence).toEqual([])
    }
  })

  it('rejects cross references to unknown nodes and decisions (error)', () => {
    const result = planWorkspaceSchema.safeParse({
      ...model,
      system: {
        ...model.system,
        edges: [{ id: 'broken', from: 'missing', to: 'api', label: 'bad', decisionIds: ['D9'] }],
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a scenario reference to a missing contract primer (edge)', () => {
    const result = planWorkspaceSchema.safeParse({
      ...model,
      decisions: [
        {
          ...model.decisions[0],
          scenarios: [
            {
              id: 'happy',
              label: 'Successful edit',
              sequence: [
                { id: 'send', from: 'Editor', to: 'API', label: 'send', contractId: 'missing' },
              ],
            },
          ],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  const exampleModel = {
    vision: { problem: 'Policy drifts', outcome: 'One owner' },
    decisions: [
      {
        id: 'D1',
        title: 'One owner',
        goal: 'Route policy through one owner.',
        reasoning: { benefits: [{ title: 'Coherence', detail: 'One owner applies policy.' }] },
        examples: [
          {
            id: 'check',
            title: 'Check admission',
            description: 'A developer uses the proposed admission API.',
            language: 'typescript',
            code: 'const decision = await limiter.decide(subject, now)',
            outcome: 'The caller receives a typed decision.',
            result: { label: 'Decision', value: '{ "kind": "allow" }' },
          },
        ],
        code: [
          {
            id: 'check',
            file: 'gateway.ts',
            symbol: 'check',
            language: 'typescript',
            summary: 'Return a typed decision.',
            diff: '-return true\n+return decision',
          },
        ],
      },
    ],
  }

  it('accepts illustrative developer usage without implementation locations or a step sequence', () => {
    const result = planWorkspaceSchema.parse(exampleModel)
    expect(result.decisions[0]?.examples[0]?.result?.language).toBe('json')
    expect(result.decisions[0]?.code[0]?.change).toBe('modify')
  })

  it('accepts a usage example without a concrete result', () => {
    const example = { ...exampleModel.decisions[0]!.examples[0]!, result: undefined }
    expect(
      planWorkspaceSchema.safeParse({
        ...exampleModel,
        decisions: [{ ...exampleModel.decisions[0], examples: [example] }],
      }).success,
    ).toBe(true)
  })

  it('rejects duplicate example IDs so feedback remains unambiguous', () => {
    const example = exampleModel.decisions[0]!.examples[0]!
    expect(
      planWorkspaceSchema.safeParse({
        ...exampleModel,
        decisions: [{ ...exampleModel.decisions[0], examples: [example, example] }],
      }).success,
    ).toBe(false)
  })

  it('requires expected behavior for every illustrative snippet', () => {
    const example = { ...exampleModel.decisions[0]!.examples[0]!, outcome: '' }
    expect(
      planWorkspaceSchema.safeParse({
        ...exampleModel,
        decisions: [{ ...exampleModel.decisions[0], examples: [example] }],
      }).success,
    ).toBe(false)
  })

  it('rejects duplicate code change IDs so browser reviews cannot attach to another edit', () => {
    const code = exampleModel.decisions[0]!.code[0]!
    expect(
      planWorkspaceSchema.safeParse({
        ...exampleModel,
        decisions: [{ ...exampleModel.decisions[0], code: [code, code] }],
      }).success,
    ).toBe(false)
  })

  it('rejects the removed flows field instead of silently dropping the review content', () => {
    const result = planWorkspaceSchema.safeParse({
      ...exampleModel,
      decisions: [{ ...exampleModel.decisions[0], flows: [] }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('Author examples')
  })
})

describe('matrixSchema', () => {
  it('accepts a valid grid with a pick (golden)', () => {
    const result = matrixSchema.safeParse({
      corner: 'Dimension',
      columns: [{ name: 'A', pick: true }, { name: 'B' }],
      rows: [{ label: 'r1', cells: ['x', 'y'] }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects a grid with fewer than two columns (error)', () => {
    const result = matrixSchema.safeParse({
      columns: [{ name: 'A' }],
      rows: [{ label: 'r1', cells: ['x'] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a grid with no rows (edge)', () => {
    const result = matrixSchema.safeParse({ columns: [{ name: 'A' }, { name: 'B' }], rows: [] })
    expect(result.success).toBe(false)
  })
})

describe('questionItemSchema', () => {
  it('accepts a question with multiple-choice options (golden)', () => {
    const result = questionItemSchema.safeParse({
      text: 'Rotate refresh tokens?',
      options: ['Yes, every use', 'Only after 24h'],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.options).toEqual(['Yes, every use', 'Only after 24h'])
  })

  it('rejects an empty option string (error)', () => {
    const result = questionItemSchema.safeParse({ text: 'Rotate?', options: [''] })
    expect(result.success).toBe(false)
  })

  it('defaults options to an empty array (edge)', () => {
    const result = questionItemSchema.safeParse({ text: 'Rotate?' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.options).toEqual([])
  })

  it('rejects empty question text (error)', () => {
    const result = questionItemSchema.safeParse({ text: '', options: [] })
    expect(result.success).toBe(false)
  })
})

describe('questionsSchema', () => {
  it('accepts object items alongside plain strings, normalizing both (golden)', () => {
    const result = questionsSchema.safeParse({
      items: ['Free text only?', { text: 'Rotate?', options: ['Yes', 'No'] }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.items).toEqual([
        { text: 'Free text only?', options: [] },
        { text: 'Rotate?', options: ['Yes', 'No'] },
      ])
    }
  })

  it('rejects an empty string question (error)', () => {
    expect(questionsSchema.safeParse({ items: [''] }).success).toBe(false)
  })

  it('rejects an empty item list (edge)', () => {
    expect(questionsSchema.safeParse({ items: [] }).success).toBe(false)
  })
})

describe('statSchema', () => {
  it('accepts an item with an intent and caption (golden)', () => {
    const result = statSchema.safeParse({
      title: 'Impact',
      items: [{ label: 'Est. uptime', value: '99.9%', intent: 'good', caption: 'rolling avg' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty items (error)', () => {
    const result = statSchema.safeParse({ items: [] })
    expect(result.success).toBe(false)
  })

  it('rejects an item missing its value (edge)', () => {
    const result = statSchema.safeParse({ items: [{ label: 'Files changed' }] })
    expect(result.success).toBe(false)
  })
})

describe('CATALOG', () => {
  it('lists every component with a name, summary, and example (golden)', () => {
    expect(CATALOG.length).toBeGreaterThan(0)
    for (const entry of CATALOG) {
      expect(entry.name).toBeTruthy()
      expect(entry.summary).toBeTruthy()
      expect(entry.example).toBeTruthy()
    }
  })

  it('exposes static enums for the components that constrain string props (edge)', () => {
    const phase = CATALOG.find(entry => entry.name === 'Phase')
    expect(phase?.staticEnums.status).toEqual(['planned', 'active', 'done'])
  })
})

describe('Concise code model comparisons', () => {
  const code = {
    id: 'owner',
    role: 'model',
    file: 'policy.ts',
    symbol: 'Policy',
    current: 'service.allow()',
    proposed: 'gateway.decide()',
  }
  const proposal = (entry: unknown) => ({
    decisions: [{ id: 'ownership', title: 'Share policy', code: [entry] }],
  })

  it('accepts a model without repetitive explanation fields', () => {
    const result = planWorkspaceSchema.parse(proposal(code))
    expect(result.decisions[0]?.code[0]?.role).toBe('model')
    expect(result.decisions[0]?.goal).toBeUndefined()
    expect(result.decisions[0]?.reasoning).toBeUndefined()
  })

  it.each([
    { ...code, current: undefined },
    { ...code, proposed: undefined },
    { ...code, current: ' ' },
    { ...code, diff: '-service.allow()\n+gateway.decide()' },
  ])('requires both sides of a model comparison: %j', entry => {
    expect(planWorkspaceSchema.safeParse(proposal(entry)).success).toBe(false)
  })

  it('keeps existing changes compatible without requiring model fields', () => {
    const result = planWorkspaceSchema.parse(
      proposal({ id: 'edit', file: 'handler.ts', symbol: 'handle', proposed: 'dispatch(request)' }),
    )
    expect(result.decisions[0]?.code[0]?.role).toBe('edit')
  })

  it('accepts code to delete without inventing a replacement', () => {
    const deletion = { ...code, role: 'edit', change: 'delete', proposed: undefined }
    expect(planWorkspaceSchema.safeParse(proposal(deletion)).success).toBe(true)
    expect(
      planWorkspaceSchema.safeParse(proposal({ ...deletion, current: undefined })).success,
    ).toBe(false)
    expect(planWorkspaceSchema.safeParse(proposal({ ...deletion, change: 'modify' })).success).toBe(
      false,
    )
  })

  it('requires unique ownership row identities', () => {
    const row = {
      id: 'search',
      area: 'Search',
      current: 'SearchRouter',
      proposed: 'NavigationRegistry',
    }
    const decision = { ...proposal(code).decisions[0], ownership: [row] }
    expect(planWorkspaceSchema.safeParse({ decisions: [decision] }).success).toBe(true)
    expect(
      planWorkspaceSchema.safeParse({ decisions: [{ ...decision, ownership: [row, row] }] })
        .success,
    ).toBe(false)
  })
})
