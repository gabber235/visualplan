import type { PlanWorkspaceModel } from '@visualplan/core'

export type WorkspaceModel = PlanWorkspaceModel
export type WorkspaceDecision = WorkspaceModel['decisions'][number]
export type WorkspaceVision = NonNullable<WorkspaceModel['vision']>

/**
 * The vision as authored. Scope defaults to empty, and leaving the empty default out keeps the
 * revision hash and comment fingerprints of plans written before scope existed.
 */
export function authoredVision(vision: WorkspaceVision) {
  const { scope, ...rest } = vision
  return { ...rest, ...(scope.length ? { scope } : {}) }
}

type ScopeItem = WorkspaceVision['scope'][number]

/** A scope item as the reader sees it, side included, so moving it reads as a change. */
export function scopeText(item: ScopeItem): string {
  return `${item.status === 'in' ? 'In scope' : 'Out of scope'}: ${item.text}`
}

/** The model as authored, for hashing. */
export function authoredModel(model: WorkspaceModel) {
  return model.vision ? { ...model, vision: authoredVision(model.vision) } : model
}

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
