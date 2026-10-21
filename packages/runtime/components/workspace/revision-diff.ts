import type { WorkspaceDecision, WorkspaceModel } from './model.js'
import { reviewLineDiff } from './review-state.js'

export type ChangeKind = 'added' | 'modified'

/** One displayed field that differs from the revision the reader opened before this one. */
export interface FieldChange {
  kind: ChangeKind
  previous?: string
  language?: string
}

/** Content that existed in the previous revision and no longer appears. */
export interface RemovedItem {
  key: string
  label: string
  previous: string
  language?: string
}

export interface RevisionChanges {
  /** Field and item changes keyed by `changeKey` paths. */
  fields: Map<string, FieldChange>
  /** Removed children per decision id; removed decisions use the empty id. */
  removed: Map<string, RemovedItem[]>
  /** Number of changed places per surviving or new decision. */
  counts: Map<string, number>
}

export function changeKey(...parts: string[]): string {
  return JSON.stringify(parts)
}

type Card = { id?: string; title: string; detail?: string }

function cardText(card: Card): string {
  return card.detail ? `${card.title}\n${card.detail}` : card.title
}

function ownershipText(row: WorkspaceDecision['ownership'][number]): string {
  const removed = row.removed.length ? `\nCan delete: ${row.removed.join(', ')}` : ''
  return `${row.area}: ${row.current} → ${row.proposed}${removed}`
}

/** Identity follows authored ids. */
function matchById<T>(items: T[], id: (item: T) => string) {
  return new Map(items.map(item => [id(item), item]))
}

/**
 * Cards pair by id. Cards without one pair with an identical card first, so reordering is not a
 * change, then with the next unpaired card, which reads as an edit.
 */
function pairCards(before: Card[], after: Card[]) {
  const unpaired = [...before.entries()]
  const take = (test: (card: Card) => boolean) => {
    const index = unpaired.findIndex(([, card]) => test(card))
    return index < 0 ? undefined : unpaired.splice(index, 1)[0]![1]
  }
  const exact = after.map(card =>
    card.id
      ? take(old => old.id === card.id)
      : take(old => !old.id && cardText(old) === cardText(card)),
  )
  const pairs = after.map((card, index) => ({
    card,
    id: card.id ?? String(index),
    old: exact[index] ?? (card.id ? undefined : take(old => !old.id)),
  }))
  return {
    pairs,
    removed: unpaired.map(([index, card]) => ({ card, id: card.id ?? `was-${index}` })),
  }
}

/** Compare two revisions of a workspace model field by field, using stable authored ids. */
export function diffRevisions(previous: WorkspaceModel, current: WorkspaceModel): RevisionChanges {
  const fields = new Map<string, FieldChange>()
  const removed = new Map<string, RemovedItem[]>()
  const counts = new Map<string, number>()
  let owner = ''
  const count = () => counts.set(owner, (counts.get(owner) ?? 0) + 1)
  const remove = (item: RemovedItem) => {
    removed.set(owner, [...(removed.get(owner) ?? []), item])
    count()
  }
  const added = (key: string) => {
    fields.set(key, { kind: 'added' })
    count()
  }
  const compare = (key: string, before?: string, after?: string, language?: string) => {
    if (!after || before === after) return
    fields.set(key, before ? { kind: 'modified', previous: before, language } : { kind: 'added' })
    count()
  }

  compare(changeKey('vision', 'problem'), previous.vision?.problem, current.vision?.problem)
  compare(changeKey('vision', 'outcome'), previous.vision?.outcome, current.vision?.outcome)

  const decisions = matchById(previous.decisions, decision => decision.id)
  for (const decision of current.decisions) {
    owner = decision.id
    counts.set(owner, 0)
    const before = decisions.get(decision.id)
    if (!before) {
      added(changeKey('decision', decision.id))
      continue
    }
    const key = (...parts: string[]) => changeKey('decision', decision.id, ...parts)
    compare(key('title'), before.title, decision.title)
    compare(key('goal'), before.goal ?? before.summary, decision.goal ?? decision.summary)

    const visuals = matchById(before.visuals, visual => visual.id)
    for (const visual of decision.visuals) {
      const old = visuals.get(visual.id)
      if (!old) added(key('visual', visual.id))
      else compare(key('visual', visual.id), old.source, visual.source, 'mdx')
      visuals.delete(visual.id)
    }
    for (const visual of visuals.values())
      remove({
        key: key('visual', visual.id),
        label: `Visual: ${visual.title}`,
        previous: visual.source,
      })

    const rows = matchById(before.ownership, row => row.id)
    for (const row of decision.ownership) {
      const old = rows.get(row.id)
      if (!old) added(key('ownership', row.id))
      else compare(key('ownership', row.id), ownershipText(old), ownershipText(row))
      rows.delete(row.id)
    }
    for (const row of rows.values())
      remove({
        key: key('ownership', row.id),
        label: `Ownership: ${row.area}`,
        previous: ownershipText(row),
      })

    for (const kind of ['benefits', 'costs'] as const) {
      const label = kind === 'benefits' ? 'Benefit' : 'Cost'
      const cardKey = (id: string) => key(kind === 'benefits' ? 'benefit' : 'cost', id)
      const { pairs, removed: gone } = pairCards(
        before.reasoning?.[kind] ?? [],
        decision.reasoning?.[kind] ?? [],
      )
      for (const { card, id, old } of pairs) {
        if (!old) added(cardKey(id))
        else compare(cardKey(id), cardText(old), cardText(card))
      }
      for (const { card, id } of gone)
        remove({ key: cardKey(id), label: `${label}: ${card.title}`, previous: cardText(card) })
    }

    const examples = matchById(before.examples, example => example.id)
    for (const example of decision.examples) {
      const old = examples.get(example.id)
      const exampleKey = (...parts: string[]) => key('example', example.id, ...parts)
      examples.delete(example.id)
      if (!old) {
        added(exampleKey())
        continue
      }
      compare(exampleKey('title'), old.title, example.title)
      compare(exampleKey('description'), old.description, example.description)
      compare(exampleKey('outcome'), old.outcome, example.outcome)
      compare(exampleKey('code'), old.code, example.code, example.language)
      compare(
        exampleKey('result'),
        old.result?.value,
        example.result?.value,
        example.result?.language,
      )
    }
    for (const example of examples.values())
      remove({
        key: key('example', example.id),
        label: `Example: ${example.title}`,
        previous: example.code,
        language: example.language,
      })

    const code = matchById(before.code, entry => entry.id)
    for (const entry of decision.code) {
      const old = code.get(entry.id)
      const codeKey = (...parts: string[]) => key('code', entry.id, ...parts)
      code.delete(entry.id)
      if (!old) {
        added(codeKey())
        continue
      }
      compare(codeKey('symbol'), `${old.file}: ${old.symbol}`, `${entry.file}: ${entry.symbol}`)
      compare(codeKey('summary'), old.summary, entry.summary)
      for (const part of ['current', 'proposed', 'diff'] as const)
        compare(codeKey(part), old[part], entry[part], part === 'diff' ? 'diff' : entry.language)
    }
    for (const entry of code.values())
      remove({
        key: key('code', entry.id),
        label: `${entry.file}: ${entry.symbol}`,
        previous: entry.proposed ?? entry.diff ?? entry.current ?? '',
        language: entry.language,
      })
  }
  owner = ''
  for (const decision of decisions.values())
    if (!current.decisions.some(item => item.id === decision.id))
      remove({
        key: changeKey('decision', decision.id),
        label: decision.title,
        previous: decision.goal ?? decision.title,
      })
  return { fields, removed, counts }
}

/** Whether anything under a key prefix changed, such as one code entry or one example. */
export function changedWithin(changes: RevisionChanges, ...parts: string[]): boolean {
  const prefix = changeKey(...parts).slice(0, -1)
  for (const key of changes.fields.keys())
    if (key === `${prefix}]` || key.startsWith(`${prefix},`)) return true
  return false
}

export interface LineHunk {
  kind: ChangeKind
  /** Current line indexes that belong to this hunk. */
  lines: number[]
  removed: string[]
  added: string[]
  /** A pure removal attaches to the line it precedes, or after the last line. */
  anchor: number
  after: boolean
}

/** Group a line diff into hunks the reader can hover: what replaced what. */
export function lineHunks(previous: string, current: string): LineHunk[] {
  const hunks: LineHunk[] = []
  let line = 0
  let open: LineHunk | undefined
  for (const op of reviewLineDiff(previous, current)) {
    if (op.kind === 'same') {
      open = undefined
      line++
      continue
    }
    if (!open) {
      open = { kind: 'added', lines: [], removed: [], added: [], anchor: line, after: false }
      hunks.push(open)
    }
    if (op.kind === 'removed') {
      open.removed.push(op.text)
      open.kind = 'modified'
    } else {
      open.lines.push(line)
      open.added.push(op.text)
      line++
    }
  }
  const total = current.split('\n').length
  for (const hunk of hunks) {
    hunk.after = !hunk.lines.length && hunk.anchor >= total
    hunk.anchor = Math.min(hunk.lines[0] ?? hunk.anchor, total - 1)
  }
  return hunks
}
