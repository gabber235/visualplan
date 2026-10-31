// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkPlanSource, lintPlanSource, readPlanSource } from '../src/commands/input.js'

const PLAN = `title: Lock holders
vision:
  problem: Builds cannot say who holds the lock.
  outcome: Every lock names its holder.
order: [heavy-lock]
`

const DECISION = `title: Name the heavy lock's holder
code:
  - id: lock-model
    symbol: HeavyLock
    role: model
    language: rust
    file: xtask/src/lock.rs
    current: |
      pub struct HeavyLock;
    proposed: |
      pub struct HeavyLock { holder: Holder }
`

const VISUAL = `<Visual id="flow" title="Who waits">

\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

</Visual>
`

let root: string
let dir: string

async function write(path: string, content: string): Promise<void> {
  await writeFile(join(dir, path), content)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'visualplan-folder-test-'))
  dir = join(root, 'lock-holders')
  await mkdir(join(dir, 'decisions'), { recursive: true })
  await write('plan.yaml', PLAN)
  await write('decisions/heavy-lock.yaml', DECISION)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('plan folders', () => {
  it('assembles plan.yaml, decisions and visuals into one valid workspace (golden)', async () => {
    await write('decisions/heavy-lock.mdx', VISUAL)
    const plan = await readPlanSource(dir)
    expect(plan.source.startsWith('# Lock holders\n\n<PlanWorkspace>\n```json\n')).toBe(true)
    expect(plan.source).toContain('<Visual decision="heavy-lock" id="flow" title="Who waits">')
    expect(plan.source.trimEnd().endsWith('</PlanWorkspace>')).toBe(true)
    expect(await checkPlanSource(plan)).toEqual([])
    expect(lintPlanSource(plan)).toEqual([])
    const json = JSON.parse(plan.source.split('```json\n')[1]?.split('\n```')[0] ?? '')
    expect(json.decisions[0].id).toBe('heavy-lock')
    expect(json.decisions[0].code[0].proposed).toBe('pub struct HeavyLock { holder: Holder }\n')
  })

  it('reports an unknown key at its line in the decision file (error)', async () => {
    await write(
      'decisions/heavy-lock.yaml',
      DECISION.replace('    language: rust', '    symbols: x'),
    )
    const issues = await checkPlanSource(await readPlanSource(dir))
    expect(issues).toEqual([
      expect.objectContaining({
        file: join(dir, 'decisions/heavy-lock.yaml'),
        line: 6,
        column: 5,
        message: expect.stringMatching(/^code\.lock-model: unknown key "symbols"/),
      }),
    ])
  })

  it('maps MDX issues in a visuals file back to that file and line (error)', async () => {
    await write('decisions/heavy-lock.mdx', '<Visual id="v" title="V">\n\n<Bogus />\n\n</Visual>\n')
    const issues = await checkPlanSource(await readPlanSource(dir))
    expect(issues).toEqual([
      expect.objectContaining({ file: join(dir, 'decisions/heavy-lock.mdx'), line: 3 }),
    ])
  })

  it('fails when order and decision files disagree (error)', async () => {
    await write('plan.yaml', PLAN.replace('[heavy-lock]', '[heavy-lock, missing]'))
    await write('decisions/extra.yaml', DECISION)
    const messages = (await checkPlanSource(await readPlanSource(dir))).map(i => i.message)
    expect(messages).toEqual([
      'order lists "missing" but decisions/missing.yaml does not exist',
      'decision "extra" is not listed in plan.yaml order',
    ])
  })

  it('rejects an id key, since the file name is the id (error)', async () => {
    await write('decisions/heavy-lock.yaml', `id: heavy-lock\n${DECISION}`)
    const issues = await checkPlanSource(await readPlanSource(dir))
    expect(issues.map(i => [i.line, i.message])).toEqual([
      [1, 'remove "id": a decision\'s id is its file name'],
    ])
  })

  it('rejects vision facts, naming the key (error)', async () => {
    await write('plan.yaml', `${PLAN}`.replace('order:', '  facts: []\norder:'))
    const issues = await checkPlanSource(await readPlanSource(dir))
    expect(issues).toEqual([
      expect.objectContaining({
        file: join(dir, 'plan.yaml'),
        message: expect.stringMatching(/facts/),
      }),
    ])
  })

  it('reports a YAML syntax error at its position (error)', async () => {
    await write('decisions/heavy-lock.yaml', 'title: [unclosed\n')
    const issues = await checkPlanSource(await readPlanSource(dir))
    expect(issues[0]).toEqual(
      expect.objectContaining({
        file: join(dir, 'decisions/heavy-lock.yaml'),
        message: expect.stringMatching(/Flow sequence/),
      }),
    )
  })

  it('locates a workspace lint warning at the decision file that causes it (error)', async () => {
    await write('decisions/heavy-lock.yaml', DECISION.replace('    role: model\n', ''))
    const plan = await readPlanSource(dir)
    expect(await checkPlanSource(plan)).toEqual([])
    expect(lintPlanSource(plan)).toEqual([
      expect.objectContaining({
        file: join(dir, 'decisions/heavy-lock.yaml'),
        line: 3,
        severity: 'warn',
        message: expect.stringMatching(/^Decision heavy-lock needs/),
      }),
    ])
  })

  it('rejects a visual that names another decision, and visuals without a decision (error)', async () => {
    await write('decisions/heavy-lock.mdx', VISUAL.replace('<Visual ', '<Visual decision="other" '))
    await write('decisions/orphan.mdx', VISUAL)
    const messages = (await checkPlanSource(await readPlanSource(dir))).map(i => i.message)
    expect(messages).toEqual([
      'visuals file has no decisions/orphan.yaml',
      expect.stringMatching(/^<Visual> names decision "other"/),
    ])
  })

  it('reports a decision file that is not a map (error)', async () => {
    await write('decisions/heavy-lock.yaml', 'just a string\n')
    const issues = await checkPlanSource(await readPlanSource(dir))
    expect(issues.map(i => i.message)).toEqual(['a decision file must be a map'])
  })

  it('throws for a folder without plan.yaml (error)', async () => {
    await expect(readPlanSource(join(dir, 'decisions'))).rejects.toThrow(/no plan\.yaml/)
  })
})
