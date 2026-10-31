import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { planWorkspaceSchema } from '@visualplan/core'
import { type Document, isMap, isPair, isScalar, LineCounter, parseDocument } from 'yaml'
import { inlineSvgIncludes } from '../build/svg-include.js'

/** A check issue located in one file of a plan folder (or the plan file itself). */
export interface LocatedIssue {
  file: string
  line: number
  column: number
  message: string
  severity?: 'error' | 'warn'
}

/** Where a line of the assembled MDX came from. */
export type Origin = (line: number) => { file: string; line: number }

/** Where a path in the assembled PlanWorkspace model is authored. */
export type ModelOrigin = (
  path: (string | number)[],
  key?: string,
) => { file: string; line: number; column: number }

export interface AssembledFolder {
  source: string
  origin: Origin
  locateModel: ModelOrigin
  /** Folder level errors (YAML syntax, order, schema). When present, `source` is not checkable. */
  issues: LocatedIssue[]
}

interface YamlFile {
  /** Label printed in diagnostics, relative to the folder's parent: `<slug>/decisions/x.yaml`. */
  file: string
  doc: Document
  lines: LineCounter
}

const PLAN_KEYS = new Set(['title', 'vision', 'order'])

/** Read a YAML file, reporting syntax errors at their line and column. */
async function readYaml(path: string, file: string, issues: LocatedIssue[]): Promise<YamlFile> {
  const lines = new LineCounter()
  const text = (await readFile(path, 'utf8')).replace(/^\ufeff/, '')
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false })
  for (const error of doc.errors) {
    const at = lines.linePos(error.pos[0])
    issues.push({
      file,
      line: at.line,
      column: at.col,
      message: error.message.split('\n')[0] ?? error.message,
    })
  }
  return { file, doc, lines }
}

/** Position of the node at `path`, or of the deepest existing ancestor. For a missing or unknown
 *  `key`, the position of that key in its map, so `code.x: unknown key "y"` points at `y`. */
function positionOf(yaml: YamlFile, path: (string | number)[], key?: string) {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = (depth === 0 ? yaml.doc.contents : yaml.doc.getIn(path.slice(0, depth), true)) as
      | { range?: [number, number, number] | null }
      | null
      | undefined
    if (!node?.range) continue
    let offset = node.range[0]
    if (key !== undefined && depth === path.length && isMap(node)) {
      const pair = node.items.find(
        item => isPair(item) && isScalar(item.key) && item.key.value === key,
      )
      if (pair && isScalar(pair.key) && pair.key.range) offset = pair.key.range[0]
    }
    const at = yaml.lines.linePos(offset)
    return { line: at.line, column: at.col }
  }
  return { line: 1, column: 1 }
}

/** A schema path inside one file, with array indexes of id'd items shown as their id. */
function readablePath(value: unknown, path: (string | number)[]): string {
  const parts: string[] = []
  let current = value as Record<string | number, unknown> | undefined
  for (const segment of path) {
    const next = current?.[segment] as Record<string, unknown> | undefined
    const id = typeof segment === 'number' && typeof next?.id === 'string' ? next.id : undefined
    parts.push(id ?? String(segment))
    current = next
  }
  return parts.join('.')
}

/** Add `decision="<id>"` to every `<Visual` opening tag that does not name a decision. */
function claimVisuals(source: string, id: string): string {
  return source.replace(/<Visual(?=[\s>])(?![^>]*\sdecision=)/g, `<Visual decision="${id}"`)
}

/**
 * Assemble a plan folder into the single MDX source every command already consumes:
 * `plan.yaml` (title, vision, order) becomes the heading and the PlanWorkspace json, each
 * `decisions/<id>.yaml` one decision in that order, and each `decisions/<id>.mdx` its Visual
 * elements with `decision="<id>"` added. Schema errors are reported against the YAML file and
 * line that cause them; `origin` maps assembled lines back for later MDX diagnostics.
 */
export async function assemblePlanFolder(dir: string, label: string): Promise<AssembledFolder> {
  const issues: LocatedIssue[] = []
  const planFile = join(label, 'plan.yaml')
  const decisionsDir = join(dir, 'decisions')
  if (!existsSync(join(dir, 'plan.yaml'))) {
    throw new Error(`Not a plan folder: ${label} has no plan.yaml`)
  }
  const plan = await readYaml(join(dir, 'plan.yaml'), planFile, issues)
  const planValue = (plan.doc.toJS() ?? {}) as Record<string, unknown>
  for (const key of Object.keys(planValue)) {
    if (!PLAN_KEYS.has(key))
      issues.push({ file: planFile, ...positionOf(plan, [], key), message: `unknown key "${key}"` })
  }
  const title = planValue.title
  if (typeof title !== 'string' || !title.trim())
    issues.push({ file: planFile, ...positionOf(plan, []), message: 'title: required string' })
  const order = planValue.order
  const ids = Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : []
  if (!Array.isArray(order) || ids.length !== order.length || ids.length === 0)
    issues.push({
      file: planFile,
      ...positionOf(plan, ['order']),
      message: 'order: a non-empty list of decision ids',
    })

  const names = existsSync(decisionsDir) ? await readdir(decisionsDir) : []
  const files = new Set(names.filter(name => name.endsWith('.yaml')).map(n => n.slice(0, -5)))
  for (const [index, id] of ids.entries()) {
    if (!files.has(id))
      issues.push({
        file: planFile,
        ...positionOf(plan, ['order', index]),
        message: `order lists "${id}" but decisions/${id}.yaml does not exist`,
      })
  }
  for (const id of files) {
    if (!ids.includes(id))
      issues.push({
        file: join(label, 'decisions', `${id}.yaml`),
        line: 1,
        column: 1,
        message: `decision "${id}" is not listed in plan.yaml order`,
      })
  }
  for (const name of names.filter(name => name.endsWith('.mdx'))) {
    if (!files.has(name.slice(0, -4)))
      issues.push({
        file: join(label, 'decisions', name),
        line: 1,
        column: 1,
        message: `visuals file has no decisions/${name.slice(0, -4)}.yaml`,
      })
  }

  const decisions: YamlFile[] = []
  const values: Record<string, unknown>[] = []
  for (const id of ids.filter(id => files.has(id))) {
    const yaml = await readYaml(
      join(decisionsDir, `${id}.yaml`),
      join(label, 'decisions', `${id}.yaml`),
      issues,
    )
    const parsed: unknown = yaml.doc.toJS() ?? {}
    const value = (isMap(yaml.doc.contents) || yaml.doc.contents === null ? parsed : {}) as Record<
      string,
      unknown
    >
    if (yaml.doc.errors.length === 0 && yaml.doc.contents !== null && !isMap(yaml.doc.contents))
      issues.push({ file: yaml.file, line: 1, column: 1, message: 'a decision file must be a map' })
    if ('id' in value)
      issues.push({
        file: yaml.file,
        ...positionOf(yaml, [], 'id'),
        message: 'remove "id": a decision\'s id is its file name',
      })
    decisions.push(yaml)
    values.push({ id, ...value })
  }

  const model = { vision: planValue.vision, decisions: values }
  const locateModel: ModelOrigin = (path, unknown) => {
    const yaml =
      path[0] === 'decisions' && typeof path[1] === 'number' ? decisions[path[1]] : undefined
    return yaml
      ? { file: yaml.file, ...positionOf(yaml, path.slice(2), unknown) }
      : { file: planFile, ...positionOf(plan, path, unknown) }
  }
  if (issues.length === 0) {
    const result = planWorkspaceSchema.safeParse(model)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path as (string | number)[]
        const unknown = issue.code === 'unrecognized_keys' ? issue.keys[0] : undefined
        const inDecision = path[0] === 'decisions' && typeof path[1] === 'number'
        const where = inDecision
          ? readablePath(values[path[1] as number], path.slice(2)) || 'decision'
          : readablePath(model, path) || 'plan'
        issues.push({ ...locateModel(path, unknown), message: `${where}: ${issue.message}` })
      }
    }
  }

  // Assemble: heading, workspace json, then each decision's visuals. Track which file each line of
  // the visuals came from; every other line maps to plan.yaml.
  const head = `# ${String(title ?? '')}\n\n<PlanWorkspace>\n\`\`\`json\n${JSON.stringify(model, null, 2)}\n\`\`\`\n`
  const segments: { start: number; file: string; text: string }[] = []
  let line = head.split('\n').length + 1
  let body = ''
  for (const id of ids.filter(id => files.has(id))) {
    const path = join(decisionsDir, `${id}.mdx`)
    if (!existsSync(path)) continue
    const raw = (await readFile(path, 'utf8')).replace(/^\ufeff/, '')
    for (const match of raw.matchAll(/<Visual\s[^>]*\bdecision="([^"]*)"/g)) {
      if (match[1] === id) continue
      const before = raw.slice(0, match.index)
      issues.push({
        file: join(label, 'decisions', `${id}.mdx`),
        line: before.split('\n').length,
        column: before.length - before.lastIndexOf('\n'),
        message: `<Visual> names decision "${match[1]}"; visuals in ${id}.mdx belong to "${id}", so drop the attribute`,
      })
    }
    const inlined = (await inlineSvgIncludes(claimVisuals(raw, id), decisionsDir)).source
    // Inlined markup keeps its newlines; encode them so each assembled line still maps to the
    // authored line it came from (MDX decodes the entity back).
    const source = inlined.replace(/ (svg|error)="[^"]*"/g, attr => attr.replace(/\n/g, '&#10;'))
    const text = `${source.replace(/\n*$/, '')}\n\n`
    segments.push({ start: line, file: join(label, 'decisions', `${id}.mdx`), text })
    body += text
    line += text.split('\n').length - 1
  }
  const origin: Origin = assembledLine => {
    const segment = segments.filter(item => item.start <= assembledLine).at(-1)
    if (segment && assembledLine < segment.start + segment.text.split('\n').length - 1)
      return { file: segment.file, line: assembledLine - segment.start + 1 }
    return { file: planFile, line: 1 }
  }
  return { source: `${head}\n${body}</PlanWorkspace>\n`, origin, locateModel, issues }
}
