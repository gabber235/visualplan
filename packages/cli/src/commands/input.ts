import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type CheckIssue, checkSource } from '../build/check.js'
import { lintSource } from '../build/lint.js'
import { inlineSvgIncludes, svgBaseDir } from '../build/svg-include.js'
import {
  assemblePlanFolder,
  type LocatedIssue,
  type ModelOrigin,
  type Origin,
} from './plan-folder.js'

/** Resolve a plan-file argument to an absolute path, failing with a friendly message when it is
 * missing or not a regular file. Without this the reader throws a raw `ENOENT`/`EISDIR`, and the
 * default `render` command turns a mistyped subcommand into a confusing "no such file" error. */
export function resolvePlanFile(file: string): string {
  const absolute = resolve(file)
  if (!existsSync(absolute)) throw new Error(`File not found: ${file}`)
  if (!statSync(absolute).isFile()) throw new Error(`Not a file: ${file}`)
  return absolute
}

/** A plan's MDX source plus a label for diagnostics (the file path, or `<stdin>`). */
export interface PlanSource {
  source: string
  /** What `check` issues are prefixed with: the file path, or `<stdin>` for piped input. */
  label: string
  fromStdin: boolean
  /** For a plan folder: maps a line of the assembled source back to the file and line it came
   *  from, so diagnostics name `decisions/<id>.mdx:12`. */
  origin?: Origin
  /** For a plan folder: where a PlanWorkspace model path is authored, for workspace lint issues. */
  locateModel?: ModelOrigin
  /** For a plan folder: errors found while assembling it (YAML, order, schema), already located. */
  issues?: LocatedIssue[]
}

const STDIN_LABEL = '<stdin>'

/** Drain `process.stdin` to a UTF-8 string. Used when the plan is piped in rather than a file. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Whether a plan argument names a plan folder rather than an MDX file. */
export function isPlanFolder(file: string | undefined): file is string {
  if (file === undefined || file === '-') return false
  const absolute = resolve(file)
  return existsSync(absolute) && statSync(absolute).isDirectory()
}

/**
 * Resolve a plan's MDX source from a plan folder, a file argument, or stdin, BOM-stripped. A folder
 * is assembled into one MDX source (see `assemblePlanFolder`). The `file` arg is read as a path
 * unless it is `-` (the explicit stdin sentinel). When no `file` is given, stdin is used if it is
 * piped; a bare invocation on an interactive terminal throws rather than hang waiting for input
 * that will never come.
 */
export async function readPlanSource(file?: string): Promise<PlanSource> {
  const useStdin = file === '-' || (file === undefined && !process.stdin.isTTY)
  // <Svg src> files are inlined here, at the input boundary, so every consumer downstream —
  // check, render, share, export, the review daemon (handed source, not a path) — sees one
  // already-self-contained plan. Failures are not thrown: the tag is rewritten to carry error="…"
  // and checkSource (which every command runs next) reports it as file:line:col.
  if (useStdin) {
    const raw = (await readStdin()).replace(/^\ufeff/, '')
    const { source } = await inlineSvgIncludes(raw, svgBaseDir(undefined, true))
    return { source, label: STDIN_LABEL, fromStdin: true }
  }
  if (file === undefined) {
    throw new Error('No input: pass a plan folder, a plan file, or pipe MDX to stdin.')
  }
  if (isPlanFolder(file)) {
    const { source, origin, locateModel, issues } = await assemblePlanFolder(resolve(file), file)
    return { source, label: file, fromStdin: false, origin, locateModel, issues }
  }
  const raw = (await readFile(resolvePlanFile(file), 'utf8')).replace(/^\ufeff/, '')
  const { source } = await inlineSvgIncludes(raw, svgBaseDir(file, false))
  return { source, label: file, fromStdin: false }
}

/** Locate source issues in the file they came from: the origin's file for a folder, else the label. */
function locate(plan: PlanSource, issues: CheckIssue[]): LocatedIssue[] {
  return issues.map(({ target, ...issue }) => {
    if (target && plan.locateModel) return { ...issue, ...plan.locateModel(target) }
    if (!plan.origin) return { file: plan.label, ...issue }
    const { file, line } = plan.origin(issue.line)
    return { ...issue, file, line }
  })
}

/** Syntax check a plan source: folder assembly errors first, else the MDX checks. */
export async function checkPlanSource(plan: PlanSource): Promise<LocatedIssue[]> {
  if (plan.issues?.length) return plan.issues
  return locate(plan, await checkSource(plan.source))
}

/** The quality lint for a plan source that already passes `checkPlanSource`. */
export function lintPlanSource(plan: PlanSource): LocatedIssue[] {
  return locate(plan, lintSource(plan.source))
}
