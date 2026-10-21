import type { WorkspaceModel } from './model.js'
import {
  fingerprint,
  workspaceRevision,
  type FeedbackState,
  type FeedbackTarget,
} from './feedback.js'

type Content = { snapshot: string; text?: string }

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (Array.isArray(item))
      return [...item].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .filter(([key]) => key !== 'status' && key !== 'role')
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    return item
  })
}

function content(value: unknown): Content | undefined {
  if (value === undefined) return undefined
  return { snapshot: stable(value), ...(typeof value === 'string' ? { text: value } : {}) }
}

function relocate(model: WorkspaceModel, target: FeedbackTarget): FeedbackTarget {
  if (!target.fingerprint) return target
  const decision = model.decisions.find(
    item => item.id === target.decisionId || target.path.includes(`decision:${item.id}`),
  )
  const codeId = target.path.find(item => item.startsWith('code:'))?.slice(5)
  const code = decision?.code.find(item => item.id === codeId)
  const path = target.path.map(part => {
    if (code && (part === 'changes' || part === 'model'))
      return code.role === 'model' ? 'model' : 'changes'
    const kind = part.startsWith('vision:principle:') ? 'vision:principle' : part.split(':')[0]
    const entries =
      kind === 'vision:principle'
        ? model.vision?.principles
        : kind === 'invariant'
          ? code?.invariants
          : kind === 'benefit'
            ? decision?.reasoning?.benefits
            : kind === 'cost'
              ? decision?.reasoning?.costs
              : undefined
    if (!entries) return part
    const matches = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => fingerprint(stable(entry)) === target.fingerprint)
    if (matches.length !== 1) return part
    const match = matches[0]!
    const id = typeof match.entry === 'object' && 'id' in match.entry ? match.entry.id : undefined
    return `${kind}:${id ?? match.index}`
  })
  return { ...target, path }
}

/** Undefined proves removal. Null means an older or unknown anchor needs conservative handling. */
function resolve(model: WorkspaceModel, target: FeedbackTarget): Content | null | undefined {
  const leaf = target.path.at(-1)
  if (target.path[0] === 'vision') {
    if (leaf === 'vision') return content(model.vision ?? model.thesis)
    if (leaf === 'vision:problem') return content(model.vision?.problem ?? model.thesis)
    if (leaf === 'vision:outcome') return content(model.vision?.outcome ?? model.thesis)
    if (leaf?.startsWith('vision:principle:'))
      return content(model.vision?.principles[Number(leaf.split(':')[2])])
    return null
  }
  const id = target.decisionId ?? target.path.find(item => item.startsWith('decision:'))?.slice(9)
  if (!id) return null
  const decision = model.decisions.find(item => item.id === id)
  if (!decision) return undefined
  if (leaf === `decision:${id}`)
    return content({
      title: decision.title,
      goal: decision.goal ?? decision.summary,
      reasoning: decision.reasoning ?? decision.rationale,
      ...(decision.ownership.length ? { ownership: decision.ownership } : {}),
      examples: decision.examples,
      code: decision.code,
      ...(decision.visuals.length ? { visuals: decision.visuals } : {}),
    })
  if (leaf === 'goal') return content(decision.goal ?? decision.summary ?? '')
  if (leaf === 'ownership') return content(decision.ownership)
  const ownershipId = target.path.find(item => item.startsWith('ownership:'))?.slice(10)
  if (ownershipId) {
    const row = decision.ownership.find(item => item.id === ownershipId)
    if (!row) return undefined
    if (leaf === 'current-owner') return content(row.current)
    if (leaf === 'proposed-owner') return content(row.proposed)
    if (leaf === 'removed') return content(row.removed)
    return content(row)
  }
  if (leaf?.startsWith('benefit:') || leaf?.startsWith('cost:')) {
    const kind = leaf.slice(0, leaf.indexOf(':'))
    const index = leaf.slice(leaf.indexOf(':') + 1)
    const cards = kind === 'benefit' ? decision.reasoning?.benefits : decision.reasoning?.costs
    const title = target.labels.at(-1)?.replace(/^(Benefit|Cost): /, '')
    const card =
      cards?.find(item => item.id === index) ??
      cards?.find(item => item.title === title) ??
      cards?.[Number(index)]
    return content(card)
  }
  if (leaf?.startsWith('route:')) return undefined
  if (leaf?.startsWith('visual:'))
    return content(decision.visuals.find(item => item.id === leaf.slice(7))?.source)
  const exampleId = target.path.find(item => item.startsWith('example:'))?.slice(8)
  if (exampleId) {
    const example = decision.examples.find(item => item.id === exampleId)
    if (!example) return undefined
    if (leaf === 'usage') return content(example.code)
    if (leaf === 'result') return content(example.result?.value)
    if (leaf === 'outcome')
      return example.result
        ? content({ outcome: example.outcome, result: example.result })
        : content(example.outcome)
    return content(example)
  }
  const codeId = target.path.find(item => item.startsWith('code:'))?.slice(5)
  if (codeId) {
    const code = decision.code.find(item => item.id === codeId)
    if (!code) return undefined
    if (leaf === 'current' || leaf === 'proposed' || leaf === 'diff') return content(code[leaf])
    if (leaf?.startsWith('invariant:')) return content(code.invariants[Number(leaf.slice(10))])
    return content(code)
  }
  if (leaf === 'changes') return content(decision.code.filter(item => item.role !== 'model'))
  if (leaf === 'model') return content(decision.code.filter(item => item.role === 'model'))
  if (leaf === 'developer-experience') return content(decision.examples)
  return null
}

export function snapshotTarget(model: WorkspaceModel, target: FeedbackTarget): FeedbackTarget {
  target = relocate(model, target)
  const current = resolve(model, target)
  return {
    ...target,
    ...(current
      ? {
          fingerprint: fingerprint(current.snapshot),
          ...(current.text === undefined ? { range: undefined } : {}),
        }
      : {}),
  }
}

export function targetChanged(model: WorkspaceModel, target: FeedbackTarget): boolean {
  target = relocate(model, target)
  const current = resolve(model, target)
  if (current === null) return false
  if (current === undefined) return true
  if (target.fingerprint) return fingerprint(current.snapshot) !== target.fingerprint
  // Older targets contain only an excerpt. Retire only when an exact source quote establishes loss.
  if (target.revision === workspaceRevision(model)) return false
  const quote = target.quote ?? target.excerpt
  return (
    current.text !== undefined &&
    quote.length > 0 &&
    !quote.endsWith('…') &&
    !current.text.includes(quote)
  )
}

export function reconcileFeedback(model: WorkspaceModel, state: FeedbackState): FeedbackState {
  const comments = state.comments
    .filter(comment => !targetChanged(model, comment.target))
    .map(comment => ({
      ...comment,
      target: {
        ...snapshotTarget(model, comment.target),
        unverified:
          comment.target.unverified ||
          (!comment.target.fingerprint &&
            comment.target.revision !== workspaceRevision(model) &&
            (resolve(model, comment.target)?.text === undefined ||
              (comment.target.quote ?? comment.target.excerpt).endsWith('…'))),
      },
    }))
  const draft = state.draft
    ? {
        ...state.draft,
        target: {
          ...(state.draft.target.stale || targetChanged(model, state.draft.target)
            ? state.draft.target
            : snapshotTarget(model, state.draft.target)),
          stale: state.draft.target.stale || targetChanged(model, state.draft.target),
        },
      }
    : undefined
  return { ...state, comments, draft }
}
