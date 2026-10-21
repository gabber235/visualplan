import { z } from 'zod'
import type { WorkspaceModel } from './model.js'
import { decisionReviewId, reviewItems, reviewRecordSchema } from './review-state.js'

/** Older comments carried a kind chosen in the composer; it is read and ignored. */
const legacyKind = z.enum(['question', 'change', 'issue', 'challenge']).optional()
const targetSchema = z.object({
  path: z.array(z.string()),
  labels: z.array(z.string()),
  excerpt: z.string(),
  quote: z.string().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  decisionId: z.string().optional(),
  revision: z.string().optional(),
  fingerprint: z.string().optional(),
  range: z
    .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
    .optional(),
  stale: z.boolean().optional(),
  unverified: z.boolean().optional(),
})
const commentSchema = z.object({
  id: z.string(),
  target: targetSchema,
  kind: legacyKind,
  body: z.string().min(1),
  /** Revision exported to the agent; a later revision answers and retires the comment. */
  sent: z.string().optional(),
})
export const feedbackSchema = z.object({
  version: z.literal(2),
  comments: z.array(commentSchema),
  reviews: z.record(z.string(), reviewRecordSchema),
  preferences: z.record(z.string(), z.string()),
  draft: z
    .object({
      target: targetSchema,
      kind: legacyKind,
      body: z.string(),
      editId: z.string().optional(),
    })
    .optional(),
})
const legacyFeedbackSchema = feedbackSchema.omit({ reviews: true }).extend({
  version: z.literal(1),
  statuses: z.record(z.string(), z.enum(['proposed', 'accepted', 'challenged'])),
})
export type FeedbackTarget = z.infer<typeof targetSchema>
export type FeedbackComment = z.infer<typeof commentSchema>
export type FeedbackState = z.infer<typeof feedbackSchema>

const MAX_EXCERPT_LENGTH = 800
const MAX_QUOTE_LENGTH = 400
const SURROUNDING_CONTEXT_LENGTH = 48

export function emptyFeedback(): FeedbackState {
  return { version: 2, comments: [], reviews: {}, preferences: {} }
}

/** Revision identifies the authored content captured by a feedback packet, not the storage slot. */
export function workspaceRevision(model: WorkspaceModel): string {
  return fingerprint(JSON.stringify(model))
}

export function fingerprint(content: string): string {
  let hash = 0xcbf29ce484222325n
  for (const char of content)
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 0x100000001b3n)
  return hash.toString(16).padStart(16, '0')
}

export function feedbackKey(pathname: string): string {
  return `vp-feedback:${pathname}`
}

export function legacyFeedbackKey(model: WorkspaceModel, pathname: string): string {
  return `vp-feedback:${pathname}:${workspaceRevision(model)}`
}

/** Only an exact legacy revision supplies enough evidence to preserve an old browser approval. */
export function migrateFeedback(value: unknown, model: WorkspaceModel): FeedbackState {
  const legacy = legacyFeedbackSchema.parse(value)
  const state = emptyFeedback()
  state.comments = legacy.comments.map(comment => ({
    ...comment,
    target: { ...comment.target, revision: comment.target.revision ?? workspaceRevision(model) },
  }))
  state.draft = legacy.draft
    ? {
        ...legacy.draft,
        target: {
          ...legacy.draft.target,
          revision: legacy.draft.target.revision ?? workspaceRevision(model),
        },
      }
    : undefined
  state.preferences = legacy.preferences
  const items = reviewItems(model)
  for (const [id, status] of Object.entries(legacy.statuses)) {
    const item = items.get(decisionReviewId(id))
    if (!item) continue
    state.reviews[item.id] = {
      status: status === 'accepted' ? 'accepted' : 'unreviewed',
      snapshot: item.snapshot,
      invalidated: false,
    }
  }
  return state
}

export function reviewAnchor(id: string, label: string) {
  return { 'data-review-id': id, 'data-review-label': label }
}

export function decisionTarget(model: WorkspaceModel, id: string): FeedbackTarget {
  const decision = model.decisions.find(item => item.id === id)!
  return {
    path: [`decision:${id}`],
    labels: [`${id}: ${decision.title}`],
    excerpt: decision.goal ?? decision.summary ?? decision.title,
    decisionId: id,
  }
}

function contentText(node: Node): string {
  const clone = node.cloneNode(true)
  if (clone instanceof Element || clone instanceof DocumentFragment) {
    for (const child of clone.querySelectorAll('style, script, [data-review-ui]')) child.remove()
    const lines = clone.querySelectorAll('.ec-line')
    for (const line of lines) line.append('\n')
    if (lines.length > 0) return (clone.textContent ?? '').replace(/\n$/, '')
  }
  return clone.textContent ?? ''
}

function compactText(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, maximum - 1)}…`
}

function textOffset(root: Node, container: Node, offset: number): number {
  let length = 0
  let found = false
  const visit = (node: Node) => {
    if (found || (node instanceof Element && node.matches('style, script, [data-review-ui]')))
      return
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) length += offset
      else
        for (const child of [...node.childNodes].slice(0, offset))
          length += contentTextWithTerminator(child).length
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) length += node.textContent?.length ?? 0
    else {
      for (const child of node.childNodes) visit(child)
      if (!found && node instanceof Element && node.matches('.ec-line')) length += 1
    }
  }
  visit(root)
  return length
}

function contentTextWithTerminator(node: Node): string {
  return contentText(node) + (node instanceof Element && node.matches('.ec-line') ? '\n' : '')
}

/** Snapshot both semantic ancestry and quoted context; never export unstable screen coordinates. */
export function captureTarget(element: Element, root: Element, selection?: Range): FeedbackTarget {
  const anchors: Element[] = []
  let current: Element | null = element.closest('[data-review-id]')
  while (current && root.contains(current)) {
    anchors.unshift(current)
    current = current.parentElement?.closest('[data-review-id]') ?? null
  }
  const leaf = anchors.at(-1) ?? root
  const path = anchors.map(item => item.getAttribute('data-review-id') ?? '')
  const content = ['current', 'proposed', 'diff', 'usage', 'result'].includes(path.at(-1) ?? '')
    ? (leaf.querySelector('pre code') ?? leaf)
    : leaf
  const target: FeedbackTarget = {
    path,
    labels: anchors.map(item => item.getAttribute('data-review-label') ?? ''),
    excerpt: compactText(contentText(content).trim(), MAX_EXCERPT_LENGTH),
    decisionId: path.find(item => item.startsWith('decision:'))?.slice(9),
  }
  if (selection && leaf.contains(selection.commonAncestorContainer)) {
    target.quote = compactText(contentText(selection.cloneContents()), MAX_QUOTE_LENGTH)
    const before = selection.cloneRange()
    before.selectNodeContents(content.contains(selection.commonAncestorContainer) ? content : leaf)
    before.setEnd(selection.startContainer, selection.startOffset)
    const after = selection.cloneRange()
    after.selectNodeContents(content.contains(selection.commonAncestorContainer) ? content : leaf)
    after.setStart(selection.endContainer, selection.endOffset)
    target.prefix = contentText(before.cloneContents()).slice(-SURROUNDING_CONTEXT_LENGTH)
    target.suffix = contentText(after.cloneContents()).slice(0, SURROUNDING_CONTEXT_LENGTH)
    if (content.contains(selection.commonAncestorContainer))
      target.range = {
        start: textOffset(content, selection.startContainer, selection.startOffset),
        end: textOffset(content, selection.endContainer, selection.endOffset),
      }
  }
  return target
}

export function exportFeedback(
  model: WorkspaceModel,
  state: FeedbackState,
  title: string,
  source?: string,
): string {
  const lines = [
    `# Plan feedback: ${title}`,
    ...(source ? [`Source: ${source}`] : []),
    `Revision: ${workspaceRevision(model)}`,
    '',
  ]
  if (!state.comments.length) lines.push('No comments recorded.')
  state.comments.forEach((comment, index) => {
    lines.push('', `${index + 1}. ${comment.target.path.join(' / ')}`)
    if ((comment.target.stale || comment.target.unverified) && comment.target.revision)
      lines.push(`Original revision: ${comment.target.revision}`)
    if (comment.target.quote) {
      lines.push(`Selected text: ${JSON.stringify(compactText(comment.target.quote, 160))}`)
    } else if (!source || !comment.target.fingerprint || comment.target.unverified) {
      lines.push(`Context: ${JSON.stringify(compactText(comment.target.excerpt, 160))}`)
    }
    lines.push('', comment.body)
  })
  return lines.join('\n')
}
