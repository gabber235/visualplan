import { visit } from 'unist-util-visit'
import { planWorkspaceSchema } from '@visualplan/core'
import { BLOCK_DATA_ATTR, CHILD_BLOCK_COMPONENTS, parseBlockChildren } from './plan-blocks.js'

interface MdxJsxAttribute {
  type: string
  name?: string
  value?: unknown
}

interface MdxJsxElement {
  type: string
  name?: string | null
  attributes?: MdxJsxAttribute[]
  children: unknown[]
}

const BLOCK_NAMES: readonly string[] = CHILD_BLOCK_COMPONENTS

/**
 * Translate the markdown-list children of the list-shaped plan components
 * (FileTree, Checklist, Questions, Chart, Compare) into a JSON-string data prop,
 * then drop the children. The component decodes that prop at render and validates
 * it with zod, exactly as if the data had been written inline.
 *
 * Runs in the remark (mdast) stage AFTER remark-gfm (so task-list `checked` state
 * is available) and alongside remarkMermaid. Mirrors how remarkMermaid passes a
 * diagram as a string attribute.
 */
export function remarkPlanBlocks() {
  return (tree: unknown, file?: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : undefined
    visit(tree as never, 'mdxJsxFlowElement', (node: MdxJsxElement) => {
      const name = node.name
      if (!name || !BLOCK_NAMES.includes(name)) return
      const attr = BLOCK_DATA_ATTR[name]
      if (!attr) return
      const { value } = parseBlockChildren(name, node, source)
      const visuals =
        name === 'PlanWorkspace'
          ? node.children.filter(
              (child): child is MdxJsxElement =>
                (child as MdxJsxElement).type === 'mdxJsxFlowElement' &&
                (child as MdxJsxElement).name === 'Visual',
            )
          : []
      node.attributes = (node.attributes ?? []).filter(
        candidate => !(candidate.type === 'mdxJsxAttribute' && candidate.name === attr),
      )
      node.attributes.push({ type: 'mdxJsxAttribute', name: attr, value: JSON.stringify(value) })
      node.children = []
      if (name === 'PlanWorkspace') {
        const model = planWorkspaceSchema.safeParse(value)
        if (!model.success) return
        // Real code nodes continue through the existing Expressive Code pipeline.
        for (const decision of model.data.decisions) {
          for (const code of decision.code) {
            for (const side of ['current', 'proposed', 'diff'] as const) {
              if (code[side] === undefined) continue
              node.children.push({
                type: 'mdxJsxFlowElement',
                name: 'div',
                attributes: [
                  {
                    type: 'mdxJsxAttribute',
                    name: 'data-workspace-code',
                    value: JSON.stringify([decision.id, code.id, side]),
                  },
                ],
                children: [
                  {
                    type: 'code',
                    lang: side === 'diff' ? 'diff' : (code.language ?? 'text'),
                    value: code[side],
                  },
                ],
              })
            }
          }
          for (const example of decision.examples) {
            const snippets = [
              ['code', example.language, example.code],
              ...(example.result
                ? [['result', example.result.language, example.result.value] as const]
                : []),
            ] as const
            for (const [part, language, value] of snippets) {
              node.children.push({
                type: 'mdxJsxFlowElement',
                name: 'div',
                attributes: [
                  {
                    type: 'mdxJsxAttribute',
                    name: 'data-workspace-code',
                    value: JSON.stringify([decision.id, 'example', example.id, part]),
                  },
                ],
                children: [{ type: 'code', lang: language, value }],
              })
            }
          }
        }
        // Visuals keep their MDX children, so nested components and fences compile as usual.
        for (const visual of visuals) {
          const decision = visual.attributes?.find(item => item.name === 'decision')?.value
          const id = visual.attributes?.find(item => item.name === 'id')?.value
          visual.attributes = [
            ...(visual.attributes ?? []),
            {
              type: 'mdxJsxAttribute',
              name: 'data-workspace-visual',
              value: JSON.stringify([decision, id]),
            },
          ]
          node.children.push(visual)
        }
      }
    })
  }
}
