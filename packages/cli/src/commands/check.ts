import { checkPlanSource, lintPlanSource, readPlanSource } from './input.js'
import type { LocatedIssue } from './plan-folder.js'

/** Print check issues in an editor-clickable `file:line:column  severity: message` format. */
export function printIssues(issues: LocatedIssue[]): void {
  for (const issue of issues) {
    const label = (issue.severity ?? 'error') === 'warn' ? 'warning' : 'error'
    process.stderr.write(
      `${issue.file}:${issue.line}:${issue.column}  ${label}: ${issue.message}\n`,
    )
  }
}

/** `count noun(s)`, pluralizing the noun. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * `vplan check <plan>`: validate a plan folder or MDX file without rendering it. Runs the syntax check first;
 * only if the plan parses cleanly does it run the quality lint, so lint warnings never bury a real
 * syntax error and the lint parse never sees malformed MDX. A lint warning fails the check too, so
 * a weak plan blocks until fixed.
 */
export async function runCheck(file: string): Promise<void> {
  const plan = await readPlanSource(file)
  const errors = await checkPlanSource(plan)
  const issues = errors.length === 0 ? lintPlanSource(plan) : errors
  if (issues.length === 0) {
    process.stdout.write(`${file} is valid\n`)
    return
  }
  printIssues(issues)
  const warnings = issues.filter(issue => issue.severity === 'warn').length
  const summary = errors.length > 0 ? count(issues.length, 'error') : count(warnings, 'warning')
  process.stdout.write(`\n${summary} found\n`)
  process.exitCode = 1
}
