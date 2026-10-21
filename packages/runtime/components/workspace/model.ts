import type { PlanWorkspaceModel } from '@visualplan/core'

export type WorkspaceModel = PlanWorkspaceModel
export type WorkspaceDecision = WorkspaceModel['decisions'][number]

/** Collapse only complete removals. Mixed edits must keep their proposed behavior visible. */
export function codeRemovalPart(
  code: WorkspaceDecision['code'][number],
): 'current' | 'diff' | undefined {
  if (code.role !== 'edit' || code.change !== 'delete' || code.proposed) return undefined
  if (!code.diff) return code.current ? 'current' : undefined
  const destinations = code.diff.split('\n').filter(line => line.startsWith('+++ '))
  if (
    destinations.length === 1 &&
    destinations[0]?.split('\t')[0] === '+++ /dev/null' &&
    !code.diff.split('\n').some(line => line.startsWith('+') && !line.startsWith('+++ '))
  )
    return 'diff'
  return undefined
}
