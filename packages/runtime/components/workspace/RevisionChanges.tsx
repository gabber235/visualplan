import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import { planWorkspaceSchema } from '@visualplan/core'
import { wordDiffOps } from '../review/diff.js'
import { feedbackKey, legacyFeedbackKey, workspaceRevision } from './feedback.js'
import type { WorkspaceModel } from './model.js'
import { reviewedRevision } from './review-baseline.js'
import { reviewRecordSchema } from './review-state.js'
import { readSavedFeedback, writeSavedFeedback } from './review-storage.js'
import {
  changedWithin,
  diffRevisions,
  lineHunks,
  type FieldChange,
  type LineHunk,
  type RemovedItem,
  type RevisionChanges,
} from './revision-diff.js'
import './revision-changes.css'

const snapshotSchema = z.object({ revision: z.string(), model: z.unknown() })
const baselineSchema = z.object({ current: snapshotSchema, previous: snapshotSchema.optional() })
const savedReviewsSchema = z.object({ reviews: z.record(z.string(), reviewRecordSchema) })
const highlightPreference = 'vp-revision-highlights'

/**
 * The baseline is the revision this browser opened before the current one, so agent renders the
 * reader never saw cannot hide changes, and reloading the current revision keeps its highlights.
 */
export async function loadPreviousRevision(
  key: string,
  model: WorkspaceModel,
): Promise<WorkspaceModel | undefined> {
  const revision = workspaceRevision(model)
  const parsed = baselineSchema.safeParse(JSON.parse((await readSavedFeedback(key, key)) ?? 'null'))
  const stored = parsed.success ? parsed.data : undefined
  const previous = stored?.current.revision === revision ? stored.previous : stored?.current
  if (stored?.current.revision !== revision)
    await writeSavedFeedback(key, JSON.stringify({ current: { revision, model }, previous }))
  if (!previous) return undefined
  const result = planWorkspaceSchema.safeParse(previous.model)
  return result.success ? result.data : undefined
}

/** Without an earlier opened revision, the saved review marks show what the reader last reviewed. */
export async function loadReviewedRevision(
  pathname: string,
  model: WorkspaceModel,
): Promise<WorkspaceModel | undefined> {
  const saved = await readSavedFeedback(feedbackKey(pathname), legacyFeedbackKey(model, pathname))
  const parsed = savedReviewsSchema.safeParse(JSON.parse(saved ?? 'null'))
  return parsed.success ? reviewedRevision(model, parsed.data.reviews) : undefined
}

type Baseline = { model: WorkspaceModel; since: string }

async function loadBaseline(
  pathname: string,
  model: WorkspaceModel,
): Promise<Baseline | undefined> {
  const opened = await loadPreviousRevision(`vp-revision:${pathname}`, model)
  if (opened) return { model: opened, since: 'the revision you last opened' }
  const reviewed = await loadReviewedRevision(pathname, model)
  return reviewed && { model: reviewed, since: 'your last review' }
}

type Hover = { anchor: DOMRect; content: ReactNode }

interface RevisionActions {
  changes?: RevisionChanges
  /** What the highlights compare against, as it reads after "since". */
  since: string
  visible: boolean
  setVisible: (visible: boolean) => void
  field: (key: string) => FieldChange | undefined
  within: (...parts: string[]) => boolean
  show: (anchor: Element, content: ReactNode) => void
  hide: () => void
}

const RevisionContext = createContext<RevisionActions>({
  since: '',
  visible: false,
  setVisible: () => undefined,
  field: () => undefined,
  within: () => false,
  show: () => undefined,
  hide: () => undefined,
})

export function useRevisionChanges(): RevisionActions {
  return useContext(RevisionContext)
}

export function RevisionChangesProvider({
  model,
  children,
}: {
  model: WorkspaceModel
  children: ReactNode
}) {
  const pathname = typeof location === 'undefined' ? '' : location.pathname
  const [baseline, setBaseline] = useState<Baseline>()
  const [hover, setHover] = useState<Hover>()
  const [visible, setVisibleState] = useState(
    () =>
      typeof localStorage === 'undefined' || localStorage.getItem(highlightPreference) !== 'off',
  )

  useEffect(() => {
    let current = true
    loadBaseline(pathname, model).then(
      result => current && setBaseline(result),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [model, pathname])

  useEffect(() => {
    if (!hover) return
    const close = () => setHover(undefined)
    window.addEventListener('scroll', close, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [hover])

  const changes = useMemo(
    () => (baseline ? diffRevisions(baseline.model, model) : undefined),
    [baseline, model],
  )
  const active = visible && changes ? changes : undefined
  const actions: RevisionActions = {
    changes,
    since: baseline?.since ?? '',
    visible,
    setVisible: next => {
      setVisibleState(next)
      setHover(undefined)
      localStorage.setItem(highlightPreference, next ? 'on' : 'off')
    },
    field: key => active?.fields.get(key),
    within: (...parts) => (active ? changedWithin(active, ...parts) : false),
    show: (anchor, content) => setHover({ anchor: anchor.getBoundingClientRect(), content }),
    hide: () => setHover(undefined),
  }

  return (
    <RevisionContext.Provider value={actions}>
      {children}
      {hover ? <ChangeTooltip hover={hover} /> : null}
    </RevisionContext.Provider>
  )
}

function ChangeTooltip({ hover }: { hover: Hover }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({
    top: hover.anchor.bottom + 6,
    left: hover.anchor.left,
  })
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    const width = ref.current?.offsetWidth ?? 0
    const below = hover.anchor.bottom + 6
    setPosition({
      top:
        below + height > window.innerHeight - 8
          ? Math.max(8, hover.anchor.top - height - 6)
          : below,
      left: Math.max(8, Math.min(hover.anchor.left, window.innerWidth - width - 8)),
    })
  }, [hover])
  return (
    <div
      ref={ref}
      className='vp-change-tooltip'
      role='tooltip'
      data-review-ui='true'
      style={{ top: position.top, left: position.left }}
    >
      {hover.content}
    </div>
  )
}

function WordDiff({ previous, current }: { previous: string; current: string }) {
  const ops = wordDiffOps(previous.match(/\S+/g) ?? [], current.match(/\S+/g) ?? [])
  return (
    <p className='vp-change-tooltip__words'>
      {ops.map((op, index) =>
        op.type === 'del' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: Diff ops have no identity beyond order.
          <del key={index}>{op.text} </del>
        ) : op.type === 'ins' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: Diff ops have no identity beyond order.
          <ins key={index}>{op.text} </ins>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: Diff ops have no identity beyond order.
          <span key={index}>{op.text} </span>
        ),
      )}
    </p>
  )
}

export function changeContent(change: FieldChange, since: string, current?: string): ReactNode {
  if (change.kind === 'added')
    return <strong className='vp-change-tooltip__title'>New since {since}</strong>
  return (
    <>
      <strong className='vp-change-tooltip__title'>Changed since {since}</strong>
      {current !== undefined && !change.language ? (
        <WordDiff previous={change.previous ?? ''} current={current} />
      ) : (
        <pre className='vp-change-tooltip__code'>
          <del>{change.previous}</del>
        </pre>
      )}
    </>
  )
}

/** Spread onto a text element so a changed field is tinted and explains itself on hover. */
export function changeMark(revision: RevisionActions, key: string, current?: string) {
  const change = revision.field(key)
  if (!change) return {}
  const open = (event: { currentTarget: Element }) =>
    revision.show(event.currentTarget, changeContent(change, revision.since, current))
  return {
    'data-change': change.kind,
    onPointerEnter: open,
    onPointerLeave: revision.hide,
    onFocus: open,
    onBlur: revision.hide,
  }
}

function hunkContent(hunk: LineHunk, since: string): ReactNode {
  return (
    <>
      <strong className='vp-change-tooltip__title'>
        {hunk.removed.length === 0
          ? `Added since ${since}`
          : hunk.added.length === 0
            ? `Removed here since ${since}`
            : 'Previously'}
      </strong>
      {hunk.removed.length ? (
        <pre className='vp-change-tooltip__code'>
          <del>{hunk.removed.join('\n')}</del>
        </pre>
      ) : null}
    </>
  )
}

/**
 * Marks changed lines inside build-time highlighted code. Hovering a marked line shows the lines it
 * replaced. Falls back to tinting the whole block when the rendered lines cannot be matched.
 */
export function ChangedCode({
  changeKey,
  current,
  children,
}: {
  changeKey: string
  current: string
  children: ReactNode
}) {
  const revision = useRevisionChanges()
  const change = revision.field(changeKey)
  const root = useRef<HTMLDivElement>(null)
  const hunks = useMemo(
    () => (change?.kind === 'modified' ? lineHunks(change.previous ?? '', current) : []),
    [change, current],
  )

  useEffect(() => {
    const element = root.current
    if (!element || !change) return
    const lines = [...element.querySelectorAll<HTMLElement>('.ec-line')]
    const total = current.split('\n').length
    if (lines.length !== total) {
      element.dataset.change = change.kind
      return () => {
        delete element.dataset.change
      }
    }
    if (change.kind === 'added') for (const line of lines) line.dataset.change = 'added'
    hunks.forEach((hunk, index) => {
      for (const line of hunk.lines) {
        lines[line]!.dataset.change = hunk.kind
        lines[line]!.dataset.hunk = String(index)
      }
      if (!hunk.lines.length) {
        const anchor = lines[hunk.anchor]!
        anchor.dataset.removed = hunk.after ? 'after' : 'before'
        anchor.dataset.hunk = String(index)
      }
    })
    return () => {
      for (const line of lines) {
        delete line.dataset.change
        delete line.dataset.hunk
        delete line.dataset.removed
      }
    }
  }, [change, hunks, current])

  if (!change) return <>{children}</>
  const hunkAt = (target: EventTarget) => {
    const line = target instanceof Element ? target.closest<HTMLElement>('[data-hunk]') : null
    const hunk = line ? hunks[Number(line.dataset.hunk)] : undefined
    return line && hunk ? { line, hunk } : undefined
  }
  return (
    <div
      ref={root}
      className='vp-changed-code'
      onPointerOver={event => {
        const found = hunkAt(event.target)
        if (found) revision.show(found.line, hunkContent(found.hunk, revision.since))
        else if (root.current?.dataset.change)
          revision.show(root.current, changeContent(change, revision.since))
      }}
      onPointerLeave={revision.hide}
    >
      {children}
    </div>
  )
}

/** Removed children of one decision, each hoverable to see what it was. */
export function RemovedItems({ items }: { items: RemovedItem[] }) {
  const revision = useRevisionChanges()
  if (!revision.visible || !items.length) return null
  return (
    <div className='vp-removed-items' data-review-ui='true'>
      <span>Removed since {revision.since}:</span>
      {items.map(item => (
        <button
          type='button'
          key={item.key}
          onPointerEnter={event =>
            revision.show(
              event.currentTarget,
              <>
                <strong className='vp-change-tooltip__title'>{item.label}</strong>
                <pre className='vp-change-tooltip__code'>
                  <del>{item.previous}</del>
                </pre>
              </>,
            )
          }
          onPointerLeave={revision.hide}
          onFocus={event =>
            revision.show(
              event.currentTarget,
              <pre className='vp-change-tooltip__code'>
                <del>{item.previous}</del>
              </pre>,
            )
          }
          onBlur={revision.hide}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** The plan level line that says how much changed and lets the reader hide the highlights. */
export function RevisionSummary() {
  const revision = useRevisionChanges()
  const changes = revision.changes
  if (!changes) return null
  const places = [...changes.counts.values()].reduce((sum, value) => sum + value, 0)
  const decisions = [...changes.counts.values()].filter(value => value > 0).length
  const removedDecisions = changes.removed.get('')?.length ?? 0
  if (!places && !removedDecisions) return null
  return (
    <div className='vp-revision-summary' data-review-ui='true'>
      <span className='vp-revision-summary__dot' aria-hidden='true' />
      <p>
        Since {revision.since}: {places} {places === 1 ? 'place' : 'places'} changed in {decisions}{' '}
        {decisions === 1 ? 'decision' : 'decisions'}
        {removedDecisions
          ? `, ${removedDecisions} ${removedDecisions === 1 ? 'decision' : 'decisions'} removed`
          : ''}
        . Hover a highlight to see what it was.
      </p>
      <button type='button' onClick={() => revision.setVisible(!revision.visible)}>
        {revision.visible ? 'Hide highlights' : 'Show highlights'}
      </button>
      {revision.visible ? <RemovedItems items={changes.removed.get('') ?? []} /> : null}
    </div>
  )
}
