// @vitest-environment node
import { evaluate } from '@mdx-js/mdx'
import { baseExpressiveCodeOptions, remarkPlugins } from '@visualplan/compile'
import rehypeExpressiveCode from 'rehype-expressive-code'
import { createElement, type ReactNode } from 'react'
import * as runtime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const samples = [
  ['typescript', 'const limit: number = 10'],
  ['javascript', 'const limit = 10'],
  ['python', 'def allow(count):\n    return count < 10'],
  ['kotlin', 'fun allow(count: Int): Boolean = count < 10'],
  ['dart', 'bool allow(int count) => count < 10;'],
  ['rust', 'fn allow(count: u32) -> bool { count < 10 }'],
  ['go', 'func allow(count int) bool { return count < 10 }'],
  ['java', 'boolean allow(int count) { return count < 10; }'],
  ['csharp', 'bool Allow(int count) => count < 10;'],
  ['sql', 'SELECT count FROM windows WHERE count < 10;'],
  ['bash', 'echo "$TOKEN"'],
  ['json', '{"limit":10}'],
  ['yaml', 'limit: 10'],
  ['html', '<div class="limit">10</div>'],
  ['css', '.limit { color: blue; }'],
  ['c', 'int allow(int count) { return count < 10; }'],
  ['cpp', 'bool allow(int count) { return count < 10; }'],
  ['swift', 'func allow(_ count: Int) -> Bool { count < 10 }'],
] as const

async function renderSnippet(language: string, proposed: string) {
  const model = {
    thesis: 'Highlight code',
    system: {
      nodes: [
        { id: 'owner', label: 'Owner', kind: 'service', owner: 'Team', summary: 'Owns state' },
      ],
      edges: [],
    },
    decisions: [
      {
        id: 'D1',
        title: 'Typed boundary',
        summary: 'Use a contract',
        rationale: 'Make policy explicit',
        systemNodeIds: ['owner'],
        scenarios: [{ id: 'success', label: 'Success' }],
        code: [
          {
            id: 'code',
            role: 'model',
            file: 'example',
            symbol: 'allow',
            summary: 'A contract',
            language,
            current: proposed,
            proposed,
          },
        ],
      },
    ],
  }
  const source = `<PlanWorkspace>\n\n\`\`\`json\n${JSON.stringify(model)}\n\`\`\`\n\n</PlanWorkspace>`
  const { default: Content } = await evaluate(source, {
    ...runtime,
    remarkPlugins,
    rehypePlugins: [[rehypeExpressiveCode, baseExpressiveCodeOptions]],
  })
  const html = renderToStaticMarkup(
    createElement(Content, {
      components: {
        PlanWorkspace: ({ children }: { children: ReactNode }) =>
          createElement('section', null, children),
      },
    }),
  )
  return new JSDOM(html, { url: 'https://example.test' }).window.document
}

describe('Workspace snippets use the standard code highlighter', () => {
  it.each(
    samples,
  )('highlights %s at build time with both theme palettes', async (language, code) => {
    const document = await renderSnippet(language, code)
    const blocks = document.querySelectorAll('[data-workspace-code]')
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      expect([...block.querySelectorAll('.ec-line')].map(line => line.textContent).join('\n')).toBe(
        code,
      )
      expect(block.querySelectorAll('span[style*="--0"]').length).toBeGreaterThan(0)
      expect(block.querySelectorAll('span[style*="--1"]').length).toBeGreaterThan(0)
    }
  })

  it('escapes code markup and keeps an unsupported language readable', async () => {
    const code = '<script>alert("not executable")</script>'
    const document = await renderSnippet('not-a-real-language', code)
    expect(document.querySelector('code')?.textContent).toBe(code)
    expect(document.querySelector('code script')).toBeNull()
    expect(
      [...document.querySelectorAll('script')].some(script =>
        script.textContent?.includes('not executable'),
      ),
    ).toBe(false)
  })

  it('highlights illustrative usage, optional results, and unified diffs', async () => {
    const model = {
      vision: { problem: 'Policy drifts', outcome: 'One owner' },
      decisions: [
        {
          id: 'D1',
          title: 'One owner',
          goal: 'Route one request through one owner.',
          reasoning: {
            benefits: [{ title: 'Coherence', detail: 'One owner applies policy.' }],
          },
          examples: [
            {
              id: 'request',
              title: 'Check admission',
              description: 'A developer calls the proposed admission API.',
              language: 'typescript',
              code: 'const decision = await policy.check(request)',
              outcome: 'The caller receives a typed result.',
              result: { label: 'Decision', value: '{"kind":"allow"}' },
            },
            {
              id: 'handle-rejection',
              title: 'Handle rejection',
              description: 'A caller uses retry metadata.',
              language: 'typescript',
              code: "if (decision.kind === 'reject') retryAfter(decision.retryAfterSeconds)",
              outcome: 'The caller can schedule a retry.',
            },
          ],
          code: [
            {
              id: 'check',
              file: 'gateway.ts',
              symbol: 'check',
              language: 'typescript',
              summary: 'Return a typed decision.',
              diff: "-return true\n+return { kind: 'allow' }",
            },
            {
              id: 'remove',
              file: 'legacy.ts',
              symbol: 'LegacyPolicy',
              language: 'typescript',
              change: 'delete',
              current: 'class LegacyPolicy {}',
            },
          ],
        },
      ],
    }
    const source = `<PlanWorkspace>\n\n\`\`\`json\n${JSON.stringify(model)}\n\`\`\`\n\n</PlanWorkspace>`
    const { default: Content } = await evaluate(source, {
      ...runtime,
      remarkPlugins,
      rehypePlugins: [[rehypeExpressiveCode, baseExpressiveCodeOptions]],
    })
    const html = renderToStaticMarkup(
      createElement(Content, {
        components: {
          PlanWorkspace: ({ children }: { children: ReactNode }) =>
            createElement('section', null, children),
        },
      }),
    )
    const document = new JSDOM(html, { url: 'https://example.test' }).window.document
    const blocks = [...document.querySelectorAll<HTMLElement>('[data-workspace-code]')]
    expect(blocks).toHaveLength(5)
    expect(blocks.map(block => block.dataset.workspaceCode)).toEqual([
      '["D1","check","diff"]',
      '["D1","remove","current"]',
      '["D1","example","request","code"]',
      '["D1","example","request","result"]',
      '["D1","example","handle-rejection","code"]',
    ])
    expect(blocks.every(block => block.querySelector('.expressive-code'))).toBe(true)
  })
})
